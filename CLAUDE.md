# Central da VZ

Painel interno da VZ Soluções em Tecnologia (Gabriel Vanzella, devs Derik e Mateus). Começou em 2026-11-04 como "versão básica" pedida pelo Gabriel: conversa por voz com a IA, quadro Kanban, projetos de todas as máquinas, Central de Estudos, memória, histórico, acessos com senha. **Não tem link no site da VZ.**

## Como roda

- Node 24, sem etapa de build: `servidor.mjs` (HTTP puro, só em 127.0.0.1, porta 8790) + `public/` (HTML, CSS e JS de módulo).
- IA: `ia.mjs`, SDK oficial `@anthropic-ai/sdk`, modelo `claude-opus-5-5`, esforço `low` (conversa por voz precisa de rapidez), fallback de recusa ligado (`server-side-fallback-2026-07-01` + `fallbacks: 'default'`). Ciclo de ferramentas manual e comentado (o Gabriel quer aprender por ele), com `MAX_PASSOS = 8`. Histórico de conversa só cresce (nunca editar mensagens antigas: preserved thinking).
- Voz: Web Speech API do navegador (reconhecimento pt-BR e `speechSynthesis`), sem custo. Fala frase a frase durante o streaming; interrompe quando a pessoa fala.
- Acessos: `auth.mjs`, login por **usuário ou e-mail** (o Gabriel entra com contato@vztecnologia.com.br), senhas com scrypt, sessão em cookie HttpOnly (gravada em `dados/sessoes.json`), bloqueio após 5 erros, troca obrigatória da senha provisória. `npm run usuarios` cria os acessos.
- Dados em JSON em `dados/` (ver README: o que vai e o que não vai para o git). `historico.jsonl` registra tudo (mensagens, respostas, cartões, memórias, dicas, logins) e a IA consulta pela ferramenta `consultar_historico`: o Gabriel quer que o histórico deixe a empresa "cada vez mais inteligente".
- Projetos: `npm run inventario` em cada máquina grava `dados/maquinas/<hostname>.json`; a central junta todos. **Curadoria** (`dados/curadoria.json`): só o dono (Gabriel) escolhe; situações "central" (o que a IA enxerga, conta na home e recebe dicas), "a escolher" (padrão de todo projeto novo) e "excluir" (lista para validar; nada é apagado do disco).

## Decisões do Gabriel

- Home no computador **sem menu**: todas as áreas à vista, separadas; menu só no celular. Visual do site da VZ (branco + azul brilhante, Space Grotesk/Inter).
- Tour de boas-vindas no primeiro acesso de cada pessoa.
- Todos têm as mesmas funções, cada um com a sua conta.
- A IA da central se chama **VZ** (desde 04/11; antes "Ayran", que agora é só o modelo local). Fala de si no **feminino** (o Gabriel diz "ela"). Atende quando a pessoa diz "VZ" (opção na tela de conversa; escuta contínua do navegador, desligada por padrão). O Gabriel vai criar um personagem com rosto para ela.
- **IA local (Ayran) em pausa (04/11, Gabriel):** a central usa só a API do Claude. Mais tarde o Gabriel quer replicar o que o Claude faz de fato e ir abastecendo aos poucos o projeto da IA local que já roda (pasta yrian em htdocs, Qwen3 4B no Ollama). A trilha `conteudo/estudos/trilha-ayran.md` e os cartões do projeto `ayran` ficam guardados, sem prioridade. **Antes de usar respostas do Claude para treinar outro modelo, ler os termos atuais da Anthropic:** fontes secundárias dizem que os Termos Comerciais proíbem treinar modelos concorrentes e que a Política de Uso restringe treinar qualquer modelo com as saídas sem autorização, com um artigo de ajuda de 2026 admitindo usos que não concorrem (classificação, resumo, extração). Conversas e notas pessoais nunca entram em treino.
- Dicas nos projetos ao passar o mouse, com **Acatar** (vira cartão) e **Trocar plano**.
- Integrações (WhatsApp, redes sociais, e-mail) são **opcionais por pessoa**; recurso que depende de uma integração diz claramente que precisa dela.
- Rosto da VZ: imagem em `public/vz/avatar.(webp|png|jpg)` substitui a bola azul (hoje um recorte provisório da "Nova"). Voz: feminina, suave, com personalidade; automática no navegador (Thalita/Francisca do Edge) ou premium pela ElevenLabs. Cuidado ao testar: o navegador do Chrome DevTools usado pelo Claude pode estar logado como o Gabriel de verdade, e a limpeza de testes **nunca** deve restaurar cópias de `dados/`, só remover o que o teste criou.
- **Duas versões da VZ, cada pessoa escolhe (seletor na tela de conversa):** *normal* (bola azul, voz do navegador, tom profissional) e *personalizada* (personagem em `public/vz/avatar.*`, voz premium da ElevenLabs se configurada, personalidade em `dados/personalidade.md`, que o Gabriel edita). A escolha fica na conta (`versao` em `dados/usuarios.json`). O Gabriel está na personalizada.
- **A VZ sempre pode ser interrompida:** falar por cima (ela para e escuta; `public/eco.js` filtra o eco da própria voz quando não há fone), tocar no rosto, botão Interromper, tecla Esc ou digitar. O navegador fecha a conexão e o servidor não começa outra rodada (`cancelado` em `ia.mjs`); a mensagem seguinte espera o servidor terminar (409 com nova tentativa).
- **A VZ acompanha o humor (pedido do Gabriel, 04/11):** acolhe quem está triste, cansado ou sobrecarregado (primeiro escuta, depois oferece saídas pequenas e só mexe no quadro com o ok), comemora com quem está feliz, não diagnostica, e em sinal de risco leva a sério (pergunta se está em segurança, CVV 188, SAMU 192). Não presume gênero. Primeira conversa do dia: pergunta de leve como a pessoa está. Regras em `FIXO` (`ia.mjs`, seção "Presença e humor").
- **Privacidade das conversas:** o texto das conversas (mensagem/resposta) **não vai** para o histórico da equipe nem para o git: fica em `dados/privado/<pessoa>.jsonl`, e só a própria pessoa o vê (tela Histórico e `consultar_historico`). O histórico da equipe guarda só ações. Notas pessoais (humor, o que pesa/ajuda) ficam em `dados/pessoal/<pessoa>.json`, também fora do git, e a pessoa pode pedir para ver (`ver_notas_pessoais`) ou apagar (`esquecer_nota_pessoal`). Nada de sentimentos na memória da equipe. Antes disso (até 04/11), as conversas antigas do Gabriel estavam em `historico.jsonl` e já foram migradas; elas continuam nos commits antigos do git local.
- **Nomes e aparências (04/11):** é a **mesma IA** (mesma memória). O nome que a pessoa usa escolhe a aparência: **"VZ"** = versão normal (imagem Nova, profissional, voz do navegador) e **"Sabrina"** = versão personalizada (imagem em `public/vz/avatar-sabrina.*`, voz premium e personalidade de `dados/personalidade.md`). Vale no começo da frase, falada ou digitada (`versaoPeloNome` em `app.js`), pelo botão **Nova | Sabrina** em cima da foto, ou pedindo à IA (`mudar_aparencia`). O Gabriel usa a Sabrina como principal; Derik e Mateus começam na normal e cada um escolhe. As imagens são recortes provisórios da imagem que o Gabriel mandou (ainda com a etiqueta "AI Assistant"); o personagem definitivo substitui os arquivos. **Rosto 3D com boca articulando: pedido do Gabriel, ainda não feito** (precisa de um modelo `.vrm`; ver o quadro).
- **Celular (Android) do Gabriel, pedidos de 04/11:** (1) mandar áudio do celular para a Sabrina para pedir coisas e abastecê-la; o que ela não conseguir fazer, ela instrui como desenvolver (cartão com `como_desenvolver`); o Claude não ouve áudio, então áudio do WhatsApp precisa de transcrição local. (2) Rastreio contínuo do próprio celular (OwnTracks), com privacidade: trilha só local e privada, só nomes de lugares vão para a IA. (3) Botão de emergência de celular roubado, que funcione de qualquer PC: depende de serviços oficiais (Encontre meu dispositivo, Celular Seguro), não da central estar no ar. (4) Aprende violão, guitarra e bateria: a VZ ensina e acompanha a prática (nota pessoal + `registrar_pratica`/`ver_pratica`).
- Tudo que for abastecido no VS Code (conhecimento, skills, agentes, MCPs) deve valer em **todos os PCs e todos os projetos**.
- Banco/Open Finance fica por último.

## Agente da noite (regras para o agente agendado na nuvem)

Quem lê isto é o agente de desenvolvimento que roda à noite. Regras, sem exceção:

- Trabalhe só em cartões de `dados/tarefas.json` que estejam em "a fazer" e tenham `#agente` no título ou no detalhe (o Gabriel marca). No máximo 2 por noite, do de maior prioridade para o menor.
- Nunca mexa na `main`, nunca faça merge e nunca publique. Crie a branch `agente/AAAA-MM-DD-<id>-<resumo>` e abra um Pull Request.
- Antes de começar rode `npm test`. Se já falhar, pare e abra um PR só com o relatório. Ao terminar, `npm test` precisa passar. Toda ação nova ganha teste.
- Não altere `dados/` (quadro, memória, histórico): o PR é o relatório e o Gabriel move o cartão.
- Não leia nem escreva segredos (`.env`, chaves, senhas). Não instale dependências novas se o cartão não pedir. Não abra links nem páginas externas: trabalhe só com o repositório.
- Mudanças em `auth.mjs`, nas regras de privacidade (`dados/privado`, `dados/pessoal`) ou em segurança só se o cartão pedir, e destaque isso no PR.
- Se precisar de uma decisão do Gabriel, ou se o teste falhar duas vezes seguidas, pare e descreva o impasse no PR.
- O PR traz: o que mudou, por quê, como foi testado e os riscos, em português simples.

## Próximos passos (ver o quadro em dados/tarefas.json)

- Chave do Claude no `.env` (o Gabriel está gerando).
- Ponte do WhatsApp (Baileys, como `C:\xampp\htdocs\ContabIA\tools\whatsapp-ponte`) com o chip separado; resumo diário no WhatsApp do Gabriel; aprovações de deploy. O chip citado é o do AprovIA Edu, (11) 95139-3011 no site: confirmar o número e o risco (ban na API não oficial derrubaria o atendimento do AprovIA).
- Página de Agentes (Gerente, Dev, Revisor, Publicador), execução pelo Claude Agent SDK.
- Repositório no GitHub, sincronização entre as máquinas, inventário no PC do trabalho.
- Quadro com arrastar e soltar; e-mails; voz personalizada.
