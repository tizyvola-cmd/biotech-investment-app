/** Beep when a new Basic Request Access lands (owner Access banner). */
export function playAccessRequestBeep(): void {
  try {
    type WindowWithAudio = Window & {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const w = window as WindowWithAudio;
    const Ctx = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const playTone = (freq: number, when: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + when);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + when);
      gain.gain.exponentialRampToValueAtTime(0.28, ctx.currentTime + when + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + when + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + when);
      osc.stop(ctx.currentTime + when + dur + 0.05);
    };
    // Distinct two-tone alert (not the weekly-full chime).
    playTone(880, 0, 0.16);
    playTone(1175, 0.18, 0.22);
    playTone(880, 0.42, 0.28);
    setTimeout(() => {
      void ctx.close();
    }, 1200);
  } catch {
    /* audio unavailable */
  }
}
