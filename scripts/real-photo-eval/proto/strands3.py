"""Prototype v3: per-photo scalp exposure and strand density, crown vs ring.

For every crown photo:
 - head mask (headalign.head_mask), head width in px -> px per cm if the head
   isn't cut off (else estimated from the mask area and flagged)
 - scalp exposure: share of the head where skin shows (skin map > 0.35)
 - patch: largest skin component inside the eroded head; its area in cm²
 - strand line density (cm of detected hair per cm²) in a crown disc of
   radius 2.5 cm about the patch centre, and in a ring 3.5-5.5 cm out,
   with their ratio (crown / ring). Dark ridges only; light ridges kept as
   a separate, lower-confidence count.
"""
import json, os, sys
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(__file__))
from headalign import head_mask, resize_w, skin_map
from strands2 import multi_ridge, nms, junction_split_count

HEAD_WIDTH_CM = 15.0

def analyse(path, hair_length):
    bgr = cv2.imread(path)
    H, W = bgr.shape[:2]
    base = resize_w(bgr, 256)
    mask, skin, hair = head_mask(base)
    mask_full = cv2.resize(mask, (W, H), interpolation=cv2.INTER_NEAREST) > 0
    ys, xs = np.nonzero(mask_full)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    touches = int(x0 <= 1) + int(x1 >= W - 2) + int(y0 <= 1) + int(y1 >= H - 2)
    # head width: the mask's extent across its minor axis is unreliable when cut off; use
    # the equivalent diameter from area when cut off (biased low), the box width otherwise.
    area_px = mask_full.sum()
    eq_diam = 2 * np.sqrt(area_px / np.pi)
    head_px = (x1 - x0) if touches == 0 else max(eq_diam, x1 - x0)
    px_per_cm = head_px / HEAD_WIDTH_CM
    scale_ok = touches == 0
    skin_full = cv2.resize(skin, (W, H), interpolation=cv2.INTER_LINEAR)
    skin_b = cv2.GaussianBlur(skin_full, (0, 0), px_per_cm * 0.15)
    exposed = (skin_b > 0.35) & mask_full
    exposure = exposed.sum() / max(1, area_px)
    # patch: largest exposed component inside the eroded head
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(px_per_cm * 1.0) | 1,) * 2)
    inner = cv2.erode(mask_full.astype(np.uint8), k) > 0
    n, lab, st, cent = cv2.connectedComponentsWithStats((exposed & inner).astype(np.uint8))
    if n > 1:
        big = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
        patch = lab == big
        pc = cent[big]
        patch_cm2 = st[big, cv2.CC_STAT_AREA] / px_per_cm ** 2
    else:
        patch = np.zeros_like(exposed); pc = (np.mean(xs), np.mean(ys)); patch_cm2 = 0.0
    # strands at full res inside the head
    crop = bgr[y0:y1 + 1, x0:x1 + 1]
    m = mask_full[y0:y1 + 1, x0:x1 + 1]
    lab_ = cv2.cvtColor(crop, cv2.COLOR_BGR2LAB).astype(np.float32)
    L = lab_[..., 0] / 255
    hair_px = max(0.8, px_per_cm * 0.008)
    dark, th = multi_ridge(L, [hair_px * 0.8, hair_px * 1.2, hair_px * 1.8], dark=True)
    region = cv2.erode(m.astype(np.uint8), np.ones((int(px_per_cm * 0.4) | 1,) * 2, np.uint8)) > 0
    v = dark[region]
    hi = np.percentile(v, 99) + 1e-6
    dn = np.clip(dark / hi, 0, 1)
    t = max(np.percentile(dn[region], 75), 0.1)
    skel = nms(dn, th) & (dn > t) & region
    nn, l2, s2, _ = cv2.connectedComponentsWithStats(skel.astype(np.uint8), connectivity=8)
    keep = np.zeros(nn, bool)
    if nn > 1:
        keep[1:] = s2[1:, cv2.CC_STAT_AREA] >= px_per_cm * 0.08
    skel = keep[l2]
    yy, xx = np.mgrid[0:crop.shape[0], 0:crop.shape[1]]
    d = np.hypot(xx - (pc[0] - x0), yy - (pc[1] - y0)) / px_per_cm
    disc = region & (d < 2.5)
    ring = region & (d > 3.5) & (d < 5.5)
    def line_density(sel):
        a = sel.sum() / px_per_cm ** 2
        return (skel[sel].sum() / px_per_cm / a) if a > 0.5 else float("nan"), a
    crown_ld, crown_a = line_density(disc)
    ring_ld, ring_a = line_density(ring)
    whole_ld, whole_a = line_density(region)
    lengths, _ = junction_split_count(skel, px_per_cm * 0.1)
    typ = np.percentile(lengths[lengths >= px_per_cm * 0.1], 80) / px_per_cm if (lengths >= px_per_cm * 0.1).sum() > 20 else float("nan")
    out = dict(file=os.path.basename(path), hair_length=hair_length, scale_ok=scale_ok, touches=touches,
               head_px=int(head_px), px_per_cm=round(px_per_cm, 1), head_area_cm2=round(area_px / px_per_cm ** 2, 1),
               exposure=round(float(exposure), 3), patch_cm2=round(float(patch_cm2), 1),
               patch_pct=[round(pc[0] / W * 100, 1), round(pc[1] / H * 100, 1)],
               crown_line=round(crown_ld, 2), ring_line=round(ring_ld, 2), whole_line=round(whole_ld, 2),
               crown_ring_ratio=round(crown_ld / ring_ld, 3) if ring_ld and ring_ld == ring_ld and ring_ld > 0 else None,
               typ_len_mm=round(typ * 10, 1) if typ == typ else None)
    vis = crop.copy()
    vis[~region] = (vis[~region] * 0.45).astype(np.uint8)
    cnt, _ = cv2.findContours(patch[y0:y1 + 1, x0:x1 + 1].astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(vis, cnt, -1, (0, 0, 255), 3)
    cv2.circle(vis, (int(pc[0] - x0), int(pc[1] - y0)), int(2.5 * px_per_cm), (0, 255, 255), 3)
    cv2.circle(vis, (int(pc[0] - x0), int(pc[1] - y0)), int(3.5 * px_per_cm), (255, 200, 0), 2)
    cv2.circle(vis, (int(pc[0] - x0), int(pc[1] - y0)), int(5.5 * px_per_cm), (255, 200, 0), 2)
    sk = cv2.dilate(skel.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    strands_vis = crop.copy(); strands_vis[sk] = (255, 255, 0)
    return out, resize_w(np.concatenate([vis, strands_vis], 1), 900)

if __name__ == "__main__":
    root = sys.argv[1] if len(sys.argv) > 1 else ".model-eval/hoff"
    out = os.path.join(root, "strands3"); os.makedirs(out, exist_ok=True)
    manifest = json.load(open(os.path.join(root, "manifest.json")))
    rows = []
    for p in manifest["photos"]:
        if p["view"] != "crown": continue
        r, vis = analyse(os.path.join(root, "images", p["file"]), p["hair_length"])
        cv2.putText(vis, f'{p["file"][:15]} {p["hair_length"]} exp {r["exposure"]:.2f} patch {r["patch_cm2"]} cm2 crown {r["crown_line"]} ring {r["ring_line"]} ratio {r["crown_ring_ratio"]} scale_ok {r["scale_ok"]}', (4, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
        cv2.imwrite(os.path.join(out, p["file"].replace(".jpg", "_v3.jpg")), vis, [cv2.IMWRITE_JPEG_QUALITY, 80])
        rows.append(r)
        print({k: v for k, v in r.items() if k in ("file", "hair_length", "scale_ok", "px_per_cm", "head_area_cm2", "exposure", "patch_cm2", "crown_line", "ring_line", "crown_ring_ratio", "typ_len_mm")}, flush=True)
    json.dump(rows, open(os.path.join(out, "report.json"), "w"), indent=1)
