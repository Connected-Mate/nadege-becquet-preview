import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { createApp, setupCredentials, validateContent } from '../server.mjs';

const PASSWORD = 'mot-de-passe-de-test-uniquement-2026';
const initial = () => ({ business: { name: 'Nadège Becquet', phone: '06 83 49 30 34', address: '160 rue Grande', city: 'Fontainebleau', postalCode: '77300', appointmentNote: 'Sur rendez-vous' }, home: { eyebrow: 'Facialiste', title: 'Un temps pour soi', description: 'Présentation vérifiée.' }, about: { intro: 'Présentation.' }, services: [{ slug: 'soin-visage', title: 'Soin visage', summary: 'Résumé', body: 'Description' }], faqs: [{ question: 'Comment prendre rendez-vous ?', answer: 'Par téléphone.' }], posts: [{ slug: 'premiere-visite', title: 'Première visite', excerpt: 'Introduction', body: 'Article.' }], demo: { removalDate: null }, extra: { source: 'conservée' } });

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nb-admin-test-'));
  await Promise.all(['data', 'dist', 'admin', 'scripts'].map(dir => fs.mkdir(path.join(root, dir))));
  await fs.writeFile(path.join(root, 'data/content.json'), JSON.stringify(initial()));
  await fs.writeFile(path.join(root, 'dist/index.html'), '<h1>Preview publique</h1>');
  await fs.writeFile(path.join(root, 'admin/index.html'), '<h1>Connexion locale</h1>');
  await fs.writeFile(path.join(root, 'scripts/build.mjs'), "import fs from 'node:fs/promises'; await fs.writeFile('dist/index.html', '<h1>Preview reconstruite</h1>');");
  await setupCredentials(root, PASSWORD);
  let time = Date.now();
  const server = createApp({ root, now: () => time });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  let cookie = ''; let csrf = '';
  async function request(route, { method = 'GET', body, headers = {}, authenticated = true } = {}) {
    return fetch(`${base}${route}`, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { Origin: base } : {}), ...(authenticated && cookie ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  }
  async function login() {
    const response = await request('/api/login', { method: 'POST', body: { password: PASSWORD }, authenticated: false });
    assert.equal(response.status, 200); cookie = response.headers.get('set-cookie').split(';')[0]; csrf = (await response.json()).csrf; return response;
  }
  return { root, base, request, login, advance: milliseconds => { time += milliseconds; } };
}

test('local authentication protects content and uses a restricted cookie', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/content')).status, 401);
  assert.equal((await f.request('/api/login', { method: 'POST', body: { password: PASSWORD }, headers: { Origin: 'https://external.example' } })).status, 403);
  const login = await f.login(); const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Path=\//);
  assert.equal((await f.request('/api/session')).status, 200);
  const content = await (await f.request('/api/content')).json(); assert.equal(content.content.business.name, 'Nadège Becquet');
  const reboundStatus = await new Promise((resolve, reject) => {
    const request = http.get(`${f.base}/api/content`, { headers: { Host: 'malicious.example' } }, response => { response.resume(); resolve(response.statusCode); }); request.on('error', reject);
  });
  assert.equal(reboundStatus, 403);
  const secret = JSON.parse(await fs.readFile(path.join(f.root, '.local/credentials.json'), 'utf8'));
  assert.equal(secret.hash.includes(PASSWORD), false); assert.equal(secret.hash.length, 128);
  const mode = (await fs.stat(path.join(f.root, '.local/admin-access.txt'))).mode & 0o777; assert.equal(mode, 0o600);
});

test('writes require CSRF and origin, preserve backups, reject stale revisions, and restore', async t => {
  const f = await fixture(t); await f.login();
  const original = await (await f.request('/api/content')).json(); const changed = structuredClone(original.content); changed.home.title = 'Un nouveau titre';
  assert.equal((await f.request('/api/content', { method: 'PUT', body: { content: changed, revision: original.revision }, headers: { 'X-CSRF-Token': 'wrong' } })).status, 403);
  assert.equal((await f.request('/api/content', { method: 'PUT', body: { content: changed, revision: original.revision }, headers: { Origin: 'https://external.example' } })).status, 403);
  const response = await f.request('/api/content', { method: 'PUT', body: { content: changed, revision: original.revision } }); assert.equal(response.status, 200);
  const saved = await response.json(); assert.notEqual(saved.revision, original.revision); assert.equal(saved.content.extra.source, 'conservée');
  assert.equal((await f.request('/api/content', { method: 'PUT', body: { content: changed, revision: original.revision } })).status, 409);
  const history = await (await f.request('/api/history')).json(); assert.equal(history.history.length, 1);
  const backup = JSON.parse(await fs.readFile(path.join(f.root, '.local/history', history.history[0].id), 'utf8')); assert.equal(backup.content.home.title, original.content.home.title);
  const restoredResponse = await f.request('/api/restore', { method: 'POST', body: { id: history.history[0].id, revision: saved.revision } }); assert.equal(restoredResponse.status, 200);
  const restored = await restoredResponse.json(); assert.equal(restored.content.home.title, original.content.home.title);
  assert.equal((await (await f.request('/api/history')).json()).history.length, 2);
  assert.equal((await f.request('/api/restore', { method: 'POST', body: { id: '../../data/content.json', revision: restored.revision } })).status, 422);
  const audit = await fs.readFile(path.join(f.root, '.local/audit.jsonl'), 'utf8'); assert.match(audit, /restauration/); assert.equal(audit.includes(PASSWORD), false);
});

test('schema rejects malformed data, duplicate slugs and impossible dates', async t => {
  const f = await fixture(t); await f.login(); const original = await (await f.request('/api/content')).json();
  const badContent = structuredClone(original.content); badContent.services[0].slug = '../outside';
  assert.equal((await f.request('/api/content', { method: 'PUT', body: { content: badContent, revision: original.revision } })).status, 422);
  const duplicate = initial(); duplicate.services.push({ ...duplicate.services[0] }); assert.throws(() => validateContent(duplicate), /unique/);
  const badDate = initial(); badDate.demo.removalDate = '2026-02-30'; assert.throws(() => validateContent(badDate), /date réelle/);
  const goodDate = initial(); goodDate.demo.removalDate = '2026-12-31'; assert.equal(validateContent(goodDate).demo.removalDate, '2026-12-31');
  const badName = initial(); badName.business.name = ''; assert.throws(() => validateContent(badName), /non vide/);
  assert.equal((await (await f.request('/api/content')).json()).revision, original.revision);
});

test('all build-required fields exist and essential business fields cannot be empty', () => {
  const required = { business: ['name', 'phone', 'address', 'city', 'postalCode', 'appointmentNote'], home: ['title', 'description', 'eyebrow'], about: ['intro'] };
  for (const [section, keys] of Object.entries(required)) for (const key of keys) {
    const missing = initial(); delete missing[section][key]; assert.throws(() => validateContent(missing), new RegExp(`${section}\\.${key}`));
  }
  for (const [section, key] of [['business', 'name'], ['business', 'phone'], ['business', 'address'], ['business', 'city'], ['business', 'postalCode'], ['home', 'title']]) {
    const empty = initial(); empty[section][key] = '   '; assert.throws(() => validateContent(empty), /non vide/);
  }
  const allowedEmpty = initial(); allowedEmpty.business.appointmentNote = ''; allowedEmpty.home.description = ''; allowedEmpty.home.eyebrow = ''; allowedEmpty.about.intro = '';
  assert.equal(validateContent(allowedEmpty), allowedEmpty);
});

test('optional legal pages accept only the three unique supported routes and text fields', async t => {
  const f = await fixture(t); await f.login(); const original = await (await f.request('/api/content')).json();
  const content = structuredClone(original.content);
  content.pages = ['mentions-legales', 'confidentialite', 'sources'].map(slug => ({ slug, title: `Page ${slug}`, description: 'Description de la page.', body: 'Texte simple.\n\nhttps://example.com/source' }));
  assert.equal((await f.request('/api/content', { method: 'PUT', body: { content, revision: original.revision } })).status, 200);
  assert.deepEqual((await (await f.request('/api/content')).json()).content.pages, content.pages);
  const unknown = structuredClone(content); unknown.pages[0].slug = 'admin'; assert.throws(() => validateContent(unknown), /seules les adresses/);
  const duplicate = structuredClone(content); duplicate.pages[1].slug = 'sources'; assert.throws(() => validateContent(duplicate), /unique/);
  const missing = structuredClone(content); delete missing.pages[0].body; assert.throws(() => validateContent(missing), /body/);
  const wrongType = structuredClone(content); wrongType.pages = {}; assert.throws(() => validateContent(wrongType), /liste de 3/);
  const tooMany = structuredClone(content); tooMany.pages.push({ ...tooMany.pages[0] }); assert.throws(() => validateContent(tooMany), /liste de 3/);
});

test('editorial approval is authenticated, versioned and invalidated by changed content', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/approval')).status, 401);
  await f.login(); const original = await (await f.request('/api/content')).json();
  assert.equal((await (await f.request('/api/approval')).json()).approved, false);
  assert.equal((await f.request('/api/approval', { method: 'POST', body: { revision: original.revision } })).status, 422);
  const approval = await f.request('/api/approval', { method: 'POST', body: { revision: original.revision, confirmed: true } });
  assert.equal(approval.status, 200); assert.equal((await approval.json()).approved, true);
  const changed = structuredClone(original.content); changed.home.title = 'Nouvelle version à relire';
  assert.equal((await f.request('/api/content', { method: 'PUT', body: { content: changed, revision: original.revision } })).status, 200);
  assert.equal((await (await f.request('/api/approval')).json()).approved, false);
  assert.equal((await f.request('/api/approval', { method: 'POST', body: { revision: original.revision, confirmed: true } })).status, 409);
});

test('exports rebuild the static preview without exposing admin secrets or files outside dist', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/export-content')).status, 401);
  assert.equal((await f.request('/api/build', { method: 'POST', body: {} })).status, 401);
  await f.login();
  const exported = await f.request('/api/export-content'); assert.match(exported.headers.get('content-disposition'), /attachment/); assert.equal((await exported.json()).business.name, 'Nadège Becquet');
  assert.equal((await f.request('/api/build', { method: 'POST', body: {} })).status, 200);
  assert.match(await (await f.request('/')).text(), /Preview reconstruite/);
  assert.equal((await f.request('/.local/credentials.json')).status, 404);
  assert.equal((await f.request('/server.mjs')).status, 404);
  await fs.symlink(path.join(f.root, '.local/credentials.json'), path.join(f.root, 'dist/secret.json'));
  assert.equal((await f.request('/secret.json')).status, 404);
  const admin = await f.request('/admin/'); assert.equal(admin.status, 200); assert.match(admin.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(admin.headers.get('x-robots-tag'), /noindex/);
});

test('five failed attempts are limited, sessions expire, and logout invalidates the cookie', async t => {
  const f = await fixture(t);
  for (let index = 0; index < 5; index++) assert.equal((await f.request('/api/login', { method: 'POST', body: { password: 'incorrect' } })).status, 401);
  assert.equal((await f.request('/api/login', { method: 'POST', body: { password: PASSWORD } })).status, 429);
  f.advance(15 * 60 * 1000 + 1); await f.login();
  assert.equal((await f.request('/api/session')).status, 200);
  f.advance(8 * 60 * 60 * 1000 + 1); assert.equal((await f.request('/api/session')).status, 401);
  await f.login(); assert.equal((await f.request('/api/logout', { method: 'POST', body: {} })).status, 200);
  assert.equal((await f.request('/api/content')).status, 401);
});
