document.addEventListener('DOMContentLoaded', () => {
  // Seleciona o formulário e os campos pelo ID
  const form = document.querySelector('.auth-form');
  const senhaInput = document.getElementById('idSenha');
  const cSenhaInput = document.getElementById('idCsenha');

  // Adiciona o evento de submissão ao formulário
  form.addEventListener('submit', (event) => {
    // Remove mensagens de erro anteriores, se existirem
    removerMensagemErro();

    const senha = senhaInput.value;
    const confirmacaoSenha = cSenhaInput.value;

    // 1. Verifica se as senhas são diferentes
    if (senha !== confirmacaoSenha) {
      // Impede o envio do formulário
      event.preventDefault();

      // Exibe a mensagem visual de erro
      exibirMensagemErro('As senhas digitadas não coincidem.');

      // Destaca os campos em vermelho
      senhaInput.classList.add('input-error');
      cSenhaInput.classList.add('input-error');

      // Foca no campo de confirmação para o usuário corrigir
      cSenhaInput.focus();
    }
  });

  // Limpa o destaque de erro assim que o usuário volta a digitar
  [senhaInput, cSenhaInput].forEach((input) => {
    input.addEventListener('input', () => {
      senhaInput.classList.remove('input-error');
      cSenhaInput.classList.remove('input-error');
      removerMensagemErro();
    });
  });

  // Função auxiliar para exibir a mensagem na tela
  function exibirMensagemErro(mensagem) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.innerText = mensagem;
    
    // Insere o alerta acima dos botões
    const formActions = document.querySelector('.form-actions');
    form.insertBefore(errorDiv, formActions);
  }

  // Função auxiliar para remover o alerta
  function removerMensagemErro() {
    const errorExistente = document.querySelector('.error-message');
    if (errorExistente) {
      errorExistente.remove();
    }
  }
});

// Alterna entre as seções do Menu do Professor
function mostrarSecao(secaoId) {
    // Esconde todas as seções
    const secoes = document.querySelectorAll('.dashboard-section');
    secoes.forEach(secao => secao.classList.remove('active-section'));

    // Remove destaque de todos os botões do menu
    const botoes = document.querySelectorAll('.menu-btn');
    botoes.forEach(btn => btn.classList.remove('active'));

    // Mostra a seção selecionada
    const secaoAlvo = document.getElementById(secaoId);
    if (secaoAlvo) {
        secaoAlvo.classList.add('active-section');
    }

    // Destaca o botão clicado
    event.currentTarget.classList.add('active');
}

// Alterna entre as Abas (Visão Geral vs Individual)
function alternarAbaResultado(tipoAba) {
    const abas = document.querySelectorAll('.tab-content');
    abas.forEach(aba => aba.classList.remove('active-tab'));

    const botoes = document.querySelectorAll('.tab-btn');
    botoes.forEach(btn => btn.classList.remove('active'));

    if (tipoAba === 'geral') {
        document.getElementById('aba-resultado-geral').classList.add('active-tab');
    } else {
        document.getElementById('aba-resultado-individual').classList.add('active-tab');
    }

    event.currentTarget.classList.add('active');
}