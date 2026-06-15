'use strict';

const express = require('express');
const db = require('../db');
const auth = require('../auth');
const events = require('../events');
const { kpiStatus, attainment, rollup, countByStatus } = require('../bsc');

const router = express.Router();

function log(userId, action, detail) {
  db.prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (?, ?, ?)')
    .run(userId, action, detail || '');
}

// Letzten Messwert je KPI vorladen (period DESC, dann id DESC).
function latestMeasurements() {
  const rows = db.prepare(`
    SELECT m.* FROM measurements m
    JOIN (
      SELECT kpi_id, MAX(period || '|' || printf('%012d', id)) AS mx
      FROM measurements GROUP BY kpi_id
    ) t ON t.kpi_id = m.kpi_id
       AND (m.period || '|' || printf('%012d', m.id)) = t.mx
  `).all();
  const map = new Map();
  for (const r of rows) map.set(r.kpi_id, r);
  return map;
}

// --------------------------------------------------------------------------
// Meta: Abteilungen, Perspektiven
// --------------------------------------------------------------------------
router.get('/meta', auth.requireAuth, (req, res) => {
  res.json({
    departments: db.prepare('SELECT * FROM departments ORDER BY sort, name').all(),
    perspectives: db.prepare('SELECT * FROM perspectives ORDER BY sort, name').all(),
  });
});

// --------------------------------------------------------------------------
// Scorecard: komplette aggregierte Sicht (optional ?department=key)
// --------------------------------------------------------------------------
router.get('/scorecard', auth.requireAuth, (req, res) => {
  const deptKey = req.query.department;
  let deptId = null;
  if (deptKey && deptKey !== 'all') {
    const d = db.prepare('SELECT id FROM departments WHERE key = ?').get(deptKey);
    if (d) deptId = d.id;
  }

  const perspectives = db.prepare('SELECT * FROM perspectives ORDER BY sort, name').all();
  const objectives = db.prepare('SELECT * FROM objectives ORDER BY sort, id').all();
  const kpis = db.prepare('SELECT * FROM kpis ORDER BY id').all();
  const latest = latestMeasurements();

  const kpisByObjective = new Map();
  for (const k of kpis) {
    if (deptId && k.department_id !== deptId) continue;
    const last = latest.get(k.id);
    const value = last ? last.value : null;
    const status = kpiStatus(k, value);
    const enriched = {
      ...k,
      value,
      period: last ? last.period : null,
      status,
      attainment: attainment(k, value),
    };
    if (!kpisByObjective.has(k.objective_id)) kpisByObjective.set(k.objective_id, []);
    kpisByObjective.get(k.objective_id).push(enriched);
  }

  const result = perspectives.map((p) => {
    const objs = objectives
      .filter((o) => o.perspective_id === p.id)
      .filter((o) => !deptId || o.department_id === deptId || kpisByObjective.has(o.id))
      .map((o) => {
        const oKpis = kpisByObjective.get(o.id) || [];
        return { ...o, kpis: oKpis, status: rollup(oKpis.map((k) => k.status)) };
      })
      .filter((o) => o.kpis.length || !deptId); // bei Filter nur Ziele mit Kennzahlen
    const allStatuses = objs.flatMap((o) => o.kpis.map((k) => k.status));
    return {
      ...p,
      objectives: objs,
      status: rollup(allStatuses),
      counts: countByStatus(allStatuses),
    };
  });

  const allStatuses = result.flatMap((p) => p.objectives.flatMap((o) => o.kpis.map((k) => k.status)));
  res.json({
    perspectives: result,
    overall: { status: rollup(allStatuses), counts: countByStatus(allStatuses) },
  });
});

// --------------------------------------------------------------------------
// KPI-Detail inkl. Verlauf
// --------------------------------------------------------------------------
router.get('/kpis/:id', auth.requireAuth, (req, res) => {
  const kpi = db.prepare('SELECT * FROM kpis WHERE id = ?').get(req.params.id);
  if (!kpi) return res.status(404).json({ error: 'Kennzahl nicht gefunden' });
  const measurements = db.prepare(`
    SELECT m.*, u.name AS author FROM measurements m
    LEFT JOIN users u ON u.id = m.created_by
    WHERE kpi_id = ? ORDER BY period ASC, id ASC
  `).all(kpi.id);
  const objective = db.prepare('SELECT * FROM objectives WHERE id = ?').get(kpi.objective_id);
  res.json({ kpi, objective, measurements });
});

// Messwert erfassen
router.post('/measurements', auth.requireAuth, (req, res) => {
  const { kpi_id, period, value, note } = req.body || {};
  const kpi = db.prepare('SELECT * FROM kpis WHERE id = ?').get(kpi_id);
  if (!kpi) return res.status(404).json({ error: 'Kennzahl nicht gefunden' });
  if (!auth.canEditDepartment(req.user, kpi.department_id)) {
    return res.status(403).json({ error: 'Keine Berechtigung für diese Abteilung' });
  }
  const num = Number(value);
  if (!period || Number.isNaN(num)) {
    return res.status(400).json({ error: 'Periode und gültiger Wert erforderlich' });
  }
  db.prepare(`INSERT INTO measurements (kpi_id, period, value, note, created_by)
              VALUES (?, ?, ?, ?, ?)`)
    .run(kpi.id, String(period).trim(), num, note || '', req.user.id);
  log(req.user.id, 'measurement', `KPI ${kpi.id} (${kpi.name}) = ${num}`);
  events.broadcast('scorecard');
  res.json({ ok: true });
});

router.delete('/measurements/:id', auth.requireAuth, (req, res) => {
  const m = db.prepare('SELECT m.*, k.department_id FROM measurements m JOIN kpis k ON k.id = m.kpi_id WHERE m.id = ?')
    .get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Nicht gefunden' });
  if (!auth.canEditDepartment(req.user, m.department_id)) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  db.prepare('DELETE FROM measurements WHERE id = ?').run(m.id);
  events.broadcast('scorecard');
  res.json({ ok: true });
});

// --------------------------------------------------------------------------
// Ziele (objectives) — Leitung/Admin
// --------------------------------------------------------------------------
router.post('/objectives', auth.requireRole('admin', 'lead'), (req, res) => {
  const { perspective_id, department_id, title, description, sort } = req.body || {};
  if (!perspective_id || !title) return res.status(400).json({ error: 'Perspektive und Titel erforderlich' });
  if (!auth.canEditDepartment(req.user, department_id || null)) {
    return res.status(403).json({ error: 'Keine Berechtigung für diese Abteilung' });
  }
  const info = db.prepare(`INSERT INTO objectives (perspective_id, department_id, title, description, sort)
              VALUES (?, ?, ?, ?, ?)`)
    .run(perspective_id, department_id || null, title.trim(), description || '', sort || 0);
  log(req.user.id, 'objective.create', title);
  events.broadcast('scorecard');
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});

router.put('/objectives/:id', auth.requireRole('admin', 'lead'), (req, res) => {
  const o = db.prepare('SELECT * FROM objectives WHERE id = ?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Nicht gefunden' });
  if (!auth.canEditDepartment(req.user, o.department_id)) return res.status(403).json({ error: 'Keine Berechtigung' });
  const { title, description, department_id, perspective_id, sort } = req.body || {};
  db.prepare(`UPDATE objectives SET title = ?, description = ?, department_id = ?, perspective_id = ?, sort = ? WHERE id = ?`)
    .run(title ?? o.title, description ?? o.description, department_id ?? o.department_id,
         perspective_id ?? o.perspective_id, sort ?? o.sort, o.id);
  events.broadcast('scorecard');
  res.json({ ok: true });
});

router.delete('/objectives/:id', auth.requireRole('admin', 'lead'), (req, res) => {
  const o = db.prepare('SELECT * FROM objectives WHERE id = ?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Nicht gefunden' });
  if (!auth.canEditDepartment(req.user, o.department_id)) return res.status(403).json({ error: 'Keine Berechtigung' });
  db.prepare('DELETE FROM objectives WHERE id = ?').run(o.id);
  log(req.user.id, 'objective.delete', o.title);
  events.broadcast('scorecard');
  res.json({ ok: true });
});

// --------------------------------------------------------------------------
// Kennzahlen (kpis) — Leitung/Admin
// --------------------------------------------------------------------------
const KPI_FIELDS = ['name', 'unit', 'direction', 'target', 'green_at', 'yellow_at', 'frequency', 'owner', 'department_id'];

router.post('/kpis', auth.requireRole('admin', 'lead'), (req, res) => {
  const b = req.body || {};
  if (!b.objective_id || !b.name) return res.status(400).json({ error: 'Ziel und Name erforderlich' });
  if (!auth.canEditDepartment(req.user, b.department_id || null)) {
    return res.status(403).json({ error: 'Keine Berechtigung für diese Abteilung' });
  }
  const info = db.prepare(`INSERT INTO kpis
      (objective_id, department_id, name, unit, direction, target, green_at, yellow_at, frequency, owner)
      VALUES (@objective_id, @department_id, @name, @unit, @direction, @target, @green_at, @yellow_at, @frequency, @owner)`)
    .run({
      objective_id: b.objective_id,
      department_id: b.department_id || null,
      name: b.name.trim(),
      unit: b.unit || '',
      direction: b.direction === 'down' ? 'down' : 'up',
      target: b.target != null && b.target !== '' ? Number(b.target) : null,
      green_at: b.green_at != null && b.green_at !== '' ? Number(b.green_at) : null,
      yellow_at: b.yellow_at != null && b.yellow_at !== '' ? Number(b.yellow_at) : null,
      frequency: b.frequency || 'monatlich',
      owner: b.owner || '',
    });
  log(req.user.id, 'kpi.create', b.name);
  events.broadcast('scorecard');
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});

router.put('/kpis/:id', auth.requireRole('admin', 'lead'), (req, res) => {
  const k = db.prepare('SELECT * FROM kpis WHERE id = ?').get(req.params.id);
  if (!k) return res.status(404).json({ error: 'Nicht gefunden' });
  if (!auth.canEditDepartment(req.user, k.department_id)) return res.status(403).json({ error: 'Keine Berechtigung' });
  const b = req.body || {};
  const merged = { ...k };
  for (const f of KPI_FIELDS) {
    if (b[f] !== undefined) {
      if (['target', 'green_at', 'yellow_at'].includes(f)) merged[f] = b[f] === '' || b[f] == null ? null : Number(b[f]);
      else merged[f] = b[f];
    }
  }
  db.prepare(`UPDATE kpis SET name=@name, unit=@unit, direction=@direction, target=@target,
      green_at=@green_at, yellow_at=@yellow_at, frequency=@frequency, owner=@owner, department_id=@department_id
      WHERE id=@id`).run({ ...merged, id: k.id });
  log(req.user.id, 'kpi.update', merged.name);
  events.broadcast('scorecard');
  res.json({ ok: true });
});

router.delete('/kpis/:id', auth.requireRole('admin', 'lead'), (req, res) => {
  const k = db.prepare('SELECT * FROM kpis WHERE id = ?').get(req.params.id);
  if (!k) return res.status(404).json({ error: 'Nicht gefunden' });
  if (!auth.canEditDepartment(req.user, k.department_id)) return res.status(403).json({ error: 'Keine Berechtigung' });
  db.prepare('DELETE FROM kpis WHERE id = ?').run(k.id);
  log(req.user.id, 'kpi.delete', k.name);
  events.broadcast('scorecard');
  res.json({ ok: true });
});

// --------------------------------------------------------------------------
// Maßnahmen (initiatives)
// --------------------------------------------------------------------------
router.get('/initiatives', auth.requireAuth, (req, res) => {
  const deptKey = req.query.department;
  let rows;
  if (deptKey && deptKey !== 'all') {
    rows = db.prepare(`SELECT i.*, d.name AS department_name, o.title AS objective_title
      FROM initiatives i LEFT JOIN departments d ON d.id = i.department_id
      LEFT JOIN objectives o ON o.id = i.objective_id
      WHERE d.key = ? ORDER BY (i.status='erledigt'), i.due_date IS NULL, i.due_date`).all(deptKey);
  } else {
    rows = db.prepare(`SELECT i.*, d.name AS department_name, o.title AS objective_title
      FROM initiatives i LEFT JOIN departments d ON d.id = i.department_id
      LEFT JOIN objectives o ON o.id = i.objective_id
      ORDER BY (i.status='erledigt'), i.due_date IS NULL, i.due_date`).all();
  }
  res.json({ initiatives: rows });
});

router.post('/initiatives', auth.requireAuth, (req, res) => {
  if (req.user.role === 'viewer') return res.status(403).json({ error: 'Keine Berechtigung' });
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: 'Titel erforderlich' });
  if (!auth.canEditDepartment(req.user, b.department_id || null)) {
    return res.status(403).json({ error: 'Keine Berechtigung für diese Abteilung' });
  }
  const info = db.prepare(`INSERT INTO initiatives
      (objective_id, department_id, title, status, responsible, due_date, progress, note)
      VALUES (@objective_id, @department_id, @title, @status, @responsible, @due_date, @progress, @note)`)
    .run({
      objective_id: b.objective_id || null,
      department_id: b.department_id || null,
      title: b.title.trim(),
      status: b.status || 'offen',
      responsible: b.responsible || '',
      due_date: b.due_date || null,
      progress: Number(b.progress) || 0,
      note: b.note || '',
    });
  events.broadcast('initiatives');
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});

router.put('/initiatives/:id', auth.requireAuth, (req, res) => {
  if (req.user.role === 'viewer') return res.status(403).json({ error: 'Keine Berechtigung' });
  const it = db.prepare('SELECT * FROM initiatives WHERE id = ?').get(req.params.id);
  if (!it) return res.status(404).json({ error: 'Nicht gefunden' });
  if (!auth.canEditDepartment(req.user, it.department_id)) return res.status(403).json({ error: 'Keine Berechtigung' });
  const b = req.body || {};
  db.prepare(`UPDATE initiatives SET title=?, status=?, responsible=?, due_date=?, progress=?, note=?,
      objective_id=?, department_id=?, updated_at=datetime('now') WHERE id=?`)
    .run(b.title ?? it.title, b.status ?? it.status, b.responsible ?? it.responsible,
         b.due_date ?? it.due_date, b.progress ?? it.progress, b.note ?? it.note,
         b.objective_id ?? it.objective_id, b.department_id ?? it.department_id, it.id);
  events.broadcast('initiatives');
  res.json({ ok: true });
});

router.delete('/initiatives/:id', auth.requireAuth, (req, res) => {
  if (req.user.role === 'viewer') return res.status(403).json({ error: 'Keine Berechtigung' });
  const it = db.prepare('SELECT * FROM initiatives WHERE id = ?').get(req.params.id);
  if (!it) return res.status(404).json({ error: 'Nicht gefunden' });
  if (!auth.canEditDepartment(req.user, it.department_id)) return res.status(403).json({ error: 'Keine Berechtigung' });
  db.prepare('DELETE FROM initiatives WHERE id = ?').run(it.id);
  events.broadcast('initiatives');
  res.json({ ok: true });
});

// --------------------------------------------------------------------------
// Export (CSV) — aktueller Stand aller Kennzahlen
// --------------------------------------------------------------------------
router.get('/export.csv', auth.requireAuth, (req, res) => {
  const latest = latestMeasurements();
  const rows = db.prepare(`
    SELECT p.name AS perspektive, d.name AS abteilung, o.title AS ziel,
           k.id, k.name AS kennzahl, k.unit, k.direction, k.target, k.green_at, k.yellow_at
    FROM kpis k
    JOIN objectives o ON o.id = k.objective_id
    JOIN perspectives p ON p.id = o.perspective_id
    LEFT JOIN departments d ON d.id = k.department_id
    ORDER BY p.sort, d.sort, o.sort
  `).all();
  const head = 'Perspektive;Abteilung;Ziel;Kennzahl;Einheit;Aktuell;Periode;Ziel;Status';
  const lines = rows.map((r) => {
    const last = latest.get(r.id);
    const val = last ? last.value : '';
    const status = kpiStatus(r, last ? last.value : null);
    return [r.perspektive, r.abteilung || '', r.ziel, r.kennzahl, r.unit, val,
      last ? last.period : '', r.target ?? '', status]
      .map((c) => String(c).replace(/;/g, ',')).join(';');
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="bsc_export.csv"');
  res.send('﻿' + [head, ...lines].join('\r\n'));
});

// --------------------------------------------------------------------------
// Admin: Benutzerverwaltung
// --------------------------------------------------------------------------
router.get('/users', auth.requireRole('admin'), (req, res) => {
  res.json({
    users: db.prepare(`SELECT u.id, u.name, u.email, u.role, u.active, u.department_id, d.name AS department_name
      FROM users u LEFT JOIN departments d ON d.id = u.department_id ORDER BY u.name`).all(),
  });
});

router.post('/users', auth.requireRole('admin'), (req, res) => {
  const { name, email, password, role, department_id } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, E-Mail und Passwort erforderlich' });
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(String(email).toLowerCase().trim());
  if (exists) return res.status(409).json({ error: 'E-Mail bereits vergeben' });
  const { salt, hash } = auth.hashPassword(password);
  const info = db.prepare(`INSERT INTO users (name, email, pw_hash, pw_salt, role, department_id)
      VALUES (?, ?, ?, ?, ?, ?)`)
    .run(name.trim(), String(email).toLowerCase().trim(), hash, salt,
         ['admin', 'lead', 'member', 'viewer'].includes(role) ? role : 'member',
         department_id || null);
  log(req.user.id, 'user.create', email);
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});

router.put('/users/:id', auth.requireRole('admin'), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Nicht gefunden' });
  const { name, role, department_id, active, password } = req.body || {};
  db.prepare(`UPDATE users SET name=?, role=?, department_id=?, active=? WHERE id=?`)
    .run(name ?? u.name,
         ['admin', 'lead', 'member', 'viewer'].includes(role) ? role : u.role,
         department_id === undefined ? u.department_id : (department_id || null),
         active === undefined ? u.active : (active ? 1 : 0), u.id);
  if (password) {
    const { salt, hash } = auth.hashPassword(password);
    db.prepare('UPDATE users SET pw_hash=?, pw_salt=? WHERE id=?').run(hash, salt, u.id);
  }
  log(req.user.id, 'user.update', u.email);
  res.json({ ok: true });
});

// --------------------------------------------------------------------------
// Live-Updates (SSE)
// --------------------------------------------------------------------------
router.get('/events', auth.requireAuth, (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write('retry: 5000\n\n');
  res.write('data: {"type":"hello"}\n\n');
  events.addClient(res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
  req.on('close', () => clearInterval(ping));
});

module.exports = router;
