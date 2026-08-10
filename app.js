/* WindADBench system UI — leaderboard, model/workload profiles, new-model
   positioning, new-dataset adaptation. Deterministic, fully client-side. */
"use strict";
const D = window.WINDAD;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

/* ---------------- data indices ---------------- */
const REG = Object.fromEntries(D.registry.map(r => [r.id, r]));
const MODELS = Object.keys(REG).sort();
const WLS = D.workloads.map(w => w.workload);
const WMETA = Object.fromEntries(D.workloads.map(w => [w.workload, w]));
const dimMap = {}; for (const d of D.dims) (dimMap[d.m] ??= {})[d.w] = d;
const metMap = {}; for (const m of D.metrics) (metMap[m.m] ??= {})[m.w] = m;
const DIMS = ["accuracy", "earliness", "reliability", "cost"];
const DIMK = { accuracy: "a", earliness: "e", reliability: "r", cost: "c" };
const FAMS = [...new Set(D.registry.map(r => r.family))].sort();

/* metric registry: label, direction (+1 higher better), decimals */
const M = {
  acc: ["Accuracy", 1, 3], point_precision: ["Point-P", 1, 3], point_recall: ["Point-R", 1, 3],
  point_f1: ["Point-F1", 1, 3], event_precision: ["Event-P", 1, 3], event_recall: ["Event-R", 1, 3],
  event_f1: ["Event-F1", 1, 3], event_affiliation_f1: ["Ev-Aff-F1", 1, 3],
  range_precision: ["Range-P", 1, 3], range_recall: ["Range-R", 1, 3], range_f1: ["Range-F1", 1, 3],
  affiliation_precision: ["Aff-P", 1, 3], affiliation_recall: ["Aff-R", 1, 3], affiliation_f1: ["Aff-F1", 1, 3],
  auc_pr: ["AUC-PR", 1, 3], auc_roc: ["AUC-ROC", 1, 3], range_auc_pr: ["R-AUC-PR", 1, 3],
  range_auc_roc: ["R-AUC-ROC", 1, 3], vus_pr: ["VUS-PR", 1, 3], vus_roc: ["VUS-ROC", 1, 3],
  mean_lead_time: ["Lead", 1, 1], mean_detection_delay: ["Delay", -1, 1],
  early_detection_rate: ["Early rate", 1, 3], false_alarms_per_turbine_day: ["FA/day", -1, 3],
  mtbfa: ["MTBFA", 1, 1],
  fit_time: ["Fit (s)", -1, 2], infer_time: ["Infer (s)", -1, 3],
  infer_gpu_mem: ["GPU (MB)", -1, 0], model_size: ["Size (MB)", -1, 1],
};
const GROUPS = {
  "Overview": ["event_f1", "vus_pr", "early_detection_rate", "mean_detection_delay",
               "false_alarms_per_turbine_day", "mtbfa", "infer_time"],
  "Detection": ["acc", "point_f1", "event_f1", "event_recall", "range_f1", "affiliation_f1", "event_affiliation_f1"],
  "Score-based": ["auc_pr", "auc_roc", "range_auc_pr", "range_auc_roc", "vus_pr", "vus_roc"],
  "Operational": ["mean_lead_time", "mean_detection_delay", "early_detection_rate",
                  "false_alarms_per_turbine_day", "mtbfa"],
  "Cost": ["fit_time", "infer_time", "infer_gpu_mem", "model_size"],
};
const fmt = (v, k) => v == null ? "—" : v.toFixed(M[k][2]);
const famChip = (f) => `<span class="chip f-${f}">${f}</span>`;
const flagHtml = (m) => (REG[m].flags || []).map(f => `<span class="flag" title="rule-based failure flag">⚠ ${f}</span>`).join("");
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;

function avgMetric(m, ws, k) {
  return mean(ws.map(w => metMap[m][w]?.[k]).filter(v => v != null));
}
function meanDims(m, ws) {
  const o = {};
  for (const d of DIMS) o[d] = mean(ws.map(w => dimMap[m][w]?.[DIMK[d]]).filter(v => v != null)) ?? 0;
  return o;
}
function bars(vals, labels) {
  return `<div class="dimbars">` + labels.map((d, i) => `
    <div class="dimbar"><span>${d}</span><span class="bar"><i style="width:${Math.round(100 * (vals[i] ?? 0))}%"></i></span><span>${vals[i] == null ? "—" : (100 * vals[i]).toFixed(0)}</span></div>`).join("") + `</div>`;
}

/* ---------------- router ---------------- */
const VIEWS = ["overview", "leaderboard", "models", "workloads", "agent"];
function route() {
  let h = (location.hash || "#overview").slice(1).split("/")[0];
  if (h === "newmodel" || h === "newdataset") h = "agent";  // legacy anchors
  const v = VIEWS.includes(h) ? h : "overview";
  VIEWS.forEach(x => $(`#view-${x}`).classList.toggle("active", x === v));
  $$("#nav a").forEach(a => a.classList.toggle("active", a.getAttribute("href") === "#" + v));
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);

/* ================ LEADERBOARD ================ */
let lbGroup = "Overview", lbSort = { k: "event_f1", asc: false };
function lbWorkloads() { return D.workloads.filter(w => w.track === $("#lb-track").value).map(w => w.workload); }
function fillLb() {
  $("#lb-workload").innerHTML = `<option value="__avg">Macro average</option>` +
    lbWorkloads().map(w => `<option>${w}</option>`).join("");
  $("#lb-family").innerHTML = `<option value="">All families</option>` + FAMS.map(f => `<option>${f}</option>`).join("");
  $("#lb-groups").innerHTML = Object.keys(GROUPS).map(g =>
    `<button class="gtab ${g === lbGroup ? "active" : ""}" data-g="${g}">${g}</button>`).join("");
  $$("#lb-groups .gtab").forEach(b => b.onclick = () => {
    lbGroup = b.dataset.g;
    if (!GROUPS[lbGroup].includes(lbSort.k)) { lbSort = { k: GROUPS[lbGroup][0], asc: M[GROUPS[lbGroup][0]][1] < 0 }; }
    fillLb(); renderLb();
  });
}
function renderLb() {
  const cols = GROUPS[lbGroup];
  const ws = $("#lb-workload").value === "__avg" ? lbWorkloads() : [$("#lb-workload").value];
  const fam = $("#lb-family").value, q = $("#lb-search").value.toLowerCase();
  let rows = MODELS.filter(m => (!fam || REG[m].family === fam) && m.includes(q))
    .map(m => ({ model: m, family: REG[m].family,
      ...Object.fromEntries(cols.map(k => [k, avgMetric(m, ws, k)])) }));
  rows.sort((x, y) => {
    const a = x[lbSort.k], b = y[lbSort.k];
    if (a == null) return 1; if (b == null) return -1;
    return lbSort.asc ? a - b : b - a;
  });
  const best = Object.fromEntries(cols.map(k => {
    const vs = rows.map(r => r[k]).filter(v => v != null);
    return [k, M[k][1] > 0 ? Math.max(...vs) : Math.min(...vs)];
  }));
  $("#lb-table").innerHTML =
    `<thead><tr><th>#</th><th>Model</th><th>Family</th>` +
    cols.map(k => `<th data-k="${k}" class="${lbSort.k === k ? "sorted" : ""}" title="${M[k][1] > 0 ? "higher" : "lower"} is better">${M[k][0]}${lbSort.k === k ? (lbSort.asc ? " ↑" : " ↓") : ""}</th>`).join("") +
    `</tr></thead><tbody>` +
    rows.map((r, i) => `<tr class="${i < 3 ? "top" + (i + 1) : ""}">
      <td class="rank">${i + 1}</td><td>${r.model}</td><td>${famChip(r.family)}</td>` +
      cols.map(k => `<td class="${r[k] != null && r[k] === best[k] ? "best" : ""}">${fmt(r[k], k)}</td>`).join("") +
      `</tr>`).join("") + `</tbody>`;
  $("#lb-table thead").onclick = (e) => {
    const k = e.target.dataset?.k; if (!k) return;
    if (lbSort.k === k) lbSort.asc = !lbSort.asc; else lbSort = { k, asc: M[k][1] < 0 };
    renderLb();
  };
}
$("#lb-track").onchange = () => { fillLb(); renderLb(); };
["#lb-workload", "#lb-family"].forEach(id => $(id).onchange = renderLb);
$("#lb-search").oninput = renderLb;

/* ================ MODELS ================ */
function fillModels() {
  $("#md-family").innerHTML = `<option value="">All families</option>` + FAMS.map(f => `<option>${f}</option>`).join("");
}
function renderModels() {
  const fam = $("#md-family").value, cpu = $("#md-cpu").checked, q = $("#md-search").value.toLowerCase();
  const rows = MODELS.filter(m => (!fam || REG[m].family === fam) && (!cpu || !REG[m].needs_gpu) && m.includes(q));
  $("#md-table").innerHTML =
    `<thead><tr><th>Model</th><th>Family</th><th>GPU</th><th>Size (MB)</th><th>Infer (s)</th>
     <th>Acc</th><th>Early</th><th>Reliab</th><th>General</th><th>Cost</th><th>Flags</th></tr></thead><tbody>` +
    rows.map(m => { const c = D.cards[m]; return `<tr data-m="${m}" class="click">
      <td><b>${m}</b></td><td>${famChip(REG[m].family)}</td>
      <td>${REG[m].needs_gpu ? "●" : "—"}</td>
      <td>${REG[m].model_size == null ? "—" : REG[m].model_size.toFixed(1)}</td>
      <td>${REG[m].infer_time == null ? "—" : REG[m].infer_time.toFixed(3)}</td>
      ${["accuracy", "earliness", "reliability", "generalization", "cost"].map(d =>
        `<td><span class="pct">${Math.round(100 * c[d])}</span></td>`).join("")}
      <td>${(REG[m].flags || []).length ? "⚠ " + REG[m].flags.length : ""}</td></tr>`; }).join("") + `</tbody>`;
  $$("#md-table tr.click").forEach(tr => tr.onclick = () => renderModelDetail(tr.dataset.m));
}
function renderModelDetail(m) {
  const c = D.cards[m];
  const rows = WLS.map(w => {
    const t = metMap[m][w] || {}, d = dimMap[m][w] || {};
    return `<tr><td>${w.replace(">", "→")}</td><td>${WMETA[w].track}</td>
      <td>${fmt(t.event_f1, "event_f1")}</td><td>${fmt(t.early_detection_rate, "early_detection_rate")}</td>
      <td>${fmt(t.mean_detection_delay, "mean_detection_delay")}</td>
      <td>${fmt(t.false_alarms_per_turbine_day, "false_alarms_per_turbine_day")}</td>
      <td>${d.a == null ? "—" : Math.round(100 * d.a)}</td><td>${d.e == null ? "—" : Math.round(100 * d.e)}</td>
      <td>${d.r == null ? "—" : Math.round(100 * d.r)}</td></tr>`;
  }).join("");
  $("#md-detail").innerHTML = `<div class="panel detail">
    <h3>${m} ${famChip(REG[m].family)} ${REG[m].needs_gpu ? '<span class="tag">GPU</span>' : '<span class="tag ok">CPU-only</span>'} ${flagHtml(m)}</h3>
    <div class="detail-grid">
      <div><h4>Five-dimension card (percentile vs. 36 models)</h4>
        ${bars(["accuracy", "earliness", "reliability", "generalization", "cost"].map(d => c[d]),
               ["accuracy", "earliness", "reliability", "generalization", "cost"])}
        <h4>Capability</h4>
        <p class="small muted">model size ${REG[m].model_size == null ? "—" : REG[m].model_size.toFixed(1)} MB ·
        median fit ${REG[m].fit_time == null ? "—" : REG[m].fit_time.toFixed(2)} s ·
        median infer ${REG[m].infer_time == null ? "—" : REG[m].infer_time.toFixed(3)} s</p></div>
      <div><h4>Per-workload results</h4>
        <div class="tablewrap"><table class="mini"><thead><tr><th>Workload</th><th>Track</th><th>Ev-F1</th>
        <th>Early</th><th>Delay</th><th>FA/day</th><th>A</th><th>E</th><th>R</th></tr></thead>
        <tbody>${rows}</tbody></table></div></div>
    </div></div>`;
  $("#md-detail").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
$("#md-family").onchange = renderModels; $("#md-cpu").onchange = renderModels;
$("#md-search").oninput = renderModels;

/* ================ WORKLOADS ================ */
function topModels(w, n) {
  return MODELS.map(m => [m, metMap[m][w]?.event_f1]).filter(x => x[1] != null)
    .sort((a, b) => b[1] - a[1]).slice(0, n);
}
function renderWorkloads() {
  $("#wl-table").innerHTML =
    `<thead><tr><th>Workload</th><th>Track</th><th>Source→Target</th><th>Events</th>
     <th>Diagnostic value</th><th>Plan #</th><th>Cost proxy (s)</th><th>Top-3 by Event-F1</th></tr></thead><tbody>` +
    D.workloads.map(w => `<tr data-w="${w.workload}" class="click">
      <td><b>${w.workload.replace(">", "→")}</b></td><td>${w.track}</td>
      <td>${w.source}→${w.target}</td><td>${w.n_events}</td>
      <td><span class="bar wide"><i style="width:${Math.round(100 * w.disc)}%"></i></span></td>
      <td>${w.order_pos}</td><td>${w.cost_proxy.toFixed(2)}</td>
      <td class="small">${topModels(w.workload, 3).map(x => x[0]).join(", ")}</td></tr>`).join("") + `</tbody>`;
  $$("#wl-table tr.click").forEach(tr => tr.onclick = () => renderWlDetail(tr.dataset.w));
}
function renderWlDetail(w) {
  const rows = MODELS.map(m => {
    const t = metMap[m][w] || {}, d = dimMap[m][w] || {};
    const u = mean([d.a, d.e, d.r, d.c].filter(v => v != null)) ?? 0;
    return { m, u, t };
  }).sort((a, b) => b.u - a.u).slice(0, 10);
  $("#wl-detail").innerHTML = `<div class="panel detail">
    <h3>${w.replace(">", "→")} <span class="tag">${WMETA[w].track}</span>
      <span class="muted small">· ${WMETA[w].n_events} anomaly events · evaluation-plan position ${WMETA[w].order_pos}/12</span></h3>
    <h4>Top-10 models on this workload (equal-weight utility over 4 dimensions)</h4>
    <div class="tablewrap"><table class="mini"><thead><tr><th>#</th><th>Model</th><th>Family</th><th>U</th>
      <th>Ev-F1</th><th>Early</th><th>FA/day</th></tr></thead><tbody>` +
    rows.map((r, i) => `<tr><td>${i + 1}</td><td><b>${r.m}</b></td><td>${famChip(REG[r.m].family)}</td>
      <td>${r.u.toFixed(3)}</td><td>${fmt(r.t.event_f1, "event_f1")}</td>
      <td>${fmt(r.t.early_detection_rate, "early_detection_rate")}</td>
      <td>${fmt(r.t.false_alarms_per_turbine_day, "false_alarms_per_turbine_day")}</td></tr>`).join("") +
    `</tbody></table></div></div>`;
  $("#wl-detail").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ================ NEW MODEL ================ */
function pct(values, v, dir) {  /* fraction of reference values the user's v beats */
  const vs = values.filter(x => x != null);
  if (!vs.length || v == null) return null;
  const beat = vs.filter(x => dir > 0 ? x <= v : x >= v).length;
  return beat / vs.length;
}
const NM_FIELDS = [["event_f1", "Event-F1"], ["vus_pr", "VUS-PR"], ["early_detection_rate", "Early rate"],
                   ["mean_detection_delay", "Delay"], ["false_alarms_per_turbine_day", "FA/day"]];
function nmRow(i) {
  return `<div class="nm-row" data-i="${i}">
    <select class="nm-w">${WLS.map(w => `<option>${w}</option>`).join("")}</select>
    ${NM_FIELDS.map(([k, l]) => `<input type="number" step="any" class="nm-${k}" placeholder="${l}">`).join("")}
  </div>`;
}
function userDims(w, vals) {
  const col = (k) => MODELS.map(m => metMap[m][w]?.[k]);
  const a = mean([pct(col("event_f1"), vals.event_f1, 1), pct(col("vus_pr"), vals.vus_pr, 1)].filter(v => v != null));
  const e = mean([pct(col("early_detection_rate"), vals.early_detection_rate, 1),
                  pct(col("mean_detection_delay"), vals.mean_detection_delay, -1)].filter(v => v != null));
  const r = pct(col("false_alarms_per_turbine_day"), vals.false_alarms_per_turbine_day, -1);
  return { a, e, r };
}
function runNewModel() {
  const entered = {};
  $$(".nm-row").forEach(row => {
    const w = row.querySelector(".nm-w").value, vals = {};
    let any = false;
    for (const [k] of NM_FIELDS) {
      const x = row.querySelector(`.nm-${k}`).value;
      vals[k] = x === "" ? null : +x; if (x !== "") any = true;
    }
    if (any) entered[w] = userDims(w, vals);
  });
  const ws = Object.keys(entered);
  if (!ws.length) { $("#nm-out").innerHTML = `<p class="muted">Enter at least one measured value.</p>`; return; }
  /* kNN in revealed-percentile space */
  const dist = MODELS.map(m => {
    const ds = [];
    for (const w of ws) for (const d of ["a", "e", "r"])
      if (entered[w][d] != null && dimMap[m][w]?.[d] != null) ds.push(Math.abs(entered[w][d] - dimMap[m][w][d]));
    return [m, mean(ds) ?? 1];
  }).sort((x, y) => x[1] - y[1]);
  const nbrs = dist.slice(0, 3).map(x => x[0]);
  /* predicted card: entered workloads use user percentiles, others use neighbor means */
  const card = {};
  for (const [dim, dk] of [["accuracy", "a"], ["earliness", "e"], ["reliability", "r"]]) {
    card[dim] = mean(WLS.map(w => entered[w]?.[dk] != null ? entered[w][dk]
      : mean(nbrs.map(n => dimMap[n][w]?.[dk]).filter(v => v != null))).filter(v => v != null));
  }
  card.generalization = mean(WLS.filter(w => WMETA[w].track !== "in-farm")
    .map(w => entered[w]?.a != null ? entered[w].a
      : mean(nbrs.map(n => dimMap[n][w]?.a).filter(v => v != null))).filter(v => v != null));
  card.cost = mean(nbrs.map(n => D.cards[n].cost));
  /* rank estimate among 37 (equal-weight aggregate of a/e/r/cost) */
  const myU = mean([card.accuracy, card.earliness, card.reliability, card.cost]);
  const better = MODELS.filter(m => mean([D.cards[m].accuracy, D.cards[m].earliness,
    D.cards[m].reliability, D.cards[m].cost]) > myU).length;
  const dominated = MODELS.some(m => D.cards[m].cost >= card.cost && D.cards[m].earliness >= card.earliness
    && (D.cards[m].cost > card.cost || D.cards[m].earliness > card.earliness));
  const K = ws.length;
  const expErr = D.modeB.summary.mae_at_K[String(Math.min(6, Math.max(2, K % 2 ? K + 1 : K)))] ?? 0.057;
  const flags = [];
  if (card.reliability != null && card.reliability < 0.25) flags.push("high false-alarm burden vs. cohort");
  if (card.accuracy > 0.6 && card.earliness < 0.2) flags.push("good detection but weak early warning (single-spike risk)");
  $("#nm-out").innerHTML = `
    <div class="rec-primary"><span class="klabel">Predicted positioning (from ${K} workload${K > 1 ? "s" : ""})</span>
      <div class="name">≈ rank ${better + 1} of 37 <span class="muted small">equal-weight aggregate</span>
        ${dominated ? "" : '<span class="star" title="on the cost–earliness Pareto frontier">★ Pareto</span>'}
        ${flags.map(f => `<span class="flag">⚠ ${f}</span>`).join("")}</div>
      ${bars(["accuracy", "earliness", "reliability", "generalization", "cost"].map(d => card[d]),
             ["accuracy", "earliness", "reliability", "generalization", "cost"])}</div>
    <ul class="rec-list">
      <li><span>Nearest reference models</span><span>${nbrs.map(n => `<b>${n}</b>`).join(", ")}</span></li>
      <li><span>Expected card error at this budget</span><span>≈ ${(expErr * 100).toFixed(1)} percentile points</span></li>
      <li><span>Suggested next workload</span><span><b>${D.modeB.order.find(w => !ws.includes(w)) ?? "—"}</b></span></li>
    </ul>
    <p class="fineprint">Retrospective estimate from the published matrix (leave-one-model-out protocol);
    run the full 12-workload suite for leaderboard entry.</p>`;
}

/* ================ NEW DATASET ================ */
const ND_PRESETS = {
  "Balanced": { accuracy: .25, earliness: .25, reliability: .25, cost: .25 },
  "Limited review capacity": { accuracy: .2, earliness: .1, reliability: .6, cost: .1 },
  "Fault-safety first": { accuracy: .3, earliness: .5, reliability: .1, cost: .1 },
  "Efficiency first": { accuracy: .2, earliness: .2, reliability: .2, cost: .4 },
};
function ndWeights() {
  const raw = DIMS.map(d => +$(`#ndw-${d}`).value), s = raw.reduce((a, b) => a + b, 0) || 1;
  DIMS.forEach((d, i) => $(`#ndv-${d}`).textContent = Math.round(100 * raw[i] / s) + "%");
  return Object.fromEntries(DIMS.map((d, i) => [d, raw[i] / s]));
}
function nearestFarm() {
  const t = +$("#nd-turbines").value || 10, f = +$("#nd-features").value || 100, ty = $("#nd-type").value;
  let best = null, bd = Infinity;
  for (const [farm, m] of Object.entries(D.farms)) {
    const d = Math.abs(Math.log(t / m.turbines)) + Math.abs(Math.log(f / m.features))
      + (ty === m.type ? 0 : 0.35);
    if (d < bd) { bd = d; best = farm; }
  }
  return best;
}
function runNewDataset() {
  const farm = nearestFarm(), labels = $("#nd-labels").value === "yes";
  const w = ndWeights(), cpu = $("#nd-cpu").checked;
  const faMax = $("#nd-fa").value === "" ? null : +$("#nd-fa").value;
  const szMax = $("#nd-size").value === "" ? null : +$("#nd-size").value;
  const ev = labels ? [`IF-${farm}`, `CT-${farm}`] : WLS.filter(x => x.endsWith(`>${farm}`));
  const excluded = [];
  const feas = MODELS.filter(m => {
    if (cpu && REG[m].needs_gpu) { excluded.push([m, "needs GPU"]); return false; }
    if (faMax != null) {
      const fa = avgMetric(m, ev, "false_alarms_per_turbine_day");
      if (fa != null && fa > faMax) { excluded.push([m, `FA/day ${fa.toFixed(2)} > ${faMax}`]); return false; }
    }
    if (szMax != null && REG[m].model_size > szMax) { excluded.push([m, `size > ${szMax} MB`]); return false; }
    return true;
  });
  if (!feas.length) { $("#nd-out").innerHTML = `<p class="muted">No feasible model — relax the constraints.</p>`; return; }
  const dims = Object.fromEntries(feas.map(m => [m, meanDims(m, ev)]));
  const pareto = new Set(feas.filter(m => !feas.some(o => o !== m &&
    DIMS.every(d => dims[o][d] >= dims[m][d]) && DIMS.some(d => dims[o][d] > dims[m][d]))));
  const ranked = feas.map(m => [m, DIMS.reduce((s, d) => s + w[d] * dims[m][d], 0)]).sort((a, b) => b[1] - a[1]);
  const fm = D.farms[farm], [p1] = ranked[0];
  const lowCost = ranked.slice().sort((a, b) => dims[b[0]].cost - dims[a[0]].cost)[0][0];
  const hiSens = ranked.slice().sort((a, b) => dims[b[0]].earliness - dims[a[0]].earliness)[0][0];
  const checklist = labels ? [
    "Map your SCADA channels to the aligned feature space (temperature, wind speed, power, rotational speed).",
    "Build farm–turbine–event workloads with the three leakage-control rules before any training.",
    `Pilot the top-3 on one in-farm workload first; expected effort ≈ ${WMETA[`IF-${farm}`].cost_proxy.toFixed(1)} s/model (reference median).`,
  ] : [
    "Collect ≥ 1 month of normal-operation data per turbine for score scaling and threshold calibration.",
    "Calibrate each model's threshold to the 1% FPR budget on YOUR normal data (99th percentile of normal scores).",
    "Monitor FA/day for 2–4 weeks before trusting alarms; pilot the top-3 shortlist in shadow mode.",
  ];
  $("#nd-out").innerHTML = `
    <div class="arch">Closest benchmark farm: <b>Farm ${farm}</b>
      <span class="muted small">(${fm.turbines} turbines · ${fm.features} features · ${fm.type})</span><br>
      <span class="muted small">Evidence: ${ev.map(x => x.replace(">", "→")).join(", ")}
      ${labels ? "" : " — cold start, target fault labels never used"}</span></div>
    <div class="rec-primary"><span class="klabel">Primary recommendation</span>
      <div class="name">${p1} ${famChip(REG[p1].family)}
        ${pareto.has(p1) ? '<span class="star">★</span>' : ""}${flagHtml(p1)}</div>
      ${bars(DIMS.map(d => dims[p1][d]), DIMS)}</div>
    <ul class="rec-list">
      ${ranked.slice(0, 3).map(([m, u], i) => `<li><span>${i + 1}. <b>${m}</b> ${famChip(REG[m].family)}
        ${pareto.has(m) ? '<span class="star">★</span>' : ""}${flagHtml(m)}</span>
        <span class="muted">U = ${u.toFixed(3)}</span></li>`).join("")}
      <li><span>Low-cost fallback: <b>${lowCost}</b> · high-sensitivity fallback: <b>${hiSens}</b></span></li>
    </ul>
    <h4>Adaptation checklist</h4>
    <ol class="checklist">${checklist.map(c => `<li>${c}</li>`).join("")}</ol>
    <details><summary>${excluded.length} excluded · ${feas.length} feasible · ★ Pareto-optimal</summary>
      ${excluded.map(([m, r]) => `${m} — ${r}`).join("<br>")}</details>
    <p class="fineprint">Confidence: ${labels ? "MEDIUM — in-distribution evidence from the closest farm."
      : "LOW–MEDIUM — cross-farm evidence with 2–7 events per direction; treat as a prior-ranked shortlist (LOFO replay: agent regret 0.092 vs. global-best 0.196; piloting top-3 → 0.049)."}</p>`;
}

/* ================ chart (new-model view) ================ */
function drawChart(sel) {
  const c = D.modeB.curve, r = D.modeB.random;
  const W = 520, H = 250, L = 44, B = 32, T = 10, R = 8, ymax = 0.12;
  const x = k => L + (k - 1) / 11 * (W - L - R);
  const y = v => T + (1 - v / ymax) * (H - T - B);
  const line = (pts, key) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.K).toFixed(1)},${y(p[key]).toFixed(1)}`).join("");
  const band = r.map(p => `${x(p.K).toFixed(1)},${y(p.rand_p75).toFixed(1)}`).join(" ") + " " +
    [...r].reverse().map(p => `${x(p.K).toFixed(1)},${y(p.rand_p25).toFixed(1)}`).join(" ");
  $(sel).innerHTML = `<svg viewBox="0 0 ${W} ${H}" font-size="10" fill="#5b6b7b">
    ${[0, .04, .08, .12].map(v => `<line x1="${L}" y1="${y(v)}" x2="${W - R}" y2="${y(v)}" stroke="#eef1f4"/>
      <text x="${L - 5}" y="${y(v) + 3}" text-anchor="end">${v.toFixed(2)}</text>`).join("")}
    ${[1, 4, 8, 12].map(k => `<text x="${x(k)}" y="${H - B + 14}" text-anchor="middle">${k}</text>`).join("")}
    <polygon points="${band}" fill="#d7dde3" opacity=".55"/>
    <path d="${line(c, "oracle_mae")}" stroke="#1f4e79" stroke-dasharray="6 4" fill="none" stroke-width="1.4"/>
    <path d="${line(c, "diag_mae")}" stroke="#2e7d5b" fill="none" stroke-width="2"/>
    ${c.map(p => `<circle cx="${x(p.K)}" cy="${y(p.diag_mae)}" r="2.4" fill="#2e7d5b"/>`).join("")}
    <text x="${(L + W) / 2}" y="${H - 2}" text-anchor="middle">evaluated workloads K · card MAE</text></svg>`;
}

/* ================ init ================ */
function init() {
  fillLb(); renderLb();
  fillModels(); renderModels();
  renderWorkloads();
  $$("#da-tabs .da-tab").forEach(b => b.onclick = () => {
    $$("#da-tabs .da-tab").forEach(x => x.classList.toggle("active", x === b));
    $$(".da-pane").forEach(p => p.classList.toggle("active", p.id === "da-" + b.dataset.t));
  });
  $("#nm-order").innerHTML = D.modeB.order.map((w, i) =>
    `<li><span class="ord-n">${i + 1}</span><span class="ord-w">${w.replace(">", "→")}</span>
     <span class="ord-c">${WMETA[w].cost_proxy.toFixed(1)}s</span></li>`).join("");
  drawChart("#nm-chart");
  $("#nm-rows").innerHTML = nmRow(0);
  $("#nm-add").onclick = () => $("#nm-rows").insertAdjacentHTML("beforeend", nmRow($$(".nm-row").length));
  $("#nm-run").onclick = runNewModel;
  $("#nd-presets").innerHTML = Object.keys(ND_PRESETS).map(p => `<button class="preset" data-p="${p}">${p}</button>`).join("");
  $("#nd-sliders").innerHTML = DIMS.map(d => `
    <div class="slider-row"><span>${d}</span><input type="range" min="0" max="100" value="25" id="ndw-${d}">
    <span id="ndv-${d}">25%</span></div>`).join("");
  $$("#nd-presets .preset").forEach(b => b.onclick = () => {
    $$("#nd-presets .preset").forEach(x => x.classList.remove("active")); b.classList.add("active");
    const p = ND_PRESETS[b.dataset.p]; DIMS.forEach(d => $(`#ndw-${d}`).value = Math.round(100 * p[d]));
    runNewDataset();
  });
  ["#nd-turbines", "#nd-features", "#nd-type", "#nd-labels", "#nd-cpu", "#nd-fa", "#nd-size"]
    .forEach(id => $(id).onchange = runNewDataset);
  DIMS.forEach(d => $(`#ndw-${d}`).oninput = runNewDataset);
  document.querySelector("#nd-presets .preset").click();
  route();
}
init();
