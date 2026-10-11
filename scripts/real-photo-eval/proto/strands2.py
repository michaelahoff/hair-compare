"""Prototype v2: strand map and density at full resolution.

Channels: dark ridges on luma (dark hairs on skin), bright ridges on a
"whiteness" channel (luma minus chroma, where grey hairs stand out on pink
skin). Thin by non-maximum suppression, split at junctions, count segments
and measure line length per area (stereology transects as a cross-check).
"""
import json, os, sys
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(__file__))
from headalign import head_mask, resize_w, skin_map

HEAD_WIDTH_CM = 15.0

def hessian_ridge(img, sigma, dark=True):
    g = cv2.GaussianBlur(img, (0, 0), sigma)
    dxx = cv2.Sobel(g, cv2.CV_32F, 2, 0, ksize=3)
    dyy = cv2.Sobel(g, cv2.CV_32F, 0, 2, ksize=3)
    dxy = cv2.Sobel(g, cv2.CV_32F, 1, 1, ksize=3)
    half = (dxx + dyy) / 2
    det = np.sqrt(np.maximum(((dxx - dyy) / 2) ** 2 + dxy ** 2, 0))
    l1, l2 = half + det, half - det
    r = (l1 if dark else -l2) * sigma * sigma
    r = np.maximum(r, 0)
    aniso = np.abs(l1 - l2) / (np.abs(l1) + np.abs(l2) + 1e-6)
    # orientation of the line: eigenvector of the small-magnitude eigenvalue
    theta = 0.5 * np.arctan2(2 * dxy, dxx - dyy)  # direction of the largest curvature (across the line)
    return r * aniso, theta

def multi_ridge(img, sigmas, dark=True):
    best = None
    best_theta = None
    for s in sigmas:
        r, th = hessian_ridge(img, s, dark)
        if best is None:
            best, best_theta = r, th
        else:
            sel = r > best
            best = np.where(sel, r, best)
            best_theta = np.where(sel, th, best_theta)
    return best, best_theta

def nms(r, theta):
    """Keep ridge pixels that are maxima across the line (along theta)."""
    h, w = r.shape
    c, s = np.cos(theta), np.sin(theta)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    def samp(dx, dy):
        return cv2.remap(r, (xx + dx).astype(np.float32), (yy + dy).astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    a = samp(c, s)
    b = samp(-c, -s)
    return (r >= a) & (r >= b)

def junction_split_count(skel, min_len):
    """Split the skeleton at junctions and count pieces at least min_len long."""
    sk = (skel > 0).astype(np.uint8)
    k = np.ones((3, 3), np.uint8)
    nb = cv2.filter2D(sk, -1, k, borderType=cv2.BORDER_CONSTANT) - sk
    junction = (sk > 0) & (nb >= 3)
    pieces = sk.copy()
    pieces[cv2.dilate(junction.astype(np.uint8), k) > 0] = 0
    n, lab, stats, _ = cv2.connectedComponentsWithStats(pieces, connectivity=8)
    lengths = stats[1:, cv2.CC_STAT_AREA] if n > 1 else np.array([])
    return lengths, pieces

def analyse(path, hair_length="short"):
    bgr = cv2.imread(path)
    base = resize_w(bgr, 256)
    mask, skin, hair = head_mask(base)
    H, W = bgr.shape[:2]
    mask_full = cv2.resize(mask, (W, H), interpolation=cv2.INTER_NEAREST)
    ys, xs = np.nonzero(mask_full)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    crop = bgr[y0:y1, x0:x1]
    m = mask_full[y0:y1, x0:x1] > 0
    px_per_cm = (x1 - x0) / HEAD_WIDTH_CM
    lab = cv2.cvtColor(crop, cv2.COLOR_BGR2LAB).astype(np.float32)
    L = lab[..., 0] / 255
    chroma = np.sqrt((lab[..., 1] - 128) ** 2 + (lab[..., 2] - 128) ** 2) / 128
    chroma = cv2.GaussianBlur(chroma, (0, 0), 1.5)  # chroma is subsampled in JPEG
    white = L - 1.5 * chroma
    hair_px = max(0.8, px_per_cm * 0.008)  # ~80 µm hair
    sig_dark = [hair_px * 0.8, hair_px * 1.2, hair_px * 1.8]
    sig_light = [hair_px * 1.2, hair_px * 1.8]
    dark, th_d = multi_ridge(L, sig_dark, dark=True)
    light, th_l = multi_ridge(white, sig_light, dark=False)
    skin_c = cv2.resize(skin, (crop.shape[1], crop.shape[0]), interpolation=cv2.INTER_LINEAR)
    skin_b = cv2.GaussianBlur(skin_c, (0, 0), px_per_cm * 0.3)
    # Where strands can be told apart: skin shows between hairs. For a buzz cut that's the whole head.
    region = m & ((skin_b > 0.2) if hair_length != "short" else (cv2.erode(m.astype(np.uint8), np.ones((int(px_per_cm * 0.5) | 1,) * 2, np.uint8)) > 0))
    def norm(x):
        v = x[region]
        hi = np.percentile(v, 99) + 1e-6 if v.size else 1
        return np.clip(x / hi, 0, 1)
    dark_n, light_n = norm(dark), norm(light)
    # thresholds relative to the region's noise floor
    def thr(x):
        v = x[region]
        return np.percentile(v, 70) if v.size else 0.5
    td, tl = max(thr(dark_n), 0.12), max(thr(light_n), 0.12)
    skel_d = nms(dark_n, th_d) & (dark_n > td) & region
    skel_l = nms(light_n, th_l) & (light_n > tl) & region & ~cv2.dilate(skel_d.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    skel = skel_d | skel_l
    # clean: remove tiny specks
    n, lab_, st, _ = cv2.connectedComponentsWithStats(skel.astype(np.uint8), connectivity=8)
    keep = np.zeros(n, bool)
    if n > 1:
        keep[1:] = st[1:, cv2.CC_STAT_AREA] >= px_per_cm * 0.08  # >= 0.8 mm
    skel = keep[lab_]
    lengths, pieces = junction_split_count(skel, px_per_cm * 0.1)
    min_len = px_per_cm * 0.1
    pieces_ok = lengths[lengths >= min_len]
    area_cm2 = region.sum() / px_per_cm ** 2
    line_cm = skel.sum() / px_per_cm  # total skeleton length in cm (8-connected approx)
    line_density = line_cm / area_cm2  # cm of hair per cm²
    # typical visible hair length: 80th percentile of piece length (unbroken hairs)
    typ_len_cm = (np.percentile(pieces_ok, 80) / px_per_cm) if pieces_ok.size else 0.3
    count_est = line_cm / max(typ_len_cm, 0.05)
    density_est = count_est / area_cm2
    # transect cross-check: crossings of horizontal lines every 0.5 mm
    step = max(2, int(px_per_cm * 0.05))
    rows = np.arange(0, skel.shape[0], step)
    cross = 0; tlen = 0
    for y in rows:
        line = skel[y] & region[y]
        cross += int((np.diff(line.astype(np.int8)) == 1).sum())
        tlen += region[y].sum()
    LA = (np.pi / 2) * cross / (tlen / px_per_cm) if tlen else 0  # cm/cm² by stereology
    return dict(crop=crop, region=region, dark=dark_n, light=light_n, skel=skel, skel_d=skel_d, skel_l=skel_l, pieces=pieces,
                px_per_cm=px_per_cm, area_cm2=area_cm2, line_density=line_density, LA=LA, typ_len_cm=typ_len_cm,
                count_est=count_est, density_est=density_est, light_share=float(skel_l.sum() / max(1, skel.sum())),
                skin_share=float((skin_b > 0.2)[m].mean()), L=L)

def reveal(r):
    """Enhanced view: CLAHE luma, unsharp, with strands tinted (dark→cyan, light→yellow)."""
    crop = r["crop"]
    lab = cv2.cvtColor(crop, cv2.COLOR_BGR2LAB)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    lab[..., 0] = clahe.apply(lab[..., 0])
    enh = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
    blur = cv2.GaussianBlur(enh, (0, 0), 1.5)
    enh = cv2.addWeighted(enh, 1.6, blur, -0.6, 0)
    tint = enh.copy()
    d = cv2.dilate(r["skel_d"].astype(np.uint8), np.ones((2, 2), np.uint8)) > 0
    l = cv2.dilate(r["skel_l"].astype(np.uint8), np.ones((2, 2), np.uint8)) > 0
    tint[d] = (255, 220, 0)   # cyan-ish in BGR
    tint[l] = (0, 230, 255)   # yellow in BGR
    tint[~r["region"]] = (tint[~r["region"]] * 0.5).astype(np.uint8)
    return enh, tint

if __name__ == "__main__":
    root = sys.argv[1] if len(sys.argv) > 1 else ".model-eval/hoff"
    out = os.path.join(root, "strands2")
    os.makedirs(out, exist_ok=True)
    manifest = {p["file"]: p for p in json.load(open(os.path.join(root, "manifest.json")))["photos"]}
    files = sys.argv[2:] or ["20260918_121801_14607.jpg", "20261001_160212_14682.jpg", "20261003_092142_14733.jpg", "20260819_092043_23777.jpg", "20260825_091740_14379.jpg"]
    report = []
    for f in files:
        r = analyse(os.path.join(root, "images", f), manifest[f]["hair_length"])
        enh, tint = reveal(r)
        txt = (f'{f[:15]} region {r["area_cm2"]:.0f} cm2  line {r["line_density"]:.1f} cm/cm2 (transect {r["LA"]:.1f})  '
               f'typ len {r["typ_len_cm"]*10:.1f} mm  est {r["density_est"]:.0f} hairs/cm2  light share {r["light_share"]:.2f}  skin share {r["skin_share"]:.2f}')
        print(txt)
        report.append({"file": f, "area_cm2": round(r["area_cm2"], 1), "line_density": round(r["line_density"], 2), "LA": round(r["LA"], 2),
                       "typ_len_mm": round(r["typ_len_cm"] * 10, 1), "density_est": round(r["density_est"], 0), "light_share": round(r["light_share"], 3), "skin_share": round(r["skin_share"], 3)})
        sheet = np.concatenate([r["crop"], enh, tint], 1)
        sheet = resize_w(sheet, 2400)
        cv2.putText(sheet, txt, (6, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        cv2.imwrite(os.path.join(out, f.replace(".jpg", "_reveal.jpg")), sheet, [cv2.IMWRITE_JPEG_QUALITY, 82])
        ys, xs = np.nonzero(r["region"])
        cx, cy = int(np.median(xs)), int(np.median(ys))
        half = int(1.5 * r["px_per_cm"])
        H, W = r["crop"].shape[:2]
        x0, x1, y0, y1 = max(0, cx - half), min(W, cx + half), max(0, cy - half), min(H, cy + half)
        z = np.concatenate([r["crop"][y0:y1, x0:x1], enh[y0:y1, x0:x1], tint[y0:y1, x0:x1]], 1)
        cv2.imwrite(os.path.join(out, f.replace(".jpg", "_zoom3cm.jpg")), resize_w(z, 2100), [cv2.IMWRITE_JPEG_QUALITY, 88])
    json.dump(report, open(os.path.join(out, "report.json"), "w"), indent=1)
