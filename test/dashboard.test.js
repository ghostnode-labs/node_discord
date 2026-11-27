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
        r = await go('/callback?code=abc&state=' + st2, { headers: { cookie: 'gnst=' + st2, 'x-forwarded-proto': 'https' } });
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

test('Dashboard – Anmeldung über das GhostNode-Dashboard (signiertes Ticket, einmalig, Rechte per Bot-Token, Cookies ohne Secure über http)', async () => {
    const crypto = require('crypto');
    const SECRET = 'x'.repeat(48);
    process.env.BOT_SSO_SECRET = SECRET; delete process.env.DISCORD_CLIENT_SECRET; delete process.env.DASHBOARD_URL;
    const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'gn-sso-')));
    const G = '111111111111111111', G2 = '222222222222222222', G3 = '333333333333333333', U = '700000000000000001';
    const MOD = '600000000000000001';
    const guilds = {
        [G]: { id: G, name: 'GhostNode', owner_id: '1', roles: [{ id: G, permissions: '0' }, { id: MOD, permissions: String(1n << 5n) }] },   // Rolle mit „Server verwalten“
        [G2]: { id: G2, name: 'Fremd', owner_id: '1', roles: [{ id: G2, permissions: '0' }] },                                               // Mitglied ohne Rechte
        [G3]: { id: G3, name: 'Ohne Mitglied', owner_id: '1', roles: [{ id: G3, permissions: '8' }] },
    };
    const rest = async (m, route) => {
        let x = /^\/guilds\/(\d+)$/.exec(route); if (x) return guilds[x[1]];
        x = /^\/guilds\/(\d+)\/members\/(\d+)$/.exec(route);
        if (x) { if (x[1] === G) return { roles: [MOD] }; if (x[1] === G2) return { roles: [] }; throw new Error('Discord GET: HTTP 404'); }
        if (route.endsWith('/channels')) return []; if (route.endsWith('/roles')) return [];
        return {};
    };
    const dash = createDashboard({ CFG: { app: '123', api: 'https://discord.com/api/v10', nexus: 'https://site.example' }, rest, store, log: () => {}, botGuilds: () => [G, G2, G3] });
    const srv = http.createServer((q, s) => dash.handle(q, s)); await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const B = 'http://127.0.0.1:' + srv.address().port;
    const go = (p, o = {}) => fetch(B + p, Object.assign({ redirect: 'manual' }, o));
    const mk = (o, key = SECRET) => { const p = Buffer.from(JSON.stringify(Object.assign({ v: 1, d: U, n: 'Luna', a: null, e: Math.floor(Date.now() / 1000) + 60, j: crypto.randomBytes(16).toString('hex') }, o))).toString('base64url');
        return p + '.' + crypto.createHmac('sha256', key).update(p).digest('base64url'); };
    try {
        const un = await (await go('/api/me')).json(); assert.ok(un.login === true && un.via === 'ghostnode');
        let r = await go('/login'); assert.strictEqual(r.status, 302); assert.strictEqual(r.headers.get('location'), 'https://site.example/botdash.php?go=1', 'Login führt zur Webseite');
        assert.strictEqual((await go('/sso?t=' + mk({}, 'y'.repeat(48)))).status, 400, 'falscher Schlüssel');
        assert.strictEqual((await go('/sso?t=' + mk({ e: Math.floor(Date.now() / 1000) - 1 }))).status, 400, 'abgelaufen');
        assert.strictEqual((await go('/sso?t=' + mk({ e: Math.floor(Date.now() / 1000) + 3600 }))).status, 400, 'zu lange gültig');
        assert.strictEqual((await go('/sso?t=' + mk({ d: 'abc' }))).status, 400, 'keine Discord-ID');
        assert.strictEqual((await go('/sso?t=kaputt')).status, 400);
        const t = mk({});
        r = await go('/sso?t=' + t); assert.strictEqual(r.status, 302);
        const sc = r.headers.get('set-cookie'); assert.match(sc, /gnsid=[0-9a-f]{64}; Path=\/; HttpOnly; SameSite=Lax/); assert.doesNotMatch(sc, /Secure/, 'über http ohne Secure');
        assert.strictEqual((await go('/sso?t=' + t)).status, 400, 'Ticket nur einmal');
        const cookie = 'gnsid=' + /gnsid=([0-9a-f]+)/.exec(sc)[1];
        const me = await (await go('/api/me', { headers: { cookie } })).json();
        assert.strictEqual(me.user.id, U); assert.deepStrictEqual(me.guilds.map(g => g.id), [G], 'nur Server mit „Server verwalten“');
        assert.strictEqual((await go('/api/guild/' + G2, { headers: { cookie } })).status, 403);
        assert.strictEqual((await go('/api/guild/' + G, { headers: { cookie } })).status, 200);
        r = await go('/sso?t=' + mk({}), { headers: { 'x-forwarded-proto': 'https' } }); assert.match(r.headers.get('set-cookie'), /; Secure;/, 'hinter https mit Secure');
    } finally { srv.close(); delete process.env.BOT_SSO_SECRET; }
});

test('Dashboard: leerer Gateway-Speicher – Server kommen direkt von Discord, Hinweis + Neu prüfen', async () => {
    const SECRET = 'z'.repeat(48), crypto = require('crypto');
    process.env.BOT_SSO_SECRET = SECRET;
    const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'gn-rg-')));
    const G = '444444444444444444', G2 = '555555555555555555', U = '700000000000000009';
    let botIn = [{ id: G2, name: 'Zweiter' }];
    let member = false;
    const guilds = { [G]: { id: G, name: 'Haupt', owner_id: U, roles: [{ id: G, permissions: '0' }] }, [G2]: { id: G2, name: 'Zweiter', owner_id: '1', roles: [{ id: G2, permissions: '0' }] } };
    const rest = async (m, route) => {
        if (route.startsWith('/users/@me/guilds')) return route.includes('after=0') ? botIn : [];
        let x = /^\/guilds\/(\d+)$/.exec(route); if (x) return guilds[x[1]];
        x = /^\/guilds\/(\d+)\/members\/(\d+)$/.exec(route);
        if (x) { if (x[1] === G || member) return { roles: [] }; throw new Error('Discord GET: HTTP 404'); }
        return [];
    };
    const dash = createDashboard({ CFG: { app: '123', api: 'https://discord.com/api/v10', nexus: 'https://site.example' }, rest, store, log: () => {}, botGuilds: () => [] });
    const srv = http.createServer((q, s) => dash.handle(q, s)); await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const B = 'http://127.0.0.1:' + srv.address().port;
    const go = (p, o = {}) => fetch(B + p, Object.assign({ redirect: 'manual' }, o));
    const mk = o => { const p = Buffer.from(JSON.stringify(Object.assign({ v: 1, d: U, n: 'Luna', a: null, e: Math.floor(Date.now() / 1000) + 60, j: crypto.randomBytes(16).toString('hex') }, o))).toString('base64url');
        return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url'); };
    try {
        const cookie = 'gnsid=' + /gnsid=([0-9a-f]+)/.exec((await go('/sso?t=' + mk({}))).headers.get('set-cookie'))[1];
        let me = await (await go('/api/me', { headers: { cookie } })).json();
        assert.deepStrictEqual(me.guilds, [], 'Bot nur auf einem Server ohne die Person');
        assert.deepStrictEqual([me.diag.bot, me.diag.member], [1, 0], 'Hinweis: Bot auf 1 Server, Person dort kein Mitglied');
        assert.strictEqual(store.get(G2).meta.name, 'Zweiter', 'Speicher wird nachgezogen');
        // Bot wird auf den eigenen Server eingeladen → „Neu prüfen“ ohne neue Anmeldung
        botIn = [{ id: G, name: 'Haupt' }, { id: G2, name: 'Zweiter' }];
        assert.strictEqual((await go('/api/refresh', { method: 'POST', headers: { cookie } })).status, 403, 'ohne CSRF nicht');
        const r = await (await go('/api/refresh', { method: 'POST', headers: { cookie, 'x-csrf': me.csrf, 'content-type': 'application/json' }, body: '{}' })).json();
        assert.deepStrictEqual(r.guilds.map(g => [g.id, g.bot]), [[G, true]], 'Inhaber sieht den Server jetzt');
        assert.strictEqual((await go('/api/guild/' + G, { headers: { cookie } })).status, 200);
    } finally { srv.close(); delete process.env.BOT_SSO_SECRET; }
});
