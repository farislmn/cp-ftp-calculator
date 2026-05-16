import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createClient } from '@supabase/supabase-js';
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

// ── Local dev OAuth handler ────────────────────────────────────────────────────
// Replicates the Netlify function logic inside Vite's dev server so `npm run dev`
// handles OAuth without needing `netlify dev`.
function localOAuthPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'local-intervals-oauth',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(
        '/.netlify/functions/intervals-oauth',
        (req: IncomingMessage, res: ServerResponse) => {
          if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }

          let raw = '';
          req.on('data', (c: Buffer) => { raw += c.toString(); });
          req.on('end', () => {
            handleOAuth(raw, env)
              .then(({ status, body }) => {
                res.writeHead(status, { 'Content-Type': 'application/json' });
                res.end(body);
              })
              .catch((e: Error) => {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
              });
          });
        },
      );
    },
  };
}

async function handleOAuth(
  rawBody: string,
  env: Record<string, string>,
): Promise<{ status: number; body: string }> {
  const ok  = (body: object) => ({ status: 200, body: JSON.stringify(body) });
  const err = (status: number, message: string) =>
    ({ status, body: JSON.stringify({ error: message }) });

  const CLIENT_ID   = env.INTERVALS_CLIENT_ID;
  const CLIENT_SECRET = env.INTERVALS_CLIENT_SECRET;
  const SUPABASE_URL  = env.VITE_SUPABASE_URL;
  const SERVICE_KEY   = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!CLIENT_ID || !CLIENT_SECRET) return err(500, 'Missing Intervals.icu credentials in .env');
  if (!SUPABASE_URL || !SERVICE_KEY) return err(500, 'Missing Supabase service key in .env');

  let body: { code: string; mode: 'login' | 'connect' | 'data'; supabaseToken?: string };
  try { body = JSON.parse(rawBody); } catch { return err(400, 'Invalid JSON'); }
  if (!body.code) return err(400, 'Missing authorization code');

  // Exchange code for Intervals.icu access token
  const tokenRes = await fetch('https://intervals.icu/api/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code: body.code }).toString(),
  });
  if (!tokenRes.ok) return err(502, `Token exchange failed: ${await tokenRes.text()}`);

  const { access_token, athlete } = await tokenRes.json() as {
    access_token: string;
    athlete: { id: string; name: string };
  };

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // data mode: just return the token, no Supabase involved
  if (body.mode === 'data') {
    return ok({ athleteId: athlete.id, athleteName: athlete.name, intervalsToken: access_token });
  }

  if (body.mode === 'connect') {
    const { data: { user }, error: authErr } = await supabase.auth.getUser(body.supabaseToken);
    if (authErr || !user) return err(401, 'Invalid Supabase session');
    const { error } = await supabase.from('user_profiles').upsert({
      id: user.id, athlete_id: athlete.id,
      intervals_access_token: access_token, intervals_athlete_name: athlete.name,
      updated_at: new Date().toISOString(),
    });
    if (error) return err(500, error.message);
    return ok({ athleteId: athlete.id, athleteName: athlete.name });
  }

  // login mode
  const pseudoEmail = `intervals_${athlete.id}@aturpace.app`;
  const { data: created } = await supabase.auth.admin.createUser({
    email: pseudoEmail, email_confirm: true,
    user_metadata: { intervals_athlete_id: athlete.id, full_name: athlete.name },
  });

  let supabaseUserId = created?.user?.id ?? null;
  if (!supabaseUserId) {
    const { data: profile } = await supabase.from('user_profiles').select('id')
      .eq('athlete_id', athlete.id).maybeSingle();
    supabaseUserId = profile?.id ?? null;
  }
  if (!supabaseUserId) return err(500, 'Could not create or locate Supabase account');

  await supabase.from('user_profiles').upsert({
    id: supabaseUserId, athlete_id: athlete.id,
    intervals_access_token: access_token, intervals_athlete_name: athlete.name,
    updated_at: new Date().toISOString(),
  });

  const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
    type: 'magiclink', email: pseudoEmail,
  });
  if (linkErr || !linkData?.properties?.hashed_token)
    return err(500, linkErr?.message ?? 'Failed to generate session token');

  return ok({
    tokenHash: linkData.properties.hashed_token,
    athleteId: athlete.id, athleteName: athlete.name,
    intervalsToken: access_token,
  });
}

// ── Vite config ───────────────────────────────────────────────────────────────

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), localOAuthPlugin(env)],
    server: {
      proxy: {
        '/api': { target: 'https://intervals.icu', changeOrigin: true },
      },
    },
  };
});
