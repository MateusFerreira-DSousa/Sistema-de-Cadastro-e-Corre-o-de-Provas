const SITUACAO = {
  aguardando: 'Agendada',
  aberta: 'Aberta',
  enviada: 'Enviada ✔',
  encerrada: 'Encerrada',
  cancelada: 'Cancelada',
};
let provaAtual = null;
let relogio = null;
let enviando = false;
let abrindo = false;
let saidas = 0;
let saiuDaAba = false;
let resolverModal = null;
const modal = document.getElementById('modal-avaliacao');

// Centraliza a abertura e o encerramento dos modais, inclusive no fim do tempo.
function fecharModal(resultado = false) {
    const resolver = resolverModal;
    resolverModal = null;
    if (modal.open) {
        modal.close();
    }
    if (resolver) {
        resolver(resultado);
    }
}

function abrirModal({ titulo, texto, confirmar, cancelar, total = 0, marcadas = 0 }) {
    fecharModal();
    document.getElementById('modal-titulo').textContent = titulo;
    document.getElementById('modal-texto').textContent = texto;
    document.getElementById('modal-confirmar').textContent = confirmar;
    const botaoCancelar = document.getElementById('modal-cancelar');
    botaoCancelar.hidden = !cancelar;
    botaoCancelar.textContent = cancelar || '';
    document.getElementById('modal-progresso').hidden = !total;
    if (total) {
        document.getElementById('modal-contagem').textContent = `${marcadas} de ${total} questões respondidas`;
        const barra = document.getElementById('modal-barra');
        barra.max = total;
        barra.value = marcadas;
        document.getElementById('modal-pendentes').textContent = total - marcadas
            ? `Questões sem resposta: ${total - marcadas}.`
            : 'Todas as questões foram respondidas.';
    }
    modal.showModal();
    return new Promise((resolve) => {
        resolverModal = resolve;
    });
}

document.getElementById('modal-confirmar').addEventListener('click', () => fecharModal(true));
document.getElementById('modal-cancelar').addEventListener('click', () => fecharModal(false));
modal.addEventListener('cancel', (evento) => {
    evento.preventDefault();
    fecharModal(false);
});

// A tela cheia depende de autorização do navegador e pode ser encerrada pelo usuário.
async function solicitarTelaCheia() {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        try {
            await document.documentElement.requestFullscreen();
        } catch {
            // A avaliação continua disponível quando a tela cheia não é suportada.
        }
    }
}

document.getElementById('botao-tela-cheia').addEventListener('click', solicitarTelaCheia);

// Registra as saídas no servidor e impede contagem duplicada de eventos.
let filaFoco = Promise.resolve();
let vigilancia = null;
let usouTelaCheia = false;
let ultimoAviso = 0;

async function registrarFoco(evento, id) {
    const estado = await api('/api/aluno/foco', { provaId: id, evento });
    if (provaAtual !== id) return;
    if (estado.cancelamento) {
        clearInterval(relogio);
        clearInterval(vigilancia);
        provaAtual = null;
        fecharModal();
        mostrarSecao('sec-lista');
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        await carregarProvas();
        abrirModal({
            titulo: 'Avaliação cancelada',
            texto: `${estado.cancelamento}. Não será possível iniciar novamente.`,
            confirmar: 'Entendi',
        });
        return;
    }
    if (estado.finalizada) return;
    saidas = estado.saidas;
    document.getElementById('total-saidas').textContent = saidas;
    if (evento === 'retorno' && !enviando && saidas > ultimoAviso) {
        ultimoAviso = saidas;
        abrirModal({
            titulo: 'Atenção durante a avaliação',
            texto: `Saídas detectadas: ${saidas} de 3. Mais de 10 segundos fora da tela também cancela a prova.`,
            confirmar: 'Continuar avaliação',
        });
    }
}

// Sincroniza a situação real, inclusive quando um evento anterior falhou.
function enfileirarFoco(evento) {
    const id = provaAtual;
    if (id === null) return;
    filaFoco = filaFoco.then(async () => {
        if (provaAtual !== id) return;
        await registrarFoco(evento, id);
    }).catch(() => {
        if (provaAtual === id) {
            mostrarMensagem(document.getElementById('mensagem-prova'), 'Falha na sincronização da proteção. Tentando novamente.');
        }
    });
}

// A perda de foco e a mudança de aba representam uma única saída.
function verificarFoco() {
    if (provaAtual === null) return;
    const fora = document.hidden || !document.hasFocus();
    if (fora === saiuDaAba) return;
    saiuDaAba = fora;
    if (fora) {
        enfileirarFoco('saida');
    } else {
        enfileirarFoco('retorno');
    }
}

// Reenvia o estado a cada segundo, mesmo se algum evento não chegou ao servidor.
function vigiarAvaliacao() {
    verificarFoco();
    if (provaAtual === null) return;
    enfileirarFoco(saiuDaAba ? 'saida' : 'retorno');
}

document.addEventListener('visibilitychange', verificarFoco);
window.addEventListener('blur', verificarFoco);
window.addEventListener('focus', verificarFoco);
document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) {
        usouTelaCheia = true;
    } else if (usouTelaCheia && provaAtual !== null && !saiuDaAba) {
        // Sair da tela cheia conta uma saída, sem impedir o retorno à aba.
        enfileirarFoco('saida');
        enfileirarFoco('retorno');
    }
    verificarFoco();
});

// O navegador apresenta seu próprio aviso ao recarregar ou fechar a página.
window.addEventListener('beforeunload', (evento) => {
    if (provaAtual !== null) {
        evento.preventDefault();
        evento.returnValue = '';
    }
});

document.querySelector('.aluno-marca').addEventListener('click', (evento) => {
    if (provaAtual !== null) {
        evento.preventDefault();
    }
});

// Mantém a lista e os indicadores sincronizados com o servidor.
let avaliacoes = [];

function renderizarAvaliacoes() {
    const filtro = document.getElementById('filtro-avaliacoes').value;
    const estados = {
        aguardando: 'total-agendadas',
        aberta: 'total-abertas',
        enviada: 'total-enviadas',
    };

    for (const [estado, id] of Object.entries(estados)) {
        document.getElementById(id).textContent = avaliacoes.filter(
            (prova) => prova.estado === estado
        ).length;
    }

    const visiveis = avaliacoes.filter(
        (prova) => filtro === 'todas' || prova.estado === filtro
    );
    const lista = document.getElementById('lista-provas');

    lista.innerHTML = visiveis.map((prova) => `
        <article class="aluno-prova">
            <div class="aluno-prova-info">
                <h3>${esc(prova.titulo)}</h3>
                <p>${esc(dataBr(prova.data))} · ${esc(prova.hora_inicio)}–${esc(prova.hora_fim)}</p>
            </div>
            <span class="aluno-status ${esc(prova.estado)}">${esc(SITUACAO[prova.estado])}</span>
            ${prova.estado === 'aberta' ? `<button type="button" class="btn btn-aluno" data-prova="${Number(prova.id)}">Iniciar prova</button>` : ''}
        </article>
    `).join('') || `<div class="aluno-vazio">${avaliacoes.length ? 'Nenhuma avaliação nesta situação.' : 'Nenhuma avaliação cadastrada para sua turma.'}</div>`;
}

async function carregarProvas() {
    avaliacoes = await api('/api/aluno/provas');
    renderizarAvaliacoes();
}

// Filtra localmente, sem alterar os dados cadastrados.
document.getElementById('filtro-avaliacoes').addEventListener('change', renderizarAvaliacoes);

// Evita abandonar uma prova em andamento pelo menu.
document.getElementById('menu-avaliacoes').addEventListener('click', () => {
    if (document.getElementById('sec-prova').classList.contains('active-section')) {
        return;
    }
    mostrarSecao('sec-lista');
});

async function abrirProva(id) {
  const mensagemLista = document.getElementById('mensagem-lista');
  let prova;
  try {
    prova = await api(`/api/aluno/prova?id=${id}`);
  } catch (erro) {
    mostrarMensagem(mensagemLista, erro.message);
    return carregarProvas();
  }
  mostrarMensagem(mensagemLista, '');
  provaAtual = id;
  saidas = prova.saidas || 0;
  usouTelaCheia = Boolean(document.fullscreenElement);
  saiuDaAba = false;
  ultimoAviso = saidas;
  document.getElementById('total-saidas').textContent = saidas;
  document.getElementById('titulo-prova').textContent = prova.titulo;
  document.getElementById('questoes-prova').innerHTML = prova.questoes.map((q, i) => `
    <fieldset class="questao-bloco">
      <legend>Questão ${i + 1}</legend>
      <p class="enunciado-prova">${esc(q.enunciado)}</p>
      ${q.alternativas.map((texto, j) => {
        const letra = 'ABCDE'[j];
        return `<label class="opcao-item opcao-aluno">
          <input type="radio" name="${q.id}" value="${letra}">
          <span class="letra">${letra})</span> <span>${esc(texto)}</span>
        </label>`;
      }).join('')}
    </fieldset>`).join('');
  document.getElementById('botao-enviar').disabled = false;
  mostrarSecao('sec-prova');
  clearInterval(vigilancia);
  vigilancia = setInterval(vigiarAvaliacao, 1000);
  verificarFoco();

  // Contagem regressiva pelo relógio do servidor: adiantar o relógio do PC não muda nada.
  const diferenca = prova.agora - Date.now();
  const timer = document.getElementById('timer');
  clearInterval(relogio);
  const atualizar = () => {
    const restante = prova.fim - (Date.now() + diferenca);
    if (restante <= 0) {
      clearInterval(relogio);
      timer.textContent = 'Tempo esgotado';
      enviarProva(true);
      return;
    }
    const s = Math.floor(restante / 1000);
    timer.textContent = `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  relogio = setInterval(atualizar, 1000);
  atualizar();
}

// ponytail: respostas ficam só na tela até o envio; recarregar a página perde as marcações.
// Se isso virar problema, salvar cada clique no servidor (autosave) como no handoff.
async function enviarProva(automatico) {
  if (enviando || provaAtual === null) {
    return;
  }
  const form = document.getElementById('form-respostas');
  const total = document.querySelectorAll('#questoes-prova .questao-bloco').length;
  const marcadas = [...form.querySelectorAll('input[type="radio"]:checked')];
  if (!automatico) {
    if (modal.open) {
        return;
    }
    const confirmado = await abrirModal({
        titulo: 'Finalizar avaliação?',
        texto: 'Após o envio, não será possível alterar suas respostas.',
        confirmar: 'Enviar prova',
        cancelar: 'Continuar prova',
        total,
        marcadas: marcadas.length,
    });
    if (!confirmado || enviando || provaAtual === null) {
        return;
    }
  }
  await filaFoco;
  if (enviando || provaAtual === null || saiuDaAba) return;
  enviando = true;
  fecharModal();
  const botao = document.getElementById('botao-enviar');
  botao.disabled = true;
  const mensagem = document.getElementById('mensagem-prova');
  try {
    await api('/api/aluno/enviar', {
      provaId: provaAtual,
      respostas: Object.fromEntries(marcadas.map((campo) => [campo.name, campo.value])),
    });
    clearInterval(relogio);
    clearInterval(vigilancia);
    provaAtual = null;
    if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
    }
    mostrarMensagem(document.getElementById('mensagem-lista'), 'Prova enviada! O professor vai divulgar o resultado.', true);
    mostrarSecao('sec-lista');
    carregarProvas();
  } catch (erro) {
    mostrarMensagem(mensagem, `${erro.message} Tente enviar de novo.`);
    botao.disabled = false;
  } finally {
    enviando = false;
  }
}

document.getElementById('form-respostas').addEventListener('submit', (evento) => {
  evento.preventDefault();
  enviarProva(false);
});

// Atualiza a lista sem interromper uma avaliação em andamento.
document.getElementById('botao-sair').addEventListener('click', async () => {
    if (provaAtual !== null) {
        const confirmado = await abrirModal({
            titulo: 'Sair da avaliação?',
            texto: 'As respostas ainda não enviadas serão perdidas.',
            confirmar: 'Sair mesmo assim',
            cancelar: 'Continuar prova',
        });
        if (!confirmado || enviando) {
            return;
        }
        provaAtual = null;
        clearInterval(relogio);
        clearInterval(vigilancia);
    }
    sair();
});

exigirPapel('aluno').then(async (eu) => {
    document.getElementById('turma-aluno').textContent = eu.turma || 'Turma não informada';
    document.getElementById('avatar-aluno').textContent = (eu.nome || 'E').trim().charAt(0).toUpperCase();
    await carregarProvas();
    setInterval(() => {
        if (document.getElementById('sec-lista').classList.contains('active-section')) {
            carregarProvas().catch(() => {});
        }
    }, 15000);
}).catch((erro) => {
    mostrarMensagem(document.getElementById('mensagem-lista'), erro.message);
});

// Abre somente as provas disponibilizadas pelo servidor.
document.getElementById('lista-provas').addEventListener('click', async (evento) => {
    const botao = evento.target.closest('[data-prova]');
    if (!botao || abrindo || provaAtual !== null) {
        return;
    }
    abrindo = true;
    botao.disabled = true;
    try {
        await solicitarTelaCheia();
        await abrirProva(Number(botao.dataset.prova));
        if (provaAtual === null && document.fullscreenElement) {
            await document.exitFullscreen();
        }
    } catch (erro) {
        mostrarMensagem(document.getElementById('mensagem-lista'), erro.message);
    } finally {
        abrindo = false;
        botao.disabled = false;
    }
});

