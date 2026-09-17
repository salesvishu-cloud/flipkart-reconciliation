/* Chart.js wrappers. Colours follow the entity, never its rank. */
const Charts = (() => {
  const C = {
    expected: '#2a78d6', actual: '#eb6834',
    grid: '#e1e0d9', axis: '#898781', ink: '#52514e',
    status: { 'Reconciled': '#0ca30c', 'Short Payment': '#d03b3b', 'Excess Payment': '#2a78d6', 'Payment Not Received': '#ec835a', 'Unmatched SKU': '#4a3aa7' },
  };
  const inst = {};

  function ready() { return typeof Chart !== 'undefined'; }
  if (ready()) {
    Chart.defaults.font.family = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
    Chart.defaults.font.size = 12;
    Chart.defaults.color = C.ink;
    Chart.defaults.plugins.tooltip.backgroundColor = '#1f2937';
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 6;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.pointStyle = 'rectRounded';
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.animation.duration = 250;
  }

  function draw(id, config) {
    if (!ready()) return;
    const el = document.getElementById(id);
    if (!el) return;
    if (inst[id]) inst[id].destroy();
    inst[id] = new Chart(el, config);
  }

  const moneyAxis = (horizontal) => ({
    grid: { color: C.grid, drawTicks: false }, border: { display: false },
    ticks: { color: C.axis, padding: 6, callback: v => U.moneyShort(v) },
    ...(horizontal ? {} : { beginAtZero: true }),
  });
  const catAxis = (maxLen = 22) => ({
    grid: { display: false }, border: { color: '#c3c2b7' },
    ticks: { color: C.ink, autoSkip: false, callback(v) { const l = this.getLabelForValue(v); return l.length > maxLen ? l.slice(0, maxLen - 1) + '…' : l; } },
  });
  const moneyTip = { callbacks: { label: c => ` ${c.dataset.label || c.label}: ${U.money(c.parsed.y ?? c.parsed.x ?? c.parsed)}` } };

  function totals(id, exp, act) {
    draw(id, {
      type: 'bar',
      data: { labels: ['Settlement'], datasets: [
        { label: 'Expected', data: [exp], backgroundColor: C.expected, borderRadius: 4, maxBarThickness: 90 },
        { label: 'Actual', data: [act], backgroundColor: C.actual, borderRadius: 4, maxBarThickness: 90 },
      ] },
      options: { plugins: { tooltip: moneyTip, legend: { position: 'top', align: 'start' } }, scales: { y: moneyAxis(), x: { grid: { display: false }, ticks: { display: false }, border: { color: '#c3c2b7' } } }, datasets: { bar: { categoryPercentage: 0.7, barPercentage: 0.9 } } },
    });
  }

  function status(id, counts, onClick) {
    const labels = Object.keys(C.status).filter(k => counts[k] > 0);
    const total = labels.reduce((a, k) => a + counts[k], 0);
    draw(id, {
      type: 'doughnut',
      data: { labels, datasets: [{ data: labels.map(k => counts[k]), backgroundColor: labels.map(k => C.status[k]), borderColor: '#fff', borderWidth: 2, hoverOffset: 6 }] },
      options: {
        cutout: '62%',
        plugins: {
          legend: { position: 'right', labels: { generateLabels: ch => labels.map((k, i) => ({ text: `${k}  ${counts[k]} (${(counts[k] / total * 100).toFixed(0)}%)`, fillStyle: C.status[k], strokeStyle: C.status[k], index: i, pointStyle: 'rectRounded' })) } },
          tooltip: { callbacks: { label: c => ` ${c.label}: ${c.parsed} SKUs (${(c.parsed / total * 100).toFixed(1)}%)` } },
        },
        onClick: (e, els) => {},
      },
    });
    const ch = inst[id];
    if (ch && onClick) ch.canvas.onclick = evt => {
      const pts = ch.getElementsAtEventForMode(evt, 'nearest', { intersect: true }, true);
      if (pts.length) onClick(labels[pts[0].index]);
    };
  }

  function topBars(id, rows, color, onClick) {
    draw(id, {
      type: 'bar',
      data: { labels: rows.map(r => r.sku), datasets: [{ label: 'Difference', data: rows.map(r => r.diff), backgroundColor: color, borderRadius: 4, maxBarThickness: 20 }] },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` Difference: ${U.money(c.parsed.x, { plus: true })}`, afterLabel: c => { const r = rows[c.dataIndex]; return ` Expected ${U.money(r.expected)} · Actual ${U.money(r.actual)}`; } } } },
        scales: { x: moneyAxis(true), y: catAxis(26) },
      },
    });
    bindClick(id, i => onClick && rows[i] && onClick(rows[i].sku));
    if (!rows.length) emptyNote(id, 'None — nothing to show');
  }

  function bySku(id, rows, onClick) {
    draw(id, {
      type: 'bar',
      data: { labels: rows.map(r => r.sku), datasets: [
        { label: 'Expected', data: rows.map(r => r.expected), backgroundColor: C.expected, borderRadius: 3, maxBarThickness: 16 },
        { label: 'Actual', data: rows.map(r => r.actual), backgroundColor: C.actual, borderRadius: 3, maxBarThickness: 16 },
      ] },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'top', align: 'start' }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${U.money(c.parsed.y)}`, footer: items => { const r = rows[items[0].dataIndex]; return `Difference: ${U.money(r.diff, { plus: true })} · ${r.status}`; } } } },
        scales: { y: moneyAxis(), x: { ...catAxis(14), ticks: { ...catAxis(14).ticks, maxRotation: 60, minRotation: 45 } } },
      },
    });
    bindClick(id, i => onClick && rows[i] && onClick(rows[i].sku), 'index');
  }

  function weekly(weeks) {
    const labels = weeks.map(w => w.label);
    const line = (label, data, color, fmt) => ({ label, data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: 0.2, fmt });
    const tip = fmt => ({ callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.parsed.y)}` } });
    draw('chWeekAmt', { type: 'bar', data: { labels, datasets: [
      { label: 'Expected', data: weeks.map(w => w.summary.totalExpected), backgroundColor: C.expected, borderRadius: 4, maxBarThickness: 36 },
      { label: 'Actual', data: weeks.map(w => w.summary.totalActual), backgroundColor: C.actual, borderRadius: 4, maxBarThickness: 36 },
    ] }, options: { interaction: { mode: 'index', intersect: false }, plugins: { tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${U.money(c.parsed.y)}` } }, legend: { align: 'start' } }, scales: { y: moneyAxis(), x: { grid: { display: false } } } } });
    draw('chWeekPct', { type: 'line', data: { labels, datasets: [line('Reconciliation %', weeks.map(w => w.summary.reconPct == null ? null : U.r2(w.summary.reconPct)), C.expected)] }, options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false }, tooltip: tip(v => v.toFixed(2) + '%') }, scales: { y: { grid: { color: C.grid }, border: { display: false }, ticks: { callback: v => v + '%', color: C.axis } }, x: { grid: { display: false } } } } });
    draw('chWeekShort', { type: 'bar', data: { labels, datasets: [{ label: 'Short payment', data: weeks.map(w => -w.summary.shortTotal), backgroundColor: C.status['Short Payment'], borderRadius: 4, maxBarThickness: 36 }] }, options: { plugins: { legend: { display: false }, tooltip: tip(v => U.money(v)) }, scales: { y: moneyAxis(), x: { grid: { display: false } } } } });
    draw('chWeekExc', { type: 'bar', data: { labels, datasets: [{ label: 'Exceptions', data: weeks.map(w => w.summary.exceptions), backgroundColor: C.status['Payment Not Received'], borderRadius: 4, maxBarThickness: 36 }] }, options: { plugins: { legend: { display: false }, tooltip: tip(v => v + ' SKUs') }, scales: { y: { beginAtZero: true, grid: { color: C.grid }, border: { display: false }, ticks: { precision: 0, color: C.axis } }, x: { grid: { display: false } } } } });
  }

  function skuHistory(id, hist) {
    draw(id, { type: 'bar', data: { labels: hist.map(h => h.week), datasets: [
      { label: 'Expected', data: hist.map(h => h.expected), backgroundColor: C.expected, borderRadius: 4, maxBarThickness: 30 },
      { label: 'Actual', data: hist.map(h => h.actual), backgroundColor: C.actual, borderRadius: 4, maxBarThickness: 30 },
    ] }, options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { align: 'start' }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${U.money(c.parsed.y)}` } } }, scales: { y: moneyAxis(), x: { grid: { display: false } } } } });
  }

  function bindClick(id, fn, mode = 'nearest') {
    const ch = inst[id]; if (!ch) return;
    ch.canvas.style.cursor = 'pointer';
    ch.canvas.onclick = evt => {
      const pts = ch.getElementsAtEventForMode(evt, mode, { intersect: mode === 'nearest' }, true);
      if (pts.length) fn(pts[0].index);
    };
  }
  function emptyNote(id, text) {
    const ch = inst[id]; if (!ch) return;
    const ctx = ch.ctx; ctx.save(); ctx.fillStyle = C.axis; ctx.textAlign = 'center'; ctx.font = '13px system-ui';
    ctx.fillText(text, ch.width / 2, ch.height / 2); ctx.restore();
  }

  return { C, ready, totals, status, topBars, bySku, weekly, skuHistory };
})();
