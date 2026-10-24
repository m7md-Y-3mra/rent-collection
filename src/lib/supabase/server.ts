import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverEnv } from '@/lib/env';

export async function createClient() {
  const store = await cookies();
  return createServerClient(
    serverEnv('NEXT_PUBLIC_SUPABASE_URL'),
    serverEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll(values) {
          try {
            values.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // Server components can read cookies but cannot set them.
          }
        },
      },
    },
  );
}
