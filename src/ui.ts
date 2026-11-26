// DOM user interface: toolbar, parts palette, inspector, file handling.

import { parseDesign, toHole } from './model';
import { Editor, Tool, loadExample } from './editor';
import { PARTS, getDef, pinHoles } from './parts';

const WIRE_COLORS = ['#e5484d', '#1c1c1f', '#3e63dd', '#f5d90a', '#30a46c', '#f76b15', '#ffffff', '#8e4ec6'];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: cls, ...rest } = attrs as any;
  if (cls) node.className = cls;
  Object.assign(node, rest);
  node.append(...children);
  return node;
}

function download(name: string, href: string) {
  const a = el('a', { href, download: name });
  document.body.append(a);
  a.click();
  a.remove();
}

const fileName = (name: string) => name.trim().replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'board';

export function initUI(ed: Editor) {
  const viewport = $('viewport');
  const tooltip = $('tooltip');

  // ── Toolbar ─────────────────────────────────────────────────────────
  const toolButtons = [...document.querySelectorAll<HTMLButtonElement>('#tools button')];
  for (const b of toolButtons) b.onclick = () => ed.setTool(b.dataset.tool as Tool);

  const swatches = WIRE_COLORS.map((c) => {
    const b = el('button', { class: 'swatch', title: `Wire colour ${c}` });
    b.style.background = c;
    b.onclick = () => {
      const link = ed.selectedLink();
      ed.wireColor = c;
      if (link?.kind === 'wire') ed.setLinkColor(link.id, c);
      else render();
    };
    $('colors').append(b);
    return b;
  });

  $('view-top').onclick = () => (ed.view.setView('top'), render());
  $('view-bottom').onclick = () => (ed.view.setView('bottom'), render());
  $('view-3d').onclick = () => (ed.view.setView('3d'), render());
  $('undo').onclick = () => ed.undo();
  $('redo').onclick = () => ed.redo();

  const name = $<HTMLInputElement>('name');
  name.onchange = () => ed.setName(name.value.trim());

  // ── Files ───────────────────────────────────────────────────────────
  const openText = (text: string) => {
    try {
      const d = parseDesign(text);
      const unknown = d.parts.filter((p) => !getDef(p.type));
      d.parts = d.parts.filter((p) => getDef(p.type));
      ed.load(d);
      if (unknown.length) {
        ed.status = `Loaded, but skipped ${unknown.length} part(s) of unknown type: ${[...new Set(unknown.map((p) => p.type))].join(', ')}`;
        render();
      }
    } catch (err) {
      ed.status = `Could not open file: ${(err as Error).message}`;
      render();
    }
  };
  const file = $<HTMLInputElement>('file');
  $('open').onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files?.[0];
    if (f) openText(await f.text());
    file.value = '';
  };
  $('save').onclick = () => {
    const url = URL.createObjectURL(new Blob([ed.exportJSON()], { type: 'application/json' }));
    download(`${fileName(ed.design.name)}.visioboard.json`, url);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $('png').onclick = () => download(`${fileName(ed.design.name)}.png`, ed.view.png());
  $('new').onclick = () => {
    if (!ed.design.parts.length && !ed.design.links.length) return ed.newDesign();
    if (confirm('Start a new empty board? You can still undo this.')) ed.newDesign();
  };
  $('example').onclick = () => {
    if (!ed.design.parts.length || confirm('Replace the current board with the example? You can still undo this.')) loadExample(ed);
  };

  const drop = $('drop');
  viewport.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.hidden = false;
  });
  viewport.addEventListener('dragleave', () => (drop.hidden = true));
  viewport.addEventListener('drop', async (e) => {
    e.preventDefault();
    drop.hidden = true;
    const f = e.dataTransfer?.files[0];
    if (f) openText(await f.text());
  });

  // ── Palette ─────────────────────────────────────────────────────────
  const search = $<HTMLInputElement>('search');
  const list = $('partlist');
  const renderPalette = () => {
    const q = search.value.trim().toLowerCase();
    list.replaceChildren();
    const cats = [...new Set(PARTS.map((p) => p.category))];
    for (const cat of cats) {
      const parts = PARTS.filter((p) => p.category === cat && (!q || p.name.toLowerCase().includes(q) || cat.toLowerCase().includes(q)));
      if (!parts.length) continue;
      list.append(el('h3', {}, cat));
      for (const p of parts) {
        const sw = el('i');
        sw.style.background = '#' + p.color.toString(16).padStart(6, '0');
        const b = el('button', { class: 'part', title: `Place ${p.name}` }, sw, p.name);
        b.classList.toggle('active', ed.placing?.type === p.id);
        b.onclick = () => ed.startPlacing(p.id);
        list.append(b);
      }
    }
    if (!list.children.length) list.append(el('div', { class: 'empty' }, 'No parts match.'));
  };
  search.oninput = renderPalette;

  // ── Inspector ───────────────────────────────────────────────────────
  const inspector = $('inspector');
  const pinList = (ps: { ref: string; name: string }[]) => ps.map((p) => `${p.ref}.${p.name}`).join(', ');

  const numberRow = (label: string, value: number, min: number, max: number, set: (v: number) => void) => {
    const input = el('input', { type: 'number', value: String(value), min: String(min), max: String(max) });
    input.onchange = () => {
      const v = Math.round(Number(input.value));
      if (Number.isFinite(v) && v >= min && v <= max) set(v);
      else render();
    };
    return el('label', { class: 'row' }, label, input);
  };

  const renderPart = () => {
    const part = ed.selectedPart()!;
    const def = getDef(part.type)!;
    const origin = toHole(part.pos);
    inspector.append(
      el('h2', {}, part.ref),
      el('div', { class: 'sub' }, `${def.name} · pin 1 at col ${origin.c + 1}, row ${origin.r + 1}`),
    );
    const note = el('input', { type: 'text', value: part.note ?? '', placeholder: 'e.g. 10 kΩ, 100 nF' });
    note.onchange = () => ed.setNote(part.id, note.value.trim());
    inspector.append(el('label', { class: 'row' }, 'Note', note));
    for (const p of def.props) {
      if (p.type === 'int') {
        inspector.append(numberRow(p.label, Number(part.props[p.key] ?? p.def), p.min ?? 1, p.max ?? 40, (v) => ed.setProp(part.id, p.key, v)));
      } else {
        const input = el('input', { type: 'color', value: String(part.props[p.key] ?? p.def) });
        input.onchange = () => ed.setProp(part.id, p.key, input.value);
        inspector.append(el('label', { class: 'row' }, p.label, input));
      }
    }
    const rot = el('button', { title: 'Rotate 90° (R)' }, 'Rotate');
    rot.onclick = () => ed.rotateSelection();
    const del = el('button', { class: 'danger', title: 'Delete (Del)' }, 'Delete');
    del.onclick = () => ed.deleteSelection();
    inspector.append(el('div', { class: 'row buttons' }, rot, del), el('h3', {}, 'Pins'));

    const table = el('table');
    for (const pin of pinHoles(part)) {
      const peers = ed.peers(pin, part.id);
      const cell = el('td', { class: peers.length ? 'joined' : '' }, peers.length ? pinList(peers) : '—');
      table.append(el('tr', {}, el('td', {}, pin.name), cell));
    }
    inspector.append(table);
  };

  const renderLink = () => {
    const link = ed.selectedLink()!;
    const a = toHole(link.a);
    const b = toHole(link.b);
    inspector.append(
      el('h2', {}, link.kind === 'wire' ? 'Jumper wire' : 'Solder bridge'),
      el('div', { class: 'sub' }, `${link.side === 'top' ? 'Top' : 'Bottom'} side · col ${a.c + 1}, row ${a.r + 1} → col ${b.c + 1}, row ${b.r + 1}`),
    );
    if (link.kind === 'wire') inspector.append(el('div', { class: 'sub' }, 'Pick a colour in the toolbar to recolour this wire.'));
    const del = el('button', { class: 'danger' }, 'Delete');
    del.onclick = () => ed.deleteSelection();
    inspector.append(el('div', { class: 'row buttons' }, del));
  };

  const renderBoard = () => {
    const { cols, rows } = ed.design.board;
    const nets = [...ed.nets.nets.values()].filter((n) => n.pins.length > 1);
    inspector.append(
      el('h2', {}, 'Board'),
      el('div', { class: 'sub' }, `${(cols * 2.54).toFixed(0)} × ${(rows * 2.54).toFixed(0)} mm · ${ed.design.parts.length} parts · ${ed.design.links.length} links`),
      numberRow('Columns', cols, 2, 80, (v) => ed.resizeBoard(v, ed.design.board.rows)),
      numberRow('Rows', rows, 2, 80, (v) => ed.resizeBoard(ed.design.board.cols, v)),
    );
    const hoverable = (node: HTMLElement, netId: string) => {
      node.onmouseenter = () => ed.pinNet(netId);
      node.onmouseleave = () => ed.pinNet(null);
      return node;
    };
    if (ed.nets.warnings.length) {
      inspector.append(el('h3', {}, 'Warnings'));
      for (const w of ed.nets.warnings) inspector.append(hoverable(el('div', { class: 'warn' }, w.text), w.netId));
    }
    inspector.append(el('h3', {}, `Connections (${nets.length})`));
    if (!nets.length)
      inspector.append(el('div', { class: 'sub' }, 'Nothing is joined yet. Pick a part on the left, click a hole to place it, then use Wire or Bridge.'));
    for (const n of nets) inspector.append(hoverable(el('div', { class: 'net' }, pinList(n.pins)), n.id));
  };

  // ── Render ──────────────────────────────────────────────────────────
  function render() {
    for (const b of toolButtons) b.classList.toggle('active', b.dataset.tool === ed.tool);
    swatches.forEach((b, i) => b.classList.toggle('active', WIRE_COLORS[i] === ed.wireColor));
    ($('undo') as HTMLButtonElement).disabled = !ed.canUndo;
    ($('redo') as HTMLButtonElement).disabled = !ed.canRedo;
    if (document.activeElement !== name) name.value = ed.design.name;
    document.title = `${ed.design.name} · VisioBoard`;
    viewport.className = `tool-${ed.tool}`;
    $('message').textContent = ed.status;
    renderPalette();
    inspector.replaceChildren();
    if (ed.selectedPart()) renderPart();
    else if (ed.selectedLink()) renderLink();
    else renderBoard();
    updateSide();
  }

  const side = $('side');
  const updateSide = () => (side.textContent = ed.view.viewSide() === 'top' ? 'TOP · COMPONENT SIDE' : 'BOTTOM · SOLDER SIDE');
  ed.view.controls.addEventListener('change', updateSide);

  ed.onChange = render;
  ed.onHover = (h) => {
    tooltip.hidden = !h;
    if (!h) return;
    tooltip.textContent = h.text;
    tooltip.style.left = `${Math.min(h.x + 14, window.innerWidth - tooltip.offsetWidth - 8)}px`;
    tooltip.style.top = `${h.y + 16}px`;
  };
  render();
}
