// Pont minimal entre la page de l'icône et Electron (fenêtre isolée, sandbox) : rien d'autre n'est exposé à la page.
// 09/10/2026 : battement (la page est vivante, panneau affiché ou non), événements pour le journal, menu du clic droit, et
// commandes d'Electron (replier). Electron revérifie tout ce qui arrive.
const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('copilote', {
  onRaccourci: cb => { ipcRenderer.on('raccourci', (_e, d) => cb(d)); },
  onEtat: cb => { ipcRenderer.on('etat', (_e, d) => cb(d)); },
  onCommande: cb => { ipcRenderer.on('commande', (_e, d) => cb(d)); },
  agrandir: oui => ipcRenderer.send('agrandir', !!oui),
  deplacer: (dx, dy) => ipcRenderer.send('deplacer', Number(dx) || 0, Number(dy) || 0),
  finDeplacement: () => ipcRenderer.send('fin-deplacement'),
  ouvrirLien: url => ipcRenderer.send('ouvrir-lien', String(url)),
  ecoute: oui => ipcRenderer.send('ecoute', !!oui),   // micro ouvert : l'icône reste visible tant qu'il l'est
  battement: d => ipcRenderer.send('battement', {agrandi: !!d?.agrandi, etat: String(d?.etat || '').slice(0, 20), garde: !!d?.garde, glisse: !!d?.glisse}),
  evenement: (nom, d) => ipcRenderer.send('evenement', String(nom || '').slice(0, 40), d && typeof d === 'object' ? JSON.parse(JSON.stringify(d)) : {}),
  menu: () => ipcRenderer.send('menu'),
  voix: () => ipcRenderer.invoke('voix'),
  basculerVoix: () => ipcRenderer.invoke('basculer-voix'),
});
