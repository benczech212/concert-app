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
  "Loving the", "Really getting into the", "Cannot stop listening to this", "What a"
];
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

class SimulatedUser {
  constructor(id) {
    this.id = id;
    this.email = `user${id}@sim.com`;
    this.name = `Sim User ${id}`;
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
            sessionId: this.id, // For track end watcher uniqueness
            category,
            value,
            ...extraProps
        });
    } catch(e) {}
  }
}

const sleep = ms => new Promise(res => setTimeout(res, ms));
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function runSimulation() {
  console.log("=== RESETTING ENVIRONMENT ===");
  await post('/api/metrics/reset', {});
  await sleep(1000);

  console.log("=== SETTING STATE: PRE_SHOW ===");
  await post('/api/state', { newState: 'PRE_SHOW' });
  
  console.log("\n=== BOOTSTRAPPING 20 USERS ===");
  const activeUsers = [];
  for (let i = 1; i <= 20; i++) {
    const u = new SimulatedUser(i);
    await u.login();
    await u.connectSSE();
    activeUsers.push(u);
    process.stdout.write('+');
  }
  console.log(`\nAdded 20 users. Total connected: ${activeUsers.length}`);
  
  await sleep(2000);

  console.log("\n=== SETTING STATE: ACTIVE ===");
  await post('/api/state', { newState: 'ACTIVE' });
  await sleep(1000);

  console.log(`\n=== STARTING Track 1 (Duration: 120s) ===`);
  const trackRes = await post('/api/track', { title: "Simulation Theme Song" });
  const actualTrackId = trackRes.track.id;
  await sleep(2000); 
  
  const durationSecs = 15;
  let elapsed = 0;
  
  // Start random engagements loop
  const eventLoop = setInterval(() => {
    elapsed++;
    if(elapsed % 20 === 0) console.log(`   ... Track 1 playing: ${elapsed}/${durationSecs}s elapsed.`);
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
          case "note": 
            const length = Math.floor(Math.random() * 3) + 1; // 1 to 3 extra words
            let note = Math.random() > 0.5 ? pickRandom(PHRASES) + " " : "";
            for (let i = 0; i < length; i++) {
                note += pickRandom(WORDS) + " ";
            }
            u.sendEvent("note", note.trim()); 
            break;
        }
      }
    });
  }, 1000);

  // We wait for the track duration to elapse on the main thread
  await sleep(durationSecs * 1000);
  clearInterval(eventLoop);

  // End the track
  console.log(`\n=== ENDING Track 1 ===`);
  await post('/api/track/end');
  console.log("... giving users 2 seconds to see the popup ...");
  await sleep(2000); 
  
  // Burst of words representing word cloud answers or skips
  console.log("\n=== SIMULATING END OF TRACK POPUP COMPLETIONS ===");
  for (let i = 0; i < activeUsers.length; i++) {
    const u = activeUsers[i];
    if (Math.random() > 0.25) { // 75% chance to submit a note
       let note = pickRandom(PHRASES) + " " + pickRandom(WORDS);
       await u.sendEvent("note", note.trim(), { trackId: actualTrackId }); 
       process.stdout.write('N');
    } else { // 25% chance to skip
       await u.sendEvent("note_skip", "skipped", { trackId: actualTrackId });
       process.stdout.write('S');
    }
  }
  
  console.log("\nAll users completed prompt. Waiting 60s for Gemini Story and Imagen auto-triggers to complete in background...");
  await sleep(60000);

  console.log("\n=== SETTING STATE: POST_SHOW ===");
  await post('/api/state', { newState: 'POST_SHOW' });
  
  console.log("\n=== Simulation Complete. Dropping Users ===");
  activeUsers.forEach(u => u.disconnectSSE());
  process.exit(0);
}

runSimulation();
