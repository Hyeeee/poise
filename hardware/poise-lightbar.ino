// Poise light bar — Arduino Nano Every + NeoPixel strip + HC-SR04
// Wiring: D6 -> 330Ω -> strip DIN, D7 -> HC-SR04 Trig, D8 -> HC-SR04 Echo.
// Strip 5V from the external adapter, Nano from USB, all GNDs joined.
//
// What it does
// 1. On power-up: quick red / green / blue test so you can see the strip works.
// 2. Until the web app sends anything: "sensor demo" — color follows HC-SR04 distance
//    (far = soft white, close = amber, too close = red). Good for a first test.
// 3. When the web app sends GREEN / AMBER / RED / IDLE (115200 baud, newline): follow it.
//    Falls back to the sensor demo if messages stop for 4 seconds.
// Always prints "DIST <cm>" a few times per second so you can watch it in the Serial Monitor.

#include <Adafruit_NeoPixel.h>

constexpr uint8_t LED_PIN   = 6;
constexpr uint16_t LED_COUNT = 30;   // <- change to your strip's LED count
constexpr uint8_t TRIG_PIN  = 7;
constexpr uint8_t ECHO_PIN  = 8;
constexpr uint8_t BRIGHTNESS = 60;   // keep low while testing on USB-sized adapters

// Distance thresholds in cm (tune at your desk).
constexpr int TOO_CLOSE = 40;
constexpr int CLOSE     = 55;

Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);

String input;
float r = 0, g = 0, b = 0;            // current color (faded)
uint8_t tr = 60, tg = 75, tb = 70;    // target color
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
  if (msg == "GREEN")      setTarget(65, 220, 145);
  else if (msg == "AMBER") setTarget(245, 170, 45);
  else if (msg == "RED")   setTarget(230, 65, 60);
  else                     setTarget(60, 75, 70);   // IDLE or anything else
}

void sensorDemo() {
  if (distanceCm < 0)              setTarget(40, 50, 60);     // nobody there
  else if (distanceCm < TOO_CLOSE) setTarget(230, 65, 60);    // red
  else if (distanceCm < CLOSE)     setTarget(245, 170, 45);   // amber
  else                             setTarget(200, 200, 185);  // soft white
}

void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
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
    else if (input.length() < 20) input += c;
  }
  if (appConnected && millis() - lastMessage > 4000) appConnected = false;

  // 2. Distance, ~6 times a second.
  if (millis() - lastPing > 150) {
    lastPing = millis();
    distanceCm = readDistanceSmooth();
    Serial.print("DIST ");
    Serial.println(distanceCm);
    if (!appConnected) sensorDemo();
  }

  // 3. Smooth fade toward the target color.
  if (millis() - lastFrame > 20) {
    lastFrame = millis();
    r += (tr - r) * .07; g += (tg - g) * .07; b += (tb - b) * .07;
    showAll(r, g, b);
  }
}
