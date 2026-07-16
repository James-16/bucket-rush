import { describe, expect, it } from "vitest";
import { federalTax, headroomToBracket, rmdFor, taxableSocialSecurity, type TaxInput } from "../tax";
import { rmdStartAge, TAX_YEAR_2026 } from "../taxData";

const base: TaxInput = {
  calendarYear: 2026,
  age: 60,
  filingStatus: "hoh",
  livesWithSpouse: true,
  iraOrdinaryIncome: 0,
  earlyDistribution: 0,
  otherOrdinaryIncome: 0,
  longTermGains: 0,
  shortTermGains: 0,
  socialSecurityBenefit: 0,
  childrenUnder17: 0,
  otherDependents: 0,
  bracketIndexRate: 0,
};

describe("ordinary brackets (2026, HoH)", () => {
  it("taxes nothing under the standard deduction", () => {
    expect(federalTax({ ...base, iraOrdinaryIncome: 24_150 }).tax).toBe(0);
  });

  it("hand-computed bracket case: $100k IRA withdrawal", () => {
    // taxable = 100,000 - 24,150 = 75,850
    // 10% * 17,700 + 12% * (67,450-17,700) + 22% * (75,850-67,450)
    const expected = 17_700 * 0.1 + 49_750 * 0.12 + 8_400 * 0.22;
    const result = federalTax({ ...base, iraOrdinaryIncome: 100_000 });
    expect(result.ordinaryTax).toBeCloseTo(expected, 0);
    expect(result.marginalOrdinaryRate).toBe(0.22);
  });
});

describe("Social Security taxability (§86)", () => {
  it("is zero below the base amount", () => {
    expect(
      taxableSocialSecurity({ otherIncome: 10_000, benefit: 20_000, filingStatus: "single", livesWithSpouse: false }),
    ).toBe(0);
  });

  it("uses the 50% band between thresholds", () => {
    // provisional = 20,000 + 12,000 = 32,000 → (32,000-25,000)*0.5 = 3,500
    expect(
      taxableSocialSecurity({ otherIncome: 20_000, benefit: 24_000, filingStatus: "single", livesWithSpouse: false }),
    ).toBeCloseTo(3_500, 5);
  });

  it("caps at 85% of the benefit", () => {
    expect(
      taxableSocialSecurity({ otherIncome: 200_000, benefit: 30_000, filingStatus: "hoh", livesWithSpouse: false }),
    ).toBeCloseTo(25_500, 5);
  });

  it("MFS living with spouse: taxable from the first dollar", () => {
    const apart = taxableSocialSecurity({ otherIncome: 0, benefit: 20_000, filingStatus: "mfs", livesWithSpouse: false });
    const together = taxableSocialSecurity({ otherIncome: 0, benefit: 20_000, filingStatus: "mfs", livesWithSpouse: true });
    expect(apart).toBe(0); // provisional 10k below 25k base
    expect(together).toBeGreaterThan(0);
    // thresholds are $0: min(85% of benefit, 85% of provisional) = min(17,000, 8,500)
    expect(together).toBeCloseTo(8_500, 0);
  });
});

describe("LTCG stacking", () => {
  it("0% rate when ordinary income leaves room", () => {
    const result = federalTax({ ...base, filingStatus: "single", longTermGains: 30_000 });
    // deduction 16,100 absorbs part; remaining gains sit fully in the 0% band (≤49,450)
    expect(result.ltcgTax).toBe(0);
  });

  it("gains stack on top of ordinary income into 15%", () => {
    const result = federalTax({
      ...base,
      filingStatus: "single",
      iraOrdinaryIncome: 66_100, // taxable ordinary = 50,000
      longTermGains: 10_000,
    });
    // zero-band room = 49,450 - 50,000 < 0 → all gains at 15%
    expect(result.ltcgTax).toBeCloseTo(1_500, 0);
  });
});

describe("child tax credit", () => {
  it("gives $2,200 per child under 17 and phases out", () => {
    const withKid = federalTax({ ...base, iraOrdinaryIncome: 80_000, childrenUnder17: 1 });
    const without = federalTax({ ...base, iraOrdinaryIncome: 80_000 });
    expect(without.tax - withKid.tax).toBeCloseTo(2_200, 0);

    const rich = federalTax({ ...base, iraOrdinaryIncome: 244_000, childrenUnder17: 1 });
    // AGI 244,000 → 44,000 over 200k → phaseout 2,200 → credit 0
    expect(rich.credits).toBe(0);
  });
});

describe("CTC phaseout staircase (§24(b): $50 per $1,000 or fraction thereof)", () => {
  const credits = (agi: number) =>
    federalTax({ ...base, iraOrdinaryIncome: agi, childrenUnder17: 1 }).credits;

  it("steps at every $1,000 boundary instead of sloping", () => {
    expect(credits(200_000)).toBeCloseTo(2_200, 5); // exactly at threshold: no phaseout
    expect(credits(200_001)).toBeCloseTo(2_150, 5); // $1 over → full $50 step
    expect(credits(200_999)).toBeCloseTo(2_150, 5); // same fraction of $1,000
    expect(credits(201_000)).toBeCloseTo(2_150, 5); // exactly one full $1,000
    expect(credits(201_001)).toBeCloseTo(2_100, 5); // next fraction begins
  });
});

describe("CTC phaseout thresholds are frozen (§24), only the amount indexes", () => {
  it("same nominal AGI phases out identically in 2026 and 2046", () => {
    // AGI $244,000 → $44,000 over the frozen $200k threshold → $2,200 phaseout
    const now = federalTax({ ...base, iraOrdinaryIncome: 244_000, childrenUnder17: 1 });
    const later = federalTax({
      ...base,
      calendarYear: 2046,
      iraOrdinaryIncome: 244_000,
      childrenUnder17: 1,
      bracketIndexRate: 0.023,
    });
    expect(now.credits).toBe(0); // 2,200 credit exactly phased out in 2026
    // in 2046 the credit AMOUNT has grown (~2,200×1.577≈3,470) but the
    // threshold hasn't — the same $44k excess still strips exactly $2,200
    expect(later.credits).toBeGreaterThan(0);
    expect(later.credits).toBeCloseTo(2_200 * 1.023 ** 20 - 2_200, 0);
  });
});

describe("self-employment tax (SECA)", () => {
  it("charges 15.3% on 92.35% of net SE income and deducts half", () => {
    const se = federalTax({ ...base, selfEmploymentIncome: 26_250 });
    const wages = federalTax({ ...base, otherOrdinaryIncome: 26_250 });
    const expectedSeTax = 26_250 * 0.9235 * 0.153;
    expect(se.seTax).toBeCloseTo(expectedSeTax, 0);
    // total = income tax on (income − half SECA) + SECA; income-tax part ≤ wages case
    expect(se.tax - se.seTax).toBeLessThanOrEqual(wages.tax + 1);
    expect(se.tax).toBeGreaterThan(wages.tax); // SECA dominates at this income
  });

  it("caps the Social Security portion at the wage base", () => {
    const big = federalTax({ ...base, selfEmploymentIncome: 400_000 });
    const uncapped = 400_000 * 0.9235 * 0.153;
    expect(big.seTax).toBeLessThan(uncapped);
    const baseSeca = 184_500 * 0.124 + 400_000 * 0.9235 * 0.029;
    const additionalMedicare = 0.009 * (400_000 * 0.9235 - 200_000); // HoH threshold
    expect(big.seTax).toBeCloseTo(baseSeca + additionalMedicare, -2);
  });
});

describe("Additional Medicare Tax (§3101(b)(2))", () => {
  it("adds 0.9% on SE earnings over the frozen filing-status threshold", () => {
    // mfs threshold is $125k, not $200k
    const mfs = federalTax({ ...base, filingStatus: "mfs", selfEmploymentIncome: 150_000 });
    const seEarnings = 150_000 * 0.9235; // 138,525
    const baseSeca = seEarnings * 0.153;
    expect(mfs.seTax).toBeCloseTo(baseSeca + 0.009 * (seEarnings - 125_000), 0);
  });

  it("is zero below the threshold and excluded from the half-SE deduction", () => {
    const below = federalTax({ ...base, selfEmploymentIncome: 100_000 });
    expect(below.seTax).toBeCloseTo(100_000 * 0.9235 * 0.153, 0);
    // AGI reflects half of BASE SECA only — the 0.9% never reduces income
    const big = federalTax({ ...base, selfEmploymentIncome: 400_000 });
    const baseSeca = 184_500 * 0.124 + 400_000 * 0.9235 * 0.029;
    expect(big.agi).toBeCloseTo(400_000 - baseSeca / 2, 0);
  });
});

describe("age 65+ deductions", () => {
  it("adds the extra standard deduction at 65", () => {
    const younger = federalTax({ ...base, age: 64, iraOrdinaryIncome: 80_000, calendarYear: 2040 });
    const older = federalTax({ ...base, age: 65, iraOrdinaryIncome: 80_000, calendarYear: 2040 });
    expect(older.standardDeduction - younger.standardDeduction).toBeCloseTo(2_050, 0);
  });

  it("senior bonus applies only through 2028 and phases out", () => {
    const in2028 = federalTax({ ...base, age: 66, calendarYear: 2028, iraOrdinaryIncome: 60_000 });
    const in2029 = federalTax({ ...base, age: 66, calendarYear: 2029, iraOrdinaryIncome: 60_000 });
    expect(in2028.seniorBonusDeduction).toBe(6_000);
    expect(in2029.seniorBonusDeduction).toBe(0);

    const highIncome = federalTax({ ...base, age: 66, calendarYear: 2028, iraOrdinaryIncome: 100_000 });
    // AGI 100k → 25k over 75k → reduce 1,500
    expect(highIncome.seniorBonusDeduction).toBeCloseTo(4_500, 0);
  });

  it("MFS gets no senior bonus — married claimants must file jointly", () => {
    const mfs = federalTax({
      ...base, filingStatus: "mfs", age: 66, calendarYear: 2028, iraOrdinaryIncome: 60_000,
    });
    expect(mfs.seniorBonusDeduction).toBe(0);
  });

  it("MFJ earns the bonus and the aged-65 extra once per 65+ spouse", () => {
    const mfj = { ...base, filingStatus: "mfj" as const, calendarYear: 2028, iraOrdinaryIncome: 80_000 };
    const bothOver = federalTax({ ...mfj, age: 66, spouseIs65Plus: true });
    const selfOnly = federalTax({ ...mfj, age: 66, spouseIs65Plus: false });
    const spouseOnly = federalTax({ ...mfj, age: 60, spouseIs65Plus: true });
    expect(bothOver.seniorBonusDeduction).toBe(12_000);
    expect(selfOnly.seniorBonusDeduction).toBe(6_000);
    expect(spouseOnly.seniorBonusDeduction).toBe(6_000);
    // second spouse adds their $1,650 aged-65 extra on top of the second bonus
    expect(bothOver.standardDeduction - selfOnly.standardDeduction).toBeCloseTo(1_650 + 6_000, 0);
  });
});

describe("NIIT", () => {
  it("charges 3.8% on gains above the threshold, driven by MAGI", () => {
    const result = federalTax({
      ...base,
      filingStatus: "hoh",
      iraOrdinaryIncome: 190_000,
      longTermGains: 50_000,
    });
    // MAGI ≈ 240,000 → 40,000 over 200k, NII 50,000 → NIIT on 40,000
    expect(result.niit).toBeCloseTo(0.038 * 40_000, 0);
  });

  it("is zero below the threshold", () => {
    expect(federalTax({ ...base, longTermGains: 50_000 }).niit).toBe(0);
  });
});

describe("early withdrawal penalty", () => {
  it("adds 10% under 59.5", () => {
    const early = federalTax({ ...base, age: 57, iraOrdinaryIncome: 50_000, earlyDistribution: 50_000 });
    const normal = federalTax({ ...base, age: 60, iraOrdinaryIncome: 50_000 });
    expect(early.penalty).toBeCloseTo(5_000, 5);
    expect(early.tax - normal.tax).toBeCloseTo(5_000, 5);
  });
});

describe("indexing", () => {
  it("scales brackets and deduction but freezes SS thresholds", () => {
    const now = federalTax({ ...base, iraOrdinaryIncome: 100_000, bracketIndexRate: 0.02 });
    const later = federalTax({ ...base, calendarYear: 2046, iraOrdinaryIncome: 100_000, bracketIndexRate: 0.02 });
    expect(later.tax).toBeLessThan(now.tax); // same nominal income, wider brackets
    // SS thresholds frozen: same benefit + income taxed identically in both years
    const ssNow = taxableSocialSecurity({ otherIncome: 30_000, benefit: 20_000, filingStatus: "hoh", livesWithSpouse: false });
    expect(ssNow).toBeGreaterThan(0);
  });
});

describe("RMDs", () => {
  it("matches the Uniform Lifetime Table", () => {
    expect(rmdFor(75, 75, 1_000_000)).toBeCloseTo(1_000_000 / 24.6, 2);
    expect(rmdFor(74, 75, 1_000_000)).toBe(0);
    expect(rmdStartAge(1968)).toBe(75);
    expect(rmdStartAge(1955)).toBe(73);
  });
});

describe("headroomToBracket", () => {
  it("finds the income that fills exactly to a ceiling", () => {
    const headroom = headroomToBracket({ ...base, iraOrdinaryIncome: 0 }, 0.12);
    const check = federalTax({ ...base, iraOrdinaryIncome: headroom });
    const ceiling = TAX_YEAR_2026.hoh.brackets[1].upTo;
    expect(check.ordinaryTaxableIncome).toBeLessThanOrEqual(ceiling + 1);
    expect(check.ordinaryTaxableIncome).toBeGreaterThan(ceiling - 5);
  });
});
