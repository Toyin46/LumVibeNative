"""End-to-end tests through the same C function every platform calls (lva_process).
Analysis is done with numpy/scipy, independent of the engine's own DSP code."""
import ctypes as C, os, sys, time
import numpy as np
from scipy.signal import resample_poly, butter, sosfilt

LIB = os.environ.get("LVA_LIB", "/tmp/lva_build/liblva.so")
lib = C.CDLL(LIB)
fp = C.POINTER(C.c_float)
lib.lva_process.argtypes = [fp, C.c_int, fp, C.c_int, C.c_int, C.c_int, fp, C.c_int, C.c_int, C.c_int,
                            C.c_void_p, C.c_void_p, C.POINTER(fp), C.POINTER(C.c_int), C.POINTER(C.c_int), C.POINTER(C.c_int)]
lib.lva_process.restype = C.c_int
lib.lva_free.argtypes = [fp]
lib.lva_last_error.restype = C.c_char_p
N_PARAMS = lib.lva_param_count()
IDX = dict(DENOISE_MODE=0, DENOISE_STRENGTH=1, NOISE_GATE=2, AUTOTUNE=3, SCALE_ROOT=4, SCALE_TYPE=5, TUNE_STRENGTH=6,
           TUNE_SPEED_MS=7, PITCH_SEMITONES=8, HIGHPASS_HZ=9, LOWPASS_HZ=10, PRESENCE_DB=11, COMPRESS=12, REVERB_MIX=13,
           ECHO_MIX=14, ECHO_MS=15, CHORUS=16, REVERSE=17, TRIM_START_SEC=18, TRIM_END_SEC=19, VOICE_GAIN=20, BEAT_GAIN=21,
           VOICE_OFFSET_MS=22, NORMALIZE=23, TAIL_SEC=24, AUTO_BALANCE=25)
assert N_PARAMS == len(IDX), (N_PARAMS, len(IDX))

def defaults():
    a = (C.c_float * N_PARAMS)(); lib.lva_default_params(a, N_PARAMS); return np.array(a[:], dtype=np.float32)

def neutral(**kw):
    """Everything off / unity, so a test measures only the stage it is about."""
    p = defaults()
    p[IDX["DENOISE_MODE"]] = 0; p[IDX["COMPRESS"]] = 0; p[IDX["HIGHPASS_HZ"]] = 0; p[IDX["NORMALIZE"]] = 0
    p[IDX["TAIL_SEC"]] = 0; p[IDX["BEAT_GAIN"]] = 1; p[IDX["AUTO_BALANCE"]] = 0
    for k, v in kw.items(): p[IDX[k]] = v
    return p

def run(params, voice, vrate, beat=None, brate=44100, vch=1, bch=2):
    params = np.ascontiguousarray(params, dtype=np.float32)
    voice = np.ascontiguousarray(voice, dtype=np.float32)
    out = fp(); nf = C.c_int(); rate = C.c_int(); ch = C.c_int()
    if beat is None: bp, bn = None, 0
    else:
        beat = np.ascontiguousarray(beat, dtype=np.float32); bp, bn = beat.ctypes.data_as(fp), len(beat) // bch
    t0 = time.time()
    rc = lib.lva_process(params.ctypes.data_as(fp), len(params), voice.ctypes.data_as(fp), len(voice) // vch, vrate, vch,
                         bp, bn, brate, bch, None, None, C.byref(out), C.byref(nf), C.byref(rate), C.byref(ch))
    dt = time.time() - t0
    if rc != 0: return rc, lib.lva_last_error().decode(), dt
    pcm = np.ctypeslib.as_array(out, shape=(nf.value * ch.value,)).copy().reshape(nf.value, ch.value)
    lib.lva_free(out)
    assert rate.value == 48000 and ch.value == 2
    return 0, pcm, dt

SR = 48000
def voice_note(f0_hz, dur, vib_cents=0.0, vib_hz=5.0, amp=0.12, sr=SR):
    t = np.arange(int(dur * sr)) / sr
    f = f0_hz * 2 ** ((vib_cents * np.sin(2 * np.pi * vib_hz * t)) / 1200)
    ph = 2 * np.pi * np.cumsum(f) / sr
    x = sum((1.0 / h) * np.sin(h * ph) for h in range(1, 9))
    env = np.minimum(1, np.minimum(t / 0.03, (dur - t) / 0.05))
    return (amp * x * env / 1.9).astype(np.float32)

def midi_hz(m): return 440.0 * 2 ** ((m - 69) / 12)
def f0_autocorr(x, sr=SR, lo=70, hi=900):
    x = x - x.mean(); n = len(x)
    X = np.fft.rfft(x, 2 * n); ac = np.fft.irfft(np.abs(X) ** 2)[:n]
    a, b = int(sr / hi), int(sr / lo); k = a + np.argmax(ac[a:b])
    if 1 <= k < len(ac) - 1:
        y0, y1, y2 = ac[k - 1], ac[k], ac[k + 1]; k = k + 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2)
    return sr / k
def rms(x): return float(np.sqrt(np.mean(np.square(x)))) if len(x) else 0.0
def db(x): return 20 * np.log10(max(x, 1e-9))

fails = 0
def check(cond, msg):
    global fails
    print(("  ok:   " if cond else "  FAIL: ") + msg)
    if not cond: fails += 1

rng = np.random.default_rng(7)
def fan_noise(n, level_rms):
    w = rng.standard_normal(n)
    hiss = sosfilt(butter(2, 7000, fs=SR, output="sos"), w)
    rumble = sosfilt(butter(2, 180, fs=SR, output="sos"), rng.standard_normal(n)) * 4
    t = np.arange(n) / SR
    hum = 0.5 * np.sin(2 * np.pi * 100 * t) + 0.3 * np.sin(2 * np.pi * 300 * t)
    x = hiss + rumble + hum
    return (x / rms(x) * level_rms).astype(np.float32)

# ─────────────────────────────────────────────────────────────────────────────
print("1. Noise removal (fan hiss + hum + breeze rumble, recorded at 44.1 kHz)")
melody = [(60, .5), (62, .5), (64, .6), (67, .5), (64, .5), (62, .5), (60, .8)]
parts = [np.zeros(int(1.3 * SR), np.float32)]
for m, d in melody: parts += [voice_note(midi_hz(m), d, vib_cents=12), np.zeros(int(0.25 * SR), np.float32)]
parts.append(np.zeros(int(1.2 * SR), np.float32))
clean = np.concatenate(parts)
noise = fan_noise(len(clean), 0.03)                                  # ~ -30 dBFS
noisy48 = clean + noise
noisy441 = resample_poly(noisy48, 441, 480).astype(np.float32)
speech = np.abs(clean) > 0.01
for strength in (0.6, 1.0):
    rc, out, dt = run(neutral(DENOISE_MODE=2, DENOISE_STRENGTH=strength), noisy441, 44100)
    assert rc == 0, out
    o = out[:, 0]; n = min(len(o), len(clean)); o = o[:n]
    sil = slice(int(0.35 * SR), int(1.1 * SR))                             # leading noise-only part
    red = db(rms(noisy48[sil])) - db(rms(o[sil]))
    snr_in = 10 * np.log10(np.sum(clean[:n][speech[:n]] ** 2) / np.sum((noisy48[:n][speech[:n]] - clean[:n][speech[:n]]) ** 2))
    snr_out = 10 * np.log10(np.sum(clean[:n][speech[:n]] ** 2) / np.sum((o[speech[:n]] - clean[:n][speech[:n]]) ** 2))
    gain = db(rms(o[speech[:n]])) - db(rms(clean[:n][speech[:n]]))
    print(f"  strength {strength}: pauses {red:.1f} dB quieter | singing SNR {snr_in:.1f} -> {snr_out:.1f} dB | singing level change {gain:+.2f} dB | {dt:.2f}s")
    check(red > (12 if strength < 1 else 18), f"background noise in pauses reduced by {red:.1f} dB")
    check(snr_out - snr_in > 5, f"noise under the singing reduced (SNR +{snr_out - snr_in:.1f} dB)")
    check(abs(gain) < 1.5, f"voice level preserved ({gain:+.2f} dB)")

# ─────────────────────────────────────────────────────────────────────────────
print("2. Autotune (singer 25-45 cents sharp with vibrato; key unknown to the engine)")
notes = [60, 62, 64, 67, 69, 67, 64, 62, 60, 64, 67, 72]
seg_dur = 0.55; segs = []; truth = []; drifts = []
for m in notes:
    drift = rng.uniform(-10, 10); drifts.append(drift)   # sung 25-45 cents sharp: inside the +-50 cent range any autotune can fix
    segs.append(voice_note(midi_hz(m) * 2 ** ((35 + drift) / 1200), seg_dur, vib_cents=14))
    segs.append(np.zeros(int(0.06 * SR), np.float32)); truth.append(m)
sung = np.concatenate([np.zeros(int(0.3 * SR), np.float32)] + segs)
sung441 = resample_poly(sung, 441, 480).astype(np.float32)
def note_errors(sig):
    errs = []
    for i, m in enumerate(truth):
        a = int((0.3 + i * (seg_dur + 0.06) + 0.15) * SR); b = int((0.3 + i * (seg_dur + 0.06) + seg_dur - 0.1) * SR)
        errs.append(1200 * np.log2(f0_autocorr(sig[a:b]) / midi_hz(m)))
    return np.array(errs)
e_in = note_errors(sung)
print(f"  before: mean error {np.mean(np.abs(e_in)):.1f} cents (max {np.max(np.abs(e_in)):.1f})")
for label, strength, speed in (("hard (T-Pain style)", 1.0, 0.0), ("natural", 0.85, 35.0)):
    rc, out, dt = run(neutral(AUTOTUNE=1, TUNE_STRENGTH=strength, TUNE_SPEED_MS=speed), sung441, 44100)
    assert rc == 0, out
    e_out = note_errors(out[:, 0])
    print(f"  {label}: mean error {np.mean(np.abs(e_out)):.1f} cents (max {np.max(np.abs(e_out)):.1f}) | {dt:.2f}s")
    if np.max(np.abs(e_out)) > 40: print("     per-note error after:", np.round(e_out).astype(int), " sung offset (cents sharp):", np.round(35 + np.array(drifts)).astype(int))
    check(np.mean(np.abs(e_out)) < (10 if strength == 1.0 else 18), f"{label}: notes pulled onto pitch (mean {np.mean(np.abs(e_out)):.1f} cents off, was {np.mean(np.abs(e_in)):.1f})")
    check(abs(db(rms(out[:, 0][int(.5 * SR):int(3 * SR)])) - db(rms(sung[int(.5 * SR):int(3 * SR)]))) < 1.5, f"{label}: level unchanged")

# ─────────────────────────────────────────────────────────────────────────────
print("3. Fixed pitch effects (deep / chipmunk)")
tone = voice_note(220.0, 2.0)
for name, semis in (("deep -3.4 st", -3.4), ("chipmunk +5.2 st", 5.2)):
    rc, out, _ = run(neutral(PITCH_SEMITONES=semis), tone, SR)
    f = f0_autocorr(out[int(0.4 * SR):int(1.6 * SR), 0]); want = 220 * 2 ** (semis / 12)
    check(abs(1200 * np.log2(f / want)) < 15, f"{name}: 220 Hz -> {f:.1f} Hz (want {want:.1f})")

# ─────────────────────────────────────────────────────────────────────────────
print("4. Trim, reverse, latency offset, tail (a single click as the voice)")
click = np.zeros(int(4 * SR), np.float32); click[int(2.0 * SR)] = 0.8
rc, out, _ = run(neutral(), click, SR); check(rc == 0 and abs(len(out) - 4 * SR) < 2, f"length unchanged ({len(out)} frames)")
rc, out, _ = run(neutral(TRIM_START_SEC=1.0), click, SR)
t_click = np.argmax(np.abs(out[:, 0])) / SR; check(abs(t_click - 1.0) < 0.01 and abs(len(out) / SR - 3.0) < 0.01, f"trim start 1.0 s: click now at {t_click:.3f}s, length {len(out)/SR:.2f}s")
rc, out, _ = run(neutral(TRIM_START_SEC=0.5, TRIM_END_SEC=3.0), click, SR)
check(abs(len(out) / SR - 2.5) < 0.01, f"trim 0.5-3.0 s gives {len(out)/SR:.2f}s")
rc, out, _ = run(neutral(VOICE_OFFSET_MS=100), click, SR)
t_click = np.argmax(np.abs(out[:, 0])) / SR; check(abs(t_click - 1.9) < 0.005, f"latency offset +100 ms: click moved earlier to {t_click:.3f}s")
rc, out, _ = run(neutral(REVERSE=1), click, SR)
t_click = np.argmax(np.abs(out[:, 0])) / SR; check(abs(t_click - 2.0) < 0.01, f"reverse: click at {t_click:.3f}s (mirror of 2.0 in a 4 s take)")
note = np.concatenate([np.zeros(int(1.0 * SR), np.float32), voice_note(330.0, 0.5), np.zeros(int(1.5 * SR), np.float32)])   # 3 s, sings 1.0-1.5 s
rc, dry, _ = run(neutral(TAIL_SEC=2.0), note, SR)
rc, out, _ = run(neutral(TAIL_SEC=2.0, REVERB_MIX=0.5), note, SR)
check(abs(len(out) / SR - 5.0) < 0.01, f"2 s tail extends the file to {len(out)/SR:.2f}s")
check(rms(dry[int(1.7 * SR):int(2.0 * SR), 0]) < 1e-6 and rms(out[int(1.7 * SR):int(2.0 * SR), 0]) > 3e-4, f"reverb keeps ringing after the last note ({db(rms(out[int(1.7 * SR):int(2.0 * SR), 0])):.0f} dBFS at 1.7-2.0 s)")
check(rms(out[int(4.7 * SR):int(5.0 * SR), 0]) < 1e-4, f"...and has died away by the end of the tail ({db(rms(out[int(4.7 * SR):int(5.0 * SR), 0])):.0f} dBFS)")

# ─────────────────────────────────────────────────────────────────────────────
print("5. Mix with a beat (44.1 kHz stereo, shorter than the song, so it must loop)")
tb = np.arange(int(2.0 * 44100)) / 44100
beat = np.zeros((len(tb), 2), np.float32)
for k in range(4):                                           # 4 kicks per 2 s loop
    a = int(k * 0.5 * 44100); n = int(0.18 * 44100); tt = np.arange(n) / 44100
    kick = 0.6 * np.sin(2 * np.pi * (110 * np.exp(-tt * 18) + 40) * tt) * np.exp(-tt * 14); beat[a:a + n, 0] += kick; beat[a:a + n, 1] += kick
beat += 0.02 * rng.standard_normal(beat.shape).astype(np.float32)
song = np.concatenate([np.zeros(int(1.0 * SR), np.float32)] + [np.concatenate([voice_note(midi_hz(m), 0.5), np.zeros(int(.1 * SR), np.float32)]) for m in [60, 64, 67, 64, 60, 62, 64, 60, 67, 72]])
song = song + fan_noise(len(song), 0.02)
song441 = resample_poly(song, 441, 480).astype(np.float32)
p = defaults(); p[IDX["TAIL_SEC"]] = 1.5
rc, mix, dt = run(p, song441, 44100, beat.reshape(-1), 44100)
assert rc == 0, mix
print(f"  studio defaults: {len(mix)/SR:.2f}s of audio rendered in {dt:.2f}s on this PC")
check(abs(len(mix) / SR - (len(song) / SR + 1.5)) < 0.02, f"song {len(song)/SR:.2f}s + 1.5 s tail = {len(mix)/SR:.2f}s")
check(np.isfinite(mix).all(), "no NaN/Inf")
check(abs(db(np.max(np.abs(mix))) - (-1.0)) < 0.2, f"peak normalised to {db(np.max(np.abs(mix))):.2f} dBFS")
check(rms(mix[int(0.05 * SR):int(0.9 * SR), 0]) > 5e-3, "beat plays from the start, before singing begins")
voice_only = run(neutral(BEAT_GAIN=0, AUTO_BALANCE=1, COMPRESS=1, HIGHPASS_HZ=80, DENOISE_MODE=2, TAIL_SEC=0), song441, 44100, beat.reshape(-1), 44100)[1]
beat_only = run(neutral(VOICE_GAIN=0, AUTO_BALANCE=1, COMPRESS=1, HIGHPASS_HZ=80, DENOISE_MODE=2, TAIL_SEC=0), song441, 44100, beat.reshape(-1), 44100)[1]
sing = np.abs(voice_only[:, 0]) > 0.01
d = db(rms(voice_only[:, 0][sing])) - db(rms(beat_only[:len(voice_only), 0]))
check(abs(d - 1.5) < 2.0, f"auto-balance: singing sits {d:+.1f} dB relative to the beat (target about +1.5)")
t_beat_loop = np.argmax(np.abs(beat_only[int(0.0 * SR):int(0.05 * SR), 0]))
check(rms(beat_only[int(2.0 * SR):int(2.2 * SR), 0]) > 0.5 * rms(beat_only[0:int(0.2 * SR), 0]), "beat loops (kick returns after 2 s)")

# ─────────────────────────────────────────────────────────────────────────────
print("6. Input handling")
rc, msg, _ = run(defaults(), np.zeros(100, np.float32), 44100); check(rc != 0 and len(msg) > 0, f"too-short voice rejected with a readable error: '{msg}'")
rc, out, _ = run(np.zeros(0, np.float32), voice_note(220, 1.0), SR); check(rc == 0 and len(out) > 0, "empty params array falls back to defaults")
st = np.stack([voice_note(220, 1.0), voice_note(220, 1.0)], 1).reshape(-1)
rc, out, _ = run(neutral(), st, SR, vch=2); check(rc == 0 and abs(rms(out[:, 0]) - rms(voice_note(220, 1.0))) < 0.01, "stereo voice input is mixed to mono correctly")

# ─────────────────────────────────────────────────────────────────────────────
print("7. Speed: 3-minute take, every stage on")
long_v = np.tile(np.concatenate([voice_note(midi_hz(m), 0.5) for m in (60, 64, 67, 72, 67, 64)]), 60)[:180 * SR]
long_v = long_v + fan_noise(len(long_v), 0.02); long_441 = resample_poly(long_v, 441, 480).astype(np.float32)
long_beat = np.tile(beat, (30, 1)).reshape(-1)
p = defaults(); p[IDX["AUTOTUNE"]] = 1; p[IDX["REVERB_MIX"]] = 0.3; p[IDX["CHORUS"]] = 1; p[IDX["ECHO_MIX"]] = 0.2
rc, out, dt = run(p, long_441, 44100, long_beat, 44100)
check(rc == 0, f"3:00 song fully processed in {dt:.1f}s on this PC (phones are slower — see README)")

print("\n" + ("FAILED: %d check(s)" % fails if fails else "ALL INTEGRATION CHECKS PASSED"))
sys.exit(1 if fails else 0)
