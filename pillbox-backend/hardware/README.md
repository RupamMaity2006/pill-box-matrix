# Connecting the physical Pillbox to the software

> Want to carry the box outside? See **BLUETOOTH.md** for the offline/Bluetooth version.

This makes the hardware talk to the same server your dashboard uses —
same account, same database, same schedule. No separate app.

## What each side does

- **Your PC** keeps running `npm start` like always. Nothing changes here.
- **The ESP32** joins your WiFi and asks the server, every ~30 seconds,
  "which compartments should be unlocked right now?" It opens those lids
  with a servo. When you press the button on a compartment, it tells the
  server "this dose was taken," which updates the dashboard automatically.

## 1. Get your device key

1. Start the server (`npm start`) and open `http://localhost:4000` in a browser.
2. Log in, click **Device** in the sidebar.
3. Click **Generate new key**. Copy the long string that appears — you'll
   paste it into the firmware in step 4.

## 2. Find your PC's local IP address

The ESP32 can't use `localhost` — that would point it at itself. It needs
your PC's actual address on your WiFi network.

1. On the PC running the server, open Command Prompt.
2. Run: `ipconfig`
3. Look for **"IPv4 Address"** under your active WiFi adapter — something
   like `192.168.1.100`.
4. Make sure the ESP32 and this PC are on the **same WiFi network**.
5. Windows Firewall may block incoming connections to port 4000 the first
   time — if the ESP32 can't connect, open **Windows Defender Firewall** →
   **Advanced settings** → **Inbound Rules** → **New Rule** → **Port** →
   TCP, port `4000` → **Allow the connection** → apply to all profiles.

## 3. Install the Arduino IDE and ESP32 support

1. Download and install the **Arduino IDE** from arduino.cc/en/software.
2. Open it → **File → Preferences** → in "Additional Boards Manager URLs"
   paste: `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
3. **Tools → Board → Boards Manager** → search "esp32" → install the one
   by **Espressif Systems**.
4. **Tools → Board** → select your specific board (commonly "ESP32 Dev Module").
5. **Sketch → Include Library → Manage Libraries** → install:
   - **ESP32Servo** (by Kevin Harrington / John K. Bennett)
   - **ArduinoJson** (by Benoit Blanchon)

## 4. Edit and flash the firmware

1. Open `hardware/pillbox_esp32/pillbox_esp32.ino` in the Arduino IDE.
2. At the top, fill in:
   ```cpp
   const char* WIFI_SSID     = "YOUR_WIFI_NAME";
   const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
   const char* SERVER_HOST   = "192.168.1.100";   // your PC's IP from step 2
   const char* DEVICE_KEY    = "...";              // from step 1
   ```
3. Update `NUM_COMPARTMENTS`, `SERVO_PINS`, and `BUTTON_PINS` to match how
   many compartments your box has and which GPIO pins each servo/button
   is wired to.
4. Plug the ESP32 into your computer via USB.
5. **Tools → Port** → select the COM port that appeared when you plugged
   it in.
6. Click the **Upload** (right arrow) button.
7. Once it says "Done uploading," open **Tools → Serial Monitor** (set
   baud rate to `115200`) to watch it connect to WiFi and start polling —
   useful for confirming it's talking to the server correctly.

## 5. Wiring, per compartment

- **Servo**: signal wire → the GPIO pin you listed in `SERVO_PINS`; power
  (red) → 5V; ground (brown/black) → GND. Small hobby servos (SG90-class)
  can usually be powered from the ESP32's 5V pin for a handful of them;
  for more than ~4 servos, use a separate 5V power supply for the servos
  (with a shared ground to the ESP32) so the board doesn't brown out.
- **Button**: one leg to the GPIO pin listed in `BUTTON_PINS`, the other
  leg to **GND**. The firmware uses `INPUT_PULLUP`, so no external
  resistor is needed — the pin reads LOW when pressed.

## 6. How the medicine ↔ compartment mapping works

This already exists in your dashboard — each medicine has a
**Compartment** number (set when you add/edit it on the Medicines page).
The hardware doesn't need its own separate config for this: compartment 1
in the app is compartment 1 on the box (servo/button index 0 in the
firmware's arrays), and so on. Change a medicine's compartment number in
the app, and the hardware picks it up on its next poll — no re-flashing
needed.

## 7. What the two endpoints actually do

- `GET /api/device/state` — returns every compartment with something
  scheduled today, and whether it `shouldUnlock` right now. A compartment
  unlocks 5 minutes before its scheduled time and stays unlocked for an
  hour afterward (or until the button is pressed), so a slightly-late dose
  still gets served. Adjust `OPEN_BEFORE_MINUTES` / `OPEN_AFTER_MINUTES`
  in `routes/device.js` if you want a different window.
- `POST /api/device/ack` — body `{ "compartment": 4 }`. Marks the
  earliest still-upcoming dose in that compartment as taken today, and
  logs it to history — identical to clicking "Mark taken" in the browser.

## 8. Testing without hardware first

You can test the whole flow with `curl` before wiring anything up:

```bash
# Check what should be unlocked right now
curl http://localhost:4000/api/device/state -H "X-Device-Key: YOUR_KEY"

# Simulate a button press on compartment 1
curl -X POST http://localhost:4000/api/device/ack \
  -H "X-Device-Key: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"compartment":1}'
```
If the second command returns `{"ok":true,...}`, refresh the dashboard —
that dose should now show as "Taken."
