import test from "node:test";
import assert from "node:assert/strict";
import {adaptCatalogV2ForBot,loadCatalogV2ForBot} from "../src/catalog-v2-adapter.mjs";
const a=(x)=>"GXE-"+x.repeat(32);
const base={businessName:"Guto Express",faq:{},sizes:[],flavors:[],drinks:[],pizzas:{},halfHalfPricing:null,deliveryFeeCents:null};
const payload=()=>({
  ok:true,ready:true,source:"cardapio_v2",channel:"WHATSAPP",
  categories:[{cod_pdv:a("a"),tipo:"PIZZA",nome:"Salgadas",flavor_pricing_rule:"MAX"}],
  flavors:[{cod_pdv:a("b"),categoria_cod_pdv:a("a"),nome:"Calabresa"}],
  sizes:[{cod_pdv:a("c"),categoria_cod_pdv:a("a"),nome:"Grande",pedacos:10,sabores_aceitos:[1,2]}],
  calculatedFlavorPrices:[{flavor:a("b"),size:a("c"),pizzaWithDoughPriceCents:3999}],
  products:[],combos:[],
});
test("formato V2 completo importa códigos estáveis e preços sem casar nomes",()=>{
 const business=adaptCatalogV2ForBot(payload(),base);
 assert.equal(business.flavors[0].id,a("b"));
 assert.equal(business.pizzas[a("b")][a("c")],3999);
 assert.equal(business.halfHalfPricing,"MAX");
 assert.equal(business.catalogSource.source,"cardapio_v2");
});
test("V2 incompleta recusa ativação do bot",()=>{
 const p=payload();p.calculatedFlavorPrices=[];
 assert.throws(()=>adaptCatalogV2ForBot(p,base),/Preço absoluto/);
});
test("regra SUM não é falsamente convertida para AVG",()=>{
 const p=payload();p.categories[0].flavor_pricing_rule="SUM";
 assert.throws(()=>adaptCatalogV2ForBot(p,base),/incompatíveis/);
});
test("feature flag desativada preserva cardápio antigo sem rede",async()=>{
 const r=await loadCatalogV2ForBot({CARDAPIO_V2_BOT_READ_ENABLED:"false"},base,()=>{
   throw Error("não deveria consultar a rede");
 });
 assert.equal(r.business,base);assert.equal(r.source,"legacy");
});
test("endpoint protegido indisponível deixa modo legacy explícito",async()=>{
 const r=await loadCatalogV2ForBot({
   CARDAPIO_V2_BOT_READ_ENABLED:"true",CARDAPIO_V2_API_URL:"https://example.com/api/v1/catalog-v2",
   CARDAPIO_V2_CHATBOT_TOKEN:"z".repeat(40),
 },base,async()=>({ok:false,status:503}));
 assert.equal(r.source,"legacy");assert.match(r.reason,/503/);
});
test("endpoint pronto importa catálogo em homologação",async()=>{
 const r=await loadCatalogV2ForBot({
   CARDAPIO_V2_BOT_READ_ENABLED:"true",CARDAPIO_V2_API_URL:"https://example.com/api/v1/catalog-v2",
   CARDAPIO_V2_CHATBOT_TOKEN:"z".repeat(40),
 },base,async()=>({ok:true,json:async()=>payload()}));
 assert.equal(r.source,"v2");
});
