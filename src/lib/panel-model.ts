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

export type PrimaryAction =
    "add" | "start" | "pause" | "resume" | "start-again";

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
    viewOnly: boolean;
};

/** "off" is a control with nothing to do; "view-only" is one held back because this person may only view the board. */
export type ControlState = "on" | "off" | "view-only";

export type PanelControl =
    | "primary"
    | "add"
    | "delete"
    | "add-minute"
    | "reset"
    | "length"
    | "label"
    | "sound";

export const PRIMARY_LABEL: Record<PrimaryAction, string> = {
    add: "Add timer",
    start: "Start",
    pause: "Pause",
    resume: "Resume",
    "start-again": "Start again",
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
            ? "start-again"
            : "start";
}

/** Reset changes nothing on a ready timer that still has its whole length. */
export function canReset(timer: Timer): boolean {
    return !(timer.state === "ready" && timer.remainingMs === timer.durationMs);
}

export function panelModel(
    timer: Timer | null,
    now: number,
    {
        viewOnly = false,
        format = {},
    }: { viewOnly?: boolean; format?: ClockFormat } = {}
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
            viewOnly,
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
        viewOnly,
    };
}

/**
 * On a view-only board every control that would write to it is held back but
 * stays clickable, so a click can say why. The sound choice belongs to this
 * device and stays on.
 */
export function panelControls(
    model: PanelModel
): Record<PanelControl, ControlState> {
    const write = (usable: boolean): ControlState =>
        !usable ? "off" : model.viewOnly ? "view-only" : "on";
    const hasTimer = model.view === "timer";
    return {
        primary: write(true),
        add: write(true),
        delete: write(hasTimer),
        "add-minute": write(hasTimer),
        reset: write(model.canReset),
        length: write(hasTimer && !model.lengthLocked),
        label: write(hasTimer),
        sound: "on",
    };
}
