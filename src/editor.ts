// Editing logic: tools, selection, undo/redo, validation and persistence.

import { Design, Hole, Link, PITCH as P, PartInstance, PropValue, emptyDesign, holeKey, linkHoles, parseDesign, sameHole, toHole, toVec, uid } from './model';
import { NetInfo, NetPin, computeNets } from './nets';
import { defaultProps, getDef, pinHoles } from './parts';
import { Picked, View } from './scene';

export type Tool = 'select' | 'place' | 'wire' | 'bridge' | 'erase';

export interface Hover {
  x: number;
  y: number;
  text: string;
}

const STORE_KEY = 'visioboard.design.v1';
const MAX_UNDO = 100;

export class Editor {
  design: Design = emptyDesign();
  nets: NetInfo = computeNets(this.design);
  tool: Tool = 'select';
  selection: Picked | null = null;
  wireColor = '#e5484d';
  status = '';
  placing: PartInstance | null = null;
  /** Called after any change to the design, selection, tool or status. */
  onChange: () => void = () => {};
  onHover: (h: Hover | null) => void = () => {};

  private pinsAt = new Map<string, NetPin[]>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private start: Hole | null = null;
  private hover: Hole | null = null;
  private pinnedNet: string | null = null;
  private down: { x: number; y: number } | null = null;
  private drag: { id: string; grab: Hole; orig: Hole; before: string; moved: boolean } | null = null;

  constructor(readonly view: View) {
    const el = view.renderer.domElement;
    el.addEventListener('pointerdown', (e) => this.pointerDown(e), { capture: true });
    el.addEventListener('pointermove', (e) => this.pointerMove(e));
    el.addEventListener('pointerup', (e) => this.pointerUp(e));
    el.addEventListener('pointerleave', () => {
      this.hover = null;
      this.onHover(null);
      this.view.setGhost(null);
      this.applyHighlight();
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.key(e));

    const saved = localStorage.getItem(STORE_KEY);
    if (saved) {
      try {
        this.design = parseDesign(saved);
      } catch {
        /* ignore a corrupt autosave */
      }
    }
    this.refresh(false);
    this.view.setView('3d');
  }

  // ── State plumbing ────────────────────────────────────────────────────

  private refresh(persist = true) {
    this.nets = computeNets(this.design);
    this.pinsAt.clear();
    for (const part of this.design.parts)
      for (const h of pinHoles(part)) {
        const k = holeKey(h);
        this.pinsAt.set(k, [...(this.pinsAt.get(k) ?? []), { partId: part.id, ref: part.ref, name: h.name }]);
      }
    if (this.pinnedNet && !this.nets.nets.has(this.pinnedNet)) this.pinnedNet = null;
    this.view.rebuild(this.design, this.selection);
    this.applyHighlight();
    if (persist) {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(this.design));
      } catch {
        /* storage full or blocked: the design still lives in memory */
      }
    }
    this.onChange();
  }

  private mutate(fn: () => void) {
    this.pushUndo(JSON.stringify(this.design));
    fn();
    this.refresh();
  }

  private pushUndo(snapshot: string) {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
  }

  private say(msg: string) {
    this.status = msg;
    this.onChange();
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(JSON.stringify(this.design));
    this.design = JSON.parse(prev);
    this.selection = null;
    this.refresh();
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(JSON.stringify(this.design));
    this.design = JSON.parse(next);
    this.selection = null;
    this.refresh();
  }

  // ── Queries ───────────────────────────────────────────────────────────

  selectedPart(): PartInstance | undefined {
    return this.selection?.kind === 'part' ? this.design.parts.find((p) => p.id === this.selection!.id) : undefined;
  }

  selectedLink(): Link | undefined {
    return this.selection?.kind === 'link' ? this.design.links.find((l) => l.id === this.selection!.id) : undefined;
  }

  private inBoard(h: Hole) {
    return h.c >= 0 && h.r >= 0 && h.c < this.design.board.cols && h.r < this.design.board.rows;
  }

  /** A part fits when every pin is on the board and in a hole no other part uses. */
  fits(inst: PartInstance): boolean {
    const holes = pinHoles(inst);
    if (!holes.every((h) => this.inBoard(h))) return false;
    return holes.every((h) => (this.pinsAt.get(holeKey(h)) ?? []).every((p) => p.partId === inst.id));
  }

  /** Other pins electrically joined to the given hole. */
  peers(h: Hole, exceptPart?: string): NetPin[] {
    const id = this.nets.netOf.get(holeKey(h));
    if (!id) return [];
    return this.nets.nets.get(id)!.pins.filter((p) => p.partId !== exceptPart);
  }

  // ── Commands ──────────────────────────────────────────────────────────

  setTool(t: Tool) {
    this.tool = t;
    this.start = null;
    if (t !== 'place') this.placing = null;
    this.view.setGhost(null);
    this.view.setPreview(null, null);
    this.status =
      t === 'wire'
        ? 'Wire: click a hole, then a second hole. Flip the board to wire the other side.'
        : t === 'bridge'
          ? 'Solder bridge: click a pad, then another pad in a straight line.'
          : t === 'erase'
            ? 'Erase: click a part, wire or bridge.'
            : '';
    this.onChange();
  }

  startPlacing(type: string) {
    const def = getDef(type);
    if (!def) return;
    this.selection = null;
    this.placing = { id: 'ghost', type, ref: '', pos: { x: 0, y: 0 }, rot: 0, props: defaultProps(def) };
    this.setTool('place');
    this.status = `Placing ${def.name}: click a hole. R rotates, Esc cancels.`;
    this.refresh(false);
  }

  private nextRef(prefix: string): string {
    const used = new Set(this.design.parts.map((p) => p.ref));
    let n = 1;
    while (used.has(prefix + n)) n++;
    return prefix + n;
  }

  rotateSelection() {
    if (this.placing) {
      this.placing.rot = (this.placing.rot + 1) % 4;
      this.updateGhost();
      return;
    }
    const part = this.selectedPart();
    if (!part) return;
    const turned = { ...part, rot: (part.rot + 1) % 4 };
    if (!this.fits(turned)) return this.say('No room to rotate here: move the part first.');
    this.mutate(() => (part.rot = turned.rot));
  }

  deleteSelection() {
    if (this.selection) this.remove(this.selection);
  }

  private remove(pick: Picked) {
    this.mutate(() => {
      if (pick.kind === 'part') this.design.parts = this.design.parts.filter((p) => p.id !== pick.id);
      else this.design.links = this.design.links.filter((l) => l.id !== pick.id);
      if (this.selection?.id === pick.id) this.selection = null;
    });
  }

  setProp(id: string, key: string, value: PropValue) {
    const part = this.design.parts.find((p) => p.id === id);
    if (!part) return;
    const changed = { ...part, props: { ...part.props, [key]: value } };
    if (!this.fits(changed)) return this.say('That size does not fit here: pins would collide or leave the board.');
    this.mutate(() => (part.props = changed.props));
  }

  setNote(id: string, note: string) {
    const part = this.design.parts.find((p) => p.id === id);
    if (part) this.mutate(() => (part.note = note || undefined));
  }

  setLinkColor(id: string, color: string) {
    const link = this.design.links.find((l) => l.id === id);
    if (link) this.mutate(() => (link.color = color));
  }

  setName(name: string) {
    this.mutate(() => (this.design.name = name || 'Untitled board'));
  }

  resizeBoard(cols: number, rows: number) {
    if (!(cols >= 2 && cols <= 80 && rows >= 2 && rows <= 80)) return this.say('Board size must be between 2 and 80 holes.');
    const ok = (h: Hole) => h.c < cols && h.r < rows;
    const blocked =
      this.design.parts.some((p) => !pinHoles(p).every(ok)) || this.design.links.some((l) => !linkHoles(l).every(ok));
    if (blocked) return this.say('Parts or wires sit outside that size: move or delete them first.');
    this.mutate(() => (this.design.board = { cols, rows, pitch: P }));
    this.view.setView('3d');
  }

  /** Highlight a whole net from the side panel. Pass null to clear. */
  pinNet(id: string | null) {
    this.pinnedNet = id;
    this.applyHighlight();
  }

  load(d: Design) {
    this.pushUndo(JSON.stringify(this.design));
    this.design = d;
    this.selection = null;
    this.status = `Loaded "${d.name}".`;
    this.refresh();
    this.view.setView('3d');
  }

  newDesign() {
    this.load(emptyDesign(this.design.board.cols, this.design.board.rows));
    this.status = 'New empty board.';
    this.onChange();
  }

  exportJSON(): string {
    return JSON.stringify(this.design, null, 2);
  }

  /** Place a part by type at a hole. Returns the instance, or null if it does not fit. */
  addPart(type: string, at: Hole, rot = 0, props: Record<string, PropValue> = {}): PartInstance | null {
    const def = getDef(type);
    if (!def) return null;
    const inst: PartInstance = { id: uid(), type, ref: this.nextRef(def.prefix), pos: toVec(at), rot, props: { ...defaultProps(def), ...props } };
    if (!this.fits(inst)) return null;
    this.mutate(() => this.design.parts.push(inst));
    return inst;
  }

  addLink(kind: Link['kind'], a: Hole, b: Hole, side = this.view.viewSide(), color = this.wireColor) {
    this.mutate(() => this.design.links.push({ id: uid(), kind, side, a: toVec(a), b: toVec(b), color: kind === 'wire' ? color : '#d9dde3' }));
  }

  // ── Pointer handling ──────────────────────────────────────────────────

  private pointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    this.down = { x: e.clientX, y: e.clientY };
    if (this.tool !== 'select') return;
    const pick = this.view.pickObject(e);
    const grab = this.view.pickHole(e);
    if (pick?.kind === 'part' && grab) {
      const part = this.design.parts.find((p) => p.id === pick.id)!;
      this.drag = { id: part.id, grab, orig: toHole(part.pos), before: JSON.stringify(this.design), moved: false };
      this.view.controls.enabled = false;
      if (this.selection?.id !== pick.id) {
        this.selection = pick;
        this.refresh(false);
      }
    }
  }

  private pointerMove(e: PointerEvent) {
    const hole = this.view.pickHole(e);
    if (this.drag) {
      if (!hole) return;
      const part = this.design.parts.find((p) => p.id === this.drag!.id)!;
      const target = { c: this.drag.orig.c + hole.c - this.drag.grab.c, r: this.drag.orig.r + hole.r - this.drag.grab.r };
      if (sameHole(target, toHole(part.pos))) return;
      const moved = { ...part, pos: toVec(target) };
      if (!this.fits(moved)) return;
      part.pos = moved.pos;
      this.drag.moved = true;
      this.refresh(false);
      return;
    }
    if (e.buttons) return; // orbiting
    const changed = !this.hover !== !hole || (hole && this.hover && !sameHole(hole, this.hover));
    this.hover = hole;
    if (changed) {
      this.updateGhost();
      if (this.start && hole) this.view.setPreview(this.start, this.snap(hole), this.view.viewSide(), this.tool === 'wire' ? this.wireColor : '#d9dde3');
      this.applyHighlight();
    }
    this.onHover(hole ? { x: e.clientX, y: e.clientY, text: this.describe(hole) } : null);
  }

  private pointerUp(e: PointerEvent) {
    this.view.controls.enabled = true;
    const down = this.down;
    this.down = null;
    if (this.drag) {
      const d = this.drag;
      this.drag = null;
      if (d.moved) {
        this.pushUndo(d.before);
        this.refresh();
      }
      return;
    }
    if (e.button !== 0 || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    this.click(e);
  }

  private click(e: PointerEvent) {
    const hole = this.view.pickHole(e);
    switch (this.tool) {
      case 'select':
        this.selection = this.view.pickObject(e);
        this.status = '';
        this.refresh(false);
        break;
      case 'erase': {
        const pick = this.view.pickObject(e);
        if (pick) this.remove(pick);
        break;
      }
      case 'place': {
        if (!hole || !this.placing) break;
        const made = this.addPart(this.placing.type, hole, this.placing.rot, this.placing.props);
        if (!made) this.say('Does not fit here: a pin is off the board or the hole is taken.');
        else this.say(`Placed ${made.ref}. Click to place another, Esc to stop.`);
        this.updateGhost();
        break;
      }
      case 'wire':
      case 'bridge': {
        if (!hole) break;
        if (!this.start) {
          this.start = hole;
          this.say('Now click the end point. Esc cancels.');
          break;
        }
        const end = this.snap(hole);
        const start = this.start;
        this.start = null;
        this.view.setPreview(null, null);
        if (sameHole(start, end)) break;
        this.addLink(this.tool, start, end);
        break;
      }
    }
  }

  /** Bridges only run along rows, columns or 45° diagonals. */
  private snap(h: Hole): Hole {
    if (this.tool !== 'bridge' || !this.start) return h;
    const dc = h.c - this.start.c;
    const dr = h.r - this.start.r;
    if (dc === 0 || dr === 0 || Math.abs(dc) === Math.abs(dr)) return h;
    return Math.abs(dc) >= Math.abs(dr) ? { c: h.c, r: this.start.r } : { c: this.start.c, r: h.r };
  }

  private updateGhost() {
    if (this.tool !== 'place' || !this.placing || !this.hover) return this.view.setGhost(null);
    this.placing.pos = toVec(this.hover);
    this.view.setGhost(this.placing, this.fits(this.placing));
  }

  private applyHighlight() {
    const id = (this.hover && this.nets.netOf.get(holeKey(this.hover))) || this.pinnedNet;
    const net = id ? this.nets.nets.get(id) : undefined;
    this.view.setHighlight(net ? net.holes : []);
  }

  private describe(h: Hole): string {
    const here = this.pinsAt.get(holeKey(h)) ?? [];
    const where = `col ${h.c + 1}, row ${h.r + 1}`;
    const others = this.peers(h).filter((p) => !here.some((q) => q.partId === p.partId && q.name === p.name));
    const list = (ps: NetPin[]) => ps.map((p) => `${p.ref}.${p.name}`).join(', ');
    if (!here.length) return others.length ? `${where}  ·  joined to ${list(others)}` : where;
    return `${list(here)}${others.length ? `  ↔  ${list(others)}` : ''}  ·  ${where}`;
  }

  private key(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') return e.preventDefault(), e.shiftKey ? this.redo() : this.undo();
    if (mod && k === 'y') return e.preventDefault(), this.redo();
    if (mod) return;
    if (k === 'escape') {
      this.selection = null;
      this.setTool('select');
      this.refresh(false);
    } else if (k === 'v') this.setTool('select');
    else if (k === 'w') this.setTool('wire');
    else if (k === 'b') this.setTool('bridge');
    else if (k === 'e') this.setTool('erase');
    else if (k === 'r') this.rotateSelection();
    else if (k === 'delete' || k === 'backspace') this.deleteSelection();
  }
}

/** Demo board: an ESP32 driving a TCA9548A over I²C, wired on the underside. */
export function loadExample(ed: Editor) {
  ed.load({ ...emptyDesign(24, 18), name: 'ESP32 + TCA9548A example' });
  const mcu = ed.addPart('esp32-devkit-38', { c: 20, r: 0 }, 1, { rowSpan: 9 });
  const mux = ed.addPart('tca9548a', { c: 16, r: 10 }, 1);
  if (!mcu || !mux) return;
  const at = (p: PartInstance, name: string): Hole => pinHoles(p).find((h) => h.name === name)!;
  const wires: [string, string, string][] = [
    ['3V3', 'VIN', '#e5484d'],
    ['21', 'SDA', '#3e63dd'],
    ['22', 'SCL', '#f5d90a'],
  ];
  for (const [from, to, color] of wires) ed.addLink('wire', at(mcu, from), at(mux, to), 'bottom', color);
  const gnds = pinHoles(mcu).filter((h) => h.name === 'GND');
  ed.addLink('wire', gnds[0], at(mux, 'GND'), 'bottom', '#1c1c1f');
  ed.status = 'Example loaded. Hover a pin to trace its net; use Bottom to see the wiring.';
  ed.onChange();
}
