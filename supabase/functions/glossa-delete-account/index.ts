// Deploy to Glossa's own identity project. Never touches books or cloud files.
import { createClient } from 'npm:@supabase/supabase-js@2.76.1';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return new Response('{}', { status: 405, headers });
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization');
  if (!url || !key || !authorization?.startsWith('Bearer '))
    return new Response('{}', { status: 401, headers });
  try {
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Verify the caller at Auth. Never trust a request-body user ID or decoded JWT alone.
    const {
      data: { user },
      error,
    } = await client.auth.getUser(authorization.slice(7));
    if (error || !user) return new Response('{}', { status: 401, headers });
    const deleted = await client.auth.admin.deleteUser(user.id);
    if (deleted.error) return new Response('{}', { status: 500, headers });
    return new Response(JSON.stringify({ deleted: true }), { headers });
  } catch {
    return new Response('{}', { status: 500, headers });
  }
});
