/* =========================
   Utilidades de formato BR
   ========================= */
const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Formata um input de dinheiro (pt-BR)
function formatMoneyInput(el) {
  const onlyDigits = el.value.replace(/\D/g, '');
  const asNumber = Number(onlyDigits) / 100;
  el.value = asNumber ? asNumber.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '';
}

// Converte string/elemento pt-BR ("1.234,56") em Number 1234.56
function parseMoney(elOrStr) {
  const str = typeof elOrStr === 'string' ? elOrStr : (elOrStr?.value ?? '');
  if (!str) return 0;
  return Number(str.replace(/\./g, '').replace(',', '.')) || 0;
}

// Aplica máscara nos inputs [data-money]
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-money]').forEach((el) => {
    el.addEventListener('input', () => formatMoneyInput(el));
    // evita deixar "R$ 0,00" se apagar tudo
    el.addEventListener('blur', () => { if (!el.value) el.value = ''; });
  });
});

/* =========================
   Mostrar/ocultar campos por regime
   ========================= */
function toggleRegimeFields() {
  const regime = document.getElementById('regime').value;
  document.querySelectorAll('[data-show-on]').forEach((el) => {
    el.hidden = el.getAttribute('data-show-on') !== regime;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const regimeSel = document.getElementById('regime');
  if (regimeSel) {
    toggleRegimeFields();
    regimeSel.addEventListener('change', toggleRegimeFields);
  }
});

/* =========================
   IR regressivo + isenção LCI/LCA
   ========================= */
function aliquotaIR(prazoMeses) {
  if (prazoMeses <= 6)  return 0.225; // 22,5%
  if (prazoMeses <= 12) return 0.20;  // 20%
  if (prazoMeses <= 24) return 0.175; // 17,5%
  return 0.15;                        // 15%
}
function isIsentoIR(tipo) {
  return tipo === 'LCI' || tipo === 'LCA';
}

/* =========================
   Conversões de taxa
   ========================= */
// retorna taxa anual (decimal) conforme regime
function taxaAnualPorRegime({ regime, taxaPre, percentCDI, cdiAnual, ipcaAnual, spread }) {
  if (regime === 'pre') return taxaPre / 100;
  if (regime === 'pos') return (percentCDI / 100) * (cdiAnual / 100);
  if (regime === 'ipca') return (ipcaAnual / 100) + (spread / 100);
  return 0;
}
// efetiva mensal a partir da anual
function efetivaMensal(taxaAnual) {
  return Math.pow(1 + taxaAnual, 1 / 12) - 1;
}

/* =========================
   Cálculo principal
   ========================= */
function calcular() {
  // Parâmetros base
  const tipo     = document.getElementById('tipo').value;
  const regime   = document.getElementById('regime').value;

  const taxaPre     = Number((document.getElementById('taxaPre')?.value || '0').replace(',', '.')) || 0;
  const percentCDI  = Number((document.getElementById('percentCDI')?.value || '0').replace(',', '.')) || 0;
  const cdiAnual    = Number((document.getElementById('cdiAnual')?.value || '0').replace(',', '.')) || 0;
  const ipcaAnual   = Number((document.getElementById('ipcaAnual')?.value || '0').replace(',', '.')) || 0;
  const spread      = Number((document.getElementById('spread')?.value || '0').replace(',', '.')) || 0;

  // Dinheiro pt-BR
  const aporteInicial = parseMoney(document.getElementById('aporteInicial')); // vazio => 0
  const aporteMensal  = parseMoney(document.getElementById('aporteMensal'));  // vazio => 0

  // Prazo / IOF / Data
  const prazoMeses = Math.max(1, parseInt(document.getElementById('prazoMeses').value || '1', 10));
  const iofOpt     = document.getElementById('iof').value; // "sim" | "nao"
  const dataInicio = document.getElementById('dataInicio').value
                   ? new Date(document.getElementById('dataInicio').value)
                   : new Date();

  // Taxa mensal efetiva
  const tAnual   = taxaAnualPorRegime({ regime, taxaPre, percentCDI, cdiAnual, ipcaAnual, spread });
  const tMensal  = efetivaMensal(tAnual);

  // Loop de capitalização
  let saldo = aporteInicial;
  let rendimentoBrutoAcumulado = 0;

  const tbody = document.querySelector('#tabela tbody');
  tbody.innerHTML = '';

  for (let m = 1; m <= prazoMeses; m++) {
    // juros do mês
    let juros = saldo * tMensal;
    saldo += juros;

    // IOF (aproximação conservadora no 1º mês)
    let iof = 0;
    if (iofOpt === 'sim' && m === 1) {
      iof = juros * 0.3; // exemplo didático (máximo no D1 → decai até 0 no D30)
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

  // IR (se aplicável)
  let imposto = 0;
  if (!isIsentoIR(tipo)) {
    imposto = rendimentoBrutoAcumulado * aliquotaIR(prazoMeses);
    saldo -= imposto;
  }

  // Totais
  const totalInvestido = aporteInicial + (aporteMensal * prazoMeses);
  const rendimentoBruto = (saldo + imposto) - totalInvestido; // adiciona imposto p/ voltar ao bruto

  // Exibição
  document.getElementById('saldoLiquido').textContent    = fmtBRL.format(saldo);
  document.getElementById('totalInvestido').textContent  = fmtBRL.format(totalInvestido);
  document.getElementById('rendimentoBruto').textContent = fmtBRL.format(rendimentoBruto);
  document.getElementById('impostos').textContent        = isIsentoIR(tipo) ? 'Isento' : fmtBRL.format(imposto);
}

/* =========================
   Submissão do formulário
   ========================= */
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('simForm');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      calcular();
    });
  }
  // ano rodapé
  const ano = document.getElementById('ano');
  if (ano) ano.textContent = new Date().getFullYear();
});
