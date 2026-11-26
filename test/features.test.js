'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');

test('4.4: GhostNode-Bot – Levels, Belohnungen, AutoMod, Willkommen/Autorollen, Moderation, Rollen-Knöpfe, Umfrage, Giveaway, !Befehle, Geburtstage, Tickets', async () => {
    const dir = path.join(__dirname, '..');
    const { Store } = require(path.join(dir, 'store.js'));
    const { create, levelOf, lvlNeed } = require(path.join(dir, 'features.js'));
    const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'nx-bot-')));
    const calls = [];
    const rest = async (method, route, body, tries, extra) => { calls.push({ method, route, body, extra });
        if (route === '/users/@me/channels') return { id: 'dm1' };
        if (/\/threads$/.test(route)) return { id: 'th1' };
        if (/\/messages\?limit/.test(route)) return [1, 2, 3].map(i => ({ id: 'm' + i, author: { id: i === 2 ? 'u2' : 'u1' }, timestamp: new Date().toISOString() }));
        if (method === 'POST' && /\/messages$/.test(route)) return { id: 'msg' + calls.length };
        return {}; };
    const F = create({ rest, log: () => {}, store });
    const G = '100', ADMIN = String(1n << 3n), NONE = '0';
    const it = (data, perms = ADMIN, uid = 'mod1', extra = {}) => Object.assign({ guild_id: G, channel_id: 'c1', member: { user: { id: uid, username: 'Mod' }, permissions: perms, roles: [] } }, extra, data);
    const last = re => [...calls].reverse().find(c => re.test(c.route));
    // Level-Formel
    assert.strictEqual(lvlNeed(0), 100); assert.deepStrictEqual(levelOf(100), { level: 1, into: 0, need: 155 });
    // Einstellungen: nur mit Recht
    assert.match((await F.H.einstellungen(it({}, NONE), { kanal: 'c9' }, null, 'willkommen')).content, /Keine Berechtigung/);
    await F.H.einstellungen(it({}), { kanal: 'welcome' }, null, 'willkommen');
    await F.H.einstellungen(it({}), { rolle: 'r-new' }, null, 'autorolle');
    await F.H.einstellungen(it({}), { level: 1, rolle: 'r-lvl1' }, null, 'belohnung');
    await F.H.einstellungen(it({}), { kanal: 'modlog' }, null, 'modlog');
    await F.H.einstellungen(it({}), { einladungen: true, woerter: 'doof, mist', timeout: 5 }, null, 'automod');
    const cfg = store.get(G).cfg;
    assert.ok(cfg.welcome_channel === 'welcome' && cfg.autoroles[0] === 'r-new' && cfg.level_rewards['1'] === 'r-lvl1' && cfg.automod.invites && cfg.automod.words.length === 2);
    assert.match((await F.H.einstellungen(it({}), {}, null, 'anzeigen')).content, /Begrüßung.*welcome/);
    // Willkommen + Autorolle
    F.onGuild({ id: G, name: 'GhostNode', member_count: 41 });
    calls.length = 0;
    await F.onMemberAdd({ guild_id: G, user: { id: 'u1', username: 'Luna' } });
    assert.ok(calls.some(c => c.method === 'PUT' && c.route === '/guilds/100/members/u1/roles/r-new'), 'Autorolle');
    assert.match(last(/channels\/welcome\/messages/).body.content, /<@u1>.*GhostNode.*42/);
    // Levels: erste Nachricht → XP, Level-Up + Belohnung ab 100 XP
    calls.length = 0;
    const msg = (content, uid = 'u1', extra = {}) => Object.assign({ id: 'x' + Math.random(), guild_id: G, channel_id: 'c1', author: { id: uid, username: 'Luna' }, member: { roles: [] }, content }, extra);
    store.get(G).xp.u1 = { xp: 95, last: 0, msgs: 0 };
    await F.onMessage(msg('hallo zusammen'));
    assert.ok(store.get(G).xp.u1.xp >= 110, 'XP vergeben');
    assert.match(last(/channels\/c1\/messages$/).body.content, /Level 1/);
    assert.ok(calls.some(c => c.route === '/guilds/100/members/u1/roles/r-lvl1'), 'Level-Belohnung');
    const before = store.get(G).xp.u1.xp; await F.onMessage(msg('nochmal')); assert.strictEqual(store.get(G).xp.u1.xp, before, 'Cooldown');
    // AutoMod: Einladung + verbotenes Wort → löschen, Timeout, Modlog; „doofi“ ist kein Treffer
    calls.length = 0;
    await F.onMessage(msg('komm auf discord.gg/abc123'));
    assert.ok(calls.some(c => c.method === 'DELETE' && /\/messages\//.test(c.route)) && calls.some(c => c.method === 'PATCH' && c.body.communication_disabled_until) && last(/channels\/modlog/), 'AutoMod Einladung');
    calls.length = 0; await F.onMessage(msg('das ist DOOF')); assert.ok(calls.some(c => c.method === 'DELETE'), 'Wortfilter (Groß/klein egal)');
    calls.length = 0; await F.onMessage(msg('doofi ist ein name', 'u3')); assert.ok(!calls.some(c => c.method === 'DELETE'), 'nur ganze Wörter');
    // Moderation
    assert.match((await F.H.warn(it({}, NONE), { nutzer: 'u1', grund: 'x' })).content, /Keine Berechtigung/);
    calls.length = 0;
    const w = await F.H.warn(it({}), { nutzer: 'u1', grund: 'Spam im Chat' });
    assert.ok(/1\. Verwarnung/.test(w.content) && calls.some(c => c.route === '/users/@me/channels') && last(/channels\/modlog/));
    assert.match((await F.H.verwarnungen(it({}), { nutzer: 'u1' })).content, /Spam im Chat/);
    calls.length = 0; await F.H.timeout(it({}), { nutzer: 'u1', minuten: 10, grund: 'Ruhe' });
    const to = last(/members\/u1$/); assert.ok(to.method === 'PATCH' && Date.parse(to.body.communication_disabled_until) > Date.now() + 9 * 60000 && /Ruhe/.test(decodeURIComponent(to.extra['X-Audit-Log-Reason'])));
    calls.length = 0; await F.H.ban(it({}), { nutzer: 'u9', tage: 1 }); assert.strictEqual(last(/bans\/u9/).body.delete_message_seconds, 86400);
    assert.match((await F.H.unban(it({}), { id: '../x' })).content, /Ungültige/);
    calls.length = 0; const del = await F.H.loeschen(it({}), { anzahl: 5, nutzer: 'u1' }); assert.ok(/2 Nachrichten/.test(del.content) && last(/bulk-delete/).body.messages.join() === 'm1,m3');
    // Rollen-Knöpfe
    await F.H.rollenmenue(it({}), { titel: 'Pronomen', rolle1: 'r-a', rolle2: 'r-b' }, { roles: { 'r-a': { name: 'sie/ihr' }, 'r-b': { name: 'er/ihm' } } });
    const menu = last(/channels\/c1\/messages$/).body; assert.deepStrictEqual(menu.components[0].components.map(b => b.label), ['sie/ihr', 'er/ihm']);
    calls.length = 0; let r = await F.onComponent(it({ data: { custom_id: 'gn:role:r-a' } }, NONE, 'u5'));
    assert.ok(/bekommen/.test(r.data.content) && calls[0].method === 'PUT');
    r = await F.onComponent(it({ data: { custom_id: 'gn:role:r-a' } }, NONE, 'u5', { member: { user: { id: 'u5' }, roles: ['r-a'] } })); assert.ok(/entfernt/.test(r.data.content));
    // Umfrage
    await F.H.umfrage(it({}), { frage: 'Pizza?', optionen: 'Ja; Nein; Vielleicht' });
    const pid = Object.keys(store.get(G).polls)[0];
    r = await F.onComponent(it({ data: { custom_id: 'gn:poll:2' }, message: { id: pid } }, NONE, 'u5'));
    assert.ok(r.type === 7 && /1 Stimme/.test(r.data.embeds[0].footer.text) && /Vielleicht\*\*\n▰/.test(r.data.embeds[0].description));
    // Giveaway: teilnehmen, Ablauf → Gewinner
    await F.H.giveaway(it({}), { preis: 'Nitro', minuten: 1, gewinner: 1 });
    const gid = Object.keys(store.get(G).giveaways)[0];
    await F.onComponent(it({ data: { custom_id: 'gn:gw' }, message: { id: gid } }, NONE, 'u7'));
    calls.length = 0; await F.tick(Date.now() + 120000);
    assert.match(last(/channels\/c1\/messages$/).body.content, /Glückwunsch <@u7>/);
    // eigene !Befehle
    await F.H.befehl(it({}), { name: 'regeln', antwort: 'Sei nett, {user}!' }, null, 'hinzufuegen');
    calls.length = 0; await F.onMessage(msg('!regeln bitte', 'u8'));
    assert.strictEqual(last(/channels\/c1\/messages$/).body.content, 'Sei nett, <@u8>!');
    // Geburtstag
    assert.match((await F.H.geburtstag(it({}, NONE, 'u8'), { datum: '32.13' })).content, /TT\.MM/);
    await F.H.geburtstag(it({}, NONE, 'u8'), { datum: '5.3' }); assert.strictEqual(store.get(G).bdays.u8, '05.03');
    cfg.birthday_channel = 'bday'; calls.length = 0;
    await F.tick(new Date(2027, 2, 5, 10, 0).getTime()); assert.match(last(/channels\/bday/).body.content, /<@u8>/);
    calls.length = 0; await F.tick(new Date(2027, 2, 5, 11, 0).getTime()); assert.ok(!last(/channels\/bday/), 'nur einmal am Tag');
    // Ticket
    calls.length = 0; r = await F.onComponent(it({ data: { custom_id: 'gn:ticket' } }, NONE, 'u5'));
    assert.ok(/th1/.test(r.data.content) && calls.some(c => c.route === '/channels/th1/thread-members/u5') && last(/\/threads$/).body.type === 12);
    r = await F.onComponent(it({ data: { custom_id: 'gn:ticket' } }, NONE, 'u5')); assert.match(r.data.content, /schon ein offenes/);
    r = await F.onComponent(it({ data: { custom_id: 'gn:ticket:close' }, channel_id: 'th1' }, NONE, 'u6')); assert.match(r.data.content, /Nur das Team/);
    r = await F.onComponent(it({ data: { custom_id: 'gn:ticket:close' }, channel_id: 'th1' }, NONE, 'u5')); assert.match(r.data.content, /geschlossen/);
    store.flushAll();
});
