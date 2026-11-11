# Developing Timer

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm dev             # Tailwind watcher plus the dev server on :5230; in Drawdy run ⌘K → "Add extension dev server"
pnpm build           # regenerates src/panel-css.ts, src/webview-html.ts and dist/*.drawdyx
pnpm preflight       # before submitting: committed, built, pushed, under Drawdy's limits, above the live version
```

## How it works

Drawdy shares only elements and their meta between people on a board, so a timer is a 240×140 **frame** (its anchor) holding a static ⏱ text element. The anchor keeps the state in `meta["mickyngub.timer"]`:

```ts
{ v: 1, id, state: "ready" | "running" | "paused" | "done", durationMs, remainingMs, endsAt?, label, startedBy }
```

`endsAt` is wall-clock time, so every client counts down on its own and a running timer whose `endsAt` has passed reads as done everywhere without anyone writing it. Extensions can't change an element's text, but they can rename a frame, so each change also renames the anchor ("⏱ 5:00 · label", "⏱ Running · ends 14:32 · label", "⏸ Paused · 3:12 left · label", "✓ Time's up · label") for people without the extension.

- **Writes.** Every gesture (start, pause, resume, +1 min, reset, a new length or label) is one `update-drawdy-elements` on the anchor carrying the meta and the frame name together, so it is one undo step. Anyone can act. Drawdy stores elements whole, so two writes to one anchor at the same moment end as the later write; `test/two-clients.test.ts` holds that to a two-client fake board.
- **The end of a run.** Only the device whose id is `startedBy` writes `done`, once per run it watched, so opening a board hours later writes nothing and undoing "Time's up" doesn't bring it straight back. Each client chimes once per run it watched end; the device id is random and kept in kv storage.
- **The pill.** One click-through floating element (`asPopover: false`) at the top centre, placed from `dom:window-size` and `dom:screen-resized`. The driver wakes only when the shown second changes, a run ends or "Time's up" fades (`nextWake` in `src/lib/hud.ts`). Each character of the time sits in a fixed-width cell, since floating elements can't set `font-variant-numeric`.
- **Finding timers.** A scan of the board on load, then `elements-added`, `-updated`, `-removed` and `-replaced` with `type`, `meta` and `frameId`. An anchor's id is its element id, so a pasted copy is its own timer.
- **The chime.** The panel is created with `keepStateWhenClosed: true`, so it stays alive when closed; a click inside it unlocks its `AudioContext`, and the driver posts `chime` when a run ends. Both sounds are sine partials (`webview/lib/chime.ts`); there are no audio files.

The state machine is pure (`src/lib/timer-state.ts`), as are the pill (`src/lib/hud.ts`) and the panel's view model (`src/lib/panel-model.ts`). `src/driver.ts` builds the driver from a factory, so the tests can run two drivers on one fake board with their own clocks (`test/fake-host.ts`).

## Building and releasing

Drawdy builds published versions from this repository's `src/index.ts` and runs no build step, so commit the generated `src/panel-css.ts` and `src/webview-html.ts` after `pnpm build`. Bump `driverVersion` in `manifest.json` for every release and add it to `CHANGELOG.md`. `pnpm test` also holds the manifest and listing files to Drawdy's submission rules.

`package.json` points `@drawdy/driver-protocol` at Drawdy's main checkout; run `pnpm install` here after it changes.
