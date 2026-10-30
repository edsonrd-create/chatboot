// Cardápio oficial do PDV Guto Express (GET /api/v1/menu, público) → catálogo usado pela IA.
// Preços, sabores, tamanhos e bebidas vêm do PDV; a IA não inventa valores.
// Regra de preço do PDV (pizza-rules.ts): tamanho + MÉDIA dos acréscimos dos sabores → equivale à média dos
// preços de cada sabor naquele tamanho. O total final ainda é recalculado pelo PDV ao gravar o pedido.

const SIZE_IDS = {broto: 'broto', 'média': 'media', media: 'media', grande: 'grande', big: 'big', gigante: 'gigante', 'grande promo': 'grande_promo'};
const SLICES = {broto: 6, media: 8, grande: 10, big: 12, gigante: 16, grande_promo: 10};
const slug = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);

export function catalogFromPdvMenu(menu, base) {
  if (!menu || menu.ok === false || !Array.isArray(menu.items)) throw new Error('Cardápio do PDV inválido');
  const items = menu.items.filter(i => i && i.inStock !== false);
  const pizzasRaw = items.filter(i => i.kind === 'pizza' && Array.isArray(i.sizes) && i.sizes.length);
  if (!pizzasRaw.length) throw new Error('Cardápio do PDV sem sabores de pizza');

  const sizes = new Map();
  const flavors = [], pizzas = {};
  for (const p of pizzasRaw) {
    const id = slug(p.name);
    if (!id || pizzas[id]) continue; // nomes repetidos: mantém o primeiro (o PDV já remove duplicados)
    pizzas[id] = {};
    for (const s of p.sizes) {
      const sid = SIZE_IDS[String(s.label || '').trim().toLowerCase()] || slug(s.label);
      if (!sid) continue;
      if (!sizes.has(sid)) sizes.set(sid, {id: sid, label: String(s.label), slices: SLICES[sid] || null, maxFlavors: Math.max(1, Math.min(5, Number(s.maxFlavors) || 1))});
      const price = Math.round(Number(s.priceCents));
      if (Number.isSafeInteger(price) && price > 0) pizzas[id][sid] = price;
    }
    const prices = Object.values(pizzas[id]);
    flavors.push({id, label: String(p.name), available: true, category: String(p.category || 'Pizzas'),
      ingredients: String(p.description || '').split(/,\s*|\s+e\s+/).map(x => x.trim()).filter(Boolean).slice(0, 15),
      startingPriceCents: prices.length ? Math.min(...prices) : null, priceType: 'pdv', availabilityVerified: true});
  }
  const drinks = items.filter(i => /bebida/i.test(i.category || '')).map(i => ({id: slug(i.name), label: String(i.name), priceCents: Math.round(Number(i.priceCents)) || null, priceType: 'pdv', available: true, availabilityVerified: true}));
  const combos = items.filter(i => /combo|promo/i.test(i.category || '') && i.kind !== 'pizza').map(i => ({id: slug(i.name), label: String(i.name), description: String(i.description || ''), publishedPriceCents: Math.round(Number(i.promoPriceCents ?? i.comboPriceCents ?? i.priceCents)) || null, priceType: 'pdv', autoCheckoutEnabled: false, available: true}));
  const order = ['broto', 'media', 'grande', 'big', 'gigante', 'grande_promo'];
  return {
    ...base,
    sizes: [...sizes.values()].sort((a, b) => (order.indexOf(a.id) + 99 * (order.indexOf(a.id) < 0)) - (order.indexOf(b.id) + 99 * (order.indexOf(b.id) < 0))),
    flavors, pizzas, drinks, combos,
    halfHalfPricing: 'AVERAGE',
    catalogSource: {source: 'PDV Guto Express /api/v1/menu', snapshotOnly: false, syncedAt: new Date().toISOString(), notice: 'Preços oficiais do PDV; total final recalculado pelo PDV ao registrar o pedido.'},
  };
}

/** Busca o cardápio no PDV. Falha não derruba o atendimento: mantém o último catálogo válido. */
export async function fetchPdvCatalog({fetchImpl = globalThis.fetch, baseUrl = 'https://pdvgutoexpress.com.br', timeoutMs = 10000} = {}) {
  const r = await fetchImpl(`${String(baseUrl).replace(/\/$/, '')}/api/v1/menu`, {signal: AbortSignal.timeout(timeoutMs)});
  if (!r.ok) throw new Error(`PDV menu HTTP ${r.status}`);
  return r.json();
}
