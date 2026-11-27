// Design document model. All positions are stored in millimetres so the same
// format can later describe boards that are not on a fixed perfboard grid.

export const PITCH = 2.54;

export type Side = 'top' | 'bottom';

export interface Vec {
  x: number;
  y: number;
}

export type PropValue = number | string;

export interface PartInstance {
  id: string;
  type: string;
  ref: string;
  /** Position of the part's first pin, in mm from hole (0,0). */
  pos: Vec;
  /** Quarter turns, 0..3. */
  rot: number;
  /** Board face the part is mounted on. Defaults to top. */
  side?: Side;
  /** Mounted on its own female header socket instead of soldered directly. */
  socket?: boolean;
  note?: string;
  props: Record<string, PropValue>;
}

export interface Link {
  id: string;
  /** wire: insulated jumper between two holes. bridge: solder joining every pad on a straight line. */
  kind: 'wire' | 'bridge';
  side: Side;
  a: Vec;
  b: Vec;
  color: string;
}

export interface Design {
  app: 'visioboard';
  version: 1;
  name: string;
  board: { cols: number; rows: number; pitch: number };
  parts: PartInstance[];
  links: Link[];
}

export interface Hole {
  c: number;
  r: number;
}

export const toHole = (v: Vec): Hole => ({ c: Math.round(v.x / PITCH), r: Math.round(v.y / PITCH) });
export const toVec = (h: Hole): Vec => ({ x: h.c * PITCH, y: h.r * PITCH });
export const holeKey = (h: Hole): string => `${h.c},${h.r}`;
export const sameHole = (a: Hole, b: Hole): boolean => a.c === b.c && a.r === b.r;

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function emptyDesign(cols = 24, rows = 18): Design {
  return {
    app: 'visioboard',
    version: 1,
    name: 'Untitled board',
    board: { cols, rows, pitch: PITCH },
    parts: [],
    links: [],
  };
}

/** Every hole a link touches electrically (bridges join all pads along their line). */
export function linkHoles(l: Link): Hole[] {
  const a = toHole(l.a);
  const b = toHole(l.b);
  if (l.kind === 'wire') return [a, b];
  const n = Math.max(Math.abs(b.c - a.c), Math.abs(b.r - a.r));
  const sc = Math.sign(b.c - a.c);
  const sr = Math.sign(b.r - a.r);
  const out: Hole[] = [];
  for (let i = 0; i <= n; i++) out.push({ c: a.c + sc * i, r: a.r + sr * i });
  return out;
}

/** Parse and validate a saved design. Throws with a readable message on bad input. */
export function parseDesign(text: string): Design {
  let d: any;
  try {
    d = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON.');
  }
  if (!d || d.app !== 'visioboard') throw new Error('Not a VisioBoard design file.');
  if (!d.board || !Number.isInteger(d.board.cols) || !Number.isInteger(d.board.rows))
    throw new Error('Design has no valid board size.');
  if (!Array.isArray(d.parts) || !Array.isArray(d.links)) throw new Error('Design is missing parts or links.');
  return {
    app: 'visioboard',
    version: 1,
    name: typeof d.name === 'string' ? d.name : 'Untitled board',
    board: { cols: d.board.cols, rows: d.board.rows, pitch: PITCH },
    parts: d.parts.map((p: any) => ({
      id: String(p.id ?? uid()),
      type: String(p.type),
      ref: String(p.ref ?? '?'),
      pos: { x: Number(p.pos?.x) || 0, y: Number(p.pos?.y) || 0 },
      rot: (((Number(p.rot) || 0) % 4) + 4) % 4,
      side: p.side === 'bottom' ? 'bottom' : undefined,
      socket: p.socket === true ? true : undefined,
      note: typeof p.note === 'string' ? p.note : undefined,
      props: p.props && typeof p.props === 'object' ? p.props : {},
    })),
    links: d.links.map((l: any) => ({
      id: String(l.id ?? uid()),
      kind: l.kind === 'bridge' ? 'bridge' : 'wire',
      side: l.side === 'top' ? 'top' : 'bottom',
      a: { x: Number(l.a?.x) || 0, y: Number(l.a?.y) || 0 },
      b: { x: Number(l.b?.x) || 0, y: Number(l.b?.y) || 0 },
      color: typeof l.color === 'string' ? l.color : '#e5484d',
    })),
  };
}
