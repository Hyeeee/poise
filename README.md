# Poise
A browser-local posture awareness prototype, with an English glass interface.

Serve this repository root through localhost or HTTPS. GitHub Pages can deploy the main branch from / (root). Choose Begin with camera, allow access, keep your head and shoulders visible, and select Set reference. Head/shoulder deviation persists for 5 seconds before red feedback. No camera frames are stored or uploaded. Models and fonts load from external CDNs.

Break mode now uses five real-person follow-along clips from CUH's official YouTube videos: two shoulder releases, two neck releases, and an upper-back release. Clips autoplay muted and repeat their selected 9–18 second segment through the YouTube IFrame API. Replay, pause, sound, next, error recovery, and source links are available. Work mode and leaving the page stop playback; hidden tabs pause it. Autoplay restrictions may require one tap on Play.

A 60% match held continuously for two seconds earns 100 points. The first four seconds allow time to watch the guide. Scores estimate the demonstrated target using live landmarks (not frame-by-frame analysis of the instructor). Missing arm visibility skips an arm target after eight seconds. Left/right are aligned to the on-screen direction. The large Break marketing headline and the static stick-figure guide have been removed.

The eye panel counts detected blinks in a rolling 60-second window. Distance uses apparent shoulder width relative to calibration; it is not a centimeter measurement. These are prototype estimates, not clinical measures.

## Light bar
Use desktop Chrome/Edge and an Arduino-compatible board with the Adafruit NeoPixel library. Adjust LED_PIN and LED_COUNT in hardware/poise-lightbar.ino for your actual hardware. The web app sends GREEN, AMBER, RED, or IDLE followed by a newline at 115200 baud. The sketch fades between colors and returns to neutral if messages stop. Hardware has not been physically tested.

## Verification
Browser verification covered the English screens, muted video autoplay, clip changes, and pause/resume controls; both MediaPipe models were initialized in the earlier version. Logic checks now cover the 60% threshold, continuous two-second holds, loss-of-tracking and paused-video guards, zero points for skipped moves, and mirrored shoulder/neck direction. Live tracking accuracy requires a person and camera; physical serial output requires the actual board.

## Sources
- MediaPipe: https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js
- CUH seated stretches: https://www.cuh.nhs.uk/our-services/physiotherapy-outpatients/outpatient-physio-resources/resources/shoulder/seated-stretches/
