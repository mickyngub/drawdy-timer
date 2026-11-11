import type { DomElementSchema, DriverManifest } from "@drawdy/driver-protocol";
import { createTimerDriver } from "../src/driver";
import { readTimer, type Timer } from "../src/lib/timer-state";
import type { DriverToWebview } from "../src/shared/messages";
import {
    fakeBoard,
    fakeClock,
    fakeHost,
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
    driverVersion: "1.0.0",
    main: "main.js",
    permissions: ["dom", "scene", "storage"],
} as DriverManifest;
export const GB = { locale: "en-GB", timeZone: "UTC" };

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
        clock: GB,
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

export const updates = (host: FakeHost) =>
    sentOf(host, "command:scene:update-drawdy-elements");

export const anchors = (host: FakeHost): Stored[] =>
    host.live().filter((el) => el.type === "frame" && el.meta?.[DRIVER_ID]);

export const timerOf = (el: Stored | null): Timer | null =>
    el ? readTimer(el.meta?.[DRIVER_ID], el.id) : null;

export const onlyTimer = (host: FakeHost): Timer => {
    const [anchor] = anchors(host);
    const timer = timerOf(anchor ?? null);
    if (!timer) throw new Error("no timer on the board");
    return timer;
};

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
    if (schema.domId === domId) return schema;
    if (!("children" in schema)) return null;
    for (const child of schema.children ?? []) {
        const hit = findSchema(child, domId);
        if (hit) return hit;
    }
    return null;
}

export const textOf = (schema: DomElementSchema | null): string =>
    !schema
        ? ""
        : schema.type === "text"
          ? schema.child
          : "children" in schema
            ? (schema.children ?? []).map(textOf).join("")
            : "";

/** What the floating pill shows: "4:59", "Time's up", or null when there is no pill. */
export function hudText(host: FakeHost): string | null {
    const hud = host.floating.get(HUD_ID);
    if (!hud) return null;
    return (
        textOf(findSchema(hud.schema, `${DRIVER_ID}:hud-time`)) ||
        textOf(findSchema(hud.schema, `${DRIVER_ID}:hud-done`))
    );
}

export const hudUpserts = (host: FakeHost) =>
    sentOf(host, "command:dom:upsert-floating-element").length;

export async function addTimer(host: FakeHost, settle: () => Promise<void>) {
    host.clickButton();
    await settle();
    return onlyTimer(host);
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

export { fakeBoard, fakeClock };
export type { FakeBoard };
