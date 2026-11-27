// three.js view of a design: board, parts, wires, bridges, highlights and picking.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Design, Hole, Link, PITCH as P, PartInstance, Side, holeKey, toHole } from './model';
import { isSocketStrip, pinHoles } from './parts';
import { BOARD_T, M, buildPart, disposeGroup, ghostify } from './meshes';

export type Picked = { kind: 'part' | 'link'; id: string };

const SELECT = 0xffd23f;

export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 1, 4000);
  readonly controls: OrbitControls;
  private boardGroup = new THREE.Group();
  private partsGroup = new THREE.Group();
  private linksGroup = new THREE.Group();
  private overlay = new THREE.Group();
  private ghost: THREE.Object3D | null = null;
  private preview: THREE.Line | null = null;
  private markers: THREE.InstancedMesh | null = null;
  private ray = new THREE.Raycaster();
  private board = { cols: 0, rows: 0 };
  private dirty = true;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x14171d);
    this.scene.add(this.boardGroup, this.partsGroup, this.linksGroup, this.overlay);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f9c, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(60, 120, 80);
    const under = new THREE.DirectionalLight(0xffffff, 1.2);
    under.position.set(-40, -120, -60);
    this.scene.add(key, under);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 900;
    this.controls.addEventListener('change', () => (this.dirty = true));

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    const loop = () => {
      requestAnimationFrame(loop);
      this.controls.update();
      if (this.dirty) {
        this.dirty = false;
        this.renderer.render(this.scene, this.camera);
      }
    };
    loop();
  }

  private resize() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  invalidate() {
    this.dirty = true;
  }

  /** Which face of the board the camera is looking at. */
  viewSide(): Side {
    return this.camera.position.y < -BOARD_T / 2 ? 'bottom' : 'top';
  }

  private centre(): THREE.Vector3 {
    return new THREE.Vector3(((this.board.cols - 1) * P) / 2, 0, ((this.board.rows - 1) * P) / 2);
  }

  setView(v: 'top' | 'bottom' | '3d') {
    const c = this.centre();
    const dist = Math.max(this.board.cols, this.board.rows * 1.5) * P * 1.25 + 30;
    const off =
      v === 'top'
        ? new THREE.Vector3(0, dist, 0.01)
        : v === 'bottom'
          ? new THREE.Vector3(0, -dist, 0.01)
          : new THREE.Vector3(dist * 0.35, dist * 0.6, dist * 0.7);
    this.controls.target.copy(c);
    this.camera.position.copy(c).add(off);
    this.controls.update();
    this.dirty = true;
  }

  private clear(g: THREE.Group) {
    disposeGroup(g);
    g.clear();
  }

  private buildBoard(cols: number, rows: number) {
    this.clear(this.boardGroup);
    this.board = { cols, rows };
    const w = cols * P + 1.5;
    const d = rows * P + 1.5;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, BOARD_T, d), M(0x1f7a3a));
    body.position.set(((cols - 1) * P) / 2, -BOARD_T / 2, ((rows - 1) * P) / 2);
    this.boardGroup.add(body);

    const n = cols * rows;
    const padMat = M(0xc8ccd0, true);
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x07090b });
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number, down: boolean) => {
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      const t = new THREE.Object3D();
      t.rotation.x = down ? Math.PI / 2 : -Math.PI / 2;
      for (let c = 0; c < cols; c++)
        for (let r = 0; r < rows; r++) {
          t.position.set(c * P, y, r * P);
          t.updateMatrix();
          mesh.setMatrixAt(c * rows + r, t.matrix);
        }
      this.boardGroup.add(mesh);
    };
    mk(new THREE.RingGeometry(0.5, 1.02, 12), padMat, 0.01, false);
    mk(new THREE.CircleGeometry(0.5, 12), holeMat, 0.012, false);
    mk(new THREE.RingGeometry(0.5, 1.02, 12), padMat, -BOARD_T - 0.01, true);
    mk(new THREE.CircleGeometry(0.5, 12), holeMat, -BOARD_T - 0.012, true);
  }

  /** Holes ("side:c,r") that hold a female socket strip, so parts plugged into them sit raised. */
  private stripHoles = new Set<string>();

  /** Build a part's mesh and put it on the board, flipped over when it is on the underside. */
  private mount(inst: PartInstance): THREE.Group {
    const side = inst.side ?? 'top';
    const onStrip = pinHoles(inst).some((h) => this.stripHoles.has(`${side}:${holeKey(h)}`));
    const body = buildPart(inst, onStrip);
    const g = new THREE.Group();
    g.add(body);
    if (side === 'bottom') {
      // Half-turn about the board's row axis: mirrors the footprint and hangs the part below.
      body.rotation.z = Math.PI;
      body.position.y = -BOARD_T;
    }
    g.position.set(inst.pos.x, 0, inst.pos.y);
    g.rotation.y = (-inst.rot * Math.PI) / 2;
    return g;
  }

  private buildLink(l: Link, selected: boolean): THREE.Mesh {
    const top = l.side === 'top';
    const y = top ? 0.02 : -BOARD_T - 0.02;
    const a = new THREE.Vector3(l.a.x, y, l.a.y);
    const b = new THREE.Vector3(l.b.x, y, l.b.y);
    const len = a.distanceTo(b);
    let mesh: THREE.Mesh;
    if (l.kind === 'wire') {
      const rise = top ? Math.min(14, Math.max(2.5, len * 0.3)) : -Math.min(3, Math.max(1.2, len * 0.08));
      const mid = a.clone().add(b).multiplyScalar(0.5);
      mid.y = y + rise * 2;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const mat = new THREE.MeshStandardMaterial({ color: l.color, roughness: 0.6, flatShading: true });
      mat.userData.own = true;
      if (selected) mat.emissive.set(SELECT).multiplyScalar(0.6);
      mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 14, 0.5, 6), mat);
    } else {
      const mat = new THREE.MeshStandardMaterial({ color: selected ? SELECT : 0xd9dde3, metalness: 0.75, roughness: 0.28, flatShading: true });
      mat.userData.own = true;
      mesh = new THREE.Mesh(new THREE.BoxGeometry(len + 1.7, 0.55, 1.5), mat);
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.position.y = top ? 0.28 : -BOARD_T - 0.28;
      mesh.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
    }
    mesh.userData.linkId = l.id;
    return mesh;
  }

  /** Rebuild everything from the design. Cheap enough at perfboard scale. */
  rebuild(d: Design, selection: Picked | null) {
    if (d.board.cols !== this.board.cols || d.board.rows !== this.board.rows) this.buildBoard(d.board.cols, d.board.rows);
    this.clear(this.partsGroup);
    this.clear(this.linksGroup);
    this.stripHoles.clear();
    for (const part of d.parts)
      if (isSocketStrip(part.type)) for (const h of pinHoles(part)) this.stripHoles.add(`${part.side ?? 'top'}:${holeKey(h)}`);
    for (const part of d.parts) {
      const g = this.mount(part);
      g.userData.partId = part.id;
      this.partsGroup.add(g);
      if (selection?.kind === 'part' && selection.id === part.id) {
        g.updateMatrixWorld(true);
        const helper = new THREE.BoxHelper(g, SELECT);
        this.linksGroup.add(helper);
      }
    }
    for (const l of d.links) this.linksGroup.add(this.buildLink(l, selection?.kind === 'link' && selection.id === l.id));
    this.dirty = true;
  }

  /** Show a translucent part following the cursor. Pass null to hide. */
  setGhost(inst: PartInstance | null, ok = true) {
    if (this.ghost) {
      disposeGroup(this.ghost);
      this.overlay.remove(this.ghost);
      this.ghost = null;
    }
    if (inst) {
      const g = this.mount(inst);
      ghostify(g, ok);
      this.ghost = g;
      this.overlay.add(g);
    }
    this.dirty = true;
  }

  /** Rubber-band line while drawing a wire or bridge. */
  setPreview(a: Hole | null, b: Hole | null, side: Side = 'top', color = '#ffffff') {
    if (this.preview) {
      this.preview.geometry.dispose();
      (this.preview.material as THREE.Material).dispose();
      this.overlay.remove(this.preview);
      this.preview = null;
    }
    if (a && b) {
      const y = side === 'top' ? 0.6 : -BOARD_T - 0.6;
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a.c * P, y, a.r * P), new THREE.Vector3(b.c * P, y, b.r * P)]);
      this.preview = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, depthTest: false }));
      this.preview.renderOrder = 10;
      this.overlay.add(this.preview);
    }
    this.dirty = true;
  }

  /** Ring markers on a set of holes ("c,r" keys), drawn on top of everything. */
  setHighlight(keys: string[]) {
    if (this.markers) {
      this.markers.geometry.dispose();
      (this.markers.material as THREE.Material).dispose();
      this.overlay.remove(this.markers);
      this.markers = null;
    }
    if (keys.length) {
      const bottom = this.viewSide() === 'bottom';
      const mat = new THREE.MeshBasicMaterial({ color: SELECT, depthTest: false, transparent: true, opacity: 0.95, side: THREE.DoubleSide });
      const mesh = new THREE.InstancedMesh(new THREE.RingGeometry(0.95, 1.3, 16), mat, keys.length);
      const t = new THREE.Object3D();
      t.rotation.x = -Math.PI / 2;
      keys.forEach((k, i) => {
        const [c, r] = k.split(',').map(Number);
        t.position.set(c * P, bottom ? -BOARD_T - 0.05 : 0.05, r * P);
        t.updateMatrix();
        mesh.setMatrixAt(i, t.matrix);
      });
      mesh.renderOrder = 9;
      this.markers = mesh;
      this.overlay.add(mesh);
    }
    this.dirty = true;
  }

  private aim(e: { clientX: number; clientY: number }) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
  }

  /** Hole under the cursor on the face being viewed, or null when off the board. */
  pickHole(e: { clientX: number; clientY: number }): Hole | null {
    this.aim(e);
    const y = this.viewSide() === 'top' ? 0 : -BOARD_T;
    const hit = this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3());
    if (!hit) return null;
    const h = toHole({ x: hit.x, y: hit.z });
    return h.c >= 0 && h.r >= 0 && h.c < this.board.cols && h.r < this.board.rows ? h : null;
  }

  /** Part or link under the cursor. */
  pickObject(e: { clientX: number; clientY: number }): Picked | null {
    this.aim(e);
    const hits = this.ray.intersectObjects([...this.partsGroup.children, ...this.linksGroup.children], true);
    for (const hit of hits) {
      for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
        if (o.userData.partId) return { kind: 'part', id: o.userData.partId };
        if (o.userData.linkId) return { kind: 'link', id: o.userData.linkId };
      }
    }
    return null;
  }

  png(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
}

