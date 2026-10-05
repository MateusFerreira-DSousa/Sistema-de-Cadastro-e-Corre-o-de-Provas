// Funções compartilhadas por todas as páginas.

// Página inicial de cada papel depois do login.
const PAGINA_INICIAL = {
  superadmin: 'admin.html',
  professor: 'acessoprof.html',
  aluno: 'aluno.html',
};

// Chama a API do servidor. Sem corpo = GET; com corpo = POST em JSON.
// Devolve o JSON da resposta ou lança um Error com a mensagem do servidor.
async function api(caminho, corpo) {
  const opcoes = corpo === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  };
  const resposta = await fetch(caminho, opcoes);
  const dados = await resposta.json().catch(() => ({}));
  if (resposta.status === 401 && !location.pathname.endsWith('login.html')) {
    location.href = 'login.html';
  }
  if (!resposta.ok) throw new Error(dados.erro || 'Não foi possível falar com o servidor.');
  return dados;
}

// Confere a sessão e o papel; se não bater, volta para o login.
async function exigirPapel(...papeis) {
  const eu = await api('/api/eu');
  if (!papeis.includes(eu.role)) {
    location.href = PAGINA_INICIAL[eu.role] || 'login.html';
    throw new Error('Sem permissão para esta página.');
  }
  document.querySelectorAll('.nome-usuario').forEach((el) => { el.textContent = eu.nome; });
  return eu;
}

async function sair() {
  await api('/api/sair', {}).catch(() => {});
  location.href = 'index.html';
}

// Escapa texto vindo do banco antes de colocar em innerHTML.
function esc(valor) {
  const div = document.createElement('div');
  div.textContent = valor ?? '';
  return div.innerHTML;
}

// Mostra uma mensagem num elemento .error-message / .success-message.
function mostrarMensagem(el, texto, sucesso = false) {
  el.textContent = texto;
  el.className = sucesso ? 'success-message' : 'error-message';
  el.hidden = !texto;
}

// Data YYYY-MM-DD -> DD/MM/YYYY
const dataBr = (data) => data.split('-').reverse().join('/');

// Alterna entre as seções do menu lateral.
function mostrarSecao(secaoId) {
  document.querySelectorAll('.dashboard-section').forEach((s) => s.classList.toggle('active-section', s.id === secaoId));
  document.querySelectorAll('.menu-btn').forEach((b) => b.classList.toggle('active', b.dataset.secao === secaoId));
}
