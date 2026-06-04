#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import * as cheerio from 'cheerio';
import { firstValidPhone, extractPhoneCandidates } from '../api/lib/phone.js';
import { createSupabase, hasSupabaseConfig } from '../api/lib/supabase.js';
import { CLIENT_KEY, SOURCE_SYSTEM } from '../api/lib/campaign.js';

dotenv.config({ override: true });

const BASE_URL = process.env.NETTIKONE_BASE_URL || 'https://www.nettikone.com';
const DEFAULT_CATEGORY = process.env.NETTIKONE_DEFAULT_CATEGORY || 'kaivinkone';
const DEFAULT_POSTED_BY = process.env.NETTIKONE_DEFAULT_POSTED_BY || 'S';
const REQUEST_DELAY_MS = Number(process.env.NETTIKONE_REQUEST_DELAY_MS || 750);
const USER_AGENT =
  process.env.NETTIKONE_USER_AGENT ||
  'Mozilla/5.0 NordKoneLeadBot/0.1 (+https://nordkone.fi)';

const cookieJar = new Map();

export async function runScrape(options = {}) {
  cookieJar.clear();

  const dryRun = Boolean(options.dryRun || options['dry-run']);
  const targetNewLeads = positiveNumber(
    options.targetNew || options.target_new || options['target-new'] || options.limit,
    10
  );
  const maxPages = positiveNumber(
    options.maxPages || options.max_pages || options['max-pages'] || options.pages,
    20
  );
  const maxListings = positiveNumber(
    options.maxListings || options.max_listings || options['max-listings'],
    Math.max(targetNewLeads * 3, targetNewLeads)
  );
  const refreshExisting = Boolean(options.refreshExisting || options.refresh_existing || options['refresh-existing']);
  const category = options.category || DEFAULT_CATEGORY;
  const postedBy = options.postedBy || options['posted-by'] || DEFAULT_POSTED_BY;
  const startUrl = options.url || buildSearchUrl({ category, postedBy, page: 1 });
  const supabase = !dryRun && hasSupabaseConfig() ? createSupabase() : null;
  const seenUrls = new Set();
  const stats = {
    target_new_leads: targetNewLeads,
    max_pages: maxPages,
    max_listings: maxListings,
    pages_scanned: 0,
    discovered: 0,
    processed: 0,
    upserted: 0,
    new_listings: 0,
    existing_listings: 0,
    new_leads: 0,
    existing_prospects: 0,
    new_prospects: 0,
    skipped: 0,
    failed: 0,
    stop_reason: null,
  };

  for (let page = 1; page <= maxPages; page += 1) {
    const listingUrls = await discoverListingUrlsForPage({
      page,
      category,
      postedBy,
      startUrl,
      hasCustomUrl: Boolean(options.url),
    });
    stats.pages_scanned += 1;

    if (!listingUrls.length) {
      stats.stop_reason = 'no_results';
      break;
    }

    for (const url of listingUrls) {
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);
      stats.discovered += 1;

      if (stats.processed >= maxListings) {
        stats.stop_reason = 'max_listings_reached';
        break;
      }

      try {
        const nettikoneId = extractNettikoneId(url);
        const existing = supabase && nettikoneId ? await loadExistingListing(supabase, nettikoneId) : null;

        if (existing && !refreshExisting) {
          stats.existing_listings += 1;
          continue;
        }

        await sleep(REQUEST_DELAY_MS);
        const listing = await scrapeListing(url, { category });
        stats.processed += 1;

        if (!listing.normalized_phone) {
          stats.skipped += 1;
        }

        if (supabase) {
          const result = await upsertListing(supabase, listing, { existing });
          stats.upserted += 1;
          if (result.isNewListing) stats.new_listings += 1;
          if (result.isNewProspect) stats.new_prospects += 1;
          if (result.isExistingProspect) stats.existing_prospects += 1;
          if (result.isNewListing && listing.normalized_phone) stats.new_leads += 1;
        } else {
          console.log(JSON.stringify(listingSummary(listing), null, 2));
          if (listing.normalized_phone) stats.new_leads += 1;
        }

        if (stats.new_leads >= targetNewLeads) {
          stats.stop_reason = 'target_new_leads_reached';
          break;
        }
      } catch (error) {
        stats.failed += 1;
        console.error(`Failed ${url}: ${error.message}`);
      }
    }

    if (stats.stop_reason) break;
    await sleep(REQUEST_DELAY_MS);
  }

  if (!stats.stop_reason) {
    if (stats.new_leads >= targetNewLeads) {
      stats.stop_reason = 'target_new_leads_reached';
    } else if (stats.processed >= maxListings) {
      stats.stop_reason = 'max_listings_reached';
    } else {
      stats.stop_reason = 'max_pages_reached';
    }
  }

  return stats;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stats = await runScrape(args);
  console.log(`Done: ${JSON.stringify(stats)}`);
}

async function discoverListingUrls({ pages, category, postedBy, startUrl, hasCustomUrl }) {
  const urls = new Set();

  for (let page = 1; page <= pages; page += 1) {
    for (const url of await discoverListingUrlsForPage({ page, category, postedBy, startUrl, hasCustomUrl })) {
      urls.add(url);
    }
  }

  return [...urls];
}

async function discoverListingUrlsForPage({ page, category, postedBy, startUrl, hasCustomUrl }) {
  const urls = new Set();
  const rootUrl = new URL(startUrl, BASE_URL);
  const pageUrl = hasCustomUrl
    ? page === 1
      ? rootUrl.toString()
      : withPage(rootUrl, page)
    : buildSearchUrl({ category, postedBy, page });

  console.log(`Discovering ${pageUrl}`);
  const html = await fetchText(pageUrl);
  const $ = cheerio.load(html);

  $('a[href]').each((_, link) => {
    const href = $(link).attr('href');
    const normalized = normalizeListingUrl(href);
    if (normalized) urls.add(normalized);
  });

  return [...urls];
}

async function scrapeListing(url, { category }) {
  const html = await fetchText(url);
  const $ = cheerio.load(html);
  const canonicalUrl = $('link[rel="canonical"]').attr('href') || url;
  const nettikoneId = extractNettikoneId(canonicalUrl) || extractNettikoneId(url);

  if (!nettikoneId) {
    throw new Error('Could not extract Nettikone ID');
  }

  const title = cleanText(
    $('h1').first().text() ||
      $('[data-testid="ad-title"]').first().text() ||
      $('title').first().text()
  );
  const subtitle = cleanText($('.subtitle, .ad-subtitle, h2').first().text());
  const description = extractDescription($);
  const descriptionPhone = firstValidPhone(extractPhoneCandidates(description));
  const contactPhone = extractContactPhone($);
  const selectedPhone = descriptionPhone || contactPhone;
  const facts = extractFacts($);
  const priceText = cleanPriceText(facts.Hinta) || extractPriceText($);

  return {
    nettikone_id: nettikoneId,
    listing_url: url,
    canonical_url: canonicalUrl,
    machine_title: title || `Nettikone ${nettikoneId}`,
    subtitle,
    listing_type: facts['Ilmoitustyyppi'] || facts['Tyyppi'] || null,
    department: facts.Osasto || null,
    category: facts.Kategoria || category || null,
    price_text: priceText,
    price_eur: parseEuro(priceText),
    vat_text: facts.ALv || facts.ALV || null,
    location: facts.Sijainti || facts.Paikkakunta || extractLocation($),
    region: facts.Maakunta || null,
    model_year: parseInteger(facts.Vuosimalli),
    operating_hours: parseInteger(facts.Kayttotunnit || facts['Käyttötunnit']),
    registration_number: facts.Rekisterinumero || null,
    updated_label: facts.Paivitetty || facts['Päivitetty'] || null,
    seller_name: extractSellerName($),
    seller_type: facts.Myyja || facts.Myyjä || null,
    description,
    description_phone: descriptionPhone?.raw || null,
    contact_phone: contactPhone?.raw || null,
    selected_phone: selectedPhone?.raw || null,
    normalized_phone: selectedPhone?.normalized || null,
    phone_source: descriptionPhone ? 'description' : contactPhone ? 'revealed_contact' : 'missing',
    ineligible_reason: selectedPhone ? null : 'missing_phone',
    raw_data: {
      facts,
      scrape_url: url,
      scraped_at: new Date().toISOString(),
    },
  };
}

async function upsertListing(supabase, listing, { existing } = {}) {
  const prospect = listing.normalized_phone ? await upsertSellerProspect(supabase, listing) : null;
  const existingListing = existing || (await loadExistingListing(supabase, listing.nettikone_id));

  const { error } = await supabase.from('nordkone_listings').upsert(
    toNordKoneListing(listing, {
      prospectId: prospect?.row?.id || existingListing?.prospect_id || null,
      existing: existingListing,
    }),
    { onConflict: 'client_key,nettikone_id' }
  );

  if (error) throw error;

  return {
    isNewListing: !existingListing,
    isNewProspect: Boolean(prospect?.isNew),
    isExistingProspect: Boolean(prospect && !prospect.isNew),
  };
}

async function upsertSellerProspect(supabase, listing) {
  const payload = toCampaignProspect(listing);
  const { data: existing, error: existingError } = await supabase
    .from('campaign_prospects')
    .select('id,status')
    .eq('client_key', CLIENT_KEY)
    .eq('source_customer_id', payload.source_customer_id)
    .maybeSingle();

  if (existingError) throw existingError;

  if (existing) {
    const { data, error } = await supabase
      .from('campaign_prospects')
      .update({
        ...payload,
        status: existing.status || 'pending',
      })
      .eq('id', existing.id)
      .eq('client_key', CLIENT_KEY)
      .select()
      .single();

    if (error) throw error;
    return { row: data, isNew: false };
  }

  const { data, error } = await supabase
    .from('campaign_prospects')
    .insert({
      ...payload,
      status: 'pending',
    })
    .select()
    .single();

  if (error) throw error;
  return { row: data, isNew: true };
}

async function loadExistingListing(supabase, nettikoneId) {
  const { data, error } = await supabase
    .from('nordkone_listings')
    .select('id,prospect_id,status,first_seen_at')
    .eq('client_key', CLIENT_KEY)
    .eq('nettikone_id', nettikoneId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

function toCampaignProspect(listing) {
  const now = new Date().toISOString();

  return {
    client_key: CLIENT_KEY,
    source_system: SOURCE_SYSTEM,
    source_customer_id: sellerSourceId(listing.normalized_phone),
    phone: listing.selected_phone,
    normalized_phone: listing.normalized_phone,
    eligible: Boolean(listing.normalized_phone),
    ineligible_reason: listing.ineligible_reason,
    source_updated_at: now,
    raw_data: {
      source: 'nettikone',
      last_listing_id: listing.nettikone_id,
      last_listing_url: listing.listing_url,
      seller_name: listing.seller_name,
      seller_type: listing.seller_type,
    },
    updated_at: now,
  };
}

function toNordKoneListing(listing, { prospectId, existing }) {
  const now = new Date().toISOString();

  return {
    client_key: CLIENT_KEY,
    prospect_id: prospectId,
    nettikone_id: listing.nettikone_id,
    listing_url: listing.listing_url,
    canonical_url: listing.canonical_url,
    machine_title: listing.machine_title,
    subtitle: listing.subtitle,
    listing_type: listing.listing_type,
    department: listing.department,
    category: listing.category,
    price_text: listing.price_text,
    price_eur: listing.price_eur,
    vat_text: listing.vat_text,
    location: listing.location,
    region: listing.region,
    model_year: listing.model_year,
    operating_hours: listing.operating_hours,
    registration_number: listing.registration_number,
    updated_label: listing.updated_label,
    seller_name: listing.seller_name,
    seller_type: listing.seller_type,
    description: listing.description,
    description_phone: listing.description_phone,
    contact_phone: listing.contact_phone,
    selected_phone: listing.selected_phone,
    normalized_phone: listing.normalized_phone,
    phone_source: listing.phone_source,
    status: existing?.status || (listing.normalized_phone ? 'eligible' : 'ignored'),
    ineligible_reason: listing.ineligible_reason,
    raw_data: listing.raw_data,
    first_seen_at: existing?.first_seen_at || now,
    last_seen_at: now,
    updated_at: now,
  };
}

function sellerSourceId(normalizedPhone) {
  return `nettikone:seller:${String(normalizedPhone).replace(/[^\d]/g, '')}`;
}

function extractDescription($) {
  const direct = cleanText(
    $(
      '#shortNote, #description, .description, .ad-description, .listing-description, [itemprop="description"]'
    )
      .first()
      .text()
  );
  if (direct) return direct;

  const heading = $('*:contains("Lisätiedot")')
    .filter((_, el) => cleanText($(el).text()) === 'Lisätiedot')
    .first();
  const nearby = cleanText(heading.next().text() || heading.parent().next().text());

  return nearby || '';
}

function extractContactPhone($) {
  const candidates = [];

  $('[data-phone], [data-mobile], [data-number], [data-tel]').each((_, el) => {
    for (const key of ['phone', 'mobile', 'number', 'tel']) {
      const value = $(el).attr(`data-${key}`);
      if (value) candidates.push(value, decodeMaybeBase64(value));
    }
  });

  $('a[href^="tel:"]').each((_, el) => {
    candidates.push($(el).attr('href').replace(/^tel:/i, ''));
  });

  // Some Nettikone pages include encoded numbers inside scripts.
  const scripts = $('script')
    .map((_, el) => $(el).html() || '')
    .get()
    .join('\n');
  const encodedValues = scripts.match(/(?:data-phone|phone|mobile)["']?\s*[:=]\s*["']([^"']{8,80})["']/gi) || [];
  for (const value of encodedValues) {
    const [, raw] = value.match(/["']([^"']+)["']$/) || [];
    if (raw) candidates.push(raw, decodeMaybeBase64(raw));
  }

  return firstValidPhone(candidates);
}

function extractFacts($) {
  const facts = {};

  $('tr').each((_, el) => {
    const cells = $(el)
      .children('th, td')
      .map((__, cell) => cleanText($(cell).text()))
      .get()
      .filter(Boolean);

    addFactPairs(facts, cells);
  });

  $('dl').each((_, el) => {
    const cells = $(el)
      .children('dt, dd')
      .map((__, cell) => cleanText($(cell).text()))
      .get()
      .filter(Boolean);

    addFactPairs(facts, cells);
  });

  $('.detail-row, .vehicle-data-row').each((_, el) => {
    const labels = $(el)
      .find('.label, [class*="label"], [class*="Label"]')
      .map((__, cell) => cleanText($(cell).text()))
      .get()
      .filter(Boolean);
    const values = $(el)
      .find('.value, [class*="value"], [class*="Value"]')
      .map((__, cell) => cleanText($(cell).text()))
      .get()
      .filter(Boolean);

    labels.forEach((label, index) => addFact(facts, label, values[index]));
  });

  $('[class*="label"], [class*="Label"]').each((_, el) => {
    const key = normalizeFactKey($(el).text());
    const value = cleanText($(el).next().text());
    addFact(facts, key, value);
  });

  return facts;
}

function addFactPairs(facts, cells) {
  for (let index = 0; index < cells.length - 1; index += 2) {
    addFact(facts, cells[index], cells[index + 1]);
  }
}

function addFact(facts, rawKey, rawValue) {
  const key = normalizeFactKey(rawKey);
  const value = cleanFactValue(rawValue);

  if (!key || !value || facts[key]) return;
  if (!isUsefulFactKey(key)) return;

  facts[key] = value;
}

function normalizeListingUrl(href) {
  if (!href) return null;

  let url;
  try {
    url = new URL(href, BASE_URL);
  } catch {
    return null;
  }

  if (url.hostname !== new URL(BASE_URL).hostname) return null;
  if (!/\/[a-z0-9-]+\/[a-z0-9-]+\/\d{5,}/i.test(url.pathname)) return null;

  url.search = '';
  url.hash = '';
  return url.toString();
}

function extractNettikoneId(value) {
  const match = String(value || '').match(/\/(\d{5,})(?:[/?#]|$)/);
  return match?.[1] || null;
}

function extractPriceText($) {
  const visiblePrice = cleanPriceText($('.GAPrice').first().text());
  if (visiblePrice) return visiblePrice;

  const textRoot = $('body').clone();
  textRoot.find('script, style, select, option').remove();
  const text = cleanText(textRoot.text());
  const match = text.match(/\b\d[\d\s.,]*(?:€|EUR)/i);
  return match?.[0] || null;
}

function extractLocation($) {
  const text = cleanText($('.location, [class*="location"], [class*="Location"]').first().text());
  return text || null;
}

function extractSellerName($) {
  const selectors = [
    '.seller-name',
    '.contact-name',
    '[class*="seller"] h3',
    '[class*="Seller"] h3',
    '[class*="contact"] h3',
  ];

  for (const selector of selectors) {
    const value = cleanText($(selector).first().text());
    if (value) return value;
  }

  return null;
}

function buildSearchUrl({ category, postedBy, page }) {
  const url = new URL(`/${category}`, BASE_URL);
  if (postedBy) url.searchParams.set('posted_by', postedBy);
  if (page > 1) url.searchParams.set('page', String(page));
  return url.toString();
}

function withPage(url, page) {
  const next = new URL(url.toString());
  next.searchParams.set('page', String(page));
  return next.toString();
}

async function fetchText(url, redirectCount = 0) {
  if (redirectCount > 8) throw new Error(`Too many redirects for ${url}`);

  const response = await fetch(url, {
    redirect: 'manual',
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml',
      cookie: cookieHeader(),
    },
  });

  storeCookies(response.headers);

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('location');
    if (!location) throw new Error(`Redirect without location for ${url}`);
    return fetchText(new URL(location, url).toString(), redirectCount + 1);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function storeCookies(headers) {
  const values =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : headers.get('set-cookie')
        ? [headers.get('set-cookie')]
        : [];

  for (const header of values) {
    const [pair] = String(header).split(';');
    const [name, value] = pair.split('=');
    if (name && value) cookieJar.set(name.trim(), value.trim());
  }
}

function cookieHeader() {
  return [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function decodeMaybeBase64(value) {
  try {
    const decoded = Buffer.from(String(value), 'base64').toString('utf8');
    return /(?:\+358|00358|0)\d/.test(decoded.replace(/\s/g, '')) ? decoded : value;
  } catch {
    return value;
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) continue;

    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.floor(number);
}

function parseEuro(value) {
  const match = String(value || '').match(/\d[\d\s.,]*/);
  if (!match) return null;
  const normalized = match[0].replace(/\s/g, '').replace(',', '.');
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function parseInteger(value) {
  const match = String(value || '').match(/\d[\d\s.]*/);
  if (!match) return null;
  const amount = Number(match[0].replace(/[^\d]/g, ''));
  return Number.isFinite(amount) ? amount : null;
}

function normalizeFactKey(value) {
  return cleanText(value).replace(/:$/, '');
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanFactValue(value) {
  const text = cleanText(value);
  if (!text || text.length > 180) return null;
  return text;
}

function isUsefulFactKey(key) {
  return new Set([
    'Hinta',
    'Veroton hinta',
    'ALV',
    'ALv',
    'Sijainti',
    'Paikkakunta',
    'Maakunta',
    'Vuosimalli',
    'Käyttötunnit',
    'Kayttotunnit',
    'Rekisterinumero',
    'Päivitetty',
    'Paivitetty',
    'Ilmoitustyyppi',
    'Tyyppi',
    'Osasto',
    'Kategoria',
    'Myyjä',
    'Myyja',
  ]).has(key);
}

function cleanPriceText(value) {
  const match = String(value || '').match(/\b\d[\d\s.,]*(?:€|EUR)/i);
  return match?.[0]?.trim() || null;
}

function listingSummary(listing) {
  return {
    nettikone_id: listing.nettikone_id,
    machine_title: listing.machine_title,
    price_text: listing.price_text,
    location: listing.location,
    phone_source: listing.phone_source,
    selected_phone: listing.selected_phone,
    normalized_phone: listing.normalized_phone,
    listing_url: listing.listing_url,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
