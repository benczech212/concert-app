const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const HOST = process.env.HOST || 'http://localhost:8000';

const MOODS = ["Happy", "Sad", "Angry", "Calm", "Excited", "Anxious", "Bored", "Joy", "Melancholy", "Confusion", "Mystery", "Chaos"];
const COLORS = [
  { name: "Red", hex: "#ff0000" }, { name: "Blue", hex: "#0000ff" }, 
  { name: "Amber", hex: "#ffbf00" }, { name: "Green", hex: "#00ff00" }, 
  { name: "Purple", hex: "#800080" }, { name: "Yellow", hex: "#ffff00" }, 
  { name: "Cyan", hex: "#00ffff" }, { name: "White", hex: "#ffffff" }
];
const REACTIONS = ["applause", "like", "meh"];
const WORDS = ["energetic", "wild", "fun", "amazing", "deep", "emotional", "moving", "profound", "slow", "intense", "chaotic", "loud", "crazy", "sharp", "awesome", "epic", "cool", "boring", "great", "huge", "fire", "rock", "synth", "bass", "vibes"];

// Helper for generic HTTP POST (Works natively on older node vs fetch)
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
          resolve(JSON.parse(body || '{}'));
        } else {
          reject(new Error(`Failed POST ${url}: ${res.statusCode} ${body}`));
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(HOST + url);
    const lib = urlObj.protocol === 'https:' ? https : http;
    lib.get(urlObj, { headers }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          reject(new Error(`Failed GET ${url}: ${res.statusCode} ${body}`));
        }
      });
    }).on('error', reject);
  });
}

class SimulatedUser {
  constructor(id) {
    this.id = id;
    this.email = `user${id}@sim.com`;
    this.name = `Sim User ${id}`;
    this.req = null; // SSE request handle
    this.intervalId = null;
  }

  async login() {
    await post('/api/users', { email: this.email, name: this.name, emailConsent: (Math.random() > 0.5) });
  }

  connectSSE() {
    return new Promise((resolve) => {
      if (this.req) return resolve();
      const urlObj = new URL(HOST + '/api/stream');
      const lib = urlObj.protocol === 'https:' ? https : http;
      this.req = lib.get(urlObj, (res) => {
        // SSE connection opened
        resolve();
        // Consume data to keep connection flowing
        res.on('data', () => {}); 
      });
      this.req.on('error', () => {}); // ignore disconnect errors
    });
  }

  disconnectSSE() {
    if (this.intervalId) clearInterval(this.intervalId);
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
            category,
            value,
            ...extraProps
        });
    } catch(e) {}
  }
}

let activeUsers = [];
let maxUserId = 0;

async function bootstrapUsers(count) {
  const newUsers = [];
  for (let i = 0; i < count; i++) {
    maxUserId++;
    const u = new SimulatedUser(maxUserId);
    await u.login();
    await u.connectSSE();
    newUsers.push(u);
    process.stdout.write('+');
  }
  activeUsers = activeUsers.concat(newUsers);
  console.log(`\nAdded ${count} users. Total: ${activeUsers.length}`);
}

function dropUsers(count) {
  const actualCount = Math.min(count, activeUsers.length);
  for (let i = 0; i < actualCount; i++) {
    const idx = Math.floor(Math.random() * activeUsers.length);
    const u = activeUsers.splice(idx, 1)[0];
    u.disconnectSSE();
    process.stdout.write('-');
  }
  console.log(`\nDropped ${actualCount} users. Total active: ${activeUsers.length}`);
}

const sleep = ms => new Promise(res => setTimeout(res, ms));
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function startTrackSimulation(trackNum, trackTitle, durationSecs) {
  console.log(`\n=== Starting Track ${trackNum}: ${trackTitle} for ${durationSecs}s ===`);
  await post('/api/track', { id: `trk-${trackNum}`, title: trackTitle });
  await sleep(2000); // 2s gap after start
  
  // Start random engagements loop
  const eventLoop = setInterval(() => {
    // 30% chance per second for any given active user to fire an event
    activeUsers.forEach(u => {
      if (Math.random() < 0.3) {
        const action = pickRandom(["mood", "color", "reaction", "note"]);
        switch(action) {
          case "mood": u.sendEvent("mood", pickRandom(MOODS)); break;
          case "color": 
            const c = pickRandom(COLORS);
            u.sendEvent("color", c.name, { colorRgba: c.hex }); 
            break;
          case "reaction": u.sendEvent("reaction", pickRandom(REACTIONS)); break;
          case "note": u.sendEvent("note", pickRandom(WORDS) + " " + pickRandom(WORDS)); break;
        }
      }
    });
  }, 1000);

  // Simulation Timeline events during the track
  const halfTime = Math.floor((durationSecs * 1000) / 2);
  
  setTimeout(async () => {
    console.log(`\n[Halfway through ${trackTitle}...] Mixing up the crowd.`);
    dropUsers(10);
    await bootstrapUsers(15); 
  }, halfTime);

  // We wait for the track duration to elapse on the main thread
  for (let i=0; i < durationSecs; i++) {
    if (i % 30 === 0) console.log(`   ... Track ${trackNum} playing: ${i}/${durationSecs}s elapsed. Users: ${activeUsers.length}`);
    await sleep(1000);
  }

  clearInterval(eventLoop);

  // End the track
  console.log(`\n=== Ending Track ${trackNum} ===`);
  await post('/api/track/end');
  await sleep(3000); // give users time to "review" their inputs in between tracks 
  
  // Burst of words representing word cloud answers
  console.log("   --- Generating post-track Word Cloud bursts ---");
  for (let i = 0; i < 20; i++) {
     const luckyParticipant = pickRandom(activeUsers);
     if (luckyParticipant) {
       luckyParticipant.sendEvent("note", `That was ${pickRandom(WORDS)}!`);
       await sleep(200);
     }
  }
}

async function runSimulation() {
  console.log("------------------------------------------");
  console.log("FULL CONCERT SIMULATION SEQUENCE STARTING");
  console.log("------------------------------------------\n");

  console.log("1. Clearing all existing metrics & databases...");
  await post('/api/metrics/reset');
  console.log("Done. \n");

  console.log("2. Setting Show State to ** PRE_SHOW Lobby **");
  await post('/api/state', { newState: 'PRE_SHOW' });
  await sleep(2000);
  
  console.log("3. Connecting 30 baseline users...");
  await bootstrapUsers(30);
  
  // Test connection counts
  await sleep(5000); 
  const stateRes = await get('/api/state');
  console.log(`\nChecked Server State. Result:`, stateRes);
  const parsedState = JSON.parse(stateRes);
  if (parsedState.connectedUsers < 30) {
      console.warn("WARNING: Server reports fewer than 30 connected SSE listeners! Something might be wrong with the heartbeat stream.");
  } else {
      console.log("Connections looking healthy.\n");
  }

  console.log("------------------------------------------");
  console.log("4. Start Active Show ");
  console.log("------------------------------------------\n");
  await post('/api/state', { newState: 'ACTIVE' });
  await sleep(3000);

  // Track 1
  await startTrackSimulation(1, "The Grand Opening", 300); // 5 mins
  await sleep(15000); // 15 seconds banter

  // Track 2
  await startTrackSimulation(2, "Electric Dreams", 300); 
  await sleep(15000);

  // Track 3
  await startTrackSimulation(3, "Sub Bass City", 300);
  await sleep(15000);

  // Track 4
  await startTrackSimulation(4, "The Final Sendoff", 300);
  
  console.log("------------------------------------------");
  console.log("5. Show Ended! Transitioning to POST_SHOW Recap ");
  console.log("------------------------------------------\n");
  await post('/api/state', { newState: 'POST_SHOW' });
  
  await sleep(5000);
  
  console.log("6. Testing CSV User Export Dataset.");
  const csvData = await get('/api/users/export');
  console.log("----- CSV OUTPUT DUMP HEAD -----");
  console.log(csvData.split('\n').slice(0, 10).join('\n'));
  console.log("... (truncated)\n");

  if (csvData.includes("Name,Email,Consent")) {
      console.log("CSV Export validated successful.");
  } else {
      console.warn("WARNING: CSV Export format does not match assumptions.");
  }

  console.log("\nDisconnecting all listeners fading to black...");
  dropUsers(activeUsers.length);
  
  console.log("\n------------------------------------------");
  console.log("FULL CONCERT SIMULATION COMPLETE! ");
  console.log("------------------------------------------\n");
  
  process.exit(0);
}

runSimulation().catch(e => {
  console.error("Simulation failed with error:", e);
  process.exit(1);
});
