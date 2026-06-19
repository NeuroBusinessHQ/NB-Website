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
      'Access-Control-Allow-Origin': (origin === allowed || origin.includes('localhost') || origin.includes('pages.dev')) ? origin : allowed,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, corsHeaders);
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

      const { token: diagToken, primary, secondary, scores, burnout, industry, years, d1, d2, d3, d4, d5, responseSetWarning } = body;
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
        report_context: JSON.stringify({ primary, secondary: secondary || null, scores, burnout, industry, years, d1, d2, d3, d4, d5 }),
      };

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

      return json({ ok: true }, 200, corsHeaders);
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
  // 1. Auth: Supabase JWT aus Authorization-Header
  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace('Bearer ', '').trim();
  if (!jwt) return json({ error: 'Nicht authentifiziert' }, 401, corsHeaders);

  // 2. JWT bei Supabase verifizieren → user.email holen
  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'apikey':        env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${jwt}`,
    },
  });
  if (!userRes.ok) return json({ error: 'Ungültige Session' }, 401, corsHeaders);
  const user = await userRes.json();
  if (!user?.email) return json({ error: 'Kein User in Session' }, 401, corsHeaders);

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
  return json({ url: session.url, session_id: session.id }, 200, corsHeaders);
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
