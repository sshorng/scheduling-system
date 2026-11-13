/**
 * 行為測試：直接載入前端模組（js/core、js/views、js/engine）與 Code.gs，呼叫真正的函式驗證結果。
 *
 * 與 smoke.cjs 的差異：
 *  - smoke.cjs 多數斷言是比對原始碼字串，適合防守「有沒有這段程式碼」。
 *  - 本檔直接執行函式，驗證「程式碼跑起來對不對」，不受改名或搬位影響。
 */
const vm = require('vm');
const { loadApp, loadBackend, readSource, evaluate } = require('./helpers/loader.js');

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

check('教師代碼解析有快取且結果正確', () => {
  // 注意：頂層 const 不會掛到沙箱物件上，只能在沙箱內部用程式碼字串呼叫。
  const ctx = loadApp();
  const values = vm.runInContext("getAutoTeacherCodes('T01,T02')", ctx);
  assert(JSON.stringify(values) === '["T01","T02"]', '解析結果錯誤：' + JSON.stringify(values));
  const hit = vm.runInContext("getAutoTeacherCodes('T01,T02') === getAutoTeacherCodes('T01,T02')", ctx);
  assert(hit === true, '相同輸入應命中快取回傳同一參照');
  const objValues = vm.runInContext("getAutoTeacherCodes({'教師姓名':'T03'})", ctx);
  assert(JSON.stringify(objValues) === '["T03"]', '物件輸入解析錯誤：' + JSON.stringify(objValues));
});

// ============================================================
// Phase 1 回歸測試：版次失效修正、索引查詢一致與後端批次防護
// ============================================================

function createExactOneBasedSpreadsheet(initial = {}) {
  const makeSheet = (name, rows = []) => {
    const grid = rows.map(r => r.slice());
    const metrics = { readCalls: 0, writeCalls: 0, clearCalls: 0, writtenRowTotal: 0 };
    const sheet = {
      getName: () => name,
      getLastRow: () => grid.length,
      getLastColumn: () => (grid[0] ? grid[0].length : 0),
      clearContents: () => {
        metrics.clearCalls++;
        grid.length = 0;
        return sheet;
      },
      setFrozenRows: () => sheet,
      getRange: (row, col, numRows = 1, numCols = 1) => {
        const rangeObj = {
          getValue: () => String(((grid[row - 1] || [])[col - 1]) ?? ''),
          getValues: () => {
            metrics.readCalls++;
            const out = [];
            for (let r = 0; r < numRows; r++) {
              const line = [];
              for (let c = 0; c < numCols; c++) {
                line.push((grid[row - 1 + r] || [])[col - 1 + c] ?? '');
              }
              out.push(line);
            }
            return out;
          },
          getDisplayValues: () => {
            metrics.readCalls++;
            const out = [];
            for (let r = 0; r < numRows; r++) {
              const line = [];
              for (let c = 0; c < numCols; c++) {
                line.push(String((grid[row - 1 + r] || [])[col - 1 + c] ?? ''));
              }
              out.push(line);
            }
            return out;
          },
          setValue: value => {
            metrics.writeCalls++;
            metrics.writtenRowTotal += 1;
            while (grid.length < row) grid.push([]);
            grid[row - 1][col - 1] = value;
            return rangeObj;
          },
          setValues: values => {
            metrics.writeCalls++;
            metrics.writtenRowTotal += values.length;
            for (let r = 0; r < values.length; r++) {
              while (grid.length < row + r) grid.push([]);
              for (let c = 0; c < values[r].length; c++) {
                grid[row - 1 + r][col - 1 + c] = values[r][c];
              }
            }
            return rangeObj;
          },
          clearContent: () => {
            metrics.clearCalls++;
            for (let r = row + numRows - 2; r >= row - 1; r--) {
              if (r >= 1 && r < grid.length) grid.splice(r, 1);
            }
            return rangeObj;
          },
          setNumberFormat: () => rangeObj,
          setFontWeight: () => rangeObj,
          setBackground: () => rangeObj,
          createTextFinder: needle => ({
            matchEntireCell: () => ({
              findNext: () => {
                for (let r = 0; r < numRows; r++) {
                  const cell = String(((grid[row - 1 + r] || [])[col - 1]) ?? '');
                  if (cell === String(needle)) return { getRow: () => row + r };
                }
                return null;
              }
            })
          })
        };
        return rangeObj;
      },
      getDataRange: () => sheet.getRange(1, 1, Math.max(1, grid.length), Math.max(1, grid[0] ? grid[0].length : 1)),
      appendRow: row => { metrics.writeCalls++; metrics.writtenRowTotal += 1; grid.push(row.slice()); return sheet; },
      deleteRow: index => { metrics.writeCalls++; grid.splice(index - 1, 1); return sheet; },
      _grid: grid,
      _metrics: metrics
    };
    return sheet;
  };
  const sheets = new Map();
  for (const [name, rows] of Object.entries(initial)) sheets.set(name, makeSheet(name, rows));
  return {
    getId: () => 'SS_BEHAVIOR_TEST',
    getUrl: () => 'https://docs.google.com/spreadsheets/d/SS_BEHAVIOR_TEST/edit',
    getSheetByName: name => sheets.get(name) || null,
    getSheets: () => Array.from(sheets.values()),
    _sheets: sheets
  };
}

check('isPreplannedScheduleEntry 與 detectConflicts 索引快速路徑結果一致', () => {
  const ctx = loadApp();
  vm.runInContext(`
    state.classes = [{ '班級代碼': '701', '年級': '7', '班級名稱': '701', '是否虛擬班': 'FALSE' }];
    state.teachers = [{ '教師姓名': 'T01', '最大連堂節數': '2' }, { '教師姓名': 'T02', '最大連堂節數': '2' }];
    state.subjects = [
      { '科目代碼': '國文', '每週節數': '3' },
      { '科目代碼': '班會', '每週節數': '1' },
      { '科目代碼': '數輔', '每週節數': '0.5' }
    ];
    state.assignments = [
      { '配課ID': 'A1', '班級代碼': '701', '科目代碼': '班會', '教師姓名': 'T01', '課程屬性': '預排' },
      { '配課ID': 'A2', '班級代碼': '701', '科目代碼': '國文', '教師姓名': 'T01', '課程屬性': '' }
    ];
    state.subjectRules = [
      { '規則ID': 'SR1', '科目代碼': '班會', '適用年級': '7', '規則類型': '必排', '時段': '5-5' },
      { '規則ID': 'SR2', '科目代碼': '國文', '適用年級': '7', '規則類型': '禁排', '時段': '1-2' }
    ];
    state.teacherExclusives = [{ '規則ID': 'EX1', '教師A': 'T01', '教師B': 'T02', '備註': '共備' }];
    state.schedule = [
      { '課表ID': 'S1', '班級代碼': '701', '星期': 1, '節次': 1, '科目代碼': '國文', '教師姓名': 'T01', '課堂屬性': '一般' },
      { '課表ID': 'S2', '班級代碼': '701', '星期': 2, '節次': 1, '科目代碼': '國文', '教師姓名': 'T02', '課堂屬性': '一般' },
      { '課表ID': 'S3', '班級代碼': '701', '星期': 1, '節次': 8, '科目代碼': '數輔', '教師姓名': 'T01', '課堂屬性': '單週' }
    ];
    buildIndex();
  `, ctx);

  const preplannedIdx = vm.runInContext("isPreplannedScheduleEntry({ '班級代碼': '701', '科目代碼': '班會' })", ctx);
  const regularIdx = vm.runInContext("isPreplannedScheduleEntry({ '班級代碼': '701', '科目代碼': '國文' })", ctx);
  const p8Idx = JSON.stringify(vm.runInContext("getScheduleCellsAt('701', 1, 8, '單週').map(x => x['課表ID'])", ctx));
  const confIdx1 = JSON.stringify(vm.runInContext("detectConflicts(2, 1, 'T01', '班會', '701')", ctx));
  const confIdx2 = JSON.stringify(vm.runInContext("detectConflicts(1, 3, 'T01', '國文', '701')", ctx));
  const confIdxP8 = JSON.stringify(vm.runInContext("detectConflicts(1, 8, 'T01', '數輔', '701', null, null, '單週')", ctx));

  vm.runInContext('idx.__built = false;', ctx);
  const preplannedRaw = vm.runInContext("isPreplannedScheduleEntry({ '班級代碼': '701', '科目代碼': '班會' })", ctx);
  const regularRaw = vm.runInContext("isPreplannedScheduleEntry({ '班級代碼': '701', '科目代碼': '國文' })", ctx);
  const p8Raw = JSON.stringify(vm.runInContext("getScheduleCellsAt('701', 1, 8, '單週').map(x => x['課表ID'])", ctx));
  const confRaw1 = JSON.stringify(vm.runInContext("detectConflicts(2, 1, 'T01', '班會', '701')", ctx));
  const confRaw2 = JSON.stringify(vm.runInContext("detectConflicts(1, 3, 'T01', '國文', '701')", ctx));
  const confRawP8 = JSON.stringify(vm.runInContext("detectConflicts(1, 8, 'T01', '數輔', '701', null, null, '單週')", ctx));

  assert(preplannedIdx === true && preplannedIdx === preplannedRaw, '預排課程判定應一致');
  assert(regularIdx === false && regularIdx === regularRaw, '非預排課程判定應一致');
  assert(p8Idx === '["S3"]' && p8Idx === p8Raw, '第8節單週格位索引查詢應與線性一致');
  assert(confIdx1 === confRaw1 && confIdx1.includes('exclusive') && confIdx1.includes('mustPlace'),
    '互斥與必排衝突應與未索引一致：' + confIdx1 + ' vs ' + confRaw1);
  assert(confIdx2 === confRaw2 && confIdx2.includes('sameClassSubjectDay'),
    '同日同科提醒應與未索引一致');
  assert(confIdxP8 === confRawP8 && confIdxP8.includes('classPeriodEight'),
    '第8節同週衝堂應與未索引一致');
});

check('樂觀更新、鎖定與超鐘點會遞增 dataRevision，跨頁籤不呈現過期統計', () => {
  const ctx = loadApp();
  vm.runInContext(`
    var __statsRenderCount = 0;
    renderStatsTab = function() { __statsRenderCount++; };
    gasPost = async () => ({ ok: true, revision: 2 });
    state.classes = [{ '班級代碼': '701', '年級': '7', '班級名稱': '701', '是否虛擬班': 'FALSE' }];
    state.teachers = [{ '教師姓名': 'T01', '姓名': '王老師', '基本鐘點': '16', '最大連堂節數': '2' }];
    state.subjects = [{ '科目代碼': '國文', '每週節數': '3' }];
    state.assignments = [{ '配課ID': 'A1', '班級代碼': '701', '科目代碼': '國文', '教師姓名': 'T01' }];
    state.schedule = [];
    buildIndex();
  `, ctx);

  vm.runInContext("renderTabIfNeeded('stats'); renderTabIfNeeded('stats');", ctx);
  assert(vm.runInContext('__statsRenderCount', ctx) === 1, '相同 dataRevision 應跳過重複渲染');

  const rev0 = vm.runInContext('ui.dataRevision', ctx);
  vm.runInContext("optimisticUpdateCell({ classCode: '701', day: 1, period: 1, subjectCode: '國文', teacherCode: 'T01' });", ctx);
  const rev1 = vm.runInContext('ui.dataRevision', ctx);
  assert(rev1 > rev0, 'optimisticUpdateCell 後應遞增 ui.dataRevision');

  vm.runInContext("renderTabIfNeeded('stats');", ctx);
  assert(vm.runInContext('__statsRenderCount', ctx) === 2, 'dataRevision 變更後切換至統計分頁應重新渲染');

  vm.runInContext("optimisticLockCell('701', 1, 1, true);", ctx);
  const rev2 = vm.runInContext('ui.dataRevision', ctx);
  vm.runInContext("optimisticSetOvertime('701', 1, 1, 'T01', true);", ctx);
  const rev3 = vm.runInContext('ui.dataRevision', ctx);
  vm.runInContext("optimisticLockCell('701', 1, 1, false);", ctx);
  const rev4 = vm.runInContext('ui.dataRevision', ctx);
  vm.runInContext("optimisticClearCell('701', 1, 1);", ctx);
  const rev5 = vm.runInContext('ui.dataRevision', ctx);
  assert(rev2 > rev1 && rev3 > rev2 && rev4 > rev3 && rev5 > rev4,
    `所有樂觀操作應依序遞增版號 (${rev1} < ${rev2} < ${rev3} < ${rev4} < ${rev5})`);
});

check('績效監控在 __SCH_PERF__ 開啟時記錄 buildIndex 耗時', () => {
  const ctx = loadApp();
  vm.runInContext('window.__SCH_PERF__ = true; buildIndex();', ctx);
  const hasRecord = vm.runInContext("window.__getPerfReport().some(item => item.label === 'buildIndex')", ctx);
  assert(hasRecord === true, '開啟 __SCH_PERF__ 後 __getPerfReport() 應包含 buildIndex 紀錄');
});

check('renameTeacher_ 同步更新寒暑輔三張工作表', () => {
  const ss = createExactOneBasedSpreadsheet({
    '教師': [['教師姓名', '姓名', '職稱', '基本鐘點', '最大連堂節數', '任教科目', '減授原因'], ['T01', '舊師', '專任', '16', '2', '國文', '']],
    '配課': [['配課ID', '教師姓名'], ['A1', 'T01']],
    '課表': [['課表ID', '教師姓名'], ['S1', 'T01']],
    '不排課': [['記錄ID', '教師姓名', '時段', '原因'], ['B1', 'T01', '1-1', '']],
    '互斥': [['規則ID', '教師A', '教師B', '備註'], ['E1', 'T01', 'T02', '']],
    '寒暑輔-需求': [['需求ID', '教師姓名'], ['N1', 'T01']],
    '寒暑輔-停排': [['停排ID', '教師姓名'], ['SB1', 'T01']],
    '寒暑輔-課表': [['課表ID', '教師姓名'], ['SS1', 'T01']]
  });
  const backend = loadBackend({ SpreadsheetApp: { openById: () => ss } });
  const res = backend.renameTeacher_(ss, { oldKey: 'T01', data: { '教師姓名': 'T99', '姓名': '新師' } });
  assert(res.updatedRows['寒暑輔-需求'] === 1, '應更新寒暑輔-需求');
  assert(res.updatedRows['寒暑輔-停排'] === 1, '應更新寒暑輔-停排');
  assert(res.updatedRows['寒暑輔-課表'] === 1, '應更新寒暑輔-課表');
  assert(ss.getSheetByName('寒暑輔-課表')._grid[1][1] === 'T99', '寒暑輔-課表應改為新代碼');
});

check('saveTeacherBlock_ 清除多位教師時依降序刪列不誤刪後續列', () => {
  const ss = createExactOneBasedSpreadsheet({
    '不排課': [
      ['記錄ID', '教師姓名', '時段', '原因'],
      ['B1', 'T01', '1-1', 'r1'],
      ['B2', 'T02', '1-1', 'r2'],
      ['B3', 'T03', '3-3', 'keep']
    ]
  });
  const backend = loadBackend();
  backend.saveTeacherBlock_(ss, { teacherCodes: ['T01', 'T02'], pairs: ['1-1'], clear: true });
  const remaining = ss.getSheetByName('不排課')._grid.slice(1).map(row => row[1]);
  assert(JSON.stringify(remaining) === '["T03"]',
    '清除 T01 與 T02 後應僅保留 T03，實際：' + JSON.stringify(remaining));
});

const asyncPhaseChecks = [];
asyncPhaseChecks.push((async () => {
  try {
    const ctx = loadApp();
    let resolveFail;
    const failPromise = new Promise(resolve => { resolveFail = resolve; });
    vm.runInContext(`
      state.teachers = [{ '教師姓名': 'T01' }];
      state.schedule = [{ '課表ID': 'S1', '班級代碼': '701', '星期': 1, '節次': 1, '科目代碼': '國文', '教師姓名': 'T01' }];
      var _clonedCount = 0;
      const _origCloneSnapshot = cloneSnapshotSlice;
      cloneSnapshotSlice = function(val) { _clonedCount++; return _origCloneSnapshot(val); };
      var _origSchedEntry = state.schedule[0];
      var _revBeforeSync = ui.dataRevision;
      bgSync({
        actionName: '測試局部回滾',
        snapshotKeys: ['teachers'],
        applyLocal: () => { state.teachers.push({ '教師姓名': 'T02' }); },
        gasTask: () => __failPromise
      });
    `, Object.assign(ctx, { __failPromise: failPromise }));
    const revAfterApply = vm.runInContext('ui.dataRevision', ctx);
    const clonedCount = vm.runInContext('_clonedCount', ctx);
    resolveFail({ ok: false, error: '模擬寫入失敗' });
    await new Promise(resolve => setTimeout(resolve, 10));
    const revAfterRollback = vm.runInContext('ui.dataRevision', ctx);
    const lenAfterRollback = vm.runInContext('state.teachers.length', ctx);
    const sameSchedEntryAfterRollback = vm.runInContext('state.schedule[0] === _origSchedEntry', ctx);
    assert(revAfterApply > vm.runInContext('_revBeforeSync', ctx), 'bgSync applyLocal 應遞增版號');
    assert(clonedCount === 1, '局部 snapshotKeys: [teachers] 應只複製 1 個區段，實際：' + clonedCount);
    assert(revAfterRollback > revAfterApply, 'bgSync rollback 後也應遞增版號');
    assert(lenAfterRollback === 1, 'rollback 應還原 teachers');
    assert(sameSchedEntryAfterRollback === true, '局部 snapshotKeys 回滾後不應覆寫或深複製 state.schedule');
    results.push({ name: 'bgSync 局部快照與回滾版號遞增', ok: true });
  } catch (error) {
    results.push({ name: 'bgSync 局部快照與回滾版號遞增', ok: false, error: error.message });
  }
})());

// ============================================================
// Phase 2：後端快取、差異寫入、原子移動與前端 SWR／合併啟動
// ============================================================

check('moveCell_ 單格移動在衝突時保留原課，成功時原子搬移並產出正確版號', () => {
  const ss = createExactOneBasedSpreadsheet({
    '班級': [['班級代碼', '年級', '班級名稱', '是否虛擬班'], ['701', '7', '七年一班', 'FALSE'], ['702', '7', '七年二班', 'FALSE']],
    '科目': [['科目代碼', '每週節數', '同時最多班數', '最多連日', '適用年級', '適用班級', '所屬教室代碼'], ['國文', '3', '0', '3', '全校', '', ''], ['數學', '3', '0', '3', '全校', '', '']],
    '配課': [['配課ID', '班級代碼', '科目代碼', '教師姓名', '每週節數'], ['A1', '701', '國文', 'T01', '3'], ['A2', '702', '數學', 'T01', '3']],
    '課表': [
      ['課表ID', '班級代碼', '星期', '節次', '科目代碼', '教師姓名', '課堂屬性', '是否鎖定'],
      ['S1', '701', '1', '1', '國文', 'T01', '一般', 'FALSE'],
      ['S2', '702', '1', '2', '數學', 'T01', '一般', 'FALSE']
    ],
    '不排課': [['記錄ID', '教師姓名', '時段', '原因']],
    '科目規則': [['規則ID', '科目代碼', '適用年級', '適用班級', '時段', '規則類型', '備註']],
    '互斥': [['規則ID', '教師A', '教師B', '備註']],
    '綁班': [['群組ID', '群組名稱', '科目清單', '班級清單']]
  });
  const backend = loadBackend();
  const blockedRes = backend.moveCell_(ss, {
    srcClassCode: '701', srcDay: 1, srcPeriod: 1,
    dstClassCode: '701', dstDay: 1, dstPeriod: 2
  });
  assert(blockedRes.blocked === true, '目標時段教師衝突時應阻擋移動');
  assert(ss.getSheetByName('課表')._grid.length === 3 && ss.getSheetByName('課表')._grid[1][2] === '1' && ss.getSheetByName('課表')._grid[1][3] === '1',
    '移動被阻擋時絕不可刪除來源課堂');

  const okRes = backend.moveCell_(ss, {
    srcClassCode: '701', srcDay: 1, srcPeriod: 1,
    dstClassCode: '701', dstDay: 2, dstPeriod: 3
  });
  assert(okRes.ok === true, '合法移動應成功：' + (okRes.error || ''));
  assert(okRes.cell['課表ID'] === 'S1' && String(okRes.cell['星期']) === '2' && String(okRes.cell['節次']) === '3',
    '移動應保留來源課表ID並寫入目的時段');
  const actualRows = backend.sheetToObjects_(ss.getSheetByName('課表'));
  const actualRev = backend.scheduleRevision_(actualRows);
  assert(okRes.scheduleRevision === actualRev,
    `moveCell_ 記憶體版號 (${okRes.scheduleRevision}) 必須與工作表重算 (${actualRev}) 完全一致`);
});

check('getAll_ 分片 ScriptCache 命中、寫入失效與 bootstrap_ 權限合併', () => {
  const store = new Map();
  const mockCache = {
    get: key => store.has(key) ? store.get(key) : null,
    put: (key, val) => {
      if (String(val).length > 95000) throw new Error('超過 ScriptCache 單鍵上限');
      store.set(key, String(val));
    },
    getAll: keys => {
      const out = {};
      keys.forEach(k => { if (store.has(k)) out[k] = store.get(k); });
      return out;
    },
    putAll: entries => {
      Object.entries(entries).forEach(([k, v]) => mockCache.put(k, v));
    }
  };
  const ss = createExactOneBasedSpreadsheet({
    '班級': [['班級代碼', '年級', '班級名稱', '是否虛擬班'], ['701', '7', '七年一班', 'FALSE']],
    '教師': [['教師姓名', 'Email', '任教科目', '職稱', '最大連堂節數', '基本鐘點', '減授原因'], ['T01', '', '國文', '專任', '2', '16', '']],
    '科目': [['科目代碼', '每週節數', '同時最多班數', '最多連日', '適用年級', '適用班級', '所屬教室代碼'], ['國文', '5', '0', '3', '全校', '', '']],
    '配課': [['配課ID', '班級代碼', '科目代碼', '教師姓名', '每週節數'], ['A1', '701', '國文', 'T01', '5']],
    '課表': [['課表ID', '班級代碼', '星期', '節次', '科目代碼', '教師姓名', '課堂屬性', '是否鎖定'], ['S1', '701', '1', '1', '國文', 'T01', '一般', 'FALSE']],
    '不排課': [['記錄ID', '教師姓名', '時段', '原因']],
    '科目規則': [['規則ID', '科目代碼', '適用年級', '適用班級', '時段', '規則類型', '備註']],
    '科目關係': [['規則ID', '科目A', '科目B', '適用年級', '適用班級', '備註']],
    '綁班': [['群組ID', '群組名稱', '科目清單', '班級清單']],
    '教室': [['教室代碼', '教室名稱', '容量', '備註']],
    '配色': [['代碼類型', '目標代碼', '適用年級', '適用班級', '網頁色票', 'Word底色', 'Word字色', '說明']],
    '互斥': [['規則ID', '教師A', '教師B', '備註']],
    '寒暑輔-場次': [['場次ID', '活動名稱', '活動類型', '學年度', '開始日期', '結束日期', '上課日', '節次時間', '版本號']],
    '寒暑輔-需求': [['需求ID', '場次ID', '班級代碼', '科目代碼', '教師姓名', '節數', '備註']],
    '寒暑輔-停排': [['記錄ID', '場次ID', '教師姓名', '時段', '原因']],
    '寒暑輔-課表': [['課表ID', '場次ID', '日期', '節次', '班級代碼', '科目代碼', '教師姓名', '是否鎖定', '手動安排', '備註']],
    '設定': [['設定項', '設定值'], ['AdminPassword', 'topsecret']]
  });
  const backend = loadBackend({ CacheService: { getScriptCache: () => mockCache } });
  const schedSheet = ss.getSheetByName('課表');

  const firstAll = backend.getAll_(ss);
  const readsAfterFirst = schedSheet._metrics.readCalls;
  const secondAll = backend.getAll_(ss);
  assert(schedSheet._metrics.readCalls === readsAfterFirst, '第二次 getAll_ 應命中 ScriptCache，不可重讀課表工作表');
  assert(secondAll.scheduleRevision === firstAll.scheduleRevision, '快取回傳應保留相同 scheduleRevision');

  const unauthBoot = backend.bootstrap_(ss, { password: '' });
  assert(unauthBoot.authRequired === true && unauthBoot.authenticated === false && !unauthBoot.data,
    '有設密碼且未驗證時 bootstrap_ 不可外洩資料');

  const authBoot = backend.bootstrap_(ss, { password: 'topsecret' });
  assert(authBoot.authenticated === true && authBoot.sheetUrl.includes('SS_BEHAVIOR_TEST') && authBoot.data.classes.length === 1,
    '密碼正確時 bootstrap_ 應單次同時回傳驗證結果、試算表連結與全部資料');

  backend.lockCell_(ss, { classCode: '701', day: 1, period: 1, locked: true });
  const readsAfterLock = schedSheet._metrics.readCalls;
  const thirdAll = backend.getAll_(ss);
  assert(schedSheet._metrics.readCalls > readsAfterLock, '寫入鎖定後應失效快取並在下次 getAll_ 重建');
  assert(thirdAll.schedule[0]['是否鎖定'] === 'TRUE' && thirdAll.scheduleRevision !== firstAll.scheduleRevision,
    '快取失效後 getAll_ 應讀到最新鎖定狀態與新版號');
});

check('batchUpdateScheduleLocked_ 差異寫入僅更新異動區段且記憶體版號與工作表一致', () => {
  const initialRows = [];
  for (let i = 1; i <= 8; i++) {
    const cls = i <= 4 ? '701' : '702';
    const day = ((i - 1) % 4) + 1;
    const per = i <= 4 ? 1 : 2;
    initialRows.push({
      '課表ID': 'R' + i, '班級代碼': cls, '星期': String(day), '節次': String(per),
      '科目代碼': '國文', '教師姓名': 'T0' + i, '課堂屬性': '一般', '是否鎖定': 'FALSE'
    });
  }
  const ss = createExactOneBasedSpreadsheet({
    '班級': [
      ['班級代碼', '年級', '班級名稱', '是否虛擬班'],
      ['701', '7', '七年一班', 'FALSE'],
      ['702', '7', '七年二班', 'FALSE']
    ],
    '科目': [['科目代碼', '每週節數', '同時最多班數', '最多連日', '適用年級', '適用班級', '所屬教室代碼'], ['國文', '8', '0', '0', '全校', '', '']],
    '配課': [
      ['配課ID', '班級代碼', '科目代碼', '教師姓名', '每週節數'],
      ...initialRows.map(r => ['A' + r['課表ID'], r['班級代碼'], '國文', r['教師姓名'], '1'])
    ],
    '課表': [['課表ID', '班級代碼', '星期', '節次', '科目代碼', '教師姓名', '課堂屬性', '是否鎖定'],
      ...initialRows.map(r => [r['課表ID'], r['班級代碼'], r['星期'], r['節次'], r['科目代碼'], r['教師姓名'], r['課堂屬性'], r['是否鎖定']])],
    '不排課': [['記錄ID', '教師姓名', '時段', '原因']],
    '科目規則': [['規則ID', '科目代碼', '適用年級', '適用班級', '時段', '規則類型', '備註']],
    '綁班': [['群組ID', '群組名稱', '科目清單', '班級清單']],
    '互斥': [['規則ID', '教師A', '教師B', '備註']],
    '教室': [['教室代碼', '教室名稱', '容量', '備註']]
  });
  const backend = loadBackend();
  const updatedSchedule = initialRows.map((r, idx) => idx === 3 ? { ...r, '是否鎖定': 'TRUE' } : { ...r });
  const schedSheet = ss.getSheetByName('課表');
  const writeBefore = schedSheet._metrics.writeCalls;
  const clearBefore = schedSheet._metrics.clearCalls;
  const res = backend.batchUpdateScheduleLocked_(ss, { schedule: updatedSchedule, allowManualConstraintWarnings: true });
  assert(res.count === 8, '筆數應為 8，實際：' + JSON.stringify(res));
  assert(schedSheet._metrics.writeCalls === writeBefore + 1 && schedSheet._metrics.writtenRowTotal === 1,
    '僅第 4 列異動時應只寫入 1 個單列區段');
  assert(schedSheet._metrics.clearCalls === clearBefore, '等長差異寫入不應呼叫 clearContent');
  const actualRev = backend.scheduleRevision_(backend.sheetToObjects_(schedSheet));
  assert(res.scheduleRevision === actualRev, '記憶體計算的 scheduleRevision 必須與工作表重讀一致');

  const shrunk = updatedSchedule.slice(0, 6);
  const resShrink = backend.batchUpdateScheduleLocked_(ss, { schedule: shrunk, force: true, allowManualConstraintWarnings: true });
  assert(resShrink.count === 6 && schedSheet.getLastRow() === 7 && resShrink.scheduleRevision === backend.scheduleRevision_(backend.sheetToObjects_(schedSheet)),
    '縮減課表列數時應清理尾端剩餘列並維持版號一致');
});

check('saveTeacherBlock_ 與 saveSubjectRule_ 支援單次取代編輯，且 saveSeasonalBundle_ 跳過未變動工作表', () => {
  let uuidSeq = 1;
  const backend = loadBackend({
    Utilities: {
      getUuid: () => 'uuid-test-' + (uuidSeq++),
      formatDate: d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || ''))
    }
  });
  const defs = vm.runInContext('SHEET_DEFS', backend);
  const sessionHeaders = defs['寒暑輔-場次'].headers;
  const needHeaders = defs['寒暑輔-需求'].headers;
  const blockHeaders = defs['寒暑輔-停排'].headers;
  const schedHeaders = defs['寒暑輔-課表'].headers;
  const seasonalSS = createExactOneBasedSpreadsheet({
    '不排課': [['記錄ID', '教師姓名', '時段', '原因'], ['B_OLD', 'T01', '1-1', '舊原因']],
    '科目規則': [['規則ID', '科目代碼', '適用年級', '適用班級', '時段', '規則類型', '備註'], ['SR_OLD', '國文', '全校', '', '1-2', '禁排', '']],
    '寒暑輔-場次': [sessionHeaders, sessionHeaders.map(h => ({ '場次ID': 'SEM1', '活動名稱': '115暑輔', '活動類型': '暑輔', '學年度': '115', '開始日期': '2026-07-20', '結束日期': '2026-07-21', '節次時間': '[]', '上課日': '2026-07-20,2026-07-21', '版本號': '1' }[h] ?? ''))],
    '寒暑輔-需求': [needHeaders, needHeaders.map(h => ({ '需求ID': 'N1', '場次ID': 'SEM1', '班級代碼': '901', '科目代碼': '國文', '教師姓名': 'T01', '本期節數': '2' }[h] ?? ''))],
    '寒暑輔-停排': [blockHeaders, blockHeaders.map(h => ({ '記錄ID': 'SB1', '場次ID': 'SEM1', '教師姓名': 'T01', '日期': '2026-07-20', '節次': '1', '原因': '請假' }[h] ?? ''))],
    '寒暑輔-課表': [schedHeaders]
  });
  const blkRes = backend.saveTeacherBlock_(seasonalSS, { teacherCodes: ['T01'], pairs: '2-3', reason: '新原因', replaceBlockId: 'B_OLD' });
  assert(blkRes.teacherBlocks.length === 1 && blkRes.teacherBlocks[0]['時段'] === '2-3' && blkRes.teacherBlocks[0]['原因'] === '新原因',
    'saveTeacherBlock_ replaceBlockId 應在單次呼叫內取代舊紀錄');

  const ruleRes = backend.saveSubjectRule_(seasonalSS, { id: 'SR_NEW', subjectCodes: ['數學'], grade: '7', type: '必排', pairs: '3-4', replaceRuleId: 'SR_OLD' });
  assert(ruleRes.subjectRules.length === 1 && ruleRes.subjectRules[0]['規則ID'] === 'SR_NEW',
    'saveSubjectRule_ replaceRuleId 應在單次呼叫內取代舊規則');

  const needsClearBefore = seasonalSS.getSheetByName('寒暑輔-需求')._metrics.clearCalls;
  const blockClearBefore = seasonalSS.getSheetByName('寒暑輔-停排')._metrics.clearCalls;
  const schedClearBefore = seasonalSS.getSheetByName('寒暑輔-課表')._metrics.clearCalls;
  const seasonalRes = backend.saveSeasonalBundle_(seasonalSS, {
    baseVersion: '1',
    bundle: {
      session: { '場次ID': 'SEM1', '活動名稱': '115暑輔', '活動類型': '暑輔', '學年度': '115', '開始日期': '2026-07-20', '結束日期': '2026-07-21', '節次時間': '[]', '版本號': '1' },
      days: [{ '日期': '2026-07-20', '是否上課': 'TRUE' }, { '日期': '2026-07-21', '是否上課': 'TRUE' }],
      needs: [{ '需求ID': 'N1', '場次ID': 'SEM1', '班級代碼': '901', '科目代碼': '國文', '教師姓名': 'T01', '本期節數': '2' }],
      teacherBlocks: [{ '記錄ID': 'SB1', '場次ID': 'SEM1', '教師姓名': 'T01', '日期': '2026-07-20', '節次': '1', '原因': '請假' }],
      schedule: [{ '課表ID': 'SS1', '場次ID': 'SEM1', '班級代碼': '901', '日期': '2026-07-21', '節次': '2', '科目代碼': '國文', '教師姓名': 'T01', '是否鎖定': 'FALSE', '手動安排': 'FALSE', '需求ID': 'N1' }]
    }
  });
  assert(seasonalRes.ok === true && seasonalRes.version === '2', '寒暑輔差異儲存應成功升級版本號：' + JSON.stringify(seasonalRes));
  assert(seasonalSS.getSheetByName('寒暑輔-需求')._metrics.clearCalls === needsClearBefore, '未變動的寒暑輔-需求不可重寫');
  assert(seasonalSS.getSheetByName('寒暑輔-停排')._metrics.clearCalls === blockClearBefore, '未變動的寒暑輔-停排不可重寫');
  assert(seasonalSS.getSheetByName('寒暑輔-課表')._metrics.clearCalls === schedClearBefore + 1, '有變動的寒暑輔-課表應正常寫入');
});

asyncPhaseChecks.push((async () => {
  try {
    const lsStore = new Map();
    const ctx = loadApp({
      localStorage: {
        getItem: k => (lsStore.has(k) ? lsStore.get(k) : null),
        setItem: (k, v) => { lsStore.set(k, String(v)); },
        removeItem: k => { lsStore.delete(k); }
      }
    });
    const payloadA = makeData({
      scheduleRevision: 'rev-1',
      schedule: [scheduleRow({ '課表ID': 'S1', '班級代碼': '701', '星期': '1', '節次': '1', '科目代碼': '國文', '教師姓名': 'T01' })]
    });
    vm.runInContext(`
      GAS_URL = 'https://script.google.com/macros/s/demo/exec';
      var __renderAllCount = 0;
      renderAll = function() { __renderAllCount++; };
      showLoading = function() {};
      setStatus = function() {};
      toast = function() {};
    `, ctx);
    ctx.writeSwrCache(payloadA);
    assert(ctx.hydrateFromSwrCache() === true && vm.runInContext('state.schedule.length', ctx) === 1 && vm.runInContext('__renderAllCount', ctx) === 1,
      'hydrateFromSwrCache 應立即寫入 state 並執行首屏渲染');

    await ctx.loadAll({ background: true, prefetchedData: payloadA });
    assert(vm.runInContext('__renderAllCount', ctx) === 1, '背景資料摘要相同時應跳過重複 renderAll');

    const payloadB = makeData({
      scheduleRevision: 'rev-2',
      schedule: [scheduleRow({ '課表ID': 'S1', '班級代碼': '701', '星期': '2', '節次': '2', '科目代碼': '國文', '教師姓名': 'T01' })]
    });
    await ctx.loadAll({ background: true, prefetchedData: payloadB });
    assert(vm.runInContext('__renderAllCount', ctx) === 2 && vm.runInContext('state.scheduleRevision', ctx) === 'rev-2',
      '背景資料變更時應更新 state 並重新渲染');

    const gasActions = [];
    vm.runInContext(`
      buildIndex();
      renderClassSelect = function() {};
      renderClassTT = function() {};
      renderTeacherTT = function() {};
      gasPost = async function(action, payload) {
        __gasActions.push({ action, payload });
        return { ok: true, data: { scheduleRevision: 'rev-3' } };
      };
    `, Object.assign(ctx, { __gasActions: gasActions }));
    ctx.optimisticMoveCell('701', 2, 2, '701', 3, 3);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert(gasActions.length === 1 && gasActions[0].action === 'moveCell' && gasActions[0].payload.dstDay === 3,
      'optimisticMoveCell 應僅發送單一原子 moveCell 請求');

    results.push({ name: '前端 SWR 快取、摘要重繪省略與單一 moveCell 請求', ok: true });
  } catch (error) {
    results.push({ name: '前端 SWR 快取、摘要重繪省略與單一 moveCell 請求', ok: false, error: error.message });
  }
})());

// ============================================================
// Phase 3：模組化、DOM-free 引擎、Worker 協定與容器事件委派
// ============================================================
const { FRONTEND_MODULES } = require('./helpers/loader.js');
const fsP3 = require('fs');
const pathP3 = require('path');
const rootP3 = pathP3.join(__dirname, '..');

check('Phase 3：舊單檔與猴子補丁已移除，頂層函式無重複定義', () => {
  assert(!fsP3.existsSync(pathP3.join(rootP3, 'js/app.js')), 'js/app.js 應已刪除');
  assert(!fsP3.existsSync(pathP3.join(rootP3, 'js/app-runtime.js')), 'js/app-runtime.js 應已刪除');
  const seen = new Map();
  const dup = [];
  for (const mod of FRONTEND_MODULES) {
    const src = readSource(mod);
    for (const m of src.matchAll(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/gm)) {
      if (seen.has(m[1])) dup.push(m[1] + '（' + seen.get(m[1]) + ' / ' + mod + '）');
      else seen.set(m[1], mod);
    }
    for (const bad of ['baseBuildIndex', 'baseClearTeacherForm', 'baseApplyData']) {
      assert(!src.includes(bad), mod + ' 仍含猴子補丁 ' + bad);
    }
    assert(!/__(?!lastAuto)\w*Summary/.test(src), mod + ' 仍含 __*Summary 補丁');
  }
  assert(dup.length === 0, '頂層函式重複定義：' + dup.join('、'));
});

function makeDomlessEngineContext() {
  const sandbox = { console, setTimeout, clearTimeout, Date, Math, JSON };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const mod of ['js/core/state.js', 'js/core/indexes.js', 'js/engine/scheduler-core.js']) {
    vm.runInContext(readSource(mod), sandbox, { filename: mod });
  }
  return sandbox;
}
const p3Config = {
  autoStartPeriod: 1, autoEndPeriod: 7, optOnePerDay: true, optMorningCore: true,
  optTeacherConsec: true, optSmartSwap: true, optRandomize: false, optP8Only: false,
  priorityTeacherInput: '', prioritySubjectInput: '', seed: '7', autoMode: 'all', tightClassCodes: []
};

asyncPhaseChecks.push((async () => {
  const name = 'Phase 3：純 Node VM（無 window/document/localStorage）可執行排課與品質稽核';
  try {
    const ctx = makeDomlessEngineContext();
    assert(typeof ctx.window === 'undefined' && typeof ctx.document === 'undefined' && typeof ctx.localStorage === 'undefined',
      '沙箱不應含瀏覽器全域');
    const snapshot = makeData({
      subjects: [{ '科目代碼': '國文', '每週節數': '3' }, { '科目代碼': '數學', '每週節數': '3' }],
      assignments: [
        { '配課ID': 'A1', '班級代碼': '701', '科目代碼': '國文', '教師姓名': 'T01', '每週節數': '3' },
        { '配課ID': 'A2', '班級代碼': '701', '科目代碼': '數學', '教師姓名': 'T02', '每週節數': '3' }
      ]
    });
    ctx.__snapshot = snapshot;
    ctx.__config = p3Config;
    const result = await vm.runInContext('runPureAutoSchedule(__snapshot, { config: __config })', ctx);
    assert(result && Array.isArray(result.schedule || result.finalSchedule || result.rows || []), '應回傳排程結果');
    const rows = (result.schedule || result.finalSchedule || result.rows || []);
    assert(rows.length === 6, 'DOM-less 排課應排滿 6 節，實際：' + rows.length);
    ctx.__rows = rows;
    const quality = vm.runInContext('buildAutoScheduleQualityReport({ schedule: __rows, optP8Only: false, autoEndPeriod: 7 })', ctx);
    assert(quality && quality.violations.length === 0, '品質稽核不應有違規：' + JSON.stringify(quality && quality.violations));
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
  }
})());

asyncPhaseChecks.push((async () => {
  const name = 'Phase 3：scheduler-worker 協定（runSingle 與 runMulti 回報 progress 與 done）';
  try {
    const sandbox = { console, setTimeout, clearTimeout, Date, Math, JSON };
    sandbox.globalThis = sandbox;
    const posted = [];
    sandbox.self = sandbox;
    sandbox.postMessage = msg => posted.push(msg);
    sandbox.location = { search: '?v=test' };
    sandbox.importScripts = (...paths) => {
      for (const p of paths) {
        const clean = p.split('?')[0].replace('../', 'js/').replace(/^scheduler-core/, 'js/engine/scheduler-core');
        vm.runInContext(readSource(clean), sandbox, { filename: clean });
      }
    };
    vm.createContext(sandbox);
    vm.runInContext(readSource('js/engine/scheduler-worker.js'), sandbox, { filename: 'scheduler-worker.js' });
    assert(typeof sandbox.onmessage === 'function', 'Worker 應註冊 onmessage');
    const snap = makeData({
      assignments: [
        { '配課ID': 'A1', '班級代碼': '701', '科目代碼': '國文', '教師姓名': 'T01', '每週節數': '3' },
        { '配課ID': 'A2', '班級代碼': '701', '科目代碼': '數學', '教師姓名': 'T02', '每週節數': '3' }
      ]
    });
    await sandbox.onmessage({ data: { id: 1, type: 'runSingle', stateSnapshot: snap, config: p3Config } });
    const doneSingle = posted.find(m => m.id === 1 && m.type === 'done');
    assert(doneSingle && doneSingle.result, 'runSingle 應回傳 done 與 result：' + JSON.stringify(posted.map(m => m.type + (m.error ? ':' + m.error : ''))));
    await sandbox.onmessage({ data: { id: 2, type: 'runMulti', stateSnapshot: snap, config: p3Config,
      runSpecs: [{ seed: 'a', randomize: true }, { seed: 'b', randomize: true }], timeBudgetMs: 60000 } });
    const doneMulti = posted.find(m => m.id === 2 && m.type === 'done');
    assert(doneMulti && Array.isArray(doneMulti.candidates) && doneMulti.candidates.length === 2, 'runMulti 應回傳 2 組候選');
    assert(posted.some(m => m.id === 2 && m.type === 'progress'), 'runMulti 應回報 progress');
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
  }
})());

check('Phase 3：file:// 不使用 Worker，改走主執行緒非阻塞降級', () => {
  const ctx = loadApp();
  ctx.Worker = function () {};
  ctx.window.location = { protocol: 'file:' };
  assert(vm.runInContext('canUseSchedulerWorker()', ctx) === false, 'file: 協定應停用 Worker');
  ctx.window.location = { protocol: 'https:' };
  assert(vm.runInContext('canUseSchedulerWorker()', ctx) === true, 'https: 協定應可使用 Worker');
});

check('Phase 3：容器事件委派只在容器綁一次，子節點重建後仍可觸發', () => {
  const ctx = loadApp();
  const makeBox = () => {
    const handlers = {};
    return {
      addCount: 0, handlers,
      addEventListener(type, fn) { this.addCount++; (handlers[type] = handlers[type] || []).push(fn); },
      contains: () => true, innerHTML: '', style: {}
    };
  };
  const box = makeBox();
  const card = { dataset: { itemIndex: '0', cls: '701', sub: '國文', attr: '一般', alternateWeek: 'false', tc: 'T01' }, style: {} };
  card.closest = () => card;
  ctx.__box = box;
  vm.runInContext('__box._teacherPaletteState = { teacherCode: "T01", myAssignments: [{ "教師姓名": "T01" }] }; ensureTeacherPaletteDelegation(__box); ensureTeacherPaletteDelegation(__box);', ctx);
  const initial = box.addCount;
  assert(initial === 2, '兩次呼叫仍只應綁 dragstart/dragend 各一次，實際：' + initial);
  box.handlers.dragstart[0]({ target: card, dataTransfer: {} });
  assert(vm.runInContext('ui.drag && ui.drag.isPalette === true && ui.drag.subjectCode === "國文"', ctx), '委派 dragstart 應設定 ui.drag');
  const box2 = makeBox();
  ctx.__box2 = box2;
  vm.runInContext('__box2._classPaletteItems = [{ teacherList: [], isAlternateWeek: false }]; ensureClassPaletteDelegation(__box2); ensureClassPaletteDelegation(__box2);', ctx);
  assert(box2.addCount === 2, '班級待排區同樣只綁一次');
  for (const fn of ['ensurePatrolOverviewDelegation', 'ensureTeacherTTDelegation', 'ensureClassTTDelegation', 'ensureBlockSlotGridDelegation']) {
    assert(vm.runInContext('typeof ' + fn + ' === "function"', ctx), '缺少委派函式 ' + fn);
  }
});

Promise.all(asyncPhaseChecks).then(() => {
  for (const result of results) {
    console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.error ? `: ${result.error}` : ''}`);
  }
  if (results.some(result => !result.ok)) process.exitCode = 1;
});