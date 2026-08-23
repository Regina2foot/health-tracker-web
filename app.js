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

function loadAll() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch (err) {
    console.warn('Could not read saved entries:', err);
    return {};
  }
}

function saveAll(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    return true;
  } catch (err) {
    console.warn('Could not save entries:', err);
    return false;
  }
}

function getEntry(isoDate) {
  return loadAll()[isoDate] || null;
}

function allEntriesNewestFirst() {
  return Object.values(loadAll()).sort((a, b) => b.date.localeCompare(a.date));
}

function removeEntry(isoDate) {
  const entries = loadAll();
  delete entries[isoDate];
  return saveAll(entries);
}

function upsertEntry(isoDate, values) {
  const entries = loadAll();
  const now = new Date().toISOString();
  const existing = entries[isoDate];

  entries[isoDate] = {
    date: isoDate,
    mood: values.mood,
    energy: values.energy,
    stress: values.stress,
    sleep_hours: values.sleep_hours,
    note: values.note,
    created_at: existing ? existing.created_at : now,
    updated_at: now,
  };
  return saveAll(entries);
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
  prevDay: document.getElementById('prev-day'),
  nextDay: document.getElementById('next-day'),
  todayBtn: document.getElementById('today-btn'),
  dayLabel: document.getElementById('day-label'),
  dayStatus: document.getElementById('day-status'),
  form: document.getElementById('entry-form'),
  sleep: document.getElementById('sleep-input'),
  sleepClear: document.getElementById('sleep-clear'),
  note: document.getElementById('note-input'),
  saveBtn: document.getElementById('save-btn'),
  feedback: document.getElementById('save-feedback'),
};

let currentDate = todayIso();
let dirty = false;

function markDirty() {
  dirty = true;
  el.feedback.textContent = '';
  el.feedback.classList.remove('is-error');
}

function loadDate(isoDate) {
  currentDate = isoDate;
  const entry = getEntry(isoDate);

  el.dateInput.value = isoDate;
  el.dayLabel.textContent = prettyDate(isoDate);
  // Tomorrow cannot be rated, so there is nothing to step forward to.
  el.nextDay.disabled = isoDate >= todayIso();

  setScale('mood', entry ? entry.mood : null);
  setScale('energy', entry ? entry.energy : null);
  // `!= null` on purpose: catches undefined too, so an entry written by an
  // older version without the field shows blank rather than "undefined".
  el.sleep.value = entry && entry.sleep_hours != null ? entry.sleep_hours : '';
  el.note.value = entry ? entry.note || '' : '';

  el.dayStatus.textContent = entry
    ? 'Editing an entry you already saved.'
    : 'Nothing saved for this day yet.';
  el.saveBtn.textContent = entry ? 'Update' : 'Save';
  el.feedback.textContent = '';
  el.feedback.classList.remove('is-error');
  dirty = false;
}

function goTo(isoDate) {
  if (isoDate === currentDate) return;
  if (isoDate > todayIso()) {
    showError('You can only log days up to today.');
    el.dateInput.value = currentDate;
    return;
  }
  if (dirty && !confirm('This day has unsaved changes. Discard them?')) {
    el.dateInput.value = currentDate;
    return;
  }
  loadDate(isoDate);
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

function save() {
  let sleepHours;
  try {
    sleepHours = readSleep();
  } catch (err) {
    showError(err.message);
    return;
  }

  const note = el.note.value.trim();
  const values = {
    mood: scales.mood.value,
    energy: scales.energy.value,
    // Stress was retired from the interface. Anything already recorded is
    // carried through rather than wiped, so the decision stays reversible.
    stress: getEntry(currentDate)?.stress ?? null,
    sleep_hours: sleepHours,
    note,
  };

  const isEmpty = values.mood === null && values.energy === null
    && sleepHours === null && note === '';
  if (isEmpty) {
    showError('Nothing to save — fill in at least one field.');
    return;
  }

  if (!upsertEntry(currentDate, values)) {
    showError('Could not save. Private browsing can block storage.');
    return;
  }

  dirty = false;
  el.saveBtn.textContent = 'Update';
  el.dayStatus.textContent = 'Editing an entry you already saved.';
  el.feedback.textContent = 'Saved.';
  el.feedback.classList.remove('is-error');
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
  if (entry.sleep_hours != null) bits.push(`Sleep ${entry.sleep_hours} h`);
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
    open.setAttribute('aria-label', `Edit ${entry.date}`);

    const date = document.createElement('span');
    date.className = 'history-date';
    date.textContent = shortDate(entry.date);

    const summary = document.createElement('span');
    summary.className = 'history-summary';
    summary.textContent = summarise(entry);

    open.append(date, summary);

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
      goTo(entry.date);
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'history-delete';
    remove.textContent = 'Delete';
    remove.setAttribute('aria-label', `Delete ${entry.date}`);
    remove.addEventListener('click', () => {
      if (!confirm(`Delete the entry for ${entry.date}? This cannot be undone.`)) return;
      removeEntry(entry.date);
      renderHistory();
      if (entry.date === currentDate) loadDate(currentDate);
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

function exportJson() {
  const payload = {
    app: 'health-tracker',
    version: 1,
    exported_at: new Date().toISOString(),
    entries: allEntriesNewestFirst(),
  };
  download(
    `health-tracker-${todayIso()}.json`,
    JSON.stringify(payload, null, 2),
    'application/json',
  );
}

function csvCell(value) {
  if (value == null) return '';
  const text = String(value);
  // Quote anything that would otherwise break the row apart.
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCsv() {
  // Same column order as the desktop app's export, so the two are readable
  // by the same tools.
  const columns = ['date', 'mood', 'note', 'sleep_hours', 'energy', 'stress',
    'created_at', 'updated_at'];
  const rows = allEntriesNewestFirst().reverse();  // oldest first, like desktop
  const lines = [columns.join(',')];
  for (const entry of rows) {
    lines.push(columns.map((column) => csvCell(entry[column])).join(','));
  }
  download(`health-tracker-${todayIso()}.csv`, lines.join('\n'), 'text/csv');
}

function showImportResult(message, isError) {
  importFeedback.textContent = message;
  importFeedback.classList.toggle('is-error', Boolean(isError));
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

    const incoming = Array.isArray(payload) ? payload : payload.entries;
    if (!Array.isArray(incoming)) {
      showImportResult('That file has no entries in it.', true);
      return;
    }

    const entries = loadAll();
    let added = 0;
    let replaced = 0;
    let skipped = 0;

    for (const entry of incoming) {
      // Only take rows that look like entries; a stray file should not be
      // able to write nonsense into storage.
      if (!entry || typeof entry.date !== 'string'
          || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
        skipped++;
        continue;
      }
      if (entries[entry.date]) replaced++; else added++;
      entries[entry.date] = {
        date: entry.date,
        mood: entry.mood ?? null,
        energy: entry.energy ?? null,
        stress: entry.stress ?? null,
        sleep_hours: entry.sleep_hours ?? null,
        note: typeof entry.note === 'string' ? entry.note : '',
        created_at: entry.created_at || new Date().toISOString(),
        updated_at: entry.updated_at || new Date().toISOString(),
      };
    }

    if (replaced && !confirm(
      `${replaced} day${replaced === 1 ? '' : 's'} already exist and will be `
      + `overwritten by the backup. Continue?`)) {
      showImportResult('Import cancelled — nothing changed.');
      return;
    }

    if (!saveAll(entries)) {
      showImportResult('Could not save the imported entries.', true);
      return;
    }

    renderHistory();
    loadDate(currentDate);
    const parts = [`${added} added`, `${replaced} replaced`];
    if (skipped) parts.push(`${skipped} skipped`);
    showImportResult(`Restored: ${parts.join(', ')}.`);
  };

  reader.readAsText(file);
}

/* ------------------------------------------------------------------ */
/* trends                                                              */
/* ------------------------------------------------------------------ */

/* Drawn as SVG rather than canvas: it stays sharp on high-density phone
 * screens without any pixel-ratio juggling, and the elements can be styled
 * from CSS.
 *
 * Two panels, because the units differ. Mood and energy share a 1-10 axis and
 * can be read against each other; sleep is in hours and gets its own.
 * A 7-hour night plotted on a 1-10 axis would sit off the top of the chart. */

const SERIES = {
  mood: { label: 'Mood', colour: '#2563eb' },
  energy: { label: 'Energy', colour: '#ea580c' },
  sleep_hours: { label: 'Sleep', colour: '#0d9488' },
};

const SVG_NS = 'http://www.w3.org/2000/svg';

const chartHolder = document.getElementById('chart-holder');
const trendsSummary = document.getElementById('trends-summary');
const trendsEmpty = document.getElementById('trends-empty');

let rangeDays = 30;                 // a number of days, or the string 'all'
const seriesOn = { mood: true, energy: true, sleep_hours: true };

function svgEl(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }
  return node;
}

function daysInRange() {
  const today = todayIso();
  let span = rangeDays;

  if (span === 'all') {
    // From the very first entry to today. With a single day logged that is a
    // one-day span, which is correct — "All" is allowed to be the shortest
    // range, not just the longest.
    const dates = Object.keys(loadAll()).sort();
    if (!dates.length) return [today];
    span = daysBetween(dates[0], today) + 1;
  }

  const out = [];
  for (let back = span - 1; back >= 0; back--) {
    out.push(shiftIso(today, -back));
  }
  return out;
}

function daysBetween(fromIso, toIso_) {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso_.split('-').map(Number);
  // UTC on both sides so a clock change between the dates cannot knock the
  // division off by an hour and lose a day.
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / 86400000);
}

function renderTrends() {
  chartHolder.textContent = '';
  const entries = loadAll();

  if (!Object.keys(entries).length) {
    trendsSummary.textContent = '';
    trendsEmpty.textContent = 'Nothing logged yet — save a day to see trends.';
    return;
  }

  const days = daysInRange();
  const inRange = days.map((d) => entries[d]).filter(Boolean);

  renderSummary(days, inRange);

  const ratingKeys = ['mood', 'energy'].filter((k) => seriesOn[k]);
  const showSleep = seriesOn.sleep_hours;

  if (!ratingKeys.length && !showSleep) {
    trendsEmpty.textContent = 'Nothing selected — tap a value above to chart it.';
    return;
  }
  trendsEmpty.textContent = '';

  // Measured rather than a fixed viewBox, so labels stay the same size on a
  // phone and on a wide window instead of being scaled up with the drawing.
  const width = chartHolder.clientWidth || 340;
  const bothPanels = ratingKeys.length && showSleep;
  const ratingHeight = bothPanels ? 190 : 230;
  const sleepHeight = bothPanels ? 150 : 230;
  const totalHeight = (ratingKeys.length ? ratingHeight : 0)
    + (showSleep ? sleepHeight : 0);

  const svg = svgEl('svg', {
    width: '100%',
    height: totalHeight,
    viewBox: `0 0 ${width} ${totalHeight}`,
    role: 'img',
    'aria-label': 'Chart of your logged values over time',
  });

  let top = 0;
  if (ratingKeys.length) {
    drawPanel(svg, {
      days, width, top, height: ratingHeight,
      keys: ratingKeys, low: 1, high: RATING_MAX, tickStep: 3,
      showDates: !showSleep, entries,
    });
    top += ratingHeight;
  }
  if (showSleep) {
    const hours = days.map((d) => entries[d]?.sleep_hours)
      .filter((v) => v != null);
    const high = hours.length ? Math.max(10, Math.ceil(Math.max(...hours))) : 10;
    drawPanel(svg, {
      days, width, top, height: sleepHeight,
      keys: ['sleep_hours'], low: 0, high, tickStep: Math.max(2, Math.ceil(high / 4)),
      showDates: true, entries,
    });
  }

  chartHolder.appendChild(svg);
}

function drawPanel(svg, opts) {
  const { days, width, top, height, keys, low, high, tickStep, showDates, entries } = opts;
  const padLeft = 30;
  const padRight = 10;
  const padTop = 22;
  const padBottom = showDates ? 26 : 10;

  const plotW = Math.max(width - padLeft - padRight, 10);
  const plotH = Math.max(height - padTop - padBottom, 10);
  const baseY = top + padTop;

  const xFor = (i) => (days.length <= 1
    ? padLeft
    : padLeft + (i * plotW) / (days.length - 1));
  const yFor = (value) => baseY + ((high - value) * plotH) / ((high - low) || 1);

  for (let value = low; value <= high; value += tickStep) {
    const y = yFor(value);
    svg.appendChild(svgEl('line', {
      x1: padLeft, y1: y, x2: padLeft + plotW, y2: y, class: 'grid',
    }));
    const label = svgEl('text', { x: padLeft - 6, y: y + 4, class: 'tick', 'text-anchor': 'end' });
    label.textContent = String(value);
    svg.appendChild(label);
  }

  svg.appendChild(svgEl('line', {
    x1: padLeft, y1: baseY + plotH, x2: padLeft + plotW, y2: baseY + plotH, class: 'axis',
  }));

  if (showDates) {
    // Deduplicated: with a very short range the first, middle and last day
    // can be the same date, which would stack labels on top of each other.
    const marks = [...new Set([0, Math.floor(days.length / 2), days.length - 1])];
    for (const i of marks) {
      const text = svgEl('text', {
        x: xFor(i), y: baseY + plotH + 16, class: 'tick',
        'text-anchor': i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle',
      });
      text.textContent = axisDate(days[i]);
      svg.appendChild(text);
    }
  }

  let legendX = padLeft;
  for (const key of keys) {
    const { label, colour, hint } = SERIES[key];
    drawSeries(svg, days.map((d) => entries[d]?.[key] ?? null), xFor, yFor, colour);

    const text = svgEl('text', { x: legendX, y: top + 14, class: 'legend', fill: colour });
    text.textContent = label + (hint || '');
    svg.appendChild(text);
    // Rough advance: measuring properly needs the node laid out, and this is
    // close enough to keep the three labels apart.
    legendX += (label.length + (hint ? hint.length : 0)) * 6.2 + 12;
  }
}

function drawSeries(svg, values, xFor, yFor, colour) {
  // Consecutive days are joined solidly. Across a gap the two ends are joined
  // with a dotted line instead: the shape stays readable, but the dots say
  // plainly that nothing was recorded in between rather than implying a
  // steady trend through days that were never logged.
  let run = [];
  const runs = [];
  values.forEach((value, i) => {
    if (value == null) {
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push([xFor(i), yFor(value)]);
    }
  });
  if (run.length) runs.push(run);

  // Bridges are drawn first so the solid lines and dots sit on top of them.
  for (let i = 1; i < runs.length; i++) {
    const [fromX, fromY] = runs[i - 1][runs[i - 1].length - 1];
    const [toX, toY] = runs[i][0];
    svg.appendChild(svgEl('line', {
      x1: fromX, y1: fromY, x2: toX, y2: toY,
      stroke: colour, 'stroke-width': 1.5,
      'stroke-dasharray': '2 4', 'stroke-linecap': 'round', opacity: 0.75,
    }));
  }

  for (const points of runs) {
    if (points.length >= 2) {
      svg.appendChild(svgEl('polyline', {
        points: points.map(([x, y]) => `${x},${y}`).join(' '),
        fill: 'none', stroke: colour, 'stroke-width': 2,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      }));
    }
    for (const [x, y] of points) {
      svg.appendChild(svgEl('circle', { cx: x, cy: y, r: 3, fill: colour }));
    }
  }
}

function renderSummary(days, inRange) {
  const parts = [`${inRange.length} of ${days.length} days logged`];

  for (const key of ['mood', 'energy']) {
    const values = inRange.map((e) => e[key]).filter((v) => v != null);
    if (values.length) {
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      parts.push(`${SERIES[key].label} avg ${mean.toFixed(1)}`);
    }
  }

  const sleep = inRange.map((e) => e.sleep_hours).filter((v) => v != null);
  if (sleep.length) {
    const mean = sleep.reduce((a, b) => a + b, 0) / sleep.length;
    parts.push(`Sleep avg ${mean.toFixed(1)} h`);
  }

  const streak = currentStreak();
  if (streak) parts.push(`streak ${streak} day${streak === 1 ? '' : 's'}`);

  trendsSummary.textContent = parts.join('  ·  ');
}

function currentStreak() {
  // Today may be missing without breaking the streak, so it does not read as
  // broken simply because today has not been filled in yet.
  const entries = loadAll();
  let day = todayIso();
  if (!entries[day]) day = shiftIso(day, -1);
  let streak = 0;
  while (entries[day]) {
    streak++;
    day = shiftIso(day, -1);
  }
  return streak;
}

/* ------------------------------------------------------------------ */
/* wiring                                                              */
/* ------------------------------------------------------------------ */

document.querySelectorAll('.scale').forEach(buildScale);

el.prevDay.addEventListener('click', () => goTo(shiftIso(currentDate, -1)));
el.nextDay.addEventListener('click', () => goTo(shiftIso(currentDate, 1)));
el.todayBtn.addEventListener('click', () => goTo(todayIso()));
el.dateInput.addEventListener('change', () => {
  // An emptied or half-typed date must not wipe the view.
  if (el.dateInput.value) goTo(el.dateInput.value);
  else el.dateInput.value = currentDate;
});

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
loadDate(todayIso());

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

let deferredInstall = null;

// Chrome and Edge fire this when the app qualifies for installation, and let
// the page trigger the real prompt later.
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstall = event;
  if (!isInstalled() && !hintWasDismissed()) {
    installText.textContent = 'Install this app to keep your entries safe and '
      + 'open it without a connection.';
    installBtn.hidden = false;
    installHint.hidden = false;
  }
});

installBtn.addEventListener('click', async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
  installHint.hidden = true;
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
  document.getElementById('homescreen-note').hidden = true;
}

// Asks the browser to treat this data as worth keeping. Chrome and Firefox
// honour it; Safari largely grants it to installed apps. It is a request, not
// a guarantee — which is why Save backup exists.
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persisted()
    .then((already) => (already ? true : navigator.storage.persist()))
    .catch(() => false);
}

// Service workers need HTTPS (localhost excepted), so this does nothing when
// testing over a plain-http LAN address and starts working once deployed.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('Offline support unavailable:', err);
    });
  });
}
