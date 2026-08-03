// Constrói os componentes independentes a partir do resultado do OpenCASCADE:
// geometria, arestas, nomes, hierarquia, dimensões via OBB e visibilidade.
import * as THREE from 'three';
import { computeOBB } from './obb.js';

// Paleta industrial de fallback (quando o STEP não traz cores)
const PALETTE = [
  0xb9c2cc, 0xcdb99a, 0x9db3c8, 0xc4ad8f, 0xa8b8a5,
  0xbfa9a1, 0x99a8b8, 0xd0c4a2, 0xa5adb9, 0xc0b4c4,
  0x8fa6b5, 0xcbb8a6
];

// Nomes genéricos que o kernel dá a shapes sem nome próprio
const GENERIC_NAMES = /^(solid|shell|compound|compsolid|face|shape|open casc.*)$/i;

export const isGenericName = (n) => !n || GENERIC_NAMES.test(n.trim());

// ---- Material MDF ----
// Espessuras comerciais de chapa: peças com essas espessuras são MDF.
export const MDF_THICKNESSES = [3, 6, 9, 15, 18, 25];
export const MDF_TOLERANCE = 0.35;  // mm
export const MDF_DENSITY = 750;     // kg/m³ (MDF padrão)

let nextId = 1;

export class Component {
  constructor(meshData, meshIndex, fallbackName, realName) {
    this.id = nextId++;
    const rawName = (meshData.name || '').trim();
    this.baseName = realName ||
      (!isGenericName(rawName) ? rawName : null) ||
      fallbackName || `Peça ${meshIndex + 1}`;
    this.name = this.baseName; // pode ganhar sufixo (n) na desambiguação
    this.meshIndex = meshIndex;

    // --- Geometria ---
    const posArr = Float32Array.from(meshData.attributes.position.array);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    let idxArr = null;
    if (meshData.index && meshData.index.array) {
      idxArr = posArr.length / 3 > 65535
        ? Uint32Array.from(meshData.index.array)
        : Uint16Array.from(meshData.index.array);
      geometry.setIndex(new THREE.BufferAttribute(idxArr, 1));
    }
    if (meshData.attributes.normal && meshData.attributes.normal.array) {
      geometry.setAttribute('normal',
        new THREE.BufferAttribute(Float32Array.from(meshData.attributes.normal.array), 3));
    } else {
      geometry.computeVertexNormals();
    }
    geometry.computeBoundingBox();

    // --- Cor ---
    // 1º cor do sólido; 2º cor dominante das faces (brep_faces — padrão em
    // exports TopSolid/SolidWorks); 3º paleta de fallback.
    let colorArr = Array.isArray(meshData.color) && meshData.color.length === 3
      ? meshData.color : null;
    if (!colorArr && Array.isArray(meshData.brep_faces)) {
      const weightByColor = new Map();
      for (const f of meshData.brep_faces) {
        if (!f || !Array.isArray(f.color)) continue;
        const key = f.color.join(',');
        weightByColor.set(key,
          (weightByColor.get(key) || 0) + (f.last - f.first + 1));
      }
      let bestKey = null, bestW = -1;
      for (const [k, w] of weightByColor) {
        if (w > bestW) { bestW = w; bestKey = k; }
      }
      if (bestKey) colorArr = bestKey.split(',').map(Number);
    }
    // cores STEP são sRGB: converter explicitamente para o espaço de trabalho
    this.baseColor = colorArr
      ? new THREE.Color().setRGB(colorArr[0], colorArr[1], colorArr[2], THREE.SRGBColorSpace)
      : new THREE.Color(PALETTE[meshIndex % PALETTE.length]);

    // --- Objetos 3D ---
    // material físico: reage ao ambiente HDR com verniz sutil de fábrica
    const material = new THREE.MeshPhysicalMaterial({
      color: this.baseColor.clone(), // instância Color = já no espaço de trabalho
      roughness: 0.55,
      metalness: 0.02,
      clearcoat: 0.18,
      clearcoatRoughness: 0.6,
      envMapIntensity: 1.0,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.userData.comp = this;

    this.edgeMaterial = new THREE.LineBasicMaterial({ color: 0x252b32 });
    this.edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 28), this.edgeMaterial);
    this.edges.userData.comp = this;

    // material do passe de picking na GPU (cor-ID atribuída pelo ModelManager)
    this.pickMaterial = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    });

    this.group = new THREE.Group();
    this.group.add(this.mesh);
    this.group.add(this.edges);

    // --- Métricas (mm) ---
    this.aabb = geometry.boundingBox.clone(); // posição original, coords de mundo
    const obb = computeOBB(posArr, idxArr);
    this.dims = {
      c: obb.size[0],                       // Comprimento
      l: obb.size[1],                       // Largura
      e: obb.size[2],                       // Espessura
      m2: (obb.size[0] * obb.size[1]) / 1e6, // maior face em m²
      volume: obb.volume / 1e6,             // dm³ (mm³ → dm³ = /1e6)
      axes: obb.axes                        // eixos [C, L, E] (mundo)
    };
    this.center = this.aabb.getCenter(new THREE.Vector3());

    // --- Material e peso ---
    // Espessura em espessura comercial de chapa ⇒ MDF (750 kg/m³);
    // peso = volume real da malha × densidade.
    const thickness = this.dims.e;
    const match = MDF_THICKNESSES.find(
      (t) => Math.abs(thickness - t) <= MDF_TOLERANCE);
    if (match !== undefined) {
      this.material = 'MDF';
      this.nominalThickness = match;
      this.weightKg = this.dims.volume * (MDF_DENSITY / 1000); // dm³ → kg
    } else {
      this.material = null;
      this.nominalThickness = null;
      this.weightKg = null;
    }

    // --- Estado ---
    this.eyeVisible = true;
    this.layerId = null;
    this.assembly = null;
    this.textureRot = 0;
    this.userOffset = new THREE.Vector3();
    this.explodeOffset = new THREE.Vector3();
    this.treeNode = null;
  }

  /** AABB na posição atual (offsets aplicados). */
  currentAABB(out) {
    out = out || new THREE.Box3();
    out.copy(this.aabb).translate(this.group.position);
    return out;
  }

  applyTransform() {
    this.group.position.copy(this.userOffset).add(this.explodeOffset);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.edges.geometry.dispose();
    this.edgeMaterial.dispose();
    this.pickMaterial.dispose();
  }
}

export class ModelManager {
  constructor(viewer) {
    this.viewer = viewer;
    this.components = [];
    this.treeRoot = null;
    this.fileName = '';
    this.isolatedComp = null;
    this.xray = false;
    this.layerVisibilityFn = () => true; // injetado pelo sistema de layers
    this.assemblies = [];  // montagens criadas pelo usuário
    this._nextAsmId = 1;
  }

  // ---------------- Montagens ----------------
  /** Agrupa componentes numa montagem nomeada (bloco único para
   *  seleção, movimentação e explosão). Uma peça pertence a no máximo
   *  uma montagem; membros são roubados de montagens anteriores. */
  createAssembly(name, comps) {
    const asm = {
      id: this._nextAsmId++,
      name: (name || 'Montagem').trim() || 'Montagem',
      members: [],
      collapsed: false
    };
    for (const c of comps) {
      if (c.assembly) this.dissolveIfEmpty(this.removeFromAssembly(c));
      c.assembly = asm;
      asm.members.push(c);
    }
    this.assemblies.push(asm);
    return asm;
  }

  /** Acrescenta componentes a uma montagem JÁ existente. */
  addToAssembly(asm, comps) {
    for (const c of comps) {
      if (c.assembly === asm) continue;
      if (c.assembly) this.dissolveIfEmpty(this.removeFromAssembly(c));
      c.assembly = asm;
      asm.members.push(c);
    }
  }

  removeFromAssembly(comp) {
    const asm = comp.assembly;
    if (!asm) return null;
    asm.members = asm.members.filter((m) => m !== comp);
    comp.assembly = null;
    return asm;
  }

  dissolveIfEmpty(asm) {
    if (asm && asm.members.length < 2) this.dissolveAssembly(asm);
  }

  dissolveAssembly(asm) {
    if (!asm) return;
    for (const m of asm.members) m.assembly = null;
    asm.members = [];
    this.assemblies = this.assemblies.filter((a) => a !== asm);
  }

  clear() {
    for (const c of this.components) {
      this.viewer.modelGroup.remove(c.group);
      c.dispose();
    }
    this.components = [];
    this.treeRoot = null;
    this.isolatedComp = null;
    this.assemblies = [];
    this.viewer.setComponents([]);
    this.viewer.stageForModel(null);
    this.viewer.setHover(null);
    this.viewer.setSelected(null);
    this.viewer.setDanger([]);
  }

  /** Constrói componentes e árvore a partir do resultado do occt-import-js. */
  build(result, fileName) {
    this.clear();
    this.fileName = fileName;
    const meshes = result.meshes || [];
    const usedMesh = new Set();

    // Nomes reais extraídos do texto STEP (MANIFOLD_SOLID_BREP): válidos
    // quando há exatamente 1 nome por mesh, na ordem do arquivo.
    const brepNames = Array.isArray(result.brepNames) &&
      result.brepNames.length === meshes.length ? result.brepNames : null;

    const makeGroupNode = (name, parent) => ({
      type: 'group',
      name: name || 'Grupo',
      children: [],
      parent,
      collapsed: false
    });

    const rootName = fileName.replace(/\.(step|stp)$/i, '');
    this.treeRoot = makeGroupNode(rootName, null);

    const addPart = (meshIdx, parentNode, fallbackName) => {
      if (usedMesh.has(meshIdx) || !meshes[meshIdx]) return;
      usedMesh.add(meshIdx);
      const meshName = (meshes[meshIdx].name || '').trim();
      const realName = brepNames && isGenericName(meshName) &&
        brepNames[meshIdx] ? brepNames[meshIdx] : null;
      const comp = new Component(meshes[meshIdx], meshIdx, fallbackName, realName);
      this.components.push(comp);
      this.viewer.modelGroup.add(comp.group);
      const node = { type: 'part', name: comp.name, comp, parent: parentNode };
      comp.treeNode = node;
      parentNode.children.push(node);
    };

    const walk = (node, parentNode) => {
      const hasChildren = (node.children || []).length > 0;
      const meshIdxs = node.meshes || [];
      let target = parentNode;
      if (hasChildren || meshIdxs.length > 1) {
        target = makeGroupNode(node.name || 'Submontagem', parentNode);
        parentNode.children.push(target);
      }
      for (const mi of meshIdxs) addPart(mi, target, node.name);
      for (const ch of node.children || []) walk(ch, target);
    };

    if (result.root) {
      for (const mi of result.root.meshes || []) addPart(mi, this.treeRoot, result.root.name);
      for (const ch of result.root.children || []) walk(ch, this.treeRoot);
    }
    // meshes órfãs (sem nó na hierarquia)
    for (let i = 0; i < meshes.length; i++) {
      if (!usedMesh.has(i)) addPart(i, this.treeRoot, null);
    }

    // desambigua nomes repetidos: "Frente" ×3 → "Frente (1)"…"Frente (3)"
    const byName = new Map();
    for (const c of this.components) {
      if (!byName.has(c.baseName)) byName.set(c.baseName, []);
      byName.get(c.baseName).push(c);
    }
    for (const [name, list] of byName) {
      if (list.length < 2) continue;
      list.forEach((c, i) => {
        c.name = `${name} (${i + 1})`;
        if (c.treeNode) c.treeNode.name = c.name;
      });
    }

    // remove níveis de grupo com um único filho grupo (ruído comum em STEP)
    const compact = (node) => {
      for (let i = 0; i < node.children.length; i++) {
        let ch = node.children[i];
        while (ch.type === 'group' && ch.children.length === 1 &&
               ch.children[0].type === 'group') {
          ch = ch.children[0];
          ch.parent = node;
          node.children[i] = ch;
        }
        if (ch.type === 'group') compact(ch);
      }
    };
    compact(this.treeRoot);

    // cor-ID do picking e viés de profundidade anti z-fighting: faces
    // coplanares de peças encostadas ganham vencedor DETERMINÍSTICO no
    // render (e o picking, usando os mesmos offsets, enxerga igual).
    this.components.forEach((c, i) => {
      const id = i + 1;
      c.pickMaterial.color.setRGB(
        (id & 255) / 255, ((id >> 8) & 255) / 255, ((id >> 16) & 255) / 255);
      const units = 1 + (i % 12);
      c.mesh.material.polygonOffsetUnits = units;
      c.pickMaterial.polygonOffsetUnits = units;
    });

    this.viewer.setComponents(this.components);
    this.viewer.stageForModel(this.originalBox());
    this.applyVisibilityAll();
  }

  get hasModel() { return this.components.length > 0; }

  allMaterials() {
    const mats = [];
    for (const c of this.components) {
      mats.push(c.mesh.material, c.edgeMaterial, c.pickMaterial);
    }
    return mats;
  }

  computeVisible(comp) {
    if (!comp.eyeVisible) return false;
    if (!this.layerVisibilityFn(comp)) return false;
    if (this.isolatedComp && comp !== this.isolatedComp) return false;
    if (this.manualHiddenSet && this.manualHiddenSet.has(comp)) return false;
    return true;
  }

  applyVisibilityAll() {
    for (const c of this.components) {
      c.group.visible = this.computeVisible(c);
      const ghost = this.xray && !this.viewer.selectedComps.has(c);
      c.mesh.material.transparent = ghost;
      c.mesh.material.opacity = ghost ? 0.28 : 1;
      c.mesh.material.depthWrite = !ghost;
      c.edgeMaterial.transparent = ghost;
      c.edgeMaterial.opacity = ghost ? 0.35 : 1;
    }
  }

  visibleComponents() {
    return this.components.filter((c) => c.group.visible);
  }

  /** Caixa envolvente da montagem (componentes visíveis, posições atuais). */
  unionBox(visibleOnly = true) {
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    for (const c of this.components) {
      if (visibleOnly && !c.group.visible) continue;
      box.union(c.currentAABB(tmp));
    }
    return box;
  }

  /** Caixa envolvente nas posições ORIGINAIS do projeto. */
  originalBox() {
    const box = new THREE.Box3();
    for (const c of this.components) box.union(c.aabb);
    return box;
  }

  updateTransforms() {
    for (const c of this.components) c.applyTransform();
  }

  triangleCount() {
    let n = 0;
    for (const c of this.components) {
      const g = c.mesh.geometry;
      n += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
    return Math.round(n);
  }

  /** Peso total real (soma das peças MDF). */
  weightSummary() {
    let totalKg = 0, mdfCount = 0;
    for (const c of this.components) {
      if (c.weightKg != null) { totalKg += c.weightKg; mdfCount++; }
    }
    return { totalKg, mdfCount, count: this.components.length };
  }
}
