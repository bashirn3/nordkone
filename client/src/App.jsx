import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { apiGet, apiSend } from './lib/api.js';
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
  const [conversations, setConversations] = useState([]);
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null);
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [settings, setSettings] = useState(null);
  const [dailyCapDraft, setDailyCapDraft] = useState('20');
  const [scrapeResult, setScrapeResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [scraping, setScraping] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ status, limit: '100' });
      if (q.trim()) params.set('q', q.trim());
      const [summaryData, listingData, settingsData, conversationData] = await Promise.all([
        apiGet('/api/summary'),
        apiGet(`/api/listings?${params.toString()}`),
        apiGet('/api/settings'),
        apiGet('/api/conversations?limit=50'),
      ]);

      setSummary(summaryData);
      setListings(listingData.listings || []);
      setSelected((current) => current || listingData.listings?.[0] || null);
      setSettings(settingsData.settings || null);
      setDailyCapDraft(String(settingsData.settings?.daily_cap ?? 20));
      setConversations(conversationData.conversations || []);
      setSelectedConversationId((current) => {
        const rows = conversationData.conversations || [];
        if (current && rows.some((conversation) => conversation.session_id === current)) return current;
        return rows[0]?.session_id || null;
      });
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

  const selectedConversation = useMemo(
    () =>
      conversations.find((conversation) => conversation.session_id === selectedConversationId) ||
      conversations[0] ||
      null,
    [conversations, selectedConversationId]
  );

  const selectedMessage = selected
    ? `Moikka! Sulla oli Nettikoneessa ${selected.machine_title} myynnissä. Onko se edelleen kaupan?`
    : '';

  async function updateOutboundSettings(nextSettings) {
    setSavingSettings(true);
    setError('');
    try {
      await apiSend('/api/settings', {
        method: 'PUT',
        body: {
          settings: nextSettings,
        },
      });
      await load();
    } catch (settingsError) {
      setError(settingsError.message);
    } finally {
      setSavingSettings(false);
    }
  }

  async function saveDailyCap() {
    await updateOutboundSettings({
      daily_cap: Math.max(Number(dailyCapDraft) || 0, 0),
    });
  }

  async function runManualScrape() {
    setScraping(true);
    setScrapeResult(null);
    setError('');
    try {
      const result = await apiSend('/api/scrape/run?limit=10&pages=1', { method: 'POST' });
      setScrapeResult(result);
      await load();
    } catch (scrapeError) {
      setError(scrapeError.message);
    } finally {
      setScraping(false);
    }
  }

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

      <section className="ops-grid">
        <article className={`panel control-panel ${settings?.outbound_enabled ? 'enabled' : ''}`}>
          <div>
            <p className="eyebrow">WF-1 Control</p>
            <h2>{settings?.outbound_enabled ? 'Outbound active' : 'Outbound paused'}</h2>
            <p>
              WF-1 only receives candidates when this is active and the daily cap
              still has room.
            </p>
          </div>
          <div className="control-actions">
            <button
              className={settings?.outbound_enabled ? 'danger' : 'success'}
              disabled={savingSettings || !settings}
              onClick={() => updateOutboundSettings({ outbound_enabled: !settings?.outbound_enabled })}
            >
              {settings?.outbound_enabled ? 'Pause WF-1' : 'Activate WF-1'}
            </button>
            <label>
              <span>Daily cap</span>
              <input
                min="0"
                type="number"
                value={dailyCapDraft}
                onChange={(event) => setDailyCapDraft(event.target.value)}
              />
            </label>
            <button disabled={savingSettings || !settings} onClick={saveDailyCap}>
              Save cap
            </button>
          </div>
        </article>

        <article className="panel control-panel">
          <div>
            <p className="eyebrow">Scraper</p>
            <h2>Manual Vercel check</h2>
            <p>
              Runs the same protected scrape path as the cron with a conservative
              one-page, ten-listing sample.
            </p>
            {scrapeResult ? (
              <code className="scrape-result">
                {JSON.stringify(scrapeResult.stats || scrapeResult)}
              </code>
            ) : null}
          </div>
          <div className="control-actions compact">
            <button disabled={scraping} onClick={runManualScrape}>
              {scraping ? 'Scraping...' : 'Run scrape now'}
            </button>
          </div>
        </article>
      </section>

      <section className="panel chat-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Chats</p>
            <h2>Seller conversations</h2>
          </div>
          <span>{conversations.length} sessions</span>
        </div>
        <div className="chat-layout">
          <div className="conversation-list">
            {conversations.map((conversation) => (
              <button
                className={`conversation-row ${
                  selectedConversation?.session_id === conversation.session_id ? 'active' : ''
                }`}
                key={conversation.session_id}
                onClick={() => setSelectedConversationId(conversation.session_id)}
              >
                <strong>{conversation.listing?.machine_title || conversation.number}</strong>
                <span>{conversation.listing?.nettikone_id || conversation.number}</span>
                <small>{conversation.latest_message?.message || 'No messages yet'}</small>
                <em>{statusLabel(conversation.interest_status || conversation.status)}</em>
              </button>
            ))}
            {!conversations.length && !loading ? (
              <p className="empty conversation-empty">No conversations yet.</p>
            ) : null}
          </div>

          <div className="thread">
            {selectedConversation ? (
              <>
                <div className="thread-header">
                  <div>
                    <p className="eyebrow">Session {selectedConversation.session_id}</p>
                    <h3>{selectedConversation.listing?.machine_title || selectedConversation.number}</h3>
                    <span>{selectedConversation.number}</span>
                  </div>
                  {selectedConversation.listing?.listing_url ? (
                    <a
                      className="open-link"
                      href={selectedConversation.listing.listing_url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Listing
                    </a>
                  ) : null}
                </div>
                <div className="messages">
                  {selectedConversation.messages.map((message) => (
                    <article className={`bubble ${message.direction}`} key={message.id}>
                      <div className="bubble-meta">
                        <span>{message.sender}</span>
                        <time>{formatTime(message.at)}</time>
                      </div>
                      <p>{message.message}</p>
                      {message.classification ? (
                        <small>{statusLabel(message.classification)}</small>
                      ) : null}
                    </article>
                  ))}
                  {!selectedConversation.messages.length ? (
                    <p className="empty">No stored messages for this session.</p>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="empty">Select a conversation.</p>
            )}
          </div>
        </div>
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
                  <td colSpan="5" className="empty">
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

function formatTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
  }).format(new Date(value));
}

createRoot(document.getElementById('root')).render(<App />);
