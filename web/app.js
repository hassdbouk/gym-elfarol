const G = window.GymSimulation;
const SLOT_LABELS = G.labels;
const $ = id => document.getElementById(id);
let rules, seedHistory, simulation, timer = null, selectedAgent = 0;
let tickDuration = 850;
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
  $('play').disabled = false; $('step').disabled = false;
  $('event-feed').innerHTML = '<div class="empty-state">Start or step through the simulation to see arrivals and departures.</div>';
  $('feed-count').textContent = '0 events';
  renderProfiles(); render(); setStatus('Ready');
}
function step() {
  if (!simulation || simulation.done) return;
  const event = simulation.step();
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
function render() {
  const event = simulation.last;
  $('agent-grid').innerHTML = simulation.agents.map(a => `<button type="button" class="agent ${a.attending ? 'going' : a.skippedToday ? 'skipped' : a.wentToday ? 'done' : ''} ${a.id === selectedAgent ? 'selected' : ''}" data-agent="${a.id}" aria-label="${describeAgent(a)}" aria-pressed="${a.id === selectedAgent}" title="${describeAgent(a)}"></button>`).join('');
  $('metric-slot').textContent = event ? SLOT_LABELS[event.slot] : SLOT_LABELS[0];
  $('metric-day').textContent = `Day ${event?.day || 1} of ${simulation.options.maxDays}`;
  $('metric-attendance').textContent = `${event?.attendance || 0} / ${simulation.options.capacity}`;
  $('metric-capacity').textContent = (event?.attendance || 0) > simulation.options.capacity ? 'Over capacity' : 'Within capacity';
  $('metric-decisions').textContent = event?.arrivals || 0;
  $('metric-breakdown').textContent = `${event?.departures || 0} left / ${event?.waiting ?? simulation.agents.length} waiting`;
  $('metric-peak').textContent = simulation.peak;
  $('metric-over').textContent = simulation.peak > simulation.options.capacity ? 'Capacity exceeded' : 'No crowding yet';
  renderAgent(); drawChart();
}
function renderAgent() {
  const a = simulation.agents[selectedAgent];
  $('agent-detail').innerHTML = `<h3>Agent ${a.id + 1}</h3><dl>
    <dt>Availability</dt><dd>Group ${a.availability + 1}: ${windowsOf(a)}</dd>
    <dt>Preferred period</dt><dd>${rules.preference[a.preference].label}</dd>
    <dt>Flexibility</dt><dd>${rules.flexibility[a.flexibility].label}</dd>
    <dt>Crowding</dt><dd>${rules.crowding[a.crowding].label}</dd>
    <dt>Allowed workout starts</dt><dd>${a.allowedStarts.length ? a.allowedStarts.map(s => SLOT_LABELS[s]).join(', ') : 'None - this profile will skip'}</dd>
    <dt>Current status</dt><dd>${statusOf(a)}${a.attending ? `; leaves at ${G.time(G.OPEN + a.departure * G.SLOT)}` : ''}</dd></dl>`;
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
