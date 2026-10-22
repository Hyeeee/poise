# Poise
A browser-local posture companion for a monitor-mounted light bar. Glass interface, voice-guided setup, custom focus and break modes, and an assistant you can type or talk to.

Serve the repository root through localhost or HTTPS (GitHub Pages works from `/`). No camera frames are stored or uploaded. Models and fonts load from CDNs.

## Flow
1. **Welcome** → **Begin** opens a short voice-guided setup (first visit only). Five questions set focus length, how firmly to nudge, eye care, break style, and whether breaks start on their own. The answers become two modes: *My focus* and *My reset*.
2. **Studio** — the camera fills the screen. The side panel shows posture state, the focus timer, and session stats (time aligned, blinks per minute, distance). A thin line along the top mirrors the light bar color.
3. **Break** — either guided stretches (an animated sketch figure demonstrates each seated stretch; getting about 45% close for half a second passes) or a breathing and eye-rest timer.

## Modes
Focus modes: name, focus length, sensitivity (gentle / balanced / firm), seconds before a strong cue, eye care, chime.
Break modes: name, style (stretch / breathe), number of stretches or minutes, start automatically.
Three presets of each ship by default; create, edit, and delete more from the sliders button. Everything is saved in `localStorage`.

## Ask Poise
The bar at the bottom accepts English or Korean, typed or spoken (Chrome speech recognition). Examples: `focus 40 minutes`, `집중 40분, 휴식은 호흡으로`, `덜 민감하게`, `turn off eye care`, `'공부' 모드 만들어줘`, `take a break`, `how am I doing?`. Parsing runs locally in `assistant.js`; no API key is needed. To connect a hosted LLM later, replace `respond()` and keep the `ctx` actions.

## Files
- `app.js` — camera, MediaPipe tracking, timer, break game, light bar serial, UI wiring
- `settings.js` — modes and preferences store
- `onboarding.js` — voice-guided setup (Web Speech synthesis)
- `assistant.js` — intent parser for Ask Poise
- `guide.js` — animated ink-sketch seated figure that demonstrates each stretch
- `ambient.js` — calm generative background music (Web Audio, no audio files)
- `tour.js` — guided spotlight tour of the studio controls
- `tools/make-voice.py` — pre-records setup lines with a natural neural voice into `voice/`
- `hardware/poise-lightbar.ino` — NeoPixel sketch

## Light bar
Use desktop Chrome/Edge and an Arduino-compatible board with the Adafruit NeoPixel library. Adjust `LED_PIN` and `LED_COUNT` in `hardware/poise-lightbar.ino`. The web app sends `GREEN`, `AMBER`, `RED`, or `IDLE` plus a newline at 115200 baud. During breathing breaks the bar alternates `GREEN` (inhale) and `IDLE` (exhale). Hardware has not been physically tested.

Position, distance, and blink counts are relative prototype estimates, not health measurements.

## Sources
- MediaPipe: https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js
- CUH seated stretches: https://www.cuh.nhs.uk/our-services/physiotherapy-outpatients/outpatient-physio-resources/resources/shoulder/seated-stretches/
