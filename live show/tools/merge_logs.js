const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, '..', 'extracted_logs', 'logs');
const files = fs.readdirSync(logsDir).filter(f => f.startsWith('capture_') && f.endsWith('.log'));
files.sort(); // Sorting capture_1, capture_2, etc. (lexicographical is fine for 1-9)

console.log(`Found ${files.length} capture log files:`, files);

const uniqueLines = new Set();
let totalProcessedLines = 0;

for (const file of files) {
    const filePath = path.join(logsDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    let addedFromThisFile = 0;
    
    for (const line of lines) {
        if (!line.trim()) continue;
        totalProcessedLines++;
        if (!uniqueLines.has(line)) {
            uniqueLines.add(line);
            addedFromThisFile++;
        }
    }
    console.log(`Processed ${file}: ${lines.length} lines, added ${addedFromThisFile} unique lines.`);
}

console.log(`\nTotal lines processed: ${totalProcessedLines}`);
console.log(`Total unique lines after deduplication: ${uniqueLines.size}`);

// Convert to array and sort chronologically based on the Render timestamp prefix
// Example prefix: "2026-03-12T23:45:08.715209019Z "
const sortedLines = Array.from(uniqueLines).sort((a, b) => {
    // Extract everything up to the first space (the timestamp)
    const timeA = a.substring(0, a.indexOf(' '));
    const timeB = b.substring(0, b.indexOf(' '));
    if (timeA < timeB) return -1;
    if (timeA > timeB) return 1;
    return 0;
});

const outputFilePath = path.join(logsDir, 'full_capture_merged.log');
fs.writeFileSync(outputFilePath, sortedLines.join('\n') + '\n', 'utf8');

console.log(`\nSuccessfully saved merged logs to ${outputFilePath}`);

// Perform validation on gaps
console.log(`\nChecking for major time gaps in the merged log (threshold: > 5 minutes)...`);
const gaps = [];
const thresholdMs = 5 * 60 * 1000; 

let lastTimestampMs = null;
let lastLogLine = "";

for (let i = 0; i < sortedLines.length; i++) {
    const line = sortedLines[i];
    const timeStr = line.substring(0, line.indexOf(' '));
    
    // Check if timeStr is actually a valid date string (some lines might not follow the format if they were wrapped unexpectedly, though Render prefixes all)
    try {
        const dateObj = new Date(timeStr);
        if (isNaN(dateObj.getTime())) continue; // Skip if invalid

        const currentMs = dateObj.getTime();
        
        if (lastTimestampMs !== null) {
            const diff = currentMs - lastTimestampMs;
            if (diff > thresholdMs) {
                gaps.push({
                    start: new Date(lastTimestampMs).toISOString(),
                    end: new Date(currentMs).toISOString(),
                    durationSec: (diff / 1000).toFixed(1)
                });
            }
        }
        
        lastTimestampMs = currentMs;
        lastLogLine = line;
    } catch (e) {
        // Ignore lines that fail to parse
    }
}

if (gaps.length > 0) {
    console.warn(`\nFound ${gaps.length} gaps > 5 minutes!`);
    
    const timeOptsLocal = { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'medium' };
    const timeOptsUTC = { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'medium' };

    gaps.forEach((gap, index) => {
        const startObj = new Date(gap.start);
        const endObj = new Date(gap.end);
        
        console.warn(`  Gap ${index + 1}: Duration ${gap.durationSec}s`);
        console.warn(`    UTC:   ${startObj.toLocaleString('en-US', timeOptsUTC)}  ->  ${endObj.toLocaleString('en-US', timeOptsUTC)}`);
        console.warn(`    Local: ${startObj.toLocaleString('en-US', timeOptsLocal)}  ->  ${endObj.toLocaleString('en-US', timeOptsLocal)}`);
    });
} else {
    console.log(`\nSUCCESS: No gaps larger than 5 minutes were found in the merged log!`);
}
