/**
 * NeuroBusiness™ AI — Cloudflare Worker
 * Datei: workers/ai.js
 *
 * POST /api/ai
 *
 * Was dieser Worker macht:
 *   1. Magic-Link-Token aus dem Authorization-Header validieren
 *   2. Nutzerprofil + business_profile + letzte Check-ins aus Supabase laden
 *   3. System-Prompt mit Psychotyp-Kontext bauen
 *   4. Anfrage an Claude API senden (serverseitig — kein API Key im Frontend)
 *   5. Antwort in Supabase messages + recommendations speichern
 *   6. Antwort an Frontend zurückgeben
 *
 * Environment Variables (in Cloudflare Dashboard setzen):
 *   SUPABASE_URL          z.B. https://xyz.supabase.co
 *   SUPABASE_SERVICE_KEY  service_role key (niemals anon key hier!)
 *   ANTHROPIC_API_KEY     sk-ant-...
 *   ALLOWED_ORIGIN        https://neurobusiness.one (CORS)
 */

export default {
  async fetch(request, env) {
    // ── CORS ──────────────────────────────────────────────────────
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || 'https://neurobusiness.one';
    const corsHeaders = {
      'Access-Control-Allow-Origin': (origin === allowed || origin.includes('localhost') || origin.includes('pages.dev') || origin.endsWith('.evaa-com.workers.dev')) ? origin : allowed,
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-key',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const pathname = new URL(request.url).pathname;

    // ── /api/stripe-webhook ───────────────────────────────────────
    // Stripe sendet immer POST ohne CORS-Preflight — kein Origin-Check nötig.
    // Secrets kommen AUS CLOUDFLARE ENV, niemals hartcodiert:
    //   STRIPE_SECRET_KEY       → Cloudflare Pages → Settings → Environment variables
    //   STRIPE_WEBHOOK_SECRET   → Cloudflare Pages → Settings → Environment variables
    //   SUPABASE_SERVICE_KEY    → bereits vorhanden
    if (pathname === '/api/stripe-webhook') {
      return handleStripeWebhook(request, env);
    }

    // ── /api/create-checkout ─────────────────────────────────────
    // Coach erstellt einen Stripe Checkout-Link für einen Klienten.
    // Auth: Supabase JWT im Authorization-Header.
    if (pathname === '/api/create-checkout') {
      return handleCreateCheckout(request, env, corsHeaders);
    }

    // ── /api/save-diagnostic ──────────────────────────────────────
    if (pathname === '/api/save-diagnostic') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }

      const { token: diagToken, primary, secondary, scores, subscales, scorePayload, burnout, industry, years, d1, d2, d3, d4, d5, responseSetWarning, answers, lang, consentResearch, consentResearchVersion, consentDsgvo, consentTimestamp, consentSource, teamCode } = body;
      if (!diagToken || !primary) return json({ error: 'Missing token or primary' }, 400, corsHeaders);

      // Validate token → get user_id
      const tokenData = await supabaseGet(`access_tokens?token=eq.${encodeURIComponent(diagToken)}&select=user_id,expires_at`, env);
      const row = tokenData?.[0];
      if (!row || new Date(row.expires_at) < new Date()) return json({ error: 'Invalid or expired token' }, 401, corsHeaders);

      // Update profile using service role key (bypasses RLS)
      const patch = {
        psychotype: primary,
        secondary_psychotype: secondary || null,
        score_s: scores?.S ?? 0,
        score_v: scores?.V ?? 0,
        score_m: scores?.M ?? 0,
        score_c: scores?.C ?? 0,
        score_g: scores?.G ?? 0,
        burnout_alert: burnout ? true : false,
        industry: industry || null,
        years_self_employed: years || null,
        diagnostic_completed_at: new Date().toISOString(),
        report_context: JSON.stringify({ primary, secondary: secondary || null, scores, subscales: subscales || null, burnout, industry, years, d1, d2, d3, d4, d5 }),
        consent_dsgvo: consentDsgvo === true,
        consent_timestamp: consentTimestamp || new Date().toISOString(),
        consent_source: consentSource || 'solo_direct',
      };

      // Team-Zuordnung (B2B): nur setzen wenn der Code ein existierendes Team ist
      if (teamCode && /^[A-Z0-9]{4,12}$/i.test(teamCode)) {
        const teamCheck = await supabaseGet(`teams?code=eq.${encodeURIComponent(teamCode.toUpperCase())}&select=code`, env);
        if (teamCheck?.[0]) patch.team_code = teamCheck[0].code;
      }

      const patchRes = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${row.user_id}`, {
        method: 'PATCH',
        headers: {
          'apikey': env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify(patch),
      });

      if (!patchRes.ok) {
        const err = await patchRes.text();
        return json({ error: 'Profile update failed', detail: err }, 500, corsHeaders);
      }

      // ── Topf 2: Forschungsdaten (anonym) ────────────────────────────
      // Nur schreiben wenn: (a) aktive Einwilligung, (b) genau 50 Antworten, (c) alle Werte 1–5
      // KEIN user_id — Tabelle bleibt strikt anonym (Rechtsgrundlage: Art. 6 Abs. 1 lit. a DSGVO)
      if (consentResearch === true && Array.isArray(answers) && answers.length === 50) {
        const allValid = answers.every(v => Number.isInteger(v) && v >= 1 && v <= 5);
        if (allValid) {
          const answerRow = {};  // bewusst kein user_id
          answers.forEach((val, i) => { answerRow['q' + (i + 1)] = val; });
          answerRow.lang = lang || null;
          answerRow.industry = industry || null;
          answerRow.years = years || null;
          answerRow.response_set_warning = !!responseSetWarning;
          answerRow.consent_research = true;
          answerRow.consent_research_version = consentResearchVersion || 'v1.0_2026-06';
          answerRow.consent_source = consentSource || 'solo_direct';
          fetch(`${env.SUPABASE_URL}/rest/v1/diagnostic_responses`, {
            method: 'POST',
            headers: {
              'apikey': env.SUPABASE_SERVICE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify(answerRow),
          }).catch(console.error);
        }
      }

      // ── Validierungs-Topf: nbif_sessions / nbif_raw_responses / nbif_scores (anonym) ──
      if (consentResearch === true && Array.isArray(answers) && answers.length === 50 &&
          answers.every(v => Number.isInteger(v) && v >= 1 && v <= 5) && body.sessionId) {
        const sv = body.scoringVersion || 'nbif-2026-06-efa';
        const startedAt = body.startedAt || null;
        const completedAt = body.completedAt || new Date().toISOString();
        const durMs = (startedAt && completedAt) ? (new Date(completedAt) - new Date(startedAt)) : null;
        const sbH = { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' };
        const sbPost = (table, payload) => fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, { method: 'POST', headers: sbH, body: JSON.stringify(payload) });
        try {
          // 1. Session zuerst (FK-Ziel)
          await sbPost('nbif_sessions', {
            session_id: body.sessionId,
            started_at: startedAt,
            completed_at: completedAt,
            completion_status: 'completed',
            duration_ms: durMs,
            device_type: body.deviceType || null,
            user_agent: (body.userAgent || '').slice(0, 400) || null,
            referrer_source: body.referrerSource || null,
            lang: lang || null,
            scoring_version: sv,
            consent_research: true,
            consent_source: consentSource || 'solo_direct',
            consent_research_version: consentResearchVersion || 'v1.0_2026-06',
            response_set_warning: !!responseSetWarning,
          });
          // 2. Roh-Items (Long-Format, 50 Zeilen in einem Batch)
          const timings = Array.isArray(body.itemTimings) ? body.itemTimings : [];
          const rawRows = answers.map((val, i) => ({
            session_id: body.sessionId,
            question_id: i + 1,
            dimension: 'D' + (Math.floor(i / 10) + 1),
            response_value: val,
            response_time_ms: Number.isFinite(timings[i]) ? timings[i] : null,
          }));
          await sbPost('nbif_raw_responses', rawRows);
          // 3. Scores (versioniert)
          await sbPost('nbif_scores', {
            session_id: body.sessionId,
            scoring_version: sv,
            d1_score: d1 ?? null, d2_score: d2 ?? null, d3_score: d3 ?? null, d4_score: d4 ?? null, d5_score: d5 ?? null,
            s_score: scores?.S ?? null, v_score: scores?.V ?? null, m_score: scores?.M ?? null, c_score: scores?.C ?? null, g_score: scores?.G ?? null,
            primary_type: primary || null,
            secondary_type: secondary || null,
            burnout_flag: burnout ? true : false,
            subscales_json: subscales && typeof subscales === 'object' ? subscales : null,
            score_payload_json: scorePayload && typeof scorePayload === 'object'
              ? scorePayload
              : { primary, secondary: secondary || null, scores, subscales: subscales || null, burnout: !!burnout, d1, d2, d3, d4, d5 },
          });
        } catch (nbifErr) { console.error('nbif write failed (non-blocking):', nbifErr); }
      }

      return json({ ok: true }, 200, corsHeaders);
    }

    // ── /api/validate-token ──────────────────────────────────────
    if (pathname === '/api/validate-token') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }
      const { token: vToken } = body;
      if (!vToken) return json({ error: 'Missing token' }, 400, corsHeaders);
      const vProfile = await validateTokenAndGetProfile(vToken, env);
      if (!vProfile) return json({ error: 'Invalid or expired token' }, 401, corsHeaders);
      return json({ user: {
        id: vProfile.id,
        email: vProfile.email,
        firstName: vProfile.first_name,
        psychotype: vProfile.psychotype,
        secondaryPsychotype: vProfile.secondary_psychotype,
        scoreS: vProfile.score_s, scoreV: vProfile.score_v, scoreM: vProfile.score_m,
        scoreC: vProfile.score_c, scoreG: vProfile.score_g,
        burnoutAlert: vProfile.burnout_alert,
        lang: vProfile.lang,
      }}, 200, corsHeaders);
    }

    // ── /api/request-access ──────────────────────────────────────
    if (pathname === '/api/request-access') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }
      const { email, lang = 'de' } = body;
      if (!email) return json({ error: 'Missing email' }, 400, corsHeaders);

      const profiles = await supabaseGet(`profiles?email=eq.${encodeURIComponent(email)}&select=id,first_name,email&limit=1`, env);
      const userData = profiles?.[0];
      if (!userData) return json({ error: 'not_found' }, 404, corsHeaders);

      const token = Math.random().toString(36).substr(2, 16) + Date.now().toString(36);
      const expires_at = new Date(Date.now() + 7*24*60*60*1000).toISOString();
      await supabasePost('access_tokens', { email, token, user_id: userData.id, expires_at }, env);

      const appUrl = `https://neurobusiness.one/app?token=${token}`;
      fetch('https://evakolontai.app.n8n.cloud/webhook/nb-magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, token, appUrl, name: userData.first_name || '', lang }),
      }).catch(() => {});

      return json({ ok: true }, 200, corsHeaders);
    }

    // ── /api/stats ────────────────────────────────────────────────
    if (pathname === '/api/stats') {
      const stToken = (request.headers.get('Authorization') || '').replace('Bearer ', '').trim();
      const stProfile = await validateTokenAndGetProfile(stToken, env);
      if (!stProfile) return json({ error: 'Unauthorized' }, 401, corsHeaders);

      const convs = await supabaseGet(`conversations?user_id=eq.${stProfile.id}&select=created_at&order=created_at.desc`, env) || [];
      let streak = 0;
      if (convs.length > 0) {
        const dates = [...new Set(convs.map(r => r.created_at.split('T')[0]))].sort().reverse();
        let prev = new Date(); prev.setHours(0,0,0,0);
        for (const d of dates) {
          const cur = new Date(d);
          const diff = Math.round((prev - cur) / 86400000);
          if (diff <= 1) { streak++; prev = cur; } else break;
        }
      }
      return json({ sessions: convs.length, streak }, 200, corsHeaders);
    }

    // ── /api/checkin ─────────────────────────────────────────────
    if (pathname === '/api/checkin') {
      const ciToken = (request.headers.get('Authorization') || '').replace('Bearer ', '').trim();
      const ciProfile = await validateTokenAndGetProfile(ciToken, env);
      if (!ciProfile) return json({ error: 'Unauthorized' }, 401, corsHeaders);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }
      await supabasePost('checkins', { user_id: ciProfile.id, ...body }, env);
      return json({ ok: true }, 200, corsHeaders);
    }

    // ── /api/checkins (Historie für Insights & Alignment Score) ──
    if (pathname === '/api/checkins') {
      const chToken = (request.headers.get('Authorization') || '').replace('Bearer ', '').trim();
      const chProfile = await validateTokenAndGetProfile(chToken, env);
      if (!chProfile) return json({ error: 'Unauthorized' }, 401, corsHeaders);
      const rows = await supabaseGet(`checkins?user_id=eq.${chProfile.id}&select=energy_level,stress_level,focus_level,note,created_at&order=created_at.desc&limit=60`, env) || [];
      return json({ checkins: rows }, 200, corsHeaders);
    }

    // ── /api/decisions (Decision Log) ─────────────────────────────
    if (pathname === '/api/decisions') {
      const dcToken = (request.headers.get('Authorization') || '').replace('Bearer ', '').trim();
      const dcProfile = await validateTokenAndGetProfile(dcToken, env);
      if (!dcProfile) return json({ error: 'Unauthorized' }, 401, corsHeaders);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }
      const { action, title, note, aligned, energy_at } = body;

      if (action === 'list') {
        const decisions = await supabaseGet(`decisions?user_id=eq.${dcProfile.id}&select=*&order=created_at.desc&limit=50`, env) || [];
        return json({ decisions }, 200, corsHeaders);
      }
      if (action === 'create') {
        if (!title) return json({ error: 'title required' }, 400, corsHeaders);
        const result = await supabasePost('decisions', {
          user_id: dcProfile.id,
          title: String(title).slice(0, 300),
          note: note ? String(note).slice(0, 1000) : null,
          aligned: ['yes','no','unsure'].includes(aligned) ? aligned : 'unsure',
          energy_at: energy_at || null,
        }, env);
        return json({ id: result?.id || null }, 200, corsHeaders);
      }
      return json({ error: 'Unknown action' }, 400, corsHeaders);
    }

    // ── /api/tasks ───────────────────────────────────────────────
    if (pathname === '/api/tasks') {
      const tkToken = (request.headers.get('Authorization') || '').replace('Bearer ', '').trim();
      const tkProfile = await validateTokenAndGetProfile(tkToken, env);
      if (!tkProfile) return json({ error: 'Unauthorized' }, 401, corsHeaders);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }
      const { action, taskId, task_text, week_tag, status: taskStatus } = body;

      if (action === 'list') {
        const tasks = await supabaseGet(`tasks?user_id=eq.${tkProfile.id}&select=*&order=created_at.desc&limit=20`, env) || [];
        return json({ tasks }, 200, corsHeaders);
      }
      if (action === 'create') {
        const result = await supabasePost('tasks', { user_id: tkProfile.id, task_text, status: 'planned', week_tag: week_tag || null }, env);
        return json({ id: result?.id || null }, 200, corsHeaders);
      }
      if (action === 'update' && taskId) {
        await fetch(`${env.SUPABASE_URL}/rest/v1/tasks?id=eq.${taskId}&user_id=eq.${tkProfile.id}`, {
          method: 'PATCH',
          headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({ status: taskStatus }),
        });
        return json({ ok: true }, 200, corsHeaders);
      }
      return json({ error: 'Unknown action' }, 400, corsHeaders);
    }

    // ── /api/feedback ─────────────────────────────────────────────
    if (pathname === '/api/feedback') {
      const fbToken = (request.headers.get('Authorization') || '').replace('Bearer ', '').trim();
      const fbProfile = await validateTokenAndGetProfile(fbToken, env);
      if (!fbProfile) return json({ error: 'Unauthorized' }, 401, corsHeaders);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }
      await supabasePost('feedback', { user_id: fbProfile.id, ...body }, env);
      return json({ ok: true }, 200, corsHeaders);
    }

    // ── /api/team-create (B2B) ────────────────────────────────────
    // Eva legt ein Team an. Schutz: ADMIN_KEY (wrangler secret put ADMIN_KEY).
    if (pathname === '/api/team-create') {
      if (!env.ADMIN_KEY) return json({ error: 'ADMIN_KEY not configured' }, 503, corsHeaders);
      const adminKey = request.headers.get('x-admin-key') || '';
      if (adminKey !== env.ADMIN_KEY) return json({ error: 'Unauthorized' }, 401, corsHeaders);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }
      const { name, ownerEmail, seats } = body;
      if (!name) return json({ error: 'name required' }, 400, corsHeaders);
      // Kurzen, gut diktierbaren Code + Owner-Key generieren
      const rand = (len) => { const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s = ''; const buf = crypto.getRandomValues(new Uint8Array(len)); for (const b of buf) s += chars[b % chars.length]; return s; };
      const code = rand(6);
      const ownerKey = rand(12);
      const created = await supabasePost('teams', { code, owner_key: ownerKey, name: String(name).slice(0, 120), owner_email: ownerEmail || null, seats: Math.min(Math.max(parseInt(seats) || 10, 1), 500) }, env);
      if (!created) return json({ error: 'Team creation failed' }, 500, corsHeaders);
      return json({
        code, ownerKey,
        diagnosticLink: `https://neurobusiness.one/diagnostic.html?team=${code}`,
        dashboard: `https://neurobusiness.one/team-dashboard.html`,
      }, 200, corsHeaders);
    }

    // ── /api/team-list (Admin: alle Teams mit Fortschritt) ────────
    if (pathname === '/api/team-list') {
      if (!env.ADMIN_KEY) return json({ error: 'ADMIN_KEY not configured' }, 503, corsHeaders);
      const tlKey = request.headers.get('x-admin-key') || '';
      if (tlKey !== env.ADMIN_KEY) return json({ error: 'Unauthorized' }, 401, corsHeaders);
      const allTeams = await supabaseGet(`teams?code=not.is.null&select=code,name,owner_email,seats,created_at&order=created_at.desc&limit=200`, env) || [];
      const counts = await supabaseGet(`profiles?team_code=not.is.null&diagnostic_completed_at=not.is.null&select=team_code`, env) || [];
      const byCode = {};
      for (const c of counts) byCode[c.team_code] = (byCode[c.team_code] || 0) + 1;
      return json({ teams: allTeams.map(t => ({ ...t, completed: byCode[t.code] || 0 })) }, 200, corsHeaders);
    }

    // ── /api/team-report (B2B Team Intelligence Dashboard) ────────
    // Aggregiert — keine Einzelpersonen-Daten an den Team-Owner (DSGVO).
    if (pathname === '/api/team-report') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }
      const { code, ownerKey } = body;
      if (!code || !ownerKey) return json({ error: 'code and ownerKey required' }, 400, corsHeaders);
      const teamRows = await supabaseGet(`teams?code=eq.${encodeURIComponent(code)}&select=code,owner_key,name,seats,created_at`, env);
      const team = teamRows?.[0];
      if (!team || team.owner_key !== ownerKey) return json({ error: 'Unauthorized' }, 401, corsHeaders);

      const members = await supabaseGet(`profiles?team_code=eq.${encodeURIComponent(code)}&diagnostic_completed_at=not.is.null&select=psychotype,secondary_psychotype,score_s,score_v,score_m,score_c,score_g,burnout_alert`, env) || [];
      const n = members.length;
      const report = { teamName: team.name, seats: team.seats, completed: n, minReached: n >= 3 };

      // Aggregat erst ab 3 abgeschlossenen Tests — schützt Einzelpersonen vor Rückschlüssen
      if (n >= 3) {
        const dist = { S: 0, V: 0, M: 0, C: 0, G: 0 };
        let burnout = 0;
        const sums = { s: 0, v: 0, m: 0, c: 0, g: 0 };
        for (const p of members) {
          const t = (p.psychotype || 'S')[0];
          if (dist[t] !== undefined) dist[t]++;
          if (p.burnout_alert) burnout++;
          sums.s += p.score_s || 0; sums.v += p.score_v || 0; sums.m += p.score_m || 0; sums.c += p.score_c || 0; sums.g += p.score_g || 0;
        }
        report.distribution = dist;
        report.burnoutShare = Math.round((burnout / n) * 100);
        report.avgScores = { S: +(sums.s / n).toFixed(1), V: +(sums.v / n).toFixed(1), M: +(sums.m / n).toFixed(1), C: +(sums.c / n).toFixed(1), G: +(sums.g / n).toFixed(1) };
        report.missingTypes = Object.keys(dist).filter(k => dist[k] === 0);
      }
      return json(report, 200, corsHeaders);
    }

    // ══ PRACTITIONER PORTAL ═══════════════════════════════════════
    // Auth: Supabase-JWT des Coaches. Coach-Zeile wird bei Erstkontakt angelegt (status: pending).
    const getCoach = async () => {
      const chAuth = request.headers.get('Authorization') || '';
      const chJwt = chAuth.replace('Bearer ', '').trim();
      if (!chJwt) return { err: json({ error: 'Nicht authentifiziert' }, 401, corsHeaders) };
      let chEmail, chSub;
      try {
        const parts = chJwt.split('.');
        if (parts.length !== 3) throw 0;
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (!payload.email || payload.role !== 'authenticated') throw 0;
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return { err: json({ error: 'Session abgelaufen' }, 401, corsHeaders) };
        chEmail = payload.email.toLowerCase();
        chSub = payload.sub;
      } catch { return { err: json({ error: 'Token-Fehler' }, 401, corsHeaders) }; }
      const chRows = await supabaseGet(`coaches?email=eq.${encodeURIComponent(chEmail)}&select=id,email,status,credits&limit=1`, env);
      let coach = chRows?.[0];
      if (!coach) {
        coach = await supabasePost('coaches', { user_id: chSub, email: chEmail, status: 'pending', credits: 0 }, env);
        if (!coach) return { err: json({ error: 'Coach-Profil konnte nicht angelegt werden' }, 500, corsHeaders) };
        // Nurture-Hook: Eva benachrichtigen + Willkommensmail (fire-and-forget)
        try {
          await fetch('https://evakolontai.app.n8n.cloud/webhook/nb-practitioner-registered', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: chEmail }),
          });
        } catch (e) { console.error('[Practitioner] Registrierungs-Webhook fehlgeschlagen:', e); }
      }
      if (coach.status === 'blocked') return { err: json({ error: 'Account gesperrt' }, 403, corsHeaders) };
      return { coach };
    };

    // ── /api/coach-me ─────────────────────────────────────────────
    if (pathname === '/api/coach-me') {
      const { coach, err } = await getCoach(); if (err) return err;
      const cmClients = await supabaseGet(`profiles?coach_id=eq.${coach.id}&select=id`, env) || [];
      return json({ email: coach.email, status: coach.status, credits: coach.credits || 0, clients: cmClients.length }, 200, corsHeaders);
    }

    // ── /api/coach-buy-credits → Stripe Checkout (mode=payment) ──
    if (pathname === '/api/coach-buy-credits') {
      const { coach, err } = await getCoach(); if (err) return err;
      if (coach.status !== 'active') return json({ error: 'not_active' }, 403, corsHeaders);
      if (!env.STRIPE_SECRET_KEY) return json({ error: 'Stripe nicht konfiguriert' }, 503, corsHeaders);
      let body; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }
      const PACKAGES = { 10: 99000, 25: 222500, 50: 395000 };  // Cent: 99 € / 89 € / 79 € pro Test
      const crNum = parseInt(body.package);
      if (!PACKAGES[crNum]) return json({ error: 'Unbekanntes Paket' }, 400, corsHeaders);
      const spParams = new URLSearchParams({
        'mode': 'payment',
        'success_url': 'https://neurobusiness.one/practitioner.html?purchase=success',
        'cancel_url': 'https://neurobusiness.one/practitioner.html',
        'customer_email': coach.email,
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': 'eur',
        'line_items[0][price_data][unit_amount]': String(PACKAGES[crNum]),
        'line_items[0][price_data][product_data][name]': `NeuroBusiness™ Practitioner Credits — ${crNum} Diagnostik-Tests`,
        'metadata[type]': 'credits',
        'metadata[coach_id]': coach.id,
        'metadata[credits]': String(crNum),
      });
      const spRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: spParams.toString(),
      });
      const spSession = await spRes.json();
      if (!spRes.ok) { console.error('[Credits] Stripe-Fehler:', JSON.stringify(spSession.error || {})); return json({ error: 'Stripe-Fehler' }, 500, corsHeaders); }
      return json({ url: spSession.url }, 200, corsHeaders);
    }

    // ── /api/coach-invite → 1 Credit abbuchen, Klient einladen ───
    if (pathname === '/api/coach-invite') {
      const { coach, err } = await getCoach(); if (err) return err;
      if (coach.status !== 'active') return json({ error: 'not_active' }, 403, corsHeaders);
      let body; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }
      const clientEmail = (body.clientEmail || '').trim().toLowerCase();
      if (!clientEmail.includes('@') || clientEmail.length < 6) return json({ error: 'Gültige Klienten-E-Mail nötig' }, 400, corsHeaders);
      // 1. Credit atomar abbuchen (NULL = nicht genug)
      const spend = await supabaseRpc('add_coach_credits', { p_coach: coach.id, p_delta: -1 }, env);
      if (spend === null || spend === undefined) return json({ error: 'Kein Credit verfügbar — bitte Paket kaufen.' }, 402, corsHeaders);
      // 2. Klient anlegen + Diagnostik-Mail via n8n (bestehender Admin-Workflow)
      let inviteOk = false, inviteMsg = '';
      try {
        const nRes = await fetch('https://evakolontai.app.n8n.cloud/webhook/nb-admin-create-user', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: clientEmail, first_name: body.firstName || '', lang: body.lang || 'de', validity: '60', send_email: true, product: 'diagnostic', source: 'practitioner' })
        });
        const nJson = await nRes.json().catch(() => ({}));
        inviteOk = nRes.ok && nJson.ok !== false && nJson.success !== false;
        inviteMsg = nJson.message || '';
      } catch (e) { inviteMsg = 'n8n nicht erreichbar'; }
      if (!inviteOk) {
        await supabaseRpc('add_coach_credits', { p_coach: coach.id, p_delta: 1 }, env);  // Credit zurückgeben
        return json({ error: inviteMsg || 'Einladung fehlgeschlagen — Credit wurde zurückgebucht.' }, 500, corsHeaders);
      }
      // 3. Klient dem Coach zuordnen + Transaktion loggen
      await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(clientEmail)}`, {
        method: 'PATCH',
        headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ coach_id: coach.id }),
      }).catch(console.error);
      supabasePost('credit_transactions', { coach_id: coach.id, delta: -1, reason: 'invite:' + clientEmail }, env);
      return json({ ok: true, creditsLeft: spend }, 200, corsHeaders);
    }

    // ── /api/coach-clients → Klienten-Liste mit Report-Links ─────
    if (pathname === '/api/coach-clients') {
      const { coach, err } = await getCoach(); if (err) return err;
      const ccProfiles = await supabaseGet(`profiles?coach_id=eq.${coach.id}&select=id,email,first_name,psychotype,secondary_psychotype,burnout_alert,diagnostic_completed_at&order=diagnostic_completed_at.desc.nullslast&limit=200`, env) || [];
      const ccClients = [];
      for (const p of ccProfiles) {
        let reportUrl = null;
        if (p.diagnostic_completed_at) {
          const tk = await supabaseGet(`access_tokens?user_id=eq.${p.id}&select=token,expires_at&order=expires_at.desc&limit=1`, env);
          if (tk?.[0]) reportUrl = `https://neurobusiness.one/result_v2.html?token=${encodeURIComponent(tk[0].token)}`;
        }
        ccClients.push({ email: p.email, firstName: p.first_name, psychotype: p.psychotype, secondary: p.secondary_psychotype, burnout: !!p.burnout_alert, completedAt: p.diagnostic_completed_at, reportUrl });
      }
      return json({ clients: ccClients }, 200, corsHeaders);
    }

    // ══ SALES COCKPIT (Admin, x-admin-key) ════════════════════════
    if (pathname === '/api/sales-prospects' || pathname === '/api/sales-generate') {
      if (!env.ADMIN_KEY) return json({ error: 'ADMIN_KEY not configured' }, 503, corsHeaders);
      if ((request.headers.get('x-admin-key') || '') !== env.ADMIN_KEY) return json({ error: 'Unauthorized' }, 401, corsHeaders);
      let spBody; try { spBody = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }

      if (pathname === '/api/sales-prospects') {
        const spAction = spBody.action;
        if (spAction === 'list') {
          const spRows = await supabaseGet(`sales_prospects?select=*&order=updated_at.desc&limit=300`, env) || [];
          return json({ prospects: spRows }, 200, corsHeaders);
        }
        if (spAction === 'create') {
          if (!spBody.name) return json({ error: 'name required' }, 400, corsHeaders);
          const spRow = await supabasePost('sales_prospects', {
            name: String(spBody.name).slice(0, 120),
            linkedin_url: spBody.linkedin_url || null,
            role: spBody.role || null,
            company: spBody.company || null,
            type_guess: spBody.type_guess || null,
            target: spBody.target || 'practitioner',
            notes: spBody.notes || null,
            status: 'neu',
          }, env);
          return json({ prospect: spRow }, 200, corsHeaders);
        }
        if (spAction === 'update' && spBody.id) {
          const spPatch = { updated_at: new Date().toISOString() };
          for (const k of ['status', 'notes', 'next_action_at', 'type_guess', 'target']) {
            if (spBody[k] !== undefined) spPatch[k] = spBody[k];
          }
          await fetch(`${env.SUPABASE_URL}/rest/v1/sales_prospects?id=eq.${encodeURIComponent(spBody.id)}`, {
            method: 'PATCH',
            headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            body: JSON.stringify(spPatch),
          });
          return json({ ok: true }, 200, corsHeaders);
        }
        return json({ error: 'Unknown action' }, 400, corsHeaders);
      }

      // /api/sales-generate — personalisierte Outreach-Nachrichten via Claude
      const genRows = await supabaseGet(`sales_prospects?id=eq.${encodeURIComponent(spBody.id || '')}&select=*`, env);
      const pr = genRows?.[0];
      if (!pr) return json({ error: 'Prospect nicht gefunden' }, 404, corsHeaders);

      const salesSystem = `Du bist Eva Kolontai, Diplom-Psychologin mit 20+ Jahren Erfahrung, Gründerin von NeuroBusiness™ (neurobusiness.one) — einem neuropsychologischen Diagnostik-System mit 5 Psychotypen (Stratege, Visionär, Builder, Connector, Hochleister) und 5 Dimensionen.

Du schreibst LinkedIn-Outreach in Evas Stimme: warm, direkt, psychologisch fundiert, nie marktschreierisch, per Du. Kurze Sätze. Keine Emojis. Keine Floskeln wie "Ich hoffe, es geht dir gut".

Angebote je nach Ziel:
- practitioner: Certified-Practitioner-Programm — Diagnostik-Lizenz für Coaches, Credits ab 79 €/Test, Klient zahlt marktüblich 147 €+. Einstieg: Portal-Registrierung (neurobusiness.one/coaches.html) oder 15-Min-Call (zeeg.me/evak/15min).
- team: Team Intelligence — Team-Diagnostik 300 €/Test, aggregiertes Team-Dashboard (Typ-Verteilung, Burnout-Signale, Lücken). Demo: neurobusiness.one/team-dashboard.html?demo=1
- core: Core Program 4.990 € — 12 Wochen 1:1 Business-Transformation auf Basis der Diagnostik.

Stil-Referenz (Evas bestehende Templates, Psychotyp-Hook je nach Profil des Prospects):
"Ich sehe in Deinem Profil einen sehr analytischen Ansatz — das deckt sich mit dem, was ich als Neuropsychologin als Strategen-Profil bezeichne..." (Typ S)
"Dein Content hat mich sofort angesprochen — Du denkst in Möglichkeiten, nicht in Grenzen..." (Typ V)
"Direkt: Ich entwickle ein neuropsychologisches Diagnostik-Tool für Coaches..." (Typ M/Builder)

Antworte AUSSCHLIESSLICH mit validem JSON, ohne Markdown:
{"connectionNote": "max 280 Zeichen, persönlich, kein Pitch", "dm": "Erste DM nach Connect (Tag 2), max 700 Zeichen, mit Psychotyp-Hook und einer konkreten Frage", "followUp": "Follow-up (Tag 4) falls keine Antwort, max 400 Zeichen, Angebot Klarheitsgespräch/Demo-Link, kein Druck"}`;

      const salesUser = `Prospect: ${pr.name}${pr.role ? ' · ' + pr.role : ''}${pr.company ? ' · ' + pr.company : ''}
Ziel: ${pr.target || 'practitioner'}
Vermuteter Psychotyp: ${pr.type_guess || 'unbekannt — neutral formulieren'}
Notizen von Eva: ${pr.notes || '—'}

Erstelle die drei Nachrichten als JSON.`;

      let genText;
      try { genText = await callClaude([{ role: 'user', content: salesUser }], salesSystem, env); }
      catch (e) { return json({ error: 'AI-Fehler: ' + e.message }, 500, corsHeaders); }
      let genMsgs;
      try { genMsgs = JSON.parse(genText.replace(/^```json?\s*|\s*```$/g, '')); }
      catch { genMsgs = { connectionNote: genText, dm: '', followUp: '' }; }

      await fetch(`${env.SUPABASE_URL}/rest/v1/sales_prospects?id=eq.${encodeURIComponent(pr.id)}`, {
        method: 'PATCH',
        headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ generated_messages: genMsgs, updated_at: new Date().toISOString() }),
      }).catch(console.error);
      return json({ messages: genMsgs }, 200, corsHeaders);
    }

    // ── TOKEN-VALIDIERUNG (für /api/ai) ───────────────────────────
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '').trim();

    if (!token) {
      return json({ error: 'No token provided' }, 401, corsHeaders);
    }

    const profile = await validateTokenAndGetProfile(token, env);
    if (!profile) {
      return json({ error: 'Invalid or expired token' }, 401, corsHeaders);
    }

    // ── REQUEST BODY ──────────────────────────────────────────────
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400, corsHeaders);
    }

    const { messages, mode = 'chat', conversationId } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return json({ error: 'No messages provided' }, 400, corsHeaders);
    }

    // ── BUSINESS PROFILE + CONTEXT LADEN ─────────────────────────
    const [businessProfile, recentCheckins, recentTasks] = await Promise.all([
      getBusinessProfile(profile.id, env),
      getRecentCheckins(profile.id, env),
      getRecentTasks(profile.id, env),
    ]);

    // ── SYSTEM PROMPT BAUEN ───────────────────────────────────────
    const systemPrompt = buildSystemPrompt(profile, businessProfile, recentCheckins, recentTasks, mode);

    // ── CONVERSATION ANLEGEN / FINDEN ─────────────────────────────
    const convId = conversationId || await createConversation(profile.id, mode, env);

    // ── CLAUDE API CALL ───────────────────────────────────────────
    let aiReply;
    try {
      aiReply = await callClaude(messages, systemPrompt, env);
    } catch (err) {
      console.error('Claude API error:', err);
      return json({ error: 'AI service unavailable. Please try again.' }, 502, corsHeaders);
    }

    // ── SPEICHERN (fire-and-forget) ───────────────────────────────
    const userMsg = messages[messages.length - 1];
    saveMessages(convId, profile.id, userMsg?.content || '', aiReply, env).catch(console.error);

    // Empfehlung speichern wenn sinnvoll (Modi: agenda, pricing, offer, visibility, decision, burnout)
    const saveModes = ['agenda', 'pricing', 'offer', 'visibility', 'decision', 'burnout', 'client'];
    if (saveModes.includes(mode)) {
      saveRecommendation(profile.id, mode, aiReply, profile.psychotype, convId, env).catch(console.error);
    }

    // ── ANTWORT ───────────────────────────────────────────────────
    return json({
      reply: aiReply,
      conversationId: convId,
    }, 200, corsHeaders);
  }
};

// ═══════════════════════════════════════════════════════════════
// SUPABASE HELPERS
// ═══════════════════════════════════════════════════════════════

async function supabaseGet(path, env) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

async function supabasePost(path, body, env) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.[0] || data;
}

async function supabaseRpc(fn, args, env) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) return null;
  return res.json();
}

async function validateTokenAndGetProfile(token, env) {
  const tokenData = await supabaseGet(
    `access_tokens?token=eq.${encodeURIComponent(token)}&select=user_id,expires_at`,
    env
  );
  const row = tokenData?.[0];
  if (!row || new Date(row.expires_at) < new Date()) return null;

  const profileData = await supabaseGet(
    `profiles?id=eq.${row.user_id}&select=*`,
    env
  );
  return profileData?.[0] || null;
}

async function getBusinessProfile(userId, env) {
  const data = await supabaseGet(
    `business_profiles?user_id=eq.${userId}&select=*&limit=1`,
    env
  );
  return data?.[0] || null;
}

async function getRecentCheckins(userId, env) {
  const data = await supabaseGet(
    `checkins?user_id=eq.${userId}&select=energy_level,stress_level,note,created_at&order=created_at.desc&limit=7`,
    env
  );
  return data || [];
}

async function getRecentTasks(userId, env) {
  const data = await supabaseGet(
    `tasks?user_id=eq.${userId}&select=task_text,status,due_date&order=created_at.desc&limit=10`,
    env
  );
  return data || [];
}

async function createConversation(userId, topic, env) {
  const result = await supabasePost('conversations', { user_id: userId, topic }, env);
  return result?.id || null;
}

async function saveMessages(convId, userId, userContent, aiContent, env) {
  if (!convId) return;
  await supabasePost('messages', {
    conversation_id: convId, user_id: userId, role: 'user',
    content: userContent.substring(0, 4000),
  }, env);
  await supabasePost('messages', {
    conversation_id: convId, user_id: userId, role: 'assistant',
    content: aiContent.substring(0, 4000),
  }, env);
}

async function saveRecommendation(userId, mode, text, psychotype, convId, env) {
  await supabasePost('recommendations', {
    user_id: userId,
    mode,
    recommendation_text: text.substring(0, 4000),
    psychotype_context: psychotype,
    conversation_id: convId,
    is_actionable: true,
  }, env);
}

// ═══════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════

function buildSystemPrompt(profile, biz, checkins, tasks, mode) {
  const lang = profile.lang || 'de';
  const isEN = lang === 'en';
  const type = profile.psychotype || 'S';
  const name = profile.first_name || (isEN ? 'the user' : 'der Person');

  const typeDescriptions = {
    S: isEN
      ? 'Strategist: analytical, perfectionistic, delays action, under-prices, avoids visibility. Needs permission to act before perfect.'
      : 'Stratege: analytisch, perfektionistisch, verzögert Handlung, unterpreist, meidet Sichtbarkeit. Braucht Erlaubnis zu handeln bevor alles perfekt ist.',
    V: isEN
      ? 'Visionary: creative, idea-rich, unfocused, lacks systems. Needs to choose ONE thing and build structure.'
      : 'Visionär: kreativ, ideenreich, unscharf, fehlt Systeme. Muss EINE Sache wählen und Struktur aufbauen.',
    M: isEN
      ? 'Builder: delivers fast and well, chronically under-prices, cannot stop working. Speed and quality worth 3× market rates.'
      : 'Builder: liefert schnell und gut, unterpreist chronisch, kann nicht aufhören. Geschwindigkeit und Qualität 3× den Marktwert wert.',
    C: isEN
      ? 'Connector: over-gives for free, avoids money conversations, fears boundaries damage relationships. Must monetise natural trust.'
      : 'Connector: gibt zu viel kostenlos, meidet Geldgespräche, fürchtet Grenzen zerstören Beziehungen. Muss natürliches Vertrauen monetarisieren.',
    G: isEN
      ? 'High Performer: highest burnout risk, rationalises exhaustion, cannot stop. Always integrate recovery into advice.'
      : 'Hochleister: höchstes Burnout-Risiko, rationalisiert Erschöpfung, kann nicht aufhören. Immer Regeneration in Ratschläge integrieren.',
  };

  const modeInstructions = {
    chat: isEN
      ? 'Mode: Open sparring. Engage naturally. Ask one clarifying question when needed.'
      : 'Modus: Offenes Sparring. Natürlich engagieren. Eine klärende Frage stellen wenn nötig.',
    agenda: isEN
      ? 'Mode: Weekly Agenda. Output exactly 3 concrete priorities. Each: bold title + 1-2 sentences. No generic advice.'
      : 'Modus: Wochenagenda. Genau 3 konkrete Prioritäten ausgeben. Jede: fette Überschrift + 1-2 Sätze. Kein generischer Ratschlag.',
    pricing: isEN
      ? 'Mode: Pricing Help. Challenge under-pricing directly. Give a concrete price range based on value, not time.'
      : 'Modus: Preishilfe. Unterpreisen direkt herausfordern. Konkreten Preisbereich basierend auf Wert, nicht Zeit, geben.',
    offer: isEN
      ? 'Mode: Offer Builder. Ask 2-3 focused questions to understand the offer, then structure it with a clear name, deliverables, price anchor and positioning.'
      : 'Modus: Angebots-Builder. 2-3 fokussierte Fragen stellen um das Angebot zu verstehen, dann strukturieren mit klarem Namen, Leistungen, Preisanker und Positionierung.',
    visibility: isEN
      ? 'Mode: Visibility Coach. Recommend 1-2 specific visibility actions this week that match this type\'s natural strengths. Not generic content advice.'
      : 'Modus: Sichtbarkeits-Coach. 1-2 spezifische Sichtbarkeitsaktionen diese Woche empfehlen, die zu den natürlichen Stärken dieses Typs passen. Kein generischer Content-Ratschlag.',
    decision: isEN
      ? 'Mode: Decision Support. Use the "if/then" framing: help the user see consequences of each option through the lens of their psychotype. Then give a clear recommendation.'
      : 'Modus: Entscheidungshilfe. "Wenn/dann"-Rahmung nutzen: Nutzer helfen Konsequenzen jeder Option durch die Linse des Psychotyps zu sehen. Dann klare Empfehlung geben.',
    burnout: isEN
      ? 'Mode: Burnout/Overload Reflection. This is sensitive territory. Warm, direct, non-clinical. Acknowledge, validate, then give ONE concrete relief action. Do not overwhelm with lists.'
      : 'Modus: Burnout-/Überlastungsreflexion. Sensibles Territorium. Warm, direkt, nicht klinisch. Anerkennen, validieren, dann EINE konkrete Entlastungsaktion geben. Keine Listen.',
    client: isEN
      ? 'Mode: Client Situation. Help navigate a specific client challenge. Ask for the situation first if not yet clear.'
      : 'Modus: Kundensituation. Helfen eine konkrete Kundenherausforderung zu navigieren. Erst nach der Situation fragen wenn noch unklar.',
  };

  // Context-Abschnitte
  let contextLines = [];

  if (biz) {
    contextLines.push(isEN ? `\nBusiness context:` : `\nBusiness-Kontext:`);
    if (biz.offer_type)               contextLines.push(`  Angebot: ${biz.offer_type}`);
    if (biz.current_business_stage)   contextLines.push(`  Phase: ${biz.current_business_stage}`);
    if (biz.revenue_goal)             contextLines.push(`  Umsatzziel: ${biz.revenue_goal}`);
    if (biz.available_hours_per_week) contextLines.push(`  Verfügbare Stunden/Woche: ${biz.available_hours_per_week}`);
    if (biz.main_problem)             contextLines.push(`  Hauptproblem: ${biz.main_problem}`);
  }

  if (checkins.length > 0) {
    const avgEnergy = (checkins.reduce((s, c) => s + (c.energy_level || 3), 0) / checkins.length).toFixed(1);
    const lastNote  = checkins[0]?.note || '';
    contextLines.push(isEN
      ? `\nEnergy (last 7 days avg): ${avgEnergy}/5${lastNote ? `. Last note: "${lastNote}"` : ''}`
      : `\nEnergie (letzter 7-Tage-Schnitt): ${avgEnergy}/5${lastNote ? `. Letzter Hinweis: "${lastNote}"` : ''}`
    );
  }

  if (tasks.length > 0) {
    const openTasks   = tasks.filter(t => t.status === 'planned');
    const doneTasks   = tasks.filter(t => t.status === 'done');
    if (openTasks.length > 0) {
      contextLines.push(isEN
        ? `\nOpen tasks: ${openTasks.map(t => `"${t.task_text}"`).join(', ')}`
        : `\nOffene Aufgaben: ${openTasks.map(t => `"${t.task_text}"`).join(', ')}`
      );
    }
    if (doneTasks.length > 0) {
      contextLines.push(isEN
        ? `Recent completions: ${doneTasks.slice(0, 3).map(t => `"${t.task_text}"`).join(', ')}`
        : `Zuletzt erledigt: ${doneTasks.slice(0, 3).map(t => `"${t.task_text}"`).join(', ')}`
      );
    }
  }

  if (profile.burnout_alert) {
    contextLines.push(isEN
      ? `\n⚠ IMPORTANT: This user showed elevated burnout markers in their diagnostic. Monitor for overload and always integrate recovery.`
      : `\n⚠ WICHTIG: Dieser Nutzer zeigte erhöhte Burnout-Marker in der Diagnostik. Auf Überlastung achten und immer Regeneration einbeziehen.`
    );
  }

  const contextBlock = contextLines.join('\n');

  return isEN
    ? `You are NeuroBusiness™ AI — a strategic business companion and psychological sparring partner created by Eva Kolontai, Diplom-Psychologin with 20+ years of experience.

You are NOT a therapist, NOT a medical advisor, NOT a generic chatbot.
You ARE a psychologically informed business coach — warm, direct, and deeply calibrated to each person's psychotype.

You are speaking with ${name}. Their NeuroBusiness™ Psychotype: **${type}**
Scores — S:${profile.score_s||0} V:${profile.score_v||0} M:${profile.score_m||0} C:${profile.score_c||0} G:${profile.score_g||0}

Psychotype profile: ${typeDescriptions[type] || typeDescriptions.S}
${contextBlock}

Your rules:
1. Always answer through the lens of the ${type} psychotype — but don't mention the type in every message
2. Be concrete. Give 1-2 best options, not 10 possibilities
3. No padding. No "Great question!" No generic motivational phrases
4. Short paragraphs. Natural conversation. Bullet points only when genuinely useful
5. Ask ONE clarifying question when you need information — never five
6. When the user is clearly overloaded or shows burnout signals: acknowledge first, advise second
7. Every answer should connect to either revenue, positioning, offer, or wellbeing
8. You remember the full conversation. Reference earlier points naturally.
9. Language: English

Current mode: ${modeInstructions[mode] || modeInstructions.chat}`

    : `Du bist NeuroBusiness™ AI — strategischer Business-Begleiter und psychologischer Sparringspartner, entwickelt von Eva Kolontai, Diplom-Psychologin mit 20+ Jahren Erfahrung.

Du bist KEIN Therapeut, KEIN medizinischer Berater, KEIN generischer Chatbot.
Du BIST ein psychologisch informierter Business-Coach — warm, direkt und tief auf den Psychotypen jeder Person kalibriert.

Du sprichst mit ${name}. Ihr/sein NeuroBusiness™ Psychotyp: **${type}**
Scores — S:${profile.score_s||0} V:${profile.score_v||0} M:${profile.score_m||0} C:${profile.score_c||0} G:${profile.score_g||0}

Psychotyp-Profil: ${typeDescriptions[type] || typeDescriptions.S}
${contextBlock}

Deine Regeln:
1. Immer durch die Linse des ${type}-Psychotyps antworten — aber den Typ nicht in jeder Nachricht erwähnen
2. Konkret sein. 1-2 beste Optionen geben, nicht 10 Möglichkeiten
3. Kein Fülltext. Kein "Tolle Frage!" Keine generischen Motivationsphrasen
4. Kurze Absätze. Natürliche Konversation. Aufzählungen nur wenn wirklich nützlich
5. EINE klärende Frage stellen wenn Informationen fehlen — niemals fünf
6. Wenn der Nutzer klar überlastet ist oder Burnout-Signale zeigt: erst anerkennen, dann beraten
7. Jede Antwort sollte sich auf Umsatz, Positionierung, Angebot oder Wohlbefinden beziehen
8. Du erinnerst dich an den gesamten Gesprächskontext. Frühere Punkte natürlich einbeziehen.
9. Sprache: Deutsch

Aktueller Modus: ${modeInstructions[mode] || modeInstructions.chat}`;
}

// ═══════════════════════════════════════════════════════════════
// CLAUDE API
// ═══════════════════════════════════════════════════════════════

async function callClaude(messages, systemPrompt, env) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages.slice(-20),  // max. 20 Nachrichten Kontext
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text || '';
}

// ═══════════════════════════════════════════════════════════════
// STRIPE WEBHOOK HANDLER
// ═══════════════════════════════════════════════════════════════

async function handleStripeWebhook(request, env) {
  // 1. Rohen Body als Text lesen (für Signaturprüfung zwingend)
  let rawBody;
  try {
    rawBody = await request.text();
  } catch (err) {
    console.error('[Stripe] Body lesen fehlgeschlagen:', err);
    return new Response('Bad Request', { status: 400 });
  }

  // 2. Stripe-Signatur verifizieren (Web Crypto — kein SDK nötig)
  const sigHeader = request.headers.get('stripe-signature') || '';
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET; // ← Cloudflare Env Variable

  if (!webhookSecret) {
    console.error('[Stripe] STRIPE_WEBHOOK_SECRET fehlt in Env-Variablen');
    return new Response('Server misconfigured', { status: 500 });
  }

  const isValid = await verifyStripeSignature(rawBody, sigHeader, webhookSecret);
  if (!isValid) {
    console.warn('[Stripe] Ungültige Signatur — Request verworfen');
    return new Response('Invalid signature', { status: 400 });
  }

  // 3. Event parsen
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (err) {
    console.error('[Stripe] JSON-Parse-Fehler:', err);
    return new Response('Invalid JSON', { status: 400 });
  }

  console.log(`[Stripe] Event empfangen: ${event.type} (${event.id})`);

  // 4. Events verarbeiten
  try {
    switch (event.type) {

      // ── Neues Abo nach erfolgreichem Checkout ──────────────────
      case 'checkout.session.completed': {
        const session = event.data.object;

        // ── Practitioner Credit-Kauf (mode=payment) ────────────────
        if (session.metadata?.type === 'credits') {
          const crCoach = session.metadata.coach_id;
          const crNum = parseInt(session.metadata.credits) || 0;
          if (crCoach && crNum > 0) {
            const crBal = await supabaseRpc('add_coach_credits', { p_coach: crCoach, p_delta: crNum }, env);
            await supabasePost('credit_transactions', { coach_id: crCoach, delta: crNum, reason: 'purchase', stripe_session: session.id }, env);
            console.log(`[Credits] +${crNum} für Coach ${crCoach} (neuer Saldo: ${crBal})`);
          }
          break;
        }

        if (session.mode !== 'subscription' || !session.subscription) break;

        // Vollständiges Subscription-Objekt von Stripe holen
        const sub = await fetchStripeSubscription(session.subscription, env);
        if (!sub) { console.error('[Stripe] Sub nicht geladen:', session.subscription); break; }

        // Metadata: profile_id + coach_id kommen aus session.metadata
        // (du übergibst sie beim Erstellen der Checkout-Session)
        const meta = session.metadata || {};

        await upsertSubscription({
          stripe_subscription_id: sub.id,
          stripe_customer_id:     typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
          client_email:           session.customer_email || session.customer_details?.email || null,
          profile_id:             meta.profile_id || null,
          coach_id:               meta.coach_id   || null,
          status:                 sub.status,
          current_period_end:     new Date(sub.current_period_end * 1000).toISOString(),
        }, env);

        console.log(`[Stripe] checkout.session.completed — Sub ${sub.id} angelegt (${sub.status})`);
        break;
      }

      // ── Abo geändert (Verlängerung, Status-Wechsel, etc.) ──────
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const meta = sub.metadata || {};

        await upsertSubscription({
          stripe_subscription_id: sub.id,
          stripe_customer_id:     typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
          profile_id:             meta.profile_id || null,
          coach_id:               meta.coach_id   || null,
          status:                 sub.status,
          current_period_end:     new Date(sub.current_period_end * 1000).toISOString(),
        }, env);

        console.log(`[Stripe] subscription.updated — Sub ${sub.id} → ${sub.status}`);
        break;
      }

      // ── Abo gekündigt ──────────────────────────────────────────
      case 'customer.subscription.deleted': {
        const sub = event.data.object;

        await upsertSubscription({
          stripe_subscription_id: sub.id,
          stripe_customer_id:     typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
          status:                 'canceled',
          current_period_end:     new Date(sub.current_period_end * 1000).toISOString(),
        }, env);

        console.log(`[Stripe] subscription.deleted — Sub ${sub.id} auf canceled gesetzt`);
        break;
      }

      // ── Zahlung fehlgeschlagen ─────────────────────────────────
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        if (!invoice.subscription) break;

        await upsertSubscription({
          stripe_subscription_id: invoice.subscription,
          stripe_customer_id:     typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id,
          status:                 'past_due',
        }, env);

        console.log(`[Stripe] invoice.payment_failed — Sub ${invoice.subscription} auf past_due gesetzt`);
        break;
      }

      default:
        console.log(`[Stripe] Event ${event.type} ignoriert (kein Handler)`);
    }
  } catch (err) {
    console.error(`[Stripe] Fehler beim Verarbeiten von ${event.type}:`, err);
    // Wir geben trotzdem 200 zurück — Stripe soll nicht unendlich retrien
    // bei Logik-Fehlern. Nur bei Signatur-Problemen geben wir 400.
    return new Response(JSON.stringify({ received: true, warning: err.message }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Stripe-Signatur verifizieren (HMAC-SHA256, Web Crypto) ────────────────
async function verifyStripeSignature(rawBody, sigHeader, secret) {
  try {
    // Header parsen: "t=...,v1=..."
    const parts = {};
    for (const part of sigHeader.split(',')) {
      const idx = part.indexOf('=');
      if (idx > 0) parts[part.slice(0, idx)] = part.slice(idx + 1);
    }

    const timestamp = parts.t;
    const signature = parts.v1;
    if (!timestamp || !signature) return false;

    // Timestamp-Check: max. 5 Minuten Toleranz (Replay-Schutz)
    if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > 300) {
      console.warn('[Stripe] Signatur-Timestamp zu alt');
      return false;
    }

    // HMAC-SHA256 berechnen
    const signedPayload = `${timestamp}.${rawBody}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sigBytes = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(signedPayload)
    );

    // Hex-String bilden
    const expected = Array.from(new Uint8Array(sigBytes))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Timing-sicherer Vergleich
    return timingSafeEqual(expected, signature);
  } catch (err) {
    console.error('[Stripe] Signaturprüfung Fehler:', err);
    return false;
  }
}

// Timing-sicherer String-Vergleich (verhindert Timing-Angriffe)
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ── Stripe Subscription-Objekt abrufen ────────────────────────────────────
async function fetchStripeSubscription(subscriptionId, env) {
  // STRIPE_SECRET_KEY → Cloudflare Env Variable (niemals im Code!)
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
    headers: {
      'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
    },
  });
  if (!res.ok) {
    console.error(`[Stripe] Subscription ${subscriptionId} abruf fehlgeschlagen: ${res.status}`);
    return null;
  }
  return res.json();
}

// ── Supabase Upsert (INSERT OR UPDATE via stripe_subscription_id) ─────────
async function upsertSubscription(data, env) {
  // Felder mit undefined rausfiltern (partial updates bei invoice.payment_failed)
  const payload = Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== undefined)
  );
  payload.updated_at = new Date().toISOString();

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/subscriptions`, {
    method: 'POST',
    headers: {
      // SUPABASE_SERVICE_KEY → Cloudflare Env Variable (niemals im Frontend!)
      'apikey':        env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type':  'application/json',
      // Upsert: bei Konflikt auf stripe_subscription_id → Update
      'Prefer':        'resolution=merge-duplicates',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Supabase upsert fehlgeschlagen (${res.status}): ${errText}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// STRIPE CHECKOUT SESSION ERSTELLEN
// ═══════════════════════════════════════════════════════════════

async function handleCreateCheckout(request, env, corsHeaders) {
    try {
        if (!env.STRIPE_SECRET_KEY) {
              console.error('[Checkout] STRIPE_SECRET_KEY fehlt als Worker-Secret');
                    return json({ error: 'Checkout nicht konfiguriert — bitte STRIPE_SECRET_KEY als Worker-Secret setzen' }, 503, corsHeaders);
                        }
  // 1. Auth: Supabase JWT aus Authorization-Header
  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace('Bearer ', '').trim();
  if (!jwt) return json({ error: 'Nicht authentifiziert' }, 401, corsHeaders);

      // 2. JWT lokal dekodieren (kein API-Aufruf nötig)
          let userEmail, userId;
              try {
                    const parts = jwt.split('.');
                          if (parts.length !== 3) return json({ error: 'Ungültiges Token' }, 401, corsHeaders);
                                const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
                                      if (!payload.email || payload.role !== 'authenticated') {
                                              return json({ error: 'Nicht authentifiziert' }, 401, corsHeaders);
                                                    }
                                                          if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
                                                                  return json({ error: 'Session abgelaufen' }, 401, corsHeaders);
                                                                        }
                                                                              userEmail = payload.email;
                                                                                    userId = payload.sub;
                                                                                        } catch (e) {
                                                                                              return json({ error: 'Token-Fehler' }, 401, corsHeaders);
                                                                                                  }
                                                                                                      const user = { email: userEmail, id: userId };

  // 3. Coach aus coaches-Tabelle laden (über email)
  const coachRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/coaches?email=eq.${encodeURIComponent(user.email)}&select=id,status&limit=1`,
    {
      headers: {
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
    }
  );
  const coaches = await coachRes.json();
  if (!coaches?.length) return json({ error: 'Kein Coach-Profil gefunden' }, 403, corsHeaders);

  const coach = coaches[0];
  if (coach.status === 'blocked') return json({ error: 'Account gesperrt' }, 403, corsHeaders);

  // 4. Optional: client_email aus Request-Body
  let body = {};
  try { body = await request.json(); } catch { /* leer ist ok */ }
  const { client_email } = body;

  // 5. Stripe Checkout Session erstellen
  const PRICE_ID = 'price_1TdCjjRpVrML8PN3Jkj5iNPh';

  const params = new URLSearchParams({
    'mode':                                    'subscription',
    'success_url':                             'https://neurobusiness.one/checkout-success.html?session_id={CHECKOUT_SESSION_ID}',
    'cancel_url':                              'https://neurobusiness.one/coach-login.html',
    'line_items[0][price]':                    PRICE_ID,
    'line_items[0][quantity]':                 '1',
    // coach_id in beiden Metadata-Feldern (session + subscription)
    'metadata[coach_id]':                      coach.id,
    'subscription_data[metadata][coach_id]':   coach.id,
  });

  if (client_email) {
    params.set('customer_email',                              client_email);
    params.set('metadata[client_email]',                      client_email);
    params.set('subscription_data[metadata][client_email]',   client_email);
  }

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization':  `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type':   'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!stripeRes.ok) {
    const err = await stripeRes.text();
    console.error('[Checkout] Stripe Fehler:', err);
    return json({ error: 'Checkout-Erstellung fehlgeschlagen', detail: err }, 500, corsHeaders);
  }

  const session = await stripeRes.json();
  console.log(`[Checkout] Session ${session.id} für Coach ${coach.id} erstellt`);
  return json({ url: session.url, session_id: session.id }, 200, corsHeaders);} catch (err) {
  console.error('[Checkout] Unerwarteter Fehler:', err.message || err);
    return json({ error: 'Interner Checkout-Fehler', detail: err.message }, 500, corsHeaders);
    }
    }

// ═══════════════════════════════════════════════════════════════
// UTILITY
// ═══════════════════════════════════════════════════════════════

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}
