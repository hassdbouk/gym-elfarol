/* Browser controls. Each control sets one Simulation option, and each option is a NetLogo
 * global with the name in `netlogo`, so the browser has no UI-only model behaviour
 * (tests/simulation.test.js checks this against GymElFarol.nlogox). The only exception
 * is maxDays, which corresponds to the BehaviorSpace timeLimit (days x 31 ticks).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GymControls = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  // type: range (slider + number box), number, select, checkbox. group: where it is shown.
  const CONTROLS = [
    { option: "mode", netlogo: "info-mode", group: "basic", type: "select", label: "Information shown to agents", help: "None: memory only. Live: the count from 30 minutes ago. Delayed: the count from `delay` slots ago.", choices: [["none", "None"], ["live", "Live"], ["delayed", "Delayed"]] },
    { option: "agentCount", netlogo: "n-agents", group: "basic", type: "range", min: 20, max: 1000, step: 5, label: "Agents", help: "Population size. Calibrated to 340." },
    { option: "capacity", netlogo: "capacity", group: "basic", type: "range", min: 5, max: 500, step: 1, label: "Capacity", help: "Occupancy above this makes every visit in that slot a bad visit." },
    { option: "capacityFromRatio", netlogo: "capacity-from-ratio?", group: "basic", type: "checkbox", label: "Set capacity as % of agents", help: "Keeps the calibrated capacity/agents ratio when you change the population." },
    { option: "capacityRatio", netlogo: "capacity-ratio", group: "basic", type: "number", min: 1, max: 50, step: 0.01, label: "Capacity (% of agents)", help: "Used only when the box above is ticked. Calibrated: 10.88%." },
    { option: "memory", netlogo: "memory-size", group: "basic", type: "range", min: 1, max: 10, step: 1, label: "Memory (days)", help: "Past days each agent remembers per slot." },
    { option: "delay", netlogo: "delay", group: "basic", type: "range", min: 1, max: 6, step: 1, label: "Delay (slots)", help: "How old the delayed count is, in 30-minute slots." },
    { option: "maxDays", netlogo: null, group: "basic", type: "number", min: 1, max: 365, step: 1, label: "Days to simulate", help: "BehaviorSpace runs use 50." },
    { option: "burnIn", netlogo: "burn-in-days", group: "basic", type: "number", min: 0, max: 100, step: 1, label: "Burn-in days", help: "Days left out of the results." },
    { option: "populationSeed", netlogo: "population-seed", group: "basic", type: "number", min: 0, max: 2147483646, step: 1, label: "Population seed", help: "Which agents (profiles) are drawn." },
    { option: "simulationSeed", netlogo: "simulation-seed", group: "basic", type: "number", min: 0, max: 2147483646, step: 1, label: "Strategy seed", help: "Forecasting strategies and choice draws." },

    { option: "decisionRule", netlogo: "decision-rule", group: "utility", type: "select", label: "Decision rule", help: "Utility: the new rule below. Legacy: the original threshold rule, kept for comparison.", choices: [["utility", "Utility (new)"], ["legacy", "Legacy"]] },
    { option: "workoutValue", netlogo: "workout-value", group: "utility", type: "range", min: 0, max: 3, step: 0.05, label: "Value of a good workout (V)", help: "Staying home is worth 0." },
    { option: "crowdPenalty", netlogo: "crowd-penalty", group: "utility", type: "range", min: 0, max: 5, step: 0.05, label: "Crowding penalty (wP)", help: "Paid by everyone as the forecast nears and passes capacity." },
    { option: "comfortThreshold", netlogo: "comfort-threshold", group: "utility", type: "range", min: 0, max: 0.95, step: 0.01, label: "Crowding starts to hurt at (share of capacity)", help: "Below this share of capacity there is no penalty." },
    { option: "timeWeight", netlogo: "time-weight", group: "utility", type: "range", min: 0, max: 3, step: 0.05, label: "Cost of an off-preference time (wT)", help: "Cost of starting at the edge of the agent's flexibility." },
    { option: "tasteWeight", netlogo: "taste-weight", group: "utility", type: "range", min: 0, max: 1, step: 0.05, label: "Busy/quiet taste (wC)", help: "How much 'likes it busy' and 'likes it empty' agents care, below capacity." },
    { option: "temperature", netlogo: "choice-temperature", group: "utility", type: "range", min: 0, max: 1, step: 0.01, label: "Choice randomness (temperature)", help: "0 always picks the best slot; higher values spread choices." },
    { option: "outcomeLearning", netlogo: "outcome-learning?", group: "utility", type: "checkbox", label: "Learn from good and bad visits", help: "Off keeps the plain El Farol baseline." },
    { option: "learningRate", netlogo: "learning-rate", group: "utility", type: "range", min: 0, max: 1, step: 0.05, label: "Learning rate", help: "How quickly a slot's learned value moves after a visit." },
    { option: "learningWeight", netlogo: "learning-weight", group: "utility", type: "range", min: 0, max: 2, step: 0.05, label: "Weight of learned value (wR)", help: "Only used when learning is on." },
    { option: "recencyDecay", netlogo: "recency-decay", group: "utility", type: "range", min: 0.05, max: 1, step: 0.05, label: "Trust in recent days (recency decay)", help: "1 weighs all remembered days equally; lower values favour recent days when picking a forecasting strategy." },

    { option: "strategies", netlogo: "number-strategies", group: "data", type: "range", min: 1, max: 20, step: 1, label: "Forecasting strategies per agent", help: "Size of each agent's bag of linear predictors." },
    { option: "profileMix", netlogo: "profile-mix", group: "data", type: "select", label: "Population mix", help: "Balanced: equal groups. Demand-weighted: fitted to the real daily curve (robustness check).", choices: [["balanced", "Balanced"], ["demand-weighted", "Demand-weighted"]] },
    { option: "scaleSeedWithN", netlogo: "scale-seed-with-n?", group: "data", type: "checkbox", label: "Scale seed history with population", help: "Keeps per-agent demand when the population is not 340." },
    { option: "mustGo", netlogo: "must-go?", group: "data", type: "checkbox", label: "Must go (at the last allowed start)", help: "Removes the option to skip at an agent's last allowed start." },
  ];
  return { CONTROLS };
});
