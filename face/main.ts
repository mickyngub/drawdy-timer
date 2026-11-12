import { faceAt, type FaceTimer } from "../src/lib/face";
import type { TimerState } from "../src/lib/timer-state";

const TICK_MS = 250;
const STATUS: Record<TimerState, string> = {
    ready: "Ready",
    running: "Running",
    paused: "Paused",
    done: "",
};

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const face = $("face");
const time = $("time");
const status = $("status");
const timer = JSON.parse($("timer").textContent || "{}") as FaceTimer;
$("label").textContent = timer.label || "";
const clock = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
});

function draw(): void {
    const f = faceAt(timer, Date.now());
    const text = f.state === "done" ? "Time's up" : f.text;
    face.dataset.state = f.state;
    face.toggleAttribute("data-urgent", f.urgent);
    face.toggleAttribute("data-flash", f.flash);
    face.toggleAttribute("data-long", f.state !== "done" && text.length > 5);
    face.style.setProperty("--progress", String(f.progress));
    if (time.textContent !== text) time.textContent = text;
    status.textContent =
        f.state === "running" && timer.endsAt !== undefined
            ? `${STATUS.running} · ends ${clock.format(timer.endsAt)}`
            : STATUS[f.state];
}

draw();
setInterval(draw, TICK_MS);
