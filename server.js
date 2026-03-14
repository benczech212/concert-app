const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const client = require('prom-client');
const https = require('https');
require('dotenv').config();

const { GoogleGenAI, Type } = require('@google/genai');

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
const ai = new GoogleGenAI({ apiKey: geminiApiKey });

const STORY_MODEL = (config.ai_models && config.ai_models.story_model) ? config.ai_models.story_model : 'gemini-3.1-pro-preview';
const IMAGE_MODEL = (config.ai_models && config.ai_models.image_model) ? config.ai_models.image_model : 'gemini-3.1-flash-image-preview';

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve archive files
app.use('/archives', express.static(path.join(__dirname, 'archives')));

// Serve post show analysis files
app.use('/analysis', express.static(path.join(__dirname, 'live show', 'post_show_analysis')));

// API to list available archives
app.get('/api/archives', (req, res) => {
  const archivesDir = path.join(__dirname, 'archives');
  if (fs.existsSync(archivesDir)) {
    const files = fs.readdirSync(archivesDir).filter(file => file.endsWith('.tar.gz') || file.endsWith('.json') || file.endsWith('.jsonl'));
    res.json(files);
  } else {
    res.json([]);
  }
});

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

// Load users from disk if available
const usersDbPath = path.join(__dirname, 'logs', 'users.json');
try {
  if (fs.existsSync(usersDbPath)) {
    const data = fs.readFileSync(usersDbPath, 'utf8');
    users = JSON.parse(data);
    console.log(`Loaded ${Object.keys(users).length} users from disk.`);
  }
} catch (e) {
  console.error("Failed to load users DB", e);
}

let currentTrack = null;
let connectedClients = [];
let showState = 'PRE_SHOW';
let trackEndWatchers = {}; // { trackId: { expected: number, received: Set(sessionIds), timeout: NodeJS.Timeout } }

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

function startTrack(title) {
  const safeTitle = title ? title.trim() : 'Unknown Track';
  
  // If a track is already playing, end it automatically
  if (currentTrack) {
    console.log(`[Track] Auto-ending current track ${currentTrack.id} before starting new one.`);
    endCurrentTrack();
  }

  // Generate unique ID just in case of duplicate names
  // Use a slight delay or unique salt if multiple fired in same ms, but Date.now is usually fine for human clicks
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
  
  return currentTrack;
}

app.post('/api/track', (req, res) => {
  const { title } = req.body;
  const safeTitle = title ? title.trim() : 'Unknown Track';
  
  // Handle case where title is 'none' or empty (used as an end signal from some clients)
  if (safeTitle.toLowerCase() === 'none' || safeTitle === '') {
    req.url = '/api/track/end';
    return app._router.handle(req, res); // Redirect to end track logic just in case
  }

  const track = startTrack(safeTitle);
  res.json({ success: true, track });
});

function endCurrentTrack() {
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
    
    // Start track end watcher for automated generation
    const activeClientsCount = connectedClients.filter(c => !c.bypass).length;
    console.log(`[Watcher] Track End! Active Users: ${activeClientsCount} (Total Connected: ${connectedClients.length})`);
    const endedTrackId = currentTrack.id;
    
    // Auto-trigger immediately if no one is connected, otherwise wait.
    if (activeClientsCount === 0) {
      triggerAutomaticStoryGeneration(endedTrackId);
    } else {
      trackEndWatchers[endedTrackId] = {
        expected: activeClientsCount,
        received: new Set(),
        timeout: setTimeout(() => {
          console.log(`[Watcher] Timeout reached for ${endedTrackId}, triggering automated generation.`);
          triggerAutomaticStoryGeneration(endedTrackId);
          delete trackEndWatchers[endedTrackId];
        }, 30000) // 30 seconds wait
      };
      console.log(`[Watcher] Started waiting on ${activeClientsCount} users for ${endedTrackId}.`);
    }
  }

  currentTrack = null;
  broadcast({ type: 'track_end', track: null });
}

// Clear track
app.post('/api/track/end', (req, res) => {
  endCurrentTrack();
  res.json({ success: true });
});

app.post('/api/debug/generate-text', async (req, res) => {
    const { trackId, customPrompt } = req.body;
    if (!trackId) {
        return res.status(400).json({ error: 'Missing trackId' });
    }
    console.log(`[Manual Override] Triggering text generation for ${trackId}`);
    try {
        const result = await generateShowStories(trackId, customPrompt);
        if (result && result.storyData) {
            broadcast({ type: 'stories_ready' });
            res.json({ success: true, storyData: result.storyData, topWords: result.topWords, topColors: result.topColors });
        } else {
            res.status(500).json({ error: 'Failed to generate text or skip condition met' });
        }
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/debug/refine-image-prompt', async (req, res) => {
    const { trackId, imagePrompt } = req.body;
    if (!imagePrompt) {
        return res.status(400).json({ error: 'Missing imagePrompt' });
    }
    console.log(`[Prompt Refine] Refining image prompt for ${trackId || 'unknown'}`);
    
    try {
        const refineInstruction = `You are an expert AI prompt engineer specializing in generative image models like Imagen. 
Your task is to take the following baseline prompt and refine it into a highly detailed, extremely evocative, visually stunning prompt specifically optimized for an image generation AI. 

Ensure you retain the core themes, colors, moods, and specific references mentioned in the original prompt, but expand upon them to create a stronger, more beautiful visual composition. 
Keep it under 1000 characters.

ORIGINAL PROMPT:
"${imagePrompt}"`;

        const response = await ai.models.generateContent({
            model: STORY_MODEL,
            contents: [{
                role: 'user',
                parts: [{ text: refineInstruction }]
            }],
            config: {
                thinkingConfig: {
                    thinkingLevel: 'HIGH'
                },
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    required: ["refinedPrompt"],
                    properties: {
                        refinedPrompt: { type: Type.STRING }
                    }
                }
            }
        });
        
        let parsed;
        try {
            parsed = JSON.parse(response.text || "{}");
        } catch(e) {
            parsed = { refinedPrompt: response.text };
        }
        res.json({ success: true, refinedPrompt: (parsed.refinedPrompt || "").trim() });
    } catch(e) {
        console.error("Refinement error:", e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/debug/refine-text-prompt', async (req, res) => {
    const { trackId, textPrompt } = req.body;
    if (!textPrompt) {
        return res.status(400).json({ error: 'Missing textPrompt' });
    }
    console.log(`[Prompt Refine] Refining text prompt for ${trackId || 'unknown'}`);
    
    try {
        const refineInstruction = `You are an expert AI prompt engineer. 
Your task is to take the following baseline prompt and refine it into a highly detailed, evocative, and compelling prompt specifically optimized for a text generation AI to create a story and title. 

Ensure you retain the core metrics, colors, moods, and specific references mentioned in the original prompt, but expand upon the prompt's instructions to ensure the AI generates the most creative and poetic response possible. 
Keep it under 1000 characters.

ORIGINAL PROMPT:
"${textPrompt}"`;

        const response = await ai.models.generateContent({
            model: STORY_MODEL,
            contents: [{
                role: 'user',
                parts: [{ text: refineInstruction }]
            }],
            config: {
                thinkingConfig: {
                    thinkingLevel: 'HIGH'
                },
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    required: ["refinedPrompt"],
                    properties: {
                        refinedPrompt: { type: Type.STRING }
                    }
                }
            }
        });
        
        let parsed;
        try {
            parsed = JSON.parse(response.text || "{}");
        } catch(e) {
            parsed = { refinedPrompt: response.text };
        }
        res.json({ success: true, refinedPrompt: (parsed.refinedPrompt || "").trim() });
    } catch(e) {
        console.error("Text Refinement error:", e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/debug/generate-image-direct', async (req, res) => {
    const { trackId, title, imagePrompt } = req.body;
    if (!trackId || !imagePrompt) {
        return res.status(400).json({ error: 'Missing trackId or imagePrompt' });
    }
    console.log(`[Manual Override] Triggering direct image generation for ${trackId}`);
    try {
        await generateImageForTrack(trackId, title || "Unknown Track", title || "Unknown Track", "Custom Prompt Image", "", "", imagePrompt);
        res.json({ success: true, message: `Image generation triggered for ${trackId}` });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// Manual Test Track Inject
app.post('/api/debug/test-track-inject', (req, res) => {
    console.log(`[Test Inject] Generating a fake track and populating events...`);
    const testId = `trk_test_${Date.now()}`;
    const testTitle = "Injected Admin Test Track";
    
    // Add fake start event
    events.push({
        id: `evt_${testId}_start`, timestamp: new Date().toISOString(), category: 'system', value: 'track_start', trackId: testId, trackTitle: testTitle
    });

    // Add 80 fake audience events
    const MOODS = ["Happy", "Sad", "Angry", "Calm", "Excited", "Anxious", "Bored", "Joy", "Melancholy", "Confusion", "Mystery", "Chaos"];
    const COLORS = ["Red", "Blue", "Amber", "Green", "Purple", "Yellow", "Cyan", "White"];
    const REACTIONS = [1, 2, 4]; // meh, like, applause
    const PHRASES = ["I am feeling so", "This track is", "Wow", "Incredible performance", "Absolutely", "Just feeling the", "Loving the"];
    const WORDS = ["energetic", "wild", "fun", "amazing", "deep", "emotional", "moving", "profound", "slow", "intense", "chaotic", "loud"];

    for(let i=0; i<80; i++) {
        const rand = Math.random();
        if(rand < 0.25) {
             events.push({ id: `evt_${testId}_m${i}`, timestamp: new Date().toISOString(), category: 'mood', value: MOODS[Math.floor(Math.random()*MOODS.length)], trackId: testId });
        } else if(rand < 0.5) {
             events.push({ id: `evt_${testId}_c${i}`, timestamp: new Date().toISOString(), category: 'color', value: COLORS[Math.floor(Math.random()*COLORS.length)], trackId: testId });
        } else if(rand < 0.75) {
             events.push({ id: `evt_${testId}_r${i}`, timestamp: new Date().toISOString(), category: 'combined_reaction', value: REACTIONS[Math.floor(Math.random()*REACTIONS.length)], trackId: testId });
        } else {
             const note = (Math.random() > 0.5 ? PHRASES[Math.floor(Math.random()*PHRASES.length)] + " " : "") + WORDS[Math.floor(Math.random()*WORDS.length)];
             events.push({ id: `evt_${testId}_n${i}`, timestamp: new Date().toISOString(), category: 'note', value: note, trackId: testId });
        }
    }
    
    // Add fake end event
    events.push({
        id: `evt_${testId}_end`, timestamp: new Date().toISOString(), category: 'system', value: 'track_end', trackId: testId, trackTitle: testTitle
    });

    console.log(`[Test Inject] Triggering AI Generation natively for ${testId}`);
    triggerAutomaticStoryGeneration(testId);
    
    res.json({ success: true, message: `Injected test track ${testId} with 80 random user events and initiated AI generation.` });
});

// Record event
app.post('/api/events', (req, res) => {
  const event = req.body;

  // Attach current track if there is one, but don't overwrite explicit trackIds from the client payload (crucial for post-track notes)
  if (currentTrack && !event.trackId) {
    event.trackId = currentTrack.id;
    event.trackTitle = currentTrack.title;
  }

  // Basic validation
  if (!event.category || !event.value) {
    return res.status(400).json({ error: 'Missing category or value' });
  }

  // Basic bad word filter
  const BAD_WORDS = ['fuck', 'shit', 'bitch', 'asshole', 'cunt', 'dick', 'pussy', 'whore', 'slut', 'faggot', 'nigger', 'cock', 'bastard'];
  const regex = new RegExp(`\\b(${BAD_WORDS.join('|')})\\b`, 'gi');

  if (event.category === 'note' && typeof event.value === 'string') {
    event.value = event.value.replace(regex, '****');
  }
  
  if (event.note && typeof event.note === 'string') {
    event.note = event.note.replace(regex, '****');
  }

  // Ensure it has an ID and timestamp
  if (!event.id) event.id = `evt_${Date.now()}`;
  if (!event.timestamp) event.timestamp = new Date().toISOString();

  events.push(event);
  console.log("Recorded event:", event);
  
  // Track End Watcher Check
  if ((event.category === 'note' || event.category === 'note_skip') && event.trackId && trackEndWatchers[event.trackId]) {
      const watcher = trackEndWatchers[event.trackId];
      // Use sessionId or email to avoid double counting same user
      const uniqueSourceId = event.sessionId || event.userId || event.id; 
      watcher.received.add(uniqueSourceId);
      
      console.log(`[Watcher] Progress for ${event.trackId}: ${watcher.received.size} / ${watcher.expected}`);
      
      if (watcher.received.size >= watcher.expected) {
          console.log(`[Watcher] Target completions reached for ${event.trackId}. Triggering automated generation.`);
          clearTimeout(watcher.timeout);
          triggerAutomaticStoryGeneration(event.trackId);
          delete trackEndWatchers[event.trackId];
      }
  }

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
  
  // Persist users to disk
  try {
    fs.writeFileSync(usersDbPath, JSON.stringify(users, null, 2));
  } catch (e) {
    console.error("Failed to persist users DB", e);
  }

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
async function generateShowStories(specificTrackId = null, customPrompt = null) {
  if (!geminiApiKey) {
    console.log("No GEMINI_API_KEY found, skipping story generation.");
    return null;
  }
  
  try {
    console.log(specificTrackId ? `Generating story specifically for track ${specificTrackId}...` : "Generating stories for all tracks...");
  
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
  
  if (specificTrackId && !trackData[specificTrackId]) {
      console.log(`Track ${specificTrackId} not found in live memory. Injecting mock shell to allow customPrompt generation.`);
      trackData[specificTrackId] = {
          title: "Pre-Generated Track",
          startTime: Date.now(),
          reactions: { meh: 0, like: 1, applause: 0 }, // fake interaction to bypass skipping
          words: [],
          colors: {},
          moods: {},
          minutes: {}
      };
  }

  const stories = [];
  
  console.log(`Aggregated trackData keys: ${Object.keys(trackData).length}`);

  for (const trackId of Object.keys(trackData)) {
    if (specificTrackId && trackId !== specificTrackId) continue;
    
    const data = trackData[trackId];
    
    // Only process tracks with at least some interaction
    if (data.reactions.applause === 0 && data.reactions.like === 0 && data.words.length === 0 && Object.keys(data.colors).length === 0 && Object.keys(data.moods).length === 0) {
        console.log(`Skipping track ${trackId} because of zero interaction.`);
        if (specificTrackId) {
            return {
                storyData: { trackId, originalTitle: data.title, newName: data.title, story: "No audience interaction collected.", rawData: data },
                topWords: [],
                topColors: ''
            };
        }
        continue;
    }
    
    console.log(`Preparing prompts for track ${trackId} - ${data.title}`);

    // N-gram calculator
    const getNGrams = (phrasesArr, n) => {
        const counts = {};
        phrasesArr.forEach(phrase => {
            const tokens = phrase.trim().toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 0);
            for (let i = 0; i <= tokens.length - n; i++) {
                const ngram = tokens.slice(i, i + n).join(' ');
                counts[ngram] = (counts[ngram] || 0) + 1;
            }
        });
        return Object.entries(counts).sort((a,b) => b[1] - a[1]);
    };

    const top1 = getNGrams(data.words, 1).slice(0, 50).map(x => `${x[0]} (${x[1]})`).join(', ');
    const top2 = getNGrams(data.words, 2).slice(0, 25).map(x => `${x[0]} (${x[1]})`).join(', ');
    const top3 = getNGrams(data.words, 3).slice(0, 10).map(x => `${x[0]} (${x[1]})`).join(', ');
    const top4 = getNGrams(data.words, 4).slice(0, 5).map(x => `${x[0]} (${x[1]})`).join(', ');

    let allWordsStr = [];
    if (top1) allWordsStr.push(`Top 50 single words: ${top1}`);
    if (top2) allWordsStr.push(`Top 25 2-word pairs: ${top2}`);
    if (top3) allWordsStr.push(`Top 10 3-word pairs: ${top3}`);
    if (top4) allWordsStr.push(`Top 5 4-or-more word pairs: ${top4}`);
    const finalWordsStr = allWordsStr.join('\\n  ') || "none submitted";

    // Top 5 overall moods
    const topMoods = Object.entries(data.moods).sort((a,b) => b[1] - a[1]).slice(0, 5).map(x => `${x[0]} (${x[1]})`).join(', ');
    
    // Top 2 overall colors
    const topColors = Object.entries(data.colors).sort((a,b) => b[1] - a[1]).slice(0, 2).map(x => `${x[0]} (${x[1]})`).join(', ');

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
    
    let prompt = customPrompt;
    if (!prompt) {
      prompt = `You are a creative storyteller. A live audience just listened to a musical track titled "${data.title}" during a live piano jazz concert.\\n We want your help coming up with a name for this track. During the performance, they interacted using an app. Here is their aggregated data:

OVERALL TRACK SUMMARY:
- Applause: ${data.reactions.applause}
- Likes: ${data.reactions.like}
- Meh/Neutral: ${data.reactions.meh}
- Top 5 overall moods felt: ${topMoods || "none specified"}
- Top 2 overall colors felt: ${topColors || "none specified"}
- All words submitted to describe it: \\n  ${finalWordsStr}

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
    }

      try {
        const response = await ai.models.generateContent({
            model: STORY_MODEL,
            contents: [{
                role: 'user',
                parts: [{ text: prompt }]
            }],
            config: {
                thinkingConfig: {
                    thinkingLevel: 'HIGH'
                },
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    required: ["newName", "story"],
                    properties: {
                        newName: { type: Type.STRING },
                        story: { type: Type.STRING }
                    }
                }
            }
        });
        
        let rawText = response.text || "";
        let nativeThoughts = ""; // gemini-3.1-pro-preview handles thoughts internally and does not expose them structurally to the user via the `part.thought` object
        
        // Ensure string is correctly parsed
        let parsed;
        try {
            parsed = JSON.parse(rawText);
        } catch (e) {
            console.error("Strict JSON parse failed despite schema enforcement:", e);
            parsed = { newName: "Unnamed Track", story: rawText };
        }
        
        // Save exact prompt & response pair to log file
        try {
            const logPayload = { timestamp: new Date().toISOString(), model: STORY_MODEL, trackId, prompt: prompt, response: { text: rawText, thoughts: nativeThoughts }};
            fs.appendFileSync('/home/benczech/dev/concert-app/logs/ai_prompts.jsonl', JSON.stringify(logPayload) + '\n');
        } catch (logErr) {
            console.error("Failed to append to ai_prompts.jsonl", logErr);
        }

        stories.push({
          trackId: trackId,
        originalTitle: data.title,
        newName: parsed.newName || "Unnamed Track",
        story: parsed.story || "No story available.",
        thoughts: nativeThoughts || "",
        geminiPrompt: prompt,
        rawData: data
      });
      console.log(`Generated story for ${data.title}`);
      
      if (specificTrackId) {
          // Keep existing stories and just append this one
          let existingStories = [];
          const storiesPath = path.join(__dirname, 'logs', 'track_stories.json');
          if (fs.existsSync(storiesPath)) {
              try { existingStories = JSON.parse(fs.readFileSync(storiesPath, 'utf8')); } catch(e) {}
          }
          existingStories.push(stories[stories.length - 1]);
          fs.writeFileSync(storiesPath, JSON.stringify(existingStories, null, 2));
          
          // Return early for single runs to chain to image generation
          return {
              storyData: stories[stories.length - 1],
              topWords: data.words,
              topColors: topColors
          };
      }
    } catch (e) {
      console.error(`Failed to generate story for ${data.title}:`, e);
    }
  }
  
  if (!specificTrackId) {
      // Save full generation to file
      fs.writeFileSync(path.join(__dirname, 'logs', 'track_stories.json'), JSON.stringify(stories, null, 2));
      console.log("Track stories saved to logs/track_stories.json");
      
      // Broadcast to let clients know stories are available
      broadcast({ type: 'stories_ready' });
  }
  
  } catch(fatalErr) {
    console.error("FATAL ERROR IN generateShowStories:", fatalErr);
  }
  return null;
}

// Select a specific story version to be the public designated one
app.post('/api/debug/select-story', (req, res) => {
    const { trackId, index } = req.body;
    let existingStories = [];
    const storiesPath = path.join(__dirname, 'logs', 'track_stories.json');
    if (fs.existsSync(storiesPath)) {
        try { existingStories = JSON.parse(fs.readFileSync(storiesPath, 'utf8')); } catch(e) {}
    }

    // Isolate all generations for this specific track
    const trackGenerations = existingStories.filter(s => s.trackId === trackId);
    
    if (index >= 0 && index < trackGenerations.length) {
        // Find the precise entry we want to mark as chosen
        const targetStory = trackGenerations[index];
        
        // Reset flags for all variations of this track
        existingStories.forEach(s => {
            if (s.trackId === trackId) {
                s.isChosen = false;
            }
        });
        
        // Find the target inside the main array and flag it
        if (masterIndex !== -1) {
            existingStories[masterIndex].isChosen = true;
            fs.writeFileSync(storiesPath, JSON.stringify(existingStories, null, 2));
            broadcast({ type: 'stories_ready' });
            res.json({ success: true });
        } else {
             res.status(404).json({ error: 'Target generation instance not found in master list.' });
        }
    } else {
        res.status(400).json({ error: 'Invalid selection index.' });
    }
});

// Delete a specific story version from history
app.delete('/api/debug/delete-story', (req, res) => {
    const { trackId, index } = req.body;
    let existingStories = [];
    const storiesPath = path.join(__dirname, 'logs', 'track_stories.json');
    if (fs.existsSync(storiesPath)) {
        try { existingStories = JSON.parse(fs.readFileSync(storiesPath, 'utf8')); } catch(e) {}
    }

    // Isolate all generations for this specific track
    const trackGenerations = existingStories.filter(s => s.trackId === trackId);
    
    if (index >= 0 && index < trackGenerations.length) {
        const targetStory = trackGenerations[index];
        const masterIndex = existingStories.findIndex(s => s.trackId === trackId && s.newName === targetStory.newName && s.story === targetStory.story);
        
        if (masterIndex !== -1) {
            const wasChosen = existingStories[masterIndex].isChosen;
            existingStories.splice(masterIndex, 1);
            
            // If we deleted the actively chosen item, and there are still options left, pick the newest one by default
            if (wasChosen) {
                const remainingForTrack = existingStories.filter(s => s.trackId === trackId);
                if (remainingForTrack.length > 0) {
                    const latestMatchIndex = existingStories.lastIndexOf(remainingForTrack[remainingForTrack.length - 1]);
                    existingStories[latestMatchIndex].isChosen = true;
                }
            }
            
            fs.writeFileSync(storiesPath, JSON.stringify(existingStories, null, 2));
            broadcast({ type: 'stories_ready' });
            res.json({ success: true, deleted: true });
        } else {
             res.status(404).json({ error: 'Target generation instance not found for deletion.' });
        }
    } else {
        res.status(400).json({ error: 'Invalid deletion index.' });
    }
});

// Select a specific image version to be the public designated one
app.post('/api/debug/select-image', (req, res) => {
    const { trackId, index } = req.body;
    let existingImages = [];
    const imagesPath = path.join(__dirname, 'logs', 'track_images.json');
    if (fs.existsSync(imagesPath)) {
        try { existingImages = JSON.parse(fs.readFileSync(imagesPath, 'utf8')); } catch(e) {}
    }

    const trackGenerations = existingImages.filter(i => i.trackId === trackId);
    
    if (index >= 0 && index < trackGenerations.length) {
        const targetImage = trackGenerations[index];
        
        existingImages.forEach(i => {
            if (i.trackId === trackId) {
                i.isChosen = false;
            }
        });
        
        const masterIndex = existingImages.findIndex(i => i.trackId === trackId && i.imageBase64 === targetImage.imageBase64);
        if (masterIndex !== -1) {
            existingImages[masterIndex].isChosen = true;
            fs.writeFileSync(imagesPath, JSON.stringify(existingImages, null, 2));
            broadcast({ type: 'images_ready' });
            res.json({ success: true });
        } else {
             res.status(404).json({ error: 'Target generation instance not found in master list.' });
        }
    } else {
        res.status(400).json({ error: 'Invalid selection index.' });
    }
});

// Delete a specific image version from history
app.delete('/api/debug/delete-image', (req, res) => {
    const { trackId, index } = req.body;
    let existingImages = [];
    const imagesPath = path.join(__dirname, 'logs', 'track_images.json');
    if (fs.existsSync(imagesPath)) {
        try { existingImages = JSON.parse(fs.readFileSync(imagesPath, 'utf8')); } catch(e) {}
    }

    const trackGenerations = existingImages.filter(i => i.trackId === trackId);
    
    if (index >= 0 && index < trackGenerations.length) {
        const targetImage = trackGenerations[index];
        const masterIndex = existingImages.findIndex(i => i.trackId === trackId && i.imageBase64 === targetImage.imageBase64);
        
        if (masterIndex !== -1) {
            const wasChosen = existingImages[masterIndex].isChosen;
            existingImages.splice(masterIndex, 1);
            
            if (wasChosen) {
                const remainingForTrack = existingImages.filter(i => i.trackId === trackId);
                if (remainingForTrack.length > 0) {
                    const latestMatchIndex = existingImages.lastIndexOf(remainingForTrack[remainingForTrack.length - 1]);
                    existingImages[latestMatchIndex].isChosen = true;
                }
            }
            
            fs.writeFileSync(imagesPath, JSON.stringify(existingImages, null, 2));
            broadcast({ type: 'images_ready' });
            res.json({ success: true, deleted: true });
        } else {
             res.status(404).json({ error: 'Target generation instance not found for deletion.' });
        }
    } else {
        res.status(400).json({ error: 'Invalid deletion index.' });
    }
});

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

async function generateImageForTrack(trackId, title, aiName, aiStory, topWords, topColors, overrideImagePrompt = null) {
    if (!geminiApiKey) {
        console.log('GEMINI_API_KEY not found, skipping automated image generation');
        return;
    }

    const promptText = overrideImagePrompt || `Create a highly abstract, atmospheric, wide 16:9 concert visual background based on a song titled "${aiName}". \nStory meaning: ${aiStory}. \nThe dominant colors should be: ${topColors || 'vibrant shifting hues'}. \nThe visual mood and themes should reflect these words: ${topWords || 'ambient, energetic, musical'}. Do not include any text or UI elements in the image.`;

    try {
        console.log(`Generating automated Imagen image for ${trackId}...`);
        const responseText = await new Promise((resolve, reject) => {
            const payload = JSON.stringify({
                contents: [{
                    parts: [{ text: promptText }]
                }],
                generationConfig: {
                    responseModalities: ["Image"]
                }
            });
            
            const reqPost = https.request({
                hostname: 'generativelanguage.googleapis.com',
                path: `/v1beta/models/${IMAGE_MODEL}:generateContent?key=${geminiApiKey}`,
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
            const logPayload = { timestamp: new Date().toISOString(), model: IMAGE_MODEL, trackId: trackId, prompt: promptText, response: data };
            fs.appendFileSync('/home/benczech/dev/concert-app/logs/ai_prompts.jsonl', JSON.stringify(logPayload) + '\\n');
        } catch (logErr) {}

        let b64 = null;
        if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
            for (const p of data.candidates[0].content.parts) {
                if (p.inlineData && p.inlineData.data) {
                    b64 = p.inlineData.data;
                }
            }
        } else if (data.predictions && data.predictions[0] && data.predictions[0].bytesBase64Encoded) {
            b64 = data.predictions[0].bytesBase64Encoded;
        }

        if (b64) {
            let existingImages = [];
            const imgPath = path.join(__dirname, 'logs', 'track_images.json');
            if (fs.existsSync(imgPath)) {
                try { 
                    const parsedData = JSON.parse(fs.readFileSync(imgPath, 'utf8')); 
                    if (Array.isArray(parsedData)) existingImages = parsedData;
                } catch(e) {}
            }
            existingImages.push({
                trackId: trackId,
                trackTitle: title,
                imageBase64: b64
            });
            fs.writeFileSync(imgPath, JSON.stringify(existingImages, null, 2));
            console.log(`Saved new automated abstract image for ${trackId} in json.`);
            
            try {
                const outDir = path.join(__dirname, 'logs', 'images');
                if (!fs.existsSync(outDir)) { fs.mkdirSync(outDir, { recursive: true }); }
                const fileName = `image_${trackId}_${Date.now()}.jpg`;
                fs.writeFileSync(path.join(outDir, fileName), b64, 'base64');
                console.log(`Saved image file to logs/images/${fileName}`);
            } catch (err) {
                console.error("Failed to write image file", err);
            }
            
            broadcast({ type: 'images_ready' });
        }
    } catch (e) {
        console.error(`Failed to generate automated image for track ${trackId}:`, e);
    }
}

async function triggerAutomaticStoryGeneration(trackId, customPrompt = null) {
    if (!trackId) return;
    console.log(`Triggering automated story + image generation cycle for ${trackId}`);
    
    try {
        const result = await generateShowStories(trackId, customPrompt);
        if (result && result.storyData) {
            broadcast({ type: 'stories_ready' });
            // Chain the image generation immediately
            await generateImageForTrack(
                trackId, 
                result.storyData.title, 
                result.storyData.newName, 
                result.storyData.story, 
                result.topWords, 
                result.topColors
            );
        }
    } catch (err) {
        console.error(`Auto generation cycle failed for ${trackId}`, err);
    }
}

app.post('/api/images/generate', async (req, res) => {
  if (!geminiApiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not found' });
  }

  const { prompts } = req.body;
  if (!Array.isArray(prompts) || prompts.length === 0) {
    return res.status(400).json({ error: 'Missing or empty prompts array' });
  }

  let images = [];
  const imgPath = path.join(__dirname, 'logs', 'track_images.json');
  if (fs.existsSync(imgPath)) {
      try { 
          const parsedData = JSON.parse(fs.readFileSync(imgPath, 'utf8')); 
          if (Array.isArray(parsedData)) images = parsedData;
      } catch(e) {}
  }

  for (const p of prompts) {
    try {
      const responseText = await new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            contents: [{
                parts: [{ text: p.prompt }]
            }],
            generationConfig: {
                responseModalities: ["Image"]
            }
        });
        
        const reqPost = https.request({
          hostname: 'generativelanguage.googleapis.com',
          path: `/v1beta/models/${IMAGE_MODEL}:generateContent?key=${geminiApiKey}`,
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

      let b64 = null;
      if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
          for (const part of data.candidates[0].content.parts) {
              if (part.inlineData && part.inlineData.data) {
                  b64 = part.inlineData.data;
              }
          }
      } else if (data.predictions && data.predictions[0] && data.predictions[0].bytesBase64Encoded) {
          b64 = data.predictions[0].bytesBase64Encoded;
      }

      if (b64) {
        images.push({
          trackId: p.trackId,
          trackTitle: p.trackTitle,
          imageBase64: b64
        });
        
        try {
            const outDir = path.join(__dirname, 'logs', 'images');
            if (!fs.existsSync(outDir)) { fs.mkdirSync(outDir, { recursive: true }); }
            const fileName = `image_${p.trackId}_${Date.now()}.jpg`;
            fs.writeFileSync(path.join(outDir, fileName), b64, 'base64');
            console.log(`Saved image file to logs/images/${fileName}`);
        } catch (err) {
            console.error("Failed to write image file", err);
        }
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
    
    if (newState === 'PRE_SHOW') {
      console.log("[State] Transition to PRE_SHOW. Generating default Pre-Show track.");
      startTrack("Pre-Show");
    }
    
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

// Reset Prometheus metrics and Archive Session
app.post('/api/metrics/reset', (req, res) => {
  const timestamp = Date.now();
  const archivesDir = path.join(__dirname, 'archives');
  if (!fs.existsSync(archivesDir)) fs.mkdirSync(archivesDir, { recursive: true });
  
  const archiveName = `archive_${timestamp}.tar.gz`;
  const archivePath = path.join(archivesDir, archiveName);
  
  const { exec } = require('child_process');
  
  // Package the existing logs and images into a tar bundle before resetting
  exec(`tar -czf ${archivePath} -C ${__dirname} logs/`, (error) => {
      if (error) console.error("Failed to archive logs:", error);
      else console.log(`Archived previous session to ${archivePath}`);

      client.register.resetMetrics();
      events = []; // Clear in-memory datastore so charts reset
      currentTrack = null; // Clear active track
      broadcast({ type: 'track_end', track: null });
      
      const eventsLog = path.join(__dirname, 'logs', 'events_log.jsonl');
      const storiesLog = path.join(__dirname, 'logs', 'track_stories.json');
      const imagesLog = path.join(__dirname, 'logs', 'track_images.json');
      const aiPromptsLog = path.join(__dirname, 'logs', 'ai_prompts.jsonl');

      if (fs.existsSync(eventsLog)) fs.writeFileSync(eventsLog, '');
      if (fs.existsSync(storiesLog)) fs.writeFileSync(storiesLog, '[]');
      if (fs.existsSync(imagesLog)) fs.writeFileSync(imagesLog, '[]');
      if (fs.existsSync(aiPromptsLog)) fs.writeFileSync(aiPromptsLog, '');
      
      // Clear physical images but KEEP the directory
      const imgDir = path.join(__dirname, 'logs', 'images');
      if (fs.existsSync(imgDir)) {
          fs.readdirSync(imgDir).forEach(file => fs.unlinkSync(path.join(imgDir, file)));
      }

      console.log("Prometheus metrics, events array, track history, and log files archived and reset via API");
      res.json({ success: true, message: `Archived to ${archiveName} and reset successfully` });
  });
});

// Fallback to index.html for SPA routing if needed
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Node.js Admin & API Server running on port ${PORT}`);
});
