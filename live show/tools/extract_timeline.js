const fs = require('fs');
const path = require('path');

const mergedLogPath = path.join(__dirname, '..', 'extracted_logs', 'logs', 'full_capture_merged.log');
const outputTimelinePath = path.join(__dirname, '..', 'post_show_analysis', 'track_timeline.csv');
const outputJsonPath = path.join(__dirname, '..', 'post_show_analysis', 'track_timeline.json');

if (!fs.existsSync(mergedLogPath)) {
    console.error("Merged log not found.");
    process.exit(1);
}

const content = fs.readFileSync(mergedLogPath, 'utf8');
const lines = content.split('\n');

const mappingsPath = path.join(__dirname, 'track_mappings.json');
let trackMappings = {};
if (fs.existsSync(mappingsPath)) {
    trackMappings = JSON.parse(fs.readFileSync(mappingsPath, 'utf8'));
}

const timeline = {};
let currentActiveTrackId = null;
let sequenceIdCounter = 1;

// Regex to capture events
const eventStartRegex = /Recorded event:\s*\{/;
const autoEndRegex = /\[Track\] Auto-ending current track (trk_[a-zA-Z0-9_]+)/;

let insideEvent = false;
let currentEventBlock = "";
let currentLineTimestamp = null;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const spaceIdx = line.indexOf(' ');
    let timestamp = null;
    let logText = line;

    if (spaceIdx !== -1 && line.substring(0, spaceIdx).includes('T')) {
        timestamp = line.substring(0, spaceIdx);
        logText = line.substring(spaceIdx + 1);
    }
    
    if (timestamp) {
        currentLineTimestamp = timestamp;
    }

    // Check for auto-end marker
    const autoEndMatch = autoEndRegex.exec(logText);
    if (autoEndMatch) {
        const endedTrackId = autoEndMatch[1];
        if (timeline[endedTrackId]) {
            timeline[endedTrackId].explicitEndTime = currentLineTimestamp;
        }
        continue;
    }

    // Parse event blocks
    if (eventStartRegex.test(logText)) {
        insideEvent = true;
        currentEventBlock = logText + "\n";
        continue;
    }

    if (insideEvent) {
        currentEventBlock += logText + "\n";
        if (logText.trim() === '}') {
            insideEvent = false;
            
            // Extract trackId, title, timestamp from block
            const trackIdMatch = currentEventBlock.match(/trackId:\s*'([^']+)'/);
            const trackTitleMatch = currentEventBlock.match(/trackTitle:\s*'([^']+)'/);
            const tsMatch = currentEventBlock.match(/timestamp:\s*'([^']+)'/);
            
            if (trackIdMatch) {
                const trackId = trackIdMatch[1];
                const trackTitle = trackTitleMatch ? trackTitleMatch[1] : "Unknown";
                const eventTs = tsMatch ? tsMatch[1] : currentLineTimestamp;
                
                if (!timeline[trackId]) {
                    timeline[trackId] = {
                        sequenceId: sequenceIdCounter++, // Preserves general order of appearance
                        trackId: trackId,
                        trackTitle: trackTitle,
                        firstEventTime: eventTs,
                        lastEventTime: eventTs,
                        explicitEndTime: null,
                        eventCount: 0
                    };
                }
                
                const t = timeline[trackId];
                t.eventCount++;
                
                if (new Date(eventTs) < new Date(t.firstEventTime)) t.firstEventTime = eventTs;
                if (new Date(eventTs) > new Date(t.lastEventTime)) t.lastEventTime = eventTs;
            }
        }
    }
}

// Convert back to array, sorted by sequence point of origin
const timelineArray = Object.values(timeline).sort((a,b) => a.sequenceId - b.sequenceId);

for (const seg of timelineArray) {
    seg.endTime = seg.explicitEndTime ? seg.explicitEndTime : seg.lastEventTime;
    seg.startTime = seg.firstEventTime;
    
    try {
       seg.durationSecs = Math.round((new Date(seg.endTime).getTime() - new Date(seg.startTime).getTime()) / 1000);
    } catch(e) {
       seg.durationSecs = 0;
    }
}

// Apply Track Mappings & Merge
const mergedTimeline = {};
for (const seg of timelineArray) {
    const originalTrackId = seg.trackId;
    let finalId = originalTrackId;
    let finalTitle = seg.trackTitle;
    
    if (trackMappings[originalTrackId]) {
        finalId = trackMappings[originalTrackId].mappedId;
        finalTitle = trackMappings[originalTrackId].mappedTitle;
    }
    
    if (!mergedTimeline[finalId]) {
        mergedTimeline[finalId] = {
            sequenceId: seg.sequenceId, // Keep earliest sequenceId
            trackId: finalId,
            trackTitle: finalTitle,
            firstEventTime: seg.startTime,
            lastEventTime: seg.lastEventTime,
            explicitEndTime: seg.explicitEndTime,
            eventCount: seg.eventCount,
            startTime: seg.startTime,
            endTime: seg.endTime,
            durationSecs: seg.durationSecs
        };
    } else {
        const m = mergedTimeline[finalId];
        m.eventCount += seg.eventCount;
        if (new Date(seg.startTime) < new Date(m.startTime)) m.startTime = seg.startTime;
        if (new Date(seg.endTime) > new Date(m.endTime)) m.endTime = seg.endTime;
        
        try {
           m.durationSecs = Math.round((new Date(m.endTime).getTime() - new Date(m.startTime).getTime()) / 1000);
        } catch(e) {
           m.durationSecs = 0;
        }
    }
}

const finalTimelineArray = Object.values(mergedTimeline).sort((a,b) => a.sequenceId - b.sequenceId);

// Generate CSV
const csvRows = ['"SequenceID","TrackTitle","TrackID","StartTime","EndTime","DurationSecs","TotalEvents"'];
for (const seg of finalTimelineArray) {
    csvRows.push(`${seg.sequenceId},"${seg.trackTitle}","${seg.trackId}","${seg.startTime}","${seg.endTime}",${seg.durationSecs},${seg.eventCount}`);
}

fs.writeFileSync(outputTimelinePath, csvRows.join('\n') + '\n', 'utf8');
fs.writeFileSync(outputJsonPath, JSON.stringify(finalTimelineArray, null, 2), 'utf8');
fs.writeFileSync(outputJsonPath + '.js', 'window.timelineDataExport = \n' + JSON.stringify(finalTimelineArray, null, 2) + '\n;', 'utf8');

console.log(`Successfully generated timeline for ${finalTimelineArray.length} unique tracks.`);
console.log(`Saved CSV to ${outputTimelinePath}`);
console.log(`Saved JSON to ${outputJsonPath}`);
