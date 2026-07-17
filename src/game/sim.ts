/**
 * The demo household the game boots with. The game never fakes numbers:
 * live play runs on LiveSim and the Time River runs on simulate() — the
 * same vendored, test-covered engine that powers Buckets & Brackets.
 */

import type { Profile } from "../model/types";

/** Demo household (later: level definitions + import-your-life JSON). */
export function demoProfile(): Profile {
  return {
    birthYear: 1968,
    planStartAge: 58,
    horizonAge: 95,
    residency: "abroad",
    abroadCountry: "Hong Kong",
    usState: "",
    married: true,
    spouseIsNRA: true,
    livesWithSpouse: true,
    filingStatus: "hoh",
    childBirthYears: [2024],
    balances: { traditional: 760_000, roth: 0, taxable: 150_000, spouse: 250_000, kids: 50_000, trump: 0 },
    returnsPct: { traditional: 7, roth: 7, taxable: 5, spouse: 5, kids: 6, trump: 6 },
    returnPhases: [],
    taxableGainPortionPct: 40,
    socialSecurityAnnual: 30_000,
    socialSecurityStartAge: 67,
    childSocialSecurityAnnual: 0,
    childSsEndAge: 18,
    otherIncomeAnnual: 26_250,
    otherIncomeEndAge: 65,
    otherIncomeIsSelfEmployment: true,
    baseSpending: 60_000,
    spendingInflationPct: 3,
    extraExpenses: [
      { id: 1, label: "School", annualAmount: 20_000, startAge: 61, endAge: 76, inflationPct: 4, isEducation: true },
    ],
    liquidityEvents: [],
    trumpWithdrawal: { annual: 0, startAge: 78, endAge: 90 },
    fillBracketWithdrawals: false,
    withdrawalBracketCeiling: 0.22,
    spousePriority: "beforeTraditional",
    spouseReserveFloor: 0,
    conversion: { mode: "none", fixedAmount: 50_000, bracketCeiling: 0.22, startAge: 58, endAge: 74, taxSource: "taxable" },
    beneficiary: "heirTenYear",
    assumptions: {
      bracketIndexPct: 2.3,
      ssColaPct: 2.5,
      displayInflationPct: 2.5,
      volatilityByBucketPct: { traditional: 12, roth: 12, taxable: 6, spouse: 10, kids: 12, trump: 12 },
    },
  };
}
