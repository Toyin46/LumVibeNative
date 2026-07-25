// ═══════════════════════════════════════════════════════════
// dynamics.ts — Noise gate + peak normalize
// src/utils/dsp/dynamics.ts
// These run as a plain pass over the already-rendered Float32Array PCM
// data — no audio graph node needed, since the whole clip is available
// in memory at once (this is a bake step, not a live stream).
// ═══════════════════════════════════════════════════════════

/**
* Soft noise gate with attack/release smoothing (avoids clicks that a
* hard on/off gate would cause). Technically a downward expander below
* the threshold, which is what most "noise gate" UI controls actually do.
*/
export function applyNoiseGate(
    channels:    Float32Array[],
    sampleRate:  number,
    thresholdDb = -45,
    attackMs    = 3,
    releaseMs   = 80,
  ): void {
    const threshold    = Math.pow(10, thresholdDb / 20);
    const attackCoeff  = Math.exp(-1 / (sampleRate * (attackMs / 1000)));
    const releaseCoeff = Math.exp(-1 / (sampleRate * (releaseMs / 1000)));
    const numFrames     = channels[0]?.length ?? 0;
  
    let envelope = 0;
    for (let i = 0; i < numFrames; i++) {
      let level = 0;
      for (const ch of channels) level = Math.max(level, Math.abs(ch[i]));
  
      const coeff = level > envelope ? attackCoeff : releaseCoeff;
      envelope = coeff * envelope + (1 - coeff) * level;
  
      const gain = envelope < threshold ? Math.max(0, envelope / threshold) : 1;
      for (const ch of channels) ch[i] *= gain;
    }
  }
  
  /**
  * Scans for the true peak across all channels and scales every sample
  * so the peak lands at targetPeak. Skips near-silent audio to avoid
  * amplifying noise floor into something audible.
  */
  export function normalizePeak(channels: Float32Array[], targetPeak = 0.98): void {
    let peak = 0;
    for (const ch of channels) {
      for (let i = 0; i < ch.length; i++) {
        const abs = Math.abs(ch[i]);
        if (abs > peak) peak = abs;
      }
    }
  
    if (peak <= 0.0001) return; // effectively silent — leave it alone
  
    const gain = targetPeak / peak;
    for (const ch of channels) {
      for (let i = 0; i < ch.length; i++) ch[i] *= gain;
    }
  } 
  