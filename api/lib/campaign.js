export const CLIENT_KEY =
  process.env.CAMPAIGN_CLIENT_KEY || process.env.NORDKONE_CLIENT_KEY || 'nordkone';

export const SOURCE_SYSTEM = 'nettikone';

export const CAMPAIGN_NAME =
  process.env.CAMPAIGN_NAME || 'nordkone-nettikone-seller-check';

export function listingRowToResponse(row = {}) {
  return {
    id: row.id,
    client_key: row.client_key,
    prospect_id: row.prospect_id,
    source_customer_id: row.nettikone_id,
    nettikone_id: row.nettikone_id,
    listing_url: row.listing_url,
    canonical_url: row.canonical_url || row.listing_url,
    machine_title: row.machine_title || row.nettikone_id,
    subtitle: row.subtitle,
    listing_type: row.listing_type,
    department: row.department,
    category: row.category,
    price_text: row.price_text,
    price_eur: row.price_eur,
    vat_text: row.vat_text,
    location: row.location,
    region: row.region,
    model_year: row.model_year,
    operating_hours: row.operating_hours,
    registration_number: row.registration_number,
    seller_name: row.seller_name,
    seller_type: row.seller_type,
    description: row.description,
    description_phone: row.description_phone,
    contact_phone: row.contact_phone,
    selected_phone: row.selected_phone,
    normalized_phone: row.normalized_phone,
    phone_source: row.phone_source || 'missing',
    status: row.status || 'eligible',
    interest_status: listingInterestStatus(row.status),
    eligible: row.status === 'eligible',
    ineligible_reason: row.ineligible_reason,
    raw_data: row.raw_data || {},
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at || row.updated_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function listingInterestStatus(status) {
  if (['interested', 'sold', 'not_interested', 'needs_human', 'opted_out'].includes(status)) {
    return status;
  }

  return null;
}
