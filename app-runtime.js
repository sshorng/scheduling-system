/* 執行期整合層：集中索引、行內編輯與頁籤按需渲染。 */
(function () {
  'use strict';

  const runtimeParseWeeklyValue = (value, fallback = 0) => {
    if (typeof parseWeeklyValue === 'function') return parseWeeklyValue(value, fallback);
    const raw = String(value ?? '').trim().replace(',', '.');
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const runtimeGetAssignmentWeeklyValue = (assignment, subject = null, fallback = 3) => {
    if (typeof getAssignmentWeeklyValue === 'function') return getAssignmentWeeklyValue(assignment, subject, fallback);
    const custom = runtimeParseWeeklyValue(assignment?.['每週節數'], 0);
    if (custom > 0) return custom;
    const subjectData = subject || idx?.subjectByCode?.[String(assignment?.['科目代碼'] || '').trim()];
    const subjectWeekly = runtimeParseWeeklyValue(subjectData?.['每週節數'], fallback);
    return subjectWeekly > 0 ? subjectWeekly : fallback;
  };
  const runtimeIsValidWeeklyInput = value => {
    if (typeof isValidWeeklyInput === 'function') return isValidWeeklyInput(value);
    const raw = String(value ?? '').trim().replace(',', '.');
    if (!raw) return true;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && (Math.abs(parsed - 0.5) < 0.000001 || (Number.isInteger(parsed) && parsed >= 1 && parsed <= 20));
  };

  const runtimeAssignmentGroupKey = assignment => typeof getAssignmentGroupKey === 'function'
    ? getAssignmentGroupKey(assignment)
    : String(assignment?.['班級代碼'] || '').trim() + '|' +
      String(assignment?.['科目代碼'] || '').trim() + '|' +
      String(assignment?.['備註'] || '').trim();
  const runtimeAssignmentGroupLabel = assignment => String(assignment?.['備註'] || '').trim();
  const runtimeAssignmentTeacherSignature = assignment => {
    const codes = typeof getCellTeacherCodes === 'function'
      ? getCellTeacherCodes(assignment)
      : String(assignment?.['教師姓名'] || '').split(/[,，、;；]/).map(code => code.trim()).filter(Boolean);
    return [...new Set(codes)].sort().join('|');
  };
  const runtimeScheduleEntryMatchesAssignment = (entry, assignment) => {
    if (typeof scheduleEntryMatchesAssignment === 'function') return scheduleEntryMatchesAssignment(entry, assignment);
    const storedNote = String(entry?.['備註'] || '').trim();
    return String(entry?.['班級代碼'] || '').trim() === String(assignment?.['班級代碼'] || '').trim() &&
      String(entry?.['科目代碼'] || '').trim() === String(assignment?.['科目代碼'] || '').trim() &&
      (!storedNote || storedNote === String(assignment?.['備註'] || '').trim()) &&
      runtimeAssignmentTeacherSignature(entry) === runtimeAssignmentTeacherSignature(assignment);
  };
  const runtimeAssignmentGroupKeysForScheduleEntry = (entry, assignments = state.assignments) => {
    if (typeof getAssignmentGroupKeysForScheduleEntry === 'function') {
      return getAssignmentGroupKeysForScheduleEntry(entry, assignments);
    }
    const classCode = String(entry?.['班級代碼'] || '').trim();
    const subjectCode = String(entry?.['科目代碼'] || '').trim();
    const candidates = (Array.isArray(assignments) ? assignments : []).filter(assignment =>
      String(assignment['班級代碼'] || '').trim() === classCode &&
      String(assignment['科目代碼'] || '').trim() === subjectCode
    );
    const exact = candidates.filter(assignment => runtimeScheduleEntryMatchesAssignment(entry, assignment));
    if (exact.length > 0) return [...new Set(exact.map(runtimeAssignmentGroupKey).filter(Boolean))];
    return candidates.length === 1 ? [runtimeAssignmentGroupKey(candidates[0])] : [];
  };
  const runtimeAssignmentGroupConflict = (candidate, assignments = state.assignments) => {
    return null;
  };
  const runtimeAssignmentGroupWarnings = assignments => {
    return [];
  };

  const isHelperSubjectCodeForCount = value => /輔$/i.test(String(value || '').trim());

  const baseBuildIndex = buildIndex;
  buildIndex = function () {
    const groupKeyOf = assignment => typeof getAssignmentGroupKey === 'function'
      ? getAssignmentGroupKey(assignment)
      : String(assignment?.['班級代碼'] || '').trim() + '|' +
        String(assignment?.['科目代碼'] || '').trim() + '|' +
        String(assignment?.['備註'] || '').trim();
    const scheduleMatchesAssignment = (entry, assignment) => {
      if (typeof scheduleEntryMatchesAssignment === 'function') return scheduleEntryMatchesAssignment(entry, assignment);
      if (String(entry?.['班級代碼'] || '').trim() !== String(assignment?.['班級代碼'] || '').trim() ||
          String(entry?.['科目代碼'] || '').trim() !== String(assignment?.['科目代碼'] || '').trim()) return false;
      const storedNote = String(entry?.['備註'] || '').trim();
      if (storedNote && storedNote !== String(assignment?.['備註'] || '').trim()) return false;
      const entryCodes = typeof getCellTeacherCodes === 'function'
        ? getCellTeacherCodes(entry).map(code => String(code || '').trim()).filter(Boolean)
        : String(entry?.['教師姓名'] || '').split(/[,，、;；]/).map(code => code.trim()).filter(Boolean);
      const assignmentCodes = typeof getCellTeacherCodes === 'function'
        ? getCellTeacherCodes(assignment).map(code => String(code || '').trim()).filter(Boolean)
        : String(assignment?.['教師姓名'] || '').split(/[,，、;；]/).map(code => code.trim()).filter(Boolean);
      return assignmentCodes.length === 0 || assignmentCodes.some(code => entryCodes.includes(code));
    };
    const groupKeysForEntry = (entry, assignments) => {
      const explicitGroupKey = String(entry?.__assignmentGroupKey || '').trim();
      if (explicitGroupKey) return [explicitGroupKey];
      const classCode = String(entry?.['班級代碼'] || '').trim();
      const subjectCode = String(entry?.['科目代碼'] || '').trim();
      const candidates = (assignments || []).filter(assignment =>
        String(assignment['班級代碼'] || '').trim() === classCode &&
        String(assignment['科目代碼'] || '').trim() === subjectCode
      );
      const exact = candidates.filter(assignment => scheduleMatchesAssignment(entry, assignment));
      if (exact.length > 0) return [...new Set(exact.map(groupKeyOf).filter(Boolean))];
      return candidates.length === 1 ? [groupKeyOf(candidates[0])] : [];
    };
    const groupWarningsOf = assignments => {
      return [];
    };
    baseBuildIndex();
    idx.homeroomTeacherByClass = Object.create(null);
    idx.assignmentsByTeacher = Object.create(null);
    idx.assignmentsByClass = Object.create(null);
    idx.assignmentsByClassSubject = Object.create(null);
    idx.assignmentsByGroupKey = Object.create(null);
    idx.scheduleCountByAssignmentGroup = Object.create(null);
    idx.assignmentGroupWarnings = [];
    idx.scheduleCountByTeacher = Object.create(null);
    idx.scheduleCountByClass = Object.create(null);
    idx.scheduleCountByTeacherClassSubject = Object.create(null);
    idx.scheduleCountByClassSubject = Object.create(null);
    idx.assignedWeeklyByTeacher = Object.create(null);
    idx.requiredWeeklyByTeacherClassSubject = Object.create(null);
    idx.scheduledAssignedByTeacher = Object.create(null);
    const weeklyUnits = Object.create(null);
    const scheduledSlotsByTeacher = Object.create(null);
    const scheduledUnitsByTeacherSlot = Object.create(null);
    const scheduledCohortByTeacherSubjectClass = Object.create(null);
    const scheduledCohortSlots = Object.create(null);
    state.schedule.forEach(item => {
      if (typeof isPatrolScheduleEntry === 'function' && isPatrolScheduleEntry(item)) return;
      const subjectCode = String(item['科目代碼'] || '').trim();
      const classCode = String(item['班級代碼'] || '').trim();
      const day = parseInt(item['星期'], 10);
      const period = parseInt(item['節次'], 10);
      if (!subjectCode || !classCode || !Number.isFinite(day) || !Number.isFinite(period)) return;
      const teacherCodes = getCellTeacherCodes(item);
      const attr = period === 8 ? String(item['課堂屬性'] || '一般').trim() : '一般';
      teacherCodes.forEach(teacherCode => {
        const key = teacherCode + '|' + subjectCode + '|' + day + '|' + period + '|' + attr;
        (scheduledCohortSlots[key] ||= new Set()).add(classCode);
      });
    });
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
    state.teachers.forEach(teacher => {
      const classCode = String(getTeacherHomeroom(teacher) || '');
      if (classCode && classCode !== 'TRUE') idx.homeroomTeacherByClass[classCode] = teacher;
    });
    state.assignments.forEach(assignment => {
      let teacherCodes = typeof getCellTeacherCodes === 'function'
        ? getCellTeacherCodes(assignment).map(code => String(code || '').trim()).filter(Boolean)
        : String(assignment['教師姓名'] || '').split(/[,，、;；]/).map(code => code.trim()).filter(Boolean);
      if (teacherCodes.length === 0 && String(assignment['教師姓名'] || '').trim()) {
        teacherCodes = String(assignment['教師姓名']).split(/[,，、;；]/).map(code => code.trim()).filter(Boolean);
      }
      const classCode = String(assignment['班級代碼'] || '');
      const subjectCode = String(assignment['科目代碼'] || '');
      if (classCode) (idx.assignmentsByClass[classCode] ||= []).push(assignment);
      const groupKey = groupKeyOf(assignment);
      if (classCode && subjectCode) (idx.assignmentsByClassSubject[classCode + '|' + subjectCode] ||= []).push(assignment);
      if (groupKey) (idx.assignmentsByGroupKey[groupKey] ||= []).push(assignment);
      teacherCodes.forEach(teacherCode => {
        (idx.assignmentsByTeacher[teacherCode] ||= []).push(assignment);
        if (!classCode || !subjectCode) return;
        const subject = idx.subjectByCode[subjectCode];
        const weekly = runtimeGetAssignmentWeeklyValue(assignment, subject, 3);
        const key = teacherCode+'|'+classCode+'|'+subjectCode;
        idx.requiredWeeklyByTeacherClassSubject[key] = (idx.requiredWeeklyByTeacherClassSubject[key] || 0) + weekly;
        const bindClasses = typeof getBindGroupClasses === 'function' ? getBindGroupClasses(subjectCode, classCode) : null;
        const scheduledCohort = scheduledCohortByTeacherSubjectClass[teacherCode + '|' + subjectCode + '|' + classCode];
        const unitKey = bindClasses && bindClasses.length > 1
          ? teacherCode + '|bind|' + subjectCode + '|' + [...bindClasses].sort().join(',')
          : scheduledCohort
            ? teacherCode + '|scheduled-cohort|' + subjectCode + '|' + scheduledCohort
          : teacherCode + '|class|' + classCode + '|' + subjectCode;
        weeklyUnits[unitKey] = Math.max(weeklyUnits[unitKey] || 0, weekly);
      });
    });
    idx.assignmentGroupWarnings = groupWarningsOf(state.assignments);
    Object.entries(weeklyUnits).forEach(([unitKey, weekly]) => {
      const teacherCode = unitKey.split('|')[0];
      idx.assignedWeeklyByTeacher[teacherCode] = (idx.assignedWeeklyByTeacher[teacherCode] || 0) + weekly;
    });
    state.schedule.forEach(item => {
      if (typeof isPatrolScheduleEntry === 'function' && isPatrolScheduleEntry(item)) return;
      const teacherCode = String(item['教師姓名'] || '');
      const classCode = String(item['班級代碼'] || '');
      const subjectCode = String(item['科目代碼'] || '');
      const period = parseInt(item['節次'], 10);
      // 多教師：對「教師代碼」欄解析出的每位教師都計入（含課表統計）
      const teacherCodes = getCellTeacherCodes(item);
      const scheduleUnits = getScheduleWeeklyUnits(item);
      const scheduleAttr = period === 8 ? String(item['課堂屬性'] || '一般').trim() : '一般';
      if (teacherCodes.length > 0) {
        teacherCodes.forEach(tc => {
          idx.scheduleCountByTeacher[tc] = (idx.scheduleCountByTeacher[tc] || 0) + 1;
          if (Number.isFinite(parseInt(item['星期'], 10)) && Number.isFinite(parseInt(item['節次'], 10))) {
             (scheduledSlotsByTeacher[tc] ||= new Set()).add(parseInt(item['星期'], 10) + '|' + parseInt(item['節次'], 10));
            const unitKey = tc + '|' + parseInt(item['星期'], 10) + '|' + parseInt(item['節次'], 10) + '|' + scheduleAttr;
            scheduledUnitsByTeacherSlot[unitKey] = Math.max(scheduledUnitsByTeacherSlot[unitKey] || 0, scheduleUnits);
          }
        });
      } else if (teacherCode) {
        idx.scheduleCountByTeacher[teacherCode] = (idx.scheduleCountByTeacher[teacherCode] || 0) + 1;
        if (Number.isFinite(parseInt(item['星期'], 10)) && Number.isFinite(parseInt(item['節次'], 10))) {
             (scheduledSlotsByTeacher[teacherCode] ||= new Set()).add(parseInt(item['星期'], 10) + '|' + parseInt(item['節次'], 10));
          const unitKey = teacherCode + '|' + parseInt(item['星期'], 10) + '|' + parseInt(item['節次'], 10) + '|' + scheduleAttr;
          scheduledUnitsByTeacherSlot[unitKey] = Math.max(scheduledUnitsByTeacherSlot[unitKey] || 0, scheduleUnits);
        }
      }
       if (classCode) idx.scheduleCountByClass[classCode] = (idx.scheduleCountByClass[classCode] || 0) + scheduleUnits;
      if (classCode && subjectCode) {
        const teacherCodes = getCellTeacherCodes(item);
        const indexedTeacherCodes = teacherCodes.length > 0 ? teacherCodes : (teacherCode ? [teacherCode] : []);
        indexedTeacherCodes.forEach(code => {
          const key = code+'|'+classCode+'|'+subjectCode;
          idx.scheduleCountByTeacherClassSubject[key] = (idx.scheduleCountByTeacherClassSubject[key] || 0) + scheduleUnits;
        });
      }
       if (classCode && subjectCode) {
         const key = classCode+'|'+subjectCode;
         idx.scheduleCountByClassSubject[key] = (idx.scheduleCountByClassSubject[key] || 0) + scheduleUnits;
         groupKeysForEntry(item, state.assignments).forEach(groupKey => {
           idx.scheduleCountByAssignmentGroup[groupKey] = (idx.scheduleCountByAssignmentGroup[groupKey] || 0) + scheduleUnits;
         });
       }
    });
    Object.entries(scheduledUnitsByTeacherSlot).forEach(([key, units]) => {
      const teacherCode = key.split('|')[0];
      idx.scheduledAssignedByTeacher[teacherCode] = (idx.scheduledAssignedByTeacher[teacherCode] || 0) + units;
    });
  };

  classTeacherLabel = function (cls) {
    const teacher = idx.homeroomTeacherByClass?.[String(cls['班級代碼'] || '')];
    return teacher ? String((teacher['教師姓名'] || teacher['姓名']) || '') : '—';
  };

  renderClassConfigList = window.renderClassConfigList = function () {
    const tbody = document.getElementById('class-tbody');
    if (!tbody) return;
    tbody.innerHTML = state.classes.map(c => {
      const code = String(c['班級代碼'] || '');
      const arg = "decodeURIComponent('" + encodeURIComponent(code) + "')";
      const isVirtual = c['是否虛擬班'] === 'TRUE';
      if (String(ui.inlineClassCode || '') === code) {
        return '<tr class="inline-edit-row" data-class-code="' + esc(code) + '">' +
          '<td><b>' + esc(code) + '</b></td>' +
           '<td><input data-class-field="grade" value="' + esc(c['年級'] || '') + '" onkeydown="handleInlineClassKey(event,' + arg + ')"></td>' +
           '<td><input data-class-field="name" value="' + esc(c['班級名稱'] || '') + '" onkeydown="handleInlineClassKey(event,' + arg + ')"></td>' +
           '<td><input data-class-field="bilingual" type="number" min="0" step="1" value="' + esc(c['雙語課堂數'] || '') + '" onkeydown="handleInlineClassKey(event,' + arg + ')"></td>' +
           '<td><label style="display:inline-flex;align-items:center;gap:4px;"><input type="checkbox" data-class-field="virtual"' + (isVirtual ? ' checked' : '') + ' onkeydown="handleInlineClassKey(event,' + arg + ')">虛擬班</label></td>' +
          '<td>' + esc(classTeacherLabel(c)) + '</td>' +
          '<td class="inline-actions"><button class="btn btn-primary btn-xs" onclick="saveInlineClass(' + arg + ')">儲存</button> <button class="btn btn-ghost btn-xs" onclick="cancelInlineClassEdit()">取消</button></td></tr>';
      }
      return '<tr><td>' + esc(code) + '</td>' +
         '<td>' + esc(c['年級'] || '') + '</td>' +
         '<td>' + esc(c['班級名稱'] || '') + (isVirtual ? ' ⚡' : '') + '</td>' +
         '<td>' + esc(c['雙語課堂數'] || '') + '</td>' +
         '<td>' + (isVirtual ? '虛擬班' : '一般班') + '</td>' +
        '<td>' + esc(classTeacherLabel(c)) + '</td>' +
        '<td class="inline-actions"><button class="btn btn-ghost btn-xs" onclick="startInlineClassEdit(' + arg + ')">✏️ 編輯</button> <button class="btn btn-danger btn-xs" onclick="deleteClass(' + arg + ')">🗑 刪除</button></td></tr>';
    }).join('');
  };

  window.startInlineClassEdit = function (code) {
    ui.inlineClassCode = String(code);
    renderClassConfigList();
    document.querySelector('#class-tbody .inline-edit-row input')?.focus();
  };
  window.cancelInlineClassEdit = function () {
    ui.inlineClassCode = null;
    renderClassConfigList();
  };
  window.handleInlineClassKey = function (event, code) {
    if (event.key === 'Enter') { event.preventDefault(); saveInlineClass(code); }
    if (event.key === 'Escape') { event.preventDefault(); cancelInlineClassEdit(); }
  };
  window.saveInlineClass = async function (code) {
    const cls = state.classes.find(c => String(c['班級代碼']) === String(code));
    const row = document.querySelector('#class-tbody .inline-edit-row');
    if (!cls || !row) return;
    const field = name => row.querySelector('[data-class-field="' + name + '"]')?.value.trim() || '';
    const name = field('name');
    if (!name) { toast('班級名稱不能空白', 'warning'); return; }
    const newObj = {
      ...cls,
      '班級代碼': code,
       '年級': field('grade'),
       '班級名稱': name,
       '雙語課堂數': field('bilingual'),
       '班級類型': row.querySelector('[data-class-field="virtual"]')?.checked ? '虛擬' : '一般',
       '是否虛擬班': row.querySelector('[data-class-field="virtual"]')?.checked ? 'TRUE' : 'FALSE'
    };
    bgSync({
      actionName: '儲存班級資料',
      applyLocal: () => {
        const idxObj = state.classes.findIndex(c => String(c['班級代碼']) === String(code));
        if (idxObj >= 0) state.classes[idxObj] = newObj;
        ui.inlineClassCode = null;
        renderClassConfigList();
      },
      gasTask: () => gasPost('saveMeta', { type: '班級', data: newObj })
    });
  };

  renderTeacherConfigList = window.renderTeacherConfigList = function () {
    const tbody = document.getElementById('teacher-tbody');
    if (!tbody) return;
    tbody.innerHTML = state.teachers.map(teacher => {
      const code = String(teacher['教師姓名'] || teacher['姓名'] || '');
      const arg = "decodeURIComponent('" + encodeURIComponent(code) + "')";
      const homeroom = typeof getTeacherHomeroom === 'function' ? getTeacherHomeroom(teacher) : '';
      const title = String(teacher['職稱'] || (homeroom && homeroom !== 'TRUE' ? (homeroom + '導師') : (homeroom === 'TRUE' ? '導師' : '專任教師')));
      if (ui.inlineTeacherCode === code) {
        return '<tr class="inline-edit-row"><td><input data-inline-field="name" value="'+esc(code)+'" onkeydown="handleInlineTeacherKey(event,'+arg+')"></td><td><input data-inline-field="email" value="'+esc(teacher['Email']||'')+'" onkeydown="handleInlineTeacherKey(event,'+arg+')"></td><td><input data-inline-field="title" value="'+esc(teacher['職稱']||'')+'" placeholder="例：701導師、教學組長" onkeydown="handleInlineTeacherKey(event,'+arg+')"></td><td><input data-inline-field="hours" type="number" min="0" value="'+esc(String(teacher['基本鐘點']||''))+'" onkeydown="handleInlineTeacherKey(event,'+arg+')"></td><td><input data-inline-field="releaseReason" value="'+esc(teacher['減授原因']||'')+'" placeholder="選填" onkeydown="handleInlineTeacherKey(event,'+arg+')"></td><td><input data-inline-field="subject" value="'+esc(teacher['任教科目']||'')+'" onkeydown="handleInlineTeacherKey(event,'+arg+')"></td><td class="inline-actions"><button class="btn btn-primary btn-xs" onclick="saveInlineTeacher('+arg+')">儲存</button> <button class="btn btn-ghost btn-xs" onclick="cancelInlineTeacherEdit()">取消</button></td></tr>';
      }
      return '<tr><td><b>'+esc(code)+'</b></td><td>'+esc(teacher['Email']||'')+'</td><td><span class="badge '+(title.includes('導師')?'badge-blue':(isTeacherAdmin(teacher)?'badge-purple':'badge-gray'))+'">'+esc(title)+'</span></td><td>'+esc(String(teacher['基本鐘點']||'—'))+'</td><td>'+esc(teacher['減授原因']||'')+'</td><td>'+esc(teacher['任教科目']||'')+'</td><td class="inline-actions"><button class="btn btn-ghost btn-xs" onclick="startInlineTeacherEdit('+arg+')">✏️ 編輯</button> <button class="btn btn-danger btn-xs" onclick="deleteTeacher('+arg+')">🗑 刪除</button></td></tr>';
    }).join('');
  };

  function options(rows, valueKey, labelFn, selected, allowBlank) {
    const blank = allowBlank ? '<option value="">— 未指定 —</option>' : '';
    return blank + rows.map(row => {
      const value = String(row[valueKey] || '');
      return '<option value="'+esc(value)+'"'+(value === String(selected || '') ? ' selected' : '')+'>'+esc(labelFn(row))+'</option>';
    }).join('');
  }

  function numberOptions(max, selected, blankText) {
    let html = '<option value="">'+blankText+'</option>';
    for (let i=1; i<=max; i++) html += '<option value="'+i+'"'+(String(i)===String(selected||'')?' selected':'')+'>'+i+'</option>';
    return html;
  }

  function courseAttributeOptions(selected) {
    const value = String(selected || '').trim();
    return '<option value=""' + (!value ? ' selected' : '') + '>一般課程</option>' +
      '<option value="預排"' + (value === '預排' ? ' selected' : '') + '>預排（下學期）</option>';
  }

  const renderAssignmentConfigList = window.renderAssignmentConfigList = function () {
    const tbody = document.getElementById('asgn-tbody');
    if (!tbody) return;
    tbody.innerHTML = state.assignments.map(a => {
      const id = String(a['配課ID'] || '');
      const arg = "decodeURIComponent('" + encodeURIComponent(id) + "')";
      const teacher = idx.teacherByCode[a['教師姓名']];
      const sub = idx.subjectByCode[a['科目代碼']];
       const customWeekly = runtimeParseWeeklyValue(a['每週節數'], 0);
       const weekly = runtimeGetAssignmentWeeklyValue(a, sub, 3);
      if (String(ui.inlineAssignmentId || '') === id) {
        return '<tr class="inline-edit-row assignment-inline-row" data-assignment-id="'+esc(id)+'">'+
          '<td><select data-asgn-field="class" onkeydown="handleInlineAssignmentKey(event,'+arg+')">'+options(state.classes,'班級代碼',r=>(r['班級代碼']||'')+' '+(r['班級名稱']||''),a['班級代碼'],false)+'</select></td>'+
          '<td><select data-asgn-field="subject" onkeydown="handleInlineAssignmentKey(event,'+arg+')">'+options(state.subjects,'科目代碼',r=>r['科目代碼']||'',a['科目代碼'],false)+'</select></td>'+
          '<td><select data-asgn-field="teacher" onkeydown="handleInlineAssignmentKey(event,'+arg+')">'+options(state.teachers,'教師姓名',r=>(r['教師姓名'] || r['姓名'])||r['教師姓名']||'',a['教師姓名'],true)+'</select></td>'+
          '<td><input data-asgn-field="weekly" type="number" min="0.5" max="20" step="0.5" value="'+esc(String(a['每週節數']||''))+'" placeholder="預設 '+esc(formatWeeklyValue(weekly))+'" onkeydown="handleInlineAssignmentKey(event,'+arg+')"></td>'+
          '<td><input data-asgn-field="note" value="'+esc(String(a['備註']||''))+'" onkeydown="handleInlineAssignmentKey(event,'+arg+')"></td>'+
           '<td><select data-asgn-field="courseAttr" onkeydown="handleInlineAssignmentKey(event,'+arg+')">'+courseAttributeOptions(a['課程屬性'])+'</select></td>'+
          '<td class="inline-actions"><button class="btn btn-primary btn-xs" onclick="saveInlineAssignment('+arg+')">儲存</button> <button class="btn btn-ghost btn-xs" onclick="cancelInlineAssignmentEdit()">取消</button></td></tr>';
      }
       const courseAttr = String(a['課程屬性'] || '').trim();
       const weeklyLabel = formatWeeklyValue(weekly) + ' 節' + (isAlternateWeeklyValue(weekly) ? '（單雙週）' : (customWeekly ? '（自訂）' : ''));
        return '<tr class="'+(courseAttr === '預排' ? 'preplanned-row' : '')+'"><td>'+esc(a['班級代碼']||'')+'</td><td>'+esc(a['科目代碼']||'')+'</td><td><b>'+esc(a['教師姓名']||(teacher?(teacher['教師姓名'] || teacher['姓名']):''))+'</b></td><td>'+esc(weeklyLabel)+'</td><td>'+esc(a['備註'] || '—')+'</td><td>'+(courseAttr === '預排' ? '<span class="badge badge-gray">預排（下學期）</span>' : '一般課程')+'</td><td class="inline-actions"><button class="btn btn-ghost btn-xs" onclick="startInlineAssignmentEdit('+arg+')">✏️ 編輯</button> <button class="btn btn-danger btn-xs" onclick="deleteAssignment('+arg+')">🗑 刪除</button></td></tr>';
    }).join('');
  };

  window.startInlineAssignmentEdit = function (id) {
    ui.inlineAssignmentId = String(id);
    renderAssignmentConfigList();
    document.querySelector('.assignment-inline-row [data-asgn-field="class"]')?.focus();
  };
  editAssignment = window.startInlineAssignmentEdit;
  window.cancelInlineAssignmentEdit = function () {
    ui.inlineAssignmentId = null;
    renderAssignmentConfigList();
  };
  window.handleInlineAssignmentKey = function (event, id) {
    if (event.key === 'Enter') { event.preventDefault(); saveInlineAssignment(id); }
    if (event.key === 'Escape') { event.preventDefault(); cancelInlineAssignmentEdit(); }
  };
  window.saveInlineAssignment = function (id) {
    const row = Array.from(document.querySelectorAll('.assignment-inline-row')).find(el => el.dataset.assignmentId === String(id));
    if (!row) return;
     const get = name => String(row.querySelector('[data-asgn-field="'+name+'"]')?.value ?? '').trim();
     const cls = get('class'), sub = get('subject'), teacher = parseTeacherCode(get('teacher'));
     if (!cls || !sub) { toast('班級與科目必填', 'warning'); return; }
     const weekly = get('weekly');
      if (!runtimeIsValidWeeklyInput(weekly)) { toast('每週節數請留白、填 0.5，或填 1 至 20 的整數', 'warning'); return; }
     const existing = state.assignments.find(item => String(item['配課ID'] || '') === String(id));
     const data = {
       ...(existing || {}),
       '配課ID': id,
       '班級代碼': cls,
       '科目代碼': sub,
       '教師姓名': teacher,
       '課程屬性': get('courseAttr'),
       '每週節數': weekly,
       '備註': get('note')
     };
     bgSync({
      actionName: '儲存配課資料',
      applyLocal: () => {
        const index = state.assignments.findIndex(item => String(item['配課ID'] || '') === String(id));
         if (index >= 0) state.assignments[index] = data;
         else state.assignments.push(data);
         ui.inlineAssignmentId = null;
         if (typeof buildIndex === 'function') buildIndex();
         if (typeof renderAssignmentConfigList === 'function') renderAssignmentConfigList();
      },
      gasTask: () => gasPost('saveMeta', { type: '配課', data }),
      rollbackLocal: () => {
        ui.inlineAssignmentId = String(id);
        if (typeof renderAssignmentConfigList === 'function') renderAssignmentConfigList();
      }
    });
  };

  const renderAssignmentFormOptions = window.renderAssignmentFormOptions = function () {
    const configs = [
      ['asgn-class', state.classes, row => String(row['班級代碼'] || ''), row => String(row['班級代碼'] || '')+' '+String(row['班級名稱'] || '')],
      ['asgn-subject', state.subjects, row => String(row['科目代碼'] || ''), row => String(row['科目代碼'] || '')],
      ['asgn-teacher', state.teachers, row => String(row['教師姓名'] || ''), row => String(row['教師姓名'] || '')+' '+String((row['教師姓名'] || row['姓名']) || '')]
    ];
    configs.forEach(([id, rows, valueOf, labelOf]) => {
      const select = document.getElementById(id);
      if (!select) return;
      const current = select.value;
      select.innerHTML = '<option value="">— 選擇 —</option>' + rows.map(row => {
        const value = valueOf(row);
        return '<option value="'+esc(value)+'">'+esc(labelOf(row))+'</option>';
      }).join('');
      if (current) select.value = current;
    });
    const classSelect = document.getElementById('asgn-class');
    if (classSelect && !classSelect.dataset.subjectFilterBound) {
      classSelect.addEventListener('change', function () { updateAsgnSubjectOptions(this.value); });
      classSelect.dataset.subjectFilterBound = 'true';
    }
    if (classSelect?.value) updateAsgnSubjectOptions(classSelect.value);
  }
  const renderSubjectFormRoomOptions = window.renderSubjectFormRoomOptions = function () {
    const select = document.getElementById('sub-room');
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">— 無 —</option>' + state.rooms.map(r => {
      const code = String(r['教室代碼'] || '');
      const name = r['教室名稱'] || '';
      return '<option value="' + esc(code) + '">' + esc(code) + (name ? ' ' + esc(name) : '') + '</option>';
    }).join('');
    if (current) select.value = current;
  }
  const renderTeacherSubjectBoxes = window.renderTeacherSubjectBoxes = function (selectedCodes = null) {
    const wrap = document.getElementById('tea-subject-boxes');
    if (!wrap) return;
    let selectedSet;
    if (Array.isArray(selectedCodes)) {
      selectedSet = new Set(selectedCodes.map(String));
    } else {
      selectedSet = new Set(Array.from(wrap.querySelectorAll('input:checked')).map(cb => cb.value));
    }
    wrap.innerHTML = state.subjects.map(s => {
      const code = String(s['科目代碼'] || '');
      const checked = selectedSet.has(code) ? ' checked' : '';
      return '<label class="multiselect-option"><input type="checkbox" value="' + esc(code) + '"' + checked + ' onchange="updateTeaSubjectSummary()"> <span>' + esc(code) + '</span></label>';
    }).join('');
    updateTeaSubjectSummary();
  };

  const updateTeaSubjectSummary = window.updateTeaSubjectSummary = function () {
    const summary = document.getElementById('tea-subject-summary');
    if (!summary) return;
    const checkedBoxes = Array.from(document.querySelectorAll('#tea-subject-boxes input[type="checkbox"]:checked'));
    const checkedValues = checkedBoxes.map(cb => cb.value);

    if (checkedValues.length === 0) {
      summary.innerHTML = '<span class="placeholder">請點擊選擇任教科目...</span>';
    } else if (checkedValues.length <= 4) {
      summary.innerHTML = checkedValues.map(code => 
        '<span class="multiselect-tag">' + esc(code) + ' <span class="remove-tag" onclick="removeTeaSubject(\'' + esc(code) + '\', event)">✕</span></span>'
      ).join('');
    } else {
      const firstThree = checkedValues.slice(0, 3);
      const remainingCount = checkedValues.length - 3;
      summary.innerHTML = firstThree.map(code => 
        '<span class="multiselect-tag">' + esc(code) + ' <span class="remove-tag" onclick="removeTeaSubject(\'' + esc(code) + '\', event)">✕</span></span>'
      ).join('') + '<span class="multiselect-tag" style="background:var(--ink-2);color:#fff;">+' + remainingCount + ' 科</span>';
    }
  };

  window.toggleTeaSubjectDropdown = function (event) {
    if (event) event.stopPropagation();
    const dropdown = document.getElementById('tea-subject-dropdown');
    const trigger = document.getElementById('tea-subject-trigger');
    if (!dropdown || !trigger) return;
    const isHidden = dropdown.style.display === 'none';
    dropdown.style.display = isHidden ? 'flex' : 'none';
    trigger.classList.toggle('open', isHidden);
    if (isHidden) {
      document.getElementById('tea-subject-search')?.focus();
    }
  };

  window.hideTeaSubjectDropdown = function () {
    const dropdown = document.getElementById('tea-subject-dropdown');
    const trigger = document.getElementById('tea-subject-trigger');
    if (dropdown) dropdown.style.display = 'none';
    if (trigger) trigger.classList.remove('open');
  };

  window.filterTeaSubjects = function (query) {
    const q = String(query || '').trim().toLowerCase();
    const options = document.querySelectorAll('#tea-subject-boxes .multiselect-option');
    options.forEach(opt => {
      const text = opt.textContent.toLowerCase();
      opt.style.display = text.includes(q) ? 'flex' : 'none';
    });
  };

  window.selectAllTeaSubjects = function (selectAll) {
    const checkboxes = document.querySelectorAll('#tea-subject-boxes input[type="checkbox"]');
    checkboxes.forEach(cb => {
      if (cb.closest('.multiselect-option')?.style.display !== 'none') {
        cb.checked = selectAll;
      }
    });
    updateTeaSubjectSummary();
  };

  window.removeTeaSubject = function (code, event) {
    if (event) event.stopPropagation();
    const cb = Array.from(document.querySelectorAll('#tea-subject-boxes input[type="checkbox"]')).find(input => input.value === String(code));
    if (cb) {
      cb.checked = false;
      updateTeaSubjectSummary();
    }
  };

  window.teacherFormSubjects = function () {
    const wrap = document.getElementById('tea-subject-boxes');
    if (!wrap) return '';
    return Array.from(wrap.querySelectorAll('input:checked')).map(cb => cb.value).join(',');
  };

  if (typeof document.addEventListener === 'function') {
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#tea-subject-multiselect')) {
        hideTeaSubjectDropdown();
      }
    });
  }

  const baseClearTeacherForm = window.clearTeacherForm;
  window.clearTeacherForm = function () {
    if (typeof baseClearTeacherForm === 'function') baseClearTeacherForm();
    else {
      ['tea-code','tea-name','tea-email'].forEach(id => { const input = document.getElementById(id); if (input) input.value = ''; });
      const hours = document.getElementById('tea-hours'); if (hours) hours.value = '16';
      const consec = document.getElementById('tea-max-consec'); if (consec) consec.value = '3';
    }
    const checkboxes = document.querySelectorAll('#tea-subject-boxes input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = false);
    updateTeaSubjectSummary();
  };

  window.switchAsgnSubTab = function (tab) {
    ['cls', 'tea', 'batch'].forEach(t => {
      const btn = document.getElementById('asgn-tab-btn-' + t);
      const panel = document.getElementById('asgn-subpanel-' + t);
      if (btn) btn.classList.toggle('active', t === tab);
      if (panel) panel.style.display = t === tab ? 'block' : 'none';
    });
    if (tab === 'cls') renderClassAssignmentView();
    if (tab === 'tea') renderTeacherAssignmentView();
    if (tab === 'batch' && typeof renderBatchPicker === 'function') renderBatchPicker();
  };

  window.quickAddAssignmentForClass = function (classCode) {
    switchSubTab('config', 'asgn');
    const modeSelect = document.getElementById('batch-mode');
    if (modeSelect) modeSelect.value = 'class-matrix';
    window.switchAsgnSubTab('batch');
    const classTargetSelect = document.getElementById('batch-class-target');
    if (classTargetSelect) classTargetSelect.value = classCode;
    const subFilterSelect = document.getElementById('batch-class-sub-filter');
    if (subFilterSelect) subFilterSelect.value = 'ALL';
    if (typeof renderBatchPreview === 'function') renderBatchPreview();
  };

  window.quickAddAssignmentForTeacher = function (teacherCode) {
    switchSubTab('config', 'asgn');
    const modeSelect = document.getElementById('batch-mode');
    if (modeSelect) modeSelect.value = 'teacher-to-classes';
    window.switchAsgnSubTab('batch');
    const teacher = idx.teacherByCode ? idx.teacherByCode[teacherCode] : null;
    const teacherName = teacher ? (teacher['姓名'] || teacher['教師姓名'] || '') : '';
    const teacherStr = teacherName || teacherCode;
    const input = document.getElementById('batch-teacher-select');
    if (input) input.value = teacherStr;

    if (teacher && teacher['任教科目']) {
      const firstSub = teacher['任教科目'].split(/[,，]/)[0].trim();
      const subSel = document.getElementById('batch-teacher-subject-select');
      if (subSel && firstSub) subSel.value = firstSub;
    }

    if (typeof updateBatchTeacherClasses === 'function') {
      updateBatchTeacherClasses();
    } else if (typeof renderBatchPreview === 'function') {
      renderBatchPreview();
    }
  };

  renderConfigTab = function () {
    ['renderClassConfigList', 'renderTeacherConfigList', 'renderSubjectConfigList', 'renderSubjectFormRoomOptions', 'renderAssignmentFormOptions', 'renderClassAssignmentView', 'renderTeacherAssignmentView', 'renderTeacherSubjectBoxes'].forEach(name => {
      if (typeof window[name] === 'function') window[name]();
    });
  };

  const renderClassAssignmentView = window.renderClassAssignmentView = function () {
    const tbody = document.getElementById('asgn-class-tbody');
    const thead = document.getElementById('asgn-class-thead');
    const summary = document.getElementById('asgn-matrix-summary');
    if (!tbody || !thead) return;
    const filterText = String(document.getElementById('asgn-class-filter')?.value || '').trim().toLowerCase();
    const jsArg = value => "decodeURIComponent('" + encodeURIComponent(String(value || '')) + "')";
    const groupKeyOf = assignment => typeof getAssignmentGroupKey === 'function'
      ? getAssignmentGroupKey(assignment)
      : String(assignment?.['班級代碼'] || '').trim() + '|' + String(assignment?.['科目代碼'] || '').trim() + '|' + String(assignment?.['備註'] || '').trim();
    const groupLabelOf = assignment => String(assignment?.['備註'] || '').trim();

    const subjectColumns = state.subjects.map(subject => ({
      code: String(subject['科目代碼'] || '').trim(),
      subject
    })).filter(column => column.code);
    const subjectCodes = new Set(subjectColumns.map(column => column.code));
    state.assignments.forEach(assignment => {
      const code = String(assignment['科目代碼'] || '').trim();
      if (code && !subjectCodes.has(code)) {
        subjectCodes.add(code);
        subjectColumns.push({ code, subject: { '科目代碼': code } });
      }
    });

    const teacherLabel = (code, tag = '') => {
      const teacherCode = String(code || '').trim();
      if (!teacherCode) return '';
      const teacher = idx.teacherByCode?.[teacherCode] || state.teachers.find(item =>
        String(item['教師姓名'] || item['姓名'] || '').trim() === teacherCode
      );
      const name = teacher ? String(teacher['姓名'] || teacher['教師姓名'] || teacherCode) : teacherCode;
      return name + (String(tag || '').trim() ? '（' + String(tag).trim() + '）' : '');
    };
    const assignmentTeacherItems = assignment => {
      if (typeof getCellTeacherList === 'function') {
        return getCellTeacherList(assignment).map(item => ({
          code: String(item['教師姓名'] || item['姓名'] || '').trim(),
          tag: String(item['標籤'] || '').trim()
        })).filter(item => item.code);
      }
      return String(assignment['教師姓名'] || '').split(/[,，、;；]/)
        .map(code => ({ code: code.trim(), tag: '' })).filter(item => item.code);
    };
    const subjectHeader = column => {
       const weekly = parseWeeklyValue(column.subject['每週節數'], 0);
      const color = typeof getSubjectColor === 'function' ? getSubjectColor(column.code) : null;
      const style = color && color.bg ? ' style="background:' + esc(color.bg) + ';color:' + esc(color.text || 'var(--ink)') + ';"' : '';
      const weeklyText = weekly > 0 ? '<small>每週' + weekly + '節</small>' : '';
      return '<th class="asgn-matrix-subject-col" data-subject-code="' + esc(column.code) + '" title="' + esc(column.code) + '"' + style + '>' +
        '<span>' + esc(column.code) + '</span>' + weeklyText + '</th>';
    };

    thead.innerHTML = '<tr>' +
      '<th class="asgn-matrix-class-col">班級</th>' +
      '<th class="asgn-matrix-progress-col">配課節數</th>' +
      subjectColumns.map(subjectHeader).join('') +
      '<th class="asgn-matrix-action-col">操作</th>' +
      '</tr>';

    let visibleClassCount = 0;
    const html = state.classes.map(cls => {
      const classCode = String(cls['班級代碼'] || '');
      const className = cls['班級名稱'] || classCode;
      const grade = cls['年級'] || '';
      const isVirtual = cls['是否虛擬班'] === 'TRUE';
      const classAssignments = idx.assignmentsByClass?.[classCode] || state.assignments.filter(assignment =>
        String(assignment['班級代碼'] || '') === classCode
      );
      const assignmentsBySubject = new Map();
      classAssignments.forEach(assignment => {
        const code = String(assignment['科目代碼'] || '').trim();
        if (!code) return;
        if (!assignmentsBySubject.has(code)) assignmentsBySubject.set(code, []);
        assignmentsBySubject.get(code).push(assignment);
      });

      const applicableSubjectCodes = new Set();
      subjectColumns.forEach(column => {
        const sub = column.subject;
        if (assignmentsBySubject.has(column.code)) {
          applicableSubjectCodes.add(column.code);
          return;
        }
        const appClasses = String(sub['適用班級'] || '').split(/[,，]/).map(value => value.trim()).filter(Boolean);
        if (appClasses.length > 0) {
          if (appClasses.includes(classCode)) applicableSubjectCodes.add(column.code);
          return;
        }
        if (isVirtual) return;
        const appGrades = String(sub['適用年級'] || '').split(/[,，]/).map(value => value.trim()).filter(Boolean);
        if (appGrades.length > 0 && appGrades[0] !== '全校') {
          if (appGrades.includes(String(grade))) applicableSubjectCodes.add(column.code);
          return;
        }
        applicableSubjectCodes.add(column.code);
      });

       const searchableText = [classCode, className, ...Array.from(applicableSubjectCodes), ...classAssignments.flatMap(assignment =>
          [groupLabelOf(assignment), ...assignmentTeacherItems(assignment).map(item => teacherLabel(item.code, item.tag))]
        )].join(' ').toLowerCase();
      if (filterText && !searchableText.includes(filterText)) return '';
      visibleClassCount++;

      let totalAssignedWeekly = 0;
       const cellsHtml = subjectColumns.map(column => {
         const assignments = assignmentsBySubject.get(column.code) || [];
         const defaultWeekly = getSubjectWeeklyValue(column.subject, 3);
         const applicable = applicableSubjectCodes.has(column.code);
         const firstAssignment = assignments[0];
         const preplanned = assignments.some(assignment => typeof isPreplannedCourse === 'function' && isPreplannedCourse(assignment['課程屬性']));

         if (assignments.length > 0 && !isHelperSubjectCodeForCount(column.code)) {
           totalAssignedWeekly += assignments.reduce((total, assignment) => {
              return total + getAssignmentWeeklyValue(assignment, column.subject, defaultWeekly);
           }, 0);
         }
         if (assignments.length > 0) {
           const assignmentRows = assignments.map(assignment => {
             const teacherNames = assignmentTeacherItems(assignment).map(item => teacherLabel(item.code, item.tag)).filter(Boolean);
             const weekly = getAssignmentWeeklyValue(assignment, column.subject, defaultWeekly);
              const scheduled = Object.prototype.hasOwnProperty.call(idx.scheduleCountByAssignmentGroup || {}, groupKeyOf(assignment))
                ? idx.scheduleCountByAssignmentGroup[groupKeyOf(assignment)]
               : (idx.scheduleCountByClassSubject?.[classCode + '|' + column.code] || 0);
              const note = groupLabelOf(assignment);
             const assignmentPreplanned = typeof isPreplannedCourse === 'function' && isPreplannedCourse(assignment['課程屬性']);
             const teacherText = teacherNames.length > 0 ? teacherNames.join('／') : '未指定教師';
             const label = [teacherText, note ? '備註：' + note : '', '每週' + formatWeeklyValue(weekly) + '節', formatWeeklyValue(scheduled) + '節已排'].filter(Boolean).join('；');
             return '<button type="button" class="asgn-matrix-assignment-row' + (assignmentPreplanned ? ' is-preplanned' : '') + '" onclick="openMatrixAssignmentEditor(' + jsArg(classCode) + ',' + jsArg(column.code) + ',' + jsArg(assignment['配課ID'] || '') + ')" title="' + esc(label) + '">' +
               '<span class="asgn-matrix-teacher">' + esc(teacherText) + '</span>' +
               (note ? '<span class="asgn-matrix-group">' + esc(note) + '</span>' : '') +
               '<span class="asgn-matrix-assignment-weekly">' + esc(formatWeeklyValue(scheduled) + '/' + formatWeeklyValue(weekly) + '節') + '</span>' +
               (assignmentPreplanned ? '<span class="asgn-matrix-course-attr">預排</span>' : '') +
               '</button>';
           }).join('');
           const title = column.code + '：' + assignments.map(assignment => {
              const note = groupLabelOf(assignment);
             return note ? '備註：' + note : '未分組';
           }).join('／');
           return '<td class="asgn-matrix-cell ' + (assignments.some(assignment => assignmentTeacherItems(assignment).length > 0) ? 'is-assigned' : 'is-unassigned') + (preplanned ? ' is-preplanned' : '') + '" title="' + esc(title) + '">' +
             assignmentRows +
             '<button type="button" class="asgn-matrix-add-group" onclick="openMatrixAssignmentEditor(' + jsArg(classCode) + ',' + jsArg(column.code) + ',\'\')">＋新增分組</button>' +
             '</td>';
         }
         const cellClick = applicable
           ? ' onclick="openMatrixAssignmentEditor(' + jsArg(classCode) + ',' + jsArg(column.code) + ',\'\')" tabindex="0" role="button"'
           : '';
         return '<td class="asgn-matrix-cell ' + (applicable ? 'is-empty' : 'is-not-applicable') + '"' + cellClick + ' title="' +
           esc(applicable ? '尚未配課' : '不適用科目') + '"></td>';
      }).join('');

      const progressBadgeClass = totalAssignedWeekly > 0 ? 'badge-blue' : 'badge-gray';
      const argCls = "decodeURIComponent('" + encodeURIComponent(classCode) + "')";

      return '<tr>' +
        '<td class="asgn-matrix-class-cell" title="' + esc(classCode + ' ' + className) + '"><b>' + esc(classCode) + '</b><span>' + esc(className) + (isVirtual ? ' ⚡' : '') + '</span></td>' +
         '<td class="asgn-matrix-progress-cell"><span class="badge ' + progressBadgeClass + '">' + formatWeeklyValue(totalAssignedWeekly) + ' 節</span></td>' +
        cellsHtml +
        '<td class="asgn-matrix-action-cell"><button class="btn btn-ghost btn-xs" onclick="quickAddAssignmentForClass(' + argCls + ')">➕ 配課</button></td>' +
        '</tr>';
    }).join('');

     if (summary) {
       const warningCount = (idx.assignmentGroupWarnings || []).length;
       summary.textContent = '顯示 ' + visibleClassCount + '／' + state.classes.length + ' 班　' + subjectColumns.length + ' 科　已建立 ' + state.assignments.length + ' 筆配課' +
         (warningCount > 0 ? '　⚠️ 有 ' + warningCount + ' 項分組辨識警告' : '');
     }
    tbody.innerHTML = html || '<tr><td colspan="' + (subjectColumns.length + 3) + '" class="text-center text-muted py-3">無符合條件的班級</td></tr>';
  };

  function matrixAssignmentTeacherCodes(assignment) {
    if (!assignment) return [];
    if (typeof getCellTeacherCodes === 'function') {
      return getCellTeacherCodes(assignment).map(code => String(code || '').trim()).filter(Boolean);
    }
    return String(assignment['教師姓名'] || '').split(/[,，、;；]/).map(code => code.trim()).filter(Boolean);
  }

  function matrixAssignmentTeacherItems(assignment) {
    if (!assignment || typeof getCellTeacherList !== 'function') return [];
    return getCellTeacherList(assignment)
      .map(item => ({
        '教師姓名': String(item?.['教師姓名'] || '').trim(),
        '標籤': String(item?.['標籤'] || '').trim()
      }))
      .filter(item => item['教師姓名']);
  }

  function matrixAssignmentTeacherInputValue(code) {
    const teacherCode = String(code || '').trim();
    if (!teacherCode) return '';
    const teacher = idx.teacherByCode?.[teacherCode];
    return typeof formatTeacherCodeName === 'function'
      ? formatTeacherCodeName(teacherCode, teacher)
      : teacherCode;
  }

  function matrixAssignmentTeacherRowHtml(index, item) {
    const code = String(item?.['教師姓名'] || '').trim();
    const tag = String(item?.['標籤'] || '').trim();
    const inputId = index === 1 ? 'matrixAssignmentTeacher' : 'matrixAssignmentTeacher' + index;
    const label = index === 1 ? '主教師' : '協同教師 ' + (index - 1);
    const remove = index > 1
      ? '<button type="button" class="btn btn-ghost btn-xs matrix-assignment-teacher-remove" title="移除此協同教師">移除</button>'
      : '';
    return '<div class="matrix-assignment-teacher-row" data-matrix-teacher-row="' + index + '" style="display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap;">' +
      '<span style="flex:0 0 76px;font-size:12px;font-weight:600;color:var(--ink-2);">' + label + '</span>' +
      '<input id="' + inputId + '" data-matrix-teacher-input class="combobox-input" placeholder="請選擇教師" value="' + esc(matrixAssignmentTeacherInputValue(code)) + '" style="flex:1 1 200px;min-width:180px;">' +
      '<input data-matrix-teacher-tag class="matrix-assignment-teacher-tag" placeholder="標籤（選填）" value="' + esc(tag) + '" style="flex:0 0 110px;min-width:90px;">' +
      remove +
      '</div>';
  }

  function bindMatrixAssignmentTeacherRow(row) {
    if (!row) return;
    const input = row.querySelector('[data-matrix-teacher-input]');
    if (input && typeof initTeacherCombobox === 'function') initTeacherCombobox(input);
    const remove = row.querySelector('.matrix-assignment-teacher-remove');
    if (remove) remove.addEventListener('click', () => {
      closeGlobalTeacherDropdown();
      row.remove();
    });
  }

  function renderMatrixAssignmentTeacherRows(items) {
    const container = document.getElementById('matrixAssignmentTeacherList');
    if (!container) return;
    const rows = Array.isArray(items) && items.length > 0
      ? items
      : [{ '教師姓名': '', '標籤': '' }];
    container.innerHTML = rows.map((item, index) => matrixAssignmentTeacherRowHtml(index + 1, item)).join('');
    container.querySelectorAll('.matrix-assignment-teacher-row').forEach(bindMatrixAssignmentTeacherRow);
  }

  window.addMatrixAssignmentTeacher = function () {
    const container = document.getElementById('matrixAssignmentTeacherList');
    if (!container) return;
    const existingIndexes = Array.from(container.querySelectorAll('.matrix-assignment-teacher-row'))
      .map(row => parseInt(row.dataset.matrixTeacherRow || row.getAttribute('data-matrix-teacher-row') || '0', 10) || 0);
    const index = Math.max(0, ...existingIndexes) + 1;
    container.insertAdjacentHTML('beforeend', matrixAssignmentTeacherRowHtml(index, null));
    const row = container.querySelector('[data-matrix-teacher-row="' + index + '"]');
    bindMatrixAssignmentTeacherRow(row);
    row?.querySelector('[data-matrix-teacher-input]')?.focus();
  };

  function collectMatrixAssignmentTeachers() {
    const container = document.getElementById('matrixAssignmentTeacherList');
    const rows = container && typeof container.querySelectorAll === 'function'
      ? Array.from(container.querySelectorAll('.matrix-assignment-teacher-row'))
      : [];
    const teachers = [];
    const seen = new Set();
    for (const row of rows) {
      const input = row.querySelector('[data-matrix-teacher-input]');
      const raw = String(input?.value || '').trim();
      if (!raw) continue;
      const teacher = state.teachers.find(item => {
        const code = String(item['教師姓名'] || item['姓名'] || '').trim();
        const name = String(item['姓名'] || item['教師姓名'] || '').trim();
        const display = typeof formatTeacherCodeName === 'function' ? formatTeacherCodeName(code, item) : code;
        return raw === code || raw === name || raw === display;
      });
      const code = teacher ? String(teacher['教師姓名'] || teacher['姓名'] || '').trim() : '';
      if (!code) return { error: '請從教師名單選擇有效的教師' };
      if (seen.has(code)) return { error: '同一位教師不可重複設定為主教師與協同教師' };
      seen.add(code);
      const tag = String(row.querySelector('[data-matrix-teacher-tag]')?.value || '').trim();
       teachers.push({ '教師姓名': code, '標籤': tag });
    }
    return teachers.length > 0
      ? { teachers }
      : { error: '請至少選擇一位主教師' };
  }

  window.openMatrixAssignmentEditor = function (classCode, subjectCode, assignmentId) {
    const classKey = String(classCode || '').trim();
    const subjectKey = String(subjectCode || '').trim();
    const id = String(assignmentId || '').trim();
    const existing = id
      ? state.assignments.find(assignment => String(assignment['配課ID'] || '') === id)
      : null;
    const classInfo = idx.classByCode?.[classKey] || state.classes.find(cls => String(cls['班級代碼'] || '') === classKey);
    const subjectInfo = idx.subjectByCode?.[subjectKey] || state.subjects.find(subject => String(subject['科目代碼'] || '') === subjectKey);
    const teacherItems = matrixAssignmentTeacherItems(existing);

    ui.matrixAssignmentTarget = { classCode: classKey, subjectCode: subjectKey, assignmentId: id };
    document.getElementById('matrixAssignmentTitle').textContent = existing ? '修改配課' : '新增配課';
    document.getElementById('matrixAssignmentContext').textContent =
      '班級：' + String(classInfo?.['班級名稱'] || classKey) + '　科目：' + subjectKey;
    renderMatrixAssignmentTeacherRows(teacherItems);
    const weeklyInput = document.getElementById('matrixAssignmentWeekly');
    if (weeklyInput) weeklyInput.value = existing?.['每週節數'] || '';
    const attributeSelect = document.getElementById('matrixAssignmentAttribute');
    if (attributeSelect) attributeSelect.value = existing?.['課程屬性'] || '';
    const noteInput = document.getElementById('matrixAssignmentNote');
    if (noteInput) noteInput.value = existing?.['備註'] || '';
    const weeklyLabel = document.querySelector('label[for="matrixAssignmentWeekly"]');
    if (weeklyLabel) {
      const defaultWeekly = parseInt(subjectInfo?.['每週節數'] || '', 10);
      weeklyLabel.textContent = defaultWeekly > 0 ? '每週節數（科目預設 ' + defaultWeekly + ' 節）' : '每週節數';
    }
    document.getElementById('matrixAssignmentModal').classList.add('show');
    document.querySelector('#matrixAssignmentTeacherList [data-matrix-teacher-input]')?.focus();
  };

  window.closeMatrixAssignmentEditor = function () {
    document.getElementById('matrixAssignmentModal')?.classList.remove('show');
    if (typeof closeGlobalTeacherDropdown === 'function') closeGlobalTeacherDropdown();
    ui.matrixAssignmentTarget = null;
  };

  window.saveMatrixAssignment = function () {
    const target = ui.matrixAssignmentTarget;
    if (!target) return;
    const teacherResult = collectMatrixAssignmentTeachers();
    if (teacherResult.error) { toast(teacherResult.error, 'warning'); return; }
     const teacherValue = typeof serializeTeacherList === 'function'
       ? serializeTeacherList(teacherResult.teachers)
       : (teacherResult.teachers.length > 1 || teacherResult.teachers.some(item => item['標籤'])
         ? JSON.stringify(teacherResult.teachers)
         : teacherResult.teachers[0]['教師姓名']);

     const weekly = String(document.getElementById('matrixAssignmentWeekly')?.value || '').trim();
      if (!runtimeIsValidWeeklyInput(weekly)) {
       toast('每週節數請留白、填 0.5，或填 1 至 20 的整數', 'warning'); return;
    }
    const existing = target.assignmentId
      ? state.assignments.find(assignment => String(assignment['配課ID'] || '') === target.assignmentId)
      : null;
     const data = {
       ...(existing || {}),
       '配課ID': existing?.['配課ID'] || ('MATRIX-' + Date.now()),
       '班級代碼': target.classCode,
       '科目代碼': target.subjectCode,
       '教師姓名': teacherValue,
       '課程屬性': String(document.getElementById('matrixAssignmentAttribute')?.value || '').trim(),
       '每週節數': weekly,
       '備註': String(document.getElementById('matrixAssignmentNote')?.value || '').trim()
     };
     const assignmentId = String(data['配課ID']);
    const actionName = existing ? '修改配課資料' : '新增配課資料';
    window.closeMatrixAssignmentEditor();
    bgSync({
      actionName,
      applyLocal: () => {
        const index = state.assignments.findIndex(assignment => String(assignment['配課ID'] || '') === assignmentId);
        if (index >= 0) state.assignments[index] = data;
        else state.assignments.push(data);
        if (typeof buildIndex === 'function') buildIndex();
        if (typeof renderClassAssignmentView === 'function') renderClassAssignmentView();
        if (typeof renderTeacherAssignmentView === 'function') renderTeacherAssignmentView();
      },
      gasTask: () => gasPost('saveMeta', { type: '配課', data })
    });
  };

  function parseTeacherBasicHours(teacher) {
    const raw = String(teacher && teacher['基本鐘點'] != null ? teacher['基本鐘點'] : '').trim();
    const value = Number.parseFloat(raw.replace(/,/g, ''));
    return Number.isFinite(value) ? value : 0;
  }

  function countTeacherFormalScheduleHours(teacherCode) {
    const code = String(teacherCode || '').trim();
    if (!code) return 0;
    const slots = new Set();
    const slotIndex = idx.schedByTeacherSlot || {};
    Object.keys(slotIndex).forEach(key => {
      if (!key.startsWith(code + '|')) return;
      (slotIndex[key] || []).forEach(cell => {
        if (!cell) return;
        if (typeof isPatrolScheduleEntry === 'function' && isPatrolScheduleEntry(cell)) return;
        if (typeof isPreplannedScheduleEntry === 'function' && isPreplannedScheduleEntry(cell)) return;
         const period = parseInt(cell['節次'], 10);
         if (period === 8) return;
         const subjectCode = String(cell['科目代碼'] || '').trim();
        if (period === 8 && /輔$/i.test(subjectCode)) return;
        slots.add(key.slice(code.length + 1));
      });
    });
    if (slots.size > 0) return slots.size;

    (state.schedule || []).forEach(cell => {
      if (!cell) return;
      if (typeof isPatrolScheduleEntry === 'function' && isPatrolScheduleEntry(cell)) return;
      if (typeof isPreplannedScheduleEntry === 'function' && isPreplannedScheduleEntry(cell)) return;
       const period = parseInt(cell['節次'], 10);
       if (period === 8) return;
       const subjectCode = String(cell['科目代碼'] || '').trim();
      if (period === 8 && /輔$/i.test(subjectCode)) return;
      const teacherList = typeof getCellTeacherList === 'function' ? getCellTeacherList(cell) : [];
      const teacherCodes = teacherList.map(item => String(item['教師姓名'] || item['姓名'] || '').trim());
      if (teacherList.length > 0 ? !teacherCodes.includes(code) : String(cell['教師姓名'] || '').trim() !== code) return;
      const day = parseInt(cell['星期'], 10);
      if (!Number.isFinite(day) || !Number.isFinite(period)) return;
      slots.add(day + '|' + period);
    });
    return slots.size;
  }

  window.parseTeacherBasicHours = parseTeacherBasicHours;
  window.countTeacherFormalScheduleHours = countTeacherFormalScheduleHours;

  const renderTeacherAssignmentView = window.renderTeacherAssignmentView = function () {
    const tbody = document.getElementById('asgn-teacher-tbody');
    if (!tbody) return;
    const filterText = String(document.getElementById('asgn-teacher-filter')?.value || '').trim().toLowerCase();

    const html = state.teachers.filter(t => {
      if (!filterText) return true;
      const code = String(t['教師姓名'] || '').toLowerCase();
      const name = String((t['教師姓名'] || t['姓名']) || '').toLowerCase();
      const subs = String(t['任教科目'] || '').toLowerCase();
      return code.includes(filterText) || name.includes(filterText) || subs.includes(filterText);
    }).map(t => {
      const teacherCode = String((t['教師姓名'] || t['姓名']) || t['教師姓名'] || '');
      const teacherName = teacherCode;
      const basicHours = parseTeacherBasicHours(t);

      const teacherAssignments = idx.assignmentsByTeacher?.[teacherCode] || idx.assignmentsByTeacher?.[t['教師姓名']] || [];
      let totalAssigned = 0;
      const scheduledHours = countTeacherFormalScheduleHours(teacherCode);
      const courseChips = teacherAssignments.map(asgn => {
        const classCode = String(asgn['班級代碼'] || '');
        const subCode = String(asgn['科目代碼'] || '');
        const sub = idx.subjectByCode?.[subCode];
      const weekly = runtimeGetAssignmentWeeklyValue(asgn, sub, 3);
        totalAssigned += weekly;
        return '<span class="asgn-item-chip is-assigned">' +
           '<b>' + esc(classCode) + '</b> ' + esc(subCode) + ' (' + formatWeeklyValue(weekly) + '節' + (isAlternateWeeklyValue(weekly) ? '／單雙週' : '') + ')' +
          '</span>';
      }).join('');

      let statusHtml = '';
       const remaining = basicHours - scheduledHours;
      const overtime = scheduledHours - basicHours;
      if (overtime > 0) {
        statusHtml = '<span class="asgn-status-badge status-over">🔵 超鐘點 (+' + overtime + '節)</span>';
      } else if (totalAssigned === 0) {
        statusHtml = '<span class="asgn-status-badge status-unassigned">⚠️ 未配課 (0節)</span>';
      } else if (remaining > 0) {
        statusHtml = '<span class="asgn-status-badge status-under">⚠️ 還差 ' + remaining + ' 節</span>';
      } else if (remaining === 0) {
        statusHtml = '<span class="asgn-status-badge status-ok">🟩 完成 (' + basicHours + '節)</span>';
      } else {
        statusHtml = '<span class="asgn-status-badge status-ok">🟩 已完成配課</span>';
      }

      const argTea = "decodeURIComponent('" + encodeURIComponent(teacherCode) + "')";

      return '<tr>' +
        '<td><b>' + esc(teacherName) + '</b></td>' +
        '<td>' + basicHours + ' 節</td>' +
         '<td><b>' + scheduledHours + '</b> / ' + (remaining > 0 ? '<span class="text-danger">缺' + remaining + '</span>' : '0') + ' 節</td>' +
        '<td>' + statusHtml + '</td>' +
        '<td><div class="asgn-chip-list">' + (courseChips || '<span class="text-muted text-xs">⚠️ 尚未分配任何課程</span>') + '</div></td>' +
        '<td><button class="btn btn-ghost btn-xs" onclick="quickAddAssignmentForTeacher(' + argTea + ')">➕ 配課</button></td>' +
        '</tr>';
    }).join('');

    tbody.innerHTML = html || '<tr><td colspan="6" class="text-center text-muted py-3">無符合條件的教師</td></tr>';
  };

  editBindGroup = function (id) {
    const g = state.blockGroups.find(x => String(x['群組ID']) === String(id));
    const nameInput = document.getElementById('bind-name');
    if (!g || !nameInput) { toast('綁班編輯區尚未載入，請重新整理頁面', 'error'); return; }
    nameInput.value = g['群組名稱'] || '';
    const parseList = value => Array.isArray(value) ? value.map(String) : String(value || '').split(',').map(v=>v.trim()).filter(Boolean);
    const subs = parseList(g['科目清單'] || g['科目代碼']);
    const classes = parseList(g['班級清單']);
    document.querySelectorAll('#bind-subjects input[type=checkbox]').forEach(cb => { cb.checked = subs.includes(cb.value); });
    document.querySelectorAll('#bind-classes input[type=checkbox]').forEach(cb => { cb.checked = classes.includes(cb.value); });
    ui.editingBindId = g['群組ID'];
    const btn = document.getElementById('bind-save-btn');
    if (btn) btn.textContent = '💾 儲存群組';
    nameInput.focus();
  };

  renderStatsTab = function () {
    const summary = document.getElementById('stats-summary');
    const teacherBody = document.getElementById('stats-teacher-tbody');
    const classBody = document.getElementById('stats-class-tbody');
    if (!summary || !teacherBody || !classBody) return;
    const isTeachingScheduleEntry = item => typeof isPatrolScheduleEntry !== 'function' || !isPatrolScheduleEntry(item);
    const classCounts = idx.scheduleCountByClass || Object.create(null);
    const totalSlots = state.classes.length * 40;
    const filledSlots = state.schedule.filter(isTeachingScheduleEntry).length;
    summary.innerHTML = [
      ['總班級數', state.classes.length],
      ['總教師數', state.teachers.length],
      ['已排格數', filledSlots],
      ['班級空白格數', Math.max(0, totalSlots-filledSlots)],
      ['排課進度', totalSlots ? Math.round(filledSlots/totalSlots*100)+'%' : '0%']
    ].map(item => '<div class="stat-card"><div class="stat-label">'+item[0]+'</div><div class="stat-val">'+item[1]+'</div></div>').join('');
    teacherBody.innerHTML = state.teachers.map(teacher => {
      const code = String(teacher['教師姓名'] || '');
      const assigned = idx.assignedWeeklyByTeacher?.[code] || 0;
      const scheduled = idx.scheduledAssignedByTeacher?.[code] || 0;
      const remaining = Math.max(0, assigned - scheduled);
      const percent = assigned ? Math.round(scheduled / assigned * 100) : 0;
      const color = !assigned ? 'var(--ink-3)' : remaining ? 'var(--warning)' : 'var(--success)';
      return '<tr><td>'+esc((teacher['姓名'] || teacher['教師姓名'] || '') || code)+'</td><td>'+scheduled+'</td><td>'+assigned+'</td><td><span class="badge '+(remaining ? 'badge-yellow' : 'badge-green')+'">'+remaining+'</span></td><td><div class="stats-progress"><i style="width:'+Math.min(percent,100)+'%;background:'+color+'"></i></div><span class="text-muted text-xs">'+percent+'%</span></td></tr>';
    }).join('');    classBody.innerHTML = state.classes.map(cls => {
      const code = String(cls['班級代碼'] || '');
      const filled = classCounts[code] || 0;
      const empty = Math.max(0, 40-filled);
      return '<tr><td>'+esc(cls['班級名稱'] || code)+'</td><td>'+filled+'</td><td><span class="badge '+(empty ? 'badge-yellow' : 'badge-green')+'">'+empty+'</span></td></tr>';
    }).join('');
  };

  window.buildAutoScheduleQualityReport = function ({ schedule, optP8Only, autoEndPeriod, onePerDay = true, ignoreTeacherConsecutiveIds = [], ignoreScheduleIds = [], allowSoftTeacherExclusives = false }) {
    const ignoredTeacherConsecutiveIds = new Set((ignoreTeacherConsecutiveIds || []).map(id => String(id || '').trim()).filter(Boolean));
    const ignoredScheduleIds = new Set((ignoreScheduleIds || []).map(id => String(id || '').trim()).filter(Boolean));
      const isHelper = code => /輔$/i.test(String(code || '').trim());
      const alternateClassSubjectKeys = new Set((state.assignments || [])
        .filter(assignment => isAlternateWeeklyValue(getAssignmentWeeklyValue(assignment, idx.subjectByCode?.[String(assignment['科目代碼'] || '').trim()], 3)))
        .map(assignment => String(assignment['班級代碼'] || '').trim() + '|' + String(assignment['科目代碼'] || '').trim()));
      const alternateAssignmentGroupKeys = new Set((state.assignments || [])
        .filter(assignment => isAlternateWeeklyValue(getAssignmentWeeklyValue(assignment, idx.subjectByCode?.[String(assignment['科目代碼'] || '').trim()], 3)))
        .map(runtimeAssignmentGroupKey)
        .filter(Boolean));
      const reportAssignmentGroupKeys = entry => runtimeAssignmentGroupKeysForScheduleEntry(entry, state.assignments);
      const isAlternateAssignment = (classCode, subjectCode, entry = null) => {
        const groupKeys = entry ? reportAssignmentGroupKeys(entry) : (state.assignments || [])
          .filter(assignment => String(assignment['班級代碼'] || '').trim() === String(classCode || '').trim() &&
            String(assignment['科目代碼'] || '').trim() === String(subjectCode || '').trim())
          .map(runtimeAssignmentGroupKey);
        if (groupKeys.length > 0) return groupKeys.some(groupKey => alternateAssignmentGroupKeys.has(groupKey));
        return alternateClassSubjectKeys.has(String(classCode || '').trim() + '|' + String(subjectCode || '').trim());
      };
     const isAlternateEntry = entry => {
       const period = parseInt(entry?.['節次'], 10);
       const attr = String(entry?.['課堂屬性'] || '').trim();
       return period === 8 && (attr === '單週' || attr === '雙週');
     };
     const inScope = (code, classCode = '', entry = null) => {
        const alternate = isAlternateEntry(entry) || isAlternateAssignment(classCode, code, entry);
       return optP8Only
         ? isHelper(code) || alternate
         : (autoEndPeriod <= 7 ? !isHelper(code) && !alternate : true);
     };
    const reportPeriod = entry => parseInt(entry?.['節次'], 10);
    const reportWeekType = entry => {
      const period = reportPeriod(entry);
      const attr = String(entry?.['課堂屬性'] || '').trim();
      return period === 8 && (attr === '單週' || attr === '雙週') ? attr : '全週';
    };
    const reportInScope = entry => {
      const period = reportPeriod(entry);
       return Number.isFinite(period) && period >= 1 && period <= Number(autoEndPeriod || 7) && inScope(entry?.['科目代碼'], entry?.['班級代碼'], entry);
    };
    const reportIsManualOnlyPeriod = period => typeof isManualOnlyPeriod === 'function'
      ? isManualOnlyPeriod(period)
      : period === 0 || period === 45;
    const reportCountedSchedule = entry => {
      const period = reportPeriod(entry);
       return inScope(entry?.['科目代碼'], entry?.['班級代碼'], entry) && (reportIsManualOnlyPeriod(period) || reportInScope(entry));
    };
    const isPatrol = entry => [entry?.['課堂屬性'], entry?.['班級代碼'], entry?.['科目代碼']]
      .some(value => String(value || '').trim().includes('巡堂'));
    const isLockedConsecutiveEntry = (entry, rows) => {
      if (!entry || isPatrol(entry)) return false;
      const classCode = String(entry['班級代碼'] || '').trim();
      const subjectCode = String(entry['科目代碼'] || '').trim();
      const day = parseInt(entry['星期'], 10);
      const period = parseInt(entry['節次'], 10);
      if (!classCode || !subjectCode || !Number.isFinite(day) || !Number.isFinite(period)) return false;
      const peers = (Array.isArray(rows) ? rows : []).filter(candidate =>
        candidate && !isPatrol(candidate) &&
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
    };
    const reportTeacherTokens = value => {
      const fallback = value && typeof value === 'object' ? value['教師姓名'] : value;
      if (typeof getCellTeacherCodes === 'function') {
        const codes = getCellTeacherCodes(value && typeof value === 'object' ? value : { '教師姓名': value });
        if (codes.length > 0) return codes.map(code => String(code));
      }
      return String(fallback || '').split(/[,，、;；]/).map(code => code.trim()).filter(Boolean);
    };
    const reportTeacherIdentities = value => {
      const tokens = reportTeacherTokens(value);
      if (typeof resolveTeacherCodes !== 'function') return tokens;
      const identities = resolveTeacherCodes(value);
      return identities.length > 0 ? identities : tokens;
    };
    const reportTeacherKey = value => {
      const identities = reportTeacherIdentities(value);
      const teacher = identities.map(code => idx.teacherByCode?.[code]).find(Boolean);
      return teacher ? String(teacher['教師姓名'] || teacher['姓名'] || identities[0] || '') : String(identities[0] || value || '');
    };
    const reportCohortValues = value => {
      if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
      if (typeof value === 'number') return String(value).match(/.{3}/g) || [];
      return String(value || '').split(/[,，、]/).map(item => item.trim()).filter(Boolean);
    };
    const reportAllowedCombinedClassCohort = items => {
      if (typeof window !== 'undefined' && typeof window.isAllowedCombinedClassCohort === 'function') {
        return window.isAllowedCombinedClassCohort(items);
      }
      if (!Array.isArray(items) || items.length < 2) return false;
      const subjects = [...new Set(items.map(item => String(item.subjectCode || '').trim()).filter(Boolean))];
      const classes = items.map(item => String(item.classCode || '').trim()).filter(Boolean);
      if (subjects.length !== 1 || classes.length !== items.length || new Set(classes).size !== items.length) return false;
      if (items.every(item => item.isLocked === true)) return true;
      return (state.blockGroups || []).some(group => {
        const groupSubjects = reportCohortValues(group['科目清單'] || group['科目代碼']);
        const groupClasses = reportCohortValues(group['班級清單']);
        return groupSubjects.includes(subjects[0]) && classes.every(classCode => groupClasses.includes(classCode));
      });
    };
    const scopedSchedule = (Array.isArray(schedule) ? schedule : []).filter(reportInScope);
    const countedSchedule = (Array.isArray(schedule) ? schedule : []).filter(reportCountedSchedule);
    const auditSchedule = scopedSchedule.filter(entry => !ignoredScheduleIds.has(String(entry?.['課表ID'] || '').trim()));
     const required = new Map(), scheduled = new Map(), classSubjectRequired = new Map(), classSubjectScheduled = new Map(), classSubjectGroupRequired = new Map(), classSubjectGroupScheduled = new Map();
     state.assignments.forEach(assignment => {
       const teacherCodes=reportTeacherTokens(assignment), classCode=String(assignment['班級代碼']||''), subjectCode=String(assignment['科目代碼']||'');
         if(!classCode||!subjectCode||!inScope(subjectCode, classCode, assignment)) return;
        const weekly=getAssignmentWeeklyValue(assignment, idx.subjectByCode[subjectCode], 3);
       const classSubjectKey=classCode+'|'+subjectCode;
       const assignmentGroupKey=runtimeAssignmentGroupKey(assignment);
       classSubjectRequired.set(classSubjectKey,(classSubjectRequired.get(classSubjectKey)||0)+weekly);
       classSubjectGroupRequired.set(assignmentGroupKey,(classSubjectGroupRequired.get(assignmentGroupKey)||0)+weekly);
      if(teacherCodes.length === 0) return;
      teacherCodes.forEach(teacherCode => {
        const key=teacherCode+'|'+classCode+'|'+subjectCode;
        const item=required.get(key)||{teacherCode,classCode,subjectCode,required:0}; item.required+=weekly; required.set(key,item);
      });
    });
     countedSchedule.forEach(item=>{
       const classCode=String(item['班級代碼']||''), subjectCode=String(item['科目代碼']||'');
      reportTeacherIdentities(item).forEach(teacherCode=>{
        const key=teacherCode+'|'+classCode+'|'+subjectCode;
         if(required.has(key)) scheduled.set(key,(scheduled.get(key)||0)+getScheduleWeeklyUnits(item));
      });
       const classSubjectKey=classCode+'|'+subjectCode;
        if(classSubjectRequired.has(classSubjectKey)) classSubjectScheduled.set(classSubjectKey,(classSubjectScheduled.get(classSubjectKey)||0)+getScheduleWeeklyUnits(item));
       reportAssignmentGroupKeys(item).forEach(assignmentGroupKey => {
         if (classSubjectGroupRequired.has(assignmentGroupKey)) classSubjectGroupScheduled.set(assignmentGroupKey, (classSubjectGroupScheduled.get(assignmentGroupKey) || 0) + getScheduleWeeklyUnits(item));
       });
     });
     const deficits=[]; required.forEach((item,key)=>{const placed=Math.min(item.required,scheduled.get(key)||0);if(item.required-placed>0.000001)deficits.push({...item,scheduled:placed,remaining:item.required-placed});});
      const violations=new Set(), classSlots=new Map(), teacherSlotItems=new Map(), teacherConsecutiveSlotItems=new Map(), roomSlotItems=new Map(), concurrent=new Map(), teacherDays=new Map(), teacherGradeDayCounts=new Map(), teacherGradePeriodGrades=new Map(), classSubjectDays=new Map(), classSubjectDayCounts=new Map(), classSubjectDayPeriods=new Map(), classSubjectDayEntries=new Map(), classSubjectGroupMeta=new Map(), classDaySubjects=new Map();
      const classEntriesConflict = (left, right) => {
        if (String(left?.subjectCode || '').trim() !== String(right?.subjectCode || '').trim()) return true;
        const leftGroups = reportAssignmentGroupKeys(left.entry || left);
        const rightGroups = reportAssignmentGroupKeys(right.entry || right);
        if (leftGroups.length === 0 || rightGroups.length === 0) return true;
        return leftGroups.some(groupKey => rightGroups.includes(groupKey));
      };
     const auditGroupSeparator = '\u001f';
    auditSchedule.forEach(item=>{
      const classCode=String(item['班級代碼']||''),teacherCodes=reportTeacherTokens(item),subjectCode=String(item['科目代碼']||''),day=parseInt(item['星期'],10),period=reportPeriod(item),weekType=reportWeekType(item);
       if(!classCode||!subjectCode||!Number.isFinite(day)||!Number.isFinite(period))return;
       const cls=idx.classByCode[classCode],grade=cls?String(cls['年級']||'').trim():String(classCode).charAt(0);
       const rules=state.subjectRules.filter(rule=>ruleAppliesToSubjectAndClass(rule,subjectCode,classCode,grade));
       const isMandatory=rules.some(rule=>rule['規則類型']==='必排'&&getRuleDaysPeriods(rule).some(slot=>slot.day===day&&slot.period===period));
       const classSubjectKey=classCode+'|'+subjectCode;
       const assignmentGroupKey = reportAssignmentGroupKeys(item)[0] || '';
       const spreadKey = assignmentGroupKey || classSubjectKey;
       classSubjectGroupMeta.set(spreadKey, { classCode, subjectCode, assignmentGroupKey });
        const ck=classCode+'|'+day+'|'+period+'|'+weekType;
        const classItems=classSlots.get(ck)||[];
        if(classItems.some(existing => classEntriesConflict(existing, { subjectCode, entry: item }))) violations.add('班級衝堂：'+classCode+' 星期'+day+'第'+period+'節'+(weekType!=='全週'?'（'+weekType+'）':''));
        classItems.push({ subjectCode, entry: item });
        classSlots.set(ck, classItems);
      teacherCodes.forEach(rawTeacherCode=>{
        const teacherCode = reportTeacherKey(rawTeacherCode);
        if(!teacherCode) return;
         const tk=teacherCode+'|'+day+'|'+period+'|'+weekType;
        const items=teacherSlotItems.get(tk)||[];
        const mainTeacher = reportTeacherTokens(item)[0] || '';
        items.push({
          classCode,
           subjectCode,
           isLocked:String(item['是否鎖定']||'').toUpperCase()==='TRUE',
           isMandatory,
           isMainTeacher: reportTeacherKey(mainTeacher) === teacherCode
         });
         teacherSlotItems.set(tk,items);
         if (!ignoredTeacherConsecutiveIds.has(String(item['課表ID'] || '').trim())) {
           const consecutiveItems = teacherConsecutiveSlotItems.get(tk) || [];
           consecutiveItems.push(items[items.length - 1]);
           teacherConsecutiveSlotItems.set(tk, consecutiveItems);
         }
        if(reportTeacherIdentities(rawTeacherCode).some(identity=>idx.blockSet.has(identity+'|'+day+'|'+period))) violations.add('教師不排課違規：'+teacherCode+' 星期'+day+'第'+period+'節');
         if(period<=7){const days=teacherDays.get(teacherCode)||[[],[],[],[],[]];if(!days[day-1].includes(period))days[day-1].push(period);teacherDays.set(teacherCode,days);}
         const groupWeekly = classSubjectGroupRequired.get(assignmentGroupKey) || classSubjectRequired.get(classCode+'|'+subjectCode) || 0;
         if(groupWeekly===1&&grade){
          const gradeMap=teacherGradeDayCounts.get(teacherCode)||new Map();
          const dayCounts=gradeMap.get(grade)||new Map();
          dayCounts.set(day,(dayCounts.get(day)||0)+1);
          gradeMap.set(grade,dayCounts);teacherGradeDayCounts.set(teacherCode,gradeMap);
          const periodMap=teacherGradePeriodGrades.get(teacherCode)||new Map();
          const dayPeriods=periodMap.get(day)||new Map();
          const periodGrades=dayPeriods.get(period)||new Set();
          periodGrades.add(grade);
          dayPeriods.set(period,periodGrades);periodMap.set(day,dayPeriods);teacherGradePeriodGrades.set(teacherCode,periodMap);
        }
      });
        const alternateCourse = isAlternateAssignment(classCode, subjectCode, item) || isAlternateEntry(item);
       if(isHelper(subjectCode)&&period!==8)violations.add('課後輔導節次錯誤：'+subjectCode+'（'+classCode+'）');
       if(!isHelper(subjectCode)&&!alternateCourse&&period===8)violations.add('一般課程排入第8節：'+subjectCode+'（'+classCode+'）');
       if(alternateCourse&&(period!==8||weekType==='全週'))violations.add('0.5 節單雙週課程必須排在第8節單週或雙週：'+subjectCode+'（'+classCode+'）');
      const roomCode=String(idx.subjectByCode[subjectCode]?.['所屬教室代碼']||'').trim();
       if(roomCode){const roomKey=roomCode+'|'+day+'|'+period+'|'+weekType;const roomItems=roomSlotItems.get(roomKey)||[];roomItems.push({classCode,subjectCode});roomSlotItems.set(roomKey,roomItems);}
       if(rules.some(rule=>rule['規則類型']==='禁排'&&getRuleDaysPeriods(rule).some(slot=>slot.day===day&&slot.period===period)))violations.add('科目禁排違規：'+subjectCode+'（'+classCode+'）');
      const must=rules.filter(rule=>rule['規則類型']==='必排');if(must.length&&!must.some(rule=>getRuleDaysPeriods(rule).some(slot=>slot.day===day&&slot.period===period)))violations.add('科目必排違規：'+subjectCode+'（'+classCode+'）');
       const concKey=subjectCode+'|'+day+'|'+period+'|'+weekType;concurrent.set(concKey,(concurrent.get(concKey)||0)+1);
        const classDayKey=classCode+'|'+day;if(!classDaySubjects.has(classDayKey))classDaySubjects.set(classDayKey,new Set());classDaySubjects.get(classDayKey).add(subjectCode);
         if(!classSubjectDays.has(spreadKey))classSubjectDays.set(spreadKey,new Set());classSubjectDays.get(spreadKey).add(day);
         const dayKey=spreadKey+auditGroupSeparator+day+auditGroupSeparator+weekType;classSubjectDayCounts.set(dayKey,(classSubjectDayCounts.get(dayKey)||0)+1);if(!classSubjectDayPeriods.has(dayKey))classSubjectDayPeriods.set(dayKey,new Set());classSubjectDayPeriods.get(dayKey).add(period);if(!classSubjectDayEntries.has(dayKey))classSubjectDayEntries.set(dayKey,[]);classSubjectDayEntries.get(dayKey).push(item);
     });
     const effectiveWeekTypes = entry => {
       const period = reportPeriod(entry);
       const attr = String(entry?.['課堂屬性'] || '').trim();
       if (period !== 8) return ['全週'];
       return attr === '單週' || attr === '雙週' ? [attr] : ['單週', '雙週'];
     };
     const classAuditSlots = new Map();
     const teacherAuditSlots = new Map();
     const roomAuditSlots = new Map();
     const subjectAuditSlots = new Map();
     auditSchedule.forEach(entry => {
       const classCode = String(entry['班級代碼'] || '').trim();
       const subjectCode = String(entry['科目代碼'] || '').trim();
       const day = reportPeriod(entry) && parseInt(entry['星期'], 10);
       const period = reportPeriod(entry);
       if (!classCode || !subjectCode || !Number.isFinite(day) || !Number.isFinite(period)) return;
       effectiveWeekTypes(entry).forEach(weekType => {
         const classKey = classCode + '|' + day + '|' + period + '|' + weekType;
         (classAuditSlots.get(classKey) || classAuditSlots.set(classKey, []).get(classKey)).push(entry);
         reportTeacherIdentities(entry).forEach(teacherCode => {
           const teacherKey = teacherCode + '|' + day + '|' + period + '|' + weekType;
           (teacherAuditSlots.get(teacherKey) || teacherAuditSlots.set(teacherKey, []).get(teacherKey)).push({
             classCode,
             subjectCode,
             isLocked: String(entry['是否鎖定'] || '').toUpperCase() === 'TRUE'
           });
         });
         const roomCode = String(idx.subjectByCode[subjectCode]?.['所屬教室代碼'] || '').trim();
         if (roomCode) {
           const roomKey = roomCode + '|' + day + '|' + period + '|' + weekType;
           (roomAuditSlots.get(roomKey) || roomAuditSlots.set(roomKey, []).get(roomKey)).push({ classCode, subjectCode });
         }
         if (!String(idx.classByCode[classCode]?.['是否虛擬班'] || '').toUpperCase().match(/^(TRUE|1|YES|是)$/)) {
           const subjectKey = subjectCode + '|' + day + '|' + period + '|' + weekType;
           subjectAuditSlots.set(subjectKey, (subjectAuditSlots.get(subjectKey) || 0) + 1);
         }
       });
     });
      classAuditSlots.forEach((items, key) => {
        if (items.some((item, index) => items.slice(index + 1).some(other => classEntriesConflict({ subjectCode: item['科目代碼'], entry: item }, { subjectCode: other['科目代碼'], entry: other })))) {
          violations.add('班級衝堂：' + key.replace(/\|/g, '／'));
        }
      });
      teacherAuditSlots.forEach((items, key) => {
        if (items.length < 2 || reportAllowedCombinedClassCohort(items)) return;
        const parts = key.split('|');
        const detail = items.map(item => item.subjectCode + '（' + item.classCode + '）').join('／');
        violations.add('教師衝堂：' + parts[0] + ' 星期' + parts[1] + '第' + parts[2] + '節（' + parts[3] + '）：' + detail);
      });
     roomAuditSlots.forEach((items, key) => {
       const roomCode = key.split('|')[0];
       const capacity = parseInt(idx.roomByCode?.[roomCode]?.['容量'] || '1', 10) || 1;
       if (items.length > capacity) violations.add('教室衝突：' + key.replace(/\|/g, '／') + '（' + items.length + '/' + capacity + '）');
     });
     subjectAuditSlots.forEach((count, key) => {
       const subjectCode = key.split('|')[0];
       const maximum = parseInt(idx.subjectByCode?.[subjectCode]?.['同時最多班數'] || '0', 10) || 0;
       if (maximum > 0 && count > maximum) violations.add('科目同時班數超限：' + key.replace(/\|/g, '／') + '（' + count + '/' + maximum + '）');
     });
      teacherSlotItems.forEach((items,key)=>{
        if(items.length<2)return;
        if(reportAllowedCombinedClassCohort(items))return;
         const parts=key.split('|'),teacherCode=parts[0],day=parts[1],period=parts[2],weekType=parts[3],detail=items.map(item=>item.subjectCode+'（'+item.classCode+'）').join('／');
         violations.add('教師衝堂：'+teacherCode+' 星期'+day+'第'+period+'節'+(weekType!=='全週'?'（'+weekType+'）':'')+'：'+detail);
      });
      const hardTeacherPeriods=new Map();
      teacherConsecutiveSlotItems.forEach((items,key)=>{
        if (!items.length) return;
         const parts=key.split('|'),teacherCode=parts[0],day=Number(parts[1]),period=Number(parts[2]),weekType=parts[3];
         if(!teacherCode||!Number.isInteger(day)||day<1||day>5||!Number.isInteger(period)||period<1||period>8)return;
         const teacherWeekKey=teacherCode+'|'+weekType;
         if(!hardTeacherPeriods.has(teacherWeekKey))hardTeacherPeriods.set(teacherWeekKey,new Map());
         const byDay=hardTeacherPeriods.get(teacherWeekKey);
        if(!byDay.has(day))byDay.set(day,new Set());
        byDay.get(day).add(period);
      });
      hardTeacherPeriods.forEach((byDay,teacherWeekKey)=>{
        const teacherParts=teacherWeekKey.split('|'),teacherCode=teacherParts[0],weekType=teacherParts[1];
        const teacher=idx.teacherByCode?.[teacherCode]||(state.teachers||[]).find(item=>String(item['教師姓名']||item['姓名']||'').trim()===teacherCode)||{};
        const maximum=parseInt(teacher['最大連堂節數']||'2',10)||2;
        if(maximum<=0||maximum>=8)return;
        for(let day=1;day<=5;day++){
          const periods=byDay.get(day)||new Set();
          for(let start=1;start<=8-maximum;start++){
            let exceeds=true;
            for(let period=start;period<=start+maximum;period++)if(!periods.has(period)){exceeds=false;break;}
            if(exceeds){
              violations.add('教師連堂超限：'+teacherCode+' 星期'+day+'第'+start+'至第'+(start+maximum)+'節'+(weekType!=='全週'?'（'+weekType+'）':'')+'（上限'+maximum+'）');
              break;
            }
          }
        }
      });
      let teacherExclusiveSoftViolations=0;
      (state.teacherExclusives||[]).forEach(rule=>{
       const teacherA=reportTeacherKey(rule['教師A']),teacherB=reportTeacherKey(rule['教師B']);
       if(!teacherA||!teacherB)return;
        for(let day=1;day<=5;day++)for(let period=1;period<=8;period++)for(const weekType of (period===8?['單週','雙週']:['全週'])){
          const keyA=teacherA+'|'+day+'|'+period+'|'+weekType,keyB=teacherB+'|'+day+'|'+period+'|'+weekType;
         const itemsA=teacherSlotItems.get(keyA)||[],itemsB=teacherSlotItems.get(keyB)||[],combined=[...itemsA,...itemsB];
         const subjects=[...new Set(combined.map(item=>item.subjectCode).filter(Boolean))];
         const mandatoryException=combined.length>0&&subjects.length===1&&combined.every(item=>item.isMandatory);
          if(itemsA.length>0&&itemsB.length>0&&!mandatoryException){
            if(allowSoftTeacherExclusives)teacherExclusiveSoftViolations++;
            else violations.add('教師互斥違規：'+teacherA+'／'+teacherB+' 星期'+day+'第'+period+'節');
          }
       }
     });
     const reportGroupList=value=>{
      if(Array.isArray(value))return value.map(item=>String(item).trim()).filter(Boolean);
     if(typeof value==='number')return String(value).match(/.{3}/g)||[];
       return String(value||'').split(/[,，]/).map(item=>item.trim()).filter(Boolean);
     };
      const reportBindMembers=group=>{
       if(typeof getConfiguredBindMembers==='function')return getConfiguredBindMembers(group);
       const classCodes=reportGroupList(group['班級清單']),subjectCodes=reportGroupList(group['科目清單']||group['科目代碼']),members=[];
       classCodes.forEach(classCode=>{
        const assignedSubjects=subjectCodes.filter(subjectCode=>(state.assignments||[]).some(assignment=>String(assignment['班級代碼']||'').trim()===classCode&&String(assignment['科目代碼']||'').trim()===subjectCode));
        (assignedSubjects.length?assignedSubjects:subjectCodes).forEach(subjectCode=>members.push({classCode,subjectCode}));
       });
       return members;
       };
       const reportBindCohorts=group=>{
        if(typeof getConfiguredBindCohorts==='function')return getConfiguredBindCohorts(group);
        return [{cohortIndex:0,members:reportBindMembers(group)}];
       };
       (state.blockGroups||[]).forEach(group=>{
         reportBindCohorts(group).forEach(cohort=>{
           const members=(cohort.members||[]).filter(member=>inScope(member.subjectCode));
           const classCodes=[...new Set(members.map(member=>String(member.classCode||'').trim()).filter(Boolean))];
           if(classCodes.length<2)return;
           const memberMatches=(item,member)=>
             String(item['班級代碼']||'').trim()===String(member.classCode||'').trim()&&
             String(item['科目代碼']||'').trim()===String(member.subjectCode||'').trim()&&
             (!member.assignmentGroupKey||reportAssignmentGroupKeys(item).includes(member.assignmentGroupKey));
           const signatures=classCodes.map(classCode=>{
             const classMembers=members.filter(member=>String(member.classCode||'').trim()===classCode);
             const slots=[...new Set(scopedSchedule.filter(item=>classMembers.some(member=>memberMatches(item,member)))
               .map(item=>parseInt(item['星期'],10)+'-'+parseInt(item['節次'],10)+'-'+reportWeekType(item)))].sort();
             return {classCode,signature:slots.join(','),label:slots.length?slots.join('、'):'未排'};
           });
           const canonical=signatures[0]?.signature||'';
           if(signatures.some(item=>item.signature!==canonical)){
             const notes=[...new Set(members.map(member=>String(member.assignmentNote||'').trim()).filter(Boolean))];
             const baseLabel=String(group['群組名稱']||group['群組ID']||classCodes.join('、'));
             const groupLabel=notes.length?baseLabel+'／'+notes.join('／'):baseLabel;
             const details=signatures.map(item=>item.classCode+'：'+item.label).join('；');
             violations.add('綁班不同步：'+groupLabel+'（'+details+'）');
           }
         });
       });
    roomSlotItems.forEach((items,key)=>{const roomCode=key.split('|')[0],capacity=parseInt(idx.roomByCode?.[roomCode]?.['容量']||'1',10)||1;if(items.length>capacity)violations.add('教室衝突：'+roomCode+' '+key.split('|')[1]+'-'+key.split('|')[2]+'（'+items.length+'/'+capacity+'）');});
    concurrent.forEach((count,key)=>{const subjectCode=key.split('|')[0],max=parseInt(idx.subjectByCode[subjectCode]?.['同時最多班數']||'0',10)||0;if(max>0&&count>max)violations.add('科目同時班數超限：'+key+'（'+count+'/'+max+'）');});
      classSubjectDayCounts.forEach((count,key)=>{if(count<2)return;const parts=key.split(auditGroupSeparator),spreadKey=parts[0],day=parts[1],weekType=parts[2],meta=classSubjectGroupMeta.get(spreadKey)||{},classCode=meta.classCode||spreadKey.split('|')[0],subjectCode=meta.subjectCode||spreadKey.split('|')[1],groupLabel=meta.assignmentGroupKey?String(state.assignments.find(assignment=>runtimeAssignmentGroupKey(assignment)===meta.assignmentGroupKey)?.['備註']||'').trim():'',mandatorySlots=typeof getMandatoryRuleDaySlots==='function'?getMandatoryRuleDaySlots(subjectCode,classCode,Number(day)):[],allowedPeriods=new Set(mandatorySlots.map(slot=>Number(slot.period))),actualPeriods=classSubjectDayPeriods.get(key)||new Set(),entries=classSubjectDayEntries.get(key)||[],lockedBlockOnly=entries.length>0&&entries.every(entry=>isLockedConsecutiveEntry(entry,auditSchedule)),isAllowed=lockedBlockOnly||(mandatorySlots.length>1&&count===mandatorySlots.length&&actualPeriods.size===count&&[...actualPeriods].every(period=>allowedPeriods.has(period)));if(!isAllowed)violations.add('同班同科同日重複：'+classCode+' '+subjectCode+(groupLabel?'（'+groupLabel+'）':'')+' 星期'+day+(weekType!=='全週'?'（'+weekType+'）':'')+'（'+count+'節）');});
      let teacherGaps=0,teacherImbalance=0,adjacentSubjectDays=0,teacherLongStreaks=0,teacherRepeatedPeriods=0,teacherAfternoonOverload=0,teacherPairSoftViolations=0,teacherCrossGradeSameDay=0,teacherCrossGradeAdjacent=0,subjectRelationSoftViolations=0;
     const subjectRelationSoftDetails=[];
     (state.subjectRelations||[]).forEach(rule=>{
       const pair=getSubjectRelationCodes(rule);
       if(pair.length!==2)return;
       classDaySubjects.forEach((subjects,key)=>{
         if(!subjects.has(pair[0])||!subjects.has(pair[1]))return;
         const parts=key.split('|'),classCode=parts[0],day=Number(parts[1]);
         const cls=idx.classByCode[classCode],grade=cls?String(cls['年級']||'').trim():String(classCode).charAt(0);
         if(!subjectRelationAppliesToClass(rule,classCode,grade))return;
          subjectRelationSoftViolations++;
         subjectRelationSoftDetails.push('科目關係同日：'+classCode+' 星期'+day+'「'+pair[0]+'／'+pair[1]+'」');
       });
    });
    teacherDays.forEach((days,teacherCode)=>{
      const counts=days.map(periods=>periods.length);teacherImbalance+=Math.max(...counts)-Math.min(...counts);
      const periodDays=[0,0,0,0,0,0,0],allPeriods=[];
      days.forEach((periods,d)=>{
        const sorted=[...new Set(periods)].sort((a,b)=>a-b);allPeriods.push(...sorted);sorted.forEach(period=>{if(period>=1&&period<=7)periodDays[period-1]++;});
        if (sorted.includes(1) && sorted.includes(7)) teacherPairSoftViolations++;
        if (sorted.includes(4) && sorted.includes(5)) teacherPairSoftViolations++;
        if(sorted.length>=2){const first=sorted[0],last=sorted[sorted.length-1],occupied=new Set(sorted);for(let p=first+1;p<last;p++)if(!occupied.has(p)&&!idx.blockSet.has(teacherCode+'|'+(d+1)+'|'+p))teacherGaps++;}
         const teacher=idx.teacherByCode?.[teacherCode]||(state.teachers||[]).find(item=>String(item['教師姓名']||item['姓名']||'').trim()===teacherCode)||{};
         const maximum=parseInt(teacher['最大連堂節數']||'2',10)||2;
         let streak=1;for(let i=1;i<sorted.length;i++){streak=sorted[i]===sorted[i-1]+1?streak+1:1;if(streak>maximum)teacherLongStreaks++;}
      });
      periodDays.forEach(count=>{teacherRepeatedPeriods+=Math.max(0,count-3);});
      const afternoonCount=allPeriods.filter(period=>period>=5&&period<=7).length;
      teacherAfternoonOverload+=Math.max(0,afternoonCount-Math.ceil(allPeriods.length*0.65));
    });
    teacherGradeDayCounts.forEach(gradeMap=>{
      if(gradeMap.size<2)return;
      gradeMap.forEach(dayCounts=>{
        const total=[...dayCounts.values()].reduce((sum,count)=>sum+count,0);
        const peak=Math.max(...dayCounts.values());
        teacherCrossGradeSameDay+=Math.max(0,total-peak);
      });
    });
    teacherGradePeriodGrades.forEach((dayMap,teacherCode)=>{
      if((teacherGradeDayCounts.get(teacherCode)?.size||0)<2)return;
      dayMap.forEach(periodMap=>{
        const periods=[...periodMap.keys()].sort((a,b)=>a-b);
        for(let i=0;i<periods.length-1;i++){
          if(periods[i+1]!==periods[i]+1)continue;
          const left=periodMap.get(periods[i]),right=periodMap.get(periods[i+1]);
          if(![...left].some(grade=>right.has(grade)))teacherCrossGradeAdjacent++;
        }
      });
    });
    let subjectMaxConsecutiveDays=0;
    classSubjectDays.forEach((set,key)=>{
      const days=[...set].sort((a,b)=>a-b);
      for(let i=1;i<days.length;i++)if(days[i]===days[i-1]+1)adjacentSubjectDays++;
       const meta=classSubjectGroupMeta.get(key)||{},classCode=meta.classCode||key.split('|')[0],subjectCode=meta.subjectCode||key.split('|')[1],groupKey=meta.assignmentGroupKey||'';
      const parsedMaxDays=parseInt(idx.subjectByCode[subjectCode]?.['最多連日']||'',10);
      const maxDays=Number.isFinite(parsedMaxDays)?parsedMaxDays:0;
      if(maxDays<=0||maxDays>=5)return;
       const weekly=classSubjectGroupRequired.get(groupKey)||classSubjectRequired.get(classCode+'|'+subjectCode)||0;
      const maxDistinctDays=5-Math.floor(5/(maxDays+1));
      if(weekly>maxDistinctDays)return;
      let streak=days.length?1:0;
      for(let i=1;i<days.length;i++){
        streak=days[i]===days[i-1]+1?streak+1:1;
        if(streak>maxDays){
          subjectMaxConsecutiveDays++;
          violations.add('科目連日超限：'+classCode+' '+subjectCode+'（最長'+streak+'日／上限'+maxDays+'日）');
          break;
        }
      }
    });
     const remainingLessons=[...classSubjectRequired.entries()].reduce((sum,[key,requiredWeekly])=>sum+Math.max(0,requiredWeekly-(classSubjectScheduled.get(key)||0)),0);
      const score=violations.size?0:Math.max(0,100-Math.min(50,remainingLessons*5)-Math.min(12,teacherGaps)-Math.min(10,adjacentSubjectDays)-Math.min(8,teacherImbalance)-Math.min(12,teacherLongStreaks*4)-Math.min(5,teacherRepeatedPeriods*2)-Math.min(3,teacherAfternoonOverload)-Math.min(6,teacherPairSoftViolations*2)-Math.min(6,teacherExclusiveSoftViolations*2)-Math.min(8,teacherCrossGradeSameDay*2)-Math.min(8,teacherCrossGradeAdjacent*2)-Math.min(12,subjectRelationSoftViolations*2));
    return {deficits,violations:[...violations],teacherGaps,teacherImbalance,adjacentSubjectDays,subjectMaxConsecutiveDays,teacherLongStreaks,teacherRepeatedPeriods,teacherAfternoonOverload,teacherPairSoftViolations,teacherExclusiveSoftViolations,teacherCrossGradeSameDay,teacherCrossGradeAdjacent,subjectRelationSoftViolations,subjectRelationSoftDetails,remainingLessons,score};
  };

  const renderedRevision = Object.create(null);
  const baseApplyData = applyData;
  applyData = function (data) {
    baseApplyData(data);
    ui.dataRevision = (ui.dataRevision || 0) + 1;
  };
  function renderPanel(name, force) {
    const revision = ui.dataRevision || 0;
    if (!force && renderedRevision[name] === revision) return false;
    try {
      if (name === 'config') { renderConfigTab(); renderBindGroupTab(); }
      if (name === 'constraints') renderConstraintsTab();
      if (name === 'stats') renderStatsTab();
      if (name === 'room') renderRoomSelect();
      renderedRevision[name] = revision;
      return true;
    } catch (error) {
      console.error('Render '+name+' failed:', error);
      return false;
    }
  }
  window.renderTabIfNeeded = renderPanel;
  renderAll = function () {
    renderClassSelect();
    renderTeacherSelect();
    renderRoomSelect();
    if (typeof renderThirdClassSelect === 'function') renderThirdClassSelect();
    if (typeof renderThirdRoomSelect === 'function') renderThirdRoomSelect();
    const active = document.querySelector('.tab-btn.active')?.dataset.tab || 'timetable';
    renderPanel(active);
    if (active === 'timetable') {
      if (ui.selectedClass) renderClassTT(ui.selectedClass);
      if (ui.selectedTeacher) renderTeacherTT(ui.selectedTeacher);
      if (typeof renderThirdTimetable === 'function') renderThirdTimetable();
    }
    if (active === 'room') {
      if (ui.selectedRoom) renderRoomTT(ui.selectedRoom);
    }
  };
})();
