/* Painel administrativo: utiliza as funções compartilhadas em script.js. */
const form = document.getElementById('form-usuario');
const campoRole = document.getElementById('idRole');
const campoTurma = document.getElementById('idTurma');
const lista = document.getElementById('lista-usuarios');
const busca = document.getElementById('busca');
const filtro = document.getElementById('filtro');
let usuarios = [];

/* A turma é obrigatória apenas para estudantes. */
function ajustarTurma() {
    const aluno = campoRole.value === 'aluno';
    document.getElementById('grupo-turma').hidden = !aluno;
    campoTurma.required = aluno;
    campoTurma.disabled = !aluno;
}

/* Atualiza a tabela sem inserir texto dos usuários como HTML. */
function renderizar() {
    const termo = busca.value.trim().toLocaleLowerCase('pt-BR');
    const filtrados = usuarios.filter((usuario) => {
        const texto = `${usuario.nome} ${usuario.login}`.toLocaleLowerCase('pt-BR');
        return texto.includes(termo) && (!filtro.value || usuario.role === filtro.value);
    });
    lista.replaceChildren();
    document.getElementById('contagem').textContent = `${filtrados.length} de ${usuarios.length}`;
    if (!filtrados.length) {
        const linha = lista.insertRow();
        const celula = linha.insertCell();
        celula.colSpan = 5;
        celula.textContent = 'Nenhum usuário encontrado.';
        return;
    }
    for (const usuario of filtrados) {
        const linha = lista.insertRow();
        linha.insertCell().textContent = usuario.nome;
        linha.insertCell().textContent = usuario.login;
        const perfil = document.createElement('span');
        perfil.className = usuario.role === 'aluno' ? 'role student' : 'role teacher';
        perfil.textContent = usuario.role === 'aluno' ? 'Estudante' : 'Professor';
        linha.insertCell().append(perfil);
        linha.insertCell().textContent = usuario.turma || '—';
        const botao = document.createElement('button');
        botao.type = 'button';
        botao.className = 'delete';
        botao.textContent = 'Excluir';
        botao.addEventListener('click', () => excluir(usuario, botao));
        const editar = document.createElement('button');
        editar.type = 'button';
        editar.className = 'editar-credenciais';
        editar.textContent = 'Editar';
        editar.addEventListener('click', () => abrirCredenciais(usuario));
        const acoes = document.createElement('div');
        acoes.className = 'acoes-usuario';
        acoes.append(editar, botao);
        linha.insertCell().append(acoes);
    }
}

/* Consulta os usuários e calcula os indicadores reais do painel. */
async function carregar() {
    const erroLista = document.getElementById('erro-lista');
    try {
        usuarios = await api('/api/usuarios');
        document.getElementById('total-usuarios').textContent = usuarios.length;
        document.getElementById('total-professores').textContent = usuarios.filter((u) => u.role === 'professor').length;
        document.getElementById('total-alunos').textContent = usuarios.filter((u) => u.role === 'aluno').length;
        erroLista.hidden = true;
        renderizar();
    } catch (erro) {
        mostrarMensagem(erroLista, erro.message);
        lista.replaceChildren();
    }
}

/* Preserva a confirmação antes da exclusão definitiva. */
async function excluir(usuario, botao) {
    if (!confirm(`Excluir ${usuario.nome}? Registros vinculados, incluindo provas e respostas, podem ser apagados definitivamente.`)) {
        return;
    }
    botao.disabled = true;
    try {
        await api('/api/usuarios/excluir', { id: usuario.id });
        await carregar();
    } catch (erro) {
        alert(erro.message);
    } finally {
        botao.disabled = false;
    }
}

/* Envia o cadastro e mantém o perfil e turma para o próximo usuário. */
form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const mensagem = document.getElementById('mensagem');
    const botao = form.querySelector('button[type="submit"]');
    botao.disabled = true;
    try {
        await api('/api/usuarios', Object.fromEntries(new FormData(form)));
        mostrarMensagem(mensagem, 'Usuário cadastrado com sucesso.', true);
        for (const id of ['idNome', 'idLogin', 'idSenha']) {
            document.getElementById(id).value = '';
        }
        document.getElementById('idNome').focus();
        await carregar();
    } catch (erro) {
        mostrarMensagem(mensagem, erro.message);
    } finally {
        botao.disabled = false;
    }
});

/* Eventos da interface e navegação entre as áreas do painel. */
campoRole.addEventListener('change', ajustarTurma);
busca.addEventListener('input', renderizar);
filtro.addEventListener('change', renderizar);
document.getElementById('sair').addEventListener('click', sair);
document.getElementById('mostrar-senha').addEventListener('change', (evento) => {
    document.getElementById('idSenha').type = evento.target.checked ? 'text' : 'password';
});
function atualizarMenu() {
    const destino = location.hash || '#visao-geral';
    document.querySelectorAll('.nav-link[href^="#"]').forEach((link) => {
        link.classList.toggle('active', link.getAttribute('href') === destino);
    });
}
window.addEventListener('hashchange', atualizarMenu);
atualizarMenu();

/* Confere a sessão de administrador antes de carregar dados. */
async function iniciar() {
    const botao = form.querySelector('button[type="submit"]');
    botao.disabled = true;
    try {
        await exigirPapel('superadmin');
        ajustarTurma();
        const turmas = await api('/api/turmas');
        for (const turma of turmas) {
            campoTurma.add(new Option(turma, turma));
        }
        botao.disabled = false;
        await carregar();
    } catch (erro) {
        mostrarMensagem(document.getElementById('mensagem'), erro.message);
    }
}
/* Gerencia o formulário de alteração de credenciais em uma janela modal. */
const dialogCredenciais = document.getElementById('dialog-credenciais');
const formCredenciais = document.getElementById('form-credenciais');
const editarLogin = document.getElementById('editar-login');
const editarSenha = document.getElementById('editar-senha');
const confirmarEdicao = document.getElementById('confirmar-edicao');
const erroCredenciais = document.getElementById('erro-credenciais');
let usuarioEditado = null;

function abrirCredenciais(usuario) {
    usuarioEditado = usuario.id;
    formCredenciais.reset();
    editarSenha.type = 'password';
    confirmarEdicao.type = 'password';
    editarLogin.value = usuario.login;
    document.getElementById('usuario-credenciais').textContent = usuario.nome;
    erroCredenciais.hidden = true;
    dialogCredenciais.showModal();
}

/* Permite fechar a janela sem salvar e limpar as senhas digitadas. */
for (const id of ['fechar-credenciais', 'cancelar-credenciais']) {
    document.getElementById(id).addEventListener('click', () => dialogCredenciais.close());
}
dialogCredenciais.addEventListener('close', () => formCredenciais.reset());
document.getElementById('mostrar-edicao').addEventListener('change', (evento) => {
    const tipo = evento.target.checked ? 'text' : 'password';
    editarSenha.type = tipo;
    confirmarEdicao.type = tipo;
});

/* Confirma a senha e envia apenas as novas credenciais à API. */
formCredenciais.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    if (editarSenha.value !== confirmarEdicao.value) {
        mostrarMensagem(erroCredenciais, 'As senhas não coincidem.');
        return;
    }
    const botao = formCredenciais.querySelector('button[type="submit"]');
    botao.disabled = true;
    try {
        await api('/api/usuarios/credenciais', {
            id: usuarioEditado,
            login: editarLogin.value.trim(),
            senha: editarSenha.value
        });
        dialogCredenciais.close();
        await carregar();
        mostrarMensagem(document.getElementById('erro-lista'), 'Credenciais atualizadas com sucesso.', true);
    } catch (erro) {
        mostrarMensagem(erroCredenciais, erro.message);
    } finally {
        botao.disabled = false;
    }
});

iniciar();
