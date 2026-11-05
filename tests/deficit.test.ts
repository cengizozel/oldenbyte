import { describe, expect, it } from "vitest";
import { bmr, dailyBurn, isValidConfig, project, KCAL_PER_KG, type DeficitConfig } from "@/lib/deficit";
import { shiftDay } from "@/lib/upkeep";

const cfg: DeficitConfig = { sex: "male", age: 26, heightCm: 180, startWeightKg: 90, goalWeightKg: 80, activity: 1.2, startDate: "2026-11-01" };

describe("bmr and dailyBurn", () => {
  it("follows Mifflin-St Jeor", () => {
    expect(bmr("male", 26, 180, 90)).toBe(10 * 90 + 6.25 * 180 - 5 * 26 + 5);
    expect(bmr("female", 26, 180, 90)).toBe(10 * 90 + 6.25 * 180 - 5 * 26 - 161);
    expect(dailyBurn(cfg, 90)).toBe(Math.round(1900 * 1.2));
  });
});

describe("isValidConfig", () => {
  it("accepts a full profile and rejects a partial one", () => {
    expect(isValidConfig(cfg)).toBe(true);
    expect(isValidConfig({ ...cfg, heightCm: 0 })).toBe(false);
    expect(isValidConfig({ ...cfg, startDate: "today" })).toBe(false);
    expect(isValidConfig(null)).toBe(false);
  });
});

describe("project", () => {
  it("moves the estimate by each day's deficit at 7700 kcal per kg and recomputes burn from it", () => {
    const burn1 = dailyBurn(cfg, 90);
    const p = project(cfg, { "2026-11-01": { ate: burn1 - 770 } }, "2026-11-01");
    expect(p.points[0].deficit).toBe(770);
    expect(p.estWeight).toBeCloseTo(89.9, 6);
    expect(p.burnNow).toBe(dailyBurn(cfg, 89.9));
    expect(p.remainingKg).toBeCloseTo(9.9, 6);
    expect(p.remainingKcal).toBeCloseTo(9.9 * KCAL_PER_KG, 3);
  });
  it("skips days without an entry and days outside the window, and averages over logged days only", () => {
    const burn = dailyBurn(cfg, 90);
    const p = project(cfg, {
      "2026-10-31": { ate: 0 },          // before the start
      "2026-11-01": { ate: burn - 500 },
      "2026-11-03": { ate: burn - 500 }, // the 2nd is missing
      "2026-11-09": { ate: 0 },          // after today
    }, "2026-11-05");
    expect(p.loggedDays).toBe(2);
    expect(p.avgDeficit).toBeCloseTo(500, -1); // the second day burns a calorie less at the lower weight
  });
  it("projects the goal date from the average so far, and says so when not on track", () => {
    const burn = dailyBurn(cfg, 90);
    const on = project(cfg, { "2026-11-01": { ate: burn - 770 }, "2026-11-02": { ate: burn - 770 } }, "2026-11-02");
    expect(on.goalDate).toBe(shiftDay("2026-11-02", Math.ceil(on.remainingKcal / on.avgDeficit!)));
    expect(on.goalDate! > "2027-01-01" && on.goalDate! < "2027-03-01").toBe(true);
    const off = project(cfg, { "2026-11-01": { ate: burn + 300 } }, "2026-11-01");
    expect(off.goalDate).toBeNull();
    expect(off.avgDeficit).toBe(-300);
    expect(project(cfg, {}, "2026-11-01").goalDate).toBeNull();
  });
  it("knows when the goal is reached, in either direction", () => {
    const nearly: DeficitConfig = { ...cfg, startWeightKg: 80.05 };
    const lost = project(nearly, { "2026-11-01": { ate: dailyBurn(nearly, 80.05) - 770 } }, "2026-11-01");
    expect(lost.reached).toBe(true);
    expect(lost.goalDate).toBeNull();
    const gain: DeficitConfig = { ...cfg, startWeightKg: 60, goalWeightKg: 65 };
    const g = project(gain, { "2026-11-01": { ate: dailyBurn(gain, 60) + 770 } }, "2026-11-01");
    expect(g.estWeight).toBeCloseTo(60.1, 6);
    expect(g.reached).toBe(false);
    expect(g.goalDate).not.toBeNull();
  });
  it("keeps weigh-ins and exercise on the points", () => {
    const burn = dailyBurn(cfg, 90);
    const p = project(cfg, { "2026-11-01": { ate: burn, burned: 300, weight: 89.5 } }, "2026-11-01");
    expect(p.points[0]).toMatchObject({ burned: 300, burn: burn + 300, deficit: 300, weight: 89.5 });
  });
});
