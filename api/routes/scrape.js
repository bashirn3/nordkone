import { Router } from 'express';
import { runScrape } from '../../scripts/scrape-nettikone.js';

const router = Router();

router.get('/run', run);
router.post('/run', run);

async function run(req, res) {
  const limit = clamp(Number(req.query.limit || req.body?.limit || process.env.SCRAPE_CRON_LIMIT || 10), 1, 50);
  const pages = clamp(Number(req.query.pages || req.body?.pages || process.env.SCRAPE_CRON_PAGES || 1), 1, 3);
  const category = String(req.query.category || req.body?.category || process.env.NETTIKONE_DEFAULT_CATEGORY || 'kaivinkone');
  const postedBy = String(req.query.posted_by || req.query.postedBy || req.body?.postedBy || process.env.NETTIKONE_DEFAULT_POSTED_BY || 'S');

  const stats = await runScrape({
    category,
    postedBy,
    pages,
    limit,
  });

  res.json({
    ok: true,
    category,
    postedBy,
    pages,
    limit,
    stats,
  });
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export default router;
