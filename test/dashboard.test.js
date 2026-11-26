'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { Store } = require('../store');
const { createDashboard } = require('../dashboard');

test('Dashboard – Discord-Login (state), nur verwaltbare Server mit Bot, CSRF, Eingaben gegen Kanäle/Rollen geprüft', async () => {
    process.env.DISCORD_CLIENT_SECRET = 'test-secret';
    process.env.DASHBOARD_URL = 'https://discord.example';
    const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'gn-dash-')));
    const G = '111111111111111111', OTHER = '222222222222222222', NOBOT = '333333333333333333';
    store.get(G).meta.name = 'GhostNode'; store.get(OTHER).meta.name = 'Fremd';
    const rest = async (m, route) => {
        if (route.endsWith('/channels')) return [{ id: '500000000000000001', name: 'willkommen', type: 0, position: 1 }, { id: '500000000000000002', name: 'Sprache', type: 2, position: 2 }];
        if (route.endsWith('/roles')) return [{ id: G, name: '@everyone', position: 0 }, { id: '600000000000000001', name: 'Mitglied', color: 0x38d5e6, position: 2 }, { id: '600000000000000002', name: 'Bot', managed: true, position: 3 }];
        return {};
    };
    let tokenBody = '';
    const oauthFetch = async (u, o) => {
        if (u.endsWith('/oauth2/token')) { tokenBody = String(o.body); return { json: async () => ({ access_token: 'at' }) }; }
        if (u.endsWith('/users/@me')) return { json: async () => ({ id: '700000000000000001', username: 'luna', global_name: 'Luna' }) };
        if (u.endsWith('/users/@me/guilds')) return { json: async () => [
            { id: G, name: 'GhostNode', permissions: String(1n << 5n) },
            { id: OTHER, name: 'Fremd', permissions: '0' },
            { id: NOBOT, name: 'Ohne Bot', permissions: '8' }] };
        throw new Error('unerwartet ' + u);
    };
    const dash = createDashboard({ CFG: { app: '123', api: 'https://discord.com/api/v10' }, rest, store, log: () => {}, botGuilds: () => [G, OTHER], oauthFetch });
    const srv = http.createServer((q, s) => dash.handle(q, s)); await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const B = 'http://127.0.0.1:' + srv.address().port;
    const go = (p, o = {}) => fetch(B + p, Object.assign({ redirect: 'manual' }, o));
    try {
        // Startseite und Sicherheits-Header
        let r = await go('/'); assert.strictEqual(r.status, 200); assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
        assert.strictEqual((await go('/api/me')).status, 401);
        // Login: Weiterleitung mit state; falscher state abgelehnt
        r = await go('/login'); assert.strictEqual(r.status, 302);
        const loc = new URL(r.headers.get('location')), st = loc.searchParams.get('state');
        assert.ok(loc.host === 'discord.com' && loc.searchParams.get('scope') === 'identify guilds' && loc.searchParams.get('redirect_uri') === 'https://discord.example/callback' && st);
        assert.strictEqual((await go('/callback?code=c&state=falsch', { headers: { cookie: 'gnst=falsch' } })).status, 400);
        assert.strictEqual((await go('/callback?code=c&state=' + st, { headers: { cookie: 'gnst=anderer' } })).status, 400, 'state muss zum Cookie passen');
        r = await go('/login'); const st2 = new URL(r.headers.get('location')).searchParams.get('state');
        r = await go('/callback?code=abc&state=' + st2, { headers: { cookie: 'gnst=' + st2 } });
        assert.strictEqual(r.status, 302);
        assert.match(tokenBody, /client_secret=test-secret/); assert.match(tokenBody, /code=abc/);
        const sc = r.headers.get('set-cookie'); assert.match(sc, /gnsid=[0-9a-f]{64}; Path=\/; HttpOnly; Secure; SameSite=Lax/);
        const cookie = 'gnsid=' + /gnsid=([0-9a-f]+)/.exec(sc)[1];
        // nur verwaltbare Server; Bot-Status
        const me = await (await go('/api/me', { headers: { cookie } })).json();
        assert.deepStrictEqual(me.guilds.map(g => [g.id, g.bot]), [[G, true], [NOBOT, false]]);
        assert.strictEqual((await go('/api/guild/' + OTHER, { headers: { cookie } })).status, 403, 'ohne Verwalten-Recht');
        assert.strictEqual((await go('/api/guild/' + NOBOT, { headers: { cookie } })).status, 403, 'ohne Bot');
        // Übersicht: nur Textkanäle, keine @everyone/verwalteten Rollen
        const g = await (await go('/api/guild/' + G, { headers: { cookie } })).json();
        assert.deepStrictEqual(g.channels.map(c => c.name), ['willkommen']); assert.deepStrictEqual(g.roles.map(x => x.name), ['Mitglied']);
        // Schreiben ohne CSRF → abgelehnt
        const post = (p, b, csrf = me.csrf) => go('/api/guild/' + G + p, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json', 'X-CSRF': csrf }, body: JSON.stringify(b) });
        assert.strictEqual((await post('/cfg', { levels: false }, 'falsch')).status, 403);
        // gültige Einstellungen
        r = await post('/cfg', { welcome_channel: '500000000000000001', welcome_text: 'Hi {user}', autoroles: ['600000000000000001'], level_rewards: { 5: '600000000000000001' }, xp_min: 10, xp_max: 5, automod: { invites: true, words: 'Doof, MIST', timeout_min: 10 } });
        assert.strictEqual(r.status, 200);
        const c = store.get(G).cfg;
        assert.ok(c.welcome_channel === '500000000000000001' && c.autoroles[0] === '600000000000000001' && c.level_rewards['5'] && c.xp_max === 10 && c.automod.invites && c.automod.words.join() === 'doof,mist');
        // fremde Kanäle/Rollen, verwaltete Rolle, ungültige Zahlen → abgelehnt
        for (const bad of [{ welcome_channel: '999999999999999999' }, { welcome_channel: '500000000000000002' }, { autoroles: ['600000000000000002'] }, { level_rewards: { 0: '600000000000000001' } }, { xp_cooldown: -1 }, { automod: { timeout_min: 99999 } }]) {
            r = await post('/cfg', bad); assert.strictEqual(r.status, 400, JSON.stringify(bad));
        }
        // eigene Befehle, Verwarnungen, XP
        r = await post('/cmd', { name: '!Regeln', text: 'Sei nett' }); assert.deepStrictEqual((await r.json()).cmds, { regeln: 'Sei nett' });
        assert.strictEqual((await post('/cmd', { name: 'a b', text: 'x' })).status, 400);
        store.get(G).xp['700000000000000009'] = { xp: 500, msgs: 3 };
        assert.strictEqual((await post('/xp', { all: true })).status, 400, 'ohne Bestätigung');
        assert.strictEqual((await post('/xp', { user: '700000000000000009' })).status, 200); assert.ok(!store.get(G).xp['700000000000000009']);
        // Abmelden
        await go('/logout', { headers: { cookie } });
        assert.strictEqual((await go('/api/me', { headers: { cookie } })).status, 401);
    } finally { srv.close(); delete process.env.DISCORD_CLIENT_SECRET; delete process.env.DASHBOARD_URL; }
});
