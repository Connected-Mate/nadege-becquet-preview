import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const origin = process.env.PREVIEW_URL || 'http://localhost:4173';
const artifacts = path.resolve('artifacts');
await fs.mkdir(artifacts, { recursive: true });
const report = { checkedAt: new Date().toISOString(), origin, browser: 'Chromium / Google Chrome headless', checks: [], consoleErrors: [], pageErrors: [], accessibility: [], screenshots: [], notes: ['Vérifications automatisées : elles ne remplacent pas un audit RGAA complet ou des essais avec des utilisateurs de lecteurs d’écran.', 'Aucun appel, message ou rendez-vous réel déclenché. Les liens de navigation externe sont contrôlés par leur URL.'] };
const check = (name, passed, detail = {}) => report.checks.push({ name, passed: Boolean(passed), ...detail });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const links = new Set(['/']);

try {
  for (const [label, width, height] of [['desktop', 1440, 1000], ['tablet', 768, 1024], ['mobile', 390, 844], ['small-mobile', 320, 740]]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('console', msg => { if (msg.type() === 'error') report.consoleErrors.push({ viewport: label, url: page.url(), message: msg.text() }); });
    page.on('pageerror', error => report.pageErrors.push({ viewport: label, url: page.url(), message: error.message }));
    const googleRequests = [];
    page.on('request', request => { if (/maps\.google|google\.com\/maps/.test(request.url())) googleRequests.push(request.url()); });

    let response = await page.goto(origin, { waitUntil: 'networkidle' });
    check(`${label}: accueil HTTP 200`, response?.status() === 200);
    check(`${label}: popup initiale visible`, await page.locator('#demo-dialog').isVisible());
    const initialFocusInside = await page.evaluate(() => document.querySelector('#demo-dialog')?.contains(document.activeElement));
    check(`${label}: focus initial dans la popup`, initialFocusInside);
    const popupCollision = await page.evaluate(() => { const a=document.querySelector('.dialog-close').getBoundingClientRect(), range=document.createRange(); range.selectNodeContents(document.querySelector('dialog .eyebrow')); const lines=[...range.getClientRects()]; return { overlap:lines.some(b => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top), button:a.toJSON(), eyebrow:lines.map(b => b.toJSON()) }; });
    check(`${label}: bouton fermer sans collision avec le texte`, !popupCollision.overlap, popupCollision);
    const popupAxe = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
    report.accessibility.push({ viewport:label, pathname:'/#demo-dialog', violations:popupAxe.violations.map(v => ({ id:v.id, impact:v.impact, nodes:v.nodes.map(n=>({target:n.target,failureSummary:n.failureSummary})) })) });
    check(`${label}: axe popup WCAG A/AA`, popupAxe.violations.length === 0);
    const popupScreenshot = `artifacts/${label}-popup.png`;
    await page.screenshot({ path: popupScreenshot });
    report.screenshots.push(popupScreenshot);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    check(`${label}: Tab reste dans la popup`, await page.evaluate(() => document.querySelector('#demo-dialog')?.contains(document.activeElement)));
    await page.keyboard.press('Escape');
    check(`${label}: Escape ferme la popup`, !(await page.locator('#demo-dialog').isVisible()));
    const reopen = page.locator('[data-demo-open]').first();
    await reopen.click();
    check(`${label}: réouverture de la popup`, await page.locator('#demo-dialog').isVisible());
    await page.keyboard.press('Escape');
    check(`${label}: restitution du focus au bouton`, await reopen.evaluate(el => el === document.activeElement));
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    await page.keyboard.press('Control+Home');
    await page.locator('.skip-link').focus();
    check(`${label}: lien d’évitement visible au clavier`, await page.locator('.skip-link').evaluate(el => { const r=el.getBoundingClientRect(); return r.top >= 0 && r.left >= 0 && getComputedStyle(el).visibility !== 'hidden'; }));
    await page.keyboard.press('Enter');
    check(`${label}: lien d’évitement cible le contenu`, page.url().endsWith('#contenu'));

    if (await page.locator('.menu-toggle').isVisible()) {
      await page.locator('.menu-toggle').click();
      check(`${label}: ouverture menu`, await page.locator('.menu-toggle').getAttribute('aria-expanded') === 'true' && await page.locator('#main-nav').isVisible());
      await page.keyboard.press('Escape');
      check(`${label}: Escape ferme le menu et restitue le focus`, await page.locator('.menu-toggle').getAttribute('aria-expanded') === 'false' && await page.locator('.menu-toggle').evaluate(el => el === document.activeElement));
      await page.locator('.menu-toggle').click();
      await page.locator('#main-nav a').filter({ hasText: 'Les soins' }).click();
      await page.waitForURL('**/soins/');
      check(`${label}: navigation par le menu`, page.url().endsWith('/soins/'));
      check(`${label}: popup mémorisée pour la session`, !(await page.locator('#demo-dialog').isVisible()));
      await page.goto(origin, { waitUntil: 'networkidle' });
    } else {
      await page.locator('#main-nav a').filter({ hasText: 'Les soins' }).click();
      await page.waitForURL('**/soins/');
      check(`${label}: navigation par le menu`, page.url().endsWith('/soins/'));
      await page.goto(origin, { waitUntil: 'networkidle' });
    }

    const summaries = page.locator('.faq-list summary');
    await summaries.first().focus();
    await page.keyboard.press('Enter');
    check(`${label}: FAQ ouvrable au clavier`, await page.locator('.faq-list details').first().evaluate(el => el.open));
    await page.keyboard.press('Space');
    check(`${label}: FAQ refermable au clavier`, !(await page.locator('.faq-list details').first().evaluate(el => el.open)));

    for (const href of await page.locator('a[href]').evaluateAll(els => els.map(el => el.href))) {
      const url = new URL(href);
      if (url.origin === origin && !url.pathname.match(/\.[a-z]+$/i)) links.add(url.pathname);
    }

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `artifacts/${label}-home.png`, fullPage: true });
    report.screenshots.push(`artifacts/${label}-home.png`);

    for (const pathname of ['/', '/soins/', '/nadege/', '/galerie/', '/faq/', '/journal/', '/contact/', '/sources/', '/mentions-legales/', '/confidentialite/']) {
      response = await page.goto(origin + pathname, { waitUntil: 'networkidle' });
      check(`${label}: page ${pathname}`, response?.status() === 200);
      const overflow = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll('body *')].filter(el => { const r=el.getBoundingClientRect(); const s=getComputedStyle(el); return r.width > 0 && s.visibility !== 'hidden' && s.display !== 'none' && (r.right > innerWidth + 1 || r.left < -1) && !el.closest('.portrait,.reference-crop,.gallery-image,.about-art,.service-visual,.cta-band'); }).map(el => ({ tag: el.tagName, class: el.className, width: Math.round(el.getBoundingClientRect().width) })).slice(0, 10) }));
      check(`${label}: aucun débordement horizontal ${pathname}`, overflow.scrollWidth <= width + 1, overflow);
      check(`${label}: un titre principal ${pathname}`, await page.locator('h1').count() === 1);
      check(`${label}: noindex ${pathname}`, (await page.locator('meta[name=robots]').getAttribute('content'))?.includes('noindex'));
      if (pathname === '/') {
        const hero = await page.locator('.hero-image .portrait').boundingBox();
        check(`${label}: visuel principal conserve sa hauteur`, hero?.height >= 240 && hero?.width >= 200, { hero });
      }
      if (pathname === '/galerie/') {
        const visuals = await page.locator('.gallery figure').evaluateAll(els => els.map(el => { const r=el.getBoundingClientRect(); return {width:r.width,height:r.height}; }));
        check(`${label}: trois visuels de galerie lisibles`, visuals.length === 3 && visuals.every(r => r.width >= 200 && r.height >= 200), { visuals });
        await page.screenshot({ path:`artifacts/${label}-gallery.png`, fullPage:true });
        report.screenshots.push(`artifacts/${label}-gallery.png`);
      }
      if (label === 'desktop' || pathname === '/' || pathname === '/contact/') {
        const axe = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
        report.accessibility.push({ viewport: label, pathname, violations: axe.violations.map(v => ({ id:v.id, impact:v.impact, description:v.description, helpUrl:v.helpUrl, nodes:v.nodes.map(n => ({ target:n.target, failureSummary:n.failureSummary })) })) });
        check(`${label}: axe WCAG A/AA ${pathname}`, axe.violations.length === 0, { violations: axe.violations.map(v => v.id) });
      }
      for (const href of await page.locator('a[href]').evaluateAll(els => els.map(el => el.href))) {
        const url = new URL(href);
        if (url.origin === origin && !url.pathname.match(/\.[a-z]+$/i)) links.add(url.pathname);
      }
    }

    await page.goto(origin + '/contact/', { waitUntil: 'networkidle' });
    check(`${label}: tous les liens téléphoniques exacts`, await page.locator('a[href^="tel:"]').evaluateAll(els => els.length > 0 && els.every(el => el.getAttribute('href') === 'tel:+33683493034')));
    for (const [name, part] of [['Google Maps', 'google.com/maps/dir/'], ['Waze', 'waze.com/ul'], ['Apple Plans', 'maps.apple.com/']]) {
      const hrefs = await page.locator('a[href]').evaluateAll(els => els.map(el => el.href));
      const href = hrefs.find(x => x.includes(part));
      check(`${label}: lien ${name} avec adresse`, !!href && /160(?:\+|%20| )rue(?:\+|%20| )Grande/i.test(href), { href });
    }
    check(`${label}: aucune iframe avant consentement carte`, await page.locator('#map-slot iframe').count() === 0);
    check(`${label}: aucune requête carte avant consentement`, googleRequests.length === 0);
    await page.locator('#load-map').click();
    await page.waitForFunction(() => document.querySelector('#map-slot iframe')?.getAttribute('src')?.includes('maps.google.com'));
    check(`${label}: iframe après consentement`, await page.locator('#map-slot iframe').count() === 1);
    check(`${label}: iframe possède un titre`, Boolean(await page.locator('#map-slot iframe').getAttribute('title')));
    await page.screenshot({ path: `artifacts/${label}-contact.png`, fullPage: true });
    report.screenshots.push(`artifacts/${label}-contact.png`);
    await context.close();
  }

  const context = await browser.newContext();
  for (const pathname of [...links].sort()) {
    const response = await context.request.get(origin + pathname);
    check(`lien interne ${pathname}`, response.status() === 200, { status: response.status() });
  }
  await context.close();
} catch (error) {
  check('exécution complète du scénario', false, { error: error.stack });
} finally {
  await browser.close();
  report.summary = { total: report.checks.length, passed: report.checks.filter(c => c.passed).length, failed: report.checks.filter(c => !c.passed).length, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, accessibilityViolations: report.accessibility.reduce((sum, a) => sum + a.violations.length, 0) };
  await fs.writeFile(path.join(artifacts, 'browser-check.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ summary: report.summary, failed: report.checks.filter(c => !c.passed), consoleErrors: report.consoleErrors, pageErrors: report.pageErrors }, null, 2));
  process.exitCode = report.summary.failed || report.pageErrors.length || report.consoleErrors.length ? 1 : 0;
}
