const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const gasUrl = String(process.env.SCHEDULING_TEST_GAS_URL || '').trim();
const mode = String(process.env.SCHEDULING_TEST_MODE || 'all').trim();
const randomize = String(process.env.SCHEDULING_TEST_RANDOMIZE || '').toLowerCase() === 'true';
const randomSeed = String(process.env.SCHEDULING_TEST_RANDOM_SEED || '20260811').trim();
const includeFailureGraph = String(process.env.SCHEDULING_TEST_INCLUDE_FAILURE_GRAPH || '').toLowerCase() === 'true';
const profile = String(process.env.SCHEDULING_TEST_PROFILE || '').toLowerCase() === 'true';
const profileOnly = String(process.env.SCHEDULING_TEST_PROFILE_ONLY || '').toLowerCase() === 'true';
const summaryOnly = String(process.env.SCHEDULING_TEST_SUMMARY_ONLY || '').toLowerCase() === 'true';
const compact = String(process.env.SCHEDULING_TEST_COMPACT || '').toLowerCase() === 'true';
const parsedTimeBudgetMs = Number.parseInt(String(process.env.SCHEDULING_TEST_TIME_BUDGET_MS || ''), 10);
const timeBudgetMs = Number.isFinite(parsedTimeBudgetMs) && parsedTimeBudgetMs > 0 ? parsedTimeBudgetMs : null;
const exclusiveMode = String(process.env.SCHEDULING_TEST_EXCLUSIVE_MODE || '').trim().toLowerCase();
const subjectFilter = String(process.env.SCHEDULING_TEST_SUBJECT || '').trim();

if (!gasUrl) {
  console.error('缺少 SCHEDULING_TEST_GAS_URL，無法讀取測試資料。');
  process.exit(2);
}

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
  const element = {
    id,
    value: '',
    checked: false,
    textContent: '',
    innerHTML: '',
    className: '',
    style: {},
    dataset: {},
    classList: makeClassList(),
    children: [],
    parentNode: null,
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    insertBefore(child) { this.children.push(child); child.parentNode = this; return child; },
    removeChild(child) { this.children = this.children.filter(item => item !== child); },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    contains() { return false; },
    closest() { return null; },
    focus() {},
    click() {},
    setAttribute(name, value) { this[name] = value; },
    getAttribute(name) { return this[name] ?? null; },
    removeAttribute(name) { delete this[name]; },
    getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  };
  return element;
}

function createBrowserLikeContext(options) {
  const elements = new Map();
  const getElement = id => {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  };
  const optionValues = {
    'auto-period-start': '1',
    'auto-period-end': '7',
    'auto-random-seed': randomSeed
  };
  const optionChecks = {
    'auto-opt-morning-core': true,
    'auto-opt-teacher-consec': String(process.env.SCHEDULING_TEST_TEACHER_CONSEC || 'true').toLowerCase() !== 'false',
    'auto-opt-smart-swap': true,
    'auto-opt-randomize': randomize,
    'auto-opt-multi-restart': String(process.env.SCHEDULING_TEST_MULTI_RESTART || '').toLowerCase() === 'true',
    'auto-opt-p8-only': false
  };
  Object.entries(optionValues).forEach(([id, value]) => { getElement(id).value = value; });
  Object.entries(optionChecks).forEach(([id, checked]) => { getElement(id).checked = checked; });

  const localValues = new Map();
  const debugLogs = [];
  const captureDebug = (...args) => {
    const message = args.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' ');
    if (message.includes('綁班')) debugLogs.push(message);
  };
  const context = {
    console: {
      log: captureDebug,
      info() {},
      warn: captureDebug,
      error: (...args) => console.error(...args)
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    structuredClone,
    fetch,
    FormData,
    URL,
    URLSearchParams,
    Blob,
    TextEncoder,
    TextDecoder,
    performance,
    crypto,
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
      querySelector: selector => selector === 'input[name="auto-mode"]:checked' ? { value: options.mode } : null,
      querySelectorAll: () => [],
      getElementsByClassName: () => [],
      addEventListener() {},
      removeEventListener() {}
    },
    MutationObserver: class { observe() {} disconnect() {} },
    HTMLElement: class {},
    Node: class {},
    requestAnimationFrame: callback => setTimeout(callback, 0),
    cancelAnimationFrame: clearTimeout,
    alert() {},
    confirm: () => true,
    prompt: () => '',
    __lastModal: null,
    __capturedSchedule: null,
    __enableAutoFailureGraph: includeFailureGraph,
    __debugLogs: debugLogs
  };
  context.window = context;
  context.self = context;
  context.globalThis = context;
  context.window.addEventListener = () => {};
  context.window.removeEventListener = () => {};
  context.window.open = () => null;
  context.window.scrollY = 0;
  context.window.scrollX = 0;
  return context;
}

function parseCsv(value) {
  if (Array.isArray(value)) return value.map(String).map(item => item.trim()).filter(Boolean);
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function bindMismatchCount(data, schedule) {
  let mismatches = 0;
  const details = [];
  for (const group of data.blockGroups || []) {
    const classes = parseCsv(group['班級清單']);
    const subjects = parseCsv(group['科目清單'] || group['科目代碼']);
    const membersByClass = classes.map(classCode => {
      const assignedSubjects = subjects.filter(subjectCode => (data.assignments || []).some(assignment =>
        String(assignment['班級代碼'] || '').trim() === classCode &&
        String(assignment['科目代碼'] || '').trim() === subjectCode
      ));
      return assignedSubjects.length > 0 ? assignedSubjects : subjects;
    });
    const maxCohorts = Math.max(0, ...membersByClass.map(memberSubjects => memberSubjects.length));
    for (let cohortIndex = 0; cohortIndex < maxCohorts; cohortIndex++) {
      const cohortMembers = classes.map((classCode, classIndex) => ({
        classCode,
        subjectCode: membersByClass[classIndex][cohortIndex]
      })).filter(member => member.subjectCode);
      if (cohortMembers.length < 2) continue;
      const slotLists = cohortMembers.map(({ classCode, subjectCode }) => (schedule || [])
        .filter(entry => String(entry['班級代碼']) === classCode && String(entry['科目代碼']) === subjectCode)
        .map(entry => `${entry['星期']}-${entry['節次']}`)
        .sort());
      const canonical = JSON.stringify(slotLists[0] || []);
      if (slotLists.some(slots => JSON.stringify(slots) !== canonical)) {
        mismatches++;
        details.push({
          group: (group['群組名稱'] || group['群組ID']) + '／第' + (cohortIndex + 1) + '組',
          members: cohortMembers,
          slotLists
        });
      }
    }
  }
  return { mismatches, details };
}

async function getAllData(url) {
  const body = new URLSearchParams({ action: 'getAll', data: '{}' });
  const response = await fetch(url, { method: 'POST', body });
  if (!response.ok) throw new Error(`GAS HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload || !payload.ok || !payload.data) throw new Error(payload?.error || 'GAS 未回傳資料');
  return payload.data;
}

async function main() {
  const data = await getAllData(gasUrl);
  if (subjectFilter) {
    const subjects = new Set(subjectFilter.split(/[\x2c，、]/).map(value => value.trim()).filter(Boolean));
    data.assignments = (data.assignments || []).filter(row => subjects.has(String(row['科目代碼'] || '').trim()));
  }
  if (exclusiveMode === 'swapped') {
    data.teacherExclusives = [
      { '規則ID': 'TEST_EX_1', '教師A': '余明錦', '教師B': '黃健忠', '備註': 'test' },
      { '規則ID': 'TEST_EX_2', '教師A': '黃筱卉', '教師B': '游皓宇', '備註': 'test' }
    ];
  }
  const context = createBrowserLikeContext({ mode, randomize, randomSeed });
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), context, { filename: 'app.js' });
  vm.runInContext(fs.readFileSync(path.join(root, 'app-runtime.js'), 'utf8'), context, { filename: 'app-runtime.js' });
  context.__inputData = data;
  vm.runInContext(`
    applyData(__inputData);
    ui.selectedClass = '';
    ui.selectedTeacher = '';
    showLoading = function () {};
    toast = function () {};
    renderClassTT = function () {};
    renderTeacherTT = function () {};
    loadAll = async function () {};
    showModal = function (title, message, type) {
      __lastModal = { title: String(title || ''), message: String(message || ''), type: String(type || '') };
      return Promise.resolve(true);
    };
     gasPost = async function (action, payload) {
       if (action === 'batchUpdateSchedule') {
         __capturedSchedule = structuredClone(payload.schedule || []);
         __capturedPayload = structuredClone(payload || {});
       }
       return { ok: true, dryRun: true };
     };
   `, context);

  const originalScheduleIds = [...new Set((data.schedule || [])
    .map(row => String(row['課表ID'] || '').trim())
    .filter(Boolean))];
  context.__originalScheduleIds = originalScheduleIds;
  const beforeQuality = vm.runInContext('window.buildAutoScheduleQualityReport({ schedule: state.schedule, optP8Only: false, autoEndPeriod: 7, onePerDay: true, ignoreTeacherConsecutiveIds: __originalScheduleIds })', context);
  const beforeBind = bindMismatchCount(data, data.schedule || []);
  const startedAt = Date.now();
  const autoScheduleOptions = {};
  if (profile) autoScheduleOptions.profile = true;
  if (includeFailureGraph) autoScheduleOptions.includeFailureGraph = true;
  if (timeBudgetMs) autoScheduleOptions.timeBudgetMs = timeBudgetMs;
  const autoScheduleExpression = Object.keys(autoScheduleOptions).length > 0
    ? 'executeAutoScheduleCore(' + JSON.stringify(autoScheduleOptions) + ')'
    : 'executeAutoSchedule()';
  await vm.runInContext(autoScheduleExpression, context);
  const elapsedMs = Date.now() - startedAt;
  const afterSchedule = vm.runInContext('structuredClone(state.schedule)', context);
  const afterQuality = vm.runInContext('window.buildAutoScheduleQualityReport({ schedule: state.schedule, optP8Only: false, autoEndPeriod: 7, onePerDay: true, ignoreTeacherConsecutiveIds: __originalScheduleIds })', context);
  if (!Array.isArray(context.__capturedPayload?.ignoredTeacherConsecutiveIds)) throw new Error('auto batch write did not carry the original schedule exemption list');
  if (Object.prototype.hasOwnProperty.call(context.__capturedPayload || {}, 'allowSoftTeacherExclusives')) throw new Error('auto batch write relaxed strict teacher exclusivity');
  const afterBind = bindMismatchCount(data, afterSchedule);
  const filteredScheduleRows = subjectFilter
    ? afterSchedule
      .filter(row => String(row['科目代碼'] || '').trim() === subjectFilter)
      .map(row => ({ classCode: row['班級代碼'], day: row['星期'], period: row['節次'], teacher: row['教師姓名'] }))
    : [];
  const backendContext = { console };
  vm.createContext(backendContext);
  vm.runInContext(fs.readFileSync(path.join(root, 'Code.gs'), 'utf8'), backendContext, { filename: 'Code.gs' });
  backendContext.__candidateSchedule = afterSchedule;
  backendContext.__inputData = data;
  backendContext.__originalScheduleIds = originalScheduleIds;
  const backendAudit = vm.runInContext(
    'validateScheduleSnapshot_(__candidateSchedule, Object.assign({}, __inputData, { ignoredTeacherConsecutiveIds: __originalScheduleIds }))',
    backendContext,
    { filename: 'backend-audit.js' }
  );
  const beforeBackendAudit = vm.runInContext(
    'validateScheduleSnapshot_(__beforeSchedule, Object.assign({}, __inputData, { ignoredTeacherConsecutiveIds: __originalScheduleIds }))',
    Object.assign(backendContext, { __beforeSchedule: data.schedule || [], __originalScheduleIds: originalScheduleIds }),
    { filename: 'backend-before-audit.js' }
  );
  const suspectRows = afterSchedule.filter(row =>
    String(row['星期']) === '5' && String(row['節次']) === '7' &&
    /黃筱卉|黃健忠/.test(String(row['教師姓名'] || ''))
  );
  const afterClassSummary = ['902', '905', '907'].map(classCode => {
    const counts = {};
    const classRows = afterSchedule.filter(row => String(row['班級代碼']) === classCode);
    classRows
      .forEach(row => { counts[row['科目代碼']] = (counts[row['科目代碼']] || 0) + 1; });
    const occupied = new Set(classRows.map(row => String(row['星期']) + '-' + String(row['節次'])));
    const emptySlots = [];
    for (let day = 1; day <= 5; day++) for (let period = 1; period <= 7; period++) {
      if (!occupied.has(day + '-' + period)) emptySlots.push(day + '-' + period);
    }
    return { classCode, total: Object.values(counts).reduce((sum, count) => sum + count, 0), emptySlots, counts };
  });
  const scheduleSignature = require('crypto')
    .createHash('sha256')
    .update(afterSchedule
      .map(row => [row['班級代碼'], row['科目代碼'], row['教師姓名'], row['星期'], row['節次'], row['課堂屬性']].join('|'))
      .sort()
      .join('\n'))
    .digest('hex');

  const result = {
    mode,
    randomize,
    randomSeed,
    includeFailureGraph,
    profile,
    timeBudgetMs,
    scheduleSignature,
    elapsedMs,
    before: {
      scheduleCount: (data.schedule || []).length,
      remainingLessons: beforeQuality.remainingLessons,
      hardViolations: beforeQuality.violations.length,
      subjectRelationSoftViolations: beforeQuality.subjectRelationSoftViolations || 0,
      subjectRelationSoftDetails: (beforeQuality.subjectRelationSoftDetails || []).slice(0, 20),
      hardViolationDetails: beforeQuality.violations.slice(0, 20),
      bindMismatches: beforeBind.mismatches
    },
    after: {
      scheduleCount: afterSchedule.length,
      remainingLessons: afterQuality.remainingLessons,
      hardViolations: afterQuality.violations.length,
      qualityScore: afterQuality.score,
      teacherGaps: afterQuality.teacherGaps,
      teacherImbalance: afterQuality.teacherImbalance,
      subjectRelationSoftViolations: afterQuality.subjectRelationSoftViolations || 0,
      subjectRelationSoftDetails: (afterQuality.subjectRelationSoftDetails || []).slice(0, 20),
      hardViolationDetails: afterQuality.violations.slice(0, 20),
      bindMismatches: afterBind.mismatches,
      deficits: afterQuality.deficits.slice(0, 20),
      bindMismatchDetails: afterBind.details,
      backendAudit: {
        ok: !!backendAudit && backendAudit.ok === true,
        error: backendAudit?.error || '',
        violations: backendAudit?.violations?.slice(0, 20) || []
      },
    beforeBackendAudit: {
        ok: !!beforeBackendAudit && beforeBackendAudit.ok === true,
        error: beforeBackendAudit?.error || '',
        violations: beforeBackendAudit?.violations?.slice(0, 20) || []
    },
    afterClassSummary,
    suspectRows,
      afterPeriodEight: afterSchedule
      .filter(row => parseInt(row['節次'], 10) === 8)
      .map(row => ({
        id: row['課表ID'],
        classCode: row['班級代碼'],
        subjectCode: row['科目代碼'],
        teacher: row['教師姓名'],
         period: row['節次'],
         attr: row['課堂屬性'],
         locked: row['是否鎖定']
      }))
    },
    cloudWriteIntercepted: Array.isArray(context.__capturedSchedule),
    ignoredTeacherConsecutiveIds: originalScheduleIds,
    modalTitle: context.__lastModal?.title || '',
    modalMessage: context.__lastModal?.message || '',
    preflight: context.__lastAutoSchedulePreflight || null,
    conflictPressure: context.__lastAutoScheduleConflictPressure || null,
    runSummary: context.__lastAutoScheduleRunSummary || null,
    failureDetails: context.__lastAutoScheduleFailureDetails || [],
    profileDetails: context.__lastAutoScheduleProfile || null,
    filteredScheduleRows,
    debugLogs: context.__debugLogs.slice(-80)
  };
  const summary = {
    elapsedMs: result.elapsedMs,
    scheduleSignature: result.scheduleSignature,
    beforeSubjectRelationSoftViolations: result.before.subjectRelationSoftViolations,
    remainingLessons: result.after.remainingLessons,
    hardViolations: result.after.hardViolations,
    subjectRelationSoftViolations: result.after.subjectRelationSoftViolations,
    subjectRelationSoftDetails: result.after.subjectRelationSoftDetails,
    bindMismatches: result.after.bindMismatches,
    deficits: result.after.deficits,
    filteredScheduleRows: result.filteredScheduleRows,
    backendAudit: result.after.backendAudit,
    profileDetails: result.profileDetails,
    preflight: result.preflight,
    dynamicFailureEvents: result.conflictPressure?.failureEvents || 0,
    runSummary: result.runSummary
  };
  if (compact) {
    const failureReasonCounts = {};
    (result.failureDetails || []).forEach(item => {
      const reason = String(item.failureReason || '');
      if (reason) failureReasonCounts[reason] = (failureReasonCounts[reason] || 0) + 1;
    });
    const blockerCounts = {};
    (result.failureDetails || []).forEach(item => {
      Object.entries(item.constraintGraph?.blockerCounts || {}).forEach(([blocker, count]) => {
        blockerCounts[blocker] = (blockerCounts[blocker] || 0) + Number(count || 0);
      });
    });
    console.log(JSON.stringify({
      mode: result.mode,
      randomize: result.randomize,
      randomSeed: result.randomSeed,
      elapsedMs: result.elapsedMs,
      remainingLessons: result.after.remainingLessons,
      hardViolations: result.after.hardViolations,
      qualityScore: result.after.qualityScore,
      teacherGaps: result.after.teacherGaps,
      teacherImbalance: result.after.teacherImbalance,
      bindMismatches: result.after.bindMismatches,
      deficits: result.after.deficits,
      failureDetails: (result.failureDetails || []).slice(0, 20).map(item => ({
        classCode: item.classCode,
        subjectCode: item.subjectCode,
        teacherCode: item.teacherCode,
        failureReason: item.failureReason,
        dynamicPressure: item.dynamicPressure,
        tightSlots: item.constraintGraph?.tightSlots || [],
        blockerCounts: item.constraintGraph?.blockerCounts || {}
      })),
      failureReasonCounts,
      topBlockers: Object.entries(blockerCounts).sort((left, right) => right[1] - left[1]).slice(0, 8),
      dynamicFailureEvents: summary.dynamicFailureEvents,
      preflightIssues: result.preflight?.issues?.length || 0,
      tightClasses: result.preflight?.bottlenecks?.tightClasses || [],
      timedOut: result.runSummary?.timedOut || false,
      repairBudgetExceeded: result.runSummary?.repairBudgetExceeded || false,
      repairOperationCount: result.runSummary?.repairOperationCount || 0,
      repairOperationLimit: result.runSummary?.repairOperationLimit || 0,
      repairGlobalReserveMs: result.runSummary?.repairGlobalReserveMs || 0,
      conflictGraphMoves: result.runSummary?.conflictGraphMoves || 0,
      conflictGraphSearches: result.runSummary?.conflictGraphSearches || 0,
      conflictGraphNodes: result.runSummary?.conflictGraphNodes || 0,
      conflictGraphCandidates: result.runSummary?.conflictGraphCandidates || 0,
      bindFailureDiagnostics: result.runSummary?.bindFailureDiagnostics || [],
      neighborhoodRepairMoves: result.runSummary?.neighborhoodRepairMoves || 0,
      globalMatchingPasses: result.runSummary?.globalMatchingPasses || 0,
      neighborhoodRepairStats: result.runSummary?.neighborhoodRepairStats || null,
      localOptimizationMoves: result.runSummary?.localOptimizationMoves || 0,
      localOptimizationCandidates: result.runSummary?.localOptimizationCandidates || 0,
      localOptimizationAttemptedMoves: result.runSummary?.localOptimizationAttemptedMoves || 0,
      localOptimizationRollbacks: result.runSummary?.localOptimizationRollbacks || 0,
      qualityGraceActive: result.runSummary?.qualityGraceActive || false,
      backendAuditOk: result.after.backendAudit.ok
    }));
    return;
  }
  console.log(JSON.stringify(profileOnly ? result.profileDetails : (summaryOnly ? summary : result), null, 2));
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
