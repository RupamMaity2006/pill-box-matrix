require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { requireAuth, requireDeviceAuth } = require('./auth');

const authRoutes = require('./routes/auth');
const medicineRoutes = require('./routes/medicines');
const scheduleRoutes = require('./routes/schedule');
const alertRoutes = require('./routes/alerts');
const historyRoutes = require('./routes/history');
const caregiverRoutes = require('./routes/caregivers');
const deviceRoutes = require('./routes/device');
const boxRoutes = require('./routes/box');

const app = express();
app.use(cors());
app.use(express.json());

// Public
app.use('/api/auth', authRoutes);

// Everything below requires a valid Bearer token (see auth.js)
app.use('/api/medicines', requireAuth, medicineRoutes);
app.use('/api/schedule', requireAuth, scheduleRoutes);
app.use('/api/alerts', requireAuth, alertRoutes);
app.use('/api/history', requireAuth, historyRoutes);
app.use('/api/caregivers', requireAuth, caregiverRoutes);

// Dashboard uploads doses recorded by the box while it was offline (Bluetooth sync)
app.use('/api/box', requireAuth, boxRoutes);

// Hardware talks here instead — its own auth scheme, see auth.js
app.use('/api/device', requireDeviceAuth, deviceRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Serve the frontend (public/index.html + assets) from the same origin
// as the API, so the whole thing is one app on one port.
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Pillbox API running on http://localhost:${PORT}`));
