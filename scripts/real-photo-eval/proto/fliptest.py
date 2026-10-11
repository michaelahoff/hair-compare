"""For every pair: refine from the found transform and from it flipped by a
half turn (and quarter turns) about the head centroids. Does the basin with
the right turn (per the hand-marked neck direction) score highest?"""
import json, os, sys
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(__file__))
from headalign import build_features, resize_w, refine, score

root = ".model-eval/hoff"
lm = json.load(open(f"{root}/landmarks.json"))["crown"]
exif = {e["file"]: e for e in json.load(open(f"{root}/exif.json"))}
rows = json.load(open(f"{root}/headalign/results.json"))
W = [96, 192]
feats = {}
def F(f):
    if f not in feats:
        bgr = resize_w(cv2.imread(f"{root}/images/{f}"), 768)
        feats[f] = build_features(bgr, W)[0]
    return feats[f]
def centroid(feat):
    m = feat.mask
    ys, xs = np.nonzero(m > 0.5)
    return (xs.mean() - (feat.w - 1) / 2) / feat.w, (ys.mean() - (feat.h - 1) / 2) / feat.w
def truth_rot(a, b):
    def ang(f):
        mk = lm[f]; Wd, H = exif[f]["width"], exif[f]["height"]
        return np.arctan2((mk["neck"][1] - mk["patch"][1]) / 100 * H, (mk["neck"][0] - mk["patch"][0]) / 100 * Wd)
    return ang(b) - ang(a)
def with_turn(t, dtheta, ca, cb):
    """Same transform turned by dtheta, keeping centroid ca -> cb."""
    rot = t["rotation"] + dtheta
    c, s = np.cos(rot) * t["scale"], np.sin(rot) * t["scale"]
    return dict(rotation=rot, scale=t["scale"], tx=cb[0] - (c * ca[0] - s * ca[1]), ty=cb[1] - (s * ca[0] + c * ca[1]))
def full_refine(ra, rb, t):
    rs, ls = np.deg2rad(5), np.log(1.15) / 2
    cur, sc = t, -1
    for w in W:
        cur, sc = refine(ra[w], rb[w], cur, rs, ls); rs /= 2; ls /= 2
    return cur, sc
out = []
right_wins = 0; n = 0
for r in rows:
    a, b = r["ref"], r["target"]
    ra, rb = F(a), F(b)
    ca, cb = centroid(ra[192]), centroid(rb[192])
    t0 = dict(tx=r["tx"], ty=r["ty"], rotation=np.deg2rad(r["rotationDeg"]), scale=r["scale"])
    tr = truth_rot(a, b)
    cands = []
    for d in [0, np.pi, np.pi / 2, -np.pi / 2]:
        t1, s1 = full_refine(ra, rb, with_turn(t0, d, ca, cb) if d else t0)
        err = abs(((np.degrees(t1["rotation"] - tr) + 540) % 360) - 180)
        cands.append((s1, err, d))
    best = max(cands, key=lambda c: c[0])
    right = [c for c in cands if c[1] < 30]
    best_right = max(right, key=lambda c: c[0]) if right else None
    n += 1
    if best[1] < 30: right_wins += 1
    out.append(dict(pair=f"{a[9:15]}->{b[9:15]}", found=round(cands[0][0], 3), found_err=round(cands[0][1]), best=round(best[0], 3), best_err=round(best[1]), best_right=round(best_right[0], 3) if best_right else None))
    print(f'{a[9:15]}->{b[9:15]} found {cands[0][0]:.3f} ({cands[0][1]:.0f}°)  best {best[0]:.3f} ({best[1]:.0f}°)  bestRight {best_right[0] if best_right else float("nan"):.3f}', flush=True)
print(f"best-of-4-basins has the right turn in {right_wins}/{n}")
json.dump(out, open(f"{root}/headalign/fliptest.json", "w"), indent=1)
