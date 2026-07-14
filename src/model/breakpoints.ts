/**
 * The "one equation" decision guide, computed live from the profile.
 *
 * Per traditional-IRA dollar: convert when today's rate < the rate that dollar
 * faces later. t_later is set by how big the un-drained IRA gets relative to
 * future bracket capacity — so the whole strategy reduces to projecting the
 * IRA at RMD age and reading the bracket table.
 */

import { simulate } from "./simulate";
import { BASE_TAX_YEAR, rmdStartAge, TAX_YEAR_2026, UNIFORM_LIFETIME } from "./taxData";
import type { Profile } from "./types";

export type ConversionGuide = {
  rmdAge: number;
  /** projected traditional balance around RMD age if you never deliberately convert */
  projectedIraAtRmd: number;
  /** IRA-at-RMD-age thresholds: below each balance, forced income stays within that bracket */
  thresholds: { rate: number; balance: number }[];
  /** the marginal rate your projected forced income lands in */
  tLater: number;
  /** t_later after the beneficiary floor (NRA spouse → 30%) */
  tLaterEffective: number;
  /** largest bracket corner strictly cheaper than tLaterEffective; 0 = don't force conversions */
  recommendedCeiling: number;
  heirFloorApplies: boolean;
};

export function conversionGuide(profile: Profile): ConversionGuide {
  const rmdAge = rmdStartAge(profile.birthYear);
  const noConversion = simulate({
    ...profile,
    conversion: { ...profile.conversion, mode: "none" },
  });
  const rmdRow =
    noConversion.rows.find((row) => row.age >= rmdAge) ?? noConversion.rows.at(-1);
  const projectedIraAtRmd = rmdRow ? rmdRow.balances.traditional : 0;

  const yearsOut = Math.max(0, rmdAge - profile.planStartAge);
  const startYear =
    BASE_TAX_YEAR + Math.max(0, Math.round(profile.planStartAge - (BASE_TAX_YEAR - profile.birthYear)));
  const factor = (1 + profile.assumptions.bracketIndexPct / 100) ** (startYear + yearsOut - BASE_TAX_YEAR);
  const cola = (1 + profile.assumptions.ssColaPct / 100) ** yearsOut;
  const ssAtRmd = profile.socialSecurityAnnual * cola;
  const taxableSs = 0.85 * ssAtRmd; // at RMD-age incomes, most of SS is taxable
  const config = TAX_YEAR_2026[profile.filingStatus];
  const deduction = (config.standardDeduction + config.aged65Extra) * factor;
  const divisor = UNIFORM_LIFETIME[Math.min(120, Math.max(72, rmdAge))] ?? 24.6;

  const corner = (rate: number) =>
    config.brackets.filter((bracket) => bracket.rate <= rate).at(-1)?.upTo ?? 0;

  const thresholds = [0.12, 0.22, 0.24].map((rate) => ({
    rate,
    balance: Math.max(0, corner(rate) * factor + deduction - taxableSs) * divisor,
  }));

  const forcedTaxable = Math.max(0, projectedIraAtRmd / divisor + taxableSs - deduction);
  const tLater =
    config.brackets.find((bracket) => forcedTaxable <= bracket.upTo * factor)?.rate ?? 0.37;
  const heirFloorApplies = profile.beneficiary === "nraSpouse";
  const tLaterEffective = Math.max(tLater, heirFloorApplies ? 0.3 : 0);
  const corners = [0.24, 0.22, 0.12];
  const recommendedCeiling = corners.find((rate) => rate < tLaterEffective - 1e-9) ?? 0;

  return {
    rmdAge,
    projectedIraAtRmd,
    thresholds,
    tLater,
    tLaterEffective,
    recommendedCeiling,
    heirFloorApplies,
  };
}
