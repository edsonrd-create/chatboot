// Conexão WhatsApp por QR Code (WhatsApp Web / "Aparelhos conectados") via Baileys.
// ATENÇÃO: canal NÃO OFICIAL. Pode levar a banimento do número; use chip separado.
// Dependências carregadas sob demanda para não afetar testes e o modo Meta oficial.
import fs from 'node:fs';
import path from 'node:path';

const MEDIA_TYPES = new Set(['image', 'sticker', 'audio', 'video', 'document']);
export function createQrManager({authDir, onIncoming, onStatus, onLoggedOut, log = () => {}, agent}) {
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
      shouldSyncHistoryMessage: () => true,
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
          try { await onLoggedOut?.(slot); } catch {}
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
    const handle = async (m, {history = false} = {}) => {
      const parsed = parseWaMessage(m);
      if (!parsed) return;
      let audio = null, media = null;
      // Mídia recente (foto, figurinha, áudio, vídeo curto) é baixada para aparecer na central como no WhatsApp Web.
      if (!history && MEDIA_TYPES.has(parsed.type)) {
        try {
          const buffer = await baileys.downloadMediaMessage(m, 'buffer', {}, {reuploadRequest: sock.updateMediaMessage});
          if (buffer.length <= 16 * 1024 * 1024) media = {buffer, mimeType: parsed.mimeType || 'application/octet-stream'};
          if (parsed.type === 'audio' && !parsed.fromMe) audio = {buffer, mimeType: parsed.mimeType || 'audio/ogg'};
        } catch (e) { log(`[QR] não baixou a mídia: ${String(e.message || e).slice(0, 100)}`); }
      }
      await onIncoming({slot, ...parsed, audio, media, history});
    };
    sock.ev.on('messages.upsert', async ({messages, type}) => {
      if (type !== 'notify' && type !== 'append') return;
      for (const m of messages) {
        try { await handle(m, {history: type === 'append'}); }
        catch (e) { log(`[QR] erro ao processar mensagem: ${String(e.message || e).slice(0, 120)}`); }
      }
    });
    // Histórico enviado pelo celular ao conectar (como o WhatsApp Web carrega as conversas recentes).
    sock.ev.on('messaging-history.set', async ({messages = []}) => {
      const cutoff = Date.now() / 1000 - 30 * 24 * 3600;
      const recent = messages.filter(m => Number(m.messageTimestamp || 0) >= cutoff).slice(-3000);
      let n = 0;
      for (const m of recent) { try { await handle(m, {history: true}); n++; } catch {} }
      if (n) log(`[QR] WhatsApp ${slot}: ${n} mensagens do histórico importadas`);
    });
    // Confirmações de entrega/leitura (✓ ✓✓ azul) das mensagens que enviamos.
    sock.ev.on('messages.update', async updates => {
      for (const u of updates || []) {
        const code = u?.update?.status;
        if (!u?.key?.fromMe || typeof code !== 'number') continue;
        const delivery = code >= 4 ? 'read' : code === 3 ? 'delivered' : code === 2 ? 'sent' : null;
        if (delivery) try { await onStatus?.({slot, id: u.key.id, delivery}); } catch {}
      }
    });
    return status(slot);
  }

  const avatarCache = new Map();
  async function avatar(slot, jid) {
    const s = get(slot);
    if (!s.sock || s.state !== 'connected') return null;
    const key = `${slot}:${jid}`, hit = avatarCache.get(key);
    if (hit && Date.now() - hit.at < (hit.url ? 6 : 1) * 3600 * 1000) return hit.url;
    let url = null;
    // Foto em alta; se o contato só libera a miniatura, usa a miniatura.
    for (const kind of ['image', 'preview']) {
      try { url = await s.sock.profilePictureUrl(jid, kind, 8000); } catch {}
      if (url) break;
    }
    avatarCache.set(key, {url, at: Date.now()});
    return url;
  }

  async function send(slot, jid, text) {
    const s = get(slot);
    if (!s.sock || s.state !== 'connected') throw Object.assign(new Error('WhatsApp por QR não está conectado'), {status: 409});
    const to = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    const r = await s.sock.sendMessage(to, {text});
    return {id: r?.key?.id || null};
  }

  // Anexos enviados pelo atendente: foto, vídeo, áudio ou documento (PDF, planilha, etc.).
  async function sendMedia(slot, jid, {buffer, mimeType, fileName, caption}) {
    const s = get(slot);
    if (!s.sock || s.state !== 'connected') throw Object.assign(new Error('WhatsApp por QR não está conectado'), {status: 409});
    const to = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    const mime = String(mimeType || 'application/octet-stream');
    const content = /^image\/(jpeg|png|webp)$/.test(mime) ? {image: buffer, mimetype: mime, caption}
      : mime === 'video/mp4' ? {video: buffer, mimetype: mime, caption}
      : /^audio\//.test(mime) ? {audio: buffer, mimetype: mime}
      : {document: buffer, mimetype: mime, fileName: fileName || 'arquivo', caption};
    const r = await s.sock.sendMessage(to, content);
    return {id: r?.key?.id || null};
  }

  async function sendVoice(slot, jid, ogg) {
    const s = get(slot);
    if (!s.sock || s.state !== 'connected') throw Object.assign(new Error('WhatsApp por QR não está conectado'), {status: 409});
    const to = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    const r = await s.sock.sendMessage(to, {audio: ogg, mimetype: 'audio/ogg; codecs=opus', ptt: true});
    return {id: r?.key?.id || null};
  }

  // "digitando…" / "gravando áudio…" enquanto a IA prepara a resposta.
  async function presence(slot, jid, kind) {
    const s = get(slot);
    if (!s.sock || s.state !== 'connected') return;
    try { await s.sock.sendPresenceUpdate(kind, jid); } catch {}
  }

  async function logout(slot) {
    const s = get(slot);
    s.manualStop = true;
    try { await s.sock?.logout(); } catch {}
    try { s.sock?.end?.(); } catch {}
    s.sock = null; s.qr = null; s.number = null; s.state = 'disconnected';
    fs.rmSync(dirFor(slot), {recursive: true, force: true});
    try { await onLoggedOut?.(slot); } catch {}
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

  return {start, hasSession: slot => fs.existsSync(path.join(dirFor(slot), 'creds.json')), send, sendMedia, sendVoice, presence, avatar, logout, status, resume, isConnected: slot => get(slot).state === 'connected'};
}

// Converte a mensagem do WhatsApp (Baileys) para o formato da central. null = ignorar (grupo, status, reação, sistema).
const unwrap = msg => {
  let x = msg;
  for (let i = 0; i < 5 && x; i++) {
    const inner = x.ephemeralMessage?.message || x.viewOnceMessage?.message || x.viewOnceMessageV2?.message || x.viewOnceMessageV2Extension?.message || x.documentWithCaptionMessage?.message || x.editedMessage?.message;
    if (!inner) break;
    x = inner;
  }
  return x || {};
};
export function parseWaMessage(m) {
  if (!m?.message || !m.key) return null;
  const jid = m.key.remoteJid || '';
  if (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@lid')) return null; // grupos, status, canais
  const msg = unwrap(m.message);
  if (msg.protocolMessage || msg.reactionMessage || msg.senderKeyDistributionMessage && Object.keys(msg).length === 1 || msg.pollUpdateMessage) return null;
  let type = 'text', text = msg.conversation || msg.extendedTextMessage?.text || '', mimeType = '';
  if (msg.imageMessage) { type = 'image'; mimeType = msg.imageMessage.mimetype || 'image/jpeg'; text = msg.imageMessage.caption ? `📷 ${msg.imageMessage.caption}` : '📷 Foto'; }
  else if (msg.videoMessage) { type = 'video'; mimeType = msg.videoMessage.mimetype || 'video/mp4'; text = msg.videoMessage.caption ? `🎥 ${msg.videoMessage.caption}` : '🎥 Vídeo'; }
  else if (msg.audioMessage) { type = 'audio'; text = ''; mimeType = msg.audioMessage.mimetype || 'audio/ogg'; }
  else if (msg.stickerMessage) { type = 'sticker'; mimeType = msg.stickerMessage.mimetype || 'image/webp'; text = '🏷️ Figurinha'; }
  else if (msg.documentMessage) { type = 'document'; mimeType = msg.documentMessage.mimetype || 'application/octet-stream'; text = `📄 ${msg.documentMessage.fileName || 'Documento'}`; }
  else if (msg.locationMessage || msg.liveLocationMessage) { const l = msg.locationMessage || msg.liveLocationMessage; type = 'location'; text = `📍 Localização: https://maps.google.com/?q=${l.degreesLatitude},${l.degreesLongitude}`; }
  else if (msg.contactMessage || msg.contactsArrayMessage) { type = 'contact'; text = `👤 Contato: ${msg.contactMessage?.displayName || 'contatos'}`; }
  else if (msg.buttonsResponseMessage || msg.listResponseMessage || msg.templateButtonReplyMessage) { text = msg.buttonsResponseMessage?.selectedDisplayText || msg.listResponseMessage?.title || msg.templateButtonReplyMessage?.selectedDisplayText || ''; }
  if (!text && type === 'text') return null;
  const ts = Number(m.messageTimestamp?.low ?? m.messageTimestamp ?? 0);
  return {jid, from: jid.split('@')[0], name: m.key.fromMe ? '' : (m.pushName || ''), id: m.key.id, fromMe: Boolean(m.key.fromMe), text, type, mimeType, at: ts ? new Date(ts * 1000).toISOString() : null};
}
