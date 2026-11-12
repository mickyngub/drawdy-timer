import type { DomElementSchema, DriverManifest } from "@drawdy/driver-protocol";
import { createTimerDriver } from "../src/driver";
import {
    newTimer,
    readTimer,
    toMeta,
    type Timer,
} from "../src/lib/timer-state";
import {
    buttonRect,
    WIDGET_SIZE,
    widgetElement,
    type ButtonAction,
} from "../src/lib/widget";
import type { DriverToWebview } from "../src/shared/messages";
import {
    fakeBoard,
    fakeClock,
    fakeHost,
    START,
    type FakeBoard,
    type FakeClock,
    type FakeHost,
    type Stored,
} from "./fake-host";

export const DRIVER_ID = "mickyngub.timer";
export const HUD_ID = `${DRIVER_ID}:hud-overlay`;
export const manifest = {
    driverId: DRIVER_ID,
    driverName: "Timer",
    driverVersion: "1.1.0",
    main: "main.js",
    permissions: ["dom", "scene", "storage"],
} as DriverManifest;

/** Boots a driver on a fake host; `skewMs` sets this machine's clock that far from the shared one. */
export async function client(
    clock: FakeClock,
    options: Parameters<typeof fakeHost>[0] & {
        skewMs?: number;
        theme?: "light" | "dark";
    } = {}
): Promise<FakeHost> {
    const host = fakeHost(options);
    const skew = options.skewMs ?? 0;
    const driver = createTimerDriver({
        now: () => clock.now() + skew,
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
    });
    await host.boot(driver, manifest, options.theme);
    return host;
}

export async function solo(options: Parameters<typeof client>[1] = {}) {
    const clock = fakeClock();
    const board = options.board ?? fakeBoard();
    const host = await client(clock, { ...options, board });
    const settle = () => board.settle();
    const advance = (ms: number) => clock.advance(ms, settle);
    return { clock, board, host, settle, advance };
}

export const sentOf = (host: FakeHost, type: string) =>
    host.sent.filter((s) => s.type === type);

export const adds = (host: FakeHost) =>
    sentOf(host, "command:scene:add-drawdy-elements");

export const removes = (host: FakeHost) =>
    sentOf(host, "command:scene:remove-drawdy-elements");

/** Every board write this client made, in order: "add" or "remove". */
export const writes = (host: FakeHost) =>
    host.sent
        .filter(
            (s) =>
                s.type.startsWith("command:scene:") &&
                /add-drawdy|remove-drawdy|update-drawdy/.test(s.type)
        )
        .map((s) => s.type.replace("command:scene:", "").split("-")[0]);

export const widgets = (host: FakeHost): Stored[] =>
    host.live().filter((el) => el.type === "component" && el.meta?.[DRIVER_ID]);

export const timerOf = (el: Stored | null): Timer | null =>
    el ? readTimer(el.meta?.[DRIVER_ID], el.id) : null;

export function onlyWidget(host: FakeHost): Stored {
    const all = widgets(host);
    if (all.length !== 1)
        throw new Error(`expected one widget, found ${all.length}`);
    return all[0];
}

export const onlyTimer = (host: FakeHost): Timer => timerOf(onlyWidget(host))!;

export const rectOf = (el: Stored) => ({
    x: el.x as number,
    y: el.y as number,
    width: el.width as number,
    height: el.height as number,
});

export function nodes(schema: DomElementSchema): DomElementSchema[] {
    const children = "children" in schema ? (schema.children ?? []) : [];
    return [schema, ...children.flatMap(nodes)];
}

export const schemaOf = (el: Stored) => el.schema as DomElementSchema;

export function srcDocOf(el: Stored): string {
    const frame = nodes(schemaOf(el)).find((n) => n.type === "iframe");
    if (!frame || frame.type !== "iframe" || !("srcDoc" in frame.child))
        throw new Error("the widget has no face");
    return frame.child.srcDoc;
}

/** The timer state the face page was built with. */
export function bakedOf(srcDoc: string): unknown {
    const match =
        /<script type="application\/json" id="timer">([\s\S]*?)<\/script>/.exec(
            srcDoc
        );
    if (!match) throw new Error("the face carries no timer");
    return JSON.parse(match[1]);
}

/** What the widget's start-or-pause button shows: "start", "pause", "resume" or "start-again". */
export const primaryOf = (el: Stored): string =>
    buttonIdsOf(el)[0]?.split(":").at(-1) ?? "";

/** The ids of the widget's buttons, in order. */
export const buttonIdsOf = (el: Stored): string[] =>
    nodes(schemaOf(el)).flatMap((n) =>
        n.domId?.startsWith(`${DRIVER_ID}:`) ? [n.domId] : []
    );

/** Clicks one of a widget's buttons on the board; `dragBy` moves the pointer before letting go. */
export async function press(
    host: FakeHost,
    settle: () => Promise<void>,
    el: Stored,
    action: ButtonAction,
    dragBy = 0
) {
    const timer = timerOf(el)!;
    const slots =
        action === "start" ? ["start", "resume", "start-again"] : [action];
    const shown = buttonIdsOf(el).some((id) =>
        slots.some((slot) => id === `${DRIVER_ID}:${timer.id}:${slot}`)
    );
    if (!shown) throw new Error(`the widget shows no ${action} button`);
    const r = buttonRect(rectOf(el), action);
    const at = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    host.clickAt(at, { x: at.x + dragBy, y: at.y });
    await settle();
}

export const OFF_SCREEN = { x: 20_000, y: 20_000, width: 1600, height: 1000 };

export function seededWidget(
    id: string,
    timer: Timer = newTimer(id),
    at: { x: number; y: number; width?: number; height?: number } = {
        x: 100,
        y: 100,
    }
): Stored {
    const el = widgetElement(
        DRIVER_ID,
        id,
        timer,
        { ...WIDGET_SIZE, ...at },
        START
    ) as Record<string, unknown>;
    const { drawdyElementId, ...rest } = el;
    return { ...rest, id: drawdyElementId as string, type: "component" };
}

/** A 1.0.0 timer: a frame with the state in its meta and the stopwatch glyph inside. */
export function legacyFrame(
    id: string,
    timer: Timer = newTimer(id),
    at = { x: 100, y: 100 }
): Stored[] {
    return [
        {
            id,
            type: "frame",
            ...at,
            width: 240,
            height: 140,
            frameName: "⏱ 5:00",
            meta: {
                [DRIVER_ID]: { ...toMeta({ ...timer, id }), startedBy: "old" },
            },
        },
        {
            id: `${id}-glyph`,
            type: "text",
            x: at.x,
            y: at.y + 45,
            width: 240,
            height: 80,
            frameId: id,
            meta: { [DRIVER_ID]: { v: 1, glyphOf: id } },
        },
    ];
}

export function lastState(host: FakeHost) {
    const states = host.posted.filter(
        (m): m is Extract<DriverToWebview, { type: "state" }> =>
            m.type === "state"
    );
    return states.at(-1) ?? null;
}

export const chimes = (host: FakeHost) =>
    host.posted.filter((m) => m.type === "chime");

export function findSchema(
    schema: DomElementSchema,
    domId: string
): DomElementSchema | null {
    return nodes(schema).find((n) => n.domId === domId) ?? null;
}

export const textOf = (schema: DomElementSchema | null): string =>
    !schema
        ? ""
        : schema.type === "text"
          ? schema.child
          : "children" in schema
            ? (schema.children ?? []).map(textOf).join("")
            : "";

/** What the floating pill shows: "running", "done", or null when there is no pill. */
export function hudKind(host: FakeHost): "running" | "done" | null {
    const hud = host.floating.get(HUD_ID);
    if (!hud) return null;
    if (findSchema(hud.schema, `${DRIVER_ID}:hud-done`)) return "done";
    return findSchema(hud.schema, `${DRIVER_ID}:hud-time`) ? "running" : null;
}

/** The time the pill counts down, such as "4:59". */
export function hudTime(host: FakeHost): string | null {
    const hud = host.floating.get(HUD_ID);
    const time = hud && findSchema(hud.schema, `${DRIVER_ID}:hud-time`);
    return time ? textOf(time) : null;
}

export const hudUpserts = (host: FakeHost) =>
    sentOf(host, "command:dom:upsert-floating-element").length;

export async function addTimer(host: FakeHost, settle: () => Promise<void>) {
    host.clickButton();
    await settle();
    return onlyWidget(host);
}

export async function act(
    host: FakeHost,
    settle: () => Promise<void>,
    id: string,
    ...actions: Record<string, unknown>[]
) {
    host.message({ type: "act", id, actions });
    await settle();
}

export { fakeBoard, fakeClock, START };
export type { FakeBoard };
