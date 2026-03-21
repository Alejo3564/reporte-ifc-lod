import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { IFCLoader } from "web-ifc-three";

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const WASM_PATH = "./";

const DEFAULT_MAT = new THREE.MeshLambertMaterial({
  color: 0xc8c8c8,
  side: THREE.DoubleSide,
});

// ─── ESTADO ──────────────────────────────────────────────────────────────────
let datos = [];
const viewers = {};

// Filtros: campo de datos, id del input, id del dropdown, valor activo
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
  iniciarFiltros();   // conectar eventos DESPUÉS de tener datos
  renderTabla(datos);
}

// ─── FILTROS CON BÚSQUEDA ────────────────────────────────────────────────────
function iniciarFiltros() {
  FILTROS.forEach(f => {
    const input = document.getElementById(f.inputId);
    const drop  = document.getElementById(f.dropId);

    input.addEventListener("focus", () => {
      buildDrop(f, input.value);
      drop.classList.add("open");
    });

    input.addEventListener("input", () => {
      f.val = "";           // escribir borra selección activa
      buildDrop(f, input.value);
      drop.classList.add("open");
      aplicarFiltros();
    });

    input.addEventListener("blur", () => {
      // Pequeño delay para que el click en item se procese
      setTimeout(() => {
        drop.classList.remove("open");
        // Si no hay valor seleccionado, limpiar el texto
        if (!f.val) input.value = "";
      }, 160);
    });
  });

  document.getElementById("btnLimpiar").addEventListener("click", limpiar);
}

function buildDrop(f, searchTerm) {
  const drop = document.getElementById(f.dropId);
  const term = (searchTerm || "").toLowerCase();
  const vals = [...new Set(datos.map(x => x[f.field]))].sort();
  const filtered = vals.filter(v => String(v).toLowerCase().includes(term));

  drop.innerHTML = "";

  // Opción "Todos"
  const all = document.createElement("div");
  all.className = "di rst";
  all.textContent = "— Todos —";
  all.addEventListener("mousedown", (e) => { e.preventDefault(); selectVal(f, ""); });
  drop.appendChild(all);

  filtered.forEach(v => {
    const el = document.createElement("div");
    el.className = "di" + (f.val === String(v) ? " sel" : "");
    el.textContent = v;
    el.addEventListener("mousedown", (e) => { e.preventDefault(); selectVal(f, String(v)); });
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
  const result = datos.filter(x =>
    FILTROS.every(f => !f.val || x[f.field] === f.val)
  );
  renderTabla(result);
}

function limpiar() {
  FILTROS.forEach(f => {
    f.val = "";
    document.getElementById(f.inputId).value = "";
  });
  renderTabla(datos);
}

// ─── RENDER TABLA ─────────────────────────────────────────────────────────────
function renderTabla(d) {
  const tb = document.getElementById("tbody");
  document.getElementById("empty").style.display = d.length === 0 ? "block" : "none";
  document.getElementById("cnt").textContent =
    `${d.length} elemento${d.length !== 1 ? "s" : ""}`;

  // Destruir viewers anteriores
  Object.values(viewers).forEach(v => {
    cancelAnimationFrame(v.raf);
    v.renderer.dispose();
  });
  Object.keys(viewers).forEach(k => delete viewers[k]);
  tb.innerHTML = "";

  d.forEach((item, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td class="cod">${item.codigo}</td>` +
      `<td>${item.elemento}</td>` +
      `<td class="itype">${item.ifc_type}</td>` +
      `<td>${item.descripcion}</td>` +
      `<td><span class="lod lod-${item.lod}">LOD ${item.lod}</span></td>` +
      `<td class="vc"><div class="vbox" id="vbox_${i}">` +
        `<canvas id="cv_${i}"></canvas>` +
        `<div class="vload" id="vload_${i}">` +
          `<div class="spin"></div><span>Cargando IFC...</span>` +
        `</div>` +
      `</div></td>`;
    tb.appendChild(tr);
    setTimeout(() => crearViewer(i, item.ifc_path), 100 + i * 300);
  });
}

// ─── VIEWER IFC ──────────────────────────────────────────────────────────────
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
  scene.add(Object.assign(new THREE.DirectionalLight(0x8899bb, 0.4), {
    position: new THREE.Vector3(-30, 20, -50)
  }));

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

  loader.load(
    ifcPath,
    (model) => {
      // Reemplazar verde brillante (sin material) por gris neutro
      model.traverse(child => {
        if (!child.isMesh) return;
        const fix = m => {
          const c = m?.color;
          return (c && c.r < 0.1 && c.g > 0.9 && c.b < 0.1) ? DEFAULT_MAT : m;
        };
        if (Array.isArray(child.material)) child.material = child.material.map(fix);
        else child.material = fix(child.material);
      });

      scene.add(model);

      const bbox   = new THREE.Box3().setFromObject(model);
      const center = bbox.getCenter(new THREE.Vector3());
      const size   = bbox.getSize(new THREE.Vector3());
      const dist   = Math.max(size.x, size.y, size.z) * 1.8;
      camera.position.set(
        center.x + dist,
        center.y + dist * 0.7,
        center.z + dist
      );
      controls.target.copy(center);
      controls.update();

      document.getElementById(`vload_${i}`)?.classList.add("gone");
    },
    undefined,
    (err) => {
      console.error("Error IFC:", ifcPath, err);
      const vl = document.getElementById(`vload_${i}`);
      if (vl) vl.innerHTML =
        `<span style="color:#ef4444;font-size:10px;text-align:center;padding:8px">` +
        `Error:<br>${ifcPath.split("/").pop()}</span>`;
    }
  );
}

// ─── ARRANQUE ─────────────────────────────────────────────────────────────────
iniciar();
