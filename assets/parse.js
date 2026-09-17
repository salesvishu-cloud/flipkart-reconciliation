/* Excel reading + automatic column detection. */
const Parse = (() => {
  const RX = {
    sku: /\b(seller )?sku( id| code| name)?\b|\bfsn\b|product code|item code|article( no| code)?|style code|listing id|model( no)?\b/,
    skuWeak: /product|item|listing|model/,
    order: /order ?(item )?(id|no|number|#)|\bsuborder\b|\bod id\b/,
    qty: /\bqty\b|quantity|\bunits?\b|\bpcs\b/,
    returnType: /return type|return reason|\breturn\b(?!.*status)/,
    amountExpected: /expected|settle|payout|amount|value|net|receivable|price/,
    amountActual: /actual|received|settle|payment|payout|net|amount|credit|bank|value/,
    amountBad: /\bqty\b|quantity|order|\bid\b|date|%|percent|rate|gst|tax|tds|tcs|commission|fee|charge|shipping|mrp|discount|count|units?/,
  };

  function readFile(file) {
    return new Promise((resolve, reject) => {
      if (!/\.(xlsx|xls|xlsm|csv)$/i.test(file.name)) {
        reject(new Error(`"${file.name}" is not an Excel file. Please upload a .xlsx, .xls or .csv file.`));
        return;
      }
      if (typeof XLSX === 'undefined') {
        reject(new Error('The Excel reader library did not load. Check the internet connection once and reload the page.'));
        return;
      }
      const fr = new FileReader();
      fr.onerror = () => reject(new Error(`Could not read "${file.name}". The file may be open in Excel or damaged.`));
      fr.onload = () => {
        try {
          const bytes = new Uint8Array(fr.result);
          const wb = /\.csv$/i.test(file.name)
            ? XLSX.read(new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, ''), { type: 'string', cellDates: true, raw: false })
            : XLSX.read(bytes, { type: 'array', cellDates: true });
          resolve(wb);
        } catch (e) {
          reject(new Error(`"${file.name}" could not be opened as a spreadsheet (${e.message}). If it is password-protected, remove the password and re-save.`));
        }
      };
      fr.readAsArrayBuffer(file);
    });
  }

  /** Locate the header row: the early row with the most text cells followed by data. */
  function findHeaderRow(aoa) {
    let best = -1, bestScore = 0;
    const lim = Math.min(aoa.length, 20);
    for (let r = 0; r < lim; r++) {
      const row = aoa[r] || [];
      const texts = row.filter(c => typeof c === 'string' && c.trim() && U.toNumber(c).kind === 'invalid').length;
      const next = (aoa[r + 1] || []).filter(c => c !== '' && c != null).length;
      const score = texts + (next ? 0.5 : 0);
      if (texts >= 2 && score > bestScore) { best = r; bestScore = score; }
    }
    return best;
  }

  function profileColumn(rows, ci) {
    let filled = 0, numeric = 0, ints = 0, smallInts = 0, odLike = 0, text = 0;
    const uniq = new Set();
    const n = Math.min(rows.length, 3000);
    for (let i = 0; i < n; i++) {
      const v = rows[i][ci];
      if (v === '' || v == null) continue;
      filled++;
      const t = U.toNumber(v);
      if (t.value != null) {
        numeric++;
        if (Number.isInteger(t.value)) { ints++; if (t.value >= 0 && t.value <= 100) smallInts++; }
      } else {
        text++;
        if (/^OD\d{8,}/i.test(String(v).trim())) odLike++;
      }
      if (uniq.size < 5000) uniq.add(String(v).trim().toUpperCase());
    }
    const f = filled || 1;
    return { filled, numericRatio: numeric / f, textRatio: text / f, intRatio: numeric ? ints / numeric : 0, smallIntRatio: numeric ? smallInts / numeric : 0, odRatio: odLike / f, uniqRatio: uniq.size / f };
  }

  /** Score each column for each role and pick the best, with a confidence level. */
  function detect(headers, rows, kind) {
    const H = headers.map(U.normHeader);
    const P = headers.map((_, i) => profileColumn(rows, i));
    const pick = (scorer) => {
      let best = null;
      H.forEach((h, i) => {
        const s = scorer(h, P[i], i);
        if (s > 0 && (!best || s > best.score)) best = { index: i, score: s };
      });
      return best;
    };

    const order = pick((h, p) => (RX.order.test(h) ? 3 : 0) + (p.odRatio > 0.5 ? 2 : 0));
    const qty = pick((h, p) => RX.qty.test(h) && p.numericRatio > 0.8 && p.smallIntRatio > 0.8 ? 3 : 0);
    const returnType = kind === 'actual' ? pick((h, p) => RX.returnType.test(h) && p.textRatio > 0.5 ? 2 : 0) : null;

    const sku = pick((h, p, i) => {
      if (order && order.index === i) return 0;
      if (p.filled === 0 || p.textRatio < 0.5) return 0;
      let s = 0;
      if (RX.sku.test(h)) s += 5; else if (RX.skuWeak.test(h)) s += 1.5;
      s += p.textRatio + Math.min(p.uniqRatio, 0.6);
      if (p.odRatio > 0.2) s -= 4;
      return s;
    });

    const amtRx = kind === 'expected' ? RX.amountExpected : RX.amountActual;
    const amount = pick((h, p, i) => {
      if ([order, qty, sku].some(x => x && x.index === i)) return 0;
      if (p.filled === 0 || p.numericRatio < 0.7) return 0;
      let s = p.numericRatio;
      if (amtRx.test(h)) s += 3;
      if (kind === 'expected' && /expected/.test(h)) s += 2;
      if (kind === 'actual' && /actual|received|net|settle/.test(h)) s += 2;
      if (RX.amountBad.test(h) && !/settle|payment|received|payout/.test(h)) s -= 2.5;
      if (p.smallIntRatio > 0.95) s -= 1.5;
      return s;
    });

    const conf = (x, strong) => !x ? 'missing' : (x.score >= strong ? 'high' : 'low');
    return {
      sku: sku && { index: sku.index, confidence: conf(sku, 5) },
      amount: amount && { index: amount.index, confidence: conf(amount, 3.6) },
      order: order && { index: order.index, confidence: 'high' },
      qty: qty && { index: qty.index, confidence: 'high' },
      returnType: returnType && { index: returnType.index, confidence: 'high' },
    };
  }

  function sheetToTable(ws) {
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true, blankrows: false });
    const hr = findHeaderRow(aoa);
    if (hr < 0) return null;
    const width = Math.max(...aoa.slice(hr, hr + 50).map(r => r.length));
    const seen = {};
    const headers = Array.from({ length: width }, (_, i) => {
      let h = String(aoa[hr][i] ?? '').trim() || `Column ${XLSX.utils.encode_col(i)}`;
      if (seen[h]) h = `${h} (${++seen[h]})`; else seen[h] = 1;
      return h;
    });
    const rows = [];
    for (let r = hr + 1; r < aoa.length; r++) {
      const row = aoa[r];
      rows.push({ cells: headers.map((_, i) => row[i] ?? ''), excelRow: r + 1 });
    }
    return { headers, rows, headerRow: hr + 1 };
  }

  /** Parse a workbook for a given role and return table + detection. */
  async function load(file, kind) {
    const wb = await readFile(file);
    const candidates = [];
    for (const name of wb.SheetNames) {
      const t = sheetToTable(wb.Sheets[name]);
      if (!t || !t.rows.length) continue;
      const det = detect(t.headers, t.rows.map(r => r.cells), kind);
      const score = (det.sku ? 2 : 0) + (det.amount ? 2 : 0) + (det.sku?.confidence === 'high' ? 1 : 0) + (det.amount?.confidence === 'high' ? 1 : 0) + Math.min(t.rows.length / 1e4, 0.5);
      candidates.push({ name, ...t, detected: det, score });
    }
    if (!candidates.length) throw new Error(`"${file.name}" has no readable data. Make sure the first sheet has a header row (e.g. SKU, Amount) and data below it.`);
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    return { fileName: file.name, kind, sheetNames: candidates.map(c => c.name), sheets: candidates, ...best, sheetName: best.name };
  }

  function useSheet(parsed, name) {
    const s = parsed.sheets.find(x => x.name === name);
    if (s) Object.assign(parsed, s, { sheetName: s.name });
    return parsed;
  }

  return { load, useSheet };
})();
