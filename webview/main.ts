import type { DrawdyWebviewApi } from "@drawdy/driver-protocol";
import {
    panelControls,
    panelModel,
    PRIMARY_LABEL,
    type ControlState,
    type PanelControl,
    type PrimaryAction,
} from "../src/lib/panel-model";
import { clampMinutes, cleanLabel, type Timer } from "../src/lib/timer-state";
import type {
    DriverToWebview,
    PanelAction,
    PanelError,
    Sound,
    WebviewToDriver,
} from "../src/shared/messages";
import { playChime, type ChimeKind } from "./lib/chime";
import { ICONS, icon } from "./lib/icons";

declare function acquireDrawdyApi(): DrawdyWebviewApi;

const TICK_MS = 200;
const NOTICE_MS = 4000;
const ERRORS: Record<PanelError, string> = {
    denied: "Timer needs the board permission. Allow it under Manage permissions.",
    failed: "The board didn't take that change. Try again.",
};

const api = acquireDrawdyApi();
const $ = <T extends HTMLElement>(id: string) =>
    document.getElementById(id) as T;

const panel = $<HTMLElement>("panel");
const display = $<HTMLElement>("display");
const status = $<HTMLElement>("status");
const many = $<HTMLElement>("many");
const custom = $<HTMLInputElement>("custom");
const labelInput = $<HTMLInputElement>("label");
const unlockButton = $<HTMLButtonElement>("unlock");
const primary = $<HTMLButtonElement>("primary");
const primaryIcon = $<HTMLElement>("primary-icon");
const primaryLabel = $<HTMLElement>("primary-label");
const addMinute = $<HTMLButtonElement>("add-minute");
const reset = $<HTMLButtonElement>("reset");
const notice = $<HTMLElement>("notice");
const presetButtons = [
    ...document.querySelectorAll<HTMLButtonElement>("[data-minutes]"),
];
const soundButtons = [
    ...document.querySelectorAll<HTMLButtonElement>("[data-sound]"),
];
const controls: Record<PanelControl, (HTMLButtonElement | HTMLInputElement)[]> =
    {
        primary: [primary],
        add: [$<HTMLButtonElement>("add")],
        delete: [$<HTMLButtonElement>("delete")],
        "add-minute": [addMinute],
        reset: [reset],
        length: [...presetButtons, custom],
        label: [labelInput],
        sound: soundButtons,
    };

let timer: Timer | null = null;
let count = 0;
let sound: Sound = "soft";
let viewOnly = false;
let ticker: ReturnType<typeof setInterval> | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
let audio: AudioContext | null = null;

const send = (message: WebviewToDriver) => api.postMessage(message);

function act(...actions: PanelAction[]): void {
    if (timer) send({ type: "act", id: timer.id, actions });
}

function audioContext(): AudioContext | null {
    if (audio) return audio;
    const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
    if (!Ctor) return null;
    try {
        audio = new Ctor();
    } catch {
        return null;
    }
    audio.addEventListener("statechange", renderAudio);
    return audio;
}

function renderAudio(): void {
    const ready = audio?.state === "running";
    panel.dataset.audio = ready ? "ready" : "locked";
    unlockButton.hidden = ready || sound === "off";
}

/** A click inside the panel is what browsers need before it may make sound; the panel stays alive when closed, so later chimes can play. */
async function unlockAudio(): Promise<boolean> {
    const ctx = audioContext();
    if (!ctx) return false;
    if (ctx.state !== "running") await ctx.resume().catch(() => undefined);
    renderAudio();
    return ctx.state === "running";
}

function chime(kind: ChimeKind): void {
    if (audio?.state === "running") playChime(audio, kind);
}

function showNotice(text: string): void {
    notice.textContent = text;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
        notice.textContent = "";
    }, NOTICE_MS);
}

function setPrimary(action: PrimaryAction): void {
    if (primary.dataset.action === action) return;
    primary.dataset.action = action;
    primaryLabel.textContent = PRIMARY_LABEL[action];
    primaryIcon.innerHTML =
        action === "pause"
            ? icon(ICONS.pause)
            : action === "add"
              ? icon(ICONS.add)
              : icon(ICONS.play);
}

/** A view-only control stays focusable and clickable, so the driver can say why it did nothing. */
function setControl(
    el: HTMLButtonElement | HTMLInputElement,
    state: ControlState
): void {
    el.disabled = state === "off";
    if (state === "view-only") el.setAttribute("aria-disabled", "true");
    else el.removeAttribute("aria-disabled");
    if (el instanceof HTMLInputElement) el.readOnly = state === "view-only";
}

function render(): void {
    const model = panelModel(timer, Date.now(), { viewOnly });
    panel.dataset.view = model.view;
    panel.toggleAttribute("data-view-only", model.viewOnly);
    const states = panelControls(model);
    for (const [name, elements] of Object.entries(controls))
        for (const el of elements) setControl(el, states[name as PanelControl]);
    if (model.state) panel.dataset.state = model.state;
    else delete panel.dataset.state;
    display.textContent = model.display;
    display.toggleAttribute("data-urgent", model.urgent);
    status.textContent = model.status;
    setPrimary(model.primary);
    many.hidden = count < 2;
    many.textContent = `${count} timers on this board. Select one to control it here.`;

    for (const button of presetButtons)
        button.setAttribute(
            "aria-pressed",
            String(Number(button.dataset.minutes) === model.preset)
        );
    custom.toggleAttribute(
        "data-active",
        model.view === "timer" && model.preset === null
    );
    if (document.activeElement !== custom)
        custom.value = model.preset === null ? String(model.minutes) : "";
    $<HTMLElement>("length-hint").textContent =
        model.lengthLocked && !model.viewOnly ? "Reset to change" : "minutes";
    if (document.activeElement !== labelInput) labelInput.value = model.label;

    for (const button of soundButtons)
        button.setAttribute(
            "aria-pressed",
            String(button.dataset.sound === sound)
        );
    renderAudio();

    const running = model.state === "running";
    if (running && !ticker) ticker = setInterval(render, TICK_MS);
    if (!running && ticker) {
        clearInterval(ticker);
        ticker = null;
    }
}

/** A label typed but not yet committed goes with the action, so Start with a new label is still one undo step. */
function pendingLabel(): PanelAction[] {
    if (!timer) return [];
    const typed = cleanLabel(labelInput.value);
    return typed === timer.label ? [] : [{ type: "set-label", label: typed }];
}

primary.addEventListener("click", () => {
    switch (primary.dataset.action as PrimaryAction) {
        case "add":
            send({ type: "add" });
            return;
        case "pause":
            act({ type: "pause" });
            return;
        default:
            act(...pendingLabel(), { type: "start" });
    }
});
addMinute.addEventListener("click", () => act({ type: "add-minute" }));
reset.addEventListener("click", () => act({ type: "reset" }));
$("add").addEventListener("click", () => send({ type: "add" }));
$("delete").addEventListener("click", () => {
    if (timer) send({ type: "delete", id: timer.id });
});
$("locate").addEventListener("click", () => {
    if (timer) send({ type: "locate", id: timer.id });
});

for (const button of presetButtons) {
    button.addEventListener("click", () =>
        act({ type: "set-duration", minutes: Number(button.dataset.minutes) })
    );
}
custom.addEventListener("change", () => {
    const minutes = Number(custom.value);
    if (!custom.value || !Number.isFinite(minutes)) {
        render();
        return;
    }
    custom.value = String(clampMinutes(minutes));
    act({ type: "set-duration", minutes: clampMinutes(minutes) });
});
custom.addEventListener("keydown", (e) => {
    if (e.key === "Enter") custom.blur();
});
labelInput.addEventListener("change", () => {
    const actions = pendingLabel();
    if (actions.length) act(...actions);
});
labelInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") labelInput.blur();
});

for (const button of soundButtons) {
    button.addEventListener("click", async () => {
        const value = button.dataset.sound as Sound;
        sound = value;
        send({ type: "sound", value });
        render();
        if (value !== "off" && (await unlockAudio())) chime(value);
    });
}
unlockButton.addEventListener("click", async () => {
    if (sound !== "off" && (await unlockAudio())) chime(sound);
});
document.addEventListener("pointerdown", () => void unlockAudio(), {
    capture: true,
});

api.onMessage((raw) => {
    const message = raw as DriverToWebview;
    switch (message?.type) {
        case "theme": {
            const style = document.getElementById("drawdy-styling");
            if (style) style.textContent = `:root{${message.cssVars}}`;
            return;
        }
        case "state":
            timer = message.timer;
            count = message.count;
            sound = message.sound;
            viewOnly = message.viewOnly === true;
            render();
            return;
        case "chime":
            chime(message.sound);
            return;
        case "error":
            showNotice(ERRORS[message.reason] ?? ERRORS.failed);
            return;
        default:
            return;
    }
});

audioContext();
render();
send({ type: "ready" });
