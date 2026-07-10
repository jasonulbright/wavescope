import { test, expect, describe } from "bun:test";
import { analyzeFrame, newAnalysisState } from "../analyze";
import { bin } from "../modes/util";

/**
 * The analysis contract, asserted against the SAME constants the native app
 * unit-tests in `src/tests.cpp`, so the two implementations can never silently
 * drift. Web reads the browser AnalyserNode's byte output; these tests feed
 * synthetic byte arrays straight into the shared analyzeFrame() transform.
 */

const FFT_LEN = 1024;
const WAVE_LEN = 2048;

/** A frequency-byte array with energy 255 only in [loHz, hiHz] at a rate. */
function fftWithBand(loHz: number, hiHz: number, sampleRate: number): Uint8Array {
  const fft = new Uint8Array(FFT_LEN);
  const hzPerBin = sampleRate / 2 / FFT_LEN;
  const a = Math.max(0, Math.floor(loHz / hzPerBin));
  const b = Math.min(FFT_LEN - 1, Math.ceil(hiHz / hzPerBin));
  for (let i = a; i <= b; i++) fft[i] = 255;
  return fft;
}

/** A flat (silent) time-domain array centered at 128. */
function silentWave(): Uint8Array {
  return new Uint8Array(WAVE_LEN).fill(128);
}

describe("band split by Hz (not bin index)", () => {
  for (const sr of [48000, 44100]) {
    test(`bass-only energy moves bass, not mid/treble @ ${sr}Hz`, () => {
      const fft = fftWithBand(20, 250, sr);
      const f = analyzeFrame(fft, silentWave(), sr, 0.1, 0.016, newAnalysisState());
      expect(f.bass).toBeGreaterThan(0.9);
      expect(f.mid).toBeLessThan(0.05);
      expect(f.treble).toBeLessThan(0.05);
    });

    test(`treble-only energy moves treble, not bass @ ${sr}Hz`, () => {
      const fft = fftWithBand(4000, 16000, sr);
      const f = analyzeFrame(fft, silentWave(), sr, 0.1, 0.016, newAnalysisState());
      expect(f.treble).toBeGreaterThan(0.9);
      expect(f.bass).toBeLessThan(0.05);
    });
  }
});

describe("level = quarter-decimated RMS, smoothed 0.2", () => {
  test("full-scale square wave converges toward RMS ~1", () => {
    // Alternating 0/255 → (s-128)/128 = ±1 → RMS 1.0. Smoothing +=(rms-l)*0.2
    // converges asymptotically; 60 frames gets within a few percent.
    const wave = new Uint8Array(WAVE_LEN);
    for (let i = 0; i < WAVE_LEN; i++) wave[i] = i % 2 === 0 ? 255 : 0;
    const fft = new Uint8Array(FFT_LEN);
    const st = newAnalysisState();
    let f = analyzeFrame(fft, wave, 48000, 0, 0.016, st);
    for (let i = 1; i < 60; i++) f = analyzeFrame(fft, wave, 48000, 0.016 * i, 0.016, st);
    // (255-128)/128 = 0.9922, so RMS target ≈ 0.992.
    expect(f.level).toBeGreaterThan(0.9);
    expect(f.level).toBeLessThanOrEqual(1.0);
  });

  test("silence keeps level at ~0", () => {
    const f = analyzeFrame(new Uint8Array(FFT_LEN), silentWave(), 48000, 0, 0.016, newAnalysisState());
    expect(f.level).toBeLessThan(0.01);
  });
});

describe("beat envelope: 1.35x gate / 0.08 floor / e^-6dt decay", () => {
  test("charges on a bass jump, then decays like e^(-6*dt)", () => {
    const st = newAnalysisState();
    const quiet = fftWithBand(20, 250, 48000).map((v) => Math.round(v * 0.02)) as unknown as Uint8Array;
    const loud = fftWithBand(20, 250, 48000); // full bass

    // Settle on the quiet floor so bassAvg is low.
    let now = 0;
    let f = analyzeFrame(quiet, silentWave(), 48000, now, 0.016, st);
    for (let i = 0; i < 200; i++) {
      now += 0.016;
      f = analyzeFrame(quiet, silentWave(), 48000, now, 0.016, st);
    }
    expect(f.beat).toBeLessThan(0.05); // idle

    // A sudden loud bass frame exceeds 1.35x the average and the 0.08 floor.
    now += 0.016;
    f = analyzeFrame(loud, silentWave(), 48000, now, 0.016, st);
    expect(f.beat).toBeGreaterThan(0.8); // charged

    // Drop back below the gate and measure pure decay: with bass now under
    // 1.35x the (now-high) average, the envelope only decays, by e^(-6*dt) per
    // frame. (Holding loud would keep re-firing the gate until the average
    // caught up — that tests the gate, not the decay constant.)
    const before = f.beat;
    const dt = 0.016;
    const N = 20;
    for (let i = 0; i < N; i++) {
      now += dt;
      f = analyzeFrame(quiet, silentWave(), 48000, now, dt, st);
    }
    const expected = before * Math.exp(-6 * dt * N);
    expect(f.beat).toBeCloseTo(expected, 2);
  });

  test("a bass floor below 0.08 never triggers a beat", () => {
    // Tiny constant bass (below the 0.08 floor) must not charge the envelope
    // even though it technically exceeds a near-zero moving average.
    const st = newAnalysisState();
    const tiny = fftWithBand(20, 250, 48000).map((v) => Math.round(v * 0.05)) as unknown as Uint8Array;
    let now = 0;
    let f = analyzeFrame(tiny, silentWave(), 48000, now, 0.016, st);
    for (let i = 0; i < 50; i++) {
      now += 0.016;
      f = analyzeFrame(tiny, silentWave(), 48000, now, 0.016, st);
    }
    expect(f.beat).toBeLessThan(0.05);
  });
});

describe("bin() log-frequency mapping matches the native BinLog", () => {
  test("matches floor(pow(1023, pos*0.92+0.08))", () => {
    const fft = new Uint8Array(FFT_LEN);
    for (let i = 0; i < FFT_LEN; i++) fft[i] = i % 256; // recoverable pattern
    for (const pos of [0, 0.25, 0.5, 0.75, 1]) {
      const idx = Math.min(
        FFT_LEN - 1,
        Math.floor(Math.pow(FFT_LEN - 1, pos * 0.92 + 0.08)),
      );
      expect(bin(fft, pos)).toBeCloseTo(fft[idx] / 255, 10);
    }
  });

  test("clamps out-of-range positions", () => {
    const fft = new Uint8Array(FFT_LEN).fill(128);
    expect(bin(fft, -1)).toBe(bin(fft, 0));
    expect(bin(fft, 2)).toBe(fft[FFT_LEN - 1] / 255);
  });
});
