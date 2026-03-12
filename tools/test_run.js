const https = require('https');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const geminiApiKey = process.env.GEMINI_API_KEY;

if (!geminiApiKey) {
  console.error("GEMINI_API_KEY not found!");
  process.exit(1);
}

const STORY_MODEL = 'gemini-3.1-pro-preview';
const IMAGE_MODEL = 'gemini-3.1-flash-image-preview'; // Image generation requires the image model

const prompt = `You are a creative storyteller. A live audience just listened to a musical track titled "Track 1".
During the performance, they interacted using an app. Here is their aggregated data:

OVERALL TRACK SUMMARY:
- Applause: 0
- Likes: 0
- Meh/Neutral: 0
- Top 5 overall moods felt: Excited, Confusion, Anxious, Mystery, Sad
- Top 2 overall colors felt: Purple, Yellow
- All words submitted to describe it: Loving the emotional, What a slow, Really getting into the great, Just feeling the fun, Just feeling the slow, Really getting into the deep, Loving the moving, Just feeling the wild, Really getting into the cool, Incredible performance emotional, Really getting into the synth, I am feeling so cool, Loving the cool

MINUTE-BY-MINUTE TRAJECTORY:
Minute 1: Moods: Sad, Mystery | Top Color: Purple
Minute 2: Moods: Confusion, Anxious | Top Color: Purple
Minute 3: Moods: Happy, Calm | Top Color: Cyan
Minute 4: Moods: Excited, Confusion | Top Color: Blue
Minute 5: Moods: Melancholy, Excited | Top Color: White
Minute 6: Moods: Melancholy, Chaos | Top Color: Green
Minute 7: Moods: Confusion, Happy | Top Color: Red
Minute 8: Moods: Joy, Angry | Top Color: White

Based on this audience reaction, generate two things:
1. A creative, evocative new name for this performance of the track, based largely on the overall track summary (top 5 moods and top 2 colors).
2. A short (2-3 sentences) poetic description/story that traces the audience's journey using the minute-by-minute trajectory and the submitted words.
  
Output format should be JSON exactly like this, no markdown formatting:
{
  "newName": "The Generated Name",
  "story": "The generated story."
}`;

async function run() {
  console.log('Generating text with', STORY_MODEL);
  const textPayload = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }]
  });

  const textRes = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${STORY_MODEL}:generateContent?key=${geminiApiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(textPayload)
      }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(textPayload);
    req.end();
  });

  let generatedText = '';
  if (textRes.status === 200) {
    const data = JSON.parse(textRes.body);
    generatedText = data.candidates[0].content.parts[0].text;
    console.log("TEXT GENERATED:", generatedText);
  } else {
    console.error("TEXT ERROR:", textRes.body);
    return;
  }

  let parsed = { newName: "Fallback", story: "Fallback" };
  try {
     let raw = generatedText;
     if (raw.includes('\`\`\`json')) {
         raw = raw.split('\`\`\`json')[1].split('\`\`\`')[0].trim();
     } else if (raw.includes('\`\`\`')) {
         raw = raw.split('\`\`\`')[1].trim();
     }
     parsed = JSON.parse(raw);
  } catch(e) {}

  const imagePrompt = `Create a highly abstract, atmospheric, wide 16:9 concert visual background based on a song titled "${parsed.newName}". \nStory meaning: ${parsed.story}. \nThe dominant colors should be: Purple, Yellow. \nThe visual mood and themes should reflect these words: emotional, fun, deep, cool, wild. Do not include any text or UI elements in the image.`;

  console.log('Generating image with', IMAGE_MODEL);
  
  const imgPayload = JSON.stringify({
    contents: [{
      parts: [
        { text: imagePrompt }
      ]
    }],
    generationConfig: {
      responseModalities: ["Image"],
      imageConfig: {
        aspectRatio: "16:9"
      }
    }
  });

  const imgRes = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${IMAGE_MODEL}:generateContent?key=${geminiApiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(imgPayload)
      }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(imgPayload);
    req.end();
  });

  if (imgRes.status === 200) {
    const data = JSON.parse(imgRes.body);
    console.log("Raw Image Output Data Keys:", Object.keys(data));
    
    // For gemini generateContent endpoint
    let b64 = null;
    if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
       for (const p of data.candidates[0].content.parts) {
           if (p.inlineData && p.inlineData.data) {
               b64 = p.inlineData.data;
           }
       }
    } else if (data.predictions && data.predictions[0]) {
       b64 = data.predictions[0].bytesBase64Encoded;
    }

    if (b64) {
      const outDir = path.join(__dirname, '..', 'logs', 'images');
      if (!fs.existsSync(outDir)) { fs.mkdirSync(outDir, { recursive: true }); }
      const timestamp = Date.now();
      const fileName = `test_image_${timestamp}.jpg`;
      const filePath = path.join(outDir, fileName);
      
      fs.writeFileSync(filePath, b64, 'base64');
      console.log(`IMAGE GENERATED: ${filePath}`);
      
      // Write the output to a text file
      fs.writeFileSync(path.join(outDir, `test_result_${timestamp}.md`), 
        `## Text Generation (` + STORY_MODEL + `)\n\n**New Name:** ${parsed.newName}\n\n**Story:** ${parsed.story}\n\n## Image Generation (` + IMAGE_MODEL + `)\n\n![Generated Image](./${fileName})`);
      console.log("DONE");
    } else {
        console.error("Could not find base 64 in data:", JSON.stringify(data).substring(0, 500));
    }
  } else {
    console.error("IMAGE ERROR:", imgRes.body);
  }
}

run();
