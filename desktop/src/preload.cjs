'use strict';
const {contextBridge, ipcRenderer} = require('electron');

// Exposição estritamente limitada à interface LOCAL. Nada é exposto a web.whatsapp.com.
contextBridge.exposeInMainWorld('gutoDesktop', Object.freeze({
  layout: bounds => ipcRenderer.send('guto:layout', bounds),
  switchChannel: slot => ipcRenderer.invoke('guto:switch', slot),
  reload: () => ipcRenderer.invoke('guto:reload'),
  copyDraft: value => ipcRenderer.invoke('guto:copy', value),
  onStatus: callback => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('guto:status', (_event, value) => callback(value));
  }
}));
