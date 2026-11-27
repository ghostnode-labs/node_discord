'use strict';
/*
 * Web-Dashboard des GhostNode-Bots (läuft im selben Prozess wie der Bot, ohne Pakete).
 *  - Anmeldung mit Discord (OAuth2: identify + guilds), state-Prüfung, Sitzungs-Cookie (HttpOnly, Secure, SameSite=Lax), CSRF-Token
 *  - Sichtbar sind nur Server, auf denen der Bot ist und die angemeldete Person „Server verwalten“ (oder Admin/Inhaber) hat
 *  - Alle Kanal-/Rollen-IDs werden gegen die echten Listen des Servers geprüft
 * Umgebung: DISCORD_CLIENT_SECRET (Secret), DASHBOARD_URL (z. B. https://discord.ghostnode-labs.dev)
 * 2.4: Anmeldung über das GhostNode-Dashboard (BOT_SSO_SECRET): die Webseite (botdash.php) schickt ein signiertes Ticket
 *  (HMAC-SHA256, 60 s, nur einmal) mit der verknüpften Discord-ID; welche Server die Person verwalten darf, prüft der Bot
 *  selbst mit seinem Token (Inhaber, Administrator oder „Server verwalten“). Kein OAuth2-Redirect bei Discord nötig.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { levelOf } = require('./features');

const MANAGE = 1n << 5n, ADMIN = 1n << 3n;
const SESSION_MS = 7 * 86400000;
const TEXT_TYPES = [0, 5, 15];   // Text, Ankündigung, Forum

function createDashboard({ CFG, rest, store, log, botGuilds, oauthFetch, music, extras }) {
    const sessions = new Map(), states = new Map(), cache = new Map();
    const secret = String(process.env.DISCORD_CLIENT_SECRET || '').trim();
    const base = String(process.env.DASHBOARD_URL || '').replace(/\/+$/, '');
    const ssoSecret = String(process.env.BOT_SSO_SECRET || '').trim();
    const sso = ssoSecret.length >= 32, used = new Map();
    const site = String(CFG.nexus || process.env.NEXUS_BASE || 'https://ghostnode-labs.dev').replace(/\/+$/, '');
    const loginReady = () => sso || !!(secret && base);
    // Secure-Cookies nur über https (hinter nginx: X-Forwarded-Proto) – sonst speichert der Browser sie über http://IP:Port nicht
    const https = req => String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || !!(req.socket && req.socket.encrypted) || (!req.headers['x-forwarded-proto'] && base.startsWith('https://') && String(req.headers.host || '') === new URL(base).host);
    const sec = req => (https(req) ? '; Secure' : '');
    const ofetch = oauthFetch || ((u, o) => fetch(u, o));
    const html = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');

    const send = (res, code, body, type = 'application/json; charset=utf-8', extra = {}) => {
        res.writeHead(code, Object.assign({ 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
            'Content-Security-Policy': "default-src 'self'; img-src 'self' https://cdn.discordapp.com data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'" }, extra));
        res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    const cookies = req => Object.fromEntries(String(req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(x => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
    const session = req => { const s = sessions.get(cookies(req).gnsid || ''); if (s && s.exp > Date.now()) return s; return null; };
    const body = req => new Promise((ok, bad) => { let b = ''; req.on('data', c => { b += c; if (b.length > 100000) { bad(new Error('zu groß')); req.destroy(); } }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { bad(new Error('Ungültiges JSON')); } }); });
    const canManage = g => { try { const p = BigInt(g.permissions || 0); return g.owner || (p & ADMIN) === ADMIN || (p & MANAGE) === MANAGE; } catch (e) { return false; } };

    /** Kanäle und Rollen eines Servers (1 min Zwischenspeicher) */
    async function meta(gid) {
        const c = cache.get(gid);
        if (c && Date.now() - c.at < 60000) return c;
        const [channels, roles] = await Promise.all([rest('GET', '/guilds/' + gid + '/channels'), rest('GET', '/guilds/' + gid + '/roles')]);
        const m = { at: Date.now(), channels: channels.filter(x => TEXT_TYPES.includes(x.type)).sort((a, b) => a.position - b.position).map(x => ({ id: x.id, name: x.name, type: x.type })),
            voice: channels.filter(x => x.type === 2).sort((a, b) => a.position - b.position).map(x => ({ id: x.id, name: x.name })),
            roles: roles.filter(r => r.name !== '@everyone' && !r.managed).sort((a, b) => b.position - a.position).map(r => ({ id: r.id, name: r.name, color: r.color })) };
        cache.set(gid, m);
        return m;
    }

    // ---------- Einstellungen prüfen & übernehmen ----------
    async function applyCfg(gid, p) {
        const d = store.get(gid), c = d.cfg, m = await meta(gid);
        const chOk = v => v === '' || m.channels.some(x => x.id === v), roleOk = v => m.roles.some(x => x.id === v);
        const ch = (k, v) => { v = String(v || ''); if (!chOk(v)) throw new Error('Unbekannter Kanal bei „' + k + '“'); c[k] = v; };
        const txt = (k, v, max) => { c[k] = String(v || '').slice(0, max); };
        const roles = (v, max = 25) => { const l = [...new Set((Array.isArray(v) ? v : []).map(String))]; if (!l.every(roleOk)) throw new Error('Unbekannte Rolle'); return l.slice(0, max); };
        for (const k of ['welcome_channel', 'goodbye_channel', 'level_channel', 'modlog_channel', 'log_channel', 'birthday_channel', 'ticket_channel']) if (p[k] !== undefined) ch(k, p[k]);
        if (p.welcome_text !== undefined) txt('welcome_text', p.welcome_text, 1000);
        if (p.goodbye_text !== undefined) txt('goodbye_text', p.goodbye_text, 1000);
        if (p.level_text !== undefined) txt('level_text', p.level_text, 500);
        if (p.levels !== undefined) c.levels = !!p.levels;
        if (p.autoroles !== undefined) c.autoroles = roles(p.autoroles, 10);
        if (p.ticket_roles !== undefined) c.ticket_roles = roles(p.ticket_roles, 10);
        if (p.xp_ignore_channels !== undefined) { const l = (Array.isArray(p.xp_ignore_channels) ? p.xp_ignore_channels : []).map(String); if (!l.every(chOk)) throw new Error('Unbekannter Kanal'); c.xp_ignore_channels = l.slice(0, 50); }
        for (const [k, lo, hi] of [['xp_min', 1, 100], ['xp_max', 1, 200], ['xp_cooldown', 0, 3600]]) if (p[k] !== undefined) { const n = Math.round(Number(p[k])); if (!(n >= lo && n <= hi)) throw new Error(k + ': ' + lo + '–' + hi); c[k] = n; }
        if (c.xp_max < c.xp_min) c.xp_max = c.xp_min;
        if (p.level_rewards !== undefined) {
            const r = {};
            for (const [lv, role] of Object.entries(p.level_rewards || {})) { const n = Math.round(Number(lv)); if (!(n >= 1 && n <= 500) || !roleOk(String(role))) throw new Error('Ungültige Level-Belohnung'); r[String(n)] = String(role); }
            if (Object.keys(r).length > 50) throw new Error('Maximal 50 Belohnungen');
            c.level_rewards = r;
        }
        if (p.automod) {
            const a = c.automod, q = p.automod;
            for (const k of ['invites', 'links', 'spam', 'caps']) if (q[k] !== undefined) a[k] = !!q[k];
            if (q.words !== undefined) a.words = (Array.isArray(q.words) ? q.words : String(q.words).split(',')).map(w => String(w).trim().toLowerCase()).filter(Boolean).slice(0, 200).map(w => w.slice(0, 50));
            if (q.exempt_roles !== undefined) a.exempt_roles = roles(q.exempt_roles, 20);
            if (q.timeout_min !== undefined) { const n = Math.round(Number(q.timeout_min)); if (!(n >= 0 && n <= 1440)) throw new Error('Timeout 0–1440'); a.timeout_min = n; }
        }
        store.save(gid);
        return c;
    }

    function overview(gid) {
        const d = store.get(gid), now = Date.now();
        const xp = Object.entries(d.xp).sort((a, b) => b[1].xp - a[1].xp);
        return {
            name: d.meta.name || '', members: d.meta.count || 0, cfg: d.cfg, cmds: d.cmds,
            leaderboard: xp.slice(0, 100).map(([id, u], i) => ({ rank: i + 1, id, xp: u.xp, msgs: u.msgs || 0, level: levelOf(u.xp).level })),
            stats: { ranked: xp.length, messages: xp.reduce((a, [, u]) => a + (u.msgs || 0), 0), warns: Object.values(d.warns).reduce((a, l) => a + l.length, 0), cmds: Object.keys(d.cmds).length,
                birthdays: Object.keys(d.bdays).length, open_tickets: Object.values(d.tickets).filter(t => !t.closed).length },
            warns: Object.entries(d.warns).map(([id, l]) => ({ id, count: l.length, last: l[l.length - 1] })).sort((a, b) => b.last.at - a.last.at).slice(0, 100),
            giveaways: Object.entries(d.giveaways).filter(([, w]) => !w.done && w.end > now).map(([id, w]) => ({ id, prize: w.prize, end: w.end, entrants: w.entrants.length, winners: w.winners })),
            clubs: Object.entries(d.clubs || {}).map(([slug, c]) => ({ slug, name: c.name || slug, channel: c.channel, role: c.role || '', remind: c.remind, last: c.last || 0, err: c.err || '' })),
            polls: Object.entries(d.polls).slice(-20).map(([id, p]) => ({ id, q: p.q, votes: Object.keys(p.votes).length })),
        };
    }

    // ---------- Anmeldung über das GhostNode-Dashboard ----------
    const b64 = s => Buffer.from(s, 'base64url');
    /** Ticket prüfen: „<payload>.<sig>“, payload = base64url(JSON {v,d,n,a,e,j}) */
    function ticket(t) {
        const m = /^([A-Za-z0-9_-]{10,2000})\.([A-Za-z0-9_-]{43})$/.exec(String(t || ''));
        if (!m) throw new Error('Ticket ungültig');
        const want = crypto.createHmac('sha256', ssoSecret).update(m[1]).digest(), got = b64(m[2]);
        if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) throw new Error('Signatur falsch (BOT_SSO_SECRET auf Webseite und Bot gleich?)');
        let d; try { d = JSON.parse(b64(m[1]).toString('utf8')); } catch (e) { throw new Error('Ticket ungültig'); }
        const now = Math.floor(Date.now() / 1000);
        if (!d || d.v !== 1 || !/^\d{15,22}$/.test(String(d.d)) || !/^[0-9a-f]{32}$/.test(String(d.j))) throw new Error('Ticket ungültig');
        if (!(d.e > now && d.e <= now + 120)) throw new Error('Ticket abgelaufen – bitte im GhostNode-Dashboard erneut öffnen');
        for (const [k, t2] of used) if (t2 < now) used.delete(k);
        if (used.has(d.j)) throw new Error('Ticket schon benutzt');
        used.set(d.j, d.e);
        return d;
    }
    /**
     * Server des Bots: aus dem Gateway-Speicher UND direkt von Discord (GET /users/@me/guilds mit dem Bot-Token).
     * Ist der Speicher leer (z. B. nach einem Neustart, bevor GUILD_CREATE kam), fehlen sonst alle Server im Dashboard.
     */
    let restGuilds = { at: 0, ids: [] };
    async function allBotGuilds(force) {
        if (force || Date.now() - restGuilds.at > 60000) {
            try {
                const ids = [];
                let after = '0';
                for (let i = 0; i < 5; i++) {
                    const page = await rest('GET', '/users/@me/guilds?limit=200&after=' + after);
                    if (!Array.isArray(page) || !page.length) break;
                    for (const g of page) {
                        ids.push(String(g.id));
                        const d = store.get(String(g.id));   // Speicher nachziehen, damit auch die übrigen Bot-Funktionen den Server kennen
                        if (!d.meta.name || d.meta.left) { d.meta.name = g.name; d.meta.left = false; store.save(String(g.id)); }
                    }
                    if (page.length < 200) break;
                    after = String(page[page.length - 1].id);
                }
                restGuilds = { at: Date.now(), ids };
            } catch (e) { log('Dashboard: Server-Liste von Discord nicht lesbar:', e.message); }
        }
        return [...new Set([...botGuilds(), ...restGuilds.ids])];
    }
    /** Server, auf denen der Bot ist und die Person Inhaber ist, Administrator oder „Server verwalten“ hat – geprüft mit dem Bot-Token */
    async function manageable(uid, diag = {}) {
        const out = [];
        const ids = await allBotGuilds(true);
        Object.assign(diag, { bot: ids.length, member: 0, noRight: 0, at: Date.now() });
        await Promise.all(ids.slice(0, 100).map(async gid => {
            try {
                const [g, mem] = await Promise.all([rest('GET', '/guilds/' + gid), rest('GET', '/guilds/' + gid + '/members/' + uid).catch(() => null)]);
                if (!g || !mem) return;
                diag.member++;
                let perm = 0n;
                const roles = new Map((g.roles || []).map(r => [r.id, BigInt(r.permissions || 0)]));
                perm |= roles.get(gid) || 0n;   // @everyone
                for (const r of mem.roles || []) perm |= roles.get(r) || 0n;
                if (g.owner_id === uid || (perm & ADMIN) === ADMIN || (perm & MANAGE) === MANAGE) out.push({ id: gid, name: g.name, icon: g.icon || null });
                else diag.noRight++;
            } catch (e) { /* nicht Mitglied oder kein Zugriff */ }
        }));
        return out.sort((a, b) => a.name.localeCompare(b.name));
    }
    async function ssoLogin(req, res, t) {
        if (!sso) return send(res, 404, 'Anmeldung über GhostNode ist nicht eingerichtet (BOT_SSO_SECRET fehlt).', 'text/plain; charset=utf-8');
        let d;
        try { d = ticket(t); } catch (e) { log('Dashboard-SSO:', e.message); return send(res, 400, e.message + '.', 'text/plain; charset=utf-8'); }
        const uid = String(d.d), diag = {}, guilds = await manageable(uid, diag);
        const sid = crypto.randomBytes(32).toString('hex');
        sessions.set(sid, { user: { id: uid, name: String(d.n || 'GhostNode').slice(0, 64), avatar: /^(a_)?[0-9a-f]{32}$/.test(String(d.a || '')) ? d.a : null },
            guilds, diag, via: 'ghostnode', csrf: crypto.randomBytes(16).toString('hex'), exp: Date.now() + SESSION_MS });
        log('Dashboard-Anmeldung über GhostNode:', uid, '·', guilds.length, 'Server');
        res.writeHead(302, { Location: '/', 'Set-Cookie': 'gnsid=' + sid + '; Path=/; HttpOnly' + sec(req) + '; SameSite=Lax; Max-Age=' + SESSION_MS / 1000 }); return res.end();
    }

    // ---------- HTTP ----------
    async function handle(req, res) {
        const u = new URL(req.url, 'http://x'), p = u.pathname;
        if (p === '/health') return send(res, 200, { ok: true, service: 'ghostnode-discord-bot' });
        if (p === '/' || p === '/index.html') return send(res, 200, html, 'text/html; charset=utf-8');
        if (p === '/login' && sso) { res.writeHead(302, { Location: site + '/botdash.php?go=1' }); return res.end(); }
        if (p === '/sso') return ssoLogin(req, res, u.searchParams.get('t') || '');
        if (p === '/login') {
            if (!secret || !base) return send(res, 503, 'Dashboard nicht eingerichtet: DISCORD_CLIENT_SECRET und DASHBOARD_URL fehlen.', 'text/plain; charset=utf-8');
            const st = crypto.randomBytes(16).toString('hex'); states.set(st, Date.now());
            for (const [k, t] of states) if (Date.now() - t > 600000) states.delete(k);
            const q = new URLSearchParams({ client_id: CFG.app, response_type: 'code', scope: 'identify guilds', redirect_uri: base + '/callback', state: st, prompt: 'none' });
            res.writeHead(302, { Location: 'https://discord.com/oauth2/authorize?' + q, 'Set-Cookie': 'gnst=' + st + '; Path=/; HttpOnly' + sec(req) + '; SameSite=Lax; Max-Age=600' }); return res.end();
        }
        if (p === '/callback') {
            const st = u.searchParams.get('state') || '', code = u.searchParams.get('code') || '';
            if (!st || !states.has(st) || cookies(req).gnst !== st || !code) return send(res, 400, 'Anmeldung abgelaufen oder ungültig – bitte neu anmelden.', 'text/plain; charset=utf-8');
            states.delete(st);
            try {
                const tr = await ofetch(CFG.api + '/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ client_id: CFG.app, client_secret: secret, grant_type: 'authorization_code', code, redirect_uri: base + '/callback' }) });
                const tok = await tr.json();
                if (!tok.access_token) throw new Error('kein Token');
                const auth = { headers: { Authorization: 'Bearer ' + tok.access_token } };
                const [me, guilds] = await Promise.all([ofetch(CFG.api + '/users/@me', auth).then(r => r.json()), ofetch(CFG.api + '/users/@me/guilds', auth).then(r => r.json())]);
                if (!me || !me.id || !Array.isArray(guilds)) throw new Error('Profil nicht lesbar');
                const sid = crypto.randomBytes(32).toString('hex');
                sessions.set(sid, { user: { id: me.id, name: me.global_name || me.username, avatar: me.avatar }, guilds: guilds.filter(canManage).map(g => ({ id: g.id, name: g.name, icon: g.icon })),
                    csrf: crypto.randomBytes(16).toString('hex'), exp: Date.now() + SESSION_MS });
                log('Dashboard-Anmeldung:', me.username);
                res.writeHead(302, { Location: '/', 'Set-Cookie': ['gnsid=' + sid + '; Path=/; HttpOnly' + sec(req) + '; SameSite=Lax; Max-Age=' + SESSION_MS / 1000, 'gnst=; Path=/; Max-Age=0'] }); return res.end();
            } catch (e) { log('Dashboard-Login:', e.message); return send(res, 502, 'Anmeldung bei Discord fehlgeschlagen.', 'text/plain; charset=utf-8'); }
        }
        if (p === '/logout') { sessions.delete(cookies(req).gnsid || ''); res.writeHead(302, { Location: '/', 'Set-Cookie': 'gnsid=; Path=/; Max-Age=0' }); return res.end(); }

        if (!p.startsWith('/api/')) return send(res, 404, { error: 'Nicht gefunden' });
        const s = session(req);
        if (!s) return send(res, 401, { error: 'Bitte anmelden.', login: loginReady(), via: sso ? 'ghostnode' : 'discord' });
        const inBot = new Set(await allBotGuilds(false));
        // Server-Liste neu prüfen (z. B. nachdem der Bot eingeladen oder eine Rolle vergeben wurde) – ohne neu anzumelden
        if (p === '/api/refresh' && req.method === 'POST') {
            if (req.headers['x-csrf'] !== s.csrf) return send(res, 403, { error: 'Sitzung abgelaufen – Seite neu laden.' });
            if (s.via === 'ghostnode') { s.diag = {}; s.guilds = await manageable(s.user.id, s.diag); }
            else { await allBotGuilds(true); }
            const nb = new Set(await allBotGuilds(false));
            return send(res, 200, { guilds: s.guilds.map(g => Object.assign({ bot: nb.has(g.id) }, g)), diag: s.diag || null });
        }
        if (p === '/api/me') return send(res, 200, { user: s.user, csrf: s.csrf, via: s.via || 'discord', diag: s.diag || null, guilds: s.guilds.map(g => Object.assign({ bot: inBot.has(g.id) }, g)), invite: 'https://discord.com/oauth2/authorize?client_id=' + CFG.app + '&scope=bot+applications.commands&permissions=1460577332246' });
        const m = /^\/api\/guild\/(\d{15,22})(?:\/(\w+))?$/.exec(p);
        if (!m) return send(res, 404, { error: 'Nicht gefunden' });
        const gid = m[1], act = m[2] || '';
        if (!s.guilds.some(g => g.id === gid) || !inBot.has(gid)) return send(res, 403, { error: 'Kein Zugriff auf diesen Server.' });
        try {
            if (req.method === 'GET' && !act) { const mm = await meta(gid); return send(res, 200, Object.assign(overview(gid), { channels: mm.channels, voice: mm.voice || [], roles: mm.roles,
                music: music ? music.status(gid) : null, extras: extras ? extras.settingsOf(gid) : null })); }
            if (req.method === 'GET' && act === 'music') return send(res, 200, music ? music.status(gid) : { enabled: false });   // Live-Stand (wird alle paar Sekunden abgefragt)
            if (req.method !== 'POST') return send(res, 405, { error: 'Methode nicht erlaubt' });
            if (req.headers['x-csrf'] !== s.csrf) return send(res, 403, { error: 'Sitzung abgelaufen – Seite neu laden.' });
            const b = await body(req), d = store.get(gid);
            const audit = what => log('Dashboard', s.user.name, gid, what);
            switch (act) {
                case 'cfg': { const c = await applyCfg(gid, b); audit('Einstellungen'); return send(res, 200, { ok: true, cfg: c }); }
                case 'cmd': {
                    const name = String(b.name || '').toLowerCase().replace(/^!/, '');
                    if (!/^[a-z0-9_-]{1,30}$/.test(name)) throw new Error('Name: a–z, 0–9, - und _ (max. 30)');
                    if (b.remove) delete d.cmds[name];
                    else { if (!String(b.text || '').trim()) throw new Error('Antwort fehlt'); if (Object.keys(d.cmds).length >= 100 && !d.cmds[name]) throw new Error('Maximal 100 Befehle'); d.cmds[name] = String(b.text).slice(0, 1800); }
                    store.save(gid); audit('Befehl ' + name); return send(res, 200, { ok: true, cmds: d.cmds });
                }
                case 'warns': { const id = String(b.user || ''); if (!/^\d{15,22}$/.test(id)) throw new Error('Ungültige ID'); delete d.warns[id]; store.save(gid); audit('Verwarnungen ' + id); return send(res, 200, { ok: true }); }
                case 'xp': {
                    if (b.all) { if (b.confirm !== 'ZURÜCKSETZEN') throw new Error('Bestätigung fehlt'); d.xp = {}; }
                    else { const id = String(b.user || ''); if (!/^\d{15,22}$/.test(id)) throw new Error('Ungültige ID'); delete d.xp[id]; }
                    store.save(gid); audit('XP zurückgesetzt'); return send(res, 200, { ok: true });
                }
                case 'music': {   // Musik steuern – wie die Knöpfe in Discord
                    if (!music) throw new Error('Musik nicht verfügbar');
                    const a = String(b.act || '');
                    if (a === 'play') { const q = String(b.q || '').trim().slice(0, 300); if (!q) throw new Error('Suchbegriff fehlt'); const msg = await music.dashPlay(gid, s.user.id, q); audit('Musik: ' + q); return send(res, 200, { ok: true, msg, music: music.status(gid) }); }
                    if (!['pause', 'skip', 'stop', 'leave', 'volume', 'loop', 'shuffle', 'remove', 'move', 'clear', 'seek', 'effect'].includes(a)) throw new Error('Unbekannte Musik-Aktion');
                    const msg = await music.dashControl(gid, a, b.arg); audit('Musik ' + a);
                    return send(res, 200, { ok: true, msg, music: music.status(gid) });
                }
                case 'music_cfg': {
                    if (!music) throw new Error('Musik nicht verfügbar');
                    const c = (d.music = Object.assign({ dj: '', volume: 80, stay: false, announce: true, channel: '' }, d.music || {})), id = x => (/^\d{15,22}$/.test(String(x || '')) ? String(x) : '');
                    if ('dj' in b) c.dj = id(b.dj);
                    if ('channel' in b) c.channel = id(b.channel);
                    if ('volume' in b) c.volume = Math.max(1, Math.min(150, Math.round(Number(b.volume)) || 80));
                    if ('stay' in b) c.stay = !!b.stay;
                    if ('announce' in b) c.announce = !!b.announce;
                    store.save(gid); audit('Musik-Einstellungen'); return send(res, 200, { ok: true, music: music.status(gid) });
                }
                case 'extras': {
                    if (!extras) throw new Error('Extras nicht verfügbar');
                    const mm = await meta(gid), known = new Set(mm.channels.map(x => x.id)), vknown = new Set((mm.voice || []).map(x => x.id));
                    for (const k of ['suggest', 'star']) if (b[k] && !known.has(String(b[k]))) throw new Error('Unbekannter Kanal');
                    if (b.tempHub && !vknown.has(String(b.tempHub))) throw new Error('Unbekannter Sprachkanal');
                    const c = extras.saveSettings(gid, b); audit('Extras'); return send(res, 200, { ok: true, extras: c });
                }
                case 'test': {   // Probe-Nachricht in einen Kanal (z. B. Begrüßung testen)
                    const mm = await meta(gid), ch = String(b.channel || '');
                    if (!mm.channels.some(x => x.id === ch)) throw new Error('Unbekannter Kanal');
                    await rest('POST', '/channels/' + ch + '/messages', { content: '🧪 Test aus dem Dashboard von <@' + s.user.id + '>: ' + String(b.text || '').slice(0, 1500), allowed_mentions: { parse: [] } });
                    return send(res, 200, { ok: true });
                }
            }
            return send(res, 404, { error: 'Unbekannte Aktion' });
        } catch (e) { return send(res, 400, { error: e.message.replace(/^Discord \S+ \S+: /, '') }); }
    }
    return { handle, sessions, applyCfg, _states: states };
}

module.exports = { createDashboard };
