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

// Set current track
app.post('/api/track', (req, res) => {
  const { trackId, title, id } = req.body;
  const finalTrackId = trackId || id;

  // Try to load config.yaml to find the track details
  let trackDetails = { id: finalTrackId, title: title || 'Unknown Track' };

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
  fs.appendFile(path.join(__dirname, 'events_log.jsonl'), JSON.stringify(systemEvent) + '\n', () => { });

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
    fs.appendFile(path.join(__dirname, 'events_log.jsonl'), JSON.stringify(systemEvent) + '\n', () => { });
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
  const filePath = path.join(__dirname, 'events_log.jsonl');
  if (fs.existsSync(filePath)) {
    res.download(filePath, 'events_log.jsonl');
  } else {
    res.status(404).send('Events log not found');
  }
});

// Export server log
app.get('/api/export/logs', (req, res) => {
  const filePath = path.join(__dirname, 'server.log');
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
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Node.js Admin & API Server running on port ${PORT}`);
});
