import assert from "node:assert/strict";
import { test } from "node:test";
import { ANCHOR_SIZE, GLYPH, MENU } from "../src/driver";
import { HUD_TOP, HUD_WIDTH } from "../src/lib/hud";
import {
    frameNameFor,
    MINUTE_MS,
    newTimer,
    reduce,
    toMeta,
} from "../src/lib/timer-state";
import { START, type Stored } from "./fake-host";
import {
    act,
    addTimer,
    anchors,
    chimes,
    DRIVER_ID,
    GB,
    HUD_ID,
    hudText,
    hudUpserts,
    lastState,
    onlyTimer,
    sentOf,
    solo,
    timerOf,
    updates,
} from "./helpers";

const menuId = (key: keyof typeof MENU) => `${DRIVER_ID}:${MENU[key]}`;

function seededAnchor(id: string, timer = newTimer(id)): Stored {
    return {
        id,
        type: "frame",
        x: 0,
        y: 0,
        width: ANCHOR_SIZE.width,
        height: ANCHOR_SIZE.height,
        frameName: frameNameFor(timer, START, GB),
        meta: { [DRIVER_ID]: toMeta({ ...timer, id }) },
    };
}

test("activation adds the rail button and a Timer menu with start or pause, +1 minute and reset", async () => {
    const { host } = await solo();
    assert.equal(sentOf(host, "command:dom:create-action-button").length, 1);
    assert.deepEqual(host.menus, [
        {
            menuId: menuId("root"),
            menuTitle: "Timer",
            children: [
                { menuId: menuId("toggle"), menuTitle: "Start / Pause" },
                { menuId: menuId("addMinute"), menuTitle: "+1 minute" },
                { menuId: menuId("reset"), menuTitle: "Reset" },
            ],
        },
    ]);
    const clicks = sentOf(host, "subscription:context-menu:clicked").map(
        (s) => s.req.menuId
    );
    assert.deepEqual(
        clicks.sort(),
        [menuId("addMinute"), menuId("reset"), menuId("toggle")].sort()
    );
    assert.equal(host.floating.size, 0);
});

test("the rail button on an empty board opens a kept-alive panel and adds one timer card, selected, in a single add", async () => {
    const { host, settle } = await solo();
    host.clickButton();
    await settle();

    const [created] = sentOf(host, "command:webview:create");
    assert.equal(created.req.keepStateWhenClosed, true);
    const adds = sentOf(host, "command:scene:add-drawdy-elements");
    assert.equal(adds.length, 1);
    const [frame, glyph] = adds[0].req.elements;
    assert.equal(frame.type, "frame");
    assert.deepEqual([frame.width, frame.height], [240, 140]);
    assert.equal(frame.name, "⏱ 5:00");
    assert.equal(glyph.type, "text");
    assert.equal(glyph.text, GLYPH);
    assert.equal(glyph.frameId, frame.drawdyElementId);

    const timer = onlyTimer(host);
    assert.equal(timer.state, "ready");
    assert.equal(timer.durationMs, 5 * MINUTE_MS);
    assert.deepEqual(
        sentOf(host, "command:scene:set-selection").at(-1)?.req
            .drawdyElementIds,
        [timer.id]
    );
    assert.equal(lastState(host)?.timer?.id, timer.id);
});

test("the rail button leaves the board alone when a timer is already there", async () => {
    const { host, settle } = await solo({ seed: [seededAnchor("t1")] });
    host.clickButton();
    await settle();
    assert.equal(sentOf(host, "command:scene:add-drawdy-elements").length, 0);
    assert.equal(lastState(host)?.timer?.id, "t1");
});

test("start is one update carrying the state and the frame name, and the pill appears at the top centre as a click-through overlay", async () => {
    const { host, settle } = await solo();
    const { id } = await addTimer(host, settle);
    host.clear();

    await act(host, settle, id, { type: "start" });

    assert.equal(updates(host).length, 1);
    const [{ properties }] = updates(host)[0].req.updates;
    assert.equal(properties.meta[DRIVER_ID].state, "running");
    assert.equal(properties.frameName, "⏱ Running · ends 14:05");
    assert.equal(host.element(id)?.frameName, "⏱ Running · ends 14:05");
    const hud = host.floating.get(HUD_ID);
    assert.equal(hud?.asPopover, false);
    assert.deepEqual(hud?.position, { x: (1280 - HUD_WIDTH) / 2, y: HUD_TOP });
    assert.equal(hudText(host), "5:00");
});

test("the pill changes only when the shown second does", async () => {
    const { host, settle, advance } = await solo();
    const { id } = await addTimer(host, settle);
    await act(host, settle, id, { type: "start" });
    const before = hudUpserts(host);

    await advance(400);
    assert.equal(hudUpserts(host), before);
    await advance(700);
    assert.equal(hudUpserts(host), before + 1);
    assert.equal(hudText(host), "4:59");
    await advance(10_000);
    assert.equal(hudUpserts(host), before + 11);
    assert.equal(hudText(host), "4:49");
});

test("pause, resume, +1 min and reset are one update each, and reset takes the pill away", async () => {
    const { host, settle, advance } = await solo();
    const { id } = await addTimer(host, settle);
    await act(host, settle, id, { type: "start" });
    await advance(48_000);
    host.clear();

    await act(host, settle, id, { type: "pause" });
    assert.equal(onlyTimer(host).state, "paused");
    assert.equal(host.element(id)?.frameName, "⏸ Paused · 4:12 left");
    assert.equal(hudText(host), "4:12");

    await act(host, settle, id, { type: "add-minute" });
    assert.equal(onlyTimer(host).remainingMs, 312_000);

    await act(host, settle, id, { type: "start" });
    assert.equal(onlyTimer(host).state, "running");

    await act(host, settle, id, { type: "reset" });
    assert.equal(onlyTimer(host).state, "ready");
    assert.equal(updates(host).length, 4);
    assert.equal(host.floating.has(HUD_ID), false);
});

test("a typed label goes with Start in the same single update", async () => {
    const { host, settle } = await solo();
    const { id } = await addTimer(host, settle);
    host.clear();
    await act(
        host,
        settle,
        id,
        { type: "set-label", label: "Critique" },
        { type: "start" }
    );
    assert.equal(updates(host).length, 1);
    assert.equal(
        host.element(id)?.frameName,
        "⏱ Running · ends 14:05 · Critique"
    );
});

test("actions that change nothing write nothing", async () => {
    const { host, settle } = await solo();
    const { id } = await addTimer(host, settle);
    host.clear();
    await act(host, settle, id, { type: "reset" });
    await act(host, settle, id, { type: "pause" });
    await act(host, settle, id, { type: "set-duration", minutes: 5 });
    await act(host, settle, id, { type: "bogus" });
    assert.equal(updates(host).length, 0);
});

test("at the end the starting device writes time's up once, chimes once, and the pill reads time's up for 5 seconds", async () => {
    const { host, settle, advance } = await solo();
    const { id } = await addTimer(host, settle);
    await act(
        host,
        settle,
        id,
        { type: "set-duration", minutes: 1 },
        { type: "start" }
    );
    host.clear();

    await advance(MINUTE_MS + 20);
    const done = updates(host);
    assert.equal(done.length, 1);
    assert.equal(
        done[0].req.updates[0].properties.meta[DRIVER_ID].state,
        "done"
    );
    assert.equal(host.element(id)?.frameName, "✓ Time's up");
    assert.equal(chimes(host).length, 1);
    assert.deepEqual(chimes(host)[0], { type: "chime", sound: "soft" });
    assert.equal(hudText(host), "Time's up");

    await advance(4_000);
    assert.equal(hudText(host), "Time's up");
    await advance(1_100);
    assert.equal(host.floating.has(HUD_ID), false);
    await advance(60_000);
    assert.equal(updates(host).length, 1);
    assert.equal(chimes(host).length, 1);
});

test("the last ten seconds still tick once a second", async () => {
    const { host, settle, advance } = await solo();
    const { id } = await addTimer(host, settle);
    await act(
        host,
        settle,
        id,
        { type: "set-duration", minutes: 1 },
        { type: "start" }
    );
    await advance(49_500);
    const before = hudUpserts(host);
    await advance(5_000);
    assert.equal(hudUpserts(host) - before, 5);
    assert.equal(hudText(host), "0:06");
});

test("with sound off there is no chime, and the choice is kept on this device", async () => {
    const { host, settle, advance } = await solo();
    host.message({ type: "sound", value: "off" });
    await settle();
    assert.deepEqual(host.kv.get("prefs"), { sound: "off" });
    assert.equal(lastState(host)?.sound, "off");

    const { id } = await addTimer(host, settle);
    await act(
        host,
        settle,
        id,
        { type: "set-duration", minutes: 1 },
        { type: "start" }
    );
    await advance(MINUTE_MS + 50);
    assert.equal(chimes(host).length, 0);

    const again = await solo({ kv: host.kv });
    again.host.message({ type: "ready" });
    await again.settle();
    assert.equal(lastState(again.host)?.sound, "off");
});

test("the device id is made once and kept", async () => {
    const first = await solo();
    const id = first.host.kv.get("device")?.id;
    assert.equal(typeof id, "string");
    const second = await solo({ kv: first.host.kv });
    assert.equal(second.host.kv.get("device")?.id, id);
});

test("undo after Start puts the card back to ready and the pill goes", async () => {
    const { host, settle } = await solo();
    const { id } = await addTimer(host, settle);
    const before = structuredClone(host.element(id)!);
    await act(host, settle, id, { type: "start" });
    assert.ok(host.floating.has(HUD_ID));

    host.restore(before);
    await settle();
    assert.equal(onlyTimer(host).state, "ready");
    assert.equal(host.element(id)?.frameName, "⏱ 5:00");
    assert.equal(host.floating.has(HUD_ID), false);
    assert.equal(lastState(host)?.timer?.state, "ready");
});

test("undoing time's up doesn't make the starting device write it again", async () => {
    const { host, settle, advance } = await solo();
    const { id } = await addTimer(host, settle);
    await act(
        host,
        settle,
        id,
        { type: "set-duration", minutes: 1 },
        { type: "start" }
    );
    const running = structuredClone(host.element(id)!);
    await advance(MINUTE_MS + 20);
    assert.equal(
        updates(host).at(-1)?.req.updates[0].properties.meta[DRIVER_ID].state,
        "done"
    );
    const writes = updates(host).length;

    host.restore(running);
    await settle();
    await advance(10_000);
    assert.equal(updates(host).length, writes);
    assert.equal(chimes(host).length, 1);
});

test("delete removes the card and its glyph in one command and the pill goes", async () => {
    const { host, settle } = await solo();
    const { id } = await addTimer(host, settle);
    await act(host, settle, id, { type: "start" });

    host.message({ type: "delete", id });
    await settle();
    const removes = sentOf(host, "command:scene:remove-drawdy-elements");
    assert.equal(removes.length, 1);
    assert.equal(removes[0].req.drawdyElementIds.length, 2);
    assert.equal(host.live().length, 0);
    assert.equal(host.floating.has(HUD_ID), false);
    assert.equal(lastState(host)?.timer, null);
});

test("deleting the card on the board clears the pill too", async () => {
    const { host, settle } = await solo();
    const { id } = await addTimer(host, settle);
    await act(host, settle, id, { type: "start" });
    host.board.write(host.board.clients[0], id, null);
    await settle();
    assert.equal(host.floating.has(HUD_ID), false);
});

test("the context menu acts on the selected timer, also when its glyph is what is selected", async () => {
    const { host, settle } = await solo({
        seed: [seededAnchor("a"), seededAnchor("b")],
    });
    const glyph: Stored = {
        id: "g",
        type: "text",
        x: 0,
        y: 0,
        width: 240,
        height: 80,
        frameId: "a",
        meta: { [DRIVER_ID]: { v: 1, glyphOf: "a" } },
    };
    host.board.write(host.board.clients[0], "g", glyph);
    host.select(["g"]);
    await settle();

    host.menu(menuId("toggle"));
    await settle();
    assert.equal(timerOf(host.element("a"))?.state, "running");
    assert.equal(timerOf(host.element("b"))?.state, "ready");

    host.menu(menuId("addMinute"));
    await settle();
    host.menu(menuId("toggle"));
    await settle();
    assert.equal(timerOf(host.element("a"))?.state, "paused");
    assert.equal(timerOf(host.element("a"))?.remainingMs, 6 * MINUTE_MS);

    host.menu(menuId("reset"));
    await settle();
    assert.equal(timerOf(host.element("a"))?.state, "ready");
});

test("the panel follows the selected timer and stays on it after the selection clears", async () => {
    const { host, settle } = await solo({
        seed: [seededAnchor("a"), seededAnchor("b")],
    });
    host.message({ type: "ready" });
    await settle();
    assert.equal(lastState(host)?.timer?.id, "b");
    assert.equal(lastState(host)?.count, 2);
    host.select(["a"]);
    await settle();
    assert.equal(lastState(host)?.timer?.id, "a");
    host.select([]);
    await settle();
    assert.equal(lastState(host)?.timer?.id, "a");
});

test("a board opened after its timer ran out stays quiet and writes nothing", async () => {
    const expired = reduce(
        newTimer("t1", 1),
        { type: "start", by: "someone" },
        START - 10 * MINUTE_MS
    );
    const { host, advance } = await solo({
        seed: [seededAnchor("t1", expired)],
    });
    await advance(10_000);
    assert.equal(updates(host).length, 0);
    assert.equal(chimes(host).length, 0);
    assert.equal(host.floating.has(HUD_ID), false);
});

test("a board opened mid-run shows the pill and chimes at the end", async () => {
    const running = reduce(
        newTimer("t1", 1),
        { type: "start", by: "someone" },
        START - 30_000
    );
    const { host, advance } = await solo({
        seed: [seededAnchor("t1", running)],
    });
    assert.equal(hudText(host), "0:30");
    await advance(30_100);
    assert.equal(chimes(host).length, 1);
    assert.equal(
        updates(host).length,
        0,
        "only the device that started it writes time's up"
    );
});

test("a theme change reaches the panel and redraws the pill, and a resize recentres it", async () => {
    const { host, settle } = await solo();
    const { id } = await addTimer(host, settle);
    await act(host, settle, id, { type: "start" });
    const upserts = hudUpserts(host);

    host.theme({ theme: "light", tokens: { "--dd-surface-panel": "#fff" } });
    await settle();
    assert.deepEqual(
        host.posted.find((m) => m.type === "theme"),
        {
            type: "theme",
            cssVars: "color-scheme: light;--dd-surface-panel: #fff;",
        }
    );
    assert.equal(hudUpserts(host), upserts + 1);

    host.resize(1600, 900);
    await settle();
    assert.deepEqual(host.floating.get(HUD_ID)?.position, {
        x: (1600 - HUD_WIDTH) / 2,
        y: HUD_TOP,
    });
});

test("a refused board write tells the panel and keeps the card as the board has it", async () => {
    const { host, settle } = await solo({
        seed: [seededAnchor("t1")],
        denied: ["command:scene:update"],
    });
    host.message({ type: "act", id: "t1", actions: [{ type: "start" }] });
    await settle();
    assert.equal(onlyTimer(host).state, "ready");
    assert.equal(host.floating.has(HUD_ID), false);
    assert.equal(lastState(host)?.timer?.state, "ready");
    assert.deepEqual(
        host.posted.find((m) => m.type === "error"),
        { type: "error", reason: "denied" }
    );
});

test("without the board permission the panel shows why", async () => {
    const { host, settle } = await solo({ denied: ["command:scene:add"] });
    host.clickButton();
    await settle();
    assert.deepEqual(
        host.posted.find((m) => m.type === "error"),
        { type: "error", reason: "denied" }
    );
    assert.equal(lastState(host)?.timer, null);
});
