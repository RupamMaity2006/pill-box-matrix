const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM alerts WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.userId);
  res.json(rows);
});

router.post('/', (req, res) => {
  const { type, title, description } = req.body;
  if (!type || !title || !description) {
    return res.status(400).json({ error: 'type, title, description are required' });
  }
  const info = db
    .prepare('INSERT INTO alerts (user_id, type, title, description) VALUES (?, ?, ?, ?)')
    .run(req.userId, type, title, description);
  const created = db.prepare('SELECT * FROM alerts WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(created);
});

router.delete('/:id', (req, res) => {
  const result = db
    .prepare('DELETE FROM alerts WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.userId);
  if (result.changes === 0) return res.status(404).json({ error: 'Alert not found' });
  res.status(204).send();
});

// DELETE /api/alerts  — "mark all as read" clears everything at once
router.delete('/', (req, res) => {
  db.prepare('DELETE FROM alerts WHERE user_id = ?').run(req.userId);
  res.status(204).send();
});

module.exports = router;
