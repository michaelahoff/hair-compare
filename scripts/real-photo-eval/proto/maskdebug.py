import os, sys, json
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(__file__))
from headalign import resize_w, skin_map, texture_map, hair_map
root = ".model-eval/hoff"
files = sys.argv[1:]
rows = []
for f in files:
    bgr = resize_w(cv2.imread(os.path.join(root, "images", f)), 256)
    Y = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    skin = skin_map(bgr)
    tex = texture_map(Y, 1.2, 3)
    hair = hair_map(Y, tex)
    def col(x, hi=1):
        return cv2.applyColorMap((np.clip(x / hi, 0, 1) * 255).astype(np.uint8), cv2.COLORMAP_VIRIDIS)
    ycc = cv2.cvtColor(bgr, cv2.COLOR_BGR2YCrCb)
    row = np.concatenate([bgr, col(skin), col(tex, 12), col(hair), col(Y, 255), col(ycc[...,1].astype(np.float32)-120, 50)], 1)
    cv2.putText(row, f[:15], (4, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
    rows.append(row)
hmax = max(r.shape[0] for r in rows)
rows = [np.pad(r, ((0, hmax - r.shape[0]), (0, 0), (0, 0))) for r in rows]
cv2.imwrite(os.path.join(root, "proto", "maskdebug.jpg"), np.concatenate(rows, 0), [cv2.IMWRITE_JPEG_QUALITY, 80])
# stats inside the hand-marked patch vs elsewhere
