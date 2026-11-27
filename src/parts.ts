// Parts library. Every part is a small data definition: pin names, pin
// positions on the 2.54 mm grid, a body outline and a low-poly shape style.
// Adding a new breakout board is one call to dual() or single().

import { Hole, PITCH as P, PartInstance, PropValue, toHole } from './model';

export interface Pin {
  name: string;
  /** Grid offsets from the part origin, before rotation. */
  x: number;
  y: number;
  /** Direction the silkscreen label runs from the pin (towards the body). */
  lx: number;
  ly: number;
}

export interface Resolved {
  pins: Pin[];
  /** Body outline in mm, in the part's local frame. */
  body: { x0: number; y0: number; x1: number; y1: number };
  /** Groups of pin indices that are joined inside the part (e.g. several GND pins). */
  internal: number[][];
  /** Decorations that depend on the instance's props; replaces the definition's list. */
  decor?: Decor[];
}

export interface Decor {
  shape: 'box' | 'cyl';
  /** Centre as a fraction of the body (0..1). */
  u: number;
  v: number;
  /** Size in mm: w along x, d along y, h tall. For cyl, w is the diameter. */
  w: number;
  d: number;
  h: number;
  color: number;
  metal?: boolean;
}

export interface PropDef {
  key: string;
  label: string;
  type: 'int' | 'color';
  min?: number;
  max?: number;
  def: PropValue;
}

export type Shape =
  | 'module'
  | 'dip'
  | 'resistor'
  | 'diode'
  | 'disc'
  | 'can'
  | 'led'
  | 'buzzer'
  | 'button'
  | 'to92'
  | 'to220'
  | 'terminal'
  | 'header'
  | 'socket'
  | 'ring'
  | 'trimmer';

export interface PartDef {
  id: string;
  name: string;
  category: string;
  prefix: string;
  shape: Shape;
  color: number;
  props: PropDef[];
  decor: Decor[];
  resolve(props: Record<string, PropValue>): Resolved;
}

const num = (props: Record<string, PropValue>, key: string, def: number): number => {
  const v = Number(props[key]);
  return Number.isFinite(v) ? v : def;
};

/** Pins that share a supply name on one part are joined inside it. */
function autoInternal(pins: Pin[]): number[][] {
  const groups = new Map<string, number[]>();
  pins.forEach((p, i) => {
    if (/^(GND|3V3|5V)$/.test(p.name)) groups.set(p.name, [...(groups.get(p.name) ?? []), i]);
  });
  return [...groups.values()].filter((g) => g.length > 1);
}

interface DualOpts {
  id: string;
  name: string;
  category: string;
  prefix?: string;
  /** Pin names top to bottom on each row. */
  left: string[];
  right: string[];
  /** Default distance between the two pin rows, in holes. */
  rowSpan: number;
  color: number;
  /** Body overhang past the pins, mm. */
  side?: number;
  top?: number;
  bottom?: number;
  decor?: Decor[];
  shape?: Shape;
}

/** Board or chip with two parallel pin rows. Row spacing is adjustable per instance. */
function dual(o: DualOpts): PartDef {
  const side = o.side ?? 1.4;
  const top = o.top ?? 1.6;
  const bottom = o.bottom ?? 1.6;
  return {
    id: o.id,
    name: o.name,
    category: o.category,
    prefix: o.prefix ?? 'U',
    shape: o.shape ?? 'module',
    color: o.color,
    decor: o.decor ?? [],
    props: [{ key: 'rowSpan', label: 'Row spacing (holes)', type: 'int', min: 2, max: 16, def: o.rowSpan }],
    resolve(props) {
      const rs = num(props, 'rowSpan', o.rowSpan);
      const pins: Pin[] = [
        ...o.left.map((name, i) => ({ name, x: 0, y: i, lx: 1, ly: 0 })),
        ...o.right.map((name, i) => ({ name, x: rs, y: i, lx: -1, ly: 0 })),
      ];
      const len = Math.max(o.left.length, o.right.length);
      return {
        pins,
        body: { x0: -side, y0: -top, x1: rs * P + side, y1: (len - 1) * P + bottom },
        internal: autoInternal(pins),
      };
    },
  };
}

/** DIP chip: names in datasheet pin order (1..N, counter-clockwise). */
function dip(id: string, name: string, names: string[], category = 'Logic ICs'): PartDef {
  const half = names.length / 2;
  return dual({
    id,
    name,
    category,
    left: names.slice(0, half),
    right: names.slice(half).reverse(),
    rowSpan: 3,
    color: 0x1c1c1f,
    side: -0.6,
    top: 1.2,
    bottom: 1.2,
    shape: 'dip',
  });
}

interface SingleOpts {
  id: string;
  name: string;
  category: string;
  prefix?: string;
  pins: string[];
  /** Body depth away from the pin row, mm. */
  depth: number;
  /** Extra body width past the end pins, mm. */
  side?: number;
  color: number;
  decor?: Decor[];
}

/** Breakout board with one pin row along an edge. */
function single(o: SingleOpts): PartDef {
  const side = o.side ?? 1.4;
  return {
    id: o.id,
    name: o.name,
    category: o.category,
    prefix: o.prefix ?? 'U',
    shape: 'module',
    color: o.color,
    decor: o.decor ?? [],
    props: [],
    resolve() {
      const pins: Pin[] = o.pins.map((name, i) => ({ name, x: i, y: 0, lx: 0, ly: 1 }));
      return {
        pins,
        body: { x0: -side, y0: -1.5, x1: (o.pins.length - 1) * P + side, y1: o.depth - 1.5 },
        internal: autoInternal(pins),
      };
    },
  };
}

/** Two-lead part whose lead spacing can be changed per instance. */
function twoLead(
  id: string,
  name: string,
  prefix: string,
  shape: Shape,
  color: number,
  span: number,
  names: [string, string] = ['1', '2'],
  extra: PropDef[] = [],
): PartDef {
  return {
    id,
    name,
    category: 'Passives',
    prefix,
    shape,
    color,
    decor: [],
    props: [{ key: 'span', label: 'Lead spacing (holes)', type: 'int', min: 1, max: 12, def: span }, ...extra],
    resolve(props) {
      const s = num(props, 'span', span);
      return {
        pins: [
          { name: names[0], x: 0, y: 0, lx: 0, ly: 1 },
          { name: names[1], x: s, y: 0, lx: 0, ly: 1 },
        ],
        body: { x0: -1.2, y0: -1.2, x1: s * P + 1.2, y1: 1.2 },
        internal: [],
      };
    },
  };
}

function fixed(
  id: string,
  name: string,
  category: string,
  prefix: string,
  shape: Shape,
  color: number,
  pins: [string, number, number][],
  internal: number[][] = [],
): PartDef {
  return {
    id,
    name,
    category,
    prefix,
    shape,
    color,
    decor: [],
    props: [],
    resolve() {
      const ps = pins.map(([n, x, y]) => ({ name: n, x, y, lx: 0, ly: 1 }));
      const xs = ps.map((p) => p.x * P);
      const ys = ps.map((p) => p.y * P);
      return {
        pins: ps,
        body: { x0: Math.min(...xs) - 1.2, y0: Math.min(...ys) - 1.2, x1: Math.max(...xs) + 1.2, y1: Math.max(...ys) + 1.2 },
        internal,
      };
    },
  };
}

const SILVER = 0xc4c9d0;
const CHIP = 0x18181b;
const range = (n: number, f: (i: number) => string): string[] => Array.from({ length: n }, (_, i) => f(i));

/** Single-row strip of N positions: male pin header or female socket. */
const strip = (id: string, name: string, shape: Shape): PartDef => ({
  id,
  name,
  category: 'Connectors',
  prefix: 'J',
  shape,
  color: 0x1a1a1c,
  decor: [],
  props: [{ key: 'count', label: 'Pins', type: 'int', min: 1, max: 40, def: 4 }],
  resolve(props) {
    const n = num(props, 'count', 4);
    return {
      pins: range(n, (i) => String(i + 1)).map((name, i) => ({ name, x: i, y: 0, lx: 0, ly: 1 })),
      body: { x0: -1.27, y0: -1.27, x1: (n - 1) * P + 1.27, y1: 1.27 },
      internal: [],
    };
  },
});

// ── WS2812 addressable LEDs ─────────────────────────────────────────────
const LED_CATEGORY = 'WS2812 LEDs';
const pixel = (u: number, v: number): Decor => ({ shape: 'box', u, v, w: 4.4, d: 4.4, h: 1.6, color: 0xf4f4f0 });
const row = (names: string[], y: number, ly: number): Pin[] => names.map((name, i) => ({ name, x: i, y, lx: 0, ly }));

/** Strip soldered flat on the board: input pads at one end, output pads at the other, 3 holes per LED. */
const ws2812Strip: PartDef = {
  id: 'ws2812-strip',
  name: 'WS2812 LED strip',
  category: LED_CATEGORY,
  prefix: 'LED',
  shape: 'module',
  color: 0x16171b,
  decor: [],
  props: [{ key: 'count', label: 'LEDs', type: 'int', min: 1, max: 30, def: 8 }],
  resolve(props) {
    const n = num(props, 'count', 8);
    const far = n * 3 + 2;
    const pins = [...row(['5V', 'DIN', 'GND'], 0, 1), ...row(['5V', 'DOUT', 'GND'], far, -1)];
    const body = { x0: P - 5, y0: -1.6, x1: P + 5, y1: far * P + 1.6 };
    const depth = body.y1 - body.y0;
    return {
      pins,
      body,
      internal: autoInternal(pins),
      decor: Array.from({ length: n }, (_, i) => pixel(0.5, (1.6 + (i * 3 + 2.5) * P) / depth)),
    };
  },
};

/** 8×8 panel, 65 mm square, with input pads on one edge and output pads on the opposite edge. */
const ws2812Matrix: PartDef = {
  id: 'ws2812-matrix-8x8',
  name: 'WS2812 matrix 8×8',
  category: LED_CATEGORY,
  prefix: 'LED',
  shape: 'module',
  color: 0x16171b,
  decor: Array.from({ length: 64 }, (_, i) => pixel((6.95 + (i % 8) * 7.3) / 65, (6.95 + Math.floor(i / 8) * 7.3) / 65)),
  props: [],
  resolve() {
    const far = 24;
    const pins = [...row(['DIN', '5V', 'GND'], 0, 1), ...row(['DOUT', '5V', 'GND'], far, -1)];
    const edge = (65 - far * P) / 2;
    return { pins, body: { x0: P - 32.5, y0: -edge, x1: P + 32.5, y1: far * P + edge }, internal: autoInternal(pins) };
  },
};

/** Ring of LEDs. Diameter follows the LED count (12 → 37 mm, 16 → 46 mm, 24 → 66 mm). */
const ws2812Ring: PartDef = {
  id: 'ws2812-ring',
  name: 'WS2812 LED ring',
  category: LED_CATEGORY,
  prefix: 'LED',
  shape: 'ring',
  color: 0x16171b,
  decor: [],
  props: [{ key: 'count', label: 'LEDs', type: 'int', min: 8, max: 60, def: 12 }],
  resolve(props) {
    const od = num(props, 'count', 12) * 2.4 + 8;
    const cx = 1.5 * P;
    return {
      pins: row(['DIN', '5V', 'GND', 'DOUT'], 0, 1),
      body: { x0: cx - od / 2, y0: -3.5, x1: cx + od / 2, y1: od - 3.5 },
      internal: [],
    };
  },
};

const I2C_MUX_LEFT = ['VIN', 'GND', 'SDA', 'SCL', 'RST', 'A0', 'A1', 'A2', 'SD0', 'SC0', 'SD1', 'SC1'];
const I2C_MUX_RIGHT = ['SC7', 'SD7', 'SC6', 'SD6', 'SC5', 'SD5', 'SC4', 'SD4', 'SC3', 'SD3', 'SC2', 'SD2'];

export const PARTS: PartDef[] = [
  // ── Microcontroller boards ────────────────────────────────────────────
  dual({
    id: 'esp32-devkit-38',
    name: 'ESP32 DevKit (38-pin)',
    category: 'Microcontrollers',
    left: ['3V3', 'EN', 'VP', 'VN', '34', '35', '32', '33', '25', '26', '27', '14', '12', 'GND', '13', 'D2', 'D3', 'CMD', '5V'],
    right: ['GND', '23', '22', 'TX', 'RX', '21', 'GND', '19', '18', '5', '17', '16', '4', '0', '2', '15', 'D1', 'D0', 'CLK'],
    rowSpan: 10,
    color: 0x16171b,
    side: 1.3,
    top: 7,
    bottom: 3.3,
    decor: [
      { shape: 'box', u: 0.5, v: 0.05, w: 18, d: 5.2, h: 0.25, color: 0x0a0a0a },
      { shape: 'box', u: 0.5, v: 0.27, w: 15.5, d: 17.5, h: 2.8, color: SILVER, metal: true },
      { shape: 'box', u: 0.5, v: 0.68, w: 5, d: 5, h: 0.9, color: CHIP },
      { shape: 'box', u: 0.5, v: 0.955, w: 9, d: 6.5, h: 3.1, color: SILVER, metal: true },
      { shape: 'box', u: 0.2, v: 0.93, w: 3, d: 4, h: 1.6, color: 0x8d9299, metal: true },
      { shape: 'box', u: 0.8, v: 0.93, w: 3, d: 4, h: 1.6, color: 0x8d9299, metal: true },
    ],
  }),
  dual({
    id: 'esp32-devkit-30',
    name: 'ESP32 DevKit V1 (30-pin)',
    category: 'Microcontrollers',
    left: ['EN', 'VP', 'VN', '34', '35', '32', '33', '25', '26', '27', '14', '12', '13', 'GND', 'VIN'],
    right: ['23', '22', 'TX0', 'RX0', '21', '19', '18', '5', 'TX2', 'RX2', '4', '2', '15', 'GND', '3V3'],
    rowSpan: 10,
    color: 0x16171b,
    side: 1.3,
    top: 9,
    bottom: 5,
    decor: [
      { shape: 'box', u: 0.5, v: 0.05, w: 18, d: 5, h: 0.25, color: 0x0a0a0a },
      { shape: 'box', u: 0.5, v: 0.32, w: 15.5, d: 17.5, h: 2.8, color: SILVER, metal: true },
      { shape: 'box', u: 0.5, v: 0.94, w: 7.5, d: 5.5, h: 2.6, color: SILVER, metal: true },
      { shape: 'box', u: 0.2, v: 0.92, w: 3, d: 4, h: 1.6, color: 0x8d9299, metal: true },
      { shape: 'box', u: 0.8, v: 0.92, w: 3, d: 4, h: 1.6, color: 0x8d9299, metal: true },
    ],
  }),
  dual({
    id: 'esp32-s3-devkitc',
    name: 'ESP32-S3 DevKitC-1',
    category: 'Microcontrollers',
    left: ['3V3', '3V3', 'RST', '4', '5', '6', '7', '15', '16', '17', '18', '8', '3', '46', '9', '10', '11', '12', '13', '14', '5V', 'GND'],
    right: ['GND', 'TX', 'RX', '1', '2', '42', '41', '40', '39', '38', '37', '36', '35', '0', '45', '48', '47', '21', '20', '19', 'GND', 'GND'],
    rowSpan: 9,
    color: 0x16171b,
    side: 1.3,
    top: 6.5,
    bottom: 3,
    decor: [
      { shape: 'box', u: 0.5, v: 0.045, w: 18, d: 5, h: 0.25, color: 0x0a0a0a },
      { shape: 'box', u: 0.5, v: 0.25, w: 15.5, d: 17.5, h: 2.8, color: SILVER, metal: true },
      { shape: 'box', u: 0.3, v: 0.955, w: 8, d: 6, h: 3, color: SILVER, metal: true },
      { shape: 'box', u: 0.7, v: 0.955, w: 8, d: 6, h: 3, color: SILVER, metal: true },
    ],
  }),
  dual({
    id: 'esp32-c3-supermini',
    name: 'ESP32-C3 SuperMini',
    category: 'Microcontrollers',
    left: ['5', '6', '7', '8', '9', '10', '20', '21'],
    right: ['5V', 'GND', '3V3', '4', '3', '2', '1', '0'],
    rowSpan: 6,
    color: 0x16171b,
    side: 1.4,
    top: 2.4,
    bottom: 2.4,
    decor: [
      { shape: 'box', u: 0.5, v: 0.08, w: 8.5, d: 6.5, h: 3, color: SILVER, metal: true },
      { shape: 'box', u: 0.5, v: 0.5, w: 5, d: 5, h: 0.9, color: CHIP },
      { shape: 'box', u: 0.5, v: 0.88, w: 6, d: 2.5, h: 1, color: 0xb5651d },
    ],
  }),
  dual({
    id: 'arduino-nano',
    name: 'Arduino Nano',
    category: 'Microcontrollers',
    left: ['D13', '3V3', 'AREF', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', '5V', 'RST', 'GND', 'VIN'],
    right: ['D12', 'D11', 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'GND', 'RST', 'RX0', 'TX1'],
    rowSpan: 6,
    color: 0x0d5c8c,
    side: 1.4,
    top: 3.8,
    bottom: 3.8,
    decor: [
      { shape: 'box', u: 0.5, v: 0.03, w: 7.5, d: 6, h: 3.6, color: SILVER, metal: true },
      { shape: 'box', u: 0.5, v: 0.45, w: 7, d: 7, h: 1, color: CHIP },
      { shape: 'box', u: 0.5, v: 0.72, w: 3.5, d: 3.5, h: 1.6, color: 0x8d9299, metal: true },
    ],
  }),
  dual({
    id: 'pi-pico',
    name: 'Raspberry Pi Pico',
    category: 'Microcontrollers',
    left: ['GP0', 'GP1', 'GND', 'GP2', 'GP3', 'GP4', 'GP5', 'GND', 'GP6', 'GP7', 'GP8', 'GP9', 'GND', 'GP10', 'GP11', 'GP12', 'GP13', 'GND', 'GP14', 'GP15'],
    right: ['VBUS', 'VSYS', 'GND', '3VEN', '3V3', 'VREF', 'GP28', 'AGND', 'GP27', 'GP26', 'RUN', 'GP22', 'GND', 'GP21', 'GP20', 'GP19', 'GP18', 'GND', 'GP17', 'GP16'],
    rowSpan: 7,
    color: 0x0f6b3c,
    side: 1.6,
    top: 1.4,
    bottom: 1.4,
    decor: [
      { shape: 'box', u: 0.5, v: 0.03, w: 7.5, d: 5.5, h: 2.6, color: SILVER, metal: true },
      { shape: 'box', u: 0.5, v: 0.52, w: 7, d: 7, h: 0.9, color: CHIP },
      { shape: 'box', u: 0.3, v: 0.25, w: 3.5, d: 4, h: 1.6, color: 0xe8e8e8 },
    ],
  }),

  // ── Breakout boards ───────────────────────────────────────────────────
  dual({
    id: 'tca9548a',
    name: 'TCA9548A I²C multiplexer',
    category: 'Breakout boards',
    left: I2C_MUX_LEFT,
    right: I2C_MUX_RIGHT,
    rowSpan: 7,
    color: 0x5a2a82,
    side: 1.8,
    top: 1.8,
    bottom: 1.8,
    decor: [
      { shape: 'box', u: 0.5, v: 0.5, w: 4.4, d: 7.8, h: 1, color: CHIP },
      { shape: 'cyl', u: 0.5, v: 0.14, w: 3, d: 3, h: 0.06, color: 0x0d0d0f },
      { shape: 'cyl', u: 0.5, v: 0.86, w: 3, d: 3, h: 0.06, color: 0x0d0d0f },
    ],
  }),
  dual({
    id: 'pca9548a',
    name: 'PCA9548A I²C multiplexer',
    category: 'Breakout boards',
    left: I2C_MUX_LEFT,
    right: I2C_MUX_RIGHT,
    rowSpan: 7,
    color: 0x0d5c8c,
    side: 1.8,
    top: 1.8,
    bottom: 1.8,
    decor: [
      { shape: 'box', u: 0.5, v: 0.5, w: 4.4, d: 7.8, h: 1, color: CHIP },
      { shape: 'cyl', u: 0.5, v: 0.14, w: 3, d: 3, h: 0.06, color: 0x0d0d0f },
      { shape: 'cyl', u: 0.5, v: 0.86, w: 3, d: 3, h: 0.06, color: 0x0d0d0f },
    ],
  }),
  dual({
    id: 'max3485-module',
    name: 'MAX3485 RS-485 module',
    category: 'Breakout boards',
    left: ['RO', 'RE', 'DE', 'DI'],
    right: ['VCC', 'B', 'A', 'GND'],
    rowSpan: 15,
    color: 0xb3261e,
    side: 2.9,
    top: 3.2,
    bottom: 3.2,
    decor: [
      { shape: 'box', u: 0.4, v: 0.5, w: 4, d: 5, h: 1.5, color: CHIP },
      { shape: 'box', u: 0.72, v: 0.5, w: 8, d: 10.2, h: 8, color: 0x2a6fd6 },
    ],
  }),
  // Small blue auto-direction board: 5-pin logic header on one edge, 3-pin bus header on the other.
  dual({
    id: 'max3485-mini',
    name: 'MAX3485 RS-485 mini board',
    category: 'Breakout boards',
    left: ['VCC', 'TXD', 'RXD', 'EN', 'GND'],
    right: ['A', 'B', 'GND'],
    rowSpan: 3,
    color: 0x1f5fc4,
    side: 1.5,
    top: 1.5,
    bottom: 1.5,
    decor: [
      { shape: 'box', u: 0.5, v: 0.42, w: 4, d: 5, h: 1.5, color: CHIP },
      { shape: 'box', u: 0.5, v: 0.86, w: 1.6, d: 0.9, h: 0.6, color: 0xf4f4f0 },
    ],
  }),
  dual({
    id: 'level-shifter-4',
    name: 'Logic level shifter (4-ch)',
    category: 'Breakout boards',
    left: ['LV1', 'LV2', 'LV', 'GND', 'LV3', 'LV4'],
    right: ['HV1', 'HV2', 'HV', 'GND', 'HV3', 'HV4'],
    rowSpan: 4,
    color: 0xb3261e,
    decor: [
      { shape: 'box', u: 0.5, v: 0.2, w: 2.6, d: 2.2, h: 0.9, color: CHIP },
      { shape: 'box', u: 0.5, v: 0.4, w: 2.6, d: 2.2, h: 0.9, color: CHIP },
      { shape: 'box', u: 0.5, v: 0.6, w: 2.6, d: 2.2, h: 0.9, color: CHIP },
      { shape: 'box', u: 0.5, v: 0.8, w: 2.6, d: 2.2, h: 0.9, color: CHIP },
    ],
  }),
  dual({
    id: 'txs0108e',
    name: 'TXS0108E level shifter (8-ch)',
    category: 'Breakout boards',
    left: ['VA', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'OE'],
    right: ['VB', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'GND'],
    rowSpan: 6,
    color: 0x0d5c8c,
    decor: [{ shape: 'box', u: 0.5, v: 0.5, w: 4.4, d: 6.5, h: 1, color: CHIP }],
  }),
  single({
    id: 'ads1115',
    name: 'ADS1115 16-bit ADC',
    category: 'Breakout boards',
    pins: ['VDD', 'GND', 'SCL', 'SDA', 'ADDR', 'ALRT', 'A0', 'A1', 'A2', 'A3'],
    depth: 17,
    color: 0x0d5c8c,
    decor: [{ shape: 'box', u: 0.5, v: 0.62, w: 3, d: 3, h: 1, color: CHIP }],
  }),

  // ── Sensors & displays ────────────────────────────────────────────────
  dual({
    id: 'mpr121',
    name: 'MPR121 capacitive touch (12-ch)',
    category: 'Sensors & displays',
    left: ['3V3', 'IRQ', 'SCL', 'SDA', 'ADD', 'GND'],
    right: range(12, (i) => `E${i}`),
    rowSpan: 7,
    color: 0xb3261e,
    side: 1.5,
    top: 1.6,
    bottom: 1.6,
    decor: [{ shape: 'box', u: 0.5, v: 0.5, w: 3, d: 3, h: 0.9, color: CHIP }],
  }),
  single({
    id: 'bme280',
    name: 'BME280 temp / humidity / pressure',
    category: 'Sensors & displays',
    pins: ['VIN', 'GND', 'SCL', 'SDA'],
    depth: 13,
    color: 0x5a2a82,
    decor: [{ shape: 'box', u: 0.5, v: 0.68, w: 2.5, d: 2.5, h: 1, color: SILVER, metal: true }],
  }),
  single({
    id: 'mpu6050',
    name: 'MPU-6050 gyro / accelerometer',
    category: 'Sensors & displays',
    pins: ['VCC', 'GND', 'SCL', 'SDA', 'XDA', 'XCL', 'AD0', 'INT'],
    depth: 16,
    color: 0x0d5c8c,
    decor: [{ shape: 'box', u: 0.5, v: 0.62, w: 4, d: 4, h: 0.9, color: CHIP }],
  }),
  single({
    id: 'vl53l0x',
    name: 'VL53L0X distance sensor',
    category: 'Sensors & displays',
    pins: ['VIN', 'GND', 'SCL', 'SDA', 'GPIO1', 'XSHUT'],
    depth: 13,
    color: 0x5a2a82,
    decor: [{ shape: 'box', u: 0.5, v: 0.7, w: 4.4, d: 2.4, h: 1, color: CHIP }],
  }),
  single({
    id: 'oled-096',
    name: 'OLED 0.96" SSD1306 (I²C)',
    category: 'Sensors & displays',
    pins: ['GND', 'VCC', 'SCL', 'SDA'],
    depth: 27,
    side: 9.7,
    color: 0x0d3f7a,
    decor: [{ shape: 'box', u: 0.5, v: 0.56, w: 25, d: 15, h: 1.4, color: 0x050507 }],
  }),
  single({
    id: 'hc-sr04',
    name: 'HC-SR04 ultrasonic',
    category: 'Sensors & displays',
    pins: ['VCC', 'TRIG', 'ECHO', 'GND'],
    depth: 20,
    side: 18.7,
    color: 0x0d5c8c,
    decor: [
      { shape: 'cyl', u: 0.2, v: 0.56, w: 16, d: 16, h: 12, color: SILVER, metal: true },
      { shape: 'cyl', u: 0.8, v: 0.56, w: 16, d: 16, h: 12, color: SILVER, metal: true },
    ],
  }),
  single({
    id: 'dht22',
    name: 'DHT22 module',
    category: 'Sensors & displays',
    pins: ['VCC', 'DATA', 'GND'],
    depth: 28,
    side: 5,
    color: 0x16171b,
    decor: [{ shape: 'box', u: 0.5, v: 0.6, w: 14, d: 19, h: 7, color: 0xf2f2f0 }],
  }),
  fixed('ds18b20', 'DS18B20 temperature (TO-92)', 'Sensors & displays', 'U', 'to92', CHIP, [
    ['GND', 0, 0],
    ['DQ', 1, 0],
    ['VDD', 2, 0],
  ]),

  // ── WS2812 LEDs ───────────────────────────────────────────────────────
  ws2812Strip,
  ws2812Ring,
  ws2812Matrix,

  // ── Logic ICs ─────────────────────────────────────────────────────────
  dip('74hc595', '74HC595 shift register', ['QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH', 'GND', "QH'", 'SRCLR', 'SRCLK', 'RCLK', 'OE', 'SER', 'QA', 'VCC']),
  dip('74hc165', '74HC165 input shift register', ['SH/LD', 'CLK', 'E', 'F', 'G', 'H', 'QH̅', 'GND', 'QH', 'SER', 'A', 'B', 'C', 'D', 'CLKINH', 'VCC']),
  dip('mcp23017', 'MCP23017 I/O expander', [
    ...range(8, (i) => `GPB${i}`), 'VDD', 'VSS', 'NC', 'SCL', 'SDA', 'NC',
    'A0', 'A1', 'A2', 'RESET', 'INTB', 'INTA', ...range(8, (i) => `GPA${i}`),
  ]),
  dip('cd4051', 'CD4051 analog mux (8-ch)', ['Y4', 'Y6', 'Z', 'Y7', 'Y5', 'E', 'VEE', 'GND', 'S2', 'S1', 'S0', 'Y3', 'Y0', 'Y1', 'Y2', 'VCC']),
  dip('max3485-dip', 'MAX3485 RS-485 transceiver (DIP-8)', ['RO', 'RE', 'DE', 'DI', 'GND', 'A', 'B', 'VCC']),
  dip('dip8', 'Generic DIP-8', range(8, (i) => String(i + 1))),
  dip('dip14', 'Generic DIP-14', range(14, (i) => String(i + 1))),

  // ── Passives ──────────────────────────────────────────────────────────
  twoLead('resistor', 'Resistor', 'R', 'resistor', 0xd9b382, 4),
  twoLead('cap-ceramic', 'Ceramic capacitor', 'C', 'disc', 0xc9812a, 2),
  twoLead('cap-electrolytic', 'Electrolytic capacitor', 'C', 'can', 0x1b2a4a, 1, ['+', '-']),
  twoLead('diode', 'Diode', 'D', 'diode', 0x151517, 4, ['A', 'K']),
  twoLead('led', 'LED 5 mm', 'D', 'led', 0xff3030, 1, ['A', 'K'], [
    { key: 'color', label: 'Colour', type: 'color', def: '#ff3030' },
  ]),
  twoLead('buzzer', 'Buzzer', 'BZ', 'buzzer', 0x151517, 3, ['+', '-']),
  fixed('trimmer', 'Trimmer potentiometer', 'Passives', 'RV', 'trimmer', 0x2a6fd6, [
    ['1', 0, 0],
    ['W', 1, 0],
    ['3', 2, 0],
  ]),

  // ── Semiconductors ────────────────────────────────────────────────────
  fixed('npn-to92', 'NPN transistor (TO-92)', 'Semiconductors', 'Q', 'to92', CHIP, [
    ['E', 0, 0],
    ['B', 1, 0],
    ['C', 2, 0],
  ]),
  fixed('regulator-to220', 'Voltage regulator (TO-220)', 'Semiconductors', 'U', 'to220', CHIP, [
    ['IN', 0, 0],
    ['GND', 1, 0],
    ['OUT', 2, 0],
  ]),

  // ── Connectors & switches ─────────────────────────────────────────────
  strip('header', 'Pin header (1×N)', 'header'),
  strip('socket', 'Female header socket (1×N)', 'socket'),
  fixed('screw-terminal-2', 'Screw terminal (2-pin)', 'Connectors', 'J', 'terminal', 0x2a6fd6, [
    ['1', 0, 0],
    ['2', 2, 0],
  ]),
  fixed(
    'tact-switch',
    'Push button (6 mm)',
    'Connectors',
    'SW',
    'button',
    CHIP,
    [
      ['A', 0, 0],
      ['A', 3, 0],
      ['B', 0, 2],
      ['B', 3, 2],
    ],
    [
      [0, 1],
      [2, 3],
    ],
  ),
];

const byId = new Map(PARTS.map((p) => [p.id, p]));
/** Parts that can sit on their own female header socket. */
export const canSocket = (def: PartDef): boolean => def.shape === 'module' || def.shape === 'dip';
export const isSocketStrip = (type: string): boolean => byId.get(type)?.shape === 'socket';

export const getDef = (id: string): PartDef | undefined => byId.get(id);

export function defaultProps(def: PartDef): Record<string, PropValue> {
  return Object.fromEntries(def.props.map((p) => [p.key, p.def]));
}

/** Rotate a grid offset by k quarter turns. */
export function rotate(x: number, y: number, k: number): [number, number] {
  for (let i = 0; i < (((k % 4) + 4) % 4); i++) [x, y] = [-y, x];
  return [x, y];
}

export interface PlacedPin extends Hole {
  name: string;
  index: number;
}

/** Board holes occupied by a placed part's pins. */
export function pinHoles(inst: Pick<PartInstance, 'type' | 'pos' | 'rot' | 'props' | 'side'>): PlacedPin[] {
  const def = getDef(inst.type);
  if (!def) return [];
  const o = toHole(inst.pos);
  return def.resolve(inst.props).pins.map((p, index) => {
    // A part on the underside is flipped over, which mirrors its footprint.
    const [x, y] = rotate(inst.side === 'bottom' ? -p.x : p.x, p.y, inst.rot);
    return { name: p.name, index, c: o.c + x, r: o.r + y };
  });
}
