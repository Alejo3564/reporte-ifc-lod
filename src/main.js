import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { IFCLoader } from "web-ifc-three";

const WASM_PATH = "./";

let datos = [];
const viewers = {};

// Material por defecto para elementos sin material en el IFC
const DEFAULT_MAT = new THREE.MeshLambertMaterial({
  color: 0xc8c8c8,
  side: THREE.DoubleSide,
});

async function iniciar() {
  const r = await fetch("./data/datos.json?v=" + Date.now());
  datos = await r.json();
  llenarDropdowns();
  renderTabla(datos);
}

function llenarDropdowns() {
  dd("fCod", uniq(datos.map(x => x.codigo)));
  dd("fEle", uniq(datos.map(x => x.elemento)));
  dd("fIfc", uniq(datos.map(x => x.ifc_type)));
  dd("fLod", uniq(datos.map(x => x.lod)));
}
function uniq(arr) { return [...new Set(arr)].sort(); }
function dd(id, vals) {
  const s = document.getElementById(id);
  vals.forEach(v => { const o = document.createElement("option"); o.value = o.text = v; s.appendChild(o); });
}

function renderTabla(d) {
  const tb = document.getElementById("tbody");
  document.getElementById("empty").style.display = d.length === 0 ? "block" : "none";
  document.getElementById("cnt").textContent = `${d.length} elemento${d.length !== 1 ? "s" : ""}`;

  Object.values(viewers).forEach(v => { cancelAnimationFrame(v.raf); v.renderer.dispose(); });
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
        `<div class="vload" id="vload_${i}"><div class="spin"></div><span>Cargando IFC...</span></div>` +
      `</div></td>`;
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
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(50, 100, 50);
  dir.castShadow = true;
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
  (function loop() { state.raf = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); })();

  const loader = new IFCLoader();
  await loader.ifcManager.setWasmPath(WASM_PATH);

  loader.load(
    ifcPath,
    (model) => {
      // Reemplazar material verde por defecto con gris neutro
      model.traverse(child => {
        if (child.isMesh) {
          // Conservar materiales con color definido (no el verde por defecto #00ff00)
          if (Array.isArray(child.material)) {
            child.material = child.material.map(m => {
              const col = m.color;
              // Verde brillante = sin material real → reemplazar
              if (col && col.r < 0.1 && col.g > 0.9 && col.b < 0.1) return DEFAULT_MAT;
              return m;
            });
          } else if (child.material) {
            const col = child.material.color;
            if (col && col.r < 0.1 && col.g > 0.9 && col.b < 0.1) child.material = DEFAULT_MAT;
          }
        }
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

      // Selección de elementos
      const raycaster = new THREE.Raycaster();
      raycaster.firstHitOnly = true;
      const mouse = new THREE.Vector2();
      canvas.addEventListener("click", async (e) => {
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
        mouse.y = ((e.clientY - rect.top)  / rect.height) * -2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const hits = raycaster.intersectObjects(scene.children, true);
        if (hits.length > 0) {
          const hit = hits[0];
          try {
            const expressID = loader.ifcManager.getExpressId(hit.object.geometry, hit.faceIndex);
            const modelID   = hit.object.modelID ?? 0;
            const props     = await loader.ifcManager.getItemProperties(modelID, expressID);
            document.getElementById("pType").textContent = props?.type || "-";
            document.getElementById("pNom").textContent  = props?.Name?.value || "-";
            document.getElementById("pId").textContent   = expressID;
          } catch(e2) { console.warn(e2); }
        }
      });
    },
    undefined,
    (err) => {
      console.error("Error IFC:", ifcPath, err);
      const vl = document.getElementById(`vload_${i}`);
      if (vl) vl.innerHTML = `<span style="color:#ef4444;font-size:10px;text-align:center;padding:8px">Error:<br>${ifcPath.split("/").pop()}</span>`;
    }
  );
}

window.filtrar = () => {
  const c = document.getElementById("fCod").value;
  const e = document.getElementById("fEle").value;
  const t = document.getElementById("fIfc").value;
  const l = document.getElementById("fLod").value;
  renderTabla(datos.filter(x => (!c||x.codigo===c)&&(!e||x.elemento===e)&&(!t||x.ifc_type===t)&&(!l||x.lod===l)));
};
window.limpiar = () => {
  ["fCod","fEle","fIfc","fLod"].forEach(id => document.getElementById(id).value = "");
  renderTabla(datos);
};

iniciar();
