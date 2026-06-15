'use strict';

const crypto = require('node:crypto');
const db = require('./db');

const SESSION_DAYS = 14;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, expires);
  return token;
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function userFromToken(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.department_id, u.active,
           d.key AS department_key, d.name AS department_name, s.expires_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN departments d ON d.id = u.department_id
    WHERE s.token = ?
  `).get(token);
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    destroySession(token);
    return null;
  }
  if (!row.active) return null;
  delete row.expires_at;
  return row;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

// Middleware: attaches req.user (or null) based on the session cookie.
function attachUser(req, res, next) {
  const token = parseCookies(req).bsc_session;
  req.sessionToken = token;
  req.user = userFromToken(token);
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet' });
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }
    next();
  };
}

// Darf der Nutzer Daten dieser Abteilung bearbeiten?
function canEditDepartment(user, departmentId) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'viewer') return false;
  if (user.role === 'lead' || user.role === 'member') {
    return departmentId == null || user.department_id === departmentId;
  }
  return false;
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  userFromToken,
  attachUser,
  requireAuth,
  requireRole,
  canEditDepartment,
  SESSION_DAYS,
};
