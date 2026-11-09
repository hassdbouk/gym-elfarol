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

  // ---------- Utility rule (decisionRule = "utility") ----------
  const MODULUS = 2147483647;
  // a * b mod (2^31 - 1), split so every intermediate stays exact in a double
  // (NetLogo numbers are doubles too, so both engines get identical integers).
  function mulmod(a, b) {
    return ((Math.floor(a / 65536) * b) % MODULUS * 65536 + (a % 65536) * b) % MODULUS;
  }
  function hashStep(h, k) {
    const x = (h + k + 1) % MODULUS;
    return (mulmod(x, x) * 16807) % MODULUS;
  }
  // Counter-based uniform draw for (seed, agent, day, slot). The same agent gets the
  // same draw in every information mode, so condition comparisons are paired.
  function choiceDraw(seed, agentId, day, slot) {
    let h = seed % (MODULUS - 1) + 1;
    for (const k of [agentId, day, slot, 0]) h = hashStep(h, k);
    return h / MODULUS;
  }
  // P(x) = (max(0, x - theta) / (1 - theta))^2, paid by every agent.
  function crowdingPenalty(x, threshold) {
    const r = Math.max(0, x - threshold) / (1 - threshold);
    return r * r;
  }
  // U_i(s) = V - wP * P(x) + wC * d_i * min(x, 1) - wT * T_i(s) + wR * R_i(s), x = estimate / C.
  function choiceUtility(agent, slot, estimate, options, rules) {
    const x = Math.max(0, Math.min(options.agentCount, estimate)) / options.capacity;
    const flex = rules.flexibility[agent.flexibility].value;
    const timeCost = preferenceDistance(agent, slot, rules) / Math.max(1, flex < 0 ? CLOSE - OPEN : flex);
    const reinforcement = options.outcomeLearning ? agent.reinforcement[slot] : 0;
    return options.workoutValue - options.crowdPenalty * crowdingPenalty(x, options.comfortThreshold)
      + options.tasteWeight * rules.crowding[agent.crowding].value * Math.min(x, 1)
      - options.timeWeight * timeCost + options.learningWeight * reinforcement;
  }
  // Decide at the current slot among {now, later allowed starts, skip (utility 0)}.
  // Returns { go, best }: best is the argmax start (-1 when skipping is best).
  // With temperature > 0 the agent goes now with logit probability; repeated each
  // slot this reproduces a single logit choice over the whole day.
  function utilityDecision(agent, currentSlot, currentEstimate, day, options, rules) {
    const candidates = agent.allowedStarts.filter(s => s >= currentSlot);
    if (!candidates.includes(currentSlot)) return { go: false, best: -1 };
    if (options.mustGo && currentSlot === candidates.at(-1)) return { go: true, best: currentSlot };
    const utilities = candidates.map(s => choiceUtility(agent, s, s === currentSlot ? currentEstimate : agent.forecasts[s], options, rules));
    let best = -1, bestUtility = -Infinity;
    candidates.forEach((slot, i) => {
      const u = utilities[i];
      if (u > bestUtility || (u === bestUtility && agent.tiePriorities[slot] > agent.tiePriorities[best])) { best = slot; bestUtility = u; }
    });
    const planned = bestUtility >= 0 ? best : -1;
    if (options.temperature <= 0) return { go: planned === currentSlot, best: planned };
    const top = Math.max(0, ...utilities);
    let total = 0;
    for (const u of utilities) total += Math.exp((u - top) / options.temperature);
    total += Math.exp((0 - top) / options.temperature);
    const pNow = Math.exp((utilities[0] - top) / options.temperature) / total;
    return { go: choiceDraw(options.simulationSeed, agent.id, day, currentSlot) < pNow, best: planned };
  }

  // Model defaults for the decision rule and utility weights (NetLogo widget defaults match).
  const DEFAULTS = Object.freeze({
    decisionRule: "utility", workoutValue: 1, crowdPenalty: 1, comfortThreshold: 0.8, timeWeight: 0.5, tasteWeight: 0.25,
    temperature: 0.1, outcomeLearning: false, learningRate: 0.2, learningWeight: 0.5,
  });
  class Simulation {
    constructor(rules, seedHistory, options = {}) {
      this.rules = rules;
      this.options = { agentCount: 100, capacity: 37, memory: 5, strategies: 10, mode: "live", delay: 2, maxDays: 40, burnIn: 10, duration: 2, populationSeed: 42, simulationSeed: 1234, mustGo: false, ...DEFAULTS, ...options };
      const o = this.options;
      for (const k of ["agentCount", "capacity", "memory", "strategies", "delay", "maxDays", "duration"]) if (!Number.isInteger(o[k]) || o[k] < 1) throw Error(`Invalid ${k}`);
      if (o.duration > SLOTS || !["none", "live", "delayed"].includes(o.mode) || !["legacy", "utility"].includes(o.decisionRule)) throw Error("Invalid simulation configuration");
      for (const k of ["workoutValue", "crowdPenalty", "tasteWeight", "timeWeight", "temperature", "learningWeight"]) if (!Number.isFinite(o[k]) || o[k] < 0) throw Error(`Invalid ${k}`);
      if (!(o.comfortThreshold >= 0 && o.comfortThreshold < 1) || !(o.learningRate >= 0 && o.learningRate <= 1)) throw Error("Invalid utility configuration");
      if (![o.populationSeed, o.simulationSeed].every(x => Number.isInteger(x) && x >= 0 && x <= 2147483646)) throw Error("Seeds must be integers from 0 to 2147483646");
      const random = rng(o.simulationSeed);
      this.agents = profiles(o.agentCount, o.populationSeed, rules, o.duration).map(agent => ({ ...agent, prevStart: -1, fixedStart: -2, forecasts: Array(SLOTS).fill(0), reinforcement: Array(SLOTS).fill(0), strategies: Array.from({ length: o.strategies }, () => Array.from({ length: o.memory + 1 }, () => 1 - random() * 2)) }));
      this.realProfile = seedHistory.map(series => Number.isFinite(series.mean) ? series.mean : mean(series));
      this.slotHistories = seedHistory.map(series => Array.from({ length: o.memory * 2 }, (_, i) => series[i % series.length]));
      this.ticks = 0; this.day = 1; this.slot = 0; this.done = false; this.history = []; this.todayAttendance = []; this.peak = 0; this.last = null;
      this.metrics = { slots: 0, over: 0, visits: 0, good: 0, skips: 0, agentDays: 0, peak: 0, occupancy: [], days: 0, slotSums: Array(SLOTS).fill(0), startPairs: 0, startChanges: 0, startShift: 0, laterThanPlanned: 0, structuralSkips: 0 };
      this.newDay(false);
    }
    newDay(forecast = true) {
      this.todayAttendance = [];
      // Utility rule: every allowed start is forecast once per day with the agent's best
      // predictor on that slot's own history (yesterday and earlier only).
      if (forecast && this.options.decisionRule === "utility") for (const a of this.agents) for (const s of a.allowedStarts) a.forecasts[s] = currentPrediction(a, this.slotHistories[s], this.options);
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
        const utilityRule = o.decisionRule === "utility";
        // Information blends into the current slot only; later slots keep the day-start forecast.
        let prediction = utilityRule ? a.forecasts[slot] : currentPrediction(a, this.slotHistories[slot], o);
        if (o.mode === "live" && slot > 0) prediction = 0.5 * prediction + 0.5 * this.todayAttendance[slot - 1];
        if (o.mode === "delayed" && slot >= o.delay) prediction = 0.5 * prediction + 0.5 * this.todayAttendance[slot - o.delay];
        a.prediction = prediction;
        const decision = utilityRule ? utilityDecision(a, slot, prediction, day, o, this.rules) : null;
        const best = utilityRule ? decision.best : bestStart(a, slot, prediction, this.slotHistories, o, this.rules);
        if (a.plannedSlot === -2) a.plannedSlot = best; // first-choice slot at the agent's first decision today
        if (utilityRule ? decision.go : best === slot) Object.assign(a, { decided: true, attending: true, wentToday: true, goodVisit: true, departure: slot + o.duration, startSlot: slot, startedThisSlot: true });
      }
      const attendance = this.agents.filter(a => a.attending).length;
      if (attendance > o.capacity) for (const a of this.agents) if (a.attending) a.goodVisit = false;
      if (slot === SLOTS - 1) for (const a of this.agents) if (!a.decided) { a.decided = true; a.skippedToday = true; }
      // Optional outcome learning: R(s) <- R(s) + alpha * (r - R(s)), r = +1 good / -1 bad visit.
      if (slot === SLOTS - 1 && o.decisionRule === "utility" && o.outcomeLearning) for (const a of this.agents) if (a.wentToday) {
        a.reinforcement[a.startSlot] += o.learningRate * ((a.goodVisit ? 1 : -1) - a.reinforcement[a.startSlot]);
      }
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
        "profile-rmse": Math.sqrt(mean(profile.map((x, i) => (x - this.realProfile[i]) * (x - this.realProfile[i])))),
      };
    }
    profileExport() {
      return { populationSeed: this.options.populationSeed, simulationSeed: this.options.simulationSeed, options: this.options, rules: this.rules, agents: this.agents.map(({ id, availability, preference, flexibility, crowding, tiePriorities, allowedStarts }) => ({ id, availability, preference, flexibility, crowding, tiePriorities, allowedStarts })) };
    }
  }
  return { Simulation, parseRules, parseSeedHistory, profiles, allowedStarts, preferenceDistance, utility, bestStart, chooseStart, choiceUtility, crowdingPenalty, utilityDecision, choiceDraw, mulmod, DEFAULTS, predict, predictorScale, currentPrediction, autocorrelation, rng, labels, time, OPEN, CLOSE, SLOT, SLOTS };
});
