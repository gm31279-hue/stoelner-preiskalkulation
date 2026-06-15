'use strict';

// =========================================================================
// Stölner BSC — Frontend
// =========================================================================
const State = {
  user: null,
  meta: { departments: [], perspectives: [] },
  dept: 'all',
  tab: 'cockpit',
  editMode: false,
  scorecard: null,
  initiatives: [],
  es: null,
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STATUS_LABEL = { green: 'im Plan', yellow: 'beobachten', red: 'kritisch', none: 'kein Wert' };
const ROLE_LABEL = { admin: 'Administrator', lead: 'Leitung', member: 'Mitarbeiter', viewer: 'Betrachter' };

function fmtNum(n, unit) {
  if (n == null || Number.isNaN(n)) return '—';
  const dec = Math.abs(n) >= 1000 || Number.isInteger(n) ? 0 : (Math.abs(n) < 10 ? 2 : 1);
  let s = Number(n).toLocaleString('de-AT', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  if (unit === '€') return s + ' €';
  if (unit) return s + ' ' + unit;
  return s;
}

// ---------------------------------------------------------------- API
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error((data && data.error) || 'Fehler ' + res.status);
  return data;
}

function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2800);
}

// ---------------------------------------------------------------- Auth
async function bootstrap() {
  const { user } = await api('/auth/me');
  if (user) { State.user = user; await enterApp(); }
  else showLogin();
}

function showLogin() {
  $('#app-view').hidden = true;
  $('#login-view').hidden = false;
  $('#login-demo').innerHTML =
    'Demo-Zugänge:<br>admin@stoelner.at / admin123<br>vertrieb@stoelner.at / vertrieb123';
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-err').textContent = '';
  try {
    await api('/auth/login', { method: 'POST', body: {
      email: $('#login-email').value, password: $('#login-pw').value } });
    const { user } = await api('/auth/me');
    State.user = user;
    await enterApp();
  } catch (err) { $('#login-err').textContent = err.message; }
});

async function enterApp() {
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  State.meta = await api('/meta');
  renderDeptFilter();
  renderUserBar();
  $('.admin-only').hidden = State.user.role !== 'admin';
  connectSSE();
  await refreshAll();
}

function renderUserBar() {
  const u = State.user;
  $('#user-btn').textContent = u.name;
  $('#user-info').innerHTML = `<strong>${esc(u.name)}</strong><br>${esc(ROLE_LABEL[u.role] || u.role)}` +
    (u.department_name ? ` · ${esc(u.department_name)}` : '');
}

function renderDeptFilter() {
  const sel = $('#dept-filter');
  const opts = ['<option value="all">Alle Abteilungen</option>']
    .concat(State.meta.departments.map((d) => `<option value="${d.key}">${esc(d.name)}</option>`));
  sel.innerHTML = opts.join('');
  // Mitarbeiter/Leitung: auf eigene Abteilung vorfiltern
  if (State.user.department_id && (State.user.role === 'lead' || State.user.role === 'member')) {
    const d = State.meta.departments.find((x) => x.id === State.user.department_id);
    if (d) { sel.value = d.key; State.dept = d.key; }
  }
  sel.value = State.dept;
}

// ---------------------------------------------------------------- SSE
function connectSSE() {
  if (State.es) State.es.close();
  const es = new EventSource('/api/events');
  State.es = es;
  es.onmessage = (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'scorecard') loadScorecard();
    else if (msg.type === 'initiatives') loadInitiatives();
  };
  es.onopen = () => setLive(true);
  es.onerror = () => setLive(false);
}
function setLive(on) {
  const el = $('#live-status');
  el.textContent = on ? '● verbunden' : '● offline';
  el.className = 'brand-sub' + (on ? '' : ' off');
}

// ---------------------------------------------------------------- Data load
async function refreshAll() { await Promise.all([loadScorecard(), loadInitiatives()]); }

async function loadScorecard() {
  State.scorecard = await api('/scorecard?department=' + encodeURIComponent(State.dept));
  if (State.tab === 'cockpit') renderCockpit();
}
async function loadInitiatives() {
  const { initiatives } = await api('/initiatives?department=' + encodeURIComponent(State.dept));
  State.initiatives = initiatives;
  if (State.tab === 'massnahmen') renderMassnahmen();
}

// ---------------------------------------------------------------- Cockpit
function deptName(id) {
  const d = State.meta.departments.find((x) => x.id === id);
  return d ? d.name : '';
}
function canEdit(deptId) {
  const u = State.user;
  if (!u) return false;
  if (u.role === 'admin') return true;
  if (u.role === 'viewer') return false;
  return deptId == null || u.department_id === deptId;
}

function sparkline(values, status) {
  if (!values || values.length < 2) return '';
  const w = 60, h = 22, pad = 2;
  const min = Math.min(...values), max = Math.max(...values);
  const rng = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((v - min) / rng) * (h - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const color = { green: 'var(--green)', yellow: 'var(--yellow)', red: 'var(--red)', none: 'var(--none)' }[status];
  return `<svg class="kpi-spark" width="${w}" height="${h}"><polyline points="${pts}"
    fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

function renderCockpit() {
  const sc = State.scorecard;
  const el = $('#tab-cockpit');
  if (!sc) { el.innerHTML = '<div class="empty">Lade …</div>'; return; }
  const o = sc.overall;
  const chips = ['green', 'yellow', 'red', 'none'].map((s) =>
    `<span class="statchip"><span class="led s-${s}"></span>${o.counts[s] || 0} ${STATUS_LABEL[s]}</span>`).join('');

  let html = `<div class="overall">
    <div class="overall-light s-${o.status}"></div>
    <div>
      <h2>Gesamtstatus: ${STATUS_LABEL[o.status]}</h2>
      <p>${State.dept === 'all' ? 'Alle Abteilungen' : esc(State.meta.departments.find(d => d.key === State.dept)?.name || '')} · Stand der Kennzahlen über alle Perspektiven</p>
    </div>
    <div class="statbar">${chips}</div>
  </div>`;

  const canManage = State.user.role === 'admin' || State.user.role === 'lead';
  if (canManage) {
    html += `<div class="cockpit-tools">
      <button id="edit-toggle" class="btn ${State.editMode ? 'btn-pk' : 'btn-sec'} btn-sm">${State.editMode ? '✓ Bearbeitung beenden' : '✎ Struktur bearbeiten'}</button>
      ${State.editMode ? '<span class="edit-note">Ziele und Kennzahlen können jetzt angelegt, geändert und gelöscht werden.</span>'
        : '<span class="edit-note">Kennzahl anklicken, um Werte zu erfassen oder den Verlauf zu sehen.</span>'}
    </div>`;
  }
  html += '<div class="persp-grid">';

  for (const p of sc.perspectives) {
    html += `<div class="persp"><div class="persp-hdr">
      <span class="led s-${p.status}"></span>
      <h3>${esc(p.name)}<span class="persp-desc">${esc(p.description)}</span></h3>
    </div><div class="persp-body">`;
    if (!p.objectives.length) html += '<div class="empty">Keine Ziele</div>';
    for (const obj of p.objectives) {
      html += `<div class="objective"><div class="obj-title">
        <span class="led s-${obj.status}"></span>${esc(obj.title)}
        ${obj.department_id ? `<span class="obj-dept">${esc(deptName(obj.department_id))}</span>` : ''}
      </div>`;
      for (const k of obj.kpis) {
        const vals = (k._spark || null);
        html += `<div class="kpi" data-kpi="${k.id}">
          <span class="kpi-led s-${k.status}"></span>
          <div class="kpi-main">
            <div class="kpi-name">${esc(k.name)}</div>
            <div class="kpi-meta">Ziel ${fmtNum(k.target, k.unit)} · ${k.period || '—'}</div>
          </div>
          <span class="kpi-spark-holder" data-spark="${k.id}"></span>
          <div>
            <div class="kpi-val t-${k.status}">${fmtNum(k.value, k.unit)}</div>
            ${k.attainment != null ? `<div class="kpi-att">${k.attainment}%</div>` : ''}
          </div>
        </div>`;
      }
      if (State.editMode && canEdit(obj.department_id) && canManage) {
        html += `<button class="btn btn-sec btn-sm" style="margin-top:6px" data-addkpi="${obj.id}" data-dept="${obj.department_id || ''}">+ Kennzahl</button>`;
      }
      html += '</div>';
    }
    if (State.editMode && canManage) {
      html += `<button class="btn btn-sec btn-sm" style="margin-top:12px" data-addobj="${p.id}">+ Ziel in ${esc(p.name)}</button>`;
    }
    html += '</div></div>';
  }
  html += '</div>';
  el.innerHTML = html;

  // Bearbeiten-Modus umschalten
  if ($('#edit-toggle')) $('#edit-toggle').addEventListener('click', () => {
    State.editMode = !State.editMode;
    renderCockpit();
  });

  // KPI-Klicks
  $$('.kpi', el).forEach((n) => n.addEventListener('click', () => openKpi(n.dataset.kpi)));
  $$('[data-addkpi]', el).forEach((n) => n.addEventListener('click', (e) => {
    e.stopPropagation();
    openKpiForm(null, { objective_id: +n.dataset.addkpi, department_id: +n.dataset.dept || null });
  }));
  $$('[data-addobj]', el).forEach((n) => n.addEventListener('click', () =>
    openObjForm(null, { perspective_id: +n.dataset.addobj })));
}

// ---------------------------------------------------------------- KPI detail
async function openKpi(id) {
  const data = await api('/kpis/' + id);
  const { kpi, objective, measurements } = data;
  const vals = measurements.map((m) => m.value);
  const last = vals.length ? vals[vals.length - 1] : null;
  const status = statusOf(kpi, last);
  const editable = canEdit(kpi.department_id) && State.user.role !== 'viewer';
  const isLead = State.user.role === 'admin' || State.user.role === 'lead';

  let html = `<h2>${esc(kpi.name)}</h2>
    <div class="modal-sub">${esc(objective.title)} · ${esc(deptName(kpi.department_id)) || 'abteilungsübergreifend'}
      · ${kpi.direction === 'down' ? 'niedriger = besser' : 'höher = besser'}</div>
    <div class="kpi-stats">
      <div class="statbox"><div class="v t-${status}">${fmtNum(last, kpi.unit)}</div><div class="l">Aktuell</div></div>
      <div class="statbox"><div class="v">${fmtNum(kpi.target, kpi.unit)}</div><div class="l">Zielwert</div></div>
      <div class="statbox"><div class="v">${attainmentOf(kpi, last) ?? '—'}${attainmentOf(kpi, last) != null ? '%' : ''}</div><div class="l">Zielerreichung</div></div>
    </div>
    ${lineChart(measurements, kpi)}
    <h3 style="font-size:14px;margin:14px 0 4px">Werte erfassen</h3>`;

  if (editable) {
    const now = new Date();
    const period = now.toISOString().slice(0, 7);
    html += `<form id="meas-form" class="form-grid">
      <div class="form-row"><label>Periode</label><input id="m-period" value="${period}" placeholder="2026-05" required></div>
      <div class="form-row"><label>Wert (${esc(kpi.unit || '–')})</label><input id="m-value" type="number" step="any" required></div>
      <div class="form-row" style="grid-column:1/-1"><label>Notiz (optional)</label><input id="m-note"></div>
      <div class="form-actions" style="grid-column:1/-1"><button class="btn btn-pk btn-sm" type="submit">Speichern</button></div>
    </form>`;
  } else {
    html += '<p class="muted">Nur Lesen — keine Bearbeitungsrechte für diese Abteilung.</p>';
  }

  html += `<table class="hist-table"><thead><tr><th>Periode</th><th>Wert</th><th>Notiz</th><th></th></tr></thead><tbody>`;
  for (const m of [...measurements].reverse()) {
    html += `<tr><td>${esc(m.period)}</td><td>${fmtNum(m.value, kpi.unit)}</td>
      <td class="act">${esc(m.note || '')}</td>
      <td>${editable ? `<button class="hist-del" data-del="${m.id}" title="Löschen">×</button>` : ''}</td></tr>`;
  }
  html += '</tbody></table>';

  if (State.editMode && isLead && canEdit(kpi.department_id)) {
    html += `<div class="form-actions" style="margin-top:16px">
      <button class="btn btn-sec btn-sm" id="edit-kpi">Kennzahl bearbeiten</button>
      <button class="btn btn-danger btn-sm" id="del-kpi">Kennzahl löschen</button></div>`;
  }

  openModal(html);

  const mf = $('#meas-form');
  if (mf) mf.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/measurements', { method: 'POST', body: {
        kpi_id: kpi.id, period: $('#m-period').value,
        value: $('#m-value').value, note: $('#m-note').value } });
      toast('Wert gespeichert'); closeModal();
    } catch (err) { toast(err.message, true); }
  });
  $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Messwert löschen?')) return;
    try { await api('/measurements/' + b.dataset.del, { method: 'DELETE' }); toast('Gelöscht'); openKpi(id); }
    catch (err) { toast(err.message, true); }
  }));
  if ($('#edit-kpi')) $('#edit-kpi').addEventListener('click', () => openKpiForm(kpi));
  if ($('#del-kpi')) $('#del-kpi').addEventListener('click', async () => {
    if (!confirm('Kennzahl inkl. aller Werte löschen?')) return;
    try { await api('/kpis/' + kpi.id, { method: 'DELETE' }); toast('Kennzahl gelöscht'); closeModal(); }
    catch (err) { toast(err.message, true); }
  });
}

function statusOf(kpi, value) {
  if (value == null || Number.isNaN(value)) return 'none';
  const { direction, green_at: g, yellow_at: y } = kpi;
  if (g == null && y == null) return 'none';
  if (direction === 'down') {
    if (g != null && value <= g) return 'green';
    if (y != null && value <= y) return 'yellow';
    return 'red';
  }
  if (g != null && value >= g) return 'green';
  if (y != null && value >= y) return 'yellow';
  return 'red';
}
function attainmentOf(kpi, value) {
  if (value == null || kpi.target == null || kpi.target === 0) return null;
  let pct = kpi.direction === 'down'
    ? (value === 0 ? 150 : (kpi.target / value) * 100)
    : (value / kpi.target) * 100;
  return Math.max(0, Math.min(150, Math.round(pct)));
}

// SVG-Liniendiagramm mit Zielmarke
function lineChart(measurements, kpi) {
  if (!measurements.length) return '<div class="chart"></div>';
  const W = 540, H = 180, pad = { l: 44, r: 14, t: 14, b: 26 };
  const vals = measurements.map((m) => m.value);
  const series = [...vals];
  if (kpi.target != null) series.push(kpi.target);
  let min = Math.min(...series), max = Math.max(...series);
  if (min === max) { min -= 1; max += 1; }
  const padR = (max - min) * 0.1; min -= padR; max += padR;
  const X = (i) => pad.l + (measurements.length === 1 ? (W - pad.l - pad.r) / 2 : (i / (measurements.length - 1)) * (W - pad.l - pad.r));
  const Y = (v) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);

  // Gridlines + Y labels
  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const v = min + (i / 4) * (max - min);
    const y = Y(v);
    grid += `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="#e3e3e6" stroke-width="1"/>
      <text x="${pad.l - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="#999">${fmtNum(v, '')}</text>`;
  }
  // Zielmarke
  let targetLine = '';
  if (kpi.target != null) {
    const ty = Y(kpi.target);
    targetLine = `<line x1="${pad.l}" y1="${ty}" x2="${W - pad.r}" y2="${ty}" stroke="var(--pk)" stroke-width="1.3" stroke-dasharray="5 4"/>
      <text x="${W - pad.r}" y="${ty - 4}" text-anchor="end" font-size="9" fill="var(--pk)">Ziel</text>`;
  }
  const line = measurements.map((m, i) => `${X(i)},${Y(m.value)}`).join(' ');
  const dots = measurements.map((m, i) => {
    const st = statusOf(kpi, m.value);
    const c = { green: 'var(--green)', yellow: 'var(--yellow)', red: 'var(--red)', none: 'var(--none)' }[st];
    return `<circle cx="${X(i)}" cy="${Y(m.value)}" r="3.2" fill="${c}"/>`;
  }).join('');
  const xlabels = measurements.map((m, i) =>
    `<text x="${X(i)}" y="${H - 8}" text-anchor="middle" font-size="8" fill="#999">${esc(m.period.slice(2))}</text>`).join('');

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    ${grid}${targetLine}
    <polyline points="${line}" fill="none" stroke="#444" stroke-width="2" stroke-linejoin="round"/>
    ${dots}${xlabels}</svg>`;
}

// ---------------------------------------------------------------- KPI form
function openKpiForm(kpi, defaults = {}) {
  const k = kpi || {};
  const dep = k.department_id ?? defaults.department_id ?? State.user.department_id ?? null;
  const objId = k.objective_id ?? defaults.objective_id;
  const depOptions = State.meta.departments.map((d) =>
    `<option value="${d.id}" ${d.id === dep ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
  const html = `<h2>${kpi ? 'Kennzahl bearbeiten' : 'Neue Kennzahl'}</h2>
    <div class="modal-sub">Ampel: Werte ab „Grün ab" sind grün, ab „Gelb ab" gelb, sonst rot.</div>
    <form id="kpi-form">
      <div class="form-row"><label>Bezeichnung</label><input id="k-name" value="${esc(k.name || '')}" required></div>
      <div class="form-grid">
        <div class="form-row"><label>Einheit</label><input id="k-unit" value="${esc(k.unit || '')}" placeholder="€, %, Tage …"></div>
        <div class="form-row"><label>Richtung</label><select id="k-dir">
          <option value="up" ${k.direction !== 'down' ? 'selected' : ''}>höher = besser</option>
          <option value="down" ${k.direction === 'down' ? 'selected' : ''}>niedriger = besser</option></select></div>
        <div class="form-row"><label>Zielwert</label><input id="k-target" type="number" step="any" value="${k.target ?? ''}"></div>
        <div class="form-row"><label>Abteilung</label><select id="k-dept"><option value="">– keine –</option>${depOptions}</select></div>
        <div class="form-row"><label>Grün ab</label><input id="k-green" type="number" step="any" value="${k.green_at ?? ''}"></div>
        <div class="form-row"><label>Gelb ab</label><input id="k-yellow" type="number" step="any" value="${k.yellow_at ?? ''}"></div>
      </div>
      <div class="form-actions"><button type="button" class="btn btn-sec btn-sm" id="kf-cancel">Abbrechen</button>
        <button class="btn btn-pk btn-sm" type="submit">Speichern</button></div>
    </form>`;
  openModal(html);
  $('#kf-cancel').addEventListener('click', closeModal);
  $('#kpi-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      objective_id: objId, name: $('#k-name').value, unit: $('#k-unit').value,
      direction: $('#k-dir').value, target: $('#k-target').value,
      green_at: $('#k-green').value, yellow_at: $('#k-yellow').value,
      department_id: $('#k-dept').value ? +$('#k-dept').value : null,
    };
    try {
      if (kpi) await api('/kpis/' + kpi.id, { method: 'PUT', body });
      else await api('/kpis', { method: 'POST', body });
      toast('Gespeichert'); closeModal();
    } catch (err) { toast(err.message, true); }
  });
}

// ---------------------------------------------------------------- Objective form
function openObjForm(obj, defaults = {}) {
  const o = obj || {};
  const dep = o.department_id ?? State.user.department_id ?? null;
  const perspOptions = State.meta.perspectives.map((p) =>
    `<option value="${p.id}" ${p.id === (o.perspective_id ?? defaults.perspective_id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const depOptions = State.meta.departments.map((d) =>
    `<option value="${d.id}" ${d.id === dep ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
  const html = `<h2>${obj ? 'Ziel bearbeiten' : 'Neues Ziel'}</h2>
    <form id="obj-form">
      <div class="form-row"><label>Titel</label><input id="o-title" value="${esc(o.title || '')}" required></div>
      <div class="form-row"><label>Beschreibung</label><textarea id="o-desc" rows="2">${esc(o.description || '')}</textarea></div>
      <div class="form-grid">
        <div class="form-row"><label>Perspektive</label><select id="o-persp">${perspOptions}</select></div>
        <div class="form-row"><label>Abteilung</label><select id="o-dept"><option value="">– keine –</option>${depOptions}</select></div>
      </div>
      <div class="form-actions"><button type="button" class="btn btn-sec btn-sm" id="of-cancel">Abbrechen</button>
        <button class="btn btn-pk btn-sm" type="submit">Speichern</button></div>
    </form>`;
  openModal(html);
  $('#of-cancel').addEventListener('click', closeModal);
  $('#obj-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      title: $('#o-title').value, description: $('#o-desc').value,
      perspective_id: +$('#o-persp').value,
      department_id: $('#o-dept').value ? +$('#o-dept').value : null,
    };
    try {
      if (obj) await api('/objectives/' + obj.id, { method: 'PUT', body });
      else await api('/objectives', { method: 'POST', body });
      toast('Gespeichert'); closeModal();
    } catch (err) { toast(err.message, true); }
  });
}

// ---------------------------------------------------------------- Maßnahmen
const INIT_STATUS = ['offen', 'laufend', 'erledigt', 'gestoppt'];
const INIT_STATUS_LABEL = { offen: 'Offen', laufend: 'Laufend', erledigt: 'Erledigt', gestoppt: 'Gestoppt' };

function renderMassnahmen() {
  const el = $('#tab-massnahmen');
  const canAdd = State.user.role !== 'viewer';
  let html = `<div class="section-hdr"><h2>Maßnahmen & Initiativen</h2>
    ${canAdd ? '<button class="btn btn-pk btn-sm" id="add-init">+ Neue Maßnahme</button>' : ''}</div>
    <div class="board">`;
  for (const st of INIT_STATUS) {
    const items = State.initiatives.filter((i) => i.status === st);
    html += `<div class="col"><h4>${INIT_STATUS_LABEL[st]} (${items.length})</h4>`;
    for (const it of items) {
      const overdue = it.due_date && it.status !== 'erledigt' && it.due_date < new Date().toISOString().slice(0, 10);
      html += `<div class="card-i" data-init="${it.id}">
        <div class="ci-title">${esc(it.title)}</div>
        <div class="ci-meta"><span>${esc(it.department_name || '')}</span>
          <span class="${overdue ? 'due-over' : ''}">${it.due_date ? esc(it.due_date) : ''}</span></div>
        <div class="ci-meta" style="margin-top:3px"><span>${esc(it.responsible || '')}</span><span>${it.progress}%</span></div>
        <div class="ci-bar"><i style="width:${it.progress}%"></i></div>
      </div>`;
    }
    if (!items.length) html += '<div class="muted" style="padding:6px 4px">—</div>';
    html += '</div>';
  }
  html += '</div>';
  el.innerHTML = html;
  if ($('#add-init')) $('#add-init').addEventListener('click', () => openInitForm(null));
  $$('[data-init]', el).forEach((n) => n.addEventListener('click', () => {
    const it = State.initiatives.find((x) => x.id === +n.dataset.init);
    openInitForm(it);
  }));
}

function openInitForm(it) {
  const i = it || {};
  const editable = !it || canEdit(i.department_id);
  const dep = i.department_id ?? State.user.department_id ?? null;
  const depOptions = State.meta.departments.map((d) =>
    `<option value="${d.id}" ${d.id === dep ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
  const statusOptions = INIT_STATUS.map((s) =>
    `<option value="${s}" ${s === (i.status || 'offen') ? 'selected' : ''}>${INIT_STATUS_LABEL[s]}</option>`).join('');
  const html = `<h2>${it ? 'Maßnahme' : 'Neue Maßnahme'}</h2>
    <form id="init-form">
      <div class="form-row"><label>Titel</label><input id="i-title" value="${esc(i.title || '')}" required ${editable ? '' : 'disabled'}></div>
      <div class="form-grid">
        <div class="form-row"><label>Abteilung</label><select id="i-dept" ${editable ? '' : 'disabled'}><option value="">– keine –</option>${depOptions}</select></div>
        <div class="form-row"><label>Status</label><select id="i-status" ${editable ? '' : 'disabled'}>${statusOptions}</select></div>
        <div class="form-row"><label>Verantwortlich</label><input id="i-resp" value="${esc(i.responsible || '')}" ${editable ? '' : 'disabled'}></div>
        <div class="form-row"><label>Fällig bis</label><input id="i-due" type="date" value="${esc(i.due_date || '')}" ${editable ? '' : 'disabled'}></div>
        <div class="form-row" style="grid-column:1/-1"><label>Fortschritt: <span id="i-pv">${i.progress || 0}</span>%</label>
          <input id="i-prog" type="range" min="0" max="100" step="5" value="${i.progress || 0}" ${editable ? '' : 'disabled'}></div>
        <div class="form-row" style="grid-column:1/-1"><label>Notiz</label><textarea id="i-note" rows="2" ${editable ? '' : 'disabled'}>${esc(i.note || '')}</textarea></div>
      </div>
      ${editable ? `<div class="form-actions">
        ${it ? '<button type="button" class="btn btn-danger btn-sm" id="i-del">Löschen</button>' : ''}
        <button type="button" class="btn btn-sec btn-sm" id="i-cancel">Abbrechen</button>
        <button class="btn btn-pk btn-sm" type="submit">Speichern</button></div>`
      : '<p class="muted">Nur Lesen — andere Abteilung.</p>'}
    </form>`;
  openModal(html);
  if (!editable) return;
  $('#i-prog').addEventListener('input', (e) => { $('#i-pv').textContent = e.target.value; });
  $('#i-cancel').addEventListener('click', closeModal);
  if ($('#i-del')) $('#i-del').addEventListener('click', async () => {
    if (!confirm('Maßnahme löschen?')) return;
    try { await api('/initiatives/' + it.id, { method: 'DELETE' }); toast('Gelöscht'); closeModal(); }
    catch (err) { toast(err.message, true); }
  });
  $('#init-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      title: $('#i-title').value, status: $('#i-status').value,
      responsible: $('#i-resp').value, due_date: $('#i-due').value || null,
      progress: +$('#i-prog').value, note: $('#i-note').value,
      department_id: $('#i-dept').value ? +$('#i-dept').value : null,
    };
    try {
      if (it) await api('/initiatives/' + it.id, { method: 'PUT', body });
      else await api('/initiatives', { method: 'POST', body });
      toast('Gespeichert'); closeModal();
    } catch (err) { toast(err.message, true); }
  });
}

// ---------------------------------------------------------------- Admin
async function renderAdmin() {
  const el = $('#tab-admin');
  el.innerHTML = '<div class="empty">Lade …</div>';
  const { users } = await api('/users');
  let html = `<div class="section-hdr"><h2>Benutzerverwaltung</h2>
    <button class="btn btn-pk btn-sm" id="add-user">+ Benutzer</button></div>
    <table class="dtable"><thead><tr><th>Name</th><th>E-Mail</th><th>Rolle</th><th>Abteilung</th><th>Status</th><th></th></tr></thead><tbody>`;
  for (const u of users) {
    html += `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td>
      <td><span class="pill">${ROLE_LABEL[u.role] || u.role}</span></td>
      <td>${esc(u.department_name || '–')}</td>
      <td>${u.active ? 'aktiv' : '<span class="t-red">inaktiv</span>'}</td>
      <td><button class="btn btn-sec btn-sm" data-edituser="${u.id}">Bearbeiten</button></td></tr>`;
  }
  html += '</tbody></table>';
  el.innerHTML = html;
  $('#add-user').addEventListener('click', () => openUserForm(null));
  $$('[data-edituser]', el).forEach((b) => b.addEventListener('click', () =>
    openUserForm(users.find((u) => u.id === +b.dataset.edituser))));
}

function openUserForm(user) {
  const u = user || {};
  const depOptions = State.meta.departments.map((d) =>
    `<option value="${d.id}" ${d.id === u.department_id ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
  const roles = ['admin', 'lead', 'member', 'viewer'].map((r) =>
    `<option value="${r}" ${r === (u.role || 'member') ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('');
  const html = `<h2>${user ? 'Benutzer bearbeiten' : 'Neuer Benutzer'}</h2>
    <form id="user-form">
      <div class="form-row"><label>Name</label><input id="u-name" value="${esc(u.name || '')}" required></div>
      <div class="form-row"><label>E-Mail</label><input id="u-email" type="email" value="${esc(u.email || '')}" ${user ? 'disabled' : 'required'}></div>
      <div class="form-grid">
        <div class="form-row"><label>Rolle</label><select id="u-role">${roles}</select></div>
        <div class="form-row"><label>Abteilung</label><select id="u-dept"><option value="">– keine –</option>${depOptions}</select></div>
      </div>
      <div class="form-row"><label>${user ? 'Neues Passwort (optional)' : 'Passwort'}</label>
        <input id="u-pw" type="text" ${user ? '' : 'required'} placeholder="${user ? 'leer lassen = unverändert' : 'min. 6 Zeichen'}"></div>
      ${user ? `<div class="form-row"><label><input type="checkbox" id="u-active" ${u.active ? 'checked' : ''}> aktiv</label></div>` : ''}
      <div class="form-actions"><button type="button" class="btn btn-sec btn-sm" id="uf-cancel">Abbrechen</button>
        <button class="btn btn-pk btn-sm" type="submit">Speichern</button></div>
    </form>`;
  openModal(html);
  $('#uf-cancel').addEventListener('click', closeModal);
  $('#user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      name: $('#u-name').value, role: $('#u-role').value,
      department_id: $('#u-dept').value ? +$('#u-dept').value : null,
      password: $('#u-pw').value || undefined,
    };
    try {
      if (user) {
        body.active = $('#u-active').checked;
        await api('/users/' + user.id, { method: 'PUT', body });
      } else {
        body.email = $('#u-email').value;
        await api('/users', { method: 'POST', body });
      }
      toast('Gespeichert'); closeModal(); renderAdmin();
    } catch (err) { toast(err.message, true); }
  });
}

// ---------------------------------------------------------------- Password change
function openPasswordForm() {
  const html = `<h2>Passwort ändern</h2>
    <form id="pw-form">
      <div class="form-row"><label>Aktuelles Passwort</label><input id="pw-cur" type="password" required></div>
      <div class="form-row"><label>Neues Passwort</label><input id="pw-new" type="password" required placeholder="min. 6 Zeichen"></div>
      <div class="form-actions"><button type="button" class="btn btn-sec btn-sm" id="pw-cancel">Abbrechen</button>
        <button class="btn btn-pk btn-sm" type="submit">Ändern</button></div>
    </form>`;
  openModal(html);
  $('#pw-cancel').addEventListener('click', closeModal);
  $('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/auth/password', { method: 'POST', body: {
        current: $('#pw-cur').value, next: $('#pw-new').value } });
      toast('Passwort geändert'); closeModal();
    } catch (err) { toast(err.message, true); }
  });
}

// ---------------------------------------------------------------- Modal
function openModal(html) {
  $('#modal-body').innerHTML = html;
  $('#modal').hidden = false;
}
function closeModal() { $('#modal').hidden = true; $('#modal-body').innerHTML = ''; }
$('#modal-close').addEventListener('click', closeModal);
$('#modal').addEventListener('click', (e) => { if (e.target === $('#modal')) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// ---------------------------------------------------------------- Tabs & nav
$$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
function switchTab(tab) {
  State.tab = tab;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  $$('.tabpanel').forEach((p) => p.classList.remove('active'));
  $('#tab-' + tab).classList.add('active');
  if (tab === 'cockpit') renderCockpit();
  else if (tab === 'massnahmen') renderMassnahmen();
  else if (tab === 'admin') renderAdmin();
}

$('#dept-filter').addEventListener('change', (e) => {
  State.dept = e.target.value;
  refreshAll();
});

// User dropdown
$('#user-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#user-dropdown').hidden = !$('#user-dropdown').hidden;
});
document.addEventListener('click', () => { $('#user-dropdown').hidden = true; });
$('#user-dropdown').addEventListener('click', (e) => e.stopPropagation());
$$('#user-dropdown .dropdown-item').forEach((b) => b.addEventListener('click', async () => {
  $('#user-dropdown').hidden = true;
  if (b.dataset.act === 'logout') {
    await api('/auth/logout', { method: 'POST' });
    if (State.es) State.es.close();
    location.reload();
  } else if (b.dataset.act === 'password') openPasswordForm();
}));

// ---------------------------------------------------------------- Go
bootstrap().catch((e) => { console.error(e); showLogin(); });
