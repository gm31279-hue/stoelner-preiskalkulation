'use strict';

// Ampel-Logik und Aggregation für die Balanced Scorecard.

// Status einer Kennzahl anhand des aktuellen Werts und der Schwellen.
// direction 'up'  -> höher ist besser  (grün, wenn value >= green_at)
// direction 'down'-> niedriger ist besser (grün, wenn value <= green_at)
function kpiStatus(kpi, value) {
  if (value == null || Number.isNaN(value)) return 'none';
  const { direction, green_at, yellow_at } = kpi;
  const g = green_at, y = yellow_at;
  if (g == null && y == null) return 'none';

  if (direction === 'down') {
    if (g != null && value <= g) return 'green';
    if (y != null && value <= y) return 'yellow';
    return 'red';
  }
  // default: up
  if (g != null && value >= g) return 'green';
  if (y != null && value >= y) return 'yellow';
  return 'red';
}

// Zielerreichung in Prozent (gedeckelt 0..150) — nur zur Anzeige.
function attainment(kpi, value) {
  if (value == null || kpi.target == null || kpi.target === 0) return null;
  let pct;
  if (kpi.direction === 'down') {
    // niedriger besser: target/value
    pct = value === 0 ? 150 : (kpi.target / value) * 100;
  } else {
    pct = (value / kpi.target) * 100;
  }
  return Math.max(0, Math.min(150, Math.round(pct)));
}

const RANK = { red: 0, yellow: 1, green: 2, none: 3 };

// Aus mehreren Status den "schlechtesten echten" Gesamtstatus bilden.
function rollup(statuses) {
  const real = statuses.filter((s) => s !== 'none');
  if (!real.length) return 'none';
  return real.reduce((worst, s) => (RANK[s] < RANK[worst] ? s : worst), 'green');
}

function countByStatus(statuses) {
  const c = { green: 0, yellow: 0, red: 0, none: 0 };
  for (const s of statuses) c[s] = (c[s] || 0) + 1;
  return c;
}

module.exports = { kpiStatus, attainment, rollup, countByStatus };
