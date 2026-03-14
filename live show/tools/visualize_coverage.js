const fs = require('fs');
const path = require('path');

const logPath = path.join(__dirname, '..', 'extracted_logs', 'logs', 'full_capture_merged.log');
const artifactPath = path.join('/home/benczech/.gemini/antigravity/brain/ba9d20b7-64fe-4640-907b-73127c60cae6', 'log_coverage_visualization.md');

const logs = fs.readFileSync(logPath, 'utf8').split('\n');

// 7 PM to 9 PM EDT on 3/12 is 23:00 to 01:00 UTC on 3/12 - 3/13
// Local Time: 3/12/26 19:00:00 - 21:00:00 EDT (UTC-4)
const windowStartStrLocal = "2026-03-12T19:00:00-04:00";
const windowEndStrLocal = "2026-03-12T21:00:00-04:00";
const windowStart = new Date(windowStartStrLocal).getTime();
const windowEnd = new Date(windowEndStrLocal).getTime();

const minuteBins = {};
for (let i = 0; i < 120; i++) {
    minuteBins[i] = 0;
}

let activePeriods = [];
let currentPeriod = null;

let lastValidTime = null;

for (const line of logs) {
    if (!line.trim()) continue;
    const spaceIdx = line.indexOf(' ');
    if (spaceIdx === -1) continue;
    const timeStr = line.substring(0, spaceIdx);
    
    // Quick sanity check standard zulu timestamp
    if (timeStr.includes('T') && timeStr.endsWith('Z')) {
        const timeMs = new Date(timeStr).getTime();
        if (isNaN(timeMs)) continue;
        
        lastValidTime = timeMs;
        
        if (timeMs >= windowStart && timeMs <= windowEnd) {
            const minuteIndex = Math.floor((timeMs - windowStart) / 60000);
            if (minuteIndex >= 0 && minuteIndex < 120) {
                minuteBins[minuteIndex]++;
            }
            
            if (!currentPeriod) {
                currentPeriod = { start: timeMs, end: timeMs, startIdx: minuteIndex };
            } else {
                if (timeMs - currentPeriod.end > 2 * 60000) { // Gap > 2 minute
                    activePeriods.push(currentPeriod);
                    currentPeriod = { start: timeMs, end: timeMs, startIdx: minuteIndex };
                } else {
                    currentPeriod.end = timeMs;
                }
            }
        }
    }
}
if (currentPeriod) activePeriods.push(currentPeriod);

// Build markdown visualization
let md = `# Log Coverage Visualization (7:00 PM - 9:00 PM EDT)\n\n`;
md += `This visualizes the event log density and the specific gaps during your 3/12/26 show between 7:00 PM and 9:00 PM.\n\n`;

md += `## Time Coverage Overview\n`;
md += "```mermaid\ngantt\n";
md += "    title Active Log Recording Windows (7:00 PM - 9:00 PM)\n";
md += "    dateFormat  YYYY-MM-DD HH:mm:ss\n";
md += "    axisFormat  %H:%M\n";

if (activePeriods.length > 0) {
    activePeriods.forEach((p, idx) => {
        const startLocal = new Date(p.start).toLocaleString('en-CA', { timeZone: 'America/New_York', hour12: false}).replace(',', '');
        const endLocal = new Date(p.end).toLocaleString('en-CA', { timeZone: 'America/New_York', hour12: false}).replace(',', '');
        
        md += `    Active Logs Block ${idx + 1} :a${idx}, ${startLocal}, ${endLocal}\n`;
    });
} else {
    md += "    No logs :a1, 2026-03-12 19:00:00, 2026-03-12 21:00:00\n";
}
md += "```\n\n";

md += `## Show Gaps (During this window)\n`;
// Calculate actual gaps between periods and borders
const bordersAndPeriods = [];
if (activePeriods.length === 0 || activePeriods[0].start > windowStart) {
    const endGap = activePeriods.length > 0 ? activePeriods[0].start : windowEnd;
    bordersAndPeriods.push({ type: 'gap', start: windowStart, end: endGap });
}
for (let i = 0; i < activePeriods.length; i++) {
    if (i > 0) {
        bordersAndPeriods.push({ type: 'gap', start: activePeriods[i-1].end, end: activePeriods[i].start });
    }
    bordersAndPeriods.push({ type: 'active', start: activePeriods[i].start, end: activePeriods[i].end });
}
if (activePeriods.length > 0 && activePeriods[activePeriods.length - 1].end < windowEnd) {
    bordersAndPeriods.push({ type: 'gap', start: activePeriods[activePeriods.length - 1].end, end: windowEnd });
}

bordersAndPeriods.forEach(b => {
    if (b.type === 'gap' && (b.end - b.start) > 60000) { // Only log gaps > 1min
         const s = new Date(b.start).toLocaleTimeString('en-US', { timeZone: 'America/New_York' });
         const e = new Date(b.end).toLocaleTimeString('en-US', { timeZone: 'America/New_York' });
         const mins = ((b.end - b.start) / 60000).toFixed(1);
         md += `- ⚠️ **GAP**: ${s} to ${e} (${mins} minutes missing)\n`;
    } else if (b.type === 'active') {
         const s = new Date(b.start).toLocaleTimeString('en-US', { timeZone: 'America/New_York' });
         const e = new Date(b.end).toLocaleTimeString('en-US', { timeZone: 'America/New_York' });
         const mins = ((b.end - b.start) / 60000).toFixed(1);
         md += `- ✅ **LOGS**: ${s} to ${e} (${mins} minutes tracked)\n`;
    }
});

fs.writeFileSync(artifactPath, md, 'utf8');
console.log(`Generated Log Visualization at ${artifactPath}`);
