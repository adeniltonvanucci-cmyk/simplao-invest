/* =========================================================
   SIMPLÃO INVEST – Simulador (versão completa)
   - IPCA 12m automático via IBGE (SIDRA)
   - Juros compostos mensais
   - IR regressivo por dias (~30*d)
   - IOF simplificado (opcional)
   ========================================================= */

/* ===========================
   Seletores de elementos
   =========================== */
const tipo           = document.querySelector('#tipo');             // CDB, LCI, LCA, Tesouro
const regime         = document.querySelector('#regime');           // pre | pos | ipca

// Taxas por regime
const taxaPre        = document.querySelector('#taxaPre');          // % a.a. (Pré)
const percentCDI     = document.querySelector('#percentCDI');       // % do CDI (Pós)
const cdiAnual       = document.querySelector('#cdiAnual');         // CDI a.a. % (Pós)
const ipcaAnual      = document.querySelector('#ipcaAnual');        // IPCA a.a. % (IPCA+)
const spread         = document.querySelector('#spread');           // taxa fixa a.a. % (IPCA+)

// Parâmetros gerais
const aporteInicial  = document.querySelector('#aporteInicial');    // R$
const aporteMensal   = document.querySelector('#aporteMensal');     // R$
const prazoMeses     = document.querySelector('#prazoMeses');       // meses
const iofSelect      = document.querySelector('#iof');              // "sim" | "nao"
const dataInicio     = document.querySelector('#dataInicio');       // date

// Saídas (cards)
const saldoLiquidoEl     = document.querySelector('#saldoLiquido');
const totalInvestidoEl   = document.querySelector('#totalInvestido');
const rendimentoBrutoEl  = document.querySelector('#rendimentoBruto');
const impostosEl         = document.querySelector('#impostos');

// Tabela
const tbody          = document.querySelector('#tabela tbody');

// Utilidades
const fmtBRL  = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (d) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(d);

/* =========================================================
   Máscaras (BRL e %)
   ========================================================= */
function parseBRNumber(str) {
  if (str == null) return 0;
  const s = String(str).replace(/[^\d,.-]/g,'').replace(/\./g,'').replace(',', '.');
  const v = parseFloat(s);
  return isNaN(v) ? 0 : v;
}
function parsePercent(str){ return parseBRNumber(str); }

function attachBRLMask(inputEl){
  if(!inputEl) return;
  inputEl.addEventListener('input',()=>{
    let d = inputEl.value.replace(/\D/g,'');
    if(!d){ inputEl.value=''; return; }
    d = d.substring(0,12);
    const val = (parseInt(d,10)/100).toFixed(2);
    inputEl.value = fmtBRL.format(val);
  });
  inputEl.addEventListener('focus',()=>{ if(!inputEl.value) inputEl.value='R$ 0,00'; });
  inputEl.addEventListener('blur',()=>{
    const v=parseBRNumber(inputEl.value);
    inputEl.value = v===0 ? '' : fmtBRL.format(v);
  });
}

function attachPercentMask(inputEl){
  if(!inputEl) return;
  inputEl.addEventListener('input',()=>{
    let d=inputEl.value.replace(/\D/g,'');
    if(!d){ inputEl.value=''; return; }
    d=d.substring(0,5);
    const val=(parseInt(d,10)/100).toFixed(2);
    inputEl.value=String(val).replace('.',',');
  });
  inputEl.addEventListener('blur',()=>{
    const v=parsePercent(inputEl.value);
    inputEl.value = v===0 ? '' : String(v.toFixed(2)).replace('.',',');
  });
}

/* =========================================================
   IPCA automático – IBGE (SIDRA)
   - Tabela: 1737
   - Variável: 2266 (Índice – média 2012=100)
   - Estratégia: pegar os últimos 13 índices e calcular
                 acumulado em 12 meses: (atual/12mAtras - 1)*100
   ========================================================= */
const IPCA_URL      = "https://apisidra.ibge.gov.br/values/t/1737/n1/all/v/2266/p/last%2013";
const IPCA_FALLBACK = 4.50; // % a.a. caso falhe

async function setIPCAFromIBGE(){
  try{
    const res = await fetch(IPCA_URL, { cache: 'no-store' });
    const data = await res.json();

    // remove cabeçalho (data[0])
    const valores = data.slice(1).map(d => ({
      mes: d.D3N,                                     // ex.: "Outubro 2025"
      indice: parseFloat(String(d.V).replace(',', '.')) // índice (2012=100)
    })).filter(v => !isNaN(v.indice));

    if (valores.length < 2) throw new Error('Retorno insuficiente do SIDRA.');

    const atual = valores[valores.length - 1].indice;
    const dozeMesesAtras = valores[0].indice;

    const acumulado12m = ((atual / dozeMesesAtras) - 1) * 100;

    // sanidade: IPCA 12m plausível
    if (acumulado12m < -5 || acumulado12m > 30) throw new Error('IPCA fora da faixa esperada.');

    if (ipcaAnual) ipcaAnual.value = acumulado12m.toFixed(2).replace('.', ',');
    document.querySelector('#ipcaFonte')?.replaceChildren(
      document.createTextNode(`IPCA 12m (${valores[valores.length - 1].mes}) – Fonte: IBGE`)
    );
    console.log(`✅ IPCA 12m (IBGE): ${acumulado12m.toFixed(2)}%`);
  }catch(e){
    console.warn('⚠️ Falha ao buscar IPCA do IBGE. Usando fallback.', e?.message||e);
    if (ipcaAnual && !ipcaAnual.value) ipcaAnual.value = String(IPCA_FALLBACK).replace('.', ',');
  }
}

/* =========================================================
   Lógica do simulador
   ========================================================= */
function updateRegimeUI(){
  const v = regime?.value || 'pre';
  document.querySelectorAll('[data-show-on]').forEach(el=>{
    el.style.display = (el.getAttribute('data-show-on')===v) ? '' : 'none';
  });
}

function annualPercentToMonthlyRate(annualPercent){
  const a = (annualPercent||0)/100;
  return Math.pow(1+a, 1/12) - 1;
}

function aliquotaIRPorDias(dias){
  if (dias <= 180) return 0.225;
  if (dias <= 360) return 0.20;
  if (dias <= 720) return 0.175;
  return 0.15;
}

function isIsentoIR(tipoVal){
  const t=(tipoVal||'').toUpperCase();
  return (t.includes('LCI') || t.includes('LCA'));
}

function obterTaxaAnual(regimeVal){
  if (regimeVal==='pre'){
    return parsePercent(taxaPre.value);
  }
  if (regimeVal==='pos'){
    const cdi = parsePercent(cdiAnual.value);     // % a.a.
    const pcdi= parsePercent(percentCDI.value);   // %
    return (cdi * pcdi)/100;                      // % a.a.
  }
  if (regimeVal==='ipca'){
    const ipca = parsePercent(ipcaAnual.value)/100;
    const fixo = parsePercent(spread.value)/100;
    const efetiva = (1+ipca)*(1+fixo)-1;          // composição correta
    return efetiva*100;                           // volta para % a.a.
  }
  return 0;
}

function aplicarIOFSimplificado(jurosMes, mesIndex, iofFlag){
  if (iofFlag!=='sim') return jurosMes;
  if (mesIndex===0) return jurosMes*0.5; // aproximação pedagógica
  return jurosMes;
}

function calcular(){
  const tipoVal   = tipo?.value || 'CDB';
  const regimeVal = regime?.value || 'pre';

  const aporte0   = parseBRNumber(aporteInicial.value);
  const aporteMes = parseBRNumber(aporteMensal.value);
  const meses     = Math.max(0, parseInt(prazoMeses.value,10) || 0);
  const usarIOF   = (iofSelect?.value || 'nao');

  let dataBase = new Date();
  if (dataInicio && dataInicio.value){
    const [yyyy,mm,dd] = dataInicio.value.split('-').map(Number);
    if(yyyy && mm && dd) dataBase = new Date(Date.UTC(yyyy,mm-1,dd));
  }

  const taxaAA   = obterTaxaAnual(regimeVal);      // % a.a.
  const taxaMensal = annualPercentToMonthlyRate(taxaAA);

  let saldo = 0, totalAportes = 0, jurosBrutos = 0;

  // aporte inicial (D0)
  saldo += aporte0; totalAportes += aporte0;

  if (tbody) tbody.innerHTML = '';

  for (let m=0; m<meses; m++){
    // data de referência (último dia do mês m)
    const d = new Date(Date.UTC(dataBase.getUTCFullYear(), dataBase.getUTCMonth()+m+1, dataBase.getUTCDate()));

    // aporte no início do mês
    if (m>0 && aporteMes>0){ saldo += aporteMes; totalAportes += aporteMes; }

    // juros do mês
    let j = saldo * taxaMensal;
    j = aplicarIOFSimplificado(j, m, usarIOF);
    saldo += j;
    jurosBrutos += j;

    // linha da tabela
    if (tbody){
      const tr = document.createElement('tr');
      const c1 = document.createElement('td'); c1.textContent = String(m+1);
      const c2 = document.createElement('td'); c2.textContent = fmtDate(d);
      const c3 = document.createElement('td'); c3.textContent = fmtBRL.format(saldo);
      const c4 = document.createElement('td'); c4.textContent = fmtBRL.format(m>0?aporteMes:aporte0);
      const c5 = document.createElement('td'); c5.textContent = fmtBRL.format(j);
      tr.append(c1,c2,c3,c4,c5); tbody.appendChild(tr);
    }
  }

  // IR regressivo por dias (~30*d)
  const diasTotais = meses*30;
  const ir = isIsentoIR(tipoVal) ? 0 : jurosBrutos * aliquotaIRPorDias(diasTotais);

  const saldoFinalLiquido = saldo - ir;

  if (saldoLiquidoEl)    saldoLiquidoEl.textContent    = fmtBRL.format(saldoFinalLiquido);
  if (totalInvestidoEl)  totalInvestidoEl.textContent  = fmtBRL.format(totalAportes);
  if (rendimentoBrutoEl) rendimentoBrutoEl.textContent = fmtBRL.format(saldo - totalAportes);
  if (impostosEl)        impostosEl.textContent        = fmtBRL.format(ir);
}

/* =========================================================
   Inicialização
   ========================================================= */
function init(){
  // UI dinâmica
  updateRegimeUI();
  regime?.addEventListener('change', ()=>{
    updateRegimeUI();
    if (regime.value==='ipca') setIPCAFromIBGE();
  });

  // Máscaras
  attachBRLMask(aporteInicial);
  attachBRLMask(aporteMensal);
  attachPercentMask(taxaPre);
  attachPercentMask(percentCDI);
  attachPercentMask(cdiAnual);
  attachPercentMask(ipcaAnual);
  attachPercentMask(spread);

  // IPCA 12m automático (preenche o campo ao carregar)
  setIPCAFromIBGE();

  // Submit
  const form = document.querySelector('#simForm');
  form?.addEventListener('submit',(e)=>{ e.preventDefault(); calcular(); });

  // Rodapé (ano)
  const anoEl = document.querySelector('#ano');
  if (anoEl) anoEl.textContent = String(new Date().getFullYear());

  // 1º cálculo só se tiver parâmetros válidos
  // (evita "0,00" gerar ruído; usuário aciona Calcular)
}

document.addEventListener('DOMContentLoaded', init);
