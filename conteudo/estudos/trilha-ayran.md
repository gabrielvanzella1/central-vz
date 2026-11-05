# Trilha: rumo ao Ayran

> O caminho de estudo para, aos poucos, trocar a API do Claude pelo Ayran, a IA própria da VZ, tarefa por tarefa, só quando ele estiver bom de verdade.

## A ideia

Hoje a central usa o **Claude pela API**, porque é o mais eficiente para começar. O **Ayran** (Qwen3 4B no Ollama do i9) vai assumindo **uma tarefa de cada vez**, e só depois de passar num teste. Nunca tudo de uma vez.

Para cada tarefa da central (resumir, classificar, conversar, criar cartões…), a pergunta é sempre a mesma: **o Ayran já faz isso tão bem quanto o Claude, nos nossos exemplos?** Se sim, a tarefa migra. Se não, continua no Claude e a gente estuda o que falta.

## Quando o Ayran está "bom" para uma tarefa

Os critérios de pronto, iguais para todas as etapas:

1. **Acerto:** num conjunto de pelo menos 20 exemplos reais da VZ, o Ayran acerta pelo menos **90% do que o Claude acerta**.
2. **Formato:** quando a tarefa pede um formato (JSON, uma frase, uma coluna do quadro), ele respeita em **todos** os exemplos.
3. **Tempo:** responde em menos de **5 segundos** no i9 (ou no servidor alugado).
4. **Nunca inventa:** quando não sabe, diz que não sabe.
5. **Revisão humana:** o Gabriel olhou 5 respostas lado a lado e aprovou.

## Etapa 1: entender o que roda no i9

**Estudar:** o que são parâmetros, quantização (por que um modelo de 4B cabe em 2,5 GB), VRAM, tokens por segundo, janela de contexto.

**Prática:**
1. No terminal: `ollama run ayran` e faça 5 perguntas do dia a dia da VZ.
2. Faça as mesmas 5 perguntas ao Ayran da central (que hoje usa o Claude) e compare.
3. Anote no chat ao lado onde cada um foi melhor.

## Etapa 2: medir antes de trocar (avaliação)

**Estudar:** o que é um conjunto de avaliação ("eval"): exemplos com a resposta esperada, para medir qualquer modelo do mesmo jeito.

**Prática:**
1. Separe 20 pedidos reais (o histórico da central é a fonte: tudo o que a equipe pediu fica lá).
2. Para cada um, escreva o que seria uma boa resposta.
3. Rode no Claude e no Ayran e conte os acertos. Isso vira um script na central, para repetir a cada modelo novo.

## Etapa 3: a primeira tarefa migrada

As tarefas mais fáceis de migrar primeiro: **resumir** um texto interno, **classificar** um pedido ("é ideia, tarefa ou dúvida?") e **extrair** dados de um texto.

**Prática:** escolha uma, passe pela Etapa 2 e, se cumprir os critérios, a central passa a usar o Ayran para ela. É o **roteamento de modelos**: o simples vai para o Ayran, o difícil continua no Claude.

## Etapa 4: o Ayran conhecendo a VZ (RAG)

**Estudar:** RAG (*retrieval-augmented generation*): antes de responder, o modelo busca trechos relevantes nos documentos da empresa. Embeddings, busca por semelhança, divisão de documentos em pedaços.

**Prática:** dar ao Ayran acesso aos `CLAUDE.md` dos projetos e aos materiais de estudo, e repetir as perguntas da Etapa 1. A melhora costuma ser grande sem treinar nada.

## Etapa 5: o Ayran com ferramentas

**Estudar:** *function calling* em modelos abertos (o Qwen3 suporta), e por que modelos pequenos erram mais a ferramenta (veja o material "Agentes de IA").

**Prática:** dar ao Ayran **uma** ferramenta simples (`listar_tarefas`) e medir. Só depois duas, três…

## Etapa 6: máquina maior

Com 4 GB de VRAM, o teto é um modelo de 3 a 4B. Quando as etapas anteriores mostrarem que falta capacidade:

- **Estudar:** aluguel de GPU por hora; modelos abertos de 14 a 70B; como expor o Ollama (ou o vLLM) como servidor para a equipe toda.
- **Prática:** alugar uma máquina por algumas horas, rodar a avaliação da Etapa 2 com um modelo maior e comparar custo × qualidade com a API do Claude.

## Etapa 7: ajuste fino (fine-tuning)

Só quando RAG e ferramentas já não bastarem.

- **Estudar:** LoRA (treinar só uma "camada extra", barato), como montar exemplos de treino a partir do histórico da central, e como saber se o treino piorou o modelo em outras coisas.
- **Prática:** treinar um Ayran ajustado numa máquina alugada e passar pela avaliação.

## Como acompanhar

Cada etapa é um cartão no quadro (projeto `ayran`). Ao terminar uma, mova o cartão para "feito" e conte ao Ayran da central o que aprendeu: ele guarda na memória, e o histórico mostra a evolução da equipe.
