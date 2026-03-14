const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function testThinking() {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3.1-pro-preview',
            contents: 'Test script hello!',
            config: {
                thinkingConfig: {
                    thinkingLevel: 'HIGH'
                }
            }
        });

        console.log(JSON.stringify(response, null, 2));
    } catch (e) {
        console.error(e);
    }
}
testThinking();
