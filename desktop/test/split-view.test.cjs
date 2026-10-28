'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {parseDesktopLayout,PARTITIONS}=require('../src/policy.cjs');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const viewport={width:1600,height:900};
const pane1={x:70,y:158,width:520,height:700};
const pane2={x:596,y:158,width:520,height:700};

test('uma sessão exibe o WhatsApp Web real ocupando sua área',()=>{
 const result=parseDesktopLayout({mode:'single',active:1,panes:{1:{x:65,y:150,width:900,height:720}}},viewport);
 assert.equal(result.mode,'single');
 assert.deepEqual(Object.keys(result.panes),['1']);
 assert.equal(result.active,1);
});
test('duas sessões de WhatsApp Web abertas simultaneamente, em panes separadas',()=>{
 const result=parseDesktopLayout({mode:'split',active:1,panes:{1:pane1,2:pane2}},viewport);
 assert.ok(result);
 assert.deepEqual(Object.keys(result.panes),['1','2']);
 assert.equal(result.panes[1].x+result.panes[1].width+4<=result.panes[2].x,true);
 assert.notEqual(PARTITIONS[1],PARTITIONS[2]);
});
test('não aceita layout sobreposto que exponha o WhatsApp errado',()=>{
 const result=parseDesktopLayout({mode:'split',active:2,panes:{1:pane1,2:{...pane2,x:550}}},viewport);
 assert.equal(result,null);
});
test('não aceita área remota sobre cabeçalho, fora da janela ou pequena',()=>{
 for(const panes of [
  {1:{x:12,y:35,width:200,height:100}},
  {1:{x:12,y:600,width:900,height:850}},
  {1:{x:Number.NaN,y:100,width:700,height:400}},
  {1:{x:10,y:60,width:9999,height:400}}
 ])assert.equal(parseDesktopLayout({mode:'single',active:1,panes},viewport),null);
});
test('não permite sessão sem canal válido e não troca para um terceiro WhatsApp',()=>{
 assert.equal(parseDesktopLayout({mode:'single',active:3,panes:{3:pane1}},viewport),null);
 assert.equal(parseDesktopLayout({mode:'split',active:1,panes:{1:pane1}},viewport),null);
 assert.equal(parseDesktopLayout({mode:'iframe',active:1,panes:{1:pane1}},viewport),null);
});
test('interface contém as duas áreas WebContentsView, modo simultâneo e resumo durante a conversa',()=>{
 const html=read('renderer/host.html'),js=read('renderer/host.js');
 for(const id of ['whatsapp-stage-1','whatsapp-stage-2','live-pane-1','live-pane-2','split-view-toggle','orders-panel','draft-list','copy-draft'])assert.match(html,new RegExp('id="'+id+'"'),id);
 assert.match(js,/mode:'single'/);
 assert.match(js,/mode==='split'/);
 assert.match(js,/bridge\.layout\(\{mode:state\.mode,active:state\.active,panes\}\)/);
 assert.match(js,/drafts:\s*\{/);
 assert.match(js,/NÃO É PEDIDO CONFIRMADO/);
});
test('o site carregado é SEMPRE o WhatsApp Web oficial, não o HTML exportado nem iframe',()=>{
 const code=read('src/main.cjs'),html=read('renderer/host.html');
 assert.match(code,/new WebContentsView\(/);
 assert.match(code,/wc\.loadURL\(WHATSAPP_ORIGIN/);
 assert.doesNotMatch(code,/executeJavaScript|webRequest\.onBeforeRequest|disable-web-security|--no-sandbox/);
 assert.doesNotMatch(html,/<iframe|<webview/i);
 assert.doesNotMatch(code,/WhatsApp\(1\)\.html|loadFile\(.*whatsapp/i);
});
test('web WhatsApp não recebe a bridge privilegiada do aplicativo',()=>{
 const main=read('src/main.cjs'),preload=read('src/preload.cjs');
 assert.match(main,/nodeIntegration:false/);
 assert.match(main,/contextIsolation:true/);
 assert.match(main,/sandbox:true/);
 assert.match(main,/event\.sender\s*===\s*window\.webContents/);
 assert.match(main,/setPermissionRequestHandler/);
 assert.doesNotMatch(preload,/executeJavaScript|\bprocess\.env\b|\bfs\b/);
});
