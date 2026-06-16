import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../supabaseConfig';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || SUPABASE_URL;
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || SUPABASE_ANON_KEY;

/** True when real Supabase credentials are present. When false the app runs in
 *  local-only mode (localStorage) so it keeps working without a backend. */
export const isSupabaseConfigured = Boolean(url && key && !url.includes('YOUR-') && !key.includes('YOUR-'));

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
