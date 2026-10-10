/** Metadata for the public, non-indexable demonstration. No production switch. */
export const DEMO_AUTHOR = 'Rédaction de la démonstration';
const TYPES = { soins: 'Les soins', journal: 'Le journal', nadege: 'Nadège Becquet', galerie: 'La galerie', faq: 'Questions fréquentes', contact: 'Contact et accès', sources: 'Sources', 'mentions-legales': 'Mentions légales', confidentialite: 'Confidentialité' };
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
export const safeJson = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character => ({ '<': '\\u003c', '>': '\\u003e', '&': '\\u0026', '\u2028': '\\u2028', '\u2029': '\\u2029' }[character]));
export const normalisePhone = value => String(value ?? '').replace(/[^+\d]/g, '').replace(/^0033/, '+33').replace(/^0/, '+33');
const plain = value => String(value ?? '').replace(/\s+/g, ' ').trim();
function baseUrl(input) {
  let parsed;
  try { parsed = new URL(input); } catch { throw new TypeError('siteUrl doit être une URL absolue HTTP(S).'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new TypeError('siteUrl doit être une racine HTTP(S), sans identifiants, paramètres ou fragment.');
  if (!parsed.pathname.endsWith('/')) parsed.pathname += '/';
  return parsed;
}
function routePath(value) {
  const slug = String(value ?? '');
  if (slug === '') return '';
  if (slug === '404.html') return slug;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*\/?$/.test(slug)) throw new TypeError('slug doit être un chemin relatif composé de mots, chiffres et tirets.');
  return slug.endsWith('/') ? slug : `${slug}/`;
}
function safeHttpUrl(value) {
  try { const parsed = new URL(value); return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : undefined; }
  catch { return undefined; }
}
function authorisedShareImage(content, base) {
  if (content.media?.photosAuthorized !== true || content.media?.shareImage === undefined) return undefined;
  const image = content.media.shareImage;
  if (!image || typeof image !== 'object' || Array.isArray(image) || typeof image.path !== 'string' || !/^assets\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpe?g|png|webp)$/i.test(image.path) || image.path.includes('..')) throw new TypeError('media.shareImage.path doit désigner une image locale dans assets/, sans traversée de répertoire.');
  for (const dimension of ['width', 'height']) if (!Number.isInteger(image[dimension]) || image[dimension] < 1 || image[dimension] > 10000) throw new TypeError(`media.shareImage.${dimension} doit être une dimension réelle entre 1 et 10000 pixels.`);
  if (typeof image.alt !== 'string' || !image.alt.trim() || image.alt.length > 500) throw new TypeError('media.shareImage.alt doit décrire l’image en 500 caractères maximum.');
  const url = new URL(image.path, base).href;
  return { '@type': 'ImageObject', '@id': `${base.href}#share-image`, url, contentUrl: url, width: image.width, height: image.height, caption: image.alt };
}
export function validDate(value) {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return false;
  const datePart = value.slice(0, 10);
  const day = new Date(`${datePart}T00:00:00Z`);
  return !Number.isNaN(Date.parse(value)) && !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === datePart;
}
/** Accept multiple JSON-LD scripts, arrays and graphs without requiring each to repeat the business. */
export function collectSchemaNodes(value) {
  if (Array.isArray(value)) return value.flatMap(collectSchemaNodes);
  if (!value || typeof value !== 'object') return [];
  return value['@graph'] ? collectSchemaNodes(value['@graph']) : [value];
}
export const hasSchemaType = (node, type) => (Array.isArray(node?.['@type']) ? node['@type'] : [node?.['@type']]).includes(type);

export function createSeo({ content, slug = '', title, description, siteUrl, post, service, isDemo = true }) {
  if (isDemo !== true) throw new Error('Le lancement officiel nécessite une validation et une configuration distinctes. Ce module conserve noindex.');
  if (!content?.business) throw new TypeError('Les informations de l’entreprise sont nécessaires.');
  const businessData = content.business;
  for (const key of ['name', 'phone', 'address', 'postalCode', 'city']) if (typeof businessData[key] !== 'string' || !businessData[key].trim()) throw new TypeError(`business.${key} est obligatoire.`);
  const pageTitle = plain(title); const pageDescription = plain(description);
  if (!pageTitle || !pageDescription || /__[A-Z_]+__/.test(`${pageTitle} ${pageDescription}`)) throw new TypeError('Chaque page requiert un titre et une description personnalisés.');
  const base = baseUrl(siteUrl); const route = routePath(slug); const canonical = new URL(route, base).href;
  const businessId = `${base.href}#business`; const siteId = `${base.href}#website`; const pageId = `${canonical}#webpage`; const editorialId = `${base.href}#editorial-demo`;
  const reference = id => ({ '@id': id });
  const article = post ?? (content.posts || []).find(item => route === `journal/${item.slug}/`);
  const treatment = service ?? (content.services || []).find(item => route === `soins/${item.slug}/`);
  if (article && route !== `journal/${article.slug}/`) throw new TypeError('L’article ne correspond pas à l’adresse de la page.');
  if (treatment && route !== `soins/${treatment.slug}/`) throw new TypeError('Le soin ne correspond pas à l’adresse de la page.');
  const business = { '@type': 'BeautySalon', '@id': businessId, name: businessData.name, telephone: normalisePhone(businessData.phone), address: { '@type': 'PostalAddress', streetAddress: businessData.address, addressLocality: businessData.city, postalCode: businessData.postalCode, addressCountry: 'FR' } };
  // Only explicit identity links are candidates; editorial source lists are not sameAs assertions.
  if (Array.isArray(businessData.sameAs)) {
    const sameAs = [...new Set(businessData.sameAs.map(safeHttpUrl).filter(Boolean))];
    if (sameAs.length) business.sameAs = sameAs;
  }
  const website = { '@type': 'WebSite', '@id': siteId, url: base.href, name: `${businessData.name} — démonstration publique`, inLanguage: 'fr-FR', about: reference(businessId) };
  const webpage = { '@type': 'WebPage', '@id': pageId, url: canonical, name: pageTitle, description: pageDescription, inLanguage: 'fr-FR', isPartOf: reference(siteId), about: reference(businessId) };
  const nodes = [business, website, webpage];
  const shareImage = authorisedShareImage(content, base);
  if (shareImage) { business.image = reference(shareImage['@id']); nodes.push(shareImage); }
  if (route && route !== '404.html') {
    const segments = route.split('/').filter(Boolean);
    const elements = [{ '@type': 'ListItem', position: 1, name: 'Accueil', item: base.href }];
    for (let index = 0; index < segments.length; index++) {
      const current = `${segments.slice(0, index + 1).join('/')}/`;
      const name = index === segments.length - 1 ? article?.title || treatment?.title || TYPES[segments[index]] || pageTitle : TYPES[segments[index]] || segments[index];
      elements.push({ '@type': 'ListItem', position: elements.length + 1, name, item: new URL(current, base).href });
    }
    const breadcrumbId = `${canonical}#breadcrumb`;
    webpage.breadcrumb = reference(breadcrumbId);
    nodes.push({ '@type': 'BreadcrumbList', '@id': breadcrumbId, itemListElement: elements });
  }
  if (treatment) {
    const id = `${canonical}#service`;
    webpage.mainEntity = reference(id);
    nodes.push({ '@type': 'Service', '@id': id, name: treatment.title, description: treatment.summary, url: canonical, serviceType: treatment.title, provider: reference(businessId), mainEntityOfPage: reference(pageId) });
  }
  if (article) {
    const id = `${canonical}#article`;
    webpage.mainEntity = reference(id);
    const editorial = { '@type': 'Organization', '@id': editorialId, name: DEMO_AUTHOR, url: new URL('sources/', base).href };
    const posting = { '@type': 'BlogPosting', '@id': id, headline: article.title, description: article.excerpt, url: canonical, inLanguage: 'fr-FR', mainEntityOfPage: reference(pageId), isPartOf: reference(siteId), about: reference(businessId), author: reference(editorialId), publisher: reference(editorialId) };
    if (validDate(article.datePublished)) posting.datePublished = article.datePublished;
    if (validDate(article.dateModified) && (!posting.datePublished || Date.parse(article.dateModified) >= Date.parse(posting.datePublished))) posting.dateModified = article.dateModified;
    if (typeof article.category === 'string' && article.category.trim()) posting.articleSection = article.category;
    if (Array.isArray(article.sources)) {
      const citations = article.sources.map(source => safeHttpUrl(typeof source === 'string' ? source : source?.url)).filter(Boolean);
      if (citations.length) posting.citation = [...new Set(citations)];
    }
    nodes.push(editorial, posting);
  }
  if (route === 'faq/' && Array.isArray(content.faqs) && content.faqs.length) {
    webpage['@type'] = ['WebPage', 'FAQPage'];
    webpage.mainEntity = content.faqs.map(item => ({ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer } }));
  }
  const graph = { '@context': 'https://schema.org', '@graph': nodes };
  const head = [
    `<title>${escapeHtml(pageTitle)}</title>`,
    `<meta name="description" content="${escapeHtml(pageDescription)}">`,
    '<meta name="robots" content="noindex,nofollow,noarchive">',
    `<link rel="canonical" href="${escapeHtml(canonical)}">`,
    `<meta property="og:title" content="${escapeHtml(pageTitle)}">`,
    `<meta property="og:description" content="${escapeHtml(pageDescription)}">`,
    `<meta property="og:type" content="${article ? 'article' : 'website'}">`,
    '<meta property="og:locale" content="fr_FR">',
    `<meta property="og:site_name" content="${escapeHtml(website.name)}">`,
    `<meta property="og:url" content="${escapeHtml(canonical)}">`
  ];
  if (shareImage) head.push(
    `<meta property="og:image" content="${escapeHtml(shareImage.contentUrl)}">`,
    `<meta property="og:image:width" content="${shareImage.width}">`,
    `<meta property="og:image:height" content="${shareImage.height}">`,
    `<meta property="og:image:alt" content="${escapeHtml(shareImage.caption)}">`
  );
  const posting = nodes.find(node => node['@type'] === 'BlogPosting');
  if (posting?.datePublished) head.push(`<meta property="article:published_time" content="${escapeHtml(posting.datePublished)}">`);
  if (posting?.dateModified) head.push(`<meta property="article:modified_time" content="${escapeHtml(posting.dateModified)}">`);
  return { head: head.join('\n'), structuredData: `<script type="application/ld+json">${safeJson(graph)}</script>`, graph, canonical };
}
