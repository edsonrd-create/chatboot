# Guto Bot Humanizado v1.2 — Guto Express

**Implementação inicial executável** de atendimento e pedidos para **duas caixas WhatsApp via Chatwoot**. Aplicação Node.js 22+ sem dependências npm, com painel, simulador, motor de pedidos determinístico, integração opcional por API de IA (Responses API) e persistência simples em disco. **Não está hospedada nem conectada aos números reais**.

## O que funciona no código

- Painel responsivo com login administrativo assinado, cookies HttpOnly/SameSite, proteção básica de CSRF e limite de tentativas.
- Webhook `POST /webhooks/chatwoot`, assinatura `X-Chatwoot-Signature` (HMAC-SHA256 do `timestamp.raw_body`) e janela antirreplay de 5 minutos.
- Filtragem por conta e **duas inboxes configuradas**; deduplicação de eventos por identificador da mensagem e persistência antes de processar.
- Atendimento por IA **somente com chave configurada**. Ferramentas de consulta de cardápio, montagem de pizza de 1 ou 2 sabores, bebida, endereço, pagamento, revisão e transferência humana.
- Preços em centavos recalculados no servidor; se incompletos, **não é possível registrar pedido**. Regra de meia a meia precisa ser aprovada e configurada.
- Resumo do pedido exibido ao cliente, confirmação explícita em mensagem posterior, idempotência para a solicitação.
- Pedido entra em `PENDING_STAFF_REVIEW`; equipe aprova/rejeita antes da produção. Painel tem estados até entrega.
- Caixa de conversa por canal, botão de pausar/retomar bot, simulador privado e edição validada do cardápio JSON.
- Dockerfile, Compose para **uma instância** e testes automatizados.

### Não implementado / limitações honestas

- **Não há integração direta com a Meta**: números existentes devem ser integrados **no Chatwoot**, com elegibilidade de coexistência verificada separadamente.
- Sem `OPENAI_API_KEY`, o simulador responde perguntas básicas com regras simples, **não** interpreta pedidos livres completos.
- Não inclui transcrição de áudio, fotos, geração de Pix, consulta de CEP/entrega por geolocalização, pagamento verificado, fidelidade vinculada ao PDV ou sincronização com o PDV.
- **Não é sistema pronto para escala de produção:** persiste JSON em disco, executa worker no mesmo processo, exige uma instância/volume e não oferece garantias de exatamente uma entrega de resposta após falha durante envio externo. Migrar para PostgreSQL e fila durável antes de escalar.
- A notificação automática de alteração do pedido após aprovação humana ainda não está implementada.
- Chatwoot e API de IA não foram exercitados com contas reais neste ambiente. Os testes de integração usam requisições assinadas e IA simulada.

## 1. Uso local (Node.js 22 ou superior)

Sem `npm install` (nenhuma dependência externa no package.json):

```powershell
Copy-Item .env.example .env
# Edite .env e preencha ADMIN_PASSWORD e APP_SECRET
npm test
npm start
```

Abra **http://127.0.0.1:8080/**, use a senha administrativa. Em **Simulador IA**, teste o fluxo. Para testar linguagem livre, configure `OPENAI_API_KEY` e `OPENAI_MODEL` no `.env` no servidor; sem chave, o simulador é limitado a FAQ.

Para gerar um segredo local forte com Node instalado:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Não use esse segredo como `ADMIN_PASSWORD`; escolha senha forte própria, de pelo menos 12 caracteres. **Não envie essas credenciais pelo chat e não faça commit do `.env`.**

## 2. Dois números no Chatwoot

1. Crie ou utilize **duas caixas de entrada WhatsApp** dentro da conta Chatwoot. **Antes de alterar os números que já funcionam**, confirme se cada número é elegível à coexistência entre WhatsApp Business App e Cloud API. Não desconecte números operacionais por tentativa.
2. Na conta do Chatwoot, obtenha `CHATWOOT_ACCOUNT_ID`, `CHATWOOT_INBOX_1` e `CHATWOOT_INBOX_2` (IDs numéricos de caixas **distintas**). Obtenha URL HTTPS do Chatwoot e token de API **somente no servidor**.
3. Em **Settings → Integrations → Webhooks**, crie webhook com evento `message_created`, URL `https://SEU_DOMINIO/webhooks/chatwoot` e copie o segredo do webhook para `CHATWOOT_WEBHOOK_SECRET`.
4. Configure todas as variáveis acima. Reinicie o serviço. A tela indicará **Chatwoot configurado**, o que significa credenciais presentes, **não valida conectividade real**.
5. Envie mensagens de **números de teste** para cada WhatsApp, confirme os IDs de inbox e as respostas, teste duplicação, retomada humana e regras de 24h/janelas/tarifas da Meta.

Docs: [Chatwoot — webhooks e assinatura](https://www.chatwoot.com/hc/user-guide/articles/1677693021-how-to-use-webhooks) · [Chatwoot — API de mensagens](https://developers.chatwoot.com/api-reference/messages/create-new-message)

## 3. Cardápio, preço e atendimento

Em **Cardápio e regras**, abra a configuração JSON. O arquivo de partida contém tamanhos e **alguns sabores demonstrativos**, **sem preços inventados**. Todos os preços (em centavos) estão `null`, inclusive a taxa de entrega, e `halfHalfPricing` está `null`.

- Pizza Grande de R$ 59,99: preço em centavos **5999**, somente se confirmado pela operação.
- `halfHalfPricing`: `MAX` ou `AVERAGE` **somente depois de aprovar** a regra comercial. `null` impede cotação de meio a meio.
- `deliveryFeeCents`: cadastra uma taxa fixa **se isso corresponder à operação real**; ainda não há cálculo por bairro/raio. O atendente humano deve verificar se o endereço é atendido.
- Cadastre formas de pagamento e FAQ em conformidade com a operação. O campo `payment=PIX` é **preferência declarada**, não pagamento recebido.

**Nunca habilite o atendimento automático real antes de conferir cardápio, sabores, horários, custos de entrega e transferência para atendentes.**

## 4. Deploy independente por Docker

Na nuvem, o app precisa de um servidor/container com **HTTPS via proxy gerenciado**, volume persistente e **apenas 1 instância**. Configure secrets como variáveis da hospedagem (não no repositório):

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=8080
APP_PUBLIC_URL=https://seu-dominio.example
ADMIN_PASSWORD=...senha-forte...
APP_SECRET=...segredo-aleatório-32+-chars...
DATA_FILE=/app/data/state.json
BUSINESS_FILE=/app/data/business.json
CHATWOOT_BASE_URL=https://sua-instancia-chatwoot.example
CHATWOOT_API_TOKEN=...
CHATWOOT_WEBHOOK_SECRET=...
CHATWOOT_ACCOUNT_ID=...
CHATWOOT_INBOX_1=...
CHATWOOT_INBOX_2=...
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1-mini
```

A plataforma deve construir pelo `Dockerfile`, criar **volume persistente `/app/data`**, colocar proxy HTTPS à frente da porta `8080` e manter a instância única. O `compose.yaml` inicia localmente via `docker compose up --build -d` e **expõe apenas em 127.0.0.1**: não é publicação pública sozinho. Configure proxy TLS para domínio real. Se `BUSINESS_FILE` não existir, a configuração demonstrativa é copiada na primeira inicialização.

**Nota:** o modelo `gpt-4.1-mini` é apenas configuração inicial; sua disponibilidade e custo dependem da conta e precisam ser validados antes da operação.

## 5. Endpoints

| Método | Rota | Uso |
|---|---|---|
| GET | `/health` | Estado do servidor, sem credenciais |
| POST | `/webhooks/chatwoot` | Recepção segura de mensagens |
| POST | `/api/login` | Login de administrador |
| POST | `/api/logout` | Encerrar sessão |
| GET | `/api/dashboard` | Estatísticas, conversas e pedidos |
| GET/PUT | `/api/business` | Consultar/editar cardápio |
| POST | `/api/simulate` | Conversar no simulador privado |
| POST | `/api/simulate/reset` | Reiniciar o simulador |
| POST | `/api/conversations/:key/mode` | Alternar BOT/HUMAN |
| POST | `/api/orders/:id/status` | Aprovar/avançar pedido |

As rotas administrativas exigem cookie de login. **Nunca compartilhe sessão, senha ou token.**

## 6. Testes

```bash
npm test
```

Os testes verificam assinatura/replay do webhook, isolamento dos canais, recusa de origem não autorizada, autenticação, fluxo da IA com resposta simulada, precificação, cotação de meio a meio, confirmação humana, revalidação do preço, duplicidade, persistência e fallback de atendimento humano.

## 7. Próximas fases de produção

1. Conectar as duas caixas Chatwoot em ambiente de testes sem interromper WhatsApp Business e executar piloto.
2. Validar a integração com API de IA real, limites e custos; preencher catálogo real e regras de entrega.
3. Migrar eventos, mensagens, pedidos e outbox para **PostgreSQL** e jobs para **Redis/BullMQ**, com workers separados, migrações reversíveis, backups e observabilidade.
4. Implementar áudio com transcrição, consulta de endereços, logística, integração PDV/KDS e pagamentos.
5. Homologar segurança, LGPD, fluxo de atendimento humano e falhas de rede; só então atender clientes reais.

**Estado do projeto:** base funcional local com testes automatizados e painel. Nenhuma publicação ou conexão real foi feita automaticamente.

## Catálogo público expandido — revisão 25/10/2026

Foi adicionada uma fotografia informativa do cardápio encontrado em `https://www.gutoexpress.com.br/cardapio?dvc=mobile&ed_mobile_iframe=1`, já que `https://pedir.to/gutoexpress` não pôde ser consultado diretamente.

- `config/cardapio-publico.json`: 74 sabores por categoria e ingredientes, 7 ofertas/combos e 20 bebidas não alcoólicas com os valores públicos de referência.
- `config/business.json`: fornece os mesmos sabores e combos como conhecimento para o serviço de IA. Todos os preços exatos de pizza por tamanho continuam `null` de propósito, sem inventar regras de promoções nem uma taxa única de entrega.
- `preview/index.html`: demonstração estática independente do backend. Pode ser publicada no GitHub Pages, mas não opera com WhatsApp real.
- `src/ai.mjs`: a ferramenta de consulta de cardápio oferece ingredientes, promoções e restrições ao modelo; checkout permanece bloqueado até receber dados exatos de preço e entrega.

**Regra crítica:** preços `startingPriceCents` e `publishedPriceCents` são referências públicas, não cotações. Não use essas referências diretamente para registrar pedidos ou cobrar sem conferir regras vigentes na operação.


## Treinamento com conversas realistas (V1.4)

- Manual e critérios: `docs/TREINAMENTO-REALISTA.md`.
- Exemplos de atendimento incluídos no prompt operacional: `src/training.mjs`.
- Casos de teste sintéticos com mensagens encadeadas: `training/realistic-cases.json`.
- Motor conversacional de demonstração com carrinho próprio: `public/simulator.js`, usado também por `preview/index.html` (GitHub Pages).
- Teste funcional sem respostas falsas pré-programadas: `test/simulator-realistic.test.mjs`.

Use `npm test` para regressão local. Esse teste não acessa Meta/Chatwoot, não testa um modelo de IA remoto e não registra pedidos de clientes reais. Para produção são necessários testes de ponta a ponta com credenciais autorizadas.
