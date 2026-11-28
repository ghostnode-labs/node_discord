# GhostNode Discord bot – working rules

- Answer the owner in **German**; decide sensibly yourself instead of asking ("wähle immer die logische Anforderung").
- **Everything about the Discord bot lives in this repository** (ghostnode-labs/node_discord) – not in vrc_nexus.
- No secrets in code, Git or chat: token, client secret etc. only as environment variables / Plesk secrets. Never ask for passwords.
- Open libraries, public APIs and similar are generally allowed (owner's OK, 2026-11-28; API keys only as secrets/env, respect terms of use) – prefer well-known publishers (e.g. Google/AndroidX, Microsoft, OpenJS/Electron, buttplugio, Signal, official org packages) that are actively maintained; add when they bring real value, pin versions, check the license, prefer built-ins for small things. Currently the runtime uses only built-ins (fetch, WebSocket, http, crypto); music optionally calls the external program yt-dlp (installed by the root script, path via env `YTDLP`).
- **Layout: always the 4-column grid (masonry)** – four equal columns (2 on narrow, 1 on phones); every card is S (1 col), M (2, default), L (3) or XL (4, full width) via class `sz-s|m|l|xl`; free space on the right is filled, no gaps, no overlaps (owner, 2026-11-28). Check all pages before pushing.
- **Layout: always use the full width between the sidebars** (no max-width containers). **Basic rule: windows and pop-ups always sit between the sidebars (sidebar | content | sidebar)** – sidebars stay visible (owner, 2026-11-28).
- Tests with mocks only, never against real Discord accounts/servers: `npm test` (node:test, no dependencies).
- Do not copy code from other bots (e.g. MEE6); own implementation, own design.
- UI texts in Discord and the dashboard are German; README in English.
- Commit messages neutral; deploy target: `discord.ghostnode-labs.dev` (Plesk Node.js/Passenger) or a Linux server with `ghostnode-bot.service`.
- Related services: website `https://ghostnode-labs.dev` (market.php, p.php), HypeRate relay `https://hr.ghostnode-labs.dev`, app repo ghostnode-labs/vrc_nexus.
- Every push to `main` runs the tests and publishes a **ZIP release** (`.github/workflows/release.yml`, tag `v<package.json version>`). Bump `version` in `package.json` for a new release; same version = ZIP replaced.

## What the parts do
- `bot.js` – Discord gateway + REST (no libraries), slash commands, VRC Nexus commands (`/status`, `/release`, `/poster`, `/marktplatz`, `/puls`), automatic release posts.
- `features.js` – community features: levels, welcome/auto-roles, moderation + mod log, AutoMod, self-role menus, polls, giveaways, custom commands, birthdays, tickets, logs.
- `extras.js` – info commands, reminders, suggestions, starboard, temp voice channels, fun.
- `clubs.js` – Nexus clubs: posts public club events, reminders and cancellations.
- `music.js` – music via Lavalink (optional yt-dlp).
- `dashboard.js` + `dashboard.html` – web dashboard (Discord login) to configure everything per server, 4-column grid.
- `store.js` – per-server JSON data in `data/<server-id>/`; `ghostnode-bot.service` / `pterodactyl/` – deployment; `test/` – mocked tests.

## Backup policy
- **Git is the backup for code.** Commit locally after every finished step; every push to `main` publishes a ZIP release, so push only finished, tested work. Unfinished work goes to a branch **`backup/<topic>`** (the release workflow runs on `main` only).
- **Before risky operations** create `git branch backup/<date>-<topic>`; never force-push `main`.
- **Bot data** (`data/`) is never in Git. On the GhostNode server it is included in the daily `ghostnode-backup` (`/var/backups/ghostnode`, 14 days); on Pterodactyl the panel's backups cover it. Before changing the data format, run `ghostnode backup` and keep the loader able to read the old format.
- `store.js` must write atomically (temp file + rename) so a crash never leaves a half-written file.
