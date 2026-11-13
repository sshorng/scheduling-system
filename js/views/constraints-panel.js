/* 排課限制工作台：教師不排課、科目排課規則與科目關係（容器事件委派，零猴子補丁） */

// ============================================================
// 限制設定
// ============================================================
function renderConstraintsTab() {
  renderBlockTeachers();
  renderBlockSlotGrid();
  renderBlockTable();
  renderRuleSubjectSelect();
  renderRuleClassSelect();
  renderRuleSlotGrid();
  renderRuleTable();
  renderSubjectRelationFormOptions();
  renderSubjectRelationTable();
  renderExclusiveTable();
  renderExclusiveTeacherDropdowns();
}

function toggleBlockSlot(day, per) {
  const key = day+'|'+per;
  if (ui.blockSlots.has(key)) ui.blockSlots.delete(key);
  else ui.blockSlots.add(key);
  renderBlockSlotGrid();
}

function toggleBlockDaySlots(day) {
  const allSelected = DISPLAY_PERIODS.every(p => ui.blockSlots.has(day+'|'+p));
  DISPLAY_PERIODS.forEach(p => {
    const key = day+'|'+p;
    if (allSelected) ui.blockSlots.delete(key); else ui.blockSlots.add(key);
  });
  renderBlockSlotGrid();
}

function toggleBlockPeriodSlots(per) {
  const allSelected = [1,2,3,4,5].every(d => ui.blockSlots.has(d+'|'+per));
  for (let d=1; d<=5; d++) {
    const key = d+'|'+per;
    if (allSelected) ui.blockSlots.delete(key); else ui.blockSlots.add(key);
  }
  renderBlockSlotGrid();
}

function blockSelectGroup(group) {
  const cbs = document.querySelectorAll('#block-teachers input[type=checkbox]');
  if (group==='all')  cbs.forEach(cb => { cb.checked = true; });
  if (group==='none') cbs.forEach(cb => { cb.checked = false; });
  if (group==='homeroom') {
    cbs.forEach(cb => {
      const t = idx.teacherByCode[cb.value];
      cb.checked = !!getTeacherHomeroom(t);
    });
  }
  if (group==='admin') {
    cbs.forEach(cb => {
      const t = idx.teacherByCode[cb.value];
      cb.checked = !!t && isTeacherAdmin(t);
    });
  }
  if (typeof renderBlockSelectionSummary === 'function') renderBlockSelectionSummary();
}

function blockSelectSubject(subCode) {
  const cbs = document.querySelectorAll('#block-teachers input[type=checkbox]');
  if (!subCode) return;

  // Find all teachers associated with this subject (from teacher info or assignments)
  const matchingTeacherCodes = new Set();
  state.teachers.forEach(t => {
    if (t['任教科目'] && t['任教科目'].includes(subCode)) {
      matchingTeacherCodes.add(t['教師姓名']);
    }
  });
  state.assignments.forEach(a => {
    if (String(a['科目代碼']) === String(subCode) && a['教師姓名']) {
      matchingTeacherCodes.add(a['教師姓名']);
    }
  });

  cbs.forEach(cb => {
    cb.checked = matchingTeacherCodes.has(cb.value);
  });
  toast(`已勾選 ${matchingTeacherCodes.size} 位授課 [${subCode}] 的教師`, 'info');
  if (typeof renderBlockSelectionSummary === 'function') renderBlockSelectionSummary();
}

function getSelectedTeacherCodes() {
  return Array.from(document.querySelectorAll('#block-teachers input:checked')).map(cb => cb.value);
}

function getRuleCheckValues(kind) {
  const wrap = document.getElementById(kind === 'subject' ? 'rule-subject-checks' : 'rule-class-checks');
  if (!wrap || typeof wrap.querySelectorAll !== 'function') return [];
  return Array.from(wrap.querySelectorAll('input[type="checkbox"]:checked')).map(input => String(input.value || '').trim()).filter(Boolean);
}

function setRuleChecks(kind, values) {
  const wrap = document.getElementById(kind === 'subject' ? 'rule-subject-checks' : 'rule-class-checks');
  if (!wrap || typeof wrap.querySelectorAll !== 'function') return;
  const selected = new Set(splitRuleScopeList(values));
  wrap.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = selected.has(String(input.value)); });
}

function toggleRuleChecks(kind, checked) {
  const wrap = document.getElementById(kind === 'subject' ? 'rule-subject-checks' : 'rule-class-checks');
  if (!wrap || typeof wrap.querySelectorAll !== 'function') return;
  wrap.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = checked; });
  renderRuleSelectionSummary();
}

function filterRuleChecks(kind, query) {
  const wrap = document.getElementById(kind === 'subject' ? 'rule-subject-checks' : 'rule-class-checks');
  if (!wrap || typeof wrap.querySelectorAll !== 'function') return;
  const q = String(query || '').trim().toLowerCase();
  wrap.querySelectorAll('label.color-class-item').forEach(label => {
    label.style.display = !q || label.textContent.toLowerCase().includes(q) ? 'inline-flex' : 'none';
  });
}

function renderRuleSubjectSelect() {
  const wrap = document.getElementById('rule-subject-checks');
  if (!wrap) return;
  const kept = new Set(getRuleCheckValues('subject'));
  wrap.innerHTML = state.subjects.map(subject => {
    const code = String(subject['科目代碼'] || '').trim();
    return '<label class="color-class-item" title="' + esc(code) + '">' +
      '<input type="checkbox" value="' + esc(code) + '"' + (kept.has(code) ? ' checked' : '') + ' onchange="renderRuleSelectionSummary()">' +
      '<span>' + esc(code) + '</span></label>';
  }).join('') || '<span class="text-muted text-xs">（無科目）</span>';
}

function renderRuleClassSelect() {
  const wrap = document.getElementById('rule-class-checks');
  if (!wrap) return;
  const kept = new Set(getRuleCheckValues('class'));
  wrap.innerHTML = state.classes.map(cls => {
    const code = String(cls['班級代碼'] || '').trim();
    const label = code + (cls['班級名稱'] ? ' ' + cls['班級名稱'] : '');
    return '<label class="color-class-item" title="' + esc(label) + '">' +
      '<input type="checkbox" value="' + esc(code) + '"' + (kept.has(code) ? ' checked' : '') + ' onchange="renderRuleSelectionSummary()">' +
      '<span>' + esc(label) + '</span></label>';
  }).join('') || '<span class="text-muted text-xs">（無班級）</span>';
}

function ensureRuleSlotGridDelegation(wrap) {
  if (!wrap || typeof wrap.addEventListener !== 'function' || wrap._ruleSlotDelegationBound) return;
  wrap._ruleSlotDelegationBound = true;
  wrap.addEventListener('click', event => {
    const target = event.target?.closest ? event.target.closest('[data-rule-action]') : null;
    if (!target || !wrap.contains(target)) return;
    const action = target.dataset.ruleAction;
    if (action === 'day') toggleDaySlots(parseInt(target.dataset.day, 10));
    else if (action === 'per') togglePeriodSlots(parseInt(target.dataset.per, 10));
    else if (action === 'slot') toggleRuleSlot(parseInt(target.dataset.day, 10), parseInt(target.dataset.per, 10));
  });
}

function renderRuleSlotGrid() {
  const wrap = document.getElementById('rule-slot-grid');
  if (!wrap) return;
  let html = '<table><thead><tr><th>節次</th>';
  DAYS.forEach((d, i) => {
    const dayN = i + 1;
    html += '<th class="th-day" data-rule-action="day" data-day="' + dayN + '" style="cursor:pointer;">' + d + '</th>';
  });
  html += '</tr></thead><tbody>';
  PERIODS.forEach(per => {
    html += '<tr><th class="th-per" data-rule-action="per" data-per="' + per + '" style="cursor:pointer;">第' + per + '</th>';
    for (let day = 1; day <= 5; day++) {
      const key = day + '|' + per;
      const isSel = ui.ruleSlots.has(key);
      html += '<td><button type="button" class="slot-btn ' + (isSel ? 'sel' : '') + '" data-rule-action="slot" data-day="' + day + '" data-per="' + per + '"></button></td>';
    }
    html += '</tr>';
  });
  wrap.innerHTML = html + '</tbody></table>';
  ensureRuleSlotGridDelegation(wrap);
  if (typeof renderRuleSelectionSummary === 'function') renderRuleSelectionSummary();
}

function toggleRuleSlot(day, per) {
  const key = day+'|'+per;
  if (ui.ruleSlots.has(key)) ui.ruleSlots.delete(key);
  else ui.ruleSlots.add(key);
  renderRuleSlotGrid();
}

function toggleDaySlots(day) {
  const allSelected = PERIODS.every(p => ui.ruleSlots.has(day+'|'+p));
  PERIODS.forEach(p => {
    const key = day+'|'+p;
    if (allSelected) ui.ruleSlots.delete(key); else ui.ruleSlots.add(key);
  });
  renderRuleSlotGrid();
}

function togglePeriodSlots(per) {
  const allSelected = [1,2,3,4,5].every(d => ui.ruleSlots.has(d+'|'+per));
  for (let d=1; d<=5; d++) {
    const key = d+'|'+per;
    if (allSelected) ui.ruleSlots.delete(key); else ui.ruleSlots.add(key);
  }
  renderRuleSlotGrid();
}

function teacherHasBlockSettings(teacherCode) {
  return state.teacherBlocks.some(block => {
    if (String(block['教師姓名'] || '') !== String(teacherCode || '')) return false;
    if (getTeacherBlockSlots(block).length > 0) return true;
    const day = parseInt(block['星期'], 10), period = parseInt(block['節次'], 10);
    return day >= 1 && day <= 5 && period >= 1 && period <= 8;
  });
}

function teacherBlockRowId(teacherCode) {
  return 'block-row-' + encodeURIComponent(String(teacherCode || ''));
}

function flashTeacherBlockTarget(element) {
  if (!element) return;
  element.classList.remove('is-focus');
  void element.offsetWidth;
  element.classList.add('is-focus');
  window.setTimeout(() => element.classList.remove('is-focus'), 1500);
}

function focusTeacherBlockRow(teacherCode) {
  const row = document.getElementById(teacherBlockRowId(teacherCode));
  if (!row) return;
  row.scrollIntoView({behavior:'smooth', block:'center'});
  flashTeacherBlockTarget(row);
}

function focusTeacherBlockPicker(teacherCode) {
  const checkbox = document.getElementById('block-cb-' + String(teacherCode || ''));
  const item = checkbox?.closest('.teacher-pick-item');
  if (!item) return;
  item.scrollIntoView({behavior:'smooth', block:'center'});
  flashTeacherBlockTarget(item);
}

function updateLocalTeacherBlockSlots(teacherCode, slots, clear, reason = '') {
  const target = new Set(slots.map(({day, period}) => day+'-'+period));
  const matching = state.teacherBlocks.filter(block => String(block['教師姓名']) === String(teacherCode));
  const pairs = new Set(matching.flatMap(getTeacherBlockSlots).map(({day, period}) => day+'-'+period));
  target.forEach(pair => clear ? pairs.delete(pair) : pairs.add(pair));
  state.teacherBlocks = state.teacherBlocks.filter(block => String(block['教師姓名']) !== String(teacherCode));
  if (pairs.size) state.teacherBlocks.push({
    '記錄ID': matching[0]?.['記錄ID'] || 'AUTO_B_' + Date.now(),
    '教師姓名': teacherCode,
    '時段': Array.from(pairs).sort().join(','),
    '原因': reason || matching[0]?.['原因'] || ''
  });
}

// 教師不排課索引已併入 buildIndex（新版「時段」陣列優先）

function toggleTeacherBlockSlot(teacherCode, day, period, target = 'primary') {
  if (!teacherCode) return;
  const key = teacherCode+'|'+day+'|'+period, clear = idx.blockSet.has(key);
  if (clear) idx.blockSet.delete(key); else idx.blockSet.add(key);
  updateLocalTeacherBlockSlots(teacherCode, [{day:+day, period:+period}], clear, '課表點擊標記不排課');
  updateTeacherBlockCell(teacherCode, day, period, target);
  if (document.getElementById('subpanel-constraints-block')?.style.display !== 'none') { renderBlockSlotGrid(); renderBlockTable(); renderBlockTeachers(); }
  const sentMutationVersion = _localMutationVersion + 1;
  gasPost('saveTeacherBlock', {teacherCodes:[teacherCode], pairs:day+'-'+period, reason:'課表點擊標記不排課', clear}, { silent: true })
    .then(res => {
      if (!res || !res.ok) {
        toast('不排課設定雲端同步失敗，請重新載入確認', 'warning');
        return;
      }
      if (res.data && Array.isArray(res.data.teacherBlocks)) {
        if (sentMutationVersion === _localMutationVersion) {
          state.teacherBlocks = res.data.teacherBlocks;
          buildIndex();
          bumpDataRevision();
          if (document.getElementById('subpanel-constraints-block')?.style.display !== 'none') { renderBlockSlotGrid(); renderBlockTable(); renderBlockTeachers(); }
        }
        return;
      }
      return loadAll({ background: true });
    })
    .catch(err => {
      console.error('Background save block error:', err);
      toast('不排課設定背景同步異常', 'warning');
    });
}

function ensureBlockSlotGridDelegation(wrap) {
  if (!wrap || typeof wrap.addEventListener !== 'function' || wrap._blockSlotDelegationBound) return;
  wrap._blockSlotDelegationBound = true;
  wrap.addEventListener('click', event => {
    const target = event.target?.closest ? event.target.closest('[data-block-action]') : null;
    if (!target || !wrap.contains(target)) return;
    const action = target.dataset.blockAction;
    if (action === 'day') toggleBlockDaySlots(parseInt(target.dataset.day, 10));
    else if (action === 'per') toggleBlockPeriodSlots(parseInt(target.dataset.per, 10));
    else if (action === 'slot') toggleBlockSlot(parseInt(target.dataset.day, 10), parseInt(target.dataset.per, 10));
  });
}

function renderBlockSlotGrid() {
  const wrap = document.getElementById('block-slot-grid');
  if (!wrap) return;
  let html = '<table><thead><tr><th>節次</th>';
  DAYS.forEach((name, index) => {
    const day = index + 1;
    html += '<th class="th-day" data-block-action="day" data-day="' + day + '" style="cursor:pointer;">' + name + '</th>';
  });
  html += '</tr></thead><tbody>';
  DISPLAY_PERIODS.forEach(period => {
    html += '<tr><th class="th-per" data-block-action="per" data-per="' + period + '" style="cursor:pointer;">' + periodLabel(period) + '</th>';
    for (let day = 1; day <= 5; day++) {
      const selected = ui.blockSlots.has(day + '|' + period);
      const hasBlock = state.teacherBlocks.some(block => getTeacherBlockSlots(block).some(slot => slot.day === day && slot.period === period));
      html += '<td><button type="button" class="slot-btn ' + (selected ? 'sel' : '') + (hasBlock && !selected ? ' has-block' : '') + '" data-block-action="slot" data-day="' + day + '" data-per="' + period + '"></button></td>';
    }
    html += '</tr>';
  });
  wrap.innerHTML = html + '</tbody></table>';
  ensureBlockSlotGridDelegation(wrap);
  if (typeof renderBlockSelectionSummary === 'function') renderBlockSelectionSummary();
}

// ===== 限制清單：編輯與刪除 =====
function actionButtons(editName, deleteName, id) {
  const safeId = encodeURIComponent(String(id || ''));
  return '<div class="flex gap-1">'+
    '<button class="btn btn-ghost btn-xs" onclick="'+editName+'(decodeURIComponent(\''+safeId+'\'))">✏️ 編輯</button>'+
    '<button class="btn btn-danger btn-xs" onclick="'+deleteName+'(decodeURIComponent(\''+safeId+'\'))">🗑 刪除</button></div>';
}

async function deleteTeacherBlock(id) {
  const block = state.teacherBlocks.find(item => String(item['記錄ID']) === String(id));
  if (!block) return;
  const teacher = idx.teacherByCode[block['教師姓名']];
  const confirmed = await showModal('確認刪除', '確定刪除 '+(teacher ? (teacher['教師姓名'] || teacher['姓名']) : block['教師姓名'])+' 的此筆不排課設定？', 'confirm');
  if (!confirmed) return;

  bgSync({
    actionName: '刪除教師不排課',
    snapshotKeys: ['teacherBlocks'],
    applyLocal: () => {
      if (ui.editingBlockId === String(id)) ui.editingBlockId = '';
      state.teacherBlocks = state.teacherBlocks.filter(item => String(item['記錄ID']) !== String(id));
      renderBlockTable();
      renderBlockTeachers();
      renderBlockSlotGrid();
    },
    gasTask: () => gasPost('deleteMeta', {type:'不排課', key:id})
  });
}

async function applyBlock(clear) {
  if (clear && ui.editingBlockId) { cancelTeacherBlockEdit(); return; }
  const teacherCodes = getSelectedTeacherCodes();
  if (!teacherCodes.length) { toast('請至少勾選一位教師', 'warning'); return; }
  if (!ui.blockSlots.size) { toast('請選擇至少一個時段', 'warning'); return; }
  const pairs = Array.from(ui.blockSlots).map(key => key.replace('|','-')).sort().join(',');
  const reason = document.getElementById('block-reason').value.trim();
  const editingId = ui.editingBlockId;

  // 樂觀更新本地資料
  const newBlocks = [];
  teacherCodes.forEach(tc => {
    newBlocks.push({
      '記錄ID': editingId || ('TB' + Date.now() + '_' + tc),
      '教師姓名': tc,
      '時段': pairs,
      '原因': reason
    });
  });

  bgSync({
    actionName: editingId ? '更新教師不排課' : (clear ? '清除教師不排課' : '設定教師不排課'),
    snapshotKeys: ['teacherBlocks'],
    applyLocal: () => {
      if (editingId) {
        state.teacherBlocks = state.teacherBlocks.filter(b => String(b['記錄ID']) !== String(editingId));
      }
      if (!clear) {
        state.teacherBlocks.push(...newBlocks);
      }
      ui.editingBlockId = ''; ui.blockSlots.clear(); document.getElementById('block-reason').value = '';
      setTeacherBlockEditMode(false);
      renderBlockTable();
      renderBlockTeachers();
      renderBlockSlotGrid();
    },
    gasTask: () => gasPost('saveTeacherBlock', {
      teacherCodes,
      pairs,
      reason,
      clear,
      ...(editingId ? { replaceBlockId: editingId } : {})
    }),
    onSuccess: res => {
      if (res && res.data && Array.isArray(res.data.teacherBlocks)) {
        state.teacherBlocks = res.data.teacherBlocks;
        buildIndex();
        renderBlockTable();
        renderBlockTeachers();
        renderBlockSlotGrid();
      }
    }
  });
}

function renderBlockTable() {
  const tbody = document.getElementById('block-tbody');
  if (!tbody) return;
  const teacherOrder = new Map(state.teachers.map((teacher, index) => [String(teacher['教師姓名'] || ''), index]));
  const rows = state.teacherBlocks.map((block, index) => ({ block, index })).sort((a, b) => {
    const aCode = String(a.block['教師姓名'] || ''), bCode = String(b.block['教師姓名'] || '');
    const aOrder = teacherOrder.has(aCode) ? teacherOrder.get(aCode) : Number.MAX_SAFE_INTEGER;
    const bOrder = teacherOrder.has(bCode) ? teacherOrder.get(bCode) : Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder || a.index - b.index;
  });
  tbody.innerHTML = rows.map(({ block }) => {
    const teacherCode = String(block['教師姓名'] || ''), teacher = idx.teacherByCode[teacherCode];
    const slotList = getTeacherBlockSlots(block);
    const slots = compressSlots(slotList).join('、') || '—';
    const teacherName = teacher ? (teacher['教師姓名'] || teacher['姓名']) : (block['教師姓名'] || '未指定');
    return '<tr id="' + esc(teacherBlockRowId(teacherCode)) + '" class="teacher-block-row"><td><button type="button" class="block-teacher-link" data-teacher-code="' + esc(teacherCode) + '">' + esc(teacherName) + '</button></td><td class="block-slot-summary" title="' + esc(slots) + '">' + esc(slots) + '</td><td>' + esc(block['原因'] || '') + '</td><td>' + actionButtons('editTeacherBlock', 'deleteTeacherBlock', block['記錄ID']) + '</td></tr>';
  }).join('');
  if (!tbody._blockTableDelegated && typeof tbody.addEventListener === 'function') {
    tbody._blockTableDelegated = true;
    tbody.addEventListener('click', event => {
      const link = event.target?.closest ? event.target.closest('.block-teacher-link') : null;
      if (link && tbody.contains(link)) {
        focusTeacherBlockPicker(link.dataset.teacherCode || '');
      }
    });
  }
}

function setSubjectRuleEditMode(editing) {
  const apply = document.getElementById('rule-apply-btn');
  const clear = document.getElementById('rule-clear-btn');
  if (apply) apply.textContent = editing ? '💾 儲存修改' : '📌 套用規則';
  if (clear) clear.textContent = editing ? '↩️ 取消編輯' : '🗑 清除規則';
}

function cancelSubjectRuleEdit() {
  ui.editingRuleId = '';
  ui.ruleSlots.clear();
  const subject = document.getElementById('rule-subject');
  const grade = document.getElementById('rule-grade');
  const type = document.getElementById('rule-type');
  if (subject) subject.value = '';
  const subjectChecks = document.getElementById('rule-subject-checks');
  const classChecks = document.getElementById('rule-class-checks');
  if (subjectChecks && typeof subjectChecks.querySelectorAll === 'function') subjectChecks.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = false; });
  if (classChecks && typeof classChecks.querySelectorAll === 'function') classChecks.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = false; });
  if (grade) grade.value = '全校';
  if (type) type.value = '必排';
  setSubjectRuleEditMode(false);
  renderRuleSlotGrid();
  toast('已取消編輯，原有科目時段規則沒有變更', 'info');
}
function editSubjectRule(id) {
  const rule = state.subjectRules.find(item => String(item['規則ID']) === String(id));
  if (!rule) { toast('找不到科目時段規則', 'error'); return; }
  setRuleChecks('subject', getRuleSubjectCodes(rule));
  setRuleChecks('class', getRuleClassCodes(rule));
  document.getElementById('rule-grade').value = String(rule['適用年級'] || '全校');
  document.getElementById('rule-type').value = rule['規則類型'] || '必排';
  ui.ruleSlots = new Set(getRuleDaysPeriods(rule).map(({day, period}) => day+'|'+period));
  ui.editingRuleId = String(id);
  setSubjectRuleEditMode(true);
  renderRuleSlotGrid();
  document.getElementById('subpanel-constraints-rule')?.scrollIntoView({behavior:'smooth', block:'start'});
  toast('已帶入科目時段規則；修改後點擊「套用規則」儲存', 'info');
}

async function deleteSubjectRule(id) {
  const rule = state.subjectRules.find(item => String(item['規則ID']) === String(id));
  if (!rule) return;
  const subjectLabel = getRuleSubjectCodes(rule).join('、') || '未指定科目';
  const classLabel = getRuleClassCodes(rule).join('、') || '依年級';
  const confirmed = await showModal('確認刪除', '確定刪除「'+subjectLabel+'／'+classLabel+'」的此筆時段規則？', 'confirm');
  if (!confirmed) return;

  bgSync({
    actionName: '刪除科目時段規則',
    snapshotKeys: ['subjectRules'],
    applyLocal: () => {
      if (ui.editingRuleId === String(id)) ui.editingRuleId = '';
      state.subjectRules = state.subjectRules.filter(item => String(item['規則ID']) !== String(id));
      renderRuleTable();
      renderRuleSlotGrid();
    },
    gasTask: () => gasPost('deleteMeta', {type:'科目規則', key:id})
  });
}

function subjectRuleMatchesClearTarget(rule, subjectCodes, classCodes, grade, type, pairs) {
  return sameRuleScopeList(rule['科目代碼'], subjectCodes) &&
    sameRuleScopeList(rule['適用班級'], classCodes) &&
    String(rule['適用年級'] || '全校').trim() === String(grade || '全校').trim() &&
    String(rule['規則類型'] || '').trim() === String(type || '').trim() &&
    (!pairs || String(rule['時段'] || '') === String(pairs));
}

async function applySubjectRule(clear) {
  if (clear && ui.editingRuleId) { cancelSubjectRuleEdit(); return; }
  const subjectCodes = getRuleCheckValues('subject');
  const classCodes = getRuleCheckValues('class');
  const grade = document.getElementById('rule-grade')?.value || '全校';
  const type = document.getElementById('rule-type').value;
  if (!subjectCodes.length) { toast('請至少選擇一個科目', 'warning'); return; }
  if (!clear && !ui.ruleSlots.size) { toast('請選擇至少一個時段', 'warning'); return; }
  const subjectCode = subjectCodes.join(',');
  const classCode = classCodes.join(',');
  const pairs = Array.from(ui.ruleSlots).map(key => key.replace('|','-')).sort().join(',');
  const editingId = ui.editingRuleId;
  const existingRule = editingId
    ? state.subjectRules.find(rule => String(rule['規則ID']) === String(editingId))
    : null;

  const newRule = {
    '規則ID': editingId || ('SR' + Date.now()),
    '科目代碼': subjectCode,
    '適用年級': grade,
    '適用班級': classCode,
    '時段': pairs,
    '規則類型': type,
    '備註': existingRule?.['備註'] || ''
  };

  bgSync({
    actionName: editingId ? '更新科目時段規則' : (clear ? '清除科目時段規則' : '套用科目時段規則'),
    snapshotKeys: ['subjectRules'],
    applyLocal: () => {
      if (clear) {
        state.subjectRules = state.subjectRules.filter(rule =>
          !subjectRuleMatchesClearTarget(rule, subjectCodes, classCodes, grade, type, pairs)
        );
      } else if (editingId) {
        state.subjectRules = state.subjectRules.filter(r => String(r['規則ID']) !== String(editingId));
        state.subjectRules.push(newRule);
      } else {
        state.subjectRules.push(newRule);
      }
      ui.editingRuleId = ''; ui.ruleSlots.clear(); setSubjectRuleEditMode(false);
      setRuleChecks('subject', []);
      setRuleChecks('class', []);
      renderRuleTable();
      renderRuleSlotGrid();
    },
    gasTask: () => gasPost('saveSubjectRule', {
      id: newRule['規則ID'],
      subjectCode,
      subjectCodes,
      classCode,
      classCodes,
      grade,
      type,
      pairs,
      clear,
      ...(editingId ? { replaceRuleId: editingId } : {})
    }),
    onSuccess: res => {
      if (res && res.data && Array.isArray(res.data.subjectRules)) {
        state.subjectRules = res.data.subjectRules;
        buildIndex();
        renderRuleTable();
        renderRuleSlotGrid();
      }
    }
  });
}

function renderRuleTable() {
  const tbody = document.getElementById('rule-tbody'); tbody.innerHTML = '';
  state.subjectRules.forEach(rule => {
    const required = rule['規則類型'] === '必排';
    const grade = String(rule['適用年級'] || '全校').trim();
    const gradeTag = grade === '全校' ? '全校' : grade+' 年級';
    const subjectCodes = getRuleSubjectCodes(rule);
    const classCodes = getRuleClassCodes(rule);
    const subjectLabel = subjectCodes.join('、') || '—';
    const classLabel = classCodes.join('、') || '依年級';
    const slots = compressSlots(getRuleDaysPeriods(rule)).join('、') || '—';
    tbody.innerHTML += '<tr><td title="'+esc(subjectLabel)+'">'+esc(subjectLabel)+'</td><td><span class="badge badge-gray">'+esc(gradeTag)+'</span></td><td title="'+esc(classLabel)+'">'+esc(classLabel)+'</td><td><span class="badge '+(required?'badge-green':'badge-red')+'">'+esc(rule['規則類型'])+'</span></td><td>'+esc(slots)+'</td><td>'+actionButtons('editSubjectRule','deleteSubjectRule',rule['規則ID'])+'</td></tr>';
  });
}

function renderSubjectRelationFormOptions() {
  const selects = [document.getElementById('relation-subject-a'), document.getElementById('relation-subject-b')];
  const options = '<option value="">請選擇科目</option>' + state.subjects.map(subject => {
    const code = String(subject['科目代碼'] || '').trim();
    return code ? '<option value="' + esc(code) + '">' + esc(code) + '</option>' : '';
  }).join('');
  selects.forEach(select => {
    if (!select) return;
    const kept = select.value;
    select.innerHTML = options;
    if (kept && state.subjects.some(subject => String(subject['科目代碼'] || '').trim() === kept)) select.value = kept;
  });
}

function setSubjectRelationEditMode(editing) {
  const save = document.getElementById('relation-save-btn');
  const cancel = document.getElementById('relation-cancel-btn');
  if (save) save.textContent = editing ? '💾 儲存修改' : '➕ 新增科目關係';
  if (cancel) cancel.style.display = editing ? 'inline-flex' : 'none';
}

function cancelSubjectRelationEdit(showNotice = true) {
  ui.editingSubjectRelationId = '';
  const subjectA = document.getElementById('relation-subject-a');
  const subjectB = document.getElementById('relation-subject-b');
  const grade = document.getElementById('relation-grade');
  const classCode = document.getElementById('relation-class');
  const remark = document.getElementById('relation-remark');
  if (subjectA) subjectA.value = '';
  if (subjectB) subjectB.value = '';
  if (grade) grade.value = '全校';
  if (classCode) classCode.value = '';
  if (remark) remark.value = '';
  setSubjectRelationEditMode(false);
  if (showNotice) toast('已取消編輯，原有科目關係沒有變更', 'info');
}

function editSubjectRelation(id) {
  const relation = (state.subjectRelations || []).find(item => String(item['規則ID']) === String(id));
  if (!relation) { toast('找不到科目關係', 'error'); return; }
  renderSubjectRelationFormOptions();
  document.getElementById('relation-subject-a').value = String(relation['科目A'] || '');
  document.getElementById('relation-subject-b').value = String(relation['科目B'] || '');
  document.getElementById('relation-grade').value = String(relation['適用年級'] || '全校');
  document.getElementById('relation-class').value = String(relation['適用班級'] || '');
  document.getElementById('relation-remark').value = String(relation['備註'] || '');
  ui.editingSubjectRelationId = String(id);
  setSubjectRelationEditMode(true);
  document.getElementById('subpanel-constraints-relation')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function subjectRelationMatchesScope(left, right) {
  return String(left?.['適用年級'] || '全校').trim() === String(right?.['適用年級'] || '全校').trim() &&
    sameRuleScopeList(left?.['適用班級'], right?.['適用班級']);
}

async function deleteSubjectRelation(id) {
  const relation = (state.subjectRelations || []).find(item => String(item['規則ID']) === String(id));
  if (!relation) return;
  const pair = getSubjectRelationCodes(relation).join('／');
  const confirmed = await showModal('確認刪除', '確定刪除「' + pair + '」的科目關係？', 'confirm');
  if (!confirmed) return;

  bgSync({
    actionName: '刪除科目關係',
    snapshotKeys: ['subjectRelations'],
    applyLocal: () => {
      state.subjectRelations = (state.subjectRelations || []).filter(item => String(item['規則ID']) !== String(id));
      if (ui.editingSubjectRelationId === String(id)) cancelSubjectRelationEdit(false);
      renderSubjectRelationTable();
    },
    gasTask: () => gasPost('deleteMeta', { type: '科目關係', key: id })
  });
}

async function saveSubjectRelation() {
  const subjectA = String(document.getElementById('relation-subject-a')?.value || '').trim();
  const subjectB = String(document.getElementById('relation-subject-b')?.value || '').trim();
  const grade = String(document.getElementById('relation-grade')?.value || '全校').trim() || '全校';
  const classCodes = [...new Set(splitRuleScopeList(document.getElementById('relation-class')?.value))];
  const remark = String(document.getElementById('relation-remark')?.value || '').trim();
  if (!subjectA || !subjectB) { toast('請選擇科目 A 與科目 B', 'warning'); return; }
  if (subjectA === subjectB) { toast('科目 A 與科目 B 不可相同', 'warning'); return; }

  const editingId = String(ui.editingSubjectRelationId || '');
  const newRule = {
    '規則ID': editingId || ('SREL' + Date.now()),
    '科目A': subjectA,
    '科目B': subjectB,
    '適用年級': grade,
    '適用班級': classCodes.join(','),
    '備註': remark
  };
  const duplicate = (state.subjectRelations || []).find(relation =>
    String(relation['規則ID']) !== editingId &&
    subjectRelationPairKey(relation['科目A'], relation['科目B']) === subjectRelationPairKey(subjectA, subjectB) &&
    subjectRelationMatchesScope(relation, newRule)
  );
  if (duplicate) { toast('相同科目組合與適用範圍已存在', 'warning'); return; }

  bgSync({
    actionName: editingId ? '更新科目關係' : '新增科目關係',
    snapshotKeys: ['subjectRelations'],
    applyLocal: () => {
      state.subjectRelations = (state.subjectRelations || []).filter(item => String(item['規則ID']) !== editingId);
      state.subjectRelations.push(newRule);
      cancelSubjectRelationEdit(false);
      renderSubjectRelationFormOptions();
      renderSubjectRelationTable();
    },
    gasTask: () => gasPost('saveSubjectRelation', { data: newRule })
  });
}

function renderSubjectRelationTable() {
  const tbody = document.getElementById('relation-tbody');
  if (!tbody) return;
  tbody.innerHTML = (state.subjectRelations || []).map(relation => {
    const pair = getSubjectRelationCodes(relation);
    const classes = getRuleClassCodes(relation);
    return '<tr>' +
      '<td>' + esc(pair[0] || '—') + '</td>' +
      '<td>' + esc(pair[1] || '—') + '</td>' +
      '<td><span class="badge badge-gray">' + esc(String(relation['適用年級'] || '全校')) + '</span></td>' +
      '<td title="' + esc(classes.join('、')) + '">' + esc(classes.join('、') || '依年級') + '</td>' +
      '<td>' + esc(relation['備註'] || '') + '</td>' +
      '<td>' + actionButtons('editSubjectRelation', 'deleteSubjectRelation', relation['規則ID']) + '</td>' +
      '</tr>';
  }).join('');
}

// 編輯教師不排課時，清除鍵僅取消編輯，不刪除既有資料。
function setTeacherBlockEditMode(editing) {
  const apply = document.getElementById('block-apply-btn');
  const clear = document.getElementById('block-clear-btn');
  if (apply) apply.textContent = editing ? '💾 儲存修改' : '⛔ 設定不排課';
  if (clear) clear.textContent = editing ? '↩️ 取消編輯' : '✅ 清除不排課';
  if (typeof renderTeacherBlockEditingNotice === 'function') renderTeacherBlockEditingNotice();
}

function cancelTeacherBlockEdit() {
  ui.editingBlockId = '';
  ui.blockSlots.clear();
  document.getElementById('block-reason').value = '';
  document.querySelectorAll('#block-teachers input[type=checkbox]').forEach(input => { input.checked = false; });
  setTeacherBlockEditMode(false);
  renderBlockSlotGrid();
  toast('已取消編輯，原有不排課設定沒有變更', 'info');
}

function editTeacherBlock(id) {
  const block = state.teacherBlocks.find(item => String(item['記錄ID']) === String(id));
  if (!block) { toast('找不到不排課設定', 'error'); return; }
  document.querySelectorAll('#block-teachers input[type=checkbox]').forEach(input => { input.checked = input.value === String(block['教師姓名']); });
  ui.blockSlots = new Set(getTeacherBlockSlots(block).map(({day, period}) => day+'|'+period));
  document.getElementById('block-reason').value = block['原因'] || '';
  ui.editingBlockId = String(id);
  setTeacherBlockEditMode(true);
  renderBlockSlotGrid();
  document.getElementById('subpanel-constraints-block')?.scrollIntoView({behavior:'smooth', block:'start'});
  toast('正在編輯；「取消編輯」不會刪除原設定', 'info');
}

// 限制工作台：即時顯示所選教師／科目與時段摘要。
function renderBlockSelectionSummary() {
  const target = document.getElementById('block-selection-summary');
  if (!target) return;
  const teachers = Array.from(document.querySelectorAll('#block-teachers input:checked')).map(input => idx.teacherByCode[input.value]?.['姓名'] || input.value);
  const slots = compressSlots(Array.from(ui.blockSlots).map(key => { const [day, period] = key.split('|').map(Number); return {day, period}; })).join('、');
  target.innerHTML = '<b>教師：</b>'+(teachers.length ? esc(teachers.join('、')) : '尚未選擇')+'<br><b>時段：</b>'+(slots ? esc(slots) : '尚未選擇');
}

function renderRuleSelectionSummary() {
  const target = document.getElementById('rule-selection-summary');
  if (!target) return;
  const subjects = getRuleCheckValues('subject');
  const classes = getRuleCheckValues('class');
  const grade = document.getElementById('rule-grade')?.value || '全校';
  const type = document.getElementById('rule-type')?.value || '必排';
  const slots = compressSlots(Array.from(ui.ruleSlots).map(key => { const [day, period] = key.split('|').map(Number); return {day, period}; })).join('、');
  const subjectLabel = subjects.length ? subjects.join('、') : '尚未選擇';
  const classLabel = classes.length ? classes.join('、') : '依年級';
  target.innerHTML = '<b>科目：</b>'+esc(subjectLabel)+'　<b>年級：</b>'+esc(grade === '全校' ? '全校' : grade+' 年級')+'<br><b>班級：</b>'+esc(classLabel)+'　<b>類型：</b>'+esc(type)+'　<b>時段：</b>'+(slots ? esc(slots) : '尚未選擇');
}

// 教師不排課：改用整齊的可捲動選取卡，保留既有勾選與批次功能。
function renderBlockTeachers() {
  const wrap = document.getElementById('block-teachers');
  if (!wrap) return;
  const selected = new Set(Array.from(wrap.querySelectorAll('input:checked')).map(input => input.value));
  wrap.innerHTML = '';
  state.teachers.forEach(teacher => {
    const code = String(teacher['教師姓名'] || ''), homeroom = getTeacherHomeroom(teacher), subjects = String(teacher['任教科目'] || '');
    const hasBlock = teacherHasBlockSettings(code);
    let tagText = '';
    if (homeroom && homeroom !== 'TRUE') tagText = homeroom + '導師';
    else if (homeroom === 'TRUE') tagText = '導師';
    else if (isTeacherAdmin(teacher)) tagText = String(teacher['職稱'] || '行政人員');
    else if (teacher['職稱']) tagText = String(teacher['職稱']);
    const titleText = formatTeacherCodeName(code, teacher) + (tagText ? '｜' + tagText : '') + (subjects ? '｜' + subjects : '');
    const label = document.createElement('label');
    label.className = 'teacher-pick-item' + (hasBlock ? ' has-block' : '');
    label.title = titleText + (hasBlock ? '｜已設定不排課，點擊姓名跳到目前設定' : '');
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = code; checkbox.id = 'block-cb-'+code; checkbox.checked = selected.has(code);
    const name = document.createElement('span'); name.className = 'teacher-pick-name'; name.textContent = (teacher['教師姓名'] || teacher['姓名']) || code;
    /* 點擊已設定不排課教師改由容器委派處理 */
    label.appendChild(checkbox); label.appendChild(name);
    if (tagText) { const tag = document.createElement('span'); tag.className = 'teacher-pick-tag'; tag.textContent = tagText; label.appendChild(tag); }
    wrap.appendChild(label);
  });
  if (!wrap._blockTeacherPickDelegated && typeof wrap.addEventListener === 'function') {
    wrap._blockTeacherPickDelegated = true;
    wrap.addEventListener('click', event => {
      const nameEl = event.target?.closest ? event.target.closest('.teacher-pick-name') : null;
      const itemEl = nameEl ? nameEl.closest('.teacher-pick-item.has-block') : null;
      if (!itemEl || !wrap.contains(itemEl)) return;
      const checkbox = itemEl.querySelector('input[type="checkbox"]');
      if (!checkbox) return;
      event.preventDefault();
      event.stopPropagation();
      focusTeacherBlockRow(checkbox.value);
    });
  }
  const select = document.getElementById('block-subject-select');
  if (select) {
    const current = select.value, subjects = new Set();
    state.subjects.forEach(subject => subjects.add(subject['科目代碼']));
    state.teachers.forEach(teacher => String(teacher['任教科目'] || '').split(/[、,，]/).map(value => value.trim()).filter(Boolean).forEach(value => subjects.add(value)));
    select.innerHTML = '<option value="">— 選擇科目 —</option>';
    Array.from(subjects).filter(Boolean).sort().forEach(subject => select.appendChild(new Option(subject, subject)));
    if (current) select.value = current;
  }
}
// 教師不排課編輯中的可見提示。
function renderTeacherBlockEditingNotice() {
  const notice = document.getElementById('block-editing-notice');
  if (!notice) return;
  const block = state.teacherBlocks.find(item => String(item['記錄ID']) === String(ui.editingBlockId || ''));
  if (!block) { notice.hidden = true; notice.textContent = ''; return; }
  const teacher = idx.teacherByCode[block['教師姓名']];
  const name = teacher ? (teacher['教師姓名'] || teacher['姓名']) : block['教師姓名'];
  const slots = compressSlots(getTeacherBlockSlots(block)).join('、') || '未設定時段';
  notice.textContent = '正在編輯：'+name;
  notice.hidden = false;
}

if (typeof window !== 'undefined') {
  window.actionButtons = actionButtons;
  window.renderBlockTable = renderBlockTable;
  window.renderRuleTable = renderRuleTable;
  window.editTeacherBlock = editTeacherBlock;
  window.deleteTeacherBlock = deleteTeacherBlock;
  window.editSubjectRule = editSubjectRule;
  window.deleteSubjectRule = deleteSubjectRule;
  window.editSubjectRelation = editSubjectRelation;
  window.deleteSubjectRelation = deleteSubjectRelation;
  window.saveSubjectRelation = saveSubjectRelation;
  window.cancelSubjectRelationEdit = cancelSubjectRelationEdit;
}
