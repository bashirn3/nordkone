import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { apiGet } from './lib/api.js';
import './styles.css';

const STATUS_OPTIONS = [
  ['all', 'All'],
  ['eligible', 'Eligible'],
  ['contacted', 'Contacted'],
  ['replied', 'Replied'],
  ['interested', 'Interested'],
  ['sold', 'Sold'],
  ['not_interested', 'Not interested'],
  ['opted_out', 'Opted out'],
  ['needs_human', 'Needs human'],
];

function App() {
  const [summary, setSummary] = useState(null);
  const [listings, setListings] = useState([]);
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ status, limit: '100' });
      if (q.trim()) params.set('q', q.trim());
      const [summaryData, listingData] = await Promise.all([
        apiGet('/api/summary'),
        apiGet(`/api/listings?${params.toString()}`),
      ]);

      setSummary(summaryData);
      setListings(listingData.listings || []);
      setSelected((current) => current || listingData.listings?.[0] || null);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [status]);

  const cards = useMemo(
    () => [
      {
        label: 'Ready to contact',
        value: summary?.eligible_prospects || summary?.eligible || 0,
        hint: 'Listings with usable seller phone',
        tone: 'primary',
      },
      {
        label: 'Contacted',
        value: summary?.contacted || summary?.contacted_listings || 0,
        hint: 'WhatsApp sessions opened',
        tone: 'neutral',
      },
      {
        label: 'Replies',
        value: summary?.replied || 0,
        hint: 'Inbound seller responses',
        tone: 'neutral',
      },
      {
        label: 'Interested',
        value: summary?.interested || summary?.interested_listings || 0,
        hint: 'Hand-off candidates',
        tone: 'success',
      },
      {
        label: 'Needs human',
        value: summary?.needs_human || 0,
        hint: 'Unclear or valuable replies',
        tone: 'warning',
      },
      {
        label: 'Lisätiedot phones',
        value: summary?.description_phone_count || 0,
        hint: 'Preferred source captured',
        tone: 'source',
      },
    ],
    [summary]
  );

  const selectedMessage = selected
    ? `Moikka! Sulla oli Nettikoneessa ${selected.machine_title} myynnissä. Onko se edelleen kaupan?`
    : '';

  return (
    <main className="shell">
      <header className="hero">
        <div className="hero-copy">
          <div className="brand-row">
            <span className="brand-mark">NK</span>
          </div>
          <h1>Nettikone Lead Desk</h1>
          <p>
            Machinery listings are scraped, matched to seller phones, and staged
            for careful WhatsApp outreach before the human team steps in.
          </p>
          <div className="hero-meta">
            <span>Source: Nettikone</span>
            <span>Client: nordkone</span>
            <span>{listings.length} rows loaded</span>
          </div>
        </div>
        <div className="hero-action">
          <button onClick={load} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh desk'}
          </button>
        </div>
      </header>

      {error ? <div className="error">{error}</div> : null}

      <section className="cards">
        {cards.map(({ label, value, hint, tone }) => (
          <article className={`card ${tone}`} key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{hint}</small>
          </article>
        ))}
      </section>

      <section className="toolbar">
        <label>
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            {STATUS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="search-field">
          <span>Search leads</span>
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && load()}
            placeholder="Machine, phone, seller, Nettikone ID"
          />
        </label>
        <button onClick={load}>Search</button>
      </section>

      <section className="grid">
        <div className="panel table-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Lead queue</p>
              <h2>Eligible machinery listings</h2>
            </div>
            <span>{listings.length} visible</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Machine</th>
                <th>Price</th>
                <th>Phone</th>
                <th>Source</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {listings.map((listing) => (
                <tr
                  key={listing.id}
                  className={selected?.id === listing.id ? 'selected' : ''}
                  onClick={() => setSelected(listing)}
                >
                  <td>
                    <strong>{listing.machine_title}</strong>
                    <small>{listing.nettikone_id} · {listing.location || 'No location'}</small>
                  </td>
                  <td>
                    <strong className="price">{listing.price_text || '-'}</strong>
                    <small>{listing.model_year || 'Year unknown'}</small>
                  </td>
                  <td>
                    <span>{listing.normalized_phone || '-'}</span>
                    <small>Seller {listing.prospect_id || '-'}</small>
                  </td>
                  <td>
                    <span className={`source-badge ${listing.phone_source || 'missing'}`}>
                      {phoneSourceLabel(listing.phone_source)}
                    </span>
                  </td>
                  <td>
                    <span className={`pill ${listing.status}`}>{statusLabel(listing.status)}</span>
                  </td>
                </tr>
              ))}
              {!listings.length && !loading ? (
                <tr>
                  <td colSpan="4" className="empty">
                    No listings found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <aside className="panel detail">
          {selected ? (
            <>
              <div className="detail-header">
                <div>
                  <p className="eyebrow">Listing {selected.nettikone_id}</p>
                  <h2>{selected.machine_title}</h2>
                  <div className="detail-tags">
                    <span>{selected.price_text || 'No price'}</span>
                    <span>{selected.location || 'No location'}</span>
                    <span>{phoneSourceLabel(selected.phone_source)}</span>
                  </div>
                </div>
                <a className="open-link" href={selected.listing_url} target="_blank" rel="noreferrer">
                  Open
                </a>
              </div>
              <div className="lead-packet">
                <dl>
                  <dt>Phone</dt>
                  <dd>{selected.normalized_phone || 'Missing'}</dd>
                  <dt>Seller prospect</dt>
                  <dd>{selected.prospect_id || '-'}</dd>
                  <dt>Model year</dt>
                  <dd>{selected.model_year || '-'}</dd>
                  <dt>Registration</dt>
                  <dd>{selected.registration_number || '-'}</dd>
                </dl>
              </div>
              <div className="message-card">
                <p className="eyebrow">Outbound preview</p>
                <div className="message">{selectedMessage}</div>
              </div>
              <div className="description-card">
                <p className="eyebrow">Listing notes</p>
                <p className="description">{selected.description || 'No description stored.'}</p>
              </div>
            </>
          ) : (
            <p className="empty">Select a listing.</p>
          )}
        </aside>
      </section>
    </main>
  );
}

function phoneSourceLabel(value) {
  if (value === 'description') return 'Lisätiedot';
  if (value === 'revealed_contact') return 'Näytä numero';
  return 'Missing';
}

function statusLabel(value) {
  return String(value || 'eligible').replace(/_/g, ' ');
}

createRoot(document.getElementById('root')).render(<App />);
