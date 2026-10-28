// Central operacional própria da Guto Express.
// Não envia mensagens ao WhatsApp, não altera preços e nunca escreve no PDV.
export const STATES=Object.freeze(['HUMAN','WAITING','CLOSED','FAILED']);
export const CHANNEL_SLOTS=Object.freeze([1,2]);
const MAX_AUDIT=500;
const reject=(status,message)=>{const e=new Error(message);e.status=status;throw e;};
const text=(value,max=300)=>typeof value==='string'?value.trim().slice(0,max):'';
const channelId=x=>Number.isInteger(Number(x))&&CHANNEL_SLOTS.includes(Number(x))?Number(x):null;
const validActor=v=>/^[a-zA-Z0-9_ .-]{2,50}$/.test(String(v||''));
const stamp=(clock)=>new Date(clock()).toISOString();
const baseConfig=slot=>({slot,provider:'gemini',model:'gemini-2.5-flash',enabled:false,requestedEnabled:false,instructions:'',personality:'Atendimento claro e cordial',hours:{start:'15:00',end:'23:45'},humanTransfer:true});
const hoursValid=v=>typeof v==='string'&&/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v);
const getChannel=d=>d?.settings?.channels||{};
export function channelConfig(d,slot){
  const id=channelId(slot);if(!id)reject(422,'WhatsApp deve ser 01 ou 02');
  const cfg=getChannel(d)?.[String(id)]||{};
  const {provider,model,enabled,requestedEnabled,instructions,personality,hours,humanTransfer}=cfg;
  return {...baseConfig(id),provider:provider||'gemini',model:model||'gemini-2.5-flash',enabled:false,requestedEnabled:Boolean(requestedEnabled),instructions:instructions||'',personality:personality||'Atendimento claro e cordial',hours:hours||{start:'15:00',end:'23:45'},humanTransfer:humanTransfer!==false};
}
export function setChannelConfig(d,slot,config,{clock=Date.now,actor='admin'}={}){
  const id=channelId(slot);if(!id)reject(422,'Número de canal inválido');
  if(!config||typeof config!=='object'||Array.isArray(config))reject(422,'Configuração inválida');
  const allowed=new Set(['provider','model','requestedEnabled','instructions','personality','hours','humanTransfer']);
  if(Object.keys(config).some(k=>!allowed.has(k)))reject(422,'Campo não autorizado para esta configuração');
  if(config.provider!==undefined&&config.provider!=='gemini')reject(422,'Nesta fase, cada canal usa Gemini somente em homologação');
  if(config.model!==undefined&&(!/^gemini-[a-z0-9.-]{3,70}$/.test(config.model)))reject(422,'Modelo Gemini inválido');
  if(config.instructions!==undefined&&(typeof config.instructions!=='string'||config.instructions.length>4000))reject(422,'Instruções inválidas');
  if(config.personality!==undefined&&(typeof config.personality!=='string'||config.personality.length>160))reject(422,'Personalidade inválida');
  if(config.requestedEnabled!==undefined&&typeof config.requestedEnabled!=='boolean')reject(422,'Ativação deve ser booleana');
  if(config.humanTransfer!==undefined&&typeof config.humanTransfer!=='boolean')reject(422,'Transferência deve ser booleana');
  if(config.hours!==undefined&&(!config.hours||typeof config.hours!=='object'||!hoursValid(config.hours.start)||!hoursValid(config.hours.end)))reject(422,'Horários inválidos');
  const previous=channelConfig(d,id);
  const next={...previous,...config,slot:id,provider:'gemini',enabled:false};
  next.instructions=text(next.instructions,4000);
  next.personality=text(next.personality,160);
  if(!d.settings)d.settings={};
  if(!d.settings.channels)d.settings.channels={};
  d.settings.channels[String(id)]=next;
  // O pedido de ativação é salvo como intenção; liberação real continua impossível.
  d.settings.autoReply=false;
  d.settings.approvedForProduction=false;
  audit(d,{actor,action:'CHANNEL_SETTINGS_UPDATED',slot:id,clock});
  return next;
}
export function stateOf(thread){
  const explicit=thread?.operationalState;
  if(STATES.includes(explicit))return explicit;
  return thread?.mode==='HUMAN'?'HUMAN':'WAITING';
}
export function threadInfo(thread){
  return {id:thread.id,slot:thread.slot,customer:thread.customer,customerName:thread.customerName,
    mode:thread.mode,via:thread.via||'meta',state:stateOf(thread),version:thread.version||0,qrLastBlocker:thread.qrLastBlocker||null,qrLastErrorAt:thread.qrLastErrorAt||null,
    assignedTo:thread.assignedTo||null,favorite:!!thread.favorite,archived:!!thread.archived,
    updatedAt:thread.updatedAt,unread:thread.unread||0,lastText:thread.messages?.at(-1)?.text||'',
    messageCount:thread.messages?.length||0,orderCount:thread.orders?.length||0};
}
export function listThreads(d,{slot=0,filter='all',q=''}={}){
 const selected=slot===0?0:channelId(slot);if(selected===null)reject(422,'Filtro de canal inválido');
 const valid=new Set(['all','unread','favorites','archived','waiting','human','closed','failed']);
 if(!valid.has(filter))reject(422,'Filtro de conversas inválido');
 const term=text(q,80).toLowerCase();
 return Object.values(d.threads||{}).filter(t=>(!selected||t.slot===selected)&&
   (filter==='archived'?!!t.archived:filter==='all'?!t.archived:filter==='favorites'?!!t.favorite&&!t.archived:
    filter==='unread'?(t.unread||0)>0&&!t.archived:filter==='waiting'?stateOf(t)==='WAITING'&&!t.archived:
    filter==='human'?stateOf(t)==='HUMAN'&&!t.archived:filter==='closed'?stateOf(t)==='CLOSED'&&!t.archived:
    stateOf(t)==='FAILED'&&!t.archived)&&
    (!term||[t.customer,t.customerName,t.messages?.at(-1)?.text].some(v=>String(v||'').toLowerCase().includes(term))))
   .sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).map(threadInfo);
}
export function audit(d,{actor='admin',action,slot,id,clock=Date.now}){
 if(!validActor(actor))reject(422,'Operador inválido');
 const e={at:stamp(clock),actor,action:String(action||'').slice(0,60),slot:slot||null,
   // Nunca registrar telefone, mensagem, chave ou texto do pedido no log.
   ref:id?'conversation':'-'};
 if(!Array.isArray(d.auditLog))d.auditLog=[];
 d.auditLog.push(e);
 if(d.auditLog.length>MAX_AUDIT)d.auditLog=d.auditLog.slice(-MAX_AUDIT);
 return e;
}
export function transition(d,{id,action,actor='admin',expectedVersion,clock=Date.now}={}){
 if(typeof id!=='string'||id.length>140)reject(422,'Conversa inválida');
 const t=d.threads?.[id];if(!t)reject(404,'Conversa não encontrada');
 if(t.slot!==1&&t.slot!==2)reject(422,'Canal não autorizado');
 if(expectedVersion!==undefined&&(!Number.isInteger(expectedVersion)||expectedVersion!==(t.version||0)))reject(409,'A conversa mudou; atualize antes de alterar');
 if(!['takeover','wait','close','reopen','fail','favorite','unfavorite','archive','unarchive'].includes(action))reject(422,'Transição desconhecida');
 const current=stateOf(t);
 let next=current;
 if(action==='takeover')next='HUMAN';
 if(action==='wait'&&current!=='CLOSED')next='WAITING';
 if(action==='close')next='CLOSED';
 if(action==='reopen')next='HUMAN';
 if(action==='fail'&&current!=='CLOSED')next='FAILED';
 if(action==='favorite')t.favorite=true;
 if(action==='unfavorite')t.favorite=false;
 if(action==='archive')t.archived=true;
 if(action==='unarchive')t.archived=false;
 if((action==='wait'||action==='fail')&&current==='CLOSED')reject(409,'Reabra a conversa antes de alterar seu estado');
 if(action==='takeover'&&current==='CLOSED')reject(409,'Reabra a conversa antes de assumir');
 t.operationalState=next;
 // Mesmo após reabertura, a IA não é ativada por um controle de atendimento.
 t.mode='HUMAN';
 t.version=(t.version||0)+1;
 t.changedAt=stamp(clock);
 audit(d,{actor,action:'THREAD_'+action.toUpperCase(),slot:t.slot,id:t.id,clock});
 return threadInfo(t);
}
export function operationalOverview(d){
 const all=Object.values(d.threads||{}).map(threadInfo);
 return {revision:d.revision||0,channels:CHANNEL_SLOTS.map(slot=>{
   const list=all.filter(t=>t.slot===slot&&!t.archived).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
   return {slot,conversations:list,unread:list.reduce((n,t)=>n+t.unread,0),automation:channelConfig(d,slot)};
 }),totals:{conversations:all.length,unread:all.reduce((n,t)=>n+t.unread,0)},release:{ready:false,production:false,pdvOrdersEnabled:false,autoReplyEnabled:false}};
}
