import type {
    DomElementSchema,
    DrawdyElementSchema,
} from "@drawdy/driver-protocol";
import { FACE_HTML } from "../face-html";
import type { Rect } from "./free-spot";
import {
    canReset,
    PRIMARY_LABEL,
    primaryAction,
    type PrimaryAction,
} from "./panel-model";
import { effective, toMeta, type Timer } from "./timer-state";

export const WIDGET_SIZE = { width: 300, height: 210 } as const;
export const WIDGET_LABEL = "Timer";
const BORDER_W = 1;
// Drawdy's 28 px drag bar sits inside this height, above the face.
const FRAME_H = 150;
const ROW_PAD = 9;
const BUTTON_GAP = 6;
const BUTTON_H = 40;
const BUTTON_W = { primary: 124, "add-minute": 78, reset: 66 } as const;

export const BUTTON_ACTIONS = [
    "start",
    "pause",
    "add-minute",
    "reset",
] as const;
export type ButtonAction = (typeof BUTTON_ACTIONS)[number];

// The board's own tokens, so each viewer sees the buttons in their theme.
const SURFACE = "var(--surface-panel, #1f1f23)";
const BORDER = "var(--border-medium, rgb(255 255 255 / 0.08))";
const TEXT = "var(--text-primary, rgb(255 255 255 / 0.95))";
const TEXT_DISABLED = "var(--text-disabled, rgb(255 255 255 / 0.3))";
const CONTROL = "var(--control-surface-subtle, rgb(255 255 255 / 0.06))";
const CONTROL_HOVER = "var(--control-surface-hover, rgb(255 255 255 / 0.18))";
const ACCENT = "var(--accent-default, #c5f601)";
const ACCENT_HOVER = "var(--accent-hover, #d4ff2e)";
const ON_ACCENT = "var(--accent-on-accent, #090909)";

/** What a button shows: the start-or-pause control's state, or one of the other two. */
export type ButtonSlot = Exclude<PrimaryAction, "add"> | "add-minute" | "reset";

/** A button's id carries its timer and what it shows, the stable hook for tests and tools. */
export const buttonDomId = (
    driverId: string,
    key: string,
    slot: ButtonSlot
): string => `${driverId}:${key}:${slot}`;

export type WidgetButton = {
    action: ButtonAction;
    slot: ButtonSlot;
    label: string;
    primary: boolean;
    enabled: boolean;
};

export function widgetButtons(timer: Timer, now: number): WidgetButton[] {
    const e = effective(timer, now);
    const primary = primaryAction(e.state);
    return [
        {
            action: primary === "pause" ? "pause" : "start",
            slot: primary,
            label: PRIMARY_LABEL[primary],
            primary: true,
            enabled: true,
        },
        {
            action: "add-minute",
            slot: "add-minute",
            label: "+1 min",
            primary: false,
            enabled: true,
        },
        {
            action: "reset",
            slot: "reset",
            label: "Reset",
            primary: false,
            enabled: canReset(e),
        },
    ];
}

type Slot = "primary" | "add-minute" | "reset";

const ROW_TOP = BORDER_W + FRAME_H + ROW_PAD;
const SLOTS: Record<Slot, { x: number; width: number }> = {
    primary: { x: BORDER_W + ROW_PAD, width: BUTTON_W.primary },
    "add-minute": {
        x: BORDER_W + ROW_PAD + BUTTON_W.primary + BUTTON_GAP,
        width: BUTTON_W["add-minute"],
    },
    reset: {
        x:
            BORDER_W +
            ROW_PAD +
            BUTTON_W.primary +
            BUTTON_W["add-minute"] +
            2 * BUTTON_GAP,
        width: BUTTON_W.reset,
    },
};

/** Where a button sits on a widget placed at `rect`, in board units. */
export function buttonRect(rect: Rect, action: ButtonAction): Rect {
    const slot =
        SLOTS[action === "start" || action === "pause" ? "primary" : action];
    const sx = rect.width / WIDGET_SIZE.width;
    const sy = rect.height / WIDGET_SIZE.height;
    return {
        x: rect.x + slot.x * sx,
        y: rect.y + ROW_TOP * sy,
        width: slot.width * sx,
        height: BUTTON_H * sy,
    };
}

/**
 * Which button a click at `point` landed on. A running widget was drawn with
 * Pause in the first slot and any other with Start, since every write bakes
 * the state it writes.
 */
export function buttonAt(
    rect: Rect,
    timer: Timer,
    point: { x: number; y: number }
): ButtonAction | null {
    const primary: ButtonAction = timer.state === "running" ? "pause" : "start";
    for (const action of [primary, "add-minute", "reset"] as const) {
        const r = buttonRect(rect, action);
        if (
            point.x >= r.x &&
            point.x <= r.x + r.width &&
            point.y >= r.y &&
            point.y <= r.y + r.height
        )
            return action;
    }
    return null;
}

/** The face page with this timer's meta in it; `<` is escaped so no label can close the script tag. */
export function faceDoc(timer: Timer): string {
    const json = JSON.stringify(toMeta(timer)).replace(/</g, "\\u003c");
    return FACE_HTML.replace("__TIMER_STATE__", () => json);
}

function buttonSchema(
    driverId: string,
    key: string,
    button: WidgetButton
): DomElementSchema {
    const width = button.primary
        ? BUTTON_W.primary
        : BUTTON_W[button.action as "add-minute" | "reset"];
    const fill = button.primary ? ACCENT : CONTROL;
    const hover = !button.enabled
        ? fill
        : button.primary
          ? ACCENT_HOVER
          : CONTROL_HOVER;
    // A box, not a button: Drawdy keeps clicks on buttons inside a component
    // to the page, where its pointer capture hides which one was hit, while a
    // click on anything else reaches drivers as a scene click with its point.
    return {
        type: "box",
        domId: buttonDomId(driverId, key, button.slot),
        styles: {
            width: [width, "px"],
            height: [BUTTON_H, "px"],
            borderRadius: [10, "px"],
            backgroundColor: fill,
            pointerEvents: "auto",
            cursor: button.enabled ? "pointer" : "default",
            hover: { backgroundColor: hover },
        },
        children: [
            {
                type: "row",
                styles: {
                    width: [100, "%"],
                    height: [100, "%"],
                    mainAxisAlignment: "center",
                    crossAxisAlignment: "center",
                },
                children: [
                    {
                        type: "text",
                        child: button.label,
                        styles: {
                            fontSize: [button.primary ? 14 : 13, "px"],
                            fontWeight: button.primary ? "semibold" : "medium",
                            color: button.primary
                                ? ON_ACCENT
                                : button.enabled
                                  ? TEXT
                                  : TEXT_DISABLED,
                        },
                    },
                ],
            },
        ],
    };
}

const round = (n: number): number => Math.round(n * 10_000) / 10_000;

/**
 * The widget is laid out at its base size; a widget someone resized comes
 * back scaled to that size, since a component's own scale can't be set when
 * it is added. Schema styles have no transform-origin, so the translate pins
 * the scaled card to the element's top-left corner.
 */
export function widgetSchema(
    driverId: string,
    timer: Timer,
    now: number,
    size: { width: number; height: number } = WIDGET_SIZE
): DomElementSchema {
    const { width: w, height: h } = WIDGET_SIZE;
    const scaled =
        Math.abs(size.width - w) >= 0.5 || Math.abs(size.height - h) >= 0.5;
    const inner = w - 2 * BORDER_W;
    return {
        type: "column",
        styles: {
            width: [w, "px"],
            height: [h, "px"],
            backgroundColor: SURFACE,
            borderColor: BORDER,
            borderWidth: [BORDER_W, "px"],
            borderRadius: [14, "px"],
            overflow: "hidden",
            ...(scaled
                ? {
                      transform: `translate(${round((size.width - w) / 2)}px, ${round((size.height - h) / 2)}px) scale(${round(size.width / w)}, ${round(size.height / h)})`,
                  }
                : {}),
        },
        children: [
            {
                type: "iframe",
                label: WIDGET_LABEL,
                child: { srcDoc: faceDoc(timer) },
                styles: { width: [inner, "px"], height: [FRAME_H, "px"] },
            },
            {
                type: "row",
                styles: {
                    width: [inner, "px"],
                    height: [h - 2 * BORDER_W - FRAME_H, "px"],
                    padding: [ROW_PAD, "px"],
                    gap: BUTTON_GAP,
                    crossAxisAlignment: "center",
                },
                children: widgetButtons(timer, now).map((b) =>
                    buttonSchema(driverId, timer.id, b)
                ),
            },
        ],
    };
}

export type Placement = { frameId?: string; groupId?: string };

export function widgetElement(
    driverId: string,
    elementId: string,
    timer: Timer,
    rect: Rect,
    now: number,
    place: Placement = {}
): DrawdyElementSchema {
    return {
        type: "component",
        drawdyElementId: elementId,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        ...(place.frameId ? { frameId: place.frameId } : {}),
        ...(place.groupId ? { groupId: place.groupId } : {}),
        meta: { [driverId]: toMeta(timer) },
        schema: widgetSchema(driverId, timer, now, rect),
    };
}

/** A timer the driver knows about: a widget, or a 1.0.0 frame still waiting to become one. */
export type Placed = {
    el: string;
    kind: "widget" | "frame";
    timer: Timer;
    rect: Rect | null;
};

export function sameRect(a: Rect | null, b: Rect | null): boolean {
    if (!a || !b) return false;
    return (
        Math.abs(a.x - b.x) < 0.5 &&
        Math.abs(a.y - b.y) < 0.5 &&
        Math.abs(a.width - b.width) < 0.5 &&
        Math.abs(a.height - b.height) < 0.5
    );
}

export type Replacement = {
    element: DrawdyElementSchema;
    rect: Rect;
    timer: Timer;
    remove: string[];
};

/**
 * A widget's content can't change once it is on the board, so a change is a
 * new widget at the same place and size, then the old one removed. A 1.0.0
 * frame becomes a widget at its top-left corner, and its glyph goes with it.
 * Stacked twins of the same timer, left by two presses that crossed, go too.
 * A timer whose id a copy elsewhere still shares takes a fresh id, so each
 * widget's buttons name only it from then on.
 */
export function planReplacement(p: {
    driverId: string;
    old: Placed;
    at: Rect;
    others: readonly Placed[];
    glyphs: readonly string[];
    next: Timer;
    newId: string;
    now: number;
    place?: Placement;
}): Replacement {
    const rect =
        p.old.kind === "frame"
            ? { x: p.at.x, y: p.at.y, ...WIDGET_SIZE }
            : { x: p.at.x, y: p.at.y, width: p.at.width, height: p.at.height };
    const twins =
        p.old.kind === "widget"
            ? p.others.filter(
                  (o) =>
                      o.kind === "widget" &&
                      o.timer.id === p.old.timer.id &&
                      sameRect(o.rect, rect)
              )
            : [];
    const shared = p.others.some(
        (o) => !twins.includes(o) && o.timer.id === p.next.id
    );
    const timer = shared ? { ...p.next, id: p.newId } : p.next;
    return {
        element: widgetElement(
            p.driverId,
            p.newId,
            timer,
            rect,
            p.now,
            p.place
        ),
        rect,
        timer,
        remove: [p.old.el, ...p.glyphs, ...twins.map((t) => t.el)],
    };
}
