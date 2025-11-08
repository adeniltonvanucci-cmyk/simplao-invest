/* =========================================================
   SIMPLÃO INVEST – Simulador (JS completo)
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
const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (d) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(d);

/* =========================================================
   Máscaras de entrada (Moeda e Percentual)
   ========================================================= */

/** Converte string BR ("R$ 1.234,56") para Number 1234.56 */
function parseBRNumber(str) {
  if (str == null) return 0;
  const s = String(str)
    .replace(/[^\d,.-]/g, '')   // mantém dígitos, vírgula, ponto e sinal
    .replace(/\./g, '')         // remove separador de milhar
    .replace(',', '.');         // vírgula -> ponto
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
    digits = digits.substring(0, 12);
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
    digits = digits.substring(0, 5);
    const val = (parseInt(digits, 10) / 100).toFixed(2);
    inputEl.value = String(val).replace('.', ',');
  });

  inputEl.addEventListener('blur', () => {
    const v = parsePercent(inputEl.value);
    inputEl.value = v === 0 ? '' : String(v.toFixed(2)).replace('.', ',');
  });
}

/* =========================================================
   IPCA automático (dados oficiais IBGE)
   ========================================================= */

const IPCA_API_URL = "https://apisidra.ibge.gov.br/values/t/7060/n1/all/v/63/p/last%201";

async function getIPCA12Meses() {
  try {
    const res = await fetch(IPCA_API_URL);
    const data = await res.json();

    // Filtra apenas o item com "IPCA - Variação acumulada em 12 meses"
    const acumulado = data.find(item => item.D2N?.includes("acumulada em 12 meses"));
    const ipcaValor = parseFloat(acumulado?.V.replace(",", "."));

    if (!isNaN(ipcaValor)) {
      console.log(`✅ IPCA acumulado em 12 meses: ${ipcaValor.toFixed(2)}%`);
    } else {
      console.warn("⚠️ IPCA acumulado não encontrado.");
    }
  } catch (e) {
    console.error("Erro ao buscar IPCA acumulado:", e);
  }
}

  } catch (e) {
    console.warn("⚠️ Falha ao buscar IPCA do IBGE. Usando fallback.");
    if (ipcaAnual && !ipcaAnual.value)
      ipcaAnual.value = String(IPCA_FALLBACK).replace(".", ",");
  }
}

/* =========================================================
   Lógica do simulador
   ========================================================= */

/** Mostra/oculta campos conforme o regime selecionado */
function updateRegimeUI() {
  const regimeVal = regime?.value || 'pre';
  const rows = document.querySelectorAll('[data-show-on]');
  rows.forEach(el => {
    const when = el.getAttribute('data-show-on');
    el.style.display = (when === regimeVal) ? '' : 'none';
  });
}

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
    return parsePercent(taxaPre.value);
  }
  if (regimeVal === 'pos') {
    const cdi = parsePercent(cdiAnual.value);
    const pcdi = parsePercent(percentCDI.value);
    return (cdi * pcdi) / 100;
  }
  if (regimeVal === 'ipca') {
    const ipca = parsePercent(ipcaAnual.value) / 100;
    const fixo = parsePercent(spread.value) / 100;
    const taxaEfetiva = (1 + ipca) * (1 + fixo) - 1;
    return taxaEfetiva * 100; // composto
  }
  return 0;
}

/** LCI/LCA são isentos de IR */
function isIsentoIR(tipoVal) {
  const t = (tipoVal || '').toUpperCase();
  return (t.includes('LCI') || t.includes('LCA'));
}

/** IOF simplificado (opcional) */
function aplicarIOFSimplificado(jurosMes, mesIndex, iofFlag) {
  if (iofFlag !== 'sim') return jurosMes;
  if (mesIndex === 0) return jurosMes * 0.5;
  return jurosMes;
}

/** Executa a simulação */
function calcular() {
  const tipoVal   = tipo?.value || 'CDB';
  const regimeVal = regime?.value || 'pre';
  const aporte0   = parseBRNumber(aporteInicial.value);
  const aporteMes = parseBRNumber(aporteMensal.value);
  const meses     = parseInt(prazoMeses.value, 10) || 0;
  const usarIOF   = (iofSelect?.value || 'nao');

  let dataBase = new Date();
  if (dataInicio && dataInicio.value) {
    const [yyyy, mm, dd] = dataInicio.value.split('-').map(Number);
    if (yyyy && mm && dd) dataBase = new Date(Date.UTC(yyyy, mm - 1, dd));
  }

  const taxaAnualPercent = obterTaxaAnual(regimeVal);
  const taxaMensal = annualPercentToMonthlyRate(taxaAnualPercent);

  let saldo = 0, totalAportes = 0, totalJurosBrutos = 0;

  saldo += aporte0;
  totalAportes += aporte0;

  if (tbody) tbody.innerHTML = '';

  for (let m = 0; m < meses; m++) {
    const d = new Date(Date.UTC(
      dataBase.getUTCFullYear(),
      dataBase.getUTCMonth() + m + 1,
      dataBase.getUTCDate()
    ));

    if (aporteMes > 0) {
      saldo += aporteMes;
      totalAportes += aporteMes;
    }

    let jurosMes = saldo * taxaMensal;
    jurosMes = aplicarIOFSimplificado(jurosMes, m, usarIOF);

    saldo += jurosMes;
    totalJurosBrutos += jurosMes;

    if (tbody) {
      const tr = document.createElement('tr');
      const tdMes   = document.createElement('td'); tdMes.textContent = (m + 1).toString();
      const tdData  = document.createElement('td'); tdData.textContent = fmtDate(d);
      const tdSaldo = document.createElement('td'); tdSaldo.textContent = fmtBRL.format(saldo);
      const tdAp    = document.createElement('td'); tdAp.textContent   = fmtBRL.format(aporteMes);
      const tdJ     = document.createElement('td'); tdJ.textContent    = fmtBRL.format(jurosMes);
      tr.append(tdMes, tdData, tdSaldo, tdAp, tdJ);
      tbody.appendChild(tr);
    }
  }

  const diasTotais = meses * 30;
  const bruto = totalJurosBrutos;
  const liquidoIR = isIsentoIR(tipoVal) ? 0 : bruto * aliquotaIR(diasTotais);

  const saldoFinalLiquido = saldo - liquidoIR;
  const totalInvestido    = totalAportes;
  const rendimentoBruto   = saldo - totalAportes;
  const impostos          = liquidoIR;

  if (saldoLiquidoEl)    saldoLiquidoEl.textContent   = fmtBRL.format(saldoFinalLiquido);
  if (totalInvestidoEl)  totalInvestidoEl.textContent = fmtBRL.format(totalInvestido);
  if (rendimentoBrutoEl) rendimentoBrutoEl.textContent= fmtBRL.format(rendimentoBruto);
  if (impostosEl)        impostosEl.textContent       = fmtBRL.format(impostos);
}

/* =========================================================
   Inicialização
   ========================================================= */

function init() {
  updateRegimeUI();

  // Atualiza IPCA automaticamente ao carregar
  setIPCAFromIBGE();

  // Recarrega IPCA ao trocar regime para IPCA+
  regime?.addEventListener('change', () => {
    updateRegimeUI();
    if (regime.value === 'ipca') setIPCAFromIBGE();
  });

  attachBRLMask(aporteInicial);
  attachBRLMask(aporteMensal);
  attachPercentMask(taxaPre);
  attachPercentMask(percentCDI);
  attachPercentMask(cdiAnual);
  attachPercentMask(ipcaAnual);
  attachPercentMask(spread);

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    calcular();
  });

  calcular();

  const anoEl = document.querySelector('#ano');
  if (anoEl) anoEl.textContent = String(new Date().getFullYear());
}

// DOM pronto
document.addEventListener('DOMContentLoaded', init);
