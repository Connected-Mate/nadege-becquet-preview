Nadège Becquet — Démo publique de refonte

20 pages et une 404, quatre soins documentés et six articles sourcés.
Design Manrope et Cormorant Garamond, photographies réelles autorisées.
Rendez-vous par téléphone ; administration authentifiée uniquement en local.

Voir LIVRAISON.txt pour les accès, la publication, les contrôles et le retrait.
Voir BACKOFFICE.txt pour l'administration locale, les sauvegardes et l'authentification.

Prérequis : Node.js 22 ou ultérieur.
npm ci
npm run build
npm start

Contrôles : npm test && npm run check
Browser QA locale : node tests/browser-check.mjs (Google Chrome requis).
Après déploiement : node tests/public-check.mjs.

Site : http://127.0.0.1:4173/
Administration : http://127.0.0.1:4173/admin/
Le premier démarrage crée le secret dans .local/admin-access.txt.
Démo : https://connected-mate.github.io/nadege-becquet-preview/

Le back-office édite également les catégories, dates, sources et soins liés
des articles. Les dates ne sont jamais ajoutées automatiquement. Les champs
complémentaires restent accessibles dans l’éditeur JSON et sont conservés.
Après relecture : npm test, npm run build, npm run check, puis publication Git.

La démo GitHub Pages est publique. Les secrets et le back-office ne sont pas déployés.
Retrait demandé : 11 novembre 2026 (Europe/Paris).
La démo reste noindex ; aucun sitemap n’est soumis. Le graph SEO, les
métadonnées sociales et le journal préparent le futur site officiel sans
garantie d’indexation ni de présence dans les réponses génératives.
Les validations restantes concernent notamment les textes, les modalités
des soins, les horaires, l’accès et les informations juridiques exactes.
