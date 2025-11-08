/* =========================================================
   SIMPLÃO INVEST – Simulador (Base 365, IR por dias, IOF diário)
   ========================================================= */

/* ----------------- Seletores (mesmos do seu script) ----------------- */
const tipo           = document.querySelector('#tipo');
const regime         = document.querySelector('#regime');

const taxaPre        = document.querySelector('#taxaPre');
const percentCDI     = document.querySelector('#percentCDI');
const cdiAnual       = document.querySelector('#cdiAnual');
const ipcaAnual      = document.querySelector('#ipcaAnual');
const spread         = document.querySelector('#spread');

const aporteInicial  = document.querySelector('#aporteInicial');
const aporteMensal   = document.querySelector('#aporteMensal');
const prazoMeses     = document.querySelector('#prazoMeses');
const iofSelect      = document.querySelector('#iof');
const dataInicio     = document.querySelector('#dataInicio');

const saldoLiquidoEl     = document.querySelector('#saldoLiquido');
const totalInvestidoEl   = document.querySelector('#totalInvestido');
const rendimentoBrutoEl  = document.querySelector('#rendimentoBruto');
const impostosEl         = document.querySelector('#impostos');

const tbody          = document.querySelector('#tabela tbody');
const form           = document.querySelector('#simForm');

const fmtBRL  = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (d) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(d);

/* ----------------- Utilidades e máscaras (iguais às suas) ----------------- */
function parseBRNumber(str) {
  if (str == null) return 0;
  const s = String(str).replace(/[^\d,.-]/g,'').replace(/\./g,'').replace(',', '.');
  const v = parseFloat(s); return isNaN(v) ? 0 : v;
}
function parsePercent(str){ return parseBRNumber(str); }
function attachBRLMask(inputEl){
  if(!inputEl) return;
  inputEl.addEventListener('input',()=>{
    let d = inputEl.value.replace(/\D/g,''); if(!d){inputEl.value='';return;}
    d = d.substring(0,12); const val = (parseInt(d,10)/100).toFixed(2); inputEl.value = fmtBRL.format(val);
  });
  inputEl.addEventListener('focus',()=>{ if(!inputEl.value) inputEl.value='R$ 0,00'; });
  inputEl.addEventListener('blur',()=>{ const v=parseBRNumber(inputEl.value); inputEl.value=v===0?'':fmtBRL.format(v);});
}
function attachPercentMask(inputEl){
  if(!inputEl) return;
  inputEl.addEventListener('input',()=>{
    let d=inputEl.value.replace(/\D/g,''); if(!d){inputEl.value='';return;}
    d=d.substring(0,5); const val=(parseInt(d,10)/100).toFixed(2); inputEl.value=String(val).replace('.',',');
  });
  inputEl.addEventListener('blur',()=>{ const v=parsePercent(inputEl.value); inputEl.value=v===0?'':String(v.toFixed(2)).replace('.',',');});
}

/* ----------------- Helpers específicos p/ base 365 ----------------- */
const DAY_MS = 24*60*60*1000;
function startDateUTC(){
  let d = new Date();
  if (dataInicio && dataInicio.value){
    const [yyyy,mm,dd] = dataInicio.value.split('-').map(Number);
    if(yyyy && mm && dd) d = new Date(Date.UTC(yyyy,mm-1,dd));
  } else {
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  return d;
}
function addMonthsUTC(dt, months){
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth()+months, dt.getUTCDate()));
}
function diffDays(a,b){ // b - a, em dias
  return Math.round((b.getTime()-a.getTime())/DAY_MS);
}

/* Alíquota IR pela tabela regressiva – por dias corridos */
function aliquotaIRPorDias(dias){
  if (dias <= 180) return 0.225;
  if (dias <= 360) return 0.20;
  if (dias <= 720) return 0.175;
  return 0.15;
}

/* IOF diário (tabela oficial aproximada linear). 0 a 30 dias. */
function iofPercentPorDias(dias){
  if (dias <= 0) return 1.0;
  if (dias >= 30) return 0.0;
  // aproximação linear decrescente: 1.0 → 0.0 em 30 dias
  return (30 - dias) / 30;
}

/* Converte taxa anual (%) em taxa diária decimal (base 365) */
function annualPercentToDailyRate(annualPercent){
  const a = (annualPercent||0)/100;
  return Math.pow(1+a, 1/365) - 1;
}

/* Obtém taxa anual efetiva de acordo com o regime selecionado */
function obterTaxaAnual(regimeVal){
  if (regimeVal==='pre'){
    return parsePercent(taxaPre.value);                   // % a.a.
  }
  if (regimeVal==='pos'){
    const cdi = parsePercent(cdiAnual.value);             // % a.a.
    const pcdi= parsePercent(percentCDI.value);           // %
    return (cdi * pcdi)/100;                              // % a.a.
  }
  if (regimeVal==='ipca'){
    const ipca = parsePercent(ipcaAnual.value);           // % a.a.
    const fixo = parsePercent(spread.value);              // % a.a.
    return ipca + fixo;                                   // % a.a.
  }
  return 0;
}

/* LCI/LCA isento de IR */
function isIsentoIR(tipoVal){
  const t=(tipoVal||'').toUpperCase();
  return (t.includes('LCI') || t.includes('LCA'));
}

/* Mostra/oculta campos por regime */
function updateRegimeUI(){
  const v = regime?.value || 'pre';
  document.querySelectorAll('[data-show-on]').forEach(el=>{
    el.style.display = (el.getAttribute('data-show-on')===v) ? '' : 'none';
  });
}

/* ----------------- ENGINE DIÁRIA (365) ----------------- */
function calcular(){
  const tipoVal       = tipo?.value || 'CDB';
  const regimeVal     = regime?.value || 'pre';
  const aporte0       = parseBRNumber(aporteInicial.value);
  const aporteMes     = parseBRNumber(aporteMensal.value);
  const meses         = Math.max(0, parseInt(prazoMeses.value,10) || 0);
  const usarIOF       = (iofSelect?.value || 'nao');

  // datas
  const d0 = startDateUTC();
  const dFim = addMonthsUTC(d0, meses);

  // taxa diária
  const taxaAA   = obterTaxaAnual(regimeVal);        // % a.a.
  const taxaDia  = annualPercentToDailyRate(taxaAA); // decimal ao dia

  // estado
  let saldo = 0;
  let totalAportes = 0;
  let rendimentoBruto = 0;

  // aporte inicial (D0)
  saldo += aporte0; totalAportes += aporte0;

  // tabela
  if (tbody) tbody.innerHTML = '';

  // vamos iterar de mês em mês, aplicando juros diariamente dentro de cada mês,
  // e registrando uma linha por mês (para manter sua UI enxuta).
  let dataCursor = new Date(d0.getTime());
  let mesIndex = 0;

  while (dataCursor < dFim){
    // data do fim do mês corrente (ou data final)
    const proxMes = addMonthsUTC(d0, mesIndex+1);
    const dataLimite = (proxMes < dFim) ? proxMes : dFim;

    // aporte mensal no INÍCIO de cada mês (exceto mês 0, já fizemos aporte inicial)
    if (mesIndex > 0 && aporteMes > 0){
      saldo += aporteMes; totalAportes += aporteMes;
    }

    // juros diários do pedaço [dataCursor, dataLimite)
    const diasPeriodo = diffDays(dataCursor, dataLimite);
    let jurosPeriodo = 0;
    for (let i=0;i<diasPeriodo;i++){
      const diaIndexGlobal = diffDays(d0, new Date(dataCursor.getTime()+i*DAY_MS));
      let jurosDia = saldo * taxaDia;

      // IOF diário até 30 dias
      if (usarIOF==='sim'){
        const fatorIOF = iofPercentPorDias(diaIndexGlobal+1); // 1..30
        jurosDia = jurosDia * (1 - fatorIOF);
      }

      saldo += jurosDia;
      jurosPeriodo += jurosDia;
    }
    rendimentoBruto += jurosPeriodo;

    // adiciona linha mensal
    if (tbody){
      const tr = document.createElement('tr');
      const tdMes   = document.createElement('td'); tdMes.textContent = String(mesIndex+1);
      const tdData  = document.createElement('td'); tdData.textContent = fmtDate(dataLimite);
      const tdSaldo = document.createElement('td'); tdSaldo.textContent = fmtBRL.format(saldo);
      const tdAp    = document.createElement('td'); tdAp.textContent   = fmtBRL.format(mesIndex>0?aporteMes:aporte0);
      const tdJ     = document.createElement('td'); tdJ.textContent    = fmtBRL.format(jurosPeriodo);
      tr.append(tdMes, tdData, tdSaldo, tdAp, tdJ);
      tbody.appendChild(tr);
    }

    dataCursor = dataLimite;
    mesIndex++;
  }

  // IR sobre rendimento total conforme dias corridos
  const diasTotais = diffDays(d0, dFim);
  const ir = isIsentoIR(tipoVal) ? 0 : (rendimentoBruto * aliquotaIRPorDias(diasTotais));

  const saldoFinalLiquido = saldo - ir;

  if (saldoLiquidoEl)    saldoLiquidoEl.textContent    = fmtBRL.format(saldoFinalLiquido);
  if (totalInvestidoEl)  totalInvestidoEl.textContent  = fmtBRL.format(totalAportes);
  if (rendimentoBrutoEl) rendimentoBrutoEl.textContent = fmtBRL.format(rendimentoBruto);
  if (impostosEl)        impostosEl.textContent        = fmtBRL.format(ir);
}

/* ----------------- Inicialização ----------------- */
function init(){
  updateRegimeUI();
  regime?.addEventListener('change', updateRegimeUI);

  attachBRLMask(aporteInicial);
  attachBRLMask(aporteMensal);
  attachPercentMask(taxaPre);
  attachPercentMask(percentCDI);
  attachPercentMask(cdiAnual);
  attachPercentMask(ipcaAnual);
  attachPercentMask(spread);

  form?.addEventListener('submit', (e)=>{ e.preventDefault(); calcular(); });

  calcular();

  const anoEl = document.querySelector('#ano');
  if (anoEl) anoEl.textContent = String(new Date().getFullYear());
}
document.addEventListener('DOMContentLoaded', init);
