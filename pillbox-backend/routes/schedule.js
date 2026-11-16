const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/schedule?date=2026-09-09  (defaults to today)
router.get('/', (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const rows = db
    .prepare('SELECT * FROM schedule_items WHERE user_id = ? AND for_date = ? ORDER BY time')
    .all(req.userId, date);
  res.json(rows);
});

// POST /api/schedule
router.post('/', (req, res) => {
  const { medicineId, medName, dose, time, instruction, status, forDate } = req.body;
  if (!medName || !dose || !time) {
    return res.status(400).json({ error: 'medName, dose, time are required' });
  }
  const info = db
    .prepare(
      `INSERT INTO schedule_items (user_id, medicine_id, med_name, dose, time, instruction, status, for_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, date('now')))`
    )
    .run(
      req.userId,
      medicineId || null,
      medName,
      dose,
      time,
      instruction || 'As directed',
      status || 'upcoming',
      forDate || null
    );
  const created = db.prepare('SELECT * FROM schedule_items WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(created);
});

// PUT /api/schedule/:id  (edit, or mark taken/missed by setting status)
router.put('/:id', (req, res) => {
  const existing = db
    .prepare('SELECT * FROM schedule_items WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Schedule item not found' });

  const { medName, dose, time, instruction, status } = req.body;
  const next = {
    medName: medName ?? existing.med_name,
    dose: dose ?? existing.dose,
    time: time ?? existing.time,
    instruction: instruction ?? existing.instruction,
    status: status ?? existing.status,
  };

  db.prepare(
    `UPDATE schedule_items SET med_name=?, dose=?, time=?, instruction=?, status=?
     WHERE id=? AND user_id=?`
  ).run(next.medName, next.dose, next.time, next.instruction, next.status, req.params.id, req.userId);

  // If marked taken, log it to history too — this is what feeds the
  // Adherence & History page.
  if (status === 'taken') {
    db.prepare(
      `INSERT INTO history (user_id, medicine_name, scheduled_at, taken_at, status)
       VALUES (?, ?, ?, ?, 'taken')`
    ).run(req.userId, next.medName, next.time, new Date().toTimeString().slice(0, 5));
  }

  const updated = db.prepare('SELECT * FROM schedule_items WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// DELETE /api/schedule/:id
router.delete('/:id', (req, res) => {
  const result = db
    .prepare('DELETE FROM schedule_items WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.userId);
  if (result.changes === 0) return res.status(404).json({ error: 'Schedule item not found' });
  res.status(204).send();
});

module.exports = router;
