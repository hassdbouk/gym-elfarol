const SLOT_LABELS = Array.from({ length: 31 }, (_, i) => {
  const minutes = 390 + i * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});
const $ = (id) => document.getElementById(id);
const state = {
  agents: [], day: 1, slot: 0, history: [], slotHistories: [], todayAttendance: [], peak: 0, running: false, timer: null,
  mode: "live", capacity: 37, memory: 5, agentCount: 100, delayedBy: 2, maxDays: 40, tickDuration: 850,
};

function randomBetween(min, max) { return min + Math.random() * (max - min); }
function createAgents() {
  state.agents = Array.from({ length: state.agentCount }, (_, id) => ({
    id: id + 1, decided: false, goingThisSlot: false, wentToday: false, skippedToday: false,
    strategies: Array.from({ length: 10 }, () => Array.from({ length: state.memory + 1 }, () => randomBetween(-1, 1))),
  }));
}
function reset() {
  stop();
  state.day = 1; state.slot = 0; state.history = []; state.slotHistories = baseHistory(); state.todayAttendance = []; state.peak = 0;
  createAgents(); render(); setStatus("Ready");
  $("event-feed").innerHTML = '<div class="empty-state">Start the simulation to see agent decisions appear here.</div>';
}
function predicted(strategy, history) {
  return 100 * strategy[0] + strategy.slice(1).reduce((sum, weight, i) => sum + weight * (history[i] ?? history[history.length - 1] ?? 0), 0);
}
function baseHistory() {
  const seed = [10.48, 10.48, 15.38, 13.25, 13.59, 15.12, 14.18, 16.28, 19.18, 19.27, 21.80, 22.15, 23.90, 23.56, 27.51, 26.71, 26.06, 26.88, 29.15, 27.97, 30.58, 30.05, 31.32, 28.80, 28.78, 26.72, 25.80, 24.59, 26.87, 22.70, 26.23];
  return seed.map(value => Array.from({ length: state.memory * 2 }, () => value));
}
function step() {
  state.agents.forEach(agent => { agent.goingThisSlot = false; agent.skippedThisSlot = false; });
  if (state.slot === 0) {
    state.todayAttendance = [];
    state.agents.forEach(agent => { agent.decided = false; agent.wentToday = false; agent.skippedToday = false; });
  }
  const history = state.slotHistories[state.slot];
  const priorSlots = state.todayAttendance;
  let attendance = 0;
  state.agents.forEach(agent => {
    if (agent.decided) return;
    const scores = agent.strategies.map(strategy => strategy.slice(1).reduce((score, weight, i) => score + Math.abs((history[i] ?? 0) - predicted(strategy, history.slice(i + 1))), 0));
    const strategy = agent.strategies[scores.indexOf(Math.min(...scores))];
    let prediction = predicted(strategy, history.slice(0, state.memory));
    if (state.mode === "live" && priorSlots.length) prediction = (prediction + priorSlots[priorSlots.length - 1]) / 2;
    if (state.mode === "delayed" && priorSlots.length >= state.delayedBy) prediction = (prediction + priorSlots[priorSlots.length - state.delayedBy]) / 2;
    if (prediction <= state.capacity || state.slot === SLOT_LABELS.length - 1) {
      agent.decided = true; agent.goingThisSlot = prediction <= state.capacity;
      agent.wentToday = agent.goingThisSlot;
      agent.skippedThisSlot = !agent.goingThisSlot; agent.skippedToday = agent.skippedThisSlot;
      if (agent.goingThisSlot) attendance++;
    }
  });
  state.slotHistories[state.slot] = [attendance, ...history].slice(0, state.memory * 2);
  state.todayAttendance.push(attendance);
  state.history.push(attendance); state.peak = Math.max(state.peak, attendance);
  addEvents(attendance); render();
  state.slot++;
  if (state.slot >= SLOT_LABELS.length) {
    state.slot = 0; state.todayAttendance = [];
    if (state.day >= state.maxDays) stop();
    else state.day++;
  }
}
function addEvents(attendance) {
  const feed = $("event-feed"); if (feed.querySelector(".empty-state")) feed.innerHTML = "";
  const decided = state.agents.filter(agent => agent.decided).length;
  const event = document.createElement("div"); event.className = `event ${attendance > state.capacity ? "going" : ""}`;
  event.innerHTML = `<time>${SLOT_LABELS[state.slot]}</time><strong>Slot resolved</strong><p>${decided} agents decided · ${attendance} going · ${Math.max(0, state.agents.length - attendance)} waiting</p>`;
  feed.prepend(event); while (feed.children.length > 12) feed.lastElementChild.remove();
  $("feed-count").textContent = `${state.history.length} events`;
}
function render() {
  $("agent-grid").innerHTML = state.agents.map(agent => `<span class="agent ${agent.goingThisSlot ? "going" : ""} ${agent.skippedThisSlot ? "skipped" : ""} ${agent.decided && !agent.goingThisSlot && !agent.skippedThisSlot ? "done" : ""}" title="Agent ${agent.id}"></span>`).join("");
  const attendance = state.history.at(-1) ?? 0;
  const decided = state.agents.filter(agent => agent.decided).length;
  $("metric-slot").textContent = SLOT_LABELS[state.slot];
  $("metric-day").textContent = `Day ${state.day}`;
  $("metric-attendance").textContent = `${attendance} / ${state.capacity}`;
  $("metric-capacity").textContent = attendance > state.capacity ? "Over capacity" : "Within capacity";
  $("metric-decisions").textContent = decided;
  $("metric-breakdown").textContent = `${attendance} going · ${state.agents.length - decided} waiting`;
  $("metric-peak").textContent = state.peak;
  $("metric-over").textContent = state.peak > state.capacity ? "Capacity exceeded" : "No crowding yet";
  drawChart();
}
function drawChart() {
  const canvas = $("occupancy-chart"), rect = canvas.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
  canvas.width = rect.width * ratio; canvas.height = rect.height * ratio;
  const ctx = canvas.getContext("2d"); ctx.scale(ratio, ratio);
  const width = rect.width, height = rect.height, pad = { top: 16, right: 12, bottom: 28, left: 30 };
  ctx.clearRect(0, 0, width, height); ctx.strokeStyle = "#2a3442"; ctx.lineWidth = 1;
  const max = Math.max(state.capacity * 1.25, state.peak, 1);
  const y = value => height - pad.bottom - (value / max) * (height - pad.top - pad.bottom);
  [0, state.capacity, Math.max(state.capacity, state.peak)].forEach(value => {
    ctx.beginPath(); ctx.moveTo(pad.left, y(value)); ctx.lineTo(width - pad.right, y(value)); ctx.stroke();
    ctx.fillStyle = "#8d99a8"; ctx.font = "11px system-ui"; ctx.fillText(Math.round(value), 4, y(value) + 4);
  });
  const plotWidth = width - pad.left - pad.right;
  const x = index => pad.left + (index / Math.max(state.history.length - 1, 1)) * plotWidth;
  ctx.strokeStyle = "#ff9f43"; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(pad.left, y(state.capacity)); ctx.lineTo(width - pad.right, y(state.capacity)); ctx.stroke(); ctx.setLineDash([]);
  if (!state.history.length) return;
  const bucketSize = Math.max(1, Math.ceil(state.history.length / Math.max(1, Math.floor(plotWidth))));
  const compressed = [];
  for (let start = 0; start < state.history.length; start += bucketSize) {
    const values = state.history.slice(start, start + bucketSize);
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
  const labels = [0, Math.floor((state.history.length - 1) / 2), state.history.length - 1];
  ctx.fillStyle = "#8d99a8"; ctx.font = "11px system-ui";
  labels.forEach(index => {
    const day = Math.floor(index / SLOT_LABELS.length) + 1;
    ctx.fillText(`D${day} ${SLOT_LABELS[index % SLOT_LABELS.length]}`, Math.max(pad.left, x(index) - 23), height - 7);
  });
}
function setStatus(text) { $("status").textContent = text; $("status-pill")?.classList.toggle("running", state.running); $("status-dot").parentElement.classList.toggle("running", state.running); }
function start() {
  if (state.day > state.maxDays) return;
  state.running = true; setStatus(`Running · day ${state.day}/${state.maxDays}`); $("play").textContent = "Pause simulation";
  state.timer = setInterval(step, state.tickDuration);
}
function stop() { state.running = false; clearInterval(state.timer); state.timer = null; $("play").textContent = "Start simulation"; setStatus("Paused"); }
function bindRange(id, valueId, suffix = "") { $(id).addEventListener("input", event => { $(valueId).textContent = `${event.target.value}${suffix}`; }); }
$("play").addEventListener("click", () => state.running ? stop() : start());
$("step").addEventListener("click", () => { if (!state.running) step(); });
$("reset").addEventListener("click", reset);
$("info-mode").addEventListener("change", event => { state.mode = event.target.value; });
$("agent-count").addEventListener("change", event => { state.agentCount = Number(event.target.value); reset(); });
$("capacity").addEventListener("change", event => { state.capacity = Number(event.target.value); reset(); });
$("memory-size").addEventListener("change", event => { state.memory = Number(event.target.value); reset(); });
$("max-days").addEventListener("change", event => {
  state.maxDays = Math.max(1, Math.min(365, Number(event.target.value) || 40));
  event.target.value = state.maxDays;
  if (state.day > state.maxDays) reset();
});
$("tick-duration").addEventListener("input", event => {
  state.tickDuration = Number(event.target.value);
  $("tick-duration-value").textContent = `${state.tickDuration} ms`;
  if (state.running) { clearInterval(state.timer); state.timer = setInterval(step, state.tickDuration); }
});
bindRange("agent-count", "agent-count-value"); bindRange("capacity", "capacity-value"); bindRange("memory-size", "memory-size-value", " days");
window.addEventListener("resize", drawChart); reset();
