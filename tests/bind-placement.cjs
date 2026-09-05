const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function makeClassList() {
  const values = new Set();
  return {
    add: (...names) => names.forEach(name => values.add(name)),
    remove: (...names) => names.forEach(name => values.delete(name)),
    contains: name => values.has(name),
    toggle: (name, force) => {
      if (force === true || (force === undefined && !values.has(name))) values.add(name);
      else values.delete(name);
      return values.has(name);
    }
  };
}

function makeElement(id = '') {
  return {
    id, value: '', checked: false, textContent: '', innerHTML: '', className: '', style: {},
    dataset: {}, classList: makeClassList(), children: [], parentNode: null,
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    insertBefore(child) { this.children.push(child); child.parentNode = this; return child; },
    removeChild(child) { this.children = this.children.filter(item => item !== child); },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    contains() { return false; }, closest() { return null; },
    focus() {}, click() {},
    setAttribute(name, value) { this[name] = value; },
    getAttribute(name) { return this[name] ?? null; },
    removeAttribute(name) { delete this[name]; },
    getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  };
}

function createContext() {
  const elements = new Map();
  const getElement = id => {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  };
  const optionValues = {
    'auto-period-start': '1',
    'auto-period-end': '7',
    'auto-random-seed': '20260813'
  };
  const optionChecks = {
    'auto-opt-morning-core': true,
    'auto-opt-teacher-consec': true,
    'auto-opt-smart-swap': true,
    'auto-opt-randomize': false,
    'auto-opt-p8-only': false
  };
  Object.entries(optionValues).forEach(([id, value]) => { getElement(id).value = value; });
  Object.entries(optionChecks).forEach(([id, checked]) => { getElement(id).checked = checked; });
  const localValues = new Map();
  const debugLogs = [];
  const captureDebug = (...args) => {
    const message = args.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' ');
    debugLogs.push(message);
  };
  const context = {
    console: { log: captureDebug, info() {}, warn: captureDebug, error: (...args) => console.error(...args) },
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, structuredClone,
    FormData, URL, URLSearchParams, Blob, TextEncoder, TextDecoder, performance, crypto,
    navigator: { clipboard: { writeText: async () => {} } },
    location: { href: 'http://127.0.0.1:8000/', search: '', hash: '' },
    localStorage: {
      getItem: key => localValues.get(key) ?? null,
      setItem: (key, value) => localValues.set(key, String(value)),
      removeItem: key => localValues.delete(key)
    },
    document: {
      body: makeElement('body'),
      documentElement: makeElement('html'),
      createElement: tag => makeElement(tag),
      createTextNode: text => ({ textContent: String(text) }),
      getElementById: getElement,
      querySelector: selector => selector === 'input[name="auto-mode"]:checked' ? { value: 'all' } : null,
      querySelectorAll: () => [],
      getElementsByClassName: () => [],
      addEventListener() {}, removeEventListener() {}
    },
    MutationObserver: class { observe() {} disconnect() {} },
    HTMLElement: class {}, Node: class {},
    requestAnimationFrame: callback => setTimeout(callback, 0),
    cancelAnimationFrame: clearTimeout,
    alert() {}, confirm: () => true, prompt: () => '',
    __lastModal: null, __debugLogs: debugLogs
  };
  context.window = context;
  context.self = context;
  context.globalThis = context;
  context.window.addEventListener = () => {};
  context.window.removeEventListener = () => {};
  context.window.open = () => null;
  return context;
}

function baseData() {
  return {
    classes: [
      { '班級代碼': '701', '年級': '7', '班級名稱': '701', '導師代碼': 'T0', '是否虛擬班': 'FALSE' },
      { '班級代碼': '702', '年級': '7', '班級名稱': '702', '導師代碼': 'T0', '是否虛擬班': 'FALSE' },
      { '班級代碼': '703', '年級': '7', '班級名稱': '703', '導師代碼': 'T0', '是否虛擬班': 'FALSE' },
      { '班級代碼': '704', '年級': '7', '班級名稱': '704', '導師代碼': 'T0', '是否虛擬班': 'FALSE' }
    ],
    teachers: ['T1', 'T2', 'T3', 'T4'].map(code => ({
      '教師代碼': code, '教師姓名': code, 'Email': code + '@school.edu.tw', '任教科目': '英語',
      '最大連堂節數': '2', '基本鐘點': '20'
    })),
    subjects: [{ '科目代碼': '英語', '科目名稱': '英語', '每週節數': '3', '同時最多班數': '3', '連堂節數': '0', '最多連日': '5' }],
    assignments: [],
    schedule: [],
    teacherBlocks: [],
    subjectRules: [],
    blockGroups: [],
    rooms: [],
    scheduleColors: [],
    teacherExclusives: []
  };
}

function addEnglish(data, classCode, teacher, weekly) {
  data.assignments.push({
    '配課ID': 'A_' + classCode, '班級代碼': classCode, '科目代碼': '英語',
    '教師姓名': teacher, '每週節數': String(weekly)
  });
}

function buildContext(data) {
  const context = createContext();
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), context, { filename: 'app.js' });
  vm.runInContext(fs.readFileSync(path.join(root, 'app-runtime.js'), 'utf8'), context, { filename: 'app-runtime.js' });
  context.__inputData = data;
  vm.runInContext(`
    applyData(__inputData);
    ui.selectedClass = '';
    ui.selectedTeacher = '';
     showLoading = function () {};
     renderClassSelect = function () {};
     toast = function () {};
    renderClassTT = function () {};
    renderTeacherTT = function () {};
    loadAll = async function () {};
    showModal = function (title, message, type) {
      __lastModal = { title: String(title || ''), message: String(message || ''), type: String(type || '') };
      return Promise.resolve(true);
    };
    gasPost = async function () { return { ok: true, dryRun: true }; };
  `, context);
  return context;
}

function runAndReport(label, data, expectedUnplaced = 0) {
  const context = buildContext(data);
  return vm.runInContext(`
    (async () => {
      await executeAutoSchedule();
      const sched = state.schedule;
      const counts = {};
      sched.forEach(e => {
        const key = String(e['班級代碼']) + '|' + String(e['科目代碼']);
        counts[key] = (counts[key] || 0) + 1;
      });
      const targets = {};
      state.assignments.forEach(a => {
        const key = String(a['班級代碼']) + '|' + String(a['科目代碼']);
        targets[key] = (targets[key] || 0) + (parseInt(a['每週節數'], 10) || 3);
      });
       const bindGroups = state.blockGroups;
       const getBindMembers = group => {
         const subjects = String(group['科目清單'] || group['科目代碼'] || '').split(',').map(s => s.trim()).filter(Boolean);
         const classes = String(group['班級清單'] || '').split(',').map(c => c.trim()).filter(Boolean);
         const members = [];
         classes.forEach(classCode => {
           const assignedSubjects = subjects.filter(subjectCode => state.assignments.some(assignment =>
             String(assignment['班級代碼']) === classCode && String(assignment['科目代碼']) === subjectCode
           ));
           (assignedSubjects.length > 0 ? assignedSubjects : subjects).forEach(subjectCode => members.push({ classCode, subjectCode }));
         });
         return members;
       };
       const unplacedBind = [];
       bindGroups.forEach(g => {
         getBindMembers(g).forEach(member => {
           const key = member.classCode + '|' + member.subjectCode;
           const placedCount = counts[key] || 0;
           if (placedCount < (targets[key] || 0)) unplacedBind.push(key + '（需 ' + (targets[key] || 0) + '，已排 ' + placedCount + '）');
         });
       });
       // 綁班同步檢查：同一群組各班實際配課的總時段必須一致
       const syncIssues = [];
       bindGroups.forEach(g => {
         const classSubjects = new Map();
         getBindMembers(g).forEach(member => {
           if (!classSubjects.has(member.classCode)) classSubjects.set(member.classCode, new Set());
           classSubjects.get(member.classCode).add(member.subjectCode);
         });
         if (classSubjects.size < 2) return;
         const slotLists = [...classSubjects.entries()].map(([classCode, subjects]) => sched
           .filter(entry => String(entry['班級代碼']) === classCode && subjects.has(String(entry['科目代碼'])))
           .map(entry => entry['星期'] + '-' + entry['節次']).sort().join(','));
         const canonical = slotLists[0];
         if (slotLists.some(list => list !== canonical)) syncIssues.push(g['群組名稱'] || g['群組ID']);
       });
        return { unplacedBind, syncIssues, scheduleCount: sched.length, schedule: sched, modal: __lastModal };
    })()
  `, context);
}

function assertSame(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(msg + '：' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b)); }

async function main() {
  // 情境 1：齊平三班綁班（701/702/703 英語各 3 節，同步完成，無未排）
  {
    const data = baseData();
    addEnglish(data, '701', 'T1', 3);
    addEnglish(data, '702', 'T2', 3);
    addEnglish(data, '703', 'T3', 3);
    data.blockGroups = [{ '群組ID': 'BG1', '群組名稱': '七年級英語', '科目清單': '英語', '班級清單': '701,702,703' }];
    const result = await runAndReport('imbalanced', data);
    assertSame(result.unplacedBind, [], '齊平綁班不應有未排課程');
    assertSame(result.syncIssues, [], '齊平綁班不應有同步不一致');
    console.log('PASS  齊平三班綁班全部同步排入');
  }
  // 情境 2：節數不平衡（703 只有 2 節），依嚴格政策整組拒絕並清楚回報原因
  {
    const data = baseData();
    addEnglish(data, '701', 'T1', 3);
    addEnglish(data, '702', 'T2', 3);
    addEnglish(data, '703', 'T3', 2);
    data.blockGroups = [{ '群組ID': 'BG1', '群組名稱': '七年級英語', '科目清單': '英語', '班級清單': '701,702,703' }];
    const result = await runAndReport('imbalanced', data);
     assertSame(result.unplacedBind.length, 3, '節數不平衡時應整組保留未排');
     if (!result.modal || !String(result.modal.message).includes('每週節數不一致')) throw new Error('節數不平衡未顯示明確拒絕原因');
     console.log('PASS  節數不平衡之綁班整組拒絕且顯示原因（' + result.scheduleCount + ' 節）');
  }
  // 情境 3：單一班級群組（班級清單只有一班）的課程必須個別排入，不得被綁班拒絕機制懸空
  {
    const data = baseData();
    addEnglish(data, '701', 'T1', 3);
    data.blockGroups = [{ '群組ID': 'BG_SOLO', '群組名稱': '單班英語', '科目清單': '英語', '班級清單': '701' }];
    const result = await runAndReport('solo', data);
    assertSame(result.unplacedBind, [], '單一班級群組課程不應未排');
    console.log('PASS  單一班級群組課程全部有排入（' + result.scheduleCount + ' 節）');
  }
  // 情境 4：群組科目只剩一班有待排（其餘班已排滿），依原子綁班政策拒絕部分排入
  {
    const data = baseData();
    addEnglish(data, '701', 'T1', 3);
    addEnglish(data, '702', 'T2', 3);
    data.blockGroups = [{ '群組ID': 'BG2', '群組名稱': '雙班英語', '科目清單': '英語', '班級清單': '701,702' }];
    // 預先把 701 的英語排滿，只留下 702 待排
    data.schedule = [
      { '課表ID': 'PRE1', '班級代碼': '701', '星期': '1', '節次': '1', '科目代碼': '英語', '教師姓名': 'T1', '課堂屬性': '一般', '是否鎖定': 'TRUE', '是否預排': 'FALSE' },
      { '課表ID': 'PRE2', '班級代碼': '701', '星期': '2', '節次': '1', '科目代碼': '英語', '教師姓名': 'T1', '課堂屬性': '一般', '是否鎖定': 'TRUE', '是否預排': 'FALSE' },
      { '課表ID': 'PRE3', '班級代碼': '701', '星期': '3', '節次': '1', '科目代碼': '英語', '教師姓名': 'T1', '課堂屬性': '一般', '是否鎖定': 'TRUE', '是否預排': 'FALSE' }
    ];
    const result = await runAndReport('only-one-pending', data);
     assertSame(result.unplacedBind.length, 1, '群組只剩一班待排時應保留未排');
     if (!result.unplacedBind[0].startsWith('702|英語')) throw new Error('群組部分待排的未排班級錯誤');
     console.log('PASS  群組只剩一班待排時拒絕部分排入（' + result.scheduleCount + ' 節）');
  }
// 情境 5：群組內同一位教師被指派給多班（蔡宏源案例）——絕不可拆班個別排入造成綁班不同步
  {
    const data = baseData();
    addEnglish(data, '701', 'T1', 3);
    addEnglish(data, '702', 'T2', 3);
    addEnglish(data, '703', 'T1', 3);
    data.blockGroups = [{ '群組ID': 'BG_CONFLICT', '群組名稱': '英語衝突組', '科目清單': '英語', '班級清單': '701,702,703' }];
    const result = await runAndReport('repeated-teacher', data);
    assertSame(result.unplacedBind.filter(item => item.includes('英語')).length, 3, '組內教師衝堂組應保持未排而非拆班');
    assertSame(result.syncIssues, [], '組內教師衝堂組絕不可造成綁班不同步');
    console.log('PASS  組內教師衝堂之綁班保持未排且不產生綁班不同步（' + result.scheduleCount + ' 節，無同步違規）');
  }
  // 情境 6：不同班型由不同科目組成，但綁班群組內各班總時段相同時應同步排課
  {
    const data = baseData();
    data.subjects.push(
      { '科目代碼': '英悅讀樂樂', '科目名稱': '英悅讀樂樂', '每週節數': '1', '同時最多班數': '2', '連堂節數': '0', '最多連日': '5' },
      { '科目代碼': '資優英語', '科目名稱': '資優英語', '每週節數': '3', '同時最多班數': '2', '連堂節數': '0', '最多連日': '5' },
      { '科目代碼': 'JCJH Talk', '科目名稱': 'JCJH Talk', '每週節數': '1', '同時最多班數': '2', '連堂節數': '0', '最多連日': '5' }
    );
    const addAssignment = (classCode, subjectCode, teacher, weekly) => data.assignments.push({
      '配課ID': 'A_' + classCode + '_' + subjectCode,
      '班級代碼': classCode,
      '科目代碼': subjectCode,
      '教師姓名': teacher,
      '每週節數': String(weekly)
    });
    [['701', '英語', 'T1', 3], ['702', '英語', 'T2', 3],
      ['701', '英悅讀樂樂', 'T1', 1], ['702', '英悅讀樂樂', 'T2', 1],
      ['703', '資優英語', 'T3', 3], ['704', '資優英語', 'T4', 3],
      ['703', 'JCJH Talk', 'T3', 1], ['704', 'JCJH Talk', 'T4', 1]
    ].forEach(item => addAssignment(...item));
    data.blockGroups = [{
      '群組ID': 'BG_CROSS_SUBJECT_TOTAL',
      '群組名稱': '跨班型英語綁班',
      '科目清單': '英語,英悅讀樂樂,資優英語,JCJH Talk',
      '班級清單': '701,702,703,704'
    }];
    const result = await runAndReport('cross-subject-total', data);
    assertSame(result.unplacedBind, [], '綁班群組總節數相同時不應因單科節數不同而拒絕');
    if (result.modal && String(result.modal.message).includes('各班合計每週節數不一致')) throw new Error('相同總節數仍被前置檢查拒絕');
    console.log('PASS  跨科目組成但班級總節數相同之綁班可正常排入');
  }
  // 情境 7：資優班專屬科目與普通班科目同列群組時，應與普通班共用時段
  {
    const data = baseData();
    data.subjects.push({ '科目代碼': '資優英語', '科目名稱': '資優英語', '每週節數': '3', '同時最多班數': '1', '連堂節數': '0', '最多連日': '5' });
    const addAssignment = (classCode, subjectCode, teacher, weekly) => data.assignments.push({
      '配課ID': 'A_' + classCode + '_' + subjectCode,
      '班級代碼': classCode,
      '科目代碼': subjectCode,
      '教師姓名': teacher,
      '每週節數': String(weekly)
    });
    [['701', '英語', 'T1', 3], ['702', '英語', 'T2', 3], ['703', '英語', 'T3', 3], ['704', '資優英語', 'T4', 3]]
      .forEach(item => addAssignment(...item));
    data.blockGroups = [{
      '群組ID': 'BG_SINGLE_SPECIALTY',
      '群組名稱': '資優英語綁班',
      '科目清單': '英語,資優英語',
      '班級清單': '701,702,703,704'
    }];
    const result = await runAndReport('single-specialty', data);
    assertSame(result.unplacedBind, [], '資優班專屬科目不應被綁班前置關卡拒絕');
    assertSame(result.syncIssues, [], '資優班專屬科目應與普通班科目同步');
    console.log('PASS  資優班專屬科目與普通班科目同步排入');
  }
  // 情境 8：協同教師必須與主教師共同排入，且共同遵守協同教師不排課時段
  {
    const data = baseData();
    addEnglish(data, '701', JSON.stringify([
      { '教師姓名': 'T1', '標籤': '主' },
      { '教師姓名': 'T4', '標籤': '協同' }
    ]), 3);
    data.teacherBlocks = [{ '記錄ID': 'TB1', '教師姓名': 'T4', '時段': '3-1,3-2,3-3,3-4,3-5,3-6,3-7', '原因': '星期三下午不可排課' }];
    const result = await runAndReport('co-teacher', data);
    const coTeacherSlots = result.schedule.filter(entry => String(entry['班級代碼']) === '701' && String(entry['科目代碼']) === '英語');
    assertSame(coTeacherSlots.length, 3, '協同教師課程未完整排入');
    if (coTeacherSlots.some(entry => {
      const raw = String(entry['教師姓名'] || '');
      return parseTeacherCodes(raw).includes('T4') && String(entry['星期']) === '3';
    })) throw new Error('協同教師仍被排入星期三不排課時段');
    if (coTeacherSlots.some(entry => !parseTeacherCodes(String(entry['教師姓名'] || '')).includes('T1') || !parseTeacherCodes(String(entry['教師姓名'] || '')).includes('T4'))) {
      throw new Error('自動排課未同時保留主教師與協同教師');
    }
    console.log('PASS  協同教師共同排課並避開不排課時段');
  }
  // 情境 9：兩筆 0.5 節配課在同一個第八節必排時段依序放入單週與雙週
  {
    const data = baseData();
    data.subjects[0]['每週節數'] = '0.5';
    data.assignments.push(
      { '配課ID': 'A_HALF_1', '班級代碼': '701', '科目代碼': '英語', '教師姓名': 'T1', '每週節數': '0.5' },
      { '配課ID': 'A_HALF_2', '班級代碼': '701', '科目代碼': '英語', '教師姓名': 'T2', '每週節數': '0.5' }
    );
    data.subjectRules = [{ '規則類型': '必排', '科目代碼': '英語', '適用班級': '701', '適用年級': '全校', '時段': '1-8' }];
    const context = buildContext(data);
    context.document.getElementById('auto-period-end').value = '8';
    const schedule = await vm.runInContext(`(async () => {
      await executeAutoSchedule();
      return state.schedule;
    })()`, context);
    const alternateRows = schedule.filter(row => String(row['班級代碼']) === '701' && String(row['科目代碼']) === '英語');
    assertSame(alternateRows.length, 2, '兩筆 0.5 配課未完整排入');
    assertSame(alternateRows.map(row => row['課堂屬性']).sort(), ['單週', '雙週'].sort(), '兩筆 0.5 配課未分配單週與雙週');
    if (alternateRows.some(row => String(row['節次']) !== '8' || String(row['星期']) !== '1')) {
      throw new Error('0.5 配課未依必排規則排入同一個第八節時段');
    }
    console.log('PASS  0.5 配課自動排課依序使用單週與雙週');
  }
  // 情境 10：同班同科但備註不同的兩組配課，必須各自套用每日分散規則；相同教師也可建立。
  {
    const data = baseData();
    data.assignments.push(
      { '配課ID': 'A_GROUP_A', '班級代碼': '701', '科目代碼': '英語', '教師姓名': 'T1', '每週節數': '3', '備註': 'A組' },
      { '配課ID': 'A_GROUP_B', '班級代碼': '701', '科目代碼': '英語', '教師姓名': 'T2', '每週節數': '3', '備註': 'B組' }
    );
    const result = await runAndReport('assignment-groups', data);
    const rows = result.schedule.filter(entry => String(entry['班級代碼']) === '701' && String(entry['科目代碼']) === '英語');
    assertSame(rows.length, 6, '不同備註配課不應被合併後套用同一個每日分散限制');
     assertSame(rows.filter(entry => String(entry['教師姓名']) === 'T1').length, 3, 'A組配課未完整排入');
     assertSame(rows.filter(entry => String(entry['教師姓名']) === 'T2').length, 3, 'B組配課未完整排入');
     const slots = rows.map(entry => String(entry['星期']) + '-' + String(entry['節次']) + '-' + String(entry['課堂屬性'] || '全週'));
     const slotsByTeacher = new Map(['T1', 'T2'].map(teacher => [teacher, new Set(rows
       .filter(entry => String(entry['教師姓名']) === teacher)
       .map(entry => String(entry['星期']) + '-' + String(entry['節次']) + '-' + String(entry['課堂屬性'] || '全週')))]));
     const sharedSlots = [...slotsByTeacher.get('T1')].filter(slot => slotsByTeacher.get('T2').has(slot));
     if (sharedSlots.length === 0) throw new Error('不同教師的分組未共用同一時段');
    const internalGroupKeys = new Set(rows.map(entry => String(entry.__assignmentGroupKey || '')));
    if (!internalGroupKeys.has('701|英語|A組') || !internalGroupKeys.has('701|英語|B組')) throw new Error('自動排課課表 entry 未保留正確分組識別');
    if (Object.keys(rows[0]).includes('__assignmentGroupKey')) throw new Error('分組識別不應污染課表資料 schema');
    const ambiguousData = baseData();
    ambiguousData.assignments.push(
      { '配課ID': 'A_AMBIGUOUS_A', '班級代碼': '701', '科目代碼': '英語', '教師姓名': 'T1', '每週節數': '1', '備註': 'A組' },
      { '配課ID': 'A_AMBIGUOUS_B', '班級代碼': '701', '科目代碼': '英語', '教師姓名': 'T1', '每週節數': '1', '備註': 'B組' }
    );
    const ambiguousContext = buildContext(ambiguousData);
    const warnings = vm.runInContext('getAssignmentGroupWarnings(state.assignments)', ambiguousContext);
    if (!Array.isArray(warnings) || warnings.length !== 0) throw new Error('相同教師集合的不同備註不應再產生分組歧義警告');
    const conflict = vm.runInContext('getAssignmentGroupConflict(state.assignments[0], state.assignments)', ambiguousContext);
    if (conflict) throw new Error('相同教師集合的不同備註仍被分組防呆阻擋');
    console.log('PASS  同班同科不同備註配課分組獨立排課');
  }
  // 情境 11：同班同格的不同教師分組可直接並存，移動其中一組時不可刪掉另一組。
  {
    const data = baseData();
    data.assignments.push(
      { '配課ID': 'A_GROUP_A', '班級代碼': '701', '科目代碼': '英語', '教師姓名': 'T1', '每週節數': '3', '備註': 'A組' },
      { '配課ID': 'A_GROUP_B', '班級代碼': '701', '科目代碼': '英語', '教師姓名': 'T2', '每週節數': '3', '備註': 'B組' }
    );
    data.schedule.push(
      { '課表ID': 'S_GROUP_A', '班級代碼': '701', '星期': '3', '節次': '45', '科目代碼': '英語', '教師姓名': 'T1', '課堂屬性': '抽離', '備註': 'A組' },
      { '課表ID': 'S_GROUP_A_SOURCE', '班級代碼': '701', '星期': '3', '節次': '1', '科目代碼': '英語', '教師姓名': 'T1', '課堂屬性': '一般', '備註': 'A組' },
      { '課表ID': 'S_GROUP_B', '班級代碼': '701', '星期': '3', '節次': '1', '科目代碼': '英語', '教師姓名': 'T2', '課堂屬性': '一般', '備註': 'B組' }
    );
    const context = buildContext(data);
    const differentGroupBlocking = vm.runInContext(
      "getAssignmentGroupBlockingCells(getScheduleCellsAt('701', 3, 45), '701', '英語', 'B組')",
      context
    );
    if (differentGroupBlocking.length !== 0) throw new Error('同班同格不同教師分組仍被判定為替換目標');
    const sameGroupBlocking = vm.runInContext(
      "getAssignmentGroupBlockingCells(getScheduleCellsAt('701', 3, 45), '701', '英語', 'A組')",
      context
    );
    if (sameGroupBlocking.length !== 1) throw new Error('同一分組的既有課程未保留替換防護');
    const legacyContext = buildContext(JSON.parse(JSON.stringify(data)));
    vm.runInContext("state.schedule.find(row => row['課表ID'] === 'S_GROUP_A')['備註'] = ''; buildIndex()", legacyContext);
    const legacyBlocking = vm.runInContext(
      "getAssignmentGroupBlockingCells(getScheduleCellsAt('701', 3, 45), '701', '英語', 'B組')",
      legacyContext
    );
    if (legacyBlocking.length !== 0) throw new Error('舊課表缺少備註時，無法依不同教師唯一回溯分組');
    context.__lastModal = null;
    const confirmed = await vm.runInContext(
      "(async () => confirmTeacherTimetableOverwrite(null, getAssignmentGroupBlockingCells(getScheduleCellsAt('701', 3, 45), '701', '英語', 'B組'), 3, 45))()",
      context
    );
    if (!confirmed || context.__lastModal) throw new Error('不同教師分組仍跳出教師課表替換視窗');
    const paletteContext = buildContext(data);
    vm.runInContext("optimisticUpdateCell({ classCode: '701', day: 3, period: 45, subjectCode: '英語', teacherCode: 'T2', assignmentNote: 'B組', attr: '抽離' })", paletteContext);
    const placedRows = vm.runInContext("state.schedule.filter(row => String(row['班級代碼']) === '701' && String(row['星期']) === '3' && String(row['節次']) === '45')", paletteContext);
    if (placedRows.length !== 2 || !placedRows.some(row => row['備註'] === 'A組') || !placedRows.some(row => row['備註'] === 'B組')) {
      throw new Error('從教師待排卡片排入同班同格時未保留另一個分組');
    }
    vm.runInContext("optimisticMoveCell('701', 3, 1, '701', 3, 45, '', '', false, 'B組')", context);
    const movedRows = vm.runInContext("state.schedule.filter(row => String(row['班級代碼']) === '701' && String(row['星期']) === '3' && String(row['節次']) === '45')", context);
    if (movedRows.length !== 2 || !movedRows.some(row => row['備註'] === 'A組') || !movedRows.some(row => row['備註'] === 'B組')) {
      throw new Error('移動不同教師分組時覆蓋了同班同格的既有分組');
    }
    const sourceRows = vm.runInContext("state.schedule.filter(row => String(row['班級代碼']) === '701' && String(row['星期']) === '3' && String(row['節次']) === '1')", context);
    if (sourceRows.length !== 1 || sourceRows[0]['備註'] !== 'A組') throw new Error('移動其中一組時誤刪了來源格的另一個分組');
    console.log('PASS  同班同格不同教師分組可並存與移動');
  }
}

function parseTeacherCodes(value) {
  const raw = String(value || '').trim();
  if (raw.startsWith('[')) {
    try { return JSON.parse(raw).map(item => String(item['教師姓名'] || '').trim()).filter(Boolean); }
    catch (error) { return []; }
  }
  return raw.split(/[,，、;；]/).map(item => item.trim()).filter(Boolean);
}

main().then(() => {
  console.log('ALL BIND PLACEMENT TESTS PASSED');
}).catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
