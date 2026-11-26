// Low-poly 3D meshes for parts. Local frame: x → board columns, z → board
// rows, y up. The board's top surface is y = 0 and its underside y = -BOARD_T.

import * as THREE from 'three';
import { PITCH as P, PartInstance } from './model';
import { PartDef, Resolved, getDef } from './parts';

export const BOARD_T = 1.6;
const PIN_BOTTOM = -BOARD_T - 1.8;
const GOLD = 0xd4a93a;
const SILVER = 0xc4c9d0;
const BLACK = 0x1a1a1c;
const TEX_SCALE = 16; // texture pixels per mm

const cache = new Map<string, THREE.MeshStandardMaterial>();

/** Shared flat-shaded material. Never dispose these. */
export function M(color: number, metal = false): THREE.MeshStandardMaterial {
  const key = `${color}|${metal}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      flatShading: true,
      metalness: metal ? 0.65 : 0.05,
      roughness: metal ? 0.38 : 0.82,
    });
    cache.set(key, m);
  }
  return m;
}

function box(g: THREE.Group, w: number, h: number, d: number, m: THREE.Material | THREE.Material[], x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  g.add(mesh);
  return mesh;
}

function cyl(g: THREE.Group, r: number, h: number, m: THREE.Material, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'y', seg = 10) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);
  if (axis === 'x') mesh.rotation.z = Math.PI / 2;
  if (axis === 'z') mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  g.add(mesh);
  return mesh;
}

function instanced(g: THREE.Group, w: number, h: number, d: number, m: THREE.Material, at: [number, number, number][]) {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(w, h, d), m, at.length);
  const t = new THREE.Matrix4();
  at.forEach(([x, y, z], i) => mesh.setMatrixAt(i, t.makeTranslation(x, y, z)));
  mesh.instanceMatrix.needsUpdate = true;
  g.add(mesh);
  return mesh;
}

/** Vertical leads from under the board up to `top`, one per pin. */
function legs(g: THREE.Group, res: Resolved, top: number, m = M(SILVER, true), size = 0.5) {
  const h = top - PIN_BOTTOM;
  instanced(g, size, h, size, m, res.pins.map((p) => [p.x * P, PIN_BOTTOM + h / 2, p.y * P]));
}

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

/** Silkscreen texture for the top of a module: pads and pin labels. */
function moduleTexture(def: PartDef, res: Resolved): THREE.CanvasTexture {
  const { x0, y0, x1, y1 } = res.body;
  const S = TEX_SCALE;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(8, Math.round((x1 - x0) * S));
  canvas.height = Math.max(8, Math.round((y1 - y0) * S));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = hex(def.color);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(1.45 * S)}px "Segoe UI", Arial, sans-serif`;
  for (const pin of res.pins) {
    const cx = (pin.x * P - x0) * S;
    const cy = (pin.y * P - y0) * S;
    ctx.fillStyle = '#d4a93a';
    ctx.beginPath();
    ctx.arc(cx, cy, 0.95 * S, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f4f4f4';
    ctx.save();
    if (pin.lx !== 0) {
      ctx.textAlign = pin.lx > 0 ? 'left' : 'right';
      ctx.fillText(pin.name, cx + pin.lx * 1.35 * S, cy);
    } else {
      ctx.translate(cx, cy + 1.35 * S);
      ctx.rotate(Math.PI / 2);
      ctx.textAlign = 'left';
      ctx.fillText(pin.name, 0, 0);
    }
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Top marking for a DIP chip: part name, notch and pin-1 dot. */
function chipTexture(def: PartDef, w: number, d: number): THREE.CanvasTexture {
  const S = TEX_SCALE;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * S);
  canvas.height = Math.round(d * S);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1c1c1f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0b0b0c';
  ctx.beginPath();
  ctx.arc(canvas.width / 2, 0, 1 * S, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = '#9a9aa0';
  ctx.beginPath();
  ctx.arc(1 * S, 1.6 * S, 0.4 * S, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c9c9cf';
  ctx.font = `bold ${Math.round(1.7 * S)}px "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.fillText(def.name.split(' ')[0] === 'Generic' ? def.name.split(' ')[1] : def.name.split(' ')[0], 0, 0, canvas.height - 3 * S);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Box materials with a texture on the top (+y) face. The textured one is owned by the part. */
function toppedMaterials(side: THREE.Material, tex: THREE.Texture): THREE.Material[] {
  const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, metalness: 0.05 });
  top.userData.own = true;
  return [side, side, top, side, side, side];
}

function buildModule(g: THREE.Group, def: PartDef, res: Resolved) {
  const { x0, y0, x1, y1 } = res.body;
  const w = x1 - x0;
  const d = y1 - y0;
  const cx = (x0 + x1) / 2;
  const cz = (y0 + y1) / 2;
  const stand = 2.5; // plastic header spacer
  const pcb = 1.2;
  const top = stand + pcb;
  box(g, w, pcb, d, toppedMaterials(M(def.color), moduleTexture(def, res)), cx, stand + pcb / 2, cz);
  instanced(g, P - 0.1, stand, P - 0.1, M(BLACK), res.pins.map((p) => [p.x * P, stand / 2, p.y * P]));
  legs(g, res, top + 0.35, M(GOLD, true), 0.64);
  for (const dc of def.decor) {
    const x = x0 + dc.u * w;
    const z = y0 + dc.v * d;
    if (dc.shape === 'box') box(g, dc.w, dc.h, dc.d, M(dc.color, dc.metal), x, top + dc.h / 2, z);
    else cyl(g, dc.w / 2, dc.h, M(dc.color, dc.metal), x, top + dc.h / 2, z, 'y', 12);
  }
}

function buildDip(g: THREE.Group, def: PartDef, res: Resolved) {
  const { x0, y0, x1, y1 } = res.body;
  const w = x1 - x0;
  const d = y1 - y0;
  box(g, w, 3.2, d, toppedMaterials(M(def.color), chipTexture(def, w, d)), (x0 + x1) / 2, 0.6 + 1.6, (y0 + y1) / 2);
  legs(g, res, 2.2, M(SILVER, true), 0.55);
  // Shoulders joining each leg to the body.
  const rs = Math.max(...res.pins.map((p) => p.x)) * P;
  instanced(g, 0.9, 0.3, 0.55, M(SILVER, true), res.pins.map((p) => [p.x === 0 ? 0.3 : rs - 0.3, 2.2, p.y * P]));
}

function buildTwoLead(g: THREE.Group, def: PartDef, res: Resolved, inst: PartInstance) {
  const L = res.pins[1].x * P;
  const mid = L / 2;
  const lead = M(SILVER, true);
  switch (def.shape) {
    case 'resistor':
    case 'diode': {
      const y = 1.7;
      legs(g, res, y);
      cyl(g, 0.28, L, lead, mid, y, 0, 'x', 6);
      const len = Math.max(1.6, Math.min(L - 2.2, def.shape === 'diode' ? 4.6 : 6.4));
      cyl(g, 1.15, len, M(def.color), mid, y, 0, 'x', 8);
      if (def.shape === 'diode') cyl(g, 1.2, 0.7, M(0xd6d6da), mid + len / 2 - 0.7, y, 0, 'x', 8);
      else
        [0x6b3a1e, 0x111111, 0xc22a2a, 0xc9a227].forEach((c, i) =>
          cyl(g, 1.2, len * 0.09, M(c), mid - len * 0.32 + i * len * 0.2 + (i === 3 ? len * 0.06 : 0), y, 0, 'x', 8),
        );
      break;
    }
    case 'disc': {
      const r = Math.max(2.2, L / 2 + 0.4);
      legs(g, res, 2.6);
      cyl(g, r, 1.7, M(def.color), mid, 2.4 + r * 0.85, 0, 'z', 12);
      break;
    }
    case 'can': {
      const r = Math.max(2.6, L / 2 + 1.3);
      legs(g, res, 0.6);
      cyl(g, r, 9, M(def.color), mid, 0.4 + 4.5, 0, 'y', 12);
      cyl(g, r * 0.86, 0.12, M(SILVER, true), mid, 9.46, 0, 'y', 12);
      box(g, 0.3, 8.6, r * 0.9, M(0xdfe3ea), mid + r * 0.98, 4.9, 0); // negative stripe
      break;
    }
    case 'led': {
      const color = new THREE.Color(String(inst.props.color ?? '#ff3030'));
      const m = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.35,
        transparent: true,
        opacity: 0.9,
        flatShading: true,
        roughness: 0.3,
      });
      m.userData.own = true;
      legs(g, res, 1);
      cyl(g, 2.9, 1, m, mid, 1, 0, 'y', 12);
      cyl(g, 2.5, 4, m, mid, 3.5, 0, 'y', 12);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(2.5, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2), m);
      dome.position.set(mid, 5.5, 0);
      g.add(dome);
      break;
    }
    case 'buzzer': {
      legs(g, res, 0.6);
      cyl(g, Math.max(4, L / 2 + 2.2), 7, M(def.color), mid, 0.4 + 3.5, 0, 'y', 14);
      cyl(g, 1.1, 0.1, M(0x4a4a50), mid, 7.46, 0, 'y', 10);
      break;
    }
  }
}

function buildFixed(g: THREE.Group, def: PartDef, res: Resolved) {
  const { x0, y0, x1, y1 } = res.body;
  const cx = (x0 + x1) / 2;
  const cz = (y0 + y1) / 2;
  switch (def.shape) {
    case 'button':
      legs(g, res, 1.2);
      box(g, 6.2, 3.4, 6.2, M(def.color), cx, 0.3 + 1.7, cz);
      box(g, 6.4, 0.3, 6.4, M(SILVER, true), cx, 3.75, cz);
      cyl(g, 1.75, 1.3, M(0x2c2c30), cx, 4.5, cz, 'y', 10);
      break;
    case 'to92':
      legs(g, res, 3.2);
      cyl(g, 2.4, 4.6, M(def.color), cx, 3 + 2.3, cz, 'y', 8);
      break;
    case 'to220':
      legs(g, res, 4);
      box(g, 10, 9, 4.4, M(def.color), cx, 3.5 + 4.5, cz);
      box(g, 10, 15.5, 1.2, M(SILVER, true), cx, 3.5 + 7.75, cz - 2.2);
      break;
    case 'terminal':
      legs(g, res, 1, M(SILVER, true), 0.9);
      box(g, 10.1, 10, 7.6, M(def.color), cx, 5, cz);
      for (const p of res.pins) cyl(g, 1.7, 0.3, M(SILVER, true), p.x * P, 10.15, p.y * P, 'y', 8);
      break;
    case 'trimmer':
      legs(g, res, 1);
      box(g, 6.8, 4.8, 6.8, M(def.color), cx, 0.5 + 2.4, cz);
      cyl(g, 1.6, 0.4, M(0xc9a227, true), cx, 5.5, cz, 'y', 8);
      break;
    case 'header':
      instanced(g, P - 0.1, 2.5, P - 0.1, M(def.color), res.pins.map((p) => [p.x * P, 1.25, p.y * P]));
      legs(g, res, 8.6, M(GOLD, true), 0.64);
      break;
  }
}

/** Build the mesh group for a part, in its local frame (unrotated, origin at pin 1). */
export function buildPart(inst: PartInstance): THREE.Group {
  const g = new THREE.Group();
  const def = getDef(inst.type);
  if (!def) return g;
  const res = def.resolve(inst.props);
  if (def.shape === 'module') buildModule(g, def, res);
  else if (def.shape === 'dip') buildDip(g, def, res);
  else if (def.props.some((p) => p.key === 'span')) buildTwoLead(g, def, res, inst);
  else buildFixed(g, def, res);
  return g;
}

/** Make every material in a group translucent (for placement previews). */
export function ghostify(g: THREE.Object3D, ok: boolean) {
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const conv = (m: THREE.Material) => {
      const c = (m as THREE.MeshStandardMaterial).clone();
      c.transparent = true;
      c.opacity = ok ? 0.6 : 0.3;
      c.depthWrite = false;
      if (!ok) c.color.set(0xff4040);
      c.userData.own = true;
      return c;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(conv) : conv(mesh.material);
  });
}

/** Free geometries and any materials/textures owned by this group. */
export function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.geometry) return;
    mesh.geometry.dispose();
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (m?.userData.own) {
        (m as THREE.MeshStandardMaterial).map?.dispose();
        m.dispose();
      }
    }
  });
}
