import 'server-only';

type ServerVariable = 'DATABASE_URL' | 'DIRECT_URL' | 'SUPABASE_SECRET_KEY' | 'GATEWAY_X_SIGNATURE_KEY' | 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY';

export function serverEnv(name: ServerVariable): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}
