/* =========================================================
   SIMPLÃO INVEST – Simulador (JS completo, revisado)
   ========================================================= */

/* ===========================
   Seletores de elementos
   =========================== */
const tipo           = document.querySelector('#tipo');             // CDB, LCI, LCA, Tesouro, etc.
const regime         = document.querySelector('#regime');           // pre | pos | ipca

// Campos de taxa / parâmetros do regime
const taxaPre        = document.querySelector('#taxaPre');          // % a.a. (Pré)
const percentCDI     = document.querySelector('#percentCDI');       // % sobre CDI (Pós)
const cdiAnual       = document.querySelector('#cdiAnual');         // % a.a. do CDI (Pós)
const ipcaAnual      = document.querySelector('#ipcaAnual');        // % a.a. do IPCA (IPCA+)
const spread         = document.querySelector('#spread');           // % a.a. fixo (IPCA+)

const aporteInicial  = document.querySelector('#aporteInicial');    // R$
const aporteMensal   = document.querySelector('#aporteMensal');     // R$
const prazoMeses     = document.querySelector('#prazoMeses');       // meses (número)
const iofSelect      = document.querySelector('#iof');              // "sim" | "nao"
const dataInicio     = document.querySelector('#dataInicio');       // date

// Resultados (cards)
const saldoLiquidoEl     = document.querySelector('#saldoLiquido');
const totalInvestidoEl   = document.querySelector('#totalInvestido');
const rendimentoBrutoEl  = document.querySelector('#rendimentoBruto');
const impostosEl         = document.querySelector('#impostos');     // IR estimado

// Tabela
const tbody          = document.querySelector('#tabela tbody');

// Form
const form           = document.querySelector('#simForm');

// Outras utilidades
const fmtBRL  = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (d) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(d);

/* =========================================================
   Máscaras de entrada (Moeda e Percentual)
   ========================================================= */

/** Converte string BR ("R$ 1.234,56") para Number 1234.56 */
function parseBRNumber(str) {
  if (str == null) return 0;
  const s = String(str)
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const v = parseFloat(s);
  return isNaN(v) ? 0 : v;
}

/** Converte string de percentual BR ("12,5") em Number 12.5 */
function parsePercent(str) {
  return parseBRNumber(str);
}

/** Máscara BRL: digite só números → formata "R$ 0,00" em tempo real */
function attachBRLMask(inputEl) {
  if (!inputEl) return;

  inputEl.addEventListener('input', () => {
    let digits = inputEl.value.replace(/\D/g, '');
    if (!digits) {
      inputEl.value = '';
      return;
    }
    digits = digits.substring(0, 12); // até 9.999.999.999,99
    const val = (parseInt(digits, 10) / 100).toFixed(2);
    inputEl.value = fmtBRL.format(val);
  });

  inputEl.addEventListener('focus', () => {
    if (!inputEl.value) inputEl.value = 'R$ 0,00';
  });

  inputEl.addEventListener('blur', () => {
    const v = parseBRNumber(inputEl.value);
    inputEl.value = v === 0 ? '' : fmtBRL.format(v);
  });
}

/** Máscara Percentual: digite só números → formata "12,50" em tempo real */
function attachPercentMask(inputEl) {
  if (!inputEl) return;

  inputEl.addEventListener('input', () => {
    let digits = inputEl.value.replace(/\D/g, '');
    if (!digits) {
      inputEl.value = '';
      return;
    }
    digits = digits.substring(0, 5); // 999,99
    const val = (parseInt(digits, 10) / 100).toFixed(2);
    inputEl.value = String(val).replace('.', ',');
  });

  inputEl.addEventListener('blur', () => {
    const v = parsePercent(inputEl.value);
    inputEl.value = v === 0 ? '' : String(v.toFixed(2)).replace('.', ',');
  });
}

/* =========================================================
   Visibilidade por regime
   ========================================================= */

/* mapeia os campos que pertencem a cada regime */
const FIELDS_BY_REGIME = {
  pre:  ['taxaPre'],
  pos:  ['percentCDI', 'cdiAnual'],
  ipca: ['ipcaAnual', 'spread'],
};

/** aplica .hidden nos wrappers de campos que não pertencem ao regime atual
 *  cada wrapper deve ter data-field="idDoCampo"
 */
function updateVisibleFields() {
  const current = (regime?.value || 'pre').toLowerCase();
  const visible = new Set(FIELDS_BY_REGIME[current] || []);

  document.querySelectorAll('[data-field]').forEach(row => {
    const key = row.getAttribute('data-field');
    row.classList.toggle('hidden', !visible.has(key));
  });

  // se por acaso houver elementos antigos com data-show-on, ainda respeitamos:
  document.querySelectorAll('[data-show-on]').forEach(el => {
    const when = el.getAttribute('data-show-on');
    el.classList.toggle('hidden', when !== current);
  });
}

/* =========================================================
   Lógica do simulador
   ========================================================= */

/** Converte taxa anual (%) em taxa mensal decimal */
function annualPercentToMonthlyRate(annualPercent) {
  const a = (annualPercent || 0) / 100;
  return Math.pow(1 + a, 1 / 12) - 1;
}

/** Calcula alíquota de IR conforme prazo total (dias) – tabela regressiva */
function aliquotaIR(dias) {
  if (dias <= 180) return 0.225;
  if (dias <= 360) return 0.20;
  if (dias <= 720) return 0.175;
  return 0.15;
}

/** Define taxa efetiva anual conforme regime */
function obterTaxaAnual(regimeVal) {
  if (regimeVal === 'pre') {
    return parsePercent(taxaPre.value); // % a.a.
  }
  if (regimeVal === 'pos') {
    const cdi = parsePercent(cdiAnual.value);      // % a.a.
    const pcdi = parsePercent(percentCDI.value);   // %
    return (cdi * pcdi) / 100;                     // % a.a.
  }
  if (regimeVal === 'ipca') {
    const ipca = parsePercent(ipcaAnual.value);    // % a.a.
    const fixo = parsePercent(spread.value);       // % a.a.
    return ipca + fixo;                            // % a.a.
  }
  return 0;
}

/** LCI/LCA são isentos de IR */
function isIsentoIR(tipoVal) {
  const t = (tipoVal || '').toUpperCase();
  return (t.includes('LCI') || t.includes('LCA'));
}

/** IOF simplificado (opcional) – reduz juros do 1º mês (~50%) */
function aplicarIOFSimplificado(jurosMes, mesIndex, iofFlag) {
  if (iofFlag !== 'sim') return jurosMes;
  if (mesIndex === 0) return jurosMes * 0.5;
  return jurosMes;
}

/** Limpa cards e tabela */
function limparResultados() {
  if (tbody) tbody.innerHTML = '';
  if (saldoLiquidoEl)    saldoLiquidoEl.textContent    = '—';
  if (totalInvestidoEl)  totalInvestidoEl.textContent  = '—';
  if (rendimentoBrutoEl) rendimentoBrutoEl.textContent = '—';
  if (impostosEl)        impostosEl.textContent        = '—';
}

/** Executa a simulação */
function calcular() {
  const tipoVal       = tipo?.value || 'CDB';
  const regimeVal     = regime?.value || 'pre';
  const aporte0       = parseBRNumber(aporteInicial.value);
  const aporteMes     = parseBRNumber(aporteMensal.value);
  const meses         = parseInt(prazoMeses.value, 10) || 0;
  const usarIOF       = (iofSelect?.value || 'nao');

  // Se não há investimento (nem inicial nem mensal) ou prazo não definido → não calcula
  if ((aporte0 <= 0 && aporteMes <= 0) || meses <= 0) {
    limparResultados();
    return;
  }

  // Data inicial
  let dataBase = new Date();
  if (dataInicio && dataInicio.value) {
    const [yyyy, mm, dd] = dataInicio.value.split('-').map(Number);
    if (yyyy && mm && dd) dataBase = new Date(Date.UTC(yyyy, mm - 1, dd));
  }

  // Taxas
  const taxaAnualPercent = obterTaxaAnual(regimeVal);      // % a.a.
  const taxaMensal       = annualPercentToMonthlyRate(taxaAnualPercent); // decimal

  // Loop
  let saldo = 0;
  let totalAportes = 0;
  let totalJurosBrutos = 0;

  if (tbody) tbody.innerHTML = '';

  // mês 0 – aporte inicial
  if (aporte0 > 0) {
    saldo += aporte0;
    totalAportes += aporte0;
  }

  for (let m = 0; m < meses; m++) {
    const d = new Date(Date.UTC(
      dataBase.getUTCFullYear(),
      dataBase.getUTCMonth() + m + 1,
      dataBase.getUTCDate()
    ));

    // aporte do mês (no início do mês para render)
    if (aporteMes > 0) {
      saldo += aporteMes;
      totalAportes += aporteMes;
    }

    // juros do mês
    let jurosMes = saldo * taxaMensal;
    jurosMes = aplicarIOFSimplificado(jurosMes, m, usarIOF);

    saldo += jurosMes;
    totalJurosBrutos += jurosMes;

    // linha da tabela
    if (tbody) {
      const tr = document.createElement('tr');

      const tdMes   = document.createElement('td');  tdMes.textContent = (m + 1).toString();
      const tdData  = document.createElement('td');  tdData.textContent = fmtDate(d);
      const tdSaldo = document.createElement('td');  tdSaldo.textContent = fmtBRL.format(saldo);
      const tdAp    = document.createElement('td');  tdAp.textContent   = fmtBRL.format(aporteMes);
      const tdJ     = document.createElement('td');  tdJ.textContent    = fmtBRL.format(jurosMes);

      tr.append(tdMes, tdData, tdSaldo, tdAp, tdJ);
      tbody.appendChild(tr);
    }
  }

  // IR no resgate (exceto LCI/LCA)
  const diasTotais = meses * 30; // aproximação
  const bruto      = totalJurosBrutos;
  const ir         = isIsentoIR(tipoVal) ? 0 : bruto * aliquotaIR(diasTotais);

  const saldoFinalLiquido = saldo - ir;
  const totalInvestido    = totalAportes;
  const rendimentoBruto   = saldo - totalAportes;
  const impostos          = ir;

  // Cards
  if (saldoLiquidoEl)    saldoLiquidoEl.textContent   = fmtBRL.format(saldoFinalLiquido);
  if (totalInvestidoEl)  totalInvestidoEl.textContent = fmtBRL.format(totalInvestido);
  if (rendimentoBrutoEl) rendimentoBrutoEl.textContent= fmtBRL.format(rendimentoBruto);
  if (impostosEl)        impostosEl.textContent       = fmtBRL.format(impostos);
}

/* =========================================================
   Inicialização
   ========================================================= */
function init() {
  // visibilidade por regime
  updateVisibleFields();
  regime?.addEventListener('change', updateVisibleFields);

  // Máscaras
  attachBRLMask(aporteInicial);
  attachBRLMask(aporteMensal);

  attachPercentMask(taxaPre);
  attachPercentMask(percentCDI);
  attachPercentMask(cdiAnual);
  attachPercentMask(ipcaAnual);
  attachPercentMask(spread);

  // Submissão do form
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    calcular();
  });

  // Não calcular na carga se não houver investimentos
  limparResultados();

  // Ano no rodapé (se existir)
  const anoEl = document.querySelector('#ano');
  if (anoEl) anoEl.textContent = String(new Date().getFullYear());
}

document.addEventListener('DOMContentLoaded', init);
