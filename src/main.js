import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { IFCLoader } from "web-ifc-three";

const WASM_PATH = "./";

const DEFAULT_MAT = new THREE.MeshLambertMaterial({
  color: 0xc8c8c8,
  side: THREE.DoubleSide,
});

let datos = [];
const viewers = {};

const FILTROS = [
  { field: "codigo",   inputId: "fCod", dropId: "drop-cod", val: "" },
  { field: "elemento", inputId: "fEle", dropId: "drop-ele", val: "" },
  { field: "ifc_type", inputId: "fIfc", dropId: "drop-ifc", val: "" },
  { field: "lod",      inputId: "fLod", dropId: "drop-lod", val: "" },
];

async function iniciar() {
  const r = await fetch("./data/datos.json?v=" + Date.now());
  datos = await r.json();
  iniciarFiltros();
  renderTabla(datos);
}

function iniciarFiltros() {
  FILTROS.forEach(f => {
    const input = document.getElementById(f.inputId);
    const drop  = document.getElementById(f.dropId);

    input.addEventListener("focus", () => {
      buildDrop(f, input.value);
      drop.classList.add("open");
    });
    input.addEventListener("input", () => {
      f.val = "";
      buildDrop(f, input.value);
      drop.classList.add("open");
      aplicarFiltros();
    });
    input.addEventListener("blur", () => {
      setTimeout(() => {
        drop.classList.remove("open");
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
  const all = document.createElement("div");
  all.className = "di rst";
  all.textContent = "— Todos —";
  all.addEventListener("mousedown", e => { e.preventDefault(); selectVal(f, ""); });
  drop.appendChild(all);

  filtered.forEach(v => {
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

function renderTabla(d) {
  const tb = document.getElementById("tbody");
  document.getElementById("empty").style.display = d.length === 0 ? "block" : "none";
  document.getElementById("cnt").textContent =
    `${d.length} elemento${d.length !== 1 ? "s" : ""}`;

  Object.values(viewers).forEach(v => { cancelAnimationFrame(v.raf); v.renderer.dispose(); });
  Object.keys(viewers).forEach(k => delete viewers[k]);
  tb.innerHTML = "";

  d.forEach((item, i) => {
    // Celda del link bSDD
    const linkHtml = item.link
      ? `<a class="bsdd-link" href="${item.link}" target="_blank" rel="noopener">
           <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
             <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
             <polyline points="15 3 21 3 21 9"/>
             <line x1="10" y1="14" x2="21" y2="3"/>
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
        `<div class="vload" id="vload_${i}">` +
          `<div class="spin"></div><span>Cargando IFC...</span>` +
        `</div></div></td>`;
    tb.appendChild(tr);
    setTimeout(() => crearViewer(i, item.ifc_path), 100 + i * 300);
  });
}

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

  loader.load(
    ifcPath,
    (model) => {
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
      camera.position.set(center.x + dist, center.y + dist * 0.7, center.z + dist);
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

iniciar();
