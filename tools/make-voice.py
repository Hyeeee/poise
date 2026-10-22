"""Pre-record Poise's setup lines with a natural neural voice.

Run once from the repo root (needs internet):
    pip install edge-tts
    python3 tools/make-voice.py            # default voice: en-US-JennyNeural
    python3 tools/make-voice.py en-US-AndrewNeural

It writes voice/<hash>.mp3 for every line Poise speaks during setup. The site plays
these files automatically and falls back to the browser voice for anything missing.
Re-run it whenever you change the wording in onboarding.js.
"""
import asyncio, pathlib, re, sys
import edge_tts

ROOT = pathlib.Path(__file__).resolve().parent.parent
VOICE = sys.argv[1] if len(sys.argv) > 1 else "en-US-JennyNeural"

def file_for(text):
    h = 5381
    for ch in text:
        h = ((h * 33) ^ ord(ch)) & 0xFFFFFFFF
    return ROOT / "voice" / f"{h:x}.mp3"

def lines():
    src = (ROOT / "onboarding.js").read_text(encoding="utf-8")
    found = re.findall(r"say: '((?:[^'\\]|\\.)*)'", src)
    found += re.findall(r"(?:show|speak)\('((?:[^'\\]|\\.)*)'", src)
    return [t.replace("\\'", "'") for t in dict.fromkeys(found)]

async def main():
    (ROOT / "voice").mkdir(exist_ok=True)
    for text in lines():
        out = file_for(text)
        await edge_tts.Communicate(text, VOICE, rate="-12%", pitch="-4Hz", volume="-10%").save(str(out))
        print("saved", out.name, "-", text)

asyncio.run(main())
