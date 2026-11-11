const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../web/simulation.js');
const root = path.resolve(__dirname, '..');
const rules = G.parseRules(fs.readFileSync(path.join(root, 'web/profile-rules.csv'), 'utf8'));
const seed = G.parseSeedHistory(fs.readFileSync(path.join(root, 'netlogo/seed_history.csv'), 'utf8'));
// Tests pin the legacy rule, 100 agents and unscaled seeds unless they say otherwise;
// utility-rule and seed-scaling tests opt in.
const create = options => new G.Simulation(rules, seed, { maxDays: 1, burnIn: 0, decisionRule: 'legacy', agentCount: 100, scaleSeedWithN: false, ...options });
const agent = changes => ({ availability: 2, preference: 0, flexibility: 2, crowding: 0, tiePriorities: Array(31).fill(0), ...changes });

test('confirmed availability windows and four named preferences are loaded', () => {
  assert.deepEqual(rules.availability.map(x => x.windows), [[[390, 540], [1020, 1320]], [[540, 720], [840, 1320]], [[390, 1320]], [[600, 900], [1080, 1260]]]);
  assert.deepEqual(rules.preference.map(x => x.label), ['Morning', 'Night', 'Afternoon', 'Whenever']);
  assert.deepEqual(rules.flexibility.map(x => x.value), [60, 180, 0, -1]);
  assert.deepEqual(rules.crowding.map(x => x.value), [0, 1, -1]);
});
test('full workouts fit a single availability window and finish by closing', () => {
  const starts = G.allowedStarts(agent({ availability: 0, preference: 3, flexibility: 3 }), rules, 2);
  assert(starts.includes(3)); // 08:00-09:00 fits.
  assert(!starts.includes(4)); // 08:30-09:30 crosses the availability boundary.
  assert(!starts.includes(20)); // 16:30 precedes evening availability.
  assert(starts.includes(21)); // 17:00-18:00 fits.
  assert(starts.includes(29)); // 21:00-22:00 fits.
  assert(!starts.includes(30)); // 21:30-22:30 crosses closing.
  for (let availability = 0; availability < 4; availability++) for (let preference = 0; preference < 4; preference++) for (let flexibility = 0; flexibility < 4; flexibility++) {
    for (const slot of G.allowedStarts(agent({ availability, preference, flexibility }), rules, 2)) {
      const start = 390 + 30 * slot;
      assert(rules.availability[availability].windows.some(([a, b]) => start >= a && start + 60 <= b));
    }
  }
});
test('flexibility expands the preferred start period by exactly the stated amount', () => {
  const last = flexibility => G.allowedStarts(agent({ flexibility }), rules, 2).at(-1);
  assert.equal(last(2), 10); // Zero: last morning start 11:30.
  assert.equal(last(0), 12); // One hour: 12:30.
  assert.equal(last(1), 16); // Three hours: 14:30.
  assert.equal(last(3), 29); // Any available time: 21:00.
});
test('100-agent population has balanced marginal assignments', () => {
  const pop = create().agents;
  for (const key of ['availability', 'preference', 'flexibility']) assert.deepEqual([0, 1, 2, 3].map(i => pop.filter(a => a[key] === i).length), [25, 25, 25, 25]);
  assert.deepEqual([0, 1, 2].map(i => pop.filter(a => a.crowding === i).length).sort(), [33, 33, 34]);
  for (let group = 0; group < 4; group++) for (let pref = 0; pref < 4; pref++) assert([6, 7].includes(pop.filter(a => a.availability === group && a.preference === pref).length));
});
test('population assignment is stable across information and memory conditions', () => {
  const baseline = create({ populationSeed: 17 }).profileExport().agents;
  for (const mode of ['none', 'live', 'delayed']) for (const memory of [1, 5, 10]) assert.deepEqual(create({ mode, memory, populationSeed: 17, simulationSeed: 999 }).profileExport().agents, baseline);
  assert.notDeepEqual(create({ populationSeed: 18 }).profileExport().agents, baseline);
});
test('busy and empty preferences rank the same feasible slots in opposite directions', () => {
  const a = agent({ preference: 3, allowedStarts: [0, 1], tiePriorities: [0.8, 0.2] });
  const histories = Array.from({ length: 31 }, () => [30, 30]);
  const options = { memory: 1, agentCount: 100, capacity: 37, mustGo: false };
  assert.equal(G.chooseStart({ ...a, crowding: 1 }, 0, 10, histories, options, rules), false);
  assert.equal(G.chooseStart({ ...a, crowding: 2 }, 0, 10, histories, options, rules), true);
  assert.equal(G.chooseStart({ ...a, crowding: 0 }, 0, 10, histories, options, rules), true);
  histories[1] = [50, 50];
  for (const crowding of [0, 1, 2]) assert.equal(G.chooseStart({ ...a, crowding }, 0, 50, histories, options, rules), false);
});
test('one-hour workout occupies exactly two slots without a second workout', () => {
  const s = create({ agentCount: 1, mode: 'none', memory: 1 });
  s.agents[0].allowedStarts = [0]; s.agents[0].strategies = [[-1, 0]];
  while (!s.done) s.step();
  assert.deepEqual(s.history.slice(0, 4), [1, 1, 0, 0]);
  assert.equal(s.metrics.visits, 1); assert.equal(s.metrics.good, 1); assert.equal(s.metrics.skips, 0);
  assert.equal(s.history.reduce((a, b) => a + b, 0), 2);
});
test('crowding in any occupied slot makes the visit unsuccessful permanently', () => {
  const s = create({ agentCount: 2, capacity: 1, mode: 'none', memory: 1 });
  s.agents.forEach((a, i) => { a.allowedStarts = [i]; a.strategies = [[-1, 0]]; });
  while (!s.done) s.step();
  assert.deepEqual(s.history.slice(0, 4), [1, 2, 1, 0]);
  assert.equal(s.metrics.visits, 2); assert.equal(s.metrics.good, 0); assert.equal(s.metrics.over, 1);
});
test('no feasible start produces a skip; must-go cannot violate availability', () => {
  const s = create({ agentCount: 1, mustGo: true }); s.agents[0].allowedStarts = [];
  while (!s.done) s.step();
  assert.equal(s.metrics.skips, 1); assert.equal(s.metrics.visits, 0);
});
test('run stops at the requested day count and preserves population profiles', () => {
  const s = create({ maxDays: 3 }); const initial = s.profileExport().agents;
  while (!s.done) s.step();
  const history = [...s.history]; for (let i = 0; i < 10; i++) assert.equal(s.step(), null);
  assert.equal(s.ticks, 93); assert.deepEqual(s.history, history); assert.deepEqual(s.profileExport().agents, initial);
  assert.equal(s.metrics.visits + s.metrics.skips, 300);
  assert.equal(s.history.reduce((a, b) => a + b, 0), 2 * s.metrics.visits);
});
test('same seeds reproduce trajectories and burn-in excludes complete days', () => {
  const a = create({ maxDays: 3, burnIn: 1 }), b = create({ maxDays: 3, burnIn: 1 });
  while (!a.done) { a.step(); b.step(); }
  assert.deepEqual(a.history, b.history); assert.equal(a.metrics.slots, 62); assert.equal(a.metrics.agentDays, 200);
});

// ---------- Visit lifecycle (arrival, stay, departure, reset, skips, burn-in) ----------
// Single scripted agents use a strategy with constant -1 and no history weight, so the
// current-slot prediction is clipped to 0 and the agent goes at its first allowed start.
const scripted = (count, starts, options = {}) => {
  const s = create({ agentCount: count, mode: 'none', memory: 1, ...options });
  s.agents.forEach((a, i) => { a.allowedStarts = starts[i]; a.strategies = [[-1, 0]]; });
  return s;
};
const runDay = s => Array.from({ length: 31 }, () => s.step());

test('arrival sets start, departure and attendance in the chosen slot', () => {
  const s = scripted(1, [[5]]);
  const events = runDay(s);
  assert.equal(events[5].arrivals, 1);
  assert.equal(events.filter(e => e.arrivals).length, 1);
  assert.equal(s.agents[0].startSlot, 5);
  assert.equal(s.agents[0].departure, 7);
});
test('workout occupies exactly its two slots and departs before the next decisions', () => {
  const s = scripted(1, [[5]]);
  const events = runDay(s);
  assert.deepEqual(events.map(e => e.attendance), events.map((_, i) => (i === 5 || i === 6 ? 1 : 0)));
  assert.equal(events[7].departures, 1);
  assert.equal(events.filter(e => e.departures).length, 1);
});
test('a departing agent does not block a new arrival in the same slot', () => {
  const s = scripted(2, [[5], [7]], { capacity: 1 });
  const events = runDay(s);
  assert.equal(events[7].attendance, 1);
  assert.equal(events[7].arrivals, 1); assert.equal(events[7].departures, 1);
  assert.equal(s.metrics.over, 0); assert.equal(s.metrics.good, 2);
});
test('21:00 is the last start and its workout ends at closing', () => {
  for (let availability = 0; availability < 4; availability++) for (let preference = 0; preference < 4; preference++) for (let flexibility = 0; flexibility < 4; flexibility++) {
    assert(!G.allowedStarts(agent({ availability, preference, flexibility }), rules, 2).includes(30));
  }
  const s = scripted(1, [[29]], { maxDays: 2 });
  const day1 = runDay(s);
  assert.equal(day1[29].attendance, 1); assert.equal(day1[30].attendance, 1);
  assert.equal(s.agents[0].departure, 31); // never reached; cleared by the day reset
  const day2 = runDay(s);
  assert.equal(day2[0].attendance, 0); assert.equal(day2[0].departures, 0);
  assert.equal(day2[29].arrivals, 1);
  assert.equal(s.metrics.visits, 2); assert.equal(s.history.reduce((a, b) => a + b, 0), 4);
});
test('end-of-day reset clears every per-day field', () => {
  const s = scripted(1, [[29]], { maxDays: 2 });
  runDay(s);
  assert.equal(s.agents[0].attending, true);
  s.step(); // first slot of day 2
  const a = s.agents[0];
  assert.deepEqual([a.attending, a.wentToday, a.skippedToday, a.goodVisit, a.decided, a.startSlot, a.departure], [false, false, false, false, false, -1, -1]);
});
test('an agent with no affordable start skips once per day and is never in the gym', () => {
  // Constant 1 predicts the full population (2) for every slot, above capacity 1.
  const s = create({ agentCount: 2, capacity: 1, mode: 'none', memory: 1, maxDays: 3 });
  s.agents.forEach(a => { a.allowedStarts = [10, 11]; a.strategies = [[1, 0]]; });
  while (!s.done) { const e = s.step(); assert.equal(e.attendance, 0); }
  assert.equal(s.metrics.skips, 6); assert.equal(s.metrics.visits, 0); assert.equal(s.metrics.agentDays, 6);
});
test('skips are marked only at the last slot of the day', () => {
  const s = scripted(1, [[]]);
  const flags = [];
  for (let i = 0; i < 31; i++) { s.step(); flags.push(s.agents[0].skippedToday); }
  assert.deepEqual(flags, flags.map((_, i) => i === 30));
  assert.equal(s.metrics.skips, 1); assert.equal(s.metrics.visits, 0);
});
test('crowding after a visit ends does not spoil it; crowding in either slot does', () => {
  const s = scripted(3, [[0], [2], [2]], { capacity: 1 });
  runDay(s);
  assert.deepEqual(s.agents.map(a => a.goodVisit), [true, false, false]);
  assert.equal(s.metrics.good, 1); assert.equal(s.metrics.over, 2);
  const t = scripted(2, [[0], [1]], { capacity: 1 });
  runDay(t);
  assert.deepEqual(t.agents.map(a => a.goodVisit), [false, false]); // crowded in second and first slot respectively
});
test('burn-in excludes whole days from every metric', () => {
  const s = scripted(2, [[3], [3]], { capacity: 1, maxDays: 3, burnIn: 2 });
  s.agents[1].allowedStarts = [];
  while (!s.done) s.step();
  assert.equal(s.metrics.slots, 31); assert.equal(s.metrics.agentDays, 2);
  assert.equal(s.metrics.visits, 1); assert.equal(s.metrics.skips, 1);
  assert(s.metrics.occupancy.every(p => p.day === 3));
  assert.equal(s.metrics.occupancy.length, 31);
});
test('full population run keeps visit accounting consistent', () => {
  const s = create({ agentCount: 100, mode: 'live', memory: 5, maxDays: 4, burnIn: 0, populationSeed: 1, simulationSeed: 100001 });
  const structural = s.agents.filter(a => !a.allowedStarts.length).map(a => a.id);
  assert(structural.length >= 1); // availability 0 + Afternoon + No change has no start
  while (!s.done) {
    const slotsIn = new Map();
    for (let i = 0; i < 31; i++) {
      const e = s.step();
      assert.equal(s.agents.filter(a => a.attending).length, e.attendance);
      for (const a of s.agents) {
        if (a.attending) slotsIn.set(a.id, (slotsIn.get(a.id) || 0) + 1);
        if (a.startedThisSlot) assert(a.allowedStarts.includes(e.slot));
      }
    }
    for (const a of s.agents) {
      assert([0, 2].includes(slotsIn.get(a.id) || 0));
      assert.notEqual(a.wentToday, a.skippedToday);
      assert.equal(a.wentToday, (slotsIn.get(a.id) || 0) === 2);
    }
    for (const id of structural) assert(s.agents[id].skippedToday);
  }
  assert.equal(s.metrics.visits + s.metrics.skips, s.metrics.agentDays);
  assert.equal(s.history.reduce((a, b) => a + b, 0), 2 * s.metrics.visits);
});

// ---------- Start-shift metrics and summary reporters ----------
test('start change rate and mean shift count consecutive measured days only', () => {
  const s = scripted(1, [[5]], { maxDays: 4, burnIn: 1 });
  const plan = { 1: [20], 2: [5], 3: [8], 4: [8] }; // day 1 is burn-in and must not pair with day 2
  for (let day = 1; day <= 4; day++) { s.agents[0].allowedStarts = plan[day]; runDay(s); }
  const r = s.summary();
  assert.equal(s.metrics.startPairs, 2);
  assert.equal(r['start-change-rate'], 0.5);
  assert.equal(r['mean-start-shift'], 1.5);
  assert.equal(r['fixed-start-share'], 0);
});
test('fixed-start share requires the same start on every measured day', () => {
  const s = scripted(3, [[4], [6], []], { maxDays: 3, capacity: 2 });
  // On day 3 agent 1 forecasts the full population (3 > capacity 2) and skips.
  for (let day = 1; day <= 3; day++) { if (day === 3) s.agents[1].strategies = [[1, 0]]; runDay(s); }
  // Agent 0 always 04, agent 1 misses day 3, agent 2 has no start and is not eligible.
  assert.equal(s.summary()['fixed-start-share'], 0.5);
  assert.equal(s.summary()['structural-skip-rate'], 3 / 9);
});
test('later-than-planned counts visits after the first-choice slot', () => {
  const s = scripted(1, [[5]]);
  s.step(); s.agents[0].plannedSlot = 3; // as if the first decision had picked 07:30
  while (!s.done) s.step();
  assert.equal(s.summary()['later-than-planned-share'], 1);
  const t = scripted(1, [[5]]);
  runDay(t);
  assert.equal(t.agents[0].plannedSlot, 5);
  assert.equal(t.summary()['later-than-planned-share'], 0);
});
test('occupancy profile averages measured days and rmse uses the real seed curve', () => {
  const meanColumn = fs.readFileSync(path.join(root, 'netlogo/seed_history.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map(l => Number(l.split(',')[3]));
  assert.deepEqual(seed.map(s => s.mean), meanColumn); // mean_occupancy_scaled column
  const s = scripted(1, [[5]], { maxDays: 2 });
  runDay(s); s.agents[0].allowedStarts = [7]; runDay(s);
  const r = s.summary(), expected = Array(31).fill(0);
  expected[5] = expected[6] = expected[7] = expected[8] = 0.5;
  assert.deepEqual(r['occupancy-profile'], expected);
  const rmse = Math.sqrt(expected.reduce((a, x, i) => a + (x - seed[i].mean) ** 2, 0) / 31);
  assert(Math.abs(r['profile-rmse'] - rmse) < 1e-12);
});
test('every browser reporter is a BehaviorSpace metric in each experiment', () => {
  const xml = fs.readFileSync(path.join(root, 'netlogo/experiments.xml'), 'utf8');
  const keys = Object.keys(create().summary());
  for (const block of xml.split('<experiment ').slice(1)) for (const key of keys) assert(block.includes(`<metric>${key}</metric>`), key);
});

// ---------- Decision rule switch and predictor scale ----------
test('legacy predictor constant scales with population, utility with capacity', () => {
  assert.equal(G.predict([0.5, 1], [10], 100), 60);
  assert.equal(G.predictorScale({ decisionRule: 'legacy', agentCount: 400, capacity: 37 }), 400);
  assert.equal(G.predictorScale({ decisionRule: 'utility', agentCount: 400, capacity: 37 }), 37);
  for (const [decisionRule, expected] of [['legacy', 200], ['utility', 18.5]]) {
    const s = create({ agentCount: 400, capacity: 37, mode: 'none', memory: 1, decisionRule });
    for (const a of s.agents) a.strategies = [[0.5, 0]];
    s.step();
    assert(s.agents.filter(a => a.prediction !== null).every(a => a.prediction === expected));
  }
});
test('decision rule defaults to utility, is validated, and leaves populations unchanged', () => {
  assert.equal(new G.Simulation(rules, seed, {}).options.decisionRule, 'utility');
  assert.throws(() => create({ decisionRule: 'other' }));
  assert.deepEqual(create({ decisionRule: 'utility', populationSeed: 9 }).profileExport().agents, create({ populationSeed: 9 }).profileExport().agents);
});

// ---------- Utility rule: forecasts, utility, logit choice, outcome learning ----------
const utilityOptions = { ...G.DEFAULTS, agentCount: 100, capacity: 37, mustGo: false, simulationSeed: 7 };
const flexibleAgent = changes => {
  const a = { id: 0, ...agent({ availability: 2, preference: 3, flexibility: 3, crowding: 0 }), reinforcement: Array(31).fill(0), forecasts: Array(31).fill(0), ...changes };
  a.allowedStarts ||= G.allowedStarts(a, rules, 2);
  a.tiePriorities = Array.from({ length: 31 }, (_, i) => i / 31);
  return a;
};
const utilitySim = options => new G.Simulation(rules, seed, { maxDays: 1, burnIn: 0, decisionRule: 'utility', ...options });

test('utility rule forecasts every allowed start at day start from past history only', () => {
  const s = utilitySim({ agentCount: 50, mode: 'live', memory: 5, maxDays: 2, populationSeed: 4, simulationSeed: 100004 });
  const before = s.slotHistories.map(h => [...h]);
  s.step();
  const atStart = s.agents.map(a => [...a.forecasts]);
  for (const a of s.agents) for (const slot of a.allowedStarts) assert.equal(a.forecasts[slot], G.currentPrediction(a, before[slot], s.options));
  for (let i = 1; i < 31; i++) s.step(); // today's counts enter the histories...
  assert.deepEqual(s.agents.map(a => a.forecasts), atStart); // ...but not today's forecasts
  const endOfDay1 = s.slotHistories.map(h => [...h]);
  s.step(); // day 2 recomputes from the histories as they stood at the end of day 1
  for (const a of s.agents) for (const slot of a.allowedStarts) assert.equal(a.forecasts[slot], G.currentPrediction(a, endOfDay1[slot], s.options));
});
test('information changes only the current-slot estimate', () => {
  const runs = Object.fromEntries(['none', 'live', 'delayed'].map(mode => [mode, utilitySim({ mode, memory: 5, populationSeed: 2, simulationSeed: 100002 })]));
  for (let slot = 0; slot < 6; slot++) for (const s of Object.values(runs)) s.step();
  assert.deepEqual(runs.none.agents.map(a => a.forecasts), runs.live.agents.map(a => a.forecasts));
  assert.deepEqual(runs.none.agents.map(a => a.forecasts), runs.delayed.agents.map(a => a.forecasts));
  let checked = 0;
  for (const [s, lag] of [[runs.live, 1], [runs.delayed, 2]]) for (const a of s.agents) {
    if (!a.allowedStarts.includes(5) || (a.decided && a.startSlot !== 5)) continue;
    assert.equal(a.prediction, 0.5 * a.forecasts[5] + 0.5 * s.todayAttendance[5 - lag]); checked++;
  }
  for (const a of runs.none.agents) if (a.allowedStarts.includes(5) && !(a.decided && a.startSlot !== 5)) assert.equal(a.prediction, a.forecasts[5]);
  assert(checked > 0);
});
test('utility weights follow the written formula', () => {
  const a = flexibleAgent({ crowding: 1, preference: 0, flexibility: 1 }); // busy-liker, morning, 3-hour flexibility
  const o = { ...utilityOptions, outcomeLearning: true };
  a.reinforcement[14] = 0.4;
  const x = 33.3 / 37, penalty = ((x - 0.8) / 0.2) ** 2, timeCost = 120 / 180; // 13:30 is 120 minutes past the last morning start (11:30)
  assert(Math.abs(G.choiceUtility(a, 14, 33.3, o, rules) - (1 - penalty + 0.25 * x - 0.5 * timeCost + 0.5 * 0.4)) < 1e-12);
  assert.equal(G.crowdingPenalty(0.8, 0.8), 0); assert.equal(G.crowdingPenalty(1, 0.8), 1);
  assert.equal(G.choiceUtility(flexibleAgent(), 5, -10, utilityOptions, rules), 1); // estimates are clipped at zero
});
test('busy-likers peak below capacity; the steep limit recovers the threshold rule', () => {
  const busy = flexibleAgent({ crowding: 1 });
  let bestX = 0, bestU = -Infinity;
  for (let i = 0; i <= 1500; i++) { const x = i / 1000, u = G.choiceUtility(busy, 5, x * 37, utilityOptions, rules); if (u > bestU) { bestU = u; bestX = x; } }
  assert(bestX > 0.8 && bestX < 0.81, `busy optimum at ${bestX}`);
  const steep = { ...utilityOptions, comfortThreshold: 0.999, crowdPenalty: 1000, temperature: 0 };
  for (const crowding of [0, 1, 2]) {
    assert(G.choiceUtility(flexibleAgent({ crowding }), 5, 36, steep, rules) > 0);
    assert(G.choiceUtility(flexibleAgent({ crowding }), 5, 38, steep, rules) < 0);
  }
});
test('zero temperature is argmax with tie priorities and a skip option', () => {
  const o = { ...utilityOptions, temperature: 0 };
  const a = flexibleAgent({ allowedStarts: [3, 4, 5] });
  assert.deepEqual(G.utilityDecision(a, 3, 0, 1, o, rules), { go: false, best: 5 }); // equal utilities: highest tie priority wins
  a.forecasts[4] = a.forecasts[5] = 40;
  assert.deepEqual(G.utilityDecision(a, 3, 0, 1, o, rules), { go: true, best: 3 });
  assert.deepEqual(G.utilityDecision(a, 3, 40, 1, o, rules), { go: false, best: -1 }); // every slot over capacity: skip is best
  assert.deepEqual(G.utilityDecision(a, 5, 40, 1, { ...o, mustGo: true }, rules), { go: true, best: 5 }); // must-go at the last allowed start
  const tiny = { ...utilityOptions, temperature: 1e-6 };
  a.forecasts[4] = 32; a.forecasts[5] = 40; // U(4) < U(3) = 1: going now is the unique argmax
  for (let day = 1; day <= 50; day++) assert.equal(G.utilityDecision(a, 3, 20, day, tiny, rules).go, true);
  a.forecasts[4] = 10; // now U(4) = 1 > U(3), the current slot being crowded
  for (let day = 1; day <= 50; day++) assert.equal(G.utilityDecision(a, 3, 32, day, tiny, rules).go, false);
  assert.equal(G.utilityDecision(a, 3, 32, 1, o, rules).go, false);
});
test('choice draws are reproducible, uniform and uncorrelated across agents, days and slots', () => {
  assert.equal(G.mulmod(2147483646, 2147483646), 1); // (-1)^2 mod p
  assert.equal(G.mulmod(123456789, 987654321), Number((123456789n * 987654321n) % 2147483647n));
  const draws = [];
  for (let agentId = 0; agentId < 100; agentId++) for (let day = 1; day <= 10; day++) for (let slot = 0; slot < 31; slot++) draws.push(G.choiceDraw(100001, agentId, day, slot));
  assert.equal(G.choiceDraw(100001, 5, 3, 7), draws[5 * 310 + 2 * 31 + 7]);
  const bins = Array(10).fill(0); draws.forEach(u => { assert(u >= 0 && u < 1); bins[Math.floor(u * 10)]++; });
  const expected = draws.length / 10, chi2 = bins.reduce((s, b) => s + (b - expected) ** 2 / expected, 0);
  assert(chi2 < 27.9, `chi-square ${chi2}`); // 9 df, p = 0.001
  const corr = (xs, ys) => { const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length; let n = 0, dx = 0, dy = 0; xs.forEach((x, i) => { n += (x - mx) * (ys[i] - my); dx += (x - mx) ** 2; dy += (ys[i] - my) ** 2; }); return n / Math.sqrt(dx * dy); };
  const nextSlot = draws.map((u, i) => [u, draws[i + 1]]).filter((_, i) => i % 31 !== 30);
  const nextAgent = draws.slice(0, -310).map((u, i) => [u, draws[i + 310]]);
  for (const pairs of [nextSlot, nextAgent]) assert(Math.abs(corr(pairs.map(p => p[0]), pairs.map(p => p[1]))) < 0.05);
  assert.notEqual(G.choiceDraw(1, 0, 1, 0), G.choiceDraw(2, 0, 1, 0));
});
test('slot-by-slot logit decisions reproduce one logit choice over the whole day', () => {
  const o = { ...utilityOptions, temperature: 0.2 };
  const a = flexibleAgent({ allowedStarts: [2, 3, 6, 9, 12] });
  [10, 30, 34, 20, 45].forEach((f, i) => { a.forecasts[a.allowedStarts[i]] = f; });
  const utilities = a.allowedStarts.map(s => G.choiceUtility(a, s, a.forecasts[s], o, rules));
  const weights = [...utilities, 0].map(u => Math.exp(u / o.temperature)), total = weights.reduce((x, y) => x + y);
  const counts = Array(6).fill(0), days = 20000;
  for (let day = 1; day <= days; day++) {
    const chosen = a.allowedStarts.findIndex(s => G.utilityDecision(a, s, a.forecasts[s], day, o, rules).go);
    counts[chosen < 0 ? 5 : chosen]++;
  }
  counts.forEach((c, i) => assert(Math.abs(c / days - weights[i] / total) < 0.012, `option ${i}: ${c / days} vs ${weights[i] / total}`));
});
test('outcome learning updates only the visited slot, and only when switched on', () => {
  for (const outcomeLearning of [false, true]) {
    const s = utilitySim({ agentCount: 2, capacity: 1, mode: 'none', memory: 1, maxDays: 2, temperature: 0, outcomeLearning });
    s.agents.forEach(a => { a.allowedStarts = [5]; a.preference = 3; a.strategies = [[-1, 0]]; });
    runDay(s);
    assert.equal(s.metrics.good, 0); // both crowd slot 5
    assert.deepEqual(s.agents[0].reinforcement.filter((_, i) => i !== 5), Array(30).fill(0));
    assert(Math.abs(s.agents[0].reinforcement[5] - (outcomeLearning ? -0.2 : 0)) < 1e-12);
    runDay(s);
    assert(Math.abs(s.agents[0].reinforcement[5] - (outcomeLearning ? -0.36 : 0)) < 1e-12);
  }
});
test('utility rule keeps visit accounting consistent and is reproducible', () => {
  const make = () => utilitySim({ agentCount: 150, mode: 'delayed', memory: 5, maxDays: 4, populationSeed: 6, simulationSeed: 100006, outcomeLearning: true });
  const s = make(), t = make();
  while (!s.done) {
    const slotsIn = new Map();
    for (let i = 0; i < 31; i++) { s.step(); t.step(); for (const a of s.agents) if (a.attending) slotsIn.set(a.id, (slotsIn.get(a.id) || 0) + 1); }
    for (const a of s.agents) { assert([0, 2].includes(slotsIn.get(a.id) || 0)); assert.notEqual(a.wentToday, a.skippedToday); }
  }
  assert.deepEqual(s.history, t.history);
  assert.equal(s.metrics.visits + s.metrics.skips, s.metrics.agentDays);
  assert.equal(s.history.reduce((a, b) => a + b, 0), 2 * s.metrics.visits);
});
test('invalid utility settings are rejected', () => {
  for (const bad of [{ comfortThreshold: 1 }, { temperature: -0.1 }, { learningRate: 1.5 }, { crowdPenalty: NaN }]) assert.throws(() => utilitySim(bad));
});

// ---------- Recency-weighted strategy error, seed scaling, capacity ratio, profile mix ----------
test('recency decay reweights strategy error toward recent days; 1 keeps equal weights', () => {
  // Constant-only strategies (c = 1 and 1.4) on capacity 10 predict 10 and 14.
  const a = { strategies: [[1, 0, 0], [1.4, 0, 0]] };
  const history = [10, 20, 0, 0];
  const base = { memory: 2, decisionRule: 'utility', capacity: 10, agentCount: 100 };
  assert.equal(G.currentPrediction(a, history, { ...base, recencyDecay: 1 }), 14); // errors tie 10 vs 10: later strategy kept
  assert.equal(G.currentPrediction(a, history, base), 14); // option absent = 1
  assert.equal(G.currentPrediction(a, history, { ...base, recencyDecay: 0.5 }), 10); // 0 + 0.5*10 beats 4 + 0.5*6
  assert.throws(() => utilitySim({ recencyDecay: 0 }));
});
test('seed history: every slot has four shrunk weekday values; sparse slots are flagged', () => {
  const rows = fs.readFileSync(path.join(root, 'netlogo/seed_history.csv'), 'utf8').trim().split(/\r?\n/).map(l => l.split(','));
  const header = rows.shift();
  for (const series of seed) assert.equal(series.length, 4);
  const at = (row, name) => row[header.indexOf(name)];
  assert.equal(at(rows[0], 'n_obs'), '0'); assert.equal(at(rows[0], 'filled'), 'True');
  for (const row of rows) assert.equal(at(row, 'friday_scaled'), '');
  // Capacity-anchored scale: no slot mean is implausibly far from the capacity scale.
  assert(seed.every(s => s.mean > 5 && s.mean < 37));
});
test('seed values and real curve scale with N relative to the reference population', () => {
  const text = fs.readFileSync(path.join(root, 'netlogo/seed_history.csv'), 'utf8').replace(/\r/g, '');
  const [head, ...lines] = text.trim().split('\n'), refIndex = head.split(',').indexOf('reference_n');
  const withRef = [head, ...lines.map(l => { const c = l.split(','); c[refIndex] = '200'; return c.join(','); })].join('\n');
  const scaled = G.parseSeedHistory(withRef);
  assert.equal(scaled.referenceN, 200);
  const on = new G.Simulation(rules, scaled, { agentCount: 100, memory: 1 }), off = new G.Simulation(rules, scaled, { agentCount: 100, memory: 1, scaleSeedWithN: false });
  assert.equal(on.seedFactor, 0.5); assert.equal(off.seedFactor, 1);
  assert.equal(on.slotHistories[10][0], scaled[10][0] * 0.5); assert.equal(off.slotHistories[10][0], scaled[10][0]);
  assert.equal(on.realProfile[10], scaled[10].mean * 0.5);
});
test('capacity can be set as a percentage of the population', () => {
  assert.equal(utilitySim({ agentCount: 400, capacityFromRatio: true, capacityRatio: 9.25 }).options.capacity, 37);
  assert.equal(utilitySim({ agentCount: 200, capacityFromRatio: true, capacityRatio: 9.25 }).options.capacity, 19);
  assert.equal(utilitySim({ agentCount: 400, capacity: 50, capacityRatio: 9.25 }).options.capacity, 50); // switch off: slider value
});
test('demand-weighted profile mix allocates cells by largest remainder', () => {
  const mix = G.parseProfileMix(fs.readFileSync(path.join(root, 'web/profile-mix.csv'), 'utf8'));
  assert.equal(mix.length, 16); assert(Math.abs(mix.reduce((a, b) => a + b) - 1) < 1e-12);
  assert.deepEqual(G.mixCellCounts([0.5, 0.3, 0.2], 7), [4, 2, 1]); // quotas 3.5, 2.1, 1.4
  assert.deepEqual(G.mixCellCounts([0.25, 0.25, 0.25, 0.25], 6), [2, 2, 1, 1]); // tied remainders: lower cell first
  const weightedRules = { ...rules, mix };
  for (const N of [100, 377]) {
    const counts = G.mixCellCounts(mix, N);
    assert.equal(counts.reduce((a, b) => a + b), N);
    const pop = new G.Simulation(weightedRules, seed, { agentCount: N, profileMix: 'demand-weighted', populationSeed: 5 }).agents;
    assert.deepEqual(Array.from({ length: 16 }, (_, c) => pop.filter(a => a.availability * 4 + a.preference === c).length), counts);
    assert.deepEqual([0, 1, 2, 3].map(f => pop.filter(a => a.flexibility === f).length), [0, 1, 2, 3].map(f => Math.floor(N / 4) + (f < N % 4 ? 1 : 0)));
  }
  const again = new G.Simulation(weightedRules, seed, { profileMix: 'demand-weighted', populationSeed: 5 }).profileExport().agents;
  assert.deepEqual(new G.Simulation(weightedRules, seed, { profileMix: 'demand-weighted', populationSeed: 5 }).profileExport().agents, again);
  assert.throws(() => new G.Simulation(rules, seed, { profileMix: 'demand-weighted' }));
});

// ---------- Browser controls mirror NetLogo globals ----------
test('every browser control is a NetLogo global with the same default', () => {
  const { CONTROLS } = require('../web/controls.js');
  const xml = fs.readFileSync(path.join(root, 'netlogo/GymElFarol.nlogox'), 'utf8');
  const widgets = {};
  for (const [, tag, attrs, body] of xml.matchAll(/<(slider|switch|chooser|input)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const attr = name => (attrs.match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1];
    const variable = attr('variable');
    if (!variable) continue;
    if (tag === 'slider') widgets[variable] = Number(attr('default'));
    else if (tag === 'switch') widgets[variable] = attr('on') === 'true';
    else if (tag === 'input') widgets[variable] = Number(body.trim());
    else widgets[variable] = [...body.matchAll(/value="([^"]*)"/g)].map(m => m[1])[Number(attr('current'))];
  }
  const unmapped = CONTROLS.filter(c => !c.netlogo).map(c => c.option);
  assert.deepEqual(unmapped, ['maxDays']); // BehaviorSpace timeLimit, not a global
  for (const c of CONTROLS.filter(c => c.netlogo)) {
    assert(c.netlogo in widgets, `${c.netlogo} is not a NetLogo widget`);
    assert(c.option in G.DEFAULT_OPTIONS, `${c.option} is not a Simulation option`);
    assert.deepEqual(widgets[c.netlogo], G.DEFAULT_OPTIONS[c.option], `default of ${c.netlogo}`);
    if (c.type === 'select') assert.deepEqual(c.choices.map(([v]) => v).sort(), [...xml.match(new RegExp(`variable="${c.netlogo}"[\\s\\S]*?</chooser>`))[0].matchAll(/value="([^"]*)"/g)].map(m => m[1]).sort());
    if (c.type === 'range') assert(c.min <= G.DEFAULT_OPTIONS[c.option] && G.DEFAULT_OPTIONS[c.option] <= c.max, `${c.option} default outside the browser range`);
  }
  assert.equal(new Set(CONTROLS.map(c => c.option)).size, CONTROLS.length);
});
