import type {
    DriverCommandIssuer,
    DriverManifest,
    DriverModule,
    DriverSubscriptionEvent,
    ModuleStyling,
    ProtocolCommandError,
    SubscribeableKey,
    SubscribedDrawdyElement,
} from "@drawdy/driver-protocol";
import { ACTION_BUTTON_SVG } from "./action-button";
import { canEdit, isReadOnlyRefusal } from "./lib/can-edit";
import { FLASH_MS } from "./lib/face";
import {
    centredIn,
    findFreeRect,
    overlaps,
    revealAndSelect,
    visibleArea,
    type Rect,
} from "./lib/free-spot";
import {
    hudPosition,
    hudSchema,
    nextWake,
    onScreen,
    pickHud,
    type HudView,
    type Theme,
    type View,
} from "./lib/hud";
import {
    DEFAULT_MINUTES,
    effective,
    newTimer,
    readTimer,
    reduce,
    sameTimer,
    type Timer,
    type TimerAction,
} from "./lib/timer-state";
import {
    buttonAt,
    planReplacement,
    sameRect,
    WIDGET_SIZE,
    widgetElement,
    type ButtonAction,
    type Placed,
} from "./lib/widget";
import {
    SOUNDS,
    type DriverToWebview,
    type PanelAction,
    type PanelError,
    type Sound,
    type WebviewToDriver,
} from "./shared/messages";
import { WEBVIEW_HTML } from "./webview-html";

const PROPERTIES: SubscribeableKey[] = [
    "type",
    "meta",
    "frameId",
    "x",
    "y",
    "width",
    "height",
];
const PLACE_PROPERTIES: SubscribeableKey[] = [...PROPERTIES, "groupId"];
// A press that moved further than this on screen was a drag, not a click.
const CLICK_SLOP_PX = 6;
// A run seen ending later than this (a throttled background tab) stays silent.
const LIVE_EXPIRY_MS = 10_000;
// Past this, anyone with Timer writes a finished run's done state in case its presser's tab is gone.
const FALLBACK_FINISH_MS = 5_000;
const WAKE_SLACK_MS = 15;
const VIEW_ONLY_NOTICE_MS = 2_500;
const PREFS_KEY = "prefs";
const DEFAULT_SOUND: Sound = "soft";

export const MENU = {
    root: "timer",
    toggle: "timer.toggle",
    addMinute: "timer.add-minute",
    reset: "timer.reset",
} as const;

const PRESS: Record<ButtonAction, TimerAction> = {
    start: { type: "start" },
    pause: { type: "pause" },
    "add-minute": { type: "add-minute" },
    reset: { type: "reset" },
};

export type Env = {
    now: () => number;
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
};

const realEnv: Env = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) =>
        clearTimeout(handle as ReturnType<typeof setTimeout>),
};

type Point = { x: number; y: number };
type Press = { dom: Point; canvas: Point };

type State = {
    manifest: DriverManifest;
    driverId: string;
    issueCommand: DriverCommandIssuer;
    generateId: () => string;
    styling: ModuleStyling;
    buttonId: string;
    webviewId: string;
    hudId: string;
    menuIds: Record<keyof typeof MENU, string>;
    sound: Sound;
    timers: Map<string, Placed>;
    glyphs: Map<string, string>;
    moved: Map<string, string>;
    mine: Set<string>;
    finished: Set<string>;
    down: Press | null;
    selection: string[];
    target: string | null;
    targetKey: string | null;
    windowWidth: number;
    view: View | null;
    hudKey: string;
    hudChain: Promise<unknown>;
    flashes: Map<string, number>;
    seenRunning: Set<string>;
    handled: Set<string>;
    wake: unknown;
    lastPanel: string;
    canEdit: boolean;
    noticeUntil: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

export function stylingCssVars(styling: ModuleStyling): string {
    const { tokens, ...flat } = styling as ModuleStyling & {
        tokens?: Record<string, string>;
    };
    const vars = Object.entries(flat).map(([key, value]) =>
        key === "theme"
            ? `color-scheme: ${value};`
            : `--drawdy-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: ${value};`
    );
    for (const [name, value] of Object.entries(tokens ?? {}))
        vars.push(`${name}: ${value};`);
    return vars.join("");
}

function readGlyph(value: unknown): string | null {
    return isRecord(value) && value.v === 1 && typeof value.glyphOf === "string"
        ? value.glyphOf
        : null;
}

function rectOf(el: SubscribedDrawdyElement): Rect | null {
    const { x, y, width, height } = el;
    return typeof x === "number" &&
        typeof y === "number" &&
        typeof width === "number" &&
        typeof height === "number"
        ? { x, y, width, height }
        : null;
}

const kindOf = (type: string | undefined): Placed["kind"] | null =>
    type === "component" ? "widget" : type === "frame" ? "frame" : null;

const expiryKey = (timer: Timer): string => `${timer.id}:${timer.endsAt}`;

function toTimerAction(action: unknown): TimerAction | null {
    if (!isRecord(action)) return null;
    switch (action.type as PanelAction["type"]) {
        case "start":
            return { type: "start" };
        case "pause":
            return { type: "pause" };
        case "add-minute":
            return { type: "add-minute" };
        case "reset":
            return { type: "reset" };
        case "set-duration":
            return typeof action.minutes === "number"
                ? { type: "set-duration", minutes: action.minutes }
                : null;
        case "set-label":
            return typeof action.label === "string"
                ? { type: "set-label", label: action.label }
                : null;
        default:
            return null;
    }
}

/** Widgets stacked on one spot for one timer read as a single timer. */
function countTimers(entries: Iterable<Placed>): number {
    const seen: Placed[] = [];
    for (const e of entries)
        if (
            !seen.some(
                (o) =>
                    o.kind === "widget" &&
                    e.kind === "widget" &&
                    o.timer.id === e.timer.id &&
                    sameRect(o.rect, e.rect)
            )
        )
            seen.push(e);
    return seen.length;
}

/**
 * Pills only stand in for timers you can't read on the board: a widget out of
 * view or too small to read, or a 1.0.0 frame, which never showed a countdown.
 */
function pillTimers(entries: Iterable<Placed>, view: View | null): Timer[] {
    const out: Timer[] = [];
    for (const entry of entries)
        if (entry.kind === "frame" || !onScreen(entry.rect, view))
            out.push(entry.timer);
    return out;
}

export function createTimerDriver(overrides: Partial<Env> = {}): DriverModule {
    const env: Env = { ...realEnv, ...overrides };
    let d: State | null = null;
    let requestId = 0;
    let chain: Promise<void> = Promise.resolve();

    const stamp = (s: State) => ({
        driverId: s.driverId,
        requestId: String(requestId++),
    });

    function enqueue(task: () => Promise<void>): Promise<void> {
        const next = chain.then(task).catch((err) => {
            console.error(`[${d?.driverId}] ${String(err)}`);
        });
        chain = next;
        return next;
    }

    function post(s: State, message: DriverToWebview): void {
        void s
            .issueCommand({
                type: "command:webview:post-message",
                ...stamp(s),
                req: { webviewDomId: s.webviewId, message },
            })
            .catch(() => undefined);
    }

    function fail(s: State, type: string | undefined): void {
        const reason: PanelError =
            type === "unauthorized" ? "denied" : "failed";
        post(s, { type: "error", reason });
    }

    function placeCtx(s: State) {
        return {
            issueCommand: s.issueCommand,
            driverId: s.driverId,
            nextRequestId: () => String(requestId++),
            webviewDomId: s.webviewId,
        };
    }

    /** The answer is cached only for the panel to show; every write asks again, since a role can change at any time. */
    async function checkEdit(s: State): Promise<boolean> {
        s.canEdit = await canEdit(placeCtx(s));
        syncPanel(s);
        return s.canEdit;
    }

    function noticeViewOnly(s: State): void {
        s.noticeUntil = env.now() + VIEW_ONLY_NOTICE_MS;
        refresh(s);
    }

    /** A gesture someone can't make here explains itself; a write Timer makes on its own (`quiet`) just doesn't happen. */
    async function mayWrite(s: State, quiet: boolean): Promise<boolean> {
        if (await checkEdit(s)) return true;
        if (!quiet) noticeViewOnly(s);
        return false;
    }

    function becameViewOnly(s: State, quiet: boolean): void {
        s.canEdit = false;
        if (quiet) refresh(s);
        else noticeViewOnly(s);
    }

    function refused(
        s: State,
        error: ProtocolCommandError,
        quiet: boolean
    ): void {
        if (isReadOnlyRefusal(error)) becameViewOnly(s, quiet);
        else fail(s, error.type);
    }

    async function kvGet(
        s: State,
        key: string
    ): Promise<Record<string, unknown> | null> {
        try {
            const got = await s.issueCommand({
                type: "command:kv-storage:get",
                ...stamp(s),
                req: { key },
            });
            return got.res.error === undefined
                ? (got.res.value.got ?? null)
                : null;
        } catch {
            return null;
        }
    }

    async function loadPrefs(s: State): Promise<void> {
        const stored = await kvGet(s, PREFS_KEY);
        if (SOUNDS.includes(stored?.sound as Sound))
            s.sound = stored?.sound as Sound;
    }

    async function fetchElements(
        s: State,
        ids?: string[],
        properties: SubscribeableKey[] = PROPERTIES
    ): Promise<SubscribedDrawdyElement[]> {
        try {
            const res = await s.issueCommand({
                type: "command:scene:get-drawdy-elements",
                ...stamp(s),
                req: { properties, drawdyElementIds: ids },
            });
            return res.res.error === undefined
                ? res.res.value.drawdyElements
                : [];
        } catch {
            return [];
        }
    }

    async function readView(s: State): Promise<void> {
        try {
            const [view, cam] = await Promise.all([
                s.issueCommand({
                    type: "command:camera:get-viewport-rect",
                    ...stamp(s),
                }),
                s.issueCommand({
                    type: "command:camera:get-info",
                    ...stamp(s),
                }),
            ]);
            if (view.res.error !== undefined) return;
            const zoom =
                cam.res.error === undefined && cam.res.value.zoom > 0
                    ? cam.res.value.zoom
                    : 1;
            s.view = { rect: view.res.value.rect, zoom };
        } catch {
            return;
        }
    }

    function absorb(
        s: State,
        elements: readonly SubscribedDrawdyElement[]
    ): boolean {
        let changed = false;
        for (const el of elements) {
            const raw = el.meta?.[s.driverId];
            const prev = s.timers.get(el.id);
            const kind = kindOf(el.type) ?? (el.type ? null : prev?.kind);
            const timer = kind ? readTimer(raw, el.id) : null;
            if (kind && timer) {
                const rect = rectOf(el) ?? prev?.rect ?? null;
                if (timer.state === "done" && timer.endsAt !== undefined)
                    s.finished.add(expiryKey(timer));
                if (
                    !prev ||
                    prev.kind !== kind ||
                    !sameTimer(prev.timer, timer) ||
                    !sameRect(prev.rect, rect)
                ) {
                    s.timers.set(el.id, { el: el.id, kind, timer, rect });
                    changed = true;
                }
                continue;
            }
            if (s.timers.delete(el.id)) changed = true;
            const glyphOf = readGlyph(raw);
            if (glyphOf) s.glyphs.set(el.id, el.frameId ?? glyphOf);
            else s.glyphs.delete(el.id);
        }
        return changed;
    }

    function forget(s: State, ids: readonly string[]): void {
        for (const id of ids) {
            s.timers.delete(id);
            s.glyphs.delete(id);
        }
    }

    /** Follows a widget through its replacements, so a press or panel action sent just before one still lands. */
    function resolve(s: State, id: string): string {
        const seen = new Set<string>();
        let at = id;
        while (!s.timers.has(at) && s.moved.has(at) && !seen.has(at)) {
            seen.add(at);
            at = s.moved.get(at)!;
        }
        return at;
    }

    function selectedTimer(s: State): string | null {
        for (const id of s.selection) {
            if (s.timers.has(id)) return id;
            const anchor = s.glyphs.get(id);
            if (anchor && s.timers.has(anchor)) return anchor;
        }
        return null;
    }

    function remember(s: State, id: string): string {
        s.target = id;
        s.targetKey = s.timers.get(id)?.timer.id ?? null;
        return id;
    }

    /**
     * The selected timer, else the one last selected, added or pressed, else
     * the newest. A widget someone else replaced is found again by its timer id.
     */
    function targetId(s: State): string | null {
        const selected = selectedTimer(s);
        if (selected) return remember(s, selected);
        if (s.target) {
            const target = resolve(s, s.target);
            if (s.timers.has(target)) return remember(s, target);
            const same = [...s.timers.values()].filter(
                (e) => e.timer.id === s.targetKey
            );
            if (same.length) return remember(s, same.at(-1)!.el);
        }
        return [...s.timers.keys()].at(-1) ?? null;
    }

    function chime(s: State): void {
        if (s.sound !== "off") post(s, { type: "chime", sound: s.sound });
    }

    /**
     * Each client reacts once to each run ending, and only to runs it watched,
     * so opening a board hours later is silent and undoing a press doesn't re-fire it.
     */
    function processExpiries(s: State, now: number): void {
        let chimed = false;
        for (const { timer } of s.timers.values()) {
            if (timer.endsAt === undefined) continue;
            if (timer.state !== "running" && timer.state !== "done") continue;
            const key = expiryKey(timer);
            if (timer.state === "running" && timer.endsAt > now) {
                s.seenRunning.add(key);
                continue;
            }
            if (s.handled.has(key)) continue;
            s.handled.add(key);
            if (!s.seenRunning.has(key)) continue;
            if (now - timer.endsAt > LIVE_EXPIRY_MS) continue;
            s.flashes.set(timer.id, timer.endsAt + FLASH_MS);
            if (!chimed) chime(s);
            chimed = true;
        }
    }

    /** When a running widget's done state is due: at its end for the client that made it, else once the fallback wait has passed. */
    function finishDue(s: State, entry: Placed): number | null {
        const { timer } = entry;
        if (entry.kind !== "widget" || timer.state !== "running") return null;
        if (timer.endsAt === undefined) return null;
        if (s.finished.has(expiryKey(timer))) return null;
        return s.mine.has(entry.el)
            ? timer.endsAt
            : timer.endsAt + FALLBACK_FINISH_MS + 1;
    }

    /**
     * A widget's buttons can't change once it is on the board, so a finished
     * run is written as done, which turns Pause into Start again. Each client
     * writes each run at most once and never one it has seen done, so an undo
     * of the write isn't undone again.
     */
    function processFinishes(s: State, now: number): void {
        for (const entry of [...s.timers.values()]) {
            const due = finishDue(s, entry);
            if (due === null || due > now) continue;
            const key = expiryKey(entry.timer);
            s.finished.add(key);
            const el = entry.el;
            void enqueue(() => finish(s, el, key));
        }
    }

    async function finish(s: State, el: string, key: string): Promise<void> {
        const entry = s.timers.get(el);
        if (!entry || entry.kind !== "widget") return;
        if (entry.timer.state !== "running" || expiryKey(entry.timer) !== key)
            return;
        await act(s, el, [{ type: "expire" }], true);
    }

    function hudCommand(s: State, command: () => Promise<unknown>): void {
        s.hudChain = s.hudChain.then(command).catch(() => undefined);
    }

    function renderHud(s: State, now: number): void {
        const candidates = pillTimers(s.timers.values(), s.view).filter(
            (t) => effective(t, now).state !== "paused"
        );
        const view: HudView | null =
            s.noticeUntil > now
                ? { kind: "notice" }
                : pickHud(candidates, now, s.flashes);
        const theme: Theme = s.styling.theme === "light" ? "light" : "dark";
        const position = hudPosition(s.windowWidth);
        const key = view ? JSON.stringify({ view, theme, position }) : "";
        if (key === s.hudKey) return;
        const wasShown = s.hudKey !== "";
        s.hudKey = key;
        if (!view) {
            if (wasShown)
                hudCommand(s, () =>
                    s.issueCommand({
                        type: "command:dom:remove-floating-element",
                        ...stamp(s),
                        req: { domId: s.hudId },
                    })
                );
            return;
        }
        const schema = hudSchema(view, theme, s.driverId);
        hudCommand(s, () =>
            s.issueCommand({
                type: "command:dom:upsert-floating-element",
                ...stamp(s),
                req: { domId: s.hudId, position, schema, asPopover: false },
            })
        );
    }

    function syncPanel(s: State, force = false): void {
        const id = targetId(s);
        const entry = id ? s.timers.get(id) : undefined;
        const message: DriverToWebview = {
            type: "state",
            timer: entry ? { ...entry.timer, id: entry.el } : null,
            count: countTimers(s.timers.values()),
            sound: s.sound,
            viewOnly: !s.canEdit,
        };
        const serialized = JSON.stringify(message);
        if (!force && serialized === s.lastPanel) return;
        s.lastPanel = serialized;
        post(s, message);
    }

    function schedule(s: State, now: number): void {
        if (s.wake !== null) env.clearTimeout(s.wake);
        s.wake = null;
        const timers = [...s.timers.values()].map((e) => e.timer);
        let at = nextWake(timers, now, s.flashes) ?? Infinity;
        for (const entry of s.timers.values()) {
            const due = finishDue(s, entry);
            if (due !== null && due > now) at = Math.min(at, due);
        }
        if (s.noticeUntil > now) at = Math.min(at, s.noticeUntil);
        if (!Number.isFinite(at)) return;
        s.wake = env.setTimeout(
            () => {
                s.wake = null;
                if (d === s) refresh(s);
            },
            Math.max(0, at - now) + WAKE_SLACK_MS
        );
    }

    function refresh(s: State): void {
        const now = env.now();
        processExpiries(s, now);
        processFinishes(s, now);
        for (const [id, until] of s.flashes)
            if (until <= now) s.flashes.delete(id);
        renderHud(s, now);
        syncPanel(s);
        schedule(s, now);
    }

    /** The timer an action lands on and what it becomes, or null when the board would not change. */
    function change(
        s: State,
        id: string,
        actions: TimerAction[]
    ): { entry: Placed; next: Timer; now: number } | null {
        const entry = s.timers.get(resolve(s, id));
        if (!entry) return null;
        const now = env.now();
        const next = actions.reduce((t, a) => reduce(t, a, now), entry.timer);
        if (entry.kind === "widget" && sameTimer(next, entry.timer))
            return null;
        return { entry, next, now };
    }

    /**
     * One gesture is a new widget with the new state at the old one's place,
     * then the old one removed. `quiet` marks a write no one asked for, the
     * finished state at zero, which never shows the view-only notice.
     */
    async function act(
        s: State,
        id: string,
        actions: TimerAction[],
        quiet = false
    ): Promise<void> {
        if (!change(s, id, actions)) return;
        if (!(await mayWrite(s, quiet))) return;
        const changed = change(s, id, actions);
        if (!changed) return;
        const { entry, next, now } = changed;
        const [current] = await fetchElements(s, [entry.el], PLACE_PROPERTIES);
        const at = current ? rectOf(current) : null;
        if (!current || !at) {
            forget(s, [entry.el]);
            refresh(s);
            return;
        }
        const newId = s.generateId();
        const plan = planReplacement({
            driverId: s.driverId,
            old: { ...entry, rect: at },
            at,
            others: [...s.timers.values()].filter((o) => o.el !== entry.el),
            glyphs: [...s.glyphs]
                .filter(([, anchor]) => anchor === entry.el)
                .map(([glyph]) => glyph),
            next,
            newId,
            now,
            place: { frameId: current.frameId, groupId: current.groupId },
        });
        const added = await s.issueCommand({
            type: "command:scene:add-drawdy-elements",
            ...stamp(s),
            req: { elements: [plan.element] },
        });
        if (added.res.error !== undefined) {
            refused(s, added.res.error, quiet);
            return;
        }
        s.timers.set(newId, {
            el: newId,
            kind: "widget",
            timer: plan.timer,
            rect: plan.rect,
        });
        s.mine.add(newId);
        const reselect = plan.remove.some((r) => s.selection.includes(r));
        const removed = await s.issueCommand({
            type: "command:scene:remove-drawdy-elements",
            ...stamp(s),
            req: { drawdyElementIds: plan.remove },
        });
        if (
            removed.res.error !== undefined &&
            isReadOnlyRefusal(removed.res.error)
        ) {
            await takeBack(s, newId, quiet);
            return;
        }
        if (removed.res.error !== undefined) fail(s, removed.res.error.type);
        else {
            forget(s, plan.remove);
            for (const gone of plan.remove) s.moved.set(gone, newId);
        }
        if (s.target === null || plan.remove.includes(s.target))
            s.target = newId;
        refresh(s);
        if (reselect) {
            s.selection = [newId];
            await s
                .issueCommand({
                    type: "command:scene:set-selection",
                    ...stamp(s),
                    req: { drawdyElementIds: [newId] },
                })
                .catch(() => undefined);
        }
    }

    /**
     * The new widget landed but the old one's removal was refused, so this
     * person lost edit access mid-press. The new widget goes again only if
     * removing is allowed; otherwise it stays stacked on the old one as a twin,
     * which the next press by someone who can edit clears.
     */
    async function takeBack(
        s: State,
        newId: string,
        quiet: boolean
    ): Promise<void> {
        becameViewOnly(s, quiet);
        if (!(await checkEdit(s))) return;
        const res = await s.issueCommand({
            type: "command:scene:remove-drawdy-elements",
            ...stamp(s),
            req: { drawdyElementIds: [newId] },
        });
        if (res.res.error !== undefined) return;
        forget(s, [newId]);
        s.mine.delete(newId);
        refresh(s);
    }

    /**
     * A click on a widget's button row is a press. Several widgets sit under
     * one click only when stacked, after an undo or presses that crossed, and
     * the one added last, which Drawdy draws on top, is the one pressed.
     */
    async function clickAt(
        s: State,
        ids: readonly string[],
        point: Point
    ): Promise<void> {
        const clicked = new Set(ids);
        const hits = [...s.timers.values()].filter(
            (e) => e.kind === "widget" && clicked.has(e.el)
        );
        for (const entry of hits.reverse()) {
            const action =
                entry.rect && buttonAt(entry.rect, entry.timer, point);
            if (!action) continue;
            s.target = entry.el;
            await act(s, entry.el, [PRESS[action]]);
            return;
        }
    }

    async function addTimer(s: State): Promise<void> {
        if (!(await mayWrite(s, false))) return;
        const { width, height } = WIDGET_SIZE;
        const area = await visibleArea(placeCtx(s));
        const centred = area
            ? centredIn(area, width, height)
            : { x: 0, y: 0, width, height };
        const spot: Rect = await findFreeRect(
            placeCtx(s),
            { ...centred, x: Math.round(centred.x), y: Math.round(centred.y) },
            (e) => e.type !== "frame" || s.timers.has(e.id)
        );
        const id = s.generateId();
        const now = env.now();
        const timer = newTimer(id, DEFAULT_MINUTES);
        const added = await s.issueCommand({
            type: "command:scene:add-drawdy-elements",
            ...stamp(s),
            req: {
                elements: [widgetElement(s.driverId, id, timer, spot, now)],
            },
        });
        if (added.res.error !== undefined) {
            refused(s, added.res.error, false);
            return;
        }
        if (!s.timers.has(id))
            s.timers.set(id, { el: id, kind: "widget", timer, rect: spot });
        s.mine.add(id);
        s.target = id;
        s.selection = [id];
        refresh(s);
        await revealAndSelect(placeCtx(s), [id], spot);
    }

    async function removeTimer(s: State, id: string): Promise<void> {
        if (!s.timers.has(resolve(s, id))) return;
        if (!(await mayWrite(s, false))) return;
        const entry = s.timers.get(resolve(s, id));
        if (!entry) return;
        const stacked = [...s.timers.values()]
            .filter(
                (o) =>
                    o.el !== entry.el &&
                    o.kind === "widget" &&
                    o.timer.id === entry.timer.id &&
                    sameRect(o.rect, entry.rect)
            )
            .map((o) => o.el);
        const glyphs = [...s.glyphs]
            .filter(([, anchor]) => anchor === entry.el)
            .map(([glyph]) => glyph);
        const ids = [entry.el, ...glyphs, ...stacked];
        const res = await s.issueCommand({
            type: "command:scene:remove-drawdy-elements",
            ...stamp(s),
            req: { drawdyElementIds: ids },
        });
        if (res.res.error !== undefined) {
            refused(s, res.res.error, false);
            return;
        }
        forget(s, ids);
        refresh(s);
    }

    async function locate(s: State, id: string): Promise<void> {
        const el = resolve(s, id);
        const res = await s.issueCommand({
            type: "command:scene:element-rects",
            ...stamp(s),
            req: { drawdyElementIds: [el] },
        });
        const rect =
            res.res.error === undefined ? res.res.value.rects[0]?.rect : null;
        if (!rect) return;
        s.target = el;
        await revealAndSelect(placeCtx(s), [el], rect);
    }

    async function openPanel(s: State): Promise<void> {
        const created = await s.issueCommand({
            type: "command:webview:create",
            ...stamp(s),
            req: {
                webviewDomId: s.webviewId,
                htmlContent: WEBVIEW_HTML.replace(
                    "/*__DRAWDY_STYLING__*/",
                    stylingCssVars(s.styling)
                ),
                // Kept alive when closed, so the chime can still play after a click in it unlocked audio.
                keepStateWhenClosed: true,
            },
        });
        if (created.res.error !== undefined) return;
        await readView(s);
        const inView = [...s.timers.values()].filter(
            (e) => e.rect && s.view && overlaps(e.rect, s.view.rect)
        );
        if (inView.length === 0) await addTimer(s);
        else {
            await checkEdit(s);
            if (!selectedTimer(s)) s.target = inView.at(-1)!.el;
        }
        syncPanel(s, true);
    }

    async function readSelection(s: State): Promise<void> {
        const res = await s.issueCommand({
            type: "command:scene:get-current-selected-drawdy-elements",
            ...stamp(s),
        });
        if (res.res.error === undefined)
            s.selection = res.res.value.drawdyElementIds;
    }

    async function onMenu(s: State, menuId: string): Promise<void> {
        await readSelection(s);
        const id = targetId(s);
        if (!id) return;
        if (menuId === s.menuIds.toggle) await act(s, id, [{ type: "toggle" }]);
        else if (menuId === s.menuIds.addMinute)
            await act(s, id, [{ type: "add-minute" }]);
        else if (menuId === s.menuIds.reset)
            await act(s, id, [{ type: "reset" }]);
    }

    async function handleMessage(
        s: State,
        message: WebviewToDriver
    ): Promise<void> {
        switch (message.type) {
            case "ready":
                syncPanel(s, true);
                return;
            case "add":
                await enqueue(() => addTimer(s));
                return;
            case "act": {
                if (!Array.isArray(message.actions)) return;
                const actions = message.actions
                    .map(toTimerAction)
                    .filter((a): a is TimerAction => a !== null);
                if (actions.length === 0) return;
                await enqueue(() => act(s, message.id, actions));
                return;
            }
            case "delete":
                await enqueue(() => removeTimer(s, message.id));
                return;
            case "locate":
                await enqueue(() => locate(s, message.id));
                return;
            case "sound": {
                if (!SOUNDS.includes(message.value)) return;
                s.sound = message.value;
                syncPanel(s);
                await s
                    .issueCommand({
                        type: "command:kv-storage:set",
                        ...stamp(s),
                        req: { key: PREFS_KEY, payload: { sound: s.sound } },
                    })
                    .catch(() => undefined);
                return;
            }
            default:
                return;
        }
    }

    async function subscribe(s: State): Promise<void> {
        const issue = s.issueCommand;
        await Promise.all([
            issue({
                type: "subscription:dom:element-clicked",
                ...stamp(s),
                req: { domElementId: s.buttonId },
            }),
            issue({
                type: "subscription:webview:message",
                ...stamp(s),
                req: { webviewDomId: s.webviewId },
            }),
            issue({ type: "subscription:dom:theme-changed", ...stamp(s) }),
            issue({ type: "subscription:dom:screen-resized", ...stamp(s) }),
            issue({
                type: "subscription:camera:moved-debounced",
                ...stamp(s),
            }),
            issue({ type: "subscription:scene:pointer", ...stamp(s), req: {} }),
            issue({ type: "subscription:scene:click", ...stamp(s), req: {} }),
            ...(
                [
                    "subscription:scene:elements-added",
                    "subscription:scene:elements-updated",
                    "subscription:scene:elements-removed",
                    "subscription:scene:elements-replaced",
                ] as const
            ).map((type) =>
                issue({ type, ...stamp(s), req: { properties: PROPERTIES } })
            ),
            issue({
                type: "subscription:scene:drawdy-element-selection",
                ...stamp(s),
            }),
            ...[s.menuIds.toggle, s.menuIds.addMinute, s.menuIds.reset].map(
                (menuId) =>
                    issue({
                        type: "subscription:context-menu:clicked",
                        ...stamp(s),
                        req: { menuId },
                    })
            ),
        ]);
    }

    const activate: DriverModule["activate"] = async ({
        manifest,
        issueCommand,
        styling,
        generateId,
    }) => {
        const driverId = manifest.driverId;
        const s: State = {
            manifest,
            driverId,
            issueCommand,
            generateId,
            styling,
            buttonId: `${driverId}:action-button`,
            webviewId: `${driverId}:webview`,
            hudId: `${driverId}:hud-overlay`,
            menuIds: {
                root: `${driverId}:${MENU.root}`,
                toggle: `${driverId}:${MENU.toggle}`,
                addMinute: `${driverId}:${MENU.addMinute}`,
                reset: `${driverId}:${MENU.reset}`,
            },
            sound: DEFAULT_SOUND,
            timers: new Map(),
            glyphs: new Map(),
            moved: new Map(),
            mine: new Set(),
            finished: new Set(),
            down: null,
            selection: [],
            target: null,
            targetKey: null,
            windowWidth: 1280,
            view: null,
            hudKey: "",
            hudChain: Promise.resolve(),
            flashes: new Map(),
            seenRunning: new Set(),
            handled: new Set(),
            wake: null,
            lastPanel: "",
            canEdit: true,
            noticeUntil: 0,
        };
        const created = await issueCommand({
            type: "command:dom:create-action-button",
            ...stamp(s),
            req: { domElementId: s.buttonId, svg: ACTION_BUTTON_SVG },
        });
        if (created.res.error !== undefined) return;
        d = s;

        await subscribe(s);
        await issueCommand({
            type: "command:context-menu:add",
            ...stamp(s),
            req: {
                menuId: s.menuIds.root,
                menuTitle: "Timer",
                children: [
                    { menuId: s.menuIds.toggle, menuTitle: "Start / Pause" },
                    { menuId: s.menuIds.addMinute, menuTitle: "+1 minute" },
                    { menuId: s.menuIds.reset, menuTitle: "Reset" },
                ],
            },
        });
        await loadPrefs(s);
        const size = await issueCommand({
            type: "command:dom:window-size",
            ...stamp(s),
        });
        if (size.res.error === undefined) s.windowWidth = size.res.value.width;
        await readView(s);
        absorb(s, await fetchElements(s));
        await readSelection(s);
        s.canEdit = await canEdit(placeCtx(s));
        refresh(s);
    };

    const onEvent: DriverModule["onEvent"] = async (
        event: DriverSubscriptionEvent
    ) => {
        const s = d;
        if (!s) return;
        switch (event.type) {
            case "subscription:dom:element-clicked": {
                if (event.body.domElementId === s.buttonId)
                    await enqueue(() => openPanel(s));
                return;
            }
            case "subscription:scene:pointer": {
                if (event.body.type === "down")
                    s.down = {
                        dom: event.body.cursor.domSpace,
                        canvas: event.body.cursor.canvasSpace,
                    };
                return;
            }
            case "subscription:scene:click": {
                const down = s.down;
                s.down = null;
                const up = event.body.cursor.domSpace;
                if (
                    !down ||
                    Math.hypot(up.x - down.dom.x, up.y - down.dom.y) >
                        CLICK_SLOP_PX
                )
                    return;
                const ids = event.body.drawdyElementIds;
                await enqueue(() => clickAt(s, ids, down.canvas));
                return;
            }
            case "subscription:webview:message": {
                if (event.body.webviewDomId !== s.webviewId) return;
                if (!isRecord(event.body.message)) return;
                await handleMessage(s, event.body.message as WebviewToDriver);
                return;
            }
            case "subscription:dom:theme-changed": {
                s.styling = event.body.styling;
                post(s, { type: "theme", cssVars: stylingCssVars(s.styling) });
                refresh(s);
                return;
            }
            case "subscription:dom:screen-resized": {
                s.windowWidth = event.body.width;
                await readView(s);
                refresh(s);
                return;
            }
            case "subscription:camera:moved-debounced": {
                await readView(s);
                refresh(s);
                return;
            }
            case "subscription:scene:elements-added":
            case "subscription:scene:elements-updated": {
                if (absorb(s, event.body.drawdyElements)) refresh(s);
                return;
            }
            case "subscription:scene:elements-removed": {
                const ids = event.body.drawdyElements.map((el) => el.id);
                if (!ids.some((id) => s.timers.has(id) || s.glyphs.has(id)))
                    return;
                forget(s, ids);
                refresh(s);
                return;
            }
            case "subscription:scene:elements-replaced": {
                s.timers.clear();
                s.glyphs.clear();
                s.flashes.clear();
                absorb(s, event.body.drawdyElements);
                refresh(s);
                return;
            }
            case "subscription:scene:drawdy-element-selection": {
                s.selection = event.body.drawdyElementIds;
                syncPanel(s);
                return;
            }
            case "subscription:context-menu:clicked": {
                const { menuId } = event.body;
                await enqueue(() => onMenu(s, menuId));
                return;
            }
            default:
                return;
        }
    };

    return { activate, onEvent };
}
