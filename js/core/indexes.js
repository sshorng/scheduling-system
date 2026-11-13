/* 統一索引建立、綁班調動解析與硬軟衝突檢查（無頂層 DOM 相依，Worker 可匯入） */

// ============================================================
// 建立查詢索引（整合主資料索引、教師配課單位與併班統計）
// ============================================================
function buildIndex() {
  const perfStart = isPerfEnabled() ? perfNow() : 0;
  idx.classByCode = {};
  idx.teacherByCode = {};
  idx.homeroomTeacherByClass = Object.create(null);
  idx.subjectByCode = {};
  idx.subjectColor = {};
  idx.roomByCode = {};

  idx.schedByClassSlot = {};
  idx.schedByClassSlotP8 = {};
  idx.scheduleSlot = Object.create(null);
  idx.schedByTeacherSlot = {};
  idx.schedBySubjectSlot = {};
  idx.schedBySubjectSlotP8 = {};
  idx.schedByRoomSlot = {};
  idx.schedByClassDayEntries = Object.create(null);
  idx.schedByClassSubjectDay = Object.create(null);
  idx.teacherScheduleKeysByCode = Object.create(null);

  idx.blockSet = new Set();
  idx.rulesBySubjectSlot = {};
  idx.rulesBySubject = Object.create(null);
  idx.subjectRelationsBySubject = {};
  idx.bindGroupByCode = {};
  idx.bindBySubject = {};
  idx.bindByClass = {};

  idx.assignmentsByClass = Object.create(null);
  idx.assignmentsByTeacher = Object.create(null);
  idx.teacherByClassSubject = Object.create(null);
  idx.preplannedAssignmentKeySet = new Set();

  idx.exclusivePairSet = new Set();
  idx.exclusiveRulesByTeacher = Object.create(null);

  idx.scheduleCountByTeacher = Object.create(null);
  idx.scheduleCountByClass = Object.create(null);
  idx.classNonHelperScheduleCount = Object.create(null);
  idx.scheduleCountByTeacherClassSubject = Object.create(null);
  idx.scheduleCountByClassSubject = Object.create(null);
  idx.assignedWeeklyByTeacher = Object.create(null);
  idx.requiredWeeklyByTeacherClassSubject = Object.create(null);
  idx.scheduledAssignedByTeacher = Object.create(null);

  state.schedule = (state.schedule || []).map(normalizePatrolScheduleEntry);

  // 課表資料防重複列清掃
  const uniqueMap = new Map();
  for (let i = 0; i < state.schedule.length; i++) {
    const cell = state.schedule[i];
    const day = parseInt(cell['星期'], 10);
    const per = parseInt(cell['節次'], 10);
    const patrolOwner = isPatrolScheduleEntry(cell) ? '|' + String(cell['教師姓名'] || '') : '';
    const k = String(cell['班級代碼'] || '').trim() + '|' + day + '|' + per + '|' + (per === 8 ? String(cell['課堂屬性'] || '一般') : '一般') + patrolOwner;
    uniqueMap.set(k, cell);
  }
  state.schedule = Array.from(uniqueMap.values());

  for (let i = 0; i < state.classes.length; i++) {
    const c = state.classes[i];
    idx.classByCode[c['班級代碼']] = c;
  }
  for (let i = 0; i < state.teachers.length; i++) {
    const t = state.teachers[i];
    const name = t['教師姓名'] || t['姓名'] || '';
    if (name) idx.teacherByCode[name] = t;
    if (t['教師姓名']) idx.teacherByCode[t['教師姓名']] = t;
    const homeroomClass = String(getTeacherHomeroom(t) || '');
    if (homeroomClass && homeroomClass !== 'TRUE') idx.homeroomTeacherByClass[homeroomClass] = t;
  }
  for (let i = 0; i < state.subjects.length; i++) {
    const s = state.subjects[i];
    const code = s['科目代碼'];
    idx.subjectByCode[code] = s;
    idx.subjectColor[code] = i;
  }
  for (let i = 0; i < (state.rooms || []).length; i++) {
    const r = state.rooms[i];
    idx.roomByCode[String(r['教室代碼'] || '')] = r;
  }

  // 綁班群組索引（提前建立以便配課單位彙整直接查找）
  for (let i = 0; i < (state.blockGroups || []).length; i++) {
    const g = state.blockGroups[i];
    const gid = g['群組ID'];
    idx.bindGroupByCode[gid] = g;
    const subList = typeof g['科目清單'] === 'string'
      ? g['科目清單'].split(',').map(s => s.trim()).filter(Boolean)
      : (typeof g['科目代碼'] === 'string' ? g['科目代碼'].split(',').map(s => s.trim()).filter(Boolean) : []);
    const clsList = typeof g['班級清單'] === 'string'
      ? g['班級清單'].split(',').map(c => c.trim()).filter(Boolean)
      : (Array.isArray(g['班級清單']) ? g['班級清單'] : (typeof g['班級清單'] === 'number' ? String(g['班級清單']).match(/.{3}/g) || [] : []));
    for (let si = 0; si < subList.length; si++) {
      const sub = subList[si];
      if (!idx.bindBySubject[sub]) idx.bindBySubject[sub] = [];
      idx.bindBySubject[sub].push(g);
    }
    for (let ci = 0; ci < clsList.length; ci++) {
      const c = clsList[ci];
      if (!idx.bindByClass[c]) idx.bindByClass[c] = [];
      idx.bindByClass[c].push(g);
    }
  }

  // 單次掃描課表建立所有槽位索引、同師併班特徵與教師鐘點統計
  const scheduledUnitsByTeacherSlot = Object.create(null);
  const scheduledCohortSlots = Object.create(null);
  for (let i = 0; i < state.schedule.length; i++) {
    const cell = state.schedule[i];
    const isPatrol = isPatrolScheduleEntry(cell);
    const cls = String(cell['班級代碼'] || '').trim();
    const tc = String(cell['教師姓名'] || '').trim();
    const sub = String(cell['科目代碼'] || '').trim();
    const day = parseInt(cell['星期'], 10);
    const per = parseInt(cell['節次'], 10);
    const attr = cell['課堂屬性'] || '一般';
    const ck = cls + '|' + day + '|' + per;
    const sk = sub + '|' + day + '|' + per;

    if (!isPatrol) {
      idx.scheduleSlot[ck + '|' + attr] = cell;
      if (per !== 8) idx.scheduleSlot[ck + '|一般'] = cell;

      if (per === 8 && (attr === '單週' || attr === '雙週')) {
        if (!idx.schedByClassSlotP8[ck]) idx.schedByClassSlotP8[ck] = {};
        idx.schedByClassSlotP8[ck][attr] = cell;
      } else {
        idx.schedByClassSlot[ck] = cell;
      }
      if (per === 8 && attr !== '單週' && attr !== '雙週') {
        idx.schedByClassSlot[ck] = cell;
      }
      if (cls && Number.isFinite(day)) {
        const cdKey = cls + '|' + day;
        (idx.schedByClassDayEntries[cdKey] ||= []).push(cell);
        if (sub) {
          const csdKey = cls + '|' + sub + '|' + day;
          (idx.schedByClassSubjectDay[csdKey] ||= []).push(cell);
        }
      }
      if (cls && !isHelperSubjectCode(sub)) {
        idx.classNonHelperScheduleCount[cls] = (idx.classNonHelperScheduleCount[cls] || 0) + 1;
      }
    }

    const parsedCodes = typeof getCellTeacherCodes === 'function' ? getCellTeacherCodes(cell) : [];
    const teacherCodes = parsedCodes.length > 0 ? parsedCodes : (tc ? [tc] : []);
    const scheduleUnits = typeof getScheduleWeeklyUnits === 'function' ? getScheduleWeeklyUnits(cell) : 1;
    const scheduleAttr = per === 8 ? String(cell['課堂屬性'] || '一般').trim() : '一般';

    for (let ti = 0; ti < teacherCodes.length; ti++) {
      const tCode = String(teacherCodes[ti] || '').trim();
      if (!tCode) continue;
      const tKey = tCode + '|' + day + '|' + per;
      if (!idx.schedByTeacherSlot[tKey]) idx.schedByTeacherSlot[tKey] = [];
      idx.schedByTeacherSlot[tKey].push(cell);
      (idx.teacherScheduleKeysByCode[tCode] ||= new Set()).add(tKey);

      if (!isPatrol) {
        idx.scheduleCountByTeacher[tCode] = (idx.scheduleCountByTeacher[tCode] || 0) + 1;
        if (Number.isFinite(day) && Number.isFinite(per)) {
          const unitKey = tCode + '|' + day + '|' + per + '|' + scheduleAttr;
          scheduledUnitsByTeacherSlot[unitKey] = Math.max(scheduledUnitsByTeacherSlot[unitKey] || 0, scheduleUnits);
          if (sub && cls) {
            const cohortKey = tCode + '|' + sub + '|' + day + '|' + per + '|' + scheduleAttr;
            (scheduledCohortSlots[cohortKey] ||= new Set()).add(cls);
          }
        }
        if (cls && sub) {
          const tcsKey = tCode + '|' + cls + '|' + sub;
          idx.scheduleCountByTeacherClassSubject[tcsKey] = (idx.scheduleCountByTeacherClassSubject[tcsKey] || 0) + scheduleUnits;
        }
      }
    }

    if (!isPatrol) {
      if (sub) {
        idx.schedBySubjectSlot[sk] = (idx.schedBySubjectSlot[sk] || 0) + 1;
        if (per === 8 && (attr === '單週' || attr === '雙週')) {
          const p8Key = sub + '|' + day + '|8|' + attr;
          idx.schedBySubjectSlotP8[p8Key] = (idx.schedBySubjectSlotP8[p8Key] || 0) + 1;
        }
      }
      if (cls) {
        idx.scheduleCountByClass[cls] = (idx.scheduleCountByClass[cls] || 0) + scheduleUnits;
        if (sub) {
          const csKey = cls + '|' + sub;
          idx.scheduleCountByClassSubject[csKey] = (idx.scheduleCountByClassSubject[csKey] || 0) + scheduleUnits;
        }
      }
      const subObj = idx.subjectByCode[sub];
      const roomCode = subObj ? String(subObj['所屬教室代碼'] || '').trim() : '';
      if (roomCode) {
        const rk = roomCode + '|' + day + '|' + per;
        if (!idx.schedByRoomSlot[rk]) idx.schedByRoomSlot[rk] = [];
        idx.schedByRoomSlot[rk].push(cell);
      }
    }
  }

  const scheduledCohortByTeacherSubjectClass = Object.create(null);
  Object.entries(scheduledCohortSlots).forEach(([key, classes]) => {
    if (classes.size < 2) return;
    const parts = key.split('|');
    const teacherCode = parts[0];
    const subjectCode = parts[1];
    const signature = [...classes].sort().join(',');
    classes.forEach(classCode => {
      scheduledCohortByTeacherSubjectClass[teacherCode + '|' + subjectCode + '|' + classCode] = signature;
    });
  });
  idx.scheduledCohortByTeacherSubjectClass = scheduledCohortByTeacherSubjectClass;

  Object.entries(scheduledUnitsByTeacherSlot).forEach(([key, units]) => {
    const teacherCode = key.split('|')[0];
    idx.scheduledAssignedByTeacher[teacherCode] = (idx.scheduledAssignedByTeacher[teacherCode] || 0) + units;
  });

  // 教師不排課（新版「時段」陣列優先；舊欄位星期／節次相容）
  for (let i = 0; i < (state.teacherBlocks || []).length; i++) {
    const b = state.teacherBlocks[i];
    const name = b['教師姓名'];
    if (!name) continue;
    if (b['時段']) {
      const slots = getTeacherBlockSlots(b);
      for (let si = 0; si < slots.length; si++) {
        idx.blockSet.add(name + '|' + slots[si].day + '|' + slots[si].period);
      }
    } else if (b['星期'] != null && b['節次'] != null) {
      idx.blockSet.add(name + '|' + parseInt(b['星期'], 10) + '|' + parseInt(b['節次'], 10));
    }
  }

  // 科目規則（支援逗號分隔一次性規則）
  for (let i = 0; i < (state.subjectRules || []).length; i++) {
    const r = state.subjectRules[i];
    const expanded = getRuleDaysPeriods(r);
    const subjectCodes = getRuleSubjectCodes(r);
    subjectCodes.forEach(subjectCode => {
      (idx.rulesBySubject[subjectCode] ||= []).push(r);
      for (let j = 0; j < expanded.length; j++) {
        const day = expanded[j].day;
        const period = expanded[j].period;
        const k = subjectCode + '|' + day + '|' + period;
        if (!idx.rulesBySubjectSlot[k]) idx.rulesBySubjectSlot[k] = [];
        idx.rulesBySubjectSlot[k].push(r);
      }
    });
  }

  // 科目關係索引：同一條關係掛到 A、B 兩端，查詢候選科目時只取相關規則。
  for (let i = 0; i < (state.subjectRelations || []).length; i++) {
    const relation = state.subjectRelations[i];
    getSubjectRelationCodes(relation).forEach(subjectCode => {
      if (!idx.subjectRelationsBySubject[subjectCode]) idx.subjectRelationsBySubject[subjectCode] = [];
      idx.subjectRelationsBySubject[subjectCode].push(relation);
    });
  }

  // 配課索引與教師每週應排節數（併班群組與同師同班同節合併只計一次）
  const weeklyUnits = Object.create(null);
  for (let i = 0; i < (state.assignments || []).length; i++) {
    const a = state.assignments[i];
    const cls = String(a['班級代碼'] || '').trim();
    const sub = String(a['科目代碼'] || '').trim();
    if (cls) (idx.assignmentsByClass[cls] ||= []).push(a);
    if (cls && sub) {
      const csKey = cls + '|' + sub;
      idx.teacherByClassSubject[csKey] = a;
      if (isPreplannedCourse(a['課程屬性'])) idx.preplannedAssignmentKeySet.add(csKey);
    }

    let teacherCodes = typeof getCellTeacherCodes === 'function'
      ? getCellTeacherCodes(a).map(code => String(code || '').trim()).filter(Boolean)
      : String(a['教師姓名'] || '').split(/[,，、;；]/).map(code => code.trim()).filter(Boolean);
    if (teacherCodes.length === 0 && String(a['教師姓名'] || '').trim()) {
      teacherCodes = String(a['教師姓名']).split(/[,，、;；]/).map(code => code.trim()).filter(Boolean);
    }
    const subject = idx.subjectByCode[sub];
    const weekly = getAssignmentWeeklyValue(a, subject, 3);
    teacherCodes.forEach(teacherCode => {
      (idx.assignmentsByTeacher[teacherCode] ||= []).push(a);
      if (!cls || !sub) return;
      const key = teacherCode + '|' + cls + '|' + sub;
      idx.requiredWeeklyByTeacherClassSubject[key] = (idx.requiredWeeklyByTeacherClassSubject[key] || 0) + weekly;
      const bindClasses = typeof getBindGroupClasses === 'function' ? getBindGroupClasses(sub, cls) : null;
      const scheduledCohort = scheduledCohortByTeacherSubjectClass[teacherCode + '|' + sub + '|' + cls];
      const unitKey = bindClasses && bindClasses.length > 1
        ? teacherCode + '|bind|' + sub + '|' + [...bindClasses].sort().join(',')
        : scheduledCohort
          ? teacherCode + '|scheduled-cohort|' + sub + '|' + scheduledCohort
          : teacherCode + '|class|' + cls + '|' + sub;
      weeklyUnits[unitKey] = Math.max(weeklyUnits[unitKey] || 0, weekly);
    });
  }
  Object.entries(weeklyUnits).forEach(([unitKey, weekly]) => {
    const teacherCode = unitKey.split('|')[0];
    idx.assignedWeeklyByTeacher[teacherCode] = (idx.assignedWeeklyByTeacher[teacherCode] || 0) + weekly;
  });

  // 教師互斥索引
  for (let i = 0; i < (state.teacherExclusives || []).length; i++) {
    const r = state.teacherExclusives[i];
    const a = String(r['教師A'] || '').trim();
    const b = String(r['教師B'] || '').trim();
    if (a && b) {
      const key = a < b ? a + '|' + b : b + '|' + a;
      idx.exclusivePairSet.add(key);
      const peersA = typeof resolveTeacherCodes === 'function' ? resolveTeacherCodes(a) : [a];
      const peersB = typeof resolveTeacherCodes === 'function' ? resolveTeacherCodes(b) : [b];
      peersA.forEach(codeA => {
        (idx.exclusiveRulesByTeacher[codeA] ||= []).push({ rule: r, peerCodes: peersB });
      });
      peersB.forEach(codeB => {
        (idx.exclusiveRulesByTeacher[codeB] ||= []).push({ rule: r, peerCodes: peersA });
      });
    }
  }

  idx.__built = true;
  if (perfStart > 0) perfRecord('buildIndex', perfNow() - perfStart, { schedule: state.schedule.length, assignments: (state.assignments || []).length });
}

// 綁班群組以「實際配課的班級／科目組合」共用時段；
// 因此普通班的英語與資優班的資優英語，只要同列於同一群組，就必須一起排入。
function parseBindList(value) {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'number') return String(value).match(/.{3}/g) || [];
  return String(value || '').split(/[,，、;；]/).map(item => item.trim()).filter(Boolean);
}

function getConfiguredBindMembers(group) {
  const classCodes = parseBindList(group?.['班級清單']);
  const subjectCodes = parseBindList(group?.['科目清單'] || group?.['科目代碼']);
  const assignments = state.assignments || [];
  const members = [];
  classCodes.forEach(classCode => {
    const assignedSubjects = subjectCodes.filter(subjectCode => assignments.some(assignment =>
      String(assignment['班級代碼'] || '').trim() === classCode &&
      String(assignment['科目代碼'] || '').trim() === subjectCode
    ));
    const activeSubjects = assignedSubjects.length > 0 ? assignedSubjects : subjectCodes;
    activeSubjects.forEach(subjectCode => members.push({ classCode, subjectCode }));
  });
  return members;
}

function getBindGroupInfo(subjectCode, classCode) {
  const targetSubject = String(subjectCode || '').trim();
  const targetClass = String(classCode || '').trim();
  if (!targetSubject || !targetClass) return null;
  for (const group of state.blockGroups || []) {
    const members = getConfiguredBindMembers(group);
    if (members.length < 2) continue;
    if (members.some(member => member.classCode === targetClass && member.subjectCode === targetSubject)) {
      return { group, members };
    }
  }
  return null;
}

function getBindCohortMembers(subjectCode, classCode) {
  const info = getBindGroupInfo(subjectCode, classCode);
  if (!info) return null;
  const byClass = new Map();
  info.members.forEach(member => {
    if (!byClass.has(member.classCode)) byClass.set(member.classCode, []);
    byClass.get(member.classCode).push(member);
  });
  const targetMembers = byClass.get(String(classCode || '').trim()) || [];
  const targetIndex = targetMembers.findIndex(member => member.subjectCode === String(subjectCode || '').trim());
  if (targetIndex < 0) return null;
  const cohort = [...byClass.values()]
    .map(members => members[targetIndex])
    .filter(Boolean);
  return cohort.length >= 2 ? cohort : null;
}

function getBindGroupMembers(subjectCode, classCode) {
  return getBindCohortMembers(subjectCode, classCode);
}

function getConfiguredBindClasses(group, subjectCode) {
  const subject = String(subjectCode || '').trim();
  return [...new Set(getConfiguredBindMembers(group)
    .filter(member => member.subjectCode === subject)
    .map(member => member.classCode))];
}

function getBindGroupClasses(subjectCode, classCode) {
  const members = getBindGroupMembers(subjectCode, classCode);
  if (!members) return null;
  return [...new Set(members.map(member => member.classCode))];
}

function isBindScheduleEntry(entry) {
  if (!entry) return false;
  const subjectCode = String(entry['科目代碼'] || '').trim();
  const classCode = String(entry['班級代碼'] || '').trim();
  return Boolean(subjectCode && classCode && getBindGroupClasses(subjectCode, classCode));
}

function isDragProtectedScheduleEntry(entry) {
  return Boolean(entry && (isPatrolScheduleEntry(entry) || isFrozenScheduleEntry(entry)));
}

function getScheduleCellsAt(classCode, day, period, weekType = '') {
  const cls = String(classCode || '').trim();
  const dayN = parseInt(day, 10);
  const perN = parseInt(period, 10);
  const week = perN === 8 && weekType ? String(weekType).trim() : '';
  const patrolCls = typeof PATROL_CLASS_CODE !== 'undefined' ? PATROL_CLASS_CODE : '巡堂';
  if (idx.__built && idx.schedByClassSlot && idx.schedByClassSlotP8 && cls && cls !== patrolCls && cls !== 'ADMIN_PATROL') {
    const ck = cls + '|' + dayN + '|' + perN;
    if (perN !== 8) {
      const cell = idx.schedByClassSlot[ck];
      return cell ? [cell] : [];
    }
    const candidates = [
      ...(idx.schedByClassSlot[ck] ? [idx.schedByClassSlot[ck]] : []),
      ...Object.values(idx.schedByClassSlotP8[ck] || {})
    ];
    return !week ? candidates : candidates.filter(entry => String(entry['課堂屬性'] || '').trim() === week);
  }
  return (state.schedule || []).filter(entry => {
    if (String(entry['班級代碼'] || '').trim() !== cls) return false;
    if (parseInt(entry['星期'], 10) !== dayN || parseInt(entry['節次'], 10) !== perN) return false;
    return !week || String(entry['課堂屬性'] || '').trim() === week;
  });
}

function getOverlappingScheduleCellsAt(classCode, day, period, weekType = '') {
  const perN = parseInt(period, 10);
  if (perN !== 8) return getScheduleCellsAt(classCode, day, perN);
  const targetSlot = { '節次': 8, '課堂屬性': String(weekType || '一般').trim() };
  return getScheduleCellsAt(classCode, day, perN).filter(entry => !isAlternateWeekPair(targetSlot, entry));
}

function getScheduleCellAt(classCode, day, period, weekType = '') {
  return getScheduleCellsAt(classCode, day, period, weekType)[0] || null;
}

function getDefaultAlternateWeekType(classCode, subjectCode, day, period, requestedWeek = '') {
  if (parseInt(period, 10) !== 8) return '';
  const requested = String(requestedWeek || '').trim();
  if (requested === '單週' || requested === '雙週') return requested;
  const isAlternate = (state.assignments || []).some(assignment =>
    String(assignment['班級代碼'] || '').trim() === String(classCode || '').trim() &&
    String(assignment['科目代碼'] || '').trim() === String(subjectCode || '').trim() &&
    isAlternateWeeklyValue(getAssignmentWeeklyValue(assignment, idx.subjectByCode?.[String(subjectCode || '').trim()], 3))
  );
  if (!isAlternate) return '';
  const usedWeeks = new Set(getScheduleCellsAt(classCode, day, period)
    .map(entry => String(entry['課堂屬性'] || '').trim())
    .filter(week => week === '單週' || week === '雙週'));
  return usedWeeks.has('單週') && !usedWeeks.has('雙週') ? '雙週' : '單週';
}

function buildBindMovePlan({ subjectCode, srcCls, srcDay, srcPer, dstCls, dstDay, dstPer, srcWeek = '', dstWeek = '' }) {
  const subject = String(subjectCode || '').trim();
  const sourceClass = String(srcCls || '').trim();
  const bindMembers = getBindGroupMembers(subject, sourceClass);
  const bindClasses = bindMembers ? [...new Set(bindMembers.map(member => member.classCode))] : null;
  if (!bindMembers || bindClasses.length < 2) return null;

  const sourceKnown = getScheduleCellAt(sourceClass, srcDay, srcPer, srcWeek);
  const sourceWeek = parseInt(srcPer, 10) === 8
    ? String(srcWeek || sourceKnown?.['課堂屬性'] || '').trim()
    : '';
  const sourceEntries = bindMembers.map(member => getScheduleCellAt(member.classCode, srcDay, srcPer, sourceWeek));
  if (sourceEntries.some(entry => !entry)) {
    return { ok: false, error: '綁班課程資料不完整，必須先補齊所有班級後才能整組移動' };
  }
  if (sourceEntries.some((entry, index) => String(entry['科目代碼'] || '').trim() !== bindMembers[index].subjectCode)) {
    return { ok: false, error: '綁班課程資料不一致，無法整組移動' };
  }
  if (sourceEntries.some(entry => isFrozenScheduleEntry(entry))) {
    return { ok: false, error: '綁班群組中含有鎖定或固定課程，整組不可移動' };
  }

  const destinationAttr = parseInt(dstPer, 10) === 8
    ? String(dstWeek || sourceWeek || sourceEntries[0]['課堂屬性'] || '一般').trim()
    : String(sourceEntries[0]['課堂屬性'] || '一般').trim();
  const destinationWeek = parseInt(dstPer, 10) === 8 ? destinationAttr : '';
  const targetClasses = [...new Set([...bindClasses, String(dstCls || '').trim()].filter(Boolean))];
  const destinationEntries = targetClasses.flatMap(classCode =>
    getOverlappingScheduleCellsAt(classCode, dstDay, dstPer, destinationWeek).map(entry => ({ classCode, entry }))
  );
  if (destinationEntries.length > 0) {
    const occupied = destinationEntries.map(item => `${item.classCode}（${item.entry['科目代碼'] || '未知科目'}）`).join('、');
    return { ok: false, error: `綁班課程必須整組移動到空時段；目的地已有課程：${occupied}` };
  }

  return {
    ok: true,
    subjectCode: subject,
    bindMembers,
    bindClasses,
    sourceEntries,
    destinationAttr,
    sourceDay: parseInt(srcDay, 10),
    sourcePeriod: parseInt(srcPer, 10),
    destinationDay: parseInt(dstDay, 10),
    destinationPeriod: parseInt(dstPer, 10),
    sourceWeek,
    destinationWeek
  };
}

async function checkBindMoveConflicts(plan, actionPrompt = '綁班課程調動') {
  if (!plan || !plan.ok) return false;
  const conflicts = [];
  plan.sourceEntries.forEach(entry => {
    const classCode = String(entry['班級代碼'] || '').trim();
    conflicts.push(...detectConflicts(
      plan.destinationDay,
      plan.destinationPeriod,
      getCellTeacherCodes(entry),
      String(entry['科目代碼'] || '').trim(),
       classCode,
       plan.bindClasses,
        {
          srcDay: plan.sourceDay,
          srcPer: plan.sourcePeriod,
          excludeIds: plan.sourceEntries.map(source => source['課表ID'])
        },
       plan.destinationWeek
     ));
  });
  const uniqueConflicts = [];
  const seen = new Set();
  conflicts.forEach(conflict => {
    const key = String(conflict.kind || '') + '|' + String(conflict.msg || '');
    if (seen.has(key)) return;
    seen.add(key);
    uniqueConflicts.push(conflict);
  });
  return checkHandAdjustConflicts(uniqueConflicts, actionPrompt);
}

function buildBindPlacementPlan({ subjectCode, classCode, day, period, weekType = '', teacherCode }) {
  const subject = String(subjectCode || '').trim();
  const targetClass = String(classCode || '').trim();
  const bindMembers = getBindGroupMembers(subject, targetClass);
  const bindClasses = bindMembers ? [...new Set(bindMembers.map(member => member.classCode))] : null;
  if (!bindMembers || bindClasses.length < 2) return null;
  const primaryTeacherValue = Array.isArray(teacherCode)
    ? (teacherCode.length > 1
      ? JSON.stringify(teacherCode)
      : String(teacherCode[0]?.['教師姓名'] || teacherCode[0] || ''))
    : String(teacherCode || '');

  const sourceEntries = bindMembers.map(member => ({
    '班級代碼': String(member.classCode),
    '科目代碼': member.subjectCode,
    '教師姓名': String(member.classCode) === targetClass && member.subjectCode === subject
      ? primaryTeacherValue
      : getTeacherForClassSubject(member.classCode, member.subjectCode, { targetCls: targetClass, tc: teacherCode })
  }));
  return {
    ok: true,
    subjectCode: subject,
    bindMembers,
    bindClasses,
    sourceEntries,
    sourceDay: 0,
    sourcePeriod: 0,
    destinationDay: parseInt(day, 10),
    destinationPeriod: parseInt(period, 10),
    sourceWeek: '',
    destinationWeek: parseInt(period, 10) === 8 ? String(weekType || '').trim() : ''
  };
}

function parseCombinedGroupValues(value) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  if (typeof value === 'number') return String(value).match(/.{3}/g) || [];
  return String(value || '').split(/[,，、]/).map(item => item.trim()).filter(Boolean);
}

function isAllowedCombinedClassCohort(items, options = {}) {
  if (!Array.isArray(items) || items.length < 2) return false;
  const subjectCodes = [...new Set(items.map(item => String(item?.subjectCode || '').trim()).filter(Boolean))];
  const classCodes = items.map(item => String(item?.classCode || '').trim()).filter(Boolean);
  if (classCodes.length !== items.length || new Set(classCodes).size !== items.length) return false;
  const allLockedSameSubject = items.every(item => String(item?.isLocked || '').toUpperCase() === 'TRUE' || item?.isLocked === true);
  if (allLockedSameSubject) return true;

  const configuredBind = (state.blockGroups || []).some(group => {
    const members = getConfiguredBindMembers(group);
    return members.length >= 2 && items.every(item => members.some(member =>
      member.classCode === String(item?.classCode || '').trim() &&
      member.subjectCode === String(item?.subjectCode || '').trim()
    ));
  });
  if (configuredBind) return true;

  if (options.allowCoTeacher) {
    const mainCount = items.filter(item => item.isMainTeacher === true).length;
    return mainCount <= 1;
  }
  return false;
}

if (typeof window !== 'undefined') window.isAllowedCombinedClassCohort = isAllowedCombinedClassCohort;

// 輔助：取得特定班級與科目的專屬教師（預設帶入備用教師）
function getTeacherForClassSubject(cls, subjectCode, defaultTcInfo) {
  if (defaultTcInfo && String(cls) === String(defaultTcInfo.targetCls) && defaultTcInfo.tc) {
    return String(defaultTcInfo.tc);
  }
  const asgn = (idx.teacherByClassSubject && idx.teacherByClassSubject[String(cls) + '|' + String(subjectCode)])
    || state.assignments.find(a =>
    String(a['班級代碼']) === String(cls) &&
    String(a['科目代碼']) === String(subjectCode)
  );
  if (asgn && asgn['教師姓名']) return String(asgn['教師姓名']);

  const existing = state.schedule.find(s =>
    String(s['班級代碼']) === String(cls) &&
    String(s['科目代碼']) === String(subjectCode) &&
    s['教師姓名']
  );
  if (existing && existing['教師姓名']) return String(existing['教師姓名']);

  return String(defaultTcInfo ? (defaultTcInfo.tc || '') : '');
}

// ============================================================
// 衝突偵測（Client-side，快速）
// ============================================================
// 拖曳中的衝突結果快取：同一場拖曳反覆 dragover 高峰時，只對每個目標格算一次。
// 快取鍵綁定「當前拖曳物件」，拖曳開始時重置、結束時清除，避免資料過期。
function cachedConflictCheck(day, period, teacherCode, subjectCode, classCode, excludeClassCode, excludeInfo, targetAttr) {
  if (!ui.drag) return detectConflicts(day, period, teacherCode, subjectCode, classCode, excludeClassCode, excludeInfo, targetAttr);
  if (!ui.drag._conflictCache) ui.drag._conflictCache = new Map();
  const key = day + '|' + period + '|' + (targetAttr || '') + '|' + (ui.drag.subjectCode || '') + '|' + (classCode || '');
  if (!ui.drag._conflictCache.has(key)) {
    ui.drag._conflictCache.set(key, detectConflicts(day, period, teacherCode, subjectCode, classCode, excludeClassCode, excludeInfo, targetAttr));
  }
  return ui.drag._conflictCache.get(key);
}
function resetDragConflictCache() {
  if (ui.drag) ui.drag._conflictCache = new Map();
}

function getSubjectRelationWarnings(day, subjectCode, classCode, schedule = state.schedule, excludeInfo = null) {
  const targetSubject = String(subjectCode || '').trim();
  const targetClass = String(classCode || '').trim();
  const dayN = parseInt(day, 10);
  if (!targetSubject || !targetClass || !Number.isFinite(dayN)) return [];

  const classInfo = idx.classByCode?.[targetClass];
  const grade = String(classInfo?.['年級'] || targetClass.charAt(0)).trim();
  const dayLabel = ['','一','二','三','四','五'][dayN] || dayN;
  // 科目關係是同一班不同科目的分日偏好；綁班則是不同班的同科目共時，兩者互不取代。
  const relatedRules = (idx.subjectRelationsBySubject?.[targetSubject] || [])
    .filter(rule => subjectRelationAppliesToClass(rule, targetClass, grade));
  if (relatedRules.length === 0) return [];

  const subjectsOnDay = new Set();
  const excludedDay = excludeInfo ? parseInt(excludeInfo.srcDay, 10) : NaN;
  const excludedPer = excludeInfo ? parseInt(excludeInfo.srcPer, 10) : NaN;
  const canUseDayIndex = schedule === state.schedule && idx.__built && idx.schedByClassDayEntries;
  const dayEntries = canUseDayIndex
    ? (idx.schedByClassDayEntries[targetClass + '|' + dayN] || [])
    : (schedule || []);
  dayEntries.forEach(entry => {
    if (isPatrolScheduleEntry(entry)) return;
    if (!canUseDayIndex) {
      if (String(entry['班級代碼'] || '').trim() !== targetClass) return;
      if (parseInt(entry['星期'], 10) !== dayN) return;
    }
    if (excludeInfo &&
        parseInt(entry['星期'], 10) === excludedDay &&
        parseInt(entry['節次'], 10) === excludedPer) return;
    const code = String(entry['科目代碼'] || '').trim();
    if (code && code !== targetSubject) subjectsOnDay.add(code);
  });

  const warnings = [];
  const seen = new Set();
  relatedRules.forEach(rule => {
    const otherSubject = getSubjectRelationOtherCode(rule, targetSubject);
    if (!otherSubject || !subjectsOnDay.has(otherSubject)) return;
    const pairKey = String(rule['規則ID'] || subjectRelationPairKey(targetSubject, otherSubject));
    if (seen.has(pairKey)) return;
    seen.add(pairKey);
    warnings.push({
      hard: false,
      kind: 'subjectRelation',
      msg: `科目關係建議：${targetClass}（${grade}年級）「${targetSubject}」與「${otherSubject}」目前同在星期${dayLabel}，建議分散至不同日期（${subjectRelationScopeLabel(rule)}）`
    });
  });
  return warnings;
}

function detectConflicts(day, period, teacherCode, subjectCode, classCode, excludeClassCode, excludeInfo, targetAttr) {
  const conflicts = [];
  const dayN = parseInt(day,10), perN = parseInt(period,10);
  const targetSlot = { '節次': perN, '課堂屬性': perN === 8 ? String(targetAttr || '').trim() : '' };

  // 第八節一般課程會佔用單週與雙週，不能和任一週次課程重疊；單週與雙週可各排一門。
  if (perN === 8 && classCode) {
    const cleanCls = String(classCode || '').trim();
    const excludedIds = new Set([
      ...(Array.isArray(excludeInfo?.excludeIds) ? excludeInfo.excludeIds : []),
      ...(excludeInfo?.excludeId ? [excludeInfo.excludeId] : [])
    ].map(id => String(id || '').trim()).filter(Boolean));
    const useIndex = idx.__built && idx.schedByClassSlot && idx.schedByClassSlotP8;
    const ck8 = cleanCls + '|' + dayN + '|8';
    const candidateEntries = useIndex
      ? [
          ...(idx.schedByClassSlot[ck8] ? [idx.schedByClassSlot[ck8]] : []),
          ...Object.values(idx.schedByClassSlotP8[ck8] || {})
        ]
      : (state.schedule || []);
    const classCells = candidateEntries.filter(entry =>
      !isPatrolScheduleEntry(entry) &&
      (useIndex || (
        String(entry['班級代碼'] || '').trim() === cleanCls &&
        parseInt(entry['星期'], 10) === dayN &&
        parseInt(entry['節次'], 10) === perN
      )) &&
      !excludedIds.has(String(entry['課表ID'] || '').trim())
    );
    const overlap = classCells.find(entry => !isAlternateWeekPair(targetSlot, entry));
    if (overlap) {
      conflicts.push({
        hard: true,
        kind: 'classPeriodEight',
        msg: `班級${classCode} 星期${['','一','二','三','四','五'][dayN]}第8節已有${String(overlap['課堂屬性'] || '一般')}課程「${String(overlap['科目代碼'] || '')}」，不可再排入重疊課程`
      });
    }
  }

  // 1. 教師衝突（硬）
  // 支援多教師：teacherCode 可為字串、字串陣列或教員物件陣列，逐一檢查每位
  let teacherRawList;
  if (Array.isArray(teacherCode)) {
    teacherRawList = teacherCode;
  } else if (teacherCode && typeof teacherCode === 'object') {
    teacherRawList = teacherCode;
  } else {
    teacherRawList = [teacherCode];
  }
  const teacherCodesToCheck = [];
  getCellTeacherList({ '教師姓名': teacherRawList }).forEach(t => {
    if (t['教師姓名'] && !teacherCodesToCheck.includes(t['教師姓名'])) teacherCodesToCheck.push(t['教師姓名']);
  });
  if (teacherCode && typeof teacherCode === 'string' && !teacherCodesToCheck.includes(teacherCode)) {
    teacherCodesToCheck.push(teacherCode);
  }

  const isMultiAssign = teacherCodesToCheck.length > 1; // 多師指派：第2、3位視為協同教師
  teacherCodesToCheck.forEach((checkTC, tcIdx) => {
    const teacherCode = String(checkTC || '').trim();
    const isCoTeacher = isMultiAssign && tcIdx > 0; // 協同教師（非首位）允許同節跨班
    if (!teacherCode) return;
    const tk = teacherCode+'|'+dayN+'|'+perN;
    const tCells = idx.schedByTeacherSlot[tk] || [];
    const exClsList = Array.isArray(excludeClassCode)
      ? excludeClassCode.map(c => String(c||'').trim()).filter(Boolean)
      : (excludeClassCode ? [String(excludeClassCode||'').trim()] : []);

    const conflict = tCells.find(c => {
      const cCls = String(c['班級代碼']||'').trim();
      if (exClsList.includes(cCls)) return false;
      if (perN === 8) {
        if (cCls === String(classCode||'').trim()) return false;
        if (isAlternateWeekPair(targetSlot, c)) return false;
      }
      return true;
    });
    if (conflict) {
      const teacherNM = idx.teacherByCode[teacherCode] ? ((idx.teacherByCode[teacherCode] ? (idx.teacherByCode[teacherCode]['教師姓名'] || idx.teacherByCode[teacherCode]['姓名']) : teacherCode) || teacherCode) : teacherCode;
      const clsNM = conflict['班級代碼'] && idx.classByCode[conflict['班級代碼']] ? (idx.classByCode[conflict['班級代碼']]['班級名稱'] || conflict['班級代碼']) : conflict['班級代碼'];
      const conflictSub = String(conflict['科目代碼']||'');
      conflicts.push({
        hard: !isCoTeacher, kind:'teacher',
        msg:`【${teacherNM}】在 星期${['','一','二','三','四','五'][dayN]}第${perN}節 已排「${clsNM}」上「${conflictSub}」課` + (isCoTeacher ? '（協同教師跨班，可強制）' : '')
      });
    }

    if (idx.blockSet.has(tk)) {
      const teacherNM = idx.teacherByCode[teacherCode] ? ((idx.teacherByCode[teacherCode] ? (idx.teacherByCode[teacherCode]['教師姓名'] || idx.teacherByCode[teacherCode]['姓名']) : teacherCode) || teacherCode) : teacherCode;
      conflicts.push({ hard:true, kind:'block', msg:`【${teacherNM}】此節已設定為不排課時段` });
    }
  });

  // 2. 科目同時最多班數
  if (subjectCode) {
    const cleanSub = String(subjectCode).trim();
    const subj = idx.subjectByCode[cleanSub] || idx.subjectByCode[subjectCode];
    const maxC = subj ? parseInt(subj['同時最多班數']||'0', 10) : 0;
    if (maxC > 0 && !isVirtualClassCode(classCode)) {
      const weekKey = perN === 8 ? String(targetAttr || '').trim() : '';
      const sk = cleanSub+'|'+dayN+'|'+perN;
      const skP8 = cleanSub+'|'+dayN+'|8|'+weekKey;
      let cnt = perN === 8 && weekKey && idx.schedBySubjectSlotP8
        ? (idx.schedBySubjectSlotP8[skP8] || 0)
        : (idx.schedBySubjectSlot[sk] || 0);
      if (excludeClassCode) {
        const exList = Array.isArray(excludeClassCode)
          ? excludeClassCode.map(c => String(c||'').trim()).filter(Boolean)
          : [String(excludeClassCode||'').trim()];
        exList.forEach(exC => {
          const ck = exC + '|' + dayN + '|' + perN;
          const existing = perN === 8 && weekKey && idx.schedByClassSlotP8
            ? (idx.schedByClassSlotP8[exC + '|' + dayN + '|8'] || {})[weekKey]
            : idx.schedByClassSlot[ck];
          if (existing && String(existing['科目代碼']).trim() === cleanSub) {
            cnt--;
          }
        });
      }
      if (cnt >= maxC) {
        conflicts.push({
          hard: true,
          kind: 'maxConcurrent',
          msg: `【${cleanSub}】在 星期${['','一','二','三','四','五'][dayN]}第${perN}節 已有 ${cnt} 班上課，已達到同時最多 ${maxC} 班上限！`
        });
      }
    }

    // 專科教室容量屬於可人工確認的警告，不應等到綁班整批寫入才回溯。
    const roomCode = String(subj?.['所屬教室代碼'] || '').trim();
    const room = roomCode ? idx.roomByCode?.[roomCode] : null;
    if (roomCode && room) {
      const capacity = parseInt(room['容量'] || '1', 10) || 1;
      const excludedIds = new Set((excludeInfo?.excludeIds || [])
        .map(id => String(id || '').trim()).filter(Boolean));
      const excludedClasses = new Set((Array.isArray(excludeClassCode)
        ? excludeClassCode
        : (excludeClassCode ? [excludeClassCode] : []))
        .map(code => String(code || '').trim()).filter(Boolean));
      const roomCells = (idx.schedByRoomSlot?.[roomCode + '|' + dayN + '|' + perN] || []).filter(cell => {
        if (excludedIds.has(String(cell['課表ID'] || '').trim())) return false;
        if (excludedClasses.has(String(cell['班級代碼'] || '').trim())) return false;
        return !(perN === 8 && isAlternateWeekPair(targetSlot, cell));
      });
      if (roomCells.length >= capacity) {
        conflicts.push({
          hard: true,
          kind: 'roomCapacity',
          msg: `教室${roomCode}在星期${['','一','二','三','四','五'][dayN]}第${perN}節已有 ${roomCells.length} 班，容量上限 ${capacity} 班`
        });
      }
    }

    // 綁班群組衝突檢查：同群組其他班級此格已被佔用別的科目
    if (classCode) {
      const bindGroups = idx.bindBySubject[subjectCode] || [];
      bindGroups.forEach(g => {
        const clsList = getConfiguredBindClasses(g, subjectCode);
        if (clsList.length < 2 || !clsList.includes(String(classCode))) return;

        const excludeSet = new Set(
          Array.isArray(excludeClassCode)
            ? excludeClassCode.map(c => String(c||'').trim())
            : (excludeClassCode ? [String(excludeClassCode||'').trim()] : [])
        );

        clsList.forEach(c => {
          if (String(c) === String(classCode) || excludeSet.has(String(c))) return;

          const ck = c + '|' + dayN + '|' + perN;
          const weekKey = perN === 8 ? String(targetAttr || '').trim() : '';
          const existing = perN === 8 && weekKey && idx.schedByClassSlotP8
            ? (idx.schedByClassSlotP8[c + '|' + dayN + '|8'] || {})[weekKey]
            : idx.schedByClassSlot[ck];

          // 1. 班級衝突：只有當同群組班級此格已有「其他科目」時才視為衝堂
          if (existing && String(existing['科目代碼']) !== String(subjectCode)) {
            conflicts.push({
              hard: true, kind: 'bindConflict',
              msg: '綁班群組「' + (g['群組名稱'] || g['群組ID']) + '」中班級 ' + c + ' 此格已有「' + existing['科目代碼'] + '」課程'
            });
          }

          // 2. 教師衝突：檢查該班專屬教師在此時段是否有別的課程或不排課
          const cTcValue = getTeacherForClassSubject(c, subjectCode, null);
          const cTeacherCodes = getCellTeacherCodes({ '教師姓名': cTcValue });
          cTeacherCodes.forEach(cTc => {
            const tk = cTc + '|' + dayN + '|' + perN;
            const teacherInfo = idx.teacherByCode[cTc];
            const btcNM = teacherInfo ? (teacherInfo['教師姓名'] || teacherInfo['姓名'] || cTc) : cTc;
            if (idx.blockSet.has(tk)) {
              conflicts.push({
                hard: true, kind: 'bindTeacherBlock',
                msg: '綁班群組班級 ' + c + ' 之任課教師【' + btcNM + '】此時段設定不排課'
              });
            }
            const tCells = idx.schedByTeacherSlot[tk] || [];
            const tConflict = tCells.find(cell =>
              !clsList.includes(String(cell['班級代碼'])) && !isAlternateWeekPair(targetSlot, cell)
            );
            if (tConflict) {
              const tClsNM = tConflict['班級代碼'] && idx.classByCode[tConflict['班級代碼']] ? (idx.classByCode[tConflict['班級代碼']]['班級名稱'] || tConflict['班級代碼']) : tConflict['班級代碼'];
              conflicts.push({
                hard: true, kind: 'bindTeacherConflict',
                msg: '綁班群組班級 ' + c + ' 之任課教師【' + btcNM + '】此時段已在「' + tClsNM + '」上課'
              });
            }
            // 3. 綁班教師連堂限制：檢查每位主／協同教師是否超過連堂上限。
            const cMaxConsec = teacherInfo ? parseInt(teacherInfo['最大連堂節數'] || '2', 10) : 2;
            const cConsec = countConsecutive(dayN, perN, cTc, c, excludeInfo);
            if (cConsec > cMaxConsec) {
              conflicts.push({
                hard: true, kind: 'bindTeacherConsecutive',
                msg: '綁班群組班級 ' + c + ' 之任課教師（' + btcNM + '）在 星期' + ['','一','二','三','四','五'][dayN] + ' 連堂 ' + cConsec + ' 節，超過該師上限 ' + cMaxConsec + ' 節'
              });
            }
          });
        });
      });
    }

    // 科目時段規則（硬，含年級限制）
    const clsInfo = classCode ? idx.classByCode[classCode] : null;
    const clsGrade = clsInfo ? String(clsInfo['年級'] || '').trim() : (classCode ? String(classCode).charAt(0) : '');

    // 篩選適用於此年級的規則
    const activeRules = (idx.rulesBySubjectSlot[subjectCode+'|'+dayN+'|'+perN] || []).filter(r => {
      return ruleAppliesToClass(r, classCode, clsGrade);
    });

    // 禁排檢查
    if (activeRules.some(r => r['規則類型'] === '禁排')) {
      conflicts.push({
        hard:true, kind:'banned', msg:`${subjectCode} ${clsGrade?clsGrade+'年級':''} 禁排此時段`
      });
    }

    // 必排檢查：此科目有必排規則時，只能排在必排時段（可多選）
    const candidateRulesForSub = (idx.__built && idx.rulesBySubject)
      ? (idx.rulesBySubject[String(subjectCode || '').trim()] || [])
      : (state.subjectRules || []);
    const allRulesForSub = candidateRulesForSub.filter(r => {
      return ruleAppliesToSubjectAndClass(r, subjectCode, classCode, clsGrade);
    });
    const mustRulesForSub = allRulesForSub.filter(r => r['規則類型'] === '必排');
    if (mustRulesForSub.length > 0) {
      const mustSlotList = [];
      mustRulesForSub.forEach(r => {
        getRuleDaysPeriods(r).forEach(({day, period}) => {
          mustSlotList.push({day, period});
        });
      });
      const isMustSlot = mustSlotList.some(s => s.day === dayN && s.period === perN);
      if (!isMustSlot) {
        const compressed = compressSlots(mustSlotList).join('、');
        conflicts.push({
          hard:true, kind:'mustPlace', msg:`${subjectCode} 必須排在 ${compressed}`
        });
      }
    }

    // 手動排課的同班同科同日第二節改為提醒，保留連排或特殊課程的彈性。
    const canUseCSDIdx = idx.__built && idx.schedByClassSubjectDay;
    const csdKey = String(classCode || '').trim() + '|' + String(subjectCode || '').trim() + '|' + dayN;
    const sameDayCandidates = canUseCSDIdx
      ? (idx.schedByClassSubjectDay[csdKey] || [])
      : (state.schedule || []);
    const sameDaySubjectEntries = sameDayCandidates.filter(entry => {
      if (!entry || isPatrolScheduleEntry(entry)) return false;
      if (!canUseCSDIdx) {
        if (String(entry['班級代碼'] || '').trim() !== String(classCode || '').trim()) return false;
        if (String(entry['科目代碼'] || '').trim() !== String(subjectCode || '').trim()) return false;
        if (parseInt(entry['星期'], 10) !== dayN) return false;
      }
      if (parseInt(entry['節次'], 10) === perN) return false;
      if (excludeInfo && parseInt(entry['星期'], 10) === parseInt(excludeInfo.srcDay, 10) && parseInt(entry['節次'], 10) === parseInt(excludeInfo.srcPer, 10)) return false;
      if (isAlternateWeekPair(targetSlot, entry)) return false;
      return true;
    });
    if (sameDaySubjectEntries.length > 0) {
      const actualPeriods = new Set(sameDaySubjectEntries.map(entry => parseInt(entry['節次'], 10)).concat(perN));
      const mandatoryDaySlots = getMandatoryRuleDaySlots(subjectCode, classCode, dayN);
      const mandatoryPeriods = new Set(mandatoryDaySlots.map(slot => Number(slot.period)));
      const isConfiguredConsecutive = mandatoryDaySlots.length > 1 &&
        actualPeriods.size === mandatoryPeriods.size &&
        [...actualPeriods].every(period => mandatoryPeriods.has(period));
      if (!isConfiguredConsecutive) {
        const existingPeriods = [...new Set(sameDaySubjectEntries.map(entry => parseInt(entry['節次'], 10)))].sort((left, right) => left - right);
        conflicts.push({
          hard: false,
          kind: 'sameClassSubjectDay',
          msg: `提醒：${subjectCode} 在同一班級星期${['','一','二','三','四','五'][dayN]}已有第${existingPeriods.join('、')}節，現在再排第${perN}節；若為連排或特殊課程可以繼續排入`
        });
      }
    }

    // 科目關係是軟限制：只提醒，不阻擋合法排課。
    conflicts.push(...getSubjectRelationWarnings(dayN, subjectCode, classCode, state.schedule, excludeInfo));
  }

  // 3. 連堂軟警告（精確計算調動後的實際連堂）
  if (teacherCode) {
    const consec = countConsecutive(dayN, perN, teacherCode, classCode, excludeInfo);
    const teacher = idx.teacherByCode[teacherCode];
    const teacherName = teacher ? String(teacher['姓名'] || teacher['教師姓名'] || teacherCode) : teacherCode;
    const maxConsec = teacher ? parseInt(teacher['最大連堂節數']||'2',10) : 2;
    if (consec > maxConsec) conflicts.push({
      hard:true, kind:'consecutive',
      msg:`教師【${teacherName}】在 星期${['','一','二','三','四','五'][dayN]} 連堂 ${consec} 節，超過上限 ${maxConsec} 節`
    });
  }

  // 4. 教師互斥規則（硬 - 精確比對單/多師與代碼/姓名）
  if (teacherCode) {
    const myTCs = resolveTeacherCodes(teacherCode);
    if (idx.__built && idx.exclusiveRulesByTeacher) {
      myTCs.forEach(myTC => {
        (idx.exclusiveRulesByTeacher[myTC] || []).forEach(({ rule: r, peerCodes }) => {
          peerCodes.forEach(peerCode => {
            const pk = peerCode + '|' + dayN + '|' + perN;
            const peerCells = (idx.schedByTeacherSlot && idx.schedByTeacherSlot[pk]) || [];
            if (peerCells.some(cell => !isAlternateWeekPair(targetSlot, cell))) {
              const peerNM = idx.teacherByCode[peerCode] ? ((idx.teacherByCode[peerCode] ? (idx.teacherByCode[peerCode]['教師姓名'] || idx.teacherByCode[peerCode]['姓名']) : peerCode) || peerCode) : peerCode;
              const mainNM = idx.teacherByCode[myTC] ? ((idx.teacherByCode[myTC] ? (idx.teacherByCode[myTC]['教師姓名'] || idx.teacherByCode[myTC]['姓名']) : myTC) || myTC) : myTC;
              conflicts.push({
                hard: true, kind: 'exclusive',
                msg: '⛔ 互斥衝突：【' + mainNM + '】與【' + peerNM + '】不得同節排課' + (r['備註'] ? '（' + r['備註'] + '）' : '')
              });
            }
          });
        });
      });
    } else {
      const exclusiveRules = state.teacherExclusives || [];
      myTCs.forEach(myTC => {
        exclusiveRules.forEach(r => {
          const peersA = resolveTeacherCodes(r['教師A']);
          const peersB = resolveTeacherCodes(r['教師B']);
          if (!peersA.length || !peersB.length) return;
          let peerCodes = null;
          if (peersA.includes(myTC)) peerCodes = peersB;
          else if (peersB.includes(myTC)) peerCodes = peersA;
          if (!peerCodes || !peerCodes.length) return;

          // 檢查該時段是否有任意 peerCodes 的課
          peerCodes.forEach(peerCode => {
            const pk = peerCode + '|' + dayN + '|' + perN;
            const peerCells = (idx.schedByTeacherSlot && idx.schedByTeacherSlot[pk]) || [];
            if (peerCells.some(cell => !isAlternateWeekPair(targetSlot, cell))) {
              const peerNM = idx.teacherByCode[peerCode] ? ((idx.teacherByCode[peerCode] ? (idx.teacherByCode[peerCode]['教師姓名'] || idx.teacherByCode[peerCode]['姓名']) : peerCode) || peerCode) : peerCode;
              const mainNM = idx.teacherByCode[myTC] ? ((idx.teacherByCode[myTC] ? (idx.teacherByCode[myTC]['教師姓名'] || idx.teacherByCode[myTC]['姓名']) : myTC) || myTC) : myTC;
              conflicts.push({
                hard: true, kind: 'exclusive',
                msg: '⛔ 互斥衝突：【' + mainNM + '】與【' + peerNM + '】不得同節排課' + (r['備註'] ? '（' + r['備註'] + '）' : '')
              });
            }
          });
        });
      });
    }
  }

  return conflicts;
}

function countConsecutive(day, period, teacherCode, classCode, excludeInfo) {
  if (!teacherCode) return 1;
  const dayN = parseInt(day, 10);
  const targetP = parseInt(period, 10);
  if (isManualOnlyPeriod(targetP)) return 1;

  const activePeriods = new Set();

  for (let p = 1; p <= 8; p++) {
    const tk = teacherCode + '|' + dayN + '|' + p;
    if (idx.blockSet && idx.blockSet.has(tk)) continue;

    const cells = idx.schedByTeacherSlot[tk] || [];
    const validCells = cells.filter(c => {
      const sub  = String(c['科目代碼'] || '').trim();
      const attr = String(c['課堂屬性'] || '').trim();
      return sub !== '不排課' && attr !== '不排課';
    });
    if (validCells.length > 0) {
      activePeriods.add(p);
    }
  }

  // 若提供 excludeInfo (例如從 srcDay, srcPer 搬移過來)，自當天原本時段中移除該課
  if (excludeInfo) {
    const exDay = parseInt(excludeInfo.srcDay || excludeInfo.day || '0', 10);
    const exPer = parseInt(excludeInfo.srcPer || excludeInfo.per || '0', 10);
    if (exDay === dayN && exPer > 0) {
      activePeriods.delete(exPer);
    }
  }

  // 加入模擬投放目標時段
  activePeriods.add(targetP);

  // 計算包含 targetP 的連續節數
  let before = 0;
  let p = targetP - 1;
  while (p >= 1 && activePeriods.has(p)) {
    before++;
    p--;
  }

  let after = 0;
  p = targetP + 1;
  while (p <= 8 && activePeriods.has(p)) {
    after++;
    p++;
  }

  const streakAtTarget = before + after + 1;

  // 計算當天最大連堂節數
  let maxStreakOnDay = 0;
  let curStreak = 0;
  for (let p = 1; p <= 8; p++) {
    if (activePeriods.has(p)) {
      curStreak++;
      maxStreakOnDay = Math.max(maxStreakOnDay, curStreak);
    } else {
      curStreak = 0;
    }
  }

  return Math.max(streakAtTarget, maxStreakOnDay);
}

// ============================================================
// 🗑 清除排課
// ============================================================
function keepLockedScheduleEntries(schedule) {
  const source = Array.isArray(schedule) ? schedule : [];
  const lockedConsecutiveKeys = buildLockedConsecutiveKeySet(source);
  return source.filter(entry => {
    if (isPatrolScheduleEntry(entry)) return false;
    if (isManualOnlyPeriod(entry['節次']) && String(entry['課堂屬性'] || '').trim() !== '抽離') return true;
    if (String(entry['是否鎖定'] || '').toUpperCase() === 'TRUE') return true;
    const key = getLockedConsecutiveEntryKey(entry);
    return !!key && lockedConsecutiveKeys.has(key);
  });
}

function buildLockedConsecutiveKeySet(schedule) {
  const source = Array.isArray(schedule) ? schedule : [];
  const groups = new Map();
  source.forEach(entry => {
    if (!entry || isPatrolScheduleEntry(entry)) return;
    const classCode = String(entry['班級代碼'] || '').trim();
    const subjectCode = String(entry['科目代碼'] || '').trim();
    const day = parseInt(entry['星期'], 10);
    const period = parseInt(entry['節次'], 10);
    if (!classCode || !subjectCode || !Number.isFinite(day) || !Number.isFinite(period)) return;
    const groupKey = classCode + '|' + subjectCode + '|' + day;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push({ period, locked: String(entry['是否鎖定'] || '').toUpperCase() === 'TRUE' });
  });
  const lockedKeys = new Set();
  groups.forEach((items, groupKey) => {
    if (items.length < 2) return;
    const periods = new Set(items.map(item => item.period));
    items.forEach(item => {
      if (!item.locked) return;
      if (!periods.has(item.period - 1) && !periods.has(item.period + 1)) return;
      lockedKeys.add(groupKey + '|' + item.period);
      for (let p = item.period - 1; periods.has(p); p--) lockedKeys.add(groupKey + '|' + p);
      for (let p = item.period + 1; periods.has(p); p++) lockedKeys.add(groupKey + '|' + p);
    });
  });
  return lockedKeys;
}

function getLockedConsecutiveEntryKey(entry) {
  if (!entry || isPatrolScheduleEntry(entry)) return '';
  const classCode = String(entry['班級代碼'] || '').trim();
  const subjectCode = String(entry['科目代碼'] || '').trim();
  const day = parseInt(entry['星期'], 10);
  const period = parseInt(entry['節次'], 10);
  if (!classCode || !subjectCode || !Number.isFinite(day) || !Number.isFinite(period)) return '';
  return classCode + '|' + subjectCode + '|' + day + '|' + period;
}

// 音樂班可有連排課程；鎖住其中一格時，整段相鄰同科課程都視為鎖課區塊。
function isLockedConsecutiveScheduleEntry(entry, schedule) {
  const source = Array.isArray(schedule)
    ? schedule
    : (typeof state !== 'undefined' && Array.isArray(state.schedule) ? state.schedule : []);
  if (!entry || isPatrolScheduleEntry(entry)) return false;
  const classCode = String(entry['班級代碼'] || '').trim();
  const subjectCode = String(entry['科目代碼'] || '').trim();
  const day = parseInt(entry['星期'], 10);
  const period = parseInt(entry['節次'], 10);
  if (!classCode || !subjectCode || !Number.isFinite(day) || !Number.isFinite(period)) return false;

  const peers = source.filter(candidate =>
    candidate && !isPatrolScheduleEntry(candidate) &&
    String(candidate['班級代碼'] || '').trim() === classCode &&
    String(candidate['科目代碼'] || '').trim() === subjectCode &&
    parseInt(candidate['星期'], 10) === day &&
    Number.isFinite(parseInt(candidate['節次'], 10))
  );
  if (peers.length < 2) return false;
  const periods = new Set(peers.map(candidate => parseInt(candidate['節次'], 10)));
  return peers.some(candidate => {
    if (String(candidate['是否鎖定'] || '').toUpperCase() !== 'TRUE') return false;
    const lockedPeriod = parseInt(candidate['節次'], 10);
    const start = Math.min(lockedPeriod, period);
    const end = Math.max(lockedPeriod, period);
    if (start === end) return periods.has(period - 1) || periods.has(period + 1);
    for (let current = start; current <= end; current++) {
      if (!periods.has(current)) return false;
    }
    return true;
  });
}

function isMandatoryScheduleEntryForClear(entry) {
  const subjectCode = String(entry?.['科目代碼'] || '').trim();
  const classCode = String(entry?.['班級代碼'] || '').trim();
  const classInfo = idx.classByCode?.[classCode];
  const grade = String(classInfo?.['年級'] || classCode.charAt(0)).trim();
  const rules = (idx.rulesBySubject && idx.__built)
    ? (idx.rulesBySubject[subjectCode] || [])
    : (state.subjectRules || []);
  return !!subjectCode && !!classCode && rules.some(rule =>
    String(rule['規則類型'] || '').trim() === '必排' &&
    getRuleSubjectCodes(rule).includes(subjectCode) &&
    ruleAppliesToClass(rule, classCode, grade)
  );
}

// 第二輪對應目前自動排課的第二階段：一般課程，不包含第一階段的必排與綁班。
function isSecondRoundScheduleEntry(entry) {
  return !isMandatoryScheduleEntryForClear(entry) && !isBindScheduleEntry(entry);
}

function isClearScopeTarget(entry, scope, lockedConsecutiveKeys = null) {
  if (!entry || isClearFrozenScheduleEntry(entry)) return false;
  if (lockedConsecutiveKeys) {
    const key = getLockedConsecutiveEntryKey(entry);
    if (key && lockedConsecutiveKeys.has(key)) return false;
  } else if (isLockedConsecutiveScheduleEntry(entry)) {
    return false;
  }
  if (scope === 'period-8') return parseInt(entry['節次'], 10) === 8;
  if (scope === 'second-round') {
    const period = parseInt(entry['節次'], 10);
    if (!Number.isFinite(period) || period < 1 || period > 7) return false;
    return isSecondRoundScheduleEntry(entry);
  }
  return true;
}

function getClearedSchedule(scope) {
  if (scope === 'all') return keepLockedScheduleEntries(state.schedule);
  const source = Array.isArray(state.schedule) ? state.schedule : [];
  const lockedConsecutiveKeys = buildLockedConsecutiveKeySet(source);
  return source.filter(entry => {
    if (String(entry['是否鎖定'] || '').toUpperCase() === 'TRUE') return true;
    const key = getLockedConsecutiveEntryKey(entry);
    if (key && lockedConsecutiveKeys.has(key)) return true;
    return !isClearScopeTarget(entry, scope, lockedConsecutiveKeys);
  });
}
