import 'server-only';
import { createClient as supabaseClient } from '@supabase/supabase-js';
import { serverEnv } from '@/lib/env';

export function createClient() {
  return supabaseClient(serverEnv('NEXT_PUBLIC_SUPABASE_URL'), serverEnv('SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
