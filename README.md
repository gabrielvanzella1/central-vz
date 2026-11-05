# Central da VZ

Painel interno da VZ Soluções em Tecnologia: conversa por voz com a IA, quadro de tarefas, projetos de todas as máquinas, Central de Estudos, memória e histórico. Não tem link no site da empresa.

## Primeira vez numa máquina

Precisa do **Node 20 ou mais novo** (`node --version`).

```bash
git clone <endereço do repositório> central-vz
cd central-vz
npm install
cp .env.example .env        # depois abra o .env e cole a chave do Claude
npm run usuarios            # só na primeira máquina: cria os acessos e mostra as senhas provisórias
npm run inventario          # lista os projetos deste computador
npm start                   # abre em http://localhost:8790
```

Abra no **Chrome ou no Edge**: são eles que reconhecem a voz.

## Como usar (guia rápido)

1. **Entrar:** use o seu usuário (`gabriel`, `derik` ou `mateus`) e a senha provisória. No primeiro acesso o sistema pede uma senha nova (mínimo 8 caracteres).
2. **Tour:** na primeira vez aparece um passo a passo. Para rever, clique no seu nome lá em cima e em **Rever o tour**.
3. **Conversar:** na home, toque na bola azul e fale normalmente. A IA responde falando e volta a ouvir sozinha.
   - Para **interromper**, é só começar a falar. Use fone de ouvido, senão o microfone escuta a própria IA.
   - Para **desligar**, toque na bola de novo.
   - A **voz** e a **velocidade** se ajustam no painel à esquerda da conversa.
4. **Pedidos que funcionam bem:**
   - "Anota uma ideia: …" → vira um cartão em *ideias*.
   - "Cria uma tarefa no projeto vztech para …" → cartão em *a fazer*.
   - "Move o cartão 5 para fazendo."
   - "Quais projetos estão sem git?" / "O que tem pendente no ContabIA?"
   - "Guarda que o Derik cuida do app ScanTE." → vai para a memória.
   - "O que a gente fez ontem?" → ela consulta o histórico.
5. **Projetos:** passe o mouse sobre um projeto (ou toque em **Próximo passo**) para ver a sugestão da IA. **Acatar** cria o cartão no quadro; **Trocar plano** pede outro caminho.
6. **Estudos:** abra um material e tire dúvidas no chat ao lado, por texto ou voz. **Compartilhar** copia o texto do material.
7. **Trocar a senha ou sair:** clique no seu nome lá em cima.

## O que vai para o git e o que não vai

| Vai (é da equipe) | Não vai (é desta máquina ou é segredo) |
|---|---|
| Quadro (`dados/tarefas.json`) | A chave do Claude (`.env`) |
| Memória (`dados/memoria.json`) | Senhas (`dados/usuarios.json`, só o hash) |
| Histórico (`dados/historico.jsonl`) | Sessões abertas (`dados/sessoes.json`) |
| Projetos de cada máquina (`dados/maquinas/`) | Conversas pessoais (`dados/conversas/`) |
| Dicas dos projetos (`dados/dicas.json`) | |

## Como funciona por dentro

Leia o material **"Como a Central da VZ funciona por dentro"** na Central de Estudos. Ele mostra o caminho de uma frase sua até a IA e de volta, e tem um exercício para você criar a sua primeira ferramenta.
