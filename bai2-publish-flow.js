// bai2-publish-flow.js
// Đoạn rút gọn mô phỏng luồng đăng một bài của FB Desk. ĐÃ CÓ LỖI CỐ Ý. Không cần chạy được.
// db() đọc TOÀN BỘ dữ liệu, write(d) ghi lại TOÀN BỘ dữ liệu vào chrome.storage.local.
import { db, write } from './store.js';

const ACTION_GAP = 60000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runJob(jobId, tab) {
  const d = await db();
  const job = d.bot.jobs.find((j) => j.id === jobId);
  job.state = 'running';
  await write(d);

  // 1. Giãn cách tối thiểu giữa hai thao tác trên Facebook
  const last = (await chrome.storage.local.get('deskLastInteraction')).deskLastInteraction || 0;
  if (Date.now() - last < ACTION_GAP) {
    await sleep(ACTION_GAP - (Date.now() - last));
  }

  // 2. Kiểm tra đúng nick đang đăng nhập
  const uid = await tab.readCookie('c_user');
  if (uid && uid !== job.actorUid) throw new Error('Sai nick');

  try {
    // 3. Mở hộp soạn, điền chữ, tải media
    await tab.openComposer();
    await tab.fillText(job.post.text);
    let uploaded = 0;
    for (const m of job.post.media) {
      try {
        await tab.upload(m);
        uploaded++;
      } catch (e) {
        console.warn('Tải media lỗi', e);
      }
    }
    if (uploaded < job.post.media.length) {
      console.warn('Thiếu media, vẫn tiếp tục');
    }

    // 4. Bấm Đăng rồi ghi nhận
    await tab.clickPost();
    await chrome.storage.local.set({ deskLastInteraction: Date.now() });
    const d2 = await db();
    const j2 = d2.bot.jobs.find((j) => j.id === jobId);
    j2.submittedAt = new Date().toISOString();
    j2.state = 'verifying';
    await write(d2);

    // 5. Tìm link bài vừa đăng (có thể mất vài chục giây)
    j2.postUrl = await tab.findPublishedLink(job.post.text);
    j2.state = 'success';
    await write(d2);
  } catch (e) {
    const d3 = await db();
    const j3 = d3.bot.jobs.find((j) => j.id === jobId);
    j3.state = 'queued';
    j3.error = String(e.message);
    j3.dueAt = new Date(Date.now() + 90000).toISOString();
    await write(d3);
  }
}
