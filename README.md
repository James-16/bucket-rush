# 🪣 Bucket Rush

**Outsmart the taxman, save your future selves.**

A fast-paced neon arcade game that secretly teaches retirement tax strategy.
Tanks hold your money-water. A lovable bureaucrat named **Sam** owns a growing
slice of the IOU Tank. Between you and the sparkling Freedom Tank stands Sam's
Toll Bridge with discount bins that reset every January. Pour smart, pour
cheap, beat your ghost.

The game runs on the same simulation engine as
[Buckets & Brackets](https://github.com/James-16/buckets-and-brackets) — a
simplified educational model of 2026 US federal tax law (brackets, RMDs,
conversions, SECA, the 5-year Roth conversion rule), skinned as a waterworks.
It is a teaching toy, not tax advice.

## Play

```bash
npm install
npm run dev     # http://localhost:5199
```

Tap tanks to douse the yearly expense fire; choose a pour plan and watch the
**Time River** at the bottom — your future, re-drawn instantly every time you
change your mind.

## Status: M1 — Fire Season

- [x] Engine ported with all tests (71 total)
- [x] Five live tanks (IOU / Freedom / Wallet / Offshore Vault / Kid Jar)
- [x] Sam's shadow slice — his cut of the IOU tank, visible and growing
- [x] Fire Season: yearly expense fire, tap-to-douse, real incremental tax per squirt
- [x] Pour plans (none / 12¢ / 22¢ bins) with Vault-pays-toll option
- [x] Bouncer at the IOU tank (pre-59½ penalty) AND the Freedom Tank
      (10% recapture on conversion dollars younger than 5 tax years)
- [x] Prototype Time River with depletion glow + conversion ticks
- [x] zzfx procedural sound (no audio assets)

## Model limitations (honest about the honesty)

- Federal only — no state tax, no foreign earned income exclusion (FEIE) yet,
  even for the expat demo household.
- Roth ordering is simplified: starting balances count as old money, and
  age 59½+ is treated as fully qualified (the account-level 5-year clock is
  assumed met).
- "After-tax ending wealth" nets out terminal tax on the traditional IRA only;
  embedded gains in the taxable bucket are not haircut.
- RMDs always use the Uniform Lifetime Table; first-RMD April-1 deferral is
  not modeled.

## Roadmap

M1 Toll Bridge & bins with Corner Shots · M2 scrubbable Time River with
draggable action tokens · M3 objectives, report card, Ghost Race ·
M4 alarm clock RMDs, pension pigeon, storms, law-quakes · M5 levels +
tutorial + import-your-real-plan JSON · M6 juice, mix, playtests.

## Validate

```bash
npm run typecheck && npm test
```
