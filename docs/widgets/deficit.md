# Deficit Widget

A calorie balance toward a goal weight. A profile gives the daily burn; each day you enter what you ate (and exercise, and a weigh-in if you like); the widget keeps an estimated weight, the calories still to go, and the date the goal lands at your average pace so far.

## Storage Keys

| Key | Value |
|---|---|
| `deficit-config-{id}` | JSON: `{ sex, age, heightCm, startWeightKg, goalWeightKg, activity, startDate }` |
| `deficit-days-{id}` | JSON: `{ [date: "YYYY-MM-DD"]: { ate, burned?, weight? } }`: calories eaten, extra calories burned by exercise, and a weigh-in in kg |

- `activity` is the multiplier on the basal rate: 1.2 sedentary, 1.375 light, 1.55 moderate, 1.725 active, 1.9 very active.
- `startDate` is the day `startWeightKg` was true; entries before it are ignored.

## Model

Everything derived is computed in `lib/deficit.ts` (tested in `tests/deficit.test.ts`); nothing derived is stored.

- Base burn for a day is Mifflin-St Jeor (`10 * kg + 6.25 * cm - 5 * age + 5`, or `- 161` for female) times the activity factor, computed from the estimated weight at the start of that day, so the burn falls as the weight does. Exercise entered for the day is added on top.
- A day's deficit is burn minus eaten; a negative deficit is a surplus. The estimated weight moves by the deficit at 7700 kcal per kilogram (3500 per pound).
- Days with no entry change nothing and are left out of the average. Entries are editable later and everything is recomputed from the start.
- The goal date is today plus the remaining calories divided by the average daily deficit over the logged days. With no logged days, a zero or wrong-way average, or more than three years out, there is no date ("not on track"). A goal above the start weight works the same way with a surplus.

## Behaviour

- The front shows the estimated weight now and the goal, the calories to go, the projected date and the average pace, a chart, and the day entry.
- The chart runs from the start date to the goal date (or today): the estimated weight as a line with the area under it filled, the goal as a dashed line, a dotted line from the latest estimate to the goal date, and weigh-ins as green dots so the estimate can be checked against reality.
- The day entry defaults to today; the arrows step to past days to fix them. Fields commit on blur or Enter; clearing "ate" removes the day. Under the fields: that day's burn and its deficit or surplus, with the weight it moves.
- The settings card holds the profile and goal and previews the daily burn at the start weight.

Deficit is not `digestable`; the chat's `read_widget` tool reads it through `lib/widgetData.ts` (`readDeficit`): the estimate, what is left, the pace, the projected date, and the last seven logged days.

(component: `components/DeficitWidget.tsx`)
