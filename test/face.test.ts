import assert from "node:assert/strict";
import { test } from "node:test";
import { faceAt, FLASH_MS } from "../src/lib/face";
import { MINUTE_MS, newTimer, reduce } from "../src/lib/timer-state";

const NOW = Date.UTC(2026, 10, 12, 14, 0, 0);
const running = (minutes: number, at = NOW) =>
    reduce(newTimer("t", minutes), { type: "start" }, at);

test("a ready timer shows its whole length on a full ring", () => {
    const face = faceAt(newTimer("t", 5), NOW);
    assert.equal(face.state, "ready");
    assert.equal(face.remainingMs, 5 * MINUTE_MS);
    assert.equal(face.text, "5:00");
    assert.equal(face.progress, 1);
    assert.equal(face.urgent, false);
    assert.equal(face.flash, false);
});

test("a running timer counts down from its end on the viewer's clock and the ring drains with it", () => {
    const timer = running(4);
    const face = faceAt(timer, NOW + 60_000);
    assert.equal(face.state, "running");
    assert.equal(face.remainingMs, 3 * MINUTE_MS);
    assert.equal(face.text, "3:00");
    assert.equal(face.progress, 0.75);
    assert.equal(faceAt(timer, NOW + 60_001).text, "3:00");
    assert.equal(faceAt(timer, NOW + 61_000).text, "2:59");
});

test("a paused timer holds what was left", () => {
    const paused = reduce(running(5), { type: "pause" }, NOW + 2.5 * MINUTE_MS);
    for (const later of [0, 60_000, 3_600_000]) {
        const face = faceAt(paused, NOW + 2.5 * MINUTE_MS + later);
        assert.equal(face.state, "paused");
        assert.equal(face.text, "2:30");
        assert.equal(face.progress, 0.5);
    }
});

test("only the last ten seconds of a run are urgent", () => {
    const timer = running(1);
    const urgentAt = (left: number) =>
        faceAt(timer, NOW + MINUTE_MS - left).urgent;
    assert.equal(urgentAt(10_001), false);
    assert.equal(urgentAt(10_000), true);
    assert.equal(urgentAt(1), true);
    assert.equal(
        faceAt(reduce(timer, { type: "pause" }, NOW + 55_000), NOW + 56_000)
            .urgent,
        false
    );
});

test("at its end a run reads as done with an empty ring, flashes for five seconds, then holds", () => {
    const timer = running(1);
    const end = NOW + MINUTE_MS;
    const at = faceAt(timer, end);
    assert.equal(at.state, "done");
    assert.equal(at.remainingMs, 0);
    assert.equal(at.progress, 0);
    assert.equal(at.urgent, false);
    assert.equal(at.flash, true);
    assert.equal(faceAt(timer, end + FLASH_MS - 1).flash, true);
    assert.equal(faceAt(timer, end + FLASH_MS).flash, false);
    assert.equal(faceAt(timer, end + 3_600_000).state, "done");
});

test("a done state written at zero carries on the pulse that began at zero instead of starting one of its own", () => {
    const end = NOW + MINUTE_MS;
    const done = reduce(running(1), { type: "expire" }, end + 20);
    assert.equal(done.state, "done");
    assert.equal(faceAt(done, end + 2_000).flash, true);
    assert.equal(faceAt(done, end + FLASH_MS).flash, false);
    assert.equal(faceAt(done, end + 60_000).flash, false);
});

test("a timer stored as done after its moment passed shows time's up without a flash", () => {
    const done = reduce(running(1), { type: "pause" }, NOW + 2 * MINUTE_MS);
    assert.equal(done.state, "done");
    const face = faceAt(done, NOW + 2 * MINUTE_MS);
    assert.equal(face.state, "done");
    assert.equal(face.flash, false);
});

test("time added to a run keeps the ring full until the run is back within its length", () => {
    const longer = reduce(running(5), { type: "add-minute" }, NOW);
    assert.equal(faceAt(longer, NOW).progress, 1);
    assert.equal(faceAt(longer, NOW).text, "6:00");
    assert.equal(faceAt(longer, NOW + 3.5 * MINUTE_MS).progress, 0.5);
});
