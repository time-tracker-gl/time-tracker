/* Supabase connection settings.
 *
 * These are PUBLIC values by design:
 *  - the project URL is public,
 *  - the "publishable"/anon key is meant to be embedded in the browser bundle.
 * Security is enforced server-side by Row Level Security (see supabase/schema.sql),
 * NOT by hiding this key. Never put the `secret`/`service_role` key here.
 *
 * Values can be overridden at build time via Vite env vars
 * (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
 */
export const SUPABASE_URL = 'https://jepkmxyvjudoqpcyyoxh.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_m4JurF_D-n1VAaIIc6yGFA_M84nvlwe';
