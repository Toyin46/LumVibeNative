"""Fails if the C header, the compiled defaults and audioStudio.ts disagree about parameter
numbers or default values. Three platforms share one flat float array, so a drift here would
silently turn the wrong knob. Run via tests/run_tests.sh."""
import ctypes as C, os, re, sys

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(here)                                   # audio-core/
ts_path = os.path.join(os.path.dirname(root), "audioStudio.ts")
hdr = open(os.path.join(root, "include/lumvibe/audio/lva.h")).read()
ts = open(ts_path).read()

enum_body = re.search(r"enum\s*\{(.*?)\};", hdr, re.S).group(1)
names = [m.group(1) for m in re.finditer(r"^\s*LVA_P_([A-Z_]+)", enum_body, re.M) if m.group(1) != "COUNT"]
c_index = {n: i for i, n in enumerate(names)}

ts_block = re.search(r"LVA_PARAM\s*=\s*\{(.*?)\}\s*as const", ts, re.S).group(1)
ts_index = {m.group(1): int(m.group(2)) for m in re.finditer(r"([A-Z_]+)\s*:\s*(\d+)", ts_block)}

bad = 0
if c_index != ts_index:
    bad += 1
    print("FAIL: parameter indices differ between lva.h and audioStudio.ts")
    for k in sorted(set(c_index) | set(ts_index)):
        if c_index.get(k) != ts_index.get(k): print(f"   {k}: C={c_index.get(k)} TS={ts_index.get(k)}")
else:
    print(f"  ok:   {len(names)} parameter indices match between lva.h and audioStudio.ts")

ts_defaults = [float(x) for x in re.search(r"LVA_DEFAULTS:\s*number\[\]\s*=\s*\[(.*?)\]", ts, re.S).group(1).replace("\n", " ").split(",") if x.strip()]
lib = C.CDLL(os.environ.get("LVA_LIB", "/tmp/lva_build/liblva.so"))
n = lib.lva_param_count()
arr = (C.c_float * n)(); lib.lva_default_params(arr, n)
c_defaults = list(arr)
if n != len(names) or len(ts_defaults) != n:
    bad += 1; print(f"FAIL: counts differ: header {len(names)}, compiled {n}, TS defaults {len(ts_defaults)}")
else:
    diffs = [(names[i], c_defaults[i], ts_defaults[i]) for i in range(n) if abs(c_defaults[i] - ts_defaults[i]) > 1e-4]
    if diffs:
        bad += 1; print("FAIL: default values differ (name, C++, TS):", diffs)
    else:
        print(f"  ok:   all {n} default values match between the compiled engine and audioStudio.ts")
sys.exit(1 if bad else 0)
