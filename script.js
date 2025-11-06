/* =========================
   Formatadores BR
   ========================= */
const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/* =========================
   Máscara BRL nos inputs (R$ 10.000,00)
   ========================= */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-money]').forEach((el) => {
    // formata enquanto digita
    el.addEventListener('input', () => {
      let v = el.value.replace(/\D/g, '');
      if (v === '') v = '0';
      const num = (parseInt(v, 10) / 100).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
      });
      el.value = num;
    });

    el.addEventListener('focus', () => {
      if (!el.value) el.value = 'R$ 0,00';
    });

    el.addEventListener('blur', () => {
      if (el.value === 'R$ 0,00' || el.value.trim() === '') el.value = '';
    });
  });
});

// converte "R$ 10.000,00" => 10000
function parseMoney(elOrStr) {
  const str = typeof elOrStr === 'string' ? elOrStr : (elOrStr?.value ?? '');
  if (!str) return 0;
  return Number(str.replace(/\s/g, '').replace('R$', '').replace(/\./g, '').replace(',', '.')) || 0;
}

/* =========================
   Mostrar/ocultar por regime
   ========================= */
function toggleRegimeFields() {
  const regime = document.getElementById('regime').value;
  document.querySelectorAll('[data-show-on]').forEach((el) => {
    el.hidden = el.getAttribute('data-show-on') !== regime;
  });
}
document.addEventListener('DOMContentLoaded', () => {
  const sel = document.getElementById('regime');
  if (sel) {
    toggleRegimeFields();
    sel.addEventListener('change', toggleRegimeFields);
  }
});

/* =========================
   IR regressivo + isenção LCI/LCA
   ========================= */
function aliquotaIR(prazoMeses) {
  if (prazoMeses <= 6)  return 0.225;
  if (prazoMeses <= 12) return 0.20;
  if (prazoMeses <= 24) return 0.175;
  return 0.15;
}
function isIsentoIR(tipo) {
  return tipo === 'LCI' || tipo === 'LCA';
}

/* =========================
   Conversões de taxa
   ========================= */
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
   Cálculo principal
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

  const prazoMeses = Math.max(1, parseInt(document.getElementById('prazoMeses').value || '1', 10));
  const iofOpt     = document.getElementById('iof').value;
  const dataInicio = document.getElementById('dataInicio').value
                   ? new Date(document.getElementById('dataInicio').value)
                   : new Date();

  const tAnual  = taxaAnualPorRegime({ regime, taxaPre, percentCDI, cdiAnual, ipcaAnual, spread });
  const tMensal = efetivaMensal(tAnual);

  let saldo = aporteInicial;
  let rendimentoBrutoAcumulado = 0;

  const tbody = document.querySelector('#tabela tbody');
  tbody.innerHTML = '';

  for (let m = 1; m <= prazoMeses; m++) {
    // juros do mês
    let juros = saldo * tMensal;
    saldo += juros;

    // IOF (aprox. conservadora no 1º mês)
    let iof = 0;
    if (iofOpt === 'sim' && m === 1) {
      iof = juros * 0.3; // até 30 dias (didático)
      saldo -= iof;
      juros -= iof;
    }

    rendimentoBrutoAcumulado += juros;

    // aporte no fim do mês
    saldo += aporteMensal;

    // linha da tabela
    const dataMes = new Date(dataInicio);
    dataMes.setMonth(dataMes.getMonth() + (m - 1));
    tbody.insertAdjacentHTML('beforeend', `
      <tr>
        <td class="col-mes">${m}</td>
        <td>${dataMes.toLocaleDateString('pt-BR')}</td>
        <td>${fmtBRL.format(saldo)}</td>
        <td>${fmtBRL.format(aporteMensal)}</td>
        <td>${fmtBRL.format(juros)}</td>
      </tr>
    `);
  }

  // IR
  let imposto = 0;
  if (!isIsentoIR(tipo)) {
    imposto = rendimentoBrutoAcumulado * aliquotaIR(prazoMeses);
    saldo -= imposto;
  }

  const totalInvestido = aporteInicial + (aporteMensal * prazoMeses);
  const rendimentoBruto = (saldo + imposto) - totalInvestido;

  document.getElementById('saldoLiquido').textContent    = fmtBRL.format(saldo);
  document.getElementById('totalInvestido').textContent  = fmtBRL.format(totalInvestido);
  document.getElementById('rendimentoBruto').textContent = fmtBRL.format(rendimentoBruto);
  document.getElementById('impostos').textContent        = isIsentoIR(tipo) ? 'Isento' : fmtBRL.format(imposto);
}

/* =========================
   Envio do formulário + ano
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

