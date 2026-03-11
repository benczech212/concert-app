require('dotenv').config();
const https = require('https');

const geminiApiKey = process.env.GEMINI_API_KEY;

if (!geminiApiKey || geminiApiKey === 'your_dummy_key_here_replace_me') {
  console.error("❌ Error: Please put a valid GEMINI_API_KEY in the .env file.");
  process.exit(1);
}

console.log("Testing connection to Gemini API...");

const payload = JSON.stringify({
  contents: [{ parts: [{ text: "Say 'Hello, your API key is working!'" }] }]
});

const req = https.request({
  hostname: 'generativelanguage.googleapis.com',
  path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
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
      try {
        const geminiData = JSON.parse(body);
        const text = geminiData.candidates[0].content.parts[0].text;
        console.log("✅ Success! Gemini responded:");
        console.log(`\n  "${text.trim()}"\n`);
      } catch (e) {
        console.error("❌ Failed to parse response:", body);
      }
    } else {
      console.error(`❌ API Error (Status ${res.statusCode}):`);
      try {
        const errorData = JSON.parse(body);
        console.error(errorData.error.message);
      } catch (e) {
        console.error(body);
      }
    }
  });
});

req.on('error', (e) => {
  console.error("❌ Network error:", e.message);
});

req.write(payload);
req.end();
