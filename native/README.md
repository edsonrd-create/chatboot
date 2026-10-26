# Guto Bot Nativo — V2.0 RC1

Sistema próprio de atendimento da Guto Express. **Não depende de Chatwoot, QR de WhatsApp Web, Neemo, plataformas intermediárias de atendimento ou navegador de celular aberto.** Opera diretamente com a **Meta WhatsApp Cloud API**, sob sua própria aplicação Meta e com dois números independentes.

## Publicação da homologação em Render

[Publicar Guto Bot V2 no Render (branch isolada)](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Fedsonrd-create%2Fchatboot%2Ftree%2Ffeature%2Fguto-bot-nativo-meta-v2)

Blueprint de hospedagem: [render.yaml](../render.yaml). Instruções, riscos de cobrança e checagens: [PUBLICAR-HOMOLOGACAO-RENDER.md](docs/PUBLICAR-HOMOLOGACAO-RENDER.md).

**Atenção:** a implantação de homologação inicia sem credenciais Meta, sem IA e sem criação de pedidos reais. A hospedagem precisa de `ADMIN_PASSWORD` cadastrada no painel de segredos e utiliza plano Starter com disco persistente (pode ser cobrado).

## Situação: HOMOLOGAÇÃO — NÃO USAR PARA PEDIDOS REAIS

A IA automática está travada (não há opção administrativa para liberar sem homologação). O laboratório usa IA real somente com chave de API configurada. O envio manual depende de conexão verificada por número, janela de 24 horas e autenticação. O PDV está em modo **somente leitura**. O banco atual é um arquivo JSON transacional para uma única instância: deve ser substituído por PostgreSQL + worker durável antes de produção.

## Funcionalidades implementadas

- Painel próprio, responsivo e independente: `/painel`, `/app.css`, `/app.js`.
- Dois canais gerenciados localmente com IDs oficiais `phone_number_id`.
- Endpoint Meta webhook direto: `GET/POST /webhooks/meta` com challenge e HMAC-SHA256 do corpo original.
- Recebimento de texto, indicação de mídia não processada, status de entrega e eventos echo disponíveis.
- Histórico por canal + cliente, deduplicação, marcação de mensagens lidas, fila persistente de saída e modo humano.
- Envio manual de texto pela API Graph (sem Chatwoot), com identificação de canal e proteção da janela de 24 horas.
- Token de canal fornecido pelo administrador persistido com AES-256-GCM; jamais retornado pela API de configurações.
- Integração própria de cadastro incorporado da Meta (quando App ID/Configuration ID, permissões e elegibilidade permitem): login oficial por popup Meta dentro do Guto Bot, exchange de code somente no servidor, verificação de número e WABA e assinatura da aplicação no WABA.
- Laboratório de IA com motor de funções para cardápio/carrinho; **sem simular resposta quando a chave não está configurada**.
- Configurações do PDV via backend, com consulta às APIs públicas de cardápio e loja; envio de pedido desativado até criar endpoint homologado com autenticação e idempotência.
- Login por sessão assinada, SameSite Strict, rate limit, verificação de origem, sanitização de saída e CSP.

## Pré-requisitos

- Node.js 22+
- Aplicativo Meta associado à conta da pizzaria, permissões e fluxo Embedded Signup aprovados, se necessários.
- Hospedagem HTTPS e volume de dados persistente (para homologação). **Não** usar GitHub Pages como backend.

```bash
cp .env.example .env
# Edite .env localmente com credenciais reais e secret manager; nunca o versione
npm test
npm start
```

Inicie o navegador em `http://127.0.0.1:8080/painel` para desenvolvimento. Em produção, configurar domínio HTTPS, volume persistente com permissão para o usuário `node` e proxy confiável. O arquivo `compose.yaml` publica apenas na interface local por segurança.

## Conexão dos dois números existentes

1. Na Meta, configure seu próprio aplicativo Business, produto WhatsApp, permissão e acesso apropriados, webhook com `https://SEU-DOMINIO/webhooks/meta` e o mesmo token configurado em `META_VERIFY_TOKEN`.
2. Em Guto Bot → Configurações → WhatsApp 01 → Conectar, use o fluxo **oficial de cadastro incorporado Meta**, quando habilitado para seu aplicativo. Se o número estiver usando WhatsApp Business, selecione a opção de **coexistência** somente se oferecida e elegível. A interface exibida pode pedir QR ou verificação no aplicativo; o Guto Bot não inventa QR.
3. Repita para WhatsApp 02. Cada número obtém Phone Number ID próprio. Os tokens ficam protegidos no servidor.
4. Se você já possui IDs e tokens oficiais autorizados, pode registrar cada canal pelo formulário do Guto Bot, que consulta a Meta para verificar se número pertence ao WABA.
5. Teste com **outro celular**: mande mensagem a cada número, confirme que aparece no respectivo canal, responda manualmente e valide entrega e continuidade do app WhatsApp Business.

**ATENÇÃO:** o fluxo de coexistência pode desconectar dispositivos vinculados, variar por conta/país e exigir App Review/Advanced Access. Não remova nem migre seus números existentes sem verificar a elegibilidade e o impacto.

## PDV Guto Express

Foi analisado `edsonrd-create/guto-express-pdv`. O código disponibiliza:
- `GET /api/v1/menu` — consulta do cardápio.
- `GET /api/v1/store` — estado da loja.
- `POST /api/v1/quote` — cálculo de taxa por coordenadas/subtotal, mas não garante total de itens.

**Não foi localizado um contrato homologado de criação de pedido para esse chatbot.** O endpoint de ações do PDV não é autorização de criação de pedidos; nunca usá-lo como atalho. A aprovação de ordem continua fora do escopo desta RC.

## Critérios de saída (bloqueadores)

- [ ] Conta Meta real com onboarding e testes de webhook/entrega em dois números.
- [ ] Sessões, exclusão de mídia/retention e LGPD auditadas.
- [ ] IA com chave real, avaliação cega de diálogos inéditos e revisão humana de erros.
- [ ] Sincronização autoritativa dos preços no motor de pedidos (não só catálogo público).
- [ ] Novo contrato de API do PDV: escrita autenticada, schema de pizza/combos, idempotência, reversão segura, transação e KDS.
- [ ] Substituir persistência JSON por PostgreSQL e outbox durável com jobs robustos para múltiplas réplicas.
- [ ] Testes de E2E, carga, backup/restauração, recuperação de falhas e validação do layout no navegador mobile/desktop.

**Regra de engenharia:** código compilado e testes sintéticos não são prova de produção. `ready` deve permanecer `false` até homologação integral.

## Fontes técnicas

- Meta Cloud API — https://www.postman.com/meta/whatsapp-business-platform/overview
- Embedded Signup — https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup
- Cadastro/coexistência — https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users

## Render gratuito — somente demonstração

Na branch de homologação, `render.yaml` utiliza `plan: free` e `FREE_PREVIEW_MODE=true`. O modo gratuito bloqueia WhatsApp real, envios, integração ativa e IA paga, pois o armazenamento JSON é **efêmero**. O serviço pode hibernar. Consulte `docs/PUBLICAR-HOMOLOGACAO-RENDER.md`.
