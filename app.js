// ================================================================
// FIREBASE — importy z CDN (ES module)
// ================================================================
import { initializeApp }                                  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInWithEmailAndPassword,
         onAuthStateChanged }                             from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getDatabase, ref, set, get }                    from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

// ================================================================
// FIREBASE KONFIGURACE
// Vyplňte hodnotami z Firebase konzole:
//   Project Settings → Your apps → Web app → firebaseConfig
// ================================================================
const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyDnYHbZnIQ_2QvAbUxGF4UsnfOggP6kTL0',
  authDomain:        'zasedaci-poradek.firebaseapp.com',
  databaseURL:       'https://zasedaci-poradek-default-rtdb.europe-west1.firebasedatabase.app',
  projectId:         'zasedaci-poradek',
  storageBucket:     'zasedaci-poradek.firebasestorage.app',
  messagingSenderId: '1066934378948',
  appId:             '1:1066934378948:web:6c9287a2a2e2e797354491',
};

// Sdílený e-mail pro všechny uživatele (jen heslo zadává uživatel)
const FIREBASE_EMAIL  = 'venaca99@gmail.com';
const FIREBASE_DB_PATH = 'zasedaci-poradek';

const fbApp = initializeApp(FIREBASE_CONFIG);
const auth  = getAuth(fbApp);
const db    = getDatabase(fbApp);

// ================================================================
// CONSTANTS
// ================================================================
const STORAGE_KEY = 'zasedaci-poradek-v1';

const SEAT_IDS = [
  ...Array.from({ length: 6 },  (_, i) => `head-${i + 1}`),
  ...Array.from({ length: 15 }, (_, i) => `left-inner-${i + 1}`),
  ...Array.from({ length: 15 }, (_, i) => `left-outer-${i + 1}`),
  ...Array.from({ length: 15 }, (_, i) => `right-inner-${i + 1}`),
  ...Array.from({ length: 15 }, (_, i) => `right-outer-${i + 1}`),
];

const DIET_FONT_ICONS = {
  vegetarian: 'eco',
  abstinent:  'no_drinks',
  child:      'child_care',
};
const DIET_LABELS = { standard: 'Standardní', vegetarian: 'Vegetarián', abstinent: 'Abstinent', child: 'Dítě' };
const RSVP_LABELS = { confirmed: 'Potvrzeno', pending: 'Čeká', declined: 'Odmítnuto' };


// ================================================================
// STATE
// ================================================================
const STATE = {
  guests: [],
  meta: {
    version: 1,
    brideName: 'Václav',
    groomName: 'Nikola',
    weddingDate: '2026-06-13',
  },
  filters: { side: 'all', diet: 'all', rsvp: 'all', group: '', search: '' },
  drag: { guestId: null, sourceType: null },
  editingGuestId: null,
};

// ================================================================
// PERSISTENCE — localStorage
// ================================================================
function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    guests: STATE.guests,
    meta: STATE.meta,
  }));
  if (auth.currentUser) debouncedSaveToFirebase();
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data.guests)) STATE.guests = data.guests;
  } catch (e) {
    console.error('Chyba při načítání z localStorage:', e);
  }
}

// ================================================================
// FIREBASE — sync
// ================================================================
async function loadFromFirebase() {
  try {
    const snapshot = await get(ref(db, FIREBASE_DB_PATH));
    const data = snapshot.val();
    if (data && Array.isArray(data.guests)) {
      STATE.guests = data.guests;
      // Aktualizuj lokální cache bez spuštění Firebase zápisu
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ guests: STATE.guests, meta: STATE.meta }));
      renderAll();
    } else {
      // Firebase je prázdná — nahraj data z localStorage
      load();
      renderAll();
      if (STATE.guests.length > 0) saveToFirebase();
    }
  } catch (e) {
    console.error('Chyba při načítání z Firebase:', e);
    load();
    renderAll();
  }
}

async function saveToFirebase() {
  if (!auth.currentUser) return;
  try {
    await set(ref(db, FIREBASE_DB_PATH), {
      guests: STATE.guests,
      meta: STATE.meta,
    });
  } catch (e) {
    console.error('Chyba při ukládání do Firebase:', e);
  }
}

function debounce(fn, ms) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}
const debouncedSaveToFirebase = debounce(saveToFirebase, 1000);

// ================================================================
// UTILITIES
// ================================================================
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function formatDate(iso) {
  try {
    return new Date(iso + 'T12:00:00').toLocaleDateString('cs-CZ', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ================================================================
// DATA MUTATIONS
// ================================================================
function addGuest(data) {
  STATE.guests.push({ id: uid(), seatId: null, ...data });
  persist();
}

function updateGuest(id, patch) {
  const g = STATE.guests.find(g => g.id === id);
  if (g) { Object.assign(g, patch); persist(); }
}

function deleteGuest(id) {
  STATE.guests = STATE.guests.filter(g => g.id !== id);
  persist();
}

function assignSeat(guestId, targetSeatId) {
  const guest = STATE.guests.find(g => g.id === guestId);
  if (!guest) return;
  const occupant = STATE.guests.find(g => g.seatId === targetSeatId && g.id !== guestId);
  const prevSeat = guest.seatId;
  if (occupant) occupant.seatId = prevSeat;
  guest.seatId = targetSeatId;
  persist();
}

function unassignGuest(guestId) {
  updateGuest(guestId, { seatId: null });
}

function getGuestAt(seatId) {
  return STATE.guests.find(g => g.seatId === seatId) || null;
}

// ================================================================
// RENDERING
// ================================================================
function renderAll() {
  renderSeats();
  renderGuestList();
  renderStats();
  renderMeta();
}

function renderMeta() {
  const el = document.getElementById('wedding-meta');
  if (el) el.textContent = `${STATE.meta.brideName} & ${STATE.meta.groomName} · ${formatDate(STATE.meta.weddingDate)}`;
  document.title = `Zasedací pořádek — ${STATE.meta.brideName} & ${STATE.meta.groomName}`;
}

function renderSeats() {
  for (const seatId of SEAT_IDS) {
    const cell = document.querySelector(`[data-seat-id="${seatId}"]`);
    if (cell) renderSeatCell(cell, getGuestAt(seatId));
  }
}

function renderSeatCell(cell, guest) {
  cell.className = 'seat ' + (guest ? 'occupied' : 'empty');
  cell.draggable = !!guest;
  cell.style.cssText = '';

  if (guest) {
    const dietSymbol = DIET_FONT_ICONS[guest.diet] || '';
    cell.innerHTML =
      (dietSymbol ? `<span class="seat-diet-icon material-symbols-outlined" title="${DIET_LABELS[guest.diet] || ''}">${dietSymbol}</span>` : '') +
      `<span class="seat-name">${escHtml(guest.firstName)}</span>` +
      `<span class="seat-surname">${escHtml(guest.lastName)}</span>`;
  } else {
    cell.innerHTML = `<span class="seat-empty-label">—</span>`;
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderGuestList() {
  const list = document.getElementById('guest-list');
  const filtered = getFilteredGuests().filter(g => !g.seatId);
  document.getElementById('unassigned-count').textContent = filtered.length;
  list.innerHTML = '';

  if (filtered.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = STATE.guests.filter(g => !g.seatId).length === 0
      ? '🎉 Všichni hosté jsou přiřazeni!'
      : 'Žádní hosté neodpovídají filtru';
    list.appendChild(li);
    return;
  }

  for (const g of filtered) list.appendChild(buildGuestCard(g));
}

function buildGuestCard(guest) {
  const li = document.createElement('li');
  li.className = 'guest-card';
  li.draggable = true;
  li.dataset.guestId = guest.id;
  li.dataset.side = guest.side || 'mutual';

  const dietSymbol = DIET_FONT_ICONS[guest.diet] || '';

  li.innerHTML =
    (dietSymbol ? `<span class="gc-diet-icon material-symbols-outlined" title="${DIET_LABELS[guest.diet] || ''}">${dietSymbol}</span>` : '') +
    `<div class="gc-body">` +
      `<div class="gc-name">${escHtml(guest.firstName)} ${escHtml(guest.lastName)}</div>` +
      (guest.group ? `<div class="gc-meta">${escHtml(guest.group)}</div>` : '') +
    `</div>` +
    `<button class="card-edit-btn" data-id="${guest.id}" title="Upravit">✏</button>`;

  return li;
}

function getFilteredGuests() {
  const { side, diet, rsvp, group, search } = STATE.filters;
  return STATE.guests.filter(g => {
    if (side  !== 'all' && g.side !== side) return false;
    if (diet  !== 'all' && g.diet !== diet) return false;
    if (rsvp  !== 'all' && g.rsvp !== rsvp) return false;
    if (group && !(g.group || '').toLowerCase().includes(group.toLowerCase())) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!`${g.firstName} ${g.lastName}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

function renderStats() {
  const total     = STATE.guests.length;
  const seated    = STATE.guests.filter(g => g.seatId).length;
  const confirmed = STATE.guests.filter(g => g.rsvp === 'confirmed').length;
  const dc = {};
  for (const g of STATE.guests) dc[g.diet] = (dc[g.diet] || 0) + 1;

  const sep = '<span class="stat-sep">·</span>';
  const parts = [
    `<strong>${seated} / 66</strong> míst`,
    `<strong>${total}</strong> hostů`,
    `${confirmed} potvrzeno`,
    [
      dc.vegetarian   ? `${dc.vegetarian} veg`        : '',
      dc.vegan        ? `${dc.vegan} vegan`           : '',
      dc.pescatarian  ? `${dc.pescatarian} pesk`      : '',
      dc.other        ? `${dc.other} alergie`         : '',
    ].filter(Boolean).join(' · '),
  ].filter(Boolean);

  document.getElementById('stats-bar').innerHTML = parts.join(` ${sep} `);
}

// ================================================================
// DOM CONSTRUCTION (SEATS)
// ================================================================
function buildVenue() {
  const headRow = document.getElementById('head-row');
  for (let i = 1; i <= 6; i++) headRow.appendChild(makeSeat(`head-${i}`));
  buildWing('left');
  buildWing('right');
}

function buildWing(side) {
  const inner = document.getElementById(`${side}-inner`);
  const outer = document.getElementById(`${side}-outer`);
  for (let i = 1; i <= 15; i++) {
    inner.appendChild(makeSeat(`${side}-inner-${i}`));
    outer.appendChild(makeSeat(`${side}-outer-${i}`));
  }
}

function makeSeat(seatId) {
  const div = document.createElement('div');
  div.className = 'seat empty';
  div.dataset.seatId = seatId;
  return div;
}

// ================================================================
// DRAG AND DROP — Mouse (HTML5 API)
// ================================================================
function initDragDrop() {
  const guestList      = document.getElementById('guest-list');
  const venue          = document.getElementById('venue');
  const unassignedArea = document.getElementById('unassigned-area');

  guestList.addEventListener('dragstart', e => {
    const card = e.target.closest('.guest-card');
    if (!card) return;
    STATE.drag = { guestId: card.dataset.guestId, sourceType: 'sidebar' };
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => card.classList.add('dragging'), 0);
  });
  guestList.addEventListener('dragend', e => {
    e.target.closest('.guest-card')?.classList.remove('dragging');
    clearDragState();
  });

  venue.addEventListener('dragstart', e => {
    const seat = e.target.closest('.seat.occupied');
    if (!seat) return;
    const g = getGuestAt(seat.dataset.seatId);
    if (!g) return;
    STATE.drag = { guestId: g.id, sourceType: 'seat' };
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => seat.classList.add('dragging'), 0);
  });
  venue.addEventListener('dragend', e => {
    e.target.closest('.seat')?.classList.remove('dragging');
    clearDragState();
  });

  venue.addEventListener('dragover', e => {
    const seat = e.target.closest('.seat');
    if (!seat || !STATE.drag.guestId) return;
    e.preventDefault();
    document.querySelectorAll('.seat.drag-over').forEach(s => s.classList.remove('drag-over'));
    seat.classList.add('drag-over');
  });
  venue.addEventListener('dragleave', e => {
    if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget)) {
      document.querySelectorAll('.seat.drag-over').forEach(s => s.classList.remove('drag-over'));
    }
  });
  venue.addEventListener('drop', e => {
    e.preventDefault();
    const seat = e.target.closest('.seat');
    document.querySelectorAll('.seat.drag-over').forEach(s => s.classList.remove('drag-over'));
    if (!seat || !STATE.drag.guestId) return;
    assignSeat(STATE.drag.guestId, seat.dataset.seatId);
    renderSeats(); renderGuestList(); renderStats();
    clearDragState();
  });

  venue.addEventListener('click', e => {
    const seat = e.target.closest('.seat.occupied');
    if (seat && !STATE.drag.guestId) {
      const g = getGuestAt(seat.dataset.seatId);
      if (g) openGuestModal(g.id);
    }
  });

  unassignedArea.addEventListener('dragover', e => {
    if (STATE.drag.sourceType === 'seat') {
      e.preventDefault();
      unassignedArea.classList.add('drag-over');
    }
  });
  unassignedArea.addEventListener('dragleave', () => {
    unassignedArea.classList.remove('drag-over');
  });
  unassignedArea.addEventListener('drop', e => {
    e.preventDefault();
    unassignedArea.classList.remove('drag-over');
    if (STATE.drag.sourceType === 'seat' && STATE.drag.guestId) {
      unassignGuest(STATE.drag.guestId);
      renderSeats(); renderGuestList(); renderStats();
    }
    clearDragState();
  });
}

function clearDragState() {
  STATE.drag = { guestId: null, sourceType: null };
}

// ================================================================
// DRAG AND DROP — Touch fallback
// ================================================================
function initTouchDrag() {
  let touchGuest = null;
  let ghost = null;

  document.addEventListener('touchstart', e => {
    const card = e.target.closest('.guest-card');
    const seat = e.target.closest('.seat.occupied');
    if (!card && !seat) return;

    if (card) {
      touchGuest = { id: card.dataset.guestId };
    } else {
      const g = getGuestAt(seat.dataset.seatId);
      if (!g) return;
      touchGuest = { id: g.id, fromSeat: seat.dataset.seatId };
    }

    const name = STATE.guests.find(g => g.id === touchGuest.id);
    ghost = document.createElement('div');
    ghost.className = 'touch-ghost';
    ghost.textContent = name ? `${name.firstName} ${name.lastName}` : '…';
    document.body.appendChild(ghost);
    updateGhostPos(e.touches[0]);
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!touchGuest || !ghost) return;
    updateGhostPos(e.touches[0]);

    document.querySelectorAll('.seat.touch-over').forEach(s => s.classList.remove('touch-over'));
    const el = document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY);
    el?.closest('.seat')?.classList.add('touch-over');
  }, { passive: true });

  document.addEventListener('touchend', e => {
    if (!touchGuest) return;
    const t = e.changedTouches[0];
    const el = document.elementFromPoint(t.clientX, t.clientY);
    const targetSeat = el?.closest('.seat');
    const inUnassigned = el?.closest('#unassigned-area');

    if (targetSeat) {
      assignSeat(touchGuest.id, targetSeat.dataset.seatId);
      renderSeats(); renderGuestList(); renderStats();
    } else if (inUnassigned && touchGuest.fromSeat) {
      unassignGuest(touchGuest.id);
      renderSeats(); renderGuestList(); renderStats();
    }

    document.querySelectorAll('.seat.touch-over').forEach(s => s.classList.remove('touch-over'));
    ghost?.remove();
    ghost = null;
    touchGuest = null;
  }, { passive: true });

  function updateGhostPos(touch) {
    if (!ghost) return;
    ghost.style.left = touch.clientX + 'px';
    ghost.style.top  = touch.clientY + 'px';
  }
}

// ================================================================
// MODAL — Guest add / edit
// ================================================================
function openGuestModal(guestId = null) {
  STATE.editingGuestId = guestId;
  const form      = document.getElementById('form-guest');
  const deleteBtn = document.getElementById('btn-delete-guest');
  const title     = document.getElementById('modal-guest-title');

  if (guestId) {
    const g = STATE.guests.find(g => g.id === guestId);
    if (!g) return;
    title.textContent = 'Upravit hosta';
    deleteBtn.hidden = false;
    form.reset();
    const fields = ['firstName','lastName','diet','side','group','relationship','rsvp','notes'];
    for (const f of fields) {
      const el = form.elements[f];
      if (el && g[f] !== undefined && g[f] !== null) el.value = g[f];
    }
  } else {
    title.textContent = 'Přidat hosta';
    form.reset();
    deleteBtn.hidden = true;
  }
  document.getElementById('modal-guest').hidden = false;
  form.elements.firstName.focus();
}

function closeGuestModal() {
  document.getElementById('modal-guest').hidden = true;
  STATE.editingGuestId = null;
}

// ================================================================
// EXPORT / IMPORT
// ================================================================
function exportJSON() {
  const data = JSON.stringify({ guests: STATE.guests, meta: STATE.meta }, null, 2);
  try {
    const blob = new Blob([data], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `zasedaci-poradek-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch {
    const a = document.createElement('a');
    a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(data);
    a.download = `zasedaci-poradek-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  }
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data.guests)) throw new Error('Chybí pole "guests".');
      showConfirm(
        `Import přepíše stávající data (${STATE.guests.length} hostů). Opravdu pokračovat?`,
        () => {
          STATE.guests = data.guests;
          if (data.meta) STATE.meta = { ...STATE.meta, ...data.meta };
          persist();
          renderAll();
        }
      );
    } catch (err) {
      alert('Chyba při importu:\n' + err.message);
    }
  };
  reader.readAsText(file);
}

// ================================================================
// CONFIRM DIALOG
// ================================================================
let pendingConfirm = null;

function showConfirm(message, onOk) {
  document.getElementById('confirm-text').textContent = message;
  document.getElementById('modal-confirm').hidden = false;
  pendingConfirm = onOk;
}

// ================================================================
// LOGIN
// ================================================================
function showLoginScreen() {
  document.getElementById('login-screen').hidden = false;
  document.getElementById('login-password').focus();
}

function showApp() {
  document.getElementById('login-screen').hidden = true;
}

async function handleLogin() {
  const passwordEl = document.getElementById('login-password');
  const errorEl    = document.getElementById('login-error');
  const btn        = document.getElementById('login-btn');

  const password = passwordEl.value.trim();
  if (!password) return;

  btn.disabled = true;
  btn.textContent = '…';
  errorEl.hidden = true;

  try {
    await signInWithEmailAndPassword(auth, FIREBASE_EMAIL, password);
    // onAuthStateChanged se postará o zobrazení aplikace
  } catch {
    errorEl.hidden = false;
    passwordEl.value = '';
    passwordEl.focus();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Vstoupit';
  }
}

function initLoginEvents() {
  document.getElementById('login-btn').addEventListener('click', handleLogin);
  document.getElementById('login-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleLogin();
  });
}

// ================================================================
// EVENT WIRING
// ================================================================
function initEvents() {
  document.getElementById('btn-add-guest').addEventListener('click', () => openGuestModal(null));

  document.getElementById('guest-list').addEventListener('click', e => {
    const btn = e.target.closest('.card-edit-btn');
    if (btn) { e.stopPropagation(); openGuestModal(btn.dataset.id); }
  });

  document.getElementById('form-guest').addEventListener('submit', e => {
    e.preventDefault();
    const els = e.target.elements;
    const data = {
      firstName:    els.firstName.value.trim(),
      lastName:     els.lastName.value.trim(),
      diet:         els.diet.value,
      side:         els.side.value,
      group:        els.group.value.trim(),
      relationship: els.relationship.value.trim(),
      rsvp:         els.rsvp.value,
      notes:        els.notes.value.trim(),
    };
    if (!data.firstName || !data.lastName) return;

    if (STATE.editingGuestId) {
      updateGuest(STATE.editingGuestId, data);
    } else {
      addGuest(data);
    }
    closeGuestModal();
    renderAll();
  });

  document.getElementById('btn-delete-guest').addEventListener('click', () => {
    showConfirm('Opravdu smazat tohoto hosta?', () => {
      deleteGuest(STATE.editingGuestId);
      closeGuestModal();
      renderAll();
    });
  });

  document.getElementById('btn-cancel-guest').addEventListener('click', closeGuestModal);

  document.getElementById('confirm-ok').addEventListener('click', () => {
    document.getElementById('modal-confirm').hidden = true;
    if (pendingConfirm) { pendingConfirm(); pendingConfirm = null; }
  });
  document.getElementById('confirm-cancel').addEventListener('click', () => {
    document.getElementById('modal-confirm').hidden = true;
    pendingConfirm = null;
  });

  document.getElementById('filter-side').addEventListener('change',  e => { STATE.filters.side   = e.target.value; renderGuestList(); });
  document.getElementById('filter-diet').addEventListener('change',  e => { STATE.filters.diet   = e.target.value; renderGuestList(); });
  document.getElementById('filter-rsvp').addEventListener('change',  e => { STATE.filters.rsvp   = e.target.value; renderGuestList(); });
  document.getElementById('filter-group').addEventListener('input',  e => { STATE.filters.group  = e.target.value; renderGuestList(); });
  document.getElementById('filter-search').addEventListener('input', e => { STATE.filters.search = e.target.value; renderGuestList(); });

  document.getElementById('btn-export').addEventListener('click', exportJSON);
  document.getElementById('btn-import').addEventListener('click', () => document.getElementById('file-input').click());
  document.getElementById('file-input').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) importJSON(f);
    e.target.value = '';
  });
  document.getElementById('btn-print').addEventListener('click', () => window.print());

  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', e => { if (e.target === modal) modal.hidden = true; });
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal:not([hidden])').forEach(m => m.hidden = true);
    }
  });
}

// ================================================================
// INIT
// ================================================================
document.addEventListener('DOMContentLoaded', () => {
  buildVenue();
  initDragDrop();
  initTouchDrag();
  initEvents();
  initLoginEvents();

  onAuthStateChanged(auth, user => {
    if (user) {
      showApp();
      loadFromFirebase();
    } else {
      showLoginScreen();
    }
  });
});
