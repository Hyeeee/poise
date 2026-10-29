// Poise light bar — Arduino UNO (or Nano Every) + NeoPixel strip + HC-SR04
// Wiring: D6 -> 330Ω -> strip DIN. Left sensor: D7 Trig, D8 Echo. Right sensor: D9 Trig, D10 Echo.
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
constexpr uint8_t TRIG_L = 7, ECHO_L = 8;    // sensor on the screen's left
constexpr uint8_t TRIG_R = 9, ECHO_R = 10;   // sensor on the screen's right
constexpr bool    USE_SENSOR = true;  // <- false if the HC-SR04 isn't wired
constexpr uint8_t BRIGHTNESS = 120;  // brighter, saturated colors; white is kept dim to stay within USB power

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
int distanceCm = -1;                 // average of both sensors (front/back)
int leftCm = -1, rightCm = -1;       // each sensor on its own (left/right tilt)

void setTarget(uint8_t R, uint8_t G, uint8_t B) { tr = R; tg = G; tb = B; }

void showAll(uint8_t R, uint8_t G, uint8_t B) {
  strip.fill(strip.Color(R, G, B));
  strip.show();
}

int readDistanceCm(uint8_t trig, uint8_t echo) {
  digitalWrite(trig, LOW);  delayMicroseconds(2);
  digitalWrite(trig, HIGH); delayMicroseconds(10);
  digitalWrite(trig, LOW);
  unsigned long us = pulseIn(echo, HIGH, 25000UL);  // ~4 m max, then give up
  if (us == 0) return -1;                                // nothing in range
  return us / 58;                                        // µs -> cm
}

// Median of 3 readings removes most of the HC-SR04's random spikes.
// The two sensors take turns (never at the same moment) so one doesn't hear the other's echo.
int readDistanceSmooth(uint8_t trig, uint8_t echo) {
  int a = readDistanceCm(trig, echo); delay(8);
  int c = readDistanceCm(trig, echo); delay(8);
  int d = readDistanceCm(trig, echo);
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
  else if (msg == "WHITE")  setTarget(140, 140, 130);
  else if (msg == "GREEN")  setTarget(0, 255, 30);
  else if (msg == "AMBER") setTarget(255, 130, 0);
  else if (msg == "RED")   setTarget(255, 0, 0);
  else                     setTarget(40, 45, 50);   // IDLE or anything else
}

// ---- Sensor-only mode (no camera, no app needed) ----
// For people who'd rather not be on camera. The board works on its own:
//   GOOD_MIN..GOOD_MAX cm  = good posture (soft white)
//   closer than GOOD_MIN   = leaning in;  farther than GOOD_MAX = leaning back
//  Outside the good range: the light warms right away (the farther out, the warmer),
//  turns yellow after 7 s and red after 14 s. Back in range -> green for a moment, then white.
//  Nothing in front for 3 s -> away: the strip dims. Sitting down again flashes green once.
//  Two sensors (left + right): if one side gets more than TILT_CM closer than the other,
//  you're tilting to that side - same yellow/red rule.
constexpr int GOOD_MIN = 50;         // <- tune to your desk (your sweet spot ~60-70 plus some room)
constexpr int GOOD_MAX = 85;
constexpr int SLACK    = 5;          // small moves past the edge are ignored
constexpr int AWAY_CM  = 150;
constexpr int TILT_CM  = 12;         // left/right difference above this = tilting to one side
float smoothCm = -1, smoothTilt = 0;  // smoothed distance, and tilt = left minus right (cm)
unsigned long goneSince = 0, outSince = 0, okUntil = 0;
bool away = true;

void mixTarget(uint8_t r1, uint8_t g1, uint8_t b1, uint8_t r2, uint8_t g2, uint8_t b2, float k) {
  k = constrain(k, 0, 1);
  setTarget(r1 + (r2 - r1) * k, g1 + (g2 - g1) * k, b1 + (b2 - b1) * k);
}

void sensorDemo() {
  unsigned long now = millis();
  bool here = distanceCm > 0 && distanceCm < AWAY_CM;
  if (!here) {
    if (!goneSince) goneSince = now;
    if (now - goneSince > 3000) { away = true; outSince = 0; smoothCm = -1; smoothTilt = 0; fade = 0.03; setTarget(6, 8, 10); }
    return;
  }
  goneSince = 0;
  if (away) { away = false; okUntil = now + 900; }    // you sat down: green flash
  smoothCm = smoothCm < 0 ? distanceCm : smoothCm + (distanceCm - smoothCm) * 0.35;
  if (now < okUntil) { fade = 0.25; setTarget(0, 255, 30); return; }

  // Tilt: leaning toward one side brings that side's sensor closer.
  if (leftCm > 0 && rightCm > 0) smoothTilt += ((leftCm - rightCm) - smoothTilt) * 0.35;
  // How far off, in cm (0 = good): outside the front/back range, or tilted more than TILT_CM.
  float offFB = smoothCm < GOOD_MIN ? GOOD_MIN - smoothCm : smoothCm > GOOD_MAX ? smoothCm - GOOD_MAX : 0;
  float offTilt = max(0.0f, abs(smoothTilt) - TILT_CM);
  float off = max(offFB, offTilt) - SLACK;          // ignore the first few cm past the edge
  if (off > 0) {
    if (!outSince) outSince = now;
    unsigned long held = now - outSince;
    fade = 0.05;
    if (held < 2000)       setTarget(140, 140, 130);                             // first 2 s: ignore
    else if (held < 7000)  mixTarget(140, 140, 130, 255, 190, 60, off / 30.0);   // gentle warm hint
    else if (held < 14000) setTarget(255, 130, 0);                              // yellow
    else                   setTarget(255, 0, 0);                                // red
  } else {
    if (outSince && now - outSince >= 7000) okUntil = now + 1200;               // corrected
    outSince = 0;
    fade = 0.12;
    setTarget(140, 140, 130);                                                   // good: soft white
  }
}

void setup() {
  Serial.begin(115200);
  if (USE_SENSOR) {
    pinMode(TRIG_L, OUTPUT); pinMode(ECHO_L, INPUT);
    pinMode(TRIG_R, OUTPUT); pinMode(ECHO_R, INPUT);
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
    leftCm = readDistanceSmooth(TRIG_L, ECHO_L);
    delay(10);                                      // let the first echo die out
    rightCm = readDistanceSmooth(TRIG_R, ECHO_R);
    // Average for front/back; if one sensor misses, use the other.
    if (leftCm > 0 && rightCm > 0) distanceCm = (leftCm + rightCm) / 2;
    else distanceCm = leftCm > 0 ? leftCm : rightCm;
    Serial.print("DIST "); Serial.println(distanceCm);              // the web app reads this line
    Serial.print("LR "); Serial.print(leftCm); Serial.print(' '); Serial.println(rightCm);
    if (!appConnected) sensorDemo();
  }

  // 3. Smooth fade toward the target color.
  if (millis() - lastFrame > 20) {
    lastFrame = millis();
    r += (tr - r) * fade; g += (tg - g) * fade; b += (tb - b) * fade;
    showAll(r, g, b);
  }
}
