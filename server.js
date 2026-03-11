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

const geminiApiKey = process.env.GEMINI_API_KEY;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

let events = [];
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
  const newClient = { id: clientId, res };
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
  if (connectedClients.length > 0) {
    const systemEvent = {
        id: `evt_users_${Date.now()}`,
        timestamp: new Date().toISOString(),
        category: 'system',
        value: 'connected_users',
        count: connectedClients.length
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
  
  console.log("Generating stories for all tracks...");
  
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
  
  const stories = [];
  
  for (const trackId of Object.keys(trackData)) {
    const data = trackData[trackId];
    
    // Only process tracks with at least some interaction
    if (data.reactions.applause === 0 && data.reactions.like === 0 && data.words.length === 0) continue;
    
    const topWords = data.words.slice(-20).join(', '); // up to 20 recent words
    const topColors = [...new Set(data.colors)].slice(0, 5).join(', '); // up to 5 unique colors
    
    const prompt = `You are a creative storyteller. A live audience just listened to a musical track titled "${data.title}".
During the performance, they interacted using an app. Here is their data:
- Applause: ${data.reactions.applause}
- Likes: ${data.reactions.like}
- Meh/Neutral: ${data.reactions.meh}
- Colors they felt: ${topColors}
- Words they submitted to describe it: ${topWords}

Based on this audience reaction, generate two things:
1. A creative, evocative new name for this performance of the track.
2. A very short (2-3 sentences) poetic summary or story of how the audience experienced this moment.

Output format should be JSON exactly like this, no markdown formatting:
{
  "newName": "The Generated Name",
  "story": "The generated story."
}`;

    try {
      const responseText = await new Promise((resolve, reject) => {
        const payload = JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        });
        
        const req = https.request({
          hostname: 'generativelanguage.googleapis.com',
          path: `/v1beta/models/gemini-2.5-pro:generateContent?key=${geminiApiKey}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        }, (res) => {
          let body = '';
          res.on('data', d => body += d);
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
               resolve(body);
            } else {
               reject(new Error(`Gemini API returned ${res.statusCode}: ${body}`));
            }
          });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
      });
      
      const geminiData = JSON.parse(responseText);
      let rawText = geminiData.candidates && geminiData.candidates[0] && geminiData.candidates[0].content && geminiData.candidates[0].content.parts && geminiData.candidates[0].content.parts[0] ? geminiData.candidates[0].content.parts[0].text : "";
      
      if (rawText.startsWith('\`\`\`json')) {
         rawText = rawText.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
      } else if (rawText.startsWith('\`\`\`')) {
         rawText = rawText.replace(/\`\`\`/g, '').trim();
      }
      
      const parsed = JSON.parse(rawText);
      stories.push({
        trackId: trackId,
        originalTitle: data.title,
        newName: parsed.newName,
        story: parsed.story
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
}

// Generate image prompts for admin review
app.get('/api/images/preview', (req, res) => {
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
    
    // Extract audience details 
    const reactionSummary = [];
    if (data.reactions.applause > 0) reactionSummary.push(`${data.reactions.applause} applause`);
    if (data.reactions.like > 0) reactionSummary.push(`${data.reactions.like} likes`);
    if (data.reactions.meh > 0) reactionSummary.push(`${data.reactions.meh} neutral`);
    
    const reactionStr = reactionSummary.join(", ") || "no recorded reactions";
    const topWords = data.words.slice(-20).join(', ') || "no words submitted";
    const topColors = [...new Set(data.colors)].slice(0, 5).join(', ') || "no specific colors";

    const promptText = `An abstract, highly emotional, and visually striking representation of a musical performance of "${data.title}".
The audience felt the following primary colors: ${topColors}.
The audience described the feeling with these words: ${topWords}.
The audience reacted with: ${reactionStr}.
Make the scene ethereal, concert-like, and highly evocative of those specific colors and emotions. No text in the image.`;

    prompts.push({
       trackId: trackId,
       trackTitle: data.title,
       prompt: promptText
    });
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
          path: `/v1beta/models/imagen-3.0-generate-002:predict?key=${geminiApiKey}`,
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

// Get show state and concurrent connections
app.get('/api/state', (req, res) => {
  res.json({
    showState: showState,
    connectedUsers: connectedClients.length
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
  fs.writeFileSync(path.join(__dirname, 'events_log.jsonl'), ''); // Clear the persistent log
  console.log("Prometheus metrics, events array, and log file reset via API");
  res.json({ success: true, message: "Metrics, events, and log reset successfully" });
});

// Fallback to index.html for SPA routing if needed
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Node.js Admin & API Server running on port ${PORT}`);
});
