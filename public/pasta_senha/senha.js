/* Gerencia a sessão e a alteração da senha pessoal. */
const formSenha = document.getElementById('troca');
const msg = document.getElementById('mensagem');

exigirPapel('superadmin', 'professor', 'aluno').then((eu) => {
    document.getElementById('voltar').href = PAGINA_INICIAL[eu.role];
    formSenha.hidden = false;
}).catch(() => {});

/* Alterna a visibilidade dos campos de senha. */
document.getElementById('mostrar').addEventListener('change', (evento) => {
    formSenha.querySelectorAll('input[autocomplete]').forEach((campo) => {
        campo.type = evento.target.checked ? 'text' : 'password';
    });
});

/* Valida a confirmação e solicita a atualização ao servidor. */
formSenha.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const atual = document.getElementById('atual').value;
    const nova = document.getElementById('nova').value;
    if (nova !== document.getElementById('confirmacao').value) {
        mostrarMensagem(msg, 'As senhas não coincidem.');
        return;
    }
    const botao = formSenha.querySelector('button');
    botao.disabled = true;
    try {
        await api('/api/senha/alterar', { atual, nova });
        formSenha.reset();
        alert('Senha alterada com sucesso. Entre novamente.');
        location.href = '/pasta_login/login.html';
    } catch (erro) {
        mostrarMensagem(msg, erro.message);
        botao.disabled = false;
    }
});
