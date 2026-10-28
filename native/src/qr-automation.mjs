// Diagnóstico determinístico e seguro da resposta automática por WhatsApp QR.
// Não expõe valores de chaves de API, tokens, telefones de teste ou dados de clientes.
export function envFlag(value){
  if(value===true)return true;
  if(value===false||value==null)return false;
  const normalized=String(value).trim().replace(/^(["'])(.*)\1$/,'$2').trim().toLowerCase();
  return ['true','1','yes','on','sim'].includes(normalized);
}
export function qrPreflight({freePreview=false,enabled=false,autoReply=false,aiConfigured=false,connected=false,numberAllowed=true,threadMode='BOT',hasText=true}={}){
  const blockers=[];
  if(freePreview)blockers.push('FREE_PREVIEW_MODE');
  if(!enabled)blockers.push('WA_QR_ENABLED');
  if(!autoReply)blockers.push('WA_QR_AUTOREPLY');
  if(!aiConfigured)blockers.push('AI_API_KEY');
  if(!connected)blockers.push('WHATSAPP_DISCONNECTED');
  if(!numberAllowed)blockers.push('WA_QR_TEST_NUMBERS');
  if(threadMode!=='BOT')blockers.push('THREAD_HUMAN');
  if(!hasText)blockers.push('MESSAGE_NOT_TEXT');
  return {ready:blockers.length===0,blockers};
}
const reasons={
  FREE_PREVIEW_MODE:'O modo de prévia pública bloqueia respostas a clientes.',
  WA_QR_ENABLED:'Ative WA_QR_ENABLED=true nas variáveis de ambiente do serviço.',
  WA_QR_AUTOREPLY:'Ative WA_QR_AUTOREPLY=true nas variáveis de ambiente do serviço e aplique o deploy.',
  AI_API_KEY:'Falta a chave da IA selecionada: GEMINI_API_KEY ou OPENAI_API_KEY.',
  WHATSAPP_DISCONNECTED:'O WhatsApp deste canal não está conectado por QR.',
  WA_QR_TEST_NUMBERS:'Este cliente não está na lista WA_QR_TEST_NUMBERS.',
  THREAD_HUMAN:'A conversa está em atendimento humano. Clique em Ativar IA para essa conversa.',
  MESSAGE_NOT_TEXT:'Não existe texto processável nesta mensagem. Verifique áudio/mídia.'
};
export function qrBlockerMessage(blockers){
  if(!Array.isArray(blockers)||!blockers.length)return 'Resposta automática disponível.';
  return blockers.map(code=>reasons[code]||'Pré-requisito indisponível.').join(' ');
}
export function qrSupportStatus({freePreview=false,enabled=false,autoReply=false,aiConfigured=false,slots=[],restricted=false}={}){
  const items=[1,2].map(slot=>{
    const connection=slots.find(x=>x.slot===slot)||{slot,state:'disconnected'};
    const check=qrPreflight({freePreview,enabled,autoReply,aiConfigured,connected:connection.state==='connected'});
    return {...connection,replyReady:check.ready,blockers:check.blockers};
  });
  return {
    enabled:Boolean(enabled),
    autoReply:Boolean(autoReply),
    autoReplyConfigured:Boolean(enabled&&autoReply),
    aiConfigured:Boolean(aiConfigured),
    testNumbersOnly:Boolean(restricted),
    active:Boolean(items.some(x=>x.replyReady)),
    slots:items,
    blockers:[...new Set(items.flatMap(x=>x.blockers))],
    help:qrBlockerMessage([...new Set(items.flatMap(x=>x.blockers))])
  };
}
