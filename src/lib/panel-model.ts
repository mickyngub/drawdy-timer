import { URGENT_SECONDS } from "./face";
import {
    clockTime,
    effective,
    formatRemaining,
    MINUTE_MS,
    PRESET_MINUTES,
    remainingAt,
    type ClockFormat,
    type Timer,
    type TimerState,
} from "./timer-state";

export type PrimaryAction = "add" | "start" | "pause" | "resume" | "restart";

export type PanelModel = {
    view: "empty" | "timer";
    state: TimerState | null;
    display: string;
    status: string;
    urgent: boolean;
    primary: PrimaryAction;
    canReset: boolean;
    lengthLocked: boolean;
    minutes: number;
    preset: number | null;
    label: string;
};

export const PRIMARY_LABEL: Record<PrimaryAction, string> = {
    add: "Add timer",
    start: "Start",
    pause: "Pause",
    resume: "Resume",
    restart: "Start again",
};

/** The one start-or-pause control, as both the panel and the widget on the board show it. */
export function primaryAction(
    state: TimerState
): Exclude<PrimaryAction, "add"> {
    return state === "running"
        ? "pause"
        : state === "paused"
          ? "resume"
          : state === "done"
            ? "restart"
            : "start";
}

/** Reset changes nothing on a ready timer that still has its whole length. */
export function canReset(timer: Timer): boolean {
    return !(timer.state === "ready" && timer.remainingMs === timer.durationMs);
}

export function panelModel(
    timer: Timer | null,
    now: number,
    format: ClockFormat = {}
): PanelModel {
    if (!timer) {
        return {
            view: "empty",
            state: null,
            display: "0:00",
            status: "",
            urgent: false,
            primary: "add",
            canReset: false,
            lengthLocked: true,
            minutes: 5,
            preset: 5,
            label: "",
        };
    }
    const e = effective(timer, now);
    const remaining = remainingAt(e, now);
    const minutes = Math.round(e.durationMs / MINUTE_MS);
    const status =
        e.state === "ready"
            ? "Ready"
            : e.state === "running"
              ? `Running · ends ${clockTime(e.endsAt ?? now, format)}`
              : e.state === "paused"
                ? "Paused"
                : "Time's up";
    return {
        view: "timer",
        state: e.state,
        display: formatRemaining(remaining),
        status,
        urgent:
            e.state === "running" &&
            Math.ceil(remaining / 1000) <= URGENT_SECONDS,
        primary: primaryAction(e.state),
        canReset: canReset(e),
        lengthLocked: e.state === "running" || e.state === "paused",
        minutes,
        preset: (PRESET_MINUTES as readonly number[]).includes(minutes)
            ? minutes
            : null,
        label: e.label,
    };
}
