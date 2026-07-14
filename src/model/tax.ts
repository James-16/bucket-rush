/**
 * Federal tax engine.
 *
 * Everything indexed by law is scaled by `indexFactor` (user assumption, default
 * chained-CPI-ish 2.3%/yr). Deliberately NOT indexed, per statute: §86 Social
 * Security thresholds and §1411 NIIT thresholds — the growing bite of both over
 * time is real and the model is supposed to show it.
 */

import {
  BASE_TAX_YEAR,
  CHILD_TAX_CREDIT,
  CTC_PHASEOUT_RATE,
  EARLY_WITHDRAWAL_AGE,
  EARLY_WITHDRAWAL_PENALTY,
  NIIT_RATE,
  OTHER_DEPENDENT_CREDIT,
  SE_TAX,
  SENIOR_BONUS,
  TAX_YEAR_2026,
  UNIFORM_LIFETIME,
  type FilingStatus,
} from "./taxData";

export type TaxInput = {
  calendarYear: number;
  age: number;
  filingStatus: FilingStatus;
  /** MFS + lived with spouse at any time during the year → $0 SS thresholds */
  livesWithSpouse: boolean;
  /** traditional IRA withdrawals + Roth conversions (ordinary income) */
  iraOrdinaryIncome: number;
  /** portion of iraOrdinaryIncome distributed before age 59.5 (10% penalty) */
  earlyDistribution: number;
  /** wages/interest/other ordinary income (no payroll tax modeled) */
  otherOrdinaryIncome: number;
  /** net self-employment income — adds SECA tax with the half-SE deduction */
  selfEmploymentIncome?: number;
  /** realized long-term capital gains */
  longTermGains: number;
  /** investment income taxed as ordinary (short-term gains, interest) — counts toward NIIT */
  shortTermGains: number;
  socialSecurityBenefit: number;
  childrenUnder17: number;
  otherDependents: number;
  /** annual rate applied to indexed parameters, e.g. 0.023 */
  bracketIndexRate: number;
};

export type BracketRow = { from: number; to: number; rate: number; amount: number; tax: number };

export type TaxResult = {
  tax: number;
  ordinaryTax: number;
  ltcgTax: number;
  niit: number;
  seTax: number;
  penalty: number;
  credits: number;
  taxableSocialSecurity: number;
  standardDeduction: number;
  seniorBonusDeduction: number;
  ordinaryTaxableIncome: number;
  taxableLongTermGains: number;
  agi: number;
  marginalOrdinaryRate: number;
  bracketRows: BracketRow[];
  /** indexed bracket edges for this year (for the bracket-ladder chart) */
  indexedBrackets: { upTo: number; rate: number }[];
};

export function indexFactor(calendarYear: number, rate: number): number {
  return (1 + rate) ** Math.max(0, calendarYear - BASE_TAX_YEAR);
}

export function taxableSocialSecurity({
  otherIncome,
  benefit,
  filingStatus,
  livesWithSpouse,
}: {
  otherIncome: number;
  benefit: number;
  filingStatus: FilingStatus;
  livesWithSpouse: boolean;
}): number {
  if (benefit <= 0) return 0;
  const config = TAX_YEAR_2026[filingStatus];
  // §86(c)(1)(C)(ii): MFS living with spouse → thresholds are zero.
  const zeroThresholds = filingStatus === "mfs" && livesWithSpouse;
  const base = zeroThresholds ? 0 : config.ssBase;
  const adjusted = zeroThresholds ? 0 : config.ssAdjusted;

  const provisional = otherIncome + benefit * 0.5;
  if (provisional <= base) return 0;
  if (provisional <= adjusted) {
    return Math.min(benefit * 0.5, (provisional - base) * 0.5);
  }
  const halfBand = (adjusted - base) * 0.5;
  return Math.min(
    benefit * 0.85,
    (provisional - adjusted) * 0.85 + Math.min(halfBand, benefit * 0.5),
  );
}

function ordinaryTaxAndRows(
  taxableIncome: number,
  brackets: { upTo: number; rate: number }[],
): { tax: number; rows: BracketRow[]; marginalRate: number } {
  const taxable = Math.max(0, taxableIncome);
  const rows: BracketRow[] = [];
  let tax = 0;
  let previous = 0;
  let marginalRate = 0;

  for (const bracket of brackets) {
    const amount = Math.max(0, Math.min(taxable, bracket.upTo) - previous);
    if (amount > 0) {
      tax += amount * bracket.rate;
      marginalRate = bracket.rate;
      rows.push({ from: previous, to: bracket.upTo, rate: bracket.rate, amount, tax: amount * bracket.rate });
    }
    if (taxable <= bracket.upTo) break;
    previous = bracket.upTo;
  }
  return { tax, rows, marginalRate };
}

function ltcgTaxOn(
  gains: number,
  ordinaryTaxableIncome: number,
  zeroUpTo: number,
  fifteenUpTo: number,
): number {
  const taxable = Math.max(0, gains);
  const zeroRoom = Math.max(0, zeroUpTo - ordinaryTaxableIncome);
  const atZero = Math.min(taxable, zeroRoom);
  const afterZero = taxable - atZero;
  const fifteenRoom = Math.max(0, fifteenUpTo - Math.max(ordinaryTaxableIncome, zeroUpTo));
  const atFifteen = Math.min(afterZero, fifteenRoom);
  const atTwenty = Math.max(0, afterZero - atFifteen);
  return atFifteen * 0.15 + atTwenty * 0.2;
}

export function federalTax(input: TaxInput): TaxResult {
  const config = TAX_YEAR_2026[input.filingStatus];
  const factor = indexFactor(input.calendarYear, input.bracketIndexRate);

  const indexedBrackets = config.brackets.map((bracket) => ({
    upTo: bracket.upTo === Infinity ? Infinity : bracket.upTo * factor,
    rate: bracket.rate,
  }));

  // SECA tax on net self-employment income; half of it is an above-the-line deduction.
  const seIncome = Math.max(0, input.selfEmploymentIncome ?? 0);
  const seEarnings = seIncome * SE_TAX.netEarningsFactor;
  const seTax =
    Math.min(seEarnings, SE_TAX.wageBase2026 * factor) * SE_TAX.socialSecurityRate +
    seEarnings * SE_TAX.medicareRate;
  const halfSeDeduction = seTax / 2;

  const otherIncomeForSs =
    input.iraOrdinaryIncome + input.otherOrdinaryIncome + seIncome - halfSeDeduction +
    input.shortTermGains + input.longTermGains;
  const taxableSs = taxableSocialSecurity({
    otherIncome: otherIncomeForSs,
    benefit: input.socialSecurityBenefit,
    filingStatus: input.filingStatus,
    livesWithSpouse: input.livesWithSpouse,
  });

  const ordinaryIncome =
    input.iraOrdinaryIncome + input.otherOrdinaryIncome + seIncome - halfSeDeduction +
    input.shortTermGains + taxableSs;
  const agi = Math.max(0, ordinaryIncome + input.longTermGains);

  // Standard deduction: base + 65+ addition (both indexed) + OBBBA senior bonus (2025–2028).
  let deduction = (config.standardDeduction + (input.age >= 65 ? config.aged65Extra : 0)) * factor;
  let seniorBonus = 0;
  if (input.age >= 65 && input.calendarYear <= SENIOR_BONUS.lastYear) {
    const start =
      input.filingStatus === "mfj" ? SENIOR_BONUS.magiPhaseoutStartMfj : SENIOR_BONUS.magiPhaseoutStart;
    seniorBonus = Math.max(0, SENIOR_BONUS.amount - Math.max(0, agi - start) * SENIOR_BONUS.phaseoutRate);
    deduction += seniorBonus;
  }

  const ordinaryTaxableIncome = Math.max(0, ordinaryIncome - deduction);
  const deductionLeftForGains = Math.max(0, deduction - ordinaryIncome);
  const taxableLongTermGains = Math.max(0, input.longTermGains - deductionLeftForGains);

  const { tax: ordinaryTax, rows, marginalRate } = ordinaryTaxAndRows(
    ordinaryTaxableIncome,
    indexedBrackets,
  );
  const ltcgTax = ltcgTaxOn(
    taxableLongTermGains,
    ordinaryTaxableIncome,
    config.ltcg.zeroUpTo * factor,
    config.ltcg.fifteenUpTo * factor,
  );

  // §1411 NIIT: 3.8% of the lesser of net investment income or MAGI over the
  // (unindexed) threshold. IRA distributions are not NII but raise MAGI.
  const netInvestmentIncome = Math.max(0, input.longTermGains + input.shortTermGains);
  const niit = NIIT_RATE * Math.min(netInvestmentIncome, Math.max(0, agi - config.niitThreshold));

  // Child tax credit (nonrefundable here — conservative) + other-dependent credit.
  // §24: the credit AMOUNT is indexed post-OBBBA, but the $200k/$400k phaseout
  // thresholds are statutorily frozen — do NOT index them.
  const maxCredit =
    input.childrenUnder17 * CHILD_TAX_CREDIT * factor +
    input.otherDependents * OTHER_DEPENDENT_CREDIT;
  const phaseout = Math.max(0, agi - config.ctcPhaseoutStart) * CTC_PHASEOUT_RATE;
  const availableCredit = Math.max(0, maxCredit - phaseout);
  const taxBeforeCredits = ordinaryTax + ltcgTax;
  const credits = Math.min(taxBeforeCredits, availableCredit);

  const penalty =
    input.age < EARLY_WITHDRAWAL_AGE
      ? Math.max(0, input.earlyDistribution) * EARLY_WITHDRAWAL_PENALTY
      : 0;

  return {
    tax: Math.max(0, taxBeforeCredits - credits) + niit + seTax + penalty,
    ordinaryTax,
    ltcgTax,
    niit,
    seTax,
    penalty,
    credits,
    taxableSocialSecurity: taxableSs,
    standardDeduction: deduction,
    seniorBonusDeduction: seniorBonus,
    ordinaryTaxableIncome,
    taxableLongTermGains,
    agi,
    marginalOrdinaryRate: marginalRate,
    bracketRows: rows,
    indexedBrackets,
  };
}

/**
 * How much more ordinary income (IRA withdrawal / Roth conversion) fits before
 * ordinary taxable income crosses the ceiling of the given bracket rate.
 */
export function headroomToBracket(
  input: Omit<TaxInput, "iraOrdinaryIncome"> & { iraOrdinaryIncome: number },
  ceilingRate: number,
): number {
  const config = TAX_YEAR_2026[input.filingStatus];
  const factor = indexFactor(input.calendarYear, input.bracketIndexRate);
  const eligible = config.brackets.filter((bracket) => bracket.rate <= ceilingRate);
  const ceiling = eligible.at(-1)?.upTo;
  if (ceiling === undefined) return 0;
  if (!Number.isFinite(ceiling)) return Number.POSITIVE_INFINITY;
  const indexedCeiling = ceiling * factor;

  const current = federalTax(input);
  if (current.ordinaryTaxableIncome >= indexedCeiling) return 0;

  // Binary search the extra amount (SS phase-in makes this non-linear).
  let low = 0;
  let high = indexedCeiling + input.socialSecurityBenefit + current.standardDeduction;
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const midpoint = (low + high) / 2;
    const result = federalTax({
      ...input,
      iraOrdinaryIncome: input.iraOrdinaryIncome + midpoint,
    });
    if (result.ordinaryTaxableIncome <= indexedCeiling) low = midpoint;
    else high = midpoint;
  }
  return low;
}

export function rmdFor(age: number, birthYearRmdAge: number, balance: number): number {
  if (balance <= 0 || age < birthYearRmdAge) return 0;
  const tableAge = Math.max(72, Math.min(120, Math.floor(age)));
  const divisor = UNIFORM_LIFETIME[tableAge] ?? UNIFORM_LIFETIME[120];
  return balance / divisor;
}
