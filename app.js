/* Health Tracker — light web version.
 *
 * Deliberately has no server, no accounts and no network calls at all: every
 * entry lives in this browser's localStorage and nowhere else. That is what
 * makes the app safe to hand to someone as a link — there is no place for
 * their data to be collected, because none exists.
 *
 * The stored shape mirrors the desktop app's SQLite columns (snake_case,
 * ISO dates, null meaning "no answer") so an export from one could be read
 * by the other later. The two are otherwise unconnected.
 */

'use strict';

const RATING_MAX = 10;
const STORAGE_KEY = 'health-tracker.entries.v1';

/* ------------------------------------------------------------------ */
/* storage                                                             */
/* ------------------------------------------------------------------ */

/* localStorage throws rather than returning null in some situations —
 * Safari private browsing, storage disabled by policy — so every access is
 * guarded. A failure must degrade to "nothing saved yet", never a blank page. */

/* Shape on disk:
 *
 *   { version: 2,
 *     entries: [ { id, at: "2026-08-24T14:30", mood, energy, note } ],
 *     days:    { "2026-08-24": { sleep_hours: 7.5 } } }
 *
 * Mood and energy are moments — several a day is normal and the times
 * matter. Sleep describes a night, so it belongs to the day rather than to
 * any one moment, and lives separately instead of being repeated on every
 * entry and averaged into nonsense. */

function blankStore() {
  return { version: 2, entries: [], days: {} };
}

function loadStore() {
  let raw;
  try {
    raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch (err) {
    console.warn('Could not read saved entries:', err);
    return blankStore();
  }
  if (!raw) return blankStore();
  if (Array.isArray(raw.entries)) return raw;          // already version 2
  return migrateFromDateKeyed(raw);                    // version 1
}

function saveStore(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch (err) {
    console.warn('Could not save entries:', err);
    return false;
  }
}

/* Version 1 kept exactly one record per day, keyed by date. Everyone using
 * the app already has data in that shape, including on phones this code will
 * never see, so the conversion has to be lossless and has to run on the way
 * in rather than as a one-off. */
function migrateFromDateKeyed(byDate) {
  const store = blankStore();

  for (const [date, old] of Object.entries(byDate)) {
    if (!old || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    store.entries.push({
      id: newId(),
      // created_at holds when it was actually logged. Use that time when it
      // belongs to the same local day, otherwise midday — arbitrary, but it
      // can never land the entry on the wrong date the way a timezone
      // conversion can.
      at: sameDayLocalTime(old.created_at, date) || `${date}T12:00`,
      mood: old.mood ?? null,
      energy: old.energy ?? null,
      // Stress was retired from the interface but recorded values are kept,
      // so the decision stays reversible.
      stress: old.stress ?? null,
      note: typeof old.note === 'string' ? old.note : '',
    });

    if (old.sleep_hours != null) {
      store.days[date] = { sleep_hours: old.sleep_hours };
    }
  }

  store.entries.sort((a, b) => a.at.localeCompare(b.at));
  return store;
}

function sameDayLocalTime(isoUtc, expectedDate) {
  if (!isoUtc) return null;
  const when = new Date(isoUtc);
  if (Number.isNaN(when.getTime())) return null;
  if (toIso(when) !== expectedDate) return null;
  return `${expectedDate}T${clock(when)}`;
}

function newId() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/* -- reading ------------------------------------------------------- */

function allEntriesNewestFirst() {
  return loadStore().entries.slice().sort((a, b) => b.at.localeCompare(a.at));
}

function allEntriesOldestFirst() {
  return loadStore().entries.slice().sort((a, b) => a.at.localeCompare(b.at));
}

function entriesOn(isoDate) {
  return loadStore().entries
    .filter((e) => e.at.startsWith(isoDate))
    .sort((a, b) => a.at.localeCompare(b.at));
}

function getEntryById(id) {
  return loadStore().entries.find((e) => e.id === id) || null;
}

function sleepOn(isoDate) {
  const day = loadStore().days[isoDate];
  return day && day.sleep_hours != null ? day.sleep_hours : null;
}

function loggedDates() {
  return [...new Set(loadStore().entries.map((e) => e.at.slice(0, 10)))].sort();
}

/* -- writing ------------------------------------------------------- */

function saveEntry({ id, at, mood, energy, note }) {
  const store = loadStore();
  const existing = id ? store.entries.find((e) => e.id === id) : null;

  if (existing) {
    Object.assign(existing, { at, mood, energy, note });
  } else {
    id = newId();
    store.entries.push({ id, at, mood, energy, stress: null, note });
  }
  return saveStore(store) ? id : null;
}

function setSleep(isoDate, hours) {
  const store = loadStore();
  if (hours == null) delete store.days[isoDate];
  else store.days[isoDate] = { sleep_hours: hours };
  return saveStore(store);
}

function removeEntry(id) {
  const store = loadStore();
  store.entries = store.entries.filter((e) => e.id !== id);
  return saveStore(store);
}

/* ------------------------------------------------------------------ */
/* dates                                                               */
/* ------------------------------------------------------------------ */

/* Built from local date parts, never from toISOString(), which converts to
 * UTC first and hands back yesterday for anyone east of Greenwich late in
 * the evening. */
function toIso(dateObj) {
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${dateObj.getFullYear()}-${month}-${day}`;
}

function todayIso() {
  return toIso(new Date());
}

/* Local wall-clock, never UTC. An entry logged at 23:30 belongs to that
 * evening, not to the next morning in Greenwich. */
function clock(dateObj) {
  const h = String(dateObj.getHours()).padStart(2, '0');
  const m = String(dateObj.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function nowStamp() {
  const now = new Date();
  return `${toIso(now)}T${clock(now)}`;
}

function dateOf(stamp) {
  return stamp.slice(0, 10);
}

function timeOf(stamp) {
  return stamp.slice(11, 16);
}

function shiftIso(isoDate, deltaDays) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const shifted = new Date(y, m - 1, d + deltaDays);
  return toIso(shifted);
}

/* Dates are formatted with the reader's own locale rather than a fixed
 * pattern. "08/09" means September 8th in Germany and August 9th in the
 * United States, and there is no way to tell them apart by looking. */

function asDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function prettyDate(isoDate) {
  const formatted = asDate(isoDate).toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  return isoDate === todayIso() ? `${formatted} (today)` : formatted;
}

function shortDate(isoDate) {
  return asDate(isoDate).toLocaleDateString(undefined, {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function axisDate(isoDate) {
  return asDate(isoDate).toLocaleDateString(undefined, {
    day: '2-digit', month: '2-digit',
  });
}

/* ------------------------------------------------------------------ */
/* rating scales                                                       */
/* ------------------------------------------------------------------ */

/* Each scale is a row of buttons rather than a slider: a slider always shows
 * some value, and "no answer" has to be a state you can see and choose. null
 * is kept distinct from 1 so unanswered days never count as bad ones. */

const scales = {};

function buildScale(container) {
  const field = container.dataset.field;
  const buttons = [];

  const makeButton = (value, label, ariaLabel) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', ariaLabel);
    button.addEventListener('click', () => {
      // Tapping the active value again clears it, so a rating can always be
      // taken back without hunting for the "no answer" button.
      setScale(field, scales[field].value === value ? null : value);
      markDirty();
    });
    container.appendChild(button);
    buttons.push({ value, button });
  };

  makeButton(null, '—', `${field}: no answer`);
  for (let value = 1; value <= RATING_MAX; value++) {
    makeButton(value, String(value), `${field}: ${value} of ${RATING_MAX}`);
  }

  scales[field] = { buttons, value: null };
}

function setScale(field, value) {
  const scale = scales[field];
  scale.value = value;
  for (const { value: buttonValue, button } of scale.buttons) {
    button.setAttribute('aria-pressed', String(buttonValue === value));
  }
}

/* ------------------------------------------------------------------ */
/* today view                                                          */
/* ------------------------------------------------------------------ */

const el = {
  dateInput: document.getElementById('date-input'),
  timeInput: document.getElementById('time-input'),
  prevDay: document.getElementById('prev-day'),
  nextDay: document.getElementById('next-day'),
  nowBtn: document.getElementById('today-btn'),
  dayLabel: document.getElementById('day-label'),
  dayStatus: document.getElementById('day-status'),
  dayEntries: document.getElementById('day-entries'),
  form: document.getElementById('entry-form'),
  sleep: document.getElementById('sleep-input'),
  sleepClear: document.getElementById('sleep-clear'),
  note: document.getElementById('note-input'),
  saveBtn: document.getElementById('save-btn'),
  deleteBtn: document.getElementById('delete-btn'),
  feedback: document.getElementById('save-feedback'),
};

/* The editor works on one entry at a time. `currentId` is null while writing
 * a new one, so saving twice at different times creates two entries rather
 * than overwriting the first — which is the whole point of timestamps. */
let currentStamp = nowStamp();
let currentId = null;
let dirty = false;

function markDirty() {
  dirty = true;
  el.feedback.textContent = '';
  el.feedback.classList.remove('is-error');
}

function loadEntry(stamp, id) {
  currentStamp = stamp;
  currentId = id || null;
  const entry = currentId ? getEntryById(currentId) : null;
  const date = dateOf(stamp);

  el.dateInput.value = date;
  el.timeInput.value = timeOf(stamp);
  el.dayLabel.textContent = prettyDate(date);
  el.nextDay.disabled = date >= todayIso();

  setScale('mood', entry ? entry.mood : null);
  setScale('energy', entry ? entry.energy : null);
  el.note.value = entry ? entry.note || '' : '';

  // Sleep belongs to the day, so it loads from the day whichever entry is open.
  const hours = sleepOn(date);
  el.sleep.value = hours == null ? '' : hours;

  el.dayStatus.textContent = entry
    ? 'Editing an entry you already saved.'
    : 'New entry. Saving adds it alongside any others that day.';
  el.saveBtn.textContent = entry ? 'Update' : 'Save';
  el.deleteBtn.hidden = !entry;
  el.feedback.textContent = '';
  el.feedback.classList.remove('is-error');
  dirty = false;

  renderDayEntries(date);
}

/* The day's other entries, so a second or third can be reached without a
 * detour through History. */
function renderDayEntries(date) {
  const entries = entriesOn(date);
  el.dayEntries.textContent = '';

  if (!entries.length) { el.dayEntries.hidden = true; return; }
  el.dayEntries.hidden = false;

  const label = document.createElement('span');
  label.className = 'day-entries-label';
  label.textContent = entries.length === 1 ? 'This day:' : `This day (${entries.length}):`;
  el.dayEntries.appendChild(label);

  for (const entry of entries) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip time-chip' + (entry.id === currentId ? ' is-on' : '');
    const bits = [timeOf(entry.at)];
    if (entry.mood != null) bits.push(`M${entry.mood}`);
    if (entry.energy != null) bits.push(`E${entry.energy}`);
    chip.textContent = bits.join(' · ');
    chip.addEventListener('click', () => {
      if (!confirmLeave()) return;
      loadEntry(entry.at, entry.id);
    });
    el.dayEntries.appendChild(chip);
  }

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'chip time-chip' + (currentId ? '' : ' is-on');
  add.textContent = '+ new';
  add.addEventListener('click', () => {
    if (!confirmLeave()) return;
    const stamp = date === todayIso() ? nowStamp() : `${date}T12:00`;
    loadEntry(stamp, null);
  });
  el.dayEntries.appendChild(add);
}

function confirmLeave() {
  return !dirty || confirm('This entry has unsaved changes. Discard them?');
}

function goToDate(isoDate) {
  if (isoDate > todayIso()) {
    showError('You can only log up to today.');
    el.dateInput.value = dateOf(currentStamp);
    return;
  }
  if (!confirmLeave()) {
    el.dateInput.value = dateOf(currentStamp);
    return;
  }
  // Moving to another day opens a fresh entry rather than an existing one:
  // picking which of that day's entries to edit is what the chips are for.
  const stamp = isoDate === todayIso() ? nowStamp() : `${isoDate}T12:00`;
  loadEntry(stamp, null);
}

function showError(message) {
  el.feedback.textContent = message;
  el.feedback.classList.add('is-error');
}

function readSleep() {
  const raw = el.sleep.value.trim().replace(',', '.');
  if (raw === '') return null;
  const hours = Number(raw);
  if (!Number.isFinite(hours)) throw new Error('Sleep must be a number of hours.');
  if (hours < 0 || hours > 24) throw new Error('Sleep should be between 0 and 24 hours.');
  return hours;
}

function readStamp() {
  const date = el.dateInput.value;
  const time = el.timeInput.value || '12:00';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Pick a valid date.');
  if (`${date}T${time}` > nowStamp()) throw new Error('That is in the future.');
  return `${date}T${time}`;
}

function save() {
  let sleepHours;
  let stamp;
  try {
    sleepHours = readSleep();
    stamp = readStamp();
  } catch (err) {
    showError(err.message);
    return;
  }

  const mood = scales.mood.value;
  const energy = scales.energy.value;
  const note = el.note.value.trim();

  if (mood === null && energy === null && note === '' && sleepHours === null) {
    showError('Nothing to save — fill in at least one field.');
    return;
  }

  // Sleep is stored against the day even when the entry itself is empty, so
  // recording only "I slept 7 hours" works.
  if (!setSleep(dateOf(stamp), sleepHours)) {
    showError('Could not save. Private browsing can block storage.');
    return;
  }

  if (mood !== null || energy !== null || note !== '') {
    const id = saveEntry({ id: currentId, at: stamp, mood, energy, note });
    if (!id) {
      showError('Could not save. Private browsing can block storage.');
      return;
    }
    currentId = id;
  }

  currentStamp = stamp;
  dirty = false;
  el.saveBtn.textContent = currentId ? 'Update' : 'Save';
  el.deleteBtn.hidden = !currentId;
  el.dayStatus.textContent = currentId
    ? 'Editing an entry you already saved.'
    : 'Sleep saved for this day.';
  el.feedback.textContent = 'Saved.';
  el.feedback.classList.remove('is-error');
  renderDayEntries(dateOf(stamp));
  renderHistory();
}

function deleteCurrent() {
  if (!currentId) return;
  if (!confirm(`Delete the entry from ${timeOf(currentStamp)} on ${dateOf(currentStamp)}?`)) return;
  removeEntry(currentId);
  const date = dateOf(currentStamp);
  loadEntry(date === todayIso() ? nowStamp() : `${date}T12:00`, null);
  el.feedback.textContent = 'Deleted.';
  renderHistory();
}

/* ------------------------------------------------------------------ */
/* history                                                             */
/* ------------------------------------------------------------------ */

const historyList = document.getElementById('history-list');
const importFeedback = document.getElementById('import-feedback');

function summarise(entry) {
  const bits = [];
  if (entry.mood != null) bits.push(`Mood ${entry.mood}`);
  if (entry.energy != null) bits.push(`Energy ${entry.energy}`);
  const hours = sleepOn(dateOf(entry.at));
  if (hours != null) bits.push(`Slept ${hours} h`);
  return bits.length ? bits.join(' · ') : 'No ratings';
}

function renderHistory() {
  const entries = allEntriesNewestFirst();
  historyList.textContent = '';

  if (!entries.length) {
    const empty = document.createElement('li');
    empty.className = 'placeholder';
    empty.textContent = 'Nothing logged yet.';
    historyList.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const item = document.createElement('li');
    item.className = 'history-item';

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'history-open';
    open.setAttribute('aria-label', `Edit entry from ${entry.at}`);

    const when = document.createElement('span');
    when.className = 'history-date';
    // Time as well as date: with several entries a day the date alone no
    // longer identifies which one this is.
    when.textContent = `${shortDate(dateOf(entry.at))}  ${timeOf(entry.at)}`;

    const summary = document.createElement('span');
    summary.className = 'history-summary';
    summary.textContent = summarise(entry);

    open.append(when, summary);

    if (entry.note) {
      const note = document.createElement('span');
      note.className = 'history-note';
      // textContent, never innerHTML: a note is user text and must never be
      // parsed as markup.
      note.textContent = entry.note;
      open.appendChild(note);
    }

    open.addEventListener('click', () => {
      showView('today');
      if (!confirmLeave()) return;
      loadEntry(entry.at, entry.id);
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'history-delete';
    remove.textContent = 'Delete';
    remove.setAttribute('aria-label', `Delete entry from ${entry.at}`);
    remove.addEventListener('click', () => {
      if (!confirm(`Delete the entry from ${timeOf(entry.at)} on `
        + `${shortDate(dateOf(entry.at))}? This cannot be undone.`)) return;
      removeEntry(entry.id);
      renderHistory();
      if (entry.id === currentId) {
        loadEntry(currentStamp, null);
      } else {
        renderDayEntries(dateOf(currentStamp));
      }
    });

    item.append(open, remove);
    historyList.appendChild(item);
  }
}

/* ------------------------------------------------------------------ */
/* backup: export and import                                           */
/* ------------------------------------------------------------------ */

/* The only backup that exists. Browser storage is not durable — clearing site
 * data wipes it, and Safari evicts storage for sites left unopened for about
 * a week unless the app was added to the Home Screen. */

function download(filename, text, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke on the next tick; revoking immediately can cancel the download
  // on some mobile browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const LAST_BACKUP_KEY = 'health-tracker.last-backup';

function exportJson() {
  const store = loadStore();
  const payload = {
    app: 'health-tracker',
    version: 2,
    exported_at: new Date().toISOString(),
    entries: store.entries,
    days: store.days,
  };
  download(
    `health-tracker-${todayIso()}.json`,
    JSON.stringify(payload, null, 2),
    'application/json',
  );
  try {
    localStorage.setItem(LAST_BACKUP_KEY, todayIso());
  } catch { /* nothing to do */ }
}

function csvCell(value) {
  if (value == null) return '';
  const text = String(value);
  // Quote anything that would otherwise break the row apart.
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCsv() {
  const store = loadStore();
  const columns = ['date', 'time', 'mood', 'energy', 'sleep_hours', 'note'];
  const rows = store.entries.slice().sort((x, y) => x.at.localeCompare(y.at));
  const lines = [columns.join(',')];

  for (const entry of rows) {
    const date = dateOf(entry.at);
    lines.push([
      csvCell(date),
      csvCell(timeOf(entry.at)),
      csvCell(entry.mood),
      csvCell(entry.energy),
      // Sleep belongs to the day; repeated here so each row stands alone in
      // a spreadsheet, which is what people do with a CSV.
      csvCell(sleepOn(date)),
      csvCell(entry.note),
    ].join(','));
  }

  // Days with sleep recorded but no entry would otherwise vanish from the
  // export entirely.
  const covered = new Set(rows.map((e) => dateOf(e.at)));
  for (const [date, day] of Object.entries(store.days)) {
    if (!covered.has(date) && day.sleep_hours != null) {
      lines.push([csvCell(date), '', '', '', csvCell(day.sleep_hours), ''].join(','));
    }
  }

  download(`health-tracker-${todayIso()}.csv`, lines.join('\n'), 'text/csv');
}

function showImportResult(message, isError) {
  importFeedback.textContent = message;
  importFeedback.classList.toggle('is-error', Boolean(isError));
}

/* Accepts both formats. Version 1 backups are sitting in people's Downloads
 * folders right now, and a restore that rejected them would be worthless at
 * exactly the moment it is needed. */
function normaliseBackup(payload) {
  if (Array.isArray(payload)) return migrateFromDateKeyed(keyByDate(payload));
  if (!payload || typeof payload !== 'object') return null;

  if (Array.isArray(payload.entries) && payload.version >= 2) {
    return { version: 2, entries: payload.entries, days: payload.days || {} };
  }
  if (Array.isArray(payload.entries)) {
    return migrateFromDateKeyed(keyByDate(payload.entries));   // version 1 export
  }
  return migrateFromDateKeyed(payload);                        // raw v1 map
}

function keyByDate(list) {
  const map = {};
  for (const item of list) {
    if (item && typeof item.date === 'string') map[item.date] = item;
  }
  return map;
}

function importJson(file) {
  const reader = new FileReader();

  reader.onerror = () => showImportResult('Could not read that file.', true);
  reader.onload = () => {
    let payload;
    try {
      payload = JSON.parse(reader.result);
    } catch {
      showImportResult('That is not a valid backup file.', true);
      return;
    }

    const incoming = normaliseBackup(payload);
    if (!incoming || !incoming.entries.length && !Object.keys(incoming.days).length) {
      showImportResult('That file has no entries in it.', true);
      return;
    }

    const store = loadStore();
    const seen = new Set(store.entries.map((e) => `${e.at}|${e.mood}|${e.energy}`));
    let added = 0;
    let skipped = 0;

    for (const entry of incoming.entries) {
      if (!entry || typeof entry.at !== 'string') { skipped++; continue; }
      // Restoring the same file twice should not double every entry, and
      // there is no id to match on across devices.
      const key = `${entry.at}|${entry.mood}|${entry.energy}`;
      if (seen.has(key)) { skipped++; continue; }
      seen.add(key);
      store.entries.push({
        id: newId(),
        at: entry.at,
        mood: entry.mood ?? null,
        energy: entry.energy ?? null,
        stress: entry.stress ?? null,
        note: typeof entry.note === 'string' ? entry.note : '',
      });
      added++;
    }

    let sleepDays = 0;
    for (const [date, day] of Object.entries(incoming.days || {})) {
      if (day && day.sleep_hours != null && store.days[date] == null) {
        store.days[date] = { sleep_hours: day.sleep_hours };
        sleepDays++;
      }
    }

    if (!saveStore(store)) {
      showImportResult('Could not save the imported entries.', true);
      return;
    }

    renderHistory();
    loadEntry(currentStamp, currentId);
    const parts = [`${added} added`];
    if (sleepDays) parts.push(`${sleepDays} nights of sleep`);
    if (skipped) parts.push(`${skipped} already present`);
    showImportResult(`Restored: ${parts.join(', ')}.`);
  };

  reader.readAsText(file);
}

/* ------------------------------------------------------------------ */
/* trends                                                             */
/* ------------------------------------------------------------------ */

/* The x axis is continuous time, not a row of days. Several entries in one
 * day simply sit closer together, which is the honest picture: a morning and
 * an evening rating are two moments, not one averaged "Tuesday".
 *
 * Two panels, because the units differ. Mood and energy share a 1-10 axis and
 * can be read against each other; sleep is in hours per night and gets its
 * own. */

const SERIES = {
  mood: { label: 'Mood', colour: '#2563eb' },
  energy: { label: 'Energy', colour: '#ea580c' },
  sleep_hours: { label: 'Sleep', colour: '#0d9488' },
};

const SVG_NS = 'http://www.w3.org/2000/svg';

const chartHolder = document.getElementById('chart-holder');
const trendsSummary = document.getElementById('trends-summary');
const trendsEmpty = document.getElementById('trends-empty');

let rangeDays = 30;
let smoothingDays = 0;          // 0 = plot every point as recorded
const seriesOn = { mood: true, energy: true, sleep_hours: true };

function svgEl(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/* Local wall-clock to milliseconds. Parsing the string directly would make
 * "2026-08-24T14:30" UTC in some engines and local in others. */
function stampToMs(stamp) {
  const [datePart, timePart = '12:00'] = stamp.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0).getTime();
}

const DAY_MS = 86400000;

function rangeBounds() {
  const end = Date.now();
  if (rangeDays === 'all') {
    const dates = loggedDates();
    const sleepDates = Object.keys(loadStore().days);
    const earliest = [...dates, ...sleepDates].sort()[0];
    return [earliest ? stampToMs(`${earliest}T00:00`) : end - DAY_MS, end];
  }
  return [end - rangeDays * DAY_MS, end];
}

/* Points for one series: either every recorded value, or a trailing moving
 * average sampled once a day. */
function seriesPoints(key, fromMs, toMs) {
  const raw = key === 'sleep_hours'
    ? Object.entries(loadStore().days)
      .filter(([, day]) => day && day.sleep_hours != null)
      // Sleep is recorded for a night, so it is placed at a fixed hour rather
      // than pretending to a precision it does not have.
      .map(([date, day]) => ({ t: stampToMs(`${date}T08:00`), v: day.sleep_hours }))
    : allEntriesOldestFirst()
      .filter((e) => e[key] != null)
      .map((e) => ({ t: stampToMs(e.at), v: e[key] }));

  raw.sort((x, y) => x.t - y.t);

  if (!smoothingDays) {
    return raw.filter((p) => p.t >= fromMs && p.t <= toMs);
  }

  // A trailing mean: each sample averages everything in the preceding window,
  // so the line answers "how have things been lately", not "what was today".
  const windowMs = smoothingDays * DAY_MS;

  const sampleTimes = [];
  for (let t = fromMs; t <= toMs; t += DAY_MS) sampleTimes.push(t);
  // Always finish at the end of the range. Stepping a day at a time from the
  // start leaves the last sample short of the present, so the line would stop
  // before today's entries and quietly ignore the newest data.
  if (sampleTimes[sampleTimes.length - 1] !== toMs) sampleTimes.push(toMs);

  const out = [];
  for (const t of sampleTimes) {
    const inWindow = raw.filter((p) => p.t > t - windowMs && p.t <= t);
    if (inWindow.length) {
      out.push({ t, v: inWindow.reduce((s, p) => s + p.v, 0) / inWindow.length });
    }
  }
  return out;
}

function renderTrends() {
  chartHolder.textContent = '';
  const store = loadStore();

  if (!store.entries.length && !Object.keys(store.days).length) {
    trendsSummary.textContent = '';
    trendsEmpty.textContent = 'Nothing logged yet — save an entry to see trends.';
    return;
  }

  const [fromMs, toMs] = rangeBounds();
  renderSummary(fromMs, toMs);

  const ratingKeys = ['mood', 'energy'].filter((k) => seriesOn[k]);
  const showSleep = seriesOn.sleep_hours;

  if (!ratingKeys.length && !showSleep) {
    trendsEmpty.textContent = 'Nothing selected — tap a value above to chart it.';
    return;
  }
  trendsEmpty.textContent = '';

  const width = chartHolder.clientWidth || 340;
  const both = ratingKeys.length && showSleep;
  const ratingHeight = both ? 190 : 230;
  const sleepHeight = both ? 150 : 230;
  const totalHeight = (ratingKeys.length ? ratingHeight : 0) + (showSleep ? sleepHeight : 0);

  const svg = svgEl('svg', {
    width: '100%', height: totalHeight,
    viewBox: `0 0 ${width} ${totalHeight}`,
    role: 'img', 'aria-label': 'Chart of your logged values over time',
  });

  let top = 0;
  if (ratingKeys.length) {
    drawPanel(svg, {
      width, top, height: ratingHeight, keys: ratingKeys,
      low: 1, high: RATING_MAX, tickStep: 3,
      fromMs, toMs, showDates: !showSleep,
    });
    top += ratingHeight;
  }
  if (showSleep) {
    const hours = seriesPoints('sleep_hours', fromMs, toMs).map((p) => p.v);
    const high = hours.length ? Math.max(10, Math.ceil(Math.max(...hours))) : 10;
    drawPanel(svg, {
      width, top, height: sleepHeight, keys: ['sleep_hours'],
      low: 0, high, tickStep: Math.max(2, Math.ceil(high / 4)),
      fromMs, toMs, showDates: true,
    });
  }

  chartHolder.appendChild(svg);
}

function drawPanel(svg, opts) {
  const { width, top, height, keys, low, high, tickStep, fromMs, toMs, showDates } = opts;
  const padLeft = 30, padRight = 10, padTop = 22;
  const padBottom = showDates ? 26 : 10;

  const plotW = Math.max(width - padLeft - padRight, 10);
  const plotH = Math.max(height - padTop - padBottom, 10);
  const baseY = top + padTop;
  const span = Math.max(toMs - fromMs, 1);

  const xFor = (ms) => padLeft + ((ms - fromMs) / span) * plotW;
  const yFor = (v) => baseY + ((high - v) * plotH) / ((high - low) || 1);

  for (let value = low; value <= high; value += tickStep) {
    const y = yFor(value);
    svg.appendChild(svgEl('line', { x1: padLeft, y1: y, x2: padLeft + plotW, y2: y, class: 'grid' }));
    const label = svgEl('text', { x: padLeft - 6, y: y + 4, class: 'tick', 'text-anchor': 'end' });
    label.textContent = String(value);
    svg.appendChild(label);
  }

  svg.appendChild(svgEl('line', {
    x1: padLeft, y1: baseY + plotH, x2: padLeft + plotW, y2: baseY + plotH, class: 'axis',
  }));

  if (showDates) {
    for (const [ms, anchor] of [[fromMs, 'start'], [(fromMs + toMs) / 2, 'middle'], [toMs, 'end']]) {
      const text = svgEl('text', {
        x: xFor(ms), y: baseY + plotH + 16, class: 'tick', 'text-anchor': anchor,
      });
      text.textContent = axisDate(toIso(new Date(ms)));
      svg.appendChild(text);
    }
  }

  let legendX = padLeft;
  for (const key of keys) {
    const { label, colour } = SERIES[key];
    drawSeries(svg, seriesPoints(key, fromMs, toMs), xFor, yFor, colour);
    const text = svgEl('text', { x: legendX, y: top + 14, class: 'legend', fill: colour });
    text.textContent = label;
    svg.appendChild(text);
    legendX += label.length * 6.2 + 14;
  }
}

/* A gap means nothing was recorded, so the line is broken there and bridged
 * with dots: the shape stays readable while a lapse in logging never reads as
 * a steady trend. What counts as a gap depends on how often you log, so it
 * scales with the range rather than being a fixed number of days. */
function gapThreshold(fromMs, toMs) {
  return Math.max(1.5 * DAY_MS, (toMs - fromMs) / 25);
}

function drawSeries(svg, points, xFor, yFor, colour) {
  if (!points.length) return;
  const limit = gapThreshold(points[0].t, points[points.length - 1].t || points[0].t + DAY_MS);

  const runs = [];
  let run = [points[0]];
  for (let i = 1; i < points.length; i++) {
    if (points[i].t - points[i - 1].t > limit) { runs.push(run); run = []; }
    run.push(points[i]);
  }
  runs.push(run);

  for (let i = 1; i < runs.length; i++) {
    const from = runs[i - 1][runs[i - 1].length - 1];
    const to = runs[i][0];
    svg.appendChild(svgEl('line', {
      x1: xFor(from.t), y1: yFor(from.v), x2: xFor(to.t), y2: yFor(to.v),
      stroke: colour, 'stroke-width': 1.5, 'stroke-dasharray': '2 4',
      'stroke-linecap': 'round', opacity: 0.75,
    }));
  }

  for (const seg of runs) {
    if (seg.length >= 2) {
      svg.appendChild(svgEl('polyline', {
        points: seg.map((p) => `${xFor(p.t)},${yFor(p.v)}`).join(' '),
        fill: 'none', stroke: colour, 'stroke-width': 2,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      }));
    }
    // Individual readings are worth marking; a smoothed line is a
    // calculation, and dotting every sample would just make it look noisy.
    if (!smoothingDays) {
      for (const p of seg) {
        svg.appendChild(svgEl('circle', { cx: xFor(p.t), cy: yFor(p.v), r: 3, fill: colour }));
      }
    }
  }
}

function renderSummary(fromMs, toMs) {
  const entries = allEntriesOldestFirst()
    .filter((e) => { const t = stampToMs(e.at); return t >= fromMs && t <= toMs; });
  const days = new Set(entries.map((e) => dateOf(e.at)));

  const parts = [`${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`
    + ` on ${days.size} ${days.size === 1 ? 'day' : 'days'}`];

  for (const key of ['mood', 'energy']) {
    const values = entries.map((e) => e[key]).filter((v) => v != null);
    if (values.length) {
      parts.push(`${SERIES[key].label} avg `
        + `${(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)}`);
    }
  }

  const sleep = seriesPointsRaw('sleep_hours', fromMs, toMs);
  if (sleep.length) {
    parts.push(`Sleep avg ${(sleep.reduce((s, p) => s + p.v, 0) / sleep.length).toFixed(1)} h`);
  }

  const streak = currentStreak();
  if (streak) parts.push(`streak ${streak} day${streak === 1 ? '' : 's'}`);

  trendsSummary.textContent = parts.join('  ·  ');
}

/* Averages in the summary describe what was recorded, so they always use the
 * real values even when the chart is showing a smoothed line. */
function seriesPointsRaw(key, fromMs, toMs) {
  const saved = smoothingDays;
  smoothingDays = 0;
  const points = seriesPoints(key, fromMs, toMs);
  smoothingDays = saved;
  return points;
}

function currentStreak() {
  // Today may be missing without breaking the streak, so it does not read as
  // broken simply because today has not been logged yet.
  const dates = new Set(loggedDates());
  let day = todayIso();
  if (!dates.has(day)) day = shiftIso(day, -1);
  let streak = 0;
  while (dates.has(day)) { streak++; day = shiftIso(day, -1); }
  return streak;
}

/* ------------------------------------------------------------------ */
/* wiring                                                              */
/* ------------------------------------------------------------------ */

document.querySelectorAll('.scale').forEach(buildScale);

el.prevDay.addEventListener('click', () => goToDate(shiftIso(dateOf(currentStamp), -1)));
el.nextDay.addEventListener('click', () => goToDate(shiftIso(dateOf(currentStamp), 1)));
// "Now" rather than "Today": it sets the time as well, ready for a new entry.
el.nowBtn.addEventListener('click', () => {
  if (!confirmLeave()) return;
  loadEntry(nowStamp(), null);
});
el.dateInput.addEventListener('change', () => {
  // An emptied or half-typed date must not wipe the view.
  if (el.dateInput.value) goToDate(el.dateInput.value);
  else el.dateInput.value = dateOf(currentStamp);
});
el.timeInput.addEventListener('input', markDirty);
el.deleteBtn.addEventListener('click', deleteCurrent);

el.sleep.addEventListener('input', markDirty);
el.note.addEventListener('input', markDirty);
el.sleepClear.addEventListener('click', () => {
  el.sleep.value = '';
  markDirty();
});

el.form.addEventListener('submit', (event) => {
  event.preventDefault();
  save();
});

function showView(name) {
  document.querySelectorAll('.tab').forEach((tab) => {
    const active = tab.dataset.view === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.view').forEach((view) => {
    view.classList.toggle('is-active', view.id === `view-${name}`);
  });
  if (name === 'history') renderHistory();
  if (name === 'trends') renderTrends();
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => showView(tab.dataset.view));
});

document.getElementById('export-json').addEventListener('click', exportJson);
document.getElementById('export-csv').addEventListener('click', exportCsv);

const importFile = document.getElementById('import-file');
document.getElementById('import-json').addEventListener('click', () => importFile.click());
importFile.addEventListener('change', () => {
  if (importFile.files[0]) importJson(importFile.files[0]);
  // Reset so picking the same file twice still fires a change event.
  importFile.value = '';
});

document.querySelectorAll('#range-buttons .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const value = chip.dataset.days;
    rangeDays = value === 'all' ? 'all' : Number(value);
    document.querySelectorAll('#range-buttons .chip').forEach((other) => {
      other.classList.toggle('is-on', other === chip);
    });
    renderTrends();
  });
});

document.querySelectorAll('#smoothing-buttons .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    smoothingDays = Number(chip.dataset.smooth);
    document.querySelectorAll('#smoothing-buttons .chip').forEach((other) => {
      other.classList.toggle('is-on', other === chip);
    });
    renderTrends();
  });
});

document.querySelectorAll('#series-buttons .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const key = chip.dataset.series;
    seriesOn[key] = !seriesOn[key];
    chip.classList.toggle('is-on', seriesOn[key]);
    renderTrends();
  });
});

// Turning the phone sideways changes the chart width, and the drawing is
// measured rather than scaled, so it has to be rebuilt.
let resizeTimer = null;
window.addEventListener('resize', () => {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (document.getElementById('view-trends').classList.contains('is-active')) {
      renderTrends();
    }
  }, 150);
});

// Catches a closed tab or a swipe-away with an entry half filled in.
// Both lines are needed: preventDefault() is the modern spec, returnValue is
// what older Safari and Firefox actually check.
window.addEventListener('beforeunload', (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

el.dateInput.max = todayIso();
loadEntry(nowStamp(), null);

/* ------------------------------------------------------------------ */
/* installing, and keeping the data                                    */
/* ------------------------------------------------------------------ */

/* Installing to the Home Screen is not decoration. Safari clears
 * script-writable storage for sites left unopened for about a week, and an
 * installed app is exempt — so this prompt is what stops people quietly
 * losing their entries. */

const HINT_DISMISSED = 'health-tracker.install-hint-dismissed';

const installHint = document.getElementById('install-hint');
const installText = document.getElementById('install-text');
const installBtn = document.getElementById('install-btn');

function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;   // iOS reports it here instead
}

function hintWasDismissed() {
  try {
    return localStorage.getItem(HINT_DISMISSED) === '1';
  } catch {
    return false;
  }
}

const footerNote = document.getElementById('homescreen-note');
const footerInstallBtn = document.getElementById('footer-install-btn');

let deferredInstall = null;

// Chrome and Edge fire this when the app qualifies for installation, and let
// the page trigger the real prompt later. Safari never fires it.
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstall = event;
  if (isInstalled()) return;

  // The footer button appears whether or not the banner was dismissed:
  // waving away the reminder should not cost someone the ability to install.
  footerInstallBtn.hidden = false;

  if (!hintWasDismissed()) {
    // Deliberately avoids the word "install": nothing is installed on the
    // device. Chrome labels its own dialog that way, but the honest
    // description is a shortcut plus storage that stops being cleared.
    installText.textContent = 'Add this to your Home Screen so your entries '
      + 'stop being at risk of the browser clearing them. It stays a web '
      + 'page — nothing is installed on your phone.';
    installBtn.hidden = false;
    installHint.hidden = false;
  }
});

async function runInstall() {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  const { outcome } = await deferredInstall.userChoice;
  // The event can only be used once. If they declined, the browser will fire
  // a fresh one later; until then there is nothing to offer.
  deferredInstall = null;
  installHint.hidden = true;
  footerInstallBtn.hidden = true;
  if (outcome === 'accepted') footerNote.hidden = true;
}

installBtn.addEventListener('click', runInstall);
footerInstallBtn.addEventListener('click', runInstall);

// Fires after an install completes by any route, including the browser's own
// menu rather than our button.
window.addEventListener('appinstalled', () => {
  installHint.hidden = true;
  footerNote.hidden = true;
});

document.getElementById('install-dismiss').addEventListener('click', () => {
  installHint.hidden = true;
  try {
    localStorage.setItem(HINT_DISMISSED, '1');
  } catch {
    /* nothing to do; the hint simply reappears next time */
  }
});

// Safari has no install prompt at all, so iOS users get instructions instead.
// Without this they would never know the Home Screen step exists.
function maybeShowIosHint() {
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua)
    // iPadOS reports itself as a Mac; the touch points give it away.
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);

  if (isIos && isSafari && !isInstalled() && !hintWasDismissed()) {
    installText.textContent = 'Add this to your Home Screen — tap Share, then '
      + '“Add to Home Screen”. Your entries can be cleared by iOS if you don’t.';
    installHint.hidden = false;
  }
}

maybeShowIosHint();

// Once the app is installed the footer reminder is just noise, and the advice
// no longer applies — the data is already protected from eviction.
if (isInstalled()) {
  footerNote.hidden = true;
}

// Asks the browser to protect this data, and reports what it answered.
reportStorageDurability();

// Service workers need HTTPS (localhost excepted), so this does nothing when
// testing over a plain-http LAN address and starts working once deployed.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('Offline support unavailable:', err);
    });
  });
}
