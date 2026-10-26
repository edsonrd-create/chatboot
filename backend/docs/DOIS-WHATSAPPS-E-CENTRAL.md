# Guto Bot V1.8 — Dois WhatsApps e central de conversas

## Arquitetura

O backend apresenta a central em `/inbox` (após login administrativo). A central tem filtros **WhatsApp 01**, **WhatsApp 02** e **Todas**; busca; histórico; detalhes do carrinho; transferência humana; botão de resposta manual. As APIs `/api/inbox/**` exigem login. Enviar exige canal configurado, modo **HUMAN** e idempotência; `202 queued` não significa entregue, apenas enfileirado.

## Conectar os dois WhatsApp Business existentes

Recomendação: **Chatwoot + Meta WhatsApp Cloud API com Coexistência**, pela configuração rápida oficial. Requer conta Meta administradora e números elegíveis. A Meta poderá oferecer QR Code ou confirmação por código dentro do fluxo oficial. **Não existe QR Code universal de pareamento do WhatsApp Web que o Guto Bot possa gerar sozinho pela Cloud API.**

1. Entre como administrador no Chatwoot (Cloud ou self-hosted com Embedded Signup configurado).
2. Acesse Configurações → Caixas de entrada → Adicionar caixa → WhatsApp → Conectar com WhatsApp Business.
3. Na janela Meta, escolha vincular o WhatsApp Business existente. Siga os prompts, incluindo leitura de QR apenas se oferecido pela Meta.
4. Teste receber e responder com o primeiro número, mantendo o aplicativo do telefone.
5. Repita para o segundo; identifique os dois IDs de inbox e o ID de conta.
6. Configure as variáveis **CHATWOOT_BASE_URL**, **CHATWOOT_ACCOUNT_ID**, **CHATWOOT_INBOX_1**, **CHATWOOT_INBOX_2**, **CHATWOOT_API_TOKEN**, **CHATWOOT_WEBHOOK_SECRET** no backend, nunca no HTML.
7. Configure webhook HTTPS `/webhooks/chatwoot`, verifique a assinatura e realize teste de ponta a ponta.

**Atenção:** ao habilitar Coexistência, a Meta pode desvincular dispositivos atuais do WhatsApp Web/desktop; conversas em grupo e algumas funções não são sincronizadas. Não desconecte números existentes sem confirmar elegibilidade.

## Rotas

| Método | Endpoint | Uso |
|---|---|---|
| GET | `/inbox` | Interface WhatsApp Web |
| GET | `/api/channels/status` | Configuração declarada de 2 canais; `UNVERIFIED` não significa online |
| GET | `/api/inbox/conversations` | Conversas recebidas, por canal |
| GET | `/api/inbox/conversations/:key` | Histórico e carrinho |
| POST | `/api/inbox/conversations/:key/messages` | Enfileira resposta humana com `{content,requestId}` |
| POST | `/api/conversations/:key/mode` | Alterna BOT/HUMAN |

Os dados são isolados por `accountId:inboxId:conversationId`. Mensagens recebidas continuam no histórico ao assumir atendimento humano. O servidor usa fila local persistente de uma instância; para escala real, migrar para PostgreSQL e fila durável.

## Segurança e limitações

- Nenhum QR fictício será exibido como válido. As credenciais Meta e Chatwoot permanecem exclusivamente no backend.
- GitHub Pages **não executa** backend, integração real ou IA. Use somente para `central-demo.html`, com contatos fictícios.
- Antes de vender, configurar `OPENAI_API_KEY` no servidor e validar cardápio, entrega, horários e preços vigentes.
- Não há sincronização completa de histórico anterior, grupos, anexos ou status de leitura nesta versão.
- A central está testada com eventos e provedores simulados, sem dois WhatsApps reais conectados.

## Validação

Os testes automatizados abrangem login, assinaturas, isolamento entre canais, transferências humanas, deduplicação e mensagens recebidas após handoff. Também é necessário homologar com linhas reais, **um número por vez**.

Documentação oficial:
- https://www.chatwoot.com/hc/user-guide/articles/1791812048-2-escolha-como-conectar-o-whats_app
- https://app.chatwoot.com/hc/user-guide/articles/1777311823-como-configurar-um-canal-do-whats_app-cadastro-incorporado
