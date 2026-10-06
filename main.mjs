// Copilote CK3, processus principal Electron (06/10/2026). Une petite icône micro reste au-dessus de Crusader Kings III sans
// jamais lui prendre le focus (focusable:false = WS_EX_NOACTIVATE) ; Ctrl+Maj+Espace ou un clic, Ameur pose sa question à voix
// haute, la réponse s'affiche dans un panneau et se dit à voix haute. L'appli ne touche jamais au jeu ni au clavier : la capture
// et le crochet du raccourci sont dans aide-windows.mjs, le cerveau dans agent/copilote-jeu.mjs (via serveur.mjs).
// Essai sans rien afficher : electron . --essai-fenetre (vraie aide sans crochet clavier ; COPILOTE_ESSAI_STUB=1 pour se passer du cerveau ;
// COPILOTE_LANGUE=en|fr pour essayer une langue).
// Langue (06/10/2026, publication sur GitHub) : français ou anglais, au choix dans le menu de la zone de notification ; par défaut
// celle de Windows (français chez Ameur, donc rien ne change pour lui).
import {app, BrowserWindow, ipcMain, session, screen, Tray, Menu, nativeImage, shell, globalShortcut, nativeTheme} from 'electron';
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
const TOUJOURS = process.env.COPILOTE_TOUJOURS === '1';
const PETIT = 72, LARGE = 440, HAUT = 420;
const BORD = 60;   // CK3 fait défiler la carte quand la souris touche le bord de l'écran : l'icône s'en tient à distance
// Fenêtres principales de CK3 (Realm, Military, Council, Court, Intrigue, Factions, Decisions, Activities : F2 à F9) : 655 px
// de large collés au bord droit, toute la hauteur (gui/shared/windows.gui, Window_Size_MainTab). Le panneau ouvert reste à leur
// gauche, sinon il cache justement la fenêtre que la réponse dit d'ouvrir.
const FENETRES_JEU = 655 + 10;
// Icône de la zone de notification (cercle sombre, anneau bleu, micro), 16 et 32 px.
const ICONE_16 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAABKElEQVR42mNgQAM2R/6z2xz572tz5P9smyP/V0HxbKgYOwM+AFX0SKtr+3/pyJr/mgFZYAxig8RAciA1uDRnGS+//V/QPOg/u5jm/5jsmv+PPv8HYxAbJAaSA6kBqcWwGSTBrWIFVgjC209chRsAYsPEQWqghvgi+/kRzGYY3nvuNtwAEBtZDqQW6h12sO0g/yErIGQACEPDxBdkwGxQIJFqAEgPSC/IgFXIzl+9+yROA2BySN5YhWHA0q2H/9v6xv3vmbsabgCIDRIDyWEzAMUL5u4R/0/eeg7WUNIyBYxBbJAYSA6bFzACEaQQFHWHrzwEYxAbWTN6IGKNRhCGuQBdHCUacSUkUMCdf/AWjJFjASMh4UrK2DDOpIwrM4E0gDBRmYnc7AwAGmDVkMgNB4QAAAAASUVORK5CYII=';
const ICONE_32 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAACoElEQVR42s1XP0hbQRh/m4vEQSKIAWlB0ApdDBXCAwUhLgqCiwXBxaFECs1WVMikFEcJglOH4tBJM0gmEckb7NIscdGldahLnRyC09f+vtyFz+e7vLskioEfuXf3/fnd3Xfffed5jj8/oKQf0LwfUN4PqKCQV31J7yl+fkAp5aj2/59iUFOyqW44TvgBFf2A6trBu6MbGt0q0auPRRp6v8lAG30YE0TqSjfRrvMpP6BrGMuc3tPIxgH1TcxRz8AYY3A0Qwsrnxho637IQBY6ighsTLk6z+lZv9kpU+/YdNMBsLy2SVd/7+n6jhhoo0/KQAe6YjVyLs55BlheaRQYz8w9cC5JYCwsDxtiNXI2y16HQjK7+sgYsL6z/8i5BsaidGBLkagbt0MFHO951Mw19r+XjQQwZtKDTRETiSgCRb3nJiOdEABETBSjzjkvfTjgukkAtsVWpCQBJA4+Pq0MdEoAgA+1CgVJgDOcPOdPRQA+dMaUuZ2zWJxyNwgAImMmPXWJcCp9LgLwpQjMe+om43weJXzy84q+Hp44E4AOdKNswpcikG8GoOns/7i8oYs/d84EoAPdmJxQiCWw+63ExmcWG5nxw+cvRgIYgwxk8Q1dGwItt0AbK51V+Xv47TTPLuwcfRiDDGQl6bgtiA3Cg+MKG9zea+SJydkl3l/tHG30YQwy6IOObRDGHkPc99Vft2wYwTWSzjaSSjr7oI0xyEBW1ggtj6FtIsLyls8vmrPGMiPoAL3kAGT0VlglItdUjMJDEpGOw0WJSyq2vow0+l+nqVL7zUDbRsd4Gblcx+EkZUo2TtexS0GinQIowwDZ13ZBYluSmZKQRtslmW1R6gqnotS2LLcNuLbKctuHSatz3vHD5EU8zV7E4/Q5nuf/AEjZ9se0gHh9AAAAAElFTkSuQmCC';

// ---------- Journal (journal/copilote-ck3/app.log, heure locale du PC) ----------
const heure = () => new Intl.DateTimeFormat('fr-FR', {dateStyle: 'short', timeStyle: 'medium'}).format(new Date());
const journal = (() => {
  const fichier = path.join(JOURNAUX, ESSAI ? 'essai-fenetre.log' : 'app.log');
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
const MENU = {
  fr: {nom: 'Copilote CK3', voixOn: 'Voix activée', voixOff: 'Voix désactivée', oublier: 'Oublier la conversation',
    replacer: 'Replacer l\'icône et le panneau', langue: 'Langue / Language', quitter: 'Quitter'},
  en: {nom: 'CK3 Copilot', voixOn: 'Voice on', voixOff: 'Voice off', oublier: 'Forget the conversation',
    replacer: 'Reset the icon and panel position', langue: 'Langue / Language', quitter: 'Quit'},
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
function envoyer(canal, donnees) { if (fenetre && !fenetre.isDestroyed()) fenetre.webContents.send(canal, donnees); }
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

function deplacer(dx, dy) {
  dx = borne(Math.round(Number(dx) || 0), -400, 400); dy = borne(Math.round(Number(dy) || 0), -400, 400);
  const b = fenetre.getBounds(), d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds;
  fenetre.setBounds({x: borne(b.x + dx, d.x, d.x + d.width - b.width), y: borne(b.y + dy, d.y, d.y + d.height - b.height), width: b.width, height: b.height});
}
function finDeplacement() {
  const b = fenetre.getBounds();
  // Panneau ouvert déplacé : on retient sa place à lui (il y revient à chaque réponse) ; l'icône repliée garde la sienne.
  if (agrandi) posPanneau = {x: b.x, y: b.y};
  else { pos = {x: b.x, y: b.y}; coin = coinPour(pos); }
  sauverPosition();
  envoyerEtat();
}

// ---------- Visibilité : seulement quand CK3 est la fenêtre active (lancé, pas réduit, pas derrière une autre appli) ----------
function montrer() {
  if (ESSAI || !fenetre || fenetre.isDestroyed() || fenetre.isVisible()) return;
  fenetre.showInactive();
  fenetre.setAlwaysOnTop(true, 'screen-saver');
}
function cacher() { if (fenetre && !fenetre.isDestroyed() && fenetre.isVisible()) fenetre.hide(); }
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
// peut pas le savoir : il reste enregistré, et l'aide est réessayée régulièrement pour en sortir.
let dernierSecours = 0, secoursVoulu = false, secoursEnregistre = false;
function surSecours() {
  if (Date.now() - dernierSecours < 400) return;   // Windows répète le raccourci tant que la touche est tenue
  dernierSecours = Date.now();
  forceJusqua = Date.now() + 20000; montrer();
  envoyer('raccourci', {etat: 'bascule', t: Date.now()});
}
function ajusterSecours() {
  const doit = secoursVoulu && (!aidePrete || jeuDevant || TOUJOURS);
  if (doit && !secoursEnregistre) {
    try { secoursEnregistre = globalShortcut.register('Control+Shift+Space', surSecours); } catch { secoursEnregistre = false; }
  } else if (!doit && secoursEnregistre) {
    try { globalShortcut.unregister('Control+Shift+Space'); } catch {}
    secoursEnregistre = false;
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

function brancherAide() {
  if (!aide) return activerSecours('aide Windows absente');
  aide.on?.('raccourci', d => {
    if (d?.etat !== 'appui' && d?.etat !== 'relache') return;
    // L'aide ne signale le combo que lorsque CK3 est au premier plan : il a appuyé exprès, dans le jeu.
    if (d.etat === 'appui') { forceJusqua = Date.now() + 20000; jeuDevant = true; montrer(); }
    envoyer('raccourci', {etat: d.etat, t: d.t});
  });
  aide.on?.('pret', surAidePrete);   // à chaque (re)démarrage de l'aide
  aide.on?.('erreur', m => { journal.error(`Aide Windows : ${m?.message || m}`); aidePrete = false; activerSecours('aide Windows en panne'); reessayerAide(); });
  aide.demarrer()
    .then(surAidePrete)
    .catch(e => { journal.error(`Aide Windows non démarrée : ${e.message}`); activerSecours('aide Windows non démarrée'); reessayerAide(); });
}

// ---------- Zone de notification ----------
function creerTray() {
  const image = nativeImage.createFromDataURL('data:image/png;base64,' + ICONE_16);
  image.addRepresentation({scaleFactor: 2, dataURL: 'data:image/png;base64,' + ICONE_32});
  tray = new Tray(image);
  tray.on('click', () => { forceJusqua = Date.now() + 15000; montrer(); fenetre?.moveTop(); });
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
    {label: t.langue, submenu: [
      {label: 'Français', type: 'radio', checked: langue === 'fr', click: () => changerLangue('fr')},
      {label: 'English', type: 'radio', checked: langue === 'en', click: () => changerLangue('en')},
    ]},
    {type: 'separator'},
    {label: t.quitter, click: () => app.quit()},
  ];
}
function majTray() {
  if (!tray) return;
  tray.setToolTip(MENU[langue].nom);
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
function creerFenetre() {
  const lu = lireJson(FICHIER_POSITION, null);
  pos = positionValide(lu) || positionParDefaut();
  posPanneau = panneauValide(lu?.panneau);
  coin = coinPour(pos);
  const f = new BrowserWindow({
    x: pos.x, y: pos.y, width: PETIT, height: PETIT, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, minimizable: false, maximizable: false, fullscreenable: false, hasShadow: false, skipTaskbar: true,
    focusable: false, alwaysOnTop: true, title: MENU[langue].nom,
    webPreferences: {preload: path.join(DOSSIER, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false,
      backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required', spellcheck: false, webviewTag: false},
  });
  f.setAlwaysOnTop(true, 'screen-saver');
  // Pas de setContentProtection : Ameur veut pouvoir faire des captures d'écran où l'on voit le copilote (06/10). La capture
  // envoyée au modèle n'en souffre pas : PrintWindow ne rend que la fenêtre de CK3, jamais celles posées au-dessus.
  const wc = f.webContents;
  wc.setWindowOpenHandler(({url}) => { ouvrirExterne(url); return {action: 'deny'}; });
  wc.on('will-navigate', e => { e.preventDefault(); journal.warn('Navigation bloquée'); });
  wc.on('will-frame-navigate', e => { if (!e.isMainFrame && !/^about:(srcdoc|blank)/.test(e.url)) e.preventDefault(); });
  wc.on('will-attach-webview', e => e.preventDefault());
  wc.on('did-finish-load', envoyerEtat);
  wc.on('render-process-gone', (_e, d) => {
    journal.error(`Page de l'icône arrêtée : ${d.reason}`);
    ecouteJusqua = 0;   // son micro est fermé avec elle
    if (!ESSAI) setTimeout(() => { if (!f.isDestroyed()) f.reload(); }, 1000);
  });
  // Avertissements de la page (micro refusé...) : le détail technique va au journal, Ameur ne voit qu'une phrase claire.
  wc.on('console-message', (e, niveau, message) => {
    const n = e?.level ?? niveau, m = e?.message ?? message;
    if (n === 'warning' || n === 'error' || n === 2 || n === 3) journal.warn(`Page : ${String(m).slice(0, 300)}`);
  });
  return f;
}

function brancherIpc() {
  const valide = e => !!fenetre && e.sender === fenetre.webContents && deNous(e.senderFrame?.url);
  ipcMain.on('agrandir', (e, oui) => { if (!valide(e)) return; agrandi = !!oui; appliquerTaille(); if (agrandi && (jeuDevant || forceActif())) montrer(); });
  // Micro ouvert ou fermé (30 s d'enregistrement au plus côté page, d'où la marge de 35 s si la page ne prévient pas).
  ipcMain.on('ecoute', (e, oui) => { if (!valide(e)) return; ecouteJusqua = oui ? Date.now() + 35000 : 0; if (oui) montrer(); });
  ipcMain.on('deplacer', (e, dx, dy) => { if (valide(e)) deplacer(dx, dy); });
  ipcMain.on('fin-deplacement', e => { if (valide(e)) finDeplacement(); });
  ipcMain.on('ouvrir-lien', (e, url) => { if (valide(e)) ouvrirExterne(url); });
  ipcMain.handle('voix', e => valide(e) ? reglages.voix : false);
  ipcMain.handle('basculer-voix', e => valide(e) ? basculerVoix() : reglages.voix);
}

// ---------- Essai sans affichage : la page se charge dans une fenêtre jamais montrée, puis on vérifie les protections ----------
async function essaiFenetre() {
  const resultat = {essai: 'fenetre', ok: false};
  let montree = false;
  fenetre.on('show', () => { montree = true; });
  const garde = setTimeout(() => { process.stdout.write(JSON.stringify({...resultat, erreur: 'délai dépassé (25 s)'}) + '\n'); app.exit(2); }, 25000);
  try {
    // Vraie aide Windows lancée depuis Electron (sans crochet) : elle doit voir CK3 sans lui prendre le premier plan.
    if (aide) {
      const t = Date.now();
      resultat.aide = await aide.demarrer().then(i => ({demarree: true, ms: Date.now() - t, crochet: !!i.crochet}), e => ({demarree: false, erreur: e.message}));
      if (resultat.aide.demarree) { const e = await aide.etat(); Object.assign(resultat.aide, {ck3: e.ck3, minimise: e.minimise, premierPlanAvant: e.premierPlan}); }
    }
    const depart = langue, autre = langue === 'fr' ? 'en' : 'fr';
    resultat.langue = {choisie: langue, source: sourceLangue, locale: app.getLocale(), systeme: app.getPreferredSystemLanguages?.() || null};
    await fenetre.loadURL(`${origine}/index.html?langue=${langue}`);
    resultat.chargee = true;
    resultat.origine = origine;
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
      if (![T.pret, T.injoignable, T.cerveauIndisponible, T.aucuneCle, T.ck3Absent, T.raccourciAucun].includes(s) && !s.startsWith(T.pretVersion(''))) faux.push('statut');
      return {lang: l, titre: document.title, statut: s, micro: document.querySelector('#micro').title, faux, ok: !faux.length};
    })()`;
    resultat.textes = await fenetre.webContents.executeJavaScript(verifierTextes, true);
    // Menu de la zone de notification (construit sans être affiché) : libellés dans la langue, sous-menu Langue / Language.
    const menu = modeleMenu();
    Menu.buildFromTemplate(menu);
    const sousMenu = menu.find(i => i.submenu)?.submenu || [];
    resultat.menu = {etiquettes: menu.filter(i => i.label).map(i => i.label), langues: sousMenu.map(i => `${i.label}${i.checked ? ' (cochée)' : ''}`)};
    const menuOk = resultat.menu.etiquettes.includes(MENU[langue].quitter) && sousMenu.length === 2 && sousMenu.every(i => i.type === 'radio')
      && sousMenu.filter(i => i.checked).length === 1 && sousMenu.find(i => i.checked).label === (langue === 'fr' ? 'Français' : 'English');
    // Changement de langue comme au menu (réglage non écrit pendant l'essai) : la page bascule sur place, puis revient.
    changerLangue(autre);
    await new Promise(r => setTimeout(r, 300));
    resultat.bascule = {vers: autre, page: await fenetre.webContents.executeJavaScript(verifierTextes, true), titreFenetre: fenetre.getTitle()};
    changerLangue(depart);
    await new Promise(r => setTimeout(r, 300));
    resultat.bascule.retour = await fenetre.webContents.executeJavaScript(verifierTextes, true);
    const langueOk = resultat.textes.ok && resultat.textes.lang === depart && menuOk && resultat.bascule.page.ok && resultat.bascule.page.lang === autre
      && resultat.bascule.titreFenetre === MENU[autre].nom && resultat.bascule.retour.ok && resultat.bascule.retour.lang === depart && langue === depart;
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
    resultat.fenetre = {visible: fenetre.isVisible(), jamaisMontree: !montree, focusable: fenetre.isFocusable(), auDessus: fenetre.isAlwaysOnTop(), taille: fenetre.getBounds()};
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
    resultat.ok = aideOk && !resultat.fenetre.visible && !montree && !resultat.fenetre.focusable && resultat.navigationBloquee && p.isolee && p.boutonMicro
      && Object.values(g).every(Boolean) && p.notificationsDemande !== 'granted' && p.notificationsQuery !== 'granted' && p.geolocalisationQuery !== 'granted' && !p.fenetreOuverte
      && p.enregistrement.ok && p.enregistrement.echantillons16kEn1s > 12000 && p.enregistrement.echantillons16kEn1s < 20000
      && resultat.reduire.avant && resultat.reduire.reduit && resultat.reduire.rouvert && resultat.reduire.aGaucheDesFenetresDuJeu
      && langueOk && resultat.reduire.demoLangue;
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
  // En essai, la vraie aide tourne aussi (capture en mémoire), mais sans crochet clavier : aucune touche n'est interceptée.
  try { const {creerAideWindows} = await import('./aide-windows.mjs'); aide = creerAideWindows(ESSAI ? {journal, crochet: false} : {journal}); } catch (e) { journal.warn(`Aide Windows indisponible : ${e.message}`); }
  serveur = await demarrerServeur({root: ROOT, aide, journal});
  origine = `http://127.0.0.1:${serveur.port}`;
  ({langue, source: sourceLangue} = langueDeDepart(await lireEnv(ROOT).catch(() => ({}))));
  journal.log(`Langue : ${langue} (${sourceLangue})`);
  installerSecurite(session.defaultSession);
  brancherIpc();
  fenetre = creerFenetre();
  if (ESSAI) return essaiFenetre();

  // ?langue= : la page s'affiche tout de suite dans la bonne langue ('etat' la confirme ensuite, et la change sur place).
  await fenetre.loadURL(`${origine}/index.html?langue=${langue}`);
  creerTray();
  brancherAide();
  forceJusqua = Date.now() + 15000;   // au lancement, l'icône se montre 15 s même sans CK3 : Ameur voit que c'est parti
  montrer();
  minuteries.push(setInterval(rafraichirVisibilite, 3000));
  // D'autres fenêtres « au-dessus » (Grammarly, NVIDIA) passent parfois devant : on remonte l'icône sans prendre le focus,
  // seulement quand CK3 est devant (jamais au-dessus de l'appli où Ameur est passé).
  minuteries.push(setInterval(() => { if (fenetre && !fenetre.isDestroyed() && fenetre.isVisible() && (jeuDevant || forceActif())) fenetre.moveTop(); }, 2000));
  journal.log(`Copilote CK3 lancé (Electron ${process.versions.electron}, ${origine})`);
}

app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');   // ne pas voler les touches multimédia au jeu
if (ESSAI) {
  app.setPath('userData', path.join(app.getPath('temp'), 'copilote-ck3-essai'));
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');   // faux micro de Chromium : l'essai n'ouvre jamais le vrai
}
const premier = ESSAI || app.requestSingleInstanceLock();
if (!premier) app.quit();
else {
  app.on('second-instance', () => { journal.log('Deuxième lancement : la copie déjà ouverte reste seule'); forceJusqua = Date.now() + 15000; montrer(); fenetre?.moveTop(); });
  app.on('web-contents-created', (_e, wc) => { wc.on('will-attach-webview', e => e.preventDefault()); });
  app.on('before-quit', () => {
    for (const m of minuteries) clearInterval(m);
    clearTimeout(minuteurAide);
    try { globalShortcut.unregisterAll(); } catch {}
    try { aide?.arreter?.(); } catch {}
    tray?.destroy();
    serveur?.fermer();
  });
  app.whenReady().then(demarrer).catch(e => {
    journal.error('Démarrage impossible :', e);
    if (ESSAI) process.stdout.write(JSON.stringify({essai: 'fenetre', ok: false, erreur: e.message}) + '\n');
    app.exit(1);
  });
}
