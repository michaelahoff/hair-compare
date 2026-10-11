"""Prototype: find the head in a crown photo from colour and texture alone.
Writes a contact sheet of masks for every crown photo in the manifest."""
import json, os, sys
import numpy as np, cv2

root = sys.argv[1] if len(sys.argv) > 1 else ".model-eval/hoff"
out = os.path.join(root, "proto")
os.makedirs(out, exist_ok=True)
manifest = json.load(open(os.path.join(root, "manifest.json")))
W = 256

def load(path, width=W):
    im = cv2.imread(path)
    h = round(im.shape[0] * width / im.shape[1])
    return cv2.resize(im, (width, h), interpolation=cv2.INTER_AREA)

def masks(bgr):
    ycc = cv2.cvtColor(bgr, cv2.COLOR_BGR2YCrCb).astype(np.float32)
    Y, Cr, Cb = ycc[..., 0], ycc[..., 1], ycc[..., 2]
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
    H, S, V = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    # Skin: pinkish chroma. Soft score from Cr (redness) and Cb.
    skin = np.clip((Cr - 138) / 12, 0, 1) * np.clip((132 - Cb) / 12, 0, 1) * np.clip((Y - 60) / 40, 0, 1)
    # Hair: dark, fine texture. Local std of luma at fine scale.
    g = Y
    blur = cv2.GaussianBlur(g, (0, 0), 1.2)
    var = cv2.GaussianBlur((g - blur) ** 2, (0, 0), 3)
    tex = np.sqrt(var)
    dark = np.clip((110 - Y) / 50, 0, 1)
    hair = dark * np.clip(tex / 6, 0, 1)
    hair = np.clip(hair + np.clip((70 - Y) / 30, 0, 1) * np.clip(tex / 3, 0, 1), 0, 1)
    return skin, hair, tex

def head_blob(skin, hair):
    # Head = hair plus the skin that sits inside/next to hair (the scalp). Body skin
    # (neck, arms) is skin without hair around it.
    hair_b = cv2.GaussianBlur(hair, (0, 0), 6)
    skin_near_hair = skin * np.clip(hair_b / 0.25, 0, 1)
    score = np.clip(hair + skin_near_hair, 0, 1)
    score_b = cv2.GaussianBlur(score, (0, 0), 4)
    m = (score_b > 0.35).astype(np.uint8)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, k)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, k)
    n, lab, stats, cent = cv2.connectedComponentsWithStats(m)
    if n <= 1:
        return m, None
    # Largest component, with a bias for being near the frame centre.
    h, w = m.shape
    best, best_s = 0, -1
    for i in range(1, n):
        area = stats[i, cv2.CC_STAT_AREA]
        cx, cy = cent[i]
        d = np.hypot((cx - w / 2) / w, (cy - h / 2) / w)
        s = area * np.exp(-d * 2)
        if s > best_s:
            best, best_s = i, s
    blob = (lab == best).astype(np.uint8)
    # fill holes
    ff = blob.copy()
    cv2.floodFill(ff, np.zeros((h + 2, w + 2), np.uint8), (0, 0), 1)
    # pixels not reached by the fill from the corner and not blob are holes; the fill set background to 1
    holes = (ff == 0).astype(np.uint8)
    blob = blob | holes
    return blob, stats[best]

def ellipse_of(blob):
    ys, xs = np.nonzero(blob)
    if len(xs) < 50:
        return None
    pts = np.stack([xs, ys], 1).astype(np.float32)
    return cv2.fitEllipse(pts) if len(pts) >= 5 else None

def moments_of(blob):
    m = cv2.moments(blob, binaryImage=True)
    if m["m00"] == 0:
        return None
    cx, cy = m["m10"] / m["m00"], m["m01"] / m["m00"]
    mu20, mu02, mu11 = m["mu20"] / m["m00"], m["mu02"] / m["m00"], m["mu11"] / m["m00"]
    # Equivalent ellipse: axes from eigenvalues
    common = np.sqrt(((mu20 - mu02) ** 2) + 4 * mu11 ** 2)
    l1 = (mu20 + mu02 + common) / 2
    l2 = (mu20 + mu02 - common) / 2
    a = 2 * np.sqrt(max(l1, 1e-6))  # semi-major axis of equivalent ellipse
    b = 2 * np.sqrt(max(l2, 1e-6))
    angle = 0.5 * np.arctan2(2 * mu11, mu20 - mu02)
    return cx, cy, a, b, angle

sheet = []
report = []
for p in manifest["photos"]:
    if p["view"] != "crown":
        continue
    bgr = load(os.path.join(root, "images", p["file"]))
    skin, hair, tex = masks(bgr)
    blob, st = head_blob(skin, hair)
    # Scalp patch: skin inside the head blob
    patch = skin * blob
    patch_b = cv2.GaussianBlur(patch, (0, 0), 5)
    mo = moments_of(blob)
    vis = bgr.copy()
    cnts, _ = cv2.findContours(blob, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(vis, cnts, -1, (0, 255, 0), 2)
    if mo:
        cx, cy, a, b, ang = mo
        cv2.ellipse(vis, (int(cx), int(cy)), (int(a), int(b)), float(np.degrees(ang)), 0, 360, (255, 0, 255), 1)
        # patch centroid
        pm = cv2.moments(patch_b)
        if pm["m00"] > 0:
            px, py = pm["m10"] / pm["m00"], pm["m01"] / pm["m00"]
            cv2.circle(vis, (int(px), int(py)), 5, (0, 0, 255), -1)
            cv2.line(vis, (int(cx), int(cy)), (int(px), int(py)), (255, 255, 0), 2)
            report.append({"file": p["file"], "head": [round(cx / W * 100, 1), round(cy / bgr.shape[0] * 100, 1)], "axes": [round(a / W, 3), round(b / W, 3)], "patch": [round(px / W * 100, 1), round(py / bgr.shape[0] * 100, 1)]})
    def col(x):
        return cv2.applyColorMap((np.clip(x, 0, 1) * 255).astype(np.uint8), cv2.COLORMAP_VIRIDIS)
    row = np.concatenate([vis, col(skin), col(hair), col(patch_b * 3)], 1)
    cv2.putText(row, p["file"][:15], (4, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
    sheet.append(row)
# pad rows to the same height and tile 2 per line
hmax = max(r.shape[0] for r in sheet)
sheet = [np.pad(r, ((0, hmax - r.shape[0]), (0, 0), (0, 0))) for r in sheet]
rows = [np.concatenate(sheet[i:i + 2], 1) if i + 1 < len(sheet) else np.concatenate([sheet[i], np.zeros_like(sheet[i])], 1) for i in range(0, len(sheet), 2)]
cv2.imwrite(os.path.join(out, "segment_sheet.jpg"), np.concatenate(rows, 0), [cv2.IMWRITE_JPEG_QUALITY, 80])
json.dump(report, open(os.path.join(out, "segment.json"), "w"), indent=1)
# Compare the patch centre with the hand landmarks
lm = json.load(open(os.path.join(root, "landmarks.json")))["crown"]
errs = []
for r in report:
    t = lm[r["file"]]["patch"]
    # percent units differ per axis; convert to percent of width for y using aspect
    im_h_over_w = 4000 / 2252 if "23777" not in r["file"] and "1564" not in r["file"] else 3392 / 1564
    e = np.hypot(r["patch"][0] - t[0], (r["patch"][1] - t[1]) * im_h_over_w)
    errs.append(e)
    print(f'{r["file"][:15]} head {r["head"]} axes {r["axes"]} patch {r["patch"]} truth {t} err {e:.1f}% of width')
print("median patch error % width:", np.median(errs), "max:", max(errs))
