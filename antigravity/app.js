/**
 * app.js — Titan TV App
 * Full D-pad navigable TV channel player using hls.js
 * =====================================================
 */

'use strict';

/* ── Configuration ───────────────────────────────────────── */
const CONFIG = {
  channelsUrl:      './channels.json',
  focusColor:       '#e5a00d',
  overlayHideDelay: 3000,   // ms before HUD fades out
  columns:          5,      // grid columns
  skeletonCount:    15,     // # skeleton cards to show while loading
};

/* ── State ────────────────────────────────────────────────── */
const state = {
  allChannels:     [],   // full channel list after filtering
  filteredChannels:[],   // currently displayed channels
  activeScreen:    'home',  // 'home' | 'player' | 'search'
  selectedCategory:'All',
  selectedSort:    'default',
  focusZone:       'grid',   // 'sidebar' | 'grid' | 'topbar'
  focusIndex:      0,        // focused cell index in grid
  sidebarFocusIdx: 0,
  categories:      [],
  sidebarItems:    [],       // DOM elements in sidebar (categories + sorts)
  gridItems:       [],       // DOM elements in grid
  hudTimer:        null,
  hls:             null,
};

/* ── DOM refs ─────────────────────────────────────────────── */
const dom = {
  app:           () => document.getElementById('app'),
  screenHome:    () => document.getElementById('screen-home'),
  screenPlayer:  () => document.getElementById('screen-player'),
  screenSearch:  () => document.getElementById('screen-search'),
  errorScreen:   () => document.getElementById('error-screen'),
  clock:         () => document.getElementById('clock'),
  hudClock:      () => document.getElementById('hud-clock'),
  channelGrid:   () => document.getElementById('channel-grid'),
  searchGrid:    () => document.getElementById('search-grid'),
  sidebar:       () => document.getElementById('sidebar'),
  searchInput:   () => document.getElementById('search-input'),
  btnSearch:     () => document.getElementById('btn-search'),
  playerVideo:   () => document.getElementById('player-video'),
  playerHud:     () => document.getElementById('player-hud'),
  hudLogo:       () => document.getElementById('hud-logo'),
  hudName:       () => document.getElementById('hud-name'),
  hudStatus:     () => document.getElementById('hud-status'),
  bufferingSpinner: () => document.getElementById('buffering-spinner'),
  streamError:   () => document.getElementById('stream-error'),
  retryBtn:      () => document.getElementById('retry-btn'),
};

/* ══════════════════════════════════════════════════════════
   CLOCK
══════════════════════════════════════════════════════════ */
function updateClocks() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const t = `${hh}:${mm}`;
  dom.clock().textContent = t;
  dom.hudClock().textContent = t;
}
setInterval(updateClocks, 10000);
updateClocks();

/* ══════════════════════════════════════════════════════════
   SCREEN MANAGEMENT
══════════════════════════════════════════════════════════ */
function showScreen(name) {
  ['home', 'player', 'search'].forEach(s => {
    const el = document.getElementById(`screen-${s}`);
    if (el) el.classList.toggle('active', s === name);
  });
  state.activeScreen = name;
}

/* ══════════════════════════════════════════════════════════
   DATA LOADING
══════════════════════════════════════════════════════════ */
async function loadChannels() {
  showSkeletons();
  try {
    const resp = await fetch(CONFIG.channelsUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const channels = (data.channels || []).filter(
      ch => ch.stream_url && ch.working !== false
    );
    state.allChannels = channels;
    buildCategories(channels);
    applyFilter();
    dom.errorScreen().classList.remove('active');
  } catch (err) {
    console.error('Failed to load channels:', err);
    dom.channelGrid().innerHTML = '';
    dom.errorScreen().classList.add('active');
    state.focusZone = 'error';
    dom.retryBtn().classList.add('focused');
  }
}

function buildCategories(channels) {
  const cats = ['All', ...new Set(channels.map(c => c.category).filter(Boolean))].sort((a, b) =>
    a === 'All' ? -1 : b === 'All' ? 1 : a.localeCompare(b)
  );
  state.categories = cats;
  renderSidebar(cats);
}

/* ══════════════════════════════════════════════════════════
   FILTER & SORT
══════════════════════════════════════════════════════════ */
function applyFilter(searchTerm = '') {
  let list = [...state.allChannels];

  // Category filter
  if (state.selectedCategory !== 'All') {
    list = list.filter(ch => ch.category === state.selectedCategory);
  }

  // Search filter
  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    list = list.filter(ch =>
      ch.name.toLowerCase().includes(q) ||
      (ch.category || '').toLowerCase().includes(q)
    );
  }

  // Sort
  if (state.selectedSort === 'az') {
    list.sort((a, b) => a.name.localeCompare(b.name));
  } else if (state.selectedSort === 'za') {
    list.sort((a, b) => b.name.localeCompare(a.name));
  } else if (state.selectedSort === 'cat') {
    list.sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name));
  }

  state.filteredChannels = list;
  renderGrid(dom.channelGrid(), list);
}

/* ══════════════════════════════════════════════════════════
   RENDERING
══════════════════════════════════════════════════════════ */
function showSkeletons() {
  const grid = dom.channelGrid();
  grid.innerHTML = '';
  for (let i = 0; i < CONFIG.skeletonCount; i++) {
    const card = document.createElement('div');
    card.className = 'channel-card skeleton-card';
    card.innerHTML = `
      <div class="skeleton skeleton-logo"></div>
      <div class="skeleton skeleton-text"></div>
      <div class="skeleton skeleton-text sm"></div>
    `;
    grid.appendChild(card);
  }
}

function renderSidebar(categories) {
  const sidebar = dom.sidebar();
  // Remove old category items (keep sort items at bottom)
  const sortDivider = sidebar.querySelector('.sidebar-section-label:last-of-type');

  // Clear everything before the last section label + sort items
  // Re-render from scratch preserving sorts
  sidebar.innerHTML = `
    <div class="sidebar-section-label">CATEGORIES</div>
  `;

  categories.forEach(cat => {
    const item = document.createElement('div');
    item.className = 'sidebar-item' + (cat === state.selectedCategory ? ' selected' : '');
    item.textContent = cat;
    item.dataset.category = cat;
    item.tabIndex = -1;
    sidebar.appendChild(item);
  });

  sidebar.innerHTML += `<div class="sidebar-section-label" style="margin-top:16px">SORT</div>`;
  const sorts = [
    { value: 'az',      label: 'A → Z' },
    { value: 'za',      label: 'Z → A' },
    { value: 'cat',     label: 'By Category' },
  ];
  sorts.forEach(s => {
    const item = document.createElement('div');
    item.className = 'sidebar-item' + (s.value === state.selectedSort ? ' selected' : '');
    item.textContent = s.label;
    item.dataset.sort = s.value;
    item.tabIndex = -1;
    sidebar.appendChild(item);
  });

  // Cache sidebar focusable items
  state.sidebarItems = Array.from(sidebar.querySelectorAll('.sidebar-item'));
}

function renderGrid(gridEl, channels) {
  gridEl.innerHTML = '';
  state.gridItems = [];

  if (!channels.length) {
    gridEl.innerHTML = `
      <div class="no-results">
        <h3>No channels found</h3>
        <p>Try a different category or search term.</p>
      </div>`;
    return;
  }

  channels.forEach((ch, idx) => {
    const card = createCard(ch, idx);
    gridEl.appendChild(card);
    state.gridItems.push(card);
  });

  // Focus first card
  state.focusIndex = 0;
  focusGridItem(0);
}

function createCard(ch, idx) {
  const card = document.createElement('div');
  card.className = 'channel-card';
  card.role = 'listitem';
  card.tabIndex = -1;
  card.dataset.idx = idx;

  const logoHtml = ch.logo_url
    ? `<img src="${escHtml(ch.logo_url)}" alt="${escHtml(ch.name)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='block'" /><span class="logo-fallback" style="display:none">📺</span>`
    : `<span class="logo-fallback">📺</span>`;

  card.innerHTML = `
    <div class="card-logo">${logoHtml}</div>
    <div class="card-info">
      <div class="card-name">${escHtml(ch.name)}</div>
      <div class="card-category">${escHtml(ch.category || '')}</div>
    </div>
  `;

  card.addEventListener('click', () => openPlayer(ch));
  return card;
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ══════════════════════════════════════════════════════════
   FOCUS MANAGEMENT
══════════════════════════════════════════════════════════ */
function focusGridItem(idx) {
  state.gridItems.forEach((el, i) => el.classList.toggle('focused', i === idx));
  state.focusIndex = idx;
  if (state.gridItems[idx]) {
    state.gridItems[idx].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  unfocusSidebar();
  unfocusTopbar();
}

function focusSidebarItem(idx) {
  state.sidebarItems.forEach((el, i) => el.classList.toggle('focused', i === idx));
  state.sidebarFocusIdx = idx;
  unfocusGrid();
  unfocusTopbar();
}

function focusTopbar() {
  state.focusZone = 'topbar';
  dom.btnSearch().classList.add('focused');
  unfocusGrid();
  unfocusSidebar();
}

function unfocusGrid() {
  state.gridItems.forEach(el => el.classList.remove('focused'));
}
function unfocusSidebar() {
  state.sidebarItems.forEach(el => el.classList.remove('focused'));
}
function unfocusTopbar() {
  dom.btnSearch().classList.remove('focused');
}

function selectSidebarItem(idx) {
  const el = state.sidebarItems[idx];
  if (!el) return;

  // Remove previous selection
  state.sidebarItems.forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');

  if (el.dataset.category !== undefined) {
    state.selectedCategory = el.dataset.category;
    applyFilter();
    state.focusZone = 'grid';
    state.focusIndex = 0;
    focusGridItem(0);
  } else if (el.dataset.sort !== undefined) {
    state.selectedSort = el.dataset.sort;
    applyFilter();
  }
}

/* ══════════════════════════════════════════════════════════
   PLAYER
══════════════════════════════════════════════════════════ */
function openPlayer(channel) {
  showScreen('player');
  state.focusZone = 'player';

  // Fill HUD
  const hudLogo = dom.hudLogo();
  if (channel.logo_url) {
    hudLogo.src = channel.logo_url;
    hudLogo.style.display = '';
  } else {
    hudLogo.style.display = 'none';
  }
  dom.hudName().textContent = channel.name;
  dom.hudStatus().textContent = 'Connecting…';
  dom.streamError().classList.remove('active');
  dom.bufferingSpinner().classList.add('active');
  showHud();

  startStream(channel.stream_url);
}

function startStream(url) {
  const video = dom.playerVideo();

  // Destroy previous hls instance
  if (state.hls) {
    state.hls.destroy();
    state.hls = null;
  }
  video.src = '';

  if (!url) {
    showStreamError();
    return;
  }

  if (Hls.isSupported()) {
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
    });
    state.hls = hls;

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play()
        .then(() => {
          dom.hudStatus().textContent = 'Playing';
          dom.bufferingSpinner().classList.remove('active');
        })
        .catch(() => showStreamError());
    });

    hls.on(Hls.Events.ERROR, (_evt, data) => {
      if (data.fatal) {
        showStreamError();
      } else {
        dom.hudStatus().textContent = 'Buffering…';
      }
    });

    hls.on(Hls.Events.BUFFER_STALLED_ERROR, () => {
      dom.bufferingSpinner().classList.add('active');
      dom.hudStatus().textContent = 'Buffering…';
    });

    hls.on(Hls.Events.BUFFER_FLUSHED, () => {
      dom.bufferingSpinner().classList.remove('active');
      dom.hudStatus().textContent = 'Playing';
    });

    hls.loadSource(url);
    hls.attachMedia(video);

  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    // Safari native HLS
    video.src = url;
    video.play()
      .then(() => {
        dom.hudStatus().textContent = 'Playing';
        dom.bufferingSpinner().classList.remove('active');
      })
      .catch(() => showStreamError());
  } else {
    showStreamError();
  }
}

function stopStream() {
  const video = dom.playerVideo();
  if (state.hls) {
    state.hls.destroy();
    state.hls = null;
  }
  video.src = '';
  video.load();
}

function showStreamError() {
  dom.bufferingSpinner().classList.remove('active');
  dom.streamError().classList.add('active');
}

/* HUD auto-hide */
function showHud() {
  dom.playerHud().classList.remove('hidden');
  clearTimeout(state.hudTimer);
  state.hudTimer = setTimeout(() => {
    dom.playerHud().classList.add('hidden');
  }, CONFIG.overlayHideDelay);
}

/* ══════════════════════════════════════════════════════════
   SEARCH SCREEN
══════════════════════════════════════════════════════════ */
let searchGridItems = [];
let searchFocusIdx = 0;

function openSearch() {
  showScreen('search');
  state.focusZone = 'search';
  const input = dom.searchInput();
  input.value = '';
  renderGrid(dom.searchGrid(), state.allChannels);
  searchGridItems = Array.from(dom.searchGrid().querySelectorAll('.channel-card'));
  searchFocusIdx = 0;
  focusSearchItem(0);
  input.focus();
}

function closeSearch() {
  showScreen('home');
  state.focusZone = 'grid';
  focusGridItem(Math.min(state.focusIndex, state.gridItems.length - 1));
}

function focusSearchItem(idx) {
  searchGridItems = Array.from(dom.searchGrid().querySelectorAll('.channel-card'));
  searchGridItems.forEach((el, i) => el.classList.toggle('focused', i === idx));
  searchFocusIdx = idx;
  if (searchGridItems[idx]) {
    searchGridItems[idx].scrollIntoView({ block: 'nearest' });
  }
}

dom.searchInput().addEventListener('input', () => {
  const q = dom.searchInput().value.trim();
  const filtered = state.allChannels.filter(ch =>
    ch.name.toLowerCase().includes(q.toLowerCase()) ||
    (ch.category || '').toLowerCase().includes(q.toLowerCase())
  );
  renderGrid(dom.searchGrid(), filtered);
  searchGridItems = Array.from(dom.searchGrid().querySelectorAll('.channel-card'));
  searchFocusIdx = 0;
  if (searchGridItems[0]) searchGridItems[0].classList.add('focused');
});

/* ══════════════════════════════════════════════════════════
   KEYBOARD / D-PAD NAVIGATION
══════════════════════════════════════════════════════════ */
const BACK_KEYS = new Set([8, 27, 461, 10009, 27]); // Backspace, Escape, LG Back, Samsung/Tizen Back

document.addEventListener('keydown', e => {
  const key = e.key;
  const code = e.keyCode;
  const isBack = BACK_KEYS.has(code) || key === 'Backspace' || key === 'Escape';
  const isEnter = key === 'Enter' || code === 13;
  const isUp    = key === 'ArrowUp';
  const isDown  = key === 'ArrowDown';
  const isLeft  = key === 'ArrowLeft';
  const isRight = key === 'ArrowRight';

  switch (state.activeScreen) {
    case 'home':
      handleHomeNav({ key, code, isBack, isEnter, isUp, isDown, isLeft, isRight });
      break;
    case 'player':
      handlePlayerNav({ isBack, isEnter, isUp, isDown, isLeft, isRight });
      break;
    case 'search':
      handleSearchNav({ key, code, isBack, isEnter, isUp, isDown, isLeft, isRight }, e);
      break;
  }
});

/* ── Home Navigation ──────────────────────────────────────── */
function handleHomeNav({ isBack, isEnter, isUp, isDown, isLeft, isRight }) {
  if (state.focusZone === 'error') {
    if (isEnter) loadChannels();
    return;
  }

  if (state.focusZone === 'topbar') {
    if (isEnter) openSearch();
    if (isDown) { state.focusZone = 'sidebar'; focusSidebarItem(0); }
    if (isRight) { /* only one topbar element */ }
    if (isLeft) { state.focusZone = 'sidebar'; focusSidebarItem(0); }
    return;
  }

  if (state.focusZone === 'sidebar') {
    if (isUp) {
      if (state.sidebarFocusIdx === 0) {
        // Go to top bar
        focusTopbar();
        state.focusZone = 'topbar';
      } else {
        focusSidebarItem(state.sidebarFocusIdx - 1);
      }
    } else if (isDown) {
      if (state.sidebarFocusIdx < state.sidebarItems.length - 1) {
        focusSidebarItem(state.sidebarFocusIdx + 1);
      }
    } else if (isRight) {
      state.focusZone = 'grid';
      focusGridItem(Math.min(state.focusIndex, state.gridItems.length - 1));
    } else if (isEnter) {
      selectSidebarItem(state.sidebarFocusIdx);
    }
    return;
  }

  // focusZone === 'grid'
  const cols = CONFIG.columns;
  const total = state.gridItems.length;
  let idx = state.focusIndex;

  if (isUp) {
    if (idx < cols) {
      // Top row → go to topbar
      focusTopbar();
      state.focusZone = 'topbar';
    } else {
      focusGridItem(idx - cols);
    }
  } else if (isDown) {
    if (idx + cols < total) focusGridItem(idx + cols);
  } else if (isLeft) {
    if (idx % cols === 0) {
      // Leftmost column → sidebar
      state.focusZone = 'sidebar';
      focusSidebarItem(Math.min(state.sidebarFocusIdx, state.sidebarItems.length - 1));
    } else {
      focusGridItem(idx - 1);
    }
  } else if (isRight) {
    if (idx < total - 1 && (idx + 1) % cols !== 0) focusGridItem(idx + 1);
    else if ((idx + 1) % cols === 0 && idx + 1 < total) focusGridItem(idx + 1); // allow wrapping to next row start
  } else if (isEnter) {
    const ch = state.filteredChannels[idx];
    if (ch) openPlayer(ch);
  }
}

/* ── Player Navigation ────────────────────────────────────── */
function handlePlayerNav({ isBack }) {
  if (isBack) {
    showHud();   // any key = show HUD
    stopStream();
    showScreen('home');
    state.focusZone = 'grid';
    focusGridItem(state.focusIndex);
    return;
  }
  // Any other key: show HUD
  showHud();
}

/* ── Search Navigation ────────────────────────────────────── */
function handleSearchNav({ isBack, isEnter, isUp, isDown, isLeft, isRight }, e) {
  if (isBack) {
    closeSearch();
    return;
  }

  const cols = CONFIG.columns;
  const total = searchGridItems.length;
  let idx = searchFocusIdx;

  if (isUp) {
    if (idx >= cols) focusSearchItem(idx - cols);
  } else if (isDown) {
    if (idx + cols < total) focusSearchItem(idx + cols);
  } else if (isLeft) {
    if (idx % cols !== 0) focusSearchItem(idx - 1);
  } else if (isRight) {
    if (idx < total - 1) focusSearchItem(idx + 1);
  } else if (isEnter) {
    const filteredNow = state.allChannels.filter(ch => {
      const q = dom.searchInput().value.toLowerCase();
      return ch.name.toLowerCase().includes(q) || (ch.category || '').toLowerCase().includes(q);
    });
    const ch = filteredNow[idx];
    if (ch) {
      closeSearch();
      openPlayer(ch);
    }
  }
}

/* ── Search button click ──────────────────────────────────── */
dom.btnSearch().addEventListener('click', openSearch);

/* ── Retry button ─────────────────────────────────────────── */
dom.retryBtn().addEventListener('click', () => {
  dom.errorScreen().classList.remove('active');
  loadChannels();
});

/* ══════════════════════════════════════════════════════════
   INITIAL LOAD
══════════════════════════════════════════════════════════ */
loadChannels();
