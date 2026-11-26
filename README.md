# GhostNode Discord bot

Community bot for the GhostNode Discord (Node.js ≥ 22, **no npm packages**) with a **web dashboard**. Talks to the Discord gateway and REST API itself; data is stored per server in `data/<server-id>.json`.

Files: `bot.js` (gateway, REST, VRC Nexus commands), `features.js` (community features), `store.js` (storage), `dashboard.js` + `dashboard.html` (web dashboard), `test/` (`npm test`, no dependencies).

| Area | Commands / behaviour |
|---|---|
| 📈 Levels | XP per message (cooldown 60 s), level-up message, role rewards per level · `/rang`, `/rangliste` |
| 👋 Welcome | welcome/goodbye message with `{user} {name} {server} {count}`, auto-roles for new members |
| 🛡 Moderation | `/warn`, `/verwarnungen`, `/timeout`, `/kick`, `/ban`, `/unban`, `/loeschen` – everything logged to a mod-log channel, DM to the member |
| 🤖 AutoMod | banned words (whole words), Discord invites, links, spam, caps · delete + optional timeout + mod log · exempt roles |
| 🎭 Self roles | `/rollenmenue` – buttons to add/remove up to 5 roles |
| 📊 Polls | `/umfrage` – buttons with live bars, votes can be changed |
| 🎁 Giveaways | `/giveaway` – join button, winners drawn automatically |
| 💬 Custom commands | `/befehl hinzufuegen/entfernen/liste` → `!name` in chat |
| 🎂 Birthdays | `/geburtstag 24.12` – greeting once a day from 9:00 |
| 🎫 Tickets | `/ticket-panel` – button opens a private thread for member + team; close button |
| 📜 Logs | joins/leaves, deleted and edited messages |
| 🥽 VRC Nexus | `/status`, `/release`, `/poster`, `/marktplatz`, `/puls`, automatic release posts |
| 🎲 Fun | `/wuerfel`, `/muenze`, `/hilfe` |

Everything can be configured in the **web dashboard** or in Discord with `/einstellungen …` (needs *Manage Server*); moderation commands are only shown to members with the matching Discord permission and are checked again by the bot.

**Developer Portal → Bot:** switch on **Server Members Intent** and **Message Content Intent** (needed for welcome, auto-roles, AutoMod, `!commands`, logs). Without them the bot still runs with the other features (or set `BOT_PRIVILEGED_INTENTS=0`).

**Invite link permissions:** `1460557409286` (view channels, send messages, embeds, history, manage messages, kick, ban, manage roles, moderate members, private threads). The bot's role must be **above** the roles it hands out.


## Web dashboard

`https://<your-bot-domain>/` – log in with Discord; you only see servers where you have *Manage Server* and the bot is present.
Sections: overview & statistics, welcome/goodbye (with test message), levels (XP, cooldown, ignored channels, role rewards), leaderboard (reset single members or all), moderation (mod log, logs, warnings), AutoMod, roles & tickets, custom commands, giveaways & polls, birthdays.

Security: Discord OAuth2 with `state`, session cookie (`HttpOnly`, `Secure`, `SameSite=Lax`, 7 days), CSRF token on every change, strict Content-Security-Policy, every channel/role ID is checked against the server's real lists.

Setup: Developer Portal → *OAuth2* → **Redirects**: add `https://<your-bot-domain>/callback` · copy the **Client Secret**. Environment: `DISCORD_CLIENT_SECRET` (secret) and `DASHBOARD_URL=https://<your-bot-domain>`.

## Download

Every change on `main` is tested and published as a ZIP: **[latest release](https://github.com/ghostnode-labs/node_discord/releases/latest)** – direct link: `https://github.com/ghostnode-labs/node_discord/releases/latest/download/ghostnode-discord-bot.zip`. Unpack it into the bot's folder; `data/` and the secrets stay untouched.

## Setup

1. Discord Developer Portal → *New Application* → **Bot** → reset/copy the token. Note the *Application ID*.
2. Invite: `https://discord.com/oauth2/authorize?client_id=<APP_ID>&scope=bot+applications.commands&permissions=1460557409286`
3. Environment (never commit these):

| Variable | Required | Meaning |
|---|---|---|
| `DISCORD_TOKEN` | yes | bot token |
| `DISCORD_APP_ID` | yes | application ID |
| `DISCORD_GUILD_ID` | no | your server ID – commands appear instantly (otherwise global, up to an hour) |
| `RELEASE_CHANNEL_ID` | no | channel for release announcements |
| `NEXUS_BASE` | no | website with `market.php` / `p.php` (default `https://ghostnode-labs.dev`) |
| `HYPERATE_RELAY` | no | HypeRate relay (default `https://hr.ghostnode-labs.dev`) |
| `BOT_DATA` | no | folder for server data (default `./data`) |
| `DISCORD_CLIENT_SECRET` | for dashboard | OAuth2 client secret (store as secret) |
| `DASHBOARD_URL` | for dashboard | public address, e.g. `https://discord.ghostnode-labs.dev` |
| `PORT` | no | dashboard + `/health` (set automatically on Plesk/Passenger) |

## Run on a Linux server (recommended)

```bash
sudo mkdir -p /opt/ghostnode/discord-bot && sudo chown nexus: /opt/ghostnode/discord-bot
cp bot.js features.js store.js dashboard.js dashboard.html package.json /opt/ghostnode/discord-bot/
sudo install -m 600 /dev/null /etc/ghostnode-bot.env   # then add DISCORD_TOKEN=… etc. with an editor
sudo cp ghostnode-bot.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now ghostnode-bot
journalctl -u ghostnode-bot -f
```

## Run on Plesk (e.g. `discord.ghostnode-labs.dev`)

1. Create the subdomain, SSL (Let's Encrypt), upload `bot.js`, `features.js`, `store.js`, `dashboard.js`, `dashboard.html` and `package.json` into its folder (or use Plesk Git with this repository).
2. *Node.js*: application root and document root = that folder, startup file `bot.js`, Node 22 or newer. No `npm install` needed.
3. *Node.js → Environment → Secrets*: `DISCORD_TOKEN`, `DISCORD_CLIENT_SECRET`; as variables `DISCORD_APP_ID`, `DISCORD_GUILD_ID`, `RELEASE_CHANNEL_ID`, `DASHBOARD_URL`.
4. **Keep it running:** Passenger stops idle apps after a few minutes. In *Apache & nginx settings → Additional nginx directives* add:
   ```
   passenger_min_instances 1;
   passenger_pool_idle_time 0;
   ```
   Then open `https://discord.ghostnode-labs.dev/health` – it shows `{"ok":true,…}` when the bot is connected; `/` is the dashboard.

A root server with systemd (above) is still the most reliable place.
