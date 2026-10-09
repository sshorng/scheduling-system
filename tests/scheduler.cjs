/**
 * 排程器端到端測試：用 previewOnly 模式執行真正的 executeAutoScheduleCore，
 * 驗證輸出課表的正確性。完全不修改 js/app.js，純粹鎖住行為。
 *
 * 目的：4,263 行的排程核心是全專案風險最高的程式碼。這些測試確保
 * 未來任何重構（拆分、改名、抽模組）都不會悄悄改變排課結果。
 */
const vm = require('vm');
const { loadApp } = require('./helpers/loader.js');

const results = [];
function check(name, test) {
  return Promise.resolve()
    .then(test)
    .then(() => results.push({ name, ok: true }))
    .catch(error => results.push({ name, ok: false, error: error.message }));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** 在沙箱內部設定 state（頂層 let 無法從外部直接賦值）。 */
function seedState(ctx, setup) {
  const lines = [];
  if (setup.classes) lines.push(`state.classes=${JSON.stringify(setup.classes)};`);
  if (setup.subjects) lines.push(`state.subjects=${JSON.stringify(setup.subjects)};`);
  if (setup.teachers) lines.push(`state.teachers=${JSON.stringify(setup.teachers)};`);
  if (setup.assignments) lines.push(`state.assignments=${JSON.stringify(setup.assignments)};`);
  if (setup.schedule) lines.push(`state.schedule=${JSON.stringify(setup.schedule)};`);
  if (setup.blockGroups) lines.push(`state.blockGroups=${JSON.stringify(setup.blockGroups)};`);
  if (setup.teacherBlocks) lines.push(`state.teacherBlocks=${JSON.stringify(setup.teacherBlocks)};`);
  if (setup.subjectRules) lines.push(`state.subjectRules=${JSON.stringify(setup.subjectRules)};`);
  if (setup.rooms) lines.push(`state.rooms=${JSON.stringify(setup.rooms)};`);
  lines.push('if (typeof buildIndex === "function") buildIndex();');
  vm.runInContext(lines.join('\n'), ctx);
}

function runScheduler(ctx, options = {}) {
  const opts = Object.assign(
    { previewOnly: true, seed: 42, randomize: false, timeBudgetMs: 15000, skipPreflight: true },
    options
  );
  const code = `executeAutoScheduleCore(${JSON.stringify(opts)})`;
  return vm.runInContext(code, ctx);
}

/** 最小資料集：1 班、2 科、2 師，每科每週 2 節。 */
function tinyDataset() {
  return {
    classes: [{ '班級代碼': '701', '年級': '7', '班級名稱': '七年一班' }],
    subjects: [
      { '科目代碼': '國文', '科目名稱': '國文', '每週節數': '2' },
      { '科目代碼': '數學', '科目名稱': '數學', '每週節數': '2' }
    ],
    teachers: [{ '教師姓名': 'T01' }, { '教師姓名': 'T02' }],
    assignments: [
      { '配課ID': 'A1', '班級代碼': '701', '科目代碼': '國文', '教師姓名': 'T01', '每週節數': '2' },
      { '配課ID': 'A2', '班級代碼': '701', '科目代碼': '數學', '教師姓名': 'T02', '每週節數': '2' }
    ],
    schedule: [],
    blockGroups: [],
    teacherBlocks: [],
    subjectRules: [],
    rooms: []
  };
}

/** 檢查輸出課表沒有班級衝堂與教師衝堂。 */
function assertNoClash(schedule) {
  const classSlots = new Map();
  const teacherSlots = new Map();
  for (const entry of schedule) {
    const day = String(entry['星期']);
    const period = String(entry['節次']);
    const attr = String(entry['課堂屬性'] || '一般');
    const weekKey = period === '8' && (attr === '單週' || attr === '雙週') ? '|' + attr : '';
    const classKey = entry['班級代碼'] + '|' + day + '|' + period + weekKey;
    if (classSlots.has(classKey)) {
      throw new Error('班級衝堂：' + classKey);
    }
    classSlots.set(classKey, entry);
    const teachers = String(entry['教師姓名'] || '').split(/[,，、]/).map(s => s.trim()).filter(Boolean);
    for (const tc of teachers) {
      const teacherKey = tc + '|' + day + '|' + period + weekKey;
      if (teacherSlots.has(teacherKey)) {
        throw new Error('教師衝堂：' + teacherKey);
      }
      teacherSlots.set(teacherKey, entry);
    }
  }
}

async function main() {
  await check('最小資料集可完整排入且無衝堂', async () => {
    const ctx = loadApp();
    seedState(ctx, tinyDataset());
    const result = await runScheduler(ctx);
    assert(result && Array.isArray(result.schedule), '應回傳 schedule 陣列');
    assert(result.schedule.length === 4, '2 科 × 每週 2 節應排入 4 列，實際：' + result.schedule.length);
    assertNoClash(result.schedule);
    // 成功路徑不帶 frozenViolations 鍵（只有凍結檢查失敗的早退路徑才有），undefined 視為無違規
    const frozen = result.frozenViolations || [];
    assert(frozen.length === 0, '不應有凍結違規：' + JSON.stringify(frozen));
  });

  await check('相同種子產生相同結果（確定性）', async () => {
    const runOnce = async () => {
      const ctx = loadApp();
      seedState(ctx, tinyDataset());
      const result = await runScheduler(ctx, { seed: 7 });
      return result.schedule
        .map(e => [e['班級代碼'], e['星期'], e['節次'], e['科目代碼'], e['教師姓名']].join('|'))
        .sort()
        .join(';');
    };
    const first = await runOnce();
    const second = await runOnce();
    assert(first === second, '相同種子應產生相同課表');
    assert(first.length > 0, '課表不應為空');
  });

  await check('配課教師正確指派到輸出課表', async () => {
    const ctx = loadApp();
    seedState(ctx, tinyDataset());
    const result = await runScheduler(ctx);
    const bySubject = new Map();
    for (const entry of result.schedule) {
      const key = String(entry['科目代碼']);
      if (!bySubject.has(key)) bySubject.set(key, new Set());
      String(entry['教師姓名'] || '').split(/[,，、]/).forEach(t => bySubject.get(key).add(t.trim()));
    }
    assert(bySubject.get('國文') && bySubject.get('國文').has('T01'),
      '國文應由 T01 任教，實際：' + JSON.stringify([...(bySubject.get('國文') || [])]));
    assert(bySubject.get('數學') && bySubject.get('數學').has('T02'),
      '數學應由 T02 任教，實際：' + JSON.stringify([...(bySubject.get('數學') || [])]));
  });

  await check('既有鎖定課程在排程後仍保留', async () => {
    const ctx = loadApp();
    const data = tinyDataset();
    data.schedule = [{
      '課表ID': 'LOCK1', '班級代碼': '701', '星期': '1', '節次': '1',
      '科目代碼': '國文', '教師姓名': 'T01', '課堂屬性': '一般', '是否鎖定': 'TRUE'
    }];
    seedState(ctx, data);
    const result = await runScheduler(ctx);
    const locked = result.schedule.find(e => String(e['課表ID']) === 'LOCK1');
    assert(locked, '鎖定課程不應在排程後消失');
    assert(String(locked['星期']) === '1' && String(locked['節次']) === '1',
      '鎖定課程不應被移動，實際：週' + locked['星期'] + '第' + locked['節次'] + '節');
  });

  await check('教師不排課時段不會被排入', async () => {
    const ctx = loadApp();
    const data = tinyDataset();
    // T01 星期一第 1 至第 7 節全部不排課，國文只能排到其他天
    data.teacherBlocks = [{ '教師姓名': 'T01', '時段': '1-1,1-2,1-3,1-4,1-5,1-6,1-7' }];
    seedState(ctx, data);
    const result = await runScheduler(ctx);
    const violations = result.schedule.filter(e =>
      String(e['教師姓名']).includes('T01') &&
      String(e['星期']) === '1' &&
      ['1', '2', '3', '4', '5', '6', '7'].includes(String(e['節次']))
    );
    assert(violations.length === 0,
      'T01 不應出現在星期一第 1 至第 7 節：' + JSON.stringify(violations));
  });

  for (const result of results) {
    console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.error ? `: ${result.error}` : ''}`);
  }
  if (results.some(result => !result.ok)) process.exitCode = 1;
}

main().catch(e => {
  console.log('FAIL  scheduler harness: ' + e.message);
  process.exitCode = 1;
});
