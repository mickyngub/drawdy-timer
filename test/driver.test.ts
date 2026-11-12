import assert from "node:assert/strict";
import { test } from "node:test";
import { MENU } from "../src/driver";
import { HUD_TOP, HUD_WIDTH } from "../src/lib/hud";
import { MINUTE_MS, newTimer, reduce, toMeta } from "../src/lib/timer-state";
import { WIDGET_SIZE } from "../src/lib/widget";
import {
    act,
    adds,
    addTimer,
    bakedOf,
    buttonIdsOf,
    chimes,
    DRIVER_ID,
    HUD_ID,
    hudKind,
    hudTime,
    hudUpserts,
    lastState,
    legacyFrame,
    OFF_SCREEN,
    onlyTimer,
    onlyWidget,
    press,
    primaryOf,
    rectOf,
    removes,
    seededWidget,
    sentOf,
    solo,
    srcDocOf,
    START,
    timerOf,
    widgets,
    writes,
} from "./helpers";

const menuId = (key: keyof typeof MENU) => `${DRIVER_ID}:${MENU[key]}`;
const HOME = { x: 0, y: 0, width: 1600, height: 1000 };

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
    assert.equal(host.floating.size, 0);
});

test("the rail button on an empty board opens a kept-alive panel and adds one widget in view, selected", async () => {
    const { host, settle } = await solo();
    host.clickButton();
    await settle();

    const [created] = sentOf(host, "command:webview:create");
    assert.equal(created.req.keepStateWhenClosed, true);
    assert.equal(adds(host).length, 1);
    const widget = onlyWidget(host);
    assert.deepEqual(
        [widget.width, widget.height],
        [WIDGET_SIZE.width, WIDGET_SIZE.height]
    );
    const timer = onlyTimer(host);
    assert.equal(timer.state, "ready");
    assert.equal(timer.durationMs, 5 * MINUTE_MS);
    assert.deepEqual(bakedOf(srcDocOf(widget)), toMeta(timer));
    assert.deepEqual(
        sentOf(host, "command:scene:set-selection").at(-1)?.req
            .drawdyElementIds,
        [widget.id]
    );
    assert.equal(lastState(host)?.timer?.id, widget.id);
});

test("the rail button leaves the board alone while a timer is in view, and adds one when none is", async () => {
    const { host, settle } = await solo({ seed: [seededWidget("w1")] });
    host.clickButton();
    await settle();
    assert.equal(adds(host).length, 0);
    assert.equal(lastState(host)?.timer?.id, "w1");

    host.pan(OFF_SCREEN);
    await settle();
    host.clickButton();
    await settle();
    assert.equal(adds(host).length, 1);
    assert.equal(widgets(host).length, 2);
});

test("a press on the widget adds the new widget at the same place and size, then removes the old one", async () => {
    const { host, settle } = await solo();
    const before = await addTimer(host, settle);
    host.clear();

    await press(host, settle, before, "start");

    assert.deepEqual(writes(host), ["add", "remove"]);
    assert.deepEqual(removes(host)[0].req.drawdyElementIds, [before.id]);
    const after = onlyWidget(host);
    assert.notEqual(after.id, before.id);
    assert.deepEqual(rectOf(after), rectOf(before));
    const timer = onlyTimer(host);
    assert.equal(timer.state, "running");
    assert.equal(timer.id, timerOf(before)?.id);
    assert.deepEqual(bakedOf(srcDocOf(after)), toMeta(timer));
    assert.deepEqual(buttonIdsOf(after), [
        `${DRIVER_ID}:${timer.id}:pause`,
        `${DRIVER_ID}:${timer.id}:add-minute`,
        `${DRIVER_ID}:${timer.id}:reset`,
    ]);
    assert.equal(lastState(host)?.timer?.id, after.id);
});

test("pause, +1 min, resume and reset are one replacement each", async () => {
    const { host, settle, advance } = await solo();
    await press(host, settle, await addTimer(host, settle), "start");
    await advance(48_000);
    host.clear();

    await press(host, settle, onlyWidget(host), "pause");
    assert.equal(onlyTimer(host).state, "paused");
    assert.equal(onlyTimer(host).remainingMs, 252_000);

    await press(host, settle, onlyWidget(host), "add-minute");
    assert.equal(onlyTimer(host).remainingMs, 312_000);

    await press(host, settle, onlyWidget(host), "start");
    assert.equal(onlyTimer(host).state, "running");

    await press(host, settle, onlyWidget(host), "reset");
    assert.equal(onlyTimer(host).state, "ready");
    assert.deepEqual(writes(host), [
        ...["add", "remove"],
        ...["add", "remove"],
        ...["add", "remove"],
        ...["add", "remove"],
    ]);
    assert.equal(widgets(host).length, 1);
});

test("a click whose pointer travelled more than a few pixels is a drag and presses nothing", async () => {
    const { host, settle } = await solo();
    const widget = await addTimer(host, settle);
    host.clear();
    await press(host, settle, widget, "start", 40);
    assert.deepEqual(writes(host), []);
    assert.equal(onlyTimer(host).state, "ready");
});

test("a click on the face or between the buttons presses nothing", async () => {
    const { host, settle } = await solo();
    const widget = await addTimer(host, settle);
    host.clear();
    const r = rectOf(widget);
    host.clickAt({ x: r.x + r.width / 2, y: r.y + 60 });
    await settle();
    host.clickAt({ x: r.x + 3, y: r.y + r.height - 3 });
    await settle();
    assert.deepEqual(writes(host), []);
});

test("a typed label goes with Start in the same single replacement", async () => {
    const { host, settle } = await solo();
    const widget = await addTimer(host, settle);
    host.clear();
    await act(
        host,
        settle,
        widget.id,
        { type: "set-label", label: "Critique" },
        { type: "start" }
    );
    assert.equal(adds(host).length, 1);
    assert.equal(onlyTimer(host).label, "Critique");
    assert.equal(onlyTimer(host).state, "running");
});

test("presses and actions that change nothing write nothing", async () => {
    const { host, settle } = await solo();
    const widget = await addTimer(host, settle);
    host.clear();
    await press(host, settle, widget, "reset");
    await act(host, settle, widget.id, { type: "pause" });
    await act(host, settle, widget.id, { type: "set-duration", minutes: 5 });
    await act(host, settle, widget.id, { type: "bogus" });
    assert.deepEqual(writes(host), []);
});

test("a pressed widget that was selected stays selected as its replacement", async () => {
    const { host, settle } = await solo({ seed: [seededWidget("w1")] });
    host.select(["w1"]);
    await settle();
    await press(host, settle, onlyWidget(host), "start");
    const after = onlyWidget(host);
    assert.deepEqual(
        sentOf(host, "command:scene:set-selection").at(-1)?.req
            .drawdyElementIds,
        [after.id]
    );
    assert.equal(lastState(host)?.timer?.id, after.id);
});

test("a widget someone resized comes back at that size", async () => {
    const { host, settle } = await solo({
        seed: [
            seededWidget("w1", newTimer("w1"), {
                x: 30,
                y: 40,
                width: 450,
                height: 315,
            }),
        ],
    });
    await press(host, settle, onlyWidget(host), "start");
    assert.deepEqual(rectOf(onlyWidget(host)), {
        x: 30,
        y: 40,
        width: 450,
        height: 315,
    });
});

test("a widget inside a frame or a group stays in it", async () => {
    const seeded = { ...seededWidget("w1"), frameId: "section", groupId: "g" };
    const { host, settle } = await solo({ seed: [seeded] });
    await press(host, settle, onlyWidget(host), "start");
    const after = onlyWidget(host);
    assert.equal(after.frameId, "section");
    assert.equal(after.groupId, "g");
});

test("the pill shows only while the running widget is out of view or too small to read", async () => {
    const { host, settle } = await solo();
    await press(host, settle, await addTimer(host, settle), "start");
    assert.equal(host.floating.has(HUD_ID), false);

    host.pan(OFF_SCREEN);
    await settle();
    const hud = host.floating.get(HUD_ID);
    assert.equal(hud?.asPopover, false);
    assert.deepEqual(hud?.position, { x: (1280 - HUD_WIDTH) / 2, y: HUD_TOP });
    assert.equal(hudTime(host), "5:00");

    host.pan(HOME);
    await settle();
    assert.equal(host.floating.has(HUD_ID), false);

    host.pan({ x: 0, y: 0, width: 16_000, height: 10_000 }, 0.1);
    await settle();
    assert.equal(hudKind(host), "running");
});

test("a paused widget out of view gets no pill", async () => {
    const { host, settle } = await solo();
    await press(host, settle, await addTimer(host, settle), "start");
    await press(host, settle, onlyWidget(host), "pause");
    host.pan(OFF_SCREEN);
    await settle();
    assert.equal(host.floating.has(HUD_ID), false);
});

test("the pill changes only when the shown second does", async () => {
    const { host, settle, advance } = await solo();
    await press(host, settle, await addTimer(host, settle), "start");
    host.pan(OFF_SCREEN);
    await settle();
    const before = hudUpserts(host);

    await advance(400);
    assert.equal(hudUpserts(host), before);
    await advance(700);
    assert.equal(hudUpserts(host), before + 1);
    assert.equal(hudTime(host), "4:59");
    await advance(10_000);
    assert.equal(hudUpserts(host), before + 11);
    assert.equal(hudTime(host), "4:49");
});

test("at zero the presser's screen writes the finished state once, so the widget offers Start again, and the pill reads time's up for 5 seconds", async () => {
    const { host, settle, advance } = await solo();
    const widget = await addTimer(host, settle);
    await act(
        host,
        settle,
        widget.id,
        { type: "set-duration", minutes: 1 },
        { type: "start" }
    );
    host.pan(OFF_SCREEN);
    await settle();
    host.clear();

    await advance(MINUTE_MS - 1_000);
    assert.deepEqual(writes(host), []);
    await advance(1_020);
    assert.deepEqual(writes(host), ["add", "remove"]);
    const done = onlyWidget(host);
    assert.equal(onlyTimer(host).state, "done");
    assert.equal(onlyTimer(host).endsAt, START + MINUTE_MS);
    assert.equal(primaryOf(done), "start-again");
    assert.deepEqual(bakedOf(srcDocOf(done)), toMeta(onlyTimer(host)));
    assert.equal(chimes(host).length, 1);
    assert.deepEqual(chimes(host)[0], { type: "chime", sound: "soft" });
    assert.equal(hudKind(host), "done");

    await advance(4_000);
    assert.equal(hudKind(host), "done");
    await advance(1_100);
    assert.equal(host.floating.has(HUD_ID), false);
    await advance(60_000);
    assert.deepEqual(writes(host), ["add", "remove"]);
    assert.equal(chimes(host).length, 1);
});

test("pausing or resetting before zero cancels the finish write", async () => {
    for (const action of ["pause", "reset"] as const) {
        const { host, settle, advance } = await solo();
        const widget = await addTimer(host, settle);
        await act(
            host,
            settle,
            widget.id,
            { type: "set-duration", minutes: 1 },
            { type: "start" }
        );
        await advance(30_000);
        await press(host, settle, onlyWidget(host), action);
        host.clear();
        await advance(2 * MINUTE_MS);
        assert.deepEqual(writes(host), [], action);
        assert.equal(
            primaryOf(onlyWidget(host)),
            action === "pause" ? "resume" : "start"
        );
    }
});

test("undoing the finish write brings Pause back without it being written again", async () => {
    const { host, settle, advance } = await solo();
    const widget = await addTimer(host, settle);
    await act(
        host,
        settle,
        widget.id,
        { type: "set-duration", minutes: 1 },
        { type: "start" }
    );
    const running = structuredClone(onlyWidget(host));
    await advance(MINUTE_MS + 20);
    const done = onlyWidget(host);
    host.restore(running);
    host.board.write(host.board.clients[0], done.id, null);
    await settle();
    host.clear();
    await advance(30_000);
    assert.deepEqual(writes(host), []);
    assert.equal(primaryOf(onlyWidget(host)), "pause");
});

test("pressing Pause on someone else's run that has just ended settles it as done, and Start runs it again", async () => {
    const run = reduce(
        newTimer("w1", 1),
        { type: "start" },
        START - MINUTE_MS + 1_000
    );
    const { host, settle, advance } = await solo({
        seed: [seededWidget("w1", run)],
    });
    await advance(2_000);
    assert.equal(primaryOf(onlyWidget(host)), "pause");
    await press(host, settle, onlyWidget(host), "pause");
    assert.equal(onlyTimer(host).state, "done");
    const settled = onlyWidget(host);
    assert.equal(primaryOf(settled), "start-again");

    await press(host, settle, settled, "start");
    assert.equal(onlyTimer(host).state, "running");
    assert.equal(onlyTimer(host).endsAt, START + 2_000 + MINUTE_MS);
});

test("with sound off there is no chime, and the choice is kept on this device", async () => {
    const { host, settle, advance } = await solo();
    host.message({ type: "sound", value: "off" });
    await settle();
    assert.deepEqual(host.kv.get("prefs"), { sound: "off" });
    assert.equal(lastState(host)?.sound, "off");

    const widget = await addTimer(host, settle);
    await act(
        host,
        settle,
        widget.id,
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

test("undoing a press takes two steps: the old widget comes back under the new one, then the new one goes", async () => {
    const { host, settle } = await solo();
    const ready = structuredClone(await addTimer(host, settle));
    await press(host, settle, ready, "start");
    const running = structuredClone(onlyWidget(host));
    host.pan(OFF_SCREEN);
    await settle();
    assert.equal(hudKind(host), "running");

    host.restore(ready);
    await settle();
    assert.equal(widgets(host).length, 2);

    host.board.write(host.board.clients[0], running.id, null);
    await settle();
    assert.equal(onlyWidget(host).id, ready.id);
    assert.equal(onlyTimer(host).state, "ready");
    assert.equal(host.floating.has(HUD_ID), false);
    assert.equal(lastState(host)?.timer?.state, "ready");
});

test("after one undo the restored widget sits on top: a press acts on it and leaves one widget", async () => {
    const { host, settle } = await solo();
    const ready = structuredClone(await addTimer(host, settle));
    await press(host, settle, ready, "start");
    host.restore(ready);
    await settle();
    assert.equal(widgets(host).length, 2);
    host.message({ type: "ready" });
    await settle();
    assert.equal(lastState(host)?.count, 1);

    await press(host, settle, host.element(ready.id)!, "add-minute");
    assert.equal(widgets(host).length, 1);
    assert.equal(onlyTimer(host).state, "ready");
    assert.equal(onlyTimer(host).durationMs, 6 * MINUTE_MS);
});

test("delete removes the widget in one command and the pill goes", async () => {
    const { host, settle } = await solo();
    await press(host, settle, await addTimer(host, settle), "start");
    host.pan(OFF_SCREEN);
    await settle();
    assert.ok(host.floating.has(HUD_ID));

    host.message({ type: "delete", id: onlyWidget(host).id });
    await settle();
    assert.equal(removes(host).at(-1)?.req.drawdyElementIds.length, 1);
    assert.equal(host.live().length, 0);
    assert.equal(host.floating.has(HUD_ID), false);
    assert.equal(lastState(host)?.timer, null);
});

test("deleting the widget on the board clears the pill too", async () => {
    const { host, settle } = await solo();
    await press(host, settle, await addTimer(host, settle), "start");
    host.pan(OFF_SCREEN);
    await settle();
    host.board.write(host.board.clients[0], onlyWidget(host).id, null);
    await settle();
    assert.equal(host.floating.has(HUD_ID), false);
});

test("the context menu acts on the selected widget and follows it through each replacement", async () => {
    const { host, settle } = await solo({
        seed: [
            seededWidget("a", newTimer("a"), { x: 100, y: 100 }),
            seededWidget("b", newTimer("b"), { x: 600, y: 100 }),
        ],
    });
    host.select(["a"]);
    await settle();

    host.menu(menuId("toggle"));
    await settle();
    const of = (key: string) =>
        widgets(host).find((w) => timerOf(w)?.id === key)!;
    assert.equal(timerOf(of("a"))?.state, "running");
    assert.equal(of("b").id, "b");

    host.menu(menuId("addMinute"));
    await settle();
    host.menu(menuId("toggle"));
    await settle();
    assert.equal(timerOf(of("a"))?.state, "paused");
    assert.equal(timerOf(of("a"))?.remainingMs, 6 * MINUTE_MS);

    host.menu(menuId("reset"));
    await settle();
    assert.equal(timerOf(of("a"))?.state, "ready");
    assert.equal(timerOf(of("b"))?.state, "ready");
    assert.equal(widgets(host).length, 2);
});

test("the panel follows the selected timer and stays on it after the selection clears", async () => {
    const { host, settle } = await solo({
        seed: [
            seededWidget("a", newTimer("a"), { x: 100, y: 100 }),
            seededWidget("b", newTimer("b"), { x: 600, y: 100 }),
        ],
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

test("a panel action sent just before a replacement follows the widget to its new id", async () => {
    const { host, settle } = await solo();
    const widget = await addTimer(host, settle);
    host.message({ type: "act", id: widget.id, actions: [{ type: "start" }] });
    host.message({ type: "act", id: widget.id, actions: [{ type: "pause" }] });
    await settle();
    assert.equal(onlyTimer(host).state, "paused");
    assert.equal(adds(host).length, 3);
});

test("a press lands on the widget clicked when a pasted copy shares its timer, and that one takes its own id", async () => {
    const original = seededWidget("w1", newTimer("w1"), { x: 100, y: 100 });
    const copy = {
        ...seededWidget("w1", newTimer("w1"), { x: 700, y: 100 }),
        id: "copy",
    };
    const { host, settle } = await solo({ seed: [original, copy] });

    await press(host, settle, host.element("copy")!, "start");
    assert.equal(host.element("w1")?.id, "w1");
    assert.equal(timerOf(host.element("w1"))?.state, "ready");
    const pressed = widgets(host).find((w) => w.id !== "w1")!;
    assert.equal(pressed.x, 700);
    assert.equal(timerOf(pressed)?.state, "running");
    assert.notEqual(timerOf(pressed)?.id, "w1");

    await press(host, settle, host.element("w1")!, "start");
    assert.equal(
        widgets(host).every((w) => timerOf(w)?.state === "running"),
        true
    );
    assert.equal(widgets(host).length, 2);
});

test("a board opened after its timer ran out stays quiet and writes the finished state once", async () => {
    const expired = reduce(
        newTimer("t1", 1),
        { type: "start" },
        START - 10 * MINUTE_MS
    );
    const { host, advance } = await solo({
        seed: [seededWidget("t1", expired)],
        viewport: OFF_SCREEN,
    });
    await advance(10_000);
    assert.deepEqual(writes(host), ["add", "remove"]);
    assert.equal(onlyTimer(host).state, "done");
    assert.equal(primaryOf(onlyWidget(host)), "start-again");
    assert.equal(chimes(host).length, 0);
    assert.equal(host.floating.has(HUD_ID), false);
    await advance(MINUTE_MS);
    assert.deepEqual(writes(host), ["add", "remove"]);
});

test("a run someone else pressed is written as finished 5 s after zero, once per screen", async () => {
    const run = reduce(newTimer("w1", 1), { type: "start" }, START - 30_000);
    const { host, settle, advance } = await solo({
        seed: [seededWidget("w1", run)],
    });
    const running = structuredClone(onlyWidget(host));
    await advance(30_000 + 4_900);
    assert.deepEqual(writes(host), []);
    await advance(200);
    assert.deepEqual(writes(host), ["add", "remove"]);
    const done = onlyWidget(host);
    assert.equal(primaryOf(done), "start-again");

    host.restore(running);
    host.board.write(host.board.clients[0], done.id, null);
    await settle();
    assert.equal(primaryOf(onlyWidget(host)), "pause");
    await advance(60_000);
    assert.deepEqual(writes(host), ["add", "remove"]);
});

test("a board opened mid-run shows the pill for a widget out of view, chimes at the end, and writes only the fallback", async () => {
    const running = reduce(
        newTimer("t1", 1),
        { type: "start" },
        START - 30_000
    );
    const { host, advance } = await solo({
        seed: [seededWidget("t1", running)],
        viewport: OFF_SCREEN,
    });
    assert.equal(hudTime(host), "0:30");
    await advance(30_100);
    assert.equal(chimes(host).length, 1);
    assert.deepEqual(writes(host), []);
    await advance(5_000);
    assert.deepEqual(writes(host), ["add", "remove"]);
    assert.equal(chimes(host).length, 1);
});

test("a theme change reaches the panel and redraws the pill, and a resize recentres it", async () => {
    const { host, settle } = await solo();
    await press(host, settle, await addTimer(host, settle), "start");
    host.pan(OFF_SCREEN);
    await settle();
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

test("a refused board write tells the panel and keeps the widget as the board has it", async () => {
    const { host, settle } = await solo({
        seed: [seededWidget("w1")],
        denied: ["command:scene:add"],
    });
    await press(host, settle, onlyWidget(host), "start");
    assert.equal(onlyWidget(host).id, "w1");
    assert.equal(onlyTimer(host).state, "ready");
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

test("a 1.0.0 timer frame keeps its pill until the first action, which turns it into a widget at its corner", async () => {
    const run = reduce(newTimer("f1", 5), { type: "start" }, START - 60_000);
    const { host, settle } = await solo({
        seed: legacyFrame("f1", run, { x: 80, y: 90 }),
    });
    assert.equal(hudTime(host), "4:00");
    host.message({ type: "ready" });
    await settle();
    assert.equal(lastState(host)?.timer?.id, "f1");

    await act(host, settle, "f1", { type: "pause" });
    assert.deepEqual(writes(host), ["add", "remove"]);
    assert.deepEqual(removes(host)[0].req.drawdyElementIds.sort(), [
        "f1",
        "f1-glyph",
    ]);
    assert.equal(host.live().length, 1);
    const widget = onlyWidget(host);
    assert.deepEqual(rectOf(widget), { x: 80, y: 90, ...WIDGET_SIZE });
    const timer = onlyTimer(host);
    assert.equal(timer.id, "f1");
    assert.equal(timer.state, "paused");
    assert.equal(timer.remainingMs, 4 * MINUTE_MS);
    assert.equal("startedBy" in (widget.meta?.[DRIVER_ID] as object), false);
    assert.equal(host.floating.has(HUD_ID), false);
});

test("a 1.0.0 frame converts even on an action that changes nothing", async () => {
    const { host, settle } = await solo({ seed: legacyFrame("f1") });
    await act(host, settle, "f1", { type: "reset" });
    assert.equal(onlyTimer(host).state, "ready");
    assert.equal(host.element("f1"), null);
});

test("an action on a widget the board no longer has writes nothing", async () => {
    const { host, settle } = await solo({ seed: [seededWidget("w1")] });
    host.message({ type: "act", id: "w1", actions: [{ type: "start" }] });
    host.board.write(host.board.clients[0], "w1", null);
    await settle();
    assert.deepEqual(writes(host), []);
    assert.equal(lastState(host)?.timer, null);
});
