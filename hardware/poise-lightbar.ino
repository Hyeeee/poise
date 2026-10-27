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
// For people who'd rather not be on camera. The board works on its own:
//  1. When you sit down, it learns your normal distance (average of the first 3 s).
//  2. Lean in 15% closer than that for 5 s  -> fades to yellow.
//     Still leaning 20 s later                -> fades to red.
//     Back to normal                          -> green for a moment, then soft white.
//  3. Nothing in front of the sensor for 3 s -> you're away: the strip dims.
//     When you sit back down it learns your distance again.
// It can't tell left/right tilt: one sensor only measures straight ahead.
int baseCm = -1;                       // your normal distance
unsigned long seenSince = 0, goneSince = 0, closeSince = 0, okSince = 0;
long baseSum = 0; int baseN = 0;

void sensorDemo() {
  unsigned long now = millis();
  bool here = distanceCm > 0 && distanceCm < 150;
  if (!here) {
    if (!goneSince) goneSince = now;
    if (now - goneSince > 3000) { baseCm = -1; baseSum = 0; baseN = 0; seenSince = 0; closeSince = 0; setTarget(10, 12, 16); }  // away
    return;
  }
  goneSince = 0;
  if (baseCm < 0) {                                   // learning your normal distance
    if (!seenSince) seenSince = now;
    baseSum += distanceCm; baseN++;
    setTarget(60, 65, 70);
    if (now - seenSince > 3000 && baseN > 0) baseCm = baseSum / baseN;
    return;
  }
  if (distanceCm < baseCm * 0.85) {                  // leaning in
    okSince = 0;
    if (!closeSince) closeSince = now;
    unsigned long held = now - closeSince;
    if (held < 5000) return;                          // grace: ignore short leans
    fade = 0.02;
    if (held < 25000) setTarget(255, 130, 0); else setTarget(255, 0, 0);
  } else {
    if (closeSince && now - closeSince >= 5000) okSince = now;   // just corrected
    closeSince = 0;
    if (okSince && now - okSince < 1500) setTarget(0, 255, 30); else setTarget(110, 110, 100);
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
