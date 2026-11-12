import assert from "node:assert/strict";
import { test } from "node:test";
import { chimeLength, chimeTones } from "../webview/lib/chime";
import { panelModel, primaryAction } from "../src/lib/panel-model";
import { MINUTE_MS, newTimer, reduce } from "../src/lib/timer-state";

const NOW = Date.UTC(2026, 10, 12, 14, 0, 0);

test("with no timer the panel offers to add one", () => {
    const model = panelModel(null, NOW);
    assert.equal(model.view, "empty");
    assert.equal(model.primary, "add");
});

test("a ready timer offers Start, its preset, and nothing to reset", () => {
    const model = panelModel(newTimer("t", 15), NOW);
    assert.equal(model.state, "ready");
    assert.equal(model.primary, "start");
    assert.equal(model.preset, 15);
    assert.equal(model.canReset, false);
    assert.equal(model.lengthLocked, false);
    assert.equal(panelModel(newTimer("t", 7), NOW).preset, null);
});

test("while running the panel offers Pause, locks the length and turns urgent at ten seconds", () => {
    const timer = reduce(newTimer("t", 1), { type: "start" }, NOW);
    const model = panelModel(timer, NOW + 30_000);
    assert.equal(model.primary, "pause");
    assert.equal(model.lengthLocked, true);
    assert.equal(model.canReset, true);
    assert.equal(model.display, "0:30");
    assert.equal(model.urgent, false);
    assert.equal(panelModel(timer, NOW + 50_000).urgent, true);
});

test("paused offers Resume and a finished timer offers to start again", () => {
    const timer = reduce(newTimer("t", 1), { type: "start" }, NOW);
    assert.equal(
        panelModel(reduce(timer, { type: "pause" }, NOW + 5000), NOW + 9000)
            .primary,
        "resume"
    );
    const done = panelModel(timer, NOW + MINUTE_MS + 1);
    assert.equal(done.state, "done");
    assert.equal(done.primary, "start-again");
    assert.equal(done.lengthLocked, false);
});

test("the start or pause control reads the state the same way on the panel and the board", () => {
    assert.deepEqual(
        (["ready", "running", "paused", "done"] as const).map(primaryAction),
        ["start", "pause", "resume", "start-again"]
    );
});

test("both chimes are short and audible, and the bell rings louder than the soft one", () => {
    for (const kind of ["soft", "bell"] as const) {
        const tones = chimeTones(kind);
        assert.ok(tones.length > 0);
        assert.ok(
            tones.every((t) => t.freq >= 200 && t.freq <= 4000 && t.gain > 0)
        );
        assert.ok(chimeLength(kind) <= 4);
    }
    const peak = (kind: "soft" | "bell") =>
        chimeTones(kind)
            .filter((t) => t.at === 0)
            .reduce((sum, t) => sum + t.gain, 0);
    assert.ok(peak("bell") > peak("soft"));
});
