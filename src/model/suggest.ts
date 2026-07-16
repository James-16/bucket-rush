/**
 * Rule-based suggestions: plain-language observations tailored to the profile
 * and the simulation, each with a "why" the user can expand. These teach the
 * relevant law; they are not individualized tax advice, and several end with
 * "verify with a professional" on purpose.
 */

import { EARLY_WITHDRAWAL_AGE, rmdStartAge } from "./taxData";
import type { Profile, SimResult } from "./types";
import type { StrategyCandidate } from "./simulate";

export type Suggestion = {
  id: string;
  kind: "tip" | "warning" | "info";
  title: string;
  body: string;
  why: string;
};

export function suggestionsFor(
  profile: Profile,
  result: SimResult,
  lab: StrategyCandidate[],
): Suggestion[] {
  const out: Suggestion[] = [];
  const firstYear = result.rows[0];

  if (profile.planStartAge < EARLY_WITHDRAWAL_AGE) {
    out.push({
      id: "early-penalty",
      kind: "warning",
      title: "Withdrawals before 59½ carry a 10% penalty",
      body: `Your plan starts at ${profile.planStartAge}. The model adds the 10% early-distribution penalty to traditional-IRA money taken before 59½. Waiting, using taxable money first, or a 72(t)/SEPP schedule (not modeled) can avoid it.`,
      why: "IRC §72(t): distributions from IRAs before age 59½ owe a 10% additional tax unless an exception applies.",
    });
  }

  if (profile.filingStatus === "mfs" && profile.livesWithSpouse && profile.socialSecurityAnnual > 0) {
    out.push({
      id: "mfs-ss-zero",
      kind: "warning",
      title: "Filing separately while living together makes Social Security taxable immediately",
      body: "Because you live with your spouse and file separately, the usual $25k/$34k thresholds drop to $0 — up to 85% of your benefit is taxable from the first dollar. The model applies this. Head of household (if you qualify via a child) usually beats MFS.",
      why: "IRC §86(c)(1)(C)(ii): the base amount is zero for married-filing-separately taxpayers who don't live apart all year.",
    });
  }

  if (profile.married && profile.spouseIsNRA && profile.filingStatus === "mfj") {
    out.push({
      id: "mfj-nra",
      kind: "warning",
      title: "Filing jointly with a nonresident spouse taxes their worldwide income",
      body: "The §6013(g) election gives you MFJ brackets, but it pulls your spouse's non-US income into the US tax net every year — and non-US funds are often PFICs with punitive treatment. This model does NOT add that tax, so MFJ looks better here than it likely is. Verify with a cross-border professional.",
      why: "IRC §6013(g): a nonresident spouse can be treated as a US resident for tax — for their entire worldwide income, not just the parts you like.",
    });
  }

  if (profile.married && profile.spouseIsNRA && profile.childBirthYears.length > 0 && profile.filingStatus !== "hoh") {
    out.push({
      id: "hoh-available",
      kind: "tip",
      title: "You may qualify for Head of Household",
      body: "Married to a nonresident alien and keeping up a home for your child? You're 'considered unmarried' for HoH — bigger deduction and wider brackets than filing separately, without taxing your spouse's income.",
      why: "IRC §7703(b) + §2(b): a US taxpayer whose spouse is a nonresident alien can claim HoH with a qualifying person.",
    });
  }

  if (profile.residency === "abroad") {
    out.push({
      id: "abroad",
      kind: "info",
      title: "Living abroad: no state tax, but the federal rules follow you",
      body: `As a US citizen abroad${profile.abroadCountry ? ` (${profile.abroadCountry})` : ""}, IRA withdrawals, conversions, and Social Security stay fully US-taxable — the foreign earned income exclusion doesn't cover them. No state tax applies, and territorial-tax countries (like Hong Kong) typically don't tax them either. Remember FBAR/Form 8938 reporting for non-US accounts.`,
      why: "US citizens are taxed on worldwide income regardless of residence; FEIE (IRC §911) only covers earned income like wages.",
    });
  }

  const rmdAge = rmdStartAge(profile.birthYear);
  const rmdRow = result.rows.find((row) => row.age >= rmdAge);
  if (rmdRow && rmdRow.rmd > 0) {
    out.push({
      id: "rmd-preview",
      kind: "info",
      title: `Required withdrawals begin at ${rmdAge}`,
      body: `Born in ${profile.birthYear}, your traditional bucket must start paying out at ${rmdAge} (first modeled RMD ≈ ${Math.round(rmdRow.rmd).toLocaleString()} in ${rmdRow.calendarYear}). Conversions before then shrink future forced, taxable withdrawals.`,
      why: "SECURE 2.0 sets the RMD beginning age at 75 for those born 1960+ (73 for 1951–59). The IRS Uniform Lifetime Table sets each year's minimum.",
    });
  }

  if (firstYear) {
    const ceiling = firstYear.indexedBrackets.find((bracket) => bracket.rate === 0.12)?.upTo ?? 0;
    const headroom = Math.max(0, ceiling - firstYear.ordinaryTaxableIncome);
    if (headroom > 5_000 && profile.conversion.mode === "none" && result.endingBalances.traditional > 0) {
      out.push({
        id: "cheap-room",
        kind: "tip",
        title: `You're leaving low-rate bracket space unused`,
        body: `In ${firstYear.calendarYear} about ${Math.round(headroom).toLocaleString()} of the 12% bracket goes unused. Converting into that space costs 12¢ on the dollar now versus potentially 22–24¢ later when RMDs stack up. Try the Strategy Lab's "Convert to top of 12%".`,
        why: "Roth conversions are taxed at your marginal rate in the conversion year. Filling only low brackets is the classic 'bracket smoothing' move.",
      });
    }
  }

  const best = lab.length
    ? [...lab].sort((a, b) => b.result.afterTaxEndingWealth - a.result.afterTaxEndingWealth)[0]
    : null;
  const baseline = lab.find((candidate) => candidate.id === "none");
  if (best && baseline && best.id !== "none") {
    const delta = best.result.afterTaxEndingWealth - baseline.result.afterTaxEndingWealth;
    if (delta > 10_000) {
      out.push({
        id: "lab-winner",
        kind: "tip",
        title: `"${best.label}" beats no conversions by ~$${Math.round(delta / 1000).toLocaleString()}k`,
        body: `Measured as after-tax wealth at age ${profile.horizonAge}, including the tax your heirs would owe on what's left in the traditional bucket. See the Strategy Lab for the full comparison.`,
        why: "Paying some tax early at low rates can beat paying more tax later at high rates — but only if the numbers say so. That's why the lab compares after-tax ending wealth, not just tax paid.",
      });
    }
  }

  if (
    profile.balances.spouse > 0 &&
    profile.spouseReserveFloor === 0 &&
    result.endingBalances.spouse < 1_000 &&
    !result.depleted
  ) {
    out.push({
      id: "spouse-reserve",
      kind: "tip",
      title: "Her bucket runs to zero — consider keeping a slice as insurance",
      body: "The plan spends the spouse bucket down completely. That's optimal in the model — but the model assumes US tax law keeps its promises about IRAs and Roths forever. Her non-US assets are your one hedge that doesn't depend on those promises. A reserve floor (Adjust the plan → Spending & income) keeps a chosen amount permanently unspent; the Strategy Lab will show you what that insurance costs in ending wealth.",
      why: "Legislative risk can't be priced by a tax model. Regime diversification — some family wealth outside the US tax system entirely — is insurance against rule changes, the same way the Roth is insurance against rate rises.",
    });
  }

  if (profile.beneficiary === "nraSpouse" && result.endingBalances.traditional > 50_000) {
    out.push({
      id: "nra-heir",
      kind: "warning",
      title: "A nonresident spouse inheriting the IRA faces 30% flat withholding",
      body: "With no US income-tax treaty (e.g., Hong Kong), IRA distributions to a nonresident heir are withheld at a flat 30%. Naming a US-person heir (like your child, using the 10-year rule) usually keeps more in the family. The model prices both — switch the beneficiary setting to compare.",
      why: "US-source retirement distributions to nonresident aliens are FDAP income withheld at 30% absent a treaty rate.",
    });
  }

  const bigSchool = profile.extraExpenses.find(
    (item) => item.isEducation && item.annualAmount > 20_000,
  );
  if (bigSchool && profile.balances.kids > 0) {
    out.push({
      id: "529-k12-cap",
      kind: "info",
      title: "The 529 can only pay $20k/yr of K-12 tuition",
      body: `"${bigSchool.label}" costs more than the federal K-12 limit, so the model draws at most $20,000/yr per school-age child from the 529 — the rest comes from your regular buckets. Once the child is 18+, college withdrawals have no annual cap, so the 529 drains faster then.`,
      why: "OBBBA raised the §529 K-12 tuition distribution limit to $20,000 per beneficiary per year for distributions after 2025; qualified higher-education expenses have no such cap.",
    });
  }

  if (profile.balances.trump > 0) {
    out.push({
      id: "trump-caveat",
      kind: "info",
      title: "Trump-account rules are new — the model keeps them editable",
      body: "Withdrawals here are modeled as child money paying household costs in your chosen window, without tax. Actual distribution taxation (likely ordinary income on earnings, to the child) is still being clarified — verify before relying on this bucket.",
      why: "OBBBA created these accounts in 2025; Treasury guidance on distribution mechanics is still filling in the details.",
    });
  }

  if (profile.otherIncomeIsSelfEmployment && profile.otherIncomeAnnual > 0) {
    out.push({
      id: "se-tax",
      kind: "info",
      title: "Self-employment tax follows you everywhere",
      body: `The model adds ~15.3% SECA tax on your ${Math.round(profile.otherIncomeAnnual).toLocaleString()} of self-employment income (with the half-SECA deduction). Living abroad doesn't help: the foreign earned income exclusion covers income tax only, and Hong Kong has no totalization agreement with the US. Note the model does NOT apply the FEIE to income tax either — the Form 2555 stacking rule means excluded income still fills the bottom brackets, so conversion costs and headroom barely change; baseline tax on this income is just slightly overstated. The upside: it keeps building your Social Security record.`,
      why: "IRC §1401 (SECA); FEIE (§911) excludes income tax, not self-employment tax, and is deliberately unmodeled — stacking makes it nearly a wash for bracket planning; SECA relief abroad requires a totalization agreement, which the US and Hong Kong don't have.",
    });
  }

  if (
    profile.childSocialSecurityAnnual > 0 &&
    profile.socialSecurityAnnual > 0 &&
    profile.childSocialSecurityAnnual > profile.socialSecurityAnnual * 0.5
  ) {
    out.push({
      id: "child-ss-max",
      kind: "warning",
      title: "Child benefit looks higher than SSA will pay",
      body: `You entered ${Math.round(profile.childSocialSecurityAnnual).toLocaleString()}/yr for your child, but a child's benefit tops out at 50% of the parent's full retirement benefit — and the family maximum (150–180% of yours) can trim it further. Enter the number from your SSA statement to be safe.`,
      why: "42 U.S.C. §402(d) caps a child's benefit at half the worker's primary insurance amount; the family maximum then applies across all beneficiaries on one record.",
    });
  }

  if (profile.childSocialSecurityAnnual > 0 && profile.socialSecurityAnnual > 0) {
    out.push({
      id: "child-ss",
      kind: "tip",
      title: "Your child can collect on your record once you do",
      body: "A minor child of a retiree can receive up to 50% of the parent's full benefit (family maximum applies) until 18. The model pays it while your benefit runs and the child is under 18, and treats it as the child's income — not yours to be taxed on.",
      why: "Social Security child's benefits (42 U.S.C. §402(d)); benefits are income of the child, taxable only on the child's own return if at all.",
    });
  }

  if (result.rows.some((row) => row.niit > 0)) {
    out.push({
      id: "niit",
      kind: "info",
      title: "Some years trigger the 3.8% net investment income tax",
      body: "Big withdrawal or conversion years raise your income above the NIIT threshold, exposing investment gains to an extra 3.8%. Spreading sales and conversions across years can duck under it — the thresholds never adjust for inflation.",
      why: "IRC §1411: 3.8% on the lesser of net investment income or MAGI above $200k (single/HoH) / $125k (MFS) / $250k (MFJ).",
    });
  }

  if (result.depleted && result.depletionAge) {
    out.push({
      id: "depleted",
      kind: "warning",
      title: `Money runs out around age ${result.depletionAge}`,
      body: "Under these assumptions the buckets empty before your horizon. Lower base spending, later Social Security, or higher returns change this fastest — drag the spending number and watch the runway.",
      why: "The simulation pays each year's spending from income and buckets in order; when everything is empty before the horizon age, that's depletion.",
    });
  }

  return out;
}
