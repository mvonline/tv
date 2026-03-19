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
  overlayHideDelay: 3000,
  skeletonCount:    15,
  favStorageKey:    'mastv_favorites',
};

/** Returns the number of columns currently rendered in the channel grid. */
function getGridCols(gridEl) {
  const items = (gridEl || dom.channelGrid()).querySelectorAll('.channel-card');
  if (items.length < 2) return 5; // sensible default before render
  const firstTop = items[0].getBoundingClientRect().top;
  let cols = 0;
  for (const item of items) {
    if (Math.abs(item.getBoundingClientRect().top - firstTop) < 4) cols++;
    else break;
  }
  return cols || 5;
}

/* ── State ────────────────────────────────────────────────── */
const state = {
  allChannels:      [],
  filteredChannels: [],
  activeScreen:     'home',
  selectedCategory: 'All',
  selectedSort:     'default',
  focusZone:        'grid',   // 'sidebar' | 'grid' | 'topbar' | 'player' | 'player-home' | 'player-fav' | 'player-panel' | 'exit' | 'error'
  focusIndex:       0,
  sidebarFocusIdx:  0,
  exitFocusBtn:     'stay',
  categories:       [],
  sidebarItems:     [],
  gridItems:        [],
  hudTimer:         null,
  hls:              null,
  exitDialogOpen:   false,
  favorites:        loadFavorites(),
  currentChannel:   null,
  panelOpen:        false,
  panelFocusIdx:    0,
};

/* ── DOM refs ─────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const dom = {
  app:              () => document.getElementById('app'),
  homeContent:      () => document.querySelector('.home-content'),
  homeScreen:       () => document.getElementById('screen-home'),
  playerScreen:     () => document.getElementById('screen-player'),
  screenSearch:     () => $('screen-search'),
  errorScreen:      () => $('error-screen'),
  btnMenu:          () => document.getElementById('btn-mobile-menu'),
  clock:            () => $('clock'),
  hudClock:         () => $('hud-clock'),
  channelGrid:      () => $('channel-grid'),
  searchGrid:       () => $('search-grid'),
  sidebar:          () => $('sidebar'),
  searchInput:      () => $('search-input'),
  btnSearch:        () => $('btn-search'),
  playerVideo:      () => $('player-video'),
  playerHud:        () => $('player-hud'),
  hudLogo:          () => $('hud-logo'),
  hudName:          () => $('hud-name'),
  hudStatus:        () => $('hud-status'),
  hudHomeBtn:       () => $('hud-home-btn'),
  hudFavBtn:        () => $('hud-fav-btn'),
  hudPanelBtn:      () => $('hud-panel-btn'),
  hudFsBtn:         () => $('hud-fs-btn'),
  playerChannelPanel: () => $('player-channel-panel'),
  pcpList:          () => $('pcp-list'),
  pcpSearchInput:   () => $('pcp-search-input'),
  pcpCloseBtn:      () => $('pcp-close-btn'),
  bufferingSpinner: () => $('buffering-spinner'),
  streamError:      () => $('stream-error'),
  streamErrorBack:  () => $('stream-error-back-btn'),
  retryBtn:         () => $('retry-btn'),
  exitDialog:       () => $('exit-dialog'),
  exitStay:         () => $('exit-stay'),
  exitLeave:        () => $('exit-leave'),
  chOsd:            () => $('ch-osd'),
  chOsdNum:         () => $('ch-osd-num'),
  hudNumpadBtn:     () => $('hud-numpad-btn'),
  numpadOverlay:    () => $('numpad-overlay'),
  numpadCloseBtn:   () => $('numpad-close-btn'),
  numpadGrid:       () => $('numpad-grid'),
  numpadEnterBtn:   () => $('numpad-enter-btn'),
  hudPipBtn:        () => $('hud-pip-btn'),
};

/* ══════════════════════════════════════════════════════════
   CHANNEL NUMBER OSD (Numpad switching)
══════════════════════════════════════════════════════════ */
let _chInputBuf = '';
let _chInputTimer = null;

function _showChOsd(numStr) {
  const osd = dom.chOsd();
  dom.chOsdNum().textContent = numStr;
  osd.classList.add('active');
}
function _hideChOsd() {
  dom.chOsd().classList.remove('active');
}
function _handleDigitKey(digit) {
  if (state.activeScreen !== 'player') return;
  _chInputBuf += digit;
  if (_chInputBuf.length > 3) _chInputBuf = _chInputBuf.slice(-3);
  _showChOsd(_chInputBuf);
  showHud();
  clearTimeout(_chInputTimer);
  _chInputTimer = setTimeout(() => {
    const num = parseInt(_chInputBuf, 10);
    _chInputBuf = '';
    _hideChOsd();
    const ch = state.allChannels.find(c => c.num === num && c.stream_url);
    if (ch) openPlayer(ch);
  }, 1500);
}

/* ══════════════════════════════════════════════════════════
   MOBILE SIDEBAR LOGIC
══════════════════════════════════════════════════════════ */
function toggleMobileSidebar() {
  const sidebar = dom.sidebar();
  const content = dom.homeContent();
  const isOpen = sidebar.classList.contains('mobile-open');
  if (isOpen) {
    sidebar.classList.remove('mobile-open');
    content.classList.remove('sidebar-open');
  } else {
    sidebar.classList.add('mobile-open');
    content.classList.add('sidebar-open');
  }
}

function closeMobileSidebar() {
  dom.sidebar().classList.remove('mobile-open');
  dom.homeContent().classList.remove('sidebar-open');
}

// Close sidebar if user clicks on the backdrop (the pseudo-element on home-content)
function _setupSidebarListeners() {
  dom.homeContent().addEventListener('click', (e) => {
    if (e.target === dom.homeContent() && dom.sidebar().classList.contains('mobile-open')) {
      closeMobileSidebar();
    }
  });
  dom.btnMenu().addEventListener('click', toggleMobileSidebar);
}

/* ══════════════════════════════════════════════════════════
   ON-SCREEN NUMPAD LOGIC (Mobile)
══════════════════════════════════════════════════════════ */
function openMobileNumpad() {
  dom.numpadOverlay().classList.add('active');
}
function closeMobileNumpad() {
  dom.numpadOverlay().classList.remove('active');
  _chInputBuf = '';
  clearTimeout(_chInputTimer);
  _hideChOsd();
}

function _setupNumpadListeners() {
  dom.hudNumpadBtn().addEventListener('click', openMobileNumpad);
  dom.numpadCloseBtn().addEventListener('click', closeMobileNumpad);

  dom.numpadGrid().addEventListener('click', (e) => {
    const btn = e.target.closest('.np-btn');
    if (!btn) return;
    const val = btn.dataset.val;
    if (!val) return;

    if (val === 'backspace') {
      _chInputBuf = _chInputBuf.slice(0, -1);
      // show what they have typed so far in OSD, or hide if empty
      if (_chInputBuf.length > 0) _showChOsd(_chInputBuf);
      else _hideChOsd();
    } else {
      // It's a digit
      _handleDigitKey(val);
    }
  });

  dom.numpadEnterBtn().addEventListener('click', () => {
    if (_chInputBuf.length > 0) {
      // Clear the timer from _handleDigitKey and trigger immediately
      clearTimeout(_chInputTimer);
      const num = parseInt(_chInputBuf, 10);
      _chInputBuf = '';
      _hideChOsd();
      closeMobileNumpad();
      const ch = state.allChannels.find(c => c.num === num && c.stream_url);
      if (ch) openPlayer(ch);
    } else {
      closeMobileNumpad();
    }
  });
}

/* ══════════════════════════════════════════════════════════
   CLOCK
══════════════════════════════════════════════════════════ */
function updateClocks() {
  const now = new Date();
  const t = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
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
    document.getElementById(`screen-${s}`).classList.toggle('active', s === name);
  });
  state.activeScreen = name;
}

/* ══════════════════════════════════════════════════════════
   EXIT DIALOG
══════════════════════════════════════════════════════════ */
function showExitDialog() {
  state.exitDialogOpen = true;
  state.exitFocusBtn = 'stay';
  dom.exitDialog().classList.add('active');
  dom.exitStay().classList.add('focused');
  dom.exitLeave().classList.remove('focused');
}

function hideExitDialog() {
  state.exitDialogOpen = false;
  dom.exitDialog().classList.remove('active');
  dom.exitStay().classList.remove('focused');
  dom.exitLeave().classList.remove('focused');
}

function exitApp() {
  try { window.close(); } catch (e) {}
  // Fallback: clear the page
  document.body.innerHTML = '<div style="background:#000;height:100vh;display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px;font-family:sans-serif">Goodbye! You can now close this tab.</div>';
}

function handleExitDialogNav({ isBack, isEnter, isLeft, isRight }) {
  if (isLeft || isRight) {
    state.exitFocusBtn = state.exitFocusBtn === 'stay' ? 'leave' : 'stay';
    dom.exitStay().classList.toggle('focused', state.exitFocusBtn === 'stay');
    dom.exitLeave().classList.toggle('focused', state.exitFocusBtn === 'leave');
    return;
  }
  if (isEnter) {
    if (state.exitFocusBtn === 'stay') hideExitDialog();
    else exitApp();
    return;
  }
  if (isBack) {
    // Second Back = exit
    exitApp();
  }
}

/* ══════════════════════════════════════════════════════════
   FAVOURITES
══════════════════════════════════════════════════════════ */
function loadFavorites() {
  try {
    return new Set(JSON.parse(localStorage.getItem(CONFIG.favStorageKey) || '[]'));
  } catch {
    return new Set();
  }
}

function saveFavorites() {
  localStorage.setItem(CONFIG.favStorageKey, JSON.stringify([...state.favorites]));
}

function toggleFavorite(channelId) {
  if (state.favorites.has(channelId)) {
    state.favorites.delete(channelId);
  } else {
    state.favorites.add(channelId);
  }
  saveFavorites();
  
  // Rebuild categories to update Favourites count/presence
  buildCategories(state.allChannels);
  
  // Immediately re-sort and re-render the grid so the item jumps to the top
  if (state.activeScreen === 'home') {
    applyFilter();
    // Keep focus within bounds
    if (state.focusZone === 'grid') {
      focusGridItem(Math.min(state.focusIndex, state.gridItems.length - 1));
    }
  }

  // If the player panel is open, re-render it to sort it there too
  if (state.panelOpen) {
    renderChannelPanel(dom.pcpSearchInput().value.trim());
  }

  // If we are currently watching this channel, update the HUD heart button
  if (state.activeScreen === 'player' && state.currentChannel && state.currentChannel.id === channelId) {
    updateHudFavBtn();
  }
}

function toggleFavoriteOnFocused() {
  const ch = state.filteredChannels[state.focusIndex];
  if (ch) toggleFavorite(ch.id);
}

function toggleFavoritePlayer() {
  if (state.currentChannel) toggleFavorite(state.currentChannel.id);
}

/* ══════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════ */
async function init() {
  loadFavorites();
  await loadChannels();
  
  _setupSidebarListeners();
  _setupNumpadListeners();
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
    // Assign stable 1-based channel numbers
    channels.forEach((ch, i) => { ch.num = i + 1; });
    
    state.allChannels = channels;
    buildCategories(channels);
    applyFilter();
    dom.errorScreen().classList.remove('active');
  } catch (err) {
    console.error('Failed to load channels:', err);
    dom.channelGrid().innerHTML = '';
    dom.errorScreen().classList.add('active');
    state.focusZone = 'error';
  }
}

function buildCategories(channels) {
  const otherCats = [...new Set(channels.map(c => c.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const cats = ['❤ Favourites', 'All', ...otherCats];
  state.categories = cats;
  renderSidebar(cats);
}

/* ══════════════════════════════════════════════════════════
   FILTER & SORT
══════════════════════════════════════════════════════════ */
function applyFilter(searchTerm = '') {
  let list = [...state.allChannels];

  if (state.selectedCategory === '❤ Favourites') {
    list = list.filter(ch => state.favorites.has(ch.id));
  } else if (state.selectedCategory !== 'All') {
    list = list.filter(ch => ch.category === state.selectedCategory);
  }

  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    list = list.filter(ch =>
      ch.name.toLowerCase().includes(q) ||
      (ch.category || '').toLowerCase().includes(q)
    );
  }

  if (state.selectedSort === 'az') {
    list.sort((a, b) => a.name.localeCompare(b.name));
  } else if (state.selectedSort === 'za') {
    list.sort((a, b) => b.name.localeCompare(a.name));
  } else if (state.selectedSort === 'cat') {
    list.sort((a, b) =>
      (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name)
    );
  }

  // Always bring favourites to the top if we aren't already filtered specifically for them
  if (state.selectedCategory !== '❤ Favourites') {
    list.sort((a, b) => {
      const aFav = state.favorites.has(a.id);
      const bFav = state.favorites.has(b.id);
      if (aFav && !bFav) return -1;
      if (!aFav && bFav) return 1;
      return 0; // maintain previous sort order if both are same
    });
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
  sidebar.innerHTML = '<div class="sidebar-section-label">CATEGORIES</div>';

  categories.forEach(cat => {
    const item = document.createElement('div');
    item.className = 'sidebar-item' + (cat === state.selectedCategory ? ' selected' : '');
    item.textContent = cat;
    item.dataset.category = cat;
    item.tabIndex = -1;
    // Click / Enter support
    item.addEventListener('click', () => activateSidebarItem(item));
    sidebar.appendChild(item);
  });

  const sortLabel = document.createElement('div');
  sortLabel.className = 'sidebar-section-label';
  sortLabel.style.marginTop = '16px';
  sortLabel.textContent = 'SORT';
  sidebar.appendChild(sortLabel);

  const sorts = [
    { value: 'default', label: '— Default —' },
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
    item.addEventListener('click', () => activateSidebarItem(item));
    sidebar.appendChild(item);
  });

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

  state.focusIndex = Math.min(state.focusIndex, state.gridItems.length - 1);
  focusGridItem(state.focusIndex);
}

function createCard(ch, idx) {
  const card = document.createElement('div');
  card.className = 'channel-card';
  card.role = 'listitem';
  card.tabIndex = -1;
  card.dataset.idx = idx;
  card.dataset.chId = ch.id;

  // Generate deterministic gradient and initials for fallback artwork
  const gradient = _generateChannelGradient(ch.id);
  const initials = _getChannelInitials(ch.name);

  const logoHtml = ch.logo_url
    ? `<div class="logo-fallback" style="background:${gradient}">${initials}</div>
       <img src="${escHtml(ch.logo_url)}" alt="${escHtml(ch.name)}" loading="lazy"
            onerror="this.style.display='none'" />`
    : `<div class="logo-fallback" style="background:${gradient}">${initials}</div>`;

  const isFav = state.favorites.has(ch.id);
  const chNum = ch.num != null ? `<span class="card-num">${ch.num}</span>` : '';

  card.innerHTML = `
    ${chNum}
    <div class="card-logo">${logoHtml}</div>
    <div class="card-info">
      <div class="card-name">${escHtml(ch.name)}</div>
      <div class="card-category">${escHtml(ch.category || '')}</div>
    </div>
    <button class="card-fav-btn${isFav ? ' active' : ''}" title="Favourite" tabindex="-1">♥</button>
  `;
  // NO per-card event listeners — handled by grid-level delegation
  return card;
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* Fallback Artwork Generators */
function _getChannelInitials(name) {
  if (!name) return 'TV';
  // Strip common prefixes/suffixes but return the full name
  return name.replace(/^(hd|fhd|4k)\s+/i, '').replace(/\b(tv|hd)\b/ig, '').replace(/[\(\)\[\]]/g, '').trim();
}

function _generateChannelGradient(idStr) {
  let hash = 0;
  for (let i = 0; i < idStr.length; i++) {
    hash = idStr.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Hue 1: based directly on hash
  const h1 = Math.abs(hash % 360);
  // Hue 2: analagous or complementary (+40 to +140 deg)
  const h2 = (h1 + 40 + Math.abs((hash >> 8) % 100)) % 360;
  
  // Keep saturation high, lightness medium-low for a premium dark-mode look
  return `linear-gradient(135deg, hsl(${h1}, 80%, 25%), hsl(${h2}, 85%, 20%))`;
}

/* ══════════════════════════════════════════════════════════
   FOCUS MANAGEMENT
══════════════════════════════════════════════════════════ */
function focusGridItem(idx) {
  if (state.gridItems.length === 0) return;
  idx = Math.max(0, Math.min(idx, state.gridItems.length - 1));
  state.gridItems.forEach((el, i) => el.classList.toggle('focused', i === idx));
  state.focusIndex = idx;
  state.gridItems[idx].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  unfocusSidebar();
  unfocusTopbar();
  state.focusZone = 'grid';
}

function focusSidebarItem(idx) {
  idx = Math.max(0, Math.min(idx, state.sidebarItems.length - 1));
  state.sidebarItems.forEach((el, i) => el.classList.toggle('focused', i === idx));
  state.sidebarFocusIdx = idx;
  state.sidebarItems[idx].scrollIntoView({ block: 'nearest' });
  unfocusGrid();
  unfocusTopbar();
  state.focusZone = 'sidebar';
}

function focusTopbar() {
  state.focusZone = 'topbar';
  dom.btnSearch().classList.add('focused');
  unfocusGrid();
  unfocusSidebar();
}

function unfocusGrid()    { state.gridItems.forEach(el => el.classList.remove('focused')); }
function unfocusSidebar() { state.sidebarItems.forEach(el => el.classList.remove('focused')); }
function unfocusTopbar()  { dom.btnSearch().classList.remove('focused'); }

/* Activate (select) a sidebar item — works via click or keyboard */
function activateSidebarItem(el) {
  state.sidebarItems.forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');

  if ('category' in el.dataset) {
    state.selectedCategory = el.dataset.category;
    state.focusIndex = 0;
    applyFilter();
    focusGridItem(0);
    closeMobileSidebar(); // Auto-close on selection
  } else if ('sort' in el.dataset) {
    state.selectedSort = el.dataset.sort;
    state.focusIndex = 0;
    applyFilter();
    closeMobileSidebar(); // Auto-close on selection
    // Stay in sidebar after changing sort
  }
}

function selectSidebarItem(idx) {
  const el = state.sidebarItems[idx];
  if (el) activateSidebarItem(el);
}

/* ══════════════════════════════════════════════════════════
   FULLSCREEN
══════════════════════════════════════════════════════════ */
function toggleFullscreen() {
  const doc = window.document;
  const docEl = doc.documentElement;

  const requestFullScreen = docEl.requestFullscreen || docEl.mozRequestFullScreen || docEl.webkitRequestFullScreen || docEl.msRequestFullscreen;
  const cancelFullScreen = doc.exitFullscreen || doc.mozCancelFullScreen || doc.webkitExitFullscreen || doc.msExitFullscreen;
  
  // Is fullscreen currently active?
  const isFullscreen = doc.fullscreenElement || doc.mozFullScreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement;

  if (!isFullscreen) {
    if (requestFullScreen) {
      requestFullScreen.call(docEl).then(() => {
        // Try to force landscape orientation on mobile
        if (screen.orientation && screen.orientation.lock) {
          screen.orientation.lock('landscape').catch(() => {});
        }
      }).catch(() => {});
    } else {
      // iOS Safari fallback on iPhones (doesn't support full API, but can fullscreen the video element directly)
      const video = dom.playerVideo();
      if (video && video.webkitEnterFullscreen) {
        video.webkitEnterFullscreen();
      }
    }
    // Also try to lock if using fallback (it might fail on iOS, but safe to attempt)
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(() => {});
    }
    
    dom.hudFsBtn().textContent = '⊠';
    dom.hudFsBtn().title = 'Exit Fullscreen';
  } else {
    if (cancelFullScreen) {
      cancelFullScreen.call(doc).catch(() => {});
    }
    // Unlock orientation
    if (screen.orientation && screen.orientation.unlock) {
      screen.orientation.unlock();
    }
    dom.hudFsBtn().textContent = '⛶';
    dom.hudFsBtn().title = 'Fullscreen';
  }
}

// Watch for ALL vendor-prefix fullscreen changes to update the button icon accurately
['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'].forEach(eventName => {
  document.addEventListener(eventName, () => {
    const isFs = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
    dom.hudFsBtn().textContent = isFs ? '⊠' : '⛶';
  });
});

/* ══════════════════════════════════════════════════════════
   PICTURE IN PICTURE
   ══════════════════════════════════════════════════════════ */
async function togglePiP() {
  const video = dom.playerVideo();
  if (!video || !document.pictureInPictureEnabled) return;

  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else {
      await video.requestPictureInPicture();
    }
  } catch (error) {
    console.error('PiP failed:', error);
  }
}

// Update PiP icon based on state
if (document.pictureInPictureEnabled) {
  const video = dom.playerVideo();
  video.addEventListener('enterpictureinpicture', () => {
    dom.hudPipBtn().textContent = '❐'; // or some other icon
    dom.hudPipBtn().title = 'Exit PiP';
  });
  video.addEventListener('leavepictureinpicture', () => {
    dom.hudPipBtn().textContent = '📺';
    dom.hudPipBtn().title = 'Picture-in-Picture';
  });
} else {
  // Hide PiP button if not supported
  setTimeout(() => {
    const btn = dom.hudPipBtn();
    if (btn) btn.style.display = 'none';
  }, 100);
}

/* ══════════════════════════════════════════════════════════
   MEDIA SESSION (Background Playback & Lock Screen)
   ══════════════════════════════════════════════════════════ */
function updateMediaSession(channel) {
  if (!('mediaSession' in navigator) || !channel) return;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: channel.name,
    artist: 'MasTV — Live Iranian TV',
    album: channel.category || 'Streaming',
    artwork: channel.logo_url ? [
      { src: channel.logo_url, sizes: '96x96',   type: 'image/png' },
      { src: channel.logo_url, sizes: '128x128', type: 'image/png' },
      { src: channel.logo_url, sizes: '192x192', type: 'image/png' },
      { src: channel.logo_url, sizes: '256x256', type: 'image/png' },
      { src: channel.logo_url, sizes: '384x384', type: 'image/png' },
      { src: channel.logo_url, sizes: '512x512', type: 'image/png' },
    ] : []
  });

  navigator.mediaSession.setActionHandler('play', () => {
    dom.playerVideo().play().catch(() => {});
  });
  navigator.mediaSession.setActionHandler('pause', () => {
    dom.playerVideo().pause();
  });
  // Next/Prev can switch channels if desired
  navigator.mediaSession.setActionHandler('previoustrack', () => switchChannel(-1));
  navigator.mediaSession.setActionHandler('nexttrack', () => switchChannel(1));

  navigator.mediaSession.playbackState = 'playing';
}

/* ══════════════════════════════════════════════════════════
   CHANNEL SWITCHING
   ══════════════════════════════════════════════════════════ */
function switchChannel(offset) {
  if (!state.currentChannel || !state.allChannels.length) return;
  
  // Use the established sorting (favourites first, then number)
  // This matches how they appear in the side panel
  const list = [...state.allChannels].sort((a, b) => {
    const aFav = state.favorites.has(a.id);
    const bFav = state.favorites.has(b.id);
    if (aFav && !bFav) return -1;
    if (!aFav && bFav) return 1;
    return (a.num || 0) - (b.num || 0);
  });

  const currentIdx = list.findIndex(ch => ch.id === state.currentChannel.id);
  if (currentIdx === -1) return;

  const nextIdx = (currentIdx + offset + list.length) % list.length;
  const ch = list[nextIdx];
  if (ch) openPlayer(ch);
}

// Handle browser tab switching / visibility
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    const video = dom.playerVideo();
    // If we're on player screen and have a channel, ensure it's playing
    if (state.activeScreen === 'player' && state.currentChannel && video.paused) {
      video.play().catch(() => {});
    }
  }
});

// Sync MediaSession state with video events
const _v = dom.playerVideo();
if (_v) {
  _v.addEventListener('play', () => {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  });
  _v.addEventListener('pause', () => {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
  });
}

/* ══════════════════════════════════════════════════════════
   PLAYER CHANNEL PANEL
══════════════════════════════════════════════════════════ */
function openChannelPanel() {
  state.panelOpen = true;
  state.focusZone = 'player-panel';
  dom.pcpSearchInput().value = '';
  renderChannelPanel();
  dom.playerChannelPanel().classList.add('open');
  _focusPanelItem(state.panelFocusIdx);
  showHud();
}

function closeChannelPanel() {
  state.panelOpen = false;
  state.focusZone = 'player';
  dom.pcpSearchInput().value = '';
  dom.playerChannelPanel().classList.remove('open');
}

function renderChannelPanel(filter = '') {
  const list = dom.pcpList();
  list.innerHTML = '';
  const q = filter.toLowerCase();
  const playableChannels = state.allChannels
    .filter(ch => ch.stream_url && ch.working !== false)
    .filter(ch => !q || ch.name.toLowerCase().includes(q) || (ch.category || '').toLowerCase().includes(q));

  // Bring favourites to the top, fallback to channel number
  playableChannels.sort((a, b) => {
    const aFav = state.favorites.has(a.id);
    const bFav = state.favorites.has(b.id);
    if (aFav && !bFav) return -1;
    if (!aFav && bFav) return 1;
    return a.num - b.num;
  });

  if (!playableChannels.length) {
    list.innerHTML = '<div class="pcp-no-results">No channels found</div>';
    list.onclick = null;
    return;
  }

  playableChannels.forEach((ch, idx) => {
    const item = document.createElement('div');
    item.className = 'pcp-item' + (state.currentChannel && ch.id === state.currentChannel.id ? ' active' : '');
    item.dataset.idx = idx;

    const gradient = _generateChannelGradient(ch.id);
    const initials = _getChannelInitials(ch.name);

    item.innerHTML = `
      <div class="pcp-item-logo">
        ${ch.logo_url
          ? `<div class="logo-fallback" style="background:${gradient};font-size:12px;display:flex;align-items:center;justify-content:center;width:100%;height:100%">${initials}</div>
             <img src="${escHtml(ch.logo_url)}" alt="" loading="lazy" onerror="this.previousElementSibling.style.display='flex';this.style.display='none'" style="position:relative;z-index:2;width:100%;height:100%;object-fit:contain" />`
          : `<div class="logo-fallback" style="background:${gradient};font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:rgba(255,255,255,0.9);text-shadow:0 1px 3px rgba(0,0,0,0.5)">${initials}</div>`}
      </div>
      <div class="pcp-item-info">
        <div class="pcp-item-name">
          ${state.favorites.has(ch.id) ? '<span style="color:#e5142a;margin-right:4px;font-size:11px">♥</span>' : ''}
          ${escHtml(ch.name)}
        </div>
        <div class="pcp-item-cat">${escHtml(ch.category || '')}</div>
      </div>
    `;
    list.appendChild(item);
  });
  // Single delegated listener on the list container (replaces N per-item listeners)
  list.onclick = e => {
    const item = e.target.closest('.pcp-item');
    if (!item) return;
    const ch = playableChannels[parseInt(item.dataset.idx)];
    if (ch) { openPlayer(ch); closeChannelPanel(); }
  };
  // Scroll active item into view
  const activeItem = list.querySelector('.pcp-item.active');
  if (activeItem) {
    state.panelFocusIdx = parseInt(activeItem.dataset.idx);
    activeItem.scrollIntoView({ block: 'nearest' });
  }
}

function _focusPanelItem(idx) {
  const items = dom.pcpList().querySelectorAll('.pcp-item');
  if (!items.length) return;
  idx = Math.max(0, Math.min(idx, items.length - 1));
  items.forEach((el, i) => el.classList.toggle('focused', i === idx));
  state.panelFocusIdx = idx;
  items[idx].scrollIntoView({ block: 'nearest' });
}

function _switchFromPanel(idx) {
  const items = dom.pcpList().querySelectorAll('.pcp-item');
  const el = items[idx];
  if (!el) return;
  const ch = state.allChannels.filter(c => c.stream_url && c.working !== false)[idx];
  if (ch) { openPlayer(ch); }
  closeChannelPanel();
}

/* ══════════════════════════════════════════════════════════
   PLAYER
══════════════════════════════════════════════════════════ */
function openPlayer(channel) {
  showScreen('player');
  state.focusZone = 'player';
  state.currentChannel = channel;

  const hudLogo = dom.hudLogo();
  if (channel.logo_url) {
    hudLogo.src = channel.logo_url;
    hudLogo.style.display = '';
  } else {
    hudLogo.style.display = 'none';
  }
  dom.hudName().textContent = `${channel.num != null ? channel.num + '. ' : ''}${channel.name}`;
  dom.hudStatus().textContent = 'Connecting…';
  dom.streamError().classList.remove('active');
  dom.bufferingSpinner().classList.add('active');
  dom.hudHomeBtn().classList.remove('focused');
  updateHudFavBtn();
  updateMediaSession(channel);
  showHud();
  startStream(channel.stream_url);
}

function updateHudFavBtn() {
  const btn = dom.hudFavBtn();
  if (!btn || !state.currentChannel) return;
  const isFav = state.favorites.has(state.currentChannel.id);
  btn.classList.toggle('active', isFav);
  btn.title = isFav ? 'Remove from Favourites' : 'Add to Favourites';
}

function goHome() {
  stopStream();
  showScreen('home');
  state.focusZone = 'grid';
  focusGridItem(Math.max(0, Math.min(state.focusIndex, state.gridItems.length - 1)));
}

function startStream(url) {
  const video = dom.playerVideo();
  if (state.hls) { state.hls.destroy(); state.hls = null; }
  video.src = '';

  if (!url) { showStreamError(); return; }

  if (Hls.isSupported()) {
    const hls = new Hls({
      enableWorker:        true,
      maxBufferLength:     15,          // buffer 15s ahead (default 30)
      maxMaxBufferLength:  30,          // never exceed 30s
      maxBufferSize:       60 * 1000 * 1000, // 60 MB cap (default 60 but explicit)
      maxBufferHole:       0.5,
      lowLatencyMode:      false,
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

    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (data.fatal) showStreamError();
      else {
        dom.bufferingSpinner().classList.add('active');
        dom.hudStatus().textContent = 'Buffering…';
      }
    });

    hls.on(Hls.Events.FRAG_BUFFERED, () => {
      dom.bufferingSpinner().classList.remove('active');
      if (dom.hudStatus().textContent === 'Buffering…') {
        dom.hudStatus().textContent = 'Playing';
      }
    });

    hls.loadSource(url);
    hls.attachMedia(video);

  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
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
  if (state.hls) { state.hls.destroy(); state.hls = null; }
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
  state.hudTimer = setTimeout(() => dom.playerHud().classList.add('hidden'), CONFIG.overlayHideDelay);
}

/* ══════════════════════════════════════════════════════════
   SEARCH
══════════════════════════════════════════════════════════ */
let searchGridItems = [];
let searchFocusIdx  = 0;

function openSearch() {
  showScreen('search');
  state.focusZone = 'search';
  const input = dom.searchInput();
  input.value = '';
  renderSearchGrid(state.allChannels);
  input.focus();
}

function closeSearch() {
  showScreen('home');
  state.focusZone = 'grid';
  focusGridItem(Math.min(state.focusIndex, state.gridItems.length - 1));
}

function renderSearchGrid(channels) {
  renderGrid(dom.searchGrid(), channels);
  searchGridItems = Array.from(dom.searchGrid().querySelectorAll('.channel-card'));
  searchFocusIdx = 0;
  if (searchGridItems[0]) searchGridItems[0].classList.add('focused');
}

function focusSearchItem(idx) {
  searchGridItems = Array.from(dom.searchGrid().querySelectorAll('.channel-card'));
  searchGridItems.forEach((el, i) => el.classList.toggle('focused', i === idx));
  searchFocusIdx = idx;
  if (searchGridItems[idx]) searchGridItems[idx].scrollIntoView({ block: 'nearest' });
}

dom.searchInput().addEventListener('input', () => {
  const q = dom.searchInput().value.trim();
  const filtered = state.allChannels.filter(ch =>
    ch.name.toLowerCase().includes(q.toLowerCase()) ||
    (ch.category || '').toLowerCase().includes(q.toLowerCase())
  );
  renderSearchGrid(filtered);
});

/* ══════════════════════════════════════════════════════════
   KEYBOARD / D-PAD NAVIGATION
══════════════════════════════════════════════════════════ */
const BACK_KEYCODES = new Set([8, 27, 461, 10009]);
// Yellow remote button (405) or F key = toggle favourite
const isFavKey = e => e.keyCode === 405 || e.key === 'f' || e.key === 'F';

document.addEventListener('keydown', e => {
  const key   = e.key;
  const code  = e.keyCode;

  // If the search input is focused, let Backspace work normally (delete char)
  // Only Escape should close the search in that case
  const searchFocused = document.activeElement === dom.searchInput();

  const isBack  = searchFocused
    ? key === 'Escape' || code === 461 || code === 10009
    : BACK_KEYCODES.has(code) || key === 'Escape' || key === 'Backspace';
  const isEnter = key === 'Enter' || code === 13;
  const isUp    = key === 'ArrowUp';
  const isDown  = key === 'ArrowDown';
  const isLeft  = key === 'ArrowLeft';
  const isRight = key === 'ArrowRight';
  
  const isPip   = key === 'p' || key === 'P'; // P key for PiP
  
  const isDigit  = key >= '0' && key <= '9' && !e.ctrlKey && !e.metaKey;
  const numpadDigit = key.startsWith('Numpad') ? key.replace('Numpad','') : null;

  const nav = { isBack, isEnter, isUp, isDown, isLeft, isRight };


  // Exit dialog captures all input
  if (state.exitDialogOpen) {
    e.preventDefault();
    handleExitDialogNav(nav);
    return;
  }

  // Prevent browser default for arrow keys and backspace
  if (isUp || isDown || isLeft || isRight || isBack) e.preventDefault();

  // Digit / numpad — channel number input while in player
  const digit = (isDigit && key) || (numpadDigit && numpadDigit >= '0' && numpadDigit <= '9' && numpadDigit);
  if (digit) {
    e.preventDefault();
    _handleDigitKey(digit);
    return;
  }

  // Favourite toggle: F key or Yellow remote button (works on all screens)
  if (isFavKey(e) && !state.exitDialogOpen && !searchFocused) {
    e.preventDefault();
    if (state.activeScreen === 'player') toggleFavoritePlayer();
    else if (state.activeScreen === 'home' && state.focusZone === 'grid') toggleFavoriteOnFocused();
    return;
  }

  // PiP toggle shortcut
  if (isPip && state.activeScreen === 'player') {
    e.preventDefault();
    togglePiP();
    return;
  }

  switch (state.activeScreen) {
    case 'home':   handleHomeNav(nav); break;
    case 'player': handlePlayerNav(nav); break;
    case 'search': handleSearchNav(nav, e); break;
  }
});

/* ── Home Navigation ──────────────────────────────────────── */
function handleHomeNav({ isBack, isEnter, isUp, isDown, isLeft, isRight }) {
  if (isBack) {
    showExitDialog();
    return;
  }

  if (state.focusZone === 'error') {
    if (isEnter) loadChannels();
    return;
  }

  if (state.focusZone === 'topbar') {
    if (isEnter) openSearch();
    if (isDown)  focusSidebarItem(0);
    if (isLeft)  focusSidebarItem(0);
    return;
  }

  if (state.focusZone === 'sidebar') {
    if (isUp) {
      if (state.sidebarFocusIdx === 0) focusTopbar();
      else focusSidebarItem(state.sidebarFocusIdx - 1);
    } else if (isDown) {
      if (state.sidebarFocusIdx < state.sidebarItems.length - 1)
        focusSidebarItem(state.sidebarFocusIdx + 1);
    } else if (isRight) {
      focusGridItem(Math.min(state.focusIndex, state.gridItems.length - 1));
    } else if (isEnter) {
      selectSidebarItem(state.sidebarFocusIdx);
    }
    return;
  }

  // focusZone === 'grid'
  const cols  = getGridCols(dom.channelGrid());
  const total = state.gridItems.length;
  let idx = state.focusIndex;

  if (isUp) {
    if (idx < cols) focusTopbar();
    else focusGridItem(idx - cols);
  } else if (isDown) {
    if (idx + cols < total) focusGridItem(idx + cols);
  } else if (isLeft) {
    if (idx % cols === 0) focusSidebarItem(state.sidebarFocusIdx);
    else focusGridItem(idx - 1);
  } else if (isRight) {
    if (idx < total - 1) focusGridItem(idx + 1);
  } else if (isEnter) {
    const ch = state.filteredChannels[idx];
    if (ch) openPlayer(ch);
  }
}

/* ── Player Navigation ────────────────────────────────────── */
function handlePlayerNav({ isBack, isEnter, isUp, isDown, isLeft, isRight }) {
  // Any key = wake up HUD
  showHud();

  if (isBack) {
    if (state.panelOpen) { closeChannelPanel(); return; }
    goHome();
    return;
  }

  // ── Channel panel is open ────────────────────────────────
  if (state.focusZone === 'player-panel') {
    const items = dom.pcpList().querySelectorAll('.pcp-item');
    const total = items.length;
    if (isUp)    _focusPanelItem(state.panelFocusIdx - 1);
    else if (isDown)  _focusPanelItem(state.panelFocusIdx + 1);
    else if (isEnter) _switchFromPanel(state.panelFocusIdx);
    else if (isRight) closeChannelPanel();
    return;
  }

  // ── HUD button zones ─────────────────────────────────────
  if (state.focusZone === 'player-fav') {
    if (isEnter) { toggleFavoritePlayer(); updateHudFavBtn(); return; }
    if (isLeft)  { dom.hudFavBtn().classList.remove('focused'); state.focusZone = 'player-home'; dom.hudHomeBtn().classList.add('focused'); return; }
    if (isRight || isDown || isUp) { dom.hudFavBtn().classList.remove('focused'); state.focusZone = 'player'; return; }
    return;
  }

  if (state.focusZone === 'player-home') {
    if (isEnter) { goHome(); return; }
    if (isRight) { dom.hudHomeBtn().classList.remove('focused'); state.focusZone = 'player-fav'; dom.hudFavBtn().classList.add('focused'); return; }
    if (isDown || isLeft || isUp) { dom.hudHomeBtn().classList.remove('focused'); state.focusZone = 'player'; return; }
    return;
  }

  // ── Default player zone ──────────────────────────────────
  if (isLeft)  { openChannelPanel(); return; }
  if (isRight) { switchChannel(1); return; }
  if (isUp)    { switchChannel(1); return; }
  if (isDown)  { switchChannel(-1); return; }
}

/* ── Search Navigation ────────────────────────────────────── */
function handleSearchNav({ isBack, isEnter, isUp, isDown, isLeft, isRight }, e) {
  if (isBack) { closeSearch(); return; }

  const cols  = getGridCols(dom.searchGrid());
  const total = searchGridItems.length;
  let idx = searchFocusIdx;

  if (isUp)    { if (idx >= cols) focusSearchItem(idx - cols); }
  else if (isDown)  { if (idx + cols < total) focusSearchItem(idx + cols); }
  else if (isLeft)  { if (idx % cols !== 0) focusSearchItem(idx - 1); }
  else if (isRight) { if (idx < total - 1)  focusSearchItem(idx + 1); }
  else if (isEnter) {
    const q = dom.searchInput().value.toLowerCase();
    const filtered = state.allChannels.filter(ch =>
      ch.name.toLowerCase().includes(q) || (ch.category || '').toLowerCase().includes(q)
    );
    const ch = filtered[idx];
    if (ch) { closeSearch(); openPlayer(ch); }
  }
}

/* ── Button event listeners ───────────────────────────────── */
dom.btnSearch().addEventListener('click', openSearch);
dom.retryBtn().addEventListener('click', () => { dom.errorScreen().classList.remove('active'); loadChannels(); });
dom.hudHomeBtn().addEventListener('click', goHome);
dom.hudFavBtn().addEventListener('click', () => { toggleFavoritePlayer(); updateHudFavBtn(); });
dom.hudPanelBtn().addEventListener('click', () => state.panelOpen ? closeChannelPanel() : openChannelPanel());
dom.hudPipBtn().addEventListener('click', togglePiP);
dom.hudFsBtn().addEventListener('click', toggleFullscreen);
dom.pcpCloseBtn().addEventListener('click', closeChannelPanel);
dom.exitStay().addEventListener('click', hideExitDialog);
dom.exitLeave().addEventListener('click', exitApp);

/* Panel search input — filter list on every keystroke */
dom.pcpSearchInput().addEventListener('input', () => {
  renderChannelPanel(dom.pcpSearchInput().value.trim());
  state.panelFocusIdx = 0;
  _focusPanelItem(0);
});

// Stream error mobile back button
dom.streamErrorBack().addEventListener('click', goHome);

/* Stop Back/arrows from bubbling to D-pad handler while typing in panel */
dom.pcpSearchInput().addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Escape') closeChannelPanel();
});

/* Delegated grid click — handles play + fav toggle for ALL cards with ONE listener each */
function _delegatedGridClick(e, channelList) {
  const favBtn = e.target.closest('.card-fav-btn');
  if (favBtn) {
    e.stopPropagation();
    const card = favBtn.closest('.channel-card');
    if (card) toggleFavorite(card.dataset.chId);
    return;
  }
  const card = e.target.closest('.channel-card');
  if (card) {
    const ch = channelList[parseInt(card.dataset.idx)];
    if (ch) openPlayer(ch);
  }
}
dom.channelGrid().addEventListener('click', e => _delegatedGridClick(e, state.filteredChannels));
dom.searchGrid().addEventListener('click',  e => {
  const q = dom.searchInput().value.toLowerCase();
  const filtered = state.allChannels.filter(ch =>
    ch.name.toLowerCase().includes(q) || (ch.category || '').toLowerCase().includes(q)
  );
  _delegatedGridClick(e, filtered);
});

/* Show HUD on mouse move or touch/click */
dom.playerScreen().addEventListener('mousemove', () => {
  if (state.activeScreen === 'player') showHud();
});
dom.playerScreen().addEventListener('click', (e) => {
  if (state.activeScreen === 'player') {
    // Ignore clicks on actionable overlays (buttons, panels, numpad, etc.)
    if (e.target.closest('button') || e.target.closest('.player-channel-panel') || e.target.closest('.numpad-overlay')) return;
    
    const hud = dom.playerHud();
    if (hud.classList.contains('hidden')) showHud();
    else hud.classList.add('hidden'); // Tap to dismiss
  }
});

/* ══════════════════════════════════════════════════════════
   INITIAL LOAD
══════════════════════════════════════════════════════════ */
init();
