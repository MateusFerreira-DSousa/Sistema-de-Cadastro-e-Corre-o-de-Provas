/* =========================================
   ELEMENTOS DA TELA DE IMPRESSÃO
   ========================================= */

const folha = document.getElementById('folha');
const campoGabarito = document.getElementById('incluirGabarito');
const botaoImprimir = document.getElementById('botaoImprimir');
const botaoWord = document.getElementById('botaoWord');
const caixaMensagem = document.getElementById('mensagem');
const resumoProva = document.getElementById('resumoProva');
const linkVoltarPainel = document.getElementById('linkVoltarPainel');

let prova = null;

/* =========================================
   MONTA A PRÉVIA DA FOLHA DE PROVA
   ========================================= */
function montarFolha() {
    // Mantém número e enunciado na mesma linha, sem espaços do template.
    const questoes = prova.questoes
        .map((questao, indice) => {
            const alternativas = questao.alternativas
                .map((alternativa, indiceAlternativa) => `
                    <p class="alternativa-impressao">(${'ABCDE'[indiceAlternativa]}) ${esc(alternativa)}</p>
                `)
                .join('');

            return `
                <div class="questao-impressao">
                    <p class="enunciado-impressao"><strong>${indice + 1}.</strong> ${esc(questao.enunciado.trim())}</p>

                    ${alternativas}
                </div>
            `;
        })
        .join('');

    const gabarito = campoGabarito.checked
        ? `
            <div class="gabarito-impressao">
                <h2>
                    Gabarito — ${esc(prova.titulo)} (${esc(prova.turma)})
                </h2>

                ${prova.questoes
                    .map((questao, indice) => `
                        <p>${indice + 1}. ${questao.correta}</p>
                    `)
                    .join('')}
            </div>
        `
        : '';

    folha.innerHTML = `
        <h1 class="titulo-prova">${esc(prova.titulo)}</h1>

        <table class="cabecalho-impressao">
            <tr>
                <td colspan="2">Escola:</td>
            </tr>

            <tr>
                <td colspan="2">Aluno(a):</td>
            </tr>

            <tr>
                <td>Turma: ${esc(prova.turma)}</td>
                <td>Data: ${dataBr(prova.data)}</td>
            </tr>
        </table>

        ${questoes}
        ${gabarito}
    `;
}

/* =========================================
   ATUALIZA O RESUMO VISUAL NO TOPO
   ========================================= */
function montarResumoVisual() {
    resumoProva.innerHTML = `
        <div class="mini-card-info">
            <span class="mini-card-info__rotulo">Turma</span>
            <strong class="mini-card-info__valor">${esc(prova.turma)}</strong>
        </div>

        <div class="mini-card-info">
            <span class="mini-card-info__rotulo">Data</span>
            <strong class="mini-card-info__valor">${dataBr(prova.data)}</strong>
        </div>

        <div class="mini-card-info">
            <span class="mini-card-info__rotulo">Questões</span>
            <strong class="mini-card-info__valor">${prova.questoes.length}</strong>
        </div>
    `;
}

/* =========================================
   GERA O ARQUIVO WORD
   Observação: o Word abrirá um HTML salvo como .doc
   ========================================= */
function baixarWord() {
    const css = Array.from(document.getElementById('estilo-folha').sheet.cssRules, (regra) => regra.cssText).join('\n');

    const html = `
        <html
            xmlns:o="urn:schemas-microsoft-com:office:office"
            xmlns:w="urn:schemas-microsoft-com:office:word"
        >
            <head>
                <meta charset="utf-8">
                <title>${esc(prova.titulo)}</title>
                <style>${css}</style>
            </head>

            <body>
                <div class="folha-impressao">
                    ${folha.innerHTML}
                </div>
            </body>
        </html>
    `;

    const link = document.createElement('a');

    link.href = URL.createObjectURL(
        new Blob(
            ['\ufeff', html],
            {
                type: 'application/msword'
            }
        )
    );

    link.download = `${prova.titulo.replace(/[\\/:*?"<>|]/g, '').trim() || 'prova'}.doc`;
    link.click();

    setTimeout(() => {
        URL.revokeObjectURL(link.href);
    }, 1000);
}

/* =========================================
   EVENTOS DE INTERAÇÃO
   ========================================= */
campoGabarito.addEventListener('change', montarFolha);
botaoImprimir.addEventListener('click', () => window.print());
botaoWord.addEventListener('click', baixarWord);

/* =========================================
   INICIALIZAÇÃO DA PÁGINA
   ========================================= */
exigirPapel('professor', 'superadmin').then(async (usuario) => {
    try {
        const idProva = new URLSearchParams(location.search).get('id');

        /* Define o destino do botão de voltar conforme o papel. */
        linkVoltarPainel.href = PAGINA_INICIAL[usuario.role] || '/pasta_inicio/index.html';

        prova = await api(`/api/prova?id=${idProva}`);

        document.title = `${prova.titulo} - Imprimir`;

        montarResumoVisual();
        montarFolha();
    } catch (erro) {
        mostrarMensagem(caixaMensagem, erro.message);
    }
});
