'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');

test('Club-Abgleich – verbinden nur mit Recht, alte Events nicht nachposten, neue Events, Erinnerung einmal, Absage, keine @everyone', async () => {
    const dir = path.join(__dirname, '..');
    const { Store } = require(path.join(dir, 'store.js'));
    const { create } = require(path.join(dir, 'clubs.js'));
    const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'nx-club-')));
    const posts = [], urls = [];
    const now0 = Date.now(), S = Math.floor(now0 / 1000);
    let feed = { club: { slug: 'lofi', name: 'Lofi @everyone Club', url: 'https://example.test/nexus.php?club=lofi' }, events: [{ id: 1, title: 'Altes Treffen', descr: '', starts: S + 86400, ends: S + 90000, place: 'Café', status: 'active', capacity: 0, going: 3 }] };
    const getJson = async url => { urls.push(url); if (/club=kaputt|discord=kaputt/.test(url)) throw new Error('HTTP 404'); return JSON.parse(JSON.stringify(feed)); };
    const rest = async (method, route, body) => { posts.push({ route, body }); return { id: 'm' + posts.length }; };
    const C = create({ rest, log: () => {}, store, nexus: 'https://example.test/', getJson });
    const G = '200', MG = String(1n << 5n);
    const it = perms => ({ guild_id: G, channel_id: 'c1', member: { user: { id: 'u1' }, permissions: perms } });

    assert.match((await C.H.club(it('0'), { club: 'lofi', kanal: 'ev' }, null, 'verbinden')).content, /Keine Berechtigung/);
    assert.match((await C.H.club(it(MG), { club: 'Kaputt!', kanal: 'ev' }, null, 'verbinden')).content, /nicht gefunden|Ungültig/);
    assert.match((await C.H.club(it(MG), { club: '<x>', kanal: 'ev' }, null, 'verbinden')).content, /Ungültig/);
    // Adresse statt Kürzel wird verstanden
    const r = await C.H.club(it(MG), { club: 'https://ghostnode-labs.dev/nexus.php?club=lofi', kanal: 'ev', rolle: 'r1', erinnerung: 60 }, null, 'verbinden');
    assert.match(r.content, /✅/); assert.strictEqual(r.flags, 64);
    assert.ok(urls.every(u => u.startsWith('https://example.test/nexusclubs.php?discord=')), 'nur der öffentliche Discord-Feed');
    assert.strictEqual(posts.length, 0, 'vorhandene Events werden nicht nachgepostet');
    const c = store.get(G).clubs.lofi;
    assert.deepStrictEqual([c.channel, c.role, c.remind, c.synced], ['ev', 'r1', 60, true]);

    // neues Event → ein Beitrag mit Rollen-Erwähnung, Text entschärft
    feed.events.push({ id: 2, title: 'Neu @here <@123>', descr: 'Bring Freunde mit', starts: S + 7200, ends: S + 10800, place: 'Lofi Café', status: 'active', capacity: 20, going: 1 });
    assert.strictEqual(await C.tick(now0 + 1000), 0, 'erst nach dem Abfrage-Abstand');
    assert.strictEqual(await C.tick(now0 + C.POLL_MS + 1000), 1);
    let p = posts.pop();
    assert.strictEqual(p.route, '/channels/ev/messages');
    assert.match(p.body.embeds[0].title, /^📅 Neues Event: Neu @​here \[Erwähnung\]/);
    assert.strictEqual(p.body.content, '<@&r1>'); assert.deepStrictEqual(p.body.allowed_mentions, { roles: ['r1'] });
    assert.match(p.body.embeds[0].footer.text, /@​everyone/);
    assert.ok(p.body.embeds[0].fields.some(f => f.value === '1 / 20'));
    // gleicher Stand → nichts Neues
    assert.strictEqual(await C.tick(now0 + 2 * C.POLL_MS + 2000), 0);
    // Erinnerung 60 min vorher, nur einmal
    const t1 = (S + 7200 - 3000) * 1000;
    assert.strictEqual(await C.tick(t1), 1); assert.match(posts.pop().body.embeds[0].title, /^⏰/);
    assert.strictEqual(await C.tick(t1 + C.POLL_MS), 0, 'Erinnerung nicht doppelt');
    // Absage
    feed.events[0].status = 'cancelled';
    assert.strictEqual(await C.tick(t1 + 2 * C.POLL_MS), 1);
    p = posts.pop(); assert.match(p.body.embeds[0].title, /^❌ Abgesagt: Altes Treffen/); assert.deepStrictEqual(p.body.allowed_mentions, { parse: [] }, 'Absage ohne Erwähnung');
    // neues Event, das schon im Erinnerungsfenster liegt → nur ein Beitrag
    feed.events.push({ id: 3, title: 'Spontan', starts: Math.floor(t1 / 1000) + 3 * C.POLL_MS / 1000 + 600, ends: Math.floor(t1 / 1000) + 99999, status: 'active', going: 0 });
    assert.strictEqual(await C.tick(t1 + 3 * C.POLL_MS), 1); assert.match(posts.pop().body.embeds[0].title, /^⏰ Gleich geht’s los: Spontan/);
    assert.strictEqual(await C.tick(t1 + 4 * C.POLL_MS), 0);
    // Fehler beim Abruf wird gemerkt, Liste zeigt ihn
    const oldFeed = feed; feed = { error: 'weg' };
    await C.tick(t1 + 5 * C.POLL_MS);
    assert.match((await C.H.club(it(MG), {}, null, 'liste')).content, /Lofi .*`lofi`.*<#ev>.*60 min.*⚠️ Antwort ohne Events/);
    feed = oldFeed;
    // Grenze je Server, trennen
    for (const k of ['a1', 'a2', 'a3', 'a4']) await C.H.club(it(MG), { club: k, kanal: 'ev' }, null, 'verbinden');
    assert.match((await C.H.club(it(MG), { club: 'a5', kanal: 'ev' }, null, 'verbinden')).content, /Höchstens 5/);
    assert.match((await C.H.club(it(MG), { club: 'lofi' }, null, 'trennen')).content, /getrennt/);
    assert.ok(!store.get(G).clubs.lofi);
    assert.match((await C.H.club(it(MG), { club: 'lofi' }, null, 'trennen')).content, /nicht verbunden/);
    // kurze Erinnerung: kurz vor dem Start wird jede Minute abgefragt
    await C.H.club(it(MG), { club: 'kurz', kanal: 'k5', erinnerung: 5 }, null, 'verbinden');
    const t2 = t1 + 20 * C.POLL_MS, S2 = Math.floor(t2 / 1000);
    feed.events.push({ id: 9, title: 'Kurz', starts: S2 + 900, ends: S2 + 5000, status: 'active', going: 0 });
    await C.tick(t2); posts.length = 0;
    const k = store.get(G).clubs.kurz; assert.strictEqual(k.soon, S2 + 900);
    assert.strictEqual(await C.tick(t2 + 61000 + 240000), 0, 'noch nicht im 5-min-Fenster');
    assert.strictEqual(await C.tick(t2 + 600000 + 61000), 1, 'Erinnerung pünktlich');
    assert.ok(posts.some(x => x.route === '/channels/k5/messages' && /^⏰ Gleich geht’s los: Kurz/.test(x.body.embeds[0].title)));
    store.flushAll();
});

test('Club-Abgleich ist im Bot eingehängt (Befehl /club, kurze Antwort)', () => {
    process.env.BOT_NO_AUTOSTART = '1';
    const bot = require(path.join(__dirname, '..', 'bot.js'));
    const cmd = bot.COMMANDS.find(c => c.name === 'club');
    assert.ok(cmd && cmd.options.map(o => o.name).join() === 'verbinden,trennen,liste,jetzt');
    assert.strictEqual(typeof bot.F.H.club, 'function'); assert.ok(bot.F.EPH.has('club'));
    assert.strictEqual(new Set(bot.COMMANDS.map(c => c.name)).size, bot.COMMANDS.length, 'keine doppelten Befehle');
});
