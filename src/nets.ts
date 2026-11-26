// Net tracing: works out which pins are electrically joined through shared
// holes, solder bridges, wires and connections inside parts.

import { Design, holeKey, linkHoles } from './model';
import { getDef, pinHoles } from './parts';

export interface NetPin {
  partId: string;
  ref: string;
  name: string;
}

export interface Net {
  id: string;
  holes: string[];
  pins: NetPin[];
}

export interface NetInfo {
  /** hole key → net id, for every hole touched by a pin or link. */
  netOf: Map<string, string>;
  nets: Map<string, Net>;
  warnings: { text: string; netId: string }[];
}

export function computeNets(d: Design): NetInfo {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    if (!parent.has(k)) parent.set(k, k);
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(k, r);
    return r;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));

  const pinsAt: { key: string; pin: NetPin }[] = [];
  for (const part of d.parts) {
    const def = getDef(part.type);
    if (!def) continue;
    const holes = pinHoles(part);
    for (const h of holes) {
      const key = holeKey(h);
      find(key);
      pinsAt.push({ key, pin: { partId: part.id, ref: part.ref, name: h.name } });
    }
    for (const group of def.resolve(part.props).internal)
      for (let i = 1; i < group.length; i++) union(holeKey(holes[group[0]]), holeKey(holes[group[i]]));
  }
  for (const link of d.links) {
    const keys = linkHoles(link).map(holeKey);
    for (let i = 1; i < keys.length; i++) union(keys[0], keys[i]);
    find(keys[0]);
  }

  const nets = new Map<string, Net>();
  const netOf = new Map<string, string>();
  for (const key of parent.keys()) {
    const id = find(key);
    netOf.set(key, id);
    if (!nets.has(id)) nets.set(id, { id, holes: [], pins: [] });
    nets.get(id)!.holes.push(key);
  }
  for (const { key, pin } of pinsAt) nets.get(netOf.get(key)!)!.pins.push(pin);

  const warnings: NetInfo['warnings'] = [];
  for (const net of nets.values()) {
    const names = new Set(net.pins.map((p) => p.name));
    const gnd = net.pins.find((p) => /^(A?GND|VSS)$/.test(p.name));
    const pwr = net.pins.find((p) => /^(3V3|5V|VIN|VCC|VDD|VBUS|VSYS)$/.test(p.name));
    if (gnd && pwr)
      warnings.push({ netId: net.id, text: `Short: ${pwr.ref}.${pwr.name} is joined to ${gnd.ref}.${gnd.name}` });
    else if (names.has('3V3') && names.has('5V'))
      warnings.push({ netId: net.id, text: '3V3 and 5V are joined on the same net' });
  }
  return { netOf, nets, warnings };
}
