import { Router } from 'express';
import { createSupabase } from '../lib/supabase.js';
import { CLIENT_KEY } from '../lib/campaign.js';

const router = Router();

router.get('/', async (_req, res) => {
  const supabase = createSupabase();
  const { data, error } = await supabase
    .from('campaign_client_config')
    .select('*')
    .eq('client_key', CLIENT_KEY)
    .maybeSingle();

  if (error) throw error;
  res.json({ settings: data || null });
});

router.put('/', async (req, res) => {
  const supabase = createSupabase();
  const allowed = ['outbound_enabled', 'daily_cap', 'campaign_name'];
  const input = req.body?.settings || req.body || {};
  const updates = Object.fromEntries(
    Object.entries(input).filter(([key]) => allowed.includes(key))
  );

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No supported settings provided' });
  }

  const { error } = await supabase
    .from('campaign_client_config')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('client_key', CLIENT_KEY);

  if (error) throw error;
  res.json({ ok: true });
});

export default router;
