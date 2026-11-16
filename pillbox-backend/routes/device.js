// routes/device.js
// Endpoints the ESP32 hardware talks to. Authenticated by a long-lived
// device key (X-Device-Key header) instead of the JWT the browser uses —
// see requireDeviceAuth in auth.js.
//
// The hardware only needs two things:
//   1. GET  /api/device/state  — "which compartments should be unlocked
//      right now, and what's in them" — polled every 30-60s.
//   2. POST /api/device/ack    — "the button on compartment N was pressed,
//      mark that dose taken" — called once per button press.

const express = require('express');
const db = require('../db');

const router = express.Router();

// A compartment's lid should be open starting a few minutes before the
// scheduled time, and stays open for an hour afterward (or until the user
// presses the button) so a slightly-late dose still gets served.
const OPEN_BEFORE_MINUTES = 5;
const OPEN_AFTER_MINUTES = 60;

function minutesSinceMidnight(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// GET /api/device/state
router.get('/state', (req, res) => {
  const rows = db
    .prepare(
      `SELECT si.id, si.time, si.dose, si.instruction, si.status, si.med_name,
              m.compartment AS compartment
       FROM schedule_items si
       JOIN medicines m ON m.id = si.medicine_id
       WHERE si.user_id = ? AND si.for_date = date('now')`
    )
    .all(req.userId);

  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();

  const compartments = rows
    .filter(r => r.compartment != null)
    .map(r => {
      const schedMin = minutesSinceMidnight(r.time);
      const withinWindow =
        nowMin >= schedMin - OPEN_BEFORE_MINUTES && nowMin <= schedMin + OPEN_AFTER_MINUTES;
      const shouldUnlock = r.status === 'upcoming' && withinWindow;
      return {
        compartment: r.compartment,
        scheduleId: r.id,
        medicineName: r.med_name,
        dose: r.dose,
        instruction: r.instruction,
        scheduledTime: r.time,
        status: r.status,
        shouldUnlock,
      };
    });

  res.json({ serverTime: new Date().toTimeString().slice(0, 5), compartments });
});

// POST /api/device/ack   body: { compartment: 4 }
// Called when the physical button on a compartment is pressed. Marks the
// earliest still-upcoming dose in that compartment as taken today, and
// logs it to history — same effect as clicking "Mark taken" in the app.
router.post('/ack', (req, res) => {
  const compartment = Number(req.body.compartment);
  if (!compartment) return res.status(400).json({ error: 'compartment is required' });

  const item = db
    .prepare(
      `SELECT si.* FROM schedule_items si
       JOIN medicines m ON m.id = si.medicine_id
       WHERE si.user_id = ? AND m.compartment = ? AND si.for_date = date('now') AND si.status = 'upcoming'
       ORDER BY si.time LIMIT 1`
    )
    .get(req.userId, compartment);

  if (!item) {
    return res.status(404).json({ error: 'No upcoming dose found for that compartment today' });
  }

  db.prepare('UPDATE schedule_items SET status = ? WHERE id = ?').run('taken', item.id);
  db.prepare(
    `INSERT INTO history (user_id, medicine_name, scheduled_at, taken_at, status)
     VALUES (?, ?, ?, ?, 'taken')`
  ).run(req.userId, item.med_name, item.time, new Date().toTimeString().slice(0, 5));

  res.json({ ok: true, medicine: item.med_name, compartment });
});

module.exports = router;
