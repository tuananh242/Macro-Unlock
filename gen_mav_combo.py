"""Sinh events Mavuika tu ky hieu: C D F, '.' = click, khoang trang = tach nhom."""
import json

# Delay thuc (tu 'Mav OL full rotation.amc')
PRE_D = 200      # nhan C -> bam D
D_HOLD = 91      # D giu
CANCEL = 151     # nha D -> nha C (cancel)
GAP = 90         # nha C -> nhan C lai / nut ke tiep
HOLD_F = 1000    # nha D cuoi -> nha C ra F
F_REST = 853     # sau F cho D hoi
TAP_C = 300      # C ngan (Q C trong amc)
TAP_REST = 60
CLICK = 64       # giu chuot 1 click (beat_click)
CLICK_GAP = 50   # nghi giua 2 click (user: 50ms thuc te)


def tokens(notation):
    toks = []
    for g in notation.split():
        toks += ["."] * len(g) if set(g) == {"."} else list(g)
    return toks


def build(notation):
    toks, ev, t, held = tokens(notation), [], 0, False
    i = 0
    while i < len(toks):
        k = toks[i]
        nxt = toks[i + 1] if i + 1 < len(toks) else None
        i += 1
        if k == ".":
            ev.append([t, "c_down"]); t += CLICK
            ev.append([t, "c_up"]); t += CLICK_GAP
        elif k == "C":                       # C mo dau (chua giu)
            ev.append([t, "c_down"])
            if nxt == "D":
                held = True; t += PRE_D
            else:                            # C don le = charge ngan roi nha
                t += TAP_C; ev.append([t, "c_up"]); t += TAP_REST
        elif k == "D":
            ev.append([t, "d_down"]); t += D_HOLD; ev.append([t, "d_up"])
            if not held:                     # D sau F: nghi roi toi nut ke
                t += GAP
                continue
            nk = toks[i] if i < len(toks) else None
            nn = toks[i + 1] if i + 1 < len(toks) else None
            if nk != "C":
                continue
            if nn == "D":                    # cancel, charge lai, tiep D
                t += CANCEL; ev.append([t, "c_up"]); t += GAP
                ev.append([t, "c_down"]); t += PRE_D; i += 1
            elif nn == "C":                  # cancel, charge lai, giu toi F
                t += CANCEL; ev.append([t, "c_up"]); t += GAP
                ev.append([t, "c_down"]); t += PRE_D + D_HOLD + HOLD_F; i += 2
            elif nn == "F":                  # giu tiep roi F
                t += HOLD_F; i += 1
            else:                            # het nhom: cancel
                t += CANCEL; ev.append([t, "c_up"]); held = False; t += GAP; i += 1
        elif k == "F":
            ev.append([t, "c_up"]); held = False; t += F_REST
    while ev and ev[-1][1] == "end":
        ev.pop()
    ev.append([ev[-1][0], "end"])
    return ev


Q_HOLD = 202     # go Q (.amc)
Q_REST = 1555    # Q xong cho toi nut ke (.amc)


def build_v2(notation, dash_in_hold=True):
    """Ky hieu mo rong cua user: Q C D F ~ , [ ] chi de gom nhom, ( ) = nhom lap.

    - '[DC]' la tech buffer Mavuika: xu ly y het chuoi D C trong Overload.
    - '~' = double tap (2 click, nhu '..').
    - '( )' = nhom cuoi lap cho toi khi nha hotkey.
    - dash_in_hold: khi giu F sau 'D C C', co 1 lan D o +200ms (video do duoc
      D nam trong doan giu 1300ms), khong chi cho im.
    Tra ve (events, loop_idx): loop_idx = chi so event bat dau doan lap, hoac None.
    """
    toks, loop_tok = [], None
    for ch in notation:
        if ch in " []":
            continue
        if ch == "(":
            loop_tok = len(toks)
            continue
        if ch == ")":
            continue
        toks.append(ch)

    ev, t, held, loop_idx = [], 0, False, None

    def click():
        nonlocal t
        ev.append([t, "c_down"]); t += CLICK
        ev.append([t, "c_up"]); t += CLICK_GAP

    i = 0
    while i < len(toks):
        k = toks[i]
        nxt = toks[i + 1] if i + 1 < len(toks) else None
        i += 1
        if k == "Q":
            ev.append([t, "q_down"]); t += Q_HOLD
            ev.append([t, "q_up"]); t += Q_REST
        elif k in ".~":
            click()
            if k == "~":
                click()
        elif k == "C":
            ev.append([t, "c_down"])
            if nxt == "D":
                held = True; t += PRE_D
            else:
                t += TAP_C; ev.append([t, "c_up"]); t += TAP_REST
        elif k == "D":
            ev.append([t, "d_down"]); t += D_HOLD; ev.append([t, "d_up"])
            if not held:
                t += GAP
                continue
            nk = toks[i] if i < len(toks) else None
            nn = toks[i + 1] if i + 1 < len(toks) else None
            if nk != "C":
                continue
            if nn == "D":
                t += CANCEL; ev.append([t, "c_up"]); t += GAP
                ev.append([t, "c_down"]); t += PRE_D; i += 1
            elif nn == "C":
                t += CANCEL; ev.append([t, "c_up"]); t += GAP
                ev.append([t, "c_down"]); t += PRE_D
                if dash_in_hold:
                    ev.append([t, "d_down"]); t += D_HOLD; ev.append([t, "d_up"])
                    if loop_tok in (i, i + 1):
                        loop_idx = len(ev)          # ngay sau d_up, truoc doan giu
                    t += HOLD_F
                else:
                    t += D_HOLD + HOLD_F
                i += 2
            elif nn == "F":
                t += HOLD_F; i += 1
            else:
                t += CANCEL; ev.append([t, "c_up"]); held = False; t += GAP; i += 1
        elif k == "F":
            ev.append([t, "c_up"]); held = False; t += F_REST
    return ev, loop_idx


def to_steps(ev, loop_idx=None):
    """events Mavuika -> cac buoc kieu Keyran (timeline cua trinh tao combo)."""
    ops = {
        "c_down": {"type": "mouse_down", "button": "left"},
        "c_up":   {"type": "mouse_up", "button": "left"},
        "d_down": {"type": "key_down", "key": "shift"},
        "d_up":   {"type": "key_up", "key": "shift"},
        "q_down": {"type": "key_down", "key": "q"},
        "q_up":   {"type": "key_up", "key": "q"},
    }
    steps, last = [], None
    for idx, (t, name) in enumerate(ev):
        if idx == loop_idx:
            steps.append({"type": "loop_start"})
        if last is not None and t - last > 0:
            steps.append({"type": "wait", "ms": t - last})
        steps.append(dict(ops[name]))
        last = t
    if loop_idx is not None:
        steps.append({"type": "loop_end"})
    return steps


if __name__ == "__main__":
    for n in ["CDCDCF", "Q C[DC] ~ C[DC][DC] CF[DC][DC] CF[DC][DC] (CF[DC]D)"]:
        ev = build(n)
        print(n, len(ev))
        for e in ev:
            print("  ", e)
    # kiem tra don vi CDCDCF khop amc: 0,200,291,442,532,732,823,1823
    print(build("CDCDCF"))
