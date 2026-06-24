# Projekt-Notizen für Claude

App „rpc Zeiterfassung" – Vite + React + TypeScript, mobile Zeiterfassung.
Persistenz/Login über Supabase (E-Mail + Passwort, Row Level Security); ohne
gültige Supabase-Konfiguration lokaler Fallback (`localStorage`).

## Arbeitsweise / Merge-Workflow

- **Standard:** Änderungen umsetzen → `npm run build` (muss grün sein) → auf einen
  `claude/*`-Branch pushen → Pull Request anlegen → **direkt nach `main` mergen**
  → den/die Nutzer:in **danach** informieren. **Nicht** vorher aufs OK warten.
- Ein Merge nach `main` löst automatisch den GitHub-Pages-Deploy aus
  (`.github/workflows/deploy.yml`); nach dem Merge den Deploy-Lauf prüfen und das
  Ergebnis melden.
- **Ausnahme:** Bei riskanten, weitreichenden, destruktiven oder mehrdeutigen
  Änderungen vorher kurz nachfragen, statt blind zu mergen.

## Build / Verifikation

- Build & Typecheck: `npm run build` (führt `tsc -b && vite build` aus).
- Live-Adresse (GitHub Pages): https://time-tracker-gl.github.io/time-tracker/

## Hinweise

- Öffentlicher Supabase-Publishable/Anon-Key liegt bewusst in
  `src/supabaseConfig.ts` (Schutz via RLS). Den `service_role`-Key niemals ins
  Repo oder in den Chat.
- DB-Schema-Änderungen führt der/die Nutzer:in im Supabase SQL Editor aus
  (`supabase/schema.sql`); aus der Umgebung besteht kein direkter DB-Zugriff.
