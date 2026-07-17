/**
 * Stepwise year engine for Fire Season: the player chooses which bucket
 * douses each chunk of the year's expense fire. Built directly on the model's
 * tax primitives so every squirt's cost is real — an IOU squirt is taxed at
 * the true incremental federal rate given everything else drawn this year.
 */

import { federalTax, headroomToBracket, rmdFor, type TaxInput } from "../model/tax";
import { BASE_TAX_YEAR, rmdStartAge } from "../model/taxData";
import { returnsForAge } from "../model/simulate";
import type { BucketKey, Profile } from "../model/types";

export type PourPlan = "off" | "fill12" | "fill22";

export type SquirtResult = {
  bucket: BucketKey;
  gross: number;
  doused: number;
  samTook: number;
  bouncerTook: number;
};

export type YearStart = {
  age: number;
  calendarYear: number;
  fireSize: number;
  rainDoused: number;
  rmdForced: SquirtResult | null;
};

export type YearEnd = {
  /** gross distribution out of the IOU tank for conversion */
  poured: number;
  /** what actually reached the Freedom Tank (poured minus Sam's skim) */
  landed: number;
  pourToll: number;
  tollFromVault: number;
  taxThisYear: number;
};

export class LiveSim {
  profile: Profile;
  balances: Record<BucketKey, number>;
  yearIndex = 0;
  fireRemaining = 0;
  gameOver = false;
  pourPlan: PourPlan = "off";
  totalTax = 0;
  totalPoured = 0;

  private iraDrawn = 0;
  private iraSpent = 0; // portion subject to the pre-59.5 bouncer
  private gainsRealized = 0;
  // Roth ordering rules (§408A(d)(4)): contributions out first, then
  // conversions FIFO, then earnings. Conversion dollars younger than 5 tax
  // years pay the bouncer's 10% recapture if drawn before 59.5; non-qualified
  // earnings pay Sam AND the bouncer. Starting Roth balance counts as old
  // money (basis), and 59.5+ is treated as fully qualified — the account
  // 5-year clock is assumed met by then.
  private rothOldMoney: number;
  private conversionLedger: { year: number; remaining: number }[] = [];
  // Roth ACCOUNT 5-tax-year clock (separate from per-conversion clocks):
  // earnings are qualified only when 59.5+ AND this clock has run. A starting
  // Roth balance without an explicit first-contribution year is assumed to
  // predate the game by 5+ years; a Roth born in-game starts the clock at its
  // first conversion.
  private rothClockYear: number | null;
  /** state at the top of the current year, BEFORE events/rain/RMD — the only
   *  honest base for re-forecasting the future mid-year */
  yearStartSnapshot: { age: number; yearIndex: number; balances: Record<BucketKey, number> };
  private ssBenefit = 0;
  private otherIncome = 0;
  private lastTax = 0;
  private readonly rmdAge: number;
  private readonly startYear: number;

  constructor(profile: Profile) {
    this.profile = profile;
    this.balances = { ...profile.balances };
    this.rothOldMoney = profile.balances.roth;
    this.rothClockYear =
      profile.rothFirstContributionYear ??
      (profile.balances.roth > 0 ? Number.NEGATIVE_INFINITY : null);
    this.yearStartSnapshot = {
      age: profile.planStartAge,
      yearIndex: 0,
      balances: { ...profile.balances },
    };
    this.rmdAge = rmdStartAge(profile.birthYear);
    this.startYear =
      BASE_TAX_YEAR + Math.max(0, Math.round(profile.planStartAge - (BASE_TAX_YEAR - profile.birthYear)));
  }

  get age(): number {
    return this.profile.planStartAge + this.yearIndex;
  }

  get calendarYear(): number {
    return this.startYear + this.yearIndex;
  }

  private taxContext(): TaxInput {
    const p = this.profile;
    return {
      calendarYear: this.calendarYear,
      age: this.age,
      filingStatus: p.filingStatus,
      livesWithSpouse: p.livesWithSpouse,
      spouseIs65Plus:
        p.spouseBirthYear !== undefined && this.calendarYear - p.spouseBirthYear >= 65,
      iraOrdinaryIncome: this.iraDrawn,
      earlyDistribution: this.age < 59.5 ? this.iraSpent : 0,
      otherOrdinaryIncome: p.otherIncomeIsSelfEmployment ? 0 : this.otherIncome,
      selfEmploymentIncome: p.otherIncomeIsSelfEmployment ? this.otherIncome : 0,
      longTermGains: this.gainsRealized,
      shortTermGains: 0,
      socialSecurityBenefit: this.ssBenefit,
      childrenUnder17: p.childBirthYears.filter((year) => this.calendarYear - year < 17).length,
      otherDependents: p.childBirthYears.filter((year) => {
        const childAge = this.calendarYear - year;
        return childAge >= 17 && childAge < 19;
      }).length,
      bracketIndexRate: p.assumptions.bracketIndexPct / 100,
    };
  }

  private recomputeTax(): number {
    const tax = federalTax(this.taxContext()).tax;
    const delta = tax - this.lastTax;
    this.lastTax = tax;
    return delta;
  }

  /** Ignite the year's fire. Income and child money fall as free rain first. */
  beginYear(): YearStart {
    const p = this.profile;
    this.iraDrawn = 0;
    this.iraSpent = 0;
    this.gainsRealized = 0;
    this.lastTax = 0;
    this.yearStartSnapshot = {
      age: this.age,
      yearIndex: this.yearIndex,
      balances: { ...this.balances },
    };

    // one-time liquidity events land on their bucket (parity with the engine)
    for (const event of p.liquidityEvents) {
      if (!(event.age >= this.age - 0.5 && event.age < this.age + 0.5)) continue;
      const applied = Math.max(-this.balances[event.bucket], event.amount);
      this.balances[event.bucket] += applied;
      if (event.bucket === "roth") {
        this.rothOldMoney = Math.max(0, this.rothOldMoney + applied);
        if (applied > 0) this.rothClockYear ??= this.calendarYear;
      }
    }

    const inflate = (1 + p.spendingInflationPct / 100) ** this.yearIndex;
    let fire = p.baseSpending * inflate;
    let education = 0;
    for (const item of p.extraExpenses) {
      if (this.age < item.startAge || this.age > item.endAge) continue;
      const amount = item.annualAmount * (1 + item.inflationPct / 100) ** Math.max(0, Math.floor(this.age - item.startAge));
      fire += amount;
      if (item.isEducation) education += amount;
    }

    const cola = (1 + p.assumptions.ssColaPct / 100) ** this.yearIndex;
    this.ssBenefit = this.age >= p.socialSecurityStartAge ? p.socialSecurityAnnual * cola : 0;
    this.otherIncome = this.age <= p.otherIncomeEndAge ? p.otherIncomeAnnual : 0;
    const youngest = p.childBirthYears.length ? Math.max(...p.childBirthYears) : 0;
    const childSs =
      this.ssBenefit > 0 && youngest && this.calendarYear - youngest < p.childSsEndAge
        ? p.childSocialSecurityAnnual * cola
        : 0;

    // 529 rain on education (K-12 cap), then Trump window, then income rain
    const kidsUnder18 = p.childBirthYears.filter((year) => this.calendarYear - year < 18).length;
    const k12Cap = kidsUnder18 > 0 ? 20_000 * kidsUnder18 : Infinity;
    const from529 = Math.min(this.balances.kids, education, k12Cap);
    this.balances.kids -= from529;
    const trumpOpen = this.age >= p.trumpWithdrawal.startAge && this.age <= p.trumpWithdrawal.endAge;
    const fromTrump = trumpOpen ? Math.min(this.balances.trump, p.trumpWithdrawal.annual, fire - from529) : 0;
    this.balances.trump -= fromTrump;

    // income rain is net of the tax it creates by itself
    const incomeTaxAlone = this.recomputeTax();
    const incomeRain = Math.max(0, this.ssBenefit + this.otherIncome + childSs - incomeTaxAlone);
    const rainDoused = Math.min(fire, from529 + fromTrump + incomeRain);
    this.fireRemaining = Math.max(0, fire - rainDoused);
    // rain beyond the fire pools in the Wallet — same surplus sweep as simulate()
    const rainOverflow = Math.max(0, from529 + fromTrump + incomeRain - fire);
    this.balances.taxable += rainOverflow;

    // Sam's alarm clock: forced RMD squirts itself at the fire first
    let rmdForced: SquirtResult | null = null;
    const rmd = rmdFor(this.age, this.rmdAge, this.balances.traditional);
    if (rmd > 0) {
      rmdForced = this.squirt("traditional", rmd, true);
    }
    return { age: this.age, calendarYear: this.calendarYear, fireSize: this.fireRemaining, rainDoused, rmdForced };
  }

  available(bucket: BucketKey): number {
    if (bucket === "spouse") return Math.max(0, this.balances.spouse - this.profile.spouseReserveFloor);
    if (bucket === "kids" || bucket === "trump") return 0; // child money is rain, not a hose
    return this.balances[bucket];
  }

  /** Player (or the alarm clock) drains `gross` from a bucket onto the fire. */
  squirt(bucket: BucketKey, gross: number, forced = false): SquirtResult {
    gross = Math.min(gross, forced ? this.balances[bucket] : this.available(bucket));
    if (gross <= 0) return { bucket, gross: 0, doused: 0, samTook: 0, bouncerTook: 0 };
    this.balances[bucket] -= gross;

    let samTook = 0;
    let bouncerTook = 0;
    if (bucket === "traditional") {
      this.iraDrawn += gross;
      this.iraSpent += gross;
      const before = this.lastTax;
      const delta = this.recomputeTax();
      const penaltyPart = this.age < 59.5 ? gross * 0.1 : 0;
      bouncerTook = Math.min(delta, penaltyPart);
      samTook = Math.max(0, delta - bouncerTook);
      void before;
    } else if (bucket === "taxable") {
      this.gainsRealized += gross * (this.profile.taxableGainPortionPct / 100);
      samTook = Math.max(0, this.recomputeTax());
    } else if (bucket === "roth") {
      // ordering: old money first, then conversions FIFO, then earnings
      let left = gross;
      const fromOld = Math.min(left, this.rothOldMoney);
      this.rothOldMoney -= fromOld;
      left -= fromOld;
      let youngConversions = 0;
      for (const vintage of this.conversionLedger) {
        if (left <= 0) break;
        const take = Math.min(left, vintage.remaining);
        vintage.remaining -= take;
        left -= take;
        if (this.calendarYear - vintage.year < 5) youngConversions += take;
      }
      this.conversionLedger = this.conversionLedger.filter((vintage) => vintage.remaining > 0.01);
      const earnings = left;
      // earnings are qualified only when 59.5+ AND the account 5-year clock ran;
      // basis and conversions are never income-taxed, but young conversions
      // face the bouncer's 10% recapture before 59.5
      const clockMet =
        this.rothClockYear !== null && this.calendarYear - this.rothClockYear >= 5;
      const earningsTaxable = earnings > 0 && !(this.age >= 59.5 && clockMet);
      const penalized = this.age < 59.5 ? youngConversions + earnings : 0;
      if (earningsTaxable || penalized > 0) {
        if (earningsTaxable) this.iraDrawn += earnings; // non-qualified earnings = ordinary income
        this.iraSpent += penalized;
        const delta = this.recomputeTax();
        const penaltyPart = penalized * 0.1;
        bouncerTook = Math.min(delta, penaltyPart);
        samTook = Math.max(0, delta - bouncerTook);
      }
    }
    const doused = Math.max(0, gross - samTook - bouncerTook);
    const applied = Math.min(this.fireRemaining, doused);
    this.fireRemaining -= applied;
    // over-douse (e.g. forced RMD beyond the fire) lands in the Wallet
    if (doused > applied) this.balances.taxable += doused - applied;
    return { bucket, gross, doused: applied, samTook, bouncerTook };
  }

  everythingEmpty(): boolean {
    return (
      this.available("taxable") + this.available("traditional") + this.available("roth") + this.available("spouse") <
      1
    );
  }

  /** Fire is out (or lost): run the pour plan, collect tax, grow buckets, advance. */
  endYear(): YearEnd {
    if (this.fireRemaining > 1 && this.everythingEmpty()) this.gameOver = true;

    let poured = 0;
    let landed = 0;
    let pourToll = 0;
    let tollFromVault = 0;
    if (this.pourPlan !== "off" && this.balances.traditional > 0 && !this.gameOver) {
      const ceiling = this.pourPlan === "fill12" ? 0.12 : 0.22;
      poured = Math.min(
        this.balances.traditional,
        headroomToBracket(this.taxContext(), ceiling),
      );
      if (poured > 1) {
        // Fixed-point solve (mirrors the engine): paying the toll from the
        // Wallet SELLS assets and realizes the gain share; whatever the
        // Wallet/Vault can't cover is skimmed from the pour — skimmed dollars
        // never reach Freedom, so they're a plain distribution and the
        // bouncer takes 10% before 59.5 (§72(t) exempts only what converts).
        const gainShare = Math.max(0, Math.min(100, this.profile.taxableGainPortionPct)) / 100;
        const baseTax = this.lastTax;
        let skim = 0;
        let extraGains = 0;
        let fromWallet = 0;
        let fromVault = 0;
        for (let iteration = 0; iteration < 40; iteration += 1) {
          const candidate = federalTax({
            ...this.taxContext(),
            iraOrdinaryIncome: this.iraDrawn + poured,
            earlyDistribution: this.age < 59.5 ? this.iraSpent + skim : 0,
            longTermGains: this.gainsRealized + extraGains,
          }).tax;
          pourToll = Math.max(0, candidate - baseTax);
          fromWallet = Math.min(this.balances.taxable, pourToll);
          fromVault =
            this.profile.conversion.taxSource === "taxableThenSpouse"
              ? Math.min(this.available("spouse"), pourToll - fromWallet)
              : 0;
          const nextSkim = Math.min(poured, Math.max(0, pourToll - fromWallet - fromVault));
          const nextGains = fromWallet * gainShare;
          const settled =
            Math.abs(nextSkim - skim) < 0.01 && Math.abs(nextGains - extraGains) < 0.01;
          skim = nextSkim;
          extraGains = nextGains;
          if (settled) break;
        }
        // commit the solved state
        this.iraDrawn += poured;
        this.iraSpent += skim; // the skim faces the bouncer before 59.5
        this.gainsRealized += extraGains; // the Wallet's toll sale leaks gains
        pourToll = Math.max(0, this.recomputeTax());
        this.balances.taxable -= fromWallet;
        tollFromVault = fromVault;
        this.balances.spouse -= fromVault;
        landed = Math.max(0, poured - skim);
        this.balances.traditional -= poured;
        this.balances.roth += landed;
        // stamp the conversion's tax-year vintage for the 5-year recapture rule
        if (landed > 0) {
          this.conversionLedger.push({ year: this.calendarYear, remaining: landed });
          this.rothClockYear ??= this.calendarYear; // a Roth born in-game starts its clock now
        }
        this.totalPoured += landed; // only what actually converted counts
      } else {
        poured = 0;
      }
    }

    this.totalTax += this.lastTax;
    const taxThisYear = this.lastTax;

    const growth = returnsForAge(this.profile, this.age);
    (Object.keys(this.balances) as BucketKey[]).forEach((key) => {
      this.balances[key] = Math.max(0, this.balances[key]) * (1 + growth[key] / 100);
    });
    this.yearIndex += 1;
    // post-growth state IS next year's starting point — keep the forecast base honest
    this.yearStartSnapshot = {
      age: this.age,
      yearIndex: this.yearIndex,
      balances: { ...this.balances },
    };
    return { poured, landed, pourToll, tollFromVault, taxThisYear };
  }

  householdTotal(): number {
    return (Object.values(this.balances) as number[]).reduce((sum, value) => sum + value, 0);
  }
}

/**
 * Rebase the profile at the live game's year-start snapshot WITHOUT
 * restarting the economy: simulate() restarts its own yearIndex at 0, so the
 * inflation and COLA that have already compounded are baked into the base
 * amounts here. The result is a START-OF-YEAR strategy forecast — it replays
 * the current year on autopilot under the chosen plan; it does not know about
 * the player's mid-year squirts.
 */
export function rebasedForecastProfile(sim: LiveSim, pourPlan: PourPlan): Profile {
  const p = sim.profile;
  const snap = sim.yearStartSnapshot;
  const inflate = (1 + p.spendingInflationPct / 100) ** snap.yearIndex;
  const cola = (1 + p.assumptions.ssColaPct / 100) ** snap.yearIndex;
  const startAge = Math.floor(snap.age);
  return {
    ...p,
    planStartAge: startAge,
    balances: { ...snap.balances },
    baseSpending: p.baseSpending * inflate,
    socialSecurityAnnual: p.socialSecurityAnnual * cola,
    childSocialSecurityAnnual: p.childSocialSecurityAnnual * cola,
    conversion:
      pourPlan === "off"
        ? { ...p.conversion, mode: "none" as const }
        : {
            mode: "bracketFill" as const,
            fixedAmount: 0,
            bracketCeiling: pourPlan === "fill12" ? 0.12 : 0.22,
            startAge,
            endAge: 74,
            taxSource: p.conversion.taxSource,
          },
  };
}
