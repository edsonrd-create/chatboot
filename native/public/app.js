const $=id=>document.getElementById(id);
const x=(tag,cls='',value)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(value!==undefined)el.textContent=String(value);return el;};
const ss={screen:'inbox',slot:0,selected:null,status:null,conversations:[],modalSlot:1,metaAssets:null,metaCode:null,splitMode:false,splitSelected:{1:null,2:null},splitThreads:{},opsFilter:'all',revision:null,liveSource:null};
const notify=(msg,error=false)=>{const n=$('notice');n.hidden=false;n.className='toast'+(error?' error':'');n.textContent=msg;setTimeout(()=>n.hidden=true,5500);};
async function api(url,options={}){const headers={'content-type':'application/json',...(options.headers||{})};const response=await fetch(url,{credentials:'same-origin',...options,headers});let data;try{data=await response.json();}catch{throw new Error('Servidor retornou resposta inválida');}if(!response.ok){const err=new Error(data.error||`HTTP ${response.status}`);err.code=data.code||null;err.errorId=data.errorId||null;throw err;}return data;}
const timestamp=v=>v?new Date(v).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'';
const deliveryLabel=v=>({received:'Recebida',done:'Enviada',sent:'Enviada',delivered:'Entregue',read:'Lida',failed:'Falhou',queued:'Na fila',pending:'Pendente',sample:'Exemplo',ai:'IA',human:'Atendente'})[String(v||'').toLowerCase()]||v||'';
const date=v=>v?new Date(v).toLocaleString('pt-BR'):'';
function navigate(name){ss.screen=name;for(const el of document.querySelectorAll('[data-screen]'))el.classList.toggle('active',el.dataset.screen===name);for(const el of document.querySelectorAll('.screen'))el.hidden=el.id!==`screen-${name}`;$('page-title').textContent=({inbox:'Conversas',orders:'Pedidos',testing:'Laboratório de IA',qr:'Conectar QR',settings:'Configurações'})[name];if(name==='inbox')loadInbox();if(name==='orders')loadOrders();if(name==='settings')loadSettings();if(name==='qr')loadQr();}
function renderStatus(){const s=ss.status;if(!s)return;const readOnly=Boolean(s.hosting?.readOnly);$('logout').hidden=readOnly;$('ai-check').disabled=readOnly;$('lab-text').disabled=readOnly;$('lab-form').querySelector('button').disabled=readOnly;$('lab-reset').disabled=readOnly;$('system-status').textContent=s.hosting?.freePreview?'Prévia gratuita · Dados temporários':'Homologação · Produção bloqueada';const preview=$('free-preview-banner');if(preview)preview.hidden=!s.hosting?.freePreview;for(const c of s.channels){$('number-'+c.slot).textContent=c.number||'Não conectado';const tag=$('badge-'+c.slot);tag.className='pill '+(c.apiVerifiedAt?'on':'off');tag.textContent=c.apiVerifiedAt?'API Meta verificada':'Aguardando verificação';}const ai=$('ai-config-state');ai.textContent=s.hosting?.readOnly?'Prévia pública: Gemini e outras IAs desativados.':s.ai.configured?`IA: ${s.ai.provider==='gemini'?'Google Gemini':'OpenAI'} · ${s.ai.model} · Teste real: ${s.ai.realTest?'aprovado':'pendente'}`:`IA ${s.ai.provider==='gemini'?'Gemini':'OpenAI'} selecionada, mas chave não configurada no servidor.`;}
async function loadStatus(){ss.status=await api('/api/status');renderStatus();}
function renderConversations(){const area=$('conversation-list');area.replaceChildren();const q=$('search').value.trim().toLowerCase();const filtered=ss.conversations.filter(t=>(!ss.slot||t.slot===ss.slot)&&matchesOperationsFilter(t)&&(!q||[t.customer,t.customerName,t.lastText].join(' ').toLowerCase().includes(q)));{const unread=ss.conversations.reduce((n,t)=>n+(t.unread||0),0);const badge=$('unread-total');badge.textContent=unread;badge.hidden=!unread;badge.title=unread?`${unread} mensagem(ns) não lida(s)`:'';}
  if(!filtered.length){area.append(x('div','empty-mini','Nenhuma conversa disponível neste filtro.'));return;}
  for(const t of filtered){const b=x('button','conversation'+(ss.selected===t.id?' active':''));b.type='button';const av=x('div','avatar',(t.customerName||'C')[0].toUpperCase());const body=x('div','info');body.append(x('b','',t.customerName||t.customer),x('span','',t.lastText||'Sem mensagens'));const aside=x('div','stamp',timestamp(t.updatedAt));if(t.unread)aside.append(x('div','unread',t.unread));b.append(av,body,aside);b.addEventListener('click',()=>selectThread(t.id));area.append(b);}
}
async function loadInbox(){try{const data=await api('/api/conversations');ss.conversations=data.items;renderConversations();updateBadges();if(ss.splitMode)await renderDualView();if(ss.selected && data.items.some(t=>t.id===ss.selected))await selectThread(ss.selected,false);}catch(e){notify(e.message,true);}}
async function selectThread(id,mark=true){ss.selected=id;renderConversations();try{const data=await api('/api/thread?id='+encodeURIComponent(id));const t=data.thread;const h=$('chat-header');h.replaceChildren();h.append(x('div','avatar',(t.customerName||'C')[0].toUpperCase()));const inf=x('div');inf.append(x('h2','',t.customerName||t.customer),x('p','',`WhatsApp ${t.slot} · ${t.customer} · ${t.mode==='HUMAN'?'Atendimento humano':'Automação'}`));h.append(inf);
  const actions=x('div','ops-action-bar');
  for(const [action,label] of operationChoices(t)){const button=x('button','',label);button.type='button';button.disabled=Boolean(ss.status?.hosting?.readOnly);button.onclick=()=>applyOperation(t,action);actions.append(button);}
  h.append(actions);
  const area=$('messages');area.replaceChildren();for(const m of data.messages){const bubble=x('div','message '+(m.direction==='incoming'?'incoming':'outgoing'),m.text);bubble.append(x('small','',[timestamp(m.at),deliveryLabel(m.delivery||m.source)].filter(Boolean).join(' · ')));area.append(bubble);}area.scrollTop=area.scrollHeight;
  $('selected-customer').textContent=t.customerName||t.customer;const readOnly=Boolean(ss.status?.hosting?.readOnly);$('selected-mode').textContent=readOnly?'Exemplo fictício · nenhuma mensagem será enviada':t.mode==='HUMAN'?'Modo humano · respostas enviadas pelo painel':'Automação não liberada em produção';$('takeover').disabled=readOnly;$('takeover').hidden=readOnly;
  const canSend=!readOnly&&t.mode==='HUMAN'&&(!t.state||t.state==='HUMAN');$('reply-text').disabled=!canSend;$('send').disabled=!canSend;$('reply-lock').textContent=readOnly?'Prévia somente leitura: mensagens fictícias e envio permanentemente bloqueado.':canSend?'Envio pela API Meta. Necessário número autorizado, janela de 24h e conexão válida.':'Assuma o atendimento antes de responder.';
  if(mark&&t.unread){await api('/api/thread/read',{method:'POST',body:JSON.stringify({id})});const local=ss.conversations.find(r=>r.id===id);if(local)local.unread=0;renderConversations();}
 }catch(e){notify(e.message,true);}}
async function loadOrders(){try{const result=await api('/api/orders');const box=$('orders');box.replaceChildren();if(!result.items.length)box.append(x('div','empty-mini','Nenhum pedido em conferência. A integração de escrita no PDV permanece bloqueada.'));for(const o of result.items){const div=x('div','context-card');div.append(x('b','',o.number||o.id),x('p','',JSON.stringify(o).slice(0,550)));box.append(div);}}catch(e){notify(e.message,true);}}
async function loadSettings(){try{const s=await api('/api/settings');$('pdv-url').value=s.pdv.baseUrl;$('pdv-enabled').checked=s.pdv.enabled;$('pdv-test-result').textContent=s.readiness?.pdv.lastTest?.ok?`Leitura testada em ${date(s.readiness.pdv.lastTest.at)}`:'Leitura do PDV ainda não confirmada.';$('ai-setting').textContent=s.readiness.ai.configured?`IA configurada: ${s.readiness.ai.model} · automação bloqueada`:'Chave da IA ausente · configure no servidor';ss.status=s.readiness;renderStatus();const readOnly=Boolean(ss.status?.hosting?.readOnly);$('pdv-url').disabled=readOnly;$('pdv-enabled').disabled=readOnly;$('pdv-form').querySelector('button[type=submit]').disabled=readOnly;$('pdv-check').disabled=readOnly;renderSettingsChannels();renderChecklist();await loadChannelConfigs();}catch(e){notify(e.message,true);}}
function renderSettingsChannels(){const container=$('channel-config-cards');container.replaceChildren();for(const c of ss.status?.channels||[]){const row=x('div','channel-card');const info=x('div');info.append(x('b','',`WhatsApp 0${c.slot}`),x('small','',c.apiVerifiedAt?`API verificada em ${date(c.apiVerifiedAt)}`:'Ainda não conectado'));const actions=x('div');const b=x('button','secondary',ss.status?.hosting?.readOnly?'Indisponível na prévia':'Conectar');b.disabled=Boolean(ss.status?.hosting?.readOnly);b.onclick=()=>openConnect(c.slot);actions.append(b);if(c.hasToken){const verify=x('button','secondary','Testar');verify.onclick=()=>verifyChannel(c.slot);actions.append(verify);}row.append(info,actions);container.append(row);}}
function renderChecklist(){const a=$('readiness-list');a.replaceChildren();const s=ss.status;if(!s)return;const items=[{ok:s.channels[0].apiVerifiedAt&&s.channels[0].lastInboundAt&&s.channels[0].lastOutboundAt,label:'WhatsApp 1: receber e enviar mensagens reais'},{ok:s.channels[1].apiVerifiedAt&&s.channels[1].lastInboundAt&&s.channels[1].lastOutboundAt,label:'WhatsApp 2: receber e enviar mensagens reais'},{ok:s.ai.realTest,label:'IA: conexão com provedor verificada (conversas pendentes)'},{ok:s.pdv.lastTest?.ok,label:'PDV: cardápio/loja verificados em leitura'},{ok:false,label:'Integração de criação de pedidos autenticada, idempotente e homologada'},{ok:false,label:'Testes de ponta a ponta, recuperação, segurança e operação aprovados'}];for(const item of items){const box=x('div','check-item');box.append(x('i','',item.ok?'✓':'○'),x('span','',item.label));a.append(box);}}
async function verifyChannel(slot){try{const r=await api(`/api/channels/${slot}/verify`,{method:'POST',body:'{}'});notify(`Canal ${slot}: API Meta validada.`);await loadStatus();renderSettingsChannels();}catch(e){notify(e.message,true);}}
function openConnect(slot){if(ss.status?.hosting?.freePreview){notify('A prévia gratuita não conecta números reais nem armazena tokens Meta.',true);return;}ss.modalSlot=slot;ss.metaAssets=null;ss.metaCode=null;$('modal-title').textContent=`Conectar WhatsApp 0${slot}`;$('modal-message').textContent='';$('manual-config').reset();$('meta-onboard-hint').textContent=ss.status?.oauth.available?'O login oficial da Meta será aberto nesta tela. Se disponível, escolha manter o WhatsApp Business pelo recurso de coexistência.':'Configure META_APP_ID e META_CONFIG_ID no servidor para habilitar o cadastro oficial aqui. Também é possível validar IDs e token autorizados abaixo.';$('meta-connect').disabled=!ss.status?.oauth.available;$('connect-modal').showModal();}
async function prepareSdk(){if(window.FB)return;await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://connect.facebook.net/pt_BR/sdk.js';s.onload=resolve;s.onerror=()=>reject(new Error('Não foi possível carregar a autorização oficial da Meta'));document.head.append(s);});window.FB.init({appId:ss.status.oauth.appId,cookie:false,xfbml:false,version:'v25.0'});}
window.addEventListener('message',e=>{if(e.origin!=='https://www.facebook.com'&&e.origin!=='https://web.facebook.com')return;let data=e.data;if(typeof data==='string'){try{data=JSON.parse(data);}catch{return;}}if(data?.type==='WA_EMBEDDED_SIGNUP'&&data.event==='FINISH'){ss.metaAssets={phoneId:String(data.data?.phone_number_id||''),wabaId:String(data.data?.waba_id||'')};finishOnboarding();}});
async function finishOnboarding(){if(!ss.metaAssets||!ss.metaCode)return;const {phoneId,wabaId}=ss.metaAssets,code=ss.metaCode;ss.metaCode=null;ss.metaAssets=null;try{$('modal-message').textContent='Validando autorização oficial da Meta...';const r=await api('/api/meta/signup/complete',{method:'POST',body:JSON.stringify({slot:ss.modalSlot,phoneId,wabaId,code})});$('modal-message').textContent=r.notice;await loadStatus();renderSettingsChannels();}catch(e){$('modal-message').textContent=e.message;}}
$('meta-connect').onclick=async()=>{try{await prepareSdk();window.FB.login(response=>{if(response?.authResponse?.code){ss.metaCode=response.authResponse.code;finishOnboarding();}else $('modal-message').textContent='A autorização foi cancelada ou não retornou um código. Confira a configuração Meta.';},{config_id:ss.status.oauth.configId,response_type:'code',override_default_response_type:true,extras:{setup:{},featureType:'whatsapp_embedded_signup',sessionInfoVersion:'3'}});}catch(e){$('modal-message').textContent=e.message;}};
$('manual-config').onsubmit=async e=>{e.preventDefault();try{$('modal-message').textContent='Consultando a Meta...';const r=await api(`/api/channels/${ss.modalSlot}/configure`,{method:'POST',body:JSON.stringify({phoneId:$('phone-id').value.trim(),wabaId:$('waba-id').value.trim(),token:$('meta-token').value.trim()})});$('meta-token').value='';$('modal-message').textContent=r.notice;await loadStatus();renderSettingsChannels();}catch(ex){$('modal-message').textContent=ex.message;}};
$('login-form').onsubmit=async e=>{e.preventDefault();$('login-error').textContent='';try{await api('/api/login',{method:'POST',body:JSON.stringify({password:$('password').value})});$('password').value='';$('login').hidden=true;$('app').hidden=false;await loadStatus();await loadInbox();beginLiveUpdates();}catch(ex){$('login-error').textContent=ex.message;}};
$('logout').onclick=async()=>{await api('/api/logout',{method:'POST',body:'{}'});location.reload();};
$('refresh').onclick=async()=>{try{await loadStatus();await loadInbox();notify('Painel atualizado.');}catch(e){notify(e.message,true);}};
$('sync-inbox').onclick=loadInbox;
$('search').addEventListener('input',renderConversations);
for(const b of document.querySelectorAll('[data-screen]'))b.onclick=()=>navigate(b.dataset.screen);
for(const b of document.querySelectorAll('[data-channel]'))b.onclick=()=>{ss.slot=Number(b.dataset.channel);ss.splitMode=false;syncSplitMode();for(const a of document.querySelectorAll('[data-channel]'))a.classList.toggle('active',a===b);renderConversations();};
$('takeover').onclick=async()=>{if(!ss.selected)return;try{await api('/api/thread/mode',{method:'POST',body:JSON.stringify({id:ss.selected,mode:'HUMAN'})});await selectThread(ss.selected);notify('Atendimento humano assumido.');}catch(e){notify(e.message,true);}};
$('reply-form').onsubmit=async e=>{e.preventDefault();const text=$('reply-text').value.trim();if(!text||!ss.selected)return;try{await api('/api/reply',{method:'POST',body:JSON.stringify({id:ss.selected,text})});$('reply-text').value='';await selectThread(ss.selected,false);notify('Mensagem adicionada à fila da Meta. Confirme entrega no status.');}catch(ex){notify(ex.message,true);}};
$('pdv-form').onsubmit=async e=>{e.preventDefault();try{await api('/api/settings',{method:'PUT',body:JSON.stringify({pdv:{enabled:$('pdv-enabled').checked,baseUrl:$('pdv-url').value.trim(),ordersMode:'DISABLED'}})});notify('Configuração persistida. Envio ao PDV continua desativado.');await loadSettings();}catch(ex){notify(ex.message,true);}};
$('pdv-check').onclick=async()=>{try{const r=await api('/api/pdv/test',{method:'POST',body:'{}'});$('pdv-test-result').textContent=`PDV respondeu: ${r.items} itens. Loja ${r.store.open?'aberta':'fechada'}.`;await loadStatus();renderChecklist();}catch(e){$('pdv-test-result').textContent=e.message;notify(e.message,true);}};
$('ai-check').onclick=async()=>{try{const r=await api('/api/ai/test',{method:'POST',body:'{}'});notify(`Modelo ${r.model}: respondeu ao teste.`);await loadStatus();}catch(e){notify(e.message,true);}};
function labMessage(who,text){const area=$('lab-messages');const div=x('div','message '+who,text);area.append(div);area.scrollTop=area.scrollHeight;}
$('lab-form').onsubmit=async e=>{e.preventDefault();const text=$('lab-text').value.trim();if(!text)return;labMessage('outgoing',text);$('lab-text').value='';try{const r=await api('/api/simulate',{method:'POST',body:JSON.stringify({text})});labMessage('bot',r.reply);}catch(ex){const detail=[ex.code?`Código: ${ex.code}`:'',ex.errorId?`Referência: ${ex.errorId}`:''].filter(Boolean).join(' · ');labMessage('bot',`Não houve resposta de IA real. ${ex.message}${detail?'\n'+detail:''}`);}};
$('lab-reset').onclick=async()=>{try{await api('/api/simulate/reset',{method:'POST',body:'{}'});$('lab-messages').replaceChildren();labMessage('bot','Novo teste. Pode fazer seu pedido ou tirar dúvidas.');}catch(e){notify(e.message,true);}};
let qrTimer;
async function loadQr(){clearTimeout(qrTimer);if(ss.screen!=='qr')return;
try{const r=await api('/api/qr/status');$('qr-disabled').hidden=!!r.enabled;
$('qr-auto').textContent=r.autoReply?'Resposta automática da IA: LIGADA para conversas recebidas por QR.':'Resposta automática da IA: desligada. As mensagens aparecem em Conversas para o atendente responder.';
const map={disconnected:['Desconectado','off'],connecting:['Conectando…','warn'],qr:['Aguardando leitura','warn'],connected:['Conectado','on'],error:['Erro','off']};
for(const slot of [1,2]){const st=(r.slots||[]).find(q=>q.slot===slot)||{state:'disconnected'};const [label,cls]=map[st.state]||[st.state,'off'];
$('qr-title-'+slot).textContent=st.state==='connected'&&st.number?'+'+st.number:label;const pill=$('qr-pill-'+slot);pill.className='pill '+cls;pill.textContent=label;
const box=$('qr-box-'+slot);box.replaceChildren();
if(st.qr){const img=document.createElement('img');img.src=st.qr;img.alt='QR Code do WhatsApp '+slot;box.append(img);}
else box.append(x('div','qr-empty',st.state==='connected'?'✓ WhatsApp conectado':(st.error||(st.state==='connecting'?'Gerando QR Code…':'Clique em Gerar QR Code'))));}
}catch(e){notify(e.message,true);}
qrTimer=setTimeout(loadQr,2500);}
for(const b of document.querySelectorAll('[data-qr-start]'))b.onclick=async()=>{try{await api('/api/qr/'+b.dataset.qrStart+'/start',{method:'POST',body:'{}'});notify('Gerando QR Code… aponte a câmera do celular.');loadQr();}catch(e){notify(e.message,true);}};
for(const b of document.querySelectorAll('[data-qr-logout]'))b.onclick=async()=>{if(!confirm('Desconectar este WhatsApp do Guto Bot?'))return;try{await api('/api/qr/'+b.dataset.qrLogout+'/logout',{method:'POST',body:'{}'});notify('WhatsApp desconectado.');loadQr();}catch(e){notify(e.message,true);}};
// ===== Notificações estilo WhatsApp (som, título da aba, contador por número) =====
let lastUnread=null;
function beep(){try{const a=new (window.AudioContext||window.webkitAudioContext)();const o=a.createOscillator(),g=a.createGain();o.type='sine';o.frequency.value=880;g.gain.setValueAtTime(.0001,a.currentTime);g.gain.exponentialRampToValueAtTime(.25,a.currentTime+.02);g.gain.exponentialRampToValueAtTime(.0001,a.currentTime+.35);o.connect(g).connect(a.destination);o.start();o.stop(a.currentTime+.4);}catch{}}
function updateBadges(){const per={1:0,2:0};let total=0;for(const t of ss.conversations){per[t.slot]=(per[t.slot]||0)+(t.unread||0);total+=t.unread||0;}
for(const b of document.querySelectorAll('[data-channel]')){const n=b.dataset.channel==='0'?total:(per[b.dataset.channel]||0);const base=b.dataset.label||(b.dataset.label=b.textContent);b.textContent=n?base+' ('+n+')':base;}
document.title=(total?'('+total+') ':'')+'Auto Atendimento Express • Guto Express';
if(lastUnread!==null&&total>lastUnread){beep();const t=ss.conversations.find(c=>c.unread);if('Notification' in window&&Notification.permission==='granted'&&document.hidden){try{new Notification('Nova mensagem'+(t?' de '+(t.customerName||t.customer):''),{body:t?(t.lastText||''):'',icon:'logo.png'});}catch{}}}
lastUnread=total;}
setInterval(()=>{if(!$('app').hidden&&ss.screen==='inbox')loadInbox();},12000);
document.addEventListener('click',()=>{if('Notification' in window&&Notification.permission==='default')Notification.requestPermission();},{once:true});
(()=>{const t=$('takeover');const comp=document.querySelector('.compose');if(t&&comp)comp.prepend(t);})();
// ===== Central simultânea dos dois números (somente API interna autenticada) =====
function matchesOperationsFilter(t){
  const f=ss.opsFilter;
  if(f==='archived')return !!t.archived;
  if(t.archived)return false;
  if(f==='unread')return (t.unread||0)>0;
  if(f==='favorites')return !!t.favorite;
  if(f==='waiting')return t.state==='WAITING';
  if(f==='human')return (t.state||t.mode)==='HUMAN';
  if(f==='closed')return t.state==='CLOSED';
  if(f==='failed')return t.state==='FAILED';
  return true;
}
function operationChoices(t){
  const actions=[];
  if(t.state==='CLOSED')actions.push(['reopen','Reabrir']);
  else {
    if((t.state||'HUMAN')!=='HUMAN')actions.push(['takeover','Assumir']);
    actions.push(['wait','Aguardar'],['close','Finalizar']);
  }
  actions.push([t.favorite?'unfavorite':'favorite',t.favorite?'★ Favorito':'☆ Favorito']);
  actions.push([t.archived?'unarchive':'archive',t.archived?'Desarquivar':'Arquivar']);
  return actions;
}
async function applyOperation(thread,action){
  if(ss.status?.hosting?.readOnly){notify('Prévia visual: nenhuma alteração permitida.',true);return;}
  try{
    await api('/api/operations/thread/action',{method:'POST',body:JSON.stringify({id:thread.id,action,expectedVersion:thread.version||0})});
    await loadInbox();
    notify('Atendimento atualizado e registrado na auditoria.');
  }catch(e){notify(e.message,true);await loadInbox();}
}
function syncSplitMode(){
  $('screen-inbox').classList.toggle('dual-mode',ss.splitMode);
  $('dual-view').hidden=!ss.splitMode;
  $('split-toggle').setAttribute('aria-pressed',String(ss.splitMode));
  if(ss.splitMode)renderDualView();
}
$('split-toggle').onclick=()=>{
  ss.splitMode=!ss.splitMode;
  if(ss.splitMode){ss.slot=0;for(const b of document.querySelectorAll('[data-channel]'))b.classList.toggle('active',b.dataset.channel==='0');}
  syncSplitMode();
};
$('ops-filter').onchange=event=>{
  ss.opsFilter=event.target.value;
  renderConversations();
  if(ss.splitMode)renderDualView();
};
async function renderDualView(){
  if(!ss.splitMode||ss.screen!=='inbox')return;
  const q=$('search').value.trim().toLowerCase();
  for(const slot of [1,2]){
    const items=ss.conversations.filter(t=>t.slot===slot&&matchesOperationsFilter(t)&&(!q||[t.customer,t.customerName,t.lastText].join(' ').toLowerCase().includes(q)));
    const list=$('dual-list-'+slot);list.replaceChildren();
    for(const t of items){
      const b=x('button','dual-contact'+(ss.splitSelected[slot]===t.id?' active':''));b.type='button';
      b.append(x('b','',t.customerName||t.customer),x('small','',t.lastText||'Sem mensagens'));
      if(t.unread)b.append(x('span','dual-unread-dot',String(t.unread)+' nova(s)'));
      b.onclick=()=>selectDualThread(slot,t.id);
      list.append(b);
    }
    if(!items.length)list.append(x('div','empty-mini','Sem conversas neste canal.'));
    const unread=ss.conversations.filter(t=>t.slot===slot).reduce((n,t)=>n+(t.unread||0),0);
    $('dual-unread-'+slot).textContent=unread?unread+' nova(s)':'Sem novas';
    const c=ss.status?.channels?.find(c=>c.slot===slot);
    $('dual-status-'+slot).textContent=c?.apiVerifiedAt?(c.number||'API verificada'):'Canal não conectado';
    const selected=items.find(t=>t.id===ss.splitSelected[slot])?.id||items[0]?.id;
    if(selected)await selectDualThread(slot,selected,false);
    else{
      ss.splitSelected[slot]=null;ss.splitThreads[slot]=null;
      $('dual-person-'+slot).textContent='Nenhuma conversa';
      $('dual-messages-'+slot).replaceChildren();$('dual-actions-'+slot).replaceChildren();
      document.querySelector('[data-dual-input="'+slot+'"]').disabled=true;
      document.querySelector('[data-dual-send="'+slot+'"]').disabled=true;
    }
  }
}
async function selectDualThread(slot,id,mark=false){
  if(!id)return;
  try{
    const data=await api('/api/thread?id='+encodeURIComponent(id)),t=data.thread;
    if(t.slot!==slot)throw new Error('Esta conversa pertence a outro WhatsApp.');
    ss.splitSelected[slot]=id;ss.splitThreads[slot]=t;
    const head=$('dual-person-'+slot);head.replaceChildren();
    head.append(x('span','',t.customerName||t.customer),x('small','',`WhatsApp 0${slot} · ${t.state||t.mode} · ${t.customer}`));
    const area=$('dual-messages-'+slot);area.replaceChildren();
    for(const m of data.messages){
      const bubble=x('div','dual-bubble '+(m.direction==='incoming'?'incoming':'outgoing'),m.text||'[Mídia não disponível]');
      bubble.append(x('small','',timestamp(m.at)+' · '+deliveryLabel(m.delivery||m.source)));area.append(bubble);
    }
    area.scrollTop=area.scrollHeight;
    const buttons=$('dual-actions-'+slot);buttons.replaceChildren();
    for(const [action,label] of operationChoices(t)){
      const b=x('button','',label);b.type='button';b.disabled=Boolean(ss.status?.hosting?.readOnly);
      b.onclick=()=>applyOperation(t,action);buttons.append(b);
    }
    const enabled=!ss.status?.hosting?.readOnly&&t.mode==='HUMAN'&&(!t.state||t.state==='HUMAN');
    document.querySelector('[data-dual-input="'+slot+'"]').disabled=!enabled;
    document.querySelector('[data-dual-send="'+slot+'"]').disabled=!enabled;
    if(mark&&t.unread&&!ss.status?.hosting?.readOnly){
      await api('/api/thread/read',{method:'POST',body:JSON.stringify({id})});
      const local=ss.conversations.find(r=>r.id===id);if(local)local.unread=0;
      renderConversations();
    }
  }catch(e){notify(e.message,true);}
}
for(const form of document.querySelectorAll('[data-dual-compose]'))form.onsubmit=async event=>{
  event.preventDefault();
  const slot=Number(form.dataset.dualCompose),t=ss.splitThreads[slot],input=form.querySelector('input');
  const text=input.value.trim();
  if(!text||!t)return;
  try{
    await api('/api/reply',{method:'POST',body:JSON.stringify({id:t.id,text})});
    input.value='';await selectDualThread(slot,t.id,false);
    notify('Resposta encaminhada à fila do WhatsApp 0'+slot+'.');
  }catch(e){notify(e.message,true);}
};

// Modo tela cheia (aberto pelo PDV): /whatsapp mostra só as conversas.
if(location.pathname.replace(/\/+$/,'')==='/whatsapp')document.body.classList.add('full-wa');
api('/api/status').then(async r=>{ss.status=r;$('login').hidden=true;$('app').hidden=false;renderStatus();await loadInbox();beginLiveUpdates();}).catch(()=>{$('app').hidden=true;$('login').hidden=false;});
