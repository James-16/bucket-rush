/**
 * Federal tax constants for tax year 2026.
 *
 * Sources:
 * - Rev. Proc. 2025-32 (brackets, standard deductions, LTCG thresholds, 65+ additions)
 * - One Big Beautiful Bill Act, P.L. 119-21 (CTC $2,200, senior bonus deduction, 529 K-12 $20k)
 * - IRC §86 (Social Security taxability thresholds — NOT inflation indexed)
 * - IRC §1411 (NIIT thresholds — NOT inflation indexed)
 * - SECURE 2.0 (RMD ages), IRS Uniform Lifetime Table (Pub. 590-B)
 *
 * Anything indexed by law gets scaled by the user's bracket-index assumption in tax.ts;
 * the unindexed items (SS thresholds, NIIT thresholds) are deliberately kept frozen.
 */

export type FilingStatus = "single" | "hoh" | "mfs" | "mfj";

export const BASE_TAX_YEAR = 2026;

export type Bracket = { upTo: number; rate: number };

export type StatusConfig = {
  label: string;
  standardDeduction: number;
  /** additional standard deduction per qualifying condition (65+) */
  aged65Extra: number;
  brackets: Bracket[];
  /** long-term capital gains: top of 0% band, top of 15% band (taxable income) */
  ltcg: { zeroUpTo: number; fifteenUpTo: number };
  /** §86 provisional-income thresholds — frozen by law */
  ssBase: number;
  ssAdjusted: number;
  /** child tax credit phaseout start (MAGI) */
  ctcPhaseoutStart: number;
  /** §1411 NIIT MAGI threshold — frozen by law */
  niitThreshold: number;
};

export const TAX_YEAR_2026: Record<FilingStatus, StatusConfig> = {
  single: {
    label: "Single",
    standardDeduction: 16_100,
    aged65Extra: 2_050,
    brackets: [
      { upTo: 12_400, rate: 0.1 },
      { upTo: 50_400, rate: 0.12 },
      { upTo: 105_700, rate: 0.22 },
      { upTo: 201_775, rate: 0.24 },
      { upTo: 256_225, rate: 0.32 },
      { upTo: 640_600, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    ltcg: { zeroUpTo: 49_450, fifteenUpTo: 545_500 },
    ssBase: 25_000,
    ssAdjusted: 34_000,
    ctcPhaseoutStart: 200_000,
    niitThreshold: 200_000,
  },
  hoh: {
    label: "Head of household",
    standardDeduction: 24_150,
    aged65Extra: 2_050,
    brackets: [
      { upTo: 17_700, rate: 0.1 },
      { upTo: 67_450, rate: 0.12 },
      { upTo: 105_700, rate: 0.22 },
      { upTo: 201_750, rate: 0.24 },
      { upTo: 256_200, rate: 0.32 },
      { upTo: 640_600, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    ltcg: { zeroUpTo: 66_200, fifteenUpTo: 579_600 },
    ssBase: 25_000,
    ssAdjusted: 34_000,
    ctcPhaseoutStart: 200_000,
    niitThreshold: 200_000,
  },
  mfs: {
    label: "Married filing separately",
    standardDeduction: 16_100,
    aged65Extra: 1_650,
    brackets: [
      { upTo: 12_400, rate: 0.1 },
      { upTo: 50_400, rate: 0.12 },
      { upTo: 105_700, rate: 0.22 },
      { upTo: 201_775, rate: 0.24 },
      { upTo: 256_225, rate: 0.32 },
      { upTo: 384_350, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    ltcg: { zeroUpTo: 49_450, fifteenUpTo: 306_850 },
    // §86(c): $0 when the taxpayer lived with their spouse at any time during
    // the year. tax.ts applies the $0 override; these are the lived-apart values.
    ssBase: 25_000,
    ssAdjusted: 34_000,
    ctcPhaseoutStart: 200_000,
    niitThreshold: 125_000,
  },
  mfj: {
    label: "Married filing jointly",
    standardDeduction: 32_200,
    aged65Extra: 1_650,
    brackets: [
      { upTo: 24_800, rate: 0.1 },
      { upTo: 100_800, rate: 0.12 },
      { upTo: 211_400, rate: 0.22 },
      { upTo: 403_550, rate: 0.24 },
      { upTo: 512_450, rate: 0.32 },
      { upTo: 768_700, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    ltcg: { zeroUpTo: 98_900, fifteenUpTo: 613_700 },
    ssBase: 32_000,
    ssAdjusted: 44_000,
    ctcPhaseoutStart: 400_000,
    niitThreshold: 250_000,
  },
};

export const CHILD_TAX_CREDIT = 2_200; // per qualifying child under 17 (indexed post-OBBBA)
export const OTHER_DEPENDENT_CREDIT = 500; // not indexed
/** §24(b): $50 per $1,000 (or fraction thereof) of MAGI over the threshold — a step, not a slope */
export const CTC_PHASEOUT_PER_1000 = 50;

export const NIIT_RATE = 0.038;
export const EARLY_WITHDRAWAL_PENALTY = 0.1;
export const EARLY_WITHDRAWAL_AGE = 59.5;

/**
 * OBBBA senior bonus deduction — tax years 2025 through 2028 only.
 * $6,000 per eligible individual 65+; married taxpayers must file JOINTLY to
 * claim it (MFS gets $0), and an MFJ couple with both spouses 65+ gets $12,000.
 */
export const SENIOR_BONUS = {
  amount: 6_000,
  lastYear: 2028,
  magiPhaseoutStart: 75_000, // 150k MFJ
  magiPhaseoutStartMfj: 150_000,
  phaseoutRate: 0.06,
};

/** SECURE 2.0 RMD beginning age by birth year. */
export function rmdStartAge(birthYear: number): number {
  if (birthYear >= 1960) return 75;
  if (birthYear >= 1951) return 73;
  return 72;
}

/** IRS Uniform Lifetime Table (Pub. 590-B, for use in 2022 and later). */
export const UNIFORM_LIFETIME: Record<number, number> = {
  72: 27.4, 73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0,
  79: 21.1, 80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7, 84: 16.8, 85: 16.0,
  86: 15.2, 87: 14.4, 88: 13.7, 89: 12.9, 90: 12.2, 91: 11.5, 92: 10.8,
  93: 10.1, 94: 9.5, 95: 8.9, 96: 8.4, 97: 7.8, 98: 7.3, 99: 6.8,
  100: 6.4, 101: 6.0, 102: 5.6, 103: 5.2, 104: 4.9, 105: 4.6, 106: 4.3,
  107: 4.1, 108: 3.9, 109: 3.7, 110: 3.5, 111: 3.4, 112: 3.3, 113: 3.1,
  114: 3.0, 115: 2.9, 116: 2.8, 117: 2.7, 118: 2.5, 119: 2.3, 120: 2.0,
};

/** Flat withholding on US-source IRA distributions to a nonresident alien with no treaty (e.g. Hong Kong). */
export const NRA_WITHHOLDING_RATE = 0.3;

/**
 * 529 K-12 tuition distribution limit, per beneficiary per year (OBBBA,
 * distributions after 2025). Higher-education withdrawals are uncapped.
 */
export const K12_529_ANNUAL_LIMIT = 20_000;

/** Self-employment tax (SECA): 15.3% on 92.35% of net SE income; half deductible. */
export const SE_TAX = {
  netEarningsFactor: 0.9235,
  socialSecurityRate: 0.124,
  medicareRate: 0.029,
  /** 2026 Social Security wage base (SSA); wage-indexed, approximated by the bracket index */
  wageBase2026: 184_500,
};

/**
 * §3101(b)(2) Additional Medicare Tax: 0.9% on SE earnings over the threshold.
 * Thresholds are statutorily frozen (not indexed), uncapped, and the extra
 * 0.9% is NOT part of the half-SECA deduction.
 */
export const ADDITIONAL_MEDICARE = {
  rate: 0.009,
  threshold: { single: 200_000, hoh: 200_000, mfs: 125_000, mfj: 250_000 } as Record<
    FilingStatus,
    number
  >,
};

export const TAX_DATA_LABEL = "Tax data: 2026 (Rev. Proc. 2025-32 + OBBBA)";
