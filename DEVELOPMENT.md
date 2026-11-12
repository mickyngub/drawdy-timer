# Developing Timer

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm dev             # Tailwind watcher plus the dev server on :5230; in Drawdy run ⌘K → "Add extension dev server"
pnpm build           # regenerates src/panel-css.ts, src/webview-html.ts, src/face-html.ts and dist/*.drawdyx
pnpm preflight       # before submitting: committed, built, pushed, under Drawdy's limits, above the live version
```

## How it works

A timer is one 300×210 **component** element on the board, so every viewer sees it, extension or not. It is a column: a board iframe (the face) over a row of three buttons, Start / Pause / Resume, +1 min and Reset. The state lives in `meta["mickyngub.timer"]`:

```ts
{ v: 1, id, state: "ready" | "running" | "paused" | "done", durationMs, remainingMs, endsAt?, label }
```

`id` names the timer and survives every replacement of its widget; `endsAt` is wall-clock time.

- **The face.** `face/shell.ts`, `face/main.ts` and `face/face.css` build into `src/face-html.ts`: Tailwind compiled without preflight and the script inlined, about 7 KB. The driver puts the meta into it as JSON (`faceDoc` in `src/lib/widget.ts`). The page redraws every 250 ms from `faceAt` (`src/lib/face.ts`) on the viewer's clock, so a run reads as done once `endsAt` passes and nobody writes anything at the end. Its colours are `light-dark()` tokens; Chrome takes an iframe's colour scheme from the embedding element's `color-scheme`, which Drawdy sets from its theme, so each face follows its viewer's theme. The buttons use Drawdy's own CSS variables.
- **Writes.** A component's content can't change once it is on the board, so each gesture (start, pause, resume, +1 min, reset, a new length or label) adds a new widget at the old one's x, y and size, in the same frame and group, then removes the old one (`planReplacement`). That is two commands, so undoing a press takes two steps; the first brings the old widget back on top of the new one. A widget someone resized comes back at that size through a transform on its content, since a component's scale can't be set when it is added. A press removes any widget of the same timer stacked on the same spot, which is what two presses that cross on the wire or a half-undone press leave. A pasted copy shares its timer's id until it is changed, when it takes a fresh one.
- **Presses.** The buttons are boxes, not `<button>`s: Drawdy's board takes pointer capture on every press, so the DOM click of a `<button>` inside a component lands on the board and `dom:element-clicked` never names it, and the board sends no scene click for `<button>` targets. A box press reaches the driver as `subscription:scene:click` with the clicked elements. The board treats the pointerout that its pointer capture causes as a release, so that click arrives as soon as a box is pressed, and the widget can't be dragged by its buttons; its drag bar and the row around the buttons still drag it. The driver keeps the `scene:pointer` down point, ignores a click whose pointer travelled more than 6 px (a drag), and maps the press point onto the button row (`buttonAt`). People without Timer get no events, so their clicks only select the widget.
- **The pill.** One click-through floating element (`asPopover: false`) at the top centre for a running timer you can't read on the board: a widget less than half in view or under 120 px wide on screen (`onScreen` in `src/lib/hud.ts`), or a 1.0.0 frame. The view comes from `camera:get-viewport-rect` on load and after `camera:moved-debounced`. The driver wakes only when the shown second changes, a run ends or "Time's up" fades (`nextWake`).
- **1.0.0 timers.** Frames with timer meta are still read, counted down in the pill and chimed. The first change replaces the frame and its ⏱ glyph with a widget at the frame's top-left corner.
- **Finding timers.** A scan of the board on load, then `elements-added`, `-updated`, `-removed` and `-replaced` with `type`, `meta`, `frameId` and the geometry. The panel follows the selected widget, else the last one it showed, found again by its timer id after someone else's press replaced it.
- **The chime.** The panel is created with `keepStateWhenClosed: true`, so it stays alive when closed; a click inside it unlocks its `AudioContext`, and the driver posts `chime` once per run it watched end. Both sounds are sine partials (`webview/lib/chime.ts`); there are no audio files.

The state machine (`src/lib/timer-state.ts`), the face maths, the widget and its replacement plan (`src/lib/widget.ts`), the pill and the panel's view model are pure. `src/driver.ts` builds the driver from a factory, so the tests run two drivers on one fake board with their own clocks (`test/fake-host.ts`), clicking widgets the way Drawdy reports it.

## Building and releasing

Drawdy builds published versions from this repository's `src/index.ts` and runs no build step, so commit the generated `src/panel-css.ts`, `src/webview-html.ts` and `src/face-html.ts` after `pnpm build`. Bump `driverVersion` in `manifest.json` for every release and add it to `CHANGELOG.md`. `pnpm test` also holds the manifest and listing files to Drawdy's submission rules.

`package.json` points `@drawdy/driver-protocol` at Drawdy's main checkout; run `pnpm install` here after it changes.
