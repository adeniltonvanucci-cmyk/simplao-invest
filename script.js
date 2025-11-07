// ====== CONFIGURAÇÃO RÁPIDA ======
// Troque para true se quiser calcular SOMENTE ao clicar no botão "Calcular".
const CALC_APENAS_NO_BOTAO = false;

// ====== Helpers de moeda/percentual ======
function formatMoneyBR(n) {
  try {
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  } catch {
    return `R$ ${n.toFixed(2).replace('.', ',')}`;
  }
}
function parseBRNumber(s) {
  if (typeof s !== 'string') s = String(s ?? '');
  // remove "R$ ", pontos e troca vírgula por ponto
  s = s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const v = parseFloat(s);
  return isNaN(v) ? 0 : v;
}
function attachMoneyMask(input) {
  if (!input) return;
  input.addEventListener('input', () => {
    const onlyDigits = input.value.replace(/\D/g, '');
    const v = Number(onlyDigits) / 100; // 123456 -> 1234.56
    input.value = formatMoneyBR(v);
  });
  input.addEventListener('blur', () => {
    if (!input.value.trim()) input.value = formatMoneyBR(0);
  });
}

// ====== Mapeamento dos elementos ======
const els = {
  regime:         document.getElementById('regime'),
  taxaPre:        document.getElementById('taxaPre'),
  percentCDI:     document.getElementById('percentCDI'),
  cdiAnual:       document.getElementById('cdiAnual'),
  ipcaAnual:      document.getElementById('ipcaAnual'),
  spread:         document.getElementById('spread'),

  wrapTaxaPre:    document.getElementById('wrap-taxaPre'),
  wrapPercentCDI: document.getElementById('wrap-percentCDI'),
  wrapCdiAnual:   document.getElementById('wrap-cdiAnual'),
  wrapIpcaAnual:  document.getElementById('wrap-ipcaAnual'),
  wrapSpread:     document.getElementById('wrap-spread'),

  aporteInicial:   document.getElementById('aporteInicial'),
  aporteMensal:    document.getElementById('aporteMensal'),
  prazoMeses:      document.getElementById('prazoMeses'),
  dataInicio:      document.getElementById('dataInicio'),

  saldoLiquido:     document.getElementById('saldoLiquido'),
  totalInvestido:   document.getElementById('totalInvestido'),
  rendimentoBruto:  document.getElementById('rendimentoBruto'),
  impostos:         document.getElementById('impostos'),

  tabelaBody:     document.getElementById('tabelaBody'),
  resultsBox:     document.getElementById('resultsBox'),
  emptyMsg:       document.getElementById('emptyMsg'),

  btnCalcular:    document.getElementById('btnCalcular') // se tiver um botão
};

// ====== Máscara de moeda nos aportes ======
attachMoneyMask(els.aporteInicial);
attachMoneyMask(els.aporteMensal);

// ====== Visibilidade por regime ======
function updateRegimeVisibility() {
  const r = els.regime.value; // 'pre' | 'pos' | 'ipca'

  // Esconde tudo…
  [els.wrapTaxaPre, els.wrapPercentCDI, els.wrapCdiAnual, els.wrapIpcaAnual, els.wrapSpread]
    .forEach(w => w && w.classList.add('hidden'));

  // Mostra apenas os campos relevantes
  if (r === 'pre') {
    els.wrapTaxaPre?.classList.remove('hidden');
  } else if (r === 'pos') {
    els.wrapPercentCDI?.classList.remove('hidden');
    els.wrapCdiAnual?.classList.remove('hidden');
  } else if (r === 'ipca') {
    els.wrapIpcaAnual?.classList.remove('hidden');
    els.wrapSpread?.classList.remove('hidden');
  }
}

// ====== Taxa mensal conforme regime ======
function monthlyRateFromRegime() {
  const r = els.regime.value;

  let anual = 0;
  if (r === 'pre') {
    const taxaPre = parseBRNumber(els.taxaPre.value) / 100;
    anual = taxaPre;
  } else if (r === 'pos') {
    const percentCDI = parseBRNumber(els.percentCDI.value) / 100; // 1,05 -> 0,0105? (é 105% do CDI)
    const cdi = parseBRNumber(els.cdiAnual.value) / 100;
    anual = percentCDI * cdi; // ex.: 105% * 10,75% = 0,105 * 0,1075 => 0,112875 (11,2875% a.a.)
  } else if (r === 'ipca') {
    const ipca = parseBRNumber(els.ipcaAnual.value) / 100;
    const fixo = parseBRNumber(els.spread.value) / 100;
    anual = (1 + ipca) * (1 + fixo) - 1; // composição IPCA + taxa fixa
  }

  // converte a.a. para a.m. (juros compostos)
  const am = Math.pow(1 + anual, 1 / 12) - 1;
  return am;
}

// ====== Limpa resultados e mostra estado vazio ======
function showEmpty() {
  if (els.tabelaBody) els.tabelaBody.innerHTML = '';
  if (els.saldoLiquido)    els.saldoLiquido.textContent = '—';
  if (els.totalInvestido)  els.totalInvestido.textContent = '—';
  if (els.rendimentoBruto) els.rendimentoBruto.textContent = '—';
  if (els.impostos)        els.impostos.textContent = '—';

  els.resultsBox?.classList.add('hidden');
  els.emptyMsg?.classList.remove('hidden');
}

// ====== Mostra resultados ======
function showResults() {
  els.emptyMsg?.classList.add('hidden');
  els.resultsBox?.classList.remove('hidden');
}

// ====== IR regressivo por prazo total ======
function aliquotaIR(meses) {
  if (meses <= 6)  return 0.225;
  if (meses <= 12) return 0.20;
  if (meses <= 24) return 0.175;
  return 0.15;
}

// ====== Cálculo principal ======
function calcular() {
  // 1) se não houver capital, não calcula
  const aporteIni = parseBRNumber(els.aporteInicial.value);
  const aporteMen = parseBRNumber(els.aporteMensal.value);
  const meses     = parseInt(els.prazoMeses.value || '0', 10);

  if (!(aporteIni > 0 || aporteMen > 0)) {
    showEmpty();
    return;
  }

  // 2) prepara
  const i = monthlyRateFromRegime(); // taxa mensal
  const tbody = els.tabelaBody;
  if (tbody) tbody.innerHTML = '';

  let saldo = aporteIni;
  let totalAportes = aporteIni;
  let rendimentoBruto = 0;

  // Data
  let dataBase = els.dataInicio && els.dataInicio.value
    ? new Date(els.dataInicio.value + 'T00:00:00')
    : new Date();
  if (isNaN(dataBase.getTime())) dataBase = new Date();

  // 3) itera mês a mês (juros no saldo + aporte, aporte no fim do mês)
  for (let m = 1; m <= meses; m++) {
    // juros do mês sobre o saldo atual
    const jurosMes = saldo * i;
    saldo += jurosMes;
    rendimentoBruto += jurosMes;

    // aporta ao final do mês
    if (aporteMen > 0) {
      saldo += aporteMen;
      totalAportes += aporteMen;
    }

    // escreve linha
    if (tbody) {
      const tr = document.createElement('tr');
      const dataMes = new Date(dataBase);
      dataMes.setMonth(dataMes.getMonth() + m); // mês m

      const tdMes  = `<td>${m}</td>`;
      const tdData = `<td>${dataMes.toLocaleDateString('pt-BR')}</td>`;
      const tdSaldo = `<td>${formatMoneyBR(saldo)}</td>`;
      const tdAporte = `<td>${formatMoneyBR(aporteMen)}</td>`;
      const tdJuros = `<td>${formatMoneyBR(jurosMes)}</td>`;
      tr.innerHTML = tdMes + tdData + tdSaldo + tdAporte + tdJuros;
      tbody.appendChild(tr);
    }
  }

  // 4) IR regressivo sobre rendimento: aprox. no final
  const baseIR = Math.max(0, saldo - totalAportes);
  const ir = baseIR * aliquotaIR(meses);
  const saldoLiquido = saldo - ir;

  // 5) preenche cards
  if (els.saldoLiquido)    els.saldoLiquido.textContent    = formatMoneyBR(saldoLiquido);
  if (els.totalInvestido)  els.totalInvestido.textContent  = formatMoneyBR(totalAportes);
  if (els.rendimentoBruto) els.rendimentoBruto.textContent = formatMoneyBR(rendimentoBruto);
  if (els.impostos)        els.impostos.textContent        = formatMoneyBR(ir);

  showResults();
}

// ====== Gatilhos ======
function recalcIfLive() {
  if (!CALC_APENAS_NO_BOTAO) calcular();
}

['input', 'change'].forEach(ev => {
  els.regime?.addEventListener(ev, () => { updateRegimeVisibility(); recalcIfLive(); });
  els.taxaPre?.addEventListener(ev, recalcIfLive);
  els.percentCDI?.addEventListener(ev, recalcIfLive);
  els.cdiAnual?.addEventListener(ev, recalcIfLive);
  els.ipcaAnual?.addEventListener(ev, recalcIfLive);
  els.spread?.addEventListener(ev, recalcIfLive);
  els.aporteInicial?.addEventListener(ev, recalcIfLive);
  els.aporteMensal?.addEventListener(ev, recalcIfLive);
  els.prazoMeses?.addEventListener(ev, recalcIfLive);
  els.dataInicio?.addEventListener(ev, recalcIfLive);
});

// Se existir botão, usa ele para calcular (ou deixe live se CALC_APENAS_NO_BOTAO=false)
els.btnCalcular?.addEventListener('click', (e) => {
  e.preventDefault();
  calcular();
});

// Estado inicial
updateRegimeVisibility();
showEmpty(); // começa com tela vazia
