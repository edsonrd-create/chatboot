'use strict';
const {contextBridge,ipcRenderer}=require('electron');
// Somente o renderer LOCAL possui esta API. O WhatsApp Web remoto nunca recebe preload.
contextBridge.exposeInMainWorld('gutoDesktop',Object.freeze({
  layout: request=>ipcRenderer.send('guto:layout',request),
  switchChannel: slot=>ipcRenderer.invoke('guto:switch',slot),
  reload: slot=>ipcRenderer.invoke('guto:reload',slot),
  statusAll: ()=>ipcRenderer.invoke('guto:status-all'),
  copyDraft: value=>ipcRenderer.invoke('guto:copy',value),
  onStatus: callback=>{
    if(typeof callback==='function')ipcRenderer.on('guto:status',(_event,value)=>callback(value));
  },
  onUnread: callback=>{
    if(typeof callback==='function')ipcRenderer.on('guto:unread',(_event,value)=>callback(value));
  },
  onLayoutRequest: callback=>{
    if(typeof callback==='function')ipcRenderer.on('guto:request-layout',()=>callback());
  }
}));
