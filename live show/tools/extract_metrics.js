const fs = require('fs');
const path = require('path');

const eventsPath = path.join(__dirname, '..', 'untouched_data', 'simulation_events.json');
const outputPath = path.join(__dirname, '..', 'post_show_analysis', 'track_metrics.json');
const outputCsvPath = path.join(__dirname, '..', 'post_show_analysis', 'track_metrics_summary.csv');

if (!fs.existsSync(eventsPath)) {
    console.error("Simulation events not found. Run extract_data.js first.");
    process.exit(1);
}

const events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));

// Apply track mappings for post-processing combinations
const mappingsPath = path.join(__dirname, 'track_mappings.json');
let trackMappings = {};
if (fs.existsSync(mappingsPath)) {
    trackMappings = JSON.parse(fs.readFileSync(mappingsPath, 'utf8'));
    events.forEach(ev => {
        if (ev.trackId && trackMappings[ev.trackId]) {
            ev.trackId = trackMappings[ev.trackId].mappedId;
            if (ev.trackTitle) {
                ev.trackTitle = trackMappings[ev.trackId].mappedTitle;
            }
        }
    });
}

// We want to track:
// - Total users engaged (unique per track)
// - Total events per category
// - Histogram of events over time (into 10-second buckets, for example)
// - Most popular color, mood, reaction per track
const tracks = {};
const userStats = {};
const colorHexMap = {};

for (const ev of events) {
    if (!tracks[ev.trackId]) {
        tracks[ev.trackId] = {
            id: ev.trackId,
            title: ev.trackTitle,
            startTime: new Date(ev.timestamp).getTime(),
            endTime: new Date(ev.timestamp).getTime(), // Will expand
            totalEvents: 0,
            uniqueUsers: new Set(),
            categories: { color: 0, mood: 0, reaction: 0, note: 0, combined_reaction: 0, note_skip: 0 },
            histogram: {}, // key: second offset, val: count
            itemHistograms: {}, // key: item value, val: { bucket: count }
            colors: {},
            moods: {},
            reactions: {},
            notesList: []
        };
    }
    
    const t = tracks[ev.trackId];
    const evTime = new Date(ev.timestamp).getTime();
    
    if (evTime < t.startTime) t.startTime = evTime;
    if (evTime > t.endTime) t.endTime = evTime;
    
    t.totalEvents++;
    t.uniqueUsers.add(ev.userId || 'anonymous');
    t.categories[ev.category] = (t.categories[ev.category] || 0) + 1;
    
    // Fallback logic the same as generation script
    if (ev.category === 'color') {
        t.colors[ev.value] = (t.colors[ev.value] || 0) + 1;
        if (ev.colorRgba) colorHexMap[ev.value] = ev.colorRgba;
    }
    else if (ev.category === 'mood') t.moods[ev.value] = (t.moods[ev.value] || 0) + 1;
    else if (ev.category === 'reaction') t.reactions[ev.value] = (t.reactions[ev.value] || 0) + 1;
    else if (ev.category === 'note' && ev.value) t.notesList.push({time: evTime, note: ev.value, uid: ev.userId});
    else if (ev.category === 'combined_reaction') {
        if (ev.colorName && ev.colorName !== 'None') {
            t.colors[ev.colorName] = (t.colors[ev.colorName] || 0) + 1;
            if (ev.colorRgba) colorHexMap[ev.colorName] = ev.colorRgba;
        }
        if (ev.mood && ev.mood !== 'None') t.moods[ev.mood] = (t.moods[ev.mood] || 0) + 1;
        if (ev.reactionLabel && ev.reactionLabel !== 'None') t.reactions[ev.reactionLabel] = (t.reactions[ev.reactionLabel] || 0) + 1;
        if (ev.note && ev.note !== 'None') t.notesList.push({time: evTime, note: ev.note, uid: ev.userId});
    }

    // Accumulate user stats
    const uid = ev.userId || 'anonymous';
    if (!userStats[uid]) {
        userStats[uid] = {
            userId: uid,
            userName: ev.userName || 'Anonymous',
            email: ev.email || '',
            totalInteractions: 0,
            tracksInteracted: new Set(),
            colors: {},
            moods: {},
            reactions: {},
            notesCount: 0,
            firstSeen: evTime,
            lastSeen: evTime
        };
    }
    const u = userStats[uid];
    u.totalInteractions++;
    u.tracksInteracted.add(ev.trackId);
    
    if (evTime < u.firstSeen) u.firstSeen = evTime;
    if (evTime > u.lastSeen) u.lastSeen = evTime;

    const trackUserItem = (cat, val) => {
        if (!val || val === 'None') return;
        u[cat][val] = (u[cat][val] || 0) + 1;
    }

    if (ev.category === 'color') trackUserItem('colors', ev.value);
    else if (ev.category === 'mood') trackUserItem('moods', ev.value);
    else if (ev.category === 'reaction') trackUserItem('reactions', ev.value);
    else if (ev.category === 'note' && ev.value) u.notesCount++;
    else if (ev.category === 'combined_reaction') {
        trackUserItem('colors', ev.colorName);
        trackUserItem('moods', ev.mood);
        trackUserItem('reactions', ev.reactionLabel);
        if (ev.note && ev.note !== 'None') u.notesCount++;
    }
}

// Post-Processing
const resultsDb = [];
const summaryRows = [];
const header = ["TrackTitle", "TrackID", "DurationSec", "TotalEvents", "UniqueUsers", "MostPopularColor", "MostPopularMood", "MostPopularReaction", "TotalNotes"];
summaryRows.push(header.join(','));

function getHighest(obj) {
    let highestKey = 'None';
    let highestVal = 0;
    for (const [k, v] of Object.entries(obj)) {
        if (v > highestVal) {
            highestVal = v;
            highestKey = k;
        }
    }
    return `${highestKey} (${highestVal})`;
}

// Second pass for time histograms (now that we know the absolute minimum startTime per track)
for (const ev of events) {
    const t = tracks[ev.trackId];
    const evTime = new Date(ev.timestamp).getTime();
    // 10-second bucket resolution
    const offsetSeconds = Math.floor((evTime - t.startTime) / 1000);
    const bucket = Math.floor(offsetSeconds / 10) * 10;
    t.histogram[bucket] = (t.histogram[bucket] || 0) + 1;
    
    const trackItem = (itemName) => {
        if (!itemName || itemName === 'None') return;
        if (!t.itemHistograms[itemName]) t.itemHistograms[itemName] = {};
        t.itemHistograms[itemName][bucket] = (t.itemHistograms[itemName][bucket] || 0) + 1;
    };

    if (ev.category === 'color') trackItem(ev.value);
    else if (ev.category === 'mood') trackItem(ev.value);
    else if (ev.category === 'reaction') trackItem(ev.value);
    else if (ev.category === 'combined_reaction') {
        trackItem(ev.colorName);
        trackItem(ev.mood);
        trackItem(ev.reactionLabel);
    }
}

for (const [id, t] of Object.entries(tracks)) {
    // Transform Set to array length
    t.uniqueUsersCount = t.uniqueUsers.size;
    t.uniqueUsers = Array.from(t.uniqueUsers);
    t.durationSecs = Math.round((t.endTime - t.startTime) / 1000);
    
    // Sort histogram keys
    const sortedHistogram = {};
    Object.keys(t.histogram).sort((a,b) => parseInt(a)-parseInt(b)).forEach(k => {
        sortedHistogram[`${k}s`] = t.histogram[k];
    });
    t.histogram = sortedHistogram;

    for (const [itemName, hist] of Object.entries(t.itemHistograms)) {
        const sortedItemHist = {};
        Object.keys(hist).sort((a,b) => parseInt(a)-parseInt(b)).forEach(k => {
            sortedItemHist[`${k}s`] = hist[k];
        });
        t.itemHistograms[itemName] = sortedItemHist;
    }

    const seenNotes = new Set();
    const finalNotes = [];
    t.notesList.sort((a, b) => a.time - b.time).forEach(n => {
        const key = n.uid + '|' + n.note.toLowerCase().trim();
        if (!seenNotes.has(key)) {
            seenNotes.add(key);
            finalNotes.push({ text: n.note, uid: n.uid });
        }
    });
    t.notesList = finalNotes;

    resultsDb.push(t);
    
    const row = [
        `"${t.title}"`,
        `"${t.id}"`,
        t.durationSecs,
        t.totalEvents,
        t.uniqueUsersCount,
        `"${getHighest(t.colors)}"`,
        `"${getHighest(t.moods)}"`,
        `"${getHighest(t.reactions)}"`,
        t.notesList.length
    ];
    summaryRows.push(row.join(','));
}

const userResults = Object.values(userStats).map(u => {
    u.tracksInteractedCount = u.tracksInteracted.size;
    u.tracksInteracted = Array.from(u.tracksInteracted);
    // Sort nested dicts for easier reading
    const sortDict = (d) => Object.fromEntries(Object.entries(d).sort((a,b)=>b[1]-a[1]));
    u.colors = sortDict(u.colors);
    u.moods = sortDict(u.moods);
    u.reactions = sortDict(u.reactions);
    return u;
}).sort((a,b) => b.totalInteractions - a.totalInteractions);

fs.writeFileSync(outputPath, JSON.stringify(resultsDb, null, 2));
fs.writeFileSync(outputPath + '.js', 'window.metricsDataExport = \n' + JSON.stringify(resultsDb, null, 2) + '\n;\nwindow.colorHexMapExport = \n' + JSON.stringify(colorHexMap, null, 2) + '\n;');
fs.writeFileSync(outputCsvPath, summaryRows.join('\n') + '\n');
fs.writeFileSync(path.join(__dirname, '..', 'post_show_analysis', 'user_metrics.json'), JSON.stringify(userResults, null, 2));
fs.writeFileSync(path.join(__dirname, '..', 'post_show_analysis', 'user_metrics.json.js'), 'window.userMetricsExport = \n' + JSON.stringify(userResults, null, 2) + '\n;');

console.log(`Saved detailed track metrics to ${outputPath}`);
console.log(`Saved summary track metrics to ${outputCsvPath}`);
console.log(`Saved user metrics to user_metrics.json`);
