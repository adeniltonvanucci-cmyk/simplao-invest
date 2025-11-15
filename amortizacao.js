// ===================== Utilidades BR =====================
const fmtBRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const fmtDate = (d) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(d);

function parseBRNumber(str) {
  if (!str) return 0;
  const s = String(str)
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const v = parseFloat(s);
  return isNaN(v) ? 0 : v;
}

// ===================== Máscaras =====================

// Máscara de moeda BRL (2 casas)
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

/**
 * Máscara percentual:
 * - aceita vírgula ou ponto enquanto digita (não trava);
 * - permite até maxInt dígitos inteiros e maxDec decimais;
 * - no blur formata com fixedOnBlur casas decimais (padrão: 4).
 */
function attachPercentMask(
  el,
  { maxInt = 5, maxDec = 6, fixedOnBlur = 4 } = {}
) {
  if (!el) return;

  el.addEventListener("input", (e) => {
    let v = e.target.value;

    // só dígitos, vírgula e ponto
    v = v.replace(/[^\d.,]/g, "");

    // Se começar com vírgula ou ponto -> "0,"
    if (v.startsWith(",") || v.startsWith(".")) {
      v = "0" + v;
    }

    // garante apenas um separador
    const firstSep = v.search(/[.,]/);
    if (firstSep !== -1) {
      const sep = v[firstSep];
      let inteiros = v.slice(0, firstSep).replace(/\D/g, "");
      let decimais = v.slice(firstSep + 1).replace(/\D/g, "");

      inteiros = inteiros.slice(0, maxInt);
      decimais = decimais.slice(0, maxDec);

      if (decimais.length > 0) {
        v = `${inteiros}${sep}${decimais}`;
      } else {
        v = `${inteiros}${sep}`;
      }
    } else {
      // sem separador: só inteiros
      v = v.replace(/\D/g, "").slice(0, maxInt);
    }

    e.target.value = v;
  });

  el.addEventListener("blur", (e) => {
    let v = e.target.value.trim();
    if (!v) return;

    // tira separador no final (ex.: "7," -> "7")
    v = v.replace(/[,\.]$/, "");

    const num = parseBRNumber(v);
    if (isNaN(num)) {
      e.target.value = "";
      return;
    }

    if (fixedOnBlur != null) {
      e.target.value = num.toFixed(fixedOnBlur).replace(".", ",");
    } else {
      // mantém quantas casas tiver, só normalizando vírgula
      e.target.value = String(num).replace(".", ",");
    }
  });
}

// ===================== TR automática (Banco Central) =====================

/**
 * Consulta TR MÊS (série 226) no Banco Central e devolve
 * um mapa { "AAAA-MM": trComoFração }.
 * Ex.: "2025-01": 0.0001  (0,01% no mês)
 */
async function obterTRMensalMapa(dataInicial, dataFinal) {
  const fmtBCB = (d) => {
    const dia = String(d.getUTCDate()).padStart(2, "0");
    const mes = String(d.getUTCMonth() + 1).padStart(2, "0");
    const ano = d.getUTCFullYear();
    return `${dia}/${mes}/${ano}`; // dd/MM/aaaa
  };

  const url =
    "https://api.bcb.gov.br/dados/serie/bcdata.sgs.226/dados" +
    `?formato=json&dataInicial=${fmtBCB(dataInicial)}&dataFinal=${fmtBCB(
      dataFinal
    )}`;

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error("Erro ao consultar TR no Banco Central");
  }

  const dados = await resp.json();
  const mapa = {};

  dados.forEach((item) => {
    // item.data pode vir "MM/AAAA" ou "DD/MM/AAAA"
    const partes = item.data.split("/");
    let mes, ano;
    if (partes.length === 2) {
      [mes, ano] = partes;
    } else {
      [, mes, ano] = partes;
    }
    const chave = `${ano}-${String(mes).padStart(2, "0")}`;
    const trPercent = parseFloat(item.valor.replace(",", ".")) || 0;
    mapa[chave] = trPercent / 100; // % -> fração
  });

  return mapa; // { "2025-01": 0.0001, ... }
}

// ===================== Cálculos =====================

function mensalDeAnual(aa) {
  const a = (aa || 0) / 100;
  return Math.pow(1 + a, 1 / 12) - 1;
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

/**
 * Agora com TR automática OPCIONAL:
 * - mapaTR é { "AAAA-MM": fração } ou null
 * - se mapaTR for null, o saldo NÃO é corrigido pela TR.
 */
function gerarCronograma({
  principal,
  iMes,
  nMeses,
  sistema,
  extras,
  extraMensal,
  seguroTaxa,
  data0,
  mapaTR,
}) {
  const linhas = [];
  let saldo = principal;
  let prestacaoFixa =
    sistema === "price"
      ? Math.round(pmtPrice(principal, iMes, nMeses) * 100) / 100
      : 0;
  const amortConstante =
    sistema === "sac"
      ? Math.round((principal / nMeses) * 100) / 100
      : 0;

  const extrasPorMes = {};
  (extras || []).forEach((ex) => {
    const k = ex.mes;
    extrasPorMes[k] = (extrasPorMes[k] || 0) + ex.valor;
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

    // === APLICA TR DO MÊS (se existir) AO SALDO ===
    if (data && mapaTR) {
      const chaveMes = `${data.getUTCFullYear()}-${String(
        data.getUTCMonth() + 1
      ).padStart(2, "0")}`;
      const trMes = mapaTR[chaveMes] || 0; // fração
      if (trMes !== 0) {
        saldo = Math.round(saldo * (1 + trMes) * 100) / 100;
      }
    }

    const juros = Math.round(saldo * iMes * 100) / 100;
    let amort = 0,
      prest = 0,
      taxas = Math.round(seguroTaxa * 100) / 100;

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

    const pagoNoMes = prest + extra;
    saldo = Math.max(
      0,
      Math.round((saldo - amort - extra) * 100) / 100
    );
    totalJuros += juros;
    totalPago += pagoNoMes;
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

    if (saldo <= 0.005) break;
  }

  return {
    linhas,
    totalJuros: Math.round(totalJuros * 100) / 100,
    totalPago: Math.round(totalPago * 100) / 100,
    mesesExecutados,
  };
}

// ===================== Gráfico anual (Canvas 2D) =====================
function desenharGraficoAnual(canvas, linhas, data0) {
  const ctx = canvas.getContext("2d");
  const W = (canvas.width = canvas.clientWidth * devicePixelRatio);
  const H = (canvas.height = canvas.clientHeight * devicePixelRatio);

  ctx.clearRect(0, 0, W, H);
  if (!linhas.length) return;

  const series = {};
  linhas.forEach((l, idx) => {
    let ano = "Sem data";
    if (data0) {
      const d = new Date(
        Date.UTC(
          data0.getUTCFullYear(),
          data0.getUTCMonth() + idx,
          data0.getUTCDate()
        )
      );
      ano = d.getUTCFullYear();
    }
    series[ano] = series[ano] || { juros: 0, amort: 0 };
    series[ano].juros += l.juros;
    series[ano].amort += l.amortizacao + l.extra;
  });

  const anos = Object.keys(series).map((a) => String(a));
  const maxV = Math.max(
    1,
    ...anos.map((a) => series[a].juros + series[a].amort)
  );

  const padL = 50 * devicePixelRatio,
    padB = 28 * devicePixelRatio,
    padT = 20 * devicePixelRatio;
  const usableW = W - padL - 20 * devicePixelRatio;
  const usableH = H - padT - padB;
  const barW = Math.max(
    14 * devicePixelRatio,
    usableW / (anos.length * 1.8)
  );

  ctx.strokeStyle = "#64748b";
  ctx.lineWidth = 1 * devicePixelRatio;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, H - padB);
  ctx.lineTo(W - 20 * devicePixelRatio, H - padB);
  ctx.stroke();

  anos.forEach((a, i) => {
    const x = padL + (i + 0.5) * (usableW / anos.length);
    const hA = (series[a].amort / maxV) * usableH;
    const hJ = (series[a].juros / maxV) * usableH;

    ctx.fillStyle = "#22d3ee";
    ctx.fillRect(x - barW / 2, H - padB - hA, barW, hA);

    ctx.fillStyle = "#94a3b8";
    ctx.fillRect(x - barW / 2, H - padB - hA - hJ, barW, hJ);

    ctx.fillStyle = "#cbd5e1";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = `${12 * devicePixelRatio}px sans-serif`;
    ctx.fillText(a, x, H - padB + 6 * devicePixelRatio);
  });
}

// ===================== CSV, Link e PDF =====================
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
  const csv =
    [header.join(";")].concat(rows.map((r) => r.join(";"))).join("\n");
  return new Blob(["\uFEFF" + csv], {
    type: "text/csv;charset=utf-8;",
  });
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
const $ = (sel) => document.querySelector(sel);

// Referências aos elementos do HTML
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
  // CORREÇÃO APLICADA AQUI: Busca o tbody dentro da tabela#tabela
  tabela: $("#tabela tbody"), 
  grafico: $("#grafico"),
  baixarCsv: $("#baixarCsv"),
  copiarLinkBtn: $("#copiarLink"),
  baixarPdf: $("#baixarPdf"),
  usarTR: $("#usarTR"),
};

// Aplicação das Máscaras
["#principal", "#seguroTaxa", "#extraValor", "#extraMensal"].forEach(
  (sel) => attachBRLMask($(sel))
);
attachPercentMask(el.rate, { maxInt: 5, maxDec: 6, fixedOnBlur: 4 });

const extras = []; // { valor, data, mes }

function renderExtrasChips() {
  if (!el.extrasChips) return;
  el.extrasChips.innerHTML = "";
  extras
    .sort((a, b) => a.mes - b.mes)
    .forEach((ex, idx) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = `${fmtDate(ex.data)} • ${fmtBRL.format(
        ex.valor
      )}`;
      chip.title = "Clique para remover";
      // Usamos .bind(null, idx) para capturar o índice correto no momento do clique
      chip.onclick = () => {
        // Remove pelo índice, ajustando a ordem de remoção
        const idxParaRemover = extras.findIndex(
          (e) => e.mes === ex.mes && e.valor === ex.valor
        );
        if (idxParaRemover > -1) {
            extras.splice(idxParaRemover, 1);
            renderExtrasChips();
        }
      };
      el.extrasChips.appendChild(chip);
    });
}

if (el.addExtra) {
  el.addExtra.onclick = () => {
    const v = parseBRNumber(el.extraValor.value);
    const dStr = el.extraData.value;
    if (!(v > 0) || !dStr) {
      alert("Informe valor e data da amortização.");
      return;
    }
    if (!el.dataInicio.value) {
      alert(
        "Defina a Data do 1º vencimento antes de adicionar amortizações."
      );
      return;
    }
    const [Y, M, D] = dStr.split("-").map(Number);
    const d = new Date(Date.UTC(Y, M - 1, D));

    const [Y0, M0, D0] = el.dataInicio.value.split("-").map(Number);
    const d0 = new Date(Date.UTC(Y0, M0 - 1, D0));
    const mes = monthIndexFromDate(d0, d);
    if (mes < 1) {
      alert(
        "A data da amortização deve ser no mesmo mês do 1º vencimento ou após."
      );
      return;
    }
    extras.push({ valor: v, data: d, mes });
    el.extraValor.value = "";
    el.extraData.value = "";
    renderExtrasChips();
  };
}

function paramsAtuais() {
  const params = {
    p: el.principal.value,
    i: el.rate.value,
    n: el.periodo.value,
    sys: el.sistema.value,
    t: el.tipoTaxa.value,
    d: el.dataInicio.value,
    fee: el.seguroTaxa.value,
    em: el.extraMensal.value,
    tr: el.usarTR && el.usarTR.checked ? "1" : "0",
  };
  extras.forEach((ex, idx) => {
    const y = ex.data.getUTCFullYear();
    const m = String(ex.data.getUTCMonth() + 1).padStart(2, "0");
    const d = String(ex.data.getUTCDate()).padStart(2, "0");
    params[`ex${idx + 1}`] = `${fmtBRL.format(ex.valor)}@${y}-${m}-${d}`;
  });
  return params;
}

function lerDoQuery() {
  const url = new URL(location.href);
  const get = (k, d = "") => url.searchParams.get(k) ?? d;

  el.principal.value = get("p", "");
  el.rate.value = get("i", "");
  el.periodo.value = get("n", "");
  el.sistema.value = get("sys", "price");
  el.tipoTaxa.value = get("t", "aa");
  el.dataInicio.value = get("d", "");
  el.seguroTaxa.value = get("fee", "");
  el.extraMensal.value = get("em", "");

  const trFlag = get("tr", "0");
  if (el.usarTR) {
    el.usarTR.checked = trFlag === "1";
  }

  const exParams = [...url.searchParams.entries()].filter(([k]) =>
    /^ex\d+$/.test(k)
  );
  extras.length = 0;
  exParams.forEach(([k, v]) => {
    const [valStr, dateStr] = v.split("@");
    const val = parseBRNumber(valStr);
    const [Y, M, D] = (dateStr || "").split("-").map(Number);
    if (val > 0 && Y) {
      const d = new Date(Date.UTC(Y, M - 1, D));
      if (el.dataInicio.value) {
        const [Y0, M0, D0] = el.dataInicio.value
          .split("-")
          .map(Number);
        const d0 = new Date(Date.UTC(Y0, M0 - 1, D0));
        const mes = monthIndexFromDate(d0, d);
        if (mes >= 1) extras.push({ valor: val, data: d, mes });
      }
    }
  });
  renderExtrasChips();
}

// ==== CÁLCULO PRINCIPAL (AGORA ASSÍNCRONO POR CAUSA DA TR) ====
async function calcular() {
  const principal = parseBRNumber(el.principal.value);
  const taxa = parseBRNumber(el.rate.value);
  const nMeses = parseInt(el.periodo.value || "0", 10);
  const sistema = el.sistema.value;
  const tipoTaxa = el.tipoTaxa.value;
  const seguroTaxa = parseBRNumber(el.seguroTaxa.value);
  const extraMensal = parseBRNumber(el.extraMensal.value);

  let data0 = null;
  if (el.dataInicio.value) {
    const [Y, M, D] = el.dataInicio.value.split("-").map(Number);
    if (Y && M && D) {
      data0 = new Date(Date.UTC(Y, M - 1, D));
    }
  }

  if (!(principal > 0) || !(nMeses > 0)) {
    // Limpa os resultados se os dados de entrada forem inválidos
    el.tabela.innerHTML = "";
    el.prestacaoIni.textContent = "R$ 0,00";
    el.totalPago.textContent = "R$ 0,00";
    el.totalJuros.textContent = "R$ 0,00";
    el.mesesQuitados.textContent = "0";
    desenharGraficoAnual(el.grafico, [], data0);
    return;
  }

  const iMes = tipoTaxa === "aa" ? mensalDeAnual(taxa) : taxa / 100;

  // === TR MENSAL AUTOMÁTICA OPCIONAL ===
  let mapaTR = null;
  const usarTR = el.usarTR && el.usarTR.checked;

  if (usarTR && data0 && nMeses > 0) {
    try {
      const dataFim = new Date(
        Date.UTC(
          data0.getUTCFullYear(),
          data0.getUTCMonth() + (nMeses - 1),
          data0.getUTCDate()
        )
      );
      mapaTR = await obterTRMensalMapa(data0, dataFim);
    } catch (err) {
      console.error("Falha ao obter TR do Banco Central:", err);
      // Se falhar, mapaTR continua null e o cálculo segue sem TR
    }
  }

  const extrasMes = [];
  if (data0) {
    extras.forEach((ex) =>
      extrasMes.push({ valor: ex.valor, mes: ex.mes, data: ex.data })
    );
  }

  const { linhas, totalJuros, totalPago, mesesExecutados } =
    gerarCronograma({
      principal,
      iMes,
      nMeses,
      sistema,
      extras: extrasMes,
      extraMensal,
      seguroTaxa,
      data0,
      mapaTR,
    });

  if (linhas.length) {
    el.prestacaoIni.textContent = fmtBRL.format(linhas[0].prestacao);
    el.totalPago.textContent = fmtBRL.format(totalPago);
    el.totalJuros.textContent = fmtBRL.format(totalJuros);
    el.mesesQuitados.textContent = String(mesesExecutados);
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

  if (el.baixarCsv) {
    el.baixarCsv.onclick = () => {
      const blob = toCSV(linhas);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "amortizacao.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    };
  }

  if (el.copiarLinkBtn) {
    el.copiarLinkBtn.onclick = () => copiarLink(paramsAtuais());
  }

  if (el.baixarPdf) {
    el.baixarPdf.onclick = () => exportarPDF();
  }
}

// Inicialização
if (el.form) {
  el.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await calcular();
  });
}

const spanAno = document.querySelector("#ano");
if (spanAno) spanAno.textContent = String(new Date().getFullYear());

// Roda o lerDoQuery e o cálculo inicial ao carregar a página
lerDoQuery(); 

// Tenta calcular ao carregar, caso os parâmetros já estejam na URL
if (new URLSearchParams(location.search).toString().length > 0) {
    calcular();
}
