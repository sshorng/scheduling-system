/* 寒暑輔日期型排課：與學期星期課表分開保存及運算。 */
const SEASONAL_PERIOD_TIMES = [
  { start: '07:40', end: '08:25' },
  { start: '08:30', end: '09:15' },
  { start: '09:25', end: '10:10' },
  { start: '10:20', end: '11:05' },
  { start: '11:15', end: '12:00' }
];

let seasonalActiveSessionId = '';
let seasonalInitialized = false;
let seasonalSaveTail = Promise.resolve();
let seasonalDraggingScheduleId = '';
let seasonalSelectedSlots = new Map();
let seasonalMultiSelectMode = false;

function seasonalText(value) {
  return String(value == null ? '' : value).trim();
}

function seasonalIso(value) {
  const text = seasonalText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const date = new Date(text + 'T00:00:00Z');
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? '' : text;
}

function seasonalDateAdd(value, days) {
  const iso = seasonalIso(value);
  if (!iso) return '';
  const date = new Date(iso + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function seasonalWeekStart(value) {
  const iso = seasonalIso(value);
  if (!iso) return '';
  const date = new Date(iso + 'T00:00:00Z');
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  return date.toISOString().slice(0, 10);
}

function seasonalWeekNo(date, activityStart) {
  const current = seasonalWeekStart(date);
  const first = seasonalWeekStart(activityStart);
  if (!current || !first || current < first) return 0;
  return Math.floor((Date.parse(current + 'T00:00:00Z') - Date.parse(first + 'T00:00:00Z')) / 604800000) + 1;
}

function seasonalGetWeekRanges(startDate, endDate, teachingDays = []) {
  const start = seasonalIso(startDate);
  const end = seasonalIso(endDate);
  if (!start || !end || start > end) return [];
  const firstMonday = seasonalWeekStart(start);
  const lastMonday = seasonalWeekStart(end);
  const active = new Set((teachingDays || []).map(row => seasonalIso(row['日期'])).filter(Boolean));
  const weeks = [];
  for (let monday = firstMonday; monday <= lastMonday; monday = seasonalDateAdd(monday, 7)) {
    const week = weeks.length + 1;
    const weekStart = monday < start ? start : monday;
    const weekEndValue = seasonalDateAdd(monday, 6);
    const weekEnd = weekEndValue > end ? end : weekEndValue;
    const dates = [];
    for (let date = weekStart; date <= weekEnd; date = seasonalDateAdd(date, 1)) {
      if (active.has(date)) dates.push(date);
    }
    weeks.push({ week, startDate: weekStart, endDate: weekEnd, teachingDates: dates });
  }
  return weeks;
}

function seasonalIsTrue(value) {
  return value === true || String(value || '').toUpperCase() === 'TRUE';
}

function seasonalSlotKey(classCode, date, period) {
  return [seasonalText(classCode), seasonalIso(date), Number(period)].join('|');
}

function seasonalTeacherSlotKey(teacherCode, date, period) {
  return [seasonalText(teacherCode), seasonalIso(date), Number(period)].join('|');
}

function seasonalTeacherBlocked(teacherCode, date, blocks) {
  const teacher = seasonalText(teacherCode);
  const target = seasonalIso(date);
  if (!teacher || !target) return false;
  return (blocks || []).some(block => seasonalText(block['教師姓名']) === teacher &&
    seasonalIso(block['開始日期']) <= target && seasonalIso(block['結束日期']) >= target);
}

function seasonalCountNeedLessons(need, rows) {
  const id = seasonalText(need['需求ID']);
  const classCode = seasonalText(need['班級代碼']);
  const subject = seasonalText(need['科目代碼']);
  const teacher = seasonalText(need['教師姓名']);
  const startWeek = Number(need['起始週']) || 1;
  const endWeek = Number(need['結束週']) || startWeek;
  return (rows || []).filter(row => {
    if (Number(row['節次']) === 1) return false;
    if (id && seasonalText(row['需求ID']) === id) return true;
    if (seasonalText(row['班級代碼']) !== classCode || seasonalText(row['科目代碼']) !== subject || seasonalText(row['教師姓名']) !== teacher) return false;
    const week = Number(row['_週別']);
    return week >= startWeek && week <= endWeek;
  }).length;
}

function seasonalCheckManualPlacement(options) {
  const date = seasonalIso(options.date);
  const period = Number(options.period);
  const classCode = seasonalText(options.classCode);
  const subject = seasonalText(options.subject);
  const teacher = seasonalText(options.teacherCode);
  const excludeId = seasonalText(options.excludeId);
  if (!date || !classCode || !subject || !Number.isInteger(period) || period < 1 || period > 5) {
    return { ok: false, error: '請確認日期、班級、科目與節次資料。' };
  }
  const rows = (options.schedule || []).filter(row => seasonalText(row['課表ID']) !== excludeId);
  const classConflict = rows.find(row => seasonalSlotKey(row['班級代碼'], row['日期'], row['節次']) === seasonalSlotKey(classCode, date, period));
  if (classConflict) return { ok: false, error: '該班此日期、節次已有課程。' };
  if (teacher && seasonalTeacherBlocked(teacher, date, options.teacherBlocks)) {
    return { ok: false, error: '此教師在設定的停排期間，不能安排於 ' + date + '。' };
  }
  if (teacher && rows.some(row => seasonalTeacherSlotKey(row['教師姓名'], row['日期'], row['節次']) === seasonalTeacherSlotKey(teacher, date, period))) {
    return { ok: false, error: '此教師同一時段已有其他班級課程。' };
  }
  return { ok: true };
}

function seasonalCandidateReason(need, slots, busyClass, busyTeacher, teachingDays, blocks, activityStart) {
  const startWeek = Number(need['起始週']) || 1;
  const endWeek = Number(need['結束週']) || startWeek;
  const validDates = (teachingDays || []).filter(date => {
    const week = seasonalWeekNo(date, activityStart);
    return week >= startWeek && week <= endWeek;
  });
  const teacher = seasonalText(need['教師姓名']);
  const available = validDates.filter(date => !seasonalTeacherBlocked(teacher, date, blocks));
  if (!validDates.length) return '指定週別沒有實際上課日';
  if (!available.length) return '教師在指定週別全程停排';
  const freeSlots = available.reduce((sum, date) => sum + [2, 3, 4, 5].filter(period =>
    !busyClass.has(seasonalSlotKey(need['班級代碼'], date, period)) &&
    (!teacher || !busyTeacher.has(seasonalTeacherSlotKey(teacher, date, period)))
  ).length, 0);
  return freeSlots ? '指定期間還有可用格位' : '指定期間的班級或教師時段已滿';
}

function seasonalBuildPlan(options) {
  const session = options.session || {};
  const sessionId = seasonalText(session['場次ID']);
  const startDate = seasonalIso(session['開始日期']);
  const activeDays = (options.days || [])
    .filter(row => seasonalIsTrue(row['是否上課']))
    .map(row => seasonalIso(row['日期']))
    .filter(date => date && date >= startDate && date <= seasonalIso(session['結束日期']))
    .sort();
  const blocks = options.teacherBlocks || [];
  const sourceRows = (options.schedule || []).filter(row => seasonalText(row['場次ID']) === sessionId);
  const preserved = sourceRows.filter(row => seasonalIsTrue(row['手動安排']) || seasonalIsTrue(row['是否鎖定']));
  const schedule = preserved.map(row => ({ ...row }));
  const busyClass = new Set();
  const busyTeacher = new Set();
  for (const row of schedule) {
    const classKey = seasonalSlotKey(row['班級代碼'], row['日期'], row['節次']);
    if (busyClass.has(classKey)) return { schedule: sourceRows, added: 0, deficits: [], error: '既有手動／鎖定課表有班級衝堂。' };
    busyClass.add(classKey);
    const teacher = seasonalText(row['教師姓名']);
    if (teacher) {
      const teacherKey = seasonalTeacherSlotKey(teacher, row['日期'], row['節次']);
      if (busyTeacher.has(teacherKey)) return { schedule: sourceRows, added: 0, deficits: [], error: '既有手動／鎖定課表有教師衝堂。' };
      busyTeacher.add(teacherKey);
    }
  }

  const weeks = seasonalGetWeekRanges(session['開始日期'], session['結束日期'], options.days || []);
  const weekByDate = new Map();
  weeks.forEach(item => item.teachingDates.forEach(date => weekByDate.set(date, item.week)));
  const needs = (options.needs || []).map(need => ({ ...need }));
  const lessonNeeds = [];
  needs.forEach(need => {
    const required = Math.max(0, parseInt(need['本期節數'], 10) || 0);
    const countedRows = preserved.filter(row => {
      if (Number(row['節次']) === 1) return false;
      const rowNeedId = seasonalText(row['需求ID']);
      if (rowNeedId && rowNeedId === seasonalText(need['需求ID'])) return true;
      if (rowNeedId && seasonalText(need['需求ID'])) return false;
      if (seasonalText(row['班級代碼']) !== seasonalText(need['班級代碼']) ||
          seasonalText(row['科目代碼']) !== seasonalText(need['科目代碼']) ||
          seasonalText(row['教師姓名']) !== seasonalText(need['教師姓名'])) return false;
      const week = weekByDate.get(seasonalIso(row['日期'])) || 0;
      return week >= (Number(need['起始週']) || 1) && week <= (Number(need['結束週']) || Number(need['起始週']) || 1);
    });
    const assigned = countedRows.length;
    if (assigned < required) lessonNeeds.push({ need, remaining: required - assigned });
  });

  const sameSubjectDayLoad = new Map();
  const teacherDayLoad = new Map();
  const teacherPeriodLoad = new Map();
  const addLoad = (map, key) => map.set(key, (map.get(key) || 0) + 1);
  schedule.forEach(row => {
    const date = seasonalIso(row['日期']);
    const classCode = seasonalText(row['班級代碼']);
    const teacher = seasonalText(row['教師姓名']);
    addLoad(sameSubjectDayLoad, classCode + '|' + seasonalText(row['科目代碼']) + '|' + date);
    if (teacher) {
      addLoad(teacherDayLoad, teacher + '|' + date);
      addLoad(teacherPeriodLoad, teacher + '|' + Number(row['節次']));
    }
  });

  let seed = Number(options.seed) || 20260927;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  let added = 0;
  const unassigned = [];
  while (lessonNeeds.length) {
    let bestIndex = -1;
    let bestCandidates = null;
    for (let index = 0; index < lessonNeeds.length; index++) {
      const need = lessonNeeds[index].need;
      const teacher = seasonalText(need['教師姓名']);
      const startWeek = Number(need['起始週']) || 1;
      const endWeek = Number(need['結束週']) || startWeek;
      const candidates = [];
      activeDays.forEach(date => {
        const week = weekByDate.get(date) || 0;
        if (week < startWeek || week > endWeek || seasonalTeacherBlocked(teacher, date, blocks)) return;
        [2, 3, 4, 5].forEach(period => {
          const classKey = seasonalSlotKey(need['班級代碼'], date, period);
          const teacherKey = seasonalTeacherSlotKey(teacher, date, period);
          if (busyClass.has(classKey) || (teacher && busyTeacher.has(teacherKey))) return;
          const sameSubjectCount = sameSubjectDayLoad.get(seasonalText(need['班級代碼']) + '|' + seasonalText(need['科目代碼']) + '|' + date) || 0;
          const dailyTeacherCount = teacherDayLoad.get(teacher + '|' + date) || 0;
          const periodTeacherCount = teacherPeriodLoad.get(teacher + '|' + period) || 0;
          candidates.push({ date, period, score: sameSubjectCount * 8 + dailyTeacherCount * 3 + periodTeacherCount + random() });
        });
      });
      if (!bestCandidates || candidates.length < bestCandidates.length) {
        bestIndex = index;
        bestCandidates = candidates;
      }
      if (candidates.length === 0) break;
    }
    if (bestIndex < 0) break;
    const selected = lessonNeeds[bestIndex];
    const need = selected.need;
    if (!bestCandidates || !bestCandidates.length) {
      unassigned.push({ need, remaining: selected.remaining, reason: seasonalCandidateReason(need, null, busyClass, busyTeacher, activeDays, blocks, startDate) });
      lessonNeeds.splice(bestIndex, 1);
      continue;
    }
    bestCandidates.sort((left, right) => left.score - right.score || left.date.localeCompare(right.date) || left.period - right.period);
    const chosen = bestCandidates[0];
    const teacher = seasonalText(need['教師姓名']);
    const row = {
      '課表ID': 'SEA_S_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      '場次ID': sessionId,
      '班級代碼': seasonalText(need['班級代碼']),
      '日期': chosen.date,
      '節次': String(chosen.period),
      '科目代碼': seasonalText(need['科目代碼']),
      '教師姓名': teacher,
      '是否鎖定': 'FALSE',
      '手動安排': 'FALSE',
      '需求ID': seasonalText(need['需求ID'])
    };
    row['_週別'] = weekByDate.get(chosen.date) || 0;
    schedule.push(row);
    busyClass.add(seasonalSlotKey(row['班級代碼'], row['日期'], row['節次']));
    if (teacher) busyTeacher.add(seasonalTeacherSlotKey(teacher, row['日期'], row['節次']));
    addLoad(sameSubjectDayLoad, seasonalText(row['班級代碼']) + '|' + seasonalText(row['科目代碼']) + '|' + row['日期']);
    if (teacher) {
      addLoad(teacherDayLoad, teacher + '|' + row['日期']);
      addLoad(teacherPeriodLoad, teacher + '|' + Number(row['節次']));
    }
    added++;
    selected.remaining--;
    if (selected.remaining <= 0) lessonNeeds.splice(bestIndex, 1);
  }

  const deficits = unassigned.map(item => ({
    needId: seasonalText(item.need['需求ID']),
    classCode: seasonalText(item.need['班級代碼']),
    subjectCode: seasonalText(item.need['科目代碼']),
    teacherCode: seasonalText(item.need['教師姓名']),
    remaining: item.remaining,
    reason: item.reason
  }));
  return { schedule, added, deficits, error: '' };
}

function seasonalActiveRows(key) {
  const list = state[key] || [];
  return list.filter(row => seasonalText(row['場次ID']) === seasonalActiveSessionId);
}

function seasonalActiveSession() {
  return (state.seasonalSessions || []).find(row => seasonalText(row['場次ID']) === seasonalActiveSessionId) || null;
}

function seasonalNewId(prefix) {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

function seasonalSetStatus(message, error = false) {
  const el = document.getElementById('seasonal-session-status');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('is-error', error);
}

function seasonalDisplayDate(value) {
  const date = seasonalIso(value);
  if (!date) return '';
  const parsed = new Date(date + 'T00:00:00Z');
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][parsed.getUTCDay()];
  return date.slice(5).replace('-', '/') + '(週' + weekday + ')';
}

function seasonalGetCurrentWeeks() {
  const session = seasonalActiveSession();
  if (!session) return [];
  return seasonalGetWeekRanges(session['開始日期'], session['結束日期'], seasonalActiveRows('seasonalDays'));
}

function seasonalWeekLabel(week) {
  const item = seasonalGetCurrentWeeks().find(row => row.week === Number(week));
  if (!item) return '第' + week + '週';
  return '第' + week + '週（' + item.startDate.slice(5).replace('-', '/') + '～' + item.endDate.slice(5).replace('-', '/') + '）';
}

function seasonalFillWeekSelect(id, selectedValue) {
  const select = document.getElementById(id);
  if (!select) return;
  const weeks = seasonalGetCurrentWeeks();
  const wanted = String(selectedValue || select.value || '1');
  select.innerHTML = weeks.map(item => '<option value="' + item.week + '">' + esc(seasonalWeekLabel(item.week)) + '</option>').join('');
  if (!weeks.length) select.innerHTML = '<option value="1">請先設定活動日期</option>';
  if (weeks.some(item => String(item.week) === wanted)) select.value = wanted;
}

function seasonalUpdateWeekSelects() {
  ['seasonal-need-week-start', 'seasonal-need-week-end', 'seasonal-block-week-start', 'seasonal-block-week-end'].forEach(id => seasonalFillWeekSelect(id));
}

function seasonalFillTeacherOptions() {
  const codes = new Set([
    ...(state.teachers || []).map(teacher => seasonalText(teacher['教師姓名'] || teacher['姓名'])),
    ...seasonalActiveRows('seasonalNeeds').map(row => seasonalText(row['教師姓名'])),
    ...seasonalActiveRows('seasonalTeacherBlocks').map(row => seasonalText(row['教師姓名']))
  ].filter(Boolean));
  const options = [...codes].sort((a, b) => a.localeCompare(b, 'zh-Hant')).map(code => '<option value="' + esc(code) + '"></option>').join('');
  const teacherList = document.getElementById('seasonal-teacher-options');
  if (teacherList) teacherList.innerHTML = options;
}

function seasonalFillSubjectOptions() {
  const values = new Set((state.subjects || []).map(subject => seasonalText(subject['科目代碼'] || subject['科目名稱'])).filter(Boolean));
  seasonalActiveRows('seasonalNeeds').forEach(need => values.add(seasonalText(need['科目代碼'])));
  const list = document.getElementById('seasonal-subject-options');
  if (list) list.innerHTML = [...values].sort((a, b) => a.localeCompare(b, 'zh-Hant')).map(value => '<option value="' + esc(value) + '"></option>').join('');
}


function seasonalIsGrade9Class(row) {
  if (!row) return false;
  const grade = seasonalText(row['年級']);
  const code = seasonalText(row['班級代碼']);
  if (['9', '九', '9年級', '九年級'].includes(grade)) return true;
  if (/^9\d+/.test(code) || code.startsWith('9')) return true;
  return false;
}

function seasonalGetGrade9Classes() {
  return (state.classes || []).filter(row =>
    String(row['是否虛擬班'] || '').toUpperCase() !== 'TRUE' &&
    seasonalIsGrade9Class(row)
  );
}

function seasonalPopulateClassSelects() {
  const classes = seasonalGetGrade9Classes();
  const container = document.getElementById('seasonal-need-classes-container');
  if (container) {
    if (!classes.length) {
      container.innerHTML = '<span class="text-muted" style="font-size:12px;">查無九年級班級資料</span>';
    } else {
      container.innerHTML = classes.map(row => {
        const code = seasonalText(row['班級代碼']);
        const name = row['班級名稱'] ? ' ' + row['班級名稱'] : '';
        return '<label class="seasonal-class-chip"><input type="checkbox" name="seasonal-need-class-check" value="' + esc(code) + '"><span>' + esc(code + name) + '</span></label>';
      }).join('');
      container.querySelectorAll('input[name="seasonal-need-class-check"]').forEach(input => {
        input.addEventListener('change', () => {
          input.closest('.seasonal-class-chip')?.classList.toggle('is-selected', input.checked);
        });
      });
    }
  }
  const needSelect = document.getElementById('seasonal-need-class');
  if (needSelect) {
    needSelect.innerHTML = classes.map(row => {
      const code = seasonalText(row['班級代碼']);
      return '<option value="' + esc(code) + '">' + esc(code + (row['班級名稱'] ? ' ' + row['班級名稱'] : '')) + '</option>';
    }).join('');
  }
}

function seasonalToggleAllNeedClasses(checkAll) {
  document.querySelectorAll('#seasonal-need-classes-container input[name="seasonal-need-class-check"]').forEach(cb => {
    cb.checked = !!checkAll;
    cb.closest('.seasonal-class-chip')?.classList.toggle('is-selected', !!checkAll);
  });
}

function seasonalPopulateViewSelect() {
  const mode = document.getElementById('seasonal-view-mode')?.value || 'class';
  const select = document.getElementById('seasonal-view-person');
  if (!select) return;
  const previous = select.value;
  if (mode === 'class') {
    select.innerHTML = seasonalGetGrade9Classes()
      .map(row => {
        const code = seasonalText(row['班級代碼']);
        const name = row['班級名稱'] ? ' ' + row['班級名稱'] : '';
        return '<option value="' + esc(code) + '">' + esc(code + name) + '</option>';
      }).join('');
  } else {
    const teacherCodes = new Set([
      ...(state.teachers || []).map(row => seasonalText(row['教師姓名'] || row['姓名'])),
      ...seasonalActiveRows('seasonalNeeds').map(row => seasonalText(row['教師姓名'])),
      ...seasonalActiveRows('seasonalSchedule').map(row => seasonalText(row['教師姓名']))
    ].filter(Boolean));
    select.innerHTML = [...teacherCodes].sort((a, b) => a.localeCompare(b, 'zh-Hant'))
      .map(code => '<option value="' + esc(code) + '">' + esc(code) + '</option>').join('');
  }
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
}

function renderSeasonalWorkspace() {
  const select = document.getElementById('seasonal-session-select');
  const empty = document.getElementById('seasonal-empty');
  const workspace = document.getElementById('seasonal-workspace');
  if (!select || !empty || !workspace) return;
  const sessions = state.seasonalSessions || [];
  select.innerHTML = sessions.map(session => '<option value="' + esc(seasonalText(session['場次ID'])) + '">' +
    esc((session['學年度'] ? session['學年度'] + '學年度 ' : '') + (session['活動名稱'] || session['活動類型'] || '寒暑輔場次')) + '</option>').join('');
  if (!sessions.length) {
    seasonalActiveSessionId = '';
    empty.hidden = false;
    workspace.hidden = true;
    return;
  }
  if (!sessions.some(session => seasonalText(session['場次ID']) === seasonalActiveSessionId)) seasonalActiveSessionId = seasonalText(sessions[0]['場次ID']);
  select.value = seasonalActiveSessionId;
  empty.hidden = true;
  workspace.hidden = false;
  const session = seasonalActiveSession();
  document.getElementById('seasonal-name').value = session['活動名稱'] || '';
  document.getElementById('seasonal-type').value = session['活動類型'] || '暑輔';
  document.getElementById('seasonal-year').value = session['學年度'] || '115';
  document.getElementById('seasonal-start').value = session['開始日期'] || '';
  document.getElementById('seasonal-end').value = session['結束日期'] || '';
  const times = (() => { try { return JSON.parse(session['節次時間'] || '[]'); } catch (error) { return []; } })();
  const timeList = times.length === 5 ? times : SEASONAL_PERIOD_TIMES;
  const timeWrap = document.getElementById('seasonal-period-times');
  timeWrap.innerHTML = timeList.map((item, index) => '<span><b>第' + (index + 1) + '節</b> ' + esc(item.start || '') + '－' + esc(item.end || '') + '</span>').join('');
  seasonalPopulateClassSelects();
  seasonalFillTeacherOptions();
  seasonalFillSubjectOptions();
  seasonalRenderDays();
  seasonalUpdateWeekSelects();
  seasonalRenderNeeds();
  seasonalRenderTeacherBlocks();
  seasonalPopulateViewSelect();
  renderSeasonalTimetable();
  seasonalSetStatus('版本 ' + (session['版本號'] || '0'));
}

function initSeasonalModule() {
  if (seasonalInitialized) return;
  seasonalInitialized = true;
  document.getElementById('seasonal-session-select')?.addEventListener('change', event => {
    seasonalActiveSessionId = event.target.value;
    renderSeasonalWorkspace();
  });
  document.getElementById('seasonal-view-mode')?.addEventListener('change', () => {
    seasonalPopulateViewSelect();
    renderSeasonalTimetable();
  });
}

function createSeasonalSession() {
  const schoolYear = Number.parseInt(state.settings?.['學年'] || '', 10) || (new Date().getFullYear() - 1911);
  const id = seasonalNewId('SEASON');
  const session = {
    '場次ID': id,
    '活動名稱': schoolYear + '學年度暑假學藝活動',
    '活動類型': '暑輔',
    '學年度': String(schoolYear),
    '開始日期': '',
    '結束日期': '',
    '節次時間': JSON.stringify(SEASONAL_PERIOD_TIMES),
    '版本號': '0'
  };
  state.seasonalSessions = [...(state.seasonalSessions || []), session];
  seasonalActiveSessionId = id;
  renderSeasonalWorkspace();
  seasonalSetStatus('尚未儲存');
}

function seasonalGetAllWeekdayDates(startDate, endDate) {
  const start = seasonalIso(startDate);
  const end = seasonalIso(endDate);
  if (!start || !end || start > end) return [];
  const output = [];
  for (let date = start; date <= end; date = seasonalDateAdd(date, 1)) {
    const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
    if (weekday >= 1 && weekday <= 5) output.push(date);
  }
  return output;
}

function generateSeasonalTeachingDays() {
  const session = seasonalReadSessionForm();
  const start = seasonalIso(session && session['開始日期']);
  const end = seasonalIso(session && session['結束日期']);
  if (!start || !end || start > end) {
    toast('請先填寫正確的活動起訖日期。', 'warning');
    return;
  }
  const existing = new Map(seasonalActiveRows('seasonalDays').map(row => [seasonalIso(row['日期']), row]));
  const sessionId = seasonalActiveSessionId;
  const generated = seasonalGetAllWeekdayDates(start, end).map(date => existing.get(date) || {
    '記錄ID': seasonalNewId('DAY'), '場次ID': sessionId, '日期': date, '是否上課': 'TRUE', '備註': ''
  });
  state.seasonalDays = (state.seasonalDays || []).filter(row => seasonalText(row['場次ID']) !== sessionId).concat(generated);
  seasonalRenderDays();
  seasonalUpdateWeekSelects();
  seasonalRenderNeeds();
  seasonalRenderTeacherBlocks();
  seasonalSetStatus('日期已更新，尚未儲存');
}

function seasonalRenderDays() {
  const wrap = document.getElementById('seasonal-days-list');
  if (!wrap) return;
  const rows = seasonalActiveRows('seasonalDays').slice().sort((a, b) => seasonalIso(a['日期']).localeCompare(seasonalIso(b['日期'])));
  if (!rows.length) {
    wrap.innerHTML = '<span class="text-muted">設定起訖日期後，按「依日期產生平日」。</span>';
    return;
  }
  const session = seasonalActiveSession();
  wrap.innerHTML = rows.map(row => {
    const date = seasonalIso(row['日期']);
    const checked = seasonalIsTrue(row['是否上課']);
    const week = seasonalWeekNo(date, session['開始日期']);
    return '<label class="seasonal-day-chip ' + (checked ? 'is-active' : '') + '"><input type="checkbox" data-date="' + esc(date) + '" ' + (checked ? 'checked' : '') + '><span>' + esc(seasonalDisplayDate(date)) + '</span><small>第' + week + '週</small></label>';
  }).join('');
  wrap.querySelectorAll('input[data-date]').forEach(input => input.addEventListener('change', async () => {
    const date = input.dataset.date;
    const row = seasonalActiveRows('seasonalDays').find(item => seasonalIso(item['日期']) === date);
    if (!input.checked) {
      const affected = seasonalActiveRows('seasonalSchedule').filter(item => seasonalIso(item['日期']) === date);
      if (affected.length) {
        const confirmed = await showModal('此日已有排課', '取消 ' + esc(seasonalDisplayDate(date)) + ' 的上課日，會同時清除 ' + affected.length + ' 筆課表安排。要繼續嗎？', 'confirm', '清除並停課', '保留上課日');
        if (!confirmed) {
          input.checked = true;
          return;
        }
        state.seasonalSchedule = (state.seasonalSchedule || []).filter(item =>
          seasonalText(item['場次ID']) !== seasonalActiveSessionId || seasonalIso(item['日期']) !== date
        );
        renderSeasonalTimetable();
      }
    }
    if (row) row['是否上課'] = input.checked ? 'TRUE' : 'FALSE';
    input.closest('.seasonal-day-chip')?.classList.toggle('is-active', input.checked);
    seasonalUpdateWeekSelects();
    seasonalSetStatus('上課日已更新，尚未儲存');
  }));
}

function seasonalReadSessionForm() {
  const session = seasonalActiveSession();
  if (!session) return null;
  session['活動名稱'] = seasonalText(document.getElementById('seasonal-name').value);
  session['活動類型'] = document.getElementById('seasonal-type').value || '暑輔';
  session['學年度'] = seasonalText(document.getElementById('seasonal-year').value);
  session['開始日期'] = seasonalIso(document.getElementById('seasonal-start').value);
  session['結束日期'] = seasonalIso(document.getElementById('seasonal-end').value);
  session['節次時間'] = JSON.stringify(SEASONAL_PERIOD_TIMES);
  return session;
}

async function seasonalPersistActive() {
  const session = seasonalActiveSession();
  if (!session) return false;
  const sessionId = seasonalActiveSessionId;
  const bundle = {
    session: { ...session },
    days: seasonalActiveRows('seasonalDays').map(row => ({ ...row })),
    needs: seasonalActiveRows('seasonalNeeds').map(row => ({ ...row })),
    teacherBlocks: seasonalActiveRows('seasonalTeacherBlocks').map(row => ({ ...row })),
    schedule: seasonalActiveRows('seasonalSchedule').map(row => {
      const clean = { ...row };
      delete clean['_週別'];
      return clean;
    })
  };
  if (!GAS_URL) {
    seasonalSetStatus('僅保留在目前瀏覽器');
    return true;
  }
  const saveTask = async () => {
    const liveSession = (state.seasonalSessions || []).find(row => seasonalText(row['場次ID']) === sessionId);
    if (!liveSession) return false;
    if (seasonalActiveSessionId === sessionId) seasonalSetStatus('同步中…');
    const baseVersion = String(liveSession['版本號'] || '0');
    const response = await gasPost('saveSeasonalBundle', { baseVersion, bundle });
    if (!response || response.ok === false) {
      if (seasonalActiveSessionId === sessionId) seasonalSetStatus('同步失敗', true);
      toast(response?.error || '寒暑輔資料同步失敗。', 'error');
      if (response?.conflict || response?.data?.conflict) loadAll({ background: true });
      return false;
    }
    liveSession['版本號'] = String(response.data?.version || Number(baseVersion) + 1);
    if (seasonalActiveSessionId === sessionId) seasonalSetStatus('已儲存・版本 ' + liveSession['版本號']);
    return true;
  };
  const request = seasonalSaveTail.then(saveTask, saveTask);
  seasonalSaveTail = request.catch(() => false);
  return request;
}

async function saveSeasonalSetup() {
  const session = seasonalReadSessionForm();
  if (!session || !session['活動名稱'] || !session['學年度'] || !session['開始日期'] || !session['結束日期'] || session['開始日期'] > session['結束日期']) {
    toast('請填寫活動名稱、學年度與正確的起訖日期。', 'warning');
    return;
  }
  const saved = await seasonalPersistActive();
  if (saved) {
    renderSeasonalWorkspace();
    toast('寒暑輔活動設定已儲存。', 'success');
  }
}

function seasonalRenderNeeds() {
  const body = document.getElementById('seasonal-needs-body');
  if (!body) return;
  const rows = seasonalActiveRows('seasonalNeeds');
  body.innerHTML = rows.length ? rows.map(row => '<tr><td>' + esc(row['班級代碼']) + '</td><td>' + esc(row['科目代碼']) + '</td><td>' + esc(row['教師姓名']) +
    '</td><td>' + esc(row['本期節數']) + '</td><td>' + esc(seasonalWeekLabel(row['起始週'])) + '～' + esc(seasonalWeekLabel(row['結束週'])) +
    '</td><td><button class="btn btn-ghost btn-xs" data-delete-need="' + esc(row['需求ID']) + '" type="button">刪除</button></td></tr>').join('') :
    '<tr><td colspan="6" class="text-center text-muted">尚未設定課程需求</td></tr>';
  body.querySelectorAll('[data-delete-need]').forEach(button => button.addEventListener('click', async () => {
    const id = button.dataset.deleteNeed;
    state.seasonalNeeds = (state.seasonalNeeds || []).filter(row => seasonalText(row['需求ID']) !== id);
    seasonalRenderNeeds();
    seasonalFillSubjectOptions();
    await seasonalPersistActive();
    renderSeasonalTimetable();
  }));
}

async function addSeasonalNeed() {
  const session = seasonalActiveSession();
  if (!session || !seasonalIso(session['開始日期']) || !seasonalIso(session['結束日期'])) {
    toast('請先儲存活動名稱與日期。', 'warning');
    return;
  }
  const checkedBoxes = Array.from(document.querySelectorAll('#seasonal-need-classes-container input[name="seasonal-need-class-check"]:checked'));
  let selectedClasses = checkedBoxes.map(cb => seasonalText(cb.value)).filter(Boolean);
  if (!selectedClasses.length) {
    const fallback = seasonalText(document.getElementById('seasonal-need-class')?.value);
    if (fallback) selectedClasses = [fallback];
  }
  if (!selectedClasses.length) {
    toast('請先勾選至少一個班級。', 'warning');
    return;
  }
  const subject = seasonalText(document.getElementById('seasonal-need-subject').value);
  const teacher = seasonalText(document.getElementById('seasonal-need-teacher').value);
  const count = parseInt(document.getElementById('seasonal-need-count').value, 10);
  const startWeek = Number(document.getElementById('seasonal-need-week-start').value) || 1;
  const endWeek = Number(document.getElementById('seasonal-need-week-end').value) || startWeek;
  if (!subject || !teacher || !Number.isInteger(count) || count < 1 || endWeek < startWeek) {
    toast('請填妥科目、教師、正整數節數及有效週別。', 'warning');
    return;
  }
  const newNeeds = selectedClasses.map(classCode => ({
    '需求ID': seasonalNewId('NEED'), '場次ID': seasonalActiveSessionId, '班級代碼': classCode,
    '科目代碼': subject, '教師姓名': teacher, '本期節數': String(count), '起始週': String(startWeek), '結束週': String(endWeek)
  }));
  state.seasonalNeeds = [...(state.seasonalNeeds || []), ...newNeeds];
  document.getElementById('seasonal-need-subject').value = '';
  document.getElementById('seasonal-need-count').value = '1';
  seasonalRenderNeeds();
  seasonalFillTeacherOptions();
  seasonalFillSubjectOptions();
  seasonalPopulateViewSelect();
  await seasonalPersistActive();
  renderSeasonalTimetable();
  toast('已成功為 ' + selectedClasses.length + ' 個班級新增課程需求。', 'success');
}

function seasonalRenderTeacherBlocks() {
  const body = document.getElementById('seasonal-blocks-body');
  if (!body) return;
  const rows = seasonalActiveRows('seasonalTeacherBlocks');
  body.innerHTML = rows.length ? rows.map(row => '<tr><td>' + esc(row['教師姓名']) + '</td><td>' + esc(seasonalDisplayDate(row['開始日期'])) + '～' + esc(seasonalDisplayDate(row['結束日期'])) +
    '</td><td>' + esc(row['原因'] || '') + '</td><td><button class="btn btn-ghost btn-xs" data-delete-block="' + esc(row['記錄ID']) + '" type="button">刪除</button></td></tr>').join('') :
    '<tr><td colspan="4" class="text-center text-muted">尚未設定教師停排期間</td></tr>';
  body.querySelectorAll('[data-delete-block]').forEach(button => button.addEventListener('click', async () => {
    state.seasonalTeacherBlocks = (state.seasonalTeacherBlocks || []).filter(row => seasonalText(row['記錄ID']) !== button.dataset.deleteBlock);
    seasonalRenderTeacherBlocks();
    await seasonalPersistActive();
    renderSeasonalTimetable();
  }));
}

async function addSeasonalTeacherBlock() {
  const session = seasonalActiveSession();
  const teacher = seasonalText(document.getElementById('seasonal-block-teacher').value);
  const startWeek = Number(document.getElementById('seasonal-block-week-start').value) || 0;
  const endWeek = Number(document.getElementById('seasonal-block-week-end').value) || startWeek;
  const weeks = seasonalGetCurrentWeeks();
  const first = weeks.find(row => row.week === startWeek);
  const last = weeks.find(row => row.week === endWeek);
  if (!session || !teacher || !first || !last || endWeek < startWeek) {
    toast('請先設定活動日期，並選擇教師與有效停排週別。', 'warning');
    return;
  }
  state.seasonalTeacherBlocks = [...(state.seasonalTeacherBlocks || []), {
    '記錄ID': seasonalNewId('BLOCK'), '場次ID': seasonalActiveSessionId, '教師姓名': teacher,
    '開始日期': first.startDate, '結束日期': last.endDate, '原因': seasonalText(document.getElementById('seasonal-block-reason').value)
  }];
  document.getElementById('seasonal-block-reason').value = '';
  seasonalRenderTeacherBlocks();
  seasonalFillTeacherOptions();
  seasonalPopulateViewSelect();
  await seasonalPersistActive();
  renderSeasonalTimetable();
}

function seasonalGetScheduleCell(classCode, date, period) {
  return seasonalActiveRows('seasonalSchedule').find(row => seasonalSlotKey(row['班級代碼'], row['日期'], row['節次']) === seasonalSlotKey(classCode, date, period)) || null;
}

function seasonalFindNeedForManual(classCode, date, period, subject, teacherCode, excludeId) {
  if (Number(period) === 1) return '';
  const session = seasonalActiveSession();
  const week = seasonalWeekNo(date, session && session['開始日期']);
  const rows = seasonalActiveRows('seasonalSchedule').filter(row =>
    seasonalText(row['課表ID']) !== seasonalText(excludeId) && Number(row['節次']) !== 1
  );
  const match = seasonalActiveRows('seasonalNeeds').find(need => {
    if (seasonalText(need['班級代碼']) !== seasonalText(classCode) ||
        seasonalText(need['科目代碼']) !== seasonalText(subject) ||
        seasonalText(need['教師姓名']) !== seasonalText(teacherCode)) return false;
    const firstWeek = Number(need['起始週']) || 1;
    const lastWeek = Number(need['結束週']) || firstWeek;
    if (week < firstWeek || week > lastWeek) return false;
    const count = rows.filter(row => {
      if (seasonalText(row['需求ID'])) return seasonalText(row['需求ID']) === seasonalText(need['需求ID']);
      return seasonalText(row['班級代碼']) === seasonalText(need['班級代碼']) &&
        seasonalText(row['科目代碼']) === seasonalText(need['科目代碼']) &&
        seasonalText(row['教師姓名']) === seasonalText(need['教師姓名']) &&
        (() => { const rowWeek = seasonalWeekNo(row['日期'], session['開始日期']); return rowWeek >= firstWeek && rowWeek <= lastWeek; })();
    }).length;
    return count < (parseInt(need['本期節數'], 10) || 0);
  });
  return match ? seasonalText(match['需求ID']) : '';
}


function toggleSeasonalMultiSelectMode(enabled) {
  seasonalMultiSelectMode = !!enabled;
  const chk = document.getElementById('seasonal-multi-select-mode');
  if (chk) chk.checked = seasonalMultiSelectMode;
  const label = document.getElementById('seasonal-multi-select-label');
  if (label) {
    label.style.borderColor = seasonalMultiSelectMode ? 'var(--accent, #2563eb)' : 'var(--border)';
    label.style.background = seasonalMultiSelectMode ? 'var(--accent-light, #dbeafe)' : 'var(--surface)';
    label.style.color = seasonalMultiSelectMode ? 'var(--accent-dark, #1d4ed8)' : 'inherit';
    label.style.fontWeight = seasonalMultiSelectMode ? '700' : 'normal';
  }
  if (!seasonalMultiSelectMode) {
    clearSeasonalSelectedSlots();
  }
}

function clearSeasonalSelectedSlots() {
  seasonalSelectedSlots.clear();
  updateSeasonalSelectionUI();
}

function updateSeasonalSelectionUI() {
  const count = seasonalSelectedSlots.size;
  const bar = document.getElementById('seasonal-batch-bar');
  const countEl = document.getElementById('seasonal-batch-count');
  if (bar && countEl) {
    countEl.textContent = String(count);
    bar.style.display = count > 0 ? 'flex' : 'none';
  }
  document.querySelectorAll('.seasonal-slot-button').forEach(btn => {
    const key = seasonalSlotKey(btn.dataset.class, btn.dataset.date, btn.dataset.period);
    btn.classList.toggle('is-selected-slot', seasonalSelectedSlots.has(key));
  });
}

function openSeasonalBatchAssignModal() {
  if (!seasonalSelectedSlots.size) {
    toast('請先在課表中選取至少一個格位。', 'warning');
    return;
  }
  const count = seasonalSelectedSlots.size;
  const slots = Array.from(seasonalSelectedSlots.values());
  const allPeriod1 = slots.every(s => s.period === 1);
  
  document.getElementById('seasonal-batch-assign-title').textContent = '批次安排課程與教師（已選 ' + count + ' 格）';
  
  const subjectInput = document.getElementById('seasonal-batch-subject');
  if (subjectInput && !subjectInput.value) {
    subjectInput.value = allPeriod1 ? '學習輔導' : '';
  }
  
  const datesSummary = [...new Set(slots.map(s => seasonalDisplayDate(s.date)))].slice(0, 5).join('、');
  const extraDates = new Set(slots.map(s => s.date)).size > 5 ? '…等' : '';
  document.getElementById('seasonal-batch-assign-hint').textContent = '即將為 ' + datesSummary + extraDates + ' 共 ' + count + ' 個時段排入課程。';
  document.getElementById('seasonal-batch-assign-modal').classList.add('show');
}

function closeSeasonalBatchAssignModal() {
  document.getElementById('seasonal-batch-assign-modal')?.classList.remove('show');
}

async function saveSeasonalBatchAssign() {
  const subject = seasonalText(document.getElementById('seasonal-batch-subject').value);
  const teacher = seasonalText(document.getElementById('seasonal-batch-teacher').value);
  const lock = document.getElementById('seasonal-batch-lock').checked;
  const overwrite = document.getElementById('seasonal-batch-overwrite').checked;
  
  if (!subject && !teacher) {
    toast('請至少輸入科目／活動名稱或教師姓名。', 'warning');
    return;
  }
  
  const slots = Array.from(seasonalSelectedSlots.values());
  let currentSchedule = [...(state.seasonalSchedule || [])];
  const teacherBlocks = seasonalActiveRows('seasonalTeacherBlocks');
  
  // 檢查教師停排
  if (teacher) {
    for (const slot of slots) {
      if (seasonalTeacherBlocked(teacher, slot.date, teacherBlocks)) {
        toast(teacher + ' 老師在 ' + seasonalDisplayDate(slot.date) + ' 為停排期間！', 'warning');
        return;
      }
    }
    
    // 檢查同一教師在同一 (date, period) 是否重複指派（不同班級）
    const teacherSlots = new Set();
    for (const slot of slots) {
      const slotTeacherKey = seasonalTeacherSlotKey(teacher, slot.date, slot.period);
      if (teacherSlots.has(slotTeacherKey)) {
        toast('選取的格位中包含相同日期與節次，' + teacher + ' 老師無法同時出現在多個班級！', 'error');
        return;
      }
      teacherSlots.add(slotTeacherKey);
      
      // 也檢查已有課表（非此班級）是否已衝堂
      const existingOtherClass = currentSchedule.find(row =>
        seasonalText(row['場次ID']) === seasonalActiveSessionId &&
        seasonalText(row['班級代碼']) !== slot.classCode &&
        seasonalIso(row['日期']) === slot.date &&
        Number(row['節次']) === slot.period &&
        seasonalText(row['教師姓名']) === teacher
      );
      if (existingOtherClass) {
        toast(teacher + ' 老師在 ' + seasonalDisplayDate(slot.date) + ' 第' + slot.period + '節已有 ' + existingOtherClass['班級代碼'] + ' 的課程！', 'error');
        return;
      }
    }
  }
  
  let appliedCount = 0;
  for (const slot of slots) {
    const existingIdx = currentSchedule.findIndex(row =>
      seasonalText(row['場次ID']) === seasonalActiveSessionId &&
      seasonalText(row['班級代碼']) === slot.classCode &&
      seasonalIso(row['日期']) === slot.date &&
      Number(row['節次']) === slot.period
    );
    
    if (existingIdx !== -1) {
      if (!overwrite) continue;
      const existing = currentSchedule[existingIdx];
      const finalSubject = subject || existing['科目代碼'];
      const finalTeacher = teacher !== '' ? teacher : existing['教師姓名'];
      const finalLock = lock ? 'TRUE' : existing['是否鎖定'];
      currentSchedule[existingIdx] = {
        ...existing,
        '科目代碼': finalSubject,
        '教師姓名': finalTeacher,
        '是否鎖定': finalLock,
        '手動安排': 'TRUE',
        '需求ID': seasonalFindNeedForManual(slot.classCode, slot.date, slot.period, finalSubject, finalTeacher, existing['課表ID'])
      };
      appliedCount++;
    } else {
      const finalSubject = subject || (slot.period === 1 ? '學習輔導' : '未定');
      const finalTeacher = teacher || '';
      const newRow = {
        '課表ID': seasonalNewId('MANUAL'),
        '場次ID': seasonalActiveSessionId,
        '班級代碼': slot.classCode,
        '日期': slot.date,
        '節次': String(slot.period),
        '科目代碼': finalSubject,
        '教師姓名': finalTeacher,
        '是否鎖定': lock ? 'TRUE' : 'FALSE',
        '手動安排': 'TRUE',
        '需求ID': seasonalFindNeedForManual(slot.classCode, slot.date, slot.period, finalSubject, finalTeacher, '')
      };
      currentSchedule.push(newRow);
      appliedCount++;
    }
  }
  
  state.seasonalSchedule = currentSchedule;
  closeSeasonalBatchAssignModal();
  clearSeasonalSelectedSlots();
  renderSeasonalTimetable();
  
  if (await seasonalPersistActive()) {
    toast('已成功批次排入 ' + appliedCount + ' 格課程。', 'success');
  }
}

async function batchClearSeasonalSelectedSlots() {
  if (!seasonalSelectedSlots.size) return;
  const count = seasonalSelectedSlots.size;
  const confirmed = await showModal('批次清除課程', '確定要清空已選取的 ' + count + ' 個格位嗎？', 'confirm', '確定清除', '取消');
  if (!confirmed) return;
  
  const slots = Array.from(seasonalSelectedSlots.values());
  const slotKeys = new Set(slots.map(s => seasonalSlotKey(s.classCode, s.date, s.period)));
  
  state.seasonalSchedule = (state.seasonalSchedule || []).filter(row => {
    if (seasonalText(row['場次ID']) !== seasonalActiveSessionId) return true;
    const key = seasonalSlotKey(row['班級代碼'], row['日期'], row['節次']);
    return !slotKeys.has(key);
  });
  
  clearSeasonalSelectedSlots();
  renderSeasonalTimetable();
  if (await seasonalPersistActive()) {
    toast('已清除 ' + count + ' 格課程。', 'success');
  }
}

function renderSeasonalTimetable() {
  const wrap = document.getElementById('seasonal-timetable');
  if (!wrap || !seasonalActiveSession()) return;
  seasonalPopulateViewSelect();
  const mode = document.getElementById('seasonal-view-mode')?.value || 'class';
  const person = document.getElementById('seasonal-view-person')?.value || '';
  const session = seasonalActiveSession();
  const days = seasonalActiveRows('seasonalDays').filter(row => seasonalIsTrue(row['是否上課']))
    .map(row => seasonalIso(row['日期'])).filter(Boolean).sort();
  const schedule = seasonalActiveRows('seasonalSchedule');
  const timeValues = (() => { try { return JSON.parse(session['節次時間'] || '[]'); } catch (error) { return []; } })();
  const times = timeValues.length === 5 ? timeValues : SEASONAL_PERIOD_TIMES;
  const headers = ['日期', ...times.map((_, index) => '第' + (index + 1) + '節')];
  const head = '<thead><tr>' + headers.map((header, index) => '<th>' + esc(header) + (index > 0 ? '<small>' + esc(times[index - 1].start + '－' + times[index - 1].end) + '</small>' : '') + '</th>').join('') + '</tr></thead>';
  if (!days.length) {
    wrap.innerHTML = '<div class="seasonal-empty-inline">請先設定起訖日期，並產生或勾選實際上課日。</div>';
  } else if (mode === 'class') {
    const rows = days.map(date => {
      const week = seasonalWeekNo(date, session['開始日期']);
      const cells = [ '<td class="seasonal-date-cell"><b>' + esc(seasonalDisplayDate(date)) + '</b><small>第' + week + '週</small></td>' ];
      for (let period = 1; period <= 5; period++) {
        const item = seasonalGetScheduleCell(person, date, period);
        const text = item ? esc(item['科目代碼']) + (item['教師姓名'] ? '<small>' + esc(item['教師姓名']) + '</small>' : '') : '<span class="seasonal-add-mark">＋</span>';
        const canDrag = item && !seasonalIsTrue(item['是否鎖定']);
        cells.push('<td><button class="seasonal-slot-button ' + (period === 1 ? 'is-manual-period ' : '') + (item ? 'has-course' : '') + '" type="button" draggable="' + (canDrag ? 'true' : 'false') + '" data-id="' + esc(item ? item['課表ID'] : '') + '" data-class="' + esc(person) + '" data-date="' + esc(date) + '" data-period="' + period + '">' + text + '</button></td>');
      }
      return '<tr>' + cells.join('') + '</tr>';
    }).join('');
    wrap.innerHTML = '<table class="seasonal-timetable-table">' + head + '<tbody>' + rows + '</tbody></table>';
    wrap.querySelectorAll('.seasonal-slot-button').forEach(button => {
      button.addEventListener('click', (event) => {
        const isMulti = seasonalMultiSelectMode || event.ctrlKey || event.metaKey || event.shiftKey;
        const key = seasonalSlotKey(button.dataset.class, button.dataset.date, button.dataset.period);
        if (isMulti) {
          if (seasonalSelectedSlots.has(key)) {
            seasonalSelectedSlots.delete(key);
          } else {
            seasonalSelectedSlots.set(key, {
              classCode: button.dataset.class,
              date: button.dataset.date,
              period: Number(button.dataset.period),
              id: button.dataset.id
            });
          }
          updateSeasonalSelectionUI();
        } else {
          if (seasonalSelectedSlots.size > 1 && seasonalSelectedSlots.has(key)) {
            openSeasonalBatchAssignModal();
            return;
          }
          seasonalSelectedSlots.clear();
          updateSeasonalSelectionUI();
          openSeasonalAssignModal(button.dataset.class, button.dataset.date, Number(button.dataset.period));
        }
      });
      button.addEventListener('dragstart', event => {
        if (!button.dataset.id) { event.preventDefault(); return; }
        seasonalDraggingScheduleId = button.dataset.id;
        event.dataTransfer?.setData('text/plain', seasonalDraggingScheduleId);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      });
      button.addEventListener('dragover', event => {
        if (seasonalDraggingScheduleId && !button.dataset.id) event.preventDefault();
      });
      button.addEventListener('drop', event => {
        event.preventDefault();
        const id = seasonalDraggingScheduleId || event.dataTransfer?.getData('text/plain');
        seasonalDraggingScheduleId = '';
        if (id && !button.dataset.id) moveSeasonalCell(id, button.dataset.date, Number(button.dataset.period));
      });
      button.addEventListener('dragend', () => { seasonalDraggingScheduleId = ''; });
    });
    updateSeasonalSelectionUI();
  } else {
    const rows = days.map(date => {
      const week = seasonalWeekNo(date, session['開始日期']);
      const cells = ['<td class="seasonal-date-cell"><b>' + esc(seasonalDisplayDate(date)) + '</b><small>第' + week + '週</small></td>'];
      for (let period = 1; period <= 5; period++) {
        const items = schedule.filter(row => seasonalText(row['教師姓名']) === person && seasonalIso(row['日期']) === date && Number(row['節次']) === period);
        const cell = items.map(row => '<span class="seasonal-teacher-class">' + esc(row['班級代碼']) + '<small>' + esc(row['科目代碼']) + '</small></span>').join('');
        cells.push('<td class="' + (period === 1 ? 'is-manual-period ' : '') + '">' + (cell || '') + '</td>');
      }
      return '<tr>' + cells.join('') + '</tr>';
    }).join('');
    wrap.innerHTML = '<table class="seasonal-timetable-table">' + head + '<tbody>' + rows + '</tbody></table>';
  }
  const currentNeeds = seasonalActiveRows('seasonalNeeds');
  const total = currentNeeds.reduce((sum, row) => sum + (parseInt(row['本期節數'], 10) || 0), 0);
  const assigned = schedule.filter(row => Number(row['節次']) !== 1).length;
  const summary = document.getElementById('seasonal-schedule-summary');
  if (summary) summary.innerHTML = '<span>課程需求 <b>' + total + '</b> 節</span><span>已排入 <b>' + assigned + '</b> 節</span><span>第一節手動安排 <b>' + schedule.filter(row => Number(row['節次']) === 1).length + '</b> 格</span>';
}

function openSeasonalAssignModal(classCode, date, period) {
  const existing = seasonalGetScheduleCell(classCode, date, period);
  document.getElementById('seasonal-assign-id').value = existing ? seasonalText(existing['課表ID']) : '';
  document.getElementById('seasonal-assign-date').value = date;
  document.getElementById('seasonal-assign-period').value = String(period);
  document.getElementById('seasonal-assign-class').value = classCode;
  document.getElementById('seasonal-assign-subject').value = existing ? existing['科目代碼'] : (period === 1 ? '學習輔導' : '');
  document.getElementById('seasonal-assign-teacher').value = existing ? existing['教師姓名'] : '';
  document.getElementById('seasonal-assign-lock').checked = existing ? seasonalIsTrue(existing['是否鎖定']) : false;
  document.getElementById('seasonal-assign-title').textContent = '手動安排課程・' + classCode + '・' + seasonalDisplayDate(date) + '・第' + period + '節';
  document.getElementById('seasonal-assign-hint').textContent = period === 1 ? '第一節由你手動安排，不納入自動排課的課程節數。' : '手動安排會保留在自動排課結果中。';
  document.getElementById('seasonal-assign-delete').hidden = !existing;
  document.getElementById('seasonal-assign-modal').classList.add('show');
}

function closeSeasonalAssignModal() {
  document.getElementById('seasonal-assign-modal')?.classList.remove('show');
}

async function moveSeasonalCell(scheduleId, date, period) {
  const row = seasonalActiveRows('seasonalSchedule').find(item => seasonalText(item['課表ID']) === seasonalText(scheduleId));
  if (!row) return;
  if (seasonalIsTrue(row['是否鎖定'])) {
    toast('此課程已鎖定，請先點開格位解除鎖定再移動。', 'warning');
    return;
  }
  const targetDate = seasonalIso(date);
  const targetWeek = seasonalWeekNo(targetDate, seasonalActiveSession()?.['開始日期']);
  const needId = seasonalText(row['需求ID']);
  const need = needId ? seasonalActiveRows('seasonalNeeds').find(item => seasonalText(item['需求ID']) === needId) : null;
  if (!seasonalActiveRows('seasonalDays').some(item => seasonalIso(item['日期']) === targetDate && seasonalIsTrue(item['是否上課']))) {
    toast('只能移至實際上課日。', 'warning');
    return;
  }
  if (Number(period) === 1 && !seasonalIsTrue(row['手動安排'])) {
    toast('第一節只能手動安排，請先以手動方式建立此格。', 'warning');
    return;
  }
  if (need && (targetWeek < (Number(need['起始週']) || 1) || targetWeek > (Number(need['結束週']) || Number(need['起始週']) || 1))) {
    toast('此課程只能安排在第' + need['起始週'] + '～' + need['結束週'] + '週。', 'warning');
    return;
  }
  const validation = seasonalCheckManualPlacement({
    classCode: row['班級代碼'], date: targetDate, period, subject: row['科目代碼'], teacherCode: row['教師姓名'],
    schedule: seasonalActiveRows('seasonalSchedule'), teacherBlocks: seasonalActiveRows('seasonalTeacherBlocks'), excludeId: scheduleId
  });
  if (!validation.ok) {
    toast(validation.error, 'warning');
    return;
  }
  row['日期'] = targetDate;
  row['節次'] = String(period);
  row['手動安排'] = 'TRUE';
  renderSeasonalTimetable();
  if (await seasonalPersistActive()) toast('課程已移至 ' + seasonalDisplayDate(targetDate) + ' 第' + period + '節。', 'success');
}

async function saveSeasonalManualCell() {
  const id = seasonalText(document.getElementById('seasonal-assign-id').value);
  const date = seasonalIso(document.getElementById('seasonal-assign-date').value);
  const period = Number(document.getElementById('seasonal-assign-period').value);
  const classCode = seasonalText(document.getElementById('seasonal-assign-class').value);
  const subject = seasonalText(document.getElementById('seasonal-assign-subject').value);
  const teacher = seasonalText(document.getElementById('seasonal-assign-teacher').value);
  const rows = seasonalActiveRows('seasonalSchedule');
  if (!subject) {
    toast('請輸入科目或活動名稱；如需清空請使用「清除此格」。', 'warning');
    return;
  }
  const validation = seasonalCheckManualPlacement({
    classCode, date, period, subject, teacherCode: teacher, schedule: rows, teacherBlocks: seasonalActiveRows('seasonalTeacherBlocks'), excludeId: id
  });
  if (!validation.ok) {
    toast(validation.error, 'error');
    return;
  }
  const kept = (state.seasonalSchedule || []).filter(row => seasonalText(row['課表ID']) !== id || !id);
  const row = {
    '課表ID': id || seasonalNewId('MANUAL'), '場次ID': seasonalActiveSessionId, '班級代碼': classCode,
    '日期': date, '節次': String(period), '科目代碼': subject, '教師姓名': teacher,
    '是否鎖定': document.getElementById('seasonal-assign-lock').checked ? 'TRUE' : 'FALSE', '手動安排': 'TRUE',
    '需求ID': seasonalFindNeedForManual(classCode, date, period, subject, teacher, id)
  };
  state.seasonalSchedule = kept.concat(row);
  closeSeasonalAssignModal();
  renderSeasonalTimetable();
  if (await seasonalPersistActive()) toast('手動課程已儲存。', 'success');
}

async function deleteSeasonalManualCell() {
  const id = seasonalText(document.getElementById('seasonal-assign-id').value);
  if (!id) return;
  const row = seasonalActiveRows('seasonalSchedule').find(item => seasonalText(item['課表ID']) === id);
  if (seasonalIsTrue(row && row['是否鎖定'])) {
    const confirmed = await showModal('清除鎖定課程', '此課程已鎖定，確定要手動清除嗎？', 'confirm', '清除', '取消');
    if (!confirmed) return;
  }
  state.seasonalSchedule = (state.seasonalSchedule || []).filter(row => seasonalText(row['課表ID']) !== id);
  closeSeasonalAssignModal();
  renderSeasonalTimetable();
  if (await seasonalPersistActive()) toast('課表格位已清除。', 'success');
}

async function runSeasonalAutoSchedule() {
  const session = seasonalActiveSession();
  if (!session || !seasonalIso(session['開始日期']) || !seasonalIso(session['結束日期'])) {
    toast('請先完成並儲存活動日期設定。', 'warning');
    return;
  }
  const days = seasonalActiveRows('seasonalDays');
  const needs = seasonalActiveRows('seasonalNeeds');
  if (!days.some(row => seasonalIsTrue(row['是否上課'])) || !needs.length) {
    toast('請先設定實際上課日與課程需求。', 'warning');
    return;
  }
  const result = seasonalBuildPlan({
    session, days, needs, teacherBlocks: seasonalActiveRows('seasonalTeacherBlocks'),
    schedule: seasonalActiveRows('seasonalSchedule'), seed: Date.now()
  });
  if (result.error) {
    toast(result.error, 'error');
    return;
  }
  state.seasonalSchedule = (state.seasonalSchedule || []).filter(row => seasonalText(row['場次ID']) !== seasonalActiveSessionId).concat(result.schedule);
  renderSeasonalTimetable();
  if (await seasonalPersistActive()) {
    if (!result.deficits.length) toast('自動排課完成，共安排 ' + result.added + ' 節。', 'success');
    else {
      const details = result.deficits.slice(0, 10).map(item => item.classCode + ' ' + item.subjectCode + '（' + item.teacherCode + '）尚有 ' + item.remaining + ' 節，' + item.reason).join('<br>');
      showModal('寒暑輔排課完成，仍有課程未排入', '本次安排 ' + result.added + ' 節。<br><br>' + details, 'warning');
    }
  }
}

if (typeof window !== 'undefined') {
  window.seasonalBuildPlan = seasonalBuildPlan;
  window.seasonalCheckManualPlacement = seasonalCheckManualPlacement;
  window.seasonalGetWeekRanges = seasonalGetWeekRanges;
}
