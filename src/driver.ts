import type {
    DrawdyElementSchema,
    DriverCommandIssuer,
    DriverManifest,
    DriverModule,
    DriverSubscriptionEvent,
    ModuleStyling,
    SubscribeableKey,
    SubscribedDrawdyElement,
} from "@drawdy/driver-protocol";
import { ACTION_BUTTON_SVG } from "./action-button";
import {
    centredIn,
    findFreeRect,
    revealAndSelect,
    visibleArea,
    type Rect,
} from "./lib/free-spot";
import {
    FLASH_MS,
    hudPosition,
    hudSchema,
    nextWake,
    pickHud,
    type Theme,
} from "./lib/hud";
import {
    DEFAULT_MINUTES,
    frameNameFor,
    newTimer,
    readTimer,
    reduce,
    sameTimer,
    toMeta,
    type ClockFormat,
    type Timer,
    type TimerAction,
} from "./lib/timer-state";
import {
    SOUNDS,
    type DriverToWebview,
    type PanelAction,
    type PanelError,
    type Sound,
    type WebviewToDriver,
} from "./shared/messages";
import { WEBVIEW_HTML } from "./webview-html";

export const ANCHOR_SIZE = { width: 240, height: 140 };
// Text presentation of U+23F1 is a thin outline in most fonts; the variation selector asks for the emoji.
export const GLYPH = "⏱️";
const GLYPH_SIZE = 64;
// Measured on drawdy.io: Drawdy draws the emoji about 8 units above its text box, so this centres it in the card.
const GLYPH_TOP = 45;
const PROPERTIES: SubscribeableKey[] = ["type", "meta", "frameId"];
// An expiry seen later than this (a throttled background tab) still writes "done" but stays silent.
const LIVE_EXPIRY_MS = 10_000;
const WAKE_SLACK_MS = 15;
const DEVICE_KEY = "device";
const PREFS_KEY = "prefs";
const DEFAULT_SOUND: Sound = "soft";

export const MENU = {
    root: "timer",
    toggle: "timer.toggle",
    addMinute: "timer.add-minute",
    reset: "timer.reset",
} as const;

export type Env = {
    now: () => number;
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
    clock: ClockFormat;
};

const realEnv: Env = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) =>
        clearTimeout(handle as ReturnType<typeof setTimeout>),
    clock: {},
};

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
    deviceId: string;
    sound: Sound;
    timers: Map<string, Timer>;
    glyphs: Map<string, string>;
    selection: string[];
    target: string | null;
    windowWidth: number;
    hudKey: string;
    hudChain: Promise<unknown>;
    flashes: Map<string, number>;
    seenRunning: Set<string>;
    handled: Set<string>;
    wake: unknown;
    lastPanel: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

function randomId(): string {
    const bytes = new Uint8Array(8);
    try {
        crypto.getRandomValues(bytes);
    } catch {
        for (let i = 0; i < bytes.length; i++)
            bytes[i] = Math.floor(Math.random() * 256);
    }
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

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

const expiryKey = (timer: Timer): string => `${timer.id}:${timer.endsAt}`;

function toTimerAction(action: unknown, by: string): TimerAction | null {
    if (!isRecord(action)) return null;
    switch (action.type as PanelAction["type"]) {
        case "start":
            return { type: "start", by };
        case "pause":
            return { type: "pause" };
        case "add-minute":
            return { type: "add-minute", by };
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

export function anchorSchemas(
    driverId: string,
    timer: Timer,
    glyphId: string,
    at: { x: number; y: number },
    now: number,
    clock: ClockFormat = {}
): DrawdyElementSchema[] {
    return [
        {
            type: "frame",
            drawdyElementId: timer.id,
            name: frameNameFor(timer, now, clock),
            position: [at.x, at.y],
            width: ANCHOR_SIZE.width,
            height: ANCHOR_SIZE.height,
            rotation: 0,
            meta: { [driverId]: toMeta(timer) },
        },
        {
            type: "text",
            drawdyElementId: glyphId,
            x: at.x,
            y: at.y + GLYPH_TOP,
            width: ANCHOR_SIZE.width,
            text: GLYPH,
            fontSize: GLYPH_SIZE,
            color: "#1e1e1e",
            textAlign: "center",
            frameId: timer.id,
            meta: { [driverId]: { v: 1, glyphOf: timer.id } },
        },
    ];
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

    async function kvSet(
        s: State,
        key: string,
        payload: Record<string, unknown>
    ): Promise<void> {
        await s
            .issueCommand({
                type: "command:kv-storage:set",
                ...stamp(s),
                req: { key, payload },
            })
            .catch(() => undefined);
    }

    async function loadDevice(s: State): Promise<void> {
        const stored = await kvGet(s, DEVICE_KEY);
        if (typeof stored?.id === "string" && stored.id) {
            s.deviceId = stored.id;
            return;
        }
        await kvSet(s, DEVICE_KEY, { id: s.deviceId });
    }

    async function loadPrefs(s: State): Promise<void> {
        const stored = await kvGet(s, PREFS_KEY);
        if (SOUNDS.includes(stored?.sound as Sound))
            s.sound = stored?.sound as Sound;
    }

    async function fetchElements(
        s: State,
        ids?: string[]
    ): Promise<SubscribedDrawdyElement[]> {
        try {
            const res = await s.issueCommand({
                type: "command:scene:get-drawdy-elements",
                ...stamp(s),
                req: { properties: PROPERTIES, drawdyElementIds: ids },
            });
            return res.res.error === undefined
                ? res.res.value.drawdyElements
                : [];
        } catch {
            return [];
        }
    }

    function absorb(
        s: State,
        elements: readonly SubscribedDrawdyElement[]
    ): boolean {
        let changed = false;
        for (const el of elements) {
            const raw = el.meta?.[s.driverId];
            const timer = el.type === "frame" ? readTimer(raw, el.id) : null;
            if (timer) {
                const prev = s.timers.get(el.id);
                if (!prev || !sameTimer(prev, timer)) {
                    s.timers.set(el.id, timer);
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
            s.flashes.delete(id);
            if (s.target === id) s.target = null;
        }
    }

    function selectedTimer(s: State): string | null {
        for (const id of s.selection) {
            if (s.timers.has(id)) return id;
            const anchor = s.glyphs.get(id);
            if (anchor && s.timers.has(anchor)) return anchor;
        }
        return null;
    }

    /** The selected timer, else the one last selected or added, else the newest. */
    function targetId(s: State): string | null {
        const selected = selectedTimer(s);
        if (selected) {
            s.target = selected;
            return selected;
        }
        if (s.target && s.timers.has(s.target)) return s.target;
        return [...s.timers.keys()].at(-1) ?? null;
    }

    function chime(s: State): void {
        if (s.sound !== "off") post(s, { type: "chime", sound: s.sound });
    }

    /**
     * Each client reacts once to each run ending, and only to runs it watched,
     * so opening a board hours later is silent and undoing "done" doesn't re-fire it.
     */
    function processExpiries(s: State, now: number): void {
        let chimed = false;
        for (const timer of s.timers.values()) {
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
            if (now - timer.endsAt <= LIVE_EXPIRY_MS) {
                s.flashes.set(timer.id, now + FLASH_MS);
                if (!chimed) chime(s);
                chimed = true;
            }
            if (timer.state === "running" && timer.startedBy === s.deviceId) {
                const id = timer.id;
                void enqueue(() => act(s, id, [{ type: "expire" }]));
            }
        }
    }

    function hudCommand(s: State, command: () => Promise<unknown>): void {
        s.hudChain = s.hudChain.then(command).catch(() => undefined);
    }

    function renderHud(s: State, now: number): void {
        const view = pickHud(s.timers.values(), now, s.flashes);
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
        const message: DriverToWebview = {
            type: "state",
            timer: id ? (s.timers.get(id) ?? null) : null,
            count: s.timers.size,
            sound: s.sound,
        };
        const serialized = JSON.stringify(message);
        if (!force && serialized === s.lastPanel) return;
        s.lastPanel = serialized;
        post(s, message);
    }

    function schedule(s: State, now: number): void {
        if (s.wake !== null) env.clearTimeout(s.wake);
        s.wake = null;
        const at = nextWake(s.timers.values(), now, s.flashes);
        if (at === null) return;
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
        for (const [id, until] of s.flashes)
            if (until <= now) s.flashes.delete(id);
        renderHud(s, now);
        syncPanel(s);
        schedule(s, now);
    }

    /** One user gesture is one anchor update, carrying both the state and the frame name, so it is one undo step. */
    async function act(
        s: State,
        id: string,
        actions: TimerAction[]
    ): Promise<void> {
        const current = s.timers.get(id);
        if (!current) return;
        const now = env.now();
        const next = actions.reduce((t, a) => reduce(t, a, now), current);
        if (sameTimer(next, current)) return;
        s.timers.set(id, next);
        refresh(s);
        const res = await s.issueCommand({
            type: "command:scene:update-drawdy-elements",
            ...stamp(s),
            req: {
                updates: [
                    {
                        drawdyElementId: id,
                        properties: {
                            meta: { [s.driverId]: toMeta(next) },
                            frameName: frameNameFor(next, now, env.clock),
                        },
                    },
                ],
            },
        });
        if (res.res.error === undefined && res.res.value.updated > 0) return;
        const [el] = await fetchElements(s, [id]);
        if (el) absorb(s, [el]);
        else forget(s, [id]);
        refresh(s);
        fail(s, res.res.error?.type);
    }

    function placeCtx(s: State) {
        return {
            issueCommand: s.issueCommand,
            driverId: s.driverId,
            nextRequestId: () => String(requestId++),
            webviewDomId: s.webviewId,
        };
    }

    async function addTimer(s: State): Promise<void> {
        const { width, height } = ANCHOR_SIZE;
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
        const glyphId = s.generateId();
        const now = env.now();
        const timer = newTimer(id, DEFAULT_MINUTES);
        const added = await s.issueCommand({
            type: "command:scene:add-drawdy-elements",
            ...stamp(s),
            req: {
                elements: anchorSchemas(
                    s.driverId,
                    timer,
                    glyphId,
                    spot,
                    now,
                    env.clock
                ),
            },
        });
        if (added.res.error !== undefined) {
            fail(s, added.res.error.type);
            return;
        }
        if (!s.timers.has(id)) s.timers.set(id, timer);
        s.glyphs.set(glyphId, id);
        s.target = id;
        s.selection = [id];
        refresh(s);
        await revealAndSelect(placeCtx(s), [id], spot);
    }

    async function removeTimer(s: State, id: string): Promise<void> {
        if (!s.timers.has(id)) return;
        const glyphs = [...s.glyphs]
            .filter(([, anchor]) => anchor === id)
            .map(([glyph]) => glyph);
        const res = await s.issueCommand({
            type: "command:scene:remove-drawdy-elements",
            ...stamp(s),
            req: { drawdyElementIds: [id, ...glyphs] },
        });
        if (res.res.error !== undefined) {
            fail(s, res.res.error.type);
            return;
        }
        forget(s, [id, ...glyphs]);
        refresh(s);
    }

    async function locate(s: State, id: string): Promise<void> {
        const res = await s.issueCommand({
            type: "command:scene:element-rects",
            ...stamp(s),
            req: { drawdyElementIds: [id] },
        });
        const rect =
            res.res.error === undefined ? res.res.value.rects[0]?.rect : null;
        if (!rect) return;
        s.target = id;
        await revealAndSelect(placeCtx(s), [id], rect);
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
        if (s.timers.size === 0) await addTimer(s);
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
        const by = s.deviceId;
        if (menuId === s.menuIds.toggle)
            await act(s, id, [{ type: "toggle", by }]);
        else if (menuId === s.menuIds.addMinute)
            await act(s, id, [{ type: "add-minute", by }]);
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
                    .map((a) => toTimerAction(a, s.deviceId))
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
                await kvSet(s, PREFS_KEY, { sound: s.sound });
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
            deviceId: randomId(),
            sound: DEFAULT_SOUND,
            timers: new Map(),
            glyphs: new Map(),
            selection: [],
            target: null,
            windowWidth: 1280,
            hudKey: "",
            hudChain: Promise.resolve(),
            flashes: new Map(),
            seenRunning: new Set(),
            handled: new Set(),
            wake: null,
            lastPanel: "",
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
        await loadDevice(s);
        await loadPrefs(s);
        const size = await issueCommand({
            type: "command:dom:window-size",
            ...stamp(s),
        });
        if (size.res.error === undefined) s.windowWidth = size.res.value.width;
        absorb(s, await fetchElements(s));
        await readSelection(s);
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
