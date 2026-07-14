/**
 * Household simulation: one row per year from plan start to horizon.
 *
 * Spending order each year (shown in the Money Flow chart):
 *   1. Social Security (yours + child's) and other income
 *   2. Kids' 529 pays education-tagged expenses; the Trump account pays its
 *      configured amount inside its window (child money, capped at need)
 *   3. Spouse bucket — EITHER here ("spouse first": delay US-taxable
 *      withdrawals) or after the IRA (default: preserve spouse assets)
 *   4. Taxable & cash bucket (only the gain share is taxed)
 *   5. Traditional IRA (grossed up for the tax it creates; RMD forced first)
 *   6. Roth (last — protect the tax-free bucket)
 * Roth conversions happen after spending, inside the chosen age window.
 * One-time liquidity events land on their bucket at the start of their year.
 */

import { federalTax, headroomToBracket, rmdFor, type TaxInput } from "./tax";
import { BASE_TAX_YEAR, K12_529_ANNUAL_LIMIT, NRA_WITHHOLDING_RATE, rmdStartAge, TAX_YEAR_2026 } from "./taxData";
import type { BucketKey, Profile, SimResult, YearRow } from "./types";

function childrenUnder17(profile: Profile, calendarYear: number): number {
  return profile.childBirthYears.filter((birthYear) => calendarYear - birthYear < 17).length;
}

function otherDependents(profile: Profile, calendarYear: number): number {
  return profile.childBirthYears.filter((birthYear) => {
    const age = calendarYear - birthYear;
    return age >= 17 && age < 19; // rough: dependent through high school
  }).length;
}

function youngestChildAge(profile: Profile, calendarYear: number): number | null {
  if (profile.childBirthYears.length === 0) return null;
  return calendarYear - Math.max(...profile.childBirthYears);
}

function expensesFor(profile: Profile, age: number, yearIndex: number) {
  let total = profile.baseSpending * (1 + profile.spendingInflationPct / 100) ** yearIndex;
  let education = 0;
  for (const item of profile.extraExpenses) {
    if (age < item.startAge || age > item.endAge) continue;
    const yearsGrowing = Math.max(0, Math.floor(age - item.startAge));
    const amount = item.annualAmount * (1 + item.inflationPct / 100) ** yearsGrowing;
    total += amount;
    if (item.isEducation) education += amount;
  }
  return { total, education };
}

/** Age-banded return override, else the base per-bucket returns. */
export function returnsForAge(profile: Profile, age: number): Record<BucketKey, number> {
  const phase = profile.returnPhases.find((item) => age >= item.startAge && age <= item.endAge);
  return phase ? phase.returnsPct : profile.returnsPct;
}

type TaxCtx = Omit<TaxInput, "iraOrdinaryIncome" | "earlyDistribution" | "longTermGains" | "shortTermGains">;

/**
 * `earlyDistribution` defaults to the full IRA amount, but §72(t) exempts
 * amounts properly CONVERTED to Roth from the 10% penalty at any age — so
 * conversion calls pass only the spending portion.
 */
function taxFor(
  ctx: TaxCtx,
  iraOrdinary: number,
  gains: number,
  gainKindLongTerm: boolean,
  age: number,
  earlyDistribution: number = iraOrdinary,
) {
  return federalTax({
    ...ctx,
    iraOrdinaryIncome: iraOrdinary,
    earlyDistribution: age < 59.5 ? Math.max(0, earlyDistribution) : 0,
    longTermGains: gainKindLongTerm ? gains : 0,
    shortTermGains: gainKindLongTerm ? 0 : gains,
  });
}

/** Optional per-year return override, used by the Monte Carlo engine. */
export type ReturnSampler = (yearIndex: number) => Record<BucketKey, number>;

export function simulate(profile: Profile, returnSampler?: ReturnSampler): SimResult {
  const balances: Record<BucketKey, number> = { ...profile.balances };
  const startYear = BASE_TAX_YEAR + Math.max(0, Math.round(profile.planStartAge - (BASE_TAX_YEAR - profile.birthYear)));
  const rmdAge = rmdStartAge(profile.birthYear);
  const rows: YearRow[] = [];
  const totals = { tax: 0, conversions: 0, spending: 0, socialSecurity: 0, rmds: 0 };
  let depleted = false;
  let depletionAge: number | null = null;

  const years = Math.max(1, Math.round(profile.horizonAge - profile.planStartAge));

  for (let yearIndex = 0; yearIndex < years; yearIndex += 1) {
    const age = profile.planStartAge + yearIndex;
    const calendarYear = startYear + yearIndex;

    // 0. one-time liquidity events (a purchase can't overdraw its bucket);
    //    half-open window so fractional start ages like 59.5 still catch them
    let liquidityNet = 0;
    for (const event of profile.liquidityEvents) {
      if (!(event.age >= age - 0.5 && event.age < age + 0.5)) continue;
      const applied = Math.max(-balances[event.bucket], event.amount);
      balances[event.bucket] += applied;
      liquidityNet += applied;
    }

    const { total: spending, education } = expensesFor(profile, age, yearIndex);
    // Benefits are stated in today's dollars; COLA compounds from plan start.
    const colaFactor = (1 + profile.assumptions.ssColaPct / 100) ** yearIndex;
    const ssBenefit = age >= profile.socialSecurityStartAge ? profile.socialSecurityAnnual * colaFactor : 0;
    const childAge = youngestChildAge(profile, calendarYear);
    const childSsGross =
      ssBenefit > 0 && childAge !== null && childAge < 18
        ? profile.childSocialSecurityAnnual * colaFactor
        : 0;
    const otherIncome = age <= profile.otherIncomeEndAge ? profile.otherIncomeAnnual : 0;

    const ctx: TaxCtx = {
      calendarYear,
      age,
      filingStatus: profile.filingStatus,
      livesWithSpouse: profile.livesWithSpouse,
      otherOrdinaryIncome: profile.otherIncomeIsSelfEmployment ? 0 : otherIncome,
      selfEmploymentIncome: profile.otherIncomeIsSelfEmployment ? otherIncome : 0,
      socialSecurityBenefit: ssBenefit,
      childrenUnder17: childrenUnder17(profile, calendarYear),
      otherDependents: otherDependents(profile, calendarYear),
      bracketIndexRate: profile.assumptions.bracketIndexPct / 100,
    };

    // 2. child money: 529 pays education — capped at the $20k/yr K-12 limit
    //    per school-age beneficiary while any child is under 18; college-age
    //    (18+) withdrawals are uncapped. Child SS and the Trump window pay
    //    household costs (child income, not the parent's taxable income).
    const kidsUnder18 = profile.childBirthYears.filter(
      (birthYear) => calendarYear - birthYear < 18,
    ).length;
    const k12Cap = kidsUnder18 > 0 ? K12_529_ANNUAL_LIMIT * kidsUnder18 : Infinity;
    const fromKids = Math.min(balances.kids, education, k12Cap);
    balances.kids -= fromKids;
    let need = Math.max(0, spending - fromKids);

    const childSs = Math.min(childSsGross, need);
    need -= childSs;

    const trumpWindow =
      age >= profile.trumpWithdrawal.startAge && age <= profile.trumpWithdrawal.endAge;
    const fromTrump = trumpWindow
      ? Math.min(balances.trump, profile.trumpWithdrawal.annual, need)
      : 0;
    balances.trump -= fromTrump;
    need -= fromTrump;

    // 3. spouse-first option (never below the reserve floor)
    const spouseAvailable = () => Math.max(0, balances.spouse - profile.spouseReserveFloor);
    let fromSpouse = 0;
    if (profile.spousePriority === "beforeTraditional") {
      fromSpouse = Math.min(spouseAvailable(), need);
      balances.spouse -= fromSpouse;
      need -= fromSpouse;
    }

    // 4. taxable bucket — cashNeed is what income + US buckets must now cover
    const cashNeed = need;
    const gainShare = Math.max(0, Math.min(100, profile.taxableGainPortionPct)) / 100;
    const fromTaxable = Math.min(balances.taxable, cashNeed);
    balances.taxable -= fromTaxable;
    const realizedGains = fromTaxable * gainShare;

    // 5. traditional — RMD forced, optionally fill bracket, then cover remaining need net of tax
    const rmd = Math.min(balances.traditional, rmdFor(age, rmdAge, balances.traditional));
    let fillTarget = 0;
    if (profile.fillBracketWithdrawals) {
      fillTarget = Math.min(
        balances.traditional,
        headroomToBracket(
          {
            ...ctx,
            iraOrdinaryIncome: 0,
            earlyDistribution: 0,
            longTermGains: realizedGains,
            shortTermGains: 0,
          },
          profile.withdrawalBracketCeiling,
        ),
      );
    }
    let fromTraditional = Math.max(rmd, fillTarget);

    // gross up the IRA withdrawal until after-tax income covers the cash need
    const deliveredWith = (iraAmount: number) =>
      ssBenefit + otherIncome + fromTaxable + iraAmount - taxFor(ctx, iraAmount, realizedGains, true, age).tax;
    if (deliveredWith(fromTraditional) < cashNeed && balances.traditional > fromTraditional) {
      let low = fromTraditional;
      let high = balances.traditional;
      for (let iteration = 0; iteration < 60; iteration += 1) {
        const midpoint = (low + high) / 2;
        if (deliveredWith(midpoint) >= cashNeed) high = midpoint;
        else low = midpoint;
      }
      fromTraditional = high;
    }
    fromTraditional = Math.min(balances.traditional, fromTraditional);
    balances.traditional -= fromTraditional;

    let taxResult = taxFor(ctx, fromTraditional, realizedGains, true, age);
    const delivered = ssBenefit + otherIncome + fromTaxable + fromTraditional - taxResult.tax;
    const surplusReinvested = Math.max(0, delivered - cashNeed);
    balances.taxable += surplusReinvested;
    let remaining = Math.max(0, cashNeed - delivered);

    // 6. spouse bucket (default position: after the IRA; floor still respected)
    if (profile.spousePriority === "afterTraditional") {
      const draw = Math.min(spouseAvailable(), remaining);
      balances.spouse -= draw;
      fromSpouse += draw;
      remaining -= draw;
    }

    // 7. roth last
    const fromRoth = Math.min(balances.roth, remaining);
    balances.roth -= fromRoth;
    remaining -= fromRoth;

    const shortfall = remaining;

    // 8. Roth conversion window (after spending; RMDs can never be converted)
    let conversion = 0;
    let conversionTaxFromTaxable = 0;
    if (
      profile.conversion.mode !== "none" &&
      age >= profile.conversion.startAge &&
      age <= profile.conversion.endAge &&
      balances.traditional > 0 &&
      shortfall <= 0
    ) {
      if (profile.conversion.mode === "fixed") {
        conversion = Math.min(balances.traditional, profile.conversion.fixedAmount);
      } else {
        conversion = Math.min(
          balances.traditional,
          headroomToBracket(
            {
              ...ctx,
              iraOrdinaryIncome: fromTraditional,
              earlyDistribution: 0,
              longTermGains: realizedGains,
              shortTermGains: 0,
            },
            profile.conversion.bracketCeiling,
          ),
        );
      }
      if (conversion > 1) {
        // penalty applies to the spending withdrawal only — never the conversion
        const withConversion = taxFor(ctx, fromTraditional + conversion, realizedGains, true, age, fromTraditional);
        const conversionTax = Math.max(0, withConversion.tax - taxResult.tax);
        // pay conversion tax from taxable bucket if possible, else shave the conversion
        const paidFromTaxable = Math.min(balances.taxable, conversionTax);
        balances.taxable -= paidFromTaxable;
        conversionTaxFromTaxable = paidFromTaxable;
        const shortTax = conversionTax - paidFromTaxable;
        balances.traditional -= conversion;
        balances.roth += Math.max(0, conversion - shortTax);
        taxResult = withConversion;
        totals.conversions += conversion;
      } else {
        conversion = 0;
      }
    }

    // grow buckets (age-banded returns, optionally shocked by Monte Carlo)
    const yearReturns = returnSampler ? returnSampler(yearIndex) : returnsForAge(profile, age);
    (Object.keys(balances) as BucketKey[]).forEach((key) => {
      balances[key] = Math.max(0, balances[key]) * (1 + yearReturns[key] / 100);
    });

    totals.tax += taxResult.tax;
    totals.spending += spending;
    totals.socialSecurity += ssBenefit;
    totals.rmds += Math.min(rmd, fromTraditional);

    const iraOrdinary = fromTraditional + conversion;
    rows.push({
      yearIndex,
      calendarYear,
      age,
      spending,
      educationSpending: education,
      socialSecurity: ssBenefit,
      taxableSocialSecurity: taxResult.taxableSocialSecurity,
      childSocialSecurity: childSs,
      otherIncome,
      liquidityNet,
      fromTaxable,
      fromTraditional,
      rmd: Math.min(rmd, fromTraditional),
      conversion,
      fromRoth,
      fromSpouse,
      fromKids,
      fromTrump,
      surplusReinvested,
      realizedGains,
      conversionTaxFromTaxable,
      tax: taxResult.tax,
      niit: taxResult.niit,
      penalty: taxResult.penalty,
      credits: taxResult.credits,
      marginalRate: taxResult.marginalOrdinaryRate,
      effectiveRateOnIra:
        iraOrdinary > 0
          ? Math.max(0, taxResult.tax - taxFor(ctx, 0, realizedGains, true, age).tax) / iraOrdinary
          : 0,
      standardDeduction: taxResult.standardDeduction,
      ordinaryTaxableIncome: taxResult.ordinaryTaxableIncome,
      bracketRows: taxResult.bracketRows,
      indexedBrackets: taxResult.indexedBrackets,
      shortfall,
      balances: { ...balances },
    });

    if (!depleted && shortfall > 1) {
      depleted = true;
      depletionAge = age;
    }
  }

  const endingBalances = { ...balances };
  const terminalTraditionalTax = terminalTax(profile, endingBalances.traditional, rows.at(-1));
  const endingTotal = (Object.keys(endingBalances) as BucketKey[]).reduce(
    (sum, key) => sum + endingBalances[key],
    0,
  );

  return {
    rows,
    depleted,
    depletionAge,
    endingBalances,
    totals,
    terminalTraditionalTax,
    afterTaxEndingWealth: endingTotal - terminalTraditionalTax,
  };
}

/**
 * What the traditional bucket still "owes" in tax when the plan ends, by heir:
 * - heirTenYear: spread over 10 years at single-filer rates (SECURE 10-year rule)
 * - nraSpouse: 30% flat withholding (no US–HK style treaty)
 * - lumpSum: one-year liquidation at the owner's status (worst case, for comparison)
 */
export function terminalTax(
  profile: Profile,
  traditionalBalance: number,
  lastRow: YearRow | undefined,
): number {
  if (traditionalBalance <= 0) return 0;
  const calendarYear = (lastRow?.calendarYear ?? BASE_TAX_YEAR) + 1;

  if (profile.beneficiary === "nraSpouse") {
    return traditionalBalance * NRA_WITHHOLDING_RATE;
  }
  if (profile.beneficiary === "lumpSum") {
    return federalTax({
      calendarYear,
      age: 80,
      filingStatus: profile.filingStatus,
      livesWithSpouse: profile.livesWithSpouse,
      iraOrdinaryIncome: traditionalBalance,
      earlyDistribution: 0,
      otherOrdinaryIncome: 0,
      longTermGains: 0,
      shortTermGains: 0,
      socialSecurityBenefit: 0,
      childrenUnder17: 0,
      otherDependents: 0,
      bracketIndexRate: profile.assumptions.bracketIndexPct / 100,
    }).tax;
  }
  // heirTenYear
  const perYear = traditionalBalance / 10;
  let total = 0;
  for (let index = 0; index < 10; index += 1) {
    total += federalTax({
      calendarYear: calendarYear + index,
      age: 40,
      filingStatus: "single",
      livesWithSpouse: false,
      iraOrdinaryIncome: perYear,
      earlyDistribution: 0,
      otherOrdinaryIncome: 0,
      longTermGains: 0,
      shortTermGains: 0,
      socialSecurityBenefit: 0,
      childrenUnder17: 0,
      otherDependents: 0,
      bracketIndexRate: profile.assumptions.bracketIndexPct / 100,
    }).tax;
  }
  return total;
}

/** Deflator for the today's-dollars display toggle. */
export function deflator(profile: Profile, yearIndex: number): number {
  return (1 + profile.assumptions.displayInflationPct / 100) ** yearIndex;
}

export type StrategyCandidate = {
  id: string;
  label: string;
  description: string;
  result: SimResult;
};

/**
 * A small, explainable strategy set: conversion plans × (when spouse assets
 * exist) which side of the IRA the spouse bucket sits on.
 */
export function strategyLab(profile: Profile): StrategyCandidate[] {
  const conversionWindow = {
    startAge: profile.conversion.startAge,
    endAge: profile.conversion.endAge,
  };
  const conversionPlans: { id: string; label: string; description: string; patch: Partial<Profile> }[] = [
    {
      id: "none",
      label: "No conversions",
      description: "Spend in the chosen order, never convert. The baseline.",
      patch: { conversion: { ...profile.conversion, mode: "none" } },
    },
    ...[0.12, 0.22, 0.24].map((ceiling) => ({
      id: `fill-${ceiling}`,
      label: `Convert to top of ${Math.round(ceiling * 100)}%`,
      description: `Each year of the window, convert just enough to fill the ${Math.round(ceiling * 100)}% bracket — never spilling into the next one.`,
      patch: {
        conversion: {
          ...profile.conversion,
          ...conversionWindow,
          mode: "bracketFill" as const,
          bracketCeiling: ceiling,
        },
      },
    })),
    {
      id: "fixed-50",
      label: "Convert $50k/yr",
      description: "A flat $50,000 conversion each year of the window, whatever the bracket.",
      patch: {
        conversion: { ...profile.conversion, ...conversionWindow, mode: "fixed", fixedAmount: 50_000 },
      },
    },
  ];

  const spouseOptions: { id: string; label: string; priority: Profile["spousePriority"] }[] =
    profile.balances.spouse > 0
      ? [
          { id: "ira-first", label: "IRA first", priority: "afterTraditional" },
          { id: "spouse-first", label: "spouse first", priority: "beforeTraditional" },
        ]
      : [{ id: "only", label: "", priority: profile.spousePriority }];

  const candidates: StrategyCandidate[] = [];
  for (const spouseOption of spouseOptions) {
    for (const plan of conversionPlans) {
      candidates.push({
        id: spouseOptions.length > 1 ? `${plan.id}--${spouseOption.id}` : plan.id,
        label: spouseOption.label ? `${plan.label} · ${spouseOption.label}` : plan.label,
        description: plan.description,
        result: simulate({ ...profile, ...plan.patch, spousePriority: spouseOption.priority }),
      });
    }
  }
  return candidates;
}

export function bestStrategy(candidates: StrategyCandidate[]): StrategyCandidate {
  return [...candidates].sort((left, right) => {
    const survivorDiff = Number(right.result.depleted === false) - Number(left.result.depleted === false);
    if (survivorDiff !== 0) return survivorDiff;
    if (left.result.depleted && right.result.depleted) {
      return (right.result.depletionAge ?? 0) - (left.result.depletionAge ?? 0);
    }
    return right.result.afterTaxEndingWealth - left.result.afterTaxEndingWealth;
  })[0];
}

export function bracketCeilingLabel(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export { TAX_YEAR_2026 };

/* ------------------------------------------------------------------ */
/* Monte Carlo                                                         */
/* ------------------------------------------------------------------ */

/** Deterministic PRNG (mulberry32) so results are reproducible and testable. */
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box–Muller. */
function gaussian(random: () => number) {
  const u = Math.max(random(), 1e-12);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export type MonteCarloResult = {
  trials: number;
  /** share of futures where money lasts to the horizon */
  successRate: number;
  /** per-year percentiles of total household wealth (nominal) */
  band: { yearIndex: number; age: number; p10: number; p50: number; p90: number }[];
  medianDepletionAge: number | null;
};

/**
 * Re-run the whole simulation `trials` times with random annual market shocks.
 * One shock per year drives every bucket (markets are correlated), scaled by the
 * each bucket's own volatility, on top of the age-banded expected returns —
 * so a 6%-vol cash bucket wobbles less than a 12%-vol equity bucket in the
 * same crash. Same seed → same answer.
 */
export function monteCarlo(profile: Profile, trials = 200, seed = 42): MonteCarloResult {
  const volatility = profile.assumptions.volatilityByBucketPct;
  const random = mulberry32(seed);
  const years = Math.max(1, Math.round(profile.horizonAge - profile.planStartAge));
  const totalsPerYear: number[][] = Array.from({ length: years }, () => []);
  const depletionAges: number[] = [];
  let successes = 0;

  for (let trial = 0; trial < trials; trial += 1) {
    const shocks = Array.from({ length: years }, () => gaussian(random));
    const sampler: ReturnSampler = (yearIndex) => {
      const shock = shocks[yearIndex];
      const base = returnsForAge(profile, profile.planStartAge + yearIndex);
      const out = {} as Record<BucketKey, number>;
      (Object.keys(base) as BucketKey[]).forEach((key) => {
        out[key] = base[key] + shock * (volatility[key] ?? 0);
      });
      return out;
    };
    const result = simulate(profile, sampler);
    if (!result.depleted) successes += 1;
    else if (result.depletionAge !== null) depletionAges.push(result.depletionAge);
    result.rows.forEach((row, index) => {
      const total = Object.values(row.balances).reduce((sum, value) => sum + value, 0);
      totalsPerYear[index]?.push(total);
    });
  }

  const percentile = (sorted: number[], fraction: number) =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * sorted.length)))] ?? 0;

  const band = totalsPerYear.map((totals, yearIndex) => {
    const sorted = [...totals].sort((left, right) => left - right);
    return {
      yearIndex,
      age: profile.planStartAge + yearIndex,
      p10: percentile(sorted, 0.1),
      p50: percentile(sorted, 0.5),
      p90: percentile(sorted, 0.9),
    };
  });

  const sortedDepletions = [...depletionAges].sort((left, right) => left - right);
  return {
    trials,
    successRate: successes / trials,
    band,
    medianDepletionAge:
      sortedDepletions.length > trials / 2
        ? sortedDepletions[Math.floor(sortedDepletions.length / 2)]
        : null,
  };
}
