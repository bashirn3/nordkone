import { createClient } from '@supabase/supabase-js';

export function hasSupabaseConfig() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function createSupabase() {
  if (!hasSupabaseConfig()) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
