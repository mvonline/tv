#!/usr/bin/env python3
import json
import os
import sys
import re

try:
    import google.generativeai as genai
    HAS_GENAI = True
except ImportError:
    HAS_GENAI = False

CHANNELS_FILE = "channels.json"

MASTER_CATEGORIES = [
    "Sports",
    "Movies & Series",
    "Music",
    "News",
    "Kids",
    "Documentary",
    "Religion",
    "General Entertainment"
]

# Rule-based Engine map
KEYWORD_MAP = {
    # Sports
    "sport": "Sports", "varzesh": "Sports", "football": "Sports", "soccer": "Sports", 
    "racing": "Sports", "wwe": "Sports", "fight": "Sports", "nba": "Sports",

    # Music
    "music": "Music", "radio": "Music", "mifa": "Music", "avang": "Music", 
    "pmc": "Music", "navahang": "Music", "tapesh": "Music", "taraneh": "Music", "dj ": "Music", "edm": "Music",

    # News
    "news": "News", "khabar": "News", "bbc": "News", "voa": "News", 
    "iran international": "News", "euronews": "News", "alazeera": "News", "irinn": "News",

    # Movies
    "movie": "Movies & Series", "film": "Movies & Series", "cinema": "Movies & Series",
    "series": "Movies & Series", "drama": "Movies & Series", "comedy": "Movies & Series", 
    "action": "Movies & Series", "classic": "Movies & Series", "sinema": "Movies & Series",

    # Kids
    "kid": "Kids", "junior": "Kids", "toon": "Kids", "koodak": "Kids", "pouya": "Kids",

    # Doc
    "doc": "Documentary", "nature": "Documentary", "discovery": "Documentary", "history": "Documentary",

    # Religion
    "quran": "Religion", "islam": "Religion", "imam": "Religion", "qanat": "Religion", "karbala": "Religion"
}

def rule_based_categorize(channel_name, current_category):
    text = (channel_name + " " + str(current_category)).lower()
    for kw, cat in KEYWORD_MAP.items():
        if kw in text:
            return cat
    return None

def llm_categorize(batch):
    # Setup genai
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("[!] No GEMINI_API_KEY found, skipping LLM categorization for this batch.")
        return {}
    
    genai.configure(api_key=api_key)
    # Use gemini-1.5-flash for speed/cost
    model = genai.GenerativeModel("gemini-1.5-flash")
    
    prompt = "You are an AI categorizing TV channels. Map the following IDs to exactly one of these categories: " + ", ".join(f'"{c}"' for c in MASTER_CATEGORIES) + ".\n"
    prompt += "Respond exclusively with a valid JSON object map: {\"channel_id_1\": \"Category\", \"channel_id_2\": \"Category\"}\n\nChannels to Categorize:\n"
    for ch in batch:
        prompt += f"- ID: {ch['id']}, Name: {ch['name']}, Old Category: {ch.get('category','')}\n"
    
    try:
        response = model.generate_content(prompt)
        text = response.text.strip()
        # Find JSON block
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0]
        elif "```" in text:
            text = text.split("```")[1].split("```")[0]
        return json.loads(text.strip())
    except Exception as e:
        print(f"[!] LLM failed for batch: {e}")
        print(f"[!] LLM text response: {text[:200] if 'text' in locals() else ''}")
        return {}

def main():
    if not os.path.exists(CHANNELS_FILE):
        print(f"Error: {CHANNELS_FILE} not found.")
        sys.exit(1)
        
    with open(CHANNELS_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
        
    channels = data.get("channels", [])
    
    print(f"Loaded {len(channels)} channels.")
    
    unmapped = []
    mapped_count = 0
    
    # 1. Rule Engine Pass
    for ch in channels:
        cat = rule_based_categorize(ch["name"], ch.get("category", ""))
        if cat:
            ch["category"] = cat
            mapped_count += 1
        else:
            unmapped.append(ch)
            
    print(f"Rule Engine categorized {mapped_count} channels instantly.")
    
    # 2. LLM Pass
    if unmapped:
        print(f"{len(unmapped)} channels unmapped. Attempting LLM/Fallback...")
        if not HAS_GENAI or not os.environ.get("GEMINI_API_KEY"):
            print("To use the AI engine, ensure you 'pip install google-generativeai' and set GEMINI_API_KEY.")
            print("Applying fallback category to remaining channels...")
            for ch in unmapped:
                ch["category"] = "General Entertainment"
        else:
            # Batch size 50
            for i in range(0, len(unmapped), 50):
                batch = unmapped[i:i+50]
                print(f"Processing LLM batch {i//50 + 1} of {(len(unmapped)-1)//50 + 1}...")
                results = llm_categorize(batch)
                for ch in batch:
                    mapped_cat = results.get(ch["id"])
                    if mapped_cat in MASTER_CATEGORIES:
                        ch["category"] = mapped_cat
                    else:
                        ch["category"] = "General Entertainment"
                        
    # Save back
    data["channels"] = channels
    with open(CHANNELS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        
    print("Categorization complete! Saved to channels.json.")

if __name__ == "__main__":
    main()
