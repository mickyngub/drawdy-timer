export const MINUTE_MS = 60_000;
export const MIN_MINUTES = 1;
export const MAX_MINUTES = 99;
export const DEFAULT_MINUTES = 5;
export const MAX_LABEL = 40;
export const PRESET_MINUTES = [1, 3, 5, 10, 15, 25] as const;
// Repeated "+1 min" stops here, so a stray click storm can't push a timer into next week.
const MAX_RUN_MS = 12 * 60 * MINUTE_MS;

export type TimerState = "ready" | "running" | "paused" | "done";

const STATES: readonly TimerState[] = ["ready", "running", "paused", "done"];

/**
 * What a timer widget keeps in `meta[driverId]`. `id` names the timer and
 * survives each replacement of its widget; `endsAt` is wall-clock time, set
 * while running and kept once done.
 */
export type Timer = {
    v: 1;
    id: string;
    state: TimerState;
    durationMs: number;
    remainingMs: number;
    endsAt?: number;
    label: string;
};

export type TimerAction =
    | { type: "start" }
    | { type: "pause" }
    | { type: "toggle" }
    | { type: "add-minute" }
    | { type: "reset" }
    | { type: "set-duration"; minutes: number }
    | { type: "set-label"; label: string }
    | { type: "expire" };

export type ClockFormat = { locale?: string; timeZone?: string };

export function clampMinutes(minutes: number): number {
    if (!Number.isFinite(minutes)) return DEFAULT_MINUTES;
    return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(minutes)));
}

export function cleanLabel(label: string): string {
    return label.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL).trim();
}

export function newTimer(
    id: string,
    minutes = DEFAULT_MINUTES,
    label = ""
): Timer {
    const ms = clampMinutes(minutes) * MINUTE_MS;
    return {
        v: 1,
        id,
        state: "ready",
        durationMs: ms,
        remainingMs: ms,
        label: cleanLabel(label),
    };
}

function withoutEnd(timer: Timer): Timer {
    const { endsAt: _, ...rest } = timer;
    return rest;
}

/** Every client reads a running timer whose end has passed as done, without waiting for anyone to write it. */
export function effective(timer: Timer, now: number): Timer {
    if (
        timer.state === "running" &&
        timer.endsAt !== undefined &&
        timer.endsAt <= now
    ) {
        return { ...timer, state: "done", remainingMs: 0 };
    }
    return timer;
}

export function remainingAt(timer: Timer, now: number): number {
    const e = effective(timer, now);
    if (e.state === "done") return 0;
    if (e.state === "running") return Math.max(0, (e.endsAt ?? now) - now);
    return e.remainingMs;
}

function start(e: Timer, now: number): Timer {
    switch (e.state) {
        case "running":
            return e;
        case "done":
            return {
                ...e,
                state: "running",
                remainingMs: e.durationMs,
                endsAt: now + e.durationMs,
            };
        default:
            return { ...e, state: "running", endsAt: now + e.remainingMs };
    }
}

function pause(e: Timer, now: number): Timer {
    if (e.state !== "running") return e;
    return withoutEnd({
        ...e,
        state: "paused",
        remainingMs: Math.max(1, (e.endsAt ?? now) - now),
    });
}

function addMinute(e: Timer, now: number): Timer {
    switch (e.state) {
        case "running":
            return {
                ...e,
                endsAt: Math.min(
                    (e.endsAt ?? now) + MINUTE_MS,
                    now + MAX_RUN_MS
                ),
            };
        case "paused":
            return {
                ...e,
                remainingMs: Math.min(e.remainingMs + MINUTE_MS, MAX_RUN_MS),
            };
        case "ready": {
            const ms = Math.min(
                e.durationMs + MINUTE_MS,
                MAX_MINUTES * MINUTE_MS
            );
            return { ...e, durationMs: ms, remainingMs: ms };
        }
        case "done":
            return {
                ...e,
                state: "running",
                remainingMs: MINUTE_MS,
                endsAt: now + MINUTE_MS,
            };
    }
}

export function reduce(timer: Timer, action: TimerAction, now: number): Timer {
    const e = effective(timer, now);
    switch (action.type) {
        case "start":
            return start(e, now);
        case "pause":
            return pause(e, now);
        case "toggle":
            return e.state === "running" ? pause(e, now) : start(e, now);
        case "add-minute":
            return addMinute(e, now);
        case "reset":
            return withoutEnd({
                ...e,
                state: "ready",
                remainingMs: e.durationMs,
            });
        case "set-duration": {
            // A length change mid-run would stop someone else's countdown, so it waits for Reset.
            if (e.state === "running" || e.state === "paused") return timer;
            const ms = clampMinutes(action.minutes) * MINUTE_MS;
            return withoutEnd({
                ...e,
                state: "ready",
                durationMs: ms,
                remainingMs: ms,
            });
        }
        case "set-label":
            return { ...e, label: cleanLabel(action.label) };
        case "expire":
            return e;
    }
}

export function sameTimer(a: Timer, b: Timer): boolean {
    return (
        a.id === b.id &&
        a.state === b.state &&
        a.durationMs === b.durationMs &&
        a.remainingMs === b.remainingMs &&
        a.endsAt === b.endsAt &&
        a.label === b.label
    );
}

/** Minutes and seconds, rounded up so a fresh 5-minute timer reads 5:00 and the last second reads 0:01. */
export function formatRemaining(ms: number): string {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const seconds = String(total % 60).padStart(2, "0");
    if (total < 100 * 60) return `${Math.floor(total / 60)}:${seconds}`;
    const minutes = String(Math.floor(total / 60) % 60).padStart(2, "0");
    return `${Math.floor(total / 3600)}:${minutes}:${seconds}`;
}

export function clockTime(at: number, format: ClockFormat = {}): string {
    return new Intl.DateTimeFormat(format.locale, {
        hour: "numeric",
        minute: "2-digit",
        timeZone: format.timeZone,
    }).format(at);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const isTime = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);

/** Reads a timer's meta; the stored id names the timer, and `fallbackId` stands in when it is missing. */
export function readTimer(value: unknown, fallbackId: string): Timer | null {
    if (!isRecord(value) || value.v !== 1) return null;
    const { id, state, durationMs, remainingMs, endsAt, label } = value;
    if (!STATES.includes(state as TimerState)) return null;
    if (!isTime(durationMs) || durationMs <= 0) return null;
    if (!isTime(remainingMs) || remainingMs < 0) return null;
    if (endsAt !== undefined && !isTime(endsAt)) return null;
    if (state === "running" && endsAt === undefined) return null;
    return {
        v: 1,
        id: typeof id === "string" && id ? id : fallbackId,
        state: state as TimerState,
        durationMs,
        remainingMs,
        ...(endsAt !== undefined ? { endsAt } : {}),
        label: typeof label === "string" ? cleanLabel(label) : "",
    };
}

export function toMeta(timer: Timer): Record<string, unknown> {
    return {
        v: 1,
        id: timer.id,
        state: timer.state,
        durationMs: timer.durationMs,
        remainingMs: timer.remainingMs,
        ...(timer.endsAt !== undefined ? { endsAt: timer.endsAt } : {}),
        label: timer.label,
    };
}
