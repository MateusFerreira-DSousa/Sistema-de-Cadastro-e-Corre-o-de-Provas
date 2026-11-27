// Servidor do MVP: entrega os arquivos de public/ e responde a API em /api.
// Só usa módulos nativos do Node 24+ (http, sqlite, crypto), sem dependências.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { join, extname, dirname, sep } from 'node:path';

const PORTA = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || 'data/provas.db';
const PUBLICO = join(import.meta.dirname, 'public');
const DOZE_HORAS = 12 * 3600_000;
const TOLERANCIA_ENVIO = 60_000; // envio automático no fim do tempo pode chegar com atraso de rede
const LETRAS = ['A', 'B', 'C', 'D', 'E'];
// Professores gerenciam provas; administradores têm acesso somente de leitura.
const PROF = ['professor', 'superadmin'];
const EDITORES_PROVA = ['professor'];
// Turmas aceitas: 9° A até 9° I. Para abrir outra série, acrescente aqui.
const TURMAS = [...'ABCDEFGHI'].map((letra) => `9° ${letra}`);

// ---------- Banco ----------
mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('superadmin','professor','aluno')),
  turma TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expira_em INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS provas (
  id INTEGER PRIMARY KEY,
  titulo TEXT NOT NULL,
  turma TEXT NOT NULL,
  data TEXT NOT NULL,          -- YYYY-MM-DD (horário de Fortaleza)
  hora_inicio TEXT NOT NULL,   -- HH:MM
  hora_fim TEXT NOT NULL,      -- HH:MM
  professor_id INTEGER NOT NULL REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS questoes (
  id INTEGER PRIMARY KEY,
  prova_id INTEGER NOT NULL REFERENCES provas(id) ON DELETE CASCADE,
  ordem INTEGER NOT NULL,
  enunciado TEXT NOT NULL,
  alt_a TEXT NOT NULL, alt_b TEXT NOT NULL, alt_c TEXT NOT NULL, alt_d TEXT NOT NULL, alt_e TEXT NOT NULL,
  correta TEXT NOT NULL CHECK (correta IN ('A','B','C','D','E'))
);
CREATE TABLE IF NOT EXISTS tentativas (
  id INTEGER PRIMARY KEY,
  prova_id INTEGER NOT NULL REFERENCES provas(id) ON DELETE CASCADE,
  aluno_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enviada_em INTEGER NOT NULL,   -- epoch ms
  nota REAL NOT NULL,
  UNIQUE (prova_id, aluno_id)
);
CREATE TABLE IF NOT EXISTS respostas (
  tentativa_id INTEGER NOT NULL REFERENCES tentativas(id) ON DELETE CASCADE,
  questao_id INTEGER NOT NULL REFERENCES questoes(id) ON DELETE CASCADE,
  alternativa TEXT NOT NULL CHECK (alternativa IN ('A','B','C','D','E')),
  PRIMARY KEY (tentativa_id, questao_id)
);
`);

// Migração não destrutiva: registra o motivo de cancelamento nas tentativas.
if (!db.prepare('PRAGMA table_info(tentativas)').all().some((coluna) => coluna.name === 'cancelamento')) {
  db.exec('ALTER TABLE tentativas ADD COLUMN cancelamento TEXT');
}

// Guarda as saídas e o instante em que o estudante deixou a tela.
db.exec(`CREATE TABLE IF NOT EXISTS controle_avaliacao (
  prova_id INTEGER NOT NULL REFERENCES provas(id) ON DELETE CASCADE,
  aluno_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  saidas INTEGER NOT NULL DEFAULT 0,
  fora_desde INTEGER,
  PRIMARY KEY (prova_id, aluno_id)
)`);

function cancelarAvaliacao(provaId, alunoId, motivo) {
  db.prepare(`INSERT OR IGNORE INTO tentativas
    (prova_id, aluno_id, enviada_em, nota, cancelamento)
    VALUES (?, ?, ?, 0, ?)`).run(provaId, alunoId, Date.now(), motivo);
  db.prepare('DELETE FROM controle_avaliacao WHERE prova_id = ? AND aluno_id = ?').run(provaId, alunoId);
}

// O servidor aplica o limite mesmo quando o navegador suspende seus timers.
function verificarAusencias() {
  const registros = db.prepare(`SELECT prova_id, aluno_id FROM controle_avaliacao
    WHERE fora_desde IS NOT NULL AND fora_desde < ?`).all(Date.now() - 10000);
  for (const registro of registros) {
    cancelarAvaliacao(registro.prova_id, registro.aluno_id, 'Mais de 10 segundos fora da tela');
  }
}
setInterval(verificarAusencias, 250).unref();

function transacao(fn) {
  db.exec('BEGIN');
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// Nota calculada no banco: 10 × acertos / total de questões, 1 casa. Questão sem resposta = erro.
// Usada ao enviar e ao recalcular quando o professor corrige o gabarito.
const NOTA_SQL = `ROUND(10.0 * (SELECT COUNT(*) FROM respostas r JOIN questoes q ON q.id = r.questao_id
    WHERE r.tentativa_id = tentativas.id AND r.alternativa = q.correta)
  / (SELECT COUNT(*) FROM questoes WHERE prova_id = tentativas.prova_id), 1)`;

// ---------- Senhas (scrypt + salt) ----------
function gerarHash(senha) {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(senha, salt, 64).toString('hex')}`;
}
function senhaConfere(senha, guardado) {
  const [salt, hash] = guardado.split(':');
  return timingSafeEqual(scryptSync(senha, Buffer.from(salt, 'hex'), 64), Buffer.from(hash, 'hex'));
}
// Login inexistente também roda scrypt, para o tempo de resposta não revelar quem existe.
const HASH_FALSO = gerarHash(randomBytes(8).toString('hex'));

if (!db.prepare("SELECT 1 FROM users WHERE role = 'superadmin'").get()) {
  const login = process.env.ADMIN_LOGIN || 'admin';
  const senha = process.env.ADMIN_SENHA || randomBytes(6).toString('hex');
  db.prepare('INSERT INTO users (nome, login, senha_hash, role) VALUES (?, ?, ?, ?)')
    .run('Administrador', login, gerarHash(senha), 'superadmin');
  console.log(`Superadmin criado: login "${login}"` +
    (process.env.ADMIN_SENHA ? '' : `, senha "${senha}" (anote: só aparece agora)`));
}

// ---------- Tempo (fuso fixo de Fortaleza, UTC-3, sem horário de verão) ----------
const paraEpoch = (data, hora) => Date.parse(`${data}T${hora}:00-03:00`);

// ---------- Utilidades HTTP ----------
class ErroHttp extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}
const falha = (status, mensagem) => { throw new ErroHttp(status, mensagem); };
const texto = (valor) => String(valor ?? '').trim();

function enviar(res, status, dados) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(dados));
}

async function lerJson(req) {
  // Exigir JSON força preflight CORS: outro site não consegue postar aqui pelo navegador do usuário.
  if (!req.headers['content-type']?.startsWith('application/json')) falha(415, 'Envie os dados em JSON.');
  let corpo = '';
  for await (const parte of req) {
    corpo += parte;
    if (corpo.length > 1_000_000) falha(413, 'Dados grandes demais.');
  }
  try { return JSON.parse(corpo || '{}') ?? {}; } catch { falha(400, 'JSON inválido.'); }
}

const tokenDa = (req) => /(?:^|;\s*)sessao=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];

function usuarioDa(req) {
  const token = tokenDa(req);
  if (!token) return null;
  return db.prepare(`SELECT u.id, u.nome, u.role, u.turma FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expira_em > ?`).get(token, Date.now()) ?? null;
}

function provaDoProfessor(id, usuario) {
  return db.prepare("SELECT * FROM provas WHERE id = ? AND (? = 'superadmin' OR professor_id = ?)")
    .get(Number(id), usuario.role, usuario.id) ?? falha(404, 'Prova não encontrada.');
}

function provaDoAluno(id, usuario) {
  return db.prepare('SELECT * FROM provas WHERE id = ? AND turma = ?')
    .get(Number(id), usuario.turma) ?? falha(404, 'Prova não encontrada.');
}

// Valida os dados de uma prova (criar ou editar) e devolve os campos limpos.
function validarProva(corpo) {
  const titulo = texto(corpo.titulo), turma = texto(corpo.turma);
  const { data, hora_inicio, hora_fim } = corpo;
  if (!titulo) falha(400, 'Preencha o título.');
  if (!TURMAS.includes(turma)) falha(400, 'Escolha uma turma válida.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{2}:\d{2}$/.test(hora_inicio) || !/^\d{2}:\d{2}$/.test(hora_fim)) {
    falha(400, 'Data ou horário inválido.');
  }
  if (hora_fim <= hora_inicio) falha(400, 'O horário de fim precisa ser depois do início.');
  const questoes = Array.isArray(corpo.questoes) ? corpo.questoes : [];
  if (!questoes.length) falha(400, 'Adicione pelo menos uma questão.');
  questoes.forEach((q, i) => {
    const completa = texto(q?.enunciado) && Array.isArray(q.alternativas) && q.alternativas.length === 5 &&
      q.alternativas.every((a) => texto(a)) && LETRAS.includes(q.correta);
    if (!completa) falha(400, `A questão ${i + 1} está incompleta.`);
  });
  return { titulo, turma, data, hora_inicio, hora_fim, questoes };
}

function inserirQuestoes(provaId, questoes) {
  const inserir = db.prepare(`INSERT INTO questoes (prova_id, ordem, enunciado, alt_a, alt_b, alt_c, alt_d, alt_e, correta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  questoes.forEach((q, i) => inserir.run(provaId, i + 1, texto(q.enunciado), ...q.alternativas.map(texto), q.correta));
}

// ---------- Rotas da API ----------
const rotas = {
  'POST /api/login': {
    publica: true,
    fn({ corpo, res }) {
      const usuario = db.prepare('SELECT * FROM users WHERE login = ?').get(texto(corpo.login));
      const ok = senhaConfere(String(corpo.senha ?? ''), usuario?.senha_hash ?? HASH_FALSO);
      if (!usuario || !ok) falha(401, 'Login ou senha incorretos.');
      db.prepare('DELETE FROM sessions WHERE expira_em <= ?').run(Date.now());
      const token = randomBytes(32).toString('hex');
      db.prepare('INSERT INTO sessions (token, user_id, expira_em) VALUES (?, ?, ?)').run(token, usuario.id, Date.now() + DOZE_HORAS);
      // Sem "Secure": a escola acessa por http://IP:3000 e o navegador descartaria o cookie.
      res.setHeader('Set-Cookie', `sessao=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${DOZE_HORAS / 1000}`);
      return { role: usuario.role };
    },
  },

  'POST /api/sair': {
    publica: true,
    fn({ req, res }) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(tokenDa(req) ?? '');
      res.setHeader('Set-Cookie', 'sessao=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    },
  },

  'GET /api/eu': {
    roles: ['superadmin', 'professor', 'aluno'],
    fn: ({ usuario }) => usuario,
  },

  'POST /api/senha/alterar': {
    roles: ['superadmin', 'professor', 'aluno'],
    fn({ corpo, usuario }) {
      const { atual, nova } = corpo;
      if (typeof atual !== 'string' || atual.length > 1024 || typeof nova !== 'string' || nova.length < 8 || nova.length > 128) falha(400, 'Informe a senha atual e uma nova senha de 8 a 128 caracteres.');
      const conta = db.prepare('SELECT senha_hash FROM users WHERE id = ?').get(usuario.id);
      if (!senhaConfere(atual, conta.senha_hash)) falha(400, 'Senha atual incorreta.');
      if (atual === nova) falha(400, 'Escolha uma senha diferente da atual.');
      transacao(() => {
        db.prepare('UPDATE users SET senha_hash = ? WHERE id = ?').run(gerarHash(nova), usuario.id);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(usuario.id);
      });
    },
  },

  // --- Superadmin: cadastro de professores e alunos ---
  'GET /api/usuarios': {
    roles: ['superadmin'],
    fn: () => db.prepare("SELECT id, nome, login, role, turma FROM users WHERE role != 'superadmin' ORDER BY role DESC, turma, nome").all(),
  },

  'POST /api/usuarios': {
    roles: ['superadmin'],
    fn({ corpo }) {
      const nome = texto(corpo.nome), login = texto(corpo.login), senha = String(corpo.senha ?? '');
      const role = corpo.role, turma = texto(corpo.turma);
      if (!nome || !login) falha(400, 'Preencha nome e login.');
      if (senha.length < 8) falha(400, 'A senha precisa ter pelo menos 8 caracteres.');
      if (!['professor', 'aluno'].includes(role)) falha(400, 'Escolha professor ou aluno.');
      if (role === 'aluno' && !TURMAS.includes(turma)) falha(400, 'Escolha uma turma válida.');
      try {
        db.prepare('INSERT INTO users (nome, login, senha_hash, role, turma) VALUES (?, ?, ?, ?, ?)')
          .run(nome, login, gerarHash(senha), role, role === 'aluno' ? turma : null);
      } catch (e) {
        if (e.message.includes('UNIQUE')) falha(409, 'Esse login já existe.');
        throw e;
      }
    },
  },

  // Redefine credenciais sem alterar o ID ou os registros vinculados à conta.
  'POST /api/usuarios/credenciais': {
    roles: ['superadmin'],
    fn({ corpo }) {
      const id = Number(corpo.id);
      const login = typeof corpo.login === 'string' ? corpo.login.trim() : '';
      const senha = corpo.senha ?? '';
      if (!Number.isSafeInteger(id) || id < 1 || !login || login.length > 254) {
        falha(400, 'Informe um usuário e um login válido.');
      }
      if (typeof senha !== 'string' || (senha !== '' && (senha.length < 8 || senha.length > 128))) {
        falha(400, 'A nova senha deve ter entre 8 e 128 caracteres.');
      }
      const conta = db.prepare("SELECT id, login FROM users WHERE id = ? AND role IN ('professor', 'aluno')").get(id);
      if (!conta) {
        falha(404, 'Usuário não encontrado.');
      }
      if (db.prepare('SELECT id FROM users WHERE login = ? AND id != ?').get(login, id)) {
        falha(409, 'Esse login já existe.');
      }
      // Uma senha vazia mantém o hash anterior. Alterações encerram sessões antigas.
      transacao(() => {
        if (senha) {
          db.prepare('UPDATE users SET login = ?, senha_hash = ? WHERE id = ?')
            .run(login, gerarHash(senha), id);
        } else {
          db.prepare('UPDATE users SET login = ? WHERE id = ?').run(login, id);
        }
        if (senha || login !== conta.login) {
          db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
        }
      });
      return { ok: true };
    },
  },

  'POST /api/usuarios/excluir': {
    roles: ['superadmin'],
    fn({ corpo }) {
      try {
        db.prepare("DELETE FROM users WHERE id = ? AND role != 'superadmin'").run(Number(corpo.id));
      } catch (e) {
        if (e.message.includes('FOREIGN KEY')) falha(409, 'Esse professor tem provas cadastradas. Exclua as provas antes.');
        throw e;
      }
    },
  },

  'GET /api/turmas': {
    roles: ['superadmin', 'professor'],
    fn: () => TURMAS,
  },

  // --- Professor: provas e resultados ---
  'GET /api/provas': {
    roles: PROF,
    fn: ({ usuario }) => db.prepare(`SELECT p.*,
        (SELECT COUNT(*) FROM questoes WHERE prova_id = p.id) AS total_questoes,
        (SELECT COUNT(*) FROM tentativas WHERE prova_id = p.id) AS enviadas
      FROM provas p WHERE (? = 'superadmin' OR professor_id = ?)
      ORDER BY data DESC, hora_inicio DESC`).all(usuario.role, usuario.id),
  },

  'POST /api/provas': {
    roles: EDITORES_PROVA,
    fn({ corpo, usuario }) {
      const p = validarProva(corpo);
      return transacao(() => {
        const { lastInsertRowid: provaId } = db.prepare(
          'INSERT INTO provas (titulo, turma, data, hora_inicio, hora_fim, professor_id) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(p.titulo, p.turma, p.data, p.hora_inicio, p.hora_fim, usuario.id);
        inserirQuestoes(provaId, p.questoes);
        return { id: Number(provaId) };
      });
    },
  },

  // Prova completa, com gabarito, para o formulário de edição.
  'GET /api/prova': {
    roles: PROF,
    fn({ url, usuario }) {
      const prova = provaDoProfessor(url.searchParams.get('id'), usuario);
      const enviadas = db.prepare('SELECT COUNT(*) AS n FROM tentativas WHERE prova_id = ?').get(prova.id).n;
      const questoes = db.prepare('SELECT * FROM questoes WHERE prova_id = ? ORDER BY ordem').all(prova.id)
        .map((q) => ({ id: q.id, enunciado: q.enunciado, alternativas: [q.alt_a, q.alt_b, q.alt_c, q.alt_d, q.alt_e], correta: q.correta }));
      return { ...prova, enviadas, questoes };
    },
  },

  'POST /api/provas/editar': {
    roles: EDITORES_PROVA,
    fn({ corpo, usuario }) {
      const prova = provaDoProfessor(corpo.id, usuario);

      // Algum aluno já enviou: só o gabarito pode mudar, e as notas são recalculadas.
      if (db.prepare('SELECT 1 FROM tentativas WHERE prova_id = ?').get(prova.id)) {
        const questoes = Array.isArray(corpo.questoes) ? corpo.questoes : [];
        transacao(() => {
          const mudar = db.prepare('UPDATE questoes SET correta = ? WHERE id = ? AND prova_id = ?');
          questoes.forEach((q, i) => {
            if (!LETRAS.includes(q?.correta)) falha(400, `Marque a alternativa correta da questão ${i + 1}.`);
            mudar.run(q.correta, Number(q.id) || 0, prova.id);
          });
          db.prepare(`UPDATE tentativas SET nota = ${NOTA_SQL} WHERE prova_id = ?`).run(prova.id);
        });
        return { soGabarito: true };
      }

      // Ninguém enviou ainda: troca tudo, questões são apagadas e recriadas.
      const p = validarProva(corpo);
      transacao(() => {
        db.prepare('UPDATE provas SET titulo = ?, turma = ?, data = ?, hora_inicio = ?, hora_fim = ? WHERE id = ?')
          .run(p.titulo, p.turma, p.data, p.hora_inicio, p.hora_fim, prova.id);
        db.prepare('DELETE FROM questoes WHERE prova_id = ?').run(prova.id);
        inserirQuestoes(prova.id, p.questoes);
      });
      return { soGabarito: false };
    },
  },

  'POST /api/provas/excluir': {
    roles: EDITORES_PROVA,
    fn({ corpo, usuario }) {
      const prova = provaDoProfessor(corpo.id, usuario);
      db.prepare('DELETE FROM provas WHERE id = ?').run(prova.id);
    },
  },

  'GET /api/resultados': {
    roles: PROF,
    fn({ url, usuario }) {
      const prova = provaDoProfessor(url.searchParams.get('prova'), usuario);
      const alunos = db.prepare(`SELECT u.nome, t.nota, t.enviada_em, t.cancelamento FROM users u
        LEFT JOIN tentativas t ON t.aluno_id = u.id AND t.prova_id = ?
        WHERE u.role = 'aluno' AND u.turma = ? ORDER BY u.nome`).all(prova.id, prova.turma);
      return { prova, alunos };
    },
  },

  // --- Aluno ---
  'GET /api/aluno/provas': {
    roles: ['aluno'],
    fn({ usuario }) {
      const agora = Date.now();
      // Lista todas as avaliações da turma, inclusive as futuras e encerradas.
      // As questões continuam protegidas pela rota de início da prova.
      return db.prepare(`
        SELECT p.id, p.titulo, p.data, p.hora_inicio, p.hora_fim, t.enviada_em, t.cancelamento
        FROM provas p
        LEFT JOIN tentativas t ON t.prova_id = p.id AND t.aluno_id = ?
        WHERE p.turma = ?
        ORDER BY p.data DESC, p.hora_inicio
      `).all(usuario.id, usuario.turma)
        .map((p) => ({
          ...p,
          estado: p.cancelamento ? 'cancelada' : p.enviada_em ? 'enviada'
            : agora < paraEpoch(p.data, p.hora_inicio) ? 'aguardando'
            : agora < paraEpoch(p.data, p.hora_fim) ? 'aberta' : 'encerrada',
        }));
    },
  },

  'GET /api/aluno/prova': {
    roles: ['aluno'],
    fn({ url, usuario }) {
      const prova = provaDoAluno(url.searchParams.get('id'), usuario);
      if (db.prepare('SELECT 1 FROM tentativas WHERE prova_id = ? AND aluno_id = ?').get(prova.id, usuario.id)) {
        falha(409, 'Você já enviou esta prova.');
      }
      const agora = Date.now(), fim = paraEpoch(prova.data, prova.hora_fim);
      if (agora < paraEpoch(prova.data, prova.hora_inicio) || agora >= fim) falha(409, 'A prova não está aberta agora.');
      db.prepare('INSERT OR IGNORE INTO controle_avaliacao (prova_id, aluno_id) VALUES (?, ?)').run(prova.id, usuario.id);
      const controle = db.prepare('SELECT saidas FROM controle_avaliacao WHERE prova_id = ? AND aluno_id = ?').get(prova.id, usuario.id);
      // O gabarito (correta) nunca sai daqui para o navegador do aluno.
      const questoes = db.prepare('SELECT id, enunciado, alt_a, alt_b, alt_c, alt_d, alt_e FROM questoes WHERE prova_id = ? ORDER BY ordem')
        .all(prova.id)
        .map((q) => ({ id: q.id, enunciado: q.enunciado, alternativas: [q.alt_a, q.alt_b, q.alt_c, q.alt_d, q.alt_e] }));
      // Ordem estável por aluno e prova: mantém os IDs usados na correção.
      const ordem = (questao) => createHash('sha256')
        .update(`${usuario.id}:${prova.id}:${questao.id}`)
        .digest('hex');
      questoes.sort((a, b) => ordem(a).localeCompare(ordem(b)));
      return { titulo: prova.titulo, fim, agora, questoes, saidas: controle.saidas };
    },
  },

  // Recebe eventos de saída e retorno da tela, sem confiar no contador do navegador.
  'POST /api/aluno/foco': {
    roles: ['aluno'],
    fn({ corpo, usuario }) {
      const prova = provaDoAluno(corpo.provaId, usuario);
      verificarAusencias();
      const tentativa = () => db.prepare('SELECT cancelamento FROM tentativas WHERE prova_id = ? AND aluno_id = ?').get(prova.id, usuario.id);
      if (tentativa()) return { cancelamento: tentativa().cancelamento, finalizada: true };
      const controle = db.prepare('SELECT * FROM controle_avaliacao WHERE prova_id = ? AND aluno_id = ?').get(prova.id, usuario.id);
      if (!controle) falha(409, 'Avaliação não iniciada.');
      if (corpo.evento === 'saida' && controle.fora_desde === null) {
        const saidas = controle.saidas + 1;
        if (saidas >= 3) {
          cancelarAvaliacao(prova.id, usuario.id, 'Três saídas da tela');
          return { cancelamento: 'Três saídas da tela', finalizada: true };
        }
        db.prepare('UPDATE controle_avaliacao SET saidas = ?, fora_desde = ? WHERE prova_id = ? AND aluno_id = ?')
          .run(saidas, Date.now(), prova.id, usuario.id);
      } else if (corpo.evento === 'retorno') {
        db.prepare('UPDATE controle_avaliacao SET fora_desde = NULL WHERE prova_id = ? AND aluno_id = ?').run(prova.id, usuario.id);
      }
      return db.prepare('SELECT saidas FROM controle_avaliacao WHERE prova_id = ? AND aluno_id = ?').get(prova.id, usuario.id);
    },
  },

  'POST /api/aluno/enviar': {
    roles: ['aluno'],
    fn({ corpo, usuario }) {
      const prova = provaDoAluno(corpo.provaId, usuario);
      const agora = Date.now();
      if (agora < paraEpoch(prova.data, prova.hora_inicio) || agora > paraEpoch(prova.data, prova.hora_fim) + TOLERANCIA_ENVIO) {
        falha(409, 'Fora do horário da prova.');
      }
      verificarAusencias();
      const controle = db.prepare('SELECT fora_desde FROM controle_avaliacao WHERE prova_id = ? AND aluno_id = ?').get(prova.id, usuario.id);
      if (controle?.fora_desde != null) falha(409, 'Retorne à tela da avaliação antes de enviar.');
      const respostas = corpo.respostas ?? {};
      const questoes = db.prepare('SELECT id FROM questoes WHERE prova_id = ?').all(prova.id);

      transacao(() => {
        let tentativaId;
        try {
          tentativaId = db.prepare('INSERT INTO tentativas (prova_id, aluno_id, enviada_em, nota) VALUES (?, ?, ?, 0)')
            .run(prova.id, usuario.id, agora).lastInsertRowid;
        } catch (e) {
          if (e.message.includes('UNIQUE')) falha(409, 'Você já enviou esta prova.');
          throw e;
        }
        const inserir = db.prepare('INSERT INTO respostas (tentativa_id, questao_id, alternativa) VALUES (?, ?, ?)');
        for (const q of questoes) {
          const marcada = respostas[q.id];
          if (!LETRAS.includes(marcada)) continue;
          inserir.run(tentativaId, q.id, marcada);
        }
        db.prepare(`UPDATE tentativas SET nota = ${NOTA_SQL} WHERE id = ?`).run(tentativaId);
        db.prepare('DELETE FROM controle_avaliacao WHERE prova_id = ? AND aluno_id = ?').run(prova.id, usuario.id);
      });
    },
  },
};

// ---------- Arquivos estáticos ----------
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function servirArquivo(caminho, res) {
  try {
    // Mantém a página inicial e os endereços antigos compatíveis com a nova estrutura.
    const caminhosAntigos = {
      '/': '/pasta_inicio/index.html',
      '/index.html': '/pasta_inicio/index.html',
      '/login.html': '/pasta_login/login.html',
      '/admin.html': '/pasta_admin/admin.html',
      '/acessoprof.html': '/pasta_provas/acessoprof.html',
      '/aluno.html': '/pasta_aluno/aluno.html',
      '/imprimir.html': '/pasta_impressao/imprimir.html',
      '/senha.html': '/pasta_senha/senha.html',
    };
    const destino = Object.hasOwn(caminhosAntigos, caminho) ? caminhosAntigos[caminho] : caminho;
    const arquivo = join(PUBLICO, decodeURIComponent(destino));
    if (!arquivo.startsWith(PUBLICO + sep)) throw new Error('fora de public/');
    const conteudo = await readFile(arquivo);
    res.writeHead(200, { 'Content-Type': TIPOS[extname(arquivo)] ?? 'application/octet-stream' });
    res.end(conteudo);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Página não encontrada.');
  }
}

// ---------- Servidor ----------
createServer(async (req, res) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');

  const url = new URL(req.url, 'http://localhost');
  const rota = rotas[`${req.method} ${url.pathname}`];
  if (!rota) {
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return servirArquivo(url.pathname, res);
    return enviar(res, 404, { erro: 'Rota não encontrada.' });
  }

  try {
    const usuario = usuarioDa(req);
    if (!rota.publica) {
      if (!usuario) falha(401, 'Faça login para continuar.');
      if (!rota.roles.includes(usuario.role)) falha(403, 'Você não tem permissão para isso.');
    }
    const corpo = req.method === 'POST' ? await lerJson(req) : {};
    enviar(res, 200, rota.fn({ corpo, usuario, url, req, res }) ?? { ok: true });
  } catch (e) {
    if (!(e instanceof ErroHttp)) console.error(e);
    enviar(res, e.status ?? 500, { erro: e instanceof ErroHttp ? e.message : 'Erro interno no servidor.' });
  }
}).listen(PORTA, () => console.log(`Servidor rodando em http://localhost:${PORTA}`));
