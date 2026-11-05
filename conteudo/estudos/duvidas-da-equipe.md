# Dúvidas da equipe

> Perguntas que já apareceram na VZ, respondidas. Tem uma dúvida nova? Pergunte no chat ao lado: a resposta boa vira item aqui.

## Como uso agentes tendo uma chave da API do Claude?

A chave da API é o "crachá" que deixa um programa seu conversar com o Claude e pagar por uso (por token, sem mensalidade). Com ela, há quatro jeitos de montar agentes, do mais simples ao mais completo:

### 1. Ciclo próprio com ferramentas (o que a central usa)

Você escreve o programa, define as ferramentas e controla o ciclo **decidir → executar → verificar**. É o `ia.mjs` da central.

- **Bom para:** agentes que trabalham com os *seus* dados e sistemas (quadro, projetos, WhatsApp, banco da empresa).
- **Você controla tudo:** quais ferramentas existem, limite de passos e onde pedir aprovação.

### 2. Claude Agent SDK (o Claude Code como biblioteca)

É o mesmo motor do Claude Code que você usa no VS Code, só que chamado de dentro de um programa. Ele já vem com as ferramentas de programador: ler e editar arquivos, rodar comandos, buscar no código, subagentes.

- **Bom para:** o **Agente Dev**, que pega um cartão do quadro, abre o projeto, programa, roda os testes e devolve o resultado.
- **Roda na máquina onde está o projeto** (a sua, a do Derik, a do Mateus), usando a chave da API.

### 3. Managed Agents (a Anthropic hospeda)

A Anthropic roda o agente e uma máquina isolada para ele trabalhar. Também dá para **agendar** ("todo dia às 8h").

- **Bom para:** tarefas que não precisam dos seus arquivos locais, como pesquisar, montar relatórios ou o resumo diário.

### 4. Claude Code no VS Code (o que você já faz)

Funciona com a sua assinatura ou com a chave. É o agente "com você do lado": ótimo para trabalhar junto, não para rodar sozinho de madrugada.

### Quanto custa

Cobra-se por milhão de tokens (um token é mais ou menos 3/4 de uma palavra). Preços de referência por milhão (outubro/2026):

| Modelo | Entrada | Saída | Uso na VZ |
|---|---|---|---|
| Claude Opus 5.5 | US$ 4 | US$ 20 | Conversa, agentes que programam, decisões |
| Claude Sonnet 5.5 | US$ 2 | US$ 10 | Trabalho do dia a dia em volume |
| Claude Haiku 5.5 | US$ 0,10 | US$ 0,50 | Tarefas simples e repetitivas |

Uma troca de mensagens curta na central custa alguns centavos de dólar. O que encarece é agente solto em loop: por isso existem o limite de passos, o **limite de gasto mensal** (configure no console da Anthropic) e o cache das instruções fixas, que deixa as mensagens seguintes até 90% mais baratas.

### Regras de ouro

1. A chave fica no `.env`, **nunca** no código, no git ou no chat.
2. Todo agente tem limite de passos e um objetivo claro.
3. Ação que outras pessoas veem (publicar, mandar mensagem a cliente, apagar, gastar) **pede aprovação**.
4. Comece com um agente pequeno que funciona; só depois junte vários.

## Qual a diferença entre a API do Claude e o modelo que roda no i9?

Hoje o **Ayran** roda no seu PC pelo **Ollama**: é o modelo **Qwen3 4B** (4 bilhões de parâmetros, 2,5 GB) com a personalidade do Ayran por cima (`yrian/modelfiles/ayran.Modelfile`). A placa de vídeo tem 4 GB de memória, e um modelo de 4B quantizado cabe nela.

| | Claude pela API | Ayran local (Qwen3 4B no i9) |
|---|---|---|
| **Qualidade** | Modelo de ponta: raciocina, programa e usa ferramentas muito bem | Bom para tarefas simples; erra mais em raciocínio longo e em escolher ferramentas |
| **Custo** | Paga por uso | Grátis por mensagem (você paga o PC e a energia) |
| **Privacidade** | Os dados vão à Anthropic (não são usados para treinar modelos, pelas regras da API) | Nada sai do seu computador |
| **Disponibilidade** | Sempre no ar, de qualquer lugar | Só com o PC ligado; para outros usarem, ele precisa virar servidor |
| **Velocidade** | Rápido e estável | Depende do hardware; modelo maior que a VRAM fica lento |
| **Contexto** | Até 1 milhão de tokens (um projeto inteiro) | Bem menor; documentos grandes precisam ser picados |
| **Agentes** | Confiável para ciclos longos com ferramentas | Para agente simples, com poucas ferramentas e passos curtos |

### Quando usar cada um

- **Ayran local:** classificar e resumir textos internos, buscar em documentos da empresa, rascunhos, tarefas com dados que não podem sair da VZ, e para **validar** a ideia da IA própria sem gastar.
- **Claude pela API:** conversar por voz na central, agentes que programam ou publicam, decisões e qualquer coisa em que errar custa caro.
- **Os dois juntos (o caminho mais comum):** o local faz a triagem e o simples; quando a tarefa é difícil, a central chama o Claude. Isso se chama **roteamento de modelos**.

### Com 4 GB de VRAM, até onde dá para ir?

- Modelos de **3 a 4B** parâmetros, quantizados, rodam bem (como o Qwen3 4B atual).
- Modelos de **7 a 8B** até rodam, mas parte vai para a memória comum e fica bem mais lento (o `dolphin-llama3`, de 4,7 GB, já passa da placa).
- Acima disso, só alugando máquina: GPUs de 24 a 80 GB rodam modelos abertos de 30 a 70B ou mais.

### "Criar a nossa própria IA" na prática

Quase ninguém treina um modelo do zero (custa milhões). O caminho realista para a VZ, em etapas:

1. **Personalidade e regras** (o Modelfile do Ayran: já feito).
2. **RAG:** o modelo consulta os documentos da empresa antes de responder. Melhora muito sem treinar nada.
3. **Ferramentas:** o Ayran passa a agir (como os agentes da central).
4. **Ajuste fino (fine-tuning):** treinar um modelo aberto com exemplos da VZ, numa máquina alugada por algumas horas. Faz sentido quando os passos 2 e 3 já não bastam.

## Ainda tem dúvida?

Pergunte no chat ao lado, por texto ou voz.
