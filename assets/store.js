/*
 * Weekly history + settings.
 * - Published link: history lives in the artifact's shared database (same for everyone who opens the link).
 * - Local file: history lives in this browser's localStorage.
 * An in-memory cache keeps reads synchronous for the views.
 */
const Store = (() => {
  const KEY = 'oakcraft.fk.recon.history.v1';
  const SKEY = 'oakcraft.fk.recon.settings.v1';
  let cache = null;
  let db = null;

  function safeGet(k, fallback) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  }
  function safeSet(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { console.error(e); return false; }
  }
  const sortWeeks = a => a.sort((x, y) => (x.date || '').localeCompare(y.date || ''));
  const docId = w => (w.date + '_' + w.label).replace(/[^A-Za-z0-9_\-.~:@+]/g, '-');

  function weeks() {
    if (!cache) { const w = safeGet(KEY, []); cache = Array.isArray(w) ? w : []; }
    return sortWeeks(cache.slice());
  }
  function persistLocal() { return safeSet(KEY, cache); }

  /** Attach the shared database when running as a published page. */
  async function connect(onChange) {
    try {
      db = window.claude && window.claude.use ? await window.claude.use('db') : null;
    } catch { db = null; }
    if (!db) return;
    db.collection('weeks').onSnapshot(snap => {
      cache = snap.docs.map(d => d.data()).filter(Boolean).map(w => JSON.parse(JSON.stringify(w)));
      persistLocal();
      onChange && onChange();
    }, err => {
      console.error(err);
      db = null;
    });
  }
  const mode = () => db ? 'shared' : 'browser';

  /** Save (or replace) a week. Keeps only what history needs. */
  async function saveWeek(label, date, result) {
    weeks();
    const rec = {
      id: date + '|' + label,
      label, date, savedAt: new Date().toISOString(),
      mode: result.mode, files: result.files,
      summary: result.summary,
      rows: result.rows.filter(r => r.status !== Recon.S.NOSALE).map(r => ({ s: r.sku, e: r.expected, a: r.actual, d: r.diff, st: r.status, u: r.units })),
    };
    const i = cache.findIndex(w => w.label === label || w.date === date);
    const old = i >= 0 ? cache[i] : null;
    if (i >= 0) cache[i] = rec; else cache.push(rec);
    persistLocal();
    if (db) {
      try {
        if (old && docId(old) !== docId(rec)) await db.doc('weeks/' + docId(old)).delete();
        await db.doc('weeks/' + docId(rec)).set(rec);
      } catch (e) {
        console.error(e);
        return { ok: false, message: e.code === 'invalid_argument' ? 'You do not have permission to save weeks on this link, or the week is too large.' : e.code === 'quota_exceeded' ? 'Shared storage is full — delete old weeks.' : (e.message || 'Shared storage is unavailable.') };
      }
    } else if (!safeSet(KEY, cache)) return { ok: false, message: 'Browser storage is blocked or full.' };
    return { ok: true, replaced: i >= 0 };
  }
  function findWeek(label, date) { return weeks().find(w => w.label === label || w.date === date); }
  async function deleteWeek(id) {
    const w = weeks().find(x => x.id === id);
    cache = cache.filter(x => x.id !== id);
    persistLocal();
    if (db && w) await db.doc('weeks/' + docId(w)).delete();
  }

  function skuHistory(sku) {
    return weeks().map(w => {
      const r = w.rows.find(x => x.s === sku);
      return r ? { week: w.label, date: w.date, expected: r.e, actual: r.a, diff: r.d, status: r.st, units: r.u } : null;
    }).filter(Boolean);
  }

  function backup() { return JSON.stringify({ app: 'oakcraft-flipkart-recon', version: 1, exportedAt: new Date().toISOString(), weeks: weeks(), settings: loadSettings() }, null, 1); }
  async function restore(text) {
    const data = JSON.parse(text);
    if (!data || data.app !== 'oakcraft-flipkart-recon' || !Array.isArray(data.weeks)) throw new Error('This is not a Flipkart Reconciliation backup file.');
    weeks();
    let added = 0, replaced = 0;
    for (const w of data.weeks) {
      const i = cache.findIndex(x => x.id === w.id);
      if (i >= 0) { cache[i] = w; replaced++; } else { cache.push(w); added++; }
      if (db) await db.doc('weeks/' + docId(w)).set(w);
    }
    if (!persistLocal() && !db) throw new Error('Browser storage is full or blocked.');
    return { added, replaced };
  }

  function loadSettings() { return { ...Recon.DEFAULTS, ...safeGet(SKEY, {}) }; }
  function saveSettings(s) { safeSet(SKEY, s); }

  return { connect, mode, weeks, saveWeek, findWeek, deleteWeek, skuHistory, backup, restore, loadSettings, saveSettings };
})();
