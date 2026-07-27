# VdvView 3D

**🌐 Use agora: [fluxoraswap-hub.github.io/vdvview-3d](https://fluxoraswap-hub.github.io/vdvview-3d/)**

Visualizador profissional de projetos **STEP (.step/.stp)** que roda 100% no navegador —
parsing com kernel **OpenCASCADE (WebAssembly)**, render **Three.js**, interface no padrão
**SolidWorks** e layers no padrão **TopSolid Wood**.

O arquivo do cliente **nunca sai da máquina**: todo o processamento é local.

## Funcionalidades

- **Importação STEP fiel**: cada componente separado e clicável, nomes, cores, hierarquia
  da montagem e medidas exatas em mm (Comprimento × Largura × Espessura via OBB + M²);
- **Layers 0–20** (mecânica TopSolid): clique esquerdo nomeia, botão direito nos componentes
  adiciona, botão direito no número ativa/desativa;
- **Modo Propriedades**: todos os dados da peça em um clique;
- **Mover componentes**: gizmo X/Y/Z, deslocamento numérico, Ctrl+Z e restaurar posições;
- **Explosão IA**: planejamento automático de desmontagem sem colisões com câmera
  cinematográfica (órbita + zoom dinâmico), slider de estágio, replay;
- **Navegação SolidWorks**: botão do meio orbita, Ctrl+meio pan, Shift+meio/scroll zoom;
- **Plano de Corte automático** (BOM) com exportação CSV para Excel BR;
- **Detecção de Interferências**, **medição ponto-a-ponto**, **vista de seção**,
  **isolar/raio-X**, **captura PNG** e **modelo de demonstração** embutido.

## Como rodar

```bash
npm install
npm run setup:vendor   # copia o runtime OpenCASCADE (WASM) para public/vendor
npm run gen:demo       # gera o modelo de demonstração
npm run dev            # abre em http://localhost:5173
```

Build de produção: `npm run build` (saída em `dist/`, hospedável em qualquer servidor estático).

## Estrutura

| Caminho | Papel |
|---|---|
| `src/main.js` | Orquestrador: modos, seleção, eventos, arquivos |
| `src/viewer.js` | Cena 3D, luzes, picking, tríade, seção, captura |
| `src/controls.js` | Navegação padrão SolidWorks |
| `src/loader.js` | Parsing STEP em Web Worker (fallback main-thread) |
| `src/model.js` | Componentes independentes, árvore, visibilidade |
| `src/obb.js` | Dimensões reais por OBB (normais dominantes) |
| `src/layers.js` | Layers 0–20 (mecânica TopSolid Wood) |
| `src/movetool.js` | Gizmo de translação, undo, restaurar |
| `src/explode.js` | Explosão IA (planejador de desmontagem + câmera) |
| `src/measure.js` / `src/bom.js` | Medição, plano de corte, interferências |
| `src/ui.js` / `src/properties.js` | Ribbon, árvore, modais, propriedades |
| `scripts/` | Vendor WASM, gerador e validador do modelo demo |

Especificação completa: [PROMPT_APRIMORADO.md](PROMPT_APRIMORADO.md).
