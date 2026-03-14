const fs = require('fs');
const path = require('path');
const https = require('https');

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey || apiKey.startsWith('encrypted:')) {
    console.error("Missing or Encrypted GEMINI_API_KEY in environment variables.");
    console.error("Please export the decrypted key before running, e.g.:");
    console.error("  export GEMINI_API_KEY=your_key && node generate_offline.js");
    process.exit(1);
}

const metricsPath = path.join(__dirname, '..', 'post_show_analysis', 'track_metrics.json');
const tracksList = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));

// Convert to dictionary matching old behavior
const tracks = {};
for (const trk of tracksList) {
    tracks[trk.id] = {
        id: trk.id,
        title: trk.title,
        startTime: new Date(trk.startTime).toISOString(),
        metrics: trk
    };
}

function callGeminiAPI(method, pathStr, payload) {
    return new Promise((resolve, reject) => {
        const payloadStr = JSON.stringify(payload);
        const options = {
            hostname: 'generativelanguage.googleapis.com',
            port: 443,
            path: pathStr + `?key=${apiKey}`,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payloadStr)
            }
        };

        const req = https.request(options, res => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(JSON.parse(body)); } 
                    catch(e) { reject(e); }
                } else {
                    reject(new Error(`API returned ${res.statusCode}: ${body}`));
                }
            });
        });

        req.on('error', reject);
        req.write(payloadStr);
        req.end();
    });
}

async function generateTrackStory(track) {
    console.log(`Generating story for ${track.title} (${track.id})...`);
    
    const m = track.metrics;
    const contextStr = `
Colors observed (in order of popularity): ${Object.entries(m.colors).sort((a,b)=>b[1]-a[1]).map(([k,v]) => `${k}(${v})`).join(', ')}
Moods felt: ${Object.entries(m.moods).sort((a,b)=>b[1]-a[1]).map(([k,v]) => `${k}(${v})`).join(', ')}
Reactions: ${Object.entries(m.reactions).sort((a,b)=>b[1]-a[1]).map(([k,v]) => `${k}(${v})`).join(', ')}
Specific words from audience: ${m.notesList.join(', ')}
Peak Interaction Time: The audience was most engaged ${m.histogram && Object.keys(m.histogram).length > 0 ? Object.keys(m.histogram)[0] : 'at the beginning' } into the track.
Total Unique Audience Members Engaged: ${m.uniqueUsersCount}
`.trim();
    
    if (Object.keys(m.colors).length === 0 && Object.keys(m.moods).length === 0 && m.notesList.length === 0) {
        console.log(`Skipping ${track.title}: insufficient data.`);
        return null;
    }

    const storyPrompt = `Based on the following audience reactions to a piece of improvised music:
${contextStr}

1. Create a short, evocative 3-5 sentence story connecting these elements about the emotional journey of the piece.
2. Provide a 2-4 word Title for the track based on this story.
Format output as: "Title: [title]\nStory: [story]" without markdown.`;

    const imgPrompt = `Based on these audience reactions to a piece of improvised music:
${contextStr}

Create a highly abstract, conceptual visual representation. Focus strictly on color, texture, mood, and abstract geometry. DO NOT include any recognizable subjects or objects. Only abstract art shapes and colors matching the provided themes.`;

    let generatedObj = {
        trackId: track.id,
        timestamp: track.startTime,
        trackData: m,
        title: track.title, 
        story: "Story generation failed.",
        imageBase64: null
    };

    try {
        console.log("Calling text model...");
        const textPayload = {
            contents: [{ parts: [{ text: storyPrompt }]}]
        };
        const textRes = await callGeminiAPI('POST', `/v1beta/models/gemini-2.5-flash:generateContent`, textPayload);
        const text = textRes.candidates && textRes.candidates[0] && textRes.candidates[0].content && textRes.candidates[0].content.parts ? textRes.candidates[0].content.parts[0].text : "";
        
        const titleMatch = text.match(/Title:\s*(.*)/i);
        const storyMatch = text.match(/Story:\s*([\s\S]*)/i);

        if (titleMatch) generatedObj.title = titleMatch[1].trim();
        if (storyMatch) generatedObj.story = storyMatch[1].trim();

        console.log("Calling image model...");
        const imgPayload = {
            instances: [{ prompt: imgPrompt }],
            parameters: {
                sampleCount: 1,
                aspectRatio: "1:1",
                outputOptions: { mimeType: "image/jpeg" }
            }
        };
        const imgRes = await callGeminiAPI('POST', `/v1/models/imagen-3.0-generate-002:predict`, imgPayload);
        
        if (imgRes.predictions && imgRes.predictions.length > 0) {
           generatedObj.imageBase64 = imgRes.predictions[0].bytesBase64Encoded;
           console.log("Image generation successful.");
           const imgPath = path.join(__dirname, 'extracted_logs', `${track.id}.jpg`);
           fs.writeFileSync(imgPath, Buffer.from(generatedObj.imageBase64, 'base64'));
        }

    } catch (e) {
        console.error(`Error generating for ${track.id}:`, e.message);
    }
    
    return generatedObj;
}

async function run() {
    const results = [];
    const dbPath = path.join(__dirname, 'extracted_logs', 'offline_stories.json');
    
    for (const trackId of Object.keys(tracks)) {
        const trk = tracks[trackId];
        const res = await generateTrackStory(trk);
        if (res) {
            results.push(res);
            fs.writeFileSync(dbPath, JSON.stringify(results, null, 2));
        }
    }
    
    console.log(`Offline generation complete. Saved ${results.length} stories to offline_stories.json`);
}

run().catch(console.error);
