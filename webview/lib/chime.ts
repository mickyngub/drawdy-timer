export type ChimeKind = "soft" | "bell";

/** One sine partial: when it starts (s), its peak gain, and how long it takes to die away (s). */
export type Tone = { freq: number; at: number; gain: number; decay: number };

// Strike ratios of a church-style bell: hum, prime, minor third, fifth, octave and the upper partials.
const BELL_PARTIALS: [ratio: number, gain: number, decay: number][] = [
    [0.5, 0.09, 2.8],
    [1, 0.2, 2.6],
    [1.19, 0.07, 1.8],
    [1.5, 0.06, 1.5],
    [2, 0.08, 1.2],
    [2.51, 0.04, 0.9],
    [3.01, 0.03, 0.7],
    [4.1, 0.02, 0.5],
];
const BELL_BASE_HZ = 587.33;
const BELL_STRIKES = [0, 1.1];

export function chimeTones(kind: ChimeKind): Tone[] {
    if (kind === "soft") {
        return [
            { freq: 783.99, at: 0, gain: 0.14, decay: 1.6 },
            { freq: 1567.98, at: 0, gain: 0.025, decay: 0.8 },
            { freq: 659.25, at: 0.42, gain: 0.14, decay: 2 },
            { freq: 1318.51, at: 0.42, gain: 0.025, decay: 0.9 },
        ];
    }
    return BELL_STRIKES.flatMap((at) =>
        BELL_PARTIALS.map(([ratio, gain, decay]) => ({
            freq: BELL_BASE_HZ * ratio,
            at,
            gain,
            decay,
        }))
    );
}

export function chimeLength(kind: ChimeKind): number {
    return Math.max(...chimeTones(kind).map((t) => t.at + t.decay));
}

export function playChime(ctx: AudioContext, kind: ChimeKind): void {
    const t0 = ctx.currentTime + 0.02;
    const master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);
    for (const tone of chimeTones(kind)) {
        const start = t0 + tone.at;
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = tone.freq;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(tone.gain, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.decay);
        osc.connect(gain).connect(master);
        osc.start(start);
        osc.stop(start + tone.decay + 0.05);
    }
}
