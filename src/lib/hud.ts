import type { DomElementSchema } from "@drawdy/driver-protocol";
import { URGENT_SECONDS } from "./face";
import type { Rect } from "./free-spot";
import { effective, formatRemaining, type Timer } from "./timer-state";

export const HUD_WIDTH = 560;
export const HUD_HEIGHT = 40;
// Below Drawdy's 64 px top toolbar.
export const HUD_TOP = 76;
const MAX_HUD_LABEL = 28;
export const VIEW_ONLY_NOTICE =
    "View only: ask for edit access to change timers";
// Below this many screen pixels across, a widget's digits are too small to read, so the pill stands in.
export const MIN_READABLE_PX = 120;

type TimerHud =
    | {
          kind: "running";
          id: string;
          time: string;
          label: string;
          urgent: boolean;
          pulse: boolean;
      }
    | { kind: "done"; id: string; label: string };

export type HudView = TimerHud | { kind: "notice" };

export type Theme = "light" | "dark";

/** The visible part of the board in canvas units, and the zoom it is drawn at. */
export type View = { rect: Rect; zoom: number };

/** A widget counts as on screen when at least half of it is visible and it is big enough to read. */
export function onScreen(rect: Rect | null, view: View | null): boolean {
    if (!rect || !view || rect.width <= 0 || rect.height <= 0) return false;
    const v = view.rect;
    const w =
        Math.min(rect.x + rect.width, v.x + v.width) - Math.max(rect.x, v.x);
    const h =
        Math.min(rect.y + rect.height, v.y + v.height) - Math.max(rect.y, v.y);
    if (w <= 0 || h <= 0) return false;
    return (
        (w * h) / (rect.width * rect.height) >= 0.5 &&
        rect.width * view.zoom >= MIN_READABLE_PX
    );
}

const secondsLeft = (ms: number): number => Math.max(0, Math.ceil(ms / 1000));

/** One pill for the whole board: a "Time's up" moment wins for its 5 seconds, then the running timer that ends soonest. */
export function pickHud(
    timers: Iterable<Timer>,
    now: number,
    flashes: ReadonlyMap<string, number>
): TimerHud | null {
    let flash: { timer: Timer; until: number } | null = null;
    let running: Timer | null = null;
    for (const timer of timers) {
        const e = effective(timer, now);
        const until = flashes.get(e.id);
        if (e.state === "done" && until !== undefined && until > now) {
            if (!flash || until >= flash.until) flash = { timer: e, until };
        } else if (e.state === "running") {
            const ends = e.endsAt ?? now;
            const best = running?.endsAt ?? Infinity;
            if (ends < best || (ends === best && e.id < (running?.id ?? "")))
                running = e;
        }
    }
    if (flash)
        return { kind: "done", id: flash.timer.id, label: flash.timer.label };
    if (running) {
        const left = secondsLeft((running.endsAt ?? now) - now);
        const urgent = left <= URGENT_SECONDS;
        return {
            kind: "running",
            id: running.id,
            time: formatRemaining(left * 1000),
            label: running.label,
            urgent,
            pulse: urgent && left % 2 === 1,
        };
    }
    return null;
}

/** The next moment any running timer's shown second changes or ends, or a "Time's up" moment fades. */
export function nextWake(
    timers: Iterable<Timer>,
    now: number,
    flashes: ReadonlyMap<string, number>
): number | null {
    let at = Infinity;
    for (const timer of timers) {
        const e = effective(timer, now);
        if (e.state !== "running" || e.endsAt === undefined) continue;
        const remaining = e.endsAt - now;
        const shown = Math.ceil(remaining / 1000);
        at = Math.min(at, e.endsAt - (shown - 1) * 1000);
    }
    for (const until of flashes.values()) {
        if (until > now) at = Math.min(at, until);
    }
    return Number.isFinite(at) ? at : null;
}

export function hudPosition(windowWidth: number): { x: number; y: number } {
    return {
        x: Math.max(0, Math.round((windowWidth - HUD_WIDTH) / 2)),
        y: HUD_TOP,
    };
}

const ICON_PATHS = {
    timer: "M17.6177 5.9681L19.0711 4.51472L20.4853 5.92893L19.0319 7.38231C20.2635 8.92199 21 10.875 21 13C21 17.9706 16.9706 22 12 22C7.02944 22 3 17.9706 3 13C3 8.02944 7.02944 4 12 4C14.125 4 16.078 4.73647 17.6177 5.9681ZM12 20C15.866 20 19 16.866 19 13C19 9.13401 15.866 6 12 6C8.13401 6 5 9.13401 5 13C5 16.866 8.13401 20 12 20ZM11 8H13V14H11V8ZM8 1H16V3H8V1Z",
    eye: "M12.0003 3C17.3924 3 21.8784 6.87976 22.8189 12C21.8784 17.1202 17.3924 21 12.0003 21C6.60812 21 2.12215 17.1202 1.18164 12C2.12215 6.87976 6.60812 3 12.0003 3ZM12.0003 19C16.2359 19 19.8603 16.052 20.7777 12C19.8603 7.94803 16.2359 5 12.0003 5C7.7646 5 4.14022 7.94803 3.22278 12C4.14022 16.052 7.7646 19 12.0003 19ZM12.0003 16.5C9.51498 16.5 7.50026 14.4853 7.50026 12C7.50026 9.51472 9.51498 7.5 12.0003 7.5C14.4855 7.5 16.5003 9.51472 16.5003 12C16.5003 14.4853 14.4855 16.5 12.0003 16.5ZM12.0003 14.5C13.381 14.5 14.5003 13.3807 14.5003 12C14.5003 10.6193 13.381 9.5 12.0003 9.5C10.6196 9.5 9.50026 10.6193 9.50026 12C9.50026 13.3807 10.6196 14.5 12.0003 14.5Z",
    check: "M9.9997 15.1709L19.1921 5.97852L20.6063 7.39273L9.9997 17.9993L3.63574 11.6354L5.04996 10.2212L9.9997 15.1709Z",
} as const;

// Image elements can't inherit currentColor, so the glyph takes the theme's text colour directly.
const ICON_FILL: Record<Theme, string> = {
    dark: "rgba(255,255,255,0.95)",
    light: "rgba(0,0,0,0.9)",
};

const TEXT = "var(--text-primary, rgb(255 255 255 / 0.95))";
const TEXT_MUTED = "var(--text-secondary, rgb(255 255 255 / 0.7))";
const WARNING = "var(--status-warning-foreground, #eab308)";
const PANEL = "var(--surface-panel, #1f1f23)";
const BORDER = "var(--border-medium, rgb(255 255 255 / 0.08))";
const PULSE_FILL = `color-mix(in srgb, ${WARNING} 18%, ${PANEL})`;
const DONE_FILL = `color-mix(in srgb, var(--accent-default, #c5f601) 22%, ${PANEL})`;

function iconSchema(path: string, theme: Theme): DomElementSchema {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${ICON_FILL[theme]}"><path d="${path}"/></svg>`;
    return {
        type: "image",
        child: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
        styles: { width: [16, "px"], height: [16, "px"] },
    };
}

const DIGIT_WIDTH = 10;
const COLON_WIDTH = 5;

/** Every character sits in a fixed-width cell, so the digits never shift as they count down. */
function timeSchema(
    driverId: string,
    time: string,
    color: string
): DomElementSchema {
    return {
        type: "row",
        domId: `${driverId}:hud-time`,
        styles: { gap: 0, crossAxisAlignment: "center" },
        children: [...time].map((char) => ({
            type: "text",
            child: char,
            styles: {
                width: [char === ":" ? COLON_WIDTH : DIGIT_WIDTH, "px"],
                fontSize: [16, "px"],
                fontWeight: "semibold",
                textAlign: "center",
                color,
            },
        })),
    };
}

export function shortLabel(label: string): string {
    return label.length > MAX_HUD_LABEL
        ? `${label.slice(0, MAX_HUD_LABEL - 1).trimEnd()}…`
        : label;
}

function labelSchema(driverId: string, label: string): DomElementSchema[] {
    if (!label) return [];
    return [
        {
            type: "box",
            styles: {
                width: [1, "px"],
                height: [14, "px"],
                backgroundColor: BORDER,
            },
        },
        {
            type: "text",
            domId: `${driverId}:hud-label`,
            child: shortLabel(label),
            styles: {
                fontSize: [13, "px"],
                fontWeight: "medium",
                color: TEXT_MUTED,
            },
        },
    ];
}

function spacer(width: number): DomElementSchema {
    return { type: "box", styles: { width: [width, "px"], height: [1, "px"] } };
}

export function hudSchema(
    view: HudView,
    theme: Theme,
    driverId: string
): DomElementSchema {
    const content: DomElementSchema[] =
        view.kind === "notice"
            ? [
                  iconSchema(ICON_PATHS.eye, theme),
                  {
                      type: "text",
                      domId: `${driverId}:hud-notice`,
                      child: VIEW_ONLY_NOTICE,
                      styles: {
                          fontSize: [13, "px"],
                          fontWeight: "medium",
                          color: TEXT,
                      },
                  },
              ]
            : view.kind === "done"
              ? [
                    iconSchema(ICON_PATHS.check, theme),
                    {
                        type: "text",
                        domId: `${driverId}:hud-done`,
                        child: "Time's up",
                        styles: {
                            fontSize: [14, "px"],
                            fontWeight: "semibold",
                            color: TEXT,
                        },
                    },
                ]
              : [
                    iconSchema(ICON_PATHS.timer, theme),
                    timeSchema(
                        driverId,
                        view.time,
                        view.urgent ? WARNING : TEXT
                    ),
                ];
    const fill =
        view.kind === "done"
            ? DONE_FILL
            : view.kind === "running" && view.pulse
              ? PULSE_FILL
              : PANEL;
    return {
        type: "row",
        domId: `${driverId}:hud`,
        styles: {
            width: [HUD_WIDTH, "px"],
            height: [HUD_HEIGHT, "px"],
            mainAxisAlignment: "center",
            crossAxisAlignment: "center",
            pointerEvents: "none",
        },
        children: [
            {
                type: "row",
                domId: `${driverId}:hud-pill`,
                styles: {
                    height: [36, "px"],
                    gap: 8,
                    crossAxisAlignment: "center",
                    backgroundColor: fill,
                    borderColor: BORDER,
                    borderWidth: [1, "px"],
                    borderRadius: [18, "px"],
                    pointerEvents: "none",
                },
                children: [
                    spacer(4),
                    ...content,
                    ...labelSchema(
                        driverId,
                        view.kind === "notice" ? "" : view.label
                    ),
                    spacer(6),
                ],
            },
        ],
    };
}
