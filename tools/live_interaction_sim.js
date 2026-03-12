const http = require('http');
const https = require('https');

const HOST = process.env.HOST || 'http://localhost:8000';

const MOODS = ["Happy", "Sad", "Angry", "Calm", "Excited", "Anxious", "Bored", "Joy", "Melancholy", "Confusion", "Mystery", "Chaos"];
const COLORS = [
  { name: "Red", hex: "#ff0000" }, { name: "Blue", hex: "#0000ff" }, 
  { name: "Amber", hex: "#ffbf00" }, { name: "Green", hex: "#00ff00" }, 
  { name: "Purple", hex: "#800080" }, { name: "Yellow", hex: "#ffff00" }, 
  { name: "Cyan", hex: "#00ffff" }, { name: "White", hex: "#ffffff" }
];
const REACTIONS = ["applause", "like", "meh"];
const PHRASES = [
  "I am feeling so", "This track is", "Wow", "Incredible performance", "Absolutely", "Just feeling the", 
  "Loving the", "Really getting into the", "What a"
];
const WORDS = ["energetic", "wild", "fun", "amazing", "deep", "emotional", "moving", "profound", "slow", "intense", "chaotic", "loud", "crazy", "sharp", "awesome", "epic", "cool", "boring", "great", "huge", "fire", "rock", "synth", "bass", "vibes"];

// Helper for generic HTTP POST
function post(url, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(HOST + url);
    const lib = urlObj.protocol === 'https:' ? https : http;
    const req = lib.request(urlObj, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body || '{}')); } catch(e) { resolve({}); }
        } else {
          reject(new Error(`Failed POST ${url}: ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

class SimulatedUser {
  constructor(id) {
    this.id = id;
    this.email = `liveuser${id}@sim.com`;
    this.name = `Live Sim User ${id}`;
    this.req = null;
  }

  async login() {
    await post('/api/users', { email: this.email, name: this.name, emailConsent: true });
  }

  connectSSE() {
    return new Promise((resolve) => {
      const urlObj = new URL(HOST + '/api/stream');
      const lib = urlObj.protocol === 'https:' ? https : http;
      this.req = lib.get(urlObj, (res) => {
        resolve();
        res.on('data', () => {}); 
      });
      this.req.on('error', () => {});
    });
  }

  disconnectSSE() {
    if (this.req) {
      this.req.destroy();
      this.req = null;
    }
  }

  async sendEvent(category, value, extraProps = {}) {
    try {
        await post('/api/events', {
            userId: this.email,
            userName: this.name,
            sessionId: this.id, // Ensure unique session
            category,
            value,
            ...extraProps
        });
    } catch(e) {}
  }
}

const sleep = ms => new Promise(res => setTimeout(res, ms));
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

let activeUsers = [];
let engagementInterval = null;
let currentTrackId = null;

// The Master Listener connecting to the SSE stream to drive behavior based on your actions
function startMasterListener() {
  const urlObj = new URL(HOST + '/api/stream');
  const lib = urlObj.protocol === 'https:' ? https : http;
  const req = lib.get(urlObj, (res) => {
    let buffer = '';
    res.on('data', chunk => {
      buffer += chunk.toString();
      let lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete lines for the next chunk
      
      lines.forEach(async line => {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.substring(6));
            handleServerEvent(data);
          } catch(e) {}
        }
      });
    });
  });
  req.on('error', (err) => {
      console.error("Master Listener Error: ", err);
      // Try to reconnect
      setTimeout(startMasterListener, 5000);
  });
}

async function handleServerEvent(data) {
  if (data.type === 'state_change') {
    console.log(`\n>>> SHOW STATE CHANGED TO: ${data.showState} <<<`);
    if (data.showState === 'POST_SHOW') {
      console.log("\n--- Post Show Detected. Exiting Simulation ---");
      activeUsers.forEach(u => u.disconnectSSE());
      process.exit(0);
    }
  }

  if (data.type === 'track_start' && data.track) {
    currentTrackId = data.track.id;
    console.log(`\n>>> TRACK STARTED: ${data.track.title} [${currentTrackId}] <<<`);
    console.log("   --- Initiating sporadic audience engagement ---");
    
    // Stop any existing interval just in case
    if (engagementInterval) clearInterval(engagementInterval);
    
    // Trigger sporadic engagements. Less frequent than aggressive sims.
    engagementInterval = setInterval(() => {
      // Pick 1 to 3 random users out of the 20 to submit something every 2 seconds
      const numEngagements = Math.floor(Math.random() * 3) + 1;
      for(let i=0; i<numEngagements; i++) {
         const u = pickRandom(activeUsers);
         const action = pickRandom(["mood", "color", "reaction"]); // Not doing notes mid-track to match normal logic usually
         
         process.stdout.write('.'); // Visual indicator
         switch(action) {
          case "mood": u.sendEvent("mood", pickRandom(MOODS)); break;
          case "color": 
            const c = pickRandom(COLORS);
            u.sendEvent("color", c.name, { colorRgba: c.hex }); 
            break;
          case "reaction": u.sendEvent("reaction", pickRandom(REACTIONS)); break;
         }
      }
    }, 2500); // Once every 2.5 seconds, someone does something
  }

  if (data.type === 'track_end') {
    console.log(`\n>>> TRACK ENDED <<<`);
    // Stop random mid-track engagements
    if (engagementInterval) {
        clearInterval(engagementInterval);
        engagementInterval = null;
    }
    
    const endedTrackId = currentTrackId;
    currentTrackId = null;

    console.log("... Simulating audience filling out the Word Cloud (wait 5s)...");
    await sleep(5000); // Give you time to look at the UI, let users "think"

    console.log(`--- Submitting prompt completions for ${endedTrackId} ---`);
    for (let i = 0; i < activeUsers.length; i++) {
        const u = activeUsers[i];
        if (Math.random() > 0.3) { // 70% chance to submit a legitimate note
           let note = pickRandom(PHRASES) + " " + pickRandom(WORDS);
           await u.sendEvent("note", note.trim(), { trackId: endedTrackId }); 
           process.stdout.write('N');
        } else { // 30% chance they just hit Skip or close it
           await u.sendEvent("note_skip", "skipped", { trackId: endedTrackId });
           process.stdout.write('S');
        }
        await sleep(200); // slight stagger
    }
    console.log("\n--- Audience submitted. Waiting for your next command. ---");
  }
}

async function runLiveSimulation() {
  console.log("=== LIVE SIMULATION LISTENER STARTING ===");
  console.log(`Host: ${HOST}`);
  
  console.log("1. Clearing Data (Resetting metrics/logs/arrays)...");
  await post('/api/metrics/reset', {});
  await sleep(1000);

  console.log("2. Putting Show in PRE_SHOW (Lobby) mode...");
  await post('/api/state', { newState: 'PRE_SHOW' });
  await sleep(1000);
  
  console.log("3. Bootstrapping 20 Audience Members...");
  for (let i = 1; i <= 20; i++) {
    const u = new SimulatedUser(i);
    await u.login();
    await u.connectSSE();
    activeUsers.push(u);
    process.stdout.write('+');
  }
  console.log(`\nAdded 20 users. Total connected: ${activeUsers.length}`);

  console.log("\n=== READY! MASTER LISTENER PENDING ===");
  console.log("You may now use Admin or TouchDesigner to set ACTIVE mode and start Tracks.");
  console.log("This script will automatically react and populate data when a Track is running.");
  
  startMasterListener();
}

runLiveSimulation();
