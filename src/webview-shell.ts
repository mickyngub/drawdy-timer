import {
    EMPTY,
    FOOTER_SECONDARY,
    ICON_BUTTON,
    INPUT,
    LABEL_ROW,
    PRIMARY,
    SCROLL,
    SECONDARY,
    SECTION,
    TRACK,
    TRACK_INPUT,
    TRACK_ITEM,
    WELL,
} from "../webview/lib/classes";
import { ICONS, icon } from "../webview/lib/icons";
import { PRESET_MINUTES } from "./lib/timer-state";
import { PANEL_CSS } from "./panel-css";

const HIDE_WHEN_EMPTY = "group-data-[view=empty]/panel:hidden";

const presets = PRESET_MINUTES.map(
    (m) =>
        `<button type="button" class="${TRACK_ITEM} px-1 tabular-nums" data-minutes="${m}" aria-pressed="false" aria-label="${m} minute${m === 1 ? "" : "s"}">${m}</button>`
).join("");

const sounds = (
    [
        ["off", "Off"],
        ["soft", "Soft"],
        ["bell", "Bell"],
    ] as const
)
    .map(
        ([value, name]) =>
            `<button type="button" class="${TRACK_ITEM}" data-sound="${value}" aria-pressed="false">${name}</button>`
    )
    .join("");

const BODY = `
<main id="panel" class="group/panel flex min-h-0 flex-1 flex-col" data-view="empty" data-audio="locked">
    <div class="${SCROLL}">
        <section id="view-only" role="note" class="hidden items-start gap-2.5 rounded-xl bg-section px-3 py-2.5 group-data-view-only/panel:flex">
            ${icon(ICONS.eye, "mt-px size-4 shrink-0 text-fg-subtle")}
            <div class="flex flex-col gap-0.5">
                <span class="text-label text-fg">View only</span>
                <span class="text-body text-fg-subtle">You can watch timers tick here. Ask for edit access to change them.</span>
            </div>
        </section>
        <section id="empty" class="${EMPTY} group-data-[view=timer]/panel:hidden">
            ${icon(ICONS.timer, "size-5 text-fg-subtle")}
            <span class="text-label text-fg">No timer on this board</span>
            <span class="text-body text-fg-subtle">Add one and everyone here sees the same countdown.</span>
        </section>
        <section class="${SECTION} ${HIDE_WHEN_EMPTY}">
            <div class="${LABEL_ROW}">
                <span id="heading">Timer</span>
                <div class="-my-1.5 -mr-1.5 flex items-center">
                    <button type="button" id="locate" class="${ICON_BUTTON}" aria-label="Show on board" title="Show on board">${icon(ICONS.locate)}</button>
                    <button type="button" id="add" class="${ICON_BUTTON}" aria-label="Add another timer" title="Add another timer">${icon(ICONS.add)}</button>
                    <button type="button" id="delete" class="${ICON_BUTTON}" aria-label="Delete timer" title="Delete timer">${icon(ICONS.delete)}</button>
                </div>
            </div>
            <div class="${WELL} gap-0.5 py-5">
                <div id="display" role="timer" class="text-[44px] leading-[52px] font-semibold tracking-tight tabular-nums text-fg data-urgent:text-warning">5:00</div>
                <div id="status" class="text-body text-fg-subtle"></div>
            </div>
            <p id="many" class="text-body text-fg-subtle" hidden></p>
        </section>
        <section class="${SECTION} ${HIDE_WHEN_EMPTY}">
            <div class="${LABEL_ROW}">
                <span id="length-label">Length</span>
                <span id="length-hint" class="text-fg-subtle">minutes</span>
            </div>
            <div id="presets" role="group" aria-labelledby="length-label" class="${TRACK}">
                ${presets}
                <input id="custom" type="number" min="1" max="99" step="1" inputmode="numeric" placeholder="…" aria-label="Custom length in minutes" class="${TRACK_INPUT}" />
            </div>
        </section>
        <section class="${SECTION} ${HIDE_WHEN_EMPTY}">
            <label for="label" class="${LABEL_ROW}">Label</label>
            <input id="label" type="text" maxlength="40" autocomplete="off" spellcheck="false" placeholder="Silent brainstorm" class="${INPUT}" />
        </section>
        <section class="${SECTION}">
            <div class="${LABEL_ROW}">
                <span id="sound-label">Sound when time is up</span>
                <span class="text-fg-subtle">this device</span>
            </div>
            <div id="sounds" role="group" aria-labelledby="sound-label" class="${TRACK}">${sounds}</div>
            <button type="button" id="unlock" class="${SECONDARY} w-full" hidden>${icon(ICONS.volume)}<span>Click to enable sound</span></button>
        </section>
    </div>
    <footer class="flex shrink-0 flex-col gap-2 border-t border-divider px-4 py-3">
        <p id="notice" role="status" class="text-body text-fg-subtle empty:hidden"></p>
        <div class="flex items-center gap-2">
            <button type="button" id="add-minute" class="${FOOTER_SECONDARY} ${HIDE_WHEN_EMPTY} tabular-nums">+1 min</button>
            <button type="button" id="reset" class="${FOOTER_SECONDARY} ${HIDE_WHEN_EMPTY}">${icon(ICONS.reset)}<span>Reset</span></button>
            <button type="button" id="primary" class="${PRIMARY}" data-action="add"><span id="primary-icon" class="contents">${icon(ICONS.add)}</span><span id="primary-label">Add timer</span></button>
        </div>
    </footer>
</main>
`;

export function shellHtml(js: string): string {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource-variable/google-sans-flex@5.3.2/wght.css" />
<style id="drawdy-styling">:root{/*__DRAWDY_STYLING__*/}</style>
<style>${PANEL_CSS}</style>
</head>
<body class="flex h-screen flex-col overflow-hidden bg-panel font-sans text-body text-fg antialiased">
${BODY}
<script>${js}</script>
</body>
</html>`;
}
