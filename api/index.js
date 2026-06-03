import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import listingsRouter from './routes/listings.js';
import settingsRouter from './routes/settings.js';
import webhooksRouter from './routes/webhooks.js';
import scrapeRouter from './routes/scrape.js';
import { hasSupabaseConfig } from './lib/supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', optionalApiKey);

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      supabaseConfigured: hasSupabaseConfig(),
      service: 'nordkone-leads',
    });
  });

  app.use('/api', listingsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/webhooks', webhooksRouter);
  app.use('/api/scrape', scrapeRouter);

  const distDir = path.join(rootDir, 'dist');
  app.use(express.static(distDir));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();

    res.sendFile(path.join(distDir, 'index.html'), (error) => {
      if (error) next();
    });
  });

  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(error.status || 500).json({
      error: error.message || 'Internal server error',
    });
  });

  return app;
}

function optionalApiKey(req, res, next) {
  const expected = process.env.API_KEY;
  const cronSecret = process.env.CRON_SECRET;
  if (!expected && !cronSecret) return next();

  const actual = req.get('x-api-key');
  const authorization = req.get('authorization');
  const cronAuthorized = cronSecret && authorization === `Bearer ${cronSecret}`;
  const apiAuthorized = expected && actual === expected;

  if (!apiAuthorized && !cronAuthorized) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  return next();
}

export default createApp();
