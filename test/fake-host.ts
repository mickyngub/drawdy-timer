import type {
    DomElementSchema,
    DriverCommandIssuer,
    DriverManifest,
    DriverModule,
} from "@drawdy/driver-protocol";
import { overlaps, type Rect } from "../src/lib/free-spot";

export const START = Date.UTC(2026, 10, 12, 14, 0, 0);

export type Stored = Record<string, unknown> & {
    id: string;
    type: string;
    meta?: Record<string, unknown>;
};

type Version = { el: Stored | null; seq: number };

type Event = { type: string; subscriptionId: string; body?: unknown };

export async function settle(): Promise<void> {
    for (let i = 0; i < 25; i++)
        await new Promise<void>((resolve) => setImmediate(resolve));
}

export function fakeClock(start = START) {
    let now = start;
    let ids = 0;
    const timers = new Map<number, { at: number; fn: () => void }>();
    return {
        now: () => now,
        setTimeout: (fn: () => void, ms: number) => {
            const id = ++ids;
            timers.set(id, { at: now + Math.max(0, ms), fn });
            return id;
        },
        clearTimeout: (id: unknown) => {
            timers.delete(id as number);
        },
        pending: () => timers.size,
        async advance(ms: number, after: () => Promise<void> = settle) {
            const end = now + ms;
            for (;;) {
                let next: [number, { at: number; fn: () => void }] | null =
                    null;
                for (const entry of timers)
                    if (
                        entry[1].at <= end &&
                        (!next || entry[1].at < next[1].at)
                    )
                        next = entry;
                if (!next) break;
                timers.delete(next[0]);
                now = next[1].at;
                next[1].fn();
                await after();
            }
            now = end;
            await after();
        },
    };
}

export type FakeClock = ReturnType<typeof fakeClock>;

type Client = {
    replica: Map<string, Version>;
    emit: (type: string, elements: Stored[]) => void;
    drain: () => Promise<boolean>;
};

/**
 * One board shared by several clients. Each client edits its own replica and
 * sends the whole element on; a replica keeps whichever write the board
 * ordered last, so concurrent edits to one element end as last write wins
 * for the whole element, the way Drawdy stores elements.
 */
export function fakeBoard() {
    let seq = 0;
    let holding = false;
    const clients: Client[] = [];
    const network: { to: Client; id: string; version: Version }[] = [];

    const apply = (client: Client, id: string, version: Version) => {
        const current = client.replica.get(id);
        if (current && current.seq >= version.seq) return;
        client.replica.set(id, version);
        if (version.el === null) {
            if (current?.el)
                client.emit("subscription:scene:elements-removed", [
                    current.el,
                ]);
        } else if (!current?.el) {
            client.emit("subscription:scene:elements-added", [version.el]);
        } else {
            client.emit("subscription:scene:elements-updated", [version.el]);
        }
    };

    const sync = () => {
        while (network.length) {
            const { to, id, version } = network.shift()!;
            apply(to, id, version);
        }
    };

    return {
        clients,
        join(client: Client) {
            clients.push(client);
            for (const other of clients) {
                if (other === client) continue;
                for (const [id, version] of other.replica)
                    client.replica.set(id, structuredClone(version));
                break;
            }
        },
        write(from: Client, id: string, el: Stored | null) {
            const version: Version = { el, seq: ++seq };
            apply(from, id, version);
            for (const to of clients)
                if (to !== from)
                    network.push({ to, id, version: structuredClone(version) });
            if (!holding) sync();
        },
        /** Stops delivery between clients, so their next writes cross on the wire. */
        hold() {
            holding = true;
        },
        release() {
            holding = false;
            sync();
        },
        async settle() {
            for (let round = 0; round < 50; round++) {
                if (!holding) sync();
                let busy = false;
                for (const client of clients)
                    if (await client.drain()) busy = true;
                await settle();
                if (!busy && (holding || network.length === 0)) return;
            }
        },
    };
}

export type FakeBoard = ReturnType<typeof fakeBoard>;

/** What check-can-edit answers: yes, no (a view-only board), or an error, as hosts before the view-only guard do. */
export type EditAccess = boolean | "unsupported";

// The commands Drawdy refuses on a view-only board (drawdy PR #113).
const BOARD_WRITES = new Set([
    "command:scene:add-drawdy-elements",
    "command:scene:remove-drawdy-elements",
    "command:scene:update-drawdy-elements",
    "command:scene:update-text-edit",
    "command:tools:emulate-pointer",
    "command:history:undo",
    "command:history:redo",
]);

const isBoardWrite = (cmd: { type: string; req?: any }) =>
    BOARD_WRITES.has(cmd.type) ||
    (cmd.type === "command:scene:end-preview" &&
        (cmd.req?.commits?.length ?? 0) > 0);

type Options = {
    board?: FakeBoard;
    canEdit?: EditAccess;
    viewport?: Rect;
    zoom?: number;
    window?: { width: number; height: number };
    kv?: Map<string, Record<string, unknown>>;
    denied?: string[];
    seed?: Stored[];
};

const pickOf = (el: Stored, properties: string[]) => {
    const picked: Record<string, unknown> = { id: el.id };
    for (const key of properties)
        if (el[key] !== undefined) picked[key] = el[key];
    return picked;
};

const rectOf = (el: Stored): Rect => ({
    x: el.x as number,
    y: el.y as number,
    width: el.width as number,
    height: el.height as number,
});

function normalize(el: any): Stored {
    const { drawdyElementId: id, ...rest } = el;
    if (el.type === "frame") {
        const { position, name, ...frame } = rest;
        return {
            ...frame,
            id,
            x: position[0],
            y: position[1],
            frameName: name || "Frame",
        };
    }
    if (el.type === "text")
        return { ...rest, id, height: el.height ?? el.fontSize * 1.25 };
    return { ...rest, id };
}

export function fakeHost(options: Options = {}) {
    const board = options.board ?? fakeBoard();
    let viewport = options.viewport ?? {
        x: 0,
        y: 0,
        width: 1600,
        height: 1000,
    };
    let zoom = options.zoom ?? 1;
    const listening = new Set<string>();
    const windowSize = options.window ?? { width: 1280, height: 800 };
    const kv = options.kv ?? new Map<string, Record<string, unknown>>();
    const sent: { type: string; req?: any }[] = [];
    const posted: any[] = [];
    const floating = new Map<
        string,
        {
            position: { x: number; y: number };
            schema: DomElementSchema;
            asPopover?: boolean;
        }
    >();
    const menus: any[] = [];
    const inbox: Event[] = [];
    const elementProperties: string[] = [];
    let module: DriverModule | null = null;
    let selection: string[] = [];
    let webview = false;
    let ids = 0;
    let access: EditAccess = options.canEdit ?? true;
    const after: { type: string; fn: () => void }[] = [];

    const client: Client = {
        replica: new Map(),
        emit(type, elements) {
            if (elementProperties.length === 0) return;
            inbox.push({
                type,
                subscriptionId: type,
                body: {
                    drawdyElements: elements.map((el) =>
                        pickOf(el, elementProperties)
                    ),
                    properties: elementProperties,
                },
            });
        },
        async drain() {
            if (!module || inbox.length === 0) return false;
            while (inbox.length) await module.onEvent(inbox.shift() as any);
            return true;
        },
    };
    board.join(client);
    for (const el of options.seed ?? []) board.write(client, el.id, el);

    const live = (): Stored[] =>
        [...client.replica.values()].flatMap((v) => (v.el ? [v.el] : []));
    const element = (id: string): Stored | null =>
        client.replica.get(id)?.el ?? null;

    const answer = async (cmd: any) => {
        const ok = (value?: unknown) => ({ ...cmd, res: { value } });
        const fail = (type: string, message?: string) => ({
            ...cmd,
            res: { error: { type, message } },
        });
        if (options.denied?.some((prefix) => cmd.type.startsWith(prefix)))
            return fail("unauthorized");
        if (access === false && isBoardWrite(cmd))
            return {
                ...cmd,
                res: {
                    error: {
                        type: "unauthorized",
                        message: `This board is view-only for you, so ${cmd.type} was refused.`,
                        body: { reason: "read-only", commandType: cmd.type },
                    },
                },
            };
        const req = cmd.req;
        switch (cmd.type) {
            case "command:auth:check-can-edit":
                return access === "unsupported"
                    ? fail("unauthorized", `not allowed to use ${cmd.type}`)
                    : ok({ canEdit: access });
            case "command:dom:create-action-button":
                return ok({ created: true });
            case "command:webview:create": {
                const created = !webview;
                webview = true;
                return ok({ created });
            }
            case "command:webview:post-message":
                posted.push(req.message);
                return ok({ posted: webview });
            case "command:dom:window-size":
                return ok(windowSize);
            case "command:dom:upsert-floating-element": {
                const created = !floating.has(req.domId);
                floating.set(req.domId, {
                    position: req.position,
                    schema: req.schema,
                    asPopover: created
                        ? req.asPopover
                        : floating.get(req.domId)?.asPopover,
                });
                return ok({ created });
            }
            case "command:dom:remove-floating-element":
                return ok({ removed: floating.delete(req.domId) });
            case "command:dom:element-rect":
                return fail("not-found");
            case "command:context-menu:add":
                menus.push(req);
                return ok({ added: true });
            case "command:kv-storage:get":
                return ok({ got: kv.get(req.key) });
            case "command:kv-storage:set":
                kv.set(req.key, structuredClone(req.payload));
                return ok();
            case "command:camera:get-viewport-rect":
                return ok({ rect: viewport });
            case "command:camera:get-info":
                return ok({ x: 0, y: 0, zoom });
            case "command:camera:screen-to-canvas":
                return ok({
                    x: viewport.x + req.x / zoom,
                    y: viewport.y + req.y / zoom,
                });
            case "command:scene:get-drawdy-elements": {
                const wanted: string[] | undefined = req.drawdyElementIds;
                const els = wanted
                    ? wanted.flatMap((id) => element(id) ?? [])
                    : live();
                return ok({
                    drawdyElements: els.map((el) => pickOf(el, req.properties)),
                });
            }
            case "command:scene:add-drawdy-elements":
                for (const raw of req.elements) {
                    const el = normalize(structuredClone(raw));
                    board.write(client, el.id, el);
                }
                return ok();
            case "command:scene:update-drawdy-elements": {
                let updated = 0;
                for (const { drawdyElementId: id, properties } of req.updates) {
                    const current = element(id);
                    if (!current) continue;
                    if (
                        properties.frameName !== undefined &&
                        current.type !== "frame"
                    )
                        return fail(
                            "bad-argument",
                            "frameName can only be set on frame elements"
                        );
                    const next: Stored = structuredClone(current);
                    if (properties.meta)
                        next.meta = {
                            ...current.meta,
                            ...structuredClone(properties.meta),
                        };
                    if (properties.frameName !== undefined)
                        next.frameName = properties.frameName || "Frame";
                    board.write(client, id, next);
                    updated++;
                }
                return ok({ updated });
            }
            case "command:scene:remove-drawdy-elements": {
                let removed = 0;
                for (const id of req.drawdyElementIds as string[]) {
                    if (!element(id)) continue;
                    board.write(client, id, null);
                    removed++;
                }
                return ok({ removed });
            }
            case "command:scene:query-rect":
                return ok({
                    drawdyElements: live()
                        .filter((el) => overlaps(rectOf(el), req.rect))
                        .map((el) => ({ id: el.id, type: el.type })),
                });
            case "command:scene:element-rects":
                return ok({
                    rects: (req.drawdyElementIds as string[]).flatMap((id) => {
                        const el = element(id);
                        return el
                            ? [{ drawdyElementId: id, rect: rectOf(el) }]
                            : [];
                    }),
                });
            case "command:scene:set-selection":
                select(req.drawdyElementIds);
                return ok();
            case "command:scene:get-current-selected-drawdy-elements":
                return ok({ drawdyElementIds: selection });
            default:
                if (
                    cmd.type.startsWith("subscription:scene:elements-") &&
                    elementProperties.length === 0
                )
                    elementProperties.push(...req.properties);
                if (cmd.type.startsWith("subscription:"))
                    listening.add(cmd.type);
                return ok(
                    cmd.type.startsWith("subscription:")
                        ? { subscriptionId: cmd.type }
                        : {}
                );
        }
    };

    const issueCommand = (async (cmd: any) => {
        sent.push({ type: cmd.type, req: cmd.req });
        const res = await answer(cmd);
        const hook = after.findIndex((h) => h.type === cmd.type);
        if (hook >= 0) after.splice(hook, 1)[0].fn();
        return res;
    }) as unknown as DriverCommandIssuer;

    function select(next: string[]) {
        selection = [...next];
        inbox.push({
            type: "subscription:scene:drawdy-element-selection",
            subscriptionId: "selection",
            body: { drawdyElementIds: selection },
        });
    }

    const push = (type: string, body: unknown) =>
        inbox.push({ type, subscriptionId: type, body });

    return {
        board,
        issueCommand,
        sent,
        posted,
        floating,
        menus,
        kv,
        live,
        element,
        nextId: () => `el-${++ids}`,
        async boot(
            driver: DriverModule,
            manifest: DriverManifest,
            theme: "light" | "dark" = "dark"
        ) {
            module = driver;
            let local = 0;
            const prefix = `c${board.clients.indexOf(client)}`;
            await driver.activate({
                manifest,
                issueCommand,
                styling: { theme, tokens: {} } as any,
                generateId: () => `${prefix}-el-${++local}`,
            });
            await board.settle();
        },
        clickButton: () =>
            push("subscription:dom:element-clicked", {
                domElementId: "mickyngub.timer:action-button",
                clientX: 0,
                clientY: 0,
            }),
        /**
         * A press and release on the board with the select tool, as Drawdy
         * reports it: the pointer down, the element under it selected, then
         * a click on whatever is under both points. `to` drags in between.
         */
        clickAt(at: { x: number; y: number }, to = at) {
            const under = (p: { x: number; y: number }) =>
                live()
                    .filter((el) =>
                        overlaps(rectOf(el), { ...p, width: 0, height: 0 })
                    )
                    .map((el) => el.id);
            const cursor = (p: { x: number; y: number }) => ({
                canvasSpace: p,
                domSpace: {
                    x: (p.x - viewport.x) * zoom,
                    y: (p.y - viewport.y) * zoom,
                },
            });
            const down = under(at);
            if (listening.has("subscription:scene:pointer"))
                push("subscription:scene:pointer", {
                    type: "down",
                    drawdyElementIds: down,
                    pressure: 0.5,
                    cursor: cursor(at),
                });
            if (down.length) select([down.at(-1)!]);
            const up = new Set(under(to));
            const clicked = down.filter((id) => up.has(id));
            if (clicked.length && listening.has("subscription:scene:click"))
                push("subscription:scene:click", {
                    drawdyElementIds: clicked,
                    cursor: cursor(to),
                });
        },
        viewport: () => ({ rect: viewport, zoom }),
        /** Moves the camera, then reports it once it settles. */
        pan(rect: Rect, nextZoom = zoom) {
            viewport = rect;
            zoom = nextZoom;
            push("subscription:camera:moved-debounced", {
                x: -rect.x * zoom,
                y: -rect.y * zoom,
                zoom,
            });
        },
        message: (message: Record<string, unknown>) =>
            push("subscription:webview:message", {
                webviewDomId: "mickyngub.timer:webview",
                message,
            }),
        theme: (styling: Record<string, unknown>) =>
            push("subscription:dom:theme-changed", { styling }),
        resize: (width: number, height: number) =>
            push("subscription:dom:screen-resized", { width, height }),
        menu: (menuId: string) =>
            push("subscription:context-menu:clicked", { menuId }),
        select,
        /** Undo puts the element back the way it was, as one whole-element write. */
        restore(snapshot: Stored) {
            board.write(client, snapshot.id, structuredClone(snapshot));
        },
        /** Changes this person's role: what check-can-edit answers, and whether board writes are refused. */
        setCanEdit(next: EditAccess) {
            access = next;
        },
        /** Runs `fn` once, right after the host answers the next command of this type, to change a role mid-action. */
        afterNext(type: string, fn: () => void) {
            after.push({ type, fn });
        },
        types: () => sent.map((s) => s.type),
        clear() {
            sent.length = 0;
            posted.length = 0;
        },
    };
}

export type FakeHost = ReturnType<typeof fakeHost>;
