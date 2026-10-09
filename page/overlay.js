// Copilote CK3, côté page : le bouton micro, l'enregistrement (16 kHz mono, WAV), l'envoi à /api/jeu/question, la lecture du
// flux SSE (texte, sources, voix) et le panneau de réponse. Tourne dans la fenêtre Electron (pont window.copilote du preload)
// ou dans un navigateur pour les essais : index.html?demo=1 simule tout (ni micro ni API), ?demo=sse simule l'écoute puis
// interroge le vrai serveur, &etat=repos|ecoute|reflexion|reponse|parle|erreur fige un état pour les captures, &coin=haut-gauche…
// Langue (06/10/2026) : &langue=en, puis celle que l'appli envoie (menu Langue / Language de la zone de notification) ; textes
// dans textes.js. Le français reste le défaut.
'use strict';
(() => {
  const params = new URLSearchParams(location.search);
  const DEMO = params.get('demo');
  const TEXTES = self.TEXTES_COPILOTE || textesDeSecours();
  let langue = params.get('langue') === 'en' ? 'en' : 'fr', T = TEXTES[langue];

  // textes.js absent (fichier oublié dans un commit ou une copie) : la page ne doit pas mourir, sinon plus de micro ni de panneau.
  // Elle garde les textes français d'index.html (texte, info-bulle ou aria-label de la clé) ; chaque autre texte devient « … », et
  // un message d'erreur du serveur passé à un texte-fonction (ouvreLeJeu) s'affiche tel quel. Signalé dans app.log.
  function textesDeSecours() {
    console.error('Copilote : textes.js manquant, textes de secours');
    const duHtml = cle => document.querySelector(`[data-t="${cle}"]`)?.textContent || document.querySelector(`[data-t-title="${cle}"]`)?.title
      || document.querySelector(`[data-t-aria="${cle}"]`)?.getAttribute('aria-label') || '…';
    const secours = new Proxy({}, {get(_, cle) {
      if (typeof cle !== 'string') return undefined;
      if (cle === 'demoEtapes') return [];
      // Utilisable comme texte (statut(T.ecoute)) ou comme fonction (T.ouvreLeJeu(erreur), T.repondu(ms)…).
      const f = (...a) => a.filter(x => typeof x === 'string' && x).join(' ') || duHtml(cle);
      f.toString = f[Symbol.toPrimitive] = () => duHtml(cle);
      return f;
    }});
    return {fr: secours, en: secours};
  }
  const $ = s => document.querySelector(s);
  const pause = ms => new Promise(r => setTimeout(r, ms));
  const corps = document.body;
  const el = {micro: $('#micro'), question: $('#question'), attente: $('#attente-texte'), reponse: $('#reponse'), erreur: $('#erreur'),
    sources: $('#sources ul'), suggestions: $('#suggestions'), statut: $('#statut'), titre: $('#titre'),
    repeter: $('#b-repeter'), voix: $('#b-voix'), nouvelle: $('#b-nouvelle'), reduire: $('#b-reduire'), fermer: $('#b-fermer')};
  if (DEMO) document.documentElement.classList.add('demo');

  // Pont vers Electron (preload.cjs). Dans un navigateur, un remplaçant : la fenêtre ne bouge pas, la voix est gardée localement.
  const pont = window.copilote || pontNavigateur();
  function pontNavigateur() {
    const lire = () => { try { return localStorage.getItem('copilote-voix') !== '0'; } catch { return true; } };
    return {
      onRaccourci() {}, onEtat() {}, onCommande() {}, agrandir() {}, deplacer() {}, finDeplacement() {}, ecoute() {}, battement() {}, evenement() {}, menu() {},
      ouvrirLien(u) { window.open(u, '_blank', 'noopener,noreferrer'); },
      async voix() { return lire(); },
      async basculerVoix() { const v = !lire(); try { localStorage.setItem('copilote-voix', v ? '1' : '0'); } catch {} return v; },
    };
  }

  // infoEtat : dernière réponse de /api/jeu/etat, gardée pour réécrire la ligne d'état quand la langue change.
  let etat = 'repos', statutRepos = T.pret, baseRepos = T.pret, pretRepos = true, infoEtat = null, raccourci = 'demarrage', texte = '', voixActive = true;
  let generation = 0;            // chaque question a son numéro : les événements d'une question abandonnée sont ignorés
  let controleur = null, surveillance = null, fermetureAuto = null;
  const changerEtat = e => { etat = e; corps.dataset.etat = e; };
  const statut = t => { el.statut.textContent = t; };
  const attente = t => { el.attente.textContent = t; };
  const agrandir = oui => { corps.classList.toggle('agrandi', oui); pont.agrandir(oui); };
  const echapper = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;'})[c]);
  // Micro ouvert ou fermé, signalé à Electron : l'icône (seul témoin de l'écoute) ne doit pas disparaître pendant l'enregistrement.
  const signalerEcoute = oui => { try { pont.ecoute?.(oui); } catch {} };
  // Journal d'Electron (app.log), 09/10/2026 : début et fin des questions, glissements interrompus, erreurs de la page. Jamais le
  // texte d'une question ni d'une réponse.
  const signaler = (nom, details = {}) => { try { pont.evenement?.(nom, details); } catch {} };
  const nomFichier = f => String(f || '').split(/[?#]/)[0].split(/[\\/]/).pop().slice(0, 40);
  self.addEventListener?.('error', e => signaler('erreur', {message: String(e?.message || 'erreur').slice(0, 200), source: `${nomFichier(e?.filename)}:${e?.lineno || 0}`}));
  self.addEventListener?.('unhandledrejection', e => signaler('erreur', {message: String(e?.reason?.message || e?.reason || 'promesse rejetée').slice(0, 200), source: 'promesse'}));
  let glissements = 0;   // glissements en cours (icône ou panneau), pour le battement

  // ---------- Voix : un seul AudioContext à 24 kHz, morceaux joués à la suite dans l'ordre d'arrivée ----------
  // coupe : Ameur a coupé la voix d'un clic ; les morceaux qui arrivent encore sont gardés (pour « répéter ») mais pas joués.
  const lecteur = {
    ctx: null, fin: 0, sources: new Set(), morceaux: [], dernier: -1, muet: !!DEMO, coupe: false,
    contexte() {
      if (!this.ctx) this.ctx = new AudioContext({sampleRate: 24000});
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    },
    ajouter(b64, index) {
      const i = Number.isFinite(index) ? index : this.dernier + 1;
      if (i <= this.dernier) return;          // doublon
      this.dernier = i;
      const octets = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const vue = new DataView(octets.buffer), f = new Float32Array(octets.length >> 1);
      for (let k = 0; k < f.length; k++) f[k] = vue.getInt16(k * 2, true) / 32768;
      this.morceaux.push(f);
      el.repeter.disabled = false;
      if (!this.muet && voixActive && !this.coupe) this.jouer(f);
    },
    jouer(f) {
      const ctx = this.contexte(), tampon = ctx.createBuffer(1, f.length, 24000);
      tampon.copyToChannel(f, 0);
      const s = ctx.createBufferSource();
      s.buffer = tampon; s.connect(ctx.destination);
      const debut = Math.max(ctx.currentTime + .04, this.fin);
      s.start(debut); this.fin = debut + tampon.duration;
      this.sources.add(s);
      s.onended = () => { this.sources.delete(s); this.maj(); };
      this.maj();
    },
    arreter() { for (const s of this.sources) { s.onended = null; try { s.stop(); } catch {} } this.sources.clear(); this.fin = 0; this.maj(); },
    couper() { this.coupe = true; this.arreter(); },
    vider() { this.arreter(); this.coupe = false; this.morceaux = []; this.dernier = -1; el.repeter.disabled = true; },
    repeter() { this.arreter(); this.coupe = false; if (!this.muet) for (const f of this.morceaux) this.jouer(f); },
    // Voix finie : le contexte audio se met en veille au bout de 5 s (pas de fil audio qui tourne pendant toute la partie).
    maj() {
      corps.classList.toggle('parle', this.sources.size > 0);
      clearTimeout(this.veille);
      if (!this.sources.size && this.ctx) this.veille = setTimeout(() => { if (!this.sources.size && this.ctx?.state === 'running') this.ctx.suspend().catch(() => {}); }, 5000);
    },
  };

  // ---------- Micro : AudioWorklet → 16 kHz mono Int16, niveau en direct, détection simple du silence ----------
  // Un micro neuf par question : la fermeture tardive d'une question abandonnée ne peut pas couper celui de la suivante.
  // Revue du 09/10/2026 : getUserMedia, le chargement du worklet ou la reprise du contexte audio peuvent ne jamais répondre (pilote
  // du casque, micro pris par une autre appli). Sans délai, la page restait « en écoute », l'icône rouge ne réagissait plus aux
  // clics ni au raccourci, et Electron ne voyait rien (la page battait toujours). Démarrage borné à 8 s (puis « Le micro ne répond
  // pas »), fermeture bornée à 1 s par étape ; ce qui s'ouvrirait encore après est refermé par le démarrage lui-même.
  const DELAI_MICRO_MS = 8000;
  function creerMicro() {
    const m = {flux: null, ctx: null, noeud: null, paquets: [], taille: 0, debut: performance.now(), parole: false, maxNiveau: 0, plancher: .01, suite: 0, finRecue: null, ferme: false};
    m.dernierSon = m.debut;
    const demarrage = (async () => {
      const flux = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1}});
      if (m.ferme) { flux.getTracks().forEach(t => t.stop()); return; }   // fermé pendant l'attente : la piste ne reste pas ouverte
      m.flux = flux;
      m.ctx = new AudioContext({latencyHint: 'interactive'});
      await m.ctx.audioWorklet.addModule('micro-worklet.js');
      if (m.ferme) return;   // fermer() a déjà arrêté la piste et le contexte (ils existaient avant l'attente)
      const source = m.ctx.createMediaStreamSource(m.flux);
      m.noeud = new AudioWorkletNode(m.ctx, 'micro-16k', {numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit'});
      m.noeud.port.onmessage = e => recevoir(e.data);
      const silence = m.ctx.createGain();
      silence.gain.value = 0;                 // relié à la sortie pour que le navigateur fasse tourner le nœud, sans aucun son
      source.connect(m.noeud).connect(silence).connect(m.ctx.destination);
      if (m.ctx.state === 'suspended') await m.ctx.resume();
    })();
    m.pret = Promise.race([demarrage, new Promise((_, ko) => setTimeout(() => ko(Object.assign(new Error(`micro sans réponse après ${DELAI_MICRO_MS / 1000} s`), {name: 'TimeoutError'})), DELAI_MICRO_MS))]);
    function recevoir(d) {
      if (d.fin) return m.finRecue?.();
      m.paquets.push(d.pcm); m.taille += d.pcm.length;
      // Seuil de parole : trois fois le bruit de fond (le plus faible paquet entendu), entre 0,015 et 0,05.
      m.plancher = Math.max(.002, Math.min(m.plancher, d.niveau));
      const seuil = Math.min(.05, Math.max(.015, m.plancher * 3));
      if (d.niveau > seuil) { if (++m.suite >= 3) m.parole = true; m.dernierSon = performance.now(); } else m.suite = 0;
      m.maxNiveau = Math.max(m.maxNiveau, d.niveau);
      if (micro === m) corps.style.setProperty('--niveau', Math.min(1, Math.sqrt(d.niveau * 10)).toFixed(3));
    }
    // Ferme tout (le micro s'éteint entre deux questions) et rend les échantillons reçus.
    m.fermer = async () => {
      m.ferme = true;
      await Promise.race([m.pret.catch(() => {}), pause(1000)]);
      if (m.noeud) await new Promise(ok => { m.finRecue = ok; m.noeud.port.postMessage('stop'); setTimeout(ok, 300); });
      m.flux?.getTracks().forEach(t => t.stop());
      if (m.ctx) await Promise.race([m.ctx.close().catch(() => {}), pause(1000)]);
      m.flux = m.ctx = m.noeud = m.finRecue = null;
      if (!micro) corps.style.setProperty('--niveau', 0);
      const pcm = new Int16Array(m.taille);
      let o = 0;
      for (const p of m.paquets) { pcm.set(p, o); o += p.length; }
      m.paquets = []; m.taille = 0;
      return pcm;
    };
    return m;
  }

  function wav(pcm) {
    const b = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(b);
    const ecrire = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ecrire(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); ecrire(8, 'WAVE'); ecrire(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true);
    v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); ecrire(36, 'data'); v.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, pcm[i], true);
    return new Uint8Array(b);
  }
  function enBase64(octets) {
    let s = '';
    for (let i = 0; i < octets.length; i += 0x8000) s += String.fromCharCode.apply(null, octets.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // ---------- Écoute : appui court ou clic = bascule (arrêt au silence), touche tenue plus de 600 ms = parler en maintenant ----------
  let micro = null, mode = null, tAppui = 0, enArret = false;
  // Regard (07/10/2026) : de l'appui jusqu'à la question, le serveur continue de regarder le jeu (Ameur montre en parlant). Une
  // écoute abandonnée l'arrête tout de suite, sinon il regarderait jusqu'à 40 s pour rien ; l'identifiant de l'appui évite
  // d'arrêter celui d'un appui plus récent.
  let regardId = null;
  function arreterRegard() {
    if (!regardId) return;
    const id = regardId;
    regardId = null;
    fetch(`/api/jeu/regard/arret?regard=${encodeURIComponent(id)}`, {method: 'POST'}).catch(() => {});
  }

  function annulerQuestion() {
    arreterRegard();
    generation++;
    controleur?.abort(); controleur = null;
    clearInterval(surveillance); surveillance = null;
    clearTimeout(fermetureAuto);
    lecteur.vider();
    if (micro) { const m = micro; micro = null; m.fermer().finally(() => { if (!micro) signalerEcoute(false); }); }
  }

  async function commencerEcoute(nouveauMode) {
    annulerQuestion();
    const g = generation;
    mode = nouveauMode; enArret = false;
    viderPanneau();
    changerEtat('ecoute'); statut(T.ecoute); attente(T.ecoute);
    if (DEMO) { simulerEcoute(g); return; }
    signalerEcoute(true);
    // Image du jeu prise dès l'appui (ce qu'Ameur survolait à cet instant), puis regard jusqu'à la question : le serveur garde
    // les vues en mémoire pour la question.
    // CK3 fermé ou réduit : aucune réponse possible, le micro se referme aussitôt (rien n'est enregistré ni envoyé).
    // bloquant vient du serveur (code de l'aide) ; la phrase française sert encore si le serveur est d'une version antérieure.
    regardId = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    fetch(`/api/jeu/capturer?langue=${langue}&regard=${regardId}`, {method: 'POST'}).then(r => r.json()).then(j => {
      const bloquant = j?.bloquant ?? /pas lancé|réduit/.test(j?.erreur || '');
      if (j?.ok || !bloquant || g !== generation || etat !== 'ecoute') return;
      annulerQuestion();
      erreurLocale(T.ouvreLeJeu(j.erreur), true);
    }).catch(() => {});
    const m = micro = creerMicro();
    try { await m.pret; } catch (e) {
      if (micro !== m) return;
      micro = null; m.fermer().finally(() => signalerEcoute(false));
      console.warn(`Micro : ${e.name} : ${e.message}`);   // détail technique pour app.log seulement
      arreterRegard();
      return erreurLocale(e.name === 'NotAllowedError' ? T.microBloque : e.name === 'NotFoundError' ? T.microAbsent : T.microMuet);
    }
    if (micro !== m || enArret || g !== generation) return;
    surveillance = setInterval(surveiller, 100);
  }

  function surveiller() {
    const m = micro;
    if (!m || etat !== 'ecoute') { clearInterval(surveillance); surveillance = null; return; }
    const t = performance.now() - m.debut;
    if (t > 30000) return terminerEcoute();
    if (mode !== 'bascule') return;
    if (!m.parole && t > 6000) return terminerEcoute(true);
    if (m.parole && performance.now() - m.dernierSon > 1600) terminerEcoute();
  }

  async function terminerEcoute(abandon = false) {
    if (etat !== 'ecoute' || enArret) return;
    enArret = true;
    clearInterval(surveillance); surveillance = null;
    const g = generation;
    if (DEMO) return envoyer({texte: T.demoQuestion});
    const m = micro;
    micro = null;
    const pcm = m ? await m.fermer() : new Int16Array(0);
    if (!micro) signalerEcoute(false);
    if (g !== generation) return;
    // Rien d'audible : on le dit tout de suite, sans appel payant (et le regard s'arrête).
    if (abandon || pcm.length < 16000 * .35 || !m || m.maxNiveau < .01) { arreterRegard(); return erreurLocale(T.rienEntendu, true); }
    regardId = null;   // la question emporte le regard : le serveur choisit ses images à son arrivée
    envoyer({audio: enBase64(wav(pcm))});
  }

  function erreurLocale(message, refermer = false) {
    changerEtat('reponse'); corps.classList.add('fini');
    el.erreur.textContent = message; statut(message);
    agrandir(true);
    clearTimeout(fermetureAuto);
    if (refermer) { const g = generation; fermetureAuto = setTimeout(() => { if (g === generation && etat === 'reponse') fermer(); }, 4000); }
  }

  function viderPanneau() {
    texte = '';
    for (const e of [el.question, el.reponse, el.erreur, el.sources]) e.textContent = '';
    el.suggestions.removeAttribute('srcdoc');
    corps.classList.remove('a-texte', 'a-sources', 'a-suggestions', 'fini', 'garde');
  }

  function fermer() {
    annulerQuestion();
    corps.classList.remove('garde');
    changerEtat('repos'); agrandir(false);
    statut(statutRepos);
    chargerEtat();
  }

  // Réduire : le panneau se replie en gardant la réponse (point bleu sur l'icône) ; un clic sur l'icône la rouvre. Ameur peut
  // ainsi ouvrir la fenêtre du jeu dont parle la réponse, puis relire les étapes.
  function reduire() { corps.classList.add('garde'); agrandir(false); }
  function rouvrir() { corps.classList.remove('garde'); agrandir(true); }

  // ---------- Envoi et lecture du flux SSE ----------
  async function envoyer(donnees) {
    const g = generation;
    changerEtat('reflexion'); agrandir(true);
    attente(T.attente); statut(T.attente);
    if (DEMO === '1') return simulerReponse(g);
    const ctrl = controleur = new AbortController();
    let minuteur;
    const relancer = () => { clearTimeout(minuteur); minuteur = setTimeout(() => ctrl.abort('delai'), 45000); };
    relancer();
    let termine = false, issue = null;
    const t0 = performance.now();
    signaler('question', {etape: 'envoyee', voix: !!donnees.audio});
    try {
      // langue dans le corps (la question) et dans l'adresse (pour les erreurs dites avant la lecture du corps).
      const r = await fetch(`/api/jeu/question?langue=${langue}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...donnees, voix: voixActive, langue}), signal: ctrl.signal});
      if (!r.ok || !/event-stream/.test(r.headers.get('content-type') || '')) {
        let m = T.serveurCode(r.status);
        try { const j = await r.json(); if (j.erreur) m = j.erreur; } catch {}
        throw new Error(m);
      }
      // Tout morceau reçu relance le minuteur, y compris le battement que le serveur envoie toutes les 10 s pendant qu'il travaille.
      await lireFlux(r, ev => { if (g !== generation) return; if (ev.type === 'fin' || ev.type === 'erreur') { termine = true; issue = ev.type; } traiter(ev); }, relancer);
      if (g === generation && !termine) { issue = 'coupee'; traiter({type: 'erreur', message: T.arreteeEnRoute}); }
    } catch (e) {
      issue = 'annulee';
      if (g !== generation) return;
      if (ctrl.signal.aborted && ctrl.signal.reason !== 'delai') return;       // question annulée exprès
      // Réponse déjà affichée : seule la voix manque, ce n'est pas une erreur à montrer.
      if (ctrl.signal.reason === 'delai' && texte) { issue = 'voix-interrompue'; changerEtat('reponse'); corps.classList.add('fini'); statut(T.voixInterrompue); return; }
      issue = ctrl.signal.reason === 'delai' ? 'delai' : 'erreur';
      traiter({type: 'erreur', message: ctrl.signal.reason === 'delai' ? T.delai
        : /fetch|network/i.test(e.message) ? T.serveurMuet : e.message});
    } finally {
      clearTimeout(minuteur); if (controleur === ctrl) controleur = null;
      signaler('question', {etape: 'finie', issue: issue || (g !== generation ? 'annulee' : 'inconnue'), ms: Math.round(performance.now() - t0)});
    }
  }

  async function lireFlux(reponse, surEvenement, surMorceau = () => {}) {
    const lecteurFlux = reponse.body.getReader(), dec = new TextDecoder();
    let tampon = '';
    for (;;) {
      const {value, done} = await lecteurFlux.read();
      if (done) break;
      surMorceau();
      tampon += dec.decode(value, {stream: true}).replace(/\r\n/g, '\n');
      let i;
      while ((i = tampon.indexOf('\n\n')) >= 0) {
        const bloc = tampon.slice(0, i); tampon = tampon.slice(i + 2);
        const data = bloc.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
        if (!data) continue;
        let ev; try { ev = JSON.parse(data); } catch { continue; }
        surEvenement(ev);
      }
    }
  }

  function traiter(ev) {
    switch (ev.type) {
      case 'etape': statut(ev.texte || ''); attente(ev.texte || ''); break;
      case 'question': el.question.textContent = ev.texte || ''; break;
      case 'texte':
        texte += ev.delta || '';
        if (etat !== 'reponse') changerEtat('reponse');
        corps.classList.add('a-texte'); rendre(); break;
      case 'sources': afficherSources(ev); break;
      case 'audio': if (voixActive && ev.pcm) lecteur.ajouter(ev.pcm, ev.index); break;
      case 'fin': {
        changerEtat('reponse'); corps.classList.add('fini');
        const s = T.repondu(ev.ms);
        const c = Number(ev.coutCents);
        statut(Number.isFinite(c) && c > 0 ? `${s} · ${T.cout(c)}` : s);
        break;
      }
      case 'erreur':
        changerEtat('reponse'); corps.classList.add('fini');
        el.erreur.textContent = ev.message || T.erreurInconnue; statut(T.probleme); break;
    }
  }

  // Réponse : tout est échappé, puis seuls le gras (**…**) et les lignes numérotées deviennent du HTML.
  function enLigne(t) {
    return echapper(t).replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>').replace(/\*\*/g, '')
      .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  }
  function rendre() {
    const html = [];
    let liste = false;
    for (const brute of texte.split('\n')) {
      const l = brute.trim().replace(/^#{1,6}\s+/, '');
      const m = l.match(/^(\d{1,2})[.)]\s+(.*)$/);
      if (m) { if (!liste) { html.push('<ol>'); liste = true; } html.push(`<li data-n="${m[1]}">${enLigne(m[2])}</li>`); continue; }
      if (liste && l) { html.push('</ol>'); liste = false; }
      if (!l) continue;
      const puce = l.match(/^[-*•]\s+(.*)$/);
      html.push(`<p>${puce ? '• ' + enLigne(puce[1]) : enLigne(l)}</p>`);
    }
    if (liste) html.push('</ol>');
    el.reponse.innerHTML = html.join('');
    const c = el.reponse.parentElement;
    if (c.scrollHeight - c.scrollTop - c.clientHeight < 60) c.scrollTop = c.scrollHeight;
  }

  function afficherSources({liens = [], suggestionsHtml} = {}) {
    el.sources.textContent = '';
    for (const lien of (Array.isArray(liens) ? liens : []).slice(0, 6)) {
      let u;
      try { u = new URL(lien.url); } catch { continue; }
      if (u.protocol !== 'https:') continue;
      const a = document.createElement('a');
      a.href = u.href; a.textContent = lien.titre || u.hostname; a.title = `${lien.titre || ''} (${u.hostname})`.trim(); a.rel = 'noreferrer';
      a.addEventListener('click', e => { e.preventDefault(); pont.ouvrirLien(u.href); });
      const li = document.createElement('li');
      li.append(a); el.sources.append(li);
    }
    corps.classList.toggle('a-sources', el.sources.children.length > 0);
    // Suggestions Google : affichage exigé par les conditions de Google. HTML statique dans un cadre isolé, sans script ;
    // les liens s'ouvrent dans le navigateur (fenêtre nouvelle → interceptée par Electron → navigateur par défaut).
    if (suggestionsHtml) {
      // Même thème que le panneau : sinon Chrome peint le cadre en blanc opaque.
      el.suggestions.srcdoc = '<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="dark"><base target="_blank">'
        + '<style>html,body{margin:0;background:transparent;overflow:hidden}</style>' + suggestionsHtml;
      corps.classList.add('a-suggestions');
    }
  }

  // ---------- Commandes ----------
  pont.onRaccourci(d => {
    if (d?.etat === 'appui') {
      tAppui = performance.now();
      if (etat === 'ecoute') return terminerEcoute();           // second appui : fin de la question
      commencerEcoute('attente');
    } else if (d?.etat === 'relache') {
      if (etat !== 'ecoute' || mode !== 'attente') return;
      if (performance.now() - tAppui > 600) terminerEcoute(); else mode = 'bascule';
    } else if (d?.etat === 'bascule') {                         // raccourci de secours (sans crochet clavier) : bascule seulement
      if (etat === 'ecoute') terminerEcoute(); else commencerEcoute('bascule');
    }
  });

  // La voix est « en cours » quand un morceau joue, ou quand la réponse arrive encore et qu'elle a déjà parlé (entre deux morceaux).
  const voixEnCours = () => lecteur.sources.size > 0 || (!lecteur.coupe && lecteur.morceaux.length > 0 && etat === 'reponse' && !corps.classList.contains('fini'));
  function clicMicro() {
    if (etat === 'ecoute') return terminerEcoute();
    if (voixEnCours()) return lecteur.couper();               // un clic pendant la voix la coupe, pour toute la réponse
    if (corps.classList.contains('garde')) return rouvrir();  // réponse gardée : le clic la rouvre (nouvelle question : raccourci ou +)
    commencerEcoute('bascule');
  }

  // Glisser pour déplacer : événements pointeur + IPC (la zone « drag » de Windows ne marche pas sur une fenêtre sans focus).
  // 09/10/2026 : un glissement ne reste jamais accroché. Il finit au relâchement, mais aussi quand la capture du pointeur est perdue
  // (fenêtre cachée ou redimensionnée en plein geste, clic pris par le jeu), à l'annulation, au premier mouvement sans bouton
  // enfoncé (relâchement jamais reçu), quand la page est cachée ou perd le focus, et au clic droit : la fenêtre ne suit plus la
  // souris toute seule. Moins de 5 px : ce n'est pas un glissement (un clic sur l'icône reste un clic).
  const finsDeGlissement = new Set();
  function glissable(elem, surClic) {
    let depart = null, dernier = null, glisse = false, pointeur = null;
    function terminer(raison) {
      if (!depart) return;
      const avaitGlisse = glisse, p = pointeur;
      depart = dernier = null; glisse = false; pointeur = null;
      try { if (p !== null && elem.hasPointerCapture?.(p)) elem.releasePointerCapture(p); } catch {}
      if (avaitGlisse) {
        glissements = Math.max(0, glissements - 1);
        pont.finDeplacement();
        if (raison !== 'relache') signaler('glisser-interrompu', {raison});
      } else if (raison === 'relache') surClic?.();
    }
    finsDeGlissement.add(terminer);
    elem.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      // Le panneau se saisit partout, sauf sur ses boutons, liens, suggestions et sa barre de défilement (qui gardent leur rôle).
      if (elem !== el.micro && (e.target.closest('button, a, iframe') || (e.target.clientWidth && e.offsetX >= e.target.clientWidth))) return;
      terminer('nouvel-appui');
      depart = dernier = {x: e.screenX, y: e.screenY}; glisse = false; pointeur = e.pointerId;
      try { elem.setPointerCapture(e.pointerId); } catch {}   // pointeur déjà relâché : le premier mouvement sans bouton finira le geste
    });
    elem.addEventListener('pointermove', e => {
      if (!depart || e.pointerId !== pointeur) return;
      if (!(e.buttons & 1)) return terminer('sans-bouton');
      if (!glisse && Math.hypot(e.screenX - depart.x, e.screenY - depart.y) < 5) return;
      if (!glisse) { glisse = true; glissements++; }
      const dx = Math.round(e.screenX - dernier.x), dy = Math.round(e.screenY - dernier.y);
      if (dx || dy) { pont.deplacer(dx, dy); dernier = {x: dernier.x + dx, y: dernier.y + dy}; }
    });
    elem.addEventListener('pointerup', e => { if (e.pointerId === pointeur) terminer('relache'); });
    elem.addEventListener('pointercancel', e => { if (e.pointerId === pointeur) terminer('annule'); });
    elem.addEventListener('lostpointercapture', e => { if (e.pointerId === pointeur) terminer('capture-perdue'); });
    elem.addEventListener('keydown', e => { if (surClic && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); surClic(); } });
  }
  const panneau = document.querySelector('#panneau');
  glissable(el.micro, clicMicro);
  glissable(panneau, null);   // tout le panneau se déplace et garde sa place (06/10, demande d'Ameur)
  const finirGlissements = raison => { for (const f of finsDeGlissement) f(raison); };
  self.addEventListener?.('blur', () => finirGlissements('blur'));
  document.addEventListener?.('visibilitychange', () => { if (document.visibilityState === 'hidden') finirGlissements('cachee'); });

  // Clic droit sur l'icône ou le panneau (09/10/2026) : petit menu d'Electron (replier, recharger, quitter), qui marche sans focus.
  // En plein écran, la zone de notification est hors d'atteinte : c'était la seule façon de fermer le copilote.
  for (const e of [el.micro, panneau]) e?.addEventListener('contextmenu', ev => { ev.preventDefault(); finirGlissements('menu'); pont.menu?.(); });
  // « Replier » du menu : Electron a déjà ramené la fenêtre à l'icône ; la page suit (réponse gardée, comme « Réduire »).
  pont.onCommande?.(c => {
    if (c?.action !== 'replier') return;
    finirGlissements('replier');
    if (etat === 'repos' || !corps.classList.contains('agrandi')) agrandir(false); else reduire();
  });

  el.repeter.addEventListener('click', () => lecteur.repeter());
  el.voix.addEventListener('click', async () => majVoix(await pont.basculerVoix()));
  el.nouvelle.addEventListener('click', () => commencerEcoute('bascule'));
  el.reduire.addEventListener('click', reduire);
  el.fermer.addEventListener('click', fermer);

  function majVoix(v) {
    voixActive = v !== false;
    el.voix.setAttribute('aria-pressed', String(voixActive));
    el.voix.title = voixActive ? T.voixOn : T.voixOff;
    if (!voixActive) lecteur.arreter();
  }

  // Langue changée sur place (menu de la zone de notification) : tous les textes fixes, la ligne d'état et l'attribut lang. La
  // réponse déjà affichée reste telle quelle ; la suivante viendra dans la nouvelle langue.
  function appliquerLangue(l, forcer = false) {
    l = l === 'en' ? 'en' : 'fr';
    if (l === langue && !forcer) return;
    langue = l; T = TEXTES[l];
    document.documentElement.lang = l;
    // #attente-texte porte data-t="attente" (texte d'avant la première étape) : pendant l'écoute ou la réflexion, il dit l'étape
    // en cours, que la boucle ne doit pas remplacer par « Je regarde ton écran… ».
    const etapeEnCours = el.attente.textContent;
    for (const e of document.querySelectorAll('[data-t]')) e.textContent = T[e.dataset.t];
    for (const e of document.querySelectorAll('[data-t-title]')) e.title = T[e.dataset.tTitle];
    for (const e of document.querySelectorAll('[data-t-aria]')) e.setAttribute('aria-label', T[e.dataset.tAria]);
    majVoix(voixActive);
    majBase();
    if (etat === 'ecoute') { statut(T.ecoute); attente(T.ecoute); }
    else if (etat === 'reflexion') attente(etapeEnCours);   // étapes de la question déjà partie : dans l'ancienne langue
  }

  pont.onEtat(d => {
    if (!d) return;
    if (d.langue) appliquerLangue(d.langue);
    if (d.coin) corps.dataset.coin = d.coin;
    if ('voix' in d) majVoix(d.voix);
    if (d.raccourci) { raccourci = d.raccourci; majRepos(); }
    if (d.oublie) statut(T.oubliee);
  });
  pont.voix().then(majVoix).catch(() => {});

  // Ligne d'état au repos : l'état du jeu et des clés d'abord, puis celui du raccourci (crochet refusé, secours en bascule).
  function majRepos() {
    statutRepos = pretRepos && raccourci === 'aucun' ? T.raccourciAucun
      : pretRepos && raccourci === 'global' ? T.raccourciGlobal(baseRepos) : baseRepos;
    if (etat === 'repos') statut(statutRepos);
  }
  // État du jeu et des clés (dernière réponse du serveur) -> début de la ligne d'état, dans la langue du moment.
  function majBase() {
    const j = infoEtat;
    pretRepos = DEMO === '1' || !j || (!j.injoignable && !j.erreur && !!(j.cle?.gemini || j.cle?.openai) && !!j.ck3);
    baseRepos = DEMO === '1' ? T.pretDemo : !j ? T.pret : j.injoignable ? T.injoignable : j.erreur ? T.cerveauIndisponible
      : !j.cle?.gemini && !j.cle?.openai ? T.aucuneCle : !j.ck3 ? T.ck3Absent : T.pretVersion(j.version);
    majRepos();
  }

  async function chargerEtat() {
    if (DEMO === '1') return majBase();
    try { infoEtat = await (await fetch(`/api/jeu/etat?langue=${langue}`)).json(); } catch { infoEtat = {injoignable: true}; }
    majBase();
  }
  if (langue !== 'fr') appliquerLangue(langue, true);   // ?langue=en : textes fixes d'index.html (en français) remplacés
  chargerEtat();

  // ---------- Démonstration ----------
  const DEMO_SOURCES = {liens: [{titre: 'Hooks - CK3 Wiki', url: 'https://ck3.paradoxwikis.com/Hooks'}, {titre: 'Patch 1.20 - CK3 Wiki', url: 'https://ck3.paradoxwikis.com/Patch_1.20'}],
    suggestionsHtml: '<style>.container{font-family:Roboto,Arial,sans-serif;display:flex;align-items:center;gap:8px;padding:6px 2px}'
      + '.chip{display:inline-block;border:1px solid #5f6368;border-radius:16px;padding:5px 14px;color:#e8eaed;font-size:13px;text-decoration:none;white-space:nowrap}'
      + '.carousel{overflow-x:auto;white-space:nowrap;scrollbar-width:none}</style><div class="container"><div class="carousel">'
      + '<a class="chip" href="https://www.google.com/search?q=ck3+fabricate+hook">ck3 fabricate hook</a> '
      + '<a class="chip" href="https://www.google.com/search?q=ck3+1.20+hooks">ck3 1.20 hooks</a></div></div>'};

  function simulerEcoute(g) {
    const t0 = performance.now();
    surveillance = setInterval(() => {
      if (g !== generation) return;
      const t = (performance.now() - t0) / 1000;
      corps.style.setProperty('--niveau', (Math.abs(Math.sin(t * 7)) * .6 + Math.random() * .3).toFixed(3));
      if (t > 2.2) { corps.style.setProperty('--niveau', 0); terminerEcoute(); }
    }, 60);
  }

  async function simulerReponse(g) {
    for (const [etape, t] of T.demoEtapes) { if (g !== generation) return; traiter({type: 'etape', etape, texte: t}); if (etape === 'ecoute') traiter({type: 'question', texte: T.demoQuestion}); await pause(450); }
    for (const morceau of T.demoReponse.match(/[\s\S]{1,14}/g)) { if (g !== generation) return; traiter({type: 'texte', delta: morceau}); await pause(45); }
    if (g !== generation) return;
    traiter({type: 'sources', ...DEMO_SOURCES});
    traiter({type: 'etape', etape: 'voix', texte: T.voixEnCours});
    await pause(300);
    if (g === generation) traiter({type: 'fin', ms: 6400, coutCents: 1.2});
  }

  // État figé pour les captures d'écran (&etat=…), sans attente.
  function figer(e) {
    if (params.get('coin')) corps.dataset.coin = params.get('coin');
    if (e === 'ecoute') { changerEtat('ecoute'); corps.style.setProperty('--niveau', .62); statut(T.ecoute); }
    if (e === 'reflexion') { agrandir(true); changerEtat('reflexion'); traiter({type: 'question', texte: T.demoQuestion}); traiter({type: 'etape', etape: 'recherche', texte: T.demoEtapes[3][1]}); }
    if (e === 'reponse' || e === 'parle') {
      agrandir(true); changerEtat('reponse');
      traiter({type: 'question', texte: T.demoQuestion});
      traiter({type: 'texte', delta: T.demoReponse}); traiter({type: 'sources', ...DEMO_SOURCES}); traiter({type: 'fin', ms: 6400, coutCents: 1.2});
      if (e === 'parle') corps.classList.add('parle');
    }
    if (e === 'erreur') { agrandir(true); traiter({type: 'erreur', message: T.demoErreur}); }
  }
  if (DEMO && params.get('etat')) figer(params.get('etat'));
  else if (params.get('coin')) corps.dataset.coin = params.get('coin');

  // ---------- Battement (09/10/2026) ----------
  // Toutes les 3 s, la page dit à Electron qu'elle tourne, et si le panneau est affiché. Sans battement pendant 10 s, Electron
  // replie la fenêtre et recharge la page (puis arrête son processus, puis recrée la fenêtre) ; panneau caché dans une fenêtre
  // restée grande, il la replie (un grand cadre transparent mangerait les clics du jeu).
  const battre = () => { try { pont.battement?.({agrandi: corps.classList.contains('agrandi'), etat, garde: corps.classList.contains('garde'), glisse: glissements > 0}); } catch {} };
  battre();
  setInterval(battre, 3000);
})();
