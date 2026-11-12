import assert from "node:assert/strict";
import { test } from "node:test";
import type { DomElementSchema } from "@drawdy/driver-protocol";
import {
    HUD_WIDTH,
    hudPosition,
    hudSchema,
    MIN_READABLE_PX,
    nextWake,
    onScreen,
    pickHud,
} from "../src/lib/hud";
import {
    MINUTE_MS,
    newTimer,
    reduce,
    type Timer,
} from "../src/lib/timer-state";

const NOW = Date.UTC(2026, 10, 12, 14, 0, 0);
const NONE = new Map<string, number>();

const running = (id: string, minutes: number, at = NOW, label = ""): Timer =>
    reduce(newTimer(id, minutes, label), { type: "start" }, at);

function find(
    schema: DomElementSchema,
    domId: string
): DomElementSchema | null {
    if (schema.domId === domId) return schema;
    if (!("children" in schema)) return null;
    for (const child of schema.children ?? []) {
        const hit = find(child, domId);
        if (hit) return hit;
    }
    return null;
}

const textOf = (schema: DomElementSchema | null): string =>
    !schema
        ? ""
        : schema.type === "text"
          ? schema.child
          : "children" in schema
            ? (schema.children ?? []).map(textOf).join("")
            : "";

test("a widget is on screen when at least half of it shows and it is big enough to read", () => {
    const view = { rect: { x: 0, y: 0, width: 1600, height: 1000 }, zoom: 1 };
    const widget = { x: 100, y: 100, width: 300, height: 210 };
    assert.equal(onScreen(widget, view), true);
    assert.equal(onScreen({ ...widget, x: 1450 }, view), true);
    assert.equal(onScreen({ ...widget, x: 1460 }, view), false);
    assert.equal(onScreen({ ...widget, y: 5000 }, view), false);
    const far = { ...view, zoom: (MIN_READABLE_PX - 1) / 300 };
    assert.equal(onScreen(widget, far), false);
    assert.equal(
        onScreen(widget, { ...view, zoom: MIN_READABLE_PX / 300 }),
        true
    );
    assert.equal(onScreen(null, view), false);
    assert.equal(onScreen(widget, null), false);
});

test("no pill while every timer is ready", () => {
    assert.equal(pickHud([newTimer("a"), newTimer("b")], NOW, NONE), null);
});

test("with several running, the pill shows the one ending soonest", () => {
    const view = pickHud(
        [
            running("long", 10),
            running("short", 3, NOW - 1000),
            running("mid", 5),
        ],
        NOW,
        NONE
    );
    assert.equal(view?.kind, "running");
    assert.equal(view?.id, "short");
    assert.equal(view?.kind === "running" && view.time, "2:59");
});

test("a paused timer gets no pill; a running one does", () => {
    const paused = reduce(running("p", 5), { type: "pause" }, NOW + 30_000);
    assert.equal(pickHud([paused], NOW + 40_000, NONE), null);
    assert.equal(
        pickHud([paused, running("r", 9)], NOW + 40_000, NONE)?.id,
        "r"
    );
});

test("time's up takes the pill for its five seconds, then the next running timer returns", () => {
    const ended = reduce(
        running("ended", 1),
        { type: "expire" },
        NOW + MINUTE_MS
    );
    const other = running("other", 9);
    const flashes = new Map([["ended", NOW + MINUTE_MS + 5000]]);
    assert.equal(
        pickHud([ended, other], NOW + MINUTE_MS + 100, flashes)?.kind,
        "done"
    );
    assert.equal(
        pickHud([ended, other], NOW + MINUTE_MS + 5000, flashes)?.id,
        "other"
    );
    assert.equal(pickHud([ended], NOW + MINUTE_MS + 5000, flashes), null);
});

test("a timer restarted during its time's up moment shows its new run", () => {
    const ended = reduce(running("t", 1), { type: "expire" }, NOW + MINUTE_MS);
    const again = reduce(ended, { type: "add-minute" }, NOW + MINUTE_MS + 1000);
    const flashes = new Map([["t", NOW + MINUTE_MS + 5000]]);
    assert.equal(
        pickHud([again], NOW + MINUTE_MS + 1500, flashes)?.kind,
        "running"
    );
});

test("the last ten seconds are urgent and pulse on alternate seconds", () => {
    const timer = running("t", 1);
    const at = (left: number) =>
        pickHud([timer], NOW + MINUTE_MS - left * 1000, NONE);
    const urgent = (left: number) => {
        const view = at(left);
        return view?.kind === "running" ? [view.urgent, view.pulse] : null;
    };
    assert.deepEqual(urgent(11), [false, false]);
    assert.deepEqual(urgent(10), [true, false]);
    assert.deepEqual(urgent(9), [true, true]);
    assert.deepEqual(urgent(8), [true, false]);
    assert.deepEqual(urgent(1), [true, true]);
});

test("the driver wakes when the shown second changes, when a timer ends and when time's up fades", () => {
    const timer = running("t", 5);
    assert.equal(nextWake([timer], NOW, NONE), NOW + 1000);
    assert.equal(nextWake([timer], NOW + 400, NONE), NOW + 1000);
    assert.equal(nextWake([timer], NOW + 1000, NONE), NOW + 2000);
    assert.equal(
        nextWake([running("s", 1)], NOW + MINUTE_MS - 300, NONE),
        NOW + MINUTE_MS
    );
    assert.equal(
        nextWake([newTimer("r")], NOW, new Map([["x", NOW + 4000]])),
        NOW + 4000
    );
    assert.equal(nextWake([newTimer("r")], NOW, NONE), null);
});

test("the pill sits at the top centre and shows the time and a shortened label", () => {
    assert.deepEqual(hudPosition(1280), { x: (1280 - HUD_WIDTH) / 2, y: 76 });
    assert.equal(hudPosition(300).x, 0);
    const view = pickHud(
        [running("t", 25, NOW, "A very long label for a design critique")],
        NOW + 1000,
        NONE
    );
    assert.ok(view);
    const schema = hudSchema(view, "dark", "d");
    assert.equal(textOf(find(schema, "d:hud-time")), "24:59");
    assert.equal(
        textOf(find(schema, "d:hud-label")),
        "A very long label for a des…"
    );
    const time = find(schema, "d:hud-time");
    assert.ok(time && "children" in time);
    assert.ok(
        (time.children ?? []).every(
            (cell) => cell.type === "text" && cell.child.length === 1
        ),
        "every character has its own fixed cell"
    );
});
