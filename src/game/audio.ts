let ctx: AudioContext | null = null;

export function unlockAudio() {
  if (typeof window === "undefined") return;
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
}

function tone(
  freq: number,
  dur: number,
  type: OscillatorType,
  gain: number,
  delay = 0,
  slide?: number,
) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(40, freq), t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slide), t + dur);
  amp.gain.setValueAtTime(gain, t);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(amp);
  amp.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

export const sfx = {
  ui() {
    tone(620, 0.06, "sine", 0.04);
  },
  step(high: boolean) {
    tone(high ? 190 : 150, 0.045, "sine", 0.018);
  },
  thud() {
    tone(98, 0.09, "triangle", 0.05, 0, 60);
  },
  collect() {
    tone(540, 0.1, "triangle", 0.07, 0, 760);
    tone(820, 0.12, "triangle", 0.05, 0.08, 1080);
  },
  complete() {
    tone(523, 0.12, "triangle", 0.06, 0);
    tone(659, 0.12, "triangle", 0.06, 0.08);
    tone(784, 0.16, "triangle", 0.07, 0.16);
  },
  unlock() {
    tone(523, 0.2, "sine", 0.05, 0);
    tone(659, 0.24, "sine", 0.045, 0.09);
    tone(784, 0.28, "sine", 0.04, 0.18);
    tone(1046, 0.36, "sine", 0.035, 0.28);
  },
  win() {
    tone(392, 0.16, "triangle", 0.07, 0);
    tone(523, 0.16, "triangle", 0.07, 0.1);
    tone(659, 0.22, "triangle", 0.08, 0.2);
    tone(784, 0.32, "triangle", 0.07, 0.32);
  },
};
