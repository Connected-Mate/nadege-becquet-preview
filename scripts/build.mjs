import fs from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';
import { createSeo, DEMO_AUTHOR, validDate } from './seo.mjs';

const root = process.cwd();
const c = JSON.parse(await fs.readFile(path.join(root, 'data/content.json'), 'utf8'));
const out = path.join(root, 'dist');
const site = process.env.SITE_URL || 'https://connected-mate.github.io/nadege-becquet-preview/';
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const phone = c.business.phone.replace(/[^+\d]/g, '').replace(/^0/, '+33');
const address = `${c.business.address}, ${c.business.postalCode} ${c.business.city}`;
const maps = {
  google: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`,
  waze: `https://www.waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`,
  apple: `https://maps.apple.com/?daddr=${encodeURIComponent(address)}`,
};
const date = c.demo.removalDate;
const dateLabel = date ? new Intl.DateTimeFormat('fr-FR', {day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Paris'}).format(new Date(`${date}T12:00:00Z`)) : 'date à confirmer';
const buildTime = process.env.BUILD_TIME ? Date.parse(process.env.BUILD_TIME) : Date.now();
const expired = Boolean(date && new Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(buildTime)) >= date);
const photosAllowed = c.media?.photosAuthorized === true;
const portraitImage = photosAllowed ? c.media?.shareImage : undefined;
const sourceSite = 'https://pole-sante-sport-fontainebleau.fr/faciale.html';
const sourceSchool = 'https://www.ecoledukobido.com/praticiens-certifies/becquet-nad%C3%A8ge';
const baseFor = slug => slug === '404.html' ? '' : '../'.repeat(slug.split('/').filter(Boolean).length);
const text = value => String(value ?? '').replaceAll('{{phone}}', c.business.phone).replaceAll('{{address}}', address).replaceAll('{{name}}', c.business.name).replaceAll('{{retirementDate}}', dateLabel);
const safeUrl = value => { try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) ? url.href : null; } catch { return null; } };
const external = (url, label) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
function inline(value) {
  const pieces = []; let start = 0;
  const source = text(value);
  for (const match of source.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s]+)\)/g)) {
    pieces.push(esc(source.slice(start, match.index)));
    const url = safeUrl(match[2]);
    pieces.push(url ? external(url, match[1]) : esc(match[0]));
    start = match.index + match[0].length;
  }
  pieces.push(esc(source.slice(start)));
  return pieces.join('');
}
function richText(value) {
  const source = text(value); let headingIndex = 0;
  return source.split(/\n\s*\n/).map(block => {
    const trimmed = block.trim();
    if (trimmed.startsWith('## ')) return `<h2 id="section-${++headingIndex}">${inline(trimmed.slice(3))}</h2>`;
    if (trimmed.split('\n').every(line => line.startsWith('- '))) return `<ul>${trimmed.split('\n').map(line => `<li>${inline(line.slice(2))}</li>`).join('')}</ul>`;
    return `<p>${inline(trimmed)}</p>`;
  }).join('');
}
function legalBody(value) {
  if (value.includes('## ')) return richText(value);
  return text(value).split(/\n\n/).map(block => {
    if (block.length < 85 && !/[.:]/.test(block)) return `<h2>${esc(block)}</h2>`;
    const formatted = block.replace(/([^\n()]+?)\s*\((https?:\/\/[^\s]+)\)/g, (_,label,url) => `[${label.trim()}](${url})`);
    return `<p>${inline(formatted)}</p>`;
  }).join('');
}
const titleLines = value => value.split('\n').map((line, i) => i ? `<em>${esc(line)}</em>` : esc(line)).join('<br>');
const appointment = (label = 'Appeler pour réserver', className = '') => `<a class="button ${className}" href="tel:${phone}">${esc(label)}</a>`;
function photo(base, kind = 'portrait', priority = false) {
  const isPortrait = kind === 'portrait' || kind === 'smile';
  if (!photosAllowed || (isPortrait && !portraitImage)) return `<div class="portrait photo-placeholder${kind === 'smile' ? ' photo-smile' : ''}" role="img" aria-label="Emplacement du portrait"><span>${esc(c.business.name)}</span></div>`;
  if (isPortrait) return `<div class="portrait photo-hd${kind === 'smile' ? ' photo-smile' : ''}"><img src="${base}${esc(portraitImage.path)}" alt="${esc(portraitImage.alt)}" width="${esc(portraitImage.width)}" height="${esc(portraitImage.height)}" ${priority ? 'fetchpriority="high"' : 'loading="lazy"'}></div>`;
  const alt = {gua:'Outil de Gua Sha présenté par Nadège',flowers:'Fleurs et plaque de Nadège Becquet'}[kind];
  return `<div class="reference-crop crop-${kind}"><img src="${base}assets/reference-nadege.jpg" alt="${esc(alt)}" width="589" height="1280" loading="lazy"></div>`;
}
function pageHeading(eyebrow, title, intro = '') {
  return `<section class="page-heading wrap"><span class="eyebrow">${esc(eyebrow)}</span><h1>${title}</h1>${intro ? `<p>${esc(intro)}</p>` : ''}</section>`;
}
function serviceCard(service, index, base) {
  return `<a class="service-card" href="${base}soins/${esc(service.slug)}/"><span class="service-index">${String(index + 1).padStart(2,'0')}</span><div><h3>${esc(service.title)}</h3><p>${esc(service.summary)}</p><span class="text-link">Découvrir ce soin</span></div></a>`;
}
function faqList(items = c.faqs) {
  return `<div class="faq-list">${items.map(item => `<details><summary><span>${esc(text(item.question))}</span><span class="faq-toggle" aria-hidden="true"></span></summary><p>${esc(text(item.answer))}</p></details>`).join('')}</div>`;
}
function appointmentBlock(base) {
  return `<section class="appointment-band wrap"><div><span class="eyebrow">SUR RENDEZ-VOUS À ${esc(c.business.city.toUpperCase())}</span><h2>Votre prochain<br><em>rendez-vous.</em></h2></div><div class="appointment-action"><a class="appointment-number" href="tel:${phone}">${esc(c.business.phone)}</a><p>Un appel pour choisir votre soin et votre créneau.</p>${appointment()}<a class="text-link" href="${base}contact/#acces">${esc(c.business.address)}, ${esc(c.business.city)}</a></div></section>`;
}
function practicalBar() {
  return `<section class="practical-bar wrap" aria-label="Informations pratiques"><a href="tel:${phone}"><span class="eyebrow">RÉSERVER PAR TÉLÉPHONE</span><strong>${esc(c.business.phone)}</strong></a><a href="${maps.google}" target="_blank" rel="noopener noreferrer"><span class="eyebrow">LE CABINET</span><strong>${esc(c.business.address)}</strong><span>${esc(c.business.postalCode)} ${esc(c.business.city)}</span></a><a href="${sourceSchool}" target="_blank" rel="noopener noreferrer"><span class="eyebrow">LE SAVOIR-FAIRE</span><strong>Authentique Kobido®</strong><span>Référencée par l’École du Kobido</span></a></section>`;
}
function postCard(post, index, base) {
  const category = post.category || 'Conseils pratiques';
  return `<a class="journal-card" href="${base}journal/${esc(post.slug)}/"><span class="eyebrow">${esc(category)}</span><h3>${esc(post.title)}</h3><p>${esc(post.excerpt)}</p><span class="text-link">Lire l’article</span></a>`;
}
function layout(route) {
  const { slug, title, description, body, post, service } = route;
  const base = baseFor(slug);
  const active = path => slug === path || (path === 'journal/' && slug.startsWith(path)) || (path === 'soins/' && slug.startsWith(path)) ? ' aria-current="page"' : '';
  const seo = createSeo({content:c,slug,title,description,siteUrl:site,post,service,isDemo:true});
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${seo.head}
<meta name="theme-color" content="#502e36"><link rel="icon" href="${base}assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${base}styles.css">${seo.structuredData}<script defer src="${base}app.js"></script>
</head>
<body data-removal-date="${esc(date || '')}" data-base="${base}">
<a class="skip-link" href="#contenu">Aller au contenu</a>
<div class="demo-strip"><span>DÉMONSTRATION PUBLIQUE</span><button type="button" data-demo-open>À propos de cette version</button></div>
<header class="site-header wrap">
<a class="brand" href="${base || './'}" aria-label="${esc(c.business.name)}, accueil">${esc(c.business.name)}<span>FACIALISTE À ${esc(c.business.city.toUpperCase())}</span></a>
<button class="menu-toggle" type="button" aria-expanded="false" aria-controls="main-nav">Menu</button>
<nav id="main-nav" aria-label="Navigation principale"><a href="${base}soins/"${active('soins/')}>Les soins</a><a href="${base}nadege/"${active('nadege/')}>Nadège</a><a href="${base}journal/"${active('journal/')}>Le journal</a><a href="${base}contact/"${active('contact/')}>Contact & accès</a>${appointment('Prendre rendez-vous','small')}</nav>
</header>
<main id="contenu" tabindex="-1">${body}</main>
<footer class="footer wrap">
<div class="footer-main"><div><a class="brand" href="${base || './'}">${esc(c.business.name)}<span>FACIALISTE À ${esc(c.business.city.toUpperCase())}</span></a><p>Le soin du visage.<br>Le temps pour soi.</p></div>
<div><span class="eyebrow">RENDEZ-VOUS & ADRESSE</span><a class="footer-phone" href="tel:${phone}">${esc(c.business.phone)}</a><address>${esc(c.business.address)}<br>${esc(c.business.postalCode)} ${esc(c.business.city)}</address><p>${esc(c.business.appointmentNote)}</p></div>
<nav aria-label="Découvrir"><span class="eyebrow">DÉCOUVRIR</span><a href="${base}soins/">Les soins</a><a href="${base}galerie/">Les photographies</a><a href="${base}journal/">Le journal</a><a href="${base}faq/">Questions fréquentes</a></nav>
<nav aria-label="Informations"><span class="eyebrow">INFORMATIONS</span><a href="${base}contact/">Contact & accès</a><a href="${base}sources/">Sources des informations</a><a href="${base}mentions-legales/">Mentions légales</a><a href="${base}confidentialite/">Confidentialité</a></nav></div>
<div class="footer-bottom"><span>© 2026 ${esc(c.business.name)} · Proposition de site</span><span>Démo publique · Fin le ${esc(dateLabel)}</span></div>
</footer>
<a class="mobile-call" href="tel:${phone}"><span>Prendre rendez-vous</span><strong>${esc(c.business.phone)}</strong></a>
<dialog id="demo-dialog" aria-labelledby="demo-title"><button class="dialog-close" data-demo-close>Fermer</button><span class="eyebrow">PROPOSITION DE SITE</span><h2 id="demo-title">Bienvenue.</h2><p>Cette démo présente le futur site de ${esc(c.business.name)}. Elle n’est pas encore le site officiel.</p><p>Son adresse est publique. Le site demande aux moteurs de ne pas l’indexer ; cela ne le rend pas privé.</p><p>Fin de présentation le <strong>${esc(dateLabel)}</strong>.</p><button class="button" data-demo-close>Découvrir le site</button></dialog>
</body></html>`;
}

const routes = [];
const add = (slug,title,description,body,extra={}) => routes.push({slug,title,description,body,...extra});
add('', `${c.business.name} — Facialiste & Kobido à ${c.business.city}`, `Massages du visage avec ${c.business.name} à ${c.business.city}. Kobido, Gua Sha, stretching et détente. Rendez-vous au ${c.business.phone}.`, `
<section class="hero wrap"><div class="hero-copy"><span class="eyebrow">${esc(c.home.eyebrow)}</span><h1>${titleLines(c.home.title)}</h1><p>${esc(c.home.description)}</p><div class="hero-actions">${appointment('Réserver par téléphone')}<a class="under-link" href="soins/">Découvrir les soins</a></div><a class="hero-phone" href="tel:${phone}">${esc(c.business.phone)}</a><a class="hero-address" href="contact/#acces">${esc(c.business.address)}, ${esc(c.business.city)}</a></div><figure class="hero-image">${photo('','portrait',true)}<figcaption><span>${esc(c.business.name)}</span><span>Facialiste</span></figcaption></figure></section>
${practicalBar()}
<section class="section wrap" id="soins"><div class="section-head"><div><span class="eyebrow">LES SOINS DU VISAGE</span><h2>À chaque envie,<br><em>son soin.</em></h2></div><p>Quatre approches du massage facial,<br>à découvrir avec Nadège.</p></div><div class="services-grid">${c.services.map((item,index)=>serviceCard(item,index,'')).join('')}</div></section>
<section class="about-section wrap"><div class="about-photo-small">${photo('','smile')}</div><div class="about-copy"><span class="eyebrow">VOTRE FACIALISTE</span><h2>Nadège Becquet.<br><em>Le soin par le geste.</em></h2>${richText(c.about.intro)}<a class="under-link" href="nadege/">Rencontrer Nadège</a></div></section>
<section class="section wrap"><div class="section-head"><div><span class="eyebrow">LE JOURNAL</span><h2>Mieux connaître<br><em>les soins du visage.</em></h2></div><a class="under-link" href="journal/">Tous les articles</a></div><div class="journal-grid">${c.posts.slice(0,3).map((post,index)=>postCard(post,index,'')).join('')}</div></section>
<section class="section faq-section wrap"><div><span class="eyebrow">LES REPÈRES ESSENTIELS</span><h2>Avant de<br><em>venir.</em></h2><a class="under-link" href="faq/">Toutes les réponses</a></div>${faqList(c.faqs.slice(0,3))}</section>
${appointmentBlock('')}`);

add('soins/', `Soins du visage à ${c.business.city} — ${c.business.name}`, `Découvrez les massages détente, japonais Kobi-do, Gua Sha et stretching facial de ${c.business.name} à ${c.business.city}.`, pageHeading('LES SOINS', 'L’art du<br><em>massage facial.</em>', 'Détente, Kobido, Gua Sha ou stretching : découvrez les soins avant de choisir votre rendez-vous.') + `<section class="wrap section compact"><div class="services-grid">${c.services.map((item,index)=>serviceCard(item,index,'../')).join('')}</div><p class="source-note">Les durées et tarifs sont communiqués lors de la prise de contact. Prestations documentées sur le ${external(sourceSite,'site du Pôle Santé Sport')}.</p></section>` + appointmentBlock('../'));
for (const service of c.services) {
  const relatedPosts = c.posts.filter(post => post.relatedServices?.includes(service.slug)).slice(0,2);
  add(`soins/${service.slug}/`,`${service.title} à ${c.business.city} — ${c.business.name}`,service.summary,
    pageHeading('MASSAGE DU VISAGE',esc(service.title),service.summary) +
    `<section class="service-detail wrap"><article class="prose">${richText(service.body)}<p class="source-note">Sources : ${(service.sources || [{title:'Pôle Santé Sport Fontainebleau',url:sourceSite}]).map(source=>external(source.url,source.title)).join(' ; ')}.</p>${relatedPosts.length ? `<div class="related-reading"><h2>Pour en savoir plus</h2>${relatedPosts.map(post=>`<a href="../../journal/${esc(post.slug)}/">${esc(post.title)}</a>`).join('')}</div>`:''}</article><aside class="booking-card"><span class="eyebrow">VOTRE RENDEZ-VOUS</span><h2>Parlons de<br><em>votre soin.</em></h2><p>Choix du soin, durée, tarif et disponibilités : un appel pour préparer votre visite.</p><a class="booking-number" href="tel:${phone}">${esc(c.business.phone)}</a>${appointment()}<address>${esc(c.business.address)}<br>${esc(c.business.postalCode)} ${esc(c.business.city)}</address><a class="text-link" href="../../contact/#acces">Préparer mon trajet</a></aside></section>
<section class="section wrap related-section"><span class="eyebrow">LES AUTRES SOINS</span><div class="related-links">${c.services.filter(other=>other.slug!==service.slug).map(other=>`<a href="../${esc(other.slug)}/">${esc(other.title)}</a>`).join('')}</div></section>`, {service});
}
add('nadege/', `${c.business.name}, facialiste à ${c.business.city}`, `Rencontrez ${c.business.name}, praticienne référencée par l’École du Kobido, au ${c.business.address} à ${c.business.city}.`, pageHeading('NADÈGE BECQUET','Un visage.<br><em>Une rencontre.</em>')+`<section class="profile-section wrap"><div class="profile-image">${photo('../')}</div><article class="prose">${richText(c.about.intro)}<h2>Authentique Kobido®</h2><p>L’École du Kobido référence Nadège comme praticienne certifiée, avec les mentions Expert et Ambassadrice Authentique Kobido®.</p><a class="under-link" href="${sourceSchool}" target="_blank" rel="noopener noreferrer">Voir la fiche de l’École du Kobido</a><h2>À Fontainebleau</h2><p>Les soins ont lieu sur rendez-vous au ${esc(c.business.address)}. Pour une première visite, contactez directement Nadège au ${esc(c.business.phone)}.</p>${appointment()}</article></section>`+appointmentBlock('../'));
add('galerie/',`Photographies de ${c.business.name} — ${c.business.city}`,`Portraits et détails de l’univers de ${c.business.name}, facialiste à ${c.business.city}.`,pageHeading('LES PHOTOGRAPHIES','Le visage derrière<br><em>les gestes.</em>')+`<section class="gallery wrap"><figure>${photo('../','smile')}<figcaption>Nadège Becquet</figcaption></figure><figure>${photo('../','gua')}<figcaption>Le Gua Sha</figcaption></figure><figure>${photo('../','flowers')}<figcaption>Un détail de son univers</figcaption></figure></section>`+appointmentBlock('../'));
add('faq/', `Questions sur les soins du visage — ${c.business.name}`, `Comment réserver, choisir un soin et préparer votre venue au cabinet de ${c.business.name} à ${c.business.city}.`, pageHeading('QUESTIONS FRÉQUENTES','L’essentiel,<br><em>simplement.</em>')+`<section class="narrow wrap">${faqList()}</section>`+appointmentBlock('../'));
add('journal/',`Le journal des soins du visage — ${c.business.name}`,`Facialiste, Kobido, Gua Sha et première visite : des articles pratiques et sourcés pour comprendre les soins et préparer votre rendez-vous à ${c.business.city}.`,pageHeading('LE JOURNAL','Comprendre le soin.<br><em>Préparer sa visite.</em>','Des réponses concrètes à vos questions sur le massage du visage.')+`<section class="journal-grid journal-all wrap">${c.posts.map((post,index)=>postCard(post,index,'../')).join('')}</section>`+appointmentBlock('../'));
for (const post of c.posts) {
  const headingNames = post.body.match(/^## .+/gm) || [];
  const minutes = Math.max(1,Math.ceil(post.body.split(/\s+/).length / 180));
  const related = c.services.filter(service=>post.relatedServices?.includes(service.slug));
  const formatDate = value => new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Paris'}).format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value));
  const published = validDate(post.datePublished) ? post.datePublished : null;
  const modified = validDate(post.dateModified) && (!published || Date.parse(post.dateModified) >= Date.parse(published)) ? post.dateModified : null;
  const dateMarkup = [published ? `<span>Publié le <time datetime="${esc(published)}">${esc(formatDate(published))}</time></span>` : '', modified && modified !== published ? `<span>Mis à jour le <time datetime="${esc(modified)}">${esc(formatDate(modified))}</time></span>` : ''].join('');
  add(`journal/${post.slug}/`,`${post.title} — ${c.business.name}`,post.excerpt,
    pageHeading(post.category || 'LE JOURNAL',esc(post.title),post.excerpt)+`<div class="article-meta wrap"><span>${esc(DEMO_AUTHOR)}</span><span>${minutes} min de lecture</span>${dateMarkup}</div><div class="article-layout wrap"><aside class="article-sidebar">${headingNames.length?`<nav aria-label="Sommaire de l’article"><span class="eyebrow">DANS CET ARTICLE</span>${headingNames.map((name,index)=>`<a href="#section-${index+1}">${esc(name.slice(3))}</a>`).join('')}</nav>`:''}<div class="article-contact"><span class="eyebrow">UN RENDEZ-VOUS ?</span><a href="tel:${phone}">${esc(c.business.phone)}</a><span>${esc(c.business.city)}</span></div></aside><article class="prose article">${richText(post.body)}${post.sources?.length?`<aside class="article-source"><h2>Sources</h2><ul>${post.sources.map(source=>`<li>${external(source.url,source.title)}</li>`).join('')}</ul></aside>`:''}${related.length?`<div class="related-reading"><h2>Les soins concernés</h2>${related.map(service=>`<a href="../../soins/${esc(service.slug)}/">${esc(service.title)}</a>`).join('')}</div>`:''}<div class="article-end"><h2>Prendre rendez-vous</h2><p>${esc(c.business.address)}, ${esc(c.business.postalCode)} ${esc(c.business.city)}.</p>${appointment()}<a class="under-link" href="../">Revenir au journal</a></div></article></div>`,{post});
}
add('contact/', `Rendez-vous & accès — ${c.business.name}, ${c.business.city}`,`Réservez par téléphone au ${c.business.phone}. ${c.business.name}, ${address}. Itinéraires Google Maps, Waze et Apple Plans.`,pageHeading('RENDEZ-VOUS & ACCÈS','Un appel.<br><em>Votre rendez-vous.</em>')+`<section class="contact-grid wrap" id="rendez-vous"><div class="contact-info"><span class="eyebrow">RÉSERVER PAR TÉLÉPHONE</span><a class="phone-link" href="tel:${phone}">${esc(c.business.phone)}</a><p>Appelez Nadège pour choisir votre soin et convenir d’un créneau.</p><div class="contact-actions">${appointment()}<button type="button" class="copy-phone" data-copy-phone="${esc(c.business.phone)}">Copier le numéro</button></div><p class="copy-status" role="status" aria-live="polite"></p><div class="contact-divider"></div><div id="acces"><span class="eyebrow">LE CABINET</span><h2>${esc(c.business.address)}<br><em>${esc(c.business.city)}.</em></h2><address>${esc(c.business.postalCode)} ${esc(c.business.city)}</address><p><strong>${esc(c.business.appointmentNote)}.</strong><br>Pour les horaires, durées et tarifs, contactez Nadège.</p><p class="small-text">Un besoin particulier pour l’accès ? Signalez-le lors de votre appel afin de préparer votre venue.</p><a class="under-link" href="../journal/venir-a-fontainebleau/">Les repères pour venir au cabinet</a></div></div><div class="map-column"><div class="map-placeholder" id="map-slot"><span class="eyebrow">${esc(c.business.city.toUpperCase())}</span><h3>${esc(c.business.address)}</h3><p>La carte Google se charge uniquement à votre demande.</p><button class="button" id="load-map" data-map-query="${esc(address)}">Afficher Google Maps</button><span class="small-text">Google reçoit alors votre adresse IP.</span></div><div class="map-links">${external(maps.google,'Google Maps')}${external(maps.waze,'Waze')}${external(maps.apple,'Apple Plans')}</div><div class="qr-row"><a href="${maps.google}" target="_blank" rel="noopener noreferrer"><img src="../assets/itineraire.svg" width="112" height="112" alt="QR code : itinéraire Google Maps vers ${esc(address)}" loading="lazy"></a><div><h3>Votre trajet,<br>sur votre téléphone.</h3><p>Scannez le QR code pour ouvrir l’itinéraire.</p></div></div></div></section>`);
for (const page of c.pages || []) {
  const headings = {'mentions-legales':'Mentions légales.','confidentialite':'Vos données,<br><em>votre visite.</em>','sources':'Les sources<br><em>du site.</em>'};
  add(`${page.slug}/`,page.title,page.description,pageHeading('INFORMATIONS',headings[page.slug] || esc(page.title))+`<article class="prose legal-page wrap">${legalBody(page.body)}</article>`);
}

await fs.rm(out,{recursive:true,force:true});
await fs.mkdir(path.join(out,'assets'),{recursive:true});
if (!expired) {
  await fs.cp('public',out,{recursive:true});
  if (!photosAllowed) {
    await fs.rm(path.join(out,'assets/reference-nadege.jpg'),{force:true});
    const imagePath = c.media?.shareImage?.path;
    if (typeof imagePath === 'string' && /^assets\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpe?g|png|webp)$/i.test(imagePath) && !imagePath.includes('..')) await fs.rm(path.join(out,imagePath),{force:true});
  }
  await fs.writeFile(path.join(out,'assets/itineraire.svg'),await QRCode.toString(maps.google,{type:'svg',margin:2,color:{dark:'#502e36',light:'#f8f6f1'}}));
}
const retiredHtml = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cette démonstration est terminée</title><style>body{margin:0;background:#f8f6f1;color:#502e36;min-height:100vh;display:grid;place-items:center}main{max-width:650px;padding:40px;text-align:center}h1{font:48px Georgia,serif}p{font:16px/1.7 Arial,sans-serif}</style></head><body><main><h1>Cette démonstration est terminée.</h1><p>La présentation a pris fin le ${esc(dateLabel)}.</p></main></body></html>`;
for (const route of routes) {
  const folder = path.join(out,route.slug);
  await fs.mkdir(folder,{recursive:true});
  await fs.writeFile(path.join(folder,'index.html'),expired?retiredHtml:layout(route));
}
const notFound = layout({slug:'404.html',title:`Page introuvable — ${c.business.name}`,description:'Cette page est introuvable. Retrouvez les soins, le contact et le journal de Nadège Becquet.',body:pageHeading('PAGE INTROUVABLE','Reprenons<br><em>depuis l’accueil.</em>')+`<div class="center section"><a class="button" href="${site}">Revenir à l’accueil</a></div>`}).replace(/(href|src)="(?!https?:|tel:|#|data:)([^"]*)"/g,(_,attribute,url)=>`${attribute}="${new URL(url,site).href}"`);
await fs.writeFile(path.join(out,'404.html'),expired?retiredHtml:notFound);
await fs.writeFile(path.join(out,'robots.txt'),'User-agent: *\nAllow: /\n\n# Laisser lire les directives noindex des pages de démonstration.\n');
await fs.writeFile(path.join(out,'.nojekyll'),'');
await fs.writeFile(path.join(out,'build-info.json'),JSON.stringify({builtAt:new Date().toISOString(),pages:routes.length,expired,removalDate:date,publicDemo:true,noindex:true,photosAuthorized:c.media?.photosAuthorized===true},null,2));
console.log(`Export statique : ${routes.length} pages dans dist/ (${expired?'démo expirée':'démo publique noindex'}).`);
