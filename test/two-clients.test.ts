import assert from "node:assert/strict";
import { test } from "node:test";
import { MINUTE_MS } from "../src/lib/timer-state";
import {
    act,
    chimes,
    client,
    DRIVER_ID,
    fakeBoard,
    fakeClock,
    HUD_ID,
    hudText,
    lastState,
    onlyTimer,
    updates,
} from "./helpers";

async function pair(skewMs = 0) {
    const clock = fakeClock();
    const board = fakeBoard();
    const a = await client(clock, { board });
    const b = await client(clock, { board, skewMs });
    const settle = () => board.settle();
    const advance = (ms: number) => clock.advance(ms, settle);
    a.clickButton();
    await settle();
    const { id } = onlyTimer(a);
    return { clock, board, a, b, id, settle, advance };
}

const doneWrites = (host: Parameters<typeof updates>[0]) =>
    updates(host).filter(
        (u) => u.req.updates[0].properties.meta[DRIVER_ID].state === "done"
    ).length;

test("a timer one person adds shows up for the other", async () => {
    const { b, id } = await pair();
    assert.equal(onlyTimer(b).id, id);
    b.message({ type: "ready" });
    assert.equal(b.floating.has(HUD_ID), false);
});

test("A starts, B pauses, and both show the same paused time", async () => {
    const { a, b, id, settle, advance } = await pair();
    await act(a, settle, id, { type: "start" });
    assert.equal(hudText(a), "5:00");
    assert.equal(hudText(b), "5:00");

    await advance(30_100);
    assert.equal(hudText(a), "4:30");
    assert.equal(hudText(b), "4:30");

    await act(b, settle, id, { type: "pause" });
    await advance(10_000);
    for (const host of [a, b]) {
        assert.equal(onlyTimer(host).state, "paused");
        assert.equal(hudText(host), "4:30");
        assert.equal(host.element(id)?.frameName, "⏸ Paused · 4:30 left");
        assert.equal(lastState(host)?.timer?.state, "paused");
    }
    assert.deepEqual(onlyTimer(a), onlyTimer(b));
});

test("writes that cross on the wire end as the later whole write on both screens", async () => {
    const { board, a, b, id, settle, advance } = await pair();
    await act(a, settle, id, { type: "start" });
    await advance(10_000);

    board.hold();
    await act(a, settle, id, { type: "pause" });
    await act(b, settle, id, { type: "add-minute" });
    assert.equal(onlyTimer(a).state, "paused");
    assert.equal(onlyTimer(b).state, "running");

    board.release();
    await settle();
    assert.deepEqual(onlyTimer(a), onlyTimer(b));
    assert.equal(onlyTimer(a).state, "running");
    assert.equal(hudText(a), "5:50");
    assert.equal(hudText(b), "5:50");
    assert.equal(a.element(id)?.frameName, b.element(id)?.frameName);
});

test("only the device that started the run writes time's up, and each screen chimes once even with its clock 1.5 s behind", async () => {
    const { a, b, id, settle, advance } = await pair(-1500);
    await act(
        a,
        settle,
        id,
        { type: "set-duration", minutes: 1 },
        { type: "start" }
    );

    await advance(MINUTE_MS + 20);
    assert.equal(doneWrites(a), 1);
    assert.equal(doneWrites(b), 0);
    assert.equal(onlyTimer(b).state, "done");
    assert.equal(hudText(a), "Time's up");
    assert.equal(hudText(b), "Time's up");

    await advance(30_000);
    assert.equal(chimes(a).length, 1);
    assert.equal(chimes(b).length, 1);
    assert.equal(doneWrites(a), 1);
    assert.equal(updates(b).length, 0);
});

test("whoever restarts a finished timer becomes the one who writes its end", async () => {
    const { a, b, id, settle, advance } = await pair();
    await act(
        a,
        settle,
        id,
        { type: "set-duration", minutes: 1 },
        { type: "start" }
    );
    await advance(MINUTE_MS + 20);
    await act(b, settle, id, { type: "add-minute" });

    await advance(MINUTE_MS + 20);
    assert.equal(doneWrites(a), 1);
    assert.equal(doneWrites(b), 1);
    assert.equal(chimes(a).length, 2);
    assert.equal(chimes(b).length, 2);
});

test("an undo on one screen reaches the other", async () => {
    const { a, b, id, settle } = await pair();
    const ready = structuredClone(a.element(id)!);
    await act(a, settle, id, { type: "start" });
    assert.ok(b.floating.has(HUD_ID));

    a.restore(ready);
    await settle();
    assert.equal(onlyTimer(b).state, "ready");
    assert.equal(b.floating.has(HUD_ID), false);
});

test("deleting the card on one screen clears the pill on the other", async () => {
    const { a, b, id, settle } = await pair();
    await act(a, settle, id, { type: "start" });
    b.message({ type: "delete", id });
    await settle();
    assert.equal(a.live().length, 0);
    assert.equal(a.floating.has(HUD_ID), false);
    assert.equal(b.floating.has(HUD_ID), false);
});
