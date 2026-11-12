const BEAT = "motion-safe:urgent:animate-beat motion-safe:flash:animate-beat";
const RING = "fill-none stroke-10";

const BODY = `<main id="face" data-state="ready" class="flex h-full items-center gap-3.5 px-4">
<svg viewBox="0 0 100 100" aria-hidden="true" class="size-21 shrink-0 -rotate-90 ${BEAT}">
<circle cx="50" cy="50" r="43" class="${RING} stroke-track done:stroke-go" />
<circle cx="50" cy="50" r="43" pathLength="100" class="${RING} stroke-go [stroke-dasharray:100] [stroke-dashoffset:calc((1_-_var(--progress,1))*100)] [stroke-linecap:round] [transition:stroke-dashoffset_300ms_linear] urgent:stroke-warn paused:stroke-ink-faint done:hidden" />
</svg>
<div class="flex min-w-0 flex-1 flex-col gap-1">
<p id="label" class="m-0 truncate text-[13px]/[18px] text-ink-muted [font-weight:500] empty:hidden"></p>
<p id="time" role="timer" class="m-0 text-[44px]/none [font-variant-numeric:tabular-nums] [font-weight:600] [letter-spacing:-0.02em] ${BEAT} long:text-[34px] urgent:text-warn done:text-[30px] done:text-go"></p>
<p id="status" class="m-0 text-xs/4 text-ink-muted empty:hidden"></p>
</div>
</main>`;

/** The page drawn inside each timer widget; the driver fills `__TIMER_STATE__` with the timer's meta. */
export function faceHtml(js: string, css: string): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="color-scheme" content="light dark" />
<style>${css}</style>
</head>
<body class="m-0 h-screen overflow-hidden bg-paper font-sans text-ink antialiased select-none">
${BODY}
<script type="application/json" id="timer">__TIMER_STATE__</script>
<script>${js}</script>
</body>
</html>`;
}
