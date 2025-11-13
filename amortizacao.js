// ===================== Utilidades BR =====================
const fmtBRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const fmtDate = (d) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(d);

function parseBRNumber(str) {
  if (!str) return 0;
  return parseFloat(
    String(str)
      .replace(/[^\d,.-]/g, "")
      .replace(/\./g, "")
      .replace(",", ".")
  ) || 0;
}

// ===================== Máscaras =====================

// BRL – sempre 2 casas
function attachBRLMask(el) {
  if (!el) return;

  el.addEventListener("input", () => {
    let dg = el.value.replace(/\D/g, "");
    if (!dg) {
      el.value = "";
      return;
    }
    dg = dg.substring(0, 13);
    const val = (parseInt(dg, 10) / 100).toFixed(2);
    el.value = fmtBRL.format(val);
  });

  el.addEventListener("blur", () => {
    const v = parseBRNumber(el.value);
    el.value = v === 0 ? "" : fmtBRL.format(v);
  });
}

// === MÁSCARA DEFINITIVA DA TAXA DE JUROS ===
// → aceita ponto OU vírgula
// → preserva o separador enquanto digita
// → até 4 casas decimais
// → formata como XX,XXXX no blur
function attachPercentMask(el, { maxInt = 5, maxDec = 6, fixedOnBlur = 4 } = {}) {
  if (!el) return;

  el.addEventListener("input", (e) => {
    let v = e.target.value;

    // permite vírgula ou ponto imediatamente
    v = v.replace(/[^\d.,]/g, '');

    // Se começar com vírgula -> vira "0,"
    if (v.startsWith(",") || v.startsWith(".")) {
      v = "0" + v;
    }

    // garante somente UM separador
    const firstSep = v.search(/[.,]/);
    if (firstSep !== -1) {
      const sep = v[firstSep];
      let inteiros = v.slice(0, firstSep).replace(/\D/g, '');
      let decimais = v.slice(firstSep + 1).replace(/\D/g, '');

      inteiros = inteiros.slice(0, maxInt);
      decimais = decimais.slice(0, maxDec);

      v = decimais.length ? `${inteiros}${sep}${decimais}` : `${inteiros}${sep}`;
    } else {
      // só inteiros
      v = v.replace(/\D/g, '').slice(0, maxInt);
    }

    e.target.value = v;
  });

  el.addEventListener("blur", (e) => {
    let v = e.target.value;

    if (!v) return;

    // tira separador no final
    v = v.replace(/[,\.]$/, "");

    // normaliza para número
    const num = parseBRNumber(v);

    if (isNaN(num)) {
      e.target.value = "";
      return;
    }

    // formata com casas decimais fixas
    e.target.value = num.toFixed(fixedOnBlur).replace(".", ",");
  });
}

  el.addEventListener("blur", () => {
    let v = el.value.trim();
    if (!v) return;

    v = v.replace(".", ",");
    const partes = v.split(",");

    let intPart = partes[0].replace(/\D/g, "") || "0";
    let decPart = (partes[1] || "").replace(/\D/g, "");

    decPart = decPart.padEnd(4, "0").slice(0, 4);

    el.value = `${intPart},${decPart}`;
  });
}

// ===================== Cálculos =====================

function mensalDeAnual(aa) {
  return Math.pow(1 + aa / 100, 1 / 12) - 1;
}

function pmtPrice(P, i, n) {
  if (i === 0) return P / n;
  const f = Math.pow(1 + i, n);
  return (P * (i * f)) / (f - 1);
}

function monthIndexFromDate(startUTC, whenUTC) {
  const y1 = startUTC.getUTCFullYear(),
    m1 = startUTC.getUTCMonth();
  const y2 = whenUTC.getUTCFullYear(),
    m2 = whenUTC.getUTCMonth();
  return (y2 - y1) * 12 + (m2 - m1) + 1;
}

function gerarCronograma({
  principal,
  iMes,
  nMeses,
  sistema,
  extras,
  extraMensal,
  seguroTaxa,
  data0,
}) {
  const linhas = [];
  let saldo = principal;
  let prestacaoFixa = sistema === "price"
    ? Math.round(pmtPrice(principal, iMes, nMeses) * 100) / 100
    : 0;

  const amortConstante =
    sistema === "sac"
      ? Math.round((principal / nMeses) * 100) / 100
      : 0;

  const extrasPorMes = {};
  (extras || []).forEach((ex) => {
    extrasPorMes[ex.mes] = (extrasPorMes[ex.mes] || 0) + ex.valor;
  });

  let totalJuros = 0,
    totalPago = 0,
    mesesExecutados = 0;

  for (let m = 1; m <= nMeses && saldo > 0.005; m++) {
    const data = data0
      ? new Date(
          Date.UTC(
            data0.getUTCFullYear(),
            data0.getUTCMonth() + m - 1,
            data0.getUTCDate()
          )
        )
      : null;

    const juros = Math.round(saldo * iMes * 100) / 100;
    const taxas = Math.round(seguroTaxa * 100) / 100;

    let amort, prest;

    if (sistema === "price") {
      prest = prestacaoFixa + taxas;
      amort = Math.min(prestacaoFixa - juros, saldo);
    } else {
      amort = Math.min(amortConstante, saldo);
      prest = amort + juros + taxas;
    }

    const extraAlvo = (extrasPorMes[m] || 0) + (extraMensal || 0);
    const extra = Math.min(
      Math.round(extraAlvo * 100) / 100,
      Math.max(0, saldo - amort)
    );

    saldo = Math.max(
      0,
      Math.round((saldo - amort - extra) * 100) / 100
    );
    totalJuros += juros;
    totalPago += prest + extra;
    mesesExecutados = m;

    linhas.push({
      mes: m,
      data: data ? fmtDate(data) : "—",
      prestacao: prest,
      amortizacao: amort,
      juros: juros,
      taxas: taxas,
      extra: extra,
      saldo: saldo,
    });
  }

  return {
    linhas,
    totalJuros: Math.round(totalJuros * 100) / 100,
    totalPago: Math.round(totalPago * 100) / 100,
    mesesExecutados,
  };
}

// ===================== CSV + LINKS + PDF =====================

function toCSV(linhas) {
  const header = [
    "Mes",
    "Data",
    "Prestacao",
    "Amortizacao",
    "Juros",
    "Taxas",
    "Extra",
    "Saldo",
  ];
  const rows = linhas.map((l) => [
    l.mes,
    l.data,
    l.prestacao.toFixed(2),
    l.amortizacao.toFixed(2),
    l.juros.toFixed(2),
    l.taxas.toFixed(2),
    l.extra.toFixed(2),
    l.saldo.toFixed(2),
  ]);

  return new Blob(
    ["\uFEFF" + [header.join(";")].concat(rows.map((r) => r.join(";"))).join("\n")],
    { type: "text/csv;charset=utf-8;" }
  );
}

function copiarLink(params) {
  const url = new URL(location.href);
  Object.entries(params).forEach(([k, v]) =>
    url.searchParams.set(k, String(v))
  );
  navigator.clipboard.writeText(url.toString());
  alert("Link copiado!");
}

function exportarPDF() {
  window.print();
}

// ===================== Controle da UI =====================

const $ = (s) => document.querySelector(s);

const el = {
  form: $("#amortForm"),
  principal: $("#principal"),
  periodo: $("#periodo"),
  sistema: $("#sistema"),
  tipoTaxa: $("#tipoTaxa"),
  dataInicio: $("#dataInicio"),
  rate: $("#rate"),
  extraMensal: $("#extraMensal"),
  extraValor: $("#extraValor"),
  extraData: $("#extraData"),
  addExtra: $("#addExtra"),
  extrasChips: $("#extrasChips"),
  seguroTaxa: $("#seguroTaxa"),
  prestacaoIni: $("#prestacaoIni"),
  totalPago: $("#totalPago"),
  totalJuros: $("#totalJuros"),
  mesesQuitados: $("#mesesQuitados"),
  tabela: $("#tabela tbody"),
  grafico: $("#grafico"),
  baixarCsv: $("#baixarCsv"),
  copiarLink: $("#copiarLink"),
  baixarPdf: $("#baixarPdf"),
};

// Aplica máscaras
["#principal", "#seguroTaxa", "#extraValor", "#extraMensal"].forEach((sel) =>
  attachBRLMask($(sel))
);

// **MÁSCARA DA TAXA**
attachPercentMask(el.rate);

const extras = [];

function renderExtrasChips() {
  el.extrasChips.innerHTML = "";
  extras
    .sort((a, b) => a.mes - b.mes)
    .forEach((ex, idx) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = `${fmtDate(ex.data)} • ${fmtBRL.format(ex.valor)}`;
      chip.onclick = () => {
        extras.splice(idx, 1);
        renderExtrasChips();
      };
      el.extrasChips.appendChild(chip);
    });
}

el.addExtra.onclick = () => {
  const v = parseBRNumber(el.extraValor.value);
  const dStr = el.extraData.value;

  if (!(v > 0) || !dStr) return alert("Informe valor e data");

  if (!el.dataInicio.value)
    return alert("Informe a data do 1º vencimento primeiro");

  const [Y, M, D] = dStr.split("-").map(Number);
  const d = new Date(Date.UTC(Y, M - 1, D));

  const [Y0, M0, D0] = el.dataInicio.value.split("-").map(Number);
  const d0 = new Date(Date.UTC(Y0, M0 - 1, D0));

  const mes = monthIndexFromDate(d0, d);
  if (mes < 1)
    return alert("Data da amortização deve ser no mês 1 ou após");

  extras.push({ valor: v, data: d, mes });

  el.extraValor.value = "";
  el.extraData.value = "";

  renderExtrasChips();
};

function calcular() {
  const principal = parseBRNumber(el.principal.value);
  const taxa = parseBRNumber(el.rate.value);
  const nMeses = parseInt(el.periodo.value || "0");

  if (!(principal > 0) || !(nMeses > 0)) return;

  const sistema = el.sistema.value;
  const tipoTaxa = el.tipoTaxa.value;

  const seguroTaxa = parseBRNumber(el.seguroTaxa.value);
  const extraMensal = parseBRNumber(el.extraMensal.value);

  let data0 = null;
  if (el.dataInicio.value) {
    const [Y, M, D] = el.dataInicio.value.split("-").map(Number);
    data0 = new Date(Date.UTC(Y, M - 1, D));
  }

  const iMes =
    tipoTaxa === "aa" ? mensalDeAnual(taxa) : taxa / 100;

  const { linhas, totalJuros, totalPago, mesesExecutados } =
    gerarCronograma({
      principal,
      iMes,
      nMeses,
      sistema,
      extras,
      extraMensal,
      seguroTaxa,
      data0,
    });

  if (linhas.length) {
    el.prestacaoIni.textContent = fmtBRL.format(linhas[0].prestacao);
    el.totalPago.textContent = fmtBRL.format(totalPago);
    el.totalJuros.textContent = fmtBRL.format(totalJuros);
    el.mesesQuitados.textContent = mesesExecutados;
  }

  el.tabela.innerHTML = "";
  for (const l of linhas) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${l.mes}</td>
      <td>${l.data}</td>
      <td>${fmtBRL.format(l.prestacao)}</td>
      <td>${fmtBRL.format(l.amortizacao)}</td>
      <td>${fmtBRL.format(l.juros)}</td>
      <td>${fmtBRL.format(l.taxas)}</td>
      <td>${fmtBRL.format(l.extra)}</td>
      <td>${fmtBRL.format(l.saldo)}</td>
    `;
    el.tabela.appendChild(tr);
  }

  desenharGraficoAnual(el.grafico, linhas, data0);

  el.baixarCsv.onclick = () => {
    const blob = toCSV(linhas);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "amortizacao.csv";
    a.click();
  };

  el.copiarLink.onclick = () => copiarLink({});

  el.baixarPdf.onclick = exportarPDF;
}

el.form.addEventListener("submit", (e) => {
  e.preventDefault();
  calcular();
});

document.querySelector("#ano").textContent = new Date().getFullYear();
