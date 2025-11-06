const fmtBRL = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
document.getElementById('ano').textContent = new Date().getFullYear();

const regimeEl = document.getElementById('regime');
const toggleFields = () => {
  const val = regimeEl.value;
  document.querySelectorAll('[data-show-on]').forEach(el => {
    el.classList.toggle('hidden', el.getAttribute('data-show-on') !== val);
  });
};
regimeEl.addEventListener('change', toggleFields);
toggleFields();

const tbody = document.querySelector('#tabela tbody');
const setRow = (i, cols) => {
  let tr = tbody.children[i];
  if (!tr) { tr = document.createElement('tr'); tbody.appendChild(tr); }
  tr.innerHTML = cols.map(c => `<td>${c}</td>`).join('');
};
const clearRows = () => { tbody.innerHTML = ''; };

function aliquotaIR(dias) {
  if (dias <= 180) return 0.225;
  if (dias <= 360) return 0.20;
  if (dias <= 720) return 0.175;
  return 0.15;
}
function percIOF(dias) {
  if (dias <= 0) return 1;
  if (dias >= 30) return 0;
  return (30 - dias) / 30;
}
const annualToMonthly = (a) => Math.pow(1 + a, 1/12) - 1;

document.getElementById('simForm').addEventListener('submit', (e) => {
  e.preventDefault();
  clearRows();

  const tipo = document.getElementById('tipo').value;
  const regime = document.getElementById('regime').value;
  const aporteInicial = Number(document.getElementById('aporteInicial').value || 0);
  const aporteMensal = Number(document.getElementById('aporteMensal').value || 0);
  const prazoMeses = Number(document.getElementById('prazoMeses').value);
  const considerarIOF = document.getElementById('iof').value === 'sim';
  const dataInicioStr = document.getElementById('dataInicio').value;
  const startDate = dataInicioStr ? new Date(dataInicioStr + 'T12:00:00') : new Date();

  let taxaAnual = 0;
  if (regime === 'pre') {
    taxaAnual = Number(document.getElementById('taxaPre').value)/100;
  } else if (regime === 'pos') {
    const pctCDI = Number(document.getElementById('percentCDI').value)/100;
    const cdiAnual = Number(document.getElementById('cdiAnual').value)/100;
    taxaAnual = pctCDI * cdiAnual;
  } else if (regime === 'ipca') {
    const ipca = Number(document.getElementById('ipcaAnual').value)/100;
    const spread = Number(document.getElementById('spread').value)/100;
    taxaAnual = (1+ipca)*(1+spread)-1;
  }
  const taxaMensal = annualToMonthly(taxaAnual);

  const tributavel = !(tipo === 'LCI' || tipo === 'LCA');

  let saldo = aporteInicial;
  let totalAportado = aporteInicial;
  let jurosTotal = 0;
  const rows = [];

  for (let m = 1; m <= prazoMeses; m++) {
    const juros = saldo * taxaMensal;
    saldo += juros;
    jurosTotal += juros;
    saldo += aporteMensal;
    totalAportado += aporteMensal;
    const d = new Date(startDate); d.setMonth(d.getMonth() + m);
    rows.push({ mes:m, data:d, saldo, aporte:aporteMensal, juros });
  }

  const diasTotal = Math.round((rows[rows.length-1].data - startDate)/86400000);
  let ir = 0, iof = 0;
  if (tributavel) {
    ir = jurosTotal * aliquotaIR(diasTotal);
    if (considerarIOF) iof = jurosTotal * percIOF(diasTotal);
  }
  const saldoLiquido = saldo - ir - iof;

  rows.forEach((r, i) => {
    setRow(i, [
      r.mes,
      r.data.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      r.saldo.toLocaleString('pt-BR', { style:'currency', currency:'BRL' }),
      r.aporte.toLocaleString('pt-BR', { style:'currency', currency:'BRL' }),
      r.juros.toLocaleString('pt-BR', { style:'currency', currency:'BRL' }),
    ]);
  });

  document.getElementById('saldoLiquido').textContent = saldoLiquido.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
  document.getElementById('totalInvestido').textContent = totalAportado.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
  document.getElementById('rendimentoBruto').textContent = jurosTotal.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
  document.getElementById('impostos').textContent = (ir+iof).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
});
