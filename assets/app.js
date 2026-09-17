/* App controller: state, upload flow, column mapping, navigation, events. */
const App = (() => {
  const $ = id => document.getElementById(id);
  const blankFilters = () => ({ sku: '', status: [], dMin: '', dMax: '', eMin: '', eMax: '', aMin: '', aMax: '', sort: 'short', colSort: null });
  const state = { expected: null, actual: null, mapping: null, result: null, week: { label: '', date: '' }, filters: blankFilters(), settings: Store.loadSettings(), view: 'dashboard', lastSku: '' };

  const TITLES = { dashboard: 'Dashboard', upload: 'Upload Files', recon: 'Reconciliation', exceptions: 'Exceptions', sku: 'SKU Analysis', history: 'Weekly History', reports: 'Reports', quality: 'Data Quality', settings: 'Settings' };

  /* ---------- banner / errors ---------- */
  function banner(type, html) {
    $('banner').innerHTML = html ? `<div class="alert ${type}"><div>${html}</div><button class="x" aria-label="Dismiss">×</button></div>` : '';
  }

  /* ---------- navigation ---------- */
  function go(view) {
    state.view = view;
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    $('viewTitle').textContent = TITLES[view];
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    try {
      const v = state.view;
      if (v === 'dashboard') Views.dashboard();
      else if (v === 'recon') Views.recon();
      else if (v === 'exceptions') Views.exceptions();
      else if (v === 'sku') { Views.skuList(); if (state.lastSku) Views.sku($('skuDetail'), state.lastSku); }
      else if (v === 'history') Views.history();
      else if (v === 'reports') Views.reports();
      else if (v === 'quality') Views.quality();
      else if (v === 'settings') settingsForm();
      const r = state.result;
      $('navExc').textContent = r && r.summary.exceptions ? r.summary.exceptions : '';
      $('navDq').textContent = r ? (r.dq.filter(d => d.severity !== 'info').length || '') : '';
      $('btnSaveWeek').disabled = !r;
      $('sideWeek').innerHTML = r ? `<b>${U.esc(state.week.label)}</b><br>${U.esc(r.files.expected)}<br>${U.esc(r.files.actual)}` : 'No files loaded';
    } catch (e) {
      console.error(e);
      banner('error', `Something went wrong while showing this page: ${U.esc(e.message)}. Your data is safe — try reloading the page.`);
    }
  }

  /* ---------- upload ---------- */
  async function onFile(kind, file) {
    const drop = $(kind === 'expected' ? 'drop1' : 'drop2'), st = $(kind === 'expected' ? 'st1' : 'st2');
    const label = kind === 'expected' ? 'Expected Settlement' : 'Actual Flipkart Settlement';
    drop.classList.remove('ok', 'bad'); st.textContent = `Reading ${file.name}…`;
    try {
      const parsed = await Parse.load(file, kind);
      state[kind] = parsed;
      drop.classList.add('ok');
      st.textContent = `✓ ${file.name} — ${U.int(parsed.rows.length)} rows (sheet "${parsed.sheetName}")`;
      banner('', '');
      if (kind === 'actual' || !state.week.date) detectWeek();
      prepareMapping();
    } catch (e) {
      console.error(e);
      state[kind] = null; state.result = null;
      drop.classList.add('bad');
      st.textContent = '✗ ' + e.message;
      banner('error', `<b>${label} file needs correction:</b> ${U.esc(e.message)}`);
      render();
    }
  }

  function detectWeek() {
    const d = U.dateFromName(state.actual?.fileName) || U.dateFromName(state.expected?.fileName) || new Date();
    state.week = { date: U.isoDate(d), label: U.weekLabelFor(d) };
    $('weekLabel').value = state.week.label; $('weekDate').value = state.week.date;
    $('weekCard').hidden = false;
  }

  function defaultMapping() {
    const m = {};
    for (const kind of ['expected', 'actual']) {
      const p = state[kind]; if (!p) continue;
      const d = p.detected;
      m[kind] = { sku: d.sku?.index ?? null, amount: d.amount?.index ?? null, order: d.order?.index ?? null, qty: d.qty?.index ?? null, returnType: d.returnType?.index ?? null };
    }
    return m;
  }

  function prepareMapping() {
    if (!state.expected || !state.actual) { $('mappingCard').hidden = true; render(); return; }
    state.mapping = defaultMapping();
    renderMapping();
    const e = state.expected.detected, a = state.actual.detected;
    const confident = [e.sku, e.amount, a.sku, a.amount].every(x => x && x.confidence === 'high');
    if (confident) {
      runRecon(true);
    } else {
      $('mappingCard').hidden = false;
      const missing = [];
      if (!e.sku) missing.push('SKU column in the Expected file'); if (!e.amount) missing.push('Expected Amount column');
      if (!a.sku) missing.push('SKU column in the Actual file'); if (!a.amount) missing.push('Actual Amount column');
      banner('warn', missing.length ? `<b>Please select the columns:</b> could not find the ${missing.join(', ')}. Pick them below and click <b>Apply mapping</b>.` : `<b>Please confirm the columns below.</b> The app is not fully sure which columns hold the SKU and amount. Check them and click <b>Apply mapping</b>.`);
      $('mappingCard').scrollIntoView({ behavior: 'smooth' });
      render();
    }
  }

  function renderMapping() {
    const block = (kind) => {
      const p = state[kind], m = state.mapping[kind], d = p.detected;
      const opts = (sel, optional) => (optional ? `<option value="">— none —</option>` : `<option value="">— select —</option>`) + p.headers.map((h, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${U.esc(h)}  (e.g. ${U.esc(String(p.rows[0]?.cells[i] ?? '').slice(0, 24))})</option>`).join('');
      const conf = x => !x ? '<span class="conf low">not found</span>' : x.confidence === 'high' ? '<span class="conf hi">auto-detected</span>' : '<span class="conf low">please confirm</span>';
      const sel = (role, label, optional) => `<label>${label} ${optional ? '<span class="conf muted">optional</span>' : conf(d[role])}<select data-map="${kind}.${role}">${opts(m[role], optional)}</select></label>`;
      return `<div class="map-file">${kind === 'expected' ? 'Expected Settlement' : 'Actual Settlement'} — ${U.esc(p.fileName)}</div>
        <div class="map-grid">
          ${p.sheetNames.length > 1 ? `<label>Sheet<select data-sheet="${kind}">${p.sheetNames.map(n => `<option ${n === p.sheetName ? 'selected' : ''}>${U.esc(n)}</option>`).join('')}</select></label>` : ''}
          ${sel('sku', 'SKU Column')}
          ${sel('amount', kind === 'expected' ? 'Expected Amount Column' : 'Actual Amount Column')}
          ${kind === 'actual' ? sel('order', 'Order ID Column', true) + sel('qty', 'Quantity Column', true) + sel('returnType', 'Return Type Column', true) : ''}
        </div>`;
    };
    $('mapping').innerHTML = block('expected') + block('actual');
  }

  function runRecon(auto) {
    const m = state.mapping;
    const miss = [];
    if (m.expected.sku == null) miss.push('Expected file → SKU Column');
    if (m.expected.amount == null) miss.push('Expected file → Expected Amount Column');
    if (m.actual.sku == null) miss.push('Actual file → SKU Column');
    if (m.actual.amount == null) miss.push('Actual file → Actual Amount Column');
    if (miss.length) { banner('error', `<b>Missing column selection:</b> ${miss.join('; ')}.`); $('mappingCard').hidden = false; return; }
    if (m.expected.sku === m.expected.amount || m.actual.sku === m.actual.amount) { banner('error', 'The SKU column and the amount column cannot be the same column.'); return; }
    try {
      state.result = Recon.run(state.expected, state.actual, m, state.settings);
      state.filters = blankFilters();
      state.lastSku = '';
      const s = state.result.summary;
      const existing = Store.findWeek(state.week.label, state.week.date);
      banner(existing ? 'warn' : 'ok', `<b>Reconciliation complete${auto ? ' (columns auto-detected)' : ''}.</b> ${s.activeSkus} SKUs · Expected ${U.money(s.totalExpected)} · Actual ${U.money(s.totalActual)} · Difference ${U.money(s.net, { plus: true })}. `
        + (existing ? `A saved week "${U.esc(existing.label)}" already exists — saving will replace it.` : `Click <b>Save this week</b> to add it to Weekly History.`)
        + ` <a href="#" data-goto="upload">Review column mapping</a>`);
      go('dashboard');
    } catch (e) {
      console.error(e);
      state.result = null;
      banner('error', `<b>Could not reconcile:</b> ${U.esc(e.message)}`);
      $('mappingCard').hidden = false;
      render();
    }
  }

  /* ---------- save week ---------- */
  async function saveWeek() {
    if (!state.result) return;
    const label = $('weekLabel').value.trim() || state.week.label, date = $('weekDate').value || state.week.date;
    if (!label || !date) { go('upload'); banner('error', 'Please enter the settlement week label and date before saving.'); return; }
    state.week = { label, date };
    const ex = Store.findWeek(label, date);
    if (ex && !confirm(`Week "${ex.label}" (${ex.date}) is already saved.\n\nReplace it with this upload?`)) return;
    $('btnSaveWeek').disabled = true;
    const res = await Store.saveWeek(label, date, state.result);
    $('btnSaveWeek').disabled = false;
    if (!res.ok) { banner('error', `Could not save this week: ${U.esc(res.message)}`); return; }
    U.toast(res.replaced ? `Week ${label} updated in history` : `Week ${label} saved to history`);
    banner('ok', `<b>${U.esc(label)}</b> saved to Weekly History${Store.mode() === 'shared' ? ' (shared with everyone who opens this link)' : ' in this browser — download a backup occasionally'}.`);
    render();
  }

  /* ---------- settings ---------- */
  function settingsForm() {
    const s = state.settings;
    $('settingsForm').innerHTML = `
      <label>Rounding tolerance (₹)<input type="number" min="0" step="0.5" data-set="tolerance" value="${s.tolerance}"><span class="help">Differences up to this amount count as Reconciled. Default ₹1.</span></label>
      <label>Additional tolerance (% of expected)<input type="number" min="0" step="0.1" data-set="tolerancePct" value="${s.tolerancePct}"><span class="help">Optional. The larger of ₹ and % tolerance is used. 0 = off.</span></label>
      <label>What does the Expected file contain?<select data-set="mode">
        <option value="auto" ${s.mode === 'auto' ? 'selected' : ''}>Detect automatically</option>
        <option value="rate" ${s.mode === 'rate' ? 'selected' : ''}>Per-unit settlement rate (Expected = rate × units sold)</option>
        <option value="total" ${s.mode === 'total' ? 'selected' : ''}>Total expected amount per SKU</option></select>
        <span class="help">Auto picks "per-unit rate" when the Actual file is order-level (Order ID + many rows per SKU).${state.result ? ` Current upload: <b>${state.result.mode === 'rate' ? 'per-unit rate' : 'total per SKU'}</b>.` : ''}</span></label>
      <label>Returned orders (per-unit rate mode)<select data-set="returns">
        <option value="zero" ${s.returns === 'zero' ? 'selected' : ''}>Expect ₹0 for returned orders</option>
        <option value="full" ${s.returns === 'full' ? 'selected' : ''}>Expect full rate even if returned</option></select>
        <span class="help">An order counts as returned when the Return Type column is filled (not "NA").</span></label>
      <label>Duplicate SKUs in Expected file<select data-set="dupAgg">
        ${[['auto', 'Automatic (sum for totals, first value for rates)'], ['sum', 'Sum'], ['first', 'Use first row'], ['max', 'Use highest'], ['avg', 'Average']].map(([v, l]) => `<option value="${v}" ${s.dupAgg === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <span class="help">Actual file rows are always summed per SKU.</span></label>`;
  }

  /* ---------- SKU drawer ---------- */
  function openSku(sku) {
    state.lastSku = sku;
    $('drawer').hidden = false;
    Views.sku($('drawerBody'), sku);
  }

  function setStatusFilter(status, view) {
    state.filters = { ...blankFilters(), status: [status], sort: status === Recon.S.EXCESS || status === Recon.S.UNM ? 'excess' : 'short' };
    go(view || state.view);
  }

  /* ---------- events ---------- */
  function bind() {
    document.addEventListener('click', e => {
      const t = e.target.closest('[data-view],[data-goto],[data-sku],[data-status],[data-reset],[data-col],[data-dq],[data-delweek],.alert .x');
      if (!t) return;
      if (t.matches('.alert .x')) { banner('', ''); return; }
      if (t.dataset.view) return go(t.dataset.view);
      if (t.dataset.goto) { e.preventDefault(); return go(t.dataset.goto); }
      if (t.dataset.sku) return openSku(t.dataset.sku);
      if (t.dataset.reset != null) { state.filters = blankFilters(); return render(); }
      if (t.dataset.col) {
        const k = t.dataset.col, cs = state.filters.colSort;
        state.filters.colSort = { key: k, dir: cs && cs.key === k ? -cs.dir : (k === 'sku' || k === 'status' || k === 'action' ? 1 : -1) };
        return render();
      }
      if (t.dataset.dq) { const d = $('dq-' + t.dataset.dq); if (d) d.hidden = !d.hidden; return; }
      if (t.dataset.delweek) {
        if (confirm('Remove this week from history? (Download a backup first if unsure.)')) Store.deleteWeek(t.dataset.delweek).then(render, err => banner('error', `Could not delete: ${U.esc(err.message)}`));
        return;
      }
      if (t.dataset.status) {
        if (t.classList.contains('chip')) {
          const f = state.filters, st = t.dataset.status;
          f.status = f.status.includes(st) ? f.status.filter(x => x !== st) : [...f.status, st];
          return render();
        }
        return setStatusFilter(t.dataset.status, 'recon');
      }
    });

    const onFilterInput = U.debounce(el => {
      state.filters[el.dataset.f] = el.value;
      if (el.dataset.f === 'sort') state.filters.colSort = null;
      const pos = el.selectionStart, key = el.dataset.f, parentId = el.closest('.filters').id;
      render();
      const again = document.querySelector(`#${parentId} [data-f="${key}"]`);
      if (again && el.type !== 'number' && el.tagName === 'INPUT') { again.focus(); try { again.setSelectionRange(pos, pos); } catch { } }
      else if (again && el.type === 'number') { again.focus(); }
    }, 350);
    document.addEventListener('input', e => {
      const el = e.target;
      if (el.dataset.f) onFilterInput(el);
      if (el.dataset.set) {
        state.settings[el.dataset.set] = el.type === 'number' ? Math.max(0, +el.value || 0) : el.value;
        Store.saveSettings(state.settings);
        if (state.result && state.expected && state.actual) {
          try { state.result = Recon.run(state.expected, state.actual, state.mapping, state.settings); U.toast('Settings applied — reconciliation recalculated'); render(); }
          catch (err) { banner('error', U.esc(err.message)); }
        }
      }
    });
    document.addEventListener('change', e => {
      const el = e.target;
      if (el.dataset.map) { const [k, role] = el.dataset.map.split('.'); state.mapping[k][role] = el.value === '' ? null : +el.value; }
      if (el.dataset.sheet) { Parse.useSheet(state[el.dataset.sheet], el.value); prepareMapping(); $('mappingCard').hidden = false; }
    });

    // uploads
    [['fileExpected', 'expected', 'drop1'], ['fileActual', 'actual', 'drop2']].forEach(([inp, kind, drop]) => {
      $(inp).addEventListener('change', e => { const f = e.target.files[0]; if (f) onFile(kind, f); e.target.value = ''; });
      const d = $(drop);
      d.addEventListener('dragover', e => { e.preventDefault(); d.classList.add('over'); });
      d.addEventListener('dragleave', () => d.classList.remove('over'));
      d.addEventListener('drop', e => { e.preventDefault(); d.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) onFile(kind, f); });
    });
    $('btnApplyMap').onclick = () => runRecon(false);
    $('weekLabel').oninput = e => state.week.label = e.target.value.trim();
    $('weekDate').onchange = e => { state.week.date = e.target.value; if (e.target.value) { const [y, m, d] = e.target.value.split('-').map(Number); const lbl = U.weekLabelFor(new Date(y, m - 1, d)); $('weekLabel').value = lbl; state.week.label = lbl; } };
    $('btnSaveWeek').onclick = saveWeek;

    // search
    const qs = $('quickSearch');
    const findSku = q => {
      const key = U.cleanSku(q); if (!key) return null;
      const all = state.result ? state.result.rows.map(r => r.sku) : [];
      Store.weeks().forEach(w => w.rows.forEach(r => all.push(r.s)));
      return all.find(s => s === key) || null;
    };
    qs.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const exact = findSku(qs.value);
      if (exact) return openSku(exact);
      state.filters = { ...blankFilters(), sku: qs.value.trim() };
      go('recon');
    });
    qs.addEventListener('input', U.debounce(() => { const exact = findSku(qs.value); if (exact) openSku(exact); }, 500));
    $('skuPick').addEventListener('change', e => { const exact = findSku(e.target.value); if (exact) { state.lastSku = exact; Views.sku($('skuDetail'), exact); } else if (e.target.value) $('skuDetail').innerHTML = `<div class="empty small">SKU "${U.esc(e.target.value)}" not found.</div>`; });

    // drawer
    $('drawerClose').onclick = () => $('drawer').hidden = true;
    $('drawer').addEventListener('click', e => { if (e.target.id === 'drawer') $('drawer').hidden = true; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') $('drawer').hidden = true; });

    // exports
    const fail = e => { console.error(e); banner('error', `Download failed: ${U.esc(e.message)}`); };
    const guard = fn => async () => { try { if (typeof XLSX === 'undefined') throw new Error('Excel library not loaded'); await fn(); } catch (e) { fail(e); } };
    $('btnRecovery').onclick = guard(() => Export.recovery(state.result, state.week));
    $('btnFull').onclick = guard(() => Export.full(state.result, state.week));
    $('btnHistRpt').onclick = guard(() => { const w = Store.weeks(); if (!w.length) throw new Error('no weeks saved yet'); return Export.history(w); });
    $('btnExportFiltered').onclick = guard(() => Export.rows(Views.filtered(), 'Flipkart Reconciliation filtered'));
    $('btnExportExc').onclick = guard(() => Export.rows(Views.exceptionRows(), 'Flipkart Exceptions'));
    $('btnBackup').onclick = () => {
      const filename = `flipkart-recon-backup-${U.isoDate(new Date())}.json`, text = Store.backup();
      Export.saveFile(filename, () => text, () => {
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = filename; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      }).catch(fail);
    };
    $('fileRestore').addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      f.text().then(t => Store.restore(t)).then(r => { U.toast(`Restored: ${r.added} new, ${r.replaced} replaced week(s)`); render(); })
        .catch(err => banner('error', `Restore failed: ${U.esc(err.message)}`));
      e.target.value = '';
    });
  }

  function init() {
    bind();
    if (typeof XLSX === 'undefined' || typeof Chart === 'undefined') {
      banner('error', '<b>Required libraries did not load.</b> This page needs an internet connection the first time it opens (to load the Excel reader and charts). Connect and reload.');
    }
    window.addEventListener('error', e => banner('error', `Unexpected error: ${U.esc(e.message)}. Nothing was lost — reload if the page stops responding.`));
    render();
    Store.connect(render);
  }

  document.addEventListener('DOMContentLoaded', init);
  return { state, go, render, openSku, setStatusFilter };
})();
