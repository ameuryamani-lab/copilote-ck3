// Essai de l'aide Windows du copilote CK3. Lancer : node essais/essai-aide.mjs
// Sans jamais envoyer de touche ni de clic, sans enregistrer ni envoyer aucune image (les captures restent en mémoire) :
// 1. démarrage + crochet clavier installé ; 2. état de CK3 ; 2 bis. suivi de la souris (immobilité inconnue au démarrage, jamais
// remise à zéro par un aperçu) ; 3. cinq captures (durée, tailles, écart-type, zoom, empreinte) ;
// 3 bis. aperçus légers du regard (durée, empreinte, souris immobile), encodage par jeton, jeton réutilisé refusé, libération ;
// 4. décision du raccourci (banc, dont le combo hors de CK3 laissé à l'appli), réinstallation du crochet, coût du rappel sur les
// vraies frappes ; 5. erreur « CK3 n'est pas lancé » (aide sans crochet, faux nom de processus) ; 5 bis. capture lente : l'état en
// attente derrière elle ne tue plus l'aide ; 6. relance après un arrêt brutal ; 7. Node tué : l'aide part seule ;
// 8. après arreter(), aucun PowerShell enfant ne reste.
import {spawn, execFile} from 'node:child_process';
import {writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {creerAideWindows} from '../aide-windows.mjs';

const ICI = fileURLToPath(import.meta.url);
const pause = ms => new Promise(ok => setTimeout(ok, ms));
const vivant = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
async function attendreMort(pid, ms) { const fin = Date.now() + ms; while (Date.now() < fin) { if (!vivant(pid)) return true; await pause(100); } return !vivant(pid); }

// Mode enfant (essai 7) : démarre une aide avec crochet, donne son pid, puis attend d'être tué sans rien ranger.
if (process.argv[2] === '--enfant') {
  const aide = creerAideWindows({journal: {log() {}, warn() {}, error() {}}});
  const info = await aide.demarrer();
  process.stdout.write(JSON.stringify({pid: aide.pid, crochet: info.crochet}) + '\n');
  setInterval(() => {}, 1e6);
} else await principal();

// Taille lue dans l'en-tête JPEG (marqueur SOF), sans décoder ni écrire l'image.
function tailleJpeg(b) {
  if (!b || b[0] !== 0xFF || b[1] !== 0xD8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xFF) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xFF || m === 0x01 || (m >= 0xD0 && m <= 0xD8)) { i += m === 0xFF ? 1 : 2; continue; }
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return {w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5)};
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

// PowerShell encore enfants de ce Node (hors celui qui fait la liste).
function enfantsPowershell() {
  const commande = `Get-CimInstance Win32_Process -Filter 'ParentProcessId=${process.pid}' | Where-Object { $_.ProcessId -ne $PID -and $_.Name -eq 'powershell.exe' } | ForEach-Object { $_.ProcessId }`;
  return new Promise(ok => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', commande], {windowsHide: true, timeout: 30000},
    (e, sortie) => ok(e ? null : sortie.split(/\s+/).filter(Boolean).map(Number))));
}

async function principal() {
  const essais = [], notes = [], pidsVus = new Set();
  const noter = (nom, reussi, details) => { essais.push({nom, reussi: !!reussi, details}); console.log(`${reussi ? 'OK  ' : 'ÉCHEC'} ${nom} : ${details}`); };
  const journal = {log: m => notes.push(m), warn: m => notes.push(m), error: m => notes.push(m)};
  let raccourcis = 0;

  // 1. Démarrage
  const aide = creerAideWindows({journal});
  aide.on('raccourci', () => raccourcis++);
  let t = Date.now();
  const info = await aide.demarrer();
  pidsVus.add(aide.pid);
  noter('démarrage', info.pret && aide.pid, `${Date.now() - t} ms, PowerShell ${aide.pid}, DPI par écran : ${info.dpiProcessus ? 'oui' : 'non (fil seulement)'}`);
  noter('crochet clavier installé', info.crochet, info.crochet ? 'WH_KEYBOARD_LL actif sur son propre fil' : `erreur Windows ${info.erreurCrochet}`);
  const souris1 = await aide.diagnostic(), tSouris1 = Date.now();

  // 2. État
  t = Date.now();
  const etat = await aide.etat();
  noter('état', typeof etat.ck3 === 'boolean' && etat.ecran?.w > 0, `${Date.now() - t} ms, ${JSON.stringify(etat)}`);

  // 2 bis. Souris (suivie en permanence, lecture seule) : immobilité inconnue (-1) juste après le démarrage, sauf si la souris a
  // bougé ; connue après 0,5 s ; et un aperçu (même refusé : CK3 absent) ne la remet plus à zéro, pour que l'info-bulle survolée
  // AVANT l'appui compte. Si quelqu'un bouge la souris pendant l'essai, la dernière valeur est seulement plus petite que l'écart.
  await pause(Math.max(0, 700 - (Date.now() - tSouris1)));
  const souris2 = await aide.diagnostic(), tSouris2 = Date.now();
  await aide.apercu().catch(() => null);
  await pause(150);
  const souris3 = await aide.diagnostic(), ecartSouris = Date.now() - tSouris2;
  const bougee = souris3.immobileMs < ecartSouris;
  noter('souris : immobilité inconnue au démarrage, connue ensuite, jamais remise à zéro par un aperçu',
    (souris1.immobileMs === -1 || (souris1.immobileMs >= 0 && souris1.immobileMs < 500)) && souris2.immobileMs >= 0 && (bougee || souris3.immobileMs >= souris2.immobileMs + 100),
    `juste après le démarrage ${souris1.immobileMs} ms, 0,7 s plus tard ${souris2.immobileMs} ms, après un aperçu ${souris3.immobileMs} ms${bougee ? ' (souris bougée entre-temps)' : ''}`);

  // 3. Cinq captures, en mémoire seulement
  if (etat.ck3 && !etat.minimise) {
    const mesures = [];
    for (let i = 0; i < 5; i++) {
      let c = await aide.capturer();
      const dims = tailleJpeg(c.plein), dimsZoom = tailleJpeg(c.zoom);
      mesures.push({ms: c.ms, msAide: c.msAide, ko: Math.round(c.plein.length / 1024), dims: dims && `${dims.w}x${dims.h}`, annonce: `${c.largeur}x${c.hauteur}`,
        ecartType: c.ecartType, zoom: dimsZoom ? `${dimsZoom.w}x${dimsZoom.h} (${Math.round(c.zoom.length / 1024)} Ko)` : null, curseur: c.curseur, premierPlan: c.premierPlan,
        signature: c.signature?.length ?? null});
      c = null;   // l'image n'est ni gardée ni écrite
      await pause(150);
    }
    const bonnes = mesures.every(m => m.dims && m.dims === m.annonce && m.ecartType >= 2 && m.ms < 2000 && m.ko > 10 && m.signature === 576);
    const msMoy = Math.round(mesures.reduce((s, m) => s + m.ms, 0) / mesures.length);
    noter('5 captures de CK3', bonnes, `moyenne ${msMoy} ms aller-retour ; ${mesures.map(m => `${m.ms} ms (aide ${m.msAide}) ${m.dims} ${m.ko} Ko écart-type ${m.ecartType} zoom ${m.zoom || 'aucun'} curseur ${m.curseur ? m.curseur.x + ',' + m.curseur.y : 'hors jeu'} empreinte ${m.signature ?? 'ABSENTE'} o`).join(' | ')}`);

    // 3 bis. Regard pendant une question (07/10/2026) : aperçus légers (impression + empreinte, sans JPEG), puis encodage de
    // l'aperçu gardé par son jeton (même empreinte, sans second PrintWindow), jeton réutilisé refusé, aperçu libéré.
    const apercus = [];
    for (let i = 0; i < 6; i++) {
      t = Date.now();
      const a = await aide.apercu();
      apercus.push({...a, rt: Date.now() - t});
      await pause(700);   // rythme du regard : ≤ 1,5 aperçu par seconde
    }
    const devant = apercus.filter(a => a.premierPlan);
    if (devant.length) {
      const a = await aide.apercu();
      t = Date.now();
      const k = await aide.capturer({jeton: a.jeton, qualite: 75}).catch(e => ({erreur: e.code || e.message}));
      const msEnc = Date.now() - t;
      const reutilise = await aide.capturer({jeton: a.jeton}).then(() => 'acceptée', e => e.code);
      await aide.apercu();
      const libere = await aide.liberer();
      const moy = l => Math.round(l.reduce((s, x) => s + x, 0) / l.length);
      noter('aperçus légers et encodage par jeton', devant.every(x => x.signature?.length === 576 && x.rt < 1000) && !k.erreur && k.signature?.equals(a.signature) && reutilise === 'perimee' && libere.libere === true,
        `${devant.length}/6 aperçus avec CK3 devant : ${moy(devant.map(x => x.rt))} ms aller-retour en moyenne (impression ${moy(devant.map(x => x.msImpression))} ms, max ${Math.max(...devant.map(x => x.rt))}), `
        + `souris immobile ${devant.map(x => x.immobileMs).join('/')} ms ; encodage du jeton ${k.erreur || `${msEnc} ms aller-retour (aide ${k.msAide} ms), ${Math.round(k.plein.length / 1024)} Ko + zoom ${k.zoom ? Math.round(k.zoom.length / 1024) + ' Ko' : 'aucun'}, même empreinte : ${k.signature?.equals(a.signature) ? 'oui' : 'NON'}`} ; jeton réutilisé → ${reutilise} ; libéré : ${libere.libere}`);
    } else noter('aperçus légers et encodage par jeton', apercus.every(a => !a.premierPlan && !a.signature), 'CK3 n\'est pas au premier plan : rien n\'est imprimé (vérifié), encodage non essayé');
  } else {
    noter('5 captures de CK3', false, etat.ck3 ? 'CK3 est réduit : captures non faites' : 'CK3 ne tourne pas : captures non faites');
  }

  // 4. Raccourci : décision testée sur une instance à part (aucune touche envoyée), coût mesuré
  const banc = await aide.banc();
  noter('décision Ctrl+Maj+Espace (banc)', banc.echecs.length === 0 && banc.nsDecision < 1000 && banc.nsPremierPlan < 200000,
    `${banc.cas} cas (dont combo hors de CK3 laissé à l'appli), échecs : ${banc.echecs.length ? banc.echecs.join(', ') : 'aucun'} ; décision ${banc.nsDecision} ns, lecture Ctrl/Maj/Alt ${banc.nsTroisTouches} ns, test du premier plan ${Math.round(banc.nsPremierPlan / 100) / 10} µs (CK3 devant : ${banc.jeuDevant ? 'oui' : 'non'})`);

  // 5. Erreur « CK3 n'est pas lancé » : seconde aide sans crochet, avec un nom de processus qui n'existe pas
  const factice = creerAideWindows({journal, processus: 'processus-absent-copilote', crochet: false});
  await factice.demarrer();
  pidsVus.add(factice.pid);
  const etatFactice = await factice.etat();
  let message = null, code = null;
  try { await factice.capturer(); } catch (e) { message = e.message; code = e.code; }
  await factice.arreter();
  noter('erreur sans CK3', etatFactice.ck3 === false && etatFactice.rect === null && message === 'CK3 n\'est pas lancé',
    `état ck3=${etatFactice.ck3}, capturer() → « ${message} » (code ${code})`);

  // 5 bis. Capture lente (CK3 figé quelques secondes) : l'état demandé derrière elle est abandonné après 5 s SANS tuer l'aide,
  // et la capture aboutit. Fausse aide en PowerShell (capture de 7 s), sans crochet, sans fenêtre.
  const lent = path.join(os.tmpdir(), `copilote-aide-lente-${process.pid}.ps1`);
  await writeFile(lent, `param([string]$Processus, [switch]$SansCrochet)
[Console]::Out.WriteLine('{"pret":true,"crochet":false,"erreurCrochet":0,"pid":' + $PID + '}'); [Console]::Out.Flush()
while ($null -ne ($l = [Console]::In.ReadLine())) {
  $id = [regex]::Match($l, '"id":(\\d+)').Groups[1].Value
  if ($l -match '"cmd":"capturer"') { Start-Sleep -Milliseconds 7000; [Console]::Out.WriteLine('{"id":' + $id + ',"ok":false,"code":"pas-lance","erreur":"lent"}') }
  else { [Console]::Out.WriteLine('{"id":' + $id + ',"ok":true,"res":{"ck3":false}}') }
  [Console]::Out.Flush()
}
`);
  const lente = creerAideWindows({journal, crochet: false, script: lent});
  await lente.demarrer();
  const pidLent = lente.pid;
  pidsVus.add(pidLent);
  t = Date.now();
  const quand = {};
  const [rCapture, rEtat] = await Promise.all([
    lente.capturer().then(() => 'ok', e => e.message).finally(() => { quand.capture = Date.now() - t; }),
    lente.etat().then(() => 'ok', e => e.message).finally(() => { quand.etat = Date.now() - t; })]);
  const etatApres = await lente.etat().catch(e => ({erreur: e.message}));
  noter('capture lente : l\'état en attente ne tue plus l\'aide', rCapture === 'CK3 n\'est pas lancé' && rEtat === 'Aide Windows occupée' && lente.pid === pidLent && etatApres.ck3 === false,
    `capture → « ${rCapture} » à ${quand.capture} ms, état en file → « ${rEtat} » à ${quand.etat} ms, même PowerShell : ${lente.pid === pidLent ? 'oui' : 'NON'}, état suivant ${etatApres.erreur || 'lu'}`);
  await lente.arreter();
  await rm(lent, {force: true});

  // 6. Relance automatique après un arrêt brutal de l'aide
  const ancien = aide.pid;
  t = Date.now();
  const relance = new Promise(ok => aide.once('pret', ok));
  process.kill(ancien);
  await Promise.race([relance, pause(15000)]);
  pidsVus.add(aide.pid);
  let etat2 = null;
  try { etat2 = await aide.etat(); } catch {}
  const crochet2 = (await aide.diagnostic().catch(() => ({}))).crochet;
  noter('relance automatique', aide.pid && aide.pid !== ancien && !vivant(ancien) && etat2 && crochet2,
    `PowerShell ${ancien} tué → ${aide.pid} prêt en ${Date.now() - t} ms, état ${etat2 ? 'lu' : 'illisible'}, crochet ${crochet2 ? 'réinstallé' : 'absent'}`);

  // 7. Node tué net (sans rien ranger) : son aide voit stdin se fermer et part seule, crochet compris
  const enfant = spawn(process.execPath, [ICI, '--enfant'], {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  const ligne = await new Promise(ok => { let s = ''; enfant.stdout.on('data', d => { s += d; if (s.includes('\n')) ok(s); }); setTimeout(() => ok(s), 20000); });
  let orpheline = null;
  try { orpheline = JSON.parse(ligne); } catch {}
  if (orpheline?.pid) {
    pidsVus.add(orpheline.pid);
    t = Date.now();
    enfant.kill();   // TerminateProcess : aucun gestionnaire 'exit' ne tourne dans l'enfant
    const partie = await attendreMort(orpheline.pid, 5000);
    noter('aide orpheline', partie && orpheline.crochet, `Node enfant tué, son aide ${orpheline.pid} (crochet ${orpheline.crochet ? 'actif' : 'absent'}) ${partie ? `partie seule en ${Date.now() - t} ms` : 'TOUJOURS VIVANTE'}`);
  } else {
    enfant.kill();
    noter('aide orpheline', false, `l'enfant n'a pas donné le pid de son aide (${ligne.slice(0, 200)})`);
  }

  // 4 ter. Réinstallation du crochet (Windows retire en silence un crochet qui a tardé ; l'aide le remet toutes les 5 min)
  const avantReinst = await aide.diagnostic();
  await aide.reinstaller();
  await pause(200);
  const apresReinst = await aide.diagnostic();
  noter('réinstallation du crochet', apresReinst.crochet && apresReinst.reinstallations === avantReinst.reinstallations + 1,
    `réinstallations ${avantReinst.reinstallations} → ${apresReinst.reinstallations}, crochet ${apresReinst.crochet ? 'actif' : 'absent'}`);

  // 4 bis. Coût réel du rappel du crochet sur les frappes d'Ameur pendant l'essai (aucune frappe simulée).
  // ESSAI_ATTENTE_S allonge l'écoute pour avoir de vraies frappes (4 s par défaut).
  await pause(Math.max(1, Number(process.env.ESSAI_ATTENTE_S) || 4) * 1000);
  const diag = await aide.diagnostic();
  noter('rappel du crochet rapide', diag.crochet && (diag.appels === 0 || diag.microMax < 1000),
    (diag.appels ? `${diag.appels} touches vues depuis la relance, rappel moyen ${diag.microMoyen} µs, max ${diag.microMax} µs (Windows tolère ~300 à 1000 ms) ; Espace : ${diag.espaces}, avalées : ${diag.avales}, combos laissés à une autre appli : ${diag.horsJeu}`
      : 'aucune touche frappée depuis la relance : coût réel non mesuré, voir le banc ci-dessus') + ` ; CK3 au premier plan maintenant : ${diag.premierPlanJeu ? 'oui' : 'non'}`);

  // 8. Arrêt : plus aucun PowerShell enfant
  const dernier = aide.pid;
  t = Date.now();
  await aide.arreter();
  const msArret = Date.now() - t;
  const survivants = [...pidsVus].filter(pid => pid && vivant(pid));
  const enfants = await enfantsPowershell();
  noter('arrêt propre', survivants.length === 0 && enfants && enfants.length === 0,
    `arreter() en ${msArret} ms (PowerShell ${dernier}) ; pids suivis encore vivants : ${survivants.length ? survivants.join(', ') : 'aucun'} ; PowerShell enfants : ${enfants ? (enfants.length ? enfants.join(', ') : 'aucun') : 'liste impossible'}`);

  if (raccourcis) console.log(`(${raccourcis} événement(s) raccourci reçus pendant l'essai : Ctrl+Maj+Espace a été pressé)`);
  if (notes.length) console.log(`Journal de l'aide :\n  ${notes.join('\n  ')}`);
  const reussi = essais.every(e => e.reussi);
  console.log(JSON.stringify({reussi, essais}));
  process.exit(reussi ? 0 : 1);
}
