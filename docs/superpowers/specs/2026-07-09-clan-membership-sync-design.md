# Clan Membership Sync — Design

**Date:** 2026-07-09
**Status:** Approved

## Overview

The ladder currently has no concept of clan membership. Players enter `players.json` only via manual `Signup:` GitHub issues, and nothing ever removes or re-checks them — which is how a player who left M'Hunters (extelon, ID 53134900057) kept receiving and playing ladder games.

This design makes the ladder membership-aware and moves it to the originally intended **opt-out model**:

- Every member of the M'Hunters clan (War.app clan ID **141**) is automatically enrolled.
- Opting out = setting `game_cap: 0`, or simply declining/ignoring games (the existing strike → cooldown system, with retuned cooldowns).
- Players who leave the clan are automatically removed from matchmaking and their active games are voided immediately.
- Players who rejoin the clan are automatically reactivated with their old ELO.

## Background: verified technical constraints

- The official War.app API has **no clan membership endpoint** (checked: API wiki index, ValidateInviteToken, Clan Wars API).
- The clan page (`https://war.app/Clans/?ID=141`) renders its member list client-side from an obfuscated `UJS_Init` blob. Enumerating the roster therefore requires a **headless browser**. Verified working with Playwright: the rendered DOM contains one `a[href*="Profile?p="]` link per member, carrying player ID and display name.
- Player profile pages (`https://war.app/Profile?p=<id>`) are **plain server-rendered HTML** behind a 302 redirect. When the player is in a clan, the HTML contains `Clans/?ID=<clanId>`. A plain `fetch` (following redirects) suffices — used for single-player verification in the issues workflow, where installing a browser would be wasteful.

## Components

### 1. Roster sync (`scripts/roster_sync.js`) — new

Runs at the start of every engine run: **roster_sync → referee → matchmaker** in `schedule.yml` (every 2 hours).

Steps:

1. Launch headless Chromium (Playwright), load `https://war.app/Clans/?ID=141`, wait for the member list to render, extract `{ playerId, name }` for every member from the profile links.
2. **Circuit breaker** (before any mutation): abort the sync — leaving all state untouched, logging an error — if:
   - the scrape fails or yields zero members, or
   - the diff would mark more than 20% of currently registered `in_clan` players as departed in one run.
   The engine continues with referee/matchmaker using existing flags; a flaky page load never breaks game processing.
3. Diff roster against `players.json`:
   - **New members** (in roster, not in `players.json`): register as
     `{ name, elo: 1000, game_cap: 2, missed_games: 0, in_clan: true }`.
     They become eligible on the next matchmaker pass, no signup needed.
   - **Leavers** (registered with `in_clan !== false`, absent from roster): set `in_clan: false` and `departed_at: <ISO timestamp>`. Record is kept — name renders in history, ELO preserved for potential return. Then void their active games (below).
   - **Rejoiners** (registered with `in_clan: false`, present in roster): set `in_clan: true`, delete `departed_at`. Old ELO, cap, and strikes resume as-is.
   - **Name refresh**: update `name` for existing players whose display name changed on War.app.
4. Void leavers' active games immediately:
   - Lobby games (`WaitingForPlayers`): delete via `DeleteLobbyGame` API.
   - In-progress games: cannot be force-ended via the API; remove from `active_games.json` so the ladder stops tracking them (they continue on War.app as casual games).
   - Both cases: archive to `history.json` as void with `note: "Left Clan"` (no ELO change, excluded from stats). Do **not** strike or set `last_opponent` for the innocent opponent.

### 2. Cooldown retune (`scripts/matchmaker.js`)

Strike/cooldown loop is unchanged except the formula. New: **2 weeks per strike, capped at 12 weeks**:

```
weeks = min(12, 2 × max(1, missed_games − 1))
```

| Strikes | Old cooldown | New cooldown |
|---|---|---|
| 2 | 1 week | 2 weeks |
| 3 | 2 weeks | 4 weeks |
| 4 | 3 weeks | 6 weeks |
| 5 | 4 weeks | 8 weeks |
| 6 | 5 weeks | 10 weeks |
| 7+ | 6–8 weeks | 12 weeks (cap) |

Constants: `UNRELIABLE_MAX_COOLDOWN_WEEKS = 12`, new `UNRELIABLE_WEEKS_PER_STRIKE = 2`.

### 3. Matchmaking eligibility (`scripts/matchmaker.js`)

- Slot-building filter additionally requires `in_clan !== false`.
- The ranked-ID list used for rank labels in game descriptions likewise excludes departed players (same filter as the frontend leaderboard).

### 4. Issue commands (`scripts/issue_ops.js`)

- **`Signup: <ID> Name: <Name>`** — kept as a fast path for members who don't want to wait for the next sync. Now verifies membership: fetch `https://war.app/Profile?p=<ID>` (redirect: follow), require `Clans/?ID=141` in the HTML. Non-members rejected with a clear comment. On fetch failure: reject with "couldn't verify membership right now, please retry" (never register unverified).
- **`Remove: <ID>`** — repurposed from hard delete to opt-out: sets `game_cap: 0`, record kept. Reply comment explains return path (`Update: <ID> Cap: 1-3`). Hard deletion is futile under auto-enrollment (next sync re-adds clan members) and breaks name display in history.
- **`Update: <ID> Cap: <0-3>`** — unchanged.
- Roster sync never modifies existing players' `game_cap`, so opting out survives every sync.

### 5. Frontend (`app.js`, pages)

- Leaderboard, rank-change, and rank calculations exclude players with `in_clan === false`.
- Add `"Left Clan"` to the void-note list (`Declined`, `Timed Out (Lobby)`, `Terminated`) so those games are excluded from all statistics, streaks, and last-10 records.
- `actions.html`: replace the "Join Ladder" card with copy explaining enrollment is automatic for clan members (keep a small "just joined the clan? file a Signup issue for instant enrollment" note). Cap-update and opt-out forms remain.
- `help.html` and `README.md`: rewrite the lifecycle documentation — auto-enrolled on clan join, opt out via cap 0 or ignoring games (include the new cooldown table), auto-removed on clan leave with active games voided, ELO preserved on return.

### 6. Data model

- `players.json` entries gain:
  - `in_clan: boolean` — absent/`true` means active member (existing entries need no migration; absence is treated as `true`).
  - `departed_at: string` (ISO) — present only while departed.
- `history.json`: new void `note` value `"Left Clan"`.

### 7. Plumbing

- `package.json`: add `playwright` (second dependency after `dotenv`).
- `schedule.yml`: cache Playwright browsers, install Chromium, run `roster_sync.js` before `referee.js`.
- Clan ID `141` defined once in a new `scripts/config.js`, required by `roster_sync.js` and `issue_ops.js`.

## Failure handling summary

| Failure | Behavior |
|---|---|
| Clan page scrape fails / empty | Sync aborts, no state change, error logged; engine continues |
| Mass-departure anomaly (>20% in one run) | Sync aborts, no state change, error logged |
| Profile fetch fails during Signup | Signup rejected with retry message; never register unverified |
| DeleteLobbyGame API fails for leaver's game | Game still archived as `"Left Clan"` and untracked (matches existing referee tolerance of already-deleted games) |

## Accepted races

- A player who leaves the clan mid-cycle can receive a match or have a game resolve with normal ELO within the ≤2-hour window before the next sync. The sync then voids whatever is still active. Accepted as harmless.
- A brand-new clan member auto-enrolled at cap 2 who never wants to play will accumulate strikes and settle into the 12-week re-check cadence — this is the designed opt-out behavior, not a bug.

## First-run effect

On the first engine run after deploy, the sync will automatically: flag extelon (53134900057) as departed, void/untrack his active game with note `"Left Clan"`, and register any clan members not yet in `players.json`. (Audit on 2026-07-09: 79 of the 80 registered players are in the clan; the number of clan members *not* yet registered is unknown until the first roster scrape, so the first run may enroll a batch of new players.)

## Verification plan

- Local dry run of `roster_sync.js` against the live clan page with a `--dry-run` flag printing the would-be diff (no writes).
- Unit-style checks of the diff logic with fabricated roster/players fixtures (new member, leaver with lobby game, leaver with in-progress game, rejoiner, renamed player, circuit-breaker trip).
- Cooldown formula spot-check against the table above.
- Frontend: load site locally (`npx http-server`) with a hand-edited `players.json` containing an `in_clan: false` player and a `"Left Clan"` history entry; confirm leaderboard exclusion and stats exclusion.
- After first production run: confirm extelon departed, his game voided, and no unexpected departures.

## Out of scope

- Forcing an end to in-progress games of leavers (API cannot do this).
- ELO reset policies on rejoin (decided: preserve).
- Any change to matchmaking pairing logic, templates, or ELO math beyond the eligibility filter.
- Admin exemptions for non-clan players (decided: strict members-only).
