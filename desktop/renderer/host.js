'use strict';
const $=id=>document.getElementById(id);
const bridge=window.gutoDesktop;
const state={
  active:1, mode:'single',
  statuses:{1:'Aguardando WhatsApp Web 01',2:'Aguardando WhatsApp Web 02'},
  drafts:{
    1:{customer:'',fulfillment:'Entrega',notes:'',items:[]},
    2:{customer:'',fulfillment:'Entrega',notes:'',items:[]}
  }
};

// Estes retângulos são a única ponte de posicionamento. O renderer não acessa
// a DOM, credenciais ou mensagens do WhatsApp Web, que roda em outra sessão.
function rectOf(node){
  const r=node.getBoundingClientRect();
  if(!r.width||!r.height)return null;
  return {x:Math.round(r.left),y:Math.round(r.top),width:Math.round(r.width),height:Math.round(r.height)};
}
function positionRealWhatsApp(){
  const panes={};
  if(state.mode==='split'){
    panes[1]=rectOf($('whatsapp-stage-1'));
    panes[2]=rectOf($('whatsapp-stage-2'));
    if(!panes[1]||!panes[2]||panes[1].width<300||panes[2].width<300){
      $('connection-status').textContent='Para ver os dois números, aumente a janela ou oculte o painel do pedido.';
      // Não executar divisão inválida: preservar a visualização do WhatsApp ativo.
      return;
    }
  }else{
    panes[state.active]=rectOf($('whatsapp-stage-'+state.active));
    if(!panes[state.active])return;
  }
  bridge.layout({mode:state.mode,active:state.active,panes});
}
let pendingLayout=false;
function scheduleLayout(){
  if(pendingLayout)return;
  pendingLayout=true;
  requestAnimationFrame(()=>{
    pendingLayout=false;
    positionRealWhatsApp();
  });
}
const observer=new ResizeObserver(scheduleLayout);
observer.observe($('whatsapp-stage-1'));
observer.observe($('whatsapp-stage-2'));
window.addEventListener('resize',scheduleLayout);
window.addEventListener('load',scheduleLayout);
bridge.onLayoutRequest(scheduleLayout);

function draftForCurrentSlot(){return state.drafts[state.active];}
function showChannelUI(){
  document.querySelectorAll('.tab').forEach(tab=>{
    const isActive=Number(tab.dataset.slot)===state.active;
    tab.classList.toggle('active',isActive);
    tab.setAttribute('aria-selected',String(isActive));
  });
  const split=state.mode==='split';
  $('web-stage-grid').classList.toggle('split',split);
  $('split-view-toggle').setAttribute('aria-pressed',String(split));
  $('split-view-toggle').textContent=split?'▣ Mostrar um WhatsApp':'◫ 2 números lado a lado';
  for(const slot of [1,2]){
    $('live-pane-'+slot).hidden=!split && slot!==state.active;
    $('status-'+slot).textContent=state.statuses[slot];
  }
  $('connection-status').textContent=state.statuses[state.active];
  $('footer-slot').textContent=split?'WhatsApp 01 + 02':'Canal 0'+state.active;
  const draft=draftForCurrentSlot();
  $('customer').value=draft.customer;
  $('notes').value=draft.notes;
  $('fulfillment').value=draft.fulfillment;
  renderDraft();
  scheduleLayout();
}

for(const tab of document.querySelectorAll('.tab')){
  tab.addEventListener('click',async()=>{
    const slot=Number(tab.dataset.slot);
    if(slot===state.active)return;
    try{
      const reply=await bridge.switchChannel(slot);
      if(!reply?.ok)return;
      state.active=slot;
      showChannelUI();
    }catch{$('connection-status').textContent='Não foi possível alternar o canal.';}
  });
}
$('split-view-toggle').addEventListener('click',()=>{
  state.mode=state.mode==='split'?'single':'split';
  showChannelUI();
});
bridge.onStatus(value=>{
  if(!value||![1,2].includes(value.slot)||typeof value.status!=='string')return;
  state.statuses[value.slot]=value.status.slice(0,180);
  $('status-'+value.slot).textContent=state.statuses[value.slot];
  if(value.slot===state.active)$('connection-status').textContent=state.statuses[value.slot];
});
bridge.statusAll().then(data=>{
  if(!Array.isArray(data))return;
  for(const item of data){
    if(item&&[1,2].includes(item.slot)&&typeof item.status==='string'){
      state.statuses[item.slot]=item.status;
      $('status-'+item.slot).textContent=item.status;
    }
  }
  $('connection-status').textContent=state.statuses[state.active];
}).catch(()=>{});
$('reload').addEventListener('click',()=>bridge.reload(state.active));
$('order-toggle').addEventListener('click',()=>{
  $('orders-panel').classList.toggle('collapsed');
  scheduleLayout();
});

$('customer').addEventListener('input',event=>{draftForCurrentSlot().customer=event.target.value.slice(0,90);});
$('notes').addEventListener('input',event=>{draftForCurrentSlot().notes=event.target.value.slice(0,500);});
$('fulfillment').addEventListener('change',event=>{draftForCurrentSlot().fulfillment=event.target.value;});
$('add-item').addEventListener('click',()=>{
  const flavors=$('flavors').value.trim(),qty=Number($('quantity').value);
  if(!flavors){$('flavors').focus();return;}
  if(!Number.isInteger(qty)||qty<1||qty>10){$('quantity').focus();return;}
  draftForCurrentSlot().items.push({size:$('pizza-size').value,flavors:flavors.slice(0,180),qty});
  $('flavors').value='';$('quantity').value='1';renderDraft();
});
function renderDraft(){
  const draft=draftForCurrentSlot(),list=$('draft-list');list.replaceChildren();
  $('item-count').textContent=draft.items.reduce((total,item)=>total+item.qty,0);
  if(!draft.items.length){
    const p=document.createElement('p');p.className='empty';
    p.textContent='Nenhum item anotado para este WhatsApp.';list.append(p);return;
  }
  draft.items.forEach((item,index)=>{
    const row=document.createElement('div');row.className='draft-item';
    const info=document.createElement('div');info.className='item-details';
    const title=document.createElement('b');title.textContent=item.qty+'× Pizza '+item.size;
    const flavors=document.createElement('small');flavors.textContent=item.flavors;
    const remove=document.createElement('button');remove.className='remove';remove.type='button';
    remove.textContent='×';remove.title='Remover item';
    remove.onclick=()=>{draft.items.splice(index,1);renderDraft();};
    info.append(title,flavors);row.append(info,remove);list.append(row);
  });
}
function buildSummary(){
  const draft=draftForCurrentSlot();
  const items=draft.items.map((item,index)=>(index+1)+'. '+item.qty+'× Pizza '+item.size+' — '+item.flavors);
  return [
    'RASCUNHO DE ATENDIMENTO — NÃO É PEDIDO CONFIRMADO',
    'Canal WhatsApp: 0'+state.active,
    'Cliente: '+(draft.customer||'não identificado'),
    'Modalidade: '+draft.fulfillment,
    'Itens:',
    ...(items.length?items:['Nenhum item anotado']),
    'Observações: '+(draft.notes||'nenhuma'),
    'Valores, disponibilidade e pedido no PDV: NÃO CONFERIDOS'
  ].join('\n');
}
$('copy-draft').addEventListener('click',async()=>{
  try{
    const ok=await bridge.copyDraft(buildSummary());
    if(ok){const b=$('copy-draft');b.textContent='Resumo copiado ✓';setTimeout(()=>b.textContent='Copiar resumo',1600);}
  }catch{$('copy-draft').textContent='Não foi possível copiar';}
});
$('clear-draft').addEventListener('click',()=>{
  state.drafts[state.active]={customer:'',fulfillment:'Entrega',notes:'',items:[]};
  $('flavors').value='';showChannelUI();
});
showChannelUI();
