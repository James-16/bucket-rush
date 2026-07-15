/**
 * The bridge between the game and the honest engine. The game never fakes
 * numbers: every water level, leak, and ghost comes from simulate() — the
 * same 47-test model that powers Buckets & Brackets.
 */

import { simulate } from "../model/simulate";
import type { Profile, SimResult, YearRow } from "../model/types";

/** Demo household for M0 (later: level definitions + import-your-life JSON). */
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

export type PourPlan = "off" | "fill12" | "fill22";

export class GameSim {
  profile: Profile;
  result: SimResult;
  /** fractional position along the run, in years since plan start */
  clock = 0;
  speed = 2; // years per second
  playing = false;
  pourPlan: PourPlan = "off";

  constructor(profile: Profile = demoProfile()) {
    this.profile = profile;
    this.result = simulate(profile);
  }

  get rows(): YearRow[] {
    return this.result.rows;
  }

  get yearIndex(): number {
    return Math.min(this.rows.length - 1, Math.floor(this.clock));
  }

  get currentRow(): YearRow {
    return this.rows[this.yearIndex];
  }

  get currentAge(): number {
    return this.profile.planStartAge + this.clock;
  }

  /** Interpolated bucket level for smooth water animation. */
  levelOf(key: keyof YearRow["balances"]): number {
    const index = this.yearIndex;
    const fraction = Math.min(1, this.clock - index);
    const start = index === 0 ? this.profile.balances[key] : this.rows[index - 1].balances[key];
    const end = this.rows[index].balances[key];
    return start + (end - start) * fraction;
  }

  householdTotal(): number {
    return (Object.keys(this.profile.balances) as (keyof YearRow["balances"])[]).reduce(
      (sum, key) => sum + this.levelOf(key),
      0,
    );
  }

  tick(deltaSeconds: number): { crossedYear: boolean } {
    if (!this.playing) return { crossedYear: false };
    const before = this.yearIndex;
    this.clock = Math.min(this.rows.length - 1e-6, this.clock + deltaSeconds * this.speed);
    if (this.clock >= this.rows.length - 1e-3) this.playing = false;
    return { crossedYear: this.yearIndex !== before };
  }

  /** Change the pour plan from the CURRENT age onward; the future re-simulates instantly. */
  setPourPlan(plan: PourPlan) {
    this.pourPlan = plan;
    const startAge = Math.floor(this.currentAge);
    this.profile = {
      ...this.profile,
      conversion:
        plan === "off"
          ? { ...this.profile.conversion, mode: "none" }
          : {
              mode: "bracketFill",
              fixedAmount: 0,
              bracketCeiling: plan === "fill12" ? 0.12 : 0.22,
              startAge,
              endAge: 74,
              taxSource: this.profile.conversion.taxSource,
            },
    };
    this.result = simulate(this.profile);
  }

  restart() {
    this.clock = 0;
    this.playing = false;
  }
}
