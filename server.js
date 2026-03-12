const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const client = require('prom-client');
const https = require('https');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8000;

// Load config.yaml
let config = {};
try {
  const fileContents = fs.readFileSync(path.join(__dirname, 'config.yaml'), 'utf8');
  config = yaml.load(fileContents);
} catch (e) {
  console.error("Failed to load config.yaml:", e);
}

const geminiApiKey = process.env.GEMINI_API_KEY;
const STORY_MODEL = (config.ai_models && config.ai_models.story_model) ? config.ai_models.story_model : 'gemini-2.5-flash';
const IMAGE_MODEL = (config.ai_models && config.ai_models.image_model) ? config.ai_models.image_model : 'imagen-3.0-generate-002';

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Expose config.yaml to frontend
app.get('/config.yaml', (req, res) => {
  res.sendFile(path.join(__dirname, 'config.yaml'));
});

let events = [];

try {
  const logPath = path.join(__dirname, 'logs', 'events_log.jsonl');
  if (fs.existsSync(logPath)) {
    const fileData = fs.readFileSync(logPath, 'utf8');
    const lines = fileData.split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        events.push(JSON.parse(line));
      }
    });
    console.log(`Loaded ${events.length} prior events from jsonl log into memory.`);
  }
} catch (e) {
  console.error("Failed to load prev events:", e);
}

let users = {}; // Map of email -> user object
let currentTrack = null;
let connectedClients = [];
let showState = 'PRE_SHOW';

// Prometheus metrics setup
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics({ prefix: 'concert_' });

const eventCounter = new client.Counter({
  name: 'concert_event_count',
  help: 'Count of audience events',
  labelNames: ['category', 'value', 'trackId', 'trackTitle']
});

const reactionScoreCounter = new client.Counter({
  name: 'concert_reaction_score_total',
  help: 'Total score of reactions (1=meh, 2=like, 4=applause)',
  labelNames: ['trackId', 'trackTitle', 'colorName', 'mood', 'colorRgba', 'reactionLabel']
});

const reactionEventsCounter = new client.Counter({
  name: 'concert_reaction_events_total',
  help: 'Total count of combined reaction events',
  labelNames: ['trackId', 'trackTitle', 'colorName', 'mood', 'colorRgba', 'reactionLabel']
});

// Helper to push updates to all SSE clients
const broadcast = (data) => {
  connectedClients.forEach(client => {
    client.res.write(`data: ${JSON.stringify(data)}\n\n`);
  });
};

// Start SSE stream
app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // explicitly tell proxies not to buffer
  });
  res.flushHeaders();

  // Keep the TCP connection alive
  req.socket.setTimeout(0);
  req.socket.setNoDelay(true);
  req.socket.setKeepAlive(true);

  // Send current track immediately
  res.write(`data: ${JSON.stringify({ type: 'track', track: currentTrack })}\n\n`);

  const clientId = Date.now();
  const isBypass = req.query.bypass === 'true';
  const newClient = { id: clientId, res, bypass: isBypass };
  connectedClients.push(newClient);

  // Keep connection alive with periodic "ping" comments
  const heartbeat = setInterval(() => {
    res.write(':\n\n'); // SSE comment to prevent connection dropping
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    connectedClients = connectedClients.filter(c => c.id !== clientId);
  });
});

// Periodically record the connected user count
setInterval(() => {
  const activeUsersCount = connectedClients.filter(c => !c.bypass).length;
  if (activeUsersCount > 0) {
    const systemEvent = {
        id: `evt_users_${Date.now()}`,
        timestamp: new Date().toISOString(),
        category: 'system',
        value: 'connected_users',
        count: activeUsersCount
    };
    events.push(systemEvent);
    fs.appendFile(path.join(__dirname, 'logs', 'events_log.jsonl'), JSON.stringify(systemEvent) + '\n', () => { });
  }
}, 60000); // Every 60 seconds

app.post('/api/track', (req, res) => {
  const { title } = req.body;
  const safeTitle = title ? title.trim() : 'Unknown Track';
  
  // Handle case where title is 'none' or empty (used as an end signal from some clients)
  if (safeTitle.toLowerCase() === 'none' || safeTitle === '') {
    req.url = '/api/track/end';
    return app._router.handle(req, res); // Redirect to end track logic just in case
  }

  // Generate unique ID just in case of duplicate names
  const uniqueId = `trk_${Date.now()}`;
  let trackDetails = { id: uniqueId, title: safeTitle };

  currentTrack = trackDetails;
  broadcast({ type: 'track_start', track: currentTrack });

  // Record system event for timeline
  const systemEvent = {
    id: `evt_${Date.now()}`,
    timestamp: new Date().toISOString(),
    category: 'system',
    value: 'track_start',
    trackId: currentTrack.id,
    trackTitle: currentTrack.title
  };
  events.push(systemEvent);
  fs.appendFile(path.join(__dirname, 'logs', 'events_log.jsonl'), JSON.stringify(systemEvent) + '\n', () => { });

  res.json({ success: true, track: currentTrack });
});

// Clear track
app.post('/api/track/end', (req, res) => {
  if (currentTrack) {
    // Record system event for timeline
    const systemEvent = {
      id: `evt_${Date.now()}`,
      timestamp: new Date().toISOString(),
      category: 'system',
      value: 'track_end',
      trackId: currentTrack.id,
      trackTitle: currentTrack.title
    };
    events.push(systemEvent);
    fs.appendFile(path.join(__dirname, 'logs', 'events_log.jsonl'), JSON.stringify(systemEvent) + '\n', () => { });
  }

  currentTrack = null;
  broadcast({ type: 'track_end', track: null });
  res.json({ success: true });
});

// Record event
app.post('/api/events', (req, res) => {
  const event = req.body;

  // Attach current track if there is one
  if (currentTrack) {
    event.trackId = currentTrack.id;
    event.trackTitle = currentTrack.title;
  }

  // Basic validation
  if (!event.category || !event.value) {
    return res.status(400).json({ error: 'Missing category or value' });
  }

  // Basic bad word filter
  if (event.category === 'note' && typeof event.value === 'string') {
    const BAD_WORDS = ['fuck', 'shit', 'bitch', 'asshole', 'cunt', 'dick', 'pussy', 'whore', 'slut', 'faggot', 'nigger', 'cock', 'bastard'];
    const regex = new RegExp(`\\b(${BAD_WORDS.join('|')})\\b`, 'gi');
    event.value = event.value.replace(regex, '***');
  }

  // Ensure it has an ID and timestamp
  if (!event.id) event.id = `evt_${Date.now()}`;
  if (!event.timestamp) event.timestamp = new Date().toISOString();

  events.push(event);
  console.log("Recorded event:", event);

  // Append to persistent log file
  fs.appendFile(path.join(__dirname, 'logs', 'events_log.jsonl'), JSON.stringify(event) + '\n', (err) => {
    if (err) console.error("Failed to write to events_log.jsonl:", err);
  });

  // Increment Prometheus Counter
  if (event.category === 'combined_reaction') {
    const labels = {
      trackId: event.trackId || 'none',
      trackTitle: event.trackTitle || 'none',
      colorName: event.colorName || 'none',
      mood: event.mood || 'none',
      colorRgba: event.colorRgba || 'none',
      reactionLabel: event.reactionLabel || 'none'
    };
    reactionScoreCounter.inc(labels, Number(event.value));
    reactionEventsCounter.inc(labels, 1);
  } else {
    eventCounter.inc({
      category: event.category,
      value: event.value,
      trackId: event.trackId || 'none',
      trackTitle: event.trackTitle || 'none'
    });
  }

  res.json({ success: true, event });
});

// Retrieve events (for charts)
app.get('/api/events', (req, res) => {
  res.json(events);
});

// Register or update user
app.post('/api/users', (req, res) => {
  const user = req.body;

  if (!user || !user.email) {
    return res.status(400).json({ error: 'Missing user email' });
  }

  // Update or insert
  users[user.email] = {
    ...users[user.email], ...user,
    lastSeen: new Date().toISOString()
  };

  console.log("Registered user:", users[user.email]);
  res.json({ success: true, user: users[user.email] });
});

// Retrieve users database
app.get('/api/users', (req, res) => {
  res.json(Object.values(users));
});

// Export users database to CSV
app.get('/api/users/export', (req, res) => {
  const usersList = Object.values(users);
  let csv = 'Name,Email,Consent\\n';
  usersList.forEach(u => {
    // Escape quotes to be safe
    const name = u.name ? `"${u.name.replace(/"/g, '""')}"` : '""';
    const email = u.email ? `"${u.email.replace(/"/g, '""')}"` : '""';
    const consent = u.emailConsent ? 'True' : 'False';
    csv += `${name},${email},${consent}\\n`;
  });
  
  res.header('Content-Type', 'text/csv');
  res.attachment('participants.csv');
  return res.send(csv);
});

// Export events log
app.get('/api/export/events', (req, res) => {
  const filePath = path.join(__dirname, 'logs', 'events_log.jsonl');
  if (fs.existsSync(filePath)) {
    res.download(filePath, 'events_log.jsonl');
  } else {
    res.status(404).send('Events log not found');
  }
});

// Export server log
app.get('/api/export/logs', (req, res) => {
  const filePath = path.join(__dirname, 'logs', 'server.log');
  if (fs.existsSync(filePath)) {
    res.download(filePath, 'server.log');
  } else {
    res.status(404).send('Server log not found');
  }
});

// Export Prometheus metrics as a file
app.get('/api/export/metrics', async (req, res) => {
  try {
    const metricsHtml = await client.register.metrics();
    res.header('Content-Type', 'text/plain');
    res.attachment('prometheus_metrics.txt');
    return res.send(metricsHtml);
  } catch (err) {
    res.status(500).send('Failed to fetch metrics');
  }
});

// Read existing stories
app.get('/api/stories', (req, res) => {
  const filePath = path.join(__dirname, 'logs', 'track_stories.json');
  if (fs.existsSync(filePath)) {
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      res.json(JSON.parse(data));
    } catch (e) {
      res.json([]);
    }
  } else {
    res.json([]);
  }
});

// Generate stories using Gemini
async function generateShowStories() {
  if (!geminiApiKey) {
    console.log("No GEMINI_API_KEY found, skipping story generation.");
    return;
  }
  
  try {
    console.log("Generating stories for all tracks...");
  
  // Group events by track
  const trackData = {};
  
  // First pass: find track start times
  events.forEach(evt => {
    if (evt.category === 'system' && evt.value === 'track_start' && evt.trackId) {
       if (!trackData[evt.trackId]) {
         trackData[evt.trackId] = {
           title: evt.trackTitle || 'Unknown Track',
           startTime: new Date(evt.timestamp).getTime(),
           reactions: { meh: 0, like: 0, applause: 0 },
           words: [],
           colors: {},
           moods: {},
           minutes: {}
         };
       } else {
         trackData[evt.trackId].startTime = new Date(evt.timestamp).getTime();
       }
    }
  });

  // Second pass: gather all user events
  events.forEach(evt => {
    if (!evt.trackId || evt.trackId === 'none' || evt.category === 'system') return;
    let data = trackData[evt.trackId];
    if (!data) {
      // Fallback if no start event is found
      trackData[evt.trackId] = {
        title: evt.trackTitle || 'Unknown Track',
        startTime: new Date(evt.timestamp).getTime(),
        reactions: { meh: 0, like: 0, applause: 0 },
        words: [],
        colors: {},
        moods: {},
        minutes: {}
      };
      data = trackData[evt.trackId];
    }
    
    // Calculate which minute this event belongs to
    const evtTime = new Date(evt.timestamp).getTime();
    const minIndex = Math.floor((evtTime - data.startTime) / 60000);
    const m = Math.max(0, minIndex); // ensure non-negative
    if (!data.minutes[m]) {
       data.minutes[m] = { colors: {}, moods: {} };
    }
    
    // Accumulate Data
    if (evt.category === 'reaction') {
       if (evt.value === 1) data.reactions.meh++;
       if (evt.value === 2) data.reactions.like++;
       if (evt.value === 4) data.reactions.applause++;
    } else if (evt.category === 'combined_reaction') {
       const score = Number(evt.value);
       if (score === 1) data.reactions.meh++;
       else if (score === 2) data.reactions.like++;
       else if (score >= 4) data.reactions.applause++;
    } else if (evt.category === 'note' && evt.value) {
       data.words.push(evt.value);
    } else if (evt.category === 'color') {
       const c = evt.colorName || evt.value;
       data.colors[c] = (data.colors[c] || 0) + 1;
       data.minutes[m].colors[c] = (data.minutes[m].colors[c] || 0) + 1;
    } else if (evt.category === 'mood') {
       const mId = evt.value;
       data.moods[mId] = (data.moods[mId] || 0) + 1;
       data.minutes[m].moods[mId] = (data.minutes[m].moods[mId] || 0) + 1;
    }
  });
  
  const stories = [];
  
  console.log(`Aggregated trackData keys: ${Object.keys(trackData).length}`);

  for (const trackId of Object.keys(trackData)) {
    const data = trackData[trackId];
    
    // Only process tracks with at least some interaction
    if (data.reactions.applause === 0 && data.reactions.like === 0 && data.words.length === 0 && Object.keys(data.colors).length === 0 && Object.keys(data.moods).length === 0) {
        console.log(`Skipping track ${trackId} because of zero interaction.`);
        continue;
    }
    
    console.log(`Preparing prompts for track ${trackId} - ${data.title}`);
    const getAllWords = [...new Set(data.words)].join(', ');

    // Top 5 overall moods
    const topMoods = Object.entries(data.moods).sort((a,b) => b[1] - a[1]).slice(0, 5).map(x => x[0]).join(', ');
    
    // Top 2 overall colors
    const topColors = Object.entries(data.colors).sort((a,b) => b[1] - a[1]).slice(0, 2).map(x => x[0]).join(', ');

    // Minute by minute summary
    const minuteKeys = Object.keys(data.minutes).map(Number).sort((a,b) => a - b);
    let timelineOverview = [];
    for (const m of minuteKeys) {
       const mData = data.minutes[m];
       const topMinMods = Object.entries(mData.moods).sort((a,b) => b[1] - a[1]).slice(0, 2).map(x => x[0]);
       const topMinCol = Object.entries(mData.colors).sort((a,b) => b[1] - a[1]).slice(0, 1).map(x => x[0]);
       let parts = [];
       if (topMinMods.length) parts.push(`Moods: ${topMinMods.join(', ')}`);
       if (topMinCol.length) parts.push(`Top Color: ${topMinCol[0]}`);
       if (parts.length) {
         timelineOverview.push(`Minute ${m+1}: ${parts.join(' | ')}`);
       }
    }
    const timelineStr = timelineOverview.join('\\n');
    
    const prompt = `You are a creative storyteller. A live audience just listened to a musical track titled "${data.title}".
During the performance, they interacted using an app. Here is their aggregated data:

OVERALL TRACK SUMMARY:
- Applause: ${data.reactions.applause}
- Likes: ${data.reactions.like}
- Meh/Neutral: ${data.reactions.meh}
- Top 5 overall moods felt: ${topMoods || "none specified"}
- Top 2 overall colors felt: ${topColors || "none specified"}
- All words submitted to describe it: ${getAllWords || "none submitted"}

MINUTE-BY-MINUTE TRAJECTORY:
${timelineStr || "no timeline data"}

Based on this audience reaction, generate two things:
1. A creative, evocative new name for this performance of the track, based largely on the overall track summary (top 5 moods and top 2 colors).
2. A short (2-3 sentences) poetic description/story that traces the audience's journey using the minute-by-minute trajectory and the submitted words.
  
Output format should be JSON exactly like this, no markdown formatting:
{
  "newName": "The Generated Name",
  "story": "The generated story."
}`;

    try {
      // Use child_process to invoke curl, avoiding node version https/fetch incompatibilities or silent exits
      const payloadFile = path.join(__dirname, 'logs', `gemini_payload_${trackId}.json`);
      fs.writeFileSync(payloadFile, JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
      }));
      
      const responseText = await new Promise((resolve, reject) => {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${STORY_MODEL}:generateContent?key=${geminiApiKey}`;
        const cmd = `curl -s -X POST -H 'Content-Type: application/json' -d @${payloadFile} "${url}"`;
        
        const { exec } = require('child_process');
        exec(cmd, (error, stdout, stderr) => {
           if (fs.existsSync(payloadFile)) fs.unlinkSync(payloadFile);
           if (error) {
              console.error(`Curl error execution: ${error}`);
              resolve(JSON.stringify({ error: true, msg: error.message }));
           } else {
              resolve(stdout);
           }
        });
      });
      
      const geminiData = JSON.parse(responseText);
      
      // Save exact prompt & response pair to log file
      try {
          const logPayload = { timestamp: new Date().toISOString(), model: STORY_MODEL, trackId, prompt: prompt, response: geminiData };
          fs.appendFileSync('/home/benczech/dev/concert-app/logs/ai_prompts.jsonl', JSON.stringify(logPayload) + '\\n');
      } catch (logErr) {
          console.error("Failed to append to ai_prompts.jsonl", logErr);
      }

      if (geminiData.error) {
          console.error("Skipping track generation due to Gemini Error:", geminiData);
          continue;
      }
      let rawText = geminiData.candidates && geminiData.candidates[0] && geminiData.candidates[0].content && geminiData.candidates[0].content.parts && geminiData.candidates[0].content.parts[0] ? geminiData.candidates[0].content.parts[0].text : "";
      
      let parsed = { newName: "Unknown Story", story: "No story generated." };
      
      try {
          if (rawText.includes('\`\`\`json')) {
             rawText = rawText.split('\`\`\`json')[1].split('\`\`\`')[0].trim();
          } else if (rawText.includes('\`\`\`')) {
             rawText = rawText.split('\`\`\`')[1].trim();
          }
          parsed = JSON.parse(rawText);
      } catch (parseErr) {
          console.error(`Failed to parse Gemini generated JSON for track ${trackId}:`, parseErr);
          console.error(`Raw text was: ${rawText}`);
      }

      stories.push({
        trackId: trackId,
        originalTitle: data.title,
        newName: parsed.newName || "Unnamed Track",
        story: parsed.story || "No story available."
      });
      console.log(`Generated story for ${data.title}`);
    } catch (e) {
      console.error(`Failed to generate story for ${data.title}:`, e);
    }
  }
  
  // Save to file
  fs.writeFileSync(path.join(__dirname, 'logs', 'track_stories.json'), JSON.stringify(stories, null, 2));
  console.log("Track stories saved to logs/track_stories.json");
  
  // Broadcast to let clients know stories are available
  broadcast({ type: 'stories_ready' });
  } catch(fatalErr) {
    console.error("FATAL ERROR IN generateShowStories:", fatalErr);
  }
}

// Generate image prompts for admin review
app.get('/api/images/preview', (req, res) => {
  let stories = [];
  try {
    const storiesPath = path.join(__dirname, 'logs', 'track_stories.json');
    if (fs.existsSync(storiesPath)) {
      stories = JSON.parse(fs.readFileSync(storiesPath, 'utf8'));
    }
  } catch(e) {}

  // Group events by track
  const trackData = {};
  
  events.forEach(evt => {
    if (!evt.trackId || evt.trackId === 'none') return;
    if (!trackData[evt.trackId]) {
      trackData[evt.trackId] = {
        title: evt.trackTitle || 'Unknown Track',
        reactions: { meh: 0, like: 0, applause: 0 },
        words: [],
        colors: []
      };
    }
    
    if (evt.category === 'reaction') {
       if (evt.value === 1) trackData[evt.trackId].reactions.meh++;
       if (evt.value === 2) trackData[evt.trackId].reactions.like++;
       if (evt.value === 4) trackData[evt.trackId].reactions.applause++;
    } else if (evt.category === 'combined_reaction') {
       const score = Number(evt.value);
       if (score === 1) trackData[evt.trackId].reactions.meh++;
       else if (score === 2) trackData[evt.trackId].reactions.like++;
       else if (score >= 4) trackData[evt.trackId].reactions.applause++;
    } else if (evt.category === 'note' && evt.value) {
       trackData[evt.trackId].words.push(evt.value);
    } else if (evt.category === 'color') {
       trackData[evt.trackId].colors.push(evt.colorName || evt.value);
    }
  });

  const prompts = [];
  
  for (const trackId of Object.keys(trackData)) {
    const data = trackData[trackId];
    
    // Skip if there's very little interaction (e.g., less than 5 total interactions to filter noise)
    const interactionCount = data.reactions.applause + data.reactions.like + data.reactions.meh + data.words.length + data.colors.length;
    if (interactionCount === 0) continue;
    
    // Find story for this track
    const storyFile = path.join(__dirname, 'logs', 'track_stories.json');
    let aiName = data.title;
    let aiStory = "The abstract journey of the performance.";
    try {
        if(fs.existsSync(storyFile)) {
             const parsed = JSON.parse(fs.readFileSync(storyFile, 'utf8'));
             const matchingStory = parsed.find(k => k.trackId == trackId);
             if(matchingStory) {
                 aiName = matchingStory.newName;
                 aiStory = matchingStory.story;
             }
        }
    } catch(e) { }

    const topWords = [...new Set(data.words)].slice(0, 10).join(', ');
    const topColors = [...new Set(data.colors)].slice(0, 3).join(', ');

    prompts.push({
      trackId: trackId,
      title: data.title,
      aiName: aiName,
      aiStory: aiStory,
      prompt: `Create a highly abstract, atmospheric, wide 16:9 concert visual background based on a song titled "${aiName}". \nStory meaning: ${aiStory}. \nThe dominant colors should be: ${topColors || 'vibrant shifting hues'}. \nThe visual mood and themes should reflect these words: ${topWords || 'ambient, energetic, musical'}. Do not include any text or UI elements in the image.`
    });
    
    // Extract audience details (if we ever need to review them)
    // The single prompt push is kept just above.
  }

  res.json({ success: true, prompts });
});

app.post('/api/images/generate', async (req, res) => {
  if (!geminiApiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not found' });
  }

  const { prompts } = req.body;
  if (!Array.isArray(prompts) || prompts.length === 0) {
    return res.status(400).json({ error: 'Missing or empty prompts array' });
  }

  const images = [];

  for (const p of prompts) {
    try {
      const responseText = await new Promise((resolve, reject) => {
        const payload = JSON.stringify({
          instances: [{ prompt: p.prompt }],
          parameters: { sampleCount: 1 }
        });
        
        const reqPost = https.request({
          hostname: 'generativelanguage.googleapis.com',
          path: `/v1beta/models/${IMAGE_MODEL}:predict?key=${geminiApiKey}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        }, (resPost) => {
          let body = '';
          resPost.on('data', d => body += d);
          resPost.on('end', () => {
             if (resPost.statusCode >= 200 && resPost.statusCode < 300) {
                resolve(body);
             } else {
                reject(new Error(`Imagen API returned ${resPost.statusCode}: ${body}`));
             }
          });
        });
        reqPost.on('error', reject);
        reqPost.write(payload);
        reqPost.end();
      });

      const data = JSON.parse(responseText);
      
      try {
          const logPayload = { timestamp: new Date().toISOString(), model: IMAGE_MODEL, trackId: p.trackId, prompt: p.prompt, response: data };
          fs.appendFileSync('/home/benczech/dev/concert-app/logs/ai_prompts.jsonl', JSON.stringify(logPayload) + '\\n');
      } catch (logErr) {
          console.error("Failed to append to ai_prompts.jsonl", logErr);
      }

      const b64 = data.predictions && data.predictions[0] && data.predictions[0].bytesBase64Encoded ? data.predictions[0].bytesBase64Encoded : null;
      if (b64) {
        images.push({
          trackId: p.trackId,
          trackTitle: p.trackTitle,
          imageBase64: b64
        });
      }
    } catch (e) {
      console.error(`Failed to generate image for track ${p.trackId}:`);
      console.error(e);
    }
  }

  // Save the generated images to a file
  fs.writeFileSync(path.join(__dirname, 'logs', 'track_images.json'), JSON.stringify(images, null, 2));
  console.log("Track images saved to logs/track_images.json");

  res.json({ success: true, count: images.length });
});

// Read existing images
app.get('/api/images', (req, res) => {
  const filePath = path.join(__dirname, 'logs', 'track_images.json');
  if (fs.existsSync(filePath)) {
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      res.json(JSON.parse(data));
    } catch (e) {
      res.json([]);
    }
  } else {
    res.json([]);
  }
});

app.get('/api/state', (req, res) => {
  res.json({
    showState: showState,
    connectedUsers: connectedClients.filter(c => !c.bypass).length
  });
});

// Update show state
app.post('/api/state', (req, res) => {
  const { newState } = req.body;
  if (['PRE_SHOW', 'ACTIVE', 'POST_SHOW'].includes(newState)) {
    showState = newState;
    broadcast({ type: 'state_change', showState });
    
    if (newState === 'POST_SHOW') {
      generateShowStories().catch(console.error);
    }
    
    res.json({ success: true, showState });
  } else {
    res.status(400).json({ error: 'Invalid state' });
  }
});

// Prometheus metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.send(await client.register.metrics());
});

// Reset Prometheus metrics
app.post('/api/metrics/reset', (req, res) => {
  client.register.resetMetrics();
  events = []; // Clear in-memory datastore so charts reset
  currentTrack = null; // Clear active track
  broadcast({ type: 'track_end', track: null });
  
  const eventsLog = path.join(__dirname, 'logs', 'events_log.jsonl');
  const storiesLog = path.join(__dirname, 'logs', 'track_stories.json');
  const imagesLog = path.join(__dirname, 'logs', 'track_images.json');

  if (fs.existsSync(eventsLog)) fs.writeFileSync(eventsLog, '');
  if (fs.existsSync(storiesLog)) fs.writeFileSync(storiesLog, '[]');
  if (fs.existsSync(imagesLog)) fs.writeFileSync(imagesLog, '[]');

  console.log("Prometheus metrics, events array, track history, and log files reset via API");
  res.json({ success: true, message: "Metrics, events, and track history reset successfully" });
});

// Fallback to index.html for SPA routing if needed
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Node.js Admin & API Server running on port ${PORT}`);
});
