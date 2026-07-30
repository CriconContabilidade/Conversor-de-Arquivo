// Dev/test harness for the Sicredi credit card invoice (fatura) parser.
// Run: node parse-sicredi-fatura.js <fixture.txt>
const fs = require('fs');

function parseBRL(str) {
  return parseFloat(String(str).replace(/R\$\s?/, '').replace(/\./g, '').replace(',', '.'));
}

const MONTHS = { jan:1, fev:2, mar:3, abr:4, mai:5, jun:6, jul:7, ago:8, set:9, out:10, nov:11, dez:12 };

function parseSicrediFatura(rawText) {
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

  const vencMatch = rawText.match(/Vencimento\s+(\d{2})\/(\d{2})\/(\d{4})/);
  if (!vencMatch) throw new Error('Vencimento não encontrado.');
  const vencDate = new Date(Date.UTC(+vencMatch[3], +vencMatch[2] - 1, +vencMatch[1]));

  const totalFaturaMatch = rawText.match(/Total desta Fatura\s+([\d.,]+)/);
  const totalFatura = totalFaturaMatch ? parseBRL(totalFaturaMatch[1]) : null;

  const cardMatch = rawText.match(/Visa Empresarial f[i̇]?nal\s+(\d+)/i);
  const cardLast4 = cardMatch ? cardMatch[1] : '';

  const TXN_LINE = /^(\d{2})\/([a-z]{3})\s+(\d{2}:\d{2})\s+(.+?)\s+(-?R\$\s?[\d.]+,\d{2})$/i;
  const PORTADOR_START = /^Cart[ãa]o portador\s+(.+?)\s*\(f[i̇]?nal\s+(\d+)\)$/i;
  const PORTADOR_TOTAL = /^Total cart[ãa]o portador\s*\(f[i̇]?nal\s+(\d+)\)\s+R\$\s?([\d.]+,\d{2})$/i;

  const sections = []; // { holder, cardLast4, transactions: [], statedTotal }
  const sectionByKey = new Map(); // "holder|cardLast4" -> section (header repeats on every page)
  let current = null;
  let currentYear = vencDate.getUTCFullYear();
  let prevMonth = null;
  let txnCounter = 0;

  for (const line of lines) {
    const pStart = line.match(PORTADOR_START);
    if (pStart) {
      const key = `${pStart[1].trim()}|${pStart[2]}`;
      if (sectionByKey.has(key)) {
        current = sectionByKey.get(key);
      } else {
        current = { holder: pStart[1].trim(), cardLast4: pStart[2], transactions: [], statedTotal: null };
        sections.push(current);
        sectionByKey.set(key, current);
        currentYear = vencDate.getUTCFullYear();
        prevMonth = null;
      }
      continue;
    }
    const pTotal = line.match(PORTADOR_TOTAL);
    if (pTotal && current) {
      current.statedTotal = parseBRL(pTotal[2]);
      continue;
    }
    const m = line.match(TXN_LINE);
    if (m && current) {
      const [, dd, mon, time, desc, valStr] = m;
      const monthNum = MONTHS[mon.toLowerCase()];
      if (!monthNum) continue;
      if (prevMonth !== null && monthNum > prevMonth) currentYear -= 1;
      prevMonth = monthNum;
      const date = new Date(Date.UTC(currentYear, monthNum - 1, +dd));
      const amount = parseBRL(valStr);
      txnCounter++;
      current.transactions.push({
        date, description: desc.trim(), amount,
        fitid: `${String(date.getUTCFullYear())}${String(monthNum).padStart(2,'0')}${dd}${String(txnCounter).padStart(4,'0')}`,
      });
    }
  }

  return { vencDate, totalFatura, cardLast4, sections };
}

// ---- run ----
const file = process.argv[2] || 'fixtures/sicredi-fatura.txt';
const raw = fs.readFileSync(file, 'utf8');
const result = parseSicrediFatura(raw);

console.log('vencimento:', result.vencDate.toISOString().slice(0,10));
console.log('total fatura:', result.totalFatura);
console.log('cartão final:', result.cardLast4);
console.log('nº seções (portadores):', result.sections.length);

for (const sec of result.sections) {
  console.log(`\n--- ${sec.holder} (final ${sec.cardLast4}) ---`);
  console.log('nº lançamentos:', sec.transactions.length);
  const sumPurchases = sec.transactions.filter(t => t.amount > 0).reduce((s,t) => s+t.amount, 0);
  console.log('soma compras (esperado', sec.statedTotal, '):', Math.round(sumPurchases*100)/100);
  console.log('diferença:', Math.round((sumPurchases - sec.statedTotal)*100)/100);
  console.log('primeiros 3:', sec.transactions.slice(0,3).map(t => `${t.date.toISOString().slice(0,10)} ${t.description} ${t.amount}`));
  console.log('últimos 3:', sec.transactions.slice(-3).map(t => `${t.date.toISOString().slice(0,10)} ${t.description} ${t.amount}`));
}
