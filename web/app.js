const G = window.GymSimulation;
const { CONTROLS } = window.GymControls;
const SLOT_LABELS = G.labels;
const $ = id => document.getElementById(id);
// Series colours validated for the dark panel surface (dataviz validator: CVD dE >= 9.4, contrast >= 3:1).
const COLORS = { none: '#3987e5', live: '#d95926', delayed: '#199e70', reference: '#8d99a8', grid: '#2a3442', text: '#edf2f7', muted: '#8d99a8' };
const STATE_COLORS = { going: '#ff9f43', skipped: '#8d99a8', done: '#f7d774', waiting: '#70a7ff' };
const GRID_BUTTON_LIMIT = 300; // above this the agent field is drawn on one canvas
const MODE_LABELS = { none: 'None', live: 'Live', delayed: 'Delayed' };
const RESULT_ROWS = [
  ['pct-slots-over-capacity', 'Slots over capacity', v => `${v.toFixed(2)}%`],
  ['peak-occupancy', 'Peak occupancy', v => `${v}`],
  ['good-visit-rate', 'Good-visit rate', v => `${(100 * v).toFixed(1)}%`],
  ['skip-rate', 'Skip rate', v => `${(100 * v).toFixed(1)}%`],
  ['structural-skip-rate', 'of which: no possible start', v => `${(100 * v).toFixed(1)}%`],
  ['start-change-rate', 'Start slot changes day to day', v => `${(100 * v).toFixed(1)}%`],
  ['mean-start-shift', 'Mean start shift (slots)', v => v.toFixed(2)],
  ['later-than-planned-share', 'Visits later than first choice', v => `${(100 * v).toFixed(1)}%`],
  ['fixed-start-share', 'Agents with a fixed start', v => `${(100 * v).toFixed(1)}%`],
  ['profile-rmse', 'Error vs real curve (RMSE, agents)', v => v.toFixed(2)],
];
let rules, seedHistory, simulation, timer = null, busy = false, selectedAgent = 0, tickDuration = 850;

// ---------- Controls (built from web/controls.js) ----------
const decimals = step => (String(step).split('.')[1] || '').length;
function formatValue(c, value) {
  if (c.type === 'checkbox') return value ? 'On' : 'Off';
  if (c.type === 'select') return (c.choices.find(([v]) => v === value) || [, value])[1];
  return Number(value).toFixed(decimals(c.step));
}
function buildControls() {
  for (const c of CONTROLS) {
    const id = `opt-${c.option}`, wrap = document.createElement('div');
    wrap.className = `control-group ${c.type}`;
    wrap.title = c.help + (c.netlogo ? ` (NetLogo: ${c.netlogo})` : ' (BehaviorSpace time limit)');
    const bounds = `min="${c.min}" max="${c.max}" step="${c.step}"`;
    if (c.type === 'checkbox') wrap.innerHTML = `<label class="check"><input id="${id}" type="checkbox"><span>${c.label}</span></label>`;
    else if (c.type === 'select') wrap.innerHTML = `<label for="${id}">${c.label}</label><select id="${id}">${c.choices.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`;
    else if (c.type === 'range') wrap.innerHTML = `<label for="${id}">${c.label} <output id="${id}-value"></output></label><div class="range-pair"><input id="${id}" type="range" ${bounds}><input id="${id}-box" type="number" ${bounds} aria-label="${c.label} value"></div>`;
    else wrap.innerHTML = `<label for="${id}">${c.label}</label><input id="${id}" type="number" ${bounds}>`;
    $(`controls-${c.group}`).append(wrap);
    const input = $(id), box = $(`${id}-box`);
    if (box) {
      input.addEventListener('input', () => { box.value = input.value; showValue(c); });
      box.addEventListener('input', () => { input.value = box.value; showValue(c); });
      box.addEventListener('change', settingsChanged);
    }
    input.addEventListener('change', settingsChanged);
  }
}
function showValue(c) { const out = $(`opt-${c.option}-value`); if (out) out.textContent = formatValue(c, readControl(c)); }
function readControl(c) {
  const input = $(`opt-${c.option}`);
  if (c.type === 'checkbox') return input.checked;
  if (c.type === 'select') return input.value;
  return Number($(`opt-${c.option}-box`)?.value ?? input.value);
}
function setControl(c, value) {
  const input = $(`opt-${c.option}`), box = $(`opt-${c.option}-box`);
  if (c.type === 'checkbox') input.checked = Boolean(value);
  else { input.value = value; if (box) box.value = value; }
  showValue(c);
}
function setControls(options) { for (const c of CONTROLS) if (c.option in options) setControl(c, options[c.option]); }
function config() { return { ...Object.fromEntries(CONTROLS.map(c => [c.option, readControl(c)])), duration: 2 }; }
function syncCapacityControl() {
  const fromRatio = $('opt-capacityFromRatio').checked;
  for (const id of ['opt-capacity', 'opt-capacity-box']) $(id).disabled = fromRatio;
  $('opt-capacityRatio').disabled = !fromRatio;
  if (fromRatio && simulation) setControl(CONTROLS.find(c => c.option === 'capacity'), simulation.options.capacity);
}
function settingsChanged() {
  syncCapacityControl();
  reset();
  if (!$('compare-panel').hidden) $('compare-note').textContent = 'Settings changed since this comparison. Run it again to update.';
}

// ---------- Run control ----------
function setStatus(text, running = false) {
  $('status').textContent = text;
  $('status-dot').parentElement.classList.toggle('running', running);
}
function setBusy(state) {
  busy = state;
  for (const id of ['reset', 'step', 'play', 'run-to-end', 'compare', 'defaults']) $(id).disabled = state || (simulation?.done && ['step', 'play', 'run-to-end'].includes(id));
}
function pause() {
  clearInterval(timer); timer = null;
  $('play').textContent = 'Start simulation';
  if (simulation && !busy) setStatus(simulation.done ? 'Complete. Reset to run again' : 'Paused');
}
function reset() {
  pause();
  try { simulation = new G.Simulation(rules, seedHistory, config()); }
  catch (error) { simulation = null; setStatus(error.message); for (const id of ['play', 'step', 'run-to-end', 'compare']) $(id).disabled = true; return; }
  syncCapacityControl();
  selectedAgent = Math.min(selectedAgent, simulation.agents.length - 1);
  setBusy(false);
  $('event-feed').innerHTML = '<div class="empty-state">Start or step through the simulation to see arrivals and departures.</div>';
  $('feed-count').textContent = '0 events';
  renderProfiles(); render(); renderResults(); setStatus('Ready');
}
function finishIfDone() {
  if (!simulation.done) return;
  pause(); setBusy(false); renderResults();
}
function step() {
  if (!simulation || simulation.done) return;
  const event = simulation.step();
  addEvent(event); render();
  if (event.slot === G.SLOTS - 1) renderResults();
  finishIfDone();
}
function start() {
  if (!simulation || simulation.done) return;
  timer = setInterval(step, tickDuration);
  $('play').textContent = 'Pause simulation'; setStatus('Running', true);
}
// Run in short slices so the page stays responsive even with 1,000 agents.
function runSlices(sims, onProgress, onDone) {
  const slice = () => {
    const until = performance.now() + 40;
    while (performance.now() < until && sims.some(s => !s.done)) for (const s of sims) if (!s.done) s.step();
    onProgress();
    if (sims.some(s => !s.done)) setTimeout(slice, 0); else onDone();
  };
  setTimeout(slice, 0);
}
function runToEnd() {
  if (!simulation || simulation.done) return;
  pause(); setBusy(true);
  runSlices([simulation], () => setStatus(`Running to end: day ${simulation.day} of ${simulation.options.maxDays}`, true), () => {
    setBusy(false); render(); renderResults();
    addEvent(simulation.last);
    setStatus('Complete. Reset to run again');
  });
}
function compareModes() {
  let sims;
  try { sims = ['none', 'live', 'delayed'].map(mode => new G.Simulation(rules, seedHistory, { ...config(), mode })); }
  catch (error) { setStatus(error.message); return; }
  pause(); setBusy(true);
  $('compare-panel').hidden = false;
  runSlices(sims, () => setStatus(`Comparing info modes: day ${sims[0].day} of ${sims[0].options.maxDays}`, true), () => {
    setBusy(false); renderComparison(sims);
    setStatus(simulation.done ? 'Comparison ready' : 'Comparison ready. Current run paused');
    $('compare-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

// ---------- Live view ----------
function addEvent(event) {
  const feed = $('event-feed');
  if (feed.querySelector('.empty-state')) feed.innerHTML = '';
  const item = document.createElement('div');
  item.className = `event ${event.attendance > simulation.options.capacity ? 'going' : ''}`;
  item.innerHTML = `<time>Day ${event.day} ${SLOT_LABELS[event.slot]}</time><strong>${event.arrivals} arrived / ${event.departures} left</strong><p>${event.attendance} in the gym / ${event.waiting} still deciding</p>`;
  feed.prepend(item); while (feed.children.length > 12) feed.lastElementChild.remove();
  $('feed-count').textContent = `${simulation.ticks} slots`;
}
const stateOf = a => (a.attending ? 'going' : a.skippedToday ? 'skipped' : a.wentToday ? 'done' : 'waiting');
function statusOf(a) { return { going: 'In the gym', skipped: 'Skipped today', done: 'Workout finished', waiting: 'Waiting' }[stateOf(a)]; }
function windowsOf(a) { return rules.availability[a.availability].windows.map(([start, end]) => `${G.time(start)}-${G.time(end)}`).join(' and '); }
function describeAgent(a) { return `Agent ${a.id + 1}: ${rules.preference[a.preference].label}, ${rules.crowding[a.crowding].label}, ${statusOf(a)}`; }
function render() {
  const event = simulation.last, o = simulation.options;
  $('metric-slot').textContent = event ? SLOT_LABELS[event.slot] : SLOT_LABELS[0];
  $('metric-day').textContent = `Day ${event?.day || 1} of ${o.maxDays}`;
  $('metric-attendance').textContent = `${event?.attendance || 0} / ${o.capacity}`;
  $('metric-capacity').textContent = (event?.attendance || 0) > o.capacity ? 'Over capacity' : 'Within capacity';
  $('metric-decisions').textContent = event?.arrivals || 0;
  $('metric-breakdown').textContent = `${event?.departures || 0} left / ${event?.waiting ?? simulation.agents.length} waiting`;
  $('metric-peak').textContent = simulation.peak;
  $('metric-over').textContent = simulation.peak > o.capacity ? 'Capacity exceeded' : 'No crowding yet';
  renderAgents(); renderAgent(); drawHistory();
}
function renderAgents() {
  const useCanvas = simulation.agents.length > GRID_BUTTON_LIMIT;
  $('agent-grid').hidden = useCanvas; $('agent-canvas').hidden = !useCanvas;
  if (!useCanvas) {
    $('agent-grid').innerHTML = simulation.agents.map(a => `<button type="button" class="agent ${stateOf(a) === 'waiting' ? '' : stateOf(a)} ${a.id === selectedAgent ? 'selected' : ''}" data-agent="${a.id}" aria-label="${describeAgent(a)}" aria-pressed="${a.id === selectedAgent}" title="${describeAgent(a)}"></button>`).join('');
    return;
  }
  const canvas = $('agent-canvas'), ratio = window.devicePixelRatio || 1, width = canvas.parentElement.clientWidth - 36;
  const cols = 40, cell = Math.max(4, Math.floor(width / cols)), rows = Math.ceil(simulation.agents.length / cols);
  canvas.style.width = `${cols * cell}px`; canvas.style.height = `${rows * cell}px`;
  canvas.width = cols * cell * ratio; canvas.height = rows * cell * ratio;
  canvas.dataset.cell = cell; canvas.dataset.cols = cols;
  const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio);
  for (const a of simulation.agents) {
    const x = (a.id % cols) * cell, y = Math.floor(a.id / cols) * cell;
    ctx.fillStyle = STATE_COLORS[stateOf(a)];
    ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
    if (a.id === selectedAgent) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2); }
  }
}
function renderAgent() {
  const a = simulation.agents[selectedAgent];
  $('agent-inspect').max = simulation.agents.length; $('agent-inspect').value = a.id + 1;
  $('agent-detail').innerHTML = `<h3>Agent ${a.id + 1}</h3><dl>
    <dt>Availability</dt><dd>Group ${a.availability + 1}: ${windowsOf(a)}</dd>
    <dt>Preferred period</dt><dd>${rules.preference[a.preference].label}</dd>
    <dt>Flexibility</dt><dd>${rules.flexibility[a.flexibility].label}</dd>
    <dt>Crowding</dt><dd>${rules.crowding[a.crowding].label}</dd>
    <dt>Allowed workout starts</dt><dd>${a.allowedStarts.length ? a.allowedStarts.map(s => SLOT_LABELS[s]).join(', ') : 'None. This profile will skip'}</dd>
    <dt>Current status</dt><dd>${statusOf(a)}${a.attending ? `; leaves at ${G.time(G.OPEN + a.departure * G.SLOT)}` : ''}</dd></dl>`;
}
function renderProfiles() {
  const dimensions = [['availability', 'Availability'], ['preference', 'Time preference'], ['flexibility', 'Flexibility'], ['crowding', 'Crowding preference']];
  $('population-summary').innerHTML = dimensions.map(([kind, title]) => `<div><h3>${title}</h3><ul>${rules[kind].map((rule, i) => `<li>${kind === 'availability' ? `Group ${i + 1}: ${rule.windows.map(w => w.map(G.time).join('-')).join(' / ')}` : rule.label}<strong>${simulation.agents.filter(a => a[kind] === i).length}</strong></li>`).join('')}</ul></div>`).join('');
}
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function prepareCanvas(canvas) {
  const rect = canvas.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
  canvas.width = rect.width * ratio; canvas.height = rect.height * ratio;
  const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio);
  return { ctx, width: rect.width, height: rect.height };
}
function drawHistory() {
  const { ctx, width, height } = prepareCanvas($('occupancy-chart')), pad = { top: 16, right: 12, bottom: 28, left: 34 };
  const capacity = simulation.options.capacity, history = simulation.history;
  const max = Math.max(capacity * 1.25, simulation.peak, 1);
  const y = value => height - pad.bottom - (value / max) * (height - pad.top - pad.bottom);
  ctx.strokeStyle = COLORS.grid; ctx.lineWidth = 1; ctx.fillStyle = COLORS.muted; ctx.font = '11px system-ui';
  [0, Math.max(capacity, simulation.peak)].forEach(value => { ctx.beginPath(); ctx.moveTo(pad.left, y(value)); ctx.lineTo(width - pad.right, y(value)); ctx.stroke(); ctx.fillText(Math.round(value), 4, y(value) + 4); });
  ctx.strokeStyle = COLORS.reference; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(pad.left, y(capacity)); ctx.lineTo(width - pad.right, y(capacity)); ctx.stroke(); ctx.setLineDash([]);
  ctx.textAlign = 'right'; ctx.fillText(`capacity ${capacity}`, width - pad.right, y(capacity) - 4); ctx.textAlign = 'left';
  if (!history.length) return;
  const plotWidth = width - pad.left - pad.right, x = index => pad.left + (index / Math.max(history.length - 1, 1)) * plotWidth;
  const bucketSize = Math.max(1, Math.ceil(history.length / Math.max(1, Math.floor(plotWidth))));
  const buckets = [];
  for (let start = 0; start < history.length; start += bucketSize) {
    const values = history.slice(start, start + bucketSize);
    buckets.push({ center: start + (values.length - 1) / 2, min: Math.min(...values), max: Math.max(...values), average: values.reduce((s, v) => s + v, 0) / values.length });
  }
  ctx.strokeStyle = '#3987e566'; ctx.lineWidth = 1;
  buckets.forEach(b => { ctx.beginPath(); ctx.moveTo(x(b.center), y(b.min)); ctx.lineTo(x(b.center), y(b.max)); ctx.stroke(); });
  ctx.strokeStyle = COLORS.none; ctx.lineWidth = 2; ctx.beginPath();
  buckets.forEach((b, i) => (i ? ctx.lineTo(x(b.center), y(b.average)) : ctx.moveTo(x(b.center), y(b.average))));
  ctx.stroke();
  ctx.fillStyle = COLORS.muted;
  [0, Math.floor((history.length - 1) / 2), history.length - 1].forEach(index => ctx.fillText(`D${Math.floor(index / G.SLOTS) + 1} ${SLOT_LABELS[index % G.SLOTS]}`, Math.max(pad.left, x(index) - 23), height - 7));
}

// ---------- Results: tiles, profile chart with hover, comparison ----------
function measuredRange(s) {
  const first = s.options.burnIn + 1, last = s.options.burnIn + s.metrics.days;
  return s.metrics.days ? `days ${first}-${last} (${s.metrics.days} measured)` : `results start on day ${first}`;
}
function renderResults() {
  const r = simulation.summary(), measured = simulation.metrics.days > 0;
  $('results-note').textContent = `${simulation.options.agentCount} agents, capacity ${simulation.options.capacity}, ${MODE_LABELS[simulation.options.mode]} info, memory ${simulation.options.memory}: ${measuredRange(simulation)}`;
  $('result-tiles').innerHTML = RESULT_ROWS.map(([key, label, fmt]) => `<div class="tile ${key === 'structural-skip-rate' ? 'sub' : ''}"><span>${label}</span><strong>${measured ? fmt(r[key]) : '-'}</strong></div>`).join('');
  const series = [
    { name: 'Model (average)', color: COLORS.none, values: r['occupancy-profile'] },
    { name: 'Real (scaled)', color: COLORS.reference, values: simulation.realProfile, dash: [6, 4] },
  ];
  profileChart('profile', measured ? series : series.slice(1), simulation.options.capacity);
  $('profile-table').innerHTML = `<table><thead><tr><th>Start</th><th>Model</th><th>Real (scaled)</th></tr></thead><tbody>${SLOT_LABELS.map((label, i) => `<tr><td>${label}</td><td>${measured ? r['occupancy-profile'][i].toFixed(1) : '-'}</td><td>${simulation.realProfile[i].toFixed(1)}</td></tr>`).join('')}</tbody></table>`;
}
function renderComparison(sims) {
  const results = sims.map(s => s.summary()), o = sims[0].options;
  $('compare-note').textContent = `Same seeds and settings: ${o.agentCount} agents, capacity ${o.capacity}, memory ${o.memory}, ${measuredRange(sims[0])}`;
  $('compare-table').innerHTML = `<table><thead><tr><th>Measure</th>${sims.map(s => `<th><i class="swatch" style="background:${COLORS[s.options.mode]}"></i>${MODE_LABELS[s.options.mode]}</th>`).join('')}</tr></thead><tbody>${RESULT_ROWS.map(([key, label, fmt]) => `<tr><td>${label}</td>${results.map(r => `<td>${fmt(r[key])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const series = sims.map((s, i) => ({ name: MODE_LABELS[s.options.mode], color: COLORS[s.options.mode], values: results[i]['occupancy-profile'] }));
  series.push({ name: 'Real (scaled)', color: COLORS.reference, values: sims[0].realProfile, dash: [6, 4] });
  profileChart('compare', series, o.capacity);
}
const charts = {};
// Line chart of occupancy by start slot: one y-axis, recessive grid, legend + end labels,
// capacity as a labelled reference line, crosshair tooltip on hover.
function profileChart(name, series, capacity) {
  charts[name] = { series, capacity, hover: null };
  $(`${name}-legend`).innerHTML = [...series.map(s => `<span><i class="legend-line" style="border-color:${s.color};border-style:${s.dash ? 'dashed' : 'solid'}"></i>${s.name}</span>`), `<span><i class="legend-line" style="border-color:${COLORS.reference};border-style:dotted"></i>Capacity</span>`].join('');
  drawProfile(name);
}
function drawProfile(name) {
  const chart = charts[name]; if (!chart) return;
  const canvas = $(`${name}-chart`), { ctx, width, height } = prepareCanvas(canvas);
  const pad = { top: 14, right: 96, bottom: 26, left: 34 }, n = G.SLOTS;
  const max = Math.max(chart.capacity * 1.15, ...chart.series.flatMap(s => s.values)) || 1;
  const x = i => pad.left + (i / (n - 1)) * (width - pad.left - pad.right);
  const y = v => height - pad.bottom - (v / max) * (height - pad.top - pad.bottom);
  chart.geometry = { x, pad, width, n };
  ctx.font = '11px system-ui'; ctx.lineWidth = 1;
  for (const tick of [0, Math.round(max / 2)]) { ctx.strokeStyle = COLORS.grid; ctx.beginPath(); ctx.moveTo(pad.left, y(tick)); ctx.lineTo(width - pad.right, y(tick)); ctx.stroke(); ctx.fillStyle = COLORS.muted; ctx.fillText(tick, 4, y(tick) + 4); }
  for (let i = 0; i < n; i += 4) ctx.fillText(SLOT_LABELS[i], x(i) - 14, height - 8);
  ctx.strokeStyle = COLORS.reference; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(pad.left, y(chart.capacity)); ctx.lineTo(width - pad.right, y(chart.capacity)); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = COLORS.muted; ctx.fillText(`Capacity ${chart.capacity}`, width - pad.right + 6, y(chart.capacity) + 4);
  const ends = [];
  for (const s of chart.series) {
    ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.setLineDash(s.dash || []); ctx.beginPath();
    s.values.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.stroke(); ctx.setLineDash([]);
    ends.push({ name: s.name, y: y(s.values[n - 1]) });
  }
  // Direct end labels in text ink, nudged apart so they do not collide.
  ends.sort((a, b) => a.y - b.y).forEach((label, i, all) => { if (i && label.y - all[i - 1].y < 13) label.y = all[i - 1].y + 13; });
  ctx.fillStyle = COLORS.text; ends.forEach(label => ctx.fillText(label.name, width - pad.right + 6, label.y + 4));
  if (chart.hover !== null) {
    ctx.strokeStyle = COLORS.muted; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x(chart.hover), pad.top); ctx.lineTo(x(chart.hover), height - pad.bottom); ctx.stroke();
    for (const s of chart.series) { ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(x(chart.hover), y(s.values[chart.hover]), 4, 0, 2 * Math.PI); ctx.fill(); ctx.strokeStyle = '#171c25'; ctx.lineWidth = 2; ctx.stroke(); }
  }
}
function attachHover(name) {
  const canvas = $(`${name}-chart`), tip = $(`${name}-tooltip`);
  canvas.addEventListener('mousemove', event => {
    const chart = charts[name]; if (!chart?.geometry) return;
    const { pad, width, n } = chart.geometry, rect = canvas.getBoundingClientRect(), px = event.clientX - rect.left;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - pad.left) / (width - pad.left - pad.right)) * (n - 1))));
    chart.hover = i; drawProfile(name);
    tip.hidden = false;
    tip.innerHTML = `<strong>${SLOT_LABELS[i]}</strong>${chart.series.map(s => `<div><i class="swatch" style="background:${s.color}"></i>${s.name}<b>${s.values[i].toFixed(1)}</b></div>`).join('')}<div class="muted">Capacity<b>${chart.capacity}</b></div>`;
    tip.style.left = `${Math.min(px + 14, rect.width - tip.offsetWidth - 4)}px`; tip.style.top = '8px';
  });
  canvas.addEventListener('mouseleave', () => { const chart = charts[name]; if (chart) { chart.hover = null; drawProfile(name); } tip.hidden = true; });
}

// ---------- Wiring ----------
$('play').addEventListener('click', () => (timer ? pause() : start()));
$('step').addEventListener('click', () => { if (!timer) step(); });
$('reset').addEventListener('click', reset);
$('run-to-end').addEventListener('click', runToEnd);
$('compare').addEventListener('click', compareModes);
$('defaults').addEventListener('click', () => { setControls(G.DEFAULT_OPTIONS); settingsChanged(); });
$('agent-grid').addEventListener('click', event => {
  const button = event.target.closest('[data-agent]');
  if (button) { selectedAgent = Number(button.dataset.agent); renderAgents(); renderAgent(); }
});
$('agent-canvas').addEventListener('click', event => {
  const canvas = $('agent-canvas'), rect = canvas.getBoundingClientRect(), cell = Number(canvas.dataset.cell), cols = Number(canvas.dataset.cols);
  const id = Math.floor((event.clientY - rect.top) / cell) * cols + Math.floor((event.clientX - rect.left) / cell);
  if (id >= 0 && id < simulation.agents.length) { selectedAgent = id; renderAgents(); renderAgent(); }
});
$('tick-duration').addEventListener('input', () => {
  tickDuration = Number($('tick-duration').value);
  $('tick-duration-value').textContent = `${tickDuration} ms per slot`;
  if (timer) { clearInterval(timer); timer = setInterval(step, tickDuration); }
});
$('export-profiles').addEventListener('click', () => {
  if (simulation) download(`gym-population-${simulation.options.populationSeed}.json`, JSON.stringify(simulation.profileExport(), null, 2), 'application/json');
});
window.addEventListener('resize', () => { if (simulation) { renderAgents(); drawHistory(); drawProfile('profile'); drawProfile('compare'); } });
(async () => {
  buildControls(); setControls(G.DEFAULT_OPTIONS); attachHover('profile'); attachHover('compare');
  const inspect = document.createElement('label');
  inspect.className = 'inspect'; inspect.innerHTML = 'Inspect agent # <input id="agent-inspect" type="number" min="1" step="1">';
  $('agent-detail').before(inspect);
  $('agent-inspect').addEventListener('change', () => { const id = Number($('agent-inspect').value) - 1; if (simulation && id >= 0 && id < simulation.agents.length) { selectedAgent = id; renderAgents(); renderAgent(); } });
  setBusy(true);
  setStatus('Loading population rules');
  try {
    const fetchText = async path => { const response = await fetch(path); if (!response.ok) throw Error(`Cannot load ${path}`); return response.text(); };
    const [ruleText, historyText, mixText] = await Promise.all([fetchText('profile-rules.csv'), fetchText('seed-history.csv'), fetchText('profile-mix.csv')]);
    rules = G.parseRules(ruleText); rules.mix = G.parseProfileMix(mixText); seedHistory = G.parseSeedHistory(historyText);
    reset();
  } catch (error) { setStatus(`${error.message}. Run python web/server.py and open http://127.0.0.1:8000.`); }
})();
