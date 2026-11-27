/* =========================================================
   LOGIN DO APTA
   Eventos exclusivos da tela de autenticação.
   ========================================================= */

const formularioLogin = document.getElementById('form-login');
const campoSenha = document.getElementById('idSenha');
const mostrarSenha = document.getElementById('mostrarSenha');
const mensagemLogin = document.getElementById('mensagem');

/* Personaliza a saudação usando apenas os perfis conhecidos.
   O perfil da URL é visual: as permissões continuam sendo definidas pela API. */
const perfilSelecionado = new URLSearchParams(window.location.search)
    .get('perfil');

const saudacoesPorPerfil = new Map([
    ['professor', 'Bem-vindo, professor!'],
    ['estudante', 'Bem-vindo, estudante!'],
    ['administrador', 'Bem-vindo, administrador!']
]);

const tituloLogin = document.getElementById('titulo-login');

if (saudacoesPorPerfil.has(perfilSelecionado)) {
    tituloLogin.textContent = saudacoesPorPerfil.get(perfilSelecionado);
}

/* Alterna a visibilidade da senha sem modificar seu conteúdo. */
mostrarSenha.addEventListener('change', () => {
    campoSenha.type = mostrarSenha.checked
        ? 'text'
        : 'password';
});

/* Envia as credenciais à API e direciona ao painel correspondente. */
formularioLogin.addEventListener('submit', async (evento) => {
    evento.preventDefault();

    const botao = formularioLogin.querySelector('button[type="submit"]');

    botao.disabled = true;
    mostrarMensagem(mensagemLogin, '');

    try {
        const dadosFormulario = Object.fromEntries(
            new FormData(formularioLogin)
        );

        const { role } = await api('/api/login', dadosFormulario);

        location.href = PAGINA_INICIAL[role];
    } catch (erro) {
        mostrarMensagem(mensagemLogin, erro.message);
    } finally {
        botao.disabled = false;
    }
});
