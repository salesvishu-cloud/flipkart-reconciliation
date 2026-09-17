/* Rendering of each page. Reads App.state; never mutates results. */
const Views = (() => {
  const $ = id => document.getElementById(id);
  const S = () => Recon.S;
  const badge = st => `<span class="badge b-${Recon.STATUS_KEY[st]}">${U.esc(st)}</span>`;
  const cls = n => n < 0 ? 'neg' : n > 0 ? 'pos' : 'zero';
  const skuBtn = sku => `<button class="sku-link" data-sku="${U.esc(sku)}">${U.esc(sku)}</button>`;

  /* ---------- filters ---------- */
  const SORTS = {
    short: ['Highest short payment', (a, b) => a.diff - b.diff],
    excess: ['Highest excess payment', (a, b) => b.diff - a.diff],
    absdiff: ['Highest difference (±)', (a, b) => Math.abs(b.diff) - Math.abs(a.diff)],
    expected: ['Highest expected settlement', (a, b) => b.expected - a.expected],
    actual: ['Highest actual settlement', (a, b) => b.actual - a.actual],
    sku: ['SKU (A–Z)', (a, b) => a.sku.localeCompare(b.sku)],
    status: ['Status', (a, b) => a.status.localeCompare(b.status) || a.diff - b.diff],
  };
  const FILTER_STATUSES = ['Reconciled', 'Short Payment', 'Excess Payment', 'Payment Not Received', 'Unmatched SKU', 'No Sales This Week'];

  function filterBar(container) {
    const f = App.state.filters;
    const num = (k, ph) => `<input type="number" step="any" data-f="${k}" placeholder="${ph}" value="${f[k] ?? ''}">`;
    container.innerHTML = `
      <label>SKU contains<input type="search" data-f="sku" value="${U.esc(f.sku)}" placeholder="e.g. HURRICANE"></label>
      <label>Status<div class="chips">${FILTER_STATUSES.map(s => `<button class="chip ${f.status.includes(s) ? 'on' : ''}" data-status="${s}"><span class="dot" style="background:${Charts.C.status[s] || '#838a93'}"></span>${s}</button>`).join('')}</div></label>
      <label>Difference ₹<div class="range">${num('dMin', 'min')}${num('dMax', 'max')}</div></label>
      <label>Expected ₹<div class="range">${num('eMin', 'min')}${num('eMax', 'max')}</div></label>
      <label>Actual ₹<div class="range">${num('aMin', 'min')}${num('aMax', 'max')}</div></label>
      <label>Sort by<select data-f="sort">${Object.entries(SORTS).map(([k, [l]]) => `<option value="${k}" ${f.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <button class="btn sm" data-reset>Clear filters</button>`;
  }

  function filtered() {
    const f = App.state.filters, r = App.state.result;
    if (!r) return [];
    const q = f.sku.trim().toUpperCase();
    const inR = (v, lo, hi) => (lo === '' || lo == null || v >= +lo) && (hi === '' || hi == null || v <= +hi);
    let rows = r.rows.filter(x =>
      (!q || x.sku.includes(q)) &&
      (f.status.length ? f.status.includes(x.status) : x.status !== S().NOSALE) &&
      inR(x.diff, f.dMin, f.dMax) && inR(x.expected, f.eMin, f.eMax) && inR(x.actual, f.aMin, f.aMax));
    const cmp = f.colSort ? colCompare(f.colSort) : SORTS[f.sort][1];
    return rows.sort(cmp);
  }
  function colCompare({ key, dir }) {
    return (a, b) => { const x = a[key], y = b[key]; const c = typeof x === 'string' ? x.localeCompare(y) : (x ?? -Infinity) - (y ?? -Infinity); return dir * c; };
  }
  const filtersActive = () => { const f = App.state.filters; return !!(f.sku || f.status.length || ['dMin', 'dMax', 'eMin', 'eMax', 'aMin', 'aMax'].some(k => f[k] !== '' && f[k] != null)); };

  /* ---------- dashboard ---------- */
  function dashboard() {
    const r = App.state.result;
    $('dashEmpty').hidden = !!r; $('dashBody').hidden = !r;
    if (!r) return;
    const s = r.summary, SS = S();
    const rows = filtered();
    const v = filtersActive() ? summarizeRows(rows) : s;
    const note = filtersActive() ? ' <span class="muted">(filtered)</span>' : '';

    $('answer').innerHTML = `<b>${U.money(v.totalExpected)}</b> was expected and <b>${U.money(v.totalActual)}</b> was received from Flipkart for <b>${App.state.week.label}</b>${note} — a net difference of <b class="${cls(v.net)}">${U.money(v.net, { plus: true })}</b>. `
      + `<b>${v.counts[SS.SHORT] + v.counts[SS.NR]}</b> SKU(s) are short or unpaid (<b class="neg">${U.money(v.recovery)}</b> to recover), <b>${v.counts[SS.EXCESS]}</b> were over-paid and <b>${v.counts[SS.UNM]}</b> payment(s) could not be matched to a SKU.`
      + (r.mode === 'rate' ? `<div class="muted" style="font-size:12px;margin-top:4px">Method: expected = per-unit rate × units sold (${U.int(s.units)} units in ${U.int(s.orders)} orders; ${U.int(s.returnedUnits)} returned units expected at ${r.settings.returns === 'zero' ? '₹0' : 'full rate'}). Change under Settings.</div>` : '');

    const kpi = (label, value, sub, color, status) => `<div class="kpi" style="--kc:${color || 'transparent'}" ${status ? `data-status="${status}" title="Click to view these SKUs"` : ''}><div class="k-label">${label}</div><div class="k-value">${value}</div>${sub ? `<div class="k-sub">${sub}</div>` : ''}</div>`;
    const st = Charts.C.status;
    $('kpis').innerHTML = [
      kpi('Total Expected Settlement', U.money(v.totalExpected), '', Charts.C.expected),
      kpi('Total Actual Settlement', U.money(v.totalActual), '', Charts.C.actual),
      kpi('Total Difference', `<span class="${cls(v.net)}">${U.money(v.net, { plus: true })}</span>`, 'Actual − Expected'),
      kpi('Reconciliation %', U.pct(v.reconPct), 'Actual ÷ Expected'),
      kpi('Total SKUs', U.int(v.activeSkus), `${U.pct(v.skuMatchPct, 0)} fully reconciled`),
      kpi('Reconciled SKUs', U.int(v.counts[SS.OK]), '', st[SS.OK], SS.OK),
      kpi('Short Payment SKUs', U.int(v.counts[SS.SHORT]), '', st[SS.SHORT], SS.SHORT),
      kpi('Excess Payment SKUs', U.int(v.counts[SS.EXCESS]), '', st[SS.EXCESS], SS.EXCESS),
      kpi('Missing Payment SKUs', U.int(v.counts[SS.NR]), 'Payment not received', st[SS.NR], SS.NR),
      kpi('Unmatched SKUs', U.int(v.counts[SS.UNM]), 'Paid but not in Expected', st[SS.UNM], SS.UNM),
    ].join('');
    $('fin').innerHTML = [
      kpi('Expected Settlement', U.money(v.totalExpected)),
      kpi('Actual Settlement', U.money(v.totalActual)),
      kpi('Total Short Payment', `<span class="neg">${U.money(v.shortTotal)}</span>`, 'Sum of negative differences'),
      kpi('Total Excess Payment', `<span class="pos">${U.money(v.excessTotal, { plus: true })}</span>`, 'Sum of positive differences'),
      kpi('Net Difference', `<span class="${cls(v.net)}">${U.money(v.net, { plus: true })}</span>`),
      kpi('Recovery Required', `<span class="neg">${U.money(v.recovery)}</span>`, 'Short + not received'),
    ].join('');

    filterBar($('dashFilters'));
    const open = sku => App.openSku(sku);
    Charts.totals('chTotals', v.totalExpected, v.totalActual);
    Charts.status('chStatus', v.counts, status => App.setStatusFilter(status, 'recon'));
    const shorts = rows.filter(x => x.diff < 0 && x.status !== SS.OK).sort((a, b) => a.diff - b.diff).slice(0, 10);
    const excess = rows.filter(x => x.diff > 0 && x.status !== SS.OK).sort((a, b) => b.diff - a.diff).slice(0, 10);
    Charts.topBars('chShort', shorts, st[SS.SHORT], open);
    Charts.topBars('chExcess', excess, st[SS.EXCESS], open);
    const bySku = [...rows].sort((a, b) => Math.max(b.expected, b.actual) - Math.max(a.expected, a.actual)).slice(0, 40);
    $('bySkuNote').textContent = rows.length > 40 ? `— top 40 of ${rows.length} SKUs by value; use filters to focus. Click a bar for details.` : '— click a bar for details';
    Charts.bySku('chBySku', bySku, open);
  }

  function summarizeRows(rows) {
    const SS = S();
    const v = { totalExpected: 0, totalActual: 0, shortTotal: 0, excessTotal: 0, recovery: 0, counts: {}, activeSkus: 0 };
    Object.values(SS).forEach(k => v.counts[k] = 0);
    for (const r of rows) {
      v.counts[r.status]++;
      if (r.status === SS.NOSALE) continue;
      v.activeSkus++; v.totalExpected += r.expected; v.totalActual += r.actual;
      if (r.status !== SS.OK) { if (r.diff < 0) v.shortTotal += r.diff; else v.excessTotal += r.diff; }
      if ((r.status === SS.SHORT || r.status === SS.NR) && r.diff < 0) v.recovery -= r.diff;
    }
    v.net = v.totalActual - v.totalExpected;
    v.reconPct = v.totalExpected ? v.totalActual / v.totalExpected * 100 : null;
    v.skuMatchPct = v.activeSkus ? v.counts[SS.OK] / v.activeSkus * 100 : null;
    return v;
  }

  /* ---------- tables ---------- */
  const COLS = [
    { key: 'sku', label: 'SKU' }, { key: 'expected', label: 'Expected', num: 1 }, { key: 'actual', label: 'Actual', num: 1 },
    { key: 'diff', label: 'Difference', num: 1 }, { key: 'diffPct', label: 'Difference %', num: 1 }, { key: 'status', label: 'Status' }, { key: 'action', label: 'Action' },
  ];
  const RATE_COLS = [{ key: 'rate', label: 'Rate/Unit', num: 1 }, { key: 'units', label: 'Units', num: 1 }, { key: 'returnedUnits', label: 'Returned', num: 1 }];

  function table(el, rows, { sortable = true, total = true, extra = false, limit = 1500 } = {}) {
    const cols = extra ? [COLS[0], ...RATE_COLS, ...COLS.slice(1)] : COLS;
    const cs = App.state.filters.colSort;
    const head = `<thead><tr>${cols.map(c => `<th class="${c.num ? 'num' : ''}" ${sortable ? `data-col="${c.key}"` : ''}>${c.label} ${cs && cs.key === c.key ? `<span class="arrow">${cs.dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`).join('')}</tr></thead>`;
    const big = App.state.result ? Math.max(1000, App.state.result.summary.totalExpected * 0.002) : 1000;
    const cell = (r, c) => {
      switch (c.key) {
        case 'sku': return `<td>${skuBtn(r.sku)}</td>`;
        case 'diff': return `<td class="num ${cls(r.diff)}">${U.money(r.diff, { plus: true })}</td>`;
        case 'diffPct': return `<td class="num ${cls(r.diff)}">${U.pct(r.diffPct)}</td>`;
        case 'status': return `<td>${badge(r.status)}</td>`;
        case 'action': return `<td class="action">${U.esc(r.action)}</td>`;
        case 'rate': return `<td class="num">${r.rate == null ? '—' : U.money(r.rate, { dec: true })}</td>`;
        case 'units': case 'returnedUnits': return `<td class="num">${r[c.key] ?? '—'}</td>`;
        default: return `<td class="num">${U.money(r[c.key])}</td>`;
      }
    };
    const shown = rows.slice(0, limit);
    const body = shown.map(r => `<tr class="${(r.status === S().SHORT || r.status === S().NR) && Math.abs(r.diff) >= big ? 'hl-crit' : ''}">${cols.map(c => cell(r, c)).join('')}</tr>`).join('')
      || `<tr><td colspan="${cols.length}" class="muted" style="text-align:center;padding:24px">No SKUs match the current filters.</td></tr>`;
    let foot = '';
    if (total && rows.length) {
      const e = rows.reduce((a, r) => a + r.expected, 0), a = rows.reduce((s, r) => s + r.actual, 0), d = a - e;
      foot = `<tfoot><tr>${cols.map(c => {
        switch (c.key) {
          case 'sku': return `<td>TOTAL · ${rows.length} SKUs${rows.length > limit ? ` (showing ${limit})` : ''}</td>`;
          case 'expected': return `<td class="num">${U.money(e)}</td>`;
          case 'actual': return `<td class="num">${U.money(a)}</td>`;
          case 'diff': return `<td class="num ${cls(d)}">${U.money(d, { plus: true })}</td>`;
          case 'diffPct': return `<td class="num ${cls(d)}">${e ? U.pct(d / Math.abs(e) * 100) : '—'}</td>`;
          default: return '<td></td>';
        }
      }).join('')}</tr></tfoot>`;
    }
    el.innerHTML = head + `<tbody>${body}</tbody>` + foot;
  }

  function recon() {
    const r = App.state.result;
    if (!r) { $('reconTable').innerHTML = ''; $('reconCount').textContent = 'Upload files first.'; $('reconFilters').hidden = true; return; }
    $('reconFilters').hidden = false;
    filterBar($('reconFilters'));
    const rows = filtered();
    $('reconCount').textContent = `${rows.length} SKU(s)` + (App.state.filters.status.length ? '' : ' — "No Sales This Week" hidden unless selected');
    table($('reconTable'), rows, { extra: r.mode === 'rate' });
  }

  function exceptionRows() {
    const r = App.state.result; if (!r) return [];
    return r.rows.filter(x => Recon.EXCEPTIONS.includes(x.status)).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  }

  function exceptions() {
    const r = App.state.result;
    const rows = exceptionRows();
    const SS = S();
    if (!r) { $('excKpis').innerHTML = ''; $('excTable').innerHTML = '<tr><td class="muted" style="padding:20px">Upload files first.</td></tr>'; $('potentialCard').hidden = true; return; }
    const sumDiff = st => rows.filter(x => x.status === st).reduce((a, x) => a + x.diff, 0);
    const k = (st) => `<div class="kpi" data-status="${st}" style="--kc:${Charts.C.status[st]}"><div class="k-label">${st}</div><div class="k-value">${r.summary.counts[st]}</div><div class="k-sub">${U.money(sumDiff(st), { plus: true })}</div></div>`;
    $('excKpis').innerHTML = [SS.SHORT, SS.NR, SS.EXCESS, SS.UNM].map(k).join('');
    const prev = App.state.filters.colSort; App.state.filters.colSort = null;
    table($('excTable'), rows, { sortable: false, extra: r.mode === 'rate' });
    App.state.filters.colSort = prev;
    $('potentialCard').hidden = !r.potential.length;
    if (r.potential.length) $('potentialTable').innerHTML = `<thead><tr><th>SKU in Actual (unmatched)</th><th>Similar SKU in Expected</th><th>Why flagged</th></tr></thead><tbody>${r.potential.map(p => `<tr><td>${skuBtn(p.a)}</td><td>${skuBtn(p.b)}</td><td class="muted">${U.esc(p.reason)}</td></tr>`).join('')}</tbody>`;
  }

  /* ---------- SKU analysis / drawer ---------- */
  function skuDetailHTML(sku) {
    const r = App.state.result;
    const row = r && r.rows.find(x => x.sku === sku);
    const hist = Store.weeks().length ? Store.skuHistory(sku) : [];
    if (!row && !hist.length) return `<div class="empty small">SKU <b>${U.esc(sku)}</b> was not found in this week's files or in saved history.</div>`;
    let h = `<div class="sku-title">${U.esc(sku)}</div>`;
    if (row) {
      h += `<div style="margin-bottom:12px">${badge(row.status)} <span class="action">· ${U.esc(row.action)}</span></div>
      <div class="kpis small" style="margin-bottom:16px">
        <div class="kpi"><div class="k-label">Expected (${U.esc(App.state.week.label)})</div><div class="k-value">${U.money(row.expected)}</div>${row.rate != null ? `<div class="k-sub">${U.money(row.rate, { dec: true })} × ${row.units} unit(s)</div>` : ''}</div>
        <div class="kpi"><div class="k-label">Actual</div><div class="k-value">${U.money(row.actual)}</div><div class="k-sub">${row.txnCount} transaction(s)${row.orderCount ? `, ${row.orderCount} order(s)` : ''}</div></div>
        <div class="kpi"><div class="k-label">Difference</div><div class="k-value ${cls(row.diff)}">${U.money(row.diff, { plus: true })}</div><div class="k-sub">${U.pct(row.diffPct)}</div></div>
        ${row.returnedUnits != null ? `<div class="kpi"><div class="k-label">Returned units</div><div class="k-value">${row.returnedUnits}</div><div class="k-sub">expected at ${r.settings.returns === 'zero' ? '₹0' : 'full rate'}</div></div>` : ''}
      </div>`;
      if (row.orders && row.orders.length) {
        const ords = [...row.orders].sort((a, b) => a.diff - b.diff);
        const lim = 300;
        h += `<div class="card"><div class="card-h">Order-level breakdown <span class="muted">— worst first${ords.length > lim ? ` (first ${lim} of ${ords.length})` : ''}</span></div><div class="table-wrap" style="max-height:340px"><table class="grid"><thead><tr><th>Order ID</th><th class="num">Qty</th><th>Returned</th><th class="num">Expected</th><th class="num">Actual</th><th class="num">Difference</th><th class="num">Txns</th></tr></thead><tbody>${ords.slice(0, lim).map(o => `<tr><td>${U.esc(o.orderId)}</td><td class="num">${o.qty}</td><td>${o.returned ? 'Yes' : 'No'}</td><td class="num">${U.money(o.expected)}</td><td class="num">${U.money(o.actual, { dec: true })}</td><td class="num ${cls(U.r2(o.diff))}">${U.money(o.diff, { plus: true, dec: true })}</td><td class="num">${o.rows}</td></tr>`).join('')}</tbody></table></div></div>`;
      }
    }
    h += `<div class="card"><div class="card-h">Weekly history</div>`;
    if (!hist.length) h += `<p class="muted">No saved weeks contain this SKU yet. Save this week to start its history.</p>`;
    else {
      const t = hist.reduce((a, x) => ({ e: a.e + x.expected, a: a.a + x.actual, d: a.d + x.diff, rec: a.rec + ((x.status === S().SHORT || x.status === S().NR) && x.diff < 0 ? -x.diff : 0) }), { e: 0, a: 0, d: 0, rec: 0 });
      h += `<div class="kpis small" style="margin-bottom:12px">
        <div class="kpi"><div class="k-label">Total Expected</div><div class="k-value">${U.money(t.e)}</div></div>
        <div class="kpi"><div class="k-label">Total Actual</div><div class="k-value">${U.money(t.a)}</div></div>
        <div class="kpi"><div class="k-label">Total Difference</div><div class="k-value ${cls(t.d)}">${U.money(t.d, { plus: true })}</div></div>
        <div class="kpi"><div class="k-label">Total Recovery Required</div><div class="k-value neg">${U.money(t.rec)}</div></div></div>
        <div class="chart-box short"><canvas id="chSkuHist"></canvas></div>
        <div class="table-wrap" style="margin-top:12px"><table class="grid"><thead><tr><th>Week</th><th>Date</th><th class="num">Expected</th><th class="num">Actual</th><th class="num">Difference</th><th>Status</th></tr></thead><tbody>${hist.map(x => `<tr><td>${U.esc(x.week)}</td><td>${U.fmtDate(x.date)}</td><td class="num">${U.money(x.expected)}</td><td class="num">${U.money(x.actual)}</td><td class="num ${cls(x.diff)}">${U.money(x.diff, { plus: true })}</td><td>${badge(x.status)}</td></tr>`).join('')}</tbody></table></div>`;
    }
    return h + `</div>`;
  }

  function sku(target, skuKey) {
    target.innerHTML = skuDetailHTML(skuKey);
    target.classList.remove('empty', 'small');
    const hist = Store.skuHistory(skuKey);
    if (hist.length) Charts.skuHistory('chSkuHist', hist);
  }

  function skuList() {
    const set = new Set();
    if (App.state.result) App.state.result.rows.forEach(r => set.add(r.sku));
    Store.weeks().forEach(w => w.rows.forEach(r => set.add(r.s)));
    $('skuList').innerHTML = [...set].sort().map(s => `<option value="${U.esc(s)}">`).join('');
  }

  /* ---------- history ---------- */
  function history() {
    const weeks = Store.weeks();
    $('histStoreNote').textContent = Store.mode() === 'shared'
      ? 'History is saved online with this dashboard link — everyone you share the link with sees the same weeks. A backup file is still a good idea.'
      : 'History is stored in this browser on this PC. Download a backup regularly; restore it on another PC or browser.';
    $('histEmpty').hidden = !!weeks.length; $('histBody').hidden = !weeks.length;
    if (!weeks.length) return;
    Charts.weekly(weeks);
    $('histTable').innerHTML = `<thead><tr><th>Week</th><th>Settlement date</th><th class="num">Expected</th><th class="num">Actual</th><th class="num">Difference</th><th class="num">Reconciliation %</th><th class="num">Short payment</th><th class="num">Recovery required</th><th class="num">Exceptions</th><th></th></tr></thead><tbody>${weeks.map(w => {
      const s = w.summary;
      return `<tr><td><b>${U.esc(w.label)}</b></td><td>${U.fmtDate(w.date)}</td><td class="num">${U.money(s.totalExpected)}</td><td class="num">${U.money(s.totalActual)}</td><td class="num ${cls(s.net)}">${U.money(s.net, { plus: true })}</td><td class="num">${U.pct(s.reconPct)}</td><td class="num neg">${U.money(s.shortTotal)}</td><td class="num neg">${U.money(s.recovery)}</td><td class="num">${s.exceptions}</td><td><button class="btn sm" data-delweek="${U.esc(w.id)}">Delete</button></td></tr>`;
    }).join('')}</tbody>`;
  }

  /* ---------- reports ---------- */
  function reports() {
    const r = App.state.result;
    $('btnRecovery').disabled = $('btnFull').disabled = !r;
    if (!r) { $('recoveryTable').innerHTML = '<tr><td class="muted" style="padding:20px">Upload files first.</td></tr>'; return; }
    const prev = App.state.filters.colSort; App.state.filters.colSort = null;
    table($('recoveryTable'), Export.recoveryRows(r), { sortable: false });
    App.state.filters.colSort = prev;
  }

  /* ---------- data quality ---------- */
  function quality() {
    const r = App.state.result, el = $('dqBody');
    if (!r) { el.className = 'empty small'; el.innerHTML = 'Upload files to run data-quality checks.'; return; }
    el.className = '';
    const checks = r.dq;
    const errs = checks.filter(c => c.severity !== 'info').length;
    const standard = [
      ['Duplicate SKUs', /^dup-/], ['Blank SKUs', /^blanksku|^blankfill/], ['Blank amounts', /^blankamt/], ['Text instead of numbers', /^textnum/],
      ['Negative amounts', /^neg-/], ['Invalid amounts', /^invalid/], ['Different SKU capitalisation', /^case-/], ['Extra spaces', /^space-/],
      ['SKU only in Expected file', /^onlyExp/], ['SKU only in Actual file', /^onlyAct/], ['Potential SKU matches', /^potential/],
    ];
    const tick = standard.map(([name, rx]) => {
      const hit = checks.filter(c => rx.test(c.id));
      const n = hit.reduce((a, c) => a + c.count, 0);
      const sev = hit.some(c => c.severity === 'error') ? 'error' : hit.some(c => c.severity === 'warning') ? 'warning' : hit.length ? 'info' : 'ok';
      return `<span class="chip"><span class="sev ${sev}" style="padding:1px 6px;border-radius:8px;font-size:10px">${sev === 'ok' ? 'OK' : n}</span>${name}</span>`;
    }).join('');
    el.innerHTML = `<div class="alert ${errs ? 'warn' : 'ok'}"><div><b>${errs ? `${errs} data-quality warning(s) need a look.` : 'No blocking data-quality problems found.'}</b> Nothing was ignored silently — every adjustment the app made is listed below.<br><span style="font-size:12px">Files: ${U.esc(r.files.expected)} (${r.counts.expectedRows} rows) · ${U.esc(r.files.actual)} (${r.counts.actualRows} rows)</span></div></div>
      <div class="chips" style="margin-bottom:14px">${tick}</div>
      <div class="dq-list">${checks.map((c, i) => `<div class="dq-item"><div class="dq-head" data-dq="${i}"><span class="sev ${c.severity}">${c.severity}</span><b>${U.esc(c.title)}</b><span class="muted">${U.esc(c.desc)}</span><span class="cnt">${U.int(c.count)}</span></div>${c.rows.length ? `<div class="dq-detail" hidden id="dq-${i}"><table><thead><tr><th>File</th><th>Excel row</th><th>SKU</th><th>Value</th><th>Note</th></tr></thead><tbody>${c.rows.map(x => `<tr><td>${U.esc(x.file)}</td><td>${x.row || ''}</td><td>${U.esc(x.sku)}</td><td>${U.esc(x.value)}</td><td>${U.esc(x.note || '')}</td></tr>`).join('')}</tbody></table>${c.count > c.rows.length ? `<div class="muted">Showing first ${c.rows.length} of ${c.count}. Full list in the Complete Reconciliation Report.</div>` : ''}</div>` : ''}</div>`).join('')}</div>`;
  }

  return { dashboard, recon, exceptions, exceptionRows, sku, skuList, history, reports, quality, filtered, SORTS };
})();
