/* Shared, testable browser model. Rules and seed history are read from CSV.
 * Keep the decision and profile-generation rules in sync with GymElFarol.nlogox.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GymSimulation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const OPEN = 390, CLOSE = 1320, SLOT = 30, SLOTS = 31;
  const labels = Array.from({ length: SLOTS }, (_, i) => time(OPEN + i * SLOT));
  function time(minutes) { return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; }
  function rng(seed) {
    let value = Math.abs(Math.trunc(seed)) % 2147483646 + 1;
    return () => { value = (value * 16807) % 2147483647; return value / 2147483647; };
  }
  function shuffle(items, random) {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
  function csv(text) {
    const lines = text.trim().split(/\r?\n/);
    const split = line => (line.match(/(?:"(?:[^"]|"")*"|[^,]*)(?:,|$)/g) || []).filter((x, i, a) => i < a.length - 1 || x !== "").map(x => x.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"'));
    const header = split(lines.shift().replace(/^\uFEFF/, ""));
    return lines.filter(Boolean).map(line => Object.fromEntries(split(line).map((v, i) => [header[i], v])));
  }
  function parseRules(text) {
    const result = {};
    for (const row of csv(text)) {
      const entry = { id: Number(row.id), label: row.label, windows: [[Number(row.start1), Number(row.end1)]], value: Number(row.value) };
      if (Number(row.start2) >= 0) entry.windows.push([Number(row.start2), Number(row.end2)]);
      (result[row.kind] ||= [])[entry.id] = entry;
    }
    for (const [kind, count] of Object.entries({ availability: 4, preference: 4, flexibility: 4, crowding: 3 })) {
      if (result[kind]?.length !== count || !Array.from({ length: count }, (_, i) => result[kind][i]).every(Boolean)) throw Error(`Expected ${count} ${kind} profiles`);
    }
    return result;
  }
  function parseSeedHistory(text) {
    const rows = csv(text);
    if (rows.length !== SLOTS) throw Error("Seed history must contain 31 slots");
    return rows.map((row, index) => {
      if (Number(row.slot_index) !== index) throw Error("Seed history slots must be ordered");
      const series = ["monday", "tuesday", "wednesday", "thursday", "friday"].map(day => row[`${day}_scaled`]).filter(x => x !== "" && x != null).map(Number);
      if (!series.length) series.push(Number(row.mean_occupancy_scaled));
      if (!series.every(Number.isFinite)) throw Error("Invalid occupancy seed");
      // The pooled slot mean is the real (scaled) occupancy curve used by profile-rmse.
      const pooled = Number(row.mean_occupancy_scaled);
      series.mean = row.mean_occupancy_scaled !== "" && Number.isFinite(pooled) ? pooled : series.reduce((a, b) => a + b, 0) / series.length;
      return series;
    });
  }
  function preferenceDistance(agent, slot, rules) {
    if (agent.preference === 3) return 0;
    const [start, end] = rules.preference[agent.preference].windows[0];
    return Math.max(0, start - (OPEN + SLOT * slot), (OPEN + SLOT * slot) - (end - SLOT));
  }
  function allowedStarts(agent, rules, duration) {
    const flex = rules.flexibility[agent.flexibility].value;
    return Array.from({ length: SLOTS }, (_, i) => i).filter(slot => {
      const start = OPEN + slot * SLOT, end = start + duration * SLOT;
      return end <= CLOSE && rules.availability[agent.availability].windows.some(([a, b]) => start >= a && end <= b)
        && (flex < 0 || preferenceDistance(agent, slot, rules) <= flex);
    });
  }
  function profiles(count, seed, rules, duration) {
    const random = rng(seed);
    const balanced = (levels, offset = 0) => shuffle(Array.from({ length: count }, (_, i) => (i + offset) % levels), random);
    const availability = balanced(4), flexibility = balanced(4), crowding = balanced(3, Math.abs(seed) % 3);
    const preferences = Array(count).fill(0);
    for (let group = 0; group < 4; group++) {
      const members = shuffle(availability.map((a, i) => a === group ? i : -1).filter(i => i >= 0), random);
      members.forEach((id, j) => { preferences[id] = (j + group) % 4; });
    }
    return Array.from({ length: count }, (_, id) => {
      const agent = { id, availability: availability[id], preference: preferences[id], flexibility: flexibility[id], crowding: crowding[id], tiePriorities: Array.from({ length: SLOTS }, () => random()) };
      agent.allowedStarts = allowedStarts(agent, rules, duration);
      return agent;
    });
  }
  function utility(agent, slot, prediction, capacity, rules) {
    const flex = rules.flexibility[agent.flexibility].value;
    const timeCost = preferenceDistance(agent, slot, rules) / Math.max(1, flex < 0 ? CLOSE - OPEN : flex);
    return rules.crowding[agent.crowding].value * prediction / capacity - timeCost;
  }
  // Best remaining start slot (-1 if every candidate is excluded). The agent goes now
  // only if this is the current slot.
  function bestStart(agent, currentSlot, currentPrediction, histories, options, rules) {
    const candidates = agent.allowedStarts.filter(s => s >= currentSlot);
    if (!candidates.includes(currentSlot)) return -1;
    if (options.mustGo && currentSlot === candidates.at(-1)) return currentSlot;
    let best = -1, bestScore = -Infinity;
    for (const slot of candidates) {
      const h = histories[slot].slice(0, options.memory);
      const estimate = Math.max(0, Math.min(options.agentCount, slot === currentSlot ? currentPrediction : h.reduce((a, b) => a + b, 0) / h.length));
      if (estimate > options.capacity) continue;
      const score = utility(agent, slot, estimate, options.capacity, rules);
      if (score > bestScore || (score === bestScore && (best < 0 || agent.tiePriorities[slot] > agent.tiePriorities[best]))) { best = slot; bestScore = score; }
    }
    return best;
  }
  function chooseStart(agent, currentSlot, currentPrediction, histories, options, rules) {
    return bestStart(agent, currentSlot, currentPrediction, histories, options, rules) === currentSlot;
  }
  // Constant term of the El Farol linear predictor. The original scales it by
  // population; the utility rule scales it by capacity, the per-slot occupancy scale.
  function predictorScale(options) {
    return options.decisionRule === "utility" ? options.capacity : options.agentCount;
  }
  function predict(strategy, history, scale) {
    return scale * strategy[0] + strategy.slice(1).reduce((sum, weight, i) => sum + weight * history[i], 0);
  }
  function currentPrediction(agent, history, options) {
    const scale = predictorScale(options);
    let best = agent.strategies[0], bestError = Infinity;
    for (const strategy of agent.strategies) {
      let error = 0;
      for (let day = 1; day <= options.memory; day++) error += Math.abs(history[day - 1] - predict(strategy, history.slice(day, day + options.memory), scale));
      if (error <= bestError) { bestError = error; best = strategy; }
    }
    return predict(best, history.slice(0, options.memory), scale);
  }
  const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  // Lag-1 autocorrelation of consecutive same-day slots (overnight pairs excluded).
  function autocorrelation(points) {
    const pairs = points.slice(1).map((p, i) => [points[i], p]).filter(([a, b]) => a.day === b.day);
    if (pairs.length < 2) return 0;
    const x = pairs.map(p => p[0].attendance), y = pairs.map(p => p[1].attendance), mx = mean(x), my = mean(y);
    const numerator = x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0);
    const denominator = Math.sqrt(x.reduce((s, v) => s + (v - mx) ** 2, 0) * y.reduce((s, v) => s + (v - my) ** 2, 0));
    return denominator ? numerator / denominator : 0;
  }
  class Simulation {
    constructor(rules, seedHistory, options = {}) {
      this.rules = rules;
      this.options = { agentCount: 100, capacity: 37, memory: 5, strategies: 10, mode: "live", delay: 2, maxDays: 40, burnIn: 10, duration: 2, populationSeed: 42, simulationSeed: 1234, mustGo: false, decisionRule: "legacy", ...options };
      const o = this.options;
      for (const k of ["agentCount", "capacity", "memory", "strategies", "delay", "maxDays", "duration"]) if (!Number.isInteger(o[k]) || o[k] < 1) throw Error(`Invalid ${k}`);
      if (o.duration > SLOTS || !["none", "live", "delayed"].includes(o.mode) || !["legacy", "utility"].includes(o.decisionRule)) throw Error("Invalid simulation configuration");
      if (![o.populationSeed, o.simulationSeed].every(x => Number.isInteger(x) && x >= 0 && x <= 2147483646)) throw Error("Seeds must be integers from 0 to 2147483646");
      const random = rng(o.simulationSeed);
      this.agents = profiles(o.agentCount, o.populationSeed, rules, o.duration).map(agent => ({ ...agent, prevStart: -1, fixedStart: -2, strategies: Array.from({ length: o.strategies }, () => Array.from({ length: o.memory + 1 }, () => 1 - random() * 2)) }));
      this.realProfile = seedHistory.map(series => Number.isFinite(series.mean) ? series.mean : mean(series));
      this.slotHistories = seedHistory.map(series => Array.from({ length: o.memory * 2 }, (_, i) => series[i % series.length]));
      this.ticks = 0; this.day = 1; this.slot = 0; this.done = false; this.history = []; this.todayAttendance = []; this.peak = 0; this.last = null;
      this.metrics = { slots: 0, over: 0, visits: 0, good: 0, skips: 0, agentDays: 0, peak: 0, occupancy: [], days: 0, slotSums: Array(SLOTS).fill(0), startPairs: 0, startChanges: 0, startShift: 0, laterThanPlanned: 0, structuralSkips: 0 };
      this.newDay();
    }
    newDay() {
      this.todayAttendance = [];
      for (const a of this.agents) Object.assign(a, { decided: false, attending: false, wentToday: false, skippedToday: false, goodVisit: false, departure: -1, startSlot: -1, plannedSlot: -2, startedThisSlot: false, leftThisSlot: false, prediction: null });
    }
    step() {
      if (this.done) return null;
      const o = this.options, slot = this.ticks % SLOTS, day = Math.floor(this.ticks / SLOTS) + 1;
      if (slot === 0) this.newDay();
      for (const a of this.agents) {
        a.startedThisSlot = false; a.leftThisSlot = a.attending && a.departure <= slot;
        if (a.leftThisSlot) a.attending = false;
      }
      for (const a of this.agents) {
        if (a.decided || !a.allowedStarts.includes(slot)) continue;
        let prediction = currentPrediction(a, this.slotHistories[slot], o);
        if (o.mode === "live" && slot > 0) prediction = 0.5 * prediction + 0.5 * this.todayAttendance[slot - 1];
        if (o.mode === "delayed" && slot >= o.delay) prediction = 0.5 * prediction + 0.5 * this.todayAttendance[slot - o.delay];
        a.prediction = prediction;
        const best = bestStart(a, slot, prediction, this.slotHistories, o, this.rules);
        if (a.plannedSlot === -2) a.plannedSlot = best; // first-choice slot at the agent's first decision today
        if (best === slot) Object.assign(a, { decided: true, attending: true, wentToday: true, goodVisit: true, departure: slot + o.duration, startSlot: slot, startedThisSlot: true });
      }
      const attendance = this.agents.filter(a => a.attending).length;
      if (attendance > o.capacity) for (const a of this.agents) if (a.attending) a.goodVisit = false;
      if (slot === SLOTS - 1) for (const a of this.agents) if (!a.decided) { a.decided = true; a.skippedToday = true; }
      this.slotHistories[slot] = [attendance, ...this.slotHistories[slot]].slice(0, 2 * o.memory);
      this.todayAttendance.push(attendance); this.history.push(attendance); this.peak = Math.max(this.peak, attendance);
      if (day > o.burnIn) {
        const m = this.metrics;
        m.slots++; m.over += Number(attendance > o.capacity); m.peak = Math.max(m.peak, attendance); m.occupancy.push({ day, slot, attendance });
        m.slotSums[slot] += attendance;
        if (slot === SLOTS - 1) {
          m.days++; m.agentDays += o.agentCount; m.visits += this.agents.filter(a => a.wentToday).length; m.good += this.agents.filter(a => a.goodVisit).length; m.skips += this.agents.filter(a => a.skippedToday).length;
          m.structuralSkips += this.agents.filter(a => a.skippedToday && !a.allowedStarts.length).length;
          // Start-shift accounting over consecutive measured days.
          for (const a of this.agents) {
            if (a.wentToday) {
              if (a.prevStart >= 0) { m.startPairs++; m.startChanges += Number(a.startSlot !== a.prevStart); m.startShift += Math.abs(a.startSlot - a.prevStart); }
              if (a.plannedSlot >= 0 && a.startSlot > a.plannedSlot) m.laterThanPlanned++;
            }
            a.prevStart = a.wentToday ? a.startSlot : -1;
            if (a.fixedStart === -2) a.fixedStart = a.wentToday ? a.startSlot : -1;
            else if (a.fixedStart >= 0 && (!a.wentToday || a.startSlot !== a.fixedStart)) a.fixedStart = -1;
          }
        }
      }
      this.last = { day, slot, attendance, arrivals: this.agents.filter(a => a.startedThisSlot).length, departures: this.agents.filter(a => a.leftThisSlot).length, waiting: this.agents.filter(a => !a.decided).length };
      this.ticks++; this.done = this.ticks >= o.maxDays * SLOTS; this.day = day; this.slot = slot;
      return this.last;
    }
    // Post-burn-in reporters, named as in NetLogo BehaviorSpace output.
    summary() {
      const m = this.metrics, counts = m.occupancy.map(p => p.attendance), average = mean(counts);
      const eligible = this.agents.filter(a => a.allowedStarts.length);
      const profile = m.slotSums.map(x => m.days ? x / m.days : 0);
      return {
        "peak-occupancy": m.peak,
        "pct-slots-over-capacity": m.slots ? 100 * m.over / m.slots : 0,
        "occupancy-variance": counts.length >= 2 ? mean(counts.map(x => (x - average) ** 2)) : 0,
        "good-visit-rate": m.visits ? m.good / m.visits : 0,
        "skip-rate": m.agentDays ? m.skips / m.agentDays : 0,
        "lag1-autocorr": autocorrelation(m.occupancy),
        "start-change-rate": m.startPairs ? m.startChanges / m.startPairs : 0,
        "mean-start-shift": m.startPairs ? m.startShift / m.startPairs : 0,
        "later-than-planned-share": m.visits ? m.laterThanPlanned / m.visits : 0,
        "fixed-start-share": eligible.length && m.days ? eligible.filter(a => a.fixedStart >= 0).length / eligible.length : 0,
        "structural-skip-rate": m.agentDays ? m.structuralSkips / m.agentDays : 0,
        "occupancy-profile": profile,
        "profile-rmse": Math.sqrt(mean(profile.map((x, i) => (x - this.realProfile[i]) ** 2))),
      };
    }
    profileExport() {
      return { populationSeed: this.options.populationSeed, simulationSeed: this.options.simulationSeed, options: this.options, rules: this.rules, agents: this.agents.map(({ id, availability, preference, flexibility, crowding, tiePriorities, allowedStarts }) => ({ id, availability, preference, flexibility, crowding, tiePriorities, allowedStarts })) };
    }
  }
  return { Simulation, parseRules, parseSeedHistory, profiles, allowedStarts, preferenceDistance, utility, bestStart, chooseStart, predict, predictorScale, currentPrediction, autocorrelation, rng, labels, time, OPEN, CLOSE, SLOT, SLOTS };
});
