"""Is it the features or the search? Score each pair at the hand-landmark
truth transform and at the found transform, per channel."""
import json, os, sys
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(__file__))
from headalign import build_features, resize_w, affine_for, warp_to_ref, ncc_masked, MIN_OVERLAP

root = ".model-eval/hoff"
lm = json.load(open(f"{root}/landmarks.json"))["crown"]
exif = {e["file"]: e for e in json.load(open(f"{root}/exif.json"))}
rows = json.load(open(f"{root}/headalign/results.json"))

def pct(p, f):
    W, H = exif[f]["width"], exif[f]["height"]
    return np.array([(p[0] / 100 * W - (W - 1) / 2) / W, (p[1] / 100 * H - (H - 1) / 2) / W])

raw = {}
for f, m in lm.items():
    patch, neck = pct(m["patch"], f), pct(m["neck"], f)
    width = np.linalg.norm(pct(m["right"], f) - pct(m["left"], f)) if m["left"] and m["right"] else None
    raw[f] = dict(patch=patch, neck=neck, toNeck=np.linalg.norm(neck - patch), width=width)
ratios = sorted(r["width"] / r["toNeck"] for r in raw.values() if r["width"])
ratio = ratios[len(ratios) // 2]
pose = {}
for f, r in raw.items():
    hw = r["width"] or r["toNeck"] * ratio
    rot = np.arctan2(r["neck"][1] - r["patch"][1], r["neck"][0] - r["patch"][0]) - np.pi / 2
    pose[f] = dict(tx=r["patch"][0], ty=r["patch"][1], rotation=rot, scale=hw)

def compose(a, b):
    c, s = np.cos(a["rotation"]) * a["scale"], np.sin(a["rotation"]) * a["scale"]
    return dict(scale=a["scale"] * b["scale"], rotation=a["rotation"] + b["rotation"], tx=c * b["tx"] - s * b["ty"] + a["tx"], ty=s * b["tx"] + c * b["ty"] + a["ty"])
def inverse(t):
    sc = 1 / t["scale"]; c, s = np.cos(-t["rotation"]) * sc, np.sin(-t["rotation"]) * sc
    return dict(scale=sc, rotation=-t["rotation"], tx=-(c * t["tx"] - s * t["ty"]), ty=-(s * t["tx"] + c * t["ty"]))

feats = {}
def F(f):
    if f not in feats:
        bgr = resize_w(cv2.imread(f"{root}/images/{f}"), 768)
        feats[f] = build_features(bgr, [192])[0][192]
    return feats[f]

def channels(ref, tgt, t):
    A = affine_for(t, (ref.h, ref.w), (tgt.h, tgt.w))
    wm = warp_to_ref(tgt.mask, A, (ref.h, ref.w)) > 0.5
    m = wm & (ref.mask > 0.5)
    if m.sum() < MIN_OVERLAP * (ref.mask > 0.5).sum():
        return -1, -1
    ws = warp_to_ref(tgt.skin, A, (ref.h, ref.w)); we = warp_to_ref(tgt.edge, A, (ref.h, ref.w))
    wem = warp_to_ref(tgt.edge_mask, A, (ref.h, ref.w)) > 0.5
    me = wem & (ref.edge_mask > 0.5)
    return ncc_masked(ref.skin, ws, m.astype(np.float32)), ncc_masked(ref.edge, we, me.astype(np.float32))

print("pair                 found(skin,edge)   truth(skin,edge)   rotErr")
better = 0; n = 0
for r in rows:
    a, b = r["ref"], r["target"]
    if a not in pose or b not in pose: continue
    t_true = compose(pose[b], inverse(pose[a]))
    t_found = dict(tx=r["tx"], ty=r["ty"], rotation=np.deg2rad(r["rotationDeg"]), scale=r["scale"])
    fs, fe = channels(F(a), F(b), t_found)
    ts, te = channels(F(a), F(b), t_true)
    rot = abs(((np.degrees(t_found["rotation"] - t_true["rotation"]) + 540) % 360) - 180)
    n += 1
    if 0.5 * (ts + te) >= 0.5 * (fs + fe) - 0.02: better += 1
    print(f'{a[9:15]}->{b[9:15]}   {fs:+.2f} {fe:+.2f}        {ts:+.2f} {te:+.2f}        {rot:5.0f}°')
print(f"truth scores at least as well as found in {better}/{n} pairs")
