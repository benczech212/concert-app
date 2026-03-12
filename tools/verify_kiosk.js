const fs = require('fs');
const jsdom = require("jsdom");
const { JSDOM } = jsdom;

const html = fs.readFileSync('public/kiosk.html', 'utf8');
const dom = new JSDOM(html, { runScripts: "dangerously", virtualConsole: new jsdom.VirtualConsole().sendTo(console) });
