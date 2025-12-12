# M'Hunters Clan Ladder

Welcome to the automated 1v1 ladder for the M'Hunters clan!

**Current Leaderboard**: [Click Here to View](https://norma.github.io/Vibe-Clan-Ladder/) *(Replace with your actual Pages URL)*

## How it Works

The ladder is fully automated. A bot ("Norman") runs every 30 minutes to:
1.  **Matchmake**: Find two available players and create a game on Warzone.com.
2.  **Referee**: Check for finished games, update ELO ratings, and track missed games.

## How to Join & Play

The ladder is controlled via **GitHub Issues**. You don't need to ask an admin to update your status; you just speak to the bot.

### 1. Join the Ladder
To sign up, [Open a New Issue](https://github.com/norma/Vibe-Clan-Ladder/issues/new) with the title:
```
Signup: <Your_Warzone_ID>
```
*Example: `Signup: 1234567`*

### 2. Update Your Game Cap
Limit how many active ladder games you can have at once (Default is 3).
To change it, [Open a New Issue](https://github.com/norma/Vibe-Clan-Ladder/issues/new) with the title:
```
Update: <Your_Warzone_ID> Cap: <Number>
```
*Example: `Update: 1234567 Cap: 5`*

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
*   **Redemption Queue**: Inactive players are **NOT** ignored. They are still matched, but with lower priority:
    *   The bot prioritizes matching **Active vs Active** players.
    *   It then matches **Inactive vs Inactive** players (Redemption Games).
    *   This ensures active players are not constantly paired with inactive ones.

### 5. Reactivation (Getting Back In)
There is no manual "Activate" button. To become active again, you must **Join a Game**.
*   Once you successfully join/play a game (even a Redemption Game), your strikes are **reset to 0** and you are marked **Active** immediately.
