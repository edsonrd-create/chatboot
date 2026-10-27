// Conexão WhatsApp por QR Code (WhatsApp Web / "Aparelhos conectados") via Baileys.
// ATENÇÃO: canal NÃO OFICIAL. Pode levar a banimento do número; use chip separado.
// Dependências carregadas sob demanda para não afetar testes e o modo Meta oficial.
import fs from 'node:fs';
import path from 'node:path';

export function createQrManager({authDir, onIncoming, log = () => {}, agent}) {
  const slots = new Map(); // slot -> {state, qr, number, sock, lastError}
  const get = slot => {
    if (!slots.has(slot)) slots.set(slot, {state: 'disconnected', qr: null, number: null, sock: null, lastError: null, startedAt: null});
    return slots.get(slot);
  };
  let libs;
  async function load() {
    if (libs) return libs;
    const baileys = await import('@whiskeysockets/baileys');
    const QR = (await import('qrcode')).default;
    const pino = (await import('pino')).default;
    libs = {baileys, QR, pino};
    return libs;
  }
  const dirFor = slot => path.join(authDir, `slot-${slot}`);

  async function start(slot) {
    const s = get(slot);
    if (s.sock && (s.state === 'connected' || s.state === 'qr' || s.state === 'connecting')) return status(slot);
    const {baileys, QR, pino} = await load();
    const makeWASocket = baileys.default?.default || baileys.default || baileys.makeWASocket;
    const {useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers} = baileys;
    fs.mkdirSync(dirFor(slot), {recursive: true});
    const {state, saveCreds} = await useMultiFileAuthState(dirFor(slot));
    let version;
    try { ({version} = await fetchLatestBaileysVersion()); } catch {}
    s.state = 'connecting'; s.qr = null; s.lastError = null; s.startedAt = Date.now(); s.manualStop = false;
    const sock = makeWASocket({
      auth: state,
      version,
      logger: pino({level: process.env.WADEBUG||'silent'}),
      browser: Browsers ? Browsers.ubuntu('Guto Bot') : ['Guto Bot', 'Chrome', '1.0'],
      markOnlineOnConnect: false,
      syncFullHistory: false,
      ...(agent ? {agent, fetchAgent: agent} : {})
    });
    s.sock = sock;
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async update => {
      const {connection, lastDisconnect, qr} = update;
      if (qr) {
        try { s.qr = await QR.toDataURL(qr, {margin: 1, width: 320}); s.state = 'qr'; } catch (e) { s.lastError = 'Falha ao gerar QR'; }
      }
      if (connection === 'open') {
        s.state = 'connected'; s.qr = null;
        s.number = String(sock.user?.id || '').split(':')[0].split('@')[0] || null;
        log(`[QR] WhatsApp ${slot} conectado`);
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        s.sock = null; s.qr = null;
        if (loggedOut) {
          s.state = 'disconnected'; s.number = null; s.lastError = 'Sessão encerrada no celular';
          fs.rmSync(dirFor(slot), {recursive: true, force: true});
        } else if (s.manualStop) {
          s.state = 'disconnected';
        } else if (code === DisconnectReason.timedOut && !s.number) {
          // QR expirou sem leitura: para de gerar códigos até o usuário pedir de novo.
          s.state = 'disconnected'; s.lastError = 'QR Code expirou. Clique em Gerar QR Code.';
        } else {
          // Reconexão automática (ex.: restart 515 após ler o QR, queda de rede).
          s.state = 'connecting';
          setTimeout(() => start(slot).catch(e => { s.state = 'error'; s.lastError = String(e.message || e).slice(0, 120); }), 2000);
        }
      }
    });
    sock.ev.on('messages.upsert', async ({messages, type}) => {
      if (type !== 'notify') return;
      for (const m of messages) {
        try {
          if (!m.message || m.key.fromMe) continue;
          const jid = m.key.remoteJid || '';
          if (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@lid')) continue; // ignora grupos/status
          const msg = m.message;
          const text = msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || '';
          const type = text ? 'text' : (msg.audioMessage ? 'audio' : msg.imageMessage ? 'image' : 'other');
          await onIncoming({slot, jid, from: jid.split('@')[0], name: m.pushName || '', id: m.key.id, text, type});
        } catch (e) { log(`[QR] erro ao processar mensagem: ${String(e.message || e).slice(0, 120)}`); }
      }
    });
    return status(slot);
  }

  async function send(slot, jid, text) {
    const s = get(slot);
    if (!s.sock || s.state !== 'connected') throw Object.assign(new Error('WhatsApp por QR não está conectado'), {status: 409});
    const to = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    const r = await s.sock.sendMessage(to, {text});
    return {id: r?.key?.id || null};
  }

  async function logout(slot) {
    const s = get(slot);
    s.manualStop = true;
    try { await s.sock?.logout(); } catch {}
    try { s.sock?.end?.(); } catch {}
    s.sock = null; s.qr = null; s.number = null; s.state = 'disconnected';
    fs.rmSync(dirFor(slot), {recursive: true, force: true});
    return status(slot);
  }

  function status(slot) {
    const s = get(slot);
    return {slot, state: s.state, qr: s.qr, number: s.number, error: s.lastError};
  }

  // Reconecta automaticamente sessões salvas (após reinício do servidor).
  async function resume() {
    for (const slot of [1, 2]) {
      if (fs.existsSync(path.join(dirFor(slot), 'creds.json'))) start(slot).catch(() => {});
    }
  }

  return {start, send, logout, status, resume, isConnected: slot => get(slot).state === 'connected'};
}
