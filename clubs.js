'use strict';
/* Club-Abgleich mit VRC Nexus: liest öffentlich <nexus>/nexusclubs.php?discord=<club> (kommende, nicht nur für Mitglieder bestimmte Events)
   und postet neue Events, Erinnerungen vor dem Start und Absagen in einen Kanal. Nur Node-Bordmittel. */
const COLOR = 0x38d5e6, RED = 0xef4444, GOLD = 0xf3c262;
const SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;
const MAX_CLUBS = 5, POLL_MS = 10 * 60000, FAST_MS = 60000;
const REMIND = [5, 15, 30, 60, 120, 1440];

const ts = s => '<t:' + Math.floor(s) + ':F> (<t:' + Math.floor(s) + ':R>)';
const clip = (s, n) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
/** Text vom Server: Erwähnungen und Markdown-Links entschärfen */
const safe = s => String(s || '').replace(/@(everyone|here)/gi, '@​$1').replace(/<@[!&]?\d+>/g, '[Erwähnung]');

function create(core) {
    const { rest, log, store } = core;
    const base = () => String(core.nexus || 'https://ghostnode-labs.dev').replace(/\/+$/, '');
    const getJson = core.getJson || (async url => { const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'ghostnode-bot' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    const send = (ch, data) => rest('POST', '/channels/' + ch + '/messages', Object.assign({ allowed_mentions: { parse: [] } }, data));
    const list = d => { d.clubs = d.clubs || {}; return d.clubs; };

    function eventEmbed(club, e, title, color = COLOR) {
        const fields = [{ name: '🕒 Beginn', value: ts(e.starts), inline: false }];
        if (e.place) fields.push({ name: '📍 Ort', value: clip(safe(e.place), 200), inline: true });
        fields.push({ name: '✅ Zusagen', value: String(e.going || 0) + (e.capacity ? ' / ' + e.capacity : ''), inline: true });
        return { title: clip(title + safe(e.title), 250), url: club.url, color, description: clip(safe(e.descr), 900) || undefined, fields, footer: { text: '🏠 ' + clip(safe(club.name), 100) + ' · VRC Nexus' } };
    }

    /** Einen Club abgleichen. Beim ersten Abruf werden vorhandene Events nur gemerkt (kein Schwall alter Posts). */
    async function syncOne(g, slug, c, nowMs) {
        const feed = await getJson(base() + '/nexusclubs.php?discord=' + encodeURIComponent(slug));
        if (!feed || !Array.isArray(feed.events)) throw new Error('Antwort ohne Events');
        const club = Object.assign({ name: slug, url: base() + '/nexus.php?club=' + encodeURIComponent(slug) }, feed.club || {});
        c.name = String(club.name || slug).slice(0, 100);
        const first = !c.synced, now = nowMs / 1000, seen = c.seen = c.seen || {};
        const mention = c.role ? { content: '<@&' + c.role + '>', allowed_mentions: { roles: [c.role] } } : {};
        const posts = [];
        for (const e of feed.events.slice(0, 50)) {
            const id = String(parseInt(e.id, 10) || 0); if (id === '0' || !(e.starts > 0)) continue;
            const fresh = !seen[id], s = seen[id] = seen[id] || { st: e.status, rem: false };
            s.ends = e.ends;
            const soon = e.status !== 'cancelled' && e.starts > now && e.starts - now <= c.remind * 60;
            if (first) { s.rem = soon || e.starts <= now; s.st = e.status; continue; }
            if (fresh) {
                if (e.status === 'cancelled' || e.starts <= now) { s.rem = true; continue; }
                s.rem = soon;   // schon im Erinnerungsfenster: ein Beitrag reicht
                posts.push(Object.assign({ embeds: [eventEmbed(club, e, soon ? '⏰ Gleich geht’s los: ' : '📅 Neues Event: ', soon ? GOLD : COLOR)] }, mention));
            } else if (e.status === 'cancelled' && s.st !== 'cancelled') posts.push({ embeds: [eventEmbed(club, e, '❌ Abgesagt: ', RED)] });
            else if (soon && !s.rem) { s.rem = true; posts.push(Object.assign({ embeds: [eventEmbed(club, e, '⏰ Gleich geht’s los: ', GOLD)] }, mention)); }
            s.st = e.status;
        }
        for (const [id, s] of Object.entries(seen)) if (s.ends && s.ends < now - 86400) delete seen[id];
        // nächstes Event, an das noch erinnert werden muss → kurz davor öfter abfragen
        c.soon = feed.events.filter(e => e.status !== 'cancelled' && e.starts > now && seen[String(parseInt(e.id, 10) || 0)] && !seen[String(parseInt(e.id, 10) || 0)].rem).reduce((m, e) => Math.min(m, e.starts), Infinity);
        if (!isFinite(c.soon)) c.soon = 0;
        c.synced = true; c.last = nowMs; c.err = '';
        for (const p of posts) await send(c.channel, p).catch(e => log('Club-Post:', e.message));
        return posts.length;
    }

    async function tick(nowMs = Date.now(), force = false) {
        let n = 0;
        for (const g of store.guilds()) {
            const d = store.get(g), cl = list(d);
            for (const [slug, c] of Object.entries(cl)) {
                const near = c.soon && c.soon * 1000 - nowMs <= ((c.remind || 30) * 60 + 900) * 1000;
                if (!force && c.last && nowMs - c.last < (near ? FAST_MS : POLL_MS)) continue;
                try { n += await syncOne(g, slug, c, nowMs); }
                catch (e) { c.last = nowMs; c.err = clip(e.message, 120); log('Club ' + slug + ':', e.message); }
                store.save(g);
            }
        }
        return n;
    }

    const has = it => { try { const x = BigInt(it.member && it.member.permissions || 0); return (x & 8n) === 8n || (x & 32n) === 32n; } catch (e) { return false; } };
    const eph = content => ({ content, flags: 64, allowed_mentions: { parse: [] } });

    const COMMANDS = [{ name: 'club', description: 'VRC-Nexus-Club mit einem Kanal verbinden (Events & Erinnerungen)', default_member_permissions: String(32n), options: [
        { type: 1, name: 'verbinden', description: 'Club-Events in einen Kanal posten', options: [
            { type: 3, name: 'club', description: 'Club-Kürzel aus der Adresse (nexus.php?club=…)', required: true, max_length: 40 },
            { type: 7, name: 'kanal', description: 'Kanal für Events', required: true },
            { type: 8, name: 'rolle', description: 'Rolle bei neuen Events/Erinnerungen erwähnen', required: false },
            { type: 4, name: 'erinnerung', description: 'Minuten vor dem Start erinnern', required: false, choices: REMIND.map(m => ({ name: m >= 60 ? (m / 60) + ' Std.' : m + ' min', value: m })) }] },
        { type: 1, name: 'trennen', description: 'Club-Verbindung entfernen', options: [{ type: 3, name: 'club', description: 'Club-Kürzel', required: true, max_length: 40 }] },
        { type: 1, name: 'liste', description: 'Verbundene Clubs anzeigen' },
        { type: 1, name: 'jetzt', description: 'Sofort abgleichen' }] }];

    const H = {
        async club(it, o, res, s) {
            if (!has(it)) return eph('Keine Berechtigung.');
            const g = it.guild_id, d = store.get(g), cl = list(d);
            const slug = String(o.club || '').trim().toLowerCase().replace(/^.*[?&]club=/, '').replace(/[^a-z0-9-].*$/, '');
            switch (s) {
                case 'verbinden': {
                    if (!SLUG.test(slug)) return eph('Ungültiges Club-Kürzel (Kleinbuchstaben, Ziffern, Bindestrich).');
                    if (!cl[slug] && Object.keys(cl).length >= MAX_CLUBS) return eph('Höchstens ' + MAX_CLUBS + ' Clubs je Server.');
                    let feed;
                    try { feed = await getJson(base() + '/nexusclubs.php?discord=' + encodeURIComponent(slug)); } catch (e) { return eph('Club nicht gefunden oder nicht öffentlich (' + clip(e.message, 80) + ').'); }
                    if (!feed || !Array.isArray(feed.events)) return eph('Club nicht gefunden oder nicht öffentlich.');
                    const remind = REMIND.includes(o.erinnerung) ? o.erinnerung : 30;
                    cl[slug] = { channel: o.kanal, role: o.rolle || '', remind, seen: {}, synced: false, last: 0, name: String((feed.club && feed.club.name) || slug).slice(0, 100) };
                    await syncOne(g, slug, cl[slug], Date.now()).catch(() => {});
                    store.save(g);
                    return eph('✅ **' + safe(cl[slug].name) + '** → <#' + o.kanal + '> · Erinnerung ' + remind + ' min vorher' + (o.rolle ? ' · Rolle <@&' + o.rolle + '>' : '') + '\nBereits geplante Events werden nicht nachgepostet, nur neue.');
                }
                case 'trennen':
                    if (!cl[slug]) return eph('Dieser Club ist nicht verbunden.');
                    delete cl[slug]; store.save(g); return eph('🔌 Club **' + slug + '** getrennt.');
                case 'jetzt': {
                    if (!Object.keys(cl).length) return eph('Noch kein Club verbunden: /club verbinden');
                    let n = 0;
                    for (const [k, c] of Object.entries(cl)) { try { n += await syncOne(g, k, c, Date.now()); } catch (e) { c.err = clip(e.message, 120); } }
                    store.save(g); return eph('🔄 Abgeglichen · ' + n + ' neue Beiträge.');
                }
                default: {
                    const rows = Object.entries(cl).map(([k, c]) => '🏠 **' + safe(c.name || k) + '** (`' + k + '`) → <#' + c.channel + '> · ' + c.remind + ' min' + (c.role ? ' · <@&' + c.role + '>' : '') + (c.err ? ' · ⚠️ ' + safe(c.err) : ''));
                    return eph(rows.length ? rows.join('\n') : 'Noch kein Club verbunden: /club verbinden');
                }
            }
        },
    };
    return { COMMANDS, H, tick, syncOne, POLL_MS };
}

module.exports = { create, SLUG, MAX_CLUBS };
