import * as THREE from "three";
import * as OBC  from "@thatopen/components";

// ─── CONFIG ──────────────────────────────────────────────────────────────────
// Ruta absoluta basada en la URL actual de la página
const BASE_URL   = window.location.href.replace(/\/[^/]*$/, "/");
const WORKER_URL = BASE_URL + "worker.mjs";
const WASM_PATH  = BASE_URL;

// ─── ESTADO ──────────────────────────────────────────────────────────────────
let datos = [];
const viewers = {};
const loadQueue   = [];
let activeLoaders = 0;
const MAX_CONCURRENT = 3;

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

  Object.values(viewers).forEach(v => { try { v.components.dispose(); } catch(e) {} });
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
           </svg>bSDD IFC</a>`
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
        `<div class="vload" id="vload_${i}"><div class="spin"></div><span>Cargando IFC...</span></div>` +
      `</div></td>`;
    tb.appendChild(tr);
    loadQueue.push({ i, item });
  });

  processQueue();
}

// ─── COLA ────────────────────────────────────────────────────────────────────
function processQueue() {
  while (activeLoaders < MAX_CONCURRENT && loadQueue.length > 0) {
    const task = loadQueue.shift();
    activeLoaders++;
    crearViewer(task.i, task.item).finally(() => {
      activeLoaders--;
      processQueue();
    });
  }
}

// ─── VIEWER ──────────────────────────────────────────────────────────────────
async function crearViewer(i, item) {
  const container = document.getElementById(`vbox_${i}`);
  if (!container) return;

  const W = container.clientWidth  || 350;
  const H = container.clientHeight || 240;

  try {
    const components = new OBC.Components();
    const worlds = components.get(OBC.Worlds);
    const world  = worlds.create();

    world.scene    = new OBC.SimpleScene(components);
    world.renderer = new OBC.SimpleRenderer(components, container);
    world.camera   = new OBC.SimpleCamera(components);

    world.scene.three.background = new THREE.Color(0x080a12);
    world.renderer.three.setSize(W, H);

    world.scene.three.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(50, 100, 50);
    world.scene.three.add(dir);
    const fill = new THREE.DirectionalLight(0x8899bb, 0.4);
    fill.position.set(-30, 20, -50);
    world.scene.three.add(fill);

    components.init();
    viewers[`v_${i}`] = { components };

    // IfcLoader con rutas absolutas
    const ifcLoader = components.get(OBC.IfcLoader);
    await ifcLoader.setup({
      autoSetWasm: false,
      wasm: {
        path:     WASM_PATH,
        absolute: true,
      },
    });

    // Cargar IFC
    const resp = await fetch(item.ifc_path);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buffer = new Uint8Array(await resp.arrayBuffer());
    const model  = await ifcLoader.load(buffer);

    world.scene.three.add(model);

    // Ajustar cámara
    const bbox = new THREE.Box3().setFromObject(model);
    if (!bbox.isEmpty()) {
      const center = bbox.getCenter(new THREE.Vector3());
      const size   = bbox.getSize(new THREE.Vector3());
      const dist   = Math.max(size.x, size.y, size.z) * 1.8;
      if (world.camera.controls) {
        world.camera.controls.setLookAt(
          center.x + dist, center.y + dist * 0.7, center.z + dist,
          center.x, center.y, center.z
        );
      }
    }

    document.getElementById(`vload_${i}`)?.classList.add("gone");

  } catch(err) {
    console.warn(`IFC error [${item.ifc_path}]:`, err.message || err);
    try { viewers[`v_${i}`]?.components.dispose(); } catch(e) {}
    delete viewers[`v_${i}`];
    mostrarPlaceholder(i, item.ifc_type);
  }
}

// ─── PLACEHOLDER ─────────────────────────────────────────────────────────────
function mostrarPlaceholder(i, ifcType) {
  const vload = document.getElementById(`vload_${i}`);
  const box   = document.getElementById(`vbox_${i}`);
  if (!vload) return;

  let icon = `<circle cx="12" cy="12" r="8" stroke-width="1.2"/>`;
  if (/rail/i.test(ifcType))   icon = `<path d="M4 6h16M4 18h16M8 6v12M16 6v12" stroke-width="1.5"/>`;
  if (/sign$/i.test(ifcType))  icon = `<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke-width="1.2"/>`;
  if (/signal/i.test(ifcType)) icon = `<circle cx="12" cy="6" r="3"/><circle cx="12" cy="14" r="3"/><line x1="12" y1="2" x2="12" y2="22"/>`;
  if (/course/i.test(ifcType)) icon = `<rect x="2" y="8" width="20" height="4" rx="1"/><rect x="2" y="14" width="20" height="4" rx="1"/>`;
  if (/wall/i.test(ifcType))   icon = `<rect x="3" y="4" width="18" height="16" rx="1"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="4" x2="12" y2="20"/>`;
  if (/door/i.test(ifcType))   icon = `<rect x="4" y="2" width="12" height="20" rx="1"/><circle cx="14" cy="12" r="1.5"/>`;
  if (/geo/i.test(ifcType))    icon = `<path d="M3 17l4-8 4 5 3-3 4 6H3z"/><circle cx="17" cy="7" r="2"/>`;

  vload.innerHTML = `
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none"
         stroke="#3b82f6" stroke-linecap="round" stroke-linejoin="round"
         style="opacity:.5;margin-bottom:8px">${icon}</svg>
    <span style="color:#475569;font-size:9px;font-family:'IBM Plex Mono',monospace;
                 text-align:center;letter-spacing:.5px;line-height:1.6">
      MODELO NO<br>DISPONIBLE
    </span>`;
  if (box) box.style.background = "#0d1120";
}

iniciar();
