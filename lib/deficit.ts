// The Deficit widget's model, shared with the chat reader (lib/widgetData.ts):
// daily burn from a profile, a day-by-day energy balance, an estimated weight
// and a projected goal date. Pure functions, tested in tests/deficit.test.ts.
//
// Burn is Mifflin-St Jeor times an activity factor, recomputed every day from
// the estimated weight so it falls as weight falls. Weight moves by the day's
// deficit at 7700 kcal per kilogram (3500 per pound). Days without an entry
// change nothing and are left out of the average.

import { shiftDay } from "@/lib/upkeep";

export type Sex = "male" | "female";
export type DeficitConfig = {
  sex: Sex;
  age: number;
  heightCm: number;
  startWeightKg: number;
  goalWeightKg: number;
  activity: number;   // multiplier on the basal rate, see ACTIVITY_LEVELS
  startDate: string;  // "YYYY-MM-DD", the day startWeightKg was true
};
// One day's entry: calories eaten, optional extra burn from exercise, optional
// weigh-in that morning.
export type DayEntry = { ate: number; burned?: number; weight?: number };
export type DeficitDays = Record<string, DayEntry>;

export const KCAL_PER_KG = 7700;
export const ACTIVITY_LEVELS: { value: number; label: string; hint: string }[] = [
  { value: 1.2,   label: "sedentary",   hint: "desk job, little exercise" },
  { value: 1.375, label: "light",       hint: "exercise 1 to 3 days a week" },
  { value: 1.55,  label: "moderate",    hint: "exercise 3 to 5 days a week" },
  { value: 1.725, label: "active",      hint: "hard exercise 6 to 7 days a week" },
  { value: 1.9,   label: "very active", hint: "physical job or training twice a day" },
];
// A projection further out than this reads as "not really on track".
const MAX_PROJECTION_DAYS = 3 * 365;

export function isValidConfig(c: Partial<DeficitConfig> | null | undefined): c is DeficitConfig {
  return !!c
    && (c.sex === "male" || c.sex === "female")
    && Number(c.age) > 0 && Number(c.heightCm) > 0 && Number(c.startWeightKg) > 0 && Number(c.goalWeightKg) > 0
    && Number(c.activity) > 0
    && typeof c.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.startDate);
}

// Basal metabolic rate, kcal per day (Mifflin-St Jeor).
export function bmr(sex: Sex, age: number, heightCm: number, weightKg: number): number {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === "male" ? 5 : -161);
}

// What a day burns at this weight before any extra exercise.
export function dailyBurn(cfg: DeficitConfig, weightKg: number): number {
  return Math.round(bmr(cfg.sex, cfg.age, cfg.heightCm, weightKg) * cfg.activity);
}

export type DayPoint = {
  date: string;
  ate: number;
  burned: number;    // extra exercise entered
  burn: number;      // total burn that day, base plus exercise
  deficit: number;   // burn minus ate; negative means a surplus
  estWeight: number; // estimated weight at the end of the day
  weight?: number;   // weigh-in, if entered
};

export type Projection = {
  points: DayPoint[];
  estWeight: number;          // now
  burnNow: number;            // a day's base burn at the estimated weight
  totalDeficit: number;
  loggedDays: number;
  avgDeficit: number | null;  // per logged day
  remainingKg: number;        // estWeight minus goal (negative when the goal is to gain)
  remainingKcal: number;
  reached: boolean;
  goalDate: string | null;    // null when reached, nothing logged, or not on track
};

export function project(cfg: DeficitConfig, days: DeficitDays, today: string): Projection {
  const dates = Object.keys(days).filter(d => d >= cfg.startDate && d <= today).sort();
  let estWeight = cfg.startWeightKg;
  let totalDeficit = 0;
  const points: DayPoint[] = [];
  for (const date of dates) {
    const e = days[date];
    const ate = Number(e.ate);
    if (!(ate >= 0)) continue;
    const burned = Number(e.burned) > 0 ? Number(e.burned) : 0;
    const burn = dailyBurn(cfg, estWeight) + burned;
    const deficit = burn - ate;
    estWeight -= deficit / KCAL_PER_KG;
    totalDeficit += deficit;
    const p: DayPoint = { date, ate, burned, burn, deficit, estWeight };
    if (Number(e.weight) > 0) p.weight = Number(e.weight);
    points.push(p);
  }
  const loggedDays = points.length;
  const avgDeficit = loggedDays ? totalDeficit / loggedDays : null;
  const losing = cfg.goalWeightKg <= cfg.startWeightKg;
  const remainingKg = estWeight - cfg.goalWeightKg;
  const remainingKcal = remainingKg * KCAL_PER_KG;
  const reached = losing ? remainingKg <= 0 : remainingKg >= 0;
  let goalDate: string | null = null;
  if (!reached && avgDeficit !== null && avgDeficit * remainingKcal > 0) {
    const daysLeft = Math.ceil(remainingKcal / avgDeficit);
    if (daysLeft <= MAX_PROJECTION_DAYS) goalDate = shiftDay(today, daysLeft);
  }
  return { points, estWeight, burnNow: dailyBurn(cfg, estWeight), totalDeficit, loggedDays, avgDeficit, remainingKg, remainingKcal, reached, goalDate };
}
