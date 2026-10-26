# Publicação do Guto Bot Nativo V2 no Render — ambiente de homologação

**Não publicar como sistema pronto.** O serviço deverá iniciar em modo `ready:false`, sem IA automática, sem venda via PDV e sem conexões reais presumidas.

## Plano de infraestrutura preparado

- Repositório público: https://github.com/edsonrd-create/chatboot
- Branch isolada: `feature/guto-bot-nativo-meta-v2`
- Blueprint na raiz: `render.yaml`
- Serviço: `guto-bot-nativo-homologacao`
- Dockerfile: `native/Dockerfile`
- 1 instância; volume persistente em `/app/data`; health check `/health`
- `APP_SECRET` gerado pelo Render; `ADMIN_PASSWORD` definido pelo administrador diretamente no Render
- Para hospedar a aplicação real, plano Starter com disco persistente pode gerar cobrança. Confirmar preço antes de aprovar.
- Auto-deploy desligado para evitar mudanças automáticas na homologação.

## Publicar pelo fluxo de criação do Render

Use o botão de publicação apontando para a branch V2 (não a branch `main`):

https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Fedsonrd-create%2Fchatboot%2Ftree%2Ffeature%2Fguto-bot-nativo-meta-v2

Revise o recurso criado e o custo. Informe no formulário `ADMIN_PASSWORD` exclusiva e segura (12+ caracteres), sem enviar senha por chat ou commit.

**A conexão do Render ao ChatGPT é diferente da conexão do Render ao GitHub.** O fluxo de Blueprint pode pedir autorização do GitHub para ler o repositório.

## Comportamento esperado

- `GET /health` retorna HTTP 200 e `{"ok":true,"service":"guto-bot-nativo","ready":false}` (serviço vivo, NÃO pronto para clientes).
- `GET /painel` retorna HTML de login da central de atendimento.
- `GET /api/status` sem login retorna HTTP 401.
- `GET /webhooks/meta` sem aplicação Meta configurada retorna HTTP 503.
- `POST /webhooks/meta` sem aplicação Meta configurada retorna HTTP 503.
- Atendimento automático permanece bloqueado; PDV somente leitura; sem confirmação de vendas.

## Habilitar funções somente após testes reais

1. Configurar o próprio aplicativo Meta dentro da central da Guto Express e registrar webhook oficial; verificar segurança de assinatura, recebimento e envio para **cada** número.
2. Configurar `OPENAI_API_KEY` como segredo do Render e testar a IA real; não inserir a chave no HTML.
3. Liberar leitura do PDV no painel após teste HTTP com o domínio autorizado. Criação de pedidos só após existir uma rota PDV de escrita **autenticada, idempotente e homologada**, separada da API pública de catálogo.
4. Verificar uso real do layout, entregas, estado de mensagens, fila, recuperação de falha, backup/restauração e controle de acesso.
5. Nunca chamar de produção com o armazenamento JSON atual: migrar para PostgreSQL e fila durável.

## Diagnóstico

Em caso de falha, verificar Logs e Deploys do serviço Render. O GitHub Actions valida lógica e segurança, mas não confirma disponibilidade do servidor público nem acesso à Meta.

Referências:
- https://render.com/docs/deploy-to-render
- https://render.com/docs/environment-variables
- https://render.com/docs/blueprint-spec
