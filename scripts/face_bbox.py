#!/usr/bin/env python3
"""出镜素材 → 实测人脸 bbox + 文字安全区(本机 CPU, OpenCV YuNet)。

    .venv/bin/python scripts/face_bbox.py <video> [--step 1.5] [--json out.json]

**为什么要有这个脚本。**

`src/lib/video/text-zone.ts` 里原来这么写: 「人在哪边由人设定, 不假装能自动识别:
真做人像分割要 matting, 是另一个量级的工程, 而猜错的代价是字直接糊在脸上。」

那个判断是错的。要避开人脸并不需要人像分割 —— 只要人脸的 bbox。YuNet 模型 230KB,
纯 CPU 每帧几毫秒。代价被高估了一个量级, 于是这件本该量出来的事被交给了手填的
「人在左/中/右」, 而手填是会填错的, 填错就是字糊在脸上。

**铁律: 安全区必须来自实测 bbox, 不目测、不用亮度阈值猜。**

**输出的是逐时刻的人脸位置, 不是一个静态安全区。**

这一点是实测逼出来的, 而且和最初的设想不一样: 真实素材里 76 个检出框**尺寸高度
一致**(547x601, 波动 ±6%), 但**位置横跨几乎整个画面**(x 从 -2 到 1077, y 从 20 到
1715) —— 人在 155 秒里一直在动。于是全时段并集覆盖 95% 画面, 「静态安全区」这个
答案技术上正确、实用上等于没有: 按它排, 一个字都放不下。

真正可用的是**按时间段算**: 每条文字叠加都有自己的起止时间, 只需要那几秒里脸不在的
位置。所以脚本输出逐采样点的人脸框, 由调用方按时间窗口求安全带
(见 `src/lib/video/face-safe-zone.ts`)。

输出 JSON(坐标为素材像素系):
  {video, size:[w,h], step, sampled, detected, detect_rate, reliable,
   union_face:[x,y,w,h],   # 全时段人脸 bbox 并集 —— 人在片中会动, 单帧不够
   avoid:[x,y,w,h],        # 并集向外扩: 上 +60%(含头发/手势)、左右 +20%、四周再 +30px
   text_bands:[{y,h,where}],  # 不被 avoid 碰到的横带, where = top|bottom
   person_side}            # left|center|right, 由 bbox 中心横向位置推出
"""
import argparse
import json
import os
import sys
import urllib.request

MODEL_URL = (
    "https://github.com/opencv/opencv_zoo/raw/main/models/"
    "face_detection_yunet/face_detection_yunet_2023mar.onnx"
)
MODEL_DIR = os.path.expanduser("~/.cache/mediapilot")
MODEL_PATH = os.path.join(MODEL_DIR, "face_detection_yunet_2023mar.onnx")


def ensure_model() -> str:
    """模型 230KB, 首次自动下载。放 ~/.cache 而不是项目里 —— 它不属于代码。"""
    if not os.path.exists(MODEL_PATH):
        os.makedirs(MODEL_DIR, exist_ok=True)
        urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
    return MODEL_PATH


def median(xs):
    ys = sorted(xs)
    n = len(ys)
    return ys[n // 2] if n % 2 else (ys[n // 2 - 1] + ys[n // 2]) / 2


def filter_outliers(boxes):
    """按尺寸一致性剔掉误检。

    同一个人在同一条素材里, 脸的尺寸是稳定的(实测 w 512~571 / h 505~601, 波动 ±6%),
    而误检的框大小五花八门。所以用中位尺寸做基准, 偏离超过一半的直接扔掉。

    **不能只靠检测分数**: 分数调高会漏掉侧脸和低头(实测漏 62%), 而漏检让并集偏小,
    偏小的安全区比没有更危险 —— 字会正好压在漏掉的那些帧的脸上。
    """
    if len(boxes) < 4:
        return boxes
    mw = median([b[2] for b in boxes])
    mh = median([b[3] for b in boxes])
    kept = [b for b in boxes if 0.5 * mw <= b[2] <= 1.6 * mw and 0.5 * mh <= b[3] <= 1.6 * mh]
    return kept or boxes


def main() -> int:
    import cv2

    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--step", type=float, default=1.5, help="每几秒取一帧")
    ap.add_argument("--json", default=None)
    args = ap.parse_args()

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        print(json.dumps({"error": f"打不开视频: {args.video}"}, ensure_ascii=False))
        return 1

    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # 门槛取 0.5 拿到高召回, 误检靠后面的一致性过滤剔掉。
    # 实测: 0.7 只检出 38%(侧脸/低头全漏), 而 0.5 检出 97% 但混进大量误检 ——
    # 两个极端的并集都不能用(一个偏小把字压在脸上, 一个吞掉整屏)。
    det = cv2.FaceDetectorYN.create(ensure_model(), "", (w, h), 0.5, 0.3, 5000)

    stride = max(1, int(fps * args.step))
    sampled = 0
    boxes = []
    samples = []
    for idx in range(0, total, stride):
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame = cap.read()
        if not ok:
            break
        sampled += 1
        _, faces = det.detect(frame)
        if faces is None:
            continue
        # 一帧里多张脸时取最大的那张 —— 出镜口播的主体
        f = max(faces, key=lambda r: r[2] * r[3])
        boxes.append([float(f[0]), float(f[1]), float(f[2]), float(f[3])])
        samples.append({"t": round(idx / fps, 2),
                        "face": [round(float(f[0])), round(float(f[1])),
                                 round(float(f[2])), round(float(f[3]))]})
    cap.release()

    if not boxes:
        print(json.dumps({
            "video": args.video, "size": [w, h], "step": args.step,
            "sampled": sampled, "detected": 0, "detect_rate": 0.0,
            "union_face": None, "safe_zone": None, "person_side": None,
            "note": "一帧都没检出人脸 —— 可能不是出镜素材, 或者人脸太小/被遮挡",
        }, ensure_ascii=False))
        return 0

    keep = filter_outliers(boxes)
    kept_ids = {id(b) for b in keep}
    samples = [s for s, b in zip(samples, boxes) if id(b) in kept_ids]
    boxes = keep
    x0 = min(b[0] for b in boxes)
    y0 = min(b[1] for b in boxes)
    x1 = max(b[0] + b[2] for b in boxes)
    y1 = max(b[1] + b[3] for b in boxes)
    uw, uh = x1 - x0, y1 - y0

    # 向外扩: 上方多留(头发/举手), 左右适度, 四周再给固定余量
    pad = 30.0
    sx0 = max(0.0, x0 - uw * 0.20 - pad)
    sy0 = max(0.0, y0 - uh * 0.60 - pad)
    sx1 = min(float(w), x1 + uw * 0.20 + pad)
    sy1 = min(float(h), y1 + uh * 0.20 + pad)

    cx = (sx0 + sx1) / 2 / w
    side = "left" if cx < 0.4 else ("right" if cx > 0.6 else "center")

    # 文字能放的横带 = 画面减去 avoid 区之后, 上下各剩的那一条
    bands = []
    if sy0 > 40:
        bands.append({"y": 0, "h": round(sy0), "where": "top"})
    if h - sy1 > 40:
        bands.append({"y": round(sy1), "h": round(h - sy1), "where": "bottom"})

    rate = round(len(boxes) / max(1, sampled), 3)
    out = {
        "video": args.video, "size": [w, h], "step": args.step,
        "sampled": sampled, "detected": len(boxes),
        "detect_rate": rate,
        # 检出率太低时并集会偏小, 偏小的安全区比没有更危险 —— 明说不可信, 让调用方退回手填
        "reliable": rate >= 0.5,
        "union_face": [round(x0), round(y0), round(uw), round(uh)],
        "avoid": [round(sx0), round(sy0), round(sx1 - sx0), round(sy1 - sy0)],
        "text_bands": bands,
        "person_side": side,
        # 逐采样点的人脸位置 —— 静态安全区在真实素材上不成立, 按时间段算才有用
        "samples": samples,
    }
    print(json.dumps(out, ensure_ascii=False))
    if args.json:
        with open(args.json, "w", encoding="utf-8") as fp:
            json.dump(out, fp, ensure_ascii=False, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
