import { Router } from 'express';
import { createSupabase } from '../lib/supabase.js';
import { normalizePhone } from '../lib/phone.js';
import { CAMPAIGN_NAME, CLIENT_KEY, SOURCE_SYSTEM, listingRowToResponse } from '../lib/campaign.js';

const router = Router();

router.get('/summary', async (_req, res) => {
  const supabase = createSupabase();
  const [
    eligible,
    contactedListings,
    interestedListings,
    soldListings,
    notInterestedListings,
    optedOutListings,
    descriptionPhones,
    revealedPhones,
    missingPhones,
    contacted,
    replied,
    interestedSessions,
    needsHumanSessions,
  ] = await Promise.all([
    countListings(supabase, { status: 'eligible', hasPhone: true }),
    countListings(supabase, { status: 'contacted' }),
    countListings(supabase, { status: 'interested' }),
    countListings(supabase, { status: 'sold' }),
    countListings(supabase, { status: 'not_interested' }),
    countListings(supabase, { status: 'opted_out' }),
    countListings(supabase, { phoneSource: 'description' }),
    countListings(supabase, { phoneSource: 'revealed_contact' }),
    countListings(supabase, { phoneSource: 'missing' }),
    countSessions(supabase),
    countSessions(supabase, { replied: true }),
    countSessions(supabase, { interestStatus: 'interested' }),
    countSessions(supabase, { interestStatus: 'needs_human' }),
  ]);

  res.json({
    client_key: CLIENT_KEY,
    display_name: 'NordKone',
    eligible,
    eligible_prospects: eligible,
    contacted_listings: contactedListings,
    interested_listings: interestedListings,
    sold_listings: soldListings,
    not_interested_listings: notInterestedListings,
    opted_out_listings: optedOutListings,
    description_phone_count: descriptionPhones,
    revealed_phone_count: revealedPhones,
    missing_phone_count: missingPhones,
    contacted,
    replied,
    interested: interestedSessions || interestedListings,
    needs_human: needsHumanSessions,
    opt_outs: optedOutListings,
  });
});

router.get('/listings', async (req, res) => {
  const supabase = createSupabase();
  const limit = clamp(Number(req.query.limit || 50), 1, 200);
  const status = req.query.status ? String(req.query.status) : null;
  const q = req.query.q ? String(req.query.q).trim() : null;

  let query = supabase
    .from('nordkone_listings')
    .select('*')
    .eq('client_key', CLIENT_KEY)
    .order('last_seen_at', { ascending: false })
    .limit(limit);

  query = applyStatusFilter(query, status);

  if (q) {
    const like = escapeLike(q);
    query = query.or(
      `machine_title.ilike.%${like}%,seller_name.ilike.%${like}%,nettikone_id.ilike.%${like}%,normalized_phone.ilike.%${like}%`
    );
  }

  const { data, error } = await query;
  if (error) throw error;

  res.json({ listings: (data || []).map(listingRowToResponse) });
});

router.get('/interested', async (_req, res) => {
  const supabase = createSupabase();
  const { data, error } = await supabase
    .from('nordkone_listings')
    .select('*')
    .eq('client_key', CLIENT_KEY)
    .in('status', ['interested', 'needs_human'])
    .order('updated_at', { ascending: false })
    .limit(100);

  if (error) throw error;
  res.json({ listings: (data || []).map(listingRowToResponse) });
});

router.get('/outbound/candidates', async (req, res) => {
  const supabase = createSupabase();
  const limit = clamp(Number(req.query.limit || 10), 1, 50);
  const config = await loadCampaignConfig(supabase);
  const dailyCap = clamp(Number(config?.daily_cap || 0), 0, 500);
  const sentToday = await countSessions(supabase, { sentSince: startOfTodayIso() });

  if (!config?.outbound_enabled) {
    return res.json({
      candidates: [],
      control: {
        outbound_enabled: false,
        daily_cap: dailyCap,
        sent_today: sentToday,
        remaining_today: 0,
        reason: 'outbound_disabled',
      },
    });
  }

  const remainingToday = Math.max(dailyCap - sentToday, 0);
  if (remainingToday <= 0) {
    return res.json({
      candidates: [],
      control: {
        outbound_enabled: true,
        daily_cap: dailyCap,
        sent_today: sentToday,
        remaining_today: 0,
        reason: 'daily_cap_reached',
      },
    });
  }

  const { data, error } = await supabase
    .from('nordkone_listings')
    .select('*')
    .eq('client_key', CLIENT_KEY)
    .eq('status', 'eligible')
    .not('normalized_phone', 'is', null)
    .order('first_seen_at', { ascending: true })
    .limit(Math.min(limit, remainingToday));

  if (error) throw error;

  res.json({
    control: {
      outbound_enabled: true,
      daily_cap: dailyCap,
      sent_today: sentToday,
      remaining_today: remainingToday,
      reason: 'ok',
    },
    candidates: (data || []).map((row) => {
      const listing = listingRowToResponse(row);
      return {
        ...listing,
        outbound_message: buildOutboundMessage(listing.machine_title),
      };
    }),
  });
});

router.post('/outbound/sent', async (req, res) => {
  const supabase = createSupabase();
  const {
    nettikone_id,
    source_customer_id,
    listing_id,
    number,
    message,
    provider = 'wasup',
    provider_message_id,
    raw_data = {},
  } = req.body || {};

  const listing = await loadListing(supabase, {
    listing_id,
    nettikone_id: nettikone_id || source_customer_id,
  });

  const normalized = normalizePhone(number || listing.normalized_phone);
  if (!normalized) return res.status(400).json({ error: 'valid number is required' });

  const outboundMessage = message || buildOutboundMessage(listing.machine_title);
  const existingSession = await loadExistingSession(supabase, listing.nettikone_id);

  const sessionPayload = {
    client_key: CLIENT_KEY,
    prospect_id: listing.prospect_id || null,
    source_system: SOURCE_SYSTEM,
    source_customer_id: listing.nettikone_id,
    campaign_name: CAMPAIGN_NAME,
    number: normalized,
    message: outboundMessage,
    provider,
    provider_message_id: provider_message_id || null,
    first_outbound_at: existingSession?.first_outbound_at || new Date().toISOString(),
    last_outbound_at: new Date().toISOString(),
    status: 'contacted',
    raw_data: {
      ...raw_data,
      listing_id: listing.id,
      nettikone_id: listing.nettikone_id,
      listing_url: listing.listing_url,
      machine_title: listing.machine_title,
    },
    updated_at: new Date().toISOString(),
  };

  const sessionQuery = existingSession
    ? supabase
        .from('campaign_outbound_sessions')
        .update({
          ...sessionPayload,
          outbound_count: Number(existingSession.outbound_count || 0) + 1,
        })
        .eq('id', existingSession.id)
    : supabase.from('campaign_outbound_sessions').insert({
        ...sessionPayload,
        outbound_count: 1,
      });

  const { data: session, error: sessionError } = await sessionQuery.select().single();
  if (sessionError) throw sessionError;

  const now = new Date().toISOString();
  const { error: listingError } = await supabase
    .from('nordkone_listings')
    .update({ status: 'contacted', updated_at: now })
    .eq('id', listing.id)
    .eq('client_key', CLIENT_KEY);

  if (listingError) throw listingError;

  if (listing.prospect_id) {
    const { error: prospectError } = await supabase
      .from('campaign_prospects')
      .update({ status: 'contacted', updated_at: now })
      .eq('id', listing.prospect_id)
      .eq('client_key', CLIENT_KEY);

    if (prospectError) throw prospectError;
  }

  res.json({ session });
});

router.post('/message-status', async (req, res) => {
  const supabase = createSupabase();
  const {
    provider_message_id,
    status,
    number,
    nettikone_id,
    source_customer_id,
    provider = 'wasup',
  } = req.body || {};

  if (!status) return res.status(400).json({ error: 'status is required' });

  const { data: session } = provider_message_id
    ? await supabase
        .from('campaign_outbound_sessions')
        .select('id,source_customer_id')
        .eq('client_key', CLIENT_KEY)
        .eq('provider_message_id', provider_message_id)
        .maybeSingle()
    : { data: null };

  const { error } = await supabase.from('campaign_message_status').insert({
    client_key: CLIENT_KEY,
    session_id: session?.id || null,
    source_customer_id: source_customer_id || nettikone_id || session?.source_customer_id || null,
    number: number ? normalizePhone(number) : null,
    provider,
    provider_message_id: provider_message_id || null,
    status,
    raw_event: req.body,
  });

  if (error) throw error;
  res.json({ ok: true });
});

function buildOutboundMessage(machineTitle) {
  return `Moikka! Sulla oli Nettikoneessa ${machineTitle || 'kone'} myynnissä. Onko se edelleen kaupan?`;
}

async function loadListing(supabase, { listing_id, nettikone_id }) {
  if (!listing_id && !nettikone_id) {
    const error = new Error('nettikone_id or listing_id is required');
    error.status = 400;
    throw error;
  }

  const query = supabase.from('nordkone_listings').select('*').eq('client_key', CLIENT_KEY);
  const { data, error } = listing_id
    ? await query.eq('id', listing_id).single()
    : await query.eq('nettikone_id', nettikone_id).single();

  if (error) throw error;
  return data;
}

async function loadExistingSession(supabase, nettikoneId) {
  const { data, error } = await supabase
    .from('campaign_outbound_sessions')
    .select('*')
    .eq('client_key', CLIENT_KEY)
    .eq('source_system', SOURCE_SYSTEM)
    .eq('source_customer_id', nettikoneId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function countListings(supabase, { status, hasPhone, phoneSource } = {}) {
  let query = supabase
    .from('nordkone_listings')
    .select('id', { count: 'exact', head: true })
    .eq('client_key', CLIENT_KEY);

  if (status) query = query.eq('status', status);
  if (phoneSource) query = query.eq('phone_source', phoneSource);
  if (hasPhone) query = query.not('normalized_phone', 'is', null);

  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function countSessions(supabase, { replied, interestStatus, sentSince } = {}) {
  let query = supabase
    .from('campaign_outbound_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('client_key', CLIENT_KEY)
    .eq('source_system', SOURCE_SYSTEM);

  if (replied) query = query.not('last_inbound_at', 'is', null);
  if (interestStatus) query = query.eq('interest_status', interestStatus);
  if (sentSince) query = query.gte('last_outbound_at', sentSince);

  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function loadCampaignConfig(supabase) {
  const { data, error } = await supabase
    .from('campaign_client_config')
    .select('outbound_enabled,daily_cap,campaign_name')
    .eq('client_key', CLIENT_KEY)
    .maybeSingle();

  if (error) throw error;
  return data || { outbound_enabled: false, daily_cap: 0, campaign_name: CAMPAIGN_NAME };
}

function startOfTodayIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function applyStatusFilter(query, status) {
  if (!status || status === 'all') return query;
  if (status === 'eligible') return query.eq('status', 'eligible').not('normalized_phone', 'is', null);
  if (status === 'replied') return query.in('status', ['replied', 'interested', 'sold', 'not_interested', 'opted_out', 'needs_human']);
  return query.eq('status', status);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function escapeLike(value) {
  return value.replace(/[%_]/g, (match) => `\\${match}`);
}

export default router;
