# GhostNode Discord bot – working rules

- Answer the owner in **German**; decide sensibly yourself instead of asking ("wähle immer die logische Anforderung").
- **Everything about the Discord bot lives in this repository** (ghostnode-labs/node_discord) – not in vrc_nexus.
- No secrets in code, Git or chat: token, client secret etc. only as environment variables / Plesk secrets. Never ask for passwords.
- No npm dependencies without the owner's OK – the bot uses only Node.js ≥ 22 built-ins (fetch, WebSocket, http, crypto).
- Tests with mocks only, never against real Discord accounts/servers: `npm test` (node:test, no dependencies).
- Do not copy code from other bots (e.g. MEE6); own implementation, own design.
- UI texts in Discord and the dashboard are German; README in English.
- Commit messages neutral; deploy target: `discord.ghostnode-labs.dev` (Plesk Node.js/Passenger) or a Linux server with `ghostnode-bot.service`.
- Related services: website `https://ghostnode-labs.dev` (market.php, p.php), HypeRate relay `https://hr.ghostnode-labs.dev`, app repo ghostnode-labs/vrc_nexus.
- Every push to `main` runs the tests and publishes a **ZIP release** (`.github/workflows/release.yml`, tag `v<package.json version>`). Bump `version` in `package.json` for a new release; same version = ZIP replaced.
