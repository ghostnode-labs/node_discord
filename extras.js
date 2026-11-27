'use strict';
/*
 * GhostNode-Bot – Extras:
 *  /info server|nutzer · /avatar · /erinnerung (+ Liste, Löschen) · /vorschlag (Abstimmung, Annehmen/Ablehnen) ·
 *  Starboard (⭐-Reaktionen → Ehrenkanal) · eigene Sprachkanäle („➕ Kanal erstellen“) · /8ball · /auswahl · /zufall
 * Einstellungen im Dashboard (Tab „Extras“) oder per /extras.
 * core = { rest, log, store, botId() }
 */
const COLOR = 0x38d5e6, GOLD = 0xf3c262, GREEN = 0x4ade80, RED = 0xef4444;
const O = { SUB: 1, STR: 3, INT: 4, BOOL: 5, USER: 6, CHANNEL: 7, ROLE: 8 };
const opt = (type, name, description, required = false, extra = {}) => Object.assign({ type, name, description, required }, extra);
const sub = (name, description, options = []) => ({ type: O.SUB, name, description, options });
const MANAGE_GUILD = 1n << 5n, ADMIN = 1n << 3n, MANAGE_CHANNELS = 1n << 4n;
const MAX_REM = 25;

const COMMANDS = [
    { name: 'info', description: 'Infos über den Server oder ein Mitglied', options: [
        sub('server', 'Infos über diesen Server'),
        sub('nutzer', 'Infos über ein Mitglied', [opt(O.USER, 'nutzer', 'Wer? (leer = du)')]),
    ] },
    { name: 'avatar', description: 'Profilbild groß anzeigen', options: [opt(O.USER, 'nutzer', 'Wer? (leer = du)')] },
    { name: 'erinnerung', description: '⏰ Erinnerungen', options: [
        sub('neu', 'Erinnere mich …', [opt(O.STR, 'in', 'Wann? z. B. 10m, 2h, 1d12h', true, { max_length: 20 }), opt(O.STR, 'text', 'Woran?', true, { max_length: 400 })]),
        sub('liste', 'Meine Erinnerungen'),
    ] },
    { name: 'vorschlag', description: '💡 Vorschlag einreichen – alle stimmen ab', options: [opt(O.STR, 'text', 'Dein Vorschlag', true, { max_length: 1000 })] },
    { name: '8ball', description: '🎱 Die magische Kugel antwortet', options: [opt(O.STR, 'frage', 'Deine Frage', true, { max_length: 200 })] },
    { name: 'auswahl', description: '🎯 Der Bot entscheidet', options: [opt(O.STR, 'optionen', 'Mit Komma getrennt, z. B. Pizza, Burger, Sushi', true, { max_length: 400 })] },
    { name: 'zufall', description: '🔢 Zufallszahl', options: [opt(O.INT, 'von', 'ab (Standard 1)'), opt(O.INT, 'bis', 'bis (Standard 100)')] },
];
const BALL = ['Ja, auf jeden Fall.', 'Ohne Zweifel.', 'Sieht gut aus.', 'Die Zeichen stehen auf Ja.', 'Frag später nochmal.', 'Besser, ich sag’s dir jetzt nicht.',
    'Konzentrier dich und frag nochmal.', 'Eher nicht.', 'Meine Quellen sagen nein.', 'Sehr zweifelhaft.', 'Absolut!', 'Die Sterne sind unentschlossen.'];

const snowTime = id => { try { return Number((BigInt(id) >> 22n) + 1420070400000n); } catch (e) { return 0; } };
const ts = (ms, f = 'R') => '<t:' + Math.floor(ms / 1000) + ':' + f + '>';
const mention = id => '<@' + id + '>';
const cut = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
/** „1d2h30m“, „90m“, „45“ (= Minuten) → ms */
function parseIn(t) {
    t = String(t || '').trim().toLowerCase().replace(/\s+/g, '');
    if (/^\d+$/.test(t)) return Number(t) * 60000;
    const re = /(\d+)(w|d|t|h|std|m|min|s|sek)/g; let m, ms = 0, used = '';
    while ((m = re.exec(t))) { const n = Number(m[1]); ms += n * ({ w: 604800, d: 86400, t: 86400, h: 3600, std: 3600, m: 60, min: 60, s: 1, sek: 1 })[m[2]] * 1000; used += m[0]; }
    return used === t && ms > 0 ? ms : -1;
}
const avatarUrl = (u, m, gid) => m && m.avatar ? 'https://cdn.discordapp.com/guilds/' + gid + '/users/' + u.id + '/avatars/' + m.avatar + (m.avatar.startsWith('a_') ? '.gif' : '.png') + '?size=1024'
    : u.avatar ? 'https://cdn.discordapp.com/avatars/' + u.id + '/' + u.avatar + (u.avatar.startsWith('a_') ? '.gif' : '.png') + '?size=1024'
    : 'https://cdn.discordapp.com/embed/avatars/' + (Number((BigInt(u.id) >> 22n) % 6n)) + '.png';

function create(core) {
    const { rest, log, store } = core;
    const send = (ch, d) => rest('POST', '/channels/' + ch + '/messages', Object.assign({ allowed_mentions: { parse: [] } }, d));
    const ex = gid => { const d = store.get(gid); d.extras = Object.assign({ suggest: '', star: '', starMin: 3, starEmoji: '⭐', tempHub: '', tempName: '🔊 {name}', tempLimit: 0 }, d.extras || {}); return d.extras; };
    const isMod = member => { try { const p = BigInt(member.permissions || 0); return (p & ADMIN) === ADMIN || (p & MANAGE_GUILD) === MANAGE_GUILD; } catch (e) { return false; } };
    const VS = new Map();   // guildId → Map(userId → channelId)
    const busy = new Set();

    // ---------------- Befehle ----------------
    const H = {
        async info(it, o, resolved, subName) {
            const gid = it.guild_id;
            if (subName === 'server') {
                const g = await rest('GET', '/guilds/' + gid + '?with_counts=true');
                const chans = await rest('GET', '/guilds/' + gid + '/channels').catch(() => []);
                const text = chans.filter(c => [0, 5, 15].includes(c.type)).length, voice = chans.filter(c => [2, 13].includes(c.type)).length;
                return { embeds: [{ color: COLOR, title: '🛰 ' + g.name, thumbnail: g.icon ? { url: 'https://cdn.discordapp.com/icons/' + gid + '/' + g.icon + '.png?size=256' } : undefined,
                    description: g.description ? cut(g.description, 300) : undefined,
                    fields: [{ name: 'Inhaber', value: mention(g.owner_id), inline: true }, { name: 'Erstellt', value: ts(snowTime(gid), 'D'), inline: true },
                        { name: 'Mitglieder', value: (g.approximate_member_count || '?') + ' (' + (g.approximate_presence_count || 0) + ' online)', inline: true },
                        { name: 'Kanäle', value: text + ' Text · ' + voice + ' Sprache', inline: true }, { name: 'Rollen', value: String((g.roles || []).length), inline: true },
                        { name: 'Boosts', value: (g.premium_subscription_count || 0) + ' (Stufe ' + (g.premium_tier || 0) + ')', inline: true }],
                    image: g.banner ? { url: 'https://cdn.discordapp.com/banners/' + gid + '/' + g.banner + '.png?size=1024' } : undefined, footer: { text: 'ID ' + gid } }] };
            }
            const uid = o.nutzer || it.member.user.id;
            const u = (resolved && resolved.users && resolved.users[uid]) || it.member.user;
            const m = (resolved && resolved.members && resolved.members[uid]) || (uid === it.member.user.id ? it.member : await rest('GET', '/guilds/' + gid + '/members/' + uid).catch(() => null));
            const d = store.get(gid), lv = d.xp && d.xp[uid];
            return { embeds: [{ color: COLOR, author: { name: (u.global_name || u.username) + (u.bot ? ' 🤖' : ''), icon_url: avatarUrl(u, null, gid) }, thumbnail: { url: avatarUrl(u, m, gid) },
                fields: [{ name: 'Nutzer', value: mention(uid) + '\n`' + u.username + '`', inline: true }, { name: 'Konto erstellt', value: ts(snowTime(uid), 'D'), inline: true },
                    { name: 'Beigetreten', value: m && m.joined_at ? ts(Date.parse(m.joined_at), 'D') : '–', inline: true },
                    { name: 'Rollen', value: m && m.roles && m.roles.length ? cut(m.roles.slice(0, 15).map(r => '<@&' + r + '>').join(' '), 1000) : '–' },
                    ...(lv ? [{ name: 'XP', value: String(lv.xp || 0), inline: true }] : []), ...(d.warns && d.warns[uid] ? [{ name: 'Verwarnungen', value: String(d.warns[uid].length), inline: true }] : [])],
                footer: { text: 'ID ' + uid } }] };
        },
        async avatar(it, o, resolved) {
            const uid = o.nutzer || it.member.user.id;
            const u = (resolved && resolved.users && resolved.users[uid]) || it.member.user;
            const m = resolved && resolved.members && resolved.members[uid] || (uid === it.member.user.id ? it.member : null);
            const url = avatarUrl(u, m, it.guild_id);
            return { embeds: [{ color: COLOR, title: '🖼 ' + (u.global_name || u.username), url, image: { url } }] };
        },
        async erinnerung(it, o, _r, subName) {
            const gid = it.guild_id, uid = it.member.user.id, d = store.get(gid); d.reminders = d.reminders || [];
            if (subName === 'liste') {
                const mine = d.reminders.filter(r => r.uid === uid).sort((a, b) => a.at - b.at);
                if (!mine.length) return { content: 'Du hast keine offenen Erinnerungen.' };
                return { embeds: [{ color: GOLD, title: '⏰ Deine Erinnerungen', description: mine.map((r, i) => '`' + (i + 1) + '.` ' + ts(r.at) + ' – ' + cut(r.text, 80)).join('\n') }],
                    components: [{ type: 1, components: mine.slice(0, 5).map((r, i) => ({ type: 2, style: 4, label: 'Nr. ' + (i + 1) + ' löschen', custom_id: 'gx:rm:' + r.id })) }] };
            }
            const ms = parseIn(o.in);
            if (ms < 0) throw new Error('Zeit nicht verstanden – z. B. 10m, 2h, 1d12h.');
            if (ms < 30000 || ms > 366 * 86400000) throw new Error('Zwischen 30 Sekunden und einem Jahr, bitte.');
            if (d.reminders.filter(r => r.uid === uid).length >= MAX_REM) throw new Error('Höchstens ' + MAX_REM + ' offene Erinnerungen.');
            const r = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), uid, ch: it.channel_id, at: Date.now() + ms, text: String(o.text).slice(0, 400), made: Date.now() };
            d.reminders.push(r); store.save(gid);
            return { content: '⏰ Ich erinnere dich ' + ts(r.at) + ' (' + ts(r.at, 'f') + ').' };
        },
        async vorschlag(it, o) {
            const gid = it.guild_id, c = ex(gid), ch = c.suggest || it.channel_id;
            const msg = await send(ch, { embeds: [suggEmbed({ by: it.member.user.id, text: String(o.text), up: [], down: [], state: '' })], components: suggButtons() });
            const d = store.get(gid); d.sugg = d.sugg || {}; d.sugg[msg.id] = { by: it.member.user.id, text: String(o.text).slice(0, 1000), up: [], down: [], state: '', at: Date.now() };
            const keys = Object.keys(d.sugg); if (keys.length > 300) for (const k of keys.sort((a, b) => d.sugg[a].at - d.sugg[b].at).slice(0, keys.length - 300)) delete d.sugg[k];
            store.save(gid);
            return { content: '💡 Vorschlag eingereicht' + (ch !== it.channel_id ? ' in <#' + ch + '>' : '') + '.', flags: 64 };
        },
        async '8ball'(it, o) { return { embeds: [{ color: 0x9b59b6, description: '❓ ' + cut(o.frage, 200) + '\n\n🎱 **' + BALL[Math.floor(Math.random() * BALL.length)] + '**' }] }; },
        async auswahl(it, o) {
            const opts = String(o.optionen).split(/[,;|\n]/).map(x => x.trim()).filter(Boolean).slice(0, 25);
            if (opts.length < 2) throw new Error('Mindestens zwei Optionen, mit Komma getrennt.');
            return { embeds: [{ color: GOLD, description: '🎯 Aus ' + opts.length + ' Optionen wähle ich: **' + cut(opts[Math.floor(Math.random() * opts.length)], 200) + '**' }] };
        },
        async zufall(it, o) {
            let a = Number.isFinite(o.von) ? o.von : 1, b = Number.isFinite(o.bis) ? o.bis : 100; if (a > b) [a, b] = [b, a];
            return { content: '🔢 Zwischen ' + a + ' und ' + b + ': **' + (a + Math.floor(Math.random() * (b - a + 1))) + '**' };
        },
    };
    const EPH = new Set(['erinnerung']);

    // ---------------- Vorschläge ----------------
    function suggEmbed(s) {
        const up = s.up.length, down = s.down.length, n = up + down, pct = n ? Math.round(up / n * 100) : 0;
        const st = s.state === 'ok' ? ['✅ Angenommen', GREEN] : s.state === 'no' ? ['❌ Abgelehnt', RED] : ['💡 Vorschlag', GOLD];
        return { color: st[1], title: st[0], description: cut(s.text, 1000) + '\n\n👍 **' + up + '** · 👎 **' + down + '**' + (n ? ' · ' + pct + ' % dafür' : ''),
            fields: [{ name: 'Von', value: mention(s.by), inline: true }, ...(s.mod ? [{ name: s.state === 'ok' ? 'Angenommen von' : 'Abgelehnt von', value: mention(s.mod), inline: true }] : [])] };
    }
    const suggButtons = closed => [{ type: 1, components: [
        { type: 2, style: 3, emoji: { name: '👍' }, custom_id: 'gx:sg:up', disabled: !!closed }, { type: 2, style: 4, emoji: { name: '👎' }, custom_id: 'gx:sg:down', disabled: !!closed },
        { type: 2, style: 2, label: closed ? 'Wieder öffnen' : 'Annehmen', custom_id: closed ? 'gx:sg:open' : 'gx:sg:ok' }, ...(closed ? [] : [{ type: 2, style: 2, label: 'Ablehnen', custom_id: 'gx:sg:no' }])] }];

    async function onComponent(it) {
        const id = String(it.data.custom_id), gid = it.guild_id, uid = it.member && it.member.user.id, d = store.get(gid);
        const eph = c => ({ type: 4, data: { content: c, flags: 64 } });
        if (id.startsWith('gx:rm:')) {
            const before = (d.reminders || []).length;
            d.reminders = (d.reminders || []).filter(r => !(r.id === id.slice(6) && r.uid === uid));
            if (d.reminders.length === before) return eph('Schon erledigt oder nicht deine.');
            store.save(gid); return eph('🗑 Erinnerung gelöscht.');
        }
        if (id.startsWith('gx:sg:')) {
            const s = d.sugg && d.sugg[it.message.id];
            if (!s) return eph('Dieser Vorschlag ist zu alt.');
            const act = id.slice(6);
            if (act === 'up' || act === 'down') {
                if (s.state) return eph('Abstimmung ist geschlossen.');
                const other = act === 'up' ? 'down' : 'up';
                s[other] = s[other].filter(x => x !== uid);
                if (s[act].includes(uid)) s[act] = s[act].filter(x => x !== uid); else s[act].push(uid);
            } else {
                if (!isMod(it.member)) return eph('Nur das Team (Server verwalten) kann Vorschläge annehmen oder ablehnen.');
                s.state = act === 'open' ? '' : act; s.mod = act === 'open' ? '' : uid;
            }
            store.save(gid);
            return { type: 7, data: { embeds: [suggEmbed(s)], components: suggButtons(!!s.state) } };
        }
        return eph('Unbekannter Knopf.');
    }

    // ---------------- Erinnerungen ----------------
    async function tick() {
        const now = Date.now();
        for (const gid of store.guilds()) {
            const d = store.get(gid); if (!d.reminders || !d.reminders.length) continue;
            const due = d.reminders.filter(r => r.at <= now);
            if (!due.length) continue;
            d.reminders = d.reminders.filter(r => r.at > now); store.save(gid);
            for (const r of due) {
                const body = { content: '⏰ ' + mention(r.uid) + ' Erinnerung: ' + cut(r.text, 1500), allowed_mentions: { users: [r.uid] } };
                try { await rest('POST', '/channels/' + r.ch + '/messages', body); }
                catch (e) {   // Kanal weg → per DM
                    try { const dm = await rest('POST', '/users/@me/channels', { recipient_id: r.uid }); await rest('POST', '/channels/' + dm.id + '/messages', { content: '⏰ Erinnerung: ' + cut(r.text, 1500) }); } catch (e2) { log('Erinnerung nicht zustellbar:', e2.message); }
                }
            }
        }
    }

    // ---------------- Starboard ----------------
    async function onReaction(r, added) {
        if (!r.guild_id) return;
        const c = ex(r.guild_id);
        if (!c.star || r.channel_id === c.star) return;
        const em = r.emoji && (r.emoji.id ? r.emoji.name + ':' + r.emoji.id : r.emoji.name);
        if (em !== c.starEmoji && !(r.emoji && r.emoji.name === c.starEmoji)) return;
        const key = r.guild_id + ':' + r.message_id; if (busy.has(key)) return; busy.add(key);
        try {
            const m = await rest('GET', '/channels/' + r.channel_id + '/messages/' + r.message_id);
            const re = (m.reactions || []).find(x => (x.emoji.id ? x.emoji.name + ':' + x.emoji.id : x.emoji.name) === em);
            let n = re ? re.count : 0;
            if (re && re.me) n--;
            const d = store.get(r.guild_id); d.stars = d.stars || {};
            const posted = d.stars[r.message_id];
            if (m.author && m.author.bot) return;
            const img = (m.attachments || []).find(a => /^image\//.test(a.content_type || '') || /\.(png|jpe?g|gif|webp)$/i.test(a.filename || ''));
            const embed = { color: GOLD, author: { name: m.author.global_name || m.author.username, icon_url: avatarUrl(m.author, null, r.guild_id) },
                description: (cut(m.content, 1800) || (img ? '' : '_(ohne Text)_')) + '\n\n[→ Zur Nachricht](https://discord.com/channels/' + r.guild_id + '/' + r.channel_id + '/' + r.message_id + ')',
                image: img ? { url: img.url } : undefined, timestamp: m.timestamp, footer: { text: '#' + (m.channel_id || '') } };
            const content = c.starEmoji + ' **' + n + '** · <#' + r.channel_id + '>';
            if (n >= c.starMin) {
                if (posted) await rest('PATCH', '/channels/' + c.star + '/messages/' + posted, { content, embeds: [embed] }).catch(() => {});
                else { const s = await send(c.star, { content, embeds: [embed] }); d.stars[r.message_id] = s.id; store.save(r.guild_id); }
            } else if (posted && !added) {
                await rest('PATCH', '/channels/' + c.star + '/messages/' + posted, { content }).catch(() => {});
            }
        } catch (e) { log('Starboard:', e.message); } finally { busy.delete(key); }
    }

    // ---------------- eigene Sprachkanäle ----------------
    function onGuild(g) {
        const m = new Map(); for (const v of g.voice_states || []) m.set(v.user_id, v.channel_id); VS.set(g.id, m);
        // verwaiste Temp-Kanäle nach einem Neustart aufräumen
        const d = store.get(g.id);
        if (d.temp) for (const ch of Object.keys(d.temp)) if (![...m.values()].includes(ch)) { delete d.temp[ch]; rest('DELETE', '/channels/' + ch).catch(() => {}); store.save(g.id); }
    }
    async function onVoiceState(v) {
        if (!v.guild_id) return;
        const gid = v.guild_id, m = VS.get(gid) || new Map(); VS.set(gid, m);
        const before = m.get(v.user_id) || '';
        if (v.channel_id) m.set(v.user_id, v.channel_id); else m.delete(v.user_id);
        const d = store.get(gid), c = ex(gid);
        d.temp = d.temp || {};
        // verlassener Temp-Kanal leer → löschen
        if (before && before !== v.channel_id && d.temp[before] && ![...m.values()].includes(before)) {
            delete d.temp[before]; store.save(gid);
            await rest('DELETE', '/channels/' + before).catch(e => log('Temp-Kanal löschen:', e.message));
        }
        // Beitritt zum „➕ Kanal erstellen“
        if (c.tempHub && v.channel_id === c.tempHub && v.user_id !== String(core.botId()) && !(v.member && v.member.user && v.member.user.bot)) {
            const own = Object.entries(d.temp).find(([, o]) => o === v.user_id);
            try {
                let target = own && own[0];
                if (!target) {
                    const hub = await rest('GET', '/channels/' + c.tempHub);
                    const name = String(c.tempName || '🔊 {name}').replace('{name}', (v.member && (v.member.nick || (v.member.user && (v.member.user.global_name || v.member.user.username)))) || 'Kanal').slice(0, 90);
                    const ch = await rest('POST', '/guilds/' + gid + '/channels', { name, type: 2, parent_id: hub.parent_id || undefined, user_limit: Math.max(0, Math.min(99, Number(c.tempLimit) || 0)), bitrate: hub.bitrate || undefined,
                        permission_overwrites: [{ id: v.user_id, type: 1, allow: String(MANAGE_CHANNELS | (1n << 20n) | (1n << 22n) | (1n << 23n)) }] });   // verwalten, verbinden, stummschalten, verschieben
                    target = ch.id; d.temp[target] = v.user_id; store.save(gid);
                }
                await rest('PATCH', '/guilds/' + gid + '/members/' + v.user_id, { channel_id: target });
            } catch (e) { log('Temp-Kanal:', e.message); }
        }
    }

    function settingsOf(gid) { return ex(gid); }
    function saveSettings(gid, b) {
        const c = ex(gid), id = x => (/^\d{15,22}$/.test(String(x || '')) ? String(x) : '');
        if ('suggest' in b) c.suggest = id(b.suggest);
        if ('star' in b) c.star = id(b.star);
        if ('starMin' in b) c.starMin = Math.max(1, Math.min(50, Number(b.starMin) || 3));
        if ('starEmoji' in b) c.starEmoji = String(b.starEmoji || '⭐').trim().slice(0, 64) || '⭐';
        if ('tempHub' in b) c.tempHub = id(b.tempHub);
        if ('tempName' in b) c.tempName = String(b.tempName || '🔊 {name}').slice(0, 80) || '🔊 {name}';
        if ('tempLimit' in b) c.tempLimit = Math.max(0, Math.min(99, Number(b.tempLimit) || 0));
        store.save(gid); return c;
    }

    return { COMMANDS, H, EPH, onComponent, tick, onReaction, onGuild, onVoiceState, settingsOf, saveSettings, _test: { parseIn, suggEmbed } };
}

module.exports = { create, parseIn };
