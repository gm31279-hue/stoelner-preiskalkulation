'use strict';

const db = require('./db');
const { hashPassword } = require('./auth');

const PERIODS = ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05'];

const DEPARTMENTS = [
  { key: 'vertrieb',   name: 'Vertrieb / Verkauf',     color: '#E5007D', sort: 1 },
  { key: 'einkauf',    name: 'Einkauf / Lager',        color: '#0085C7', sort: 2 },
  { key: 'werkstatt',  name: 'Werkstatt / Service',    color: '#F39200', sort: 3 },
  { key: 'verwaltung', name: 'Verwaltung / Finanzen',  color: '#3AAA35', sort: 4 },
];

const PERSPECTIVES = [
  { key: 'finanzen', name: 'Finanzen',               description: 'Wirtschaftlicher Erfolg & Wirtschaftlichkeit', sort: 1 },
  { key: 'kunden',   name: 'Kunden',                 description: 'Kundenzufriedenheit & Marktstellung',          sort: 2 },
  { key: 'prozesse', name: 'Prozesse',               description: 'Interne Abläufe & Qualität',                   sort: 3 },
  { key: 'lernen',   name: 'Lernen & Entwicklung',   description: 'Mitarbeiter, Wissen & Zukunftsfähigkeit',      sort: 4 },
];

// Ziele + Kennzahlen + Messreihen.
// direction: up = höher besser, down = niedriger besser
// values: zeitliche Reihe passend zu PERIODS
const PLAN = [
  // ---------------- FINANZEN ----------------
  { persp: 'finanzen', dept: 'vertrieb', title: 'Umsatz steigern',
    desc: 'Profitables Wachstum im Ersatzteilverkauf',
    kpis: [
      { name: 'Monatsumsatz', unit: '€', dir: 'up', target: 320000, green: 320000, yellow: 290000,
        values: [298000, 305000, 311000, 318000, 326000, 333000] },
      { name: 'Auftragseingang', unit: 'Stk', dir: 'up', target: 850, green: 850, yellow: 780,
        values: [790, 815, 802, 840, 861, 872] },
    ] },
  { persp: 'finanzen', dept: 'verwaltung', title: 'Ertragskraft sichern',
    desc: 'Marge und Liquidität im Griff behalten',
    kpis: [
      { name: 'Rohertragsmarge', unit: '%', dir: 'up', target: 34, green: 34, yellow: 31,
        values: [32.1, 32.8, 33.0, 33.6, 33.9, 34.2] },
      { name: 'Außenstände (DSO)', unit: 'Tage', dir: 'down', target: 30, green: 30, yellow: 40,
        values: [44, 41, 38, 36, 34, 33] },
    ] },
  { persp: 'finanzen', dept: 'einkauf', title: 'Kapitalbindung optimieren',
    desc: 'Lagerwert senken ohne Lieferfähigkeit zu gefährden',
    kpis: [
      { name: 'Lagerwert', unit: '€', dir: 'down', target: 480000, green: 480000, yellow: 540000,
        values: [575000, 560000, 548000, 525000, 505000, 492000] },
    ] },
  { persp: 'finanzen', dept: 'werkstatt', title: 'Werkstatt-Deckungsbeitrag',
    desc: 'Service als profitables Standbein',
    kpis: [
      { name: 'Werkstattumsatz', unit: '€', dir: 'up', target: 95000, green: 95000, yellow: 82000,
        values: [78000, 84000, 88000, 91000, 89000, 96000] },
    ] },

  // ---------------- KUNDEN ----------------
  { persp: 'kunden', dept: 'vertrieb', title: 'Kundenzufriedenheit erhöhen',
    desc: 'Loyale Stammkunden gewinnen und halten',
    kpis: [
      { name: 'Kundenzufriedenheit', unit: '%', dir: 'up', target: 90, green: 90, yellow: 82,
        values: [83, 84, 86, 87, 88, 89] },
      { name: 'Angebots-Reaktionszeit', unit: 'Std', dir: 'down', target: 4, green: 4, yellow: 8,
        values: [9, 7, 6, 5, 5, 4] },
    ] },
  { persp: 'kunden', dept: 'einkauf', title: 'Lieferfähigkeit sicherstellen',
    desc: 'Verfügbarkeit gängiger Ersatzteile',
    kpis: [
      { name: 'Lieferbereitschaftsgrad', unit: '%', dir: 'up', target: 96, green: 96, yellow: 90,
        values: [88, 90, 92, 93, 95, 96] },
    ] },
  { persp: 'kunden', dept: 'werkstatt', title: 'Servicequalität steigern',
    desc: 'Reklamationen vermeiden, Termintreue sichern',
    kpis: [
      { name: 'Reklamationsquote', unit: '%', dir: 'down', target: 2, green: 2, yellow: 4,
        values: [5.2, 4.6, 3.9, 3.3, 2.8, 2.4] },
      { name: 'Termintreue', unit: '%', dir: 'up', target: 95, green: 95, yellow: 88,
        values: [86, 88, 90, 92, 93, 94] },
    ] },

  // ---------------- PROZESSE ----------------
  { persp: 'prozesse', dept: 'werkstatt', title: 'Durchlaufzeiten verkürzen',
    desc: 'Schnellere Auftragsabwicklung in der Werkstatt',
    kpis: [
      { name: 'Ø Durchlaufzeit', unit: 'Tage', dir: 'down', target: 3, green: 3, yellow: 5,
        values: [6.1, 5.4, 4.8, 4.2, 3.7, 3.4] },
      { name: 'Auslastung', unit: '%', dir: 'up', target: 85, green: 85, yellow: 70,
        values: [72, 75, 79, 81, 84, 86] },
    ] },
  { persp: 'prozesse', dept: 'einkauf', title: 'Beschaffungsqualität',
    desc: 'Zuverlässige Lieferanten, korrekte Lieferungen',
    kpis: [
      { name: 'Lieferantentreue', unit: '%', dir: 'up', target: 95, green: 95, yellow: 88,
        values: [89, 90, 91, 93, 94, 95] },
      { name: 'Fehllieferungsquote', unit: '%', dir: 'down', target: 1.5, green: 1.5, yellow: 3,
        values: [3.4, 3.0, 2.6, 2.2, 1.9, 1.6] },
    ] },
  { persp: 'prozesse', dept: 'vertrieb', title: 'Angebotsprozess beschleunigen',
    desc: 'Vom Anfrage- bis zum Angebotsversand',
    kpis: [
      { name: 'Angebotsdurchlaufzeit', unit: 'Tage', dir: 'down', target: 1, green: 1, yellow: 2,
        values: [2.6, 2.3, 2.0, 1.7, 1.4, 1.2] },
    ] },
  { persp: 'prozesse', dept: 'verwaltung', title: 'Effiziente Abwicklung',
    desc: 'Schneller Rechnungs- und Buchungslauf',
    kpis: [
      { name: 'Rechnungslaufzeit', unit: 'Tage', dir: 'down', target: 2, green: 2, yellow: 4,
        values: [5, 4, 4, 3, 3, 2] },
    ] },

  // ---------------- LERNEN & ENTWICKLUNG ----------------
  { persp: 'lernen', dept: 'verwaltung', title: 'Mitarbeiter entwickeln',
    desc: 'Kompetenz und Bindung der Belegschaft',
    kpis: [
      { name: 'Schulungstage / MA', unit: 'Tage', dir: 'up', target: 5, green: 5, yellow: 3,
        values: [2.1, 2.5, 3.0, 3.4, 4.1, 4.6] },
      { name: 'Mitarbeiterfluktuation', unit: '%', dir: 'down', target: 6, green: 6, yellow: 10,
        values: [12, 11, 10, 9, 8, 7] },
    ] },
  { persp: 'lernen', dept: 'vertrieb', title: 'Digitalisierung vorantreiben',
    desc: 'Digitaler Anteil an Verkaufsprozessen',
    kpis: [
      { name: 'Digitalisierungsgrad', unit: '%', dir: 'up', target: 70, green: 70, yellow: 50,
        values: [38, 44, 51, 57, 63, 68] },
    ] },
  { persp: 'lernen', dept: 'werkstatt', title: 'Wissen sichern',
    desc: 'Mehrfach-Qualifikation gegen Ausfälle',
    kpis: [
      { name: 'Qualifikationsabdeckung', unit: '%', dir: 'up', target: 80, green: 80, yellow: 65,
        values: [60, 64, 68, 72, 76, 79] },
    ] },
];

const INITIATIVES = [
  { dept: 'einkauf', title: 'ABC-Analyse Lagerbestand', status: 'laufend', responsible: 'M. Berger', due: '2026-07-31', progress: 60, objTitle: 'Kapitalbindung optimieren' },
  { dept: 'vertrieb', title: 'Online-Angebotskonfigurator einführen', status: 'laufend', responsible: 'S. Huber', due: '2026-09-30', progress: 40, objTitle: 'Digitalisierung vorantreiben' },
  { dept: 'werkstatt', title: 'Auftragsplanung mit Plantafel digital', status: 'offen', responsible: 'T. Mayr', due: '2026-08-15', progress: 10, objTitle: 'Durchlaufzeiten verkürzen' },
  { dept: 'verwaltung', title: 'Mahnwesen automatisieren', status: 'erledigt', responsible: 'C. Wolf', due: '2026-04-30', progress: 100, objTitle: 'Ertragskraft sichern' },
  { dept: 'werkstatt', title: 'Schulungsplan Diagnosesoftware', status: 'laufend', responsible: 'T. Mayr', due: '2026-10-31', progress: 30, objTitle: 'Wissen sichern' },
];

const USERS = [
  { name: 'Administrator',     email: 'admin@stoelner.at',      pw: 'admin123',      role: 'admin',  dept: null },
  { name: 'Leitung Vertrieb',  email: 'vertrieb@stoelner.at',   pw: 'vertrieb123',   role: 'lead',   dept: 'vertrieb' },
  { name: 'Leitung Einkauf',   email: 'einkauf@stoelner.at',    pw: 'einkauf123',    role: 'lead',   dept: 'einkauf' },
  { name: 'Leitung Werkstatt', email: 'werkstatt@stoelner.at',  pw: 'werkstatt123',  role: 'lead',   dept: 'werkstatt' },
  { name: 'Leitung Verwaltung',email: 'verwaltung@stoelner.at', pw: 'verwaltung123', role: 'lead',   dept: 'verwaltung' },
];

function seed() {
  const tx = db.exec.bind(db);
  db.exec('BEGIN');
  try {
    const deptId = {};
    for (const d of DEPARTMENTS) {
      db.prepare('INSERT INTO departments (key, name, color, sort) VALUES (?, ?, ?, ?)')
        .run(d.key, d.name, d.color, d.sort);
      deptId[d.key] = Number(db.prepare('SELECT id FROM departments WHERE key = ?').get(d.key).id);
    }

    const perspId = {};
    for (const p of PERSPECTIVES) {
      db.prepare('INSERT INTO perspectives (key, name, description, sort) VALUES (?, ?, ?, ?)')
        .run(p.key, p.name, p.description, p.sort);
      perspId[p.key] = Number(db.prepare('SELECT id FROM perspectives WHERE key = ?').get(p.key).id);
    }

    const objByTitle = {};
    let osort = 0;
    for (const o of PLAN) {
      const info = db.prepare(`INSERT INTO objectives (perspective_id, department_id, title, description, sort)
                   VALUES (?, ?, ?, ?, ?)`)
        .run(perspId[o.persp], deptId[o.dept], o.title, o.desc, ++osort);
      const oid = Number(info.lastInsertRowid);
      objByTitle[o.title] = oid;
      for (const k of o.kpis) {
        const ki = db.prepare(`INSERT INTO kpis
            (objective_id, department_id, name, unit, direction, target, green_at, yellow_at, frequency, owner)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'monatlich', '')`)
          .run(oid, deptId[o.dept], k.name, k.unit, k.dir, k.target, k.green, k.yellow);
        const kid = Number(ki.lastInsertRowid);
        k.values.forEach((v, i) => {
          db.prepare('INSERT INTO measurements (kpi_id, period, value) VALUES (?, ?, ?)')
            .run(kid, PERIODS[i], v);
        });
      }
    }

    for (const it of INITIATIVES) {
      db.prepare(`INSERT INTO initiatives (objective_id, department_id, title, status, responsible, due_date, progress)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(objByTitle[it.objTitle] || null, deptId[it.dept], it.title, it.status, it.responsible, it.due, it.progress);
    }

    for (const u of USERS) {
      const { salt, hash } = hashPassword(u.pw);
      db.prepare(`INSERT INTO users (name, email, pw_hash, pw_salt, role, department_id)
                  VALUES (?, ?, ?, ?, ?, ?)`)
        .run(u.name, u.email, hash, salt, u.role, u.dept ? deptId[u.dept] : null);
    }

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// Nur seeden, wenn noch keine Abteilungen existieren.
function ensureSeed() {
  const n = db.prepare('SELECT COUNT(*) AS c FROM departments').get().c;
  if (n === 0) {
    seed();
    console.log('► Demo-Daten angelegt. Standard-Logins:');
    for (const u of USERS) console.log(`   ${u.email.padEnd(26)} ${u.pw}   (${u.role})`);
    console.log('   Bitte Passwörter nach dem ersten Login ändern!');
  }
}

if (require.main === module) {
  ensureSeed();
  process.exit(0);
}

module.exports = { ensureSeed, seed };
