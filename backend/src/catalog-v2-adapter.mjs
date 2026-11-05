/** Adaptador V2: apenas dados completos, sem preencher valores por suposição. */
export function adaptCatalogV2ForBot(payload, base) {
  if (!payload || payload.ok !== true || payload.ready !== true ||
      payload.source !== "cardapio_v2") throw new Error("CATALOG_V2_NOT_READY");
  const categories=payload.categories ?? [];
  const pizzas=categories.filter(c=>c.tipo==="PIZZA");
  const flavorRows=payload.flavors??[];
  const sizeRows=payload.sizes??[];
  const prices=payload.calculatedFlavorPrices??[];
  const drinks=(payload.products??[]).filter(p=>/bebida|refrigerante/i.test(
    categories.find(c=>c.cod_pdv===p.categoria_cod_pdv)?.nome??""));
  // O bot legado suporta MAX e AVERAGE, não SUM. Falha fechada.
  const rules=new Set(pizzas.map(c=>c.flavor_pricing_rule));
  if(rules.size>1 || !["MAX","AVG"].includes([...rules][0]))
    throw new Error("Regras de preço V2 incompatíveis com o bot atual. É necessária adaptação do motor do bot.");
  const uniqueSizes=new Map();
  for(const s of sizeRows) {
    const previous=uniqueSizes.get(s.nome);
    if(previous && (previous.pedacos!==s.pedacos ||
      JSON.stringify(previous.sabores_aceitos)!==JSON.stringify(s.sabores_aceitos)))
      throw new Error("Tamanho duplicado com regra divergente na V2: "+s.nome);
    uniqueSizes.set(s.nome,s);
  }
  if(!flavorRows.length||!uniqueSizes.size)throw new Error("Catálogo V2 sem sabores ou tamanhos");
  const groupedPrice=new Map(prices.map(p=>[p.flavor+"|"+p.size,p.pizzaWithDoughPriceCents]));
  const sizes=[...uniqueSizes.values()].map(s=>({
    id:s.cod_pdv,label:s.nome,slices:s.pedacos,
    flavorCounts:s.sabores_aceitos,
  }));
  const flavors=flavorRows.map(f=>({
    id:f.cod_pdv,label:f.nome,available:true,
    category:categories.find(c=>c.cod_pdv===f.categoria_cod_pdv)?.nome??"Pizza",
    ingredients:[],availabilityVerified:true,
    startingPriceCents:null,priceType:"absolute",
  }));
  const matrix={};
  for(const flavor of flavorRows){
    matrix[flavor.cod_pdv]={};
    const matchingSizes=sizeRows.filter(s=>s.categoria_cod_pdv===flavor.categoria_cod_pdv);
    for(const size of matchingSizes){
      const cents=groupedPrice.get(flavor.cod_pdv+"|"+size.cod_pdv);
      if(!Number.isSafeInteger(cents)||cents<0)
        throw new Error("Preço absoluto com massa não configurado: "+flavor.cod_pdv+" / "+size.cod_pdv);
      matrix[flavor.cod_pdv][size.cod_pdv]=cents;
    }
  }
  // Sem conversão de combos em pizzas avulsas. O bot mantém combos como consulta, não confirma sozinho.
  return {
    ...base,sizes,flavors,pizzas:matrix,
    halfHalfPricing:[...rules][0]==="AVG"?"AVERAGE":"MAX",
    drinks:drinks.map(p=>({id:p.cod_pdv,label:p.nome,available:true,priceCents:p.priceCents})),
    combos:(payload.combos??[]).map(p=>({
      id:p.cod_pdv,label:p.nome,publishedPriceCents:p.priceCents,
      restrictions:p.groups??[],autoCheckoutEnabled:false,
    })),
    catalogSource:{source:"cardapio_v2",generatedAt:payload.generatedAt,channel:payload.channel},
  };
}

export async function loadCatalogV2ForBot(config, base, fetchImpl=fetch) {
  if(config.CARDAPIO_V2_BOT_READ_ENABLED!=="true")
    return {business:base,source:"legacy",reason:"V2_DISABLED"};
  const endpoint=config.CARDAPIO_V2_API_URL;
  const secret=config.CARDAPIO_V2_CHATBOT_TOKEN;
  if(!endpoint?.startsWith("https://") || !secret || secret.length<32)
    return {business:base,source:"legacy",reason:"V2_CREDENTIALS_MISSING"};
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),7000);
  try{
    const url=new URL(endpoint);
    if(url.pathname!=="/api/v1/catalog-v2")throw new Error("Rota V2 incorreta");
    url.searchParams.set("channel","WHATSAPP");
    const response=await fetchImpl(url.href,{
      headers:{authorization:"Bearer "+secret,accept:"application/json"},
      signal:controller.signal,
    });
    if(!response.ok)throw new Error("V2 HTTP "+response.status);
    const payload=await response.json();
    return {business:adaptCatalogV2ForBot(payload,base),source:"v2",reason:null};
  }catch(e){
    return {business:base,source:"legacy",reason:e instanceof Error?e.message:"UNAVAILABLE"};
  }finally{clearTimeout(timeout)}
}
