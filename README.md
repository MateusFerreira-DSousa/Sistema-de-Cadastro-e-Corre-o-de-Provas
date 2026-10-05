# Sistema-de-Cadastro-e-Corre-o-de-Provas
Simplifique a rotina escolar. Professores criam avaliações e acompanham o desempenho da turma em tempo real, enquanto alunos respondem com praticidade e feedback instantâneo.

## Como rodar (MVP)

Precisa de **Node.js 24 ou mais novo**. O projeto não tem dependências, então não precisa de `npm install`.

```bash
npm start
```

Abra `http://localhost:3000`. Na rede da escola, os alunos acessam `http://IP-DO-SERVIDOR:3000`.

Na primeira execução o sistema cria o superadmin (login `admin`) e mostra a senha **uma única vez** no terminal. O superadmin cadastra professores e alunos. Cada aluno tem uma turma, e a turma da prova precisa ser escrita igual (ex.: `9° A`).

Variáveis opcionais: `PORT` (padrão 3000), `DB_PATH` (padrão `data/provas.db`), `ADMIN_LOGIN`, `ADMIN_SENHA`.

Backup: pare o servidor e copie a pasta `data/` inteira.

### Estrutura

- `server.js`: servidor HTTP, banco SQLite (`node:sqlite`), login e API em `/api`.
- `public/`: páginas estáticas (`index`, `login`, `admin`, `acessoprof`, `aluno`), `style.css` e `script.js`.
