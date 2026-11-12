import { formatRemaining, type Timer, type TimerState } from "./timer-state";

export const URGENT_SECONDS = 10;
export const FLASH_MS = 5_000;

export type FaceTimer = Pick<
    Timer,
    "state" | "durationMs" | "remainingMs" | "endsAt" | "label"
>;

export type Face = {
    state: TimerState;
    remainingMs: number;
    text: string;
    /** How much of the ring is left, from 1 (full) to 0 (empty). */
    progress: number;
    /** The last ten seconds of a run. */
    urgent: boolean;
    /** The first five seconds of "Time's up". */
    flash: boolean;
};

/**
 * What the face on the board shows at `now`. Every viewer's iframe runs this
 * on its own clock, so a run reads as done once `endsAt` passes without
 * anyone writing it.
 */
export function faceAt(timer: FaceTimer, now: number): Face {
    const ended =
        timer.state === "done" ||
        (timer.state === "running" &&
            timer.endsAt !== undefined &&
            timer.endsAt <= now);
    const state: TimerState = ended ? "done" : timer.state;
    const remainingMs = ended
        ? 0
        : state === "running"
          ? Math.max(0, (timer.endsAt ?? now) - now)
          : timer.remainingMs;
    const seconds = Math.ceil(remainingMs / 1000);
    const progress =
        timer.durationMs > 0
            ? Math.min(1, Math.max(0, remainingMs / timer.durationMs))
            : 0;
    const sinceEnd =
        ended && timer.endsAt !== undefined ? now - timer.endsAt : Infinity;
    return {
        state,
        remainingMs,
        text: formatRemaining(remainingMs),
        progress,
        urgent: state === "running" && seconds <= URGENT_SECONDS,
        flash: sinceEnd >= 0 && sinceEnd < FLASH_MS,
    };
}
