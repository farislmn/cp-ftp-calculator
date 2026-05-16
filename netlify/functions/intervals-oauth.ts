import { createClient } from '@supabase/supabase-js';

// Env vars — set in .env (local) and Netlify dashboard (prod)
const CLIENT_ID             = process.env.INTERVALS_CLIENT_ID!;
const CLIENT_SECRET         = process.env.INTERVALS_CLIENT_SECRET!;
const SUPABASE_URL          = process.env.VITE_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// Minimal typings for Netlify Functions v1 (avoids adding @netlify/functions dep)
interface NetlifyEvent {
  httpMethod: string;
  body: string | null;
  headers: Record<string, string | undefined>;
}
interface NetlifyResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

type RequestBody =
  | { code: string; mode: 'data' }
  | { code: string; mode: 'login' }
  | { code: string; mode: 'connect'; supabaseToken: string };

interface IntervalsTokenResponse {
  access_token: string;
  scope: string;
  athlete: { id: string; name: string };
}

function err(status: number, message: string): NetlifyResponse {
  return { statusCode: status, headers: JSON_HEADERS, body: JSON.stringify({ error: message }) };
}

export async function handler(event: NetlifyEvent): Promise<NetlifyResponse> {
  if (event.httpMethod !== 'POST') return err(405, 'Method Not Allowed');
  if (!CLIENT_ID || !CLIENT_SECRET) return err(500, 'Server misconfiguration: missing Intervals.icu credentials');
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return err(500, 'Server misconfiguration: missing Supabase service key');

  let body: RequestBody;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return err(400, 'Invalid JSON body');
  }
  if (!body.code) return err(400, 'Missing authorization code');

  // ── Exchange authorization code for Intervals.icu access token ───────────────
  let tokenData: IntervalsTokenResponse;
  try {
    const res = await fetch('https://intervals.icu/api/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: body.code,
      }).toString(),
    });
    if (!res.ok) {
      const detail = await res.text();
      return err(502, `Intervals.icu token exchange failed (HTTP ${res.status}): ${detail}`);
    }
    tokenData = (await res.json()) as IntervalsTokenResponse;
  } catch (e) {
    return err(502, `Network error during token exchange: ${(e as Error).message}`);
  }

  const { access_token, athlete } = tokenData;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── DATA mode: return token only, no Supabase account needed ────────────────
  if (body.mode === 'data') {
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ athleteId: athlete.id, athleteName: athlete.name, intervalsToken: access_token }),
    };
  }

  // ── CONNECT mode: attach Intervals.icu to an existing Supabase account ────────
  if (body.mode === 'connect') {
    // Verify the caller's Supabase JWT
    const { data: { user }, error: authErr } = await supabase.auth.getUser(body.supabaseToken);
    if (authErr || !user) return err(401, 'Invalid Supabase session');

    const { error } = await supabase.from('user_profiles').upsert({
      id: user.id,
      athlete_id: athlete.id,
      intervals_access_token: access_token,
      intervals_athlete_name: athlete.name,
      updated_at: new Date().toISOString(),
    });
    if (error) return err(500, error.message);

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ athleteId: athlete.id, athleteName: athlete.name }),
    };
  }

  // ── LOGIN mode: create/find a Supabase user keyed to this intervals.icu athlete
  const pseudoEmail = `intervals_${athlete.id}@aturpace.app`;

  // createUser is idempotent-ish: if user already exists we get an error but that's fine
  const { data: created } = await supabase.auth.admin.createUser({
    email: pseudoEmail,
    email_confirm: true,
    user_metadata: { intervals_athlete_id: athlete.id, full_name: athlete.name },
  });

  // Resolve the Supabase user ID — prefer the freshly-created user, fall back to profile lookup
  let supabaseUserId: string | null = created?.user?.id ?? null;

  if (!supabaseUserId) {
    // User already existed — find them via the user_profiles table
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('athlete_id', athlete.id)
      .maybeSingle();
    supabaseUserId = profile?.id ?? null;
  }

  if (!supabaseUserId) return err(500, 'Could not create or locate Supabase account');

  // Store/refresh the Intervals.icu token in user_profiles
  await supabase.from('user_profiles').upsert({
    id: supabaseUserId,
    athlete_id: athlete.id,
    intervals_access_token: access_token,
    intervals_athlete_name: athlete.name,
    updated_at: new Date().toISOString(),
  });

  // Generate a magic-link token — we use the hashed_token directly on the client
  // (no email is sent; this is purely a programmatic session-creation mechanism)
  const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: pseudoEmail,
  });

  if (linkErr || !linkData?.properties?.hashed_token) {
    return err(500, linkErr?.message ?? 'Failed to generate session token');
  }

  return {
    statusCode: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify({
      tokenHash: linkData.properties.hashed_token,
      athleteId: athlete.id,
      athleteName: athlete.name,
      intervalsToken: access_token,
    }),
  };
}
