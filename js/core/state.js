/* 全域常數、狀態容器與純網域判斷函式（無 DOM 相依，可供主執行緒與 Web Worker 共用） */

// ============================================================
// GAS URL（契約 §3.C 三層優先序）
// ============================================================
const DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycby8i5bnQ-oKZMO1HUQO6pJF6f_XQL8bQHO2Yj3nJ2D7NCzNZbe_bhks8hxTVZWWSxz7/exec";  // 已鎖定部署網址
const FRONTEND_VERSION = '20261007_v4_seasonal_slots';
const ASSET_VERSION = '20261113_v8_phase3';

function resolveGasUrl() {
  if (DEFAULT_GAS_URL && DEFAULT_GAS_URL.trim()) return DEFAULT_GAS_URL.trim();
  if (typeof window === 'undefined' || !window.location) return '';
  try {
    const p = new URLSearchParams(window.location.search).get('config');
    if (p) {
      try {
        const d = atob(p);
        if (typeof localStorage !== 'undefined') localStorage.setItem('gas_url', d);
        return d;
      } catch (e) {}
    }
    return (typeof localStorage !== 'undefined' ? localStorage.getItem('gas_url') : '') || '';
  } catch (e) {
    return '';
  }
}
let GAS_URL = resolveGasUrl();

// 啟動時若無 URL 則開啟設定彈窗（在 init 後判斷）

// ============================================================
// 常數
// ============================================================
const DAYS    = ['一', '二', '三', '四', '五'];
const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];
const EARLY_PERIOD = 0;
const LUNCH_PERIOD = 45;
const DISPLAY_PERIODS = [EARLY_PERIOD, 1, 2, 3, 4, LUNCH_PERIOD, 5, 6, 7, 8];
const PERIOD_TIMES = {
  0:'07:40', 1:'08:30', 2:'09:25', 3:'10:20', 4:'11:15',
  45:'12:35',
  5:'13:20', 6:'14:15', 7:'15:15', 8:'16:10'
};
const DAY_NAMES = ['', '週一', '週二', '週三', '週四', '週五'];
const ATTR_LABELS = { '一般': '', '巡堂': '巡', '抽離': '離', '單週': '單', '雙週': '雙', '實支': '彈' };

function isManualOnlyPeriod(period) {
  const value = parseInt(period, 10);
  return value === EARLY_PERIOD || value === LUNCH_PERIOD;
}

function schedulePeriodValue(entry) {
  if (!entry) return NaN;
  const raw = entry['節次'] !== undefined ? entry['節次'] : entry.period;
  return parseInt(raw, 10);
}

function scheduleAttributeValue(entry) {
  if (!entry) return '';
  const raw = entry['課堂屬性'] !== undefined ? entry['課堂屬性'] : entry.attr;
  return String(raw == null ? '' : raw).trim();
}

function isAlternateWeekPair(left, right) {
  if (schedulePeriodValue(left) !== 8 || schedulePeriodValue(right) !== 8) return false;
  const leftAttr = scheduleAttributeValue(left);
  const rightAttr = scheduleAttributeValue(right);
  return (leftAttr === '單週' && rightAttr === '雙週') ||
    (leftAttr === '雙週' && rightAttr === '單週');
}

function periodLabel(period) {
  const value = parseInt(period, 10);
  if (value === EARLY_PERIOD) return '早自習';
  if (value === LUNCH_PERIOD) return '午休';
  return '第' + value + '節';
}

function isVirtualClassCode(classCode) {
  return String(idx.classByCode?.[String(classCode || '')]?.['是否虛擬班'] || '').toUpperCase() === 'TRUE';
}

function isTeacherOvertimeItem(item) {
  return !!item && (
    item['超鐘點'] === true ||
    String(item['超鐘點'] || '').toUpperCase() === 'TRUE'
  );
}

function isOvertimeScheduleEntry(cell, teacherCode) {
  if (!cell) return false;
  const code = String(teacherCode || '').trim();
  if (code) {
    const teacherList = getCellTeacherList(cell);
    const teacher = teacherList.find(item => String(item['教師姓名'] || '').trim() === code);
    if (teacher) {
      return isTeacherOvertimeItem(teacher) ||
        (teacherList.length === 1 && String(cell['課堂屬性'] || '').trim() === '超鐘點');
    }
  }
  return String(cell['課堂屬性'] || '').trim() === '超鐘點';
}

function teacherSubjectLabel(cell, teacherCode) {
  if (isPatrolScheduleEntry(cell)) return '巡堂';
  const subject = String(cell && cell['科目代碼'] || '').trim();
  return subject + (isOvertimeScheduleEntry(cell, teacherCode) ? '（超）' : '');
}

function isPatrolScheduleEntry(entry) {
  if (!entry) return false;
  return [entry['課堂屬性'], entry['班級代碼'], entry['科目代碼']]
    .some(value => String(value || '').trim().includes('巡堂'));
}

function normalizePatrolScheduleEntry(entry) {
  if (!isPatrolScheduleEntry(entry)) return entry;
  return {
    ...entry,
    '班級代碼': '',
    '科目代碼': '',
    '課堂屬性': '巡堂',
    '是否鎖定': 'TRUE'
  };
}

function isPatrolEligibleTeacher(teacher) {
  if (!teacher) return false;
  const title = String(teacher['職務'] || teacher['職稱'] || '').trim();
  return /行政|組長|主任/.test(title);
}

// 網頁課表領域色票：同一領域固定同色，與 Word 匯出配色規則分開。
const SUBJECT_COLOR_GROUPS = [
  { key: 'chinese', label: '國文', aliases: ['國文', '國語文', '國語'], color: { bg: '#dbeafe', text: '#1e3a8a' } },
  { key: 'english', label: '英語', aliases: ['英語', '英文', '英語文'], color: { bg: '#dcfce7', text: '#166534' } },
  { key: 'local', label: '本土語', aliases: ['本土語', '本土語文', '閩南語', '台語', '臺語', '客語', '原住民族語', '族語'], color: { bg: '#ccfbf1', text: '#115e59' } },
  { key: 'math', label: '數學', aliases: ['數學'], color: { bg: '#fef3c7', text: '#92400e' } },
  { key: 'science', label: '自然、理化、生物', aliases: ['自然', '自然科', '自然科學', '理化', '物理', '化學', '生物', '地球科學'], color: { bg: '#e0f2fe', text: '#075985' } },
  { key: 'special', label: '特殊課程', aliases: ['社會技巧', '學習策略', '視覺聽寫', '音樂史', '音樂史與樂曲賞析', '絃竹室內樂'], color: { bg: '#f3f4f6', text: '#374151' } },
  { key: 'social', label: '地理、歷史、公民', aliases: ['地理', '歷史', '公民', '公民與社會', '社會'], color: { bg: '#ede9fe', text: '#5b21b6' } },
  { key: 'health', label: '體育、健康教育', aliases: ['體育', '健康教育', '健康與體育', '健康'], color: { bg: '#ffedd5', text: '#9a3412' } },
  { key: 'comprehensive', label: '家政、童軍、輔導', aliases: ['家政', '童軍', '輔導', '綜合活動', '綜合'], color: { bg: '#fce7f3', text: '#9d174d' } },
  { key: 'technology', label: '生活科技、資訊科技', aliases: ['生活科技', '資訊科技', '資訊', '電腦', '科技'], color: { bg: '#e0e7ff', text: '#3730a3' } },
  { key: 'arts', label: '表演藝術、視覺藝術、音樂', aliases: ['表演藝術', '視覺藝術', '音樂', '藝術'], color: { bg: '#fae8ff', text: '#86198f' } },
  { key: 'other', label: '其他彈性課程', aliases: ['其他彈性課程', '彈性課程', '彈性', '班週會', '週會', '班會', '社團', '閱讀', '閱讀課', '校訂課程'], color: { bg: '#f1f5f9', text: '#475569' } }
];

function normalizeSubjectColorName(value) {
  return String(value || '').trim().replace(/\s+/g, '').replace(/輔$/i, '');
}

function isHelperSubjectCode(value) {
  return /輔$/i.test(String(value || '').trim());
}

function getSubjectColorGroup(subCode) {
  const normalized = normalizeSubjectColorName(subCode);
  return SUBJECT_COLOR_GROUPS.find(group => group.aliases.some(alias => {
    const candidate = normalizeSubjectColorName(alias);
    return normalized === candidate || normalized.startsWith(candidate);
  })) || SUBJECT_COLOR_GROUPS.find(group => group.key === 'other');
}

// ============================================================
// State
// ============================================================
let state = {
      classes: [
      { '班級代碼':'701','年級':'7','班級名稱':'七年一班','導師代碼':'','是否虛擬班':'FALSE' },
      { '班級代碼':'702','年級':'7','班級名稱':'七年二班','導師代碼':'','是否虛擬班':'FALSE' },
      { '班級代碼':'703','年級':'7','班級名稱':'七年三班','導師代碼':'','是否虛擬班':'FALSE' },
      { '班級代碼':'704','年級':'7','班級名稱':'七年四班','導師代碼':'','是否虛擬班':'FALSE' },
      { '班級代碼':'705','年級':'7','班級名稱':'七年五班','導師代碼':'','是否虛擬班':'FALSE' },
      { '班級代碼':'706','年級':'7','班級名稱':'七年六班','導師代碼':'','是否虛擬班':'FALSE' },
      { '班級代碼':'707','年級':'7','班級名稱':'七年七班(音樂班)','導師代碼':'','是否虛擬班':'FALSE' },
      { '班級代碼':'801','年級':'8','班級名稱':'八年一班','導師代碼':'','是否虛擬班':'FALSE' },
      { '班級代碼':'802','年級':'8','班級名稱':'八年二班','導師代碼':'','是否虛擬班':'FALSE' },
      { '班級代碼':'803','年級':'8','班級名稱':'八年三班','導師代碼':'','是否虛擬班':'FALSE' },
      { '班級代碼':'804','年級':'8','班級名稱':'八年四班','導師代碼':'','是否虛擬班':'FALSE' },
      { '班級代碼':'805','年級':'8','班級名稱':'八年五班','導師代碼':'','是否虛擬班':'FALSE' },
      { '班級代碼':'806','年級':'8','班級名稱':'八年六班','導師代碼':'','是否虛擬班':'FALSE' },
      { '班級代碼':'807','年級':'8','班級名稱':'八年七班(音樂班)','導師代碼':'','是否虛擬班':'FALSE' },
      { '班級代碼':'901','年級':'9','班級名稱':'九年一班','導師代碼':'','是否虛擬班':'FALSE' },
      { '班級代碼':'902','年級':'9','班級名稱':'九年二班','導師代碼':'','是否虛擬班':'FALSE' },
      { '班級代碼':'903','年級':'9','班級名稱':'九年三班','導師代碼':'','是否虛擬班':'FALSE' },
      { '班級代碼':'904','年級':'9','班級名稱':'九年四班','導師代碼':'','是否虛擬班':'FALSE' },
      { '班級代碼':'905','年級':'9','班級名稱':'九年五班','導師代碼':'','是否虛擬班':'FALSE' },
      { '班級代碼':'906','年級':'9','班級名稱':'九年六班','導師代碼':'','是否虛擬班':'FALSE' },
      { '班級代碼':'907','年級':'9','班級名稱':'九年七班(音樂班)','導師代碼':'','是否虛擬班':'FALSE' }
    ],     teachers: [], subjects:[],
            assignments: [], schedule:[], scheduleRevision:'', teacherBlocks:[], subjectRules:[], subjectRelations:[], blockGroups:[], rooms:[], scheduleColors:[], teacherExclusives:[],
            seasonalSessions:[], seasonalDays:[], seasonalNeeds:[], seasonalTeacherBlocks:[], seasonalSchedule:[], apiVersion:'', schemaVersion:'',
  settings:{}
};
let idx = {
  classByCode:{}, teacherByCode:{}, subjectByCode:{},
  subjectColor:{},
  schedByClassSlot:{},   // `cls|day|period` -> cell
  schedByTeacherSlot:{}, // `tc|day|period` -> cell[]
  schedBySubjectSlot:{}, // `sub|day|period` -> count
  schedByClassSlotP8:{}, // `cls|day|8` -> { '單週': cell, '雙週': cell }
  blockSet: new Set(),   // `tc|day|period`
  rulesBySubjectSlot:{}, // `sub|day|period` -> rules[]
  rulesBySubject: Object.create(null), // `sub` | '*' -> rules[]
  subjectRelationsBySubject:{}, // subjectCode -> relation rules[]
  bindGroupByCode:{},    // groupId -> group
  bindBySubject:{},      // subjectCode -> group[]
  bindByClass:{},        // classCode -> group[]
  roomByCode:{},         // roomCode -> room
  schedByRoomSlot:{},    // `roomCode|day|period` -> cell[]
  assignmentsByClass:{}, // classCode -> assignment[]
  scheduleCountByClass:{}, // classCode -> scheduled count
  classNonHelperScheduleCount: Object.create(null), // classCode -> non-helper count
  preplannedAssignmentKeySet: new Set(), // `cls|sub` with preplanned attribute
  schedByClassDayEntries: Object.create(null), // `cls|day` -> entry[]
  schedByClassSubjectDay: Object.create(null), // `cls|sub|day` -> entry[]
  teacherScheduleKeysByCode: Object.create(null), // teacherCode -> Set(`tc|day|per`)
  exclusiveRulesByTeacher: Object.create(null), // teacherCode -> [{ rule, peerCodes }]
  exclusivePairSet: new Set(), // `tc1|tc2` (sorted) -> true
};
let ui = {
  activeTab:'timetable', selectedClass:'', selectedTeacher:'', selectedRoom:'',
  thirdOpen:false, thirdView:'class', thirdSelectedClass:'', thirdSelectedTeacher:'', thirdSelectedRoom:'',
  drag:null, ctxTarget:null, blockSlots: new Set(), ruleSlots: new Set(),
  assignTarget: null, dataRevision: 0
};

function isPerfEnabled() {
  try {
    if (typeof window !== 'undefined' && window.__SCH_PERF__ === true) return true;
    return typeof location !== 'undefined' && new URLSearchParams(location.search || '').get('perf') === '1';
  } catch (e) {
    return false;
  }
}
function perfNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
const _perfRecords = [];
function perfRecord(label, durationMs, meta = null) {
  if (!isPerfEnabled()) return;
  const entry = {
    label: String(label || ''),
    durationMs: Number((Number(durationMs) || 0).toFixed(2)),
    at: new Date().toISOString(),
    ...(meta ? { meta } : {})
  };
  _perfRecords.push(entry);
  if (_perfRecords.length > 200) _perfRecords.shift();
}
function perfMeasureSync(label, fn, meta = null) {
  if (!isPerfEnabled()) return fn();
  const started = perfNow();
  try {
    return fn();
  } finally {
    perfRecord(label, perfNow() - started, meta);
  }
}
if (typeof window !== 'undefined') {
  window.__getPerfReport = () => _perfRecords.slice();
}
function bumpDataRevision() {
  if (typeof _lastAppliedBootstrapDigest !== 'undefined') {
    _lastAppliedBootstrapDigest = '';
  }
  if (typeof ui !== 'undefined' && ui) {
    ui.dataRevision = (ui.dataRevision || 0) + 1;
  }
  return typeof ui !== 'undefined' && ui ? ui.dataRevision : 0;
}

function parseWeeklyValue(value, fallback = 0) {
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isAlternateWeeklyValue(value) {
  return Math.abs(parseWeeklyValue(value, 0) - 0.5) < 0.000001;
}

function formatWeeklyValue(value) {
  const parsed = parseWeeklyValue(value, 0);
  if (!Number.isFinite(parsed)) return '';
  return Number.isInteger(parsed) ? String(parsed) : String(Number(parsed.toFixed(2)));
}

function isValidWeeklyInput(value, allowBlank = true) {
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!raw) return allowBlank;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && (isAlternateWeeklyValue(parsed) || (Number.isInteger(parsed) && parsed >= 1 && parsed <= 20));
}

function getSubjectWeeklyValue(subject, fallback = 3) {
  const weekly = parseWeeklyValue(subject?.['每週節數'], fallback);
  return weekly > 0 ? weekly : fallback;
}

function getAssignmentWeeklyValue(assignment, subject = null, fallback = 3) {
  const custom = parseWeeklyValue(assignment?.['每週節數'], 0);
  if (custom > 0) return custom;
  return getSubjectWeeklyValue(subject || idx?.subjectByCode?.[String(assignment?.['科目代碼'] || '').trim()], fallback);
}

function isPreplannedCourse(value) {
  return String(value || '').trim() === '預排';
}

function isPreplannedScheduleEntry(entry) {
  if (!entry || isPatrolScheduleEntry(entry)) return false;
  const classCode = String(entry['班級代碼'] || '').trim();
  const subjectCode = String(entry['科目代碼'] || '').trim();
  if (!classCode || !subjectCode) return false;
  if (typeof idx !== 'undefined' && idx && idx.__built && idx.preplannedAssignmentKeySet instanceof Set) {
    return idx.preplannedAssignmentKeySet.has(classCode + '|' + subjectCode);
  }
  return (state.assignments || []).some(assignment =>
    String(assignment['班級代碼'] || '').trim() === classCode &&
    String(assignment['科目代碼'] || '').trim() === subjectCode &&
    isPreplannedCourse(assignment['課程屬性'])
  );
}

function getScheduleWeeklyUnits(entry) {
  const period = parseInt(entry?.['節次'], 10);
  const attr = String(entry?.['課堂屬性'] || '').trim();
  return period === 8 && (attr === '單週' || attr === '雙週') ? 0.5 : 1;
}

function buildAutoScheduleEntriesByClassSubject(schedule) {
  const index = new Map();
  (Array.isArray(schedule) ? schedule : []).forEach(entry => {
    const classCode = String(entry?.['班級代碼'] || '').trim();
    const subjectCode = String(entry?.['科目代碼'] || '').trim();
    if (!classCode || !subjectCode) return;
    const key = classCode + '|' + subjectCode;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(entry);
  });
  return index;
}

function buildAutoAssignmentWeeklyIndex(assignments, subjectByCode = {}) {
  const index = new Map();
  (Array.isArray(assignments) ? assignments : []).forEach(assignment => {
    const classCode = String(assignment?.['班級代碼'] || '').trim();
    const subjectCode = String(assignment?.['科目代碼'] || '').trim();
    if (!classCode || !subjectCode) return;
    const weekly = getAssignmentWeeklyValue(assignment, subjectByCode[subjectCode], 0);
    if (weekly <= 0) return;
    const key = classCode + '|' + subjectCode;
    index.set(key, (index.get(key) || 0) + weekly);
  });
  return index;
}

// ============================================================
// 教師搜尋 datalist 輔助函數
// ============================================================
function formatTeacherCodeName(code, teacher) {
  const codeText = String(code || '').trim();
  const nameText = String((teacher && (teacher['姓名'] || teacher['教師姓名'])) || '').trim();
  if (!codeText) return nameText;
  if (!nameText || codeText === nameText) return codeText;
  return codeText + ' ' + nameText;
}

function parseTeacherCode(val) {
  if (!val) return '';
  val = String(val).trim();
  const match = state.teachers.find(t => {
    const code = String(t['教師姓名'] || t['姓名'] || '').trim();
    const name = String(t['姓名'] || t['教師姓名'] || '').trim();
    return code === val || name === val || formatTeacherCodeName(code, t) === val;
  });
  if (match) return match['教師姓名'] || match['姓名'];
  return val;
}

/**
 * 將輸入的教師代碼、姓名或物件，解析為包含代碼與姓名的全集陣列
 * 確保無論以「代碼」還是「姓名」設定互斥，比對時 100% 互通。
 */
function resolveTeacherCodes(input) {
  if (!input) return [];
  const rawCodes = typeof input === 'object' ? getCellTeacherCodes(input) : getCellTeacherCodes({'教師姓名': input});
  const resultSet = new Set();
  rawCodes.forEach(code => {
    if (!code) return;
    resultSet.add(code);
    if (idx && idx.teacherByCode && idx.teacherByCode[code]) {
      const name = (idx.teacherByCode[code] ? (idx.teacherByCode[code]['教師姓名'] || idx.teacherByCode[code]['姓名']) : code);
      if (name) resultSet.add(name);
    }
    if (state && state.teachers) {
      state.teachers.forEach(t => {
        if ((t['教師姓名'] || t['姓名']) === code && t['教師姓名']) resultSet.add(t['教師姓名']);
      });
    }
  });
  return Array.from(resultSet);
}

// ============================================================
// 多教師輔助：解析排課格的統一「教師代碼」欄（單一欄位，相容單師與多師）
// 支援格式：
//  1) 物件陣列 [{ '教師姓名':.., '標籤':.. }, ...]
//  2) 字串陣列 ['T01','T02', ...]
//  3) JSON 字串 '[{"教師姓名":"T01","標籤":"台"}, ...]'（多師儲存格式）
//  4) 純教員代碼字串 'T01' 或逗號分隔 'T01,T02'（單師舊資料）
// 空／缺欄位 → 回傳空陣列（相容）
// 單師舊資料（純字串）不需遷移，直接相容。
// ============================================================
function getCellTeacherList(cell) {
  const raw = Array.isArray(cell) ? cell : (cell ? (cell['教師姓名'] ?? cell['教師代碼'] ?? cell['教師']) : null);
  if (raw == null || raw === '') return EMPTY_LIST;
  const out = [];
  if (Array.isArray(raw)) {
    raw.forEach(item => {
      const normalized = normalizeTeacherItem(item);
      if (normalized) out.push(normalized);
    });
  } else {
    const s = String(raw).trim();
    if (s.indexOf('[') === 0 && s.indexOf(']') === s.length - 1) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) {
          parsed.forEach(item => {
            const normalized = normalizeTeacherItem(item);
            if (normalized) out.push(normalized);
          });
          return out;
        }
      } catch (e) { /* 非 JSON，走逗號分隔解析 */ }
    }
    String(raw).split(/[,，、;；]/).forEach(s => {
      const code = String(s || '').trim();
      if (code) out.push({ '教師姓名': code, '標籤': '' });
    });
  }
  return out;
}
const EMPTY_LIST = Object.freeze([]);

function normalizeTeacherItem(item) {
  if (item == null) return null;
  const objectItem = typeof item === 'object' ? item : null;
  const code = String(objectItem ? (objectItem['教師姓名'] || objectItem['姓名'] || objectItem.code || '') : item).trim();
  if (!code) return null;
  const normalized = {
    '教師姓名': code,
    '標籤': String(objectItem ? (objectItem['標籤'] || objectItem.tag || '') : '').trim()
  };
  if (isTeacherOvertimeItem(objectItem)) normalized['超鐘點'] = true;
  return normalized;
}

function normalizeTeacherList(teacherList) {
  return (Array.isArray(teacherList) ? teacherList : [])
    .map(normalizeTeacherItem)
    .filter(item => item['教師姓名']);
}

function serializeTeacherList(teacherList) {
  const list = normalizeTeacherList(teacherList);
  return list.length > 1 || list.some(item => item['標籤'] || item['超鐘點'])
    ? JSON.stringify(list)
    : (list[0] ? list[0]['教師姓名'] : '');
}

function getClassTeacherList(cell) {
  const scheduled = getCellTeacherList(cell);
  if (!cell) return scheduled;
  const classCode = String(cell['班級代碼'] || '').trim();
  const subjectCode = String(cell['科目代碼'] || '').trim();
  if (!classCode || !subjectCode) return scheduled;
  const assignment = (idx.teacherByClassSubject && idx.teacherByClassSubject[classCode + '|' + subjectCode]) ||
    (state.assignments || []).find(item =>
      String(item['班級代碼'] || '').trim() === classCode &&
      String(item['科目代碼'] || '').trim() === subjectCode
    );
  const configured = assignment ? getCellTeacherList(assignment) : [];
  return configured.length > 0 ? configured : scheduled;
}

// 全部教師代碼（主師＋多師），用於衝突／索引
function getCellTeacherCodes(cell) {
  const list = getCellTeacherList(cell);
  if (list.length === 0) {
    const tc = cell && String(cell['教師姓名'] || '').trim();
    return tc ? [tc] : [];
  }

  return list.map(t => t['教師姓名']);
}

// 多師循環：依目前選定的教師，回傳「下一位」；非在清單中則回傳第一位
function cycleNextTeacher(codes, current) {
  const list = (codes || []).map(c => String(c || '').trim()).filter(Boolean);
  if (list.length === 0) return '';
  const cur = String(current || '').trim();
  if (!cur) return list[0];
  const idx = list.indexOf(cur);
  if (idx < 0) return list[0];
  return list[(idx + 1) % list.length];
}

// 多班循環（去重）：教師課表中同節多班時，依目前選定的班級輪切到「下一個班」
function cycleNextClass(classCodes, current) {
  const list = [...new Set((classCodes||[]).map(c => String(c||'').trim()).filter(Boolean))];
  if (list.length === 0) return '';
  const cur = String(current||'').trim();
  const idx = cur ? list.indexOf(cur) : -1;
  if (idx >= 0) return list[(idx + 1) % list.length];
  return list[0];
}

// 固定課程配色預設色票（參考 114 班級課表 Word 底色），可自訂
const SCHEDULE_COLOR_PRESETS = [
  { name: '淺藍', value: 'DEEAF6' },
  { name: '淺綠', value: 'E2EFD9' },
  { name: '淺橘', value: 'FBE4D5' },
  { name: '鵝黃', value: 'FFF2CC' },
  { name: '粉色', value: 'FFD5D5' },
  { name: '淡粉', value: 'FFDDDD' },
  { name: '淺紫', value: 'CCCCFF' },
  { name: '灰色', value: 'D9D9D9' },
  { name: '淺灰', value: 'F2F2F2' },
  { name: '深灰', value: 'D0CECE' },
  { name: '自訂', value: '' }
];

function parseSubjectMaxConsecutiveDays(subject) {
  const raw = String(subject?.['最多連日'] ?? '').trim();
  if (!raw) return 0;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function isFrozenScheduleEntry(entry) {
  if (!entry) return false;
  if (isPatrolScheduleEntry(entry)) return true;
  if (String(entry['是否鎖定'] || '').toUpperCase() === 'TRUE') return true;
  const classCode = String(entry['班級代碼'] || '');
  const subjectCode = String(entry['科目代碼'] || '').trim();
  const day = parseInt(entry['星期'], 10);
  const period = parseInt(entry['節次'], 10);
  if (isManualOnlyPeriod(period) || (period === 8 && ['單週', '雙週'].includes(String(entry['課堂屬性'] || '').trim()))) return true;
  const classInfo = idx.classByCode?.[classCode];
  const grade = String(classInfo?.['年級'] || '').trim();
  const rules = idx.rulesBySubjectSlot?.[subjectCode + '|' + day + '|' + period] || [];
  return rules.some(rule => {
    return String(rule['規則類型'] || '').trim() === '必排' && ruleAppliesToClass(rule, classCode, grade);
  });
}

function isClearablePeriodEightScheduleEntry(entry) {
  const period = parseInt(entry?.['節次'], 10);
  const attr = String(entry?.['課堂屬性'] || '').trim();
  return period === 8 && (attr === '單週' || attr === '雙週');
}

function isClearFrozenScheduleEntry(entry) {
  const explicitlyLocked = String(entry?.['是否鎖定'] || '').toUpperCase() === 'TRUE';
  if (explicitlyLocked) return true;
  if (String(entry?.['課堂屬性'] || '').trim() === '抽離') return false;
  return isFrozenScheduleEntry(entry) && (!isClearablePeriodEightScheduleEntry(entry) || explicitlyLocked);
}

function getSubjectColor(subCode) {
  return getSubjectColorGroup(subCode).color;
}

// 網頁課表只使用領域色票，Word 底色由 resolveScheduleColor 獨立處理。
function getScheduleCellColor(subjectCode, classCode) {
  return getSubjectColor(subjectCode);
}

function isSubjectBlockBound(subjectCode, classCode) {
  const groups = idx.bindBySubject[subjectCode] || [];
  return groups.some(g => {
    const clsList = typeof g['班級清單'] === 'string' ? g['班級清單'].split(',').map(c => c.trim()).filter(Boolean) : (Array.isArray(g['班級清單']) ? g['班級清單'] : (typeof g['班級清單'] === 'number' ? String(g['班級清單']).match(/.{3}/g)||[] : []));
    return clsList.includes(String(classCode));
  });
}

function getRealSubjects() { return (state.subjects || []).filter(s => String(s['科目代碼'] || '').trim()); }
function getRealClasses() { return (state.classes || []).filter(c => String(c['班級代碼'] || '').trim()); }
function getClassGrade(c) {
  const g = String(c['年級'] || '').trim();
  if (g) return g.charAt(0);
  return String(c['班級代碼'] || '').charAt(0);
}
function parseClassCodeList(value) {
  // 支援 901-906 範圍、逗號／全形逗號／頓號分隔；無數字之 token（如 checkbox 的 on）直接忽略
  const tokens = String(value || '').split(/[,，、;；]/).map(s => s.trim()).filter(Boolean).filter(t => /\d/.test(t));
  const out = [];
  tokens.forEach(t => {
    const m = t.match(/^([^\d]*)(\d+)-([^\d]*)(\d+)$/);
    if (m && m[1] === m[3]) {
      const prefix = m[1];
      const a = parseInt(m[2], 10), b = parseInt(m[4], 10);
      const from = Math.min(a, b), to = Math.max(a, b);
      for (let n = from; n <= to; n++) out.push(prefix + String(n));
    } else {
      out.push(t);
    }
  });
  return [...new Set(out)];
}
function compressClassCodeList(codes) {
  // 將 701,702,703,705 壓縮為 701-703,705；同前綴＋連續才合併
  const sorted = [...new Set(codes.map(c => String(c || '').trim()).filter(Boolean))].sort((a, b) =>
    String(a).localeCompare(String(b), 'zh-Hant', { numeric: true }));
  if (sorted.length <= 1) return sorted.join(',');
  const groups = [];
  let start = sorted[0], prev = sorted[0];
  const pushGroup = () => {
    groups.push(prev === start ? start : (startPrefix(prev) === startPrefix(start) ? `${start}-${prev}` : start));
  };
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const strip = s => s.replace(/\D/g, '');
    const cont = getInt(cur) === getInt(prev) + 1 && namePrefix(cur) === namePrefix(prev);
    if (cont) { prev = cur; continue; }
    pushGroup();
    start = cur; prev = cur;
  }
  pushGroup();
  return groups.join(',');
  function getInt(s) { const n = parseInt(s.replace(/\D/g, ''), 10); return isNaN(n) ? -1 : n; }
  function namePrefix(s) { return s.replace(/\d/g, ''); }
  function startPrefix(s) { return namePrefix(s); }
}

function getTeacherBlockSlots(block) {
  return String(block['時段'] || '').split(',').map(value => {
    const [day, period] = value.trim().split('-').map(Number);
    return {day, period};
  }).filter(slot => slot.day >= 1 && slot.day <= 5 && slot.period >= 1 && slot.period <= 8);
}

function getTeacherHomeroom(t) {
  if (!t) return '';
  const title = t['職稱'] !== undefined ? String(t['職稱']).trim() : '';
  if (title) {
    const match = title.match(/(\d{3})/);
    if (match) return match[1];
    if (title.includes('導師')) return 'TRUE';
  }
  return '';
}

function isTeacherAdmin(t) {
  if (!t) return false;
  const title = String(t['職稱'] || t['備註'] || '').trim();
  if (!title) return false;
  const keywords = ['校長', '主任', '組長', '秘書', '執祕', '幹事', '行政', '組員', '人事', '會計'];
  return keywords.some(kw => title.includes(kw));
}

// 班級導師顯示標籤
function classTeacherLabel(cls) {
  const teacher = idx.homeroomTeacherByClass?.[String(cls['班級代碼'] || '')];
  if (teacher) return String((teacher['教師姓名'] || teacher['姓名']) || '') || '—';
  const legacy = state.teachers.find(t => String(getTeacherHomeroom(t)) === String(cls['班級代碼'] || ''));
  return legacy ? String((legacy['教師姓名'] || legacy['姓名']) || '') : '—';
}

function parseDayNum(str) {
  if (str === null || str === undefined) return 0;
  const s = String(str).trim();
  if (/^[1-5]$/.test(s)) return parseInt(s, 10);
  if (s.includes('一') || s.includes('Mon')) return 1;
  if (s.includes('二') || s.includes('Tue')) return 2;
  if (s.includes('三') || s.includes('Wed')) return 3;
  if (s.includes('四') || s.includes('Thu')) return 4;
  if (s.includes('五') || s.includes('Fri')) return 5;
  return 0;
}

function getRuleDaysPeriods(rule) {
  if (!rule) return [];
  if (rule['星期'] !== undefined && rule['節次'] !== undefined && String(rule['星期']).trim() !== '' && String(rule['節次']).trim() !== '') {
    const d = parseDayNum(rule['星期']);
    const p = parseInt(rule['節次'], 10);
    if (!isNaN(p) && p >= 1 && p <= 8) return [{ day: d || 5, period: p }];
  }
  let raw = String(rule['時段'] || '').trim();
  if (!raw) return [];

  // 若遇到 Google 試算表傳出的 ISO 日期字串，嘗試解析月份與日期
  if (raw.includes('T') && !isNaN(Date.parse(raw))) {
    const dt = new Date(raw);
    raw = `${dt.getMonth() + 1}-${dt.getDate()}`;
  }

  const list = [];
  raw.split(/[,;\s]+/).forEach(item => {
    item = item.trim();
    if (!item) return;

    // 1. 優先匹配中文格式，如「週五第1節」、「週五1」、「五1」
    const zhMatch = item.match(/(?:週|星期)?([一二三四五1-5])[^\d]*(\d+)/);
    if (zhMatch) {
      const day = parseDayNum(zhMatch[1]);
      const period = parseInt(zhMatch[2], 10);
      if (day >= 1 && day <= 5 && period >= 1 && period <= 8) {
        list.push({ day, period });
        return;
      }
    }

    // 2. 精準匹配 "5-1", "5/1", "5_1", "5.1" 格式 (5代表星期五，1代表第1節)
    const numMatch = item.match(/^([1-5])\s*[-_/.:]\s*([1-8])$/);
    if (numMatch) {
      const day = parseInt(numMatch[1], 10);
      const period = parseInt(numMatch[2], 10);
      list.push({ day, period });
      return;
    }

    // 3. 通用劃分 (降級相容)
    if (item.includes('-') || item.includes('_') || item.includes(':') || item.includes('/')) {
      const parts = item.split(/[-_:/]/).map(s => s.trim());
      const d = parseDayNum(parts[0]);
      const p = parseInt(parts[1], 10);
      if (d >= 1 && d <= 5 && !isNaN(p) && p >= 1 && p <= 8) {
        list.push({ day: d, period: p });
      }
    }
  });
  return list.filter(x => x.day >= 1 && x.day <= 5 && x.period >= 1 && x.period <= 8);
}

function splitRuleScopeList(value) {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
  return String(value == null ? '' : value)
    .split(/[,，、;；]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function getRuleSubjectCodes(ruleOrValue) {
  const value = ruleOrValue && typeof ruleOrValue === 'object' && !Array.isArray(ruleOrValue)
    ? ruleOrValue['科目代碼']
    : ruleOrValue;
  return splitRuleScopeList(value);
}

function getRuleClassCodes(ruleOrValue) {
  const value = ruleOrValue && typeof ruleOrValue === 'object' && !Array.isArray(ruleOrValue)
    ? ruleOrValue['適用班級']
    : ruleOrValue;
  return splitRuleScopeList(value);
}

function sameRuleScopeList(left, right) {
  const a = [...new Set(splitRuleScopeList(left))].sort();
  const b = [...new Set(splitRuleScopeList(right))].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function ruleAppliesToClass(rule, classCode, gradeOverride) {
  const code = String(classCode || '').trim();
  const classInfo = idx.classByCode?.[code];
  const fallbackGrade = String(classInfo?.['年級'] || code.charAt(0)).trim();
  const grade = gradeOverride !== undefined
    ? String(gradeOverride || fallbackGrade).trim()
    : fallbackGrade;
  const ruleGrade = String(rule?.['適用年級'] || '全校').trim();
  if (ruleGrade !== '' && ruleGrade !== '全校' && ruleGrade !== grade) return false;
  const classCodes = getRuleClassCodes(rule);
  return classCodes.length === 0 || classCodes.includes(code);
}

function ruleAppliesToSubjectAndClass(rule, subjectCode, classCode, gradeOverride) {
  return getRuleSubjectCodes(rule).includes(String(subjectCode || '').trim()) &&
    ruleAppliesToClass(rule, classCode, gradeOverride);
}

function getSubjectRelationCodes(ruleOrValue) {
  if (!ruleOrValue || typeof ruleOrValue !== 'object' || Array.isArray(ruleOrValue)) return [];
  return [String(ruleOrValue['科目A'] || '').trim(), String(ruleOrValue['科目B'] || '').trim()].filter(Boolean);
}

function getSubjectRelationOtherCode(rule, subjectCode) {
  const code = String(subjectCode || '').trim();
  const pair = getSubjectRelationCodes(rule);
  if (pair.length !== 2 || !code) return '';
  if (pair[0] === code) return pair[1];
  if (pair[1] === code) return pair[0];
  return '';
}

function subjectRelationPairKey(subjectA, subjectB) {
  const pair = [String(subjectA || '').trim(), String(subjectB || '').trim()].filter(Boolean).sort();
  return pair.length === 2 && pair[0] !== pair[1] ? pair.join('|') : '';
}

function subjectRelationAppliesToClass(rule, classCode, gradeOverride) {
  return getSubjectRelationCodes(rule).length === 2 && ruleAppliesToClass(rule, classCode, gradeOverride);
}

function subjectRelationScopeLabel(rule) {
  const grade = String(rule?.['適用年級'] || '全校').trim() || '全校';
  const classes = getRuleClassCodes(rule);
  return grade + (classes.length ? '／' + classes.join('、') : '／依年級');
}

function collectAutoSchedulePreflightIssues() {
  const issues = [];
  const seen = new Set();
  const addIssue = (key, message) => {
    if (seen.has(key)) return;
    seen.add(key);
    issues.push(message);
  };
  const subjectCodes = new Set((state.subjects || []).map(subject => String(subject['科目代碼'] || '').trim()).filter(Boolean));
  const activePeriods = PERIODS.filter(period => !isManualOnlyPeriod(period));
  const activeSlotCount = DAYS.length * activePeriods.length;
  const classDemand = new Map();
  const teacherDemand = new Map();
  const roomDemand = new Map();
  const teacherAliases = new Map();
  const bottlenecks = { classes: [], teachers: [], rooms: [], tightClasses: [] };
  const getWeeklyForAssignment = assignment => {
    const subjectCode = String(assignment?.['科目代碼'] || '').trim();
    return getAssignmentWeeklyValue(assignment, idx.subjectByCode?.[subjectCode], 3);
  };
  const findTeacher = raw => {
    const value = String(raw || '').trim();
    return idx.teacherByCode?.[value] || (state.teachers || []).find(teacher =>
      String(teacher['教師姓名'] || '').trim() === value || String(teacher['姓名'] || '').trim() === value
    ) || null;
  };
  const canonicalTeacherKey = raw => {
    const teacher = findTeacher(raw);
    return String(teacher?.['教師姓名'] || teacher?.['姓名'] || raw || '').trim();
  };
  const addTeacherAlias = raw => {
    const value = String(raw || '').trim();
    const key = canonicalTeacherKey(value);
    if (!key) return '';
    if (!teacherAliases.has(key)) teacherAliases.set(key, new Set());
    teacherAliases.get(key).add(value);
    const teacher = findTeacher(value);
    if (teacher) {
      [teacher['教師姓名'], teacher['姓名']].forEach(alias => {
        const aliasValue = String(alias || '').trim();
        if (aliasValue) teacherAliases.get(key).add(aliasValue);
      });
    }
    return key;
  };
  const addDemand = (map, key, amount, extra = {}) => {
    if (!key || amount <= 0) return;
    const item = map.get(key) || { demand: 0, ...extra };
    item.demand += amount;
    map.set(key, item);
  };

  (state.assignments || []).forEach(assignment => {
    const classCode = String(assignment['班級代碼'] || '').trim();
    const subjectCode = String(assignment['科目代碼'] || '').trim();
    if (!classCode || !subjectCode) return;
    const weekly = getWeeklyForAssignment(assignment);
    const isHelper = isHelperSubjectCode(subjectCode);
    const scope = isHelper ? '第8節' : '第1至7節';
    const classInfo = idx.classByCode?.[classCode];
    addDemand(classDemand, classCode + '|' + scope, weekly, {
      classCode,
      scope,
      label: String(classInfo?.['班級名稱'] || classCode),
      capacity: isHelper ? DAYS.length : DAYS.length * (activePeriods.length - 1)
    });
    [...new Set(resolveTeacherCodes(assignment['教師姓名']).map(addTeacherAlias).filter(Boolean))].forEach(teacherCode => {
      addDemand(teacherDemand, teacherCode, weekly, { teacherCode });
    });
    const roomCode = String(idx.subjectByCode?.[subjectCode]?.['所屬教室代碼'] || '').trim();
    if (roomCode) {
      const room = idx.roomByCode?.[roomCode];
      addDemand(roomDemand, roomCode, weekly, {
        roomCode,
        roomLabel: String(room?.['教室名稱'] || roomCode),
        capacity: Math.max(1, parseInt(room?.['容量'] || '1', 10) || 1)
      });
    }
  });

  const addBottleneck = (list, item, capacity) => {
    const demand = Number(item.demand) || 0;
    const available = Math.max(0, Number(capacity) || 0);
    if (demand <= 0 || available <= 0) return;
    list.push({ ...item, capacity: available, utilization: Number((demand / available).toFixed(3)) });
  };
  classDemand.forEach(item => {
    addBottleneck(bottlenecks.classes, item, item.capacity);
    if (item.demand === item.capacity) bottlenecks.tightClasses.push({ ...item, slack: 0 });
    if (item.demand > item.capacity) {
      addIssue('class-capacity|' + item.classCode + '|' + item.scope,
        '班級「' + item.label + '」在' + item.scope + '每週需求 ' + formatWeeklyValue(item.demand) + ' 節，超過可用容量 ' + item.capacity + ' 格');
    }
  });
  teacherDemand.forEach(item => {
    const aliases = teacherAliases.get(item.teacherCode) || new Set([item.teacherCode]);
    let available = 0;
    for (let day = 1; day <= 5; day++) {
      for (const period of activePeriods) {
        if (![...aliases].some(alias => idx.blockSet.has(alias + '|' + day + '|' + period))) available++;
      }
    }
    addBottleneck(bottlenecks.teachers, item, available);
    if (item.demand > available) {
      addIssue('teacher-capacity|' + item.teacherCode,
        '教師「' + item.teacherCode + '」每週需求 ' + item.demand + ' 節，但扣除不排課時段後僅剩 ' + available + ' 格');
    }
  });
  roomDemand.forEach(item => {
    const available = DAYS.length * activePeriods.length * item.capacity;
    addBottleneck(bottlenecks.rooms, item, available);
    if (item.demand > available) {
      addIssue('room-capacity|' + item.roomCode,
        '教室「' + item.roomLabel + '」每週需求 ' + item.demand + ' 節，超過容量可提供的 ' + available + ' 班次');
    }
  });
  (state.blockGroups || []).forEach(group => {
    const classCodes = parseBindList(group?.['班級清單']);
    const subjectCodesForGroup = parseBindList(group?.['科目清單'] || group?.['科目代碼']);
    if (classCodes.length < 2 || subjectCodesForGroup.length === 0) return;
    const weeklyByClass = classCodes.map(classCode => ({
      classCode,
      weekly: subjectCodesForGroup.reduce((total, subjectCode) => total + (state.assignments || [])
        .filter(assignment => String(assignment['班級代碼'] || '').trim() === classCode &&
          String(assignment['科目代碼'] || '').trim() === subjectCode)
        .reduce((sum, assignment) => sum + getWeeklyForAssignment(assignment), 0), 0)
    }));
    const weeklyValues = new Set(weeklyByClass.map(item => item.weekly));
    if (weeklyValues.size > 1 && weeklyByClass.some(item => item.weekly > 0)) {
      const groupLabel = String(group['群組名稱'] || group['群組ID'] || classCodes.join('、'));
      addIssue('bind-weekly-mismatch|' + groupLabel,
        '綁班「' + groupLabel + '」各班每週節數不一致：' + weeklyByClass.map(item => item.classCode + '：' + item.weekly + ' 節').join('、'));
    }
  });
  [bottlenecks.classes, bottlenecks.teachers, bottlenecks.rooms].forEach(list => {
    list.sort((left, right) => right.utilization - left.utilization || right.demand - left.demand);
  });
  (state.subjectRelations || []).forEach(relation => {
    const pair = getSubjectRelationCodes(relation);
    if (pair.length !== 2) {
      addIssue('relation-shape|' + String(relation['規則ID'] || ''), '科目關係「' + String(relation['規則ID'] || '未命名') + '」缺少完整科目 A／B');
      return;
    }
    pair.filter(subjectCode => !subjectCodes.has(subjectCode)).forEach(subjectCode => {
      addIssue('relation-subject|' + subjectCode, '科目關係包含不存在的科目：「' + subjectCode + '」');
    });
  });

  const ruleSlots = new Map();
  (state.classes || []).forEach(classInfo => {
    const classCode = String(classInfo['班級代碼'] || '').trim();
    const grade = String(classInfo['年級'] || classCode.charAt(0)).trim();
    (state.subjectRules || []).forEach(rule => {
      const type = String(rule['規則類型'] || '').trim();
      if (!['必排', '禁排'].includes(type) || !ruleAppliesToClass(rule, classCode, grade)) return;
      getRuleSubjectCodes(rule).forEach(subjectCode => {
        getRuleDaysPeriods(rule).forEach(slot => {
          const key = classCode + '|' + subjectCode + '|' + slot.day + '|' + slot.period;
          if (!ruleSlots.has(key)) ruleSlots.set(key, new Set());
          ruleSlots.get(key).add(type);
        });
      });
    });
  });
  ruleSlots.forEach((types, key) => {
    if (types.size < 2) return;
    const parts = key.split('|');
    addIssue('rule-conflict|' + key, '科目「' + parts[1] + '」在班級 ' + parts[0] + ' 星期' + parts[2] + '第' + parts[3] + '節同時設定必排與禁排');
  });

  (state.assignments || []).forEach(assignment => {
    const classCode = String(assignment['班級代碼'] || '').trim();
    const subjectCode = String(assignment['科目代碼'] || '').trim();
    const teacherCodes = resolveTeacherCodes(assignment['教師姓名']);
    const classInfo = idx.classByCode[classCode];
    const grade = String(classInfo?.['年級'] || classCode.charAt(0)).trim();
    (state.subjectRules || []).filter(rule =>
      String(rule['規則類型'] || '').trim() === '必排' &&
      ruleAppliesToSubjectAndClass(rule, subjectCode, classCode, grade)
    ).forEach(rule => {
      getRuleDaysPeriods(rule).forEach(slot => {
        teacherCodes.forEach(teacherCode => {
          if (idx.blockSet.has(teacherCode + '|' + slot.day + '|' + slot.period)) {
            addIssue('teacher-must-block|' + teacherCode + '|' + classCode + '|' + subjectCode + '|' + slot.day + '|' + slot.period,
              '教師「' + teacherCode + '」的必排課程「' + subjectCode + '」落在不排課時段：班級 ' + classCode + ' 星期' + slot.day + '第' + slot.period + '節');
          }
        });
      });
    });
  });
  if (typeof window !== 'undefined') {
    window.__lastAutoSchedulePreflight = {
      activeSlotCount,
      issues: issues.slice(),
      bottlenecks: {
        classes: bottlenecks.classes.slice(0, 12),
        teachers: bottlenecks.teachers.slice(0, 12),
        rooms: bottlenecks.rooms.slice(0, 12),
        tightClasses: bottlenecks.tightClasses.slice(0, 30)
      }
    };
  }
  return issues;
}

// 只有明確寫入同日連續必排節次的課程，才允許形成指定長度的連堂區塊。
function getMandatoryRuleDaySlots(subjectCode, classCode, day) {
  const code = String(classCode || '').trim();
  const classInfo = typeof idx !== 'undefined' ? idx.classByCode?.[code] : null;
  const grade = String(classInfo?.['年級'] || code.charAt(0)).trim();
  const targetDay = Number(day);
  const slots = new Set();
  const rules = typeof state !== 'undefined' && Array.isArray(state.subjectRules) ? state.subjectRules : [];
  rules.forEach(rule => {
    if (String(rule?.['規則類型'] || '').trim() !== '必排') return;
    if (!ruleAppliesToSubjectAndClass(rule, subjectCode, code, grade)) return;
    getRuleDaysPeriods(rule).forEach(slot => {
      if (Number(slot.day) === targetDay) slots.add(Number(slot.period));
    });
  });
  const periods = [...slots].sort((left, right) => left - right);
  if (periods.length < 2 || periods.some((period, index) => index > 0 && period !== periods[index - 1] + 1)) return [];
  return periods.map(period => ({ day: targetDay, period }));
}

function compressSlots(slots) {
  if (!slots || slots.length === 0) return [];
  const getDayName = (d) => {
    const n = parseInt(d, 10);
    if (!isNaN(n) && n >= 1 && n <= 5) return DAY_NAMES[n] || ('週' + n);
    return '全週';
  };
  if (slots.length <= 2) {
    return slots.map(s => getDayName(s.day) + '第' + (s.period || '?') + '節');
  }
  const byDay = {};
  slots.forEach(s => {
    const dKey = s.day || 0;
    if (!byDay[dKey]) byDay[dKey] = [];
    byDay[dKey].push(s.period);
  });
  const parts = [];
  Object.keys(byDay).sort((a,b)=>a-b).forEach(d => {
    const pers = byDay[d].sort((a,b)=>a-b);
    const ranges = [];
    let start = pers[0], end = pers[0];
    for (let i = 1; i < pers.length; i++) {
      if (pers[i] === end + 1) { end = pers[i]; }
      else { ranges.push({start, end}); start = end = pers[i]; }
    }
    ranges.push({start, end});
    const dayName = getDayName(d);
    ranges.forEach(r => {
      parts.push(dayName + '第' + r.start + (r.start === r.end ? '' : '~' + r.end) + '節');
    });
  });
  return parts;
}

/* 排課系統 app.js */

// 工具
// ============================================================
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
