// Aide Windows du copilote CK3 vue de Node : un seul PowerShell (aide-windows.ps1) lancé une fois et questionné en lignes JSON.
// Il capture la seule fenêtre de CK3 (en mémoire, jamais sur le disque) et signale Ctrl+Maj+Espace grâce à un crochet clavier.
// Pendant une question, le cerveau le fait regarder le jeu par des aperçus légers (apercu : empreinte + souris, sans JPEG).
// Il n'envoie jamais ni touche ni clic. S'il tombe, il est relancé (3 fois par minute au plus), puis déclaré en panne ('erreur') ;
// une demande faite plus d'une minute après la panne (ou un nouveau demarrer()) le relance.
import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'aide-windows.ps1');
// L'aide ne renvoie que des codes ASCII (PowerShell 5.1 lit mal les accents) : les phrases pour Ameur sont ici.
const MESSAGES = {
  'pas-lance': 'CK3 n\'est pas lancé', reduit: 'CK3 est réduit', noire: 'Capture noire', 'ne-repond-pas': 'CK3 ne répond pas',
  'trop-petite': 'La fenêtre de CK3 est trop petite', echec: 'Capture de CK3 impossible', perimee: 'Aperçu de CK3 périmé',
};
// Délais de réponse, comptés à partir du moment où l'aide COMMENCE la commande (elle les traite une par une) : au-delà, son fil
// de travail est bloqué (PrintWindow sur un CK3 figé...) et on la relance. Une commande qui attend son tour plus longtemps que
// son délai est seulement abandonnée : l'état demandé derrière une capture lente ne doit pas tuer l'aide (et la capture).
const DELAIS = {etat: 5000, capturer: 15000, apercu: 15000, liberer: 5000, diagnostic: 5000, banc: 20000, reinstaller: 5000};
const IMPRESSIONS = ['capturer', 'apercu'];   // commandes qui impriment CK3 (PrintWindow) et peuvent donc prendre du temps
const MAX_RELANCES = 3;   // par minute
// Immobilité de la souris : -1 de l'aide (on l'ignore encore) devient null, pour que personne ne la prenne pour un mouvement.
const immobile = ms => Number.isFinite(ms) && ms >= 0 ? ms : null;
const NOUVEL_ESSAI_MS = 60000;   // après une panne, nouvel essai au plus tôt une minute plus tard

// processus, crochet et script ne servent qu'aux essais (faux nom de processus, aide sans crochet, script cassé).
export function creerAideWindows({journal = console, processus = 'ck3', crochet = true, script = SCRIPT} = {}) {
  const aide = new EventEmitter();
  aide.setMaxListeners(50);
  const noter = (niveau, texte) => { try { (journal[niveau] || journal.log).call(journal, `Aide Windows : ${texte}`); } catch {} };
  let enfant = null, info = null;      // processus PowerShell en cours et sa ligne {pret:true}
  let demarrage = null, attente = null; // promesse de demarrer() et ses fonctions de résolution
  let arret = false, enPanne = false, tPanne = 0;
  let tampon = '', erreurs = '', suivant = 1, relances = [];
  const file = [];   // requêtes envoyées, dans l'ordre : l'aide les traite une par une, la première est celle en cours
  // Node qui s'arrête normalement (Electron qui quitte) : on ne laisse pas l'aide derrière. S'il meurt brutalement,
  // c'est la fermeture de stdin qui fait partir l'aide.
  const tuer = () => { try { enfant?.kill(); } catch {} };

  function lancer() {
    info = null; tampon = ''; erreurs = '';
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Processus', processus];
    if (!crochet) args.push('-SansCrochet');
    // windowsHide : aucune console ne doit apparaître au-dessus du jeu.
    const p = spawn('powershell.exe', args, {windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
    enfant = p;
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', morceau => {
      // Une capture fait ~600 Ko de base64 sur une seule ligne : on ne cherche la fin de ligne que dans ce qui vient d'arriver.
      const debut = tampon.length;
      tampon += morceau;
      let i = tampon.indexOf('\n', debut);
      while (i >= 0) {
        const ligne = tampon.slice(0, i).trim();
        tampon = tampon.slice(i + 1);
        if (ligne) recevoir(p, ligne);
        i = tampon.indexOf('\n');
      }
    });
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', texte => { erreurs = (erreurs + texte).slice(-2000); for (const l of texte.split(/\r?\n/)) if (l.trim()) noter('error', l.trim()); });
    p.stdin.on('error', () => {});   // EPIPE si l'aide vient de tomber : 'exit' s'en occupe
    p.on('error', e => { noter('error', `lancement impossible : ${e.message}`); fin(p, null); });
    p.on('exit', code => fin(p, code));
  }

  function recevoir(p, ligne) {
    if (p !== enfant) return;
    let m;
    try { m = JSON.parse(ligne); } catch { noter('warn', `ligne illisible : ${ligne.slice(0, 200)}`); return; }
    if (m.pret) {
      info = m;
      if (crochet && !m.crochet) noter('warn', `crochet clavier non installé (erreur Windows ${m.erreurCrochet}) : seul le clic sur l'icône marchera`);
      attente?.ok(m); attente = null;
      aide.emit('pret', m);
      return;
    }
    if (m.evt === 'raccourci') { aide.emit('raccourci', {etat: m.etat, t: m.t}); return; }
    const i = file.findIndex(r => r.id === m.id);
    if (i < 0) return;
    // Les réponses arrivent dans l'ordre d'envoi : celles d'avant, jamais venues, sont perdues.
    for (const r of file.splice(0, i + 1)) {
      clearTimeout(r.minuteur); clearTimeout(r.attente);
      if (r.abandon) continue;
      if (r.id !== m.id) r.ko(new Error('Aide Windows : réponse perdue'));
      else if (m.ok) r.ok(m.res);
      else r.ko(Object.assign(new Error(MESSAGES[m.code] || `Aide Windows : ${m.erreur}`), {code: m.code, detail: m.erreur}));
    }
    if (file[0]) surveiller(file[0]);
  }

  // La commande en tête de file est celle que l'aide exécute : son délai démarre maintenant.
  function surveiller(r) {
    clearTimeout(r.attente);
    if (r.minuteur) return;
    r.minuteur = setTimeout(() => {
      if (!r.abandon) { r.abandon = true; r.ko(new Error('Aide Windows sans réponse')); }
      if (r.p === enfant) { noter('warn', `« ${r.cmd} » sans réponse après ${r.delai} ms : relance de l'aide`); try { r.p.kill(); } catch {} }
    }, r.delai);
  }

  function fin(p, code) {
    if (p !== enfant) return;
    enfant = null; info = null;
    for (const r of file) { clearTimeout(r.minuteur); clearTimeout(r.attente); if (!r.abandon) r.ko(new Error('Aide Windows arrêtée')); }
    file.length = 0;
    if (arret || enPanne) return;
    noter('error', `arrêtée (code ${code})${erreurs ? ' : ' + erreurs.trim().slice(-300) : ''}`);
    const maintenant = Date.now();
    relances = relances.filter(t => maintenant - t < 60000);
    if (relances.length >= MAX_RELANCES) return panne(`arrêtée ${MAX_RELANCES + 1} fois en une minute : capture et raccourci indisponibles`);
    relances.push(maintenant);
    setTimeout(() => { if (!arret && !enPanne && !enfant) lancer(); }, 500);
  }

  function panne(message) {
    enPanne = true; tPanne = Date.now();
    demarrage = null;   // un nouveau demarrer() relancera l'aide (sinon il rendrait la promesse déjà tenue du premier démarrage)
    noter('error', message);
    attente?.ko(new Error(`Aide Windows : ${message}`)); attente = null;
    aide.emit('erreur', message);
  }

  // Résout avec la ligne {pret, pid, crochet, erreurCrochet} une fois l'aide prête (compilation C# comprise : ~1 s).
  function demarrer() {
    if (demarrage) return demarrage;
    arret = false; enPanne = false; relances = [];
    const d = demarrage = new Promise((ok, ko) => {
      const minuteur = setTimeout(() => { const p = enfant; panne('pas prête après 30 s'); try { p?.kill(); } catch {} }, 30000);
      attente = {ok: m => { clearTimeout(minuteur); ok(m); }, ko: e => { clearTimeout(minuteur); ko(e); }};
    });
    d.catch(() => { if (demarrage === d) demarrage = null; });   // un échec permet de réessayer plus tard
    process.off('exit', tuer); process.on('exit', tuer);
    if (!enfant) lancer();
    return d;
  }

  // Attend l'aide si elle (re)démarre ; échoue tout de suite si elle est arrêtée ou en panne depuis moins d'une minute
  // (l'interrogation de l'état toutes les 3 s ne doit pas la relancer sans fin). Passé ce délai, la demande suivante la relance :
  // une panne passagère ne prive plus Ameur du raccourci jusqu'au prochain lancement de l'appli.
  function prete(delai = 10000) {
    if (enfant && info) return Promise.resolve();
    if (enPanne && !arret && Date.now() - tPanne > NOUVEL_ESSAI_MS) { noter('log', 'nouvel essai après la panne'); demarrer().catch(() => {}); }
    if (!demarrage && !arret && !enPanne) demarrer().catch(() => {});
    if (arret || enPanne) return Promise.reject(new Error('Aide Windows indisponible'));
    return new Promise((ok, ko) => {
      const finir = (erreur) => { clearTimeout(minuteur); aide.off('pret', surPret); aide.off('erreur', surErreur); erreur ? ko(erreur) : ok(); };
      const surPret = () => finir();
      const surErreur = () => finir(new Error('Aide Windows indisponible'));
      const minuteur = setTimeout(() => finir(new Error('Aide Windows indisponible')), delai);
      aide.on('pret', surPret); aide.on('erreur', surErreur);
    });
  }

  async function requete(cmd, params = {}) {
    await prete();
    const p = enfant, id = suivant++, delai = DELAIS[cmd] || 10000;
    if (!p) throw new Error('Aide Windows indisponible');
    return new Promise((ok, ko) => {
      const r = {id, cmd, p, delai, ok, ko, abandon: false, minuteur: null, attente: null};
      // En attente derrière une autre commande plus longtemps que son propre délai : abandonnée, sans tuer l'aide (elle y
      // répondra plus tard, réponse ignorée).
      r.attente = setTimeout(() => { if (file[0] !== r && !r.abandon) { r.abandon = true; ko(new Error('Aide Windows occupée')); } }, delai);
      file.push(r);
      if (file[0] === r) surveiller(r);
      p.stdin.write(JSON.stringify({...params, id, cmd}) + '\n');
    });
  }

  // {ck3, hwnd, rect, minimise, premierPlan, ecran:{w,h}} (+ repond, pid quand CK3 tourne).
  const etat = () => requete('etat');

  // Capture de la fenêtre CK3 : JPEG entier (1920 de large au plus) + zoom natif ~960x600 autour du curseur s'il est sur le jeu,
  // empreinte (576 octets : gris moyen d'une grille 32x18) et depuis quand la souris est immobile (immobileMs ; null si l'aide
// l'ignore encore : suivi de la souris commencé il y a moins de 0,5 s sans mouvement vu), durée du PrintWindow (msImpression).
  // options.jeton : encode l'aperçu gardé par l'aide (apercu()) au lieu d'imprimer CK3 à nouveau ; code 'perimee' s'il n'y est plus.
  // Erreurs : « CK3 n'est pas lancé », « CK3 est réduit », « Capture noire », « CK3 ne répond pas » (err.code garde le code brut).
  async function capturer(options = {}) {
    const t0 = Date.now();
    const params = {};
    for (const cle of ['qualite', 'largeurMax', 'zoomL', 'zoomH', 'jeton']) if (Number.isFinite(options[cle])) params[cle] = Math.round(options[cle]);
    const r = await requete('capturer', params);
    return {plein: Buffer.from(r.plein, 'base64'), zoom: r.zoom ? Buffer.from(r.zoom, 'base64') : null, curseur: r.curseur || null,
      curseurSurJeu: !!r.curseurSurJeu, zoneZoom: r.zoneZoom || null, largeur: r.largeur, hauteur: r.hauteur,
      largeurFenetre: r.largeurFenetre, hauteurFenetre: r.hauteurFenetre, ecartType: r.ecartType, moyenne: r.moyenne,
      signature: r.signature ? Buffer.from(r.signature, 'base64') : null, immobileMs: immobile(r.immobileMs),
      premierPlan: r.premierPlan, ms: Date.now() - t0, msAide: r.ms, msImpression: r.msImpression ?? null};
  }

  // Aperçu léger (regard pendant une question) : CK3 imprimé SANS encodage, l'image reste dans l'aide (jeton) ; rend l'empreinte,
  // la souris et immobileMs. CK3 pas au premier plan : {premierPlan: false}, rien n'est imprimé.
  async function apercu() {
    const t0 = Date.now();
    const r = await requete('apercu');
    return {premierPlan: !!r.premierPlan, signature: r.signature ? Buffer.from(r.signature, 'base64') : null, curseur: r.curseur || null,
      curseurSurJeu: !!r.curseurSurJeu, immobileMs: immobile(r.immobileMs), jeton: r.jeton ?? null,
      largeurFenetre: r.largeurFenetre ?? null, hauteurFenetre: r.hauteurFenetre ?? null, ms: Date.now() - t0, msAide: r.ms, msImpression: r.msImpression};
  }

  async function arreter() {
    arret = true; demarrage = null;
    attente?.ko(new Error('Aide Windows arrêtée')); attente = null;
    process.off('exit', tuer);
    const p = enfant;
    if (!p || p.exitCode !== null || p.signalCode !== null) return;
    await new Promise(ok => {
      // L'aide retire son crochet et part seule quand stdin se ferme ; sinon on la termine.
      const dur = setTimeout(() => { try { p.kill(); } catch {} }, 2000);
      const abandon = setTimeout(ok, 4000);
      p.once('exit', () => { clearTimeout(dur); clearTimeout(abandon); ok(); });
      p.stdin.end();
    });
  }

  Object.assign(aide, {
    demarrer, etat, capturer, apercu, arreter,
    liberer: () => requete('liberer'),         // oublie l'aperçu gardé (fin du regard)
    diagnostic: () => requete('diagnostic'),   // état du crochet : installé, appels, durée max du rappel (µs)
    banc: () => requete('banc'),               // banc d'essai de la décision du raccourci, sans toucher au clavier
    reinstaller: () => requete('reinstaller'), // essai : réinstallation du crochet (faite seule toutes les 5 min)
  });
  Object.defineProperties(aide, {
    pid: {get: () => enfant?.pid ?? null},      // PowerShell en cours (pour les essais)
    info: {get: () => info},                   // sa ligne {pret, pid, crochet, erreurCrochet, dpiProcessus}
    occupee: {get: () => file.some(r => IMPRESSIONS.includes(r.cmd))},   // capture en cours : l'état attendrait derrière elle
  });
  return aide;
}
