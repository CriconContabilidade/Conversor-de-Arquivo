// Dev/test harness for the Banco Inter checking-account parser.
// Run: node parse-inter-checking.js <fixture.txt>
const fs = require('fs');

function parseBRL(str) {
  const cleaned = String(str).replace(/[^0-9,.\-]/g, '');
  return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
}
function fmtOfxDate(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

const MESES_PT_LONG = { janeiro:1, fevereiro:2, marco:3, abril:4, maio:5, junho:6, julho:7, agosto:8, setembro:9, outubro:10, novembro:11, dezembro:12 };
function stripAccents(s) { return s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

function parseInterChecking(rawText) {
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

  const periodMatch = rawText.match(/Per[íi]odo:\s*(\d{2})\/(\d{2})\/(\d{4})\s*a\s*(\d{2})\/(\d{2})\/(\d{4})/);
  if (!periodMatch) throw new Error('Período não encontrado');
  const periodStart = new Date(Date.UTC(+periodMatch[3], +periodMatch[2] - 1, +periodMatch[1]));
  const periodEnd = new Date(Date.UTC(+periodMatch[6], +periodMatch[5] - 1, +periodMatch[4]));

  const acctMatch = rawText.match(/Institui[çc][ãa]o:\s*(.+?)\s*,\s*Ag[êe]ncia:\s*([\w-]+)\s*,\s*Conta:\s*([\w-]+)/);
  const bankInfo = {
    bankId: '077', // Banco Inter — código Febraban/COMPE fixo (não aparece no texto do extrato)
    branchId: acctMatch ? acctMatch[2] : '',
    accountId: acctMatch ? acctMatch[3] : '',
    bankName: acctMatch ? acctMatch[1] : 'Banco Inter',
    accountHolder: '',
  };

  const closingMatch = rawText.match(/Saldo total[\s\S]*?\n\s*(-?R\$\s?[\d.]+,\d{2})/);
  if (!closingMatch) throw new Error('Saldo total não encontrado');
  const closingBalance = parseBRL(closingMatch[1]);
  const closingBalanceDate = periodEnd;

  const DAY_HEADER = /^(\d{1,2}) de (\S+) de (\d{4}) Saldo do dia:\s*(-?R\$\s?[\d.]+,\d{2})/;
  const TXN_LINE = /^(.+?):\s*"(.+?)"\s+(-?R\$\s?[\d.]+,\d{2})\s+(-?R\$\s?[\d.]+,\d{2})$/;

  const transactions = [];
  let currentDate = periodStart;
  let txnCounter = 0;

  for (const line of lines) {
    const dm = line.match(DAY_HEADER);
    if (dm) {
      const monthNum = MESES_PT_LONG[stripAccents(dm[2].toLowerCase())];
      if (monthNum) currentDate = new Date(Date.UTC(+dm[3], monthNum - 1, +dm[1]));
      continue;
    }
    const tm = line.match(TXN_LINE);
    if (!tm) continue;
    const [, desc, detail, valueStr, balanceStr] = tm;
    const amount = parseBRL(valueStr);
    txnCounter++;
    transactions.push({
      date: currentDate,
      description: desc.trim(),
      memo: detail.trim(),
      amount,
      runningBalance: parseBRL(balanceStr),
      fitid: `${fmtOfxDate(currentDate)}${String(txnCounter).padStart(4, '0')}`,
    });
  }

  if (transactions.length === 0) throw new Error('Nenhum lançamento reconhecido');

  const first = transactions[0];
  const openingBalance = Math.round((first.runningBalance - first.amount) * 100) / 100;
  const openingBalanceDate = periodStart;

  return { bankInfo, periodStart, periodEnd, openingBalance, openingBalanceDate, closingBalance, closingBalanceDate, transactions };
}

// ---- run ----
const file = process.argv[2] || 'fixtures/inter-conta-corrente.txt';
const raw = fs.readFileSync(file, 'utf8');
const result = parseInterChecking(raw);

console.log('bankInfo:', result.bankInfo);
console.log('período:', result.periodStart.toISOString().slice(0,10), '->', result.periodEnd.toISOString().slice(0,10));
console.log('saldo inicial (derivado):', result.openingBalance);
console.log('saldo final:  ', result.closingBalance);
console.log('nº lançamentos:', result.transactions.length);

const sum = result.transactions.reduce((s, t) => s + t.amount, 0);
const expected = result.closingBalance - result.openingBalance;
console.log('soma lançamentos:', sum.toFixed(2));
console.log('esperado (final-inicial):', expected.toFixed(2));
console.log('diferença:', (sum - expected).toFixed(2));

console.log('\ntodos os lançamentos:');
for (const t of result.transactions) {
  console.log(t.date.toISOString().slice(0,10), t.fitid, '|', t.description, '|', t.amount.toFixed(2), '| saldo:', t.runningBalance.toFixed(2), '|', t.memo);
}
