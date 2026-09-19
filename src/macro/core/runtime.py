"""
runtime.py – Global state, combo sequences, key bindings, worker thread, listeners.

Bao gồm:
  - Global state (pressed, running_states, active_bindings, …)
  - is_no_key_pressed() helper
  - Combo sequences C0
  - COMBO_MAP, STEP_MAP
  - build_custom_combo_fn()
  - apply_all_bindings()
  - parse_input()
  - worker() – thread thực thi macro với crash recovery
  - on_press / on_release / on_click
"""

import threading
import time
from pynput.keyboard import Key, KeyCode
from pynput.mouse    import Button

from .macros     import (
    skk3aw, skk3as, skk2as, skk2a,
    skk2az, skk2azs, skk2azs_slow,
    skk5as, skk5a, skk2aq, skke,
    mav_combo,
    mav_press_c, mav_release_c, mav_tap_d, mav_tap_q, mav_wait,
)
from . import macros as _macros
from .focus      import is_game_foreground
from .config_io import log_debug

# ── Global state ──────────────────────────────────────────────────────────────
run_enabled     = False       # bật/tắt bởi nút RUN trong UI
active_bindings = {}          # { pynput_key: combo_fn }
running_states  = {}          # { pynput_key: bool }
pressed         = set()       # tập phím/nút đang giữ
_thread_local   = threading.local()
FPSinput        = 120         # FPS hiện tại, cập nhật từ config


def is_no_key_pressed():
    """True = combo phải dừng.

    Dừng khi: (a) Genshin không còn là cửa sổ foreground (alt-tab giữa combo),
    hoặc (b) phím bind của worker hiện tại đã được thả.
    """
    if not is_game_foreground():
        return True
    key = getattr(_thread_local, "bind_key", None)
    if key is None:
        return True
    return key not in pressed


# Combo Mavuika giữ chuột/Shift dài nên cần abort sớm; macros.py không import
# ngược được runtime.py (vòng), nên tiêm hàm kiểm tra vào đây.
_macros.should_abort = is_no_key_pressed
# Combo mode "once" chay tron chuoi sau 1 lan bam, nen KHONG dung khi nha nut;
# chi dung khi Genshin mat foreground.
_macros.should_abort_once = lambda: not is_game_foreground()

# Không cho gán combo giữ-phím vào chính phím mà nó bắn ra -> feedback loop.
BLOCKED_HOLD_BINDS = frozenset({
    Button.left, Key.shift, Key.shift_l, Key.shift_r,
})


# ── Named combo sequences ─────────────────────────────────────────────────────

def skk223_loop(fps):
    """Lặp vô hạn 2-2-3 cho đến khi nhả phím."""
    start = time.perf_counter()
    while time.perf_counter() - start < 20:
        skk2as(fps)
        skk2as(fps)
        skk3aw(fps)
        if is_no_key_pressed():
            break


def skkC0_EQA_120f(fps):
    """C0: 222q 223 223 22cd23 223  –  tối ưu cho ~120 fps."""
    skke(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2aq(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk3aw(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk3aw(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2azs_slow(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk3aw(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk3aw(fps)


def skkC0_QEA_120f(fps):
    """C0: 222c 223 223 22cd23 223  –  biến thể QEA ~120 fps."""
    skke(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2az(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk3aw(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk3aw(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2azs_slow(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk3aw(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk3aw(fps)


def skkC0_EQA_60f(fps):
    """C0: 222q 223 223 22c 224  –  tối ưu cho ~60 fps."""
    skke(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2aq(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk3aw(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk3aw(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2az(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk5as(fps)


# Ten combo Mavuika = key trong mavuika.json. Doi ten o day phai doi ca 2 noi.
MAVUIKA_COMBOS = (
    "C0:  Combo Mavuika CDCDCF (Full Combo)",
    "C0:  Combo Mavuika CD (Short Loop)",
    "C0:  Combo Mavuika Overload Q C 3(DCDCCF) DCF",
)

_MAVUIKA_FNS = {name: mav_combo(name) for name in MAVUIKA_COMBOS}


# ── Combo map & step map ──────────────────────────────────────────────────────

COMBO_MAP = {
    "C0:  Combo Skirk C0 EQA 120fps": skkC0_EQA_120f,
    "C0:  Combo Skirk C0 EA 120fps":  skkC0_QEA_120f,
    "C0:  Combo Skirk C0 EQA 60fps":  skkC0_EQA_60f,
    **_MAVUIKA_FNS,
}

# BUG FIX: thêm skk2a và skk5a (thiếu trong phiên bản cũ, custom combo cần)
STEP_MAP = {
    "skk3aw":       skk3aw,
    "skk2as":       skk2as,
    "skk2a":        skk2a,          # n2  – đã thêm
    "skk3as":       skk3as,
    "skk2az":       skk2az,
    "skk2azs":      skk2azs,
    "skk2azs_slow": skk2azs_slow,
    "skk2aq":       skk2aq,
    "skke":         skke,
    "skk5as":       skk5as,
    "skk5a":        skk5a,          # n5  – đã thêm
    # ── Mavuika: dùng trong custom combo, key = tên trong mavuika.json ──
    "mav_cdcdcf":   _MAVUIKA_FNS[MAVUIKA_COMBOS[0]],
    "mav_cd":       _MAVUIKA_FNS[MAVUIKA_COMBOS[1]],
    "mav_overload": _MAVUIKA_FNS[MAVUIKA_COMBOS[2]],
    # ── Mavuika: nhịp nhỏ cho combo tự tạo (số liệu từ Mav OL full rotation.amc) ──
    "mav_b_q":      mav_combo("beat_q"),
    "mav_b_c":      mav_combo("beat_c"),
    "mav_b_d":      mav_combo("beat_d"),
    "mav_b_cd":     mav_combo("beat_cd"),
    "mav_b_cdf":    mav_combo("beat_cdf"),
    # ── Mavuika: nút rời, tự ghép lấy nhịp ──
    "mav_c_hold":   mav_press_c,
    "mav_c_rel":    mav_release_c,
    "mav_d":        mav_tap_d,
    "mav_q":        mav_tap_q,
    # ── Khối chờ ──
    "wait_50":     mav_wait(50),
    "wait_100":    mav_wait(100),
    "wait_150":    mav_wait(150),
    "wait_200":    mav_wait(200),
    "wait_300":    mav_wait(300),
    "wait_500":    mav_wait(500),
    "wait_1000":   mav_wait(1000),
}


def build_custom_combo_fn(name, python_sequence):
    """Tạo hàm combo động từ danh sách pythonSequence."""
    steps = []
    for step_name in python_sequence:
        if step_name == "is_no_key_pressed":
            steps.append(("check", None))
        else:
            fn = STEP_MAP.get(step_name)
            if fn is not None:
                steps.append(("call", fn))
    steps = tuple(steps)  # freeze

    # Combo tự tạo có bước Mavuika thì cũng phải chịu rào chắn bind
    uses_held = any(
        getattr(fn, "uses_held_input", False) for kind, fn in steps if kind == "call"
    )

    def custom_combo(fps):
        # Nút rời "C giữ" không tự nhả, nên mọi đường thoát đều phải nhả sạch
        # chuột trái + Shift + Q, nếu không sẽ kẹt phím.
        try:
            for kind, fn in steps:
                if kind == "check":
                    if is_no_key_pressed():
                        return
                else:
                    fn(fps)
        finally:
            if uses_held:
                _macros._mav_release_all()

    custom_combo.__name__ = name or f"custom_combo_{id(custom_combo)}"
    custom_combo.uses_held_input = uses_held
    return custom_combo


# ── Key/button parsing ────────────────────────────────────────────────────────

def parse_input(name):
    """Chuyển chuỗi tên phím → pynput key/button object."""
    log_debug(f"parse_input: {name}")
    if name == "mouse_4":
        return Button.x2
    if name == "mouse_3":
        return Button.x1

    if hasattr(Button, name):
        return getattr(Button, name)
    if hasattr(Key, name):
        return getattr(Key, name)
    if len(name) == 1:
        return KeyCode.from_char(name.lower())

    raise ValueError(f"Unknown key: {name}")


# ── apply_all_bindings ────────────────────────────────────────────────────────

def apply_all_bindings(sign_keys_map, custom_combos=None):
    """Xây dựng active_bindings từ comboSignKeys và customCombos."""
    global active_bindings, running_states
    log_debug(f"apply_all_bindings called with: {sign_keys_map}")

    # Dừng tất cả worker đang chạy
    for key in list(running_states):
        running_states[key] = False

    active_bindings = {}
    running_states  = {}

    # 1. Built-in combos
    for combo_str, key_name in sign_keys_map.items():
        fn = COMBO_MAP.get(combo_str)
        if fn is None:
            log_debug(f"Combo not found in COMBO_MAP: {combo_str}")
            continue
        try:
            parsed = parse_input(key_name)
            if getattr(fn, "uses_held_input", False) and parsed in BLOCKED_HOLD_BINDS:
                log_debug(f"TU CHOI bind {parsed} -> {fn.__name__}: combo giu chuot "
                          f"trai/Shift, bind vao chinh phim do se tu kich hoat lap vo han")
                continue
            active_bindings[parsed] = fn
            log_debug(f"Bound: {parsed} -> {fn.__name__}")
        except Exception as e:
            log_debug(f"Error binding {key_name}: {e}")

    # 2. Custom combos
    if custom_combos:
        for combo in custom_combos:
            hotkey = combo.get("hotkey")
            seq    = combo.get("pythonSequence", [])
            if not hotkey or not seq:
                continue
            try:
                parsed = parse_input(hotkey)
                fn     = build_custom_combo_fn(combo.get("name", "custom"), seq)
                if getattr(fn, "uses_held_input", False) and parsed in BLOCKED_HOLD_BINDS:
                    log_debug(f"TU CHOI bind custom {parsed} -> {fn.__name__}: "
                              f"combo co buoc Mavuika, khong duoc bind vao chuot trai/Shift")
                    continue
                active_bindings[parsed] = fn
                log_debug(f"Bound custom: {parsed} -> {fn.__name__}")
            except Exception as e:
                log_debug(f"Error binding custom combo {combo.get('name')}: {e}")


# ── Worker thread ─────────────────────────────────────────────────────────────

def worker(key):
    """Thread thực thi macro. Crash recovery: reset running_states khi có lỗi."""
    _thread_local.bind_key = key
    log_debug(f"Worker thread started for key: {key}")

    while running_states.get(key, False):
        fn = active_bindings.get(key)
        if fn is None:
            log_debug(f"Worker: no function bound to {key}")
            break
        try:
            log_debug(f"Worker: executing {fn.__name__}")
            fn(FPSinput)
            log_debug(f"Worker: finished {fn.__name__}")
        except Exception as e:
            import traceback
            log_debug(f"Worker Exception running {fn.__name__}: {e}")
            log_debug(traceback.format_exc())
            # BUG FIX: reset state để lần nhấn phím tiếp theo có thể khởi động lại
            running_states[key] = False
            break

    log_debug(f"Worker thread stopped for key: {key}")


# ── Keyboard / Mouse listeners ────────────────────────────────────────────────

def on_press(key):
    pressed.add(key)
    if not run_enabled:
        return
    # Focus guard: chỉ kích hoạt khi Genshin đang là cửa sổ foreground
    if not is_game_foreground():
        return
    for tgt in list(active_bindings):
        if tgt in pressed and not running_states.get(tgt, False):
            running_states[tgt] = True
            log_debug(f"Trigger worker for target key: {tgt}")
            threading.Thread(target=worker, args=(tgt,), daemon=True).start()


def on_release(key):
    pressed.discard(key)
    for tgt in list(active_bindings):
        if tgt not in pressed:
            running_states[tgt] = False


def on_click(x, y, button, is_pressed):
    if is_pressed:
        pressed.add(button)
        if not run_enabled:
            return
        # Focus guard: chỉ kích hoạt khi Genshin đang là cửa sổ foreground
        if not is_game_foreground():
            return
        for tgt in list(active_bindings):
            if tgt in pressed and not running_states.get(tgt, False):
                running_states[tgt] = True
                log_debug(f"Trigger worker for target button: {tgt}")
                threading.Thread(target=worker, args=(tgt,), daemon=True).start()
    else:
        pressed.discard(button)
        for tgt in list(active_bindings):
            if tgt not in pressed:
                running_states[tgt] = False
