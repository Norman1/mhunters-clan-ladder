# M'Hunters Clan Ladder

Welcome to the automated 1v1 ladder for the M'Hunters clan!

**Current Leaderboard**: [Click Here to View](https://norman1.github.io/mhunters-clan-ladder/)

## Branching & Deployments

The `main` branch is the live site published to GitHub Pages. Use short-lived feature branches for changes, then merge them into `main` to update production. If an emergency fix is needed, you can commit directly to `main`, but prefer PRs so history stays clean.

If you do not see the latest changes on GitHub, double-check that your local work has been pushed to the publish branch that Pages uses:

1. Make sure a remote exists: `git remote -v` (if blank, add one with `git remote add origin git@github.com:<you>/<repo>.git`).
2. Verify you are on the publish branch locally: `git status` should show `On branch main` (or `gh-pages`).
3. Push the branch: `git push origin main` (or your configured publish branch).
4. Confirm GitHub Pages is pointed at that branch in **Settings → Pages**.

## How it Works

The ladder is fully automated. A bot ("Norman") runs every 2 hours to:
1.  **Sync Roster**: Enroll new M'Hunters clan members, retire players who left the clan (voiding their active games), and reactivate rejoiners.
2.  **Referee**: Check for finished games, update ELO ratings, and track missed games.
3.  **Matchmake**: Find two available players and create a game on War.app.

## How to Join & Play

The ladder is controlled via **GitHub Issues**. You don't need to ask an admin to update your status; you just speak to the bot.

### 1. Join the Ladder

**Automatic:** every M'Hunters clan member is enrolled automatically. The bot
syncs the clan roster every 2 hours; new members start at 1000 ELO with a
2-game cap. Leaving the clan retires you automatically (active ladder games
are voided); rejoining the clan reactivates you with your old rating.

**Instant (optional):** just joined the clan and can't wait for the next sync?
[Open a New Issue](https://github.com/Norman1/mhunters-clan-ladder/issues/new) with the title:
```
Signup: <Your_Warzone_ID> Name: <Your_Warzone_Username>
```
*Example: `Signup: 1234567 Name: General_Risk`* — clan membership is verified;
non-members are rejected.

### 2. Update Your Game Cap
Limit how many active ladder games you can have at once (Default is 2, Max is 3; set to 0 to pause).
To change it, [Open a New Issue](https://github.com/Norman1/mhunters-clan-ladder/issues/new) with the title:
```
Update: <Your_Warzone_ID> Cap: <GameLimit>
```
*Example: `Update: 1234567 Cap: 3`*

To opt out of receiving games, open a new issue with the title:
```
Remove: <Your_Warzone_ID>
```
*Example: `Remove: 1234567`* — this sets your game cap to 0; your record and
rating are kept, and you can come back anytime with `Update: <ID> Cap: 1-3`.

---

## System Logic & Flows

Detailed breakdown of how the bot handles games, timeouts, and inactivity.

### 1. The Lobby Phase (3-Day Timeout)
When a game is created, it enters the "Lobby Phase" (Waiting for players to accept the invite).
*   **Success**: If both players join, the game starts.
*   **Timeout**: If the game sits in the lobby for **> 3 days** (72 hours), the bot automatically **deletes** it.
    *   **Blame**: Any player who is still marked as `Invited` (i.e. has not joined) receives **1 Strike**.

### 2. The Playing Phase (Active Game)
Once both players join, the game begins.
*   **No Timeouts**: The bot does not delete active games. It waits for them to finish naturally.
*   **Outcomes**:
    *   **Victory/Defeat**: Standard ELO calculation.
    *   **Surrender/Boot**: Counted as a Loss for the player who quit/booted.
    *   **Draw (Vote to End)**: No ELO change.

### 3. Game Termination (Declines)
If a game is manually declined before it starts:
*   **Declined**: The player who clicked "Decline" receives **1 Strike**.

### 4. Inactivity Rules (Redemption Queue)
The system tracks "Strikes" (Missed Games) to filter out inactive players.
*   **Strike Limit**: A player is marked **Inactive** after accumulating **2 Consecutive Strikes**.
*   **Cooldown**: Inactive players use an escalating backoff of **2 weeks per strike**, capped at **12 weeks** (~3 months).
*   **One-Game Limit**: Inactive players are capped at **1 active game** until they become reliable again.
*   **Redemption Queue**: Inactive players are **NOT** ignored. They are still matched, but with lower priority:
    *   The bot prioritizes matching **Active vs Active** players.
    *   It then matches **Inactive vs Inactive** players (Redemption Games).
    *   This ensures active players are not constantly paired with inactive ones.

### 5. Reactivation (Getting Back In)
There is no manual "Activate" button. To become active again, you must **Join a Game**.
*   Once you successfully join/play a game (even a Redemption Game), your strikes are **reset to 0** and you are marked **Active** immediately.
