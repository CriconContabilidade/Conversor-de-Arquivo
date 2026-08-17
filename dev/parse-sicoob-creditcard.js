// Dev/test harness for the Sicoob credit card invoice (fatura) parser.
// Run: node parse-sicoob-creditcard.js <fixture.txt>
const fs = require('fs');

function parseBRL(str) {
  return parseFloat(String(str).replace(/[^0-9,.\-]/g, '').replace(/\./g, '').replace(',', '.'));
}
function fmtOfxDate(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function parseSicoobCreditCard(rawText) {
  // "GASTOS DE <nome>" section headers sometimes wrap their "(NNNN)" card
  // reference onto the next line when the holder's name is long — merge it
  // back before line-by-line parsing.
  const rawLines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const lines = [];
  for (let i = 0; i < rawLines.length; i++) {
    const l = rawLines[i];
    if (/^GASTOS DE .+[^)]$/i.test(l) && rawLines[i + 1] && /^\(\d+\)$/.test(rawLines[i + 1])) {
      lines.push(`${l} ${rawLines[i + 1]}`);
      i++;
    } else {
      lines.push(l);
    }
  }

  const clienteMatch = rawText.match(/Cliente:\s*(.+)/);
  const contaCartaoMatch = rawText.match(/Conta Cart[ãa]o:\s*(\d+)/i);
  const vencMatch = rawText.match(/Vencimento:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  if (!vencMatch) throw new Error('Não foi possível identificar o vencimento da fatura.');
  const vencDate = new Date(Date.UTC(+vencMatch[3], +vencMatch[2] - 1, +vencMatch[1]));

  const totalFaturaMatch = rawText.match(/Total da Fatura\s+([\d.,]+)/i);
  const totalFatura = totalFaturaMatch ? parseBRL(totalFaturaMatch[1]) : null;

  const cardLast4 = contaCartaoMatch ? contaCartaoMatch[1] : '';
  const clienteName = clienteMatch ? clienteMatch[1].trim() : '';

  const TXN_LINE = /^(\d{2}\/\d{2})\s+(.+?)\s+(-?[\d.]+,\d{2})$/;
  const GASTOS_HEADER = /^GASTOS DE\s+(.+?)\s*\((\d+)\)$/i;
  const TOTAL_LINE = /^TOTAL\s+([\d.,]+)$/i;
  // The primary cardholder's own charges aren't itemized under a "GASTOS DE"
  // header — they sit directly under MOVIMENTOS, alongside the fatura's own
  // running-balance bookkeeping lines (opening balance, the payment that
  // settled last month's fatura). Those two are informational, not charges
  // to post — same reasoning as excluding "SALDO ..." lines in the checking
  // account statement, plus "PAGAMENTO" here since it's the fatura being
  // paid off, which typically shows up separately in the bank statement
  // import for the account it was debited from.
  const EXCLUDE_DESC = /^(SALDO|PAGAMENTO)\b/i;

  const startIdx = lines.findIndex(l => l === 'MOVIMENTOS');
  const endIdx = lines.findIndex(l => l === 'DEMONSTRATIVO DE PAGAMENTO EM R$');
  const body = lines.slice(startIdx >= 0 ? startIdx + 1 : 0, endIdx >= 0 ? endIdx : lines.length);

  const sections = [];
  let current = { holder: clienteName, cardLast4: '', statedTotal: null, _sum: 0 };
  sections.push(current);

  const vencMonth = vencDate.getUTCMonth() + 1;
  const vencYear = vencDate.getUTCFullYear();
  const transactions = [];
  let txnCounter = 0;

  for (const line of body) {
    const gastosMatch = line.match(GASTOS_HEADER);
    if (gastosMatch) {
      current = { holder: gastosMatch[1].trim(), cardLast4: gastosMatch[2], statedTotal: null, _sum: 0 };
      sections.push(current);
      continue;
    }
    const totalMatch = line.match(TOTAL_LINE);
    if (totalMatch) {
      current.statedTotal = parseBRL(totalMatch[1]);
      continue;
    }
    const m = line.match(TXN_LINE);
    if (!m) continue;
    const [, dateStr, desc, valStr] = m;
    if (EXCLUDE_DESC.test(desc)) continue;

    const [dd, mm] = dateStr.split('/').map(Number);
    let year = vencYear;
    if (mm > vencMonth) year -= 1;
    const date = new Date(Date.UTC(year, mm - 1, dd));
    const amount = parseBRL(valStr);
    // Sections without a printed "TOTAL" line (the primary cardholder's own
    // charges here) fall back to the sum of their own positive amounts, so
    // the conference check below has something real to compare against
    // instead of flagging every such fatura as "doesn't match".
    if (amount > 0) current._sum += amount;
    txnCounter++;
    transactions.push({
      date,
      description: `${desc.trim()}${sections.length > 1 ? ' — ' + current.holder : ''}`,
      amount,
      fitid: `${fmtOfxDate(date)}${String(txnCounter).padStart(4, '0')}`,
    });
  }

  for (const sec of sections) {
    if (sec.statedTotal == null) sec.statedTotal = Math.round(sec._sum * 100) / 100;
    delete sec._sum;
  }

  if (transactions.length === 0) throw new Error('Nenhum lançamento foi reconhecido na fatura.');
  transactions.sort((a, b) => a.date - b.date);

  const lastDayPrevMonth = new Date(Date.UTC(vencDate.getUTCFullYear(), vencDate.getUTCMonth(), 0));

  return {
    docType: 'creditcard',
    cardLast4, vencDate, totalFatura, sections, transactions, lastDayPrevMonth,
    holders: sections.map(s => s.holder).join(', '),
  };
}

// ---- run ----
const file = process.argv[2] || 'fixtures/sicoob-fatura-cartao.txt';
const raw = fs.readFileSync(file, 'utf8');
const result = parseSicoobCreditCard(raw);

console.log('cardLast4 (Conta Cartão):', result.cardLast4);
console.log('vencimento:', result.vencDate.toISOString().slice(0, 10));
console.log('total fatura:', result.totalFatura);
console.log('titulares:', result.holders);
console.log('nº lançamentos:', result.transactions.length);

const sumPurchases = result.transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
const expected = result.sections.reduce((s, sec) => s + sec.statedTotal, 0);
console.log('soma positivos:', sumPurchases.toFixed(2), '| soma seções:', expected.toFixed(2), '| diferença:', (sumPurchases - expected).toFixed(2));

console.log('\ntodas as transações:');
for (const t of result.transactions) {
  console.log(t.date.toISOString().slice(0, 10), t.amount.toFixed(2).padStart(10), '|', t.description);
}
