const $=id=>document.getElementById(id);
let dashboard=null;
const money=n=>Number.isInteger(n)?new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100):'A confirmar';
async function api(path,opts={}){const response=await fetch(path,{credentials:'same-origin',headers:{'content-type':'application/json'},...opts});const data=await response.json();if(!response.ok)throw new Error(data.error||`Erro ${response.status}`);return data;}
const message=(text,error=false)=>{const el=$('notice');el.hidden=false;el.className='notice'+(error?' error':'');el.textContent=text;setTimeout(()=>el.hidden=true,4500);};
const el=(tag,cls,text)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(text!==undefined)x.textContent=String(text);return x;};
const btn=(label,cb)=>{const b=el('button','smallbutton',label);b.addEventListener('click',cb);return b;};
function loginUI(show){$('auth').hidden=!show;$('app').hidden=show;}
async function load(){dashboard=await api('/api/dashboard');loginUI(false);render();}
function render(){const d=dashboard;$('count-conversations').textContent=d.stats.conversations;$('count-orders').textContent=d.stats.orders;$('count-pending').textContent=d.stats.pending;$('ai-status').textContent=d.aiConfigured?'Chave configurada':'IA não configurada';$('ai-mode-detail').textContent=d.aiConfigured?'Modelo configurado no servidor (conexão ainda não verificada). Envie uma pergunta ou verifique a conexão.':'Sem chave OPENAI_API_KEY no servidor. Este chat não usará respostas programadas fingindo ser IA.';$('connection').textContent=d.onlineConfigured?'Chatwoot configurado':'Chatwoot não conectado';$('connection').className=d.onlineConfigured?'status ok':'status';
 const channels=$('channel-list');channels.replaceChildren();for(let i=0;i<2;i++){const c=d.inboxes[i];const box=el('div','channel');const left=el('div');left.append(el('b','',`WhatsApp ${i+1}`),el('small','',c?`Inbox ID: ${c.id}`:'Aguardando configuração'));box.append(left,el('span','circle','☏'));channels.append(box);}
 const conv=$('conversation-list');conv.replaceChildren();if(!d.conversations.length)conv.append(el('p','muted','Nenhuma conversa recebida.'));for(const s of d.conversations){const row=el('div','row-record');const x=el('div');x.append(el('b','',s.customer),el('div','sub',`${s.key} · ${s.updatedAt}`),el('div','muted',s.lastMessage.slice(0,170)));const y=el('div');y.append(el('span',s.mode==='HUMAN'?'pill warn':'pill',s.mode==='HUMAN'?'Atendimento humano':'Bot ativo'));y.append(btn(s.mode==='HUMAN'?'Reativar bot':'Transferir humano',async()=>{try{await api(`/api/conversations/${encodeURIComponent(s.key)}/mode`,{method:'POST',body:JSON.stringify({mode:s.mode==='HUMAN'?'BOT':'HUMAN'})});message('Modo de conversa alterado.');await load();}catch(e){message(e.message,true);}}));row.append(x,y);conv.append(row);}
 const orders=$('orders-list');orders.replaceChildren();if(!d.orders.length)orders.append(el('p','muted','Nenhum pedido registrado.'));for(const o of d.orders){const row=el('div','row-record');const x=el('div');x.append(el('b','',`${o.number} ${o.demo?'[TESTE]':''} • ${o.customer}`),el('div','sub',`${o.status} · WhatsApp inbox ${o.inboxId} · ${o.createdAt}`));for(const item of o.cart||[])x.append(el('div','muted',`${item.quantity}x ${item.description} • ${money(item.unitPriceCents)}`));x.append(el('div','muted',`Endereço: ${o.address||'—'} | ${o.payment||'—'} | Total: ${money(o.quote?.totalCents)}`));const y=el('div');const transitions={PENDING_STAFF_REVIEW:['CONFIRMED','REJECTED'],CONFIRMED:['PREPARING','CANCELED'],PREPARING:['READY','CANCELED'],READY:['DISPATCHED','CANCELED'],DISPATCHED:['DELIVERED']};for(const target of transitions[o.status]||[])y.append(btn(target,async()=>{if(!confirm(`Alterar ${o.number} para ${target}?`))return;try{await api(`/api/orders/${o.id}/status`,{method:'POST',body:JSON.stringify({status:target})});message('Status atualizado.');await load();}catch(e){message(e.message,true);}}));row.append(x,y);orders.append(row);}
}
const names={overview:'Visão geral',conversations:'Conversas',orders:'Pedidos',simulator:'Simulador inteligente',catalog:'Cardápio e regras',pdf:'Cardápio PDF'};
function page(name){for(const s of document.querySelectorAll('.page'))s.hidden=s.id!==name;for(const b of document.querySelectorAll('[data-page]'))b.classList.toggle('active',b.dataset.page===name);$('page-title').textContent=names[name];if(name==='catalog')loadBusiness();if(name==='pdf')loadPdfStatus();}
async function loadBusiness(){try{$('business-json').value=JSON.stringify(await api('/api/business'),null,2);}catch(e){message(e.message,true);}}
$('login-form').addEventListener('submit',async e=>{e.preventDefault();$('login-error').textContent='';try{await api('/api/login',{method:'POST',body:JSON.stringify({password:$('password').value})});$('password').value='';await load();}catch(err){$('login-error').textContent=err.message;}});
$('logout').addEventListener('click',async()=>{await api('/api/logout',{method:'POST'});loginUI(true);});
$('refresh').addEventListener('click',()=>load().catch(e=>message(e.message,true)));
for(const b of document.querySelectorAll('[data-page]'))b.addEventListener('click',()=>page(b.dataset.page));
$('chat-form').addEventListener('submit',async e=>{e.preventDefault();const input=$('chat-input'),txt=input.value.trim();if(!txt)return;input.value='';addBubble(txt,'user');const submit=$('chat-form').querySelector('button');submit.disabled=true;try{const r=await api('/api/simulate',{method:'POST',body:JSON.stringify({content:txt})});addBubble(r.reply,'bot');$('cart-view').textContent=(r.summary.items||[]).map(i=>`${i.quantity}x ${i.description} • ${money(i.unitPriceCents)}`).join('\n')+`\nTotal: ${money(r.summary.totalCents)}\nPendências: ${(r.summary.missing||[]).join(', ')||'Nenhuma'}\nModo: ${r.mode}`;}catch(err){addBubble(`Erro: ${err.message}`,'bot');}finally{submit.disabled=false;}});
function addBubble(text,who){const box=$('chat-messages');box.append(el('div',`bubble ${who}`,text));box.scrollTop=box.scrollHeight;}
$('reset-chat').addEventListener('click',async()=>{try{await api('/api/simulate/reset',{method:'POST'});$('chat-messages').replaceChildren();addBubble('Olá! Podemos começar um novo atendimento. 🍕','bot');$('cart-view').textContent='Carrinho vazio.';}catch(e){message(e.message,true);}});
$('save-business').addEventListener('click',async()=>{try{const body=JSON.parse($('business-json').value);await api('/api/business',{method:'PUT',body:JSON.stringify(body)});message('Cardápio salvo e atualizado.');}catch(e){message(`Não foi possível salvar: ${e.message}`,true);}});
load().catch(()=>loginUI(true));

$('check-ai').addEventListener('click',async()=>{const b=$('check-ai');b.disabled=true;try{const r=await api('/api/ai/check',{method:'POST'});$('ai-mode-detail').textContent=`IA respondeu ao teste. Modelo: ${r.model}.`;message('Conexão com modelo validada.');}catch(e){$('ai-mode-detail').textContent=e.message;message(e.message,true);}finally{b.disabled=false;}});

async function loadPdfStatus(){
 try{
  const info=await api('/api/cardapio-pdf');
  $('pdf-current').textContent=info.active?'Ativo: '+info.active.name+' • '+new Date(info.active.uploadedAt).toLocaleString('pt-BR'):'Nenhum cardápio PDF cadastrado.';
  $('pdf-download').hidden=!info.active;
  const list=$('pdf-versions');list.replaceChildren();
  if(!info.versions.length)list.append(el('p','muted','Nenhuma versão enviada.'));
  for(const item of info.versions){
   const row=el('div','row-record'),details=el('div');
   details.append(el('b','',item.name),el('div','muted',new Date(item.uploadedAt).toLocaleString('pt-BR')+' • '+(item.size/1048576).toFixed(2)+' MB'));
   row.append(details);
   if(item.active)row.append(el('strong','','Ativo'));
   else row.append(btn('Restaurar esta versão',async()=>{
    if(!confirm('Ativar este cardápio para todos os próximos atendimentos?'))return;
    try{await api('/api/cardapio-pdf/activate',{method:'POST',body:JSON.stringify({id:item.id})});message('Versão anterior ativada com sucesso.');await loadPdfStatus();}
    catch(e){message(e.message,true);}
   }));
   list.append(row);
  }
 }catch(e){message('Falha ao consultar os PDFs: '+e.message,true);}
}
$('pdf-upload-form').addEventListener('submit',async event=>{
 event.preventDefault();
 const input=$('pdf-file'),file=input.files?.[0],feedback=$('pdf-feedback'),button=$('pdf-upload-btn');
 if(!file)return;
 if(file.size>20*1024*1024){feedback.textContent='PDF acima do limite de 20 MB.';return;}
 if(!file.name.toLowerCase().endsWith('.pdf')){feedback.textContent='Selecione um arquivo PDF.';return;}
 button.disabled=true;feedback.textContent='Enviando PDF...';
 try{
  const response=await fetch('/api/cardapio-pdf',{method:'PUT',credentials:'same-origin',headers:{'content-type':'application/pdf','x-filename':file.name},body:file});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'Erro no envio');
  feedback.textContent='PDF salvo e ativado com sucesso. ✅';input.value='';
  message('Novo cardápio PDF ativado.');await loadPdfStatus();
 }catch(e){feedback.textContent='Erro: '+e.message;message(e.message,true);}
 finally{button.disabled=false;}
});
