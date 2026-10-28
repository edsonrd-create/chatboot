'use strict';
// Auto Atendimento Express Desktop: WhatsApp Web REAL carregado diretamente no Electron.
// NÃO intercepta conversas, NÃO automatiza o site e NÃO envia pedidos para o PDV.
const path = require('node:path');
const {app, BrowserWindow, WebContentsView, ipcMain, session, clipboard, shell} = require('electron');
const {WHATSAPP_ORIGIN, SLOTS, PARTITIONS, validSlot, isWhatsAppUrl, normalizeBounds, safeDraftText, parseDesktopLayout} = require('./policy.cjs');

let window = null;
const views = new Map();
const viewStatus = new Map();
let activeSlot = 1;
let layoutState = null;

if (process.platform === 'win32') app.setAppUserModelId('br.com.gutoexpress.autoatendimento');

// Uma única instância: duas cópias abertas disputariam os mesmos perfis do WhatsApp e corromperiam a sessão.
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.focus(); } });

// O WhatsApp Web recusa navegadores que não se identificam como Chrome ("atualize o navegador").
// Usamos o agente do Chromium embutido no próprio Electron, sem o sufixo "Electron/x".
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${String(process.versions.chrome || '140').split('.')[0]}.0.0.0 Safari/537.36`;
app.userAgentFallback = CHROME_UA;

// Somente o WhatsApp Web oficial pode pedir: notificações de mensagem, microfone (áudio) e copiar texto.
const ALLOWED_PERMISSIONS = new Set(['notifications', 'media', 'clipboard-sanitized-write', 'fullscreen']);
function permissionAllowed(permission, origin, details) {
  if (!ALLOWED_PERMISSIONS.has(permission) || !isWhatsAppUrl(String(origin || ''))) return false;
  if (permission === 'media') {
    const types = (details && details.mediaTypes) || [];
    return types.every(t => t === 'audio'); // áudio sim; câmera continua bloqueada
  }
  return true;
}
const unread = new Map();
function updateUnread(slot, title) {
  const m = /^\((\d+)\)/.exec(String(title || ''));
  const count = m ? Number(m[1]) : 0;
  const before = unread.get(slot) || 0;
  unread.set(slot, count);
  const total = [...unread.values()].reduce((a, b) => a + b, 0);
  if (window && !window.isDestroyed()) {
    window.setTitle((total ? `(${total}) ` : '') + 'Auto Atendimento Express | WhatsApp Web oficial');
    window.webContents.send('guto:unread', { slot, count });
    if (count > before && !window.isFocused()) window.flashFrame(true);
  }
}
function openExternalSafe(target) {
  try { const u = new URL(target); if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(u.toString()); } catch {}
}

function state(slot, status, detail=''){
  if(!validSlot(slot)) return;
  viewStatus.set(slot,{slot,status,detail});
  if(window && !window.isDestroyed())window.webContents.send('guto:status',{slot,status,detail});
}
function createWhatsAppView(slot){
  if(!validSlot(slot))throw new TypeError('Canal inválido');
  const profile = session.fromPartition(PARTITIONS[slot]);
  // Por padrão, não liberar mídia ou permissões sensíveis para páginas remotas.
  profile.setUserAgent(CHROME_UA);
  profile.setPermissionRequestHandler((wc,permission,callback,details)=>callback(permissionAllowed(permission,(details&&details.requestingUrl)||wc.getURL(),details)));
  profile.setPermissionCheckHandler((_wc,permission,origin,details)=>permissionAllowed(permission,origin,details));
  try{profile.setSpellCheckerLanguages(['pt-BR']);}catch{}
  const view = new WebContentsView({webPreferences:{
    partition:PARTITIONS[slot],
    sandbox:true,
    contextIsolation:true,
    nodeIntegration:false,
    webSecurity:true,
    webviewTag:false,
    spellcheck:true
  }});
  const wc=view.webContents;
  wc.setUserAgent(CHROME_UA);
  // Links recebidos nas conversas abrem no navegador padrão, nunca dentro do app.
  wc.setWindowOpenHandler(({url})=>{openExternalSafe(url);return {action:'deny'};});
  wc.on('will-navigate',(event,target)=>{
    if(!isWhatsAppUrl(target)){event.preventDefault();openExternalSafe(target);}
  });
  wc.on('page-title-updated',(_event,title)=>updateUnread(slot,title));
  wc.on('will-redirect',(event,target)=>{
    if(!isWhatsAppUrl(target)){event.preventDefault();state(slot,'Redirecionamento não autorizado bloqueado');}
  });
  wc.on('did-start-loading',()=>state(slot,'Carregando WhatsApp Web oficial…'));
  wc.on('did-stop-loading',()=>state(slot,'WhatsApp Web carregado · login não verificado'));
  wc.on('did-fail-load',(_event,code,_description,_url,isMainFrame)=>{
    if(isMainFrame!==false && code!==-3)state(slot,'Falha de carregamento '+code+' · confira internet e compatibilidade');
  });
  wc.on('render-process-gone',(_event,details)=>state(slot,'A visualização travou ('+details.reason+'). Use Recarregar.'));
  views.set(slot,view);
  state(slot,'Preparando sessão isolada…');
  // O endereço vem do site oficial. Não carregar o HTML capturado nem QR fabricado.
  wc.loadURL(WHATSAPP_ORIGIN+'/').catch(()=>state(slot,'Não foi possível acessar o WhatsApp Web oficial'));
  return view;
}
function ensureView(slot){return views.get(slot)||createWhatsAppView(slot);}
function detach(view){
  if(window && !window.isDestroyed() && window.contentView.children.includes(view))window.contentView.removeChildView(view);
}
function applyLayout(input){
  if(!window || window.isDestroyed())return {ok:false};
  const selection=parseDesktopLayout(input,window.getContentBounds());
  if(!selection)return {ok:false,reason:'Dimensões inválidas'};
  activeSlot=selection.active;
  layoutState=selection;
  const slots=selection.mode==='split'?SLOTS:[activeSlot];
  for(const slot of SLOTS){
    const view=views.get(slot);
    if(view&&!slots.includes(slot))detach(view);
  }
  for(const slot of slots){
    const view=ensureView(slot);
    const bounds=selection.panes[slot];
    if(!window.contentView.children.includes(view))window.contentView.addChildView(view);
    view.setBounds(bounds);
  }
  return {ok:true,mode:selection.mode,active:activeSlot};
}
function selectChannel(slot){
  if(!validSlot(slot))return {ok:false};
  activeSlot=slot;
  ensureView(slot);
  // O renderer deve informar os novos limites antes de reconfigurar a janela.
  // Não reutilizar bounds da aba antiga: isso poderia deixar a área vazia.
  if(window&&!window.isDestroyed())window.webContents.send('guto:request-layout');
  return {ok:true,active:slot};
}
function reloadChannel(slot){
  if(!validSlot(slot))return false;
  const view=views.get(slot);
  if(!view||view.webContents.isDestroyed())return false;
  view.webContents.reload();
  return true;
}
function createWindow(){
  window=new BrowserWindow({
    width:1600,height:920,minWidth:1090,minHeight:660,
    title:'Auto Atendimento Express | WhatsApp Web oficial',
    backgroundColor:'#f3f5f6',show:false,autoHideMenuBar:true,
    webPreferences:{
      preload:path.join(__dirname,'preload.cjs'),
      sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,webviewTag:false
    }
  });
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
  window.on('focus',()=>window.flashFrame(false));
  window.on('resize',()=>{if(layoutState)window.webContents.send('guto:request-layout');});
  window.on('maximize',()=>window.webContents.send('guto:request-layout'));
  window.on('unmaximize',()=>window.webContents.send('guto:request-layout'));
  window.on('closed',()=>{
    for(const view of views.values()){
      try{if(!view.webContents.isDestroyed())view.webContents.close();}catch{}
    }
    views.clear();viewStatus.clear();unread.clear();layoutState=null;window=null;
  });
  window.webContents.once('did-finish-load',()=>{
    ensureView(1);
    window?.webContents.send('guto:request-layout');
  });
  window.once('ready-to-show',()=>window?.show());
  window.loadFile(path.join(__dirname,'..','renderer','host.html'));
}
app.whenReady().then(()=>{
  const allowed=event=>Boolean(window&&!window.isDestroyed()&&event.sender === window.webContents);
  ipcMain.on('guto:layout',(event,request)=>{if(allowed(event))applyLayout(request);});
  ipcMain.handle('guto:switch',(event,slot)=>{
    if(!allowed(event))return {ok:false};
    return selectChannel(slot);
  });
  ipcMain.handle('guto:reload',(event,slot)=>allowed(event)&&reloadChannel(slot));
  ipcMain.handle('guto:status-all',event=>{
    if(!allowed(event))return [];
    return SLOTS.map(slot=>viewStatus.get(slot)||{slot,status:'Sessão ainda não iniciada'});
  });
  ipcMain.handle('guto:copy',(event,draft)=>{
    if(!allowed(event))return false;
    clipboard.writeText(safeDraftText(draft));
    return true;
  });
  createWindow();
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
