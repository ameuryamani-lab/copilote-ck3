// Serveur local du Copilote CK3 (06/10/2026). Il sert la page de l'icône (page/) et confie /api/jeu/* au cerveau
// (agent/copilote-jeu.mjs). Il écoute sur 127.0.0.1 seulement : la capture de l'écran de jeu ne doit jamais être joignable
// depuis le réseau local. Utilisé par main.mjs (Electron) et par les essais en Node pur, sans Electron.
import http from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const DOSSIER_PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'page');
const TYPES = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'};
const PORTS = [8802, 8803, 8804, 8805, 8806, 8807, 8808, 8809];

// .env : lignes CLÉ=VALEUR, guillemets facultatifs, commentaires #. Les valeurs ne sont jamais écrites dans un journal.
export async function lireEnv(root) {
  const env = {};
  let texte = '';
  try { texte = await readFile(path.join(root, '.env'), 'utf8'); } catch { return env; }
  for (const ligne of texte.replace(/^﻿/, '').split(/\r?\n/)) {
    const m = ligne.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (/^"[\s\S]*"$/.test(v)) v = v.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
    else if (/^'[\s\S]*'$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    env[m[1]] = v;
  }
  return env;
}

// Fichier statique de page/ : chemin décodé, aucun « .. », aucun octet nul, et le chemin final doit rester dans page/.
async function servirFichier(url, req, res) {
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { return envoyer(res, 400, 'Adresse invalide'); }
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel.includes('\0') || rel.includes('\\') || rel.split('/').some(p => p === '..' || p === '.') || /^\/*[A-Za-z]:/.test(rel)) return envoyer(res, 403, 'Interdit');
  const fichier = path.resolve(DOSSIER_PAGE, '.' + rel);
  if (!fichier.startsWith(DOSSIER_PAGE + path.sep)) return envoyer(res, 403, 'Interdit');
  const type = TYPES[path.extname(fichier).toLowerCase()];
  if (!type) return envoyer(res, 404, 'Introuvable');
  const infos = await stat(fichier).catch(() => null);
  if (!infos?.isFile()) return envoyer(res, 404, 'Introuvable');
  const contenu = await readFile(fichier);
  res.writeHead(200, {'Content-Type': type, 'Content-Length': contenu.length, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', 'Cross-Origin-Opener-Policy': 'same-origin'});
  res.end(req.method === 'HEAD' ? undefined : contenu);
}

function envoyer(res, code, texte) {
  if (res.headersSent) return res.end();
  res.writeHead(code, {'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff'});
  res.end(texte);
}
const json = (res, code, obj) => { res.writeHead(code, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}); res.end(JSON.stringify(obj)); };
// Langue des textes renvoyés (06/10/2026) : la page ajoute ?langue=fr|en à chaque appel ; toute autre valeur revient au français.
const langueDe = url => url?.searchParams?.get('langue') === 'en' ? 'en' : 'fr';
const ERREUR_INTERNE = {fr: 'erreur interne', en: 'internal error'};

// Cerveau indisponible (module absent ou en erreur au chargement) : chaque question reçoit une erreur claire au lieu d'un silence.
function copiloteIndisponible(raison) {
  const messages = {fr: 'Le cerveau du copilote ne s\'est pas chargé : ' + raison, en: 'The copilot\'s brain failed to load: ' + raison};
  return {
    async route(url, req, res) {
      if (!url.pathname.startsWith('/api/jeu/')) return false;
      const message = messages[langueDe(url)];
      if (url.pathname === '/api/jeu/question' && req.method === 'POST') {
        req.resume();
        res.writeHead(200, {'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache'});
        res.end(`data: ${JSON.stringify({type: 'erreur', message})}\n\n`);
        return true;
      }
      if (url.pathname === '/api/jeu/etat') return json(res, 200, {ck3: false, version: null, extensions: {possedees: [], manquantes: []}, cle: {gemini: false, openai: false}, voix: null, erreur: message}), true;
      return json(res, 503, {erreur: message}), true;
    },
    async *poser({langue} = {}) { yield {type: 'erreur', message: messages[langue === 'en' ? 'en' : 'fr']}; },
    etat: async () => ({erreur: messages.fr}), oublier() {},
  };
}

// Copilote factice pour les essais (COPILOTE_ESSAI_STUB=1 ou option copilote) : il rejoue une réponse écrite d'avance, sans capture
// ni API, pour vérifier la page, le flux SSE et la fenêtre sans dépenser un centime.
// Il parle anglais quand la question le demande (champ langue du corps, sinon ?langue=en), comme le vrai cerveau.
export function creerCopiloteFactice({delai = 40} = {}) {
  const attendre = ms => new Promise(r => setTimeout(r, ms));
  const TEXTES = {
    fr: {reponse: 'Démonstration : pour obtenir un **Hook** (moyen de pression) sur ton vassal, passe par un complot.\n'
      + '1. Fais un clic droit sur son portrait.\n2. Choisis **Fabricate Hook** (fabriquer un moyen de pression).\n'
      + '3. Regarde la **Success Chance** (chance de réussite) avant de valider.\n4. Mets ton **Spymaster** (maître espion) sur sa cour pour aller plus vite.',
    question: 'Comment je fabrique un hameçon sur mon vassal ?', capture: 'Je regarde ton écran…', ecoute: 'J\'écoute ta question…', reflexion: 'Je réfléchis…',
    recherche: 'Je vérifie sur Internet…', voix: 'Je te le dis à voix haute…'},
    en: {reponse: 'Demo: to get a **Hook** on your vassal, use a scheme.\n'
      + '1. Right-click their portrait.\n2. Choose **Fabricate Hook**.\n'
      + '3. Check the **Success Chance** before you confirm.\n4. Send your **Spymaster** to their court to speed it up.',
    question: 'How do I fabricate a hook on my vassal?', capture: 'Looking at your screen…', ecoute: 'Listening to your question…', reflexion: 'Thinking…',
    recherche: 'Checking online…', voix: 'Reading the answer to you…'},
  };
  const SUGGESTIONS = '<style>.container{font-family:Roboto,Arial,sans-serif;display:flex;align-items:center;gap:8px;padding:6px 2px}'
    + '.chip{display:inline-block;border:1px solid #5f6368;border-radius:16px;padding:5px 14px;color:#e8eaed;font-size:13px;text-decoration:none;white-space:nowrap}'
    + '.carousel{overflow-x:auto;white-space:nowrap;scrollbar-width:none}</style><div class="container"><div class="carousel">'
    + '<a class="chip" href="https://www.google.com/search?q=ck3+fabricate+hook">ck3 fabricate hook</a> '
    + '<a class="chip" href="https://www.google.com/search?q=ck3+1.20+hooks">ck3 1.20 hooks</a></div></div>';
  // Deux courts bips doux à 24 kHz : de quoi vérifier la file de lecture sans voix réelle.
  const bip = (f, ms) => { const n = Math.round(24000 * ms / 1000), b = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * f * i / 24000) * 2500 * Math.sin(Math.PI * i / n)), i * 2);
    return b.toString('base64'); };
  let echanges = 0;

  async function *poser({texte, langue} = {}) {
    const debut = Date.now(), T = TEXTES[langue === 'en' ? 'en' : 'fr'];
    yield {type: 'etape', etape: 'capture', texte: T.capture}; await attendre(delai * 4);
    yield {type: 'etape', etape: 'ecoute', texte: T.ecoute}; await attendre(delai * 4);
    yield {type: 'question', texte: texte || T.question};
    yield {type: 'etape', etape: 'reflexion', texte: T.reflexion}; await attendre(delai * 4);
    yield {type: 'etape', etape: 'recherche', texte: T.recherche}; await attendre(delai * 4);
    for (const morceau of T.reponse.match(/[\s\S]{1,18}/g)) { yield {type: 'texte', delta: morceau}; await attendre(delai); }
    yield {type: 'sources', liens: [{titre: 'Hooks - CK3 Wiki', url: 'https://ck3.paradoxwikis.com/Hooks'}, {titre: 'Patch 1.20 - CK3 Wiki', url: 'https://ck3.paradoxwikis.com/Patch_1.20'}], suggestionsHtml: SUGGESTIONS};
    yield {type: 'etape', etape: 'voix', texte: T.voix};
    yield {type: 'audio', pcm: bip(660, 180), index: 0}; await attendre(delai);
    yield {type: 'audio', pcm: bip(880, 180), index: 1};
    echanges++;
    yield {type: 'fin', ms: Date.now() - debut, coutCents: 0};
  }

  async function lireCorps(req, max = 8 * 1024 * 1024) {
    let taille = 0; const morceaux = [];
    for await (const m of req) { taille += m.length; if (taille > max) throw new Error('trop gros'); morceaux.push(m); }
    return Buffer.concat(morceaux).toString('utf8');
  }

  async function route(url, req, res) {
    if (!url.pathname.startsWith('/api/jeu/')) return false;
    if (url.pathname === '/api/jeu/etat' && req.method === 'GET') return json(res, 200, {ck3: true, version: '1.20.0.4', factice: true,
      extensions: {possedees: ['Garments of the Holy Roman Empire'], manquantes: ['By God Alone']}, cle: {gemini: true, openai: true}, voix: 'Kore'}), true;
    if (url.pathname === '/api/jeu/oublier' && req.method === 'POST') { req.resume(); echanges = 0; return json(res, 200, {ok: true}), true; }
    if (url.pathname === '/api/jeu/capturer' && req.method === 'POST') { req.resume(); return json(res, 200, {ok: true, factice: true}), true; }
    if (url.pathname !== '/api/jeu/question' || req.method !== 'POST') return json(res, 404, {erreur: 'route inconnue'}), true;
    let corps;
    try { corps = JSON.parse((await lireCorps(req)) || '{}'); } catch (e) { return json(res, e.message === 'trop gros' ? 413 : 400, {erreur: 'corps invalide'}), true; }
    res.writeHead(200, {'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'});
    let coupe = false;
    res.on('close', () => { coupe = true; });
    for await (const ev of poser({texte: corps.texte, langue: corps.langue ?? langueDe(url)})) {
      if (coupe) break;
      if (ev.type === 'audio' && corps.voix === false) continue;
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    }
    res.end();
    return true;
  }

  return {route, poser, etat: async () => ({ck3: true, factice: true, echanges}), oublier() { echanges = 0; }};
}

// copilote : facultatif, pour les essais (sinon le vrai cerveau est construit depuis agent/copilote-jeu.mjs).
export async function demarrerServeur({root, port = 8802, aide = null, journal = console, copilote = null}) {
  const env = await lireEnv(root);
  journal.log?.(`Clés présentes : Gemini ${env.GEMINI_API_KEY ? 'oui' : 'non'}, OpenAI ${env.OPENAI_API_KEY ? 'oui' : 'non'}`);
  if (!copilote && process.env.COPILOTE_ESSAI_STUB === '1') { copilote = creerCopiloteFactice(); journal.log?.('Cerveau factice (COPILOTE_ESSAI_STUB=1)'); }
  if (!copilote) {
    try {
      const {creerCopiloteJeu} = await import(pathToFileURL(path.join(root, 'agent', 'copilote-jeu.mjs')).href);
      let conso = null;
      try { const {creerConsommation} = await import(pathToFileURL(path.join(root, 'agent', 'consommation.mjs')).href); conso = creerConsommation({root}); } catch {}
      copilote = creerCopiloteJeu({root, env, aide, conso, journal});
    } catch (e) {
      journal.error?.(`Cerveau du copilote non chargé : ${e.message}`);
      copilote = copiloteIndisponible(e.message);
    }
  }

  let origine = '';
  const serveur = http.createServer(async (req, res) => {
    // Une question annulée en plein envoi coupe la connexion : sans ces écouteurs, l'erreur ferait tomber tout le serveur.
    req.on('error', e => journal.warn?.(`Requête coupée : ${e.code || e.message}`));
    res.on('error', e => journal.warn?.(`Réponse coupée : ${e.code || e.message}`));
    try {
      // Protection contre le « DNS rebinding » et les requêtes d'un site web ouvert dans le navigateur : seul 127.0.0.1 /
      // localhost sur notre port est accepté, et une requête qui annonce une autre origine est refusée.
      const hote = String(req.headers.host || '').toLowerCase();
      if (hote !== `127.0.0.1:${port}` && hote !== `localhost:${port}`) return envoyer(res, 403, 'Hôte refusé');
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.pathname.startsWith('/api/')) {
        const o = req.headers.origin;
        if (o && o !== origine && o !== `http://localhost:${port}`) return json(res, 403, {erreur: 'origine refusée'});
        if (url.pathname.startsWith('/api/jeu/') && await copilote.route(url, req, res)) return;
        return json(res, 404, {erreur: 'route inconnue'});
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return envoyer(res, 405, 'Méthode refusée');
      await servirFichier(url, req, res);
    } catch (e) {
      journal.error?.(`Requête ${req.method} ${String(req.url).slice(0, 80)} : ${e.message}`);
      let langue = 'fr';
      try { langue = langueDe(new URL(req.url, 'http://127.0.0.1')); } catch {}
      if (!res.headersSent) json(res, 500, {erreur: ERREUR_INTERNE[langue]}); else res.end();
    }
  });
  serveur.keepAliveTimeout = 5000;

  // 8802 d'abord, puis les suivants si le port est pris (une autre copie, ou un essai en cours).
  const candidats = port === 8802 ? PORTS : [port];
  let erreur;
  for (const p of candidats) {
    try {
      await new Promise((ok, ko) => { serveur.once('error', ko); serveur.listen(p, '127.0.0.1', () => { serveur.off('error', ko); ok(); }); });
      port = p; erreur = null; break;
    } catch (e) { erreur = e; if (e.code !== 'EADDRINUSE' && e.code !== 'EACCES') break; }
  }
  if (erreur) throw new Error(`Aucun port libre pour le copilote (${candidats[0]}-${candidats.at(-1)}) : ${erreur.code || erreur.message}`);
  origine = `http://127.0.0.1:${port}`;
  journal.log?.(`Serveur du copilote sur ${origine}`);

  return {port, origine, adresse: serveur.address(), copilote,
    fermer: () => new Promise(ok => { serveur.close(() => ok()); serveur.closeAllConnections?.(); })};
}
