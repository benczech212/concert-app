const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, '..', 'extracted_logs', 'logs');
const mergedLogPath = path.join(logsDir, 'full_capture_merged.log');

const content = fs.readFileSync(mergedLogPath, 'utf8');

// Strip the Render timestamps to reconstruct the original log stream
const lines = content.split('\n');
const cleanLines = lines.map(line => {
    const spaceIdx = line.indexOf(' ');
    if (spaceIdx !== -1 && line.substring(0, spaceIdx).includes('T')) {
        return line.substring(spaceIdx + 1);
    }
    return line;
});
const rawLogs = cleanLines.join('\n');

const mappingsPath = path.join(__dirname, 'track_mappings.json');
let trackMappings = {};
if (fs.existsSync(mappingsPath)) {
    trackMappings = JSON.parse(fs.readFileSync(mappingsPath, 'utf8'));
}

// 1. Extract Users
const usersMap = {};
const registeredUserRegex = /Registered user:\s*\{([^}]+)\}/g;
let match;
while ((match = registeredUserRegex.exec(rawLogs)) !== null) {
  const block = match[1];
  const emailMatch = block.match(/email:\s*'([^']+)'/);
  const nameMatch = block.match(/name:\s*'([^']+)'/);
  const emailConsentMatch = block.match(/emailConsent:\s*(true|false)/);
  const lastSeenMatch = block.match(/lastSeen:\s*'([^']+)'/);
  
  if (emailMatch) {
    const email = emailMatch[1];
    usersMap[email] = {
      email,
      name: nameMatch ? nameMatch[1] : 'Unknown',
      consent: emailConsentMatch ? emailConsentMatch[1] : 'false',
      lastSeen: lastSeenMatch ? lastSeenMatch[1] : ''
    };
  }
}

const usersCsvRows = ['"Email","Name","Consented","LastSeen"'];
for (const email in usersMap) {
    const u = usersMap[email];
    usersCsvRows.push(`"${u.email}","${u.name}","${u.consent}","${u.lastSeen}"`);
}
fs.writeFileSync(path.join(__dirname, '..', 'post_show_analysis', 'users_export.csv'), usersCsvRows.join('\n') + '\n');
console.log(`Exported ${Object.keys(usersMap).length} unique users to post_show_analysis/users_export.csv`);

// 2. Extract Interactions
const events = [];
const eventRegex = /Recorded event:\s*\{([^}]+)\}/g;

while ((match = eventRegex.exec(rawLogs)) !== null) {
    const block = match[1];
    const extractStr = (key) => {
        // match key: 'val'
        const reg = new RegExp(`${key}:\\s*'([^']+)'`);
        const m = block.match(reg);
        return m ? m[1] : '';
    };
    const extractNum = (key) => {
        // match key: 4
        const reg = new RegExp(`${key}:\\s*([0-9]+)`);
        const m = block.match(reg);
        return m ? m[1] : '';
    };

    const ev = {
        timestamp: extractStr('timestamp'),
        userId: extractStr('userId'),
        userName: extractStr('userName'),
        category: extractStr('category'),
        value: extractStr('value') || extractNum('value') || extractStr('reactionLabel'), // values can be 'Sapphire', '4', 'skipped', 'like'
        trackId: extractStr('trackId'),
        trackTitle: extractStr('trackTitle'),
        colorName: extractStr('colorName') || extractStr('value'), // fallback to value if it's a color event
        colorRgba: extractStr('colorRgba'),
        mood: extractStr('mood'),
        reactionLabel: extractStr('reactionLabel'),
        note: extractStr('note')
    };
    
    // For specific categories, tidy up the value field
    if (ev.category === 'color') {
        ev.colorName = ev.value;
    } else if (ev.category === 'mood') {
        ev.mood = ev.value;
    } else if (ev.category === 'reaction') {
        ev.reactionLabel = ev.value;
    }

    events.push(ev);
}

// Write to CSV
const interactionsCsvRows = ['"Timestamp","LocalTime","TrackID","TrackTitle","UserID","Category","Value","ColorName","Mood","ReactionLabel","Note"'];

events.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

events.forEach(ev => {
    let finalId = ev.trackId;
    let finalTitle = ev.trackTitle;
    
    if (finalId && trackMappings[finalId] && trackMappings[finalId].mappedId) {
        finalTitle = trackMappings[finalId].mappedTitle || finalTitle;
        finalId = trackMappings[finalId].mappedId;
    }
    
    // We rewrite the in-memory event so it gets saved correctly to simulation_events.json as well
    ev.trackId = finalId;
    ev.trackTitle = finalTitle;

    let colorName = ev.colorName || '';
    let mood = ev.mood || '';
    let reactionLabel = ev.reactionLabel || '';
    let note = ev.note ? ev.note.replace(/"/g, '""') : ''; // Escape quotes for CSV
    
    // Create excel friendly time
    let localTime = '';
    try {
        localTime = new Date(ev.timestamp).toLocaleString('en-US', { timeZone: 'America/New_York' });
    } catch(e) {}

    interactionsCsvRows.push(`"${ev.timestamp}","${localTime}","${ev.trackId}","${ev.trackTitle}","${ev.userId}","${ev.category}","${ev.value}","${colorName}","${mood}","${reactionLabel}","${note}"`);
});

fs.writeFileSync(path.join(__dirname, '..', 'post_show_analysis', 'interactions_export.csv'), interactionsCsvRows.join('\n') + '\n');
console.log(`Exported ${events.length} interaction events to post_show_analysis/interactions_export.csv`);

fs.writeFileSync(path.join(__dirname, '..', 'untouched_data', 'simulation_events.json'), JSON.stringify(events, null, 2));
console.log(`Saved simulation_events.json to untouched_data folder with ${events.length} events.`);
