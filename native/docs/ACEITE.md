# Matriz de validação profissional

**Status: NÃO LIBERADO.**

| Etapa | Teste | Situação |
|---|---|---|
| Segurança de webhook | Assinatura HMAC correta, inválida e payload duplicado | Teste automatizado |
| Separação dos canais | Mesma origem de cliente nos dois números não mescla conversas | Teste automatizado |
| Atendimento humano | Inbox com autenticação, alteração de modo e fila de envio | Teste automatizado com Graph simulado |
| API Meta | Teste da WABA e número no Graph | Contrato testado com mock; falta credencial real |
| Cadastro incorporado | Autenticação oficial popup Meta | Código implementado; sem validação real |
| Inteligência artificial | Motor de funções e laboratório | Testado com mocks; precisa benchmark com API real |
| Cardápio do PDV | Endpoint /api/v1/menu e /api/v1/store | Esquema validado via código; conexão real pendente |
| Registro no PDV | Criação com idempotência, disponibilidade, preço fechado | NÃO IMPLEMENTADO |
| Visual | Desktop e mobile, uso real dos botões e sessão | HTML/JS sintaxe testada; navegador bloqueado no ambiente atual |
| Operação | Volume, falha de rede, retenção LGPD, backup/restauração | NÃO HOMOLOGADO |

Nada acima pode ser marcado como "pronto" sem evidência de ponta a ponta. A coleta de provas deve incluir timestamps, inputs anonimizados, logs, commit SHA e aprovação do responsável.
