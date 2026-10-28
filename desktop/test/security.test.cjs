'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {WHATSAPP_ORIGIN, PARTITIONS, validSlot, isWhatsAppUrl, normalizeBounds, safeDraftText} = require('../src/policy.cjs');
const read = relative => fs.readFileSync(path.resolve(__dirname,'..',relative),'utf8');

test('duas sessões WhatsApp distintas e persistentes por canal',()=>{
 assert.equal(PARTITIONS[1],'persist:guto-express-whatsapp-01');
 assert.equal(PARTITIONS[2],'persist:guto-express-whatsapp-02');
 assert.notEqual(PARTITIONS[1],PARTITIONS[2]);
 assert.deepEqual([1,2,3,'1',0].map(validSlot),[true,true,false,false,false]);
});

test('somente a origem oficial do WhatsApp Web pode ser navegada na visão remota',()=>{
 assert.equal(WHATSAPP_ORIGIN,'https://web.whatsapp.com');
 for(const url of ['https://web.whatsapp.com/','https://web.whatsapp.com/?lang=pt_BR','https://web.whatsapp.com/a/b'])assert.equal(isWhatsAppUrl(url),true,url);
 for(const url of ['http://web.whatsapp.com/','https://web.whatsapp.com.evil.tld/','https://evil.tld/','file:///C:/WINDOWS/win.ini','javascript:alert(1)','https://user:pass@web.whatsapp.com/','not-a-url'])assert.equal(isWhatsAppUrl(url),false,url);
});

test('WebContentsView é usado em vez de iframe ou DOM scraping',()=>{
 const src=read('src/main.cjs');
 assert.match(src,/new WebContentsView\(/);
 assert.match(src,/loadURL\(WHATSAPP_ORIGIN/);
 assert.match(src,/contextIsolation:\s*true/);
 assert.match(src,/nodeIntegration:\s*false/);
 assert.match(src,/sandbox:\s*true/);
 assert.match(src,/webSecurity:\s*true/);
 assert.match(src,/setWindowOpenHandler/);
 assert.doesNotMatch(src,/executeJavaScript|disable-web-security|--no-sandbox/);
 const html=read('renderer/host.html');
 assert.doesNotMatch(html,/<iframe|<webview/i);
});

test('área remota tem limites físicos sem coordenadas NaN e sem tamanho negativo',()=>{
 assert.deepEqual(normalizeBounds({x:70,y:120,width:800,height:600},{width:1200,height:800}),{x:70,y:120,width:800,height:600});
 assert.equal(normalizeBounds({x:NaN,y:120,width:800,height:600},{width:1200,height:800}),null);
 assert.equal(normalizeBounds({x:20,y:120,width:100,height:100},{width:1200,height:800}),null);
 const b=normalizeBounds({x:400,y:140,width:2000,height:999},{width:1100,height:700});
 assert.ok(b.x+b.width<=1100 && b.y+b.height<=700);
});

test('rascunho é copiado somente por ação explícita e possui limite',()=>{
 assert.equal(safeDraftText('  uma grande de calabresa  '),'uma grande de calabresa');
 assert.throws(()=>safeDraftText(' '));
 assert.throws(()=>safeDraftText('x'.repeat(9001)));
 const source=read('renderer/host.js');
 assert.match(source,/copy-draft.*addEventListener/);
 assert.match(source,/NÃO É PEDIDO CONFIRMADO/);
 assert.doesNotMatch(source,/fetch\(/);
});

test('sessões remotas não recebem APIs do processo principal ou acesso a dados do PDV',()=>{
 const source=read('src/main.cjs');
 const preload=read('src/preload.cjs');
 assert.ok(source.includes('ipcMain.on(\'guto:layout\''));
 assert.ok(source.includes('event.sender === window.webContents'));
 assert.ok(!source.includes('preload: path.join(__dirname, \'preload.cjs\')') || source.indexOf('preload: path.join(__dirname, \'preload.cjs\')')>source.indexOf('function createWhatsAppView'));
 assert.doesNotMatch(preload,/process\.env|\bfs\b|executeJavaScript/);
 assert.match(read('renderer/host.html'),/content-security-policy/i);
});
