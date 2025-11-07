/* =========================================================
   Simulador de Investimentos — Simplão Invest
   ---------------------------------------------------------
   - Juros compostos mês a mês (Pré / Pós CDI / IPCA+)
   - IR regressivo no lucro (isento p/ LCI/LCA)
   - IOF (opcional, aprox.) no lucro do 1º mês
   - Tabela mês a mês + métricas finais
   ========================================================= */

(() => {
  // ---------- Helpers de formatação ----------
  const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtNum = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

  const el = id => document.getElementById(id);

  // Entradas
  const tipo           = el('tipo');           // CDB / LCI / LCA / Tesouro / Outros
  const regime         = el('regime');         // pre / pos / ipca
  const taxaPre        = el('taxaPre');        // % a.a.
  const percentCDI     = el('percentCDI');     // % do CDI
  const cdiAnual       = el('cdiAnual');       // % a.a.
  const ipcaAnual      = el('ipcaAnual');      // % a.a.
  const spread         = el('spread');         // % a.a. (fixa)
  const aporteInicial  = el('aporteInicial');  // R$
  const aporteMensal   = el('aporteMensal');   // R$
  const prazoMeses     = el('prazoMeses');     // meses
  const iofSel         = el('iof');            // sim/nao
  const dataInicio     = el('dataInicio');     // date
  const form           = el('simForm');

  // Saídas (métricas)
  const saldoLiquido   = el('saldoLiquido');
  const totalInvest    = el('totalInvestido');
  const rendimentoBru  = el('rendimentoBruto');
  const impostosIR     = el('impostos');

  // Tabela
  const tabelaBody     = el('tabela').querySelector('tbody');

  // ---------- UI: campos condicionais ----------
  function updateFieldsVisibility() {
    const r = regime.value;
    // esconde/mostra com base no data-show-on
    document.querySelectorAll('[data-show-on]').forEach(div => {
      const needs = div.getAttribute('data-show-on');
      div.style.display = needs === r ? '' : 'none';
    });
  }

  regime.addEventListener('change', updateFieldsVisibility);
  updateFieldsVisibility();

  // ---------- IOF: tabela (dias 1..30) ----------
  // Fonte: tabela oficial (96% dia 1 -> 0% dia 30). Simplificada:
  const iofTable = [
    0.96,0.93,0.90,0.86,0.83,0.80,0.76,0.73,0.70,0.66,
    0.63,0.60,0.56,0.53,0.50,0.46,0.43,0.40,0.36,0.33,
    0.30,0.26,0.23,0.20,0.16,0.13,0.10,0.06,0.03,0.00
  ];
  function iofFactorByDays(dias) {
    if (dias <= 0) return 0;
    if (dias >= 30) return 0;
    return iofTable[Math.max(1, Math.ceil(dias)) - 1];
  }

  // ---------- Aliquota IR por prazo total ----------
  function aliquotaIR(prazoDias) {
    if (prazoDias <= 180) return 0.225;
    if (prazoDias <= 360) return 0.20;
    if (prazoDias <= 720) return 0.175;
    return 0.15;
  }

  // ---------- Taxa mensal por regime ----------
  function taxaMensal(reg) {
    if (reg === 'pre') {
      const iaa = toPct(taxaPre.value); // a.a.
      return Math.pow(1 + iaa, 1/12) - 1;
    }
    if (reg === 'pos') {
      // anual = (%CDI/100) * CDI_anual(% a.a.)
      const cdiAA = toPct(cdiAnual.value);
      const perc  = parseFloat(percentCDI.value || '0') / 100;
      const iaa   = cdiAA * perc;
      return Math.pow(1 + iaa, 1/12) - 1;
    }
    // ipca + fixa
    const ipcaAA = toPct(ipcaAnual.value);
    const fixaAA = toPct(spread.value);
    const ipcaM  = Math.pow(1 + ipcaAA, 1/12) - 1;
    const fixaM  = Math.pow(1 + fixaAA, 1/12) - 1;
    return (1 + ipcaM) * (1 + fixaM) - 1;
  }

  function toPct(v) {
    const num = parseFloat((v || '0').toString().replace(',', '.'));
    return num / 100;
  }
  function toMoney(v) {
    const num = parseFloat((v || '0').toString().replace('.', '').replace(',', '.'));
    return isFinite(num) ? num : 0;
  }

  function addMonths(date, m) {
    const d = new Date(date.getTime());
    d.setMonth(d.getMonth() + m);
    return d;
  }
  function fmtDateBR(d) {
    return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  }

  // ---------- Cálculo principal ----------
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    // Dados base
    const invType      = tipo.value;   // para isenção LCI/LCA
    const reg          = regime.value; // pre/pos/ipca
    const meses        = parseInt(prazoMeses.value || '0', 10);
    const aporte0      = toMoney(aporteInicial.value);
    const aporteM      = toMoney(aporteMensal.value);
    const usarIOF      = iofSel.value === 'sim';

    let dtBase = dataInicio.value ? new Date(dataInicio.value + 'T00:00:00') : new Date();
    // normalizar pra UTC "meia-noite" p/ não variar em fuso
    dtBase = new Date(Date.UTC(dtBase.getUTCFullYear(), dtBase.getUTCMonth(), dtBase.getUTCDate()));

    // validação rápida
    if (meses < 1) {
      alert('Informe um prazo em meses (>= 1).');
      return;
    }

    // taxa mensal
    const i_m = taxaMensal(reg);

    // loop
    tabelaBody.innerHTML = '';
    let saldo = aporte0;
    let totalAportes = aporte0;
    let jurosAcumBruto = 0;

    for (let m = 1; m <= meses; m++) {
      const dt = addMonths(dtBase, m); // fim do mês m
      let jurosMes = saldo * i_m;

      // IOF (aproximação) só no 1º mês
      if (usarIOF && m === 1) {
        // considerar "dias" ~ 30 para prazo mensal; se 1 mês, IOF cai a 0,
        // mas na prática IOF só incide resgate < 30 dias; aqui usamos
        // uma aproximação para fins didáticos: reduz lucro do 1º mês
        const dias = 30; // aproximação
        const fator = iofFactorByDays(dias);
        jurosMes = jurosMes * (1 - fator); // reduz lucro pelo fator
      }

      jurosAcumBruto += jurosMes;
      saldo += jurosMes;

      // aporte no final do mês
      if (aporteM > 0) {
        saldo += aporteM;
        totalAportes += aporteM;
      }

      // linha
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${m}</td>
        <td>${fmtDateBR(dt)}</td>
        <td>${fmtBRL.format(saldo)}</td>
        <td>${fmtBRL.format(aporteM)}</td>
        <td>${fmtBRL.format(jurosMes)}</td>
      `;
      tabelaBody.appendChild(tr);
    }

    // Imposto de renda (sobre lucro)
    const prazoDias = Math.round(meses * 30.44); // aproximação
    const lucroBruto = Math.max(0, saldo - totalAportes);

    let ir = 0;
    const isIsento = (invType === 'LCI' || invType === 'LCA');
    if (!isIsento) {
      ir = lucroBruto * aliquotaIR(prazoDias);
    }
    const saldoFinalLiquido = saldo - ir;

    // Sai métricas
    saldoLiquido.textContent  = fmtBRL.format(saldoFinalLiquido);
    totalInvest.textContent   = fmtBRL.format(totalAportes);
    rendimentoBru.textContent = fmtBRL.format(lucroBruto);
    impostosIR.textContent    = fmtBRL.format(ir);
  });

  // ---------- Formatação ao digitar (R$ e % com vírgula) ----------
  function attachMoneyMask(input) {
    input.addEventListener('blur', () => {
      const v = toMoney(input.value);
      input.value = fmtNum.format(v);
    });
  }
  [aporteInicial, aporteMensal].forEach(attachMoneyMask);

  // placeholders agradáveis
  if (!dataInicio.value) {
    const hoje = new Date();
    const yyyy = hoje.getFullYear();
    const mm = String(hoje.getMonth() + 1).padStart(2, '0');
    const dd = String(hoje.getDate()).padStart(2, '0');
    dataInicio.value = `${yyyy}-${mm}-${dd}`;
  }
})();

