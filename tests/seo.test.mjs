import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createSeo, collectSchemaNodes, hasSchemaType, escapeHtml, normalisePhone, validDate, DEMO_AUTHOR } from '../scripts/seo.mjs';
const exec = promisify(execFile);
const SITE = 'https://example.com/demo-facialiste/';
const content = () => ({ business: { name: 'Nadège Becquet', phone: '06 83 49 30 34', address: '160 rue Grande', city: 'Fontainebleau', postalCode: '77300' }, faqs: [{ question: 'Comment réserver ?', answer: 'Appelez le cabinet pour convenir du rendez-vous.' }], services: [{ slug: 'kobido', title: 'Massage japonais Kobi-do', summary: 'Découvrir ce soin du visage.', body: 'Description vérifiée.' }], posts: [{ slug: 'premiere-visite', title: 'Préparer sa première visite', excerpt: 'Les questions à poser avant le rendez-vous.', body: 'Contenu éditorial.' }], demo: { removalDate: '2026-11-11' } });
const make = (options = {}) => createSeo({ content: content(), slug: '', title: 'Nadège Becquet, facialiste à Fontainebleau', description: 'Des informations pratiques pour votre rendez-vous au cabinet.', siteUrl: SITE, ...options });
const find = (result, type) => result.graph['@graph'].find(node => hasSchemaType(node, type));

test('demo metadata uses the current public root, remains noindex and keeps stable exact business identifiers', () => {
  const home = make(); const contact = make({ slug: 'contact/', title: 'Contact & accès', description: 'Adresse et téléphone du cabinet.' });
  assert.equal(home.canonical, SITE); assert.equal(contact.canonical, `${SITE}contact/`);
  assert.match(contact.head, /rel="canonical" href="https:\/\/example.com\/demo-facialiste\/contact\/"/);
  assert.match(contact.head, /property="og:url" content="https:\/\/example.com\/demo-facialiste\/contact\/"/);
  assert.match(contact.head, /content="noindex,nofollow,noarchive"/);
  assert.throws(() => make({ isDemo: false }), /validation/);
  assert.throws(() => make({ title: '__BUSINESS_NAME__' }), /personnalisés/);
  const business = find(contact, 'BeautySalon'); assert.equal(business['@id'], find(home, 'BeautySalon')['@id']);
  assert.equal(business.name, content().business.name); assert.equal(business.telephone, '+33683493034');
  assert.deepEqual(business.address, { '@type': 'PostalAddress', streetAddress: '160 rue Grande', addressLocality: 'Fontainebleau', postalCode: '77300', addressCountry: 'FR' });
  for (const key of ['aggregateRating', 'review', 'openingHours', 'openingHoursSpecification', 'priceRange', 'geo', 'image']) assert.equal(business[key], undefined);
  assert.equal(normalisePhone('0033 6 83 49 30 34'), '+33683493034');
});

test('service pages link to the business provider and the correct breadcrumb without invented offers', () => {
  const result = make({ slug: 'soins/kobido/' }); const service = find(result, 'Service');
  assert.equal(service.name, content().services[0].title); assert.equal(service.description, content().services[0].summary);
  assert.equal(service.provider['@id'], `${SITE}#business`); assert.equal(service.offers, undefined);
  const breadcrumbs = find(result, 'BreadcrumbList').itemListElement;
  assert.deepEqual(breadcrumbs.map(item => item.item), [SITE, `${SITE}soins/`, `${SITE}soins/kobido/`]);
  assert.equal(find(make({ slug: 'soins/' }), 'Service'), undefined);
});

test('article attribution is editorial, dates and citations come from source data only', () => {
  const data = content(); Object.assign(data.posts[0], { datePublished: '2026-10-11', dateModified: '2026-10-12T10:30:00+02:00', sources: [{ title: 'Source', url: 'https://example.org/reference' }, { url: 'javascript:alert(1)' }] });
  const result = make({ content: data, slug: 'journal/premiere-visite/' }); const article = find(result, 'BlogPosting');
  const author = result.graph['@graph'].find(node => node['@id'] === article.author['@id']);
  assert.equal(author['@type'], 'Organization'); assert.equal(author.name, DEMO_AUTHOR); assert.notEqual(author.name, data.business.name);
  assert.equal(article.datePublished, data.posts[0].datePublished); assert.equal(article.dateModified, data.posts[0].dateModified);
  assert.deepEqual(article.citation, ['https://example.org/reference']); assert.match(result.head, /og:type" content="article"/);
  assert.equal(find(make({ slug: 'journal/premiere-visite/' }), 'BlogPosting').datePublished, undefined);
  assert.equal(find(make({ slug: 'journal/' }), 'BlogPosting'), undefined);
  data.posts[0].datePublished = '2026-02-30'; data.posts[0].dateModified = 'yesterday';
  const invalid = find(make({ content: data, slug: 'journal/premiere-visite/' }), 'BlogPosting'); assert.equal(invalid.datePublished, undefined); assert.equal(invalid.dateModified, undefined);
  assert.equal(validDate('2026-02-30'), false); assert.equal(validDate('2026-10-11T10:00:00'), false);
  assert.throws(() => make({ slug: 'contact/', post: data.posts[0] }), /correspond pas/);
});

test('FAQ data is confined to the FAQ route and repeats the exact visible-source answers', () => {
  const faq = find(make({ slug: 'faq/' }), 'FAQPage');
  assert.deepEqual(faq.mainEntity, [{ '@type': 'Question', name: content().faqs[0].question, acceptedAnswer: { '@type': 'Answer', text: content().faqs[0].answer } }]);
  assert.equal(find(make(), 'FAQPage'), undefined); assert.equal(find(make({ slug: 'contact/' }), 'FAQPage'), undefined);
  assert.ok(hasSchemaType(faq, 'WebPage'));
});

test('metadata and JSON-LD cannot break out into executable HTML and routes stay inside the base', () => {
  const attack = '</script><script>alert("x")</script>\u2028&'; const data = content(); data.business.name = attack; data.faqs[0].answer = attack;
  const result = make({ content: data, slug: 'faq/', title: 'Titre " ><img src=x onerror=alert(1)>', description: attack });
  assert.equal((result.structuredData.match(/<script/g) || []).length, 1); assert.equal((result.structuredData.match(/<\/script>/g) || []).length, 1);
  assert.ok(!result.head.includes('<img')); assert.ok(!result.head.includes('<script>'));
  const parsed = JSON.parse(result.structuredData.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''));
  assert.equal(collectSchemaNodes(parsed).find(node => node['@type'] === 'BeautySalon').name, attack);
  for (const slug of ['../admin/', '/outside/', 'https://evil.example/', 'journal/%2e%2e/']) assert.throws(() => make({ slug }), /chemin relatif/);
  for (const siteUrl of ['javascript:alert(1)', 'https://user:secret@example.org/', 'https://example.org/?token=secret']) assert.throws(() => make({ siteUrl }), /HTTP/);
  assert.equal(make({ siteUrl: SITE.slice(0, -1), slug: 'contact' }).canonical, `${SITE}contact/`);
});

test('authorised sharing portrait has absolute Open Graph dimensions and a business image entity', () => {
  const data = content(); data.media = { photosAuthorized: true, shareImage: { path: 'assets/portrait.jpg', width: 1080, height: 1080, alt: 'Portrait de Nadège Becquet, facialiste' } };
  const result = make({ content: data, slug: 'journal/premiere-visite/' });
  assert.match(result.head, /property="og:image" content="https:\/\/example.com\/demo-facialiste\/assets\/portrait.jpg"/);
  assert.match(result.head, /property="og:image:width" content="1080"/); assert.match(result.head, /property="og:image:height" content="1080"/);
  assert.match(result.head, /property="og:image:alt" content="Portrait de Nadège Becquet, facialiste"/);
  const image = find(result, 'ImageObject'); assert.equal(image.contentUrl, `${SITE}assets/portrait.jpg`);
  assert.equal(find(result, 'BeautySalon').image['@id'], image['@id']);
  assert.equal(find(result, 'BlogPosting').image, undefined, 'The cabinet portrait is not an article-specific illustration.');
  data.media.photosAuthorized = false; assert.doesNotMatch(make({ content: data }).head, /og:image/); assert.equal(find(make({ content: data }), 'ImageObject'), undefined);
  delete data.media.photosAuthorized; assert.doesNotMatch(make({ content: data }).head, /og:image/);
});

test('authorised image paths cannot traverse directories or use remote URLs and alt text is escaped', () => {
  const data = content(); data.media = { photosAuthorized: true, shareImage: { path: 'assets/photo.jpg', width: 1080, height: 1080, alt: '"><img src=x onerror=alert(1)>' } };
  assert.ok(!make({ content: data }).head.includes('<img'));
  for (const imagePath of ['../secret.jpg', 'assets/../secret.jpg', 'assets/%2e%2e/secret.jpg', 'https://external.example/photo.jpg', '/assets/photo.jpg', 'assets/photo.jpg?secret=1', 'assets/sub\\photo.jpg', 'assets/logo.svg']) {
    data.media.shareImage.path = imagePath; assert.throws(() => make({ content: data }), /image locale/);
  }
  data.media.shareImage.path = 'assets/photo.jpg'; data.media.shareImage.width = -1; assert.throws(() => make({ content: data }), /dimension réelle/);
  data.media.shareImage.width = 1080; data.media.shareImage.alt = ''; assert.throws(() => make({ content: data }), /décrire l’image/);
});

test('export checker accepts a business in a separate script and rejects non-visible structured FAQ answers', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nb-seo-test-'));
  try {
    await fs.mkdir(path.join(root, 'scripts')); await fs.mkdir(path.join(root, 'data')); await fs.mkdir(path.join(root, 'dist/faq'), { recursive: true }); await fs.mkdir(path.join(root, 'dist/assets'));
    for (const file of ['seo.mjs', 'check.mjs']) await fs.copyFile(new URL(`../scripts/${file}`, import.meta.url), path.join(root, 'scripts', file));
    const data = content(); await fs.writeFile(path.join(root, 'data/content.json'), JSON.stringify(data));
    await fs.writeFile(path.join(root, 'dist/build-info.json'), JSON.stringify({ noindex: true, publicDemo: true, removalDate: data.demo.removalDate, expired: false }));
    await fs.writeFile(path.join(root, 'dist/.nojekyll'), ''); await fs.writeFile(path.join(root, 'dist/assets/itineraire.svg'), '<svg/>'); await fs.writeFile(path.join(root, 'dist/robots.txt'), 'User-agent: *\nAllow: /\n');
    for (const [route, file, title] of [['', 'index.html', 'Accueil'], ['404.html', '404.html', 'Page absente'], ['faq/', 'faq/index.html', 'Questions fréquentes']]) {
      const seo = make({ content: data, slug: route, title, description: `Description unique de ${title}.` });
      const nodes = seo.graph['@graph']; const schemas = `<script type="application/ld+json">${JSON.stringify(nodes[0])}</script><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes.slice(1) })}</script>`;
      const faqBody = route === 'faq/' ? `<h2>${escapeHtml(data.faqs[0].question)}</h2><p>${escapeHtml(data.faqs[0].answer)}</p>` : '';
      await fs.writeFile(path.join(root, 'dist', file), `<html lang="fr"><head>${seo.head}${schemas}</head><body><h1>${title}</h1>${faqBody}</body></html>`);
    }
    const command = [path.join(root, 'scripts/check.mjs')]; const options = { cwd: root, env: { ...process.env, SITE_URL: SITE } };
    const result = await exec(process.execPath, command, options); assert.match(result.stdout, /Export valide/);
    const faqFile = path.join(root, 'dist/faq/index.html'); let html = await fs.readFile(faqFile, 'utf8'); html = html.replace(`<p>${escapeHtml(data.faqs[0].answer)}</p>`, '<p>Réponse différente.</p>'); await fs.writeFile(faqFile, html);
    await assert.rejects(exec(process.execPath, command, options), error => /non visible/.test(error.stderr));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
