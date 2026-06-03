# NordKone Leads

Lead engine for NordKone's Nettikone outreach.

The project scrapes Nettikone machinery listings into `nordkone_listings` and
uses the shared `campaign_*` Supabase tables for seller/prospect records,
outbound sessions, and message status. This keeps Nordicshape's shared campaign
schema intact while giving NordKone a listing table for its different data shape.

## Flow

1. Scrape Nettikone category/search pages.
2. For each listing, store the Nettikone ID, URL, title, price, location, and
   contact phone in `nordkone_listings`.
3. Choose phone with strict priority:
   - phone in `Lisätiedot` / description first
   - otherwise decoded `data-phone` / `data-mobile` from the `Näytä numero` contact block
4. Send:

```text
Moikka! Sulla oli Nettikoneessa MACHINE myynnissä. Onko se edelleen kaupan?
```

5. Inbound replies are classified into `interested`, `sold`, `not_interested`,
   `opted_out`, or `needs_human`.

## Setup

Apply `db/schema.sql` in Supabase, then:

```bash
cp .env.example .env
npm install
npm run dev
```

Run a safe scraper sample without database writes:

```bash
npm run scrape:sample
```

Run a real scrape after Supabase is configured:

```bash
npm run scrape -- --category kaivinkone --posted-by S --pages 2
```

## Vercel

The dashboard/API can be deployed to Vercel. Set these environment variables in
the Vercel project:

- `API_KEY`
- `CRON_SECRET`
- `CAMPAIGN_CLIENT_KEY=nordkone`
- `CAMPAIGN_NAME=nordkone-nettikone-seller-check`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NETTIKONE_BASE_URL=https://www.nettikone.com`
- `NETTIKONE_DEFAULT_CATEGORY=kaivinkone`
- `NETTIKONE_DEFAULT_POSTED_BY=S`
- `NETTIKONE_REQUEST_DELAY_MS=750`
- `SCRAPE_CRON_LIMIT=10`
- `SCRAPE_CRON_PAGES=1`
- `VITE_API_KEY` with the same value as `API_KEY`

`vercel.json` runs a conservative daily scrape at `06:00 UTC` through:

```text
/api/scrape/run?limit=10&pages=1
```

You can manually trigger a protected scrape:

```bash
curl -H "X-API-Key: $API_KEY" \
  "https://YOUR-VERCEL-URL/api/scrape/run?limit=10&pages=1"
```

## Data Model

NordKone shares the campaign lifecycle tables with Nordicshape, but keeps
Nettikone ads in a separate listing table:

- `campaign_client_config`: one row for `client_key = 'nordkone'`
- `campaign_prospects`: seller/contact records, one per seller phone where possible
- `nordkone_listings`: machine listings, one row per Nettikone ID
- `campaign_outbound_sessions`: WhatsApp outreach sessions, with `source_customer_id`
  set to the Nettikone listing ID
- `campaign_message_status`: Wasup delivery/status events
- `campaign_inbound_events`: seller replies and classifications

The stable listing identifier is `nordkone_listings.nettikone_id`. The seller
identifier in `campaign_prospects.source_customer_id` is phone-based, so multiple
listings from the same seller can link to the same prospect without changing the
Nordicshape unique phone behavior.

## Important IDs

Agent Builder currently has the best matching workspace:

- Project: `Nordkone2`
- Project ID: `072a2d5c-3158-4a45-a6bf-e353ef7817a5`
- Agent ID: `ec5975b7-34c2-47ba-af0f-7caf75eda170`
- Locked first message: `Moikka! Sulla oli Nettikoneessa MACHINE myynnissä. Onko se edelleen kaupan?`

## n8n Workflow Templates

The workflows are template files in this repo, not imported into n8n yet:

- `n8n-workflows/nordkone-wf-1-outbound.template.json`
- `n8n-workflows/nordkone-wf-2-inbound.template.json`

Import them into n8n manually and keep them inactive until one manual outbound
test succeeds.

WF-1 is guarded by `campaign_client_config.outbound_enabled` and `daily_cap`.
Use the dashboard controls to activate/pause outbound and adjust the cap. For the
first test, fill `testRecipientPhone` in the WF-1 `Workflow Config` node with
your own number; clear it before launch so real seller numbers are used.

## Compliance Note

Nettikone's `robots.txt` allows normal listing paths but includes a rights
reservation against text/data mining. Treat scraping volume, purpose, and API
access as a business/compliance decision. Nettix also offers a business REST API
for marketplace ads; if NordKone can obtain API credentials, prefer that for
listing metadata.
