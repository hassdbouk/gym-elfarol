extensions [ csv ]

;; Gym El Farol -- slot-based gym crowding model.
;; Strategy machinery (random-strategy, predict-attendance, update-strategies)
;; is copied unchanged from IABM chapter 3 El Farol (Rand & Wilensky 2007).
;; Decision rule, information, and memory are the gym extension:
;;   each tick = one 30-min evening slot (12 slots = one weekday, 16:00-22:00);
;;   each agent wants one workout per day and chooses a slot or skips;
;;   history is kept per slot, in days; info-mode adds intra-day counts.

globals [
  attendance            ;; occupancy of the current slot (original name)
  history               ;; history of the slot now being decided (original name)
  slot-histories        ;; list of n-slots histories, each length memory-size * 2
  today-attendance      ;; occupancies already observed today
  current-slot          ;; 0 .. n-slots - 1
  current-day           ;; 1-based day counter
  n-slots               ;; evening slots in a day (12)
  slot-labels           ;; ["16:00" "16:30" ... "21:30"]
  seed-means            ;; list of per-slot series used to seed memory
  home-patches
  gym-patches
  crowded-patch
  clock-patch
  ;; post-burn-in accumulators for BehaviorSpace reporters
  all-slot-attendance
  n-slots-over
  n-slots-recorded
  n-good-visits
  n-visits
  n-skips
  n-agent-days
  peak-so-far
]

turtles-own [
  strategies            ;; bag of linear predictors (original)
  best-strategy         ;; currently selected strategy (original)
  attend?               ;; going to the gym this slot? (original)
  prediction            ;; predicted occupancy of this slot (original)
  decided?              ;; already went or skipped today
  went-today?
  skipped-today?
  good-visit?           ;; went and the chosen slot was at or under capacity
]

to setup
  clear-all
  set-default-shape turtles "person"
  set n-slots 12
  set slot-labels [ "16:00" "16:30" "17:00" "17:30" "18:00" "18:30"
                    "19:00" "19:30" "20:00" "20:30" "21:00" "21:30" ]
  set current-slot 0
  set current-day 0
  set attendance 0
  set today-attendance []
  set all-slot-attendance []
  set n-slots-over 0
  set n-slots-recorded 0
  set n-good-visits 0
  set n-visits 0
  set n-skips 0
  set n-agent-days 0
  set peak-so-far 0

  set home-patches patches with [ pycor < 0 or (pxcor < 0 and pycor >= 0) ]
  ask home-patches [ set pcolor green ]
  set gym-patches patches with [ pxcor > 0 and pycor > 0 ]
  ask gym-patches [ set pcolor blue ]

  load-seed-means
  set slot-histories map [ m -> make-slot-history m ] seed-means
  set history first slot-histories

  ask patch (0.75 * max-pxcor) (0.50 * max-pycor) [
    set crowded-patch self
    set plabel-color yellow
  ]
  ask patch (0.75 * max-pxcor) (0.75 * max-pycor) [
    set clock-patch self
    set plabel-color white
    set plabel first slot-labels
  ]

  create-turtles n-agents [
    set color white
    set decided? false
    set went-today? false
    set skipped-today? false
    set good-visit? false
    set attend? false
    set prediction 0
    move-to-empty-one-of home-patches
    set strategies n-values number-strategies [ random-strategy ]
    set best-strategy first strategies
    update-strategies
  ]
  reset-ticks
end

to go
  set current-slot ticks mod n-slots
  if current-slot = 0 [
    start-new-day
  ]
  if visualize? [
    ask crowded-patch [ set plabel "" ]
    ask clock-patch [ set plabel item current-slot slot-labels ]
  ]

  ;; swap this slot's per-day history into the original global so the
  ;; unchanged strategy procedures can see it
  set history item current-slot slot-histories

  ask turtles with [ not decided? ] [
    update-strategies
    set prediction predict-attendance best-strategy sublist history 0 memory-size
    set prediction apply-info-signal prediction
    ifelse prediction <= capacity [
      set attend? true
      set decided? true
      set went-today? true
    ] [
      set attend? false
    ]
  ]

  if current-slot = n-slots - 1 [
    ask turtles with [ not decided? ] [
      ifelse must-go? [
        set attend? true
        set went-today? true
      ] [
        set attend? false
        set skipped-today? true
      ]
      set decided? true
    ]
  ]

  ;; Patch movement is display-only. BehaviorSpace turns visualize? off so
  ;; the 3x3 / 30-seed grids are not dominated by empty-patch searches.
  if visualize? [
    ask turtles [
      ifelse attend?
        [ move-to-empty-one-of gym-patches ]
        [ move-to-empty-one-of home-patches ]
      update-color
    ]
  ]

  set attendance count turtles with [ attend? ]
  let over? attendance > capacity
  ask turtles with [ attend? ] [
    set good-visit? not over?
  ]
  if visualize? and over? [
    ask crowded-patch [ set plabel "CROWDED" ]
  ]

  set history fput attendance but-last history
  set slot-histories replace-item current-slot slot-histories history
  set today-attendance lput attendance today-attendance
  record-metrics over?
  tick
end

to go-day
  repeat n-slots [ go ]
end

to start-new-day
  set current-day current-day + 1
  set today-attendance []
  ask turtles [
    set decided? false
    set went-today? false
    set skipped-today? false
    set good-visit? false
    set attend? false
    if visualize? [
      set color white
      move-to-empty-one-of home-patches
    ]
  ]
end

;; Intra-day information is blended with the inductive per-slot prediction.
;; none:    inductive prediction only (classic El Farol, that slot's past days)
;; live:    also see the actual count of the previous slot today
;; delayed: also see the count from `delay` slots ago (default 2 = 1 hour)
to-report apply-info-signal [base]
  if info-mode = "none" [ report base ]
  if current-slot = 0 [ report base ]
  if info-mode = "live" [
    report 0.5 * base + 0.5 * last today-attendance
  ]
  if info-mode = "delayed" [
    if current-slot < delay [ report base ]
    report 0.5 * base + 0.5 * item (current-slot - delay) today-attendance
  ]
  report base
end

to record-metrics [over?]
  if current-day <= burn-in-days [ stop ]
  set all-slot-attendance lput attendance all-slot-attendance
  set n-slots-recorded n-slots-recorded + 1
  if over? [ set n-slots-over n-slots-over + 1 ]
  if attendance > peak-so-far [ set peak-so-far attendance ]
  if current-slot = n-slots - 1 [
    set n-agent-days n-agent-days + count turtles
    set n-skips n-skips + count turtles with [ skipped-today? ]
    set n-visits n-visits + count turtles with [ went-today? ]
    set n-good-visits n-good-visits + count turtles with [ good-visit? ]
  ]
end

to update-color  ;; turtle procedure
  if attend? [ set color orange stop ]
  if went-today? [ set color yellow stop ]
  if skipped-today? [ set color gray stop ]
  set color white
end

to-report make-slot-history [slot-series]
  ifelse seed-from-data? [
    report cycle-fill slot-series (memory-size * 2)
  ] [
    report n-values (memory-size * 2) [ random n-agents ]
  ]
end

;; seed_history.csv is exported from data/params.json (demand_curve / seed_history)
;; by analysis/calibrate.py. NetLogo cannot read JSON, so the csv extension is the
;; bridge the plan asked for. Each row is one slot; weekday_scaled columns are
;; successive "past days" cycled into that slot's memory.
to load-seed-means
  ;; fallback = scaled weekday-pooled means from params.json seed_history
  set seed-means map [ m -> (list m) ] [ 27.97 30.58 30.05 31.32 28.80 28.78 26.72 25.80 24.59 26.87 22.70 26.23 ]
  let path seed-file-path
  if path = "" [ stop ]
  let rows csv:from-file path
  if length rows < 2 [ stop ]
  let header first rows
  let mean-col position "mean_occupancy_scaled" header
  if not is-number? mean-col [ stop ]
  let weekday-cols []
  foreach [ "monday_scaled" "tuesday_scaled" "wednesday_scaled" "thursday_scaled" "friday_scaled" ] [ name ->
    let col position name header
    if is-number? col [
      set weekday-cols lput col weekday-cols
    ]
  ]
  let loaded []
  foreach but-first rows [ row ->
    let series []
    foreach weekday-cols [ col ->
      if length row > col [
        let v coerce-number-or-none item col row
        if is-number? v [
          set series lput v series
        ]
      ]
    ]
    if empty? series and length row > mean-col [
      let v coerce-number-or-none item mean-col row
      if is-number? v [
        set series lput v series
      ]
    ]
    if not empty? series [
      set loaded lput series loaded
    ]
  ]
  if not empty? loaded [
    set seed-means pad-or-trim loaded n-slots
  ]
end

to-report seed-file-path
  ;; GUI uses the model directory; headless often uses the project root.
  if file-exists? "seed_history.csv" [
    report "seed_history.csv"
  ]
  if file-exists? "netlogo/seed_history.csv" [
    report "netlogo/seed_history.csv"
  ]
  if file-exists? "../data/processed/demand_curve.csv" [
    report "../data/processed/demand_curve.csv"
  ]
  if file-exists? "data/processed/demand_curve.csv" [
    report "data/processed/demand_curve.csv"
  ]
  report ""
end

to-report pad-or-trim [xs n]
  if empty? xs [ report xs ]
  if length xs >= n [ report sublist xs 0 n ]
  report sentence xs n-values (n - length xs) [ last xs ]
end

to-report cycle-fill [xs n]
  if empty? xs [ report n-values n [ 0 ] ]
  let k length xs
  let out []
  let i 0
  repeat n [
    set out lput item (i mod k) xs out
    set i i + 1
  ]
  report out
end

to-report coerce-number [v]
  let parsed coerce-number-or-none v
  ifelse is-number? parsed [ report parsed ] [ report 0 ]
end

to-report coerce-number-or-none [v]
  if is-number? v [ report v ]
  if is-string? v [
    if v = "" or v = "null" or v = "None" [ report false ]
    let parsed 0
    let ok? true
    carefully [ set parsed read-from-string v ] [ set ok? false ]
    if ok? and is-number? parsed [ report parsed ]
    report false
  ]
  report false
end

;; ---------- BehaviorSpace reporters (post burn-in) ----------

to-report peak-occupancy
  report peak-so-far
end

to-report pct-slots-over-capacity
  if n-slots-recorded = 0 [ report 0 ]
  report 100 * n-slots-over / n-slots-recorded
end

to-report occupancy-variance
  if not is-list? all-slot-attendance [ report 0 ]
  if length all-slot-attendance < 2 [ report 0 ]
  let mu mean all-slot-attendance
  report mean map [ x -> (x - mu) * (x - mu) ] all-slot-attendance
end

to-report good-visit-rate
  if n-visits = 0 [ report 0 ]
  report n-good-visits / n-visits
end

to-report skip-rate
  if n-agent-days = 0 [ report 0 ]
  report n-skips / n-agent-days
end

to-report lag1-autocorr
  if not is-list? all-slot-attendance [ report 0 ]
  if length all-slot-attendance < 3 [ report 0 ]
  let xs but-last all-slot-attendance
  let ys but-first all-slot-attendance
  let mx mean xs
  let my mean ys
  let num sum (map [ [ x y ] -> (x - mx) * (y - my) ] xs ys)
  let ss-x sum map [ x -> (x - mx) * (x - mx) ] xs
  let ss-y sum map [ y -> (y - my) * (y - my) ] ys
  if ss-x * ss-y = 0 [ report 0 ]
  report num / sqrt (ss-x * ss-y)
end

to-report current-slot-label
  if not is-list? slot-labels [ report "--" ]
  if current-slot >= length slot-labels [ report "--" ]
  report item current-slot slot-labels
end

;; ---------- original El Farol strategy machinery (unchanged) ----------

;; determines which strategy would have predicted the best results had it been used this round.
;; the best strategy is the one that has the sum of smallest differences between the
;; current attendance and the predicted attendance for each of the preceding
;; weeks (going back MEMORY-SIZE weeks)
;; this does not change the strategies at all, but it does (potentially) change the one
;; currently being used and updates the performance of all strategies
to update-strategies
  ;; initialize best-score to a maximum, which is the lowest possible score
  let best-score memory-size * 100 + 1
  foreach strategies [ the-strategy ->
    let score 0
    let week 1
    repeat memory-size [
      set prediction predict-attendance the-strategy sublist history week (week + memory-size)
      set score score + abs (item (week - 1) history - prediction)
      set week week + 1
    ]
    if (score <= best-score) [
      set best-score score
      set best-strategy the-strategy
    ]
  ]
end

;; this reports a random strategy. a strategy is just a set of weights from -1.0 to 1.0 which
;; determines how much emphasis is put on each previous time period when making
;; an attendance prediction for the next time period
to-report random-strategy
  report n-values (memory-size + 1) [1.0 - random-float 2.0]
end

;; This reports an agent's prediction of the current attendance
;; using a particular strategy and portion of the attendance history.
;; More specifically, the strategy is then described by the formula
;; p(t) = x(t - 1) * a(t - 1) + x(t - 2) * a(t -2) +..
;;      ... + x(t - MEMORY-SIZE) * a(t - MEMORY-SIZE) + c * 100,
;; where p(t) is the prediction at time t, x(t) is the attendance of the bar at time t,
;; a(t) is the weight for time t, c is a constant, and MEMORY-SIZE is an external parameter.
to-report predict-attendance [strategy subhistory]
  ;; the first element of the strategy is the constant, c, in the prediction formula.
  ;; one can think of it as the the agent's prediction of the bar's attendance
  ;; in the absence of any other data
  ;; then we multiply each week in the history by its respective weight
  report 100 * first strategy + sum (map [ [weight week] -> weight * week ] butfirst strategy subhistory)
end

;; In this model it doesn't really matter exactly which patch
;; a turtle is on, only whether the turtle is in the home area
;; or the gym area.  Nonetheless, to make a nice visualization
;; this procedure is used to ensure that we only have one
;; turtle per patch.
to move-to-empty-one-of [locations]  ;; turtle procedure
  let empties locations with [ not any? turtles-here ]
  ifelse any? empties
    [ move-to one-of empties ]
    [ if any? locations [ move-to one-of locations ] ]
end

; Copyright 2007 Uri Wilensky. Gym-slot extension 2026.
; See Info tab for full copyright and license.
@#$#@#$#@
GRAPHICS-WINDOW
300
10
724
434
-1
-1
12.0
1
14
1
1
1
0
1
1
1
-17
17
-17
17
1
1
1
ticks
30.0

SLIDER
10
10
280
43
n-agents
n-agents
10
200
100.0
1
1
NIL
HORIZONTAL

SLIDER
10
60
280
93
capacity
capacity
1
100
38.0
1
1
NIL
HORIZONTAL

SLIDER
10
110
280
143
memory-size
memory-size
1
10
5.0
1
1
NIL
HORIZONTAL

SLIDER
10
160
280
193
number-strategies
number-strategies
1
20
10.0
1
1
NIL
HORIZONTAL

SLIDER
10
210
280
243
delay
delay
1
6
2.0
1
1
NIL
HORIZONTAL

SLIDER
10
260
280
293
burn-in-days
burn-in-days
0
20
10.0
1
1
NIL
HORIZONTAL

CHOOSER
10
310
280
355
info-mode
info-mode
"none" "live" "delayed"
0

SWITCH
10
375
140
408
must-go?
must-go?
1
1
-1000

SWITCH
150
375
280
408
seed-from-data?
seed-from-data?
0
1
-1000

SWITCH
10
475
140
508
visualize?
visualize?
0
1
-1000

BUTTON
10
425
90
465
setup
setup
NIL
1
T
OBSERVER
NIL
NIL
NIL
NIL
1

BUTTON
100
425
180
465
go
go
T
1
T
OBSERVER
NIL
NIL
NIL
NIL
0

BUTTON
190
425
280
465
go-day
go-day
NIL
1
T
OBSERVER
NIL
NIL
NIL
NIL
0

MONITOR
735
10
875
65
day
current-day
0
1
11

MONITOR
880
10
1020
65
slot
current-slot
0
1
11

MONITOR
735
70
875
125
attendance
attendance
0
1
11

MONITOR
880
70
1020
125
time
current-slot-label
0
1
11

MONITOR
735
130
875
185
peak-occupancy
peak-occupancy
1
1
11

MONITOR
880
130
1020
185
pct-over-cap
pct-slots-over-capacity
1
1
11

MONITOR
735
190
875
245
occupancy-var
occupancy-variance
2
1
11

MONITOR
880
190
1020
245
lag1-autocorr
lag1-autocorr
3
1
11

MONITOR
735
250
875
305
good-visit-rate
good-visit-rate
3
1
11

MONITOR
880
250
1020
305
skip-rate
skip-rate
3
1
11

PLOT
300
445
724
645
Gym occupancy
Slot ticks
Occupancy
0.0
10.0
0.0
100.0
true
true
"" ""
PENS
"occupancy" 1.0 0 -16777216 true "" "plot attendance"
"capacity" 1.0 0 -2674135 true "" "plot-pen-reset\nplotxy 0 capacity\nplotxy plot-x-max capacity"

PLOT
735
315
1020
505
Today by slot
Slot
Occupancy
0.0
12.0
0.0
100.0
false
false
"" ""
PENS
"today" 1.0 1 -13345367 true "" "plot-pen-reset\nif is-list? today-attendance [\n  let i 0\n  foreach today-attendance [ a ->\n    plotxy i a\n    set i i + 1\n  ]\n]"
"capacity" 1.0 0 -2674135 true "" "plot-pen-reset\nplotxy 0 capacity\nplotxy plot-x-max capacity"
@#$#@#$#@
## ACKNOWLEDGMENT

This model extends the IABM Chapter 3 El Farol model:

* Rand, W., Wilensky, U. (2007). NetLogo El Farol model. http://ccl.northwestern.edu/netlogo/models/ElFarol
* Wilensky, U. & Rand, W. (2015). Introduction to Agent-Based Modeling. MIT Press.

The inductive strategy machinery (`random-strategy`, `predict-attendance`, `update-strategies`) is unchanged from that model. The gym-slot decision rule, per-slot memory, and `info-mode` are the extension.

## WHAT IS IT?

Western Student Recreation Centre (WSRC) weight rooms are a shared resource with a capacity. Students want one evening workout and prefer a half-hour that is not overcrowded. They cannot coordinate, and they only see a limited history of past occupancy -- plus, depending on the information condition, a live or delayed count from earlier tonight.

This is Arthur's (1994) El Farol bar problem recast as a **congestion / minority game over K evening slots**. The question the experiments ask is whether publishing live occupancy reduces overcrowding, and whether a delayed feed (the real WSRC page updates every 30 minutes, plus travel time) creates oscillation.

Default parameters (`n-agents` = 100, `capacity` = 38, 12 slots from 16:00 to 22:00) come from `data/params.json`, which scales observed 3WR+4WR counts so that the population is 100 and capacity is the scaled 95th percentile.

## HOW IT WORKS

Each tick is one 30-minute slot. A day is 12 slots. Each agent wants at most one visit per day.

At slot *s*, every agent who has not yet gone or skipped:

1. Swaps that slot's past-day history into the original `history` list.
2. Picks the strategy in its bag with the lowest mean absolute error on that slot (unchanged `update-strategies`).
3. Forms an inductive prediction of tonight's occupancy in slot *s* (unchanged `predict-attendance`).
4. If `info-mode` is `live` or `delayed`, blends that prediction 50/50 with the intra-day signal (previous slot tonight, or the slot `delay` slots ago). Slot 0, and delayed slots before the lag is available, use the inductive prediction only.
5. Goes if the (possibly blended) prediction is at most `capacity`; otherwise waits.

Agents still waiting in the last slot either go anyway (`must-go?` on) or skip (`must-go?` off).

Memory is **per slot, in days**. Each slot stores `memory-size * 2` past occupancies, the extra length needed so a strategy can be scored `memory-size` days back while still seeing a full window. This is the original El Farol bookkeeping, just one list per slot instead of one Thursday list.

If `seed-from-data?` is on, those lists are filled from `seed_history.csv`, which `analysis/calibrate.py` exports from `demand_curve` / `seed_history` in `data/params.json` (NetLogo reads it with the `csv` extension). Weekday-scaled means cycle through each slot's memory so the first few "past days" have real day-to-day shape; if those columns are missing, the pooled slot mean is repeated. If the file is missing, the same pooled means are hard-coded from `params.json`. If the switch is off, history is random in `0 .. n-agents - 1`, as in the original model.

A visit is a **good visit** when the agent went and the slot ended at or under capacity. Skip has payoff 0.

## HOW TO USE IT

Set `info-mode`, `memory-size`, `number-strategies`, and `delay` (used only when `info-mode` is `delayed`; 2 = one hour). Press SETUP, then GO (one slot) or GO-DAY (12 slots).

Colours: white = still deciding, orange = in the gym this slot, yellow = already worked out, gray = skipped. Green patches are home; blue patches are the gym.

Monitors on the right are the BehaviorSpace reporters, computed after `burn-in-days` (default 10):

* `peak-occupancy` -- max slot occupancy after burn-in
* `pct-slots-over-capacity` -- percent of recorded slots with attendance > capacity
* `occupancy-variance` -- variance of recorded slot occupancies
* `good-visit-rate` -- good visits / visits
* `skip-rate` -- skips / agent-days
* `lag1-autocorr` -- Pearson correlation of occupancy at consecutive slots

A typical experiment run is 40 days (480 ticks) with the first 10 days discarded. Import `netlogo/experiments.xml` in BehaviorSpace (or run `python analysis/run_pilot.py`) for the `info-memory-pilot` (5 seeds) and `info-memory-grid` (30 seeds) experiments. Both record the six reporters at the end of each run. Turn `visualize?` off for BehaviorSpace; patch movement is display-only and does not change the reporters.

## THINGS TO NOTICE

Under `none`, this is twelve coupled El Farol games: agents only remember past days of the slot they are considering. Attendance in a slot should wander around capacity once strategies adapt.

Under `live`, a crowded slot should push remaining agents later (or to skip), which can flatten the evening peak.

Under `delayed`, agents react to a stale count. That lagged negative feedback is the candidate mechanism for oscillation (higher occupancy variance; `lag1-autocorr` of the slot series).

## THINGS TO TRY

Compare `info-mode` = none / live / delayed at `memory-size` 1, 5, 10. Turn `must-go?` on to force last-slot attendance. Turn `seed-from-data?` off to recover the original random history.

## FORMAL MODEL

N agents, K = 12 slots, action a_i in {1..K, skip}. Slot payoff u = 1 if n_s <= C, 0 if over, 0 for skip. Agents use inductive prediction with a bag of S linear predictors over the last M days of that slot, choosing the best by MAE -- a congestion/minority game solved by inductive learning (Arthur 1994; Fogel et al. 1999). `info-mode` adds an intra-day observation of n_{s-1} or n_{s-delay} to the prediction.

## CREDITS AND REFERENCES

Arthur, W. B. (1994). Inductive reasoning and bounded rationality. American Economic Review 84(2), 406-411.

Fogel, D. B., Chellapilla, K., and Angeline, P. J. (1999). Inductive reasoning and bounded rationality reconsidered. IEEE Transactions on Evolutionary Computation 3(2), 142-146.

Rand, W. and Wilensky, U. (2007). NetLogo El Farol model.

## COPYRIGHT AND LICENSE

The original El Farol model is Copyright 2007 Uri Wilensky, CC BY-NC-SA 3.0. This gym-slot extension keeps that strategy code and adds the WSRC slot/information layer for a course project.
@#$#@#$#@
default
true
0
Polygon -7500403 true true 150 5 40 250 150 205 260 250

airplane
true
0
Polygon -7500403 true true 150 0 135 15 120 60 120 105 15 165 15 195 120 180 135 240 105 270 120 285 150 270 180 285 210 270 165 240 180 180 285 195 285 165 180 105 180 60 165 15

arrow
true
0
Polygon -7500403 true true 150 0 0 150 105 150 105 293 195 293 195 150 300 150

box
false
0
Polygon -7500403 true true 150 285 285 225 285 75 150 135
Polygon -7500403 true true 150 135 15 75 150 15 285 75
Polygon -7500403 true true 15 75 15 225 150 285 150 135
Line -16777216 false 150 285 150 135
Line -16777216 false 150 135 15 75
Line -16777216 false 150 135 285 75

bug
true
0
Circle -7500403 true true 96 182 108
Circle -7500403 true true 110 127 80
Circle -7500403 true true 110 75 80
Line -7500403 true 150 100 80 30
Line -7500403 true 150 100 220 30

butterfly
true
0
Polygon -7500403 true true 150 165 209 199 225 225 225 255 195 270 165 255 150 240
Polygon -7500403 true true 150 165 89 198 75 225 75 255 105 270 135 255 150 240
Polygon -7500403 true true 139 148 100 105 55 90 25 90 10 105 10 135 25 180 40 195 85 194 139 163
Polygon -7500403 true true 162 150 200 105 245 90 275 90 290 105 290 135 275 180 260 195 215 195 162 165
Polygon -16777216 true false 150 255 135 225 120 150 135 120 150 105 165 120 180 150 165 225
Circle -16777216 true false 135 90 30
Line -16777216 false 150 105 195 60
Line -16777216 false 150 105 105 60

car
false
0
Polygon -7500403 true true 300 180 279 164 261 144 240 135 226 132 213 106 203 84 185 63 159 50 135 50 75 60 0 150 0 165 0 225 300 225 300 180
Circle -16777216 true false 180 180 90
Circle -16777216 true false 30 180 90
Polygon -16777216 true false 162 80 132 78 134 135 209 135 194 105 189 96 180 89
Circle -7500403 true true 47 195 58
Circle -7500403 true true 195 195 58

circle
false
0
Circle -7500403 true true 0 0 300

circle 2
false
0
Circle -7500403 true true 0 0 300
Circle -16777216 true false 30 30 240

cow
false
0
Polygon -7500403 true true 200 193 197 249 179 249 177 196 166 187 140 189 93 191 78 179 72 211 49 209 48 181 37 149 25 120 25 89 45 72 103 84 179 75 198 76 252 64 272 81 293 103 285 121 255 121 242 118 224 167
Polygon -7500403 true true 73 210 86 251 62 249 48 208
Polygon -7500403 true true 25 114 16 195 9 204 23 213 25 200 39 123

cylinder
false
0
Circle -7500403 true true 0 0 300

dot
false
0
Circle -7500403 true true 90 90 120

face happy
false
0
Circle -7500403 true true 8 8 285
Circle -16777216 true false 60 75 60
Circle -16777216 true false 180 75 60
Polygon -16777216 true false 150 255 90 239 62 213 47 191 67 179 90 203 109 218 150 225 192 218 210 203 227 181 251 194 236 217 212 240

face neutral
false
0
Circle -7500403 true true 8 7 285
Circle -16777216 true false 60 75 60
Circle -16777216 true false 180 75 60
Rectangle -16777216 true false 60 195 240 225

face sad
false
0
Circle -7500403 true true 8 8 285
Circle -16777216 true false 60 75 60
Circle -16777216 true false 180 75 60
Polygon -16777216 true false 150 168 90 184 62 210 47 232 67 244 90 220 109 205 150 198 192 205 210 220 227 242 251 229 236 206 212 183

fish
false
0
Polygon -1 true false 44 131 21 87 15 86 0 120 15 150 0 180 13 214 20 212 45 166
Polygon -1 true false 135 195 119 235 95 218 76 210 46 204 60 165
Polygon -1 true false 75 45 83 77 71 103 86 114 166 78 135 60
Polygon -7500403 true true 30 136 151 77 226 81 280 119 292 146 292 160 287 170 270 195 195 210 151 212 30 166
Circle -16777216 true false 215 106 30

flag
false
0
Rectangle -7500403 true true 60 15 75 300
Polygon -7500403 true true 90 150 270 90 90 30
Line -7500403 true 75 135 90 135
Line -7500403 true 75 45 90 45

flower
false
0
Polygon -10899396 true false 135 120 165 165 180 210 180 240 150 300 165 300 195 240 195 195 165 135
Circle -7500403 true true 85 132 38
Circle -7500403 true true 130 147 38
Circle -7500403 true true 192 85 38
Circle -7500403 true true 85 40 38
Circle -7500403 true true 177 40 38
Circle -7500403 true true 177 132 38
Circle -7500403 true true 70 85 38
Circle -7500403 true true 130 25 38
Circle -7500403 true true 96 51 108
Circle -16777216 true false 113 68 74
Polygon -10899396 true false 189 233 219 188 249 173 279 188 234 218
Polygon -10899396 true false 180 255 150 210 105 210 75 240 135 240

house
false
0
Rectangle -7500403 true true 45 120 255 285
Rectangle -16777216 true false 120 210 180 285
Polygon -7500403 true true 15 120 150 15 285 120
Line -16777216 false 30 120 270 120

leaf
false
0
Polygon -7500403 true true 150 210 135 195 120 210 60 210 30 195 60 180 60 165 15 135 30 120 15 105 40 104 45 90 60 90 90 105 105 120 120 120 105 60 120 60 135 30 150 15 165 30 180 60 195 60 180 120 195 120 210 105 240 90 255 90 263 104 285 105 270 120 285 135 240 165 240 180 270 195 240 210 180 210 165 195
Polygon -7500403 true true 135 195 135 240 120 255 105 255 105 285 135 285 165 240 165 195

line
true
0
Line -7500403 true 150 0 150 300

line half
true
0
Line -7500403 true 150 0 150 150

pentagon
false
0
Polygon -7500403 true true 150 15 15 120 60 285 240 285 285 120

person
false
0
Circle -7500403 true true 110 5 80
Polygon -7500403 true true 105 90 120 195 90 285 105 300 135 300 150 225 165 300 195 300 210 285 180 195 195 90
Rectangle -7500403 true true 127 79 172 94
Polygon -7500403 true true 195 90 240 150 225 180 165 105
Polygon -7500403 true true 105 90 60 150 75 180 135 105

plant
false
0
Rectangle -7500403 true true 135 90 165 300
Polygon -7500403 true true 135 255 90 210 45 195 75 255 135 285
Polygon -7500403 true true 165 255 210 210 255 195 225 255 165 285
Polygon -7500403 true true 135 180 90 135 45 120 75 180 135 210
Polygon -7500403 true true 165 180 165 210 225 180 255 120 210 135
Polygon -7500403 true true 135 105 90 60 45 45 75 105 135 135
Polygon -7500403 true true 165 105 165 135 225 105 255 45 210 60
Polygon -7500403 true true 135 90 120 45 150 15 180 45 165 90

square
false
0
Rectangle -7500403 true true 30 30 270 270

square 2
false
0
Rectangle -7500403 true true 30 30 270 270
Rectangle -16777216 true false 60 60 240 240

star
false
0
Polygon -7500403 true true 151 1 185 108 298 108 207 175 242 282 151 216 59 282 94 175 3 108 116 108

target
false
0
Circle -7500403 true true 0 0 300
Circle -16777216 true false 30 30 240
Circle -7500403 true true 60 60 180
Circle -16777216 true false 90 90 120
Circle -7500403 true true 120 120 60

tree
false
0
Circle -7500403 true true 118 3 94
Rectangle -6459832 true false 120 195 180 300
Circle -7500403 true true 65 21 108
Circle -7500403 true true 116 41 127
Circle -7500403 true true 45 90 120
Circle -7500403 true true 104 74 152

triangle
false
0
Polygon -7500403 true true 150 30 15 255 285 255

triangle 2
false
0
Polygon -7500403 true true 150 30 15 255 285 255
Polygon -16777216 true false 151 99 225 223 75 224

truck
false
0
Rectangle -7500403 true true 4 45 195 187
Polygon -7500403 true true 296 193 296 150 259 134 244 104 208 104 207 194
Rectangle -1 true false 195 60 195 105
Polygon -16777216 true false 238 112 252 141 219 141 218 112
Circle -16777216 true false 234 174 42
Rectangle -7500403 true true 181 185 214 194
Circle -16777216 true false 144 174 42
Circle -16777216 true false 24 174 42
Circle -7500403 false true 24 174 42
Circle -7500403 false true 144 174 42
Circle -7500403 false true 234 174 42

turtle
true
0
Polygon -10899396 true false 215 204 240 233 246 254 228 266 215 252 193 210
Polygon -10899396 true false 195 90 225 75 245 75 260 89 269 108 261 124 240 105 225 105 210 105
Polygon -10899396 true false 105 90 75 75 55 75 40 89 31 108 39 124 60 105 75 105 90 105
Polygon -10899396 true false 132 85 134 64 107 51 108 17 150 2 192 18 192 52 169 65 172 87
Polygon -10899396 true false 85 204 60 233 54 254 72 266 85 252 107 210
Polygon -7500403 true true 119 75 179 75 209 101 224 135 220 225 175 261 128 261 81 224 74 135 88 99

wheel
false
0
Circle -7500403 true true 3 3 294
Circle -16777216 true false 30 30 240
Line -7500403 true 150 285 150 15
Line -7500403 true 15 150 285 150
Circle -7500403 true true 120 120 60
Line -7500403 true 216 40 79 269
Line -7500403 true 40 84 269 221
Line -7500403 true 40 216 269 79
Line -7500403 true 84 40 221 269

x
false
0
Polygon -7500403 true true 270 75 225 30 30 225 75 270
Polygon -7500403 true true 30 75 75 30 270 225 225 270
@#$#@#$#@
NetLogo 6.3.0
@#$#@#$#@
@#$#@#$#@
@#$#@#$#@
<experiments>
  <experiment name="info-memory-pilot" repetitions="5" sequentialRunOrder="true" runMetricsEveryStep="false">
    <setup>setup</setup>
    <go>go</go>
    <timeLimit steps="480"/>
    <metric>peak-occupancy</metric>
    <metric>pct-slots-over-capacity</metric>
    <metric>occupancy-variance</metric>
    <metric>good-visit-rate</metric>
    <metric>skip-rate</metric>
    <metric>lag1-autocorr</metric>
    <enumeratedValueSet variable="info-mode">
      <value value="&quot;none&quot;"/>
      <value value="&quot;live&quot;"/>
      <value value="&quot;delayed&quot;"/>
    </enumeratedValueSet>
    <enumeratedValueSet variable="memory-size">
      <value value="1"/>
      <value value="5"/>
      <value value="10"/>
    </enumeratedValueSet>
    <enumeratedValueSet variable="number-strategies">
      <value value="10"/>
    </enumeratedValueSet>
    <enumeratedValueSet variable="n-agents">
      <value value="100"/>
    </enumeratedValueSet>
    <enumeratedValueSet variable="capacity">
      <value value="38"/>
    </enumeratedValueSet>
    <enumeratedValueSet variable="delay">
      <value value="2"/>
    </enumeratedValueSet>
    <enumeratedValueSet variable="burn-in-days">
      <value value="10"/>
    </enumeratedValueSet>
    <enumeratedValueSet variable="must-go?">
      <value value="false"/>
    </enumeratedValueSet>
    <enumeratedValueSet variable="seed-from-data?">
      <value value="true"/>
    </enumeratedValueSet>
    <enumeratedValueSet variable="visualize?">
      <value value="false"/>
    </enumeratedValueSet>
  </experiment>
  <experiment name="info-memory-grid" repetitions="30" sequentialRunOrder="true" runMetricsEveryStep="false">
    <setup>setup</setup>
    <go>go</go>
    <timeLimit steps="480"/>
    <metric>peak-occupancy</metric>
    <metric>pct-slots-over-capacity</metric>
    <metric>occupancy-variance</metric>
    <metric>good-visit-rate</metric>
    <metric>skip-rate</metric>
    <metric>lag1-autocorr</metric>
    <enumeratedValueSet variable="info-mode">
      <value value="&quot;none&quot;"/>
      <value value="&quot;live&quot;"/>
      <value value="&quot;delayed&quot;"/>
    </enumeratedValueSet>
    <enumeratedValueSet variable="memory-size">
      <value value="1"/>
      <value value="5"/>
      <value value="10"/>
    </enumeratedValueSet>
    <enumeratedValueSet variable="number-strategies">
      <value value="10"/>
    </enumeratedValueSet>
    <enumeratedValueSet variable="n-agents">
      <value value="100"/>
    </enumeratedValueSet>
    <enumeratedValueSet variable="capacity">
      <value value="38"/>
    </enumeratedValueSet>
    <enumeratedValueSet variable="delay">
      <value value="2"/>
    </enumeratedValueSet>
    <enumeratedValueSet variable="burn-in-days">
      <value value="10"/>
    </enumeratedValueSet>
    <enumeratedValueSet variable="must-go?">
      <value value="false"/>
    </enumeratedValueSet>
    <enumeratedValueSet variable="seed-from-data?">
      <value value="true"/>
    </enumeratedValueSet>
    <enumeratedValueSet variable="visualize?">
      <value value="false"/>
    </enumeratedValueSet>
  </experiment>
  <experiment name="smoke-one-day" repetitions="1" sequentialRunOrder="true" runMetricsEveryStep="false">
    <setup>setup</setup>
    <go>go</go>
    <timeLimit steps="24"/>
    <metric>peak-occupancy</metric>
    <metric>pct-slots-over-capacity</metric>
    <metric>occupancy-variance</metric>
    <metric>good-visit-rate</metric>
    <metric>skip-rate</metric>
    <metric>lag1-autocorr</metric>
    <enumeratedValueSet variable="info-mode">
      <value value="&quot;none&quot;"/>
    </enumeratedValueSet>
    <enumeratedValueSet variable="memory-size">
      <value value="5"/>
    </enumeratedValueSet>
    <enumeratedValueSet variable="number-strategies">
      <value value="10"/>
    </enumeratedValueSet>
    <enumeratedValueSet variable="n-agents">
      <value value="100"/>
    </enumeratedValueSet>
    <enumeratedValueSet variable="capacity">
      <value value="38"/>
    </enumeratedValueSet>
    <enumeratedValueSet variable="delay">
      <value value="2"/>
    </enumeratedValueSet>
    <enumeratedValueSet variable="burn-in-days">
      <value value="0"/>
    </enumeratedValueSet>
    <enumeratedValueSet variable="must-go?">
      <value value="false"/>
    </enumeratedValueSet>
    <enumeratedValueSet variable="seed-from-data?">
      <value value="true"/>
    </enumeratedValueSet>
    <enumeratedValueSet variable="visualize?">
      <value value="false"/>
    </enumeratedValueSet>
  </experiment>
</experiments>
@#$#@#$#@
@#$#@#$#@
default
0.0
-0.2 0 0.0 1.0
0.0 1 1.0 0.0
0.2 0 0.0 1.0
link direction
true
0
Line -7500403 true 150 150 90 180
Line -7500403 true 150 150 210 180
@#$#@#$#@
1
@#$#@#$#@
