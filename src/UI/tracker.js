"use strict";
/*
 * Tracker màn hình: đọc lớp hiển thị phím/chuột (keystroke overlay) trong video
 * hoặc từ màn hình đang chụp, dò phím nào đang sáng ở từng khung hình rồi đổi
 * thành các clip (mỗi lần giữ một phím / nút) cho timeline nhiều track của
 * trình tạo combo (cuscombo.html): mỗi phím / nút một track, thời điểm tính
 * tuyệt đối theo video nên không cộng dồn sai số làm tròn.
 *
 * Khung hình vẽ giống bản tracking thủ công: lưới đỏ có nhãn tọa độ vàng, khung vùng
 * xanh có tên phím, nhãn thời gian vàng; phóng to / thu nhỏ; bảng nhiều khung xếp cạnh nhau.
 * Không ghi đè combo nào: kết quả chỉ được gửi vào clipboard của trình tạo combo.
 */

const LS_KEY = "trackerConfig";
const CLIPBOARD_STORAGE = "comboClipboard";
const TRACKER_STORAGE = "trackerSteps";     // trình tạo combo đọc key này khi bấm "Nhập từ Tracker"
const COMMON_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120];

const KEY_TARGETS = [
    ..."qwertyuiopasdfghjklzxcvbnm1234567890".split(""),
    "tab", "shift", "shift_r", "ctrl", "ctrl_r", "alt", "alt_gr", "space", "enter", "esc", "caps_lock", "backspace",
    "up", "down", "left", "right", ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`)
];
const MOUSE_TARGETS = [
    ["left", "Chuột trái"], ["right", "Chuột phải"], ["middle", "Chuột giữa"],
    ["mouse_3", "Chuột phụ 1"], ["mouse_4", "Chuột phụ 2"]
];
const KEY_LABELS = {
    tab: "TAB", shift: "SHIFT", shift_r: "R-SHIFT", ctrl: "CTRL", ctrl_r: "R-CTRL", alt: "ALT", alt_gr: "R-ALT",
    space: "SPACE", enter: "ENTER", esc: "ESC", caps_lock: "CAPS", backspace: "BKSP"
};

// Mã phím Windows (NohBoard dùng mã này) -> tên phím của combo.
const VK_TARGETS = (() => {
    const map = {
        8: "backspace", 9: "tab", 13: "enter", 16: "shift", 160: "shift", 161: "shift_r", 17: "ctrl", 162: "ctrl",
        163: "ctrl_r", 18: "alt", 164: "alt", 165: "alt_gr", 20: "caps_lock", 27: "esc", 32: "space",
        37: "left", 38: "up", 39: "right", 40: "down"
    };
    for (let c = 65; c <= 90; c += 1) map[c] = String.fromCharCode(c + 32);
    for (let c = 48; c <= 57; c += 1) map[c] = String.fromCharCode(c);
    for (let i = 1; i <= 12; i += 1) map[111 + i] = `f${i}`;
    return map;
})();
// NohBoard: MouseKey.KeyCodes 0 trái, 1 phải, 2 giữa, 3 X1, 4 X2.
const NB_MOUSE = { 0: "left", 1: "right", 2: "middle", 3: "mouse_3", 4: "mouse_4" };

// Vị trí phím tính theo ô lưới: (cột, hàng) so với phím Q = (1, 1).
const KEY_TEMPLATE = [
    ["1", 1, 0], ["2", 2, 0], ["3", 3, 0], ["4", 4, 0],
    ["tab", 0, 1], ["q", 1, 1], ["w", 2, 1], ["e", 3, 1], ["r", 4, 1],
    ["shift", 0, 2], ["a", 1, 2], ["s", 2, 2], ["d", 3, 2], ["f", 4, 2],
    ["ctrl", 0, 3], ["alt", 1, 3], ["space", 3, 3]
];

const CALIB_STEPS = [
    ["Bấm vào TÂM phím Q", "q"],
    ["Bấm vào TÂM phím D", "d"],
    ["Bấm vào TÂM nút CHUỘT TRÁI", "left"],
    ["Bấm vào TÂM nút CHUỘT PHẢI", "right"]
];

const $ = (id) => document.getElementById(id);
const el = {};
[
    "fileInput", "screenBtn", "stopScreenBtn", "zoomOut", "zoomIn", "zoomFit", "zoom11", "zoomRegions",
    "zoomReadout", "gridToggle", "boxToggle", "canvasWrap", "view", "toolBanner", "prevBtn", "playBtn",
    "nextBtn", "seek", "timeReadout", "rateSel", "scanFrom", "scanTo", "setFrom", "setTo", "fpsInput",
    "measureFps", "scanBtn", "recBtn", "scanProgress", "scanStatus", "ppsRange", "timelineWrap", "timeline",
    "calibBtn", "clearRegions", "newTarget", "drawBtn", "regionList", "pickBtn", "swatch", "autoColor",
    "tolRange", "tolVal", "fracRange", "fracVal", "minLen", "gapFill", "trimStart", "summary", "sendBtn",
    "copyBtn", "downloadBtn", "toast", "eventList", "modeSingle", "modeSheet", "sheetBar", "sheetCount",
    "sheetCols", "sheetSize", "sheetBtn", "sheetWrap", "sheet", "nbInput", "noiseKeys", "openEditorBtn", "minLenKey"
].forEach((id) => { el[id] = $(id); });

const S = {
    source: "none",            // none | file | screen
    fileName: "",
    regions: [],               // {id, target, kind, x, y, w, h, use}
    nextId: 1,
    selected: null,
    color: null,               // [r,g,b] khi lấy màu mẫu, null = tự nhận vàng/xanh chanh
    tol: 70,
    minFrac: 0.30,
    minLen: 1,                 // chuột: click thật có thể chỉ 1 khung
    minLenKey: 2,              // phím bàn phím: sáng 1 khung thường là chớp nền game
    gapFill: 0,
    noiseKeys: 3,              // khung sáng >= N phím bàn phím = chớp sáng của game, bỏ qua (0 = tắt)
    trimStart: true,
    grid: true,
    boxes: true,
    fps: 30,
    samples: [],               // {t, on:[regionId...]}
    dt: 1 / 30,
    now: [],                   // id các vùng đang sáng ở khung hiện tại
    live: null,                // {t0} khi đang ghi màn hình
    scanning: false,
    cancel: false,
    tool: null,                // {type: calib|draw|pick, ...}
    events: [],
    clips: [],
    mode: "single",            // single | sheet
    sheet: null,               // {tiles:[{t, canvas, on}], crop}
    refSize: null,
    dirty: true
};

const V = { scale: 1, ox: 0, oy: 0 };
let cssW = 0;
let cssH = 0;
let dpr = 1;
const ctx = el.view.getContext("2d");

// ── Video nguồn + canvas ẩn để đọc điểm ảnh ─────────────────────────────────
const video = document.createElement("video");
video.muted = true;
video.playsInline = true;
video.style.cssText = "position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none";
document.body.appendChild(video);
const off = document.createElement("canvas");
const octx = off.getContext("2d", { willReadFrequently: true });

const hasFrame = () => video.readyState >= 2 && video.videoWidth > 0;
const vw = () => video.videoWidth;
const vh = () => video.videoHeight;
const markDirty = () => { S.dirty = true; };

function grabFrame() {
    if (off.width !== vw() || off.height !== vh()) {
        off.width = vw();
        off.height = vh();
    }
    octx.drawImage(video, 0, 0);
}

// ── Nhận diện phím sáng ─────────────────────────────────────────────────────
function isLit(r, g, b) {
    if (S.color) {
        const dr = r - S.color[0];
        const dg = g - S.color[1];
        const db = b - S.color[2];
        return dr * dr + dg * dg + db * db <= S.tol * S.tol;
    }
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    if (mx < 158) return false;
    const sat = (mx - mn) / mx;
    if (sat < 0.5) return false;
    const d = mx - mn;
    let hue;
    if (mx === r) hue = 60 * (((g - b) / d) % 6);
    else if (mx === g) hue = 60 * (2 + (b - r) / d);
    else hue = 60 * (4 + (r - g) / d);
    if (hue < 0) hue += 360;
    return hue >= 38 && hue <= 105;
}

// Tỉ lệ điểm ảnh "sáng" trong vùng (0..1) ở khung đã grab.
function regionFraction(region) {
    const x = Math.max(0, Math.round(region.x));
    const y = Math.max(0, Math.round(region.y));
    const w = Math.min(off.width - x, Math.round(region.w));
    const h = Math.min(off.height - y, Math.round(region.h));
    if (w < 1 || h < 1) return 0;
    const data = octx.getImageData(x, y, w, h).data;
    let hit = 0;
    for (let i = 0; i < data.length; i += 4) {
        if (isLit(data[i], data[i + 1], data[i + 2])) hit += 1;
    }
    return hit / (data.length / 4);
}

const regionLit = (region) => regionFraction(region) >= S.minFrac;

// Trả về id các vùng đang sáng ở khung hiện tại của video.
function detectAll() {
    if (!hasFrame() || !S.regions.length) return [];
    grabFrame();
    return S.regions.filter(regionLit).map((r) => r.id);
}

// ── Lưu / nạp thiết lập ─────────────────────────────────────────────────────
function persist() {
    try {
        localStorage.setItem(LS_KEY, JSON.stringify({
            regions: S.regions, nextId: S.nextId, color: S.color, tol: S.tol, minFrac: S.minFrac,
            minLen: S.minLen, minLenKey: S.minLenKey, gapFill: S.gapFill, noiseKeys: S.noiseKeys, trimStart: S.trimStart, grid: S.grid, boxes: S.boxes,
            fps: S.fps, refSize: S.refSize
        }));
    } catch { /* không lưu được thì thôi */ }
}

function restore() {
    let cfg = null;
    try { cfg = JSON.parse(localStorage.getItem(LS_KEY)); } catch { cfg = null; }
    if (!cfg) return;
    Object.assign(S, {
        regions: Array.isArray(cfg.regions) ? cfg.regions : [], nextId: cfg.nextId || 1,
        color: cfg.color || null, tol: cfg.tol ?? 70, minFrac: cfg.minFrac ?? 0.3,
        minLen: cfg.minLen ?? 1, minLenKey: cfg.minLenKey ?? 2, gapFill: cfg.gapFill ?? 0, noiseKeys: cfg.noiseKeys ?? 3,
        trimStart: cfg.trimStart ?? true,
        grid: cfg.grid ?? true, boxes: cfg.boxes ?? true, fps: cfg.fps || 30, refSize: cfg.refSize || null
    });
}

// ── Chuyển đổi tọa độ + vẽ khung hình ───────────────────────────────────────
const toVideo = (sx, sy) => [(sx - V.ox) / V.scale, (sy - V.oy) / V.scale];

function resizeCanvas() {
    const rect = el.canvasWrap.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    cssW = Math.max(1, rect.width);
    cssH = Math.max(1, rect.height);
    el.view.width = Math.round(cssW * dpr);
    el.view.height = Math.round(cssH * dpr);
    markDirty();
}

function fitRect(rect, margin = 0.92) {
    const s = Math.min(cssW / rect.w, cssH / rect.h) * margin;
    V.scale = s;
    V.ox = (cssW - rect.w * s) / 2 - rect.x * s;
    V.oy = (cssH - rect.h * s) / 2 - rect.y * s;
    markDirty();
}

function fitFrame() {
    if (hasFrame()) fitRect({ x: 0, y: 0, w: vw(), h: vh() }, 1);
}

function regionsBounds(pad = 0.25) {
    if (!S.regions.length) return null;
    const x0 = Math.min(...S.regions.map((r) => r.x));
    const y0 = Math.min(...S.regions.map((r) => r.y));
    const x1 = Math.max(...S.regions.map((r) => r.x + r.w));
    const y1 = Math.max(...S.regions.map((r) => r.y + r.h));
    const px = Math.max(24, (x1 - x0) * pad);
    const py = Math.max(24, (y1 - y0) * pad);
    return { x: x0 - px, y: y0 - py, w: x1 - x0 + px * 2, h: y1 - y0 + py * 2 };
}

function zoomAt(sx, sy, factor) {
    const [vx, vy] = toVideo(sx, sy);
    V.scale = Math.min(80, Math.max(0.05, V.scale * factor));
    V.ox = sx - vx * V.scale;
    V.oy = sy - vy * V.scale;
    markDirty();
}

function gridStepFor(scale) {
    for (const step of [1, 2, 5, 10, 20, 25, 50, 100, 200, 500]) {
        if (step * scale >= 40) return step;
    }
    return 500;
}

function drawGrid() {
    const step = gridStepFor(V.scale);
    const [x0, y0] = toVideo(0, 0);
    const [x1, y1] = toVideo(cssW, cssH);
    ctx.strokeStyle = "rgba(255,0,0,0.5)";
    ctx.fillStyle = "#ffff00";
    ctx.font = "bold 13px sans-serif";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
        const sx = Math.round(x * V.scale + V.ox) + 0.5;
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, cssH);
    }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
        const sy = Math.round(y * V.scale + V.oy) + 0.5;
        ctx.moveTo(0, sy);
        ctx.lineTo(cssW, sy);
    }
    ctx.stroke();
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
        ctx.fillText(String(x), x * V.scale + V.ox + 2, 12);
    }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
        ctx.fillText(String(y), 2, y * V.scale + V.oy + 12);
    }
}

function drawRegions(target, project, litIds, selectedId) {
    target.font = "bold 13px sans-serif";
    S.regions.forEach((r) => {
        const [sx, sy] = project(r.x, r.y);
        const [ex, ey] = project(r.x + r.w, r.y + r.h);
        const lit = litIds.includes(r.id);
        if (lit) {
            target.fillStyle = "rgba(253,224,71,0.28)";
            target.fillRect(sx, sy, ex - sx, ey - sy);
        }
        target.lineWidth = 2;
        target.strokeStyle = lit ? "#fde047" : "#00ff00";
        target.setLineDash(r.id === selectedId ? [5, 3] : []);
        target.strokeRect(sx, sy, ex - sx, ey - sy);
        target.setLineDash([]);
        target.fillStyle = "#ffff00";
        target.fillText(KEY_LABELS[r.target] || r.target, sx + 3, sy + 14);
        if (r.id === selectedId) {
            target.fillStyle = "#ffffff";
            target.fillRect(ex - 6, ey - 6, 8, 8);
        }
    });
}

function drawHud() {
    const label = `t=${video.currentTime.toFixed(3)}s`
        + (S.source === "file" ? `  khung #${Math.round(video.currentTime * S.fps)}` : "")
        + `  ${vw()}×${vh()}`;
    ctx.font = "bold 15px sans-serif";
    const w = ctx.measureText(label).width + 12;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(6, cssH - 28, w, 22);
    ctx.fillStyle = "#ffff00";
    ctx.fillText(label, 12, cssH - 12);
}

function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#05080f";
    ctx.fillRect(0, 0, cssW, cssH);
    if (!hasFrame()) {
        ctx.fillStyle = "#8fa0ba";
        ctx.font = "15px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Mở video hoặc bấm Chụp màn hình để bắt đầu", cssW / 2, cssH / 2);
        ctx.textAlign = "left";
        return;
    }
    S.now = detectAll();
    ctx.imageSmoothingEnabled = V.scale < 2.5;
    ctx.drawImage(video, V.ox, V.oy, vw() * V.scale, vh() * V.scale);
    if (S.grid) drawGrid();
    if (S.boxes) {
        drawRegions(ctx, (x, y) => [x * V.scale + V.ox, y * V.scale + V.oy], S.now, S.selected);
    }
    if (S.tool?.type === "draw" && S.tool.rect) {
        const r = S.tool.rect;
        ctx.strokeStyle = "#ffff00";
        ctx.lineWidth = 2;
        ctx.strokeRect(r.x * V.scale + V.ox, r.y * V.scale + V.oy, r.w * V.scale, r.h * V.scale);
    }
    if (S.tool?.type === "calib" || S.tool?.type === "nb") {
        ctx.fillStyle = "#ffff00";
        S.tool.points.forEach(([px, py]) => {
            ctx.beginPath();
            ctx.arc(px * V.scale + V.ox, py * V.scale + V.oy, 5, 0, Math.PI * 2);
            ctx.fill();
        });
    }
    drawHud();
    el.zoomReadout.textContent = `${Math.round(V.scale * 100)}%`;
}

// ── Vòng lặp vẽ ─────────────────────────────────────────────────────────────
function tick() {
    const running = !video.paused || S.source === "screen" || S.scanning;
    if (S.dirty || running) {
        S.dirty = false;
        if (S.mode === "single") draw();
        updateTransportUi();
        updateRegionDots();
        drawTimeline();
    }
    requestAnimationFrame(tick);
}

function updateTransportUi() {
    const dur = S.source === "file" && isFinite(video.duration) ? video.duration : 0;
    if (S.source === "file") {
        el.seek.value = dur ? String(Math.round((video.currentTime / dur) * 1000)) : "0";
        el.timeReadout.textContent = `${video.currentTime.toFixed(3)} / ${dur.toFixed(3)} s`;
    } else if (S.live) {
        el.timeReadout.textContent = `● ${((performance.now() - S.live.t0) / 1000).toFixed(3)} s`;
    } else if (S.source === "screen") {
        el.timeReadout.textContent = "Đang chụp màn hình";
    }
    el.playBtn.textContent = video.paused ? "▶" : "❚❚";
}

// ── Nguồn: file video / màn hình ────────────────────────────────────────────
const once = (target, name, ms = 4000) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    target.addEventListener(name, () => { clearTimeout(timer); resolve(); }, { once: true });
});

async function loadVideoURL(url, name) {
    stopScreen();
    S.source = "file";
    S.fileName = name;
    video.srcObject = null;
    video.src = url;
    await once(video, "loadedmetadata", 8000);
    if (!isFinite(video.duration)) {
        // Video ghi bằng MediaRecorder không có độ dài: ép trình duyệt tính lại.
        video.currentTime = 1e101;
        await once(video, "timeupdate", 3000);
    }
    video.currentTime = 0;
    await once(video, "seeked", 3000);
    rescaleRegions();
    S.samples = [];
    S.sheet = null;
    el.scanFrom.value = "0";
    el.scanTo.value = isFinite(video.duration) ? video.duration.toFixed(3) : "0";
    setSourceUi();
    resizeCanvas();
    fitFrame();
    analyze();
    markDirty();
}

// Vùng lưu theo độ phân giải cũ thì co giãn cho khớp video mới.
function rescaleRegions() {
    const w = vw();
    const h = vh();
    if (S.refSize && S.regions.length && (S.refSize[0] !== w || S.refSize[1] !== h)) {
        const fx = w / S.refSize[0];
        const fy = h / S.refSize[1];
        S.regions.forEach((r) => { r.x *= fx; r.y *= fy; r.w *= fx; r.h *= fy; });
    }
    S.refSize = [w, h];
    persist();
}

async function startScreen() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
        showToast("Trình duyệt này không hỗ trợ chụp màn hình.", true);
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 60 }, audio: false });
        video.pause();
        video.removeAttribute("src");
        video.srcObject = stream;
        await video.play();
        stream.getVideoTracks()[0].addEventListener("ended", stopScreen);
        S.source = "screen";
        S.samples = [];
        S.sheet = null;
        await once(video, "loadeddata", 3000);
        rescaleRegions();
        setSourceUi();
        resizeCanvas();
        fitFrame();
        listenFrames();
        markDirty();
    } catch (err) {
        showToast(`Không chụp được màn hình: ${err.message || err}`, true);
    }
}

function stopScreen() {
    if (S.live) stopRecording();
    const stream = video.srcObject;
    if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        video.srcObject = null;
    }
    if (S.source === "screen") {
        S.source = "none";
        setSourceUi();
        markDirty();
    }
}

function setSourceUi() {
    const screen = S.source === "screen";
    el.stopScreenBtn.hidden = !screen;
    el.screenBtn.hidden = screen;
    el.recBtn.hidden = !screen;
    el.scanBtn.hidden = screen;
    el.setFrom.disabled = screen;
    el.setTo.disabled = screen;
    el.seek.disabled = screen;
    el.prevBtn.disabled = screen;
    el.nextBtn.disabled = screen;
    el.playBtn.disabled = screen;
    el.scanStatus.textContent = S.source === "file" ? S.fileName : (screen ? "Đang chụp màn hình chính" : "");
}

// Mỗi khung hình của màn hình đang chụp: ghi mẫu nếu đang bấm Ghi.
let framesListening = false;
function listenFrames() {
    if (framesListening || !video.requestVideoFrameCallback) return;
    framesListening = true;
    const onFrame = (now) => {
        if (S.live && S.source === "screen") {
            S.samples.push({ t: (now - S.live.t0) / 1000, on: detectAll() });
        }
        if (S.source === "screen") video.requestVideoFrameCallback(onFrame);
        else framesListening = false;
    };
    video.requestVideoFrameCallback(onFrame);
}

function startRecording() {
    if (!S.regions.length) {
        showToast("Chưa có vùng phím nào. Bấm Hiệu chỉnh trước.", true);
        return;
    }
    S.samples = [];
    S.live = { t0: performance.now() };
    el.recBtn.textContent = "■ Dừng ghi";
    listenFrames();
}

function stopRecording() {
    if (!S.live) return;
    const n = S.samples.length;
    const span = n > 1 ? S.samples[n - 1].t - S.samples[0].t : 0;
    S.dt = n > 1 ? span / (n - 1) : 1 / 60;
    S.live = null;
    el.recBtn.textContent = "● Ghi";
    analyze();
    showToast(`Đã ghi ${n} khung (~${(1 / S.dt).toFixed(0)} fps).`);
}

// ── Điều khiển phát ─────────────────────────────────────────────────────────
function seekTo(t) {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, 3000);
        video.addEventListener("seeked", () => { clearTimeout(timer); resolve(); }, { once: true });
        video.currentTime = Math.max(0, Math.min(t, video.duration || t));
    });
}

function stepFrames(n) {
    if (S.source !== "file") return;
    video.pause();
    // +0.3 khung để rơi vào giữa khung, tránh làm tròn về khung trước
    video.currentTime = Math.max(0, video.currentTime + (n > 0 ? n : n) / S.fps + (n > 0 ? 0.0001 : 0));
    markDirty();
}

function togglePlay() {
    if (S.source !== "file") return;
    if (video.paused) video.play(); else video.pause();
    markDirty();
}

async function measureFps() {
    if (S.source !== "file" || !video.requestVideoFrameCallback) return;
    const start = video.currentTime;
    const times = [];
    video.playbackRate = 1;
    await video.play();
    await new Promise((resolve) => {
        const guard = setTimeout(resolve, 4000);
        const cb = (now, meta) => {
            times.push(meta.mediaTime);
            if (times.length < 40) video.requestVideoFrameCallback(cb);
            else { clearTimeout(guard); resolve(); }
        };
        video.requestVideoFrameCallback(cb);
    });
    video.pause();
    await seekTo(start);
    const deltas = times.slice(1).map((t, i) => t - times[i]).filter((d) => d > 0).sort((a, b) => a - b);
    if (!deltas.length) { showToast("Không đo được FPS (trang đang bị ẩn?).", true); return; }
    const raw = 1 / deltas[Math.floor(deltas.length / 2)];
    const snap = COMMON_FPS.find((f) => Math.abs(f - raw) / f < 0.02) || raw;
    S.fps = +snap.toFixed(3);
    el.fpsInput.value = String(S.fps);
    persist();
    showToast(`FPS đo được: ${S.fps}`);
}

// ── Quét từng khung ─────────────────────────────────────────────────────────
async function scan() {
    if (S.scanning) { S.cancel = true; return; }
    if (S.source !== "file") { showToast("Mở một file video trước.", true); return; }
    if (!S.regions.length) { showToast("Chưa có vùng phím nào. Bấm Hiệu chỉnh trước.", true); return; }
    S.fps = Math.max(1, parseFloat(el.fpsInput.value) || 30);
    const from = Math.max(0, parseFloat(el.scanFrom.value) || 0);
    const to = Math.min(video.duration, parseFloat(el.scanTo.value) || video.duration);
    if (to <= from) { showToast("Khoảng quét không hợp lệ (Đến phải lớn hơn Từ).", true); return; }

    video.pause();
    const dt = 1 / S.fps;
    const frames = Math.floor((to - from) / dt) + 1;
    S.scanning = true;
    S.cancel = false;
    S.samples = [];
    S.dt = dt;
    el.scanBtn.textContent = "Dừng quét";
    el.scanProgress.hidden = false;
    el.scanProgress.max = frames;
    for (let i = 0; i < frames && !S.cancel; i += 1) {
        const t = from + i * dt;
        await seekTo(t + dt * 0.3);
        S.samples.push({ t, on: detectAll() });
        if (i % 6 === 0) {
            el.scanProgress.value = i;
            el.scanStatus.textContent = `${i + 1}/${frames} khung · t=${t.toFixed(2)}s`;
            markDirty();
            await new Promise((r) => setTimeout(r, 0));
        }
    }
    S.scanning = false;
    el.scanBtn.textContent = "Quét từng khung";
    el.scanProgress.hidden = true;
    el.scanStatus.textContent = S.cancel ? "Đã dừng quét." : `Xong: ${S.samples.length} khung.`;
    analyze();
}

// ── Phân tích: mẫu → khoảng sáng → sự kiện → bước combo ────────────────────
// Mẫu sau khi bỏ khung chớp sáng: khung nghi nhiễu lấy lại trạng thái khung trước.
function effectiveSamples() {
    if (S.effCache && S.effCache.src === S.samples && S.effCache.len === S.samples.length
        && S.effCache.noise === S.noiseKeys && S.effCache.regions === S.regions.length) {
        return S.effCache.list;
    }
    const keyIds = new Set(S.regions.filter((r) => r.kind === "key").map((r) => r.id));
    let prev = [];
    let dropped = 0;
    const list = S.samples.map((s) => {
        const keys = s.on.filter((id) => keyIds.has(id)).length;
        if (S.noiseKeys > 0 && keys >= S.noiseKeys) {
            dropped += 1;
            return { t: s.t, on: prev };
        }
        prev = s.on;
        return s;
    });
    S.effCache = { src: S.samples, len: S.samples.length, noise: S.noiseKeys, regions: S.regions.length, list };
    S.noiseDropped = dropped;
    return list;
}

function intervalsFor(id) {
    const samples = effectiveSamples();
    const dt = S.dt;
    let runs = [];
    let start = null;
    samples.forEach((s, i) => {
        const on = s.on.includes(id);
        if (on && start === null) start = s.t;
        if (!on && start !== null) { runs.push([start, s.t]); start = null; }
        if (i === samples.length - 1 && start !== null) runs.push([start, s.t + dt]);
    });
    const eps = dt * 0.01;
    if (S.gapFill > 0) {
        const merged = [];
        runs.forEach((run) => {
            const last = merged[merged.length - 1];
            if (last && run[0] - last[1] <= S.gapFill * dt + eps) last[1] = run[1];
            else merged.push([...run]);
        });
        runs = merged;
    }
    const region = S.regions.find((r) => r.id === id);
    const minLen = region && region.kind === "key" ? S.minLenKey : S.minLen;
    return runs.filter(([a, b]) => b - a >= minLen * dt - eps);
}

function analyze() {
    S.effCache = null;
    effectiveSamples();
    const events = [];
    S.regions.filter((r) => r.use).forEach((r) => {
        intervalsFor(r.id).forEach(([a, b]) => {
            events.push({ t: a, order: 0, down: true, region: r });
            events.push({ t: b, order: 1, down: false, region: r });
        });
    });
    events.sort((x, y) => x.t - y.t || x.order - y.order);
    S.events = events;

    // Clip cho timeline: mỗi phím / nút một track, xếp theo thứ tự xuất hiện lần đầu.
    // Làm tròn từng mốc theo thời gian tuyệt đối (không làm tròn từng khoảng) để không trôi.
    const t0 = S.trimStart && events.length ? events[0].t : 0;
    const trackOf = new Map();
    const clips = [];
    events.forEach((ev) => {
        if (!trackOf.has(ev.region.id)) trackOf.set(ev.region.id, trackOf.size);
    });
    S.regions.filter((r) => r.use).forEach((r) => {
        intervalsFor(r.id).forEach(([a, b]) => {
            const start = Math.round((a - t0) * 1000);
            const end = Math.round((b - t0) * 1000);
            clips.push({ ...clipTarget(r), track: trackOf.get(r.id), start, dur: Math.max(1, end - start) });
        });
    });
    clips.sort((x, y) => x.start - y.start || x.track - y.track);
    S.clips = clips;
    S.t0 = t0;
    renderEvents();
    markDirty();
}

function clipTarget(region) {
    return region.kind === "key"
        ? { kind: "key", key: region.target }
        : { kind: "mouse", button: region.target };
}

function renderEvents() {
    const box = el.eventList;
    box.replaceChildren();
    const n = S.events.length;
    const used = new Set(S.events.map((e) => e.region.id)).size;
    const span = n ? S.events[n - 1].t - S.events[0].t : 0;
    el.summary.innerHTML = n
        ? `<b>${n}</b> sự kiện · <b>${used}</b> phím/nút · dài <b>${span.toFixed(3)}s</b> · <b>${S.clips.length}</b> clip trên <b>${used}</b> track`
            + (S.noiseDropped ? ` · bỏ <b>${S.noiseDropped}</b> khung chớp sáng` : "")
        : "Chưa có dữ liệu. Mở video rồi bấm <b>Quét từng khung</b>.";
    let prev = null;
    S.events.slice(0, 600).forEach((ev, i) => {
        const row = document.createElement("div");
        row.className = `event-row ${ev.down ? "down" : "up"}`;
        const num = Object.assign(document.createElement("span"), { className: "n", textContent: String(i + 1) });
        const time = Object.assign(document.createElement("span"), { textContent: `${ev.t.toFixed(3)}s` });
        const act = Object.assign(document.createElement("span"), {
            className: "a",
            textContent: `${ev.down ? "Nhấn" : "Nhả"} ${targetLabel(ev.region)}`
        });
        const dt = Object.assign(document.createElement("span"), {
            className: "dt",
            textContent: prev === null ? "" : `+${Math.round((ev.t - prev) * 1000)}ms`
        });
        row.append(num, time, act, dt);
        row.addEventListener("click", () => { if (S.source === "file") { video.pause(); video.currentTime = ev.t + S.dt * 0.3; markDirty(); } });
        box.appendChild(row);
        prev = ev.t;
    });
}

function targetLabel(region) {
    if (region.kind === "mouse") return (MOUSE_TARGETS.find(([v]) => v === region.target) || [0, region.target])[1].toLowerCase();
    return (KEY_LABELS[region.target] || region.target).toUpperCase();
}

// ── Dòng thời gian ──────────────────────────────────────────────────────────
const LANE = 22;
const AXIS = 22;

function timelineDuration() {
    const last = S.samples.length ? S.samples[S.samples.length - 1].t + S.dt : 0;
    return Math.max(1, last, S.source === "file" && isFinite(video.duration) ? video.duration : 0);
}

function drawTimeline() {
    const lanes = S.regions.filter((r) => r.use && intervalsFor(r.id).length);
    const pps = parseFloat(el.ppsRange.value) || 120;
    const dur = timelineDuration();
    const width = Math.ceil((dur + 0.5) * pps);
    const height = AXIS + Math.max(lanes.length, 1) * LANE + 6;
    const c = el.timeline;
    const d = window.devicePixelRatio || 1;
    if (c.width !== Math.round(width * d) || c.height !== Math.round(height * d)) {
        c.width = Math.round(width * d);
        c.height = Math.round(height * d);
        c.style.width = `${width}px`;
        c.style.height = `${height}px`;
    }
    const g = c.getContext("2d");
    g.setTransform(d, 0, 0, d, 0, 0);
    g.fillStyle = "#05080f";
    g.fillRect(0, 0, width, height);

    g.font = "11px sans-serif";
    const tickStep = pps >= 240 ? 0.1 : (pps >= 60 ? 0.5 : 1);
    for (let t = 0; t <= dur + 0.5; t += tickStep) {
        const x = Math.round(t * pps) + 0.5;
        const major = Math.abs(t - Math.round(t)) < 1e-6;
        g.strokeStyle = major ? "rgba(148,163,184,0.35)" : "rgba(148,163,184,0.14)";
        g.beginPath();
        g.moveTo(x, major ? 0 : AXIS - 6);
        g.lineTo(x, height);
        g.stroke();
        if (major) {
            g.fillStyle = "#94a3b8";
            g.fillText(`${Math.round(t)}s`, x + 3, 12);
        }
    }
    if (!lanes.length) {
        g.fillStyle = "#64748b";
        g.font = "12px sans-serif";
        g.fillText("Chưa có kết quả quét.", 10, AXIS + 16);
    }
    lanes.forEach((r, i) => {
        const y = AXIS + i * LANE;
        g.fillStyle = r.kind === "mouse" ? "#fb923c" : "#2dd4bf";
        intervalsFor(r.id).forEach(([a, b]) => {
            g.fillRect(a * pps, y + 3, Math.max(2, (b - a) * pps), LANE - 7);
        });
        g.fillStyle = "#e2e8f0";
        g.font = "bold 11px sans-serif";
        g.fillText(targetLabel(r), 4, y + 15);
    });

    const head = S.live ? (performance.now() - S.live.t0) / 1000 : video.currentTime;
    if (head >= 0) {
        g.strokeStyle = "#f43f5e";
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(head * pps, 0);
        g.lineTo(head * pps, height);
        g.stroke();
        g.lineWidth = 1;
    }
}

// ── Bảng nhiều khung hình (như bảng tracking thủ công) ──────────────────────
async function buildSheet() {
    if (S.source !== "file") { showToast("Bảng khung chỉ dùng với file video.", true); return; }
    const crop = regionsBounds() || { x: 0, y: 0, w: vw(), h: vh() };
    const n = Math.max(1, Math.min(60, parseInt(el.sheetCount.value, 10) || 9));
    const from = Math.max(0, parseFloat(el.scanFrom.value) || 0);
    const to = Math.min(video.duration, parseFloat(el.scanTo.value) || video.duration);
    const tiles = [];
    video.pause();
    el.scanStatus.textContent = "Đang dựng bảng khung…";
    for (let i = 0; i < n; i += 1) {
        const t = n === 1 ? from : from + ((to - from) * i) / (n - 1);
        await seekTo(t);
        const tile = document.createElement("canvas");
        tile.width = Math.round(crop.w);
        tile.height = Math.round(crop.h);
        tile.getContext("2d").drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, tile.width, tile.height);
        tiles.push({ t, canvas: tile, on: detectAll() });
    }
    S.sheet = { tiles, crop };
    el.scanStatus.textContent = `Bảng ${n} khung.`;
    renderSheet();
}

function renderSheet() {
    const sh = S.sheet;
    if (!sh) return;
    const cols = Math.max(1, parseInt(el.sheetCols.value, 10) || 3);
    const tileW = parseInt(el.sheetSize.value, 10) || 420;
    const k = tileW / sh.crop.w;
    const tileH = Math.round(sh.crop.h * k);
    const rows = Math.ceil(sh.tiles.length / cols);
    const wCss = cols * (tileW + 4);
    const hCss = rows * (tileH + 20);
    const d = window.devicePixelRatio || 1;
    const c = el.sheet;
    c.width = Math.round(wCss * d);
    c.height = Math.round(hCss * d);
    c.style.width = `${wCss}px`;
    c.style.height = `${hCss}px`;
    const g = c.getContext("2d");
    g.setTransform(d, 0, 0, d, 0, 0);
    g.fillStyle = "#222";
    g.fillRect(0, 0, wCss, hCss);
    g.imageSmoothingEnabled = k < 2.5;
    sh.tiles.forEach((tile, i) => {
        const x = (i % cols) * (tileW + 4);
        const y = Math.floor(i / cols) * (tileH + 20);
        g.drawImage(tile.canvas, x, y + 16, tileW, tileH);
        if (S.grid) {
            const step = gridStepFor(k);
            g.strokeStyle = "rgba(255,0,0,0.5)";
            g.fillStyle = "#ffff00";
            g.font = "bold 11px sans-serif";
            g.lineWidth = 1;
            g.beginPath();
            for (let vx = Math.ceil(sh.crop.x / step) * step; vx <= sh.crop.x + sh.crop.w; vx += step) {
                const sx = x + (vx - sh.crop.x) * k;
                g.moveTo(sx, y + 16);
                g.lineTo(sx, y + 16 + tileH);
            }
            for (let vy = Math.ceil(sh.crop.y / step) * step; vy <= sh.crop.y + sh.crop.h; vy += step) {
                const sy = y + 16 + (vy - sh.crop.y) * k;
                g.moveTo(x, sy);
                g.lineTo(x + tileW, sy);
            }
            g.stroke();
        }
        if (S.boxes) {
            drawRegions(g, (rx, ry) => [x + (rx - sh.crop.x) * k, y + 16 + (ry - sh.crop.y) * k], tile.on, null);
        }
        g.fillStyle = "#ffff00";
        g.font = "bold 14px sans-serif";
        g.fillText(`${tile.t.toFixed(2)}s`, x + 3, y + 13);
    });
}

function setMode(mode) {
    S.mode = mode;
    const sheet = mode === "sheet";
    el.modeSingle.classList.toggle("is-on", !sheet);
    el.modeSheet.classList.toggle("is-on", sheet);
    el.sheetBar.hidden = !sheet;
    el.sheetWrap.hidden = !sheet;
    el.view.hidden = sheet;
    if (sheet && !S.sheet) buildSheet(); else if (sheet) renderSheet();
    markDirty();
}

// ── Vùng phím: hiệu chỉnh, vẽ, sửa ──────────────────────────────────────────
function addRegion(target, x, y, w, h) {
    const kind = MOUSE_TARGETS.some(([v]) => v === target) ? "mouse" : "key";
    const region = { id: S.nextId, target, kind, x, y, w, h, use: true };
    S.nextId += 1;
    S.regions.push(region);
    return region;
}

function calibrate(points) {
    const [q, d] = points;
    const s = Math.abs(d[0] - q[0]) / 2;
    const row = Math.abs(d[1] - q[1]) || s;
    if (s < 4) {
        showToast("Hai điểm Q và D quá gần nhau, thử lại.", true);
        return false;
    }
    S.regions = [];
    KEY_TEMPLATE.forEach(([target, c, r]) => {
        const w = s * 0.62;
        const h = row * 0.5;
        addRegion(target, q[0] + (c - 1) * s - w / 2, q[1] + (r - 1) * row - h / 2, target === "space" ? s * 1.3 : w, h);
    });
    S.calib = { s, row };
    return true;
}

function handleToolClick(vx, vy) {
    const tool = S.tool;
    if (tool.type === "pick") {
        grabFrame();
        const x = Math.max(0, Math.round(vx) - 2);
        const y = Math.max(0, Math.round(vy) - 2);
        const data = octx.getImageData(x, y, 5, 5).data;
        let r = 0; let g = 0; let b = 0;
        for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
        const n = data.length / 4;
        S.color = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
        endTool();
        updateColorUi();
        persist();
        showToast(`Màu mẫu rgb(${S.color.join(", ")}). Chỉnh dung sai nếu cần.`);
        return;
    }
    if (tool.type === "nb") {
        tool.points.push([vx, vy]);
        if (tool.points.length < 2) {
            updateBanner();
            markDirty();
            return;
        }
        applyNohBoard(tool);
        endTool();
        return;
    }
    // calib
    tool.points.push([vx, vy]);
    if (tool.points.length === 2 && !calibrate(tool.points)) {
        tool.points = [];
    }
    if (tool.points.length > 2 && tool.points.length <= 4) {
        const target = CALIB_STEPS[tool.points.length - 1][1];
        const s = S.calib.s;
        const row = S.calib.row;
        const w = s * 0.8;
        const h = row * 0.7;
        S.regions = S.regions.filter((r) => r.target !== target);
        addRegion(target, vx - w / 2, vy - h / 2, w, h);
    }
    if (tool.points.length === 4) {
        endTool();
        persist();
        renderRegionList();
        const b = regionsBounds();
        if (b) fitRect(b);
        showToast("Đã dựng lưới phím. Kéo khung để chỉnh, xóa các phím overlay không có.");
        return;
    }
    updateBanner();
    renderRegionList();
    markDirty();
}

// ── Nhập bố cục NohBoard (keyboard.json): vùng phím chính xác, chỉ cần căn tỉ lệ bằng 2 điểm ──
function parseNohBoard(text) {
    const json = JSON.parse(text.replace(/^\uFEFF/, ""));
    if (!Array.isArray(json.Elements)) throw new Error("Không phải file bố cục NohBoard (thiếu Elements).");
    const items = [];
    let skipped = 0;
    json.Elements.forEach((e) => {
        if (!Array.isArray(e.Boundaries) || !e.Boundaries.length || !Array.isArray(e.KeyCodes)) return;
        let target = null;
        if (e.__type === "KeyboardKey") target = VK_TARGETS[e.KeyCodes[0]];
        else if (e.__type === "MouseKey") target = NB_MOUSE[e.KeyCodes[0]];
        else return;
        if (!target) { skipped += 1; return; }
        const xs = e.Boundaries.map((p) => p.X);
        const ys = e.Boundaries.map((p) => p.Y);
        items.push({
            target,
            x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys)
        });
    });
    return { items, skipped };
}

function startNohBoard(text, name) {
    let parsed;
    try {
        parsed = parseNohBoard(text);
    } catch (err) {
        showToast(`Đọc bố cục lỗi: ${err.message}`, true);
        return;
    }
    if (parsed.items.length < 2) { showToast("Bố cục có ít hơn 2 phím dùng được.", true); return; }
    // Hai phím tham chiếu: ưu tiên Q và D, không có thì chuột trái/phải, không thì 2 phím đầu.
    const find = (t) => parsed.items.find((i) => i.target === t);
    let pair = [find("q"), find("d")];
    if (!pair[0] || !pair[1]) pair = [find("left"), find("right")];
    if (!pair[0] || !pair[1]) pair = [parsed.items[0], parsed.items[1]];
    const refs = pair.map((i) => ({ item: i, label: (KEY_LABELS[i.target] || i.target).toUpperCase() }));
    S.selected = null;
    startTool({ type: "nb", points: [], refs, parsed, name });
}

function applyNohBoard(tool) {
    const [a, b] = tool.refs.map((r) => r.item);
    const ca = [(a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2];
    const cb = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
    const [pa, pb] = tool.points;
    const nbDist = Math.hypot(cb[0] - ca[0], cb[1] - ca[1]);
    const k = nbDist > 0 ? Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) / nbDist : 0;
    if (!(k > 0.05)) {
        showToast("Hai điểm tham chiếu trùng nhau, thử lại.", true);
        return;
    }
    S.regions = [];
    tool.parsed.items.forEach((i) => {
        const w = (i.x1 - i.x0) * k;
        const h = (i.y1 - i.y0) * k;
        // co vào 15% mỗi cạnh để không dính viền phím
        const x = pa[0] + (i.x0 - ca[0]) * k + w * 0.15;
        const y = pa[1] + (i.y0 - ca[1]) * k + h * 0.15;
        addRegion(i.target, x, y, w * 0.7, h * 0.7);
    });
    persist();
    renderRegionList();
    const bounds = regionsBounds();
    if (bounds) fitRect(bounds);
    analyze();
    showToast(`Đã nhập ${S.regions.length} phím/nút từ ${tool.name}` + (tool.parsed.skipped ? ` (bỏ ${tool.parsed.skipped} phím không hỗ trợ)` : "") + ". Kéo khung để chỉnh nếu lệch.");
}

function startTool(tool) {
    S.tool = tool;
    updateBanner();
    el.view.classList.toggle("is-crosshair", Boolean(tool));
    markDirty();
}

function endTool() {
    S.tool = null;
    updateBanner();
    el.view.classList.remove("is-crosshair");
    markDirty();
}

function updateBanner() {
    const t = S.tool;
    let text = "";
    if (t?.type === "calib") text = `Hiệu chỉnh ${t.points.length + 1}/4: ${CALIB_STEPS[t.points.length][0]}`;
    if (t?.type === "nb") text = `NohBoard ${t.points.length + 1}/2: bấm vào TÂM ${t.refs[t.points.length].label}`;
    if (t?.type === "draw") text = "Kéo chuột trên khung hình để vẽ vùng";
    if (t?.type === "pick") text = "Bấm vào một phím đang SÁNG để lấy màu";
    el.toolBanner.textContent = text;
    el.toolBanner.hidden = !text;
}

function hitRegion(vx, vy) {
    const pad = 6 / V.scale;
    for (let i = S.regions.length - 1; i >= 0; i -= 1) {
        const r = S.regions[i];
        const handle = S.selected === r.id && Math.abs(vx - (r.x + r.w)) < pad + 4 / V.scale && Math.abs(vy - (r.y + r.h)) < pad + 4 / V.scale;
        if (handle) return { region: r, handle: true };
        if (vx >= r.x && vx <= r.x + r.w && vy >= r.y && vy <= r.y + r.h) return { region: r, handle: false };
    }
    return null;
}

let drag = null;

function pointerPos(e) {
    const rect = el.view.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
}

el.view.addEventListener("pointerdown", (e) => {
    if (!hasFrame()) return;
    const [sx, sy] = pointerPos(e);
    const [vx, vy] = toVideo(sx, sy);
    el.view.setPointerCapture(e.pointerId);
    if (S.tool?.type === "calib" || S.tool?.type === "pick" || S.tool?.type === "nb") {
        handleToolClick(vx, vy);
        return;
    }
    if (S.tool?.type === "draw") {
        drag = { mode: "draw", x0: vx, y0: vy };
        S.tool.rect = { x: vx, y: vy, w: 0, h: 0 };
        return;
    }
    const hit = hitRegion(vx, vy);
    if (hit) {
        S.selected = hit.region.id;
        renderRegionList();
        drag = hit.handle
            ? { mode: "resize", region: hit.region }
            : { mode: "move", region: hit.region, dx: vx - hit.region.x, dy: vy - hit.region.y };
    } else {
        S.selected = null;
        renderRegionList();
        drag = { mode: "pan", sx, sy, ox: V.ox, oy: V.oy };
        el.view.classList.add("is-panning");
    }
    markDirty();
});

el.view.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const [sx, sy] = pointerPos(e);
    const [vx, vy] = toVideo(sx, sy);
    if (drag.mode === "pan") {
        V.ox = drag.ox + (sx - drag.sx);
        V.oy = drag.oy + (sy - drag.sy);
    } else if (drag.mode === "move") {
        drag.region.x = vx - drag.dx;
        drag.region.y = vy - drag.dy;
    } else if (drag.mode === "resize") {
        drag.region.w = Math.max(3, vx - drag.region.x);
        drag.region.h = Math.max(3, vy - drag.region.y);
    } else if (drag.mode === "draw") {
        S.tool.rect = {
            x: Math.min(drag.x0, vx), y: Math.min(drag.y0, vy),
            w: Math.abs(vx - drag.x0), h: Math.abs(vy - drag.y0)
        };
    }
    markDirty();
});

function endDrag() {
    if (!drag) return;
    if (drag.mode === "draw" && S.tool?.rect && S.tool.rect.w > 3 && S.tool.rect.h > 3) {
        const r = S.tool.rect;
        const region = addRegion(S.tool.target, r.x, r.y, r.w, r.h);
        S.selected = region.id;
        endTool();
        renderRegionList();
    } else if (drag.mode === "draw") {
        S.tool.rect = null;
    }
    if (drag.mode !== "pan" && drag.mode !== "draw") persist();
    drag = null;
    el.view.classList.remove("is-panning");
    markDirty();
}
el.view.addEventListener("pointerup", endDrag);
el.view.addEventListener("pointercancel", endDrag);

el.view.addEventListener("wheel", (e) => {
    e.preventDefault();
    const [sx, sy] = pointerPos(e);
    zoomAt(sx, sy, e.deltaY < 0 ? 1.18 : 1 / 1.18);
}, { passive: false });

// ── Danh sách vùng ──────────────────────────────────────────────────────────
function targetOptions(select) {
    const gk = document.createElement("optgroup");
    gk.label = "Bàn phím";
    KEY_TARGETS.forEach((k) => gk.appendChild(new Option((KEY_LABELS[k] || k).toUpperCase(), k)));
    const gm = document.createElement("optgroup");
    gm.label = "Chuột";
    MOUSE_TARGETS.forEach(([v, l]) => gm.appendChild(new Option(l, v)));
    select.append(gk, gm);
}

function renderRegionList() {
    const box = el.regionList;
    box.replaceChildren();
    S.regions.forEach((r) => {
        const row = document.createElement("div");
        row.className = `region-item${S.selected === r.id ? " is-selected" : ""}`;
        row.dataset.id = String(r.id);
        const use = document.createElement("input");
        use.type = "checkbox";
        use.checked = r.use;
        use.title = "Dùng khi xuất";
        use.addEventListener("change", () => { r.use = use.checked; persist(); analyze(); });
        const dot = document.createElement("span");
        dot.className = "dot";
        const sel = document.createElement("select");
        targetOptions(sel);
        sel.value = r.target;
        sel.addEventListener("change", () => {
            r.target = sel.value;
            r.kind = MOUSE_TARGETS.some(([v]) => v === r.target) ? "mouse" : "key";
            persist();
            analyze();
        });
        const del = document.createElement("button");
        del.type = "button";
        del.className = "xbtn";
        del.textContent = "×";
        del.title = "Xóa vùng";
        del.addEventListener("click", () => {
            S.regions = S.regions.filter((x) => x.id !== r.id);
            if (S.selected === r.id) S.selected = null;
            persist();
            renderRegionList();
            analyze();
        });
        row.addEventListener("click", (e) => {
            if (e.target === row) { S.selected = r.id; renderRegionList(); markDirty(); }
        });
        row.append(use, dot, sel, del);
        box.appendChild(row);
    });
}

function updateRegionDots() {
    el.regionList.querySelectorAll(".region-item").forEach((row) => {
        row.querySelector(".dot").classList.toggle("on", S.now.includes(Number(row.dataset.id)));
    });
}

function updateColorUi() {
    el.swatch.style.background = S.color ? `rgb(${S.color.join(",")})` : "";
    el.tolRange.value = String(S.tol);
    el.tolVal.textContent = String(S.tol);
    el.fracRange.value = String(Math.round(S.minFrac * 100));
    el.fracVal.textContent = `${Math.round(S.minFrac * 100)}%`;
    el.tolRange.disabled = !S.color;
}

// ── Xuất ────────────────────────────────────────────────────────────────────
function showToast(message, error = false) {
    el.toast.textContent = message;
    el.toast.classList.toggle("is-error", error);
}

// Gói xuất: cùng định dạng bản copy của trình tạo combo, nên Ctrl+V / Nhập Tracker đều nhận.
function clipsOrWarn() {
    if (!S.clips || !S.clips.length) {
        showToast("Chưa có clip nào để xuất. Hãy quét video trước.", true);
        return null;
    }
    return { skirkClips: S.clips, source: "tracker" };
}

// Lưu clip vào bộ nhớ dùng chung với trình tạo combo. Trả về true nếu ghi được.
function storeClips(payload) {
    try {
        const text = JSON.stringify(payload);
        localStorage.setItem(TRACKER_STORAGE, text);
        localStorage.setItem(CLIPBOARD_STORAGE, text);   // cho phép Ctrl+V trong trình tạo combo
        return true;
    } catch {
        showToast("Không ghi được vào bộ nhớ trình duyệt.", true);
        return false;
    }
}

function sendToComboEditor() {
    const payload = clipsOrWarn();
    if (payload && storeClips(payload)) {
        showToast(`Đã gửi ${payload.skirkClips.length} clip. Trong trình tạo combo, đặt đầu phát rồi bấm "Nhập Tracker" (hoặc Ctrl+V).`);
    }
}

// Mở trình tạo combo (combo mới) và nhập luôn các clip, không cần Ctrl+V.
function openEditorAndImport() {
    const payload = clipsOrWarn();
    if (payload && storeClips(payload)) {
        window.location.href = "cuscombo.html?import=tracker";
    }
}

async function copyJson() {
    const payload = clipsOrWarn();
    if (!payload) return;
    const count = payload.skirkClips.length;
    const text = JSON.stringify(payload, null, 2);
    try {
        await navigator.clipboard.writeText(text);
        showToast(`Đã sao chép ${count} clip.`);
    } catch {
        const area = document.createElement("textarea");
        area.value = text;
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
        showToast(`Đã sao chép ${count} clip.`);
    }
}

function downloadJson() {
    const payload = clipsOrWarn();
    if (!payload) return;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "combo-clips.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ── Nối sự kiện giao diện ───────────────────────────────────────────────────
function zoomButton(factor) {
    if (S.mode === "sheet") {
        el.sheetSize.value = String(Math.round(Math.min(1400, Math.max(160, el.sheetSize.value * factor))));
        renderSheet();
        return;
    }
    zoomAt(cssW / 2, cssH / 2, factor);
}

el.fileInput.addEventListener("change", () => {
    const file = el.fileInput.files[0];
    if (file) loadVideoURL(URL.createObjectURL(file), file.name);
});
el.screenBtn.addEventListener("click", startScreen);
el.stopScreenBtn.addEventListener("click", stopScreen);
el.zoomIn.addEventListener("click", () => zoomButton(1.4));
el.zoomOut.addEventListener("click", () => zoomButton(1 / 1.4));
el.zoomFit.addEventListener("click", () => { if (S.mode === "sheet") { el.sheetSize.value = "420"; renderSheet(); } else fitFrame(); });
el.zoom11.addEventListener("click", () => {
    if (!hasFrame()) return;
    zoomAt(cssW / 2, cssH / 2, 1 / V.scale);
});
el.zoomRegions.addEventListener("click", () => {
    const b = regionsBounds();
    if (b) fitRect(b);
    else showToast("Chưa có vùng nào, hãy Hiệu chỉnh trước.", true);
});
el.gridToggle.addEventListener("change", () => { S.grid = el.gridToggle.checked; persist(); if (S.sheet) renderSheet(); markDirty(); });
el.boxToggle.addEventListener("change", () => { S.boxes = el.boxToggle.checked; persist(); if (S.sheet) renderSheet(); markDirty(); });
el.prevBtn.addEventListener("click", () => stepFrames(-1));
el.nextBtn.addEventListener("click", () => stepFrames(1));
el.playBtn.addEventListener("click", togglePlay);
el.seek.addEventListener("input", () => {
    if (S.source === "file" && isFinite(video.duration)) {
        video.currentTime = (el.seek.value / 1000) * video.duration;
        markDirty();
    }
});
el.rateSel.addEventListener("change", () => { video.playbackRate = parseFloat(el.rateSel.value); });
el.setFrom.addEventListener("click", () => { el.scanFrom.value = video.currentTime.toFixed(3); });
el.setTo.addEventListener("click", () => { el.scanTo.value = video.currentTime.toFixed(3); });
el.fpsInput.addEventListener("change", () => { S.fps = Math.max(1, parseFloat(el.fpsInput.value) || 30); persist(); markDirty(); });
el.measureFps.addEventListener("click", measureFps);
el.scanBtn.addEventListener("click", scan);
el.recBtn.addEventListener("click", () => { if (S.live) stopRecording(); else startRecording(); });
el.ppsRange.addEventListener("input", markDirty);
el.timelineWrap.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    el.ppsRange.value = String(Math.min(600, Math.max(20, Math.round(el.ppsRange.value * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))));
    markDirty();
}, { passive: false });
el.timeline.addEventListener("click", (e) => {
    if (S.source !== "file") return;
    const pps = parseFloat(el.ppsRange.value) || 120;
    const x = e.clientX - el.timeline.getBoundingClientRect().left;
    video.pause();
    video.currentTime = Math.max(0, x / pps);
    markDirty();
});

el.calibBtn.addEventListener("click", () => {
    if (!hasFrame()) { showToast("Mở video hoặc chụp màn hình trước.", true); return; }
    if (S.regions.length && !window.confirm("Hiệu chỉnh lại sẽ thay toàn bộ vùng hiện có. Tiếp tục?")) return;
    S.selected = null;
    startTool({ type: "calib", points: [] });
});
el.clearRegions.addEventListener("click", () => {
    if (!S.regions.length || !window.confirm("Xóa hết các vùng phím?")) return;
    S.regions = [];
    S.selected = null;
    persist();
    renderRegionList();
    analyze();
});
el.drawBtn.addEventListener("click", () => {
    if (!hasFrame()) { showToast("Mở video hoặc chụp màn hình trước.", true); return; }
    startTool({ type: "draw", target: el.newTarget.value, rect: null });
});
el.pickBtn.addEventListener("click", () => {
    if (!hasFrame()) { showToast("Mở video hoặc chụp màn hình trước.", true); return; }
    startTool({ type: "pick" });
});
el.nbInput.addEventListener("change", async () => {
    const file = el.nbInput.files[0];
    el.nbInput.value = "";
    if (!file) return;
    if (!hasFrame()) { showToast("Mở video hoặc chụp màn hình trước, rồi mới nhập bố cục.", true); return; }
    if (S.regions.length && !window.confirm("Nhập bố cục sẽ thay toàn bộ vùng hiện có. Tiếp tục?")) return;
    startNohBoard(await file.text(), file.name);
});
el.autoColor.addEventListener("click", () => { S.color = null; updateColorUi(); persist(); markDirty(); });
el.tolRange.addEventListener("input", () => { S.tol = parseInt(el.tolRange.value, 10); updateColorUi(); persist(); markDirty(); });
el.fracRange.addEventListener("input", () => { S.minFrac = parseInt(el.fracRange.value, 10) / 100; updateColorUi(); persist(); markDirty(); });
el.minLenKey.addEventListener("change", () => { S.minLenKey = Math.max(1, parseInt(el.minLenKey.value, 10) || 1); persist(); analyze(); });
el.minLen.addEventListener("change", () => { S.minLen = Math.max(1, parseInt(el.minLen.value, 10) || 1); persist(); analyze(); });
el.noiseKeys.addEventListener("change", () => { S.noiseKeys = Math.max(0, parseInt(el.noiseKeys.value, 10) || 0); persist(); analyze(); });
el.gapFill.addEventListener("change", () => { S.gapFill = Math.max(0, parseInt(el.gapFill.value, 10) || 0); persist(); analyze(); });
el.trimStart.addEventListener("change", () => { S.trimStart = el.trimStart.checked; persist(); analyze(); });
el.sendBtn.addEventListener("click", sendToComboEditor);
el.openEditorBtn.addEventListener("click", openEditorAndImport);
el.copyBtn.addEventListener("click", copyJson);
el.downloadBtn.addEventListener("click", downloadJson);
el.modeSingle.addEventListener("click", () => setMode("single"));
el.modeSheet.addEventListener("click", () => setMode("sheet"));
el.sheetBtn.addEventListener("click", () => { S.sheet = null; buildSheet(); });
el.sheetCols.addEventListener("change", renderSheet);
el.sheetSize.addEventListener("input", renderSheet);
el.sheetWrap.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoomButton(e.deltaY < 0 ? 1.12 : 1 / 1.12);
}, { passive: false });

video.addEventListener("seeked", markDirty);
video.addEventListener("timeupdate", markDirty);
video.addEventListener("loadeddata", markDirty);
video.addEventListener("play", markDirty);
video.addEventListener("pause", markDirty);
window.addEventListener("resize", resizeCanvas);
new ResizeObserver(resizeCanvas).observe(el.canvasWrap);

document.addEventListener("keydown", (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
    if (e.key === "Escape") { endTool(); return; }
    if (e.key === "ArrowLeft") { e.preventDefault(); stepFrames(e.shiftKey ? -10 : -1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); stepFrames(e.shiftKey ? 10 : 1); }
    else if (e.key === " ") { e.preventDefault(); togglePlay(); }
    else if (e.key === "+" || e.key === "=") zoomButton(1.4);
    else if (e.key === "-") zoomButton(1 / 1.4);
    else if (e.key === "0") fitFrame();
    else if (e.key.toLowerCase() === "g") { el.gridToggle.checked = !el.gridToggle.checked; el.gridToggle.dispatchEvent(new Event("change")); }
    else if ((e.key === "Delete" || e.key === "Backspace") && S.selected !== null) {
        S.regions = S.regions.filter((r) => r.id !== S.selected);
        S.selected = null;
        persist();
        renderRegionList();
        analyze();
    }
});

// ── Khởi tạo ────────────────────────────────────────────────────────────────
restore();
targetOptions(el.newTarget);
el.fpsInput.value = String(S.fps);
el.gridToggle.checked = S.grid;
el.boxToggle.checked = S.boxes;
el.minLen.value = String(S.minLen);
el.minLenKey.value = String(S.minLenKey);
el.noiseKeys.value = String(S.noiseKeys);
el.gapFill.value = String(S.gapFill);
el.trimStart.checked = S.trimStart;
updateColorUi();
renderRegionList();
setSourceUi();
resizeCanvas();
requestAnimationFrame(tick);

// Cho phép kiểm thử / dùng từ console
window.Tracker = { S, V, video, regionFraction, grabFrame, loadVideoURL, scan, analyze, calibrate, addRegion, renderRegionList, fitRect, regionsBounds, buildSheet, setMode };
