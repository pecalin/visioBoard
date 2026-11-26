# VisioBoard

Plan perfboard prototypes in 3D, in the browser. Place dev boards, sensors, ICs
and passives on a 2.54 mm prototyping board, join them with jumper wires and
solder bridges, and trace which pins are connected.

Everything runs client-side, so it hosts on GitHub Pages with no backend.

## Features

- 3D board with orbit, top and bottom (solder side) views
- About 35 low-poly parts: ESP32 variants, Arduino Nano, Pi Pico, TCA9548A,
  level shifters, shift registers, sensors, passives, connectors
- Jumper wires and solder bridges on either side of the board
- Net tracing: hover a pin to see everything joined to it; short-circuit warnings
- Adjustable row spacing, lead spacing and header length per part
- Undo/redo, autosave in the browser, save/open as a JSON file, PNG export

## Controls

| Action | Input |
| --- | --- |
| Orbit / pan / zoom | Drag / right-drag / wheel |
| Select, Wire, Bridge, Erase | `V`, `W`, `B`, `E` |
| Rotate part | `R` |
| Delete selection | `Del` |
| Undo / redo | `Ctrl+Z` / `Ctrl+Y` |
| Cancel | `Esc` |

Wires and bridges are created on the side of the board you are looking at.

## Develop

```
npm install
npm run dev
npm run build
```

## Deploy

Pushing to `main` builds and deploys through `.github/workflows/deploy.yml`.
In the repository settings, set **Pages → Source** to **GitHub Actions** once.

## Adding a part

Parts are data in `src/parts.ts`. A two-row breakout board is one `dual({...})`
call with its pin names and default row spacing; a single-row module is one
`single({...})` call.

## Layout

| File | Role |
| --- | --- |
| `src/model.ts` | Design format (positions in mm), load validation |
| `src/parts.ts` | Parts library |
| `src/nets.ts` | Net tracing and short detection |
| `src/meshes.ts` | Low-poly part meshes |
| `src/scene.ts` | three.js view and picking |
| `src/editor.ts` | Tools, undo, autosave |
| `src/ui.ts` | Toolbar, palette, inspector, files |
