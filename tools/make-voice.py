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
VOICES = {"ava": "en-US-AvaNeural", "sonia": "en-GB-SoniaNeural",
          "andrew": "en-US-AndrewNeural"}
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
    found += re.findall(r"const hello = '((?:[^'\\]|\\.)*)'", src)
    report = (ROOT / "report.js").read_text(encoding="utf-8")
    block = report.split("const SAY = {", 1)[1].split("};", 1)[0]
    found += re.findall(r":\s*'((?:[^'\\]|\\.)*)'", block)
    return [t.replace("\\'", "'") for t in dict.fromkeys(found)]

async def main():
    for vid, name in VOICES.items():
        if ONLY and vid not in ONLY:
            continue
        for text in lines():
            out = file_for(text, vid)
            if out.exists() and out.stat().st_size > 1000:
                continue  # already made; lets you re-run after a network hiccup
            for attempt in range(4):
                try:
                    await edge_tts.Communicate(text, name, rate="-4%").save(str(out))
                    break
                except Exception as e:
                    print("retrying", vid, "-", e)
                    await asyncio.sleep(2 + attempt * 2)
            print("saved", vid, out.name, "-", text)

asyncio.run(main())
