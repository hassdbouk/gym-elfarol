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
