# Bài kiểm tra thực hành — Lập trình tự động hoá (3 bài)

Thời gian gợi ý: 2,5–3 giờ. Cách nộp: một thư mục (nén .zip) theo đúng cấu trúc ở mục "Cấu trúc nộp bài" bên dưới, kèm file `MAU-NOP-BAI.md` đã điền.

## Quy định chung

- Được dùng tài liệu, Google và công cụ AI. Bắt buộc khai báo rõ trong `MAU-NOP-BAI.md`: dùng ở bước nào, hỏi gì, nhận được gì, bạn đã sửa hay bỏ phần nào. Không khai báo, hoặc khai không đúng sự thật, là không đạt.
- Bạn phải tự giải thích được mọi dòng nộp. Sau khi nộp có buổi vấn đáp khoảng 15–20 phút: chia sẻ màn hình, giải thích bài, và sửa trực tiếp một yêu cầu mới.
- Bài nộp phải chạy được bằng đúng các lệnh ghi trong đề. Bài không chạy được thì phần đó chấm 0.
- Không cần dùng Facebook hay đăng nhập bất kỳ tài khoản nào. Tên nick và UID trong dữ liệu là dữ liệu giả.
- Ngôn ngữ: JavaScript (Node.js 20 trở lên) cho Bài 1 và 2. Bài 3 dùng Python 3.10+ hoặc JavaScript tuỳ chọn, không dùng thư viện ngoài.
- Viết code ngắn gọn, đặt tên rõ nghĩa, ghi chú bằng tiếng Việt ở chỗ quyết định quan trọng. Người chấm sẽ đọc code của bạn, nên code dễ đọc được tính điểm.

Bối cảnh: công ty có một extension Chrome tự đăng bài lên trang cá nhân Facebook theo lịch, cho nhiều nick cùng lúc (mỗi nick một Chrome profile riêng). Tool đang xếp lịch cách đều đúng 3 phút. Nhịp đăng quá đều và quá dày dễ khiến nick bị Facebook hạn chế. Ba bài dưới đây mô phỏng ba việc bạn sẽ gặp khi cải thiện tool này.

## Cấu trúc nộp bài

```
bai-lam/
  MAU-NOP-BAI.md              (điền theo mẫu, xem file đính kèm)
  bai1/plan-schedule.mjs
  bai1/plan-schedule.test.mjs
  bai2/bai2-fixed.js
  bai3/phan-tich.py  (hoặc phan-tich.mjs)
  bai3/bao-cao.json
```

---

## Bài 1 — Viết bộ xếp lịch đăng bài an toàn

File `bai1/plan-schedule.mjs` phải `export function planSchedule(posts, nicks, opts)` (đúng tên, export có tên). Node 20, không thư viện ngoài. Hàm không được đọc giờ hiện tại của máy: mọi thời điểm đều dựa vào `opts.start`.

Đầu vào:
- `posts`: mảng `{ id, nickId }`. Thứ tự các bài của một nick là thứ tự phải đăng.
- `nicks`: mảng `{ id, dailyCap? }`. `dailyCap` là số bài tối đa mỗi ngày của nick đó. Không có thì lấy từ `opts`.
- `opts`: `{ start (ms), seed, minGapMs = 180000, jitter = 0.3, hardMinGapMs = 60000, quietStartH = 0, quietEndH = 6, tzOffsetH = 7, dailyCap = 20, globalGapMs = 5000 }`.

Đầu ra: mảng `{ postId, nickId, dueAt }`, `dueAt` là chuỗi ISO.

Ràng buộc (người chấm kiểm tra từng cái bằng bộ kiểm tra tự động):
1. Hai bài liên tiếp của cùng một nick cách nhau khoảng `minGapMs` với độ lệch ngẫu nhiên ±`jitter` (jitter 0,3 nghĩa là 70% đến 130%), và không bao giờ nhỏ hơn `hardMinGapMs`.
2. Không bài nào rơi vào khung nghỉ (từ `quietStartH` đến `quietEndH`, múi giờ `tzOffsetH`). Bài rơi vào khung nghỉ phải dời sang sau khi khung nghỉ kết thúc, cộng thêm độ lệch ngẫu nhiên nhỏ. Các bài sau dời theo.
3. Mỗi nick không đăng quá `dailyCap` bài trong một ngày lịch (theo múi giờ trên). Hết trần thì dồn sang ngày kế tiếp, sau khung nghỉ.
4. Hai bài bất kỳ, kể cả của hai nick khác nhau, chênh nhau ít nhất `globalGapMs`.
5. Giữ nguyên thứ tự bài trong từng nick.
6. Cùng `seed` thì cùng kết quả; khác `seed` thì kết quả khác. Dữ liệu sai (ví dụ `start` không hợp lệ) phải ném lỗi rõ ràng. Danh sách bài rỗng trả mảng rỗng.

Nộp thêm `bai1/plan-schedule.test.mjs`: test do bạn tự viết, chạy được bằng `node bai1/plan-schedule.test.mjs` hoặc `node --test`, phải bắt được ít nhất 4 trong 6 ràng buộc.

---

## Bài 2 — Rà soát lỗi luồng đăng bài

Mở file `bai2-publish-flow.js` (đoạn rút gọn của luồng đăng một bài, có lỗi cố ý, không cần chạy được). Tool phải tuân theo:
- Không bao giờ đăng lại một bài đã bấm Đăng. Nếu không chắc bài đã lên hay chưa thì chuyển sang trạng thái "cần đối soát", không đưa lại vào hàng chờ.
- Không đăng riêng caption khi thiếu ảnh hoặc video.
- Chỉ đăng khi xác định đúng nick.
- Giữa hai thao tác trên Facebook của cùng một profile phải cách nhau tối thiểu 60 giây.

Yêu cầu:
1. Điền bảng lỗi vào `MAU-NOP-BAI.md` (mỗi lỗi một dòng, đánh số L1, L2...; ít nhất 5 lỗi). Mỗi dòng gồm: số dòng trong file, kịch bản cụ thể làm lỗi xảy ra (ví dụ "Chrome sập đúng sau lệnh X thì..."), hậu quả, mức độ (Cao / Trung bình / Thấp), cách sửa trong một câu.
2. Nộp `bai2/bai2-fixed.js`: hàm `runJob` đã sửa. Mỗi chỗ sửa phải có ghi chú `// SỬA L1`, `// SỬA L2`... trùng với số lỗi trong bảng. Nếu thêm hàm hỗ trợ (ví dụ khoá, hàm cập nhật một bản ghi) thì có ghi chú giải thích.
3. Trong `MAU-NOP-BAI.md`, mô tả 3 trường hợp kiểm thử sẽ viết để chứng minh bản sửa đúng (mô tả bằng lời, không bắt buộc viết code).

---

## Bài 3 — Phân tích log vận hành và đề xuất cải tiến

Mở `bai3-log-mau.csv`: log mô phỏng 5 nick trong ngày 20 và 21/11/2026. Cột: Nick, UID, Mã bài, Trạng thái, Giờ bấm Đăng, Giờ hẹn, Số ảnh, Số video, Lỗi gần nhất, Link bài. Giờ ghi dạng `HH:MM:SS DD/MM/YYYY`. Dòng chưa bấm Đăng có giờ bấm Đăng để trống.

Yêu cầu:
1. Viết script `bai3/phan-tich.py` (hoặc `.mjs`), chạy bằng một lệnh, đọc file CSV và ghi ra `bai3/bao-cao.json` đúng cấu trúc sau (tên khoá và kiểu dữ liệu phải đúng):

```json
{
  "per_nick": [
    {"nick": "Nick-01", "tong": 0, "da_dang": 0, "loi": 0, "cho_link": 0, "cho_dang": 0, "ti_le_thanh_cong": 0.0}
  ],
  "nhom_loi": [
    {"nguyen_nhan": "nội dung cột Lỗi gần nhất", "so_lan": 0, "nicks": ["Nick-01"]}
  ],
  "can_doi_soat": ["Mã bài của các dòng ở trạng thái Đã bấm Đăng, chờ link"],
  "trung_ma": ["Mã bài xuất hiện từ 2 dòng trở lên có Giờ bấm Đăng khác rỗng"],
  "vi_pham_gian_cach": {"Nick-xx": 0},
  "dang_ban_dem": {"Nick-xx": 0}
}
```

Quy ước: `da_dang` là số dòng trạng thái "Đã đăng (có link)"; `loi` là "Lỗi, chưa đăng"; `cho_link` là "Đã bấm Đăng, chờ link"; `cho_dang` là "Chờ đăng"; `tong` là tổng số dòng của nick; `ti_le_thanh_cong` = `da_dang` / `tong`, làm tròn 4 chữ số. `vi_pham_gian_cach`: số cặp bài liên tiếp (xếp theo Giờ bấm Đăng, chỉ tính dòng có giờ bấm) của cùng một nick cách nhau dưới 60 giây. `dang_ban_dem`: số bài bấm Đăng trong khung 0–6 giờ. Hai mục cuối chỉ liệt kê nick có số lớn hơn 0.

2. Trong `MAU-NOP-BAI.md`, viết kết luận tối đa nửa trang theo mẫu: vấn đề đáng lo nhất và vì sao; tối đa 5 việc làm trong 1 tuần tới xếp theo thứ tự ưu tiên; việc KHÔNG nên làm vội và lý do; dữ liệu còn thiếu gì để kết luận chắc chắn hơn.
