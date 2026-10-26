# Guto Bot — diagnóstico de GitHub Pages 404

**Diagnóstico em 26/10/2026.** O site `https://edsonrd-create.github.io/chatboot/` retorna 404 porque o GitHub Pages **não está habilitado** para o repositório. Isso foi confirmado no GitHub Actions, execução [40341439146](https://github.com/edsonrd-create/chatboot/actions/runs/40341439146), etapa `actions/configure-pages@v5`: `Get Pages site failed ... Not Found`. A preparação do `index.html` foi concluída antes da falha.

## Solução sem editar código (GitHub Pages)

1. Abra **https://github.com/edsonrd-create/chatboot/settings/pages** com a conta administradora do repositório.
2. Em **Build and deployment → Source**, selecione **GitHub Actions**. Existe um workflow pronto em `.github/workflows/deploy-pages.yml`.
3. Acesse **https://github.com/edsonrd-create/chatboot/actions/workflows/deploy-pages.yml** e execute **Run workflow** na branch `main`.
4. Confirme **Conclusion: success** no workflow. Só depois abra **https://edsonrd-create.github.io/chatboot/** sem parâmetros adicionais.

**Motivo da etapa manual:** `actions/configure-pages` com `enablement: true` exige token administrativo que não é o `GITHUB_TOKEN` padrão. As ferramentas GitHub conectadas para este projeto não possuem ação para alterar configurações GitHub Pages.

Referência: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

## Alternativa rápida para testar agora (Netlify Drop)

Se quiser uma URL temporária sem esperar a ativação do GitHub Pages, acesse **https://app.netlify.com/drop** e arraste uma pasta contendo **somente o `index.html` demonstrativo** (ou envie o ZIP de publicação). O Netlify gera uma URL `netlify.app` após o upload. Não envie backend, arquivos `.env`, chaves ou mensagens reais de clientes. A publicação ainda exige essa ação manual de upload.

Referência: https://www.netlify.com/knowledge-base/deploy-your-claude-artifacts-to-netlify/

## O que deve funcionar depois

A publicação estática contém apenas o painel de demonstração, catálogo informativo e simulador baseado em regras. O backend Node.js, modelo de IA, Chatwoot e dois números WhatsApp reais **não são executados pelo GitHub Pages**, portanto não devem ser anunciados como online.

Se o site continuar 404 após uma execução Pages bem-sucedida, conferir o endereço, o arquivo `index.html` no artefato e o resultado da execução na aba Actions.
