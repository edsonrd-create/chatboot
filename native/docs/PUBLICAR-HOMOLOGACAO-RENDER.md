# Guto Bot — publicar homologação gratuita

**Não é produção.** O Render Free hiberna e perde dados locais ao reiniciar, redeployar ou ficar inativo. O modo `FREE_PREVIEW_MODE=true` bloqueia mensagens reais, webhooks, configuração de números, teste do PDV e chamadas de IA paga.

## Implantar

1. Selecione explicitamente em qual dos workspaces Render instalar: **edson's workspace** ou **Web Serviced**.
2. Use o Blueprint `render.yaml` do branch `feature/guto-bot-nativo-meta-v2` ou crie Web Service: plano `free`, runtime `docker`, contexto `./native`, Dockerfile `./native/Dockerfile`.
3. Configure `ADMIN_PASSWORD` (pelo menos 12 caracteres) apenas em segredo de ambiente no Render; `APP_SECRET` é gerado pelo provedor. Nunca mande chaves no chat.
4. Após o deploy, valide `/health` (`ok:true`, `ready:false`, `freePreview:true`). Abra `/painel` com a senha administrativa para testar navegação e configurações.

### Limitação importante

Não cadastre números reais ou pedidos de clientes neste ambiente; os testes não garantem persistência. O plano gratuito é somente laboratório de interface e autenticação. O Render pode limitar recursos gratuitos e suspender serviço ocioso. Para operação real com WhatsApp e PDV precisa banco persistente, filas e validações. Veja https://render.com/docs/free.
