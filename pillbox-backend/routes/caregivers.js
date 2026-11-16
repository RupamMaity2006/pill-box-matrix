const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM caregivers WHERE user_id = ?').all(req.userId);
  res.json(rows);
});

router.post('/', (req, res) => {
  const { name, relation, notifyVia } = req.body;
  if (!name || !relation) return res.status(400).json({ error: 'name and relation are required' });
  const info = db
    .prepare(
      `INSERT INTO caregivers (user_id, name, relation, notify_via, status, removable)
       VALUES (?, ?, ?, ?, 'Invited', 1)`
    )
    .run(req.userId, name, relation, notifyVia || 'Email');
  const created = db.prepare('SELECT * FROM caregivers WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(created);
});

router.delete('/:id', (req, res) => {
  const row = db
    .prepare('SELECT * FROM caregivers WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.userId);
  if (!row) return res.status(404).json({ error: 'Caregiver not found' });
  if (!row.removable) return res.status(403).json({ error: 'This caregiver cannot be removed' });
  db.prepare('DELETE FROM caregivers WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  res.status(204).send();
});

module.exports = router;
