'use strict';

const path = require('node:path');
const {app, BrowserWindow, WebContentsView, ipcMain, session, clipboard} = require('electron');
const {WHATSAPP_ORIGIN, PARTITIONS, validSlot, isWhatsAppUrl, normalizeBounds, safeDraftText} = require('./policy.cjs');

let window = null;
const views = new Map();
let activeSlot = 1;
let lastBounds = null;

if (process.platform === 'win32') app.setAppUserModelId('br.com.gutoexpress.whatsappdesk');

function sendState(slot, status) {
  if (!window || window.isDestroyed()) return;
  window.webContents.send('guto:status', {slot, status});
}

function createWhatsAppView(slot) {
  if (!validSlot(slot)) throw new TypeError('Canal inválido');
  const partition = PARTITIONS[slot];
  const currentSession = session.fromPartition(partition);
  // A sessão de cada número fica no perfil local do Windows, nunca no Render.
  currentSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  currentSession.setPermissionCheckHandler(() => false);
  const view = new WebContentsView({
    webPreferences: {
      partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      spellcheck: true
    }
  });
  const contents = view.webContents;
  contents.setWindowOpenHandler(() => ({action: 'deny'}));
  contents.on('will-navigate', (event, target) => {
    if (!isWhatsAppUrl(target)) {
      event.preventDefault();
      sendState(slot, 'Navegação externa bloqueada por segurança');
    }
  });
  contents.on('will-redirect', (event, target) => {
    if (!isWhatsAppUrl(target)) event.preventDefault();
  });
  contents.on('did-start-loading', () => sendState(slot, 'Carregando WhatsApp Web…'));
  contents.on('did-stop-loading', () => sendState(slot, 'Página carregada · conexão não verificada'));
  contents.on('did-fail-load', (_event, code, description, url, mainFrame) => {
    if (mainFrame !== false && code !== -3) sendState(slot, `Falha de carregamento (${code}). WhatsApp Web pode restringir este navegador.`);
  });
  views.set(slot, view);
  return view;
}

function showSlot(slot) {
  if (!validSlot(slot) || !window || window.isDestroyed()) return false;
  for (const [number, view] of views) {
    if (number !== slot && window.contentView.children.includes(view)) window.contentView.removeChildView(view);
  }
  const current = views.get(slot) || createWhatsAppView(slot);
  activeSlot = slot;
  if (!window.contentView.children.includes(current)) window.contentView.addChildView(current);
  if (lastBounds) current.setBounds(lastBounds);
  if (!current.webContents.getURL()) {
    current.webContents.loadURL(WHATSAPP_ORIGIN + '/').catch(() => {
      sendState(slot, 'Não foi possível abrir o WhatsApp Web. Verifique rede e compatibilidade.');
    });
  }
  return true;
}

function createWindow() {
  window = new BrowserWindow({
    width: 1500,
    height: 880,
    minWidth: 1060,
    minHeight: 650,
    title: 'Guto Express | WhatsApp Web na Automação',
    backgroundColor: '#f3f5f6',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false
    }
  });
  window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.on('resize', () => {
    if (!lastBounds) return;
    const normalized = normalizeBounds(lastBounds, window.getContentBounds());
    if (normalized) {
      lastBounds = normalized;
      views.get(activeSlot)?.setBounds(normalized);
    }
  });
  window.on('closed', () => {
    for (const view of views.values()) {
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    views.clear();
    lastBounds = null;
    window = null;
  });
  window.webContents.once('did-finish-load', () => showSlot(1));
  window.once('ready-to-show', () => window?.show());
  window.loadFile(path.join(__dirname, '..', 'renderer', 'host.html'));
}

app.whenReady().then(() => {
  // IPC somente do HTML próprio. O WhatsApp remoto não possui preload nem acesso ao Node.
  const authorized = event => Boolean(window && !window.isDestroyed() && event.sender === window.webContents);
  ipcMain.on('guto:layout', (event, bounds) => {
    if (!authorized(event)) return;
    const normalized = normalizeBounds(bounds, window.getContentBounds());
    if (!normalized) return;
    lastBounds = normalized;
    views.get(activeSlot)?.setBounds(normalized);
  });
  ipcMain.handle('guto:switch', (event, slot) => {
    if (!authorized(event)) return {ok:false};
    return {ok: showSlot(slot), slot: activeSlot};
  });
  ipcMain.handle('guto:reload', (event) => {
    if (!authorized(event)) return false;
    const view = views.get(activeSlot);
    if (!view) return false;
    view.webContents.reload();
    return true;
  });
  ipcMain.handle('guto:copy', (event, draft) => {
    if (!authorized(event)) return false;
    clipboard.writeText(safeDraftText(draft));
    return true;
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
