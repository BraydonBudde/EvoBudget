'use strict';
/* =====================================================================
   bank-import.js - a bank's CSV export, brought into Ultimate Budget.

   The whole file is read and checked here, in the browser. Nothing is
   written until the person has seen every row and pressed Add, and one
   Undo takes the whole batch back out.

   1. Read      encoding, delimiter, header row (six languages, or none
                at all), a date format and a decimal mark for the file.
   2. Validate  each row needs a readable date and an amount. One with no
                description still comes in, its description left empty. Pending, declined and balance lines are left
                out, each with its reason. Account, card and reference
                numbers are never kept.
   3. Signs     money out is spending, money in is income. A card export
                that shows spending as positive is spotted, from the
                balance column when there is one, and turned round.
   4. Clean     "VISA DEBIT 1234 SQ *BLUE BOTTLE 02/10 SF CA" becomes
                "Blue Bottle"; well-known brands get their proper name.
   5. Sort      transfers between the person's own accounts are left out,
                anything already in the planner is caught, bills, debts
                and goals are matched by name, and categories come from
                the person's own history, the bank's category, the shop,
                and then Ezzo. Whatever is still unknown is Uncategorized.
   6. Check     the running balance is followed row by row and the net
                change compared with the opening and closing balance.

   PDF statements are read on the device too (pdf.js, bundled in vendor/):
   the words on each page are put back into lines and columns and go
   through exactly the same steps. A scanned statement has no words to
   read; only then, and only when the person says so after being told
   what it means, Ezzo reads the PDF itself.

   Ezzo (penny.js) is asked only to pick categories, and is sent only
   shop names and whether money went out or came in: never amounts,
   dates, balances or account details. The request goes through
   pennyStreamWithFallback exactly as the chat's own requests do.
   ===================================================================== */

const BI_MAX_BYTES = 5 * 1024 * 1024;
const BI_MAX_ROWS = 5000;
const BI_PAGE = 100;
const BI_EZZO_BATCH = 120;

// ── Text helpers ─────────────────────────────────────────────────────────
const biNorm = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/ł/g, 'l').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim();
const biRound = n => Math.round((Number(n) || 0) * 100) / 100;
// The same place, whatever its store number.
const biKey = s => biNorm(s).replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim();

// ── 1. Reading ───────────────────────────────────────────────────────────
// UTF-8 first. A file full of replacement characters was saved by an older
// Windows program, so it is read again as Windows-1252.
function biDecode(buf) {
  let txt = new TextDecoder('utf-8').decode(buf);
  if ((txt.match(/�/g) || []).length > 2) {
    try { const alt = new TextDecoder('windows-1252').decode(buf); if (!(alt.match(/�/g) || []).length) txt = alt; } catch (e) {}
  }
  return txt.replace(/^﻿/, '');
}
// The delimiter that splits the most lines into the same number of fields.
function biDelimiter(text) {
  const lines = text.split(/\r\n|\n|\r/).filter(l => l.trim()).slice(0, 40);
  let best = ',', bestScore = -1;
  [',', ';', '\t', '|'].forEach(d => {
    const counts = lines.map(l => biSplitLine(l, d).length).filter(n => n > 1);
    if (!counts.length) return;
    const freq = {}; counts.forEach(n => { freq[n] = (freq[n] || 0) + 1; });
    const [n, hits] = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
    const score = hits * Math.min(Number(n), 12);
    if (score > bestScore) { bestScore = score; best = d; }
  });
  return best;
}
function biSplitLine(line, d) { return biParseCsv(line, d)[0] || []; }
// Quotes, doubled quotes inside quotes, and line breaks inside quotes.
function biParseCsv(text, d) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell.trim() === '') { q = true; cell = ''; }
    else if (c === d) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
      if (rows.length > BI_MAX_ROWS + 60) break;
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => r.map(x => x.trim())).filter(r => r.some(x => x !== ''));
}

// ── Columns ──────────────────────────────────────────────────────────────
// What each column is called, in the six languages and by the banks people
// most often export from. Sensitive columns are named so they can be
// recognised and left alone.
const BI_HEAD = {
  date: ['transaction date', 'trans date', 'date', 'booking date', 'posting date', 'posted date', 'date posted', 'completed date', 'started date', 'transaction_date', 'datum',
    'buchungstag', 'buchungsdatum', 'date operation', 'date de l operation', 'date comptable', 'fecha', 'fecha operacion', 'fecha de operacion', 'data', 'data operazione',
    'data contabile', 'data transakcji', 'data operacji', 'data ksiegowania', 'value date', 'valuta', 'wertstellung', 'date valeur', 'fecha valor', 'data valuta'],
  payee: ['payee', 'merchant', 'merchant name', 'name', 'counterparty', 'beneficiary', 'empfanger', 'auftraggeber empfanger', 'zahlungsempfanger', 'beguenstigter',
    'beneficiaire', 'beneficiario', 'kontrahent', 'nazwa odbiorcy', 'odbiorca', 'nadawca odbiorca'],
  desc: ['description', 'transaction description', 'details', 'transaction details', 'memo', 'narrative', 'particulars', 'text', 'verwendungszweck', 'buchungstext',
    'beschreibung', 'libelle', 'libelle operation', 'description de l operation', 'concepto', 'descripcion', 'movimiento', 'descrizione', 'causale', 'descrizione operazione',
    'opis', 'tytul', 'opis operacji', 'tytul operacji', 'original description', 'reference', 'referenz'],
  amount: ['amount', 'transaction amount', 'value', 'betrag', 'umsatz', 'montant', 'importe', 'importo', 'kwota', 'kwota transakcji', 'sum', 'amt'],
  debit: ['debit', 'debits', 'debit amount', 'withdrawal', 'withdrawals', 'paid out', 'money out', 'out', 'outflow', 'spent', 'ausgang', 'soll', 'lastschrift', 'belastung',
    'debit eur', 'cargo', 'cargos', 'addebito', 'addebiti', 'uscite', 'obciazenia', 'wyplata', 'wydatki'],
  credit: ['credit', 'credits', 'credit amount', 'deposit', 'deposits', 'paid in', 'money in', 'in', 'inflow', 'received', 'eingang', 'haben', 'gutschrift', 'credit eur',
    'abono', 'abonos', 'ingreso', 'accredito', 'accrediti', 'entrate', 'uznania', 'wplata', 'wplywy'],
  balance: ['balance', 'running balance', 'running bal', 'bal', 'balance after', 'available balance', 'saldo nach buchung', 'saldo', 'kontostand', 'solde', 'saldo contable', 'saldo disponible', 'saldo disponibile', 'saldo po operacji', 'saldo po transakcji'],
  kind: ['type', 'transaction type', 'details', 'dr cr', 'cr dr', 'debit credit', 'indicator', 's h', 'soll haben', 'umsatzart', 'typ', 'typ transakcji', 'tipo', 'tipo movimiento'],
  status: ['state', 'status', 'status transakcji', 'estado', 'stato', 'statut'],
  category: ['category', 'kategorie', 'categorie', 'categoria', 'kategoria'],
  sensitive: ['account', 'account number', 'card', 'card no', 'card number', 'iban', 'bic', 'swift', 'sort code', 'kontonummer', 'konto', 'numero de compte', 'numero de carte',
    'numero de cuenta', 'tarjeta', 'numero carta', 'conto', 'numer konta', 'numer karty', 'reference number', 'transaction id', 'id', 'check or slip', 'check number', 'cheque']
};
// How well a heading names a role: 3 exact, 2 leading or trailing word,
// 1 somewhere inside. Ties go to the name listed first, so "Description"
// beats "Details" and "Completed date" beats "Started date".
function biColumnRank(head, names) {
  const h = biNorm(head);
  if (!h) return 0;
  let s = 0;
  names.forEach((n, i) => {
    const base = h === n ? 3 : (h.startsWith(n + ' ') || h.endsWith(' ' + n)) ? 2 : ((' ' + h + ' ').includes(' ' + n + ' ') && n.length > 3) ? 1 : 0;
    if (base) s = Math.max(s, base * 100 - i);
  });
  return s;
}
const biColumnScore = (head, names) => Math.ceil(biColumnRank(head, names) / 100);
// The header is the first row within the top thirty that names a date and
// either an amount or money out/in. Banks often put account details above it.
function biFindHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = rows[i];
    const has = k => r.some(c => biColumnScore(c, BI_HEAD[k]) >= 2);
    if (r.length >= 2 && has('date') && (has('amount') || has('debit') || has('credit'))) return i;
  }
  return -1;
}
function biMapFromHeader(head, body) {
  const used = new Set(), map = {};
  const take = (role, minScore, check) => {
    let best = -1, bs = 0;
    head.forEach((h, i) => {
      if (used.has(i)) return;
      const sc = biColumnRank(h, BI_HEAD[role]);
      if (Math.ceil(sc / 100) >= (minScore || 2) && sc > bs && (!check || check(i))) { bs = sc; best = i; }
    });
    if (best >= 0) { map[role] = best; used.add(best); }
  };
  const dateLike = i => body.slice(0, 40).filter(r => r[i]).filter(r => biLooksDate(r[i])).length >= Math.max(1, body.slice(0, 40).filter(r => r[i]).length * 0.6);
  const numLike = i => body.slice(0, 40).filter(r => r[i]).every(r => /\d/.test(r[i]) && !/[a-z]{4,}/i.test(r[i].replace(/\b(cr|dr|eur|usd|gbp|pln|chf)\b/ig, '')));
  head.forEach((h, i) => { if (biColumnScore(h, BI_HEAD.sensitive) >= 3) used.add(i); });
  take('date', 2, dateLike);
  take('amount', 2, numLike);
  take('debit', 2, numLike); take('credit', 2, numLike);
  if (map.amount != null) { delete map.debit; delete map.credit; }
  take('balance', 2, numLike);
  take('payee', 2); take('desc', 2);
  take('kind', 2); take('status', 3); take('category', 3);
  if (map.desc == null && map.payee != null) { map.desc = map.payee; delete map.payee; }
  return map;
}
// No header at all: the date is the column that reads as dates, the amount
// the signed number beside it, the description the longest text.
function biMapFromContent(rows) {
  const n = Math.max(...rows.slice(0, 40).map(r => r.length));
  const sample = rows.slice(0, 60), map = {};
  const frac = (i, f) => sample.filter(r => r[i] && f(r[i])).length / Math.max(1, sample.filter(r => r[i]).length);
  for (let i = 0; i < n; i++) if (map.date == null && frac(i, biLooksDate) > 0.8) map.date = i;
  let bestNum = -1, bestScore = 0;
  for (let i = 0; i < n; i++) {
    if (i === map.date) continue;
    const f = frac(i, v => /^[\s(+\-−]*[\d.,' ]*\d[\d.,' ]*\)?[\s-]*(cr|dr)?$/i.test(v));
    const signed = sample.filter(r => /^[\s(]*[-−]|\)$|-$/.test(r[i] || '')).length;
    const score = f > 0.8 ? f + (signed ? 0.5 : 0) : 0;
    if (score > bestScore) { bestScore = score; bestNum = i; }
  }
  if (bestNum >= 0) map.amount = bestNum;
  let bestTxt = -1, bestLen = 0;
  for (let i = 0; i < n; i++) {
    if (i === map.date || i === map.amount) continue;
    const len = sample.reduce((s, r) => s + ((r[i] || '').replace(/[\d\s.,*-]/g, '').length), 0);
    if (len > bestLen) { bestLen = len; bestTxt = i; }
  }
  if (bestTxt >= 0) map.desc = bestTxt;
  return map;
}

// ── Dates ────────────────────────────────────────────────────────────────
const BI_MONTHS = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  januar: 1, februar: 2, marz: 3, maerz: 3, mrz: 3, mai: 5, juni: 6, juli: 7, okt: 10, oktober: 10, dez: 12, dezember: 12,
  janv: 1, janvier: 1, fev: 2, fevr: 2, fevrier: 2, mars: 3, avr: 4, avril: 4, juin: 6, juil: 7, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
  ene: 1, enero: 1, febrero: 2, marzo: 3, abr: 4, abril: 4, mayo: 5, junio: 6, julio: 7, ago: 8, agosto: 8, septiembre: 9, setiembre: 9, set: 9, octubre: 10, noviembre: 11, dic: 12, diciembre: 12,
  gen: 1, gennaio: 1, febbraio: 2, aprile: 4, mag: 5, maggio: 5, giu: 6, giugno: 6, lug: 7, luglio: 7, settembre: 9, ott: 10, ottobre: 10, dicembre: 12,
  sty: 1, styczen: 1, stycznia: 1, lut: 2, luty: 2, lutego: 2, marzec: 3, marca: 3, kwi: 4, kwiecien: 4, kwietnia: 4, maj: 5, maja: 5, cze: 6, czerwiec: 6, czerwca: 6,
  lip: 7, lipiec: 7, lipca: 7, sie: 8, sierpien: 8, sierpnia: 8, wrz: 9, wrzesien: 9, wrzesnia: 9, paz: 10, pazdziernik: 10, pazdziernika: 10, lis: 11, listopad: 11, listopada: 11,
  gru: 12, grudzien: 12, grudnia: 12 };
const BI_NUM_DATE = /^(\d{1,4})[\/.\-](\d{1,2})[\/.\-](\d{1,4})\.?$/;
function biDatePart(v) { return String(v || '').trim().replace(/[T ]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+\-]\d{2}:?\d{2})?$/i, '').replace(/\s+\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?$/i, '').trim(); }
function biLooksDate(v) {
  const s = biDatePart(v);
  return BI_NUM_DATE.test(s) || /^(19|20)\d{6}$/.test(s) || /^\d{1,2}[\s.\-\/]*[a-zÀ-ſ]{3,}\.?[\s.\-\/,]*\d{2,4}$/i.test(s) || /^[a-zÀ-ſ]{3,}\.?\s+\d{1,2},?\s+\d{2,4}$/i.test(s);
}
const biYear = y => { y = Number(y); return y < 100 ? (y < 70 ? 2000 + y : 1900 + y) : y; };
function biIso(y, m, d) {
  y = biYear(y); m = Number(m); d = Number(d);
  if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1)) return null;
  if (d > new Date(y, m, 0).getDate()) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
// order: 'dmy' | 'mdy' | 'ymd'
function biParseDate(v, order) {
  const s = biDatePart(v);
  if (!s) return null;
  if (/^\d{5}(\.\d+)?$/.test(s)) {           // a spreadsheet serial number
    const n = Number(s); if (n < 30000 || n > 70000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
    return biIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  if (/^(19|20)\d{6}$/.test(s)) return biIso(s.slice(0, 4), s.slice(4, 6), s.slice(6, 8));
  let m = BI_NUM_DATE.exec(s);
  if (m) {
    const [a, b, c] = [m[1], m[2], m[3]];
    if (a.length === 4) return biIso(a, b, c);
    return order === 'mdy' ? biIso(c, a, b) : biIso(c, b, a);
  }
  m = /^(\d{1,2})[\s.\-\/]*([a-zÀ-ſ]{3,})\.?[\s.\-\/,]*(\d{2,4})$/i.exec(s);
  if (m) { const mo = BI_MONTHS[biNorm(m[2])]; return mo ? biIso(m[3], mo, m[1]) : null; }
  m = /^([a-zÀ-ſ]{3,})\.?\s+(\d{1,2}),?\s+(\d{2,4})$/i.exec(s);
  if (m) { const mo = BI_MONTHS[biNorm(m[1])]; return mo ? biIso(m[3], mo, m[2]) : null; }
  return null;
}
// Day-first or month-first, decided by the file itself: a first number over
// 12 settles it, then a second one, then whichever order keeps the dates in
// sequence, and only then the planner's currency.
function biDateOrder(values) {
  const nums = values.map(biDatePart).map(v => BI_NUM_DATE.exec(v)).filter(m => m && m[1].length !== 4);
  if (!nums.length) return 'dmy';
  if (nums.some(m => Number(m[1]) > 12)) return 'dmy';
  if (nums.some(m => Number(m[2]) > 12)) return 'mdy';
  const run = order => {
    const ds = values.map(v => biParseDate(v, order)).filter(Boolean);
    let up = 0, down = 0;
    for (let i = 1; i < ds.length; i++) { if (ds[i] >= ds[i - 1]) up++; if (ds[i] <= ds[i - 1]) down++; }
    return Math.max(up, down) / Math.max(1, ds.length - 1);
  };
  const a = run('dmy'), b = run('mdy');
  if (Math.abs(a - b) > 0.05) return a > b ? 'dmy' : 'mdy';
  // A statement's dates sit close together and are not in the future: the
  // reading that spreads them over fewer days, none ahead of today, wins.
  const today = new Date().toISOString().slice(0, 10);
  const span = order => { const ds = values.map(v => biParseDate(v, order)).filter(Boolean).sort();
    if (!ds.length) return Infinity;
    return (new Date(ds[ds.length - 1]) - new Date(ds[0])) / 86400000 + ds.filter(d => d > today).length * 400; };
  const sa = span('dmy'), sb = span('mdy');
  if (sa !== sb) return sa < sb ? 'dmy' : 'mdy';
  return (state?.settings?.currency === 'USD') ? 'mdy' : 'dmy';
}

// ── Amounts ──────────────────────────────────────────────────────────────
// Which mark is the decimal point, decided across the whole column.
function biDecimalMark(values) {
  let comma = 0, dot = 0;
  values.forEach(v => {
    const s = String(v || '').replace(/[^\d.,]/g, '');
    const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc >= 0 && ld >= 0) { if (lc > ld) comma += 2; else dot += 2; }
    else if (lc >= 0) { if (/,\d{1,2}$/.test(s)) comma += 2; else if (/,\d{3}$/.test(s)) dot += 0.5; }
    else if (ld >= 0) { if (/\.\d{1,2}$/.test(s)) dot += 2; else if (/\.\d{3}$/.test(s)) comma += 0.5; }
  });
  return comma > dot ? ',' : '.';
}
function biAmount(raw, mark) {
  let s = String(raw == null ? '' : raw).trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/\b(dr|debit)\.?$/i.test(s)) { neg = !neg; s = s.replace(/\b(dr|debit)\.?$/i, ''); }
  else s = s.replace(/\b(cr|credit)\.?$/i, '');
  s = s.replace(/−/g, '-').replace(/[^\d,.\-+]/g, '');
  if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1); }
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  if (!s || /[-+]/.test(s)) return NaN;
  s = mark === ',' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  if (!/^\d*\.?\d+$/.test(s)) return NaN;
  const v = parseFloat(s);
  return neg ? -v : v;
}

// ── 4. Cleaning descriptions ─────────────────────────────────────────────
// Brand, display name, and what kind of spending it usually is.
const BI_BRANDS = [
  [/\b(amzn|amazon)\s*(prime|prime video)\b|prime video/, 'Amazon Prime', 'subs'], [/\bamzn|amazon|amz\s?mktp/, 'Amazon', 'shopping'],
  [/uber\s*eats/, 'Uber Eats', 'eating'], [/\buber\b/, 'Uber', 'transport'], [/\blyft\b/, 'Lyft', 'transport'], [/\bbolt\b/, 'Bolt', 'transport'],
  [/netflix/, 'Netflix', 'subs'], [/spotify/, 'Spotify', 'subs'], [/disney\s*(plus|\+)/, 'Disney+', 'subs'], [/\bhulu\b/, 'Hulu', 'subs'], [/youtube/, 'YouTube', 'subs'],
  [/apple\.com\/bill|itunes|apple services|apple com bill/, 'Apple', 'subs'], [/audible/, 'Audible', 'subs'], [/openai|chatgpt/, 'OpenAI', 'subs'], [/adobe/, 'Adobe', 'subs'],
  [/microsoft|msft|xbox/, 'Microsoft', 'subs'], [/playstation|sony interactive/, 'PlayStation', 'subs'], [/nintendo/, 'Nintendo', 'subs'], [/steam(games|powered)?\b/, 'Steam', 'subs'],
  [/dropbox/, 'Dropbox', 'subs'], [/google\s*\*?\s*(storage|one|cloud)/, 'Google One', 'subs'], [/patreon/, 'Patreon', 'subs'],
  [/starbucks/, 'Starbucks', 'eating'], [/mcdonald|mc donald|\bmcd\b/, "McDonald's", 'eating'], [/\bkfc\b/, 'KFC', 'eating'], [/burger king/, 'Burger King', 'eating'],
  [/domino'?s/, "Domino's", 'eating'], [/pizza hut/, 'Pizza Hut', 'eating'], [/subway\s*\d|subway restaurant|^subway$/, 'Subway', 'eating'], [/chipotle/, 'Chipotle', 'eating'],
  [/costa coffee/, 'Costa Coffee', 'eating'], [/pret a manger|\bpret\b/, 'Pret A Manger', 'eating'], [/greggs/, 'Greggs', 'eating'], [/nando/, "Nando's", 'eating'],
  [/deliveroo/, 'Deliveroo', 'eating'], [/just\s*eat/, 'Just Eat', 'eating'], [/doordash/, 'DoorDash', 'eating'], [/grubhub/, 'Grubhub', 'eating'], [/glovo/, 'Glovo', 'eating'],
  [/lieferando/, 'Lieferando', 'eating'], [/wolt/, 'Wolt', 'eating'], [/dunkin/, "Dunkin'", 'eating'], [/tim hortons/, 'Tim Hortons', 'eating'],
  [/wal-?mart/, 'Walmart', 'groceries'], [/\btarget\b/, 'Target', 'shopping'], [/costco/, 'Costco', 'groceries'], [/kroger/, 'Kroger', 'groceries'], [/safeway/, 'Safeway', 'groceries'],
  [/whole\s*foods/, 'Whole Foods', 'groceries'], [/trader joe/, "Trader Joe's", 'groceries'], [/\baldi\b/, 'Aldi', 'groceries'], [/\blidl\b/, 'Lidl', 'groceries'],
  [/tesco/, 'Tesco', 'groceries'], [/sainsbury/, "Sainsbury's", 'groceries'], [/\basda\b/, 'Asda', 'groceries'], [/morrisons/, 'Morrisons', 'groceries'], [/waitrose/, 'Waitrose', 'groceries'],
  [/co-?op\b/, 'Co-op', 'groceries'], [/m&s|marks\s*(and|&)\s*spencer/, 'M&S', 'groceries'], [/carrefour/, 'Carrefour', 'groceries'], [/\brewe\b/, 'REWE', 'groceries'],
  [/\bedeka\b/, 'EDEKA', 'groceries'], [/\bnetto\b/, 'Netto', 'groceries'], [/kaufland/, 'Kaufland', 'groceries'], [/\bpenny\b/, 'Penny', 'groceries'], [/biedronka/, 'Biedronka', 'groceries'],
  [/zabka|żabka/, 'Żabka', 'groceries'], [/mercadona/, 'Mercadona', 'groceries'], [/esselunga/, 'Esselunga', 'groceries'], [/\bconad\b/, 'Conad', 'groceries'], [/auchan/, 'Auchan', 'groceries'],
  [/leclerc/, 'E.Leclerc', 'groceries'], [/intermarche/, 'Intermarché', 'groceries'], [/monoprix/, 'Monoprix', 'groceries'], [/\bdm\b.*drogerie|dm-drogerie/, 'dm', 'health'],
  [/ikea/, 'IKEA', 'shopping'], [/h&m|hennes/, 'H&M', 'shopping'], [/\bzara\b/, 'Zara', 'shopping'], [/primark/, 'Primark', 'shopping'], [/uniqlo/, 'Uniqlo', 'shopping'],
  [/home depot/, 'Home Depot', 'shopping'], [/lowe'?s\b/, "Lowe's", 'shopping'], [/best buy/, 'Best Buy', 'shopping'], [/\bebay\b/, 'eBay', 'shopping'], [/\betsy\b/, 'Etsy', 'shopping'],
  [/zalando/, 'Zalando', 'shopping'], [/allegro/, 'Allegro', 'shopping'], [/aliexpress/, 'AliExpress', 'shopping'], [/temu/, 'Temu', 'shopping'], [/shein/, 'SHEIN', 'shopping'],
  [/boots\b/, 'Boots', 'health'], [/\bcvs\b/, 'CVS', 'health'], [/walgreens/, 'Walgreens', 'health'], [/rossmann/, 'Rossmann', 'health'],
  [/\bshell\b/, 'Shell', 'transport'], [/\bbp\b/, 'BP', 'transport'], [/\besso\b/, 'Esso', 'transport'], [/exxon/, 'Exxon', 'transport'], [/chevron/, 'Chevron', 'transport'],
  [/texaco/, 'Texaco', 'transport'], [/totalenergies|\btotal\b/, 'TotalEnergies', 'transport'], [/\borlen\b/, 'Orlen', 'transport'], [/\baral\b/, 'Aral', 'transport'],
  [/\btfl\b|transport for london/, 'TfL', 'transport'], [/trainline/, 'Trainline', 'transport'], [/deutsche bahn|\bdb\s*(vertrieb|fernverkehr)/, 'Deutsche Bahn', 'transport'],
  [/\bsncf\b/, 'SNCF', 'transport'], [/renfe/, 'Renfe', 'transport'], [/trenitalia/, 'Trenitalia', 'transport'], [/\bpkp\b/, 'PKP', 'transport'],
  [/ryanair/, 'Ryanair', 'travel'], [/easyjet/, 'easyJet', 'travel'], [/wizz\s*air/, 'Wizz Air', 'travel'], [/lufthansa/, 'Lufthansa', 'travel'], [/british airways/, 'British Airways', 'travel'],
  [/airbnb/, 'Airbnb', 'travel'], [/booking\.com|booking com/, 'Booking.com', 'travel'], [/expedia/, 'Expedia', 'travel'], [/hotels\.com/, 'Hotels.com', 'travel'],
  [/vodafone/, 'Vodafone', 'utilities'], [/\bo2\b/, 'O2', 'utilities'], [/\bee\b limited|\bee mobile/, 'EE', 'utilities'], [/t-?mobile/, 'T-Mobile', 'utilities'], [/verizon/, 'Verizon', 'utilities'],
  [/at&t|\batt\b/, 'AT&T', 'utilities'], [/comcast|xfinity/, 'Xfinity', 'utilities'], [/orange\b/, 'Orange', 'utilities'], [/telekom/, 'Telekom', 'utilities'],
  [/british gas/, 'British Gas', 'utilities'], [/octopus energy/, 'Octopus Energy', 'utilities'], [/\be\.?on\b/, 'E.ON', 'utilities'], [/edf\b/, 'EDF', 'utilities'],
  [/planet fitness/, 'Planet Fitness', 'health'], [/puregym|pure gym/, 'PureGym', 'health'], [/mcfit/, 'McFit', 'health'], [/basic-?fit/, 'Basic-Fit', 'health'],
  [/paypal/, 'PayPal', ''], [/venmo/, 'Venmo', ''], [/\bzelle\b/, 'Zelle', ''], [/cash\s*app/, 'Cash App', '']
];
// Words that say what kind of place it was when the brand is not known.
const BI_KIND_WORDS = [
  [/restaurant|cafe|coffee|kaffee|pizz|bakery|backerei|boulangerie|panaderia|bar\b|pub\b|bistro|grill|sushi|burger|kebab|trattoria|osteria|tapas|piekarnia|kawiarnia/, 'eating'],
  [/supermarket|supermarkt|market|grocery|groceries|epicerie|supermercado|alimentari|spozywczy|sklep/, 'groceries'],
  [/pharmacy|apotheke|pharmacie|farmacia|apteka|chemist|clinic|dental|doctor|arzt|medecin|medico|lekarz|optician/, 'health'],
  [/fuel|petrol|gas station|tankstelle|carburant|gasolinera|benzinaio|stacja paliw|parking|parken|toll|maut|peage|peaje|taxi|metro|subway fare|bus\b|railway|train/, 'transport'],
  [/hotel|hostel|airline|airways|flight|lufthansa|resort/, 'travel'],
  [/atm|cash withdrawal|geldautomat|bargeld|retrait|cajero|prelievo|bankomat|wyplata gotowki/, 'cash'],
  [/insurance|versicherung|assurance|seguro|assicurazion|ubezpieczen/, 'insurance'],
  [/electric|energy|water|strom|gas bill|internet|broadband|mobile|telecom/, 'utilities'],
  [/cinema|kino|cine|theatre|theater|concert|ticket|museum/, 'fun']
];
// What each kind of spending tends to be called as a budget category.
const BI_KIND_CATS = {
  groceries: /grocer|supermarket|food|lebensmittel|einkauf|courses|aliment|comestible|supermercado|spesa|spozyw|jedzenie/,
  eating: /eat|dining|restaurant|takeaway|take away|coffee|cafe|food|essen|gastro|restau|comida|ristorant|jedzenie/,
  transport: /transport|travel|commute|fuel|gas|petrol|car|auto|taxi|verkehr|tank|carburant|essence|gasolina|benzina|paliwo|dojazd|mobilit/,
  shopping: /shopping|clothes|clothing|household|home|personal|kleidung|haushalt|achats|vetement|compras|ropa|abbigliament|zakupy|ubrania|dom\b/,
  subs: /subscription|streaming|entertainment|media|abo|abonnement|suscrip|abbonament|subskryp|rozrywk|fun|leisure|freizeit|loisir|ocio|svago/,
  utilities: /utilit|bills|electric|energy|internet|phone|mobile|strom|nebenkosten|facture|energie|suministro|bollett|rachunk|oplaty/,
  health: /health|pharmacy|medical|doctor|fitness|gym|sport|gesundheit|apotheke|sante|pharmac|salud|farmac|salute|zdrow|aptek/,
  travel: /travel|holiday|vacation|trip|hotel|urlaub|reise|voyage|vacance|viaje|vacacion|viagg|vacanz|podroz|urlop|wakacj/,
  cash: /cash|atm|bargeld|espece|efectivo|contant|gotowk/,
  insurance: /insur|versicher|assuranc|seguro|assicura|ubezpiec/,
  fun: /fun|entertainment|leisure|going out|hobby|freizeit|loisir|ocio|svago|rozrywk/,
  salary: /salary|wage|pay\b|paycheck|payroll|income|gehalt|lohn|salaire|nomina|sueldo|stipendio|wynagrodz|pensj/
};
const BI_SALARY = /salary|payroll|wages|paycheck|gehalt|lohn|salaire|nomina|sueldo|stipendio|wynagrodzenie|pensja|bezuge/;
const BI_STATES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC ON QC BC AB MB SK NS NB NL PE'.split(' '));
// Card scheme words, payment rails and processor prefixes that say nothing
// about where the money went.
const BI_NOISE = /\b(ppd|ccd|purchase authorized on|authorized on|pos|purchase|card purchase|debit card purchase|debit card|credit card|visa debit|visa|mastercard|maestro|mc|contactless|cntls|apple pay|google pay|gpay|ach|direct debit|dd|standing order|so|fpi|fpo|bgc|tfr|chq|sepa|recurring|payment to|payment from|online|web|www|com|kartenzahlung|lastschrift|sepa lastschrift|paiement cb|paiement par carte|prlv sepa|prlv|carte|cb|compra tarjeta|compra|pago con tarjeta|pago|pagamento pos|pagamento|platnosc karta|zakup przy uzyciu karty|transakcja karta|blik)\b/gi;
function biClean(raw) {
  let s = String(raw || '');
  // Never kept: card and account numbers, IBANs, emails, long references.
  s = s.replace(/\b[A-Z]{2}\d{2}[A-Z0-9 ]{10,30}\b/g, ' ')
       .replace(/[X*•]{2,}\s?\d{2,6}/gi, ' ')
       .replace(/\b(card|karte|carte|tarjeta|carta|karta)\s*(no\.?|nr\.?|number)?\s*[:#]?\s*\d{4}\b/gi, ' ')
       .replace(/\S+@\S+\.\S+/g, ' ')
       .replace(/\b(ref|reference|referenz|id|trace|auth|txn)\s*[:#.]?\s*[A-Z0-9\-]{4,}/gi, ' ')
       .replace(/\.{2,}\s?\d+/g, ' ')
       .replace(/\b[a-z]{3,}#\s*:?/gi, ' ')
       .replace(/\d{6,}/g, ' ');
  const low = biNorm(s) + ' ' + s.toLowerCase();
  for (const [re, name, kind] of BI_BRANDS) if (re.test(low)) return { name, kind, brand: true };
  s = s.replace(/\b(sq|tst|sp|pp|iz|zettle|sumup|cko|paypal)\s*\*\s*/gi, ' ')
       .replace(/\*/g, ' ')
       .replace(/\b\d{1,2}[\/.\-]\d{1,2}([\/.\-]\d{2,4})?\b/g, ' ')
       .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, ' ')
       .replace(/#\s?\d+/g, ' ')
       .replace(BI_NOISE, ' ')
       .replace(/\b(usa|gb|gbr|uk|deu|fra|esp|ita|pol)\b\s*$/i, ' ')
       .replace(/(^|\s)\d{2,5}(?=\s|$)/g, ' ')
       .replace(/\s{2,}/g, ' ').replace(/^[\s\-–,.:/]+|[\s\-–,.:/]+$/g, '').trim();
  // A US-style ending, "OAKLAND CA": the state goes, and the town with it
  // when that still leaves a name of two words or more.
  const words = s.split(/\s+/);
  if (words.length >= 2 && /^[A-Z]{2}$/.test(words[words.length - 1]) && BI_STATES.has(words[words.length - 1])) {
    words.pop();
    if (words.length >= 3 && words[words.length - 1] === words[words.length - 1].toUpperCase()) words.pop();
    s = words.join(' ');
  }
  if (!s) s = String(raw || '').replace(/\d{6,}/g, ' ').trim();
  const pretty = /[a-z]/.test(s) && /[A-Z]/.test(s) ? s : s.toLowerCase().replace(/(^|[\s\-/&.'(])([a-zà-ſ])/g, (m, a, b) => a + b.toUpperCase());
  const name = pretty.slice(0, 60);
  const n = biNorm(name);
  let kind = '';
  for (const [re, k] of BI_KIND_WORDS) if (re.test(n)) { kind = k; break; }
  return { name, kind, brand: false };
}

// ── 5. Transfers, refunds and the like ───────────────────────────────────
const BI_TRANSFER = /\b(transfer|xfer|tfr|internal|own account|to savings|from savings|savings account|to checking|from checking|to current|from current|moved to|moved from|pot|pocket|vault|space|round ?up|top ?up|topup|exchange|umbuchung|ubertrag|eigene|eigenes konto|sparkonto|virement interne|virement vers|virement de|vers livret|livret a|traspaso|entre cuentas|giroconto|girofondo|przelew wlasny|przelew wewnetrzny|przelew na wlasne|lokata)\b/;
const BI_CARD_PAYMENT = /\b(credit card payment|card payment thank|payment thank you|thank you payment|payment received|autopay|auto pay|amex payment|amex epayment|cc payment|card repayment|online pymt|mobile pymt|online payment|mobile payment|epayment|pymt|kreditkartenabrechnung|remboursement carte|pago tarjeta credito|rata carta|splata karty)\b/;
const BI_REFUND = /\b(refund|reversal|return|chargeback|erstattung|ruckerstattung|gutschrift|remboursement|reembolso|devolucion|rimborso|storno|zwrot)\b/;
const BI_SKIP_LINE = /^(opening|closing|starting|ending|beginning) balance|^balance (brought|carried) forward|^(total|totals|subtotal)\b|^(anfangssaldo|endsaldo|alter kontostand|neuer kontostand)|^solde (initial|final|precedent|anterieur)|^saldo (inicial|final|anterior|iniziale|finale|poczatkowe|koncowe|otwarcia|zamkniecia)/;
const BI_PENDING = /pending|authori[sz]ed|ausstehend|vorgemerkt|en attente|en cours|pendiente|in sospeso|oczekuj|blokada/;
const BI_FAILED = /declined|reverted|reversed|failed|cancel|abgelehnt|storniert|refuse|annule|rechazad|anulad|rifiutat|annullat|odrzucon|anulowan/;

// ── 2. and 3. Building the rows ──────────────────────────────────────────
function biBuildRows(ctx) {
  const { body, map } = ctx;
  const out = [], skipped = [];
  const vals = k => body.map(r => map[k] != null ? r[map[k]] : '').filter(Boolean);
  const order = ctx.dateOrder === 'auto' || !ctx.dateOrder ? biDateOrder(vals('date')) : ctx.dateOrder;
  const mark = biDecimalMark([].concat(vals('amount'), vals('debit'), vals('credit'), vals('balance')));
  body.forEach((r, idx) => {
    const cell = k => (map[k] != null ? (r[map[k]] || '') : '');
    const descRaw = (cell('payee') || cell('desc')).trim();
    const fullRaw = [cell('payee'), cell('desc')].filter(Boolean).join(' ').trim();
    const why = reason => skipped.push({ line: idx, reason, date: cell('date'), desc: biClean(descRaw).name, amount: cell('amount') || cell('debit') || cell('credit') });
    if (BI_SKIP_LINE.test(biNorm(descRaw))) return why('summary');
    const date = biParseDate(cell('date'), order);
    let amount;
    if (map.amount != null) amount = biAmount(cell('amount'), mark);
    else {
      const d = biAmount(cell('debit'), mark), c = biAmount(cell('credit'), mark);
      amount = (isNaN(c) ? 0 : Math.abs(c)) - (isNaN(d) ? 0 : Math.abs(d));
      if (isNaN(d) && isNaN(c)) amount = NaN;
    }
    const kindCell = biNorm(cell('kind'));
    if (!isNaN(amount) && kindCell) {
      if (/^(dr|d|debit|s|soll|withdrawal|lastschrift|belastung|cargo|addebito|obciazenie)$/.test(kindCell)) amount = -Math.abs(amount);
      else if (/^(cr|c|credit|h|haben|deposit|gutschrift|abono|accredito|uznanie)$/.test(kindCell)) amount = Math.abs(amount);
    }
    const status = biNorm(cell('status'));
    if (!date && !cell('date') && isNaN(amount) && !status) return;   // an empty or decorative line
    if (status && BI_FAILED.test(status)) return why('failed');
    if (status && BI_PENDING.test(status)) return why('pending');
    if (!date) return why('date');
    if (isNaN(amount)) return why('amount');
    if (Math.abs(amount) < 0.005) return why('zero');
    const bal = map.balance != null ? biAmount(cell('balance'), mark) : NaN;
    out.push({ line: idx, date, amount: biRound(amount), balance: isNaN(bal) ? null : biRound(bal), raw: descRaw, full: fullRaw, kindHint: kindCell, bankCat: cell('category') });
  });
  return { rows: out, skipped, order, mark };
}
// Is spending positive in this file? The balance column answers it outright;
// without one, a file of mostly positive amounts whose few negatives are
// card payments or refunds is a card statement.
function biDetectFlip(rows, map) {
  const chron = biChrono(rows);
  const withBal = chron.filter(r => r.balance != null);
  if (withBal.length >= 3) {
    let same = 0, flip = 0;
    for (let i = 1; i < withBal.length; i++) {
      const d = biRound(withBal[i].balance - withBal[i - 1].balance);
      if (Math.abs(d - withBal[i].amount) < 0.011) same++;
      else if (Math.abs(d + withBal[i].amount) < 0.011) flip++;
    }
    if (same + flip >= 2) return flip > same;
  }
  if (map.debit != null || map.credit != null) return false;
  const pos = rows.filter(r => r.amount > 0), neg = rows.filter(r => r.amount < 0);
  if (rows.length >= 4 && pos.length / rows.length >= 0.75) {
    const negPay = neg.filter(r => BI_CARD_PAYMENT.test(biNorm(r.raw)) || /payment|thank|credit|refund|zahlung|paiement|pago|pagamento|platnosc|splata/.test(biNorm(r.raw))).length;
    if (!neg.length || negPay / neg.length >= 0.5) return true;
  }
  return false;
}
// Every amount printed without a sign, beside a running balance: each one
// went the way the balance moved. The first is settled by the statement's
// opening balance when there is one, otherwise by what it says it is.
function biSignFromBalance(rows, statement) {
  if (!rows.length || rows.some(r => r.amount < 0)) return false;
  const chron = biChrono(rows), withBal = chron.filter(r => r.balance != null);
  if (withBal.length < 2 || withBal.length < chron.length * 0.8) return false;
  let fixed = 0;
  for (let i = 1; i < chron.length; i++) {
    const a = chron[i - 1], b = chron[i];
    if (a.balance == null || b.balance == null) continue;
    const d = biRound(b.balance - a.balance);
    if (Math.abs(Math.abs(d) - b.amount) < 0.011) { if (d < 0) b.amount = -b.amount; fixed++; }
  }
  if (!fixed) return false;
  const first = chron[0];
  const open = statement && statement.start != null ? biAmount(String(statement.start), biDecimalMark([String(statement.start)])) : NaN;
  if (!isNaN(open) && first.balance != null) { if (biRound(first.balance - open) < 0) first.amount = -first.amount; }
  else if (!/(salary|payroll|deposit|credit|refund|interest|transfer from|paid in|gehalt|lohn|gutschrift|salaire|virement recu|nomina|abono|stipendio|accredito|wynagrodzenie|wplyw)/.test(biNorm(first.full || first.raw))) first.amount = -first.amount;
  return true;
}
// Oldest first, whichever way round the bank wrote it.
function biChrono(rows) {
  if (rows.length < 2) return rows.slice();
  return rows[0].date > rows[rows.length - 1].date ? rows.slice().reverse() : rows.slice();
}
// ── 6. The balance check ─────────────────────────────────────────────────
function biReconcile(rows) {
  const chron = biChrono(rows);
  const inSum = biRound(rows.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0));
  const outSum = biRound(rows.filter(r => r.amount < 0).reduce((s, r) => s - r.amount, 0));
  const res = { inSum, outSum, net: biRound(inSum - outSum), from: chron[0]?.date, to: chron[chron.length - 1]?.date };
  const withBal = chron.filter(r => r.balance != null);
  if (withBal.length >= 2 && withBal.length >= chron.length * 0.8) {
    const opening = biRound(withBal[0].balance - withBal[0].amount);
    const closing = withBal[withBal.length - 1].balance;
    const expected = biRound(opening + chron.reduce((s, r) => s + r.amount, 0));
    const broken = [];
    for (let i = 1; i < withBal.length; i++) {
      if (Math.abs(biRound(withBal[i - 1].balance + withBal[i].amount) - withBal[i].balance) > 0.011) broken.push(withBal[i].line);
    }
    Object.assign(res, { hasBalance: true, opening, closing, diff: biRound(closing - expected), broken });
  }
  return res;
}

// ── 5. Sorting each row ──────────────────────────────────────────────────
function biCats() {
  const uncat = t('qa_uncat');
  return {
    uncat,
    expense: (state.budgets?.expenses || []).map(r => r.category).filter(Boolean),
    income: (state.budgets?.income || []).map(r => r.category).filter(Boolean),
    bills: (state.bills || []).filter(b => b.name), debts: (state.debts || []).filter(d => d.name), goals: (state.sinkingFunds || []).filter(g => g.name)
  };
}
let _biUncat = null;
const biIsUncat = c => !c || (_biUncat || (_biUncat = new Set(Object.values(TRANSLATIONS).map(x => x && x.qa_uncat).filter(Boolean)))).has(c);
// A name inside a description, word for word: "Netflix" in "Netflix.com".
function biNameIn(name, text) {
  const n = biNorm(name);
  if (n.length < 3) return false;
  return (' ' + text + ' ').includes(' ' + n + ' ') || (n.length >= 5 && text.replace(/ /g, '').includes(n.replace(/ /g, '')));
}
function biKindCategory(kind, list) {
  const re = BI_KIND_CATS[kind];
  return re ? list.find(c => re.test(biNorm(c))) || '' : '';
}
// What this person has called each shop before, most often.
function biHistory() {
  const m = new Map();
  (state.transactions || []).forEach(tx => {
    if (!tx.description || biIsUncat(tx.category)) return;
    if (tx.type !== 'expense' && tx.type !== 'income') return;
    const k = tx.type + '|' + biKey(biClean(tx.description).name);
    const c = m.get(k) || {}; c[tx.category] = (c[tx.category] || 0) + 1; m.set(k, c);
  });
  const best = new Map();
  m.forEach((c, k) => best.set(k, Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]));
  return best;
}
function biClassify(rows, opts) {
  const C = biCats(), hist = biHistory();
  const existing = (state.transactions || []).map(tx => ({ date: tx.date, amount: biRound(tx.amount), inbound: tx.type === 'income' }));
  const dayDiff = (a, b) => Math.abs((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000);
  const items = rows.map(r => {
    const amount = opts.flip ? -r.amount : r.amount;
    const cl = biClean(r.raw);
    const text = biNorm(r.full || r.raw) + ' ' + biNorm(cl.name);
    const it = { id: 'bi' + r.line, line: r.line, date: r.date, amount: Math.abs(amount), inbound: amount > 0, desc: cl.name, brand: cl.brand, kind: cl.kind,
      type: amount > 0 ? 'income' : 'expense', category: C.uncat, how: 'review', checked: true, flags: [], bankCat: r.bankCat, kindHint: r.kindHint };
    // Between the person's own accounts: not spending, so left out.
    const tHint = /(^| )(topup|top up|exchange|pot transfer|pot|transfer between|internal|savings transfer|account transfer|acct xfer)( |$)/.test(r.kindHint || '');
    if (BI_CARD_PAYMENT.test(text)) {
      const debt = C.debts.find(d => biNameIn(d.name, text) || /card|credit|karte|carte|tarjeta|carta|karta/.test(biNorm(d.name)));
      if (debt && !it.inbound) { Object.assign(it, { type: 'debt', category: debt.name, how: 'debt' }); return it; }
      Object.assign(it, { type: 'transfer', category: '', how: 'transfer', checked: false }); return it;
    }
    if (BI_TRANSFER.test(text) || tHint) {
      const goal = C.goals.find(g => biNameIn(g.name, text));
      if (goal && !it.inbound) { Object.assign(it, { type: 'sinking_fund', category: goal.name, how: 'goal' }); return it; }
      Object.assign(it, { type: 'transfer', category: '', how: 'transfer', checked: false }); return it;
    }
    if (!it.inbound) {
      const bill = C.bills.find(b => biNameIn(b.name, text));
      if (bill) { Object.assign(it, { type: 'bill', category: bill.name, how: 'bill' }); return it; }
      const debt = C.debts.find(d => biNameIn(d.name, text));
      if (debt) { Object.assign(it, { type: 'debt', category: debt.name, how: 'debt' }); return it; }
      const goal = C.goals.find(g => biNameIn(g.name, text));
      if (goal) { Object.assign(it, { type: 'sinking_fund', category: goal.name, how: 'goal' }); return it; }
    }
    if (it.inbound && BI_REFUND.test(text)) it.flags.push('refund');
    const list = it.inbound ? C.income : C.expense;
    const learned = hist.get(it.type + '|' + biKey(it.desc));
    if (learned && list.includes(learned)) { Object.assign(it, { category: learned, how: 'learned' }); return it; }
    const named = list.find(c => biNorm(c).length >= 3 && biNameIn(c, text));
    if (named) { Object.assign(it, { category: named, how: 'suggested' }); return it; }
    if (r.bankCat) {
      const direct = list.find(c => biNorm(c) === biNorm(r.bankCat));
      const viaKind = Object.keys(BI_KIND_CATS).map(k => BI_KIND_CATS[k].test(biNorm(r.bankCat)) ? biKindCategory(k, list) : '').find(Boolean);
      if (direct || viaKind) { Object.assign(it, { category: direct || viaKind, how: 'suggested' }); return it; }
    }
    if (it.inbound) {
      if (BI_SALARY.test(text)) { const c = biKindCategory('salary', list) || (list.length === 1 ? list[0] : ''); if (c) { Object.assign(it, { category: c, how: 'suggested' }); return it; } }
    } else if (cl.kind) {
      const c = biKindCategory(cl.kind, list);
      if (c) { Object.assign(it, { category: c, how: 'suggested' }); return it; }
    }
    return it;
  });
  // Already in the planner: the same day and amount is certain, a few days
  // apart with the same amount is likely (a bank posts a day or two later).
  items.forEach(it => {
    if (it.type === 'transfer') return;
    const same = existing.find(e => e.date === it.date && Math.abs(e.amount - it.amount) < 0.005 && e.inbound === it.inbound);
    if (same) { it.dupe = 'exact'; it.checked = false; return; }
    const near = existing.find(e => Math.abs(e.amount - it.amount) < 0.005 && e.inbound === it.inbound && dayDiff(e.date, it.date) <= 3);
    if (near) { it.dupe = 'near'; it.dupeDate = near.date; it.checked = false; }
  });
  // The same line twice in the file is usually two real purchases, so both
  // stay in, marked so it can be checked.
  const seen = new Map();
  items.forEach(it => { const k = `${it.date}|${it.amount}|${it.inbound}|${biNorm(it.desc)}`; if (seen.has(k)) it.flags.push('twice'); else seen.set(k, it); });
  // A transfer usually shows as a pair: out of one account and into another
  // on the same day or near it. A matching pair is both a transfer.
  items.forEach(a => {
    if (a.type === 'transfer' || a.inbound) return;
    const b = items.find(x => x !== a && x.inbound && x.type !== 'transfer' && Math.abs(x.amount - a.amount) < 0.005 && dayDiff(x.date, a.date) <= 2 && (BI_TRANSFER.test(biNorm(x.desc)) || (!!a.desc && biNorm(x.desc) === biNorm(a.desc))));
    if (b) [a, b].forEach(x => Object.assign(x, { type: 'transfer', category: '', how: 'transfer', checked: false }));
  });
  return items;
}

// ── Ezzo, for the categories still unknown ───────────────────────────────
function biEzzoReady() { try { return typeof pennyIsActive === 'function' && pennyIsActive() && typeof pennyStreamWithFallback === 'function'; } catch (e) { return false; } }
async function biAskEzzo(items) {
  const C = biCats();
  const open = items.filter(it => (it.type === 'expense' || it.type === 'income') && it.how === 'review' && it.desc);
  const uniq = [], key = it => (it.inbound ? 'in' : 'out') + '|' + biNorm(it.desc);
  const seen = new Map();
  open.forEach(it => { const k = key(it); if (!seen.has(k)) { seen.set(k, uniq.length); uniq.push({ n: it.desc, d: it.inbound ? 'in' : 'out', b: it.bankCat || undefined }); } });
  if (!uniq.length || (!C.expense.length && !C.income.length)) return { asked: 0, sorted: 0 };
  const answers = new Map();
  for (let s = 0; s < uniq.length; s += BI_EZZO_BATCH) {
    const batch = uniq.slice(s, s + BI_EZZO_BATCH).map((x, i) => ({ i: s + i, ...x }));
    let text = '';
    await pennyStreamWithFallback({
      systemInstruction: { parts: [{ text: 'You sort bank transactions into a person\'s own budget categories. You are given their spending categories ("out"), their income categories ("in"), and a list of shops or payees. Each item has an index i, a name n, a direction d ("out" for money spent, "in" for money received) and sometimes the bank\'s own category b. For each item choose the single best category from the list that matches its direction, copied exactly as written, or null when none fits well. Never invent a category and never use one from the other direction. Reply with JSON only, no other text: {"r":[{"i":0,"c":"Groceries"}]}' }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify({ out: C.expense, in: C.income, items: batch }) }] }],
      generationConfig: { maxOutputTokens: 4096, temperature: 0.1 }
    }, chunk => {
      const cand = chunk.candidates && chunk.candidates[0];
      for (const part of (cand && cand.content && cand.content.parts) || []) if (part.text) text += part.text;
    });
    const m = /\{[\s\S]*\}/.exec(text.replace(/```(json)?/g, ''));
    let parsed = null; try { parsed = m ? JSON.parse(m[0]) : null; } catch (e) { parsed = null; }
    ((parsed && parsed.r) || []).forEach(x => { if (x && Number.isInteger(x.i) && typeof x.c === 'string') answers.set(x.i, x.c); });
  }
  const placed = new Set();
  open.forEach(it => {
    const k = seen.get(key(it)), c = answers.get(k);
    const list = it.inbound ? C.income : C.expense;
    if (c && list.includes(c)) { it.category = c; it.how = 'ezzo'; placed.add(k); }
  });
  return { asked: uniq.length, sorted: placed.size };
}

// ── The review ───────────────────────────────────────────────────────────
let _bi = null;
function biPickFile(opts) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.csv,.txt,.pdf,text/csv,text/plain,application/pdf'; inp.style.display = 'none';
  inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; inp.remove(); if (f) openBankImport(f, opts); });
  document.body.appendChild(inp); inp.click();
}
async function openBankImport(file, opts) {
  const o = opts || {};
  let head8 = '';
  try { head8 = new TextDecoder('latin1').decode(await file.slice(0, 1024).arrayBuffer()); } catch (e) {}
  if (/\.pdf$/i.test(file.name || '') || /%PDF-/.test(head8)) { biOpenPdf(file, o); return; }
  if (file.size > BI_MAX_BYTES) { biAlert(t('bi_err_big')); return; }
  let text = '';
  try { text = biDecode(await file.arrayBuffer()); } catch (e) { biAlert(t('bi_err_type')); return; }
  if (!text.trim() || /^\s*(PK\u0003|<\?xml|<html|\{)/i.test(text)) { biAlert(t('bi_err_type')); return; }
  const all = biParseCsv(text, biDelimiter(text));
  if (!all.length) { biAlert(t('bi_err_empty')); return; }
  biStartFromRows(all, file.name, o, { source: 'csv' });
}
// Rows from either reader go the same way from here.
function biStartFromRows(all, name, o, extra) {
  const x = extra || {};
  // The planner's own export goes back in exactly as it came out.
  const head0 = (all[0] || []).map(biNorm);
  if (head0[0] === 'date' && head0[1] === 'type' && head0[2] === 'category' && head0[3] === 'amount') { biImportOwnExport(all); return; }
  const h = biFindHeader(all);
  const head = h >= 0 ? all[h] : null;
  const body = (h >= 0 ? all.slice(h + 1) : all).slice(0, BI_MAX_ROWS);
  const map = head ? biMapFromHeader(head, body) : biMapFromContent(body);
  _bi = { file: name, head, body, map, dateOrder: 'auto', flip: null, items: [], skipped: [], tab: 'all', shown: BI_PAGE,
    useEzzo: o.via === 'ezzo' ? true : biEzzoReady(), via: o.via || 'tx', ezzo: { state: 'idle' },
    source: x.source || 'csv', pdfFile: x.file || null, opts: o, statement: x.statement || null };
  // A statement's own opening and closing balance, when the PDF printed them.
  const st = x.statement;
  if (st && st.start != null && st.end != null) { _bi.recStart = String(st.start); _bi.recEnd = String(st.end); _bi.recOpen = true; }
  biRun();
  biRender();
  if (_bi.useEzzo && biEzzoReady()) biRunEzzo();
  if (_bi.via === 'ezzo') biChatSay('found');
}
// Read, sort and check again from the column choices.
function biRun() {
  const b = _bi;
  b.ok = b.map.date != null && (b.map.amount != null || b.map.debit != null || b.map.credit != null) && (b.map.desc != null || b.map.payee != null);
  if (!b.ok) { b.items = []; b.skipped = []; b.recon = null; return; }
  const built = biBuildRows(b);
  b.order = built.order;
  b.signedByBalance = biSignFromBalance(built.rows, b.statement);
  if (b.flip === null) { b.flip = biDetectFlip(built.rows, b.map); b.autoFlip = b.flip; }
  // The balance follows the bank's own signs, so it is checked on those;
  // money in and out are then said the right way round.
  b.recon = biReconcile(built.rows);
  if (b.flip) { const r = b.recon; Object.assign(r, { inSum: r.outSum, outSum: r.inSum, net: -r.net }); }
  b.items = biClassify(built.rows, { flip: b.flip });
  b.skipped = built.skipped;
  b.ezzo = b.ezzo.state === 'running' ? b.ezzo : { state: 'idle' };
}
async function biRunEzzo() {
  const b = _bi; if (!b) return;
  if (!b.items.some(it => (it.type === 'expense' || it.type === 'income') && it.how === 'review' && it.desc)) { b.ezzo = { state: 'none' }; biRender(); return; }
  b.ezzo = { state: 'running', n: new Set(b.items.filter(it => it.how === 'review' && it.desc && (it.type === 'expense' || it.type === 'income')).map(it => biNorm(it.desc))).size };
  biRender();
  try {
    const r = await biAskEzzo(b.items);
    if (_bi !== b) return;
    b.ezzo = { state: 'done', ...r };
  } catch (e) {
    if (_bi !== b) return;
    b.ezzo = { state: 'failed', kind: typeof pennyClassifyHttpError === 'function' ? pennyClassifyHttpError(e) : 'unknown' };
  }
  biRender();
  if (b.via === 'ezzo') biChatSay('sorted');
}
const biCounts = items => ({
  ready: items.filter(it => it.checked && it.type !== 'transfer').length,
  dupe: items.filter(it => it.dupe).length,
  transfer: items.filter(it => it.type === 'transfer').length,
  review: items.filter(it => it.type !== 'transfer' && !it.dupe && (it.type === 'expense' || it.type === 'income') && biIsUncat(it.category)).length
});
function biTrialRoom() {
  if (typeof isTrial !== 'function' || !isTrial()) return Infinity;
  return Math.max(0, TRIAL_LIMITS.transactions - trialCount('transaction', state.transactions.length));
}
function biRender() {
  const b = _bi; if (!b) return;
  const C = biCats(), cnt = biCounts(b.items), room = biTrialRoom();
  const pStart = state.settings.periodStart, pEnd = state.settings.periodEnd;
  const outside = b.items.filter(it => it.checked && it.type !== 'transfer' && (it.date < pStart || it.date > pEnd)).length;
  const colOpts = cur => `<option value="">${esc(t('bi_col_none'))}</option>` + (b.head || (b.body[0] || []).map((_, i) => `${t('bi_col_n')} ${i + 1}`)).map((h, i) => `<option value="${i}"${cur === i ? ' selected' : ''}>${esc(h || `${t('bi_col_n')} ${i + 1}`)}</option>`).join('');
  const mapField = (role, label) => `<label class="bi-map-f"><span>${esc(label)}</span><select class="select select-sm" data-bi-map="${role}">${colOpts(b.map[role])}</select></label>`;
  const typeOpts = it => [['expense', t('tx_type_expense')], ['income', t('tx_type_income')]]
    .concat(C.bills.length ? [['bill', t('tx_type_bill')]] : []).concat(C.debts.length ? [['debt', t('tx_type_debt')]] : []).concat(C.goals.length ? [['sinking_fund', t('tx_type_sinking_fund')]] : [])
    .concat([['transfer', t('bi_type_transfer')]])
    .map(([v, l]) => `<option value="${v}"${it.type === v ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const catList = it => it.type === 'expense' ? C.expense.concat([C.uncat]) : it.type === 'income' ? C.income.concat([C.uncat])
    : it.type === 'bill' ? C.bills.map(x => x.name) : it.type === 'debt' ? C.debts.map(x => x.name) : it.type === 'sinking_fund' ? C.goals.map(x => x.name) : [];
  const catOpts = it => catList(it).map(c => `<option value="${esc(c)}"${it.category === c ? ' selected' : ''}>${esc(c)}</option>`).join('');
  const tag = it => {
    if (it.dupe === 'exact') return `<span class="bi-tag bi-tag--dupe">${esc(t('bi_tag_dupe'))}</span>`;
    if (it.dupe === 'near') return `<span class="bi-tag bi-tag--dupe">${esc(tf('bi_tag_maybe', formatDateShort(it.dupeDate)))}</span>`;
    if (it.type === 'transfer') return `<span class="bi-tag bi-tag--transfer">${esc(t('bi_tag_transfer'))}</span>`;
    if ((it.type === 'expense' || it.type === 'income') && biIsUncat(it.category)) return `<span class="bi-tag bi-tag--review">${esc(t('bi_tag_review'))}</span>`;
    const k = { learned: 'bi_tag_learned', bill: 'bi_tag_bill', debt: 'bi_tag_debt', goal: 'bi_tag_goal', ezzo: 'bi_tag_ezzo', suggested: 'bi_tag_suggested', manual: 'bi_tag_manual' }[it.how];
    return k ? `<span class="bi-tag bi-tag--${it.how}">${esc(t(k))}</span>` : '';
  };
  const filt = { all: () => true, review: it => it.type !== 'transfer' && !it.dupe && (it.type === 'expense' || it.type === 'income') && biIsUncat(it.category), dupe: it => !!it.dupe, transfer: it => it.type === 'transfer' }[b.tab] || (() => true);
  const list = b.items.filter(filt);
  const rows = list.slice(0, b.shown).map(it => `
    <div class="bi-row${it.checked ? '' : ' is-off'}${it.inbound ? ' is-in' : ''}" data-bi-row="${it.id}">
      <label class="check-label bi-c-check"><input type="checkbox" data-bi-check="${it.id}"${it.checked ? ' checked' : ''}${it.type === 'transfer' ? '' : ''} aria-label="${esc(t('bi_include'))}"><span class="checkmark checkmark--sm"></span></label>
      <span class="bi-c-date">${esc(formatDateShort(it.date))}<small>${esc(it.date.slice(0, 4))}</small></span>
      <input class="input input-sm bi-c-desc" type="text" value="${esc(it.desc)}" data-bi-desc="${it.id}" maxlength="80" placeholder="${esc(t('bi_no_desc'))}" aria-label="${esc(t('tx_th_desc'))}">
      <span class="bi-c-amt ${it.inbound ? 'is-in' : 'is-out'}">${it.inbound ? '+' : '−'}${fmt(it.amount)}</span>
      <select class="select select-sm bi-c-type" data-bi-type="${it.id}" aria-label="${esc(t('tx_type'))}">${typeOpts(it)}</select>
      <select class="select select-sm bi-c-cat" data-bi-cat="${it.id}" aria-label="${esc(t('tx_category'))}"${it.type === 'transfer' ? ' disabled' : ''}>${it.type === 'transfer' ? `<option>${esc(t('bi_left_out'))}</option>` : catOpts(it)}</select>
      <span class="bi-c-tag">${tag(it)}${it.flags.includes('twice') ? `<span class="bi-tag bi-tag--twice">${esc(t('bi_tag_twice'))}</span>` : ''}${it.flags.includes('refund') ? `<span class="bi-tag">${esc(t('bi_tag_refund'))}</span>` : ''}</span>
    </div>`).join('');
  const r = b.recon;
  const reconHtml = !r ? '' : r.hasBalance
    ? (Math.abs(r.diff) < 0.011 && !r.broken.length
      ? `<div class="bi-recon is-ok">${BI_TICK}<span>${esc(tf('bi_rec_ok', fmt(r.opening), fmt(r.closing)))}</span></div>`
      : `<div class="bi-recon is-off">${BI_WARN}<span>${esc(tf('bi_rec_off', fmt(Math.abs(r.diff) || 0), r.broken.length))}</span></div>`)
    : `<div class="bi-recon">${BI_INFO}<span>${esc(tf('bi_rec_none', fmt(r.inSum), fmt(r.outSum), (r.net < 0 ? '−' : '') + fmt(Math.abs(r.net))))}</span>
        <button class="link-btn bi-rec-open" type="button" data-bi-rec-open>${esc(t('bi_rec_check'))}</button></div>
       <div class="bi-rec-form" ${b.recOpen ? '' : 'hidden'}><label><span>${esc(t('bi_rec_start'))}</span><input class="input input-sm" type="text" inputmode="decimal" data-bi-rec="start" value="${esc(b.recStart || '')}"></label>
        <label><span>${esc(t('bi_rec_end'))}</span><input class="input input-sm" type="text" inputmode="decimal" data-bi-rec="end" value="${esc(b.recEnd || '')}"></label><span class="bi-rec-result" id="biRecResult"></span></div>`;
  const ez = b.ezzo || {};
  const ezzoHtml = !b.ok ? '' : biEzzoReady()
    ? `<div class="bi-ezzo">
        <span class="ez-avatar bi-ez-av" aria-hidden="true">${typeof PENNY_AVATAR_SVG === 'string' ? PENNY_AVATAR_SVG : ''}</span>
        <span class="bi-ez-txt">${ez.state === 'running' ? `<span class="bi-spin" aria-hidden="true"></span>${esc(tf('bi_ezzo_working', ez.n))}`
          : ez.state === 'done' ? esc(tf('bi_ezzo_done', ez.sorted, ez.asked))
          : ez.state === 'failed' ? esc(t('bi_ezzo_fail'))
          : ez.state === 'none' ? esc(t('bi_ezzo_none'))
          : esc(t('bi_ezzo_offer'))}<small>${esc(t('bi_ezzo_note'))}</small></span>
        ${ez.state === 'running' || ez.state === 'done' || ez.state === 'none' ? '' : `<button class="btn btn-ghost btn-sm" type="button" data-bi-ezzo>${esc(t('bi_ezzo_btn'))}</button>`}
      </div>`
    : `<div class="bi-ezzo is-off"><span class="bi-ez-txt">${esc(t('bi_ezzo_off'))}</span></div>`;
  const skippedHtml = b.skipped.length ? `<details class="bi-skipped"><summary>${esc(tf('bi_skipped_n', b.skipped.length))}</summary><ul>${b.skipped.slice(0, 50).map(s => `<li><b>${esc(t('bi_skip_' + s.reason))}</b> ${esc([s.date, s.desc, s.amount].filter(Boolean).join(' · '))}</li>`).join('')}</ul></details>` : '';
  const addN = Math.min(cnt.ready, room);
  document.getElementById('modalTitle').innerHTML = `<span class="af-eyebrow">${esc(b.file)}</span>${esc(t('bi_title'))}`;
  document.getElementById('modalBody').innerHTML = `<div class="bi">
    <p class="bi-private">${BI_LOCK}<span>${esc(t('bi_private'))}</span></p>
    <details class="bi-map"${b.ok ? '' : ' open'}>
      <summary><span>${esc(t('bi_map_title'))}</span><em>${esc(b.ok ? t('bi_map_change') : t('bi_err_cols'))}</em></summary>
      <div class="bi-map-grid">
        ${mapField('date', t('bi_col_date'))}${mapField('desc', t('bi_col_desc'))}
        ${b.map.debit != null || b.map.credit != null ? mapField('debit', t('bi_col_out')) + mapField('credit', t('bi_col_in')) : mapField('amount', t('bi_col_amount'))}
        ${mapField('balance', t('bi_col_balance'))}
        <label class="bi-map-f"><span>${esc(t('bi_date_order'))}</span><select class="select select-sm" data-bi-order>${['auto', 'dmy', 'mdy', 'ymd'].map(k => `<option value="${k}"${b.dateOrder === k ? ' selected' : ''}>${esc(t('bi_date_' + k))}${k === 'auto' && b.order ? ` (${esc(t('bi_date_' + b.order))})` : ''}</option>`).join('')}</select></label>
        <label class="automate-row bi-flip"><span class="automate-row-text"><span class="automate-row-title">${esc(t('bi_flip'))}</span></span>
          <span class="recurring-toggle"><input type="checkbox" data-bi-flip${b.flip ? ' checked' : ''}><span class="rec-toggle-track"></span></span></label>
      </div>
    </details>
    ${b.ok ? `
    ${b.source === 'pdf' ? `<p class="bi-note">${BI_INFO}<span>${esc(t('bi_pdf_note_local'))}</span>${biEzzoReady() ? `<button class="link-btn bi-rec-open" type="button" data-bi-pdf-ezzo>${esc(t('bi_pdf_ezzo_retry'))}</button>` : ''}</p>` : ''}
    ${b.source === 'pdf-ezzo' ? `<p class="bi-note">${BI_INFO}<span>${esc(t('bi_pdf_note_ezzo'))}</span></p>` : ''}
    ${b.autoFlip ? `<p class="bi-note">${BI_INFO}<span>${esc(t('bi_flip_auto'))}</span></p>` : ''}
    ${reconHtml}
    ${ezzoHtml}
    <div class="bi-tabs" role="tablist">${[['all', t('bi_tab_all'), b.items.length], ['review', t('bi_s_review'), cnt.review], ['dupe', t('bi_s_dupe'), cnt.dupe], ['transfer', t('bi_s_transfer'), cnt.transfer]]
      .map(([k, l, n]) => `<button class="bi-tab${b.tab === k ? ' is-on' : ''}" type="button" role="tab" aria-selected="${b.tab === k}" data-bi-tab="${k}">${esc(l)}<b>${n}</b></button>`).join('')}</div>
    <div class="bi-table">
      <div class="bi-head"><span></span><span>${esc(t('tx_date'))}</span><span>${esc(t('tx_th_desc'))}</span><span>${esc(t('tx_th_amount'))}</span><span>${esc(t('tx_type'))}</span><span>${esc(t('tx_category'))}</span><span></span></div>
      ${rows || `<p class="bi-empty">${esc(t('bi_none_here'))}</p>`}
      ${list.length > b.shown ? `<button class="btn btn-ghost btn-sm bi-more" type="button" data-bi-more>${esc(tf('bi_more', Math.min(BI_PAGE, list.length - b.shown)))}</button>` : ''}
    </div>
    ${skippedHtml}
    ${outside ? `<p class="bi-note">${BI_INFO}<span>${esc(tf('bi_outside', outside))}</span></p>` : ''}
    ${state.allocation?.enabled ? `<p class="bi-note">${BI_INFO}<span>${esc(t('bi_alloc'))}</span></p>` : ''}
    ${room < cnt.ready ? `<p class="bi-note bi-note--trial">${BI_INFO}<span>${esc(tf('bi_trial', room))}</span></p>` : ''}` : `<p class="bi-note bi-note--warn">${BI_WARN}<span>${esc(t('bi_err_cols'))}</span></p>`}
    <div class="bi-actions">
      <button class="btn btn-ghost" type="button" data-bi-cancel>${esc(t('cancel'))}</button>
      <button class="btn btn-primary" type="button" data-bi-add${addN > 0 ? '' : ' disabled'}>${esc(addN === 1 ? t('bi_add_1') : tf('bi_add_n', addN))}</button>
    </div>
  </div>`;
  document.getElementById('tutorialOverlay').hidden = false;
  biWire();
}
const BI_TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const BI_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 21 19.5H3z"/><path d="M12 10v4"/><path d="M12 17h.01"/></svg>';
const BI_INFO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/></svg>';
const BI_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.4"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>';
function biItem(id) { return _bi && _bi.items.find(it => it.id === id); }
function biWire() {
  const root = document.querySelector('#modalBody .bi'); if (!root) return;
  const b = _bi;
  root.querySelectorAll('[data-bi-map]').forEach(s => s.addEventListener('change', () => {
    const v = s.value === '' ? null : Number(s.value);
    if (v == null) delete b.map[s.dataset.biMap]; else b.map[s.dataset.biMap] = v;
    b.flip = null; biRun(); biRender(); if (b.useEzzo && biEzzoReady()) biRunEzzo();
  }));
  root.querySelector('[data-bi-order]')?.addEventListener('change', e => { b.dateOrder = e.target.value; biRun(); biRender(); });
  root.querySelector('[data-bi-flip]')?.addEventListener('change', e => { b.flip = e.target.checked; b.autoFlip = false; biRun(); biRender(); if (b.useEzzo && biEzzoReady()) biRunEzzo(); });
  root.querySelectorAll('[data-bi-tab]').forEach(x => x.addEventListener('click', () => { b.tab = x.dataset.biTab; b.shown = BI_PAGE; biRender(); }));
  root.querySelector('[data-bi-more]')?.addEventListener('click', () => { b.shown += BI_PAGE; biRender(); });
  root.querySelector('[data-bi-ezzo]')?.addEventListener('click', () => { b.useEzzo = true; biRunEzzo(); });
  root.querySelector('[data-bi-rec-open]')?.addEventListener('click', () => { b.recOpen = !b.recOpen; biRender(); });
  root.querySelectorAll('[data-bi-rec]').forEach(inp => inp.addEventListener('input', () => {
    if (inp.dataset.biRec === 'start') b.recStart = inp.value; else b.recEnd = inp.value;
    biRecCheck();
  }));
  biRecCheck();
  root.querySelectorAll('[data-bi-check]').forEach(cb => cb.addEventListener('change', () => { const it = biItem(cb.dataset.biCheck); if (it) { it.checked = cb.checked; biRender(); } }));
  root.querySelectorAll('[data-bi-desc]').forEach(inp => inp.addEventListener('change', () => { const it = biItem(inp.dataset.biDesc); if (it) it.desc = inp.value.trim(); }));
  root.querySelectorAll('[data-bi-type]').forEach(sel => sel.addEventListener('change', () => {
    const it = biItem(sel.dataset.biType); if (!it) return;
    it.type = sel.value; it.how = 'manual';
    const C = biCats();
    const first = { expense: C.uncat, income: C.uncat, bill: C.bills[0]?.name, debt: C.debts[0]?.name, sinking_fund: C.goals[0]?.name, transfer: '' }[it.type];
    if (it.type === 'transfer') it.checked = false; else if (!it.dupe) it.checked = true;
    if (it.type === 'expense' || it.type === 'income') it.inbound = it.type === 'income';
    it.category = first || '';
    biRender();
  }));
  // A category chosen for one row goes to every other row from the same
  // place that has not been chosen by hand.
  root.querySelectorAll('[data-bi-cat]').forEach(sel => sel.addEventListener('change', () => {
    const it = biItem(sel.dataset.biCat); if (!it) return;
    it.category = sel.value; it.how = 'manual';
    let n = 0;
    if (it.desc) b.items.forEach(x => { if (x !== it && x.how !== 'manual' && x.type === it.type && biNorm(x.desc) === biNorm(it.desc)) { x.category = sel.value; x.how = 'manual'; n++; } });
    biRender();
    if (n) showToast(tf('bi_applied_same', n, it.desc));
  }));
  root.querySelector('[data-bi-cancel]')?.addEventListener('click', () => { _bi = null; closeModal(); });
  root.querySelector('[data-bi-pdf-ezzo]')?.addEventListener('click', () => { const f = b.pdfFile, o = b.opts || {}; _bi = null; biPdfAskEzzo(f, o, t('bi_pdf_retry_lead')); });
  root.querySelector('[data-bi-add]')?.addEventListener('click', biCommit);
}
function biRecCheck() {
  const b = _bi, out = document.getElementById('biRecResult'); if (!b || !out) return;
  const mark = biDecimalMark([b.recStart, b.recEnd]);
  const s = biAmount(b.recStart, mark), e = biAmount(b.recEnd, mark);
  if (isNaN(s) || isNaN(e)) { out.textContent = ''; out.className = 'bi-rec-result'; return; }
  const diff = biRound(e - (s + b.recon.net));
  out.className = 'bi-rec-result ' + (Math.abs(diff) < 0.011 ? 'is-ok' : 'is-off');
  out.textContent = Math.abs(diff) < 0.011 ? t('bi_rec_match') : tf('bi_rec_diff', fmt(Math.abs(diff)));
}
function biCommit() {
  const b = _bi; if (!b) return;
  const room = biTrialRoom();
  const take = b.items.filter(it => it.checked && it.type !== 'transfer');
  const chosen = take.slice(0, room);
  const pre = new Set(state.transactions.map(x => x.id));
  const saveB = state.allocation?.enabled ? (state.allocation.buckets || []).find(x => x.id === 'save') : null;
  const batch = 'imp' + Date.now().toString(36);
  chosen.forEach(it => {
    const tx = { id: uid(), date: it.date, type: it.type, category: it.category || t('qa_uncat'), amount: biRound(it.amount), description: it.desc || '', importId: batch };
    if (tx.type === 'sinking_fund' && saveB) tx.allocation = saveB.id;
    state.transactions.push(tx);
    applySinkingFundDelta(tx, +1);
    if (tx.type === 'bill') { const bill = (state.bills || []).find(x => x.name === tx.category); if (bill) setRowPayments(bill, [...rowPayTxIds(bill), tx.id]); }
  });
  if (chosen.length) trialUse('transaction', chosen.length);
  saveState();
  _justAdded = state.transactions.filter(x => !pre.has(x.id)).map(x => x.id);
  const review = chosen.filter(it => (it.type === 'expense' || it.type === 'income') && biIsUncat(it.category)).length;
  const via = b.via;
  _bi = null;
  closeModal();
  try { trackEvent('feature_used', { feature: 'bank_import', rows: chosen.length }); } catch (e) {}
  dispatchRender(currentTab);
  showUndoToast(chosen.length === 1 ? t('bi_done_1') : tf('bi_done_n', chosen.length));
  if (via === 'ezzo') biChatSay('added', { n: chosen.length, review });
  if (take.length > chosen.length) setTimeout(() => showUpgradeModal({ reason: 'transaction' }), 700);
}
// The planner's own export, read back the way it always was.
function biImportOwnExport(all) {
  const pre = new Set(state.transactions.map(x => x.id));
  const TYPES = new Set(['income', 'expense', 'bill', 'savings', 'debt', 'subscription', 'sinking_fund']);
  let n = 0, limit = false;
  for (let i = 1; i < all.length; i++) {
    if (trialBlocks('transaction')) { limit = true; break; }
    const [date, type, category, amtStr, desc = '', alloc = ''] = all[i];
    const amount = parseFloat(amtStr);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !TYPES.has(type) || !category || isNaN(amount) || amount <= 0) continue;
    const tx = { id: uid(), date, type, category, amount, description: desc };
    if (alloc) tx.allocation = alloc;
    applySinkingFundDelta(tx, +1); state.transactions.push(tx); trialUse('transaction'); n++;
  }
  saveState(); dispatchRender(currentTab);
  if (n) { _justAdded = state.transactions.filter(x => !pre.has(x.id)).map(x => x.id); showUndoToast(tf('toast_imported', n)); }
  else showToast(t('bi_err_empty'));
  if (limit) showUpgradeModal({ reason: 'transaction' });
}
function biAlert(msg) { try { alertDialog(msg); } catch (e) { showToast(msg); } }

// ── PDF statements ───────────────────────────────────────────────────────
const BI_PDF_MAX_BYTES = 15 * 1024 * 1024;
const BI_PDF_EZZO_MAX_BYTES = 10 * 1024 * 1024;
const BI_PDFJS_VER = '3.11.174';
let _biPdfLib = null;
// pdf.js is only fetched the first time a PDF is chosen.
function biLoadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (_biPdfLib) return _biPdfLib;
  _biPdfLib = new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = 'vendor/pdfjs/pdf.min.js?v=' + BI_PDFJS_VER;
    sc.onload = () => {
      if (!window.pdfjsLib) { _biPdfLib = null; rej(new Error('pdfjs')); return; }
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js?v=' + BI_PDFJS_VER;
      res(window.pdfjsLib);
    };
    sc.onerror = () => { _biPdfLib = null; sc.remove(); rej(new Error('pdfjs')); };
    document.head.appendChild(sc);
  });
  return _biPdfLib;
}
function biSheet(html) {
  document.getElementById('modalTitle').innerHTML = esc(t('bi_title'));
  document.getElementById('modalBody').innerHTML = `<div class="bi bi-sheet">${html}</div>`;
  document.getElementById('tutorialOverlay').hidden = false;
}
const biWaiting = msg => `<div class="bi-wait"><span class="bi-spin" aria-hidden="true"></span><span>${esc(msg)}</span></div>`;
// A protected statement: the password goes to pdf.js on this device only.
function biAskPassword(wrong) {
  return new Promise(resolve => {
    biSheet(`<p class="bi-lead"><b>${esc(t('bi_pdf_pw_title'))}</b><span>${esc(t('bi_pdf_pw'))}</span></p>
      ${wrong ? `<p class="bi-note bi-note--warn">${BI_WARN}<span>${esc(t('bi_pdf_pw_wrong'))}</span></p>` : ''}
      <input class="input" type="password" id="biPdfPw" autocomplete="off" aria-label="${esc(t('bi_pdf_pw_title'))}">
      <div class="bi-actions"><button class="btn btn-ghost" type="button" data-bi-pw-cancel>${esc(t('cancel'))}</button><button class="btn btn-primary" type="button" data-bi-pw-ok>${esc(t('bi_pdf_pw_open'))}</button></div>`);
    const inp = document.getElementById('biPdfPw');
    const ok = () => resolve(inp.value);
    document.querySelector('[data-bi-pw-ok]').addEventListener('click', ok);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
    document.querySelector('[data-bi-pw-cancel]').addEventListener('click', () => resolve(null));
    setTimeout(() => inp.focus(), 50);
  });
}
async function biPdfOpenDoc(lib, data) {
  let password, wrong = false;
  for (let tries = 0; tries < 6; tries++) {
    try { return await lib.getDocument({ data: data.slice(), password, isEvalSupported: false }).promise; }
    catch (e) {
      if (e && e.name === 'PasswordException') {
        password = await biAskPassword(wrong || e.code === 2);
        if (password == null) { const c = new Error('cancelled'); c.name = 'biCancelled'; throw c; }
        wrong = true;
        biSheet(biWaiting(t('bi_pdf_reading')));
        continue;
      }
      throw e;
    }
  }
  throw new Error('password');
}
async function biOpenPdf(file, o) {
  if (file.size > BI_PDF_MAX_BYTES) { biAlert(t('bi_err_big')); return; }
  biSheet(biWaiting(t('bi_pdf_reading')));
  let lib;
  try { lib = await biLoadPdfJs(); } catch (e) { biPdfAskEzzo(file, o, t('bi_pdf_lib')); return; }
  let doc;
  try { doc = await biPdfOpenDoc(lib, new Uint8Array(await file.arrayBuffer())); }
  catch (e) { if (e && e.name === 'biCancelled') { closeModal(); return; } biPdfAskEzzo(file, o, t('bi_pdf_bad')); return; }
  let lines = [];
  try {
    for (let n = 1; n <= Math.min(doc.numPages, 80); n++) {
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      lines = lines.concat(biPdfLines(tc.items || [], n));
    }
  } catch (e) { lines = []; }
  try { doc.destroy(); } catch (e) {}
  const parsed = biPdfToRows(lines);
  if (parsed && parsed.rows.length > 1) { biStartFromRows(parsed.rows, file.name, o, { source: 'pdf', statement: parsed.statement, file }); return; }
  biPdfAskEzzo(file, o, lines.length ? t('bi_pdf_none') : t('bi_pdf_scanned'));
}
// The words on a page, back into lines (by height on the page) and cells
// (a gap wider than a space starts a new one).
function biPdfLines(items, page) {
  const words = items.filter(it => it && typeof it.str === 'string' && it.str.trim())
    .map(it => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0, h: Math.abs(it.transform[3]) || it.height || 8 }));
  words.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  words.forEach(w => {
    const ln = lines.find(l => Math.abs(l.y - w.y) <= Math.max(2, w.h * 0.45));
    if (ln) ln.words.push(w); else lines.push({ y: w.y, page, words: [w] });
  });
  lines.sort((a, b) => b.y - a.y);
  return lines.map(l => {
    l.words.sort((a, b) => a.x - b.x);
    const cells = [];
    l.words.forEach(w => {
      const c = cells[cells.length - 1];
      const gap = c ? w.x - c.x1 : Infinity;
      if (c && gap < Math.max(4, w.h * 0.9)) { c.text += (gap > w.h * 0.15 && !/\s$/.test(c.text) && !/^\s/.test(w.s) ? ' ' : '') + w.s; c.x1 = Math.max(c.x1, w.x + w.w); }
      else cells.push({ text: w.s, x0: w.x, x1: w.x + w.w });
    });
    cells.forEach(c => { c.text = c.text.replace(/\s+/g, ' ').trim(); });
    return { page: l.page, y: l.y, cells: cells.filter(c => c.text), text: cells.map(c => c.text).join(' ').replace(/\s+/g, ' ').trim() };
  }).filter(l => l.cells.length);
}
const BI_PDF_NUM = /^[(+\-\u2212]?\s?(?:[$€£zł]|zł|eur|usd|gbp|pln|chf)?\s?\d{1,3}(?:[ .,'\u00a0]\d{3})*(?:[.,]\d{2})\s?(?:cr|dr|-)?\)?$|^[(+\-\u2212]?\d+[.,]\d{2}\s?(?:cr|dr|-)?\)?$/i;
const BI_PDF_OPEN = /\b(opening|previous|beginning|starting|start) balance|balance (brought forward|b\/f|at start)|alter kontostand|anfangssaldo|kontostand am .* alt|solde (precedent|initial|ancien|au debut)|ancien solde|saldo (inicial|anterior|iniziale|precedente|poczatkowe|otwarcia)/;
const BI_PDF_CLOSE = /\b(closing|new|ending|end) balance|balance (carried forward|c\/f|at end)|neuer kontostand|endsaldo|solde (final|nouveau|au)|nouveau solde|saldo (final|finale|koncowe|zamkniecia)/;
// Statements often leave the year off each line; it is the statement's own.
function biPdfYear(lines) {
  const yrs = {};
  lines.forEach(l => (l.text.match(/\b(19|20)\d{2}\b/g) || []).forEach(y => { yrs[y] = (yrs[y] || 0) + 1; }));
  const best = Object.entries(yrs).sort((a, b) => b[1] - a[1])[0];
  return best ? Number(best[0]) : new Date().getFullYear();
}
function biPdfWithYear(v, year) {
  const s = String(v || '').trim();
  if (/^\d{1,2}[\/.\-]\d{1,2}\.?$/.test(s)) return s.replace(/\.$/, '') + (s.includes('/') ? '/' : s.includes('-') ? '-' : '.') + year;
  if (/^\d{1,2}\.?\s+[a-z\u00c0-\u017f]{3,}\.?$/i.test(s) || /^[a-z\u00c0-\u017f]{3,}\.?\s+\d{1,2}$/i.test(s)) return s + ' ' + year;
  return s;
}
function biPdfToRows(lines) {
  const statement = {};
  const year = biPdfYear(lines);
  lines.forEach(l => {
    const n = biNorm(l.text);
    const lastNum = [...l.cells].reverse().map(c => c.text).find(c => BI_PDF_NUM.test(c));
    if (lastNum != null && statement.start == null && BI_PDF_OPEN.test(n)) statement.start = lastNum;
    if (lastNum != null && BI_PDF_CLOSE.test(n)) statement.end = lastNum;
  });
  const isNum = c => BI_PDF_NUM.test(c.text);
  const dateOf = text => { const w = biPdfWithYear(text, year); return biLooksDate(w) ? w : null; };
  // With a heading row: every cell goes to the column its middle sits under.
  const hIdx = lines.findIndex(l => l.cells.length >= 2 && l.cells.some(c => biColumnScore(c.text, BI_HEAD.date) >= 2) &&
    l.cells.some(c => ['amount', 'debit', 'credit'].some(k => biColumnScore(c.text, BI_HEAD[k]) >= 2)));
  const out = [];
  if (hIdx >= 0) {
    const head = lines[hIdx].cells;
    const mid = c => (c.x0 + c.x1) / 2;
    const cuts = head.slice(1).map((c, i) => (mid(head[i]) + mid(c)) / 2);
    const colOf = c => { const m = mid(c); let i = 0; while (i < cuts.length && m > cuts[i]) i++; return i; };
    const role = k => head.findIndex(c => biColumnScore(c.text, BI_HEAD[k]) >= 2);
    const dCol = role('date'), descCol = [role('desc'), role('payee')].find(i => i >= 0);
    const numCols = new Set(['amount', 'debit', 'credit', 'balance'].map(role).filter(i => i >= 0));
    const headText = biNorm(lines[hIdx].text);
    out.push(head.map(c => c.text));
    let lastDate = null;
    lines.slice(hIdx + 1).forEach(l => {
      if (biNorm(l.text) === headText) return;
      const row = head.map(() => '');
      l.cells.forEach(c => { const i = colOf(c); row[i] = row[i] ? row[i] + ' ' + c.text : c.text; });
      const hasAmt = [...numCols].some(i => i !== role('balance') && row[i] && BI_PDF_NUM.test(row[i].trim()));
      const d = dCol >= 0 ? dateOf(row[dCol]) : null;
      if (d) { row[dCol] = d; lastDate = d; }
      if (!hasAmt) {
        // A second line of the one above it.
        const prev = out[out.length - 1];
        if (out.length > 1 && !d && descCol != null && row[descCol] && !BI_SKIP_LINE.test(biNorm(l.text)) && !BI_PDF_OPEN.test(biNorm(l.text)) && !BI_PDF_CLOSE.test(biNorm(l.text))) prev[descCol] = (prev[descCol] + ' ' + row[descCol]).trim();
        return;
      }
      if (!d) { if (!lastDate) return; row[dCol] = lastDate; }   // the date printed once for the day
      out.push(row);
    });
    if (out.length > 1) return { rows: out, statement };
  }
  // No heading: a line that starts with a date and ends in amounts.
  out.length = 0;
  out.push(['Date', 'Description', 'Amount', 'Balance']);
  let last = null, lastDate = null;
  lines.forEach(l => {
    const cells = l.cells.map(c => c.text);
    let d = null, k = 0;
    for (let j = 1; j <= Math.min(3, cells.length) && !d; j++) { const cand = dateOf(cells.slice(0, j).join(' ')); if (cand) { d = cand; k = j; } }
    if (!d) { const m = /^(\d{1,2}[\/.\-]\d{1,2}(?:[\/.\-]\d{2,4})?|\d{1,2}\s+[a-z\u00c0-\u017f]{3,}\.?(?:\s+\d{2,4})?)\s+(.*)$/i.exec(l.text); if (m && dateOf(m[1])) { d = dateOf(m[1]); cells.splice(0, cells.length, m[1], ...m[2].split(/\s{2,}/)); k = 1; } }
    const nums = [];
    let rest = cells.slice(k);
    while (rest.length && BI_PDF_NUM.test(rest[rest.length - 1])) nums.unshift(rest.pop());
    const desc = rest.join(' ').trim();
    if (!nums.length) {
      if (last && !d && desc && !BI_SKIP_LINE.test(biNorm(desc)) && !BI_PDF_OPEN.test(biNorm(l.text)) && !BI_PDF_CLOSE.test(biNorm(l.text))) last[1] = (last[1] + ' ' + desc).trim();
      return;
    }
    if (!d && !lastDate) return;
    if (!desc || BI_PDF_OPEN.test(biNorm(l.text)) || BI_PDF_CLOSE.test(biNorm(l.text))) return;
    if (d) lastDate = d;
    last = [d || lastDate, desc, nums.length >= 2 ? nums[nums.length - 2] : nums[0], nums.length >= 2 ? nums[nums.length - 1] : ''];
    out.push(last);
  });
  return { rows: out, statement };
}
// Nothing could be read here (a scanned page has no words, only a picture of
// them). Ezzo can read it, but only after saying plainly what that means.
function biPdfAskEzzo(file, o, lead) {
  const can = biEzzoReady() && file && file.size <= BI_PDF_EZZO_MAX_BYTES;
  biSheet(`<p class="bi-lead"><span>${esc(lead)}</span></p>
    ${can ? `<div class="bi-consent">${BI_WARN}<span>${esc(t('bi_pdf_ezzo_warn'))}</span></div>` : `<p class="bi-note">${BI_INFO}<span>${esc(biEzzoReady() ? t('bi_err_big') : t('bi_pdf_ezzo_off'))}</span></p>`}
    <div class="bi-actions${can ? '' : ' bi-actions--one'}">
      <button class="btn btn-ghost" type="button" data-bi-close>${esc(t(can ? 'cancel' : 'close'))}</button>
      ${can ? `<button class="btn btn-primary" type="button" data-bi-ezzo-read>${esc(t('bi_pdf_ezzo_btn'))}</button>` : ''}
    </div>`);
  document.querySelector('[data-bi-close]')?.addEventListener('click', () => closeModal());
  document.querySelector('[data-bi-ezzo-read]')?.addEventListener('click', () => biEzzoReadPdf(file, o));
}
function biB64(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(file); });
}
async function biEzzoReadPdf(file, o) {
  biSheet(biWaiting(t('bi_pdf_ezzo_working')));
  let text = '';
  try {
    const data = await biB64(file);
    await pennyStreamWithFallback({
      systemInstruction: { parts: [{ text: 'You read bank and credit card statements. Return every transaction exactly as printed, oldest first. Reply with compact JSON only, no other text: {"o":opening balance as a number or null,"c":closing balance as a number or null,"r":[{"d":"YYYY-MM-DD","t":"the description as printed, leaving out account, card and reference numbers","a":-12.34,"b":the balance after it as a number, or null}]}. "a" is negative for money that left the account and positive for money that came in. Use the statement\'s own year for every date. Balance lines, totals, fees summaries and headings are not transactions.' }] },
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'application/pdf', data } }, { text: 'List every transaction in this statement.' }] }],
      generationConfig: { maxOutputTokens: 8192, temperature: 0 }
    }, chunk => {
      const cand = chunk.candidates && chunk.candidates[0];
      for (const part of (cand && cand.content && cand.content.parts) || []) if (part.text) text += part.text;
    });
  } catch (e) { biPdfAskEzzo(file, o, t('bi_pdf_ezzo_fail')); return; }
  const got = biParseEzzoRows(text);
  if (!got.rows.length) { biPdfAskEzzo(file, o, t('bi_pdf_ezzo_fail')); return; }
  const rows = [['Date', 'Description', 'Amount', 'Balance']].concat(got.rows.map(r => [r.d, r.t, String(r.a), r.b == null ? '' : String(r.b)]));
  biStartFromRows(rows, file.name, o, { source: 'pdf-ezzo', statement: { start: got.o, end: got.c }, file });
}
// Whole answer when it parses; otherwise every complete row it managed
// before running out of room.
function biParseEzzoRows(text) {
  const clean = String(text || '').replace(/```(json)?/g, '');
  const m = /\{[\s\S]*\}/.exec(clean);
  try {
    const j = m ? JSON.parse(m[0]) : null;
    if (j && Array.isArray(j.r)) return { rows: j.r.filter(biEzzoRowOk), o: typeof j.o === 'number' ? j.o : null, c: typeof j.c === 'number' ? j.c : null };
  } catch (e) {}
  const rows = [];
  (clean.match(/\{"d"\s*:\s*"[^"]*"\s*,\s*"t"\s*:\s*"(?:[^"\\]|\\.)*"\s*,\s*"a"\s*:\s*-?[\d.]+(?:\s*,\s*"b"\s*:\s*(?:-?[\d.]+|null))?\s*\}/g) || [])
    .forEach(s => { try { const r = JSON.parse(s); if (biEzzoRowOk(r)) rows.push(r); } catch (e) {} });
  const num = re => { const x = re.exec(clean); return x ? Number(x[1]) : null; };
  return { rows, o: num(/"o"\s*:\s*(-?[\d.]+)/), c: num(/"c"\s*:\s*(-?[\d.]+)/) };
}
const biEzzoRowOk = r => r && /^\d{4}-\d{2}-\d{2}$/.test(r.d || '') && typeof r.t === 'string' && typeof r.a === 'number' && isFinite(r.a);

// ── Ezzo in the chat ─────────────────────────────────────────────────────
// Ezzo tells the story of the import in the conversation; the rows
// themselves are reviewed in the sheet.
function biChatSay(kind, extra) {
  if (typeof pennyAppendMessage !== 'function' || !document.getElementById('pennyMessages')) return;
  const b = _bi;
  let text = '';
  if (kind === 'found' && b) {
    const c = biCounts(b.items);
    text = b.ok ? tf('bi_chat_found', b.items.length, c.ready, c.dupe, c.transfer, b.skipped.length) : t('bi_err_cols');
    if (b.ok && b.recon && b.recon.hasBalance) text += ' ' + (Math.abs(b.recon.diff) < 0.011 && !b.recon.broken.length ? t('bi_chat_bal_ok') : t('bi_chat_bal_off'));
  } else if (kind === 'sorted' && b) {
    const e = b.ezzo || {};
    text = e.state === 'done' ? tf('bi_chat_sorted', e.sorted, e.asked) : e.state === 'failed' ? t('bi_ezzo_fail') : '';
  } else if (kind === 'added') {
    text = extra.review ? tf('bi_chat_added_review', extra.n, extra.review) : tf('bi_chat_added', extra.n);
  }
  if (text) pennyAppendMessage('penny', text);
}

// ── Words ────────────────────────────────────────────────────────────────
const BI_WORDS = {
  en: {
    bi_no_desc: 'No description',
    bi_pdf_note_ezzo: 'Read by Ezzo from your PDF. Check the rows before adding them.',
    bi_pdf_note_local: 'Read from your PDF on this device. PDFs are harder to read than CSV files, so check the rows before adding them.',
    bi_pdf_retry_lead: 'Ezzo can read this statement for you instead.',
    bi_pdf_ezzo_retry: 'Rows look wrong? Let Ezzo read it',
    bi_pdf_ezzo_fail: 'Ezzo could not read this statement just now.',
    bi_pdf_ezzo_working: 'Ezzo is reading your statement…',
    bi_pdf_ezzo_off: 'Turn on Ezzo in Settings and it can read statements like this one.',
    bi_pdf_ezzo_warn: 'Ezzo can read it, but that sends the whole statement to Google Gemini, including your name and any account details printed on it.',
    bi_pdf_ezzo_btn: 'Let Ezzo read it',
    bi_pdf_lib: 'The PDF reader could not load. Check your connection and try again.',
    bi_pdf_bad: 'This PDF could not be opened.',
    bi_pdf_scanned: 'This PDF is a scanned picture, so there is no text on it to read on your device.',
    bi_pdf_none: 'No transactions could be read from this PDF on your device.',
    bi_pdf_pw_open: 'Open',
    bi_pdf_pw_wrong: 'That password did not open it. Try again.',
    bi_pdf_pw: 'Enter the password your bank gave you for it. It is only used on this device.',
    bi_pdf_pw_title: 'This statement is protected',
    bi_pdf_reading: 'Reading your statement…',
    bi_title: 'Import from your bank', bi_private: 'Your file is read on this device and is not kept. Account and card numbers are left out.',
    bi_err_type: 'That file could not be read. Choose the CSV or PDF statement from your bank.',
    bi_err_big: 'That file is too large. Export a shorter date range and try again.', bi_err_empty: 'No transactions were found in that file.',
    bi_err_cols: 'Choose which columns hold the date, the description and the amount.',
    bi_map_title: 'How your file is read', bi_map_change: 'Change', bi_col_date: 'Date', bi_col_desc: 'Description', bi_col_amount: 'Amount', bi_col_out: 'Money out', bi_col_in: 'Money in',
    bi_col_balance: 'Balance', bi_col_none: 'Not in this file', bi_col_n: 'Column', bi_date_order: 'Date format', bi_date_auto: 'Automatic', bi_date_dmy: 'Day, month, year',
    bi_date_mdy: 'Month, day, year', bi_date_ymd: 'Year, month, day', bi_flip: 'Spending shows as positive in this file',
    bi_flip_auto: 'Spending was shown as positive in this file, so it has been turned round.',
    bi_rec_ok: 'The balance checks out, from {0} to {1}.', bi_rec_off: 'The balance is off by {0}. {1} rows do not follow the running balance, so some may be missing from the export.',
    bi_rec_none: 'Money in {0}, money out {1}, net {2}.', bi_rec_check: 'Check against your statement', bi_rec_start: 'Starting balance', bi_rec_end: 'Ending balance',
    bi_rec_match: 'Matches your statement.', bi_rec_diff: 'Off by {0}.',
    bi_ezzo_offer: 'Ezzo can choose categories for the rest.', bi_ezzo_btn: 'Ask Ezzo', bi_ezzo_working: 'Ezzo is choosing categories for {0} places…',
    bi_ezzo_done: 'Ezzo chose categories for {0} of {1} places.', bi_ezzo_fail: 'Ezzo could not choose categories just now, so the rest are Uncategorized for you to pick.',
    bi_ezzo_none: 'Every row already has a category.', bi_ezzo_note: 'Only shop names are sent to Google Gemini. Never amounts, dates or account details.',
    bi_ezzo_off: 'Turn on Ezzo in Settings and it can choose categories for the rows that still need one.',
    bi_tab_all: 'All', bi_s_review: 'Need a category', bi_s_dupe: 'Already logged', bi_s_transfer: 'Transfers',
    bi_tag_learned: 'From your history', bi_tag_bill: 'Your bill', bi_tag_debt: 'Your debt', bi_tag_goal: 'Your goal', bi_tag_ezzo: 'Ezzo', bi_tag_suggested: 'Suggested', bi_tag_manual: 'Your choice',
    bi_tag_review: 'Uncategorized', bi_tag_dupe: 'Already in your planner', bi_tag_maybe: 'Maybe logged on {0}', bi_tag_transfer: 'Between your accounts', bi_tag_twice: 'Twice in the file', bi_tag_refund: 'Refund',
    bi_type_transfer: 'Transfer', bi_left_out: 'Left out', bi_include: 'Include this row', bi_none_here: 'Nothing here.', bi_more: 'Show {0} more',
    bi_skipped_n: '{0} lines were left out', bi_skip_date: 'No readable date', bi_skip_amount: 'No readable amount', bi_skip_desc: 'No description', bi_skip_pending: 'Pending, not final yet',
    bi_skip_failed: 'Declined or reversed', bi_skip_summary: 'A balance or total line', bi_skip_zero: 'Zero amount',
    bi_outside: '{0} are outside this budget period, so they will not change its figures.', bi_alloc: 'Budget allocation is on. Tag these on the Transactions page afterwards; they show a ? until then.',
    bi_trial: 'Your free trial can add {0} more. Unlock the full planner to add the rest.',
    bi_add_n: 'Add {0} transactions', bi_add_1: 'Add 1 transaction', bi_done_n: 'Added {0} transactions from your bank.', bi_done_1: 'Added 1 transaction from your bank.',
    bi_applied_same: 'Also set for {0} more from {1}.', bi_chip: 'Import a bank statement', bi_attach: 'Import a bank statement (CSV or PDF)',
    bi_chat_found: 'I read {0} transactions: {1} ready to add, {2} already in your planner, {3} transfers between your accounts and {4} lines left out.',
    bi_chat_bal_ok: 'The balance checks out.', bi_chat_bal_off: 'The balance does not quite add up, so some rows may be missing from the export.',
    bi_chat_sorted: 'I chose categories for {0} of {1} places. Have a look and add them when you are happy.',
    bi_chat_added: 'Done. I added {0} transactions.', bi_chat_added_review: 'Done. I added {0} transactions. {1} are Uncategorized for you to sort on the Transactions page.'
  },
  de: {
    bi_no_desc: 'Keine Beschreibung',
    bi_pdf_note_ezzo: 'Von Ezzo aus deiner PDF gelesen. Prüfe die Zeilen vor dem Hinzufügen.',
    bi_pdf_note_local: 'Auf diesem Gerät aus deiner PDF gelesen. PDFs sind schwerer zu lesen als CSV-Dateien, prüfe die Zeilen also vor dem Hinzufügen.',
    bi_pdf_retry_lead: 'Ezzo kann diesen Kontoauszug stattdessen für dich lesen.',
    bi_pdf_ezzo_retry: 'Zeilen sehen falsch aus? Ezzo lesen lassen',
    bi_pdf_ezzo_fail: 'Ezzo konnte diesen Kontoauszug gerade nicht lesen.',
    bi_pdf_ezzo_working: 'Ezzo liest deinen Kontoauszug…',
    bi_pdf_ezzo_off: 'Schalte Ezzo in den Einstellungen ein, dann kann er solche Kontoauszüge lesen.',
    bi_pdf_ezzo_warn: 'Ezzo kann ihn lesen, schickt dafür aber den ganzen Kontoauszug an Google Gemini, mit deinem Namen und allen Kontodaten darauf.',
    bi_pdf_ezzo_btn: 'Ezzo lesen lassen',
    bi_pdf_lib: 'Der PDF-Leser konnte nicht geladen werden. Prüfe deine Verbindung und versuche es erneut.',
    bi_pdf_bad: 'Diese PDF konnte nicht geöffnet werden.',
    bi_pdf_scanned: 'Diese PDF ist ein eingescanntes Bild, darauf gibt es keinen Text, der sich auf deinem Gerät lesen lässt.',
    bi_pdf_none: 'Aus dieser PDF konnten auf deinem Gerät keine Umsätze gelesen werden.',
    bi_pdf_pw_open: 'Öffnen',
    bi_pdf_pw_wrong: 'Mit diesem Passwort ließ er sich nicht öffnen. Versuche es erneut.',
    bi_pdf_pw: 'Gib das Passwort deiner Bank ein. Es wird nur auf diesem Gerät verwendet.',
    bi_pdf_pw_title: 'Dieser Kontoauszug ist geschützt',
    bi_pdf_reading: 'Dein Kontoauszug wird gelesen…',
    bi_title: 'Von deiner Bank importieren', bi_private: 'Deine Datei wird auf diesem Gerät gelesen und nicht gespeichert. Konto- und Kartennummern werden weggelassen.',
    bi_err_type: 'Diese Datei konnte nicht gelesen werden. Wähle den CSV- oder PDF-Kontoauszug deiner Bank.', bi_err_big: 'Die Datei ist zu groß. Exportiere einen kürzeren Zeitraum und versuche es erneut.',
    bi_err_empty: 'In dieser Datei wurden keine Umsätze gefunden.', bi_err_cols: 'Wähle, welche Spalten Datum, Beschreibung und Betrag enthalten.',
    bi_map_title: 'So wird deine Datei gelesen', bi_map_change: 'Ändern', bi_col_date: 'Datum', bi_col_desc: 'Beschreibung', bi_col_amount: 'Betrag', bi_col_out: 'Ausgang', bi_col_in: 'Eingang',
    bi_col_balance: 'Kontostand', bi_col_none: 'Nicht in dieser Datei', bi_col_n: 'Spalte', bi_date_order: 'Datumsformat', bi_date_auto: 'Automatisch', bi_date_dmy: 'Tag, Monat, Jahr',
    bi_date_mdy: 'Monat, Tag, Jahr', bi_date_ymd: 'Jahr, Monat, Tag', bi_flip: 'Ausgaben stehen in dieser Datei als positiv',
    bi_flip_auto: 'Ausgaben standen in dieser Datei als positiv, deshalb wurden sie umgedreht.',
    bi_rec_ok: 'Der Kontostand stimmt, von {0} bis {1}.', bi_rec_off: 'Der Kontostand weicht um {0} ab. {1} Zeilen passen nicht zum laufenden Saldo, vielleicht fehlen Umsätze im Export.',
    bi_rec_none: 'Eingang {0}, Ausgang {1}, netto {2}.', bi_rec_check: 'Mit dem Kontoauszug abgleichen', bi_rec_start: 'Anfangssaldo', bi_rec_end: 'Endsaldo',
    bi_rec_match: 'Passt zu deinem Kontoauszug.', bi_rec_diff: 'Weicht um {0} ab.',
    bi_ezzo_offer: 'Ezzo kann für den Rest Kategorien wählen.', bi_ezzo_btn: 'Ezzo fragen', bi_ezzo_working: 'Ezzo wählt Kategorien für {0} Orte…',
    bi_ezzo_done: 'Ezzo hat für {0} von {1} Orten Kategorien gewählt.', bi_ezzo_fail: 'Ezzo konnte gerade keine Kategorien wählen, der Rest ist Ohne Kategorie zum Auswählen.',
    bi_ezzo_none: 'Jede Zeile hat schon eine Kategorie.', bi_ezzo_note: 'Nur Geschäftsnamen gehen an Google Gemini. Nie Beträge, Daten oder Kontodaten.',
    bi_ezzo_off: 'Schalte Ezzo in den Einstellungen ein, dann wählt er Kategorien für die übrigen Zeilen.',
    bi_tab_all: 'Alle', bi_s_review: 'Brauchen Kategorie', bi_s_dupe: 'Schon erfasst', bi_s_transfer: 'Umbuchungen',
    bi_tag_learned: 'Aus deinem Verlauf', bi_tag_bill: 'Deine Rechnung', bi_tag_debt: 'Deine Schuld', bi_tag_goal: 'Dein Ziel', bi_tag_ezzo: 'Ezzo', bi_tag_suggested: 'Vorschlag', bi_tag_manual: 'Deine Wahl',
    bi_tag_review: 'Ohne Kategorie', bi_tag_dupe: 'Schon im Planer', bi_tag_maybe: 'Vielleicht am {0} erfasst', bi_tag_transfer: 'Zwischen deinen Konten', bi_tag_twice: 'Zweimal in der Datei', bi_tag_refund: 'Erstattung',
    bi_type_transfer: 'Umbuchung', bi_left_out: 'Weggelassen', bi_include: 'Diese Zeile übernehmen', bi_none_here: 'Hier ist nichts.', bi_more: '{0} weitere zeigen',
    bi_skipped_n: '{0} Zeilen wurden weggelassen', bi_skip_date: 'Kein lesbares Datum', bi_skip_amount: 'Kein lesbarer Betrag', bi_skip_desc: 'Keine Beschreibung', bi_skip_pending: 'Vorgemerkt, noch nicht endgültig',
    bi_skip_failed: 'Abgelehnt oder storniert', bi_skip_summary: 'Eine Saldo- oder Summenzeile', bi_skip_zero: 'Betrag null',
    bi_outside: '{0} liegen außerhalb dieses Budgetzeitraums und ändern seine Zahlen nicht.', bi_alloc: 'Die Budgetaufteilung ist an. Ordne diese danach auf der Seite Transaktionen zu; bis dahin zeigen sie ein ?.',
    bi_trial: 'Deine Testversion kann noch {0} hinzufügen. Schalte den vollen Planer frei, um den Rest hinzuzufügen.',
    bi_add_n: '{0} Transaktionen hinzufügen', bi_add_1: '1 Transaktion hinzufügen', bi_done_n: '{0} Transaktionen von deiner Bank hinzugefügt.', bi_done_1: '1 Transaktion von deiner Bank hinzugefügt.',
    bi_applied_same: 'Auch für {0} weitere von {1} gesetzt.', bi_chip: 'Kontoauszug importieren', bi_attach: 'Kontoauszug importieren (CSV oder PDF)',
    bi_chat_found: 'Ich habe {0} Umsätze gelesen: {1} bereit zum Hinzufügen, {2} schon in deinem Planer, {3} Umbuchungen zwischen deinen Konten und {4} Zeilen weggelassen.',
    bi_chat_bal_ok: 'Der Kontostand stimmt.', bi_chat_bal_off: 'Der Kontostand geht nicht ganz auf, vielleicht fehlen Zeilen im Export.',
    bi_chat_sorted: 'Ich habe für {0} von {1} Orten Kategorien gewählt. Sieh sie dir an und füge sie hinzu, wenn alles passt.',
    bi_chat_added: 'Erledigt. Ich habe {0} Transaktionen hinzugefügt.', bi_chat_added_review: 'Erledigt. Ich habe {0} Transaktionen hinzugefügt. {1} sind Ohne Kategorie und warten auf der Seite Transaktionen auf dich.'
  },
  fr: {
    bi_no_desc: 'Sans libellé',
    bi_pdf_note_ezzo: 'Lu par Ezzo depuis votre PDF. Vérifiez les lignes avant de les ajouter.',
    bi_pdf_note_local: 'Lu depuis votre PDF sur cet appareil. Les PDF sont plus difficiles à lire que les CSV, vérifiez donc les lignes avant de les ajouter.',
    bi_pdf_retry_lead: 'Ezzo peut lire ce relevé à votre place.',
    bi_pdf_ezzo_retry: 'Des lignes semblent fausses ? Laisser Ezzo le lire',
    bi_pdf_ezzo_fail: 'Ezzo n’a pas pu lire ce relevé pour le moment.',
    bi_pdf_ezzo_working: 'Ezzo lit votre relevé…',
    bi_pdf_ezzo_off: 'Activez Ezzo dans les Paramètres pour qu’il lise ce genre de relevé.',
    bi_pdf_ezzo_warn: 'Ezzo peut le lire, mais cela envoie tout le relevé à Google Gemini, avec votre nom et les données de compte qui y figurent.',
    bi_pdf_ezzo_btn: 'Laisser Ezzo le lire',
    bi_pdf_lib: 'Le lecteur PDF n’a pas pu se charger. Vérifiez votre connexion et réessayez.',
    bi_pdf_bad: 'Ce PDF n’a pas pu être ouvert.',
    bi_pdf_scanned: 'Ce PDF est une image numérisée, il ne contient donc pas de texte lisible sur votre appareil.',
    bi_pdf_none: 'Aucune opération n’a pu être lue dans ce PDF sur votre appareil.',
    bi_pdf_pw_open: 'Ouvrir',
    bi_pdf_pw_wrong: 'Ce mot de passe ne l’a pas ouvert. Réessayez.',
    bi_pdf_pw: 'Saisissez le mot de passe fourni par votre banque. Il n’est utilisé que sur cet appareil.',
    bi_pdf_pw_title: 'Ce relevé est protégé',
    bi_pdf_reading: 'Lecture de votre relevé…',
    bi_title: 'Importer depuis votre banque', bi_private: 'Votre fichier est lu sur cet appareil et n’est pas conservé. Les numéros de compte et de carte sont ignorés.',
    bi_err_type: 'Ce fichier n’a pas pu être lu. Choisissez le relevé CSV ou PDF de votre banque.', bi_err_big: 'Ce fichier est trop volumineux. Exportez une période plus courte et réessayez.',
    bi_err_empty: 'Aucune opération trouvée dans ce fichier.', bi_err_cols: 'Choisissez les colonnes de la date, du libellé et du montant.',
    bi_map_title: 'Comment votre fichier est lu', bi_map_change: 'Modifier', bi_col_date: 'Date', bi_col_desc: 'Libellé', bi_col_amount: 'Montant', bi_col_out: 'Débit', bi_col_in: 'Crédit',
    bi_col_balance: 'Solde', bi_col_none: 'Absent de ce fichier', bi_col_n: 'Colonne', bi_date_order: 'Format de date', bi_date_auto: 'Automatique', bi_date_dmy: 'Jour, mois, année',
    bi_date_mdy: 'Mois, jour, année', bi_date_ymd: 'Année, mois, jour', bi_flip: 'Les dépenses sont positives dans ce fichier',
    bi_flip_auto: 'Les dépenses étaient positives dans ce fichier, elles ont donc été inversées.',
    bi_rec_ok: 'Le solde est juste, de {0} à {1}.', bi_rec_off: 'Le solde est décalé de {0}. {1} lignes ne suivent pas le solde courant, il manque peut-être des opérations dans l’export.',
    bi_rec_none: 'Crédits {0}, débits {1}, net {2}.', bi_rec_check: 'Comparer à votre relevé', bi_rec_start: 'Solde de départ', bi_rec_end: 'Solde final',
    bi_rec_match: 'Correspond à votre relevé.', bi_rec_diff: 'Écart de {0}.',
    bi_ezzo_offer: 'Ezzo peut choisir les catégories du reste.', bi_ezzo_btn: 'Demander à Ezzo', bi_ezzo_working: 'Ezzo choisit les catégories de {0} commerces…',
    bi_ezzo_done: 'Ezzo a choisi les catégories de {0} commerces sur {1}.', bi_ezzo_fail: 'Ezzo n’a pas pu choisir les catégories pour le moment, le reste est Sans catégorie à choisir.',
    bi_ezzo_none: 'Chaque ligne a déjà une catégorie.', bi_ezzo_note: 'Seuls les noms des commerces sont envoyés à Google Gemini. Jamais les montants, les dates ni les données de compte.',
    bi_ezzo_off: 'Activez Ezzo dans les Paramètres pour qu’il choisisse les catégories des lignes restantes.',
    bi_tab_all: 'Tout', bi_s_review: 'Sans catégorie', bi_s_dupe: 'Déjà saisies', bi_s_transfer: 'Virements',
    bi_tag_learned: 'D’après votre historique', bi_tag_bill: 'Votre facture', bi_tag_debt: 'Votre dette', bi_tag_goal: 'Votre objectif', bi_tag_ezzo: 'Ezzo', bi_tag_suggested: 'Suggestion', bi_tag_manual: 'Votre choix',
    bi_tag_review: 'Sans catégorie', bi_tag_dupe: 'Déjà dans votre planificateur', bi_tag_maybe: 'Peut-être saisie le {0}', bi_tag_transfer: 'Entre vos comptes', bi_tag_twice: 'Deux fois dans le fichier', bi_tag_refund: 'Remboursement',
    bi_type_transfer: 'Virement', bi_left_out: 'Ignorée', bi_include: 'Inclure cette ligne', bi_none_here: 'Rien ici.', bi_more: 'Afficher {0} de plus',
    bi_skipped_n: '{0} lignes ont été ignorées', bi_skip_date: 'Date illisible', bi_skip_amount: 'Montant illisible', bi_skip_desc: 'Sans libellé', bi_skip_pending: 'En attente, pas encore définitive',
    bi_skip_failed: 'Refusée ou annulée', bi_skip_summary: 'Une ligne de solde ou de total', bi_skip_zero: 'Montant nul',
    bi_outside: '{0} sont hors de cette période budgétaire et ne changeront pas ses chiffres.', bi_alloc: 'La répartition budgétaire est activée. Classez ces opérations ensuite sur la page Transactions ; elles affichent un ? d’ici là.',
    bi_trial: 'Votre essai gratuit peut encore en ajouter {0}. Débloquez le planificateur complet pour ajouter le reste.',
    bi_add_n: 'Ajouter {0} transactions', bi_add_1: 'Ajouter 1 transaction', bi_done_n: '{0} transactions ajoutées depuis votre banque.', bi_done_1: '1 transaction ajoutée depuis votre banque.',
    bi_applied_same: 'Appliqué aussi à {0} autres de {1}.', bi_chip: 'Importer un relevé bancaire', bi_attach: 'Importer un relevé bancaire (CSV ou PDF)',
    bi_chat_found: 'J’ai lu {0} opérations : {1} prêtes à ajouter, {2} déjà dans votre planificateur, {3} virements entre vos comptes et {4} lignes ignorées.',
    bi_chat_bal_ok: 'Le solde est juste.', bi_chat_bal_off: 'Le solde ne tombe pas tout à fait juste, il manque peut-être des lignes dans l’export.',
    bi_chat_sorted: 'J’ai choisi les catégories de {0} commerces sur {1}. Jetez un œil et ajoutez-les quand tout vous convient.',
    bi_chat_added: 'C’est fait. J’ai ajouté {0} transactions.', bi_chat_added_review: 'C’est fait. J’ai ajouté {0} transactions. {1} sont Sans catégorie, à classer sur la page Transactions.'
  },
  es: {
    bi_no_desc: 'Sin concepto',
    bi_pdf_note_ezzo: 'Leído por Ezzo de tu PDF. Revisa las filas antes de añadirlas.',
    bi_pdf_note_local: 'Leído de tu PDF en este dispositivo. Los PDF son más difíciles de leer que los CSV, así que revisa las filas antes de añadirlas.',
    bi_pdf_retry_lead: 'Ezzo puede leer este extracto por ti.',
    bi_pdf_ezzo_retry: '¿Filas incorrectas? Deja que Ezzo lo lea',
    bi_pdf_ezzo_fail: 'Ezzo no pudo leer este extracto ahora.',
    bi_pdf_ezzo_working: 'Ezzo está leyendo tu extracto…',
    bi_pdf_ezzo_off: 'Activa Ezzo en Ajustes y podrá leer extractos como este.',
    bi_pdf_ezzo_warn: 'Ezzo puede leerlo, pero eso envía el extracto completo a Google Gemini, con tu nombre y los datos de cuenta que aparezcan.',
    bi_pdf_ezzo_btn: 'Dejar que Ezzo lo lea',
    bi_pdf_lib: 'No se pudo cargar el lector de PDF. Revisa tu conexión y vuelve a intentarlo.',
    bi_pdf_bad: 'No se pudo abrir este PDF.',
    bi_pdf_scanned: 'Este PDF es una imagen escaneada, así que no tiene texto que se pueda leer en tu dispositivo.',
    bi_pdf_none: 'No se pudo leer ningún movimiento de este PDF en tu dispositivo.',
    bi_pdf_pw_open: 'Abrir',
    bi_pdf_pw_wrong: 'Esa contraseña no lo abrió. Inténtalo de nuevo.',
    bi_pdf_pw: 'Escribe la contraseña que te dio tu banco. Solo se usa en este dispositivo.',
    bi_pdf_pw_title: 'Este extracto está protegido',
    bi_pdf_reading: 'Leyendo tu extracto…',
    bi_title: 'Importar de tu banco', bi_private: 'Tu archivo se lee en este dispositivo y no se guarda. Se omiten los números de cuenta y de tarjeta.',
    bi_err_type: 'No se pudo leer ese archivo. Elige el extracto CSV o PDF de tu banco.', bi_err_big: 'El archivo es demasiado grande. Exporta un periodo más corto y vuelve a intentarlo.',
    bi_err_empty: 'No se encontraron movimientos en ese archivo.', bi_err_cols: 'Elige qué columnas contienen la fecha, el concepto y el importe.',
    bi_map_title: 'Cómo se lee tu archivo', bi_map_change: 'Cambiar', bi_col_date: 'Fecha', bi_col_desc: 'Concepto', bi_col_amount: 'Importe', bi_col_out: 'Cargos', bi_col_in: 'Abonos',
    bi_col_balance: 'Saldo', bi_col_none: 'No está en este archivo', bi_col_n: 'Columna', bi_date_order: 'Formato de fecha', bi_date_auto: 'Automático', bi_date_dmy: 'Día, mes, año',
    bi_date_mdy: 'Mes, día, año', bi_date_ymd: 'Año, mes, día', bi_flip: 'Los gastos aparecen en positivo en este archivo',
    bi_flip_auto: 'Los gastos aparecían en positivo en este archivo, así que se han invertido.',
    bi_rec_ok: 'El saldo cuadra, de {0} a {1}.', bi_rec_off: 'El saldo no cuadra por {0}. {1} filas no siguen el saldo, puede que falten movimientos en la exportación.',
    bi_rec_none: 'Entradas {0}, salidas {1}, neto {2}.', bi_rec_check: 'Comparar con tu extracto', bi_rec_start: 'Saldo inicial', bi_rec_end: 'Saldo final',
    bi_rec_match: 'Coincide con tu extracto.', bi_rec_diff: 'Diferencia de {0}.',
    bi_ezzo_offer: 'Ezzo puede elegir las categorías del resto.', bi_ezzo_btn: 'Preguntar a Ezzo', bi_ezzo_working: 'Ezzo está eligiendo categorías para {0} comercios…',
    bi_ezzo_done: 'Ezzo eligió categorías para {0} de {1} comercios.', bi_ezzo_fail: 'Ezzo no pudo elegir categorías ahora, así que el resto queda Sin categoría para que elijas.',
    bi_ezzo_none: 'Cada fila ya tiene categoría.', bi_ezzo_note: 'Solo se envían a Google Gemini los nombres de los comercios. Nunca importes, fechas ni datos de cuenta.',
    bi_ezzo_off: 'Activa Ezzo en Ajustes y podrá elegir categorías para las filas que falten.',
    bi_tab_all: 'Todas', bi_s_review: 'Sin categoría', bi_s_dupe: 'Ya registradas', bi_s_transfer: 'Traspasos',
    bi_tag_learned: 'De tu historial', bi_tag_bill: 'Tu factura', bi_tag_debt: 'Tu deuda', bi_tag_goal: 'Tu meta', bi_tag_ezzo: 'Ezzo', bi_tag_suggested: 'Sugerida', bi_tag_manual: 'Tu elección',
    bi_tag_review: 'Sin categoría', bi_tag_dupe: 'Ya está en tu planificador', bi_tag_maybe: 'Quizá registrada el {0}', bi_tag_transfer: 'Entre tus cuentas', bi_tag_twice: 'Dos veces en el archivo', bi_tag_refund: 'Reembolso',
    bi_type_transfer: 'Traspaso', bi_left_out: 'Omitida', bi_include: 'Incluir esta fila', bi_none_here: 'Nada aquí.', bi_more: 'Mostrar {0} más',
    bi_skipped_n: 'Se omitieron {0} líneas', bi_skip_date: 'Sin fecha legible', bi_skip_amount: 'Sin importe legible', bi_skip_desc: 'Sin concepto', bi_skip_pending: 'Pendiente, aún no definitivo',
    bi_skip_failed: 'Rechazado o anulado', bi_skip_summary: 'Una línea de saldo o total', bi_skip_zero: 'Importe cero',
    bi_outside: '{0} quedan fuera de este periodo, así que no cambiarán sus cifras.', bi_alloc: 'La asignación del presupuesto está activada. Etiquétalas después en la página Transacciones; hasta entonces muestran un ?.',
    bi_trial: 'Tu prueba gratuita puede añadir {0} más. Desbloquea el planificador completo para añadir el resto.',
    bi_add_n: 'Añadir {0} transacciones', bi_add_1: 'Añadir 1 transacción', bi_done_n: 'Se añadieron {0} transacciones de tu banco.', bi_done_1: 'Se añadió 1 transacción de tu banco.',
    bi_applied_same: 'También aplicado a {0} más de {1}.', bi_chip: 'Importar un extracto bancario', bi_attach: 'Importar un extracto bancario (CSV o PDF)',
    bi_chat_found: 'He leído {0} movimientos: {1} listos para añadir, {2} ya en tu planificador, {3} traspasos entre tus cuentas y {4} líneas omitidas.',
    bi_chat_bal_ok: 'El saldo cuadra.', bi_chat_bal_off: 'El saldo no cuadra del todo, puede que falten filas en la exportación.',
    bi_chat_sorted: 'He elegido categorías para {0} de {1} comercios. Revísalas y añádelas cuando te parezca bien.',
    bi_chat_added: 'Hecho. He añadido {0} transacciones.', bi_chat_added_review: 'Hecho. He añadido {0} transacciones. {1} están Sin categoría para que las ordenes en la página Transacciones.'
  },
  it: {
    bi_no_desc: 'Senza descrizione',
    bi_pdf_note_ezzo: 'Letto da Ezzo dal tuo PDF. Controlla le righe prima di aggiungerle.',
    bi_pdf_note_local: 'Letto dal PDF su questo dispositivo. I PDF sono più difficili da leggere dei CSV, quindi controlla le righe prima di aggiungerle.',
    bi_pdf_retry_lead: 'Ezzo può leggere questo estratto conto al posto tuo.',
    bi_pdf_ezzo_retry: 'Righe sbagliate? Fallo leggere a Ezzo',
    bi_pdf_ezzo_fail: 'Ezzo non è riuscito a leggere questo estratto conto ora.',
    bi_pdf_ezzo_working: 'Ezzo sta leggendo l’estratto conto…',
    bi_pdf_ezzo_off: 'Attiva Ezzo nelle Impostazioni e potrà leggere estratti conto come questo.',
    bi_pdf_ezzo_warn: 'Ezzo può leggerlo, ma così l’intero estratto conto viene inviato a Google Gemini, con il tuo nome e i dati del conto riportati.',
    bi_pdf_ezzo_btn: 'Fallo leggere a Ezzo',
    bi_pdf_lib: 'Il lettore PDF non si è caricato. Controlla la connessione e riprova.',
    bi_pdf_bad: 'Impossibile aprire questo PDF.',
    bi_pdf_scanned: 'Questo PDF è un’immagine scansionata, quindi non contiene testo leggibile sul tuo dispositivo.',
    bi_pdf_none: 'Non è stato possibile leggere movimenti da questo PDF sul tuo dispositivo.',
    bi_pdf_pw_open: 'Apri',
    bi_pdf_pw_wrong: 'Questa password non l’ha aperto. Riprova.',
    bi_pdf_pw: 'Inserisci la password che ti ha dato la banca. Viene usata solo su questo dispositivo.',
    bi_pdf_pw_title: 'Questo estratto conto è protetto',
    bi_pdf_reading: 'Lettura dell’estratto conto…',
    bi_title: 'Importa dalla tua banca', bi_private: 'Il file viene letto su questo dispositivo e non viene conservato. Numeri di conto e di carta vengono esclusi.',
    bi_err_type: 'Impossibile leggere il file. Scegli l’estratto conto CSV o PDF della tua banca.', bi_err_big: 'Il file è troppo grande. Esporta un periodo più breve e riprova.',
    bi_err_empty: 'Nessun movimento trovato in questo file.', bi_err_cols: 'Scegli le colonne con la data, la descrizione e l’importo.',
    bi_map_title: 'Come viene letto il file', bi_map_change: 'Modifica', bi_col_date: 'Data', bi_col_desc: 'Descrizione', bi_col_amount: 'Importo', bi_col_out: 'Uscite', bi_col_in: 'Entrate',
    bi_col_balance: 'Saldo', bi_col_none: 'Non presente nel file', bi_col_n: 'Colonna', bi_date_order: 'Formato data', bi_date_auto: 'Automatico', bi_date_dmy: 'Giorno, mese, anno',
    bi_date_mdy: 'Mese, giorno, anno', bi_date_ymd: 'Anno, mese, giorno', bi_flip: 'Le spese sono positive in questo file',
    bi_flip_auto: 'Le spese erano positive in questo file, quindi sono state invertite.',
    bi_rec_ok: 'Il saldo torna, da {0} a {1}.', bi_rec_off: 'Il saldo è sfasato di {0}. {1} righe non seguono il saldo progressivo, forse mancano movimenti nell’esportazione.',
    bi_rec_none: 'Entrate {0}, uscite {1}, netto {2}.', bi_rec_check: 'Confronta con l’estratto conto', bi_rec_start: 'Saldo iniziale', bi_rec_end: 'Saldo finale',
    bi_rec_match: 'Corrisponde all’estratto conto.', bi_rec_diff: 'Differenza di {0}.',
    bi_ezzo_offer: 'Ezzo può scegliere le categorie per il resto.', bi_ezzo_btn: 'Chiedi a Ezzo', bi_ezzo_working: 'Ezzo sta scegliendo le categorie per {0} esercenti…',
    bi_ezzo_done: 'Ezzo ha scelto le categorie per {0} esercenti su {1}.', bi_ezzo_fail: 'Ezzo non è riuscito a scegliere le categorie ora, quindi il resto è Senza categoria da scegliere.',
    bi_ezzo_none: 'Ogni riga ha già una categoria.', bi_ezzo_note: 'A Google Gemini vengono inviati solo i nomi degli esercenti. Mai importi, date o dati del conto.',
    bi_ezzo_off: 'Attiva Ezzo nelle Impostazioni e potrà scegliere le categorie per le righe rimaste.',
    bi_tab_all: 'Tutte', bi_s_review: 'Senza categoria', bi_s_dupe: 'Già registrate', bi_s_transfer: 'Giroconti',
    bi_tag_learned: 'Dalla tua cronologia', bi_tag_bill: 'La tua bolletta', bi_tag_debt: 'Il tuo debito', bi_tag_goal: 'Il tuo obiettivo', bi_tag_ezzo: 'Ezzo', bi_tag_suggested: 'Suggerita', bi_tag_manual: 'Tua scelta',
    bi_tag_review: 'Senza categoria', bi_tag_dupe: 'Già nel planner', bi_tag_maybe: 'Forse registrata il {0}', bi_tag_transfer: 'Tra i tuoi conti', bi_tag_twice: 'Due volte nel file', bi_tag_refund: 'Rimborso',
    bi_type_transfer: 'Giroconto', bi_left_out: 'Esclusa', bi_include: 'Includi questa riga', bi_none_here: 'Niente qui.', bi_more: 'Mostra altre {0}',
    bi_skipped_n: '{0} righe sono state escluse', bi_skip_date: 'Data illeggibile', bi_skip_amount: 'Importo illeggibile', bi_skip_desc: 'Senza descrizione', bi_skip_pending: 'In sospeso, non ancora definitivo',
    bi_skip_failed: 'Rifiutato o stornato', bi_skip_summary: 'Una riga di saldo o di totale', bi_skip_zero: 'Importo zero',
    bi_outside: '{0} sono fuori da questo periodo, quindi non cambieranno le sue cifre.', bi_alloc: 'La ripartizione del budget è attiva. Assegnale poi nella pagina Transazioni; fino ad allora mostrano un ?.',
    bi_trial: 'La prova gratuita può aggiungerne ancora {0}. Sblocca il planner completo per aggiungere il resto.',
    bi_add_n: 'Aggiungi {0} transazioni', bi_add_1: 'Aggiungi 1 transazione', bi_done_n: 'Aggiunte {0} transazioni dalla tua banca.', bi_done_1: 'Aggiunta 1 transazione dalla tua banca.',
    bi_applied_same: 'Impostata anche per altre {0} di {1}.', bi_chip: 'Importa un estratto conto', bi_attach: 'Importa un estratto conto (CSV o PDF)',
    bi_chat_found: 'Ho letto {0} movimenti: {1} pronti da aggiungere, {2} già nel planner, {3} giroconti tra i tuoi conti e {4} righe escluse.',
    bi_chat_bal_ok: 'Il saldo torna.', bi_chat_bal_off: 'Il saldo non torna del tutto, forse mancano righe nell’esportazione.',
    bi_chat_sorted: 'Ho scelto le categorie per {0} esercenti su {1}. Dai un’occhiata e aggiungile quando va bene.',
    bi_chat_added: 'Fatto. Ho aggiunto {0} transazioni.', bi_chat_added_review: 'Fatto. Ho aggiunto {0} transazioni. {1} sono Senza categoria da sistemare nella pagina Transazioni.'
  },
  pl: {
    bi_no_desc: 'Brak opisu',
    bi_pdf_note_ezzo: 'Odczytane przez Ezzo z twojego PDF. Sprawdź wiersze przed dodaniem.',
    bi_pdf_note_local: 'Odczytano z PDF na tym urządzeniu. PDF trudniej odczytać niż CSV, więc sprawdź wiersze przed dodaniem.',
    bi_pdf_retry_lead: 'Ezzo może przeczytać ten wyciąg za ciebie.',
    bi_pdf_ezzo_retry: 'Wiersze wyglądają źle? Niech Ezzo go przeczyta',
    bi_pdf_ezzo_fail: 'Ezzo nie mógł teraz przeczytać tego wyciągu.',
    bi_pdf_ezzo_working: 'Ezzo czyta twój wyciąg…',
    bi_pdf_ezzo_off: 'Włącz Ezzo w Ustawieniach, a przeczyta takie wyciągi.',
    bi_pdf_ezzo_warn: 'Ezzo może go przeczytać, ale wtedy cały wyciąg trafia do Google Gemini, razem z twoim imieniem i nazwiskiem oraz danymi konta.',
    bi_pdf_ezzo_btn: 'Niech Ezzo go przeczyta',
    bi_pdf_lib: 'Nie udało się wczytać czytnika PDF. Sprawdź połączenie i spróbuj ponownie.',
    bi_pdf_bad: 'Nie udało się otworzyć tego PDF.',
    bi_pdf_scanned: 'Ten PDF to zeskanowany obraz, więc nie ma w nim tekstu do odczytania na twoim urządzeniu.',
    bi_pdf_none: 'Nie udało się odczytać transakcji z tego PDF na twoim urządzeniu.',
    bi_pdf_pw_open: 'Otwórz',
    bi_pdf_pw_wrong: 'To hasło go nie otworzyło. Spróbuj ponownie.',
    bi_pdf_pw: 'Wpisz hasło od banku. Jest używane tylko na tym urządzeniu.',
    bi_pdf_pw_title: 'Ten wyciąg jest chroniony',
    bi_pdf_reading: 'Czytam twój wyciąg…',
    bi_title: 'Import z banku', bi_private: 'Plik jest czytany na tym urządzeniu i nie jest zapisywany. Numery kont i kart są pomijane.',
    bi_err_type: 'Nie udało się odczytać pliku. Wybierz wyciąg CSV lub PDF ze swojego banku.', bi_err_big: 'Plik jest za duży. Wyeksportuj krótszy okres i spróbuj ponownie.',
    bi_err_empty: 'W tym pliku nie znaleziono transakcji.', bi_err_cols: 'Wybierz kolumny z datą, opisem i kwotą.',
    bi_map_title: 'Jak czytany jest plik', bi_map_change: 'Zmień', bi_col_date: 'Data', bi_col_desc: 'Opis', bi_col_amount: 'Kwota', bi_col_out: 'Obciążenia', bi_col_in: 'Uznania',
    bi_col_balance: 'Saldo', bi_col_none: 'Brak w tym pliku', bi_col_n: 'Kolumna', bi_date_order: 'Format daty', bi_date_auto: 'Automatycznie', bi_date_dmy: 'Dzień, miesiąc, rok',
    bi_date_mdy: 'Miesiąc, dzień, rok', bi_date_ymd: 'Rok, miesiąc, dzień', bi_flip: 'Wydatki są w tym pliku dodatnie',
    bi_flip_auto: 'Wydatki były w tym pliku dodatnie, więc zostały odwrócone.',
    bi_rec_ok: 'Saldo się zgadza, od {0} do {1}.', bi_rec_off: 'Saldo różni się o {0}. {1} wierszy nie pasuje do salda, być może w eksporcie brakuje transakcji.',
    bi_rec_none: 'Wpływy {0}, wydatki {1}, netto {2}.', bi_rec_check: 'Porównaj z wyciągiem', bi_rec_start: 'Saldo początkowe', bi_rec_end: 'Saldo końcowe',
    bi_rec_match: 'Zgadza się z wyciągiem.', bi_rec_diff: 'Różnica {0}.',
    bi_ezzo_offer: 'Ezzo może wybrać kategorie dla reszty.', bi_ezzo_btn: 'Zapytaj Ezzo', bi_ezzo_working: 'Ezzo wybiera kategorie dla {0} miejsc…',
    bi_ezzo_done: 'Ezzo wybrał kategorie dla {0} z {1} miejsc.', bi_ezzo_fail: 'Ezzo nie mógł teraz wybrać kategorii, więc reszta jest Bez kategorii do wyboru.',
    bi_ezzo_none: 'Każdy wiersz ma już kategorię.', bi_ezzo_note: 'Do Google Gemini trafiają tylko nazwy sklepów. Nigdy kwoty, daty ani dane konta.',
    bi_ezzo_off: 'Włącz Ezzo w Ustawieniach, a wybierze kategorie dla pozostałych wierszy.',
    bi_tab_all: 'Wszystkie', bi_s_review: 'Bez kategorii', bi_s_dupe: 'Już zapisane', bi_s_transfer: 'Przelewy własne',
    bi_tag_learned: 'Z twojej historii', bi_tag_bill: 'Twój rachunek', bi_tag_debt: 'Twój dług', bi_tag_goal: 'Twój cel', bi_tag_ezzo: 'Ezzo', bi_tag_suggested: 'Propozycja', bi_tag_manual: 'Twój wybór',
    bi_tag_review: 'Bez kategorii', bi_tag_dupe: 'Już w planerze', bi_tag_maybe: 'Może zapisana {0}', bi_tag_transfer: 'Między twoimi kontami', bi_tag_twice: 'Dwa razy w pliku', bi_tag_refund: 'Zwrot',
    bi_type_transfer: 'Przelew własny', bi_left_out: 'Pominięta', bi_include: 'Uwzględnij ten wiersz', bi_none_here: 'Nic tu nie ma.', bi_more: 'Pokaż {0} więcej',
    bi_skipped_n: 'Pominięto {0} wierszy', bi_skip_date: 'Brak czytelnej daty', bi_skip_amount: 'Brak czytelnej kwoty', bi_skip_desc: 'Brak opisu', bi_skip_pending: 'Oczekująca, jeszcze nieostateczna',
    bi_skip_failed: 'Odrzucona lub anulowana', bi_skip_summary: 'Wiersz salda lub sumy', bi_skip_zero: 'Kwota zero',
    bi_outside: '{0} jest poza tym okresem budżetu, więc nie zmienią jego liczb.', bi_alloc: 'Podział budżetu jest włączony. Oznacz je potem na stronie Transakcje; do tego czasu mają ?.',
    bi_trial: 'Wersja próbna może dodać jeszcze {0}. Odblokuj pełny planer, aby dodać resztę.',
    bi_add_n: 'Dodaj transakcje: {0}', bi_add_1: 'Dodaj 1 transakcję', bi_done_n: 'Dodano transakcje z banku: {0}.', bi_done_1: 'Dodano 1 transakcję z banku.',
    bi_applied_same: 'Ustawiono też dla {0} kolejnych z {1}.', bi_chip: 'Importuj wyciąg bankowy', bi_attach: 'Importuj wyciąg bankowy (CSV lub PDF)',
    bi_chat_found: 'Przeczytałem {0} transakcji: {1} gotowych do dodania, {2} już w planerze, {3} przelewów między twoimi kontami i {4} pominiętych wierszy.',
    bi_chat_bal_ok: 'Saldo się zgadza.', bi_chat_bal_off: 'Saldo nie do końca się zgadza, być może w eksporcie brakuje wierszy.',
    bi_chat_sorted: 'Wybrałem kategorie dla {0} z {1} miejsc. Rzuć okiem i dodaj je, gdy wszystko pasuje.',
    bi_chat_added: 'Gotowe. Dodałem transakcje: {0}.', bi_chat_added_review: 'Gotowe. Dodałem transakcje: {0}. {1} są Bez kategorii do uporządkowania na stronie Transakcje.'
  }
};
(function biAddWords() {
  try { Object.keys(BI_WORDS).forEach(l => { if (TRANSLATIONS[l]) Object.assign(TRANSLATIONS[l], BI_WORDS[l]); }); } catch (e) {}
})();
