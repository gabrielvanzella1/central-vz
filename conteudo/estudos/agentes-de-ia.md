# Agentes de IA: do chatbot à fábrica de software

> Por que um agente solto entra em loop e queima dinheiro, e a engenharia que resolve: ferramentas bem definidas, orquestração e humano no circuito.

*Base: vídeo da UNIPDS sobre a pós em Engenharia de Software com IA Aplicada (out/2026), aprofundado com a prática da VZ.*

## 1. Chatbot não é agente

Um **chatbot** responde: você pergunta, ele devolve texto, fim.

Um **agente** trabalha num ciclo:

1. **Decide** o que fazer a seguir;
2. **Executa** uma ação (ler um arquivo, consultar um sistema, publicar um site);
3. **Verifica** o resultado;
4. Volta ao passo 1 até terminar ou precisar de alguém.

Na prática, o modelo de IA não "faz" nada sozinho: ele **pede** para usar uma ferramenta, o nosso programa executa e devolve o resultado. Isso se chama **function calling** (ou *tool use*).

## 2. Por que agente solto dá errado

O vídeo cita três sintomas, e todo mundo que começa passa por eles:

- **Repete a mesma ação** porque não percebe que já tentou, ou porque o resultado não diz claramente que deu certo.
- **Chama a ferramenta errada** porque o nome ou a descrição da ferramenta são vagos.
- **Consome o orçamento a noite inteira** porque ninguém colocou limite de passos nem de gasto.

## 3. O que resolve: engenharia

### Function calling bem definido

Cada ferramenta precisa de:

- **nome** que diga exatamente o que faz (`mover_tarefa`, não `atualizar`);
- **descrição** que diga *quando* usar e quando não usar;
- **parâmetros** com tipos e valores permitidos (por exemplo, a coluna só pode ser "ideias", "a fazer", "fazendo" ou "feito");
- **resultado claro**, inclusive no erro ("cartão #12 não existe"), para o agente não insistir.

E o programa **confere os parâmetros antes de agir**: a IA pode errar o formato.

### Limites

- **Máximo de passos** por pedido (na central são 8). Passou disso, o agente para e pergunta.
- **Limite de gasto** no painel da Anthropic.
- **Esforço** adequado: conversa rápida usa pouco raciocínio; tarefa difícil, mais.

### Orquestração: vários agentes

Em vez de um agente que faz tudo, divida responsabilidades:

- **Supervisor:** um agente "gerente" recebe o pedido, quebra em partes e entrega cada parte a um **especialista** (um que programa, um que revisa, um que publica). Depois junta os resultados.
- **Hierárquico:** gerentes de gerentes, para trabalhos grandes (um supervisor por projeto, abaixo de um supervisor geral).

O vídeo cita o **LangGraph**, uma biblioteca para desenhar esses fluxos como um grafo. No dia a dia da VZ, o **Claude Code** já faz isso: o agente principal dispara **subagentes** especialistas.

### Humano no circuito (human in the loop)

Você decide **onde** uma pessoa precisa aprovar antes de o agente seguir. Regra prática:

- **Ler, pesquisar, rascunhar:** o agente faz sozinho.
- **Mudar algo que outras pessoas veem** (publicar site, mandar mensagem a cliente, apagar dados, gastar dinheiro): **pede aprovação**.

Na central, a aprovação vai chegar pelo WhatsApp: "Posso publicar o site da VZ? Responda SIM".

## 4. Como isso aparece no Claude Code

| Conceito | No Claude Code |
|---|---|
| Ferramentas | Bash, Edit, Read… e os **MCPs** (pacotes de ferramentas: GitHub, Hostinger, navegador) |
| Especialistas | **Subagentes** (`.claude/agents/`) e **skills** (receitas reutilizáveis, como o `/radar`) |
| Humano no circuito | **Permissões** (ele pergunta antes de ações arriscadas) e **hooks** (regras automáticas) |
| Limites | Modelo e esforço por tarefa, tarefas pequenas e bem descritas |

## 5. Na fábrica de software da VZ

Um desenho possível, por etapas:

1. **Gerente (supervisor):** lê o quadro, transforma ideias em tarefas e distribui.
2. **Dev por projeto:** conhece o `CLAUDE.md` daquele projeto e executa as tarefas.
3. **Revisor:** confere o código antes de subir.
4. **Publicador:** faz o deploy, sempre com a sua aprovação.

## 6. Exercícios

1. Abra `ia.mjs` na central e encontre o ciclo `for (let passo...)`. Onde está o "decidir", o "executar" e o "verificar"?
2. Escreva a descrição de uma ferramenta nova, `publicar_site`. Que parâmetros ela teria? Ela deveria pedir aprovação?
3. Pense num trabalho repetitivo da VZ. Que especialistas um supervisor chamaria para fazê-lo?

Dúvidas? Pergunte no chat ao lado.
