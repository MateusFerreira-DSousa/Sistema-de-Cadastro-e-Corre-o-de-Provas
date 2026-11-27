// Navegação do painel e eventos do formulário, separados do HTML.
document.querySelectorAll('.menu-btn[data-secao]').forEach((botao) => {
    botao.addEventListener('click', () => {
        if (botao.dataset.secao === 'sec-nova-prova') {
            abrirNovaProva();
        } else {
            mostrarSecao(botao.dataset.secao);
            if (botao.dataset.secao === 'sec-resultados') {
                carregarResultados(document.getElementById('selectProva').value);
            }
        }
    });
});
document.getElementById('nova-prova-topo').addEventListener('click', () => abrirNovaProva());
document.getElementById('botao-sair').addEventListener('click', sair);
document.getElementById('botao-add-questao').addEventListener('click', () => adicionarQuestao());
document.getElementById('botao-cancelar-edicao').addEventListener('click', () => abrirNovaProva(true));
document.getElementById('selectProva').addEventListener('change', (evento) => carregarResultados(evento.target.value));

// Carregamento e gerenciamento das avaliações.
let provas = [];
// Permissão de edição definida pela sessão autenticada.
let podeEditar = false;

async function carregarProvas() {
    provas = await api('/api/provas');
    document.getElementById('lista-provas').innerHTML = provas.map((p) => `
        <tr>
            <td>${esc(p.titulo)}</td>
            <td>${esc(p.turma)}</td>
            <td>${dataBr(p.data)}</td>
            <td>${p.hora_inicio}–${p.hora_fim}</td>
            <td>${p.total_questoes}</td>
            <td>${p.enviadas}</td>
            <td class="acoes">
                ${podeEditar ? `<button type="button" class="btn btn-sm btn-secondary" data-acao="editar" data-id="${p.id}">Editar</button>` : ''}
                <button type="button" class="btn btn-sm btn-secondary" data-acao="resultados" data-id="${p.id}">Resultados</button>
                <a class="btn btn-sm btn-secondary" href="/pasta_impressao/imprimir.html?id=${p.id}" target="_blank">Imprimir</a>
                ${podeEditar ? `<button type="button" class="btn btn-sm btn-perigo" data-acao="excluir" data-id="${p.id}">Excluir</button>` : ''}
            </td>
        </tr>`).join('') || '<tr><td colspan="7">Nenhuma prova cadastrada ainda.</td></tr>';

    document.getElementById('selectProva').innerHTML = provas.map((p) =>
        `<option value="${p.id}">${esc(p.titulo)} — ${esc(p.turma)} (${dataBr(p.data)})</option>`).join('');
}

async function excluirProva(id) {
    if (!podeEditar) return;
    const prova = provas.find((p) => p.id === id);
    if (!confirm(`Excluir a prova "${prova.titulo}"? As respostas e notas dos alunos também serão apagadas.`)) return;
    try {
        await api('/api/provas/excluir', { id });
        carregarProvas();
    } catch (erro) {
        alert(erro.message);
    }
}

function verResultados(id) {
    document.getElementById('selectProva').value = id;
    carregarResultados(id);
    mostrarSecao('sec-resultados');
}

async function carregarResultados(id) {
    if (!id) return;
    const { alunos } = await api(`/api/resultados?prova=${id}`);
    const enviadas = alunos.filter((a) => a.enviada_em);
    const media = enviadas.reduce((soma, a) => soma + a.nota, 0) / enviadas.length;
    document.getElementById('media').textContent = enviadas.length ? media.toFixed(1) : '—';
    document.getElementById('enviadas').textContent = `${enviadas.length} de ${alunos.length}`;
    document.getElementById('lista-resultados').innerHTML = alunos.map((a) => `
        <tr>
            <td>${esc(a.nome)}</td>
            <td>${a.cancelamento ? `Cancelada — ${esc(a.cancelamento)}` : a.enviada_em ? 'Enviada' : 'Não enviou'}</td>
            <td>${a.enviada_em ? `<span class="nota ${a.nota >= 6 ? 'nota-alta' : 'nota-baixa'}">${a.nota.toFixed(1)}</span>` : '—'}</td>
        </tr>`).join('') || '<tr><td colspan="3">Nenhum aluno cadastrado nessa turma.</td></tr>';
}

// ---------- Formulário de nova prova ----------
let contadorQuestoes = 0;

// Sem argumento cria questão em branco; com questão (vinda da edição) já preenche.
function adicionarQuestao(questao) {
    const n = ++contadorQuestoes; // só para nomes únicos dos radios
    const bloco = document.createElement('fieldset');
    bloco.className = 'questao-bloco';
    if (questao) bloco.dataset.id = questao.id;
    bloco.innerHTML = `
        <legend></legend>
        <div class="form-group">
            <textarea class="enunciado" rows="3" placeholder="Enunciado da questão" aria-label="Enunciado" required></textarea>
        </div>
        <p class="help-text">Marque a bolinha da alternativa correta.</p>
        ${['A', 'B', 'C', 'D', 'E'].map((letra) => `
            <div class="opcao-item">
                <input type="radio" name="correta-${n}" value="${letra}" aria-label="${letra} é a correta" required>
                <span class="letra">${letra})</span>
                <input type="text" class="form-control alternativa" placeholder="Texto da alternativa ${letra}" aria-label="Alternativa ${letra}" required>
            </div>`).join('')}
        <button type="button" class="btn btn-sm btn-perigo botao-remover" data-remover-questao>Remover questão</button>`;
    if (questao) {
        bloco.querySelector('.enunciado').value = questao.enunciado;
        bloco.querySelectorAll('.alternativa').forEach((campo, i) => { campo.value = questao.alternativas[i]; });
        bloco.querySelector(`input[value="${questao.correta}"]`).checked = true;
    }
    document.getElementById('questoes').append(bloco);
    numerarQuestoes();
}

function numerarQuestoes() {
    document.querySelectorAll('.questao-bloco legend').forEach((legenda, i) => { legenda.textContent = `Questão ${i + 1}`; });
}

const formProva = document.getElementById('form-prova');
let provaEditando = null; // id da prova em edição; null = criando nova

// Volta o formulário para "Nova Prova". Só limpa se estava editando (ou se pedido),
// para não apagar uma prova nova que o professor ainda está digitando.
function abrirNovaProva(limpar = false) {
    if (!podeEditar) return;
    if (provaEditando || limpar) {
        provaEditando = null;
        formProva.reset();
        formProva.querySelectorAll('input, select, textarea').forEach((campo) => { campo.disabled = false; });
        document.getElementById('questoes').innerHTML = '';
        adicionarQuestao();
        ajustarModoEdicao(false, false);
    }
    mostrarMensagem(document.getElementById('mensagem-prova'), '');
    mostrarSecao('sec-nova-prova');
}

function ajustarModoEdicao(editando, soGabarito) {
    document.getElementById('titulo-form-prova').textContent = editando ? 'Editar prova' : 'Nova prova';
    document.getElementById('botao-cancelar-edicao').hidden = !editando;
    document.getElementById('aviso-edicao').hidden = !soGabarito;
    document.getElementById('botao-add-questao').hidden = soGabarito;
    document.querySelectorAll('.botao-remover').forEach((botao) => { botao.hidden = soGabarito; });
}

async function editarProva(id) {
    if (!podeEditar) return;
    let prova;
    try {
        prova = await api(`/api/prova?id=${id}`);
    } catch (erro) {
        return alert(erro.message);
    }
    provaEditando = id;
    for (const campo of ['titulo', 'turma', 'data', 'hora_inicio', 'hora_fim']) formProva.elements[campo].value = prova[campo];
    document.getElementById('questoes').innerHTML = '';
    prova.questoes.forEach(adicionarQuestao);
    const soGabarito = prova.enviadas > 0;
    // Com envios, trava tudo menos as bolinhas do gabarito.
    formProva.querySelectorAll('input, select, textarea').forEach((campo) => {
        campo.disabled = soGabarito && campo.type !== 'radio';
    });
    ajustarModoEdicao(true, soGabarito);
    mostrarMensagem(document.getElementById('mensagem-prova'), '');
    mostrarSecao('sec-nova-prova');
}

formProva.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    if (!podeEditar) return;
    const mensagem = document.getElementById('mensagem-prova');
    const prova = Object.fromEntries(['titulo', 'turma', 'data', 'hora_inicio', 'hora_fim'].map((campo) => [campo, formProva.elements[campo].value]));
    prova.questoes = [...document.querySelectorAll('.questao-bloco')].map((bloco) => ({
        enunciado: bloco.querySelector('.enunciado').value,
        alternativas: [...bloco.querySelectorAll('.alternativa')].map((campo) => campo.value),
        correta: bloco.querySelector('input[type="radio"]:checked')?.value,
        id: Number(bloco.dataset.id) || undefined,
    }));
    try {
        if (provaEditando) {
            const { soGabarito } = await api('/api/provas/editar', { id: provaEditando, ...prova });
            abrirNovaProva(true);
            mostrarMensagem(mensagem, soGabarito
                ? 'Gabarito atualizado e notas recalculadas. (Como alunos já enviaram, só o gabarito foi alterado.)'
                : 'Prova atualizada com sucesso.', true);
        } else {
            await api('/api/provas', prova);
            abrirNovaProva(true);
            mostrarMensagem(mensagem, 'Prova salva com sucesso.', true);
        }
        carregarProvas();
    } catch (erro) {
        mostrarMensagem(mensagem, erro.message);
    }
});

exigirPapel('professor', 'superadmin').then(async (eu) => {
    document.getElementById('link-admin').hidden = eu.role !== 'superadmin';
    document.getElementById('titulo-lista').textContent = eu.role === 'superadmin' ? 'Todas as provas' : 'Minhas provas';
    podeEditar = eu.role === 'professor';
    document.querySelectorAll('[data-professor]').forEach((elemento) => {
        elemento.hidden = !podeEditar;
    });
    if (podeEditar) {
        adicionarQuestao();
        const turmas = await api('/api/turmas');
        document.getElementById('idTurma').innerHTML += turmas.map((t) => `<option>${esc(t)}</option>`).join('');
    }
    await carregarProvas();
    carregarResultados(document.getElementById('selectProva').value);
});

// Trata ações de linhas e questões criadas dinamicamente.
document.getElementById('lista-provas').addEventListener('click', (evento) => {
    const botao = evento.target.closest('button[data-acao]');
    if (!botao) return;
    const id = Number(botao.dataset.id);
    const acoes = { editar: editarProva, resultados: verResultados, excluir: excluirProva };
    acoes[botao.dataset.acao]?.(id);
});
document.getElementById('questoes').addEventListener('click', (evento) => {
    const botao = evento.target.closest('[data-remover-questao]');
    if (!botao) return;
    botao.closest('fieldset').remove();
    numerarQuestoes();
});

