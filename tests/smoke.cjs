const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const app = read('app.js');
const runtime = read('app-runtime.js');
const wordExport = read('word-export.js');
const backend = read('Code.gs');
const html = read('index.html');
const styles = read('style.css');
const weeklyHelperContext = {
  parseWeeklyValue(value, fallback = 0) {
    const raw = String(value ?? '').trim().replace(',', '.');
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  },
  isAlternateWeeklyValue(value) {
    return Math.abs(weeklyHelperContext.parseWeeklyValue(value, 0) - 0.5) < 0.000001;
  },
  formatWeeklyValue(value) {
    const parsed = weeklyHelperContext.parseWeeklyValue(value, 0);
    return Number.isInteger(parsed) ? String(parsed) : String(parsed).replace(/\.0+$/, '');
  },
  isValidWeeklyInput(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return true;
    const parsed = weeklyHelperContext.parseWeeklyValue(raw, NaN);
    return Number.isFinite(parsed) && (Math.abs(parsed - 0.5) < 0.000001 || (Number.isInteger(parsed) && parsed >= 1 && parsed <= 20));
  },
  getSubjectWeeklyValue(subject, fallback = 3) {
    const parsed = weeklyHelperContext.parseWeeklyValue(subject?.['每週節數'], fallback);
    return parsed > 0 ? parsed : fallback;
  },
  getAssignmentWeeklyValue(assignment, subject = null, fallback = 3) {
    const custom = weeklyHelperContext.parseWeeklyValue(assignment?.['每週節數'], 0);
    if (custom > 0) return custom;
    return weeklyHelperContext.getSubjectWeeklyValue(subject, fallback);
  },
  getScheduleWeeklyUnits(entry) {
    return Number(entry?.['節次']) === 8 && ['單週', '雙週'].includes(String(entry?.['課堂屬性'] || '').trim()) ? 0.5 : 1;
  },
  runtimeParseWeeklyValue(value, fallback = 0) {
    return this.parseWeeklyValue(value, fallback);
  },
  runtimeGetAssignmentWeeklyValue(assignment, subject = null, fallback = 3) {
    return weeklyHelperContext.getAssignmentWeeklyValue(assignment, subject, fallback);
  },
  runtimeIsValidWeeklyInput(value) {
    return weeklyHelperContext.isValidWeeklyInput(value);
  }
};
const withWeeklyHelpers = context => Object.assign({ ...weeklyHelperContext }, context);
const results = [];
function check(name, test) {
  try { test(); results.push({ name, ok: true }); }
  catch (error) { results.push({ name, ok: false, error: error.message }); }
}
check('JavaScript syntax', () => {
  new vm.Script(app, { filename: 'app.js' });
  new vm.Script(runtime, { filename: 'app-runtime.js' });
  new vm.Script(wordExport, { filename: 'word-export.js' });
  new Function(backend);
});
check('Nonregular timetable periods use soft row backgrounds', () => {
  for (const marker of [
    "const rowClass = per === EARLY_PERIOD",
    "'tt-row-lunch'",
    "'tt-row-p8'",
    "0:'07:40'",
    "45:'12:35'"
  ]) {
    if (!app.includes(marker)) throw new Error('timetable row marker missing: ' + marker);
  }
  if (app.includes("0:'07:40~08:30'") || app.includes("45:'12:35~13:15'")) throw new Error('special periods still display end times');
  for (const marker of [
    '.tt-row-early',
    '.tt-row-lunch',
    '.tt-row-p8'
  ]) {
    if (!styles.includes(marker)) throw new Error('soft background style missing: ' + marker);
  }
});
check('P8 split cells preserve timetable columns', () => {
  if (app.includes('<td class="tt-cell tt-cell-p8"') && !app.includes('class="p8-cell-inner"')) {
    throw new Error('P8 cells lack an inner flex wrapper');
  }
  const p8Style = styles.match(/\.tt-cell-p8\s*\{([^}]*)\}/)?.[1] || '';
  if (/display\s*:\s*flex/.test(p8Style)) {
    throw new Error('P8 table cells still use display:flex');
  }
  if (!styles.includes('.p8-cell-inner')) throw new Error('P8 inner flex wrapper style missing');
});
check('Special Word rows support early study and lunch', () => {
  const context = { console };
  vm.createContext(context);
  vm.runInContext(wordExport, context, { filename: 'word-export.js' });
  const cell = text => '<w:tc><w:tcPr></w:tcPr><w:p><w:r><w:t>' + text + '</w:t></w:r></w:p></w:tc>';
  const source = '<w:tr>' + cell('08:30') + cell('1') + cell('{d1p1}') + cell('{d2p1}') + cell('{d3p1}') + cell('{d4p1}') + cell('{d5p1}') + '</w:tr>';
  const earlyTop = '<w:tr>' + cell('07:40~08:15') + cell('班級活動') + '</w:tr>';
  const earlyBottom = '<w:tr>' + cell('08:15~08:30') + cell('晨間工作') + '</w:tr>';
  const lunch = '<w:tr>' + cell('12:35') + cell('午休') + '</w:tr>';
  const output = context.expandWordSpecialRows(
    source + earlyTop + earlyBottom + lunch,
    { d1p0: '早自習', d1p45: '午休課' },
    'class'
  );
   if (!output.includes('{d1p0}') || !output.includes('{d1p45}')) throw new Error('special period placeholders were not injected');
   if (!output.includes('<w:vMerge w:val="restart"/>') || !output.includes('<w:vMerge/>')) throw new Error('early-study cells were not vertically merged');
   const summaryTable = '<w:tbl><w:tblPr><w:tblW w:w="300" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="100"/><w:gridCol w:w="200"/></w:tblGrid><w:tr><w:tc><w:tcW w:w="999" w:type="dxa"/><w:p><w:r><w:t>配課總表</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>保留</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
   if (wordExport.includes('wordNormalizeFixedTables') || wordExport.includes('wordNormalizeFixedTable')) throw new Error('Word 匯出仍會重算官方範本欄寬');
   if (!summaryTable.includes('<w:tcW w:w="999" w:type="dxa"/>')) throw new Error('範本欄寬固定測試資料無效');
  if (context.wordRemoveBold('<w:rPr><w:b/><w:bCs/></w:rPr>').includes('<w:b')) throw new Error('special period cells still keep bold formatting');
  if (context.teacherWordSpecialSubject([
    { '科目代碼': '專題探究', '班級代碼': '804' },
    { '科目代碼': '專題探究', '班級代碼': '805' }
   ]) !== '專題探究（804805）') throw new Error('special teacher cells did not include class labels');
  const teacherSource = '<w:tr>' + cell('08:30') + cell('1') + cell('') +
    cell('{d1p1_s}') + cell('{d2p1_s}') + cell('{d3p1_s}') + cell('{d4p1_s}') + cell('{d5p1_s}') + '</w:tr>';
  const teacherEarlyTop = '<w:tr>' + cell('07:40~08:15') + cell('晨間工作') + '</w:tr>';
  const teacherEarlyBottom = '<w:tr>' + cell('08:15~08:30') + cell('班級整理') + '</w:tr>';
  const teacherOutput = context.expandWordSpecialRows(
    teacherSource + teacherEarlyTop + teacherEarlyBottom,
    { d1p0_s: '早自習（701）', d2p0_s: '', d3p0_s: '', d4p0_s: '', d5p0_s: '' },
    'teacher'
  );
  if (!teacherOutput.includes('<w:t></w:t>')) throw new Error('teacher early-study blank cells were not cleared');
  if (teacherOutput.includes('<w:tc><w:tcPr></w:tcPr></w:t>')) throw new Error('teacher early-study row XML is malformed');
});
check('Teacher Word metadata calculates overtime and joins split placeholders', () => {
  const sharedCell = { '課堂屬性': '一般', '班級代碼': '701', '科目代碼': '國文' };
  const overtimeContext = {
    console,
    idx: {
      schedByTeacherSlot: {
       'T01|1|1': [sharedCell, { '課堂屬性': '一般', '班級代碼': '702', '科目代碼': '國文' }],
       'T01|1|3': [{ '課堂屬性': '一般', '班級代碼': '702', '科目代碼': '數學' }],
       'T01|1|8': [{ '課堂屬性': '一般', '班級代碼': '703', '節次': '8', '科目代碼': '國文輔' }],
       'T01|2|8': [{ '課堂屬性': '一般', '班級代碼': '704', '節次': '8', '科目代碼': '音樂' }],
       'T01|3|0': [{ '課堂屬性': '一般', '班級代碼': '705', '節次': '0', '科目代碼': '早自習' }],
       'T01|4|45': [{ '課堂屬性': '一般', '班級代碼': '706', '節次': '45', '科目代碼': '午休課' }]
      }
    },
    state: { schedule: [] },
    getCellTeacherList: cell => [{ '教師姓名': String(cell['教師姓名'] || 'T01') }]
  };
  vm.createContext(overtimeContext);
  vm.runInContext(wordExport, overtimeContext, { filename: 'teacher-word-metadata.js' });
  const joined = overtimeContext.joinSplitPlaceholders(
    '<w:r><w:t>{</w:t></w:r><w:r><w:t>減授原因}</w:t></w:r>' +
    '<w:r><w:t>{</w:t></w:r><w:r><w:t>超鐘點}</w:t></w:r>'
  );
  if (!joined.includes('{減授原因}') || !joined.includes('{超鐘點}')) {
    throw new Error('teacher metadata placeholders were not joined');
  }
  const threeRunMetadata = overtimeContext.joinSplitPlaceholders(
    '<w:p><w:r><w:t>{</w:t></w:r><w:r><w:t>減授原因</w:t></w:r><w:r><w:t>}</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>{</w:t></w:r><w:r><w:t>超鐘點</w:t></w:r><w:r><w:t>}</w:t></w:r></w:p>'
  );
  if (!threeRunMetadata.includes('{減授原因}') || !threeRunMetadata.includes('{超鐘點}') || threeRunMetadata.includes('{}')) {
    throw new Error('三段式教師 metadata 佔位符未正確合併');
  }
  const splitCoursePlaceholder = overtimeContext.joinSplitPlaceholders(
    '<w:r><w:t>{生活科技</w:t></w:r><w:r><w:lastRenderedPageBreak/><w:t>節}</w:t></w:r>'
  );
  if (!splitCoursePlaceholder.includes('{生活科技節}')) {
    throw new Error('跨 Word 文字區段的課程佔位符未合併');
  }
  const splitVisualPlaceholder = overtimeContext.joinSplitPlaceholders(
    '<w:r><w:t>{視覺藝術</w:t></w:r><w:r><w:t>節}</w:t></w:r>'
  );
  if (!splitVisualPlaceholder.includes('{視覺藝術節}')) {
    throw new Error('跨 Word 文字區段的視覺藝術佔位符未合併');
  }
  if (overtimeContext.calculateTeacherOvertime('T01', { '基本鐘點': '1' }) !== '超鐘點3') {
     throw new Error('teacher overtime calculation is incorrect');
   }
   if (overtimeContext.calculateTeacherOvertime('T01', { '基本鐘點': '4' }) !== '') {
    throw new Error('zero overtime should be blank');
  }
  if (overtimeContext.calculateTeacherOvertime('T01', {}) !== '') {
    throw new Error('blank basic hours should not become overtime');
  }
  if (!overtimeContext.isWordHelperCourseCell({ '節次': '8', '科目代碼': '國文輔' }) ||
      overtimeContext.isWordHelperCourseCell({ '節次': '8', '科目代碼': '國文' }) ||
      overtimeContext.isWordHelperCourseCell({ '節次': '8', '科目代碼': '輔導' })) {
    throw new Error('第八節課輔判定錯誤');
  }
  overtimeContext.state.schedule = [
    { '教師姓名': 'T01', '班級代碼': '703', '節次': '8', '科目代碼': '國文輔', '課堂屬性': '一般' },
    { '教師姓名': 'T01', '班級代碼': '701', '節次': '1', '科目代碼': '國文', '課堂屬性': '一般' }
  ];
  const summary = overtimeContext.collectTeacherCourseSummary('T01');
  if (summary.some(item => item.subjectCode === '國文輔')) throw new Error('第八節課輔仍出現在教師配課總表');
});
check('Teacher assignment status uses formal hours and preserves zero basic hours', () => {
  const start = runtime.indexOf('function parseTeacherBasicHours');
  const end = runtime.indexOf('  const renderTeacherAssignmentView', start);
  if (start < 0 || end < 0) throw new Error('教師配課節數計算函式缺少');
  let context;
  context = {
    window: {},
    idx: {
      schedByTeacherSlot: {
        'T01|1|1': [
          { '教師姓名': 'T01', '班級代碼': '701', '節次': '1', '科目代碼': '本土語' },
          { '教師姓名': 'T01', '班級代碼': '702', '節次': '1', '科目代碼': '本土語' }
        ],
       'T01|1|2': [{ '教師姓名': 'T01', '節次': '2', '科目代碼': '輔導' }],
       'T01|1|8': [{ '教師姓名': 'T01', '節次': '8', '科目代碼': '國文輔' }],
       'T01|2|8': [{ '教師姓名': 'T01', '節次': '8', '科目代碼': '音樂' }],
       'T01|3|0': [{ '教師姓名': 'T01', '節次': '0', '科目代碼': '早自習' }],
       'T01|4|45': [{ '教師姓名': 'T01', '節次': '45', '科目代碼': '午休課' }]
       , 'T01|2|3': [{ '教師姓名': 'T01', '節次': '3', '科目代碼': '國文', '課程屬性': '預排' }]
      }
    },
     isPatrolScheduleEntry: () => false,
     isPreplannedScheduleEntry: cell => String(cell?.['課程屬性'] || '') === '預排'
  };
  vm.createContext(context);
  vm.runInContext(runtime.slice(start, end), context, { filename: 'teacher-assignment-hours.js' });
  if (context.parseTeacherBasicHours({ '基本鐘點': '0' }) !== 0) throw new Error('基本鐘點 0 被套用預設值');
  if (context.parseTeacherBasicHours({ '基本鐘點': '' }) !== 0) throw new Error('空白基本鐘點未降為 0');
   if (context.countTeacherFormalScheduleHours('T01') !== 4) throw new Error('教師配課狀態未只排除第八節並保留早自習與午休');
   if (!runtime.includes('slots.add(key.slice(code.length + 1))')) throw new Error('教師配課節數未依教師星期節次去重');
   if (!runtime.includes('const overtime = scheduledHours - basicHours')) throw new Error('教師配課狀態未依實際節數計算超鐘點');
   if (runtime.includes("parseInt(t['基本鐘點'] || '16'")) throw new Error('教師配課狀態仍將基本鐘點預設為 16');
   if (!app.includes('const teacherTotalScheduled = idx.scheduledAssignedByTeacher?.[String(teacherCode)] ?? teacherFormalScheduled')) throw new Error('教師課表完成度仍排除第八節');
   if (!app.includes('teacherFormalScheduled - basicHours')) throw new Error('教師超鐘點未使用正式鐘點計算');
});
check('Teacher palette counts bound co-classes once', () => {
  const start = runtime.indexOf('const baseBuildIndex = buildIndex;');
   const end = runtime.indexOf('  classTeacherLabel =', start);
   if (start < 0 || end < 0) throw new Error('教師配課併班索引區段缺少');
      const context = withWeeklyHelpers({
     idx: {},
    state: {
      teachers: [{'教師姓名': 'T01'}],
      assignments: [
        {'班級代碼': '701', '科目代碼': '本土語', '教師姓名': 'T01', '每週節數': '1'},
        {'班級代碼': '702', '科目代碼': '本土語', '教師姓名': 'T01', '每週節數': '1'}
      ],
      schedule: [
        {'班級代碼': '701', '科目代碼': '本土語', '教師姓名': 'T01', '星期': '1', '節次': '2'},
        {'班級代碼': '702', '科目代碼': '本土語', '教師姓名': 'T01', '星期': '1', '節次': '2'}
      ]
    },
    buildIndex() {
      context.idx.subjectByCode = {'本土語': {'每週節數': '1'}};
    },
    getTeacherHomeroom: () => '',
    getCellTeacherCodes: cell => [String(cell['教師姓名'] || '')],
     getBindGroupClasses: () => ['701', '702']
   });
  vm.createContext(context);
  vm.runInContext(runtime.slice(start, end), context, {filename: 'teacher-palette-bind-count.js'});
  context.buildIndex();
  if (context.idx.assignedWeeklyByTeacher.T01 !== 1) throw new Error('併班配課總節數仍重複累加');
  if (context.idx.scheduledAssignedByTeacher.T01 !== 1) throw new Error('併班實際已排節數仍重複累加');
  if (!runtime.includes('scheduledCohortByTeacherSubjectClass')) throw new Error('既有課表併班判斷缺少');
});
check('Teacher reduction reason is persisted and exported', () => {
  for (const marker of [
    'id="tea-release-reason"',
    "'減授原因':document.getElementById('tea-release-reason').value.trim()",
    "'超鐘點': calculateTeacherOvertime"
  ]) {
    if (!html.includes(marker) && !app.includes(marker) && !wordExport.includes(marker)) {
      throw new Error('teacher reduction reason marker missing: ' + marker);
    }
  }
  if (!backend.includes("'基本鐘點', '減授原因'")) throw new Error('GAS teacher schema lacks reduction reason');
  if (backend.includes("'導師班級'") || backend.includes("'是否導師'")) throw new Error('invalid teacher columns are still in GAS schema');
  if (app.includes("'導師班級':") || app.includes("'是否導師':")) throw new Error('frontend still writes invalid teacher columns');
  if (!runtime.includes('data-inline-field="releaseReason"')) throw new Error('inline reduction reason field missing');
});
check('Clear schedule keeps protected entries', () => {
  const keepStart = app.indexOf('function keepLockedScheduleEntries');
  const keepEnd = app.indexOf('async function clearUnlockedSchedule', keepStart);
     const appContext = {
      isPatrolScheduleEntry: entry => [entry && entry['課堂屬性'], entry && entry['班級代碼'], entry && entry['科目代碼']]
         .some(value => String(value || '').trim().includes('巡堂')),
       isManualOnlyPeriod: period => [0, 45].includes(parseInt(period, 10))
      };
  vm.createContext(appContext);
  vm.runInContext(app.slice(keepStart, keepEnd), appContext, {filename: 'clear-schedule.js'});
     const entries = [
      {'課表ID':'LOCKED', '是否鎖定':'TRUE'},
      {'課表ID':'PATROL', '課堂屬性':'巡堂', '是否鎖定':'TRUE'},
      {'課表ID':'ORDINARY', '是否鎖定':'FALSE'},
       {'課表ID':'EARLY', '節次':'0', '是否鎖定':'FALSE'},
       {'課表ID':'LUNCH', '節次':'45', '是否鎖定':'FALSE'},
       {'課表ID':'PULLOUT', '節次':'0', '課堂屬性':'抽離', '是否鎖定':'FALSE'}
    ];
      const kept = appContext.keepLockedScheduleEntries(entries);
       if (kept.length !== 3 || !['LOCKED', 'EARLY', 'LUNCH'].every(id => kept.some(entry => entry['課表ID'] === id)) || kept.some(entry => entry['課表ID'] === 'PULLOUT')) throw new Error('clear action did not keep protected entries');
    const lockedConsecutive = [
      {'課表ID':'LOCKED-DOUBLE-1', '班級代碼':'701', '星期':'2', '節次':'3', '科目代碼':'絲竹室內樂', '是否鎖定':'TRUE'},
      {'課表ID':'LOCKED-DOUBLE-2', '班級代碼':'701', '星期':'2', '節次':'4', '科目代碼':'絲竹室內樂', '是否鎖定':'FALSE'}
    ];
    const keptConsecutive = appContext.keepLockedScheduleEntries(lockedConsecutive);
    if (keptConsecutive.length !== 2) throw new Error('clear action removed the unlocked extension of a locked consecutive course');
   const clearStart = app.indexOf('// 🗑 清除排課');
  const clearEnd = app.indexOf('// ============================================================\n// 🤖 智慧自動排課引擎', clearStart);
   const clearBlock = app.slice(clearStart, clearEnd);
   if (!clearBlock.includes('const nextSchedule = getClearedSchedule(scope)')) throw new Error('clear action does not apply the selected scope');
    if (!clearBlock.includes('clearKeepLockedOnly: scope === \'all\'')) throw new Error('clear action does not mark its explicit locked-only write');
    if (!clearBlock.includes('allowSoftTeacherExclusives: true')) throw new Error('clear action does not bypass non-creating teacher exclusivity audit');
    if (!app.includes('allowSoftTeacherExclusives: force')) throw new Error('manual bind writes do not pass teacher exclusivity force');
   if (!clearBlock.includes("value: 'second-round'")) throw new Error('second-round clear option is missing');
   if (!clearBlock.includes("value: 'period-8'")) throw new Error('eighth-period clear option is missing');
   if (!clearBlock.includes('clearScope: scope')) throw new Error('clear scope is not sent to GAS');
   if (clearBlock.includes('state.schedule = frozenEntries')) throw new Error('clear action still applies all frozen entries');
   if (!app.includes('function isClearablePeriodEightScheduleEntry')) throw new Error('clear-specific period-8 predicate is missing');
   const scopeStart = app.indexOf('function isClearScopeTarget');
   const scopeEnd = app.indexOf('function getClearedSchedule', scopeStart);
   const scopeContext = {
     isClearFrozenScheduleEntry: () => false,
     isLockedConsecutiveScheduleEntry: () => false,
     isSecondRoundScheduleEntry: () => true
   };
   vm.createContext(scopeContext);
   vm.runInContext(app.slice(scopeStart, scopeEnd), scopeContext, { filename: 'clear-scope.js' });
   if (!scopeContext.isClearScopeTarget({ '節次': '7' }, 'second-round')) throw new Error('第二輪清除未包含第七節');
   if (scopeContext.isClearScopeTarget({ '節次': '8' }, 'second-round')) throw new Error('第二輪清除仍包含第八節');
   if (!app.includes('return cell && isClearFrozenScheduleEntry(cell)')) throw new Error('single-cell clear does not use clear-specific frozen predicate');
   if (!app.includes("weekType: weekType || ''")) throw new Error('single-cell clear does not carry period-8 week type');
   const optimisticClearStart = app.indexOf('function optimisticClearCell');
   const optimisticClearEnd = app.indexOf('// 3. 樂觀移動格位', optimisticClearStart);
   const singleWeek = { '課表ID': 'P8-SINGLE', '班級代碼': '701', '星期': '1', '節次': '8', '科目代碼': '英語', '課堂屬性': '單週' };
   const doubleWeek = { ...singleWeek, '課表ID': 'P8-DOUBLE', '課堂屬性': '雙週' };
   let frontCaptured = null;
   const frontClearContext = {
     state: { schedule: [singleWeek, doubleWeek] },
     idx: { schedByClassSlot: {}, schedByClassSlotP8: { '701|1|8': { '單週': singleWeek, '雙週': doubleWeek } } },
     ui: { selectedClass: '', selectedTeacher: '' },
     isClearFrozenScheduleEntry: () => false,
     getBindGroupMembers: () => null,
     buildIndex() {}, renderClassSelect() {}, renderClassTT() {}, renderTeacherTT() {}, toast() {},
     gasPost: (action, payload) => { frontCaptured = { action, payload }; return Promise.resolve({ ok: true }); }
   };
   vm.createContext(frontClearContext);
   vm.runInContext(app.slice(optimisticClearStart, optimisticClearEnd), frontClearContext, { filename: 'optimistic-clear.js' });
   frontClearContext.optimisticClearCell('701', 1, 8, '單週');
   if (frontClearContext.state.schedule.length !== 1 || frontClearContext.state.schedule[0]['課堂屬性'] !== '雙週' || frontCaptured?.payload?.weekType !== '單週') {
     throw new Error('前端單週清除誤刪雙週課程或未傳遞週次');
   }

   const frozenStart = backend.indexOf('function isFrozenScheduleEntry_');
  const frozenEnd = backend.indexOf('function frozenTeacherValue_', frozenStart);
   const backendContext = { isPatrolScheduleRow_: () => false };
  vm.createContext(backendContext);
  vm.runInContext(backend.slice(frozenStart, frozenEnd), backendContext, {filename: 'clear-backend.js'});
   if (!backendContext.isFrozenScheduleEntry_({'是否鎖定':'TRUE'})) throw new Error('backend no longer protects locked entries');
     if (backendContext.isFrozenScheduleEntry_({'是否鎖定':'FALSE'})) throw new Error('backend incorrectly protects ordinary entries');
    if (!backendContext.isClearablePeriodEightScheduleEntry_({'節次':'8', '課堂屬性':'單週'})) throw new Error('backend period-8 single-week predicate is missing');
     if (backendContext.isClearFrozenScheduleEntry_({'節次':'8', '課堂屬性':'單週'})) throw new Error('backend still blocks period-8 single-week clear');
      if (backendContext.isClearFrozenScheduleEntry_({'節次':'0', '課堂屬性':'抽離', '是否鎖定':'FALSE'})) throw new Error('backend still blocks unlocked pull-out clear');
   const explicitStart = backend.indexOf('function isExplicitlyLockedScheduleEntry_');
   const explicitEnd = backend.indexOf('function splitBindList_', explicitStart);
   const explicitContext = {
     isPatrolScheduleRow_: entry => [entry && entry['課堂屬性'], entry && entry['班級代碼'], entry && entry['科目代碼']]
       .some(value => String(value || '').trim().includes('巡堂'))
   };
   vm.createContext(explicitContext);
   vm.runInContext(backend.slice(explicitStart, explicitEnd), explicitContext, {filename: 'clear-explicit-lock.js'});
   if (explicitContext.isExplicitlyLockedScheduleEntry_({'課堂屬性':'巡堂', '是否鎖定':'TRUE'})) throw new Error('clear action still preserves patrol as locked');
});
check('Teacher display avoids duplicate code and name', () => {
  const helperStart = app.indexOf('function formatTeacherCodeName');
  const helperEnd = app.indexOf('function parseTeacherCode', helperStart);
  const helperContext = {};
  vm.createContext(helperContext);
  vm.runInContext(app.slice(helperStart, helperEnd), helperContext, {filename: 'teacher-display.js'});
  if (helperContext.formatTeacherCodeName('許實理', {'教師姓名': '許實理', '姓名': '許實理'}) !== '許實理') throw new Error('same teacher code and name still duplicate');
  if (helperContext.formatTeacherCodeName('T01', {'教師姓名': 'T01', '姓名': '王老師'}) !== 'T01 王老師') throw new Error('teacher code and name display changed unexpectedly');
  if (!app.includes('return formatTeacherCodeName(code, t);')) throw new Error('assignment modal does not use normalized teacher display');
});
check('Exclusive delete confirmation uses safe teacher labels', () => {
  const deleteStart = app.indexOf('async function deleteExclusiveRule');
  const deleteEnd = app.indexOf('// 全域操作按鈕函數', deleteStart);
  const deleteBlock = app.slice(deleteStart, deleteEnd);
  for (const marker of [
    'const teacherLabel = code =>',
    'formatTeacherCodeName(key, teacher)'
  ]) {
    if (!deleteBlock.includes(marker)) throw new Error('互斥刪除確認未使用安全教師名稱：' + marker);
  }
  if (deleteBlock.includes("idx.teacherByCode[rule['教師A']]['姓名']")) throw new Error('互斥刪除仍直接讀取不存在的教師姓名欄位');
  if (deleteBlock.includes("idx.teacherByCode[rule['教師B']]['姓名']")) throw new Error('互斥刪除仍直接讀取不存在的教師姓名欄位');
});
check('Inline editors save matching fields and teacher rename references', () => {
  for (const marker of [
    'window.saveInlineClass',
    'data-inline-field="title"',
    "gasPost('renameTeacher'",
    'function saveInlineSubject',
    'window.saveInlineAssignment',
    "options(state.teachers,'教師姓名'"
  ]) {
    if (!app.includes(marker) && !runtime.includes(marker)) throw new Error('編輯流程標記缺少：' + marker);
  }
  if (runtime.includes("options(state.teachers,'姓名'")) throw new Error('配課教師編輯仍使用不存在的姓名欄位');

  const helperStart = app.indexOf('function replaceTeacherReferenceValue');
  const saveEnd = app.indexOf("if (typeof window !== 'undefined') window.saveInlineTeacher = saveInlineTeacher;", helperStart);
  const fields = {
    name: { value: '新教師' },
    email: { value: 'new@example.com' },
    title: { value: '教務主任' },
    hours: { value: '18' },
    subject: { value: '國文、閱讀' }
  };
  const row = {
    querySelector(selector) {
      if (selector === '#teacher-tbody .inline-edit-row') return row;
      const match = selector.match(/data-inline-field="([^"]+)"/);
      return match ? (fields[match[1]] || null) : null;
    }
  };
  let syncConfig = null;
  let gasCall = null;
  const teacherContext = {
    console,
    state: {
      teachers: [{ '教師姓名': 'T01', 'Email': 'old@example.com', '職稱': '701導師', '任教科目': '國文', '基本鐘點': '16', '最大連堂節數': '3' }],
      assignments: [{ '教師姓名': 'T01' }],
      schedule: [{ '教師姓名': '[{"教師姓名":"T01","標籤":"主"}]' }],
      teacherBlocks: [{ '教師姓名': 'T01' }],
      teacherExclusives: [{ '教師A': 'T01', '教師B': 'T02' }]
    },
    idx: { teacherByCode: {} },
    ui: { inlineTeacherCode: 'T01', selectedTeacher: 'T01' },
    document: { querySelector: selector => selector === '#teacher-tbody .inline-edit-row' ? row : null },
    getTeacherHomeroom: teacher => {
      const title = String(teacher['職稱'] || '');
      const match = title.match(/(\d{3})/);
      return match ? match[1] : (title.includes('導師') ? 'TRUE' : '');
    },
    toast() {},
    renderTeacherConfigList() {},
     bgSync(config) { syncConfig = config; config.applyLocal(); },
      gasPost(action, payload) { gasCall = { action, payload }; return Promise.resolve({ ok: true }); }
    };
  teacherContext.idx.teacherByCode.T01 = teacherContext.state.teachers[0];
  vm.createContext(teacherContext);
  vm.runInContext(app.slice(helperStart, saveEnd), teacherContext, { filename: 'teacher-inline-edit.js' });
  teacherContext.saveInlineTeacher('T01');
  if (!syncConfig) throw new Error('教師編輯沒有建立同步請求');
  gasCall = null;
  syncConfig.gasTask();
  if (!gasCall || gasCall.action !== 'renameTeacher') throw new Error('教師改名沒有送出 renameTeacher');
  if (gasCall.payload.oldKey !== 'T01' || gasCall.payload.data['教師姓名'] !== '新教師') throw new Error('教師改名 payload 仍使用舊姓名');
  if (gasCall.payload.data['職稱'] !== '教務主任') throw new Error('教師職稱欄位沒有寫回');
  if (teacherContext.state.teachers[0]['教師姓名'] !== '新教師') throw new Error('教師姓名沒有更新到本地狀態');
  if (teacherContext.state.assignments[0]['教師姓名'] !== '新教師' || teacherContext.state.teacherBlocks[0]['教師姓名'] !== '新教師') throw new Error('教師引用沒有同步更新');
  if (teacherContext.state.teacherExclusives[0]['教師A'] !== '新教師') throw new Error('教師互斥引用沒有同步更新');
  if (JSON.parse(teacherContext.state.schedule[0]['教師姓名'])[0]['教師姓名'] !== '新教師') throw new Error('多教師課表引用沒有同步更新');
  if (teacherContext.ui.selectedTeacher !== '新教師') throw new Error('目前教師選取狀態沒有同步改名');
});
 check('Inline assignment course attribute saves locally before background sync', () => {
  const saveStart = runtime.indexOf('window.saveInlineAssignment = function');
  const saveEnd = runtime.indexOf('  const renderAssignmentFormOptions', saveStart);
  const saveBlock = runtime.slice(saveStart, saveEnd);
  if (saveStart < 0 || saveEnd < 0) throw new Error('inline assignment save handler missing');
  if (saveBlock.includes('await loadAll()')) throw new Error('inline assignment save still reloads all data synchronously');
  const fields = {
    class: { value: '701' },
    subject: { value: '本土語' },
    teacher: { value: 'T01' },
     weekly: { value: '1' },
     note: { value: '第八節測試' },
     courseAttr: { value: '預排' }
  };
  const row = {
    dataset: { assignmentId: 'A1' },
    querySelector(selector) {
      const match = selector.match(/data-asgn-field="([^"]+)"/);
      return match ? fields[match[1]] || null : null;
    }
  };
  let syncConfig = null;
  let gasCall = null;
  let renderCount = 0;
   const assignmentContext = withWeeklyHelpers({
    console,
    state: { assignments: [{
      '配課ID': 'A1', '班級代碼': '701', '科目代碼': '國文', '教師姓名': 'T01',
       '課程屬性': '', '每週節數': '1', '備註': ''
    }] },
    ui: { inlineAssignmentId: 'A1' },
    document: { querySelectorAll: selector => selector === '.assignment-inline-row' ? [row] : [] },
    parseTeacherCode: value => String(value || '').trim(),
    toast() {},
    renderAssignmentConfigList() { renderCount++; },
    bgSync(config) { syncConfig = config; config.applyLocal(); },
     gasPost(action, payload) { gasCall = { action, payload }; return Promise.resolve({ ok: true }); }
   });
  assignmentContext.window = assignmentContext;
  vm.createContext(assignmentContext);
  vm.runInContext(saveBlock, assignmentContext, { filename: 'assignment-inline-save.js' });
  assignmentContext.saveInlineAssignment('A1');
  if (!syncConfig) throw new Error('第八節配課編輯沒有建立背景同步');
   if (assignmentContext.state.assignments[0]['課程屬性'] !== '預排') throw new Error('課程屬性沒有先更新本地狀態');
  if (assignmentContext.ui.inlineAssignmentId !== null) throw new Error('本地更新後沒有立即結束編輯狀態');
  if (renderCount < 1) throw new Error('本地更新後沒有重繪配課表');
  if (gasCall) throw new Error('儲存函式仍在本地更新前同步雲端');
  syncConfig.gasTask();
   if (!gasCall || gasCall.action !== 'saveMeta' || gasCall.payload.data['課程屬性'] !== '預排') throw new Error('課程屬性背景 payload 錯誤');
  syncConfig.rollbackLocal();
  if (assignmentContext.ui.inlineAssignmentId !== 'A1') throw new Error('背景同步失敗沒有恢復編輯狀態');

  fields.weekly.value = '   ';
  assignmentContext.ui.inlineAssignmentId = 'A1';
  syncConfig = null;
  gasCall = null;
  assignmentContext.saveInlineAssignment('A1');
  if (!syncConfig) throw new Error('清空節數後沒有建立背景同步');
  if (assignmentContext.state.assignments[0]['每週節數'] !== '') throw new Error('未填節數應保留空白並使用科目預設');
  syncConfig.gasTask();
  if (!gasCall || gasCall.payload.data['每週節數'] !== '') throw new Error('清空節數後背景 payload 不應填入數字');
});
check('Teacher rename backend cascades references', () => {
  const helperStart = backend.indexOf('function replaceTeacherReference_');
  const helperEnd = backend.indexOf('function replaceTeacherReferenceColumn_', helperStart);
  if (helperStart < 0 || helperEnd < 0) throw new Error('GAS 教師引用替換函式缺少');
  const context = {};
  vm.createContext(context);
  vm.runInContext(backend.slice(helperStart, helperEnd), context, { filename: 'teacher-rename-backend.js' });
  if (context.replaceTeacherReference_('T01', 'T01', '新教師') !== '新教師') throw new Error('GAS 單教師引用替換失效');
  const multi = JSON.parse(context.replaceTeacherReference_('[{"教師姓名":"T01","標籤":"主"}]', 'T01', '新教師'));
  if (multi[0]['教師姓名'] !== '新教師' || multi[0]['標籤'] !== '主') throw new Error('GAS 多教師引用替換失效');
  for (const marker of [
    "case 'renameTeacher'",
    "update('配課', ['教師姓名'])",
    "update('課表', ['教師姓名'])",
    "update('不排課', ['教師姓名'])",
    "update('互斥', ['教師A', '教師B'])"
  ]) if (!backend.includes(marker)) throw new Error('GAS 改名同步範圍缺少：' + marker);
});check('Locked multi-teacher edits preserve lock', () => {
  const assignStart = app.indexOf('async function confirmAssign');
  const assignEnd = app.indexOf('// 右鍵選單', assignStart);
  const assignBlock = app.slice(assignStart, assignEnd);
  if (!assignBlock.includes('const existingLocked')) throw new Error('multi-teacher edit does not read existing lock');
  if (!assignBlock.includes('isLocked:    existingLocked')) throw new Error('multi-teacher edit does not preserve lock');
  const lockStart = app.indexOf('function isFrozenAutoEntry');
  const lockEnd = app.indexOf('// 舊流程仍使用此名稱', lockStart);
  const frozenBlock = app.slice(lockStart, lockEnd);
   if (!frozenBlock.includes("schedEntry['是否鎖定']") || frozenBlock.includes("是否預排")) throw new Error("auto scheduler still contains the removed preset field");
  if (frozenBlock.includes("__isBindGroup")) throw new Error("bind-group flag is incorrectly treated as frozen");
  const dropStart = app.indexOf('async function executeDrop');
  const dropEnd = app.indexOf('// 課表操作（Write）', dropStart);
  if (!app.slice(dropStart, dropEnd).includes('凍結課程不可移動')) throw new Error('manual drag does not protect frozen entries');
  if (!app.includes('function isFrozenScheduleEntry(entry)')) throw new Error('manual timetable frozen helper missing');
 });
 check('Assignment modal displays existing multi-teacher assignments without add entry', () => {
  const modalStart = app.indexOf('function openAssignModal');
  const modalEnd = app.indexOf('function closeAssignModal', modalStart);
  const confirmStart = app.indexOf('async function confirmAssign');
  const confirmEnd = app.indexOf('// 右鍵選單', confirmStart);
  const modalBlock = app.slice(modalStart, modalEnd);
  const confirmBlock = app.slice(confirmStart, confirmEnd);
   for (const marker of ['assign-teacher-row', 'data-teacher-input', 'fillTeacherRows']) {
     if (!modalBlock.includes(marker)) throw new Error('動態教師欄位缺少：' + marker);
   }
   if (modalBlock.includes('modal-add-teacher') || modalBlock.includes('nextTeacherRow')) throw new Error('課表指派仍保留新增教師入口');
   if (!confirmBlock.includes("querySelectorAll('#assign-teacher-list .assign-teacher-row')")) throw new Error('確認指派仍只讀取固定三位教師');
   if (!confirmBlock.includes('syncManualAssignment')) throw new Error('手動指派沒有同步配課');
    if (!modalBlock.includes('fillTeacherRows(getCellTeacherList(a))')) throw new Error('選取配課沒有帶回完整教師與標籤');
    if (!modalBlock.includes('matchedAssignmentIndex') || !modalBlock.includes('i === matchedAssignmentIndex ? \' selected\' : \'\'')) throw new Error('開啟指派視窗未自動選取同班同科配課');
    if (!modalBlock.includes('已同步配課主／協同教師')) throw new Error('指派視窗未標示目前已同步配課教師');
    if (!modalBlock.includes('matchedAssignment && getCellTeacherList(matchedAssignment).length > 0')) throw new Error('指派視窗初始教師欄仍只讀課表舊資料');
    if (!modalBlock.includes('per !== 8 || isHelperSubjectCode')) throw new Error('第八節配課清單未限制為課輔科目');
   if (!modalBlock.includes("document.getElementById('modal-sub')?.addEventListener('change'")) throw new Error('手動選科目沒有自動帶入配課教師');
   if (!modalBlock.includes('教師將自動沿用配課設定') || !modalBlock.includes("per === 8 ? ' style=\"display:none;\"'")) throw new Error('第八節仍顯示手動教師輸入欄');
   if (!confirmBlock.includes('此格已有教師排課') || !confirmBlock.includes('確認替換')) throw new Error('已有教師覆寫前缺少確認視窗');
});
check('Manual assignment sync keeps multi-teacher labels and weekly settings', () => {
  const start = app.indexOf('function buildManualAssignmentData');
  const end = app.indexOf('async function confirmAssign', start);
  if (start < 0 || end < 0) throw new Error('手動配課同步函式缺少');
  const context = {
    state: { assignments: [{
      '配課ID': 'A1', '班級代碼': '701', '科目代碼': '本土語', '教師姓名': 'T00',
       '每週節數': '2', '課程屬性': '預排', '備註': '保留備註'
    }] }
  };
  vm.createContext(context);
  vm.runInContext(app.slice(start, end), context, { filename: 'manual-assignment-sync.js' });
  const data = context.buildManualAssignmentData('701', '本土語', [
    { '教師姓名': 'T01', '標籤': '台' },
    { '教師姓名': 'T02', '標籤': '手' }
  ], 'A1');
  const teachers = JSON.parse(data['教師姓名']);
  if (teachers.length !== 2 || teachers[0]['教師姓名'] !== 'T01' || teachers[0]['標籤'] !== '台' || teachers[1]['標籤'] !== '手') {
    throw new Error('手動配課同步未保留教師標籤');
  }
   if (data['每週節數'] !== '2' || data['備註'] !== '保留備註' || data['課程屬性'] !== '預排') {
    throw new Error('手動配課同步覆蓋了既有配課設定');
  }
  const singleTagged = context.buildManualAssignmentData('701', '本土語', [
    { '教師姓名': 'T01', '標籤': '台' }
  ], 'A1');
  const singleTeachers = JSON.parse(singleTagged['教師姓名']);
  if (singleTeachers.length !== 1 || singleTeachers[0]['標籤'] !== '台') {
    throw new Error('單一教師標籤未保留');
  }
});
check('Manual drag protects locked lessons and moves bind groups atomically', () => {
  const helperStart = app.indexOf('function parseBindList');
  const helperEnd = app.indexOf('function getTeacherForClassSubject', helperStart);
  const context = {
    state: {
      blockGroups: [{ '群組ID': 'BG1', '科目清單': '英語', '班級清單': '701,702' }],
      schedule: [
        { '課表ID': 'A1', '班級代碼': '701', '星期': 1, '節次': 1, '科目代碼': '英語', '教師姓名': 'T01', '課堂屬性': '一般', '是否鎖定': 'FALSE' },
        { '課表ID': 'A2', '班級代碼': '702', '星期': 1, '節次': 1, '科目代碼': '英語', '教師姓名': 'T02', '課堂屬性': '一般', '是否鎖定': 'FALSE' }
      ]
    },
    idx: { bindBySubject: { '英語': [{ '群組ID': 'BG1', '科目清單': '英語', '班級清單': '701,702' }] } },
    isFrozenScheduleEntry(entry) { return String(entry?.['是否鎖定'] || '').toUpperCase() === 'TRUE'; }
  };
  vm.createContext(context);
  vm.runInContext(app.slice(helperStart, helperEnd), context, { filename: 'bind-drag-helpers.js' });
  const valid = context.buildBindMovePlan({ subjectCode: '英語', srcCls: '701', srcDay: 1, srcPer: 1, dstCls: '701', dstDay: 2, dstPer: 2 });
  if (!valid || !valid.ok || valid.sourceEntries.length !== 2) throw new Error('bind move plan did not include every class');
  context.state.schedule.push({ '課表ID': 'N1', '班級代碼': '701', '星期': 2, '節次': 2, '科目代碼': '數學', '教師姓名': 'T03', '課堂屬性': '一般', '是否鎖定': 'FALSE' });
  const occupied = context.buildBindMovePlan({ subjectCode: '英語', srcCls: '701', srcDay: 1, srcPer: 1, dstCls: '701', dstDay: 2, dstPer: 2 });
  if (!occupied || occupied.ok || !String(occupied.error).includes('目的地已有課程')) throw new Error('bind move can still overwrite an occupied destination');
  context.state.schedule = context.state.schedule.filter(row => row['課表ID'] !== 'N1');
  context.state.schedule.find(row => row['課表ID'] === 'A2')['是否鎖定'] = 'TRUE';
  const locked = context.buildBindMovePlan({ subjectCode: '英語', srcCls: '701', srcDay: 1, srcPer: 1, dstCls: '701', dstDay: 2, dstPer: 2 });
  if (!locked || locked.ok || !String(locked.error).includes('鎖定')) throw new Error('locked bind member can still move');
  if (!app.includes('draggable: !isDragProtectedScheduleEntry(cell)')) throw new Error('bind lessons were made permanently undraggable');
  if (!app.includes('綁班課程不可被單獨擠掉')) throw new Error('manual drop does not protect an occupied bind lesson');
 if (!app.includes('function checkBindMoveConflicts')) throw new Error('bind move does not check every member teacher');
 });
check('Bind locking is atomic across every member', () => {
  const lockStart = app.indexOf('function optimisticLockCell');
  const lockEnd = app.indexOf('function bindClassTTEvents', lockStart);
  const lockBlock = app.slice(lockStart, lockEnd);
  if (!lockBlock.includes('getBindGroupMembers(subjectCode, classCode)')) throw new Error('frontend bind lock does not load every member');
  if (!lockBlock.includes('targetEntries.some(entry => !entry)')) throw new Error('frontend bind lock does not reject incomplete groups');
  if (!lockBlock.includes("subjectCode, weekType: targetWeek")) throw new Error('frontend bind lock payload does not identify the subject and week');
  const backendLockStart = backend.indexOf('function lockCell_');
  const backendLockEnd = backend.indexOf('function setOvertime_', backendLockStart);
  const backendLockBlock = backend.slice(backendLockStart, backendLockEnd);
  if (!backendLockBlock.includes('getConfiguredBindCohortMembers_')) throw new Error('GAS bind lock does not load every member');
  if (!backendLockBlock.includes('targetIndices')) throw new Error('GAS bind lock does not update all member rows');
  if (!backend.includes('綁班鎖定狀態不一致')) throw new Error('GAS snapshot audit does not reject mixed bind lock states');
});
check('Manual consecutive warnings bypass only the hard consecutive audit', () => {
  if ((app.match(/manualSoftWarnings: true/g) || []).length < 3) throw new Error('manual schedule writes do not opt into soft consecutive warnings');
  if (!backend.includes('allowManualTeacherConsecutive: payload.manualSoftWarnings === true')) throw new Error('GAS batch writes do not carry the manual warning mode');
  if (!backend.includes('if (data.allowManualTeacherConsecutive !== true) teacherPeriods.forEach')) throw new Error('GAS manual warning mode does not bypass only teacher consecutive checks');
});
check('Locked extraction lessons show lock icons in teacher timetable', () => {
  const teacherStart = app.indexOf('function renderTeacherTT');
  const teacherBlock = app.slice(teacherStart);
  if (!teacherBlock.includes("flags: patrol ? '巡' : (locked ? '🔒' : '')")) throw new Error('teacher timetable does not show lock icon for locked extraction lessons');
  if (!teacherBlock.includes("(ATTR_LABELS[attr]||'')")) throw new Error('teacher timetable lost extraction attribute flag');
});
check('Backend batch writes reject partial bind moves', () => {
  const start = backend.indexOf('function splitBindList_');
  const end = backend.indexOf('function isAllowedCombinedClassCohort_', start);
  const context = {};
  vm.createContext(context);
  vm.runInContext(backend.slice(start, end), context, { filename: 'bind-backend.js' });
  const groups = [{ '群組ID': 'BG1', '科目清單': '英語', '班級清單': '701,702' }];
  const current = [
    { '課表ID': 'A1', '班級代碼': '701', '星期': 1, '節次': 1, '科目代碼': '英語', '教師姓名': 'T01', '課堂屬性': '一般' },
    { '課表ID': 'A2', '班級代碼': '702', '星期': 1, '節次': 1, '科目代碼': '英語', '教師姓名': 'T02', '課堂屬性': '一般' }
  ];
  const moved = current.map(row => ({ ...row, '星期': 2, '節次': 2 }));
  if (!context.boundScheduleChangeCheck_(current, moved, groups).ok) throw new Error('complete bind move was rejected');
  const partial = context.boundScheduleChangeCheck_(current, [moved[0]], groups);
  if (partial.ok || !String(partial.error).includes('不可只移動')) throw new Error('partial bind move was accepted');
  const split = context.boundScheduleChangeCheck_(current, [moved[0], { ...moved[1], '星期': 3 }], groups);
  if (split.ok || !String(split.error).includes('同一時段')) throw new Error('split bind move was accepted');
  if (!context.boundScheduleChangeCheck_(current, []).ok) throw new Error('complete bind deletion was rejected');
  const scopedGroups = [{ '群組ID': 'BG_SCOPED', '科目清單': '英語,資優英語', '班級清單': '701,702,703,704' }];
  const scopedAssignments = [
    { '班級代碼': '701', '科目代碼': '英語' }, { '班級代碼': '702', '科目代碼': '英語' },
    { '班級代碼': '703', '科目代碼': '資優英語' }, { '班級代碼': '704', '科目代碼': '資優英語' }
  ];
  const scopedCurrent = [
    { '課表ID': 'S1', '班級代碼': '701', '星期': 1, '節次': 1, '科目代碼': '英語', '教師姓名': 'T01', '課堂屬性': '一般' },
    { '課表ID': 'S2', '班級代碼': '702', '星期': 1, '節次': 1, '科目代碼': '英語', '教師姓名': 'T02', '課堂屬性': '一般' },
    { '課表ID': 'S3', '班級代碼': '703', '星期': 1, '節次': 1, '科目代碼': '資優英語', '教師姓名': 'T03', '課堂屬性': '一般' },
    { '課表ID': 'S4', '班級代碼': '704', '星期': 1, '節次': 1, '科目代碼': '資優英語', '教師姓名': 'T04', '課堂屬性': '一般' }
  ];
  const scopedMoved = scopedCurrent.map(row => ({ ...row, '星期': 2, '節次': 2 }));
  if (!context.boundScheduleChangeCheck_(scopedCurrent, scopedMoved, scopedGroups, scopedAssignments).ok) throw new Error('subject-scoped bind move was rejected');
  if (context.validateBindSnapshot_(scopedCurrent, scopedGroups, scopedAssignments).length !== 0) throw new Error('subject-scoped bind snapshot was rejected');
  const scopedMixedAttrs = scopedCurrent.map(row => String(row['科目代碼']) === '資優英語' ? { ...row, '課堂屬性': '抽離' } : row);
  if (context.validateBindSnapshot_(scopedMixedAttrs, scopedGroups, scopedAssignments).length !== 0) throw new Error('virtual bind class attr was treated as a different slot');
  if (context.validateBindSnapshot_([scopedCurrent[0]], scopedGroups, scopedAssignments).length === 0) throw new Error('partial subject-scoped bind snapshot was accepted');
  if (!backend.includes('const bindCheck = boundScheduleChangeCheck_(currentRows, schedule, blockGroups, assignments)')) throw new Error('batch write does not run bind integrity check');
  if (!backend.includes('getConfiguredBindMembers_(instance.group, assignments)')) throw new Error('backend bind check does not use configured bind members');
  if (!backend.includes('function bindScheduleSlotKey_')) throw new Error('bind slot normalization helper missing');
});
check('Manual exclusive conflict can be force-placed', () => {
  const handStart = app.indexOf('async function checkHandAdjustConflicts');
  const handEnd = app.indexOf('function detectConflicts', handStart);
  const handBlock = app.slice(handStart, handEnd);
   if (!handBlock.includes("c.kind === 'teacher' || c.kind === 'bindTeacherConflict' || c.kind === 'banned'")) throw new Error('manual fatal conflict policy changed');
   if (!handBlock.includes('const warnConflicts = conflicts.filter(c => !fatalConflicts.includes(c));')) throw new Error('manual hard warnings are not shown');
   if (!handBlock.includes('return confirmed ? { force: true } : false')) throw new Error('manual force flag is not returned for every warning');
  const conflictStart = app.indexOf('function detectConflicts');
  const conflictEnd = app.indexOf('function countConsecutive', conflictStart);
  const conflictBlock = app.slice(conflictStart, conflictEnd);
  if (!conflictBlock.includes("const teacherName = teacher ? String(teacher['姓名'] || teacher['教師姓名'] || teacherCode) : teacherCode;")) throw new Error('consecutive warning teacher name lookup missing');
  if (!conflictBlock.includes('教師【${teacherName}】在 星期')) throw new Error('consecutive warning does not include teacher name');

  const classStart = app.indexOf('function renderClassTT');
  const classEnd = app.indexOf('function renderTeacherTT', classStart);
  const classBlock = app.slice(classStart, classEnd);
  if ((classBlock.match(/await checkHandAdjustConflicts\(dstConflicts/g) || []).length !== 2) throw new Error('class timetable swap still bypasses force confirmation');
  if ((classBlock.match(/await checkHandAdjustConflicts\(srcConflicts/g) || []).length !== 2) throw new Error('class timetable source swap still bypasses force confirmation');
  if (!classBlock.includes('force:      teacherDropForce')) throw new Error('class palette force flag is not forwarded');
  if (!classBlock.includes('Boolean(teacherDropForce || canMove.force)')) throw new Error('class move force flag is not forwarded');
  if (!classBlock.includes('cellTeacherList.map')) throw new Error('班級課表未顯示主／協同教師');

    if (!app.includes('function optimisticUpdateCell({ classCode, day, period, subjectCode, teacherCode, teacherList, attr = \'一般\', isLocked = false, isOvertime = false, force = false })')) throw new Error('single-cell force parameter missing');
   if (!app.includes('function optimisticMoveCell(srcCls, srcDay, srcPer, dstCls, dstDay, dstPer, srcWeek, dstWeek, force = false)')) throw new Error('move force parameter missing');
   if (!app.includes('allowManualConstraintWarnings: force')) throw new Error('manual batch writes do not pass the general force flag');
   const updateStart = backend.indexOf('function updateCell_');
  const updateEnd = backend.indexOf('function clearCell_', updateStart);
  const updateBlock = backend.slice(updateStart, updateEnd);
   if (!updateBlock.includes("p.force === true && c.kind !== 'teacher' && c.kind !== 'banned'")) throw new Error('GAS updateCell does not allow forced manual conflicts');
  if (!updateBlock.includes('const blockingConflicts = conflicts.filter')) throw new Error('GAS blocking conflict filter missing');
    if (!backend.includes('const blockingConflicts = conflicts.filter')) throw new Error('hard conflict guard was removed');
   const detectStart = app.indexOf('function detectConflicts');
   const detectEnd = app.indexOf('function countConsecutive', detectStart);
   const detectBlock = app.slice(detectStart, detectEnd);
   if (!detectBlock.includes("kind: 'sameClassSubjectDay'")) throw new Error('manual same-day duplicate reminder is missing');
   if (!detectBlock.includes('若為連排或特殊課程可以繼續排入')) throw new Error('manual same-day duplicate reminder does not explain the exception');
});
check('Subject and schedule color class access stays text', () => {
       if (!backend.includes("const key = 'schema-' + SCHEMA_VERSION + '-' + ss.getId();")) throw new Error('schema cache was not bumped');
  if (!backend.includes("cache.put(key, '1', 21600);")) throw new Error('schema cache lifetime is too short');
  if (!backend.includes("headers: ['規則ID', '科目代碼', '適用年級', '適用班級', '時段', '規則類型', '備註']")) throw new Error('subject rule scope column order is missing');
  if (!backend.includes('function ensureSubjectRuleSchema_(sheet)')) throw new Error('subject rule schema migration is missing');
  if (!backend.includes('const classColumnsToMerge')) throw new Error('duplicate subject rule class-column migration is missing');
  if (!backend.includes('sheet.deleteColumns(desiredHeaders.length + 1')) throw new Error('subject rule extra-column cleanup is missing');
  if (!backend.includes("protectSubjectTextColumns_(ss.getSheetByName('科目'));")) throw new Error('subject text format guard missing');
  if (!backend.includes("sheet.getRange('E:G').setNumberFormat('@');")) throw new Error('subject text columns are not protected');
  if (!backend.includes("protectScheduleColorTextColumns_(ss.getSheetByName('配色'));")) throw new Error('schedule color text guard missing');
  if (!backend.includes("sheet.getRange('A:C').setNumberFormat('@');")) throw new Error('schedule color class column is not protected');
  const saveStart = backend.indexOf('function saveMeta_');
  const saveEnd = backend.indexOf('function numericStringToText_', saveStart);
  const saveBlock = backend.slice(saveStart, saveEnd);
  if (!saveBlock.includes("if (p.type === '科目') protectSubjectTextColumns_(sheet);")) throw new Error('saveMeta subject guard missing');
  if (!saveBlock.includes("if (p.type === '配色') protectScheduleColorTextColumns_(sheet);")) throw new Error('saveMeta schedule color guard missing');
 });
check('Class bilingual lesson count flows through schema, UI, and Word export', () => {
   if (!backend.includes("headers: ['班級代碼', '年級', '班級名稱', '導師代碼', '班級類型', '是否虛擬班', '雙語課堂數']")) throw new Error('班級 schema 缺少雙語課堂數欄位');
  if (!backend.includes('function ensureClassSchema_(sheet)')) throw new Error('班級 schema migration missing');
   if (!backend.includes("if (p.type === '班級') return saveClassMeta_(sheet, p.data || {});")) throw new Error('班級儲存未先確保 schema');
  if (!html.includes('id="cls-bilingual"') || !html.includes('<th>雙語課堂數</th>')) throw new Error('班級雙語課堂數表單欄位缺少');
  if (!app.includes("'雙語課堂數': bilingualLessons")) throw new Error('新增班級未儲存雙語課堂數');
  if (!runtime.includes('data-class-field="bilingual"') || !runtime.includes("'雙語課堂數': field('bilingual')")) throw new Error('班級行內編輯未儲存雙語課堂數');
   if (!wordExport.includes('function wordClassBilingualLessonCount') || !wordExport.includes("'雙語課堂數': wordClassBilingualLessonCount(classCode, info)")) throw new Error('班級 Word 未提供雙語課堂數佔位值');

  const start = backend.indexOf('function ensureClassSchema_');
  const end = backend.indexOf('function ensureAllSheets_', start);
  const context = {
    SHEET_DEFS: { '班級': { headers: ['班級代碼', '年級', '班級名稱', '導師代碼', '班級類型', '是否虛擬班', '雙語課堂數'] } }
  };
  const values = [
    ['班級代碼', '年級', '班級名稱', '導師代碼', '班級類型', '是否虛擬班'],
    ['701', '7', '七年一班', '', '一般', 'FALSE']
  ];
  const sheet = {
    getLastRow: () => values.length,
    getLastColumn: () => values[0].length,
    getRange(row, column, rowCount, columnCount) {
      const range = {
        getDisplayValues: () => values.slice(row - 1, row - 1 + rowCount).map(item => item.slice(column - 1, column - 1 + columnCount)),
        setValues(next) {
          next.forEach((item, index) => { values[row - 1 + index] = item.slice(); });
          return range;
        },
        setFontWeight: () => range,
        setBackground: () => range
      };
      return range;
    },
    deleteColumns(startColumn, count) {
      values.forEach(row => row.splice(startColumn - 1, count));
    },
    insertColumnsAfter(afterColumn, count) {
      values.forEach(row => row.splice(afterColumn, 0, ...Array(count).fill('')));
    },
    setFrozenRows() {}
  };
  vm.createContext(context);
  vm.runInContext(backend.slice(start, end), context, { filename: 'class-schema.js' });
  context.ensureClassSchema_(sheet);
   if (values[0].join('|') !== '班級代碼|年級|班級名稱|導師代碼|班級類型|是否虛擬班|雙語課堂數') throw new Error('班級 schema 標題欄未正規化');
   if (values[1].join('|') !== '701|7|七年一班||一般|FALSE|') throw new Error('舊班級資料遷移時遺失既有班級欄位');
});
check('Subject relation soft rule is wired end to end', () => {
  if (!backend.includes("'科目關係':")) throw new Error('subject relation sheet definition missing');
  if (!backend.includes("headers: ['規則ID', '科目A', '科目B', '適用年級', '適用班級', '備註']")) throw new Error('subject relation schema missing');
  if (!backend.includes("subjectRelations:   sheetToObjects_(ss.getSheetByName('科目關係'))")) throw new Error('getAll does not return subject relations');
  if (!backend.includes("const GAS_VERSION = '20260826_v1212_export_excludes_preplanned';")) throw new Error('GAS version marker missing');
  if (!backend.includes('function saveSubjectRelation_(ss, p)')) throw new Error('atomic subject relation save missing');
  if (!backend.includes("case 'saveSubjectRelation': result = saveSubjectRelation_(ss, payload); break;")) throw new Error('subject relation save route missing');
  for (const marker of [
    'function getSubjectRelationCodes',
    'function getSubjectRelationWarnings',
    '科目關係是同一班不同科目的分日偏好',
    'kind: \'subjectRelation\'',
    'const getApplicableSubjectRelations',
    'AUTO_SUBJECT_RELATION_PENALTY',
    'prioritizeAutoCandidates',
    'subjectRelationSoftViolations',
    'repairSubjectRelationConflicts',
    'function collectAutoSchedulePreflightIssues',
    '排課前設定健檢'
  ]) if (!app.includes(marker) && !runtime.includes(marker)) throw new Error('subject relation wiring missing：' + marker);
  if (app.includes('互相矛盾，將以綁班共時為準')) throw new Error('科目關係仍被錯誤視為綁班衝突');
  for (const marker of [
    'relation-subject-a',
    'relation-subject-b',
    'subpanel-constraints-relation',
    'saveSubjectRelation()',
    '綁班共時'
  ]) if (!html.includes(marker) && !app.includes(marker)) throw new Error('subject relation UI missing：' + marker);
 if (!app.includes("gasPost('saveSubjectRelation', { data: newRule })")) throw new Error('subject relation save is not atomic');
 });
check('Subject relation warning respects class scope', () => {
  const scopeStart = app.indexOf('function splitRuleScopeList');
  const relationStart = app.indexOf('function getSubjectRelationCodes');
  const relationEnd = app.indexOf('// 只有明確寫入同日連續必排節次的課程', relationStart);
  const warningStart = app.indexOf('function getSubjectRelationWarnings');
  const warningEnd = app.indexOf('/**\n * 手動排課 / 拖曳時的衝突檢查包裝器', warningStart);
  if (scopeStart < 0 || relationStart < 0 || relationEnd < 0 || warningStart < 0 || warningEnd < 0) throw new Error('subject relation helper block missing');
  const context = {
    DAY_NAMES: ['', '週一', '週二', '週三', '週四', '週五'],
    idx: {
      classByCode: { '701': { '年級': '7' }, '801': { '年級': '8' } },
      subjectRelationsBySubject: {}
    },
    state: { subjectRelations: [], blockGroups: [] },
    document: { getElementById: () => ({ style: {} }) },
    isPatrolScheduleEntry: entry => String(entry?.['課堂屬性'] || '').includes('巡堂')
  };
  const relation = { '規則ID': 'REL1', '科目A': '國文', '科目B': '數學', '適用年級': '7', '適用班級': '' };
  context.idx.subjectRelationsBySubject['國文'] = [relation];
  vm.createContext(context);
  vm.runInContext(
    app.slice(scopeStart, relationStart) + app.slice(relationStart, relationEnd) + app.slice(warningStart, warningEnd),
    context,
    { filename: 'subject-relation-warning.js' }
  );
  const schedule = [{ '班級代碼': '701', '星期': '2', '節次': '3', '科目代碼': '數學' }];
  if (context.getSubjectRelationWarnings(2, '國文', '701', schedule).length !== 1) throw new Error('同日關係未產生軟警告');
  if (context.getSubjectRelationWarnings(2, '國文', '801', schedule).length !== 0) throw new Error('不適用年級錯誤產生軟警告');
  context.state.blockGroups = [{ '群組ID': 'BG1', '科目清單': '國文,數學', '班級清單': '701,702' }];
  if (context.getSubjectRelationWarnings(2, '國文', '701', schedule).length !== 1) throw new Error('綁班不應停用同班科目關係');
});
check('Frontend and backend versions use a handshake', () => {
  if (!app.includes("const FRONTEND_VERSION = '20260826_v1212_export_excludes_preplanned';")) throw new Error('frontend version marker missing');
  if (!app.includes('res.data.gasVersion')) throw new Error('frontend does not read GAS version');
  if (!app.includes('前後端版本不同')) throw new Error('version mismatch warning missing');
  if (!backend.includes('gasVersion:          GAS_VERSION')) throw new Error('GAS getAll version missing');
  if (!backend.includes('schemaVersion:       SCHEMA_VERSION')) throw new Error('GAS schema version missing');
});
check('Schedule exception feature is removed', () => {
  for (const marker of ['scheduleExceptions', 'ScheduleException', '日期調整', '課表例外', 'exception-page', 'saveScheduleException', 'exportScheduleExceptions']) {
    if ([app, runtime, backend, html, styles].some(source => source.includes(marker))) {
      throw new Error('日期調整功能殘留：' + marker);
    }
  }
});
check('Backend snapshot audit blocks teacher consecutive overflow', () => {
  const context = { console };
  vm.createContext(context);
  vm.runInContext(backend, context, { filename: 'Code.gs' });
  const result = context.validateScheduleSnapshot_([
    { '課表ID': 'R1', '班級代碼': 'C1', '科目代碼': 'S1', '教師姓名': 'T1', '星期': '1', '節次': '1' },
    { '課表ID': 'R2', '班級代碼': 'C2', '科目代碼': 'S2', '教師姓名': 'T1', '星期': '1', '節次': '2' }
  ], {
    classes: [{ '班級代碼': 'C1', '年級': '7' }, { '班級代碼': 'C2', '年級': '7' }],
    teachers: [{ '教師姓名': 'T1', '最大連堂節數': '1' }],
    subjects: [{ '科目代碼': 'S1' }, { '科目代碼': 'S2' }],
    assignments: [],
    teacherBlocks: [],
    subjectRules: [],
    blockGroups: [],
    teacherExclusives: [],
    rooms: []
  });
  if (result.ok || !result.violations.some(item => item.includes('教師連堂超限'))) {
    throw new Error('GAS did not block teacher consecutive overflow');
  }
  const manualResult = context.validateScheduleSnapshot_([
    { '課表ID': 'R1', '班級代碼': 'C1', '科目代碼': 'S1', '教師姓名': 'T1', '星期': '1', '節次': '1' },
    { '課表ID': 'R2', '班級代碼': 'C2', '科目代碼': 'S2', '教師姓名': 'T1', '星期': '1', '節次': '2' }
  ], {
    classes: [{ '班級代碼': 'C1', '年級': '7' }, { '班級代碼': 'C2', '年級': '7' }],
    teachers: [{ '教師姓名': 'T1', '最大連堂節數': '1' }],
    subjects: [{ '科目代碼': 'S1' }, { '科目代碼': 'S2' }],
    assignments: [],
    teacherBlocks: [],
    subjectRules: [],
    blockGroups: [],
    teacherExclusives: [],
    rooms: [],
    allowManualTeacherConsecutive: true
  });
  if (!manualResult.ok || manualResult.violations?.some(item => item.includes('教師連堂超限'))) {
    throw new Error('manual teacher consecutive warning was still treated as a hard audit');
  }
  const ignoredExistingResult = context.validateScheduleSnapshot_([
    { '課表ID': 'R1', '班級代碼': 'C1', '科目代碼': 'S1', '教師姓名': 'T1', '星期': '1', '節次': '1' },
    { '課表ID': 'R2', '班級代碼': 'C2', '科目代碼': 'S2', '教師姓名': 'T1', '星期': '1', '節次': '2' }
  ], {
    classes: [{ '班級代碼': 'C1', '年級': '7' }, { '班級代碼': 'C2', '年級': '7' }],
    teachers: [{ '教師姓名': 'T1', '最大連堂節數': '1' }],
    subjects: [{ '科目代碼': 'S1' }, { '科目代碼': 'S2' }],
    assignments: [],
    teacherBlocks: [],
    subjectRules: [],
    blockGroups: [],
    teacherExclusives: [],
    rooms: [],
    ignoredTeacherConsecutiveIds: ['R1', 'R2']
  });
  if (!ignoredExistingResult.ok || ignoredExistingResult.violations?.some(item => item.includes('教師連堂超限'))) {
    throw new Error('existing schedule rows were still included in automatic teacher consecutive audit');
  }
});
check('Single and double week slots only conflict within the same week', () => {
  const context = { console };
  vm.createContext(context);
  vm.runInContext(backend, context, { filename: 'Code.gs' });
  const preloaded = {
    schedule: [{
      '課表ID': 'P8-SINGLE', '班級代碼': 'C1', '星期': '1', '節次': '8',
      '科目代碼': 'S1', '教師姓名': 'T1', '課堂屬性': '單週'
    }],
    subjects: [{ '科目代碼': 'S1' }, { '科目代碼': 'S2' }],
    classes: [{ '班級代碼': 'C1', '年級': '7' }, { '班級代碼': 'C2', '年級': '7' }],
    teacherBlocks: [], subjectRules: [], teacherExclusives: [], blockGroups: []
  };
  const oppositeWeek = context.checkConflicts_(null, {
    day: 1, period: 8, classCode: 'C2', subjectCode: 'S2', teacherCode: 'T1', attr: '雙週'
  }, '', preloaded);
  if (oppositeWeek.some(item => item.kind === 'teacher')) throw new Error('雙週錯誤擋下單週教師排課');
   const sameWeek = context.checkConflicts_(null, {
     day: 1, period: 8, classCode: 'C2', subjectCode: 'S2', teacherCode: 'T1', attr: '單週'
   }, '', preloaded);
   if (!sameWeek.some(item => item.kind === 'teacher')) throw new Error('同週教師衝堂未被擋下');
   const fullPeriodClassConflict = context.checkConflicts_(null, {
     day: 1, period: 8, classCode: 'C1', subjectCode: 'S2', teacherCode: 'T2', attr: '一般'
   }, '', preloaded);
   if (!fullPeriodClassConflict.some(item => item.kind === 'classPeriodEight')) throw new Error('整節課程未被單週課程擋下');
   const oppositeWeekClass = context.checkConflicts_(null, {
     day: 1, period: 8, classCode: 'C1', subjectCode: 'S2', teacherCode: 'T2', attr: '雙週'
   }, '', preloaded);
   if (oppositeWeekClass.some(item => item.kind === 'classPeriodEight')) throw new Error('雙週錯誤擋下同班單週課程');
  const coTeacher = context.checkConflicts_(null, {
    day: 1, period: 1, classCode: 'C2', subjectCode: 'S2',
    teacherCode: JSON.stringify([{ '教師姓名': 'T1' }, { '教師姓名': 'T2' }]),
    allowCoTeacherOverlap: true
  }, '', {
    ...preloaded,
    schedule: [{ '課表ID': 'CO-1', '班級代碼': 'C1', '星期': '1', '節次': '1', '科目代碼': 'S1', '教師姓名': 'T2', '課堂屬性': '一般' }]
  });
  const coConflict = coTeacher.find(item => item.kind === 'coTeacher');
  if (!coConflict || coConflict.hard) throw new Error('協同教師重複未降為可確認衝突');
  const rows = preloaded.schedule.concat({
    '課表ID': 'P8-DOUBLE', '班級代碼': 'C1', '星期': '1', '節次': '8',
    '科目代碼': 'S2', '教師姓名': 'T2', '課堂屬性': '雙週'
  });
  const selected = context.findScheduleSlotIndices_(rows, 'C1', 1, 8, '雙週');
  if (selected.length !== 1 || rows[selected[0]]['課表ID'] !== 'P8-DOUBLE') throw new Error('雙週更新目標未正確限定週次');
  const snapshot = context.validateScheduleSnapshot_(rows, {
    classes: preloaded.classes,
    teachers: [{ '教師姓名': 'T1', '最大連堂節數': '2' }, { '教師姓名': 'T2', '最大連堂節數': '2' }],
    assignments: [], subjects: preloaded.subjects, teacherBlocks: [], subjectRules: [],
    blockGroups: [], teacherExclusives: [], rooms: []
  });
  if (!snapshot.ok) throw new Error('單週與雙週共存仍被快照稽核擋下：' + snapshot.error);
  const sameWeekSnapshot = context.validateScheduleSnapshot_(rows.map(row => ({ ...row, '課堂屬性': '單週', '教師姓名': 'T1' })), {
    classes: preloaded.classes,
    teachers: [{ '教師姓名': 'T1', '最大連堂節數': '2' }, { '教師姓名': 'T2', '最大連堂節數': '2' }],
    assignments: [], subjects: preloaded.subjects, teacherBlocks: [], subjectRules: [],
    blockGroups: [], teacherExclusives: [], rooms: []
  });
   if (sameWeekSnapshot.ok || !sameWeekSnapshot.violations.some(item => item.includes('教師衝堂'))) {
     throw new Error('同週教師衝堂未被快照稽核擋下');
   }
   const alternateAssignment = { '配課ID': 'A-HALF', '班級代碼': 'C1', '科目代碼': 'S2', '教師姓名': 'T2', '每週節數': '0.5' };
   const alternateData = {
     ...preloaded,
     assignments: [alternateAssignment]
   };
   const invalidAlternateConflict = context.checkConflicts_(null, {
     day: 1, period: 8, classCode: 'C1', subjectCode: 'S2', teacherCode: 'T2', attr: '一般'
   }, '', alternateData);
   if (!invalidAlternateConflict.some(item => item.kind === 'alternateWeeklyPeriod')) throw new Error('0.5 配課未限制第八節單雙週');
   const alternateSnapshot = context.validateScheduleSnapshot_([{
     '課表ID': 'P8-HALF', '班級代碼': 'C1', '星期': '1', '節次': '8', '科目代碼': 'S2', '教師姓名': 'T2', '課堂屬性': '單週'
   }], {
     classes: preloaded.classes,
     teachers: [{ '教師姓名': 'T1', '最大連堂節數': '2' }, { '教師姓名': 'T2', '最大連堂節數': '2' }],
     assignments: [alternateAssignment], subjects: preloaded.subjects, teacherBlocks: [], subjectRules: [],
     blockGroups: [], teacherExclusives: [], rooms: []
   });
   if (!alternateSnapshot.ok) throw new Error('合法 0.5 單週課程未通過快照稽核：' + alternateSnapshot.error);
   const invalidAlternateSnapshot = context.validateScheduleSnapshot_([{
     '課表ID': 'P8-HALF-BAD', '班級代碼': 'C1', '星期': '1', '節次': '7', '科目代碼': 'S2', '教師姓名': 'T2', '課堂屬性': '一般'
   }], {
     classes: preloaded.classes,
     teachers: [{ '教師姓名': 'T1', '最大連堂節數': '2' }, { '教師姓名': 'T2', '最大連堂節數': '2' }],
     assignments: [alternateAssignment], subjects: preloaded.subjects, teacherBlocks: [], subjectRules: [],
     blockGroups: [], teacherExclusives: [], rooms: []
   });
   if (invalidAlternateSnapshot.ok || !invalidAlternateSnapshot.violations.some(item => item.includes('0.5'))) throw new Error('0.5 課程排入非第八節未被快照稽核擋下');
});
check('0.5 palette defaults to single then double week', () => {
  const start = app.indexOf('function getDefaultAlternateWeekType');
  const end = app.indexOf('function buildBindMovePlan', start);
  const context = {
    state: {
      assignments: [{ '班級代碼': 'C1', '科目代碼': 'S2', '每週節數': '0.5' }],
      schedule: []
    },
    idx: { subjectByCode: { S2: { '每週節數': '1' } } },
    isAlternateWeeklyValue: value => Math.abs(Number(value) - 0.5) < 0.000001,
    getAssignmentWeeklyValue: assignment => Number(assignment['每週節數'] || 0),
    getScheduleCellsAt(classCode, day, period) {
      return context.state.schedule.filter(entry => String(entry['班級代碼']) === String(classCode) && Number(entry['星期']) === Number(day) && Number(entry['節次']) === Number(period));
    }
  };
  vm.createContext(context);
  vm.runInContext(app.slice(start, end), context, { filename: 'alternate-week-default.js' });
  if (context.getDefaultAlternateWeekType('C1', 'S2', 1, 8) !== '單週') throw new Error('第一個 0.5 課程未預設單週');
  context.state.schedule.push({ '班級代碼': 'C1', '科目代碼': 'S2', '星期': '1', '節次': '8', '課堂屬性': '單週' });
  if (context.getDefaultAlternateWeekType('C1', 'S2', 1, 8) !== '雙週') throw new Error('第二個 0.5 課程未預設雙週');
  if (context.getDefaultAlternateWeekType('C1', 'S2', 1, 8, '雙週') !== '雙週') throw new Error('明確指定週次未被保留');
});
check('Cloud writes use locked idempotent retries', () => {
  for (const marker of [
    'const LOCKED_WRITE_ACTIONS = new Set([',
    'function normalizeWriteRequestId_',
    'function getCachedWriteResponse_',
    'if (!lock.tryLock(45000))',
    'function addGasRequestId(action, payload)',
    'const maxAttempts = options && options.retry === false ? 1',
    'GAS 回應不是有效 JSON'
  ]) {
    if (!backend.includes(marker) && !app.includes(marker)) throw new Error('寫入可靠性標記缺少：' + marker);
  }
});
check('Teacher timetable splits alternate-week period eight cells', () => {
  for (const marker of [
    'function renderTeacherP8Cell(day, teacherCode, target = \'primary\')',
    'weekCells[\'單週\']',
    'weekCells[\'雙週\']',
    'function confirmTeacherTimetableOverwrite',
    '確定要替換或互調嗎？',
    'p8Week: per === 8 ? String(cell[\'課堂屬性\'] || \'\').trim() : \'\''
  ]) if (!app.includes(marker)) throw new Error('教師課表單雙週分欄或覆寫確認缺少：' + marker);
  const start = app.indexOf('function renderTeacherP8Cell');
  const end = app.indexOf('async function confirmTeacherTimetableOverwrite', start);
     const context = {
        idx: {
      schedByTeacherSlot: {
        'T1|1|8': [
          { '課表ID': 'S1', '班級代碼': '701', '科目代碼': '理化輔', '課堂屬性': '單週', '教師姓名': 'T1' },
          { '課表ID': 'S2', '班級代碼': '702', '科目代碼': '地理輔', '課堂屬性': '雙週', '教師姓名': 'T1' }
        ]
      },
      classByCode: { '701': { '班級名稱': '701' }, '702': { '班級名稱': '702' } }
    },
    getScheduleCellColor: () => ({ bg: '#eee', text: '#111' }),
    isDragProtectedScheduleEntry: () => false,
    esc: value => String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  };
  vm.createContext(context);
  vm.runInContext(app.slice(start, end), context, { filename: 'teacher-p8-renderer.js' });
  const split = context.renderTeacherP8Cell(1, 'T1');
  if (!split.rawHtml.includes('data-week="單週"') || !split.rawHtml.includes('data-week="雙週"')) throw new Error('教師課表第八節未分成單週與雙週子格');
  if (split.rawHtml.includes('衝堂 2 門')) throw new Error('不同週次被錯誤標成衝堂');
  context.idx.schedByTeacherSlot['T1|1|8'].push({ '課表ID': 'S3', '班級代碼': '703', '科目代碼': '歷史輔', '課堂屬性': '單週', '教師姓名': 'T1' });
  const sameWeek = context.renderTeacherP8Cell(1, 'T1');
  if (!sameWeek.rawHtml.includes('衝堂 2 門')) throw new Error('同週第八節衝堂未顯示');
});
check('Manual class assignment focuses the newly assigned teacher', () => {
  if (!app.includes('function focusTeacherAfterManualAssignment(teacherCode)')) throw new Error('新增課程後教師課表聚焦函式缺少');
  const updateStart = app.indexOf('function optimisticUpdateCell({');
  const updateEnd = app.indexOf('// 2. 樂觀單格清除', updateStart);
  const updateBlock = app.slice(updateStart, updateEnd);
  if (!updateBlock.includes("focusTeacherAfterManualAssignment(tl[0]?.['教師姓名'] || '')")) throw new Error('手動新增未切換至新指定教師');
});
check('Class timetable uses assignment co-teacher labels and preserves single tags', () => {
   const start = app.indexOf('function getCellTeacherList');
  const end = app.indexOf('// 多師循環', start);
  const context = {
     state: {
       assignments: [{ '班級代碼': '705', '科目代碼': '本土語', '教師姓名': '[{"教師姓名":"TMAIN","標籤":"台"},{"教師姓名":"TCO","標籤":"手"}]' }]
     },
     idx: { teacherByClassSubject: {} },
     isTeacherOvertimeItem: item => item && item['超鐘點'] === true
  };
  vm.createContext(context);
  vm.runInContext(app.slice(start, end), context, { filename: 'class-teacher-source.js' });
   const list = context.getClassTeacherList({ '班級代碼': '705', '科目代碼': '本土語', '教師姓名': 'TOLD,TOLD2' });
   if (list.length !== 2 || list[0]['教師姓名'] !== 'TMAIN' || list[0]['標籤'] !== '台' || list[1]['標籤'] !== '手') throw new Error('班級課表未採用配課主／協同教師清單');
   const overtimeList = context.getCellTeacherList({ '教師姓名': '[{"教師姓名":"TMAIN","標籤":"台","超鐘點":true},{"教師姓名":"TCO","標籤":"手"}]' });
   if (!overtimeList[0]['超鐘點'] || overtimeList[1]['超鐘點']) throw new Error('教師個別超鐘點標記未分開解析');
   const overtimeJson = JSON.parse(context.serializeTeacherList(overtimeList));
   if (!overtimeJson[0]['超鐘點'] || overtimeJson[1]['超鐘點']) throw new Error('教師個別超鐘點標記序列化錯誤');
   const single = JSON.parse(context.serializeTeacherList([{ '教師姓名': 'TMAIN', '標籤': '台' }]));
  if (single.length !== 1 || single[0]['教師姓名'] !== 'TMAIN' || single[0]['標籤'] !== '台') throw new Error('單一主要教師標籤未序列化保留');
   if (!app.includes("tl.length > 1 || tl.some(item => item['標籤'])")) throw new Error('手動課表寫入仍會遺失單一教師標籤');
});
check('Per-teacher overtime toggle updates only selected teacher', () => {
   const start = app.indexOf('function optimisticSetOvertime');
   const end = app.indexOf('// 5. 樂觀鎖定/解鎖格位', start);
   const cell = {
     '班級代碼': '701', '星期': 1, '節次': 1, '科目代碼': '本土語', '課堂屬性': '一般',
     '教師姓名': JSON.stringify([{ '教師姓名': 'T01', '標籤': '台' }, { '教師姓名': 'T02', '標籤': '手' }])
   };
   const context = {
     idx: { schedByClassSlot: { '701|1|1': cell } },
     state: { schedule: [cell] },
     isManualOnlyPeriod: period => [0, 45].includes(Number(period)),
     getCellTeacherList: value => JSON.parse(value['教師姓名']),
     normalizeTeacherList: list => list.map(item => ({ ...item })),
     serializeTeacherList: list => JSON.stringify(list),
     buildIndex() {}, renderClassTT() {}, renderTeacherTT() {},
     ui: { selectedClass: '', selectedTeacher: '' },
     toast() {},
     gasPost(action, payload) { context.lastOvertimePayload = { action, payload }; return Promise.resolve({ ok: true }); }
   };
   vm.createContext(context);
   vm.runInContext(app.slice(start, end), context, { filename: 'teacher-overtime-toggle.js' });
   context.optimisticSetOvertime('701', 1, 1, 'T01', true);
   const after = JSON.parse(cell['教師姓名']);
   if (!after[0]['超鐘點'] || after[1]['超鐘點'] || cell['課堂屬性'] !== '一般') throw new Error('超鐘點切換仍同時套用所有協同教師');
    if (!context.lastOvertimePayload || context.lastOvertimePayload.payload.teacherCode !== 'T01') throw new Error('超鐘點寫回未帶指定教師');
  });
  check('Single-teacher overtime display uses the schedule attribute', () => {
    const start = app.indexOf('function isTeacherOvertimeItem');
    const end = app.indexOf('function teacherSubjectLabel', start);
    const context = {
      getCellTeacherList: () => [{ '教師姓名': 'T01', '標籤': '' }]
    };
    vm.createContext(context);
    vm.runInContext(app.slice(start, end), context, { filename: 'single-teacher-overtime-display.js' });
    const cell = { '教師姓名': 'T01', '課堂屬性': '超鐘點' };
    if (!context.isOvertimeScheduleEntry(cell, 'T01')) throw new Error('單一教師課堂屬性超鐘點未顯示');
  });
  check('Teacher timetable header shows basic and overtime hours', () => {
  const start = app.indexOf('function renderTeacherTT');
  const end = app.indexOf('// ============================================================\n// 拖曳排課', start);
  const label = { innerHTML: '' };
      const context = {
       idx: {
      teacherByCode: { T01: { '教師姓名': 'T01', '基本鐘點': '2' } },
      assignedWeeklyByTeacher: { T01: 3 },
      scheduledAssignedByTeacher: { T01: 3 }
    },
    getTimetablePane: () => ({ teacherLabel: 'teacher-label', teacherTT: 'teacher-tt' }),
    document: { getElementById: id => id === 'teacher-label' ? label : { innerHTML: '' } },
     parseWeeklyValue: (value, fallback) => value === '' ? fallback : Number(value),
     formatWeeklyValue: value => String(value),
     countTeacherFormalScheduleHours: () => 2,
     renderTeacherSubjectPalette() {},
    makeTable: () => '',
    bindTeacherTTEvents() {},
    ui: {}
  };
  vm.createContext(context);
  vm.runInContext(app.slice(start, end), context, { filename: 'teacher-hours-header.js' });
  context.renderTeacherTT('T01');
   if (!label.innerHTML.includes('基本鐘點 2 節') || !label.innerHTML.includes('超鐘點 0 節')) throw new Error('教師課表標題未採用排除第八節後的超鐘點');
   if (!html.includes('teacher-timetable-subheader') || html.includes('teacher-tt-overtime-btn') || html.includes('openAutomaticOvertimeForSelectedTeacher')) throw new Error('個別教師自動超鐘點按鈕仍存在');
   if (!html.includes('onclick="openAutomaticOvertimeForAll()"') || !html.includes('全部超鐘點')) throw new Error('教師配課區缺少全部超鐘點按鈕');
   if (!app.includes('await loadAll({ background: true })')) throw new Error('自動超鐘點套用後未重新載入最新資料');
 });
check('Subject rule schema migration repairs duplicate class columns', () => {
  const start = backend.indexOf('function ensureSubjectRuleSchema_(sheet)');
  const end = backend.indexOf('function ensureAllSheets_(ss)', start);
  if (start < 0 || end < 0) throw new Error('subject rule schema migration block missing');
  const sheet = {
    rows: [
      ['規則ID', '科目代碼', '年級', '適用班級', '適用班級', '時段', '規則類型', '備註'],
      ['R1', '絲竹室內樂', '全校', '707,807,908', '2-3,2-4', '', '禁排', '']
    ],
    getLastRow() { return this.rows.length; },
    getLastColumn() { return this.rows[0].length; },
    getRange(row, col, numRows, numCols) {
      const range = {
        getDisplayValues: () => this.rows.slice(row - 1, row - 1 + numRows).map(values => values.slice(col - 1, col - 1 + numCols)),
        setValues: values => {
          values.forEach((newRow, rowOffset) => {
            while (this.rows[row - 1 + rowOffset].length < col - 1) this.rows[row - 1 + rowOffset].push('');
            this.rows[row - 1 + rowOffset] = this.rows[row - 1 + rowOffset].slice(0, col - 1).concat(newRow);
          });
        },
        setFontWeight() { return this; },
        setBackground() { return this; }
      };
      return range;
    },
    deleteColumns(startColumn, count) { this.rows.forEach(row => row.splice(startColumn - 1, count)); },
    insertColumnsAfter(afterColumn, count) { this.rows.forEach(row => row.splice(afterColumn, 0, ...new Array(count).fill(''))); },
    setFrozenRows() {}
  };
  const context = { SHEET_DEFS: { '科目規則': { headers: ['規則ID', '科目代碼', '適用年級', '適用班級', '時段', '規則類型', '備註'] } } };
  vm.createContext(context);
  vm.runInContext(backend.slice(start, end), context, {filename:'subject-rule-schema.js'});
  context.ensureSubjectRuleSchema_(sheet);
  const expectedHeader = ['規則ID', '科目代碼', '適用年級', '適用班級', '時段', '規則類型', '備註'];
  if (sheet.rows[0].join('|') !== expectedHeader.join('|')) throw new Error('schema headers were not normalized');
  if (sheet.rows[1].join('|') !== ['R1', '絲竹室內樂', '全校', '707,807,908', '2-3,2-4', '禁排', ''].join('|')) throw new Error('schema migration misplaced existing values');
});
check('Web domain colors and Word export colors stay separate', () => {
  const groupStart = app.indexOf('const SUBJECT_COLOR_GROUPS');
  const groupEnd = app.indexOf('let state =', groupStart);
  const colorStart = app.indexOf('function getSubjectColor(subCode)');
  const colorEnd = app.indexOf('function isSubjectBlockBound', colorStart);
  const resolverStart = app.indexOf('function getRuleSubjectList');
  const resolverEnd = app.indexOf('function makeTable', resolverStart);
  const colorContext = {
    state: { scheduleColors: [] },
    idx: {},
    parseDayNum: value => parseInt(value, 10),
    parseClassCodeList(value) {
      return String(value || '').split(/[,，、;；]/).map(item => item.trim()).filter(Boolean);
    }
  };
  vm.createContext(colorContext);
  vm.runInContext(
    app.slice(groupStart, groupEnd) + app.slice(colorStart, colorEnd) + app.slice(resolverStart, resolverEnd),
    colorContext,
    { filename: 'subject-colors.js' }
  );
  if (colorContext.getSubjectColor('國文').bg !== '#dbeafe') throw new Error('網頁國文領域色未恢復');
  if (colorContext.getSubjectColor('國文輔').bg !== '#dbeafe') throw new Error('網頁輔科目未沿用領域色');
  if (colorContext.getSubjectColor('英語').bg !== '#dcfce7') throw new Error('網頁英語領域色未恢復');
  if (colorContext.getSubjectColor('未分類科目').bg !== '#f1f5f9') throw new Error('網頁其他課程色未恢復');
  if (colorContext.resolveScheduleColor('國文', '701') !== '') throw new Error('Word 未設定規則的課程被錯誤上色');
  colorContext.state.scheduleColors = [{ '科目': '國文', '班級': '', '底色': 'ABCDEF' }];
  if (colorContext.resolveScheduleColor('國文', '701') !== 'ABCDEF') throw new Error('Word 明確科目配色規則未生效');
  if (colorContext.getScheduleCellColor('國文', '701').bg !== '#dbeafe') throw new Error('Word 色碼錯誤覆蓋網頁領域色');
   colorContext.state.scheduleColors = [{ '科目': '本土語', '班級': '701', '底色': 'DEEAF6' }];
   if (colorContext.resolveScheduleColor('本土語', '701') !== 'DEEAF6') throw new Error('Word 班級限定配色規則未生效');
   if (colorContext.resolveScheduleColor('本土語', '702') !== '') throw new Error('Word 班級限定配色錯套其他班級');
   colorContext.state.scheduleColors = [{ '科目': '英語', '班級': '', '底色': 'ABCDEF', '星期': '4', '起始節次': '2', '結束節次': '4' }];
   if (colorContext.resolveScheduleColor('英語', '701', 4, 2) !== 'ABCDEF' || colorContext.resolveScheduleColor('英語', '701', 4, 1) !== '' || colorContext.resolveScheduleColor('英語', '701', 3, 2) !== '') throw new Error('Word 星期與節次範圍配色未生效');
   if (colorContext.resolveScheduleColor('', '701') !== '') throw new Error('Word 空白課表格被錯誤上色');
  if (!app.includes('const SUBJECT_COLOR_GROUPS')) throw new Error('網頁領域固定色票缺少');
  if (html.includes('課表與 Word 匯出預設依科目領域固定配色')) throw new Error('舊的領域配色說明仍存在');
   if (html.includes('D9E2F3') || html.includes('淺藍（二）')) throw new Error('淺藍不應拆成兩個選項');
   for (const marker of ['id="color-day"', 'id="color-period-start"', 'id="color-period-end"', '<th>時段</th>']) if (!html.includes(marker)) throw new Error('配色時段設定欄位缺少：' + marker);
   if (!backend.includes("headers: ['規則ID', '科目', '班級', '底色', '說明', '星期', '起始節次', '結束節次']")) throw new Error('配色 schema 未增加星期與節次範圍');
  for (const hex of ['DEEAF6', 'E2EFD9', 'FBE4D5', 'FFF2CC', 'FFD5D5']) {
    if (!html.includes('value="' + hex + '" style="background-color:#' + hex + ';')) throw new Error('配色選項未顯示對應底色：' + hex);
  }
});
check('Color rule table uses preset names', () => {
  const labelStart = app.indexOf('function getScheduleColorLabel');
  const labelEnd = app.indexOf('function renderColorTable', labelStart);
  const context = { SCHEDULE_COLOR_PRESETS: [{ name: '淺綠', value: 'E2EFD9' }] };
  vm.createContext(context);
  vm.runInContext(app.slice(labelStart, labelEnd), context, { filename: 'color-label.js' });
  if (context.getScheduleColorLabel('E2EFD9') !== '淺綠') throw new Error('預設色未轉為中文名稱');
  if (context.getScheduleColorLabel('ABCDEF') !== '自訂（#ABCDEF）') throw new Error('自訂色顯示格式錯誤');
  if (!app.includes('const colorLabel = getScheduleColorLabel(hex);')) throw new Error('配色規則表未使用中文色名');
});
check('Batch assignment replaces weekly hours, teacher, and notes', () => {
  const helperStart = app.indexOf('function getBatchExistingAssignments');
   const helperEnd = app.indexOf('// 限制設定', helperStart);
   const helperContext = withWeeklyHelpers({
    state: {
      teachers: ['T01', 'T02', 'T03'].map(code => ({'教師姓名': code, '姓名': code})),
      assignments: [
        { '配課ID': 'A1', '班級代碼': '701', '科目代碼': '國文', '教師姓名': 'T01', '每週節數': '2', '備註': '原有備註' },
        { '配課ID': 'A2', '班級代碼': '701', '科目代碼': '國文', '教師姓名': 'T02', '每週節數': '1', '備註': '另一位教師' }
      ]
    },
    idx: {teacherByCode: {}},
    parseTeacherCode: value => String(value || '').trim(),
    formatTeacherCodeName: code => String(code || '').trim(),
     getCellTeacherCodes: cell => String(cell?.['教師姓名'] || '').split(/[,，、;；]/).map(value => value.trim()).filter(Boolean)
   });
  vm.createContext(helperContext);
  vm.runInContext(app.slice(helperStart, helperEnd), helperContext, {filename: 'batch-helpers.js'});
  if (helperContext.getBatchWeeklyHours('', 3) !== 3 || helperContext.getBatchWeeklyHours('2', 3) !== 2) throw new Error('batch weekly hours calculation failed');
  const previewRow = helperContext.makeBatchPreviewRow({ classCode: '701', className: '七年一班', grade: '7', subjectCode: '國文', defaultWeekly: 3 });
  if (previewRow.existingAssignmentId !== 'A1' || previewRow.weeklyHours !== '2' || previewRow.note !== '原有備註') throw new Error('existing assignment values were not loaded for replacement');
  const sameTeacher = helperContext.buildBatchAssignmentPayload({ classCode: '701', subjectCode: '國文', teacherCode: 'T01', defaultWeekly: 3, weeklyHours: '2', note: '替換備註' }, 0);
  if (!sameTeacher.updated || sameTeacher.data['配課ID'] !== 'A1') throw new Error('same-teacher assignment was not updated');
  if (sameTeacher.data['每週節數'] !== '2') throw new Error('same-teacher weekly hours still accumulate');
  if (sameTeacher.data['備註'] !== '替換備註') throw new Error('same-teacher notes still accumulate');
  const changedTeacher = helperContext.buildBatchAssignmentPayload({ classCode: '701', subjectCode: '國文', teacherCode: 'T03', existingAssignmentId: 'A1', defaultWeekly: 3, weeklyHours: '4', note: '教師也替換' }, 1);
  if (!changedTeacher.updated || changedTeacher.data['配課ID'] !== 'A1' || changedTeacher.data['教師姓名'] !== 'T03') throw new Error('existing assignment id did not support direct teacher replacement');
  if (changedTeacher.data['每週節數'] !== '4' || changedTeacher.data['備註'] !== '教師也替換') throw new Error('direct replacement payload is incorrect');
  const coTeacher = helperContext.buildBatchAssignmentPayload({ classCode: '701', subjectCode: '國文', teacherCode: 'T01', coTeacherCode: 'T03', existingAssignmentId: 'A1', defaultWeekly: 3, weeklyHours: '4', note: '含協同教師' }, 2);
  const coTeacherList = JSON.parse(coTeacher.data['教師姓名']);
   if (coTeacherList.length !== 2 || coTeacherList[0]['教師姓名'] !== 'T01' || coTeacherList[0]['標籤'] !== '' || coTeacherList[1]['教師姓名'] !== 'T03' || coTeacherList[1]['標籤'] !== '') throw new Error('batch co-teacher payload is incorrect');
   const taggedCoTeacher = helperContext.buildBatchAssignmentPayload({ classCode: '701', subjectCode: '國文', teacherCode: 'T01', coTeacherCode: 'T03', coTeacherTags: '台', existingAssignmentId: 'A1', defaultWeekly: 3, weeklyHours: '4', note: '本土語標籤' }, 2);
   const taggedList = JSON.parse(taggedCoTeacher.data['教師姓名']);
   if (taggedList[1]['標籤'] !== '台') throw new Error('batch co-teacher language tag was not saved');
  const differentTeacher = helperContext.buildBatchAssignmentPayload({ classCode: '701', subjectCode: '國文', teacherCode: 'T03', defaultWeekly: 3, weeklyHours: '4', note: '第三位教師' }, 2);
  if (differentTeacher.updated || !String(differentTeacher.data['配課ID']).startsWith('BATCH-')) throw new Error('new teacher without an existing row should still create a new assignment');
  if (differentTeacher.data['每週節數'] !== '4' || differentTeacher.data['備註'] !== '第三位教師') throw new Error('new teacher payload is incorrect');
  const blankTeacher = helperContext.buildBatchAssignmentPayload({ classCode: '702', subjectCode: '國文', teacherCode: 'T03', defaultWeekly: 3, weeklyHours: '', note: '第三位教師留白' }, 3);
  if (blankTeacher.updated || blankTeacher.data['每週節數'] !== '') throw new Error('blank weekly hours should remain blank and use the subject default');
  const blankOverride = helperContext.buildBatchAssignmentPayload({ classCode: '701', subjectCode: '國文', teacherCode: 'T03', existingAssignmentId: 'A1', defaultWeekly: 3, weeklyHours: '', note: '留白使用預設' }, 4);
  if (!blankOverride.updated || blankOverride.data['每週節數'] !== '') throw new Error('blank weekly hours should not be written onto an existing assignment');
  helperContext.state.assignments.push({ '配課ID': 'A3', '班級代碼': '702', '科目代碼': '國文', '教師姓名': 'T01', '每週節數': '', '備註': '' });
  const blankPreview = helperContext.makeBatchPreviewRow({ classCode: '702', className: '七年二班', grade: '7', subjectCode: '國文', defaultWeekly: 3 });
  if (blankPreview.weeklyHours !== '' || blankPreview.existingWeekly !== 3) throw new Error('existing blank weekly hours should remain blank while displaying the subject default');
  const executeStart = app.indexOf('async function executeBatchAssign()', helperStart);
  const executeEnd = app.indexOf('// ===== 教師不排課', executeStart);
  const executeBlock = app.slice(executeStart, executeEnd);
  const batchPayloadBuilder = helperContext.buildBatchAssignmentPayload.toString();
  if (!batchPayloadBuilder.includes('getBatchExistingForRow')) throw new Error('batch assignment id lookup missing');
  if (!batchPayloadBuilder.includes("'每週節數': String(weeklyHours)")) throw new Error('weekly hours replacement missing');
  if (!batchPayloadBuilder.includes("'備註': String(row.note || '').trim()")) throw new Error('note replacement missing');
  if (!executeBlock.includes('buildBatchAssignmentPayload')) throw new Error('batch payload builder missing');
  if (!executeBlock.includes('payload.updated')) throw new Error('batch update count missing');
  if (!batchPayloadBuilder.includes('createBatchAssignmentId')) throw new Error('new assignment id missing');
  if (!html.includes('onclick="executeBatchAssign()"')) throw new Error('batch submit button does not call executeBatchAssign');
  if (!app.includes('更新後每週節數')) throw new Error('batch hours label still describes accumulation');
   if (!app.includes('batch-co-teacher-input') || !app.includes('batch-co-teacher-tag-input') || !app.includes('buildBatchTeacherValue')) throw new Error('批次配課協同教師語言欄位缺少');
  if (app.includes('本次新增節數') || app.includes('會累加')) throw new Error('batch UI still exposes accumulation wording');
});

check('Teacher timetable drag preserves source class', () => {
  const dragStart = app.indexOf('function bindTeacherTTEvents');
  const dragEnd = app.indexOf('function renderTeacherTT', dragStart);
  if (dragStart < 0 || dragEnd < 0) throw new Error('teacher timetable drag block missing');
  const dragBlock = app.slice(dragStart, dragEnd);
  const classMarker = "const clsCode = td.dataset.cls || String(cell['班級代碼'] || '');";
  if (!dragBlock.includes(classMarker)) throw new Error('teacher drag source class fallback missing');
  if (!dragBlock.includes('cls: clsCode')) throw new Error('teacher drag does not carry source class');
  const genericDragIndex = dragBlock.indexOf('ui.drag = {', dragBlock.indexOf(classMarker));
  if (genericDragIndex < 0 || dragBlock.indexOf(classMarker) > genericDragIndex) throw new Error('source class is declared after drag state');
});
check('Teacher block table follows teacher order and shows compressed slot hover', () => {
  const tableStart = app.lastIndexOf('function renderBlockTable');
  const tableEnd = app.indexOf('function setSubjectRuleEditMode', tableStart);
  if (tableStart < 0 || tableEnd < 0) throw new Error('teacher block table renderer missing');
  const tableBlock = app.slice(tableStart, tableEnd);
  if (tableBlock.includes('const fullSlots =')) throw new Error('full slot listing must stay removed (use compressed hover)');
  for (const marker of [
    'new Map(state.teachers.map',
    'state.teacherBlocks.map((block, index)',
    'return aOrder - bOrder || a.index - b.index;',
    'class="teacher-block-row"',
    'class="block-slot-summary"',
    "title=\"'+esc(slots)+'\"",
    'compressSlots(slotList).join'
  ]) {
    if (!tableBlock.includes(marker)) throw new Error('teacher block table marker missing: ' + marker);
  }
  const teacherStart = app.indexOf('function renderBlockTeachers');
  const teacherEnd = app.indexOf('// 教師不排課編輯中的可見提示', teacherStart);
  if (teacherStart < 0 || teacherEnd < 0 || !app.slice(teacherStart, teacherEnd).includes('state.teachers.forEach')) {
    throw new Error('teacher picker does not follow teacher list order');
  }
  for (const marker of ['teacherHasBlockSettings', 'teacherBlockRowId', 'focusTeacherBlockRow', 'focusTeacherBlockPicker']) {
    if (!app.includes(marker)) throw new Error('teacher block navigation marker missing: ' + marker);
  }
  if (!app.includes("'teacher-pick-item' + (hasBlock ? ' has-block' : '')")) throw new Error('configured teachers are not highlighted');
  if (!read('style.css').includes('.teacher-block-row.is-focus')) throw new Error('teacher block focus style missing');
});
check('Batch assignment schema keeps existing notes', () => {
  if (!backend.includes("'每週節數', '備註'")) throw new Error('assignment note header missing');
  if (!backend.includes("h === '備註' ? preservedNote : ''")) throw new Error('backend note preservation missing');
});
check('Bind groups reject duplicate teachers and teacher grid shows collisions', () => {
  const autoStart = app.indexOf('async function executeAutoSchedule');
  const autoEnd = app.indexOf('// 全新強大批次配課控制台', autoStart);
  const autoBlock = app.slice(autoStart, autoEnd);
  if (!autoBlock.includes('function getRepeatedTeacherCodes')) throw new Error('bind-group duplicate teacher detector missing');
  if ((autoBlock.match(/getRepeatedTeacherCodes\(roundLsn\)/g) || []).length !== 2) throw new Error('duplicate teacher detector is not used in both bind passes');
  const teacherStart = app.indexOf('function renderTeacherTT');
  const teacherEnd = app.indexOf('// 拖曳排課', teacherStart);
  const teacherBlock = app.slice(teacherStart, teacherEnd);
  const conflictCheck = teacherBlock.indexOf('cells.length > 1');
  const firstCell = teacherBlock.indexOf('const cell = cells[0]');
  if (conflictCheck < 0 || firstCell < 0 || conflictCheck > firstCell) throw new Error('teacher grid still hides collisions behind the first lesson');
   if (!app.includes("td.classList.add('filled', 'conflict')")) throw new Error('partial teacher-cell refresh lacks collision state');
   if (!read('style.css').includes('.tt-cell.conflict')) throw new Error('teacher collision style missing');
   if (!autoBlock.includes('bind-group-weekly-mismatch')) throw new Error('bind-group weekly mismatch failure category missing');
    if (!autoBlock.includes('invalidBindGroups.has(group.__bindParentGroup || group)')) throw new Error('bind-group weekly mismatch gate missing');
   const bindDefinitionStart = autoBlock.indexOf('const bindWeeklyMismatchByKey');
   const bindDefinitionEnd = autoBlock.indexOf('// 同一科目與年級會在候選時段評估中查詢數百次', bindDefinitionStart);
   const bindDefinitionBlock = autoBlock.slice(bindDefinitionStart, bindDefinitionEnd);
   if (!bindDefinitionBlock.includes('groupSubjects.reduce((total, subjectCode)')) throw new Error('bind weekly precheck does not compare class totals');
   if (!bindDefinitionBlock.includes('各班合計每週節數不一致')) throw new Error('bind weekly total mismatch message missing');
   if (bindDefinitionBlock.includes('科目「')) throw new Error('bind weekly precheck still rejects each subject separately');
  });
check('Bind-group pass yields and has finite retry rounds', () => {
  const autoStart = app.indexOf('async function executeAutoSchedule');
  const autoEnd = app.indexOf('// 全新強大批次配課控制台', autoStart);
  const autoBlock = app.slice(autoStart, autoEnd);
  const bindStart = autoBlock.indexOf('async function findAndScheduleBlockGroup');
  const generalStart = autoBlock.indexOf('// 開始進行排課', bindStart);
  if (bindStart < 0 || generalStart < 0) throw new Error('bind-group pass boundaries missing');
  const bindBlock = autoBlock.slice(bindStart, generalStart);
   if (!bindBlock.includes('await yieldToUI();')) throw new Error('initial bind-group pass never yields to UI');
   if (!bindBlock.includes('BIND_GROUP_SLOT_YIELD_INTERVAL')) throw new Error('initial bind-group slot yield guard missing');
    if (!bindBlock.includes('BIND_GROUP_SEARCH_TIME_BUDGET_MS')) throw new Error('bind-group search time budget missing');
    if (!bindBlock.includes('const bindSearchTimeBudgetMs = Math.min(')) throw new Error('adaptive bind-group time budget missing');
   if (!bindBlock.includes('BIND_GROUP_SEARCH_YIELD_INTERVAL')) throw new Error('bind search yield interval missing');
  if (!autoBlock.includes('await findAndScheduleBlockGroup(bindOrder[groupIndex]')) throw new Error('main pass does not await reordered bind groups');
  if (!autoBlock.includes('for (let r = 0; r < retryList.length; r++)')) throw new Error('retry bind-group loop is not finite');
  if (autoBlock.includes('for (let r = 0; ; r++)')) throw new Error('unbounded retry bind-group loop remains');
   if (!autoBlock.includes('const repairSearchWide = autoScheduleTimeBudgetMs >= 180000')) throw new Error('adaptive repair search width missing');
   if (!autoBlock.includes('const AUTO_REPAIR_TARGET_LIMIT = repairSearchWide ? 35 : 18')) throw new Error('augmenting-path target limit missing');
   if (!autoBlock.includes('const AUTO_REPAIR_ONE_HOP_LIMIT = repairSearchWide ? 12 : 6')) throw new Error('augmenting-path hop limit missing');
    if (!autoBlock.includes('const repairBudgetScale = autoScheduleTimeBudgetMs < 60000')) throw new Error('adaptive repair time scale missing');
    if (!autoBlock.includes('const repairOperationBase = Math.max(12000, failList.length * 600)')) throw new Error('adaptive repair operation base missing');
    if (!autoBlock.includes('repairOperationLimit = Math.min(36000, Math.round(repairOperationBase * repairBudgetScale))')) throw new Error('adaptive repair operation budget missing');
    if (!autoBlock.includes('const enableGlobalNeighborhoodRepair = autoScheduleTimeBudgetMs >= 180000')) throw new Error('global repair time reserve missing');
    if (!autoBlock.includes("let repairPhase = 'direct'")) throw new Error('repair phase state missing');
    if (!autoBlock.includes("if (repairPhase !== 'global' && shouldStopAutoSchedule('repair')) return true;")) throw new Error('global repair deadline guard missing');
    if (autoBlock.includes('allowMandatoryCohortExclusive') || autoBlock.includes('allowTeacherExclusiveOverlap')) throw new Error('auto schedule relaxes strict teacher exclusivity');
    if (autoBlock.includes('allowSoftTeacherExclusives: true')) throw new Error('auto quality or writeback relaxes strict teacher exclusivity');
    if (!autoBlock.includes('repairOperationReserve = Math.min(6000, Math.floor(repairOperationLimit * 0.25))')) throw new Error('repair reserve budget missing');
   if (!autoBlock.includes('consumeRepairOperation(true)')) throw new Error('reserved neighborhood repair budget missing');
   if (!autoBlock.includes('if (repairBudgetExceeded) return true;')) throw new Error('repair budget exhaustion guard missing');
    if (!autoBlock.includes('runAutoGlobalNeighborhoodRepair();')) throw new Error('global neighborhood repair is not invoked');
    if (autoBlock.indexOf('runAutoGlobalNeighborhoodRepair();') < autoBlock.indexOf('failList = repairRemain;')) throw new Error('global neighborhood repair runs before direct repair is finalized');
    if (!autoBlock.includes('const NEIGHBORHOOD_NODE_LIMIT = 2500')) throw new Error('neighborhood backtracking limit is missing');
    if (!autoBlock.includes('.slice(0, 8);')) throw new Error('neighborhood target frontier is missing');
    if (!autoBlock.includes('const blockerEntries = new Set()')) throw new Error('blocker-driven neighborhood expansion is missing');
    if (!autoBlock.includes('const destroyedEntries = [...new Set([')) throw new Error('neighborhood blocker union is missing');
    if (!autoBlock.includes('function runAutoGlobalNeighborhoodRepair()')) throw new Error('global neighborhood repair is missing');
    if (!autoBlock.includes('const keyOwners = new Map()')) throw new Error('global repair conflict components are missing');
    if (!autoBlock.includes('globalMatchingPasses++')) throw new Error('global repair metric is missing');
   if (!autoBlock.includes('itemCandidates.sort((left, right)')) throw new Error('neighborhood MRV ordering is missing');
   if (!autoBlock.includes('function tryRepackClassLesson(lesson)')) throw new Error('zero-slack class repack is missing');
    if (!autoBlock.includes('const CLASS_REPACK_NODE_LIMIT = 1500')) throw new Error('class repack node limit is missing');
    if (!autoBlock.includes('function tryConflictGraphLesson(lesson)')) throw new Error('strict conflict graph repair is missing');
    if (!autoBlock.includes('const graphNodeLimit = repairSearchWide ? 6000 : 3000')) throw new Error('conflict graph node limit is missing');
    if (!autoBlock.includes('const nextVisited = new Set(visitedEntries)')) throw new Error('conflict graph visited set is missing');
    if (!autoBlock.includes('const AUTO_REPAIR_MAX_DEPTH = 4')) throw new Error('multi-hop repair depth is missing');
   if (!autoBlock.includes('blockers: toEvict')) throw new Error('multi-blocker relocation candidates are missing');
   if (!autoBlock.includes('for (const blocker of candidate.blockers)')) throw new Error('recursive multi-blocker relocation is missing');
   if (!autoBlock.includes('const isTightClass = autoTightClassCodes.has(String(lesson.classCode || \'\'));')) throw new Error('tight-class repair ordering is missing');
    if (!autoBlock.includes('? (tryConflictGraphLesson(lesson) || tryRepackClassLesson(lesson) || tryAugmentLesson(lesson))')) throw new Error('tight-class repair does not prioritize graph repair');
    if (!autoBlock.includes(': (tryConflictGraphLesson(lesson) || tryAugmentLesson(lesson) || tryRepackClassLesson(lesson))')) throw new Error('general repair does not prioritize graph repair');
   if (autoBlock.includes('function tryRepairPlacement')) throw new Error('unbounded recursive repair path remains');
  if (!autoBlock.includes('isFrozenAutoEntry(entry) || isBindAutoEntry(entry)')) throw new Error('repair path can move frozen or bind-group entries');
  if (!autoBlock.includes("classifyNoLegalSlot(lesson, 'cascade-no-legal-slot')")) throw new Error('final repair failure category missing');
   if (!autoBlock.includes('updateProgress(`第 ${round} 輪綁班群組補配中（第 ${r + 1} 輪）…`);')) throw new Error('retry bind-group progress interpolation missing');
   if (autoBlock.includes("updateProgress('第 ${round} 輪綁班群組補配中")) throw new Error('retry bind-group progress still shows a literal round placeholder');
  if (!autoBlock.includes('const groupScheduleSnapshot = [...localSchedule]')) throw new Error('bind group is not atomic');
  if (!autoBlock.includes('if (!groupSolved) restoreGroupSnapshot();')) throw new Error('failed bind group does not roll back as a whole');
  if (!autoBlock.includes('const unresolvedBindLessons = pendingLessons.filter')) throw new Error('unresolved bind lessons are not collected before general queue');
   if (!autoBlock.includes('const bindFailureLessons = []')) throw new Error('bind failures are not kept separate from general retry queue');
   if (!autoBlock.includes('const bindFailureDiagnostics = new Map()')) throw new Error('bind failure diagnostics are missing');
   if (!autoBlock.includes('directCommonSlots')) throw new Error('bind common-slot diagnostics are missing');
  if (!autoBlock.includes('!getBindGroupClasses(pendingLessons[index].subjectCode, pendingLessons[index].classCode)')) throw new Error('general queue can still consume bind lessons');
});
check('Teacher block save updates rows in place instead of appending', () => {
  const fnStart = backend.indexOf('function saveTeacherBlock_');
  let fnEnd = backend.indexOf('\nfunction ', fnStart + 10);
  if (fnEnd < 0) fnEnd = backend.length;
  if (fnStart < 0) throw new Error('saveTeacherBlock_ missing');
  const fn = backend.slice(fnStart, fnEnd);
  if (fn.includes('sheet.deleteRow(index+2)')) throw new Error('legacy delete-then-append pattern reintroduced');
  if (!fn.includes('sheet.getRange(existingRow, 3).setValue(finalPairs.join(\',\'))')) throw new Error('in-place slot update missing');
  if (!fn.includes("sheet.appendRow([genId_(), tc,")) throw new Error('appendRow must remain only for brand-new teachers');
  const appendIdx = fn.indexOf('sheet.appendRow(');
  const setIdx = fn.indexOf('sheet.getRange(existingRow, 3).setValue');
  if (appendIdx < 0 || setIdx < 0 || setIdx >= appendIdx) throw new Error('in-place update branch must precede appendRow for new rows');
  if (!backend.includes('parseTeacherBlockPairs_(sheet.getRange(existingRow, 3).getValue())')) throw new Error('existing row not read when merging slots');
});
check('Auto-schedule reuses schedule lookup indexes', () => {
  const autoStart = app.indexOf('async function executeAutoSchedule');
  const autoEnd = app.indexOf('// 全新強大批次配課控制台', autoStart);
  const autoBlock = app.slice(autoStart, autoEnd);
   for (const marker of ['function buildScheduleLookup','scheduleLookup.classSlots','scheduleLookup.entriesBySlot','scheduleLookup.teacherSlots','scheduleLookup.teacherDayEntries','scheduleLookup.subjectSlots','scheduleLookup.classSubjectDays','scheduleLookup.roomSlots','const priorityLookup','const lessonLookup','const roundLookup','const tempLookup']) {
     if (!autoBlock.includes(marker)) throw new Error(`schedule lookup marker missing: ${marker}`);
   }
 });
check('Auto-schedule precomputes requirement indexes', () => {
  const helperStart = app.indexOf('function buildAutoScheduleEntriesByClassSubject');
  const helperEnd = app.indexOf('function getGlobalTeacherDropdown', helperStart);
  const helperContext = {
    getAssignmentWeeklyValue: (assignment, subject, fallback) => Number(assignment['每週節數'] || subject?.['每週節數'] || fallback || 0)
  };
  vm.createContext(helperContext);
  vm.runInContext(app.slice(helperStart, helperEnd), helperContext, { filename: 'auto-indexes.js' });
  const scheduleIndex = helperContext.buildAutoScheduleEntriesByClassSubject([
    { '班級代碼': '701', '科目代碼': '國文' },
    { '班級代碼': '701', '科目代碼': '國文' },
    { '班級代碼': '702', '科目代碼': '國文' }
  ]);
  if (scheduleIndex.get('701|國文')?.length !== 2 || scheduleIndex.get('702|國文')?.length !== 1) throw new Error('schedule completion index grouped incorrectly');
  const weeklyIndex = helperContext.buildAutoAssignmentWeeklyIndex([
    { '班級代碼': '701', '科目代碼': '國文', '每週節數': '2' },
    { '班級代碼': '701', '科目代碼': '國文', '每週節數': '0.5' }
  ], { '國文': { '每週節數': '3' } });
  if (weeklyIndex.get('701|國文') !== 2.5) throw new Error('assignment weekly index did not aggregate values');
  const autoStart = app.indexOf('async function executeAutoSchedule');
  const autoEnd = app.indexOf('// 全新強大批次配課控制台', autoStart);
  const autoBlock = app.slice(autoStart, autoEnd);
  if (!autoBlock.includes('const scheduleEntriesByClassSubject = buildAutoScheduleEntriesByClassSubject(scheduleSeed)')) throw new Error('schedule completion index is not used by the engine');
   if (!autoBlock.includes('const assignmentWeeklyByClassSubject = buildAutoAssignmentWeeklyIndex(activeAssignments, idx.subjectByCode)')) throw new Error('bind weekly index is not used by the engine');
});
check('Auto-schedule scores gap and workload improvements', () => {
  const scoreStart = app.indexOf('function evaluateSlotScore');
  const scoreEnd = app.indexOf('// 2.5', scoreStart);
  const scoreBlock = app.slice(scoreStart, scoreEnd);
  if (!scoreBlock.includes('score += gapDelta * 22')) throw new Error('teacher gap delta score missing');
  if (!scoreBlock.includes('projectedStreak === 3')) throw new Error('teacher long-streak penalty missing');
  if (!scoreBlock.includes('period >= 1 && period <= 7')) throw new Error('all-period repetition penalty missing');
  if (!scoreBlock.includes('projectedShare > 0.65')) throw new Error('teacher afternoon concentration penalty missing');
   if (!scoreBlock.includes('score += Math.round(balanceDelta * 14)')) throw new Error('teacher workload balance score missing');
   if (!scoreBlock.includes('const beforePeak = Math.max(...dailyCounts, 0)')) throw new Error('teacher daily peak score missing');
   if (!scoreBlock.includes('projectedDailyExcess')) throw new Error('teacher daily overload score missing');
  if (!scoreBlock.includes("排一不排七") || !scoreBlock.includes("排四不排五") || !scoreBlock.includes("score -= 6")) throw new Error("teacher daily soft rules missing");
  if (!scoreBlock.includes('if (minDiff === 0) score -= 18')) throw new Error('same-day subject concentration penalty missing');
  if (!scoreBlock.includes('lesson.totalWeekly === 1') || !scoreBlock.includes('getAutoClassGrade')) throw new Error('cross-grade same-day soft rule missing');
  if (!scoreBlock.includes('sameGradeDayCounts') || !scoreBlock.includes('score += 18')) throw new Error('cross-grade same-day score is not applied');
  if (!scoreBlock.includes('相鄰節次') || !scoreBlock.includes('adjacentGrades.has(candidateGrade)') || !scoreBlock.includes('score += 12')) throw new Error('cross-grade adjacent soft rule missing');
  const mustConflictStart = app.indexOf('// c. 檢查教師在此時段是否已有其他課程衝堂', scoreEnd);
  const mustConflictEnd = app.indexOf('// 順利排入', mustConflictStart);
  if (app.slice(mustConflictStart, mustConflictEnd).includes("是否鎖定")) throw new Error('mandatory course still ignores non-locked teacher conflicts');
});
check('Auto-schedule uses adaptive priority and hard teacher conflicts', () => {
  const autoStart = app.indexOf('async function executeAutoSchedule');
  const autoEnd = app.indexOf('// 全新強大批次配課控制台', autoStart);
  const autoBlock = app.slice(autoStart, autoEnd);
  if (!autoBlock.includes('weeklyTargetByClassSubject')) throw new Error('class-subject weekly targets missing');
   if (!autoBlock.includes('currentDayCount < (mandatoryDaySlots.length > 1 ? mandatoryDaySlots.length : 1)')) throw new Error('strict daily subject limit missing');
  if (!autoBlock.includes('const lessonQueue = pendingLessons.map')) throw new Error('adaptive lesson queue missing');
  if (!autoBlock.includes('AUTO_QUEUE_REPRIORITIZE_INTERVAL')) throw new Error('adaptive reprioritization interval missing');
  if (!autoBlock.includes('AUTO_PRIORITY_YIELD_INTERVAL')) throw new Error('priority yield interval missing');
  if (!autoBlock.includes('function classifyNoLegalSlot')) throw new Error('unplaced-slot diagnosis missing');
  if (!autoBlock.includes('const estimateBindGroupSlots = group =>')) throw new Error('bind-group difficulty analysis missing');
  if (!autoBlock.includes('const bindDifficulty')) throw new Error('bind-group difficulty cache missing');
  if (!autoBlock.includes('const prioritizedQueue = []')) throw new Error('priority cache missing');
   if (!autoBlock.includes('const availableSlots = countAvailableSlots')) throw new Error('priority availability cache missing');
   if (!autoBlock.includes('dynamicDifficulty: getAutoDynamicDifficulty')) throw new Error('dynamic difficulty cache missing');
   if (!autoBlock.includes('const autoConflictWeights =')) throw new Error('dynamic conflict weights missing');
  if (!autoBlock.includes('function compareGeneralLessonPriority')) throw new Error('teacher constraint priority comparator missing');
  if (!autoBlock.includes('teacherConstraintScore: pendingLessons[lessonIndex].teacherConstraintScore')) throw new Error('teacher constraint score is not cached');
  if (!autoBlock.includes('subjectConstraintScore: pendingLessons[lessonIndex].subjectConstraintScore')) throw new Error('subject constraint score is not cached');
  if (!autoBlock.includes('priorityScore: pendingLessons[lessonIndex].priorityScore')) throw new Error('manual priority score is not cached');
  if (!autoBlock.includes('prioritizedQueue.sort(compareGeneralLessonPriority)')) throw new Error('general queue does not use teacher constraint priority');
  const priorityStart = autoBlock.indexOf('function compareGeneralLessonPriority');
  const priorityEnd = autoBlock.indexOf('const AUTO_QUEUE_REPRIORITIZE_INTERVAL', priorityStart);
  const priorityContext = {};
  vm.createContext(priorityContext);
  vm.runInContext(autoBlock.slice(priorityStart, priorityEnd), priorityContext, { filename: 'general-priority.js' });
  const constrainedFirst = priorityContext.compareGeneralLessonPriority({ teacherConstraintScore: 8, availableSlots: 1, index: 1 }, { teacherConstraintScore: 2, availableSlots: 15, index: 0 });
  if (constrainedFirst >= 0) throw new Error('more constrained teacher is not prioritized first');
  const constrainedSubjectFirst = priorityContext.compareGeneralLessonPriority({ subjectConstraintScore: 8, teacherConstraintScore: 0, availableSlots: 1, index: 1 }, { subjectConstraintScore: 0, teacherConstraintScore: 8, availableSlots: 15, index: 0 });
  if (constrainedSubjectFirst >= 0) throw new Error('more constrained subject is not prioritized first');
   const availabilityTieBreak = priorityContext.compareGeneralLessonPriority({ teacherConstraintScore: 2, availableSlots: 1, index: 1 }, { teacherConstraintScore: 2, availableSlots: 8, index: 0 });
   if (availabilityTieBreak >= 0) throw new Error('available slots are not the primary priority');
   const pressureFirst = priorityContext.compareGeneralLessonPriority({ dynamicDifficulty: 4, availableSlots: 8, index: 1 }, { dynamicDifficulty: 0.5, availableSlots: 1, index: 0 });
   if (pressureFirst >= 0) throw new Error('dynamic conflict pressure is not prioritized');
   if (autoBlock.includes('remainingQueue.sort((left, right) => countAvailableSlots')) throw new Error('priority comparator still recalculates availability');
    if (!autoBlock.includes('teacherDayPeriods')) throw new Error('teacher daily period index missing');
    if (!autoBlock.includes('teacherAutoDayPeriods')) throw new Error('automatic teacher consecutive index missing');
     if (!autoBlock.includes('originalScheduleIds')) throw new Error('automatic baseline schedule identity missing');
     if (!autoBlock.includes('ignoreTeacherConsecutiveIds: originalScheduleIds')) throw new Error('quality audit does not ignore original schedule rows');
      if (autoBlock.includes('ignoreScheduleIds: originalScheduleIds')) throw new Error('quality audit still ignores original manual schedule rows');
     if (!autoBlock.includes('ignoredTeacherConsecutiveIds: originalScheduleIds')) throw new Error('GAS auto write does not ignore original schedule rows');
   if (!autoBlock.includes('teacherStats')) throw new Error('teacher scoring index missing');
   if (!autoBlock.includes('classTeacherDays')) throw new Error('class-teacher day index missing');
   if (!autoBlock.includes('classActiveEntryCounts')) throw new Error('class occupancy index missing');
   if (!autoBlock.includes('prioritizeAutoCandidates')) throw new Error('candidate prioritization helper missing');
   if (!autoBlock.includes('countConsecutiveInLocal(targetSched, teacherToken, day, period, scheduleLookup)')) throw new Error('teacher consecutive lookup not reused');
  if (!autoBlock.includes('autoTeacherExclusivePeers')) throw new Error('teacher exclusive peer index missing');
  if (!autoBlock.includes('教師衝堂與不排課時段都是硬限制')) throw new Error('teacher conflict is not documented as hard constraint');
  if (!autoBlock.includes('const requeuedLessons = []')) throw new Error('mandatory eviction queue missing');
   if (!autoBlock.includes("function isFrozenAutoEntry")) throw new Error("auto frozen helper missing");
   if (!autoBlock.includes("verifyFrozenEntries")) throw new Error("frozen integrity audit missing");
   if (!autoBlock.includes("function restoreFrozenEntries")) throw new Error("frozen entries are not restored before commit");
   if (!autoBlock.includes("if (isFrozenAutoEntry(entry) || isMustPlacedCourse(entry) || isBindAutoEntry(entry)) return;")) throw new Error("frozen entries are still valid swap victims");
  const autoFrozenStart = autoBlock.indexOf("function isFrozenAutoEntry");
  const autoFrozenEnd = autoBlock.indexOf("function isMustPlacedCourse", autoFrozenStart);
  if (autoFrozenEnd > autoFrozenStart && autoBlock.slice(autoFrozenStart, autoFrozenEnd).includes("__isBindGroup")) throw new Error("bind group is still in frozen predicate");
  if (!autoBlock.includes('postEvictionLookup')) throw new Error('mandatory post-eviction validation missing');
   if (autoBlock.includes('allowMandatoryCohortExclusive') || autoBlock.includes('sameMandatoryCohort')) throw new Error('mandatory teacher-exclusion exception remains');
  if (!autoBlock.includes('getAutoTeacherCodes')) throw new Error('multi-teacher normalization missing');
  if (!autoBlock.includes('autoTeacherMatches')) throw new Error('multi-teacher matching missing');
   if (!autoBlock.includes('const randomSeedInput')) throw new Error('random seed input missing');
   if (!autoBlock.includes('nextAutoRandom')) throw new Error('seeded random generator missing');
    if (!autoBlock.includes('const AUTO_RANDOM_TOP_K = optRandomize ? 7 : 3')) throw new Error('random candidate frontier missing');
    if (!autoBlock.includes('const AUTO_RANDOM_SCORE_TOLERANCE = optRandomize ? 8 : 3')) throw new Error('random score tolerance missing');
   if (!autoBlock.includes('const selectAutoCandidate = (candidates, relationLessons = null) =>')) throw new Error('random candidate selector missing');
   if (!autoBlock.includes('tieBreak: autoRandomTieBreak()')) throw new Error('candidate tie-break key missing');
   if (!autoBlock.includes('randomOrder: autoRandomTieBreak()')) throw new Error('lesson tie-break key missing');
   if (autoBlock.includes('score += Math.round((nextAutoRandom() - 0.5) * 8)')) throw new Error('randomness is still injected as uncontrolled score noise');
   if (!html.includes('id="auto-opt-multi-restart"')) throw new Error('multi-restart option is missing');
   if (!app.includes('function compareAutoScheduleResults')) throw new Error('multi-restart result comparator missing');
   if (!app.includes('previewOnly: true')) throw new Error('multi-restart preview mode missing');
    if (!app.includes('const runSpecs = [')) throw new Error('multi-restart seed plan missing');
    if (!app.includes('validCandidates.sort(compareAutoScheduleResults)')) throw new Error('multi-restart does not select the best candidate');
    if (!app.includes("'teacherGaps'")) throw new Error('multi-restart does not compare teacher gaps');
    if (!app.includes("'teacherImbalance'")) throw new Error('multi-restart does not compare workload balance');
   if (!app.includes('const AUTO_MULTI_RESTART_TIME_BUDGET_MS = 240000')) throw new Error('multi-restart time budget missing');
   if (!autoBlock.includes('localScheduleLookupCacheVersion')) throw new Error('incremental schedule lookup cache missing');
   if (!autoBlock.includes('const markLocalScheduleChanged')) throw new Error('schedule mutation invalidation hook missing');
   if (!autoBlock.includes('function analyzeAutoFailureLesson')) throw new Error('failed-lesson constraint graph missing');
   if (!autoBlock.includes('blockerCounts')) throw new Error('failed-lesson blocker summary missing');
   if (!autoBlock.includes('tightSlots')) throw new Error('failed-lesson tight-slot diagnostics missing');
    if (!autoBlock.includes('autoScheduleTimeBudgetMs')) throw new Error('auto-schedule time budget missing');
    if (!autoBlock.includes('shouldStopAutoSchedule')) throw new Error('auto-schedule deadline guard missing');
   if (!autoBlock.includes("'time-budget'")) throw new Error('time-budget failure category missing');
   if (!autoBlock.includes('repairBudgetExceeded')) throw new Error('repair budget diagnostic missing');
   if (!autoBlock.includes('function runAutoNeighborhoodRepair')) throw new Error('neighborhood repair missing');
   if (!autoBlock.includes('neighborhoodRepairMoves')) throw new Error('neighborhood repair metric missing');
  if (!autoBlock.includes('function canPlaceSubjectWithinMaxConsecutiveDays')) throw new Error('subject consecutive-day hard rule helper missing');
  if (!autoBlock.includes('if (!canPlaceSubjectWithinMaxConsecutiveDays(clsCode, subCode, day, targetSched, scheduleLookup)) return false;')) throw new Error('subject consecutive-day hard rule is not enforced');
  if (!autoBlock.includes('isSubjectMaxConsecutiveDaysFeasible')) throw new Error('infeasible subject max-day fallback missing');
  if (!app.includes('function parseSubjectMaxConsecutiveDays')) throw new Error('subject max-day parser missing');
  if (app.includes("sub['最多連日'] || '3'")) throw new Error('blank subject max-day still defaults to 3');
  if (autoBlock.includes('if (!isMustSlotForCourse)')) throw new Error('must-rule course can still bypass teacher conflicts');
   if (!runtime.includes('window.buildAutoScheduleQualityReport')) throw new Error('quality audit helper missing');
 });
check('Auto-schedule preflight reports capacity pressure', () => {
   if (!app.includes('bind-weekly-mismatch|')) throw new Error('bind weekly mismatch preflight missing');
   const preflightStart = app.indexOf('function collectAutoSchedulePreflightIssues');
   const preflightEnd = app.indexOf('// 只有明確寫入同日連續必排節次', preflightStart);
    const context = withWeeklyHelpers({
      console,
      DAYS: ['一', '二', '三', '四', '五'],
      PERIODS: [1, 2, 3, 4, 5, 6, 7, 8],
      isManualOnlyPeriod: period => period === 0 || period === 45,
       isHelperSubjectCode: value => /輔$/i.test(String(value || '').trim()),
      resolveTeacherCodes: value => value ? [String(value)] : [],
     state: {
       subjects: [{ '科目代碼': 'S', '每週節數': '36' }],
       assignments: [{ '班級代碼': '701', '科目代碼': 'S', '教師姓名': 'T1', '每週節數': '36' }],
       classes: [{ '班級代碼': '701', '班級名稱': '七年一班', '年級': '7' }],
       teachers: [{ '教師姓名': 'T1', '姓名': '教師一' }],
       subjectRules: [], subjectRelations: []
     },
     idx: {
       subjectByCode: { S: { '科目代碼': 'S', '每週節數': '36' } },
       classByCode: { '701': { '班級代碼': '701', '班級名稱': '七年一班', '年級': '7' } },
       teacherByCode: { T1: { '教師姓名': 'T1', '姓名': '教師一' } },
       roomByCode: {}, blockSet: new Set()
     }
   });
   context.window = context;
   vm.createContext(context);
   vm.runInContext(app.slice(preflightStart, preflightEnd), context, { filename: 'auto-preflight.js' });
   const issues = context.collectAutoSchedulePreflightIssues();
   if (!issues.some(issue => issue.includes('超過可用容量'))) throw new Error('class capacity bottleneck was not reported');
   if (!context.__lastAutoSchedulePreflight || context.__lastAutoSchedulePreflight.bottlenecks.classes.length === 0) throw new Error('preflight bottleneck summary missing');
 });

check('Mandatory lessons run before bind groups', () => {
  const autoStart = app.indexOf('async function executeAutoSchedule');
  const autoEnd = app.indexOf('// 全新強大批次配課控制台', autoStart);
  const autoBlock = app.slice(autoStart, autoEnd);
  const mandatoryCall = autoBlock.indexOf('scheduleMandatoryLessons();');
  const bindStage = autoBlock.indexOf("updateProgress('第二階段：綁班群組配對中");
  if (mandatoryCall < 0 || bindStage < 0 || mandatoryCall > bindStage) throw new Error('mandatory stage must run before bind stage');
  if (autoBlock.indexOf('scheduleMandatoryLessons();', mandatoryCall + 1) >= 0) throw new Error('mandatory stage must not run again after bind stage');
  if (!autoBlock.includes('state.subjectRules.filter(isMandatoryAutoRule)')) throw new Error('mandatory first stage is not driven by the rule list');
  if (!autoBlock.includes('normalizeAutoSubjectCode') || !autoBlock.includes('normalizeAutoRuleType')) throw new Error('mandatory whitespace tolerance is missing');
  if (autoBlock.includes('autoSubjectCodesMatch')) throw new Error('mandatory stage must not add subject aliases');
  if (!autoBlock.includes('const isMandatoryBindGroup')) throw new Error('mandatory bind groups are not prioritized');
   if (!autoBlock.includes('isMandatoryAutoRule(entry.rule)')) throw new Error('bind candidate validation does not enforce mandatory rules');
 });
check('Multi-restart auto-schedule keeps baseline IDs for cloud write', () => {
  const runStart = app.indexOf('async function executeAutoScheduleRun()');
  const runEnd = app.indexOf('// 全新強大批次配課控制台', runStart);
  const runBlock = app.slice(runStart, runEnd);
  if (!runBlock.includes("const originalScheduleIds = [...new Set((state.schedule || [])")) throw new Error('multi-restart baseline schedule identity missing');
  if (!runBlock.includes('ignoredTeacherConsecutiveIds: originalScheduleIds')) throw new Error('multi-restart write does not preserve baseline schedule identity');
});
check('Auto-schedule performs safe local optimization', () => {
  const autoStart = app.indexOf('async function executeAutoSchedule');
  const autoEnd = app.indexOf('// 全新強大批次配課控制台', autoStart);
  const autoBlock = app.slice(autoStart, autoEnd);
  const optStart = autoBlock.indexOf('async function optimizeAutoScheduleLocally');
  const optEnd = autoBlock.indexOf('// 4. 完成', optStart);
  if (optStart < 0 || optEnd < 0) throw new Error('local optimizer block missing');
  const optBlock = autoBlock.slice(optStart, optEnd);
  for (const marker of [
    'const originalScheduleIds',
    'if (!id || originalScheduleIds.has(id)) return false;',
    "if (isFrozenAutoEntry(entry)) return false;",
    "if (isFrozenAutoEntry(entry)) return false;",
    'if (isFrozenAutoEntry(entry)) return false;',
    'const scorePlacement',
    'const findBestMove',
     'isSlotValid',
     'buildScheduleLookup',
     'const localOptPasses = autoScheduleTimeBudgetMs >= 180000 ? 2 : 1',
     'const maxSwapPairsPerPass',
     'if (optSmartSwap)',
     'const readLocalQuality = schedule =>',
     'const compareLocalQuality = (left, right) =>',
     'if (passQualityBefore && passQualityAfter && compareLocalQuality(passQualityAfter, passQualityBefore) > 0)',
      'const oldGapCost = getTeacherGapCostForEntries(baseSchedule, [entryA, entryB]);',
      'const oldRelationCost = getSubjectRelationViolationCount',
      'if (newRelationCost > oldRelationCost ||',
    'await yieldToUI();'
  ]) {
    if (!optBlock.includes(marker)) throw new Error('local optimizer marker missing: ' + marker);
  }
  if (!autoBlock.includes('await optimizeAutoScheduleLocally();')) throw new Error('local optimizer is not executed');
  if (!autoBlock.includes('localOptimizationMoves')) throw new Error('local optimizer count is not reported');
  if (!autoBlock.includes('const autoScheduleStartedAt = Date.now()')) throw new Error('auto schedule timer start missing');
  if (!autoBlock.includes('formatAutoScheduleElapsed')) throw new Error('auto schedule elapsed formatter missing');
  if (!autoBlock.includes('總用時：')) throw new Error('total elapsed time is not reported');
  if (!app.includes('function evaluateSlotScore(lesson, day, period, includeRandom = true, scheduleLookup = null)')) throw new Error('stable score switch missing');
  const stableOptimizerScore = optBlock.includes('return evaluateSlotScore(lesson, day, period, false);') || optBlock.includes('evaluateSlotScoreOnSchedule(lesson, day, period, baseSchedule, false');
  if (!stableOptimizerScore) throw new Error('local optimizer still uses randomized score');
});
check('Auto-schedule applies locally before background cloud sync', () => {
  const autoStart = app.indexOf('async function executeAutoSchedule');
  const autoEnd = app.indexOf('// 全新強大批次配課控制台', autoStart);
  const autoBlock = app.slice(autoStart, autoEnd);
  const releaseMask = autoBlock.indexOf("showLoading(false);\n  await yieldToUI();");
  const verifyFrozen = autoBlock.indexOf('const frozenViolations = verifyFrozenEntries();');
  const applyLocal = autoBlock.indexOf('state.schedule = localSchedule;');
   const startSync = autoBlock.indexOf("gasPost('batchUpdateSchedule', { schedule: scheduleSnapshot");
  if (releaseMask < 0 || verifyFrozen < 0 || applyLocal < 0 || startSync < 0) throw new Error('background apply markers missing');
  if (!(releaseMask < verifyFrozen && verifyFrozen < applyLocal && applyLocal < startSync)) throw new Error('result application still blocks behind the loading mask');
  if (!app.includes('async function gasPost(action, payload, options = {})')) throw new Error('silent GAS request option missing');
   if (!app.includes("if (!silent) showModal('連線失敗'")) throw new Error('background GAS errors can still open a blocking modal');
   if (!app.includes("gasPost('getAll', {}, { silent: background, retry: false, timeoutMs: 30000 })")) throw new Error('background reload still opens the loading request path');
   if (!autoBlock.includes('baseRevision: state.scheduleRevision')) throw new Error('auto schedule write does not protect against stale snapshots');
   if (!autoBlock.includes('自動排課已寫入資料庫')) throw new Error('auto schedule success is not reported');
    if (!autoBlock.includes('自動排課未寫入資料庫')) throw new Error('auto schedule write failure is not reported');
  });
  check('Auto-schedule serializes revision-sensitive writes', () => {
   if (!app.includes('const SCHEDULE_WRITE_ACTIONS = new Set([')) throw new Error('schedule write tracker missing');
   if (!app.includes('function waitForPendingScheduleWrites()')) throw new Error('pending schedule write wait missing');
   if (!app.includes('if (tracksScheduleWrite && result && result.ok !== false) applyScheduleRevisionResponse(result);')) throw new Error('schedule revision response is not applied centrally');
   if (!app.includes('let _autoSchedulePromise = null;')) throw new Error('auto schedule single-flight guard missing');
   if (!app.includes("toast('自動排課正在執行中，請稍候。', 'info');")) throw new Error('duplicate auto schedule feedback missing');
   if (!app.includes('async function executeAutoScheduleRun()')) throw new Error('auto schedule guarded runner missing');
    if (!app.includes('await waitForPendingScheduleWrites();')) throw new Error('auto schedule does not wait for pending writes');
  });
 check('Background sync prevents stale responses from rolling back local changes', () => {
   if (!app.includes('let _gasRequestTail = Promise.resolve();')) throw new Error('GAS write queue missing');
   if (!app.includes("const shouldQueue = action === 'getAll' || MUTATING_GAS_ACTIONS.has(action);")) throw new Error('background request queue is not applied to reads and writes');
   if (!app.includes('const requestMutationVersion = _localMutationVersion > mutationVersionBeforeRequest')) throw new Error('background request mutation version missing');
   if (!app.includes('if (requestMutationVersion !== _localMutationVersion)')) throw new Error('stale background failure guard missing');
   if (!app.includes('function requestBackgroundReconcile()')) throw new Error('stale background failure reconcile missing');
   const loadStart = app.indexOf('async function loadAll');
   const loadEnd = app.indexOf('function applyData', loadStart);
   if (!app.slice(loadStart, loadEnd).includes('requestMutationVersion !== _localMutationVersion')) throw new Error('stale load response guard missing');
 });
  check('Teacher no-class updates stay behind the loading mask', () => {
  const start = app.indexOf('function toggleTeacherBlockSlot');
  const end = app.indexOf('function renderBlockSlotGrid', start);
  const block = app.slice(start, end);
  if (!block.includes("gasPost('saveTeacherBlock'")) throw new Error('teacher block save path missing');
  if (!block.includes('{ silent: true }')) throw new Error('teacher block save is not silent');
  if (!block.includes('loadAll({ background: true })')) throw new Error('teacher block refresh still opens the loading mask');
  if (block.includes('.then(() => loadAll())')) throw new Error('teacher block refresh still uses blocking loadAll');
});
check('Auto-schedule candidate rules are cached', () => {
  const autoStart = app.indexOf('async function executeAutoSchedule');
  const slotStart = app.indexOf('function isSlotValid', autoStart);
  const candidateEnd = app.indexOf('// 2.5', slotStart);
  const candidateBlock = app.slice(slotStart, candidateEnd);
  if (!app.slice(autoStart, slotStart).includes('const applicableRuleCache = new Map()')) throw new Error('applicable rule cache missing');
  if (!app.slice(autoStart, slotStart).includes('const autoTeacherCodesCache = new Map()')) throw new Error('teacher code cache missing');
  if (!app.slice(autoStart, slotStart).includes('const autoTeacherIdentityCache = new Map()')) throw new Error('teacher identity cache missing');
  if (candidateBlock.includes('state.subjectRules.filter')) throw new Error('candidate evaluation still scans all subject rules');
  if (!app.slice(autoStart, slotStart).includes('idx.schedByTeacherSlot[tk]')) throw new Error('initial teacher-slot lookup is not indexed');
});
 check('Helper subjects use a trailing 輔 marker', () => {
  const helperStart = app.indexOf('const isHelperSubject =', app.indexOf('async function executeAutoSchedule'));
  const helperEnd = app.indexOf(';', helperStart);
  const slotStart = app.indexOf('const isHelper =', helperEnd);
  const slotEnd = app.indexOf(';', slotStart);
  const helpers = app.slice(helperStart, helperEnd) + app.slice(slotStart, slotEnd);
   if ((helpers.match(/endsWith\('輔'\)/g) || []).length !== 2) throw new Error('trailing helper marker is not used consistently');
   if (helpers.includes('includes(')) throw new Error('helper detection still uses an includes marker');
});
 check('Auto-schedule completion counts each teacher assignment', () => {
   const marker = "const existingCount = (scheduleEntriesByClassSubject.get(classSubjectKey) || [])";
  const start = app.indexOf(marker, app.indexOf('async function executeAutoSchedule'));
  const end = app.indexOf('const remainingNeeded', start);
  if (start < 0 || end < 0) throw new Error('auto-schedule count block not found');
  const countBlock = app.slice(start, end);
   if (!countBlock.includes('autoTeacherMatches(entry, teacherCode)')) throw new Error('multi-teacher matching is missing from assignment completion count');
  if (!app.includes('配課項目（班級＋科目＋教師）')) throw new Error('completion message does not explain the matching scope');
});
check('Tab render cache and optimized panels', () => {
  let constraintRenders = 0, legacyConfigRenders = 0, configParts = 0;
  const elements = {
    'stats-summary':{innerHTML:''}, 'stats-teacher-tbody':{innerHTML:''}, 'stats-class-tbody':{innerHTML:''}
  };
   const context = withWeeklyHelpers({
    console,
    state:{
       teachers:[{'教師姓名':'T1','姓名':'王師','基本鐘點':'2'},{'教師姓名':'T2','姓名':'協同師','基本鐘點':'2'}],
       classes:[{'班級代碼':'701','班級名稱':'七一'}], subjects:[{'科目代碼':'國文','每週節數':'3'}],
       assignments:[{'配課ID':'A1','教師姓名':'[{"教師姓名":"T1","標籤":"主"},{"教師姓名":"T2","標籤":"協同"}]','班級代碼':'701','科目代碼':'國文'}],
       schedule:[{'教師姓名':'T1','班級代碼':'701','科目代碼':'國文','星期':'1','節次':'1'}], blockGroups:[], subjectRules:[], subjectRelations:[]
     }, idx:{teacherByCode:{T1:{'教師姓名':'T1','姓名':'王師'}},classByCode:{'701':{'班級代碼':'701','年級':'7'}},subjectByCode:{'國文':{'科目代碼':'國文','每週節數':'3'}},blockSet:new Set()}, ui:{},
    document:{getElementById:id=>elements[id]||null,querySelectorAll:()=>[],querySelector:()=>({dataset:{tab:'timetable'}})},
    setTimeout:callback=>callback(), requestAnimationFrame:callback=>callback(),
    buildIndex(){},classTeacherLabel(){},renderTeacherConfigList(){},getTeacherHomeroom(){return ''},
     getCellTeacherCodes(cell){
       const raw = String(cell?.['教師姓名'] || '').trim();
       if (raw.startsWith('[')) return JSON.parse(raw).map(item => item['教師姓名']);
       return raw ? [raw] : [];
     },
    teacherHomeroomOptions(){return ''},teacherHomeroomLabel(){return ''},esc:value=>String(value||''),
    parseTeacherCode:value=>value,DAY_NAMES:[],editAssignment(){},renderConfigTab(){},
    __renderConfigTabInlineTeachers(){legacyConfigRenders++},
    renderClassConfigList(){configParts++},renderSubjectConfigList(){configParts++},
    renderTeacherSubjectBoxes(){configParts++},renderBindGroupTab(){},editBindGroup(){},renderStatsTab(){},
    renderConstraintsTab(){constraintRenders++},renderAll(){},renderClassSelect(){},renderTeacherSelect(){},
    renderClassTT(){},renderTeacherTT(){},applyData(){},gasPost:async()=>({ok:true}),loadAll:async()=>{},toast(){},
     updateAsgnSubjectOptions(){},getRuleDaysPeriods(){return []},
     getSubjectRelationCodes(rule){return [String(rule['科目A']||''),String(rule['科目B']||'')].filter(Boolean)},
      subjectRelationAppliesToClass(rule,classCode,grade){const classes=String(rule['適用班級']||'').split(/[,，、]/).map(item=>item.trim()).filter(Boolean);const ruleGrade=String(rule['適用年級']||'全校');return (ruleGrade===''||ruleGrade==='全校'||ruleGrade===String(grade))&&(!classes.length||classes.includes(String(classCode)));}
   });
  context.window = context;
  vm.createContext(context);
  vm.runInContext(runtime, context, {filename:'app-runtime.js'});
  context.buildIndex();
   context.idx.roomByCode = {R1:{'容量':'1'}};
   context.idx.subjectByCode['國文']['所屬教室代碼'] = 'R1';
   if (context.idx.assignmentsByTeacher.T1?.length !== 1) throw new Error('teacher assignment index missing');
   if (context.idx.assignmentsByTeacher.T2?.length !== 1) throw new Error('co-teacher assignment index missing');
  if (context.idx.assignmentsByClass['701']?.length !== 1) throw new Error('class assignment index missing');
  if (context.idx.scheduleCountByTeacherClassSubject['T1|701|'] !== undefined) throw new Error('empty subject was indexed');
  if (context.idx.scheduleCountByTeacher.T1 !== 1 || context.idx.scheduleCountByClass['701'] !== 1) throw new Error('schedule totals index invalid');
   if (context.idx.assignedWeeklyByTeacher.T1 !== 3 || context.idx.assignedWeeklyByTeacher.T2 !== 3 || context.idx.scheduledAssignedByTeacher.T1 !== 1) throw new Error('teacher assignment totals index invalid');
   const quality = context.buildAutoScheduleQualityReport({schedule:context.state.schedule,optP8Only:false,autoEndPeriod:7});
   if (quality.remainingLessons !== 2 || quality.violations.length !== 0) throw new Error('quality report totals invalid');
   context.state.subjectRelations = [{'規則ID':'REL1','科目A':'國文','科目B':'數學','適用年級':'7','適用班級':''}];
   const relationQuality = context.buildAutoScheduleQualityReport({schedule:[
     {'教師姓名':'T1','班級代碼':'701','科目代碼':'國文','星期':'2','節次':'1'},
     {'教師姓名':'T1','班級代碼':'701','科目代碼':'數學','星期':'2','節次':'2'}
   ],optP8Only:false,autoEndPeriod:7});
   if (relationQuality.subjectRelationSoftViolations !== 1 || relationQuality.violations.some(message => message.includes('科目關係同日'))) throw new Error('subject relation quality report is not soft-only');
   const conflictQuality = context.buildAutoScheduleQualityReport({schedule:[{'教師姓名':'T1','班級代碼':'701','科目代碼':'國文','星期':'3','節次':'2'},{'教師姓名':'T1','班級代碼':'702','科目代碼':'國文','星期':'3','節次':'2'}],optP8Only:false,autoEndPeriod:7});
  const conflictMessage = conflictQuality.violations.find(message => message.includes('教師衝堂'));
   if (!conflictMessage || !conflictMessage.includes('國文（701）') || !conflictMessage.includes('國文（702）')) throw new Error('teacher conflict details missing');
   if (!conflictQuality.violations.some(message => message.includes('教室衝突'))) throw new Error('room capacity conflict was not audited');
   const ignoredManualQuality = context.buildAutoScheduleQualityReport({schedule:[
     {'課表ID':'BASE1','教師姓名':'T1','班級代碼':'701','科目代碼':'國文','星期':'3','節次':'2'},
     {'課表ID':'BASE2','教師姓名':'T1','班級代碼':'701','科目代碼':'國文','星期':'3','節次':'2'}
   ],optP8Only:false,autoEndPeriod:7,ignoreScheduleIds:['BASE1','BASE2']});
   if (ignoredManualQuality.violations.length !== 0 || ignoredManualQuality.remainingLessons !== 1) throw new Error('original manual schedule rows were not excluded from candidate audit');
   const specialPeriodQuality = context.buildAutoScheduleQualityReport({schedule:[
     {'教師姓名':'T1','班級代碼':'701','科目代碼':'國文','星期':'1','節次':'0'},
     {'教師姓名':'T1','班級代碼':'701','科目代碼':'國文','星期':'2','節次':'45'}
   ],optP8Only:false,autoEndPeriod:7});
   if (specialPeriodQuality.remainingLessons !== 1 || specialPeriodQuality.violations.length !== 0) throw new Error('early study and lunch lessons were not counted as scheduled');
   const alternateWeekP8Quality = context.buildAutoScheduleQualityReport({schedule:[
      {'教師姓名':'T1','班級代碼':'701','科目代碼':'課輔','星期':'4','節次':'8','課堂屬性':'單週'},
      {'教師姓名':'T1','班級代碼':'701','科目代碼':'課輔','星期':'4','節次':'8','課堂屬性':'雙週'}
   ],optP8Only:true,autoEndPeriod:8});
   if (alternateWeekP8Quality.violations.some(message => message.includes('班級衝堂') || message.includes('教師衝堂'))) throw new Error('single and double week P8 lessons were treated as a conflict');
   const excludedP8Quality = context.buildAutoScheduleQualityReport({schedule:[
      {'教師姓名':'T1','班級代碼':'701','科目代碼':'課輔','星期':'4','節次':'8','課堂屬性':'單週'},
      {'教師姓名':'T1','班級代碼':'701','科目代碼':'課輔','星期':'4','節次':'8','課堂屬性':'雙週'}
   ],optP8Only:false,autoEndPeriod:7});
   if (excludedP8Quality.violations.length !== 0) throw new Error('P8 lessons were audited during a 1-7 period run');
   const lockedCohortQuality = context.buildAutoScheduleQualityReport({schedule:[
    {'教師姓名':'T1','班級代碼':'701','科目代碼':'本土語','星期':'4','節次':'2','是否鎖定':'TRUE'},
    {'教師姓名':'T1','班級代碼':'702','科目代碼':'本土語','星期':'4','節次':'2','是否鎖定':'TRUE'}
  ],optP8Only:false,autoEndPeriod:7});
  if (lockedCohortQuality.violations.some(message => message.includes('教師衝堂'))) throw new Error('locked same-subject cohort was reported as a teacher conflict');
  context.state.blockGroups = [{'群組ID':'BG_NATIVE','群組名稱':'本土語併班','班級清單':'701,702','科目清單':'本土語'}];
  const configuredCombinedQuality = context.buildAutoScheduleQualityReport({schedule:[
    {'教師姓名':'T1','班級代碼':'701','科目代碼':'本土語','星期':'4','節次':'2'},
    {'教師姓名':'T1','班級代碼':'702','科目代碼':'本土語','星期':'4','節次':'2'}
  ],optP8Only:false,autoEndPeriod:7});
  if (configuredCombinedQuality.violations.some(message => message.includes('教師衝堂'))) throw new Error('configured same-subject bind cohort was reported as a teacher conflict');
  const trueNativeConflictQuality = context.buildAutoScheduleQualityReport({schedule:[
    {'教師姓名':'T1','班級代碼':'701','科目代碼':'本土語','星期':'4','節次':'2'},
    {'教師姓名':'T1','班級代碼':'703','科目代碼':'本土語','星期':'4','節次':'2'}
  ],optP8Only:false,autoEndPeriod:7});
  if (!trueNativeConflictQuality.violations.some(message => message.includes('教師衝堂'))) throw new Error('non-bind same-subject teacher conflict was suppressed');
  const mixedSubjectConflictQuality = context.buildAutoScheduleQualityReport({schedule:[
    {'教師姓名':'T1','班級代碼':'701','科目代碼':'本土語','星期':'4','節次':'2'},
    {'教師姓名':'T1','班級代碼':'702','科目代碼':'國文','星期':'4','節次':'2'}
  ],optP8Only:false,autoEndPeriod:7});
  if (!mixedSubjectConflictQuality.violations.some(message => message.includes('教師衝堂'))) throw new Error('different-subject teacher conflict was suppressed');
  context.state.blockGroups = [{'群組ID':'BG1','群組名稱':'七年級英語綁班','班級清單':'701,702,703','科目清單':'英語'}];
  const bindMismatchQuality = context.buildAutoScheduleQualityReport({schedule:[
    {'教師姓名':'T1','班級代碼':'701','科目代碼':'英語','星期':'2','節次':'2'},
    {'教師姓名':'T2','班級代碼':'702','科目代碼':'英語','星期':'2','節次':'2'},
    {'教師姓名':'T3','班級代碼':'703','科目代碼':'英語','星期':'3','節次':'2'}
  ],optP8Only:false,autoEndPeriod:7});
  if (!bindMismatchQuality.violations.some(message => message.includes('綁班不同步'))) throw new Error('bind-group mismatch was not audited');
  const bindAlignedQuality = context.buildAutoScheduleQualityReport({schedule:[
    {'教師姓名':'T1','班級代碼':'701','科目代碼':'英語','星期':'2','節次':'2'},
    {'教師姓名':'T2','班級代碼':'702','科目代碼':'英語','星期':'2','節次':'2'},
    {'教師姓名':'T3','班級代碼':'703','科目代碼':'英語','星期':'2','節次':'2'}
  ],optP8Only:false,autoEndPeriod:7});
  if (bindAlignedQuality.violations.some(message => message.includes('綁班不同步'))) throw new Error('aligned bind group was reported as mismatched');
  context.state.blockGroups = [];
  const duplicateDayQuality = context.buildAutoScheduleQualityReport({schedule:[{'教師姓名':'T1','班級代碼':'701','科目代碼':'國文','星期':'2','節次':'6'},{'教師姓名':'T1','班級代碼':'701','科目代碼':'國文','星期':'2','節次':'7'}],optP8Only:false,autoEndPeriod:7});
   const strictDuplicateDayQuality = context.buildAutoScheduleQualityReport({schedule:[{'教師姓名':'T1','班級代碼':'701','科目代碼':'國文','星期':'2','節次':'6'},{'教師姓名':'T1','班級代碼':'701','科目代碼':'國文','星期':'2','節次':'7'}],optP8Only:false,autoEndPeriod:7,onePerDay:false});
   if (!strictDuplicateDayQuality.violations.some(message => message.includes('同班同科同日重複'))) throw new Error('same-day duplicate remained allowed by quality audit option');
   if (!duplicateDayQuality.violations.some(message => message.includes('同班同科同日重複'))) throw new Error('same class-subject daily duplicate was not audited');
   const mandatoryHelperStart = app.indexOf('function parseDayNum');
   const mandatoryHelperEnd = app.indexOf('function compressSlots', mandatoryHelperStart);
   vm.runInContext(app.slice(mandatoryHelperStart, mandatoryHelperEnd), context, {filename:'runtime-mandatory-rule.js'});
   context.state.subjectRules = [{'科目代碼':'絲竹室內樂','適用年級':'全校','適用班級':'','規則類型':'必排','時段':'2-3,2-4'}];
   const allowedDoublePeriodQuality = context.buildAutoScheduleQualityReport({schedule:[
     {'教師姓名':'T1','班級代碼':'701','科目代碼':'絲竹室內樂','星期':'2','節次':'3'},
     {'教師姓名':'T1','班級代碼':'701','科目代碼':'絲竹室內樂','星期':'2','節次':'4'}
   ],optP8Only:false,autoEndPeriod:7});
   if (allowedDoublePeriodQuality.violations.some(message => message.includes('同班同科同日重複'))) throw new Error('configured mandatory double period was rejected by quality audit');
   const wrongDoublePeriodQuality = context.buildAutoScheduleQualityReport({schedule:[
     {'教師姓名':'T1','班級代碼':'701','科目代碼':'絲竹室內樂','星期':'2','節次':'3'},
     {'教師姓名':'T1','班級代碼':'701','科目代碼':'絲竹室內樂','星期':'2','節次':'5'}
   ],optP8Only:false,autoEndPeriod:7});
    if (!wrongDoublePeriodQuality.violations.some(message => message.includes('同班同科同日重複'))) throw new Error('non-contiguous mandatory double period was accepted');
    const lockedDoublePeriodQuality = context.buildAutoScheduleQualityReport({schedule:[
      {'教師姓名':'T1','班級代碼':'701','科目代碼':'絲竹室內樂','星期':'2','節次':'3','是否鎖定':'TRUE'},
      {'教師姓名':'T1','班級代碼':'701','科目代碼':'絲竹室內樂','星期':'2','節次':'4','是否鎖定':'FALSE'}
    ],optP8Only:false,autoEndPeriod:7});
    if (lockedDoublePeriodQuality.violations.some(message => message.includes('同班同科同日重複'))) throw new Error('locked consecutive course was included in the hard quality audit');
    context.state.subjectRules = [];
    const longStreakQuality = context.buildAutoScheduleQualityReport({schedule:[{'教師姓名':'T1','班級代碼':'701','科目代碼':'國文','星期':'1','節次':'2'},{'教師姓名':'T1','班級代碼':'702','科目代碼':'視覺藝術','星期':'1','節次':'3'},{'教師姓名':'T1','班級代碼':'703','科目代碼':'音樂','星期':'1','節次':'4'}],optP8Only:false,autoEndPeriod:7});
   if (longStreakQuality.teacherLongStreaks !== 1) throw new Error('teacher three-period streak was not scored');
   context.state.teachers[0]['最大連堂節數'] = '3';
   context.idx.teacherByCode.T1['最大連堂節數'] = '3';
   const configuredStreakQuality = context.buildAutoScheduleQualityReport({schedule:[{'教師姓名':'T1','班級代碼':'701','科目代碼':'國文','星期':'1','節次':'2'},{'教師姓名':'T1','班級代碼':'702','科目代碼':'視覺藝術','星期':'1','節次':'3'},{'教師姓名':'T1','班級代碼':'703','科目代碼':'音樂','星期':'1','節次':'4'}],optP8Only:false,autoEndPeriod:7});
   if (configuredStreakQuality.teacherLongStreaks !== 0) throw new Error('teacher-specific consecutive limit was ignored');
   context.state.teachers[0]['最大連堂節數'] = '2';
   context.idx.teacherByCode.T1['最大連堂節數'] = '2';
   const duplicateTeacherSlotQuality = context.buildAutoScheduleQualityReport({schedule:[
     {'教師姓名':'T1','班級代碼':'701','科目代碼':'國文','星期':'1','節次':'2'},
     {'教師姓名':'T1','班級代碼':'702','科目代碼':'視覺藝術','星期':'1','節次':'2'},
     {'教師姓名':'T1','班級代碼':'703','科目代碼':'音樂','星期':'2','節次':'2'}
   ],optP8Only:false,autoEndPeriod:7});
   if (duplicateTeacherSlotQuality.teacherImbalance !== 1) throw new Error('same-slot teacher workload was counted more than once');
  const repeatedPeriodQuality = context.buildAutoScheduleQualityReport({schedule:[1,2,3,4].map((day,index)=>({'教師姓名':'T1','班級代碼':String(701+index),'科目代碼':'視覺藝術','星期':String(day),'節次':'6'})),optP8Only:false,autoEndPeriod:7});
  if (repeatedPeriodQuality.teacherRepeatedPeriods !== 1) throw new Error('repeated teacher period was not scored');
  const softPairQuality = context.buildAutoScheduleQualityReport({schedule:[
    {"教師姓名":"T1","班級代碼":"701","科目代碼":"國文","星期":"1","節次":"1"},
    {"教師姓名":"T1","班級代碼":"702","科目代碼":"國文","星期":"1","節次":"7"},
    {"教師姓名":"T1","班級代碼":"703","科目代碼":"國文","星期":"2","節次":"4"},
    {"教師姓名":"T1","班級代碼":"704","科目代碼":"國文","星期":"2","節次":"5"}
  ],optP8Only:false,autoEndPeriod:7});
  if (softPairQuality.teacherPairSoftViolations !== 2) throw new Error("teacher daily soft pair rules were not audited");
  context.idx.classByCode['702'] = {'班級代碼':'702','年級':'7'};
  context.idx.classByCode['703'] = {'班級代碼':'703','年級':'7'};
  context.idx.classByCode['801'] = {'班級代碼':'801','年級':'8'};
  context.idx.classByCode['802'] = {'班級代碼':'802','年級':'8'};
  context.state.assignments.push(
    {'配課ID':'A2','教師姓名':'T1','班級代碼':'702','科目代碼':'國文','每週節數':'1'},
    {'配課ID':'A3','教師姓名':'T1','班級代碼':'703','科目代碼':'國文','每週節數':'1'},
    {'配課ID':'A4','教師姓名':'T1','班級代碼':'801','科目代碼':'國文','每週節數':'1'},
    {'配課ID':'A5','教師姓名':'T1','班級代碼':'802','科目代碼':'國文','每週節數':'1'}
  );
  const crossGradeQuality = context.buildAutoScheduleQualityReport({schedule:[
    {'教師姓名':'T1','班級代碼':'702','科目代碼':'國文','星期':'1','節次':'2'},
    {'教師姓名':'T1','班級代碼':'703','科目代碼':'國文','星期':'2','節次':'2'},
    {'教師姓名':'T1','班級代碼':'801','科目代碼':'國文','星期':'3','節次':'2'}
  ],optP8Only:false,autoEndPeriod:7});
  if (crossGradeQuality.teacherCrossGradeSameDay !== 1) throw new Error('cross-grade same-day dispersion was not audited');
  const crossGradeAdjacentQuality = context.buildAutoScheduleQualityReport({schedule:[
    {'教師姓名':'T1','班級代碼':'702','科目代碼':'國文','星期':'1','節次':'1'},
    {'教師姓名':'T1','班級代碼':'801','科目代碼':'國文','星期':'1','節次':'2'},
    {'教師姓名':'T1','班級代碼':'703','科目代碼':'國文','星期':'1','節次':'3'},
    {'教師姓名':'T1','班級代碼':'802','科目代碼':'國文','星期':'1','節次':'4'}
  ],optP8Only:false,autoEndPeriod:7});
  if (crossGradeAdjacentQuality.teacherCrossGradeAdjacent !== 3) throw new Error('cross-grade adjacent dispersion was not audited');
  context.idx.subjectByCode['體育'] = {'最多連日':'1'};
  const maxConsecutiveQuality = context.buildAutoScheduleQualityReport({schedule:[
    {'教師姓名':'T1','班級代碼':'701','科目代碼':'體育','星期':'1','節次':'2'},
    {'教師姓名':'T1','班級代碼':'701','科目代碼':'體育','星期':'2','節次':'3'}
  ],optP8Only:false,autoEndPeriod:7});
  if (maxConsecutiveQuality.subjectMaxConsecutiveDays !== 1 || !maxConsecutiveQuality.violations.some(message => message.includes('科目連日超限'))) throw new Error('subject maximum consecutive days was not audited');
  context.idx.subjectByCode['國文']['最多連日'] = '';
  const blankMaxDaysQuality = context.buildAutoScheduleQualityReport({schedule:[1,2,3,4,5].map((day,index)=>({'教師姓名':'T1','班級代碼':'701','科目代碼':'國文','星期':String(day),'節次':String(index+1)})),optP8Only:false,autoEndPeriod:7});
   if (blankMaxDaysQuality.subjectMaxConsecutiveDays !== 0 || blankMaxDaysQuality.violations.some(message => message.includes('科目連日超限'))) throw new Error('blank subject max-day should be unrestricted');
   context.idx.teacherByCode.T1['最大連堂節數'] = '1';
    const hardConsecutiveQuality = context.buildAutoScheduleQualityReport({schedule:[
      {'教師姓名':'T1','班級代碼':'701','科目代碼':'國文','星期':'1','節次':'2'},
      {'教師姓名':'T1','班級代碼':'702','科目代碼':'視覺藝術','星期':'1','節次':'3'}
    ],optP8Only:false,autoEndPeriod:7});
    if (!hardConsecutiveQuality.violations.some(message => message.includes('教師連堂超限'))) throw new Error('teacher maximum consecutive limit was not audited');
    const ignoredExistingConsecutiveQuality = context.buildAutoScheduleQualityReport({schedule:[
      {'課表ID':'BASE1','教師姓名':'T1','班級代碼':'701','科目代碼':'國文','星期':'1','節次':'2'},
      {'課表ID':'BASE2','教師姓名':'T1','班級代碼':'702','科目代碼':'視覺藝術','星期':'1','節次':'3'}
    ],optP8Only:false,autoEndPeriod:7,ignoreTeacherConsecutiveIds:['BASE1','BASE2']});
    if (ignoredExistingConsecutiveQuality.violations.some(message => message.includes('教師連堂超限'))) throw new Error('existing schedule rows were still checked by quality audit');
   for (let index=0; index<100; index++) context.renderTabIfNeeded('constraints');
  if (constraintRenders !== 1) throw new Error(`same revision rendered ${constraintRenders} times`);
  context.renderTabIfNeeded('config');
  if (legacyConfigRenders !== 0) throw new Error('legacy config renderer was called');
  if (configParts !== 1) throw new Error(`config parts rendered ${configParts} times`);
  if (!runtime.includes('window.renderClassConfigList = ')) throw new Error('optimized class config panel renderer missing');
  if (!runtime.includes('window.renderTeacherSubjectBoxes = ')) throw new Error('optimized teacher subject boxes renderer missing');
  context.renderTabIfNeeded('stats');
  if (!elements['stats-summary'].innerHTML.includes('排課進度')) throw new Error('stats summary missing');
  if (!elements['stats-teacher-tbody'].innerHTML.includes('王師')) throw new Error('teacher stats missing');
  if (!elements['stats-teacher-tbody'].innerHTML.includes('>2<')) throw new Error('teacher remaining count missing');
  context.applyData({});
  context.renderTabIfNeeded('constraints');
  if (constraintRenders !== 2) throw new Error('new data revision was not rendered');
});

check('Global context-menu listener is unique', () => {
  const signature = "document.addEventListener('click', () => { document.getElementById('ctx-menu').style.display = 'none'; });";
  const count = app.split(signature).length - 1;
  if (count !== 1) throw new Error(`context-menu listener count is ${count}`);
});

check('Required DOM ids are unique', () => {
  const counts = new Map();
  for (const match of html.matchAll(/\bid=["']([^"']+)["']/g)) counts.set(match[1], (counts.get(match[1]) || 0) + 1);
  const duplicates = [...counts].filter(([, count]) => count > 1);
  if (duplicates.length) throw new Error(`duplicate ids: ${duplicates.map(([id]) => id).join(', ')}`);
  const required = ['main','panel-timetable','panel-config','panel-constraints','panel-stats','third-timetable-card','toggle-third-timetable','third-class-select','third-teacher-select','third-room-select','third-class-tt','third-teacher-tt','third-room-tt','subpanel-constraints-block','subpanel-constraints-rule','block-slot-grid','block-tbody','rule-subject-checks','rule-class-checks','rule-slot-grid','rule-tbody','stats-summary','stats-teacher-tbody','stats-class-tbody','matrixAssignmentTeacherList'];
  const missing = required.filter(id => !counts.has(id));
  if (missing.length) throw new Error(`missing ids: ${missing.join(', ')}`);
  for (const marker of ['async function deleteClass', 'async function deleteSubject', 'window.deleteClass = deleteClass', 'window.deleteSubject = deleteSubject']) {
    if (!app.includes(marker)) throw new Error('刪除操作函式缺少：' + marker);
  }
});
check('Class assignment matrix renders subject columns and teacher cells', () => {
  const start = runtime.indexOf('const renderClassAssignmentView');
  const end = runtime.indexOf('  const renderTeacherAssignmentView', start);
  if (start < 0 || end < 0) throw new Error('class assignment matrix renderer not found');
  const elements = {
    'asgn-class-filter': {value: ''},
    'asgn-matrix-summary': {textContent: ''},
    'asgn-class-thead': {innerHTML: ''},
    'asgn-class-tbody': {innerHTML: ''}
  };
   const context = withWeeklyHelpers({
     window: {},
    state: {
      classes: [{'班級代碼':'701','班級名稱':'七年一班','年級':'7'}],
      teachers: [{'教師姓名':'T01','姓名':'王老師'}],
        subjects: [{'科目代碼':'國文','每週節數':'5'},{'科目代碼':'數學','每週節數':'4'},{'科目代碼':'國文輔','每週節數':'1'},{'科目代碼':'社團','適用班級':'702'}],
       assignments: [
         {'配課ID':'A1','班級代碼':'701','科目代碼':'國文','教師姓名':'T01'},
          {'配課ID':'A2','班級代碼':'701','科目代碼':'國文輔','教師姓名':'T01'}
       ]
    },
    idx: {
       assignmentsByClass: {'701':[
         {'配課ID':'A1','班級代碼':'701','科目代碼':'國文','教師姓名':'T01'},
          {'配課ID':'A2','班級代碼':'701','科目代碼':'國文輔','教師姓名':'T01'}
       ]},
      teacherByCode: {T01:{'教師姓名':'T01','姓名':'王老師'}}
    },
    document: {getElementById:id => elements[id] || null},
    esc: value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
     getSubjectColor: () => ({bg:'#dbeafe', text:'#1e3a8a'}),
     getCellTeacherCodes: assignment => [assignment['教師姓名']],
       isHelperSubjectCodeForCount: value => /輔$/i.test(String(value || '').trim())
   });
  vm.createContext(context);
  vm.runInContext(runtime.slice(start, end), context, {filename:'class-assignment-matrix.js'});
  context.window.renderClassAssignmentView();
  if (!elements['asgn-class-thead'].innerHTML.includes('data-subject-code="國文"')) throw new Error('國文沒有成為科目欄位');
  if (!elements['asgn-class-thead'].innerHTML.includes('data-subject-code="數學"')) throw new Error('數學沒有成為科目欄位');
  if (!elements['asgn-class-thead'].innerHTML.includes('配課節數')) throw new Error('配課欄位沒有改為配課節數');
   if (!elements['asgn-matrix-summary'].textContent.includes('顯示 1／1 班')) throw new Error('矩陣摘要沒有更新班級數');
   if (!elements['asgn-class-tbody'].innerHTML.includes('王老師')) throw new Error('教師姓名沒有寫入儲存格');
   if (!elements['asgn-class-tbody'].innerHTML.includes('5 節')) throw new Error('配課節數沒有顯示已配節數');
    if (elements['asgn-class-tbody'].innerHTML.includes('6 節')) throw new Error('第八節課輔仍被計入班級配課節數');
  if (!elements['asgn-class-tbody'].innerHTML.includes('is-empty')) throw new Error('未配課儲存格沒有維持中性空白');
  if (!elements['asgn-class-tbody'].innerHTML.includes('openMatrixAssignmentEditor')) throw new Error('配課儲存格沒有點擊編輯事件');
  const unavailableCell = elements['asgn-class-tbody'].innerHTML.match(/<td class="asgn-matrix-cell is-not-applicable"[^>]*>/)?.[0] || '';
  if (!unavailableCell || unavailableCell.includes('openMatrixAssignmentEditor')) throw new Error('不適用科目仍可點擊新增');
  if (!html.includes('id="matrixAssignmentModal"') || !runtime.includes('window.saveMatrixAssignment = ')) throw new Error('配課矩陣編輯視窗或儲存流程缺少');
   if (!html.includes('class="assignment-matrix-legend"') || !runtime.includes('visibleClassCount')) throw new Error('矩陣圖例或摘要流程缺少');
   if (!runtime.includes('isHelperSubjectCodeForCount')) throw new Error('班級配課矩陣缺少課輔節數排除規則');
   if (!app.includes('function isHelperSubjectCode')) throw new Error('課輔科目辨識函式缺少');
   if (!app.includes("!isHelperSubjectCode(entry['科目代碼'])")) throw new Error('班級選單未排除課輔已排節數');
  const css = read('style.css');
  if (!css.includes('.assignment-matrix-table .asgn-matrix-action-col') || !css.includes('right: 0')) throw new Error('配課操作欄沒有固定在右側');
  if (!css.includes('--asgn-matrix-class-width: 92px')) throw new Error('班級欄位仍未縮窄');
  if (!css.includes('repeating-linear-gradient(135deg, #f8fafc, #f8fafc 5px, #e2e8f0 5px, #e2e8f0 10px)')) throw new Error('不適用科目沒有灰色斜線底');
});
check('Class assignment matrix saves a co-teacher assignment', () => {
  const start = runtime.indexOf('function matrixAssignmentTeacherCodes');
  const end = runtime.indexOf('  const renderTeacherAssignmentView', start);
  if (start < 0 || end < 0) throw new Error('矩陣配課儲存流程找不到');
  const fields = {
    matrixAssignmentTeacher: {value: 'T01 王老師'},
     matrixAssignmentTeacherTag: {value: ''},
    matrixAssignmentTeacher2: {value: 'T02 外師'},
     matrixAssignmentTeacher2Tag: {value: '手'},
    matrixAssignmentWeekly: {value: '3'},
     matrixAssignmentAttribute: {value: '預排'},
    matrixAssignmentNote: {value: '矩陣點擊測試'},
    matrixAssignmentModal: {classList: {remove(){}}}
  };
  const matrixRows = [
    {querySelector(selector) {
      if (selector === '[data-matrix-teacher-input]') return fields.matrixAssignmentTeacher;
      if (selector === '[data-matrix-teacher-tag]') return fields.matrixAssignmentTeacherTag;
      return null;
    }},
    {querySelector(selector) {
      if (selector === '[data-matrix-teacher-input]') return fields.matrixAssignmentTeacher2;
      if (selector === '[data-matrix-teacher-tag]') return fields.matrixAssignmentTeacher2Tag;
      return null;
    }}
  ];
  const matrixTeacherList = {querySelectorAll: () => matrixRows};
  let syncConfig = null;
   const context = withWeeklyHelpers({
     window: {},
    ui: {matrixAssignmentTarget: {classCode:'701',subjectCode:'國文',assignmentId:''}},
    state: {
      teachers: [{'教師姓名':'T01','姓名':'王老師'},{'教師姓名':'T02','姓名':'外師'}],
      assignments: []
    },
    idx: {teacherByCode:{T01:{'教師姓名':'T01','姓名':'王老師'}}},
    document: {getElementById:id => id === 'matrixAssignmentTeacherList' ? matrixTeacherList : (fields[id] || null), querySelector:()=>null},
    formatTeacherCodeName: (code, teacher) => code + ' ' + (teacher['姓名'] || ''),
    closeGlobalTeacherDropdown(){},
    toast(){},
    buildIndex(){},
    renderClassAssignmentView(){},
    renderTeacherAssignmentView(){},
    bgSync(config){ syncConfig = config; config.applyLocal(); },
     gasPost(){ return Promise.resolve({ok:true}); }
   });
  context.window = context;
  vm.createContext(context);
  vm.runInContext(runtime.slice(start, end), context, {filename:'class-assignment-save.js'});
  context.window.saveMatrixAssignment();
  if (!syncConfig) throw new Error('點擊儲存沒有建立背景同步');
  if (context.state.assignments.length !== 1) throw new Error('點擊儲存沒有新增配課資料');
  const assignment = context.state.assignments[0];
  if (assignment['班級代碼'] !== '701' || assignment['科目代碼'] !== '國文') throw new Error('新增配課基本欄位內容錯誤');
  const assignedTeachers = JSON.parse(assignment['教師姓名']);
   if (assignedTeachers.length !== 2 || assignedTeachers[0]['教師姓名'] !== 'T01' || assignedTeachers[0]['標籤'] !== '' || assignedTeachers[1]['教師姓名'] !== 'T02' || assignedTeachers[1]['標籤'] !== '手') throw new Error('協同教師資料內容錯誤');
   if (assignment['每週節數'] !== '3' || assignment['課程屬性'] !== '預排') throw new Error('新增配課節數或課程屬性資料錯誤');
  if (!String(assignment['配課ID']).startsWith('MATRIX-')) throw new Error('矩陣新增配課沒有建立主鍵');
});
check('Third timetable comparison pane preserves base widths', () => {
   for (const marker of ['id="toggle-third-timetable"', 'id="third-timetable-card"', 'id="third-timetable-header"', 'id="third-patrol-controls"', 'id="third-patrol-tt"', 'data-third-view="class"', 'data-third-view="teacher"', 'data-third-view="room"', 'data-third-view="patrol"']) {
    if (!html.includes(marker)) throw new Error('third timetable marker missing: ' + marker);
  }
  if (!app.includes("layout.classList.toggle('third-open', ui.thirdOpen)")) throw new Error('third timetable layout toggle missing');
  if (!app.includes("toolbar.classList.toggle('third-open', ui.thirdOpen)")) throw new Error('third timetable toolbar toggle missing');
  if (!app.includes("header.hidden = !ui.thirdOpen")) throw new Error('third timetable header visibility missing');
  if (!app.includes("renderClassTT(ui.thirdSelectedClass, 'third')")) throw new Error('third class renderer target missing');
  if (!app.includes("renderTeacherTT(ui.thirdSelectedTeacher, 'third')")) throw new Error('third teacher renderer target missing');
  if (!app.includes("renderRoomTT(ui.thirdSelectedRoom, 'third')")) throw new Error('third room renderer target missing');
   if (!app.includes('function renderPatrolOverviewTT') || !app.includes('function choosePatrolTeacherAtSlot') || !app.includes('function openThirdPatrolOverview')) throw new Error('third patrol view missing');
   const patrolRenderStart = app.indexOf('function renderPatrolOverviewTT');
   const patrolRenderEnd = app.indexOf('function applyThirdTimetableVisibility', patrolRenderStart);
   const patrolRender = app.slice(patrolRenderStart, patrolRenderEnd);
   if (patrolRender.includes('.sort(')) throw new Error('巡堂統計不應重新排序教師名單');
   if (html.indexOf('id="third-patrol-stats"') < html.indexOf('id="third-patrol-tt"')) throw new Error('巡堂統計未放在巡堂課表之後');
   if (!app.includes('點擊開啟巡堂總覽') || !app.includes('點擊選擇巡堂教師')) throw new Error('巡堂格與巡堂空白格互動缺少');
  if (!app.includes("function getTimetablePane(target = 'primary')")) throw new Error('timetable pane mapping missing');
  if (!app.includes("function bindClassTTEvents(target = 'primary')")) throw new Error('class drag target binding missing');
  if (!app.includes("function bindTeacherTTEvents(teacherCode, target = 'primary')")) throw new Error('teacher drag target binding missing');
  const roomStart = app.indexOf('function renderRoomTT');
  const roomEnd = app.indexOf('// ============================================================\n// 課表渲染', roomStart);
  if (!app.slice(roomStart, roomEnd).includes('draggable: false')) throw new Error('room timetable is not read-only');
  if (!app.slice(roomStart, roomEnd).includes("container.classList.add('room-readonly')")) throw new Error('room read-only styling marker missing');
  const css = read('style.css');
  if (!css.includes('#tt-layout.third-open') || !css.includes('width: calc(150% + 7px)')) throw new Error('third timetable does not extend horizontally');
  if (!css.includes('.third-view-control[hidden]') || !css.includes('display: none !important')) throw new Error('third hidden controls can still occupy space');
  if (!css.includes('#tt-layout { display: grid') || !css.includes('align-items: start')) throw new Error('timetable cards are not top-aligned');
  if (!css.includes('.third-layout-header') || !css.includes('min-height: 54px')) throw new Error('third timetable header is not aligned with the workbench');
});
check('Main tab DOM hierarchy', () => {
  const stack = [], parents = {};
  for (const match of html.matchAll(/<\/?div\b[^>]*>/gi)) {
    const tag = match[0];
    if (/^<\/div/i.test(tag)) { stack.pop(); continue; }
    const id = (tag.match(/\bid=["']([^"']+)/i) || [])[1];
    if (id) parents[id] = stack[stack.length - 1] || '(root)';
    stack.push(id || 'div');
  }
  for (const id of ['panel-timetable','panel-config','panel-constraints','panel-stats']) if (parents[id] !== 'main') throw new Error(`${id} parent is ${parents[id]}`);
  if (parents['subpanel-constraints-block'] !== 'panel-constraints') throw new Error('teacher constraint panel nesting');
  if (parents['subpanel-constraints-rule'] !== 'panel-constraints') throw new Error('subject constraint panel nesting');
  if (parents['subpanel-constraints-relation'] !== 'panel-constraints') throw new Error('subject relation panel nesting');
});
check('Versioned local assets', () => {
  for (const asset of ['style.css','word-export.js','app.js','app-runtime.js']) {
    const escaped = asset.replace('.', '\\.');
    if (!(new RegExp(`${escaped}\\?v=[^"']+`)).test(html)) throw new Error(`${asset} is not versioned`);
  }
});
check('Initial data load is not duplicated', () => {
  if (html.includes("window.addEventListener('load'")) throw new Error('頁面仍有第二條 loadAll 初始化流程');
   if (!app.includes('_isAppInitialized = true;')) throw new Error('成功載入後未標記初始化完成');
   if (app.includes("gasPost('ensureSchema', {}, { silent: true })")) throw new Error('已移除教師姓名 schema 背景修復');
   if (!app.includes("gasPost('getAll', {}, { silent: background, retry: false, timeoutMs: 30000 })")) throw new Error('getAll 未設定單次逾時，可能重試超過一分鐘');
    if (!backend.includes("if (action !== 'getAll' && action !== 'ensureSchema') ensureAllSheetsCached_(ss);")) throw new Error('getAll 仍會同步阻塞 schema 整理');
   if (!backend.includes("case 'ensureSchema': {")) throw new Error('背景 schema 整理路由缺少');
});
check('Cancel subject-rule edit never calls backend', () => {  const start = app.lastIndexOf('function setSubjectRuleEditMode');
  const end = app.indexOf('function renderRuleTable()', start);
  if (start < 0 || end < 0) throw new Error('subject-rule edit functions not found');
  let backendCalls = 0;
  const elements = {'rule-apply-btn':{textContent:''},'rule-clear-btn':{textContent:''},'rule-subject':{value:'國文'},'rule-grade':{value:'7'},'rule-type':{value:'禁排'}};
  const context = {ui:{editingRuleId:'R01',ruleSlots:new Set(['1|1'])},document:{getElementById:id=>elements[id]||null},toast(){},renderRuleSlotGrid(){},showLoading(){},gasPost:async()=>{backendCalls+=1;return {ok:true}},loadAll:async()=>{},getRuleDaysPeriods:()=>[]};
  vm.createContext(context);
  vm.runInContext(app.slice(start, end), context);
  context.applySubjectRule(true);
  if (backendCalls !== 0) throw new Error(`backend called ${backendCalls} time(s)`);
  if (context.ui.editingRuleId !== '' || context.ui.ruleSlots.size !== 0) throw new Error('edit state was not reset');
});
check('Subject rules support multi-subject and specific-class scopes', () => {
  const start = app.indexOf('function splitRuleScopeList');
  const end = app.indexOf('function compressSlots', start);
  if (start < 0 || end < 0) throw new Error('subject rule scope helpers missing');
  const context = {
    idx: { classByCode: {
      '701': {'年級':'7'},
      '702': {'年級':'7'},
      '801': {'年級':'8'}
    } }
  };
  vm.createContext(context);
  vm.runInContext(app.slice(start, end), context, {filename:'subject-rule-scope.js'});
  const rule = {'科目代碼':'國文,英語', '適用年級':'全校', '適用班級':'701,702'};
  if (context.getRuleSubjectCodes(rule).join('|') !== '國文|英語') throw new Error('multi-subject rule parsing failed');
  if (context.getRuleClassCodes(rule).join('|') !== '701|702') throw new Error('specific-class rule parsing failed');
  if (!context.ruleAppliesToSubjectAndClass(rule, '英語', '702')) throw new Error('selected subject/class should match');
  if (context.ruleAppliesToSubjectAndClass(rule, '數學', '702')) throw new Error('unselected subject matched');
  if (context.ruleAppliesToSubjectAndClass(rule, '英語', '801')) throw new Error('unselected class matched');
  const gradeRule = {'科目代碼':'國文,英語', '適用年級':'7', '適用班級':''};
  if (!context.ruleAppliesToSubjectAndClass(gradeRule, '國文', '701')) throw new Error('grade-scoped rule should match');
  if (context.ruleAppliesToSubjectAndClass(gradeRule, '國文', '801')) throw new Error('grade-scoped rule matched wrong grade');
  if (!html.includes('適用班級（可複選）')) throw new Error('specific-class rule UI missing');
  if (!backend.includes('subjectRuleMatches_')) throw new Error('backend subject/class scope matcher missing');
  if (!backend.includes('parseFrozenRuleSlots_(r)')) throw new Error('backend rule slot parser is not used for scoped conflicts');
});
check('Auto-schedule enforces one subject per class per day', () => {
   const ruleStart = app.indexOf('function parseDayNum');
   const ruleEnd = app.indexOf('function compressSlots', ruleStart);
   const ruleContext = {
     idx: { classByCode: { '701': {'年級':'7'} } },
     state: { subjectRules: [{
       '科目代碼': '絲竹室內樂', '適用年級': '全校', '適用班級': '',
       '規則類型': '必排', '時段': '2-3,2-4'
      }] }
    };
   vm.createContext(ruleContext);
   vm.runInContext(app.slice(ruleStart, ruleEnd), ruleContext, {filename:'mandatory-contiguous-rule.js'});
   if (ruleContext.getMandatoryRuleDaySlots('絲竹室內樂', '701', 2).map(slot => slot.period).join('|') !== '3|4') throw new Error('contiguous mandatory double-period rule was not detected');
   if (ruleContext.getMandatoryRuleDaySlots('國文', '701', 2).length !== 0) throw new Error('mandatory double-period exception leaked to other subjects');
   const autoStart = app.indexOf('async function executeAutoSchedule');
   const autoEnd = app.indexOf('// 全新強大批次配課控制台', autoStart);
   const autoBlock = app.slice(autoStart, autoEnd);
   if (!autoBlock.includes('const optOnePerDay      = true;')) throw new Error('one-per-day hard limit is not fixed');
   if (!autoBlock.includes('const mandatoryDaySlots = getMandatoryRuleDaySlots')) throw new Error('contiguous mandatory exception is not wired');
   if (!autoBlock.includes('currentDayCount < (mandatoryDaySlots.length > 1 ? mandatoryDaySlots.length : 1)')) throw new Error('same-day limit does not use the scoped exception');
   if (autoBlock.includes('auto-opt-allow-same-day') || autoBlock.includes('const optAllowSameDayDuplicate')) throw new Error('same-day completion mode still exists');
   if (runtime.includes('mandatoryLimit') || runtime.includes('spreadLimit')) throw new Error('quality audit still allows same-day exceptions');
   if (html.includes('auto-opt-allow-same-day')) throw new Error('same-day completion UI still exists');
   if (!backend.includes('getMandatoryRuleDaySlots_') || !backend.includes('classSubjectDaySlots')) throw new Error('backend same-day rule audit is missing');
   if (autoBlock.includes('allowMandatoryCohortExclusive') || autoBlock.includes('sameMandatoryCohort')) throw new Error('mandatory teacher-exclusion exception remains');
 });
check('Retry placement runs once outside day/period loops', () => {
  const autoStart = app.indexOf('async function executeAutoSchedule');
  const retryStart = app.indexOf('const retryCandidates = [];', autoStart);
  if (retryStart < 0) throw new Error('retry candidates block not found');
  const ifStart = app.indexOf('if (retryCandidates.length > 0) {', retryStart);
  if (ifStart < 0) throw new Error('retry placement guard not found');
  const head = app.slice(retryStart, ifStart);
  const headOpen = (head.match(/\{/g) || []).length;
  const headClose = (head.match(/\}/g) || []).length;
  if (headOpen !== headClose) throw new Error(`candidate collection loops unbalanced (${headOpen} open / ${headClose} close)`);
  const tail = app.slice(ifStart, app.indexOf('// 嘗試交換排入', ifStart));
  if ((tail.match(/successCount\+\+;/g) || []).length !== 1) throw new Error('retry placement must increment successCount exactly once');
  const failPush = app.indexOf('if (!placed) markAutoFailure(lesson, classifyNoLegalSlot(lesson));', ifStart);
  if (failPush < 0) throw new Error('retry failList push missing');
  const failHead = app.slice(ifStart, failPush);
  const failHeadOpen = (failHead.match(/\{/g) || []).length;
  const failHeadClose = (failHead.match(/\}/g) || []).length;
  if (failHeadOpen !== failHeadClose) throw new Error(`failList push must sit at ri-loop level, not inside day/period loops (${failHeadOpen} open / ${failHeadClose} close)`);
});
check('Frozen schedule protections cover every write path', () => {
   if (!app.includes('function keepLockedScheduleEntries')) throw new Error('clear-all path locked predicate missing');
   if (!app.includes("if (scope === 'all') return keepLockedScheduleEntries(state.schedule);")) throw new Error('clear-all path does not apply locked entries only');
   if (!app.includes("clearKeepLockedOnly: scope === 'all'")) throw new Error('clear-all path does not mark locked-only writes');
  if (!app.includes('凍結課程不可修改')) throw new Error('manual assignment path lacks frozen guard');
  if (!app.includes('凍結課程不可清除')) throw new Error('manual clear path lacks frozen guard');
  if (!backend.includes('function isFrozenScheduleEntry_')) throw new Error('GAS frozen predicate missing');
  if (!backend.includes('frozenScheduleEntryMatches_')) throw new Error('GAS frozen integrity comparison missing');
  if (!backend.includes('currentRows')) throw new Error('GAS batch write does not inspect existing schedule');
   if (!backend.includes('result && result.blocked')) throw new Error('GAS blocked response is not propagated');
});
check('Backend snapshot audit checks every assigned teacher', () => {
   if (backend.includes('isAllowedMandatoryTeacherExclusion_')) throw new Error('GAS snapshot audit still relaxes mandatory teacher exclusivity');
   const context = {};
  vm.createContext(context);
  vm.runInContext(backend, context, { filename: 'snapshot-audit.js' });
  const parsed = context.teacherCodesFromValue_('[{"教師姓名":"T01"},{"教師姓名":"T02"}]');
  if (parsed.join('|') !== 'T01|T02') throw new Error('GAS multi-teacher parser lost a teacher');
  const result = context.validateScheduleSnapshot_([
    { '課表ID': 'S1', '班級代碼': '701', '星期': '1', '節次': '1', '科目代碼': '英語', '教師姓名': '[{"教師姓名":"T01"},{"教師姓名":"T02"}]', '課堂屬性': '一般', '是否鎖定': 'FALSE', '是否預排': 'FALSE' },
    { '課表ID': 'S2', '班級代碼': '702', '星期': '1', '節次': '1', '科目代碼': '數學', '教師姓名': 'T02', '課堂屬性': '一般', '是否鎖定': 'FALSE', '是否預排': 'FALSE' }
  ], {
    classes: [{ '班級代碼': '701', '年級': '7', '是否虛擬班': 'FALSE' }, { '班級代碼': '702', '年級': '7', '是否虛擬班': 'FALSE' }],
    subjects: [{ '科目代碼': '英語', '同時最多班數': '0' }, { '科目代碼': '數學', '同時最多班數': '0' }],
    teacherBlocks: [], subjectRules: [], blockGroups: [], teacherExclusives: [], rooms: []
  });
  if (!result || result.ok || !result.error.includes('教師衝堂')) throw new Error('GAS snapshot audit missed second teacher conflict');
  const combined = context.validateScheduleSnapshot_([
    { '課表ID': 'C1', '班級代碼': '701', '星期': '1', '節次': '2', '科目代碼': '英語', '教師姓名': 'T01', '課堂屬性': '一般', '是否鎖定': 'FALSE', '是否預排': 'FALSE' },
    { '課表ID': 'C2', '班級代碼': '702', '星期': '1', '節次': '2', '科目代碼': '英語', '教師姓名': 'T01', '課堂屬性': '一般', '是否鎖定': 'FALSE', '是否預排': 'FALSE' }
  ], {
    classes: [{ '班級代碼': '701', '年級': '7', '是否虛擬班': 'FALSE' }, { '班級代碼': '702', '年級': '7', '是否虛擬班': 'FALSE' }],
    subjects: [{ '科目代碼': '英語', '同時最多班數': '0' }],
    teacherBlocks: [], subjectRules: [],
    blockGroups: [{ '群組ID': 'BG1', '科目清單': '英語', '班級清單': '701,702' }],
    teacherExclusives: [], rooms: []
  });
  if (!combined || !combined.ok) throw new Error('GAS snapshot audit incorrectly rejected configured combined class cohort');
  const sameClassSubjectDay = context.validateScheduleSnapshot_([
    { '課表ID': 'D1', '班級代碼': '701', '星期': '1', '節次': '1', '科目代碼': '英語', '教師姓名': 'T01', '課堂屬性': '一般' },
    { '課表ID': 'D2', '班級代碼': '701', '星期': '1', '節次': '2', '科目代碼': '英語', '教師姓名': 'T02', '課堂屬性': '一般' }
  ], {
    classes: [{ '班級代碼': '701', '年級': '7', '是否虛擬班': 'FALSE' }],
    subjects: [{ '科目代碼': '英語', '同時最多班數': '0' }],
    teacherBlocks: [], subjectRules: [], blockGroups: [], teacherExclusives: [], rooms: []
  });
   if (!sameClassSubjectDay || sameClassSubjectDay.ok || !sameClassSubjectDay.error.includes('同班同科同日重複')) throw new Error('GAS snapshot audit missed same class-subject daily duplicate');
   const manualSameClassSubjectDay = context.checkConflicts_(null, {
     day: '1', period: '2', classCode: '701', subjectCode: '英語', teacherCode: 'T02'
   }, '', {
     schedule: [{ '課表ID': 'M-D1', '班級代碼': '701', '星期': '1', '節次': '1', '科目代碼': '英語', '教師姓名': 'T01' }],
     subjects: [{ '科目代碼': '英語', '同時最多班數': '0' }],
     classes: [{ '班級代碼': '701', '年級': '7', '是否虛擬班': 'FALSE' }],
     teacherBlocks: [], subjectRules: [], teacherExclusives: []
   });
   const manualSameDayWarning = manualSameClassSubjectDay.find(conflict => conflict.kind === 'sameClassSubjectDay');
   if (!manualSameDayWarning || manualSameDayWarning.hard !== false) throw new Error('manual same-day duplicate is still a GAS hard conflict');
   const mandatoryDoublePeriod = context.validateScheduleSnapshot_([
    { '課表ID': 'P1', '班級代碼': '701', '星期': '2', '節次': '3', '科目代碼': '絲竹室內樂', '教師姓名': 'T01', '課堂屬性': '一般' },
    { '課表ID': 'P2', '班級代碼': '701', '星期': '2', '節次': '4', '科目代碼': '絲竹室內樂', '教師姓名': 'T01', '課堂屬性': '一般' }
  ], {
    classes: [{ '班級代碼': '701', '年級': '7', '是否虛擬班': 'FALSE' }],
    subjects: [{ '科目代碼': '絲竹室內樂', '同時最多班數': '0' }],
    teacherBlocks: [],
    subjectRules: [{ '科目代碼': '絲竹室內樂', '適用年級': '全校', '適用班級': '', '時段': '2-3,2-4', '規則類型': '必排' }],
    blockGroups: [], teacherExclusives: [], rooms: []
   });
   if (!mandatoryDoublePeriod || !mandatoryDoublePeriod.ok) throw new Error('GAS snapshot audit rejected configured mandatory double period');
   const lockedDoublePeriod = context.validateScheduleSnapshot_([
     { '課表ID': 'L1', '班級代碼': '701', '星期': '2', '節次': '3', '科目代碼': '絲竹室內樂', '教師姓名': 'T01', '課堂屬性': '一般', '是否鎖定': 'TRUE' },
     { '課表ID': 'L2', '班級代碼': '701', '星期': '2', '節次': '4', '科目代碼': '絲竹室內樂', '教師姓名': 'T01', '課堂屬性': '一般', '是否鎖定': 'FALSE' }
   ], {
     classes: [{ '班級代碼': '701', '年級': '7', '是否虛擬班': 'FALSE' }],
     subjects: [{ '科目代碼': '絲竹室內樂', '同時最多班數': '0' }],
     teacherBlocks: [], subjectRules: [], blockGroups: [], teacherExclusives: [], rooms: []
   });
   if (!lockedDoublePeriod || !lockedDoublePeriod.ok) throw new Error('GAS snapshot audit rejected locked consecutive course');
   const mandatoryExclusive = context.validateScheduleSnapshot_([
    { '課表ID': 'M1', '班級代碼': '701', '星期': '5', '節次': '7', '科目代碼': '英語', '教師姓名': 'T01', '課堂屬性': '一般', '是否鎖定': 'FALSE', '是否預排': 'FALSE' },
    { '課表ID': 'M2', '班級代碼': '702', '星期': '5', '節次': '7', '科目代碼': '英語', '教師姓名': 'T02', '課堂屬性': '一般', '是否鎖定': 'FALSE', '是否預排': 'FALSE' }
  ], {
    classes: [{ '班級代碼': '701', '年級': '7', '是否虛擬班': 'FALSE' }, { '班級代碼': '702', '年級': '7', '是否虛擬班': 'FALSE' }],
    subjects: [{ '科目代碼': '英語', '同時最多班數': '0' }],
    teacherBlocks: [],
    subjectRules: [{ '規則ID': 'R1', '科目代碼': '英語', '適用年級': '全校', '適用班級': '', '時段': '5-7', '規則類型': '必排' }],
    blockGroups: [], teacherExclusives: [{ '教師A': 'T01', '教師B': 'T02' }], rooms: []
  });
   if (!mandatoryExclusive || mandatoryExclusive.ok || !mandatoryExclusive.error.includes('教師互斥違規')) throw new Error('必排同科同節未維持嚴格教師互斥');
  const ordinaryExclusive = context.validateScheduleSnapshot_([
    { '課表ID': 'E1', '班級代碼': '701', '星期': '5', '節次': '7', '科目代碼': '英語', '教師姓名': 'T01', '課堂屬性': '一般' },
    { '課表ID': 'E2', '班級代碼': '702', '星期': '5', '節次': '7', '科目代碼': '英語', '教師姓名': 'T02', '課堂屬性': '一般' }
  ], {
    classes: [{ '班級代碼': '701', '年級': '7', '是否虛擬班': 'FALSE' }, { '班級代碼': '702', '年級': '7', '是否虛擬班': 'FALSE' }],
    subjects: [{ '科目代碼': '英語', '同時最多班數': '0' }],
    teacherBlocks: [], subjectRules: [], blockGroups: [], teacherExclusives: [{ '教師A': 'T01', '教師B': 'T02' }], rooms: []
   });
   if (!ordinaryExclusive || ordinaryExclusive.ok || !ordinaryExclusive.error.includes('教師互斥違規')) throw new Error('一般同科同節錯誤繞過教師互斥');
   const manualExclusive = context.validateScheduleSnapshot_([
     { '課表ID': 'ME1', '班級代碼': '701', '星期': '5', '節次': '7', '科目代碼': '英語', '教師姓名': 'T01', '課堂屬性': '一般' },
     { '課表ID': 'ME2', '班級代碼': '702', '星期': '5', '節次': '7', '科目代碼': '英語', '教師姓名': 'T02', '課堂屬性': '一般' }
   ], {
     classes: [{ '班級代碼': '701', '年級': '7', '是否虛擬班': 'FALSE' }, { '班級代碼': '702', '年級': '7', '是否虛擬班': 'FALSE' }],
     subjects: [{ '科目代碼': '英語', '同時最多班數': '0' }],
     teacherBlocks: [], subjectRules: [], blockGroups: [], teacherExclusives: [{ '教師A': 'T01', '教師B': 'T02' }], rooms: [],
     allowSoftTeacherExclusives: true,
     allowManualConstraintWarnings: true
   });
   if (!manualExclusive || !manualExclusive.ok) throw new Error('手動強制排課仍被教師互斥回溯拒絕');
   const manualRoom = context.validateScheduleSnapshot_([
     { '課表ID': 'MR1', '班級代碼': '701', '星期': '1', '節次': '1', '科目代碼': '美術', '教師姓名': 'T01', '課堂屬性': '一般' },
     { '課表ID': 'MR2', '班級代碼': '702', '星期': '1', '節次': '1', '科目代碼': '音樂', '教師姓名': 'T02', '課堂屬性': '一般' }
   ], {
     classes: [{ '班級代碼': '701', '年級': '7', '是否虛擬班': 'FALSE' }, { '班級代碼': '702', '年級': '7', '是否虛擬班': 'FALSE' }],
     subjects: [{ '科目代碼': '美術', '同時最多班數': '0', '所屬教室代碼': 'R1' }, { '科目代碼': '音樂', '同時最多班數': '0', '所屬教室代碼': 'R1' }],
     teacherBlocks: [], subjectRules: [], blockGroups: [], teacherExclusives: [],
     rooms: [{ '教室代碼': 'R1', '容量': '1' }],
     allowManualConstraintWarnings: true
   });
   if (!manualRoom || !manualRoom.ok) throw new Error('手動強制排課仍被教室容量回溯拒絕');
   const manualMainTeacher = context.validateScheduleSnapshot_([
     { '課表ID': 'MT1', '班級代碼': '701', '星期': '1', '節次': '1', '科目代碼': '英語', '教師姓名': 'T01', '課堂屬性': '一般' },
     { '課表ID': 'MT2', '班級代碼': '702', '星期': '1', '節次': '1', '科目代碼': '數學', '教師姓名': 'T01', '課堂屬性': '一般' }
   ], {
     classes: [{ '班級代碼': '701', '年級': '7', '是否虛擬班': 'FALSE' }, { '班級代碼': '702', '年級': '7', '是否虛擬班': 'FALSE' }],
     subjects: [{ '科目代碼': '英語', '同時最多班數': '0' }, { '科目代碼': '數學', '同時最多班數': '0' }],
     teacherBlocks: [], subjectRules: [], blockGroups: [], teacherExclusives: [], rooms: [],
     allowManualConstraintWarnings: true
   });
   if (!manualMainTeacher || manualMainTeacher.ok || !manualMainTeacher.error.includes('教師衝堂')) throw new Error('手動排課錯誤放行主教師衝堂');
   const patrolSubject = [{ '科目代碼': '自然', '同時最多班數': '0', '所屬教室代碼': 'R1' }];
  const patrolOk = context.validateScheduleSnapshot_([
    { '課表ID': 'PATROL-OK', '班級代碼': '', '星期': '3', '節次': '4', '科目代碼': '', '教師姓名': 'T03', '課堂屬性': '巡堂', '是否鎖定': 'TRUE', '是否預排': 'FALSE' }
  ], {
    classes: [], subjects: patrolSubject, teacherBlocks: [], subjectRules: [], blockGroups: [], teacherExclusives: [],
    rooms: [{ '教室代碼': 'R1', '容量': '1' }]
  });
  if (!patrolOk || !patrolOk.ok) throw new Error('固定巡堂未通過課表快照稽核');
  const patrolConflict = context.validateScheduleSnapshot_([
    { '課表ID': 'PATROL-A', '班級代碼': '', '星期': '3', '節次': '4', '科目代碼': '', '教師姓名': 'T03', '課堂屬性': '巡堂' },
    { '課表ID': 'PATROL-B', '班級代碼': '', '星期': '3', '節次': '4', '科目代碼': '', '教師姓名': 'T04', '課堂屬性': '巡堂' }
  ], {
    classes: [], subjects: patrolSubject, teacherBlocks: [], subjectRules: [], blockGroups: [], teacherExclusives: [],
    rooms: [{ '教室代碼': 'R1', '容量': '1' }]
  });
  if (!patrolConflict || patrolConflict.ok || !patrolConflict.error.includes('只能安排一位巡堂教師')) throw new Error('巡堂同時段重複未被拒絕');
  const normalizedPatrol = context.normalizePatrolScheduleRow_({ '班級代碼': '701', '科目代碼': '巡堂', '課堂屬性': '一般' });
  if (normalizedPatrol['班級代碼'] !== '' || normalizedPatrol['科目代碼'] !== '' || normalizedPatrol['課堂屬性'] !== '巡堂') throw new Error('巡堂正規化未清空班級與科目');
  const revisionA = context.scheduleRevision_([{ '課表ID': 'S1', '班級代碼': '701', '星期': '1', '節次': '1', '科目代碼': '英語' }]);
  const revisionB = context.scheduleRevision_([{ '課表ID': 'S1', '班級代碼': '701', '星期': '2', '節次': '1', '科目代碼': '英語' }]);
  if (revisionA === revisionB) throw new Error('課表版本指紋未辨識時段變更');
  const makeSheet = (headers, rows = []) => {
    const values = [headers, ...rows.map(row => headers.map(header => row[header] ?? ''))];
    const sheet = {
      clearCalls: 0,
      writtenValues: [],
      getLastRow: () => values.length,
      getLastColumn: () => headers.length,
      getRange(row, column, rowCount, columnCount) {
        return {
          getDisplayValues: () => values.slice(row - 1, row - 1 + rowCount).map(item => item.slice(column - 1, column - 1 + columnCount)),
          clearContent: () => { sheet.clearCalls++; },
          setValues: next => {
            sheet.writtenValues = next.map(item => item.slice());
            next.forEach((item, index) => { values[row - 1 + index] = item.slice(); });
          }
        };
      },
      deleteRow: rowNumber => { values.splice(rowNumber - 1, 1); }
    };
    return sheet;
  };
  const scheduleSheet = makeSheet(['課表ID', '班級代碼', '星期', '節次', '科目代碼', '教師姓名', '課堂屬性', '是否鎖定', '是否預排'], [
    { '課表ID': 'OLD', '班級代碼': '701', '星期': '1', '節次': '1', '科目代碼': '英語', '教師姓名': 'T01', '課堂屬性': '一般', '是否鎖定': 'FALSE', '是否預排': 'FALSE' }
  ]);
  const emptySheets = {
    '班級': makeSheet(['班級代碼', '年級', '班級名稱', '是否虛擬班'], [{ '班級代碼': '701', '年級': '7', '是否虛擬班': 'FALSE' }, { '班級代碼': '702', '年級': '7', '是否虛擬班': 'FALSE' }]),
     '科目': makeSheet(['科目代碼', '每週節數', '同時最多班數', '最多連日', '適用年級', '適用班級', '所屬教室代碼'], [{ '科目代碼': '英語' }, { '科目代碼': '數學' }, { '科目代碼': '絲竹室內樂' }]),
    '不排課': makeSheet(['記錄ID', '教師姓名', '時段', '原因']),
    '科目規則': makeSheet(['規則ID', '科目代碼', '適用年級', '適用班級', '時段', '規則類型', '備註']),
    '綁班': makeSheet(['群組ID', '群組名稱', '科目清單', '班級清單']),
    '互斥': makeSheet(['規則ID', '教師A', '教師B', '備註']),
    '教室': makeSheet(['教室代碼', '教室名稱', '容量', '備註'])
  };
  const fakeSpreadsheet = { getSheetByName(name) { return name === '課表' ? scheduleSheet : emptySheets[name]; } };
  const rejected = context.batchUpdateScheduleLocked_(fakeSpreadsheet, {
    schedule: [
      { '課表ID': 'N1', '班級代碼': '701', '星期': '1', '節次': '1', '科目代碼': '英語', '教師姓名': 'T01', '課堂屬性': '一般' },
      { '課表ID': 'N2', '班級代碼': '702', '星期': '1', '節次': '1', '科目代碼': '數學', '教師姓名': 'T01', '課堂屬性': '一般' }
    ]
  });
  if (!rejected || rejected.ok || scheduleSheet.clearCalls !== 0) throw new Error('批次硬限制失敗後仍清除了原課表');
  const clearScheduleSheet = makeSheet(['課表ID', '班級代碼', '星期', '節次', '科目代碼', '教師姓名', '課堂屬性', '是否鎖定', '是否預排'], [
     { '課表ID': 'LOCKED', '班級代碼': '701', '星期': '1', '節次': '1', '科目代碼': '英語', '教師姓名': 'T01', '課堂屬性': '一般', '是否鎖定': 'TRUE', '是否預排': 'FALSE' },
     { '課表ID': 'PATROL-CLEAR', '班級代碼': '', '星期': '2', '節次': '2', '科目代碼': '', '教師姓名': 'T03', '課堂屬性': '巡堂', '是否鎖定': 'TRUE', '是否預排': 'FALSE' },
     { '課表ID': 'PRESET', '班級代碼': '702', '星期': '1', '節次': '2', '科目代碼': '英語', '教師姓名': 'T02', '課堂屬性': '一般', '是否鎖定': 'FALSE', '是否預排': 'TRUE' },
     { '課表ID': 'MUST', '班級代碼': '701', '星期': '5', '節次': '7', '科目代碼': '數學', '教師姓名': 'T03', '課堂屬性': '一般', '是否鎖定': 'FALSE', '是否預排': 'FALSE' },
     { '課表ID': 'EARLY', '班級代碼': '702', '星期': '1', '節次': '0', '科目代碼': '英語', '教師姓名': 'T01', '課堂屬性': '一般', '是否鎖定': 'FALSE', '是否預排': 'FALSE' },
     { '課表ID': 'LUNCH', '班級代碼': '701', '星期': '1', '節次': '45', '科目代碼': '絲竹室內樂', '教師姓名': 'T01', '課堂屬性': '一般', '是否鎖定': 'FALSE', '是否預排': 'FALSE' }
  ]);
  const clearRuleSheet = makeSheet(['規則ID', '科目代碼', '適用年級', '適用班級', '時段', '規則類型', '備註'], [
    { '規則ID': 'R1', '科目代碼': '數學', '適用年級': '全校', '適用班級': '', '時段': '5-7', '規則類型': '必排' }
  ]);
  const clearSpreadsheet = {
    getSheetByName(name) {
      if (name === '課表') return clearScheduleSheet;
      if (name === '科目規則') return clearRuleSheet;
      return emptySheets[name];
    }
  };
   const clearResult = context.batchUpdateScheduleLocked_(clearSpreadsheet, {
     schedule: [
       { '課表ID': 'LOCKED', '班級代碼': '701', '星期': '1', '節次': '1', '科目代碼': '英語', '教師姓名': 'T01', '課堂屬性': '一般', '是否鎖定': 'TRUE', '是否預排': 'FALSE' },
       { '課表ID': 'EARLY', '班級代碼': '702', '星期': '1', '節次': '0', '科目代碼': '英語', '教師姓名': 'T01', '課堂屬性': '一般', '是否鎖定': 'FALSE', '是否預排': 'FALSE' },
       { '課表ID': 'LUNCH', '班級代碼': '701', '星期': '1', '節次': '45', '科目代碼': '絲竹室內樂', '教師姓名': 'T01', '課堂屬性': '一般', '是否鎖定': 'FALSE', '是否預排': 'FALSE' }
     ],
     clearKeepLockedOnly: true
    });
    if (!clearResult || clearResult.count !== 3 || clearScheduleSheet.writtenValues.length !== 3 || clearScheduleSheet.writtenValues.some(row => row[0] === 'PATROL-CLEAR')) throw new Error('清除操作未移除巡堂並保留受保護課程');
   const periodEightWeeklyRow = { '課表ID': 'P8-SINGLE', '班級代碼': '701', '星期': '1', '節次': '8', '科目代碼': '英語', '教師姓名': 'T01', '課堂屬性': '單週', '是否鎖定': 'FALSE', '是否預排': 'FALSE' };
   const periodEightWeeklySheet = makeSheet(['課表ID', '班級代碼', '星期', '節次', '科目代碼', '教師姓名', '課堂屬性', '是否鎖定', '是否預排'], [
     periodEightWeeklyRow,
     { ...periodEightWeeklyRow, '課表ID': 'P8-DOUBLE', '課堂屬性': '雙週' }
   ]);
    const periodEightWeeklySpreadsheet = {
      getSheetByName(name) {
        if (name === '課表') return periodEightWeeklySheet;
        return emptySheets[name];
      }
    };
   const periodEightCellClear = context.clearCell_(periodEightWeeklySpreadsheet, { classCode: '701', day: 1, period: 8, weekType: '單週' });
   const remainingPeriodEightRow = periodEightWeeklySheet.getRange(2, 1, 1, 9).getDisplayValues()[0];
   if (!periodEightCellClear || periodEightCellClear.ok !== true || periodEightWeeklySheet.getLastRow() !== 2 || remainingPeriodEightRow[6] !== '雙週') throw new Error('第八節單週課程仍無法單格清除或誤刪雙週課程');
   const periodEightBatchSheet = makeSheet(['課表ID', '班級代碼', '星期', '節次', '科目代碼', '教師姓名', '課堂屬性', '是否鎖定', '是否預排'], [periodEightWeeklyRow]);
   const periodEightBatchSpreadsheet = {
     getSheetByName(name) {
       if (name === '課表') return periodEightBatchSheet;
       return name === '科目規則' ? clearRuleSheet : emptySheets[name];
     }
   };
   const periodEightBatchClear = context.batchUpdateScheduleLocked_(periodEightBatchSpreadsheet, { schedule: [], clearScope: 'period-8' });
   if (!periodEightBatchClear || periodEightBatchClear.ok === false || periodEightBatchSheet.clearCalls !== 1) throw new Error('第八節單週課程仍無法批次清除');
   const lockedConsecutiveRows = [
     { '課表ID': 'LOCKED-DOUBLE-1', '班級代碼': '701', '星期': '2', '節次': '3', '科目代碼': '絲竹室內樂', '教師姓名': 'T01', '課堂屬性': '一般', '是否鎖定': 'TRUE', '是否預排': 'FALSE' },
     { '課表ID': 'LOCKED-DOUBLE-2', '班級代碼': '701', '星期': '2', '節次': '4', '科目代碼': '絲竹室內樂', '教師姓名': 'T01', '課堂屬性': '一般', '是否鎖定': 'FALSE', '是否預排': 'FALSE' }
   ];
   const lockedConsecutiveSheet = makeSheet(['課表ID', '班級代碼', '星期', '節次', '科目代碼', '教師姓名', '課堂屬性', '是否鎖定', '是否預排'], lockedConsecutiveRows);
   const lockedConsecutiveSpreadsheet = {
     getSheetByName(name) {
       if (name === '課表') return lockedConsecutiveSheet;
       return emptySheets[name];
     }
   };
   const lockedConsecutiveResult = context.batchUpdateScheduleLocked_(lockedConsecutiveSpreadsheet, {
     schedule: lockedConsecutiveRows,
     clearKeepLockedOnly: true
   });
   if (!lockedConsecutiveResult || lockedConsecutiveResult.count !== 2) throw new Error('清除操作移除了鎖定連排的第二節');
   const ordinaryClearEntry = { '班級代碼': '701', '節次': '3', '科目代碼': '英語', '是否鎖定': 'FALSE', '是否預排': 'FALSE' };
   if (!context.isClearScopeTarget_(ordinaryClearEntry, 'second-round', [], [], [])) throw new Error('第二輪清除未包含一般課程');
   if (context.isClearScopeTarget_(ordinaryClearEntry, 'second-round', [], [], [{ '群組ID': 'BG1', '科目清單': '英語', '班級清單': '701,702' }])) throw new Error('第二輪清除錯誤刪除綁班課程');
   if (!context.isClearScopeTarget_({ ...ordinaryClearEntry, '節次': '8' }, 'period-8', [], [], [])) throw new Error('第八節清除範圍判斷失敗');
  const patrolHeaders = ['課表ID', '班級代碼', '星期', '節次', '科目代碼', '教師姓名', '課堂屬性', '是否鎖定', '是否預排'];
  const patrolRow = { '課表ID': 'PATROL-MOVE', '班級代碼': '', '星期': '3', '節次': '4', '科目代碼': '', '教師姓名': 'T03', '課堂屬性': '巡堂', '是否鎖定': 'TRUE', '是否預排': 'FALSE' };
  const patrolMoveSheet = makeSheet(patrolHeaders, [patrolRow]);
  const patrolMoveSpreadsheet = {
    getSheetByName(name) { return name === '課表' ? patrolMoveSheet : emptySheets[name]; }
  };
  const patrolMoved = context.batchUpdateScheduleLocked_(patrolMoveSpreadsheet, {
    schedule: [{ ...patrolRow, '星期': '4' }]
  });
   if (!patrolMoved || patrolMoved.count !== 1 || patrolMoveSheet.writtenValues[0][2] !== 4) throw new Error('巡堂拖曳未通過 GAS 批次寫入');
  const patrolDeleteSheet = makeSheet(patrolHeaders, [patrolRow]);
  const patrolDeleteSpreadsheet = {
    getSheetByName(name) { return name === '課表' ? patrolDeleteSheet : emptySheets[name]; }
  };
  const patrolDeleted = context.batchUpdateScheduleLocked_(patrolDeleteSpreadsheet, { schedule: [] });
  if (!patrolDeleted || patrolDeleted.count !== 0 || patrolDeleteSheet.clearCalls !== 1) throw new Error('巡堂刪除未通過 GAS 批次寫入');
  const invalidCourse = { '課表ID': 'INVALID-COURSE', '班級代碼': '702', '星期': '4', '節次': '2', '科目代碼': '生物', '教師姓名': 'T01', '課堂屬性': '一般', '是否鎖定': 'FALSE', '是否預排': 'FALSE' };
  const patrolSaveSheet = makeSheet(patrolHeaders, [invalidCourse]);
  const patrolTeacherSheet = makeSheet(['教師姓名', 'Email', '任教科目', '職稱', '最大連堂節數', '基本鐘點', '減授原因'], [
    { '教師姓名': 'T03', '職稱': '行政組長' }
  ]);
  const patrolSaveSpreadsheet = {
    getSheetByName(name) {
      if (name === '課表') return patrolSaveSheet;
      if (name === '教師') return patrolTeacherSheet;
      return emptySheets[name];
    }
  };
  const patrolSave = context.savePatrolSchedule_(patrolSaveSpreadsheet, {
    patrolSchedule: [patrolRow],
    basePatrolSchedule: [],
    baseRevision: 'stale-course-only-revision'
  });
  if (!patrolSave || patrolSave.blocked || patrolSave.patrolCount !== 1 || !patrolSaveSheet.writtenValues.some(row => row[0] === 'PATROL-MOVE')) {
    throw new Error('巡堂專用寫入仍被既有課表硬限制阻擋');
  }
  const patrolRevisionConflict = context.savePatrolSchedule_(patrolSaveSpreadsheet, { patrolSchedule: [patrolRow], basePatrolSchedule: [] });
  if (!patrolRevisionConflict || !patrolRevisionConflict.blocked || !patrolRevisionConflict.conflict) throw new Error('巡堂版本保護未拒絕過期巡堂資料');
  const stale = context.batchUpdateScheduleLocked_(fakeSpreadsheet, { schedule: [], baseRevision: 'stale-revision' });
    if (!stale || !stale.conflict || scheduleSheet.clearCalls !== 0) throw new Error('過期課表版本未在清除前被拒絕');
    const conflictClearSheet = makeSheet(['課表ID', '班級代碼', '星期', '節次', '科目代碼', '教師姓名', '課堂屬性', '是否鎖定', '是否預排'], [
      { '課表ID': 'CONFLICT-A', '班級代碼': '701', '星期': '1', '節次': '1', '科目代碼': '英語', '教師姓名': 'T01', '課堂屬性': '一般', '是否鎖定': 'FALSE', '是否預排': 'FALSE' },
      { '課表ID': 'CONFLICT-B', '班級代碼': '702', '星期': '1', '節次': '1', '科目代碼': '數學', '教師姓名': 'T01', '課堂屬性': '一般', '是否鎖定': 'FALSE', '是否預排': 'FALSE' }
    ]);
    const conflictClearSpreadsheet = {
      getSheetByName(name) { return name === '課表' ? conflictClearSheet : emptySheets[name]; }
    };
    const conflictClear = context.batchUpdateScheduleLocked_(conflictClearSpreadsheet, {
      schedule: [], clearScope: 'all', clearKeepLockedOnly: true
    });
    if (!conflictClear || conflictClear.ok === false || conflictClearSheet.clearCalls !== 1) throw new Error('清除既有硬限制違規課表時仍被回溯拒絕');
    const pullOutSheet = makeSheet(['課表ID', '班級代碼', '星期', '節次', '科目代碼', '教師姓名', '課堂屬性', '是否鎖定', '是否預排'], [
      { '課表ID': 'PULLOUT-CLEAR', '班級代碼': '701', '星期': '1', '節次': '0', '科目代碼': '抽離課程', '教師姓名': 'T01', '課堂屬性': '抽離', '是否鎖定': 'FALSE', '是否預排': 'FALSE' }
    ]);
    const pullOutSpreadsheet = {
      getSheetByName(name) { return name === '課表' ? pullOutSheet : emptySheets[name]; }
    };
    const pullOutClear = context.batchUpdateScheduleLocked_(pullOutSpreadsheet, {
      schedule: [], clearScope: 'all', clearKeepLockedOnly: true
    });
    if (!pullOutClear || pullOutClear.ok === false || pullOutSheet.clearCalls !== 1) throw new Error('抽離課程仍被當成凍結課程而無法清除');
    const exclusiveSheet = makeSheet(['規則ID', '教師A', '教師B', '備註'], [
      { '規則ID': 'EX1', '教師A': 'T01', '教師B': 'T02', '備註': '手動強制測試' }
    ]);
    const exclusiveScheduleSheet = makeSheet(['課表ID', '班級代碼', '星期', '節次', '科目代碼', '教師姓名', '課堂屬性', '是否鎖定', '是否預排'], [
      { '課表ID': 'EX-A', '班級代碼': '701', '星期': '1', '節次': '1', '科目代碼': '英語', '教師姓名': 'T01', '課堂屬性': '一般', '是否鎖定': 'FALSE', '是否預排': 'FALSE' },
      { '課表ID': 'EX-B', '班級代碼': '702', '星期': '1', '節次': '1', '科目代碼': '數學', '教師姓名': 'T02', '課堂屬性': '一般', '是否鎖定': 'FALSE', '是否預排': 'FALSE' }
    ]);
    const exclusiveSpreadsheet = {
      getSheetByName(name) {
        if (name === '課表') return exclusiveScheduleSheet;
        if (name === '互斥') return exclusiveSheet;
        return emptySheets[name];
      }
    };
    const forcedExclusive = context.batchUpdateScheduleLocked_(exclusiveSpreadsheet, {
      schedule: [
        { '課表ID': 'EX-A', '班級代碼': '701', '星期': '1', '節次': '1', '科目代碼': '英語', '教師姓名': 'T01', '課堂屬性': '一般', '是否鎖定': 'FALSE', '是否預排': 'FALSE' },
        { '課表ID': 'EX-B', '班級代碼': '702', '星期': '1', '節次': '1', '科目代碼': '數學', '教師姓名': 'T02', '課堂屬性': '一般', '是否鎖定': 'FALSE', '是否預排': 'FALSE' }
      ],
      allowSoftTeacherExclusives: true,
      manualSoftWarnings: true
    });
    if (!forcedExclusive || forcedExclusive.ok === false || exclusiveScheduleSheet.clearCalls !== 1) throw new Error('手動強制互斥排課仍被後端回溯拒絕');
    const existingExclusiveScheduleSheet = makeSheet(['課表ID', '班級代碼', '星期', '節次', '科目代碼', '教師姓名', '課堂屬性', '是否鎖定', '是否預排'], [
      { '課表ID': 'OLD-EX-A', '班級代碼': '701', '星期': '1', '節次': '1', '科目代碼': '英語', '教師姓名': 'T01', '課堂屬性': '一般', '是否鎖定': 'FALSE', '是否預排': 'FALSE' },
      { '課表ID': 'OLD-EX-B', '班級代碼': '702', '星期': '1', '節次': '1', '科目代碼': '數學', '教師姓名': 'T02', '課堂屬性': '一般', '是否鎖定': 'FALSE', '是否預排': 'FALSE' }
    ]);
    const existingExclusiveSpreadsheet = {
      getSheetByName(name) {
        if (name === '課表') return existingExclusiveScheduleSheet;
        if (name === '互斥') return exclusiveSheet;
        return emptySheets[name];
      }
    };
    const existingManualWrite = context.batchUpdateScheduleLocked_(existingExclusiveSpreadsheet, {
      schedule: [
        { '課表ID': 'OLD-EX-A', '班級代碼': '701', '星期': '1', '節次': '1', '科目代碼': '英語', '教師姓名': 'T01', '課堂屬性': '一般', '是否鎖定': 'FALSE', '是否預排': 'FALSE' },
        { '課表ID': 'OLD-EX-B', '班級代碼': '702', '星期': '1', '節次': '1', '科目代碼': '數學', '教師姓名': 'T02', '課堂屬性': '一般', '是否鎖定': 'FALSE', '是否預排': 'FALSE' }
      ],
      manualSoftWarnings: true
    });
    if (!existingManualWrite || existingManualWrite.ok === false || existingExclusiveScheduleSheet.clearCalls !== 1) throw new Error('既有教師互斥違規仍阻擋手動整批寫入');
    if (!backend.includes('validateScheduleSnapshot_(schedule')) throw new Error('batch write does not run full snapshot audit');
  if (!backend.includes('LockService.getScriptLock()')) throw new Error('batch write has no concurrent-write lock');
  if (!backend.includes('scheduleRevision:   scheduleRevision_(schedule)')) throw new Error('getAll does not expose schedule revision');
});
check('Quality audit reports teacher mutual exclusion', () => {
  if (!runtime.includes("(state.teacherExclusives||[]).forEach")) throw new Error('quality audit does not scan teacher mutual exclusions');
  if (!runtime.includes('教師互斥違規：')) throw new Error('quality audit has no teacher mutual exclusion diagnostic');
});
check('Export attributes, restricted colors, and multi-teacher rows', () => {
  const exportStart = backend.indexOf('function splitExportList_');
  const exportEnd = backend.indexOf('function exportSchedule_(ss)', exportStart);
  if (exportStart < 0 || exportEnd < 0) throw new Error('export helper block missing');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(backend.slice(exportStart, exportEnd), ctx, { filename: 'export-helpers.js' });
  const classes = {
    '701': { '是否虛擬班': 'FALSE' },
    '707': { '是否虛擬班': 'TRUE' }
  };
  if (ctx.exportScheduleAttr_({ '班級代碼': '701', '節次': '8', '課堂屬性': '一般' }, classes) !== '課輔') throw new Error('period 8 did not export 課輔');
  if (ctx.exportScheduleAttr_({ '班級代碼': '701', '節次': '8', '課堂屬性': '單週' }, classes) !== '單週') throw new Error('single-week attribute missing');
   if (ctx.exportScheduleAttr_({ '班級代碼': '701', '節次': '3', '課堂屬性': '超鐘點' }, classes) !== '超鐘點') throw new Error('overtime attribute missing');
   if (ctx.exportScheduleAttr_({ '班級代碼': '701', '節次': '3', '課堂屬性': '一般' }, classes, { overtime: true }) !== '超鐘點') throw new Error('per-teacher overtime flag missing');
   if (ctx.exportScheduleAttr_({ '班級代碼': '701', '節次': '3', '課堂屬性': '實支' }, classes) !== '實支') throw new Error('實支 attribute was lost');
    if (ctx.exportScheduleAttr_({ '班級代碼': '707', '節次': '3', '課堂屬性': '一般' }, classes) !== '抽離') throw new Error('virtual class did not export 抽離');
   if (ctx.exportScheduleAttr_({ '班級代碼': '701', '節次': '0', '課堂屬性': '一般' }, classes) !== '抽離') throw new Error('early study did not export 抽離');
   if (ctx.exportScheduleAttr_({ '班級代碼': '701', '節次': '45', '課堂屬性': '一般' }, classes) !== '抽離') throw new Error('lunch did not export 抽離');
   if (ctx.exportScheduleAttr_({ '班級代碼': '巡堂', '節次': '3', '課堂屬性': '一般' }, classes) !== '巡堂') throw new Error('巡堂屬性未正規匯出');
  const teacherRows = ctx.parseExportTeachers_('[{"教師姓名":"T1","標籤":"台"},{"教師姓名":"T2","標籤":"手"}]');
  if (teacherRows.length !== 2 || teacherRows[0].code !== 'T1' || teacherRows[1].code !== 'T2') throw new Error('multi-teacher JSON was not split');
    const colored = [{ '科目': '國文', '班級': '', '底色': 'DEEAF6' }];
   if (!ctx.hasExplicitScheduleColor_(colored, { '科目代碼': '國文', '班級代碼': '701' })) throw new Error('configured color did not become restricted');
   if (ctx.hasExplicitScheduleColor_([], { '科目代碼': '國文', '班級代碼': '701' })) throw new Error('fallback color incorrectly became restricted');
   const timedColor = [{ '科目': '英語', '班級': '', '底色': 'ABCDEF', '星期': '4', '起始節次': '2', '結束節次': '4' }];
    if (!ctx.hasExplicitScheduleColor_(timedColor, { '科目代碼': '英語', '班級代碼': '701', '星期': '4', '節次': '2' }) || ctx.hasExplicitScheduleColor_(timedColor, { '科目代碼': '英語', '班級代碼': '701', '星期': '4', '節次': '1' })) throw new Error('後端配色時段範圍判斷錯誤');
    const bindGroups = [{ '班級清單': '701,702', '科目清單': '體育' }];
    if (!ctx.isExportBoundCourse_({ '班級代碼': '701', '科目代碼': '體育' }, bindGroups)) throw new Error('綁班課程未被辨識');
    const plannedAssignments = [{ '班級代碼': '901', '科目代碼': '課輔', '課程屬性': '預排' }];
    if (!ctx.isExportPreplannedCourse_({ '班級代碼': '901', '科目代碼': '課輔' }, plannedAssignments)) throw new Error('預排課程未被辨識');
    if (!backend.includes('filter(scheduleRow => !isExportPreplannedCourse_(scheduleRow, assignments))')) throw new Error('課表匯出未排除預排課程');
    const exportSheets = {
      '課表': [
        { '課表ID': 'PRE-ASSIGNMENT', '班級代碼': '901', '星期': '1', '節次': '1', '科目代碼': '課輔', '教師姓名': 'T1', '課堂屬性': '一般' },
        { '課表ID': 'PRE-ROW', '班級代碼': '902', '星期': '1', '節次': '2', '科目代碼': '數學', '教師姓名': 'T1', '課堂屬性': '預排' },
        { '課表ID': 'LIVE', '班級代碼': '903', '星期': '1', '節次': '3', '科目代碼': '英語', '教師姓名': 'T1', '課堂屬性': '一般' }
      ],
      '配課': [{ '班級代碼': '901', '科目代碼': '課輔', '課程屬性': '預排' }],
      '教師': [{ '教師姓名': 'T1', 'Email': 't1@example.com' }],
      '班級': [{ '班級代碼': '901' }, { '班級代碼': '902' }, { '班級代碼': '903' }],
      '綁班': [],
      '配色': []
    };
    ctx.sheetToObjects_ = sheet => exportSheets[sheet.name] || [];
    ctx.getSettingsMap_ = () => ({ '學期代號': '115-1' });
    ctx.writeExportSheet_ = (_ss, _name, headers, rows) => ({ headers, rows });
    const exportFunctionStart = backend.indexOf('function exportSchedule_(ss)');
    const exportFunctionEnd = backend.indexOf('function exportPatrolSchedule_', exportFunctionStart);
    vm.runInContext(backend.slice(exportFunctionStart, exportFunctionEnd), ctx, { filename: 'schedule-export.js' });
    const exportResult = ctx.exportSchedule_({ getSheetByName: name => ({ name }) });
    if (exportResult.rows.length !== 1 || exportResult.rows[0][1] !== 'LIVE') throw new Error('課表匯出仍包含預排課程');
    const specialTags = ctx.exportScheduleSpecialTags_({ '班級代碼': '701', '科目代碼': '體育' }, bindGroups, []);
    if (specialTags !== '併班、綁課') throw new Error('綁班特殊標記未完整匯出：' + specialTags);
    const usedExportIds = new Set();
    const firstExportId = ctx.exportScheduleRowId_({ '課表ID': 'S1' }, '115-1', 0, 2, 0, usedExportIds);
    const secondExportId = ctx.exportScheduleRowId_({ '課表ID': 'S1' }, '115-1', 0, 2, 1, usedExportIds);
    if (firstExportId === secondExportId) throw new Error('多教師匯出課表ID仍重複');
    if (!backend.includes("headers: ['課表ID', '班級代碼', '星期', '節次', '科目代碼', '教師姓名', '課堂屬性', '是否鎖定']")) throw new Error('schedule schema gained an unexpected column');
   if (backend.includes('是否超鐘點')) throw new Error('backend still contains a separate overtime column');
   if (!backend.includes("patrol ? '' : String(s['班級代碼'] || '')")) throw new Error('巡堂匯出未清空班級欄');
    if (!backend.includes("function exportPatrolSchedule_(ss)")) throw new Error('巡堂專用匯出函式缺少');
    if (!backend.includes("'特殊標記'")) throw new Error('匯出特殊標記欄位缺少');
   if (!backend.includes("case 'savePatrolSchedule'")) throw new Error('巡堂專用寫入路由缺少');
   if (!backend.includes('function savePatrolSchedule_(ss, payload)')) throw new Error('巡堂專用寫入函式缺少');
   });
  check('Web shows all teachers while Word shows only tagged co-teachers', () => {
   const classPaletteStart = app.indexOf('function renderSubjectPalette');
   const classPaletteEnd = app.indexOf('function parseBindList', classPaletteStart);
   const teacherPaletteStart = app.indexOf('function renderTeacherSubjectPalette');
   const teacherPaletteEnd = app.indexOf('// 6. 樂觀切換教師不排課時段', teacherPaletteStart);
   const classPalette = app.slice(classPaletteStart, classPaletteEnd);
   const teacherPalette = app.slice(teacherPaletteStart, teacherPaletteEnd);
   if (!classPalette.includes('teacherList: item?.teacherList')) throw new Error('班級待排卡片未攜帶完整教師清單');
   if (!teacherPalette.includes('teacherList: assignment ? getCellTeacherList(assignment) : []')) throw new Error('教師待排卡片未攜帶完整教師清單');
   if (!classPalette.includes('item.teacherList.map')) throw new Error('網頁班級卡片未顯示主要／協同教師');
   if (!app.includes('teacherList: dragInfo.teacherList')) throw new Error('拖曳排課未同步主要／協同教師');

   const courseStart = wordExport.indexOf('function collectClassCourses');
   const courseEnd = wordExport.indexOf('function slotSubject', courseStart);
   const courseBlock = wordExport.slice(courseStart, courseEnd);
    if (!courseBlock.includes('function upsertTeacherList')) throw new Error('Word 班級課表缺少協同教師標籤判定');
    if (!courseBlock.includes('hiddenRoleTags')) throw new Error('Word 班級課表未排除一般協同角色標籤');
    const wordContext = {
      idx: {
        teacherByCode: {
          T01: {'姓名': '王老師'},
          T02: {'姓名': '本土語老師'},
          T03: {'姓名': '外師'}
        },
        subjectByCode: {'本土語': {'每週節數': '2'}}
      },
      state: {
        assignments: [
          {'班級代碼': '701', '科目代碼': '本土語', '教師姓名': '[{"教師姓名":"T01","標籤":"台"},{"教師姓名":"T02","標籤":"手"},{"教師姓名":"T03","標籤":""}]', '每週節數': '2'}
        ],
        schedule: [
          {'班級代碼': '701', '科目代碼': '本土語', '教師姓名': 'T01', '星期': '1', '節次': '1'},
          {'班級代碼': '701', '科目代碼': '本土語', '教師姓名': 'T02', '星期': '2', '節次': '1'}
        ]
      },
      normalizeSubjectKey: value => String(value || ''),
      getCellTeacherList: cell => {
        const raw = String(cell['教師姓名'] || '');
        if (raw.startsWith('[')) return JSON.parse(raw);
        return raw ? [{'教師姓名': raw, '標籤': ''}] : [];
      }
    };
    vm.createContext(wordContext);
    vm.runInContext(courseBlock, wordContext, {filename: 'class-course-teachers.js'});
    const classCourses = wordContext.collectClassCourses('701');
    if (!classCourses['本土語'] || classCourses['本土語'].teachers.join('、') !== '王老師(台)、本土語老師(手)') {
      throw new Error('Word 班級課表未依語言標籤顯示協同教師');
    }
     if (wordContext.formatClassRanges(['702', '701']) !== '701702' || wordContext.formatClassRanges(['701', '702', '703', '705']) !== '701-703705') {
       throw new Error('Word 班級代碼連號格式錯誤');
     }
     if (wordContext.formatTeacherCourseClassRanges(['701', '702', '704', '705', '706']) !== '701、702、704-706') {
       throw new Error('Word 教師配課班級格式未使用分隔符與連號');
     }
   const roomStart = wordExport.indexOf('function collectRoomTeacherSummary');
   const roomEnd = wordExport.indexOf('function buildRoomDict', roomStart);
   if (!wordExport.slice(roomStart, roomEnd).includes('const teacherList = getCellTeacherList(s)')) throw new Error('Word 教室課表未解析主要教師');
 });
  check('Patrol stays out of room timetable and uses teacher timetable actions', () => {
   for (const marker of [
     'function addPatrolAtTeacherSlot',
     'function movePatrolCell',
     'function deletePatrolCell',
     'draggable: patrol',
     "if (!isPatrol && roomCode)",
     "gasPost('savePatrolSchedule'",
     'basePatrolSchedule',
     '右鍵新增巡堂',
     "target === 'primary' || target === 'third'",
     'function focusPrimaryTeacherForPatrol',
     'const availableTeachers',
     "cell.addEventListener('dragstart'",
     'per: period',
     'const canDropPatrol',
     'cell.dataset.patrolDraggable',
     'patrol-stats-table'
   ]) if (!app.includes(marker)) throw new Error('巡堂功能標記缺少：' + marker);
   if (!read('style.css').includes('.tt-scroll > div[id$="-tt"]')) throw new Error('巡堂統計仍可能被課表最小高度撐開');
   if (html.includes('id="teacher-patrol-toggle"') || html.includes('doExportPatrol')) throw new Error('巡堂按鈕仍存在');
   if (html.includes('third-patrol-select-move') || app.includes('pointerPatrol')) throw new Error('巡堂不應包含替代點選或指標拖曳流程');
   if (html.includes('patrol-config') || html.includes('巡堂設定')) throw new Error('巡堂設定頁籤仍存在');
   if (app.includes('<option value="巡堂">巡堂</option>')) throw new Error('一般課程指派仍可直接選擇巡堂');
   if (!runtime.includes('const isTeachingScheduleEntry') || !runtime.includes('state.schedule.filter(isTeachingScheduleEntry)')) throw new Error('統計未排除巡堂格');
   if (!html.includes('id="word-tab-patrol"') || !html.includes('id="word-patrol-panel"')) throw new Error('Word 巡堂表頁籤缺少');
    if (!wordExport.includes("tab === 'patrol'") || !wordExport.includes('function startPatrolWordExport') || !wordExport.includes('function buildPatrolExcelSheetXml') || !wordExport.includes('loadPatrolExcelTemplate()') || !wordExport.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) throw new Error('Excel 巡堂表匯出流程缺少');
 });
 check('Word patrol export builds a complete table', () => {
  const start = wordExport.indexOf('function buildPatrolRoomDict');
  const end = wordExport.indexOf('async function startPatrolWordExport', start);
  if (start < 0 || end < 0) throw new Error('Word 巡堂表產生器缺少');
  const context = {
    state: { schedule: [{ '星期': '4', '節次': '2', '教師姓名': 'T03', '課堂屬性': '巡堂' }] },
    idx: { teacherByCode: { T03: { '教師姓名': 'T03', '職稱': '行政組長' } } },
    isPatrolScheduleEntry: row => row['課堂屬性'] === '巡堂',
    teacherName: code => code,
    fillPlaceholders: xml => xml,
    escXml: value => String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  };
  vm.createContext(context);
  vm.runInContext(wordExport.slice(start, end), context, { filename: 'word-patrol.js' });
  const dict = context.buildPatrolRoomDict('114', '1');
  if (dict['教室'] !== '全校巡堂' || dict['d4p2_s'] !== '巡堂' || dict['d4p2_c'] !== 'T03' || dict['t1_s1'] !== '巡堂' || dict['t1_h1'] !== 'T03') throw new Error('Word 巡堂表內容不完整');
  if (Object.values(dict).some(value => String(value).includes('undefined'))) throw new Error('Word 巡堂表產生未處理空值');
   const stripped = context.buildPatrolRoomPageXml({bodyInner: '<w:tbl>主表</w:tbl><w:p>任課班級、科目與教師</w:p><w:tbl>任教科目班級教師</w:tbl>'}, '114', '1');
   if (!stripped.includes('主表') || stripped.includes('任課班級、科目與教師') || stripped.includes('任教科目班級教師')) throw new Error('巡堂 Word 未移除任課總表區塊');
  });
  check('Patrol Excel template preserves layout and fills schedule', () => {
   const start = wordExport.indexOf('function xlsxXmlEscape');
   const end = wordExport.indexOf('async function loadPatrolExcelTemplate', start);
   const context = {
     state: { schedule: [
       { '星期': '1', '節次': '1', '教師姓名': 'T01', '課堂屬性': '巡堂' },
       { '星期': '5', '節次': '7', '教師姓名': 'T02', '課堂屬性': '巡堂' },
       { '星期': '2', '節次': '8', '教師姓名': 'T03', '課堂屬性': '巡堂' }
     ] },
     isPatrolScheduleEntry: row => row['課堂屬性'] === '巡堂',
     teacherName: code => ({ T01: '王老師', T02: '李老師', T03: '不應寫入' }[code] || code),
     teacherTitle: code => ({ T01: '教務主任', T02: '特教組長', T03: '不應寫入' }[code] || code)
   };
   vm.createContext(context);
   vm.runInContext(wordExport.slice(start, end), context, { filename: 'patrol-excel.js' });
   const zipContext = { window: {}, self: {}, globalThis: {} };
   vm.createContext(zipContext);
   vm.runInContext(read('pizzip.min.js'), zipContext, { filename: 'pizzip.min.js' });
   const zip = new zipContext.window.PizZip(fs.readFileSync(path.join(root, 'walkthrough-template.xlsx')).toString('binary'));
   const generated = context.buildPatrolExcelSheetXml(
     zip.file('xl/worksheets/sheet1.xml').asText(),
     zip.file('xl/sharedStrings.xml').asText(),
     '115',
     '1'
   );
   if (!generated.sharedStringsXml.includes('臺北市立建成國民中學115學年度第一學期')) throw new Error('巡堂 Excel 標題佔位符未替換');
   if (!generated.sheetXml.includes('r="D5" s="9" t="inlineStr"><is><t>教務主任</t>')) throw new Error('巡堂 Excel 星期一第一節未填入教師');
   if (!generated.sheetXml.includes('r="H23" s="9" t="inlineStr"><is><t>特教組長</t>')) throw new Error('巡堂 Excel 星期五第七節未填入教師');
   if (!generated.sheetXml.includes('r="E5" s="9" t="inlineStr"><is><t></t></is></c>')) throw new Error('巡堂 Excel 空白時段未清除範本示例');
   if (!generated.sheetXml.includes('D5:D7')) throw new Error('巡堂 Excel 範本合併儲存格被破壞');
   if (generated.sheetXml.includes('不應寫入')) throw new Error('巡堂 Excel 不應寫入第八節資料');
   zip.file('xl/worksheets/sheet1.xml', generated.sheetXml);
   zip.file('xl/sharedStrings.xml', generated.sharedStringsXml);
   const roundTrip = new zipContext.window.PizZip(zip.generate({ type: 'uint8array' }));
   if (!roundTrip.file('xl/worksheets/sheet1.xml') || !roundTrip.file('xl/sharedStrings.xml')) throw new Error('巡堂 Excel 範本重新封裝失敗');
  });
   check('Teacher Word course summary keeps native-language groups and actual periods', () => {
    const makeCell = (classCode, day) => ({
      '班級代碼': String(classCode),
      '星期': String(day),
      '節次': '1',
      '科目代碼': '本土語',
      '課堂屬性': '一般',
      '教師姓名': '[{"教師姓名":"T01","標籤":"客"}]'
    });
    const context = {
      state: {
        assignments: [],
        schedule: [
          makeCell(703, 1), makeCell(704, 1),
          makeCell(706, 2), makeCell(707, 2),
          makeCell(802, 3), makeCell(803, 3), makeCell(805, 3), makeCell(806, 3)
        ]
      },
      idx: {},
      getCellTeacherList: cell => JSON.parse(cell['教師姓名'])
    };
     vm.createContext(context);
     vm.runInContext(wordExport, context, { filename: 'word-course-summary.js' });
     const summary = context.collectTeacherCourseSummary('T01');
      if (summary.length !== 3 || summary[0].subject !== '本土語(客)' || summary[0].classRange !== '703、704' || summary[0].hours !== '1' || summary[1].classRange !== '706、707' || summary[1].hours !== '1' || summary[2].classRange !== '802、803、805、806' || summary[2].hours !== '1') {
        throw new Error('本土語併班未依實際時段分列或錯誤顯示各班節數');
      }
     context.state.schedule.push(makeCell(808, 4), makeCell(808, 5));
     const splitSummary = context.collectTeacherCourseSummary('T01');
     const class808 = splitSummary.find(item => item.classRange === '808');
      if (!class808 || class808.hours !== '2' || splitSummary.filter(item => item.classRange.includes('802')).length !== 1) {
        throw new Error('同年級不同配課數未分列');
      }
    });
    check('Teacher Word course summary prioritizes professional and high-count subjects', () => {
      const makeCell = (classCode, subject, day, teacherValue = 'T01') => ({
        '班級代碼': String(classCode),
        '星期': String(day),
        '節次': '1',
        '科目代碼': subject,
        '課堂屬性': '一般',
        '教師姓名': teacherValue
      });
      const context = {
        state: {
          teachers: [],
          assignments: [],
          schedule: [
            makeCell(701, '英語', 1), makeCell(702, '英語', 1), makeCell(703, '英語', 1),
            makeCell(704, '國文', 2), makeCell(705, '文旅享繪', 3, '[{"教師姓名":"T01","超鐘點":true}]'), makeCell(706, '文旅享繪', 4)
          ]
        },
        idx: {
          teacherByCode: { T01: { '任教科目': '國文' } },
          classByCode: {
            701: { '年級': '7', '是否虛擬班': 'FALSE' },
            702: { '年級': '7', '是否虛擬班': 'FALSE' },
            703: { '年級': '7', '是否虛擬班': 'FALSE' },
            704: { '年級': '7', '是否虛擬班': 'FALSE' }
          }
        },
        getCellTeacherList: cell => {
          const raw = String(cell['教師姓名'] || '');
          return raw.startsWith('[') ? JSON.parse(raw) : [{ '教師姓名': raw }];
        }
      };
      vm.createContext(context);
      vm.runInContext(wordExport, context, { filename: 'word-course-summary-priority.js' });
      const professionalFirst = context.collectTeacherCourseSummary('T01');
      if (professionalFirst[0].subject !== '國文') throw new Error('教師專業科目未排在配課摘要前方');
      const overtimeRow = professionalFirst.find(item => item.subjectCode === '文旅享繪');
      if (!overtimeRow || overtimeRow.subject !== '文旅享繪' || professionalFirst.filter(item => item.subjectCode === '文旅享繪').length !== 1) throw new Error('教師 Word 配課摘要仍顯示超鐘點括號或分裂成多列');
      context.idx.teacherByCode.T01['任教科目'] = '';
      const highCountFirst = context.collectTeacherCourseSummary('T01');
      if (highCountFirst[0].subject !== '英語' || highCountFirst[0].classRange !== '701、702、703') throw new Error('課堂較多的科目未排在其他配課前方');
    });
   check('Teacher Word virtual classes show linked regular classes', () => {
    const classes = {
      VA: { '年級': '7', '班級名稱': '七英資 A', '是否虛擬班': 'TRUE' },
      VB: { '年級': '7', '班級名稱': '七英資 B', '是否虛擬班': 'TRUE' }
    };
    ['701', '702', '703', '704', '705', '706'].forEach(code => { classes[code] = { '年級': '7', '班級名稱': code, '是否虛擬班': 'FALSE' }; });
    const cell = (classCode, subject, day) => ({ '班級代碼': classCode, '科目代碼': subject, '星期': String(day), '節次': '1', '課堂屬性': '抽離', '教師姓名': 'T01' });
    const context = {
      state: {
        assignments: [],
        blockGroups: [{ '科目清單': '英語,資優英語', '班級清單': 'VA,701,702,703,VB,704,705,706' }],
        schedule: [
          cell('VA', '資優英語', 1), cell('701', '英語', 1), cell('702', '英語', 1), cell('703', '英語', 1),
          cell('VB', '資優英語', 2), cell('704', '英語', 2), cell('705', '英語', 2), cell('706', '英語', 2)
        ]
      },
      idx: {
        classByCode: classes,
        teacherByCode: { T01: { '姓名': '教師一' } },
        schedByTeacherSlot: {
          'T01|1|1': [
            cell('VA', '資優英語', 1),
            cell('701', '英語', 1),
            cell('702', '英語', 1),
            cell('703', '英語', 1)
          ]
        }
      },
      getCellTeacherList: cellValue => [{ '教師姓名': String(cellValue['教師姓名'] || '') }],
      resolveScheduleColor: () => ''
    };
    vm.createContext(context);
    vm.runInContext(wordExport, context, { filename: 'word-virtual-summary.js' });
    const summary = context.collectTeacherCourseSummary('T01');
     const virtualSummaries = summary.filter(item => String(item.subject).startsWith('資優英語\n'));
     const ranges = virtualSummaries.map(item => item.classRange);
     if (ranges.length !== 2 || virtualSummaries[0].subject !== '資優英語\n7・七英資 A' || ranges[0] !== '701-703' || ranges[1] !== '704-706') {
       throw new Error('抽離班未將虛擬班名稱放在課程下方或未列出綁班普通班');
     }
      if (context.teacherWordSubject(cell('VA', '資優英語', 1), 'T01') !== '資優英語\nVA') {
        throw new Error('抽離班課程格未顯示虛擬班代碼');
      }
      const classInfo = context.teacherWordClassInfoForCells([cell('VA', '資優英語', 1), cell('701', '英語', 1), cell('702', '英語', 1), cell('703', '英語', 1)]);
      if (!classInfo.hasVirtual || context.formatTeacherCourseClassRanges(classInfo.codes) !== '701-703') {
        throw new Error('抽離班課程下方未顯示綁班普通班');
      }
      if (context.teacherWordClassLabel(classInfo.codes).text !== '701、702、703') {
        throw new Error('教師課表抽離班未逐一顯示綁班班級代碼');
      }
      const teacherDict = context.buildTeacherDict('T01', '115', '1');
      if (teacherDict.d1p1_s !== '資優英語\nVA / 英語' || teacherDict.d1p1_c !== '701、702、703') {
        throw new Error('教師 Word 課表未套用抽離班代碼與完整班級列示');
      }
   });
   check('Word multiline placeholder uses valid run breaks', () => {
    const context = {};
    vm.createContext(context);
    vm.runInContext(wordExport, context, { filename: 'word-multiline-placeholder.js' });
    const xml = '<w:tc><w:p><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>{f1師}</w:t></w:r></w:p></w:tc>';
    const filled = context.fillPlaceholders(xml, { 'f1師': '甲老師\n乙老師' });
    if (!filled.includes('<w:br/>') || /<w:t[^>]*>[^<]*<w:br\/>/.test(filled)) {
      throw new Error('多行 Word 文字仍被寫入 w:t 內造成文件損壞');
    }
   });
   check('Teacher Word timetable fills classes and matching colors', () => {
   const context = {
     state: {
       schedule: [
         { '課表ID': 'S1', '班級代碼': '701', '星期': '1', '節次': '1', '科目代碼': '絃竹室內樂', '教師姓名': 'T01', '課堂屬性': '一般' },
         { '課表ID': 'S2', '班級代碼': '702', '星期': '1', '節次': '0', '科目代碼': '早自習', '教師姓名': 'T01', '課堂屬性': '一般' },
         { '課表ID': 'S3', '班級代碼': '703', '星期': '1', '節次': '45', '科目代碼': '午休課', '教師姓名': 'T01', '課堂屬性': '一般' }
       ]
     },
     idx: {
       teacherByCode: { T01: { '教師姓名': 'T01', '姓名': '教師一' } },
       schedByTeacherSlot: {
          'T01|1|0': [{ '班級代碼': '702', '科目代碼': '早自習', '教師姓名': 'T01' }],
          'T01|1|1': [{ '班級代碼': '701', '科目代碼': '絃竹室內樂', '教師姓名': 'T01' }],
          'T01|1|45': [{ '班級代碼': '703', '科目代碼': '午休課', '教師姓名': 'T01' }],
          'T01|2|1': [
            { '班級代碼': '802', '科目代碼': '國文', '教師姓名': 'T01' },
            { '班級代碼': '803', '科目代碼': '國文', '教師姓名': 'T01' },
            { '班級代碼': '805', '科目代碼': '國文', '教師姓名': 'T01' },
            { '班級代碼': '806', '科目代碼': '國文', '教師姓名': 'T01' }
          ],
          'T01|1|8': [{ '班級代碼': '704', '節次': '8', '科目代碼': '國文輔', '課堂屬性': '單週', '教師姓名': '[{"教師姓名":"T01","超鐘點":true}]' }]
       }
     },
      getCellTeacherList: cell => {
        const raw = String(cell['教師姓名'] || '');
        return raw.startsWith('[') ? JSON.parse(raw) : [{ '教師姓名': raw, '標籤': '主' }];
      },
     resolveScheduleColor: (subject, classCode) => subject === '絃竹室內樂' && classCode === '701' ? 'FBE4D5' : '',
     console
   };
   vm.createContext(context);
   vm.runInContext(wordExport, context, { filename: 'word-teacher.js' });
    const dict = context.buildTeacherDict('T01', '114', '1');
     if (dict.d1p1_c !== '701') throw new Error('教師 Word 第 1 節未填入班級代碼');
     if (dict.d1p0_c !== '702' || dict.d1p45_c !== '703') throw new Error('教師 Word 特殊節次未填入班級代碼');
      if (dict.d1p8_s !== '國文輔(單)(超)' || dict.d1p8_s_single !== '國文輔(單)(超)' || dict.d1p8_c !== '704') throw new Error('第八節課輔或超鐘點標記未保留在教師課表格子');
      if (dict['日期'] !== '(日期)' || !context.fillPlaceholders('<w:p><w:r><w:t>{日期}</w:t></w:r></w:p>', { '日期': dict['日期'] }).includes('(日期)')) throw new Error('教師 Word 範本日期標記未保留');
      const templateHeader = context.buildTeacherPageXml({ bodyInner: '<w:p><w:r><w:t>{姓名}教師(日期)</w:t></w:r></w:p>' }, 'T01', '114', '1', false);
      if (!templateHeader.includes('教師一教師(日期)')) throw new Error('教師 Word 範本日期文字未直接替換');
      if (dict.d2p1_c !== '802、803、805、806' || dict.__classFontSizes.d2p1_c !== 18) throw new Error('教師 Word 四班班級列未逐一顯示或未套用 9pt 字體');
     if (context.teacherWordSubject({ '科目代碼': '公民', '節次': '8', '課堂屬性': '單週' }) !== '公民(單)' ||
         context.teacherWordSubject({ '科目代碼': '公民', '節次': '8', '課堂屬性': '雙週' }) !== '公民(雙)') {
      throw new Error('教師 Word 第八節單雙週標籤格式錯誤');
    }
    if (dict.__fills.d1p1_s !== 'FBE4D5' || dict.__fills.d1p1_c !== 'FBE4D5') throw new Error('教師 Word 科目與班級欄位底色未同步');
   });
   check('Teacher Word compact multi-class labels and virtual class names', () => {
    const context = {
      idx: {
        classByCode: {
          VA: { '年級': '7', '班級名稱': '資優 A', '是否虛擬班': 'TRUE' }
        }
      }
    };
    vm.createContext(context);
    vm.runInContext(wordExport, context, { filename: 'word-teacher-class-label.js' });
    const two = context.teacherWordClassLabel(['802', '803']);
    const three = context.teacherWordClassLabel(['802', '803', '805']);
    const four = context.teacherWordClassLabel(['802', '803', '805', '806']);
    const virtual = context.teacherWordClassLabel(['VA']);
    if (two.text !== '802、803' || two.fontSize !== 0) throw new Error('教師 Word 兩班標示格式或字體改變');
    if (three.text !== '802、803、805' || three.fontSize !== 20) throw new Error('教師 Word 三班標示格式或 10pt 字體錯誤');
     if (four.text !== '802、803、805、806' || four.fontSize !== 18) throw new Error('教師 Word 四班以上未逐一顯示或未使用 9pt 字體');
     if (virtual.text !== 'VA') throw new Error('教師 Word 虛擬班未只顯示班級代碼');
    const cell = '<w:tc><w:p><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t>{d1p1_c}</w:t></w:r></w:p></w:tc>';
    const resized = context.applyTeacherClassFontSizes(cell, { d1p1_c: 18 });
    if (!resized.includes('<w:sz w:val="18"/>')) throw new Error('教師 Word 班級列未套用 9pt 字體');
   });
    check('Class Word timetable fills bilingual lesson count', () => {
    const context = {
      state: { assignments: [], schedule: [], teachers: [] },
      idx: {
        classByCode: {
         '701': { '年級': '7', '班級名稱': '七年一班', '雙語課堂數': '2' },
          '702': { '年級': '7', '班級名稱': '七年二班' },
          '703': { '年級': '7', '班級名稱': '七年三班', '雙語課程節數': '3' }
        },
        schedByClassSlot: {},
        schedByClassSlotP8: {},
        subjectByCode: {},
        teacherByCode: {}
      },
      getCellTeacherList: () => [],
      getTeacherHomeroom: () => '',
      resolveScheduleColor: () => ''
    };
    vm.createContext(context);
    vm.runInContext(wordExport, context, { filename: 'word-bilingual-class.js' });
    const dict = context.buildClassDict('701', '115', '1');
    if (dict['雙語課堂數'] !== '2') throw new Error('班級 Word 未帶入雙語課堂數');
    const filled = context.fillPlaceholders('<w:t>雙語課程節數： {雙語課堂數} 節</w:t>', dict);
    if (!filled.includes('雙語課程節數： 2 節')) throw new Error('班級 Word 雙語課堂數佔位符未替換');
    const blankDict = context.buildClassDict('702', '115', '1');
    if (blankDict['雙語課堂數'] !== '') throw new Error('未填雙語課堂數時未保持空白');
    const aliasDict = context.buildClassDict('703', '115', '1');
     if (aliasDict['雙語課堂數'] !== '3') throw new Error('舊雙語課程節數欄名未帶入 Word');
    });
  check('Grade-nine Word science summary splits physics and earth science rows', () => {
    const context = {
      idx: {
        classByCode: { '九年一班': { '年級': '九', '班級名稱': '九年一班' } }
      }
    };
    vm.createContext(context);
    vm.runInContext(wordExport, context, { filename: 'word-grade-nine-science.js' });
    const courseCell = (text, merge = '') => '<w:tc><w:tcPr>' + merge + '</w:tcPr><w:p><w:r><w:t>' + text + '</w:t></w:r></w:p></w:tc>';
    const timetableRow = '<w:tr><w:tc><w:p><w:r><w:t>上方課表保留</w:t></w:r></w:p></w:tc></w:tr>';
    const scienceRow = '<w:tr><w:trPr><w:trHeight w:val="720" w:hRule="atLeast"/></w:trPr>' +
      courseCell('語文') + courseCell('國文') + courseCell('{國文節}') + courseCell('{國文師}') +
      courseCell('自然科學') + courseCell('{生物名}') + courseCell('{生物節}') + courseCell('{生物師}') +
      courseCell('彈性課程') + '</w:tr>';
    const values = context.wordGradeNineNaturalScienceValues({
      __rawCourses: {
        '自然': { teachers: ['自然教師'] },
        '理化': { teachers: ['理化教師'] },
        '地球科學': { teachers: ['地科教師'] }
      }
    });
    const output = context.splitGradeNineNaturalScienceRow('<w:tbl>' + timetableRow + scienceRow + '</w:tbl>', '九年一班', values);
    const rows = context.wordRows(output);
    if (rows.length !== 3 || rows[0] !== timetableRow) throw new Error('九年級自然科學拆列影響上方課表');
    const topCells = context.wordCells(rows[1]);
    const bottomCells = context.wordCells(rows[2]);
    if (!topCells[4].includes('自然科學') || !topCells[5].includes('理化') || !topCells[6].includes('2') || !topCells[7].includes('自然教師')) {
      throw new Error('九年級自然科學上列未輸出理化 2 節');
    }
    if (bottomCells[4].includes('自然科學') || !bottomCells[5].includes('地球科學') || !bottomCells[6].includes('1') || bottomCells[7].includes('自然教師') || bottomCells[7].includes('地科教師')) {
      throw new Error('九年級自然科學下列未輸出地球科學 1 節');
    }
    if (!/<w:vMerge\s+w:val="restart"\s*\/>/.test(topCells[4]) || !/<w:vMerge\s*\/>/.test(bottomCells[4])) {
      throw new Error('自然科學領域欄未跨兩列合併');
    }
    if (rows.slice(1).some(row => /<w:trHeight\b/.test(row))) {
      throw new Error('九年級自然科學拆列仍設定列高');
    }
  });
  check('Grade-nine class Word build keeps timetable above split science summary', () => {
    const context = {
      state: {
        assignments: [
          { '班級代碼': '901', '科目代碼': '理化', '教師姓名': 'T1', '每週節數': '2' },
          { '班級代碼': '901', '科目代碼': '地球科學', '教師姓名': 'T2', '每週節數': '1' },
          { '班級代碼': '901', '科目代碼': '自然', '教師姓名': 'T3', '每週節數': '3' }
        ],
        schedule: [
          { '班級代碼': '901', '科目代碼': '理化', '教師姓名': 'T1', '星期': '1', '節次': '1' },
          { '班級代碼': '901', '科目代碼': '地球科學', '教師姓名': 'T2', '星期': '2', '節次': '1' },
          { '班級代碼': '901', '科目代碼': '自然', '教師姓名': 'T3', '星期': '3', '節次': '1' }
        ],
        teachers: []
      },
      idx: {
        classByCode: {
          '901': { '年級': '9', '班級名稱': '九年一班' },
          '902': { '年級': '9', '班級名稱': '九年二班' }
        },
        subjectByCode: {
          '理化': { '每週節數': '2' },
          '地球科學': { '每週節數': '1' },
          '自然': { '每週節數': '3' }
        },
        teacherByCode: {
          T1: { '姓名': '理化教師' },
          T2: { '姓名': '地科教師' },
          T3: { '姓名': '自然教師' }
        },
        schedByClassSlot: {},
        schedByClassSlotP8: {}
      },
      getCellTeacherList: cell => {
        const code = String(cell && cell['教師姓名'] || '').trim();
        return code ? [{ '教師姓名': code, '標籤': '' }] : [];
      },
      getTeacherHomeroom: () => '',
      resolveScheduleColor: () => ''
    };
    vm.createContext(context);
    vm.runInContext(wordExport, context, { filename: 'word-grade-nine-build.js' });
    const courseCell = (text, merge = '') => '<w:tc><w:tcPr>' + merge + '</w:tcPr><w:p><w:r><w:t>' + text + '</w:t></w:r></w:p></w:tc>';
    const row = (cells, height = 20) => '<w:tr><w:trPr><w:trHeight w:val="' + height + '"/></w:trPr>' + cells.map(courseCell).join('') + '</w:tr>';
    const upperTable = '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr>' +
      '<w:tblGrid>' + Array.from({ length: 9 }, () => '<w:gridCol w:w="1000"/>').join('') + '</w:tblGrid>' +
      row(['上方課表保留']) + '</w:tbl>';
    const summaryTable = '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr>' +
      '<w:tblGrid>' + Array.from({ length: 9 }, () => '<w:gridCol w:w="1000"/>').join('') + '</w:tblGrid>' +
      row(['領域', '科目', '節數', '授課老師', '領域', '科目', '節數', '授課老師', '領域']) +
      row(['語文', '國文', '{國文節}', '{國文師}', '自然科學', '{生物名}', '{生物節}', '{生物師}', '彈性課程']) +
      row(['', '英語', '{英語節}', '{英語師}', '綜合活動', '{家政名}', '{家政節}', '{家政師}', '{f1科}']) +
      row(['', '本土語', '{本土語節}', '{本土語師}', '社會', '{歷史名}', '{歷史節}', '{歷史師}', '{f2科}']) +
      '</w:tbl>';
    const bodyInner = upperTable + summaryTable;
    const page = context.buildClassPageXml({ bodyInner }, '901', '115', '1', false);
    const tables = [...page.matchAll(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g)].map(match => match[0]);
    const summaryRows = context.wordRows(tables[1] || '');
    const scienceRows = summaryRows.filter(item => item.includes('理化') || item.includes('地球科學'));
    if (tables.length !== 2 || !tables[0].includes('上方課表保留') || tables[0].includes('理化') || scienceRows.length !== 2) {
      throw new Error('九年級班級 Word 輸出未保留上方課表或未產生兩列自然科學');
    }
    const nonScienceRows = summaryRows.filter(item => !scienceRows.includes(item));
    if (nonScienceRows.some(item => context.wordRowHeightValue(item) !== 20) || scienceRows.some(item => /<w:trHeight\b/.test(item)) || scienceRows.some(item => item.includes('<w:tbl>'))) {
      throw new Error('九年級自然科學未移除列高或其他摘要列高度錯誤');
    }
    if (!scienceRows[0].includes('理化') || !scienceRows[0].includes('>2<') || !scienceRows[0].includes('自然教師') || !scienceRows[1].includes('地球科學') || !scienceRows[1].includes('>1<') || scienceRows[1].includes('自然教師') || scienceRows[1].includes('地科教師')) {
      throw new Error('九年級班級 Word 輸出自然科學科目或節數錯誤');
    }
    if (page.includes('{生物名}') || page.includes('{生物節}') || page.includes('{生物師}')) {
      throw new Error('九年級班級 Word 自然科學佔位符未清除');
    }
  });
  check('Word table grid widths stay fixed after period-eight expansion', () => {
    const context = {
      idx: {
        schedByClassSlotP8: Object.fromEntries([1, 2, 3, 4, 5].map(day => [
          '701|' + day + '|8',
          { '單週': { '科目代碼': '英語' }, '雙週': { '科目代碼': '數學' } }
        ]))
      }
    };
    vm.createContext(context);
    vm.runInContext(wordExport, context, { filename: 'word-fixed-grid.js' });
    const q = '"';
    const cell = (text, span, width) => '<w:tc><w:tcPr><w:tcW w:w=' + q + width + q + ' w:type=' + q + 'dxa' + q + '/><w:gridSpan w:val=' + q + span + q + '/></w:tcPr><w:p><w:r><w:t>' + text + '</w:t></w:r></w:p></w:tc>';
    const grid = '<w:tblGrid>' + Array.from({ length: 7 }, () => '<w:gridCol w:w="1000"/>').join('') + '</w:tblGrid>';
    const p8Row = '<w:tr>' + cell('時間', 1, 1000) + cell('8', 1, 1000) + [1, 2, 3, 4, 5].map(day => cell('{d' + day + 'p8}', 1, 1000)).join('') + '</w:tr>';
    const summaryRow = '<w:tr>' + cell('領域', 1, 1) + cell('科目', 1, 1) + [1, 2, 3, 4, 5].map(() => cell('摘要', 1, 1)).join('') + '</w:tr>';
    const input = '<w:tbl><w:tblPr><w:tblW w:w="7000" w:type="dxa"/></w:tblPr>' + grid + p8Row + summaryRow + '</w:tbl>';
    const output = context.wordLockTableColumns(context.splitClassP8Row(input, '701'));
    const table = output.match(/<w:tbl[\s\S]*?<\/w:tbl>/)[0];
    if (!table.includes('<w:tblLayout w:type="fixed"/>')) throw new Error('Word 表格未強制固定版面');
    const gridWidths = (table.match(/<w:gridCol[^>]*>/g) || []).map(tag => Number(tag.match(/w:w="(\d+)"/)[1]));
    context.wordRows(table).forEach((row, rowIndex) => {
      let cursor = 0;
      context.wordCells(row).forEach((cellXml, cellIndex) => {
        const span = context.wordCellGridSpan(cellXml);
        const expected = gridWidths.slice(cursor, cursor + span).reduce((sum, width) => sum + width, 0);
        const actual = context.wordCellWidth(cellXml);
        if (actual !== expected) throw new Error('第 ' + rowIndex + ' 列第 ' + cellIndex + ' 格寬度未對齊 tblGrid');
        cursor += span;
      });
      if (cursor !== gridWidths.length) throw new Error('第 ' + rowIndex + ' 列未填滿 tblGrid');
    });
  });
  check('Preplanned course schema and display rules replace legacy preset fields', () => {
   if (!backend.includes("headers: ['配課ID', '班級代碼', '科目代碼', '教師姓名', '課程屬性', '每週節數', '備註']")) throw new Error('配課 schema 缺少課程屬性');
   if (!backend.includes("headers: ['課表ID', '班級代碼', '星期', '節次', '科目代碼', '教師姓名', '課堂屬性', '是否鎖定']")) throw new Error('課表 schema 仍保留舊預排欄位');
   for (const legacy of ['預排星期', '預排節次', '是否預排']) {
     if (backend.includes(legacy) || app.includes(legacy) || runtime.includes(legacy) || html.includes(legacy)) throw new Error('生產程式仍引用舊欄位：' + legacy);
   }
   if (!runtime.includes('matrixAssignmentAttribute') || !runtime.includes("isPreplannedCourse(assignment['課程屬性'])")) throw new Error('配課預排屬性未接入前端');
   if (!runtime.includes('isPreplannedScheduleEntry(cell)')) throw new Error('預排課程未排除教師鐘點');
    if (wordExport.includes('wordEnsureP8TemplateFontColors(page)') || wordExport.includes("applyWordPlaceholderFontColors(page, preplannedKeys, '7F7F7F')")) throw new Error('Word 匯出仍覆寫範本預設字色');
 });
    check('Class Word timetable includes regular period eight courses', () => {
    const start = wordExport.indexOf('function slotSubject(classCode, day, period)');
    const end = wordExport.indexOf('function slotSubjectP8', start);
    if (start < 0 || end < 0) throw new Error('班級 Word 第八節科目函式缺少');
      const context = {
        classWordSubjectLabel: value => String(value || ''),
       idx: {
        schedByClassSlot: {
          '701|1|8': { '科目代碼': '一般課程' }
        },
        schedByClassSlotP8: {
          '701|1|8': {
            '單週': { '科目代碼': '單週課輔' },
            '雙週': { '科目代碼': '雙週課輔' }
          }
        }
       }
     };
    vm.createContext(context);
    vm.runInContext(wordExport.slice(start, end), context, { filename: 'word-class-p8.js' });
      if (context.slotSubject('701', 1, 8) !== '一般課程 / 單週課輔(單) / 雙週課輔(雙)') {
       throw new Error('班級 Word 第八節未合併一般與單雙週課程');
      }
    });
    check('Class Word subject names break at phrase boundaries', () => {
      const start = wordExport.indexOf('function classWordSubjectLabel');
      const end = wordExport.indexOf('function slotSubject', start);
      const context = {};
      vm.createContext(context);
      vm.runInContext(wordExport.slice(start, end), context, { filename: 'word-subject-line-break.js' });
      const cases = [
        ['絃竹室內樂', '絃竹\n室內樂'],
        ['絲竹室內樂', '絲竹\n室內樂'],
        ['英悅讀樂樂', '英悅\n讀樂樂'],
        ['術科（副修）', '術科\n（副修）'],
        ['術科(主修)', '術科\n（主修）'],
        ['生活科技', '生活科技']
      ];
      cases.forEach(([input, expected]) => {
        if (context.classWordSubjectLabel(input) !== expected) throw new Error('科目詞組斷行錯誤：' + input);
      });
    });
   check('Word lunch row keeps the class period column and hides empty grade-nine native language row', () => {
     const context = { idx: { classByCode: { '九年一班': { '年級': '九', '班級名稱': '九年一班' }, '707': { '年級': '7', '班級名稱': '七年七班(音樂班)' }, '701': { '年級': '7', '班級名稱': '七年一班' }, '801': { '年級': '8', '班級名稱': '八年一班' }, '802': { '年級': '8', '班級名稱': '八年二班' } }, schedByClassSlotP8: { '901|4|8': { '單週': { '科目代碼': '生物輔' }, '雙週': { '科目代碼': '社會輔' } } } } };
     vm.createContext(context);
     vm.runInContext(wordExport, context, { filename: 'word-special-layout.js' });
     const cell = (token, span, width) => '<w:tc><w:tcPr><w:tcW w:w="' + width + '" w:type="dxa"/><w:gridSpan w:val="' + span + '"/></w:tcPr><w:p><w:r><w:t>' + token + '</w:t></w:r></w:p></w:tc>';
      const widths = [745, 919, 343, 224, 1071, 204, 709, 562, 430, 567, 478, 798, 710, 1134, 310, 250, 7, 1222];
      const grid = '<w:tblGrid>' + widths.map(width => '<w:gridCol w:w="' + width + '"/>').join('') + '</w:tblGrid>';
      const daySpans = [3, 3, 2, 2, 3];
      const dayWidths = [1475, 1475, 1508, 1444, 1479];
      const regular = '<w:tr>' + cell('08:30~09:15', 3, 2007) + cell('1', 2, 1295) + daySpans.map((span, index) => cell('{d' + (index + 1) + 'p1}', span, dayWidths[index])).join('') + '</w:tr>';
      const p8 = '<w:tr>' + cell('16:10~16:55', 3, 2007) + cell('8', 2, 1295) + daySpans.map((span, index) => cell('{d' + (index + 1) + 'p8}', span, dayWidths[index])).join('') + '</w:tr>';
      const lunch = '<w:tr>' + cell('12:35~13:15', 3, 2007) + cell('午休', 15, 8676) + '</w:tr>';
      const courseCell = (text, merge = '') => '<w:tc><w:tcPr>' + merge + '</w:tcPr><w:p><w:r><w:t>' + text + '</w:t></w:r></w:p></w:tc>';
      const nativeTop = '<w:tr>' + courseCell('語文', '<w:vMerge w:val="restart"/>') + courseCell('國文') + courseCell('{國文節}') + courseCell('{國文師}') + courseCell('童軍') + courseCell('{童軍節}') + courseCell('{童軍師}') + '</w:tr>';
      const nativeSource = '<w:tr>' + courseCell('', '<w:vMerge/>') + courseCell('英語') + courseCell('{英語節}') + courseCell('{英語師}') + courseCell('童軍') + courseCell('{童軍節}') + courseCell('{童軍師}') + '</w:tr>';
      const nativeRow = '<w:tr>' + courseCell('', '<w:vMerge/>') + courseCell('本土語') + courseCell('{本土語節}') + courseCell('{本土語師}') + courseCell('彈課') + courseCell('{彈課節}') + courseCell('{彈課師}') + '</w:tr>';
      const input = '<w:tbl><w:tblPr></w:tblPr>' + grid + regular + p8 + lunch + nativeTop + nativeSource + nativeRow + '</w:tbl>';
     const expanded = context.expandWordSpecialRows(input, { d1p45: '英資班午休' }, 'class');
     const lunchRow = context.wordRows(expanded).find(row => row.includes('{d1p45}'));
     const lunchCells = context.wordCells(lunchRow);
     const lunchSpans = lunchCells.map(context.wordCellGridSpan);
     if (lunchCells.length !== 7 || lunchSpans.join('|') !== '3|2|3|3|2|2|3' || context.wordCellWidth(lunchCells[1]) !== 1295) throw new Error('班級 Word 午休有課列仍未補回節次欄');
      const split = context.splitClassP8Row(expanded, '901');
       const filled = context.fillPlaceholders(split, { d4p8s: '生物輔(單)', d4p8d: '社會輔(雙)' });
      const p8Row = context.wordRows(filled).find(row => row.includes('生物輔(單)'));
     const p8Cells = context.wordCells(p8Row);
      if ((filled.match(/<w:gridCol/g) || []).length !== 31 || p8Cells.length !== 8 || context.wordCellWidth(p8Cells[5]) !== context.wordCellWidth(p8Cells[6])) throw new Error('週四第八節單雙週欄仍未平均切分');
       const targeted = context.applyClassCourseTemplateRules(input, '九年一班', false);
       const targetedRows = context.wordRows(targeted);
       const chineseRow = targetedRows.find(row => row.includes('國文'));
       const englishRow = targetedRows.find(row => row.includes('英語'));
       const emptyNativeRow = targetedRows.find(row => row.includes('彈課') && !row.includes('本土語'));
       const englishCourseCell = context.wordCells(englishRow).find(cell => cell.includes('英語'));
       const emptyNativeCourseCell = context.wordCells(emptyNativeRow)[1];
       if (!chineseRow || !englishRow || !emptyNativeRow || !englishCourseCell || englishCourseCell.includes('國文') || !emptyNativeCourseCell || !/<w:vMerge\s*\/>/.test(emptyNativeCourseCell) || (targeted.match(/<w:tbl(?:\s[^>]*)?>/g) || []).length !== 1) throw new Error('本土語空白列未只與英語局部合併');
        const languageSingleHeight = context.wordRowHeightValue(chineseRow);
        const languageMergedHeight = context.wordRowHeightValue(englishRow) + context.wordRowHeightValue(emptyNativeRow);
         if (languageSingleHeight !== 20 || languageMergedHeight !== 40 || !chineseRow.includes('w:trHeight w:val="20" w:hRule="atLeast"') || !englishRow.includes('w:trHeight w:val="20" w:hRule="atLeast"') || !emptyNativeRow.includes('w:trHeight w:val="20" w:hRule="atLeast"')) throw new Error('下方配課摘要列未使用最小列高');
       const artsInput = '<w:tbl>' +
         '<w:tr>' + courseCell('藝術') + courseCell('音樂') + courseCell('{音樂節}') + courseCell('{音樂師}') + '</w:tr>' +
         '<w:tr>' + courseCell('') + courseCell('視覺藝術') + courseCell('{視覺藝術節}') + courseCell('{視覺藝術師}') + '</w:tr>' +
         '<w:tr>' + courseCell('') + courseCell('表演藝術') + courseCell('{表演藝術節}') + courseCell('{表演藝術師}') + '</w:tr>' +
         '</w:tbl>';
        const musicOutput = context.applyClassCourseTemplateRules(artsInput, '707', true, '表演藝術');
        const musicRows = context.wordRows(musicOutput);
        const musicCell = context.wordCells(musicRows[0])[1];
        if (!musicCell.includes('表演藝術') || musicCell.includes('音樂') || musicCell.includes('視覺藝術') || !/<w:vMerge\s+w:val="restart"\s*\/>/.test(musicCell) || !/<w:vMerge\s*\/>/.test(context.wordCells(musicRows[2])[1])) throw new Error('音樂班藝術三列未依實際科目合併');
       if (!context.isWordGradeNineClass('九年一班') || context.hasWordCourseData({ '本土語': { periods: 0, teachers: [] } }, '本土語')) throw new Error('九年級或空白本土語資料判斷錯誤');
       context.state = { schedule: [{ '班級代碼': '901', '科目代碼': '英語' }] };
       if (context.hasWordCourseData({ '本土語': { periods: 3, teachers: ['教師甲'] } }, '本土語', '901')) throw new Error('僅有本土語配課資料時仍誤判為已開課');
       context.state.schedule.push({ '班級代碼': '901', '科目代碼': '本土語(客)' });
       if (!context.hasWordCourseData({ '本土語': { periods: 0, teachers: [] } }, '本土語', '901')) throw new Error('實際本土語課表資料未被辨識');
       if (!context.isWordMusicClass('707') || context.isWordMusicClass('701') || !context.isWordMusicClass('802') || context.isWordMusicClass('801')) throw new Error('音樂班辨識條件錯誤');
       context.state = { schedule: [{ '班級代碼': '707', '科目代碼': '表演藝術' }] };
       if (context.wordMusicCourseSubject({ '表演藝術': { periods: 1, teachers: ['教師甲'] } }, '707') !== '表演藝術') throw new Error('音樂班實際藝術科目未辨識');
      const flexLabel = '<w:tc><w:p><w:r><w:t>彈性</w:t></w:r><w:r><w:t>課程</w:t></w:r></w:p></w:tc>';
      if (!context.renameWordMusicClassFlexLabel(flexLabel).includes('專業')) throw new Error('音樂班配課標題未改為專業課程');
      if (context.renameWordMusicClassFlexLabel('<w:tc><w:t>彈性課程</w:t></w:tc>') !== '<w:tc><w:t>專業課程</w:t></w:tc>') throw new Error('音樂班彈性課程標題替換錯誤');
        if (!wordExport.includes('applyClassCourseTemplateRules') || wordExport.includes('wordNestedCourseTable') || !wordExport.includes('hasWordCourseData') || !wordExport.includes('renameWordMusicClassFlexLabel')) throw new Error('班級 Word 範本規則未接入');
   });
   check('Word period eight splits single and double week cells', () => {
    const context = {
      state: { schedule: [] },
      idx: {
        schedByTeacherSlot: {
          'T01|1|8': [
            { '科目代碼': '公民', '班級代碼': '906', '節次': '8', '課堂屬性': '單週' },
            { '科目代碼': '公民', '班級代碼': '904', '節次': '8', '課堂屬性': '雙週' }
          ]
        },
       schedByClassSlotP8: Object.fromEntries([1, 2, 3, 4, 5].map(day => [
         '701|' + day + '|8',
         {
           '單週': { '科目代碼': '生物輔' },
           '雙週': { '科目代碼': '社會輔' }
         }
       ]))
      },
      isPatrolScheduleEntry: () => false
    };
    vm.createContext(context);
    vm.runInContext(wordExport, context, { filename: 'word-p8-split.js' });
     const cell = token => '<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p><w:r><w:rPr><w:color w:val="BFBFBF"/></w:rPr><w:t>' + token + '</w:t></w:r></w:p></w:tc>';
    const teacherRow = (token, marker) => '<w:tr>' + cell(marker) + cell(marker) + cell(marker) +
      [1, 2, 3, 4, 5].map(day => cell(token.replace('1', String(day)))).join('') + '</w:tr>';
    const classRow = token => '<w:tr>' + cell('a') + cell('a') +
      [1, 2, 3, 4, 5].map(day => cell(token.replace('1', String(day)))).join('') + '</w:tr>';
    const grid = count => '<w:tblGrid>' + Array.from({ length: count }, () => '<w:gridCol w:w="1200"/>').join('') + '</w:tblGrid>';
    const teacherInput = '<w:tbl><w:tblPr></w:tblPr>' + grid(8) + teacherRow('{d1p8_s}', 'a') + teacherRow('{d1p8_c}', 'b') + '</w:tbl>';
    const classInput = '<w:tbl><w:tblPr></w:tblPr>' + grid(7) + classRow('{d1p8}') + '</w:tbl>';
     const teacherOutput = context.splitTeacherP8Rows(teacherInput, 'T01');
     const classOutput = context.splitClassP8Row(classInput, '701');
     const teacherFilled = context.fillPlaceholders(teacherOutput, {
        d1p8_s_single: '公民(單)', d1p8_s_double: '公民(雙)',
       d1p8_c_single: '906', d1p8_c_double: '904'
     });
      const classFilled = context.fillPlaceholders(classOutput, {
         d1p8s: '生物輔(單)', d1p8d: '社會輔(雙)'
      });
      if (!teacherFilled.includes('公民(單)') || !teacherFilled.includes('公民(雙)') ||
         !teacherFilled.includes('906') || !teacherFilled.includes('904') ||
         (teacherOutput.match(/<w:gridCol/g) || []).length !== 13 ||
         (teacherOutput.match(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g) || []).length !== 18 ||
         teacherOutput.includes('<w:insideV') ||
          !teacherOutput.includes('<w:color w:val="BFBFBF"/>') ||
          !teacherOutput.includes('<w:sz w:val="24"/>') || !teacherOutput.includes('<w:szCs w:val="24"/>')) {
       throw new Error('教師 Word 第八節未分割單雙週科目與班級儲存格');
     }
      if (!classFilled.includes('生物輔(單)') || !classFilled.includes('社會輔(雙)') ||
          (classOutput.match(/<w:gridCol/g) || []).length !== 12 ||
         (classOutput.match(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g) || []).length !== 12 ||
         classOutput.includes('<w:insideV') || !classOutput.includes('<w:color w:val="BFBFBF"/>') ||
         !classOutput.includes('<w:sz w:val="24"/>') || !classOutput.includes('<w:szCs w:val="24"/>')) {
       throw new Error('班級 Word 第八節未分割單雙週儲存格');
       }
        const normalizedP8Row = context.wordRows(classOutput).find(row => row.includes('d1p8s'));
        const normalizedP8Cells = context.wordCells(normalizedP8Row);
       for (let day = 1; day <= 5; day++) {
         const singleIndex = normalizedP8Cells.findIndex(cell => cell.includes('d' + day + 'p8s'));
         const doubleIndex = normalizedP8Cells.findIndex(cell => cell.includes('d' + day + 'p8d'));
         if (singleIndex < 0 || doubleIndex < 0 || Math.abs(context.wordCellWidth(normalizedP8Cells[singleIndex]) - context.wordCellWidth(normalizedP8Cells[doubleIndex])) > 1) {
           throw new Error('班級 Word 第八節星期' + day + '單雙週欄重算後未平均');
         }
       }
   });
   check('Per-teacher overtime marker survives backend normalization', () => {
   const start = backend.indexOf('function isTeacherOvertimeValue_');
   const end = backend.indexOf('function teacherCodesFromValue_', start);
   const context = {};
   vm.createContext(context);
   vm.runInContext(backend.slice(start, end), context, { filename: 'teacher-overtime-normalization.js' });
   const raw = '[{"教師姓名":"T01","標籤":"台","超鐘點":true},{"教師姓名":"T02","標籤":"手"}]';
   const list = context.teacherEntriesFromValue_(raw);
   if (list.length !== 2 || list[0]['超鐘點'] !== true || list[1]['超鐘點']) throw new Error('GAS 未保留教師個別超鐘點標記');
   const encoded = context.serializeTeacherEntries_(list);
   if (!encoded.includes('"超鐘點":true') || !encoded.includes('T02')) throw new Error('GAS 個別超鐘點資料序列化錯誤');
   if (!context.normalizeTeacherCode_(raw).includes('"超鐘點":true')) throw new Error('updateCell 正規化遺失個別超鐘點標記');
    if (!backend.includes('targetTeacher') || !backend.includes('applyTeacherOvertimeRow_')) throw new Error('GAS setOvertime 未接入指定教師');
   const setStart = backend.indexOf('function setOvertime_');
   const setEnd = backend.indexOf('// ===================== 設定資料 =====================', setStart);
    const headers = ['課表ID', '班級代碼', '星期', '節次', '科目代碼', '教師姓名', '課堂屬性', '是否鎖定'];
    const row = { '課表ID': 'S1', '班級代碼': '701', '星期': '1', '節次': '1', '科目代碼': '本土語', '教師姓名': raw, '課堂屬性': '一般', '是否鎖定': 'FALSE' };
   const sheet = {
     rows: [row],
     getLastRow: () => 2,
     getSheetValues: () => sheet.rows,
     getRange: (rowNumber, columnNumber) => ({ setValue(value) { sheet.rows[rowNumber - 2][headers[columnNumber - 1]] = value; } })
   };
   const spreadsheet = { getSheetByName: name => name === '課表' ? sheet : null };
   context.SHEET_DEFS = { '課表': { headers } };
   context.isManualOnlyPeriod_ = period => [0, 45].includes(parseInt(period, 10));
   context.sheetToObjects_ = currentSheet => currentSheet.rows;
   context.scheduleRevision_ = () => 'rev';
   vm.runInContext(backend.slice(setStart, setEnd), context, { filename: 'set-teacher-overtime.js' });
     const result = context.setOvertime_(spreadsheet, { classCode: '701', day: 1, period: 1, teacherCode: 'T01', isOvertime: true });
     const saved = JSON.parse(row['教師姓名']);
     if (!result.ok || !saved[0]['超鐘點'] || saved[1]['超鐘點'] || row['課堂屬性'] !== '一般') throw new Error('GAS 超鐘點寫回仍會套用所有協同教師');
     const singleRow = { '課表ID': 'S2', '班級代碼': '702', '星期': '1', '節次': '2', '科目代碼': '英語', '教師姓名': 'T03', '課堂屬性': '一般', '是否鎖定': 'FALSE' };
     sheet.rows = [singleRow];
     const singleResult = context.setOvertime_(spreadsheet, { classCode: '702', day: 1, period: 2, teacherCode: 'T03', isOvertime: true });
     if (!singleResult.ok || singleRow['教師姓名'] !== 'T03' || singleRow['課堂屬性'] !== '超鐘點') throw new Error('GAS 單一教師超鐘點仍寫入教師姓名 JSON');
     const singleOff = context.setOvertime_(spreadsheet, { classCode: '702', day: 1, period: 2, teacherCode: 'T03', isOvertime: false });
     if (!singleOff.ok || singleRow['教師姓名'] !== 'T03' || singleRow['課堂屬性'] !== '一般') throw new Error('GAS 單一教師取消超鐘點未還原課堂屬性');
     });
     check('Automatic overtime prioritizes flexible subject concentration and class order', () => {
      const start = app.indexOf('const AUTO_OVERTIME_FIXED_SUBJECTS');
      const end = app.indexOf('// 5. 樂觀鎖定/解鎖格位', start);
      const classes = ['701', '702', '902', '903', '904'].map(code => ({ '班級代碼': code, '年級': code.charAt(0), '班級名稱': code }));
      const schedule = [
        { '班級代碼': '701', '科目代碼': '英語', '教師姓名': 'T01', '星期': '1', '節次': '1', '課堂屬性': '一般' },
        { '班級代碼': '702', '科目代碼': '英語', '教師姓名': 'T01', '星期': '1', '節次': '1', '課堂屬性': '一般' },
        { '班級代碼': '904', '科目代碼': '走讀建成生活圈', '教師姓名': 'T01', '星期': '1', '節次': '3', '課堂屬性': '一般' },
        { '班級代碼': '903', '科目代碼': '走讀建成生活圈', '教師姓名': 'T01', '星期': '2', '節次': '3', '課堂屬性': '一般' },
        { '班級代碼': '902', '科目代碼': '走讀建成生活圈', '教師姓名': 'T01', '星期': '3', '節次': '3', '課堂屬性': '一般' },
        { '班級代碼': '901', '科目代碼': '班週會', '教師姓名': 'T01', '星期': '4', '節次': '1', '課堂屬性': '一般' },
        { '班級代碼': '901', '科目代碼': '走讀建成生活圈', '教師姓名': 'T01', '星期': '5', '節次': '8', '課堂屬性': '一般' },
       { '班級代碼': '901', '科目代碼': '未來課程', '教師姓名': 'T01', '星期': '5', '節次': '2', '課堂屬性': '一般', '課程屬性': '預排' }
      ];
      schedule[2]['課堂屬性'] = '超鐘點';
      const context = {
        console,
        state: { teachers: [{ '教師姓名': 'T01', '任教科目': '英語', '基本鐘點': '2' }], schedule },
        idx: {
          classByCode: Object.fromEntries(classes.map(row => [row['班級代碼'], row])),
          teacherByCode: { T01: { '教師姓名': 'T01', '任教科目': '英語', '基本鐘點': '2' } }
        },
        DAY_NAMES: ['', '週一', '週二', '週三', '週四', '週五'],
        getCellTeacherList: cell => [{ '教師姓名': String(cell['教師姓名'] || '') }],
        normalizeTeacherList: list => list.map(item => ({ ...item })),
        isTeacherOvertimeItem: item => item && item['超鐘點'] === true,
        isOvertimeScheduleEntry: cell => String(cell && cell['課堂屬性'] || '') === '超鐘點',
        isPatrolScheduleEntry: () => false,
        isPreplannedScheduleEntry: cell => String(cell?.['課程屬性'] || '') === '預排',
        countTeacherFormalScheduleHours: () => 5
      };
      vm.createContext(context);
      vm.runInContext(app.slice(start, end), context, { filename: 'auto-overtime-planner.js' });
      const plan = context.buildAutomaticOvertimeTeacherPlan('T01');
      if (plan.formalHours !== 5 || plan.targetSlots !== 3) throw new Error('超鐘點額度未依實際節數減基本鐘點計算');
       if (plan.selected.length !== 3 || plan.selected.some(item => item.subjectCode !== '走讀建成生活圈')) throw new Error('未優先選擇可剛好填滿額度的彈性科目群組');
       if (plan.selected.map(item => item.classCodes[0]).join(',') !== '904,903,902') throw new Error('彈性科目群組未依九年級班號遞減選取');
       if (plan.existingSlots !== 1 || context.automaticOvertimeResetChanges().length !== 1) throw new Error('自動超鐘點未先辨識既有標記');
       const rebalanceChanges = context.automaticOvertimeChangesForPlans([plan]);
       const oldMark = rebalanceChanges.findIndex(change => change.classCode === '904' && change.isOvertime === false);
       const newMark = rebalanceChanges.findIndex(change => change.classCode === '904' && change.isOvertime === true);
       if (oldMark < 0 || newMark < 0 || oldMark > newMark) throw new Error('自動超鐘點未依先清除後重新分配順序寫回');
      const English = plan.candidates.find(item => item.subjectCode === '英語');
       if (!English || English.classCodes.join(',') !== '702,701' || English.cells.length !== 2) throw new Error('併班候選未合併或班級排序錯誤');
       if (plan.candidates.some(item => item.period === 8)) throw new Error('第八節不應列入自動超鐘點候選');
       if (plan.candidates.some(item => item.subjectCode === '未來課程')) throw new Error('預排課程不應列入自動超鐘點候選');
       const dispersion = context.selectAutomaticOvertimeCandidates([
         { subjectKey: '彈課', languageTag: '', tier: 0, day: 1, period: 1, classRank: 1, dayLoad: 1 },
         { subjectKey: '彈課', languageTag: '', tier: 0, day: 1, period: 2, classRank: 1, dayLoad: 1 },
         { subjectKey: '彈課', languageTag: '', tier: 0, day: 2, period: 1, classRank: 1, dayLoad: 1 },
         { subjectKey: '彈課', languageTag: '', tier: 0, day: 3, period: 1, classRank: 1, dayLoad: 1 }
       ], 3);
       if (new Set(dispersion.selected.map(item => item.day)).size !== 3 || dispersion.selected.map(item => item.day).join(',') !== '3,2,1') throw new Error('同順位超鐘點未依週五至週一分散標記');
     });
    check('Backend batch overtime writes only the selected teacher and guards revision', () => {
      const start = backend.indexOf('function isTeacherOvertimeValue_');
      const end = backend.indexOf('// ===================== 設定資料 =====================', start);
      const headers = ['課表ID', '班級代碼', '星期', '節次', '科目代碼', '教師姓名', '課堂屬性', '是否鎖定'];
      const row = { '課表ID': 'S1', '班級代碼': '701', '星期': '1', '節次': '1', '科目代碼': '英語', '教師姓名': '[{"教師姓名":"T01"},{"教師姓名":"T02","超鐘點":true}]', '課堂屬性': '一般', '是否鎖定': 'FALSE' };
      const sheet = {
        rows: [row],
        getRange: (rowNumber, columnNumber, rowCount, columnCount) => ({
          setValues(values) { values[0].forEach((value, index) => { sheet.rows[rowNumber - 2][headers[index]] = value; }); },
          setValue(value) { sheet.rows[rowNumber - 2][headers[columnNumber - 1]] = value; }
        })
      };
      const context = {};
      vm.createContext(context);
      vm.runInContext(backend.slice(start, end), context, { filename: 'batch-teacher-overtime.js' });
      context.SHEET_DEFS = { '課表': { headers } };
      context.sheetToObjects_ = () => sheet.rows;
      context.scheduleRevision_ = () => 'rev-1';
      const spreadsheet = { getSheetByName: () => sheet };
      const result = context.batchSetOvertime_(spreadsheet, { baseRevision: 'rev-1', changes: [{ classCode: '701', subjectCode: '英語', teacherCode: 'T01', day: 1, period: 1, isOvertime: true }] });
      const saved = JSON.parse(row['教師姓名']);
      if (!result.ok || result.changed !== 1 || !saved[0]['超鐘點'] || !saved[1]['超鐘點']) throw new Error('批次超鐘點未只新增指定教師標記或遺失既有標記');
       const stale = context.batchSetOvertime_(spreadsheet, { baseRevision: 'stale', changes: [{ classCode: '701', subjectCode: '英語', teacherCode: 'T01', day: 1, period: 1, isOvertime: false }] });
       if (stale.ok !== false || !stale.conflict || !JSON.parse(row['教師姓名'])[0]['超鐘點']) throw new Error('批次超鐘點未阻擋過期課表寫入');
       const rebalanceRow = { '課表ID': 'S2', '班級代碼': '702', '星期': '1', '節次': '2', '科目代碼': '英語', '教師姓名': 'T03', '課堂屬性': '超鐘點', '是否鎖定': 'FALSE' };
       sheet.rows = [rebalanceRow];
       const rebalance = context.batchSetOvertime_(spreadsheet, { baseRevision: 'rev-1', changes: [
         { classCode: '702', subjectCode: '英語', teacherCode: 'T03', day: 1, period: 2, isOvertime: false },
         { classCode: '702', subjectCode: '英語', teacherCode: 'T03', day: 1, period: 2, isOvertime: true }
       ] });
       if (!rebalance.ok || rebalance.changed !== 1 || rebalanceRow['課堂屬性'] !== '超鐘點') throw new Error('批次超鐘點未支援先清除再重新標記同一課堂');
       if (!backend.includes("case 'batchSetOvertime':") || !backend.includes("'batchSetOvertime'")) throw new Error('GAS 批次超鐘點路由未接入');
    });
    check('Teacher overtime UI and Word export labels', () => {
  if (!app.includes('function isOvertimeScheduleEntry')) throw new Error('overtime cell predicate missing');
  if (!app.includes('function optimisticSetOvertime')) throw new Error('overtime optimistic action missing');
  if (!app.includes("gasPost('setOvertime'")) throw new Error('overtime backend action missing');
  if (!app.includes('function showCtxMenu(x, y, hasContent, isLocked, options)')) throw new Error('context menu options missing');
   if (!app.includes('teacherSubjectLabel(cell, teacherCode)')) throw new Error('teacher timetable overtime label missing');
  if (!html.includes('id="ctx-overtime"')) throw new Error('overtime context-menu item missing');
   const helperStart = wordExport.indexOf('function isWordTeacherOvertimeItem');
  const helperEnd = wordExport.indexOf('function slotSubject', helperStart);
   const ctx = { isPatrolScheduleEntry: cell => cell && cell['課堂屬性'] === '巡堂' };
   ctx.getCellTeacherList = cell => JSON.parse(cell['教師姓名']);
   vm.createContext(ctx);
  vm.runInContext(wordExport.slice(helperStart, helperEnd), ctx, { filename: 'word-overtime.js' });
    if (ctx.teacherWordSubject({ '科目代碼': '國文', '課堂屬性': '超鐘點' }) !== '國文(超)') throw new Error('Word overtime label missing');
    if (ctx.teacherWordSubject({ '科目代碼': '國文', '課堂屬性': '一般' }) !== '國文') throw new Error('Word normal subject label changed');
     const perTeacherCell = { '科目代碼': '國文', '課堂屬性': '一般', '教師姓名': '[{"教師姓名":"T01","超鐘點":true},{"教師姓名":"T02"}]' };
      if (ctx.teacherWordSubject(perTeacherCell, 'T01') !== '國文(超)' || ctx.teacherWordSubject(perTeacherCell, 'T02') !== '國文') throw new Error('Word 未依教師個別標記顯示超鐘點');
     if (ctx.teacherWordSubject({ '科目代碼': '國文', '課堂屬性': '超鐘點', '教師姓名': '[{"教師姓名":"T01"}]' }, 'T01') !== '國文(超)') throw new Error('Word 未依單一教師課堂屬性顯示超鐘點');
    if (ctx.teacherWordSubject({ '科目代碼': '', '課堂屬性': '巡堂' }) !== '巡堂') throw new Error('教師 Word 未顯示巡堂');
  });
check('Timetable ellipsis exposes full hover text', () => {
  if (!app.includes("title=\"'+esc(info.text||'')+'\"")) throw new Error('cell subject hover title missing');
  if (!app.includes("title=\"'+esc(info.meta)+'\"")) throw new Error('cell meta hover title missing');
  if (!app.includes("title=\"' + esc(sub) + '\"")) throw new Error('p8 subject hover title missing');
});
for (const result of results) console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.error ? `: ${result.error}` : ''}`);
if (results.some(result => !result.ok)) process.exitCode = 1;
