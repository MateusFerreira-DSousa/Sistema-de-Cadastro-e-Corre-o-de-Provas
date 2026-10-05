# Sistema de Cadastro e Correção de Provas

Sistema web para aplicar provas de múltipla escolha (A–E) no computador, com correção automática. Ele foi feito para rodar na **rede local da escola**: um PC funciona como servidor e os alunos acessam pelo navegador. Não precisa de internet nem de nuvem.

Esta versão é o **MVP**. O front-end é HTML/CSS/JS estático e o backend é um único arquivo Node.js, sem dependências externas.

## Papéis

| Papel | O que faz |
|-------|-----------|
| `superadmin` | Cadastra e exclui professores e alunos. Também acessa o painel do professor e vê as provas de todos. É criado automaticamente na primeira execução. |
| `professor` | Cria, edita e exclui as **próprias** provas, com gabarito, e vê os resultados da turma. |
| `aluno` | Faz as provas da **sua turma**, no dia e no horário marcados, uma vez só. Não vê a nota. |

## Como rodar

Precisa de **Node.js 24 ou mais novo** (usa o módulo nativo `node:sqlite`). Não tem `npm install`, porque o projeto não tem dependências.

```bash
npm start      # produção / escola
npm run dev    # desenvolvimento: reinicia sozinho quando o server.js muda
```

Abra `http://localhost:3000`. Na rede da escola, os alunos acessam `http://IP-DO-SERVIDOR:3000`.

> Com `npm start`, o servidor **não** recarrega mudanças no `server.js`. Se aparecer "Rota não encontrada." depois de mexer no código, reinicie (`Ctrl+C` e rode de novo). Mudanças em `public/` aparecem só recarregando a página.

### Primeiro acesso

1. Na primeira execução, o terminal mostra o login (`admin`) e a senha do superadmin. **A senha aparece uma única vez.** Anote. Para escolher a senha, defina `ADMIN_SENHA` antes de iniciar pela primeira vez.
2. Entre como superadmin, cadastre os professores e os alunos (cada aluno com a sua turma).
3. O professor entra, cria a prova para uma turma, com data e horário, e os alunos dessa turma a veem na data marcada.

### Variáveis de ambiente (todas opcionais)

| Variável | Padrão | Uso |
|----------|--------|-----|
| `PORT` | `3000` | Porta do servidor |
| `DB_PATH` | `data/provas.db` | Arquivo do banco SQLite |
| `ADMIN_LOGIN` | `admin` | Login do superadmin criado na 1ª execução |
| `ADMIN_SENHA` | aleatória | Senha do superadmin criado na 1ª execução |

Exemplo: `PORT=8080 ADMIN_SENHA=minhasenha123 npm start`

## Estrutura

```
server.js          servidor HTTP + banco + login + API (arquivo único)
package.json       scripts start/dev (sem dependências)
data/              banco SQLite (criado sozinho, fora do git)
public/            tudo que o navegador recebe
  index.html       página inicial (escolha professor/aluno, leva ao login)
  login.html       login único; manda cada papel para sua página
  admin.html       superadmin: cadastro de professores e alunos
  acessoprof.html  professor: minhas provas, nova/editar prova, resultados
  aluno.html       aluno: provas de hoje e tela da prova (com timer)
  script.js        funções compartilhadas (api, exigirPapel, sair, esc...)
  style.css        estilos de todas as páginas
```

O servidor entrega **só** o que está em `public/`. O `server.js` e o `data/` nunca chegam ao navegador.

### Como as páginas funcionam

As páginas são HTML estático. Cada uma tem um `<script>` no final que:

1. chama `exigirPapel('professor', ...)`, que consulta `/api/eu` e volta para o login se não houver sessão ou se o papel não bater;
2. busca os dados com `api('/api/...')` e monta as tabelas com template strings.

Funções de `public/script.js`:

| Função | O que faz |
|--------|-----------|
| `api(caminho, corpo?)` | Sem `corpo` faz GET; com `corpo` faz POST em JSON. Lança `Error` com a mensagem do servidor. Em 401, redireciona para o login. |
| `exigirPapel(...papeis)` | Confere a sessão e preenche os elementos `.nome-usuario`. |
| `esc(texto)` | Escapa texto antes de pôr em `innerHTML`. **Use sempre** com dado vindo do banco. |
| `mostrarMensagem(el, texto, sucesso?)` | Mostra uma mensagem de erro ou sucesso num elemento. |
| `mostrarSecao(id)` | Troca a seção visível no menu lateral. |
| `dataBr(data)` | `2026-10-05` → `05/10/2026`. |

> A página esconder um botão não é segurança. **Toda regra é conferida no servidor.**

## Backend (`server.js`)

O arquivo está dividido em blocos, nesta ordem: banco (schema), senhas, tempo, utilidades HTTP, validações, **rotas da API**, arquivos estáticos e servidor.

### Rotas

As rotas ficam no objeto `rotas`, com a chave `'MÉTODO /caminho'`. Cada rota declara os papéis permitidos em `roles` e o servidor confere a sessão antes de chamar `fn`. Todo POST precisa de `Content-Type: application/json`; o servidor recusa outros formatos com 415, e isso também protege contra CSRF.

| Rota | Papéis | O que faz |
|------|--------|-----------|
| `POST /api/login` | público | `{login, senha}` → cria sessão (cookie `sessao`, 12 h) |
| `POST /api/sair` | público | Apaga a sessão |
| `GET /api/eu` | todos | Usuário logado (`id, nome, role, turma`) |
| `GET /api/usuarios` | superadmin | Lista professores e alunos |
| `POST /api/usuarios` | superadmin | `{nome, login, senha, role, turma}` → cadastra |
| `POST /api/usuarios/excluir` | superadmin | `{id}`. Professor com provas não pode ser excluído |
| `GET /api/turmas` | superadmin, professor | Lista de turmas válidas |
| `GET /api/provas` | professor, superadmin | Provas do professor (o superadmin vê todas) |
| `POST /api/provas` | professor, superadmin | Cria prova com questões |
| `GET /api/prova?id=` | professor, superadmin | Prova completa com gabarito (para editar) |
| `POST /api/provas/editar` | professor, superadmin | Edita prova (veja as regras abaixo) |
| `POST /api/provas/excluir` | professor, superadmin | `{id}`. Apaga junto as tentativas e respostas |
| `GET /api/resultados?prova=` | professor, superadmin | Alunos da turma, quem enviou e notas |
| `GET /api/aluno/provas` | aluno | Provas de hoje da turma, com situação |
| `GET /api/aluno/prova?id=` | aluno | Questões **sem gabarito**, só dentro do horário |
| `POST /api/aluno/enviar` | aluno | `{provaId, respostas: {questaoId: 'A'}}` → grava e calcula a nota |

Formato da prova (criar/editar):

```json
{
  "titulo": "Avaliação Parcial",
  "turma": "9° A",
  "data": "2026-10-06",
  "hora_inicio": "08:00",
  "hora_fim": "09:30",
  "questoes": [
    { "enunciado": "2 + 2 = ?", "alternativas": ["1", "2", "3", "4", "5"], "correta": "D" }
  ]
}
```

Erros voltam como `{ "erro": "mensagem" }` com o status HTTP correspondente.

### Regras de negócio

- **Nota** = `10 × acertos / total de questões`, com 1 casa decimal. Questão sem resposta conta como erro. A conta fica em `NOTA_SQL`, usada tanto no envio quanto no recálculo.
- **Turmas** aceitas: `9° A` até `9° I`, definidas na constante `TURMAS`. O servidor recusa qualquer outra, tanto no cadastro de aluno quanto na criação de prova.
- **Horário**: o aluno só abre a prova entre `hora_inicio` e `hora_fim` do dia marcado. O envio é aceito até 60 s depois do fim (`TOLERANCIA_ENVIO`), por causa do envio automático.
- **Uma tentativa por aluno por prova**, garantida por `UNIQUE (prova_id, aluno_id)` no banco.
- **Fuso fixo** de Fortaleza (UTC-3). Datas e horas das provas ficam gravadas como texto local (`YYYY-MM-DD`, `HH:MM`).
- **Relógio**: o horário vem sempre do servidor. A tela do aluno só mostra a contagem regressiva, então adiantar o relógio do PC não muda nada.
- **Editar prova**:
  - se nenhum aluno enviou, tudo pode mudar: as questões são apagadas e recriadas;
  - se algum aluno enviou, **só o gabarito** muda e as notas são recalculadas na mesma transação. Os outros campos são ignorados.
- **Gabarito** (`correta`) nunca é enviado para a página do aluno.
- O aluno **não vê a nota**, só a confirmação de envio.

### Banco de dados

SQLite em `data/provas.db`. O schema fica no começo do `server.js` e é aplicado com `CREATE TABLE IF NOT EXISTS` a cada início (não há migrações).

| Tabela | Conteúdo |
|--------|----------|
| `users` | Todos os usuários (`role`: superadmin/professor/aluno; `turma` só para aluno) |
| `sessions` | Sessões de login (token do cookie, validade) |
| `provas` | Título, turma, data, horário e professor dono |
| `questoes` | Enunciado, `alt_a`..`alt_e` e `correta` |
| `tentativas` | Uma por aluno por prova: quando enviou e a nota |
| `respostas` | Alternativa marcada pelo aluno em cada questão |

Para ver os dados: `sqlite3 data/provas.db` (ou qualquer visualizador de SQLite).

> **Mudou o schema?** Como não há migrações, `CREATE TABLE IF NOT EXISTS` não altera uma tabela que já existe. Em desenvolvimento, apague o `data/` e reinicie. Com dados reais, escreva um `ALTER TABLE` antes.

### Segurança

- Senhas guardadas com `scrypt` e salt aleatório. A comparação usa `timingSafeEqual`. A senha precisa ter no mínimo 8 caracteres.
- O cookie de sessão é `HttpOnly` e `SameSite=Lax`, **sem** `Secure`, porque a escola acessa por `http://`. Com `Secure` o navegador descartaria o cookie e ninguém conseguiria logar.
- Cabeçalhos `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` e `Referrer-Policy: same-origin` em toda resposta.

## Como fazer mudanças comuns

**Adicionar turmas** (ex.: 8º ano): edite `TURMAS` no `server.js`. As telas carregam a lista de `/api/turmas`, então nada mais precisa mudar.

**Nova rota da API**: adicione uma entrada em `rotas`:

```js
'GET /api/exemplo': {
  roles: ['professor', 'superadmin'],
  fn({ corpo, usuario, url }) {
    if (!algo) falha(400, 'Mensagem para o usuário.');
    return { ... };            // vira JSON; sem retorno = { ok: true }
  },
},
```

- Para rotas de prova do professor, use `provaDoProfessor(id, usuario)`. Ela já garante que o professor só mexe nas próprias provas.
- Mais de uma escrita no banco? Envolva em `transacao(() => { ... })`.

**Nova página**: crie o `.html` em `public/` copiando o cabeçalho de uma página existente, inclua `<script src="script.js"></script>` e comece o script com `exigirPapel(...)`.

## Backup

Pare o servidor e copie a pasta `data/` inteira. O banco usa WAL, e copiar só o `.db` com o servidor rodando pode perder dados. Com o servidor rodando, use `sqlite3 data/provas.db ".backup 'backup.db'"`.

## Limitações do MVP (próximos passos)

- **Sem salvamento automático**: se o aluno recarregar a página durante a prova, perde as marcações. A solução é gravar cada clique no servidor (comentário `ponytail:` no `aluno.html`).
- **Sem bloqueio** de login após várias senhas erradas.
- **Sem duração** própria: a prova vale do horário de início até o de fim.
- **Sem HTTPS**: se houver, ative `Secure` no cookie.
- **Sem migrações** de banco.
- A fonte Inter vem do Google Fonts. Sem internet, as páginas usam a fonte padrão do navegador.
- Fora do escopo: descritores, gerar PDF/Word, embaralhar questões, feedback ao aluno, recuperação de senha.

Atalhos deliberados no código estão marcados com comentários `ponytail:`, que explicam o limite e como evoluir.
