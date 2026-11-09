const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../web/simulation.js');
const root = path.resolve(__dirname, '..');
const rules = G.parseRules(fs.readFileSync(path.join(root, 'web/profile-rules.csv'), 'utf8'));
const seed = G.parseSeedHistory(fs.readFileSync(path.join(root, 'netlogo/seed_history.csv'), 'utf8'));
const create = options => new G.Simulation(rules, seed, { maxDays: 1, burnIn: 0, ...options });
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
  assert.equal(seed[0].mean, 10.48); assert.equal(seed[30].mean, 26.23);
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
test('decision rule defaults to legacy, is validated, and leaves populations unchanged', () => {
  assert.equal(create().options.decisionRule, 'legacy');
  assert.throws(() => create({ decisionRule: 'other' }));
  assert.deepEqual(create({ decisionRule: 'utility', populationSeed: 9 }).profileExport().agents, create({ populationSeed: 9 }).profileExport().agents);
});
