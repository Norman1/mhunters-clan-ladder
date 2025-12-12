# Deployment & Administration Guide

This system is designed to be "serverless", running entirely on GitHub Actions and GitHub Pages.

## 1. Initial Setup

1.  **Push to GitHub**
    -   Create a new repository.
    -   Push this code.

2.  **Configure Secrets**
    -   Go to `Settings` -> `Secrets and variables` -> `Actions`.
    -   Add `WZ_EMAIL`: Your Warzone.com email.
    -   Add `WZ_API_TOKEN`: Your Warzone.com API token (Get it from [https://www.warzone.com/API/GetAPIToken](https://www.warzone.com/API/GetAPIToken)).

3.  **Enable GitHub Pages**
    -   Go to `Settings` -> `Pages`.
    -   Source: `Deploy from a branch`.
    -   Branch: `main` (or master) / folder `(root)`.
    -   Save.

4.  **Permissions**
    -   Go to `Settings` -> `Actions` -> `General`.
    -   Under "Workflow permissions", select **Read and write permissions**. (Required for the bot to update the DB).

## 2. Configuration

### Data Files (`data/`)
-   `players.json`: The database of players. Can be manually edited if needed.
-   `templates.json`: Defines the templates used for matches. Update this to change map/settings.
-   `active_games.json`: Tracks running games.

### Workflows
-   `schedule.yml`: Controls how often the Matchmaker and Referee run (default: every 30 mins).

## 3. Development

-   **Install Dependencies**: `npm install`
-   **Manual Run**: `node scripts/matchmaker.js`
