# Mẫu nộp bài (điền vào file này, giữ nguyên các đề mục)

Họ tên: 
Thời gian làm thực tế (phút) cho từng bài: Bài 1 ...  Bài 2 ...  Bài 3 ...
Link video giải thích (3–5 phút, xem mục D): 

## A. Khai báo dùng AI / tài liệu

| Bài | Công cụ | Dùng để làm gì (1 câu) | Tôi đã sửa hoặc bỏ phần nào của kết quả AI, vì sao |
|---|---|---|---|
| 1 |  Deep-seek-v4.1 flash |  |  |
| 2 |  Deep-seek-v4.1 |  |  |
| 3 |  Deep-seek-v4.1 |  |  |



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
| L1 | 43–49 | Chrome hoặc extension sập (hay `write` lỗi) ngay sau khi `clickPost()` trả về nhưng trước khi lưu `submittedAt` | DB vẫn ghi job ở `running`/`queued`, lần chạy sau bấm Đăng lần hai → bài trùng trên tường | Cao | Ghi mốc `submitting` + `submittedAt` xuống DB **trước** khi bấm và coi mọi job đã qua mốc đó là `submitted_unknown`, không đưa lại hàng chờ |
| L2 | 55–61 | `clickPost()` thành công nhưng `findPublishedLink()` ném lỗi (bài đã lên, chưa lấy được link) | `catch` đặt `state = 'queued'` và `dueAt = +90s` → job bị đăng lại dù đã đăng | Cao | Trong `catch`, nếu đã qua mốc bấm Đăng thì chuyển `needs_reconcile`; chỉ trả `queued` khi chắc chắn chưa bấm |
| L3 | 38–40 | Một file media tải lỗi (ví dụ "Extension chưa được ghép nối với Media Bridge") | Chỉ `console.warn` rồi vẫn `clickPost()` → đăng caption trơ hoặc thiếu media, trái yêu cầu | Cao | Nếu `uploaded < job.post.media.length` thì `throw` để huỷ job, tuyệt đối không bấm Đăng |
| L4 | 22–23 | `readCookie('c_user')` trả rỗng/undefined (chưa đăng nhập, tab sai, cookie bị chặn) | Điều kiện `uid && ...` bỏ qua kiểm tra nick nên vẫn đăng; ngoài ra `throw` nằm ngoài `try` nên job kẹt `running` vĩnh viễn | Cao | Fail-closed: thiếu UID là lỗi chặn, và đưa kiểm tra nick vào trong `try` để job luôn được cập nhật trạng thái |
| L5 | 45–54 | Job khác ghi DB trong lúc `findPublishedLink()` chờ vài chục giây | `write(d2)` ghi đè ảnh chụp cũ, nuốt thay đổi của job khác — có thể đẩy job đã `submitted` về `queued` → đăng trùng | Cao | Chỉ cập nhật đúng bản ghi job (transaction/patch) và đọc lại ngay trước khi ghi, không ghi cả DB từ ảnh chụp cũ |
| L6 | 16–19, 44 | Hai job cùng profile chạy song song, hoặc `clickPost()` lỗi nên mốc `deskLastInteraction` không được ghi | Cả hai đọc cùng `last` rồi cùng lọt; các thao tác `openComposer`/`fillText`/`upload`/`clickPost` diễn ra liền nhau, không cách 60 giây | Cao | Khoá theo profile (mutex) và ghi mốc **ngay trước mỗi** thao tác Facebook, không chỉ một lần sau click |
| L7 | 10–13 | `jobId` không còn trong DB, hoặc job đã `success`/`submitted` bị gọi lại; job lỗi được requeue không giới hạn | `job.state` ném TypeError không ai bắt; job đã đăng bị set lại `running`; retry lặp vô hạn vì không có `attempt` cap | Trung bình | Kiểm tra job tồn tại + kiểm tra máy trạng thái trước khi chạy, và chặn số lần thử |

Ba trường hợp kiểm thử tôi sẽ viết:
1. **Sập sau khi bấm Đăng:** giả `tab` có `clickPost` resolve nhưng lần `write` kế tiếp ném lỗi (mô phỏng Chrome sập); chạy lại `runJob` với cùng `jobId` → khẳng định `clickPost` chỉ được gọi đúng 1 lần và job nằm ở `needs_reconcile`, không quay về `queued`.
2. **Thiếu media:** cho `job.post.media` có 3 phần tử, `tab.upload` ném lỗi ở phần tử thứ 2 → khẳng định `tab.clickPost` không được gọi lần nào và job kết thúc ở trạng thái lỗi an toàn.
3. **Nick không xác định + hai job song song:** cho `readCookie('c_user')` trả rỗng → khẳng định không có thao tác nào lên `tab`; sau đó cho UID đúng và chạy hai `runJob` đồng thời trên cùng profile → khẳng định chỉ một lần `clickPost` và mọi thao tác Facebook liên tiếp của profile cách nhau ≥ 60 giây.

Ba trường hợp này đã được hiện thực hoá thành bộ test chạy được: `bai2/bai2-fixed.test.mjs` (13 test, chạy `node --test bai2/bai2-fixed.test.mjs`). Test dùng `store.js` + `chrome.storage` + `tab` giả lập trong thư mục tạm nên không cần Chrome và không cần đăng nhập Facebook. Để chạy nhanh, test rút ngắn thời gian chờ qua `__configureForTests()`; giá trị production vẫn là 60000 ms và có một test riêng khẳng định điều đó. Tôi đã kiểm chứng ngược: hoàn nguyên từng chỗ sửa (L1…L7) thì test tương ứng fail, riêng L7 có hai lớp kiểm tra nên phải bỏ cả hai mới fail.

## D. Bài 3 — Kết luận

Cách chạy script: `node bai3/phan-tich.mjs` (mặc định đọc `bai3-log-mau.csv`, ghi `bai3/bao-cao.json`; có thể truyền đường dẫn riêng: `node bai3/phan-tich.mjs <csv> <json>`).

Kết quả chạy trên log mẫu (77 dòng): Nick-01 15 dòng/11 đăng/0.7333; Nick-02 17/8/0.4706; Nick-03 18/8/0.4444; Nick-04 12/10/0.8333; Nick-05 15/12/0.8. `can_doi_soat` 7 phần tử, `trung_ma` 2 mã, `vi_pham_gian_cach` `{"Nick-04":6}`, `dang_ban_dem` `{"Nick-05":6}`.

Hai quy ước tôi chọn khi đề chưa nói rõ, để người chấm đối chiếu: (1) `can_doi_soat` liệt kê theo **từng dòng** chờ link, nên `DOC2::bai-9` xuất hiện hai lần vì bài này bị bấm Đăng hai lần ở hai thời điểm khác nhau (08:40:06 và 09:30:00) — mỗi lần bấm là một việc cần đối soát riêng; (2) `nhom_loi` gộp theo đúng chuỗi ở cột "Lỗi gần nhất", sắp giảm dần theo số lần để nhóm nghiêm trọng nhất lên đầu.

Vấn đề đáng lo nhất và vì sao:

Vấn đề nghiêm trọng nhất là **không có hàng rào chống đăng trùng**: có 2 mã bài bị bấm Đăng nhiều lần (`DOC1::bai-6` thậm chí đăng thành công 2 lần với link `p/6` và `p/dup-6`, `DOC2::bai-9` bấm 2 lần và cả 2 đều đang chờ link). Đây là loại lỗi người dùng nhìn thấy ngay, không thể xoá hậu quả, và là dấu hiệu tool đang requeue sau khi đã bấm — đúng lỗi L1/L2 của Bài 2. Kèm theo đó, 7 bài của Nick-02 đang ở trạng thái "Đã bấm Đăng, chờ link" (chiếm 41% số bài của nick này, tỉ lệ thành công chỉ 0,4706) cho thấy bước xác minh sau khi bấm đang hỏng hoặc bị bỏ qua, và 9/14 lỗi toàn hệ thống tập trung ở Nick-03 với cùng một nguyên nhân media. Nếu để nguyên, mỗi ngày vận hành đều có thể sinh thêm bài trùng và bài mồ côi.

5 việc trong tuần tới (xếp theo ưu tiên):
1. Chặn đăng trùng: thêm khoá duy nhất theo `(nick, mã bài)` ở tầng dữ liệu và chỉ cho một job sống cho mỗi mã bài; rà tay 7 bài chờ link của Nick-02 và 2 mã trùng để xác định bài nào thực sự đã lên.
2. Sửa bước xác minh sau khi bấm: ghi mốc "đã bấm" trước khi click và đưa mọi trường hợp không lấy được link sang trạng thái cần đối soát thay vì trả về hàng chờ (áp bản sửa Bài 2 vào production).
3. Xử lý lỗi media của Nick-03: chặn đăng khi thiếu media và tự kiểm tra kết nối Media Bridge trước khi mở hộp soạn; hiện lỗi này chiếm 64% tổng số lỗi.
4. Siết giãn cách: Nick-04 có 6 cặp thao tác liên tiếp dưới 60 giây (có cặp chỉ 20 giây) — thêm khoá theo profile và kiểm tra giãn cách ở tầng thực thi, không chỉ ở bộ xếp lịch.
5. Chặn đăng ban đêm: Nick-05 có 6 bài bấm trong khung 0–6 giờ, cho thấy cấu hình giờ nghỉ chưa được áp cho toàn bộ nick; đối chiếu lại lịch đã sinh với `quietStartH/quietEndH`.

Việc KHÔNG nên làm vội và lý do:

Không nên tăng số lượng nick hoặc tăng tần suất đăng để "bù" cho các bài lỗi. Khi tỉ lệ thành công đang ở 0,44–0,83 và đã có dấu hiệu đăng trùng, việc tăng tải sẽ làm lỗi lan nhanh hơn, che mất nguyên nhân gốc và có thể khiến nick bị hạn chế nặng hơn. Cũng không nên tự động xoá các bài "chờ link" để làm sạch báo cáo, vì có thể xoá nhầm bài đã lên thật.

Dữ liệu còn thiếu để kết luận chắc chắn hơn:

Thiếu mã định danh duy nhất cho mỗi lần bấm (ID job/lần thử) nên không phân biệt được "bấm lại cùng một bài" với "hai bài khác nhau trùng mã"; thiếu thời điểm kết thúc và số lần thử nên không đo được độ trễ xác minh; thiếu kết quả sau khi lên bài (bài còn tồn tại, có bị gỡ, lượt hiển thị) nên chưa kết luận được nick nào đang bị hạn chế; và thiếu cấu hình mong đợi theo từng nick (trần ngày, giờ nghỉ) nên chưa biết các vi phạm 60 giây/ban đêm là do cấu hình hay do tool bỏ qua cấu hình.

## E. Video giải thích (3–5 phút, bắt buộc)

Quay màn hình và nói trực tiếp (không đọc script), nêu: (1) chỉ vào đoạn code khó nhất của Bài 1 và giải thích nó làm gì; (2) lỗi bạn cho là nghiêm trọng nhất ở Bài 2 và kịch bản gây lỗi; (3) điều bạn quyết định làm đầu tiên ở Bài 3 và vì sao. Dán link (Google Drive hoặc Loom, chế độ ai có link cũng xem được) ở đầu file này.
