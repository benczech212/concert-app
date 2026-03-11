const http = require('http');
const https = require('https');

const HOST = process.env.HOST || 'http://localhost:8000';

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

const sleep = ms => new Promise(res => setTimeout(res, ms));

async function runDryRun() {
  console.log("------------------------------------------");
  console.log("FULL DRY RUN SIMULATION SEQUENCE STARTING");
  console.log("------------------------------------------\n");

  console.log("1. Clearing all existing metrics & databases...");
  await post('/api/metrics/reset');
  console.log("Done. \n");

  console.log("2. Setting Show State to ** PRE_SHOW Lobby **");
  await post('/api/state', { newState: 'PRE_SHOW' });
  
  console.log("\nWaiting for 2 minutes...");
  for(let i=0; i<120; i+=30) {
      console.log(`   ... ${i}/120s elapsed.`);
      await sleep(30000);
  }

  console.log("\n------------------------------------------");
  console.log("3. Start Active Show: Track 1");
  console.log("------------------------------------------\n");
  await post('/api/state', { newState: 'ACTIVE' });
  await post('/api/track', { id: `trk-1`, title: 'Track 1' });
  
  console.log("\nWaiting for 3 minutes...");
  for(let i=0; i<180; i+=30) {
      console.log(`   ... ${i}/180s elapsed.`);
      await sleep(30000);
  }

  console.log("\n------------------------------------------");
  console.log("4. Start Track 2");
  console.log("------------------------------------------\n");
  await post('/api/track', { id: `trk-2`, title: 'Track 2' });

  console.log("\nWaiting for 3 minutes...");
  for(let i=0; i<180; i+=30) {
      console.log(`   ... ${i}/180s elapsed.`);
      await sleep(30000);
  }

  console.log("\n------------------------------------------");
  console.log("5. Start Track 3");
  console.log("------------------------------------------\n");
  await post('/api/track', { id: `trk-3`, title: 'Track 3' });

  console.log("\nWaiting for 3 minutes...");
  for(let i=0; i<180; i+=30) {
      console.log(`   ... ${i}/180s elapsed.`);
      await sleep(30000);
  }

  console.log("\n------------------------------------------");
  console.log("6. Ending Show! Transitioning to POST_SHOW Recap ");
  console.log("------------------------------------------\n");
  await post('/api/track/end');
  await post('/api/state', { newState: 'POST_SHOW' });

  console.log("\n------------------------------------------");
  console.log("FULL DRY RUN SIMULATION COMPLETE!");
  console.log("------------------------------------------\n");
  
  process.exit(0);
}

runDryRun().catch(e => {
  console.error("Simulation failed with error:", e);
  process.exit(1);
});
