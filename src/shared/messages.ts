import type { Timer } from "../lib/timer-state";

export type Sound = "off" | "soft" | "bell";

export const SOUNDS: readonly Sound[] = ["off", "soft", "bell"];

export type PanelAction =
    | { type: "start" }
    | { type: "pause" }
    | { type: "add-minute" }
    | { type: "reset" }
    | { type: "set-duration"; minutes: number }
    | { type: "set-label"; label: string };

export type WebviewToDriver =
    | { type: "ready" }
    | { type: "add" }
    | { type: "act"; id: string; actions: PanelAction[] }
    | { type: "delete"; id: string }
    | { type: "locate"; id: string }
    | { type: "sound"; value: Sound };

export type PanelError = "denied" | "failed";

export type DriverToWebview =
    | { type: "theme"; cssVars: string }
    | {
          type: "state";
          timer: Timer | null;
          count: number;
          sound: Sound;
          viewOnly: boolean;
      }
    | { type: "chime"; sound: Exclude<Sound, "off"> }
    | { type: "error"; reason: PanelError };
