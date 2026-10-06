// Pont minimal entre la page de l'icône et Electron (fenêtre isolée, sandbox) : rien d'autre n'est exposé à la page.
const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('copilote', {
  onRaccourci: cb => { ipcRenderer.on('raccourci', (_e, d) => cb(d)); },
  onEtat: cb => { ipcRenderer.on('etat', (_e, d) => cb(d)); },
  agrandir: oui => ipcRenderer.send('agrandir', !!oui),
  deplacer: (dx, dy) => ipcRenderer.send('deplacer', Number(dx) || 0, Number(dy) || 0),
  finDeplacement: () => ipcRenderer.send('fin-deplacement'),
  ouvrirLien: url => ipcRenderer.send('ouvrir-lien', String(url)),
  ecoute: oui => ipcRenderer.send('ecoute', !!oui),   // micro ouvert : l'icône reste visible tant qu'il l'est
  voix: () => ipcRenderer.invoke('voix'),
  basculerVoix: () => ipcRenderer.invoke('basculer-voix'),
});
