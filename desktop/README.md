# Guto Express — WhatsApp Web verdadeiro dentro da automação (desktop)

**Estado: PROTÓTIPO PARA HOMOLOGAÇÃO NO WINDOWS. NÃO PRONTO PARA PRODUÇÃO.**

A solicitação foi refinada: o usuário não quer uma reprodução do WhatsApp Web no navegador, mas **o próprio site https://web.whatsapp.com dentro da mesma janela do aplicativo de automação**, como na captura do usuário.

## Arquitetura adotada

- Aplicativo Electron Windows com interface administrativa local.
- `WebContentsView` exibe o **WhatsApp Web oficial como uma página top-level real**, não um `iframe`, um screenshot, uma imitação da interface ou uma implementação com Chatwoot. Esta escolha segue a documentação atual do Electron, que recomenda WebContentsView para compor web conteúdos separados.
- Dois perfis persistentes isolados: `persist:guto-express-whatsapp-01` e `persist:guto-express-whatsapp-02`. A autenticação/QR é apresentada pelo **próprio WhatsApp Web**, conforme aceitação e suporte da plataforma.
- Barra superior seleciona WhatsApp 01 ou 02, com sessão e cookies independentes. **Não equivale a integração oficial dos dois números Meta Cloud API.**
- Painel lateral com rascunho manual de pizza, cliente e observações por canal, visível **durante a conversa**. Rascunho é copiado com um clique para revisão; não envia nem cria pedido no PDV.
- Bloqueios de segurança: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, restrição de navegação a `https://web.whatsapp.com`, permissão de mídia e janelas externas negada, IPC apenas da interface local. Não intercepta nem faz scraping de DOM, QR, mensagens ou credenciais do WhatsApp.

## Executar no Windows

Instale [Node.js](https://nodejs.org/) atualizado e, em um terminal PowerShell no diretório `desktop`:

```powershell
npm install
npm test
npm start
```

Será aberta uma janela Windows com o WhatsApp Web verdadeiro na área central. Clique em **WhatsApp 01**, depois **WhatsApp 02**. Faça o login pelo procedimento apresentado pelo próprio WhatsApp, **somente se o programa for autorizado e compatível**. O status “Página carregada” não garante login nem conexão real. As sessões são preservadas no perfil local do aplicativo do Windows.

O software **não é instalador `.exe`**; é o código-fonte para homologação. Para gerar um instalador assinado, será preciso homologar a execução Windows primeiro.

## O que foi testado e o que está pendente

`npm test` executa testes de lógica, isolamento de perfis, URL, limites de layout e limites de IPC. Os testes **não verificam que o servidor do WhatsApp aceite login no Electron**, porque isso só pode ser validado em um dispositivo Windows conectado e com autorização dos números reais. Não declare dois números conectados antes de testar.

**Ainda pendente:** verificar a abertura real da página, QR/link em cada número, sobrevivência das duas sessões após reiniciar o PC, compatibilidade com atualizações do WhatsApp Web, anexos, áudio, janela de envio e treinamento Gemini em conjunto; integração PDV com idempotência e preço validado.

### Não confundir interface com automação

Exibir o WhatsApp Web dentro do aplicativo desktop **não autoriza nem implementa o controle automático do site**, leitura de mensagens, respostas por IA ou envio de pedidos ao PDV. A integração automática deve seguir a API oficial da Meta, com permissão e testes. A automação de navegação WhatsApp Web não oficial pode falhar ou sofrer restrições; não será anunciada como pronta.

## Regras de liberação

1. O WhatsApp Web real deve abrir visualmente em uma janela Windows e autenticar separadamente os dois números (se permitido).
2. Os dois perfis não podem compartilhar cookies ou mensagens; alternar abas não pode desconectar uma sessão.
3. Rascunhos mantidos em memória, por canal, sem misturar conversas.
4. Testes de interface/segurança e compatibilidade aprovados em Windows real.
5. **Somente depois** conectar o fluxo de automação oficial e o PDV, com consentimento e testes de ponta a ponta.

Referências:
- https://www.electronjs.org/docs/latest/tutorial/web-embeds
- https://www.electronjs.org/docs/latest/api/web-contents-view
- https://www.electronjs.org/docs/latest/tutorial/security
