// === FORMATADORES E MÁSCARAS ===
const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = d => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(d);
const parseBRNumber = str => {
  if (!str) return 0;
  const s = String(str).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const v = parseFloat(s);
  return isNaN(v) ? 0 : v;
};

function attachBRLMask(el) {
  if (!el) return;
  el.addEventListener('input', () => {
    let dg = el.value.replace(/\D/g, '');
    if (!dg) { el.value = ''; return; }
    dg = dg.substring(0, 13);
    const val = (parseInt(dg, 10) / 100).toFixed(2);
    el.value = fmtBRL.format(val);
  });
  el.addEventListener('focus', () => {
    if (!el.value) el.value = 'R$ 0,00';
  });
  el.addEventListener('blur', () => {
    const v = parseBRNumber(el.value);
    el.value = v === 0 ? '' : fmtBRL.format(v);
  });
}

function attachPercentMask(el) {
  if (!el) return;
  el.addEventListener('input', () => {
    let dg = el.value.replace(/\D/g, '');
    if (!dg) { el.value = ''; return; }
    dg = dg.substring(0, 5);
    const val = (parseInt(dg, 10) / 100).toFixed(2);
    el.value = val.replace('.', ',');
  });
  el.addEventListener('blur', () => {
    const v = parseBRNumber(el.value);
    el.value = v === 0 ? '' : v.toFixed(2).replace('.', ',');
  });
}

// === ELEMENTOS ===
const $ = sel => document.querySelector(sel);
const el = {
  form: $('#amortForm'),
  principal: $('#principal'),
  periodo: $('#periodo'),
  sistema: $('#sistema'),
  tipoTaxa: $('#tipoTaxa'),
  dataInicio: $('#dataInicio'),
  rate: $('#rate'),
  extraMensal: $('#extraMensal'),
  extraValor: $('#extraValor'),
  extraData: $('#extraData'),
  addExtra: $('#addExtra'),
  extrasChips: $('#extrasChips'),
  seguroTaxa: $('#seguroTaxa'),
  prestacaoIni: $('#prestacaoIni'),
  totalPago: $('#totalPago'),
  totalJuros: $('#totalJuros'),
  mesesQuitados: $('#mesesQuitados'),
  tabela: $('#tabela tbody'),
  grafico: $('#grafico'),
  baixarCsv: $('#baixarCsv'),
  copiarLink: $('#copiarLink'),
  baixarPdf: $('#baixarPdf')
};

['#principal', '#seguroTaxa', '#extraValor', '#extraMensal'].forEach(sel => attachBRLMask($(sel)));
el.rate.addEventListener("input", () => {
  el.rate.value = el.rate.value.replace(",", ".");
});


const extras = [];

function monthIndexFromDate(startUTC, whenUTC) {
  const y1 = startUTC.getUTCFullYear(), m1 = startUTC.getUTCMonth();
  const y2 = whenUTC.getUTCFullYear(), m2 = whenUTC.getUTCMonth();
  return (y2 - y1) * 12 + (m2 - m1) + 1;
}

function renderExtrasChips() {
  el.extrasChips.innerHTML = '';
  extras.sort((a, b) => a.mes - b.mes).forEach((ex, idx) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = `${fmtDate(ex.data)} • ${fmtBRL.format(ex.valor)}`;
    chip.title = 'Clique para remover';
    chip.style.cursor = 'pointer';
    chip.onclick = () => { extras.splice(idx, 1); renderExtrasChips(); };
    el.extrasChips.appendChild(chip);
  });
}

el.addExtra.onclick = () => {
  const v = parseBRNumber(el.extraValor.value);
  const dStr = el.extraData.value;
  if (!(v > 0) || !dStr) return alert('Informe valor e data da amortização.');
  if (!el.dataInicio.value) return alert('Defina a Data do 1º vencimento antes de adicionar amortizações.');
  const [Y, M, D] = dStr.split('-').map(Number);
  const d = new Date(Date.UTC(Y, M - 1, D));
  const [Y0, M0, D0] = el.dataInicio.value.split('-').map(Number);
  const d0 = new Date(Date.UTC(Y0, M0 - 1, D0));
  const mes = monthIndexFromDate(d0, d);
  if (mes < 1) return alert('A data da amortização deve ser no mesmo mês do 1º vencimento ou após.');
  extras.push({ valor: v, data: d, mes });
  el.extraValor.value = ''; el.extraData.value = '';
  renderExtrasChips();
};

function mensalDeAnual(aa) {
  const a = (aa || 0) / 100;
  return Math.pow(1 + a, 1 / 12) - 1;
}

function pmtPrice(P, i, n) {
  if (i === 0) return P / n;
  const f = Math.pow(1 + i, n);
  return P * (i * f) / (f - 1);
}
function getTaxaMensal() {
  const taxa = parseFloat(el.rate.value);
  if (isNaN(taxa)) return 0;
  return el.tipoTaxa.value === "aa" ? mensalDeAnual(taxa) : taxa / 100;
}
function gerarCronograma({ principal, iMes, nMeses, sistema, extras, extraMensal, seguroTaxa, data0 }) {
  const linhas = [];
  let saldo = principal;
  let prestacaoFixa = sistema === 'price' ? pmtPrice(principal, iMes, nMeses) : 0;
  const amortConstante = sistema === 'sac' ? principal / nMeses : 0;
  const extrasPorMes = {};
  extras.forEach(ex => { extrasPorMes[ex.mes] = (extrasPorMes[ex.mes] || 0) + ex.valor; });

  let totalJuros = 0, totalPago = 0, mesesExecutados = 0;

  for (let m = 1; m <= nMeses && saldo > 0.005; m++) {
    const data = data0 ? new Date(Date.UTC(data0.getUTCFullYear(), data0.getUTCMonth() + m - 1, data0.getUTCDate())) : null;
    const juros = saldo * iMes;
    const taxas = seguroTaxa;
    let amort = 0, prest = 0;

    if (sistema === 'price') {
      prest = prestacaoFixa + taxas;
      amort = Math.min(prestacaoFixa - juros, saldo);
    } else {
      amort = Math.min(amortConstante, saldo);
      prest = amort + juros + taxas;
    }

    const extraAlvo = (extrasPorMes[m] || 0) + extraMensal;
    const extra = Math.min(extraAlvo, saldo - amort);
    saldo = Math.max(0, saldo - amort - extra);
    totalJuros += juros;
    totalPago += prest + extra;
    mesesExecutados = m;

    linhas.push({
      mes: m,
      data: data ? fmtDate(data) : '—',
      prestacao: prest,
      amortizacao: amort,
      juros,
      taxas,
      extra,
      saldo
    });
  }

  return {
    linhas,
    totalJuros: Math.round(totalJuros * 100) / 100,
    totalPago: Math.round(totalPago * 100) / 100,
    mesesExecutados
  };
}

function desenharGraficoAnual(canvas, linhas, data0) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width = canvas.clientWidth * devicePixelRatio;
  const H = canvas.height = canvas.clientHeight * devicePixelRatio;
  ctx.clearRect(0, 0, W, H);
  if (!linhas.length) return;

  const series = {};
  linhas.forEach((l, idx) => {
    let ano = 'Sem data';
    if (data0) {
      const d = new Date(Date.UTC(data0.getUTCFullYear(), data0.getUTCMonth() + idx, data0.getUTCDate()));
      ano = d.getUTCFullYear();
    }
    series[ano] = series[ano] || { juros: 0, amort: 0 };
    series[ano].juros += l.juros;
    series[ano].amort += l.amortizacao + l.extra;
  });

  const anos = Object.keys(series);
  const maxV = Math.max(1, ...anos.map(a => series[a].juros + series[a].amort));

  const padL = 50 * devicePixelRatio;
  const padB = 28 * devicePixelRatio;
  const padT = 20 * devicePixel
