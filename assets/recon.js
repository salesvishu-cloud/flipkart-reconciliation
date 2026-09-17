/* Reconciliation engine: cleaning, data-quality checks, matching, statuses. */
const Recon = (() => {
  const S = { OK: 'Reconciled', SHORT: 'Short Payment', EXCESS: 'Excess Payment', NR: 'Payment Not Received', UNM: 'Unmatched SKU', NOSALE: 'No Sales This Week' };
  const STATUS_KEY = { [S.OK]: 'Reconciled', [S.SHORT]: 'Short', [S.EXCESS]: 'Excess', [S.NR]: 'NotReceived', [S.UNM]: 'Unmatched', [S.NOSALE]: 'NoSales' };
  const ACTION = { [S.OK]: 'Reconciled', [S.SHORT]: 'Check Short Payment', [S.EXCESS]: 'Check Excess Payment', [S.NR]: 'Check Missing Payment', [S.UNM]: 'Unmatched SKU', [S.NOSALE]: 'No action' };
  const EXCEPTIONS = [S.SHORT, S.NR, S.EXCESS, S.UNM];
  const RECOVERY = [S.SHORT, S.NR, S.UNM];
  const BLANK_KEY = '(BLANK SKU)';

  const DEFAULTS = { tolerance: 1, tolerancePct: 0, mode: 'auto', returns: 'zero', dupAgg: 'auto' };

  function isReturnValue(v) {
    const s = String(v ?? '').trim().toLowerCase();
    return !!s && !/^(na|n\/a|none|no|nil|-|null|0|false|not returned)$/.test(s);
  }

  function newDQ() {
    const items = {};
    const add = (id, severity, title, desc, row) => {
      const it = items[id] || (items[id] = { id, severity, title, desc, rows: [], count: 0 });
      it.count++;
      if (row && it.rows.length < 500) it.rows.push(row);
    };
    return { items, add };
  }

  /** Read one file's rows into cleaned records, logging every issue. */
  function readRows(parsed, map, fileLabel, dq, withOrders) {
    const recs = [];
    const variants = new Map();
    let blankRows = 0;
    for (const { cells, excelRow } of parsed.rows) {
      const rawSku = cells[map.sku];
      const rawAmt = cells[map.amount];
      const key = U.cleanSku(rawSku);
      const amt = U.toNumber(rawAmt);
      const orderId = withOrders && map.order != null ? String(cells[map.order] ?? '').trim() : '';
      if (!key && amt.kind === 'blank' && !orderId) { blankRows++; continue; }

      const where = { file: fileLabel, row: excelRow, sku: String(rawSku ?? ''), value: String(rawAmt ?? '') };
      if (key) {
        const trimmed = U.stripInvisible(rawSku).trim();
        if (String(rawSku) !== trimmed.replace(/\s+/g, ' ') || /\s{2,}/.test(String(rawSku))) dq.add(`space-${fileLabel}`, 'info', `Extra spaces in SKU — ${fileLabel}`, 'Leading, trailing or double spaces were removed automatically.', where);
        const tv = trimmed.replace(/\s+/g, ' ');
        if (!variants.has(key)) variants.set(key, new Set());
        variants.get(key).add(tv);
      } else {
        dq.add(`blanksku-${fileLabel}`, withOrders ? 'warning' : 'error', `Blank SKU — ${fileLabel}`, withOrders ? 'Rows with an amount but no SKU. The app tries to fill the SKU from other rows of the same Order ID; otherwise they are reported as "(BLANK SKU)".' : 'Rows with an amount but no SKU. These are reported as "(BLANK SKU)" so the money is not lost.', { ...where, note: orderId ? `Order ${orderId}` : '' });
      }
      let value = amt.value;
      if (amt.kind === 'blank') { dq.add(`blankamt-${fileLabel}`, 'warning', `Blank amount — ${fileLabel}`, 'Rows with a SKU but no amount. Treated as ₹0.', where); value = 0; }
      else if (amt.kind === 'invalid') { dq.add(`invalid-${fileLabel}`, 'error', `Invalid amount — ${fileLabel}`, 'Amount cells that are not numbers. Treated as ₹0 — please verify.', where); value = 0; }
      else if (amt.kind === 'text-num') dq.add(`textnum-${fileLabel}`, 'info', `Numbers stored as text — ${fileLabel}`, 'Converted to numbers automatically (₹, commas and brackets handled).', where);
      if (value < 0) dq.add(`neg-${fileLabel}`, withOrders ? 'info' : 'warning', `Negative amounts — ${fileLabel}`, withOrders ? 'Negative rows (reversals, return deductions, fees) are included in the SKU total.' : 'Negative expected amounts — please verify.', where);

      recs.push({
        key, value, excelRow, orderId,
        qty: withOrders && map.qty != null ? (U.toNumber(cells[map.qty]).value ?? null) : null,
        returned: withOrders && map.returnType != null ? isReturnValue(cells[map.returnType]) : false,
      });
    }
    for (const [key, set] of variants) {
      if (set.size > 1) dq.add(`case-${fileLabel}`, 'info', `Different capitalisation / spacing of the same SKU — ${fileLabel}`, 'These spellings were treated as ONE SKU after cleaning.', { file: fileLabel, sku: key, value: [...set].join('  |  ') });
    }
    if (blankRows) dq.add(`blankrows-${fileLabel}`, 'info', `Empty rows skipped — ${fileLabel}`, `${blankRows} completely empty row(s) were ignored.`, null), (dq.items[`blankrows-${fileLabel}`].count = blankRows);
    return recs;
  }

  function run(expParsed, actParsed, mapping, settings) {
    const cfg = { ...DEFAULTS, ...settings };
    const dq = newDQ();
    const eMap = mapping.expected, aMap = mapping.actual;
    const eRecs = readRows(expParsed, eMap, 'Expected', dq, false);
    const aRecs = readRows(actParsed, aMap, 'Actual', dq, true);
    if (!eRecs.length) throw new Error('The Expected Settlement file has no usable rows after cleaning. Check that the SKU and amount columns are correct.');
    if (!aRecs.length) throw new Error('The Actual Settlement file has no usable rows after cleaning. Check that the SKU and amount columns are correct.');

    // --- Fill blank Actual SKUs from other rows of the same order
    const orderSkus = new Map();
    for (const r of aRecs) if (r.key && r.orderId) { if (!orderSkus.has(r.orderId)) orderSkus.set(r.orderId, new Set()); orderSkus.get(r.orderId).add(r.key); }
    for (const r of aRecs) {
      if (r.key) continue;
      const set = r.orderId && orderSkus.get(r.orderId);
      if (set && set.size === 1) {
        r.key = [...set][0];
        dq.add('blankfill', 'info', 'Blank SKU filled from same Order ID — Actual', 'The SKU was taken from other rows of the same order.', { file: 'Actual', row: r.excelRow, sku: r.key, value: U.r2(r.value), note: `Order ${r.orderId}` });
      } else r.key = BLANK_KEY;
    }
    for (const r of eRecs) if (!r.key) r.key = BLANK_KEY;

    // --- Mode detection
    const aKeys = new Set(aRecs.map(r => r.key));
    const eCount = new Map();
    for (const r of eRecs) eCount.set(r.key, (eCount.get(r.key) || 0) + 1);
    const hasOrders = aMap.order != null;
    let mode = cfg.mode;
    if (mode === 'auto') mode = hasOrders && aRecs.length / Math.max(aKeys.size, 1) >= 1.5 ? 'rate' : 'total';
    if (mode === 'rate' && !hasOrders) mode = 'total';

    // --- Expected aggregation
    let agg = cfg.dupAgg === 'auto' ? (mode === 'rate' ? 'first' : 'sum') : cfg.dupAgg;
    const eGroups = new Map();
    for (const r of eRecs) { if (!eGroups.has(r.key)) eGroups.set(r.key, []); eGroups.get(r.key).push(r); }
    const expected = new Map();
    for (const [k, rs] of eGroups) {
      const vals = rs.map(r => r.value);
      let v;
      if (agg === 'sum') v = vals.reduce((a, b) => a + b, 0);
      else if (agg === 'max') v = Math.max(...vals);
      else if (agg === 'avg') v = vals.reduce((a, b) => a + b, 0) / vals.length;
      else v = vals[0];
      expected.set(k, v);
      if (rs.length > 1) {
        const differ = new Set(vals.map(x => U.r2(x))).size > 1;
        for (const r of rs) dq.add('dup-Expected', differ ? 'warning' : 'info', 'Duplicate SKUs — Expected', `Same SKU appears more than once. Combined using "${agg}"${mode === 'rate' ? ' (per-unit rate mode)' : ''}. Change this under Settings.`, { file: 'Expected', row: r.excelRow, sku: k, value: U.r2(r.value), note: differ ? 'Different values!' : 'Same value' });
      }
    }

    // --- Actual aggregation (always SUM), with order-level detail
    const actual = new Map();
    for (const r of aRecs) {
      let a = actual.get(r.key);
      if (!a) actual.set(r.key, a = { total: 0, rows: 0, orders: new Map() });
      a.total += r.value; a.rows++;
      const oid = r.orderId || `row-${r.excelRow}`;
      let o = a.orders.get(oid);
      if (!o) a.orders.set(oid, o = { orderId: r.orderId || '(no order id)', qty: 0, returned: false, actual: 0, rows: 0 });
      o.actual += r.value; o.rows++;
      o.qty = Math.max(o.qty, r.qty == null ? 1 : r.qty);
      o.returned = o.returned || r.returned;
    }
    let multiRow = 0;
    for (const [k, a] of actual) if (a.rows > 1) { multiRow++; }
    if (multiRow) dq.add('dup-Actual', 'info', 'Multiple transactions per SKU — Actual', `${multiRow} SKU(s) have more than one payment row. All rows were SUMMED per SKU before comparison.`, null), (dq.items['dup-Actual'].count = multiRow);

    // --- Build master table
    const keys = new Set([...expected.keys(), ...actual.keys()]);
    const rows = [];
    for (const k of keys) {
      const inE = expected.has(k), inA = actual.has(k);
      const a = actual.get(k);
      const rate = inE ? expected.get(k) : null;
      let exp = 0, units = null, returnedUnits = null, orders = null;
      if (mode === 'rate') {
        if (a) {
          units = 0; returnedUnits = 0; orders = [];
          for (const o of a.orders.values()) {
            if (o.returned) returnedUnits += o.qty; else units += o.qty;
            const oe = inE ? (o.returned && cfg.returns === 'zero' ? 0 : rate * o.qty) : 0;
            orders.push({ ...o, expected: oe, diff: o.actual - oe });
          }
          exp = inE ? rate * (units + (cfg.returns === 'full' ? returnedUnits : 0)) : 0;
        }
      } else exp = inE ? rate : 0;
      const act = a ? a.total : 0;
      const diff = act - exp;
      const tol = Math.max(cfg.tolerance, Math.abs(exp) * cfg.tolerancePct / 100);
      let status;
      if (inE && !inA) status = mode === 'rate' ? S.NOSALE : S.NR;
      else if (!inE && inA) status = S.UNM;
      else if (k === BLANK_KEY) status = S.UNM;
      else if (Math.abs(diff) <= tol) status = S.OK;
      else if (exp > 0 && Math.abs(act) <= tol) status = S.NR;
      else status = diff < 0 ? S.SHORT : S.EXCESS;
      if (status === S.NR && mode === 'total') dq.add('onlyExp', 'warning', 'SKU present only in Expected file', 'No payment row found for these SKUs.', { file: 'Expected', sku: k, value: U.r2(exp) });
      if (status === S.NOSALE) dq.add('onlyExpNoSale', 'info', 'SKU present only in Expected file (no orders this week)', 'Rate-card SKUs with no orders in the Actual file. Not counted as exceptions.', { file: 'Expected', sku: k, value: U.r2(rate) });
      if (status === S.UNM) dq.add('onlyAct', 'warning', 'SKU present only in Actual file', 'Payment received for SKUs that are not in the Expected file.', { file: 'Actual', sku: k, value: U.r2(act) });
      rows.push({
        sku: k, rate: mode === 'rate' ? rate : null, units, returnedUnits,
        orderCount: a ? a.orders.size : 0, txnCount: a ? a.rows : 0,
        expected: U.r2(exp), actual: U.r2(act), diff: U.r2(diff),
        diffPct: exp ? U.r2(diff / Math.abs(exp) * 100) : null,
        status, action: ACTION[status], orders,
      });
    }

    const potential = findPotential(rows);
    for (const p of potential) dq.add('potential', 'warning', 'Potential SKU match — requires review', 'SKUs that look alike but were NOT merged (see Exceptions page).', { file: 'Both', sku: `${p.a}  ↔  ${p.b}`, value: '', note: p.reason });

    const summary = summarize(rows, mode);
    const dqList = Object.values(dq.items).sort((x, y) => sevRank(x.severity) - sevRank(y.severity));
    return { mode, agg, settings: cfg, rows, summary, potential, dq: dqList, files: { expected: expParsed.fileName, actual: actParsed.fileName }, counts: { expectedRows: eRecs.length, actualRows: aRecs.length } };
  }

  function sevRank(s) { return { error: 0, warning: 1, info: 2 }[s] ?? 3; }

  function findPotential(rows) {
    const onlyE = rows.filter(r => r.status === S.NR || r.status === S.NOSALE);
    const onlyA = rows.filter(r => r.status === S.UNM && r.sku !== BLANK_KEY);
    const byLoose = new Map();
    for (const r of onlyE) { const l = U.looseSku(r.sku); if (l) (byLoose.get(l) || byLoose.set(l, []).get(l)).push(r); }
    const out = [];
    for (const u of onlyA) {
      const l = U.looseSku(u.sku);
      for (const e of byLoose.get(l) || []) out.push({ a: u.sku, b: e.sku, reason: 'Same letters/numbers, different punctuation or spacing' });
      if (out.length > 200) break;
    }
    return out;
  }

  function summarize(rows, mode) {
    const s = { totalExpected: 0, totalActual: 0, net: 0, shortTotal: 0, excessTotal: 0, recovery: 0, counts: {}, activeSkus: 0, units: 0, returnedUnits: 0, orders: 0 };
    for (const k of Object.values(S)) s.counts[k] = 0;
    for (const r of rows) {
      s.counts[r.status]++;
      if (r.status === S.NOSALE) continue;
      s.activeSkus++;
      s.totalExpected += r.expected; s.totalActual += r.actual;
      if (r.diff < 0 && r.status !== S.OK) s.shortTotal += r.diff;
      if (r.diff > 0 && r.status !== S.OK) s.excessTotal += r.diff;
      if ((r.status === S.SHORT || r.status === S.NR) && r.diff < 0) s.recovery -= r.diff;
      s.units += r.units || 0; s.returnedUnits += r.returnedUnits || 0; s.orders += r.orderCount || 0;
    }
    s.net = s.totalActual - s.totalExpected;
    s.reconPct = s.totalExpected ? s.totalActual / s.totalExpected * 100 : null;
    s.exceptions = EXCEPTIONS.reduce((n, k) => n + s.counts[k], 0);
    s.skuMatchPct = s.activeSkus ? s.counts[S.OK] / s.activeSkus * 100 : null;
    for (const k of ['totalExpected', 'totalActual', 'net', 'shortTotal', 'excessTotal', 'recovery']) s[k] = U.r2(s[k]);
    return s;
  }

  return { S, STATUS_KEY, ACTION, EXCEPTIONS, RECOVERY, DEFAULTS, BLANK_KEY, run };
})();
