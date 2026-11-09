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
  function chooseStart(agent, currentSlot, currentPrediction, histories, options, rules) {
    const candidates = agent.allowedStarts.filter(s => s >= currentSlot);
    if (!candidates.includes(currentSlot)) return false;
    if (options.mustGo && currentSlot === candidates.at(-1)) return true;
    let best = -1, bestScore = -Infinity;
    for (const slot of candidates) {
      const h = histories[slot].slice(0, options.memory);
      const estimate = Math.max(0, Math.min(options.agentCount, slot === currentSlot ? currentPrediction : h.reduce((a, b) => a + b, 0) / h.length));
      if (estimate > options.capacity) continue;
      const score = utility(agent, slot, estimate, options.capacity, rules);
      if (score > bestScore || (score === bestScore && (best < 0 || agent.tiePriorities[slot] > agent.tiePriorities[best]))) { best = slot; bestScore = score; }
    }
    return best === currentSlot;
  }
  function predict(strategy, history, count) {
    return count * strategy[0] + strategy.slice(1).reduce((sum, weight, i) => sum + weight * history[i], 0);
  }
  function currentPrediction(agent, history, options) {
    let best = agent.strategies[0], bestError = Infinity;
    for (const strategy of agent.strategies) {
      let error = 0;
      for (let day = 1; day <= options.memory; day++) error += Math.abs(history[day - 1] - predict(strategy, history.slice(day, day + options.memory), options.agentCount));
      if (error <= bestError) { bestError = error; best = strategy; }
    }
    return predict(best, history.slice(0, options.memory), options.agentCount);
  }
  class Simulation {
    constructor(rules, seedHistory, options = {}) {
      this.rules = rules;
      this.options = { agentCount: 100, capacity: 37, memory: 5, strategies: 10, mode: "live", delay: 2, maxDays: 40, burnIn: 10, duration: 2, populationSeed: 42, simulationSeed: 1234, mustGo: false, ...options };
      const o = this.options;
      for (const k of ["agentCount", "capacity", "memory", "strategies", "delay", "maxDays", "duration"]) if (!Number.isInteger(o[k]) || o[k] < 1) throw Error(`Invalid ${k}`);
      if (o.duration > SLOTS || !["none", "live", "delayed"].includes(o.mode)) throw Error("Invalid simulation configuration");
      if (![o.populationSeed, o.simulationSeed].every(x => Number.isInteger(x) && x >= 0 && x <= 2147483646)) throw Error("Seeds must be integers from 0 to 2147483646");
      const random = rng(o.simulationSeed);
      this.agents = profiles(o.agentCount, o.populationSeed, rules, o.duration).map(agent => ({ ...agent, strategies: Array.from({ length: o.strategies }, () => Array.from({ length: o.memory + 1 }, () => 1 - random() * 2)) }));
      this.slotHistories = seedHistory.map(series => Array.from({ length: o.memory * 2 }, (_, i) => series[i % series.length]));
      this.ticks = 0; this.day = 1; this.slot = 0; this.done = false; this.history = []; this.todayAttendance = []; this.peak = 0; this.last = null;
      this.metrics = { slots: 0, over: 0, visits: 0, good: 0, skips: 0, agentDays: 0, peak: 0, occupancy: [] };
      this.newDay();
    }
    newDay() {
      this.todayAttendance = [];
      for (const a of this.agents) Object.assign(a, { decided: false, attending: false, wentToday: false, skippedToday: false, goodVisit: false, departure: -1, startSlot: -1, startedThisSlot: false, leftThisSlot: false, prediction: null });
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
        if (chooseStart(a, slot, prediction, this.slotHistories, o, this.rules)) Object.assign(a, { decided: true, attending: true, wentToday: true, goodVisit: true, departure: slot + o.duration, startSlot: slot, startedThisSlot: true });
      }
      const attendance = this.agents.filter(a => a.attending).length;
      if (attendance > o.capacity) for (const a of this.agents) if (a.attending) a.goodVisit = false;
      if (slot === SLOTS - 1) for (const a of this.agents) if (!a.decided) { a.decided = true; a.skippedToday = true; }
      this.slotHistories[slot] = [attendance, ...this.slotHistories[slot]].slice(0, 2 * o.memory);
      this.todayAttendance.push(attendance); this.history.push(attendance); this.peak = Math.max(this.peak, attendance);
      if (day > o.burnIn) {
        const m = this.metrics;
        m.slots++; m.over += Number(attendance > o.capacity); m.peak = Math.max(m.peak, attendance); m.occupancy.push({ day, slot, attendance });
        if (slot === SLOTS - 1) { m.agentDays += o.agentCount; m.visits += this.agents.filter(a => a.wentToday).length; m.good += this.agents.filter(a => a.goodVisit).length; m.skips += this.agents.filter(a => a.skippedToday).length; }
      }
      this.last = { day, slot, attendance, arrivals: this.agents.filter(a => a.startedThisSlot).length, departures: this.agents.filter(a => a.leftThisSlot).length, waiting: this.agents.filter(a => !a.decided).length };
      this.ticks++; this.done = this.ticks >= o.maxDays * SLOTS; this.day = day; this.slot = slot;
      return this.last;
    }
    profileExport() {
      return { populationSeed: this.options.populationSeed, simulationSeed: this.options.simulationSeed, options: this.options, rules: this.rules, agents: this.agents.map(({ id, availability, preference, flexibility, crowding, tiePriorities, allowedStarts }) => ({ id, availability, preference, flexibility, crowding, tiePriorities, allowedStarts })) };
    }
  }
  return { Simulation, parseRules, parseSeedHistory, profiles, allowedStarts, preferenceDistance, utility, chooseStart, rng, labels, time, OPEN, CLOSE, SLOT, SLOTS };
});
