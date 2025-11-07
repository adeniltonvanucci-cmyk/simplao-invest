/* ====== Formatadores ====== */
const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/* Converte "10.000,50" | "10000,50" | "10000" em Number */
function asNumber(val) {
  const s = typeof val === 'string' ? val : (val?.value ?? '');
  if (!s) return 0;
  return Number(String(s).replace(/\s/g, '').replace('R$', '').replace(/\./g, '').replace(',', '.')) || 0;
}

/* ====== Regras de IR ====== */
function aliquotaIR(prazoMeses) {
  const dias = prazoMeses * 30; // aproximação
  if (dias <= 180) return 0.225;
  if (dias <= 360) return 0.20;
  if (dias <= 720) return 0.175;
  return 0.15;
}
function isIsentoIR(tipo) {
  return tipo === 'LCI' || tipo === 'LCA';
}

/* ====== Regimes ====== */
function taxaAnualPorRegime({ regime, taxaPre, percentCDI, cdiAnual, ipcaAnual, spread }) {
  const n = (v) => asNumber(v) / 100;
  if (regime === 'pre') return n(taxaPre);
  if (regime === 'pos') return (asNumber(percentCDI)/100) * (asNumber(cdiAnual)/100);
  if (regime === 'ipca') return n(ipcaAnual) + n(spread);
  return 0;
}
function efetivaMensal(tAnual) {
  return Math.pow(1 + tAnual, 1/12) - 1;
}

/* ====== Mostrar/ocultar campos por regime ====== */
function updateRegimeVisibility() {
  const regime = document.getElementById('regime').value; // 'pre' | 'pos' | 'ipca'
  document.querySelectorAll('.row[data-show-on]').forEach(row => {
    const showFor = row.getAttribute('data-show-on');
    const visible = (showFor === regime);
    row.classList.toggle('is-hidden', !visible);
    row.querySelectorAll('input, select, textarea').forEach(el => el.disabled = !visible);
  });
}

/* ====== Cálculo principal ====== */
function calcular() {
  const tipo   = document.getElementById('tipo').value;
  const regime = document.getElementById('regime').value;

  const params = {
    taxaPre:    document.getElementById('taxaPre')?.value || '0',
    percentCDI: document.getElementById('percentCDI')?.value || '0',
    cdiAnual:   document.getElementById('cdiAnual')?.value || '0',
    ipcaAnual:  document.getElementById('ipcaAnual')?.value || '0',
    spread:     document.getElementById('spread')?.value || '0'
  };

  const aporteInicial = asNumber(document.getElementById('aporteInicial'));
  const aporteMensal  = asNumber(document.getElementById('aporteMensal'));
  const prazoMeses    = Math.max(1, parseInt(document.getElementById('prazoMeses').value || '1', 10));
  const iofOpt        = document.getElementById('iof').value;

  const dataInicioInput = document.getElementById('dataInicio');
  const dataInicio = dataInicioInput.value ? new Date(dataInicioInput.value) : new Date();

  const tAnual  = taxaAnualPorRegime({ regime, ...params });
  const tMensal = efetivaMensal(tAnual);

  let saldo = aporteInicial;
  let totalInvestido = aporteInicial;
  let jurosAcum = 0;

  const TBODY = document.querySelector('#tabela tbody');
  TBODY.innerHTML = '';

  for (let m = 1; m <= prazoMeses; m++) {
    // aporte no início do mês
    saldo += aporteMensal;
    totalInvestido += aporteMensal;

    // juros do mês
    let juros = saldo * tMensal;
    saldo += juros;

    // IOF simplificado (só mês 1 para aproximar janela 0-30d)
    if (iofOpt === 'sim' && m === 1) {
      const iof = juros * 0.30;   // até ~30% no dia 1 caindo até 0 no dia 30 — aproximação
      juros -= iof;
      saldo -= iof;
    }

    jurosAcum += juros;

    // linha
    const dataMes = new Date(dataInicio);
    dataMes.setMonth(dataMes.getMonth() + (m - 1));
    TBODY.insertAdjacentHTML('beforeend', `
      <tr>
        <td>${m}</td>
        <td>${dataMes.toLocaleDateString('pt-BR')}</td>
        <td>${fmtBRL.format(saldo)}</td>
        <td>${fmtBRL.format(aporteMensal)}</td>
        <td>${fmtBRL.format(juros)}</td>
      </tr>
    `);
  }

  // IR no final (regressivo) — não aplica para LCI/LCA
  let imposto = 0;
  if (!isIsentoIR(tipo)) {
    imposto = Math.max(0, jurosAcum) * aliquotaIR(prazoMeses);
  }

  const saldoLiquido = saldo - imposto;
  const rendimentoBruto = saldo - totalInvestido;

  document.getElementById('saldoLiquido').textContent    = fmtBRL.format(saldoLiquido);
  document.getElementById('totalInvestido').textContent  = fmtBRL.format(totalInvestido);
  document.getElementById('rendimentoBruto').textContent = fmtBRL.format(rendimentoBruto);
  document.getElementById('impostos').textContent        = isIsentoIR(tipo) ? 'Isento' : fmtBRL.format(imposto);
}

/* ====== Boot ====== */
document.addEventListener('DOMContentLoaded', () => {
  // data default = hoje
  const di = document.getElementById('dataInicio');
  if (di && !di.value) {
    const dt = new Date();
    di.value = dt.toISOString().slice(0,10);
  }

  // regime show/hide
  updateRegimeVisibility();
  document.getElementById('regime').addEventListener('change', updateRegimeVisibility);

  // submit
  const form = document.getElementById('simForm');
  form.addEventListener('submit', e => {
    e.preventDefault();
    calcular();
  });

  // rodapé ano
  const ano = document.getElementById('ano');
  if (ano) ano.textContent = new Date().getFullYear();
});
