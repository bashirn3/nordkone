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
      ['Eligible', summary?.eligible_prospects || summary?.eligible || 0],
      ['Contacted', summary?.contacted || summary?.contacted_listings || 0],
      ['Replied', summary?.replied || 0],
      ['Interested', summary?.interested || summary?.interested_listings || 0],
      ['Needs human', summary?.needs_human || 0],
      ['Description phones', summary?.description_phone_count || 0],
    ],
    [summary]
  );

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">NordKone</p>
          <h1>Nettikone Lead Desk</h1>
          <p>
            Scraped machinery listings, WhatsApp outreach state, and callbacks
            for sellers who are still open to a deal.
          </p>
        </div>
        <button onClick={load} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>

      {error ? <div className="error">{error}</div> : null}

      <section className="cards">
        {cards.map(([label, value]) => (
          <article className="card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <section className="toolbar">
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          {STATUS_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && load()}
          placeholder="Search title, phone, seller, Nettikone ID"
        />
        <button onClick={load}>Search</button>
      </section>

      <section className="grid">
        <div className="panel table-panel">
          <table>
            <thead>
              <tr>
                <th>Machine</th>
                <th>Price</th>
                <th>Phone</th>
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
                    <small>{listing.nettikone_id} · Seller {listing.prospect_id || '-'} · {listing.location || 'No location'}</small>
                  </td>
                  <td>{listing.price_text || '-'}</td>
                  <td>
                    <span>{listing.normalized_phone || '-'}</span>
                    <small>{phoneSourceLabel(listing.phone_source)}</small>
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
                </div>
                <a href={selected.listing_url} target="_blank" rel="noreferrer">
                  Open
                </a>
              </div>
              <dl>
                <dt>Phone</dt>
                <dd>{selected.normalized_phone || 'Missing'}</dd>
                <dt>Phone source</dt>
                <dd>{phoneSourceLabel(selected.phone_source)}</dd>
                <dt>Seller prospect</dt>
                <dd>{selected.prospect_id || '-'}</dd>
                <dt>Seller</dt>
                <dd>{selected.seller_name || '-'}</dd>
                <dt>Location</dt>
                <dd>{selected.location || '-'}</dd>
                <dt>Price</dt>
                <dd>{selected.price_text || '-'}</dd>
              </dl>
              <div className="message">
                Moikka! Sulla oli Nettikoneessa {selected.machine_title} myynnissä.
                Onko se edelleen kaupan?
              </div>
              <p className="description">{selected.description || 'No description stored.'}</p>
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
