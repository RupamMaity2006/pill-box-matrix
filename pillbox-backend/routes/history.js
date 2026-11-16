const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/history?limit=50
router.get('/', (req, res) => {
  const limit = Number(req.query.limit) || 100;
  const rows = db
    .prepare('SELECT * FROM history WHERE user_id = ? ORDER BY log_date DESC, id DESC LIMIT ?')
    .all(req.userId, limit);
  res.json(rows);
});

router.delete('/:id', (req, res) => {
  const result = db
    .prepare('DELETE FROM history WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.userId);
  if (result.changes === 0) return res.status(404).json({ error: 'History entry not found' });
  res.status(204).send();
});

module.exports = router;
