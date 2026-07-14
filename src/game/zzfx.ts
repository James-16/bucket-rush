/**
 * ZzFX micro sound-effect synthesizer — vendored TypeScript port.
 * Original: ZzFX by Frank Force (KilledByAPixel), MIT/public-domain micro library.
 * No audio assets: every sound in the game is synthesized from ~20 numbers.
 */

let audioContext: AudioContext | null = null;
const SAMPLE_RATE = 44_100;
let volume = 0.25;

export function setZzfxVolume(next: number) {
  volume = next;
}

function context(): AudioContext {
  if (!audioContext) audioContext = new AudioContext();
  if (audioContext.state === "suspended") void audioContext.resume();
  return audioContext;
}

/** Call once from a user gesture (Phaser pointerdown) to unlock audio on iOS. */
export function unlockAudio() {
  context();
}

// prettier-ignore
export function zzfx(
  gain = 1, randomness = 0.05, frequency = 220, attack = 0, sustain = 0,
  release = 0.1, shape = 0, shapeCurve = 1, slide = 0, deltaSlide = 0,
  pitchJump = 0, pitchJumpTime = 0, repeatTime = 0, noise = 0, modulation = 0,
  bitCrush = 0, delay = 0, sustainVolume = 1, decay = 0, tremolo = 0,
): void {
  const ctx = context();
  let PI2 = Math.PI * 2,
    sign = (v: number) => (v > 0 ? 1 : -1),
    startSlide = (slide *= (500 * PI2) / SAMPLE_RATE / SAMPLE_RATE),
    startFrequency = (frequency *= ((1 + randomness * 2 * Math.random() - randomness) * PI2) / SAMPLE_RATE),
    b: number[] = [],
    t = 0, tm = 0, i = 0, j = 1, r = 0, c = 0, s = 0, f, length;

  attack = attack * SAMPLE_RATE + 9;
  decay *= SAMPLE_RATE;
  sustain *= SAMPLE_RATE;
  release *= SAMPLE_RATE;
  delay *= SAMPLE_RATE;
  deltaSlide *= (500 * PI2) / SAMPLE_RATE ** 3;
  modulation *= PI2 / SAMPLE_RATE;
  pitchJump *= PI2 / SAMPLE_RATE;
  pitchJumpTime *= SAMPLE_RATE;
  repeatTime = (repeatTime * SAMPLE_RATE) | 0;

  for (length = (attack + decay + sustain + release + delay) | 0; i < length; b[i++] = s) {
    if (!(++c % ((bitCrush * 100) | 0))) {
      s = shape
        ? shape > 1
          ? shape > 2
            ? shape > 3
              ? Math.sin((t % PI2) ** 3)
              : Math.max(Math.min(Math.tan(t), 1), -1)
            : 1 - (((((2 * t) / PI2) % 2) + 2) % 2)
          : 1 - 4 * Math.abs(Math.round(t / PI2) - t / PI2)
        : Math.sin(t);

      s =
        (repeatTime ? 1 - tremolo + tremolo * Math.sin((PI2 * i) / repeatTime) : 1) *
        sign(s) * Math.abs(s) ** shapeCurve *
        gain * volume *
        (i < attack
          ? i / attack
          : i < attack + decay
            ? 1 - ((i - attack) / decay) * (1 - sustainVolume)
            : i < attack + decay + sustain
              ? sustainVolume
              : i < length - delay
                ? ((length - i - delay) / release) * sustainVolume
                : 0);

      s = delay
        ? s / 2 + (delay > i ? 0 : ((i < length - delay ? 1 : (length - i) / delay) * b[(i - delay) | 0]) / 2)
        : s;
    }

    f = (frequency += slide += deltaSlide) * Math.cos(modulation * tm++);
    t += f - f * noise * (1 - (((Math.sin(i) + 1) * 1e9) % 2));

    if (j && ++j > pitchJumpTime) {
      frequency += pitchJump;
      startFrequency += pitchJump;
      j = 0;
    }

    if (repeatTime && !(++r % repeatTime)) {
      frequency = startFrequency;
      slide = startSlide;
      j = j || 1;
    }
  }

  const buffer = ctx.createBuffer(1, b.length, SAMPLE_RATE);
  buffer.getChannelData(0).set(b);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
}

/** The Bucket Rush sound board — every effect is a one-liner. */
export const SFX = {
  tick: () => zzfx(0.3, 0.05, 900, 0, 0.01, 0.03, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.6),
  pour: () => zzfx(0.6, 0.1, 180, 0.02, 0.18, 0.25, 3, 0.6, -2, 0, 0, 0, 0, 2.5),
  coin: () => zzfx(0.7, 0.05, 1046, 0, 0.06, 0.2, 0, 1.6, 0, 0, 220, 0.05),
  cornerShot: () => zzfx(0.8, 0.05, 523, 0.02, 0.12, 0.3, 0, 1.2, 0, 0, 262, 0.08),
  alarm: () => zzfx(0.7, 0.1, 400, 0.05, 0.25, 0.3, 1, 0.5, 0, 0, 0, 0, 0.12),
  boom: () => zzfx(0.6, 0.2, 80, 0.05, 0.25, 0.6, 3, 0.4, 0.5),
  chime: () => zzfx(0.5, 0.05, 1568, 0.01, 0.1, 0.35, 0, 1.4),
};
