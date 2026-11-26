'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');

test('Slash-Befehle: schnelle Antwort in einem Schritt, langsame mit „denkt nach“ + Nachreichen, Zwischenspeicher', async () => {
    const calls = []; let ghHits = 0;
    const srv = http.createServer((q, s) => { let b = ''; q.on('data', c => { b += c; }); q.on('end', () => {
        calls.push([q.method, q.url, b ? JSON.parse(b) : null]);
        if (q.url.startsWith('/gh/')) { ghHits++; s.writeHead(200, { 'Content-Type': 'application/json' }); return s.end(JSON.stringify({ tag_name: 'vrc-nexus-5.0.0', html_url: 'https://x', body: 'neu' })); }
        s.writeHead(200, { 'Content-Type': 'application/json' }); s.end('{}'); }); });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const B = 'http://127.0.0.1:' + srv.address().port;
    Object.assign(process.env, { BOT_NO_AUTOSTART: '1', DISCORD_TOKEN: 't', DISCORD_APP_ID: '123', DISCORD_API: B + '/api', GITHUB_API: B + '/gh', BOT_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'gn-int-')) });
    delete require.cache[require.resolve('../bot.js')];
    const bot = require('../bot.js');
    try {
        const run = async d => { calls.length = 0; await bot.onInteraction(Object.assign({ id: 'I', token: 'T', type: 2, guild_id: '1', member: { user: { id: '9', username: 'x' }, permissions: '8', roles: [] } }, d)); return calls.filter(c => c[1].startsWith('/api')); };
        let c = await run({ data: { name: 'wuerfel', options: [{ name: 'seiten', value: 6 }] } });
        assert.strictEqual(c.length, 1, 'ein Schritt'); assert.strictEqual(c[0][2].type, 4); assert.match(c[0][2].data.content, /🎲 [1-6]/);
        c = await run({ data: { name: 'release' } });
        assert.strictEqual(c.length, 1); assert.match(c[0][2].data.embeds[0].title, /5\.0\.0/);
        await run({ data: { name: 'release' } }); assert.strictEqual(ghHits, 1, 'GitHub-Antwort zwischengespeichert');
        c = await run({ data: { name: 'verwarnungen', options: [{ name: 'nutzer', value: '5' }] } });
        assert.strictEqual(c[0][2].data.flags, 64, 'Moderation nur für dich sichtbar');
        // langsamer Befehl → erst type 5, dann PATCH
        bot.HANDLERS.langsam = () => new Promise(r => setTimeout(() => r({ content: 'fertig' }), 1700));
        c = await run({ data: { name: 'langsam' } });
        assert.deepStrictEqual(c.map(x => [x[0], x[2].type]), [['POST', 5], ['PATCH', undefined]]);
        assert.strictEqual(c[1][1], '/api/webhooks/123/T/messages/@original'); assert.strictEqual(c[1][2].content, 'fertig');
    } finally {
        bot.store.flushAll(); srv.close();
        for (const k of ['BOT_NO_AUTOSTART', 'DISCORD_TOKEN', 'DISCORD_APP_ID', 'DISCORD_API', 'GITHUB_API', 'BOT_DATA']) delete process.env[k];
    }
});
