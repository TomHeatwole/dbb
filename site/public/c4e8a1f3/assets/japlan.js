/* JAPLAN — live trip site */
(function () {
  'use strict';

  const SHEET_ID = '1Y1qivGCgrYEGoDAriGrBREDwJ6hR3ON9B8yPUYGa-qg';
  const DEPARTURE = new Date('2026-07-25T01:30:00-04:00');

  let config = null;
  let sections = [];
  let liveLoaded = false;

  const $ = (sel) => document.querySelector(sel);
  const app = () => $('#app');
  const nav = () => $('#site-nav');
  const livePill = () => $('#live-pill');

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function firstVal(row) {
    return Object.values(row).find((v) => v && String(v).trim()) || '';
  }

  function parseGviz(text) {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Invalid gviz response');
    const data = JSON.parse(m[0]);
    const cols = (data.table?.cols || []).map((c, i) => {
      const label = (c.label || '').trim();
      return label || `_c${i}`;
    });
    const rows = (data.table?.rows || []).map((row) => {
      const cells = row.c || [];
      const rec = {};
      cols.forEach((col, i) => {
        const c = cells[i];
        rec[col] = c ? String(c.f ?? c.v ?? '').trim() : '';
      });
      return rec;
    }).filter((r) => Object.values(r).some((v) => v));
    return { columns: cols, rows };
  }

  async function fetchTab(gid) {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${gid}&headers=1&_=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseGviz(await res.text());
  }

  async function loadSnapshot() {
    const res = await fetch('data/snapshot.json?_=' + Date.now());
    const snap = await res.json();
    config = {
      sheetId: snap.sheetId,
      title: 'JAPLAN',
      subtitle: '私たちの夏',
      departureDate: '2026-07-25',
      tabs: snap.sections.map(({ id, gid, title, emoji, renderer }) => ({ id, gid, title, emoji, renderer })),
    };
    sections = snap.sections;
  }

  async function fetchLive() {
    try {
      const results = await Promise.all(
        config.tabs.map(async (tab) => {
          const parsed = await fetchTab(tab.gid);
          return { ...tab, ...parsed };
        })
      );
      sections = results;
      liveLoaded = true;
      livePill().classList.remove('hidden');
      livePill().textContent = 'live · just now';
    } catch (e) {
      console.warn('JAPLAN live fetch failed, using snapshot', e);
    }
  }

  function section(id) {
    return sections.find((s) => s.id === id);
  }

  function regionColor(cluster) {
    const c = (cluster || '').toLowerCase();
    if (c.includes('nyc') || c.includes('home') || (c.includes('→') && c.includes('tokyo') && !c.includes('kyoto'))) return 'transit';
    if (c.includes('kyoto')) return 'kyoto';
    if (c.includes('hokkaido') || c.includes('hakodate') || c.includes('sapporo') || c.includes('toya') || c.includes('furano') || c.includes('biei') || c.includes('otaru') || c.includes('noboribetsu') || c.includes('asahidake') || c.includes('chitose')) return 'hokkaido';
    return '';
  }

  function priorityBadge(p) {
    const v = (p || '').toLowerCase();
    if (v.includes('critical')) return '<span class="badge badge-critical">Critical</span>';
    if (v.includes('must')) return '<span class="badge badge-must">Must-do</span>';
    if (v.includes('high')) return '<span class="badge badge-high">High</span>';
    if (v.includes('medium')) return '<span class="badge badge-medium">Medium</span>';
    return p ? `<span class="badge">${esc(p)}</span>` : '';
  }

  function sectionHead(sec) {
    return `<div class="section-head"><h2><span>${sec.emoji}</span> ${esc(sec.title)}</h2><p>${sec.rows.length} items · updates from your sheet</p></div>`;
  }

  const renderers = {
    timeline(sec) {
      const byDate = {};
      sec.rows.forEach((r) => {
        const d = r.Date || 'Unknown';
        if (!byDate[d]) byDate[d] = [];
        byDate[d].push(r);
      });
      let html = sectionHead(sec);
      Object.entries(byDate).forEach(([date, items]) => {
        const region = regionColor(items[0]['Area Cluster']);
        const badgeClass = region === 'hokkaido' ? 'hokkaido' : region === 'transit' ? 'transit' : '';
        const badgeColor = region === 'hokkaido' ? 'var(--hokkaido)' : region === 'kyoto' ? 'var(--kyoto)' : '#888';
        html += `<div class="day-group"><div class="day-header"><span class="day-date">${esc(date)}</span><span class="day-badge" style="background:${badgeColor}">${esc(items[0].Day || '')}</span></div>`;
        items.forEach((r) => {
          const rc = regionColor(r['Area Cluster']);
          html += `<div class="activity-card ${rc}">`;
          if (r['Time Block']) html += `<div class="act-time">${esc(r['Time Block'])}</div>`;
          if (r['Area Cluster']) html += `<div class="act-cluster">${esc(r['Area Cluster'])}</div>`;
          html += `<div class="act-title">${esc(r['Activity / Plan'])}</div>`;
          html += `<div class="act-meta">${priorityBadge(r.Priority)}</div>`;
          if (r['Heat / Energy Strategy']) html += `<div class="act-tip">🌡 ${esc(r['Heat / Energy Strategy'])}</div>`;
          if (r['Backup / Flex'] && r['Backup / Flex'] !== '—') html += `<div class="act-backup">Plan B: ${esc(r['Backup / Flex'])}</div>`;
          if (r['Map Link'] && r['Map Link'].startsWith('http')) html += `<a class="btn-link" href="${esc(r['Map Link'])}" target="_blank" rel="noopener">Open route →</a>`;
          html += '</div>';
        });
        html += '</div>';
      });
      return html;
    },

    hanko(sec) {
      let html = sectionHead(sec);
      const statuses = [...new Set(sec.rows.map((r) => r.Status).filter(Boolean))];
      html += '<div class="filter-row">';
      html += '<button class="filter-btn active" data-filter="all">All</button>';
      statuses.forEach((s) => { html += `<button class="filter-btn" data-filter="${esc(s)}">${esc(s)}</button>`; });
      html += '</div><div id="hanko-list">';
      sec.rows.forEach((r) => {
        const reg = (r.Region || '').toLowerCase();
        const regClass = reg.includes('kyoto') ? 'kyoto' : reg.includes('hokkaido') ? 'hokkaido' : '';
        const crit = (r.Priority || '').toLowerCase().includes('critical');
        html += `<div class="hanko-card ${crit ? 'critical' : ''}" data-status="${esc(r.Status)}">`;
        html += `<div class="hanko-region ${regClass}">${esc(r.Region)} · ${esc(r.Status)}</div>`;
        html += `<div class="hanko-item">${esc(r.Item)}</div>`;
        html += `<div class="hanko-action">${esc(r.Action)}</div>`;
        html += `<div class="act-meta">${priorityBadge(r.Priority)}`;
        if (r['Target Date/Time']) html += `<span class="badge">${esc(r['Target Date/Time'])}</span>`;
        html += '</div>';
        const url = r['Reserve/Search URL'] || r['Source URL'];
        if (url && url.startsWith('http')) html += `<a class="btn-link" href="${esc(url)}" target="_blank" rel="noopener">Reserve / search →</a>`;
        html += '</div>';
      });
      html += '</div>';
      return html;
    },

    checklist(sec) {
      const items = [];
      sec.columns.forEach((col) => {
        if (col && !col.startsWith('_c')) items.push(col);
      });
      sec.rows.forEach((r) => Object.values(r).forEach((v) => { if (v) items.push(v); }));
      let html = sectionHead(sec);
      items.forEach((item, i) => {
        const id = 'pack-' + i;
        html += `<div class="check-item" data-check="${id}"><div class="check-box"></div><span>${esc(item)}</span></div>`;
      });
      return html;
    },

    'boarding-pass'(sec) {
      let html = sectionHead(sec);
      sec.rows.forEach((r) => {
        html += `<div class="ticket"><div class="ticket-inner">`;
        html += `<div class="ticket-airline">${esc(r.Airline)}</div>`;
        html += `<div class="ticket-route"><span class="ticket-city">${esc(r.From)}</span><span class="ticket-arrow">→</span><span class="ticket-city">${esc(r.To)}</span></div>`;
        html += '<dl class="ticket-meta">';
        html += `<dt>Date</dt><dd>${esc(r['Departure Date'])}</dd>`;
        if (r['Departure Time']) html += `<dt>Time</dt><dd>${esc(r['Departure Time'])}</dd>`;
        html += `<dt>Passenger</dt><dd>${esc(r.Passenger)}</dd>`;
        html += `<dt>Baggage</dt><dd>${esc(r['Baggage Allowance'])}</dd>`;
        html += '</dl></div>';
        html += `<div class="ticket-stub"><span class="confirm-copy" data-copy="${esc(r['Confirmation #'])}">Conf: ${esc(r['Confirmation #'])}</span>`;
        if (r.Contact) html += `<span>${esc(r.Contact)}</span>`;
        html += '</div></div>';
      });
      return html;
    },

    scrapbook(sec) {
      let html = sectionHead(sec);
      let currentRegion = '';
      sec.rows.forEach((r) => {
        const text = firstVal(r);
        if (!text) return;
        const isHeader = text === 'Kyoto' || text === 'Hokkaido';
        if (isHeader) {
          currentRegion = text;
          html += `<div class="scrap-region">${esc(text)}</div>`;
        } else {
          html += `<span class="scrap-note">${esc(text)}</span>`;
        }
      });
      return html;
    },

    transit(sec) {
      const modeIcon = (m) => {
        const s = (m || '').toLowerCase();
        if (s.includes('shinkansen')) return '🚄';
        if (s.includes('flight')) return '✈️';
        if (s.includes('car') || s.includes('rental')) return '🚗';
        if (s.includes('walk')) return '🚶';
        if (s.includes('train') || s.includes('jr') || s.includes('bus')) return '🚃';
        return '🛤';
      };
      let html = sectionHead(sec);
      sec.rows.forEach((r) => {
        html += `<div class="transit-card"><div class="transit-icon">${modeIcon(r.Mode)}</div><div>`;
        html += `<div class="act-time">${esc(r.Date)} · Leg ${esc(r.Leg)}</div>`;
        html += `<div class="transit-route">${esc(r.From)} → ${esc(r.To)}</div>`;
        html += `<div class="transit-mode">${esc(r.Mode)} · ${esc(r['Approx Time'])}</div>`;
        if (r.Recommendation) html += `<div class="transit-tip">${esc(r.Recommendation)}</div>`;
        if (r['Directions URL']?.startsWith('http')) html += `<a class="btn-link" href="${esc(r['Directions URL'])}" target="_blank" rel="noopener">Navigate →</a>`;
        html += '</div></div>';
      });
      return html;
    },

    'map-routes'(sec) {
      let html = sectionHead(sec);
      html += `<div class="map-embed"><iframe src="/d8f2e14c/" title="Kyoto map" loading="lazy"></iframe></div>`;
      html += `<div class="map-embed"><iframe src="/b4e7f2a9/" title="Hokkaido map" loading="lazy"></iframe></div>`;
      sec.rows.forEach((r) => {
        html += `<div class="map-route-card"><h3>${esc(r.Route)} <span style="opacity:.5;font-weight:400">· ${esc(r.Region)}</span></h3>`;
        html += `<p>${esc(r['Use For'])}</p>`;
        if (r.URL?.startsWith('http')) html += `<a class="btn-link" href="${esc(r.URL)}" target="_blank" rel="noopener">Open in Google Maps →</a>`;
        html += '</div>';
      });
      return html;
    },

    menu(sec) {
      let html = sectionHead(sec);
      let lastRegion = '';
      sec.rows.forEach((r) => {
        if (r.Region && r.Region !== lastRegion) {
          lastRegion = r.Region;
          const cls = r.Region.toLowerCase().includes('kyoto') ? 'kyoto' : '';
          html += `<div class="food-chapter ${cls}">${esc(r.Region)}</div>`;
        }
        const stars = (r.Priority || '').toLowerCase().includes('must') ? '★★★' : (r.Priority || '').toLowerCase().includes('high') ? '★★' : '★';
        html += `<div class="menu-item"><div class="menu-area">${esc(r.Area)}</div>`;
        html += `<div class="menu-idea">${esc(r.Idea)}</div>`;
        html += `<div class="menu-stars">${stars}</div>`;
        if (r['Best Pairing']) html += `<div class="act-tip">Best on ${esc(r['Best Pairing'])}</div>`;
        if (r['Search URL']?.startsWith('http')) html += `<a class="btn-link" href="${esc(r['Search URL'])}" target="_blank" rel="noopener">Search nearby →</a>`;
        html += '</div>';
      });
      return html;
    },

    sources(sec) {
      let html = sectionHead(sec);
      sec.rows.forEach((r) => {
        html += `<div class="source-card"><div class="source-topic">${esc(r.Topic)}</div>`;
        if (r['Useful detail']) html += `<div class="source-detail">${esc(r['Useful detail'])}</div>`;
        if (r.URL?.startsWith('http')) html += `<a class="source-link" href="${esc(r.URL)}" target="_blank" rel="noopener">${esc(r.Source || 'Read more')} ↗</a>`;
        html += '</div>';
      });
      return html;
    },
  };

  function openBookingsCount() {
    const b = section('bookings');
    if (!b) return 0;
    return b.rows.filter((r) => (r.Status || '').toLowerCase().includes('book')).length;
  }

  function countdownHtml() {
    const now = new Date();
    const diff = DEPARTURE - now;
    if (diff <= 0) return '<div class="countdown"><span class="countdown-num">✈</span><span class="countdown-label">Bon voyage!</span></div>';
    const days = Math.ceil(diff / 86400000);
    return `<div class="countdown"><span class="countdown-num">${days}</span><span class="countdown-label">days until JFK → Tokyo</span></div>`;
  }

  function renderHome() {
    const days = section('itinerary')?.rows?.length || 0;
    const open = openBookingsCount();
    let stamps = '';
    config.tabs.forEach((t) => {
      stamps += `<a href="#${t.id}" class="stamp-card" data-nav="${t.id}"><span class="stamp-emoji">${t.emoji}</span><span class="stamp-title">${esc(t.title)}</span></a>`;
    });
    app().innerHTML = `
      <div class="hero">
        <div class="hero-stamp">🌸</div>
        <h1>JAPLAN</h1>
        <p class="hero-sub">私たちの夏 · Sharon & Tom</p>
        ${countdownHtml()}
        <div class="stats-row">
          <div class="stat-card"><div class="stat-num">15</div><div class="stat-label">days</div></div>
          <div class="stat-card"><div class="stat-num teal">2</div><div class="stat-label">regions</div></div>
          <div class="stat-card"><div class="stat-num">${days}</div><div class="stat-label">plans</div></div>
          <div class="stat-card"><div class="stat-num gold">${open}</div><div class="stat-label">to book</div></div>
        </div>
        <div class="stamp-grid">${stamps}</div>
        <div class="mini-map-wrap">
          <iframe src="/d8f2e14c/" title="Trip maps" loading="lazy"></iframe>
        </div>
      </div>`;
    initPetals();
  }

  function renderRoute(id) {
    if (id === 'home' || !id) {
      renderHome();
      return;
    }
    const sec = section(id);
    if (!sec) {
      app().innerHTML = '<div class="loading">Section not found.</div>';
      return;
    }
    const fn = renderers[sec.renderer];
    app().innerHTML = fn ? fn(sec) : `<div class="loading">${esc(sec.title)} — coming soon</div>`;
    bindSectionEvents(id);
  }

  function bindSectionEvents(id) {
    if (id === 'hanko') {
      document.querySelectorAll('.filter-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          const f = btn.dataset.filter;
          document.querySelectorAll('.hanko-card').forEach((card) => {
            card.style.display = f === 'all' || card.dataset.status === f ? '' : 'none';
          });
        });
      });
    }
    if (id === 'packing') {
      document.querySelectorAll('.check-item').forEach((el) => {
        const key = 'japlan-' + el.dataset.check;
        if (localStorage.getItem(key) === '1') el.classList.add('checked');
        el.addEventListener('click', () => {
          el.classList.toggle('checked');
          localStorage.setItem(key, el.classList.contains('checked') ? '1' : '0');
          const box = el.querySelector('.check-box');
          box.textContent = el.classList.contains('checked') ? '✓' : '';
        });
        const box = el.querySelector('.check-box');
        if (el.classList.contains('checked')) box.textContent = '✓';
      });
    }
    document.querySelectorAll('.confirm-copy').forEach((el) => {
      el.addEventListener('click', () => {
        navigator.clipboard?.writeText(el.dataset.copy || '');
        el.textContent = 'Copied!';
        setTimeout(() => { el.textContent = 'Conf: ' + (el.dataset.copy || ''); }, 1200);
      });
    });
  }

  function buildNav() {
    let html = '<a href="#home" class="nav-chip" data-nav="home">🏠 Home</a>';
    config.tabs.forEach((t) => {
      html += `<a href="#${t.id}" class="nav-chip" data-nav="${t.id}">${t.emoji} ${esc(t.title)}</a>`;
    });
    nav().innerHTML = html;
  }

  function setActiveNav(id) {
    document.querySelectorAll('.nav-chip').forEach((el) => {
      el.classList.toggle('active', el.dataset.nav === id);
    });
  }

  function route() {
    const id = (location.hash || '#home').slice(1) || 'home';
    setActiveNav(id);
    renderRoute(id);
    nav().classList.remove('open');
  }

  function initPetals() {
    const box = $('#petals');
    if (!box || box.childElementCount > 0) return;
    for (let i = 0; i < 12; i++) {
      const p = document.createElement('div');
      p.className = 'petal';
      p.style.left = Math.random() * 100 + '%';
      p.style.animationDuration = 8 + Math.random() * 12 + 's';
      p.style.animationDelay = Math.random() * 10 + 's';
      box.appendChild(p);
    }
  }

  async function init() {
    app().innerHTML = '<div class="loading">Loading JAPLAN…</div>';
    await loadSnapshot();
    buildNav();
    route();
    await fetchLive();
    route();
    window.addEventListener('hashchange', route);
    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-nav]');
      if (a) {
        e.preventDefault();
        location.hash = a.dataset.nav;
      }
    });
    $('#nav-toggle')?.addEventListener('click', () => nav().classList.toggle('open'));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') fetchLive().then(route);
    });
  }

  init();
})();
