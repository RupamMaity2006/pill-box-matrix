/*
  Pillbox ESP32 firmware — BLUETOOTH version (works away from WiFi / your PC)
  ---------------------------------------------------------------------------
  The box does the work by itself:
    - keeps its own clock and its own copy of the schedule (saved in flash,
      so it survives being switched off)
    - opens a compartment's lid when its dose time arrives
    - when you press that compartment's button, closes the lid and records
      the dose (saved in flash until the dashboard collects it)

  The dashboard (Chrome/Edge, Device page -> "Connect via Bluetooth") then:
    - sets the box's clock and sends it the schedule
    - collects the doses recorded while the box was away and uploads them

  LIBRARIES (Arduino IDE -> Sketch -> Include Library -> Manage Libraries):
    - "ESP32Servo"  (the Bluetooth + Preferences libraries come with the
      ESP32 board package — nothing else to install)
    - "RTClib" by Adafruit — ONLY if you set USE_DS3231 to 1 below

  IMPORTANT ABOUT THE CLOCK:
    The ESP32's built-in clock is forgotten when power is removed. With
    USE_DS3231 = 0 the box needs a Bluetooth sync after every power-on
    before it can open lids (it keeps lids CLOSED until it knows the time).
    For carrying the box outside, add a DS3231 clock module (about $2-3,
    wired SDA -> GPIO21, SCL -> GPIO22, VCC -> 3V3, GND -> GND) and set
    USE_DS3231 to 1 — then the box always knows the time, even after a
    battery change.
*/

#include <Preferences.h>
#include <ESP32Servo.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <time.h>
#include <sys/time.h>

#define USE_DS3231 0
#if USE_DS3231
  #include <Wire.h>
  #include <RTClib.h>
  RTC_DS3231 rtc;
#endif

// ---------------- Configuration — edit these ----------------
const int NUM_COMPARTMENTS = 5;
const int SERVO_PINS[NUM_COMPARTMENTS]  = {13, 12, 14, 27, 26};  // one PWM pin per lid servo
const int BUTTON_PINS[NUM_COMPARTMENTS] = {32, 33, 25, 15, 4};   // one pin per button (other leg to GND)

const int SERVO_CLOSED_ANGLE = 0;
const int SERVO_OPEN_ANGLE   = 90;

const int OPEN_BEFORE_MIN = 5;    // lid opens this many minutes before the dose time
const int OPEN_AFTER_MIN  = 60;   // ...and stays available this long after (until the button is pressed)
// --------------------------------------------------------------

// Bluetooth identifiers — must match the dashboard (public/index.html).
#define SERVICE_UUID "7a1c0001-6b2f-4d5e-9c3a-1f2e3d4c5b6a"
#define CMD_UUID     "7a1c0002-6b2f-4d5e-9c3a-1f2e3d4c5b6a"   // dashboard -> box (write)
#define EVT_UUID     "7a1c0003-6b2f-4d5e-9c3a-1f2e3d4c5b6a"   // box -> dashboard (notify)

struct Dose {
  uint8_t  comp;      // compartment number 1..NUM_COMPARTMENTS
  uint16_t minutes;   // minutes after midnight, e.g. 08:30 -> 510
  uint32_t lastDay;   // yyyymmdd of the last day this dose was taken (0 = never)
};
const int MAX_DOSES = 16;
Dose doses[MAX_DOSES];  int doseCount = 0;
Dose pend[MAX_DOSES];   int pendCount = 0;   // schedule being received, applied on SAVE

Preferences prefs;
Servo servos[NUM_COMPARTMENTS];
bool lidOpen[NUM_COMPARTMENTS] = { false };
unsigned long testUntil[NUM_COMPARTMENTS] = { 0 };
unsigned long lastPress[NUM_COMPARTMENTS] = { 0 };
unsigned long lastTick = 0;

bool timeValid = false;
String queueStr = "";   // doses waiting to be uploaded: "comp,hhmm,yyyymmdd;comp,hhmm,yyyymmdd;"

BLECharacteristic* evtChar = nullptr;
bool bleConnected = false;

// Commands arrive in the Bluetooth task; they are queued here and handled in loop().
const int CMDQ = 32;
String cmdQ[CMDQ];
volatile int qHead = 0, qTail = 0;

// ---------------- Clock ----------------
// The dashboard sends "local epoch seconds" (real epoch shifted by your timezone),
// so reading it back with gmtime gives your local wall-clock time directly.
void setClock(uint32_t localEpoch) {
  struct timeval tv = { (time_t)localEpoch, 0 };
  settimeofday(&tv, NULL);
  timeValid = true;
#if USE_DS3231
  rtc.adjust(DateTime(localEpoch));
#endif
  Serial.printf("Clock set (%lu)\n", (unsigned long)localEpoch);
}

bool getNow(struct tm &t) {
  if (!timeValid) return false;
  time_t now = time(nullptr);
  gmtime_r(&now, &t);
  return true;
}

uint32_t dayNumber(const struct tm &t) {
  return (uint32_t)(t.tm_year + 1900) * 10000 + (t.tm_mon + 1) * 100 + t.tm_mday;
}

// ---------------- Saved data ----------------
void saveSchedule() {
  String s;
  for (int i = 0; i < doseCount; i++) {
    s += String(doses[i].comp) + "," + String(doses[i].minutes) + "," + String(doses[i].lastDay) + ";";
  }
  prefs.putString("sched", s);
}

void loadSchedule() {
  String s = prefs.getString("sched", "");
  doseCount = 0;
  int start = 0;
  while (start < (int)s.length() && doseCount < MAX_DOSES) {
    int end = s.indexOf(';', start);
    if (end < 0) break;
    String item = s.substring(start, end);
    int a = item.indexOf(',');
    int b = item.indexOf(',', a + 1);
    if (a > 0 && b > a) {
      doses[doseCount].comp    = (uint8_t)item.substring(0, a).toInt();
      doses[doseCount].minutes = (uint16_t)item.substring(a + 1, b).toInt();
      doses[doseCount].lastDay = (uint32_t)strtoul(item.substring(b + 1).c_str(), NULL, 10);
      doseCount++;
    }
    start = end + 1;
  }
  Serial.printf("Loaded %d dose(s) from flash\n", doseCount);
}

void saveQueue() { prefs.putString("queue", queueStr); }

int queueCount() {
  int n = 0;
  for (int i = 0; i < (int)queueStr.length(); i++) if (queueStr[i] == ';') n++;
  return n;
}

void enqueueEvent(int comp, int hh, int mm, uint32_t day) {
  char buf[32];
  snprintf(buf, sizeof(buf), "%d,%02d%02d,%lu;", comp, hh, mm, (unsigned long)day);
  queueStr += buf;
  while (queueCount() > 30) {                       // keep the newest 30
    queueStr = queueStr.substring(queueStr.indexOf(';') + 1);
  }
  saveQueue();
}

// ---------------- Lids ----------------
void setLid(int i, bool open) {
  if (lidOpen[i] == open) return;
  servos[i].write(open ? SERVO_OPEN_ANGLE : SERVO_CLOSED_ANGLE);
  lidOpen[i] = open;
  Serial.printf("Compartment %d -> %s\n", i + 1, open ? "OPEN" : "CLOSED");
}

bool inWindow(const Dose &d, int nowMin) {
  return nowMin >= (int)d.minutes - OPEN_BEFORE_MIN && nowMin <= (int)d.minutes + OPEN_AFTER_MIN;
}

void updateLids() {
  struct tm t;
  bool ok = getNow(t);
  int nowMin = ok ? t.tm_hour * 60 + t.tm_min : -1;
  uint32_t today = ok ? dayNumber(t) : 0;

  bool want[NUM_COMPARTMENTS] = { false };
  if (ok) {
    for (int i = 0; i < doseCount; i++) {
      int idx = doses[i].comp - 1;
      if (idx < 0 || idx >= NUM_COMPARTMENTS) continue;
      if (doses[i].lastDay != today && inWindow(doses[i], nowMin)) want[idx] = true;
    }
  }
  for (int i = 0; i < NUM_COMPARTMENTS; i++) {
    if ((long)(testUntil[i] - millis()) > 0) want[i] = true;   // "Test lid" from the dashboard
    setLid(i, want[i]);
  }
}

// ---------------- Bluetooth output ----------------
void sendLine(const String &s) {
  if (!bleConnected || !evtChar) return;
  evtChar->setValue((uint8_t*)s.c_str(), s.length());
  evtChar->notify();
  delay(20);   // give the phone/PC time to receive each notification
}

void sendSync() {
  struct tm t;
  bool ok = getNow(t);
  char hdr[32];
  snprintf(hdr, sizeof(hdr), "S,%d,%02d%02d,%d", ok ? 1 : 0, ok ? t.tm_hour : 0, ok ? t.tm_min : 0, queueCount());
  sendLine(hdr);

  int start = 0;
  while (start < (int)queueStr.length()) {
    int end = queueStr.indexOf(';', start);
    if (end < 0) break;
    sendLine("T," + queueStr.substring(start, end));
    start = end + 1;
  }
  sendLine("END");
}

// ---------------- Button presses ----------------
void handlePress(int comp) {
  struct tm t;
  if (!getNow(t)) return;                       // no valid clock -> ignore
  int nowMin = t.tm_hour * 60 + t.tm_min;
  uint32_t today = dayNumber(t);

  for (int i = 0; i < doseCount; i++) {
    if (doses[i].comp == comp && doses[i].lastDay != today && inWindow(doses[i], nowMin)) {
      doses[i].lastDay = today;                 // taken today -> lid won't reopen
      saveSchedule();
      enqueueEvent(comp, t.tm_hour, t.tm_min, today);
      setLid(comp - 1, false);
      Serial.printf("Dose taken: compartment %d\n", comp);
      sendLine("N");                            // tell the dashboard, if connected
      return;
    }
  }
}

void checkButtons() {
  for (int i = 0; i < NUM_COMPARTMENTS; i++) {
    if (digitalRead(BUTTON_PINS[i]) == LOW && millis() - lastPress[i] > 600) {
      lastPress[i] = millis();
      handlePress(i + 1);
    }
  }
}

// ---------------- Commands from the dashboard ----------------
void commitSchedule() {
  // Keep "already taken today" for doses that didn't change, so re-syncing
  // doesn't reopen a lid you've already used.
  for (int i = 0; i < pendCount; i++) {
    for (int j = 0; j < doseCount; j++) {
      if (doses[j].comp == pend[i].comp && doses[j].minutes == pend[i].minutes) {
        pend[i].lastDay = doses[j].lastDay;
      }
    }
  }
  for (int i = 0; i < pendCount; i++) doses[i] = pend[i];
  doseCount = pendCount;
  saveSchedule();
  Serial.printf("Schedule saved: %d dose(s)\n", doseCount);
}

void processCommand(String c) {
  c.trim();
  if (c.startsWith("TIME,")) {
    setClock((uint32_t)strtoul(c.substring(5).c_str(), NULL, 10));
  } else if (c == "CLEAR") {
    pendCount = 0;
  } else if (c.startsWith("ADD,")) {
    int p = c.indexOf(',', 4);
    if (p > 0) {
      int comp = c.substring(4, p).toInt();
      int hhmm = c.substring(p + 1).toInt();
      int h = hhmm / 100, m = hhmm % 100;
      if (comp >= 1 && comp <= NUM_COMPARTMENTS && h < 24 && m < 60 && pendCount < MAX_DOSES) {
        pend[pendCount].comp = (uint8_t)comp;
        pend[pendCount].minutes = (uint16_t)(h * 60 + m);
        pend[pendCount].lastDay = 0;
        pendCount++;
      }
    }
  } else if (c == "SAVE") {
    commitSchedule();
  } else if (c == "SYNC") {
    sendSync();
  } else if (c == "CLEARQ") {
    queueStr = "";
    saveQueue();
  } else if (c.startsWith("TEST,")) {
    int comp = c.substring(5).toInt();
    if (comp >= 1 && comp <= NUM_COMPARTMENTS) testUntil[comp - 1] = millis() + 4000;
  }
}

// ---------------- Bluetooth callbacks ----------------
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* s) { bleConnected = true; Serial.println("Bluetooth: connected"); }
  void onDisconnect(BLEServer* s) {
    bleConnected = false;
    Serial.println("Bluetooth: disconnected");
    BLEDevice::startAdvertising();             // become visible again
  }
};

class CmdCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) {
    auto v = c->getValue();                    // std::string or String, depending on core version
    String s = String(v.c_str());
    int next = (qHead + 1) % CMDQ;
    if (next != qTail) { cmdQ[qHead] = s; qHead = next; }
  }
};

void setupBluetooth() {
  BLEDevice::init("Pillbox");
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  BLEService* svc = server->createService(SERVICE_UUID);

  BLECharacteristic* cmd = svc->createCharacteristic(
      CMD_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  cmd->setCallbacks(new CmdCallbacks());

  evtChar = svc->createCharacteristic(
      EVT_UUID, BLECharacteristic::PROPERTY_NOTIFY | BLECharacteristic::PROPERTY_READ);
  evtChar->addDescriptor(new BLE2902());

  svc->start();
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();
  Serial.println("Bluetooth ready — advertising as \"Pillbox\"");
}

// ---------------- Arduino entry points ----------------
void setup() {
  Serial.begin(115200);
  prefs.begin("pillbox", false);
  loadSchedule();
  queueStr = prefs.getString("queue", "");

  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);
  for (int i = 0; i < NUM_COMPARTMENTS; i++) {
    servos[i].setPeriodHertz(50);
    servos[i].attach(SERVO_PINS[i]);
    servos[i].write(SERVO_CLOSED_ANGLE);
    pinMode(BUTTON_PINS[i], INPUT_PULLUP);
  }

#if USE_DS3231
  Wire.begin();
  if (rtc.begin() && !rtc.lostPower()) {
    struct timeval tv = { (time_t)rtc.now().unixtime(), 0 };
    settimeofday(&tv, NULL);
    timeValid = true;
    Serial.println("Clock restored from DS3231");
  }
#endif

  setupBluetooth();
  Serial.println(timeValid ? "Clock OK" : "Clock not set — connect the dashboard over Bluetooth to set it");
}

void loop() {
  while (qTail != qHead) {                     // handle commands from the dashboard
    String c = cmdQ[qTail];
    qTail = (qTail + 1) % CMDQ;
    processCommand(c);
  }

  if (millis() - lastTick >= 500) {            // refresh lids twice a second
    lastTick = millis();
    updateLids();
  }

  checkButtons();
  delay(10);
}
