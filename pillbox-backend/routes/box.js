// routes/box.js
// Used by the dashboard (logged-in user, normal JWT) when it syncs with the
// box over Bluetooth. The box records button presses while it is away from
// the PC; the dashboard uploads them here when it reconnects.
//
// POST /api/box/events
//   body: { events: [ { compartment: 1, date: "2026-09-08", time: "08:03" } ] }
// Each event = "the button on this compartment was pressed on this date at
// this time". Safe to send the same event twice — duplicates are ignored.

const express = require('express');
const db = require('../db');

const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

router.post('/events', (req, res) => {
  const events = Array.isArray(req.body.events) ? req.body.events : [];
  if (events.length > 200) return res.status(400).json({ error: 'Too many events at once' });

  const findMed = db.prepare('SELECT * FROM medicines WHERE user_id = ? AND compartment = ? ORDER BY id LIMIT 1');
  const findDup = db.prepare(
    `SELECT id FROM history
     WHERE user_id = ? AND medicine_name = ? AND log_date = ? AND scheduled_at = ? AND status = 'taken'`
  );
  const findItem = db.prepare(
    `SELECT id FROM schedule_items
     WHERE user_id = ? AND medicine_id = ? AND for_date = ? AND status = 'upcoming' LIMIT 1`
  );
  const markTaken = db.prepare("UPDATE schedule_items SET status = 'taken' WHERE id = ?");
  const addHistory = db.prepare(
    `INSERT INTO history (user_id, medicine_name, scheduled_at, taken_at, status, log_date)
     VALUES (?, ?, ?, ?, 'taken', ?)`
  );

  let saved = 0, duplicates = 0, skipped = 0;

  const run = db.transaction(() => {
    for (const ev of events) {
      const compartment = Number(ev.compartment);
      if (!compartment || !DATE_RE.test(ev.date || '') || !TIME_RE.test(ev.time || '')) { skipped++; continue; }

      const med = findMed.get(req.userId, compartment);
      if (!med) { skipped++; continue; }

      if (findDup.get(req.userId, med.name, ev.date, med.time)) { duplicates++; continue; }

      const item = findItem.get(req.userId, med.id, ev.date);
      if (item) markTaken.run(item.id);

      addHistory.run(req.userId, med.name, med.time, ev.time, ev.date);
      saved++;
    }
  });
  run();

  res.json({ ok: true, saved, duplicates, skipped });
});

module.exports = router;
