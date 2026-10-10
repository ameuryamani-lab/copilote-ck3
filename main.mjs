// Copilote CK3, processus principal Electron (06/10/2026). Une petite icône micro reste au-dessus de Crusader Kings III sans
// jamais lui prendre le focus (focusable:false = WS_EX_NOACTIVATE) ; Ctrl+Maj+Espace ou un clic, Ameur pose sa question à voix
// haute, la réponse s'affiche dans un panneau et se dit à voix haute. L'appli ne touche jamais au jeu ni au clavier : la capture
// et le crochet du raccourci sont dans aide-windows.mjs, le cerveau dans agent/copilote-jeu.mjs (via serveur.mjs).
// Essai sans rien afficher : electron . --essai-fenetre (vraie aide sans crochet clavier ; COPILOTE_ESSAI_STUB=1 pour se passer du cerveau ;
// COPILOTE_LANGUE=en|fr pour essayer une langue).
// Langue (06/10/2026, publication sur GitHub) : français ou anglais, au choix dans le menu de la zone de notification ; par défaut
// celle de Windows (français chez Ameur, donc rien ne change pour lui).
// Icône figée (07/10 puis 09/10/2026 : en pleine partie, impossible de la déplacer ou de la fermer, pas d'icône dans la barre des
// tâches, zone de notification hors d'atteinte en plein écran) : la page bat toutes les 3 s et Electron la récupère seule
// (repli, rechargement, arrêt de son processus, fenêtre recréée) ; Ctrl+Maj+Retour arrière dans le jeu réinitialise le copilote,
// deux fois le quitte (l'aide Windows l'arrête de force si Electron lui-même est figé) ; clic droit sur l'icône : petit menu ;
// journal des moments clés dans app.log (questions, panneau, glissements, récupérations, processus arrêtés, erreurs de la page).
import {app, BrowserWindow, ipcMain, session, screen, Tray, Menu, nativeImage, shell, globalShortcut, nativeTheme, dialog} from 'electron';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdirSync, appendFileSync, readFileSync, writeFileSync, statSync, renameSync} from 'node:fs';
import {demarrerServeur, lireEnv} from './serveur.mjs';

const DOSSIER = path.dirname(fileURLToPath(import.meta.url));
const ROOT = DOSSIER;   // version publiée : .env, agent/, journal/ et memoire/ sont dans le dossier de l'appli
const MEMOIRE = path.join(ROOT, 'memoire', 'copilote-ck3');
const JOURNAUX = path.join(ROOT, 'journal', 'copilote-ck3');
const FICHIER_POSITION = path.join(MEMOIRE, 'position.json');
const FICHIER_REGLAGES = path.join(MEMOIRE, 'reglages.json');
const ESSAI = process.argv.includes('--essai-fenetre');
const FICHIER_JOURNAL = path.join(JOURNAUX, ESSAI ? 'essai-fenetre.log' : 'app.log');
const TOUJOURS = process.env.COPILOTE_TOUJOURS === '1';
const PETIT = 72, LARGE = 440, HAUT = 420;
const BORD = 60;   // CK3 fait défiler la carte quand la souris touche le bord de l'écran : l'icône s'en tient à distance
// Fenêtres principales de CK3 (Realm, Military, Council, Court, Intrigue, Factions, Decisions, Activities : F2 à F9) : 655 px
// de large collés au bord droit, toute la hauteur (gui/shared/windows.gui, Window_Size_MainTab). Le panneau ouvert reste à leur
// gauche, sinon il cache justement la fenêtre que la réponse dit d'ouvrir.
const FENETRES_JEU = 655 + 10;
// Chien de garde de la page : battement attendu toutes les 3 s ; 10 s sans battement = page figée. Récupération par étapes :
// repli + rechargement, puis (5 s sans réponse) arrêt du processus de la page, puis (8 s) fenêtre recréée. Au plus 3 récupérations
// en 10 min (une page qui ne démarre plus ne doit pas tourner en boucle).
// Revue du 09/10/2026 : chargement d'une page borné à 10 s (au-delà, son processus est arrêté) ; une recréation de plus de 15 s
// ne bloque plus rien ; page qui bat mais reste « en écoute » plus de 45 s (elle s'arrête d'elle-même à 30 s) : récupérée ;
// page arrêtée (plantage) plus de 3 fois en 10 min : plus rechargée en boucle, icône cachée jusqu'au raccourci d'urgence.
const CHIEN = {silenceMs: 10000, rechargeMs: 5000, arretMs: 8000, maxRecuperations: 3, fenetreRecuperations: 10 * 60e3, retardTickMs: 2500,
  chargementMs: 10000, recreationMaxMs: 15000, ecouteMaxMs: 45000, maxArretsPage: 3, battementRecentMs: 5000, sortieForceeMs: 3000};
// Icône de la zone de notification (cercle sombre, anneau bleu, micro), 16 et 32 px.
const ICONE_16 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAABKElEQVR42mNgQAM2R/6z2xz572tz5P9smyP/V0HxbKgYOwM+AFX0SKtr+3/pyJr/mgFZYAxig8RAciA1uDRnGS+//V/QPOg/u5jm/5jsmv+PPv8HYxAbJAaSA6kBqcWwGSTBrWIFVgjC209chRsAYsPEQWqghvgi+/kRzGYY3nvuNtwAEBtZDqQW6h12sO0g/yErIGQACEPDxBdkwGxQIJFqAEgPSC/IgFXIzl+9+yROA2BySN5YhWHA0q2H/9v6xv3vmbsabgCIDRIDyWEzAMUL5u4R/0/eeg7WUNIyBYxBbJAYSA6bFzACEaQQFHWHrzwEYxAbWTN6IGKNRhCGuQBdHCUacSUkUMCdf/AWjJFjASMh4UrK2DDOpIwrM4E0gDBRmYnc7AwAGmDVkMgNB4QAAAAASUVORK5CYII=';
const ICONE_32 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAACoElEQVR42s1XP0hbQRh/m4vEQSKIAWlB0ApdDBXCAwUhLgqCiwXBxaFECs1WVMikFEcJglOH4tBJM0gmEckb7NIscdGldahLnRyC09f+vtyFz+e7vLskioEfuXf3/fnd3Xfffed5jj8/oKQf0LwfUN4PqKCQV31J7yl+fkAp5aj2/59iUFOyqW44TvgBFf2A6trBu6MbGt0q0auPRRp6v8lAG30YE0TqSjfRrvMpP6BrGMuc3tPIxgH1TcxRz8AYY3A0Qwsrnxho637IQBY6ighsTLk6z+lZv9kpU+/YdNMBsLy2SVd/7+n6jhhoo0/KQAe6YjVyLs55BlheaRQYz8w9cC5JYCwsDxtiNXI2y16HQjK7+sgYsL6z/8i5BsaidGBLkagbt0MFHO951Mw19r+XjQQwZtKDTRETiSgCRb3nJiOdEABETBSjzjkvfTjgukkAtsVWpCQBJA4+Pq0MdEoAgA+1CgVJgDOcPOdPRQA+dMaUuZ2zWJxyNwgAImMmPXWJcCp9LgLwpQjMe+om43weJXzy84q+Hp44E4AOdKNswpcikG8GoOns/7i8oYs/d84EoAPdmJxQiCWw+63ExmcWG5nxw+cvRgIYgwxk8Q1dGwItt0AbK51V+Xv47TTPLuwcfRiDDGQl6bgtiA3Cg+MKG9zea+SJydkl3l/tHG30YQwy6IOObRDGHkPc99Vft2wYwTWSzjaSSjr7oI0xyEBW1ggtj6FtIsLyls8vmrPGMiPoAL3kAGT0VlglItdUjMJDEpGOw0WJSyq2vow0+l+nqVL7zUDbRsd4Gblcx+EkZUo2TtexS0GinQIowwDZ13ZBYluSmZKQRtslmW1R6gqnotS2LLcNuLbKctuHSatz3vHD5EU8zV7E4/Q5nuf/AEjZ9se0gHh9AAAAAElFTkSuQmCC';

// ---------- Journal (journal/copilote-ck3/app.log, heure locale du PC) ----------
const heure = () => new Intl.DateTimeFormat('fr-FR', {dateStyle: 'short', timeStyle: 'medium'}).format(new Date());
const journal = (() => {
  const fichier = FICHIER_JOURNAL;
  try { mkdirSync(JOURNAUX, {recursive: true}); if (statSync(fichier).size > 2e6) renameSync(fichier, fichier + '.1'); } catch {}
  const ecrire = (niveau, args) => {
    const ligne = args.map(a => a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    try { appendFileSync(fichier, `${heure()} ${niveau} ${ligne}\n`); } catch {}
  };
  return {log: (...a) => ecrire('INFO', a), info: (...a) => ecrire('INFO', a), warn: (...a) => ecrire('AVERT', a), error: (...a) => ecrire('ERREUR', a)};
})();
process.on('uncaughtException', e => journal.error('Exception :', e));
process.on('unhandledRejection', e => journal.error('Promesse rejetée :', e instanceof Error ? e : String(e)));

const lireJson = (f, defaut) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return defaut; } };
function ecrireJson(f, obj) {
  if (ESSAI) return;
  try { mkdirSync(MEMOIRE, {recursive: true}); writeFileSync(f, JSON.stringify(obj, null, 2)); } catch (e) { journal.warn(`Écriture de ${path.basename(f)} impossible : ${e.message}`); }
}
const borne = (v, min, max) => Math.min(Math.max(v, min), Math.max(min, max));
const secondes = ms => (ms / 1000).toFixed(1).replace('.', ',');
const pause = ms => new Promise(r => setTimeout(r, ms));

let serveur = null, origine = '', fenetre = null, tray = null, aide = null, aidePrete = false;
// modeRaccourci : 'demarrage' tant que l'aide n'a pas dit si son crochet est posé, puis 'crochet', 'global' (secours) ou 'aucun'.
// pos : place de l'icône repliée ; posPanneau : place du panneau ouvert, choisie par Ameur en le faisant glisser (06/10 : « il vient
// au centre, je ne peux pas le bouger »). Les deux sont gardées dans position.json, indépendamment.
let pos = null, posPanneau = null, coin = 'bas-droite', agrandi = false, modeRaccourci = 'demarrage', forceJusqua = 0;
let jeuDevant = false, ecouteJusqua = 0;   // CK3 au premier plan (dernier état lu) ; micro ouvert (signalé par la page)
// reglages.langue n'existe que si la langue a été choisie dans le menu ; sinon elle est recalculée à chaque lancement.
const reglages = {voix: true, ...lireJson(FICHIER_REGLAGES, {})};
const minuteries = [];
let langue = 'fr', sourceLangue = 'défaut';

// ---------- Langue ----------
const langueValide = l => l === 'fr' || l === 'en' ? l : null;
// reinitialiser / quitter : le raccourci d'urgence est écrit dans le menu de la zone de notification ; replier, recharger,
// quitterCopilote : menu du clic droit sur l'icône.
const MENU = {
  fr: {nom: 'Copilote CK3', voixOn: 'Voix activée', voixOff: 'Voix désactivée', oublier: 'Oublier la conversation',
    replacer: 'Replacer l\'icône et le panneau', langue: 'Langue / Language', reinitialiser: 'Réinitialiser le copilote (Ctrl+Maj+Retour arrière)',
    quitter: 'Quitter (Ctrl+Maj+Retour arrière deux fois en moins de 2 s)', replier: 'Replier', recharger: 'Recharger', quitterCopilote: 'Quitter le copilote',
    // Info-bulles de la zone de notification (10/10/2026) : page abandonnée après 3 récupérations, raccourci d'urgence refusé ;
    // boîte de dialogue d'un démarrage raté.
    arrete: 'Copilote CK3 arrêté : clic droit ici, « Réinitialiser le copilote »', urgenceRefusee: 'Copilote CK3 · Ctrl+Maj+Retour arrière pris par une autre appli : en cas de blocage, clic droit ici',
    demarrageRate: 'Le Copilote CK3 n\'a pas pu démarrer', demarrageDetail: (cause, journal) => `Cause : ${cause}\n\nDétail dans le journal :\n${journal}`},
  en: {nom: 'CK3 Copilot', voixOn: 'Voice on', voixOff: 'Voice off', oublier: 'Forget the conversation',
    replacer: 'Reset the icon and panel position', langue: 'Langue / Language', reinitialiser: 'Reset the copilot (Ctrl+Shift+Backspace)',
    quitter: 'Quit (Ctrl+Shift+Backspace twice within 2 s)', replier: 'Collapse', recharger: 'Reload', quitterCopilote: 'Quit the copilot',
    arrete: 'CK3 Copilot stopped: right-click here, “Reset the copilot”', urgenceRefusee: 'CK3 Copilot · Ctrl+Shift+Backspace taken by another app: if stuck, right-click here',
    demarrageRate: 'The CK3 Copilot could not start', demarrageDetail: (cause, journal) => `Cause: ${cause}\n\nDetails in the log:\n${journal}`},
};
// Choix du menu (reglages.json), sinon COPILOTE_LANGUE (variable d'environnement ou .env), sinon la langue de Windows : fr… donne
// le français, toute autre l'anglais. En essai, COPILOTE_LANGUE passe avant le réglage enregistré (l'essai force une langue).
function langueDeDepart(envFichier = {}) {
  const variable = langueValide(String(process.env.COPILOTE_LANGUE || envFichier.COPILOTE_LANGUE || '').trim().toLowerCase());
  if (ESSAI && variable) return {langue: variable, source: 'COPILOTE_LANGUE'};
  if (langueValide(reglages.langue)) return {langue: reglages.langue, source: 'reglages.json'};
  if (variable) return {langue: variable, source: 'COPILOTE_LANGUE'};
  let locale = '';
  try { locale = app.getLocale() || app.getPreferredSystemLanguages?.()[0] || ''; } catch {}
  return {langue: locale.toLowerCase().startsWith('fr') ? 'fr' : 'en', source: `Windows (${locale || 'inconnue'})`};
}

const deNous = u => { try { return !!origine && new URL(u).origin === origine; } catch { return false; } };

// Permissions : seul le micro (audio, sans caméra), et seulement pour notre page sur 127.0.0.1. Tout le reste est refusé.
function autoriserRequete(wc, permission, rappel, details = {}) {
  const types = details.mediaTypes || [];
  const ok = permission === 'media' && deNous(details.securityOrigin || details.requestingUrl || wc?.getURL?.()) && types.length > 0 && types.every(t => t === 'audio');
  if (!ok) journal.warn(`Permission refusée : ${permission}${types.length ? ' ' + types.join('+') : ''}`);
  rappel(ok);
}
function autoriserVerification(_wc, permission, origineDemandee, details = {}) {
  return permission === 'media' && deNous(origineDemandee || details.requestingUrl || details.securityOrigin) && details.mediaType !== 'video';
}

function installerSecurite(ses) {
  ses.setPermissionRequestHandler(autoriserRequete);
  ses.setPermissionCheckHandler(autoriserVerification);
  ses.setDevicePermissionHandler(() => false);
  ses.on('will-download', e => e.preventDefault());
}

// Liens externes : https seulement, ouverts dans le navigateur par défaut (jamais pendant l'essai, qui ne doit rien afficher).
function ouvrirExterne(url) {
  let u;
  try { u = new URL(String(url)); } catch { return; }
  if (u.protocol !== 'https:' || u.username || u.password || !u.hostname || String(url).length > 2048) return journal.warn('Lien refusé (pas en https)');
  if (ESSAI) return journal.log(`(essai) lien non ouvert : ${u.hostname}`);
  shell.openExternal(u.href).catch(e => journal.warn(`Lien non ouvert : ${e.message}`));
}

// ---------- Position, taille et coin ----------
function positionParDefaut() {
  const d = screen.getPrimaryDisplay().bounds;
  return {x: d.x + d.width - BORD - PETIT, y: d.y + Math.round(d.height * .55) - PETIT / 2};
}
function positionValide(p) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  const ok = screen.getAllDisplays().some(({bounds: d}) => p.x >= d.x && p.y >= d.y && p.x + PETIT <= d.x + d.width && p.y + PETIT <= d.y + d.height);
  return ok ? {x: Math.round(p.x), y: Math.round(p.y)} : null;
}
function panneauValide(p) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  const ok = screen.getAllDisplays().some(({bounds: d}) => p.x >= d.x && p.y >= d.y && p.x + LARGE <= d.x + d.width && p.y + HAUT <= d.y + d.height);
  return ok ? {x: Math.round(p.x), y: Math.round(p.y)} : null;
}
const sauverPosition = () => ecrireJson(FICHIER_POSITION, posPanneau ? {...pos, panneau: posPanneau} : pos);
const ecranDe = p => screen.getDisplayNearestPoint({x: Math.round(p.x + PETIT / 2), y: Math.round(p.y + PETIT / 2)}).bounds;
// Le panneau s'ouvre vers le centre de l'écran : vers la gauche et le haut quand l'icône est en bas à droite (cas par défaut).
function coinPour(p) {
  const d = ecranDe(p);
  return `${p.y + PETIT / 2 > d.y + d.height / 2 ? 'bas' : 'haut'}-${p.x + PETIT / 2 > d.x + d.width / 2 ? 'droite' : 'gauche'}`;
}
function envoyer(canal, donnees) { if (fenetre && !fenetre.isDestroyed() && !fenetre.webContents.isCrashed()) fenetre.webContents.send(canal, donnees); }
const envoyerEtat = () => envoyer('etat', {coin, voix: reglages.voix, raccourci: modeRaccourci, langue});

function appliquerTaille() {
  if (!fenetre || fenetre.isDestroyed()) return;
  if (!agrandi) { coin = coinPour(pos); envoyerEtat(); fenetre.setBounds({x: pos.x, y: pos.y, width: PETIT, height: PETIT}); return; }
  if (posPanneau) { fenetre.setBounds({...posPanneau, width: LARGE, height: HAUT}); return; }   // place choisie par Ameur
  const d = ecranDe(pos);
  let x = coin.endsWith('droite') ? pos.x + PETIT - LARGE : pos.x;
  const y = coin.startsWith('bas') ? pos.y + PETIT - HAUT : pos.y;
  // Ouvert vers la gauche : le bord droit du panneau s'arrête avant les fenêtres principales du jeu (l'icône « saute » alors à
  // gauche le temps de la réponse et reprend sa place quand le panneau se replie).
  if (coin.endsWith('droite')) x = Math.min(x, d.x + d.width - FENETRES_JEU - LARGE);
  fenetre.setBounds({x: borne(x, d.x, d.x + d.width - LARGE), y: borne(y, d.y, d.y + d.height - HAUT), width: LARGE, height: HAUT});
}
// La fenêtre revient à l'icône, que la page réponde ou non (menu, récupération, page rechargée). derniereTailleMain : pendant 3 s,
// un battement parti avant que la page ait suivi ne la fait pas ré-agrandir.
let derniereTailleMain = 0;
function replierFenetre(raison) {
  derniereTailleMain = Date.now();
  if (agrandi) { agrandi = false; journal.log(`Panneau replié (${raison})`); }
  appliquerTaille();
}

let glissementMain = null;   // glissement en cours vu d'ici : {quoi, depuis}
function deplacer(dx, dy) {
  dx = borne(Math.round(Number(dx) || 0), -400, 400); dy = borne(Math.round(Number(dy) || 0), -400, 400);
  if (!glissementMain) { glissementMain = {quoi: agrandi ? 'panneau' : 'icône', depuis: Date.now()}; journal.log(`Glissement ${glissementMain.quoi === 'panneau' ? 'du panneau' : 'de l\'icône'} commencé`); }
  const b = fenetre.getBounds(), d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds;
  fenetre.setBounds({x: borne(b.x + dx, d.x, d.x + d.width - b.width), y: borne(b.y + dy, d.y, d.y + d.height - b.height), width: b.width, height: b.height});
}
function finDeplacement() {
  const b = fenetre.getBounds();
  // Panneau ouvert déplacé : on retient sa place à lui (il y revient à chaque réponse) ; l'icône repliée garde la sienne.
  if (agrandi) posPanneau = {x: b.x, y: b.y};
  else { pos = {x: b.x, y: b.y}; coin = coinPour(pos); }
  journal.log(`Glissement fini en (${b.x}, ${b.y})${glissementMain ? ` après ${secondes(Date.now() - glissementMain.depuis)} s` : ''}`);
  glissementMain = null;
  sauverPosition();
  envoyerEtat();
}

// ---------- Visibilité : seulement quand CK3 est la fenêtre active (lancé, pas réduit, pas derrière une autre appli) ----------
function montrer() {
  // pageEnPanne : page arrêtée trop souvent, la fenêtre reste cachée jusqu'au raccourci d'urgence (voir mettreEnPanne).
  if (ESSAI || pageEnPanne || !fenetre || fenetre.isDestroyed() || fenetre.isVisible()) return;
  fenetre.showInactive();
  fenetre.setAlwaysOnTop(true, 'screen-saver');
  journal.log(`Icône montrée (${jeuDevant ? 'CK3 devant' : 'affichage forcé'}${agrandi ? ', panneau ouvert' : ''})`);
}
function cacher() {
  if (!fenetre || fenetre.isDestroyed() || !fenetre.isVisible()) return;
  fenetre.hide();
  journal.log('Icône cachée (CK3 n\'est plus devant)');
}
// Affichage forcé : quelques secondes après le lancement, un appui, un clic sur la zone de notification ; et tant que le micro
// est ouvert (l'icône rouge est le seul témoin de l'écoute : elle ne disparaît jamais pendant un enregistrement).
const forceActif = () => TOUJOURS || Date.now() < forceJusqua || Date.now() < ecouteJusqua;

let verificationEnCours = false;
async function rafraichirVisibilite() {
  if (verificationEnCours) return;
  verificationEnCours = true;
  try {
    // Sans l'aide Windows, on ne sait pas si CK3 tourne : l'icône reste affichée.
    if (!aide || !aidePrete) { jeuDevant = false; ajusterSecours(); return montrer(); }
    // Pendant une capture, l'aide est occupée (l'état attendrait derrière elle) : on garde le dernier état connu.
    if (!aide.occupee) {
      try {
        const e = await Promise.race([aide.etat(), new Promise((_, ko) => setTimeout(() => ko(new Error('délai')), 2500))]);
        jeuDevant = !!e?.ck3 && !e.minimise && !!e.premierPlan;
      } catch { /* aide lente ou en train de redémarrer : dernier état connu */ }
    }
    ajusterSecours();
    // Le panneau ouvert suit la même règle : il ne reste plus au-dessus du navigateur, du bureau ou d'un CK3 fermé ; il revient
    // tel quel quand Ameur revient dans le jeu.
    if (jeuDevant || forceActif()) montrer(); else cacher();
  } finally { verificationEnCours = false; }
}

// ---------- Raccourci : crochet clavier de l'aide (appui / relâché), sinon raccourci global d'Electron (bascule seulement) ----------
// Le secours (RegisterHotKey) prend Ctrl+Maj+Espace à TOUTES les applis (espace insécable de Word...) : quand l'aide sait dire
// si CK3 est devant (aide prête mais crochet refusé), il n'est enregistré que pendant que CK3 est devant. Sans l'aide, on ne
// peut pas le savoir : il reste enregistré, et l'aide est réessayée régulièrement pour en sortir. Ctrl+Maj+Retour arrière (urgence)
// suit la même règle.
let dernierSecours = 0, secoursVoulu = false, secoursEnregistre = false, urgenceEnregistree = false, urgenceRefuseeNotee = false;
function surSecours() {
  if (Date.now() - dernierSecours < 400) return;   // Windows répète le raccourci tant que la touche est tenue
  dernierSecours = Date.now();
  forceJusqua = Date.now() + 20000; montrer();
  envoyer('raccourci', {etat: 'bascule', t: Date.now()});
}
// Urgence par RegisterHotKey : Windows répète l'événement tant que les touches sont tenues et ne dit pas quand elles sont relâchées.
// Un événement à moins de 600 ms du précédent est une répétition (la fenêtre glisse avec elles) ; un nouvel appui moins de 2 s
// après le premier quitte. Fonction pure (essayée par l'essai de la fenêtre, sans enregistrer de raccourci).
function decisionUrgence(etat, t) {
  const ecart = t - (etat.dernier ?? -Infinity);
  etat.dernier = t;
  if (ecart < 600) return null;
  if (etat.premier != null && t - etat.premier <= 2000) { etat.premier = null; return 'quitter'; }
  etat.premier = t;
  return 'reinitialiser';
}
const etatUrgenceGlobale = {};
function surUrgenceGlobale() { const a = decisionUrgence(etatUrgenceGlobale, Date.now()); if (a) surUrgence(a, 'raccourci de secours'); }
function ajusterSecours() {
  const doit = secoursVoulu && (!aidePrete || jeuDevant || TOUJOURS);
  if (doit && !secoursEnregistre) {
    try { secoursEnregistre = globalShortcut.register('Control+Shift+Space', surSecours); } catch { secoursEnregistre = false; }
    if (secoursEnregistre && !urgenceEnregistree) try { urgenceEnregistree = globalShortcut.register('Control+Shift+Backspace', surUrgenceGlobale); } catch { urgenceEnregistree = false; }
    // Urgence refusée par Windows (raccourci pris par une autre appli) : noté une fois (cette fonction tourne toutes les 3 s) et
    // dit dans l'info-bulle de la zone de notification ; sans cela, Ameur ne saurait pas que le double appui ne le sauvera pas.
    if (secoursEnregistre && !urgenceEnregistree && !urgenceRefuseeNotee) {
      urgenceRefuseeNotee = true;
      journal.warn('Raccourci d\'urgence Ctrl+Maj+Retour arrière refusé par Windows (pris par une autre appli) : en cas de blocage, menu de la zone de notification');
      majTray();
    } else if (urgenceEnregistree && urgenceRefuseeNotee) { urgenceRefuseeNotee = false; journal.log('Raccourci d\'urgence Ctrl+Maj+Retour arrière enregistré'); majTray(); }
  } else if (!doit && secoursEnregistre) {
    try { globalShortcut.unregister('Control+Shift+Space'); } catch {}
    if (urgenceEnregistree) try { globalShortcut.unregister('Control+Shift+Backspace'); } catch {}
    secoursEnregistre = urgenceEnregistree = false;
  }
  // 'aucun' seulement si Windows a refusé l'enregistrement (raccourci pris par une autre appli) au moment où il le fallait.
  const mode = !secoursVoulu ? modeRaccourci : doit && !secoursEnregistre ? 'aucun' : 'global';
  if (secoursVoulu && mode !== modeRaccourci) {
    modeRaccourci = mode;
    journal.warn(`Raccourci de secours : ${mode === 'global' ? 'Ctrl+Maj+Espace en bascule seulement' : 'indisponible (pris par une autre appli), clic sur l\'icône seulement'}`);
    envoyerEtat();
  }
}
function activerSecours(raison) {
  if (!secoursVoulu) journal.warn(`Crochet clavier indisponible (${raison}) : raccourci de secours`);
  secoursVoulu = true;
  ajusterSecours();
}

function surAidePrete(i) {
  aidePrete = true; attenteAide = 60e3;
  clearTimeout(minuteurAide);
  if (i && i.crochet === false) return activerSecours('crochet refusé par Windows');
  if (secoursVoulu) { secoursVoulu = false; ajusterSecours(); }
  if (modeRaccourci !== 'crochet') { modeRaccourci = 'crochet'; journal.log('Aide Windows prête (capture + crochet clavier)'); envoyerEtat(); }
}
// Aide en panne : nouvel essai dans 1 min, puis de plus en plus espacé (15 min au plus).
let minuteurAide = null, attenteAide = 60e3;
function reessayerAide() {
  clearTimeout(minuteurAide);
  minuteurAide = setTimeout(() => {
    journal.log('Aide Windows : nouvel essai de démarrage');
    aide.demarrer().then(surAidePrete, e => { journal.warn(`Aide Windows toujours indisponible : ${e.message}`); attenteAide = Math.min(attenteAide * 2, 15 * 60e3); reessayerAide(); });
  }, attenteAide);
}

// Quitter (raccourci d'urgence, menus) : app.quit() ferme proprement ; s'il cale (fermeture d'une fenêtre, du serveur...), sortie
// forcée 3 s plus tard. Revue du 09/10/2026 : la sécurité de l'aide Windows (arrêt forcé après 4 s) ne couvre que l'Electron figé,
// car before-quit ferme l'entrée de l'aide, qui part aussitôt.
let sortieForcee = null;
function quitter(raison) {
  journal.log(`Quitter (${raison})`);
  if (!sortieForcee) sortieForcee = setTimeout(() => { journal.warn(`Pas parti ${secondes(CHIEN.sortieForceeMs)} s après la demande : sortie forcée`); app.exit(0); }, CHIEN.sortieForceeMs);
  app.quit();
}

// Raccourci d'urgence (crochet de l'aide, ou raccourci de secours) : « reinitialiser » recrée la fenêtre et sa page (écoute et voix
// coupées, icône repliée, montrée 8 s) ; « quitter » ferme le copilote (l'aide l'arrête de force s'il n'a pas pu partir en 4 s).
function surUrgence(action, source) {
  if (action === 'quitter') { journal.warn(`Ctrl+Maj+Retour arrière deux fois (${source}) : le copilote quitte`); quitter('raccourci d\'urgence'); return; }
  if (action !== 'reinitialiser') return;
  journal.warn(`Ctrl+Maj+Retour arrière (${source}) : copilote réinitialisé`);
  forceJusqua = Date.now() + 8000;
  return recreerFenetre('Ctrl+Maj+Retour arrière');
}

function brancherAide() {
  if (!aide) return activerSecours('aide Windows absente');
  aide.on?.('raccourci', d => {
    if (d?.etat !== 'appui' && d?.etat !== 'relache') return;
    // L'aide ne signale le combo que lorsque CK3 est au premier plan : il a appuyé exprès, dans le jeu.
    if (d.etat === 'appui') { forceJusqua = Date.now() + 20000; jeuDevant = true; montrer(); }
    envoyer('raccourci', {etat: d.etat, t: d.t});
  });
  aide.on?.('secours', d => surUrgence(d?.action, 'dans le jeu'));
  aide.on?.('pret', surAidePrete);   // à chaque (re)démarrage de l'aide
  aide.on?.('erreur', m => { journal.error(`Aide Windows : ${m?.message || m}`); aidePrete = false; activerSecours('aide Windows en panne'); reessayerAide(); });
  aide.demarrer()
    .then(surAidePrete)
    .catch(e => { journal.error(`Aide Windows non démarrée : ${e.message}`); activerSecours('aide Windows non démarrée'); reessayerAide(); });
}

// ---------- Zone de notification et menu du clic droit ----------
function creerTray() {
  const image = nativeImage.createFromDataURL('data:image/png;base64,' + ICONE_16);
  image.addRepresentation({scaleFactor: 2, dataURL: 'data:image/png;base64,' + ICONE_32});
  tray = new Tray(image);
  tray.on('click', () => {
    forceJusqua = Date.now() + 15000;
    // Icône cachée après des plantages, ou page abandonnée par le chien de garde : nouvel essai (fenêtre et page neuves).
    if (pageEnPanne || abandonNote) return recreerFenetre('clic sur la zone de notification');
    montrer(); fenetre?.moveTop();
  });
  majTray();
}
const oublierConversation = () => { try { serveur?.copilote?.oublier?.(); } catch (e) { journal.warn(e); } };
// Menu dans la langue du moment ; « Langue / Language » reste bilingue pour qu'on le trouve quelle que soit la langue affichée.
function modeleMenu() {
  const t = MENU[langue];
  return [
    {label: t.nom, enabled: false},
    {type: 'separator'},
    {label: reglages.voix ? t.voixOn : t.voixOff, type: 'checkbox', checked: reglages.voix, click: () => basculerVoix()},
    {label: t.oublier, click: () => { oublierConversation(); envoyer('etat', {oublie: true}); }},
    {label: t.replacer, click: () => { pos = positionParDefaut(); posPanneau = null; coin = coinPour(pos); sauverPosition(); appliquerTaille(); envoyerEtat(); forceJusqua = Date.now() + 8000; montrer(); }},
    {label: t.reinitialiser, click: () => { forceJusqua = Date.now() + 8000; recreerFenetre('menu de la zone de notification'); }},
    {label: t.langue, submenu: [
      {label: 'Français', type: 'radio', checked: langue === 'fr', click: () => changerLangue('fr')},
      {label: 'English', type: 'radio', checked: langue === 'en', click: () => changerLangue('en')},
    ]},
    {type: 'separator'},
    {label: t.quitter, click: () => quitter('menu de la zone de notification')},
  ];
}
// Clic droit sur l'icône ou le panneau (09/10/2026) : en plein écran, la zone de notification est hors d'atteinte.
function modeleMenuIcone() {
  const t = MENU[langue];
  return [
    {label: t.replier, click: () => { replierFenetre('menu de l\'icône'); envoyer('commande', {action: 'replier'}); }},
    {label: t.recharger, click: () => recreerFenetre('menu de l\'icône')},
    {type: 'separator'},
    {label: t.quitterCopilote, click: () => quitter('menu de l\'icône')},
  ];
}
// Le menu d'Electron ne prend pas le premier plan au jeu (fenêtre de menu sans activation). Sans focus, Windows ne le ferme pas
// toujours quand on clique ailleurs : il se ferme seul après 15 s ; l'icône reste affichée pendant ce temps.
function ouvrirMenuIcone() {
  const f = fenetre;
  if (ESSAI || !f || f.isDestroyed()) return;
  const menu = Menu.buildFromTemplate(modeleMenuIcone());
  forceJusqua = Math.max(forceJusqua, Date.now() + 15000);
  const fermeture = setTimeout(() => { try { if (!f.isDestroyed()) menu.closePopup(f); } catch {} }, 15000);
  menu.once('menu-will-close', () => clearTimeout(fermeture));
  journal.log('Menu de l\'icône ouvert (clic droit)');
  try { menu.popup({window: f}); } catch (e) { clearTimeout(fermeture); journal.warn(`Menu de l'icône impossible : ${e.message}`); }
}
// Info-bulle d'après l'état (10/10/2026 : « arrêté » et « urgence refusée » étaient effacées à chaque changement de langue ou de
// voix) ; elle suit aussi la langue.
function majTray() {
  if (!tray) return;
  tray.setToolTip(abandonNote ? MENU[langue].arrete : urgenceRefuseeNotee ? MENU[langue].urgenceRefusee : MENU[langue].nom);
  tray.setContextMenu(Menu.buildFromTemplate(modeleMenu()));
}
// Langue choisie dans le menu : gardée dans reglages.json, envoyée à la page (événement 'etat'), et la conversation est oubliée :
// un historique mélangé faisait mélanger les langues au modèle.
function changerLangue(l) {
  l = langueValide(l);
  if (!l) return;
  const change = l !== langue;
  langue = l; sourceLangue = 'menu'; reglages.langue = l;
  ecrireJson(FICHIER_REGLAGES, reglages);
  if (change) { oublierConversation(); journal.log(`Langue : ${l}`); }
  if (fenetre && !fenetre.isDestroyed()) fenetre.setTitle(MENU[l].nom);
  majTray(); envoyerEtat();
}
function basculerVoix() {
  reglages.voix = !reglages.voix;
  ecrireJson(FICHIER_REGLAGES, reglages);
  majTray(); envoyerEtat();
  return reglages.voix;
}

// ---------- Fenêtre ----------
let fenetresMontrees = 0;   // pour l'essai : aucune fenêtre ne doit jamais s'afficher
function creerFenetre() {
  if (!pos) {
    const lu = lireJson(FICHIER_POSITION, null);
    pos = positionValide(lu) || positionParDefaut();
    posPanneau = panneauValide(lu?.panneau);
  }
  coin = coinPour(pos);
  const f = new BrowserWindow({
    x: pos.x, y: pos.y, width: PETIT, height: PETIT, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, minimizable: false, maximizable: false, fullscreenable: false, hasShadow: false, skipTaskbar: true,
    focusable: false, alwaysOnTop: true, title: MENU[langue].nom,
    webPreferences: {preload: path.join(DOSSIER, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false,
      backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required', spellcheck: false, webviewTag: false},
  });
  f.setAlwaysOnTop(true, 'screen-saver');
  f.on('show', () => { fenetresMontrees++; });
  // Pas de setContentProtection : Ameur veut pouvoir faire des captures d'écran où l'on voit le copilote (06/10). La capture
  // envoyée au modèle n'en souffre pas : PrintWindow ne rend que la fenêtre de CK3, jamais celles posées au-dessus.
  const wc = f.webContents;
  const actuelle = () => f === fenetre && !f.isDestroyed();   // une fenêtre remplacée ne touche plus à rien
  wc.setWindowOpenHandler(({url}) => { ouvrirExterne(url); return {action: 'deny'}; });
  wc.on('will-navigate', e => { e.preventDefault(); journal.warn('Navigation bloquée'); });
  wc.on('will-frame-navigate', e => { if (!e.isMainFrame && !/^about:(srcdoc|blank)/.test(e.url)) e.preventDefault(); });
  wc.on('will-attach-webview', e => e.preventDefault());
  // Page (re)chargée : elle repart icône repliée, la fenêtre aussi, sinon un grand cadre transparent resterait sur le jeu.
  // Seulement pour le document principal (le cadre des suggestions Google se charge aussi).
  wc.on('did-start-navigation', e => {
    if (!actuelle() || !e?.isMainFrame || e.isSameDocument) return;
    dernierBattement = Date.now(); ecouteDepuis = 0;
    if (agrandi) replierFenetre('page rechargée');
  });
  wc.on('did-finish-load', () => { if (actuelle()) envoyerEtat(); });
  // Page arrêtée : rechargée 1 s plus tard. Les arrêts voulus (chien de garde, chargement bloqué : f.arretVoulu) ne comptent pas ;
  // au-delà de 3 plantages en 10 min, plus de rechargement en boucle (revue du 09/10/2026 : environ un par seconde, une ligne
  // ERREUR à chaque fois dans app.log).
  wc.on('render-process-gone', (_e, d) => {
    if (!actuelle()) return;
    const voulu = Date.now() - (f.arretVoulu || 0) < 5000;
    f.arretVoulu = 0;
    journal.error(`Page de l'icône arrêtée : ${d.reason} (code ${d.exitCode})${voulu ? ', arrêt demandé par l\'appli' : ''}`);
    noterChien('processus-arrete');
    ecouteJusqua = 0; ecouteDepuis = 0;   // son micro est fermé avec elle
    replierFenetre('page arrêtée');
    if (!voulu) {
      const maintenant = Date.now();
      arretsPage.push(maintenant);
      while (arretsPage.length && maintenant - arretsPage[0] > CHIEN.fenetreRecuperations) arretsPage.shift();
      if (arretsPage.length > CHIEN.maxArretsPage) return mettreEnPanne(f);
    }
    setTimeout(() => { if (actuelle() && !pageEnPanne) f.reload(); }, 1000);
  });
  // Page figée vue par Chromium (une entrée de souris ou de clavier sans réponse depuis plusieurs secondes). Si elle bat encore,
  // son fil tourne : faux signal, ignoré (sinon réponse et voix perdues pour rien, et une récupération sur 3 consommée).
  f.on('unresponsive', () => {
    if (!actuelle()) return;
    compteursChien.unresponsive++;
    if (Date.now() - battementRecu < CHIEN.battementRecentMs) {
      compteursChien.unresponsiveIgnores++;
      journal.warn(`Chromium dit la page de l'icône figée, mais elle a battu il y a ${secondes(Date.now() - battementRecu)} s : ignoré`);
      return;
    }
    journal.warn(`Chromium : la page de l'icône ne répond plus (${contexte()})`);
    recupererPage('Chromium la dit figée');
  });
  f.on('responsive', () => { if (actuelle()) journal.log('Chromium : la page de l\'icône répond de nouveau'); });
  // Avertissements de la page (micro refusé...) : le détail technique va au journal, Ameur ne voit qu'une phrase claire. Les
  // erreurs non rattrapées arrivent déjà par le pont (avec leur ligne) : pas de doublon.
  wc.on('console-message', e => {
    const n = e?.level, m = String(e?.message ?? '');
    if ((n === 'warning' || n === 'error') && !/^Uncaught/.test(m)) journal.warn(`Page : ${m.slice(0, 300)}`);
  });
  return f;
}
// urlEssai : seulement pendant l'essai de la fenêtre (page qui fige pendant son chargement).
let urlEssai = null;
const urlPage = () => (ESSAI && urlEssai) || `${origine}/index.html?langue=${langue}`;

// Arrêt du processus de la page demandé par l'appli : render-process-gone ne le compte pas comme un plantage.
function arreterProcessusPage(f, pourquoi) {
  try { f.arretVoulu = Date.now(); f.webContents.forcefullyCrashRenderer(); } catch (e) { f.arretVoulu = 0; journal.warn(`Arrêt du processus de la page impossible (${pourquoi}) : ${e.message}`); }
}

// Chargement borné (revue du 09/10/2026) : loadURL n'aboutit jamais tant qu'un script de la page boucle pendant le chargement
// (vérifié : toujours en attente après 12 s ; ERR_FAILED seulement une fois son processus arrêté). Après 10 s, le processus de la
// page est arrêté (render-process-gone la recharge) et l'appli continue : démarrage, zone de notification, raccourci d'urgence et
// récupérations ne restent jamais suspendus à une page qui ne finit pas de charger. Rend 'chargee', 'erreur' ou 'delai'.
async function chargerPage(f, url, raison) {
  let fini = false;
  const issue = await Promise.race([
    f.loadURL(url).then(() => 'chargee', e => { if (!fini) journal.warn(`Page de l'icône non chargée (${raison}) : ${e.message}`); return 'erreur'; }),
    pause(CHIEN.chargementMs).then(() => 'delai')]);
  fini = true;
  if (issue === 'delai' && !f.isDestroyed()) {
    journal.error(`Page de l'icône toujours pas chargée après ${secondes(CHIEN.chargementMs)} s (${raison}) : son processus est arrêté, elle sera rechargée`);
    noterChien('chargement-bloque');
    arreterProcessusPage(f, 'chargement bloqué');
  }
  return issue;
}

// Fenêtre recréée (raccourci d'urgence, menus, dernière étape d'une récupération, deuxième lancement) : une fenêtre et une page
// neuves règlent aussi ce qu'un simple rechargement ne touche pas (état de la fenêtre Windows, capture de la souris, composition).
// La neuve est créée avant de détruire l'ancienne : sans fenêtre, Electron quitterait l'appli. Un deuxième appel pendant une
// recréation la rejoint, sauf si elle dure depuis plus de 15 s (elle ne doit plus jamais bloquer les suivantes).
let recreation = null, recreationDepuis = 0;
const recreationEnCours = () => !!recreation && Date.now() - recreationDepuis < CHIEN.recreationMaxMs;
function recreerFenetre(raison) {
  if (recreationEnCours()) return recreation;
  if (recreation) journal.warn(`Recréation précédente toujours pas finie après ${secondes(Date.now() - recreationDepuis)} s : nouvelle recréation`);
  recreationDepuis = Date.now();
  const p = (async () => {
    journal.warn(`Fenêtre de l'icône recréée (${raison})`);
    noterChien('recreation');
    if (recuperation) { clearTimeout(recuperation.minuteur); recuperation = null; }
    if (pageEnPanne) { pageEnPanne = false; clearTimeout(minuteurPanne); journal.log('Page de l\'icône : nouvel essai après ses plantages'); }
    if (abandonNote) { abandonNote = false; majTray(); journal.log('Page de l\'icône : nouvel essai après l\'abandon du chien de garde'); }
    const ancienne = fenetre;
    agrandi = false; ecouteJusqua = 0; ecouteDepuis = 0; glissementMain = null;
    const f = fenetre = creerFenetre();
    dernierBattement = Date.now();
    try { ancienne?.destroy(); } catch (e) { journal.warn(`Ancienne fenêtre non détruite : ${e.message}`); }
    await chargerPage(f, urlPage(), raison);
    if (f !== fenetre || f.isDestroyed()) return;   // déjà remplacée par une recréation plus récente
    dernierBattement = Date.now();   // la page (ou son rechargement après un chargement bloqué) a 10 s pour battre
    if (jeuDevant || forceActif()) montrer();
    if (f.isVisible()) f.moveTop();
  })().finally(() => { if (recreation === p) recreation = null; });
  recreation = p;
  return p;
}

// Page arrêtée plus de 3 fois en 10 min (revue du 09/10/2026) : on ne la recharge plus en boucle. Fenêtre repliée et cachée (elle
// ne serait qu'un cadre mort au-dessus du jeu), noté une fois ; Ctrl+Maj+Retour arrière dans le jeu, « Réinitialiser » ou un clic
// dans la zone de notification, ou un deuxième lancement la recréent ; sinon nouvel essai seul dans 10 min.
let pageEnPanne = false, minuteurPanne = null;
const arretsPage = [];
function mettreEnPanne(f) {
  pageEnPanne = true;
  journal.error(`Page de l'icône arrêtée ${arretsPage.length} fois en 10 min : plus de rechargement, icône cachée (Ctrl+Maj+Retour arrière dans le jeu la relance ; sinon nouvel essai dans 10 min)`);
  noterChien('en-panne');
  try { f.hide(); } catch {}
  clearTimeout(minuteurPanne);
  minuteurPanne = setTimeout(() => { if (pageEnPanne) recreerFenetre('nouvel essai, 10 min après les plantages de la page'); }, CHIEN.fenetreRecuperations);
}

// ---------- Chien de garde de la page (09/10/2026) ----------
// Battement de la page toutes les 3 s ({agrandi, etat, garde, glisse}). Sans battement depuis 10 s pendant que la fenêtre est
// visible (cachée, Chromium peut espacer les minuteries de la page : le compte repart à zéro, et une page figée pendant qu'elle
// était cachée est rattrapée 10 s après son retour) : repli + rechargement, puis arrêt de son processus, puis fenêtre recréée.
// L'essai, dont la fenêtre n'est jamais montrée, surveille quand même. Le tic du chien mesure aussi son propre retard :
// processus principal bloqué (ou PC en veille), on le note et on repart de zéro au lieu d'accuser la page (ses battements
// attendaient dans la file).
// battementRecu : dernier VRAI battement (dernierBattement est aussi remis à l'heure par les rechargements et les retards).
// ecouteDepuis : depuis quand les battements disent « ecoute » sans interruption.
let dernierBattement = Date.now(), battementRecu = 0, infoBattement = null, recuperation = null, dernierTic = Date.now(), abandonNote = false, ecouteDepuis = 0;
const recuperations = [], historiqueChien = [], evenementsPage = [];
const compteursChien = {unresponsive: 0, unresponsiveIgnores: 0, retards: 0, ecoutesBloquees: 0};
const noterChien = etape => { historiqueChien.push({etape, t: Date.now()}); if (historiqueChien.length > 50) historiqueChien.shift(); };
function contexte() {
  const b = fenetre && !fenetre.isDestroyed() ? fenetre.getBounds() : null;
  const dernier = evenementsPage.at(-1);
  return `fenêtre ${b ? `${b.width}x${b.height} ${fenetre.isVisible() ? 'visible' : 'cachée'}` : 'absente'}, panneau ${agrandi ? 'ouvert' : 'replié'}, `
    + `CK3 ${jeuDevant ? 'devant' : 'pas devant'}${Date.now() < ecouteJusqua ? ', écoute en cours' : ''}, dernier battement il y a ${secondes(Date.now() - dernierBattement)} s`
    + `${infoBattement ? ` (état ${infoBattement.etat}${infoBattement.glisse ? ', glissement' : ''})` : ''}${dernier ? `, dernier événement : ${dernier.texte} il y a ${secondes(Date.now() - dernier.t)} s` : ''}`;
}
function surBattement(d = {}) {
  const maintenant = Date.now();
  dernierBattement = battementRecu = maintenant;
  infoBattement = {etat: String(d.etat || '?').slice(0, 20), agrandi: !!d.agrandi, garde: !!d.garde, glisse: !!d.glisse};
  // Récupération d'une écoute bloquée : la page n'est de nouveau réactive que lorsqu'elle n'est plus en écoute (un battement de
  // l'ancienne page, parti avant le rechargement, ne compte pas).
  if (recuperation && !(recuperation.ecoute && infoBattement.etat === 'ecoute')) finRecuperation();
  // Page vivante mais restée « en écoute » (revue du 09/10/2026 : micro qui ne démarre jamais, l'icône rouge ne réagissait plus).
  // La page s'arrête d'elle-même à 30 s ; au-delà de 45 s, elle est récupérée comme une page figée.
  if (infoBattement.etat !== 'ecoute') ecouteDepuis = 0;
  else if (!ecouteDepuis) ecouteDepuis = maintenant;
  else if (maintenant - ecouteDepuis > CHIEN.ecouteMaxMs && !recuperation) {
    const duree = maintenant - ecouteDepuis;
    ecouteDepuis = 0;
    compteursChien.ecoutesBloquees++;
    recupererPage(`en écoute depuis ${secondes(duree)} s, alors qu'elle s'arrête d'elle-même à 30 s`, {ecoute: true});
    return;
  }
  // Fenêtre grande alors que la page n'affiche pas le panneau (message perdu, page rechargée) : le grand cadre transparent
  // mangerait les clics du jeu. L'inverse (panneau affiché dans une fenêtre repliée) se corrige aussi, sauf juste après un repli
  // demandé d'ici.
  if (agrandi && !d.agrandi) { journal.warn('Fenêtre restée grande sans panneau affiché : repliée'); replierFenetre('battement'); }
  else if (!agrandi && d.agrandi && maintenant - derniereTailleMain > 3000) { journal.warn('Panneau affiché dans une fenêtre repliée : agrandie'); agrandi = true; appliquerTaille(); }
}
function recupererPage(raison, {ecoute = false} = {}) {
  const f = fenetre;
  if (recuperation || recreationEnCours() || pageEnPanne || !f || f.isDestroyed()) return;
  const maintenant = Date.now();
  while (recuperations.length && maintenant - recuperations[0] > CHIEN.fenetreRecuperations) recuperations.shift();
  if (recuperations.length >= CHIEN.maxRecuperations) {
    // Page qui ne bat plus du tout (script cassé...) : on ne tourne pas en boucle ; la fenêtre reste repliée. Dit aussi dans
    // l'info-bulle de la zone de notification (10/10/2026 : une icône morte et muette), effacée à la recréation suivante.
    if (!abandonNote) {
      journal.error(`Page toujours sans battement après ${CHIEN.maxRecuperations} récupérations en 10 min : abandon (fenêtre repliée ; « ${MENU[langue].arrete} »)`);
      abandonNote = true;
      try { majTray(); } catch {}
    }
    replierFenetre('récupération abandonnée');
    dernierBattement = maintenant;
    return;
  }
  recuperations.push(maintenant);
  if (abandonNote) { abandonNote = false; majTray(); }   // l'info-bulle « arrêté » ne doit pas survivre à une nouvelle récupération
  recuperation = {raison, debut: maintenant, etape: 'rechargement', minuteur: null, ecoute};
  // Une étape qui lève (fenêtre détruite entre-temps, getBounds sur une fenêtre partie…) ne doit pas laisser la récupération
  // « en cours » sans minuteur : le chien ne regarderait plus jamais la page.
  try {
    noterChien('detecte');
    journal.warn(`Page de l'icône sans réponse (${raison}) : ${contexte()} ; icône repliée, page rechargée`);
    ecouteJusqua = 0; ecouteDepuis = 0;
    replierFenetre('page sans réponse');
    noterChien('rechargement');
    try { f.webContents.reloadIgnoringCache(); } catch (e) { journal.warn(`Rechargement impossible : ${e.message}`); }
    recuperation.minuteur = setTimeout(() => etapeSuivante(f), CHIEN.rechargeMs);
  } catch (e) {
    journal.error(`Récupération interrompue par une erreur : ${e.message}`);
    clearTimeout(recuperation?.minuteur); recuperation = null; dernierBattement = maintenant;
  }
}
function etapeSuivante(f) {
  if (!recuperation || f !== fenetre || f.isDestroyed()) return;
  if (recuperation.etape === 'rechargement') {
    recuperation.etape = 'arret';
    journal.warn(`Page toujours sans réponse ${secondes(CHIEN.rechargeMs)} s après le rechargement : son processus est arrêté de force`);
    noterChien('arret-processus');
    arreterProcessusPage(f, 'page sans réponse');
    recuperation.minuteur = setTimeout(() => etapeSuivante(f), CHIEN.arretMs);   // render-process-gone recharge la page
    return;
  }
  journal.error('Page toujours sans réponse après l\'arrêt de son processus : fenêtre recréée');
  recuperation = null;
  recreerFenetre('page sans réponse');
}
function finRecuperation() {
  clearTimeout(recuperation.minuteur);
  journal.log(`Page de l'icône de nouveau réactive, ${secondes(Date.now() - recuperation.debut)} s après le début de la récupération (étape : ${recuperation.etape})`);
  noterChien('reactive');
  recuperation = null;
}
function ticChien() {
  const maintenant = Date.now(), retard = maintenant - dernierTic - 1000;
  dernierTic = maintenant;
  if (retard > CHIEN.retardTickMs) {
    compteursChien.retards++;
    journal.warn(`Processus principal figé ${secondes(retard)} s (ou PC en veille) : ${contexte()}`);
    dernierBattement = maintenant;   // les battements de la page attendaient derrière : elle n'y est pour rien
    return;
  }
  if (!fenetre || fenetre.isDestroyed() || recuperation || recreationEnCours() || pageEnPanne) return;
  if (!ESSAI && !fenetre.isVisible()) { dernierBattement = Math.max(dernierBattement, maintenant - 1000); return; }
  if (maintenant - dernierBattement > CHIEN.silenceMs) recupererPage(`aucun battement depuis ${secondes(maintenant - dernierBattement)} s`);
}

// Événements de la page pour le journal : liste fermée, détails courts, jamais de texte de question ou de réponse.
const ISSUES = ['fin', 'erreur', 'delai', 'annulee', 'coupee', 'voix-interrompue', 'inconnue'];
const RAISONS = ['capture-perdue', 'annule', 'sans-bouton', 'blur', 'cachee', 'nouvel-appui', 'menu', 'replier'];
function surEvenementPage(nom, d) {
  d = d && typeof d === 'object' ? d : {};
  let texte = null;
  if (nom === 'question' && d.etape === 'envoyee') texte = `Question envoyée (${d.voix ? 'voix' : 'texte'})`;
  else if (nom === 'question' && d.etape === 'finie') texte = `Question finie : ${ISSUES.includes(d.issue) ? d.issue : '?'}${Number.isFinite(d.ms) ? ` en ${secondes(d.ms)} s` : ''}`;
  else if (nom === 'glisser-interrompu') texte = `Glissement interrompu (${RAISONS.includes(d.raison) ? d.raison : '?'})`;
  else if (nom === 'erreur') texte = `Erreur de la page : « ${String(d.message || '').replace(/\s+/g, ' ').slice(0, 200)} » (${String(d.source || '?').replace(/[^\w.:-]/g, '').slice(0, 60)})`;
  if (!texte) return;
  evenementsPage.push({nom, texte, t: Date.now()});
  if (evenementsPage.length > 30) evenementsPage.shift();
  (nom === 'erreur' || nom === 'glisser-interrompu' ? journal.warn : journal.log)(texte);
}

function brancherIpc() {
  const valide = e => !!fenetre && !fenetre.isDestroyed() && e.sender === fenetre.webContents && deNous(e.senderFrame?.url);
  ipcMain.on('agrandir', (e, oui) => {
    if (!valide(e)) return;
    if (agrandi !== !!oui) journal.log(`Panneau ${oui ? 'ouvert' : 'replié'}`);
    agrandi = !!oui; appliquerTaille();
    if (agrandi && (jeuDevant || forceActif())) montrer();
  });
  // Micro ouvert ou fermé (30 s d'enregistrement au plus côté page, d'où la marge de 35 s si la page ne prévient pas).
  ipcMain.on('ecoute', (e, oui) => {
    if (!valide(e)) return;
    if (oui && Date.now() >= ecouteJusqua) journal.log('Question : écoute ouverte');
    ecouteJusqua = oui ? Date.now() + 35000 : 0; if (oui) montrer();
  });
  ipcMain.on('deplacer', (e, dx, dy) => { if (valide(e)) deplacer(dx, dy); });
  ipcMain.on('fin-deplacement', e => { if (valide(e)) finDeplacement(); });
  ipcMain.on('ouvrir-lien', (e, url) => { if (valide(e)) ouvrirExterne(url); });
  ipcMain.on('battement', (e, d) => { if (valide(e)) surBattement(d); });
  ipcMain.on('evenement', (e, nom, d) => { if (valide(e)) surEvenementPage(String(nom), d); });
  ipcMain.on('menu', e => { if (valide(e)) ouvrirMenuIcone(); });
  ipcMain.handle('voix', e => valide(e) ? reglages.voix : false);
  ipcMain.handle('basculer-voix', e => valide(e) ? basculerVoix() : reglages.voix);
}

// Diagnostic : autres processus d'Electron arrêtés (carte graphique, son, réseau), écrans qui changent (CK3 en plein écran change
// parfois de mode d'affichage), mode de composition (une fois la première page affichée : avant, la carte graphique n'est pas lue).
function brancherDiagnostic() {
  app.on('child-process-gone', (_e, d) => journal.error(`Processus ${d.type}${d.serviceName ? ` (${d.serviceName})` : ''} arrêté : ${d.reason} (code ${d.exitCode})`));
  const decrire = d => `${d.bounds.width}x${d.bounds.height} à l'échelle ${d.scaleFactor}`;
  screen.on('display-metrics-changed', (_e, d, changes) => journal.log(`Écran modifié (${(changes || []).join(', ')}) : ${decrire(d)}`));
  screen.on('display-added', (_e, d) => journal.log(`Écran ajouté : ${decrire(d)}`));
  screen.on('display-removed', (_e, d) => journal.log(`Écran retiré : ${decrire(d)}`));
}
function noterCarteGraphique() {
  try { const g = app.getGPUFeatureStatus(); journal.log(`Carte graphique : composition ${g.gpu_compositing}, rendu ${g.rasterization}`); } catch {}
}

// ---------- Essai sans affichage : la page se charge dans une fenêtre jamais montrée, puis on vérifie les protections ----------
async function attendreQue(condition, ms, pas = 100) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (condition()) return true; await pause(pas); }
  return !!condition();
}
const attendreBattement = (ms = 6000) => { const depuis = Date.now(); return attendreQue(() => battementRecu > depuis, ms); };
const executer = (code, ms = 5000) => Promise.race([fenetre.webContents.executeJavaScript(code, true), pause(ms).then(() => 'sans réponse')]).catch(e => `erreur : ${e.message}`);

// Robustesse (09/10/2026), toujours sans rien afficher ni toucher au clavier ou à la souris du système : les événements de pointeur
// sont fabriqués DANS la page.
async function essaisRobustesse() {
  const r = {};
  // 1. Fenêtre restée grande (message « agrandir » perdu) alors que la page n'affiche pas le panneau : le battement la replie.
  await fenetre.loadURL(urlPage());
  const battementVu = await attendreBattement();
  agrandi = true; derniereTailleMain = 0; appliquerTaille();
  const grande = fenetre.getBounds().width === LARGE;
  let t = Date.now();
  const repliee = await attendreQue(() => !agrandi && fenetre.getBounds().width === PETIT, 5000);
  r.grandeSansPanneau = {battementVu, grande, repliee, ms: Date.now() - t, ok: battementVu && grande && repliee};

  // 2. Page rechargée pendant que la fenêtre est grande : elle repart repliée.
  agrandi = true; appliquerTaille();
  await new Promise(ok => { fenetre.webContents.once('did-finish-load', ok); fenetre.webContents.reload(); });
  r.rechargementReplie = {ok: !agrandi && fenetre.getBounds().width === PETIT};

  // 3. Glissement accroché : capture perdue sans relâchement, relâchement hors de la fenêtre, puis petit geste = clic.
  const d = screen.getPrimaryDisplay().bounds;
  pos = {x: d.x + Math.round(d.width / 2), y: d.y + Math.round(d.height / 2)}; agrandi = false; appliquerTaille();
  await fenetre.loadURL(`${origine}/index.html?demo=1&langue=${langue}`);
  await attendreBattement();
  const b0 = fenetre.getBounds(), nEvenements = evenementsPage.length;
  const page = await executer(`(async () => {
    const m = document.querySelector('#micro'), pause = ms => new Promise(r => setTimeout(r, ms));
    const ev = (type, x, y, buttons) => m.dispatchEvent(new PointerEvent(type, {bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', isPrimary: true,
      button: type === 'pointerdown' || type === 'pointerup' ? 0 : -1, buttons, screenX: x, screenY: y}));
    const etapes = [];
    ev('pointerdown', 500, 500, 1); ev('pointermove', 530, 520, 1); await pause(150);
    m.dispatchEvent(new PointerEvent('lostpointercapture', {bubbles: true, pointerId: 7})); await pause(150);
    ev('pointermove', 600, 600, 0); ev('pointermove', 650, 640, 1); await pause(150);
    etapes.push(document.body.dataset.etat);
    ev('pointerdown', 500, 500, 1); ev('pointermove', 490, 480, 1); await pause(150);
    ev('pointermove', 480, 470, 0); ev('pointermove', 400, 400, 1); await pause(150);
    etapes.push(document.body.dataset.etat);
    ev('pointerdown', 500, 500, 1); ev('pointermove', 503, 502, 1); ev('pointerup', 503, 502, 0); await pause(100);
    etapes.push(document.body.dataset.etat);
    document.querySelector('#b-fermer').click(); await pause(100);
    etapes.push(document.body.dataset.etat);
    return etapes;
  })()`);
  const b1 = fenetre.getBounds(), interruptions = evenementsPage.slice(nEvenements).filter(e => e.nom === 'glisser-interrompu').map(e => e.texte);
  r.glissement = {deplacement: {dx: b1.x - b0.x, dy: b1.y - b0.y}, etats: page, interruptions, positionRetenue: pos.x === b1.x && pos.y === b1.y,
    ok: b1.x - b0.x === 20 && b1.y - b0.y === 0 && Array.isArray(page) && page.join() === 'repos,repos,ecoute,repos' && pos.x === b1.x && pos.y === b1.y
      && interruptions.some(x => /capture-perdue/.test(x)) && interruptions.some(x => /sans-bouton/.test(x))};

  // 4. Erreurs de la page : non rattrapée et promesse rejetée arrivent au journal, avec leur source.
  const nErreurs = evenementsPage.length;
  await executer(`setTimeout(() => { throw new Error('essai : erreur de page'); }); Promise.reject(new Error('essai : promesse rejetée')); 1`);
  await attendreQue(() => evenementsPage.slice(nErreurs).filter(e => e.nom === 'erreur').length >= 2, 3000);
  const erreurs = evenementsPage.slice(nErreurs).filter(e => e.nom === 'erreur').map(e => e.texte);
  r.erreursPage = {erreurs, ok: erreurs.some(x => /essai : erreur de page/.test(x)) && erreurs.some(x => /essai : promesse rejetée/.test(x))};

  // 5. Menus : libellés dans la langue, raccourci d'urgence écrit dans celui de la zone de notification ; « Replier » ramène la
  // fenêtre à l'icône et la page garde sa réponse.
  const libelles = modeleMenuIcone().filter(i => i.label).map(i => i.label), plateau = modeleMenu().filter(i => i.label).map(i => i.label);
  const raccourciEcrit = langue === 'fr' ? 'Ctrl+Maj+Retour arrière' : 'Ctrl+Shift+Backspace';
  await fenetre.loadURL(`${origine}/index.html?demo=1&etat=reponse&langue=${langue}`);
  await attendreQue(() => agrandi, 3000);
  const ouvert = fenetre.getBounds().width === LARGE;
  modeleMenuIcone()[0].click();
  await pause(300);
  const pageRepliee = await executer(`!document.body.classList.contains('agrandi') && document.body.classList.contains('garde')`);
  r.menus = {icone: libelles, zoneNotification: plateau.filter(l => l.includes(raccourciEcrit)),
    replier: {ouvert, fenetrePetite: fenetre.getBounds().width === PETIT, pageRepliee},
    ok: JSON.stringify(libelles) === JSON.stringify([MENU[langue].replier, MENU[langue].recharger, MENU[langue].quitterCopilote])
      && plateau.filter(l => l.includes(raccourciEcrit)).length === 2 && ouvert && fenetre.getBounds().width === PETIT && pageRepliee === true};

  // 6. Page figée (boucle sans fin) pendant que le panneau est ouvert : le chien de garde la récupère seul. Question de
  // démonstration (Entrée sur l'icône) pour ouvrir le panneau : la page rechargée repart au repos.
  await fenetre.loadURL(`${origine}/index.html?demo=1&langue=${langue}`);
  await executer(`document.querySelector('#micro').dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})); 1`);
  const panneauOuvert = await attendreQue(() => agrandi && fenetre.getBounds().width === LARGE, 6000);
  await attendreBattement();
  const depart = historiqueChien.length, avantUnresponsive = compteursChien.unresponsive;
  t = Date.now();
  fenetre.webContents.executeJavaScript('for (;;) {}').catch(() => {});
  const recuperee = await attendreQue(() => historiqueChien.slice(depart).some(h => h.etape === 'reactive' || h.etape === 'recreation'), 45000, 200);
  await attendreBattement(6000);
  const etapes = historiqueChien.slice(depart).map(h => `${h.etape} ${secondes(h.t - t)} s`);
  const vivante = await executer(`document.body.dataset.etat`, 3000);
  r.pageFigee = {panneauOuvert, recuperee, etapes, pageVivante: vivante, fenetre: fenetre.getBounds(), unresponsiveRecu: compteursChien.unresponsive > avantUnresponsive,
    ok: panneauOuvert && recuperee && vivante === 'repos' && fenetre.getBounds().width === PETIT && !agrandi};

  // 7. Raccourci d'urgence « reinitialiser » (comme l'aide l'envoie) puis « Recharger » du menu : fenêtre et page neuves, jamais
  // montrées, toujours sans focus.
  const recreations = [];
  for (const [nom, faire] of [['urgence', () => surUrgence('reinitialiser', 'essai')], ['menu', () => modeleMenuIcone()[1].click()]]) {
    const ancienne = fenetre;
    await faire();
    await recreation;
    const neuve = fenetre !== ancienne && ancienne.isDestroyed();
    const bat = await attendreBattement();
    recreations.push({nom, neuve, battement: bat, etat: await executer('document.body.dataset.etat'), cachee: !fenetre.isVisible(), focusable: fenetre.isFocusable(), petite: fenetre.getBounds().width === PETIT});
  }
  r.recreation = {essais: recreations, ok: recreations.every(x => x.neuve && x.battement && x.etat === 'repos' && x.cachee && !x.focusable && x.petite)};

  // 8. Raccourci de secours sans crochet : répétitions ignorées, second appui à moins de 2 s = quitter (décision seule).
  const e = {}, suite = [[10000, 'reinitialiser'], [10033, null], [10500, null], [11000, null], [11800, 'quitter'], [12500, 'reinitialiser'], [15500, 'reinitialiser']];
  const obtenu = suite.map(([tt]) => decisionUrgence(e, tt));
  r.urgenceSecours = {obtenu, ok: obtenu.every((a, i) => a === suite[i][1])};

  // Revue du 09/10/2026 (9 à 13).
  // 9. Micro qui ne répond jamais (pilote du casque, micro pris par une autre appli) : getUserMedia remplacé DANS la page cachée
  // (vraie page, pas la démo) par une promesse sans fin. Après 8 s, « Le micro ne répond pas » au lieu d'une icône rouge figée ;
  // l'icône réagit de nouveau ; un clic pendant un démarrage sans réponse finit l'écoute en 1 s (avant : bloquée pour toujours).
  await fenetre.loadURL(urlPage());
  await attendreBattement();
  const micro = await executer(`(async () => {
    const b = document.body, m = document.querySelector('#micro'), T = self.TEXTES_COPILOTE[document.documentElement.lang];
    const pause = ms => new Promise(r => setTimeout(r, ms)), entree = () => m.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
    navigator.mediaDevices.getUserMedia = () => new Promise(() => {});
    const r = {};
    const t0 = performance.now();
    entree(); await pause(300);
    r.ecoute = b.dataset.etat;
    while (b.dataset.etat === 'ecoute' && performance.now() - t0 < 12000) await pause(100);
    r.msMessage = Math.round(performance.now() - t0);
    r.apres = b.dataset.etat;
    r.message = document.querySelector('#erreur').textContent === T.microMuet;
    entree(); await pause(200);
    r.relance = b.dataset.etat;
    const t1 = performance.now();
    entree();
    while (b.dataset.etat === 'ecoute' && performance.now() - t1 < 5000) await pause(50);
    r.msArret = Math.round(performance.now() - t1);
    r.final = b.dataset.etat;
    r.rienEntendu = document.querySelector('#erreur').textContent === T.rienEntendu;
    return r;
  })()`, 20000);
  r.microSansReponse = {...(typeof micro === 'object' ? micro : {erreur: micro}),
    ok: micro?.ecoute === 'ecoute' && micro.apres === 'reponse' && micro.message && micro.msMessage >= 7500 && micro.msMessage < 10000
      && micro.relance === 'ecoute' && micro.final === 'reponse' && micro.rienEntendu && micro.msArret < 2000};

  // 10. Page vivante restée « en écoute » plus de 45 s (micro figé d'une autre façon) : Electron la récupère. Battements fabriqués
  // ici (la vraie page ne peut plus rester bloquée ainsi) ; un battement « ecoute » de l'ancienne page ne clôt pas la récupération,
  // le premier de la page rechargée (au repos) la clôt.
  await fenetre.loadURL(`${origine}/index.html?demo=1&langue=${langue}`);
  await attendreBattement();
  const departEcoute = historiqueChien.length, ecoutesAvant = compteursChien.ecoutesBloquees;
  surBattement({etat: 'ecoute'});
  const ecouteNotee = ecouteDepuis > 0;
  ecouteDepuis = Date.now() - CHIEN.ecouteMaxMs - 1000;   // comme si elle était en écoute depuis 46 s
  surBattement({etat: 'ecoute'});
  const detectee = compteursChien.ecoutesBloquees === ecoutesAvant + 1 && !!recuperation;
  surBattement({etat: 'ecoute'});
  const pasCloseTropTot = !!recuperation;
  const close = await attendreQue(() => historiqueChien.slice(departEcoute).some(h => h.etape === 'reactive'), 6000);
  r.ecouteBloquee = {ecouteNotee, detectee, pasCloseTropTot, close, etapes: historiqueChien.slice(departEcoute).map(h => h.etape),
    ok: ecouteNotee && detectee && pasCloseTropTot && close};

  // 11. « unresponsive » de Chromium alors que la page bat : faux signal ignoré, aucune récupération.
  await attendreBattement();
  const departU = historiqueChien.length, ignoresAvant = compteursChien.unresponsiveIgnores;
  fenetre.emit('unresponsive');
  await pause(300);
  r.fauxUnresponsive = {ignore: compteursChien.unresponsiveIgnores === ignoresAvant + 1, recuperations: historiqueChien.slice(departU).filter(h => h.etape === 'detecte').length};
  r.fauxUnresponsive.ok = r.fauxUnresponsive.ignore && r.fauxUnresponsive.recuperations === 0;

  // 12. Page qui fige PENDANT son chargement (avant : loadURL sans fin, plus aucune récupération possible) : la recréation rend la
  // main après 10 s (processus de la page arrêté, sans compter comme un plantage) ; un appel pendant ce temps la rejoint ; la
  // recréation suivante (vraie page) marche.
  const departC = historiqueChien.length, arretsAvant = arretsPage.length;
  urlEssai = 'data:text/html,<script>for(;;){}</script>';
  t = Date.now();
  const enCours = recreerFenetre('essai : page figée pendant son chargement');
  await pause(1500);
  const rejointe = recreerFenetre('essai : appel pendant la recréation') === enCours;
  await enCours;
  const msRecreation = Date.now() - t, libre = !recreationEnCours();
  urlEssai = null;
  await recreerFenetre('essai : après le chargement bloqué');
  const battementApres = await attendreBattement();
  await pause(1500);   // l'arrêt voulu de l'ancienne page est passé : il ne doit pas compter comme un plantage
  r.chargementBloque = {msRecreation, rejointe, libre, battementApres, etat: await executer('document.body.dataset.etat'), plantagesComptes: arretsPage.length - arretsAvant,
    etapes: historiqueChien.slice(departC).map(h => h.etape)};
  r.chargementBloque.ok = rejointe && libre && msRecreation >= CHIEN.chargementMs - 500 && msRecreation < CHIEN.chargementMs + 3000 && battementApres
    && r.chargementBloque.etat === 'repos' && r.chargementBloque.plantagesComptes === 0 && r.chargementBloque.etapes.includes('chargement-bloque');

  // 13. Page qui plante sans cesse (avant : rechargée environ une fois par seconde, sans fin) : rechargée après chacun des 3
  // premiers plantages ; au 4e en 10 min, plus de rechargement, fenêtre cachée, noté une seule fois ; le raccourci d'urgence
  // (recréation) la relance.
  arretsPage.length = 0;
  const departP = historiqueChien.length, recharges = [];
  for (let i = 0; i <= CHIEN.maxArretsPage; i++) {
    const depuis = Date.now();
    try { fenetre.webContents.forcefullyCrashRenderer(); } catch {}
    recharges.push(await attendreQue(() => battementRecu > depuis, i < CHIEN.maxArretsPage ? 6000 : 3000));
  }
  const enPanne = pageEnPanne, notes = historiqueChien.slice(departP).filter(h => h.etape === 'en-panne').length;
  await surUrgence('reinitialiser', 'essai après les plantages');
  const relancee = await attendreBattement();
  r.plantagesEnBoucle = {recharges, enPanne, notes, relancee, enPanneApres: pageEnPanne,
    ok: recharges.slice(0, -1).every(Boolean) && recharges.at(-1) === false && enPanne && notes === 1 && relancee && !pageEnPanne};
  arretsPage.length = 0;

  // 14. Processus principal bloqué 11 s (comme le 09/10 ?) : noté au journal, et la page n'est pas accusée à tort au réveil.
  const retards = compteursChien.retards, recupAvant = historiqueChien.length;
  const finBlocage = Date.now() + 11000;
  while (Date.now() < finBlocage) { /* blocage volontaire du processus principal */ }
  await pause(2500);
  r.principalBloque = {retardNote: compteursChien.retards > retards, faussesRecuperations: historiqueChien.slice(recupAvant).filter(h => h.etape === 'detecte').length};
  r.principalBloque.ok = r.principalBloque.retardNote && r.principalBloque.faussesRecuperations === 0;

  r.fenetresMontrees = fenetresMontrees;
  r.ok = Object.values(r).every(v => typeof v !== 'object' || v.ok !== false) && fenetresMontrees === 0;
  return r;
}

async function essaiFenetre() {
  const resultat = {essai: 'fenetre', ok: false};
  const garde = setTimeout(() => { process.stdout.write(JSON.stringify({...resultat, erreur: 'délai dépassé (240 s)'}) + '\n'); app.exit(2); }, 240000);
  try {
    // Vraie aide Windows lancée depuis Electron (sans crochet) : elle doit voir CK3 sans lui prendre le premier plan.
    if (aide) {
      const t = Date.now();
      resultat.aide = await aide.demarrer().then(i => ({demarree: true, ms: Date.now() - t, crochet: !!i.crochet}), e => ({demarree: false, erreur: e.message}));
      if (resultat.aide.demarree) { const e = await aide.etat(); Object.assign(resultat.aide, {ck3: e.ck3, minimise: e.minimise, premierPlanAvant: e.premierPlan}); }
    }
    const depart = langue, autre = langue === 'fr' ? 'en' : 'fr';
    resultat.langue = {choisie: langue, source: sourceLangue, locale: app.getLocale(), systeme: app.getPreferredSystemLanguages?.() || null};
    await fenetre.loadURL(urlPage());
    resultat.chargee = true;
    resultat.origine = origine;
    noterCarteGraphique();
    resultat.carteGraphique = (({gpu_compositing: composition, rasterization: rendu}) => ({composition, rendu}))(app.getGPUFeatureStatus());
    const faux = {getURL: () => `${origine}/index.html`};
    const demander = (permission, details) => new Promise(ok => autoriserRequete(faux, permission, ok, details));
    resultat.gestionnaires = {
      notificationsRefusees: !(await demander('notifications', {requestingUrl: `${origine}/index.html`})),
      geolocalisationRefusee: !(await demander('geolocation', {requestingUrl: `${origine}/index.html`})),
      cameraRefusee: !(await demander('media', {mediaTypes: ['video'], securityOrigin: `${origine}/`})),
      microAutreOrigineRefuse: !(await demander('media', {mediaTypes: ['audio'], securityOrigin: 'https://exemple.com/', requestingUrl: 'https://exemple.com/'})),
      microAutorise: await demander('media', {mediaTypes: ['audio'], securityOrigin: `${origine}/`, requestingUrl: `${origine}/index.html`}),
      verificationNotificationsRefusee: !autoriserVerification(null, 'notifications', origine, {}),
      verificationMicroAutorisee: autoriserVerification(null, 'media', origine, {mediaType: 'audio'}),
    };
    resultat.page = await fenetre.webContents.executeJavaScript(`(async () => {
      const r = {};
      r.pont = Object.keys(window.copilote || {}).sort();
      r.isolee = typeof require === 'undefined' && typeof process === 'undefined';
      r.boutonMicro = !!document.querySelector('#micro');
      r.notificationsQuery = (await navigator.permissions.query({name: 'notifications'})).state;
      r.notificationsDemande = await Notification.requestPermission();
      r.geolocalisationQuery = (await navigator.permissions.query({name: 'geolocation'})).state;
      r.microQuery = await navigator.permissions.query({name: 'microphone'}).then(p => p.state, e => 'erreur : ' + e.message);
      r.fenetreOuverte = window.open('about:blank') !== null;
      r.etat = await fetch('/api/jeu/etat').then(x => x.json()).then(j => ({ck3: j.ck3, version: j.version, factice: !!j.factice, erreur: j.erreur || null}), e => ({erreur: e.message}));
      // Capture de l'appui demandée par la page, comme au raccourci : gardée en mémoire par le cerveau, rien n'est envoyé. Dans la
      // langue de l'essai, comme la page la demande (message de la vraie aide traduit par son code).
      r.capture = await fetch('/api/jeu/capturer?langue=${langue}', {method: 'POST'}).then(x => x.json(), e => ({ok: false, erreur: e.message}));
      r.policeExo2 = (await document.fonts.load('14px "Exo 2"')).length > 0 && (await document.fonts.load('700 15px Rajdhani')).length > 0;
      // Chaîne d'enregistrement de la page (permission, worklet, 16 kHz) sur le faux micro de Chromium : le vrai n'est pas ouvert.
      r.enregistrement = await (async () => {
        try {
          const flux = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1}});
          const ctx = new AudioContext();
          await ctx.audioWorklet.addModule('micro-worklet.js');
          const noeud = new AudioWorkletNode(ctx, 'micro-16k', {numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit'});
          let echantillons = 0, paquets = 0, niveauMax = 0;
          noeud.port.onmessage = e => { if (e.data.pcm) { echantillons += e.data.pcm.length; paquets++; niveauMax = Math.max(niveauMax, e.data.niveau); } };
          const silence = ctx.createGain(); silence.gain.value = 0;
          ctx.createMediaStreamSource(flux).connect(noeud).connect(silence).connect(ctx.destination);
          await ctx.resume();
          await new Promise(ok => setTimeout(ok, 1000));
          noeud.port.postMessage('stop');
          await new Promise(ok => setTimeout(ok, 200));
          const piste = flux.getAudioTracks()[0]?.label || '';
          flux.getTracks().forEach(t => t.stop());
          const frequence = ctx.sampleRate;
          await ctx.close();
          return {ok: true, piste, frequenceMicro: frequence, echantillons16kEn1s: echantillons, paquets, niveauMax: Math.round(niveauMax * 1000) / 1000};
        } catch (e) { return {ok: false, erreur: e.name + ' : ' + e.message}; }
      })();
      return r;
    })()`, true);
    // Langue : chaque texte fixe de la page (data-t…), la voix, la ligne d'état et l'attribut lang suivent la langue choisie.
    const verifierTextes = `(() => {
      const l = document.documentElement.lang, T = self.TEXTES_COPILOTE?.[l];
      if (!T) return {lang: l, ok: false, faux: ['dictionnaire absent']};
      const faux = [];
      for (const e of document.querySelectorAll('[data-t]')) if (e.textContent !== T[e.dataset.t]) faux.push(e.dataset.t);
      for (const e of document.querySelectorAll('[data-t-title]')) if (e.title !== T[e.dataset.tTitle]) faux.push('title:' + e.dataset.tTitle);
      for (const e of document.querySelectorAll('[data-t-aria]')) if (e.getAttribute('aria-label') !== T[e.dataset.tAria]) faux.push('aria:' + e.dataset.tAria);
      const voix = document.querySelector('#b-voix').title;
      if (voix !== T.voixOn && voix !== T.voixOff) faux.push('voix');
      const s = document.querySelector('#statut').textContent;
      if (![T.pret, T.injoignable, T.cerveauIndisponible, T.aucuneCle, T.ck3Absent, T.aideEnPanne, T.raccourciAucun].includes(s) && !s.startsWith(T.pretVersion(''))) faux.push('statut');
      return {lang: l, titre: document.title, statut: s, micro: document.querySelector('#micro').title, faux, ok: !faux.length};
    })()`;
    resultat.textes = await fenetre.webContents.executeJavaScript(verifierTextes, true);
    // Menu de la zone de notification (construit sans être affiché) : libellés dans la langue, sous-menu Langue / Language.
    const menu = modeleMenu();
    Menu.buildFromTemplate(menu);
    Menu.buildFromTemplate(modeleMenuIcone());
    const sousMenu = menu.find(i => i.submenu)?.submenu || [];
    resultat.menu = {etiquettes: menu.filter(i => i.label).map(i => i.label), langues: sousMenu.map(i => `${i.label}${i.checked ? ' (cochée)' : ''}`)};
    const menuOk = resultat.menu.etiquettes.includes(MENU[langue].quitter) && sousMenu.length === 2 && sousMenu.every(i => i.type === 'radio')
      && sousMenu.filter(i => i.checked).length === 1 && sousMenu.find(i => i.checked).label === (langue === 'fr' ? 'Français' : 'English');
    // Changement de langue comme au menu (réglage non écrit pendant l'essai) : la page bascule sur place, puis revient.
    changerLangue(autre);
    await new Promise(r => setTimeout(r, 300));
    resultat.bascule = {vers: autre, page: await fenetre.webContents.executeJavaScript(verifierTextes, true), titreFenetre: fenetre.getTitle(),
      menuIcone: modeleMenuIcone().filter(i => i.label).map(i => i.label)};
    changerLangue(depart);
    await new Promise(r => setTimeout(r, 300));
    resultat.bascule.retour = await fenetre.webContents.executeJavaScript(verifierTextes, true);
    const langueOk = resultat.textes.ok && resultat.textes.lang === depart && menuOk && resultat.bascule.page.ok && resultat.bascule.page.lang === autre
      && resultat.bascule.titreFenetre === MENU[autre].nom && resultat.bascule.retour.ok && resultat.bascule.retour.lang === depart && langue === depart
      && resultat.bascule.menuIcone.includes(MENU[autre].quitterCopilote);
    const avant = fenetre.webContents.getURL();
    await fenetre.webContents.executeJavaScript(`location.href = 'http://127.0.0.1:1/ailleurs'; 1`).catch(() => {});
    await new Promise(r => setTimeout(r, 500));
    resultat.navigationBloquee = fenetre.webContents.getURL() === avant;
    // Réduire puis rouvrir (page en démo : ni micro ni API) : la réponse est gardée, Entrée sur l'icône la rouvre, et le panneau
    // ouvert reste à gauche des fenêtres principales du jeu.
    await fenetre.loadURL(`${origine}/index.html?demo=1&etat=reponse&langue=${langue}`);
    resultat.reduire = await fenetre.webContents.executeJavaScript(`(async () => {
      const b = document.body, pause = ms => new Promise(r => setTimeout(r, ms));
      const avant = b.classList.contains('agrandi');
      // Réponse de démonstration dans la langue demandée (&langue=).
      const demoLangue = document.querySelector('#reponse').textContent.startsWith(${JSON.stringify(langue === 'en' ? 'Demo:' : 'Démonstration')});
      document.querySelector('#b-reduire').click();
      const reduit = !b.classList.contains('agrandi') && b.classList.contains('garde') && document.querySelector('#reponse').textContent.length > 50;
      document.querySelector('#micro').dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
      await pause(100);
      return {avant, demoLangue, reduit, rouvert: b.classList.contains('agrandi') && !b.classList.contains('garde') && b.dataset.etat === 'reponse'};
    })()`, true);
    await new Promise(r => setTimeout(r, 150));
    const bp = fenetre.getBounds(), ecran = ecranDe(pos);
    resultat.reduire.panneau = bp;
    resultat.reduire.aGaucheDesFenetresDuJeu = !coin.endsWith('droite') || bp.x + bp.width <= ecran.x + ecran.width - 655;
    const g = resultat.gestionnaires, p = resultat.page;
    let aideOk = true;
    if (aide) {
      if (resultat.aide.demarree) resultat.aide.premierPlanApres = (await aide.etat().catch(() => ({}))).premierPlan;
      const t = Date.now();
      await aide.arreter();
      resultat.aide.arretMs = Date.now() - t;
      // CK3 fermé ou réduit pendant l'essai : la capture doit alors échouer proprement (code de l'aide, message dans la langue de
      // l'essai), pas planter.
      const messageAttendu = {fr: /pas lancé|réduit/, en: /isn’t running|minimized/}[langue];
      aideOk = resultat.aide.demarree && (p.capture?.ok || (['pas-lance', 'reduit'].includes(p.capture?.code) && p.capture.bloquant === true && messageAttendu.test(p.capture.erreur || '')));
    }
    resultat.robustesse = await essaisRobustesse();
    resultat.fenetre = {visible: fenetre.isVisible(), jamaisMontree: fenetresMontrees === 0, focusable: fenetre.isFocusable(), auDessus: fenetre.isAlwaysOnTop(), taille: fenetre.getBounds()};
    resultat.ok = aideOk && !resultat.fenetre.visible && fenetresMontrees === 0 && !resultat.fenetre.focusable && resultat.navigationBloquee && p.isolee && p.boutonMicro
      && Object.values(g).every(Boolean) && p.notificationsDemande !== 'granted' && p.notificationsQuery !== 'granted' && p.geolocalisationQuery !== 'granted' && !p.fenetreOuverte
      && p.enregistrement.ok && p.enregistrement.echantillons16kEn1s > 12000 && p.enregistrement.echantillons16kEn1s < 20000
      && resultat.reduire.avant && resultat.reduire.reduit && resultat.reduire.rouvert && resultat.reduire.aGaucheDesFenetresDuJeu
      && langueOk && resultat.reduire.demoLangue && resultat.robustesse.ok;
  } catch (e) { resultat.erreur = e.message; }
  clearTimeout(garde);
  await aide?.arreter().catch(() => {});   // déjà fait si tout s'est bien passé ; sinon l'aide ne doit pas survivre à l'essai
  process.stdout.write(JSON.stringify(resultat, null, 2) + '\n');
  setTimeout(() => app.exit(resultat.ok ? 0 : 1), 100);
}

// ---------- Démarrage ----------
async function demarrer() {
  nativeTheme.themeSource = 'dark';   // les suggestions Google suivent le thème sombre du panneau
  Menu.setApplicationMenu(null);
  // En essai, la vraie aide tourne aussi (capture en mémoire), mais sans crochet clavier : aucune touche n'est interceptée. Hors
  // essai, elle connaît Electron (pid) et app.log : le double Ctrl+Maj+Retour arrière l'arrête de force s'il est figé.
  try {
    const {creerAideWindows} = await import('./aide-windows.mjs');
    aide = creerAideWindows(ESSAI ? {journal, crochet: false} : {journal, parent: process.pid, fichierJournal: FICHIER_JOURNAL});
  } catch (e) { journal.warn(`Aide Windows indisponible : ${e.message}`); }
  serveur = await demarrerServeur({root: ROOT, aide, journal});
  origine = `http://127.0.0.1:${serveur.port}`;
  ({langue, source: sourceLangue} = langueDeDepart(await lireEnv(ROOT).catch(() => ({}))));
  journal.log(`Langue : ${langue} (${sourceLangue})`);
  installerSecurite(session.defaultSession);
  brancherIpc();
  brancherDiagnostic();
  fenetre = creerFenetre();
  dernierTic = dernierBattement = Date.now();
  minuteries.push(setInterval(ticChien, 1000));
  if (ESSAI) return essaiFenetre();

  // Zone de notification et aide Windows (crochet, raccourci d'urgence) d'abord : elles doivent exister même si la page ne finit
  // jamais de charger (revue du 09/10/2026). Chargement borné à 10 s ; ?langue= : la page s'affiche tout de suite dans la bonne
  // langue ('etat' la confirme ensuite, et la change sur place).
  creerTray();
  brancherAide();
  await chargerPage(fenetre, urlPage(), 'démarrage');
  noterCarteGraphique();
  forceJusqua = Date.now() + 15000;   // au lancement, l'icône se montre 15 s même sans CK3 : Ameur voit que c'est parti
  montrer();
  minuteries.push(setInterval(rafraichirVisibilite, 3000));
  // D'autres fenêtres « au-dessus » (Grammarly, NVIDIA) passent parfois devant : on remonte l'icône sans prendre le focus,
  // seulement quand CK3 est devant (jamais au-dessus de l'appli où Ameur est passé).
  minuteries.push(setInterval(() => { if (fenetre && !fenetre.isDestroyed() && fenetre.isVisible() && (jeuDevant || forceActif())) fenetre.moveTop(); }, 2000));
  journal.log(`Copilote CK3 lancé (Electron ${process.versions.electron}, ${origine})`);
}

// Ne pas voler les touches multimédia au jeu ; CalculateNativeWinOcclusion (09/10/2026) : Chromium calcule si ses fenêtres sont
// cachées par d'autres et arrête alors de les peindre. Au-dessus d'un jeu en plein écran (DirectX), cachée puis remontrée sans
// cesse, l'icône pouvait être jugée masquée et rester figée sur sa dernière image : on garde la fenêtre toujours « visible ».
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService,CalculateNativeWinOcclusion');
if (ESSAI) {
  app.setPath('userData', path.join(app.getPath('temp'), 'copilote-ck3-essai'));
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');   // faux micro de Chromium : l'essai n'ouvre jamais le vrai
}
const premier = ESSAI || app.requestSingleInstanceLock();
if (!premier) app.quit();
else {
  // Deuxième lancement : la copie ouverte reste seule, mais sa fenêtre et sa page repartent à neuf (07/10 : ouverte depuis la
  // veille, l'icône ne réagissait plus aux clics ; Ameur relance le raccourci, rien ne change, alors qu'un redémarrage réglait
  // tout). Pas pendant une écoute : la question en cours n'est pas coupée.
  app.on('second-instance', () => {
    const ecoute = Date.now() < ecouteJusqua;
    journal.log(`Deuxième lancement : la copie déjà ouverte reste seule${ecoute ? ' (écoute en cours, fenêtre gardée)' : ', sa fenêtre est recréée'}`);
    forceJusqua = Date.now() + 15000;
    if (!ecoute && fenetre && !fenetre.isDestroyed()) recreerFenetre('deuxième lancement');
    else { montrer(); fenetre?.moveTop(); }
  });
  app.on('web-contents-created', (_e, wc) => { wc.on('will-attach-webview', e => e.preventDefault()); });
  app.on('before-quit', () => {
    for (const m of minuteries) clearInterval(m);
    clearTimeout(minuteurAide);
    clearTimeout(recuperation?.minuteur);
    try { globalShortcut.unregisterAll(); } catch {}
    try { aide?.arreter?.(); } catch {}
    tray?.destroy();
    serveur?.fermer();
  });
  app.whenReady().then(demarrer).catch(e => {
    journal.error('Démarrage impossible :', e);
    if (ESSAI) process.stdout.write(JSON.stringify({essai: 'fenetre', ok: false, erreur: e.message}) + '\n');
    // Sans cela, le copilote disparaissait sans un mot (10/10/2026) : la cause et le chemin du journal, dans une boîte Windows.
    else try { const t = MENU[langueValide(langue) || 'fr']; dialog.showErrorBox(t.demarrageRate, t.demarrageDetail(e?.message || String(e), FICHIER_JOURNAL)); } catch {}
    app.exit(1);
  });
}
