const $ = selector => document.querySelector(selector);
const state = { content: null, revision: null, csrf: null, section: 'home', dirty: false, raw: null, busy: false };
const sections = {
  home: ['Accueil', 'Une première impression fidèle à votre pratique et à votre univers.'],
  business: ['Coordonnées', 'Gardez les informations de contact cohérentes avec vos supports et votre fiche établissement.'],
  services: ['Les soins', 'Décrivez uniquement les soins réellement proposés. Vérifiez chaque prestation avant publication.'],
  about: ['Présentation', 'Racontez votre parcours avec des informations vérifiées et des mots qui vous ressemblent.'],
  faqs: ['Questions fréquentes', 'Des réponses claires aux questions de vos clientes et clients.'],
  posts: ['Le journal', 'Des articles utiles, sourcés et sans promesse de résultat.'],
  pages: ['Pages légales & sources', 'Modifiez les mentions légales, la confidentialité et les sources en texte simple. Faites vérifier les informations nécessaires avant le lancement officiel.'],
  demo: ['Démonstration', 'Préparez la fin de la démonstration publique et le passage à une version officielle.'],
  advanced: ['Tous les contenus', 'L’éditeur JSON permet de modifier aussi les champs complémentaires : liens, sources et métadonnées. Conservez la structure du fichier.'],
  history: ['Historique', 'Une copie du contenu précédent est conservée avant chaque enregistrement et chaque restauration.'],
  publish: ['Export & publication', 'Vérifiez votre site localement avant de mettre la nouvelle version en ligne.']
};
function element(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function message(text = '', error = false) { const target = $('#status'); target.textContent = text; target.className = `status ${text ? error ? 'error' : 'success' : ''}`; }
function markDirty() { state.dirty = true; $('#save-state').textContent = 'Modifications non enregistrées'; }
function setBusy(value) { state.busy = value; $('#save').disabled = value; }
async function api(route, options = {}) {
  const response = await fetch(route, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(state.csrf ? { 'X-CSRF-Token': state.csrf } : {}), ...options.headers } });
  const body = await response.json();
  if (!response.ok) {
    if (response.status === 401 && route !== '/api/login') showLogin();
    throw new Error(body.error || 'La requête n’a pas abouti.');
  }
  return body;
}
function showLogin() { $('#workspace').hidden = true; $('#login').hidden = false; state.csrf = null; $('#password').value = ''; }
function commitRaw() {
  if (state.raw !== null) {
    let parsed;
    try { parsed = JSON.parse(state.raw); }
    catch { throw new Error('Le JSON est invalide. Corrigez-le avant de changer de rubrique ou d’enregistrer.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Le contenu doit être un objet JSON.');
    state.content = parsed; state.raw = null;
  }
}
function field(parent, label, value, update, options = {}) {
  const wrapper = element('div', undefined, 'field');
  const id = `field-${crypto.randomUUID()}`;
  const labelNode = element('label', label); labelNode.htmlFor = id;
  const input = element(options.choices ? 'select' : options.multiline ? 'textarea' : 'input'); input.id = id;
  if (options.choices) for (const [value, label] of options.choices) { const option = element('option', label); option.value = value; input.append(option); }
  if (!options.multiline && !options.choices) input.type = options.type || 'text';
  input.value = value ?? ''; if (options.max) input.maxLength = options.max;
  if (options.rows) input.rows = options.rows;
  if (options.required) input.required = true;
  input.addEventListener('input', () => { update(input.value); markDirty(); });
  wrapper.append(labelNode, input);
  if (options.help) wrapper.append(element('small', options.help));
  parent.append(wrapper); return input;
}
function button(text, action, className = 'button secondary') { const node = element('button', text, className); node.type = 'button'; node.addEventListener('click', action); return node; }
function simpleFields(container, section, fields) {
  const target = state.content[section];
  if (!target || typeof target !== 'object' || Array.isArray(target)) throw new Error(`La section « ${section} » est absente ou invalide. Corrigez-la dans « Tous les contenus ».`);
  for (const [key, label, opts] of fields) field(container, label, target[key], value => { target[key] = value; }, opts);
}
const listFields = {
  services: [['slug', 'Adresse de la page', { max: 100, help: 'Minuscules, chiffres et tirets. Exemple : massage-visage. Modifier cette adresse peut casser un ancien lien.' }], ['title', 'Nom du soin', { max: 240 }], ['summary', 'Résumé', { multiline: true, max: 3000 }], ['body', 'Description détaillée', { multiline: true, max: 20000, rows: 8 }]],
  faqs: [['question', 'Question', { max: 500 }], ['answer', 'Réponse', { multiline: true, max: 6000, rows: 5 }]],
  posts: [['slug', 'Adresse de l’article', { max: 100, help: 'Minuscules, chiffres et tirets. Gardez une adresse stable après publication.' }], ['title', 'Titre de l’article', { max: 240 }], ['excerpt', 'Introduction courte', { multiline: true, max: 3000 }], ['body', 'Article', { multiline: true, max: 30000, rows: 12 }]],
  pages: [['slug', 'Page à modifier', { choices: [['mentions-legales', 'Mentions légales'], ['confidentialite', 'Confidentialité'], ['sources', 'Sources']], help: 'Chaque page ne peut apparaître qu’une seule fois.' }], ['title', 'Titre de la page', { max: 240, required: true }], ['description', 'Description pour les moteurs', { multiline: true, max: 3000 }], ['body', 'Contenu de la page', { multiline: true, max: 30000, rows: 15, help: 'Texte simple uniquement. Séparez les paragraphes par une ligne vide. Saisissez les adresses de sources en texte ; aucun code HTML.' }]]
};
function renderList(container, section) {
  const items = section === 'pages' && state.content.pages === undefined ? [] : state.content[section];
  if (!Array.isArray(items)) throw new Error(`La section « ${section} » doit être une liste.`);
  items.forEach((item, index) => {
    const card = element('article', undefined, 'editor-card'); const top = element('div', undefined, 'card-top');
    top.append(element('h2', item.title || item.question || `Élément ${index + 1}`));
    const actions = element('div', undefined, 'card-actions');
    const move = direction => { const destination = index + direction; if (destination < 0 || destination >= items.length) return; [items[index], items[destination]] = [items[destination], items[index]]; markDirty(); render(); };
    const up = button('↑', () => move(-1), 'icon-button'); up.setAttribute('aria-label', `Monter l’élément ${index + 1}`); up.disabled = index === 0;
    const down = button('↓', () => move(1), 'icon-button'); down.setAttribute('aria-label', `Descendre l’élément ${index + 1}`); down.disabled = index === items.length - 1;
    const remove = button('Supprimer', () => { if (confirm('Supprimer cet élément du brouillon ? Le contenu actuel restera dans l’historique après enregistrement.')) { items.splice(index, 1); markDirty(); render(); } }, 'icon-button');
    actions.append(up, down, remove); top.append(actions); card.append(top);
    for (const [key, label, opts] of listFields[section]) field(card, label, item[key], value => { item[key] = value; }, opts);
    container.append(card);
  });
  container.append(button(section === 'services' ? '+ Ajouter un soin' : section === 'posts' ? '+ Ajouter un article' : section === 'pages' ? '+ Ajouter une page' : '+ Ajouter une question', () => {
    const limit = section === 'pages' ? 3 : 100;
    if (items.length >= limit) return message(`La limite de ${limit} éléments est atteinte.`, true);
    const item = Object.fromEntries(listFields[section].map(([key]) => [key, '']));
    if (section === 'pages') {
      const available = listFields.pages[0][2].choices.find(([slug]) => !items.some(page => page.slug === slug));
      if (!available) return message('Les trois pages sont déjà présentes.', true);
      [item.slug, item.title] = available; state.content.pages = items;
    }
    items.push(item); markDirty(); render();
    const cards = container.querySelectorAll('.editor-card'); cards[cards.length - 1]?.querySelector('input')?.focus();
  }));
}
async function renderHistory(container) {
  container.append(element('p', 'Chargement des sauvegardes…', 'small'));
  const { history } = await api('/api/history');
  if (state.section !== 'history') return;
  container.replaceChildren();
  if (!history.length) { container.append(element('p', 'L’historique apparaîtra après votre premier enregistrement.')); return; }
  const list = element('ul', undefined, 'history-list');
  for (const entry of history) {
    const item = element('li'); const details = element('div');
    details.append(element('strong', new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(entry.date))), element('small', `Contenu conservé avant ${entry.reason === 'restauration' ? 'une restauration' : 'une modification'}`));
    const restore = button('Restaurer', async () => {
      if (!confirm('Restaurer cette version ? La version enregistrée actuelle sera sauvegardée à son tour. Les changements non enregistrés seront remplacés.')) return;
      restore.disabled = true;
      try { const result = await api('/api/restore', { method: 'POST', body: JSON.stringify({ id: entry.id, revision: state.revision }) }); applyContent(result); message('La version a été restaurée. Générez la preview pour vérifier le résultat.'); render(); }
      catch (error) { message(error.message, true); } finally { restore.disabled = false; }
    });
    item.append(details, restore); list.append(item);
  }
  container.append(list);
}
function renderPublish(container) {
  const card = element('div', undefined, 'editor-card');
  card.append(element('h2', 'Du brouillon au site public'), element('p', 'Le back-office fonctionne uniquement sur votre ordinateur. GitHub Pages héberge la version statique publique et ne reçoit jamais les accès, l’historique ou l’administration.'));
  const steps = element('ol', undefined, 'steps');
  for (const [title, description] of [['Enregistrer vos contenus', 'L’enregistrement valide les champs et crée une copie de la version précédente dans .local/history/.'], ['Générer puis vérifier la preview', 'Le générateur actualise dist/. Ouvrez le site local et contrôlez les textes, liens, coordonnées et parcours mobile.'], ['Publier depuis le projet', 'Après vérification, publiez les fichiers autorisés avec Git. Le workflow GitHub Pages reconstruit le site. Le bouton de génération ci-dessous ne publie rien sur Internet.']]) { const li = element('li'); li.append(element('strong', title), element('p', description)); steps.append(li); }
  card.append(steps);
  const toolbar = element('div', undefined, 'toolbar');
  const build = button('Générer la preview ↗', async () => {
    if (state.dirty) return message('Enregistrez vos modifications avant de générer la preview.', true);
    build.disabled = true; message('Génération du site en cours…');
    try { const result = await api('/api/build', { method: 'POST', body: '{}' }); message(result.message); }
    catch (error) { message(error.message, true); } finally { build.disabled = false; }
  }, 'button primary');
  const exportLink = element('a', 'Exporter les contenus JSON', 'button secondary'); exportLink.href = '/api/export-content'; exportLink.download = 'nadege-becquet-contenus.json';
  toolbar.append(build, exportLink); card.append(toolbar);
  const review = element('div', undefined, 'editor-card');
  review.append(element('h3', 'Valider la version relue'));
  const reviewStatus = element('p', 'Chargement de l’état de validation…', 'small'); review.append(reviewStatus);
  const approve = button('Valider cette version après relecture', async () => {
    if (state.dirty) return message('Enregistrez puis vérifiez vos modifications avant de valider la version.', true);
    if (!confirm('Confirmez-vous avoir relu la version enregistrée et sa preview ? Cette validation sera datée dans le journal local.')) return;
    approve.disabled = true;
    try { const result = await api('/api/approval', { method: 'POST', body: JSON.stringify({ confirmed: true, revision: state.revision }) }); showApproval(result); message('La relecture de cette version est enregistrée. La publication distante reste à effectuer depuis le projet.'); }
    catch (error) { message(error.message, true); approve.disabled = false; }
  });
  function showApproval(result) {
    reviewStatus.textContent = result.approved ? `Version relue et validée le ${new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(result.date))}.` : 'La version enregistrée attend votre validation de relecture. Une modification du contenu annule cet état pour la nouvelle version.';
    approve.disabled = result.approved;
  }
  review.append(approve, element('p', 'Cette validation trace votre relecture. Elle ne vérifie pas automatiquement la réalité des informations, les droits des images ou les obligations légales.', 'small'));
  card.append(review);
  api('/api/approval').then(showApproval).catch(error => { reviewStatus.textContent = error.message; });
  card.append(element('h3', 'Dans le terminal du projet'));
  card.append(element('pre', 'npm run build\n# Vérifiez ensuite la preview locale.\ngit add data/content.json\ngit commit -m "Mise à jour des contenus"\ngit push'));
  card.append(element('p', 'La publication demande un dépôt GitHub déjà configuré et les droits correspondants. Pour une première installation, suivez le guide de livraison du projet.', 'small'));
  container.append(card);
}
function render() {
  const container = $('#editor'); container.replaceChildren();
  const section = state.section; const [title, description] = sections[section];
  $('#panel-title').textContent = title; $('#panel-description').textContent = description;
  for (const node of document.querySelectorAll('#section-nav button')) { if (node.dataset.section === section) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current'); }
  try {
    if (section === 'home') simpleFields(container, 'home', [['eyebrow', 'Phrase d’ouverture', { max: 240 }], ['title', 'Titre principal', { max: 240, required: true }], ['description', 'Texte de présentation', { multiline: true, max: 4000, rows: 6 }]]);
    if (section === 'business') simpleFields(container, 'business', [['name', 'Nom de l’entreprise', { max: 160, required: true }], ['phone', 'Téléphone', { type: 'tel', max: 1000, required: true }], ['address', 'Rue et numéro', { max: 1000, required: true }], ['postalCode', 'Code postal', { max: 1000, required: true }], ['city', 'Ville', { max: 1000, required: true }], ['appointmentNote', 'Rendez-vous et horaires', { multiline: true, max: 1000, help: 'N’indiquez que les horaires confirmés. Une mention « sur rendez-vous » peut être préférable à des horaires incertains.' }]]);
    if (section === 'about') simpleFields(container, 'about', [['intro', 'Votre présentation', { multiline: true, rows: 15, max: 15000 }]]);
    if (listFields[section]) renderList(container, section);
    if (section === 'demo') {
      field(container, 'Date prévue de retrait de la démo', state.content.demo?.removalDate, value => { state.content.demo.removalDate = value || null; }, { type: 'date', help: 'Laissez vide tant que la date n’a pas été fixée. Cette date ne programme pas à elle seule la suppression du site GitHub Pages. Consultez le guide de livraison.' });
      container.append(element('p', 'La démo est une URL publique. La directive noindex demande aux moteurs de ne pas l’indexer ; elle ne la rend pas privée. Gardez noindex et l’avertissement de démonstration jusqu’à la validation du lancement officiel.', 'notice'));
    }
    if (section === 'advanced') {
      const wrapper = element('div', undefined, 'field'); const label = element('label', 'Fichier complet des contenus — JSON'); label.htmlFor = 'advanced-json';
      const input = element('textarea', undefined, 'advanced-editor'); input.id = 'advanced-json'; input.spellcheck = false; input.value = state.raw ?? JSON.stringify(state.content, null, 2);
      input.addEventListener('input', () => { state.raw = input.value; markDirty(); }); wrapper.append(label, input); container.append(wrapper);
    }
    if (section === 'history') renderHistory(container).catch(error => message(error.message, true));
    if (section === 'publish') renderPublish(container);
  } catch (error) { message(error.message, true); }
}
function applyContent(result) { state.content = result.content; state.revision = result.revision; state.raw = null; state.dirty = false; $('#save-state').textContent = 'Toutes les modifications sont enregistrées'; }
async function openWorkspace() {
  const result = await api('/api/content'); applyContent(result); $('#login').hidden = true; $('#workspace').hidden = false; render();
}
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault(); const submit = $('#login-form button'); submit.disabled = true; $('#login-status').textContent = 'Connexion…';
  try { const session = await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('#password').value }) }); state.csrf = session.csrf; $('#password').value = ''; await openWorkspace(); $('#login-status').textContent = ''; $('#main').focus(); }
  catch (error) { $('#login-status').textContent = error.message; $('#login-status').className = 'status error'; }
  finally { submit.disabled = false; }
});
$('#save').addEventListener('click', async () => {
  if (state.busy) return;
  try { commitRaw(); setBusy(true); const result = await api('/api/content', { method: 'PUT', body: JSON.stringify({ content: state.content, revision: state.revision }) }); applyContent(result); render(); message('Contenus enregistrés et version précédente sauvegardée. Générez la preview dans « Export & publication ».'); }
  catch (error) { message(error.message, true); } finally { setBusy(false); }
});
$('#logout').addEventListener('click', async () => {
  if (state.dirty && !confirm('Vous avez des modifications non enregistrées. Se déconnecter et les abandonner ?')) return;
  try { await api('/api/logout', { method: 'POST', body: '{}' }); state.dirty = false; showLogin(); $('#password').focus(); }
  catch (error) { message(error.message, true); }
});
$('#section-nav').addEventListener('click', event => {
  const target = event.target.closest('button[data-section]'); if (!target) return;
  try { commitRaw(); state.section = target.dataset.section; message(); render(); $('#main').focus({ preventScroll: true }); }
  catch (error) { message(error.message, true); }
});
window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
(async () => { try { const session = await api('/api/session'); state.csrf = session.csrf; await openWorkspace(); } catch { showLogin(); } })();
