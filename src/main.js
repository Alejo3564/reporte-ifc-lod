import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { IFCLoader } from "web-ifc-three";

const WASM_PATH = "./";

const DEFAULT_MAT = new THREE.MeshLambertMaterial({
  color: 0xc8c8c8,
  side: THREE.DoubleSide,
});

// Material para cuando el IFC no tiene geometría parseable
const ERROR_MAT = new THREE.MeshLambertMaterial({
  color: 0x334155,
  side: THREE.DoubleSide,
  wireframe: false,
});

let datos = [];
const viewers = {};

// Cola de carga — máximo 4 viewers simultáneos para no saturar WebGL contexts
const loadQueue = [];
let activeLoaders = 0;
const MAX_CONCURRENT = 4;

const FILTROS = [
  { field: "codigo",   inputId: "fCod", dropId: "drop-cod", val: "" },
  { field: "elemento", inputId: "fEle", dropId: "drop-ele", val: "" },
  { field: "ifc_type", inputId: "fIfc", dropId: "drop-ifc", val: "" },
  { field: "lod",      inputId: "fLod", dropId: "drop-lod", val: "" },
];

// ─── INICIAR ─────────────────────────────────────────────────────────────────
async function iniciar() {
  const r = await fetch("./data/datos.json?v=" + Date.now());
  datos = await r.json();
  iniciarFiltros();
  renderTabla(datos);
}

// ─── FILTROS ─────────────────────────────────────────────────────────────────
function iniciarFiltros() {
  FILTROS.forEach(f => {
    const input = document.getElementById(f.inputId);
    const drop  = document.getElementById(f.dropId);
    input.addEventListener("focus",  () => { buildDrop(f, input.value); drop.classList.add("open"); });
    input.addEventListener("input",  () => { f.val = ""; buildDrop(f, input.value); drop.classList.add("open"); aplicarFiltros(); });
    input.addEventListener("blur",   () => { setTimeout(() => { drop.classList.remove("open"); if (!f.val) input.value = ""; }, 160); });
  });
  document.getElementById("btnLimpiar").addEventListener("click", limpiar);
}

function buildDrop(f, searchTerm) {
  const drop = document.getElementById(f.dropId);
  const term = (searchTerm || "").toLowerCase();
  const vals = [...new Set(datos.map(x => x[f.field]))].sort();
  drop.innerHTML = "";
  const all = document.createElement("div");
  all.className = "di rst";
  all.textContent = "— Todos —";
  all.addEventListener("mousedown", e => { e.preventDefault(); selectVal(f, ""); });
  drop.appendChild(all);
  vals.filter(v => String(v).toLowerCase().includes(term)).forEach(v => {
    const el = document.createElement("div");
    el.className = "di" + (f.val === String(v) ? " sel" : "");
    el.textContent = v;
    el.addEventListener("mousedown", e => { e.preventDefault(); selectVal(f, String(v)); });
    drop.appendChild(el);
  });
}

function selectVal(f, val) {
  f.val = val;
  document.getElementById(f.inputId).value = val;
  document.getElementById(f.dropId).classList.remove("open");
  aplicarFiltros();
}

function aplicarFiltros() {
  renderTabla(datos.filter(x => FILTROS.every(f => !f.val || x[f.field] === f.val)));
}

function limpiar() {
  FILTROS.forEach(f => { f.val = ""; document.getElementById(f.inputId).value = ""; });
  renderTabla(datos);
}

// ─── RENDER TABLA ─────────────────────────────────────────────────────────────
function renderTabla(d) {
  const tb = document.getElementById("tbody");
  document.getElementById("empty").style.display = d.length === 0 ? "block" : "none";
  document.getElementById("cnt").textContent = `${d.length} elemento${d.length !== 1 ? "s" : ""}`;

  // Destruir viewers y limpiar cola
  Object.values(viewers).forEach(v => { cancelAnimationFrame(v.raf); v.renderer.dispose(); });
  Object.keys(viewers).forEach(k => delete viewers[k]);
  loadQueue.length = 0;
  activeLoaders = 0;
  tb.innerHTML = "";

  d.forEach((item, i) => {
    const linkHtml = item.link
      ? `<a class="bsdd-link" href="${item.link}" target="_blank" rel="noopener">
           <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
             <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
             <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
           </svg>
           bSDD IFC
         </a>`
      : `<span style="color:var(--muted);font-size:12px">—</span>`;

    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td class="cod">${item.codigo}</td>` +
      `<td>${item.elemento}</td>` +
      `<td class="itype">${item.ifc_type}</td>` +
      `<td>${item.descripcion}</td>` +
      `<td><span class="lod lod-${item.lod}">LOD ${item.lod}</span></td>` +
      `<td>${linkHtml}</td>` +
      `<td class="vc"><div class="vbox" id="vbox_${i}">` +
        `<canvas id="cv_${i}"></canvas>` +
        `<div class="vload" id="vload_${i}"><div class="spin"></div><span>Cargando IFC...</span></div>` +
      `</div></td>`;
    tb.appendChild(tr);

    // Encolar en lugar de setTimeout directo
    loadQueue.push({ i, ifcPath: item.ifc_path });
  });

  // Arrancar la cola
  processQueue();
}

// ─── COLA DE CARGA ────────────────────────────────────────────────────────────
function processQueue() {
  while (activeLoaders < MAX_CONCURRENT && loadQueue.length > 0) {
    const { i, ifcPath } = loadQueue.shift();
    activeLoaders++;
    crearViewer(i, ifcPath).finally(() => {
      activeLoaders--;
      processQueue(); // cargar el siguiente cuando termine uno
    });
  }
}

// ─── VIEWER ──────────────────────────────────────────────────────────────────
async function crearViewer(i, ifcPath) {
  const box    = document.getElementById(`vbox_${i}`);
  const canvas = document.getElementById(`cv_${i}`);
  if (!box || !canvas) return;

  const W = box.clientWidth  || 350;
  const H = box.clientHeight || 240;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x080a12, 1);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(50, 100, 50);
  scene.add(dir);
  const fill = new THREE.DirectionalLight(0x8899bb, 0.4);
  fill.position.set(-30, 20, -50);
  scene.add(fill);

  const camera = new THREE.PerspectiveCamera(45, W / H, 0.01, 100000);
  camera.position.set(10, 10, 10);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  const state = { renderer, raf: null };
  viewers[`cv_${i}`] = state;
  (function loop() {
    state.raf = requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  })();

  const loader = new IFCLoader();
  await loader.ifcManager.setWasmPath(WASM_PATH);

  return new Promise((resolve) => {
    loader.load(
      ifcPath,
      (model) => {
        // Reemplazar verde brillante por gris, y capturar geometrías vacías
        let hasGeometry = false;
        model.traverse(child => {
          if (!child.isMesh) return;
          // Verificar que la geometría tiene índices válidos
          if (child.geometry && child.geometry.index && child.geometry.index.count > 0) {
            hasGeometry = true;
            const fix = m => {
              const c = m?.color;
              return (c && c.r < 0.1 && c.g > 0.9 && c.b < 0.1) ? DEFAULT_MAT : m;
            };
            if (Array.isArray(child.material)) child.material = child.material.map(fix);
            else child.material = fix(child.material);
          } else {
            // Geometría vacía o inválida — asignar placeholder
            child.material = ERROR_MAT;
          }
        });

        scene.add(model);

        if (hasGeometry) {
          const bbox   = new THREE.Box3().setFromObject(model);
          const center = bbox.getCenter(new THREE.Vector3());
          const size   = bbox.getSize(new THREE.Vector3());
          const dist   = Math.max(size.x, size.y, size.z) * 1.8;
          camera.position.set(center.x + dist, center.y + dist * 0.7, center.z + dist);
          controls.target.copy(center);
          controls.update();
        }

        document.getElementById(`vload_${i}`)?.classList.add("gone");
        resolve();
      },
      undefined,
      (err) => {
        console.error("Error IFC:", ifcPath, err.message || err);
        const vl = document.getElementById(`vload_${i}`);
        // Distinguir 404 de error de parseo
        const msg = String(err).includes("404")
          ? `Modelo no<br>disponible`
          : `Error de<br>geometría`;
        if (vl) vl.innerHTML =
          `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="1.5" style="margin-bottom:6px">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
          </svg>
          <span style="color:#64748b;font-size:10px;text-align:center;font-family:'IBM Plex Mono',monospace">${msg}</span>`;
        resolve();
      }
    );
  });
}

iniciar();
