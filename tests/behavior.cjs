/**
 * 行為測試：直接載入 js/app.js 與 Code.gs，呼叫真正的函式驗證結果。
 *
 * 與 smoke.cjs 的差異：
 *  - smoke.cjs 多數斷言是比對原始碼字串，適合防守「有沒有這段程式碼」。
 *  - 本檔直接執行函式，驗證「程式碼跑起來對不對」，不受改名或搬位影響。
 */
const { loadApp, loadBackend } = require('./helpers/loader.js');

const results = [];
function check(name, test) {
  try {
    test();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** 建立一份最小可用的排課資料集。 */
function makeData(overrides = {}) {
  return Object.assign({
    classes: [{ '班級代碼': '701', '年級': '7', '是否虛擬班': 'FALSE' }],
    teachers: [{ '教師姓名': 'T01' }, { '教師姓名': 'T02' }],
    subjects: [{ '科目代碼': '國文', '每週節數': '3' }, { '科目代碼': '數學', '每週節數': '3' }],
    assignments: [
      { '班級代碼': '701', '科目代碼': '國文', '教師姓名': 'T01' },
      { '班級代碼': '701', '科目代碼': '數學', '教師姓名': 'T02' }
    ],
    schedule: [],
    teacherBlocks: [],
    subjectRules: [],
    rooms: [],
    teacherExclusives: []
  }, overrides);
}

function scheduleRow(overrides = {}) {
  return Object.assign({
    '課表ID': 'X1',
    '班級代碼': '701',
    '星期': '1',
    '節次': '1',
    '科目代碼': '國文',
    '教師姓名': 'T01',
    '課堂屬性': '一般',
    '是否鎖定': 'FALSE'
  }, overrides);
}

// ============================================================
// 凍結與清除判定
// ============================================================

check('已鎖定的課程視為凍結且不可清除', () => {
  const ctx = loadApp();
  assert(ctx.isClearFrozenScheduleEntry({ '是否鎖定': 'TRUE', '節次': '3' }) === true,
    '鎖定課程應視為凍結');
  assert(ctx.isClearFrozenScheduleEntry({ '是否鎖定': 'FALSE', '節次': '3' }) === false,
    '未鎖定的一般課程不應視為凍結');
});

check('第八節單週課程需使用專屬清除判定', () => {
  const ctx = loadApp();
  const periodEightSingle = { '節次': '8', '課堂屬性': '單週', '是否鎖定': 'FALSE' };
  assert(ctx.isClearablePeriodEightScheduleEntry(periodEightSingle) === true,
    '第八節單週課程應可依指定週次單格清除');
  assert(ctx.isClearFrozenScheduleEntry(periodEightSingle) === false,
    '第八節單週課程不應被一般凍結判定擋下，否則永遠清不掉');
});

// ============================================================
// 單雙週數值處理
// ============================================================

check('單雙週 0.5 節數值可正確解析與格式化', () => {
  const ctx = loadApp();
  assert(ctx.parseWeeklyValue('0.5') === 0.5, '0.5 應解析為單雙週');
  assert(ctx.parseWeeklyValue('1') === 1, '整數節數解析錯誤');
  assert(ctx.parseWeeklyValue('') === 0, '空值應回傳備援值 0');
  assert(ctx.isAlternateWeeklyValue('0.5') === true, '0.5 應判定為單雙週');
  assert(ctx.isAlternateWeeklyValue('2') === false, '整數不應判定為單雙週');
  assert(ctx.formatWeeklyValue(0.5) === '0.5', '0.5 格式化錯誤');
  assert(ctx.formatWeeklyValue(3) === '3', '整數格式化錯誤');
});

check('非法的每週節數輸入被拒絕', () => {
  const ctx = loadApp();
  assert(ctx.isValidWeeklyInput('0.5') === true, '0.5 應為合法');
  assert(ctx.isValidWeeklyInput('3') === true, '整數應為合法');
  assert(ctx.isValidWeeklyInput('abc') === false, '非數字應被拒絕');
  assert(ctx.isValidWeeklyInput('', false) === false, '關閉容許空白時空值應被拒絕');
  assert(ctx.isValidWeeklyInput('', true) === true, '開啟容許空白時空值應通過');
});

// ============================================================
// 巡堂與課輔辨識
// ============================================================

check('巡堂與課輔課程可正確辨識', () => {
  const ctx = loadApp();
  assert(ctx.isPatrolScheduleEntry({ '課堂屬性': '巡堂', '教師姓名': 'T01' }) === true,
    '巡堂課程應被辨識');
  assert(ctx.isPatrolScheduleEntry({ '課堂屬性': '一般', '教師姓名': 'T01' }) === false,
    '一般課程不應被當成巡堂');
  assert(ctx.isHelperSubjectCode('國文輔') === true, '課輔科目應被辨識');
  assert(ctx.isHelperSubjectCode('國文') === false, '一般科目不應被當成課輔');
});

check('課堂屬性與節次讀取容許數字或字串', () => {
  const ctx = loadApp();
  assert(ctx.schedulePeriodValue({ '節次': '8' }) === 8, '字串節次應轉為數字');
  assert(ctx.schedulePeriodValue({ '節次': 8 }) === 8, '數字節次應原樣回傳');
});

// ============================================================
// 後端驗證：真實衝突偵測
// ============================================================

check('同一時段的教師衝堂會被驗證攔下', () => {
  const backend = loadBackend();
  const rows = [
    scheduleRow({ '課表ID': 'A', '教師姓名': 'T01', '科目代碼': '國文' }),
    scheduleRow({ '課表ID': 'B', '教師姓名': 'T01', '科目代碼': '數學' })
  ];
  const result = backend.validateScheduleSnapshot_(rows, makeData({ schedule: rows }));
  const messages = (result.errors || []).concat((result.violations || []));
  assert(messages.some(text => String(text).includes('教師衝堂')),
    '應偵測到教師衝堂，實際：' + JSON.stringify(messages));
  assert(messages.some(text => String(text).includes('班級衝堂')),
    '應偵測到班級衝堂，實際：' + JSON.stringify(messages));
});

check('教師不排課時段會被驗證攔下', () => {
  const backend = loadBackend();
  // 時段 '1-2' 代表星期一第 2 節不排課，故課程必須排在第 2 節才會觸發
  const rows = [scheduleRow({ '課表ID': 'A', '星期': '1', '節次': '2', '教師姓名': 'T01' })];
  const data = makeData({
    schedule: rows,
    teacherBlocks: [{ '教師姓名': 'T01', '時段': '1-2' }]
  });
  const result = backend.validateScheduleSnapshot_(rows, data);
  const messages = (result.errors || []).concat((result.violations || []));
  assert(messages.some(text => String(text).includes('教師不排課')),
    '應偵測到教師不排課違規，實際：' + JSON.stringify(messages));
});

check('軟性限制可依 allowManualConstraintWarnings 開關切換', () => {
  // 後端語義：開關關閉（預設）時軟限制是硬錯誤，會阻擋；
  // 開關開啟時代表人工手動排課容忍軟限制，不回報也不阻擋。
  const backend = loadBackend();
  const rows = [scheduleRow({ '課表ID': 'A', '星期': '1', '節次': '2', '教師姓名': 'T01' })];
  const blocks = [{ '教師姓名': 'T01', '時段': '1-2' }];

  const strict = backend.validateScheduleSnapshot_(rows, makeData({ schedule: rows, teacherBlocks: blocks }));
  const strictMessages = (strict.errors || []).concat((strict.violations || []));
  assert(strict.ok === false, '未開啟開關時軟限制違規應阻擋寫入');
  assert(strictMessages.some(text => String(text).includes('教師不排課')),
    '未開啟開關時應回報教師不排課：' + JSON.stringify(strictMessages));

  const lenientData = makeData({ schedule: rows, teacherBlocks: blocks });
  lenientData.allowManualConstraintWarnings = true;
  const lenient = backend.validateScheduleSnapshot_(rows, lenientData);
  const lenientMessages = (lenient.errors || []).concat((lenient.violations || []));
  assert(lenient.ok === true, '開啟開關後軟限制違規應被容忍');
  assert(!lenientMessages.some(text => String(text).includes('教師不排課')),
    '開啟開關後不應回報教師不排課：' + JSON.stringify(lenientMessages));
});

check('沒有衝突的課表驗證通過', () => {
  const backend = loadBackend();
  const rows = [
    scheduleRow({ '課表ID': 'A', '星期': '1', '節次': '1', '教師姓名': 'T01', '科目代碼': '國文' }),
    scheduleRow({ '課表ID': 'B', '星期': '1', '節次': '2', '教師姓名': 'T02', '科目代碼': '數學' })
  ];
  const result = backend.validateScheduleSnapshot_(rows, makeData({ schedule: rows }));
  assert(result.ok === true, '無衝突的課表應驗證通過，實際：' + JSON.stringify(result));
  const messages = (result.errors || []).concat((result.violations || []));
  assert(messages.length === 0, '不應回報任何違規，實際：' + JSON.stringify(messages));
});

check('科目禁排時段的課程會被驗證攔下', () => {
  const backend = loadBackend();
  const rows = [scheduleRow({ '課表ID': 'A', '星期': '1', '節次': '1' })];
  const data = makeData({
    schedule: rows,
    subjectRules: [{
      '規則ID': 'R1',
      '科目代碼': '國文',
      '適用年級': '全校',
      '規則類型': '禁排',
      '時段': '星期一1'
    }]
  });
  const result = backend.validateScheduleSnapshot_(rows, data);
  const messages = (result.errors || []).concat((result.violations || []));
  assert(messages.some(text => String(text).includes('禁排')),
    '應偵測到科目禁排違規，實際：' + JSON.stringify(messages));
});

check('教師不排課索引與線性掃描結果一致', () => {
  const backend = loadBackend();
  const teacherBlocks = [
    { '教師姓名': 'T01', '時段': '1-2,3-4' },
    { '教師姓名': 'T02', '時段': '5-6' }
  ];
  // 索引命中：T01 在星期一第 2 節（時段 1-2）應被判為不排課
  const blocked = [
    scheduleRow({ '課表ID': 'A', '星期': '1', '節次': '2', '教師姓名': 'T01' })
  ];
  const blockedResult = backend.validateScheduleSnapshot_(blocked,
    makeData({ schedule: blocked, teacherBlocks }));
  const blockedMessages = (blockedResult.errors || []).concat((blockedResult.violations || []));
  assert(blockedMessages.some(text => String(text).includes('教師不排課')),
    '索引應判定 T01 星期一第 2 節為不排課');

  // 索引未命中：T01 在星期五第 1 節不應被擋
  const allowed = [
    scheduleRow({ '課表ID': 'B', '星期': '5', '節次': '1', '教師姓名': 'T01' })
  ];
  const allowedResult = backend.validateScheduleSnapshot_(allowed,
    makeData({ schedule: allowed, teacherBlocks }));
  const allowedMessages = (allowedResult.errors || []).concat((allowedResult.violations || []));
  assert(!allowedMessages.some(text => String(text).includes('教師不排課')),
    '索引不應誤判未排課的時段：' + JSON.stringify(allowedMessages));
});

// ============================================================
// 載入器自身健全性
// ============================================================

check('載入器能解析關鍵前端函式', () => {
  const ctx = loadApp();
  const required = ['detectConflicts', 'buildIndex', 'optimisticClearCell', 'renderStatsTab',
    'executeAutoScheduleCore', 'checkHandAdjustConflicts', 'parseWeeklyValue'];
  const missing = required.filter(name => typeof ctx[name] !== 'function');
  assert(missing.length === 0, '以下函式應可從沙箱取得：' + missing.join(', '));
});

check('載入器能解析關鍵後端函式', () => {
  const backend = loadBackend();
  const required = ['validateScheduleSnapshot_', 'checkConflicts_', 'sheetToObjects_', 'scheduleRevision_'];
  const missing = required.filter(name => typeof backend[name] !== 'function');
  assert(missing.length === 0, '以下後端函式應可取得：' + missing.join(', '));
});

for (const result of results) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.error ? `: ${result.error}` : ''}`);
}
if (results.some(result => !result.ok)) process.exitCode = 1;