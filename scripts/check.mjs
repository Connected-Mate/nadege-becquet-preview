import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const output = path.join(root, 'dist');
const site = new URL(process.env.SITE_URL || 'https://connected-mate.github.io/nadege-becquet-preview/');
const issues = [];
const warnings = [];
let checks = 0;
const assert = (condition, message) => { checks++; if (!condition) issues.push(message); };
const decode = value => String(value).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const textOnly = value => decode(String(value).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1];
const meta = (html, name) => [...html.matchAll(/<meta\b[^>]*>/gi)].find(match => attr(match[0], 'name') === name)?.[0];
async function walk(directory, prefix = '') {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
    else issues.push(`Fichier non régulier dans l’export : ${relative}`);
  }
  return files;
}
let files;
try { files = await walk(output); } catch { console.error('Export dist/ absent. Exécutez npm run build avant npm run check.'); process.exit(1); }
const allFiles = new Set(files);
const htmlFiles = files.filter(file => file.endsWith('.html'));
const htmlByFile = new Map(await Promise.all(htmlFiles.map(async file => [file, await fs.readFile(path.join(output, file), 'utf8')])));
const content = JSON.parse(await fs.readFile(path.join(root, 'data/content.json'), 'utf8'));
const build = JSON.parse(await fs.readFile(path.join(output, 'build-info.json'), 'utf8'));
const expectedPhone = String(content.business.phone || '').replace(/[^+\d]/g, '').replace(/^0/, '+33');
const titles = new Map();
const descriptions = new Map();
const references = [];
assert(htmlFiles.length > 1, 'L’export ne contient pas les pages du site.');
assert(build.noindex === true && build.publicDemo === true, 'Le manifeste doit identifier une démo publique non indexable.');
assert(build.removalDate === content.demo.removalDate, 'Le manifeste et les contenus ont des dates de retrait différentes.');
assert(allFiles.has('.nojekyll'), '.nojekyll absent de l’export GitHub Pages.');
assert(allFiles.has('404.html'), 'La page 404 est absente.');
if (!build.expired) assert(allFiles.has('assets/itineraire.svg'), 'Le QR code d’itinéraire est absent.');
else assert(!files.some(file => file.startsWith('assets/')), 'Un export expiré conserve des ressources de la démo.');
const robots = await fs.readFile(path.join(output, 'robots.txt'), 'utf8');
assert(/User-agent:\s*\*/i.test(robots) && /Allow:\s*\/\s*(?:\n|$)/i.test(robots) && !/^Disallow:\s*\/\s*$/im.test(robots), 'robots.txt doit permettre la lecture de noindex dans les pages.');

for (const [file, html] of htmlByFile) {
  assert(/<html\b[^>]*\blang=["']fr["']/i.test(html), `${file} : langue française absente.`);
  assert(/\bnoindex\b/i.test(attr(meta(html, 'robots') || '', 'content') || ''), `${file} : noindex absent.`);
  assert((html.match(/<h1(?:\s|>)/gi) || []).length === 1, `${file} : un titre H1 unique est attendu.`);
  const title = textOnly(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '');
  const description = decode(attr(meta(html, 'description') || '', 'content') || '');
  assert(Boolean(title), `${file} : title absent.`);
  if (!build.expired) {
    assert(Boolean(description), `${file} : description absente.`);
    assert(!titles.has(title), `${file} : title identique à ${titles.get(title)}.`);
    assert(!descriptions.has(description), `${file} : description identique à ${descriptions.get(description)}.`);
    titles.set(title, file); descriptions.set(description, file);
    const rawSchemas = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    assert(rawSchemas.length > 0, `${file} : données structurées absentes.`);
    for (const [, source] of rawSchemas) {
      let schema;
      try { schema = JSON.parse(source); } catch { issues.push(`${file} : JSON-LD invalide.`); continue; }
      const nodes = schema['@graph'] || (Array.isArray(schema) ? schema : [schema]);
      const business = nodes.find(node => ['BeautySalon', 'LocalBusiness', 'HealthAndBeautyBusiness'].includes(node['@type']));
      assert(Boolean(business), `${file} : établissement absent des données structurées.`);
      if (business) {
        assert(business.name === content.business.name, `${file} : nom JSON-LD incohérent.`);
        assert(business.telephone === expectedPhone, `${file} : téléphone JSON-LD incohérent.`);
        for (const [schemaKey, dataKey] of [['streetAddress', 'address'], ['addressLocality', 'city'], ['postalCode', 'postalCode']]) {
          assert(business.address?.[schemaKey] === content.business[dataKey], `${file} : ${schemaKey} JSON-LD incohérent.`);
        }
        assert(!business.aggregateRating && !business.review && !business.priceRange, `${file} : avis ou tarifs non vérifiés dans les données structurées.`);
      }
    }
  }
  for (const match of html.matchAll(/<(a|link|script|img|iframe)\b[^>]*>/gi)) {
    const tag = match[0], kind = match[1].toLowerCase();
    const source = attr(tag, ['a', 'link'].includes(kind) ? 'href' : 'src');
    if (kind === 'script' && attr(tag, 'type') !== 'application/ld+json') {
      let script;
      try { script = source && new URL(decode(source), new URL(file, site)); } catch {}
      assert(Boolean(script) && script.href === new URL('app.js', site).href, `${file} : script exécutable inattendu ou externe.`);
    }
    if (!source) continue;
    references.push({ file, source: decode(source), kind });
    if (kind === 'img') assert(attr(tag, 'alt') !== undefined, `${file} : image sans attribut alt.`);
    if (kind === 'a' && attr(tag, 'target') === '_blank') assert(/\bnoopener\b/.test(attr(tag, 'rel') || ''), `${file} : lien nouvel onglet sans noopener.`);
    if (kind === 'a' && source.startsWith('tel:')) assert(decode(source) === `tel:${expectedPhone}`, `${file} : lien téléphonique incohérent.`);
  }
  assert(!/\b(?:undefined|NaN)\b/.test(textOnly(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''))), `${file} : valeur technique indéfinie visible.`);
}

for (const file of files.filter(name => name.endsWith('.css'))) {
  const css = await fs.readFile(path.join(output, file), 'utf8');
  for (const match of css.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)) references.push({ file, source: decode(match[1]), kind: 'css' });
}

for (const { file, source, kind } of references) {
  if (/^(?:tel:|mailto:|data:|blob:)/i.test(source)) continue;
  let resolved;
  try { resolved = new URL(source, new URL(file, site)); } catch { issues.push(`${file} : URL mal formée (${source}).`); continue; }
  if (resolved.origin !== site.origin) continue;
  assert(resolved.pathname.startsWith(site.pathname), `${file} : lien sortant de la racine GitHub Pages (${source}).`);
  if (!resolved.pathname.startsWith(site.pathname)) continue;
  let target = decodeURIComponent(resolved.pathname.slice(site.pathname.length));
  if (!target || target.endsWith('/')) target += 'index.html';
  else if (!allFiles.has(target) && allFiles.has(`${target}/index.html`)) target += '/index.html';
  assert(allFiles.has(target), `${file} : cible interne absente (${source} → ${target}).`);
  if (resolved.hash && htmlByFile.has(target)) {
    const id = decodeURIComponent(resolved.hash.slice(1));
    const ids = [...htmlByFile.get(target).matchAll(/\bid=["']([^"']+)["']/g)].map(match => decode(match[1]));
    assert(ids.includes(id), `${file} : ancre absente (${source}).`);
  }
  if (file === '404.html' && kind === 'a' && !/^(?:https?:\/\/|\/|#)/i.test(source)) {
    issues.push(`404.html : lien relatif fragile sur une URL inconnue imbriquée (${source}).`);
  }
}

for (const file of files) {
  assert(!/(?:^|\/)(?:admin|\.local|\.git|history|node_modules)(?:\/|$)/i.test(file), `Répertoire privé ou serveur exporté : ${file}`);
  assert(!/(?:^|\/)(?:credentials(?:\.json)?|admin-access\.txt|\.env(?:\..+)?|server\.mjs|content\.json|audit\.jsonl)$/i.test(file), `Fichier interne exporté : ${file}`);
  if (!/\.(?:html|js|mjs|json|txt|css)$/i.test(file)) continue;
  const source = await fs.readFile(path.join(output, file), 'utf8');
  assert(!/\b(?:ghp_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(source), `Secret potentiel dans ${file} (valeur masquée).`);
  assert(!/["'](?:passwordHash|csrfSecret|sessionSecret)["']\s*:/.test(source), `Secret serveur sérialisé dans ${file}.`);
}
if (build.expired) warnings.push('Export expiré : contrôles de titres uniques et de données structurées non applicables.');
const uniqueIssues = [...new Set(issues)];
console.log(`${htmlFiles.length} pages HTML, ${references.length} références et ${checks} contrôles vérifiés.`);
for (const warning of warnings) console.log(`À noter : ${warning}`);
if (uniqueIssues.length) {
  for (const issue of uniqueIssues) console.error(`ÉCHEC : ${issue}`);
  process.exitCode = 1;
} else console.log('Export valide : liens, ressources, ancres, noindex, titres, descriptions, données structurées et exclusion des fichiers privés.');
