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

The ladder is fully automated. A bot ("Norman") is scheduled each hour at :17 to:
1.  **Sync Roster**: Enroll new M'Hunters clan members, retire ordinary players who left the clan (voiding their active games), and reactivate rejoiners. Permanently admitted guests remain eligible independently of clan membership.
2.  **Referee**: Check for finished games, update ELO ratings, and track missed games.
3.  **Matchmake**: Find two available players and create a game on War.app.

## How to Join & Play

The ladder is controlled via **GitHub Issues**. All mutating commands require
current repository write access (write, maintain or admin). Ask a maintainer
to submit commands for you; opening an issue alone does not grant access.

### 1. Automatic Enrollment

**Automatic:** every M'Hunters clan member is enrolled automatically. The bot
syncs the clan roster each hour at :17; new members start at 1000 ELO with a
2-game cap. Leaving the clan retires you automatically (active ladder games
are voided); rejoining the clan reactivates you with your old rating.

### 2. Update Your Game Cap

On the [Actions page](https://norman1.github.io/mhunters-clan-ladder/actions.html),
select the player under **Set Game Cap**, choose 0–3, and click **Set Cap**.
The button opens a prepared GitHub issue. Review it and click **Submit new issue**
on GitHub to apply the change. A maintainer with repository write access must
submit it. Choose **Pause (0)** to stop new games while preserving admission,
rating and history; choose 1–3 to resume.

### 3. Permanent Guests (Maintainers)

On the Actions page, use **Add Guest Player**: enter the War.app player ID,
display name and game cap (default 2). Click **Add Guest Player**, then review
and submit the prepared issue on GitHub. No command composition or JSON editing
is needed.

Use **Remove Guest Player** to revoke admission: find the existing guest by name
or ID, check the selected player, type `REMOVE`, then click **Remove Guest Player**
and submit the prepared GitHub issue. This revokes the guest exception rather
than setting the cap to 0.

New guests start at 1000 ELO with no missed games. Existing players retain
their rating, history, strikes and cooldowns; the supplied name and cap are
updated. `guest: true` grants eligibility independently of the factual
`in_clan` flag. Clan sync still updates membership but never retires guests
or voids their games solely for leaving/being outside the clan.

When removing a guest, the bot checks current clan membership before applying
the change; if lookup fails,
the grant remains unchanged. Clan members remain eligible normally, while
outsiders stop receiving new games. Existing games finish normally; records
and caps are preserved. Cap 0 only pauses play and never revokes guest admission.
A revoked outsider can return through another guest grant or ordinary clan enrollment.

Legacy `Signup` and `Remove` issue commands remain supported for compatibility;
normal clan enrollment is automatic and pauses use **Set Game Cap → Pause (0)**.

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
