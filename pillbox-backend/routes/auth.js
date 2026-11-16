const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { signToken, requireAuth } = require('../auth');

const router = express.Router();

// GET /api/auth/me — lets the frontend validate a saved token on reload
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

// GET /api/auth/device-key — returns the current device key, if one exists
router.get('/device-key', requireAuth, (req, res) => {
  const row = db.prepare('SELECT device_api_key FROM users WHERE id = ?').get(req.userId);
  res.json({ deviceKey: row.device_api_key || null });
});

// POST /api/auth/device-key — generates a new device key, replacing any
// existing one (re-flash the device with the new key after calling this).
router.post('/device-key', requireAuth, (req, res) => {
  const key = crypto.randomBytes(24).toString('hex');
  db.prepare('UPDATE users SET device_api_key = ? WHERE id = ?').run(key, req.userId);
  res.json({ deviceKey: key });
});

router.post('/signup', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email and password are required' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
    .run(name, email, hash);

  // Seed the primary caregiver row (the account owner) so the Caregiver
  // page has something to show immediately.
  db.prepare(
    `INSERT INTO caregivers (user_id, name, relation, notify_via, status, removable)
     VALUES (?, ?, 'Primary user · This device', 'App notification', 'Active', 0)`
  ).run(info.lastInsertRowid, name);

  const token = signToken(info.lastInsertRowid);
  res.status(201).json({ token, user: { id: info.lastInsertRowid, name, email } });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = signToken(user.id);
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

module.exports = router;
