// Essai du cerveau du copilote CK3 (agent/copilote-jeu.mjs + agent/copilote-ck3-savoir.mjs), sans Electron ni aide Windows.
// Aucune vraie capture : une fausse aide renvoie l'image synthétique ck3-test.jpg. Coût réel : quelques cents (Gemini, un appel OpenAI).
// Usage : node essai-cerveau.mjs [savoir,a,b,suite,annulation,silence,erreurs,secours,regard,regard-reel] [--image=chemin.jpg] [--regenerer]
//         [--question="…"] [--langue=en] [--sans-voix]
// (savoir, erreurs et regard ne coûtent rien ; secours fait UN appel OpenAI ; les autres appellent Gemini.)
// regard (07/10/2026) : le regard pendant la question, avec une fausse aide qui joue des scènes (info-bulle qui apparaît, écran
// immobile, CK3 quitté, CK3 fermé, souris immobile avant l'appui, impressions lentes, son muet, capture de l'appui ratée) et un
// faux Google qui garde la requête envoyée : images choisies, libellés, résolutions, annulation, vues d'un appui précédent jamais
// utilisées, ralentissement et arrêt du regard. regard-reel (UNE question à Gemini, ~1 cent, hors de la liste par
// défaut) : la vraie aide regarde le vrai CK3 6 s (aucune touche, aucune fenêtre), puis une question écrite (--parle : la question
// parlée d'essai, avec la voix).
// --langue=en (06/10/2026) : questions écrites posées en anglais ; l'étape a vérifie alors la langue de la réponse et le gras.
import {readFile, writeFile, access, mkdir, readdir, copyFile, mkdtemp, rm} from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(ICI, '..');
const SCRATCH = os.tmpdir();   // image d'essai : --image=capture-ck3.jpg, sinon ck3-test.jpg dans le dossier temporaire
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const IMAGE = arg('image') || path.join(SCRATCH, 'ck3-test.jpg');
const ZOOM = path.join(path.dirname(IMAGE), 'ck3-test-720.jpg');
const WAV = path.join(ICI, 'question-test.wav');
const QUESTION_PARLEE = 'Le bouton pour déclarer la guerre est grisé. Comment je fais pour attaquer ce comte quand même ?';
const LANGUE = arg('langue') === 'en' ? 'en' : 'fr';
const VOIX = !process.argv.includes('--sans-voix');
const QUESTION_ECRITE = arg('question') || (LANGUE === 'en' ? 'Why can\'t I declare war on Guilhem of Toulouse?' : 'Pourquoi je ne peux pas déclarer la guerre à Guilhem de Toulouse ?');   // --question="…" pour une autre
const ETAPES = (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'savoir,a,b,suite,annulation,silence,erreurs,secours,regard').split(',');

// Langue d'une réponse, à la louche : mots outils français contre anglais, hors libellés en gras (anglais dans les deux langues).
function langueDe(texte) {
  const mots = String(texte).replace(/\*\*[^*]+\*\*/g, ' ').toLowerCase().match(/[a-zàâçéèêëîïôûùüÿœ']+/g) || [];
  const FR = new Set('le la les de des du un une et est tu ton ta tes te pour pas dans sur que qui avec il elle ce cette son sa ses au aux ou mais plus ne'.split(' '));
  const EN = new Set('the a an and is are you your to of on in for with not can it this that they their be if or but there'.split(' '));
  const fr = mots.filter(m => FR.has(m)).length, en = mots.filter(m => EN.has(m)).length;
  return {langue: fr > en ? 'fr' : 'en', fr, en};
}

const {chargerSavoirCk3} = await import(pathToFileURL(path.join(ROOT, 'agent', 'copilote-ck3-savoir.mjs')));
const {creerCopiloteJeu, choisirVues} = await import(pathToFileURL(path.join(ROOT, 'agent', 'copilote-jeu.mjs')));

// .env lu ici sans jamais afficher les valeurs.
const env = {};
for (const ligne of (await readFile(path.join(ROOT, '.env'), 'utf8')).split(/\r?\n/)) {
  const m = ligne.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
console.log('Clés présentes :', {gemini: !!env.GEMINI_API_KEY, openai: !!env.OPENAI_API_KEY});

const existe = f => access(f).then(() => true, () => false);
const wav16 = (pcm, taux = 16000) => {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(taux, 24); h.writeUInt32LE(taux * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
};
// 24 kHz -> 16 kHz (rapport 2/3) : petit filtre passe-bas (moyenne sur 3 points) puis interpolation linéaire.
function reechantillonner(pcm24) {
  const src = new Int16Array(pcm24.buffer, pcm24.byteOffset, Math.floor(pcm24.length / 2));
  const lisse = Float32Array.from(src, (v, i) => ((src[i - 1] ?? v) + 2 * v + (src[i + 1] ?? v)) / 4);
  const n = Math.floor(src.length * 2 / 3), out = new Int16Array(n);
  for (let i = 0; i < n; i++) { const p = i * 1.5, a = Math.floor(p), f = p - a; out[i] = Math.round(lisse[a] * (1 - f) + (lisse[a + 1] ?? lisse[a]) * f); }
  return Buffer.from(out.buffer);
}

// Question parlée de test : générée UNE fois avec la voix Gemini (API Interactions, son PCM 24 kHz), gardée pour les phases suivantes.
async function questionParlee() {
  if (await existe(WAV) && !process.argv.includes('--regenerer')) return readFile(WAV);
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {method: 'POST', headers: {'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY},
    body: JSON.stringify({model: 'gemini-3.8-flash-lite-tts', input: [{type: 'user_input', content: [{type: 'text', text: QUESTION_PARLEE}]}], response_format: {type: 'audio'},
      generation_config: {speech_config: [{voice: 'Kore'}]}, stream: true})});
  if (!r.ok) throw new Error(`TTS ${r.status} ${(await r.text()).slice(0, 200)}`);
  const morceaux = [], dec = new TextDecoder(); let buf = '';
  for await (const b of r.body) {
    buf += dec.decode(b, {stream: true}).replace(/\r/g, '');
    let i; while ((i = buf.indexOf('\n\n')) >= 0) {
      const data = buf.slice(0, i).split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join(''); buf = buf.slice(i + 2);
      if (!data || data === '[DONE]') continue;
      const j = JSON.parse(data);
      if (j.event_type === 'step.delta' && j.delta?.type === 'audio') { if (j.delta.sample_rate !== 24000) throw new Error('taux inattendu ' + j.delta.sample_rate); morceaux.push(Buffer.from(j.delta.data, 'base64')); }
    }
  }
  const wav = wav16(reechantillonner(Buffer.concat(morceaux)));
  await writeFile(WAV, wav);
  console.log(`Question parlée générée : ${WAV} (${((wav.length - 44) / 32000).toFixed(1)} s, 16 kHz mono)`);
  return wav;
}

const image = await readFile(IMAGE);
const fausseAide = (opts = {}) => ({
  async etat() { return {ck3: true, hwnd: 1, rect: {x: 0, y: 0, w: 1920, h: 1080}, minimise: false, premierPlan: true, ecran: {w: 1920, h: 1080}}; },
  async capturer() {
    if (opts.erreur) throw new Error(opts.erreur);
    return {plein: image, zoom: opts.zoom || null, curseur: opts.zoom ? {x: 1270, y: 1020} : null, largeur: 2560, hauteur: 1440, ecartType: 48, ms: 3};
  },
});

// Pose une question et affiche la suite d'événements, la réponse, les temps et le coût.
async function poser(copilote, titre, options) {
  console.log(`\n=== ${titre} ===`);
  const t0 = Date.now(), suite = [], pcm = [];
  let texte = '', premierAudio = null, premierTexte = null, fin = null, question = null, sources = null;
  for await (const ev of copilote.poser(options)) {
    const t = Date.now() - t0;
    if (ev.type === 'audio') { if (premierAudio === null) { premierAudio = t; suite.push(`audio#${ev.index}@${t}ms…`); } pcm.push(Buffer.from(ev.pcm, 'base64')); continue; }
    if (ev.type === 'texte') { if (premierTexte === null) { premierTexte = t; suite.push(`texte@${t}ms…`); } texte += ev.delta; continue; }
    if (ev.type === 'question') question = ev.texte;
    if (ev.type === 'sources') sources = ev;
    if (ev.type === 'fin') fin = ev;
    suite.push(`${ev.type}${ev.etape ? ':' + ev.etape : ''}@${t}ms${ev.texte && ev.type === 'etape' ? ` « ${ev.texte} »` : ''}${ev.message ? ` « ${ev.message} »` : ''}`);
  }
  console.log('Événements :', suite.join(' → '));
  if (question) console.log('Question :', question);
  if (texte) console.log(`Réponse (${texte.split(/\s+/).filter(Boolean).length} mots) :\n${texte}`);
  if (sources) console.log('Sources :', sources.liens.map(l => l.titre).join(', ') || '(aucune)', '| suggestions Google :', sources.suggestionsHtml ? `${sources.suggestionsHtml.length} car. de HTML` : 'non');
  const audio = Buffer.concat(pcm);
  if (audio.length) {
    const f = path.join(os.tmpdir(), `copilote-ck3-${titre.replace(/\W+/g, '-').slice(0, 30)}.wav`);
    await writeFile(f, wav16(audio, 24000));
    console.log(`Voix : ${(audio.length / 48000).toFixed(1)} s de son en ${pcm.length} morceaux, premier son à ${premierAudio} ms (écoute : ${f})`);
  }
  console.log(`Temps : premier texte ${premierTexte ?? '-'} ms, premier son ${premierAudio ?? '-'} ms, total ${Date.now() - t0} ms ; coût estimé ${fin ? fin.coutCents + ' cent(s)' : '-'}`);
  return {texte, fin, suite};
}

let total = 0;
const derniereLigneJournal = async () => {
  const f = path.join(ROOT, 'journal', 'copilote-ck3', `questions-${new Intl.DateTimeFormat('fr-CA').format(new Date()).slice(0, 7)}.jsonl`);
  const l = (await readFile(f, 'utf8')).trim().split('\n').pop();
  const j = JSON.parse(l);
  console.log('Journal :', JSON.stringify({modeles: j.modeles, jetons: j.jetons, durees: j.durees, recherches: j.recherches, extraits: j.extraits?.length, coutCents: j.coutCents, secours: j.secours, erreur: j.erreur}));
  return j;
};

if (ETAPES.includes('savoir')) {
  console.log('\n=== Savoir CK3 (installation réelle) ===');
  const t0 = Date.now();
  const s = await chargerSavoirCk3({root: ROOT});
  console.log(`Version ${s.version} (${s.nomVersion}), dossier ${s.dossierJeu}, chargé en ${Date.now() - t0} ms`);
  console.log('Comptes :', JSON.stringify(s.compte));
  console.log(`Extensions possédées : ${s.extensions.possedees.join(', ') || 'aucune'} ; manquantes : ${s.extensions.manquantes.length}`);
  for (const terme of ['truce', 'hook', 'claim']) {
    const r = s.chercher([terme], '', 6000);
    console.log(`\n« ${terme} » -> ${r.length} extraits, ${r.reduce((n, e) => n + e.texte.length, 0)} car. : ${r.slice(0, 5).map(e => e.titre).join(' | ')}`);
    console.log('  ', r[0]?.texte.slice(0, 260).replace(/\n+/g, ' / '));
  }
  const fr = s.chercher([], 'comment je fabrique un hameçon sur mon vassal ?', 6000);
  console.log(`\nQuestion française sans termes (lexique) -> ${fr.slice(0, 4).map(e => e.titre).join(' | ')}`);
  const dlc = s.chercher(['Puppet'], '', 6000)[0];
  console.log(`Notion payante -> ${dlc?.titre} : ${dlc?.texte.slice(0, 90)}…`);
}

if (ETAPES.includes('a') || ETAPES.includes('b')) {
  const copilote = creerCopiloteJeu({root: ROOT, env, aide: fausseAide()});
  console.log('\nÉtat :', JSON.stringify(await copilote.etat()).slice(0, 300));
  if (ETAPES.includes('a')) {
    const r = await poser(copilote, `(a) question écrite (${LANGUE}), ${VOIX ? 'avec' : 'sans'} voix`, {texte: QUESTION_ECRITE, voix: VOIX, langue: LANGUE});
    total += r.fin?.coutCents || 0; await derniereLigneJournal();
    // Langue de la réponse, libellés en gras, et en anglais pas de traduction entre parenthèses après un libellé.
    const l = langueDe(r.texte), gras = r.texte.match(/\*\*[^*\n]+\*\*/g) || [], parentheses = r.texte.match(/\*\*[^*\n]+\*\*\s*\([^()\n]{1,40}\)/g) || [];
    const etapes = r.suite.filter(s => s.startsWith('etape:')).map(s => s.match(/« (.*) »/)?.[1]).filter(Boolean);
    console.log(`Contrôle : langue ${l.langue} (mots outils fr ${l.fr} / en ${l.en}), attendue ${LANGUE} -> ${l.langue === LANGUE ? 'OK' : 'ÉCHEC'} ; ${gras.length} libellé(s) en gras ${gras.length ? 'OK' : 'ÉCHEC'}`
      + (LANGUE === 'en' ? ` ; traductions entre parenthèses : ${parentheses.length} ${parentheses.length ? 'ÉCHEC' : 'OK'}` : '') + ` ; étapes : ${etapes.join(' | ')}`);
  }
  if (ETAPES.includes('b')) {
    const wav = await questionParlee();
    const zoom = await readFile(ZOOM).catch(() => null);
    const c2 = creerCopiloteJeu({root: ROOT, env, aide: fausseAide({zoom})});
    const r = await poser(c2, '(b) question parlée, avec zoom et voix', {audio: wav.toString('base64'), voix: true});
    total += r.fin?.coutCents || 0; await derniereLigneJournal();
  }
}

if (ETAPES.includes('suite')) {
  // Mémoire de la conversation : la relance n'a de sens qu'avec la question précédente (texte seul, sans voix).
  const copilote = creerCopiloteJeu({root: ROOT, env, aide: fausseAide()});
  const r1 = await poser(copilote, '(suite 1) question écrite, sans voix', {texte: QUESTION_ECRITE, voix: false});
  const r2 = await poser(copilote, '(suite 2) relance', {texte: 'Et si je veux quand même l’attaquer maintenant, ça me coûte quoi ?', voix: false});
  total += (r1.fin?.coutCents || 0) + (r2.fin?.coutCents || 0);
}

if (ETAPES.includes('annulation')) {
  // Ameur repose une question ou ferme la page : tout s'arrête au premier mot de la réponse, rien n'est rendu ensuite.
  const copilote = creerCopiloteJeu({root: ROOT, env, aide: fausseAide()});
  const ctrl = new AbortController(), suite = [], t0 = Date.now();
  for await (const ev of copilote.poser({texte: QUESTION_ECRITE, voix: true, signal: ctrl.signal})) {
    suite.push(`${ev.type}${ev.etape ? ':' + ev.etape : ''}@${Date.now() - t0}ms`);
    if (ev.type === 'texte' && !ctrl.signal.aborted) ctrl.abort();
  }
  console.log('\n=== annulation au premier mot ===\nÉvénements :', suite.join(' → '), `; fin du flux ${Date.now() - t0} ms`);
  const j = await derniereLigneJournal(); total += j.coutCents || 0;
}

if (ETAPES.includes('silence')) {
  // Silence parfait : refusé sur place, sans appel. Souffle léger (-40 dBFS, au-dessus du seuil local) : c'est Google qui doit dire « rien ».
  const copilote = creerCopiloteJeu({root: ROOT, env, aide: fausseAide()});
  const souffle = Buffer.alloc(48000);
  for (let i = 0; i < souffle.length; i += 2) souffle.writeInt16LE(Math.round((Math.random() * 2 - 1) * 570), i);
  for (const [titre, pcm] of [['silence parfait (1 s)', Buffer.alloc(32000)], ['souffle léger (1,5 s)', souffle]]) {
    const r = await poser(copilote, titre, {audio: wav16(pcm).toString('base64'), voix: true});
    console.log(r.suite.some(s => s.includes('rien entendu')) ? 'OK : « Je n’ai rien entendu »' : 'ATTENTION : silence non détecté');
    const j = await derniereLigneJournal(); total += j.coutCents || 0;
  }
}

if (ETAPES.includes('erreurs')) {
  // Sans appel payant : CK3 fermé, puis la route HTTP réelle (SSE, état, oubli, corps invalide ou trop lourd).
  const copilote = creerCopiloteJeu({root: ROOT, env, aide: fausseAide({erreur: 'CK3 n\'est pas lancé'})});
  await poser(copilote, 'CK3 fermé (aucun appel payant)', {texte: QUESTION_ECRITE});
  const serveur = http.createServer(async (req, res) => { const url = new URL(req.url, 'http://127.0.0.1'); if (!(await copilote.route(url, req, res))) { res.writeHead(404); res.end(); } });
  await new Promise(ok => serveur.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${serveur.address().port}`;
  const etat = await fetch(`${base}/api/jeu/etat`).then(r => r.json());
  console.log('\nGET /api/jeu/etat ->', JSON.stringify(etat).slice(0, 200));
  console.log('POST /api/jeu/oublier ->', await fetch(`${base}/api/jeu/oublier`, {method: 'POST'}).then(r => r.text()));
  console.log('POST /api/jeu/question (JSON invalide) ->', (await fetch(`${base}/api/jeu/question`, {method: 'POST', body: '{x'})).status);
  console.log('POST /api/jeu/question (9 Mo) ->', (await fetch(`${base}/api/jeu/question`, {method: 'POST', body: 'x'.repeat(9 * 1024 * 1024)}).catch(e => ({status: e.message}))).status);
  const r = await fetch(`${base}/api/jeu/question`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({texte: QUESTION_ECRITE})});
  console.log('POST /api/jeu/question (SSE) ->', r.status, r.headers.get('content-type'), JSON.stringify(await r.text()));
  console.log('GET /api/autre ->', await copilote.route(new URL('http://127.0.0.1/api/autre'), {}, {}));
  serveur.close();
}

if (ETAPES.includes('secours')) {
  // Panne forcée de Google (modèle inexistant) : UN appel OpenAI (gpt-6-luna + recherche web), sans voix.
  const copilote = creerCopiloteJeu({root: ROOT, env, aide: fausseAide(), modeles: {reponse: 'gemini-modele-inexistant'}});
  const r = await poser(copilote, 'secours OpenAI (Gemini en panne forcée)', {texte: QUESTION_ECRITE, voix: false});
  total += r.fin?.coutCents || 0; await derniereLigneJournal();
}

// Racine temporaire pour le regard : le journal des questions et la capture de dépannage n'y touchent pas ceux d'Ameur ; l'index de
// l'Encyclopédie déjà construit est copié pour ne pas le refaire.
async function racineTemporaire() {
  const racine = await mkdtemp(path.join(os.tmpdir(), 'copilote-regard-'));
  await mkdir(path.join(racine, 'memoire', 'copilote-ck3'), {recursive: true});
  const cache = path.join(ROOT, 'memoire', 'copilote-ck3');
  for (const f of (await readdir(cache).catch(() => [])).filter(f => /^savoir-.*\.json$/.test(f))) await copyFile(path.join(cache, f), path.join(racine, 'memoire', 'copilote-ck3', f));
  return racine;
}
const journalDe = async racine => {
  const f = path.join(racine, 'journal', 'copilote-ck3', `questions-${new Intl.DateTimeFormat('fr-CA').format(new Date()).slice(0, 7)}.jsonl`);
  return (await readFile(f, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
};

if (ETAPES.includes('regard')) {
  console.log('\n=== Regard pendant la question (fausse aide, faux Google : aucun appel payant) ===');
  const racine = await racineTemporaire();
  const resultats = [];
  const verifier = (nom, ok, details = '') => { resultats.push(ok); console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${nom}${details ? ' : ' + details : ''}`); };
  const pause = ms => new Promise(r => setTimeout(r, ms));
  const silencieux = {log() {}, warn() {}, error() {}};
  // Empreintes de scènes : fond uni ; une « info-bulle » = 15 cases plus claires (k choisit leur place).
  const fond = () => Buffer.alloc(576, 90);
  const bulle = k => { const s = fond(); for (let i = 0; i < 15; i++) s[(k * 37 + i * 3) % 576] = 210; return s; };
  const scene = (nom, signature, extra = {}) => ({nom, signature, curseur: {x: 900, y: 500}, immobileMs: 0, devant: true, ...extra});
  // Fausse aide : la scène courante change au fil du temps comme l'écran d'Ameur ; capturer({jeton}) rend la vue de cet aperçu.
  // msImpression de la scène : durée annoncée du PrintWindow (lenteur simulée) ; quand : début de chaque aperçu (rythme).
  function aideScenes(depart) {
    const a = {courante: depart, appels: {apercu: 0, capturer: 0, jeton: 0, liberer: 0}, jetons: new Map(), n: 0, quand: []};
    const vue = s => ({plein: Buffer.from(`plein-${s.nom}`), zoom: Buffer.from(`zoom-${s.nom}`), curseur: s.curseur, curseurSurJeu: true, largeur: 1920, hauteur: 1080,
      signature: s.signature, immobileMs: s.immobileMs, ms: 2, msImpression: s.msImpression});
    Object.assign(a, {
      async etat() { return {ck3: true}; },
      async capturer(o = {}) {
        a.appels.capturer++;
        if (o.jeton) { a.appels.jeton++; const s = a.jetons.get(o.jeton); if (!s) throw Object.assign(new Error('Aperçu de CK3 périmé'), {code: 'perimee'}); return vue(s); }
        if (a.courante.erreur) throw Object.assign(new Error(a.courante.erreur), {code: a.courante.code});
        return vue(a.courante);
      },
      async apercu() {
        a.appels.apercu++; a.quand.push(Date.now());
        const s = a.courante;
        if (s.erreur) throw Object.assign(new Error(s.erreur), {code: s.code});
        if (!s.devant) return {premierPlan: false, immobileMs: 0};
        a.jetons.set(++a.n, s);
        return {premierPlan: true, signature: s.signature, curseur: s.curseur, curseurSurJeu: true, immobileMs: s.immobileMs, jeton: a.n, msImpression: s.msImpression};
      },
      async liberer() { a.appels.liberer++; return {libere: true}; },
    });
    return a;
  }
  // Faux Google : garde chaque requête, répond une phrase en flux SSE.
  const requetes = [], vraiFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) throw new Error(`appel inattendu pendant l'essai : ${url}`);
    requetes.push({url: String(url), corps: JSON.parse(options.body)});
    const sse = `data: ${JSON.stringify({candidates: [{content: {parts: [{text: 'Réponse factice.'}]}, finishReason: 'STOP'}], usageMetadata: {promptTokenCount: 100, candidatesTokenCount: 3}})}\n\n`;
    return new Response(sse, {status: 200, headers: {'Content-Type': 'text/event-stream'}});
  };
  // Ce que le modèle de réponse a reçu : textes, images (décodées : « plein-B »...) et leur résolution.
  const recu = () => {
    const parts = requetes.at(-1)?.corps.contents.at(-1).parts || [];
    return {textes: parts.filter(p => p.text).map(p => p.text), images: parts.filter(p => p.inline_data).map(p => `${Buffer.from(p.inline_data.data, 'base64')}@${p.mediaResolution?.level?.replace('MEDIA_RESOLUTION_', '')}`)};
  };
  const copiloteAvec = aide => creerCopiloteJeu({root: racine, env: {GEMINI_API_KEY: 'cle-factice'}, aide, journal: silencieux, reglagesRegard: {periode: 60, periodeCourte: 40}});
  const question = async (c, texte = 'Je te montre ça, tu vois ?') => { const ev = []; for await (const e of c.poser({texte, voix: false})) ev.push(e); return ev; };
  const A = scene('A', fond()), B = scene('B', bulle(1), {immobileMs: 650});
  try {
    // 1. Info-bulle qui apparaît au milieu de la question puis disparaît : elle est choisie et datée, la fin (= début) n'est pas doublée.
    let aide = aideScenes(A), c = copiloteAvec(aide);
    await c.precapturer('essai-1');
    await pause(200); aide.courante = B;
    await pause(150); aide.courante = {...B, immobileMs: 1300};
    await pause(150); aide.courante = A;
    await pause(200);
    let ev = await question(c), r = recu();
    const libelle2 = r.textes.find(t => t.startsWith('Image 2/2')) || '';
    verifier('info-bulle au milieu de la question → choisie et datée', ev.at(-1)?.type === 'fin' && JSON.stringify(r.images) === JSON.stringify(['plein-A@HIGH', 'zoom-A@HIGH', 'plein-B@HIGH', 'zoom-B@HIGH'])
      && /^Image 1\/2, quand il a appuyé pour parler/.test(r.textes.find(t => t.startsWith('Image 1/2')) || '') && /s après le début de sa question ; souris immobile depuis 1,3 s/.test(libelle2)
      // Rien d'affirmé sur l'info-bulle : elle a PU s'ouvrir (la carte n'en a pas).
      && libelle2.includes('(si l\'élément survolé a une info-bulle, elle a eu le temps de s\'ouvrir)')
      && r.textes.some(t => t.startsWith('Voici 2 captures') && t.includes('MONTRER') && !t.includes('immobile sur une info-bulle')), `${r.images.join(' ')} | « ${libelle2} »`);
    let j = (await journalDe(racine)).at(-1);
    verifier('journal : images envoyées et résumé du regard', j.images === 4 && j.regard?.choisies?.length === 2 && j.regard.gardees === 3 && j.regard.apercus >= 8, JSON.stringify({images: j.images, regard: j.regard}));

    // 2. Écran identique toute la question : une seule image, textes d'avant mot pour mot.
    aide = aideScenes(A); c = copiloteAvec(aide);
    await c.precapturer('essai-2');
    await pause(400);
    ev = await question(c); r = recu();
    verifier('écran inchangé → 1 image + zoom, textes d\'avant', JSON.stringify(r.images) === JSON.stringify(['plein-A@HIGH', 'zoom-A@HIGH']) && aide.appels.jeton === 0
      && r.textes[0].startsWith('Capture de la fenêtre de Crusader Kings III prise quand il a appuyé pour poser sa question (1920×1080) :'), `${r.images.join(' ')} ; ${aide.appels.apercu} aperçus, ${aide.appels.jeton} encodage(s)`);

    // 3. Annulation par la page (route HTTP, id de l'appui) : plus aucun aperçu, aperçu de l'aide libéré, la question suivante
    //    (sans appui) repart d'une capture neuve.
    aide = aideScenes(B); c = copiloteAvec(aide);
    const serveur = http.createServer(async (req, res) => { const url = new URL(req.url, 'http://127.0.0.1'); if (!(await c.route(url, req, res))) { res.writeHead(404); res.end(); } });
    await new Promise(ok => serveur.listen(0, '127.0.0.1', ok));
    const base = `http://127.0.0.1:${serveur.address().port}`;
    const cap = await vraiFetch(`${base}/api/jeu/capturer?regard=page-3`, {method: 'POST'}).then(x => x.json());
    await pause(250);
    const autre = await vraiFetch(`${base}/api/jeu/regard/arret?regard=autre-appui`, {method: 'POST'}).then(x => x.json());
    const apercusAvant = aide.appels.apercu;
    await pause(100);
    const continue_ = aide.appels.apercu > apercusAvant;
    const arret = await vraiFetch(`${base}/api/jeu/regard/arret?regard=page-3`, {method: 'POST'}).then(x => x.json());
    const n0 = aide.appels.apercu;
    await pause(400);
    serveur.close();
    aide.courante = A;
    ev = await question(c); r = recu();
    verifier('annulation : le regard s\'arrête (et pas sur l\'id d\'un autre appui), la question suivante capture à neuf', cap.ok && autre.arrete === false && continue_ && arret.arrete === true
      && aide.appels.apercu === n0 && aide.appels.liberer >= 1 && JSON.stringify(r.images) === JSON.stringify(['plein-A@HIGH', 'zoom-A@HIGH']) && r.textes[0].includes('prise au moment de la question'),
      `${n0} aperçus à l'arrêt, ${aide.appels.apercu} 400 ms plus tard, libérations ${aide.appels.liberer} ; ${r.images.join(' ')}`);

    // 4. Vues d'un appui précédent jamais utilisées : appui 1 sur une info-bulle, nouvel appui sur un écran sans elle.
    aide = aideScenes(B); c = copiloteAvec(aide);
    await c.precapturer('appui-1');
    await pause(200);
    aide.courante = A;
    await c.precapturer('appui-2');
    await pause(200);
    const vieux = c.arreterRegard('appui-1');
    await pause(150);
    ev = await question(c); r = recu();
    verifier('vues d\'avant l\'appui jamais utilisées', vieux === false && !r.images.some(i => i.includes('-B')) && JSON.stringify(r.images) === JSON.stringify(['plein-A@HIGH', 'zoom-A@HIGH']), r.images.join(' '));

    // 5. CK3 quitté pendant la question (autre appli au premier plan) : rien n'est encodé.
    aide = aideScenes(A); c = copiloteAvec(aide);
    await c.precapturer('essai-5');
    await pause(80); aide.courante = {...B, devant: false};
    await pause(300);
    ev = await question(c); r = recu(); j = (await journalDe(racine)).at(-1);
    verifier('CK3 pas au premier plan → aucune image prise', aide.appels.jeton === 0 && r.images.length === 2 && j.regard.horsJeu >= 3, `${j.regard.horsJeu} aperçus hors jeu, ${aide.appels.jeton} encodage(s)`);

    // 6. Six écrans différents : 4 vues au plus, la première est celle de l'appui ; à 3 vues ou plus, seule la principale part
    //    entière en haute résolution, les zooms toujours.
    aide = aideScenes(A); c = copiloteAvec(aide);
    await c.precapturer('essai-6');
    for (let k = 2; k <= 7; k++) { await pause(130); aide.courante = scene(`C${k}`, bulle(k), {immobileMs: k === 4 ? 900 : 100}); }
    await pause(150);
    ev = await question(c); r = recu(); j = (await journalDe(racine)).at(-1);
    const pleins = r.images.filter(i => i.startsWith('plein-')), hautes = pleins.filter(i => i.endsWith('@HIGH'));
    verifier('6 écrans → 4 vues au plus, appui en premier, une seule vue entière en haute résolution', pleins.length === 4 && pleins[0].startsWith('plein-A') && hautes.length === 1
      && r.images.filter(i => i.startsWith('zoom-')).every(i => i.endsWith('@HIGH')) && pleins.some(i => i.startsWith('plein-C4')), `${r.images.join(' ')} ; gardées ${j.regard.gardees}`);

    // 7. CK3 fermé pendant la question : le regard s'arrête, la question part avec les vues déjà prises.
    aide = aideScenes(A); c = copiloteAvec(aide);
    await c.precapturer('essai-7');
    await pause(150); aide.courante = B;
    await pause(150); aide.courante = {erreur: 'CK3 n\'est pas lancé', code: 'pas-lance'};
    await pause(150);
    const nFerme = aide.appels.apercu;
    await pause(200);
    ev = await question(c); r = recu();
    verifier('CK3 fermé en route : regard arrêté, vues gardées envoyées', aide.appels.apercu === nFerme && ev.at(-1)?.type === 'fin' && r.images.includes('plein-B@HIGH'), `${r.images.join(' ')}`);

    // 7 bis. CK3 réduit un instant (Alt+Tab) puis de retour : le regard attend et reprend.
    aide = aideScenes(A); c = copiloteAvec(aide);
    await c.precapturer('essai-7b');
    await pause(100); aide.courante = {erreur: 'CK3 est réduit', code: 'reduit'};
    await pause(250); aide.courante = B;
    await pause(250);
    ev = await question(c); r = recu(); j = (await journalDe(racine)).at(-1);
    verifier('CK3 réduit un instant : le regard reprend à son retour', r.images.includes('plein-B@HIGH') && j.regard.horsJeu >= 2, `${r.images.join(' ')} ; ${j.regard.horsJeu} aperçus hors jeu`);

    // 8. Fausse aide sans aperçu (version antérieure) : la capture de l'appui seule, comme avant.
    const ancienne = {async etat() { return {ck3: true}; }, async capturer() { return {plein: Buffer.from('plein-ancienne'), zoom: null, largeur: 1920, hauteur: 1080, ms: 1}; }};
    c = copiloteAvec(ancienne);
    await c.precapturer('essai-8');
    await pause(150);
    ev = await question(c); r = recu();
    verifier('aide sans aperçu → capture de l\'appui seule', JSON.stringify(r.images) === JSON.stringify(['plein-ancienne@HIGH']) && r.textes[0].includes('quand il a appuyé'), r.images.join(' '));

    // 8 bis. Question arrivée avant la capture de l'appui (aide lente) : cette capture est attendue et utilisée.
    aide = aideScenes(A);
    const capturerLent = aide.capturer;
    aide.capturer = async o => { await pause(200); return capturerLent(o); };
    c = copiloteAvec(aide);
    c.precapturer('essai-8b').catch(() => {});
    ev = await question(c); r = recu();
    verifier('question avant la fin de la capture de l\'appui → elle est attendue', JSON.stringify(r.images) === JSON.stringify(['plein-A@HIGH', 'zoom-A@HIGH']) && r.textes[0].includes('quand il a appuyé')
      && aide.appels.capturer === 1, `${r.images.join(' ')} ; ${aide.appels.capturer} capture(s)`);

    // 10. Info-bulle survolée AVANT l'appui (souris immobile 1,5 s, suivie en permanence par l'aide), puis souris déplacée pour
    //     montrer autre chose : l'image de l'appui est annoncée immobile et reste la principale (haute résolution).
    const ailleurs = (nom, sig, imm, x) => scene(nom, sig, {immobileMs: imm, curseur: {x, y: x}});
    const panneau = bulle(5).map((x, i) => i < 200 ? 30 : x);
    aide = aideScenes(scene('T', bulle(1), {immobileMs: 1500})); c = copiloteAvec(aide);
    await c.precapturer('essai-10');
    await pause(30); aide.courante = ailleurs('M', fond(), 100, 300);
    await pause(200); aide.courante = ailleurs('P', panneau, 900, 600);
    await pause(200);
    ev = await question(c); r = recu();
    const libelleAppui = r.textes.find(t => t.startsWith('Image 1/')) || '';
    verifier('info-bulle survolée avant l\'appui → image de l\'appui immobile et principale', ev.at(-1)?.type === 'fin'
      && /^Image 1\/3, quand il a appuyé pour parler \(début de sa question\) ; souris immobile depuis 1,5 s en x=900, y=500 \(si l'élément survolé a une info-bulle/.test(libelleAppui)
      && r.images[0] === 'plein-T@HIGH' && r.images.filter(i => i.startsWith('plein-') && i.endsWith('@HIGH')).length === 1, `« ${libelleAppui} » ; ${r.images.join(' ')}`);

    // 10 bis. Immobilité inconnue (aide qui vient de démarrer : -1) : la place de la souris seulement, jamais « en mouvement » ;
    //         en anglais aussi.
    aide = aideScenes(scene('U', bulle(1), {immobileMs: -1})); c = copiloteAvec(aide);
    await c.precapturer('essai-10b');
    await pause(30); aide.courante = ailleurs('M', fond(), 100, 300);
    await pause(200);
    ev = []; for await (const e of c.poser({texte: 'Look, I\'m showing you this', voix: false, langue: 'en'})) ev.push(e);
    r = recu();
    const libelleInconnu = r.textes.find(t => t.startsWith('Image 1/')) || '';
    verifier('immobilité inconnue → « mouse at x=…, y=… », sans « moving »', libelleInconnu === 'Image 1/2, when they pressed the key to speak (start of their question); mouse at x=900, y=500 (1920×1080):'
      && r.images[0] === 'plein-U@HIGH', `« ${libelleInconnu} »`);

    // 11. Impressions lentes (150 ms : jeu chargé, carte graphique saturée) : aperçus deux fois plus espacés, arrêt après trois
    //     lents de suite (capture de l'appui comprise), durée max notée au journal.
    aide = aideScenes(scene('L', fond(), {msImpression: 150})); c = copiloteAvec(aide);
    await c.precapturer('essai-11');
    await pause(700);
    const nLents = aide.appels.apercu, ecarts = aide.quand.slice(1).map((x, i) => x - aide.quand[i]);
    await pause(300);
    ev = await question(c); j = (await journalDe(racine)).at(-1);
    verifier('impressions lentes → rythme divisé par deux, arrêt après 3 lentes', nLents === 2 && aide.appels.apercu === 2 && ecarts.every(e => e >= 110)
      && j.regard?.lents === 3 && j.regard.arretLent === true && j.regard.impressionMaxMs === 150 && ev.at(-1)?.type === 'fin',
      `${nLents} aperçus en 700 ms (écarts ${ecarts.join(', ')} ms), ${aide.appels.apercu} au total ; journal ${JSON.stringify(j.regard)}`);

    // 12. Question refusée avant la capture (son muet) : le regard de l'appui s'arrête aussitôt, et la question écrite suivante,
    //     sans appui, ne reprend pas ses vues.
    const wavMuet = wav16(Buffer.alloc(16000 * 2)).toString('base64');   // 1 s de silence
    aide = aideScenes(A); c = copiloteAvec(aide);
    await c.precapturer('essai-12');
    await pause(150);
    ev = []; for await (const e of c.poser({audio: wavMuet, voix: false})) ev.push(e);
    const nMuet = aide.appels.apercu;
    await pause(300);
    const apresMuet = aide.appels.apercu - nMuet;
    aide.courante = B;
    await question(c, 'question écrite'); r = recu();
    verifier('son muet → regard arrêté, la question écrite suivante capture à neuf', ev.at(-1)?.type === 'erreur' && ev.at(-1).message === 'Je n’ai rien entendu.' && apresMuet === 0
      && aide.appels.liberer >= 1 && JSON.stringify(r.images) === JSON.stringify(['plein-B@HIGH', 'zoom-B@HIGH']) && r.textes[0].includes('prise au moment de la question'),
      `« ${ev.at(-1)?.message} », ${apresMuet} aperçu(s) dans les 300 ms suivantes ; question suivante : ${r.images.join(' ')}`);

    // 13. Capture de l'appui ratée (capture noire un instant) : celle faite à l'arrivée de la question est datée « pendant qu'il
    //     posait sa question », pas « quand il a appuyé ».
    aide = aideScenes({erreur: 'Capture noire', code: 'noire'}); c = copiloteAvec(aide);
    c.precapturer('essai-13').catch(() => {});
    await pause(250);
    aide.courante = A;
    ev = await question(c); r = recu();
    verifier('capture de l\'appui ratée → capture de secours datée de la question', ev.at(-1)?.type === 'fin' && JSON.stringify(r.images) === JSON.stringify(['plein-A@HIGH', 'zoom-A@HIGH'])
      && r.textes[0].startsWith('Capture de la fenêtre de Crusader Kings III prise pendant qu\'il posait sa question (1920×1080) :'), `« ${r.textes[0]} »`);

    // 9. Choix pur : plafond, diversité.
    const v = (t, sig, extra = {}) => ({t, plein: Buffer.from('x'), signature: sig, vuJusqua: t, ...extra});
    const choix = choisirVues([v(0, fond()), v(800, bulle(2), {vuJusqua: 2400, immobileMs: 1500}), v(1600, bulle(3)), v(2400, fond())]);
    verifier('choisirVues : la vue tenue et immobile est principale, la fin égale au début n\'est pas doublée', choix.images.length === 3 && choix.images[choix.principale].t === 800,
      `${choix.images.map(i => i.t).join(', ')} ; principale ${choix.images[choix.principale].t}`);
  } finally { globalThis.fetch = vraiFetch; await rm(racine, {recursive: true, force: true}).catch(() => {}); }
  console.log(`Regard : ${resultats.filter(Boolean).length}/${resultats.length} vérifications réussies`);
  if (resultats.some(x => !x)) process.exitCode = 1;
}

if (ETAPES.includes('regard-reel')) {
  // Vraie aide (sans crochet clavier : aucune touche interceptée), vrai CK3 : 6 s de regard pendant qu'Ameur joue, puis UNE
  // question écrite à Gemini (sans voix). Aucune image n'est écrite ailleurs que dans la racine temporaire (capture de dépannage).
  console.log('\n=== Regard réel sur CK3 (6 s), une question à Gemini ===');
  const {creerAideWindows} = await import(pathToFileURL(path.join(ICI, '..', 'aide-windows.mjs')));
  const aide = creerAideWindows({journal: {log() {}, warn() {}, error: m => console.log('aide :', m)}, crochet: false});
  await aide.demarrer();
  const racine = await racineTemporaire();
  const appels = {apercu: 0, encodages: 0, msApercu: [], msEncodage: []};
  const espion = Object.assign(Object.create(aide), {
    etat: () => aide.etat(), liberer: () => aide.liberer(),
    capturer: async o => { const c = await aide.capturer(o); if (o?.jeton) { appels.encodages++; appels.msEncodage.push(c.msAide); } return c; },
    apercu: async () => { const a = await aide.apercu(); appels.apercu++; appels.msApercu.push(a.msImpression ?? a.msAide); return a; },
  });
  const c = creerCopiloteJeu({root: racine, env, aide: espion, journal: {log() {}, warn() {}, error: (...m) => console.log(...m)}});
  try {
    const premiere = await c.precapturer('essai-reel');
    console.log(`Capture de l'appui : ${premiere.largeur}x${premiere.hauteur}, ${premiere.ms} ms, curseur ${premiere.curseur ? `${premiere.curseur.x},${premiere.curseur.y}` : 'hors jeu'}`);
    await new Promise(r => setTimeout(r, 6000));
    // --parle : la question parlée d'essai (WAV) avec la voix, pour mesurer le coût complet d'une question à voix haute.
    const options = process.argv.includes('--parle') ? {audio: (await questionParlee()).toString('base64'), voix: true}
      : {texte: arg('question') || 'Je te montre des choses pendant que je parle : qu\'est-ce que je survolais ou ouvrais, et à quel moment ?', voix: false};
    const r = await poser(c, 'regard réel', options);
    total += r.fin?.coutCents || 0;
    const j = (await journalDe(racine)).at(-1);
    const moy = l => l.length ? Math.round(l.reduce((s, x) => s + x, 0) / l.length) : '-';
    console.log(`Aperçus : ${appels.apercu} en ~6 s (impression ${moy(appels.msApercu)} ms en moyenne, max ${Math.max(0, ...appels.msApercu)}), encodages ${appels.encodages} (${moy(appels.msEncodage)} ms)`);
    console.log('Regard :', JSON.stringify(j.regard), '| images envoyées :', j.images, '| jetons :', JSON.stringify(j.jetons), '| coût', j.coutCents, 'cent(s)');
  } finally { await aide.arreter(); await rm(racine, {recursive: true, force: true}).catch(() => {}); }
}

console.log(`\nCoût estimé de cet essai : ${total.toFixed(2)} cent(s) US`);
