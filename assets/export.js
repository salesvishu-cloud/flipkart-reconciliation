/* Excel exports (SheetJS). */
const Export = (() => {
  const r2 = U.r2;

  function sheet(aoa, widths) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    if (widths) ws['!cols'] = widths.map(w => ({ wch: w }));
    return ws;
  }
  function stamp() { return U.isoDate(new Date()); }
  function save(wb, name) {
    const filename = name.replace(/[\\/:*?"<>|]/g, '_');
    return saveFile(filename, () => XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), () => XLSX.writeFile(wb, filename));
  }

  /** Published page: ask the viewer via the downloads capability. Local file: normal browser download. */
  async function saveFile(filename, makeData, localSave) {
    const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
    if (!dl) { localSave(); return; }
    try {
      await dl.save({ filename, data: makeData() });
      U.toast(`Saved ${filename}`);
    } catch (e) {
      if (e && e.code === 'declined') return;
      if (e && e.code === 'rate_limited') { U.toast('A save prompt is already open — finish it first.'); return; }
      throw new Error(e && e.message ? e.message : 'Downloads are not available here.');
    }
  }

  const HEAD = ['SKU', 'Expected Settlement', 'Actual Settlement', 'Difference', 'Difference %', 'Status'];
  const rowOut = r => [r.sku, r.expected, r.actual, r.diff, r.diffPct == null ? '' : r.diffPct, r.status];
  function totalRow(rows, label = 'TOTAL') {
    const e = r2(rows.reduce((a, r) => a + r.expected, 0)), a = r2(rows.reduce((s, r) => s + r.actual, 0));
    return [label, e, a, r2(a - e), e ? r2((a - e) / Math.abs(e) * 100) : '', `${rows.length} SKUs`];
  }

  function recoveryRows(result) {
    return result.rows.filter(r => Recon.RECOVERY.includes(r.status)).sort((a, b) => a.diff - b.diff);
  }

  function recovery(result, week) {
    const rows = recoveryRows(result);
    const wb = XLSX.utils.book_new();
    const recov = rows.filter(r => r.status !== Recon.S.UNM);
    const aoa = [
      ['Flipkart Payment Recovery Report — OakCraft Furniture'],
      [`Settlement week: ${week.label}  (${week.date})`, '', '', `Generated: ${stamp()}`],
      [`Recovery required (Short + Not Received): ₹${U.int(Math.round(-recov.reduce((a, r) => a + Math.min(r.diff, 0), 0)))}`],
      [],
      HEAD,
      ...rows.map(rowOut),
      totalRow(rows),
    ];
    const ws = sheet(aoa, [40, 20, 20, 16, 14, 24]);
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
    XLSX.utils.book_append_sheet(wb, ws, 'Recovery Report');
    if (result.mode === 'rate') {
      const od = [['SKU', 'Order ID', 'Qty', 'Returned', 'Expected', 'Actual', 'Difference', 'Transactions']];
      for (const r of rows) for (const o of r.orders || []) if (Math.abs(o.diff) > result.settings.tolerance) od.push([r.sku, o.orderId, o.qty, o.returned ? 'Yes' : 'No', r2(o.expected), r2(o.actual), r2(o.diff), o.rows]);
      XLSX.utils.book_append_sheet(wb, sheet(od, [36, 24, 6, 9, 14, 14, 14, 12]), 'Order Detail');
    }
    save(wb, `Flipkart Payment Recovery Report ${week.label}.xlsx`);
  }

  function full(result, week) {
    const s = result.summary, S = Recon.S;
    const wb = XLSX.utils.book_new();
    const sum = [
      ['Flipkart Payment Reconciliation — OakCraft Furniture'],
      ['Settlement week', week.label], ['Settlement date', week.date], ['Generated', stamp()],
      ['Expected file', result.files.expected], ['Actual file', result.files.actual],
      ['Comparison method', result.mode === 'rate' ? 'Expected = per-unit rate × units sold (returned orders expected ₹0)' : 'Expected = total amount per SKU'],
      ['Tolerance (₹)', result.settings.tolerance],
      [],
      ['Total Expected Settlement', s.totalExpected], ['Total Actual Settlement', s.totalActual],
      ['Net Difference', s.net], ['Reconciliation %', s.reconPct == null ? '' : r2(s.reconPct)],
      ['Total Short Payment', s.shortTotal], ['Total Excess Payment', s.excessTotal], ['Recovery Required', s.recovery],
      [],
      ['Total SKUs (active)', s.activeSkus],
      ...[S.OK, S.SHORT, S.EXCESS, S.NR, S.UNM, S.NOSALE].map(k => [k, s.counts[k]]),
    ];
    XLSX.utils.book_append_sheet(wb, sheet(sum, [34, 60]), 'Summary');

    const extra = result.mode === 'rate' ? ['Rate / Unit', 'Units Sold', 'Returned Units', 'Orders'] : [];
    const all = [[...HEAD, 'Action', ...extra]];
    const sorted = [...result.rows].sort((a, b) => a.diff - b.diff);
    for (const r of sorted) all.push([...rowOut(r), r.action, ...(result.mode === 'rate' ? [r.rate ?? '', r.units ?? '', r.returnedUnits ?? '', r.orderCount] : [])]);
    all.push(totalRow(sorted));
    XLSX.utils.book_append_sheet(wb, sheet(all, [40, 18, 18, 14, 12, 22, 22, 12, 11, 14, 8]), 'Reconciliation');

    const exc = [...result.rows].filter(r => Recon.EXCEPTIONS.includes(r.status)).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    XLSX.utils.book_append_sheet(wb, sheet([[...HEAD, 'Action'], ...exc.map(r => [...rowOut(r), r.action]), totalRow(exc)], [40, 18, 18, 14, 12, 22, 22]), 'Exceptions');

    const rec = recoveryRows(result);
    XLSX.utils.book_append_sheet(wb, sheet([HEAD, ...rec.map(rowOut), totalRow(rec)], [40, 18, 18, 14, 12, 22]), 'Recovery Report');

    const dq = [['Severity', 'Check', 'Count', 'File', 'Excel Row', 'SKU', 'Value', 'Note']];
    for (const it of result.dq) {
      if (!it.rows.length) dq.push([it.severity, it.title, it.count]);
      for (const r of it.rows) dq.push([it.severity, it.title, it.count, r.file || '', r.row || '', r.sku || '', r.value ?? '', r.note || '']);
    }
    XLSX.utils.book_append_sheet(wb, sheet(dq, [9, 50, 7, 9, 9, 40, 18, 30]), 'Data Quality');

    if (result.potential.length) XLSX.utils.book_append_sheet(wb, sheet([['Actual SKU', 'Expected SKU', 'Reason'], ...result.potential.map(p => [p.a, p.b, p.reason])], [40, 40, 50]), 'Potential Matches');

    if (result.mode === 'rate') {
      const od = [['SKU', 'Order ID', 'Qty', 'Returned', 'Expected', 'Actual', 'Difference', 'Transactions', 'SKU Status']];
      for (const r of sorted) for (const o of r.orders || []) od.push([r.sku, o.orderId, o.qty, o.returned ? 'Yes' : 'No', r2(o.expected), r2(o.actual), r2(o.diff), o.rows, r.status]);
      XLSX.utils.book_append_sheet(wb, sheet(od, [36, 24, 6, 9, 14, 14, 14, 12, 22]), 'Order Detail');
    }
    save(wb, `Flipkart Reconciliation Full ${week.label}.xlsx`);
  }

  function rows(list, name) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet([[...HEAD, 'Action'], ...list.map(r => [...rowOut(r), r.action]), totalRow(list)], [40, 18, 18, 14, 12, 22, 22]), 'Data');
    save(wb, `${name} ${stamp()}.xlsx`);
  }

  function history(weeks) {
    const wb = XLSX.utils.book_new();
    const t = [['Week', 'Settlement Date', 'Expected', 'Actual', 'Difference', 'Reconciliation %', 'Short Payment', 'Excess Payment', 'Recovery Required', 'Exceptions', 'Active SKUs']];
    for (const w of weeks) { const s = w.summary; t.push([w.label, w.date, s.totalExpected, s.totalActual, s.net, s.reconPct == null ? '' : r2(s.reconPct), s.shortTotal, s.excessTotal, s.recovery, s.exceptions, s.activeSkus]); }
    XLSX.utils.book_append_sheet(wb, sheet(t, [12, 14, 16, 16, 14, 14, 14, 14, 16, 11, 11]), 'Weekly Summary');
    const d = [['Week', 'Settlement Date', 'SKU', 'Expected', 'Actual', 'Difference', 'Status']];
    for (const w of weeks) for (const r of w.rows) d.push([w.label, w.date, r.s, r.e, r.a, r.d, r.st]);
    XLSX.utils.book_append_sheet(wb, sheet(d, [12, 14, 40, 14, 14, 14, 22]), 'SKU History');
    save(wb, `Flipkart Weekly History ${stamp()}.xlsx`);
  }

  return { recovery, recoveryRows, full, rows, history, saveFile };
})();
