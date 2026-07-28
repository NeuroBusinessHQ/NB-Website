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
  async scheduled(event, env, ctx) {
    const cron = event?.cron || '';
    ctx.waitUntil(runResearchReminderSweep(env, {
      source: `cron:${cron || 'scheduled'}`,
    }).catch(console.error));
    if (cron === '0 7 * * MON') {
      ctx.waitUntil(runSalesWeeklySprint(env, {
        weeklyLimit: parseInt(env.LINKEDIN_WEEKLY_LIMIT || '15', 10),
        minScore: parseInt(env.SALES_MIN_SCORE || '58', 10),
        generate: false,
        source: 'weekly-cron',
      }).catch(console.error));
    }
  },

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

    // ── /api/research-reminders ──────────────────────────────────
    // Admin-Trigger für 7-Tage Start-Reminder und 14-Tage Retest-Reminder.
    if (pathname === '/api/research-reminders') {
      if (!env.ADMIN_KEY) return json({ error: 'ADMIN_KEY not configured' }, 503, corsHeaders);
      if ((request.headers.get('x-admin-key') || '') !== env.ADMIN_KEY) return json({ error: 'Unauthorized' }, 401, corsHeaders);
      let body; try { body = await request.json(); } catch { body = {}; }
      const result = await runResearchReminderSweep(env, {
        ...body,
        source: 'admin-api',
      });
      return json(result, 200, corsHeaders);
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
        lang: lang === 'en' ? 'en' : 'de',
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

      // ── Legacy-Topf: anonyme Forschungsdaten für ältere Exporte ─────
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

      // ── NBIF-Validierungs-Topf: bei Einwilligung mit Kundenprofil verknuepft ──
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
            profile_id: row.user_id,
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

      const safeLang = lang === 'en' ? 'en' : 'de';
      const appUrl = `https://neurobusiness.one/app?token=${encodeURIComponent(token)}&lang=${safeLang}`;
      fetch('https://evakolontai.app.n8n.cloud/webhook/nb-magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, token, appUrl, name: userData.first_name || '', lang: safeLang, language: safeLang }),
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
      const ccProfiles = await supabaseGet(`profiles?coach_id=eq.${coach.id}&select=id,email,first_name,lang,psychotype,secondary_psychotype,burnout_alert,diagnostic_completed_at&order=diagnostic_completed_at.desc.nullslast&limit=200`, env) || [];
      const ccClients = [];
      for (const p of ccProfiles) {
        let reportUrl = null;
        if (p.diagnostic_completed_at) {
          const tk = await supabaseGet(`access_tokens?user_id=eq.${p.id}&select=token,expires_at&order=expires_at.desc&limit=1`, env);
          const reportFile = p.lang === 'en' ? 'result_v2_en.html' : 'result_v2.html';
          if (tk?.[0]) reportUrl = `https://neurobusiness.one/${reportFile}?token=${encodeURIComponent(tk[0].token)}`;
        }
        ccClients.push({ email: p.email, firstName: p.first_name, lang: p.lang === 'en' ? 'en' : 'de', psychotype: p.psychotype, secondary: p.secondary_psychotype, burnout: !!p.burnout_alert, completedAt: p.diagnostic_completed_at, reportUrl });
      }
      return json({ clients: ccClients }, 200, corsHeaders);
    }

    // ══ SALES AGENTS + AIRTABLE SYNC (Admin, x-admin-key) ═════════
    if (pathname === '/api/sales-score' || pathname === '/api/sales-airtable-pull' || pathname === '/api/sales-airtable-push' || pathname === '/api/sales-airtable-setup' || pathname === '/api/sales-airtable-create' || pathname === '/api/sales-weekly-sprint') {
      if (!env.ADMIN_KEY) return json({ error: 'ADMIN_KEY not configured' }, 503, corsHeaders);
      if ((request.headers.get('x-admin-key') || '') !== env.ADMIN_KEY) return json({ error: 'Unauthorized' }, 401, corsHeaders);
      let body; try { body = await request.json(); } catch { body = {}; }

      try {
        if (pathname === '/api/sales-score') {
          const lead = normalizeSalesLead(body.lead || body);
          return json({ lead, score: scoreSalesLead(lead) }, 200, corsHeaders);
        }

        if (pathname === '/api/sales-airtable-setup') {
          const result = await ensureAirtableSalesFields(env, body);
          return json(result, 200, corsHeaders);
        }

        if (pathname === '/api/sales-airtable-create') {
          const result = await createAirtableSalesLeads(env, body);
          return json(result, 200, corsHeaders);
        }

        if (pathname === '/api/sales-weekly-sprint') {
          const result = await runSalesWeeklySprint(env, body);
          return json(result, 200, corsHeaders);
        }

        if (pathname === '/api/sales-airtable-pull') {
          const records = Array.isArray(body.records)
            ? body.records
            : await fetchAirtableRecords(env, body);
          const imported = [];
          for (const record of records || []) {
            const lead = normalizeSalesLead(record);
            if (!lead.name) continue;
            const score = scoreSalesLead(lead);
            const row = await upsertSalesProspect({ ...lead, ...score }, env);
            if (body.generate === true && row?.id) {
              try {
                const messages = await generateSalesMessages(row, env);
                await patchSalesProspect(row.id, { generated_messages: messages }, env);
                let airtable_push = null;
                if (lead.airtable_id && body.push !== false) {
                  airtable_push = await updateAirtableRecord(lead.airtable_id, { generated_messages: messages, status: row.status || lead.status, score }, env, body);
                }
                imported.push({ id: row.id, airtable_id: lead.airtable_id, name: lead.name, score, messages, airtable_push });
              } catch (e) {
                imported.push({ id: row?.id || null, airtable_id: lead.airtable_id, name: lead.name, score, error: e.message });
              }
            } else {
              imported.push({ id: row?.id || null, airtable_id: lead.airtable_id, name: lead.name, score });
            }
          }
          return json({ ok: true, imported }, 200, corsHeaders);
        }

        if (pathname === '/api/sales-airtable-push') {
          const prospects = body.id
            ? await supabaseGet(`sales_prospects?id=eq.${encodeURIComponent(body.id)}&select=*`, env)
            : await supabaseGet(`sales_prospects?airtable_id=not.is.null&select=*&order=updated_at.desc&limit=${Math.min(parseInt(body.limit) || 50, 200)}`, env);
          const pushed = [];
          for (const p of prospects || []) {
            if (!p.airtable_id) continue;
            const score = {
              fit_score: p.fit_score,
              fit_segment: p.fit_segment,
              fit_reason: p.fit_reason,
              next_action: p.next_action,
            };
            const result = await updateAirtableRecord(p.airtable_id, { generated_messages: p.generated_messages, status: p.status, score }, env, body);
            pushed.push({ id: p.id, airtable_id: p.airtable_id, ok: result.ok });
          }
          return json({ ok: true, pushed }, 200, corsHeaders);
        }
      } catch (e) {
        return json({ ok: false, error: e.message }, 502, corsHeaders);
      }
    }

    // ══ SALES COCKPIT (Admin, x-admin-key) ════════════════════════
    if (pathname === '/api/sales-prospects' || pathname === '/api/sales-generate' || pathname === '/api/sales-generate-direct' || pathname === '/api/sales-agent-run') {
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
          const lead = normalizeSalesLead(spBody);
          const score = scoreSalesLead(lead);
          const spRow = await safeCreateSalesProspect({
            name: lead.name,
            linkedin_url: lead.linkedin_url,
            role: lead.role,
            company: lead.company,
            type_guess: lead.type_guess,
            target: lead.target || score.suggested_target || 'practitioner',
            notes: lead.notes,
            status: 'neu',
            source: lead.source || 'admin',
            airtable_id: lead.airtable_id || null,
            fit_score: score.fit_score,
            fit_segment: score.fit_segment,
            fit_reason: score.fit_reason,
            next_action: score.next_action,
          }, env);
          return json({ prospect: spRow }, 200, corsHeaders);
        }
        if (spAction === 'update' && spBody.id) {
          const spPatch = { updated_at: new Date().toISOString() };
          for (const k of ['status', 'notes', 'next_action_at', 'next_action', 'type_guess', 'target', 'last_outreach_at', 'last_reply_at']) {
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

      // /api/sales-agent-run — Phase 3: Research, Scoring, Account Brief.
      // Kein Versand. Ergebnisse werden am Prospect + in sales_agent_runs gespeichert.
      if (pathname === '/api/sales-agent-run') {
        const prospectId = spBody.id || spBody.prospect_id;
        const agent = spBody.agent || 'phase3_all';
        if (!prospectId) return json({ error: 'id required' }, 400, corsHeaders);
        if (!['research', 'score', 'brief', 'phase3_all'].includes(agent)) {
          return json({ error: 'Unknown agent' }, 400, corsHeaders);
        }
        const rows = await supabaseGet(`sales_prospects?id=eq.${encodeURIComponent(prospectId)}&select=*`, env);
        const prospect = rows?.[0];
        if (!prospect) return json({ error: 'Prospect nicht gefunden' }, 404, corsHeaders);
        const result = await runSalesPhase3Agents(prospect, agent, env, {
          sandbox: spBody.sandbox === true || env.REVENUE_SANDBOX === '1',
        });
        return json(result, 200, corsHeaders);
      }

      // /api/sales-generate — personalisierte Outreach-Nachrichten via Claude
      // Variante -direct: stateless (für Airtable-Automation) — Prospect-Daten direkt im Body
      let pr;
      if (pathname === '/api/sales-generate-direct') {
        if (!spBody.name) return json({ error: 'name required' }, 400, corsHeaders);
        pr = { name: spBody.name, role: spBody.role || null, company: spBody.company || null, target: spBody.target || 'practitioner', type_guess: spBody.type_guess || null, notes: spBody.notes || null };
      } else {
        const genRows = await supabaseGet(`sales_prospects?id=eq.${encodeURIComponent(spBody.id || '')}&select=*`, env);
        pr = genRows?.[0];
        if (!pr) return json({ error: 'Prospect nicht gefunden' }, 404, corsHeaders);
      }

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

      if (pr.id) {
        await fetch(`${env.SUPABASE_URL}/rest/v1/sales_prospects?id=eq.${encodeURIComponent(pr.id)}`, {
          method: 'PATCH',
          headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({ generated_messages: genMsgs, updated_at: new Date().toISOString() }),
        }).catch(console.error);
      }
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
// RESEARCH + ACCESS REMINDERS
// ═══════════════════════════════════════════════════════════════

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDaysAgo(days, now = new Date()) {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

function quotePostgrestValue(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function appUrlForToken(token) {
  return `https://neurobusiness.one/app.html?token=${encodeURIComponent(token)}`;
}

function hasResearchConsent(profile = {}) {
  return profile.consent_research === true || profile.consent_research_status === 'yes';
}

async function getProfilesByIds(ids, env) {
  const uniqueIds = [...new Set((ids || []).filter(Boolean))];
  if (!uniqueIds.length) return [];
  const idList = uniqueIds.map(quotePostgrestValue).join(',');
  const rich = await supabaseGet(
    `profiles?id=in.(${idList})&select=id,email,first_name,lang,diagnostic_completed_at,consent_research,consent_research_status`,
    env
  );
  if (rich) return rich;
  return await supabaseGet(
    `profiles?id=in.(${idList})&select=id,email,first_name,lang,diagnostic_completed_at`,
    env
  ) || [];
}

async function getLatestTokensByUserIds(ids, env) {
  const uniqueIds = [...new Set((ids || []).filter(Boolean))];
  if (!uniqueIds.length) return {};
  const idList = uniqueIds.map(quotePostgrestValue).join(',');
  const rows = await supabaseGet(
    `access_tokens?user_id=in.(${idList})&select=email,user_id,token,created_at,expires_at&order=created_at.desc`,
    env
  ) || [];
  const map = {};
  for (const row of rows) {
    if (!map[row.user_id]) map[row.user_id] = row;
  }
  return map;
}

async function runResearchReminderSweep(env, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const limit = Math.min(Math.max(parseInt(opts.limit || '80', 10) || 80, 1), 250);
  const dryRun = opts.dryRun === true || opts.dry_run === true;
  const source = opts.source || 'manual';
  const webhook = env.N8N_REMINDER_WEBHOOK || 'https://evakolontai.app.n8n.cloud/webhook/nb-research-reminder';
  const fallbackWebhook = 'https://evakolontai.app.n8n.cloud/webhook/nb-magic-link';

  const notStarted = await collectNotStartedReminderCandidates(env, now, limit);
  const retest = await collectRetestReminderCandidates(env, now, limit);

  const sent = [];
  for (const candidate of [...notStarted, ...retest]) {
    const result = await sendResearchReminder(candidate, env, {
      dryRun,
      webhook,
      fallbackWebhook,
      source,
    });
    sent.push(result);
  }

  return {
    ok: true,
    dryRun,
    source,
    window: {
      notStarted7d: { from: isoDaysAgo(8, now), to: isoDaysAgo(7, now) },
      retest14d: { from: isoDaysAgo(15, now), to: isoDaysAgo(14, now) },
    },
    counts: {
      notStarted: notStarted.length,
      retest: retest.length,
      total: sent.length,
      sent: sent.filter(r => r.sent).length,
      failed: sent.filter(r => r.error).length,
    },
    reminders: sent,
  };
}

async function collectNotStartedReminderCandidates(env, now, limit) {
  const from = isoDaysAgo(8, now);
  const to = isoDaysAgo(7, now);
  const tokens = await supabaseGet(
    `access_tokens?select=email,user_id,token,created_at,expires_at&created_at=gte.${encodeURIComponent(from)}&created_at=lt.${encodeURIComponent(to)}&expires_at=gte.${encodeURIComponent(now.toISOString())}&order=created_at.asc&limit=${limit}`,
    env
  ) || [];
  const profiles = await getProfilesByIds(tokens.map(t => t.user_id), env);
  const byId = Object.fromEntries(profiles.map(p => [p.id, p]));
  const candidates = [];
  for (const token of tokens) {
    const profile = byId[token.user_id];
    if (!profile || profile.diagnostic_completed_at) continue;
    candidates.push({
      type: 'not_started_7d',
      email: token.email || profile.email,
      name: profile.first_name || '',
      lang: profile.lang || 'de',
      token: token.token,
      appUrl: appUrlForToken(token.token),
      userId: profile.id,
      invitedAt: token.created_at,
      accessExpiresAt: token.expires_at,
      subject: 'Dein NeuroBusiness Zugang wartet auf dich',
      message: 'Du hast deinen NeuroBusiness Test erhalten. Er ist wichtig für deine persönliche Entwicklung und dein Zugang läuft bald ab. Nimm dir bitte jetzt einen ruhigen Moment dafür.',
    });
  }
  return candidates;
}

async function collectRetestReminderCandidates(env, now, limit) {
  const from = isoDaysAgo(15, now);
  const to = isoDaysAgo(14, now);
  const profiles = await supabaseGet(
    `profiles?diagnostic_completed_at=gte.${encodeURIComponent(from)}&diagnostic_completed_at=lt.${encodeURIComponent(to)}&select=id,email,first_name,lang,diagnostic_completed_at,consent_research,consent_research_status&limit=${limit}`,
    env
  ) || [];
  const consented = profiles.filter(hasResearchConsent);
  const tokenMap = await getLatestTokensByUserIds(consented.map(p => p.id), env);
  return consented.map(profile => {
    const token = tokenMap[profile.id] || {};
    return {
      type: 'retest_14d',
      email: profile.email,
      name: profile.first_name || '',
      lang: profile.lang || 'de',
      token: token.token || null,
      appUrl: token.token ? appUrlForToken(token.token) : null,
      userId: profile.id,
      diagnosticCompletedAt: profile.diagnostic_completed_at,
      accessExpiresAt: token.expires_at || null,
      subject: 'Kurzer NeuroBusiness Retest für die Forschung',
      message: 'Danke, dass du die NeuroBusiness Forschung unterstützt. Für die Validitätsprüfung ist ein kurzer Retest nach 14 Tagen besonders wertvoll.',
    };
  });
}

async function sendResearchReminder(candidate, env, opts = {}) {
  const idempotencyKey = `nb:${candidate.type}:${candidate.userId}:${(candidate.diagnosticCompletedAt || candidate.invitedAt || '').slice(0, 10)}`;
  const payload = {
    ...candidate,
    idempotency_key: idempotencyKey,
    source: opts.source || 'manual',
    product: 'neurobusiness_diagnostic',
  };

  if (opts.dryRun) {
    return { type: candidate.type, email: candidate.email, dryRun: true, sent: false, idempotencyKey };
  }

  const primary = await postReminderWebhook(opts.webhook, payload);
  if (primary.ok) {
    return { type: candidate.type, email: candidate.email, sent: true, via: opts.webhook, idempotencyKey };
  }

  const fallbackPayload = {
    email: candidate.email,
    token: candidate.token,
    appUrl: candidate.appUrl,
    name: candidate.name,
    lang: candidate.lang,
    reminder_type: candidate.type,
    subject: candidate.subject,
    message: candidate.message,
    idempotency_key: idempotencyKey,
  };
  const fallback = candidate.token && candidate.appUrl
    ? await postReminderWebhook(opts.fallbackWebhook, fallbackPayload)
    : { ok: false, status: 0, text: 'no token for fallback' };
  if (fallback.ok) {
    return { type: candidate.type, email: candidate.email, sent: true, via: opts.fallbackWebhook, fallback: true, idempotencyKey };
  }

  return {
    type: candidate.type,
    email: candidate.email,
    sent: false,
    error: `primary ${primary.status}: ${primary.text}; fallback ${fallback.status}: ${fallback.text}`,
    idempotencyKey,
  };
}

async function postReminderWebhook(url, payload) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, text: text.slice(0, 500) };
  } catch (err) {
    return { ok: false, status: 0, text: err.message || String(err) };
  }
}

// ═══════════════════════════════════════════════════════════════
// SALES AGENT HELPERS
// ═══════════════════════════════════════════════════════════════

function normalizeSalesLead(input = {}) {
  const fields = input.fields || input;
  const pick = (...names) => {
    for (const name of names) {
      const value = fields[name];
      if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return null;
  };
  const asString = (v) => Array.isArray(v) ? String(v[0] || '').trim() : String(v || '').trim();
  const targetMap = {
    'Practitioner-Lizenz': 'practitioner',
    'Practitioner': 'practitioner',
    'Certified Practitioner': 'practitioner',
    'Team Intelligence': 'team',
    'Team': 'team',
    'Core Program': 'core',
    'Core Programme': 'core',
    'Transformation': 'core',
  };
  const typeMap = {
    'S — Stratege': 'S', 'S - Stratege': 'S', 'Strategist': 'S',
    'V — Visionär': 'V', 'V - Visionär': 'V', 'Visionary': 'V',
    'M — Builder': 'M', 'M - Builder': 'M', 'Builder': 'M',
    'C — Connector': 'C', 'C - Connector': 'C', 'Connector': 'C',
    'G — Hochleister': 'G', 'G - Hochleister': 'G', 'High Performer': 'G',
  };
  const targetRaw = asString(pick('target', 'Ziel-Angebot', 'Ziel Angebot', 'Offer', 'Angebot'));
  const typeRaw = asString(pick('type_guess', 'Psychotyp (Vermutung)', 'Typ', 'Type Guess'));
  return {
    airtable_id: input.id || asString(pick('airtable_id', 'Airtable ID')) || null,
    name: asString(pick('name', 'Name')).slice(0, 120),
    linkedin_url: asString(pick('linkedin_url', 'LinkedIn-URL', 'LinkedIn URL', 'LinkedIn', 'Profil')) || null,
    role: asString(pick('role', 'Rolle', 'Position', 'Job Title')) || null,
    company: asString(pick('company', 'Unternehmen', 'Firma', 'Company')) || null,
    type_guess: typeMap[typeRaw] || (/^[SVMCG]$/.test(typeRaw) ? typeRaw : null),
    target: targetMap[targetRaw] || targetRaw || 'practitioner',
    status: asString(pick('status', 'Status')) || 'neu',
    notes: asString(pick('notes', 'Notizen', 'Aufhänger', 'Hook')) || null,
    source: asString(pick('source', 'Quelle', 'Source')) || (input.id ? 'airtable' : 'manual'),
  };
}

function scoreSalesLead(lead = {}) {
  const text = `${lead.name || ''} ${lead.role || ''} ${lead.company || ''} ${lead.notes || ''}`.toLowerCase();
  let score = 25;
  const reasons = [];

  const add = (points, reason) => { score += points; reasons.push(reason); };
  if (/(coach|coaching|berater|consultant|trainer|facilitator|psycholog|therapeut|mentor)/i.test(text)) add(22, 'arbeitet nah an Coaching/Beratung');
  if (/(hr|people|talent|learning|development|organisationsentwicklung|leadership|führung|culture)/i.test(text)) add(20, 'hat Zugang zu HR/Team-Kontexten');
  if (/(executive|founder|gründer|startup|selbstständig|solopreneur|business model|positionierung)/i.test(text)) add(16, 'Zielgruppe passt zu NeuroBusiness');
  if (/(burnout|stress|resilienz|mental health|neuro|psychologie|positive psychology|performance)/i.test(text)) add(14, 'inhaltlicher Psychologie-/Performance-Hook');
  if (lead.linkedin_url) add(8, 'LinkedIn-Profil vorhanden');
  if (lead.notes && lead.notes.length > 20) add(8, 'konkreter persönlicher Aufhänger vorhanden');
  if (lead.target === 'team') add(6, 'Team-Angebot mit höherem B2B-Wert');
  if (lead.target === 'practitioner') add(5, 'Multiplikator-Potenzial über Practitioner-Lizenz');

  score = Math.max(0, Math.min(100, score));
  const fit_segment = score >= 78 ? 'A' : score >= 58 ? 'B' : 'C';
  const suggested_target = /(hr|people|team|organisation|leadership|führung)/i.test(text) ? 'team' : 'practitioner';
  const next_action = fit_segment === 'A'
    ? 'Heute personalisiert anfragen und Demo-/15-Minuten-Call anbieten.'
    : fit_segment === 'B'
      ? 'Erst mit relevantem Content/Kommentar aufwärmen, dann Connection-Note senden.'
      : 'Nur nurturen oder parken, bis ein stärkerer Hook sichtbar ist.';

  return {
    fit_score: score,
    fit_segment,
    fit_reason: reasons.slice(0, 4).join('; ') || 'Basis-Fit ohne starken sichtbaren Hook',
    suggested_target,
    next_action,
  };
}

async function upsertSalesProspect(lead, env) {
  const payload = {
    airtable_id: lead.airtable_id || null,
    name: lead.name,
    linkedin_url: lead.linkedin_url || null,
    role: lead.role || null,
    company: lead.company || null,
    type_guess: lead.type_guess || null,
    target: lead.target || lead.suggested_target || 'practitioner',
    status: lead.status || 'neu',
    notes: lead.notes || null,
    source: lead.source || null,
    fit_score: lead.fit_score ?? null,
    fit_segment: lead.fit_segment || null,
    fit_reason: lead.fit_reason || null,
    next_action: lead.next_action || null,
    updated_at: new Date().toISOString(),
  };

  if (lead.airtable_id) {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/sales_prospects?on_conflict=airtable_id`, {
      method: 'POST',
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    return data?.[0] || data;
  }
  return supabasePost('sales_prospects', payload, env);
}

async function safeCreateSalesProspect(payload, env) {
  const created = await supabasePost('sales_prospects', payload, env);
  if (created) return created;

  // Fallback for deployments where add_sales_agents_airtable.sql has not run yet.
  const basePayload = {
    name: payload.name,
    linkedin_url: payload.linkedin_url || null,
    role: payload.role || null,
    company: payload.company || null,
    type_guess: payload.type_guess || null,
    target: payload.target || 'practitioner',
    notes: [
      payload.notes,
      payload.fit_segment || payload.fit_score ? `Fit: ${payload.fit_segment || '?'} ${payload.fit_score || ''} — ${payload.fit_reason || ''}` : '',
      payload.next_action ? `Nächste Aktion: ${payload.next_action}` : '',
    ].filter(Boolean).join('\n\n') || null,
    status: payload.status || 'neu',
  };
  return supabasePost('sales_prospects', basePayload, env);
}

async function patchSalesProspect(id, patch, env) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/sales_prospects?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(await res.text());
}

async function fetchAirtableRecords(env, opts = {}) {
  if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID || !env.AIRTABLE_TABLE_NAME) {
    throw new Error('Airtable nicht konfiguriert: AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME setzen.');
  }
  const table = encodeURIComponent(opts.table || env.AIRTABLE_TABLE_NAME);
  const params = new URLSearchParams({ pageSize: String(Math.min(parseInt(opts.limit) || 100, 100)) });
  if (opts.view) params.set('view', opts.view);
  if (opts.filterByFormula) params.set('filterByFormula', opts.filterByFormula);
  const all = [];
  let offset = '';
  do {
    const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${table}?${params.toString()}${offset ? '&offset=' + encodeURIComponent(offset) : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` } });
    if (!res.ok) throw new Error(`Airtable pull failed ${res.status}: ${await res.text()}`);
    const data = await res.json();
    all.push(...(data.records || []));
    offset = opts.all === true ? data.offset : '';
  } while (offset);
  return all;
}

async function updateAirtableRecord(recordId, data, env, opts = {}) {
  if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID || !env.AIRTABLE_TABLE_NAME) return { ok: false, skipped: 'airtable_not_configured' };
  const table = encodeURIComponent(opts.table || env.AIRTABLE_TABLE_NAME);
  const m = data.generated_messages || {};
  const desiredFields = {
    'Nachricht Entwurf':
      '── CONNECTION-NOTE (max 280) ──\n' + (m.connectionNote || '') +
      '\n\n── DM NACH CONNECT (Tag 2) ──\n' + (m.dm || '') +
      '\n\n── FOLLOW-UP (Tag 4) ──\n' + (m.followUp || ''),
    'Status': data.status || undefined,
    'Fit Score': data.score?.fit_score ?? undefined,
    'Segment': data.score?.fit_segment || undefined,
    'Nächste Aktion': data.score?.next_action || undefined,
    'Fit Begründung': data.score?.fit_reason || undefined,
  };
  const availableFields = await getAirtableFields(env, opts).catch(() => null);
  const fields = availableFields
    ? Object.fromEntries(Object.entries(desiredFields).filter(([name]) => availableFields.has(name)))
    : desiredFields;
  const skipped_fields = availableFields
    ? Object.keys(desiredFields).filter(name => desiredFields[name] !== undefined && !availableFields.has(name))
    : [];
  Object.keys(fields).forEach(k => fields[k] === undefined && delete fields[k]);
  if (!Object.keys(fields).length) return { ok: false, skipped_fields, skipped: 'no_matching_airtable_fields' };
  const res = await fetch(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${table}/${recordId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`Airtable push failed ${res.status}: ${await res.text()}`);
  return { ok: true, written_fields: Object.keys(fields), skipped_fields };
}

async function getAirtableFields(env, opts = {}) {
  if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID || !env.AIRTABLE_TABLE_NAME) return null;
  const tableName = opts.table || env.AIRTABLE_TABLE_NAME;
  const res = await fetch(`https://api.airtable.com/v0/meta/bases/${env.AIRTABLE_BASE_ID}/tables`, {
    headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Airtable schema failed ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const table = (data.tables || []).find(t => t.name === tableName || t.id === tableName);
  if (!table) return null;
  return new Set((table.fields || []).map(f => f.name));
}

async function ensureAirtableSalesFields(env, opts = {}) {
  if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID || !env.AIRTABLE_TABLE_NAME) {
    throw new Error('Airtable nicht konfiguriert: AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME setzen.');
  }

  const tableName = opts.table || env.AIRTABLE_TABLE_NAME;
  const schemaRes = await fetch(`https://api.airtable.com/v0/meta/bases/${env.AIRTABLE_BASE_ID}/tables`, {
    headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` },
  });
  if (!schemaRes.ok) throw new Error(`Airtable schema failed ${schemaRes.status}: ${await schemaRes.text()}`);
  const schema = await schemaRes.json();
  const table = (schema.tables || []).find(t => t.name === tableName || t.id === tableName);
  if (!table) throw new Error(`Airtable table not found: ${tableName}`);

  const existing = new Set((table.fields || []).map(f => f.name));
  const desired = [
    { name: 'Fit Score', type: 'number', options: { precision: 0 } },
    { name: 'Segment', type: 'singleLineText' },
    { name: 'Nächste Aktion', type: 'multilineText' },
    { name: 'Fit Begründung', type: 'multilineText' },
    { name: 'Wochen-Sprint', type: 'singleLineText' },
    { name: 'LinkedIn Aktion', type: 'singleLineText' },
    { name: 'Sprint Priorität', type: 'singleLineText' },
    { name: 'Senden bis', type: 'singleLineText' },
    { name: 'Suchquelle', type: 'singleLineText' },
  ];

  const created = [];
  const already_exists = [];
  const errors = [];
  for (const field of desired) {
    if (existing.has(field.name)) {
      already_exists.push(field.name);
      continue;
    }
    const res = await fetch(`https://api.airtable.com/v0/meta/bases/${env.AIRTABLE_BASE_ID}/tables/${table.id}/fields`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(field),
    });
    if (res.ok) {
      const data = await res.json();
      created.push(data.name || field.name);
      existing.add(field.name);
    } else {
      errors.push({ field: field.name, status: res.status, error: await res.text() });
    }
  }

  return { ok: errors.length === 0, table: table.name, created, already_exists, errors };
}

async function patchAirtableFields(recordId, fields, env, opts = {}) {
  if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID || !env.AIRTABLE_TABLE_NAME) {
    return { ok: false, skipped: 'airtable_not_configured' };
  }
  const availableFields = opts.availableFields
    ? new Set(Array.isArray(opts.availableFields) ? opts.availableFields : Array.from(opts.availableFields))
    : await getAirtableFields(env, opts).catch(() => null);
  const clean = Object.fromEntries(Object.entries(fields || {}).filter(([name, value]) => {
    return value !== undefined && value !== null && value !== '' && (!availableFields || availableFields.has(name));
  }));
  if (!Object.keys(clean).length) return { ok: false, skipped: 'no_matching_airtable_fields' };
  const table = encodeURIComponent(opts.table || env.AIRTABLE_TABLE_NAME);
  const res = await fetch(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${table}/${recordId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: clean }),
  });
  if (!res.ok) throw new Error(`Airtable patch failed ${res.status}: ${await res.text()}`);
  return { ok: true, written_fields: Object.keys(clean) };
}

async function batchPatchAirtableRecords(updates, env, opts = {}) {
  if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID || !env.AIRTABLE_TABLE_NAME) {
    return [];
  }
  const availableFields = opts.availableFields
    ? new Set(Array.isArray(opts.availableFields) ? opts.availableFields : Array.from(opts.availableFields))
    : await getAirtableFields(env, opts).catch(() => null);
  const table = encodeURIComponent(opts.table || env.AIRTABLE_TABLE_NAME);
  const results = [];
  for (let i = 0; i < updates.length; i += 10) {
    const chunk = updates.slice(i, i + 10)
      .map(u => ({
        id: u.id,
        fields: Object.fromEntries(Object.entries(u.fields || {}).filter(([name, value]) => {
          return value !== undefined && value !== null && value !== '' && (!availableFields || availableFields.has(name));
        })),
      }))
      .filter(u => u.id && Object.keys(u.fields).length);
    if (!chunk.length) continue;
    const res = await fetch(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${table}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: chunk }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Airtable batch patch failed ${res.status}: ${JSON.stringify(data)}`);
    results.push(...(data.records || []).map(r => ({ id: r.id, ok: true, written_fields: Object.keys(chunk.find(c => c.id === r.id)?.fields || {}) })));
  }
  return results;
}

function isoWeekId(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function nextBusinessDueDate(date = new Date(), days = 5) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isOpenForOutreach(fields = {}) {
  const status = String(fields.Status || fields.status || '').toLowerCase();
  const action = String(fields['LinkedIn Aktion'] || '').toLowerCase();
  if (/(angeschrieben|geantwortet|kunde|gekauft|done|sent|not interested|kein interesse)/i.test(status)) return false;
  if (/(gesendet|sent|erledigt|done)/i.test(action)) return false;
  return true;
}

function hasMessageDraft(fields = {}) {
  return String(fields['Nachricht Entwurf'] || '').trim().length > 40;
}

function discoveryQueries() {
  return [
    'site:linkedin.com/in Coach HR Führungskräfteentwicklung Deutschland',
    'site:linkedin.com/in Business Coach Resilienz Organisationsentwicklung',
    'site:linkedin.com/in Head of HR People Development Coaching Germany',
    'site:linkedin.com/in Leadership Coach Teamdiagnostik Change Management',
    'site:linkedin.com/in systemischer Coach NLP Führungskräfte Deutschland',
  ].map(q => ({
    query: q,
    url: `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  }));
}

async function runSalesWeeklySprint(env, opts = {}) {
  await ensureAirtableSalesFields(env, opts);
  const availableFields = await getAirtableFields(env, opts).catch(() => null);
  const weeklyLimit = Math.max(1, Math.min(parseInt(opts.weeklyLimit || opts.limit || 100, 10), 100));
  const minScore = Math.max(0, Math.min(parseInt(opts.minScore || 58, 10), 100));
  const generateLimit = Math.max(0, Math.min(parseInt(opts.generateLimit || 3, 10), 5));
  const week = opts.week || isoWeekId();
  const records = await fetchAirtableRecords(env, { ...opts, all: true, limit: 100 });

  const candidates = [];
  for (const record of records || []) {
    const lead = normalizeSalesLead(record);
    if (!lead.name || !isOpenForOutreach(record.fields || {})) continue;
    const score = scoreSalesLead(lead);
    if (score.fit_score < minScore) continue;
    candidates.push({
      record,
      lead,
      score,
      hasDraft: hasMessageDraft(record.fields || {}),
    });
  }

  candidates.sort((a, b) => {
    const seg = { A: 3, B: 2, C: 1 };
    return (seg[b.score.fit_segment] || 0) - (seg[a.score.fit_segment] || 0)
      || b.score.fit_score - a.score.fit_score
      || Number(b.hasDraft) - Number(a.hasDraft);
  });

  const selected = candidates.slice(0, weeklyLimit);
  const prepared = [];
  const airtableUpdates = [];
  let generated = 0;
  for (let i = 0; i < selected.length; i++) {
    const item = selected[i];
    let row = null;
    let messages = null;
    if (opts.generate === true && !item.hasDraft && generated < generateLimit) {
      row = await upsertSalesProspect({ ...item.lead, ...item.score, source: item.lead.source || 'weekly-sprint' }, env);
      messages = await generateSalesMessages(row, env);
      generated++;
      if (row?.id) await patchSalesProspect(row.id, { generated_messages: messages }, env);
    }
    const fields = {
      'Wochen-Sprint': week,
      'LinkedIn Aktion': 'Diese Woche manuell anschreiben',
      'Sprint Priorität': String(i + 1),
      'Senden bis': nextBusinessDueDate(new Date(), 5),
      'Fit Score': item.score.fit_score,
      'Segment': item.score.fit_segment,
      'Nächste Aktion': item.score.next_action,
      'Fit Begründung': item.score.fit_reason,
      'Suchquelle': opts.source || 'weekly-sprint',
    };
    if (messages) {
      fields['Nachricht Entwurf'] =
        '── CONNECTION-NOTE (max 280) ──\n' + (messages.connectionNote || '') +
        '\n\n── DM NACH CONNECT (Tag 2) ──\n' + (messages.dm || '') +
        '\n\n── FOLLOW-UP (Tag 4) ──\n' + (messages.followUp || '');
    }
    if (item.lead.airtable_id) airtableUpdates.push({ id: item.lead.airtable_id, fields });
    prepared.push({
      priority: i + 1,
      airtable_id: item.lead.airtable_id,
      name: item.lead.name,
      role: item.lead.role,
      score: item.score,
      hasDraft: item.hasDraft || !!messages,
      generated: !!messages,
      airtable: item.lead.airtable_id ? { ok: true, queued: true } : null,
    });
  }

  const airtableResults = await batchPatchAirtableRecords(airtableUpdates, env, { ...opts, availableFields });
  const byId = new Map(airtableResults.map(r => [r.id, r]));
  for (const p of prepared) {
    if (p.airtable_id && byId.has(p.airtable_id)) p.airtable = byId.get(p.airtable_id);
  }

  return {
    ok: true,
    week,
    weeklyLimit,
    minScore,
    availableCandidates: candidates.length,
    preparedCount: prepared.length,
    generatedCount: generated,
    prepared,
    discoveryQueries: discoveryQueries(),
    note: 'LinkedIn wird nicht automatisch angeschrieben. Die Queue ist für manuelles Auslösen vorbereitet.',
  };
}

function parseManualLeadLines(input = '') {
  return String(input || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const url = (line.match(/https?:\/\/\S+/) || [])[0] || '';
      const cleaned = line.replace(url, '').trim();
      const parts = cleaned.split(/\s+[|;–—-]\s+/).map(p => p.trim()).filter(Boolean);
      return {
        name: (parts[0] || cleaned).replace(/^\d+[.)]\s*/, '').trim(),
        role: parts[1] || '',
        notes: parts.slice(2).join(' - '),
        linkedin_url: url,
      };
    })
    .filter(lead => lead.name);
}

async function createAirtableSalesLeads(env, opts = {}) {
  if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID || !env.AIRTABLE_TABLE_NAME) {
    throw new Error('Airtable nicht konfiguriert: AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME setzen.');
  }
  const table = encodeURIComponent(opts.table || env.AIRTABLE_TABLE_NAME);
  const availableFields = await getAirtableFields(env, opts).catch(() => null);
  const inputRecords = Array.isArray(opts.records)
    ? opts.records
    : parseManualLeadLines(opts.names || opts.text || '');
  const status = opts.status || 'Nicht kontaktiert';
  const sourceNote = opts.source ? `Quelle: ${opts.source}` : 'Quelle: manuell';

  const toFields = (lead = {}) => {
    const notes = [lead.notes || lead.notizen || '', sourceNote].filter(Boolean).join('\n');
    const desired = {
      'Name': String(lead.name || lead.Name || '').trim(),
      'LinkedIn URL': lead.linkedin_url || lead.linkedin || lead.LinkedIn || undefined,
      'Rolle': lead.role || lead.rolle || lead.Position || undefined,
      'Notizen': notes || undefined,
      'Status': lead.status || status,
    };
    Object.keys(desired).forEach(k => (!desired[k] || (availableFields && !availableFields.has(k))) && delete desired[k]);
    return desired;
  };

  const records = inputRecords
    .map(toFields)
    .filter(fields => fields.Name)
    .map(fields => ({ fields }));
  if (!records.length) return { ok: false, created: [], error: 'Keine gültigen Namen gefunden.' };

  const created = [];
  const errors = [];
  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10);
    const res = await fetch(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${table}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: batch }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) created.push(...(data.records || []));
    else errors.push({ status: res.status, error: data });
  }

  return {
    ok: errors.length === 0,
    requested: records.length,
    created: created.map(r => ({ id: r.id, name: r.fields?.Name })),
    errors,
  };
}

function salesPipelineType(prospect = {}) {
  const text = `${prospect.target || ''} ${prospect.role || ''} ${prospect.company || ''} ${prospect.notes || ''}`.toLowerCase();
  if (/(team|hr|people|unternehmen|company|leadership|organisation|transformation)/i.test(text)) return 'company';
  return 'coach';
}

function salesPhase3MissingData(prospect = {}) {
  const missing = [];
  if (!prospect.linkedin_url) missing.push('LinkedIn-Profil');
  if (!prospect.role) missing.push('Rolle/Position');
  if (!prospect.company && salesPipelineType(prospect) === 'company') missing.push('Unternehmen');
  if (!prospect.notes || String(prospect.notes).length < 20) missing.push('persönlicher Aufhänger');
  if (!prospect.target) missing.push('Zielangebot');
  return missing;
}

function salesSourceRecordsFromProspect(prospect = {}) {
  const records = [];
  if (prospect.linkedin_url) {
    records.push({
      title: `LinkedIn-Profil: ${prospect.name}`,
      url: prospect.linkedin_url,
      snippet: [prospect.role, prospect.company, prospect.notes].filter(Boolean).join(' · ').slice(0, 500),
      source_type: 'linkedin',
    });
  }
  if (prospect.source) {
    records.push({
      title: `Quelle: ${prospect.source}`,
      url: null,
      snippet: prospect.notes || prospect.role || prospect.company || '',
      source_type: prospect.source,
    });
  }
  return records;
}

function runSalesResearchAgent(prospect = {}) {
  const missing = salesPhase3MissingData(prospect);
  const sources = salesSourceRecordsFromProspect(prospect);
  const quality = Math.max(20, Math.min(100, 100 - missing.length * 15 + sources.length * 5));
  const leadType = salesPipelineType(prospect);
  return {
    lead_type: leadType,
    data_quality: quality,
    missing_data: missing,
    sources,
    summary: [
      prospect.name ? `Lead: ${prospect.name}` : '',
      prospect.role ? `Rolle: ${prospect.role}` : '',
      prospect.company ? `Organisation: ${prospect.company}` : '',
      prospect.notes ? `Hook: ${String(prospect.notes).slice(0, 220)}` : '',
    ].filter(Boolean).join(' · ') || 'Nur Basisdaten vorhanden.',
    next_research_step: missing.length
      ? `Ergänzen: ${missing.slice(0, 3).join(', ')}.`
      : 'Daten reichen für Scoring und Account Brief.',
  };
}

function runSalesScoringAgent(prospect = {}) {
  const normalized = normalizeSalesLead(prospect);
  const score = scoreSalesLead({ ...normalized, ...prospect });
  const leadType = salesPipelineType({ ...prospect, target: score.suggested_target || prospect.target });
  return {
    lead_type: leadType,
    score: score.fit_score,
    segment: score.fit_segment,
    reason: score.fit_reason,
    missing_data: salesPhase3MissingData(prospect),
    next_action: score.next_action,
    suggested_target: score.suggested_target,
  };
}

function sandboxSalesBrief(prospect = {}, research = null, scoring = null) {
  const leadType = scoring?.lead_type || research?.lead_type || salesPipelineType(prospect);
  const targetLabel = leadType === 'company' ? 'Team Intelligence' : 'Coach-/Practitioner-Multiplikator';
  const hook = prospect.notes || prospect.role || prospect.company || 'sichtbarer Business-/Leadership-Bezug';
  return {
    why_this_lead: `${prospect.name} passt als ${targetLabel}, weil ${hook}.`,
    why_now: scoring?.segment === 'A'
      ? 'Hoher Fit und genug Kontext für eine persönliche Ansprache.'
      : 'Erst mit einem klaren Hook anwärmen und fehlende Daten ergänzen.',
    likely_need: leadType === 'company'
      ? 'Bessere Zusammenarbeit, Rollenklärung, schnellere Entscheidungen oder Transformations-/AI-Kontext.'
      : 'Differenzierung im Coaching, diagnostischer Einstieg und wiederkehrende Nutzung mit Klient:innen.',
    entry_angle: leadType === 'company'
      ? 'Teamdiagnostik als pragmatischer Blick auf Denk-, Entscheidungs- und Kommunikationsmuster.'
      : 'NeuroBusiness als psychologisch fundierter Diagnose- und Gesprächseinstieg für Coaching-Klient:innen.',
    evidence: [prospect.role, prospect.company, prospect.linkedin_url ? 'LinkedIn-Profil vorhanden' : '', prospect.notes].filter(Boolean),
    assumptions: ['Diagnostik ist in Validierung kommunizieren', 'Kein Leistungsversprechen oder klinischer Claim'],
    message_opener: `Mir ist bei deinem Profil aufgefallen: ${String(hook).slice(0, 160)}...`,
  };
}

async function runSalesBriefAgent(prospect = {}, research = null, scoring = null, env, opts = {}) {
  if (opts.sandbox || !env.ANTHROPIC_API_KEY) return sandboxSalesBrief(prospect, research, scoring);
  const system = `Du bist Eva Kolontais interner Sales-Account-Brief-Agent für NeuroBusiness™.

Erstelle ein kurzes Account Briefing. Kein Outreach-Text, kein Versand.
Beachte: Die NeuroBusiness-Diagnostik ist in Validierung. Keine Claims wie wissenschaftlich bewiesen, klinisch validiert, garantiert bessere Leistung oder misst Gehirnstrukturen.

Antworte ausschließlich mit validem JSON:
{"why_this_lead":"","why_now":"","likely_need":"","entry_angle":"","evidence":[""],"assumptions":[""],"message_opener":""}`;
  const user = `Prospect:
Name: ${prospect.name || ''}
Rolle: ${prospect.role || ''}
Unternehmen: ${prospect.company || ''}
Ziel: ${prospect.target || ''}
Notizen: ${prospect.notes || ''}
LinkedIn: ${prospect.linkedin_url || ''}

Research: ${JSON.stringify(research || {})}
Scoring: ${JSON.stringify(scoring || {})}`;
  const text = await callClaude([{ role: 'user', content: user }], system, env);
  try { return JSON.parse(text.replace(/^```json?\s*|\s*```$/g, '')); }
  catch { return { why_this_lead: text, why_now: '', likely_need: '', entry_angle: '', evidence: [], assumptions: ['Brief war kein JSON'], message_opener: '' }; }
}

async function writeSalesAgentRun(prospectId, agent, status, output, env, opts = {}) {
  const row = {
    prospect_id: prospectId,
    agent,
    status,
    input_summary: opts.input_summary || null,
    output: output || null,
    error: opts.error || null,
    sandbox: opts.sandbox === true,
  };
  try { await supabasePost('sales_agent_runs', row, env); }
  catch (e) { console.error('sales_agent_runs write failed', e); }
}

async function writeSalesSourceRecords(prospectId, sources = [], env) {
  for (const source of sources || []) {
    if (!source?.title) continue;
    try {
      await supabasePost('sales_source_records', {
        prospect_id: prospectId,
        title: source.title,
        url: source.url || null,
        snippet: source.snippet || null,
        source_type: source.source_type || 'manual',
      }, env);
    } catch (e) {
      console.error('sales_source_records write failed', e);
    }
  }
}

async function patchSalesPhase3Results(prospect, patch, env) {
  const mergedMessages = {
    ...(prospect.generated_messages || {}),
    phase3: {
      ...((prospect.generated_messages || {}).phase3 || {}),
      ...(patch.phase3 || {}),
    },
  };
  const dbPatch = {
    generated_messages: mergedMessages,
    last_agent_run_at: new Date().toISOString(),
  };
  if (patch.research_summary) dbPatch.research_summary = patch.research_summary;
  if (patch.account_brief) dbPatch.account_brief = patch.account_brief;
  if (patch.data_quality !== undefined) dbPatch.data_quality = patch.data_quality;
  if (patch.missing_data !== undefined) dbPatch.missing_data = patch.missing_data;
  if (patch.fit_score !== undefined) dbPatch.fit_score = patch.fit_score;
  if (patch.fit_segment !== undefined) dbPatch.fit_segment = patch.fit_segment;
  if (patch.fit_reason !== undefined) dbPatch.fit_reason = patch.fit_reason;
  if (patch.next_action !== undefined) dbPatch.next_action = patch.next_action;
  try {
    await patchSalesProspect(prospect.id, dbPatch, env);
  } catch (e) {
    const fallback = {
      generated_messages: mergedMessages,
    };
    if (patch.fit_score !== undefined) fallback.fit_score = patch.fit_score;
    if (patch.fit_segment !== undefined) fallback.fit_segment = patch.fit_segment;
    if (patch.fit_reason !== undefined) fallback.fit_reason = patch.fit_reason;
    if (patch.next_action !== undefined) fallback.next_action = patch.next_action;
    await patchSalesProspect(prospect.id, fallback, env);
  }
}

async function runSalesPhase3Agents(prospect, agent, env, opts = {}) {
  const sandbox = opts.sandbox === true;
  const result = { ok: true, id: prospect.id, agent, sandbox };
  let current = { ...prospect };
  try {
    if (agent === 'research' || agent === 'phase3_all') {
      const research = runSalesResearchAgent(current);
      await writeSalesSourceRecords(current.id, research.sources, env);
      await patchSalesPhase3Results(current, {
        research_summary: research,
        data_quality: research.data_quality,
        missing_data: research.missing_data,
        phase3: { research },
      }, env);
      await writeSalesAgentRun(current.id, 'research', 'ok', research, env, { sandbox, input_summary: current.name });
      result.research = research;
      current = { ...current, research_summary: research, data_quality: research.data_quality, missing_data: research.missing_data };
    }

    if (agent === 'score' || agent === 'phase3_all') {
      const scoring = runSalesScoringAgent(current);
      await patchSalesPhase3Results(current, {
        fit_score: scoring.score,
        fit_segment: scoring.segment,
        fit_reason: scoring.reason,
        next_action: scoring.next_action,
        phase3: { scoring },
      }, env);
      await writeSalesAgentRun(current.id, 'scoring', 'ok', scoring, env, { sandbox, input_summary: current.name });
      result.scoring = scoring;
      current = { ...current, fit_score: scoring.score, fit_segment: scoring.segment, fit_reason: scoring.reason, next_action: scoring.next_action };
    }

    if (agent === 'brief' || agent === 'phase3_all') {
      const research = result.research || current.research_summary || (current.generated_messages || {}).phase3?.research || runSalesResearchAgent(current);
      const scoring = result.scoring || (current.generated_messages || {}).phase3?.scoring || runSalesScoringAgent(current);
      const brief = await runSalesBriefAgent(current, research, scoring, env, { sandbox });
      await patchSalesPhase3Results(current, {
        account_brief: brief,
        phase3: { accountBrief: brief },
      }, env);
      await writeSalesAgentRun(current.id, 'account_brief', 'ok', brief, env, { sandbox, input_summary: current.name });
      result.account_brief = brief;
    }

    return result;
  } catch (e) {
    await writeSalesAgentRun(current.id, agent, 'error', null, env, {
      sandbox,
      input_summary: current.name,
      error: e.message,
    });
    return { ok: false, id: current.id, agent, sandbox, error: e.message };
  }
}

async function generateSalesMessages(pr, env) {
  const salesSystem = `Du bist Eva Kolontai, Diplom-Psychologin mit 20+ Jahren Erfahrung, Gründerin von NeuroBusiness™ (neurobusiness.one) — einem neuropsychologischen Diagnostik-System mit 5 Psychotypen und 5 Dimensionen.

Du schreibst LinkedIn-Outreach in Evas Stimme: warm, direkt, psychologisch fundiert, nie marktschreierisch, per Du. Kurze Sätze. Keine Emojis. Keine Floskeln.

Angebote:
- practitioner: Certified-Practitioner-Programm — Diagnostik-Lizenz für Coaches, Credits ab 79 €/Test, Klient zahlt marktüblich 147 €+. Einstieg: neurobusiness.one/coaches.html oder 15-Min-Call.
- team: Team Intelligence — Team-Diagnostik und aggregiertes Team-Dashboard.
- core: 12 Wochen 1:1 Business-Transformation.

Antworte AUSSCHLIESSLICH mit validem JSON:
{"connectionNote":"max 280 Zeichen, persönlich, kein Pitch","dm":"DM nach Connect, max 700 Zeichen, mit Hook und konkreter Frage","followUp":"Follow-up, max 400 Zeichen, kein Druck"}`;
  const salesUser = `Prospect: ${pr.name}${pr.role ? ' · ' + pr.role : ''}${pr.company ? ' · ' + pr.company : ''}
Ziel: ${pr.target || 'practitioner'}
Vermuteter Psychotyp: ${pr.type_guess || 'unbekannt'}
Fit: ${pr.fit_segment || ''} ${pr.fit_score || ''}
Notizen: ${pr.notes || '—'}`;
  const text = await callClaude([{ role: 'user', content: salesUser }], salesSystem, env);
  try { return JSON.parse(text.replace(/^```json?\s*|\s*```$/g, '')); }
  catch { return { connectionNote: text, dm: '', followUp: '' }; }
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
      ? 'High Performer: strongest overload indicator, rationalises exhaustion, cannot stop. Always integrate recovery into advice.'
      : 'Hochleister: höchster Überlastungsindikator, rationalisiert Erschöpfung, kann nicht aufhören. Immer Regeneration in Ratschläge integrieren.',
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

        const customerEmail = (
          session.customer_email ||
          session.customer_details?.email ||
          meta.client_email ||
          sub.metadata?.client_email ||
          ''
        ).trim().toLowerCase();
        const coachId = meta.coach_id || sub.metadata?.coach_id || null;
        const initialProfileId = meta.profile_id || sub.metadata?.profile_id || null;

        await upsertSubscription({
          stripe_subscription_id: sub.id,
          stripe_customer_id:     typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
          client_email:           customerEmail || null,
          profile_id:             initialProfileId,
          coach_id:               coachId,
          status:                 sub.status,
          current_period_end:     new Date(sub.current_period_end * 1000).toISOString(),
        }, env);

        let accessResult = { ok: false, skipped: 'not_attempted' };
        try {
          accessResult = await ensureStripeCustomerAccess({
            session,
            sub,
            meta,
            customerEmail,
            coachId,
            profileId: initialProfileId,
          }, env);
          if (accessResult?.profileId && accessResult.profileId !== initialProfileId) {
            await upsertSubscription({
              stripe_subscription_id: sub.id,
              stripe_customer_id:     typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
              client_email:           customerEmail || null,
              profile_id:             accessResult.profileId,
              coach_id:               coachId,
              status:                 sub.status,
              current_period_end:     new Date(sub.current_period_end * 1000).toISOString(),
            }, env);
          }
        } catch (accessErr) {
          console.error('[Stripe] Kunden-Zugang konnte nicht automatisch angelegt werden:', accessErr.message || accessErr);
          accessResult = { ok: false, error: accessErr.message || String(accessErr) };
        }

        console.log(`[Stripe] checkout.session.completed — Sub ${sub.id} angelegt (${sub.status}), access=${JSON.stringify(accessResult)}`);
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

// ── Stripe-Kunden nach erfolgreicher Zahlung automatisch Zugang geben ──────
async function ensureStripeCustomerAccess({ session, sub, meta, customerEmail, coachId, profileId }, env) {
  const email = (customerEmail || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return { ok: false, skipped: 'missing_email' };

  const profiles = await supabaseGet(`profiles?email=eq.${encodeURIComponent(email)}&select=id,email,first_name&limit=1`, env).catch(() => []);
  let profile = profiles?.[0] || null;
  const nowIso = new Date().toISOString();
  const tokens = await supabaseGet(`access_tokens?email=eq.${encodeURIComponent(email)}&expires_at=gte.${encodeURIComponent(nowIso)}&select=id,expires_at&limit=1`, env).catch(() => []);
  if (tokens?.[0]) {
    if (coachId && profile?.id) await attachCoachToProfile(profile.id, coachId, env);
    return { ok: true, created: false, profileId: profile?.id || profileId || null, reason: 'active_token_exists' };
  }

  const validityDays = Math.max(1, parseInt(env.STRIPE_CUSTOMER_ACCESS_VALIDITY_DAYS || '365', 10) || 365);
  const stripeCustomerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  const customerName = session.customer_details?.name || profile?.first_name || '';
  const createRes = await fetch('https://evakolontai.app.n8n.cloud/webhook/nb-admin-create-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      first_name: customerName,
      lang: meta.lang || 'de',
      validity: String(validityDays),
      send_email: true,
      product: meta.product || 'diagnostic',
      role: 'customer',
      source: 'stripe',
      access_type: 'stripe_customer',
      is_manual_access: false,
      stripe_managed: true,
      stripe_customer_id: stripeCustomerId || null,
      stripe_subscription_id: sub.id,
      stripe_status: sub.status,
      coach_id: coachId || null,
      consent_research: false,
      consent_research_status: meta.consent_research_status || 'unknown',
      consent_source: 'stripe_checkout',
    }),
  });

  const raw = await createRes.text();
  let createJson = {};
  try { createJson = raw ? JSON.parse(raw) : {}; } catch { createJson = { raw }; }
  if (!createRes.ok || createJson.ok === false || createJson.success === false) {
    throw new Error(`n8n create-user failed ${createRes.status}: ${raw.slice(0, 500)}`);
  }

  const refreshed = await supabaseGet(`profiles?email=eq.${encodeURIComponent(email)}&select=id,email,first_name&limit=1`, env).catch(() => []);
  profile = refreshed?.[0] || profile;
  if (coachId && profile?.id) await attachCoachToProfile(profile.id, coachId, env);

  return {
    ok: true,
    created: true,
    profileId: profile?.id || createJson.profile_id || createJson.user_id || createJson.id || profileId || null,
  };
}

async function attachCoachToProfile(profileId, coachId, env) {
  if (!profileId || !coachId) return;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(profileId)}`, {
    method: 'PATCH',
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ coach_id: coachId }),
  });
  if (!res.ok) console.warn('[Stripe] Coach-Zuordnung fehlgeschlagen:', await res.text());
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
