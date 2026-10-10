// Copilote de jeu (06/10/2026, demande d'Ameur ; CK3 seulement pour l'instant) : Ameur parle (ou tape) pendant qu'il joue, le
// copilote regarde la fenêtre du jeu (capture par l'aide Windows, jamais de touche envoyée), cherche dans l'Encyclopédie du jeu
// installé et sur Google, puis répond en français, court, avec les libellés anglais exacts de l'écran, en texte et à voix haute.
// Tout ce qui est propre à CK3 est dans copilote-ck3-savoir.mjs. Repli sur OpenAI quand Google refuse (crédit, panne), car le
// crédit Google est partagé avec la voix de Jarvis et tout s'arrête quand il est épuisé.
import {writeFile, appendFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {chargerSavoirCk3, versionInstallee, formesJoueur} from './copilote-ck3-savoir.mjs';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const OPENAI = 'https://api.openai.com/v1';
// Modèles vérifiés le 06/10/2026 sur la liste de l'API. Pas de 3.8 Flash-Lite : l'écoute passe par 3.8 Flash au plus bas niveau
// de réflexion (3.5 Flash-Lite a mal transcrit la question d'essai : accents perdus, « count » pour « comte »), doublée par le
// modèle de transcription, plus rapide mais sans les termes du jeu.
const MODELES = {ecoute: 'gemini-3.8-flash', transcription: 'gemini-3.5-transcribe', reponse: 'gemini-3.8-flash', voix: 'gemini-3.8-flash-lite-tts',
  secours: 'gpt-6-luna', transcriptionSecours: 'gpt-4o-mini-transcribe', voixSecours: 'gpt-4o-mini-tts'};
const VOIX_GEMINI = 'Kore', VOIX_OPENAI = 'marin';
// Dollars par million de jetons (pages de prix du 06/10/2026 ; prix promotionnels de Google jusqu'au 31/12/2026, doublés ensuite).
const PRIX = {'gemini-3.8-flash': [0.75, 3.75], 'gemini-3.5-flash': [1.5, 9], 'gemini-3.5-transcribe': [2, 12], 'gemini-3.8-flash-lite-tts': [0.5, 6], 'gemini-3.8-flash-tts': [0.5, 9], 'gpt-6-luna': [0.1, 0.5]};
const PRIX_MINUTE = {'gpt-4o-mini-transcribe': 0.003, 'gpt-4o-mini-tts': 0.015};
const PRIX_RECHERCHE_OPENAI = 0.01;   // 10 $ les 1 000 ; les 5 000 recherches Google mensuelles sont gratuites
const MAX_CORPS = 8 * 1024 * 1024;
const OUBLI_MS = 10 * 60e3, ECHANGES_MAX = 4;
const ETAPES = {capture: 'Je regarde ton écran…', ecoute: 'J’écoute ta question…', reflexion: 'Je réfléchis…', prepare: 'Je prépare la réponse…', recherche: 'Je vérifie sur Internet…', voix: 'Je te lis la réponse…'};
// Réponse en anglais (langue 'en', 06/10/2026) : l'appli est publiée sur GitHub pour un public mondial. Le français reste la
// langue d'Ameur et le comportement par défaut, inchangé ; seuls les textes visibles ou dictés au modèle changent, pas la voix.
const ETAPES_EN = {capture: 'Looking at your screen…', ecoute: 'Listening to your question…', reflexion: 'Thinking…', prepare: 'Preparing the answer…', recherche: 'Checking online…', voix: 'Reading the answer to you…'};
// Tout ce qui peut arriver au joueur (étapes, erreurs), par langue. Les phrases françaises sont celles d'avant, mot pour mot.
const TEXTES = {
  fr: {
    etapes: ETAPES,
    // Repli sur OpenAI par cause classée (classerGemini, 10/10/2026 : un 429 passait pour « crédit épuisé », une clé refusée pour
    // « Google ne répond pas ») ; modeleInconnu reçoit le nom du modèle. Les phrases crédit et panne sont celles d'avant.
    secours: {credit: 'Crédit Google épuisé : je passe par OpenAI.', quotaJour: 'Quota Google du jour atteint : je passe par OpenAI.',
      limite: 'Google limite le rythme (trop de demandes) : je passe par OpenAI.', modeleInconnu: m => `Google ne connaît plus le modèle ${m} : mets à jour le copilote. Je passe par OpenAI.`,
      cleRefusee: 'Clé Google refusée : vérifie la clé dans .env. Je passe par OpenAI.', indisponible: 'Google est surchargé : je passe par OpenAI.', panne: 'Google ne répond pas : je passe par OpenAI.'},
    secoursImpossible: {credit: 'Crédit Google épuisé, et pas de clé OpenAI pour prendre le relais.', quotaJour: 'Quota Google du jour atteint, et pas de clé OpenAI pour prendre le relais.',
      limite: 'Google limite le rythme (trop de demandes), et pas de clé OpenAI pour prendre le relais.', modeleInconnu: m => `Google ne connaît plus le modèle ${m} : mets à jour le copilote (et pas de clé OpenAI pour prendre le relais).`,
      cleRefusee: 'Clé Google refusée : vérifie la clé dans .env (et pas de clé OpenAI pour prendre le relais).', indisponible: 'Google est surchargé, et pas de clé OpenAI pour prendre le relais.',
      panne: 'Google ne répond pas, et pas de clé OpenAI pour prendre le relais.'},
    secoursSansCle: 'Pas de clé Google : je passe par OpenAI.',
    // Encyclopédie du jeu introuvable (copilote-ck3-savoir.mjs) : dit UNE fois dans le panneau, le copilote répond sans elle.
    encyclopedieIntrouvable: e => `Encyclopédie introuvable : ${e?.code === 'jeu-introuvable' ? `Crusader Kings III n'est dans aucun Steam trouvé (${e.steams?.join(', ') || 'aucun'}). Indique son dossier dans COPILOTE_CK3_DIR (fichier .env).`
      : e?.code === 'dossier-force' ? `COPILOTE_CK3_DIR=${e.dossier} n'est pas le dossier de Crusader Kings III (launcher\\launcher-settings.json absent).` : e?.message || '?'} Je réponds sans elle.`,
    poseTaQuestion: 'Pose ta question à voix haute ou par écrit.', aucuneCle: 'Aucune clé Google ni OpenAI dans le fichier .env.',
    pasWav: 'Le son reçu n’est pas un fichier WAV.', rienEntendu: 'Je n’ai rien entendu.',
    coupee: 'La réponse de Google a été coupée en route. Repose ta question.', voixIndisponible: 'Voix indisponible : réponse en texte seulement.',
    tropLong: 'La réponse prend trop de temps. Repose ta question.', horsLigne: 'Pas de connexion Internet : je n’arrive à joindre ni Google ni OpenAI.',
    aucunService: 'Google et OpenAI ne répondent pas pour l’instant. Réessaie dans un moment.', echec: m => `Je n’ai pas pu répondre : ${m}`,
    tropLourde: 'Question trop lourde (8 Mo au maximum).', jsonInvalide: 'Corps JSON invalide.',
    sansImage: 'indisponible', captureVide: 'capture vide',
  },
  en: {
    etapes: ETAPES_EN,
    secours: {credit: 'Google credit is used up: switching to OpenAI.', quotaJour: 'Google daily quota reached: switching to OpenAI.',
      limite: 'Google is rate-limiting (too many requests): switching to OpenAI.', modeleInconnu: m => `Google no longer knows the model ${m}: update the copilot. Switching to OpenAI.`,
      cleRefusee: 'Google key refused: check the key in .env. Switching to OpenAI.', indisponible: 'Google is overloaded: switching to OpenAI.', panne: 'Google is not responding: switching to OpenAI.'},
    secoursImpossible: {credit: 'Google credit is used up, and there is no OpenAI key to take over.', quotaJour: 'Google daily quota reached, and there is no OpenAI key to take over.',
      limite: 'Google is rate-limiting (too many requests), and there is no OpenAI key to take over.', modeleInconnu: m => `Google no longer knows the model ${m}: update the copilot (and there is no OpenAI key to take over).`,
      cleRefusee: 'Google key refused: check the key in .env (and there is no OpenAI key to take over).', indisponible: 'Google is overloaded, and there is no OpenAI key to take over.',
      panne: 'Google is not responding, and there is no OpenAI key to take over.'},
    secoursSansCle: 'No Google key: switching to OpenAI.',
    encyclopedieIntrouvable: e => `Encyclopedia not found: ${e?.code === 'jeu-introuvable' ? `Crusader Kings III is in none of the Steam folders found (${e.steams?.join(', ') || 'none'}). Set COPILOTE_CK3_DIR to its folder (.env file).`
      : e?.code === 'dossier-force' ? `COPILOTE_CK3_DIR=${e.dossier} is not the Crusader Kings III folder (launcher\\launcher-settings.json missing).` : e?.message || '?'} Answering without it.`,
    poseTaQuestion: 'Ask your question out loud or in writing.', aucuneCle: 'No Google or OpenAI key in the .env file.',
    pasWav: 'The sound received is not a WAV file.', rienEntendu: 'I didn’t hear anything.',
    coupee: 'Google’s answer was cut off. Ask your question again.', voixIndisponible: 'Voice unavailable: text answer only.',
    tropLong: 'The answer is taking too long. Ask your question again.', horsLigne: 'No Internet connection: I can’t reach Google or OpenAI.',
    aucunService: 'Google and OpenAI are not responding right now. Try again in a moment.', echec: m => `I couldn’t answer: ${m}`,
    tropLourde: 'Question too large (8 MB at most).', jsonInvalide: 'Invalid JSON body.',
    sansImage: 'unavailable', captureVide: 'empty capture',
  },
};
const langueValide = l => l === 'en' ? 'en' : 'fr';   // toute autre valeur revient au français
// Texte d'un dictionnaire par cas (secours, secoursImpossible) : cas inconnu = panne ; modeleInconnu est une fonction du modèle.
const texteCas = (dico, cas, modele) => { const t = dico[cas] || dico.panne; return typeof t === 'function' ? t(modele || '?') : t; };
// Erreurs de l'aide Windows (aide-windows.mjs) : ses phrases sont en français, son code (err.code) dit laquelle. Les fausses aides
// des essais n'ont que la phrase : elle sert alors à retrouver le code.
const AIDE_EN = {'pas-lance': 'CK3 isn’t running', reduit: 'CK3 is minimized', noire: 'Black capture', 'ne-repond-pas': 'CK3 is not responding',
  'trop-petite': 'The CK3 window is too small', echec: 'Could not capture CK3', interne: 'Windows helper error'};
const AIDE_AUTRES_EN = {'aide Windows absente': 'Windows helper missing', 'Aide Windows indisponible': 'Windows helper unavailable',
  'Aide Windows sans réponse': 'Windows helper not responding', 'Aide Windows occupée': 'Windows helper busy', 'Aide Windows arrêtée': 'Windows helper stopped'};
const codeAide = e => e?.code && AIDE_EN[e.code] ? e.code : /n['’]est pas lancé/.test(e?.message || '') ? 'pas-lance' : /est réduit/.test(e?.message || '') ? 'reduit' : null;
// CK3 fermé ou réduit : aucune réponse possible, la question s'arrête là.
const aideBloquante = e => ['pas-lance', 'reduit'].includes(codeAide(e));
// En anglais, toute autre panne de l'aide (« Aide Windows : réponse perdue », « Aide Windows : arrêtée 4 fois… », code inconnu)
// devient une phrase générique : le modèle anglais recopiait sinon ce français dans sa réponse. Le détail reste au journal.
const texteAide = (e, langue) => {
  const m = e?.message || '';
  if (langue !== 'en') return m;
  return AIDE_EN[codeAide(e)] || AIDE_AUTRES_EN[m] || (/^aide windows/i.test(m) ? AIDE_EN.interne : m);
};
// Voix : Google rend son premier son en 0,65 s d'ordinaire ; muet 8 s, on passe à la voie suivante au lieu d'attendre 30 s
// (les phrases sont lues dans l'ordre : une seule phrase figée bloquait toute la voix, et la page abandonnait à 45 s).
const PREMIER_SON_MS = 8000;
const BATTEMENT_MS = 10000;   // commentaire SSE pendant que le serveur travaille : la page sait qu'il est vivant

const attendre = ms => new Promise(r => setTimeout(r, ms));
const annulee = e => e?.name === 'AbortError';
// Heure locale du PC (chaque joueur a la sienne) : jour AAAA-MM-JJ pour le nom du journal, heure lisible dans chaque ligne.
const jourLocal = (d = new Date()) => new Intl.DateTimeFormat('fr-CA').format(d);
const heureLocale = (d = new Date()) => d.toLocaleString('fr-FR');
const delai = (signal, ms) => AbortSignal.any([signal, AbortSignal.timeout(ms)]);
const francais = (message, extra = {}) => Object.assign(new Error(message), {francais: true}, extra);

// Flux SSE (Google et OpenAI) : un objet JSON par bloc « data: ».
async function* evenementsSse(reponse) {
  const lecteur = reponse.body.getReader(), dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const {done, value} = await lecteur.read();
    if (done) break;
    buf += dec.decode(value, {stream: true}).replace(/\r/g, '');
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const bloc = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = bloc.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
      if (data && data !== '[DONE]') yield JSON.parse(data);
    }
  }
}

// Classement d'une erreur Google (10/10/2026, test ECC : tout 429 passait pour « crédit épuisé », sans nouvelle tentative, même
// sur 503). cas : credit (facturation), quotaJour (429 du quota journalier : « per day » dans le message ou dans le quotaId des
// details), limite (autre 429 : par minute ; attenteMs lu dans RetryInfo.retryDelay « 7s »), modeleInconnu (404, « not found »,
// « is not supported »), cleRefusee (400/401/403 sur la clé), indisponible (503, overloaded), sinon null (panne). credit reste
// vrai pour crédit et quota du jour : Google est alors évité 5 min, et le repli OpenAI annoncé comme tel.
function classerGemini(statut, texte, details) {
  const t = String(texte || ''), d = Array.isArray(details) ? details : [];
  const quotas = d.flatMap(x => x?.violations || []).map(v => v?.quotaId || '').join(' ');
  const retryDelay = d.find(x => typeof x?.retryDelay === 'string')?.retryDelay || t.match(/retry in (\d+(?:\.\d+)?)\s*s/i)?.[1];
  // « please check your plan and billing details » accompagne tout 429 de Google : ce « billing »-là n'est pas une facturation.
  const cas = /prepa|credit|payment|billing(?! details)/i.test(t) ? 'credit'
    : statut === 429 ? (/per day|PerDay|daily/i.test(`${t} ${quotas}`) ? 'quotaJour' : 'limite')
    : statut === 404 || /not found|is not supported/i.test(t) ? 'modeleInconnu'
    : [400, 401, 403].includes(statut) && /API key|API_KEY_INVALID|PERMISSION_DENIED/i.test(t) ? 'cleRefusee'
    : statut === 503 || /overloaded|UNAVAILABLE/i.test(t) ? 'indisponible' : null;
  const attenteMs = retryDelay ? Math.round(parseFloat(retryDelay) * 1000) || 0 : 0;
  return {cas, credit: cas === 'credit' || cas === 'quotaJour', attenteMs};
}
// Erreur Google lisible (statut HTTP et message de Google), classée ; modele : celui de l'appel, pour le message « mets à jour ».
async function erreurGemini(r, modele = null) {
  const j = await r.json().catch(() => ({}));
  const texte = `${j.error?.status || ''} ${j.error?.message || ''}`;
  return Object.assign(new Error(`Gemini ${r.status} : ${texte.trim().slice(0, 300)}`), {statut: r.status, modele, ...classerGemini(r.status, texte, j.error?.details)});
}
// Nouvelle tentative (une seule) sur « limite » et « indisponible » : délai indiqué par Google, 8 s au plus, 2 s sinon. Voix :
// 4 s au plus, la garde du premier son (8 s) court déjà et le nouvel essai doit avoir le temps de rendre un son.
const NOUVEL_ESSAI_MS = 2000, NOUVEL_ESSAI_MAX_MS = 8000, NOUVEL_ESSAI_VOIX_MS = PREMIER_SON_MS / 2;
const RETENTES = ['limite', 'indisponible'];
// Attente annulable : une question abandonnée pendant le délai ne retient pas le serveur.
const attendreSauf = (ms, signal) => new Promise((ok, ko) => {
  if (signal?.aborted) return ko(signal.reason);
  const t = setTimeout(() => { signal?.removeEventListener('abort', fin); ok(); }, ms);
  const fin = () => { clearTimeout(t); ko(signal.reason); };
  signal?.addEventListener('abort', fin, {once: true});
});
async function erreurOpenAI(r) {
  const j = await r.json().catch(() => ({}));
  return Object.assign(new Error(`OpenAI ${r.status} : ${(j.error?.message || '').slice(0, 300)}`), {statut: r.status});
}
// Erreur envoyée par Google AU MILIEU d'un flux SSE déjà commencé (réponse 200) : {"error":{code, status, message}}. Sans ce
// contrôle, une réponse tronquée passait pour complète (« fin », mise en mémoire, pas de repli).
function erreurDansFlux(e, modele = null) {
  const texte = `${e.status || ''} ${e.message || ''}`;
  return Object.assign(new Error(`Gemini ${e.code || '?'} (dans le flux) : ${texte.trim().slice(0, 300)}`), {statut: e.code, modele, ...classerGemini(e.code, texte, e.details)});
}
// Signal annulé si aucun morceau n'arrive dans les ms premières millisecondes ; recu() désarme la garde au premier morceau.
function gardePremierMorceau(signal, ms) {
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(new DOMException('Aucun son de Google après ' + ms / 1000 + ' s', 'TimeoutError')), ms);
  return {signal: AbortSignal.any([signal, ctrl.signal]), recu: () => clearTimeout(minuteur)};
}

// WAV 16 kHz mono 16 bits envoyé par la page ; durée lue dans l'en-tête.
function lireWav(b64, T = TEXTES.fr) {
  const b = Buffer.from(String(b64 || ''), 'base64');
  if (b.length < 44 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw francais(T.pasWav);
  const debit = b.readUInt32LE(28) || 32000;
  // Énergie de la fenêtre de 30 ms la plus forte : sous -50 dBFS, c'est du silence et on ne paie aucun appel.
  let fort = 0;
  if (b.readUInt16LE(34) === 16) for (let i = 44; i + 960 <= b.length; i += 960) {
    let s = 0;
    for (let k = i; k < i + 960; k += 2) { const v = b.readInt16LE(k); s += v * v; }
    fort = Math.max(fort, Math.sqrt(s / 480));
  } else fort = Infinity;
  return {b64: b.toString('base64'), secondes: (b.length - 44) / debit, silence: fort < 100};
}

// Texte lisible à voix haute : sans Markdown ni adresse, libellés anglais gardés. La traduction entre parenthèses qui suit un
// libellé en gras (« **Council** (conseil) ») n'est pas lue : Ameur l'a sous les yeux, et la voix durait 46 à 48 s par réponse.
const pourLaVoix = t => String(t).replace(/\*\*([^*\n]+)\*\*\s*\([^()\n]{1,40}\)/g, '**$1**').replace(/\*\*|__|`|#+\s?/g, '').replace(/^\s*[-•]\s+/gm, '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();

// File d'événements : la réponse (texte) et la voix (audio) arrivent en même temps, poser() les rend dans l'ordre d'arrivée.
function canal() {
  const file = []; let reveil = null, ferme = false;
  return {
    pousser(ev) { if (ferme) return; file.push(ev); reveil?.(); reveil = null; },
    fermer() { ferme = true; reveil?.(); reveil = null; },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (file.length) { yield file.shift(); continue; }
        if (ferme) return;
        await new Promise(r => { reveil = r; });
      }
    },
  };
}

// Lecture à voix haute au fil de la réponse : découpe en phrases (la première, courte, part tout de suite), synthèse de deux
// phrases à la fois, morceaux PCM rendus strictement dans l'ordre de lecture.
function creerLecture({synthetiser, emettre, signal}) {
  const travaux = [];
  let tampon = '', courant = 0, actifs = 0, close = false, resoudre;
  const fini = new Promise(r => { resoudre = r; });
  const sortir = t => { if (!t.morceaux.length) return; emettre(Buffer.concat(t.morceaux)); t.morceaux = []; t.attente = 0; };
  function avancer() {
    if (signal.aborted) return resoudre();
    while (courant < travaux.length) {
      const t = travaux[courant];
      sortir(t);
      if (!t.fini) break;
      courant++;
    }
    for (const t of travaux) if (!t.lance && actifs < 2 && !signal.aborted) lancer(t);
    if (close && courant >= travaux.length) resoudre();
  }
  function lancer(t) {
    t.lance = true; actifs++;
    synthetiser(t.texte, m => {
      if (signal.aborted) return;
      t.morceaux.push(m); t.attente += m.length;
      if (travaux[courant] === t && (t.premier || t.attente >= 9600)) { t.premier = false; sortir(t); }   // 200 ms de son par événement
    }).catch(e => { t.erreur = e; }).finally(() => { t.fini = true; actifs--; avancer(); });
  }
  function phrase(texte) {
    const propre = pourLaVoix(texte);
    if (!/[\p{L}\p{N}]/u.test(propre)) return;
    travaux.push({texte: propre, morceaux: [], attente: 0, premier: true, lance: false, fini: false});
    avancer();
  }
  function couper(toutVider) {
    for (;;) {
      const min = travaux.length ? 90 : 20;
      const re = /[.!?…:;](?=\s)|\n/g;
      let m, coupe = -1;
      while ((m = re.exec(tampon))) {
        if (m[0] === '.' && /\d/.test(tampon[m.index - 1] || '')) continue;   // « 1. » d'une liste numérotée
        if (pourLaVoix(tampon.slice(0, m.index + 1)).length >= min) { coupe = m.index + 1; break; }
      }
      if (coupe < 0 && tampon.length > 400) coupe = tampon.lastIndexOf(' ', 400) + 1 || 400;
      if (coupe < 0) { if (toutVider) { phrase(tampon); tampon = ''; } return; }
      phrase(tampon.slice(0, coupe)); tampon = tampon.slice(coupe);
    }
  }
  return {
    ajouter(delta) { tampon += delta; couper(false); },
    terminer() { couper(true); close = true; avancer(); return fini; },
    erreurs: () => travaux.filter(t => t.erreur).map(t => t.erreur),
  };
}

// Consignes en anglais : même fond que la version française, sans traduction entre parenthèses après les libellés. Les notes de
// version et la liste des fonctions d'extension restent en français : le modèle les lit sans peine, la consigne de langue l'emporte.
// j : formes du nom du joueur (formesJoueur) ; « they » plutôt que « he » : le joueur n'est plus forcément Ameur.
function consignesAnglais(s, j) {
  const version = s?.version || 'unknown';
  const extensions = s?.consigneExtensionsEn || `Expansions owned by ${j.en.nom}: unknown (game files unreadable). When a feature needs an expansion, say so and name it.`;
  return `You are ${j.en.de} Crusader Kings III copilot. ${j.en.Nom} is playing right now, speaks to you in English, and you answer ONLY in English, addressing them as "you", warmly and directly.

FORM
- It is a summary: start with the direct answer in one sentence, then give 2 to 4 short numbered steps (1. 2. 3.) saying where to click. 70 words at most in total: the answer is read aloud.
- The game is in ENGLISH: quote every interface label EXACTLY as written on screen, in bold (for example **Declare War**). Never add a translation or anything in parentheses after a label.
- Your answer is also read aloud: no table, no link or web address, no heading, no emoji, no formatting except bold and the numbered steps.

WHAT YOU SEE
- You receive a screenshot of the game window taken during the question, or several in order when the screen changed while they were speaking, and sometimes a zoom around the mouse cursor (what they are hovering). They talk to you like someone sitting next to them: when they say "look", "I'm showing you" or "this", they are hovering or opening what they mean; use the image where it shows, without describing the others. Use what is visible first: tooltip, greyed-out button, reason shown in red, numbers. Read small numbers carefully; if something is not readable, say so.
- If the screen is not a game in progress (menu, loading, black screen), just say what you see.

SOURCES AND VERSION
- Installed game: version ${version}. Version 1.20 "Crozier" was released on 30 September 2026: many web guides and your own memory are older. Order of trust: 1) the screen, 2) the excerpts of the game's Encyclopedia provided with the question (exact texts of their version), 3) a Google search, preferring official wiki pages marked 1.20 or 1.19. When a source may be outdated, say so in a few words.
- Never invent a button or a menu path. If you are not sure, say so and tell them what to hover or open (F10 opens the Encyclopedia, which has a search).
- A trick or an effect that is neither on screen nor in the excerpts (for example getting around a rule): check it with a Google search, or say in a few words that it needs checking.
- Give NO number (threshold, cost, number of counties or duchies, duration, percentage) that comes neither from the screen, nor from the excerpts, nor from a Google search made for this question: your memory gets the game's numbers wrong. Say where to read it instead (for example the tooltip of **Create Title**).

EXPANSIONS
- ${extensions}

LIMITS
- You cannot act on the PC or the game: you only advise. If time matters, remind them that Space pauses the game.
- If the question is not about the game, answer briefly.

Reference notes below are written in French for the French copilot: use their facts, but always answer in English.

${s?.notesVersion || ''}

${s?.fonctionsExtensions || ''}`.trim();
}

// ---- Regard pendant la question (07/10/2026) ----
// Ameur parle au copilote comme à quelqu'un assis à côté de lui (« je te montre… ») : il survole, ouvre un panneau ou fait
// défiler PENDANT qu'il parle, et les info-bulles de CK3 disparaissent dès que la souris bouge. L'image unique prise à l'appui ne
// voyait donc pas ce qu'il montrait (« Je te montre justement la partie de legitimacy » : la capture n'avait que la carte).
// De l'appui jusqu'à l'arrivée de la question, le copilote regarde la fenêtre du jeu par un aperçu léger de l'aide Windows
// (empreinte grise 32x18 + souris, sans JPEG : ~20 ms), n'encode que les vues qui ont changé, les garde EN MÉMOIRE seulement,
// puis en envoie au plus 4 au modèle.
const REGARD = {
  periode: 900, periodeCourte: 700,   // ≤ 1,5 aperçu par seconde ; plus tôt quand la souris vient de s'arrêter (info-bulle à venir)
  dureeMax: 40e3,                     // l'écoute de la page s'arrête à 30 s
  gardeesMax: 24,                     // ~0,33 Mo par vue : 8 Mo au pire
  choisiesMax: 4,
  // Case de l'empreinte « changée » : plus de 12 niveaux de gris sur 255. Mesuré sur CK3 le 07/10 : écran immobile 0 case,
  // survol d'un comté ou info-bulle 8 à 20, panneau ouvert ou carte déplacée 150 et plus. Une vue est gardée dès 4 cases, mais
  // n'est envoyée qu'à 6 cases d'écart avec les images déjà choisies (le jeu non en pause anime quelques cases).
  niveau: 12, seuilCases: 4, seuilChoix: 6,
  immobile: 500,                      // souris immobile depuis 0,5 s : une info-bulle a eu le temps de s'ouvrir
  qualite: 75,                        // vues du regard un peu plus compressées (-25 %) : jusqu'à 4 images partent sur le réseau
  erreursMax: 2,
  // PrintWindow passe par le rendu du jeu : 17 à 29 ms mesurés sur CK3. Au-delà de 120 ms (jeu chargé, carte graphique saturée),
  // les aperçus sont deux fois plus espacés ; trois lents de suite, le regard s'arrête (la question part avec les vues déjà prises).
  lentMs: 120, lentsMax: 3,
};
// Immobilité de la souris inconnue (null : l'aide vient de démarrer) : ni « en mouvement » ni « immobile ».
const immobileConnu = ms => Number.isFinite(ms) && ms >= 0 ? ms : null;

// Nombre de cases de l'empreinte qui ont changé entre deux vues (empreinte absente : vue tenue pour différente).
export function casesChangees(a, b) {
  if (!a || !b || a.length !== b.length) return 576;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > REGARD.niveau) n++;
  return n;
}
// Combien de temps une vue a « tenu » : écran inchangé aux aperçus suivants, souris immobile (ms, chaque part plafonnée à 3 s).
// Immobilité inconnue : comptée pour le seuil, sans la pénaliser ni la favoriser face à une vue où la souris bougeait.
const tenue = (v, R = REGARD) => Math.min(3000, Math.max(0, (v.vuJusqua ?? v.t) - v.t)) + Math.min(3000, v.immobileMs ?? R.immobile);

// Images envoyées au modèle (choisiesMax au plus) : la première (l'appui), la dernière (fin de la question) si l'écran a changé
// depuis, et des vues intermédiaires parmi les plus différentes de celles déjà choisies, en préférant celles qui ont tenu et où la
// souris était immobile (une info-bulle a pu s'ouvrir) plutôt qu'une image prise en plein mouvement. Écran inchangé : une image.
// principale : la vue qui a le plus tenu (à égalité, la plus récente) ; elle seule part en haute résolution quand il y en a 3 ou 4.
export function choisirVues(vues, R = REGARD) {
  const liste = vues.filter(v => v?.plein?.length);
  if (liste.length <= 1) return {images: liste, principale: 0};
  const choisies = [liste[0]];
  const loin = v => Math.min(...choisies.map(c => casesChangees(v.signature, c.signature)));
  const derniere = liste.at(-1);
  if (loin(derniere) >= R.seuilChoix) choisies.push(derniere);
  const milieu = liste.slice(1, -1);
  while (choisies.length < R.choisiesMax && milieu.length) {
    let meilleure = -1, score = 0;
    milieu.forEach((v, i) => {
      const d = loin(v);
      if (d < R.seuilChoix) return;
      const s = (0.5 + Math.min(d, 40) / 40) * (0.25 + Math.min(3000, Math.max(0, (v.vuJusqua ?? v.t) - v.t)) / 1000 + ((v.immobileMs ?? 0) >= R.immobile ? 0.75 : 0));
      if (s > score) { score = s; meilleure = i; }
    });
    if (meilleure < 0) break;
    choisies.push(milieu.splice(meilleure, 1)[0]);
  }
  choisies.sort((a, b) => a.t - b.t);
  let principale = 0;
  choisies.forEach((v, i) => { if (tenue(v, R) >= tenue(choisies[principale], R)) principale = i; });
  return {images: choisies, principale};
}

// Une session de regard, ouverte à l'appui (route /api/jeu/capturer) : première capture tout de suite, puis aperçus jusqu'à
// finir() (la question arrive), abandonner() (Ameur annule, rien entendu, nouvel appui) ou dureeMax. Une aide sans apercu()
// (fausses aides des essais, version antérieure) donne la seule capture de l'appui, comme avant.
function creerRegard({aide, id = null, reglages = {}}) {
  const R = {...REGARD, ...reglages};
  const regarder = typeof aide.apercu === 'function';
  const r = {id, t: Date.now(), vues: [], apercus: 0, horsJeu: 0, encodees: 0, erreurs: 0, fini: false, arrete: false, abandonne: false,
    minuteur: null, tick: null, dernierApercu: 0, erreurPremiere: null, lents: 0, lentsTotal: 0, arretLent: false, impressionMax: 0};
  // Durée d'impression de CK3 (ms) : rend vrai si elle est lente, et compte les lentes à la suite.
  function mesurer(msImpression) {
    const ms = Number(msImpression) || 0;
    r.impressionMax = Math.max(r.impressionMax, ms);
    const lent = ms > R.lentMs;
    r.lents = lent ? r.lents + 1 : 0;
    if (lent) r.lentsTotal++;
    return lent;
  }

  function ajouter(v) {
    r.vues.push(v);
    if (r.vues.length <= R.gardeesMax) return;
    // Plafond mémoire : on retire la vue intermédiaire la moins nouvelle par rapport à la précédente (diversité gardée).
    let k = 1, min = Infinity;
    for (let i = 1; i < r.vues.length - 1; i++) { const d = casesChangees(r.vues[i].signature, r.vues[i - 1].signature); if (d < min) { min = d; k = i; } }
    r.vues.splice(k, 1);
  }
  const vue = (c, t, immobileMs) => ({t, plein: c.plein, zoom: c.zoom, curseur: c.curseur, curseurSurJeu: c.curseurSurJeu ?? !!c.zoom,
    largeur: c.largeur, hauteur: c.hauteur, signature: c.signature || null, immobileMs: immobileConnu(immobileConnu(immobileMs) ?? c.immobileMs), vuJusqua: t});

  function planifier(ms) {
    if (r.arrete || r.fini) return;
    clearTimeout(r.minuteur);
    r.minuteur = setTimeout(() => { r.tick = regarderUneFois().finally(() => { r.tick = null; }); }, ms);
    r.minuteur.unref?.();
  }

  // Un aperçu ; si l'écran a changé depuis la dernière vue gardée, l'aide encode cette même image (jeton) et on la garde.
  async function regarderUneFois() {
    if (r.arrete) return;
    if (Date.now() - r.t > R.dureeMax) return arreter();
    const tA = Date.now();
    let a;
    try { a = await aide.apercu(); } catch (e) {
      // CK3 réduit ou figé un instant (Alt+Tab, chargement) : comme une autre appli devant, on attend qu'il revienne. Fermé, ou
      // l'aide en panne deux fois de suite : le regard s'arrête.
      const code = codeAide(e);
      if (code === 'reduit' || code === 'ne-repond-pas') { r.horsJeu++; return planifier(R.periode); }
      if (code === 'pas-lance' || ++r.erreurs >= R.erreursMax) return arreter();
      return planifier(R.periode);
    }
    r.erreurs = 0; r.apercus++; r.dernierApercu = Date.now();
    // CK3 pas devant : rien n'a été imprimé, msImpression est absent et ne compte pas comme rapide.
    const lent = a.premierPlan && a.signature ? mesurer(a.msImpression) : false;
    if (r.arrete) return;
    const t = tA - r.t, immobileMs = immobileConnu(a.immobileMs);
    if (!a.premierPlan || !a.signature) r.horsJeu++;   // CK3 pas devant : l'aide n'a rien imprimé
    else {
      const derniere = r.vues.at(-1);
      if (derniere && casesChangees(a.signature, derniere.signature) < R.seuilCases) {
        derniere.vuJusqua = t;   // même écran : la vue gardée dure
        // Souris restée sur place depuis la vue gardée : elle y est immobile depuis plus longtemps.
        if (immobileMs != null && derniere.curseur && a.curseur && Math.hypot(a.curseur.x - derniere.curseur.x, a.curseur.y - derniere.curseur.y) < 4)
          derniere.immobileMs = Math.max(derniere.immobileMs ?? 0, immobileMs);
      } else {
        // L'impression est déjà payée : même lente, la vue nouvelle est encodée (6 à 9 ms dans l'aide, rien côté jeu).
        try {
          const c = await aide.capturer({jeton: a.jeton, qualite: R.qualite});
          r.encodees++;
          if (!r.arrete) ajouter(vue(c, t, immobileMs));
        } catch (e) { if (codeAide(e) === 'pas-lance') return arreter(); }   // 'perimee'... : vue perdue, l'aperçu suivant la rattrape
      }
    }
    if (r.lents >= R.lentsMax) { r.arretLent = true; return arreter(); }
    planifier(lent ? 2 * R.periode : immobileMs != null && immobileMs < 400 ? R.periodeCourte : R.periode);
  }

  function arreter() {
    if (r.arrete) return;
    r.arrete = true;
    clearTimeout(r.minuteur);
    // L'aide garde le dernier aperçu en mémoire : on le lui fait oublier une fois l'aperçu en cours terminé.
    if (regarder) Promise.resolve(r.tick).finally(() => aide.liberer?.().catch(() => {}));
  }

  r.premiere = aide.capturer();
  // La capture de l'appui compte même si la question arrive avant elle ; seule une annulation la jette.
  r.premiere.then(c => { if (!r.abandonne) r.vues.unshift(vue(c, 0)); planifier(mesurer(c.msImpression) ? 2 * R.periode : R.periode); },
    e => { r.erreurPremiere = e; if (aideBloquante(e)) arreter(); else planifier(R.periode); });
  if (!regarder) r.fini = true;   // pas d'aperçus : la capture de l'appui seule

  return {
    get id() { return r.id; }, get t() { return r.t; }, premiere: r.premiere,
    // Question arrivée : l'aperçu en cours compte (600 ms au plus), un dernier regard si le précédent date (fin de phrase en
    // tenant la touche), puis le choix. Rejette si aucune vue (capture de l'appui ratée) : l'appelant capture alors maintenant.
    async finir() {
      r.fini = true;
      clearTimeout(r.minuteur);
      if (r.tick) await Promise.race([r.tick, attendre(600)]);
      if (regarder && !r.arrete && !r.tick && r.vues.length && Date.now() - r.dernierApercu > 300) await Promise.race([regarderUneFois(), attendre(600)]);
      arreter();
      await r.premiere.catch(() => null);
      if (!r.vues.length) throw r.erreurPremiere || new Error('aucune vue');
      const fin = Math.max(...r.vues.map(v => v.vuJusqua ?? v.t));
      const choix = choisirVues(r.vues, R);
      // impressionMaxMs : coût réel du regard sur le jeu, à surveiller sur une partie en cours (lents : impressions > 120 ms).
      return {...choix, fin, resume: {apercus: r.apercus, horsJeu: r.horsJeu, gardees: r.vues.length, encodees: r.encodees, impressionMaxMs: r.impressionMax,
        ...(r.lentsTotal ? {lents: r.lentsTotal} : {}), ...(r.arretLent ? {arretLent: true} : {})}};
    },
    // Annulation : plus aucun aperçu, et les vues gardées sont oubliées tout de suite.
    abandonner() { r.abandonne = true; arreter(); r.vues = []; },
    get actif() { return !r.arrete && !r.fini; },
  };
}

// Textes qui accompagnent les images, dans la langue des consignes. s : secondes avec une décimale, virgule en français.
function secondes(ms, en) { const s = (Math.max(0, ms) / 1000).toFixed(1); return en ? s : s.replace('.', ','); }
function libelleVue(v, i, n, fin, en) {
  const ou = v.curseur ? `x=${v.curseur.x}, y=${v.curseur.y}` : '';
  const depuis = ms => ms >= 10e3 ? (en ? 'more than 10 s' : 'plus de 10 s') : `${secondes(ms, en)} s`;
  // On ne dit que ce qu'on sait : immobilité inconnue, la place seulement ; immobile, une info-bulle a PU s'ouvrir (la carte ou un
  // fond de panneau n'en ont pas : l'affirmer poussait le modèle à en chercher une).
  const souris = !v.curseur ? '' : v.curseurSurJeu === false ? (en ? '; mouse outside the game' : ' ; souris hors du jeu')
    : v.immobileMs == null ? (en ? `; mouse at ${ou}` : ` ; souris en ${ou}`)
    : v.immobileMs >= REGARD.immobile
      ? (en ? `; mouse still for ${depuis(v.immobileMs)} at ${ou} (if the hovered element has a tooltip, it had time to open)` : ` ; souris immobile depuis ${depuis(v.immobileMs)} en ${ou} (si l'élément survolé a une info-bulle, elle a eu le temps de s'ouvrir)`)
      : (en ? `; mouse moving, at ${ou}` : ` ; souris en mouvement, en ${ou}`);
  const jusquAuBout = i === n - 1 && (v.vuJusqua ?? v.t) >= fin - 50 && v.t > 0;
  const quand = i === 0 && v.t === 0
    ? (en ? `when they pressed the key to speak (start of their question)` : `quand il a appuyé pour parler (début de sa question)`)
    : (en ? `${secondes(v.t, en)} s after the start of their question${jusquAuBout ? ', and still so at the end' : ''}` : `${secondes(v.t, en)} s après le début de sa question${jusquAuBout ? ', et encore ainsi à la fin' : ''}`);
  return en ? `Image ${i + 1}/${n}, ${quand}${souris} (${v.largeur || '?'}×${v.hauteur || '?'}):` : `Image ${i + 1}/${n}, ${quand}${souris} (${v.largeur || '?'}×${v.hauteur || '?'}) :`;
}

// j : formes du nom du joueur (« du joueur », ou « d'Ameur » si COPILOTE_PRENOM=Ameur) ; le reste est mot pour mot celui d'avant.
function consignes(s, langue = 'fr', j = formesJoueur(null)) {
  if (langue === 'en') return consignesAnglais(s, j);
  const version = s?.version || 'inconnue';
  // Phrase tirée des extensions réellement installées (module du jeu) : elle suit un achat, au lieu d'affirmer « aucune » en dur.
  const extensions = s?.consigneExtensions || `Extensions possédées par ${j.fr.nom} : inconnues (fichiers du jeu illisibles). Quand une fonction demande une extension, dis-le en la nommant.`;
  return `Tu es le copilote de Crusader Kings III ${j.fr.de}. Il est en train de jouer ; il te parle en français et tu lui réponds en français, en le tutoyant, de façon chaleureuse et directe.

FORME
- C'est un résumé (demande ${j.fr.de}) : commence par la réponse directe en une phrase, puis donne 2 à 4 étapes numérotées courtes (1. 2. 3.) qui disent où cliquer. 70 mots au maximum en tout : à 110 mots, la voix durait 40 s.
- Le jeu est en ANGLAIS : cite chaque libellé de l'interface EXACTEMENT comme il est écrit à l'écran, en anglais et en gras (par exemple **Declare War**), suivi la première fois d'une courte traduction française entre parenthèses.
- Ta réponse est aussi lue à voix haute : pas de tableau, pas de lien ni d'adresse web, pas de titre, pas d'emoji, aucune mise en forme à part le gras et les étapes numérotées.

CE QUE TU VOIS
- Tu reçois une capture de la fenêtre du jeu prise pendant sa question, ou plusieurs dans l'ordre quand l'écran a changé pendant qu'il parlait, et parfois un zoom autour du curseur de la souris (ce qu'il survole). Il te parle comme à quelqu'un assis à côté de lui : quand il dit « regarde », « je te montre » ou « ça », il survole ou ouvre ce dont il parle ; prends l'image où on le voit, sans décrire les autres. Sers-toi d'abord de ce qui est visible : info-bulle, bouton grisé, raison affichée en rouge, chiffres. Lis les petits chiffres avec soin ; si quelque chose n'est pas lisible, dis-le.
- Si l'écran n'est pas une partie en cours (menu, chargement, écran noir), dis simplement ce que tu vois.

SOURCES ET VERSION
- Jeu installé : version ${version}. La 1.20 « Crozier » est sortie le 30 septembre 2026 : beaucoup de guides du web et ta propre mémoire sont plus anciens. Ordre de confiance : 1) l'écran, 2) les extraits de l'Encyclopédie du jeu fournis avec la question (textes exacts de sa version), 3) une recherche Google, en préférant les pages du wiki officiel marquées 1.20 ou 1.19. Quand une source peut être dépassée, dis-le en quelques mots.
- N'invente jamais un bouton ni un chemin de menu. Si tu n'es pas sûr, dis-le et indique-lui quoi survoler ou ouvrir (F10 ouvre l'Encyclopédie, qui a une recherche).
- Une astuce ou un effet qui n'est ni à l'écran ni dans les extraits (par exemple contourner une règle) : vérifie-le par une recherche Google, ou dis en quelques mots que c'est à vérifier.
- Ne donne AUCUN chiffre (seuil, coût, nombre de comtés ou de duchés, durée, pourcentage) qui ne vient ni de l'écran, ni des extraits, ni d'une recherche Google faite pour cette question : ta mémoire se trompe sur les chiffres du jeu. Dis plutôt où le lire (par exemple l'info-bulle de **Create Title**).

EXTENSIONS
- ${extensions}

LIMITES
- Tu ne peux pas agir sur le PC ni sur le jeu : tu conseilles seulement. Si le temps compte, rappelle-lui qu'Espace met le jeu en pause.
- Si la question ne porte pas sur le jeu, réponds brièvement.

${s?.notesVersion || ''}

${s?.fonctionsExtensions || ''}`.trim();
}

export function creerCopiloteJeu({root, env = {}, aide = null, conso = null, journal = console, modeles = {}, reglagesRegard = {}}) {
  const M = {...MODELES, ...modeles};   // modeles : seulement pour les essais (forcer une panne de Google) ; reglagesRegard aussi
  const cleGemini = env.GEMINI_API_KEY, cleOpenAI = env.OPENAI_API_KEY;
  // Prénom facultatif (.env ou variable d'environnement) : sans lui, les consignes parlent du « joueur » (appli publiée).
  const prenom = env.COPILOTE_PRENOM || process.env.COPILOTE_PRENOM || null;
  const joueur = formesJoueur(prenom);
  const dossierJournal = path.join(root, 'journal', 'copilote-ck3');
  const dossierMemoire = path.join(root, 'memoire', 'copilote-ck3');
  // epoqueMemoire : augmentée par oublier() ; une réponse commencée avant l'oubli n'est pas remise en mémoire à sa fin.
  // langueMemoire : langue des échanges gardés ; une question dans l'autre langue repart de zéro (un historique mélangé faisait
  // mélanger les langues au modèle).
  let historique = [], dernierEchange = 0, enCours = null, epoqueMemoire = 0, langueMemoire = 'fr';
  const panne = {jusqua: 0, cas: null};   // crédit Google épuisé (ou quota du jour) : on passe directement par OpenAI pendant 5 min

  // Savoir du jeu : chargé au démarrage, rechargé si Steam a mis le jeu à jour (version relue au plus une fois par minute).
  // COPILOTE_CK3_DIR (.env ou variable d'environnement, 10/10/2026) : dossier du jeu imposé quand Steam est ailleurs.
  // savoirErreur : dernière cause d'échec, dite UNE fois dans le panneau (savoirAverti) au lieu d'une ligne de journal seule.
  const dossierJeuForce = env.COPILOTE_CK3_DIR || process.env.COPILOTE_CK3_DIR || null;
  let savoirP = null, savoirT = 0, savoirErreur = null, savoirAverti = false;
  function obtenirSavoir() {
    if (!savoirP || Date.now() - savoirT > 60e3) {
      savoirT = Date.now();
      const precedent = savoirP;
      savoirP = (async () => {
        const ancien = await precedent?.catch(() => null);
        if (ancien) { const v = await versionInstallee(ancien.dossierJeu).catch(() => null); if (v?.version === ancien.version) return ancien; }
        return chargerSavoirCk3({root, journal, prenom, dossierJeu: dossierJeuForce});
      })();
      savoirP.then(() => { savoirErreur = null; savoirAverti = false; }, e => { savoirErreur = e; journal.error?.('Copilote CK3 : savoir du jeu indisponible :', e.message); });
    }
    return savoirP.catch(() => null);
  }
  obtenirSavoir();

  // Image prise dès l'appui sur le raccourci ou le clic (route /api/jeu/capturer, appelée par la page) : l'info-bulle qu'Ameur
  // survolait en appuyant a souvent disparu quand il a fini de parler. Depuis le 07/10, le regard continue pendant toute l'écoute
  // (creerRegard). En mémoire seulement, 40 s au plus, utilisé par une seule question. id : celui de la page, pour qu'une
  // annulation n'arrête jamais le regard d'un appui plus récent.
  const AGE_PRECAPTURE = 40e3;
  let regard = null, minuteurRegard = null;
  function precapturer(id = null) {
    if (!aide) return Promise.reject(new Error('aide Windows absente'));
    regard?.abandonner();
    clearTimeout(minuteurRegard);
    const r = regard = creerRegard({aide, id, reglages: reglagesRegard});
    r.premiere.catch(() => {});
    minuteurRegard = setTimeout(() => { if (regard === r) { r.abandonner(); regard = null; } }, AGE_PRECAPTURE);
    minuteurRegard.unref?.();
    return r.premiere;
  }
  function prendreRegard() {
    const r = regard;
    regard = null;
    clearTimeout(minuteurRegard);
    if (r && Date.now() - r.t < AGE_PRECAPTURE) return r;
    r?.abandonner();
    return null;
  }
  // Annulation par la page (question abandonnée, rien entendu) : seulement le regard de cet appui-là.
  function arreterRegard(id) {
    if (!regard || !id || regard.id !== id) return false;
    regard.abandonner(); regard = null;
    clearTimeout(minuteurRegard);
    return true;
  }

  const enteteGemini = {'Content-Type': 'application/json', 'x-goog-api-key': cleGemini};
  const enteteOpenAI = {'Content-Type': 'application/json', Authorization: `Bearer ${cleOpenAI}`};
  const geminiDispo = () => !!cleGemini && Date.now() > panne.jusqua;
  // Appel à Google : rend la réponse si r.ok, sinon lève l'erreur classée (statut HTTP au journal via son message). Une seule
  // nouvelle tentative sur « limite » (429 par minute) et « indisponible » (503), après le délai que Google indique (attenteMax au
  // plus : 8 s, 4 s pour la voix). Attente coupée par le joueur (AbortError) : son annulation ; par un délai ou la garde du premier
  // son (TimeoutError) : l'erreur classée, pour que sa vraie cause soit dite (un 429 de la voix devenait « Google ne répond pas »).
  async function appelGemini(url, init, modele = url.match(/\/models\/([^:/?]+)/)?.[1] || null, attenteMax = NOUVEL_ESSAI_MAX_MS) {
    for (let essai = 0; ; essai++) {
      const r = await fetch(url, init);
      if (r.ok) return r;
      const e = await erreurGemini(r, modele);
      if (essai || !RETENTES.includes(e.cas)) throw e;
      const ms = Math.min(attenteMax, e.attenteMs || NOUVEL_ESSAI_MS);
      journal.warn?.(`Copilote CK3 : ${e.message} ; nouvelle tentative dans ${ms} ms`);
      await attendreSauf(ms, init?.signal).catch(raison => { throw annulee(raison) ? raison : e; });
    }
  }

  async function journaliser(e) {
    try {
      await mkdir(dossierJournal, {recursive: true});
      await appendFile(path.join(dossierJournal, `questions-${jourLocal().slice(0, 7)}.jsonl`), JSON.stringify(e) + '\n');
    } catch (err) { journal.error?.('Copilote CK3 : journal non écrit :', err.message); }
  }

  // ---- Une question ----
  async function deroule({audio, texte, voix, langue = 'fr', signal, pousser}) {
    const t0 = Date.now(), epoque = epoqueMemoire;
    const en = langue === 'en', T = TEXTES[en ? 'en' : 'fr'], ETAPES_Q = T.etapes;
    const q = {t: new Date().toISOString(), heure: heureLocale(), mode: audio ? 'voix' : 'texte', voix, question: '', reponse: '', modeles: [], jetons: {},
      durees: {}, recherches: [], sources: 0, extraits: [], cout: 0, secours: false, erreur: null};
    const ms = () => Date.now() - t0;
    function compter(modele, entree = 0, sortie = 0, pensee = 0) {
      const [pe, ps] = PRIX[modele] || [0, 0];
      q.cout += (entree * pe + (sortie + pensee) * ps) / 1e4;   // en cents
      const j = (q.jetons[modele] ??= {entree: 0, sortie: 0, pensee: 0, appels: 0});
      j.entree += entree; j.sortie += sortie; j.pensee += pensee; j.appels++;
      if (!q.modeles.includes(modele)) q.modeles.push(modele);
      conso?.enregistrer({agent: 'jarvis', modele, source: 'copilote CK3', usage: {input_tokens: entree, output_tokens: sortie + pensee, output_tokens_details: {reasoning_tokens: pensee}}});
    }
    function compterMinutes(modele, secondes) {
      q.cout += (PRIX_MINUTE[modele] || 0) * secondes / 60 * 100;
      const j = (q.jetons[modele] ??= {secondes: 0, appels: 0}); j.secondes = +(j.secondes + secondes).toFixed(1); j.appels++;
      if (!q.modeles.includes(modele)) q.modeles.push(modele);
      conso?.enregistrer({agent: 'jarvis', modele, source: 'copilote CK3', secondes});
    }
    // e : erreur classée (cas, credit, modele), ou {credit: true, cas} quand Google est déjà évité (panne en cours).
    function secours(e) {
      const cas = e?.cas || (Date.now() < panne.jusqua ? panne.cas : null) || 'panne';
      if (!cleOpenAI) throw francais(texteCas(T.secoursImpossible, cas, e?.modele));
      if (e?.credit) { panne.jusqua = Date.now() + 5 * 60e3; panne.cas = cas; }
      if (q.secours) return;
      q.secours = true;
      pousser({type: 'etape', etape: 'reflexion', secours: true, texte: !cleGemini ? T.secoursSansCle : texteCas(T.secours, cas, e?.modele)});
    }
    const panneEnCours = () => ({credit: Date.now() < panne.jusqua, cas: panne.cas});

    // Regard de l'appui pris AVANT tout contrôle : une question refusée ci-dessous (rien entendu, aucune clé) l'arrête dans le catch,
    // au lieu de le laisser imprimer CK3 jusqu'à 40 s et de servir à une question suivante qui n'a pas eu d'appui.
    let pre = null, preFini = false;
    try {
      pre = prendreRegard();
      if (!audio && !String(texte || '').trim()) throw francais(T.poseTaQuestion);
      if (!cleGemini && !cleOpenAI) throw francais(T.aucuneCle);
      const son = audio ? lireWav(audio, T) : null;
      if (son && (son.secondes < 0.3 || son.silence)) throw francais(T.rienEntendu);
      if (!son) q.question = String(texte).trim().slice(0, 2000);   // noté au journal même si la suite échoue

      // 1. Capture de la fenêtre du jeu et, en même temps, écoute de la question.
      pousser({type: 'etape', etape: 'capture', texte: ETAPES_Q.capture});
      // Vues prises de l'appui jusqu'à maintenant s'il y a eu appui (une capture ratée à l'appui est refaite maintenant), sinon
      // capture tout de suite. capture rend {images, principale, fin?, resume?}.
      if (pre) q.ageCapture = +((t0 - pre.t) / 1000).toFixed(1);
      // t : moment de la vue dans la question. Capture de l'appui ratée : celle faite maintenant date de la fin de la question (t > 0,
      // « pendant qu'il posait sa question »), pas de l'appui.
      const seule = (c, t = 0) => ({images: [{...c, t}], principale: 0});
      preFini = !!pre;   // finir() arrête lui-même le regard ; l'abandonner en route ferait refaire une capture pour rien
      const capture = (pre ? pre.finir().catch(() => aide.capturer().then(c => seule(c, Math.max(1, Date.now() - pre.t))))
        : aide ? aide.capturer().then(c => seule(c)) : Promise.reject(new Error('aide Windows absente'))).then(c => { q.durees.capture = ms(); return c; });
      capture.catch(() => {});
      const principaleDe = v => v?.images?.[v.principale] || v?.images?.[0] || null;
      const savoirAttendu = obtenirSavoir();
      // CK3 fermé ou réduit se sait en quelques ms (capture de l'appui déjà faite, ou échec immédiat) : on attend ce verdict
      // (250 ms au plus) AVANT de confier la voix au réseau, pour ne jamais envoyer le son d'une question sans réponse.
      const verdict = await Promise.race([capture.then(() => null, e => e), attendre(250)]);
      if (verdict && aideBloquante(verdict)) throw francais(texteAide(verdict, langue));
      signal.throwIfAborted();
      let ecoute = null;
      if (son) {
        pousser({type: 'etape', etape: 'ecoute', texte: ETAPES_Q.ecoute});
        ecoute = (async () => {
          if (!geminiDispo()) { secours(panneEnCours()); return {question: await transcrireOpenAI(son), termes: []}; }
          // Deux écoutes en parallèle : Flash rend la question ET les termes anglais du jeu, mais a mis 3 à 8 s le 06/10 ; le modèle
          // de transcription répond en 1,7 s. Flash est attendu au plus 1,5 s de plus, sinon on continue sans ses termes (le lexique
          // français-anglais du savoir prend le relais).
          const complet = Promise.race([capture.catch(() => null), attendre(700)]).then(c => ecouterGemini(son, principaleDe(c)?.plein));   // image basse résolution si prête
          const rapide = transcrireGemini(son).then(question => ({question, termes: []}));
          complet.catch(() => {}); rapide.catch(() => {});
          // Les deux écoutes ratées : l'erreur classée (clé refusée, quota…) l'emporte sur une erreur quelconque, elle est notée
          // au journal avec son statut HTTP, et c'est sa vraie cause qui est dite (plus jamais « Google ne répond pas » pour
          // une clé refusée).
          const premier = await Promise.any([complet.then(r => ({...r, flash: true})), rapide]).catch(ae => { const l = ae.errors || [ae]; return {erreur: l.find(x => x?.cas) || l[0]}; });
          if (premier.erreur) {
            if (annulee(premier.erreur)) throw premier.erreur;
            journal.error?.('Copilote CK3 : écoute Google impossible :', premier.erreur.message);
            secours(premier.erreur);
            return {question: await transcrireOpenAI(son), termes: []};
          }
          // Silence ou pas : c'est le modèle de transcription qui tranche. Flash a déjà inventé une question à partir de l'image
          // quand l'audio était muet (essai du 06/10).
          if (premier.flash) return premier.question ? premier : rapide.catch(() => premier);
          if (!premier.question) return premier;
          const fin = await Promise.race([complet.catch(() => null), attendre(1500)]);
          return fin?.question ? fin : premier;
        })().then(r => { q.durees.ecoute = ms(); return r; });
        ecoute.catch(() => {});
      }
      let vue = null, raisonSansImage = '';
      try { vue = await capture; } catch (e) {
        if (aideBloquante(e)) throw francais(texteAide(e, langue));
        raisonSansImage = texteAide(e, langue);   // dite au modèle, dans la langue de ses consignes
      }
      const images = (vue?.images || []).filter(v => v?.plein?.length);
      if (vue && !images.length) raisonSansImage = T.captureVide;
      const principale = images.includes(principaleDe(vue)) ? principaleDe(vue) : images[0] || null;
      if (vue?.resume) q.regard = {...vue.resume, choisies: images.map(v => +(v.t / 1000).toFixed(1)), principale: images.indexOf(principale)};
      // Pour le dépannage, écrasée à chaque question : la vue principale seulement (jamais les autres).
      if (principale) mkdir(dossierMemoire, {recursive: true}).then(() => writeFile(path.join(dossierMemoire, 'derniere-capture.jpg'), principale.plein)).catch(() => {});

      let termes = [];
      if (ecoute) ({question: q.question, termes} = await ecoute);
      if (!q.question || q.question.replace(/[^\p{L}\p{N}]/gu, '').length < 2) throw francais(T.rienEntendu);
      pousser({type: 'question', texte: q.question});

      // 2. Encyclopédie du jeu (exacte pour sa version). Introuvable : dit une fois dans le panneau, puis on répond sans elle.
      const savoir = await savoirAttendu;
      if (!savoir && savoirErreur && !savoirAverti) { savoirAverti = true; pousser({type: 'avertissement', message: T.encyclopedieIntrouvable(savoirErreur)}); }
      const extraits = savoir ? savoir.chercher(termes, q.question, 6000, langue) : [];
      q.extraits = extraits.map(e => e.cle);

      // 3. Réponse (au fil de l'eau) et 4. voix.
      pousser({type: 'etape', etape: 'reflexion', texte: ETAPES_Q.reflexion});
      if (Date.now() - dernierEchange > OUBLI_MS || langueMemoire !== langue) historique = [];
      const parts = [];
      // Textes d'accompagnement dans la langue de la réponse : des consignes en français autour d'une question anglaise faisaient
      // répondre en français.
      const image = images.length === 1 ? images[0] : null;
      // Une seule vue (écran inchangé pendant la question, question écrite, pas d'appui) : textes d'avant, mot pour mot.
      const prise = en ? (q.ageCapture == null ? 'at the moment of the question' : image?.t > 0 ? 'while they were asking their question' : 'when they pressed the key to ask their question')
        : (q.ageCapture == null ? 'au moment de la question' : image?.t > 0 ? 'pendant qu\'il posait sa question' : 'quand il a appuyé pour poser sa question');
      if (image && en) {
        parts.push({texte: `Screenshot of the Crusader Kings III window taken ${prise} (${image.largeur || '?'}×${image.hauteur || '?'}):`}, {image: image.plein});
        if (image.zoom?.length) parts.push({texte: `Zoom around the mouse cursor (native resolution${image.curseur ? `; cursor at x=${image.curseur.x}, y=${image.curseur.y} in the window` : ''}):`}, {image: image.zoom});
      } else if (image) {
        parts.push({texte: `Capture de la fenêtre de Crusader Kings III prise ${prise} (${image.largeur || '?'}×${image.hauteur || '?'}) :`}, {image: image.plein});
        if (image.zoom?.length) parts.push({texte: `Zoom autour du curseur de la souris (résolution native${image.curseur ? ` ; curseur en x=${image.curseur.x}, y=${image.curseur.y} dans la fenêtre` : ''}) :`}, {image: image.zoom});
      } else if (images.length > 1) {
        // Plusieurs vues : dans l'ordre, chacune avec son heure dans la question et l'état de la souris. Les zooms (résolution
        // native, là où se lisent les info-bulles) restent en haute résolution ; à 3 ou 4 vues, seule la principale part entière en
        // haute résolution, les autres en moyenne (529 jetons Gemini au lieu de 1 102).
        const n = images.length, fin = Math.max(vue.fin ?? 0, images.at(-1).t), duree = secondes(q.ageCapture != null ? q.ageCapture * 1000 : fin, en);
        parts.push({texte: en ? `Here are ${n} screenshots of the Crusader Kings III window taken WHILE they were speaking (${duree} s), in order: the screen changed during their question. They may be SHOWING you something as they talk ("look", "I'm showing you", "this"): hovering an element, opening a panel or scrolling, and tooltips vanish as soon as the mouse moves. Use the image that matches what they are talking about (often the one where the mouse stopped on what they point at); do not describe every image.`
          : `Voici ${n} captures de la fenêtre de Crusader Kings III prises PENDANT qu'il parlait (${duree} s), dans l'ordre : l'écran a changé pendant sa question. Il est peut-être en train de te MONTRER quelque chose en parlant (« je te montre », « regarde », « ça ») : il survole un élément, ouvre un panneau ou fait défiler, et les info-bulles disparaissent dès que la souris bouge. Sers-toi de l'image qui correspond à ce dont il parle (souvent celle où la souris s'est arrêtée sur ce qu'il désigne) ; ne décris pas toutes les images.`});
        images.forEach((v, i) => {
          parts.push({texte: libelleVue(v, i, n, fin, en)}, {image: v.plein, resolution: n <= 2 || v === principale ? 'haute' : 'moyenne'});
          if (v.zoom?.length) parts.push({texte: en ? `Zoom of image ${i + 1} around the mouse cursor (native resolution):` : `Zoom de l'image ${i + 1} autour du curseur de la souris (résolution native) :`}, {image: v.zoom});
        });
      } else if (en) parts.push({texte: `(No screenshot: ${raisonSansImage || T.sansImage}. Answer without seeing the screen and say so in one sentence.)`});
      else parts.push({texte: `(Pas de capture d'écran : ${raisonSansImage || T.sansImage}. Réponds sans voir l'écran et dis-le en une phrase.)`});
      if (extraits.length) parts.push({texte: (en ? `Excerpts from the game's Encyclopedia (exact texts of the installed version ${savoir.version}):\n\n` : `Extraits de l'Encyclopédie du jeu (textes exacts de la version ${savoir.version} installée) :\n\n`) + extraits.map(e => `## ${e.titre}\n${e.texte}`).join('\n\n')});
      // Sans extrait, le modèle répondait de mémoire avec des chiffres faux (« 20 comtés sur 38 » pour l'Irlande, qui en a 14).
      else if (savoir) parts.push({texte: en ? 'No excerpt from the game\'s Encyclopedia covers this question. If it is about a game rule, run a Google search (official CK3 wiki, 1.20 or 1.19 pages) before stating a rule or a number; otherwise say what remains to be checked and where to see it in the game.'
        : 'Aucun extrait de l\'Encyclopédie du jeu ne couvre cette question. Si elle porte sur une règle du jeu, fais une recherche Google (wiki officiel de CK3, pages 1.20 ou 1.19) avant d\'affirmer une règle ou un chiffre ; sinon dis ce qui reste à vérifier et où le voir dans le jeu.'});
      parts.push({texte: en ? `${joueur.en.De} question${son ? ' (spoken aloud, transcribed)' : ''}: ${q.question}` : `Question ${joueur.fr.de}${son ? ' (dite à voix haute, transcrite)' : ''} : ${q.question}`});
      q.images = parts.filter(p => p.image).length;   // images envoyées au modèle de réponse (vues entières et zooms)
      const systeme = consignes(savoir, langue, joueur);

      let index = 0;
      const lecture = voix ? creerLecture({signal, synthetiser: (t, m) => synthetiser(t, m), emettre: pcm => {
        if (index === 0) { q.durees.premierSon = ms(); pousser({type: 'etape', etape: 'voix', texte: ETAPES_Q.voix}); }
        pousser({type: 'audio', pcm: pcm.toString('base64'), index: index++});
      }}) : null;
      const surTexte = delta => {
        if (!q.reponse) q.durees.premierTexte = ms();
        q.reponse += delta;
        pousser({type: 'texte', delta});
        lecture?.ajouter(delta);
      };
      let rep = null;
      if (geminiDispo()) {
        try { rep = await repondreGemini({parts, systeme, signal, surTexte, pousser}); } catch (e) {
          if (annulee(e)) throw e;
          if (q.reponse) throw francais(T.coupee);
          journal.error?.('Copilote CK3 : Gemini indisponible :', e.message);
          secours(e);
        }
      } else secours(panneEnCours());
      if (!rep) rep = await repondreOpenAI({parts, systeme, signal, surTexte});
      q.durees.reponse = ms();
      if (rep.liens.length || rep.suggestionsHtml) pousser({type: 'sources', liens: rep.liens, ...(rep.suggestionsHtml ? {suggestionsHtml: rep.suggestionsHtml} : {})});
      q.sources = rep.liens.length; q.recherches = rep.recherches;
      if (lecture) {
        await lecture.terminer();
        signal.throwIfAborted();
        const erreurs = lecture.erreurs();
        if (erreurs.length) { q.erreurVoix = erreurs[0].message; if (index === 0) pousser({type: 'etape', etape: 'voix', texte: T.voixIndisponible}); }
      }
      // En mémoire seulement une réponse complète, et seulement si Ameur n'a pas demandé l'oubli pendant qu'elle s'écrivait.
      if (rep.complet && epoque === epoqueMemoire) {
        if (langueMemoire !== langue) historique = [];
        historique.push({question: q.question, reponse: q.reponse});
        historique = historique.slice(-ECHANGES_MAX);
        dernierEchange = Date.now(); langueMemoire = langue;
      } else if (!rep.complet) q.incomplete = true;
      q.durees.total = ms();
      pousser({type: 'fin', ms: q.durees.total, coutCents: +q.cout.toFixed(3)});
    } catch (e) {
      if (!preFini) pre?.abandonner();
      q.erreur = annulee(e) ? 'annulée (nouvelle question ou page fermée)' : e.message;
      q.durees.total = ms();
      if (!annulee(e)) {
        if (!e.francais) journal.error?.('Copilote CK3 :', e.message);
        pousser({type: 'erreur', message: messageErreur(e, T)});
      }
    } finally {
      await journaliser({t: q.t, heure: q.heure, mode: q.mode, voix: q.voix, ...(en ? {langue} : {}), question: q.question, reponse: q.reponse, modeles: q.modeles, jetons: q.jetons,
        durees: q.durees, ...(q.ageCapture != null ? {ageCapture: q.ageCapture} : {}), ...(q.images != null ? {images: q.images} : {}), ...(q.regard ? {regard: q.regard} : {}),
        recherches: q.recherches, sources: q.sources, extraits: q.extraits, coutCents: +q.cout.toFixed(3), secours: q.secours,
        ...(q.erreurVoix ? {erreurVoix: q.erreurVoix} : {}), ...(q.incomplete ? {incomplete: true} : {}), erreur: q.erreur});
    }

    // --- Appels aux modèles (fermetures : ils comptent leurs jetons dans q) ---
    async function ecouterGemini(son, plein) {
      const schema = {type: 'OBJECT', required: ['question', 'termes'], properties: {
        question: {type: 'STRING', description: en ? 'The question, transcribed word for word in English.' : 'La question, transcrite mot pour mot en français.'},
        termes: {type: 'ARRAY', maxItems: 6, items: {type: 'STRING'}, description: en ? 'Up to 6 ENGLISH Crusader Kings III terms, as in the game\'s Encyclopedia.' : 'Jusqu’à 6 termes ANGLAIS de Crusader Kings III, tels que dans l’Encyclopédie du jeu.'}}};
      const consigne = en ? 'Transcribe word for word the spoken question of an English-speaking Crusader Kings III player (the game interface is in English; the image, if any, shows their screen). Then give up to 6 ENGLISH game terms, as they appear in the game\'s Encyclopedia, useful to answer (e.g. Truce, Casus Belli, Hook). Never infer the question from the image: if there is no speech, question = "".'
        : 'Transcris mot pour mot la question orale d’un joueur francophone de Crusader Kings III (interface du jeu en anglais ; l’image, s’il y en a une, montre son écran). Puis donne jusqu’à 6 termes ANGLAIS du jeu, tels qu’ils apparaissent dans l’Encyclopédie du jeu, utiles pour répondre (ex. Truce, Casus Belli, Hook). Ne déduis jamais la question de l’image : s’il n’y a pas de parole, question = "".';
      const r = await appelGemini(`${GEMINI}/models/${M.ecoute}:generateContent`, {method: 'POST', headers: enteteGemini, signal: delai(signal, 20000), body: JSON.stringify({
        systemInstruction: {parts: [{text: consigne}]},
        contents: [{role: 'user', parts: [...(plein ? [{inline_data: {mime_type: 'image/jpeg', data: plein.toString('base64')}, mediaResolution: {level: 'MEDIA_RESOLUTION_LOW'}}] : []), {inline_data: {mime_type: 'audio/wav', data: son.b64}}]}],
        generationConfig: {responseMimeType: 'application/json', responseSchema: schema, thinkingConfig: {thinkingLevel: 'low'}, temperature: 0}})});
      const j = await r.json();
      const u = j.usageMetadata || {};
      compter(M.ecoute, u.promptTokenCount, u.candidatesTokenCount, u.thoughtsTokenCount);
      const brut = (j.candidates?.[0]?.content?.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join('');
      let o; try { o = JSON.parse(brut); } catch { o = {question: brut, termes: []}; }
      return {question: String(o.question || '').trim(), termes: (Array.isArray(o.termes) ? o.termes : []).map(String).slice(0, 6)};
    }

    async function transcrireGemini(son) {
      const r = await appelGemini(`${GEMINI}/models/${M.transcription}:generateContent`, {method: 'POST', headers: enteteGemini, signal: delai(signal, 15000), body: JSON.stringify({
        contents: [{role: 'user', parts: [{text: en ? 'Transcribe word for word, in English, the question of a Crusader Kings III player (count, duke, truce, hook…).' : 'Transcris mot pour mot, en français, la question d’un joueur de Crusader Kings III (comte, duc, trêve, hameçon…).'}, {inline_data: {mime_type: 'audio/wav', data: son.b64}}]}]})});
      const j = await r.json();
      const u = j.usageMetadata || {};
      compter(M.transcription, u.promptTokenCount, u.candidatesTokenCount);
      return (j.candidates?.[0]?.content?.parts || []).map(p => p.audioTranscription?.text ?? (p.thought ? '' : p.text || '')).join(' ').trim();   // réponse dans audioTranscription.text
    }

    async function transcrireOpenAI(son) {
      const form = new FormData();
      form.append('model', M.transcriptionSecours);
      form.append('language', langue);
      form.append('file', new Blob([Buffer.from(son.b64, 'base64')], {type: 'audio/wav'}), 'question.wav');
      const r = await fetch(`${OPENAI}/audio/transcriptions`, {method: 'POST', headers: {Authorization: `Bearer ${cleOpenAI}`}, body: form, signal: delai(signal, 30000)});
      if (!r.ok) throw await erreurOpenAI(r);
      const j = await r.json();
      compterMinutes(M.transcriptionSecours, son.secondes);
      return String(j.text || '').trim();
    }

    // Historique (texte seulement) + tour actuel. parts : [{texte} | {image: Buffer}].
    async function repondreGemini({parts, systeme, signal, surTexte, pousser}) {
      const contents = historique.flatMap(h => [{role: 'user', parts: [{text: h.question}]}, {role: 'model', parts: [{text: h.reponse}]}]);
      contents.push({role: 'user', parts: parts.map(p => p.image ? {inline_data: {mime_type: 'image/jpeg', data: p.image.toString('base64')}, mediaResolution: {level: p.resolution === 'moyenne' ? 'MEDIA_RESOLUTION_MEDIUM' : 'MEDIA_RESOLUTION_HIGH'}} : {text: p.texte})});
      let usage = {}, gm = null, recherche = false, texte = '', fin = null;
      // Google n'envoie ses en-têtes qu'avec le premier morceau : sans nouvelles après 3,5 s, on dit à Ameur que ça avance, sans
      // prétendre chercher sur Internet (« Je vérifie sur Internet » n'est dit que si Google annonce une vraie recherche).
      const minuteur = setTimeout(() => { if (!texte && !recherche) pousser({type: 'etape', etape: 'reflexion', texte: ETAPES_Q.prepare}); }, 3500);
      // Le 06/10, Flash a « réfléchi » 38 s avant d'écrire (3 928 jetons de réflexion au niveau low) : sans premier mot après
      // 25 s (une réponse avec recherche Google a mis jusqu'à 18 s), on passe par OpenAI plutôt que de laisser Ameur attendre.
      const lenteur = new AbortController();
      const garde = setTimeout(() => lenteur.abort(new DOMException('Google met trop de temps à écrire', 'TimeoutError')), 25000);
      try {
        const r = await appelGemini(`${GEMINI}/models/${M.reponse}:streamGenerateContent?alt=sse`, {method: 'POST', headers: enteteGemini, signal: AbortSignal.any([delai(signal, 60000), lenteur.signal]), body: JSON.stringify({
          systemInstruction: {parts: [{text: systeme}]}, contents, tools: [{google_search: {}}],
          generationConfig: {thinkingConfig: {thinkingLevel: 'low'}, maxOutputTokens: 4096}})});
        for await (const j of evenementsSse(r)) {
          if (j.error) throw erreurDansFlux(j.error, M.reponse);
          if (j.usageMetadata) usage = j.usageMetadata;
          const c = j.candidates?.[0];
          if (c?.groundingMetadata) {
            gm = {...gm, ...c.groundingMetadata};
            if (!recherche && !texte && c.groundingMetadata.webSearchQueries?.length) { recherche = true; pousser({type: 'etape', etape: 'recherche', texte: ETAPES_Q.recherche}); }
          }
          for (const p of c?.content?.parts || []) if (p.text && !p.thought) { clearTimeout(garde); texte += p.text; surTexte(p.text); }
          if (c?.finishReason) fin = c.finishReason;
        }
      } finally { clearTimeout(minuteur); clearTimeout(garde); }
      compter(M.reponse, (usage.promptTokenCount || 0) + (usage.toolUsePromptTokenCount || 0), usage.candidatesTokenCount, usage.thoughtsTokenCount);
      if (!texte.trim()) throw new Error(`Gemini : réponse vide (${fin || 'sans raison'})`);
      const vus = new Set();
      const liens = (gm?.groundingChunks || []).map(g => g.web).filter(w => w?.uri && !vus.has(w.title) && vus.add(w.title)).map(w => ({titre: w.title || 'source', url: w.uri})).slice(0, 6);
      // complet : Google a donné sa raison de fin (STOP...) ; un flux coupé sans elle n'est pas gardé en mémoire.
      return {texte, liens, suggestionsHtml: gm?.searchEntryPoint?.renderedContent || null, recherches: gm?.webSearchQueries || [], complet: !!fin};
    }

    async function repondreOpenAI({parts, systeme, signal, surTexte}) {
      const input = historique.flatMap(h => [{role: 'user', content: h.question}, {role: 'assistant', content: h.reponse}]);
      input.push({role: 'user', content: parts.map(p => p.image ? {type: 'input_image', image_url: `data:image/jpeg;base64,${p.image.toString('base64')}`, detail: 'high'} : {type: 'input_text', text: p.texte})});
      const r = await fetch(`${OPENAI}/responses`, {method: 'POST', headers: enteteOpenAI, signal: delai(signal, 60000), body: JSON.stringify({
        model: M.secours, instructions: systeme, input, stream: true, reasoning: {effort: 'low'}, tools: [{type: 'web_search'}]})});
      if (!r.ok) throw await erreurOpenAI(r);
      let texte = '', usage = null, recherches = 0, termine = false;
      const liens = [], vus = new Set();
      for await (const j of evenementsSse(r)) {
        if (j.type === 'response.output_text.delta') { texte += j.delta; surTexte(j.delta); }
        else if (j.type === 'response.output_text.annotation.added' && j.annotation?.type === 'url_citation' && !vus.has(j.annotation.url)) { vus.add(j.annotation.url); liens.push({titre: j.annotation.title || new URL(j.annotation.url).hostname, url: j.annotation.url}); }
        else if (j.type === 'response.web_search_call.completed') recherches++;
        else if (j.type === 'response.completed') { usage = j.response?.usage; termine = true; }
        else if (j.type === 'error' || j.type === 'response.failed') throw new Error(`OpenAI : ${j.error?.message || j.response?.error?.message || j.message || 'échec'}`);
      }
      if (usage) compter(M.secours, usage.input_tokens, (usage.output_tokens || 0) - (usage.output_tokens_details?.reasoning_tokens || 0), usage.output_tokens_details?.reasoning_tokens || 0);
      q.cout += recherches * PRIX_RECHERCHE_OPENAI * 100;
      if (!texte.trim()) throw new Error('OpenAI : réponse vide');
      return {texte, liens: liens.slice(0, 6), suggestionsHtml: null, recherches: recherches ? [`${recherches} recherche(s) web OpenAI`] : [], complet: termine};
    }

    // Voix : Gemini TTS en flux par streamGenerateContent (premier son mesuré à 0,65 s, contre 2,4 s par l'API Interactions),
    // puis l'API Interactions seulement si Google REFUSE cette voie (erreur 4xx hors crédit), sinon (Google muet 8 s, panne 5xx,
    // crédit) OpenAI tout de suite. Une phrase déjà commencée n'est jamais relue en double.
    async function synthetiser(texte, surMorceau) {
      let recu = false;
      const morceau = b => { recu = true; surMorceau(b); };
      if (geminiDispo()) {
        try { return await voixGemini(texte, morceau); } catch (e) {
          if (annulee(e) || signal.aborted || recu) throw e;
          const refus = !e.credit && e.statut !== 429 && e.statut >= 400 && e.statut < 500;   // 429 « limite » : déjà retenté, pas une autre voie
          if (refus) try { return await voixInteractions(texte, morceau); } catch (e2) { if (annulee(e2) || signal.aborted || recu) throw e2; }
          secours(e);
        }
      } else if (!cleOpenAI) throw new Error('voix indisponible');
      return voixOpenAI(texte, morceau);
    }
    function decoupeur(surMorceau) {   // garde des échantillons de 16 bits entiers
      let reste = null;
      return b => {
        if (reste) { b = Buffer.concat([reste, b]); reste = null; }
        if (b.length % 2) { reste = b.subarray(b.length - 1); b = b.subarray(0, b.length - 1); }
        if (b.length) surMorceau(b);
      };
    }
    async function voixGemini(texte, surMorceau) {
      const garde = gardePremierMorceau(delai(signal, 30000), PREMIER_SON_MS);
      try {
        const r = await appelGemini(`${GEMINI}/models/${M.voix}:streamGenerateContent?alt=sse`, {method: 'POST', headers: enteteGemini, signal: garde.signal, body: JSON.stringify({
          contents: [{role: 'user', parts: [{text: texte}]}],
          generationConfig: {responseModalities: ['AUDIO'], speechConfig: {voiceConfig: {prebuiltVoiceConfig: {voiceName: VOIX_GEMINI}}}}})}, M.voix, NOUVEL_ESSAI_VOIX_MS);
        const sortie = decoupeur(b => { garde.recu(); surMorceau(b); });
        let usage = {};
        for await (const j of evenementsSse(r)) {
          if (j.error) throw erreurDansFlux(j.error, M.voix);
          if (j.usageMetadata) usage = j.usageMetadata;
          for (const p of j.candidates?.[0]?.content?.parts || []) if (p.inlineData?.data) sortie(Buffer.from(p.inlineData.data, 'base64'));
        }
        compter(M.voix, usage.promptTokenCount, usage.candidatesTokenCount);
      } finally { garde.recu(); }
    }
    async function voixInteractions(texte, surMorceau) {
      const garde = gardePremierMorceau(delai(signal, 30000), PREMIER_SON_MS);
      try {
        const r = await appelGemini(`${GEMINI}/interactions`, {method: 'POST', headers: enteteGemini, signal: garde.signal, body: JSON.stringify({
          model: M.voix, input: [{type: 'user_input', content: [{type: 'text', text: texte}]}], response_format: {type: 'audio'},
          generation_config: {speech_config: [{voice: VOIX_GEMINI}]}, stream: true})}, M.voix, NOUVEL_ESSAI_VOIX_MS);
        const sortie = decoupeur(b => { garde.recu(); surMorceau(b); });
        let usage = {};
        for await (const j of evenementsSse(r)) {
          if (j.error) throw erreurDansFlux(j.error, M.voix);
          if (j.event_type === 'step.delta' && j.delta?.type === 'audio' && j.delta.data) sortie(Buffer.from(j.delta.data, 'base64'));
          else if (j.event_type === 'interaction.completed') usage = j.interaction?.usage || {};
        }
        compter(M.voix, usage.total_input_tokens, usage.total_output_tokens);
      } finally { garde.recu(); }
    }
    async function voixOpenAI(texte, surMorceau) {
      const r = await fetch(`${OPENAI}/audio/speech`, {method: 'POST', headers: enteteOpenAI, signal: delai(signal, 45000), body: JSON.stringify({
        model: M.voixSecours, voice: VOIX_OPENAI, input: texte, response_format: 'pcm', instructions: en ? 'Calm, clear and warm voice, in English.' : 'Voix posée, claire et chaleureuse, en français ; les termes anglais du jeu sont prononcés en anglais.'})});
      if (!r.ok) throw await erreurOpenAI(r);
      const sortie = decoupeur(surMorceau);
      let octets = 0;
      for await (const b of r.body) { octets += b.length; sortie(Buffer.from(b)); }
      compterMinutes(M.voixSecours, octets / 48000);   // PCM 24 kHz, 16 bits, mono
    }
  }

  // francais : message déjà prêt pour le joueur (le nom date d'avant l'anglais ; il est écrit dans la langue de la question).
  function messageErreur(e, T = TEXTES.fr) {
    if (e.francais) return e.message;
    if (e.name === 'TimeoutError') return T.tropLong;
    if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(`${e.message} ${e.cause?.code || ''}`)) return T.horsLigne;
    if (/^OpenAI/.test(e.message)) return T.aucunService;
    return T.echec(e.message.slice(0, 200));
  }

  // Événements d'une question (générateur). Une nouvelle question annule celle en cours (la page coupe aussi sa voix).
  // langue : 'fr' (défaut) ou 'en' ; toute autre valeur revient au français.
  async function* poser({audio, texte, voix = true, signal, langue = 'fr'} = {}) {
    enCours?.abort();
    const local = new AbortController();
    enCours = local;
    const relayer = () => local.abort();
    if (signal?.aborted) local.abort(); else signal?.addEventListener('abort', relayer, {once: true});
    const c = canal();
    const travail = deroule({audio, texte, voix: voix !== false, langue: langueValide(langue), signal: local.signal, pousser: c.pousser}).finally(() => c.fermer());
    try {
      for await (const ev of c) {
        yield ev;
        if (ev.type === 'fin' || ev.type === 'erreur') break;
      }
    } finally {
      local.abort();
      await Promise.race([travail, attendre(2000)]);   // la question est notée au journal avant de rendre la main
      signal?.removeEventListener('abort', relayer);
      if (enCours === local) enCours = null;
    }
  }

  // aide : {ok} ou {ok: false, erreur} quand l'aide Windows ne répond pas (10/10/2026 : la page disait alors « CK3 n'est pas lancé »).
  async function etat() {
    const s = await obtenirSavoir();
    let ck3 = false, aideErreur = null;
    if (!aide) aideErreur = 'aide Windows absente';
    else try { ck3 = !!(await Promise.race([aide.etat(), attendre(3000).then(() => { throw new Error('Aide Windows sans réponse'); })])).ck3; } catch (e) { aideErreur = e?.message || 'Aide Windows indisponible'; }
    return {ck3, aide: aideErreur ? {ok: false, erreur: aideErreur} : {ok: true}, version: s?.version || null, extensions: s?.extensions || {possedees: [], manquantes: []}, joueur: joueur.prenom ? 'prenom' : 'generique',
      cle: {gemini: !!cleGemini, openai: !!cleOpenAI}, voix: !!(cleGemini || cleOpenAI), modeles: {reponse: M.reponse, voix: `${M.voix} (${VOIX_GEMINI})`, secours: M.secours}};
  }

  function oublier() { epoqueMemoire++; historique = []; dernierEchange = 0; }

  function lireCorps(req, T = TEXTES.fr) {
    return new Promise((ok, ko) => {
      if (Number(req.headers['content-length'] || 0) > MAX_CORPS) { req.resume(); return ko(francais(T.tropLourde, {code: 413})); }
      const morceaux = []; let taille = 0, trop = false;
      req.on('data', m => { if (trop) return; taille += m.length; if (taille > MAX_CORPS) { trop = true; morceaux.length = 0; } else morceaux.push(m); });
      req.on('end', () => trop ? ko(francais(T.tropLourde, {code: 413})) : ok(Buffer.concat(morceaux).toString('utf8')));
      req.on('error', ko);
    });
  }

  // Routes /api/jeu/* ; url est un objet URL. ?langue=en (la page l'ajoute partout) : textes renvoyés en anglais, y compris
  // avant la lecture du corps (question trop lourde) ; pour une question, le champ langue du corps l'emporte.
  async function route(url, req, res) {
    if (!url.pathname.startsWith('/api/jeu/')) return false;
    const json = (code, obj) => { res.writeHead(code, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}); res.end(JSON.stringify(obj)); };
    const langueUrl = langueValide(url.searchParams?.get('langue'));
    try {
      if (url.pathname === '/api/jeu/etat' && req.method === 'GET') return json(200, await etat()), true;
      if (url.pathname === '/api/jeu/oublier' && req.method === 'POST') { req.resume(); oublier(); return json(200, {ok: true}), true; }
      // ?regard= : identifiant choisi par la page pour cet appui (lettres, chiffres, tirets) ; il sert à l'annuler.
      const idRegard = /^[\w-]{1,40}$/.test(url.searchParams?.get('regard') || '') ? url.searchParams.get('regard') : null;
      if (url.pathname === '/api/jeu/regard/arret' && req.method === 'POST') { req.resume(); return json(200, {ok: true, arrete: arreterRegard(idRegard)}), true; }
      if (url.pathname === '/api/jeu/capturer' && req.method === 'POST') {
        req.resume();
        // bloquant : CK3 fermé ou réduit (la page referme alors le micro) ; code : celui de l'aide, pour qui veut sa propre phrase.
        const c = await precapturer(idRegard).catch(e => ({erreur: texteAide(e, langueUrl), code: codeAide(e), bloquant: aideBloquante(e)}));
        return json(200, c.erreur ? {ok: false, erreur: c.erreur, ...(c.code ? {code: c.code} : {}), bloquant: c.bloquant} : {ok: true, ms: c.ms, largeur: c.largeur, hauteur: c.hauteur, zoom: !!c.zoom}), true;
      }
      if (url.pathname !== '/api/jeu/question' || req.method !== 'POST') return json(404, {erreur: 'route inconnue'}), true;
      let corps;
      try { corps = JSON.parse((await lireCorps(req, TEXTES[langueUrl])) || '{}'); } catch (e) { return json(e.code === 413 ? 413 : 400, {erreur: e.francais ? e.message : TEXTES[langueUrl].jsonInvalide}), true; }
      const options = {audio: typeof corps.audio === 'string' && corps.audio ? corps.audio : undefined, texte: typeof corps.texte === 'string' ? corps.texte : undefined, voix: corps.voix !== false,
        langue: langueValide(corps.langue ?? langueUrl)};
      res.writeHead(200, {'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no'});
      res.flushHeaders?.();
      const ctrl = new AbortController();
      res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });
      // Battement (commentaire SSE, ignoré par les lecteurs) : une voix lente ne fait plus croire à la page que le serveur est mort.
      const battement = setInterval(() => { if (!res.writableEnded && !res.destroyed) res.write(': battement\n\n'); }, BATTEMENT_MS);
      try {
        for await (const ev of poser({...options, signal: ctrl.signal})) {
          if (res.destroyed) break;
          res.write(`data: ${JSON.stringify(ev)}\n\n`);
        }
      } finally { clearInterval(battement); }
      if (!res.writableEnded) res.end();
      return true;
    } catch (e) {
      journal.error?.('Copilote CK3 : route', url.pathname, e.message);
      if (!res.headersSent) json(500, {erreur: e.message}); else if (!res.writableEnded) res.end();
      return true;
    }
  }

  return {route, poser, etat, oublier, precapturer, arreterRegard};
}
