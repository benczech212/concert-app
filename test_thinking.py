import os
import json
from google import genai
from google.genai import types

def generate():
    client = genai.Client(
        api_key=os.environ.get("GEMINI_API_KEY"),
    )

    model = "gemini-3.1-pro-preview"
    contents = [
        types.Content(
            role="user",
            parts=[
                types.Part.from_text(text="I have 3 apples. I give you 1. How many do I have?"),
            ],
        ),
    ]
    generate_content_config = types.GenerateContentConfig(
        thinking_config=types.ThinkingConfig(
            thinking_level="HIGH",
        ),
    )

    response = client.models.generate_content(
        model=model,
        contents=contents,
        config=generate_content_config,
    )
    
    print("TEXT:")
    print(response.text)
    print("----")
    print("ALL PARTS:")
    for part in response.candidates[0].content.parts:
        print("thought:", part.thought)
        print("text:", part.text)

if __name__ == "__main__":
    generate()
