// Dev/test harness for the Sicoob checking-account (Conta Corrente) parser.
// Run: node parse-sicoob-checking.js <fixture.txt>
const fs = require('fs');

function parseBRL(str) {
  return parseFloat(str.replace(/\./g, '').replace(',', '.'));
}

// Some statements are "print to PDF" exports of the internet-banking page
// rather than the dedicated PDF export, so pdf.js sees the browser's page
// header/footer (timestamp title, URL, repeated column header) stamped on
// every page, interleaved with the transaction rows. Strip them up front
// rather than let them get swept into a transaction's memo lines.
const NOISE_LINE = /^(https?:\/\/|\d{2}\/\d{2}\/\d{4},?\s*\d{2}:\d{2}\s+Sicoob\s*\|\s*Internet Banking$|Data\s+(Documento\s+)?Hist[óo]rico\s+Valor$)/i;

function parseSicoobChecking(rawText) {
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0 && !NOISE_LINE.test(l));

  const periodMatch = rawText.match(/PER[ÍI]ODO:\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (!periodMatch) throw new Error('Período não encontrado');
  const [, periodStartStr, periodEndStr] = periodMatch;
  const periodEnd = brToDate(periodEndStr);
  const periodStart = brToDate(periodStartStr);

  const coopMatch = rawText.match(/(?:COOPERATIVA|COOP\.?):\s*([\d-]+)\s*\/\s*(.+)/i);
  const contaMatch = rawText.match(/CONTA:\s*([\d.-]+)\s*\/\s*(.+)/i);
  const bankInfo = {
    bankId: coopMatch ? coopMatch[1].replace(/\D/g, '') : '',
    bankName: coopMatch ? coopMatch[2].trim() : '',
    account: contaMatch ? contaMatch[1].trim() : '',
    accountHolder: contaMatch ? contaMatch[2].trim() : '',
  };

  // "R$ " sometimes prefixes the value (statements that show it inline per
  // row); consume it as part of the value token, not the description, or
  // exact-match checks like `desc === 'SALDO ANTERIOR'` below would fail.
  const TXN_LINE = /^(\d{2}\/\d{2})\s+(.+?)\s+(?:R\$\s*)?(-?[\d.]+,\d{2})\s*([CD])?\*?$/;
  const ONLY_SUFFIX = /^([CD])\*?$/;

  const transactions = [];
  let closingBalance = null, closingBalanceDate = null;
  let openingBalance = null, openingBalanceDate = null;
  let firstSaldoSeen = false;

  let i = 0;
  // find start of movement section
  const startIdx = lines.findIndex(l => l === 'DATA HISTÓRICO VALOR' || l === 'HISTÓRICO DE MOVIMENTAÇÃO');
  const endIdx = lines.findIndex(l => l === 'RESUMO');
  const body = lines.slice(startIdx >= 0 ? startIdx + 1 : 0, endIdx >= 0 ? endIdx : lines.length);

  let txnCounter = 0;
  for (let idx = 0; idx < body.length; idx++) {
    let line = body[idx];
    const m = line.match(TXN_LINE);
    if (!m) continue;

    let [, dateStr, desc, valueStr, suffix] = m;

    // handle wrapped C/D suffix on the next line
    if (!suffix) {
      const next = body[idx + 1];
      if (next && ONLY_SUFFIX.test(next)) {
        suffix = next.match(ONLY_SUFFIX)[1];
        idx++; // consume it
      }
    }

    const date = brToDateWithPeriod(dateStr, periodEnd);
    const amountAbs = parseBRL(valueStr);

    const isSaldo = /^SALDO/.test(desc);
    if (isSaldo) {
      if (!firstSaldoSeen) {
        closingBalance = suffix === 'D' ? -amountAbs : amountAbs;
        closingBalanceDate = date;
        firstSaldoSeen = true;
      }
      // keep overwriting; the LAST saldo-ish line encountered (bottom of statement) is the opening balance
      if (desc === 'SALDO ANTERIOR') {
        openingBalance = suffix === 'D' ? -amountAbs : amountAbs;
        openingBalanceDate = date;
      }
      continue;
    }

    // gather detail/memo lines until next txn line or saldo line
    const memoParts = [];
    let j = idx + 1;
    while (j < body.length) {
      const l2 = body[j];
      if (TXN_LINE.test(l2)) break;
      if (ONLY_SUFFIX.test(l2)) { j++; continue; } // stray wrapped suffix already consumed above in normal case
      memoParts.push(l2);
      j++;
    }
    idx = j - 1;

    txnCounter++;
    const amount = suffix === 'D' ? -amountAbs : amountAbs;
    transactions.push({
      date,
      description: desc.trim(),
      memo: memoParts.join(' | '),
      amount,
      fitid: `${dateStr.replace('/', '')}${String(txnCounter).padStart(4, '0')}`,
    });
  }

  return { bankInfo, periodStart, periodEnd, openingBalance, openingBalanceDate, closingBalance, closingBalanceDate, transactions };
}

function brToDate(str) {
  const [d, m, y] = str.split('/').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function brToDateWithPeriod(ddmm, periodEnd) {
  const [d, m] = ddmm.split('/').map(Number);
  let year = periodEnd.getUTCFullYear();
  if (m > periodEnd.getUTCMonth() + 1) year -= 1;
  return new Date(Date.UTC(year, m - 1, d));
}

// ---- run ----
const file = process.argv[2] || 'fixtures/sicoob-conta-corrente.txt';
const raw = fs.readFileSync(file, 'utf8');
const result = parseSicoobChecking(raw);

console.log('bankInfo:', result.bankInfo);
console.log('período:', result.periodStart.toISOString().slice(0,10), '->', result.periodEnd.toISOString().slice(0,10));
console.log('saldo inicial:', result.openingBalance, result.openingBalanceDate && result.openingBalanceDate.toISOString().slice(0,10));
console.log('saldo final:  ', result.closingBalance, result.closingBalanceDate && result.closingBalanceDate.toISOString().slice(0,10));
console.log('nº lançamentos:', result.transactions.length);

const sum = result.transactions.reduce((s, t) => s + t.amount, 0);
const expected = result.closingBalance - result.openingBalance;
console.log('soma lançamentos:', sum.toFixed(2));
console.log('esperado (final-inicial):', expected.toFixed(2));
console.log('diferença:', (sum - expected).toFixed(2));

console.log('\nprimeiros 5 lançamentos:');
for (const t of result.transactions.slice(0, 5)) {
  console.log(t.date.toISOString().slice(0,10), t.description, t.amount, '|', t.memo);
}
console.log('\núltimos 5 lançamentos:');
for (const t of result.transactions.slice(-5)) {
  console.log(t.date.toISOString().slice(0,10), t.description, t.amount, '|', t.memo);
}
