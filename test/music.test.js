'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), crypto = require('crypto');
const { Store } = require('../store');
const music = require('../music');

/** Mini-Lavalink: REST + WebSocket (Textrahmen ohne Maske vom Server) – nur für Tests */
function fakeLavalink() {
    const calls = [], socks = [];
    const tracks = { lofi: { encoded: 'E1', info: { title: 'Lofi Beats', author: 'Chill', length: 180000, uri: 'https://yt/1', isSeekable: true, isStream: false, sourceName: 'youtube' } },
        rock: { encoded: 'E2', info: { title: 'Rock On', author: 'Band', length: 200000, uri: 'https://yt/2', isSeekable: true, isStream: false, sourceName: 'youtube' } } };
    const srv = http.createServer((q, s) => { let b = ''; q.on('data', c => { b += c; }); q.on('end', () => {
        calls.push([q.method, q.url, b ? JSON.parse(b) : null, q.headers.authorization]);
        if (q.headers.authorization !== 'pw') { s.writeHead(401); return s.end('{}'); }
        const u = new URL(q.url, 'http://x');
        if (u.pathname === '/v4/loadtracks') {
            const id = u.searchParams.get('identifier');
            if (id.startsWith('https://rr.googlevideo.test/')) return json(s, { loadType: 'track', data: { encoded: 'YT1', info: { title: 'videoplayback', author: 'unknown', length: 180000, uri: id, isSeekable: true, isStream: false, sourceName: 'http' } } });
            if (id.startsWith('scsearch:') && id.includes('Lofi Beats')) return json(s, { loadType: 'search', data: [{ encoded: 'SC1', info: { title: 'Lofi Beats (SC)', author: 'Chill', length: 180000, uri: 'https://sc/1', isSeekable: true, isStream: false, sourceName: 'soundcloud' } }] });
            const key = Object.keys(tracks).find(k => id.endsWith(':' + k));
            if (id.startsWith('https://list')) return json(s, { loadType: 'playlist', data: { info: { name: 'Mix' }, tracks: [tracks.lofi, tracks.rock] } });
            return json(s, key ? { loadType: 'search', data: [tracks[key]] } : { loadType: 'empty', data: {} });
        }
        if (q.method === 'DELETE') { s.writeHead(204); return s.end(); }
        return json(s, {});
    }); });
    const json = (s, o) => { s.writeHead(200, { 'Content-Type': 'application/json' }); s.end(JSON.stringify(o)); };
    srv.on('upgrade', (q, so) => {
        calls.push(['WS', q.url, null, q.headers.authorization, q.headers['user-id']]);
        const acc = crypto.createHash('sha1').update(q.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
        so.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
        so.on('error', () => {}); so.on('data', () => {});
        socks.push(so);
        push({ op: 'ready', resumed: false, sessionId: 'S1' });
    });
    function push(o) {
        const p = Buffer.from(JSON.stringify(o)), h = p.length < 126 ? Buffer.from([0x81, p.length]) : Buffer.from([0x81, 126, p.length >> 8, p.length & 255]);
        for (const so of socks) so.write(Buffer.concat([h, p]));
    }
    return { srv, calls, push, close: () => { for (const so of socks) so.destroy(); srv.close(); } };
}
const wait = (fn, ms = 3000) => new Promise((res, rej) => { const t0 = Date.now(); const i = setInterval(() => { const v = fn(); if (v) { clearInterval(i); res(v); } else if (Date.now() - t0 > ms) { clearInterval(i); rej(new Error('Zeitüberschreitung')); } }, 10); });

test('Musik: ohne Lavalink verständliche Meldung, Zeiten, Effekte', async () => {
    const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'gn-mu0-')));
    const M = music.create({ rest: async () => ({}), log: () => {}, store, botId: () => '42', voice: () => {} });
    const it = { guild_id: '1', channel_id: 'T', member: { user: { id: '7' }, roles: [], permissions: '0' } };
    await assert.rejects(M.H.play(it, { suche: 'x' }), /nicht eingerichtet/);
    assert.strictEqual(music.fmt(65000), '1:05'); assert.strictEqual(music.fmt(3725000), '1:02:05'); assert.strictEqual(music.fmt(0), 'LIVE');
    assert.strictEqual(music.parseTime('1:30'), 90000); assert.strictEqual(music.parseTime('45'), 45000); assert.strictEqual(music.parseTime('a:b'), -1);
    assert.ok(music.EFFECTS.nightcore.f.timescale && music.EFFECTS.aus.f);
});

test('Musik: Sprachkanal → Lavalink, Warteschlange, Titelwechsel, DJ-Rolle, Knöpfe, Stopp', async () => {
    const L = fakeLavalink(); await new Promise(r => L.srv.listen(0, '127.0.0.1', r));
    const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'gn-mu-')));
    const sent = [], voiceCalls = [];
    let M;
    const rest = async (m, route, body) => { sent.push([m, route, body]); return m === 'POST' ? { id: 'np' + sent.length } : null; };
    M = music.create({ rest, log: () => {}, store, botId: () => '42', url: 'http://127.0.0.1:' + L.srv.address().port, password: 'pw',
        voice: (gid, ch) => { voiceCalls.push([gid, ch]); if (ch) setTimeout(() => { M.onVoiceState({ guild_id: gid, user_id: '42', channel_id: ch, session_id: 'sess' }); M.onVoiceServer({ guild_id: gid, token: 'tok', endpoint: 'ep.discord.media' }); }, 5); } });
    try {
        M.connect();
        await wait(() => L.calls.some(c => c[0] === 'WS'));
        const ws = L.calls.find(c => c[0] === 'WS'); assert.strictEqual(ws[3], 'pw'); assert.strictEqual(ws[4], '42', 'User-Id = Bot');
        await wait(() => M.health().online);
        M.onGuild({ id: 'G', voice_states: [{ user_id: '7', channel_id: 'V' }, { user_id: '8', channel_id: 'V' }] });
        const it = uid => ({ guild_id: 'G', channel_id: 'T', member: { user: { id: uid }, roles: [], permissions: '0' } });
        // nicht im Sprachkanal
        await assert.rejects(M.H.play(it('99'), { suche: 'lofi' }), /Sprachkanal/);
        // erster Titel: beitreten, Sprachdaten weiterreichen, abspielen
        let r = await M.H.play(it('7'), { suche: 'lofi' });
        assert.match(r.content, /Lofi Beats/);
        assert.deepStrictEqual(voiceCalls[0], ['G', 'V']);
        const patches = () => L.calls.filter(c => c[0] === 'PATCH' && c[1].startsWith('/v4/sessions/S1/players/G')).map(c => c[2]);
        assert.deepStrictEqual(patches()[0].voice, { token: 'tok', endpoint: 'ep.discord.media', sessionId: 'sess', channelId: 'V' });
        assert.strictEqual(patches()[1].track.encoded, 'E1'); assert.strictEqual(patches()[1].volume, 80);
        assert.ok(L.calls.some(c => c[1].includes('identifier=ytsearch%3Alofi')), 'Suche über YouTube');
        // zweiter Titel landet in der Warteschlange
        r = await M.H.play(it('8'), { suche: 'rock' });
        assert.match(r.embeds[0].description, /Rock On.*Platz 1/);
        // Start-Ereignis → „Jetzt läuft“-Nachricht mit Knöpfen
        L.push({ op: 'event', type: 'TrackStartEvent', guildId: 'G', track: {} });
        await wait(() => sent.some(s => s[0] === 'POST' && s[1] === '/channels/T/messages'));
        const np = sent.find(s => s[0] === 'POST' && s[1] === '/channels/T/messages')[2];
        assert.match(np.embeds[0].title, /Lofi Beats/); assert.ok(np.components[0].components.some(b => b.custom_id === 'mu:skip'));
        // Titel zu Ende → nächster
        L.push({ op: 'event', type: 'TrackEndEvent', guildId: 'G', reason: 'finished' });
        await wait(() => patches().some(p => p.track && p.track.encoded === 'E2'));
        // DJ-Rolle: ohne Rolle kein Stopp, aber Pause geht
        store.get('G').music = { dj: 'R1' }; store.save('G');
        await assert.rejects(M.H.musik(it('7'), {}, null, 'stopp'), /DJ-Rolle/);
        r = await M.H.musik(it('7'), {}, null, 'pause'); assert.match(r.content, /Pausiert/);
        assert.ok(patches().some(p => p.paused === true));
        // Knopf: Wer nicht im Kanal ist, darf nicht steuern; im Kanal + eigener Titel → Überspringen erlaubt
        let b = await M.onComponent({ guild_id: 'G', data: { custom_id: 'mu:skip' }, member: { user: { id: '99' }, roles: [], permissions: '0' } });
        assert.match(b.data.content, /Komm in/);
        b = await M.onComponent({ guild_id: 'G', data: { custom_id: 'mu:skip' }, member: { user: { id: '8' }, roles: [], permissions: '0' } });
        assert.ok(b.data.content && /Übersprungen/.test(b.data.content), JSON.stringify(b));
        assert.ok(patches().some(p => p.track && p.track.encoded === null), 'leere Warteschlange → angehalten');
        // Mit DJ-Rolle: Lautstärke, Effekt
        const dj = { guild_id: 'G', channel_id: 'T', member: { user: { id: '7' }, roles: ['R1'], permissions: '0' } };
        await M.H.play(dj, { suche: 'lofi' });
        r = await M.H.musik(dj, { wert: 120 }, null, 'lautstaerke'); assert.match(r.content, /120/);
        r = await M.H.musik(dj, { name: 'nightcore' }, null, 'effekt'); assert.match(r.content, /Nightcore/);
        assert.ok(patches().some(p => p.filters && p.filters.timescale && p.filters.timescale.speed === 1.2));
        const st = M.status('G'); assert.strictEqual(st.current.title, 'Lofi Beats'); assert.strictEqual(st.volume, 120); assert.strictEqual(st.channel, 'V');
        // Playlist
        r = await M.H.play(dj, { suche: 'https://list.example/mix' }); assert.match(r.embeds[0].description, /Playlist \*\*Mix\*\*: 2 Titel/);
        assert.strictEqual(M.status('G').total, 2);
        // Verlassen
        r = await M.H.musik(dj, {}, null, 'verlassen'); assert.match(r.content, /Tschüss/);
        assert.deepStrictEqual(voiceCalls[voiceCalls.length - 1], ['G', null]);
        assert.ok(L.calls.some(c => c[0] === 'DELETE' && c[1] === '/v4/sessions/S1/players/G'));
        assert.strictEqual(M.status('G').current, null);
    } finally { M.stop(); L.close(); }
});

test('Musik: YouTube verlangt Anmeldung → SoundCloud-Ersatz, Meldungen gebündelt', async () => {
    const L = fakeLavalink(); await new Promise(r => L.srv.listen(0, '127.0.0.1', r));
    const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'gn-mu2-')));
    const sent = []; let M;
    const rest = async (m, route, body) => { sent.push([m, route, body]); return m === 'POST' ? { id: 'n' + sent.length } : null; };
    M = music.create({ rest, log: () => {}, store, botId: () => '42', url: 'http://127.0.0.1:' + L.srv.address().port, password: 'pw',
        voice: (gid, ch) => { if (ch) setTimeout(() => { M.onVoiceState({ guild_id: gid, user_id: '42', channel_id: ch, session_id: 's' }); M.onVoiceServer({ guild_id: gid, token: 't', endpoint: 'e' }); }, 5); } });
    try {
        M.connect(); await wait(() => L.calls.some(c => c[0] === 'WS')); await wait(() => M.health().online);
        M.onGuild({ id: 'G', voice_states: [{ user_id: '7', channel_id: 'V' }] });
        const it = { guild_id: 'G', channel_id: 'T', member: { user: { id: '7' }, roles: [], permissions: '0' } };
        await M.H.play(it, { suche: 'lofi' }); await M.H.play(it, { suche: 'rock' });
        const patches = () => L.calls.filter(c => c[0] === 'PATCH' && c[1].startsWith('/v4/sessions/S1/players/G')).map(c => c[2]);
        const texts = () => sent.filter(s => s[0] === 'POST' && s[1] === '/channels/T/messages').map(s => s[2].content || '').filter(Boolean);
        const fail = () => { L.push({ op: 'event', type: 'TrackExceptionEvent', guildId: 'G', exception: { message: '(yts.version: 1.18.2) All clients failed to load the item.\nClient [ANDROID_VR] failed: This video requires login.\n    at dev.lavalink.Foo' } }); L.push({ op: 'event', type: 'TrackEndEvent', guildId: 'G', reason: 'loadFailed' }); };
        fail();
        await wait(() => patches().some(p => p.track && p.track.encoded === 'SC1'));
        assert.ok(texts().some(t => /↪ YouTube verlangt eine Anmeldung.*SoundCloud/.test(t)), texts().join('|'));
        assert.ok(!texts().some(t => /at dev\.lavalink/.test(t)), 'kein Stacktrace im Chat');
        fail();   // auch der Ersatz scheitert → übersprungen, nächster Titel (Rock: kein SoundCloud-Treffer)
        await wait(() => patches().some(p => p.track && p.track.encoded === 'E2'));
        assert.ok(texts().some(t => /Übersprungen: \*\*Lofi Beats \(SC\)\*\*/.test(t)));
        fail(); await wait(() => !M.status('G').current);
        assert.strictEqual(texts().filter(t => /Übersprungen/.test(t)).length, 1, 'nur eine Einzelmeldung');
        await M.H.musik(it, {}, null, 'verlassen');
    } finally { M.stop(); L.close(); }
});

test('Musik: yt-dlp-Ausweichweg vor SoundCloud (nur YouTube-Adressen, Titel bleibt)', async () => {
    const L = fakeLavalink(); await new Promise(r => L.srv.listen(0, '127.0.0.1', r));
    const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'gn-mu3-')));
    const sent = [], asked = []; let M;
    const rest = async (m, route, body) => { sent.push([m, route, body]); return m === 'POST' ? { id: 'n' + sent.length } : null; };
    M = music.create({ rest, log: () => {}, store, botId: () => '42', url: 'http://127.0.0.1:' + L.srv.address().port, password: 'pw',
        ytdlp: async u => { asked.push(u); return { url: 'https://rr.googlevideo.test/audio?id=1', title: 'x', author: 'y', length: 1 }; },
        voice: (gid, ch) => { if (ch) setTimeout(() => { M.onVoiceState({ guild_id: gid, user_id: '42', channel_id: ch, session_id: 's' }); M.onVoiceServer({ guild_id: gid, token: 't', endpoint: 'e' }); }, 5); } });
    try {
        M.connect(); await wait(() => M.health().online); assert.strictEqual(M.health().ytdlp, true);
        M.onGuild({ id: 'G', voice_states: [{ user_id: '7', channel_id: 'V' }] });
        const it = { guild_id: 'G', channel_id: 'T', member: { user: { id: '7' }, roles: [], permissions: '0' } };
        await M.H.play(it, { suche: 'lofi' });
        const patches = () => L.calls.filter(c => c[0] === 'PATCH' && c[1].startsWith('/v4/sessions/S1/players/G')).map(c => c[2]);
        const fail = () => { L.push({ op: 'event', type: 'TrackExceptionEvent', guildId: 'G', exception: { message: 'This video requires login.' } }); L.push({ op: 'event', type: 'TrackEndEvent', guildId: 'G', reason: 'loadFailed' }); };
        fail();
        await wait(() => patches().some(p => p.track && p.track.encoded === 'YT1'));
        assert.strictEqual(asked[0], 'https://yt/1'); assert.strictEqual(asked.length, 1);
        assert.strictEqual(M.status('G').current.title, 'Lofi Beats', 'Titel aus YouTube bleibt');
        fail();   // auch yt-dlp-Stream scheitert → SoundCloud
        await wait(() => patches().some(p => p.track && p.track.encoded === 'SC1'));
        assert.strictEqual(asked.length, 1, 'yt-dlp nicht nochmal');
        await M.H.musik(it, {}, null, 'verlassen');
    } finally { M.stop(); L.close(); }
});

test('Musik: yt-dlp-Aufruf (Attrappe statt echtem Programm)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-ytd-')), bin = path.join(dir, 'yt-dlp');
    fs.writeFileSync(bin, '#!/bin/sh\nfor a; do last=$a; done\necho "https://rr.example/a?$last"\necho "Titel"\necho "Kanal"\necho "212.5"\n', { mode: 0o755 });
    const r = music.ytdlpResolver(bin, '');
    const y = await r('https://www.youtube.com/watch?v=abc');
    assert.strictEqual(y.title, 'Titel'); assert.strictEqual(y.length, 212500); assert.match(y.url, /^https:\/\/rr\.example\/a\?https:\/\/www\.youtube\.com/);
    await assert.rejects(r('https://evil.example/x'), /Keine YouTube-Adresse/);
    await assert.rejects(r('--exec=rm'), /Keine YouTube-Adresse/);
    assert.strictEqual(music.ytdlpResolver('', ''), null);
});
