# Vibe Clan Ladder

An automated, serverless 1v1 ladder for Warzone.com clans.

## Setup

1. **Push to GitHub**
   - Create a new repository.
   - Push this code.

2. **Configure Secrets**
   - Go to `Settings` -> `Secrets and variables` -> `Actions`.
   - Add `WZ_EMAIL`: Your Warzone.com email.
   - Add `WZ_API_TOKEN`: Your Warzone.com API token (Get it from [https://www.warzone.com/API/GetAPIToken](https://www.warzone.com/API/GetAPIToken)).

3. **Enable GitHub Pages**
   - Go to `Settings` -> `Pages`.
   - Source: `Deploy from a branch`.
   - Branch: `main` (or master) / folder `(root)`.
   - Save.

4. **Permissions**
   - Go to `Settings` -> `Actions` -> `General`.
   - Under "Workflow permissions", select **Read and write permissions**. (Required for the bot to update the DB).

## How it Works

- **Matchmaker**: Runs every 30 minutes, pairs active players, creates games.
- **Referee**: Runs every 30 minutes, checks for finished games, updates ELO, tracks flakes.
- **Join/Update**: Users open GitHub Issues with specific titles (handled automatically).
- **Frontend**: `https://your-user.github.io/your-repo/` shows the leaderboard.

## Development

- `npm install`
- `node scripts/matchmaker.js` (Manual run)
