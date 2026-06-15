'use strict';

const express = require('express');
const db = require('../db');
const auth = require('../auth');

const router = express.Router();

function setSessionCookie(res, token) {
  const maxAge = auth.SESSION_DAYS * 864e5;
  res.cookie('bsc_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge,
    path: '/',
  });
}

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'E-Mail und Passwort erforderlich' });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1')
    .get(String(email).toLowerCase().trim());
  if (!user || !auth.verifyPassword(password, user.pw_salt, user.pw_hash)) {
    return res.status(401).json({ error: 'E-Mail oder Passwort falsch' });
  }
  const token = auth.createSession(user.id);
  setSessionCookie(res, token);
  db.prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (?, ?, ?)')
    .run(user.id, 'login', '');
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  auth.destroySession(req.sessionToken);
  res.clearCookie('bsc_session', { path: '/' });
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: req.user });
});

// Eigenes Passwort ändern
router.post('/password', auth.requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  if (!next || String(next).length < 6) {
    return res.status(400).json({ error: 'Neues Passwort: mindestens 6 Zeichen' });
  }
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!auth.verifyPassword(current || '', u.pw_salt, u.pw_hash)) {
    return res.status(401).json({ error: 'Aktuelles Passwort falsch' });
  }
  const { salt, hash } = auth.hashPassword(next);
  db.prepare('UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ?').run(hash, salt, u.id);
  res.json({ ok: true });
});

module.exports = router;
