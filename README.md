# rpc Zeiterfassung

Mobile Erfassungs- und Reporting-App für die projektbezogene Zeiterfassung im
Beratungsalltag. Diese Implementierung setzt den Prototyp aus Claude Design
(`Zeiterfassung.dc.html`) und das zugehörige **Anforderungsdokument**
(FA-01 … FA-25, NFA-1 … NFA-3) als echte Web-App um.

Strikt im **rpc Design System**: Roboto-Typografie, Blau-Palette, flache
Flächen, scharfe Ecken, deutschsprachige Oberfläche.

## Stack

- **Vite** + **React 18** + **TypeScript**
- Keine UI-Bibliothek – Styles sind 1:1 aus dem Prototyp portiert (Inline-Styles),
  damit die Optik pixelgenau erhalten bleibt.

## Entwicklung

```bash
npm install
npm run dev        # Dev-Server (http://localhost:5173)
npm run build      # Typecheck + Production-Build nach dist/
npm run preview    # Production-Build lokal ansehen
npm run typecheck  # nur TypeScript prüfen
```

## Funktionsumfang

Drei Tabs in der unteren Navigation:

### Buchungen (Tracking)
- Projekte als Kacheln; Tipp startet die Erfassung (FA-01).
- Projektwechsel stoppt die laufende Buchung automatisch und öffnet die
  Tätigkeitserfassung (FA-02).
- Status-Banner „Läuft / Pausiert / Keine Erfassung“ mit live mitlaufender
  Dauer (FA-03, FA-07).
- Pause / Fortsetzen – Fortsetzen startet eine neue Buchung auf demselben
  Projekt (FA-04).
- „Tagesende“ in der Kopfzeile beendet die Erfassung (FA-05).
- Drei umschaltbare Kachel-Layouts: Raster, Gewichtet, Liste (FA-06).

### Pflege (Projektverwaltung)
- Projekte anlegen (Code, Name, Farbe), Code/Name inline bearbeiten,
  Farbe per Tipp durchschalten, löschen inkl. Buchungen (FA-08 … FA-11).

### Tätigkeitserfassung & Detailbearbeitung
- Detailblatt nach dem Stoppen einer Buchung (FA-12).
- iOS-Style Scroll-Räder für Start/Ende (Std/Min, 5-Minuten-Schritte), Dauer
  live (FA-13), mit Mindestdauer 5 Min und Tagesgrenzen (FA-14).
- Tätigkeit als Freitext; Speichern übernimmt, Schließen verwirft (FA-15).

### Reporting
- **Tagesansicht**: chronologische Achse ab 00:00, farbige Buchungsblöcke mit
  Kürzel/Zeit/Dauer/Tätigkeit, Spuren bei Überlappung, schraffierte Lücken zum
  Füllen (inkl. führender Lücke 00:00 → erste Buchung), ziehbare Ränder
  (5-Min-Raster), „Jetzt“-Linie, Tagessumme + Verteilungsbalken mit Legende
  (FA-16 … FA-22).
- **Aggregiert** (Heute · Woche · Monat · Jahr · Zeitraum): gestapeltes
  Säulendiagramm und Projekt-Rangliste mit Anteilen (FA-23 … FA-25).

## Annahmen & offene Punkte

Aus dem Anforderungsdokument übernommen bzw. bei der Umsetzung getroffen:

- **Persistenz**: Mit Supabase angebunden – Login per Magic-Link-E-Mail,
  Projekte und Buchungen werden pro Nutzer:in dauerhaft und geräteübergreifend
  gespeichert (Row Level Security). Einrichtung siehe [`SUPABASE.md`](./SUPABASE.md).
  Ohne gültige Supabase-Konfiguration fällt die App automatisch auf den lokalen
  Modus (`localStorage`) ohne Login zurück. Das Datenmodell ist weiterhin auf
  einen Tag ausgelegt (Buchungen mit Datum `day`; übergreifende Historie offen).
- **Aggregierte Auswertungen** (Woche/Monat/Jahr/Zeitraum) basieren auf
  deterministischen Demo-Daten und sind noch nicht mit den realen Buchungen
  verknüpft. Nur die Tagesansicht nutzt echte Buchungsdaten.
- Rollen, Freigabe-/Genehmigungs-Workflows, Mandanten- und Exportfunktionen
  sind nicht enthalten.
- Zeitliche Granularität: 5-Minuten-Schritte.
