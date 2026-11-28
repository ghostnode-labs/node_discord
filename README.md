# GhostNode Discord bot

Community bot for the GhostNode Discord (Node.js ≥ 22, **no npm packages**) with a **web dashboard**. Talks to the Discord gateway and REST API itself; data is stored per server in `data/<server-id>.json`.

Files: `bot.js` (gateway, REST, VRC Nexus commands), `features.js` (community features), `music.js` (music via Lavalink), `extras.js` (info, reminders, suggestions, starboard, temp voice, fun), `clubs.js` (VRC Nexus club sync), `store.js` (storage), `dashboard.js` + `dashboard.html` (web dashboard), `test/` (`npm test`, no dependencies).

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
| 🏠 Nexus clubs | `/club verbinden <club> <channel> [role] [reminder]` – posts new public events of a VRC Nexus club, a reminder before the start (5 min – 1 day) and cancellations; `/club liste`, `/club jetzt`, `/club trennen`. Up to 5 clubs per server, read-only feed `nexusclubs.php?discord=<club>` (members-only events are never posted), polled every 10 min and every minute shortly before an event. Already planned events are not reposted when connecting. |
| 🥽 VRC Nexus | `/status`, `/release`, `/poster`, `/marktplatz`, `/puls`, automatic release posts |
| 🎵 Music | `/play <title or link>` (YouTube, SoundCloud, Bandcamp, Twitch, Vimeo, radio/HTTP streams, playlists up to 200 tracks) · `/musik jetzt, warteschlange, pause, skip, stopp, lautstaerke, wiederholen, mischen, entfernen, springen, effekt, verlassen` · "now playing" message with buttons (pause, skip, stop, loop, shuffle, volume, queue) · effects: bass boost, nightcore, vaporwave, 8D, karaoke, slow · optional DJ role, music text channel, default volume, 24/7 mode · leaves by itself after 2 min alone / 3 min idle · live control in the dashboard |
| 💡 Suggestions | `/vorschlag` – 👍/👎 voting (changeable), team accepts/rejects, optional suggestion channel |
| ⭐ Starboard | messages with N× ⭐ (configurable emoji/threshold) are reposted to a hall-of-fame channel, count kept up to date |
| 🔊 Temp voice | joining the "➕ create" voice channel creates an own voice channel (name `{name}`, optional user limit, owner may manage it); deleted when empty, orphans cleaned after restart |
| ⏰ Reminders | `/erinnerung neu in:2h text:…`, `/erinnerung liste` (delete buttons) – delivered in the channel, DM as fallback |
| ℹ Info | `/info server`, `/info nutzer`, `/avatar` |
| 🎲 Fun | `/wuerfel`, `/muenze`, `/8ball`, `/auswahl`, `/zufall`, `/hilfe` |

Everything can be configured in the **web dashboard** or in Discord with `/einstellungen …` (needs *Manage Server*); moderation commands are only shown to members with the matching Discord permission and are checked again by the bot.

**Developer Portal → Bot:** switch on **Server Members Intent** and **Message Content Intent** (needed for welcome, auto-roles, AutoMod, `!commands`, logs). Without them the bot still runs with the other features (or set `BOT_PRIVILEGED_INTENTS=0`).

**Invite link permissions:** `1460577332246` (view channels, send messages, embeds, history, manage messages, kick, ban, manage roles, moderate members, private threads, manage channels and move members for temp voice, connect + speak for music). Bots invited with the old link: re-invite with the new link or give the bot role *Connect*, *Speak*, *Manage Channels* and *Move Members*. The bot's role must be **above** the roles it hands out.


## Music (Lavalink)

Discord requires end-to-end encryption (DAVE) in voice channels since March 2026, so the bot does not stream audio itself: it controls a **Lavalink ≥ 4.2** server (Java, supports DAVE) over HTTP + WebSocket – still no npm packages in the bot.

- **Linux server:** `bash ghostnode-root.sh bot` (or `install` / `update`) installs Java, the latest Lavalink and the YouTube plugin as service `ghostnode-lavalink` on `127.0.0.1:2333`, creates a password and writes `LAVALINK_URL` / `LAVALINK_PASSWORD` into the bot's environment. Needs glibc ≥ 2.35 (Ubuntu 22.04 / Debian 12+) and ~512 MB RAM. Skip with `--skip=music`.
- **Elsewhere:** run Lavalink yourself and set `LAVALINK_URL` (e.g. `http://127.0.0.1:2333`) and `LAVALINK_PASSWORD`. Optional `MUSIC_SEARCH` (default `ytsearch`; falls back to YouTube Music and SoundCloud search).
- Plesk/Passenger cannot run Lavalink; the bot then answers music commands with "not set up".
- YouTube playback depends on the community YouTube plugin and may break when YouTube changes things; SoundCloud, Bandcamp, Twitch and direct streams keep working. Only play content you are allowed to share with your server.

## Web dashboard

`https://<your-bot-domain>/` – log in with Discord; you only see servers where you have *Manage Server* and the bot is present.
Sections: overview & statistics, welcome/goodbye (with test message), levels (XP, cooldown, ignored channels, role rewards), leaderboard (reset single members or all), moderation (mod log, logs, warnings), AutoMod, roles & tickets, custom commands, giveaways & polls, birthdays.

Security: Discord OAuth2 with `state`, session cookie (`HttpOnly`, `Secure`, `SameSite=Lax`, 7 days), CSRF token on every change, strict Content-Security-Policy, every channel/role ID is checked against the server's real lists.

Setup: Developer Portal → *OAuth2* → **Redirects**: add `https://<your-bot-domain>/callback` · copy the **Client Secret**. Environment: `DISCORD_CLIENT_SECRET` (secret) and `DASHBOARD_URL=https://<your-bot-domain>`.

## Download

Every change on `main` is tested and published as a ZIP: **[latest release](https://github.com/ghostnode-labs/node_discord/releases/latest)** – direct link: `https://github.com/ghostnode-labs/node_discord/releases/latest/download/ghostnode-discord-bot.zip`. Unpack it into the bot's folder; `data/` and the secrets stay untouched.

## Setup

1. Discord Developer Portal → *New Application* → **Bot** → reset/copy the token. Note the *Application ID*.
2. Invite: `https://discord.com/oauth2/authorize?client_id=<APP_ID>&scope=bot+applications.commands&permissions=1460577332246`
3. Environment (never commit these):

| Variable | Required | Meaning |
|---|---|---|
| `DISCORD_TOKEN` | yes | bot token |
| `DISCORD_APP_ID` | yes | application ID |
| `DISCORD_GUILD_ID` | no | your server ID – commands appear instantly (otherwise global, up to an hour) |
| `YTDLP` | no | path to yt-dlp (e.g. `/usr/local/bin/yt-dlp`) – fallback when YouTube refuses a track |
| `YTDLP_COOKIES` | no | cookies file for yt-dlp (secondary account, Netscape format) |
| `RELEASE_CHANNEL_ID` | no | channel for release announcements |
| `NEXUS_BASE` | no | website with `market.php` / `p.php` (default `https://ghostnode-labs.dev`) |
| `HYPERATE_RELAY` | no | HypeRate relay (default `https://hr.ghostnode-labs.dev`) |
| `BOT_DATA` | no | folder for server data (default `./data`) |
| `BOT_SSO_SECRET` | for dashboard (recommended) | sign-in through the GhostNode dashboard (`botdash.php` on the website): same key as generated there, at least 32 characters (store as secret); no OAuth2 redirect needed |
| `DISCORD_CLIENT_SECRET` | for dashboard (alternative) | OAuth2 client secret (store as secret) |
| `DASHBOARD_URL` | for dashboard | public address, e.g. `https://discord.ghostnode-labs.dev` |
| `PORT` | no | dashboard + `/health` (set automatically on Plesk/Passenger; `SERVER_PORT` from Pterodactyl is used too) |
| `HOST` | no | bind address, e.g. `127.0.0.1` behind a reverse proxy (set by `server/ghostnode-root.sh` of the website repo); default: all interfaces |

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

## Dashboard sign-in through GhostNode

On the website, open **Bot-Dashboard** (`botdash.php`). An admin sets two things there:
- the bot address, e.g. `https://discord.ghostnode-labs.dev`, or for now `http://IP:port`
- a shared key, which goes into `BOT_SSO_SECRET` on the bot

After that, anyone with a GhostNode account and a linked Discord account can click **Bot-Dashboard öffnen**. The website hands over a signed one-time ticket, valid for 60 s. The bot then checks with its own token which servers the person may manage (owner, administrator or "Manage Server"). No redirect has to be registered in the Discord developer portal.

## Run in Pterodactyl

Import [`pterodactyl/egg-ghostnode-discord-bot.json`](pterodactyl/egg-ghostnode-discord-bot.json) under Admin → Nests → *Import Egg*.
Then create a server with that egg:

- **Allocation:** use `127.0.0.1:18092`, so only the reverse proxy can reach the dashboard. `server/ghostnode-root.sh` of the website repo sets up nginx + HTTPS for `discord.<domain>` in front of it.
- **Variables:** enter the token and the other settings as panel variables, never in files.
- **Updates:** with `AUTO_UPDATE = 1` the server runs `git pull` on every restart.

The image is Node.js 22, and no npm packages are installed. The console shows `Web-Dashboard und /health auf Port …` once the bot is ready.

## Troubleshooting

- **Music: "nicht eingerichtet"** – `LAVALINK_URL`/`LAVALINK_PASSWORD` missing → `bash ghostnode-root.sh bot`. **"Musik-Server nicht erreichbar"** → `systemctl status ghostnode-lavalink`, `journalctl -u ghostnode-lavalink -n 50`. **Bot joins but stays silent** → Lavalink older than 4.2 (no DAVE) or the bot role lacks *Speak*.

- **„Es fehlen: DISCORD_TOKEN …“** – open `/health`: it lists which variable *names* the bot sees. Save the variables/secrets in *Node.js → Environment*, then **Restart App**. Do not start the bot via *Run Node.js commands* (`npm start` there gets no app environment). Last resort: a `.env` file next to `bot.js` with `KEY=value` lines (never commit it).
- **Browser shows a certificate error** – issue a Let's Encrypt certificate for the subdomain.
- **Bot goes offline after a few minutes / is slow** – Plesk stops idle apps. With `DASHBOARD_URL` set, the bot pings its own `/health` every minute through the public address and stays awake (disable with `KEEPALIVE=0`). If your hoster allows custom nginx directives, the two `passenger_…` lines above are the cleaner fix; a Plesk *Scheduled task → Fetch URL* every minute also works.
- **Dashboard says „Keine Server gefunden“** – the dashboard now asks Discord directly which servers the bot is on (not only the gateway cache, which is empty right after a restart) and explains the reason under the message:
  - *bot on no server* → invite it with the button,
  - *your Discord account is not a member* → check which Discord account is linked on the GhostNode website (Mein Bereich),
  - *no "Manage Server" right* → you need "Manage Server", "Administrator" or be the owner.
  After inviting the bot or changing roles, click **⟳ Server neu prüfen** – no new sign-in needed.

### New in 2.6.2
- Dashboard follows Apple HIG principles: text at least 12 px, muted text at least 4.5:1, one system UI font stack plus one mono stack, hit targets of 28 px (44 px on touch), labelled icon-only buttons, keyboard-operable chips and server cards, visible focus ring, underlined links in running text, blur only on the header, and support for reduced motion / reduced transparency / more contrast / forced colors.
- Optional **Warm** theme (switch in the dashboard header, remembered in the browser, applied before first paint); the dark GhostNode look stays the default.

### New in 2.6.1

- Dashboard uses the full width; card grids stack without gaps (masonry).

### New in 2.6.0

- Music: if YouTube refuses a track through Lavalink, the bot now asks **yt-dlp** for the audio stream address and plays it through Lavalink (streaming only, nothing is saved); the title stays the same. Only if that fails too, the SoundCloud fallback from 2.5.1 is used. Set up automatically by the root script (`ghostnode update` / `ghostnode bot`: installs yt-dlp and ffmpeg and keeps yt-dlp up to date). Optional cookies of a secondary Google account: put them as `/etc/ghostnode/yt-cookies.txt` (Netscape format) on the server and run `ghostnode bot`.

### New in 2.5.1

- Music: when YouTube refuses a track (“This video requires login”), the bot plays the same title from SoundCloud instead. Failures are reported once in short form (no stack traces), repeated failures are skipped silently, and after 8 failed tracks in a row the queue stops. Server admins can sign the music service into YouTube with `ghostnode musik-login` (root script).

