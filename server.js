const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const client = require('prom-client');

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files from the same directory
app.use(express.static(__dirname));

// In-memory data store
let events = [];
let users = {}; // Map of email -> user object
let currentTrack = null;
let connectedClients = [];

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

// Set current track
app.post('/api/track', (req, res) => {
  const { trackId, title } = req.body;

  // Try to load config.yaml to find the track details
  let trackDetails = { id: trackId, title: title || 'Unknown Track' };

  try {
    const fileContents = fs.readFileSync(path.join(__dirname, 'config.yaml'), 'utf8');
    const config = yaml.load(fileContents);
    if (config.tracks) {
      const found = config.tracks.find(t => t.id === trackId || t.title === title);
      if (found) {
        trackDetails = found;
      }
    }
  } catch (e) {
    console.error("Failed to read config.yaml tracks", e);
  }

  currentTrack = trackDetails;
  broadcast({ type: 'track', track: currentTrack });

  res.json({ success: true, track: currentTrack });
});

// Clear track
app.delete('/api/track', (req, res) => {
  currentTrack = null;
  broadcast({ type: 'track', track: null });
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

  // Ensure it has an ID and timestamp
  if (!event.id) event.id = `evt_${Date.now()}`;
  if (!event.timestamp) event.timestamp = new Date().toISOString();

  events.push(event);
  console.log("Recorded event:", event);

  // Append to persistent log file
  fs.appendFile(path.join(__dirname, 'events_log.jsonl'), JSON.stringify(event) + '\n', (err) => {
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

// Prometheus metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.send(await client.register.metrics());
});

// Reset Prometheus metrics
app.post('/api/metrics/reset', (req, res) => {
  client.register.resetMetrics();
  console.log("Prometheus metrics reset via API");
  res.json({ success: true, message: "Metrics reset successfully" });
});

// Fallback to index.html for SPA routing if needed
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Node.js Admin & API Server running on port ${PORT}`);
});
