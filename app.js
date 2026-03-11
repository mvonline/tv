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
  columns:          5,
  skeletonCount:    15,
  favStorageKey:    'mastv_favorites',
};

/* ── State ────────────────────────────────────────────────── */
const state = {
  allChannels:      [],
  filteredChannels: [],
  activeScreen:     'home',
  selectedCategory: 'All',
  selectedSort:     'default',
  focusZone:        'grid',   // 'sidebar' | 'grid' | 'topbar' | 'player' | 'player-home' | 'exit' | 'error'
  focusIndex:       0,
  sidebarFocusIdx:  0,
  exitFocusBtn:     'stay',   // 'stay' | 'leave'
  categories:       [],
  sidebarItems:     [],
  gridItems:        [],
  hudTimer:         null,
  hls:              null,
  exitDialogOpen:   false,
  favorites:        loadFavorites(),   // Set of channel id strings
  currentChannel:   null,              // channel object currently playing
};

/* ── DOM refs ─────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const dom = {
  screenHome:       () => $('screen-home'),
  screenPlayer:     () => $('screen-player'),
  screenSearch:     () => $('screen-search'),
  errorScreen:      () => $('error-screen'),
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
  bufferingSpinner: () => $('buffering-spinner'),
  streamError:      () => $('stream-error'),
  retryBtn:         () => $('retry-btn'),
  exitDialog:       () => $('exit-dialog'),
  exitStay:         () => $('exit-stay'),
  exitLeave:        () => $('exit-leave'),
};

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
  // Refresh grid heart icons and sidebar fav count
  renderGrid(dom.channelGrid(), state.filteredChannels);
  buildCategories(state.allChannels);
  // Restore focus
  focusGridItem(Math.min(state.focusIndex, state.gridItems.length - 1));
}

function toggleFavoriteOnFocused() {
  const ch = state.filteredChannels[state.focusIndex];
  if (ch) toggleFavorite(ch.id);
}

function toggleFavoritePlayer() {
  if (state.currentChannel) toggleFavorite(state.currentChannel.id);
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

  const logoHtml = ch.logo_url
    ? `<img src="${escHtml(ch.logo_url)}" alt="${escHtml(ch.name)}" loading="lazy"
          onerror="this.style.display='none';this.nextElementSibling.style.display='block'" />
       <span class="logo-fallback" style="display:none">📺</span>`
    : `<span class="logo-fallback">📺</span>`;

  const isFav = state.favorites.has(ch.id);

  card.innerHTML = `
    <div class="card-logo">${logoHtml}</div>
    <div class="card-info">
      <div class="card-name">${escHtml(ch.name)}</div>
      <div class="card-category">${escHtml(ch.category || '')}</div>
    </div>
    <button class="card-fav-btn${isFav ? ' active' : ''}" title="Favourite" tabindex="-1">♥</button>
  `;

  card.addEventListener('click', () => openPlayer(ch));
  card.querySelector('.card-fav-btn').addEventListener('click', e => {
    e.stopPropagation();
    toggleFavorite(ch.id);
  });
  return card;
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
  } else if ('sort' in el.dataset) {
    state.selectedSort = el.dataset.sort;
    state.focusIndex = 0;
    applyFilter();
    // Stay in sidebar after changing sort
  }
}

function selectSidebarItem(idx) {
  const el = state.sidebarItems[idx];
  if (el) activateSidebarItem(el);
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
  dom.hudName().textContent = channel.name;
  dom.hudStatus().textContent = 'Connecting…';
  dom.streamError().classList.remove('active');
  dom.bufferingSpinner().classList.add('active');
  dom.hudHomeBtn().classList.remove('focused');
  updateHudFavBtn();
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
    const hls = new Hls({ enableWorker: true });
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
  const nav = { isBack, isEnter, isUp, isDown, isLeft, isRight };


  // Exit dialog captures all input
  if (state.exitDialogOpen) {
    e.preventDefault();
    handleExitDialogNav(nav);
    return;
  }

  // Prevent browser default for arrow keys and backspace
  if (isUp || isDown || isLeft || isRight || isBack) e.preventDefault();

  // Favourite toggle: F key or Yellow remote button (works on all screens)
  if (isFavKey(e) && !state.exitDialogOpen && !searchFocused) {
    e.preventDefault();
    if (state.activeScreen === 'player') toggleFavoritePlayer();
    else if (state.activeScreen === 'home' && state.focusZone === 'grid') toggleFavoriteOnFocused();
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
  const cols  = CONFIG.columns;
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
    goHome();
    return;
  }

  // Fav button focus
  if (state.focusZone === 'player-fav') {
    if (isEnter) { toggleFavoritePlayer(); updateHudFavBtn(); return; }
    if (isLeft) {
      dom.hudFavBtn().classList.remove('focused');
      state.focusZone = 'player-home';
      dom.hudHomeBtn().classList.add('focused');
      return;
    }
    if (isDown || isRight || isUp) {
      dom.hudFavBtn().classList.remove('focused');
      state.focusZone = 'player';
      return;
    }
    return;
  }

  // Home button focus toggle
  if (state.focusZone === 'player-home') {
    if (isEnter) { goHome(); return; }
    if (isRight) {
      dom.hudHomeBtn().classList.remove('focused');
      state.focusZone = 'player-fav';
      dom.hudFavBtn().classList.add('focused');
      return;
    }
    if (isDown || isLeft || isUp) {
      dom.hudHomeBtn().classList.remove('focused');
      state.focusZone = 'player';
      return;
    }
    return;
  }

  // In player zone: Up → focus the home button
  if (isUp) {
    state.focusZone = 'player-home';
    dom.hudHomeBtn().classList.add('focused');
  }
}

/* ── Search Navigation ────────────────────────────────────── */
function handleSearchNav({ isBack, isEnter, isUp, isDown, isLeft, isRight }, e) {
  if (isBack) { closeSearch(); return; }

  const cols  = CONFIG.columns;
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
dom.exitStay().addEventListener('click', hideExitDialog);
dom.exitLeave().addEventListener('click', exitApp);

/* ══════════════════════════════════════════════════════════
   INITIAL LOAD
══════════════════════════════════════════════════════════ */
loadChannels();
