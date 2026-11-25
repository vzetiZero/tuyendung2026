// bai1/plan-schedule.test.mjs
// Test tự viết cho planSchedule. Chạy: node --test bai1/plan-schedule.test.mjs
// Mỗi test cô lập một ràng buộc để ràng buộc này không che lỗi của ràng buộc khác.

import test from 'node:test';
import assert from 'node:assert/strict';
import { planSchedule } from './plan-schedule.mjs';

const MS_MIN = 60_000;
const MS_H = 3_600_000;
const MS_D = 86_400_000;
const TZ = 7;

// Mốc ms ứng với giờ địa phương (offset +7) cho trước, để test không phụ thuộc máy chạy.
function startAtLocal(year, month, day, hour) {
  return Date.UTC(year, month - 1, day, hour - TZ, 0, 0);
}

function localHour(iso) {
  const m = (Date.parse(iso) + TZ * MS_H) % MS_D;
  return (m < 0 ? m + MS_D : m) / MS_H;
}

function localDay(iso) {
  return Math.floor((Date.parse(iso) + TZ * MS_H) / MS_D);
}

const baseOpts = {
  start: startAtLocal(2026, 11, 20, 7),
  seed: 'seed-A',
  minGapMs: 180_000,
  jitter: 0.3,
  hardMinGapMs: 60_000,
  quietStartH: 0,
  quietEndH: 6,
  tzOffsetH: TZ,
  dailyCap: 20,
  globalGapMs: 5_000,
};

const makePosts = (nickId, count) =>
  Array.from({ length: count }, (_, i) => ({
    id: `${nickId}-p${String(i + 1).padStart(2, '0')}`,
    nickId,
  }));

test('RB1: giãn cách cùng nick trong dải 70%-130% và không dưới hardMinGapMs', () => {
  const posts = makePosts('N1', 8);
  // Một nick, tắt globalGap để chỉ đo đúng ràng buộc giãn cách.
  const opts = { ...baseOpts, globalGapMs: 0 };
  const plan = planSchedule(posts, [{ id: 'N1' }], opts);

  assert.equal(plan.length, posts.length);
  for (let i = 1; i < plan.length; i++) {
    const gap = Date.parse(plan[i].dueAt) - Date.parse(plan[i - 1].dueAt);
    assert.ok(gap >= 60_000, `gap ${gap} nhỏ hơn hardMinGapMs`);
    assert.ok(gap >= 126_000, `gap ${gap} nhỏ hơn 70% minGapMs`);
    assert.ok(gap <= 234_000, `gap ${gap} vượt 130% minGapMs`);
  }
});

test('RB2: không bài nào rơi vào khung nghỉ, kể cả khi vắt qua nửa đêm', () => {
  const posts = makePosts('N1', 30);
  const opts = {
    ...baseOpts,
    start: startAtLocal(2026, 11, 20, 23),
    dailyCap: 50,
    globalGapMs: 0,
  };
  const plan = planSchedule(posts, [{ id: 'N1' }], opts);

  assert.equal(plan.length, posts.length);
  for (const item of plan) {
    const hour = localHour(item.dueAt);
    assert.ok(hour >= 6 && hour < 24, `bài ${item.postId} rơi vào giờ nghỉ: ${hour}h`);
  }
  // Bài dời ra sau khung nghỉ phải nằm ở ngày kế tiếp, không quay lại giờ nghỉ.
  assert.ok(Date.parse(plan.at(-1).dueAt) > Date.parse(plan[0].dueAt));
});

test('RB3: mỗi nick không vượt trần bài trong một ngày lịch địa phương', () => {
  const posts = makePosts('N1', 7);
  const opts = { ...baseOpts, dailyCap: 2, globalGapMs: 0 };
  const plan = planSchedule(posts, [{ id: 'N1' }], opts);

  const perDay = new Map();
  for (const item of plan) {
    const day = localDay(item.dueAt);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  for (const [day, count] of perDay) {
    assert.ok(count <= 2, `ngày ${day} có ${count} bài, vượt trần 2`);
  }
  assert.equal(plan.length, 7);
});

test('RB3: dailyCap riêng của nick được ưu tiên hơn opts.dailyCap', () => {
  const posts = [...makePosts('N1', 4), ...makePosts('N2', 4)];
  const opts = { ...baseOpts, dailyCap: 10, globalGapMs: 0 };
  const plan = planSchedule(posts, [{ id: 'N1', dailyCap: 1 }, { id: 'N2' }], opts);

  const countN1 = new Map();
  for (const item of plan.filter((p) => p.nickId === 'N1')) {
    const day = localDay(item.dueAt);
    countN1.set(day, (countN1.get(day) ?? 0) + 1);
  }
  for (const [day, count] of countN1) {
    assert.ok(count <= 1, `N1 ngày ${day} có ${count} bài, vượt dailyCap riêng 1`);
  }
});

test('RB4: hai bài bất kỳ cách nhau ít nhất globalGapMs', () => {
  const nicks = ['N1', 'N2', 'N3', 'N4'];
  const posts = nicks.flatMap((id) => makePosts(id, 3));
  const opts = { ...baseOpts, globalGapMs: 5_000 };
  const plan = planSchedule(posts, nicks.map((id) => ({ id })), opts);

  const times = plan.map((p) => Date.parse(p.dueAt)).sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) {
    assert.ok(times[i] - times[i - 1] >= 5_000, `hai bài chỉ cách ${times[i] - times[i - 1]}ms`);
  }
});

test('RB5: giữ nguyên thứ tự bài trong từng nick', () => {
  const nicks = ['N1', 'N2'];
  const posts = nicks.flatMap((id) => makePosts(id, 6));
  const plan = planSchedule(posts, nicks.map((id) => ({ id })), baseOpts);

  for (const id of nicks) {
    const got = plan.filter((p) => p.nickId === id).map((p) => p.postId);
    const want = posts.filter((p) => p.nickId === id).map((p) => p.id);
    assert.deepEqual(got, want);
  }
});

test('RB1+RB3: nick bị dời vì trần ngày không kéo lịch nick khác', () => {
  // A bị dồn sang nhiều ngày (dailyCap 1); B còn dư trần nên phải đăng gọn trong ngày 0.
  // Ca này bắt lỗi "gán ngay rồi đẩy globalLast tới mốc bị dời" từng làm B trễ 3 ngày.
  const posts = [...makePosts('A', 4), ...makePosts('B', 10)];
  const plan = planSchedule(posts, [{ id: 'A', dailyCap: 1 }, { id: 'B', dailyCap: 20 }], {
    ...baseOpts,
    seed: 'contam',
  });

  const bTimes = plan.filter((p) => p.nickId === 'B').map((p) => Date.parse(p.dueAt));
  const firstDay = localDay(plan[0].dueAt);
  assert.ok(
    bTimes.every((t) => localDay(new Date(t).toISOString()) === firstDay),
    'B còn trần nhưng bị đẩy sang ngày khác',
  );
  for (let i = 1; i < bTimes.length; i++) {
    const gap = bTimes[i] - bTimes[i - 1];
    assert.ok(gap <= 234_000, `gap B ${gap}ms vượt 130% minGapMs`);
  }
});

test('RB6: cùng seed cho cùng kết quả, khác seed cho kết quả khác', () => {
  const posts = makePosts('N1', 6);
  const nicks = [{ id: 'N1' }];
  const a = planSchedule(posts, nicks, { ...baseOpts, seed: 'alpha' });
  const b = planSchedule(posts, nicks, { ...baseOpts, seed: 'alpha' });
  const c = planSchedule(posts, nicks, { ...baseOpts, seed: 'beta' });

  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('RB6: dữ liệu sai ném lỗi rõ ràng, danh sách rỗng trả mảng rỗng', () => {
  const posts = makePosts('N1', 2);
  const nicks = [{ id: 'N1' }];

  assert.throws(() => planSchedule(posts, nicks, { ...baseOpts, start: Number.NaN }), /start/);
  assert.throws(() => planSchedule(posts, nicks, { ...baseOpts, start: undefined }), /start/);
  assert.throws(() => planSchedule(posts, [], baseOpts), /nickId/);
  assert.throws(() => planSchedule(posts, nicks, { ...baseOpts, jitter: 2 }), /jitter/);
  // null là giá trị sai kiểu, không được lặng lẽ thay bằng mặc định.
  assert.throws(() => planSchedule(posts, nicks, { ...baseOpts, jitter: null }), /jitter/);
  assert.throws(() => planSchedule(posts, nicks, { ...baseOpts, dailyCap: null }), /dailyCap/);
  assert.deepEqual(planSchedule([], [], baseOpts), []);
});
