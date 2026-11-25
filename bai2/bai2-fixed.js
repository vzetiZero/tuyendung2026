// bai2/bai2-fixed.js
// Bản sửa của bai2-publish-flow.js. Mỗi chỗ sửa có ghi chú // SỬA Lx trùng với
// bảng lỗi ở mục C của MAU-NOP-BAI.md.
//
// Nguyên tắc chung: mọi bất định xảy ra SAU khi đã bấm Đăng đều đẩy job sang
// 'needs_reconcile' (cần đối soát), không bao giờ đưa lại 'queued'. Chỉ những lỗi
// xảy ra TRƯỚC mốc bấm Đăng mới được phép chạy lại.
//
// Ghi chú về import: giữ nguyên như file gốc. Trong tool thật, file này nằm cạnh
// store.js nên giữ './store.js'.

import { db, write } from './store.js';

const DEFAULT_ACTION_GAP = 60000;
const DEFAULT_LEASE_MS = 120000;
const MAX_ATTEMPTS = 3;

// Cấu hình thời gian. Mặc định đúng yêu cầu đề (60 giây / 120 giây). Chỉ test
// được phép rút ngắn để chạy nhanh; xem __configureForTests() ở cuối file.
const timing = { actionGapMs: DEFAULT_ACTION_GAP, leaseMs: DEFAULT_LEASE_MS };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Trạng thái được phép bắt đầu một lượt chạy. Job đã qua mốc bấm Đăng thì không
// bao giờ được nằm trong danh sách này. // SỬA L7
const RUNNABLE_STATES = new Set(['queued']);

// Các trạng thái cho biết bài đã (có thể) được gửi lên Facebook. // SỬA L2
const SUBMITTED_STATES = new Set(['submitting', 'verifying', 'success', 'needs_reconcile']);

// ---------------------------------------------------------------------------
// Hàm hỗ trợ: cập nhật MỘT bản ghi job, không ghi đè cả DB từ ảnh chụp cũ.
// db() và write() đều là async nên giữa chúng có điểm nhường (await), vì vậy phải
// xếp hàng các lần đọc–ghi để hai job không chồng lên nhau. // SỬA L5
// ---------------------------------------------------------------------------
let writeChain = Promise.resolve();

function patchJob(jobId, patch) {
  const run = async () => {
    const d = await db();
    const job = d.bot.jobs.find((j) => j.id === jobId);
    if (!job) throw new Error(`Job ${jobId} không tồn tại`);
    Object.assign(job, patch);
    await write(d);
    return job;
  };
  // Nối vào cuối hàng đợi; dù một lần ghi lỗi thì hàng đợi vẫn chạy tiếp.
  const next = writeChain.then(run, run);
  writeChain = next.catch(() => {});
  return next;
}

// ---------------------------------------------------------------------------
// Hàm hỗ trợ: khoá theo profile. Hai job của cùng một profile không được chạy
// chồng nhau, nếu không cả hai sẽ đọc cùng mốc tương tác cũ và cùng lọt.
// Dùng lease có hạn để Chrome sập không giữ khoá vĩnh viễn. // SỬA L6
// (Với hệ nhiều máy, khoá này phải chuyển về backend; ở đây đủ cho 1 profile/1 máy.)
// ---------------------------------------------------------------------------
async function withProfileLock(profileKey, fn) {
  const lockKey = `deskLock:${profileKey}`;
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + 30000;

  for (;;) {
    const held = (await chrome.storage.local.get(lockKey))[lockKey];
    if (!held || held.expiresAt < Date.now()) {
      await chrome.storage.local.set({ [lockKey]: { token, expiresAt: Date.now() + timing.leaseMs } });
      const check = (await chrome.storage.local.get(lockKey))[lockKey];
      if (check && check.token === token) break;
    }
    if (Date.now() > deadline) throw new Error(`Không lấy được khoá profile ${profileKey}`);
    await sleep(500);
  }

  try {
    return await fn();
  } finally {
    const held = (await chrome.storage.local.get(lockKey))[lockKey];
    if (held && held.token === token) await chrome.storage.local.remove(lockKey);
  }
}

// ---------------------------------------------------------------------------
// Hàm hỗ trợ: đặt lịch một thao tác Facebook sao cho cách thao tác trước của
// CÙNG profile ít nhất actionGapMs (mặc định 60 giây). Mốc được ghi TRƯỚC khi
// thao tác chạy: nếu Chrome sập giữa chừng, lượt sau vẫn phải chờ đủ 60 giây
// thay vì tưởng như chưa có thao tác nào. // SỬA L6
// ---------------------------------------------------------------------------
async function fbAction(profileKey, fn) {
  const key = `deskLastInteraction:${profileKey}`;
  const last = (await chrome.storage.local.get(key))[key] || 0;
  const wait = last + timing.actionGapMs - Date.now();
  if (wait > 0) await sleep(wait);
  await chrome.storage.local.set({ [key]: Date.now() });
  return fn();
}

// ---------------------------------------------------------------------------
// Hàm hỗ trợ: kiểm tra bài có đủ media để đăng hay không. // SỬA L3
// Quy ước: job.post.media là mảng media bắt buộc; nếu bài được khai báo cần media
// mà mảng rỗng thì cũng là thiếu media, không được đăng caption trơ.
// ---------------------------------------------------------------------------
function hasRequiredMedia(post) {
  const media = Array.isArray(post.media) ? post.media : [];
  if (media.length > 0) return true;
  return post.requiresMedia !== true;
}

export async function runJob(jobId, tab) {
  // --- Bước 0: kiểm tra job trước khi làm bất cứ điều gì -------------------
  const initial = await db();
  const job = initial.bot.jobs.find((j) => j.id === jobId);
  if (!job) throw new Error(`Job ${jobId} không tồn tại`); // SỬA L7
  if (!RUNNABLE_STATES.has(job.state)) {
    // Đã bấm Đăng/đã đăng/đang đối soát: không chạy lại, trả về luôn.
    return { skipped: true, state: job.state };
  }
  if ((job.attempt || 0) >= MAX_ATTEMPTS) {
    await patchJob(jobId, { state: 'needs_reconcile', error: 'Vượt số lần thử' }); // SỬA L7
    return { skipped: true, state: 'needs_reconcile' };
  }

  const profileKey = job.actorUid || job.profileId || 'unknown';

  // Mọi bước kiểm tra trạng thái phải nằm TRONG khoá profile: hai lượt dispatch
  // cùng lúc sẽ xếp hàng, lượt sau đọc thấy trạng thái đã đổi và bỏ qua. // SỬA L4
  return withProfileLock(profileKey, async () => {
    const locked = await db();
    const lockedJob = locked.bot.jobs.find((j) => j.id === jobId);
    if (!lockedJob) throw new Error(`Job ${jobId} không tồn tại`);
    if (!RUNNABLE_STATES.has(lockedJob.state)) {
      return { skipped: true, state: lockedJob.state };
    }
    if ((lockedJob.attempt || 0) >= MAX_ATTEMPTS) {
      await patchJob(jobId, { state: 'needs_reconcile', error: 'Vượt số lần thử' }); // SỬA L7
      return { skipped: true, state: 'needs_reconcile' };
    }

    await patchJob(jobId, {
      state: 'running',
      attempt: (lockedJob.attempt || 0) + 1,
      startedAt: new Date().toISOString(),
    });

    // Dùng bản ghi đã đọc trong khoá, không dùng snapshot cũ phía trên.
    const job = lockedJob;

    // Đánh dấu đã bấm là biến "một chiều": một khi đã ghi, mọi lỗi phía sau đều
    // phải sang đối soát, không được quay lại hàng chờ.
    let clicked = false;

    try {
      // --- Bước 1: xác định đúng nick (fail-closed) ------------------------
      // Thiếu cookie thì coi như không xác định được nick. // SỬA L4
      const uid = await tab.readCookie('c_user');
      if (!uid) throw new Error('Không xác định được nick đang đăng nhập');
      if (String(uid) !== String(job.actorUid)) throw new Error('Sai nick');

      // --- Bước 2: media phải đủ trước khi mở hộp soạn -------------------
      if (!hasRequiredMedia(job.post)) throw new Error('Thiếu media, không đăng caption'); // SỬA L3

      // --- Bước 3: soạn bài, mỗi thao tác cách nhau >= ACTION_GAP --------
      await fbAction(profileKey, () => tab.openComposer());
      await fbAction(profileKey, () => tab.fillText(job.post.text));

      for (const m of job.post.media || []) {
        try {
          await fbAction(profileKey, () => tab.upload(m));
        } catch (e) {
          // Không bỏ qua lỗi upload nữa: thiếu media là lý do huỷ job. // SỬA L3
          throw new Error(`Tải media lỗi, huỷ đăng: ${e.message}`);
        }
      }

      // --- Bước 4: ghi mốc 'submitting' TRƯỚC khi bấm ---------------------
      // Đây là điểm sửa quan trọng nhất: nếu Chrome sập ngay sau clickPost(),
      // DB đã có submittedAt nên lần chạy sau biết bài có thể đã lên. // SỬA L1
      await patchJob(jobId, { state: 'submitting', submittedAt: new Date().toISOString() });

      await fbAction(profileKey, () => tab.clickPost());
      clicked = true;

      await patchJob(jobId, { state: 'verifying' });

      // --- Bước 5: lấy link bài. Đây cũng là thao tác trên Facebook nên phải
      // giãn cách như các thao tác khác. Mỗi lần ghi đều đọc lại DB ngay trước
      // khi ghi nên chờ lâu không làm mất cập nhật của job khác. // SỬA L5
      const postUrl = await fbAction(profileKey, () => tab.findPublishedLink(job.post.text));
      if (!postUrl) throw new Error('Không tìm thấy link bài sau khi đăng');

      await patchJob(jobId, { state: 'success', postUrl, error: null });
      return { ok: true, postUrl };
    } catch (e) {
      const submitted = clicked || (await isSubmitted(jobId));

      // Đã bấm Đăng (hoặc DB đã qua mốc submitting) => tuyệt đối không requeue.
      // // SỬA L2
      await patchJob(jobId, {
        state: submitted ? 'needs_reconcile' : 'queued',
        error: String(e.message),
        ...(submitted ? {} : { dueAt: new Date(Date.now() + 90000).toISOString() }),
      });

      if (submitted) return { ok: false, state: 'needs_reconcile', error: String(e.message) };
      throw e;
    }
  });
}

// Đọc lại DB để biết job đã vượt mốc bấm Đăng hay chưa (dùng khi lỗi xảy ra
// trước khi kịp gán biến clicked trong bộ nhớ). // SỬA L2
async function isSubmitted(jobId) {
  const d = await db();
  const job = d.bot.jobs.find((j) => j.id === jobId);
  if (!job) return true;
  return SUBMITTED_STATES.has(job.state) || Boolean(job.submittedAt);
}

// Chỉ dùng cho test: rút ngắn thời gian chờ để bộ test không mất vài phút.
// Production luôn chạy với mặc định 60000/120000 vì test không được gọi hàm này.
export function __configureForTests({ actionGapMs, leaseMs } = {}) {
  if (actionGapMs !== undefined) timing.actionGapMs = actionGapMs;
  if (leaseMs !== undefined) timing.leaseMs = leaseMs;
}

export const __timing = timing;
