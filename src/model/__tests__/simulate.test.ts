import { describe, expect, it } from "vitest";
import { conversionGuide } from "../breakpoints";
import { bestStrategy, monteCarlo, simulate, strategyLab, terminalTax } from "../simulate";
import type { Profile } from "../types";

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    birthYear: 1968,
    planStartAge: 60,
    horizonAge: 95,
    residency: "abroad",
    abroadCountry: "Hong Kong",
    usState: "",
    married: true,
    spouseIsNRA: true,
    livesWithSpouse: true,
    filingStatus: "hoh",
    childBirthYears: [2024],
    balances: { traditional: 800_000, roth: 0, taxable: 100_000, spouse: 200_000, kids: 50_000, trump: 0 },
    returnsPct: { traditional: 5, roth: 5, taxable: 4, spouse: 4, kids: 5, trump: 5 },
    returnPhases: [],
    taxableGainPortionPct: 40,
    socialSecurityAnnual: 30_000,
    socialSecurityStartAge: 67,
    childSocialSecurityAnnual: 0,
    childSsEndAge: 18,
    otherIncomeAnnual: 0,
    otherIncomeEndAge: 0,
    otherIncomeIsSelfEmployment: false,
    baseSpending: 90_000,
    spendingInflationPct: 3,
    extraExpenses: [
      { id: 1, label: "School", annualAmount: 30_000, startAge: 63, endAge: 78, inflationPct: 4, isEducation: true },
    ],
    liquidityEvents: [],
    trumpWithdrawal: { annual: 0, startAge: 78, endAge: 90 },
    fillBracketWithdrawals: false,
    withdrawalBracketCeiling: 0.22,
    spousePriority: "afterTraditional",
    spouseReserveFloor: 0,
    conversion: { mode: "none", fixedAmount: 50_000, bracketCeiling: 0.22, startAge: 60, endAge: 74, taxSource: "taxable" },
    beneficiary: "heirTenYear",
    assumptions: {
      bracketIndexPct: 2.3,
      ssColaPct: 2.5,
      displayInflationPct: 2.5,
      volatilityByBucketPct: { traditional: 12, roth: 12, taxable: 6, spouse: 10, kids: 12, trump: 12 },
    },
    ...overrides,
  };
}

const flatVol = (value: number) =>
  ({ traditional: value, roth: value, taxable: value, spouse: value, kids: value, trump: value });

describe("simulate", () => {
  it("produces a row per year and pays spending", () => {
    const result = simulate(makeProfile());
    expect(result.rows).toHaveLength(35);
    const firstYear = result.rows[0];
    expect(firstYear.age).toBe(60);
    // no SS yet: taxable + traditional cover spending
    expect(firstYear.fromTaxable + firstYear.fromTraditional).toBeGreaterThan(0);
    expect(firstYear.shortfall).toBe(0);
    // kids bucket starts paying school when it begins at 63
    const schoolYear = result.rows.find((row) => row.age === 63);
    expect(schoolYear?.fromKids ?? 0).toBeGreaterThan(0);
  });

  it("forces RMDs from 75 for someone born in 1968", () => {
    const result = simulate(makeProfile({ baseSpending: 10_000, extraExpenses: [] }));
    const before = result.rows.find((row) => row.age === 74);
    const after = result.rows.find((row) => row.age === 75);
    expect(before?.rmd ?? 0).toBe(0);
    expect(after?.rmd ?? 0).toBeGreaterThan(0);
  });

  it("bracket-fill conversions never cross the ceiling", () => {
    const profile = makeProfile({
      conversion: { mode: "bracketFill", fixedAmount: 0, bracketCeiling: 0.22, startAge: 60, endAge: 74, taxSource: "taxable" },
    });
    const result = simulate(profile);
    for (const row of result.rows.filter((r) => r.conversion > 0)) {
      expect(row.marginalRate).toBeLessThanOrEqual(0.22 + 1e-9);
    }
  });

  it("depletes when spending is absurd", () => {
    const result = simulate(makeProfile({ baseSpending: 400_000 }));
    expect(result.depleted).toBe(true);
    expect(result.depletionAge).not.toBeNull();
  });

  it("uses roth only after other buckets", () => {
    const result = simulate(makeProfile({ balances: { traditional: 50_000, roth: 500_000, taxable: 20_000, spouse: 0, kids: 0, trump: 0 } }));
    const firstRothYear = result.rows.find((row) => row.fromRoth > 0);
    expect(firstRothYear).toBeDefined();
    // by the time roth is tapped, traditional and taxable are (near) empty
    expect(firstRothYear!.balances.traditional).toBeLessThan(1_000);
  });
});

describe("terminal tax by beneficiary", () => {
  it("NRA spouse pays a flat 30%", () => {
    const profile = makeProfile({ beneficiary: "nraSpouse" });
    expect(terminalTax(profile, 100_000, undefined)).toBeCloseTo(30_000, 0);
  });

  it("10-year heir spread beats one-year lump sum", () => {
    const heir = terminalTax(makeProfile({ beneficiary: "heirTenYear" }), 800_000, undefined);
    const lump = terminalTax(makeProfile({ beneficiary: "lumpSum" }), 800_000, undefined);
    expect(heir).toBeLessThan(lump);
  });
});

describe("codex-parity features", () => {
  it("liquidity events add and subtract from the right bucket at the right age", () => {
    const result = simulate(
      makeProfile({
        liquidityEvents: [
          { id: 1, label: "Asset sale", amount: 150_000, age: 62, bucket: "taxable" },
          { id: 2, label: "Car", amount: -60_000, age: 62, bucket: "spouse" },
        ],
      }),
    );
    const row = result.rows.find((r) => r.age === 62)!;
    expect(row.liquidityNet).toBeCloseTo(90_000, 0);
    const baseline = simulate(makeProfile());
    const baseRow = baseline.rows.find((r) => r.age === 62)!;
    expect(row.balances.spouse).toBeLessThan(baseRow.balances.spouse);
  });

  it("a purchase cannot overdraw its bucket", () => {
    const result = simulate(
      makeProfile({
        balances: { traditional: 800_000, roth: 0, taxable: 100_000, spouse: 10_000, kids: 0, trump: 0 },
        liquidityEvents: [{ id: 1, label: "Car", amount: -60_000, age: 61, bucket: "spouse" }],
      }),
    );
    const row = result.rows.find((r) => r.age === 61)!;
    expect(row.balances.spouse).toBeGreaterThanOrEqual(0);
  });

  it("child Social Security pays only while parent benefit runs and child is under 18", () => {
    const profile = makeProfile({ childSocialSecurityAnnual: 12_000, childBirthYears: [2024] });
    const result = simulate(profile);
    const beforeParent = result.rows.find((r) => r.age === 65)!; // parent SS starts at 67
    const active = result.rows.find((r) => r.age === 67)!; // child ~11
    expect(beforeParent.childSocialSecurity).toBe(0);
    expect(active.childSocialSecurity).toBeGreaterThan(0);
    const childTurns18Year = 2024 + 18;
    const after = result.rows.find((r) => r.calendarYear === childTurns18Year + 1);
    expect(after?.childSocialSecurity ?? 0).toBe(0);

    // SSA allows 19 while still a full-time K-12 student — configurable
    const extended = simulate(makeProfile({ childSocialSecurityAnnual: 12_000, childSsEndAge: 19 }));
    const at18 = extended.rows.find((r) => r.calendarYear === childTurns18Year)!;
    expect(at18.childSocialSecurity).toBeGreaterThan(0);
  });

  it("a minor heir stretches the terminal spread beyond 10 years (lower tax)", () => {
    // horizon 70: son (born 2024) is ~15 at inheritance → (21-15)+10 = 16-year spread
    const minorHeir = terminalTax(
      makeProfile({ horizonAge: 70 }),
      800_000,
      { calendarYear: 2039 } as never,
    );
    const adultHeir = terminalTax(
      makeProfile({ childBirthYears: [1995] }),
      800_000,
      { calendarYear: 2039 } as never,
    );
    expect(minorHeir).toBeLessThan(adultHeir);
  });

  it("trump account pays inside its window and stops when empty", () => {
    const profile = makeProfile({
      balances: { traditional: 800_000, roth: 0, taxable: 100_000, spouse: 200_000, kids: 50_000, trump: 40_000 },
      trumpWithdrawal: { annual: 15_000, startAge: 62, endAge: 70 },
    });
    const result = simulate(profile);
    const before = result.rows.find((r) => r.age === 61)!;
    const during = result.rows.find((r) => r.age === 62)!;
    expect(before.fromTrump).toBe(0);
    expect(during.fromTrump).toBeCloseTo(15_000, 0);
    const totalTrump = result.rows.reduce((sum, r) => sum + r.fromTrump, 0);
    expect(totalTrump).toBeGreaterThan(40_000); // balance plus growth, capped by window
  });

  it("spouse money never creates US tax", () => {
    // fund the household from the spouse bucket alone: zero federal tax, ever
    const result = simulate(
      makeProfile({
        balances: { traditional: 0, roth: 0, taxable: 0, spouse: 3_000_000, kids: 0, trump: 0 },
        socialSecurityAnnual: 0,
        extraExpenses: [],
      }),
    );
    expect(result.rows.every((row) => row.tax === 0)).toBe(true);
    expect(result.totals.tax).toBe(0);
    expect(result.rows.some((row) => row.fromSpouse > 0)).toBe(true);
  });

  it("spouse-first priority delays IRA withdrawals", () => {
    const iraFirst = simulate(makeProfile({ spousePriority: "afterTraditional" }));
    const spouseFirst = simulate(makeProfile({ spousePriority: "beforeTraditional" }));
    const iraYear1 = iraFirst.rows[0].fromTraditional;
    const spouseYear1 = spouseFirst.rows[0].fromTraditional;
    expect(spouseFirst.rows[0].fromSpouse).toBeGreaterThan(0);
    expect(spouseYear1).toBeLessThanOrEqual(iraYear1);
  });

  it("return phases override base returns by age band", () => {
    const flat = makeProfile({ baseSpending: 10_000, extraExpenses: [] });
    const phased = makeProfile({
      baseSpending: 10_000,
      extraExpenses: [],
      returnPhases: [
        {
          id: 1,
          label: "Crash decade",
          startAge: 60,
          endAge: 69,
          returnsPct: { traditional: -2, roth: -2, taxable: -2, spouse: -2, kids: -2, trump: -2 },
        },
      ],
    });
    const flatResult = simulate(flat);
    const phasedResult = simulate(phased);
    const flat65 = Object.values(flatResult.rows.find((r) => r.age === 65)!.balances).reduce((a, b) => a + b, 0);
    const phased65 = Object.values(phasedResult.rows.find((r) => r.age === 65)!.balances).reduce((a, b) => a + b, 0);
    expect(phased65).toBeLessThan(flat65);
    // after the phase ends, base returns resume (gap keeps compounding, so just check direction)
    const phased80 = Object.values(phasedResult.rows.find((r) => r.age === 80)!.balances).reduce((a, b) => a + b, 0);
    expect(phased80).toBeGreaterThan(0);
  });

  it("strategy lab adds a spouse-priority dimension when spouse assets exist", () => {
    const withSpouse = strategyLab(makeProfile());
    const withoutSpouse = strategyLab(
      makeProfile({ balances: { traditional: 800_000, roth: 0, taxable: 100_000, spouse: 0, kids: 50_000, trump: 0 } }),
    );
    expect(withSpouse.length).toBe(10);
    expect(withoutSpouse.length).toBe(5);
  });
});

describe("529 K-12 cap and fractional start ages", () => {
  it("caps 529 draws at $20k/yr per school-age child, uncapped at college age", () => {
    const profile = makeProfile({
      childBirthYears: [2024],
      balances: { traditional: 800_000, roth: 0, taxable: 300_000, spouse: 200_000, kids: 400_000, trump: 0 },
      extraExpenses: [
        { id: 1, label: "School", annualAmount: 35_000, startAge: 63, endAge: 76, inflationPct: 0, isEducation: true },
        { id: 2, label: "College", annualAmount: 60_000, startAge: 84, endAge: 87, inflationPct: 0, isEducation: true },
      ],
    });
    const result = simulate(profile);
    // child (born 2024) is 12 at James-age 68 → K-12: capped at 20k despite the 35k expense
    const k12Year = result.rows.find((row) => row.age === 68)!;
    expect(k12Year.fromKids).toBeCloseTo(20_000, 0);
    // at James-age 84 the child is 28 — no child under 18 → college draw is uncapped
    const collegeYear = result.rows.find((row) => row.age === 84)!;
    expect(collegeYear.fromKids).toBeGreaterThan(20_000);
    expect(collegeYear.fromKids).toBeLessThanOrEqual(60_000);
  });

  it("runs from any user-set start age, including 59.5 and pre-59.5 with penalty", () => {
    const half = simulate(makeProfile({ planStartAge: 59.5 }));
    expect(half.rows[0].age).toBe(59.5);
    expect(half.rows[1].age).toBe(60.5);
    expect(half.rows.every((row) => Number.isFinite(row.tax))).toBe(true);

    const early = simulate(makeProfile({ planStartAge: 55 }));
    expect(early.rows[0].age).toBe(55);
    expect(early.rows[0].penalty).toBeGreaterThanOrEqual(0);
    const penalized = early.rows.filter((row) => row.age < 59.5 && row.fromTraditional > 0);
    expect(penalized.every((row) => row.penalty > 0)).toBe(true);
  });

  it("records conversion tax paid from the taxable bucket", () => {
    const result = simulate(
      makeProfile({
        balances: { traditional: 800_000, roth: 0, taxable: 300_000, spouse: 200_000, kids: 0, trump: 0 },
        conversion: { mode: "fixed", fixedAmount: 80_000, bracketCeiling: 0.22, startAge: 60, endAge: 70, taxSource: "taxable" },
      }),
    );
    const conversionYear = result.rows.find((row) => row.conversion > 0)!;
    expect(conversionYear.conversionTaxFromTaxable).toBeGreaterThan(0);
    expect(conversionYear.conversionTaxFromTaxable).toBeLessThanOrEqual(conversionYear.tax);
  });

  it("pre-59.5 Roth conversions carry no penalty; pre-59.5 spending withdrawals do", () => {
    // plenty of taxable money: spending never touches the IRA, only conversions do
    const convertOnly = simulate(
      makeProfile({
        planStartAge: 57,
        balances: { traditional: 500_000, roth: 0, taxable: 900_000, spouse: 0, kids: 0, trump: 0 },
        extraExpenses: [],
        conversion: { mode: "fixed", fixedAmount: 50_000, bracketCeiling: 0.22, startAge: 57, endAge: 60, taxSource: "taxable" },
      }),
    );
    const conversionYear = convertOnly.rows.find((row) => row.age === 57)!;
    expect(conversionYear.conversion).toBeCloseTo(50_000, 0);
    expect(conversionYear.penalty).toBe(0);

    // no taxable money: spending must come from the IRA before 59.5 → penalized
    const spendOnly = simulate(
      makeProfile({
        planStartAge: 57,
        balances: { traditional: 500_000, roth: 0, taxable: 0, spouse: 0, kids: 0, trump: 0 },
        extraExpenses: [],
        conversion: { mode: "none", fixedAmount: 0, bracketCeiling: 0.22, startAge: 57, endAge: 60, taxSource: "taxable" },
      }),
    );
    const spendYear = spendOnly.rows.find((row) => row.age === 57)!;
    expect(spendYear.fromTraditional).toBeGreaterThan(0);
    expect(spendYear.penalty).toBeGreaterThan(0);
  });

  it("liquidity events land exactly once with fractional plan ages", () => {
    const result = simulate(
      makeProfile({
        planStartAge: 59.5,
        liquidityEvents: [{ id: 1, label: "Sale", amount: 100_000, age: 62, bucket: "taxable" }],
      }),
    );
    const hits = result.rows.filter((row) => row.liquidityNet > 0);
    expect(hits).toHaveLength(1);
    expect(Math.abs(hits[0].age - 62)).toBeLessThanOrEqual(0.5);
  });
});

describe("spouse reserve floor & conversion guide", () => {
  it("never spends the spouse bucket below the floor, in either priority", () => {
    for (const priority of ["beforeTraditional", "afterTraditional"] as const) {
      const result = simulate(
        makeProfile({
          spousePriority: priority,
          spouseReserveFloor: 80_000,
          baseSpending: 120_000, // hungry plan that would otherwise drain her bucket
        }),
      );
      for (const row of result.rows) {
        // balances grow after spending, so the floor bounds every year-end too
        expect(row.balances.spouse).toBeGreaterThanOrEqual(80_000 - 1);
      }
    }
  });

  it("guide: bigger projected IRA raises the recommended ceiling", () => {
    const small = conversionGuide(makeProfile({ balances: { traditional: 200_000, roth: 0, taxable: 100_000, spouse: 200_000, kids: 0, trump: 0 } }));
    const huge = conversionGuide(
      makeProfile({
        balances: { traditional: 3_000_000, roth: 0, taxable: 500_000, spouse: 500_000, kids: 0, trump: 0 },
        returnPhases: [{ id: 1, label: "boom", startAge: 60, endAge: 69, returnsPct: { traditional: 20, roth: 20, taxable: 20, spouse: 20, kids: 20, trump: 20 } }],
      }),
    );
    expect(small.recommendedCeiling).toBeLessThanOrEqual(huge.recommendedCeiling);
    expect(huge.recommendedCeiling).toBeGreaterThanOrEqual(0.22);
    expect(small.thresholds[0].balance).toBeLessThan(small.thresholds[1].balance);
  });

  it("guide: NRA-spouse beneficiary sets a 30% floor on the future rate", () => {
    const guide = conversionGuide(makeProfile({ beneficiary: "nraSpouse" }));
    expect(guide.heirFloorApplies).toBe(true);
    expect(guide.tLaterEffective).toBeGreaterThanOrEqual(0.3);
    expect(guide.recommendedCeiling).toBe(0.24);
  });
});

describe("monte carlo", () => {
  it("is deterministic for a given seed", () => {
    const profile = makeProfile();
    const first = monteCarlo(profile, 60, 7);
    const second = monteCarlo(profile, 60, 7);
    expect(first.successRate).toBe(second.successRate);
    expect(first.band[10]).toEqual(second.band[10]);
  });

  it("collapses to the deterministic path at zero volatility", () => {
    const profile = makeProfile({
      assumptions: { bracketIndexPct: 2.3, ssColaPct: 2.5, displayInflationPct: 2.5, volatilityByBucketPct: flatVol(0) },
    });
    const mc = monteCarlo(profile, 25, 1);
    const deterministic = simulate(profile);
    const detTotal = Object.values(deterministic.rows[5].balances).reduce((a, b) => a + b, 0);
    expect(mc.band[5].p10).toBeCloseTo(detTotal, 0);
    expect(mc.band[5].p90).toBeCloseTo(detTotal, 0);
  });

  it("lower spending raises the success rate", () => {
    const tight = monteCarlo(makeProfile({ baseSpending: 120_000 }), 80, 3);
    const comfy = monteCarlo(makeProfile({ baseSpending: 40_000 }), 80, 3);
    expect(comfy.successRate).toBeGreaterThanOrEqual(tight.successRate);
    expect(comfy.successRate).toBeGreaterThan(0.5);
  });
});

describe("strategy lab", () => {
  it("returns comparable candidates and a defensible winner", () => {
    const profile = makeProfile();
    const lab = strategyLab(profile);
    expect(lab.some((candidate) => candidate.id.startsWith("none"))).toBe(true);
    expect(lab.length).toBeGreaterThanOrEqual(5);
    const winner = bestStrategy(lab);
    const baseline = lab.find((candidate) => candidate.id.startsWith("none"))!;
    expect(winner.result.afterTaxEndingWealth).toBeGreaterThanOrEqual(
      baseline.result.afterTaxEndingWealth - 1,
    );
  });
});

describe("income is credited before bucket draws (header order #1)", () => {
  it("spouse-first only covers what after-tax income cannot", () => {
    const result = simulate(
      makeProfile({
        spousePriority: "beforeTraditional",
        spouseReserveFloor: 0,
        balances: { traditional: 800_000, roth: 0, taxable: 100_000, spouse: 5_000_000, kids: 0, trump: 0 },
        otherIncomeAnnual: 50_000,
        otherIncomeEndAge: 120,
        extraExpenses: [],
      }),
    );
    const firstYear = result.rows[0];
    // spouse pays the need net of after-tax income, not the gross need
    expect(firstYear.fromSpouse).toBeLessThan(firstYear.spending);
    expect(firstYear.fromSpouse + firstYear.otherIncome - firstYear.tax).toBeCloseTo(firstYear.spending, 0);
    // income is consumed by spending, not swept into the taxable bucket
    expect(firstYear.fromTaxable).toBe(0);
    expect(firstYear.surplusReinvested).toBeLessThan(1);
  });

  it("does not sell taxable (realizing gains) for dollars income already covers", () => {
    const result = simulate(
      makeProfile({
        taxableGainPortionPct: 40,
        otherIncomeAnnual: 120_000,
        otherIncomeEndAge: 120,
        baseSpending: 60_000,
        extraExpenses: [],
      }),
    );
    const firstYear = result.rows[0];
    expect(firstYear.fromTaxable).toBe(0);
    expect(firstYear.realizedGains).toBe(0);
    // the genuine income surplus still sweeps into taxable
    expect(firstYear.surplusReinvested).toBeGreaterThan(0);
  });

  it("still sells taxable when income falls short, sized net of income", () => {
    const result = simulate(
      makeProfile({
        taxableGainPortionPct: 40,
        otherIncomeAnnual: 30_000,
        otherIncomeEndAge: 120,
        balances: { traditional: 0, roth: 0, taxable: 2_000_000, spouse: 0, kids: 0, trump: 0 },
        extraExpenses: [],
      }),
    );
    const firstYear = result.rows[0];
    expect(firstYear.fromTaxable).toBeGreaterThan(0);
    // after-tax income + proceeds just cover spending: no refund churn
    expect(firstYear.fromTaxable).toBeLessThan(firstYear.spending);
    expect(firstYear.surplusReinvested).toBeLessThan(1);
    expect(firstYear.shortfall).toBe(0);
  });
});

describe("conversion tax source", () => {
  const conversionSetup = {
    spousePriority: "beforeTraditional" as const,
    spouseReserveFloor: 0,
    balances: { traditional: 800_000, roth: 0, taxable: 0, spouse: 3_000_000, kids: 0, trump: 0 },
    otherIncomeAnnual: 0,
    conversion: {
      mode: "fixed" as const,
      fixedAmount: 100_000,
      bracketCeiling: 0.22,
      startAge: 60,
      endAge: 74,
      taxSource: "taxable" as const,
    },
  };

  it("default: an empty taxable bucket shaves the conversion", () => {
    const result = simulate(makeProfile(conversionSetup));
    const firstYear = result.rows[0];
    expect(firstYear.conversion).toBe(100_000);
    expect(firstYear.conversionTaxFromSpouse).toBe(0);
    // tax came out of the converted amount: Roth got less than the full conversion
    expect(firstYear.balances.roth).toBeLessThan(100_000);
  });

  it("taxableThenSpouse: spouse backstops the tax so the full conversion reaches Roth", () => {
    const result = simulate(
      makeProfile({
        ...conversionSetup,
        conversion: { ...conversionSetup.conversion, taxSource: "taxableThenSpouse" },
      }),
    );
    const firstYear = result.rows[0];
    expect(firstYear.conversion).toBe(100_000);
    expect(firstYear.conversionTaxFromSpouse).toBeGreaterThan(0);
    // full conversion lands in Roth (then grows 5% at year end)
    expect(firstYear.balances.roth).toBeCloseTo(100_000 * 1.05, 0);
  });

  it("taxableThenSpouse still respects the spouse reserve floor", () => {
    const floor = simulate(
      makeProfile({
        ...conversionSetup,
        spouseReserveFloor: 10_000_000, // everything is below the floor
        conversion: { ...conversionSetup.conversion, taxSource: "taxableThenSpouse" },
      }),
    );
    // spouse untouchable -> behaves like the default: tax shaves the conversion
    expect(floor.rows[0].conversionTaxFromSpouse).toBe(0);
  });
});
