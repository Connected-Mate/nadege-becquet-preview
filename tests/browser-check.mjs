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
const content = JSON.parse(await fs.readFile('data/content.json', 'utf8'));
const articles = content.posts.map(post => `/journal/${post.slug}/`);
const treatments = content.services.map(service => `/soins/${service.slug}/`);
const metadata = [];
let redactedSecret = '';
const emojiPattern = /\p{Emoji_Presentation}|\p{Regional_Indicator}|[\uFE0F\u20E3]/gu;
async function checkNoEmoji(page, name) {
  const text = await page.locator('body').innerText();
  const emoji = [...new Set(text.match(emojiPattern) || [])];
  check(name, emoji.length === 0, { emoji });
}
async function checkAxe(page, label, pathname) {
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
  report.accessibility.push({ viewport: label, pathname, violations: axe.violations.map(v => ({ id:v.id, impact:v.impact, description:v.description, helpUrl:v.helpUrl, nodes:v.nodes.map(n => ({ target:n.target, failureSummary:n.failureSummary })) })) });
  check(`${label}: axe WCAG A/AA ${pathname}`, axe.violations.length === 0, { violations: axe.violations.map(v => v.id) });
}

try {
  for (const [label, width, height] of [['desktop', 1440, 1000], ['tablet', 768, 1024], ['mobile', 390, 844], ['small-mobile', 320, 740]]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] });
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

    for (const pathname of ['/', '/soins/', ...treatments, '/nadege/', '/galerie/', '/faq/', '/journal/', ...articles, '/contact/', '/sources/', '/mentions-legales/', '/confidentialite/']) {
      response = await page.goto(origin + pathname, { waitUntil: 'networkidle' });
      check(`${label}: page ${pathname}`, response?.status() === 200);
      const overflow = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll('body *')].filter(el => { const r=el.getBoundingClientRect(); const s=getComputedStyle(el); return r.width > 0 && s.visibility !== 'hidden' && s.display !== 'none' && (r.right > innerWidth + 1 || r.left < -1) && !el.closest('.portrait,.reference-crop,.gallery-image,.about-art,.service-visual,.cta-band'); }).map(el => ({ tag: el.tagName, class: el.className, width: Math.round(el.getBoundingClientRect().width) })).slice(0, 10) }));
      check(`${label}: aucun débordement horizontal ${pathname}`, overflow.scrollWidth <= width + 1, overflow);
      check(`${label}: un titre principal ${pathname}`, await page.locator('h1').count() === 1);
      check(`${label}: noindex ${pathname}`, (await page.locator('meta[name=robots]').getAttribute('content'))?.includes('noindex'));
      await checkNoEmoji(page, `${label}: aucun emoji public ${pathname}`);
      check(`${label}: téléphone exact ${pathname}`, await page.locator('a[href^="tel:"]').evaluateAll(els => els.length > 0 && els.every(el => el.getAttribute('href') === 'tel:+33683493034')));
      check(`${label}: adresse dans le pied de page ${pathname}`, /160 rue Grande\s+77300 Fontainebleau/.test((await page.locator('footer address').innerText()).replace(/\s+/g, ' ')));
      const primaryCalls = await page.locator('a.button').evaluateAll(els => els.filter(el => /réserver|rendez-vous|appeler/i.test(el.textContent)).map(el => ({text:el.textContent,href:el.getAttribute('href')})));
      check(`${label}: réservation par appel direct ${pathname}`, primaryCalls.length > 0 && primaryCalls.every(link => link.href === 'tel:+33683493034'), { primaryCalls });
      check(`${label}: images chargées ${pathname}`, await page.locator('img').evaluateAll(imgs => imgs.every(img => img.complete ? img.naturalWidth > 0 : img.loading === 'lazy')));
      if (label === 'desktop') metadata.push({ pathname, title:await page.title(), description:await page.locator('meta[name=description]').getAttribute('content'), canonical:await page.locator('link[rel=canonical]').getAttribute('href') });
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
      if (pathname === '/journal/') check(`${label}: six articles accessibles depuis le journal`, await page.locator('.journal-all .journal-card').count() === 6);
      if (articles.includes(pathname)) {
        const article = await page.evaluate(() => {
          const flatten = item => Array.isArray(item) ? item.flatMap(flatten) : item?.['@graph'] ? flatten(item['@graph']) : [item];
          const nodes = [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap(s => flatten(JSON.parse(s.textContent)));
          const posting = nodes.find(n => n?.['@type'] === 'BlogPosting');
          const sources = [...document.querySelectorAll('.article-source a')].map(a=>a.href);
          const toc = [...document.querySelectorAll('.article-sidebar nav a')].map(a=>({href:a.getAttribute('href'),exists:!!document.getElementById(a.hash.slice(1))}));
          return { posting, sources, toc, author:document.querySelector('.article-meta')?.textContent, date:document.querySelector('.article-meta time')?.getAttribute('datetime'), dates:[...document.querySelectorAll('.article-meta time')].map(el => el.getAttribute('datetime')), paragraphs:document.querySelectorAll('article.article>p').length };
        });
        check(`${label}: article sourcé ${pathname}`, article.sources.length >= 2 && article.sources.every(url => url.startsWith('https://')), { sources:article.sources });
        check(`${label}: métadonnées visibles de l’article ${pathname}`, article.author?.includes('Rédaction de la démonstration') && article.author.includes('min de lecture') && !!article.date, { author:article.author, date:article.date });
        check(`${label}: BlogPosting cohérent ${pathname}`, !!article.posting && article.posting.citation?.length === article.sources.length && [article.posting.datePublished, article.posting.dateModified].filter(Boolean).every(date => article.dates.includes(date)) && article.posting.headline === (await page.locator('h1').innerText()), { schema:article.posting });
        check(`${label}: sommaire ancré ${pathname}`, article.toc.length > 0 && article.toc.every(item => item.exists), { toc:article.toc });
        check(`${label}: article développé ${pathname}`, article.paragraphs >= 3, { paragraphs:article.paragraphs });
        if (pathname === articles[0]) {
          const link = page.locator('.article-sidebar nav a').first();
          const target = await link.getAttribute('href');
          await link.click();
          check(`${label}: navigation du sommaire`, page.url().endsWith(target));
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({ path:`artifacts/${label}-article.png`, fullPage:true });
          report.screenshots.push(`artifacts/${label}-article.png`);
        }
      }
      if (label === 'desktop' || pathname === '/' || pathname === '/contact/' || (label === 'small-mobile' && articles.includes(pathname))) {
        await checkAxe(page, label, pathname);
      }
      for (const href of await page.locator('a[href]').evaluateAll(els => els.map(el => el.href))) {
        const url = new URL(href);
        if (url.origin === origin && !url.pathname.match(/\.[a-z]+$/i)) links.add(url.pathname);
      }
    }

    await page.goto(origin + '/contact/', { waitUntil: 'networkidle' });
    await page.locator('[data-copy-phone]').click();
    await page.waitForFunction(() => document.querySelector('.copy-status')?.textContent === 'Numéro copié.');
    check(`${label}: copie réelle du téléphone`, await page.evaluate(() => navigator.clipboard.readText()) === '06 83 49 30 34');
    check(`${label}: confirmation de copie accessible`, await page.locator('.copy-status').getAttribute('role') === 'status');
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

  check('six articles détaillés contrôlés', articles.length === 6, { articles });
  check('titres uniques', new Set(metadata.map(m=>m.title)).size === metadata.length);
  check('descriptions uniques', new Set(metadata.map(m=>m.description)).size === metadata.length);
  check('URL canoniques uniques', new Set(metadata.map(m=>m.canonical)).size === metadata.length);
  report.metadata = metadata;

  const accessFile = await fs.readFile('.local/admin-access.txt','utf8');
  const localPassword = accessFile.match(/^Mot de passe : (.+)$/m)?.[1];
  if (!localPassword) throw new Error('Le fichier local ne contient pas de mot de passe exploitable pour le contrôle admin.');
  redactedSecret = localPassword;
  for (const [label,width,height] of [['desktop',1440,1000],['tablet',768,1024],['mobile',390,844],['small-mobile',320,740]]) {
    const context = await browser.newContext({ viewport:{width,height}, reducedMotion:'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => report.pageErrors.push({ viewport:`admin-${label}`,url:page.url(),message:error.message }));
    await page.goto(origin+'/admin/',{waitUntil:'networkidle'});
    await checkNoEmoji(page, `${label}: aucun emoji administration connexion`);
    await checkAxe(page, label, '/admin/login');
    check(`${label}: administration connexion sans débordement`, await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1));
    await page.locator('#password').fill(localPassword);
    await page.locator('#login-form button').click();
    await page.locator('#workspace').waitFor({state:'visible'});
    for (const section of ['home','business','services','about','faqs','posts','pages','demo','advanced','history','publish']) {
      await page.locator(`#section-nav [data-section="${section}"]`).click();
      await page.waitForFunction(section=>document.querySelector(`#section-nav [data-section="${section}"]`)?.getAttribute('aria-current')==='page',section);
      await checkNoEmoji(page, `${label}: aucun emoji administration ${section}`);
      check(`${label}: administration ${section} sans débordement`, await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1));
      if (label === 'desktop' || (label === 'small-mobile' && ['home','posts','publish'].includes(section))) await checkAxe(page, label, `/admin/${section}`);
      if (section === 'posts') check(`${label}: six articles dans l’administration`, await page.locator('#editor .editor-card').count() === 6);
    }
    await page.screenshot({path:`artifacts/${label}-admin.png`,fullPage:true});
    report.screenshots.push(`artifacts/${label}-admin.png`);
    await page.locator('#logout').click();
    await page.locator('#login').waitFor({state:'visible'});
    check(`${label}: déconnexion administration`, await page.locator('#login').isVisible());
    await context.close();
  }

  const context = await browser.newContext();
  for (const pathname of [...links].sort()) {
    const response = await context.request.get(origin + pathname);
    check(`lien interne ${pathname}`, response.status() === 200, { status: response.status() });
  }
  await context.close();
} catch (error) {
  check('exécution complète du scénario', false, { error: redactedSecret ? String(error.stack).replaceAll(redactedSecret, '[secret local masqué]') : error.stack });
} finally {
  await browser.close();
  report.summary = { total: report.checks.length, passed: report.checks.filter(c => c.passed).length, failed: report.checks.filter(c => !c.passed).length, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, accessibilityViolations: report.accessibility.reduce((sum, a) => sum + a.violations.length, 0) };
  await fs.writeFile(path.join(artifacts, 'browser-check.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ summary: report.summary, failed: report.checks.filter(c => !c.passed), consoleErrors: report.consoleErrors, pageErrors: report.pageErrors }, null, 2));
  process.exitCode = report.summary.failed || report.pageErrors.length || report.consoleErrors.length ? 1 : 0;
}
