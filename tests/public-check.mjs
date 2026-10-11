import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

const base = process.env.PUBLIC_URL || 'https://connected-mate.github.io/nadege-becquet-preview/';
const content = JSON.parse(await fs.readFile('data/content.json', 'utf8'));
const portrait = content.media?.photosAuthorized === true ? content.media.shareImage : undefined;
const report = { checkedAt: new Date().toISOString(), base, checks: [], pageErrors: [], consoleErrors: [] };
const check = (name, passed, details = {}) => report.checks.push({ name, passed: Boolean(passed), ...details });
const routes = ['', 'soins/', ...content.services.map(s => `soins/${s.slug}/`), 'nadege/', 'galerie/', 'faq/', 'journal/', ...content.posts.map(p => `journal/${p.slug}/`), 'contact/', ...content.pages.map(p => `${p.slug}/`), '404.html'];
await fs.mkdir('artifacts', { recursive: true });
let browser;
try {
  await Promise.all(routes.map(async route => {
    const response = await fetch(new URL(route, base));
    const html = await response.text();
    check(`${route || '/'}: HTTP 200`, response.status === 200);
    check(`${route || '/'}: noindex et popup`, html.includes('noindex,nofollow,noarchive') && html.includes('id="demo-dialog"'));
    check(`${route || '/'}: réservation téléphone`, html.includes('tel:+33683493034'));
    check(`${route || '/'}: canonique exacte`, html.includes(`<link rel="canonical" href="${new URL(route, base).href}">`));
  }));
  const publicFiles = [...(portrait ? [portrait.path] : []), ...(content.media?.photosAuthorized ? ['assets/reference-nadege.jpg'] : []), 'styles.css', 'app.js'];
  for (const file of [...new Set(publicFiles)]) {
    const response = await fetch(new URL(file, base));
    const remote = Buffer.from(await response.arrayBuffer());
    const local = await fs.readFile(`dist/${file}`);
    const hash = buffer => createHash('sha256').update(buffer).digest('hex');
    check(`${file}: fichier identique à l’export`, response.ok && hash(remote) === hash(local));
  }
  const retiredPortrait = await fetch(new URL('assets/photo-nadege-portrait-noir-blanc.jpg', base));
  check('ancien portrait noir et blanc retiré du site public', retiredPortrait.status === 404);
  for (const route of ['admin/', 'api/content']) {
    const response = await fetch(new URL(route, base));
    check(`${route}: administration absente du site public`, response.status === 404);
  }
  const info = await (await fetch(new URL('build-info.json', base))).json();
  check('manifeste final : photos autorisées, 20 pages, retrait le 11 novembre', info.photosAuthorized === true && info.pages === 20 && info.removalDate === '2026-11-11' && info.noindex === true && !info.expired);
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  await page.goto(base, { waitUntil: 'networkidle' });
  check('popup distante visible', await page.locator('#demo-dialog').isVisible());
  await page.keyboard.press('Escape');
  check('nouvel accueil public', /Le soin du visage/.test(await page.locator('h1').innerText()));
  if (portrait) {
    const loaded = await page.locator('.hero-image img').evaluate(image => ({ complete: image.complete, width: image.naturalWidth, height: image.naturalHeight, src: image.src, alt: image.alt }));
    check('portrait configuré chargé avec ses dimensions exactes', loaded.complete && loaded.width === portrait.width && loaded.height === portrait.height && loaded.src === new URL(portrait.path, base).href && loaded.alt === portrait.alt, { loaded });
    const aboutPortrait = await page.locator('.about-photo-small img').getAttribute('src');
    check('portrait de présentation issu du même fichier, sans recadrage de capture', new URL(aboutPortrait, base).href === new URL(portrait.path, base).href && await page.locator('.about-photo-small .reference-crop').count() === 0);
  } else check('emplacement de remplacement sans portrait autorisé', await page.locator('.hero-image .photo-placeholder').count() === 1 && await page.locator('.hero-image img').count() === 0);
  check('Manrope chargée', await page.evaluate(() => document.fonts.check('15px Manrope')));
  await page.screenshot({ path: 'artifacts/public-desktop.png', fullPage: true });
  if (portrait) {
    await page.goto(new URL('galerie/', base).href, { waitUntil: 'networkidle' });
    const galleryPortrait = await page.locator('.gallery figure').first().locator('img').evaluate(image => ({ src: image.src, width: Number(image.getAttribute('width')), height: Number(image.getAttribute('height')), alt: image.alt }));
    check('portrait de galerie issu du fichier configuré', galleryPortrait.src === new URL(portrait.path, base).href && galleryPortrait.width === portrait.width && galleryPortrait.height === portrait.height && galleryPortrait.alt === portrait.alt, { galleryPortrait });
  }
  await page.locator('#main-nav a[href$="contact/"]').click();
  check('navigation contact depuis le site public', page.url() === new URL('contact/', base).href);
  check('numéro public exact', await page.locator('.phone-link').getAttribute('href') === 'tel:+33683493034');
  await page.goto(new URL('journal/', base).href);
  check('six articles accessibles', await page.locator('.journal-all .journal-card').count() === 6);
  await page.locator('.journal-all .journal-card').first().click();
  check('article publié avec sources', await page.locator('.article-source a').count() >= 1 && await page.locator('.article-meta time').count() >= 1);
} catch (error) {
  check('exécution complète', false, { error: error.stack });
} finally {
  await browser?.close();
  report.summary = { total: report.checks.length, passed: report.checks.filter(c => c.passed).length, failed: report.checks.filter(c => !c.passed).length, pageErrors: report.pageErrors.length, consoleErrors: report.consoleErrors.length };
  await fs.writeFile('artifacts/public-check.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ summary: report.summary, failed: report.checks.filter(c => !c.passed), pageErrors: report.pageErrors, consoleErrors: report.consoleErrors }, null, 2));
  process.exitCode = report.summary.failed || report.pageErrors.length || report.consoleErrors.length ? 1 : 0;
}
