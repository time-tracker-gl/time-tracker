# Supabase-Einrichtung

Die App nutzt Supabase für Login (Magic-Link per E-Mail) und zum dauerhaften,
geräteübergreifenden Speichern von Projekten und Buchungen. Die Verbindungsdaten
stehen in `src/supabaseConfig.ts` (Projekt-URL + öffentlicher „publishable“-Key –
beides ist bewusst öffentlich; der Schutz läuft über Row Level Security).

Damit alles funktioniert, sind **zwei einmalige Schritte** im Supabase-Dashboard nötig:

## 1. Datenbank-Schema anlegen

1. Dashboard → **SQL Editor** → **New query**.
2. Inhalt von [`supabase/schema.sql`](./supabase/schema.sql) hineinkopieren.
3. **Run** klicken.

Damit entstehen die Tabellen `projects` und `segments` inkl. Row-Level-Security-
Regeln (jede:r sieht nur die eigenen Daten).

## 2. Auth-URLs konfigurieren

Dashboard → **Authentication** → **URL Configuration**:

- **Site URL:** `https://rpcgeorg.github.io/time-tracker/`
- **Redirect URLs** (hinzufügen):
  - `https://rpcgeorg.github.io/time-tracker/`
  - `http://localhost:5173/` (für lokale Entwicklung)

Der E-Mail-Provider (Magic Link) ist bei neuen Projekten standardmäßig aktiv.
Optional unter **Authentication → Providers → Email** prüfen, dass „Email“ aktiviert ist.

## Fertig

Danach: Seite öffnen → E-Mail eingeben → Link in der Mail antippen → angemeldet.
Projekte und Buchungen werden automatisch in Supabase gespeichert und auf jedem
Gerät nach Login geladen. Abmelden geht im Tab **Pflege** unten.

## Hinweise / Grenzen

- Datenmodell ist weiterhin **auf einen Tag** ausgelegt (Uhrzeit ohne übergreifende
  Historie). Buchungen werden mit dem heutigen Datum (`day`) gespeichert; vergangene
  Tage bleiben in der DB erhalten als Grundlage für eine spätere Mehrtages-Ansicht.
- Die **aggregierten Auswertungen** (Woche/Monat/Jahr/Zeitraum) zeigen weiterhin
  Demo-Daten, nicht die realen Buchungen.
- Ohne gültige Supabase-Konfiguration fällt die App automatisch auf den lokalen
  Modus (`localStorage`) zurück und funktioniert ohne Login.
