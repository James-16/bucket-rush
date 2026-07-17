import { describe, expect, it } from "vitest";
import { demoProfile } from "../sim";
import { LiveSim, rebasedForecastProfile } from "../liveSim";
import { simulate } from "../../model/simulate";

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

describe("the bouncer guards the Freedom Tank (§408A 5-year conversion rule)", () => {
  /** convert at 58 via fill12, dousing with the vault so the wallet pays the toll */
  function convertAt58() {
    const sim = freshSim();
    sim.pourPlan = "fill12";
    sim.beginYear();
    while (sim.fireRemaining > 1) {
      if (sim.squirt("spouse", sim.fireRemaining).gross <= 0) break;
    }
    const end = sim.endYear(); // pours at 58 → sim is now at age 59
    expect(end.poured).toBeGreaterThan(10_000);
    expect(sim.balances.roth).toBeGreaterThan(10_000);
    return sim;
  }

  it("charges 10% recapture on young conversion money drawn before 59.5", () => {
    const sim = convertAt58();
    sim.beginYear(); // age 59: converted dollars are 1 tax year old
    const squirt = sim.squirt("roth", 10_000);
    expect(squirt.bouncerTook).toBeCloseTo(1_000, 0);
    expect(squirt.samTook).toBe(0); // conversion basis was already taxed — penalty only
    expect(squirt.doused).toBeCloseTo(9_000, 0);
  });

  it("lets the same dollars out free once 59.5 has passed", () => {
    const sim = convertAt58();
    sim.beginYear(); // 59
    sim.endYear();
    sim.beginYear(); // 60 — recapture only bites under 59.5
    const squirt = sim.squirt("roth", 10_000);
    expect(squirt.gross).toBeCloseTo(10_000, 0);
    expect(squirt.bouncerTook).toBe(0);
    expect(squirt.samTook).toBe(0);
  });

  it("treats the starting Roth balance as old money — never penalized", () => {
    const profile = demoProfile();
    profile.balances = { ...profile.balances, roth: 50_000 };
    const sim = new LiveSim(profile);
    sim.beginYear(); // age 58, but this money predates the game
    const squirt = sim.squirt("roth", 20_000);
    expect(squirt.gross).toBeCloseTo(20_000, 0);
    expect(squirt.bouncerTook).toBe(0);
    expect(squirt.samTook).toBe(0);
  });
});

describe("Roth earnings need the account 5-year clock, not just 59.5", () => {
  it("taxes earnings drawn after 59.5 from a Roth born in-game", () => {
    // childless single filer: no CTC to absorb the small earnings tax, and a
    // consistent filing status once the child is removed
    const profile = demoProfile();
    profile.childBirthYears = [];
    profile.filingStatus = "single";
    const sim = new LiveSim(profile);
    sim.pourPlan = "fill12";
    sim.beginYear(); // 58 — first conversion starts the account clock
    while (sim.fireRemaining > 1) {
      if (sim.squirt("spouse", sim.fireRemaining).gross <= 0) break;
    }
    sim.endYear();
    sim.pourPlan = "off";
    sim.beginYear(); // 59
    sim.endYear();
    sim.beginYear(); // 60 — past 59.5, but the account is only 2 tax years old
    const everything = sim.squirt("roth", sim.available("roth"));
    expect(everything.bouncerTook).toBe(0); // no 10% after 59.5
    expect(everything.samTook).toBeGreaterThan(0); // but earnings are still ordinary income
  });

  it("assumes a pre-existing Roth is seasoned — earnings free at 59.5+", () => {
    const profile = demoProfile();
    profile.planStartAge = 60;
    profile.balances = { ...profile.balances, roth: 50_000 };
    const sim = new LiveSim(profile);
    sim.beginYear();
    sim.endYear(); // growth creates earnings beyond the old-money basis
    sim.beginYear();
    const everything = sim.squirt("roth", sim.available("roth"));
    expect(everything.gross).toBeGreaterThan(50_000);
    expect(everything.samTook).toBe(0);
    expect(everything.bouncerTook).toBe(0);
  });
});

describe("liquidity events reach the live game (engine parity)", () => {
  it("lands an inheritance on its bucket at the event age", () => {
    const profile = demoProfile();
    profile.liquidityEvents = [{ id: 1, label: "Inheritance", amount: 100_000, age: 59, bucket: "taxable" }];
    const sim = new LiveSim(profile);
    sim.beginYear(); // 58 — not yet
    sim.endYear();
    const beforeEvent = sim.balances.taxable;
    sim.beginYear(); // 59 — event lands
    expect(sim.balances.taxable).toBeCloseTo(beforeEvent + 100_000, 0);
  });

  it("a one-time purchase can't overdraw its bucket", () => {
    const profile = demoProfile();
    profile.liquidityEvents = [{ id: 1, label: "Boat", amount: -99_999_999, age: 58, bucket: "taxable" }];
    const sim = new LiveSim(profile);
    sim.beginYear();
    expect(sim.balances.taxable).toBe(0);
  });
});

describe("year-start snapshot (the forecast's honest base)", () => {
  it("ignores mid-year squirts and rolls forward at year end", () => {
    const sim = freshSim();
    expect(sim.yearStartSnapshot.age).toBe(58);
    sim.beginYear();
    sim.squirt("spouse", 10_000);
    expect(sim.yearStartSnapshot.balances.spouse).toBe(250_000); // squirts don't rewrite the base
    sim.endYear();
    expect(sim.yearStartSnapshot.yearIndex).toBe(1);
    expect(sim.yearStartSnapshot.age).toBe(59);
    expect(sim.yearStartSnapshot.balances.spouse).toBeCloseTo((250_000 - 10_000) * 1.05, 0);
  });
});

describe("the Wallet's toll sale realizes gains (LiveSim, per James's decision)", () => {
  function pourWithGainShare(pct: number) {
    const profile = demoProfile();
    profile.planStartAge = 60; // past 59.5: no bouncer noise in the toll
    profile.taxableGainPortionPct = pct;
    profile.balances = { ...profile.balances, taxable: 500_000, spouse: 3_000_000 };
    const sim = new LiveSim(profile);
    sim.pourPlan = "fill12";
    sim.beginYear();
    while (sim.fireRemaining > 1) {
      if (sim.squirt("spouse", sim.fireRemaining).gross <= 0) break;
    }
    const walletBefore = sim.balances.taxable;
    const end = sim.endYear();
    // endYear grows the wallet 5% after the toll came out
    const fromWallet = walletBefore - sim.balances.taxable / 1.05;
    return { end, fromWallet };
  }

  it("a 100% gain share pays a larger fixed-point toll than 0%", () => {
    const flat = pourWithGainShare(0);
    const gainy = pourWithGainShare(100);
    expect(gainy.end.pourToll).toBeGreaterThan(flat.end.pourToll + 100);
    // the wallet covered the whole toll both times — nothing skimmed
    expect(flat.end.landed).toBeCloseTo(flat.end.poured, 0);
    expect(gainy.end.landed).toBeCloseTo(gainy.end.poured, 0);
    expect(flat.fromWallet).toBeCloseTo(flat.end.pourToll, 0);
    expect(gainy.fromWallet).toBeCloseTo(gainy.end.pourToll, 0);
  });
});

describe("rebasedForecastProfile keeps the economy's timeline", () => {
  it("bakes 10 years of inflation and COLA into the rebased base amounts", () => {
    const sim = freshSim();
    sim.beginYear();
    for (let year = 0; year < 10; year += 1) {
      while (sim.fireRemaining > 1) {
        if (sim.squirt("spouse", sim.fireRemaining).gross <= 0) break;
      }
      sim.endYear();
      sim.beginYear();
    }
    const p = sim.profile;
    const profile = rebasedForecastProfile(sim, "off");
    expect(profile.planStartAge).toBe(68);
    const first = simulate(profile).rows[0];
    const school = p.extraExpenses[0];
    const expected =
      p.baseSpending * (1 + p.spendingInflationPct / 100) ** 10 +
      school.annualAmount * (1 + school.inflationPct / 100) ** (68 - school.startAge);
    // the forecast's first year matches the live economy exactly — no restart
    expect(first.spending).toBeCloseTo(expected, 0);
  });
});

describe("the pour's skim is a distribution (engine parity)", () => {
  function emptyWalletAt(planStartAge: number) {
    const profile = demoProfile();
    profile.planStartAge = planStartAge;
    profile.balances = { ...profile.balances, taxable: 0, spouse: 3_000_000 };
    const sim = new LiveSim(profile);
    sim.pourPlan = "fill12";
    sim.beginYear();
    while (sim.fireRemaining > 1) {
      if (sim.squirt("spouse", sim.fireRemaining).gross <= 0) break;
    }
    const end = sim.endYear();
    expect(end.poured).toBeGreaterThan(10_000);
    return end;
  }

  it("faces the bouncer before 59.5 but not after", () => {
    const at58 = emptyWalletAt(58);
    const at62 = emptyWalletAt(62);
    // wallet empty → the whole toll is skimmed; before 59.5 the skim carries
    // an extra 10%, so the toll takes a visibly bigger bite of the pour
    expect(at58.pourToll / at58.poured).toBeGreaterThan(at62.pourToll / at62.poured + 0.005);
  });
});

describe("vault pays the pour toll (conversion.taxSource)", () => {
  function emptyWalletSim(taxSource: "taxable" | "taxableThenSpouse") {
    const profile = demoProfile();
    profile.balances = { ...profile.balances, taxable: 0, spouse: 500_000 };
    profile.conversion = { ...profile.conversion, taxSource };
    const sim = new LiveSim(profile);
    sim.pourPlan = "fill22";
    sim.beginYear();
    // spouse squirts douse 1:1, so exact-size squirts leave no over-douse
    // sloshing into the Wallet — it stays truly empty at year end
    while (sim.fireRemaining > 1) {
      if (sim.squirt("spouse", sim.fireRemaining).gross <= 0) break;
    }
    expect(sim.balances.taxable).toBe(0);
    return sim;
  }

  it("default: empty wallet means Sam skims the pour itself", () => {
    const sim = emptyWalletSim("taxable");
    const end = sim.endYear();
    expect(end.poured).toBeGreaterThan(10_000);
    expect(end.tollFromVault).toBe(0);
    // honest gross vs net: only `landed` reached Freedom
    expect(end.landed).toBeCloseTo(end.poured - end.pourToll, 0);
    expect(sim.balances.roth).toBeCloseTo(end.landed * 1.07, -1);
  });

  it("vault-pays-toll: full pour reaches Freedom, vault drops by the toll", () => {
    const sim = emptyWalletSim("taxableThenSpouse");
    const spouseBefore = sim.balances.spouse;
    const end = sim.endYear();
    expect(end.poured).toBeGreaterThan(10_000);
    expect(end.tollFromVault).toBeCloseTo(end.pourToll, 0);
    // nothing skimmed: gross and landed agree
    expect(end.landed).toBeCloseTo(end.poured, 0);
    expect(sim.balances.roth).toBeCloseTo(end.landed * 1.07, -1);
    expect(sim.balances.spouse).toBeCloseTo((spouseBefore - end.tollFromVault) * 1.05, -1);
  });

  it("vault backstop still honors the reserve floor", () => {
    const profile = demoProfile();
    profile.balances = { ...profile.balances, taxable: 0 };
    profile.spouseReserveFloor = profile.balances.spouse; // everything below floor
    profile.conversion = { ...profile.conversion, taxSource: "taxableThenSpouse" };
    const sim = new LiveSim(profile);
    sim.pourPlan = "fill22";
    sim.beginYear();
    const end = sim.endYear();
    expect(end.tollFromVault).toBe(0);
  });
});

describe("engine/bridge parity", () => {
  it("income beyond the fire pools in the Wallet exactly like simulate()", async () => {
    const { simulate } = await import("../../model/simulate");
    const profile = demoProfile();
    profile.balances = { traditional: 0, roth: 0, taxable: 0, spouse: 0, kids: 0, trump: 0 };
    profile.returnsPct = { traditional: 0, roth: 0, taxable: 0, spouse: 0, kids: 0, trump: 0 };
    profile.otherIncomeAnnual = 100_000;
    profile.otherIncomeEndAge = 120;
    profile.baseSpending = 10_000;
    profile.extraExpenses = [];
    const sim = new LiveSim(profile);
    sim.beginYear();
    expect(sim.fireRemaining).toBeLessThan(1); // income alone douses the fire
    sim.endYear();
    const engineRow = simulate(profile).rows[0];
    expect(sim.balances.taxable).toBeGreaterThan(50_000);
    expect(sim.balances.taxable).toBeCloseTo(engineRow.balances.taxable, -3);
  });
});
