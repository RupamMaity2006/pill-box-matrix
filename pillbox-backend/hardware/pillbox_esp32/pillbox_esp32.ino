/*
  Pillbox ESP32 firmware
  ----------------------
  Polls the Pillbox server for which compartments should be unlocked right
  now, moves that compartment's servo to the open position, and reads a
  button per compartment — pressing it reports "taken" back to the server.

  SETUP BEFORE FLASHING:
  1. Fill in WIFI_SSID / WIFI_PASSWORD below.
  2. Fill in SERVER_HOST with your PC's local IP address (NOT "localhost" —
     find it on the PC with: Command Prompt -> ipconfig -> "IPv4 Address").
  3. Fill in DEVICE_KEY — copy this from the "Device" page in the dashboard
     after clicking "Generate new key".
  4. Set NUM_COMPARTMENTS and the pin arrays below to match your wiring.

  LIBRARIES NEEDED (Arduino IDE -> Tools -> Manage Libraries):
  - "ESP32Servo" by Kevin Harrington / John K. Bennett
  - ArduinoJson (by Benoit Blanchon)
  These come on top of the built-in WiFi.h and HTTPClient.h that ship with
  the ESP32 board package.

  BOARD SETUP:
  Arduino IDE -> Tools -> Board -> install "esp32" by Espressif Systems via
  Boards Manager if you haven't already, then select your specific ESP32
  board (e.g. "ESP32 Dev Module").
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>

// ---------------- Configuration — edit these ----------------
const char* WIFI_SSID     = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* SERVER_HOST   = "192.168.1.100";   // your PC's local IP — see setup notes above
const int   SERVER_PORT   = 4000;
const char* DEVICE_KEY    = "PASTE_YOUR_DEVICE_KEY_HERE";

const int NUM_COMPARTMENTS = 5;                       // how many compartments this box has
const int SERVO_PINS[NUM_COMPARTMENTS]  = {13, 12, 14, 27, 26}; // one PWM-capable pin per lid servo
const int BUTTON_PINS[NUM_COMPARTMENTS] = {32, 33, 25, 15, 4};  // one digital input pin per button

const int SERVO_CLOSED_ANGLE = 0;    // degrees — lid shut
const int SERVO_OPEN_ANGLE   = 90;   // degrees — lid open enough to access the compartment

const unsigned long POLL_INTERVAL_MS = 30000; // how often to check /api/device/state
// --------------------------------------------------------------

Servo servos[NUM_COMPARTMENTS];
bool compartmentOpen[NUM_COMPARTMENTS] = { false };
unsigned long lastPoll = 0;

String baseUrl() {
  return String("http://") + SERVER_HOST + ":" + SERVER_PORT;
}

void connectWiFi() {
  Serial.print("Connecting to WiFi");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("Connected. IP address: ");
  Serial.println(WiFi.localIP());
}

// Move compartment N's lid open or closed, only if it's not already there.
void setCompartmentOpen(int compartmentIndex, bool open) {
  if (compartmentOpen[compartmentIndex] == open) return;
  servos[compartmentIndex].write(open ? SERVO_OPEN_ANGLE : SERVO_CLOSED_ANGLE);
  compartmentOpen[compartmentIndex] = open;
  Serial.printf("Compartment %d -> %s\n", compartmentIndex + 1, open ? "OPEN" : "CLOSED");
}

// GET /api/device/state and open/close lids to match what the server says.
void pollState() {
  HTTPClient http;
  http.begin(baseUrl() + "/api/device/state");
  http.addHeader("X-Device-Key", DEVICE_KEY);

  int code = http.GET();
  if (code != 200) {
    Serial.printf("GET /api/device/state failed, HTTP %d\n", code);
    http.end();
    return;
  }

  String body = http.getString();
  http.end();

  StaticJsonDocument<2048> doc;
  DeserializationError err = deserializeJson(doc, body);
  if (err) {
    Serial.print("JSON parse failed: ");
    Serial.println(err.c_str());
    return;
  }

  // Default everything closed, then open only what the server says to.
  bool wantOpen[NUM_COMPARTMENTS] = { false };

  for (JsonObject c : doc["compartments"].as<JsonArray>()) {
    int compartment = c["compartment"];
    bool shouldUnlock = c["shouldUnlock"];
    int idx = compartment - 1; // compartments are numbered 1..N in the app
    if (idx >= 0 && idx < NUM_COMPARTMENTS) {
      wantOpen[idx] = shouldUnlock;
    }
  }

  for (int i = 0; i < NUM_COMPARTMENTS; i++) {
    setCompartmentOpen(i, wantOpen[i]);
  }
}

// POST /api/device/ack — tell the server compartment N's button was pressed.
void sendAck(int compartmentNumber) {
  HTTPClient http;
  http.begin(baseUrl() + "/api/device/ack");
  http.addHeader("X-Device-Key", DEVICE_KEY);
  http.addHeader("Content-Type", "application/json");

  String payload = String("{\"compartment\":") + compartmentNumber + "}";
  int code = http.POST(payload);
  String response = http.getString();
  http.end();

  Serial.printf("ack compartment %d -> HTTP %d: %s\n", compartmentNumber, code, response.c_str());

  if (code == 200) {
    // Dose confirmed taken — close the lid right away rather than waiting
    // for the next poll.
    setCompartmentOpen(compartmentNumber - 1, false);
  }
}

void setup() {
  Serial.begin(115200);
  connectWiFi();

  for (int i = 0; i < NUM_COMPARTMENTS; i++) {
    servos[i].attach(SERVO_PINS[i]);
    servos[i].write(SERVO_CLOSED_ANGLE);
    pinMode(BUTTON_PINS[i], INPUT_PULLUP); // button wired between pin and GND
  }

  pollState(); // get an initial state immediately instead of waiting 30s
  lastPoll = millis();
}

void loop() {
  // Poll the server periodically.
  if (millis() - lastPoll >= POLL_INTERVAL_MS) {
    pollState();
    lastPoll = millis();
  }

  // Check every button on every loop for a responsive press.
  for (int i = 0; i < NUM_COMPARTMENTS; i++) {
    if (digitalRead(BUTTON_PINS[i]) == LOW) { // pressed (pulled to GND)
      sendAck(i + 1);
      delay(400); // simple debounce so one press doesn't register 50 times
    }
  }

  delay(20);
}
