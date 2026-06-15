# Stölner BSC — Abteilungsübergreifende Balanced Scorecard

Web-App, die die Unternehmens-Balanced-Scorecard für alle Abteilungen praxistauglich
macht: gemeinsame Datenbank, Login pro Abteilung, Ampel-Cockpit, Kennzahlen-Trends,
Maßnahmenverfolgung und Live-Aktualisierung.

## Funktionen

- **Cockpit** mit den 4 BSC-Perspektiven (Finanzen, Kunden, Prozesse, Lernen & Entwicklung),
  Ampelstatus (grün/gelb/rot), Zielerreichung und Mini-Trends je Kennzahl.
- **Abteilungsfilter** — Gesamtsicht oder einzelne Abteilung (Vertrieb, Einkauf,
  Werkstatt, Verwaltung).
- **Kennzahlen-Detail** mit Liniendiagramm, Zielmarke und Werterfassung pro Periode.
- **Maßnahmen-Board** (offen / laufend / erledigt / gestoppt) mit Verantwortlichen,
  Fälligkeit und Fortschritt.
- **Rollen & Rechte**: Administrator, Leitung, Mitarbeiter, Betrachter. Bearbeitung
  von Kennzahlen/Werten ist auf die eigene Abteilung beschränkt.
- **Live-Updates** über Server-Sent-Events — Änderungen erscheinen sofort bei allen.
- **Benutzerverwaltung** (Admin) und **CSV-Export** des aktuellen Stands.

## Technik

- Node.js (≥ 22.5) + Express
- SQLite über das eingebaute Modul `node:sqlite` (keine native Kompilierung nötig)
- Frontend: reines HTML/CSS/Vanilla-JS (keine externen CDN-Abhängigkeiten, offline-fähig)
- Authentifizierung: Session-Cookies, Passwort-Hashing mit scrypt

## Start

```bash
cd bsc
npm install
npm start
# -> http://localhost:3000
```

Beim ersten Start wird die Datenbank (`data/bsc.db`) angelegt und mit Demo-Daten
sowie Standard-Logins befüllt (in der Konsole ausgegeben):

| E-Mail                   | Passwort        | Rolle  | Abteilung   |
|--------------------------|-----------------|--------|-------------|
| admin@stoelner.at        | admin123        | Admin  | –           |
| vertrieb@stoelner.at     | vertrieb123     | Leitung| Vertrieb    |
| einkauf@stoelner.at      | einkauf123      | Leitung| Einkauf     |
| werkstatt@stoelner.at    | werkstatt123    | Leitung| Werkstatt   |
| verwaltung@stoelner.at   | verwaltung123   | Leitung| Verwaltung  |

> **Wichtig:** Passwörter nach dem ersten Login ändern. Für den Produktivbetrieb
> hinter HTTPS betreiben (z. B. via Reverse-Proxy) und die Demo-Konten entfernen/ändern.

## Konfiguration

- `PORT` — Port (Standard `3000`)
- `BSC_DB` — Pfad zur SQLite-Datei (Standard `bsc/data/bsc.db`)

## Datenmodell (Kurzüberblick)

`perspectives` → `objectives` (Ziele, je Perspektive/Abteilung) → `kpis` (Kennzahlen mit
Zielwert, Richtung, Ampelschwellen) → `measurements` (Messwerte pro Periode).
Daneben `initiatives` (Maßnahmen), `users`/`sessions` (Auth) und `audit_log`.

### Ampel-Logik

Je Kennzahl: Richtung (höher/niedriger = besser) plus Schwellen „Grün ab" und „Gelb ab".
Status ergibt sich aus dem aktuellsten Messwert. Der Gesamtstatus einer Perspektive bzw.
des Unternehmens ist der jeweils schlechteste enthaltene Status.
