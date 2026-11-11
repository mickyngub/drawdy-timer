// Class strings from the house panel recipes (drawdy-listing references/panel-ui.md).
const RING =
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export const SCROLL =
    "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-3 pb-4 [scrollbar-width:thin] [scrollbar-color:var(--color-line-strong)_transparent]";

export const SECTION = "flex flex-col gap-2";

export const LABEL_ROW =
    "flex items-center justify-between text-label text-fg-muted";

export const WELL =
    "grid place-items-center overflow-hidden rounded-xl bg-section";

export const EMPTY =
    "flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong px-4 py-6 text-center";

export const TRACK = "flex h-8 gap-0.5 rounded-lg bg-control-subtle p-0.5";

export const TRACK_ITEM = `flex-1 truncate rounded-md px-2 text-label text-fg-subtle transition-colors hover:text-fg aria-pressed:bg-control aria-pressed:text-fg disabled:cursor-not-allowed disabled:text-fg-disabled disabled:hover:text-fg-disabled ${RING}`;

export const TRACK_INPUT = `w-12 min-w-0 shrink-0 appearance-none rounded-md bg-transparent px-1 text-center text-label text-fg-subtle tabular-nums [appearance:textfield] placeholder:text-fg-disabled transition-colors hover:text-fg focus:bg-control focus:text-fg focus:outline-none focus:ring-1 focus:ring-ring data-active:bg-control data-active:text-fg disabled:cursor-not-allowed disabled:text-fg-disabled [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`;

export const INPUT =
    "h-9 w-full rounded-xl border border-line bg-subtle px-3 text-[13px] leading-5 text-fg placeholder:text-fg-disabled transition-colors hover:bg-hover focus:border-line-strong focus:bg-active focus:outline-none focus:ring-1 focus:ring-ring";

export const ICON_BUTTON = `inline-grid size-7.5 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-hover hover:text-fg active:bg-pressed ${RING}`;

export const SECONDARY = `inline-flex h-7.5 items-center justify-center gap-1 rounded-lg border border-line bg-subtle px-2.5 text-label text-fg-muted transition-colors hover:bg-hover hover:text-fg active:bg-pressed disabled:cursor-not-allowed disabled:text-fg-disabled disabled:hover:bg-subtle ${RING}`;

export const FOOTER_SECONDARY = `inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-xl border border-line bg-subtle px-3 text-label-md text-fg-muted transition-colors hover:bg-hover hover:text-fg active:bg-pressed disabled:cursor-not-allowed disabled:text-fg-disabled disabled:hover:bg-subtle ${RING}`;

export const PRIMARY =
    "inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent px-3 text-label-md text-on-accent transition-colors hover:bg-accent-hover active:bg-accent-pressed disabled:cursor-not-allowed disabled:bg-disabled disabled:text-fg-disabled focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-panel";
