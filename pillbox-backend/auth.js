// auth.js
// Two auth schemes live here:
//  - requireAuth: verifies a user's JWT (Authorization: Bearer <jwt>), used
//    by the browser dashboard.
//  - requireDeviceAuth: verifies a long-lived device key (X-Device-Key
//    header), used by the ESP32 hardware. Kept separate from JWTs on
//    purpose — the device key never expires and is never tied to a login
//    session, so re-flashing firmware doesn't require re-authenticating.

const jwt = require('jsonwebtoken');
const db = require('./db');
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-this';

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    const payload = jwt.verify(token, SECRET);
    req.userId = payload.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireDeviceAuth(req, res, next) {
  const key = req.headers['x-device-key'];
  if (!key) return res.status(401).json({ error: 'Missing X-Device-Key header' });

  const user = db.prepare('SELECT id FROM users WHERE device_api_key = ?').get(key);
  if (!user) return res.status(401).json({ error: 'Invalid device key' });

  req.userId = user.id;
  next();
}

function signToken(userId) {
  return jwt.sign({ userId }, SECRET, { expiresIn: '30d' });
}

module.exports = { requireAuth, requireDeviceAuth, signToken };
