# Mẫu nộp bài (điền vào file này, giữ nguyên các đề mục)

Họ tên: 
Thời gian làm thực tế (phút) cho từng bài: Bài 1 ...  Bài 2 ...  Bài 3 ...
Link video giải thích (3–5 phút, xem mục D): 

## A. Khai báo dùng AI / tài liệu

| Bài | Công cụ | Dùng để làm gì (1 câu) | Tôi đã sửa hoặc bỏ phần nào của kết quả AI, vì sao |
|---|---|---|---|
| 1 |  |  |  |
| 2 |  |  |  |
| 3 |  |  |  |

(Nếu không dùng AI cho bài nào thì ghi "không dùng".)

## B. Bài 1 — Bản đồ yêu cầu và quyết định

Cách chạy test: `node --test bai1/plan-schedule.test.mjs` (hoặc `node bai1/plan-schedule.test.mjs`). Đã chạy trên Node v20.20.2: 9/9 test pass.

| Ràng buộc | Hàm / dòng thực hiện trong plan-schedule.mjs | Test nào kiểm tra |
|---|---|---|
| 1. Giãn cách + độ lệch ngẫu nhiên | `sampleGap()` dòng 146–148 (kẹp `Math.max(hardMinGapMs, ...)`); gọi tại dòng 287 khi đẩy bài kế tiếp vào heap | `RB1` (dòng 47), `RB1+RB3` (dòng 136) |
| 2. Khung giờ nghỉ | `hourOf()` 160, `inQuiet()` 166, `afterQuiet()` 172, `nextDayQuietEnd()` 180; dời bài bằng cách đẩy lại heap tại 260–275 | `RB2` (dòng 62) — có ca start 23h vắt qua nửa đêm |
| 3. Trần bài mỗi ngày | `indexNicks()` 82–100 (cap riêng > `opts.dailyCap`); đếm `dayCount` tại 277 theo `dayIndex()` (lịch địa phương), chặn trần tại 270–275 | `RB3` (dòng 81), `RB3 dailyCap riêng` (dòng 97), `RB1+RB3` (dòng 136) |
| 4. Không trùng giây giữa các nick | dòng 254–255: `t = max(t, globalLast + globalGapMs)` trên toàn bộ bài đã phát, không phân biệt nick | `RB4` (dòng 112) |
| 5. Giữ thứ tự bài | `buildQueues()` 102–120 push theo thứ tự mảng gốc; mỗi nick chỉ có một ứng viên `k` trong heap, bài `k+1` chỉ được đẩy lên sau khi bài `k` đã phát (dòng 285–289) | `RB5` (dòng 124) |
| 6. Seed, lỗi dữ liệu | `fnv1a()` 123, `mulberry32()` 132, `jitterRng()` 141 khoá theo `seed + ':' + nickId`; validate `normalizeOptions()` 39–80; `posts` rỗng trả `[]` tại 234 | `RB6` (dòng 157), `RB6 lỗi/rỗng` (dòng 168) |

Vì sao tôi chọn cách sinh số ngẫu nhiên có seed này (3–5 dòng):

Đề yêu cầu "cùng seed thì cùng kết quả", nên tôi cần PRNG tất định chứ không dùng `Math.random()`. Tôi dùng mulberry32 vì chỉ khoảng 10 dòng, đủ tốt cho việc rải nhịp và không cần thư viện. Điểm quyết định là khoá seed theo từng nick (`hash(seed + ':' + nickId)`) thay vì một chuỗi ngẫu nhiên dùng chung: nhờ vậy chuỗi jitter của mỗi nick giữ nguyên khi thêm/bớt nick khác hay đổi thứ tự mảng `nicks` — quan trọng khi vận hành số lượng lớn tài khoản và phải tính lại lịch cục bộ. Cần nói rõ giới hạn: seed theo nick chỉ bảo đảm phần ngẫu nhiên của nick không đổi; thời điểm tuyệt đối vẫn dịch khi số nick thay đổi, vì ràng buộc giãn cách toàn cục (`globalGapMs`) và trần ngày liên kết các nick với nhau. Toàn bộ số ngẫu nhiên được lấy theo thứ tự cố định trong một lượt duyệt heap tất định (tie-break theo `t`, `nickId`, `k`), nên kết quả không phụ thuộc thứ tự duyệt Map.

Một tình huống biên mà tôi lo nhất và tôi xử lý thế nào (3–5 dòng):

Ca tôi lo nhất là một bài bị dời xa (hết trần ngày hoặc rơi vào giờ nghỉ) lại kéo lịch của các nick khác trễ theo. Bản đầu tôi gán ngay mốc bị dời rồi đẩy mốc "bài gần nhất toàn cục" tới đó; tôi phát hiện bằng một ca 2 nick (`A` có `dailyCap = 1`, `B` có 10 bài và trần 20): `B` lẽ ra đăng gọn trong ngày đầu nhưng bị đẩy sang ngày thứ 4. Cách sửa là không gán ngay mà đẩy lại ứng viên vào heap với thời điểm muộn hơn (dòng 260–275) để heap tự sắp lại theo thời điểm thật; từ đó `B` đăng đúng trong ngày đầu. Ca này giờ là test `RB1+RB3` (dòng 136) và tôi đã kiểm chứng nó fail trên bản cũ, pass trên bản mới. Tôi cũng chặn trước hai cấu hình không thể giải (`quietStartH = 0` và `quietEndH = 24`, dòng 66) và `dailyCap < 1`.

Ghi chú về xung đột ràng buộc (để người chấm đối chiếu khi thấy kết quả "vượt 130%"):

Khi bài bị dời vì giờ nghỉ/trần ngày/`globalGapMs`, khoảng cách thực tế của cùng một nick có thể lớn hơn 130% `minGapMs`. Tôi hiểu ràng buộc 1 là dải mục tiêu trong điều kiện không có ràng buộc khác can thiệp, còn `hardMinGapMs` mới là bất biến tuyệt đối (luôn đúng). Test `RB1` vì vậy chạy với một nick, `globalGapMs = 0`, `dailyCap` lớn để đo đúng dải 70–130%; dữ liệu lớn 50 nick × 40 bài đã kiểm tra riêng: `hardMinGapMs` luôn giữ, `globalGapMs` luôn ≥ 5000 ms, không bài nào vào 0–6h, không nick-ngày nào vượt trần. Ngoài ra khi `jitter = 0` hoặc mỗi nick chỉ có 1 bài thì "khác seed phải khác kết quả" không thể đúng về mặt toán học — tôi ghi rõ ở đây thay vì làm test giả.

Về `seed` thiếu: đề liệt kê `seed` không kèm giá trị mặc định. Tôi cho mặc định `''` để hàm vẫn chạy (kết quả khi đó vẫn tất định) thay vì biến trường thiếu thành lỗi chặn toàn bộ; các trường thực sự sai kiểu/giá trị như `start` không hữu hạn, `jitter` ngoài `[0,1]`, `nickId` không tồn tại, `postId` trùng đều ném `TypeError` nêu rõ tên trường.

## C. Bài 2 — Bảng lỗi

| ID | Dòng | Kịch bản gây lỗi | Hậu quả | Mức độ | Cách sửa (1 câu) |
|---|---|---|---|---|---|
| L1 |  |  |  |  |  |
| L2 |  |  |  |  |  |
| L3 |  |  |  |  |  |
| L4 |  |  |  |  |  |
| L5 |  |  |  |  |  |

Ba trường hợp kiểm thử tôi sẽ viết:
1. 
2. 
3. 

## D. Bài 3 — Kết luận

Cách chạy script: `...`

Vấn đề đáng lo nhất và vì sao:

5 việc trong tuần tới (xếp theo ưu tiên):
1. 
2. 
3. 
4. 
5. 

Việc KHÔNG nên làm vội và lý do:

Dữ liệu còn thiếu để kết luận chắc chắn hơn:

## E. Video giải thích (3–5 phút, bắt buộc)

Quay màn hình và nói trực tiếp (không đọc script), nêu: (1) chỉ vào đoạn code khó nhất của Bài 1 và giải thích nó làm gì; (2) lỗi bạn cho là nghiêm trọng nhất ở Bài 2 và kịch bản gây lỗi; (3) điều bạn quyết định làm đầu tiên ở Bài 3 và vì sao. Dán link (Google Drive hoặc Loom, chế độ ai có link cũng xem được) ở đầu file này.
