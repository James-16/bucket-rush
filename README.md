# 🪣 Bucket Rush

**Outsmart the taxman, save your future selves.**

A fast-paced neon arcade game that secretly teaches retirement tax strategy.
Tanks hold your money-water. A lovable bureaucrat named **Sam** owns a growing
slice of the IOU Tank. Between you and the sparkling Freedom Tank stands Sam's
Toll Bridge with discount bins that reset every January. Pour smart, pour
cheap, beat your ghost.

Every drop is honest math: the game runs on the same 47-test simulation engine
as [Buckets & Brackets](https://github.com/James-16/buckets-and-brackets) —
real 2026 US federal tax law (brackets, RMDs, conversions, SECA, the works),
skinned as a waterworks.

## Play

```bash
npm install
npm run dev     # http://localhost:5199
```

Space to play/pause. Choose a pour plan and watch the **Time River** at the
bottom — your future, re-drawn instantly every time you change your mind.

## Status: M0 — walking skeleton

- [x] Engine ported with all tests
- [x] Five live tanks (IOU / Freedom / Wallet / Offshore Vault / Kid Jar)
- [x] Sam's shadow slice — his cut of the IOU tank, visible and growing
- [x] Year ticker with speeds, pour plans (none / 12¢ / 22¢ bins)
- [x] Prototype Time River with depletion glow + conversion ticks
- [x] zzfx procedural sound (no audio assets)

## Roadmap

M1 Toll Bridge & bins with Corner Shots · M2 scrubbable Time River with
draggable action tokens · M3 objectives, report card, Ghost Race ·
M4 alarm clock RMDs, pension pigeon, storms, law-quakes · M5 levels +
tutorial + import-your-real-plan JSON · M6 juice, mix, playtests.

## Validate

```bash
npm run typecheck && npm test
```
