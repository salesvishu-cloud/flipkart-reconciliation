/* Shared helpers: formatting, SKU cleaning, number parsing. */
const U = (() => {
  const inr0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  const inr2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function r2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

  /** ₹12,34,567 (no decimals) — sign-aware. */
  function money(n, opts = {}) {
    if (n == null || isNaN(n)) return '—';
    const sign = n < 0 ? '-' : (opts.plus && n > 0 ? '+' : '');
    return sign + '₹' + (opts.dec ? inr2 : inr0).format(Math.abs(n));
  }
  /** Compact ₹ for charts: ₹9.8L, ₹1.2Cr, ₹45K. */
  function moneyShort(n) {
    if (n == null || isNaN(n)) return '—';
    const a = Math.abs(n), s = n < 0 ? '-' : '';
    if (a >= 1e7) return s + '₹' + (a / 1e7).toFixed(2).replace(/\.?0+$/, '') + 'Cr';
    if (a >= 1e5) return s + '₹' + (a / 1e5).toFixed(2).replace(/\.?0+$/, '') + 'L';
    if (a >= 1e3) return s + '₹' + (a / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return s + '₹' + Math.round(a);
  }
  function pct(n, dp = 2) { return n == null || !isFinite(n) ? '—' : n.toFixed(dp) + '%'; }
  function int(n) { return inr0.format(n || 0); }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** Remove invisible characters and trim; used for raw-issue detection. */
  function stripInvisible(s) { return String(s ?? '').replace(/[​-‍﻿]/g, '').replace(/ /g, ' '); }

  /**
   * Standard SKU key: trim, collapse inner whitespace, uppercase.
   * Deliberately strict — no punctuation removal, so different SKUs never merge.
   */
  function cleanSku(v) {
    if (v == null) return '';
    let s = stripInvisible(v).trim().replace(/\s+/g, ' ');
    if (/^(nan|null|undefined|-|na|n\/a)$/i.test(s)) return '';
    return s.toUpperCase();
  }
  /** Loose key, ONLY for "potential match" suggestions — never for merging. */
  function looseSku(k) { return k.replace(/[^A-Z0-9]/g, '').replace(/^0+/, ''); }

  /**
   * Convert a cell to a number. Returns {value, kind}
   * kind: 'num' | 'blank' | 'text-num' (text that parsed) | 'invalid'
   */
  function toNumber(v) {
    if (v == null) return { value: null, kind: 'blank' };
    if (typeof v === 'number') return isFinite(v) ? { value: v, kind: 'num' } : { value: null, kind: 'invalid' };
    let s = stripInvisible(v).trim();
    if (s === '' || /^(-|na|n\/a|nil|null|nan)$/i.test(s)) return { value: null, kind: 'blank' };
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/₹|â‚¹|rs\.?|inr/gi, '').replace(/[,\s]/g, '');
    if (/^\(.*\)$/.test(s)) { neg = !neg; s = s.slice(1, -1); }
    if (/-$/.test(s)) { neg = !neg; s = s.slice(0, -1); }
    if (/cr$/i.test(s)) s = s.replace(/cr$/i, '');
    else if (/dr$/i.test(s)) { neg = !neg; s = s.replace(/dr$/i, ''); }
    if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return { value: null, kind: 'invalid' };
    const n = parseFloat(s) * (neg ? -1 : 1);
    return isFinite(n) ? { value: n, kind: 'text-num' } : { value: null, kind: 'invalid' };
  }

  function normHeader(h) { return String(h ?? '').toLowerCase().replace(/[_\-.]/g, ' ').replace(/\s+/g, ' ').trim(); }

  /** Detect settlement dates from file names such as "FKPR 08-09-2026.xlsx" or "2026-09-08". */
  function dateFromName(name) {
    if (!name) return null;
    let m = name.match(/(20\d{2})[-_. ](\d{1,2})[-_. ](\d{1,2})/);
    if (m) return mk(+m[1], +m[2], +m[3]);
    m = name.match(/(\d{1,2})[-_. ](\d{1,2})[-_. ](20\d{2}|\d{2})/);
    if (m) return mk(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
    return null;
    function mk(y, mo, d) { const dt = new Date(y, mo - 1, d); return (dt.getMonth() === mo - 1) ? dt : null; }
  }
  function isoDate(d) { const z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; }
  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return { year: t.getUTCFullYear(), week: Math.ceil(((t - y0) / 864e5 + 1) / 7) };
  }
  function weekLabelFor(d) {
    const w = isoWeek(d);
    return `${w.year}-W${String(w.week).padStart(2, '0')}`;
  }
  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function debounce(fn, ms = 200) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  function toast(msg, ms = 2600) {
    const el = document.getElementById('toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => el.hidden = true, ms);
  }

  return { r2, money, moneyShort, pct, int, esc, cleanSku, looseSku, toNumber, normHeader, stripInvisible, dateFromName, isoDate, weekLabelFor, fmtDate, debounce, toast };
})();
