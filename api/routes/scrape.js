import { Router } from 'express';
import { runScrape } from '../../scripts/scrape-nettikone.js';

const router = Router();

router.get('/run', run);
router.post('/run', run);

async function run(req, res) {
  const targetNew = clamp(
    Number(req.query.targetNew || req.query.target_new || req.body?.targetNew || process.env.SCRAPE_TARGET_NEW || 10),
    1,
    50
  );
  const maxPages = clamp(
    Number(
      req.query.maxPages ||
        req.query.max_pages ||
        req.query.pages ||
        req.body?.maxPages ||
        process.env.SCRAPE_MAX_PAGES ||
        20
    ),
    1,
    50
  );
  const maxListings = clamp(
    Number(
      req.query.maxListings ||
        req.query.max_listings ||
        req.query.limit ||
        req.body?.maxListings ||
        process.env.SCRAPE_MAX_LISTINGS ||
        Math.max(targetNew * 3, 20)
    ),
    targetNew,
    100
  );
  const category = String(req.query.category || req.body?.category || process.env.NETTIKONE_DEFAULT_CATEGORY || 'kaivinkone');
  const postedBy = String(req.query.posted_by || req.query.postedBy || req.body?.postedBy || process.env.NETTIKONE_DEFAULT_POSTED_BY || 'S');

  const stats = await runScrape({
    category,
    postedBy,
    targetNew,
    maxPages,
    maxListings,
  });

  res.json({
    ok: true,
    category,
    postedBy,
    targetNew,
    maxPages,
    maxListings,
    stats,
  });
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export default router;
