const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('index.html', 'utf8');
const script = fs.readFileSync('script.js', 'utf8');

const dom = new JSDOM(html, { runScripts: "dangerously", resources: "usable" });
dom.window.eval(`
  window.crypto = { randomUUID: () => '1234' };
  window.fetch = () => Promise.resolve({ ok: true, text: () => Promise.resolve('moods:\\n  - name: "Happy"') });
`);
dom.window.eval(script);

setTimeout(() => {
  console.log("Color Wheel height:", dom.window.document.getElementById('colorWheel').innerHTML.length);
  console.log("Mood Buttons Wrap innerHTML length:", dom.window.document.getElementById('emotionButtons').innerHTML.length);
}, 2000);
