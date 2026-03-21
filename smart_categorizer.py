#!/usr/bin/env python3
import json
import os
import sys

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

# Comprehensive Rule-based Engine map
# Keys are lowercase keywords to match, values are one of MASTER_CATEGORIES
KEYWORD_MAP = {
    # Sports
    "sport": "Sports", "varzesh": "Sports", "football": "Sports", "soccer": "Sports", 
    "racing": "Sports", "wwe": "Sports", "fight": "Sports", "nba": "Sports", "espn": "Sports",
    "bein": "Sports", "eurovision": "Sports", "golf": "Sports", "tennis": "Sports", "olympic": "Sports",
    "arena": "Sports", "stadium": "Sports", "gym": "Sports", "snooker": "Sports",

    # Music
    "music": "Music", "radio": "Music", "mifa": "Music", "avang": "Music", 
    "pmc": "Music", "navahang": "Music", "tapesh": "Music", "taraneh": "Music", "dj ": "Music", 
    "edm": "Music", "concert": "Music", "opera": "Music", "itn": "Music", "ahang": "Music",
    "caltex": "Music", "radio javan": "Music", "rjradio": "Music", "4music": "Music",

    # News
    "news": "News", "khabar": "News", "bbc": "News", "voa": "News", 
    "iran international": "News", "euronews": "News", "alazeera": "News", "irinn": "News",
    "cnn": "News", "fox": "News", "sky": "News", "bloomberg": "News", "press": "News",
    "reuters": "News", "times": "News", "daily": "News", "journal": "News", "breaking": "News",
    "al jazeera": "News", "france24": "News", "dw ": "News", "al manar": "News",

    # Movies & Series
    "movie": "Movies & Series", "film": "Movies & Series", "cinema": "Movies & Series",
    "series": "Movies & Series", "drama": "Movies & Series", "comedy": "Movies & Series", 
    "action": "Movies & Series", "classic": "Movies & Series", "sinema": "Movies & Series",
    "serial": "Movies & Series", "24h": "Movies & Series", "horror": "Movies & Series",
    "thriller": "Movies & Series", "sci-fi": "Movies & Series", "family": "Movies & Series",
    "gem ": "Movies & Series", "river": "Movies & Series", "rubix": "Movies & Series", 
    "onyx": "Movies & Series", "persiana": "Movies & Series", "hbo": "Movies & Series",

    # Kids
    "kid": "Kids", "junior": "Kids", "toon": "Kids", "koodak": "Kids", "pouya": "Kids",
    "disney": "Kids", "nickelodeon": "Kids", "kartoon": "Kids", "baby": "Kids",
    "hodhod": "Kids", "penbe": "Kids", "gem kids": "Kids", "nehal": "Kids",

    # Documentary
    "doc": "Documentary", "nature": "Documentary", "discovery": "Documentary", "history": "Documentary",
    "wild": "Documentary", "national": "Documentary", "geograph": "Documentary", "planet": "Documentary",
    "animal": "Documentary", "science": "Documentary", "travel": "Documentary", "culture": "Documentary",
    "manoto": "Documentary",  # Often contains documentaries / entertainment

    # Religion
    "quran": "Religion", "islam": "Religion", "imam": "Religion", "qanat": "Religion", "karbala": "Religion",
    "moheban": "Religion", "velayat": "Religion", "sahar": "Religion", "hadi": "Religion", "noor": "Religion"
}

def rule_based_categorize(channel_name, current_category):
    text = (str(channel_name) + " " + str(current_category)).lower()
    for kw, cat in KEYWORD_MAP.items():
        if kw in text:
            return cat
    return None

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
            # Fallback for anything else
            ch["category"] = "General Entertainment"
            unmapped.append(ch)
            
    print(f"Rule Engine categorized {mapped_count} channels.")
    if unmapped:
        print(f"{len(unmapped)} channels defaulted to 'General Entertainment'.")
                        
    # Save back
    data["channels"] = channels
    with open(CHANNELS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        
    print("Categorization complete! Saved to channels.json.")

if __name__ == "__main__":
    main()
