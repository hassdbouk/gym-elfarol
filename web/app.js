const G = window.GymSimulation;
const SLOT_LABELS = G.labels;
const $ = id => document.getElementById(id);
let rules, seedHistory, simulation, timer = null, selectedAgent = 0;
let tickDuration = 850;
const RECENT_DAYS = 3;
let eventLog = [], agentLog = [], hoverIndex = null, scrubIndex = null, chartGeom = null, hoveredAgent = null;
function config() {
  return {
    mode: $('info-mode').value, agentCount: Number($('agent-count').value), capacity: Number($('capacity').value),
    memory: Number($('memory-size').value), maxDays: Number($('max-days').value),
    populationSeed: Number($('population-seed').value), simulationSeed: Number($('simulation-seed').value), duration: 2,
  };
}
function setStatus(text, running = false) {
  $('status').textContent = text;
  $('status-dot').parentElement.classList.toggle('running', running);
}
function pause() {
  clearInterval(timer); timer = null;
  $('play').textContent = 'Start simulation';
  if (simulation) setStatus(simulation.done ? 'Complete - reset to run again' : 'Paused');
}
function reset() {
  pause();
  try { simulation = new G.Simulation(rules, seedHistory, config()); }
  catch (error) { setStatus(error.message); $('play').disabled = true; $('step').disabled = true; return; }
  selectedAgent = Math.min(selectedAgent, simulation.agents.length - 1);
  eventLog = []; agentLog = simulation.agents.map(() => []); hoverIndex = null; scrubIndex = null; hoveredAgent = null;
  $('chart-tooltip').hidden = true; $('agent-tooltip').hidden = true;
  $('play').disabled = false; $('step').disabled = false;
  $('event-feed').innerHTML = '<div class="empty-state">Start or step through the simulation to see arrivals and departures.</div>';
  $('feed-count').textContent = '0 events';
  renderProfiles(); render(); setStatus('Ready');
}
function step() {
  if (!simulation || simulation.done) return;
  const event = simulation.step();
  eventLog.push(event);
  if (event.slot === G.SLOTS - 1) recordDay(event.day);
  addEvent(event); render();
  if (simulation.done) { pause(); $('play').disabled = true; $('step').disabled = true; }
}
function start() {
  if (!simulation || simulation.done) return;
  timer = setInterval(step, tickDuration);
  $('play').textContent = 'Pause simulation'; setStatus('Running', true);
}
function addEvent(event) {
  const feed = $('event-feed');
  if (feed.querySelector('.empty-state')) feed.innerHTML = '';
  const item = document.createElement('div');
  item.className = `event ${event.attendance > simulation.options.capacity ? 'going' : ''}`;
  item.innerHTML = `<time>Day ${event.day} ${SLOT_LABELS[event.slot]}</time><strong>${event.arrivals} arrived / ${event.departures} left</strong><p>${event.attendance} in the gym / ${event.waiting} still deciding</p>`;
  feed.prepend(item); while (feed.children.length > 12) feed.lastElementChild.remove();
  $('feed-count').textContent = `${simulation.ticks} slots`;
}
function statusOf(a) {
  return a.attending ? 'In the gym' : a.skippedToday ? 'Skipped today' : a.wentToday ? 'Workout finished' : 'Waiting';
}
function windowsOf(a) { return rules.availability[a.availability].windows.map(([start, end]) => `${G.time(start)}-${G.time(end)}`).join(' and '); }
function describeAgent(a) { return `Agent ${a.id + 1}: ${rules.preference[a.preference].label}, ${rules.crowding[a.crowding].label}, ${statusOf(a)}`; }
// Snapshot each agent's outcome when a day closes; keep the most recent RECENT_DAYS.
function recordDay(day) {
  const today = simulation.todayAttendance, cap = simulation.options.capacity, dur = simulation.options.duration;
  for (const a of simulation.agents) {
    const peak = a.wentToday ? Math.max(...today.slice(a.startSlot, a.startSlot + dur)) : null;
    agentLog[a.id].unshift({ day, went: a.wentToday, start: a.startSlot, end: a.departure, peak, good: a.wentToday && peak <= cap });
    agentLog[a.id].length = Math.min(agentLog[a.id].length, RECENT_DAYS);
  }
}
const slotTime = slot => G.time(G.OPEN + slot * G.SLOT);
function dayResult(entry, cap) {
  if (!entry.went) return { badge: '<span class="badge skipped">Skipped</span>', text: 'No acceptable slot' };
  return {
    badge: entry.good ? '<span class="badge good">Good visit</span>' : '<span class="badge crowded">Crowded</span>',
    text: `${slotTime(entry.start)}-${slotTime(entry.end)}, peak ${entry.peak}/${cap}`,
  };
}
function recentDaysHtml(a) {
  const log = agentLog[a.id] || [];
  if (!log.length) return '<span class="tip-muted">No completed days yet</span>';
  return `<ul class="agent-history">${log.map(e => { const r = dayResult(e, simulation.options.capacity); return `<li><span class="day-tag">Day ${e.day}</span>${r.badge}<span>${r.text}</span></li>`; }).join('')}</ul>`;
}
function renderAgentTooltip() {
  const tip = $('agent-tooltip');
  if (hoveredAgent === null || !simulation.agents[hoveredAgent]) { tip.hidden = true; return; }
  const a = simulation.agents[hoveredAgent];
  tip.innerHTML = `<strong>Agent ${a.id + 1}</strong> <span class="tip-muted">· ${statusOf(a)}</span><br>
    <span class="tip-muted">Prefers</span> ${rules.preference[a.preference].label} <span class="tip-muted">·</span> ${rules.flexibility[a.flexibility].label}<br>
    <span class="tip-muted">Crowding</span> ${rules.crowding[a.crowding].label}<br>
    <span class="tip-muted">Available</span> ${windowsOf(a)}
    <div style="margin-top:6px"><span class="tip-muted">Last ${RECENT_DAYS} days</span>${recentDaysHtml(a)}</div>`;
  tip.hidden = false;
}
function positionTooltip(tip, clientX, clientY) {
  const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
  let left = clientX + pad, top = clientY + pad;
  if (left + w > window.innerWidth - 8) left = clientX - w - pad;
  if (top + h > window.innerHeight - 8) top = clientY - h - pad;
  tip.style.left = `${Math.max(8, left)}px`; tip.style.top = `${Math.max(8, top)}px`;
}
function slotInfo(index) {
  const e = eventLog[index], cap = simulation.options.capacity;
  return { e, title: `Day ${e.day} · ${slotTime(e.slot)}-${slotTime(e.slot + 1)}`, occ: `${e.attendance} / ${cap}`, over: e.attendance > cap };
}
function renderScrubber() {
  const slider = $('history-slider'), n = eventLog.length;
  slider.disabled = !n; slider.max = Math.max(0, n - 1);
  slider.value = scrubIndex ?? Math.max(0, n - 1);
  $('history-live').disabled = scrubIndex === null;
  if (!n) { $('history-readout').textContent = 'No data yet'; return; }
  const { title, occ, over } = slotInfo(Number(slider.value));
  $('history-readout').innerHTML = `${title} · <strong class="${over ? 'tip-over' : ''}">${occ}</strong>${scrubIndex === null ? ' <span class="tip-muted">(latest)</span>' : ''}`;
}
function renderChartTooltip() {
  const tip = $('chart-tooltip');
  if (hoverIndex === null || !eventLog[hoverIndex] || !chartGeom) { tip.hidden = true; return; }
  const { e, title, occ, over } = slotInfo(hoverIndex);
  const a = simulation.agents[selectedAgent];
  const mine = (agentLog[a.id] || []).find(x => x.day === e.day);
  const agentLine = mine?.went && e.slot >= mine.start && e.slot < mine.end ? `<br><span class="tip-muted">Agent ${a.id + 1} was in the gym</span>` : '';
  tip.innerHTML = `<strong>${title}</strong><br>Occupancy <strong class="${over ? 'tip-over' : 'tip-ok'}">${occ}</strong>${over ? ' <span class="tip-over">over capacity</span>' : ''}<br>
    <span class="tip-muted">${e.arrivals} arrived · ${e.departures} left · ${e.waiting} deciding</span>${agentLine}`;
  tip.hidden = false;
  const wrap = $('chart-wrap'), px = chartGeom.x(hoverIndex), py = chartGeom.y(e.attendance);
  let left = px + 12;
  if (left + tip.offsetWidth > wrap.clientWidth) left = px - tip.offsetWidth - 12;
  tip.style.left = `${Math.max(0, left)}px`; tip.style.top = `${Math.max(4, py - tip.offsetHeight - 8)}px`;
}
function render() {
  const event = simulation.last;
  $('agent-grid').innerHTML = simulation.agents.map(a => `<button type="button" class="agent ${a.attending ? 'going' : a.skippedToday ? 'skipped' : a.wentToday ? 'done' : ''} ${a.id === selectedAgent ? 'selected' : ''}" data-agent="${a.id}" aria-label="${describeAgent(a)}" aria-pressed="${a.id === selectedAgent}"></button>`).join('');
  $('metric-slot').textContent = event ? SLOT_LABELS[event.slot] : SLOT_LABELS[0];
  $('metric-day').textContent = `Day ${event?.day || 1} of ${simulation.options.maxDays}`;
  $('metric-attendance').textContent = `${event?.attendance || 0} / ${simulation.options.capacity}`;
  $('metric-capacity').textContent = (event?.attendance || 0) > simulation.options.capacity ? 'Over capacity' : 'Within capacity';
  $('metric-decisions').textContent = event?.arrivals || 0;
  $('metric-breakdown').textContent = `${event?.departures || 0} left / ${event?.waiting ?? simulation.agents.length} waiting`;
  $('metric-peak').textContent = simulation.peak;
  $('metric-over').textContent = simulation.peak > simulation.options.capacity ? 'Capacity exceeded' : 'No crowding yet';
  renderAgent(); drawChart(); renderScrubber(); renderChartTooltip(); renderAgentTooltip();
}
function renderAgent() {
  const a = simulation.agents[selectedAgent];
  $('agent-detail').innerHTML = `<h3>Agent ${a.id + 1}</h3><dl>
    <dt>Availability</dt><dd>Group ${a.availability + 1}: ${windowsOf(a)}</dd>
    <dt>Preferred period</dt><dd>${rules.preference[a.preference].label}</dd>
    <dt>Flexibility</dt><dd>${rules.flexibility[a.flexibility].label}</dd>
    <dt>Crowding</dt><dd>${rules.crowding[a.crowding].label}</dd>
    <dt>Allowed workout starts</dt><dd>${a.allowedStarts.length ? a.allowedStarts.map(s => SLOT_LABELS[s]).join(', ') : 'None - this profile will skip'}</dd>
    <dt>Current status</dt><dd>${statusOf(a)}${a.attending ? `; leaves at ${G.time(G.OPEN + a.departure * G.SLOT)}` : ''}</dd>
    <dt>Last ${RECENT_DAYS} days</dt><dd>${recentDaysHtml(a)}</dd></dl>`;
}
function renderProfiles() {
  const dimensions = [['availability', 'availability', 'Availability'], ['preference', 'preference', 'Time preference'], ['flexibility', 'flexibility', 'Flexibility'], ['crowding', 'crowding', 'Crowding preference']];
  $('population-summary').innerHTML = dimensions.map(([kind, property, title]) => `<div><h3>${title}</h3><ul>${rules[kind].map((rule, i) => `<li>${kind === 'availability' ? `Group ${i + 1}: ${rule.windows.map(w => w.map(G.time).join('-')).join(' / ')}` : rule.label}<strong>${simulation.agents.filter(a => a[property] === i).length}</strong></li>`).join('')}</ul></div>`).join('');
}
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function drawChart() {
  const canvas = $("occupancy-chart"), rect = canvas.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
  canvas.width = rect.width * ratio; canvas.height = rect.height * ratio;
  const ctx = canvas.getContext("2d"); ctx.scale(ratio, ratio);
  const width = rect.width, height = rect.height, pad = { top: 16, right: 12, bottom: 28, left: 30 };
  ctx.clearRect(0, 0, width, height); ctx.strokeStyle = "#2a3442"; ctx.lineWidth = 1;
  const max = Math.max(simulation.options.capacity * 1.25, simulation.peak, 1);
  const y = value => height - pad.bottom - (value / max) * (height - pad.top - pad.bottom);
  [0, simulation.options.capacity, Math.max(simulation.options.capacity, simulation.peak)].forEach(value => {
    ctx.beginPath(); ctx.moveTo(pad.left, y(value)); ctx.lineTo(width - pad.right, y(value)); ctx.stroke();
    ctx.fillStyle = "#8d99a8"; ctx.font = "11px system-ui"; ctx.fillText(Math.round(value), 4, y(value) + 4);
  });
  const plotWidth = width - pad.left - pad.right;
  const x = index => pad.left + (index / Math.max(simulation.history.length - 1, 1)) * plotWidth;
  ctx.strokeStyle = "#ff9f43"; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(pad.left, y(simulation.options.capacity)); ctx.lineTo(width - pad.right, y(simulation.options.capacity)); ctx.stroke(); ctx.setLineDash([]);
  if (!simulation.history.length) return;
  const bucketSize = Math.max(1, Math.ceil(simulation.history.length / Math.max(1, Math.floor(plotWidth))));
  const compressed = [];
  for (let start = 0; start < simulation.history.length; start += bucketSize) {
    const values = simulation.history.slice(start, start + bucketSize);
    compressed.push({ start, end: start + values.length - 1, min: Math.min(...values), max: Math.max(...values), average: values.reduce((sum, value) => sum + value, 0) / values.length });
  }
  ctx.strokeStyle = "#70a7ff"; ctx.lineWidth = 2; ctx.beginPath();
  compressed.forEach((bucket, i) => {
    const center = (bucket.start + bucket.end) / 2;
    i ? ctx.lineTo(x(center), y(bucket.average)) : ctx.moveTo(x(center), y(bucket.average));
  });
  ctx.stroke();
  ctx.strokeStyle = "#70a7ff66"; ctx.lineWidth = 1;
  compressed.forEach(bucket => {
    const center = (bucket.start + bucket.end) / 2;
    ctx.beginPath(); ctx.moveTo(x(center), y(bucket.min)); ctx.lineTo(x(center), y(bucket.max)); ctx.stroke();
  });
  chartGeom = { x, y, plotWidth, left: pad.left };
  // Selected agent's recent workouts
  ctx.fillStyle = "#f7d774";
  for (const entry of agentLog[selectedAgent] || []) {
    if (!entry.went) continue;
    const index = (entry.day - 1) * SLOT_LABELS.length + entry.start;
    ctx.beginPath(); ctx.arc(x(index), y(simulation.history[index]), 3.5, 0, Math.PI * 2); ctx.fill();
  }
  // Hover / slider focus
  const focus = hoverIndex ?? scrubIndex;
  if (focus !== null && focus < simulation.history.length) {
    ctx.strokeStyle = "#edf2f7aa"; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x(focus), pad.top); ctx.lineTo(x(focus), height - pad.bottom); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = simulation.history[focus] > simulation.options.capacity ? "#ff6b6b" : "#edf2f7";
    ctx.beginPath(); ctx.arc(x(focus), y(simulation.history[focus]), 4.5, 0, Math.PI * 2); ctx.fill();
  }
  const labels = [0, Math.floor((simulation.history.length - 1) / 2), simulation.history.length - 1];
  ctx.fillStyle = "#8d99a8"; ctx.font = "11px system-ui";
  labels.forEach(index => {
    const day = Math.floor(index / SLOT_LABELS.length) + 1;
    ctx.fillText(`D${day} ${SLOT_LABELS[index % SLOT_LABELS.length]}`, Math.max(pad.left, x(index) - 23), height - 7);
  });
}

$('play').addEventListener('click', () => timer ? pause() : start());
$('step').addEventListener('click', () => { if (!timer) step(); });
$('reset').addEventListener('click', reset);
const canvasEl = $('occupancy-chart');
canvasEl.addEventListener('pointermove', event => {
  if (!simulation || !chartGeom || !eventLog.length) return;
  const mx = event.clientX - canvasEl.getBoundingClientRect().left, n = simulation.history.length;
  hoverIndex = Math.max(0, Math.min(n - 1, Math.round(((mx - chartGeom.left) / chartGeom.plotWidth) * Math.max(n - 1, 1))));
  drawChart(); renderChartTooltip();
});
canvasEl.addEventListener('pointerleave', () => { hoverIndex = null; if (simulation) { drawChart(); renderChartTooltip(); } });
canvasEl.addEventListener('click', () => { if (hoverIndex !== null) { scrubIndex = hoverIndex; renderScrubber(); } });
$('history-slider').addEventListener('input', () => { scrubIndex = Number($('history-slider').value); renderScrubber(); drawChart(); });
$('history-live').addEventListener('click', () => { scrubIndex = null; renderScrubber(); drawChart(); });
const gridEl = $('agent-grid');
gridEl.addEventListener('pointermove', event => {
  const button = event.target.closest('[data-agent]');
  if (!button) { hoveredAgent = null; $('agent-tooltip').hidden = true; return; }
  const id = Number(button.dataset.agent);
  if (id !== hoveredAgent) { hoveredAgent = id; renderAgentTooltip(); }
  positionTooltip($('agent-tooltip'), event.clientX, event.clientY);
});
gridEl.addEventListener('pointerleave', () => { hoveredAgent = null; $('agent-tooltip').hidden = true; });
$('agent-grid').addEventListener('click', event => {
  const button = event.target.closest('[data-agent]');
  if (button) { selectedAgent = Number(button.dataset.agent); render(); }
});
for (const id of ['info-mode', 'agent-count', 'capacity', 'memory-size', 'max-days', 'population-seed', 'simulation-seed']) {
  $(id).addEventListener('change', reset);
}
for (const [id, suffix] of [['agent-count', ''], ['capacity', ''], ['memory-size', ' days']]) {
  $(id).addEventListener('input', () => { $(`${id}-value`).textContent = $(id).value + suffix; });
}
$('tick-duration').addEventListener('input', () => {
  tickDuration = Number($('tick-duration').value);
  $('tick-duration-value').textContent = `${tickDuration} ms`;
  if (timer) { clearInterval(timer); timer = setInterval(step, tickDuration); }
});
$('export-profiles').addEventListener('click', () => {
  if (simulation) download(`gym-population-${simulation.options.populationSeed}.json`, JSON.stringify(simulation.profileExport(), null, 2), 'application/json');
});
window.addEventListener('resize', () => { if (simulation) drawChart(); });
(async () => {
  $('play').disabled = true; $('step').disabled = true; $('reset').disabled = true;
  setStatus('Loading population rules');
  try {
    const fetchText = async path => { const response = await fetch(path); if (!response.ok) throw Error(`Cannot load ${path}`); return response.text(); };
    const [ruleText, historyText] = await Promise.all([fetchText('profile-rules.csv'), fetchText('seed-history.csv')]);
    rules = G.parseRules(ruleText); seedHistory = G.parseSeedHistory(historyText);
    $('reset').disabled = false; reset();
  } catch (error) { setStatus(`${error.message}. Run python web/server.py and open http://127.0.0.1:8000.`); }
})();
