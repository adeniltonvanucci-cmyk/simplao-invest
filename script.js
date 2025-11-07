/* =========================
   Utilidades de formato
========================= */
const fmtBR = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
const fmtDate = (d) => d.toLocaleDateString('pt-BR');

/** converte "R$ 10.000,00" / "10000,00" / "10000" para número */
function parseBRNumber(s) {
  if (typeof s !== 'string') s = String(s ?? '');
  s = s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

/** pega valor numérico de um input por id (aceita dinheiro com vírgula/ponto) */
function valNum(id) {
  const el = document.getElementById(id);
  if (!el) return 0;
  return parseBRNumber(el.value || '');
}

/** escreve texto em um id, se existir */
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/* =========================
   Máscara de dinheiro
========================= */
function moneyMask(el) {
  const raw = el.value.replace(/[^\d]/g, '');
  // permite apagar tudo
  if (!raw) { el.value = ''; return; }
  const n = parseInt(raw, 10);
  const val = (n / 100);
  el.value = fmtMoney.format(val);
}

/** aplica máscara/autoformatação */
function attachMoneyMask(ids) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.setAttribute('inputmode', 'numeric');
    el.addEventListener('input', () => {
      // não formata enquanto digita backspace rápido; formata no blur também
      moneyMask(el);
      recalcAll();
    });
    el.addEventListener('blur', () => moneyMask(el));
    // se tiver valor inicial, já formata
    if (el.value) moneyMask(el);
  });
}

/* =========================
   Leitura dos parâmetros
========================= */
function getParamsA() {
  return {
    tipo:        document.getElementById('tipo')?.value || 'CDB',
    regime:      document.getElementById('regime')?.value || 'pre', // 'pre' | 'pos' | 'ipca'
    taxaPre:     valNum('taxaPre'),
    percentCDI:  valNum('percentCDI'),
    cdiAnual:    valNum('cdiAnual'),
    ipcaAnual:   valNum('ipcaAnual'),
    spread:      valNum('spread'),
    aporteInicial: valNum('aporteInicial'),
    aporteMensal:  valNum('aporteMensal'),
    prazoMeses:    parseInt(document.getElementById('prazoMeses')?.value || '0', 10) || 0,
    iof:           document.getElementById('iof')?.value || 'nao',
    dataInicio:    document.getElementById('dataInicio')?.value || ''
  };
}
function getParamsB() {
  return {
    tipo:        document.getElementById('tipoB')?.value || 'CDB',
    regime:      document.getElementById('regimeB')?.value || 'pre',
    taxaPre:     valNum('taxaPreB'),
    percentCDI:  valNum('percentCDIB'),
    cdiAnual:    valNum('cdiAnualB'),
    ipcaAnual:   valNum('ipcaAnualB'),
    spread:      valNum('spreadB'),
    aporteInicial: valNum('aporteInicialB'),
    aporteMensal:  valNum('aporteMensalB'),
    prazoMeses:    parseInt(document.getElementById('prazoMesesB')?.value || '0', 10) || 0,
    iof:           document.getElementById('iofB')?.value || 'nao',
    dataInicio:    document.getElementById('dataInicioB')?.value || ''
  };
}

/* =========================
   Simulador (mês a mês)
========================= */
/**
 * Simula investimento mês a mês.
 * Retorna: { labels, linhas: [{mes,data,saldo,aporte,juros}], resumo, saldoSerie, aporteAcumSerie, jurosAcumSerie }
 */
function simulate(p) {
  const months = Math.max(0, p.prazoMeses|0);
  // taxa efetiva anual
  let rAnual = 0;
  if (p.regime === 'pre') {
    rAnual = (p.taxaPre || 0) / 100;
  } else if (p.regime === 'pos') {
    // % do CDI * CDI anual (%)
    rAnual = ((p.percentCDI || 0) / 100) * ((p.cdiAnual || 0) / 100);
  } else { // 'ipca'
    const ipca = (p.ipcaAnual || 0) / 100;
    const sp   = (p.spread   || 0) / 100;
    rAnual = (1 + ipca) * (1 + sp) - 1;
  }
  const rMensal = Math.pow(1 + rAnual, 1 / 12) - 1;

  // IR regressivo pela duração total
  // (CDB/Tesouro pagam IR; LCI/LCA isento)
  const isIsento = (String(p.tipo).toUpperCase() === 'LCI' || String(p.tipo).toUpperCase() === 'LCA');
  let aliquotaIR = 0;
  if (!isIsento) {
    if (months <= 6) aliquotaIR = 0.225;
    else if (months <= 12) aliquotaIR = 0.20;
    else if (months <= 24) aliquotaIR = 0.175;
    else aliquotaIR = 0.15;
  }

  // data de início
  let dt = p.dataInicio ? new Date(p.dataInicio) : new Date();
  if (!isFinite(dt.getTime())) dt = new Date(); // fallback
  dt.setHours(0,0,0,0);

  let saldo = p.aporteInicial || 0;
  let aporteAcum = p.aporteInicial || 0;
  let jurosAcum  = 0;

  const labels = [];
  const linhas = [];
  const saldoSerie = [];
  const aporteAcumSerie = [];
  const jurosAcumSerie  = [];

  // gera meses
  for (let m = 1; m <= months; m++) {
    const dtMes = new Date(dt);
    dtMes.setMonth(dtMes.getMonth() + (m - 1));

    // juros do mês
    const jurosMes = saldo * rMensal;
    saldo += jurosMes;
    jurosAcum += jurosMes;

    // IOF simplificado: se marcado "sim", desconta 30% dos juros do 1º mês (aprox) — modelo didático
    let iofMes = 0;
    if (p.iof === 'sim' && m === 1) {
      iofMes = 0.30 * jurosMes;
      saldo -= iofMes;
    }

    // aporte no fim do mês
    const aporte = p.aporteMensal || 0;
    saldo += aporte;
    aporteAcum += aporte;

    labels.push(`M${m}`);
    linhas.push({
      mes: m,
      data: fmtDate(dtMes),
      saldo,
      aporte,
      juros: jurosMes - iofMes // juros líquidos do mês após IOF simplificado
    });
    saldoSerie.push(saldo);
    aporteAcumSerie.push(aporteAcum);
    jurosAcumSerie.push(jurosAcum - iofMes);
  }

  // IR no resgate (sobre juros brutos acumulados)
  const ir = isIsento ? 0 : Math.max(0, jurosAcum * aliquotaIR);
  const saldoLiquido = Math.max(0, saldo - ir);
  const totalInvestido = (p.aporteInicial || 0) + (p.aporteMensal || 0) * months;
  const rendimentoBruto = Math.max(0, saldo - totalInvestido);

  return {
    labels,
    linhas,
    resumo: {
      saldoLiquido,
      totalInvestido,
      rendimentoBruto,
      ir
    },
    saldoSerie,
    aporteAcumSerie,
    jurosAcumSerie
  };
}

/* =========================
   Preenche cards + tabela
========================= */
function fillCardsAndTable(S) {
  // cards
  setText('saldoLiquido',     fmtMoney.format(S.resumo.saldoLiquido));
  setText('totalInvestido',   fmtMoney.format(S.resumo.totalInvestido));
  setText('rendimentoBruto',  fmtMoney.format(S.resumo.rendimentoBruto));
  setText('impostos',         fmtMoney.format(S.resumo.ir));

  // tabela
  const tbody = document.getElementById('tabela');
  if (!tbody) return;
  tbody.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const lin of S.linhas) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${lin.mes}</td>
      <td>${lin.data}</td>
      <td>${fmtMoney.format(lin.saldo)}</td>
      <td>${fmtMoney.format(lin.aporte)}</td>
      <td>${fmtMoney.format(lin.juros)}</td>
    `;
    frag.appendChild(tr);
  }
  tbody.appendChild(frag);
}

/* =========================
   SVG Chart + Tooltip
========================= */

let chartState = {
  svg: null,
  box: null,
  w: 0,
  h: 0,
  margin: { top: 16, right: 16, bottom: 28, left: 48 },
  plotted: [], // [{label, color, points:[{x,y,v}], data:[...]}]
  labels: [],
  tooltipDiv: null,
  crosshair: null
};

function ensureChartElements() {
  const box = document.getElementById('chartBox');
  if (!box) return null;

  // container position for tooltip absolute
  box.style.position = 'relative';

  // SVG
  let svg = box.querySelector('svg#chartSvg');
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('id', 'chartSvg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '300');
    svg.style.display = 'block';
    box.innerHTML = '';
    box.appendChild(svg);
  }

  // Tooltip DIV
  let tip = box.querySelector('.chart-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tooltip';
    tip.style.position = 'absolute';
    tip.style.pointerEvents = 'none';
    tip.style.background = 'rgba(3,7,18,.9)';
    tip.style.color = '#e5e7eb';
    tip.style.fontSize = '12px';
    tip.style.border = '1px solid #1f2937';
    tip.style.padding = '6px 8px';
    tip.style.borderRadius = '6px';
    tip.style.boxShadow = '0 6px 18px rgba(0,0,0,.35)';
    tip.style.display = 'none';
    box.appendChild(tip);
  }

  chartState.svg = svg;
  chartState.box = box;
  chartState.tooltipDiv = tip;
  chartState.w = box.clientWidth;
  chartState.h = parseInt(svg.getAttribute('height'), 10) || 300;
  return svg;
}

/**
 * Renderiza múltiplos datasets no SVG e registra eventos de tooltip
 * datasets: [{label, data:[...], color, width, dash}]
 * labels:   ['M1','M2',...]
 */
function renderChartSVG(datasets, labels) {
  const svg = ensureChartElements();
  if (!svg) return;

  const { w, h, margin } = chartState;
  const innerW = Math.max(10, w - margin.left - margin.right);
  const innerH = Math.max(10, h - margin.top - margin.bottom);

  // prepara valores: pega o máximo entre todos
  const maxY = Math.max(
    1,
    ...datasets.flatMap(d => d.data.map(v => (isFinite(v) ? v : 0)))
  );

  const n = Math.max(1, labels.length);
  const xFor = (i) => margin.left + (i/(n-1)) * innerW;
  const yFor = (v) => margin.top + innerH - (v / maxY) * innerH;

  // limpa
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  // fundo
  const bg = document.createElementNS('http://www.w3.org/2000/svg','rect');
  bg.setAttribute('x', '0'); bg.setAttribute('y','0');
  bg.setAttribute('width','100%'); bg.setAttribute('height', String(h));
  bg.setAttribute('fill', 'transparent');
  svg.appendChild(bg);

  // grade horizontal (5 linhas)
  const grid = document.createElementNS('http://www.w3.org/2000/svg','g');
  const ticks = 5;
  for (let i=0;i<=ticks;i++){
    const y = margin.top + (i/ticks)*innerH;
    const line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1', String(margin.left));
    line.setAttribute('x2', String(margin.left + innerW));
    line.setAttribute('y1', String(y));
    line.setAttribute('y2', String(y));
    line.setAttribute('stroke', '#1f2937');
    line.setAttribute('stroke-width', '1');
    svg.appendChild(line);

    // label à esquerda
    const val = maxY * (1 - i/ticks);
    const t = document.createElementNS('http://www.w3.org/2000/svg','text');
    t.setAttribute('x', String(margin.left - 8));
    t.setAttribute('y', String(y + 4));
    t.setAttribute('text-anchor', 'end');
    t.setAttribute('fill', '#9ca3af');
    t.setAttribute('font-size', '11');
    t.textContent = fmtMoney.format(val);
    svg.appendChild(t);
  }
  svg.appendChild(grid);

  // eixo X (opcional: mostra só primeiros/últimos)
  if (labels.length) {
    const t1 = document.createElementNS('http://www.w3.org/2000/svg','text');
    t1.setAttribute('x', String(margin.left));
    t1.setAttribute('y', String(margin.top + innerH + 18));
    t1.setAttribute('fill','#9ca3af');
    t1.setAttribute('font-size','11');
    t1.textContent = labels[0];
    svg.appendChild(t1);

    const t2 = document.createElementNS('http://www.w3.org/2000/svg','text');
    t2.setAttribute('x', String(margin.left + innerW));
    t2.setAttribute('y', String(margin.top + innerH + 18));
    t2.setAttribute('text-anchor','end');
    t2.setAttribute('fill','#9ca3af');
    t2.setAttribute('font-size','11');
    t2.textContent = labels[labels.length-1];
    svg.appendChild(t2);
  }

  // paths das séries
  chartState.plotted = [];
  datasets.forEach(ds => {
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    let d = '';
    const points = [];
    ds.data.forEach((v, i) => {
      const x = xFor(i);
      const y = yFor(Math.max(0, v || 0));
      points.push({x,y,v, i});
      d += (i===0 ? `M ${x} ${y}` : ` L ${x} ${y}`);
    });
    path.setAttribute('d', d);
    path.setAttribute('fill','none');
    path.setAttribute('stroke', ds.color || '#22d3ee');
    path.setAttribute('stroke-width', String(ds.width || 2));
    if (ds.dash) path.setAttribute('stroke-dasharray', ds.dash);
    svg.appendChild(path);

    chartState.plotted.push({
      label: ds.label,
      color: ds.color || '#22d3ee',
      points,
      data: ds.data
    });
  });

  // crosshair (linha vertical + círculos)
  const cross = document.createElementNS('http://www.w3.org/2000/svg','line');
  cross.setAttribute('x1','0'); cross.setAttribute('x2','0');
  cross.setAttribute('y1', String(margin.top));
  cross.setAttribute('y2', String(margin.top + innerH));
  cross.setAttribute('stroke','#475569');
  cross.setAttribute('stroke-width','1');
  cross.setAttribute('opacity','0');
  svg.appendChild(cross);
  chartState.crosshair = cross;

  // pontos “selecionados” para tooltip
  const pointLayer = document.createElementNS('http://www.w3.org/2000/svg','g');
  svg.appendChild(pointLayer);

  // handler de tooltip
  svg.onmousemove = (ev) => {
    const rect = svg.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;

    // determina índice de coluna mais próxima
    // mapeia x => índice
    const idx = (() => {
      if (labels.length <= 1) return 0;
      const rel = Math.min(Math.max(mx - margin.left, 0), innerW);
      const frac = rel / innerW;
      return Math.round(frac * (labels.length - 1));
    })();

    // x alinhado do índice
    const xCol = xFor(idx);

    // encontra os valores de cada série nesse índice
    const rows = chartState.plotted.map(p => ({
      label: p.label,
      color: p.color,
      v: p.data[idx] ?? 0,
      pt: p.points[idx]
    }));

    // atualiza crosshair
    cross.setAttribute('x1', String(xCol));
    cross.setAttribute('x2', String(xCol));
    cross.setAttribute('opacity','1');

    // desenha círculos
    while (pointLayer.firstChild) pointLayer.removeChild(pointLayer.firstChild);
    rows.forEach(r => {
      const c = document.createElementNS('http://www.w3.org/2000/svg','circle');
      c.setAttribute('cx', String(r.pt.x));
      c.setAttribute('cy', String(r.pt.y));
      c.setAttribute('r','3');
      c.setAttribute('fill', r.color);
      c.setAttribute('stroke', '#0b1220');
      c.setAttribute('stroke-width', '1.5');
      pointLayer.appendChild(c);
    });

    // posiciona tooltip
    const tip = chartState.tooltipDiv;
    const lines = rows.map(r => `<div><span style="display:inline-block;width:10px;height:10px;background:${r.color};border-radius:2px;margin-right:6px"></span>${r.label}: <b>${fmtMoney.format(r.v)}</b></div>`);
    tip.innerHTML = `<div style="margin-bottom:4px;color:#9ca3af">${labels[idx]}</div>${lines.join('')}`;
    tip.style.display = 'block';
    let tx = xCol + 12;
    let ty = my - 10;
    // não deixar sair do box
    const bw = chartState.box.clientWidth;
    const th = tip.offsetHeight || 60;
    const tw = tip.offsetWidth  || 160;
    if (tx + tw > bw - 8) tx = xCol - tw - 12;
    if (ty < 8) ty = 8;
    tip.style.transform = `translate(${tx}px, ${ty}px)`;
  };
  svg.onmouseleave = () => {
    chartState.tooltipDiv.style.display = 'none';
    chartState.crosshair.setAttribute('opacity', '0');
    // limpa pontos
    // (mantém para quando retornar o mouse)
  };

  // guarda labels para tooltip
  chartState.labels = labels.slice();
}

/* =========================
   Resumo A x B
========================= */
function showComparacaoResumo(A, B) {
  const box = document.getElementById('comparacaoResumo');
  if (!box) return;
  if (!B) { box.style.display = 'none'; box.innerHTML = ''; return; }

  const a = A?.resumo?.saldoLiquido || 0;
  const b = B?.resumo?.saldoLiquido || 0;
  const dif = b - a;

  box.style.display = '';
  box.innerHTML = `
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <div style="padding:.65rem .9rem;border:1px solid #1f2937;border-radius:10px;background:#0b1220">
        <div style="font-size:.82rem;color:#94a3b8">Saldo final (A)</div>
        <div style="font-weight:700">${fmtMoney.format(a)}</div>
      </div>
      <div style="padding:.65rem .9rem;border:1px solid #1f2937;border-radius:10px;background:#0b1220">
        <div style="font-size:.82rem;color:#94a3b8">Saldo final (B)</div>
        <div style="font-weight:700">${fmtMoney.format(b)}</div>
      </div>
      <div style="padding:.65rem .9rem;border:1px solid #1f2937;border-radius:10px;background:#0b1220">
        <div style="font-size:.82rem;color:#94a3b8">Diferença (B − A)</div>
        <div style="font-weight:700;color:${dif>=0?'#10b981':'#f87171'}">${fmtMoney.format(dif)}</div>
      </div>
    </div>
  `;
}

/* =========================
   Recalcular tudo (A e B)
========================= */
function recalcAll() {
  const A = simulate(getParamsA());
  fillCardsAndTable(A);

  const datasets = [
    {label:'Saldo (A)',           data:A.saldoSerie,       color:'#22d3ee', width:2},
    {label:'Aportes (A) (acum)',  data:A.aporteAcumSerie,  color:'#60a5fa', width:2, dash:'6 4'},
    {label:'Juros (A) (acum)',    data:A.jurosAcumSerie,   color:'#a78bfa', width:2, dash:'2 3'}
  ];

  const useB = !!document.getElementById('chkCompare')?.checked;
  let B = null;
  if (useB) {
    B = simulate(getParamsB());
    datasets.push(
      {label:'Saldo (B)',           data:B.saldoSerie,       color:'#10b981', width:2},
      {label:'Aportes (B) (acum)',  data:B.aporteAcumSerie,  color:'#34d399', width:2, dash:'6 4'},
      {label:'Juros (B) (acum)',    data:B.jurosAcumSerie,   color:'#6ee7b7', width:2, dash:'2 3'}
    );
  }
  renderChartSVG(datasets, A.labels);
  showComparacaoResumo(A, B);
}

/* =========================
   Listeners / Inicialização
========================= */
function addListeners() {
  // inputs que disparam recálculo
  const ids = [
    // A
    'tipo','regime','taxaPre','percentCDI','cdiAnual','ipcaAnual','spread',
    'aporteInicial','aporteMensal','prazoMeses','iof','dataInicio',
    // B
    'tipoB','regimeB','taxaPreB','percentCDIB','cdiAnualB','ipcaAnualB','spreadB',
    'aporteInicialB','aporteMensalB','prazoMesesB','iofB','dataInicioB'
  ];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', recalcAll);
    el.addEventListener('change', recalcAll);
  });

  // checkbox de comparação
  const chk = document.getElementById('chkCompare');
  const sectionB = document.getElementById('sectionB');
  if (chk && sectionB) {
    const toggle = () => {
      sectionB.style.display = chk.checked ? '' : 'none';
      recalcAll();
    };
    chk.addEventListener('change', toggle);
    toggle(); // estado inicial
  }

  // máscara de dinheiro em A e B
  attachMoneyMask(['aporteInicial','aporteMensal','aporteInicialB','aporteMensalB']);
}

document.addEventListener('DOMContentLoaded', () => {
  addListeners();
  recalcAll();
});

