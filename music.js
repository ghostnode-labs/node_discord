'use strict';
/*
 * GhostNode-Bot – Musik über Lavalink (v4, ab 4.2 mit DAVE-Verschlüsselung, die Discord für Sprachkanäle verlangt).
 * Ohne npm-Pakete: Lavalink ist ein eigener Dienst (Java) auf dem Server; der Bot spricht nur per fetch + WebSocket mit ihm.
 *  - Der Bot meldet sich per Gateway (op 4) im Sprachkanal an und reicht Sitzung/Token/Endpunkt an Lavalink weiter.
 *  - Warteschlange, Wiederholen, Mischen, Lautstärke, Effekte, „Jetzt läuft“-Nachricht mit Knöpfen, DJ-Rolle, 24/7.
 *  - Verlässt den Kanal von selbst, wenn niemand mehr zuhört oder nichts mehr läuft (außer 24/7 ist an).
 * core = { rest, log, store, voice(gid, channelId|null), botId(), url, password, search }
 */
const COLOR = 0x38d5e6, GOLD = 0xf3c262;
const O = { SUB: 1, STR: 3, INT: 4, BOOL: 5 };
const opt = (type, name, description, required = false, extra = {}) => Object.assign({ type, name, description, required }, extra);
const sub = (name, description, options = []) => ({ type: O.SUB, name, description, options });
const MANAGE_GUILD = 1n << 5n, ADMIN = 1n << 3n;
const MAX_QUEUE = 500, MAX_PLAYLIST = 200, IDLE_MS = 3 * 60000, ALONE_MS = 2 * 60000;

/** Effekte = Lavalink-Filter */
const EFFECTS = {
    aus: { label: 'Aus', f: {} },
    bass: { label: 'Bass-Boost', f: { equalizer: [0.25, 0.2, 0.15, 0.1, 0.05].map((gain, band) => ({ band, gain })) } },
    nightcore: { label: 'Nightcore', f: { timescale: { speed: 1.2, pitch: 1.2, rate: 1 } } },
    vaporwave: { label: 'Vaporwave', f: { timescale: { speed: 0.82, pitch: 0.82, rate: 1 } } },
    '8d': { label: '8D', f: { rotation: { rotationHz: 0.2 } } },
    karaoke: { label: 'Karaoke', f: { karaoke: { level: 1, monoLevel: 1, filterBand: 220, filterWidth: 100 } } },
    langsam: { label: 'Langsam', f: { timescale: { speed: 0.85, pitch: 1, rate: 1 } } },
};

const COMMANDS = [
    { name: 'play', description: '🎵 Musik abspielen – Titel, Suchbegriff oder Link (YouTube, SoundCloud, Bandcamp, Twitch, Radio …)', options: [
        opt(O.STR, 'suche', 'Titel, Suchbegriff oder Link', true, { max_length: 300 }), opt(O.BOOL, 'vorne', 'Als Nächstes spielen statt hinten anstellen')] },
    { name: 'musik', description: '🎵 Musik steuern', options: [
        sub('jetzt', 'Was gerade läuft'),
        sub('warteschlange', 'Die nächsten Titel', [opt(O.INT, 'seite', 'Seite', false, { min_value: 1, max_value: 50 })]),
        sub('pause', 'Pause / weiter'),
        sub('skip', 'Titel überspringen', [opt(O.INT, 'bis', 'Bis zu diesem Platz in der Warteschlange springen', false, { min_value: 1, max_value: MAX_QUEUE })]),
        sub('stopp', 'Stoppen und Warteschlange leeren'),
        sub('lautstaerke', 'Lautstärke 1–150', [opt(O.INT, 'wert', 'Prozent', true, { min_value: 1, max_value: 150 })]),
        sub('wiederholen', 'Wiederholen: aus, Titel, Warteschlange', [opt(O.STR, 'modus', 'Modus', true, { choices: [{ name: 'aus', value: 'off' }, { name: 'Titel', value: 'track' }, { name: 'Warteschlange', value: 'queue' }] })]),
        sub('mischen', 'Warteschlange mischen'),
        sub('entfernen', 'Titel aus der Warteschlange nehmen', [opt(O.INT, 'platz', 'Platz in der Warteschlange', true, { min_value: 1, max_value: MAX_QUEUE })]),
        sub('springen', 'Im Titel springen (z. B. 1:30)', [opt(O.STR, 'zeit', 'mm:ss oder Sekunden', true, { max_length: 10 })]),
        sub('effekt', 'Klang-Effekt', [opt(O.STR, 'name', 'Effekt', true, { choices: Object.entries(EFFECTS).map(([value, e]) => ({ name: e.label, value })) })]),
        sub('verlassen', 'Bot verlässt den Sprachkanal'),
    ] },
];

const fmt = ms => { if (!ms || ms < 0 || ms > 1e12) return 'LIVE'; const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = String(s % 60).padStart(2, '0'); return h ? h + ':' + String(m).padStart(2, '0') + ':' + x : m + ':' + x; };
const parseTime = t => { t = String(t || '').trim(); if (/^\d+$/.test(t)) return Number(t) * 1000; const p = t.split(':').map(Number); if (p.some(n => !Number.isFinite(n) || n < 0)) return -1; return p.reduce((a, n) => a * 60 + n, 0) * 1000; };
const isUrl = s => /^https?:\/\/\S+$/i.test(s);
const cut = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const bar = (pos, len, n = 18) => { if (!len || len > 1e12) return '🔴 LIVE'; const k = Math.max(0, Math.min(n - 1, Math.round(pos / len * (n - 1)))); return '▬'.repeat(k) + '🔘' + '▬'.repeat(n - 1 - k); };

function create(core) {
    const { rest, log, store } = core;
    const base = String(core.url || '').replace(/\/+$/, '');
    const enabled = () => !!(base && core.password);
    const S = new Map();   // guildId → Zustand
    const VS = new Map();  // guildId → Map(userId → { ch, bot })
    let ws = null, sid = '', wsOk = false, retry = 1000, stopped = false, stats = null;

    const st = gid => {
        if (!S.has(gid)) S.set(gid, { gid, vc: '', text: '', queue: [], cur: null, loop: 'off', paused: false, pos: 0, posAt: 0, volume: 0, effect: 'aus', voice: {}, np: null, idle: null, alone: null, joined: false });
        return S.get(gid);
    };
    const cfg = gid => { const d = store.get(gid); d.music = Object.assign({ dj: '', volume: 80, stay: false, announce: true, channel: '' }, d.music || {}); return d.music; };

    // ---------------- Lavalink ----------------
    async function ll(method, path, body) {
        if (!enabled()) throw new Error('Musik ist auf diesem Bot nicht eingerichtet (Lavalink fehlt).');
        let r;
        try { r = await fetch(base + '/v4' + path, { method, headers: { Authorization: core.password, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) }); }
        catch (e) { throw new Error('Musik-Server (Lavalink) nicht erreichbar.'); }
        if (r.status === 204) return null;
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error('Musik-Server: ' + ((j && (j.message || j.error)) || 'HTTP ' + r.status));
        return j;
    }
    const player = (gid, body, noReplace) => { if (!sid) throw new Error('Musik-Server verbindet gerade – bitte gleich nochmal.'); return ll('PATCH', '/sessions/' + sid + '/players/' + gid + (noReplace ? '?noReplace=true' : ''), body); };

    function connect() {
        if (!enabled() || stopped) return;
        const u = base.replace(/^http/, 'ws') + '/v4/websocket';
        const headers = { Authorization: core.password, 'User-Id': String(core.botId() || ''), 'Client-Name': 'GhostNode-Bot/' + require('./package.json').version };
        if (sid) headers['Session-Id'] = sid;
        if (!headers['User-Id']) { setTimeout(connect, 2000); return; }   // erst nach READY bekannt
        let w;
        try { w = ws = new WebSocket(u, { headers }); } catch (e) { log('Lavalink:', e.message); return setTimeout(connect, retry); }
        w.onmessage = ev => { let m; try { m = JSON.parse(String(ev.data)); } catch (e) { return; } onLL(m).catch(e => log('Lavalink-Ereignis:', e.message)); };
        w.onclose = () => { if (ws !== w) return; wsOk = false; if (stopped) return; setTimeout(connect, retry); retry = Math.min(retry * 2, 60000); };
        w.onerror = () => { /* onclose folgt */ };
    }
    async function onLL(m) {
        if (m.op === 'ready') {
            const resumed = !!m.resumed; sid = m.sessionId; wsOk = true; retry = 1000;
            log('Lavalink verbunden' + (resumed ? ' (fortgesetzt)' : ''));
            await ll('PATCH', '/sessions/' + sid, { resuming: true, timeout: 90 }).catch(() => {});
            if (!resumed) for (const s of S.values()) if (s.cur && s.voice.token) await restore(s).catch(e => log('Musik wiederherstellen:', e.message));
            return;
        }
        if (m.op === 'stats') { stats = { players: m.players, playing: m.playingPlayers, uptime: m.uptime, cpu: m.cpu && m.cpu.lavalinkLoad }; return; }
        if (m.op === 'playerUpdate') { const s = S.get(m.guildId); if (s && m.state) { s.pos = m.state.position || 0; s.posAt = Date.now(); } return; }
        if (m.op !== 'event') return;
        const s = S.get(m.guildId); if (!s) return;
        switch (m.type) {
            case 'TrackStartEvent': s.pos = 0; s.posAt = Date.now(); s.paused = false; clearTimeout(s.idle); s.idle = null; if (cfg(s.gid).announce) await nowPlaying(s).catch(() => {}); return;
            case 'TrackEndEvent':
                if (m.reason === 'replaced' || m.reason === 'cleanup') return;
                if (m.reason === 'stopped' && !s.cur) return;
                return next(s, m.reason === 'loadFailed');
            case 'TrackExceptionEvent': log('Musik-Fehler', s.gid, m.exception && m.exception.message); if (s.text) send(s.text, { content: '⚠ Titel nicht abspielbar: ' + cut(m.exception && m.exception.message || '?', 200) }); return;
            case 'TrackStuckEvent': return next(s, true);
            case 'WebSocketClosedEvent':
                if ([4014, 4006, 4009].includes(m.code)) { log('Musik: Sprachverbindung getrennt (' + m.code + ')', s.gid); if (m.code === 4014) await cleanup(s, false); }
                return;
        }
    }
    async function restore(s) {
        await player(s.gid, { voice: s.voice });
        await player(s.gid, { track: { encoded: s.cur.encoded }, position: s.pos, paused: s.paused, volume: s.volume || cfg(s.gid).volume, filters: EFFECTS[s.effect] ? EFFECTS[s.effect].f : {} });
    }

    // ---------------- Sprachkanal ----------------
    function onVoiceState(v) {
        if (!v.guild_id) return;
        const m = VS.get(v.guild_id) || new Map(); VS.set(v.guild_id, m);
        if (v.channel_id) m.set(v.user_id, { ch: v.channel_id, bot: !!(v.member && v.member.user && v.member.user.bot) }); else m.delete(v.user_id);
        const s = S.get(v.guild_id);
        if (v.user_id === String(core.botId())) {
            if (!s) return;
            if (!v.channel_id) { if (s.joined) cleanup(s, false).catch(() => {}); return; }
            s.vc = v.channel_id; s.voice.sessionId = v.session_id; s.voice.channelId = v.channel_id; pushVoice(s);
        }
        if (s && s.vc) checkAlone(s);
    }
    function onVoiceServer(v) {
        const s = S.get(v.guild_id); if (!s || !v.endpoint) return;
        s.voice.token = v.token; s.voice.endpoint = v.endpoint; pushVoice(s);
    }
    function onGuild(g) {   // GUILD_CREATE: wer ist gerade in Sprachkanälen?
        const m = new Map();
        for (const v of g.voice_states || []) m.set(v.user_id, { ch: v.channel_id, bot: false });
        for (const mem of g.members || []) if (mem.user && mem.user.bot && m.has(mem.user.id)) m.get(mem.user.id).bot = true;
        VS.set(g.id, m);
    }
    const voiceOf = (gid, uid) => { const m = VS.get(gid); const x = m && m.get(uid); return x ? x.ch : ''; };
    const listeners = (gid, ch) => { const m = VS.get(gid); if (!m) return 0; let n = 0; for (const [uid, x] of m) if (x.ch === ch && !x.bot && uid !== String(core.botId())) n++; return n; };
    function pushVoice(s) {
        const v = s.voice;
        if (!v.token || !v.endpoint || !v.sessionId || !v.channelId) return;
        if (v.pushed === v.token + v.sessionId + v.channelId) return;
        v.pushed = v.token + v.sessionId + v.channelId;
        player(s.gid, { voice: { token: v.token, endpoint: v.endpoint, sessionId: v.sessionId, channelId: v.channelId } })
            .then(() => { if (s.waitVoice) { const w = s.waitVoice; s.waitVoice = null; w(); } })
            .catch(e => log('Musik Sprachverbindung:', e.message));
    }
    function join(s, ch) {
        if (s.vc === ch && s.joined && s.voice.pushed) return Promise.resolve();
        s.joined = true; s.vc = ch;
        const p = new Promise((res, rej) => { s.waitVoice = res; setTimeout(() => { if (s.waitVoice === res) { s.waitVoice = null; rej(new Error('Sprachkanal: keine Antwort von Discord (Rechte „Verbinden“/„Sprechen“?).')); } }, 12000); });
        core.voice(s.gid, ch);
        return p;
    }
    function checkAlone(s) {
        if (cfg(s.gid).stay) { clearTimeout(s.alone); s.alone = null; return; }
        if (listeners(s.gid, s.vc) > 0) { clearTimeout(s.alone); s.alone = null; return; }
        if (s.alone) return;
        s.alone = setTimeout(() => { s.alone = null; if (listeners(s.gid, s.vc) === 0) { if (s.text) send(s.text, { content: '👋 Niemand mehr im Sprachkanal – ich mache Pause.' }); cleanup(s, true).catch(() => {}); } }, ALONE_MS);
    }
    async function cleanup(s, leave) {
        clearTimeout(s.idle); clearTimeout(s.alone); s.idle = s.alone = null;
        s.queue = []; s.cur = null; s.paused = false; s.joined = false;
        if (sid) await ll('DELETE', '/sessions/' + sid + '/players/' + s.gid).catch(() => {});
        if (leave) core.voice(s.gid, null);
        s.voice = {}; s.vc = '';
        await dropNp(s);
    }

    // ---------------- Abspielen ----------------
    async function resolve(q, uid) {
        const tryLoad = async id => { const r = await ll('GET', '/loadtracks?identifier=' + encodeURIComponent(id)); return r; };
        let r;
        if (isUrl(q)) r = await tryLoad(q);
        else {
            const order = [...new Set([core.search || 'ytsearch', 'ytmsearch', 'scsearch'])];
            for (const src of order) { r = await tryLoad(src + ':' + q).catch(() => null); if (r && r.loadType === 'search' && r.data && r.data.length) break; }
        }
        if (!r) throw new Error('Suche fehlgeschlagen.');
        const mk = t => ({ encoded: t.encoded, title: cut(t.info.title, 200), author: cut(t.info.author, 100), length: t.info.isStream ? 0 : t.info.length, uri: t.info.uri || '', art: t.info.artworkUrl || '', src: t.info.sourceName || '', seek: !!t.info.isSeekable, by: uid });
        switch (r.loadType) {
            case 'track': return { tracks: [mk(r.data)] };
            case 'search': return { tracks: r.data.length ? [mk(r.data[0])] : [] };
            case 'playlist': return { tracks: r.data.tracks.slice(0, MAX_PLAYLIST).map(mk), playlist: r.data.info && r.data.info.name, total: r.data.tracks.length };
            case 'error': throw new Error('Nicht ladbar: ' + cut(r.data && r.data.message || '?', 200));
            default: return { tracks: [] };
        }
    }
    async function start(s, t) {
        s.cur = t; s.pos = 0; s.posAt = Date.now(); s.paused = false;
        await player(s.gid, { track: { encoded: t.encoded }, paused: false, volume: s.volume || cfg(s.gid).volume, filters: EFFECTS[s.effect] ? EFFECTS[s.effect].f : {} });
    }
    async function next(s, failed) {
        const prev = s.cur;
        if (prev && !failed) { if (s.loop === 'track') return start(s, prev); if (s.loop === 'queue') s.queue.push(prev); }
        const t = s.queue.shift();
        if (!t) {
            s.cur = null; await dropNp(s);
            if (!cfg(s.gid).stay) { clearTimeout(s.idle); s.idle = setTimeout(() => { if (!s.cur) { if (s.text) send(s.text, { content: '⏹ Warteschlange leer – bis später!' }); cleanup(s, true).catch(() => {}); } }, IDLE_MS); }
            return;
        }
        return start(s, t);
    }
    async function play(gid, uid, ch, q, textCh, front) {
        const s = st(gid);
        if (s.vc && s.joined && s.vc !== ch && s.cur) throw new Error('Ich spiele schon in <#' + s.vc + '> – komm dorthin.');
        const r = await resolve(q, uid);
        if (!r.tracks.length) throw new Error('Nichts gefunden für „' + cut(q, 80) + '“.');
        if (s.queue.length + r.tracks.length > MAX_QUEUE) throw new Error('Warteschlange voll (höchstens ' + MAX_QUEUE + ').');
        if (textCh) s.text = textCh;
        if (!s.volume) s.volume = cfg(gid).volume;
        await join(s, ch);
        if (front) s.queue.unshift(...r.tracks); else s.queue.push(...r.tracks);
        const started = !s.cur;
        if (started) await next(s);
        return { r, started, s };
    }

    // ---------------- Nachrichten ----------------
    const send = (ch, d) => rest('POST', '/channels/' + ch + '/messages', Object.assign({ allowed_mentions: { parse: [] } }, d)).catch(e => { log('Musik-Nachricht:', e.message); return null; });
    const position = s => s.cur ? Math.min(s.cur.length || Infinity, s.pos + (s.paused ? 0 : Date.now() - s.posAt)) : 0;
    function npEmbed(s) {
        const t = s.cur; if (!t) return { embeds: [{ color: COLOR, description: '⏹ Gerade läuft nichts.' }] };
        const p = position(s);
        return { embeds: [{ color: COLOR, author: { name: s.paused ? '⏸ Pausiert' : '🎵 Jetzt läuft' }, title: cut(t.title, 250), url: t.uri || undefined,
            description: '**' + cut(t.author, 100) + '**\n\n' + bar(p, t.length) + '\n`' + fmt(p) + ' / ' + fmt(t.length) + '`',
            thumbnail: t.art ? { url: t.art } : undefined,
            fields: [{ name: 'Gewünscht von', value: '<@' + t.by + '>', inline: true }, { name: 'Warteschlange', value: s.queue.length + ' Titel', inline: true },
                { name: 'Modus', value: ({ off: '➡ normal', track: '🔂 Titel', queue: '🔁 Warteschlange' })[s.loop] + ' · 🔊 ' + (s.volume || 80) + ' %' + (s.effect !== 'aus' ? ' · ✨ ' + EFFECTS[s.effect].label : ''), inline: true }],
            footer: { text: 'GhostNode-Bot · ' + (t.src || 'Musik') } }], components: buttons(s) };
    }
    const buttons = s => [{ type: 1, components: [
        { type: 2, style: 2, emoji: { name: s.paused ? '▶️' : '⏸️' }, custom_id: 'mu:pause' },
        { type: 2, style: 2, emoji: { name: '⏭️' }, custom_id: 'mu:skip' },
        { type: 2, style: 4, emoji: { name: '⏹️' }, custom_id: 'mu:stop' },
        { type: 2, style: s.loop === 'off' ? 2 : 1, emoji: { name: s.loop === 'track' ? '🔂' : '🔁' }, custom_id: 'mu:loop' },
        { type: 2, style: 2, emoji: { name: '🔀' }, custom_id: 'mu:shuffle' },
    ] }, { type: 1, components: [
        { type: 2, style: 2, emoji: { name: '🔉' }, custom_id: 'mu:voldown' },
        { type: 2, style: 2, emoji: { name: '🔊' }, custom_id: 'mu:volup' },
        { type: 2, style: 2, label: 'Warteschlange', emoji: { name: '📜' }, custom_id: 'mu:queue' },
    ] }];
    async function nowPlaying(s) {
        if (!s.text || !s.cur) return;
        await dropNp(s);
        const m = await send(s.text, npEmbed(s));
        s.np = m ? { ch: s.text, id: m.id } : null;
    }
    async function dropNp(s) { if (s.np) { const n = s.np; s.np = null; await rest('DELETE', '/channels/' + n.ch + '/messages/' + n.id).catch(() => {}); } }
    function queueEmbed(s, page = 1) {
        const per = 10, pages = Math.max(1, Math.ceil(s.queue.length / per)); page = Math.min(Math.max(1, page), pages);
        const total = s.queue.reduce((a, t) => a + (t.length || 0), 0);
        const lines = s.queue.slice((page - 1) * per, page * per).map((t, i) => '`' + String((page - 1) * per + i + 1).padStart(2, ' ') + '.` ' + (t.uri ? '[' + cut(t.title, 60).replace(/[[\]]/g, '') + '](' + t.uri + ')' : cut(t.title, 60)) + ' · `' + fmt(t.length) + '`');
        return { embeds: [{ color: GOLD, title: '📜 Warteschlange', description: (s.cur ? '**Jetzt:** ' + cut(s.cur.title, 80) + '\n\n' : '') + (lines.join('\n') || '_leer_'),
            footer: { text: 'Seite ' + page + '/' + pages + ' · ' + s.queue.length + ' Titel · ' + fmt(total) } }] };
    }

    // ---------------- Rechte ----------------
    function isDj(gid, member) {
        const c = cfg(gid);
        if (!c.dj) return true;
        try { const p = BigInt(member.permissions || 0); if ((p & ADMIN) === ADMIN || (p & MANAGE_GUILD) === MANAGE_GUILD) return true; } catch (e) { /* egal */ }
        return (member.roles || []).includes(c.dj);
    }
    function guard(it, needDj) {
        const gid = it.guild_id, uid = it.member.user.id, s = st(gid), ch = voiceOf(gid, uid);
        if (!enabled()) throw new Error('Musik ist auf diesem Bot nicht eingerichtet – der Server-Betreiber muss Lavalink starten (ghostnode-root.sh bot).');
        const c = cfg(gid);
        if (c.channel && it.channel_id !== c.channel) throw new Error('Musikbefehle bitte in <#' + c.channel + '>.');
        if (!ch) throw new Error('Geh zuerst in einen Sprachkanal.');
        if (s.vc && s.joined && s.vc !== ch) throw new Error('Ich bin gerade in <#' + s.vc + '>.');
        if (needDj && !isDj(gid, it.member)) throw new Error('Dafür brauchst du die DJ-Rolle <@&' + c.dj + '>.');
        return { s, ch, uid };
    }

    // ---------------- Steuerung (Befehle, Knöpfe, Dashboard) ----------------
    async function control(gid, act, arg) {
        const s = st(gid);
        const need = () => { if (!s.cur) throw new Error('Gerade läuft nichts.'); };
        switch (act) {
            case 'pause': need(); s.pos = position(s); s.posAt = Date.now(); s.paused = !s.paused; await player(gid, { paused: s.paused }); return s.paused ? '⏸ Pausiert.' : '▶ Weiter geht’s.';
            case 'skip': {
                need();
                const to = Number(arg) || 0;
                if (to > 1) { if (to > s.queue.length) throw new Error('So viele Titel sind nicht in der Warteschlange.'); s.queue.splice(0, to - 1); }
                const was = s.cur.title; const loop = s.loop; if (loop === 'track') s.loop = 'off';
                if (loop === 'queue') s.queue.push(s.cur);
                s.cur = null;
                if (!s.queue.length) await player(gid, { track: { encoded: null } });   // nichts mehr da → Titel anhalten
                await next(s); if (loop === 'track') s.loop = loop;
                return '⏭ Übersprungen: ' + cut(was, 80);
            }
            case 'stop':   // Warteschlange leeren, im Kanal bleiben (geht nach der Leerlaufzeit von selbst, außer 24/7)
                s.queue = []; s.cur = null; s.paused = false;
                if (sid) await player(gid, { track: { encoded: null } }).catch(() => {});
                await next(s);
                return '⏹ Gestoppt – Warteschlange geleert.';
            case 'leave': await cleanup(s, true); return '👋 Tschüss!';
            case 'volume': { const v = Math.max(1, Math.min(150, Number(arg) || 80)); s.volume = v; if (s.cur) await player(gid, { volume: v }); return '🔊 Lautstärke ' + v + ' %'; }
            case 'volup': return control(gid, 'volume', Math.min(150, (s.volume || 80) + 10));
            case 'voldown': return control(gid, 'volume', Math.max(1, (s.volume || 80) - 10));
            case 'loop': s.loop = ['off', 'track', 'queue'].includes(arg) ? arg : ({ off: 'track', track: 'queue', queue: 'off' })[s.loop]; return ({ off: '➡ Wiederholen aus', track: '🔂 Titel wird wiederholt', queue: '🔁 Warteschlange wird wiederholt' })[s.loop];
            case 'shuffle': for (let i = s.queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [s.queue[i], s.queue[j]] = [s.queue[j], s.queue[i]]; } return '🔀 ' + s.queue.length + ' Titel gemischt.';
            case 'remove': { const i = Number(arg) - 1; if (!(i >= 0 && i < s.queue.length)) throw new Error('Diesen Platz gibt es nicht.'); const [t] = s.queue.splice(i, 1); return '🗑 Entfernt: ' + cut(t.title, 80); }
            case 'move': { const [a, b] = String(arg).split(',').map(n => Number(n) - 1); if (!(a >= 0 && a < s.queue.length && b >= 0 && b < s.queue.length)) throw new Error('Ungültiger Platz.'); const [t] = s.queue.splice(a, 1); s.queue.splice(b, 0, t); return '↕ Verschoben.'; }
            case 'clear': s.queue = []; return '🧹 Warteschlange geleert.';
            case 'seek': { need(); const ms = parseTime(arg); if (!s.cur.seek) throw new Error('In diesem Titel kann man nicht springen.'); if (ms < 0 || ms > s.cur.length) throw new Error('Ungültige Zeit.'); await player(gid, { position: ms }); s.pos = ms; s.posAt = Date.now(); return '⏩ Springe zu ' + fmt(ms); }
            case 'effect': { if (!EFFECTS[arg]) throw new Error('Unbekannter Effekt.'); s.effect = arg; if (s.cur) await player(gid, { filters: EFFECTS[arg].f }); return '✨ Effekt: ' + EFFECTS[arg].label; }
            default: throw new Error('Unbekannte Aktion.');
        }
    }
    const refreshNp = s => { if (s.np && s.cur) rest('PATCH', '/channels/' + s.np.ch + '/messages/' + s.np.id, npEmbed(s)).catch(() => {}); };

    const H = {
        async play(it, o) {
            const { ch, uid } = guard(it, false);
            const front = !!o.vorne;
            if (front && !isDj(it.guild_id, it.member)) throw new Error('„Als Nächstes“ geht nur mit DJ-Rolle.');
            const { r, started, s } = await play(it.guild_id, uid, ch, String(o.suche), it.channel_id, front);
            const t = r.tracks[0];
            if (r.playlist) return { embeds: [{ color: COLOR, description: '📃 Playlist **' + cut(r.playlist, 100) + '**: ' + r.tracks.length + ' Titel ' + (front ? 'vorne eingereiht' : 'angehängt') + (r.total > r.tracks.length ? ' (von ' + r.total + ')' : '') + '.' }] };
            if (started) return { content: '🎵 Los geht’s: **' + cut(t.title, 100) + '**' };
            return { embeds: [{ color: COLOR, description: '➕ **' + cut(t.title, 100) + '** · `' + fmt(t.length) + '` – Platz ' + (front ? 1 : s.queue.length) + ' in der Warteschlange' }] };
        },
        async musik(it, o, _r, subName) {
            const gid = it.guild_id, s = st(gid);
            if (subName === 'jetzt') return npEmbed(s);
            if (subName === 'warteschlange') return queueEmbed(s, o.seite || 1);
            // Pause darf jeder, den eigenen Titel überspringen auch – alles andere braucht die DJ-Rolle (wenn eine gesetzt ist)
            const needDj = subName === 'pause' ? false : subName === 'skip' ? !(s.cur && s.cur.by === it.member.user.id) : true;
            guard(it, needDj);
            const map = { pause: ['pause'], skip: ['skip', o.bis], stopp: ['stop'], lautstaerke: ['volume', o.wert], wiederholen: ['loop', o.modus], mischen: ['shuffle'], entfernen: ['remove', o.platz], springen: ['seek', o.zeit], effekt: ['effect', o.name], verlassen: ['leave'] };
            if (!map[subName]) throw new Error('Unbekannt.');
            const msg = await control(gid, ...map[subName]);
            refreshNp(s);
            return { content: msg };
        },
    };
    const EPH = new Set(['musik']);

    async function onComponent(it) {
        const act = String(it.data.custom_id).slice(3), gid = it.guild_id, s = st(gid);
        const eph = c => ({ type: 4, data: { content: c, flags: 64 } });
        if (act === 'queue') return { type: 4, data: Object.assign(queueEmbed(s, 1), { flags: 64 }) };
        try {
            const uid = it.member.user.id;
            if (voiceOf(gid, uid) !== s.vc) return eph('Komm in <#' + s.vc + '>, um die Musik zu steuern.');
            const needDj = !['pause', 'volup', 'voldown'].includes(act) && !(act === 'skip' && s.cur && s.cur.by === uid);
            if (needDj && !isDj(gid, it.member)) return eph('Dafür brauchst du die DJ-Rolle.');
            const msg = await control(gid, act);
            if (['stop'].includes(act) || !s.cur) return eph(msg);
            return { type: 7, data: npEmbed(s) };   // Nachricht mit neuem Stand aktualisieren
        } catch (e) { return eph('⚠ ' + e.message); }
    }

    /** für das Dashboard */
    function status(gid) {
        const s = S.get(gid), c = cfg(gid);
        return { enabled: enabled(), online: wsOk, settings: c, effects: Object.fromEntries(Object.entries(EFFECTS).map(([k, e]) => [k, e.label])),
            channel: s && s.vc || '', listeners: s && s.vc ? listeners(gid, s.vc) : 0, paused: !!(s && s.paused), loop: s ? s.loop : 'off', volume: s && s.volume || c.volume, effect: s ? s.effect : 'aus',
            current: s && s.cur ? { title: s.cur.title, author: s.cur.author, uri: s.cur.uri, art: s.cur.art, length: s.cur.length, position: position(s), by: s.cur.by } : null,
            queue: s ? s.queue.slice(0, 50).map(t => ({ title: t.title, author: t.author, length: t.length, uri: t.uri, by: t.by })) : [], total: s ? s.queue.length : 0 };
    }
    async function dashPlay(gid, uid, q) {
        const ch = voiceOf(gid, uid);
        if (!ch) throw new Error('Geh in Discord in einen Sprachkanal dieses Servers – dann spielt der Bot dort.');
        const { r } = await play(gid, uid, ch, q, (S.get(gid) || {}).text || cfg(gid).channel || '', false);
        return r.playlist ? '📃 ' + r.tracks.length + ' Titel angehängt.' : '🎵 ' + cut(r.tracks[0].title, 100);
    }
    async function dashControl(gid, act, arg) { const s = st(gid); const m = await control(gid, act, arg); refreshNp(s); return m; }

    function stop() { stopped = true; try { if (ws) ws.close(1000); } catch (e) { /* egal */ } }
    function health() { return { enabled: enabled(), online: wsOk, players: stats ? stats.players : 0, playing: stats ? stats.playing : 0 }; }

    return { COMMANDS, H, EPH, onComponent, onVoiceState, onVoiceServer, onGuild, connect, stop, status, dashPlay, dashControl, health, EFFECTS,
        _test: { st, onLL, resolve, fmt, parseTime, setSid: v => { sid = v; } } };
}

module.exports = { create, EFFECTS, fmt, parseTime };
