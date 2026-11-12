import assert from "node:assert/strict";
import { test } from "node:test";
import {
    clampMinutes,
    cleanLabel,
    effective,
    formatRemaining,
    MINUTE_MS,
    newTimer,
    readTimer,
    reduce,
    toMeta,
    type Timer,
} from "../src/lib/timer-state";

const NOW = Date.UTC(2026, 10, 12, 14, 0, 0);

const started = (minutes = 5): Timer =>
    reduce(newTimer("t1", minutes), { type: "start" }, NOW);

test("a new timer is ready at its full length, and lengths are whole minutes from 1 to 99", () => {
    const timer = newTimer("t1", 3, "  Silent   brainstorm ");
    assert.equal(timer.state, "ready");
    assert.equal(timer.durationMs, 3 * MINUTE_MS);
    assert.equal(timer.remainingMs, 3 * MINUTE_MS);
    assert.equal(timer.label, "Silent brainstorm");
    assert.equal("endsAt" in timer, false);
    assert.deepEqual(
        [0, 1, 7.4, 99, 250, NaN].map(clampMinutes),
        [1, 1, 7, 99, 99, 5]
    );
    assert.equal(cleanLabel("x".repeat(60)).length, 40);
});

test("start runs from the full length, and starting a running timer changes nothing", () => {
    const timer = started();
    assert.equal(timer.state, "running");
    assert.equal(timer.endsAt, NOW + 5 * MINUTE_MS);
    assert.equal(reduce(timer, { type: "start" }, NOW + 1000), timer);
});

test("pause keeps what was left, and resume runs on from there", () => {
    const paused = reduce(started(), { type: "pause" }, NOW + 108_000);
    assert.equal(paused.state, "paused");
    assert.equal(paused.remainingMs, 192_000);
    assert.equal("endsAt" in paused, false);

    const resumed = reduce(paused, { type: "start" }, NOW + 500_000);
    assert.equal(resumed.state, "running");
    assert.equal(resumed.endsAt, NOW + 500_000 + 192_000);
});

test("toggle pauses a running timer and starts any other", () => {
    const toggled = reduce(started(), { type: "toggle" }, NOW + 1000);
    assert.equal(toggled.state, "paused");
    assert.equal(
        reduce(toggled, { type: "toggle" }, NOW + 2000).state,
        "running"
    );
    assert.equal(
        reduce(newTimer("t1"), { type: "toggle" }, NOW).state,
        "running"
    );
});

test("+1 min pushes the end while running and adds to what is left while paused", () => {
    const running = reduce(started(), { type: "add-minute" }, NOW + 1000);
    assert.equal(running.endsAt, NOW + 6 * MINUTE_MS);

    const paused = reduce(started(), { type: "pause" }, NOW + 60_000);
    const added = reduce(paused, { type: "add-minute" }, NOW + 90_000);
    assert.equal(added.state, "paused");
    assert.equal(added.remainingMs, 5 * MINUTE_MS);
});

test("+1 min lengthens a ready timer up to 99 minutes and gives a finished one another minute", () => {
    const ready = reduce(newTimer("t1", 5), { type: "add-minute" }, NOW);
    assert.equal(ready.durationMs, 6 * MINUTE_MS);
    assert.equal(ready.remainingMs, 6 * MINUTE_MS);
    const full = reduce(newTimer("t1", 99), { type: "add-minute" }, NOW);
    assert.equal(full.durationMs, 99 * MINUTE_MS);

    const done = reduce(started(1), { type: "expire" }, NOW + MINUTE_MS);
    const again = reduce(done, { type: "add-minute" }, NOW + 70_000);
    assert.equal(again.state, "running");
    assert.equal(again.endsAt, NOW + 70_000 + MINUTE_MS);
    assert.equal(again.durationMs, MINUTE_MS);
});

test("reset returns to ready at the set length from any state", () => {
    const longer = reduce(started(), { type: "add-minute" }, NOW);
    for (const timer of [
        longer,
        reduce(longer, { type: "pause" }, NOW + 1000),
        reduce(longer, { type: "expire" }, NOW + 10 * MINUTE_MS),
    ]) {
        const reset = reduce(timer, { type: "reset" }, NOW + 20 * MINUTE_MS);
        assert.equal(reset.state, "ready");
        assert.equal(reset.remainingMs, 5 * MINUTE_MS);
        assert.equal("endsAt" in reset, false);
    }
});

test("a running timer reads as done once its end passes, and expire writes that down", () => {
    const timer = started(1);
    assert.equal(effective(timer, NOW + MINUTE_MS - 1).state, "running");
    assert.equal(effective(timer, NOW + MINUTE_MS).state, "done");
    assert.equal(reduce(timer, { type: "expire" }, NOW + 1000), timer);

    const done = reduce(timer, { type: "expire" }, NOW + MINUTE_MS + 300);
    assert.equal(done.state, "done");
    assert.equal(done.remainingMs, 0);
    assert.equal(done.endsAt, timer.endsAt);
    assert.equal(
        reduce(timer, { type: "pause" }, NOW + 2 * MINUTE_MS).state,
        "done"
    );
});

test("the length only changes while a timer is ready or done", () => {
    assert.equal(
        reduce(started(), { type: "set-duration", minutes: 10 }, NOW)
            .durationMs,
        5 * MINUTE_MS
    );
    const ready = reduce(
        newTimer("t1"),
        { type: "set-duration", minutes: 25 },
        NOW
    );
    assert.equal(ready.durationMs, 25 * MINUTE_MS);
    const done = reduce(started(1), { type: "expire" }, NOW + MINUTE_MS);
    const next = reduce(
        done,
        { type: "set-duration", minutes: 3 },
        NOW + MINUTE_MS
    );
    assert.equal(next.state, "ready");
    assert.equal(next.remainingMs, 3 * MINUTE_MS);
});

test("the label can change in any state without touching the countdown", () => {
    const timer = started();
    const labelled = reduce(
        timer,
        { type: "set-label", label: " Critique " },
        NOW + 5000
    );
    assert.equal(labelled.label, "Critique");
    assert.equal(labelled.endsAt, timer.endsAt);
});

test("remaining time rounds up to whole seconds", () => {
    assert.deepEqual(
        [
            300_000,
            299_001,
            299_000,
            61_000,
            1,
            0,
            -5,
            99 * MINUTE_MS,
            100 * MINUTE_MS,
        ].map(formatRemaining),
        [
            "5:00",
            "5:00",
            "4:59",
            "1:01",
            "0:01",
            "0:00",
            "0:00",
            "99:00",
            "1:40:00",
        ]
    );
});

test("stored meta reads back under its own timer id, and bad meta is ignored", () => {
    const timer = started();
    assert.deepEqual(readTimer(toMeta(timer), "another-element"), timer);
    assert.deepEqual(readTimer({ ...toMeta(timer), id: "" }, "el-2"), {
        ...timer,
        id: "el-2",
    });
    assert.deepEqual(
        readTimer({ ...toMeta(timer), startedBy: "a 1.0.0 device" }, "t1"),
        timer
    );
    assert.deepEqual(Object.keys(toMeta(timer)).sort(), [
        "durationMs",
        "endsAt",
        "id",
        "label",
        "remainingMs",
        "state",
        "v",
    ]);
    assert.equal(
        readTimer({ ...toMeta(timer), endsAt: undefined }, "t1"),
        null
    );
    assert.equal(readTimer({ ...toMeta(timer), state: "stopped" }, "t1"), null);
    assert.equal(readTimer({ ...toMeta(timer), v: 2 }, "t1"), null);
    assert.equal(readTimer({ ...toMeta(timer), durationMs: 0 }, "t1"), null);
    assert.equal(readTimer("timer", "t1"), null);
});
