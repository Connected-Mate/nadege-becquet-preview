import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const runFile = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SESSION_MS = 8 * 60 * 60 * 1000;
const MAX_BODY = 1024 * 1024;
const HISTORY_ID = /^\d{13}-[a-f0-9]{8}\.json$/;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.woff2': 'font/woff2', '.pdf': 'application/pdf' };

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };
const hash = value => createHash('sha256').update(value).digest('hex');
const json = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
};
const serialise = value => `${JSON.stringify(value, null, 2)}\n`;
async function atomicWrite(filename, data, mode = 0o600) {
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${randomBytes(6).toString('hex')}.tmp`;
  try { await fs.writeFile(temporary, data, { mode }); await fs.rename(temporary, filename); }
  finally { await fs.rm(temporary, { force: true }); }
}

export async function setupCredentials(root = HERE, password, { reset = false } = {}) {
  const directory = path.join(root, '.local');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  const filename = path.join(directory, 'credentials.json');
  try { await fs.access(filename); if (!reset) return { created: false, accessFile: path.join(directory, 'admin-access.txt') }; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const chosen = password ?? randomBytes(24).toString('base64url');
  if (typeof chosen !== 'string' || chosen.length < 16 || chosen.length > 256) throw new Error('Le mot de passe doit contenir entre 16 et 256 caractères.');
  const salt = randomBytes(32).toString('hex');
  const record = { version: 1, salt, hash: scryptSync(chosen, salt, 64).toString('hex'), createdAt: new Date().toISOString() };
  await atomicWrite(filename, serialise(record));
  const accessFile = path.join(directory, 'admin-access.txt');
  await atomicWrite(accessFile, `ACCÈS STRICTEMENT LOCAL — ne pas publier ce fichier.\n\nAdresse : http://127.0.0.1:4173/admin/\nMot de passe : ${chosen}\n\nCopiez ce secret dans un gestionnaire de mots de passe, puis supprimez ce fichier si souhaité.\nRéinitialiser : arrêter le serveur, puis node server.mjs --reset-password\n`);
  return { created: true, accessFile };
}

export function validateContent(content) {
  const object = (value, location) => { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(422, `${location} : objet attendu.`); };
  const string = (value, location, max, { optional = false, empty = true } = {}) => {
    if (optional && value === undefined) return;
    if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail(422, `${location} : texte ${empty ? '' : 'non vide '}de ${max} caractères maximum attendu.`);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(422, `${location} : caractères de contrôle interdits.`);
  };
  object(content, 'Contenu');
  if (Buffer.byteLength(serialise(content)) > MAX_BODY) fail(422, 'Le contenu dépasse 1 Mo.');
  for (const section of ['business', 'home', 'about', 'demo']) object(content[section], section);
  string(content.business.name, 'business.name', 160, { empty: false });
  for (const key of ['phone', 'address', 'city', 'postalCode', 'appointmentNote']) string(content.business[key], `business.${key}`, 1000, { empty: key === 'appointmentNote' });
  for (const key of ['eyebrow', 'title', 'description']) string(content.home[key], `home.${key}`, key === 'description' ? 4000 : 240, { empty: key !== 'title' });
  string(content.about.intro, 'about.intro', 15000);
  const configs = { services: [['slug', 100], ['title', 240], ['summary', 3000], ['body', 20000]], faqs: [['question', 500], ['answer', 6000]], posts: [['slug', 100], ['title', 240], ['excerpt', 3000], ['body', 30000]], pages: [['slug', 100], ['title', 240], ['description', 3000], ['body', 30000]] };
  for (const [section, fields] of Object.entries(configs)) {
    if (section === 'pages' && content.pages === undefined) continue;
    const limit = section === 'pages' ? 3 : 100;
    if (!Array.isArray(content[section]) || content[section].length > limit) fail(422, `${section} : une liste de ${limit} éléments maximum est attendue.`);
    const slugs = new Set();
    for (const [index, item] of content[section].entries()) {
      object(item, `${section}[${index}]`);
      for (const [key, max] of fields) string(item[key], `${section}[${index}].${key}`, max, { empty: !['slug', 'title', 'question', 'answer'].includes(key) });
      if ('slug' in item) {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug) || slugs.has(item.slug)) fail(422, `${section} : chaque adresse doit être unique, en minuscules avec des tirets.`);
        if (section === 'pages' && !['mentions-legales', 'confidentialite', 'sources'].includes(item.slug)) fail(422, 'pages : seules les adresses mentions-legales, confidentialite et sources sont autorisées.');
        slugs.add(item.slug);
      }
    }
  }
  const date = content.demo.removalDate;
  if (date !== null && date !== undefined && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) fail(422, 'La date de retrait doit être une date réelle au format AAAA-MM-JJ, ou null.');
  return content;
}

async function readBody(req) {
  if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) fail(415, 'Un contenu JSON est attendu.');
  const chunks = []; let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY) fail(413, 'La requête dépasse 1 Mo.');
    chunks.push(chunk);
  }
  let parsed;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail(400, 'Le JSON est invalide.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(400, 'Un objet JSON est attendu.');
  return parsed;
}

export function createApp({ root = HERE, now = () => Date.now() } = {}) {
  const sessions = new Map(); const attempts = new Map();
  const contentFile = path.join(root, 'data', 'content.json');
  const historyDirectory = path.join(root, '.local', 'history');
  let exportInProgress = false; let mutationInProgress = false;
  const audit = async (action, details = {}) => {
    await fs.mkdir(path.join(root, '.local'), { recursive: true, mode: 0o700 });
    await fs.appendFile(path.join(root, '.local', 'audit.jsonl'), `${JSON.stringify({ date: new Date(now()).toISOString(), actor: 'administration-locale', action, ...details })}\n`, { mode: 0o600 });
  };
  const readContent = async () => JSON.parse(await fs.readFile(contentFile, 'utf8'));
  const readApproval = async () => {
    const revision = hash(serialise(await readContent()));
    try {
      const approval = JSON.parse(await fs.readFile(path.join(root, '.local', 'approval.json'), 'utf8'));
      return { approved: approval.revision === revision, revision, date: approval.revision === revision ? approval.date : null };
    } catch (error) { if (error.code !== 'ENOENT') throw error; return { approved: false, revision, date: null }; }
  };
  const snapshot = async (content, reason) => {
    await fs.mkdir(historyDirectory, { recursive: true, mode: 0o700 });
    const id = `${now()}-${randomBytes(4).toString('hex')}.json`;
    await atomicWrite(path.join(historyDirectory, id), serialise({ id, date: new Date(now()).toISOString(), reason, content }));
    return id;
  };
  const originAllowed = req => {
    try {
      const origin = new URL(req.headers.origin);
      const authority = new URL(`http://${req.headers.host}`);
      return origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname) && origin.host === authority.host;
    } catch { return false; }
  };
  const sessionFor = req => {
    const match = String(req.headers.cookie ?? '').match(/(?:^|;\s*)nb_admin=([A-Za-z0-9_-]{40,100})(?:;|$)/);
    const session = match && sessions.get(match[1]);
    if (session && session.expires > now()) return { ...session, id: match[1] };
    if (match) sessions.delete(match[1]);
    return null;
  };
  const authenticate = (req, { mutation = false } = {}) => {
    const session = sessionFor(req);
    if (!session) fail(401, 'Connectez-vous à l’administration locale.');
    if (mutation && (!originAllowed(req) || req.headers['x-csrf-token'] !== session.csrf)) fail(403, 'La vérification de sécurité a échoué. Rechargez la page.');
    return session;
  };
  const saveContent = async (incoming, revision, reason) => {
    if (mutationInProgress) fail(409, 'Une sauvegarde est en cours. Réessayez.');
    mutationInProgress = true;
    try {
      validateContent(incoming);
      const current = await readContent();
      if (!revision || revision !== hash(serialise(current))) fail(409, 'Le contenu a changé depuis son ouverture. Rechargez avant de sauvegarder.');
      const backupId = await snapshot(current, reason);
      await atomicWrite(contentFile, serialise(incoming), 0o644);
      await audit(reason, { backupId, revision: hash(serialise(incoming)) });
      return { content: incoming, revision: hash(serialise(incoming)), backupId };
    } finally { mutationInProgress = false; }
  };
  async function serveFile(req, res, directory, relative) {
    if (relative.split('/').some(part => part.startsWith('.'))) fail(404, 'Page introuvable.');
    const base = path.resolve(directory); const candidate = path.resolve(base, relative || 'index.html');
    if (!candidate.startsWith(`${base}${path.sep}`)) fail(404, 'Page introuvable.');
    let real;
    try {
      const candidateStat = await fs.stat(candidate);
      real = await fs.realpath(candidateStat.isDirectory() ? path.join(candidate, 'index.html') : candidate);
      const realBase = await fs.realpath(base);
      if (!real.startsWith(`${realBase}${path.sep}`)) fail(404, 'Page introuvable.');
    } catch (error) { if (error.status) throw error; fail(404, 'Page introuvable.'); }
    const buffer = await fs.readFile(real);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(real)] ?? 'application/octet-stream', 'Content-Length': buffer.length, 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : buffer);
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('X-Frame-Options', 'DENY');
    try {
      const host = String(req.headers.host ?? '');
      const port = server.address()?.port;
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) fail(403, 'Hôte non autorisé. Utilisez l’adresse locale indiquée.');
      const url = new URL(req.url, `http://${host}`);
      const route = decodeURIComponent(url.pathname);
      if (route.startsWith('/admin')) res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
      if (route === '/api/login' && req.method === 'POST') {
        if (!originAllowed(req)) fail(403, 'Origine non autorisée.');
        const address = req.socket.remoteAddress;
        const attempt = attempts.get(address);
        if (attempt && attempt.count >= 5 && attempt.until > now()) fail(429, 'Trop de tentatives. Réessayez dans 15 minutes.');
        const body = await readBody(req);
        const credential = JSON.parse(await fs.readFile(path.join(root, '.local', 'credentials.json'), 'utf8'));
        const password = typeof body.password === 'string' && body.password.length <= 256 ? body.password : '';
        const supplied = scryptSync(password, credential.salt, 64);
        const expected = Buffer.from(credential.hash, 'hex');
        if (expected.length !== supplied.length || !timingSafeEqual(supplied, expected)) {
          attempts.set(address, { count: attempt && attempt.until > now() ? attempt.count + 1 : 1, until: now() + 15 * 60 * 1000 });
          await audit('connexion-refusee'); fail(401, 'Mot de passe incorrect.');
        }
        attempts.delete(address);
        const previous = sessionFor(req); if (previous) sessions.delete(previous.id);
        for (const [id, session] of sessions) if (session.expires <= now()) sessions.delete(id);
        const id = randomBytes(32).toString('base64url'); const csrf = randomBytes(24).toString('base64url');
        sessions.set(id, { csrf, expires: now() + SESSION_MS });
        res.setHeader('Set-Cookie', `nb_admin=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`);
        await audit('connexion'); return json(res, 200, { authenticated: true, csrf });
      }
      if (route === '/api/session' && req.method === 'GET') { const session = authenticate(req); return json(res, 200, { authenticated: true, csrf: session.csrf }); }
      if (route === '/api/logout' && req.method === 'POST') {
        const session = authenticate(req, { mutation: true }); sessions.delete(session.id);
        res.setHeader('Set-Cookie', 'nb_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        return json(res, 200, { authenticated: false });
      }
      if (route === '/api/content' && req.method === 'GET') {
        authenticate(req); const content = await readContent(); return json(res, 200, { content, revision: hash(serialise(content)) });
      }
      if (route === '/api/content' && req.method === 'PUT') {
        authenticate(req, { mutation: true }); const body = await readBody(req);
        return json(res, 200, await saveContent(body.content, body.revision, 'modification'));
      }
      if (route === '/api/approval' && req.method === 'GET') { authenticate(req); return json(res, 200, await readApproval()); }
      if (route === '/api/approval' && req.method === 'POST') {
        authenticate(req, { mutation: true }); const body = await readBody(req);
        const content = validateContent(await readContent()); const revision = hash(serialise(content));
        if (body.confirmed !== true) fail(422, 'Confirmez la relecture de cette version.');
        if (body.revision !== revision) fail(409, 'La version a changé. Rechargez le contenu avant de valider.');
        const approval = { revision, date: new Date(now()).toISOString(), actor: 'administration-locale' };
        await atomicWrite(path.join(root, '.local', 'approval.json'), serialise(approval));
        await audit('validation-relecture', { revision });
        return json(res, 200, { approved: true, revision, date: approval.date });
      }
      if (route === '/api/history' && req.method === 'GET') {
        authenticate(req); let entries = [];
        try { entries = (await fs.readdir(historyDirectory)).filter(name => HISTORY_ID.test(name)).sort().reverse(); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        const history = await Promise.all(entries.map(async id => {
          const record = JSON.parse(await fs.readFile(path.join(historyDirectory, id), 'utf8'));
          return { id, date: record.date, reason: record.reason };
        }));
        return json(res, 200, { history });
      }
      if (route === '/api/restore' && req.method === 'POST') {
        authenticate(req, { mutation: true }); const body = await readBody(req);
        if (typeof body.id !== 'string' || !HISTORY_ID.test(body.id)) fail(422, 'La sauvegarde demandée est invalide.');
        let record;
        try { record = JSON.parse(await fs.readFile(path.join(historyDirectory, body.id), 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') fail(404, 'Sauvegarde introuvable.'); throw error; }
        return json(res, 200, await saveContent(record.content, body.revision, 'restauration'));
      }
      if (route === '/api/export-content' && req.method === 'GET') {
        authenticate(req); const content = await readContent();
        res.setHeader('Content-Disposition', 'attachment; filename="nadege-becquet-contenus.json"');
        return json(res, 200, content);
      }
      if (route === '/api/build' && req.method === 'POST') {
        authenticate(req, { mutation: true });
        if (exportInProgress) fail(409, 'Un export est déjà en cours.');
        exportInProgress = true;
        try {
          validateContent(await readContent());
          await runFile(process.execPath, [path.join(root, 'scripts', 'build.mjs')], { cwd: root, timeout: 60000, maxBuffer: 1024 * 1024 });
          await audit('export-statique');
          return json(res, 200, { message: 'Export généré dans dist/. La prévisualisation locale a été actualisée. La publication GitHub Pages reste une étape distincte.', preview: '/', output: 'dist/' });
        } catch (error) { if (error.status) throw error; fail(500, 'L’export a échoué. Lancez npm run build dans le terminal pour consulter le diagnostic.'); }
        finally { exportInProgress = false; }
      }
      if (route.startsWith('/api/')) fail(404, 'Action introuvable.');
      if (!['GET', 'HEAD'].includes(req.method)) fail(405, 'Méthode non autorisée.');
      if (route === '/admin') { res.writeHead(302, { Location: '/admin/' }); return res.end(); }
      if (route.startsWith('/admin/')) return await serveFile(req, res, path.join(root, 'admin'), route.slice('/admin/'.length));
      return await serveFile(req, res, path.join(root, 'dist'), route.slice(1));
    } catch (error) {
      const status = error.status ?? (error instanceof URIError ? 400 : 500);
      json(res, status, { error: status === 500 ? 'Une erreur locale est survenue. Vérifiez les fichiers du projet et réessayez.' : error.message });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const reset = process.argv.includes('--reset-password');
  const setup = await setupCredentials(HERE, undefined, { reset });
  if (setup.created) console.log(`Accès local créé. Consultez le fichier privé : ${setup.accessFile}`);
  if (reset || process.argv.includes('--setup')) process.exit(0);
  const app = createApp();
  app.on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'Le port 4173 est déjà occupé. Arrêtez le serveur existant puis réessayez.' : 'Le serveur local n’a pas pu démarrer.'); process.exitCode = 1; });
  app.listen(4173, '127.0.0.1', () => console.log('Site : http://127.0.0.1:4173/\nAdministration locale : http://127.0.0.1:4173/admin/\nAide : http://127.0.0.1:4173/admin/aide.html'));
}
