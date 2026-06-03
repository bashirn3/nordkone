-- NordKone migration for the existing shared campaign schema.
--
-- This intentionally does not recreate, drop, or replace any Nordicshape/shared
-- campaign objects. The shared campaign tables stay responsible for client
-- config, seller/prospect records, outbound sessions, and message status.
--
-- NordKone's Nettikone ads are many-listings-per-seller, so the listing layer
-- lives in a separate domain table: public.nordkone_listings.

insert into public.campaign_client_config (
  client_key,
  display_name,
  campaign_name,
  source_system,
  outbound_enabled,
  daily_cap
)
values (
  'nordkone',
  'NordKone',
  'nordkone-nettikone-seller-check',
  'nettikone',
  false,
  20
)
on conflict (client_key) do nothing;

create table if not exists public.nordkone_listings (
  id bigserial primary key,
  client_key text not null references public.campaign_client_config(client_key) on delete cascade,
  prospect_id bigint references public.campaign_prospects(id) on delete set null,
  nettikone_id text not null,
  listing_url text not null,
  canonical_url text,
  machine_title text not null,
  subtitle text,
  listing_type text,
  department text,
  category text,
  price_text text,
  price_eur numeric,
  vat_text text,
  location text,
  region text,
  model_year integer,
  operating_hours integer,
  registration_number text,
  updated_label text,
  seller_name text,
  seller_type text,
  description text,
  description_phone text,
  contact_phone text,
  selected_phone text,
  normalized_phone text,
  phone_source text
    check (phone_source in ('description', 'revealed_contact', 'missing')),
  status text not null default 'eligible'
    check (status in (
      'eligible',
      'contacted',
      'replied',
      'interested',
      'sold',
      'not_interested',
      'opted_out',
      'needs_human',
      'ignored'
    )),
  ineligible_reason text,
  raw_data jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists nordkone_listings_source_idx
  on public.nordkone_listings (client_key, nettikone_id);

create index if not exists nordkone_listings_prospect_idx
  on public.nordkone_listings (client_key, prospect_id);

create index if not exists nordkone_listings_status_idx
  on public.nordkone_listings (client_key, status, last_seen_at desc);

create index if not exists nordkone_listings_phone_idx
  on public.nordkone_listings (client_key, normalized_phone)
  where normalized_phone is not null and normalized_phone <> '';

create index if not exists nordkone_listings_phone_source_idx
  on public.nordkone_listings (client_key, phone_source);

-- Add only nullable/default metadata used by NordKone API responses. These are
-- additive and do not change Nordicshape uniqueness, views, or existing rows.
alter table public.campaign_prospects add column if not exists interest_status text;

alter table public.campaign_outbound_sessions add column if not exists message text;
alter table public.campaign_outbound_sessions add column if not exists provider text default 'wasup';
alter table public.campaign_outbound_sessions add column if not exists status text default 'contacted';
alter table public.campaign_outbound_sessions add column if not exists interest_status text;

alter table public.campaign_message_status add column if not exists session_id bigint;
alter table public.campaign_message_status add column if not exists source_customer_id text;

create table if not exists public.campaign_inbound_events (
  id bigserial primary key,
  client_key text not null references public.campaign_client_config(client_key) on delete cascade,
  session_id bigint references public.campaign_outbound_sessions(id) on delete set null,
  prospect_id bigint references public.campaign_prospects(id) on delete set null,
  source_system text not null default 'manual',
  source_customer_id text,
  number text not null,
  message text not null,
  classification text not null default 'unclear'
    check (classification in ('interested', 'sold', 'not_interested', 'unclear', 'needs_human', 'opted_out')),
  needs_human boolean not null default false,
  raw_event jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists campaign_inbound_events_number_idx
  on public.campaign_inbound_events (client_key, number, received_at desc);
