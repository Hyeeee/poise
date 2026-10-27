// Poise light bar — Arduino UNO (or Nano Every) + NeoPixel strip + HC-SR04
// Wiring: D6 -> 330Ω -> strip DIN, D7 -> HC-SR04 Trig, D8 -> HC-SR04 Echo.
// Prototype: strip and sensor powered from the board 5V pin over USB, all GNDs joined.
//
// What it does
// 1. On power-up: quick red / green / blue test so you can see the strip works.
// 2. The web app (camera) decides the color and sends it over USB, 115200 baud, one line each:
//      "RGB r g b"  exact color, e.g. "RGB 255 130 0"
//      WHITE / GREEN / AMBER / RED / IDLE  preset colors
//    The strip fades slowly to each new color (about 1.5 s), so changes feel calm.
//    "RGB r g b f" adds a fade speed (1-100) for quick effects: game pops, the breathing light.
// 3. If the app stops sending for 4 seconds, the strip dims to a soft idle glow.
//
// The HC-SR04 distance sensor is OPTIONAL (an exercise, not needed for Poise).
//   USE_SENSOR = false : sensor ignored, nothing needs to be wired on D7/D8.
//   Sensor-only mode (no camera): see sensorDemo() below. It runs whenever the app isn't sending colors.
//   USE_SENSOR = true  : prints "DIST <cm>" ~6x a second (the web app can use it), and when the
//                        app isn't connected the color follows distance as a demo.

#include <Adafruit_NeoPixel.h>

constexpr uint8_t LED_PIN   = 6;
constexpr uint16_t LED_COUNT = 30;   // <- change to your strip's LED count
constexpr uint8_t TRIG_PIN  = 7;
constexpr uint8_t ECHO_PIN  = 8;
constexpr bool    USE_SENSOR = true;  // <- false if the HC-SR04 isn't wired
constexpr uint8_t BRIGHTNESS = 90;   // brighter, saturated colors; white is kept dim to stay within USB power

// How fast the strip moves toward a new color each frame (every 20 ms).
// 0.07 ≈ 0.6 s (snappy) · 0.03 ≈ 1.5 s (calm) · 0.015 ≈ 3 s (very slow)
constexpr float FADE = 0.03;
float fade = FADE;                 // current fade speed; a message can ask for a faster one

// Sensor demo distance thresholds in cm (only used when USE_SENSOR is true).
constexpr int TOO_CLOSE = 40;
constexpr int CLOSE     = 55;

Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);

String input;
float r = 0, g = 0, b = 0;            // current color (faded)
uint8_t tr = 40, tg = 45, tb = 50;    // target color
unsigned long lastMessage = 0, lastFrame = 0, lastPing = 0;
bool appConnected = false;
int distanceCm = -1;

void setTarget(uint8_t R, uint8_t G, uint8_t B) { tr = R; tg = G; tb = B; }

void showAll(uint8_t R, uint8_t G, uint8_t B) {
  strip.fill(strip.Color(R, G, B));
  strip.show();
}

int readDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  unsigned long us = pulseIn(ECHO_PIN, HIGH, 25000UL);  // ~4 m max, then give up
  if (us == 0) return -1;                                // nothing in range
  return us / 58;                                        // µs -> cm
}

// Median of 3 readings removes most of the HC-SR04's random spikes.
int readDistanceSmooth() {
  int a = readDistanceCm(); delay(8);
  int c = readDistanceCm(); delay(8);
  int d = readDistanceCm();
  if (a > c) { int t = a; a = c; c = t; }
  if (c > d) { int t = c; c = d; d = t; }
  if (a > c) { int t = a; a = c; c = t; }
  return c;
}

void handleMessage(String msg) {
  msg.trim();
  lastMessage = millis();
  appConnected = true;
  fade = FADE;                              // default: calm fade
  if (msg.startsWith("RGB ")) {
    // "RGB r g b"       exact color, calm fade (posture)
    // "RGB r g b 15"    same, with fade speed 15 = 0.15 (fast: game pops, breathing light)
    int r1 = msg.indexOf(' '), r2 = msg.indexOf(' ', r1 + 1), r3 = msg.indexOf(' ', r2 + 1), r4 = msg.indexOf(' ', r3 + 1);
    if (r1 > 0 && r2 > 0 && r3 > 0) {
      int blue = (r4 > 0 ? msg.substring(r3 + 1, r4) : msg.substring(r3 + 1)).toInt();
      setTarget(msg.substring(r1 + 1, r2).toInt(), msg.substring(r2 + 1, r3).toInt(), blue);
      if (r4 > 0) fade = constrain(msg.substring(r4 + 1).toInt(), 1, 100) / 100.0;
    }
  }
  else if (msg == "WHITE")  setTarget(110, 110, 100);
  else if (msg == "GREEN")  setTarget(0, 255, 30);
  else if (msg == "AMBER") setTarget(255, 130, 0);
  else if (msg == "RED")   setTarget(255, 0, 0);
  else                     setTarget(40, 45, 50);   // IDLE or anything else
}

// ---- Sensor-only mode (no camera, no app needed) ----
// For people who'd rather not be on camera. The board works on its own, and it answers right away:
//  1. Sit down: the strip pulses blue for 3 s while it learns your normal distance,
//     then flashes green once to say "ready".
//  2. Live feedback: the closer you lean in, the warmer the light gets, instantly
//     (white -> pale yellow as you come in).
//  3. Lean in 10%+ closer for 3 s  -> full yellow.  Still there 15 s later -> red.
//     Sit back                      -> green for a moment, then white.
//  4. Nothing in front for 3 s     -> away: the strip dims. Sit down again and it relearns.
// It can't tell left/right tilt: one sensor only measures straight ahead.
int baseCm = -1;                     // your normal distance
float smoothCm = -1;                 // distance with jitter smoothed out
unsigned long seenSince = 0, goneSince = 0, closeSince = 0, okUntil = 0;
long baseSum = 0; int baseN = 0;

void mixTarget(uint8_t r1, uint8_t g1, uint8_t b1, uint8_t r2, uint8_t g2, uint8_t b2, float k) {
  k = constrain(k, 0, 1);
  setTarget(r1 + (r2 - r1) * k, g1 + (g2 - g1) * k, b1 + (b2 - b1) * k);
}

void sensorDemo() {
  unsigned long now = millis();
  bool here = distanceCm > 0 && distanceCm < 200;
  if (!here) {
    if (!goneSince) goneSince = now;
    if (now - goneSince > 3000) {                     // away
      baseCm = -1; baseSum = 0; baseN = 0; seenSince = 0; closeSince = 0; smoothCm = -1;
      fade = 0.03; setTarget(6, 8, 10);
    }
    return;
  }
  goneSince = 0;
  smoothCm = smoothCm < 0 ? distanceCm : smoothCm + (distanceCm - smoothCm) * 0.35;

  if (baseCm < 0) {                                   // learning: soft blue pulse
    if (!seenSince) seenSince = now;
    baseSum += distanceCm; baseN++;
    float pulse = 0.5 + 0.5 * sin(now / 250.0);
    fade = 0.2; setTarget(20, 60 + 60 * pulse, 120 + 120 * pulse);
    if (now - seenSince > 3000) { baseCm = baseSum / baseN; okUntil = now + 900; }   // ready: green flash
    return;
  }
  if (now < okUntil) { fade = 0.25; setTarget(0, 255, 30); return; }

  float closer = (baseCm - smoothCm) / baseCm;       // 0 = normal, 0.10 = 10% closer
  if (closer > 0.10) {
    if (!closeSince) closeSince = now;
    unsigned long held = now - closeSince;
    fade = 0.05;
    if (held < 3000)       mixTarget(110, 110, 100, 255, 190, 60, closer / 0.25);   // instant warm hint
    else if (held < 18000) setTarget(255, 130, 0);                                  // yellow
    else                   setTarget(255, 0, 0);                                    // red
  } else {
    if (closeSince && now - closeSince >= 3000) okUntil = now + 1200;               // corrected
    closeSince = 0;
    fade = 0.12;
    mixTarget(110, 110, 100, 255, 190, 60, max(0.0f, closer) / 0.25);               // live hint
  }
}

void setup() {
  Serial.begin(115200);
  if (USE_SENSOR) {
    pinMode(TRIG_PIN, OUTPUT);
    pinMode(ECHO_PIN, INPUT);
  }
  strip.begin();
  strip.setBrightness(BRIGHTNESS);
  // Power-on test.
  showAll(255, 0, 0); delay(400);
  showAll(0, 255, 0); delay(400);
  showAll(0, 0, 255); delay(400);
  showAll(0, 0, 0);
}

void loop() {
  // 1. Messages from the web app.
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') { handleMessage(input); input = ""; }
    else if (input.length() < 24) input += c;
  }
  if (appConnected && millis() - lastMessage > 4000) {
    appConnected = false;
    setTarget(40, 45, 50);                     // app went quiet: soft idle glow
  }

  // 2. Distance (optional), ~6 times a second.
  if (USE_SENSOR && millis() - lastPing > 150) {
    lastPing = millis();
    distanceCm = readDistanceSmooth();
    Serial.print("DIST ");
    Serial.println(distanceCm);
    if (!appConnected) sensorDemo();
  }

  // 3. Smooth fade toward the target color.
  if (millis() - lastFrame > 20) {
    lastFrame = millis();
    r += (tr - r) * fade; g += (tg - g) * fade; b += (tb - b) * fade;
    showAll(r, g, b);
  }
}
