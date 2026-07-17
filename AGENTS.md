# Agent notes — bucket-rush

Neon Phaser arcade game that secretly teaches retirement tax strategy.
This repo is one of a **pair** maintained and reviewed **separately**:

- **bucket-rush** (this repo) — the game.
- **buckets-and-brackets** (github.com/James-16/buckets-and-brackets) —
  the planner where the simulation engine lives. Never review or patch the
  two as one codebase; never import across repo boundaries.

## Architecture

- `src/model/` — **vendored engine**. Must stay byte-identical to
  buckets-and-brackets `src/model/*`. Sync by copying files and porting
  their tests ("Sync engine" commits). Never fork engine logic here — fix
  it upstream first.
- `src/game/` — game-only code:
  - `liveSim.ts` — LiveSim, the stepwise year engine for Fire Season. The
    player squirts buckets at the expense fire; every squirt's cost comes
    from the model's real tax primitives. Must stay behavior-parallel to
    `simulate()` (there are engine/bridge parity tests — add more when
    syncing changes).
  - `MainScene.ts` — the Phaser scene (tanks, Sam, Time River, pour bins,
    VAULT PAYS TOLL toggle).
  - `sim.ts` — demo profile + GameSim bridge (GameSim currently unused).

## Game/engine mapping

- IOU Tank = traditional IRA, Freedom Tank = Roth, Wallet = taxable,
  Offshore Vault = spouse assets (reserve floor = unsquirtable), Kid Jar =
  529, Sam = the taxman, bouncer = pre-59.5 penalties + Roth 5-year
  recapture, pours = Roth conversions, Sam's toll = conversion tax.
- VAULT PAYS TOLL toggle = `conversion.taxSource: "taxableThenSpouse"`:
  the Vault (above its floor) covers the toll the Wallet can't, so the
  full pour reaches Freedom; LiveSim reports `tollFromVault`. Messaging
  must stay honest on partial coverage.
- Income "rain" douses the fire first; rain beyond the fire pools in the
  Wallet, mirroring `simulate()`'s surplus sweep.

## Workflow rules

- Engine changes are made upstream in buckets-and-brackets, then synced
  here byte-identical, then LiveSim/MainScene are updated to incorporate
  the new mechanics with gameplay tests.
- `npm test` (vitest), `npm run typecheck`, and `npm run build` must pass.

## Known open review findings (Codex, July 2026)

- Resolved 2026-07-17: forecast now runs from `LiveSim.yearStartSnapshot`
  with inflation/COLA baked into the rebased profile (no restart, no
  mid-fire double-count); liquidity events land in `beginYear`; pour skims
  are distributions (bouncer pre-59.5, wallet toll sales realize gains);
  Roth earnings need the account 5-year clock (`rothFirstContributionYear`);
  fire/Time-River label collision fixed; dead `GameSim` removed.
- Still open: no keyboard/screen-reader control surface (canvas-only);
  portrait-mobile layout unusable (Phaser FIT only); after-tax ending
  wealth nets only traditional terminal tax.
