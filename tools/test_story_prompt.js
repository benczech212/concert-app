const https = require('https');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

// Load config.yaml
let config = {};
try {
  const fileContents = fs.readFileSync(path.join(__dirname, '..', 'config.yaml'), 'utf8');
  config = yaml.load(fileContents);
} catch (e) {
  console.error("Failed to load config.yaml:", e);
}

const geminiApiKey = process.env.GEMINI_API_KEY || "AIzaSyD... (truncated for safety)";
if (!geminiApiKey) {
  console.error("Error: GEMINI_API_KEY environment variable is not set.");
  process.exit(1);
}

const STORY_MODEL = (config.ai_models && config.ai_models.story_model) ? config.ai_models.story_model : 'gemini-2.5-flash';

// Fake Track Data matching the server.js structure
const data = {
  title: "Neon Dreams",
  reactions: { meh: 2, like: 15, applause: 42 },
  words: ["electric", "vibrant", "energetic", "fast", "fun", "electric", "neon", "bright", "loud"],
  colors: { "Cyan": 12, "Magenta": 8, "Yellow": 2, "Blue": 10 },
  moods: { "Anticipation": 10, "Joy": 18, "Power": 15, "Chaos": 5 },
  minutes: {
    0: { moods: { "Anticipation": 5 }, colors: { "Cyan": 4 } },
    1: { moods: { "Joy": 6, "Power": 2 }, colors: { "Cyan": 4, "Blue": 3 } },
    2: { moods: { "Joy": 8, "Power": 5 }, colors: { "Magenta": 5, "Blue": 4 } },
    3: { moods: { "Power": 8, "Chaos": 5 }, colors: { "Magenta": 3, "Cyan": 4 } }
  }
};

const getAllWords = [...new Set(data.words)].join(', ');

// Top 5 overall moods
const topMoods = Object.entries(data.moods).sort((a,b) => b[1] - a[1]).slice(0, 5).map(x => x[0]).join(', ');

// Top 2 overall colors
const topColors = Object.entries(data.colors).sort((a,b) => b[1] - a[1]).slice(0, 2).map(x => x[0]).join(', ');

// Minute by minute summary
const minuteKeys = Object.keys(data.minutes).map(Number).sort((a,b) => a - b);
let timelineOverview = [];
for (const m of minuteKeys) {
   const mData = data.minutes[m];
   const topMinMods = Object.entries(mData.moods).sort((a,b) => b[1] - a[1]).slice(0, 2).map(x => x[0]);
   const topMinCol = Object.entries(mData.colors).sort((a,b) => b[1] - a[1]).slice(0, 1).map(x => x[0]);
   let parts = [];
   if (topMinMods.length) parts.push(`Moods: ${topMinMods.join(', ')}`);
   if (topMinCol.length) parts.push(`Top Color: ${topMinCol[0]}`);
   if (parts.length) {
     timelineOverview.push(`Minute ${m+1}: ${parts.join(' | ')}`);
   }
}
const timelineStr = timelineOverview.join('\n');

const prompt = `You are a creative storyteller. A live audience just listened to a musical track titled "${data.title}".
During the performance, they interacted using an app. Here is their aggregated data:

OVERALL TRACK SUMMARY:
- Applause: ${data.reactions.applause}
- Likes: ${data.reactions.like}
- Meh/Neutral: ${data.reactions.meh}
- Top 5 overall moods felt: ${topMoods || "none specified"}
- Top 2 overall colors felt: ${topColors || "none specified"}
- All words submitted to describe it: ${getAllWords || "none submitted"}

MINUTE-BY-MINUTE TRAJECTORY:
${timelineStr || "no timeline data"}

Based on this audience reaction, generate two things:
1. A creative, evocative new name for this performance of the track, based largely on the overall track summary (top 5 moods and top 2 colors).
2. A short (2-3 sentences) poetic description/story that traces the audience's journey using the minute-by-minute trajectory and the submitted words.

Output format should be JSON exactly like this, no markdown formatting:
{
  "newName": "The Generated Name",
  "story": "The generated story."
}`;

console.log("=========================================");
console.log(`MODEL: ${STORY_MODEL}`);
console.log("=========================================\n");
console.log("=== THE GENERATED PROMPT ===");
console.log(prompt);
console.log("\n============================\n");

console.log(`Sending to Gemini API (${STORY_MODEL})...\n`);

const payload = JSON.stringify({
  contents: [{ parts: [{ text: prompt }] }]
});

const req = https.request({
  hostname: 'generativelanguage.googleapis.com',
  path: `/v1beta/models/${STORY_MODEL}:generateContent?key=${encodeURIComponent(geminiApiKey.trim())}`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
}, (res) => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
       const geminiData = JSON.parse(body);
       let rawText = geminiData.candidates && geminiData.candidates[0] && geminiData.candidates[0].content && geminiData.candidates[0].content.parts && geminiData.candidates[0].content.parts[0] ? geminiData.candidates[0].content.parts[0].text : "";
       
       if (rawText.startsWith('\`\`\`json')) {
          rawText = rawText.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
       } else if (rawText.startsWith('\`\`\`')) {
          rawText = rawText.replace(/\`\`\`/g, '').trim();
       }
       
       console.log("=== API RESPONSE ===");
       try {
           const parsed = JSON.parse(rawText);
           console.log(JSON.stringify(parsed, null, 2));
       } catch (e) {
           console.log("Failed to parse JSON. Raw output was:");
           console.log(rawText);
       }
    } else {
       console.error(`Gemini API Error ${res.statusCode}:`);
       console.error(body);
    }
  });
});
req.on('error', (e) => {
  console.error("Request failed: ", e);
});
req.write(payload);
req.end();
