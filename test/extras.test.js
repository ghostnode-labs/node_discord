'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { Store } = require('../store');
const extras = require('../extras');

const mk = (routes = {}) => {
    const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'gn-x-')));
    const calls = [];
    const rest = async (m, route, body) => { calls.push([m, route, body]); for (const [re, f] of Object.entries(routes)) if (new RegExp(re).test(m + ' ' + route)) return f(body, route); return m === 'POST' ? { id: 'M' + calls.length } : {}; };
    return { X: extras.create({ rest, log: () => {}, store, botId: () => '42' }), store, calls };
};
const it = (uid, extra = {}) => Object.assign({ guild_id: 'G', channel_id: 'C', member: { user: { id: uid, username: 'u' + uid }, roles: [], permissions: '0' } }, extra);

test('Extras: Zeitangaben', () => {
    assert.strictEqual(extras.parseIn('10m'), 600000); assert.strictEqual(extras.parseIn('1d12h'), 129600000);
    assert.strictEqual(extras.parseIn('90'), 5400000); assert.strictEqual(extras.parseIn('2 std'), 7200000);
    assert.strictEqual(extras.parseIn('morgen'), -1); assert.strictEqual(extras.parseIn('5x'), -1);
});

test('Extras: Erinnerung anlegen, Liste, löschen, fällig → Nachricht mit Erwähnung', async () => {
    const { X, store, calls } = mk();
    await assert.rejects(X.H.erinnerung(it('7'), { in: 'bald', text: 'x' }, null, 'neu'), /nicht verstanden/);
    await assert.rejects(X.H.erinnerung(it('7'), { in: '5s', text: 'x' }, null, 'neu'), /30 Sekunden/);
    let r = await X.H.erinnerung(it('7'), { in: '10m', text: 'Pizza holen' }, null, 'neu');
    assert.match(r.content, /<t:\d+:R>/);
    r = await X.H.erinnerung(it('7'), {}, null, 'liste'); assert.match(r.embeds[0].description, /Pizza holen/);
    const id = r.components[0].components[0].custom_id;
    assert.match((await X.onComponent({ guild_id: 'G', data: { custom_id: id }, member: { user: { id: '8' } } })).data.content, /nicht deine/);
    assert.match((await X.onComponent({ guild_id: 'G', data: { custom_id: id }, member: { user: { id: '7' } } })).data.content, /gelöscht/);
    await X.H.erinnerung(it('7'), { in: '1m', text: 'Tee' }, null, 'neu');
    store.get('G').reminders[0].at = Date.now() - 1; store.save('G');
    await X.tick();
    const msg = calls.find(c => c[0] === 'POST' && c[1] === '/channels/C/messages');
    assert.match(msg[2].content, /<@7> Erinnerung: Tee/); assert.deepStrictEqual(msg[2].allowed_mentions, { users: ['7'] });
    assert.strictEqual(store.get('G').reminders.length, 0);
});

test('Extras: Vorschlag – Stimmen umschalten, nur Team kann annehmen', async () => {
    const { X, store } = mk();
    store.get('G').extras = { suggest: '555555555555555555' }; store.save('G');
    const r = await X.H.vorschlag(it('7'), { text: 'Mehr Musik!' });
    assert.match(r.content, /<#555555555555555555>/);
    const msgId = Object.keys(store.get('G').sugg)[0];
    const click = (uid, act, perm = '0') => X.onComponent({ guild_id: 'G', message: { id: msgId }, data: { custom_id: 'gx:sg:' + act }, member: { user: { id: uid }, permissions: perm } });
    await click('1', 'up'); await click('2', 'up'); let x = await click('2', 'down');
    assert.match(x.data.embeds[0].description, /👍 \*\*1\*\* · 👎 \*\*1\*\*/);
    x = await click('1', 'up'); assert.match(x.data.embeds[0].description, /👍 \*\*0\*\*/, 'nochmal klicken nimmt die Stimme zurück');
    assert.match((await click('3', 'ok')).data.content, /Nur das Team/);
    x = await click('3', 'ok', String(1n << 5n));
    assert.match(x.data.embeds[0].title, /Angenommen/); assert.ok(x.data.components[0].components[0].disabled);
    assert.match((await click('4', 'up')).data.content, /geschlossen/);
});

test('Extras: eigener Sprachkanal entsteht beim Betreten und wird leer gelöscht', async () => {
    const { X, store, calls } = mk({ 'GET /channels/111111111111111111$': () => ({ id: '111111111111111111', parent_id: 'CAT', bitrate: 64000 }), 'POST /guilds/G/channels': () => ({ id: 'TEMP1' }) });
    X.saveSettings('G', { tempHub: '111111111111111111', tempName: '🔊 {name}s Raum', tempLimit: 5 });
    X.onGuild({ id: 'G', voice_states: [] });
    await X.onVoiceState({ guild_id: 'G', user_id: '7', channel_id: '111111111111111111', member: { nick: 'Luna', user: { id: '7' } } });
    const made = calls.find(c => c[0] === 'POST' && c[1] === '/guilds/G/channels')[2];
    assert.strictEqual(made.name, '🔊 Lunas Raum'); assert.strictEqual(made.parent_id, 'CAT'); assert.strictEqual(made.user_limit, 5);
    assert.strictEqual(made.permission_overwrites[0].id, '7');
    assert.deepStrictEqual(calls.find(c => c[0] === 'PATCH')[2], { channel_id: 'TEMP1' }, 'Mitglied wird verschoben');
    await X.onVoiceState({ guild_id: 'G', user_id: '7', channel_id: 'TEMP1' });
    assert.ok(!calls.some(c => c[0] === 'DELETE'));
    await X.onVoiceState({ guild_id: 'G', user_id: '7', channel_id: null });
    assert.ok(calls.some(c => c[0] === 'DELETE' && c[1] === '/channels/TEMP1'), 'leer → gelöscht');
    assert.deepStrictEqual(store.get('G').temp, {});
});

test('Extras: Starboard ab Mindestzahl, Bot zählt sich nicht mit', async () => {
    let count = 2;
    const { X, store, calls } = mk({ 'GET /channels/C/messages/M1': () => ({ id: 'M1', channel_id: 'C', content: 'Bestes Foto', timestamp: '2026-11-27T10:00:00Z', author: { id: '9', username: 'nine' },
        attachments: [{ url: 'https://cdn/x.png', filename: 'x.png', content_type: 'image/png' }], reactions: [{ emoji: { name: '⭐' }, count, me: false }] }), 'POST /channels/999999999999999999/messages': () => ({ id: 'S1' }) });
    X.saveSettings('G', { star: '999999999999999999', starMin: 3 });
    const react = () => X.onReaction({ guild_id: 'G', channel_id: 'C', message_id: 'M1', emoji: { name: '⭐' } }, true);
    await react(); assert.ok(!calls.some(c => c[1] === '/channels/999999999999999999/messages'), '2 < 3');
    count = 3; await react();
    const p = calls.find(c => c[1] === '/channels/999999999999999999/messages')[2];
    assert.match(p.content, /⭐ \*\*3\*\*/); assert.strictEqual(p.embeds[0].image.url, 'https://cdn/x.png');
    assert.strictEqual(store.get('G').stars.M1, 'S1');
    count = 4; await react();
    assert.ok(calls.some(c => c[0] === 'PATCH' && c[1] === '/channels/999999999999999999/messages/S1'), 'zweites Mal nur aktualisiert');
    await X.onReaction({ guild_id: 'G', channel_id: 'C', message_id: 'M1', emoji: { name: '😀' } }, true);
});

test('Extras: Spaß und Info', async () => {
    const { X } = mk({ 'GET /guilds/G\\?with_counts': () => ({ name: 'GhostNode', owner_id: '1', approximate_member_count: 42, approximate_presence_count: 7, roles: [{}, {}], premium_tier: 1 }),
        'GET /guilds/G/channels': () => [{ type: 0 }, { type: 0 }, { type: 2 }] });
    assert.match((await X.H.auswahl(it('7'), { optionen: 'Pizza, Burger' })).embeds[0].description, /\*\*(Pizza|Burger)\*\*/);
    await assert.rejects(X.H.auswahl(it('7'), { optionen: 'nur eins' }), /zwei/);
    assert.match((await X.H.zufall(it('7'), { von: 5, bis: 5 })).content, /\*\*5\*\*/);
    assert.match((await X.H['8ball'](it('7'), { frage: 'Klappt es?' })).embeds[0].description, /🎱/);
    const s = await X.H.info(it('7'), {}, null, 'server');
    assert.strictEqual(s.embeds[0].title, '🛰 GhostNode'); assert.ok(s.embeds[0].fields.some(f => /42 \(7 online\)/.test(f.value) && f.name === 'Mitglieder'));
    assert.ok(s.embeds[0].fields.some(f => f.value === '2 Text · 1 Sprache'));
    const u = await X.H.info(it('7', { member: { user: { id: '7', username: 'luna', avatar: null }, roles: ['R'], joined_at: '2025-01-01T00:00:00Z', permissions: '0' } }), {}, null, 'nutzer');
    assert.ok(u.embeds[0].fields.some(f => f.value.includes('<@&R>')));
});
