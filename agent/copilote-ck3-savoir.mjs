// Savoir du copilote CK3 (06/10/2026, décision d'Ameur : CK3 seulement pour l'instant). Tout ce qui est propre à Crusader
// Kings III est ici, pour que agent/copilote-jeu.mjs reste général. La source de vérité est l'installation d'Ameur :
// l'Encyclopédie du jeu (concepts, leçons du tutoriel, conseils) est dans game\localization\english, exacte pour SA version,
// alors que les guides du web et la mémoire des modèles datent d'avant la 1.20. L'index est mis en cache dans
// memoire/copilote-ck3/savoir-<version>.json et refait tout seul quand Steam met le jeu à jour (rawVersion change).
// Le jeu est cherché (10/10/2026) par COPILOTE_CK3_DIR, puis le registre de Steam, puis les dossiers par défaut : voir trouverJeu.
import {readFile, writeFile, readdir, mkdir, access} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import path from 'node:path';

const FORMAT = 6;   // à augmenter quand la forme du cache change : l'ancien cache est alors refait
const NOM_JEU = 'Crusader Kings III';

// Fonction réservée -> extension (requires_dlc_flag / has_dlc_feature des fichiers du jeu). Les .dlc ne listent pas leurs
// fonctions (c'est dans ck3.exe) : la correspondance est tenue ici à la main. accolades est dans 04_ep2 = Tours and Tournaments.
const FLAGS_DLC = {
  the_northern_lords: 'The Northern Lords', royal_court: 'The Royal Court', court_artifacts: 'The Royal Court',
  diverge_culture: 'The Royal Court', hybridize_culture: 'The Royal Court', the_fate_of_iberia: 'The Fate of Iberia',
  friends_and_foes: 'Friends and Foes', tours_and_tournaments: 'Tours and Tournaments', advanced_activities: 'Tours and Tournaments',
  accolades: 'Tours and Tournaments', wards_and_wardens: 'Wards and Wardens', legacy_of_persia: 'Legacy of Persia',
  legends: 'Legends of the Dead', legends_of_the_dead: 'Legends of the Dead', roads_to_power: 'Roads to Power',
  admin_gov: 'Roads to Power', landless_playable: 'Roads to Power', wandering_nobles: 'Wandering Nobles',
  khans_of_the_steppe: 'Khans of the Steppe', coronations: 'Coronations', all_under_heaven: 'All Under Heaven', by_god_alone: 'By God Alone',
};
// Conseils et leçons propres à une extension (préfixe du fichier de tutoriel).
const TUTORIEL_DLC = {ep1: 'royal_court', fp2: 'the_fate_of_iberia', ep4: 'all_under_heaven', china: 'all_under_heaven'};
// Fichiers de notions d'une extension où le jeu ne marque AUCUNE notion (requires_dlc_flag absent), relevé du 06/10/2026 sur la
// 1.20.0.4 : 07_ep3 (Roads to Power) 0 sur 64, mpo (Khans of the Steppe) 0 sur 46, 06_ce1 (Legends of the Dead) 0 sur 21. Ces
// notions sont présumées liées à l'extension (étiquette prudente, « à vérifier à l'écran »), sauf celles venues avec la mise à jour
// gratuite de la même sortie : épidémies, légitimité et tâches des postes de cour (ce1) ; confédérations, tributaires et système
// des situations (mpo : 00_alliance.txt et 00_tributary_interactions.txt ne testent pas l'extension).
const FICHIER_DLC = {'07_ep3': 'roads_to_power', mpo: 'khans_of_the_steppe', '06_ce1': 'legends_of_the_dead'};
const NOTIONS_GRATUITES = new Set(['infection_rate', 'epidemic_resistance', 'infection_chance', 'fatalities', 'plague_intensity', 'legitimacy',
  'legitimacy_level', 'expected_legitimacy', 'initial_legitimacy', 'court_position_task', 'confederation', 'confederate', 'overlord', 'suzerain',
  'tributary', 'subject', 'tributary_taxes', 'suzerain_taxes', 'situation', 'situation_sub_region', 'situation_phase', 'situation_participant_group',
  'situation_catalyst']);
// Mots d'Ameur à l'oral -> notions du jeu, quand la traduction officielle ne les contient pas (le lexique tiré du jeu ne connaît
// que les mots de l'interface française). Motifs appliqués à la question normalisée (minuscules, sans accents ni apostrophes).
const SYNONYMES_ORAUX = [
  [/ (argent|sous|fric|thune|richesses?|tresor|tresorerie) /, 'Gold'],
  [/ (revenus?|rentrees d argent) /, 'Income'],
  [/ (moyens? de pression|levier|chantage) /, 'Hook'],
  [/ (deven\w*|deviens|devient) (roi|reine|empereur|imperatrice|duc|duchesse) /, 'Title Creation'],
  [/ (cre\w*|fond\w*|form\w*|usurp\w*) (un |une |le |la |l |mon |ma )?(royaume|empire|duche|titre) /, 'Title Creation'],
  [/ (impots?|taxes?) /, 'Taxes'],
];
// Entrées du lexique trop vagues à l'oral : « gagner » (Win) dans « gagner de l'or », « contre » (Counter) dans « la guerre
// contre », « jeu » (Game) dans « dans le jeu »...
const LEXIQUE_IGNORE = new Set(['gagner', 'creer', 'regarder', 'decider', 'prepare', 'comporter', 'super', 'augmenter', 'mesure', 'contre', 'jeu',
  'interagir', 'attire', 'glisser', 'histoire', 'inspire', 'celebre']);
// Seuil de pertinence des extraits (réglé le 06/10/2026 sur des questions réelles) : une entrée doit atteindre 35 % de la
// meilleure note, et toucher une notion du lexique ou des termes de l'écoute, sinon dépasser un plancher absolu.
const PART_DE_LA_MEILLEURE = 0.35, PLANCHER = 6;

// Notes tenues à la main (vérifiées le 06/10/2026 sur le journal officiel de la 1.20 et les raccourcis du jeu) : la mémoire des
// modèles s'arrête avant la 1.20, et l'habillage chrétien de l'interface est PAYANT, donc absent de l'écran d'Ameur.
// La ligne sur By God Alone suit la détection des extensions (achat possible à tout moment) : voir ecrireNotesVersion().
const NOTES_VERSION = `Notes de version (tenues à la main le 06/10/2026 pour la 1.20.0.4) :
- 1.20 « Crozier » (mise à jour gratuite du 30/09/2026, correctifs 1.20.0.3 le 01/10 et 1.20.0.4 le 06/10 ; la 1.20.1 est en préparation). Gratuit : chaque branche ou école d'une foi devient un Rite, avec un Head of Rite sous le Head of Faith ; « State Faith » s'appelle maintenant State Rite ; hérésies quand la Fervor d'une foi passe sous 40 (décision Declare a Rite Heretical) ; excommunication revue (coût en Piety selon le rang, le trait Excommunicated divise par deux les gains de Piety) ; Personal Tenets (principes personnels) et Spiritual Fulfillment (épanouissement spirituel), fenêtre Personal Beliefs ouverte depuis le HUD (Ctrl+Alt+R) ; Holy Orders séparés en Monastic Orders et Military Orders ; Holy Sites revus (Eminent Holy Sites, reliques à enchâsser) ; Antipopes et casus belli Challenge Head of Faith ; schemes Study Faith et Find Adherent of Faith ; raccourcis du HUD : Alt+R pour la foi (Rite), Alt+T pour la culture, le bouton Rite est maintenant au-dessus de Culture.
- Renommage 1.20 : l'interaction de Power Sharing « Siphon Treasury » s'appelle maintenant Skim the Coffers (pour ne plus se confondre avec le scheme du même nom).
- 1.19 « Scribe » (gratuite, 20/04/2026) : nouveau Ledger (registre, Maj+F1) ; la Domain Limit dépend maintenant des traits d'éducation et plus directement de la Stewardship ; refonte des accolades (qui demandent Tours and Tournaments) ; traits de vieillesse par paliers ; onglet des Stories et Situations ; plus de 800 raccourcis clavier.
- §BGA§
- Raccourcis utiles : Espace = pause ; F1 personnage, F2 royaume (Realm), F3 armée, F4 conseil, F5 cour, F6 intrigue, F7 factions, F8 décisions, F9 activités, F10 Encyclopédie (avec recherche), 0 situations, C recherche de personnage. Les info-bulles se verrouillent après 1,5 s (Timer Lock) et s'emboîtent : survoler un mot souligné ouvre sa définition.`;

const BGA_FONCTIONS = 'la situation Christian Church, les théocraties jouables, les cardinaux et le conclave, les Papal Bulls, les Ecumenical Councils, les Puppets (fantoches), la Grand Cathedral, le Great Schism jouable et l\'habillage chrétien de l\'interface (onglet principal du HUD, lettres, boutons latéraux)';
const ecrireNotesVersion = (bga, j) => NOTES_VERSION.replace('§BGA§', bga
  ? `By God Alone est l'extension payante sortie avec la 1.20, et ${j.fr.nom} l'a : elle apporte ${BGA_FONCTIONS}.`
  : `By God Alone est l'extension PAYANTE sortie avec la 1.20 : ${j.fr.nom} ne l'a PAS. Elle apporte ${BGA_FONCTIONS}. Son écran ne ressemble donc pas aux vidéos et captures de la 1.20 faites avec cette extension.`);

// Nom du joueur dans tout ce qui est envoyé au modèle (06/10/2026, publication sur GitHub) : « le joueur » / « the player » par
// défaut, ou le prénom donné par COPILOTE_PRENOM (Ameur peut y remettre le sien). Formes toutes faites, élision comprise
// (« d'Ameur », « qu'Ameur »). Le prénom est filtré (lettres, espace, tiret, apostrophe) : il entre tel quel dans les consignes.
export function formesJoueur(prenom) {
  const p = String(prenom || '').replace(/[^\p{L}\p{M} '’-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!p) return {prenom: null, fr: {nom: 'le joueur', de: 'du joueur', que: 'que le joueur'}, en: {nom: 'the player', Nom: 'The player', de: 'the player\'s', De: 'The player\'s'}};
  const voyelle = /^[aeiouyhàâäéèêëîïôöûüœæ]/i.test(p);
  return {prenom: p, fr: {nom: p, de: (voyelle ? 'd\'' : 'de ') + p, que: (voyelle ? 'qu\'' : 'que ') + p}, en: {nom: p, Nom: p, de: `${p}'s`, De: `${p}'s`}};
}

// En-tête construit d'après les extensions installées (voir chargerSavoirCk3).
const FONCTIONS_EXTENSIONS = `- The Royal Court : salle du trône et Hold Court (audiences), Court Grandeur et commodités de la cour, artefacts et inspirations, création de cultures (diverger, hybrider).
- The Northern Lords : contenu nordique (Scandinavie, pierres runiques, aventures varègues).
- The Fate of Iberia : la Struggle ibérique et le contenu de la péninsule.
- Friends and Foes : souvenirs des personnages et événements d'amitié et de rivalité.
- Tours and Tournaments : grandes activités (tournois, Grand Weddings, Grand Tours) et accolades (chevaliers acclamés).
- Wards and Wardens : pupilles et tuteurs, éducation des enfants dirigeants.
- Legacy of Persia : la Struggle iranienne et le contenu perse.
- Legends of the Dead : les Legends (légendes à créer et propager).
- Roads to Power : gouvernement administratif (Byzance, familles nobles, Influence), personnages sans terre jouables (aventuriers, mercenaires).
- Wandering Nobles : voyages, activités et styles de vie enrichis.
- Khans of the Steppe : gouvernement nomade de la steppe, migrations.
- Coronations : cérémonies de couronnement.
- All Under Heaven : Asie de l'Est (Chine, Japon, Mandate of Heaven).
- By God Alone : Christian Church, théocraties jouables, cardinaux, Papal Bulls, Ecumenical Councils, Puppets, Grand Cathedral, habillage chrétien de l'interface.
- Les autres (Garments of the Holy Roman Empire, Fashion of the Abbasid Court, Elegance of the Empire, packs Attire, Couture of the Capets, Crowns of the World, Medieval Monuments, Holy Buildings, East Asian Wonders, Symbols of Authority, Songs of the Realm) sont des packs de vêtements, de bâtiments ou de musique, sans fonction de jeu.`;

// Mots vides anglais (textes du jeu) et français (questions d'Ameur) : séparés, car « or » est un mot vide en anglais mais la
// notion Gold (« Or ») en français.
const MOTS_VIDES_EN = new Set('a an and are as at be by can do does for from has have how i if in into is it its me my not of on or so that the their them then there this to was what when where which who why will with you your'.split(' '));
const MOTS_VIDES_FR = new Set('au aux avec ce ces cet cette comment dans de des du elle en est et faire fais fait il je la le les leur lui ma mais me mes moi mon ne nous on ou par pas pour pourquoi qu que quel quelle qui quoi sa se ses son sur ta te tes toi ton tu un une vous y est-ce veux peux dois plus'.split(' '));
const MOTS_VIDES = new Set([...MOTS_VIDES_EN, ...MOTS_VIDES_FR]);   // index des textes du jeu
const sansAccents = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const normaliser = s => sansAccents(String(s).toLowerCase()).replace(/['’]s\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// Racine grossière (pluriels anglais) : « truces » et « truce », « hooks » et « hook » tombent sur le même mot.
function racine(m) {
  if (m.length > 4 && m.endsWith('ies')) return m.slice(0, -3) + 'y';
  if (m.length > 4 && /(ches|shes|sses|xes)$/.test(m)) return m.slice(0, -2);
  if (m.length > 3 && m.endsWith('s') && !m.endsWith('ss') && !m.endsWith('us')) return m.slice(0, -1);
  return m;
}
const mots = (texte, vides = MOTS_VIDES) => normaliser(texte).split(' ').filter(m => m.length > 1 && !vides.has(m)).map(racine);

async function existe(f) { try { await access(f); return true; } catch { return false; } }
async function fichiers(dossier, filtre) {
  const tous = [];
  for (const e of await readdir(dossier, {withFileTypes: true, recursive: true}).catch(() => [])) {
    const f = path.join(e.parentPath ?? e.path, e.name);
    if (e.isFile() && filtre(f)) tous.push(f);
  }
  return tous;
}

// Steam d'après le registre, par reg.exe (aucun module tiers) : HKCU SteamPath (barres obliques « c:/program files (x86)/steam »,
// normalisées), repli HKLM 32 bits InstallPath. Registre illisible ou pas Windows : liste vide.
async function steamsDuRegistre() {
  if (process.platform !== 'win32') return [];
  const lire = (cle, valeur) => new Promise(ok => execFile('reg.exe', ['query', cle, '/v', valeur], {windowsHide: true, timeout: 5000},
    (e, sortie) => { const m = !e && String(sortie).match(new RegExp(`${valeur}\\s+REG_SZ\\s+(.+)`, 'i')); ok(m ? path.normalize(m[1].trim()) : null); }));
  return (await Promise.all([lire('HKCU\\Software\\Valve\\Steam', 'SteamPath'), lire('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath')])).filter(Boolean);
}
const estLeJeu = d => existe(path.join(d, 'launcher', 'launcher-settings.json'));

// Dossier du jeu (ordre du 10/10/2026, test ECC : Steam hors de Program Files perdait l'Encyclopédie en silence) : dossierForce
// (COPILOTE_CK3_DIR, accepté seulement s'il contient launcher\launcher-settings.json, sinon erreur claire), puis chaque Steam du
// registre, puis les dossiers par défaut, et dans chacun ses bibliothèques (libraryfolders.vdf). Rien : rejet (code
// 'jeu-introuvable', steams regardés) ; plus jamais un dossier par défaut présumé.
async function trouverJeu(dossierForce = null) {
  const force = String(dossierForce || '').trim();
  if (force) {
    if (await estLeJeu(force)) return force;
    throw Object.assign(new Error(`COPILOTE_CK3_DIR=${force} : pas de launcher\\launcher-settings.json dans ce dossier (il doit être celui de Crusader Kings III)`), {code: 'dossier-force', dossier: force});
  }
  const steams = [...await steamsDuRegistre(), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Steam'), 'C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam']
    .filter(Boolean).map(s => path.normalize(s));
  const uniques = [...new Map(steams.map(s => [s.toLowerCase().replace(/[\\/]+$/, ''), s])).values()];
  const vus = [];
  for (const steam of uniques) {
    const vdf = await readFile(path.join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf8').catch(() => '');
    if (!vdf && !await existe(steam)) continue;   // dossier absent : pas regardé
    vus.push(steam);
    const bibliotheques = [...vdf.matchAll(/"path"\s+"([^"]+)"/g)].map(m => m[1].replace(/\\\\/g, '\\'));
    for (const b of [steam, ...bibliotheques]) {
      const d = path.join(b, 'steamapps', 'common', NOM_JEU);
      if (await estLeJeu(d)) return d;
    }
  }
  throw Object.assign(new Error(`Crusader Kings III introuvable (Steam regardés : ${vus.join(' ; ') || 'aucun'}) : indique son dossier dans COPILOTE_CK3_DIR`), {code: 'jeu-introuvable', steams: vus});
}

export async function versionInstallee(dossierJeu) {
  const j = JSON.parse((await readFile(path.join(dossierJeu, 'launcher', 'launcher-settings.json'), 'utf8')).replace(/^\uFEFF/, ''));
  return {version: j.rawVersion, nom: j.version};
}

// Extensions possédées : les .dlc présents dans game\dlc ; toutes : game\dlc_metadata.
async function extensionsInstallees(dossierJeu) {
  const possedees = [];
  for (const f of await fichiers(path.join(dossierJeu, 'game', 'dlc'), f => f.endsWith('.dlc'))) {
    const nom = (await readFile(f, 'utf8')).match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
    if (nom) possedees.push(nom);
  }
  const meta = await readFile(path.join(dossierJeu, 'game', 'dlc_metadata', '00_dlc_metadata.txt'), 'utf8').catch(() => '');
  const toutes = [...meta.matchAll(/^\s*key\s*=\s*"([^"]+)"/gm)].map(m => m[1]);
  return {possedees, manquantes: toutes.filter(n => !possedees.includes(n))};
}

// Fichiers de traduction Paradox : « clé:0 "texte" », UTF-8 avec BOM.
async function chargerLocalisation(dossier, filtreFichier = () => true, filtreCle = () => true) {
  const loc = new Map();
  for (const f of await fichiers(dossier, f => f.endsWith('.yml') && filtreFichier(f))) {
    for (const ligne of (await readFile(f, 'utf8')).split(/\r?\n/)) {
      const m = ligne.match(/^\s*([A-Za-z0-9_.\-']+):\d*\s*"(.*)"\s*(?:#[^"]*)?$/);
      if (m && filtreCle(m[1])) loc.set(m[1], m[2]);
    }
  }
  return loc;
}

// Balises Paradox -> texte simple : [vassal|E], [Concept('x','Y')|E], $VAR$, #bold ...#!, @icone!, [GetX...], \n.
function nettoyer(texte, loc, profondeur = 0) {
  if (texte == null) return '';
  let t = String(texte).replace(/\\n/g, '\n').replace(/\\"/g, '"');
  t = t.replace(/\$([A-Za-z0-9_.\-]+)(\|[^$]*)?\$/g, (_, cle) => profondeur < 4 && loc.has(cle) ? nettoyer(loc.get(cle), loc, profondeur + 1) : '');
  t = t.replace(/\[Concept\(\s*'[^']*'\s*,\s*'([^']*)'\s*\)[^\]]*\]/g, '$1');
  t = t.replace(/\[([a-z0-9_]+)\|[A-Za-z]+\]/g, (_, c) => {
    const titre = profondeur < 4 && loc.get(`game_concept_${c}`);
    return titre ? nettoyer(titre, loc, profondeur + 1) : c.replace(/_/g, ' ');
  });
  t = t.replace(/\[[^\]]*\]/g, '…');
  t = t.replace(/#!/g, '').replace(/#(?:[A-Za-z_0-9]+;?)+ ?/g, '').replace(/@[A-Za-z0-9_]+!/g, '');
  return t.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Concepts de l'Encyclopédie : common\game_concepts\*.txt (nom, alias, extension requise).
async function definitionsConcepts(dossierJeu) {
  const defs = new Map();
  for (const f of await fichiers(path.join(dossierJeu, 'game', 'common', 'game_concepts'), f => f.endsWith('.txt'))) {
    const dlcFichier = FICHIER_DLC[path.basename(f).replace(/_game_concepts\.txt$/, '')] || null;
    const src = (await readFile(f, 'utf8')).replace(/^\uFEFF/, '').replace(/#[^\n]*/g, '');
    let i = 0;
    while (i < src.length) {
      const m = /([A-Za-z0-9_]+)\s*=\s*\{/y; m.lastIndex = i;
      const r = m.exec(src);
      if (!r) { i++; continue; }
      let prof = 1, j = m.lastIndex;
      while (j < src.length && prof > 0) { if (src[j] === '{') prof++; else if (src[j] === '}') prof--; j++; }
      const corps = src.slice(m.lastIndex, j - 1);
      const flag = corps.match(/requires_dlc_flag\s*=\s*([A-Za-z0-9_]+)/)?.[1] || null;
      // deduit : extension supposée d'après le fichier (le jeu ne la marque pas) ; l'étiquette donnée au modèle est alors prudente.
      const deduit = !flag && dlcFichier && !NOTIONS_GRATUITES.has(r[1]);
      defs.set(r[1], {alias: (corps.match(/alias\s*=\s*\{([^}]*)\}/)?.[1] || '').split(/\s+/).filter(Boolean),
        dlc: flag || (deduit ? dlcFichier : null), deduit: !!deduit});
      i = j;
    }
  }
  return defs;
}

async function construire(dossierJeu, version, journal) {
  const t0 = Date.now();
  const dossierLoc = path.join(dossierJeu, 'game', 'localization');
  // Dossier des textes absent (installation incomplète, chemin faux) : erreur claire tout de suite, pas un index vide en silence
  // (readdir rend [] sur un dossier absent : fichiers() ne s'en plaint pas).
  if (!await existe(path.join(dossierLoc, 'english'))) throw new Error(`Encyclopédie illisible : ${path.join(dossierLoc, 'english')} est absent`);
  const loc = await chargerLocalisation(path.join(dossierLoc, 'english'));
  const defs = await definitionsConcepts(dossierJeu);
  const entrees = [], vus = new Set();
  const ajouter = e => { if (!e.texte || e.texte.length < 40 || vus.has(e.texte)) return; vus.add(e.texte); entrees.push(e); };

  // 1. Concepts : titre game_concept_X, texte game_concept_X_desc.
  const noms = new Set([...defs.keys()]);
  for (const cle of loc.keys()) { const m = cle.match(/^game_concept_(.+)_desc$/); if (m && loc.has(`game_concept_${m[1]}`)) noms.add(m[1]); }
  const parExtension = {};
  for (const nom of noms) {
    const def = defs.get(nom) || {alias: [], dlc: null, deduit: false};
    const titre = nettoyer(loc.get(`game_concept_${nom}`), loc);
    if (def.dlc && titre) (parExtension[def.dlc] ??= []).push(titre);
    if (!loc.has(`game_concept_${nom}_desc`) || !titre) continue;
    const alias = [...new Set(def.alias.map(a => nettoyer(loc.get(`game_concept_${a}`), loc)).filter(a => a && a !== titre))];
    ajouter({cle: `concept:${nom}`, type: 'concept', titre, alias, dlc: def.dlc, deduit: def.deduit, texte: nettoyer(loc.get(`game_concept_${nom}_desc`), loc)});
  }
  const nbConcepts = entrees.length;

  // 2. Leçons du tutoriel et conseils (reactive advice) : localization\english\tutorial\*.yml.
  for (const f of await fichiers(path.join(dossierLoc, 'english', 'tutorial'), f => f.endsWith('.yml'))) {
    const nomFichier = path.basename(f);
    const dlc = TUTORIEL_DLC[nomFichier.split('_')[0]] || null;
    const type = /reactive|advice/.test(nomFichier) ? 'conseil' : 'tutoriel';
    const locFichier = await chargerLocalisation(path.dirname(f), x => x === f);
    for (const cle of locFichier.keys()) {
      const m = cle.match(/^(?!action_)(.+?)_desc(?:_(\d+))?$/);
      if (!m) continue;
      const base = m[2] ? `${m[1]}_${m[2]}` : m[1];
      const titreBrut = [base, `${base}_step_1`, m[1]].map(k => loc.get(k)).find(v => v && v.length < 90);
      const titre = nettoyer(titreBrut, loc) || base.replace(/^(reactive_advice|lesson_basics|lesson)_/, '').replace(/_/g, ' ');
      ajouter({cle: `${type}:${base}`, type, titre, alias: [], dlc, texte: nettoyer(loc.get(cle), loc)});
    }
  }
  // Les conseils d'une extension sont rangés avec ceux du jeu de base (ex. reactive_advice_puppets, By God Alone) : ils prennent
  // l'extension du concept réservé qui porte le même nom (clé ou titre).
  const forme = s => normaliser(s).split(' ').map(racine).join(' ');
  const reserve = new Map();
  for (const e of entrees) if (e.type === 'concept' && e.dlc) for (const n of [e.cle.slice(8).replace(/_/g, ' '), e.titre, ...e.alias]) reserve.set(forme(n), e);
  for (const e of entrees) {
    if (e.type === 'concept' || e.dlc) continue;
    const coeur = e.cle.split(':')[1].replace(/^(reactive_advice|ra|lesson_basics|lesson)_/, '').replace(/(_step)?_\d+$/, '').replace(/_/g, ' ');
    // Nom exact, sinon ses derniers mots (« landless adventurer » -> Adventurer, de Roads to Power).
    const fin = forme(coeur).split(' ');
    const c = reserve.get(forme(coeur)) || reserve.get(forme(e.titre.replace(/^Advice:\s*/i, '')))
      || (fin.length <= 3 ? fin.slice(1).map((_, i) => reserve.get(fin.slice(i + 1).join(' '))).find(Boolean) : null);
    e.dlc = c?.dlc || null; e.deduit = !!c?.deduit;
  }

  // 3. Lexique français -> anglais (concepts, interactions, décisions) : Ameur pose ses questions en français.
  const fr = await chargerLocalisation(path.join(dossierLoc, 'french'), () => true, k => /^game_concept_[a-z0-9_]+$|_interaction$|_decision$/.test(k) && !/_desc$|_tooltip$/.test(k));
  const glossaire = [];
  for (const [cle, valeur] of fr) {
    const en = nettoyer(loc.get(cle), loc), frN = normaliser(nettoyer(valeur, fr));
    // Les noms courts des notions (« Or », « Roi », « Duc », « Foi ») sont gardés : ce sont les mots des questions de débutant.
    if (!en || en.length > 40 || /[…[$]/.test(en) || frN.length < (cle.startsWith('game_concept_') ? 2 : 4) || MOTS_VIDES_FR.has(frN) || normaliser(en) === frN) continue;
    glossaire.push([frN, en]);
  }
  if (!entrees.length) throw new Error(`Encyclopédie vide : aucun texte lu dans ${path.join(dossierLoc, 'english')} (${loc.size} clés de traduction)`);
  journal.log?.(`Copilote CK3 : savoir ${version} construit en ${Date.now() - t0} ms (${nbConcepts} concepts, ${entrees.length - nbConcepts} leçons et conseils, ${glossaire.length} mots du lexique)`);
  return {format: FORMAT, version, cree: new Date().toISOString(), entrees, glossaire, parExtension};
}

// Index de recherche en mémoire (BM25 simple + bonus quand le titre correspond).
function indexer(entrees) {
  const docs = entrees.map(e => {
    const tf = new Map();
    const tous = [...mots(e.titre), ...mots(e.titre), ...mots(e.titre), ...e.alias.flatMap(a => mots(a)), ...mots(e.texte)];
    for (const m of tous) tf.set(m, (tf.get(m) || 0) + 1);
    return {e, tf, n: tous.length, titre: normaliser(e.titre).split(' ').map(racine).join(' '), alias: e.alias.map(a => normaliser(a).split(' ').map(racine).join(' '))};
  });
  const df = new Map();
  for (const d of docs) for (const m of d.tf.keys()) df.set(m, (df.get(m) || 0) + 1);
  const moyenne = docs.reduce((s, d) => s + d.n, 0) / Math.max(1, docs.length);
  return {docs, df, moyenne};
}

// prenom : facultatif (COPILOTE_PRENOM) ; sans lui, les notes parlent du « joueur ». dossierJeu : COPILOTE_CK3_DIR (facultatif).
// Rejette (jeu introuvable, Encyclopédie vide) plutôt que de servir un savoir vide : l'appelant le dit au joueur.
export async function chargerSavoirCk3({root, journal = console, prenom = null, dossierJeu: dossierForce = null} = {}) {
  const j = formesJoueur(prenom);
  const dossierJeu = await trouverJeu(dossierForce);
  const {version, nom} = await versionInstallee(dossierJeu);
  const extensions = await extensionsInstallees(dossierJeu);
  const dossierCache = path.join(root, 'memoire', 'copilote-ck3');
  const fichierCache = path.join(dossierCache, `savoir-${String(version).replace(/[^0-9A-Za-z._-]/g, '_')}.json`);
  let donnees = null;
  // Un cache vide (écrit par une version antérieure quand le jeu était illisible) ne compte pas : l'index est refait.
  try { donnees = JSON.parse(await readFile(fichierCache, 'utf8')); if (donnees.format !== FORMAT || donnees.version !== version || !donnees.entrees?.length) donnees = null; } catch {}
  if (!donnees) {
    donnees = await construire(dossierJeu, version, journal);   // lève si rien n'a été lu : jamais de cache vide
    await mkdir(dossierCache, {recursive: true});
    await writeFile(fichierCache, JSON.stringify(donnees));
  }
  const {docs, df, moyenne} = indexer(donnees.entrees);
  const glossaire = donnees.glossaire.filter(([fr]) => !LEXIQUE_IGNORE.has(fr)).map(([fr, en]) => [` ${fr} `, en]);
  // Titres de l'Encyclopédie (forme normalisée) : un libellé anglais cité dans la question, ou un mot identique dans les deux
  // langues (« confédération »), compte comme une notion du jeu.
  const titres = new Set(docs.flatMap(d => [d.titre, ...d.alias]).filter(t => t.length >= 3 && !MOTS_VIDES.has(t)));
  const possede = flag => !FLAGS_DLC[flag] || extensions.possedees.includes(FLAGS_DLC[flag]);

  // Extensions : phrases construites d'après ce qui est installé (un achat de By God Alone doit changer la consigne, pas la contredire).
  const payantes = [...new Set(Object.values(FLAGS_DLC))];
  const payantesPossedees = payantes.filter(n => extensions.possedees.includes(n));
  const consigneExtensions = `Extensions installées chez ${j.fr.nom} : ${extensions.possedees.join(', ') || 'aucune'}. ` + (payantesPossedees.length
    ? `Extensions payantes possédées : ${payantesPossedees.join(', ')} ; il n'a PAS les autres extensions payantes.`
    : 'Il n\'a AUCUNE extension payante (seulement des packs sans fonction de jeu).')
    + ' Ne lui conseille jamais une fonction qui demande une extension qu\'il n\'a pas ; si sa question porte sur une telle fonction, dis-lui qu\'elle demande l\'extension et nomme-la.';
  // Même phrase pour les consignes anglaises (la langue des consignes l'emporte sur celle des notes : autant lui parler anglais).
  const consigneExtensionsEn = `Expansions installed for ${j.en.nom}: ${extensions.possedees.join(', ') || 'none'}. ` + (payantesPossedees.length
    ? `Paid expansions owned: ${payantesPossedees.join(', ')}; ${j.en.nom} does NOT own the other paid expansions.`
    : `${j.en.Nom} owns NO paid expansion (only packs without gameplay features).`)
    + ' Never recommend a feature that needs an expansion they do not own; if the question is about such a feature, say that it needs that expansion and name it.';

  // Notions de l'Encyclopédie réservées aux extensions qu'il n'a pas : tirées des fichiers du jeu (incomplet : certains fichiers
  // d'extension ne marquent rien, d'où les notions « présumées » et la liste tenue à la main, qui passe en premier).
  const reservees = {};
  for (const [flag, titres] of Object.entries(donnees.parExtension)) if (!possede(flag)) (reservees[FLAGS_DLC[flag] || flag] ??= []).push(...titres);
  const fonctionsExtensions = `Principales fonctions des extensions payantes (liste indicative tenue à la main ; ${j.fr.nom} possède : ${payantesPossedees.join(', ') || 'aucune'}) :\n`
    + FONCTIONS_EXTENSIONS + '\nNotions de l\'Encyclopédie liées à une extension qu\'il n\'a pas (tirées des fichiers du jeu installé, liste incomplète) :\n'
    + Object.entries(reservees).map(([dlc, t]) => `- ${dlc} : ${[...new Set(t)].slice(0, 14).join(', ')}${t.length > 14 ? '…' : ''}`).join('\n');

  // Coût de base de création d'un titre, lu dans les fichiers du jeu installé (le modèle inventait ces chiffres).
  const defines = await readFile(path.join(dossierJeu, 'game', 'common', 'defines', '00_defines.txt'), 'utf8').catch(() => '');
  const cout = defines.match(/CREATE_TITLE_GOLD_COST\s*=\s*\{([^}]*)\}/)?.[1].trim().split(/\s+/).map(Number);
  const noteCout = cout?.length >= 6 && cout.every(Number.isFinite)
    ? `\n- Création de titre (fichiers du jeu ${version}, common/defines) : coût de base ${cout[3]} or pour un duché, ${cout[4]} pour un royaume, ${cout[5]} pour un empire ; le coût réel peut être réduit (20 % du coût de base au minimum). Les conditions exactes (comtés ou duchés à tenir) s'affichent dans l'info-bulle de **Create Title** : ne les donne pas de mémoire.` : '';
  const notesVersion = ecrireNotesVersion(possede('by_god_alone'), j) + noteCout + (version !== '1.20.0.4' ? `\nAttention : le jeu est passé en ${nom || version} ; ces notes datent de la 1.20.0.4. Préfère les extraits de l'Encyclopédie et les pages du wiki les plus récentes.` : '');

  // termes : mots anglais du jeu (étape d'écoute) ; question : la question en français (le lexique la traduit en notions du jeu).
  // Seuil de pertinence : les extraits sont présentés au modèle comme « textes exacts » ; du bruit (12 extraits sur la victoire
  // pour « gagner plus d'or ») le pousse hors sujet. Rien de pertinent : [] (le cerveau demande alors une recherche Google).
  // langue : celle des consignes ('fr' ou 'en') ; seule l'étiquette des extensions manquantes change, les extraits du jeu sont en anglais.
  function chercher(termes = [], question = '', maxCaracteres = 6000, langue = 'fr') {
    const qn = ` ${normaliser(question)} `;
    const brut = qn.trim().split(' ').filter(Boolean).map(racine), cites = [];
    for (let n = 4; n >= 1; n--) for (let i = 0; i + n <= brut.length; i++) { const ng = brut.slice(i, i + n).join(' '); if (titres.has(ng)) cites.push(ng); }
    const expressions = [...new Set([...termes.map(String), ...glossaire.filter(([fr]) => qn.includes(fr)).map(([, en]) => en),
      ...SYNONYMES_ORAUX.filter(([motif]) => motif.test(qn)).map(([, en]) => en), ...cites]
      .map(x => normaliser(x).split(' ').filter(Boolean).map(racine).join(' ')).filter(Boolean))];
    const poids = new Map();
    for (const ex of expressions) for (const m of ex.split(' ')) if (!MOTS_VIDES_EN.has(m)) poids.set(m, Math.max(poids.get(m) || 0, 1));
    for (const m of mots(question, MOTS_VIDES_FR)) if (!poids.has(m)) poids.set(m, 0.4);   // libellés anglais cités tels quels dans la question
    if (!poids.size) return [];
    const N = docs.length, k1 = 1.2, b = 0.75;
    const notes = [];
    for (const d of docs) {
      let s = 0, fort = false;
      for (const [m, w] of poids) {
        const f = d.tf.get(m); if (!f) continue;
        const idf = Math.log(1 + (N - df.get(m) + 0.5) / (df.get(m) + 0.5));
        s += w * idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.n / moyenne));
        if (w === 1) fort = true;   // touche une notion venue du lexique ou des termes de l'écoute
      }
      if (!s) continue;
      for (const ex of expressions) {
        if (d.titre === ex) s += 12; else if (d.alias.includes(ex)) s += 8;
        else if (ex.split(' ').every(m => ` ${d.titre} `.includes(` ${m} `))) s += 3;
      }
      if (d.e.type !== 'concept') s *= 0.85;   // à égalité, la définition de l'Encyclopédie passe avant le tutoriel
      if (d.e.dlc && !possede(d.e.dlc)) s *= 0.7;
      notes.push([s, d.e, fort]);
    }
    notes.sort((x, y) => y[0] - x[0]);
    const meilleure = notes[0]?.[0] || 0;
    const gardees = notes.filter(([s, , fort]) => s >= meilleure * PART_DE_LA_MEILLEURE && (fort || s >= PLANCHER)).slice(0, 12);
    const resultat = []; let reste = maxCaracteres;
    for (const [s, e] of gardees) {
      const dlc = FLAGS_DLC[e.dlc] || e.dlc;
      const etiquette = !e.dlc || possede(e.dlc) ? ''
        : langue === 'en' ? (e.deduit ? `[Concept that came with the ${dlc} expansion, which ${j.en.nom} does not own: it probably depends on it, check on screen before recommending it] `
          : `[Paid expansion required: ${dlc} — ${j.en.nom} does not own it] `)
        : e.deduit ? `[Notion venue avec l'extension ${dlc}, ${j.fr.que} n'a pas : elle en dépend probablement, vérifie à l'écran avant de la conseiller] `
        : `[Extension payante requise : ${dlc} — ${j.fr.nom} ne l'a pas] `;
      let texte = etiquette + e.texte;
      if (texte.length > 1800) texte = texte.slice(0, 1800).replace(/\s+\S*$/, '') + ' …';
      if (texte.length + e.titre.length + 10 > reste) { if (reste < 400) break; texte = texte.slice(0, reste - e.titre.length - 20).replace(/\s+\S*$/, '') + ' …'; }
      resultat.push({cle: e.cle, titre: e.titre, texte, note: Math.round(s * 10) / 10});
      reste -= texte.length + e.titre.length + 10;
      if (reste < 200) break;
    }
    return resultat;
  }

  return {version, nomVersion: nom, dossierJeu, extensions, notesVersion, fonctionsExtensions, consigneExtensions, consigneExtensionsEn, chercher, joueur: j,
    compte: {concepts: donnees.entrees.filter(e => e.type === 'concept').length, lecons: donnees.entrees.filter(e => e.type === 'tutoriel').length,
      conseils: donnees.entrees.filter(e => e.type === 'conseil').length, lexique: donnees.glossaire.length, cache: fichierCache}};
}
