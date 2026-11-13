/* 課表檢視、按需頁籤快取與容器層事件委派 */

const renderedRevision = Object.create(null);

function renderPanel(name, force) {
  const revision = ui.dataRevision || 0;
  if (!force && renderedRevision[name] === revision) return false;
  try {
    if (name === 'config') { renderConfigTab(); renderBindGroupTab(); }
    if (name === 'constraints') renderConstraintsTab();
    if (name === 'stats') renderStatsTab();
    if (name === 'seasonal' && typeof renderSeasonalWorkspace === 'function') renderSeasonalWorkspace();
    if (name === 'room') renderRoomSelect();
    renderedRevision[name] = revision;
    return true;
  } catch (error) {
    console.error('Render ' + name + ' failed:', error);
    return false;
  }
}
if (typeof window !== 'undefined') window.renderTabIfNeeded = renderPanel;

function renderAll() {
  renderClassSelect();
  renderTeacherSelect();
  renderRoomSelect();
  if (typeof renderThirdClassSelect === 'function') renderThirdClassSelect();
  if (typeof renderThirdRoomSelect === 'function') renderThirdRoomSelect();
  const active = document.querySelector('.tab-btn.active')?.dataset.tab || 'timetable';
  renderPanel(active);
  if (active === 'timetable') {
    if (ui.selectedClass) renderClassTT(ui.selectedClass, 'primary', { skipThird: true });
    if (ui.selectedTeacher) renderTeacherTT(ui.selectedTeacher, 'primary', { skipThird: true });
    if (typeof renderThirdTimetable === 'function' && ui.thirdOpen) renderThirdTimetable();
  }
  if (active === 'room') {
    if (ui.selectedRoom) renderRoomTT(ui.selectedRoom, 'primary', { skipThird: true });
    if (typeof renderThirdTimetable === 'function' && ui.thirdOpen) renderThirdTimetable();
  }
  if (typeof saveUIState === 'function') saveUIState();
}

function getTimetablePane(target = 'primary') {
  if (target === 'third') {
    return {
      target,
      classTT: 'third-class-tt', teacherTT: 'third-teacher-tt', roomTT: 'third-room-tt',
      classLabel: 'third-class-label', teacherLabel: 'third-teacher-label', roomLabel: 'third-room-label',
      classPalette: 'third-palette-list', classPaletteInfo: 'third-palette-class-info',
      teacherPalette: 'third-teacher-palette-list', teacherPaletteInfo: 'third-palette-teacher-info'
    };
  }
  return {
    target: 'primary',
    classTT: 'class-tt', teacherTT: 'teacher-tt', roomTT: 'room-tt',
    classLabel: 'class-label', teacherLabel: 'teacher-label', roomLabel: '',
    classPalette: 'palette-list', classPaletteInfo: 'palette-class-info',
    teacherPalette: 'teacher-palette-list', teacherPaletteInfo: 'palette-teacher-info'
  };
}

function clearTimetableDragHighlights() {
  document.querySelectorAll([
    '#class-tt .tt-cell', '#class-tt .p8-subcell', '#teacher-tt .tt-cell',
    '#third-class-tt .tt-cell', '#third-class-tt .p8-subcell', '#third-teacher-tt .tt-cell', '#third-patrol-tt .tt-cell'
  ].join(',')).forEach(el => el.classList.remove('drag-ok', 'drag-err', 'drag-warn'));
}

function showThirdTimetableMessage(containerId, message) {
  const container = document.getElementById(containerId);
  if (container) container.innerHTML = '<p style="padding:20px;color:var(--muted);font-size:13px;">' + esc(message) + '</p>';
}

function openThirdPatrolOverview() {
  ui.thirdOpen = true;
  applyThirdTimetableVisibility();
  setThirdTimetableView('patrol');
}

async function choosePatrolTeacherAtSlot(day, period) {
  const eligibleTeachers = state.teachers
    .filter(isPatrolEligibleTeacher);
  if (!eligibleTeachers.length) {
    toast('目前沒有符合資格的巡堂教師', 'warning');
    return;
  }
  if (hasPatrolAtSlot(day, period)) {
    toast('同一星期、節次只能安排一位巡堂教師', 'warning');
    return;
  }
  const availableTeachers = eligibleTeachers.filter(teacher => {
    const code = String(teacher['教師姓名'] || teacher['姓名'] || '').trim();
    return !(idx.schedByTeacherSlot[code + '|' + day + '|' + period] || []).length &&
      !idx.blockSet.has(code + '|' + day + '|' + period);
  });
  if (!availableTeachers.length) {
    toast('該時段沒有可安排巡堂的符合資格教師', 'warning');
    return;
  }
  const options = availableTeachers.map(teacher => {
    const code = String(teacher['教師姓名'] || teacher['姓名'] || '').trim();
    const title = String(teacher['職務'] || teacher['職稱'] || '').trim();
    return '<option value="' + esc(code) + '">' + esc(formatTeacherCodeName(code, teacher) + (title ? '｜' + title : '')) + '</option>';
  }).join('');
  const ok = await showModal(
    '新增巡堂',
    '<div style="margin-bottom:8px;">請選擇星期' + day + '第' + period + '節的巡堂教師：</div>' +
      '<select id="patrol-overview-teacher-select" style="width:100%;">' + options + '</select>',
    'confirm',
    '新增巡堂',
    '取消'
  );
  if (!ok) return;
  const select = document.getElementById('patrol-overview-teacher-select');
  const teacherCode = String(select?.value || '').trim();
  if (teacherCode) addPatrolAtTeacherSlot(teacherCode, day, period);
}

function focusPrimaryTeacherForPatrol(teacherCode) {
  const code = String(teacherCode || '').trim();
  if (!code) return;
  if (ui.activeTab !== 'timetable') activateMainTab('timetable');
  ui.selectedTeacher = code;
  const input = document.getElementById('sel-teacher');
  const teacher = idx.teacherByCode[code];
  if (input) {
    input.value = formatTeacherCodeName(code, teacher);
    if (input._updateControls) input._updateControls();
  }
  renderTeacherTT(code);
  saveUIState();
}

function focusTeacherAfterManualAssignment(teacherCode) {
  const code = String(teacherCode || '').trim();
  if (!code || ui.activeTab !== 'timetable') return;
  ui.selectedTeacher = code;
  const input = document.getElementById('sel-teacher');
  const teacher = idx.teacherByCode[code];
  if (input) {
    input.value = formatTeacherCodeName(code, teacher);
    if (input._updateControls) input._updateControls();
  }
}

function renderPatrolOverviewTT() {
  const label = document.getElementById('third-patrol-label');
  if (label) label.textContent = '已設定 ' + state.schedule.filter(isPatrolScheduleEntry).length + ' 節，拖曳巡堂格可修改巡堂時段';
  const patrolBySlot = new Map();
  state.schedule.filter(isPatrolScheduleEntry).forEach(row => {
    const key = parseInt(row['星期'], 10) + '|' + parseInt(row['節次'], 10);
    if (!patrolBySlot.has(key)) patrolBySlot.set(key, []);
    patrolBySlot.get(key).push(row);
  });
  const html = makeTable((day, period) => {
    const rows = patrolBySlot.get(day + '|' + period) || [];
    if (!rows.length) return { state: 'empty', draggable: false };
    return {
      state: 'filled',
      extra: ['patrol-overview'],
      text: '巡堂',
      meta: rows.map(row => {
        const code = String(row['教師姓名'] || '').trim();
        const teacher = idx.teacherByCode[code];
        return teacher ? (teacher['教師姓名'] || teacher['姓名'] || code) : code;
      }).join('／'),
      color: { bg: '#ede9fe', text: '#5b21b6' },
      flags: '巡',
      draggable: true
    };
  }, { periods: PERIODS });
  const patrolRows = state.schedule.filter(isPatrolScheduleEntry);
  const eligibleTeachers = state.teachers
    .filter(isPatrolEligibleTeacher);
  const counts = new Map();
  patrolRows.forEach(row => {
    const code = String(row['教師姓名'] || '').trim();
    counts.set(code, (counts.get(code) || 0) + 1);
  });
  const stats = document.getElementById('third-patrol-stats');
  if (stats) {
    stats.innerHTML = '<table class="patrol-stats-table"><thead><tr><th>教師</th><th>職務</th><th>巡堂節數</th></tr></thead><tbody>' + eligibleTeachers.map(teacher => {
      const code = String(teacher['教師姓名'] || teacher['姓名'] || '').trim();
      const title = String(teacher['職務'] || teacher['職稱'] || '').trim();
      return '<tr><td>' + esc(formatTeacherCodeName(code, teacher)) + '</td><td>' + esc(title || '未填職務') + '</td><td>' + (counts.get(code) || 0) + ' 節</td></tr>';
    }).join('') + '</tbody><tfoot><tr><td colspan="2">全校合計</td><td>' + patrolRows.length + ' 節</td></tr></tfoot></table>';
  }
  const container = document.getElementById('third-patrol-tt');
  if (!container) return;
  container.innerHTML = html;
  container._patrolRenderState = { patrolBySlot };
  ensurePatrolOverviewDelegation(container);
  container.querySelectorAll('.tt-cell').forEach(cell => {
    const day = parseInt(cell.dataset.day, 10);
    const period = parseInt(cell.dataset.per, 10);
    const rows = patrolBySlot.get(day + '|' + period) || [];
    if (rows.length) {
      cell.dataset.patrolDraggable = 'true';
      cell.draggable = true;
      cell.title = '點擊切換教師課表；拖曳修改，右鍵刪除';
    } else {
      cell.title = '點擊選擇巡堂教師';
    }
  });
}

function ensurePatrolOverviewDelegation(container) {
  if (!container || typeof container.addEventListener !== 'function' || container._patrolDelegationBound) return;
  container._patrolDelegationBound = true;
  const getState = () => container._patrolRenderState || { patrolBySlot: new Map() };
  const canDropPatrol = (dragInfo, targetCell, patrolBySlot) => {
    if (!dragInfo || !targetCell) return false;
    const targetDay = parseInt(targetCell.dataset.day, 10);
    const targetPeriod = parseInt(targetCell.dataset.per, 10);
    const targetRows = patrolBySlot.get(targetDay + '|' + targetPeriod) || [];
    const teacherCode = String(dragInfo.teacherCode || '').trim();
    const teacherCells = idx.schedByTeacherSlot[teacherCode + '|' + targetDay + '|' + targetPeriod] || [];
    return !targetRows.length &&
      !(dragInfo.day === targetDay && dragInfo.per === targetPeriod) &&
      !idx.blockSet.has(teacherCode + '|' + targetDay + '|' + targetPeriod) &&
      !teacherCells.length &&
      !hasPatrolAtSlot(targetDay, targetPeriod, dragInfo.cell && dragInfo.cell['課表ID']);
  };
  container.addEventListener('click', event => {
    const cell = event.target?.closest ? event.target.closest('.tt-cell') : null;
    if (!cell || !container.contains(cell) || ui.drag) return;
    const day = parseInt(cell.dataset.day, 10);
    const period = parseInt(cell.dataset.per, 10);
    const rows = getState().patrolBySlot.get(day + '|' + period) || [];
    if (rows.length) {
      focusPrimaryTeacherForPatrol(String(rows[0]['教師姓名'] || '').trim());
    } else {
      choosePatrolTeacherAtSlot(day, period);
    }
  });
  container.addEventListener('contextmenu', event => {
    const cell = event.target?.closest ? event.target.closest('.tt-cell') : null;
    if (!cell || !container.contains(cell)) return;
    const day = parseInt(cell.dataset.day, 10);
    const period = parseInt(cell.dataset.per, 10);
    const rows = getState().patrolBySlot.get(day + '|' + period) || [];
    if (!rows.length) return;
    event.preventDefault();
    deletePatrolCell(rows[0]['課表ID']);
  });
  container.addEventListener('dragstart', event => {
    const cell = event.target?.closest ? event.target.closest('.tt-cell') : null;
    if (!cell || !container.contains(cell)) return;
    const day = parseInt(cell.dataset.day, 10);
    const period = parseInt(cell.dataset.per, 10);
    const rows = getState().patrolBySlot.get(day + '|' + period) || [];
    if (!rows.length) return;
    const row = rows[0];
    const teacherCode = String(row['教師姓名'] || '').trim();
    ui.drag = { isPatrol: true, isPalette: false, cell: row, day, per: period, teacherCode };
    resetDragConflictCache();
    cell.style.opacity = '0.4';
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  });
  container.addEventListener('dragend', event => {
    const cell = event.target?.closest ? event.target.closest('.tt-cell') : null;
    ui.drag = null;
    if (cell) cell.style.opacity = '1';
    clearTimetableDragHighlights();
  });
  container.addEventListener('dragover', event => {
    if (!ui.drag || !ui.drag.isPatrol) return;
    const cell = event.target?.closest ? event.target.closest('.tt-cell') : null;
    if (!cell || !container.contains(cell)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    cell.classList.remove('drag-ok', 'drag-err', 'drag-warn');
    cell.classList.add(canDropPatrol(ui.drag, cell, getState().patrolBySlot) ? 'drag-ok' : 'drag-err');
  });
  container.addEventListener('dragleave', event => {
    const cell = event.target?.closest ? event.target.closest('.tt-cell') : null;
    if (cell) cell.classList.remove('drag-ok', 'drag-err', 'drag-warn');
  });
  container.addEventListener('drop', event => {
    if (!ui.drag || !ui.drag.isPatrol) return;
    const cell = event.target?.closest ? event.target.closest('.tt-cell') : null;
    if (!cell || !container.contains(cell)) return;
    event.preventDefault();
    const day = parseInt(cell.dataset.day, 10);
    const period = parseInt(cell.dataset.per, 10);
    const dragInfo = ui.drag;
    ui.drag = null;
    cell.classList.remove('drag-ok', 'drag-err', 'drag-warn');
    if (canDropPatrol(dragInfo, cell, getState().patrolBySlot)) {
      movePatrolCell(dragInfo.cell && dragInfo.cell['課表ID'], dragInfo.teacherCode, day, period);
    }
  });
}

function applyThirdTimetableVisibility() {
  const card = document.getElementById('third-timetable-card');
  const layout = document.getElementById('tt-layout');
  const toolbar = document.querySelector('.tt-layout-toolbar');
  const header = document.getElementById('third-timetable-header');
  const button = document.getElementById('toggle-third-timetable');
  if (!card || !layout) return;
  card.hidden = !ui.thirdOpen;
  layout.classList.toggle('third-open', ui.thirdOpen);
  if (toolbar) toolbar.classList.toggle('third-open', ui.thirdOpen);
  if (header) header.hidden = !ui.thirdOpen;
  if (button) {
    button.textContent = ui.thirdOpen ? '− 收合第三課表' : '＋ 開啟第三課表';
    button.setAttribute('aria-expanded', ui.thirdOpen ? 'true' : 'false');
  }
}

function setThirdTimetableView(view) {
  if (!['class', 'teacher', 'room', 'patrol'].includes(view)) return;
  ui.thirdView = view;
  document.querySelectorAll('.third-view-btn').forEach(button => {
    button.classList.toggle('active', button.dataset.thirdView === view);
  });
  ['class', 'teacher', 'room', 'patrol'].forEach(name => {
    const controls = document.getElementById('third-' + name + '-controls');
    const palette = document.getElementById('third-' + name + '-palette-box');
    const timetable = document.getElementById('third-' + name + '-tt');
  const active = name === view;
    if (controls) controls.hidden = !active;
    if (palette) palette.hidden = !active || name === 'room' || name === 'patrol';
    if (timetable) timetable.hidden = !active;
  });
  const patrolStats = document.getElementById('third-patrol-stats');
  if (patrolStats) patrolStats.hidden = view !== 'patrol';
  if (ui.thirdOpen) renderThirdTimetable();
  saveUIState();
}

function setThirdTimetableOpen(open) {
  ui.thirdOpen = Boolean(open);
  applyThirdTimetableVisibility();
  if (ui.thirdOpen) {
    setThirdTimetableView(ui.thirdView || 'class');
  } else {
    saveUIState();
  }
}

function renderThirdTimetable() {
  if (!ui.thirdOpen) return;
  applyThirdTimetableVisibility();
  if (ui.thirdView === 'class') {
    if (ui.thirdSelectedClass) renderClassTT(ui.thirdSelectedClass, 'third');
    else showThirdTimetableMessage('third-class-tt', '請選擇班級');
  } else if (ui.thirdView === 'teacher') {
    if (ui.thirdSelectedTeacher) renderTeacherTT(ui.thirdSelectedTeacher, 'third');
    else showThirdTimetableMessage('third-teacher-tt', '請選擇教師');
  } else if (ui.thirdView === 'room') {
    if (ui.thirdSelectedRoom) renderRoomTT(ui.thirdSelectedRoom, 'third');
    else showThirdTimetableMessage('third-room-tt', '請選擇教室');
  } else if (ui.thirdView === 'patrol') {
    renderPatrolOverviewTT();
  }
}

function initThirdTimetable() {
  const toggleButton = document.getElementById('toggle-third-timetable');
  const closeButton = document.getElementById('close-third-timetable');
  if (toggleButton) toggleButton.addEventListener('click', () => setThirdTimetableOpen(!ui.thirdOpen));
  if (closeButton) closeButton.addEventListener('click', () => setThirdTimetableOpen(false));
  document.querySelectorAll('.third-view-btn').forEach(button => {
    button.addEventListener('click', () => setThirdTimetableView(button.dataset.thirdView));
  });
  const classSelect = document.getElementById('third-class-select');
  if (classSelect) classSelect.addEventListener('change', function () {
    ui.thirdSelectedClass = this.value;
    if (this.value) renderClassTT(this.value, 'third');
    else showThirdTimetableMessage('third-class-tt', '請選擇班級');
    saveUIState();
  });
  const roomSelect = document.getElementById('third-room-select');
  if (roomSelect) roomSelect.addEventListener('change', function () {
    ui.thirdSelectedRoom = this.value;
    if (this.value) renderRoomTT(this.value, 'third');
    else showThirdTimetableMessage('third-room-tt', '請選擇教室');
    saveUIState();
  });
  applyThirdTimetableVisibility();
  setThirdTimetableView(ui.thirdView || 'class');
}

// UI 狀態持久化（跨重整/刷新記錄位置）
function saveUIState() {
  if (ui.activeTab) localStorage.setItem('tt_activeTab', ui.activeTab);
  if (ui.selectedClass) localStorage.setItem('tt_selectedClass', ui.selectedClass);
  if (ui.selectedTeacher) localStorage.setItem('tt_selectedTeacher', ui.selectedTeacher);
  if (ui.selectedRoom) localStorage.setItem('tt_selectedRoom', ui.selectedRoom);
  localStorage.setItem('tt_thirdOpen', ui.thirdOpen ? '1' : '0');
  if (ui.thirdView) localStorage.setItem('tt_thirdView', ui.thirdView);
  if (ui.thirdSelectedClass) localStorage.setItem('tt_thirdClass', ui.thirdSelectedClass);
  if (ui.thirdSelectedTeacher) localStorage.setItem('tt_thirdTeacher', ui.thirdSelectedTeacher);
  if (ui.thirdSelectedRoom) localStorage.setItem('tt_thirdRoom', ui.thirdSelectedRoom);
}

function restoreUIState() {
  const savedTab = localStorage.getItem('tt_activeTab');
  if (savedTab) ui.activeTab = savedTab;
  const savedClass = localStorage.getItem('tt_selectedClass');
  if (savedClass) ui.selectedClass = savedClass;
  const savedTea = localStorage.getItem('tt_selectedTeacher');
  if (savedTea) ui.selectedTeacher = savedTea;
  const savedRoom = localStorage.getItem('tt_selectedRoom');
  if (savedRoom) ui.selectedRoom = savedRoom;
  ui.thirdOpen = localStorage.getItem('tt_thirdOpen') === '1';
  const savedThirdView = localStorage.getItem('tt_thirdView');
  if (savedThirdView === 'class' || savedThirdView === 'teacher' || savedThirdView === 'room' || savedThirdView === 'patrol') ui.thirdView = savedThirdView;
  const savedThirdClass = localStorage.getItem('tt_thirdClass');
  if (savedThirdClass) ui.thirdSelectedClass = savedThirdClass;
  const savedThirdTeacher = localStorage.getItem('tt_thirdTeacher');
  if (savedThirdTeacher) ui.thirdSelectedTeacher = savedThirdTeacher;
  const savedThirdRoom = localStorage.getItem('tt_thirdRoom');
  if (savedThirdRoom) ui.thirdSelectedRoom = savedThirdRoom;
}

// ============================================================
// 選單下拉
// ============================================================
function renderClassSelect() {
  const sel = document.getElementById('sel-class');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— 選擇班級 —</option>';
  // 單次掃描建立每班非課輔已排數，避免每班各掃一次全表（O(班級×課表) → O(課表+班級)）
  const scheduledNonHelperByClass = new Map();
  (state.schedule || []).forEach(entry => {
    if (isHelperSubjectCode(entry['科目代碼'])) return;
    const key = String(entry['班級代碼'] || '');
    scheduledNonHelperByClass.set(key, (scheduledNonHelperByClass.get(key) || 0) + 1);
  });
  state.classes.forEach(c => {
    const classCode = String(c['班級代碼'] || '');
    const className = c['班級名稱'] || '';

    // 統計該班配課總節數與已排節數
    const myAssignments = idx.assignmentsByClass?.[classCode] || [];
    let classTotalWeekly = 0;
    myAssignments.forEach(a => {
      const sub = idx.subjectByCode[a['科目代碼']];
      if (isHelperSubjectCode(a['科目代碼'])) return;
      classTotalWeekly += getAssignmentWeeklyValue(a, sub, 3);
    });

    const classTotalScheduled = scheduledNonHelperByClass.get(classCode) || 0;
    const classTotalRemaining = Math.max(0, classTotalWeekly - classTotalScheduled);

    let label = classCode + (className ? ' ' + className : '');
    label += ` (未排 ${classTotalRemaining}/${classTotalWeekly}節)`;

    const opt = new Option(label, classCode);
    if (c['是否虛擬班'] === 'TRUE') opt.textContent += ' ⚡';
    sel.appendChild(opt);
  });
  if (cur && state.classes.some(c => String(c['班級代碼']) === String(cur))) {
    sel.value = cur;
  } else if (state.classes.length > 0) {
    const firstClassCode = String(state.classes[0]['班級代碼']);
    sel.value = firstClassCode;
    ui.selectedClass = firstClassCode;
  }
}

function renderThirdClassSelect() {
  const sel = document.getElementById('third-class-select');
  if (!sel) return;
  const cur = ui.thirdSelectedClass || sel.value;
  sel.innerHTML = '<option value="">— 選擇班級 —</option>';
  state.classes.forEach(c => {
    const classCode = String(c['班級代碼'] || '');
    const className = c['班級名稱'] || '';
    const myAssignments = idx.assignmentsByClass?.[classCode] || [];
    let weekly = 0;
    myAssignments.forEach(a => {
      const sub = idx.subjectByCode[a['科目代碼']];
       if (isHelperSubjectCode(a['科目代碼'])) return;
        weekly += getAssignmentWeeklyValue(a, sub, 3);
    });
    const scheduled = (idx.__built && idx.classNonHelperScheduleCount)
      ? (idx.classNonHelperScheduleCount[classCode] || 0)
      : (state.schedule || []).filter(entry =>
          String(entry['班級代碼'] || '') === classCode && !isHelperSubjectCode(entry['科目代碼'])
        ).length;
    const option = new Option(classCode + (className ? ' ' + className : '') + `（未排 ${Math.max(0, weekly - scheduled)}/${weekly}節）`, classCode);
    if (c['是否虛擬班'] === 'TRUE') option.textContent += ' ⚡';
    sel.appendChild(option);
  });
  if (cur && state.classes.some(c => String(c['班級代碼']) === String(cur))) {
    sel.value = cur;
    ui.thirdSelectedClass = cur;
  } else if (state.classes.length > 0) {
    ui.thirdSelectedClass = String(state.classes[0]['班級代碼']);
    sel.value = ui.thirdSelectedClass;
  }
}

function renderTeacherSelect() {
  attachAllTeacherComboboxes();
}

function renderRoomSelect() {
  const sel = document.getElementById('sel-room');
  if (!sel) return;
  const cur = sel.value || ui.selectedRoom;
  sel.innerHTML = '<option value="">— 選擇教室 —</option>';
  state.rooms.forEach(r => {
    const code = String(r['教室代碼'] || '');
    const name = r['教室名稱'] || '';
    sel.appendChild(new Option(code + (name ? ' ' + name : ''), code));
  });
  if (cur) {
    sel.value = cur;
    renderRoomTT(cur);
  }
}

function renderThirdRoomSelect() {
  const sel = document.getElementById('third-room-select');
  if (!sel) return;
  const cur = ui.thirdSelectedRoom || sel.value;
  sel.innerHTML = '<option value="">— 選擇教室 —</option>';
  state.rooms.forEach(r => {
    const code = String(r['教室代碼'] || '');
    const name = r['教室名稱'] || '';
    sel.appendChild(new Option(code + (name ? ' ' + name : ''), code));
  });
  if (cur && state.rooms.some(r => String(r['教室代碼']) === String(cur))) {
    sel.value = cur;
    ui.thirdSelectedRoom = cur;
  }
}

function renderThirdTeacherSelect() {
  const input = document.getElementById('third-teacher-select');
  if (!input) return;
  const code = String(ui.thirdSelectedTeacher || '').trim();
  const teacher = code ? idx.teacherByCode[code] : null;
  input.value = teacher ? formatTeacherCodeName(code, teacher) : code;
  if (input._updateControls) input._updateControls();
}

// ============================================================
// 教室課表渲染
// ============================================================
function renderRoomTT(roomCode, target = 'primary', opts = {}) {
  const pane = getTimetablePane(target);
  const container = document.getElementById(pane.roomTT);
  if (!container) return;
  container.classList.add('room-readonly');
  if (!roomCode) {
    container.innerHTML = '<p style="color:var(--muted);padding:20px;font-size:13px;">請先選擇教室</p>';
    return;
  }

  const room = idx.roomByCode[roomCode];
  const roomName = room ? (room['教室名稱'] || roomCode) : roomCode;
  const capacity = parseInt(room ? room['容量'] || '1' : '1', 10) || 1;

  let totalScheduled = 0;
  let hasConflict = false;

  const tableHtml = makeTable((day, per) => {
    const rk = roomCode + '|' + day + '|' + per;
    const cells = idx.schedByRoomSlot[rk] || [];

    if (cells.length === 0) {
      return { state: 'empty', draggable: false };
    }

    totalScheduled += cells.length;

    if (cells.length > capacity) {
      hasConflict = true;
      const details = cells.map(cell => {
        const cls = String(cell['班級代碼'] || '');
        const sub = String(cell['科目代碼'] || '');
        const tc  = String(cell['教師姓名'] || '');
        const tcName = idx.teacherByCode[tc] ? (idx.teacherByCode[tc] ? (idx.teacherByCode[tc]['教師姓名'] || idx.teacherByCode[tc]['姓名']) : tc) : tc;
        return `${cls} ${sub}(${tcName})`;
      }).join('／');

      return {
        state: 'filled',
        extra: ['banned-slot'],
        text: `⚠️ 衝堂 (${cells.length}/${capacity} 班)`,
        meta: details,
        color: { bg: '#fee2e2', text: '#991b1b' },
        flags: '⚠️',
        draggable: false
      };
    }

    if (cells.length > 1) {
      const subCodes = [...new Set(cells.map(c => String(c['科目代碼'] || '').trim()))];
      const isSameSubject = subCodes.length === 1;

      if (isSameSubject) {
        const subCode = subCodes[0];
         const color = getScheduleCellColor(subCode, String(cells[0]['班級代碼'] || ''));
        let rawHtml = `<td class="tt-cell filled" data-day="${day}" data-per="${per}">`;
        rawHtml += `<div class="cell-body" style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;width:100%;height:100%;padding:4px 2px;">`;
        rawHtml += `<span class="cell-chip" style="background:${color.bg};color:${color.text};margin-bottom:4px;">${esc(subCode)}</span>`;
        cells.forEach((cell, i) => {
          const clsCode = String(cell['班級代碼'] || '');
          const tcCode  = String(cell['教師姓名'] || '');
          const cls     = idx.classByCode[clsCode];
          const clsName = cls ? (cls['班級名稱'] || clsCode) : clsCode;
          const tcName  = idx.teacherByCode[tcCode] ? (idx.teacherByCode[tcCode] ? (idx.teacherByCode[tcCode]['教師姓名'] || idx.teacherByCode[tcCode]['姓名']) : tcCode) : tcCode;
          if (i > 0) {
            rawHtml += `<div style="width:75%;margin:3px auto;border-top:1px dashed var(--border);"></div>`;
          }
          rawHtml += `<span class="cell-meta" style="display:block;text-align:center;width:100%;">`;
          rawHtml += `${esc(clsName)} ${esc(tcName)}`;
          rawHtml += `</span>`;
        });
        rawHtml += `</div></td>`;
        return { rawHtml };
      } else {
        let rawHtml = `<td class="tt-cell filled" data-day="${day}" data-per="${per}">`;
        rawHtml += `<div class="cell-body" style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:4px;width:100%;height:100%;padding:4px 2px;">`;
         cells.forEach(cell => {
           const subCode = String(cell['科目代碼'] || '');
           const clsCode = String(cell['班級代碼'] || '');
           const tcCode  = String(cell['教師姓名'] || '');
          const cls     = idx.classByCode[clsCode];
          const clsName = cls ? (cls['班級名稱'] || clsCode) : clsCode;
          const tcName  = idx.teacherByCode[tcCode] ? (idx.teacherByCode[tcCode] ? (idx.teacherByCode[tcCode]['教師姓名'] || idx.teacherByCode[tcCode]['姓名']) : tcCode) : tcCode;
           const color   = getScheduleCellColor(subCode, clsCode);
           const preplanned = isPreplannedScheduleEntry(cell);
           rawHtml += `<div class="${preplanned ? 'tt-course-preplanned' : ''}" style="padding:4px 6px;border-radius:6px;background:${color.bg};border:1px solid var(--border);text-align:center;width:100%;">`;
           rawHtml += `<div style="font-weight:bold;color:${color.text};font-size:11px;">${esc(subCode)}</div>`;
           rawHtml += `<div class="cell-meta" style="margin-top:1px;text-align:center;">${esc(clsName)} ${esc(tcName)}${preplanned ? '（預排）' : ''}</div>`;
          rawHtml += `</div>`;
        });
        rawHtml += `</div></td>`;
        return { rawHtml };
      }
    }

    const cell = cells[0];
    const subCode = String(cell['科目代碼'] || '');
    const clsCode = String(cell['班級代碼'] || '');
    const tcCode  = String(cell['教師姓名'] || '');
    const cls     = idx.classByCode[clsCode];
    const clsName = cls ? (cls['班級名稱'] || clsCode) : clsCode;
    const tcName  = idx.teacherByCode[tcCode] ? (idx.teacherByCode[tcCode] ? (idx.teacherByCode[tcCode]['教師姓名'] || idx.teacherByCode[tcCode]['姓名']) : tcCode) : tcCode;
    const locked  = String(cell['是否鎖定']).toUpperCase() === 'TRUE';
     const preplanned = isPreplannedScheduleEntry(cell);
    const attr    = cell['課堂屬性'] || '一般';

    return {
      state: 'filled',
      extra: [locked ? 'locked' : '', preplanned ? 'preplanned' : ''].filter(Boolean),
      text: subCode,
      meta: `${clsName} ${tcName}`,
       color: getScheduleCellColor(subCode, clsCode),
       flags: (locked ? '🔒' : '') + (preplanned ? '預排' : '') + (ATTR_LABELS[attr] || ''),
       draggable: false,
      dataCls: clsCode,
      dataTC: tcCode
    };
  });

  const headerHtml = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding:4px 2px;">
      <h3 style="margin:0;font-size:16px;font-weight:700;color:var(--ink);">🏫 ${esc(roomName)} ${roomName !== roomCode ? `<span style="font-size:13px;color:var(--ink-2);font-weight:normal;">(${esc(roomCode)})</span>` : ''} <span class="badge badge-blue" style="font-size:11px;font-weight:normal;margin-left:6px;">容量: ${capacity} 班</span></h3>
      <span style="font-size:12px;color:var(--ink-2);">
        📊 已使用 <b>${totalScheduled}</b> 節
        ${hasConflict ? '<span class="badge badge-red" style="margin-left:6px;">⚠️ 教室容量超限</span>' : ''}
      </span>
    </div>
  `;

  container.innerHTML = headerHtml + tableHtml;
  if (!opts?.skipThird && target === 'primary' && ui.thirdOpen) renderThirdTimetable();
}

// ============================================================
// 課表渲染
// ============================================================

// ============================================================
// Word 匯出配色規則解析：科目→年級→班級，最精確者勝出
// ============================================================
function getRuleSubjectList(r) {
  return String((r && r['科目']) || '').split(/[,，、;；]/).map(s => String(s||'').trim()).filter(Boolean);
}
function getRuleClassList(r) {
  return parseClassCodeList((r && r['班級']) || '');
}

function parseScheduleColorPeriod(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return null;
  const period = parseInt(raw, 10);
  return String(period) === raw && period >= 1 && period <= 8 ? period : NaN;
}

function scheduleColorRuleMatches(r, day, period) {
  const dayRule = String(r && r['星期'] || '').trim();
  if (dayRule && parseDayNum(dayRule) !== parseInt(day, 10)) return false;
  const startRaw = String(r && r['起始節次'] || '').trim();
  const endRaw = String(r && r['結束節次'] || '').trim();
  if (!startRaw && !endRaw) return true;
  const start = parseScheduleColorPeriod(startRaw);
  const end = parseScheduleColorPeriod(endRaw);
  const current = parseInt(period, 10);
  return Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(current) && current >= start && current <= end;
}

function getScheduleColorTimeLabel(rule) {
  const day = String(rule && rule['星期'] || '').trim();
  const dayLabel = day ? (DAY_NAMES[parseDayNum(day)] || '星期' + day) : '全部星期';
  const start = String(rule && rule['起始節次'] || '').trim();
  const end = String(rule && rule['結束節次'] || '').trim();
  if (!start && !end) return dayLabel + '／全部節次';
  return dayLabel + '／第' + start + '至第' + end + '節';
}

// 以科目代碼＋班級代碼＋星期／節次找最精確命中的底色規則。
function resolveScheduleColor(subjectCode, classCode, day, period) {
  const sub = String(subjectCode || '').trim();
  if (!sub) return '';
  const rules = state.scheduleColors || [];
  const cls = String(classCode || '').trim();
  let bestColor = '', bestScore = -1;
  rules.forEach(r => {
    const subjects = getRuleSubjectList(r);
    if (subjects.length > 0 && !subjects.includes(sub)) return;
    const clsList = getRuleClassList(r);
    if (clsList.length > 0 && !clsList.includes(cls)) return;
    if (!scheduleColorRuleMatches(r, day, period)) return;
    let score = 0;
    if (clsList.length > 0) score += 100;
    if (subjects.length > 0) score += 10;
    if (String(r['星期'] || '').trim()) score += 2;
    if (String(r['起始節次'] || '').trim() || String(r['結束節次'] || '').trim()) score += 1;
    if (score > bestScore) { bestScore = score; bestColor = String(r['底色'] || '').trim(); }
  });
  if (bestColor) return bestColor.replace(/^#/, '').toUpperCase();
  return '';

}

function makeTable(rows, options = {}) {
  // rows: callback(day, period) → {text, meta, flags, state, cls, style, color, draggable}
  // per===8 可回傳 rawHtml 完整 TD 以支援單雙週拆分
  const periods = Array.isArray(options.periods) ? options.periods : DISPLAY_PERIODS;
  let html = '<table class="tt-table"><thead><tr>';
  html += '<th class="tt-period-col">節次</th>';
  DAYS.forEach(d => { html += '<th>'+d+'</th>'; });
  html += '</tr></thead><tbody>';
  periods.forEach(per => {
    const rowClass = per === EARLY_PERIOD ? 'tt-row-early' : (per === LUNCH_PERIOD ? 'tt-row-lunch' : (per === 8 ? 'tt-row-p8' : ''));
    html += '<tr class="' + rowClass + '">';
    html += '<td class="tt-period-col tt-period-cell" style="border:1px solid var(--border);text-align:center;vertical-align:middle;">'
          + '<div class="period-label">'+periodLabel(per)+'</div>'
          + '<div class="period-time">'+PERIOD_TIMES[per]+'</div>'
          + '</td>';
    for (let day = 1; day <= 5; day++) {
      const info = rows(day, per);
      if (info.rawHtml) {
        html += info.rawHtml;
      } else {
        const cls = ['tt-cell', info.state || '', ...(info.extra||[])].filter(Boolean).join(' ');
        const drag = info.draggable ? 'draggable="true"' : '';
        html += '<td class="'+cls+'" '+drag+' '+
                'data-day="'+day+'" data-per="'+per+'" '+(info.dataCls?'data-cls="'+info.dataCls+'"':'')+''+
                (info.dataTC?'data-tc="'+info.dataTC+'"':'')+' '+(info.style?'style="'+info.style+'"':'')+'>';
        html += '<div class="cell-body">';
        if (info.color) {
          html += '<span class="cell-chip" title="'+esc(info.text||'')+'" style="background:'+info.color.bg+';color:'+info.color.text+';">'+esc(info.text||'')+'</span>';
        } else if (info.text) {
          html += '<span class="cell-chip" title="'+esc(info.text)+'" style="background:var(--border);color:var(--ink-2);">'+esc(info.text)+'</span>';
        }
        if (info.meta) {
          if (String(info.meta).indexOf('\n') >= 0) {
            html += '<span class="cell-meta" title="'+esc(info.meta)+'" style="white-space:pre-line;display:block;line-height:1.25;margin-top:1px;">'+esc(info.meta)+'</span>';
          } else {
            html += '<span class="cell-meta" title="'+esc(info.meta)+'">'+esc(info.meta)+'</span>';
          }
        }
        html += '</div>';
        if (info.flags) html += '<span class="cell-flags">'+info.flags+'</span>';
        html += '</td>';
      }
    }
    html += '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

function renderClassTT(classCode, target = 'primary', opts = {}) {
  const pane = getTimetablePane(target);
  const cls = idx.classByCode[classCode];
  const label = document.getElementById(pane.classLabel);
  if (label) label.textContent = cls ? cls['班級名稱']||'' : '';
  renderSubjectPalette(classCode, target);

  const html = makeTable((day, per) => {
    const ck   = classCode+'|'+day+'|'+per;
    const cell = idx.schedByClassSlot[ck];
    const sub  = cell ? String(cell['科目代碼']||'') : '';
    const tc   = cell ? String(cell['教師姓名']||'') : '';
    const attr = cell ? (cell['課堂屬性']||'一般') : '';
    const locked   = cell && String(cell['是否鎖定']).toUpperCase()==='TRUE';
     const preplanned = cell && isPreplannedScheduleEntry(cell);
    const teacher  = tc ? idx.teacherByCode[tc] : null;
    // 網頁班級課表顯示主／協同教師；Word 匯出再依規格只取主教師。
    const cellTeacherList = cell ? getClassTeacherList(cell) : [];
    const metaLines = cellTeacherList.length > 0
      ? cellTeacherList.map(t => {
          const name = idx.teacherByCode[t['教師姓名']] ? (idx.teacherByCode[t['教師姓名']]['教師姓名'] || idx.teacherByCode[t['教師姓名']]['姓名'] || '') : (t['教師姓名'] || '');
          return t['標籤'] && t['標籤'] !== '主' ? name + '（' + t['標籤'] + '）' : name;
        })
      : (teacher ? [(teacher['教師姓名'] || teacher['姓名'] || '')] : (tc ? [tc] : []));

    // 第八節：僅該日有單雙週資料時才拆左右欄
    if (per === 8) {
      const splitResult = renderP8Cell(day, classCode, target);
      if (splitResult) return splitResult;
    }

    // 判斷時段是否有規則標記或綁班標記
    const extra = [];
    if (sub) {
      const rk   = sub+'|'+day+'|'+per;
      const rules = idx.rulesBySubjectSlot[rk] || [];
      if (rules.some(r=>r['規則類型']==='必排')) extra.push('must-slot');
      if (rules.some(r=>r['規則類型']==='禁排')) extra.push('banned-slot');
      if (isSubjectBlockBound(sub, classCode)) extra.push('bind-slot');
    }

    if (!cell) return { state:'empty', draggable:false, dataCls:classCode };
    return {
       state: 'filled',
       extra: [locked ? 'locked' : '', preplanned ? 'preplanned' : ''].filter(Boolean),
      text:  sub,
      meta:  metaLines.join('\n'),
       color: getScheduleCellColor(sub, classCode),
       flags: (locked?'🔒':'') + (preplanned ? '預排' : '') + (ATTR_LABELS[attr]||'') + (sub && isSubjectBlockBound(sub, classCode) ? '🔗':''),
      draggable: !isDragProtectedScheduleEntry(cell),
      dataCls: classCode,
      dataTC:  tc
    };
  });

  document.getElementById(pane.classTT).innerHTML = html;
  bindClassTTEvents(target);
  if (!opts?.skipThird && target === 'primary' && ui.thirdOpen) renderThirdTimetable();
}

function renderP8Cell(day, classCode, target = 'primary') {
  const ck = classCode + '|' + day + '|8';
  const p8cells = idx.schedByClassSlotP8[ck] || {};
  const hasSingle = !!p8cells['單週'];
  const hasDouble = !!p8cells['雙週'];

  // 只有單或只有雙：仍可獨立點擊指派
  // 兩者皆無：回傳 null 讓 makeTable 走一般單格渲染
  if (!hasSingle && !hasDouble) return null;

  function subCellHtml(weekType, cell) {
    const sub = cell ? String(cell['科目代碼'] || '') : '';
    const tc = cell ? String(cell['教師姓名'] || '') : '';
    const teacher = tc ? idx.teacherByCode[tc] : null;
     const color = cell ? getScheduleCellColor(sub, classCode) : { bg: 'transparent', text: 'var(--muted)' };
    const locked = cell && String(cell['是否鎖定']).toUpperCase() === 'TRUE';
     const preplanned = cell && isPreplannedScheduleEntry(cell);
     const stateCls = cell ? 'filled' + (preplanned ? ' preplanned' : '') : 'p8-empty';
    // 網頁班級課表顯示主／協同教師；教師課表仍會依每位教師索引顯示。
     const cellTeacherList = cell ? getClassTeacherList(cell) : [];
    const metaP8 = cellTeacherList.length > 0
      ? cellTeacherList.map(t => {
          const nm = idx.teacherByCode[t['教師姓名']] ? (idx.teacherByCode[t['教師姓名']]['教師姓名'] || idx.teacherByCode[t['教師姓名']]['姓名'] || '') : (t['教師姓名'] || '');
          return t['標籤'] && t['標籤'] !== '主' ? nm + '（' + t['標籤'] + '）' : nm;
        }).join('\n')
      : (teacher ? (teacher['教師姓名'] || teacher['姓名'] || '') : (tc ? tc : ''));
    return '<div class="p8-subcell ' + stateCls + (locked ? ' locked' : '') + '" data-week="' + weekType + '" data-day="' + day + '" data-per="8" data-cls="' + esc(classCode) + '" data-tc="' + esc(tc || '') + '" draggable="' + (!isDragProtectedScheduleEntry(cell) && !!cell) + '">'
         + '<span class="p8-week-label">' + weekType + '</span>'
         + (cell
           ? '<span class="cell-chip" title="' + esc(sub) + '" style="background:' + color.bg + ';color:' + color.text + ';">' + esc(sub) + '</span>'
             + '<span class="cell-meta" title="' + esc(metaP8) + '" style="white-space:pre-line;display:block;line-height:1.25;margin-top:1px;">' + esc(metaP8) + '</span>'
           : '<span class="cell-meta" style="color:var(--muted);font-size:10px;">—</span>')
          + ((locked || preplanned) ? '<span class="cell-flags">' + (locked ? '🔒' : '') + (preplanned ? '預排' : '') + '</span>' : '')
         + '</div>';
  }

  const rawHtml = '<td class="tt-cell tt-cell-p8" data-day="' + day + '" data-per="8">'
    + '<div class="p8-cell-inner">'
    + subCellHtml('單週', p8cells['單週'])
    + '<div class="p8-divider"></div>'
    + subCellHtml('雙週', p8cells['雙週'])
    + '</div></td>';
  return { rawHtml: rawHtml };
}

// ============================================================
// 教師待排科目選單（Teacher Subject Drag Palette）
// ============================================================
function renderTeacherSubjectPalette(teacherCode, target = 'primary') {
  const pane = getTimetablePane(target);
  const box = document.getElementById(pane.teacherPalette);
  const infoSpan = document.getElementById(pane.teacherPaletteInfo);
  if (!teacherCode) {
    if (box) box.innerHTML = '<span class="text-muted" style="font-size:12px;">選擇教師後，此處將自動列出該教師授課班級與剩餘節數…</span>';
    
    return;
  }
  const t = idx.teacherByCode[teacherCode];
  const teacherName = t ? (t['教師姓名'] || t['姓名']) : teacherCode;
  if (infoSpan) infoSpan.textContent = teacherName;

  // 取得該教師在「配課設定」中的所有授課項目
  const myAssignments = idx.assignmentsByTeacher?.[String(teacherCode)] || [];

  if (myAssignments.length === 0) {
    if (box) box.innerHTML = '<span class="text-muted" style="font-size:12px;">⚠️ 此教師尚未建立「配課設定」，請先至「📋 配課」分頁指定授課班級與科目。</span>';
    return;
  }

  let pendingHtml = '', doneHtml = '', doneCount = 0;
  myAssignments.forEach((a, itemIndex) => {
    const classCode = a['班級代碼'];
    const subCode   = a['科目代碼'];
    const cls       = idx.classByCode[classCode];
    const className = cls ? (cls['班級名稱'] || classCode) : classCode;
    const isVirtual = cls && cls['是否虛擬班'] === 'TRUE';
    const sub       = idx.subjectByCode[subCode];

    const weekly = getAssignmentWeeklyValue(a, sub, 3);
    const isAlternateWeek = isAlternateWeeklyValue(weekly);
    const teacherList = getCellTeacherList(a);

     const color = getScheduleCellColor(subCode, classCode);

    const scheduledCount = idx.scheduleCountByTeacherClassSubject?.[String(teacherCode)+'|'+String(classCode)+'|'+String(subCode)] || 0;

    const remaining = Math.max(0, weekly - scheduledCount);
    const isDone = remaining === 0;

    const badgeClass = isDone ? 'zero' : 'remaining';
    const badgeText = isDone ? `已滿 ${formatWeeklyValue(scheduledCount)}/${formatWeeklyValue(weekly)}節` : `已排 ${formatWeeklyValue(scheduledCount)}/${formatWeeklyValue(weekly)} (剩${formatWeeklyValue(remaining)}節)`;
    const cardClass = isDone ? 'palette-card done' : 'palette-card';

      const card = `<div class="${cardClass}" ${!isDone ? 'draggable="true"' : ''} data-item-index="${itemIndex}" data-cls="${esc(classCode)}" data-sub="${esc(subCode)}" data-tc="${esc(teacherCode)}" data-attr="${esc(isVirtual ? '抽離' : '一般')}" data-alternate-week="${isAlternateWeek ? 'true' : 'false'}"><span class="palette-link" onclick="selectClassFromPalette(event, '${esc(classCode)}')" title="班級：${esc(className)}；點擊切換左欄課表">🏫 <span class="palette-label-text">${esc(className)}</span></span><span class="cell-chip" title="${esc(subCode)}" style="background:${color.bg};color:${color.text};padding:1px 5px;font-size:11px;">${esc(subCode)}</span><span class="badge-count ${badgeClass}" title="${esc(badgeText)}">${badgeText}</span></div>`;
    if (isDone) { doneHtml += card; doneCount++; }
    else pendingHtml += card;
  });

  if (box) {
    box.innerHTML = pendingHtml + (doneCount > 0 ? `<details class="palette-collapse"><summary>已排完（${doneCount} 科）</summary>${doneHtml}</details>` : '');
    box._teacherPaletteState = { teacherCode, myAssignments };
    ensureTeacherPaletteDelegation(box);
  }
}

function ensureTeacherPaletteDelegation(box) {
  if (!box || typeof box.addEventListener !== 'function' || box._teacherPaletteDelegationBound) return;
  box._teacherPaletteDelegationBound = true;
  box.addEventListener('dragstart', e => {
    const card = e.target?.closest ? e.target.closest('.palette-card[draggable="true"]') : null;
    if (!card || !box.contains(card)) return;
    const ref = box._teacherPaletteState || { teacherCode: '', myAssignments: [] };
    const assignment = ref.myAssignments[parseInt(card.dataset.itemIndex, 10)];
    ui.drag = {
      isPalette: true,
      cls: card.dataset.cls,
      subjectCode: card.dataset.sub,
      teacherCode: ref.teacherCode,
      teacherList: assignment ? getCellTeacherList(assignment) : [],
      attr: card.dataset.attr,
      isAlternateWeek: card.dataset.alternateWeek === 'true'
    };
    resetDragConflictCache();
    card.style.opacity = '0.4';
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });
  box.addEventListener('dragend', e => {
    const card = e.target?.closest ? e.target.closest('.palette-card[draggable="true"]') : null;
    ui.drag = null;
    if (card) card.style.opacity = '1';
    clearTimetableDragHighlights();
  });
}

// 6. 樂觀切換教師不排課時段 (主畫面右欄視覺化編輯)

// 定位更新教師課表中的單一格位（不重建整張表格）
function updateTeacherBlockCell(teacherCode, day, period, target = 'primary') {
  const pane = getTimetablePane(target);
  const sel = `#${pane.teacherTT} .tt-cell[data-day="${day}"][data-per="${period}"]`;
  const td = document.querySelector(sel);
  if (!td) return;

  if (parseInt(period, 10) === 8 && renderTeacherP8Cell(day, teacherCode, target)) {
    renderTeacherTT(teacherCode, target);
    return;
  }

  const tk = teacherCode + '|' + day + '|' + period;
  const isBlocked = idx.blockSet.has(tk);
  const cells = idx.schedByTeacherSlot[tk] || [];

  td.className = 'tt-cell';
  td.removeAttribute('title');
  if (cells.length > 1 || (isBlocked && cells.length > 0)) {
    const details = cells.map(cell => { const cls=String(cell['班級代碼']||''), clsInfo=idx.classByCode[cls]; return String(cell['科目代碼']||'')+' '+(clsInfo?clsInfo['班級名稱']||cls:cls); });
    td.classList.add('filled', 'conflict');
    td.title = details.join('；');
    td.innerHTML = '<div class="cell-body"><span class="cell-chip">' + (isBlocked ? '⛔ 不排課違規' : '⚠️ 衝堂 ' + cells.length + ' 門') + '</span><span class="cell-meta">' + esc(details.join('／')) + '</span></div><span class="cell-flags">⛔</span>';
  } else if (isBlocked) {
    td.classList.add('blocked');
    td.innerHTML = '<div class="cell-body"><span class="cell-chip" style="background:var(--border);color:var(--ink-2);">⛔</span></div><span class="cell-flags"></span>';
  } else if (cells.length === 0) {
    td.classList.add('empty');
    td.innerHTML = '<div class="cell-body"></div>';
  } else {
    td.classList.add('filled');
     const cell=cells[0],sub=String(cell['科目代碼']||''),cls=String(cell['班級代碼']||''),clsInfo=idx.classByCode[cls],color=getScheduleCellColor(sub, cls);
    td.innerHTML = '<div class="cell-body"><span class="cell-chip" style="background:' + color.bg + ';color:' + color.text + ';">' + esc(sub) + '</span><span class="cell-meta">' + esc(clsInfo ? clsInfo['班級名稱']||cls : cls) + '</span></div><span class="cell-flags"></span>';
  }}

function hasPatrolAtSlot(day, period, excludeId = '') {
  return state.schedule.some(entry => isPatrolScheduleEntry(entry) &&
    String(entry['課表ID'] || '') !== String(excludeId || '') &&
    parseInt(entry['星期'], 10) === parseInt(day, 10) &&
    parseInt(entry['節次'], 10) === parseInt(period, 10));
}

function syncPatrolSchedule(actionName, applyLocal) {
  const basePatrolSchedule = state.schedule
    .filter(isPatrolScheduleEntry)
    .map(entry => ({ ...entry }));
  bgSync({
    actionName,
    snapshotKeys: ['schedule'],
    applyLocal: () => {
      applyLocal();
      buildIndex();
      if (ui.selectedTeacher) renderTeacherTT(ui.selectedTeacher);
      if (ui.thirdOpen) renderThirdTimetable();
      renderStatsTab();
    },
    gasTask: () => gasPost('savePatrolSchedule', {
      patrolSchedule: state.schedule.filter(isPatrolScheduleEntry).map(entry => ({ ...entry })),
      basePatrolSchedule
    })
  });
}

function addPatrolAtTeacherSlot(teacherCode, day, period) {
  const teacher = idx.teacherByCode[String(teacherCode || '')];
  if (!isPatrolEligibleTeacher(teacher)) {
    toast('只能為職務含行政、組長或主任的教師排入巡堂', 'warning');
    return;
  }
  if (idx.blockSet.has(String(teacherCode) + '|' + day + '|' + period)) {
    toast('此教師已設定本節不排課，無法新增巡堂', 'warning');
    return;
  }
  if ((idx.schedByTeacherSlot[String(teacherCode) + '|' + day + '|' + period] || []).length > 0) {
    toast('此教師本節已有課程，無法新增巡堂', 'warning');
    return;
  }
  if (hasPatrolAtSlot(day, period)) {
    toast('同一星期、節次只能安排一位巡堂教師', 'warning');
    return;
  }
  const row = normalizePatrolScheduleEntry({
    '課表ID': 'patrol_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    '班級代碼': '', '星期': day, '節次': period, '科目代碼': '',
    '教師姓名': teacherCode, '課堂屬性': '巡堂', '是否鎖定': 'TRUE'
  });
  syncPatrolSchedule('新增巡堂', () => state.schedule.push(row));
}

function movePatrolCell(id, teacherCode, day, period) {
  const row = state.schedule.find(entry => String(entry['課表ID'] || '') === String(id) && isPatrolScheduleEntry(entry));
  if (!row) return;
  if (String(row['教師姓名'] || '') !== String(teacherCode || '')) {
    toast('巡堂只能在同一位教師的課表內拖曳', 'warning');
    return;
  }
  if (hasPatrolAtSlot(day, period, id)) {
    toast('同一星期、節次只能安排一位巡堂教師', 'warning');
    return;
  }
  if (idx.blockSet.has(String(teacherCode) + '|' + day + '|' + period)) {
    toast('目標時段已設定不排課，無法移動巡堂', 'warning');
    return;
  }
  const targetCells = idx.schedByTeacherSlot[String(teacherCode) + '|' + day + '|' + period] || [];
  if (targetCells.some(cell => String(cell['課表ID'] || '') !== String(id))) {
    toast('目標時段已有課程，無法移動巡堂', 'warning');
    return;
  }
  syncPatrolSchedule('移動巡堂', () => {
    row['星期'] = day;
    row['節次'] = period;
  });
}

async function deletePatrolCell(id) {
  const row = state.schedule.find(entry => String(entry['課表ID'] || '') === String(id) && isPatrolScheduleEntry(entry));
  if (!row) return;
  const ok = await showModal('刪除巡堂', '確定刪除星期' + row['星期'] + '第' + row['節次'] + '節的巡堂？', 'confirm');
  if (!ok) return;
  syncPatrolSchedule('刪除巡堂', () => {
    state.schedule = state.schedule.filter(entry => String(entry['課表ID'] || '') !== String(id));
  });
}

function renderTeacherP8Cell(day, teacherCode, target = 'primary') {
  const cells = idx.schedByTeacherSlot[teacherCode + '|' + day + '|8'] || [];
  const weekCells = {
    '單週': cells.filter(cell => String(cell['課堂屬性'] || '').trim() === '單週'),
    '雙週': cells.filter(cell => String(cell['課堂屬性'] || '').trim() === '雙週')
  };
  if (!weekCells['單週'].length && !weekCells['雙週'].length) return null;

  const className = classCode => {
    const info = idx.classByCode[String(classCode || '').trim()];
    return info ? (info['班級名稱'] || classCode) : classCode;
  };
  const subCellHtml = weekType => {
    const entries = weekCells[weekType];
    const cell = entries[0] || null;
    const conflict = entries.length > 1;
    const subject = cell ? String(cell['科目代碼'] || '') : '';
    const classCodes = entries.map(entry => String(entry['班級代碼'] || '').trim()).filter(Boolean);
    const meta = entries.map(entry => className(entry['班級代碼'])).join('／');
    const locked = cell && String(cell['是否鎖定'] || '').toUpperCase() === 'TRUE';
    const stateClass = conflict ? 'filled conflict' : (cell ? 'filled' : 'p8-empty');
    const draggable = cell && !conflict && !isDragProtectedScheduleEntry(cell) ? 'true' : 'false';
    const label = conflict ? '衝堂 ' + entries.length + ' 門' : subject;
    const color = cell ? getScheduleCellColor(subject, classCodes[0]) : { bg: 'transparent', text: 'var(--muted)' };
    return '<div class="p8-subcell ' + stateClass + (locked ? ' locked' : '') + '"' +
      ' data-week="' + weekType + '" data-day="' + day + '" data-per="8"' +
      ' data-cls="' + esc(classCodes[0] || '') + '" data-tc="' + esc(teacherCode) + '"' +
      ' draggable="' + draggable + '">' +
      '<span class="p8-week-label">' + weekType + '</span>' +
      (cell ? '<span class="cell-chip" title="' + esc(label) + '" style="background:' + color.bg + ';color:' + color.text + ';">' + esc(label) + '</span>' :
        '<span class="cell-meta" style="color:var(--muted);font-size:10px;">—</span>') +
      (meta ? '<span class="cell-meta" title="' + esc(meta) + '">' + esc(meta) + '</span>' : '') +
      (locked ? '<span class="cell-flags">🔒</span>' : '') +
      '</div>';
  };
  const firstClass = weekCells['單週'][0]?.['班級代碼'] || weekCells['雙週'][0]?.['班級代碼'] || '';
  return {
    rawHtml: '<td class="tt-cell tt-cell-p8" data-day="' + day + '" data-per="8" data-cls="' + esc(firstClass) + '">' +
      '<div class="p8-cell-inner">' + subCellHtml('單週') + '<div class="p8-divider"></div>' + subCellHtml('雙週') + '</div></td>'
  };
}

async function confirmTeacherTimetableOverwrite(sourceCell, targetCells, day, period) {
  const sourceId = String(sourceCell?.['課表ID'] || '').trim();
  const unique = new Map();
  (targetCells || []).filter(Boolean).forEach(cell => {
    const id = String(cell['課表ID'] || '').trim();
    if (id && id === sourceId) return;
    unique.set(id || JSON.stringify(cell), cell);
  });
  const occupied = Array.from(unique.values());
  if (!occupied.length) return true;
  const teacherLabel = cell => getCellTeacherCodes(cell).map(code => {
    const teacher = idx.teacherByCode[code];
    return teacher ? (teacher['姓名'] || teacher['教師姓名'] || code) : code;
  }).join('、');
  const details = occupied.map(cell => {
    const classCode = String(cell['班級代碼'] || '').trim();
    const classInfo = idx.classByCode[classCode];
    const className = classInfo ? (classInfo['班級名稱'] || classCode) : classCode;
    const week = parseInt(period, 10) === 8 && cell['課堂屬性'] ? '（' + cell['課堂屬性'] + '）' : '';
    return '星期' + day + '第' + period + '節' + week + '：' +
      (cell['科目代碼'] || '未命名課程') + '／' + className + '／' + teacherLabel(cell);
  });
  return showModal(
    '確認替換課程',
    '教師課表的目標格已有課程：<br><b>' + details.map(esc).join('<br>') + '</b><br><br>確定要替換或互調嗎？',
    'confirm',
    '確認替換',
    '取消'
  );
}

function bindTeacherTTEvents(teacherCode, target = 'primary') {
  const pane = getTimetablePane(target);
  const container = document.getElementById(pane.teacherTT);
  if (!container) return;
  container._teacherTTState = { teacherCode, target };
  ensureTeacherTTDelegation(container);

  const cells = document.querySelectorAll('#' + pane.teacherTT + ' .tt-cell');
  cells.forEach(td => {
    const day = parseInt(td.dataset.day, 10);
    const per = parseInt(td.dataset.per, 10);
    const tk = teacherCode + '|' + day + '|' + per;
    const isBlocked = idx.blockSet.has(tk);
    const schedCells = idx.schedByTeacherSlot[tk] || [];
    const patrolCell = schedCells.length === 1 && isPatrolScheduleEntry(schedCells[0]);

    if (schedCells.length === 0) {
      const patrolEligible = (target === 'primary' || target === 'third') && isPatrolEligibleTeacher(idx.teacherByCode[teacherCode]);
      td.title = isBlocked ? '⛔ 點擊取消此節不排課' : (patrolEligible ? '左鍵設為不排課，右鍵新增巡堂' : '➕ 點擊設為不排課時段');
    } else if (patrolCell) {
      td.title = '點擊開啟巡堂總覽；可拖曳移動，右鍵刪除';
      td.draggable = true;
    } else {
      const cell = schedCells[0];
      if (!isDragProtectedScheduleEntry(cell)) td.draggable = true;
    }
  });
}

function ensureTeacherTTDelegation(container) {
  if (!container || typeof container.addEventListener !== 'function' || container._teacherTTDelegationBound) return;
  container._teacherTTDelegationBound = true;
  const resolveSlot = td => {
    const stateRef = container._teacherTTState || { teacherCode: '', target: 'primary' };
    const teacherCode = stateRef.teacherCode;
    const target = stateRef.target || 'primary';
    const day = parseInt(td.dataset.day, 10);
    const per = parseInt(td.dataset.per, 10);
    const tk = teacherCode + '|' + day + '|' + per;
    const isBlocked = idx.blockSet.has(tk);
    const schedCells = idx.schedByTeacherSlot[tk] || [];
    const patrolCell = schedCells.length === 1 && isPatrolScheduleEntry(schedCells[0]);
    return { teacherCode, target, day, per, tk, isBlocked, schedCells, patrolCell };
  };

  container.addEventListener('click', e => {
    const td = e.target?.closest ? e.target.closest('.tt-cell') : null;
    if (!td || !container.contains(td) || ui.drag) return;
    const { teacherCode, target, day, per, schedCells, patrolCell } = resolveSlot(td);
    if (schedCells.length === 0) {
      toggleTeacherBlockSlot(teacherCode, day, per, target);
      return;
    }
    if (patrolCell) {
      openThirdPatrolOverview();
      return;
    }
    const allCls = [...new Set(schedCells.map(c => String(c['班級代碼'] || '').trim()).filter(Boolean))];
    const clsTarget = cycleNextClass(allCls, ui.selectedClass);
    if (clsTarget && clsTarget !== ui.selectedClass) {
      ui.selectedClass = clsTarget;
      document.getElementById('sel-class').value = clsTarget;
      renderClassTT(clsTarget);
      renderSubjectPalette(clsTarget);
    }
  });

  container.addEventListener('contextmenu', e => {
    const td = e.target?.closest ? e.target.closest('.tt-cell') : null;
    if (!td || !container.contains(td)) return;
    const { teacherCode, target, day, per, schedCells, patrolCell } = resolveSlot(td);
    if (schedCells.length === 0) {
      const patrolEligible = (target === 'primary' || target === 'third') && isPatrolEligibleTeacher(idx.teacherByCode[teacherCode]);
      if (patrolEligible) {
        e.preventDefault();
        addPatrolAtTeacherSlot(teacherCode, day, per);
      }
      return;
    }
    e.preventDefault();
    const cell = schedCells[0];
    if (patrolCell) {
      deletePatrolCell(cell['課表ID']);
      return;
    }
    const baseCls = String(cell['班級代碼'] || '');
    const ck = baseCls + '|' + day + '|' + per;
    const existing = idx.schedByClassSlot[ck];
    const clsForCtx = existing ? String(existing['班級代碼']) : baseCls;
    const ctxCell = existing || cell;
    ui.ctxTarget = { cls: clsForCtx, day, per, cell: ctxCell, teacherCode, week: per === 8 ? String(ctxCell['課堂屬性'] || '') : '', teacherView: true };
    showCtxMenu(e.pageX, e.pageY, true, String(ctxCell['是否鎖定']).toUpperCase() === 'TRUE', { allowOvertime: per !== 8 && !isManualOnlyPeriod(per), isOvertime: isOvertimeScheduleEntry(ctxCell, teacherCode) });
  });

  container.addEventListener('dragstart', e => {
    const td = e.target?.closest ? e.target.closest('.tt-cell') : null;
    if (!td || !container.contains(td)) return;
    const { teacherCode, day, per, schedCells, patrolCell } = resolveSlot(td);
    if (schedCells.length === 0) return;
    const cell = schedCells[0];
    if (patrolCell) {
      ui.drag = { isPatrol: true, isPalette: false, cell, day, per, teacherCode };
      resetDragConflictCache();
      td.style.opacity = '0.4';
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      return;
    }
    const clsCode = td.dataset.cls || String(cell['班級代碼'] || '');
    if (isDragProtectedScheduleEntry(cell)) {
      e.preventDefault();
      return;
    }
    ui.drag = {
      isPalette: false,
      cls: clsCode,
      day,
      per,
      cell: cell,
      teacherCode: teacherCode,
      teacherList: getCellTeacherList(cell),
      p8Week: per === 8 ? String(cell['課堂屬性'] || '').trim() : ''
    };
    resetDragConflictCache();
    td.style.opacity = '0.4';
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });

  container.addEventListener('dragend', e => {
    const td = e.target?.closest ? e.target.closest('.tt-cell') : null;
    ui.drag = null;
    if (td) td.style.opacity = '1';
    clearTimetableDragHighlights();
  });

  container.addEventListener('dragover', e => {
    if (!ui.drag) return;
    const td = e.target?.closest ? e.target.closest('.tt-cell') : null;
    if (!td || !container.contains(td)) return;
    e.preventDefault();
    const { teacherCode, day, per, isBlocked, schedCells } = resolveSlot(td);
    if (ui.drag.isPatrol) {
      td.classList.remove('drag-ok', 'drag-err', 'drag-warn');
      const targetCells = idx.schedByTeacherSlot[teacherCode + '|' + day + '|' + per] || [];
      const allowed = ui.drag.teacherCode === teacherCode &&
        !(ui.drag.day === day && ui.drag.per === per) &&
        !isBlocked && targetCells.length === 0 && !hasPatrolAtSlot(day, per, ui.drag.cell && ui.drag.cell['課表ID']);
      td.classList.add(allowed ? 'drag-ok' : 'drag-err');
      return;
    }
    const tcCode = ui.drag.teacherList?.length ? ui.drag.teacherList : teacherCode;
    const subCode = ui.drag.isPalette ? ui.drag.subjectCode : (ui.drag.cell ? ui.drag.cell['科目代碼'] : '');
    const targetCls = ui.drag.cls;
    if (!targetCls || !subCode) return;

    const excludeInfo = ui.drag && !ui.drag.isPalette ? {
      srcDay: ui.drag.day,
      srcPer: ui.drag.per,
      excludeIds: [ui.drag.cell && ui.drag.cell['課表ID']]
    } : null;
    const targetWeek = per === 8
      ? String(schedCells.find(c => ['單週', '雙週'].includes(String(c['課堂屬性'] || '').trim()))?.['課堂屬性'] || ui.drag.p8Week || '').trim()
      : '';
    const conflicts = cachedConflictCheck(day, per, tcCode, subCode, targetCls, ui.drag.isPalette ? '' : targetCls, excludeInfo, targetWeek);
    td.classList.remove('drag-ok', 'drag-err', 'drag-warn');
    if (conflicts.length > 0) td.classList.add('drag-err');
    else td.classList.add('drag-ok');
  });

  container.addEventListener('dragleave', e => {
    const td = e.target?.closest ? e.target.closest('.tt-cell') : null;
    if (td) td.classList.remove('drag-ok', 'drag-err', 'drag-warn');
  });

  container.addEventListener('drop', async e => {
    const td = e.target?.closest ? e.target.closest('.tt-cell') : null;
    if (!td || !container.contains(td)) return;
    e.preventDefault();
    if (!ui.drag) return;
    td.classList.remove('drag-ok', 'drag-err', 'drag-warn');
    const { teacherCode, day, per, schedCells } = resolveSlot(td);
    const dragInfo = ui.drag;
    ui.drag = null;

    if (dragInfo.isPatrol) {
      if (dragInfo.teacherCode !== teacherCode) {
        toast('巡堂只能在同一位教師的課表內拖曳', 'warning');
        return;
      }
      if (dragInfo.day === day && dragInfo.per === per) return;
      movePatrolCell(dragInfo.cell && dragInfo.cell['課表ID'], teacherCode, day, per);
      return;
    }
    if (!dragInfo.isPalette && dragInfo.cell && isFrozenScheduleEntry(dragInfo.cell)) {
      toast('凍結課程不可移動，請先解除固定設定', 'warning');
      return;
    }
    if (!dragInfo.isPalette && dragInfo.day === day && dragInfo.per === per) return;

    const srcCls = dragInfo.cls;
    const subCode = dragInfo.isPalette ? dragInfo.subjectCode : (dragInfo.cell ? dragInfo.cell['科目代碼'] : '');
    const tcCode = dragInfo.teacherList?.length ? dragInfo.teacherList : (dragInfo.teacherCode || teacherCode);
    const teacherItems = dragInfo.teacherList?.length ? dragInfo.teacherList : (dragInfo.cell ? getCellTeacherList(dragInfo.cell) : []);
    const attr = dragInfo.isPalette ? (dragInfo.attr || '一般') : (dragInfo.cell ? (dragInfo.cell['課堂屬性'] || '一般') : '一般');
    if (!srcCls || !subCode) {
      toast('無法識別目標班級或科目', 'error');
      return;
    }

    const bindMovePlan = !dragInfo.isPalette
      ? buildBindMovePlan({
          subjectCode: subCode,
          srcCls,
          srcDay: dragInfo.day,
          srcPer: dragInfo.per,
          dstCls: srcCls,
          dstDay: day,
          dstPer: per,
          srcWeek: dragInfo.p8Week || '',
          dstWeek: dragInfo.p8Week || ''
        })
      : null;
    if (bindMovePlan && !bindMovePlan.ok) {
      await showModal('⛔ 綁班課程無法移動', bindMovePlan.error, 'error');
      return;
    }
    if (!dragInfo.isPalette && isDragProtectedScheduleEntry(dragInfo.cell) && !bindMovePlan) {
      toast('綁班課程無法在個人課表跨時段拖曳', 'warning');
      return;
    }

    let targetWeek = per === 8 ? (dragInfo.isPalette ? '' : String(dragInfo.p8Week || '').trim()) : '';
    if (per === 8 && !targetWeek) {
      targetWeek = getDefaultAlternateWeekType(srcCls, subCode, day, per, '');
    }

    if (bindMovePlan) {
      const canBindMove = await checkBindMoveConflicts(bindMovePlan, '綁班課程調動');
      if (!canBindMove) return;
      await doMove(srcCls, dragInfo.day, dragInfo.per, srcCls, day, per, dragInfo.p8Week || '', targetWeek, Boolean(canBindMove.force));
      return;
    }

    const existingCells = getOverlappingScheduleCellsAt(srcCls, day, per, targetWeek);
    const otherTeacherCells = (schedCells || []).filter(c =>
      c && !isPatrolScheduleEntry(c) &&
      String(c['課表ID'] || '') !== String(dragInfo.cell?.['課表ID'] || '') &&
      String(c['班級代碼'] || '') !== String(srcCls)
    );
    const dstClassCell = existingCells[0] || null;
    const otherCell = otherTeacherCells[0] || null;

    if ((dstClassCell && isBindScheduleEntry(dstClassCell)) || otherTeacherCells.some(isBindScheduleEntry)) {
      toast('綁班課程不可被單獨擠掉，請先整組移動綁班課程', 'warning');
      return;
    }
    if ((dstClassCell && isFrozenScheduleEntry(dstClassCell)) || (otherCell && isFrozenScheduleEntry(otherCell))) {
      toast('凍結課程不可被替換或對調，請先解除固定設定', 'warning');
      return;
    }
    if (!dragInfo.isPalette && schedCells.some(isPatrolScheduleEntry)) {
      toast('目標時段已有巡堂行程，請先處理巡堂格位', 'warning');
      return;
    }

    const confirmTargets = existingCells.length > 0 ? existingCells : (!dragInfo.isPalette ? otherTeacherCells : []);
    if (confirmTargets.length > 0) {
      const confirmed = await confirmTeacherTimetableOverwrite(
        dragInfo.cell || { subjectCode: subCode, classCode: srcCls, isPalette: dragInfo.isPalette },
        confirmTargets,
        day,
        per
      );
      if (!confirmed) return;
    }

    if (!dragInfo.isPalette && dstClassCell) {
      const srcWeek = dragInfo.p8Week || '';
      const dstExclude = { srcDay: dragInfo.day, srcPer: dragInfo.per, excludeIds: [dstClassCell['課表ID']] };
      const dstConflicts = detectConflicts(day, per, dragInfo.cell['教師姓名'], dragInfo.cell['科目代碼'], srcCls, srcCls, dstExclude, targetWeek);
      const canDst = await checkHandAdjustConflicts(dstConflicts, '教師課表調動（目標位置）');
      if (!canDst) return;

      const srcExclude = { srcDay: day, srcPer: per, excludeIds: [dragInfo.cell['課表ID']] };
      const srcConflicts = detectConflicts(dragInfo.day, dragInfo.per, dstClassCell['教師姓名'], dstClassCell['科目代碼'], srcCls, srcCls, srcExclude, srcWeek);
      const canSrc = await checkHandAdjustConflicts(srcConflicts, '教師課表調動（來源位置）');
      if (!canSrc) return;

      await doSwap({ cls: srcCls, day: dragInfo.day, per: dragInfo.per, week: srcWeek }, { cls: srcCls, day, per, week: targetWeek }, Boolean(canDst.force || canSrc.force));
      return;
    }

    if (!dragInfo.isPalette && otherCell) {
      const otherCls = String(otherCell['班級代碼'] || '');
      const srcWeek = dragInfo.p8Week || '';
      const dstExclude = { srcDay: dragInfo.day, srcPer: dragInfo.per, excludeIds: [otherCell['課表ID']] };
      const dstConflicts = detectConflicts(day, per, dragInfo.cell['教師姓名'], dragInfo.cell['科目代碼'], srcCls, [srcCls, otherCls], dstExclude, targetWeek);
      const canDst = await checkHandAdjustConflicts(dstConflicts, '教師課表調動（目標位置）');
      if (!canDst) return;

      const srcExclude = { srcDay: day, srcPer: per, excludeIds: [dragInfo.cell['課表ID']] };
      const srcConflicts = detectConflicts(dragInfo.day, dragInfo.per, otherCell['教師姓名'], otherCell['科目代碼'], otherCls, [srcCls, otherCls], srcExclude, srcWeek);
      const canSrc = await checkHandAdjustConflicts(srcConflicts, '教師課表調動（來源位置）');
      if (!canSrc) return;

      await doSwap({ cls: srcCls, day: dragInfo.day, per: dragInfo.per, week: srcWeek }, { cls: otherCls, day, per, week: targetWeek }, Boolean(canDst.force || canSrc.force));
      return;
    }

    const bindPlacementPlan = dragInfo.isPalette
      ? buildBindPlacementPlan({ subjectCode: subCode, classCode: srcCls, day, period: per, weekType: targetWeek, teacherCode: tcCode })
      : null;
    if (bindPlacementPlan && !bindPlacementPlan.ok) {
      await showModal('⛔ 無法排入綁班課程', bindPlacementPlan.error, 'error');
      return;
    }
    let ok;
    if (bindPlacementPlan) {
      ok = await checkBindMoveConflicts(bindPlacementPlan, '綁班課程排入');
    } else {
      const excludeInfo = !dragInfo.isPalette ? {
        srcDay: dragInfo.day,
        srcPer: dragInfo.per,
        excludeIds: [dragInfo.cell && dragInfo.cell['課表ID'], dstClassCell && dstClassCell['課表ID']].filter(Boolean)
      } : (dstClassCell ? { excludeIds: [dstClassCell['課表ID']] } : null);
      const conflicts = cachedConflictCheck(day, per, tcCode, subCode, srcCls, dragInfo.isPalette ? '' : srcCls, excludeInfo, targetWeek);
      ok = await checkHandAdjustConflicts(conflicts, dragInfo.isPalette ? '排課' : '移課');
    }
    if (!ok) return;
    const forcePlacement = Boolean(ok.force);

    if (dragInfo.isPalette) {
      let finalAttr = attr;
      if (per === 8 && (finalAttr === '一般' || !finalAttr)) {
        finalAttr = getDefaultAlternateWeekType(srcCls, subCode, day, per, '');
      }
      optimisticUpdateCell({
        classCode: srcCls,
        day,
        period: per,
        subjectCode: subCode,
        teacherCode: typeof tcCode === 'string' ? tcCode : getCellTeacherCodes({ '教師姓名': tcCode })[0] || teacherCode,
        teacherList: teacherItems,
        attr: finalAttr,
        isLocked: false,
        force: forcePlacement
      });
    } else {
      await doMove(srcCls, dragInfo.day, dragInfo.per, srcCls, day, per, dragInfo.p8Week || '', targetWeek, forcePlacement);
    }
  });
}

function renderTeacherTT(teacherCode, target = 'primary', opts = {}) {
  const pane = getTimetablePane(target);
  const t = idx.teacherByCode[teacherCode];
  const teacherTotalWeekly = idx.assignedWeeklyByTeacher?.[String(teacherCode)] || 0;
  const formalHoursFn = typeof countTeacherFormalScheduleHours === 'function'
    ? countTeacherFormalScheduleHours
    : (typeof window !== 'undefined' ? window.countTeacherFormalScheduleHours : null);
  const teacherFormalScheduled = typeof formalHoursFn === 'function'
    ? formalHoursFn(teacherCode)
    : idx.scheduledAssignedByTeacher?.[String(teacherCode)] || 0;
  // 完成度要包含第八節；正式鐘點則沿用排除第八節的規則。
  const teacherTotalScheduled = idx.scheduledAssignedByTeacher?.[String(teacherCode)] ?? teacherFormalScheduled;
  const teacherTotalRemaining = Math.max(0, teacherTotalWeekly - teacherTotalScheduled);
  const tName = t ? ((t['教師姓名'] || t['姓名']) || teacherCode) : teacherCode;
  const basicHoursRaw = parseWeeklyValue(t?.['基本鐘點'], NaN);
  const basicHours = Number.isFinite(basicHoursRaw) ? basicHoursRaw : 0;
  const overtimeHours = Math.max(0, teacherFormalScheduled - basicHours);
  const hoursLabel = '基本鐘點 ' + (Number.isFinite(basicHoursRaw) ? formatWeeklyValue(basicHours) : '未設定') +
    ' 節／超鐘點 ' + formatWeeklyValue(overtimeHours) + ' 節';
  const tLabelEl = document.getElementById(pane.teacherLabel);
  if (tLabelEl) {
    tLabelEl.innerHTML = `${tName} <span style="font-size:12px;font-weight:normal;color:var(--ink-2);margin-left:6px;">（${hoursLabel}）　📊（已排 <b>${teacherTotalScheduled}</b>／未排 <b style="color:${teacherTotalRemaining > 0 ? 'var(--danger)' : 'var(--success)'};">${teacherTotalRemaining}</b>／總共 <b>${teacherTotalWeekly}</b> 節）</span>`;
  }
    renderTeacherSubjectPalette(teacherCode, target);

  const html = makeTable((day, per) => {
    const tk   = teacherCode+'|'+day+'|'+per;
    const isBlocked = idx.blockSet.has(tk);
    const cells = idx.schedByTeacherSlot[tk] || [];

    if (per === 8) {
      const splitResult = renderTeacherP8Cell(day, teacherCode, target);
      if (splitResult) return splitResult;
    }

    // 只放過實際綁班、全鎖定同科目群組，或同科目且僅以協同教師身分跨班的情況。
    // 不同科目，或同一教師作為主師出現在兩班以上，仍然顯示真正衝堂。
    const isCoCross = cells.length > 1 && isAllowedCombinedClassCohort(
      cells.map(cell => ({
        classCode: String(cell['班級代碼'] || ''),
        subjectCode: String(cell['科目代碼'] || ''),
        isLocked: String(cell['是否鎖定'] || '').toUpperCase() === 'TRUE',
        isMainTeacher: String((getCellTeacherCodes(cell)[0] || '')).trim() === teacherCode
      })),
      { allowCoTeacher: true }
    );

    if (isBlocked && cells.length > 0 && !isCoCross) {
      const details = cells.map(cell => {
        const cls = String(cell['班級代碼'] || ''), clsInfo = idx.classByCode[cls];
        return teacherSubjectLabel(cell, teacherCode) + ' ' + (clsInfo ? clsInfo['班級名稱'] || cls : cls);
      });
      return { state:'filled', extra:['conflict'], text:'⛔ 不排課違規', meta:details.join('／'), draggable:false };
    }
    if (cells.length > 1 && !isCoCross) {
      const details = cells.map(cell => {
        const cls = String(cell['班級代碼'] || ''), clsInfo = idx.classByCode[cls];
        return teacherSubjectLabel(cell, teacherCode) + ' ' + (clsInfo ? clsInfo['班級名稱'] || cls : cls);
      });
      return { state:'filled', extra:['conflict'], text:`⚠️ 衝堂 ${cells.length} 門`, meta:details.join('／'), draggable:false };
    }
    if (isBlocked) return { state:'blocked', text:'⛔', meta:'點擊取消不排課' };
    if (cells.length === 0) return { state:'empty', draggable:false };
    const cell = cells[0];
    const patrol = isPatrolScheduleEntry(cell);
    const sub  = String(cell['科目代碼']||'');
    const cls  = String(cell['班級代碼']||'');
    const clsInfo = idx.classByCode[cls];
    const attr = cell['課堂屬性']||'一般';
    const locked = String(cell['是否鎖定']).toUpperCase()==='TRUE';
    const dragProtected = !patrol && isDragProtectedScheduleEntry(cell);
    const coTags = isCoCross ? ['co'] : [];
    const clsMeta = patrol ? '固定週巡堂' : (cells.length > 1
      ? [...new Set(cells.map(c => { const ci=idx.classByCode[String(c['班級代碼']||'')]; return ci? ci['班級名稱']||String(c['班級代碼']||'') : String(c['班級代碼']||''); }))].join('／')
      : (clsInfo ? clsInfo['班級名稱']||cls : cls));
    return {
      state: 'filled',
      extra: coTags.concat(locked ? ['locked'] : []),
       text:  patrol ? '巡堂' : teacherSubjectLabel(cell, teacherCode),
      meta:  clsMeta,
       color: patrol ? { bg:'#ede9fe', text:'#5b21b6' } : getScheduleCellColor(sub, cls),
       flags: patrol ? '巡' : (locked ? '🔒' : '') + (ATTR_LABELS[attr]||'') + (sub && cls && getBindGroupClasses(sub, cls) ? '🔗':''),
      draggable: patrol || (!dragProtected && cells.length === 1),
      dataCls: cls,
      dataTC: teacherCode
    };
  });

   document.getElementById(pane.teacherTT).innerHTML = html;
   bindTeacherTTEvents(teacherCode, target);
   if (!opts?.skipThird && target === 'primary' && ui.thirdOpen) renderThirdTimetable();
}

// ============================================================
// 待排科目選單（Subject Drag Palette）
// ============================================================
function renderSubjectPalette(classCode, target = 'primary') {
  const pane = getTimetablePane(target);
  const box = document.getElementById(pane.classPalette);
  const infoSpan = document.getElementById(pane.classPaletteInfo);
  if (!classCode) {
    if (box) box.innerHTML = '<span class="text-muted" style="font-size:12px;">選擇班級後，此處將自動列出該班配課科目與剩餘節數…</span>';
    if (infoSpan) infoSpan.textContent = '請選擇班級';
    return;
  }
  const cls = idx.classByCode[classCode];
  const className = cls ? (cls['班級名稱'] || classCode) : classCode;
  const grade = cls ? String(cls['年級'] || '') : '';
  const isVirtual = cls && cls['是否虛擬班'] === 'TRUE';
  if (infoSpan) infoSpan.textContent = className + (isVirtual ? ' (虛擬班)' : '');

  // 1. 取得該班在「配課設定」中的項目
  const myAssignments = idx.assignmentsByClass?.[String(classCode)] || [];

  // 統計全班所有科目的總節數狀況
   let classTotalWeekly = 0;
   myAssignments.forEach(a => {
     const sub = idx.subjectByCode[a['科目代碼']];
     classTotalWeekly += getAssignmentWeeklyValue(a, sub, 3);
  });
  const classTotalScheduled = idx.scheduleCountByClass?.[String(classCode)] || 0;
  const classTotalRemaining = Math.max(0, classTotalWeekly - classTotalScheduled);

   if (infoSpan) {
     infoSpan.innerHTML = `${className}${isVirtual ? ' (虛擬班)' : ''} <span style="font-size:12px;font-weight:normal;color:var(--ink-2);margin-left:6px;">📊 (已排 <b>${formatWeeklyValue(classTotalScheduled)}</b> / 未排 <b style="color:${classTotalRemaining > 0 ? 'var(--danger)' : 'var(--success)'};">${formatWeeklyValue(classTotalRemaining)}</b> / 總共 <b>${formatWeeklyValue(classTotalWeekly)}</b> 節)</span>`;
  }

  if (myAssignments.length === 0) {
    if (box) box.innerHTML = '<span class="text-muted" style="font-size:12px;">⚠️ 此班級尚未建立「配課設定」，請先至「📋 配課」分頁指定任課教師與科目。</span>';
    return;
  }

   const items = myAssignments.map(a => {
     const sub = idx.subjectByCode[a['科目代碼']];
     const weekly = getAssignmentWeeklyValue(a, sub, 3);
    const teacherList = getCellTeacherList(a);
    const teacherCodes = teacherList.map(item => item['教師姓名']).filter(Boolean);
    return {
      subjectCode: a['科目代碼'],
      teacherCode: teacherCodes[0] || a['教師姓名'] || a['教師代碼'] || a['教師'] || '',
      teacherList,
       weekly,
       attr: isVirtual ? '抽離' : '一般',
       isAlternateWeek: isAlternateWeeklyValue(weekly)
    };
  });

  let pendingHtml = '', doneHtml = '', doneCount = 0;
  items.forEach((item, itemIndex) => {
    const subCode = item.subjectCode;
    const tcCode = item.teacherCode;
    const weekly = item.weekly;
    const color = getScheduleCellColor(subCode, classCode);
    const teacher = tcCode ? (idx.teacherByCode[tcCode] || idx.teacherByCode[parseTeacherCode(tcCode)]) : null;
    const teacherName = item.teacherList.map(itemTeacher => {
      const code = String(itemTeacher['教師姓名'] || '').trim();
      const itemTeacherInfo = idx.teacherByCode[code] || idx.teacherByCode[parseTeacherCode(code)];
      const name = itemTeacherInfo
        ? (itemTeacherInfo['教師姓名'] || itemTeacherInfo['姓名'] || code)
        : code;
      return itemTeacher['標籤'] && itemTeacher['標籤'] !== '主'
        ? name + '（' + itemTeacher['標籤'] + '）'
        : name;
    }).join('／') || (teacher ? (teacher['教師姓名'] || teacher['姓名'] || tcCode) : (tcCode || '未定'));

    const scheduledCount = idx.scheduleCountByClassSubject?.[String(classCode)+'|'+String(subCode)] || 0;
    const remaining = Math.max(0, weekly - scheduledCount);
    const isDone = remaining === 0;

    const badgeClass = isDone ? 'zero' : 'remaining';
     const badgeText = isDone ? `已滿 ${formatWeeklyValue(scheduledCount)}/${formatWeeklyValue(weekly)}節` : `已排 ${formatWeeklyValue(scheduledCount)}/${formatWeeklyValue(weekly)} (剩${formatWeeklyValue(remaining)}節)`;
    const cardClass = isDone ? 'palette-card done' : 'palette-card';

      const card = `<div class="${cardClass}" ${!isDone ? 'draggable="true"' : ''} data-item-index="${itemIndex}" data-sub="${esc(subCode)}" data-tc="${esc(tcCode)}" data-attr="${esc(item.attr)}" data-alternate-week="${item.isAlternateWeek ? 'true' : 'false'}"><span class="cell-chip" title="${esc(subCode)}" style="background:${color.bg};color:${color.text};padding:1px 5px;font-size:11px;">${esc(subCode)}</span><span class="palette-link" onclick="selectTeacherFromPalette(event, '${esc(tcCode)}')" title="教師：${esc(teacherName)}；點擊切換右欄課表">👤 <span class="palette-label-text">${esc(teacherName)}</span></span><span class="badge-count ${badgeClass}" title="${esc(badgeText)}">${badgeText}</span></div>`;
    if (isDone) { doneHtml += card; doneCount++; }
    else pendingHtml += card;
  });

  if (box) {
    box.innerHTML = pendingHtml + (doneCount > 0 ? `<details class="palette-collapse"><summary>已排完（${doneCount} 科）</summary>${doneHtml}</details>` : '');
    box._classPaletteItems = items;
    ensureClassPaletteDelegation(box);
  }
}

function ensureClassPaletteDelegation(box) {
  if (!box || typeof box.addEventListener !== 'function' || box._classPaletteDelegationBound) return;
  box._classPaletteDelegationBound = true;
  box.addEventListener('dragstart', e => {
    const card = e.target?.closest ? e.target.closest('.palette-card[draggable="true"]') : null;
    if (!card || !box.contains(card)) return;
    const items = box._classPaletteItems || [];
    const item = items[parseInt(card.dataset.itemIndex, 10)];
    ui.drag = {
      isPalette: true,
      subjectCode: card.dataset.sub,
      teacherCode: card.dataset.tc,
      teacherList: item?.teacherList || [],
      attr: card.dataset.attr,
      isAlternateWeek: item?.isAlternateWeek === true
    };
    resetDragConflictCache();
    card.style.opacity = '0.4';
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });
  box.addEventListener('dragend', e => {
    const card = e.target?.closest ? e.target.closest('.palette-card[draggable="true"]') : null;
    ui.drag = null;
    if (card) card.style.opacity = '1';
    clearTimetableDragHighlights();
  });
}

function bindClassTTEvents(target = 'primary') {
  const pane = getTimetablePane(target);
  const container = document.getElementById(pane.classTT);
  if (!container) return;
  container._classTTState = { target };
  ensureClassTTDelegation(container);
}

function ensureClassTTDelegation(container) {
  if (!container || typeof container.addEventListener !== 'function' || container._classTTDelegationBound) return;
  container._classTTDelegationBound = true;

  const getP8Info = el => {
    const day = parseInt(el.dataset.day, 10);
    const per = parseInt(el.dataset.per, 10);
    const cls = el.dataset.cls || ui.selectedClass;
    const weekType = el.dataset.week;
    const p8cells = idx.schedByClassSlotP8[cls + '|' + day + '|8'] || {};
    return { day, per, cls, weekType, cell: p8cells[weekType] };
  };
  const getRegularInfo = td => {
    const day = parseInt(td.dataset.day, 10);
    const per = parseInt(td.dataset.per, 10);
    const cls = td.dataset.cls || ui.selectedClass;
    const cell = idx.schedByClassSlot[cls + '|' + day + '|' + per];
    return { day, per, cls, cell };
  };

  container.addEventListener('click', e => {
    const p8El = e.target?.closest ? e.target.closest('.p8-subcell') : null;
    if (p8El && container.contains(p8El)) {
      const { day, per, cls, weekType, cell } = getP8Info(p8El);
      if (p8El.classList.contains('p8-empty')) {
        openAssignModal(cls, day, per, weekType);
        return;
      }
      const tc = cycleNextTeacher(getCellTeacherCodes(cell), ui.selectedTeacher);
      if (tc) {
        ui.selectedTeacher = tc;
        document.getElementById('sel-teacher').value = tc;
        renderTeacherTT(tc);
      }
      return;
    }
    const td = e.target?.closest ? e.target.closest('.tt-cell:not(.tt-cell-p8)') : null;
    if (!td || !container.contains(td) || td.classList.contains('blocked')) return;
    const { day, per, cls, cell } = getRegularInfo(td);
    if (!cell) { openAssignModal(cls, day, per); return; }
    const tc = cycleNextTeacher(getCellTeacherCodes(cell), ui.selectedTeacher);
    if (tc) {
      ui.selectedTeacher = tc;
      document.getElementById('sel-teacher').value = tc;
      renderTeacherTT(tc);
    }
  });

  container.addEventListener('contextmenu', e => {
    const p8El = e.target?.closest ? e.target.closest('.p8-subcell') : null;
    if (p8El && container.contains(p8El)) {
      e.preventDefault();
      const { day, per, cls, weekType, cell } = getP8Info(p8El);
      ui.ctxTarget = { cls, day, per, cell, week: weekType };
      showCtxMenu(e.pageX, e.pageY, !!cell, cell && String(cell['是否鎖定']).toUpperCase() === 'TRUE');
      return;
    }
    const td = e.target?.closest ? e.target.closest('.tt-cell:not(.tt-cell-p8)') : null;
    if (!td || !container.contains(td)) return;
    e.preventDefault();
    const { day, per, cls, cell } = getRegularInfo(td);
    ui.ctxTarget = { cls, day, per, cell };
    showCtxMenu(e.pageX, e.pageY, !!cell, cell && String(cell['是否鎖定']).toUpperCase() === 'TRUE');
  });

  container.addEventListener('dragstart', e => {
    const p8El = e.target?.closest ? e.target.closest('.p8-subcell') : null;
    if (p8El && container.contains(p8El)) {
      const { day, per, cls, weekType, cell } = getP8Info(p8El);
      if (!cell || !p8El.draggable || isDragProtectedScheduleEntry(cell)) { e.preventDefault(); return; }
      ui.drag = { cls, day, per, cell, isSwap: e.shiftKey, p8Week: weekType };
      resetDragConflictCache();
      p8El.classList.add('dragging');
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      return;
    }
    const td = e.target?.closest ? e.target.closest('.tt-cell:not(.tt-cell-p8)') : null;
    if (!td || !container.contains(td) || !td.draggable) return;
    const { day, per, cls, cell } = getRegularInfo(td);
    if (!cell || isFrozenScheduleEntry(cell)) { e.preventDefault(); return; }
    ui.drag = { cls, day, per, cell, isSwap: e.shiftKey };
    resetDragConflictCache();
    td.classList.add('dragging');
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });

  container.addEventListener('dragend', e => {
    const targetEl = e.target?.closest ? e.target.closest('.p8-subcell, .tt-cell:not(.tt-cell-p8)') : null;
    ui.drag = null;
    if (targetEl) targetEl.classList.remove('dragging');
    clearTimetableDragHighlights();
  });

  container.addEventListener('dragover', e => {
    if (!ui.drag) return;
    const p8El = e.target?.closest ? e.target.closest('.p8-subcell') : null;
    if (p8El && container.contains(p8El)) {
      e.preventDefault();
      const { day, per, cls } = getP8Info(p8El);
      highlightDropZone(p8El, day, per, cls);
      return;
    }
    const td = e.target?.closest ? e.target.closest('.tt-cell:not(.tt-cell-p8)') : null;
    if (!td || !container.contains(td)) return;
    e.preventDefault();
    const { day, per, cls } = getRegularInfo(td);
    highlightDropZone(td, day, per, cls);
  });

  container.addEventListener('dragleave', e => {
    const targetEl = e.target?.closest ? e.target.closest('.p8-subcell, .tt-cell:not(.tt-cell-p8)') : null;
    if (targetEl) targetEl.classList.remove('drag-ok', 'drag-err', 'drag-warn');
  });

  container.addEventListener('drop', async e => {
    if (!ui.drag) return;
    const p8El = e.target?.closest ? e.target.closest('.p8-subcell') : null;
    if (p8El && container.contains(p8El)) {
      e.preventDefault();
      p8El.classList.remove('drag-ok', 'drag-err', 'drag-warn');
      const { day, per, cls, weekType } = getP8Info(p8El);
      await executeDrop(day, per, cls, weekType);
      return;
    }
    const td = e.target?.closest ? e.target.closest('.tt-cell:not(.tt-cell-p8)') : null;
    if (!td || !container.contains(td)) return;
    e.preventDefault();
    td.classList.remove('drag-ok', 'drag-err', 'drag-warn');
    const { day, per, cls } = getRegularInfo(td);
    await executeDrop(day, per, cls, '');
  });
}

function highlightDropZone(el, day, per, cls) {
  const weekType = per === 8 ? String(el.dataset.week || '').trim() : '';
  const targetCell = getScheduleCellAt(cls, day, per, weekType);
  let structuralError = '';
  if (ui.drag.isPalette) {
    if (targetCell && isFrozenScheduleEntry(targetCell)) {
      structuralError = '凍結課程不可覆寫';
    } else if (targetCell && isBindScheduleEntry(targetCell)) {
      structuralError = '綁班課程不可被單獨擠掉';
    } else {
      const bindClasses = getBindGroupClasses(ui.drag.subjectCode, cls);
       if (bindClasses && bindClasses.some(bindClass => getOverlappingScheduleCellsAt(bindClass, day, per, weekType).length > 0)) {
        structuralError = '綁班課程必須整組排入空時段';
      }
    }
  } else {
    const sourceCell = ui.drag.cell;
    if (!sourceCell || isFrozenScheduleEntry(sourceCell)) {
      structuralError = '凍結課程不可移動';
    } else {
      const bindPlan = buildBindMovePlan({
        subjectCode: sourceCell['科目代碼'],
        srcCls: ui.drag.cls,
        srcDay: ui.drag.day,
        srcPer: ui.drag.per,
        dstCls: cls,
        dstDay: day,
        dstPer: per,
        srcWeek: ui.drag.p8Week || '',
        dstWeek: weekType
      });
      if (bindPlan && !bindPlan.ok) structuralError = bindPlan.error || '綁班課程無法整組移動';
      if (!bindPlan) {
        if (targetCell && isFrozenScheduleEntry(targetCell)) structuralError = '凍結課程不可互調';
        else if (targetCell && isBindScheduleEntry(targetCell)) structuralError = '綁班課程不可被單獨擠掉';
      }
    }
  }
  if (structuralError) {
    el.classList.remove('drag-ok','drag-warn');
    el.classList.add('drag-err');
    return;
  }

  let tcCode = '', subCode = '', excludeCls = '';
  if (ui.drag.isPalette) {
    tcCode  = ui.drag.teacherList?.length ? ui.drag.teacherList : ui.drag.teacherCode;
    subCode = ui.drag.subjectCode;
    excludeCls = '';
  } else {
    const srcCell = ui.drag.cell;
    if (!srcCell) return;
    tcCode  = srcCell['教師姓名'];
    subCode = srcCell['科目代碼'];
    excludeCls = ui.drag.cls;
  }
      const excludeInfo = ui.drag ? {
        srcDay: ui.drag.isPalette ? undefined : ui.drag.day,
        srcPer: ui.drag.isPalette ? undefined : ui.drag.per,
        excludeIds: [ui.drag.isPalette ? null : ui.drag.cell && ui.drag.cell['課表ID'], targetCell && targetCell['課表ID']]
      } : null;
  const conflicts = cachedConflictCheck(day, per, tcCode, subCode, cls, excludeCls, excludeInfo, weekType);
  el.classList.remove('drag-ok','drag-err','drag-warn');
  if (conflicts.length > 0) el.classList.add('drag-err');
  else                     el.classList.add('drag-ok');
}

async function executeDrop(day, per, cls, weekType) {
  if (ui.drag.isPalette) {
    const dragInfo = ui.drag;
    ui.drag = null;
    const effectiveWeekType = per === 8
      ? (dragInfo.isAlternateWeek ? getDefaultAlternateWeekType(cls, dragInfo.subjectCode, day, per, weekType) : weekType)
      : '';
    const attr = per === 8 ? (effectiveWeekType || dragInfo.attr || '一般') : (dragInfo.attr || '一般');
     const targetCell = per === 8
      ? (idx.schedByClassSlotP8[cls + '|' + day + '|8'] || {})[effectiveWeekType]
      : idx.schedByClassSlot[cls + '|' + day + '|' + per];
    const overlappingTargetCells = getOverlappingScheduleCellsAt(cls, day, per, per === 8 ? attr : '');
    const unexpectedOverlap = overlappingTargetCells.find(cell =>
      !targetCell || String(cell['課表ID'] || '').trim() !== String(targetCell['課表ID'] || '').trim()
    );
    if (unexpectedOverlap) {
      toast('第八節已有整節或同週課程，不能再排入重疊課程', 'warning');
      return;
    }
    if (targetCell && isFrozenScheduleEntry(targetCell)) {
      toast('凍結課程不可覆寫，請先解除固定設定', 'warning');
      return;
    }
    if (targetCell && isBindScheduleEntry(targetCell)) {
      toast('綁班課程不可被單獨擠掉，請先整組移動綁班課程', 'warning');
      return;
    }
    const bindClasses = getBindGroupClasses(dragInfo.subjectCode, cls);
    if (bindClasses) {
      const occupiedBindTargets = bindClasses.flatMap(classCode =>
        getOverlappingScheduleCellsAt(classCode, day, per, per === 8 ? attr : '').map(entry => `${classCode}（${entry['科目代碼'] || '未知科目'}）`)
      );
      if (occupiedBindTargets.length > 0) {
        toast(`綁班課程必須整組排入空時段；目的地已有課程：${occupiedBindTargets.join('、')}`, 'warning');
        return;
      }
    }
    let canPlace;
    if (bindClasses) {
      const bindPlacementPlan = buildBindPlacementPlan({
        subjectCode: dragInfo.subjectCode,
        classCode: cls,
        day,
        period: per,
       weekType: effectiveWeekType,
        teacherCode: dragInfo.teacherList?.length ? dragInfo.teacherList : dragInfo.teacherCode
      });
      canPlace = await checkBindMoveConflicts(bindPlacementPlan, '綁班課程排入');
    } else {
      const teacherValue = dragInfo.teacherList?.length ? dragInfo.teacherList : dragInfo.teacherCode;
       const targetCell = per === 8 ? getScheduleCellAt(cls, day, per, attr) : getScheduleCellAt(cls, day, per);
      const conflicts = detectConflicts(day, per, teacherValue, dragInfo.subjectCode, cls, '', {
        excludeIds: [targetCell && targetCell['課表ID']]
       }, attr);
      canPlace = await checkHandAdjustConflicts(conflicts, '調動');
    }
    if (!canPlace) return;

    optimisticUpdateCell({
      classCode:  cls,
      day:        day,
      period:     per,
      subjectCode: dragInfo.subjectCode,
      teacherCode: dragInfo.teacherCode,
      teacherList: dragInfo.teacherList,
      attr:        attr,
      isLocked:    false,
      force:      Boolean(canPlace.force)
    });
    return;
  }

  const srcCls = ui.drag.cls, srcDay = ui.drag.day, srcPer = ui.drag.per;
  const srcCell = ui.drag.cell;
  const srcWeek = ui.drag.p8Week || '';
  ui.drag = null;
  if (srcCell && isFrozenScheduleEntry(srcCell)) {
    toast('凍結課程不可移動，請先解除固定設定', 'warning');
    return;
  }

  const bindPlan = buildBindMovePlan({
    subjectCode: srcCell && srcCell['科目代碼'],
    srcCls,
    srcDay,
    srcPer,
    dstCls: cls,
    dstDay: day,
    dstPer: per,
    srcWeek,
    dstWeek: weekType
  });
  if (bindPlan) {
    if (!bindPlan.ok) {
      toast(bindPlan.error || '綁班課程無法整組移動', 'warning');
      return;
    }
    const canBindMove = await checkBindMoveConflicts(bindPlan, '綁班課程調動');
    if (!canBindMove) return;
    await doMove(srcCls, srcDay, srcPer, cls, day, per, srcWeek, weekType, Boolean(canBindMove.force));
    return;
  }

  if (srcCls === cls && srcDay === day && srcPer === per) return;

  const isOccupied = per === 8
    ? !!(idx.schedByClassSlotP8[cls+'|'+day+'|8'] || {})[weekType]
    : !!idx.schedByClassSlot[cls+'|'+day+'|'+per];

  const occupiedCell = per === 8
    ? (idx.schedByClassSlotP8[cls+'|'+day+'|8'] || {})[weekType]
    : idx.schedByClassSlot[cls+'|'+day+'|'+per];
  if (occupiedCell && isBindScheduleEntry(occupiedCell)) {
    toast('綁班課程不可被單獨擠掉，請先整組移動綁班課程', 'warning');
    return;
  }

  if (isOccupied) {
    const dstCell = per === 8
      ? (idx.schedByClassSlotP8[cls+'|'+day+'|8'] || {})[weekType]
      : idx.schedByClassSlot[cls+'|'+day+'|'+per];
    if (dstCell && isFrozenScheduleEntry(dstCell)) {
      toast('凍結課程不可被對調，請先解除固定設定', 'warning');
      return;
    }

    const dstExcludeInfo = { srcDay: srcDay, srcPer: srcPer, excludeIds: [dstCell && dstCell['課表ID']] };
    const dstConflicts = detectConflicts(day, per, srcCell['教師姓名'], srcCell['科目代碼'], cls, [srcCls, cls], dstExcludeInfo, weekType);
    const canDst = await checkHandAdjustConflicts(dstConflicts, '兩班對調（目標位置）');
    if (!canDst) return;
    let swapForce = Boolean(canDst.force);

    if (dstCell) {
    const srcExcludeInfo = { srcDay: day, srcPer: per, excludeIds: [srcCell && srcCell['課表ID']] };
      const srcConflicts = detectConflicts(srcDay, srcPer, dstCell['教師姓名'], dstCell['科目代碼'], srcCls, [srcCls, cls], srcExcludeInfo, srcWeek);
      const canSrc = await checkHandAdjustConflicts(srcConflicts, '兩班對調（來源位置）');
      if (!canSrc) return;
      swapForce = swapForce || Boolean(canSrc.force);
    }
    await doSwap({ cls: srcCls, day: srcDay, per: srcPer, week: srcWeek }, { cls, day, per, week: weekType }, swapForce);
  } else {
    const moveExcludeInfo = { srcDay: srcDay, srcPer: srcPer, excludeIds: [srcCell && srcCell['課表ID']] };
    const conflicts = detectConflicts(day, per, srcCell['教師姓名'], srcCell['科目代碼'], cls, srcCls, moveExcludeInfo, weekType);
    const canMove = await checkHandAdjustConflicts(conflicts, '調動');
    if (!canMove) return;
    await doMove(srcCls, srcDay, srcPer, cls, day, per, srcWeek, weekType, Boolean(canMove.force));
  }
}

// ============================================================
// 課表操作（Write）
// ============================================================
function initContextMenuHandlers() {
  if (typeof document === 'undefined') return;
  const assignBtn = document.getElementById('ctx-assign');
  if (assignBtn) assignBtn.onclick = () => {
    if (!ui.ctxTarget) return;
    const { cls, day, per } = ui.ctxTarget;
    openAssignModal(cls, day, per);
  };
  const editBtn = document.getElementById('ctx-edit');
  if (editBtn) editBtn.onclick = () => {
    if (!ui.ctxTarget) return;
    const { cls, day, per } = ui.ctxTarget;
    openAssignModal(cls, day, per);
  };
  const lockBtn = document.getElementById('ctx-lock');
  if (lockBtn) lockBtn.onclick = () => {
    const t = ui.ctxTarget;
    if (!t || !t.cell) return;
    optimisticLockCell(t.cls, t.day, t.per, true, t.week);
  };
  const unlockBtn = document.getElementById('ctx-unlock');
  if (unlockBtn) unlockBtn.onclick = () => {
    const t = ui.ctxTarget;
    if (!t || !t.cell) return;
    optimisticLockCell(t.cls, t.day, t.per, false, t.week);
  };
  const overtimeBtn = document.getElementById('ctx-overtime');
  if (overtimeBtn) overtimeBtn.onclick = () => {
    const t = ui.ctxTarget;
    if (!t || !t.cell || !t.teacherView || t.per === 8 || isManualOnlyPeriod(t.per)) return;
    optimisticSetOvertime(t.cls, t.day, t.per, t.teacherCode, !isOvertimeScheduleEntry(t.cell, t.teacherCode));
  };
  const clearBtn = document.getElementById('ctx-clear');
  if (clearBtn) clearBtn.onclick = async () => {
    const t = ui.ctxTarget;
    if (!t) return;
    const isLocked = t.cell && String(t.cell['是否鎖定']).toUpperCase() === 'TRUE';
    if (t.cell && isClearFrozenScheduleEntry(t.cell)) {
      toast('凍結課程不可清除，請先解除固定設定', 'warning');
      return;
    }
    if (isLocked) {
      const ok = await showModal('確認', '此格已鎖定，仍要清除嗎？', 'confirm');
      if (!ok) return;
    }
    optimisticClearCell(t.cls, t.day, t.per, t.week);
  };
}
if (typeof document !== 'undefined') initContextMenuHandlers();

// ============================================================
// 課表操作（Write）
// ============================================================
async function doMove(srcCls, srcDay, srcPer, dstCls, dstDay, dstPer, srcWeek, dstWeek, force = false) {
  optimisticMoveCell(srcCls, srcDay, srcPer, dstCls, dstDay, dstPer, srcWeek, dstWeek, force);
}

async function doSwap(a, b, force = false) {
  optimisticSwapCells(a, b, force);
}

// ============================================================
// 指派課程 Modal
// ============================================================
function openAssignModal(cls, day, per, weekType) {
  const targetCell = per === 8 && weekType
    ? ((idx.schedByClassSlotP8?.[cls + '|' + day + '|8'] || {})[weekType] || null)
    : ((idx && idx.schedByClassSlot) ? (idx.schedByClassSlot[cls + '|' + day + '|' + per] || null) : null);
  ui.assignTarget = {
    cls: cls, day: day, per: per, week: weekType || '',
    cell: targetCell, assignmentId: '', subjectCode: targetCell ? String(targetCell['科目代碼'] || '').trim() : ''
  };
  const weekHint = per === 8 && weekType ? ' [' + weekType + ']' : '';
  document.getElementById('assignModalTitle').textContent =
    '📝 指派課程 — '+(idx.classByCode[cls]?.['班級名稱']||cls)+' '+DAY_NAMES[day]+' '+periodLabel(per)+weekHint;

  // 取得這個班的配課設定
  const myAssignments = state.assignments.filter(a =>
    String(a['班級代碼']) === String(cls) && (per !== 8 || isHelperSubjectCode(a['科目代碼']) ||
      isAlternateWeeklyValue(getAssignmentWeeklyValue(a, idx.subjectByCode?.[String(a['科目代碼'] || '').trim()], 3)))
  );
  const existingSub = targetCell ? String(targetCell['科目代碼'] || '').trim() : '';
  const matchedAssignmentIndex = existingSub
    ? myAssignments.findIndex(a => String(a['科目代碼'] || '').trim() === existingSub)
    : -1;
  const matchedAssignment = matchedAssignmentIndex >= 0 ? myAssignments[matchedAssignmentIndex] : null;
  if (matchedAssignment) {
    ui.assignTarget.assignmentId = String(matchedAssignment['配課ID'] || '');
  }

  let html = '<div class="form-group mb-3"><label>從配課設定選擇</label><select id="modal-assign-sel" style="margin-bottom:8px;">';
  html += '<option value="">— 選擇課程 —</option>';
  myAssignments.forEach((a, i) => {
    const assignmentTeachers = getCellTeacherList(a);
    const teacherLabel = assignmentTeachers.map(item => {
      const code = String(item['教師姓名'] || item['姓名'] || '').trim();
      const teacher = idx.teacherByCode[code];
      const name = teacher ? (teacher['姓名'] || teacher['教師姓名'] || code) : code;
      const tag = String(item['標籤'] || '').trim();
      return name + (tag ? '（' + tag + '）' : '');
    }).filter(Boolean).join('、');
    html += '<option value="'+i+'"'+(i === matchedAssignmentIndex ? ' selected' : '')+'>'+esc(a['科目代碼'] || '')+' / '+esc(teacherLabel)+'</option>';
  });
  html += '</select></div>';
  html += '<div style="border-top:1px solid var(--border);padding-top:14px;">';
  if (per !== 8) {
    html += '<div class="text-sm font-bold mb-2">'+(matchedAssignment ? '已同步配課主／協同教師，可直接調整：' : '或手動輸入：')+'</div>';
    html += '<div class="form-row"><div class="form-group"><label>科目代碼</label>';
    html += '<select id="modal-sub"><option value="">— 選擇 —</option>';
    state.subjects
      .filter(s => !isHelperSubjectCode(s['科目代碼']))
      .forEach(s => { html += '<option value="'+esc(s['科目代碼'])+'">'+esc(s['科目代碼'])+'</option>'; });
    html += '</select></div>';
  } else {
    html += '<div class="text-sm mb-2">教師將自動沿用配課設定，不需另外輸入。</div>';
  }
  html += '<div class="form-group"><label>課堂屬性</label>';
  html += '<select id="modal-attr">';
  if (isManualOnlyPeriod(per) || isVirtualClassCode(cls)) {
    html += '<option value="抽離" selected>抽離</option>';
  } else if (per === 8) {
    html += '<option value="單週"'+(weekType==='單週'?' selected':'')+'>單週</option>';
    html += '<option value="雙週"'+(weekType==='雙週'?' selected':'')+'>雙週</option>';
  } else {
    html += '<option value="一般">一般</option><option value="抽離">抽離</option><option value="單週">單週</option><option value="雙週">雙週</option>';
  }
  html += '</select></div>' + (per !== 8 ? '</div>' : '');

  // 課表指派視窗只呈現既有教師；協同教師請在配課設定中管理。
  const TAG_PRESETS = ['台', '手', '客', '英', '原'];
  const tagListHtml = '<datalist id="modal-tag-list">' + TAG_PRESETS.map(v => '<option value="'+esc(v)+'">').join('') + '</datalist>';
  // 既有教師清單；若只有主教師代碼（舊資料），仍以主師作為教師1
  const existingCell = (ui.assignTarget && ui.assignTarget.cell) ? ui.assignTarget.cell : null;
  const existingCellList = matchedAssignment && getCellTeacherList(matchedAssignment).length > 0
    ? getCellTeacherList(matchedAssignment)
    : existingCell
    ? (function(){
        const l = getCellTeacherList(existingCell);
        if (l.length > 0) return l;
        const tc = String(ui.assignTarget.cell['教師姓名'] || '').trim();
        return tc ? [{ '教師姓名': tc, '標籤': '' }] : [];
      })()
    : [];
  const teacherDisplayVal = (code) => {
    if (!code) return '';
    const t = idx.teacherByCode[String(code)];
    return formatTeacherCodeName(code, t);
  };
  const targetRowHtml = (n, selId, tagId, item) => {
    const code = item ? String(item['教師姓名']||'') : '';
    const tag  = item ? String(item['標籤']||'') : '';
    const removeButton = n > 3
      ? '<button type="button" class="btn btn-ghost btn-xs assign-teacher-remove" title="移除此教師">移除</button>'
      : '';
    return '<div class="form-group assign-teacher-row" data-teacher-row="'+n+'" style="margin-bottom:6px;">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">'
      + '<label style="margin-bottom:4px;">'+(n===1?'教師1（主師）':'教師'+n)+'</label>' + removeButton + '</div>'
      + '<div style="display:flex;gap:6px;align-items:center;">'
      + '<input id="'+selId+'" data-teacher-input class="combobox-input" placeholder="— 輸入代碼／姓名篩選 —" value="'+esc(teacherDisplayVal(code))+'">'
      + '<input id="'+tagId+'" data-teacher-tag list="modal-tag-list" placeholder="標籤" style="max-width:64px;" value="'+esc(tag)+'">'
      + '</div></div>';
  };
  const defaultTeacherRows = Math.max(1, existingCellList.length);
  html += '<div id="assign-teacher-list"' + (per === 8 ? ' style="display:none;"' : '') + '>';
  for (let n = 1; n <= defaultTeacherRows; n++) {
    const suffix = n === 1 ? '' : String(n);
    html += targetRowHtml(n, 'modal-tc' + suffix, 'modal-tc' + suffix + '-tag', existingCellList[n - 1] || null);
  }
  html += '</div>';
  html += tagListHtml;
  html += '</div>';

  document.getElementById('assignModalBody').innerHTML = html;

  // 將教師欄初始化為「打字篩選」組合框，動態新增的欄位沿用相同控制。
  const teacherListEl = document.getElementById('assign-teacher-list');
  const bindTeacherRow = row => {
    const input = row.querySelector('[data-teacher-input]');
    if (input) initTeacherCombobox(input);
    const remove = row.querySelector('.assign-teacher-remove');
    if (remove) remove.addEventListener('click', () => {
      closeGlobalTeacherDropdown();
      row.remove();
    });
  };
  if (teacherListEl) teacherListEl.querySelectorAll('.assign-teacher-row').forEach(bindTeacherRow);
  const fillTeacherRows = (items) => {
    const teacherItems = Array.isArray(items) ? items : [];
    if (!teacherListEl) return;
    const rowCount = Math.max(1, teacherItems.length);
    teacherListEl.innerHTML = Array.from({length: rowCount}, (_, index) => {
      const n = index + 1;
      const suffix = n === 1 ? '' : String(n);
      return targetRowHtml(n, 'modal-tc' + suffix, 'modal-tc' + suffix + '-tag', teacherItems[index] || null);
    }).join('');
    teacherListEl.querySelectorAll('.assign-teacher-row').forEach(bindTeacherRow);
    const rows = [...teacherListEl.querySelectorAll('.assign-teacher-row')];
    rows.forEach((row, index) => {
      const item = teacherItems[index] || {};
      const input = row.querySelector('[data-teacher-input]');
      const tag = row.querySelector('[data-teacher-tag]');
      const code = String(item['教師姓名'] || item['姓名'] || '').trim();
      if (input) {
        input.value = teacherDisplayVal(code);
        if (input._updateControls) input._updateControls();
      }
      if (tag) tag.value = String(item['標籤'] || '').trim();
    });
  };

  // 既有值自動帶入：修改已有課程時，自動填上原有的科目代碼
  if (ui.assignTarget && existingSub) ui.assignTarget.subjectCode = existingSub;
  if (existingSub) {
    const subSel = document.getElementById('modal-sub');
    if (subSel) subSel.value = existingSub;
  }

  // 選配課設定時自動填入（主師，多師清空）
  document.getElementById('modal-assign-sel').addEventListener('change', function() {
    const a = myAssignments[parseInt(this.value,10)];
    if (!a) {
      if (ui.assignTarget) ui.assignTarget.assignmentId = '';
      return;
    }
    if (ui.assignTarget) ui.assignTarget.assignmentId = String(a['配課ID'] || '');
    if (ui.assignTarget) ui.assignTarget.subjectCode = String(a['科目代碼'] || '').trim();
    const subjectSelect = document.getElementById('modal-sub');
    if (subjectSelect) subjectSelect.value = a['科目代碼'] || '';
    fillTeacherRows(getCellTeacherList(a));
  });

  document.getElementById('modal-sub')?.addEventListener('change', function() {
    const selectedSubject = String(this.value || '').trim();
    const assignment = myAssignments.find(item => String(item['科目代碼'] || '').trim() === selectedSubject);
    if (ui.assignTarget) ui.assignTarget.assignmentId = assignment ? String(assignment['配課ID'] || '') : '';
    if (ui.assignTarget) ui.assignTarget.subjectCode = selectedSubject;
    fillTeacherRows(assignment ? getCellTeacherList(assignment) : []);
  });

  document.getElementById('assignModal').classList.add('show');
}

function closeAssignModal() {
  document.getElementById('assignModal').classList.remove('show');
  ui.assignTarget = null;
}

function buildManualAssignmentData(classCode, subjectCode, teacherList, preferredAssignmentId) {
  const matches = (state.assignments || []).filter(assignment =>
    String(assignment['班級代碼'] || '') === String(classCode || '') &&
    String(assignment['科目代碼'] || '') === String(subjectCode || '')
  );
  const preferred = String(preferredAssignmentId || '').trim();
  const existing = (preferred ? matches.find(assignment => String(assignment['配課ID'] || '') === preferred) : null) || matches[0] || null;
  const normalizedTeachers = (teacherList || []).map(item => ({
    '教師姓名': String(item['教師姓名'] || item['姓名'] || '').trim(),
    '標籤': String(item['標籤'] || '').trim()
  })).filter(item => item['教師姓名']);
  const teacherValue = normalizedTeachers.length > 1 || normalizedTeachers.some(item => item['標籤'])
    ? JSON.stringify(normalizedTeachers)
    : (normalizedTeachers[0] ? normalizedTeachers[0]['教師姓名'] : '');
  return {
    ...(existing || {}),
    '配課ID': existing ? String(existing['配課ID'] || '') : 'MANUAL-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    '班級代碼': String(classCode || ''),
    '科目代碼': String(subjectCode || ''),
    '教師姓名': teacherValue,
    '每週節數': existing ? String(existing['每週節數'] || '') : '',
    '課程屬性': existing ? String(existing['課程屬性'] || '') : '',
    '備註': existing ? String(existing['備註'] || '') : ''
  };
}

function syncManualAssignment(classCode, subjectCode, teacherList, preferredAssignmentId) {
  const data = buildManualAssignmentData(classCode, subjectCode, teacherList, preferredAssignmentId);
  const assignmentId = String(data['配課ID'] || '');
  bgSync({
    actionName: '手動指派同步配課',
    snapshotKeys: ['assignments'],
    applyLocal: () => {
      const index = state.assignments.findIndex(assignment => String(assignment['配課ID'] || '') === assignmentId);
      if (index >= 0) state.assignments[index] = data;
      else state.assignments.push(data);
      buildIndex();
      if (typeof renderTeacherAssignmentView === 'function') renderTeacherAssignmentView();
    },
    gasTask: () => gasPost('saveMeta', { type: '配課', data })
  });
  return data;
}

async function confirmAssign() {
  const t = ui.assignTarget;
  if (!t) return;
  if (t.cell && isFrozenScheduleEntry(t.cell)) {
    toast('凍結課程不可修改，請先解除固定設定', 'warning');
    return;
  }
  const sub  = String(document.getElementById('modal-sub')?.value || t.subjectCode || t.cell?.['科目代碼'] || '').trim();
  const attr = document.getElementById('modal-attr').value;
  if (!sub) { toast('請選擇科目', 'warning'); return; }

  // 收集全部教師欄位，預設三位以外可繼續新增。
  let teacherList = [...document.querySelectorAll('#assign-teacher-list .assign-teacher-row')]
    .map(row => {
      const input = row.querySelector('[data-teacher-input]');
      if (!input || !input.value.trim()) return null;
      const tag = row.querySelector('[data-teacher-tag]');
      return {
        '教師姓名': String(parseTeacherCode(input.value) || input.value.trim()),
        '標籤': String(tag ? tag.value : '').trim()
      };
    })
    .filter(Boolean);
  if (teacherList.length === 0) { toast('請至少選擇一位教師', 'warning'); return; }

  const existingTeacherItems = t.cell ? getCellTeacherList(t.cell) : [];
  const existingOvertimeTeachers = new Set(existingTeacherItems
    .filter(isTeacherOvertimeItem)
    .map(item => String(item['教師姓名'] || '').trim()));
  teacherList = teacherList.map(item => existingOvertimeTeachers.has(String(item['教師姓名'] || '').trim())
    ? { ...item, '超鐘點': true }
    : item);
  if (existingTeacherItems.length > 0) {
    const teacherLabel = item => {
      const code = String(item['教師姓名'] || item['姓名'] || '').trim();
      const teacher = idx.teacherByCode?.[code];
      return String(teacher?.['姓名'] || teacher?.['教師姓名'] || code);
    };
    const existingLabels = existingTeacherItems.map(teacherLabel).filter(Boolean);
    const newLabels = teacherList.map(teacherLabel).filter(Boolean);
    const confirmed = await showModal(
      '確認替換課程',
      '此格已有教師排課：<b>' + esc(existingLabels.join('、')) + '</b><br>' +
      '新指定教師：<b>' + esc(newLabels.join('、')) + '</b><br><br>確定要替換嗎？',
      'confirm',
      '確認替換',
      '取消'
    );
    if (!confirmed) return;
  }

  // 綁班指派必須一次檢查所有成員，否則第二個班級的衝突會延後到雲端整批稽核才發生回溯。
  let canAssign;
  const bindPlacementPlan = buildBindPlacementPlan({
    subjectCode: sub,
    classCode: t.cls,
    day: t.day,
    period: t.per,
    weekType: t.per === 8 ? attr : '',
    teacherCode: teacherList
  });
  if (bindPlacementPlan) {
    canAssign = await checkBindMoveConflicts(bindPlacementPlan, '指派綁班課程');
  } else {
    const conflicts = detectConflicts(t.day, t.per, teacherList, sub, t.cls, t.cls, {
      excludeIds: [t.cell && t.cell['課表ID']]
    }, t.per === 8 ? attr : '');
    canAssign = await checkHandAdjustConflicts(conflicts, '指派課程');
  }
  if (!canAssign) return;

  const assignmentId = String(t.assignmentId || '');
  closeAssignModal();
  syncManualAssignment(t.cls, sub, teacherList, assignmentId);
  // 第八節以 modal 選取的 attr 為準（單週/雙週），覆蓋 t.week
  const finalAttr = t.per === 8 ? attr : attr;
  const teacherListArg = teacherList.length > 1 ? teacherList : teacherList[0]['教師姓名'];
  const existingLocked = !!(t.cell && String(t.cell['是否鎖定'] || '').toUpperCase() === 'TRUE');
  const existingOvertime = !!(t.cell && isOvertimeScheduleEntry(t.cell));
  optimisticUpdateCell({
    classCode:  t.cls,
    day:        t.day,
    period:     t.per,
    subjectCode: sub,
    teacherCode: teacherListArg,
    teacherList: teacherList,
    attr:        finalAttr,
    isLocked:    existingLocked,
    isOvertime:  existingOvertime,
    force:      Boolean(canAssign.force)
  });
}

// ============================================================
// 右鍵選單
// ============================================================
function showCtxMenu(x, y, hasContent, isLocked, options) {
  options = options || {};
  const m = document.getElementById('ctx-menu');
  m.style.display = 'block';
  m.style.left    = Math.min(x, window.innerWidth  - 180) + 'px';
  m.style.top     = Math.min(y, window.innerHeight - 220) + 'px';
  document.getElementById('ctx-assign').style.display = !hasContent ? '' : 'none';
  document.getElementById('ctx-edit').style.display   = hasContent ? '' : 'none';
  document.getElementById('ctx-lock').style.display   = (hasContent && !isLocked) ? '' : 'none';
  document.getElementById('ctx-unlock').style.display = (hasContent &&  isLocked) ? '' : 'none';
  document.getElementById('ctx-clear').style.display  = hasContent ? '' : 'none';
  const overtimeItem = document.getElementById('ctx-overtime');
  if (overtimeItem) {
    const canOvertime = hasContent && options.allowOvertime === true;
    overtimeItem.style.display = canOvertime ? '' : 'none';
    overtimeItem.textContent = options.isOvertime ? '↩️ 取消超鐘點' : '⏱️ 設為超鐘點';
  }
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('click', () => { document.getElementById('ctx-menu').style.display = 'none'; });
}

// ============================================================

// ============================================================
// 待排卡片點擊跨欄切換課表
// ============================================================
function selectTeacherFromPalette(e, teacherCode) {
  if (e) e.stopPropagation();
  if (!teacherCode) return;
  const sel = document.getElementById('sel-teacher');
  if (sel) {
    sel.value = teacherCode;
    ui.selectedTeacher = teacherCode;
    renderTeacherTT(teacherCode);
    const t = idx.teacherByCode[teacherCode];
    toast('已將右欄切換為教師：' + (t ? (t['教師姓名'] || t['姓名']) : teacherCode), 'info');
  }
}

function selectClassFromPalette(e, classCode) {
  if (e) e.stopPropagation();
  if (!classCode) return;
  const sel = document.getElementById('sel-class');
  if (sel) {
    sel.value = classCode;
    ui.selectedClass = classCode;
    renderClassTT(classCode);
    const cls = idx.classByCode[classCode];
    toast('已將左欄切換為班級：' + (cls ? (cls['班級名稱'] || classCode) : classCode), 'info');
  }
}
