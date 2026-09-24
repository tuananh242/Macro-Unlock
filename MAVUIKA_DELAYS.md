# Delay từng nút Mavuika (ký hiệu combo)

Nguồn: trang https://vulcanizer.netlify.app/ (combo mẫu CDCDCF và CD, trainer) và file thật
`Mav OL full rotation.amc` (Q C 3(DCDCCF) DCF). Macro dùng số của file `.amc`.

## Ký hiệu

| Ký hiệu | Ý nghĩa |
|---|---|
| `C` | Giữ chuột trái (charge) |
| `D` | Dash (Shift) |
| `F` | Nhả chuột sau khi charge đủ lâu = finisher |
| `.` | 1 click chuột trái |
| `..` | 2 click liên tiếp, nghỉ 50ms giữa hai click |
| khoảng trắng | Chỉ tách nhóm cho dễ đọc |

### Ký hiệu mở rộng (`gen_mav_combo.build_v2`)

| Ký hiệu | Ý nghĩa |
|---|---|
| `Q` | Gõ Q 202ms, rồi chờ 1555ms (số của `.amc`) |
| `[DC]` | Tech buffer Mavuika: xử lý y hệt chuỗi `D C` của Overload (dấu `[ ]` chỉ để gom nhóm) |
| `~` | Double tap = 2 click (giống `..`) |
| `( )` | Nhóm cuối lặp lại cho tới khi nhả hotkey (bước "Bắt đầu/Kết thúc lặp" của trình tạo combo) |

Trong đoạn giữ `C C F` có thêm một lần D ở +200ms rồi giữ 1000ms mới nhả (video
`lhQTiK7JIXU` đo được D nằm trong đoạn giữ ~1300ms, D cách lúc nhấn 133-200ms).

Combo `Q C[DC] ~ C[DC][DC] CF[DC][DC] CF[DC][DC] (CF[DC]D)` (~11.9s một lượt) được
tạo thành combo tùy chỉnh trong `resources\config.json` (hotkey F7). Sinh lại bằng
`build_v2` + `to_steps`.

## Bảng delay

| Bước | Trang (trainer) | `.amc` (macro dùng) |
|---|---|---|
| Nhấn C → bấm D | 200ms | 200ms |
| D giữ | 50ms | 91ms |
| Nhả D → nhả C (cancel) | 70ms | 151ms |
| Nhả C → nhấn C lại | 50ms | 90ms |
| Nhấn C lại → bấm D | 200ms | 200ms |
| Nhả D cuối → nhả C ra F | 1020ms | 1000ms |
| Sau F → nút kế (chờ D hồi) | 520ms | 853ms |
| C đơn lẻ (charge ngắn, `Q C`) | - | giữ 300ms, nghỉ 60ms |
| 1 click | - | giữ 64ms (số đo click N1) |
| Giữa 2 click | - | 50ms (user cho) |

Đối chiếu: đơn vị `CDCDCF` sinh ra khớp từng mốc file `.amc`
(0 / 200 / 291 / 442 / 532 / 732 / 823 / 1823ms).

## Quy tắc đọc ký hiệu (cách hiểu đã chọn)

- `C` mở đầu + `D` kế tiếp: nhấn giữ, chờ 200ms rồi dash.
- `D` rồi `C` rồi `D`: cancel (nhả sau 151ms), nghỉ 90ms, nhấn lại, chờ 200ms rồi dash.
- `D` rồi `C` rồi `F`: giữ thêm 1000ms rồi nhả (finisher).
- `D` rồi `C C` rồi `F`: cancel + nhấn lại, giữ 1291ms (200 + 91 + 1000) rồi nhả. Chỗ này không có D thứ hai vì D đang hồi.
- `D` rồi `C` ở cuối nhóm: cancel, nhả sau 151ms.
- `F` xong nghỉ 853ms; `D` sau `F` bấm sau 853ms rồi nghỉ 90ms.
- `C` đứng riêng (không kèm D, ví dụ sau `F D`): charge ngắn 300ms rồi nhả.

## Combo đã tạo (`src/macro/mavuika.json`, mode `once`)

Hai combo `CDC .. CDCDCFD CDCCFD CDC` và `CDC .. CDCCFDC .. CDC .. CDCDC` đã bị xóa (2026-09-21, user bảo không dùng được).

Sinh lại events: `python gen_mav_combo.py` (chỉnh hằng số delay ở đầu file).
Đổi delay `D sau F`, `C đơn lẻ` hay click nếu thực tế thấy lệch.

## Combo Melt (`melt.xml`)

`C0:  Combo Mavuika Melt`, mode `once`, ~7.6s. Delay trong file là giây (×1000 ra ms; 0.85 ≈ 853ms, 0.19 ≈ 200ms của `.amc`).

| Mốc (ms) | Hành động |
|---|---|
| 0 → 2250 | Giữ C 2.25s rồi nhả (F) |
| 2250 → 3100 | Nghỉ 850ms |
| 3100 | Nhấn C, sau 180ms giữ Shift 900ms, nhả Shift và C cùng lúc |
| +600 | Nghỉ, nhấn C, sau 190ms giữ Shift 900ms, nhả cả hai |
| +600 | Nghỉ, nhấn C, sau 200ms giữ Shift 930ms, nhả cả hai |

Shift ở đây là giữ dài (~0.9s) chứ không bấm 91ms như `D` trong ký hiệu CDCDCF.
