const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(bodyParser.json());

// Serve static files from the same directory
app.use(express.static(__dirname));

// In-memory data store
let events = [];
let currentTrack = null;
let connectedClients = [];

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
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  
  // Send current track immediately
  res.write(`data: ${JSON.stringify({ type: 'track', track: currentTrack })}\n\n`);

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  connectedClients.push(newClient);

  req.on('close', () => {
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
  
  res.json({ success: true, event });
});

// Retrieve events (for charts)
app.get('/api/events', (req, res) => {
  res.json(events);
});

// Fallback to index.html for SPA routing if needed
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Node.js Admin & API Server running on port ${PORT}`);
});
