const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/medicines
router.get('/', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM medicines WHERE user_id = ? ORDER BY compartment')
    .all(req.userId);
  res.json(rows);
});

// POST /api/medicines
router.post('/', (req, res) => {
  const { name, dose, time, compartment, stock } = req.body;
  if (!name || !dose || !time || compartment == null || stock == null) {
    return res.status(400).json({ error: 'name, dose, time, compartment, stock are required' });
  }
  const daysLeft = Math.max(0, Math.round(stock / 2)); // same heuristic as the frontend demo
  const status = daysLeft <= 5 ? 'low' : 'good';

  const info = db
    .prepare(
      `INSERT INTO medicines (user_id, name, dose, time, compartment, stock, days_left, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(req.userId, name, dose, time, compartment, stock, daysLeft, status);

  // Also drop it into today's schedule, same as the frontend demo does.
  db.prepare(
    `INSERT INTO schedule_items (user_id, medicine_id, med_name, dose, time, instruction, status)
     VALUES (?, ?, ?, ?, ?, 'As directed', 'upcoming')`
  ).run(req.userId, info.lastInsertRowid, name, dose, time);

  const created = db.prepare('SELECT * FROM medicines WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(created);
});

// PUT /api/medicines/:id  (rename / edit)
router.put('/:id', (req, res) => {
  const existing = db
    .prepare('SELECT * FROM medicines WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Medicine not found' });

  const name = req.body.name ?? existing.name;
  const dose = req.body.dose ?? existing.dose;
  const time = req.body.time ?? existing.time;
  const compartment = req.body.compartment ?? existing.compartment;
  const stock = req.body.stock ?? existing.stock;
  const daysLeft = Math.max(0, Math.round(stock / 2));
  const status = daysLeft <= 5 ? 'low' : 'good';

  db.prepare(
    `UPDATE medicines SET name=?, dose=?, time=?, compartment=?, stock=?, days_left=?, status=?
     WHERE id=? AND user_id=?`
  ).run(name, dose, time, compartment, stock, daysLeft, status, req.params.id, req.userId);

  // Keep any schedule rows referencing this medicine in sync (mirrors the
  // rename-propagation the frontend does locally).
  db.prepare(
    `UPDATE schedule_items SET med_name=?, dose=? WHERE medicine_id=? AND user_id=?`
  ).run(name, dose, req.params.id, req.userId);

  const updated = db.prepare('SELECT * FROM medicines WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// DELETE /api/medicines/:id
router.delete('/:id', (req, res) => {
  const existing = db
    .prepare('SELECT * FROM medicines WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Medicine not found' });

  // schedule_items.medicine_id is ON DELETE SET NULL, so remove those rows
  // outright to match the frontend behavior of clearing the schedule too.
  db.prepare('DELETE FROM schedule_items WHERE medicine_id = ? AND user_id = ?').run(
    req.params.id,
    req.userId
  );
  db.prepare('DELETE FROM medicines WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  res.status(204).send();
});

module.exports = router;
