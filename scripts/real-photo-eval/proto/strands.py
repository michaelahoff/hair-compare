"""Prototype: make fine and light hairs visible, and estimate strand density.

For each photo: crop to the head mask's box at a working resolution, then
 - enhanced luma: CLAHE + unsharp mask (what a "Reveal" view would show)
 - dark-hair ridge response: multi-scale Hessian ridge filter on luma
 - light-hair ridge response: the same filter on the red-chroma (Cr) channel,
   where grey hairs read as low-chroma lines on pink skin
 - strand mask and a density estimate per cm², assuming a head width.
"""
import json, os, sys
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(__file__))
from headalign import head_mask, resize_w, skin_map

HEAD_WIDTH_CM = 15.0  # typical adult biparietal width; a rough scale reference

def ridge(img, sigmas, bright=False):
    """Max over scales of the Hessian ridge measure (largest negative eigenvalue for dark lines)."""
    best = np.zeros_like(img, np.float32)
    for s in sigmas:
        g = cv2.GaussianBlur(img, (0, 0), s)
        dxx = cv2.Sobel(g, cv2.CV_32F, 2, 0, ksize=3)
        dyy = cv2.Sobel(g, cv2.CV_32F, 0, 2, ksize=3)
        dxy = cv2.Sobel(g, cv2.CV_32F, 1, 1, ksize=3)
        tr = dxx + dyy
        det = np.sqrt(np.maximum(((dxx - dyy) / 2) ** 2 + dxy ** 2, 0))
        l1 = tr / 2 + det  # larger eigenvalue
        l2 = tr / 2 - det
        # dark line on bright background: the eigenvalue across the line is large positive
        r = (l1 if not bright else -l2) * s * s
        r = np.maximum(r, 0)
        # suppress blob-like responses: require anisotropy
        aniso = np.abs(l1 - l2) / (np.abs(l1) + np.abs(l2) + 1e-6)
        r = r * aniso
        best = np.maximum(best, r)
    return best

def analyse(path, work_width=1600):
    bgr = cv2.imread(path)
    bgr = resize_w(bgr, min(work_width, bgr.shape[1]))
    base = resize_w(bgr, 256)
    mask, skin, hair = head_mask(base)
    mask_full = cv2.resize(mask, (bgr.shape[1], bgr.shape[0]), interpolation=cv2.INTER_NEAREST)
    ys, xs = np.nonzero(mask_full)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    crop = bgr[y0:y1, x0:x1]
    m = mask_full[y0:y1, x0:x1]
    head_w_px = x1 - x0
    px_per_cm = head_w_px / HEAD_WIDTH_CM
    lab = cv2.cvtColor(crop, cv2.COLOR_BGR2LAB)
    L = lab[..., 0]
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    Lc = clahe.apply(L)
    blur = cv2.GaussianBlur(Lc, (0, 0), 2.0)
    sharp = cv2.addWeighted(Lc, 1.8, blur, -0.8, 0)
    ycc = cv2.cvtColor(crop, cv2.COLOR_BGR2YCrCb)
    Cr = ycc[..., 1].astype(np.float32)
    Y = Lc.astype(np.float32) / 255
    # hair width at this scale: ~0.08 mm terminal hair -> px_per_cm*0.008 px; a buzzed hair spans a few px
    sig = [max(0.8, px_per_cm * 0.01), max(1.2, px_per_cm * 0.02), max(1.8, px_per_cm * 0.03)]
    dark = ridge(Y, sig, bright=False)
    light = ridge(Cr / 255, sig, bright=False)  # grey hair = low Cr line = "dark" line in Cr
    skin_c = cv2.resize(skin, (crop.shape[1], crop.shape[0]), interpolation=cv2.INTER_LINEAR)
    # only count strands where skin shows between hairs (otherwise strands overlap and can't be counted)
    scalp = (cv2.GaussianBlur(skin_c, (0, 0), px_per_cm * 0.3) > 0.25) & (m > 0)
    def norm(x):
        v = x[scalp]
        if v.size == 0: return x
        hi = np.percentile(v, 99.5) + 1e-6
        return np.clip(x / hi, 0, 1)
    dark_n, light_n = norm(dark), norm(light)
    strands = np.maximum(dark_n, 0.9 * light_n)
    # strand mask: thresholded ridge, thinned by non-max via morphological skeleton approx
    sm = ((strands > 0.22) & scalp).astype(np.uint8)
    skel = cv2.ximgproc.thinning(sm * 255) if hasattr(cv2, "ximgproc") else sm
    # count strands: connected components of the thinned mask (segments)
    n, lab_, stats, _ = cv2.connectedComponentsWithStats(skel, connectivity=8)
    seg_len = stats[1:, cv2.CC_STAT_AREA] if n > 1 else np.array([])
    keep = seg_len >= px_per_cm * 0.1  # at least 1 mm visible
    segments = int(keep.sum())
    scalp_area_cm2 = scalp.sum() / (px_per_cm ** 2)
    density = segments / scalp_area_cm2 if scalp_area_cm2 > 0 else 0
    # per-block density map (blocks of 1 cm)
    bs = int(round(px_per_cm))
    H, W = sm.shape
    dens = np.zeros((H // bs + 1, W // bs + 1), np.float32)
    cover = np.zeros_like(dens)
    for k in range(1, n):
        if not keep[k - 1]: continue
        cx = int(stats[k, cv2.CC_STAT_LEFT] + stats[k, cv2.CC_STAT_WIDTH] / 2)
        cy = int(stats[k, cv2.CC_STAT_TOP] + stats[k, cv2.CC_STAT_HEIGHT] / 2)
        dens[cy // bs, cx // bs] += 1
    for by in range(dens.shape[0]):
        for bx in range(dens.shape[1]):
            blk = scalp[by * bs:(by + 1) * bs, bx * bs:(bx + 1) * bs]
            cover[by, bx] = blk.mean() if blk.size else 0
    dens = np.where(cover > 0.6, dens / np.maximum(cover, 1e-6), np.nan)
    return dict(crop=crop, mask=m, scalp=scalp, enhanced=sharp, dark=dark_n, light=light_n, strands=strands, skel=skel,
                segments=segments, scalp_area_cm2=scalp_area_cm2, density=density, px_per_cm=px_per_cm, dens_map=dens,
                skin_share=float(skin_c[m > 0].mean()))

if __name__ == "__main__":
    root = sys.argv[1] if len(sys.argv) > 1 else ".model-eval/hoff"
    out = os.path.join(root, "strands")
    os.makedirs(out, exist_ok=True)
    files = sys.argv[2:] or ["20260918_121801_14607.jpg", "20261001_160212_14682.jpg", "20261003_092142_14733.jpg", "20260819_092043_23777.jpg", "20260825_091740_14379.jpg"]
    report = []
    for f in files:
        r = analyse(os.path.join(root, "images", f))
        def col(x):
            return cv2.applyColorMap((np.clip(x, 0, 1) * 255).astype(np.uint8), cv2.COLORMAP_INFERNO)
        enh = cv2.cvtColor(r["enhanced"], cv2.COLOR_GRAY2BGR)
        over = r["crop"].copy()
        over[r["skel"] > 0] = (0, 255, 0)
        over[~r["scalp"]] = (over[~r["scalp"]] * 0.4).astype(np.uint8)
        sheet = np.concatenate([r["crop"], enh, col(r["dark"]), col(r["light"]), over], 1)
        sheet = resize_w(sheet, 2400)
        txt = f'{f[:15]} segments {r["segments"]} scalp {r["scalp_area_cm2"]:.0f} cm2 -> {r["density"]:.0f} strands/cm2 (px/cm {r["px_per_cm"]:.0f}) skin share {r["skin_share"]:.2f}'
        cv2.putText(sheet, txt, (6, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        cv2.imwrite(os.path.join(out, f.replace(".jpg", "_strands.jpg")), sheet, [cv2.IMWRITE_JPEG_QUALITY, 82])
        # a zoomed crop of the patch centre, 4 cm wide, enhanced vs original vs strands
        H, W = r["crop"].shape[:2]
        ys, xs = np.nonzero(r["scalp"])
        cx, cy = int(np.median(xs)), int(np.median(ys))
        half = int(2 * r["px_per_cm"])
        x0, x1 = max(0, cx - half), min(W, cx + half)
        y0, y1 = max(0, cy - half), min(H, cy + half)
        z = np.concatenate([r["crop"][y0:y1, x0:x1], enh[y0:y1, x0:x1], col(r["strands"])[y0:y1, x0:x1], over[y0:y1, x0:x1]], 1)
        cv2.imwrite(os.path.join(out, f.replace(".jpg", "_zoom.jpg")), resize_w(z, 2000), [cv2.IMWRITE_JPEG_QUALITY, 85])
        print(txt)
        report.append({"file": f, "segments": r["segments"], "scalp_cm2": round(r["scalp_area_cm2"], 1), "density": round(r["density"], 1), "skin_share": round(r["skin_share"], 3)})
    json.dump(report, open(os.path.join(out, "report.json"), "w"), indent=1)
