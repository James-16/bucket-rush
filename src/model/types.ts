import type { FilingStatus } from "./taxData";

export type BucketKey = "traditional" | "roth" | "taxable" | "spouse" | "kids" | "trump";

export const BUCKET_ORDER: BucketKey[] = ["traditional", "roth", "taxable", "spouse", "kids", "trump"];

export const BUCKET_META: Record<
  BucketKey,
  { label: string; short: string; blurb: string }
> = {
  traditional: {
    label: "Traditional IRA / 401(k)",
    short: "Traditional",
    blurb: "Pre-tax money. Every dollar you take out is taxed as ordinary income, and RMDs eventually force money out.",
  },
  roth: {
    label: "Roth IRA",
    short: "Roth",
    blurb: "Already-taxed money. Grows tax-free, comes out tax-free, and no lifetime RMDs for the owner.",
  },
  taxable: {
    label: "Taxable & cash",
    short: "Taxable",
    blurb: "Brokerage and bank money. Only the gain portion is taxed when you sell — often at friendlier capital-gains rates.",
  },
  spouse: {
    label: "Spouse assets (outside US tax)",
    short: "Spouse",
    blurb: "A spouse's own assets outside the US tax net (e.g., a nonresident spouse abroad). Spending from here creates no US tax — unless you elect to file jointly.",
  },
  kids: {
    label: "Kids' 529 (education)",
    short: "529",
    blurb: "Education money. Qualified withdrawals are tax-free and reduce what the other buckets must cover for school.",
  },
  trump: {
    label: "Trump account (child)",
    short: "Trump",
    blurb: "The new child investment account. You choose when and how much it pays toward household costs; final tax rules are new — verify before relying on them.",
  },
};

export type ExpenseItem = {
  id: number;
  label: string;
  annualAmount: number;
  startAge: number;
  endAge: number;
  inflationPct: number;
  isEducation: boolean;
};

export type LiquidityEvent = {
  id: number;
  label: string;
  /** positive adds money, negative is a one-time purchase */
  amount: number;
  age: number;
  bucket: BucketKey;
};

export type ReturnPhase = {
  id: number;
  label: string;
  startAge: number;
  endAge: number;
  returnsPct: Record<BucketKey, number>;
};

export type ConversionPlan = {
  mode: "none" | "fixed" | "bracketFill";
  fixedAmount: number;
  bracketCeiling: number; // e.g. 0.22
  startAge: number;
  endAge: number;
};

export type Beneficiary = "heirTenYear" | "nraSpouse" | "lumpSum";

/** When the spouse bucket pays: after the IRA (preserve spouse assets) or before it (delay US-taxable withdrawals). */
export type SpousePriority = "afterTraditional" | "beforeTraditional";

export type Profile = {
  birthYear: number;
  planStartAge: number;
  horizonAge: number;

  residency: "us" | "abroad";
  abroadCountry: string;
  usState: string;

  married: boolean;
  spouseIsNRA: boolean;
  livesWithSpouse: boolean;
  filingStatus: FilingStatus;
  childBirthYears: number[];

  balances: Record<BucketKey, number>;
  returnsPct: Record<BucketKey, number>;
  /** optional age-banded overrides of returnsPct */
  returnPhases: ReturnPhase[];
  /** share of taxable-bucket withdrawals that is realized long-term gain, 0..100 */
  taxableGainPortionPct: number;

  socialSecurityAnnual: number;
  socialSecurityStartAge: number;
  /** child's benefit on your record — household cash, not your taxable income; paid while your benefit runs and the child is under childSsEndAge */
  childSocialSecurityAnnual: number;
  /** SSA: benefits end at 18, or 19 while a full-time K-12 student */
  childSsEndAge: number;
  otherIncomeAnnual: number;
  otherIncomeEndAge: number;
  /** true → other income is net self-employment income (SECA tax applies) */
  otherIncomeIsSelfEmployment: boolean;

  baseSpending: number;
  spendingInflationPct: number;
  extraExpenses: ExpenseItem[];
  liquidityEvents: LiquidityEvent[];

  /** Trump-account payout window (reduces household need; excess stays invested) */
  trumpWithdrawal: { annual: number; startAge: number; endAge: number };

  /** withdraw traditional up to this bracket even beyond need (surplus reinvested) */
  fillBracketWithdrawals: boolean;
  withdrawalBracketCeiling: number;
  spousePriority: SpousePriority;
  /** never spend the spouse bucket below this — jurisdictional insurance against
   *  future adverse US tax-law changes; this money doesn't depend on US promises */
  spouseReserveFloor: number;
  conversion: ConversionPlan;
  beneficiary: Beneficiary;

  assumptions: {
    bracketIndexPct: number; // chained-CPI-ish
    ssColaPct: number;
    displayInflationPct: number; // deflator for today's-dollars view
    /** one-sigma annual return volatility per bucket (Monte Carlo); one shared
     *  market shock drives all buckets, scaled by each bucket's own volatility */
    volatilityByBucketPct: Record<BucketKey, number>;
  };
};

export type YearRow = {
  yearIndex: number;
  calendarYear: number;
  age: number;
  spending: number;
  educationSpending: number;
  socialSecurity: number;
  taxableSocialSecurity: number;
  childSocialSecurity: number;
  otherIncome: number;
  liquidityNet: number;
  fromTaxable: number;
  fromTraditional: number;
  rmd: number;
  conversion: number;
  fromRoth: number;
  fromSpouse: number;
  fromKids: number;
  fromTrump: number;
  surplusReinvested: number;
  realizedGains: number;
  /** conversion tax paid out of the taxable bucket's balance (not from cash flow) */
  conversionTaxFromTaxable: number;
  tax: number;
  niit: number;
  penalty: number;
  credits: number;
  marginalRate: number;
  effectiveRateOnIra: number;
  standardDeduction: number;
  ordinaryTaxableIncome: number;
  bracketRows: { from: number; to: number; rate: number; amount: number; tax: number }[];
  indexedBrackets: { upTo: number; rate: number }[];
  shortfall: number;
  balances: Record<BucketKey, number>;
};

export type SimResult = {
  rows: YearRow[];
  depleted: boolean;
  depletionAge: number | null;
  endingBalances: Record<BucketKey, number>;
  totals: {
    tax: number;
    conversions: number;
    spending: number;
    socialSecurity: number;
    rmds: number;
  };
  /** estimated tax an heir/beneficiary pays on what's left in the traditional bucket */
  terminalTraditionalTax: number;
  afterTaxEndingWealth: number;
};
