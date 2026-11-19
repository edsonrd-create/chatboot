import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');

test('Homologação consulta diagnostico PDV e sincronizacao do catalogo',()=>{
 assert.match(ui,/await Promise\.all\(\[updatePdvOrderStatus\(\),refreshCatalogReadiness\(\)\]\)/);
 assert.match(ui,/ss\.pdvOrders=result/);
 assert.match(ui,/ss\.catalog=await api\('\/api\/cardapio-whatsapp\/status'\)/);
 assert.match(ui,/if\(ss\.screen==='settings'\)renderChecklist\(\)/);
});

test('PDV autenticado nao se confunde com idempotencia e teste de gravacao',()=>{
 assert.match(ui,/const pdvConnected=ss\.pdvOrders\?\.ok===true/);
 assert.match(ui,/ok:pdvConnected,label:'PDV: autenticação da API de pedidos'/);
 assert.match(ui,/ok:false,label:'Criação de pedidos: idempotência e gravação homologadas'/);
 assert.match(ui,/ok:false,label:'Testes ponta a ponta, recuperação e segurança aprovados'/);
});

test('Consulta de cardapio nao aprova indevidamente leitura da loja',()=>{
 assert.match(ui,/const catalogSynced=ss\.catalog\?\.sync\?\.ok===true/);
 assert.match(ui,/const readConfirmed=Boolean\(s\.pdv\?\.lastTest\?\.ok&&s\.pdv\?\.enabled\)/);
 assert.match(ui,/ok:catalogSynced,label:'PDV: cardápio sincronizado em leitura'/);
 assert.match(ui,/ok:readConfirmed,label:'PDV: cardápio e situação da loja testados'/);
});

test('WhatsApp QR ativo nao prova sozinho recebimento e envio Meta',()=>{
 assert.match(ui,/const verified=Boolean\(meta\?\.apiVerifiedAt&&meta\?\.lastInboundAt&&meta\?\.lastOutboundAt\)/);
 assert.match(ui,/QR conectado; teste real de recebimento e envio ainda pendente/);
});
