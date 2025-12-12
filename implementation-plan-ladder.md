# Warzone.com Automated Clan Ladder - Implementation Plan

## Goal Description
Build a self-hosted, automated 1v1 ladder for a Warzone.com clan. The system relies on a "No Security" (trust-based), Zero Maintenance (Serverless), and Free Hosting philosophy.
- **Core Mechanic**: The system (via paid account "Norman") automatically creates games for players based on availability.
- **Hosting**: GitHub Pages (Frontend) + GitHub Actions (Backend Logic/Database).

## User Review Required
> [!NOTE]
> This system is designed to be trust-based and serverless. User inputs are handled via GitHub Issues.

## Proposed Changes

### Data Layer
Storage maps to flat JSON files in `data/`.

#### [NEW] [players.json](file:///c:/Files/Misc/Projects/Vibe-Clan-Ladder/data/players.json)
Registry of participants:
```json
{
  "1234567": {
    "name": "General_Risk",
    "clan_tag": "[RISK]",
    "elo": 1200,
    "game_cap": 3,
    "active": true,
    "missed_games": 0
  }
}
```

#### [NEW] [active_games.json](file:///c:/Files/Misc/Projects/Vibe-Clan-Ladder/data/active_games.json)
State of matches currently in progress.

#### [NEW] [templates.json](file:///c:/Files/Misc/Projects/Vibe-Clan-Ladder/data/templates.json)
List of allowed Game Templates (Map/Settings).

#### [NEW] [history.json](file:///c:/Files/Misc/Projects/Vibe-Clan-Ladder/data/history.json)
Archive of finished games.

### Backend Logic (Node.js)
Scripts located in `scripts/` executed by GitHub Actions.

#### [NEW] [api.js](file:///c:/Files/Misc/Projects/Vibe-Clan-Ladder/scripts/api.js)
Helper functions for Warzone.com API interaction (Create Game, Poll Status).
- **Credentials**: `WZ_EMAIL`, `WZ_API_TOKEN` (GitHub Secrets).

#### [NEW] [matchmaker.js](file:///c:/Files/Misc/Projects/Vibe-Clan-Ladder/scripts/matchmaker.js)
Logic:
- Runs every 30 minutes.
- Filters eligible players (`active=true`, `games < cap`).
- Pairs players (prioritizing random shuffle, or flake-vs-flake).
- Creates games via API and updates `active_games.json`.

#### [NEW] [referee.js](file:///c:/Files/Misc/Projects/Vibe-Clan-Ladder/scripts/referee.js)
Logic:
- Runs every 30 minutes.
- Checks status of `active_games`.
- **Finished**: Updates ELO, resets `missed_games`, archives result.
- **Terminated**: Strikes offendor (`missed_games + 1`), deactivates if `missed >= 2`.

### Automation workflows
#### [NEW] [schedule.yml](file:///c:/Files/Misc/Projects/Vibe-Clan-Ladder/.github/workflows/schedule.yml)
Runs `matchmaker.js` and `referee.js` on CRON schedule.

#### [NEW] [issues.yml](file:///c:/Files/Misc/Projects/Vibe-Clan-Ladder/.github/workflows/issues.yml)
Parses GitHub Issues for user management:
- **Signup**: Adds player to `players.json`.
- **Update**: Updates `game_cap`.
- **Activate**: Resets `active` status.

### Frontend
#### [NEW] [index.html](file:///c:/Files/Misc/Projects/Vibe-Clan-Ladder/index.html)
Plain HTML/CSS/JS interface hosted on GitHub Pages.
- **Leaderboard**: Displays `players.json` (Rank, Name, ELO, Open Games).
- **Live Games**: Displays `active_games.json`.
- **Control Panel**: Buttons to open pre-filled GitHub Issues for "Update Profile" or "Join Ladder".

## Verification Plan

### Automated Tests
- Run `node scripts/api.js` to verify "Norman" connectivity and game creation.

### Manual Verification
- **Issue Ops**: Open a test issue to verify `issues.yml` correctly updates `players.json`.
- **Frontend**: Verify `index.html` loads data correctly from `data/` JSON files locally.
