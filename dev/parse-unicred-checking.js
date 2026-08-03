// Dev/test harness for the Unicred checking-account (Extrato Conta Corrente) parser.
// Run: node parse-unicred-checking.js <fixture.txt>
const fs = require('fs');

function parseBRL(str) {
  const cleaned = String(str).replace(/[^0-9,.\-]/g, '');
  return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
}
function brToDate(str) {
  const [d, m, y] = str.split('/').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function fmtOfxDate(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function parseUnicredChecking(rawText) {
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

  const periodMatch = rawText.match(/Per[íi]odo de\s*(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/);
  if (!periodMatch) throw new Error('Período não encontrado');
  const periodStart = brToDate(periodMatch[1]);
  const periodEnd = brToDate(periodMatch[2]);

  const contaMatch = rawText.match(/Coop:\s*(\d+)\s*-\s*AG:\s*(\d+)\s*-\s*Conta:\s*([\d-]+)/);
  const bankInfo = {
    bankId: contaMatch ? contaMatch[1] : '',
    branchId: contaMatch ? contaMatch[2] : '',
    accountId: contaMatch ? contaMatch[3] : '',
    bankName: 'Unicred',
    accountHolder: '',
  };

  const openingMatch = rawText.match(/Saldo em\s*(\d{2}\/\d{2}\/\d{4}):\s*(-?\s?R\$\s?[\d.]+,\d{2})/);
  const closingMatch = rawText.match(/Saldo no final do per[íi]odo\s*(-?\s?R\$\s?[\d.]+,\d{2})/);
  if (!openingMatch || !closingMatch) throw new Error('Saldo inicial/final não encontrado');
  const openingBalance = parseBRL(openingMatch[2]);
  const openingBalanceDate = brToDate(openingMatch[1]);
  const closingBalance = parseBRL(closingMatch[1]);
  const closingBalanceDate = periodEnd;

  const TXN_LINE = /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(-?\s?R\$\s?[\d.]+,\d{2})\s+(-?\s?R\$\s?[\d.]+,\d{2})$/;
  const NOISE = /^(CENTRAL DE RELACIONAMENTO|0800|Saldo no final|Saldo atual|Total dispon[íi]vel|Saldo bloqueado|Limite de cheque especial|IOF\b|Juros|Tarifas pendentes|Saldo Bloqueado|Data\s+Lan[çc]amentos|Lan[çc]amentos futuros|P[áa]g\.)/i;

  const transactions = [];
  let txnCounter = 0;
  for (let idx = 0; idx < lines.length; idx++) {
    const m = lines[idx].match(TXN_LINE);
    if (!m) continue;
    let [, dateStr, desc, valueStr] = m;

    let openParens = (desc.match(/\(/g) || []).length;
    let closeParens = (desc.match(/\)/g) || []).length;
    let j = idx + 1;
    while (openParens > closeParens && j < lines.length && !TXN_LINE.test(lines[j]) && !NOISE.test(lines[j])) {
      desc += ' ' + lines[j];
      openParens += (lines[j].match(/\(/g) || []).length;
      closeParens += (lines[j].match(/\)/g) || []).length;
      j++;
    }
    idx = j - 1;

    const date = brToDate(dateStr);
    const amount = parseBRL(valueStr);
    const descMatch = desc.match(/^(.+?)\s*\(\s*(.+?)\s*\)\s*$/);
    const description = descMatch ? descMatch[1].trim() : desc.trim();
    const memo = descMatch ? descMatch[2].trim() : '';

    txnCounter++;
    transactions.push({
      date, description, memo, amount,
      fitid: `${fmtOfxDate(date)}${String(txnCounter).padStart(4, '0')}`,
    });
  }

  if (transactions.length === 0) throw new Error('Nenhum lançamento reconhecido');

  return { bankInfo, periodStart, periodEnd, openingBalance, openingBalanceDate, closingBalance, closingBalanceDate, transactions };
}

// ---- run ----
const file = process.argv[2] || 'fixtures/unicred-conta-corrente.txt';
const raw = fs.readFileSync(file, 'utf8');
const result = parseUnicredChecking(raw);

console.log('bankInfo:', result.bankInfo);
console.log('período:', result.periodStart.toISOString().slice(0,10), '->', result.periodEnd.toISOString().slice(0,10));
console.log('saldo inicial:', result.openingBalance, result.openingBalanceDate.toISOString().slice(0,10));
console.log('saldo final:  ', result.closingBalance, result.closingBalanceDate.toISOString().slice(0,10));
console.log('nº lançamentos:', result.transactions.length);

const sum = result.transactions.reduce((s, t) => s + t.amount, 0);
const expected = result.closingBalance - result.openingBalance;
console.log('soma lançamentos:', sum.toFixed(2));
console.log('esperado (final-inicial):', expected.toFixed(2));
console.log('diferença:', (sum - expected).toFixed(2));

console.log('\ntodos os lançamentos:');
for (const t of result.transactions) {
  console.log(t.date.toISOString().slice(0,10), t.fitid, '|', t.description, '|', t.amount.toFixed(2), '|', t.memo);
}
