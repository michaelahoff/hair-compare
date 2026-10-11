"""Prototype head-aware similarity registration.

Features per photo (at a working width): a head mask, a smoothed skin map and
an edge map, the last two standardised inside the mask. Registration is the
same coarse-to-fine search as src/lib/alignment/register.ts, but the NCC is
masked to pixels both heads cover and averages the two channels.
"""
import json, os, sys, time
import numpy as np, cv2

def resize_w(im, width):
    h = round(im.shape[0] * width / im.shape[1])
    return cv2.resize(im, (width, h), interpolation=cv2.INTER_AREA)

def skin_map(bgr):
    ycc = cv2.cvtColor(bgr, cv2.COLOR_BGR2YCrCb).astype(np.float32)
    Y, Cr, Cb = ycc[..., 0], ycc[..., 1], ycc[..., 2]
    return np.clip((Cr - 138) / 12, 0, 1) * np.clip((132 - Cb) / 12, 0, 1) * np.clip((Y - 60) / 40, 0, 1)

def texture_map(Y, fine=1.2, window=3):
    blur = cv2.GaussianBlur(Y, (0, 0), fine)
    return np.sqrt(cv2.GaussianBlur((Y - blur) ** 2, (0, 0), window))

def hair_map(Y, tex):
    dark = np.clip((110 - Y) / 50, 0, 1)
    h = dark * np.clip(tex / 6, 0, 1) + np.clip((70 - Y) / 30, 0, 1) * np.clip(tex / 3, 0, 1)
    return np.clip(h, 0, 1)

def fill_holes(blob):
    """Fill enclosed holes: background components that never touch the border."""
    bg = (blob == 0).astype(np.uint8)
    n, lab = cv2.connectedComponents(bg, connectivity=4)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])))
    out = blob.copy()
    for i in range(1, n):
        if i not in border:
            out[lab == i] = 1
    return out

DISC_FACTOR = 1.25

def core_of(blob, s):
    """The fat part of a blob: pixels within reach of its thickest core, so
    thin attachments (arms, collars, strips of floor) fall away."""
    h, w = blob.shape
    dt = cv2.distanceTransform(blob, cv2.DIST_L2, 5)
    r = dt.max()
    if r < 4 * s:
        return blob
    core = (dt > 0.45 * r).astype(np.uint8)
    n, lab, st, cent = cv2.connectedComponentsWithStats(core)
    h, w = blob.shape
    best, best_v = 1, -1
    for i in range(1, n):
        v = dt[lab == i].max()
        if v > best_v:
            best, best_v = i, v
    core = (lab == best).astype(np.uint8)
    rad = int(0.45 * r + 3 * s) | 1
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * rad + 1, 2 * rad + 1))
    grown = cv2.dilate(core, k) & blob
    # A head seen from above is round: nothing further from the thickest
    # point than about its inscribed radius belongs to it (sinks, cabinets
    # and collars that merged into the blob are cut off here).
    ys, xs = np.nonzero(core)
    cy, cx = ys.mean(), xs.mean()
    yy, xx = np.mgrid[0:h, 0:w]
    disc = (np.hypot(xx - cx, yy - cy) <= DISC_FACTOR * r + 3 * s).astype(np.uint8)
    return fill_holes(grown & disc)

def head_mask(bgr):
    """The head: finely textured pixels that are dark (hair), reddish (scalp
    through stubble or thin hair) or mid-grey (grey hair), plus skin enclosed
    by or next to them. The largest such blob near the frame centre, holes
    filled."""
    Y = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    w = bgr.shape[1]
    s = w / 256.0
    ycc = cv2.cvtColor(bgr, cv2.COLOR_BGR2YCrCb).astype(np.float32)
    Cr, Cb = ycc[..., 1], ycc[..., 2]
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
    S = hsv[..., 1]
    skin = skin_map(bgr)
    tex = texture_map(Y, 1.2 * s, 3 * s) / s
    # Fine texture well above what tiles, fabric and walls show (they sit
    # around 3-6 at this scale; hair and stubble above 8).
    strong = np.clip((tex - 6) / 4, 0, 1)
    very = np.clip((tex - 10) / 4, 0, 1)
    dark = np.clip((120 - Y) / 40, 0, 1)
    reddish = np.clip((Cr - 136) / 8, 0, 1) * np.clip((134 - Cb) / 10, 0, 1)
    grey = np.clip((60 - S) / 30, 0, 1) * np.clip((190 - Y) / 40, 0, 1) * np.clip((Y - 50) / 30, 0, 1)
    # Dark hair needs less texture to count (long hair reads darker than it is busy).
    hairness = np.clip(dark * np.clip(tex / 4, 0, 1) + strong * dark + very * np.clip(reddish + grey, 0, 1), 0, 1)
    hair_b = cv2.GaussianBlur(hairness, (0, 0), 6 * s)
    near_hair = np.clip(hair_b / 0.2, 0, 1)
    score = np.clip(hairness + skin * near_hair, 0, 1)
    score_b = cv2.GaussianBlur(score, (0, 0), 4 * s)
    m = (score_b > 0.3).astype(np.uint8)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(15 * s) | 1, int(15 * s) | 1))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, k)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, k)
    n, lab, stats, cent = cv2.connectedComponentsWithStats(m)
    if n <= 1:
        return np.ones_like(m), skin, hairness
    h, w = m.shape
    best, best_s = 0, -1
    for i in range(1, n):
        area = stats[i, cv2.CC_STAT_AREA]
        cx, cy = cent[i]
        d = np.hypot((cx - w / 2) / w, (cy - h / 2) / w)
        sc = area * np.exp(-d * 2)
        if sc > best_s:
            best, best_s = i, sc
    blob = (lab == best).astype(np.uint8)
    blob = fill_holes(blob)
    blob = core_of(blob, s)
    return blob, skin, hairness

def standardize_in(x, m):
    v = x[m > 0]
    if v.size < 10:
        return np.zeros_like(x)
    mu, sd = v.mean(), v.std() + 1e-6
    out = (x - mu) / sd
    out[m == 0] = 0
    return out.astype(np.float32)

class Features:
    def __init__(self, bgr, mask, width):
        self.width = width
        im = resize_w(bgr, width)
        m = cv2.resize(mask, (im.shape[1], im.shape[0]), interpolation=cv2.INTER_AREA)
        self.mask = (m > 0.5).astype(np.float32)
        Y = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
        skin = skin_map(im)
        s = width / 256.0
        self.skin = standardize_in(cv2.GaussianBlur(skin, (0, 0), max(1.0, 4 * s)), self.mask)
        g = cv2.GaussianBlur(Y, (0, 0), max(0.8, 1.0 * s))
        gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
        edge = np.sqrt(gx * gx + gy * gy)
        # Erode the mask a little for edges so the head's own outline doesn't dominate
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(5 * s) | 1, int(5 * s) | 1))
        inner = cv2.erode(self.mask, k)
        self.edge = standardize_in(edge, inner)
        self.edge_mask = inner
        self.h, self.w = self.mask.shape

def build_features(bgr_full, widths):
    base = resize_w(bgr_full, 256)
    mask, skin, hair = head_mask(base)
    mask_full = cv2.resize(mask.astype(np.float32), (bgr_full.shape[1], bgr_full.shape[0]), interpolation=cv2.INTER_LINEAR)
    feats = {w: Features(bgr_full, mask_full, w) for w in widths}
    return feats, mask

def affine_for(t, ref_shape, tgt_shape):
    """Pixel affine mapping ref pixels -> target pixels for a similarity in width units."""
    rh, rw = ref_shape
    th, tw = tgt_shape
    c, s = np.cos(t["rotation"]) * t["scale"], np.sin(t["rotation"]) * t["scale"]
    rcx, rcy = (rw - 1) / 2, (rh - 1) / 2
    tcx, tcy = (tw - 1) / 2, (th - 1) / 2
    a = c * tw / rw
    b = s * tw / rw
    ox = t["tx"] * tw + tcx - a * rcx + b * rcy
    oy = t["ty"] * tw + tcy - b * rcx - a * rcy
    return np.array([[a, -b, ox], [b, a, oy]], np.float32)

def warp_to_ref(img, A, ref_shape):
    rh, rw = ref_shape
    # A maps ref -> target; warpAffine with WARP_INVERSE_MAP samples target at A(ref)
    return cv2.warpAffine(img, A, (rw, rh), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_CONSTANT, borderValue=0)

MIN_OVERLAP = 0.3

def ncc_masked(a, b, m):
    n = m.sum()
    if n < 20:
        return -1.0
    am = (a * m).sum() / n
    bm = (b * m).sum() / n
    da = (a - am) * m
    db = (b - bm) * m
    va = (da * da).sum()
    vb = (db * db).sum()
    if va <= 0 or vb <= 0:
        return -1.0
    return float((da * db).sum() / np.sqrt(va * vb))

def score(ref, tgt, t, w_skin=0.5):
    A = affine_for(t, (ref.h, ref.w), (tgt.h, tgt.w))
    wm = warp_to_ref(tgt.mask, A, (ref.h, ref.w))
    wem = warp_to_ref(tgt.edge_mask, A, (ref.h, ref.w))
    m = (wm > 0.5) & (ref.mask > 0.5)
    if m.sum() < MIN_OVERLAP * min(ref.mask.sum(), 1e9):
        return -1.0
    ws = warp_to_ref(tgt.skin, A, (ref.h, ref.w))
    we = warp_to_ref(tgt.edge, A, (ref.h, ref.w))
    me = (wem > 0.5) & (ref.edge_mask > 0.5)
    s1 = ncc_masked(ref.skin, ws, m.astype(np.float32))
    s2 = ncc_masked(ref.edge, we, me.astype(np.float32))
    return w_skin * s1 + (1 - w_skin) * s2

def coarse(ref, tgt, rot_step=15, scales=(0.62, 1.6), scale_step=1.2, max_shift=0.25, keep=8, w_skin=0.5):
    found = []
    w = ref.w
    rots = np.deg2rad(np.arange(-180, 180, rot_step))
    sc = []
    s0 = scales[0]
    while s0 <= scales[1] * 1.0001:
        sc.append(s0); s0 *= scale_step
    max_px = int(np.ceil(max_shift * w))
    for rot in rots:
        for s in sc:
            t = {"rotation": float(rot), "scale": s, "tx": 0.0, "ty": 0.0}
            A = affine_for(t, (ref.h, ref.w), (tgt.h, tgt.w))
            wm = warp_to_ref(tgt.mask, A, (ref.h, ref.w)) > 0.5
            ws = warp_to_ref(tgt.skin, A, (ref.h, ref.w))
            we = warp_to_ref(tgt.edge, A, (ref.h, ref.w))
            wem = warp_to_ref(tgt.edge_mask, A, (ref.h, ref.w)) > 0.5
            for dy in range(-max_px, max_px + 1):
                for dx in range(-max_px, max_px + 1):
                    # ref(p) vs warped(p + d)
                    y0, y1 = max(0, -dy), min(ref.h, ref.h - dy)
                    x0, x1 = max(0, -dx), min(ref.w, ref.w - dx)
                    if y1 - y0 < 4 or x1 - x0 < 4:
                        continue
                    rm = ref.mask[y0:y1, x0:x1] > 0.5
                    m = rm & wm[y0 + dy:y1 + dy, x0 + dx:x1 + dx]
                    if m.sum() < MIN_OVERLAP * (ref.mask > 0.5).sum():
                        continue
                    mf = m.astype(np.float32)
                    s1 = ncc_masked(ref.skin[y0:y1, x0:x1], ws[y0 + dy:y1 + dy, x0 + dx:x1 + dx], mf)
                    me = (ref.edge_mask[y0:y1, x0:x1] > 0.5) & wem[y0 + dy:y1 + dy, x0 + dx:x1 + dx]
                    s2 = ncc_masked(ref.edge[y0:y1, x0:x1], we[y0 + dy:y1 + dy, x0 + dx:x1 + dx], me.astype(np.float32))
                    sc_ = w_skin * s1 + (1 - w_skin) * s2
                    c, sn = np.cos(rot) * s, np.sin(rot) * s
                    du, dv = dx / w, dy / w
                    found.append((sc_, {"rotation": float(rot), "scale": s, "tx": c * du - sn * dv, "ty": sn * du + c * dv}))
    found.sort(key=lambda f: -f[0])
    picked = []
    for s_, t in found:
        ok = True
        for p in picked:
            dr = abs((t["rotation"] - p["rotation"] + np.pi) % (2 * np.pi) - np.pi)
            if dr <= np.deg2rad(rot_step * 1.5) and abs(np.log(p["scale"] / t["scale"])) <= np.log(scale_step) * 1.5 and np.hypot(p["tx"] - t["tx"], p["ty"] - t["ty"]) <= 3 / w:
                ok = False; break
        if ok:
            picked.append(t)
        if len(picked) == keep:
            break
    return picked

def refine(ref, tgt, init, rot_step, log_scale_step, w_skin=0.5):
    best = dict(init)
    best_s = score(ref, tgt, best, w_skin)
    tstep = 1 / ref.w
    min_t = 0.2 / ref.w
    for _ in range(300):
        if tstep < min_t:
            break
        moves = [
            {**best, "tx": best["tx"] + tstep}, {**best, "tx": best["tx"] - tstep},
            {**best, "ty": best["ty"] + tstep}, {**best, "ty": best["ty"] - tstep},
            {**best, "rotation": best["rotation"] + rot_step}, {**best, "rotation": best["rotation"] - rot_step},
            {**best, "scale": best["scale"] * np.exp(log_scale_step)}, {**best, "scale": best["scale"] * np.exp(-log_scale_step)},
        ]
        improved = False
        for mv in moves:
            if mv["scale"] < 0.5 or mv["scale"] > 1.92:
                continue
            s_ = score(ref, tgt, mv, w_skin)
            if s_ > best_s + 1e-7:
                best, best_s, improved = mv, s_, True
        if not improved:
            tstep /= 2; rot_step /= 2; log_scale_step /= 2
    best["rotation"] = float((best["rotation"] + np.pi) % (2 * np.pi) - np.pi)
    return best, best_s

def align(ref_feats, tgt_feats, widths, w_skin=0.5):
    cands = [(c, -1e9) for c in coarse(ref_feats[widths[0]], tgt_feats[widths[0]], w_skin=w_skin)]
    if not cands:
        return {"rotation": 0, "scale": 1, "tx": 0, "ty": 0}, 0.0
    rot_step = np.deg2rad(5)
    ls = np.log(1.15) / 2
    for w in widths:
        r, t = ref_feats[w], tgt_feats[w]
        cands = [refine(r, t, c, rot_step, ls, w_skin) for c, _ in cands]
        cands.sort(key=lambda c: -c[1])
        cands = cands[:max(1, len(cands) >> 2)]
        rot_step /= 2; ls /= 2
    return cands[0]

if __name__ == "__main__":
    root = sys.argv[1] if len(sys.argv) > 1 else ".model-eval/hoff"
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(root, "headalign")
    view = sys.argv[3] if len(sys.argv) > 3 else "crown"
    w_skin = float(sys.argv[4]) if len(sys.argv) > 4 else 0.5
    os.makedirs(out, exist_ok=True)
    manifest = json.load(open(os.path.join(root, "manifest.json")))
    photos = [p for p in manifest["photos"] if p["view"] == view]
    WIDTHS = [24, 48, 96, 192]
    feats = {}
    shows = {}
    t0 = time.time()
    for p in photos:
        bgr = cv2.imread(os.path.join(root, "images", p["file"]))
        bgr = resize_w(bgr, 768)
        feats[p["file"]], _ = build_features(bgr, WIDTHS)
        shows[p["file"]] = resize_w(bgr, 300)
    print(f"features {time.time() - t0:.1f}s")
    rows = []
    for i in range(len(photos)):
        for j in range(i + 1, len(photos)):
            a, b = photos[i]["file"], photos[j]["file"]
            t1 = time.time()
            t, s = align(feats[a], feats[b], WIDTHS, w_skin)
            ms = int((time.time() - t1) * 1000)
            row = {"ref": a, "target": b, "score": round(s, 3), "accepted": s >= 0.3,
                   "rotationDeg": round(np.degrees(t["rotation"]), 1), "scale": round(t["scale"], 3),
                   "tx": round(t["tx"], 3), "ty": round(t["ty"], 3), "ms": ms}
            rows.append(row)
            json.dump(rows, open(os.path.join(out, 'results.json'), 'w'), indent=1)
            print(f'{a[:15]} -> {b[:15]} score {row["score"]} rot {row["rotationDeg"]} scale {row["scale"]} t ({row["tx"]}, {row["ty"]}) {ms}ms', flush=True)
            # overlay: target | warped ref | checker | blend
            tg, rf = shows[b], shows[a]
            A = affine_for(t, rf.shape[:2], tg.shape[:2])
            # warp ref into target frame: need inverse mapping target->ref
            Ai = cv2.invertAffineTransform(A)
            warped = cv2.warpAffine(rf, Ai, (tg.shape[1], tg.shape[0]), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderValue=(48, 48, 48))
            yy, xx = np.mgrid[0:tg.shape[0], 0:tg.shape[1]]
            chk = (((xx // 32) + (yy // 32)) & 1).astype(bool)
            checker = np.where(chk[..., None], warped, tg)
            blend = ((tg.astype(np.uint16) + warped) // 2).astype(np.uint8)
            sheet = np.concatenate([tg, warped, checker, blend], 1)
            cv2.imwrite(os.path.join(out, f'{a[:15]}__{b[:15]}_{"acc" if row["accepted"] else "rej"}_{row["score"]}.jpg'), sheet, [cv2.IMWRITE_JPEG_QUALITY, 80])
    json.dump(rows, open(os.path.join(out, "results.json"), "w"), indent=1)
    print(f"{len(rows)} pairs in {time.time() - t0:.0f}s")
