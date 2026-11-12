import assert from "node:assert/strict";
import { test } from "node:test";
import { MINUTE_MS } from "../src/lib/timer-state";
import {
    act,
    bakedOf,
    chimes,
    client,
    fakeBoard,
    fakeClock,
    HUD_ID,
    hudKind,
    hudTime,
    lastState,
    OFF_SCREEN,
    onlyTimer,
    onlyWidget,
    press,
    srcDocOf,
    timerOf,
    widgets,
    writes,
} from "./helpers";
import type { FakeHost } from "./fake-host";

async function pair(skewMs = 0) {
    const clock = fakeClock();
    const board = fakeBoard();
    const a = await client(clock, { board });
    const b = await client(clock, { board, skewMs });
    const settle = () => board.settle();
    const advance = (ms: number) => clock.advance(ms, settle);
    a.clickButton();
    await settle();
    return { clock, board, a, b, settle, advance };
}

/** Both screens hold exactly one widget, with the same element, meta and face. */
function sameSingleWidget(a: FakeHost, b: FakeHost) {
    const [wa, wb] = [onlyWidget(a), onlyWidget(b)];
    assert.equal(wa.id, wb.id);
    assert.deepEqual(wa.meta, wb.meta);
    assert.equal(srcDocOf(wa), srcDocOf(wb));
    assert.deepEqual(bakedOf(srcDocOf(wa)), Object.values(wa.meta!)[0]);
}

test("a widget one person adds shows up for the other, whose screen can press it", async () => {
    const { a, b, settle } = await pair();
    sameSingleWidget(a, b);
    await press(b, settle, onlyWidget(b), "start");
    assert.equal(onlyTimer(a).state, "running");
    sameSingleWidget(a, b);
});

test("A starts, B pauses, and both end with exactly one widget whose meta and face match", async () => {
    const { a, b, settle, advance } = await pair();
    await press(a, settle, onlyWidget(a), "start");
    sameSingleWidget(a, b);
    assert.equal(onlyTimer(b).state, "running");

    await advance(30_100);
    await press(b, settle, onlyWidget(b), "pause");
    await advance(10_000);
    sameSingleWidget(a, b);
    for (const host of [a, b]) {
        assert.equal(onlyTimer(host).state, "paused");
        assert.equal(onlyTimer(host).remainingMs, 269_900);
        assert.equal(lastState(host)?.timer?.state, "paused");
    }
    assert.deepEqual(writes(b), ["add", "remove"]);
});

test("the other screen's panel stays on its timer while someone else's presses replace the widget", async () => {
    const { a, b, settle } = await pair();
    const first = onlyWidget(a);
    b.select([first.id]);
    await settle();
    b.select([]);
    await settle();
    assert.equal(lastState(b)?.timer?.id, first.id);

    await press(a, settle, first, "start");
    a.message({ type: "add" });
    await settle();
    assert.equal(widgets(b).length, 2);
    const replaced = widgets(b).find(
        (w) => timerOf(w)?.id === timerOf(first)?.id
    )!;
    assert.equal(lastState(b)?.timer?.id, replaced.id);
    assert.equal(lastState(b)?.timer?.state, "running");
});

test("presses that cross on the wire leave two stacked widgets until the next press, which leaves one", async () => {
    const { board, a, b, settle, advance } = await pair();
    await press(a, settle, onlyWidget(a), "start");
    await advance(10_000);

    board.hold();
    await press(a, settle, onlyWidget(a), "pause");
    await press(b, settle, onlyWidget(b), "add-minute");
    board.release();
    await settle();
    assert.equal(widgets(a).length, 2);
    assert.equal(widgets(b).length, 2);

    await press(a, settle, widgets(a)[0], "reset");
    sameSingleWidget(a, b);
    assert.equal(onlyTimer(a).state, "ready");
});

test("at the end each screen chimes once and nobody writes, even with B's clock 1.5 s behind", async () => {
    const { a, b, settle, advance } = await pair(-1500);
    await act(
        a,
        settle,
        onlyWidget(a).id,
        { type: "set-duration", minutes: 1 },
        { type: "start" }
    );
    a.pan(OFF_SCREEN);
    b.pan(OFF_SCREEN);
    await settle();
    a.clear();
    b.clear();

    await advance(MINUTE_MS + 20);
    assert.equal(hudKind(a), "done");
    await advance(1_500);
    assert.equal(hudKind(b), "done");

    await advance(30_000);
    assert.equal(chimes(a).length, 1);
    assert.equal(chimes(b).length, 1);
    assert.deepEqual(writes(a), []);
    assert.deepEqual(writes(b), []);
});

test("whoever presses +1 min on a finished timer runs it again for everyone", async () => {
    const { a, b, settle, advance } = await pair();
    await act(
        a,
        settle,
        onlyWidget(a).id,
        { type: "set-duration", minutes: 1 },
        { type: "start" }
    );
    await advance(MINUTE_MS + 20);
    await press(b, settle, onlyWidget(b), "add-minute");
    sameSingleWidget(a, b);
    assert.equal(onlyTimer(a).state, "running");

    await advance(MINUTE_MS + 20);
    assert.equal(chimes(a).length, 2);
    assert.equal(chimes(b).length, 2);
});

test("an undo on one screen reaches the other", async () => {
    const { a, b, settle } = await pair();
    const ready = structuredClone(onlyWidget(a));
    await press(a, settle, ready, "start");
    const running = structuredClone(onlyWidget(a));
    b.pan(OFF_SCREEN);
    await settle();
    assert.equal(hudTime(b), "5:00");

    a.restore(ready);
    a.board.write(a.board.clients[0], running.id, null);
    await settle();
    assert.equal(onlyTimer(b).state, "ready");
    assert.equal(b.floating.has(HUD_ID), false);
});

test("deleting the widget on one screen clears the pill on the other", async () => {
    const { a, b, settle } = await pair();
    await press(a, settle, onlyWidget(a), "start");
    a.pan(OFF_SCREEN);
    await settle();
    assert.ok(a.floating.has(HUD_ID));
    b.message({ type: "delete", id: onlyWidget(b).id });
    await settle();
    assert.equal(a.live().length, 0);
    assert.equal(a.floating.has(HUD_ID), false);
});
