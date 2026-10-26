'use strict';
const byId=id=>document.getElementById(id);
const state={items:[],channels:[],selected:null,channel:'all',search:'',detail:null,refreshTimer:null,offline:true};
const endpoint='/api';
async function api(route,opts={}){
  const resp=await fetch(endpoint+route,{credentials:'same-origin',headers:{'content-type':'application/json'},...opts});
  let body;try{body=await resp.json();}catch{body={error:`Resposta inválida (HTTP ${resp.status})`};}
  if(resp.status===401){window.location.assign('/');throw new Error('Sessão encerrada. Entre novamente pelo painel.');}
  if(!resp.ok)throw new Error(body.error||`Erro HTTP ${resp.status}`);
  return body;
}
function toast(text){const n=byId('toast');n.textContent=text;n.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>n.hidden=true,5100);}
function element(tag,css,text){const e=document.createElement(tag);if(css)e.className=css;if(text!==undefined)e.textContent=String(text);return e;}
function shortTime(date){const d=new Date(date);return Number.isFinite(d.getTime())?d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'';}
const slotOfId=id=>state.channels.find(x=>x.inboxId===id)?.slot||null;
function filtered(){return state.items.filter(x=>{
    if(state.channel!=='all'&&slotOfId(x.inboxId)!==Number(state.channel))return false;
    const terms=state.search.toLocaleLowerCase('pt-BR');return !terms||(x.name+' '+x.preview).toLocaleLowerCase('pt-BR').includes(terms);
});}
function setVisibleDetail(selected){byId('app-shell').classList.toggle('chat-selected',Boolean(selected));}
function renderList(){const items=filtered(),container=byId('conversations');container.replaceChildren();byId('count').textContent=state.items.length;
  if(!items.length){container.append(element('div','no-conversation',state.items.length?'Nenhum atendimento encontrado neste filtro.':'Nenhuma conversa real recebida. Conecte os dois canais pelo Chatwoot para começar.'));return;}
  for(const item of items){const button=element('button','conversation'+(state.selected===item.key?' active':''));button.type='button';button.setAttribute('role','listitem');
    const avatar=element('div','avatar',item.name.slice(0,1).toUpperCase());const main=element('div','conversation-body');const title=element('div','conversation-title');title.append(element('strong','',item.name),element('span','conversation-time',shortTime(item.updatedAt)));main.append(title,element('div','preview',item.preview||'Conversa sem prévia'));
    const line=element('div');line.append(element('span','tag',`WhatsApp ${slotOfId(item.inboxId)||'?'}`));line.append(element('span','tag '+(item.mode==='HUMAN'?'amber':'green'),item.mode==='HUMAN'?'Humano':'IA'));
    main.append(line);button.append(avatar,main);button.addEventListener('click',()=>openChat(item.key));container.append(button);
  }
}
function renderChannels(){const labels=state.channels.map(c=>c.configured?'Configurado · não verificado':'Não conectado');
  byId('channel-one').textContent=labels[0]||'Pendente';byId('channel-two').textContent=labels[1]||'Pendente';
  byId('channel-info').textContent=state.channels.some(c=>c.configured)?'Integração cadastrada · não verificada':'Aguardando a conexão dos 2 números';
  byId('integration').textContent='Não verificada';const grid=byId('connect-grid');grid.replaceChildren();
  for(let i=0;i<2;i++){const c=state.channels[i]||{slot:i+1,configured:false};const item=element('div','connect-card');item.append(element('strong','',`WhatsApp ${i+1}`));item.append(element('p','',c.configured?`Inbox ID: ${c.inboxId}. Isso não garante que o número esteja online.`:'Ainda não configurado neste servidor. Mantenha o aplicativo WhatsApp Business instalado.'));
    item.append(element('span','tag '+(c.configured?'amber':''),c.configured?'Configuração informada':'Sem conexão verificada'));
    const button=element('button','',c.chatwootUrl?'Abrir configuração no Chatwoot ↗':'Ver instruções oficiais ↗');button.addEventListener('click',()=>{
      const url=c.chatwootUrl||'https://www.chatwoot.com/hc/user-guide/articles/1791812048-2-escolha-como-conectar-o-whats_app';
      window.open(url,'_blank','noopener,noreferrer');
    });item.append(button);grid.append(item);
  }
  const base=state.channels.find(x=>x.chatwootUrl)?.chatwootUrl;
  byId('open-chatwoot').href=base||'https://app.chatwoot.com';
}
function formatMoney(cents){return Number.isSafeInteger(cents)?new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100):'A confirmar';}
function renderCart(detail){const box=byId('cart-preview');box.replaceChildren();const summary=detail?.summary;
  if(!summary?.items?.length){box.textContent='Nenhum item no carrinho desta conversa.';return;}
  for(const i of summary.items){const row=element('div','system-line');row.append(element('span','',`${i.quantity}× ${i.description}`),element('b','',formatMoney(i.unitPriceCents)));box.append(row);}
  const hr=document.createElement('hr');hr.style.border='none';hr.style.borderTop='1px solid #e6ebf0';hr.style.marginTop='13px';box.append(hr);
  const total=element('div','system-line');total.append(element('strong','', 'Total'),element('b','',formatMoney(summary.totalCents)));box.append(total);
  if(summary.missing?.length)box.append(element('p','muted',`Pendências: ${summary.missing.join(', ')}`));
}
function renderChat(){const detail=state.detail,selected=Boolean(detail);setVisibleDetail(selected);
  byId('empty-state').hidden=selected;byId('messages').hidden=!selected;byId('chat-name').textContent=detail?.name||'Selecione uma conversa';
  byId('detail-name').textContent=detail?.name||'Guto Bot';
  byId('detail-sub').textContent=detail?`WhatsApp ${slotOfId(detail.inboxId)||'?'} · ${detail.key}`:'Atendimento organizado';
  byId('chat-channel').textContent=detail?`WhatsApp ${slotOfId(detail.inboxId)||'?'} · ${detail.history.length} mensagens`:'Histórico e atendimento inteligente';
  byId('chat-avatar').textContent=(detail?.name||'G').slice(0,1).toUpperCase();
  const manual=detail?.mode==='HUMAN';const canSend=Boolean(detail && manual && state.channels.some(x=>x.configured&&x.inboxId===detail.inboxId));
  byId('bot-status').textContent=!selected?'Nenhuma conversa':manual?'Atendente humano':'IA ativa';byId('bot-status').className='status-label'+(selected?(manual?' human':' live'):'');
  byId('detail-mode').textContent=!selected?'Aguardando conversa':manual?'Humano assumiu':'Modo automático';
  byId('detail-mode-sub').textContent=!selected?'Selecione uma conversa.':manual?'Respostas automáticas estão pausadas nesta conversa.':'Use Assumir atendimento antes de responder manualmente.';
  byId('toggle-mode').disabled=!selected;byId('toggle-mode').textContent=manual?'Reativar IA':'Assumir atendimento';
  byId('reply').disabled=!canSend;byId('send').disabled=!canSend;
  byId('composer-warning').textContent=!selected?'Selecione uma conversa para responder.':!manual?'A IA está ativa. Clique em “Assumir atendimento” para responder manualmente.':!canSend?'A integração precisa estar configurada para enviar mensagens.':'Modo humano: as mensagens serão colocadas em fila de envio ao Chatwoot.';
  renderCart(detail);
  const chat=byId('messages');chat.replaceChildren();if(!selected)return;
  for(const m of detail.history){const incoming=m.role==='incoming';const bubble=element('div','message '+(incoming?'incoming':'outgoing'),m.content);const desc=incoming?'Cliente':m.role==='human'?'Atendente':'Guto Bot';
    const delivery=m.delivery==='queued'?' · na fila':m.delivery==='failed'?' · falhou':m.delivery==='sent'?' · enviado':'';
    bubble.append(element('div','message-info',desc+delivery));chat.append(bubble);
  }
  byId('chat-content').scrollTop=byId('chat-content').scrollHeight;
}
async function load(){const data=await api('/inbox/conversations');state.items=data.items||[];state.channels=data.channels||[];state.offline=false;renderChannels();renderList();
  if(state.selected && state.items.some(x=>x.key===state.selected))await fetchDetail(state.selected,false);
  else if(state.selected){state.selected=null;state.detail=null;renderChat();}
}
async function fetchDetail(key,withScroll=true){const detail=await api('/inbox/conversations/'+encodeURIComponent(key));if(state.selected!==key)return;const old=state.detail;const changed=!old || old.updatedAt!==detail.updatedAt || old.mode!==detail.mode || old.history.length!==detail.history.length || old.history.at(-1)?.delivery!==detail.history.at(-1)?.delivery;state.detail=detail;if(changed){renderChat();if(withScroll)byId('chat-content').scrollTop=byId('chat-content').scrollHeight;}}
async function openChat(key){state.selected=key;renderList();try{await fetchDetail(key);}catch(e){toast(e.message);}}
async function sendMessage(event){event.preventDefault();const content=byId('reply').value.trim();if(!content||!state.selected)return;
  const key=state.selected,button=byId('send'),requestId=crypto.randomUUID();button.disabled=true;
  try{const result=await api(`/inbox/conversations/${encodeURIComponent(key)}/messages`,{method:'POST',body:JSON.stringify({content,requestId})});
    if(result.queued){byId('reply').value='';toast('Mensagem adicionada à fila de envio.');await fetchDetail(key);}
  }catch(e){toast(e.message);}finally{button.disabled=false;}
}
function openConnect(){byId('overlay').hidden=false;byId('close-overlay').focus();}function closeConnect(){byId('overlay').hidden=true;}
byId('refresh').addEventListener('click',()=>load().catch(e=>toast(e.message)));
byId('search').addEventListener('input',e=>{state.search=e.target.value;renderList();});
for(const tab of document.querySelectorAll('[data-channel]'))tab.addEventListener('click',()=>{state.channel=tab.dataset.channel;document.querySelectorAll('[data-channel]').forEach(x=>x.classList.toggle('active',x===tab));renderList();});
for(const id of ['connect-rail','configure','empty-connect','connect-detail'])byId(id).addEventListener('click',openConnect);
byId('close-overlay').addEventListener('click',closeConnect);byId('overlay').addEventListener('click',e=>{if(e.target===byId('overlay'))closeConnect();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeConnect();});
byId('back-list').addEventListener('click',()=>{state.selected=null;state.detail=null;renderChat();});
byId('toggle-mode').addEventListener('click',async()=>{if(!state.selected||!state.detail)return;const mode=state.detail.mode==='HUMAN'?'BOT':'HUMAN';
  if(mode==='BOT'&&!confirm('Retomar IA nesta conversa? Faça isso apenas depois de confirmar a configuração e a segurança do atendimento.'))return;
  try{await api(`/conversations/${encodeURIComponent(state.selected)}/mode`,{method:'POST',body:JSON.stringify({mode})});await load();toast(mode==='HUMAN'?'Conversa assumida por atendente.':'IA reativada para esta conversa.');}catch(e){toast(e.message);}
});
byId('reply-form').addEventListener('submit',sendMessage);
byId('reply').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();byId('reply-form').requestSubmit();}});
byId('logout-inbox').addEventListener('click',async()=>{try{await api('/logout',{method:'POST'});}catch{}window.location.assign('/');});
renderChat();load().catch(e=>{byId('conversations').replaceChildren(element('div','no-conversation',`Não foi possível carregar: ${e.message}`));toast(e.message);});
state.refreshTimer=setInterval(()=>{if(!document.hidden)load().catch(()=>{});},6000);
