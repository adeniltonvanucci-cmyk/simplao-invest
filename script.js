/* =========================================================
   SIMPLÃO INVEST – Simulador (versão completa)
   - IPCA 12m automático via IBGE (SIDRA)
   - CDI automático (valor simulado, pronto p/ API futura)
   - Juros compostos mensais • IR regressivo (~30*d) • IOF simplificado
   ========================================================= */

/* ===========================
   Seletores
   =========================== */
const tipo           = document.querySelector('#tipo');
const regime         = document.querySelector('#regime');

// Taxas por regime
const taxaPre        = document.querySelector('#taxaPre');    // % a.a. (Pré)
const percentCDI     = document.querySelector('#percentCDI'); // % do CDI (Pós)
const cdiAnual       = document.querySelector('#cdiAnual');   // CDI a.a. %
const ipcaAnual      = document.querySelector('#ipcaAnual');  // IPCA a.a. %
const spread         = document.querySelector('#spread');     // taxa fixa a.a. % (IPCA+)

// Parâmetros gerais
const aporteInicial  = document.querySelector('#aporteInicial'); // R$
const aporteMensal   = document.querySelector('#aporteMensal');  // R$
const prazoMeses     = document.querySelector('#prazoMeses');    // meses
const iofSelect      = document.querySelector('#iof');           // "sim" | "nao"
const dataInicio     = document.querySelector('#dataInicio');    // date

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
   Máscaras
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

/** Máscara genérica de percentual "12,34" (para taxa pré, IPCA e spread) */
function attachPercentMask(inputEl){
  if(!inputEl) return;
  inputEl.addEventListener('input',()=>{
    let d=inputEl.value.replace(/\D/g,'');
    if(!d){ inputEl.value=''; return; }
    d=d.substring(0,5); // até 999,99
    const val=(parseInt(d,10)/100).toFixed(2);
    inputEl.value=String(val).replace('.',',');
  });
  inputEl.addEventListener('blur',()=>{
    const v=parsePercent(inputEl.value);
    inputEl.value = v===0 ? '' : String(v.toFixed(2)).replace('.',',');
  });
}

/** Máscara inteligente para % do CDI: 00 (se <100) ou 000 (se >=100) */
function attachCDIMask(inputEl){
  if(!inputEl) return;

  inputEl.addEventListener('input',()=>{
    let d = inputEl.value.replace(/\D/g,''); // só dígitos
    if(!d){ inputEl.value=''; return; }
    d = d.substring(0,3); // limita a 3 dígitos

    if (parseInt(d,10) < 100) {
      inputEl.value = d.padStart(2,'0'); // 00..99
    } else {
      inputEl.value = d.padStart(3,'0'); // 100..999
    }
  });

  inputEl.addEventListener('blur',()=>{
    let d = inputEl.value.replace(/\D/g,'');
    if(!d){ inputEl.value=''; return; }
    if (parseInt(d,10) < 100) {
      inputEl.value = d.padStart(2,'0');
    } else {
      inputEl.value = d.padStart(3,'0');
    }
  });
}

/* =========================================================
   IPCA automático – IBGE (SIDRA)
   - Tabela: 1737
   - Variável: 2266 (índice, média 2012=100)
   - Estratégia: últimos 13 índices → acumulado 12m = (atual/12mAtras - 1)*100
   ========================================================= */
const IPCA_URL      = "https://apisidra.ibge.gov.br/values/t/1737/n1/all/v/2266/p/last%2013";
const IPCA_FALLBACK = 4.50; // % a.a.

async function setIPCAFromIBGE(){
  try{
    const res = await fetch(IPCA_URL, { cache: 'no-store' });
    const data = await res.json();

    const valores = data.slice(1).map(d => ({
      mes: d.D3N,                                         // "Outubro 2025"
      indice: parseFloat(String(d.V).replace(',', '.'))   // índice (2012=100)
    })).filter(v => !isNaN(v.indice));

    if (valores.length < 2) throw new Error('Retorno insuficiente do SIDRA.');

    const atual = valores[valores.length - 1].indice;
    const dozeMesesAtras = valores[0].indice;
    const acumulado12m = ((atual / dozeMesesAtras) - 1) * 100;

    if (acumulado12m < -5 || acumulado12m > 30) throw new Error('IPCA fora da faixa.');

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
   CDI automático (simulado por enquanto)
   - Troque "obterCDIComoJSON" por fetch do seu Worker/API quando quiser
   ========================================================= */
async function obterCDIComoJSON() {
  // Exemplo: CDI 12m (out/2025). Ajuste quando tiver API.
  const cdiAcumulado = 13.70;
  const periodo      = "outubro 2025";
  const fonte        = "BrasilIndicadores.com.br / B3";

  const v = Number(cdiAcumulado);
  if (isNaN(v) || v < 5 || v > 20) throw new Error("CDI fora da faixa esperada.");

  return { periodo, cdiAcumulado: v.toFixed(2), fonte };
}

async function setCDIAutomatico(){
  try{
    const cdi = await obterCDIComoJSON();
    if (cdiAnual) cdiAnual.value = String(cdi.cdiAcumulado).replace('.', ',');
    document.querySelector('#cdiFonte')?.replaceChildren(
      document.createTextNode(`CDI (${cdi.periodo}) – Fonte: ${cdi.fonte}`)
    );
    console.log(`✅ CDI atualizado: ${cdi.cdiAcumulado}%`);
  }catch(e){
    console.warn("⚠️ Falha ao obter CDI automático. Informe manualmente se desejar.", e?.message||e);
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
    // CDI efetivo = (CDI a.a. %) * (% do CDI) / 100
    const cdi = parsePercent(cdiAnual.value);
    const pcdi= parsePercent(percentCDI.value);
    return (cdi * pcdi)/100;
  }
  if (regimeVal==='ipca'){
    // composição correta: (1+IPCA)*(1+fixo)-1
    const ipca = parsePercent(ipcaAnual.value)/100;
    const fixo = parsePercent(spread.value)/100;
    const efetiva = (1+ipca)*(1+fixo)-1;
    return efetiva*100;
  }
  return 0;
}

function aplicarIOFSimplificado(jurosMes, mesIndex, iofFlag){
  if (iofFlag!=='sim') return jurosMes;
  if (mesIndex===0) return jurosMes*0.5; // simplificado didático
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
  saldo += aporte0; totalAportes += aporte0;

  if (tbody) tbody.innerHTML = '';

  for (let m=0; m<meses; m++){
    const d = new Date(Date.UTC(
      dataBase.getUTCFullYear(),
      dataBase.getUTCMonth()+m+1,
      dataBase.getUTCDate()
    ));

    // aporte no início de cada mês (m>0); o inicial já entrou no m=0
    if (m>0 && aporteMes>0){ saldo += aporteMes; totalAportes += aporteMes; }

    // juros do mês
    let j = saldo * taxaMensal;
    j = aplicarIOFSimplificado(j, m, usarIOF);
    saldo += j; jurosBrutos += j;

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
  updateRegimeUI();

  // Automáticos
  setIPCAFromIBGE();                // IPCA 12m ao abrir
  if (regime?.value === 'pos') {
    setCDIAutomatico();             // CDI se já iniciar em pós
  }

  regime?.addEventListener('change', () => {
    updateRegimeUI();
    if (regime.value === 'ipca') setIPCAFromIBGE();
    if (regime.value === 'pos')  setCDIAutomatico();
  });

  // Máscaras
  attachBRLMask(aporteInicial);
  attachBRLMask(aporteMensal);
  attachPercentMask(taxaPre);
  attachCDIMask(percentCDI);   // << máscara específica (00 / 000)
  attachPercentMask(cdiAnual);
  attachPercentMask(ipcaAnual);
  attachPercentMask(spread);

  // Submit
  const form = document.querySelector('#simForm');
  form?.addEventListener('submit',(e)=>{ e.preventDefault(); calcular(); });

  // Rodapé
  const anoEl = document.querySelector('#ano');
  if (anoEl) anoEl.textContent = String(new Date().getFullYear());
}

document.addEventListener('DOMContentLoaded', init);
