// Essai du serveur de l'icône (Node pur, sans Electron, sans API ni capture) : fichiers statiques et leurs types, refus des
// chemins qui sortent de page/, écoute sur 127.0.0.1 seulement, port suivant quand 8802 est pris, protections d'hôte et
// d'origine, flux SSE d'une réponse factice lu jusqu'au bout. Aucune clé n'est lue ni affichée : un faux dossier racine sert.
// Langue (06/10/2026) : dictionnaire de la page (mêmes clés en français et en anglais, textes d'index.html), démo en anglais, et
// le vrai cerveau avec une fausse aide « CK3 fermé » : étapes et erreurs en anglais, langue inconnue -> français (aucun appel payant).
// Lancer : node essais/essai-page.mjs        (--garder : laisse le serveur factice tourner pour essayer la page à la main)
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {mkdtemp, mkdir, writeFile, readFile, copyFile, readdir, rm} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {demarrerServeur, creerCopiloteFactice, lireEnv} from '../serveur.mjs';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const PROJET = path.resolve(ICI, '..');   // dossier qui contient agent/ (le cerveau) et memoire/
const PAGE = path.resolve(ICI, '..', 'page');
const SECRET = 'valeur-secrete-de-test-a-ne-jamais-voir';
const resultats = [];
const verifier = (nom, ok, details = '') => { resultats.push({nom, ok: !!ok, details}); console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${nom}${details ? ' : ' + details : ''}`); };

// Requête brute : le chemin part tel quel (le client http de Node ne normalise pas « .. »).
function requete(port, {chemin = '/', methode = 'GET', entetes = {}, corps = null, hote = `127.0.0.1:${port}`} = {}) {
  return new Promise((ok, ko) => {
    const r = http.request({host: '127.0.0.1', port, path: chemin, method: methode, agent: false, headers: {Host: hote, ...entetes}}, res => {
      const morceaux = [];
      res.on('error', ko);
      res.on('data', m => morceaux.push(m));
      res.on('end', () => ok({code: res.statusCode, type: res.headers['content-type'] || '', corps: Buffer.concat(morceaux)}));
    });
    r.on('error', ko);
    r.setTimeout(10000, () => r.destroy(new Error('délai')));
    if (corps) r.write(corps);
    r.end();
  });
}

const lignesJournal = [];
const journal = {log: (...a) => lignesJournal.push(a.join(' ')), warn: (...a) => lignesJournal.push(a.join(' ')), error: (...a) => lignesJournal.push(a.join(' '))};

const racine = await mkdtemp(path.join(os.tmpdir(), 'copilote-essai-'));
await writeFile(path.join(racine, '.env'), `# essai\nGEMINI_API_KEY="${SECRET}"\nexport OPENAI_API_KEY='${SECRET}-2'\nAUTRE=a b # commentaire\n`);
const env = await lireEnv(racine);
verifier('lecture du .env (guillemets, export, commentaire)', env.GEMINI_API_KEY === SECRET && env.OPENAI_API_KEY === SECRET + '-2' && env.AUTRE === 'a b');

const garder = process.argv.includes('--garder');
const s1 = await demarrerServeur({root: racine, journal, copilote: creerCopiloteFactice({delai: garder ? 40 : 5})});
const port = s1.port;
verifier('port dans la plage 8802-8809', port >= 8802 && port <= 8809, String(port));
verifier('écoute sur 127.0.0.1 seulement', s1.adresse?.address === '127.0.0.1', s1.adresse?.address);

// Second serveur : 8802 (ou le port pris) occupé → il doit prendre le suivant.
const s2 = await demarrerServeur({root: racine, journal, copilote: creerCopiloteFactice({delai: 5})});
verifier('port suivant quand le premier est pris', s2.port > port && s2.port <= 8809, `${port} puis ${s2.port}`);
await s2.fermer();

// Joignable depuis le réseau ? Essai sur chaque adresse IPv4 non locale de la machine : la connexion doit être refusée.
const adresses = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
for (const ip of adresses.slice(0, 3)) {
  const joignable = await new Promise(ok => { const c = net.connect({host: ip, port}); c.setTimeout(1500); c.on('connect', () => { c.destroy(); ok(true); }); c.on('error', () => ok(false)); c.on('timeout', () => { c.destroy(); ok(false); }); });
  verifier(`injoignable depuis ${ip}`, !joignable);
}

// Fichiers statiques et types.
const attendus = [['/', 'text/html'], ['/index.html', 'text/html; charset=utf-8'], ['/overlay.css', 'text/css'], ['/overlay.js', 'text/javascript'], ['/textes.js', 'text/javascript'],
  ['/micro-worklet.js', 'text/javascript'], ['/polices/Exo2.woff2', 'font/woff2'], ['/polices/Rajdhani-700.woff2', 'font/woff2'], ['/index.html?demo=1', 'text/html']];
for (const [chemin, type] of attendus) {
  const r = await requete(port, {chemin});
  verifier(`GET ${chemin}`, r.code === 200 && r.type.startsWith(type) && r.corps.length > 0, `${r.code} ${r.type} ${r.corps.length} o`);
}
const head = await requete(port, {chemin: '/overlay.css', methode: 'HEAD'});
verifier('HEAD sans corps', head.code === 200 && head.corps.length === 0);
const absent = await requete(port, {chemin: '/rien.html'});
verifier('fichier absent → 404', absent.code === 404);
const post = await requete(port, {chemin: '/index.html', methode: 'POST'});
verifier('POST sur un fichier → 405', post.code === 405);

// Traversée de dossiers : jamais le contenu d'un fichier hors de page/.
const SIGNATURES = ['demarrerServeur', 'GEMINI_API_KEY', '[fonts]', 'electron'];
const pieges = ['/../serveur.mjs', '/%2e%2e/serveur.mjs', '/..%2fserveur.mjs', '/%2e%2e%2fserveur.mjs', '/..%5cserveur.mjs', '/%2e%2e%5c%2e%2e%5c.env',
  '/polices/../../serveur.mjs', '/polices/%2e%2e/%2e%2e/main.mjs', '/%00index.html', '/index.html%00.js', '/C:/Windows/win.ini',
  '/C:%5cWindows%5cwin.ini', '//etc/passwd', '/%E0%A4%A', '/....//serveur.mjs', '/page/../package.json', '/\\..\\serveur.mjs'];
for (const chemin of pieges) {
  const r = await requete(port, {chemin}).catch(e => ({code: 0, corps: Buffer.from(e.message), type: ''}));
  const fuite = SIGNATURES.some(s => r.corps.toString('latin1').includes(s));
  verifier(`refus de ${chemin}`, r.code !== 200 && !fuite, String(r.code));
}

// Hôte et origine : protection contre le « DNS rebinding » et les sites web qui viseraient le serveur local.
const mauvaisHote = await requete(port, {chemin: '/index.html', hote: 'exemple.com'});
verifier('hôte étranger refusé', mauvaisHote.code === 403);
const localhost = await requete(port, {chemin: '/index.html', hote: `localhost:${port}`});
verifier('hôte localhost accepté', localhost.code === 200);
const mauvaiseOrigine = await requete(port, {chemin: '/api/jeu/question', methode: 'POST', entetes: {Origin: 'https://exemple.com', 'Content-Type': 'text/plain'}, corps: '{}'});
verifier('origine étrangère refusée', mauvaiseOrigine.code === 403);
const origineNulle = await requete(port, {chemin: '/api/jeu/etat', entetes: {Origin: 'null'}});
verifier('origine « null » (cadre isolé) refusée', origineNulle.code === 403);

// API factice.
const etat = await requete(port, {chemin: '/api/jeu/etat', entetes: {Origin: `http://127.0.0.1:${port}`}});
let etatJson = null; try { etatJson = JSON.parse(etat.corps); } catch {}
verifier('GET /api/jeu/etat', etat.code === 200 && etatJson?.version === '1.20.0.4' && etatJson?.cle?.gemini === true, etat.type);
const oublier = await requete(port, {chemin: '/api/jeu/oublier', methode: 'POST', corps: '{}'});
verifier('POST /api/jeu/oublier', oublier.code === 200 && JSON.parse(oublier.corps).ok === true);
const inconnue = await requete(port, {chemin: '/api/jeu/nimporte'});
verifier('route inconnue → 404', inconnue.code === 404);
const autreApi = await requete(port, {chemin: '/api/pages'});
verifier('autres /api refusées', autreApi.code === 404);

// Flux SSE : lu avec fetch comme la page le fait, événements dans l'ordre, connexion fermée après « fin ».
async function lireSse(corps, p = port, chemin = '/api/jeu/question') {
  const r = await fetch(`http://127.0.0.1:${p}${chemin}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(corps)});
  const evenements = [];
  const dec = new TextDecoder(); let tampon = '';
  for await (const m of r.body) {
    tampon += dec.decode(m, {stream: true});
    let i;
    while ((i = tampon.indexOf('\n\n')) >= 0) {
      const bloc = tampon.slice(0, i); tampon = tampon.slice(i + 2);
      const data = bloc.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
      if (data) evenements.push(JSON.parse(data));
    }
  }
  return {code: r.status, type: r.headers.get('content-type'), cache: r.headers.get('cache-control'), evenements, reste: tampon};
}
const sse = await lireSse({texte: 'Comment je fabrique un hameçon ?', voix: true});
const types = sse.evenements.map(e => e.type);
verifier('SSE : type et cache', sse.code === 200 && /^text\/event-stream/.test(sse.type) && /no-cache/.test(sse.cache), `${sse.type} / ${sse.cache}`);
const ordre = ['etape', 'question', 'texte', 'sources', 'audio', 'fin'].map(t => types.indexOf(t));
verifier('SSE : événements dans l\'ordre et « fin » en dernier', ordre.every((v, i) => v >= 0 && (i === 0 || v > ordre[i - 1])) && types.at(-1) === 'fin' && !sse.reste.trim(), types.join(','));
const texte = sse.evenements.filter(e => e.type === 'texte').map(e => e.delta).join('');
verifier('SSE : texte complet avec libellés en gras', texte.includes('**Fabricate Hook**') && texte.split('\n').filter(l => /^\d\. /.test(l)).length === 4);
const audios = sse.evenements.filter(e => e.type === 'audio');
verifier('SSE : audio PCM 16 bits dans l\'ordre', audios.length === 2 && audios.every((a, i) => a.index === i && Buffer.from(a.pcm, 'base64').length % 2 === 0));
const sansVoix = await lireSse({texte: 'test', voix: false});
verifier('SSE : voix coupée → aucun audio', !sansVoix.evenements.some(e => e.type === 'audio') && sansVoix.evenements.at(-1)?.type === 'fin');

// Corps trop gros (> 8 Mo) refusé sans faire tomber le serveur.
const gros = await requete(port, {chemin: '/api/jeu/question', methode: 'POST', entetes: {'Content-Type': 'application/json'}, corps: Buffer.alloc(8.5 * 1024 * 1024, 32)}).catch(e => ({code: 0, details: e.message}));
verifier('corps de plus de 8 Mo refusé', gros.code === 413 || gros.code === 0, String(gros.code));
const encore = await requete(port, {chemin: '/index.html'});
verifier('serveur toujours debout', encore.code === 200);

// ---------- Langue ----------
// Dictionnaire de la page : mêmes clés et mêmes types dans les deux langues, textes anglais traduits, textes français d'index.html
// identiques au dictionnaire (la page s'affiche avant de le lire), et plus aucun texte français en dur dans overlay.js.
const bac = {};
vm.runInNewContext(await readFile(path.join(PAGE, 'textes.js'), 'utf8'), {self: bac});
const D = bac.TEXTES_COPILOTE || {};
const cles = l => Object.keys(D[l] || {}).sort();
verifier('textes.js : mêmes clés et mêmes types en français et en anglais', cles('fr').length > 30 && JSON.stringify(cles('fr')) === JSON.stringify(cles('en'))
  && cles('fr').every(k => typeof D.fr[k] === typeof D.en[k]), `${cles('fr').length} clés`);
const nonTraduits = cles('fr').filter(k => k !== 'sources' && JSON.stringify(typeof D.fr[k] === 'function' ? D.fr[k](6400) : D.fr[k]) === JSON.stringify(typeof D.en[k] === 'function' ? D.en[k](6400) : D.en[k]));
verifier('textes.js : chaque texte anglais est traduit', !nonTraduits.length, nonTraduits.join(', ') || `ex. « ${D.fr.repondu?.(6400)} » / « ${D.en.repondu?.(6400)} »`);
const html = await readFile(path.join(PAGE, 'index.html'), 'utf8');
const balises = [...html.matchAll(/<(\w+)((?:\s[^>]*)?\sdata-t[^>]*)>([^<]*)/g)];
const ecarts = [];
for (const [, , attributs, contenu] of balises) {
  const attr = n => attributs.match(new RegExp(`\\s${n}="([^"]*)"`))?.[1];
  const [t, tt, ta] = [attr('data-t'), attr('data-t-title'), attr('data-t-aria')];
  if (t && contenu.trim() !== D.fr[t]) ecarts.push(`texte ${t}`);
  if (tt && attr('title') !== D.fr[tt]) ecarts.push(`title ${tt}`);
  if (ta && attr('aria-label') !== D.fr[ta]) ecarts.push(`aria-label ${ta}`);
  for (const k of [t, tt, ta]) if (k && typeof D.en[k] !== 'string') ecarts.push(`clé ${k} sans texte anglais`);
}
verifier('index.html : textes fixes en français = dictionnaire, tous traduisibles', balises.length >= 10 && !ecarts.length, ecarts.join(', ') || `${balises.length} balises`);
const overlay = (await readFile(path.join(PAGE, 'overlay.js'), 'utf8')).replace(/(^|\s)\/\/\s.*$/gm, '');   // sans les commentaires
const enDur = cles('fr').filter(k => typeof D.fr[k] === 'string' && D.fr[k].length > 8 && overlay.includes(D.fr[k]));
verifier('overlay.js : aucun texte français resté en dur', !enDur.length, enDur.join(', '));

// Page exécutée sans navigateur : faux DOM tiré d'index.html, faux pont Electron, faux fetch (rien ne sort). Vérifie qu'un
// changement de langue pendant l'écoute ou la réflexion garde l'étape en cours, que la question part avec sa langue, et que
// sans textes.js (fichier oublié dans un commit ou une copie) la page tourne quand même au lieu de mourir.
class FauxElement {
  constructor(balise = 'div', attrs = {}, texte = '') {
    const classes = new Set();
    Object.assign(this, {balise, attrs, _texte: texte, _titre: attrs.title || '', disabled: 'disabled' in attrs, dataset: {}, style: {setProperty() {}}, children: [],
      parentElement: {scrollHeight: 0, scrollTop: 0, clientHeight: 0}, classes});
    for (const [k, v] of Object.entries(attrs)) if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v;
    this.classList = {add: (...c) => c.forEach(x => classes.add(x)), remove: (...c) => c.forEach(x => classes.delete(x)), contains: c => classes.has(c),
      toggle: (c, oui = !classes.has(c)) => { if (oui) classes.add(c); else classes.delete(c); return oui; }};
  }
  // Comme le vrai DOM : tout ce qu'on écrit dans textContent ou title devient une chaîne.
  get textContent() { return this._texte; } set textContent(v) { this._texte = String(v); }
  get title() { return this._titre; } set title(v) { this._titre = String(v); }
  setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return this.attrs[k] ?? null; } removeAttribute(k) { delete this.attrs[k]; }
  addEventListener() {} append() {} closest() { return null; } setPointerCapture() {}
}
const sourceTextes = await readFile(path.join(PAGE, 'textes.js'), 'utf8'), sourceOverlay = await readFile(path.join(PAGE, 'overlay.js'), 'utf8');
async function pageSansNavigateur({recherche = '', avecTextes = true, capture = {ok: true}} = {}) {
  const elements = [...html.matchAll(/<(\w+)(\s[^>]*)?>([^<]*)/g)].map(([, balise, attributs = '', contenu]) =>
    new FauxElement(balise, Object.fromEntries([...attributs.matchAll(/\s([\w-]+)(?:="([^"]*)")?/g)].map(([, k, v]) => [k, v ?? ''])), contenu.trim()));
  const choisir = s => {
    if (s === '#sources ul') return e => e.balise === 'ul';
    if (/^\w+$/.test(s)) return e => e.balise === s;
    const [, id] = s.match(/^#([\w-]+)$/) || [], [, attr, valeur] = s.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/) || [];
    return id ? e => e.attrs.id === id : attr ? e => attr in e.attrs && (valeur === undefined || e.attrs[attr] === valeur) : () => false;
  };
  const document = {documentElement: elements.find(e => e.balise === 'html'), body: elements.find(e => e.balise === 'body'),
    querySelector: s => elements.find(choisir(s)) || null, querySelectorAll: s => elements.filter(choisir(s)), createElement: b => new FauxElement(b)};
  const rappels = {}, appels = [], erreurs = [], rejets = [];
  const pont = {onRaccourci: f => { rappels.raccourci = f; }, onEtat: f => { rappels.etat = f; }, agrandir() {}, deplacer() {}, finDeplacement() {}, ecoute() {},
    ouvrirLien() {}, voix: async () => true, basculerVoix: async () => true};
  const octets = new TextEncoder();
  const fauxFetch = async (url, options = {}) => {
    const corps = options.body ? JSON.parse(options.body) : null;
    appels.push({url, corps});
    if (url.startsWith('/api/jeu/etat')) return {json: async () => ({ck3: false, cle: {gemini: true}})};
    if (url.startsWith('/api/jeu/capturer')) return {json: async () => capture};
    // Question : une étape dans la langue demandée, puis le flux reste ouvert (la question est « en réflexion »).
    let lu = false;
    const etape = `data: ${JSON.stringify({type: 'etape', etape: 'reflexion', texte: corps?.langue === 'en' ? 'Thinking…' : 'Je réfléchis…'})}\n\n`;
    return {ok: true, status: 200, headers: {get: () => 'text/event-stream'},
      body: {getReader: () => ({read: () => lu ? new Promise(() => {}) : (lu = true, Promise.resolve({done: false, value: octets.encode(etape)}))})}};
  };
  const libre = f => (fn, ms) => { const t = f(fn, ms); t.unref?.(); return t; };   // minuteurs de la page : ne retiennent pas l'essai
  const ctx = vm.createContext({document, location: {search: recherche}, URLSearchParams, URL, TextDecoder, AbortController, performance, fetch: fauxFetch,
    setTimeout: libre(setTimeout), setInterval: libre(setInterval), clearTimeout, clearInterval, navigator: {mediaDevices: {getUserMedia: () => new Promise(() => {})}},
    console: {log() {}, warn() {}, error: (...a) => erreurs.push(a.join(' '))}});
  ctx.self = ctx.window = ctx; ctx.copilote = pont;
  const surRejet = e => rejets.push(e?.message || String(e));
  process.on('unhandledRejection', surRejet);
  let erreur = null;
  try { if (avecTextes) vm.runInContext(sourceTextes, ctx); vm.runInContext(sourceOverlay, ctx); } catch (e) { erreur = e.message; }
  const attendreUnPeu = () => new Promise(r => setTimeout(r, 40));
  await attendreUnPeu();
  const texteDe = s => document.querySelector(s)?.textContent;
  return {rappels, appels, erreurs, rejets, erreur, attendreUnPeu, texteDe, document, fin: () => process.off('unhandledRejection', surRejet)};
}

const p1 = await pageSansNavigateur({recherche: '?demo=sse'});
try {
  const avant = p1.texteDe('#statut');
  p1.rappels.raccourci({etat: 'appui'});
  await p1.attendreUnPeu();
  p1.rappels.etat({langue: 'en'});
  const ecoute = [p1.texteDe('#attente-texte'), p1.texteDe('#statut'), p1.document.documentElement.lang, p1.document.querySelector('#micro').title];
  verifier('page sans navigateur : langue changée pendant l\'écoute → « Listening… » gardé (pas « Looking at your screen… »)', !p1.erreur && avant === 'CK3 n\'est pas lancé'
    && JSON.stringify(ecoute) === JSON.stringify(['Listening…', 'Listening…', 'en', 'Ask a question (Ctrl+Shift+Space)']), p1.erreur || ecoute.join(' | '));
  p1.rappels.raccourci({etat: 'appui'});   // second appui : fin de la question, envoi
  await p1.attendreUnPeu();
  const question = p1.appels.find(a => a.url.startsWith('/api/jeu/question'));
  const enRoute = p1.texteDe('#attente-texte');
  p1.rappels.etat({langue: 'fr'});
  const apres = [p1.texteDe('#attente-texte'), p1.texteDe('#statut'), p1.texteDe('strong')];
  verifier('page sans navigateur : question envoyée avec sa langue, étape en cours gardée quand la langue change pendant la réflexion',
    question?.url === '/api/jeu/question?langue=en' && question?.corps?.langue === 'en' && enRoute === 'Thinking…'
    && JSON.stringify(apres) === JSON.stringify(['Thinking…', 'Thinking…', 'Copilote CK3']) && !p1.rejets.length, `${question?.url} · ${apres.join(' | ')}${p1.rejets.length ? ' · ' + p1.rejets.join(', ') : ''}`);
} finally { p1.fin(); }

const p2 = await pageSansNavigateur({avecTextes: false, capture: {ok: false, erreur: 'CK3 n\'est pas lancé', code: 'pas-lance', bloquant: true}});
try {
  p2.rappels.raccourci?.({etat: 'appui'});
  await p2.attendreUnPeu();
  p2.rappels.etat?.({langue: 'en'});
  const vu = {etat: p2.document.body.dataset.etat, erreur: p2.texteDe('#erreur'), statut: p2.texteDe('#statut'), nom: p2.texteDe('strong'), micro: p2.document.querySelector('#micro').title};
  verifier('page sans textes.js : elle tourne quand même (textes d\'index.html, erreur du serveur affichée, signalé dans app.log)', !p2.erreur && !p2.rejets.length
    && p2.erreurs.some(e => /textes\.js manquant/.test(e)) && vu.etat === 'reponse' && vu.erreur === 'CK3 n\'est pas lancé' && typeof vu.statut === 'string'
    && vu.nom === 'Copilote CK3' && vu.micro === 'Poser une question (Ctrl+Maj+Espace)', p2.erreur || p2.rejets.join(', ') || JSON.stringify(vu));
} finally { p2.fin(); }

// Démo factice en anglais (champ langue du corps, sinon ?langue=en) ; langue inconnue -> français.
const texteDe = s => s.evenements.filter(e => e.type === 'texte').map(e => e.delta).join('');
const etapesDe = s => s.evenements.filter(e => e.type === 'etape').map(e => e.texte);
const sseEn = await lireSse({texte: 'How do I get a hook?', voix: false, langue: 'en'});
verifier('SSE factice en anglais : étapes et réponse', etapesDe(sseEn)[0] === 'Looking at your screen…' && texteDe(sseEn).startsWith('Demo:') && texteDe(sseEn).includes('**Fabricate Hook**')
  && sseEn.evenements.at(-1)?.type === 'fin', etapesDe(sseEn).join(' | '));
const sseUrl = await lireSse({texte: 'test', voix: false}, port, '/api/jeu/question?langue=en');
verifier('SSE factice : ?langue=en sans champ langue → anglais', etapesDe(sseUrl)[0] === 'Looking at your screen…');
const sseDe = await lireSse({texte: 'test', voix: false, langue: 'de'});
verifier('SSE factice : langue inconnue (de) → français', etapesDe(sseDe)[0] === 'Je regarde ton écran…' && texteDe(sseDe).startsWith('Démonstration'));

// Vrai cerveau, CK3 fermé (fausse aide) et fausses clés : tout s'arrête avant le moindre appel réseau. Racine temporaire (journal
// des questions à part) ; l'index de l'Encyclopédie déjà construit est copié s'il existe, pour ne pas le refaire.
const {creerCopiloteJeu} = await import(pathToFileURL(path.join(PROJET, 'agent', 'copilote-jeu.mjs')).href);
const cache = path.join(PROJET, 'memoire', 'copilote-ck3');
await mkdir(path.join(racine, 'memoire', 'copilote-ck3'), {recursive: true});
for (const f of (await readdir(cache).catch(() => [])).filter(f => /^savoir-.*\.json$/.test(f))) await copyFile(path.join(cache, f), path.join(racine, 'memoire', 'copilote-ck3', f));
const aideFermee = {async etat() { return {ck3: false}; }, async capturer() { throw Object.assign(new Error('CK3 n\'est pas lancé'), {code: 'pas-lance'}); }};
const cerveau = creerCopiloteJeu({root: racine, env: {GEMINI_API_KEY: SECRET, OPENAI_API_KEY: SECRET + '-2'}, aide: aideFermee, journal});
const s4 = await demarrerServeur({root: racine, journal, copilote: cerveau});
try {
  const erreurDe = s => s.evenements.find(e => e.type === 'erreur')?.message;
  const qEn = await lireSse({texte: 'Why can\'t I declare war?', voix: false, langue: 'en'}, s4.port);
  verifier('vrai cerveau, CK3 fermé, anglais : étape puis erreur en anglais', etapesDe(qEn)[0] === 'Looking at your screen…' && erreurDe(qEn) === 'CK3 isn’t running'
    && qEn.evenements.at(-1)?.type === 'erreur', `${etapesDe(qEn).join(' | ')} → ${erreurDe(qEn)}`);
  const qFr = await lireSse({texte: 'Pourquoi je ne peux pas déclarer la guerre ?', voix: false}, s4.port);
  verifier('vrai cerveau, CK3 fermé, français (défaut) inchangé', etapesDe(qFr)[0] === 'Je regarde ton écran…' && erreurDe(qFr) === 'CK3 n\'est pas lancé', erreurDe(qFr));
  const qDe = await lireSse({texte: 'Warum?', voix: false, langue: 'de'}, s4.port);
  verifier('vrai cerveau : langue inconnue (de) → français', erreurDe(qDe) === 'CK3 n\'est pas lancé', erreurDe(qDe));
  const qUrl = await lireSse({texte: 'Why?', voix: false}, s4.port, '/api/jeu/question?langue=en');
  verifier('vrai cerveau : ?langue=en sans champ langue → anglais', erreurDe(qUrl) === 'CK3 isn’t running', erreurDe(qUrl));
  const qVide = await lireSse({texte: '  ', langue: 'en'}, s4.port);
  verifier('vrai cerveau : question vide → message anglais', erreurDe(qVide) === 'Ask your question out loud or in writing.', erreurDe(qVide));
  const wav = Buffer.alloc(44 + 32000);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + 32000, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(32000, 40);
  const qSilence = await lireSse({audio: wav.toString('base64'), langue: 'en'}, s4.port);
  const qSilenceFr = await lireSse({audio: wav.toString('base64')}, s4.port);
  verifier('vrai cerveau : silence → « I didn’t hear anything. » / « Je n’ai rien entendu. »', erreurDe(qSilence) === 'I didn’t hear anything.' && erreurDe(qSilenceFr) === 'Je n’ai rien entendu.', `${erreurDe(qSilence)} / ${erreurDe(qSilenceFr)}`);
  const capEn = JSON.parse((await requete(s4.port, {chemin: '/api/jeu/capturer?langue=en', methode: 'POST'})).corps);
  const capFr = JSON.parse((await requete(s4.port, {chemin: '/api/jeu/capturer', methode: 'POST'})).corps);
  verifier('capture à l\'appui, CK3 fermé : message dans la langue, code et « bloquant »', capEn.ok === false && capEn.erreur === 'CK3 isn’t running' && capEn.code === 'pas-lance' && capEn.bloquant === true
    && capFr.erreur === 'CK3 n\'est pas lancé' && capFr.bloquant === true, `${JSON.stringify(capEn)} / ${capFr.erreur}`);
  const jsonEn = await requete(s4.port, {chemin: '/api/jeu/question?langue=en', methode: 'POST', entetes: {'Content-Type': 'application/json'}, corps: '{x'});
  const jsonFr = await requete(s4.port, {chemin: '/api/jeu/question', methode: 'POST', entetes: {'Content-Type': 'application/json'}, corps: '{x'});
  verifier('corps JSON invalide : message dans la langue de l\'adresse', jsonEn.code === 400 && JSON.parse(jsonEn.corps).erreur === 'Invalid JSON body.' && JSON.parse(jsonFr.corps).erreur === 'Corps JSON invalide.');
  const etat4 = await cerveau.etat();
  verifier('vrai cerveau : joueur générique sans COPILOTE_PRENOM', process.env.COPILOTE_PRENOM ? etat4.joueur === 'prenom' : etat4.joueur === 'generique', etat4.joueur);
} finally { await s4.fermer(); }

// Autres pannes de l'aide Windows (code 'interne', réponse perdue) : en anglais une phrase anglaise, jamais le français de l'aide
// (le modèle anglais le recopiait) ; non bloquantes ; en français, le message de l'aide tel quel.
let pannesAide = 0;
const aidePanne = {async etat() { return {ck3: true}; }, async capturer() {
  throw ++pannesAide % 2 ? Object.assign(new Error('Aide Windows : InvalidOperationException : essai'), {code: 'interne'}) : new Error('Aide Windows : réponse perdue');
}};
const s6 = await demarrerServeur({root: racine, journal, copilote: creerCopiloteJeu({root: racine, env: {GEMINI_API_KEY: SECRET, OPENAI_API_KEY: SECRET + '-2'}, aide: aidePanne, journal})});
try {
  const capturer = async l => JSON.parse((await requete(s6.port, {chemin: `/api/jeu/capturer${l ? `?langue=${l}` : ''}`, methode: 'POST'})).corps);
  const [interneEn, perdueEn, interneFr] = [await capturer('en'), await capturer('en'), await capturer()];
  verifier('aide Windows en panne (interne, réponse perdue) : phrase anglaise non bloquante en anglais, français inchangé', interneEn.erreur === 'Windows helper error'
    && interneEn.code === 'interne' && interneEn.bloquant === false && perdueEn.erreur === 'Windows helper error' && perdueEn.bloquant === false
    && interneFr.erreur === 'Aide Windows : InvalidOperationException : essai' && interneFr.bloquant === false, `${interneEn.erreur} / ${perdueEn.erreur} / ${interneFr.erreur}`);
} finally { await s6.fermer(); }

// Cerveau absent (racine sans agent/) : son message d'erreur suit aussi ?langue=.
if (process.env.COPILOTE_ESSAI_STUB !== '1') {
  const s5 = await demarrerServeur({root: racine, journal});
  try {
    const etatEn = JSON.parse((await requete(s5.port, {chemin: '/api/jeu/etat?langue=en'})).corps);
    const qEn = await lireSse({texte: 'test'}, s5.port, '/api/jeu/question?langue=en');
    const qFr = await lireSse({texte: 'test'}, s5.port);
    const m = s => s.evenements.find(e => e.type === 'erreur')?.message || '';
    verifier('cerveau absent : message en anglais avec ?langue=en, en français sinon', /^The copilot's brain failed to load/.test(etatEn.erreur || '') && /^The copilot's brain failed to load/.test(m(qEn))
      && /^Le cerveau du copilote ne s'est pas chargé/.test(m(qFr)), (etatEn.erreur || '').slice(0, 40));
  } finally { await s5.fermer(); }
}

// Le vrai cerveau (agent/copilote-jeu.mjs), s'il existe déjà : seulement GET /api/jeu/etat (gratuit, sans capture ni API).
const s3 = await demarrerServeur({root: PROJET, journal, aide: null});
try {
  const r = await requete(s3.port, {chemin: '/api/jeu/etat'});
  let j = null; try { j = JSON.parse(r.corps); } catch {}
  verifier('vrai cerveau : GET /api/jeu/etat répond', r.code === 200 && j && 'ck3' in j, j ? JSON.stringify({ck3: j.ck3, version: j.version, cle: j.cle, voix: j.voix, extensions: j.extensions && {possedees: j.extensions.possedees?.length, manquantes: j.extensions.manquantes?.length}, erreur: j.erreur}) : `${r.code}`);
} finally { await s3.fermer(); }

const fuite = lignesJournal.some(l => l.includes(SECRET));
verifier('aucune clé dans le journal', !fuite, `${lignesJournal.length} lignes`);

if (garder) {
  console.log(`\nServeur factice laissé ouvert : http://127.0.0.1:${port}/index.html?demo=sse  (Ctrl+C pour arrêter)`);
} else {
  await s1.fermer();
  await rm(racine, {recursive: true, force: true});
  const echecs = resultats.filter(r => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications réussies`);
  process.exit(echecs.length ? 1 : 0);
}
