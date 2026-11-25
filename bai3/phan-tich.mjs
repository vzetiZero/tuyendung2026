// bai3/phan-tich.mjs
// Phân tích log vận hành (bai3-log-mau.csv) và ghi báo cáo JSON (bai3/bao-cao.json).
// Chạy: node bai3/phan-tich.mjs
// Tuỳ chọn: node bai3/phan-tich.mjs <file-csv> <file-json>
//
// Chỉ dùng module có sẵn của Node (node:fs, node:path), không thư viện ngoài.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const INPUT = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, 'bai3-log-mau.csv');
const OUTPUT = process.argv[3] ? resolve(process.argv[3]) : join(HERE, 'bao-cao.json');

// Nhãn trạng thái dùng đúng chuỗi trong CSV.
const ST = {
  daDang: 'Đã đăng (có link)',
  loi: 'Lỗi, chưa đăng',
  choLink: 'Đã bấm Đăng, chờ link',
  choDang: 'Chờ đăng',
};

const GAP_TOI_THIEU_GIAY = 60;
const KHUNG_DEM = { tu: 0, den: 6 }; // 0 <= giờ < 6

// ---------------------------------------------------------------------------
// Đọc CSV: tự xử lý dấu ngoặc kép, dấu phẩy trong ô, "" escape, BOM, CRLF.
// Không dùng split(',') vì ô lỗi có thể chứa dấu phẩy.
// ---------------------------------------------------------------------------
function docCsv(text) {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];

    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else { inQuotes = false; }
      } else {
        cell += c;
      }
      continue;
    }

    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(cell); cell = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += c;
  }
  // Dòng cuối không có newline.
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }

  const header = rows.shift() || [];
  return rows
    .filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ''))
    .map((r) => {
      const o = {};
      header.forEach((h, idx) => { o[h.trim()] = (r[idx] ?? '').trim(); });
      return o;
    });
}

// "HH:MM:SS DD/MM/YYYY" -> mốc so sánh được + giờ/ngày tách riêng.
// Trả null nếu ô trống hoặc sai định dạng.
function docThoiDiem(chuoi) {
  if (!chuoi) return null;
  const m = /^(\d{2}):(\d{2}):(\d{2})\s+(\d{2})\/(\d{2})\/(\d{4})$/.exec(chuoi);
  if (!m) return null;
  const [, hh, mi, ss, dd, mm, yyyy] = m.map(Number);
  if (hh > 23 || mi > 59 || ss > 59 || mm < 1 || mm > 12) return null;
  return {
    giay: Date.UTC(yyyy, mm - 1, dd, hh, mi, ss) / 1000,
    gio: hh,
  };
}

const lamTron4 = (x) => Math.round(x * 10000) / 10000;
const theoThuTuChu = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------------------
// Tính toàn bộ chỉ số theo đúng cấu trúc yêu cầu.
// ---------------------------------------------------------------------------
function phanTich(rows) {
  const theoNick = new Map();
  const thoiDiemTheoNick = new Map();
  const nhomLoi = new Map();
  const canDoiSoat = [];       // một phần tử cho mỗi dòng chờ link
  const maDaBam = new Map();   // mã bài -> số dòng có giờ bấm
  const demDem = new Map();

  for (const r of rows) {
    const nick = r['Nick'];
    if (!nick) continue;

    const trangThai = r['Trạng thái'];
    const td = docThoiDiem(r['Giờ bấm Đăng']);
    const maBai = r['Mã bài'];

    if (!theoNick.has(nick)) {
      // Giữ đúng thứ tự khoá như mẫu: tong, da_dang, loi, cho_link, cho_dang.
      theoNick.set(nick, { nick, tong: 0, da_dang: 0, loi: 0, cho_link: 0, cho_dang: 0, ti_le_thanh_cong: 0 });
      thoiDiemTheoNick.set(nick, []);
    }
    const n = theoNick.get(nick);
    n.tong += 1;

    if (trangThai === ST.daDang) n.da_dang += 1;
    else if (trangThai === ST.loi) n.loi += 1;
    else if (trangThai === ST.choLink) n.cho_link += 1;
    else if (trangThai === ST.choDang) n.cho_dang += 1;

    if (trangThai === ST.choLink) canDoiSoat.push({ maBai, td });

    const loiGanNhat = r['Lỗi gần nhất'];
    if (loiGanNhat) {
      if (!nhomLoi.has(loiGanNhat)) nhomLoi.set(loiGanNhat, { so_lan: 0, nicks: new Set() });
      const g = nhomLoi.get(loiGanNhat);
      g.so_lan += 1;
      g.nicks.add(nick);
    }

    if (td) {
      // Chỉ dòng có giờ bấm mới tính giãn cách, trùng mã và đăng ban đêm.
      thoiDiemTheoNick.get(nick).push(td.giay);
      maDaBam.set(maBai, (maDaBam.get(maBai) ?? 0) + 1);
      if (td.gio >= KHUNG_DEM.tu && td.gio < KHUNG_DEM.den) {
        demDem.set(nick, (demDem.get(nick) ?? 0) + 1);
      }
    }
  }

  const per_nick = [...theoNick.values()]
    .sort((a, b) => theoThuTuChu(a.nick, b.nick))
    .map((n) => ({ ...n, ti_le_thanh_cong: n.tong === 0 ? 0 : lamTron4(n.da_dang / n.tong) }));

  const nhom_loi = [...nhomLoi.entries()]
    .map(([nguyen_nhan, g]) => ({
      nguyen_nhan,
      so_lan: g.so_lan,
      nicks: [...g.nicks].sort(theoThuTuChu),
    }))
    // Lỗi nhiều lần lên trước; cùng số lần thì theo nội dung cho ổn định.
    .sort((a, b) => b.so_lan - a.so_lan || theoThuTuChu(a.nguyen_nhan, b.nguyen_nhan));

  // Mỗi dòng chờ link là một mục cần đối soát, xếp theo thời điểm bấm.
  const can_doi_soat = canDoiSoat
    .sort((a, b) => (a.td?.giay ?? Infinity) - (b.td?.giay ?? Infinity) || theoThuTuChu(a.maBai, b.maBai))
    .map((x) => x.maBai);

  const trung_ma = [...maDaBam.entries()]
    .filter(([, soDong]) => soDong >= 2)
    .map(([ma]) => ma)
    .sort(theoThuTuChu);

  // Cặp liên tiếp (sau khi xếp theo giờ bấm) cách nhau dưới 60 giây.
  const vi_pham_gian_cach = {};
  for (const [nick, moc] of [...thoiDiemTheoNick.entries()].sort((a, b) => theoThuTuChu(a[0], b[0]))) {
    moc.sort((a, b) => a - b);
    let dem = 0;
    for (let i = 1; i < moc.length; i++) {
      if (moc[i] - moc[i - 1] < GAP_TOI_THIEU_GIAY) dem += 1;
    }
    if (dem > 0) vi_pham_gian_cach[nick] = dem;
  }

  const dang_ban_dem = {};
  for (const nick of [...demDem.keys()].sort(theoThuTuChu)) {
    const dem = demDem.get(nick);
    if (dem > 0) dang_ban_dem[nick] = dem;
  }

  return { per_nick, nhom_loi, can_doi_soat, trung_ma, vi_pham_gian_cach, dang_ban_dem };
}

// ---------------------------------------------------------------------------
// Chạy
// ---------------------------------------------------------------------------
const rows = docCsv(readFileSync(INPUT, 'utf8'));
const baoCao = phanTich(rows);

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, JSON.stringify(baoCao, null, 2) + '\n', 'utf8');

// In tóm tắt ra stdout để chạy một lệnh là thấy ngay kết quả chính.
const tongDong = baoCao.per_nick.reduce((s, n) => s + n.tong, 0);
console.log(`Đã đọc ${rows.length} dòng từ ${INPUT}`);
console.log(`Đã ghi ${OUTPUT}`);
console.log(`Tổng theo nick: ${tongDong} dòng | ${baoCao.per_nick.length} nick`);
for (const n of baoCao.per_nick) {
  console.log(
    `  ${n.nick}: tổng ${n.tong}, đã đăng ${n.da_dang}, lỗi ${n.loi}, ` +
      `chờ link ${n.cho_link}, chờ đăng ${n.cho_dang}, tỉ lệ ${n.ti_le_thanh_cong}`,
  );
}
console.log(`Cần đối soát: ${baoCao.can_doi_soat.length} | Mã trùng: ${baoCao.trung_ma.length}`);
console.log(`Vi phạm giãn cách: ${JSON.stringify(baoCao.vi_pham_gian_cach)}`);
console.log(`Đăng ban đêm: ${JSON.stringify(baoCao.dang_ban_dem)}`);
