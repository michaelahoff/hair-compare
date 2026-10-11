import os, sys, json
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(__file__))
from headalign import resize_w, head_mask
root = sys.argv[1] if len(sys.argv) > 1 else ".model-eval/hoff"
manifest = json.load(open(os.path.join(root, "manifest.json")))
lm = json.load(open(os.path.join(root, "landmarks.json"))).get("crown", {})
tiles = []
errs = []
for p in manifest["photos"]:
    bgr = resize_w(cv2.imread(os.path.join(root, "images", p["file"])), 200)
    blob, skin, hair = head_mask(bgr)
    vis = bgr.copy()
    cnts, _ = cv2.findContours(blob, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(vis, cnts, -1, (0, 255, 0), 2)
    patch = cv2.GaussianBlur(skin * blob, (0, 0), 4)
    mo = cv2.moments(patch)
    if mo["m00"] > 0:
        px, py = mo["m10"] / mo["m00"], mo["m01"] / mo["m00"]
        cv2.circle(vis, (int(px), int(py)), 4, (0, 0, 255), -1)
        if p["file"] in lm:
            t = lm[p["file"]]["patch"]
            e = np.hypot(px / 200 * 100 - t[0], (py / bgr.shape[0] * 100 - t[1]) * bgr.shape[0] / 200)
            errs.append((p["file"][:15], round(float(e), 1)))
    cv2.putText(vis, p["file"][9:15] + " " + p["view"][:5], (3, 12), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 0), 1)
    tiles.append(vis)
hmax = max(t.shape[0] for t in tiles)
tiles = [np.pad(t, ((0, hmax - t.shape[0]), (0, 0), (0, 0))) for t in tiles]
rows = [np.concatenate(tiles[i:i + 6], 1) for i in range(0, len(tiles), 6)]
wmax = max(r.shape[1] for r in rows)
rows = [np.pad(r, ((0, 0), (0, wmax - r.shape[1]), (0, 0))) for r in rows]
cv2.imwrite(os.path.join(root, "proto", "masksheet.jpg"), np.concatenate(rows, 0), [cv2.IMWRITE_JPEG_QUALITY, 82])
print(errs)
print("median err % width", np.median([e for _, e in errs]), "max", max(e for _, e in errs))
