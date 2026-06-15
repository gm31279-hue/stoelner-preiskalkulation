'use strict';

const path = require('node:path');
const fs = require('node:fs');
const express = require('express');

const auth = require('./src/auth');
const authRoutes = require('./src/routes/auth');
const apiRoutes = require('./src/routes/api');

// DB-Initialisierung + Seed beim ersten Start sicherstellen.
require('./src/db');
require('./src/seed').ensureSeed();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '256kb' }));
app.use(auth.attachUser);

app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);

// Statisches Frontend
app.use(express.static(path.join(__dirname, 'public')));

// SPA-Fallback (alles außer /api -> index.html)
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Serverfehler' });
});

app.listen(PORT, () => {
  console.log(`Stölner BSC läuft auf http://localhost:${PORT}`);
});
