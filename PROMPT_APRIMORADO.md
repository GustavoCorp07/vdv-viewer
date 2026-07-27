# VdvView 3D — Especificação AAA (Prompt Aprimorado)

> Sistema web profissional de visualização e manipulação de projetos 3D no formato STEP (.step/.stp),
> voltado a ambiente corporativo de manufatura (marcenaria/mobiliário industrial), com UX no padrão
> SolidWorks / TopSolid Wood e recursos exclusivos que nenhum concorrente oferece.

---

## 1. Núcleo de importação STEP (motor geométrico real)

- **Motor**: OpenCASCADE Technology compilado para WebAssembly (`occt-import-js`) — o mesmo kernel
  geométrico usado por softwares CAD profissionais. Parsing 100% no navegador, sem servidor,
  sem upload do arquivo do cliente (privacidade total do projeto).
- **Parsing em Web Worker**: o arquivo é processado em thread separada — a interface nunca congela,
  mesmo com montagens grandes. Overlay de carregamento com progresso e nome do arquivo.
- **Importação fiel de propriedades**:
  - Nome de cada componente/peça (lido da estrutura de produtos do STEP);
  - Hierarquia completa da montagem (árvore de submontagens e peças);
  - Cores originais do arquivo (com paleta profissional de fallback quando o arquivo não tem cor);
  - Unidades normalizadas para **milímetros**;
  - Dimensões exatas por peça via **OBB (Oriented Bounding Box)** calculada por análise dos
    vetores normais dominantes da malha: **Comprimento × Largura × Espessura** reais em mm,
    mesmo para peças rotacionadas no espaço;
  - **M² por peça** (Comprimento × Largura da maior face — métrica padrão de plano de corte).
- **Cada componente é um objeto independente** (nunca um bloco único): clicável, ocultável,
  movível, com material e destaque próprios.
- Abertura por botão "Abrir STEP" **e por arrastar-e-soltar** o arquivo na viewport.

## 2. Interface ultraprofissional (padrão SolidWorks)

- **CommandManager (ribbon)** no topo com grupos: Arquivo, Exibir, Ferramentas, Análise;
- **FeatureManager (árvore de montagem)** à esquerda: hierarquia completa, ícone de olho por
  componente (mostrar/ocultar), busca com filtro instantâneo, seleção sincronizada com a viewport,
  duplo clique dá zoom na peça;
- **Viewport** com fundo degradê clássico de CAD, sombreamento com arestas visíveis
  (modo "Shaded with Edges" do SolidWorks), tríade de eixos XYZ no canto inferior esquerdo;
- **Barra de status** inferior com dicas de contexto, peça selecionada e resultados de medição;
- **Barra de Layers 0–20** na parte inferior (padrão TopSolid Wood);
- Destaque **laranja ao passar o mouse** e **verde ao selecionar** (convenção SolidWorks);
- Botões de orientação de vista: Isométrica, Frente, Trás, Esquerda, Direita, Topo, Base + Zoom Ajustar.

## 3. Navegação 3D (modelo SolidWorks)

- **Botão do meio (scroll) pressionado + arrastar = Orbitar** (em torno do ponto sob o cursor);
- **Ctrl + botão do meio = Pan** (planar);
- **Shift + botão do meio = Zoom** por arrasto;
- **Scroll = Zoom direcionado ao cursor**;
- **Botão esquerdo = Selecionar** componente;
- **F = Zoom Ajustar (fit)**; duplo clique na árvore enquadra a peça;
- Câmera perspectiva, eixo Z para cima (padrão de projeto de mobiliário).

## 4. Sistema de Layers (mecânica TopSolid Wood)

- Barra numérica **0 a 20** fixa na parte inferior;
- **Clique direito** em um número → abre diálogo pedindo o **nome da layer**;
- **Com o diálogo aberto**, o usuário clica com o **botão esquerdo** nos componentes da montagem
  (na viewport ou na árvore) para adicioná-los àquela layer — a lista de membros aparece ao vivo
  no diálogo; clicar de novo remove; cada peça pertence a uma única layer;
- **OK** confirma nome + membros; Cancelar descarta;
- **Clique esquerdo** sobre o número da layer → **ativa/desativa**:
  **layer ativada = componentes visíveis; desativada = ocultos**;
- Indicadores visuais: layer com conteúdo (badge com contagem), ativa (acesa), inativa (apagada
  com risco), tooltip com o nome.

## 5. Modo Propriedades

- Botão "Propriedades" no ribbon ativa o modo;
- Clique em qualquer componente → painel flutuante exibe:
  **Nome da peça, Comprimento (mm), Largura (mm), Espessura (mm), M² da peça, Volume (dm³),
  posição atual XYZ (mm), layer e cor**;
- Todas as medidas em milímetros com precisão de 0,1 mm; M² com 3 casas.

## 6. Movimentação de componentes

- Modo "Mover": clique na peça → **gizmo de translação 3D** (setas X vermelha / Y verde / Z azul);
- Painel de eixos permite **restringir o movimento a X, Y ou Z** individualmente, além de
  deslocamento numérico digitado (mm) para posicionamento exato;
- **Ctrl+Z** desfaz cada movimento (pilha de undo ilimitada);
- Botão **"Restaurar posições"** retorna todos os componentes à posição original do projeto.

## 7. Cinemática de Explosão Automática Inteligente (IA)

Motor de **planejamento automático de sequência de desmontagem** — o mesmo problema que
softwares AAA resolvem com "assembly sequence planning":

- **Direção inteligente por peça**: cada componente analisa sua própria geometria (OBB) e escolhe
  explodir ao longo do **eixo da sua espessura** (normal do painel — porta sai para frente, lateral
  para o lado, tampo para cima), com o sentido apontando para fora do centro da montagem;
- **Zero colisões**: teste de varredura AABB do caminho completo de cada peça contra todas as
  outras — peças com caminho livre saem primeiro (ondas), o planejador recalcula a cena após cada
  onda e resolve conflitos encurtando distâncias ou trocando o eixo (efeito telescópio para peças
  no mesmo eixo);
- **Câmera cinematográfica automática**: durante a explosão a câmera **orbita continuamente**,
  varia a elevação em onda suave, e aplica **zoom dinâmico** que reenquadra a cena conforme ela
  cresce — tudo com easing profissional;
- Ao final: **slider de explosão** para revisitar qualquer estágio manualmente, botão **Recolher**
  e **Replay**; animação pode ser pulada a qualquer momento;
- Explosão é independente da movimentação manual (não polui o Ctrl+Z).

## 8. Recursos exclusivos (diferenciais que os concorrentes não têm)

1. **Plano de Corte Automático (BOM inteligente)**: um clique gera a tabela de corte completa —
   agrupa peças idênticas, mostra Qtde × Nome × Comprimento × Largura × Espessura × M² unitário e
   total — e **exporta CSV pronto para Excel BR** (separador `;`, decimal vírgula). Nenhum viewer
   web faz isso a partir de um STEP.
2. **Detecção de Interferências**: análise de sobreposição entre todos os pares de componentes com
   relatório clicável (clicou → destaca as duas peças em vermelho) — recurso de SolidWorks Premium,
   aqui grátis no navegador.
3. **Medição ponto-a-ponto**: distância real em mm entre dois pontos clicados na geometria, com
   ΔX/ΔY/ΔZ decompostos e etiqueta 3D flutuante.
4. **Vista de Seção dinâmica**: plano de corte X/Y/Z com slider ao vivo e inversão de lado —
   enxergue o interior do móvel montado.
5. **Isolar & Raio-X**: isole qualquer componente (oculta o resto) ou ative transparência
   fantasma para ver peças internas através das externas.
6. **Captura profissional**: screenshot PNG em alta resolução da viewport com um clique.
7. **Modelo de demonstração embutido** (gabinete paramétrico) para testar tudo sem ter um STEP à mão.
8. **100% offline-first**: depois de carregado, funciona sem internet; o arquivo do cliente nunca
   sai da máquina.

## 9. Stack técnica

| Camada | Tecnologia | Papel |
|---|---|---|
| Kernel CAD | OpenCASCADE (WASM) via `occt-import-js` | Parsing STEP real, tesselação, hierarquia |
| Render | Three.js (WebGL) | Viewport, materiais, arestas, gizmos |
| Threading | Web Worker | Parsing sem travar a UI |
| Build | Vite | Dev server + bundle de produção |
| UI | HTML/CSS puro, design system próprio | Zero peso de framework, visual SolidWorks |

## 10. Critérios de aceitação

- Abrir um .step de montagem → árvore com todos os componentes nomeados e separados;
- Todas as 7 funcionalidades pedidas operando conforme descrito acima;
- Nenhum erro no console em fluxo normal;
- Interface responsiva ao redimensionar; performance fluida (60 fps alvo) em montagens típicas;
- Testado de ponta a ponta no navegador com o modelo de demonstração.
