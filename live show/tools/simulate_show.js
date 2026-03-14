const fs = require('fs');
const path = require('path');
const http = require('http');

const SERVER_URL = process.argv[2] || 'http://localhost:3000';
const SPEED_FACTOR = parseFloat(process.argv[3]) || 0; // 0 = instant, 1 = realtime, 10 = 10x speed

const eventsPath = path.join(__dirname, '..', 'untouched_data', 'simulation_events.json');
if (!fs.existsSync(eventsPath)) {
    console.error("No simulation events found. Run extract_data.js first.");
    process.exit(1);
}

const events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
const users = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'recovered_users.json'), 'utf8'));

console.log(`Starting simulation targeting ${SERVER_URL} with speed factor ${SPEED_FACTOR}x`);
console.log(`Loaded ${users.length} users and ${events.length} events to simulate.`);

// Helper for HTTP POST
function postData(endpoint, data) {
    return new Promise((resolve, reject) => {
        const url = new URL(SERVER_URL + endpoint);
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(options, res => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(body);
                } else {
                    reject(new Error(`Status ${res.statusCode}: ${body}`));
                }
            });
        });
        req.on('error', reject);
        req.write(JSON.stringify(data));
        req.end();
    });
}

async function run() {
    // 1. Register users initially
    console.log("Registering users...");
    for (const u of users) {
        try {
            await postData('/api/users', {
                email: u.email,
                name: u.name,
                emailConsent: u.emailConsent
            });
        } catch (e) {
            console.warn(`Failed to simulate registration for ${u.email}: ${e.message}`);
        }
    }
    console.log("Registration complete.");

    if (events.length === 0) return;

    // 2. Playback events
    console.log("Starting event replay...");
    let firstEventTime = new Date(events[0].timestamp).getTime();
    let virtualStartTime = Date.now();

    for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        const eventTime = new Date(ev.timestamp).getTime();
        
        if (SPEED_FACTOR > 0) {
            const timeOffsetReal = eventTime - firstEventTime;
            const timeOffsetSimulated = timeOffsetReal / SPEED_FACTOR;
            const targetTime = virtualStartTime + timeOffsetSimulated;
            const delay = targetTime - Date.now();
            
            if (delay > 0) {
                await new Promise(r => setTimeout(r, delay));
            }
        }

        // Map log event to API payload
        const payload = {
            userId: ev.userId,
            userName: ev.userName,
            category: ev.category,
            value: ev.value,
            trackId: ev.trackId,
            colorRgba: ev.colorRgba,
            colorName: ev.colorName,
            mood: ev.mood,
            reactionLabel: ev.reactionLabel,
            note: ev.note
        };

        try {
            // Note: If you want to simulate track changes, the server's state needs to match. 
            // In the real app, track changes are driven by Admin. 
            // But here, we can just forcefully push events. They will append to events_log.jsonl.
            await postData('/api/events', payload);
            if (SPEED_FACTOR > 0 || i % 100 === 0) {
               console.log(`[${i+1}/${events.length}] Emitted ${ev.category} for ${ev.trackId} by ${ev.userName}`);
            }
        } catch (e) {
            console.error(`Error emitting event: ${e.message}`);
        }
    }
    
    console.log("Simulation finished!");
}

run().catch(console.error);
