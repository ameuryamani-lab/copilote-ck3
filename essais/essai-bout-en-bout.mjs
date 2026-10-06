// Essai de bout en bout du copilote CK3 : le VRAI serveur (serveur.mjs), la VRAIE aide Windows (sans crochet clavier) et le
// vrai cerveau (agent/copilote-jeu.mjs). La fenêtre réelle de CK3 est capturée et envoyée à Gemini, comme quand Ameur pose une
// question : environ 1 à 1,5 cent par passage, à lancer avec parcimonie. Aucune fenêtre ouverte, aucune touche envoyée ; l'image
// ne quitte la mémoire que pour memoire/copilote-ck3/derniere-capture.jpg (écrasée à chaque question).
// Usage : node essais/essai-bout-en-bout.mjs [--texte="question écrite"] [--sans-voix] [--sans-appui] [--sans-question (gratuit)]
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import {readFile, stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {demarrerServeur} from '../serveur.mjs';
import {creerAideWindows} from '../aide-windows.mjs';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(ICI, '..');
const WAV = path.join(ICI, 'question-test.wav');
const CAPTURE = path.join(ROOT, 'memoire', 'copilote-ck3', 'derniere-capture.jpg');
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const drapeau = n => process.argv.includes(`--${n}`);
const QUESTION_ECRITE = 'Qu\'est-ce que je vois à l\'écran et que dois-je faire maintenant ?';
const pause = ms => new Promise(r => setTimeout(r, ms));
const vivant = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// Port libre choisi par le système, puis rendu au serveur du copilote.
const portLibre = () => new Promise((ok, ko) => { const s = net.createServer(); s.once('error', ko); s.listen(0, '127.0.0.1', () => { const {port} = s.address(); s.close(() => ok(port)); }); });

// Requête HTTP brute (sans en-tête Origin, comme la page qui appelle sa propre origine).
function requete(port, {chemin, methode = 'GET', corps = null, surDonnees = null}) {
  return new Promise((ok, ko) => {
    const r = http.request({host: '127.0.0.1', port, path: chemin, method: methode, agent: false,
      headers: corps ? {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corps)} : {}}, res => {
      const morceaux = [];
      res.setEncoding('utf8');
      res.on('data', m => { if (surDonnees) surDonnees(m); else morceaux.push(m); });
      res.on('end', () => ok({code: res.statusCode, type: res.headers['content-type'] || '', texte: morceaux.join('')}));
      res.on('error', ko);
    });
    r.on('error', ko);
    r.setTimeout(120000, () => r.destroy(new Error('délai de 120 s dépassé')));
    if (corps) r.write(corps);
    r.end();
  });
}

// Taille lue dans l'en-tête JPEG (marqueur SOF), sans décoder ni afficher l'image.
function tailleJpeg(b) {
  if (!b || b[0] !== 0xFF || b[1] !== 0xD8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xFF) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xFF || m === 0x01 || (m >= 0xD0 && m <= 0xD8)) { i += m === 0xFF ? 1 : 2; continue; }
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return `${b.readUInt16BE(i + 7)}x${b.readUInt16BE(i + 5)}`;
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

const notes = [];
const journal = {log: (...a) => notes.push(['info', a.join(' ')]), info: (...a) => notes.push(['info', a.join(' ')]),
  warn: (...a) => notes.push(['avert', a.join(' ')]), error: (...a) => notes.push(['erreur', a.join(' ')])};
let reussi = false, aide = null, serveur = null;

try {
  const t0 = Date.now();
  aide = creerAideWindows({journal, crochet: false});
  const info = await aide.demarrer();
  const pidAide = aide.pid;
  console.log(`Aide Windows prête en ${Date.now() - t0} ms (PowerShell ${pidAide}, crochet ${info.crochet ? 'oui' : 'non'})`);
  serveur = await demarrerServeur({root: ROOT, port: await portLibre(), aide, journal});
  const port = serveur.port;
  console.log(`Serveur réel sur ${serveur.origine}`);

  const etat = await requete(port, {chemin: '/api/jeu/etat'});
  const e = JSON.parse(etat.texte);
  console.log(`GET /api/jeu/etat -> ${etat.code} : CK3 ${e.ck3 ? 'lancé' : 'NON lancé'}, version ${e.version}, extensions possédées ${e.extensions?.possedees?.join(', ') || 'aucune'} (${e.extensions?.manquantes?.length} manquantes), clés ${JSON.stringify(e.cle)}, voix ${e.voix}`);
  const premierPlan = (await aide.etat()).premierPlan;
  console.log(`CK3 au premier plan : ${premierPlan ? 'oui' : 'non'}`);

  // Appui sur le raccourci : la page demande la capture tout de suite, puis Ameur parle.
  if (!drapeau('sans-appui')) {
    const c = await requete(port, {chemin: '/api/jeu/capturer', methode: 'POST'});
    console.log(`POST /api/jeu/capturer (appui) -> ${c.code} ${c.texte}`);
  }

  let avant = null;
  try { avant = (await stat(CAPTURE)).mtimeMs; } catch {}
  if (!drapeau('sans-question')) {
    const texte = arg('texte');
    let audio = null;
    if (!texte) audio = await readFile(WAV).catch(() => null);
    const corps = JSON.stringify(audio ? {audio: audio.toString('base64'), voix: !drapeau('sans-voix')} : {texte: texte || QUESTION_ECRITE, voix: !drapeau('sans-voix')});
    console.log(`\nPOST /api/jeu/question : ${audio ? `question parlée (${path.basename(WAV)}, ${((audio.length - 44) / 32000).toFixed(1)} s)` : `question écrite « ${texte || QUESTION_ECRITE} »`}, voix ${drapeau('sans-voix') ? 'non' : 'oui'}`);

    const debut = Date.now(), suite = [];
    let tampon = '', reponse = '', question = null, sources = null, fin = null, erreur = null, audios = 0, octetsAudio = 0, premierTexte = null, premierSon = null, ordreOk = true;
    const surEvenement = ev => {
      const t = Date.now() - debut;
      if (ev.type === 'texte') { if (premierTexte === null) { premierTexte = t; suite.push(`texte@${t}`); } reponse += ev.delta; return; }
      if (ev.type === 'audio') {
        if (ev.index !== audios) ordreOk = false;
        if (premierSon === null) { premierSon = t; suite.push(`audio#0@${t}`); }
        audios++; octetsAudio += Buffer.from(ev.pcm, 'base64').length; return;
      }
      if (ev.type === 'question') question = ev.texte;
      if (ev.type === 'sources') sources = ev;
      if (ev.type === 'fin') fin = ev;
      if (ev.type === 'erreur') erreur = ev.message;
      suite.push(`${ev.type}${ev.etape ? ':' + ev.etape : ''}@${t}${ev.type === 'etape' ? ` « ${ev.texte} »` : ''}${ev.message ? ` « ${ev.message} »` : ''}`);
    };
    const r = await requete(port, {chemin: '/api/jeu/question', methode: 'POST', corps, surDonnees: m => {
      tampon += m;
      let i;
      while ((i = tampon.indexOf('\n\n')) >= 0) {
        const bloc = tampon.slice(0, i); tampon = tampon.slice(i + 2);
        const data = bloc.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
        if (data) surEvenement(JSON.parse(data));
      }
    }});
    const total = Date.now() - debut;
    console.log(`Réponse HTTP ${r.code} ${r.type} ; flux fermé par le serveur après ${total} ms`);
    console.log('Événements :', suite.join(' -> '));
    console.log('Transcription :', question ?? '(aucune)');
    if (reponse) console.log(`Réponse (${reponse.split(/\s+/).filter(Boolean).length} mots) :\n${reponse}`);
    console.log(`Sources : ${sources?.liens?.length || 0}${sources?.liens?.length ? ' (' + sources.liens.map(l => l.titre).join(', ') + ')' : ''} ; suggestions Google : ${sources?.suggestionsHtml ? sources.suggestionsHtml.length + ' car. de HTML' : 'aucune'}`);
    console.log(`Voix : ${audios} morceaux audio, ${(octetsAudio / 48000).toFixed(1)} s de son, ordre des index ${ordreOk ? 'correct' : 'INCORRECT'}`);
    console.log(`Temps : premier texte ${premierTexte ?? '-'} ms, premier son ${premierSon ?? '-'} ms, total ${total} ms (fin annoncée ${fin?.ms ?? '-'} ms) ; coût estimé ${fin ? fin.coutCents + ' cent(s)' : '-'}`);
    if (erreur) console.log('ERREUR annoncée au joueur :', erreur);

    // Ligne du journal des questions (durées par étape, modèles, jetons).
    const mois = new Intl.DateTimeFormat('fr-CA').format(new Date()).slice(0, 7);
    const ligne = JSON.parse((await readFile(path.join(ROOT, 'journal', 'copilote-ck3', `questions-${mois}.jsonl`), 'utf8')).trim().split('\n').pop());
    console.log('Journal :', JSON.stringify({heure: ligne.heure, modeles: ligne.modeles, durees: ligne.durees, ageCapture: ligne.ageCapture, extraits: ligne.extraits?.length, recherches: ligne.recherches, jetons: ligne.jetons, coutCents: ligne.coutCents, secours: ligne.secours, erreurVoix: ligne.erreurVoix, erreur: ligne.erreur}));

    // L'image de dépannage : réécrite pendant cet essai, aux dimensions de la fenêtre (taille lue dans l'en-tête seulement).
    const s = await stat(CAPTURE).catch(() => null);
    const dims = s ? tailleJpeg(await readFile(CAPTURE)) : null;
    console.log(`derniere-capture.jpg : ${s ? `${Math.round(s.size / 1024)} Ko, ${dims}, ${s.mtimeMs > (avant || 0) ? 'réécrite pendant l\'essai' : 'PAS réécrite'}` : 'absente'}`);
    reussi = r.code === 200 && !!fin && !erreur && !!question && !!reponse && ordreOk && (drapeau('sans-voix') ? audios === 0 : audios > 0);
  } else reussi = etat.code === 200;

  const o = await requete(port, {chemin: '/api/jeu/oublier', methode: 'POST'});
  console.log(`\nPOST /api/jeu/oublier -> ${o.code} ${o.texte}`);
  reussi &&= o.code === 200 && JSON.parse(o.texte).ok === true;

  await serveur.fermer(); serveur = null;
  await aide.arreter(); aide = null;
  await pause(300);
  console.log(`Arrêt : PowerShell de l'aide ${vivant(pidAide) ? 'ENCORE VIVANT' : 'terminé'}`);
  reussi &&= !vivant(pidAide);
} catch (e) {
  console.log('ÉCHEC :', e.stack || e.message);
} finally {
  await serveur?.fermer().catch(() => {});
  await aide?.arreter().catch(() => {});
}

const alertes = notes.filter(([n]) => n !== 'info');
if (alertes.length) console.log('Journal du serveur (avertissements et erreurs) :\n  ' + alertes.map(([n, t]) => `${n} ${t}`).join('\n  '));
console.log(reussi ? '\nRÉUSSI' : '\nÉCHOUÉ');
process.exit(reussi ? 0 : 1);
