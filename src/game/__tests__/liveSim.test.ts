import { describe, expect, it } from "vitest";
import { demoProfile } from "../sim";
import { LiveSim } from "../liveSim";

function freshSim() {
  const profile = demoProfile();
  profile.planStartAge = 58;
  return new LiveSim(profile);
}

describe("LiveSim — the fire-season engine", () => {
  it("ignites a fire net of income rain and lets the vault douse 1:1", () => {
    const sim = freshSim();
    const start = sim.beginYear();
    expect(start.fireSize).toBeGreaterThan(0);
    const before = sim.fireRemaining;
    const squirt = sim.squirt("spouse", 20_000);
    expect(squirt.samTook).toBe(0);
    expect(squirt.bouncerTook).toBe(0);
    expect(squirt.doused).toBeCloseTo(Math.min(20_000, before), 0);
  });

  it("IOU squirts feed Sam and the bouncer before 59.5", () => {
    const sim = freshSim();
    sim.beginYear();
    const squirt = sim.squirt("traditional", 40_000);
    expect(squirt.bouncerTook).toBeGreaterThan(3_500); // ~10% of 40k
    expect(squirt.doused).toBeLessThan(40_000 - squirt.bouncerTook + 1);
  });

  it("wallet squirts leak only on the gains share", () => {
    const sim = freshSim();
    sim.beginYear();
    const squirt = sim.squirt("taxable", 30_000);
    // 40% gain share at low income → mostly 0% LTCG bracket → tiny/no leak
    expect(squirt.samTook).toBeLessThan(2_000);
    expect(squirt.doused).toBeGreaterThan(28_000);
  });

  it("year-end pours are bouncer-exempt and land in Freedom", () => {
    const sim = freshSim();
    sim.pourPlan = "fill22";
    sim.beginYear();
    while (sim.fireRemaining > 1) {
      if (sim.squirt("spouse", 50_000).gross <= 0 && sim.squirt("taxable", 50_000).gross <= 0) break;
    }
    const rothBefore = sim.balances.roth;
    const taxBefore = sim.totalTax;
    const end = sim.endYear();
    expect(end.poured).toBeGreaterThan(10_000);
    expect(sim.balances.roth).toBeGreaterThan(rothBefore + 10_000);
    // toll exists but contains no 10% penalty on the poured amount:
    // effective toll rate stays under 22% + SECA effects, far below 22%+10%
    expect(end.pourToll / end.poured).toBeLessThan(0.25);
    expect(sim.totalTax).toBeGreaterThan(taxBefore);
  });

  it("declares game over only when hoses are empty and fire still burns", () => {
    const profile = demoProfile();
    profile.balances = { traditional: 0, roth: 0, taxable: 5_000, spouse: 0, kids: 0, trump: 0 };
    profile.socialSecurityAnnual = 0;
    profile.otherIncomeAnnual = 0;
    const sim = new LiveSim(profile);
    sim.beginYear();
    sim.squirt("taxable", 5_000);
    expect(sim.fireRemaining).toBeGreaterThan(1);
    sim.endYear();
    expect(sim.gameOver).toBe(true);
  });

  it("respects the spouse reserve floor as unsquirtable", () => {
    const profile = demoProfile();
    profile.spouseReserveFloor = 200_000;
    const sim = new LiveSim(profile);
    sim.beginYear();
    const squirt = sim.squirt("spouse", 999_999);
    expect(squirt.gross).toBeLessThanOrEqual(profile.balances.spouse - 200_000 + 1);
    expect(sim.balances.spouse).toBeGreaterThanOrEqual(200_000 - 1);
  });
});
