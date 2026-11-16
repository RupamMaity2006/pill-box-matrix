# Bluetooth mode (carry the box anywhere)

In this mode the box works **on its own**. It keeps its own clock and
schedule, opens lids at dose time, and remembers button presses. When you
are back near your PC, the dashboard connects over Bluetooth, updates the
box, and uploads the doses it recorded while away.

Firmware: `hardware/pillbox_esp32_ble/pillbox_esp32_ble.ino`
(This replaces the WiFi sketch — flash one or the other.)

## 1. Flash the box (one time)

1. Install the Arduino IDE and the ESP32 board package (see `hardware/README.md`, section 3).
2. Install the library **ESP32Servo** (Sketch -> Include Library -> Manage Libraries).
   Bluetooth and Preferences are already included with the ESP32 package.
3. Open `pillbox_esp32_ble.ino`. Set `NUM_COMPARTMENTS`, `SERVO_PINS`, `BUTTON_PINS` to match your wiring.
4. Plug in the ESP32 -> Tools -> Port -> choose it -> click Upload.
5. Open Tools -> Serial Monitor (115200). You should see: `Bluetooth ready — advertising as "Pillbox"`.

## 2. Connect from the dashboard

1. Turn on Bluetooth in Windows (Settings -> Bluetooth & devices).
2. Start the server (`npm start`) and open **http://localhost:4000** in **Chrome or Edge**.
   (Not the 192.168.x.x address — the browser blocks Bluetooth there.)
3. Log in -> **Device** -> **Connect via Bluetooth**.
4. A popup lists nearby devices. Select **Pillbox** -> **Pair**.
5. The dashboard sends the clock + schedule automatically. Use **Test lid** to check a servo.

You don't need to pair in Windows settings — the browser popup is enough.

## 3. Using it outside

- Power the box from a USB power bank (or a battery pack with 5V output).
- It opens each lid at its dose time and closes it when you press the button.
- Back home: open the dashboard, click **Connect via Bluetooth**. Doses taken
  while away are uploaded and show up in History.
- After you change a medicine's time/compartment, keep the box connected for
  a moment (or click **Sync now**) so it receives the new schedule.

## 4. Important limits

- **Clock:** without a DS3231 clock module, the box forgets the time when
  power is removed and keeps lids closed until the next Bluetooth sync.
  For real outdoor use, add a DS3231 (SDA->GPIO21, SCL->GPIO22) and set
  `USE_DS3231` to `1` in the sketch (also install the **RTClib** library).
- **Missed doses are not recorded** while away — only button presses are.
- The box stores up to 30 un-uploaded doses and 16 schedule entries.
- A lid stays available from 5 minutes before to 60 minutes after the dose
  time (`OPEN_BEFORE_MIN` / `OPEN_AFTER_MIN` in the sketch).
- Web Bluetooth does not work on iPhone/Safari. Android Chrome works, but the
  server runs on your PC, so away from home the box simply works alone.

## 5. Troubleshooting

- **Popup shows no devices:** check the box is powered and the Serial Monitor
  says "advertising"; make sure PC Bluetooth is on; close other apps connected to it.
- **"Bluetooth needs Chrome or Edge":** use Chrome/Edge, at http://localhost:4000.
- **Lid doesn't open at dose time:** Serial Monitor — if it says "Clock not set",
  connect once to set the time. Check the medicine's compartment number is within `NUM_COMPARTMENTS`.
- **Disconnects while syncing:** move the box closer to the PC and click Sync now.
