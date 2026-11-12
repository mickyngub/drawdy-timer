import assert from "node:assert/strict";
import { test } from "node:test";
import type { Rect } from "../src/lib/free-spot";
import { PRIMARY_LABEL } from "../src/lib/panel-model";
import {
    MAX_LABEL,
    MINUTE_MS,
    newTimer,
    reduce,
    toMeta,
    type Timer,
} from "../src/lib/timer-state";
import {
    BUTTON_ACTIONS,
    buttonAt,
    buttonDomId,
    buttonRect,
    faceDoc,
    planReplacement,
    WIDGET_LABEL,
    WIDGET_SIZE,
    widgetButtons,
    widgetSchema,
    type Placed,
} from "../src/lib/widget";
import { bakedOf, nodes } from "./helpers";

const NOW = Date.UTC(2026, 10, 12, 14, 0, 0);
const D = "mickyngub.timer";
const running = (timer: Timer = newTimer("t", 5)) =>
    reduce(timer, { type: "start" }, NOW);

test("the face page carries the timer's meta", () => {
    const timer = running(newTimer("t", 25, "Silent brainstorm"));
    assert.deepEqual(bakedOf(faceDoc(timer)), toMeta(timer));
});

test("no label can close the face's script or open markup", () => {
    const timer = newTimer("t", 5, "</script><img src=x onerror=alert(1)>");
    const doc = faceDoc(timer);
    assert.equal(doc.includes("</script><img"), false);
    assert.equal((bakedOf(doc) as { label: string }).label, timer.label);
});

test("the face page stays under 8 KB with the longest label and a long run", () => {
    const longest = reduce(
        reduce(
            newTimer("t-0123456789abcdef", 99, "x".repeat(MAX_LABEL)),
            { type: "start" },
            NOW
        ),
        { type: "add-minute" },
        NOW
    );
    assert.ok(longest.label.length === MAX_LABEL);
    const bytes = Buffer.byteLength(faceDoc(longest), "utf8");
    assert.ok(bytes < 8 * 1024, `the face page is ${bytes} bytes`);
});

test("the start or pause button follows the state, and reset rests while there is nothing to reset", () => {
    const ready = newTimer("t", 5);
    const run = running(ready);
    const paused = reduce(run, { type: "pause" }, NOW + 1000);
    const cases: [Timer, number, string, string, boolean][] = [
        [ready, NOW, "start", PRIMARY_LABEL.start, false],
        [run, NOW + 1000, "pause", PRIMARY_LABEL.pause, true],
        [paused, NOW + 2000, "start", PRIMARY_LABEL.resume, true],
        [run, NOW + 5 * MINUTE_MS, "start", PRIMARY_LABEL.restart, true],
    ];
    for (const [timer, now, action, label, resettable] of cases) {
        const [primary, addMinute, reset] = widgetButtons(timer, now);
        assert.equal(primary.action, action);
        assert.equal(primary.label, label);
        assert.equal(primary.primary, true);
        assert.equal(addMinute.action, "add-minute");
        assert.equal(reset.action, "reset");
        assert.equal(reset.enabled, resettable);
    }
});

test("the widget is the labelled face over a row of buttons whose ids name the timer and what they do", () => {
    const timer = running();
    const schema = widgetSchema(D, timer, NOW + 1000);
    assert.equal(schema.type, "column");
    const [face, row] = "children" in schema ? (schema.children ?? []) : [];
    assert.equal(face.type, "iframe");
    assert.equal(face.type === "iframe" && face.label, WIDGET_LABEL);
    assert.equal(row.type, "row");
    const buttons = nodes(row).filter((n) => n.domId !== undefined);
    assert.deepEqual(
        buttons.map((b) => b.domId),
        ["pause", "add-minute", "reset"].map((a) =>
            buttonDomId(D, timer.id, a as (typeof BUTTON_ACTIONS)[number])
        )
    );
    assert.ok(
        buttons.every((b) => b.type !== "button"),
        "Drawdy reports scene clicks only on non-interactive content"
    );
});

test("a click maps to the button under it, at any size the widget was resized to", () => {
    const run = running();
    for (const rect of [
        { x: 0, y: 0, ...WIDGET_SIZE },
        { x: -500, y: 200, width: 600, height: 420 },
    ]) {
        for (const action of ["pause", "add-minute", "reset"] as const) {
            const r = buttonRect(rect, action);
            const centre = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
            assert.equal(buttonAt(rect, run, centre), action);
        }
        const face = {
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 3,
        };
        assert.equal(buttonAt(rect, run, face), null);
        const gap = buttonRect(rect, "add-minute");
        assert.equal(buttonAt(rect, run, { x: gap.x - 1, y: gap.y + 5 }), null);
    }
    const r = buttonRect({ x: 0, y: 0, ...WIDGET_SIZE }, "start");
    const first = { x: r.x + 5, y: r.y + 5 };
    assert.equal(
        buttonAt({ x: 0, y: 0, ...WIDGET_SIZE }, newTimer("t"), first),
        "start"
    );
    assert.equal(
        buttonAt(
            { x: 0, y: 0, ...WIDGET_SIZE },
            reduce(run, { type: "pause" }, NOW + 1000),
            first
        ),
        "start"
    );
});

const placed = (
    el: string,
    timer: Timer,
    rect: Rect = { x: 40, y: 60, ...WIDGET_SIZE },
    kind: Placed["kind"] = "widget"
): Placed => ({ el, kind, timer: { ...timer }, rect });

test("a change is a new widget at the same place and size, then the old one removed", () => {
    const old = placed("w1", newTimer("k"), {
        x: 40,
        y: 60,
        width: 450,
        height: 315,
    });
    const next = running(old.timer);
    const plan = planReplacement({
        driverId: D,
        old,
        at: old.rect!,
        others: [],
        glyphs: [],
        next,
        newId: "w2",
        now: NOW,
        place: { frameId: "section" },
    });
    assert.deepEqual(plan.rect, old.rect);
    assert.deepEqual(plan.remove, ["w1"]);
    assert.equal(plan.timer.id, "k");
    const el = plan.element as Record<string, unknown>;
    assert.equal(el.type, "component");
    assert.equal(el.drawdyElementId, "w2");
    assert.deepEqual([el.x, el.y, el.width, el.height], [40, 60, 450, 315]);
    assert.equal(el.frameId, "section");
    assert.deepEqual(el.meta, { [D]: toMeta(next) });
});

test("a 1.0.0 frame becomes a widget at its corner, and its glyph goes with it", () => {
    const frame = placed(
        "f1",
        newTimer("f1"),
        { x: 10, y: 20, width: 240, height: 140 },
        "frame"
    );
    const plan = planReplacement({
        driverId: D,
        old: frame,
        at: frame.rect!,
        others: [],
        glyphs: ["g1"],
        next: running(frame.timer),
        newId: "w2",
        now: NOW,
    });
    assert.deepEqual(plan.rect, { x: 10, y: 20, ...WIDGET_SIZE });
    assert.deepEqual(plan.remove, ["f1", "g1"]);
    assert.equal(plan.timer.id, "f1");
});

test("stacked twins of the timer go with the press, and a copy elsewhere makes the pressed one take a fresh id", () => {
    const timer = newTimer("k");
    const old = placed("w1", timer);
    const twin = placed("w9", running(timer));
    const copy = placed("c1", timer, { x: 900, y: 60, ...WIDGET_SIZE });
    const other = placed("o1", newTimer("z"));
    const plan = planReplacement({
        driverId: D,
        old,
        at: old.rect!,
        others: [twin, copy, other],
        glyphs: [],
        next: running(timer),
        newId: "w2",
        now: NOW,
    });
    assert.deepEqual(plan.remove, ["w1", "w9"]);
    assert.equal(plan.timer.id, "w2");

    const alone = planReplacement({
        driverId: D,
        old,
        at: old.rect!,
        others: [twin, other],
        glyphs: [],
        next: running(timer),
        newId: "w3",
        now: NOW,
    });
    assert.equal(alone.timer.id, "k");
});
