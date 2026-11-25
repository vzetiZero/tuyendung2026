// bai2/bai2-fixed.test.mjs
// Kiểm thử hành vi cho runJob trong bai2-fixed.js.
// Chạy: node --test bai2/bai2-fixed.test.mjs
//
// Cách làm: bai2-fixed.js import './store.js' (đúng như tool thật). Để test không
// cần Chrome và không ghi vào dữ liệu thật, ta copy file sang thư mục tạm cùng một
// store.js giả lập (db/write trong bộ nhớ). Nhờ vậy file nộp giữ nguyên import và
// không bị thêm file lạ vào thư mục bai2/.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SRC = join(HERE, 'bai2-fixed.js');

const MOCK_STORE = `
export const state = { data: null, writeCount: 0, failWriteAt: -1, dbDelayMs: 0, inFlightWrites: 0, overlappedWrites: 0 };
export async function db() {
  if (state.data === null) throw new Error('store chưa được seed');
  // Độ trễ tuỳ chọn để ép hai lần đọc–ghi chồng lên nhau trong test L5.
  if (state.dbDelayMs > 0) await new Promise((r) => setTimeout(r, state.dbDelayMs));
  return structuredClone(state.data);
}
export async function write(d) {
  state.inFlightWrites += 1;
  if (state.inFlightWrites > 1) state.overlappedWrites += 1;
  try {
    await new Promise((r) => setTimeout(r, 5));
    state.writeCount += 1;
    if (state.writeCount === state.failWriteAt) throw new Error('SIMULATED_CRASH');
    state.data = structuredClone(d);
  } finally {
    state.inFlightWrites -= 1;
  }
}
`;

// Mỗi lần chạy test dùng một thư mục tạm riêng, nạp module bản sao + mock store.
async function loadSubject() {
  const dir = await mkdtemp(join(tmpdir(), 'bai2-test-'));
  await copyFile(SRC, join(dir, 'bai2-fixed.js'));
  await writeFile(join(dir, 'store.js'), MOCK_STORE, 'utf8');
  const mod = await import(new URL(`file://${join(dir, 'bai2-fixed.js').replace(/\\/g, '/')}`));
  const store = await import(new URL(`file://${join(dir, 'store.js').replace(/\\/g, '/')}`));
  return { mod, store, dir };
}

// chrome.storage.local giả lập, đủ cho các hàm hỗ trợ của runJob.
function installChrome() {
  const map = new Map();
  globalThis.chrome = {
    storage: {
      local: {
        async get(k) {
          return map.has(k) ? { [k]: map.get(k) } : {};
        },
        async set(obj) {
          for (const [k, v] of Object.entries(obj)) map.set(k, v);
        },
        async remove(k) {
          map.delete(k);
        },
      },
    },
  };
  return map;
}

const UID = '100000000000001';

function makeJob(id, over = {}) {
  return {
    id,
    state: 'queued',
    actorUid: UID,
    attempt: 0,
    post: { text: 'xin chao', media: [{ url: 'a.jpg' }] },
    ...over,
  };
}

// tab giả: ghi lại mọi thao tác Facebook để kiểm tra thứ tự và giãn cách.
function makeTab(over = {}) {
  const calls = [];
  const record = (name, impl) => async (...args) => {
    calls.push({ name, at: Date.now() });
    return impl ? impl(...args) : undefined;
  };
  return {
    calls,
    readCookie: async () => {
      calls.push({ name: 'readCookie', at: Date.now(), local: true });
      return 'uid' in over ? over.uid : UID;
    },
    openComposer: record('openComposer', over.openComposer),
    fillText: record('fillText', over.fillText),
    upload: record('upload', over.upload),
    clickPost: record('clickPost', over.clickPost),
    findPublishedLink: record('findPublishedLink', over.findPublishedLink),
  };
}

const fbCalls = (tab) => tab.calls.filter((c) => !c.local);

async function setup({ jobs, actionGapMs = 5, leaseMs = 500 } = {}) {
  installChrome();
  const { mod, store, dir } = await loadSubject();
  mod.__configureForTests({ actionGapMs, leaseMs });
  store.state.data = { bot: { jobs } };
  store.state.writeCount = 0;
  store.state.failWriteAt = -1;
  return { runJob: mod.runJob, store, dir };
}

test('L1: sập ngay sau khi bấm Đăng thì chạy lại không bấm lần hai', async (t) => {
  const { runJob, store, dir } = await setup({ jobs: [makeJob('J1')] });
  t.after(() => rm(dir, { recursive: true, force: true }));

  const tab = makeTab();
  const originalClick = tab.clickPost;
  // Cho lần ghi NGAY SAU clickPost hỏng: mô phỏng Chrome sập trước khi lưu 'verifying'.
  tab.clickPost = async () => {
    store.state.failWriteAt = store.state.writeCount + 1;
    return originalClick();
  };

  await runJob('J1', tab).catch(() => {});
  const afterCrash = structuredClone(store.state.data.bot.jobs[0]);
  assert.ok(afterCrash.submittedAt, 'phải ghi submittedAt TRƯỚC khi bấm để lần sau biết bài có thể đã lên');

  store.state.failWriteAt = -1;
  const tab2 = makeTab();
  await runJob('J1', tab2).catch(() => {});

  assert.equal(fbCalls(tab).filter((c) => c.name === 'clickPost').length, 1);
  assert.equal(fbCalls(tab2).filter((c) => c.name === 'clickPost').length, 0);
  assert.notEqual(store.state.data.bot.jobs[0].state, 'queued');
});

test('L2: đã bấm nhưng không lấy được link thì sang needs_reconcile, không requeue', async (t) => {
  const { runJob, store, dir } = await setup({ jobs: [makeJob('J1')] });
  t.after(() => rm(dir, { recursive: true, force: true }));

  const tab = makeTab({ findPublishedLink: () => '' });
  await runJob('J1', tab).catch(() => {});

  const job = store.state.data.bot.jobs[0];
  assert.equal(fbCalls(tab).filter((c) => c.name === 'clickPost').length, 1);
  assert.equal(job.state, 'needs_reconcile');
  assert.equal(job.dueAt, undefined, 'không được đặt lịch chạy lại');
});

test('L3: thiếu media thì không bấm Đăng, chỉ được chạy lại khi chưa bấm', async (t) => {
  const { runJob, store, dir } = await setup({
    jobs: [makeJob('J1', { post: { text: 'x', media: [{ u: 1 }, { u: 2 }] } })],
  });
  t.after(() => rm(dir, { recursive: true, force: true }));

  let uploads = 0;
  const tab = makeTab({
    upload: () => {
      uploads += 1;
      if (uploads === 2) throw new Error('Media Bridge down');
    },
  });

  await runJob('J1', tab).catch(() => {});

  assert.equal(fbCalls(tab).filter((c) => c.name === 'clickPost').length, 0);
  assert.equal(store.state.data.bot.jobs[0].state, 'queued', 'chưa bấm nên được phép chạy lại');
});

test('L3: bài khai báo cần media nhưng mảng rỗng thì cũng không đăng caption trơ', async (t) => {
  const { runJob, store, dir } = await setup({
    jobs: [makeJob('J1', { post: { text: 'caption', media: [], requiresMedia: true } })],
  });
  t.after(() => rm(dir, { recursive: true, force: true }));

  const tab = makeTab();
  await runJob('J1', tab).catch(() => {});

  assert.equal(fbCalls(tab).filter((c) => c.name === 'openComposer').length, 0);
  assert.equal(fbCalls(tab).filter((c) => c.name === 'clickPost').length, 0);
});

test('L4: không xác định được nick thì không thao tác gì và không kẹt running', async (t) => {
  const { runJob, store, dir } = await setup({ jobs: [makeJob('J1')] });
  t.after(() => rm(dir, { recursive: true, force: true }));

  const tab = makeTab({ uid: '' });
  await runJob('J1', tab).catch(() => {});

  assert.equal(fbCalls(tab).length, 0, 'không được có thao tác Facebook nào');
  assert.notEqual(store.state.data.bot.jobs[0].state, 'running');
});

test('L4: UID khác job.actorUid thì dừng trước khi thao tác', async (t) => {
  const { runJob, store, dir } = await setup({ jobs: [makeJob('J1')] });
  t.after(() => rm(dir, { recursive: true, force: true }));

  const tab = makeTab({ uid: '999' });
  await runJob('J1', tab).catch(() => {});

  assert.equal(fbCalls(tab).length, 0);
  assert.notEqual(store.state.data.bot.jobs[0].state, 'running');
});

test('L5: không có hai lệnh ghi DB chồng nhau (không lost update)', async (t) => {
  // Khác profile nên không bị khoá L6 tuần tự hoá. Nếu mỗi lần cập nhật đọc DB rồi
  // ghi đè mà không xếp hàng, hai lệnh ghi sẽ chồng nhau và lượt sau nuốt thay đổi
  // của lượt trước — đúng lỗi lost update của bản gốc.
  const jobs = [makeJob('J1', { actorUid: 'A' }), makeJob('J2', { actorUid: 'B' })];
  const { runJob, store, dir } = await setup({ jobs, actionGapMs: 1 });
  t.after(() => rm(dir, { recursive: true, force: true }));

  // Nới rộng khoảng đọc–ghi để hai job chắc chắn đan xen nhau.
  store.state.dbDelayMs = 15;

  await Promise.allSettled([
    runJob('J1', makeTab({ uid: 'A', findPublishedLink: () => 'https://x/1' })),
    runJob('J2', makeTab({ uid: 'B', findPublishedLink: () => 'https://x/2' })),
  ]);

  // Ghi chồng nhau là nguyên nhân gốc của lost update.
  assert.equal(store.state.overlappedWrites, 0, 'không được có hai lệnh ghi DB chồng nhau');

  const j1 = store.state.data.bot.jobs.find((j) => j.id === 'J1');
  const j2 = store.state.data.bot.jobs.find((j) => j.id === 'J2');
  assert.equal(j1.state, 'success');
  assert.equal(j2.state, 'success');
  assert.equal(j1.postUrl, 'https://x/1');
  assert.equal(j2.postUrl, 'https://x/2');
});

test('L6: hai job cùng profile chạy tuần tự, mọi thao tác cách nhau >= 60s (rút ngắn khi test)', async (t) => {
  const GAP = 60;
  const { runJob, store, dir } = await setup({ jobs: [makeJob('J1'), makeJob('J2')], actionGapMs: GAP });
  t.after(() => rm(dir, { recursive: true, force: true }));

  const tab = makeTab();
  await Promise.allSettled([runJob('J1', tab), runJob('J2', tab)]);

  const seq = fbCalls(tab);
  assert.equal(seq.filter((c) => c.name === 'clickPost').length, 2, 'hai job khác nhau đều phải đăng');
  for (let i = 1; i < seq.length; i++) {
    assert.ok(seq[i].at - seq[i - 1].at >= GAP - 2, `thao tác ${seq[i].name} chỉ cách ${seq[i].at - seq[i - 1].at}ms`);
  }
});

test('L7: dispatch trùng cùng một job chỉ bấm Đăng một lần', async (t) => {
  const { runJob, store, dir } = await setup({ jobs: [makeJob('J1')] });
  t.after(() => rm(dir, { recursive: true, force: true }));

  const tab = makeTab();
  await Promise.allSettled([runJob('J1', tab), runJob('J1', tab)]);

  assert.equal(fbCalls(tab).filter((c) => c.name === 'clickPost').length, 1);
});

test('L7: job đã success gọi lại thì bỏ qua, không thao tác', async (t) => {
  const { runJob, store, dir } = await setup({ jobs: [makeJob('J1', { state: 'success' })] });
  t.after(() => rm(dir, { recursive: true, force: true }));

  const tab = makeTab();
  const result = await runJob('J1', tab);

  assert.equal(result.skipped, true);
  assert.equal(tab.calls.length, 0);
});

test('L7: vượt số lần thử thì sang đối soát thay vì lặp vô hạn', async (t) => {
  const { runJob, store, dir } = await setup({ jobs: [makeJob('J1', { attempt: 3 })] });
  t.after(() => rm(dir, { recursive: true, force: true }));

  const tab = makeTab();
  await runJob('J1', tab);

  assert.equal(store.state.data.bot.jobs[0].state, 'needs_reconcile');
  assert.equal(tab.calls.length, 0);
});

test('L7: job không tồn tại thì báo lỗi rõ ràng', async (t) => {
  const { runJob, dir } = await setup({ jobs: [] });
  t.after(() => rm(dir, { recursive: true, force: true }));

  await assert.rejects(() => runJob('NOPE', makeTab()), /tồn tại/);
});

test('mặc định production vẫn là 60000ms', async (t) => {
  installChrome();
  const { mod, store, dir } = await loadSubject();
  t.after(() => rm(dir, { recursive: true, force: true }));
  store.state.data = { bot: { jobs: [] } };

  assert.equal(mod.__timing.actionGapMs, 60000);
  assert.equal(mod.__timing.leaseMs, 120000);
});
