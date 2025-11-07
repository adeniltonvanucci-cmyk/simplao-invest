/* =========================
   Utils de formatação/parse
   ========================= */
const fmtBRL = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const fmtNum = new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});

const $ = (s)=>document.querySelector(s);

function parseBRNumber(v){
  if(v==null) return 0;
  const s=String(v).replace(/[^\d,.\-]/g,'').replace(/\./g,'').replace(',','.');
  const n=parseFloat(s); return isFinite(n)&&!isNaN(n)?n:0;
}
function pctToDecimalStr(s){ // "15,5"->0.155 ; "105" (CDI%) -> 1.05
  let n=parseFloat(String(s??'0').replace(/\./g,'').replace(',','.'));
  if(!isFinite(n)||isNaN(n)) n=0;
  return n>1?n/100:n;
}

/* =========================
   Máscaras (moeda e %)
   ========================= */
function maskBRL(input){
  input.addEventListener('input',()=>{
    let digits=input.value.replace(/\D/g,'');
    if(!digits){ input.value=''; return; }
    digits=digits.substring(0,12);
    const v=(parseInt(digits,10)/100).toFixed(2);
    input.value=fmtBRL.format(v);
  });
  input.addEventListener('focus',()=>{ if(!input.value) input.value='R$ 0,00'; });
  input.addEventListener('blur',()=>{ const v=parseBRNumber(input.value); input.value=v===0?'':fmtBRL.format(v); });
}
function maskPercent(input){
  input.addEventListener('input',()=>{
    let d=input.value.replace(/\D/g,'');
    if(!d){ input.value=''; return; }
    d=d.substring(0,5);
    const v=(parseInt(d,10)/100).toFixed(2);
    input.value=String(v).replace('.',',');
  });
  input.addEventListener('blur',()=>{ const v=parseBRNumber(input.value); input.value=v===0?'':String(v.toFixed(2)).replace('.',','); });
}

/* =========================
   Mostrar/ocultar blocos
   ========================= */
function toggleFieldsA(){
  const r=$('#regime').value;
  document.querySelectorAll('[data-show-on]').forEach(el=>{
    el.style.display = (el.getAttribute('data-show-on')===r)?'block':'none';
  });
}
function toggleFieldsB(){
  const r=$('#regimeB').value;
  document.querySelectorAll('[data-show-on-b]').forEach(el=>{
    el.style.display = (el.getAttribute('data-show-on-b')===r)?'block':'none';
  });
}

/* =========================
   Taxas e regras
   ========================= */
function taxaMensalFromAnnualDecimal(annual){ // annual em decimal (0.155)
  return Math.pow(1+annual,1/12)-1;
}
function taxaMensalA(params){ // A ou B
  const {regime,taxaPre,percentCDI,cdiAnual,ipcaAnual,spread}=params;
  if(regime==='pre'){
    const aa = pctToDecimalStr(taxaPre);              // 15,5% -> 0.155
    return taxaMensalFromAnnualDecimal(aa);
  }
  if(regime==='pos'){
    const cdi = pctToDecimalStr(cdiAnual);            // 10,75% -> 0.1075
    const p   = pctToDecimalStr(percentCDI);          // 105% -> 1.05
    return taxaMensalFromAnnualDecimal(cdi*p);
  }
  // ipca+ (composição)
  const ipca = pctToDecimalStr(ipcaAnual);
  const fixo = pctToDecimalStr(spread);
  const mIpca = taxaMensalFromAnnualDecimal(ipca);
  const mFixo = taxaMensalFromAnnualDecimal(fixo);
  return (1+mIpca)*(1+mFixo)-1;
}
function aliquotaIRByDays(days){
  if(days<=180) return 0.225;
  if(days<=360) return 0.20;
  if(days<=720) return 0.175;
  return 0.15;
}
function isIsentoIR(tipo){ return /LCI|LCA/i.test(tipo||''); }

/* =========================
   Simulação (pura)
   ========================= */
function simulate({
  tipo='CDB', regime='pre',
  taxaPre='12,00', percentCDI='105,00', cdiAnual='10,75',
  ipcaAnual='4,00', spread='6,00',
  aporteInicial=0, aporteMensal=0,
  meses=36, iof='nao', dataInicio=new Date()
}){
  const i_m = taxaMensalA({regime,taxaPre,percentCDI,cdiAnual,ipcaAnual,spread});

  let saldo = aporteInicial;
  let totalAportes = aporteInicial;
  let jurosAcum = 0;

  const labels=[], saldoSerie=[], aporteAcumSerie=[], jurosAcumSerie=[];
  const rows=[];

  for(let m=1;m<=meses;m++){
    // aporte no início do mês
    saldo += aporteMensal;
    totalAportes += aporteMensal;

    // juros do mês
    let juros = saldo * i_m;

    // IOF didático (reduz 1º mês se habilitado)
    if(iof==='sim' && m===1) juros *= 0.5;

    saldo += juros;
    jurosAcum += juros;

    const d=new Date(dataInicio); d.setMonth(d.getMonth()+ (m-1));

    labels.push(`M${m}`);
    saldoSerie.push(saldo);
    aporteAcumSerie.push(totalAportes);
    jurosAcumSerie.push(jurosAcum);

    rows.push({
      mes:m, data:d.toLocaleDateString('pt-BR'),
      saldo, aporte:aporteMensal, juros
    });
  }

  const dias = Math.round(meses*30.44);
  const lucroBruto = Math.max(0, saldo - totalAportes);
  const IR = isIsentoIR(tipo) ? 0 : lucroBruto*aliquotaIRByDays(dias);
  const saldoLiquido = saldo - IR;

  return {
    labels, saldoSerie, aporteAcumSerie, jurosAcumSerie,
    rows,
    resumo:{
      saldoLiquido, totalAportes, rendimentoBruto: (saldo-totalAportes), IR
    }
  };
}

/* =========================
   Chart.js
   ========================= */
let evolucaoChart=null;
function renderChart(datasets, labels){
  const ctx = document.getElementById('evolucaoChart');
  if(!ctx) return;

  // destrói anterior
  if(evolucaoChart){ evolucaoChart.destroy(); }

  evolucaoChart = new Chart(ctx,{
    type:'line',
    data:{
      labels,
      datasets
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{ legend:{labels:{color:'#e5e7eb'} } },
      scales:{
        x:{ ticks:{color:'#94a3b8'}, grid:{color:'#1f2937'} },
        y:{ ticks:{color:'#94a3b8'}, grid:{color:'#1f2937'} }
      }
    }
  });
}

/* =========================
   Bind UI
   ========================= */
function getParamsA(){
  return {
    tipo: $('#tipo').value,
    regime: $('#regime').value,
    taxaPre: $('#taxaPre').value,
    percentCDI: $('#percentCDI').value,
    cdiAnual: $('#cdiAnual').value,
    ipcaAnual: $('#ipcaAnual').value,
    spread: $('#spread').value,
    aporteInicial: parseBRNumber($('#aporteInicial').value),
    aporteMensal: parseBRNumber($('#aporteMensal').value),
    meses: Math.max(1, parseInt($('#prazoMeses').value||'1',10)),
    iof: $('#iof').value,
    dataInicio: $('#dataInicio').value ? new Date($('#dataInicio').value) : new Date()
  };
}
function getParamsB(){ // usa bloco B se visível
  return {
    tipo: $('#tipoB').value,
    regime: $('#regimeB').value,
    taxaPre: $('#taxaPreB').value,
    percentCDI: $('#percentCDIB').value,
    cdiAnual: $('#cdiAnualB').value,
    ipcaAnual: $('#ipcaAnualB').value,
    spread: $('#spreadB').value,
    aporteInicial: parseBRNumber($('#aporteInicialB').value),
    aporteMensal: parseBRNumber($('#aporteMensalB').value),
    // B herda prazo/IOF/data do A para comparação justa (simplicidade)
    meses: Math.max(1, parseInt($('#prazoMeses').value||'1',10)),
    iof: $('#iof').value,
    dataInicio: $('#dataInicio').value ? new Date($('#dataInicio').value) : new Date()
  };
}

/* =========================
   Calcular + preencher UI
   ========================= */
function calcularEAtualizar(){
  const useB = $('#toggleComparar').checked;

  const A = simulate(getParamsA());

  // preencher cards com A
  $('#saldoLiquido').textContent  = fmtBRL.format(A.resumo.saldoLiquido);
  $('#totalInvestido').textContent= fmtBRL.format(A.resumo.totalAportes);
  $('#rendimentoBruto').textContent= fmtBRL.format(A.resumo.rendimentoBruto);
  $('#impostos').textContent      = fmtBRL.format(A.resumo.IR);

  // tabela (A)
  const tb = $('#tabela tbody'); tb.innerHTML='';
  A.rows.forEach(r=>{
    const tr=document.createElement('tr');
    tr.innerHTML = `
      <td>${r.mes}</td>
      <td>${r.data}</td>
      <td>${fmtBRL.format(r.saldo)}</td>
      <td>${fmtBRL.format(r.aporte)}</td>
      <td>${fmtBRL.format(r.juros)}</td>`;
    tb.appendChild(tr);
  });

  // gráfico
  const datasets = [
    {label:'Saldo (A)', data:A.saldoSerie, borderColor:'#22d3ee', tension:.25, borderWidth:2},
    {label:'Aportes Acum. (A)', data:A.aporteAcumSerie, borderColor:'#60a5fa', tension:.25, borderWidth:2, borderDash:[6,4]},
    {label:'Juros Acum. (A)', data:A.jurosAcumSerie, borderColor:'#a78bfa', tension:.25, borderWidth:2, borderDash:[2,3]}
  ];

  if(useB){
    const B = simulate(getParamsB());
    datasets.push(
      {label:'Saldo (B)', data:B.saldoSerie, borderColor:'#10b981', tension:.25, borderWidth:2},
      {label:'Aportes Acum. (B)', data:B.aporteAcumSerie, borderColor:'#34d399', tension:.25, borderWidth:2, borderDash:[6,4]},
      {label:'Juros Acum. (B)', data:B.jurosAcumSerie, borderColor:'#6ee7b7', tension:.25, borderWidth:2, borderDash:[2,3]}
    );
  }

  renderChart(datasets, A.labels);
}

/* =========================
   Init
   ========================= */
document.addEventListener('DOMContentLoaded',()=>{
  // máscaras
  [$('#aporteInicial'),$('#aporteMensal'),$('#aporteInicialB'),$('#aporteMensalB')]
    .filter(Boolean).forEach(maskBRL);

  [$('#taxaPre'),$('#percentCDI'),$('#cdiAnual'),$('#ipcaAnual'),$('#spread'),
   $('#taxaPreB'),$('#percentCDIB'),$('#cdiAnualB'),$('#ipcaAnualB'),$('#spreadB')]
    .filter(Boolean).forEach(maskPercent);

  // campos dependentes
  toggleFieldsA();
  $('#regime').addEventListener('change', toggleFieldsA);

  // bloco comparação B
  $('#toggleComparar').addEventListener('change',(e)=>{
    const on=e.target.checked;
    $('#boxB').classList.toggle('is-hidden', !on);
    toggleFieldsB();
    calcularEAtualizar();
  });
  $('#regimeB')?.addEventListener('change',toggleFieldsB);

  // form
  $('#simForm').addEventListener('submit',(ev)=>{
    ev.preventDefault();
    calcularEAtualizar();
  });

  // data default = hoje
  const di=$('#dataInicio');
  if(di && !di.value){
    const d=new Date();
    const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), dd=String(d.getDate()).padStart(2,'0');
    di.value = `${y}-${m}-${dd}`;
  }

  // ano rodapé
  const ano=document.querySelector('#ano'); if(ano) ano.textContent=new Date().getFullYear();

  // primeiro cálculo
  calcularEAtualizar();
});
