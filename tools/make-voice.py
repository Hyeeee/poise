"""Pre-record Poise's setup lines with a natural neural voice.

Run once from the repo root (needs internet):
    pip install edge-tts
    python3 tools/make-voice.py              # all five voices
    python3 tools/make-voice.py emma sonia   # only some

It writes voice/<hash>.mp3 for every line Poise speaks during setup. The site plays
these files automatically and falls back to the browser voice for anything missing.
Re-run it whenever you change the wording in onboarding.js.
"""
import asyncio, pathlib, re, sys
import edge_tts

ROOT = pathlib.Path(__file__).resolve().parent.parent
# id -> neural voice. Ava is written to voice/, the rest to voice/<id>/.
VOICES = {"ava": "en-US-AvaNeural", "emma": "en-US-EmmaNeural", "sonia": "en-GB-SoniaNeural",
          "andrew": "en-US-AndrewNeural", "brian": "en-US-BrianNeural"}
ONLY = sys.argv[1:]

def file_for(text, vid="ava"):
    h = 5381
    for ch in text:
        h = ((h * 33) ^ ord(ch)) & 0xFFFFFFFF
    folder = ROOT / "voice" if vid == "ava" else ROOT / "voice" / vid
    folder.mkdir(parents=True, exist_ok=True)
    return folder / f"{h:x}.mp3"

def lines():
    src = (ROOT / "onboarding.js").read_text(encoding="utf-8")
    found = re.findall(r"say: '((?:[^'\\]|\\.)*)'", src)
    found += re.findall(r"(?:show|speak)\('((?:[^'\\]|\\.)*)'", src)
    return [t.replace("\\'", "'") for t in dict.fromkeys(found)]

async def main():
    for vid, name in VOICES.items():
        if ONLY and vid not in ONLY:
            continue
        for text in lines():
            out = file_for(text, vid)
            await edge_tts.Communicate(text, name, rate="-4%").save(str(out))
            print("saved", vid, out.name, "-", text)

asyncio.run(main())
