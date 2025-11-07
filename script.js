/* =========================
   Formatadores BR
   ========================= */
const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/* =========================
   Conversões e utilitários
   ========================= */
function parseMoney(elOrStr) {
  const str = typeof elOrStr === 'string' ? elOrStr : (elOrStr?.value ?? '');
  if (!str) return 0;
  return Number(str.replace(/\s/g, '').replace('R$', '').replace(/\./g, '').replace(',', '.')) || 0;
}

function aliquotaIR(prazoMeses) {
  if (prazoMeses <= 6)  return 0.225;
  if (prazoMeses <= 12) return 0.20;
  if (prazoMeses <= 24) return 0.175;
  return 0.15;
}
function isIsentoIR(tipo) {
  return tipo === 'LCI' || tipo === 'LCA';
}
function taxaAnualPorRegime({ regime, taxaPre, percentCDI, cdiAnual, ipcaAnual, spread }) {
  const n = (v) => Number(String(v).replace(/\./g, '').replace(',', '.')) || 0;
  if (regime === 'pre') return n(taxaPre) / 100;
  if (regime === 'pos') return (n(percentCDI) / 100) * (n(cdiAnual) / 100);
  if (regime === 'ipca') return (n(ipcaAnual) / 100) + (n(spread) / 100);
  return 0;
}
function efetivaMensal(taxaAnual) {
  return Math.pow(1 + taxaAnual, 1 / 12) - 1;
}

/* =========================
   Cálculo principal (corrigido)
   ========================= */
function calcular() {
  const tipo   = document.getElementById('tipo').value;
  const regime = document.getElementById('regime').value;

  const taxaPre    = document.getElementById('taxaPre')?.value || '0';
  const percentCDI = document.getElementById('percentCDI')?.value || '0';
  const cdiAnual   = document.getElementById('cdiAnual')?.value || '0';
  const ipcaAnual  = document.getElementById('ipcaAnual')?.value || '0';
  const spread     = document.getElementById('spread')?.value || '0';

  const aporteInicial = parseMoney(document.getElementById('aporteInicial'));
  const aporteMensal  = parseMoney(document.getElementById('aporteMensal'));
  const prazoMeses    = Math.max(1, parseInt(document.getElementById('prazoMeses').value || '1', 10));
  const iofOpt        = document.getElementById('iof').value;
  const dataInicio    = document.getElementById('dataInicio').value
                      ? new Date(document.getElementById('dataInicio').value)
                      : new Date();

  const tAnual  = taxaAnualPorRegime({ regime, taxaPre, percentCDI, cdiAnual, ipcaAnual, spread });
  const tMensal = efetivaMensal(tAnual);

  let saldo = aporteInicial;
  let totalInvestido = aporteInicial;
  let rendimentoBrutoAcumulado = 0;

  const tbody = document.querySelector('#tabela tbody');
  tbody.innerHTML = '';

  for (let m = 1; m <= prazoMeses; m++) {
    // aporte entra no início do mês
    saldo += aporteMensal;
    totalInvestido += aporteMensal;

    // juros do mês
    let juros = saldo * tMensal;
    saldo += juros;

    // IOF apenas no 1º mês (simplificado)
    let iof = 0;
    if (iofOpt === 'sim' && m === 1) {
      iof = juros * 0.3;
      saldo -= iof;
      juros -= iof;
    }

    rendimentoBrutoAcumulado += juros;

    // linha da tabela
    const dataMes = new Date(dataInicio);
    dataMes.setMonth(dataMes.getMonth() + (m - 1));
    tbody.insertAdjacentHTML('beforeend', `
      <tr>
        <td>${m}</td>
        <td>${dataMes.toLocaleDateString('pt-BR')}</td>
        <td>${fmtBRL.format(saldo)}</td>
        <td>${fmtBRL.format(aporteMensal)}</td>
        <td>${fmtBRL.format(juros)}</td>
      </tr>
    `);
  }

  // IR regressivo (no final)
  let imposto = 0;
  if (!isIsentoIR(tipo)) {
    imposto = rendimentoBrutoAcumulado * aliquotaIR(prazoMeses);
  }

  const saldoLiquido = saldo - imposto;
  const rendimentoBruto = saldo - totalInvestido;
  
  document.getElementById('saldoLiquido').textContent    = fmtBRL.format(saldoLiquido);
  document.getElementById('totalInvestido').textContent  = fmtBRL.format(totalInvestido);
  document.getElementById('rendimentoBruto').textContent = fmtBRL.format(rendimentoBruto);
  document.getElementById('impostos').textContent        = isIsentoIR(tipo) ? 'Isento' : fmtBRL.format(imposto);
}

/* =========================
   Formulário
   ========================= */
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('simForm');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      calcular();
    });
  }
  const ano = document.getElementById('ano');
  if (ano) ano.textContent = new Date().getFullYear();
});

