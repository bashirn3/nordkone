import { Router } from 'express';
import { createSupabase } from '../lib/supabase.js';
import { normalizePhone } from '../lib/phone.js';
import { classifyInbound } from '../lib/classify.js';
import { CLIENT_KEY, SOURCE_SYSTEM } from '../lib/campaign.js';

const router = Router();

router.post('/wasup/inbound', async (req, res) => {
  const supabase = createSupabase();
  const payload = req.body?.body || req.body || {};
  const rawNumber = payload.from_phone || payload.from || payload.number || payload.phone;
  const message = payload.message || payload.text || payload.body || '';
  const number = normalizePhone(rawNumber);

  if (!number) return res.status(400).json({ error: 'valid sender number is required' });
  if (!message) return res.status(400).json({ error: 'message is required' });

  const providedClassification = payload.classification || req.body?.classification;
  const fallback = classifyInbound(message);
  const classification = normalizeClassification(providedClassification) || fallback.classification;
  const needsHuman =
    typeof payload.needs_human === 'boolean'
      ? payload.needs_human
      : classification === 'interested' || classification === 'needs_human' || fallback.needs_human;

  const { data: session, error: sessionError } = await supabase
    .from('campaign_outbound_sessions')
    .select('*')
    .eq('client_key', CLIENT_KEY)
    .eq('source_system', SOURCE_SYSTEM)
    .eq('number', number)
    .order('first_outbound_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (sessionError) throw sessionError;

  const { data: inbound, error: inboundError } = await supabase
    .from('campaign_inbound_events')
    .insert({
      client_key: CLIENT_KEY,
      session_id: session?.id || null,
      prospect_id: session?.prospect_id || null,
      source_system: SOURCE_SYSTEM,
      source_customer_id: session?.source_customer_id || payload.nettikone_id || null,
      number,
      message,
      classification,
      needs_human: needsHuman,
      raw_event: req.body,
    })
    .select()
    .single();

  if (inboundError) throw inboundError;

  if (session) {
    await supabase
      .from('campaign_outbound_sessions')
      .update({
        last_inbound_at: new Date().toISOString(),
        inbound_count: Number(session.inbound_count || 0) + 1,
        status: sessionStatus(classification),
        interest_status: classification,
        stop_reminders: ['sold', 'not_interested', 'opted_out', 'interested'].includes(classification),
        updated_at: new Date().toISOString(),
      })
      .eq('id', session.id)
      .eq('client_key', CLIENT_KEY);

    if (session.source_customer_id) {
      await supabase
        .from('nordkone_listings')
        .update({
          status: listingStatus(classification),
          updated_at: new Date().toISOString(),
        })
        .eq('client_key', CLIENT_KEY)
        .eq('nettikone_id', session.source_customer_id);
    }

    if (session.prospect_id) {
      await supabase
        .from('campaign_prospects')
        .update({
          status: prospectStatus(classification),
          interest_status: classification,
          updated_at: new Date().toISOString(),
        })
        .eq('id', session.prospect_id)
        .eq('client_key', CLIENT_KEY);
    }
  }

  res.json({
    ok: true,
    inbound,
    classification,
    needs_human: needsHuman,
  });
});

function normalizeClassification(value) {
  const allowed = new Set(['interested', 'sold', 'not_interested', 'unclear', 'needs_human', 'opted_out']);
  const normalized = String(value || '').trim().toLowerCase();
  return allowed.has(normalized) ? normalized : null;
}

function sessionStatus(classification) {
  if (classification === 'unclear') return 'replied';
  return classification;
}

function prospectStatus(classification) {
  if (classification === 'opted_out') return 'opted_out';
  if (classification === 'not_interested') return 'rejected';
  if (classification === 'unclear') return 'replied';
  return 'replied';
}

function listingStatus(classification) {
  if (classification === 'unclear') return 'replied';
  return classification;
}

export default router;
