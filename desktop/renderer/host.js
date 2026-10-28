'use strict';
const $ = id => document.getElementById(id);
const bridge = window.gutoDesktop;
const state = {active:1, drafts:{1:{customer:'',fulfillment:'Entrega',notes:'',items:[]},2:{customer:'',fulfillment:'Entrega',notes:'',items:[]}}};

function positionRealWhatsApp() {
  const stage = $('whatsapp-stage');
  const rect = stage.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  bridge.layout({x:rect.left,y:rect.top,width:rect.width,height:rect.height});
}
const observer = new ResizeObserver(positionRealWhatsApp);
observer.observe($('whatsapp-stage'));
window.addEventListener('resize',positionRealWhatsApp);
window.addEventListener('load',positionRealWhatsApp);

function setChannelUI() {
  document.querySelectorAll('.tab').forEach(button => {
    const isActive = Number(button.dataset.slot) === state.active;
    button.classList.toggle('active',isActive);
    button.setAttribute('aria-selected',isActive?'true':'false');
  });
  $('footer-slot').textContent=`Canal 0${state.active}`;
  const draft = state.drafts[state.active];
  $('customer').value=draft.customer;
  $('notes').value=draft.notes;
  $('fulfillment').value=draft.fulfillment;
  renderDraft();
  positionRealWhatsApp();
}
for(const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click',async()=>{
    const slot=Number(tab.dataset.slot);
    if(slot===state.active)return;
    const result=await bridge.switchChannel(slot);
    if(!result?.ok)return;
    state.active=slot;
    $('connection-status').textContent='Carregando WhatsApp Web…';
    setChannelUI();
  });
}
bridge.onStatus(({slot,status})=>{
  if(slot===state.active)$('connection-status').textContent=status;
});
$('reload').addEventListener('click',()=>bridge.reload());
$('order-toggle').addEventListener('click',()=>{
  $('orders-panel').classList.toggle('collapsed');
  positionRealWhatsApp();
});

function draftForCurrentSlot(){return state.drafts[state.active];}
$('customer').addEventListener('input',e=>{draftForCurrentSlot().customer=e.target.value.slice(0,90);});
$('notes').addEventListener('input',e=>{draftForCurrentSlot().notes=e.target.value.slice(0,500);});
$('fulfillment').addEventListener('change',e=>{draftForCurrentSlot().fulfillment=e.target.value;});
$('add-item').addEventListener('click',()=>{
  const flavors=$('flavors').value.trim();
  const qty=Number($('quantity').value);
  if(!flavors){$('flavors').focus();return;}
  if(!Number.isInteger(qty)||qty<1||qty>10){$('quantity').focus();return;}
  draftForCurrentSlot().items.push({size:$('pizza-size').value,flavors:flavors.slice(0,180),qty});
  $('flavors').value='';
  $('quantity').value='1';
  renderDraft();
});
function renderDraft(){
  const draft=draftForCurrentSlot(),list=$('draft-list');
  list.replaceChildren();
  $('item-count').textContent=draft.items.reduce((count,i)=>count+i.qty,0);
  if(!draft.items.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='Nenhum item anotado para este WhatsApp.';list.append(empty);return;}
  draft.items.forEach((item,index)=>{
    const row=document.createElement('div');row.className='draft-item';
    const text=document.createElement('div');text.className='item-details';
    const title=document.createElement('b');title.textContent=`${item.qty}× Pizza ${item.size}`;
    const detail=document.createElement('small');detail.textContent=item.flavors;
    const remove=document.createElement('button');remove.className='remove';remove.type='button';remove.textContent='×';remove.title='Remover item';
    remove.addEventListener('click',()=>{draft.items.splice(index,1);renderDraft();});
    text.append(title,detail);row.append(text,remove);list.append(row);
  });
}
function buildSummary(){
  const draft=draftForCurrentSlot();
  const items=draft.items.map((item,index)=>`${index+1}. ${item.qty}× Pizza ${item.size} — ${item.flavors}`);
  return [
    'RASCUNHO DE ATENDIMENTO — NÃO É PEDIDO CONFIRMADO',
    `Canal WhatsApp: 0${state.active}`,
    `Cliente: ${draft.customer||'não identificado'}`,
    `Modalidade: ${draft.fulfillment}`,
    'Itens:',
    ...(items.length?items:['Nenhum item anotado']),
    `Observações: ${draft.notes||'nenhuma'}`,
    'Valores, disponibilidade e pedido no PDV: NÃO CONFERIDOS'
  ].join('\n');
}
$('copy-draft').addEventListener('click',async()=>{
  try{
    const ok=await bridge.copyDraft(buildSummary());
    if(ok){const button=$('copy-draft');button.textContent='Resumo copiado ✓';setTimeout(()=>button.textContent='Copiar resumo',1600);}
  }catch{
    $('copy-draft').textContent='Não foi possível copiar';
  }
});
$('clear-draft').addEventListener('click',()=>{
  state.drafts[state.active]={customer:'',fulfillment:'Entrega',notes:'',items:[]};
  $('flavors').value='';setChannelUI();
});
setChannelUI();
