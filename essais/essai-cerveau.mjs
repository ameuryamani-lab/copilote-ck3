// Essai du cerveau du copilote CK3 (agent/copilote-jeu.mjs + agent/copilote-ck3-savoir.mjs), sans Electron ni aide Windows.
// Aucune vraie capture : une fausse aide renvoie l'image synthétique ck3-test.jpg. Coût réel : quelques cents (Gemini, un appel OpenAI).
// Usage : node essai-cerveau.mjs [savoir,a,b,suite,annulation,silence,erreurs,secours] [--image=chemin.jpg] [--regenerer] [--question="…"]
//         [--langue=en] [--sans-voix]
// (savoir et erreurs ne coûtent rien ; secours fait UN appel OpenAI ; les autres appellent Gemini.)
// --langue=en (06/10/2026) : questions écrites posées en anglais ; l'étape a vérifie alors la langue de la réponse et le gras.
import {readFile, writeFile, access} from 'node:fs/promises';
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
const ETAPES = (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'savoir,a,b,suite,annulation,silence,erreurs,secours').split(',');

// Langue d'une réponse, à la louche : mots outils français contre anglais, hors libellés en gras (anglais dans les deux langues).
function langueDe(texte) {
  const mots = String(texte).replace(/\*\*[^*]+\*\*/g, ' ').toLowerCase().match(/[a-zàâçéèêëîïôûùüÿœ']+/g) || [];
  const FR = new Set('le la les de des du un une et est tu ton ta tes te pour pas dans sur que qui avec il elle ce cette son sa ses au aux ou mais plus ne'.split(' '));
  const EN = new Set('the a an and is are you your to of on in for with not can it this that they their be if or but there'.split(' '));
  const fr = mots.filter(m => FR.has(m)).length, en = mots.filter(m => EN.has(m)).length;
  return {langue: fr > en ? 'fr' : 'en', fr, en};
}

const {chargerSavoirCk3} = await import(pathToFileURL(path.join(ROOT, 'agent', 'copilote-ck3-savoir.mjs')));
const {creerCopiloteJeu} = await import(pathToFileURL(path.join(ROOT, 'agent', 'copilote-jeu.mjs')));

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

console.log(`\nCoût estimé de cet essai : ${total.toFixed(2)} cent(s) US`);
