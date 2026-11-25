// bai1/plan-schedule.mjs
// Bộ xếp lịch đăng bài an toàn cho nhiều nick (Node 20, ESM, không thư viện ngoài).
//
// Ý tưởng: mỗi nick là một hàng đợi giữ đúng thứ tự bài đầu vào. Một min-heap toàn
// cục luôn trả về ứng viên sớm nhất, nhờ vậy giữ được thứ tự trong từng nick mà vẫn
// áp được ràng buộc giãn cách toàn cục. Hàm thuần: không đọc giờ hệ thống, mọi mốc
// thời gian suy ra từ opts.start nên kết quả tất định và test được.

const MS_MIN = 60_000;
const MS_H = 3_600_000;
const MS_D = 86_400_000;

const DEFAULTS = {
  minGapMs: 180_000,
  jitter: 0.3,
  hardMinGapMs: 60_000,
  quietStartH: 0,
  quietEndH: 6,
  tzOffsetH: 7,
  dailyCap: 20,
  globalGapMs: 5_000,
};

function fail(message) {
  throw new TypeError(`planSchedule: ${message}`);
}

function readNumber(opts, key) {
  // Chỉ coi undefined là "không truyền" để dùng mặc định. null là dữ liệu sai kiểu
  // (ví dụ cấu hình ghi jitter: null) nên phải rơi vào nhánh ném lỗi bên dưới.
  const raw = opts[key];
  const value = raw === undefined ? DEFAULTS[key] : raw;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`opts.${key} phải là số hữu hạn`);
  }
  return value;
}

function normalizeOptions(opts) {
  if (!opts || typeof opts !== 'object') fail('opts là bắt buộc');
  if (typeof opts.start !== 'number' || !Number.isFinite(opts.start)) {
    fail('opts.start phải là số mili-giây hữu hạn');
  }
  // Đề liệt kê seed không kèm mặc định. Tôi để mặc định '' để hàm vẫn chạy khi thiếu
  // (kết quả khi đó tất định), thay vì biến một trường thiếu thành lỗi chặn toàn bộ.
  // Test luôn truyền seed để kiểm tra tính tái lập.

  const minGapMs = readNumber(opts, 'minGapMs');
  const hardMinGapMs = readNumber(opts, 'hardMinGapMs');
  const jitter = readNumber(opts, 'jitter');
  const quietStartH = readNumber(opts, 'quietStartH');
  const quietEndH = readNumber(opts, 'quietEndH');
  const tzOffsetH = readNumber(opts, 'tzOffsetH');
  const dailyCap = readNumber(opts, 'dailyCap');
  const globalGapMs = readNumber(opts, 'globalGapMs');

  if (minGapMs <= 0) fail('opts.minGapMs phải lớn hơn 0');
  if (hardMinGapMs <= 0) fail('opts.hardMinGapMs phải lớn hơn 0');
  if (jitter < 0 || jitter > 1) fail('opts.jitter phải nằm trong [0, 1]');
  if (quietStartH < 0 || quietStartH > 24) fail('opts.quietStartH phải nằm trong [0, 24]');
  if (quietEndH < 0 || quietEndH > 24) fail('opts.quietEndH phải nằm trong [0, 24]');
  if (tzOffsetH < -14 || tzOffsetH > 14) fail('opts.tzOffsetH phải nằm trong [-14, 14]');
  if (!Number.isInteger(dailyCap) || dailyCap < 1) fail('opts.dailyCap phải là số nguyên >= 1');
  if (globalGapMs < 0) fail('opts.globalGapMs phải >= 0');
  // Khung nghỉ phủ trọn 24 giờ thì không còn chỗ nào để đăng: chặn sớm thay vì lặp vô hạn.
  if (quietStartH === 0 && quietEndH === 24) fail('khung nghỉ không được phủ trọn 24 giờ');

  return {
    start: opts.start,
    seed: String(opts.seed),
    minGapMs,
    hardMinGapMs,
    jitter,
    quietStartH,
    quietEndH,
    tzOffsetH,
    dailyCap,
    globalGapMs,
  };
}

function indexNicks(nicks, opts) {
  if (!Array.isArray(nicks)) fail('nicks phải là mảng');
  const caps = new Map();
  nicks.forEach((nick, i) => {
    if (!nick || typeof nick !== 'object') fail(`nicks[${i}] không hợp lệ`);
    if (typeof nick.id !== 'string' || nick.id === '') fail(`nicks[${i}].id phải là chuỗi khác rỗng`);
    if (caps.has(nick.id)) fail(`nicks có id trùng: ${nick.id}`);

    let cap = opts.dailyCap;
    if (nick.dailyCap !== undefined) {
      if (!Number.isInteger(nick.dailyCap) || nick.dailyCap < 1) {
        fail(`nicks[${i}].dailyCap phải là số nguyên >= 1`);
      }
      cap = nick.dailyCap;
    }
    caps.set(nick.id, cap);
  });
  return caps;
}

function buildQueues(posts, caps) {
  if (!Array.isArray(posts)) fail('posts phải là mảng');
  const queues = new Map();
  const seen = new Set();
  posts.forEach((post, i) => {
    if (!post || typeof post !== 'object') fail(`posts[${i}] không hợp lệ`);
    if (typeof post.id !== 'string' || post.id === '') fail(`posts[${i}].id phải là chuỗi khác rỗng`);
    if (seen.has(post.id)) fail(`posts có id trùng: ${post.id}`);
    seen.add(post.id);
    if (typeof post.nickId !== 'string' || !caps.has(post.nickId)) {
      fail(`posts[${i}].nickId không có trong danh sách nicks: ${post.nickId}`);
    }
    // Thứ tự push giữ nguyên thứ tự đăng của từng nick.
    if (!queues.has(post.nickId)) queues.set(post.nickId, []);
    queues.get(post.nickId).push(post.id);
  });
  return queues;
}

// FNV-1a + mulberry32: PRNG nhỏ, tất định. Mỗi nick có chuỗi ngẫu nhiên riêng khoá
// theo (seed, nickId) nên thêm/bớt nick không làm xáo trộn lịch của nick khác.
function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(state) {
  return function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function jitterRng(seed, nickId) {
  return mulberry32(fnv1a(`${seed}:${nickId}`));
}

// Giãn cách mục tiêu: minGapMs * [1-jitter, 1+jitter), luôn bị chặn dưới bởi hardMinGapMs.
function sampleGap(rng, minGapMs, jitter, hardMinGapMs) {
  const factor = 1 - jitter + 2 * jitter * rng();
  return Math.max(hardMinGapMs, Math.round(minGapMs * factor));
}

// Độ trễ ngẫu nhiên nhỏ khi phải dời bài ra sau khung nghỉ / sang ngày kế.
function quietDelay(rng) {
  return Math.round(rng() * 2 * MS_MIN);
}

// Múi giờ dùng offset cố định của đề, không dựa vào timezone của máy chạy.
const toLocalMs = (t, offsetH) => t + offsetH * MS_H;
const dayIndex = (t, offsetH) => Math.floor(toLocalMs(t, offsetH) / MS_D);

function hourOf(t, offsetH) {
  const m = toLocalMs(t, offsetH) % MS_D;
  return (m < 0 ? m + MS_D : m) / MS_H;
}

// Hỗ trợ cả khung nghỉ vắt qua nửa đêm (quietStartH > quietEndH).
function inQuiet(hour, startH, endH) {
  if (startH === endH) return false;
  return startH < endH ? hour >= startH && hour < endH : hour >= startH || hour < endH;
}

// Mốc quietEnd gần nhất nằm sau t (tính theo ngày lịch địa phương).
function afterQuiet(t, endH, offsetH, extraMs) {
  const day = dayIndex(t, offsetH);
  let candidate = day * MS_D + endH * MS_H - offsetH * MS_H;
  if (candidate <= t) candidate += MS_D;
  return candidate + extraMs;
}

// Mốc quietEnd của ngày kế tiếp so với t.
function nextDayQuietEnd(t, endH, offsetH, extraMs) {
  const day = dayIndex(t, offsetH);
  return (day + 1) * MS_D + endH * MS_H - offsetH * MS_H + extraMs;
}

class MinHeap {
  constructor(compare) {
    this.items = [];
    this.compare = compare;
  }

  get size() {
    return this.items.length;
  }

  push(value) {
    const a = this.items;
    a.push(value);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.compare(a[i], a[parent]) >= 0) break;
      [a[i], a[parent]] = [a[parent], a[i]];
      i = parent;
    }
  }

  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let min = i;
        if (left < a.length && this.compare(a[left], a[min]) < 0) min = left;
        if (right < a.length && this.compare(a[right], a[min]) < 0) min = right;
        if (min === i) break;
        [a[i], a[min]] = [a[min], a[i]];
        i = min;
      }
    }
    return top;
  }
}

export function planSchedule(posts, nicks, opts) {
  const config = normalizeOptions(opts);
  const caps = indexNicks(nicks, config);
  const queues = buildQueues(posts, caps);

  if (posts.length === 0) return [];

  const byNick = new Map();
  for (const [nickId, queue] of queues) {
    byNick.set(nickId, {
      queue,
      cap: caps.get(nickId),
      rng: jitterRng(config.seed, nickId),
      dayCount: new Map(),
    });
  }

  // So sánh (thời điểm, nickId, vị trí) để kết quả không phụ thuộc thứ tự nicks.
  const heap = new MinHeap((a, b) => a.t - b.t || (a.nickId < b.nickId ? -1 : a.nickId > b.nickId ? 1 : 0) || a.k - b.k);
  for (const nickId of byNick.keys()) heap.push({ t: config.start, nickId, k: 0 });

  const result = [];
  let globalLast = null;

  while (heap.size > 0) {
    const item = heap.pop();
    const nick = byNick.get(item.nickId);

    // RB4: mọi cặp bài, kể cả khác nick, phải cách nhau ít nhất globalGapMs.
    let t = globalLast === null ? item.t : Math.max(item.t, globalLast + config.globalGapMs);

    // RB2 + RB3: nếu mốc này rơi vào giờ nghỉ hoặc ngày đã hết trần thì KHÔNG gán ngay.
    // Gán ngay rồi đặt globalLast tới mốc xa đó sẽ kéo mọi bài còn lại của các nick khác
    // ra sau (RB4 chỉ cần khoảng cách tối thiểu, không cần mọi bài nằm sau bài bị dời).
    // Vì vậy đẩy lại ứng viên vào heap với thời điểm muộn hơn để heap tự sắp lại.
    if (inQuiet(hourOf(t, config.tzOffsetH), config.quietStartH, config.quietEndH)) {
      const moved = afterQuiet(t, config.quietEndH, config.tzOffsetH, quietDelay(nick.rng));
      heap.push({ t: moved, nickId: item.nickId, k: item.k });
      continue;
    }

    const day = dayIndex(t, config.tzOffsetH);
    if ((nick.dayCount.get(day) ?? 0) >= nick.cap) {
      const moved = nextDayQuietEnd(t, config.quietEndH, config.tzOffsetH, quietDelay(nick.rng));
      heap.push({ t: moved, nickId: item.nickId, k: item.k });
      continue;
    }

    nick.dayCount.set(day, (nick.dayCount.get(day) ?? 0) + 1);
    globalLast = t;
    result.push({
      postId: nick.queue[item.k],
      nickId: item.nickId,
      dueAt: new Date(t).toISOString(),
    });

    if (item.k + 1 < nick.queue.length) {
      // RB1: giãn cách ngẫu nhiên có seed, không bao giờ dưới hardMinGapMs.
      const gap = sampleGap(nick.rng, config.minGapMs, config.jitter, config.hardMinGapMs);
      heap.push({ t: t + gap, nickId: item.nickId, k: item.k + 1 });
    }
  }

  return result;
}

export default planSchedule;
