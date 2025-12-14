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
-   `schedule.yml`: Controls how often the Matchmaker and Referee run (default: every 2 hours).

## 3. Branch & Deployment Workflow

GitHub Pages serves the contents of your configured publish branch (commonly `main` or `gh-pages`).

-   **Day-to-day development**: Create feature branches off the publish branch. Open a pull request, let the checks run, and merge back into the publish branch.
-   **Release to Pages**: Every merge to the publish branch automatically updates the Pages site—no separate deploy step is needed.
-   **Emergency fixes**: If the live site is broken, you can patch the publish branch directly, but prefer short-lived branches + PRs to keep history clean.

### Pushing the publish branch to GitHub
If you do not see updates on GitHub Pages, confirm that your publish branch is actually pushed to GitHub.

1. **Set the remote (one-time)**
    - `git remote add origin git@github.com:<your-account>/<repo>.git`
2. **Make sure you are on the publish branch locally**
    - `git checkout main` (or `gh-pages` if you use that instead)
3. **Merge your work branch (if needed)**
    - `git merge work` (replace `work` with the branch that has your changes)
4. **Push the publish branch**
    - `git push -u origin main`

After pushing, GitHub Pages will redeploy automatically from the updated branch. If you are using a different publish branch (e.g., `gh-pages`), swap the branch name in steps 2–4.

## 4. Development

-   **Install Dependencies**: `npm install`
-   **Manual Run**: `node scripts/matchmaker.js`
