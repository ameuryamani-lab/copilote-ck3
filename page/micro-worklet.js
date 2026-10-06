// Micro → 16 kHz mono en entiers 16 bits, par paquets de 50 ms (800 échantillons), avec le niveau (RMS) de chaque paquet pour
// l'anneau rouge et la détection du silence. Le micro tourne à 44,1 ou 48 kHz : chaque échantillon de sortie est la moyenne des
// échantillons d'entrée de sa fenêtre (filtre passe-bas grossier, suffisant pour la voix et sans dépendance).
class Micro16k extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pas = sampleRate / 16000;
    this.pos = 0; this.somme = 0; this.n = 0;
    this.paquet = new Int16Array(800); this.i = 0; this.energie = 0;
    this.actif = true;
    this.port.onmessage = e => { if (e.data === 'stop') { this.envoyer(); this.port.postMessage({fin: true}); this.actif = false; } };
  }

  envoyer() {
    if (!this.i) return;
    const pcm = this.paquet.slice(0, this.i);
    this.port.postMessage({pcm, niveau: Math.sqrt(this.energie / this.i)}, [pcm.buffer]);
    this.i = 0; this.energie = 0;
  }

  process(entrees) {
    if (!this.actif) return false;
    const canal = entrees[0] && entrees[0][0];
    if (canal) for (let k = 0; k < canal.length; k++) {
      this.somme += canal[k]; this.n++; this.pos += 1;
      if (this.pos < this.pas) continue;
      this.pos -= this.pas;
      const v = Math.max(-1, Math.min(1, this.somme / this.n));
      this.somme = 0; this.n = 0;
      this.paquet[this.i++] = v < 0 ? v * 32768 : v * 32767;
      this.energie += v * v;
      if (this.i === this.paquet.length) this.envoyer();
    }
    return true;
  }
}

registerProcessor('micro-16k', Micro16k);
