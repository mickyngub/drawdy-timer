import assert from "node:assert/strict";
import { test } from "node:test";
import type { DriverCommandIssuer } from "@drawdy/driver-protocol";
import { MENU } from "../src/driver";
import { canEdit } from "../src/lib/can-edit";
import { HUD_TOP, HUD_WIDTH } from "../src/lib/hud";
import { panelControls, panelModel } from "../src/lib/panel-model";
import { MINUTE_MS, newTimer, reduce } from "../src/lib/timer-state";
import { fakeHost } from "./fake-host";
import {
    act,
    adds,
    addTimer,
    chimes,
    client,
    DRIVER_ID,
    fakeBoard,
    fakeClock,
    HUD_ID,
    hudKind,
    lastState,
    onlyTimer,
    onlyWidget,
    press,
    primaryOf,
    rectOf,
    removes,
    seededWidget,
    sentOf,
    solo,
    START,
    timerOf,
    widgets,
    writes,
} from "./helpers";

const CHECK = "command:auth:check-can-edit";
const menuId = (key: keyof typeof MENU) => `${DRIVER_ID}:${MENU[key]}`;

const ctxOf = (issueCommand: unknown) => ({
    issueCommand: issueCommand as DriverCommandIssuer,
    driverId: DRIVER_ID,
    nextRequestId: () => "1",
});

test("check-can-edit reads yes and no, and an older host's error, a missing answer or a throw as can edit", async () => {
    for (const [access, expected] of [
        [true, true],
        [false, false],
        ["unsupported", true],
    ] as const) {
        const host = fakeHost({ canEdit: access });
        assert.equal(
            await canEdit(ctxOf(host.issueCommand)),
            expected,
            String(access)
        );
        assert.deepEqual(host.types(), [CHECK]);
    }
    assert.equal(
        await canEdit(ctxOf(async (cmd: object) => ({ ...cmd, res: {} }))),
        true
    );
    assert.equal(
        await canEdit(
            ctxOf(async (cmd: object) => ({ ...cmd, res: { value: {} } }))
        ),
        true
    );
    assert.equal(
        await canEdit(
            ctxOf(async () => {
                throw new Error("gone");
            })
        ),
        true
    );
});

test("on a view-only board a press on the widget writes nothing and the notice shows at the top centre for 2.5 s", async () => {
    const { host, settle, advance } = await solo({
        seed: [seededWidget("w1")],
        canEdit: false,
    });
    host.clear();
    await press(host, settle, onlyWidget(host), "start");

    assert.deepEqual(writes(host), []);
    assert.equal(sentOf(host, CHECK).length, 1);
    assert.equal(hudKind(host), "notice");
    const notice = host.floating.get(HUD_ID);
    assert.equal(notice?.asPopover, false);
    assert.deepEqual(notice?.position, {
        x: (1280 - HUD_WIDTH) / 2,
        y: HUD_TOP,
    });
    assert.equal(onlyTimer(host).state, "ready");

    await advance(2_400);
    assert.equal(hudKind(host), "notice");
    await advance(200);
    assert.equal(host.floating.has(HUD_ID), false);
});

test("the rail button on a view-only board with no timer in view opens the panel in view-only and adds nothing", async () => {
    const { host, settle } = await solo({ canEdit: false });
    host.message({ type: "ready" });
    await settle();
    assert.equal(lastState(host)?.viewOnly, true);
    host.clear();

    host.clickButton();
    await settle();
    assert.equal(sentOf(host, "command:webview:create").length, 1);
    assert.deepEqual(writes(host), []);
    assert.equal(widgets(host).length, 0);
    assert.equal(hudKind(host), "notice");
    assert.equal(lastState(host)?.viewOnly, true);
    assert.equal(lastState(host)?.timer, null);
});

test("the context menu and every panel action write nothing on a view-only board and each shows the notice, while the sound choice still saves", async () => {
    const paused = reduce(
        reduce(newTimer("w1"), { type: "start" }, START - 60_000),
        { type: "pause" },
        START - 30_000
    );
    const { host, settle, advance } = await solo({
        seed: [seededWidget("w1", paused)],
        canEdit: false,
    });
    host.select(["w1"]);
    await settle();
    host.clear();

    const attempts = [
        () => host.menu(menuId("toggle")),
        () => host.menu(menuId("addMinute")),
        () => host.menu(menuId("reset")),
        () =>
            host.message({
                type: "act",
                id: "w1",
                actions: [{ type: "start" }],
            }),
        () =>
            host.message({
                type: "act",
                id: "w1",
                actions: [{ type: "set-label", label: "Retro" }],
            }),
        () => host.message({ type: "add" }),
        () => host.message({ type: "delete", id: "w1" }),
    ];
    for (const [i, attempt] of attempts.entries()) {
        await advance(3_000);
        assert.equal(host.floating.has(HUD_ID), false, `before ${i}`);
        attempt();
        await settle();
        assert.equal(hudKind(host), "notice", `after ${i}`);
    }
    assert.deepEqual(writes(host), []);
    assert.equal(onlyWidget(host).id, "w1");

    host.message({ type: "sound", value: "bell" });
    await settle();
    assert.deepEqual(host.kv.get("prefs"), { sound: "bell" });
});

test("on a view-only board the panel holds back every control that writes, and sound stays on", () => {
    const done = reduce(newTimer("t", 1), { type: "start" }, START);
    const at = START + MINUTE_MS + 1;
    const model = panelModel(done, at, { viewOnly: true });
    assert.equal(model.viewOnly, true);
    assert.deepEqual(panelControls(model), {
        primary: "view-only",
        add: "view-only",
        delete: "view-only",
        "add-minute": "view-only",
        reset: "view-only",
        length: "view-only",
        label: "view-only",
        sound: "on",
    });
    const empty = panelControls(panelModel(null, at, { viewOnly: true }));
    assert.equal(empty.primary, "view-only");
    assert.equal(empty.sound, "on");

    const editable = panelModel(done, at);
    assert.equal(editable.viewOnly, false);
    assert.ok(
        Object.values(panelControls(editable)).every((state) => state === "on")
    );
    assert.equal(
        panelControls(panelModel(newTimer("t"), at, { viewOnly: true })).reset,
        "off"
    );
});

test("a view-only screen skips the 5 s fallback finish write, quietly, and still chimes", async () => {
    const run = reduce(newTimer("w1", 1), { type: "start" }, START - 30_000);
    const { host, advance } = await solo({
        seed: [seededWidget("w1", run)],
        canEdit: false,
    });
    await advance(30_000 + 10_000);
    assert.deepEqual(writes(host), []);
    assert.equal(sentOf(host, CHECK).length, 2);
    assert.notEqual(hudKind(host), "notice");
    assert.equal(chimes(host).length, 1);
    assert.equal(primaryOf(onlyWidget(host)), "pause");
});

test("a screen that started a run and then lost edit access skips the finish write at zero, quietly", async () => {
    const { host, settle, advance } = await solo();
    const widget = await addTimer(host, settle);
    await act(
        host,
        settle,
        widget.id,
        { type: "set-duration", minutes: 1 },
        { type: "start" }
    );
    host.setCanEdit(false);
    host.clear();
    await advance(MINUTE_MS + 10_000);
    assert.deepEqual(writes(host), []);
    assert.equal(sentOf(host, CHECK).length, 1);
    assert.notEqual(hudKind(host), "notice");
    assert.equal(primaryOf(onlyWidget(host)), "pause");
});

test("on a host without check-can-edit Timer adds, presses and finishes as in 1.1.0", async () => {
    const { host, settle, advance } = await solo({ canEdit: "unsupported" });
    const widget = await addTimer(host, settle);
    await act(
        host,
        settle,
        widget.id,
        { type: "set-duration", minutes: 1 },
        { type: "start" }
    );
    assert.equal(onlyTimer(host).state, "running");
    await advance(MINUTE_MS + 50);
    assert.equal(onlyTimer(host).state, "done");
    assert.deepEqual(writes(host), ["add", "add", "remove", "add", "remove"]);
    assert.ok(sentOf(host, CHECK).length >= 3);
    assert.equal(lastState(host)?.viewOnly, false);
    assert.equal(
        host.posted.some((m) => m.type === "error"),
        false
    );
});

test("an add refused as read-only after the check said yes flips the panel to view-only, shows the notice and leaves the old widget alone", async () => {
    const { host, settle } = await solo({ seed: [seededWidget("w1")] });
    host.message({ type: "ready" });
    await settle();
    assert.equal(lastState(host)?.viewOnly, false);
    host.afterNext(CHECK, () => host.setCanEdit(false));
    host.clear();

    await press(host, settle, onlyWidget(host), "start");
    assert.equal(adds(host).length, 1);
    assert.equal(removes(host).length, 0);
    assert.equal(onlyWidget(host).id, "w1");
    assert.equal(onlyTimer(host).state, "ready");
    assert.equal(hudKind(host), "notice");
    assert.equal(lastState(host)?.viewOnly, true);
    assert.equal(
        host.posted.some((m) => m.type === "error"),
        false
    );
});

test("a remove refused as read-only after the add landed, with removing still refused, leaves the new widget stacked as a twin that an editor's next press clears", async () => {
    const { host, settle } = await solo({ seed: [seededWidget("w1")] });
    host.afterNext("command:scene:add-drawdy-elements", () =>
        host.setCanEdit(false)
    );
    host.clear();

    await press(host, settle, onlyWidget(host), "start");
    assert.deepEqual(writes(host), ["add", "remove"]);
    const stacked = widgets(host);
    assert.equal(stacked.length, 2);
    assert.deepEqual(rectOf(stacked[0]), rectOf(stacked[1]));
    assert.deepEqual(stacked.map((w) => timerOf(w)?.state).sort(), [
        "ready",
        "running",
    ]);
    assert.equal(hudKind(host), "notice");
    assert.equal(lastState(host)?.viewOnly, true);
    assert.equal(lastState(host)?.count, 1);

    host.setCanEdit(true);
    await press(
        host,
        settle,
        stacked.find((w) => w.id !== "w1")!,
        "pause"
    );
    assert.equal(widgets(host).length, 1);
    assert.equal(onlyTimer(host).state, "paused");
});

test("a remove refused as read-only after the add landed takes the new widget back when removing is allowed again", async () => {
    const { host, settle } = await solo({ seed: [seededWidget("w1")] });
    host.afterNext("command:scene:add-drawdy-elements", () =>
        host.setCanEdit(false)
    );
    host.afterNext("command:scene:remove-drawdy-elements", () =>
        host.setCanEdit(true)
    );
    host.clear();

    await press(host, settle, onlyWidget(host), "start");
    const added = adds(host)[0].req.elements[0].drawdyElementId;
    assert.deepEqual(
        removes(host).map((r) => r.req.drawdyElementIds),
        [["w1"], [added]]
    );
    assert.equal(onlyWidget(host).id, "w1");
    assert.equal(onlyTimer(host).state, "ready");
});

test("opening the panel checks again, and a write asks the host instead of trusting the cached answer", async () => {
    const { host, settle } = await solo({ seed: [seededWidget("w1")] });
    host.setCanEdit(false);
    host.clickButton();
    await settle();
    assert.equal(lastState(host)?.viewOnly, true);
    assert.equal(host.floating.has(HUD_ID), false);

    host.setCanEdit(true);
    await press(host, settle, onlyWidget(host), "start");
    assert.equal(onlyTimer(host).state, "running");
    assert.equal(lastState(host)?.viewOnly, false);
});

test("a viewer watches an editor's run tick and finish, and their press changes nothing on either screen", async () => {
    const clock = fakeClock();
    const board = fakeBoard();
    const editor = await client(clock, { board });
    const viewer = await client(clock, { board, canEdit: false });
    const settle = () => board.settle();
    const advance = (ms: number) => clock.advance(ms, settle);
    editor.clickButton();
    await settle();
    await act(
        editor,
        settle,
        onlyWidget(editor).id,
        { type: "set-duration", minutes: 1 },
        { type: "start" }
    );
    assert.equal(onlyTimer(viewer).state, "running");
    viewer.clear();

    await press(viewer, settle, onlyWidget(viewer), "pause");
    assert.deepEqual(writes(viewer), []);
    assert.equal(hudKind(viewer), "notice");
    assert.equal(onlyTimer(editor).state, "running");

    await advance(MINUTE_MS + 6_000);
    assert.deepEqual(writes(viewer), []);
    assert.equal(onlyTimer(viewer).state, "done");
    assert.equal(primaryOf(onlyWidget(viewer)), "start-again");
    assert.equal(chimes(viewer).length, 1);
});
