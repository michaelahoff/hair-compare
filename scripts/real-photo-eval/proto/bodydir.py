"""Which way is the body? Score angular sectors just outside the head mask
by neck/collar skin and by smooth, untextured fabric, and compare the peak
with the hand-marked neck direction."""
import json, os, sys
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(__file__))
from headalign import head_mask, resize_w, skin_map, texture_map

root = ".model-eval/hoff"
lm = json.load(open(f"{root}/landmarks.json"))["crown"]
manifest = {p["file"]: p for p in json.load(open(f"{root}/manifest.json"))["photos"]}

def body_direction(bgr, mask, skin, nsect=36):
    """Returns (angle, confidence, profile) with angle in image coords (0 = +x, clockwise with y down)."""
    h, w = mask.shape
    Y = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    s = w / 256.0
    tex = texture_map(Y, 1.2 * s, 3 * s) / s
    smooth = np.clip((4 - tex) / 3, 0, 1)
    # edges at a coarser scale: grout lines, cabinet edges, bottles
    g = cv2.GaussianBlur(Y, (0, 0), 2 * s)
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3); gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    edge = np.sqrt(gx * gx + gy * gy)
    edge_b = cv2.GaussianBlur(edge, (0, 0), 4 * s)
    clean = np.clip((12 - edge_b) / 10, 0, 1)
    m = cv2.moments(mask, binaryImage=True)
    cx, cy = m["m10"] / m["m00"], m["m01"] / m["m00"]
    R = np.sqrt(m["m00"] / np.pi)
    dt_out = cv2.distanceTransform((1 - mask).astype(np.uint8), cv2.DIST_L2, 5)  # distance from the head, outside it
    band = (mask == 0) & (dt_out > 0.03 * R) & (dt_out < 0.45 * R)
    yy, xx = np.mgrid[0:h, 0:w]
    ang = np.arctan2(yy - cy, xx - cx)
    sect = ((ang + np.pi) / (2 * np.pi) * nsect).astype(int) % nsect
    prof_skin = np.zeros(nsect); prof_smooth = np.zeros(nsect); prof_clean = np.zeros(nsect); cnt = np.zeros(nsect)
    sel = band
    np.add.at(cnt, sect[sel], 1)
    np.add.at(prof_skin, sect[sel], skin[sel])
    np.add.at(prof_smooth, sect[sel], smooth[sel])
    np.add.at(prof_clean, sect[sel], clean[sel])
    cnt = np.maximum(cnt, 1)
    prof_skin /= cnt; prof_smooth /= cnt; prof_clean /= cnt
    # Shoulders span a wide arc: smooth over ±45°.
    k = np.exp(-0.5 * (np.arange(-nsect // 4, nsect // 4 + 1) / (nsect / 12)) ** 2); k /= k.sum()
    def circ(p):
        return np.convolve(np.concatenate([p[-len(k)//2:], p, p[:len(k)//2]]), k, mode="valid")[: nsect]
    skin_c = circ(prof_skin); smooth_c = circ(prof_smooth * prof_clean)
    score = 3.0 * skin_c + smooth_c
    # The body spans a wide arc (both shoulders and the neck between them), so
    # take the centre of the strong arc rather than its strongest sector.
    centres = (np.arange(nsect) + 0.5) / nsect * 2 * np.pi - np.pi
    wgt = np.clip(score - np.percentile(score, 40), 0, None) ** 2
    vx, vy = (wgt * np.cos(centres)).sum(), (wgt * np.sin(centres)).sum()
    angle = float(np.arctan2(vy, vx))
    conf = float(np.hypot(vx, vy) / (wgt.sum() + 1e-9))
    return angle, conf, dict(skin=skin_c, smooth=smooth_c, score=score), (cx, cy, R)

if __name__ == "__main__":
    errs = []
    for f, mk in lm.items():
        bgr = resize_w(cv2.imread(f"{root}/images/{f}"), 256)
        mask, skin, hair = head_mask(bgr)
        angle, conf, prof, (cx, cy, R) = body_direction(bgr, mask, skin)
        H, W = bgr.shape[:2]
        px = np.array([mk["patch"][0] / 100 * W, mk["patch"][1] / 100 * H]); nk = np.array([mk["neck"][0] / 100 * W, mk["neck"][1] / 100 * H])
        truth = np.arctan2(nk[1] - px[1], nk[0] - px[0])
        err = abs((np.degrees(angle - truth) + 180) % 360 - 180)
        errs.append(err)
        print(f"{f[:15]} body {np.degrees(angle):6.0f}°  truth {np.degrees(truth):6.0f}°  err {err:4.0f}°  conf {conf:.1f}  skinpeak {prof['skin'].max():.2f} smoothpeak {prof['smooth'].max():.2f}")
    errs = np.array(errs)
    print("within 30°:", (errs < 30).sum(), "/", len(errs), " within 45°:", (errs < 45).sum(), " median", np.median(errs))
