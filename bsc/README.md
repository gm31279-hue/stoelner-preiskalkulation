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

## Deployment (öffentliche URL)

GitHub Pages kann diese App **nicht** hosten (Pages liefert nur statische Dateien;
hier läuft ein Node-Server mit Datenbank). Für eine erreichbare Adresse einen
Node-fähigen Hoster nutzen. Vorbereitet ist ein One-Click-Deployment auf
**Render.com** (kostenloser Plan):

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/gm31279-hue/stoelner-preiskalkulation)

Alternativ manuell (z. B. um einen bestimmten Branch zu wählen):

1. Bei [render.com](https://render.com) anmelden (GitHub verbinden).
2. **New → Blueprint** → dieses Repository wählen → gewünschten Branch.
   Render liest `render.yaml` und legt den Web-Service automatisch an.
3. Nach dem Build erscheint die URL, z. B. `https://stoelner-bsc.onrender.com`.

Per Docker (jeder Container-Hoster oder lokal):

```bash
cd bsc
docker build -t stoelner-bsc .
docker run -p 3000:3000 stoelner-bsc      # -> http://localhost:3000
```

> **Datenpersistenz:** Im kostenlosen Render-Plan ist der Speicher flüchtig — bei
> Neustart/Deploy gehen die SQLite-Daten verloren. Für den Dauerbetrieb einen Plan
> mit Disk wählen und `BSC_DB` auf den Mount-Pfad setzen (siehe Kommentar in
> `render.yaml`).

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
