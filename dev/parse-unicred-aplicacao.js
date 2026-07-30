// Dev/test harness for the Unicred "Demonstrativo de Rentabilidade" (investment) parser.
// Run: node parse-unicred-aplicacao.js <fixture.txt>
const fs = require('fs');

function parseBRL(str) {
  return parseFloat(str.replace(/\./g, '').replace(',', '.'));
}
function brToDate(str) {
  const [d, m, y] = str.split('/').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

const TITLE_ROW = /^(\S+)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+([\d.]+,\d{2})\s+([\d.,]+%)\s+(\S+)\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})$/;

function parseUnicredAplicacao(rawText) {
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

  const periodMatch = rawText.match(/Período de\s*(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/);
  const periodStart = brToDate(periodMatch[1]);
  const periodEnd = brToDate(periodMatch[2]);

  const clientMatch = rawText.match(/^(.+ - [\d.]+\/\d{4}-\d{2})$/m);
  const contaMatch = rawText.match(/Coop:\s*(\S+)\s*-\s*AG:\s*(\S+)\s*-\s*Conta:\s*(\S+)/);

  const titulos = [];
  for (const line of lines) {
    const m = line.match(TITLE_ROW);
    if (!m) continue;
    const [, titulo, dataAplicacaoStr, dataVencimentoStr, valorAplicadoStr, remuneracaoPct, remuneracaoIdx,
      saldoBrutoAnteriorStr, resgateStr, reversaoStr, rendimentoPagoStr, iofStr, irStr,
      rendimentoPeriodoStr, rendimentoAcumuladoStr, impostosProvStr, saldoBrutoAtualStr] = m;

    titulos.push({
      titulo,
      dataAplicacao: brToDate(dataAplicacaoStr),
      dataVencimento: brToDate(dataVencimentoStr),
      valorAplicado: parseBRL(valorAplicadoStr),
      remuneracao: `${remuneracaoPct} ${remuneracaoIdx}`,
      saldoBrutoAnterior: parseBRL(saldoBrutoAnteriorStr),
      resgate: parseBRL(resgateStr),
      reversao: parseBRL(reversaoStr),
      rendimentoPago: parseBRL(rendimentoPagoStr),
      iofRetido: parseBRL(iofStr),
      irRetido: parseBRL(irStr),
      rendimentoPeriodo: parseBRL(rendimentoPeriodoStr),
      rendimentoAcumulado: parseBRL(rendimentoAcumuladoStr),
      impostosProvisionados: parseBRL(impostosProvStr),
      saldoBrutoAtual: parseBRL(saldoBrutoAtualStr),
    });
  }

  return {
    client: clientMatch ? clientMatch[1] : '',
    account: contaMatch ? { coop: contaMatch[1], agencia: contaMatch[2], conta: contaMatch[3] } : null,
    periodStart, periodEnd, titulos,
  };
}

// Build the flat "event" rows per the accountant's requested mapping:
//  - histórico "data final do extrato / número da aplicação" + rendimento do período (sempre, se != 0)
//  - resgate se houver, na data do resgate (usa data de vencimento se ela cair dentro do período; senão fim do período)
//  - valor aplicado na data da aplicação (só se a aplicação ocorreu dentro do período do extrato)
//  - IRRF (come-cotas) se houver retenção de IR no período
function buildEvents({ periodStart, periodEnd, titulos }) {
  const events = [];
  const periodEndStr = fmtDate(periodEnd);
  const within = (d) => d >= periodStart && d <= periodEnd;

  for (const t of titulos) {
    if (within(t.dataAplicacao)) {
      events.push({ data: t.dataAplicacao, historico: `Aplicação ${t.titulo}`, valor: t.valorAplicado, tipo: 'Aplicação', titulo: t.titulo });
    }
    if (t.rendimentoPeriodo !== 0) {
      events.push({ data: periodEnd, historico: `${periodEndStr} / ${t.titulo}`, valor: t.rendimentoPeriodo, tipo: 'Rendimento', titulo: t.titulo });
    }
    if (t.irRetido > 0) {
      events.push({ data: periodEnd, historico: `IRRF (come-cotas) ${t.titulo}`, valor: -t.irRetido, tipo: 'IRRF', titulo: t.titulo });
    }
    if (t.resgate > 0) {
      const dataResgate = within(t.dataVencimento) ? t.dataVencimento : periodEnd;
      events.push({ data: dataResgate, historico: `Resgate ${t.titulo}`, valor: t.resgate, tipo: 'Resgate', titulo: t.titulo });
    }
  }
  return events;
}

// ---- run ----
const file = process.argv[2] || 'fixtures/unicred-aplicacao.txt';
const raw = fs.readFileSync(file, 'utf8');
const result = parseUnicredAplicacao(raw);

console.log('cliente:', result.client);
console.log('conta:', result.account);
console.log('período:', fmtDate(result.periodStart), '->', fmtDate(result.periodEnd));
console.log('nº títulos parseados:', result.titulos.length, '(esperado: 21)');

const sumRendPeriodo = result.titulos.reduce((s, t) => s + t.rendimentoPeriodo, 0);
console.log('soma rendimento período (esperado 8.123,26):', sumRendPeriodo.toFixed(2));
const sumValorAplicado = result.titulos.reduce((s, t) => s + t.valorAplicado, 0);
console.log('soma valor aplicado (esperado 488.568,41):', sumValorAplicado.toFixed(2));
const sumSaldoAtual = result.titulos.reduce((s, t) => s + t.saldoBrutoAtual, 0);
console.log('soma saldo bruto atual (esperado 743.107,43):', sumSaldoAtual.toFixed(2));

const events = buildEvents(result);
console.log('\nnº eventos gerados:', events.length);
for (const e of events) {
  console.log(fmtDate(e.data), '|', e.tipo.padEnd(10), '|', e.historico.padEnd(30), '|', e.valor.toFixed(2));
}
