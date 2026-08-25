// ============================================================
// 全域 Body 頂層浮動選單 (100% 解決遮擋、點擊即開、帶 ✖ 清除)
// ============================================================
let _globalTeacherDropdown = null;
let _activeComboboxInput = null;

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

function getGlobalTeacherDropdown() {
  if (!_globalTeacherDropdown) {
    _globalTeacherDropdown = document.createElement('div');
    _globalTeacherDropdown.id = '__globalTeacherDropdown';
    _globalTeacherDropdown.className = 'combobox-dropdown global-dropdown';
    document.body.appendChild(_globalTeacherDropdown);

    document.addEventListener('click', (e) => {
      if (_activeComboboxInput && !_globalTeacherDropdown.contains(e.target) && !_activeComboboxInput.parentNode.contains(e.target)) {
        closeGlobalTeacherDropdown();
      }
    });

    window.addEventListener('resize', () => closeGlobalTeacherDropdown());
    // 移除 scroll 關閉，改用 position: absolute 讓選單隨頁面自然滾動
  }
  return _globalTeacherDropdown;
}

function closeGlobalTeacherDropdown() {
  if (_globalTeacherDropdown) {
    _globalTeacherDropdown.style.display = 'none';
  }
  if (_activeComboboxInput && _activeComboboxInput.parentNode) {
    _activeComboboxInput.parentNode.classList.remove('is-open');
  }
  _activeComboboxInput = null;
}

function showGlobalTeacherDropdown(inputElem, filterText = '', onSelectCallback) {
  _activeComboboxInput = inputElem;
  const dropdown = getGlobalTeacherDropdown();
  const rect = inputElem.getBoundingClientRect();

  dropdown.style.position = 'absolute';
  dropdown.style.top = (rect.bottom + window.scrollY + 3) + 'px';
  dropdown.style.left = (rect.left + window.scrollX) + 'px';
  dropdown.style.width = Math.max(rect.width, 180) + 'px';
  dropdown.style.zIndex = '999999';

  filterText = String(filterText || '').trim().toLowerCase();
  let html = '';
  const teachers = state.teachers || [];

  if (teachers.length === 0) {
    html = '<div style="padding:10px 12px;font-size:12px;color:var(--ink-3);text-align:center;">⏳ 載入教師資料中…</div>';
  } else {
    const matches = teachers.filter(t => {
      if (!filterText) return true;
      const c = String(t['教師姓名'] || '').toLowerCase();
      const n = String((t['教師姓名'] || t['姓名']) || '').toLowerCase();
      const s = String(t['任教科目'] || '').toLowerCase();
      return c.includes(filterText) || n.includes(filterText) || s.includes(filterText);
    });

    if (matches.length === 0) {
      html = '<div style="padding:10px 12px;font-size:12px;color:var(--ink-3);text-align:center;">無符合教師</div>';
    } else {
      matches.forEach(t => {
        const c = t['教師姓名'];
        const n = (t['教師姓名'] || t['姓名']);
        const s = t['任教科目'] ? ` [${t['任教科目']}]` : '';
        html += `<div class="combobox-item" data-code="${esc(c)}" data-name="${esc(n)}">
          <span><strong>${esc(n || c)}</strong></span>
          <span class="combobox-item-sub">${esc(s)}</span>
        </div>`;
      });
    }
  }

  dropdown.innerHTML = html;
  dropdown.style.display = 'block';
  if (inputElem.parentNode) inputElem.parentNode.classList.add('is-open');

  dropdown.querySelectorAll('.combobox-item').forEach(item => {
    item.onmousedown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const n = item.dataset.name || item.dataset.code;
      inputElem.value = n;
      if (inputElem._updateControls) inputElem._updateControls();
      closeGlobalTeacherDropdown();
      if (onSelectCallback) onSelectCallback(n, n);
    };
  });
}

function initTeacherCombobox(inputElem, onSelectCallback) {
  if (!inputElem || inputElem._isComboboxInited) return;
  inputElem._isComboboxInited = true;

  const parent = inputElem.parentNode;
  const wrap = document.createElement('div');
  wrap.className = 'combobox-wrap';
  if (inputElem.style.width) wrap.style.width = inputElem.style.width;

  parent.insertBefore(wrap, inputElem);
  wrap.appendChild(inputElem);
  inputElem.classList.add('combobox-input');

  // 移除箭頭，維持簡潔外觀
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'combobox-clear-btn';
  clearBtn.innerHTML = '✖';
  clearBtn.title = '清除輸入';
  wrap.appendChild(clearBtn);

  function updateControls() {
    if (inputElem.value) {
      clearBtn.style.display = 'block';
    } else {
      clearBtn.style.display = 'none';
    }
  }
  inputElem._updateControls = updateControls;

  inputElem.addEventListener('focus', () => {
    updateControls();
    // 點擊/focus 時顯示全校清單（不帶入當前文字過濾）
    showGlobalTeacherDropdown(inputElem, '', onSelectCallback);
  });

  inputElem.addEventListener('click', () => {
    updateControls();
    // 點擊/focus 時顯示全校清單（不帶入當前文字過濾）
    showGlobalTeacherDropdown(inputElem, '', onSelectCallback);
  });

  inputElem.addEventListener('input', () => {
    updateControls();
    showGlobalTeacherDropdown(inputElem, inputElem.value, onSelectCallback);
    const code = parseTeacherCode(inputElem.value);
    if (onSelectCallback) onSelectCallback(code, inputElem.value);
  });

  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    inputElem.value = '';
    updateControls();
    inputElem.focus();
    showGlobalTeacherDropdown(inputElem, '', onSelectCallback);
    if (onSelectCallback) onSelectCallback('', '');
  });
}

function attachAllTeacherComboboxes() {
  const selTea = document.getElementById('sel-teacher');
  if (selTea) initTeacherCombobox(selTea, (code) => { if (code) { ui.selectedTeacher = code; renderTeacherTT(code); } });

  const thirdTea = document.getElementById('third-teacher-select');
  if (thirdTea) initTeacherCombobox(thirdTea, (code) => {
    ui.thirdSelectedTeacher = code || '';
    if (code) renderTeacherTT(code, 'third');
    else showThirdTimetableMessage('third-teacher-tt', '請選擇教師');
    saveUIState();
  });

  const clsTea = document.getElementById('cls-teacher');
  if (clsTea && !clsTea.readOnly) initTeacherCombobox(clsTea);

  const asgnTea = document.getElementById('asgn-teacher');
  if (asgnTea) initTeacherCombobox(asgnTea);

  const batchTea = document.getElementById('batch-tea-select');
  if (batchTea) initTeacherCombobox(batchTea, () => renderBatchPreview());

  const batchTeacherSelect = document.getElementById('batch-teacher-select');
  if (batchTeacherSelect) initTeacherCombobox(batchTeacherSelect, () => updateBatchTeacherSubClasses());

  const batchSubTea = document.getElementById('batch-subject-tea');
  if (batchSubTea) initTeacherCombobox(batchSubTea, () => renderBatchPreview());
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



function onTeacherSelectChange(val) {
  const code = parseTeacherCode(val);
  if (code) {
    ui.selectedTeacher = code;
    renderTeacherTT(code);
  }
}

if (typeof window !== 'undefined') window.actionButtons = actionButtons;
function startInlineTeacherEdit(code) {
  ui.inlineTeacherCode = String(code);
  if (typeof renderTeacherConfigList === 'function') renderTeacherConfigList();
  document.querySelector('#teacher-tbody .inline-edit-row input')?.focus();
}
if (typeof window !== 'undefined') window.startInlineTeacherEdit = startInlineTeacherEdit;
function cancelInlineTeacherEdit() {
  ui.inlineTeacherCode = '';
  if (typeof renderTeacherConfigList === 'function') renderTeacherConfigList();
}
if (typeof window !== 'undefined') window.cancelInlineTeacherEdit = cancelInlineTeacherEdit;
function handleInlineTeacherKey(event, code) {
  if (event.key === 'Enter') { event.preventDefault(); if (typeof saveInlineTeacher === 'function') saveInlineTeacher(code); }
  if (event.key === 'Escape') { event.preventDefault(); cancelInlineTeacherEdit(); }
}
if (typeof window !== 'undefined') window.handleInlineTeacherKey = handleInlineTeacherKey;
function replaceTeacherReferenceValue(value, oldCode, newCode) {
  if (Array.isArray(value)) {
    return value.map(item => {
      if (item && typeof item === 'object') {
        const copy = { ...item };
        if (String(copy['教師姓名'] || '').trim() === oldCode) copy['教師姓名'] = newCode;
        return copy;
      }
      return String(item || '').trim() === oldCode ? newCode : item;
    });
  }
  const text = String(value == null ? '' : value);
  if (!text) return value;
  if (text.trim().indexOf('[') === 0) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return JSON.stringify(replaceTeacherReferenceValue(parsed, oldCode, newCode));
    } catch (err) {}
  }
  return text === oldCode ? newCode : value;
}

function renameLocalTeacherReferences(oldCode, newCode) {
  (state.assignments || []).forEach(row => { row['教師姓名'] = replaceTeacherReferenceValue(row['教師姓名'], oldCode, newCode); });
  (state.schedule || []).forEach(row => { row['教師姓名'] = replaceTeacherReferenceValue(row['教師姓名'], oldCode, newCode); });
  (state.teacherBlocks || []).forEach(row => { row['教師姓名'] = replaceTeacherReferenceValue(row['教師姓名'], oldCode, newCode); });
  (state.teacherExclusives || []).forEach(row => {
    row['教師A'] = replaceTeacherReferenceValue(row['教師A'], oldCode, newCode);
    row['教師B'] = replaceTeacherReferenceValue(row['教師B'], oldCode, newCode);
  });
}

async function saveInlineTeacher(code) {
  const oldCode = String(code || '').trim();
  const teacher = idx.teacherByCode[oldCode];
  const row = document.querySelector('#teacher-tbody .inline-edit-row');
  if (!teacher || !row) return;
  const field = name => row.querySelector('[data-inline-field="'+name+'"]')?.value.trim() || '';
  const name = field('name');
  if (!name) { toast('姓名不能空白', 'warning'); return; }
  const duplicate = (state.teachers || []).some(item => item !== teacher && String(item['教師姓名'] || item['姓名'] || '').trim() === name);
  if (duplicate) { toast('教師姓名已存在，請改用其他姓名', 'warning'); return; }

  const titleElement = row.querySelector('[data-inline-field="title"]');
  const homeroomElement = row.querySelector('[data-inline-field="homeroom"]');
  const titleField = field('title');
  const homeroomField = field('homeroom');
  let title = titleField;
  let homeroom = '';
  if (titleElement) {
    const parsedHomeroom = getTeacherHomeroom({ '職稱': title });
    homeroom = parsedHomeroom === 'TRUE' ? '' : parsedHomeroom;
  } else if (homeroomElement) {
    const baseTitle = String(teacher['職稱'] || '').replace(/\d{3}\s*導師/g, '').replace(/\s+/g, ' ').trim();
    title = homeroomField ? (baseTitle ? baseTitle + ' ' : '') + homeroomField + '導師' : baseTitle;
    homeroom = homeroomField;
  } else {
    title = String(teacher['職稱'] || '').trim();
    homeroom = getTeacherHomeroom({ '職稱': title });
    if (homeroom === 'TRUE') homeroom = '';
  }

  const newObj = {
    ...teacher,
    '教師姓名': name, 'Email': field('email'),
    '職稱': title, '任教科目': field('subject'),
    '最大連堂節數': teacher['最大連堂節數'] || '2', '基本鐘點': field('hours'),
    '減授原因': row.querySelector('[data-inline-field="releaseReason"]')
      ? field('releaseReason')
      : String(teacher['減授原因'] || '').trim()
  };
  delete newObj['導師班級'];
  delete newObj['是否導師'];
  if (Object.prototype.hasOwnProperty.call(teacher, '姓名')) newObj['姓名'] = name;

  bgSync({
    actionName: '儲存教師資料',
    applyLocal: () => {
      const idxObj = state.teachers.findIndex(t => String(t['教師姓名'] || t['姓名'] || '').trim() === oldCode);
      if (idxObj >= 0) {
        renameLocalTeacherReferences(oldCode, name);
        state.teachers[idxObj] = newObj;
        if (String(ui.selectedTeacher || '') === oldCode) ui.selectedTeacher = name;
      }
      ui.inlineTeacherCode = '';
      if (typeof renderTeacherConfigList === 'function') renderTeacherConfigList();
    },
    gasTask: () => gasPost('renameTeacher', { oldKey: oldCode, data: newObj })
  });
}
if (typeof window !== 'undefined') window.saveInlineTeacher = saveInlineTeacher;

function startInlineSubjectEdit(code) {
  ui.inlineSubjectCode = String(code);
  if (typeof renderSubjectConfigList === 'function') renderSubjectConfigList();
  document.querySelector('#subject-tbody .inline-edit-row input')?.focus();
}
if (typeof window !== 'undefined') window.startInlineSubjectEdit = startInlineSubjectEdit;
function cancelInlineSubjectEdit() {
  ui.inlineSubjectCode = '';
  if (typeof renderSubjectConfigList === 'function') renderSubjectConfigList();
}
if (typeof window !== 'undefined') window.cancelInlineSubjectEdit = cancelInlineSubjectEdit;
function handleInlineSubjectKey(e, code) {
  if (e.key === 'Enter') { e.preventDefault(); if (typeof saveInlineSubject === 'function') saveInlineSubject(code); }
  if (e.key === 'Escape') { e.preventDefault(); cancelInlineSubjectEdit(); }
}
if (typeof window !== 'undefined') window.handleInlineSubjectKey = handleInlineSubjectKey;
async function saveInlineSubject(code) {
  const row = document.querySelector('#subject-tbody .inline-edit-row');
  if (!row) return;
  const f = n => { const el = row.querySelector('[data-sub="' + n + '"]'); return el ? el.value.trim() : ''; };
  const data = {
    '科目代碼': String(code),
    '每週節數': f('weekly'),
    '同時最多班數': f('max'),
    '最多連日': f('days'),
    '適用年級': f('grade'),
    '適用班級': f('classes'),
    '所屬教室代碼': f('room')
  };
  bgSync({
    actionName: '儲存科目資料',
    applyLocal: () => {
      const idxObj = state.subjects.findIndex(s => String(s['科目代碼']) === String(code));
      if (idxObj >= 0) state.subjects[idxObj] = data;
      ui.inlineSubjectCode = '';
      if (typeof renderSubjectConfigList === 'function') renderSubjectConfigList();
    },
    gasTask: () => gasPost('saveMeta', { type: '科目', data })
  });
}
if (typeof window !== 'undefined') window.saveInlineSubject = saveInlineSubject;

function renderExclusiveTable() {
  const tbody = document.getElementById('exclusive-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const rules = state.teacherExclusives || [];
  if (!rules.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:16px;">尚未設定任何互斥規則</td></tr>';
    return;
  }
  rules.forEach(r => {
    const tA = idx.teacherByCode[r['教師A']];
    const tB = idx.teacherByCode[r['教師B']];
    const nameA = tA ? (tA['教師姓名'] || tA['姓名']) : r['教師A'];
    const nameB = tB ? (tB['教師姓名'] || tB['姓名']) : r['教師B'];
    tbody.innerHTML += '<tr>' +
      '<td><strong>' + esc(nameA) + '</strong></td>' +
      '<td><strong>' + esc(nameB) + '</strong></td>' +
      '<td>' + esc(r['備註'] || '—') + '</td>' +
      '<td><div class="flex gap-1">' +
      '<button class="btn btn-ghost btn-xs" onclick="editExclusiveRule(\'' + esc(r['規則ID']) + '\')">✏️ 編輯</button>' +
      '<button class="btn btn-danger btn-xs" onclick="deleteExclusiveRule(\'' + esc(r['規則ID']) + '\')">🗑 刪除</button>' +
      '</div></td>' +
      '</tr>';
  });
}
if (typeof window !== 'undefined') window.renderExclusiveTable = renderExclusiveTable;
if (typeof window !== 'undefined') window.getTeacherBlockSlots = getTeacherBlockSlots;
if (typeof window !== 'undefined') window.compressSlots = compressSlots;
if (typeof window !== 'undefined') window.renderSubjectConfigList = renderSubjectConfigList;
if (typeof window !== 'undefined') window.renderRuleTable = renderRuleTable;
function saveBindGroup() {
  const nameInput = document.getElementById('bind-name');
  const name = nameInput ? nameInput.value.trim() : '';
  const subList = Array.from(document.querySelectorAll('#bind-subjects input:checked')).map(cb => cb.value).sort();
  const clsList = Array.from(document.querySelectorAll('#bind-classes input:checked')).map(cb => cb.value).sort();
  if (!name) { toast('請輸入群組名稱', 'warning'); return; }
  if (!subList.length) { toast('請至少選擇一個科目', 'warning'); return; }
  if (clsList.length < 2) { toast('請至少選擇 2 個班級', 'warning'); return; }
  const id = ui.editingBindId || ('BG' + Date.now());
  const data = { '群組ID': id, '群組名稱': name, '科目清單': subList.join(','), '班級清單': clsList.join(',') };
  const existing = state.blockGroups.find(g => String(g['群組ID']) === String(id));
  if (existing) Object.assign(existing, data);
  else state.blockGroups.push(data);
  if (typeof buildIndex === 'function') buildIndex();
  if (typeof clearBindForm === 'function') clearBindForm();
  if (typeof renderBindGroupTable === 'function') renderBindGroupTable();
  if (typeof gasPost === 'function') {
    gasPost('saveMeta', { type: '綁班', data }).catch(() => toast('群組雲端儲存失敗', 'warning'));
  }
  toast(existing ? '群組已更新' : '群組已新增', 'success');
}
if (typeof window !== 'undefined') window.saveBindGroup = saveBindGroup;

function toggleBindSelection(type, checked) {
  document.querySelectorAll('#bind-' + type + ' input[type=checkbox]').forEach(cb => cb.checked = checked);
}
if (typeof window !== 'undefined') window.toggleBindSelection = toggleBindSelection;

if (typeof window !== 'undefined') window.renderBlockTable = renderBlockTable;
/* function setSubjectRuleEditMode */

let _exclusiveSelA = '';
let _exclusiveSelB = '';

function renderExclusiveTeacherDropdowns() {
  ['a', 'b'].forEach(side => {
    const input = document.getElementById('exclusive-teacher-' + side);
    if (input && !input._excInited) {
      input._excInited = true;
      input.addEventListener('focus', () => { filterExclusiveTeacher(side, input.value); });
      input.addEventListener('blur', () => {
        setTimeout(() => {
          const dd = document.getElementById('exclusive-dropdown-' + side);
          if (dd) dd.style.display = 'none';
        }, 200);
      });
    }
  });
}
if (typeof window !== 'undefined') window.renderExclusiveTeacherDropdowns = renderExclusiveTeacherDropdowns;
function filterExclusiveTeacher(side, query) {
  const dd = document.getElementById('exclusive-dropdown-' + side);
  if (!dd) return;
  const q = (query || '').trim().toLowerCase();
  const matches = state.teachers.filter(t =>
    !q ||
    String(t['教師姓名'] || '').toLowerCase().includes(q) ||
    String(t['姓名'] || '').toLowerCase().includes(q)
  );
  dd.innerHTML = '';
  if (!matches.length) {
    dd.style.display = 'none';
    return;
  }
  matches.forEach(t => {
    const item = document.createElement('div');
    item.className = 'combobox-item';
    item.textContent = t['教師姓名'] + ' (' + (t['職稱'] || '專任') + ')';
    item.onmousedown = (e) => {
      e.preventDefault();
      const input = document.getElementById('exclusive-teacher-' + side);
      const hidden = document.getElementById('exclusive-val-' + side);
      if (input) input.value = t['教師姓名'];
      if (hidden) hidden.value = t['教師姓名'];
      if (side === 'a') _exclusiveSelA = t['教師姓名'];
      else _exclusiveSelB = t['教師姓名'];
      dd.style.display = 'none';
    };
    dd.appendChild(item);
  });
  dd.style.cssText = 'display:block;position:absolute;background:#fff;border:1px solid var(--border);border-radius:var(--radius-sm);box-shadow:0 4px 12px rgba(0,0,0,.12);z-index:999;min-width:200px;max-height:220px;overflow-y:auto;';
}
if (typeof window !== 'undefined') window.filterExclusiveTeacher = filterExclusiveTeacher;
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
  const classCode = String((cls && cls['班級代碼']) || '');
  if (!classCode) return '—';
  const teacher = (state.teachers || []).find(t => String(getTeacherHomeroom(t) || '') === classCode);
  return teacher ? String(teacher['教師姓名'] || teacher['姓名'] || '') : '—';
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
// ============================================================
// GAS URL（契約 §3.C 三層優先序）
// ============================================================
const DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycby8i5bnQ-oKZMO1HUQO6pJF6f_XQL8bQHO2Yj3nJ2D7NCzNZbe_bhks8hxTVZWWSxz7/exec";  // 已鎖定部署網址
const FRONTEND_VERSION = '20260824_v1208_schedule_exceptions';

function resolveGasUrl() {
  if (DEFAULT_GAS_URL && DEFAULT_GAS_URL.trim()) return DEFAULT_GAS_URL.trim();
  const p = new URLSearchParams(location.search).get('config');
  if (p) { try { const d = atob(p); localStorage.setItem('gas_url', d); return d; } catch(e){} }
  return localStorage.getItem('gas_url') || '';
}
let GAS_URL = resolveGasUrl();

// 硬編碼 GAS 網址，不顯示設定按鈕
document.getElementById('__settingsBtn').style.display = 'none';

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
           assignments: [], schedule:[], scheduleRevision:'', teacherBlocks:[], subjectRules:[], subjectRelations:[], blockGroups:[], rooms:[], scheduleColors:[], teacherExclusives:[], scheduleExceptions:[], apiVersion:'', schemaVersion:'',
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
  subjectRelationsBySubject:{}, // subjectCode -> relation rules[]
  bindGroupByCode:{},    // groupId -> group
  bindBySubject:{},      // subjectCode -> group[]
  bindByClass:{},        // classCode -> group[]
  roomByCode:{},         // roomCode -> room
  schedByRoomSlot:{},    // `roomCode|day|period` -> cell[]
  assignmentsByClass:{}, // classCode -> assignment[]
  scheduleCountByClass:{}, // classCode -> scheduled count
  exclusivePairSet: new Set(), // `tc1|tc2` (sorted) -> true
};
let ui = {
  activeTab:'timetable', selectedClass:'', selectedTeacher:'', selectedRoom:'',
  thirdOpen:false, thirdView:'class', thirdSelectedClass:'', thirdSelectedTeacher:'', thirdSelectedRoom:'',
  drag:null, ctxTarget:null, blockSlots: new Set(), ruleSlots: new Set(),
  assignTarget: null
};

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
  const canDropPatrol = (dragInfo, targetCell) => {
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
  container.querySelectorAll('.tt-cell').forEach(cell => {
    const day = parseInt(cell.dataset.day, 10);
    const period = parseInt(cell.dataset.per, 10);
    const rows = patrolBySlot.get(day + '|' + period) || [];
    if (rows.length) {
      const row = rows[0];
      const teacherCode = String(row['教師姓名'] || '').trim();
      cell.dataset.patrolDraggable = 'true';
      cell.draggable = true;
      cell.title = '點擊切換教師課表；拖曳修改，右鍵刪除';
      cell.addEventListener('click', event => {
        if (ui.drag) return;
        focusPrimaryTeacherForPatrol(teacherCode);
      });
      cell.addEventListener('contextmenu', event => {
        event.preventDefault();
        deletePatrolCell(row['課表ID']);
      });
      cell.addEventListener('dragstart', event => {
        ui.drag = { isPatrol: true, isPalette: false, cell: row, day, per: period, teacherCode };
        resetDragConflictCache();
        cell.style.opacity = '0.4';
        event.dataTransfer.effectAllowed = 'move';
      });
      cell.addEventListener('dragend', () => {
        ui.drag = null;
        cell.style.opacity = '1';
        clearTimetableDragHighlights();
      });
    } else {
      cell.title = '點擊選擇巡堂教師';
      cell.addEventListener('click', () => {
        if (ui.drag) return;
        choosePatrolTeacherAtSlot(day, period);
      });
    }
    cell.addEventListener('dragover', event => {
      if (!ui.drag || !ui.drag.isPatrol) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      cell.classList.remove('drag-ok', 'drag-err', 'drag-warn');
      cell.classList.add(canDropPatrol(ui.drag, cell) ? 'drag-ok' : 'drag-err');
    });
    cell.addEventListener('dragleave', () => {
      cell.classList.remove('drag-ok', 'drag-err', 'drag-warn');
    });
    cell.addEventListener('drop', event => {
      if (!ui.drag || !ui.drag.isPatrol) return;
      event.preventDefault();
      const dragInfo = ui.drag;
      ui.drag = null;
      cell.classList.remove('drag-ok', 'drag-err', 'drag-warn');
      if (canDropPatrol(dragInfo, cell)) {
        movePatrolCell(dragInfo.cell && dragInfo.cell['課表ID'], dragInfo.teacherCode, day, period);
      }
    });
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
// GAS API
// ============================================================
const SCHEDULE_WRITE_ACTIONS = new Set([
  'updateCell', 'clearCell', 'swapCells', 'lockCell', 'setOvertime', 'batchSetOvertime',
  'savePatrolSchedule', 'batchUpdateSchedule'
]);
const MUTATING_GAS_ACTIONS = new Set([
  ...SCHEDULE_WRITE_ACTIONS,
  'saveMeta', 'renameTeacher', 'deleteMeta', 'saveTeacherBlock',
  'saveSubjectRule', 'saveSubjectRelation', 'saveTeacherExclusive',
  'saveScheduleException', 'initDatabase'
]);
let _pendingScheduleWrites = 0;
let _gasRequestTail = Promise.resolve();
let _localMutationVersion = 0;
let _backgroundReconcilePending = false;

function enqueueGasRequest(task) {
  const request = _gasRequestTail.then(task, task);
  _gasRequestTail = request.catch(() => null);
  return request;
}

function queuedGasPayload(action, payload) {
  if ((action === 'batchUpdateSchedule' || action === 'batchSetOvertime') && payload && typeof payload === 'object' &&
      Object.prototype.hasOwnProperty.call(payload, 'baseRevision')) {
    // 佇列等待期間，前一筆寫入可能已更新版本；送出前改用最新版本避免誤判過期。
    return { ...payload, baseRevision: state.scheduleRevision };
  }
  return payload;
}

function createGasRequestId() {
  const random = Math.random().toString(36).slice(2, 10);
  return 'w_' + Date.now().toString(36) + '_' + random;
}

function addGasRequestId(action, payload) {
  if (!MUTATING_GAS_ACTIONS.has(action)) return payload;
  const base = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  if (Object.prototype.hasOwnProperty.call(base, '__requestId')) return base;
  return { ...base, __requestId: createGasRequestId() };
}

function isRetryableGasResponse(response) {
  if (!response || response.ok !== false) return false;
  if (response.retryable === true) return true;
  return response.blocked === true && /另一個課表寫入作業/.test(String(response.error || ''));
}

function waitGasRetry(delayMs) {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

function requestBackgroundReconcile() {
  if (!GAS_URL || _backgroundReconcilePending) return;
  _backgroundReconcilePending = true;
  _gasRequestTail
    .then(() => loadAll({ background: true }))
    .catch(error => console.error('[OptimisticUI] Background reconcile error:', error))
    .finally(() => { _backgroundReconcilePending = false; });
}

function waitForPendingScheduleWrites() {
  return new Promise(resolve => {
    const check = () => _pendingScheduleWrites === 0 ? resolve() : setTimeout(check, 40);
    check();
  });
}

async function gasPost(action, payload, options = {}) {
  const shouldQueue = action === 'getAll' || MUTATING_GAS_ACTIONS.has(action);
  if (MUTATING_GAS_ACTIONS.has(action)) _localMutationVersion++;
  const requestPayload = addGasRequestId(action, payload);
  const request = () => gasPostNow(action, queuedGasPayload(action, requestPayload), options);
  return shouldQueue ? enqueueGasRequest(request) : request();
}

async function gasPostNow(action, payload, options = {}) {
  const silent = options && options.silent === true;
  const tracksScheduleWrite = SCHEDULE_WRITE_ACTIONS.has(action);
  const maxAttempts = options && options.retry === false ? 1 : (MUTATING_GAS_ACTIONS.has(action) ? 3 : 2);
  const timeoutMs = Number(options && options.timeoutMs) > 0 ? Number(options.timeoutMs) : 65000;
  if (tracksScheduleWrite) _pendingScheduleWrites++;
  try {
    if (!GAS_URL) {
      if (!silent) showModal('未連線','請先設定 GAS 網址');
      return null;
    }
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const fd = new FormData();
        fd.append('action', action);
        fd.append('data', JSON.stringify(payload || {}));
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timeoutToken = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
        let res;
        try {
          res = await fetch(GAS_URL, {
            method: 'POST',
            body: fd,
            signal: controller ? controller.signal : undefined
          });
        } finally {
          if (timeoutToken) clearTimeout(timeoutToken);
        }
        const bodyText = await res.text();
        if (!res.ok) throw new Error('HTTP ' + res.status + '：' + bodyText.slice(0, 160));
        let result;
        try {
          result = JSON.parse(bodyText);
        } catch (parseError) {
          throw new Error('GAS 回應不是有效 JSON：' + bodyText.slice(0, 160));
        }
        if (isRetryableGasResponse(result) && attempt < maxAttempts) {
          await waitGasRetry(700 * attempt);
          continue;
        }
        if (tracksScheduleWrite && result && result.ok !== false) applyScheduleRevisionResponse(result);
        return result;
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts) throw error;
        await waitGasRetry(700 * attempt);
      }
    }
    throw lastError || new Error('GAS 請求失敗');
  } catch(e) {
    if (!silent) showModal('連線失敗', '動作「' + action + '」未能完成。\n\n原因：' + String(e.message || e));
    return null;
  } finally {
    if (tracksScheduleWrite) setTimeout(() => { _pendingScheduleWrites = Math.max(0, _pendingScheduleWrites - 1); }, 0);
  }
}

function applyScheduleRevisionResponse(response) {
  const revision = response && response.data && response.data.scheduleRevision;
  if (revision !== undefined && revision !== null) state.scheduleRevision = String(revision);
}

/**
 * 樂觀 UI 與背景非同步同步機制 (Optimistic UI & Background Sync)
 * 任何設定儲存/修改/刪除皆先在本地樂觀更新 UI（零卡頓），背景非同步發送 GAS 請求。
 * 背景成功跳右下角 Toast；背景失敗跳 Modal Alert 警示視窗說明原因（手動按 OK 關閉）並回復本地狀態。
 */
function bgSync({ actionName, applyLocal, gasTask, rollbackLocal }) {
  // 快照 current state
  const snapshot = {
    classes: JSON.parse(JSON.stringify(state.classes || [])),
    teachers: JSON.parse(JSON.stringify(state.teachers || [])),
    subjects: JSON.parse(JSON.stringify(state.subjects || [])),
    assignments: JSON.parse(JSON.stringify(state.assignments || [])),
    schedule: JSON.parse(JSON.stringify(state.schedule || [])),
    scheduleRevision: state.scheduleRevision,
    teacherBlocks: JSON.parse(JSON.stringify(state.teacherBlocks || [])),
    subjectRules: JSON.parse(JSON.stringify(state.subjectRules || [])),
    subjectRelations: JSON.parse(JSON.stringify(state.subjectRelations || [])),
    teacherExclusives: JSON.parse(JSON.stringify(state.teacherExclusives || [])),
    blockGroups: JSON.parse(JSON.stringify(state.blockGroups || [])),
    rooms: JSON.parse(JSON.stringify(state.rooms || [])),
    scheduleColors: JSON.parse(JSON.stringify(state.scheduleColors || [])),
    scheduleExceptions: JSON.parse(JSON.stringify(state.scheduleExceptions || []))
  };

  // 1. 立即樂觀更新本地 UI（不阻塞 UI、不彈全頁 Loading）
  try {
    if (applyLocal) applyLocal();
    buildIndex();
    if (typeof renderTabIfNeeded === 'function') renderTabIfNeeded(ui.activeTab);
    else if (typeof renderConfigTab === 'function') renderConfigTab();
  } catch (err) {
    console.error(`[OptimisticUI] Local update error (${actionName}):`, err);
  }

  // 2. 背景非同步同步至雲端；記住此請求的本地世代，避免舊請求失敗時回復新狀態。
  const mutationVersionBeforeRequest = _localMutationVersion;
  let syncRequest;
  try {
    syncRequest = gasTask();
  } catch (err) {
    syncRequest = Promise.reject(err);
  }
  const requestMutationVersion = _localMutationVersion > mutationVersionBeforeRequest
    ? _localMutationVersion
    : mutationVersionBeforeRequest;
  Promise.resolve(syncRequest).then(res => {
    if (res && res.ok !== false) {
      applyScheduleRevisionResponse(res);
      toast(`✅ ${actionName}已成功同步至雲端`, 'success');
    } else {
      const errorMsg = (res && res.error) ? res.error : '伺服器未回應或傳回失敗結果';
      if (requestMutationVersion !== _localMutationVersion) {
        toast(`⚠️ ${actionName}的舊同步失敗，已保留較新的本地異動`, 'warning');
        requestBackgroundReconcile();
        return;
      }
      handleSyncFailure(actionName, errorMsg, snapshot, rollbackLocal);
    }
  }).catch(err => {
    console.error(`[OptimisticUI] Sync network error (${actionName}):`, err);
    if (requestMutationVersion !== _localMutationVersion) {
      toast(`⚠️ ${actionName}的舊同步發生網路異常，已保留較新的本地異動`, 'warning');
      requestBackgroundReconcile();
      return;
    }
    handleSyncFailure(actionName, err.message || String(err), snapshot, rollbackLocal);
  });
}

function handleSyncFailure(actionName, errorMsg, snapshot, rollbackLocal) {
  if (rollbackLocal) {
    rollbackLocal(snapshot);
  } else {
    state.classes = snapshot.classes;
    state.teachers = snapshot.teachers;
    state.subjects = snapshot.subjects;
    state.assignments = snapshot.assignments;
    state.schedule = snapshot.schedule;
    state.scheduleRevision = snapshot.scheduleRevision;
    state.teacherBlocks = snapshot.teacherBlocks;
    state.subjectRules = snapshot.subjectRules;
    state.subjectRelations = snapshot.subjectRelations;
    state.teacherExclusives = snapshot.teacherExclusives;
    state.blockGroups = snapshot.blockGroups;
    state.rooms = snapshot.rooms;
    state.scheduleColors = snapshot.scheduleColors;
    state.scheduleExceptions = snapshot.scheduleExceptions;
  }
  buildIndex();
  if (typeof renderTabIfNeeded === 'function') renderTabIfNeeded(ui.activeTab);

  // 彈出警示視窗說明問題原因（要手動按 OK 關閉）
  showModal(
    '⚠️ 雲端同步失敗',
    `【${actionName}】資料無法同步至雲端試算表。

原因：${errorMsg}

系統已自動為您回復至異動前狀態。請檢查連線或確定 GAS 權限後重試。`,
    'alert'
  );
}


async function gasGet(action) {
  if (!GAS_URL) return null;
  try {
    const res = await fetch(GAS_URL + '?action=' + encodeURIComponent(action));
    return await res.json();
  } catch(e) { return null; }
}

// ============================================================
// 資料載入 & 索引建立
// ============================================================
async function loadAll(options = {}) {
  const background = options && options.background === true;
  const requestMutationVersion = _localMutationVersion;
  if (!background) showLoading(true);
  setStatus('loading');
  let res;

  if (GAS_URL) {
    res = await gasPost('getAll', {}, { silent: background, retry: false, timeoutMs: 30000 });
  } else {
    res = { ok: true, data: getDemoData() };
  }

  if (!res || !res.ok) {
    setStatus('error');
    toast('載入失敗：' + (res ? res.error : '無回應'), 'error');
    _isAppInitialized = true;
    if (!background) showLoading(false);
    return;
  }
  if (!res.data) {
    toast('伺服器未回傳資料，請檢查部署狀態', 'error');
    if (!background) showLoading(false);
    return;
  }
  if (requestMutationVersion !== _localMutationVersion) {
    // 這次讀取早於本地異動，不可用舊快照覆蓋目前畫面。
    setStatus('connected');
    if (!background) showLoading(false);
    return;
  }
  applyData(res.data);
  const apiVersion = String(res.data.gasVersion || '').trim();
  if (GAS_URL && !apiVersion) toast('GAS 尚未提供版本資訊，請重新部署後端 Code.gs', 'warning');
  else if (GAS_URL && apiVersion !== FRONTEND_VERSION) toast('前後端版本不同：前端 ' + FRONTEND_VERSION + '／GAS ' + apiVersion + '，請重新部署或清除快取', 'warning');
  setStatus('connected');
  _isAppInitialized = true;
  if (!background) showLoading(false);
  renderAll();
}

function applyData(d) {
  state.classes       = d.classes       || [];
  state.teachers      = (d.teachers || []).map(teacher => {
    const clean = { ...teacher };
    delete clean['導師班級'];
    delete clean['是否導師'];
    return clean;
  });
  state.subjects      = d.subjects      || [];
  state.assignments   = d.assignments   || [];
  state.schedule      = (d.schedule      || []).map(normalizePatrolScheduleEntry);
  state.scheduleRevision = String(d.scheduleRevision || '');
  state.teacherBlocks = d.teacherBlocks || [];
  state.subjectRules  = d.subjectRules  || [];
  state.subjectRelations = d.subjectRelations || [];
  state.blockGroups   = d.blockGroups   || [];
  state.rooms         = d.rooms         || [];
  state.scheduleColors= d.scheduleColors|| [];
  state.teacherExclusives = d.teacherExclusives || [];
  state.scheduleExceptions = d.scheduleExceptions || [];
  state.apiVersion = String(d.gasVersion || '');
  state.schemaVersion = String(d.schemaVersion || '');
  state.settings      = d.settings      || {};
  // 向下相容：舊資料使用連堂節數 -> 改為最多連日
  state.subjects.forEach(s => {
    if (s['最多連日'] === undefined || s['最多連日'] === '' || s['最多連日'] === null) {
      const old = s['連堂節數'];
      if (old !== undefined && old !== '' && old !== null) {
        const parsedOld = parseInt(old, 10);
        s['最多連日'] = Number.isFinite(parsedOld) && parsedOld > 0 ? String(parsedOld) : '';
      } else {
        s['最多連日'] = '';
      }
    }
  });
  buildIndex();
}

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

function buildIndex() {
  idx.classByCode = {}; idx.teacherByCode = {}; idx.subjectByCode = {};
  idx.schedByClassSlot = {}; idx.schedByTeacherSlot = {};
  idx.schedBySubjectSlot = {}; idx.schedBySubjectSlotP8 = {}; idx.blockSet = new Set(); idx.rulesBySubjectSlot = {};
  idx.subjectRelationsBySubject = {};
  idx.subjectColor = {};
  idx.schedByClassSlotP8 = {}; // cls|day|8 → { '單週': cell, '雙週': cell }
  idx.scheduleSlot = Object.create(null); // `cls|day|per|attr` → schedule 記錄（O(1) 查表）
  idx.roomByCode = {};
  idx.schedByRoomSlot = {};
  idx.assignmentsByClass = {};
  idx.teacherByClassSubject = Object.create(null);
  idx.exclusivePairSet = new Set();
  idx.scheduleCountByClass = {};
  idx.bindGroupByCode = {};
  idx.bindBySubject = {};
  idx.bindByClass = {};

  state.schedule = state.schedule.map(normalizePatrolScheduleEntry);

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
  }
  for (let i = 0; i < state.subjects.length; i++) {
    const s = state.subjects[i];
    const code = s['科目代碼'];
    idx.subjectByCode[code] = s;
    idx.subjectColor[code] = i;
  }
  for (let i = 0; i < state.rooms.length; i++) {
    const r = state.rooms[i];
    idx.roomByCode[String(r['教室代碼'] || '')] = r;
  }

  // 課表索引（班級／教師／科目／教室／已排節數一次完成）
  for (let i = 0; i < state.schedule.length; i++) {
    const cell = state.schedule[i];
    const isPatrol = isPatrolScheduleEntry(cell);
    const cls = String(cell['班級代碼'] || '');
    const tc  = String(cell['教師姓名'] || '');
    const sub = String(cell['科目代碼'] || '');
    const day = parseInt(cell['星期'], 10);
    const per = parseInt(cell['節次'], 10);
    const attr = cell['課堂屬性'] || '一般';
    const ck  = cls + '|' + day + '|' + per;
    const sk  = sub + '|' + day + '|' + per;

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
    }

    const teachList = getCellTeacherList(cell);
    if (teachList.length > 0) {
      for (let ti = 0; ti < teachList.length; ti++) {
        const tCode = String(teachList[ti]['教師姓名'] || '').trim();
        if (!tCode) continue;
        const tKey = tCode + '|' + day + '|' + per;
        if (!idx.schedByTeacherSlot[tKey]) idx.schedByTeacherSlot[tKey] = [];
        idx.schedByTeacherSlot[tKey].push(cell);
      }
    } else if (tc) {
      const tk = tc + '|' + day + '|' + per;
      if (!idx.schedByTeacherSlot[tk]) idx.schedByTeacherSlot[tk] = [];
      idx.schedByTeacherSlot[tk].push(cell);
    }
    if (!isPatrol) {
      if (sub) {
        idx.schedBySubjectSlot[sk] = (idx.schedBySubjectSlot[sk] || 0) + 1;
        if (per === 8 && (attr === '單週' || attr === '雙週')) {
          const p8Key = sub + '|' + day + '|8|' + attr;
          idx.schedBySubjectSlotP8[p8Key] = (idx.schedBySubjectSlotP8[p8Key] || 0) + 1;
        }
      }
      if (sub !== '不排課' && attr !== '不排課') {
        idx.scheduleCountByClass[cls] = (idx.scheduleCountByClass[cls] || 0) + 1;
      }
    }

    const subObj = idx.subjectByCode[sub];
    const roomCode = subObj ? String(subObj['所屬教室代碼'] || '').trim() : '';
    if (!isPatrol && roomCode) {
      const rk = roomCode + '|' + day + '|' + per;
      if (!idx.schedByRoomSlot[rk]) idx.schedByRoomSlot[rk] = [];
      idx.schedByRoomSlot[rk].push(cell);
    }
  }

  // 教師不排課（新版「時段」陣列優先；舊欄位星期／節次相容）
  for (let i = 0; i < state.teacherBlocks.length; i++) {
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
  for (let i = 0; i < state.subjectRules.length; i++) {
    const r = state.subjectRules[i];
    const expanded = getRuleDaysPeriods(r);
    const subjectCodes = getRuleSubjectCodes(r);
    subjectCodes.forEach(subjectCode => {
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

  // 綁班群組索引
  for (let i = 0; i < state.blockGroups.length; i++) {
    const g = state.blockGroups[i];
    const gid = g['群組ID'];
    idx.bindGroupByCode[gid] = g;
    const subList = typeof g['科目清單'] === 'string' ? g['科目清單'].split(',').map(s => s.trim()).filter(Boolean) : (typeof g['科目代碼'] === 'string' ? g['科目代碼'].split(',').map(s => s.trim()).filter(Boolean) : []);
    const clsList = typeof g['班級清單'] === 'string' ? g['班級清單'].split(',').map(c => c.trim()).filter(Boolean) : (Array.isArray(g['班級清單']) ? g['班級清單'] : (typeof g['班級清單'] === 'number' ? String(g['班級清單']).match(/.{3}/g)||[] : []));
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

  // 配課索引
  for (let i = 0; i < state.assignments.length; i++) {
    const a = state.assignments[i];
    const cls = String(a['班級代碼'] || '');
    if (!idx.assignmentsByClass[cls]) idx.assignmentsByClass[cls] = [];
    idx.assignmentsByClass[cls].push(a);
    const sub = String(a['科目代碼'] || '');
    if (cls && sub) idx.teacherByClassSubject[cls + '|' + sub] = a;
  }

  // 教師互斥索引
  for (let i = 0; i < state.teacherExclusives.length; i++) {
    const r = state.teacherExclusives[i];
    const a = String(r['教師A'] || '').trim();
    const b = String(r['教師B'] || '').trim();
    if (a && b) {
      const key = a < b ? a + '|' + b : b + '|' + a;
      idx.exclusivePairSet.add(key);
    }
  }
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
  (schedule || []).forEach(entry => {
    if (isPatrolScheduleEntry(entry)) return;
    if (String(entry['班級代碼'] || '').trim() !== targetClass) return;
    if (parseInt(entry['星期'], 10) !== dayN) return;
    if (excludeInfo &&
        parseInt(entry['星期'], 10) === parseInt(excludeInfo.srcDay, 10) &&
        parseInt(entry['節次'], 10) === parseInt(excludeInfo.srcPer, 10)) return;
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


/**
 * 手動排課 / 拖曳時的衝突檢查包裝器
 * 主教師真衝堂與科目禁排直接擋死，其餘手動衝突先顯示警告，確認後可強制排入。
 */
async function checkHandAdjustConflicts(conflicts, actionPrompt = '調動') {
  if (!conflicts || conflicts.length === 0) return { force: false };

  // 只有主教師真衝堂與科目禁排不可強制，其餘硬限制改為人工確認警告。
  const fatalConflicts = conflicts.filter(c => c.hard && (
    c.kind === 'teacher' || c.kind === 'bindTeacherConflict' || c.kind === 'banned'
  ));
  if (fatalConflicts.length > 0) {
    toast(`⛔ 偵測到嚴重排課衝突，無法進行${actionPrompt}：<br>` + fatalConflicts.map(c => c.msg).join('；<br>'), 'error');
    return false;
  }

  const warnConflicts = conflicts.filter(c => !fatalConflicts.includes(c));
  if (warnConflicts.length > 0) {
    const msg = warnConflicts.map(c => c.msg).join('<br>') + '<br><br><b>請問是否仍要強制排入／完成調動？</b>';
    const confirmed = await showModal('⚠️ 衝突 / 連堂 / 互斥警告確認', msg, 'confirm', '🚀 強制排入', '❌ 取消調動');
    return confirmed ? { force: true } : false;
  }

  return { force: false };
}
function detectConflicts(day, period, teacherCode, subjectCode, classCode, excludeClassCode, excludeInfo, targetAttr) {
  const conflicts = [];
  const dayN = parseInt(day,10), perN = parseInt(period,10);
  const targetSlot = { '節次': perN, '課堂屬性': perN === 8 ? String(targetAttr || '').trim() : '' };

  // 第八節一般課程會佔用單週與雙週，不能和任一週次課程重疊；單週與雙週可各排一門。
  if (perN === 8 && classCode) {
    const excludedIds = new Set([
      ...(Array.isArray(excludeInfo?.excludeIds) ? excludeInfo.excludeIds : []),
      ...(excludeInfo?.excludeId ? [excludeInfo.excludeId] : [])
    ].map(id => String(id || '').trim()).filter(Boolean));
    const classCells = (state.schedule || []).filter(entry =>
      !isPatrolScheduleEntry(entry) &&
      String(entry['班級代碼'] || '').trim() === String(classCode || '').trim() &&
      parseInt(entry['星期'], 10) === dayN &&
      parseInt(entry['節次'], 10) === perN &&
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
    const allRulesForSub = state.subjectRules.filter(r => {
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
    const sameDaySubjectEntries = (state.schedule || []).filter(entry => {
      if (!entry || isPatrolScheduleEntry(entry)) return false;
      if (String(entry['班級代碼'] || '').trim() !== String(classCode || '').trim()) return false;
      if (String(entry['科目代碼'] || '').trim() !== String(subjectCode || '').trim()) return false;
      if (parseInt(entry['星期'], 10) !== dayN) return false;
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
// 渲染全部
// ============================================================
function renderAll() {
  renderClassSelect();
  renderTeacherSelect();
  renderRoomSelect();
  renderThirdClassSelect();
  renderThirdTeacherSelect();
  renderThirdRoomSelect();
  renderConfigTab();
  renderBindGroupTab();
  renderConstraintsTab();
  renderStatsTab();
  renderScheduleExceptionTab();
  if (ui.selectedClass)   renderClassTT(ui.selectedClass);
  if (ui.selectedTeacher) renderTeacherTT(ui.selectedTeacher);
  if (ui.selectedRoom)    renderRoomTT(ui.selectedRoom);
  renderThirdTimetable();
  
  // 儲存 UI 狀態（跨重整/刷新記錄位置）
  saveUIState();
}

// ============================================================
// 選單下拉
// ============================================================
function renderClassSelect() {
  const sel = document.getElementById('sel-class');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— 選擇班級 —</option>';
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

     const classTotalScheduled = (state.schedule || []).filter(entry =>
       String(entry['班級代碼'] || '') === classCode && !isHelperSubjectCode(entry['科目代碼'])
     ).length;
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
     const scheduled = (state.schedule || []).filter(entry =>
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
function renderRoomTT(roomCode, target = 'primary') {
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
  if (target === 'primary' && ui.thirdOpen) renderThirdTimetable();
}

// ============================================================
// 課表渲染
// ============================================================
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

function renderClassTT(classCode, target = 'primary') {
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
  if (target === 'primary' && ui.thirdOpen) renderThirdTimetable();
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

  if (box) box.innerHTML = pendingHtml + (doneCount > 0 ? `<details class="palette-collapse"><summary>已排完（${doneCount} 科）</summary>${doneHtml}</details>` : '');

  // 繫結卡片拖曳事件
  const cards = box.querySelectorAll('.palette-card[draggable="true"]');
  cards.forEach(card => {
    card.addEventListener('dragstart', e => {
      const assignment = myAssignments[parseInt(card.dataset.itemIndex, 10)];
      ui.drag = {
        isPalette: true,
        cls: card.dataset.cls,
        subjectCode: card.dataset.sub,
        teacherCode: teacherCode,
         teacherList: assignment ? getCellTeacherList(assignment) : [],
         attr: card.dataset.attr,
         isAlternateWeek: card.dataset.alternateWeek === 'true'
      };
      resetDragConflictCache();
      card.style.opacity = '0.4';
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      ui.drag = null;
      card.style.opacity = '1';
      clearTimetableDragHighlights();
    });
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
  const cells = document.querySelectorAll('#' + pane.teacherTT + ' .tt-cell');
  cells.forEach(td => {
    const day = parseInt(td.dataset.day, 10);
    const per = parseInt(td.dataset.per, 10);
    const tk = teacherCode + '|' + day + '|' + per;
    const isBlocked = idx.blockSet.has(tk);
    const schedCells = idx.schedByTeacherSlot[tk] || [];
    const patrolCell = schedCells.length === 1 && isPatrolScheduleEntry(schedCells[0]);

    // 空堂或已是不排課 -> 點擊直觀切換不排課！
    if (schedCells.length === 0) {
      const patrolEligible = (target === 'primary' || target === 'third') && isPatrolEligibleTeacher(idx.teacherByCode[teacherCode]);
      td.title = isBlocked ? '⛔ 點擊取消此節不排課' : (patrolEligible ? '左鍵設為不排課，右鍵新增巡堂' : '➕ 點擊設為不排課時段');
      td.addEventListener('click', (e) => {
        if (ui.drag) return;
        toggleTeacherBlockSlot(teacherCode, day, per, target);
      });
      if (patrolEligible) {
        td.addEventListener('contextmenu', e => {
          e.preventDefault();
          addPatrolAtTeacherSlot(teacherCode, day, per);
        });
      }
    } else {
      // 有課程 → 左鍵跨班循環切換至該班課表、右鍵編輯
      const cell = schedCells[0];
      if (patrolCell) {
        td.title = '點擊開啟巡堂總覽；可拖曳移動，右鍵刪除';
        td.addEventListener('click', e => {
          if (ui.drag) return;
          openThirdPatrolOverview();
        });
        td.addEventListener('contextmenu', e => {
          e.preventDefault();
          deletePatrolCell(cell['課表ID']);
        });
        td.draggable = true;
        td.addEventListener('dragstart', e => {
          ui.drag = { isPatrol: true, isPalette: false, cell, day, per, teacherCode };
          resetDragConflictCache();
          td.style.opacity = '0.4';
          e.dataTransfer.effectAllowed = 'move';
        });
        td.addEventListener('dragend', () => {
          ui.drag = null;
          td.style.opacity = '1';
          clearTimetableDragHighlights();
        });
      } else {
        const baseCls = String(cell['班級代碼'] || '');
        const allCls = [...new Set(schedCells.map(c => String(c['班級代碼']||'').trim()).filter(Boolean))];

        td.addEventListener('click', e => {
          if (ui.drag) return;
          const clsTarget = cycleNextClass(allCls, ui.selectedClass);
          if (clsTarget && clsTarget !== ui.selectedClass) {
            ui.selectedClass = clsTarget;
            document.getElementById('sel-class').value = clsTarget;
            renderClassTT(clsTarget);
            renderSubjectPalette(clsTarget);
          }
        });

        td.addEventListener('contextmenu', e => {
          e.preventDefault();
          const ck = baseCls + '|' + day + '|' + per;
          const existing = idx.schedByClassSlot[ck];
          const clsForCtx = existing ? String(existing['班級代碼']) : baseCls;
          const ctxCell = existing || cell;
          ui.ctxTarget = { cls: clsForCtx, day, per, cell: ctxCell, teacherCode, week: per === 8 ? String(ctxCell['課堂屬性'] || '') : '', teacherView: true };
          showCtxMenu(e.pageX, e.pageY, true, String(ctxCell['是否鎖定']).toUpperCase() === 'TRUE', { allowOvertime: per !== 8 && !isManualOnlyPeriod(per), isOvertime: isOvertimeScheduleEntry(ctxCell, teacherCode) });
        });

        // 教師課表卡片拖曳起點
        const clsCode = td.dataset.cls || String(cell['班級代碼'] || '');
        const isDragProtected = isDragProtectedScheduleEntry(cell);
        if (!isDragProtected) {
          td.draggable = true;
          td.addEventListener('dragstart', e => {
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
            e.dataTransfer.effectAllowed = 'move';
          });
          td.addEventListener('dragend', () => {
            ui.drag = null;
            td.style.opacity = '1';
            clearTimetableDragHighlights();
          });
        }
      }
    }

    td.addEventListener('dragover', e => {
      if (!ui.drag) return;
      e.preventDefault();
      if (ui.drag.isPatrol) {
        td.classList.remove('drag-ok', 'drag-err', 'drag-warn');
        const targetCells = idx.schedByTeacherSlot[teacherCode + '|' + day + '|' + per] || [];
        const allowed = ui.drag.teacherCode === teacherCode &&
          !(ui.drag.day === day && ui.drag.per === per) &&
          !isBlocked && targetCells.length === 0 && !hasPatrolAtSlot(day, per, ui.drag.cell && ui.drag.cell['課表ID']);
        td.classList.add(allowed ? 'drag-ok' : 'drag-err');
        return;
      }
      const tcCode  = ui.drag.teacherList?.length ? ui.drag.teacherList : teacherCode;
      const subCode = ui.drag.isPalette ? ui.drag.subjectCode : (ui.drag.cell ? ui.drag.cell['科目代碼'] : '');
      const targetCls = ui.drag.cls;

      if (!targetCls || !subCode) return;

      const excludeInfo = ui.drag && !ui.drag.isPalette ? {
        srcDay: ui.drag.day,
        srcPer: ui.drag.per,
        excludeIds: [ui.drag.cell && ui.drag.cell['課表ID']]
      } : null;
      const targetWeek = per === 8
        ? String(schedCells.find(cell => ['單週', '雙週'].includes(String(cell['課堂屬性'] || '').trim()))?.['課堂屬性'] || ui.drag.p8Week || '').trim()
        : '';
      const conflicts = cachedConflictCheck(day, per, tcCode, subCode, targetCls, ui.drag.isPalette ? '' : targetCls, excludeInfo, targetWeek);
      td.classList.remove('drag-ok','drag-err','drag-warn');
      if (conflicts.length > 0) td.classList.add('drag-err');
      else                     td.classList.add('drag-ok');
    });

    td.addEventListener('dragleave', () => {
      td.classList.remove('drag-ok','drag-err','drag-warn');
    });

    td.addEventListener('drop', async e => {
      e.preventDefault();
      if (!ui.drag) return;
      td.classList.remove('drag-ok','drag-err','drag-warn');

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

      const subCode = dragInfo.isPalette ? dragInfo.subjectCode : (dragInfo.cell ? dragInfo.cell['科目代碼'] : '');
      const sourceWeek = !dragInfo.isPalette && per === 8
        ? String(dragInfo.p8Week || dragInfo.cell?.['課堂屬性'] || '').trim()
        : '';
      const targetTeacherCells = idx.schedByTeacherSlot[teacherCode + '|' + day + '|' + per] || [];
      const targetWeek = per === 8
        ? String(targetTeacherCells.find(cell => ['單週', '雙週'].includes(String(cell['課堂屬性'] || '').trim()))?.['課堂屬性'] || sourceWeek).trim()
        : '';
      const targetClassCell = getScheduleCellAt(dragInfo.cls, day, per, targetWeek);
      if (!(await confirmTeacherTimetableOverwrite(dragInfo.cell, [targetClassCell, ...targetTeacherCells], day, per))) return;

      if (!dragInfo.isPalette) {
        const bindPlan = buildBindMovePlan({
          subjectCode: subCode,
          srcCls: dragInfo.cls,
          srcDay: dragInfo.day,
          srcPer: dragInfo.per,
          dstCls: dragInfo.cls,
          dstDay: day,
          dstPer: per,
          srcWeek: sourceWeek,
          dstWeek: targetWeek
        });
        if (bindPlan) {
          if (!bindPlan.ok) {
            toast(bindPlan.error || '綁班課程無法整組移動', 'warning');
            return;
          }
          const canBindMove = await checkBindMoveConflicts(bindPlan, '綁班課程調動');
          if (!canBindMove) return;
          await doMove(dragInfo.cls, dragInfo.day, dragInfo.per, dragInfo.cls, day, per, sourceWeek, targetWeek, Boolean(canBindMove.force));
          return;
        }
      }

       const excludeInfo = dragInfo && !dragInfo.isPalette ? {
         srcDay: dragInfo.day,
         srcPer: dragInfo.per,
         excludeIds: [dragInfo.cell && dragInfo.cell['課表ID'], targetClassCell && targetClassCell['課表ID']]
       } : null;
      const teacherValue = dragInfo.teacherList?.length ? dragInfo.teacherList : teacherCode;
      const conflicts = detectConflicts(day, per, teacherValue, subCode, dragInfo.cls, dragInfo.isPalette ? '' : dragInfo.cls, excludeInfo, targetWeek);
      const canTeacherDrop = await checkHandAdjustConflicts(conflicts, '教師課表調動');
      if (!canTeacherDrop) return;
      const teacherDropForce = Boolean(canTeacherDrop.force);

      if (dragInfo.isPalette) {
        optimisticUpdateCell({
          classCode:  dragInfo.cls,
          day:        day,
          period:     per,
            subjectCode: dragInfo.subjectCode,
            teacherCode: teacherCode,
            teacherList: dragInfo.teacherList,
          attr:        dragInfo.attr || '一般',
          isLocked:    false,
          force:      teacherDropForce
        });
      } else {
        const srcCls = dragInfo.cls, srcDay = dragInfo.day, srcPer = dragInfo.per;
        const srcCell = dragInfo.cell;
        const srcWeek = sourceWeek;
        if (!srcCell) return;

        // 1. 檢查目標格於該班級是否已有課程（例如 801 在 (day, per) 有理化）
        const dstClassCell = targetClassCell;

        // 2. 檢查目標格於該教師是否已有其他班級課程（例如 吳美靜 在 (day, per) 有 802 童軍）
        const dstTeacherCells = targetTeacherCells;

        if ((dstClassCell && isBindScheduleEntry(dstClassCell)) || dstTeacherCells.some(isBindScheduleEntry)) {
          toast('綁班課程不可被單獨擠掉，請先整組移動綁班課程', 'warning');
          return;
        }

        if (dstClassCell) {
          // 情境 A：該班級在目標格原本就有課 -> 與該班原課程進行兩格互調（Swap），並同步雙方教師課表與班級課表
           const dstExcludeInfo = { srcDay: srcDay, srcPer: srcPer, excludeIds: [dstClassCell['課表ID']] };
          const dstConflicts = detectConflicts(day, per, srcCell['教師姓名'], srcCell['科目代碼'], srcCls, srcCls, dstExcludeInfo, targetWeek);
          const canDst = await checkHandAdjustConflicts(dstConflicts, '教師課表調動（目標位置）');
          if (!canDst) return;

           const srcExcludeInfo = { srcDay: day, srcPer: per, excludeIds: [srcCell['課表ID']] };
          const srcConflicts = detectConflicts(srcDay, srcPer, dstClassCell['教師姓名'], dstClassCell['科目代碼'], srcCls, srcCls, srcExcludeInfo, srcWeek);
          const canSrc = await checkHandAdjustConflicts(srcConflicts, '教師課表調動（來源位置）');
          if (!canSrc) return;

          await doSwap({ cls: srcCls, day: srcDay, per: srcPer, week: srcWeek }, { cls: srcCls, day: day, per: per, week: targetWeek }, Boolean(teacherDropForce || canDst.force || canSrc.force));
        } else if (dstTeacherCells.length > 0) {
          // 情境 B：教師在目標格有別班的課程 -> 與該別班課程進行互調（Swap）
          const otherCell = dstTeacherCells[0];
          const otherCls  = String(otherCell['班級代碼'] || '');

           const dstExcludeInfo = { srcDay: srcDay, srcPer: srcPer, excludeIds: [otherCell['課表ID']] };
          const dstConflicts = detectConflicts(day, per, srcCell['教師姓名'], srcCell['科目代碼'], srcCls, [srcCls, otherCls], dstExcludeInfo, targetWeek);
          const canDst = await checkHandAdjustConflicts(dstConflicts, '教師課表調動（目標位置）');
          if (!canDst) return;

           const srcExcludeInfo = { srcDay: day, srcPer: per, excludeIds: [srcCell['課表ID']] };
          const srcConflicts = detectConflicts(srcDay, srcPer, otherCell['教師姓名'], otherCell['科目代碼'], otherCls, [srcCls, otherCls], srcExcludeInfo, srcWeek);
          const canSrc = await checkHandAdjustConflicts(srcConflicts, '教師課表調動（來源位置）');
          if (!canSrc) return;

          await doSwap({ cls: srcCls, day: srcDay, per: srcPer, week: srcWeek }, { cls: otherCls, day: day, per: per, week: targetWeek }, Boolean(teacherDropForce || canDst.force || canSrc.force));
        } else {
          // 情境 C：目標格對於該班與該教師皆為空堂 -> 一般移動
           const moveExcludeInfo = { srcDay: srcDay, srcPer: srcPer, excludeIds: [srcCell['課表ID']] };
          const conflicts = detectConflicts(day, per, srcCell['教師姓名'], srcCell['科目代碼'], srcCls, srcCls, moveExcludeInfo, targetWeek);
          const canMove = await checkHandAdjustConflicts(conflicts, '教師課表調動');
          if (!canMove) return;
          await doMove(srcCls, srcDay, srcPer, srcCls, day, per, srcWeek, targetWeek, Boolean(teacherDropForce || canMove.force));
        }
      }
    });
  });
}

function renderTeacherTT(teacherCode, target = 'primary') {
  const pane = getTimetablePane(target);
  const t = idx.teacherByCode[teacherCode];
  const teacherTotalWeekly = idx.assignedWeeklyByTeacher?.[String(teacherCode)] || 0;
  const formalHoursFn = typeof countTeacherFormalScheduleHours === 'function'
    ? countTeacherFormalScheduleHours
    : (typeof window !== 'undefined' ? window.countTeacherFormalScheduleHours : null);
  const teacherTotalScheduled = typeof formalHoursFn === 'function'
    ? formalHoursFn(teacherCode)
    : idx.scheduledAssignedByTeacher?.[String(teacherCode)] || 0;
  const teacherTotalRemaining = Math.max(0, teacherTotalWeekly - teacherTotalScheduled);
  const tName = t ? ((t['教師姓名'] || t['姓名']) || teacherCode) : teacherCode;
  const basicHoursRaw = parseWeeklyValue(t?.['基本鐘點'], NaN);
  const basicHours = Number.isFinite(basicHoursRaw) ? basicHoursRaw : 0;
  const overtimeHours = Math.max(0, teacherTotalScheduled - basicHours);
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
   if (target === 'primary' && ui.thirdOpen) renderThirdTimetable();
}

// ============================================================
// 拖曳排課
// ============================================================

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

  if (box) box.innerHTML = pendingHtml + (doneCount > 0 ? `<details class="palette-collapse"><summary>已排完（${doneCount} 科）</summary>${doneHtml}</details>` : '');

  // 繫結卡片拖曳事件
  const cards = box.querySelectorAll('.palette-card[draggable="true"]');
  cards.forEach(card => {
    card.addEventListener('dragstart', e => {
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
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      ui.drag = null;
      card.style.opacity = '1';
      clearTimetableDragHighlights();
    });
  });
}


// ============================================================
// 樂觀 UI 更新機制 (Optimistic UI Updates - 秒級回應，背景同步)
// ============================================================

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

// 1. 樂觀單格指派／更新（綁班強制連動）
function optimisticUpdateCell({ classCode, day, period, subjectCode, teacherCode, teacherList, attr = '一般', isLocked = false, isOvertime = false, force = false }) {
  const dayNum = parseInt(day, 10);
  const perNum = parseInt(period, 10);
  const finalAttr = isOvertime
    ? '超鐘點'
    : (isVirtualClassCode(classCode) || isManualOnlyPeriod(perNum) ? '抽離' : String(attr || '一般'));
  let skippedFrozenClasses = [];

  // 教師清單正規化：若傳入完整列表則使用；否則以 teacherCode 組單筆
  let tl;
  if (Array.isArray(teacherList) && teacherList.length > 0) {
    tl = normalizeTeacherList(teacherList);
  } else {
    const single = Array.isArray(teacherCode) && teacherCode.length ? teacherCode[0] : teacherCode;
    tl = single ? normalizeTeacherList([single]) : [];
  }
  focusTeacherAfterManualAssignment(tl[0]?.['教師姓名'] || '');

  // 寫入主要班級（第八節以 課堂屬性 區分單雙週）
  const bindMembers = getBindGroupMembers(subjectCode, classCode);
  const bindClasses = bindMembers ? [...new Set(bindMembers.map(member => member.classCode))] : null;
  const primaryMember = bindMembers?.find(member =>
    member.classCode === String(classCode) && member.subjectCode === String(subjectCode)
  ) || { classCode: String(classCode), subjectCode: String(subjectCode) };
  const targetClasses = bindClasses || [classCode];
  const sameClassSet = (left, right) => {
    const a = [...new Set((left || []).map(code => String(code)))].sort();
    const b = [...new Set((right || []).map(code => String(code)))].sort();
    return a.length === b.length && a.every((code, index) => code === b[index]);
  };
  const findTargetCell = cls => state.schedule.find(entry => {
    if (String(entry['班級代碼'] || '') !== String(cls)) return false;
    if (parseInt(entry['星期'], 10) !== dayNum || parseInt(entry['節次'], 10) !== perNum) return false;
    return perNum !== 8 || String(entry['課堂屬性'] || '') === String(finalAttr || '');
  });
  const bindSlotEntries = bindMembers
    ? bindMembers.map(member => state.schedule.find(entry =>
      String(entry['班級代碼'] || '') === String(member.classCode) &&
      String(entry['科目代碼'] || '') === String(member.subjectCode) &&
      parseInt(entry['星期'], 10) === dayNum &&
      parseInt(entry['節次'], 10) === perNum &&
      (perNum !== 8 || String(entry['課堂屬性'] || '') === String(finalAttr || ''))
    ))
    : [];
  if (bindMembers && bindSlotEntries.some(entry => String(entry?.['是否鎖定'] || '').toUpperCase() === 'TRUE')) {
    toast('綁班群組中含有鎖定課程，請先整組解鎖後再編輯', 'warning');
    return;
  }
  const incompatibleTarget = targetClasses
    .map(cls => findTargetCell(cls))
    .filter(Boolean)
    .find(existing => {
      const existingBindClasses = getBindGroupClasses(existing['科目代碼'], existing['班級代碼']);
      const expectedMember = bindMembers?.find(member => member.classCode === String(existing['班級代碼'] || ''));
      if (existingBindClasses) {
        return !bindClasses || !sameClassSet(existingBindClasses, bindClasses) ||
          !expectedMember || String(existing['科目代碼'] || '').trim() !== expectedMember.subjectCode;
      }
      return Boolean(bindClasses);
    });
  if (incompatibleTarget) {
    toast(bindClasses
      ? '綁班課程必須整組寫入，不能單獨覆寫目的地課程'
      : '綁班課程不可被單獨覆寫，請先整組移動或清除', 'warning');
    return;
  }
  const frozenTarget = targetClasses
    .map(cls => findTargetCell(cls))
    .find(existing => existing && isFrozenScheduleEntry(existing));
  if (frozenTarget) {
    toast('凍結課程不可覆寫，請先解除固定設定', 'warning');
    return;
  }

  function writeOneMember(member) {
    const cls = String(member.classCode);
    const memberSubject = String(member.subjectCode);
    const isPrimary = cls === String(primaryMember.classCode) && memberSubject === String(primaryMember.subjectCode);
    const defaultTcInfo = isPrimary
      ? { targetCls: classCode, tc: tl.length ? tl[0]['教師姓名'] : '' }
      : null;
    const tc = getTeacherForClassSubject(cls, memberSubject, defaultTcInfo);
    const memberAttr = isOvertime
      ? '超鐘點'
      : (isVirtualClassCode(cls) || isManualOnlyPeriod(perNum) ? '抽離' : String(attr || '一般'));
    // 有角色標籤的單一教師也必須保留 JSON，否則「台」等主要教師標籤會遺失。
    const unifiedVal = isPrimary && (tl.length > 1 || tl.some(item => item['標籤']))
      ? JSON.stringify(tl)
      : tc;
    const slotKey = String(cls) + '|' + dayNum + '|' + perNum + '|' + (perNum === 8 ? memberAttr : '一般');
    const existing = (idx.scheduleSlot && idx.scheduleSlot[slotKey]);
    if (existing && isFrozenScheduleEntry(existing)) {
      skippedFrozenClasses.push(String(cls));
      return false;
    }
    if (existing) {
      existing['科目代碼'] = memberSubject;
      existing['教師姓名'] = unifiedVal;
      existing['課堂屬性'] = memberAttr;
      existing['是否鎖定'] = isLocked ? 'TRUE' : 'FALSE';
    } else {
      const newCell = {
        '課表ID': 'S_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        '班級代碼': String(cls), '星期': dayNum, '節次': perNum,
        '科目代碼': memberSubject, '教師姓名': unifiedVal,
        '課堂屬性': memberAttr,
        '是否鎖定': isLocked ? 'TRUE' : 'FALSE'
      };
      state.schedule.push(newCell);
    }
    return true;
  }

  if (!writeOneMember(primaryMember)) {
    toast('凍結課程不可覆寫，請先解除固定設定', 'warning');
    return;
  }

  // 綁班群組強制連動：同群組其他班級自動寫入同一格位，並保留各自教師代碼
  if (bindMembers) {
    const groupWriteOk = bindMembers
      .filter(member => member !== primaryMember)
      .every(member => writeOneMember(member));
    if (!groupWriteOk) {
      toast('綁班課程未能完整寫入，請重新載入後再試', 'warning');
      return;
    }
  }

  buildIndex();
  renderClassSelect();
  if (ui.selectedClass) renderClassTT(ui.selectedClass);
  if (ui.selectedTeacher) renderTeacherTT(ui.selectedTeacher);
  toast(skippedFrozenClasses.length > 0 ? '已排課，綁班中的凍結課程保留未動' : '排課成功', 'success');

  const payloadTc = tl.length > 1 ? tl : (tl.length === 1 && tl[0]['標籤'] ? tl : (tl.length ? tl[0]['教師姓名'] : ''));
  if (bindClasses) {
    const scheduleSnapshot = state.schedule.map(entry => ({ ...entry }));
    gasPost('batchUpdateSchedule', { schedule: scheduleSnapshot, baseRevision: state.scheduleRevision, manualSoftWarnings: true, allowSoftTeacherExclusives: force, allowManualConstraintWarnings: force }, { silent: true })
      .then(res => {
        if (!res || !res.ok) {
          toast('綁班整組寫入失敗' + (res?.error ? '：' + res.error : '') + '，請重新載入', 'warning');
          loadAll({ background: true });
          return;
        }
        applyScheduleRevisionResponse(res);
      })
      .catch(err => toast('網路異常，綁班整組寫入失敗：' + String(err?.message || err || '未知錯誤'), 'warning'));
  } else {
      gasPost('updateCell', { classCode, day: dayNum, period: perNum, subjectCode, teacherCode: payloadTc, attr: finalAttr, isLocked, isOvertime, force })
      .then(res => {
        if (!res || !res.ok) toast('雲端寫入失敗' + (res?.error ? '：' + res.error : '') + '，請重新載入', 'warning');
        else applyScheduleRevisionResponse(res);
      })
      .catch(err => toast('網路異常，背景寫入失敗', 'warning'));
  }
}

// 2. 樂觀單格清除（綁班強制連動清除）
function optimisticClearCell(classCode, day, period, weekType) {
  const dayNum = parseInt(day, 10);
  const perNum = parseInt(period, 10);
  const ck = String(classCode) + '|' + dayNum + '|' + perNum;
  const existingCell = perNum === 8 && weekType
    ? ((idx.schedByClassSlotP8?.[ck] || {})[String(weekType)] || state.schedule.find(s =>
      String(s['班級代碼']) === String(classCode) &&
      parseInt(s['星期'], 10) === dayNum &&
      parseInt(s['節次'], 10) === perNum &&
      String(s['課堂屬性'] || '') === String(weekType)
    ))
    : idx.schedByClassSlot[ck];
  const clearSubCode = existingCell ? String(existingCell['科目代碼'] || '') : '';
  const bindMembers = clearSubCode ? getBindGroupMembers(clearSubCode, classCode) : null;
  const bindClasses = bindMembers ? [...new Set(bindMembers.map(member => member.classCode))] : null;

  const targets = bindClasses || [classCode];
  const frozenTargets = targets.filter(c => {
    const cell = state.schedule.find(s =>
      String(s['班級代碼']) === String(c) &&
      parseInt(s['星期'], 10) === dayNum &&
      parseInt(s['節次'], 10) === perNum &&
      (perNum !== 8 || !weekType || String(s['課堂屬性'] || '') === String(weekType))
    );
    return cell && isClearFrozenScheduleEntry(cell);
  });
  if (frozenTargets.length > 0) {
    toast('凍結課程不可清除，請先解除固定設定', 'warning');
    return;
  }
  const memberKeys = bindMembers
    ? new Set(bindMembers.map(member => String(member.classCode) + '|' + String(member.subjectCode)))
    : null;

  state.schedule = state.schedule.filter(s => {
    const k = String(s['班級代碼']) + '|' + parseInt(s['星期'], 10) + '|' + parseInt(s['節次'], 10);
    if (parseInt(s['星期'], 10) !== dayNum || parseInt(s['節次'], 10) !== perNum) return true;
    if (perNum === 8 && weekType && String(s['課堂屬性'] || '') !== String(weekType)) return true;
    if (!memberKeys) return k !== String(classCode) + '|' + dayNum + '|' + perNum;
    return !memberKeys.has(String(s['班級代碼']) + '|' + String(s['科目代碼']));
  });

  buildIndex();
  renderClassSelect();
  if (ui.selectedClass) renderClassTT(ui.selectedClass);
  if (ui.selectedTeacher) renderTeacherTT(ui.selectedTeacher);
  toast(bindClasses ? '已清除綁班群組格位' : '已清除格位', 'info');

  gasPost('clearCell', { classCode, day: dayNum, period: perNum, weekType: weekType || '', subjectCode: clearSubCode, force: true })
    .then(res => {
      if (!res || !res.ok) toast('雲端清除失敗', 'warning');
      else applyScheduleRevisionResponse(res);
    })
    .catch(err => toast('網路異常', 'warning'));
}

// 3. 樂觀移動格位（綁班強制連動移動）
function optimisticMoveCell(srcCls, srcDay, srcPer, dstCls, dstDay, dstPer, srcWeek, dstWeek, force = false) {
  const srcD = parseInt(srcDay, 10), srcP = parseInt(srcPer, 10);
  const dstD = parseInt(dstDay, 10), dstP = parseInt(dstPer, 10);

  // 尋找來源課（第八節需比對週次屬性）
  const srcWeekKey = (srcP === 8 && srcWeek) ? srcWeek : '一般';
  const srcCell = (idx.scheduleSlot && idx.scheduleSlot[String(srcCls) + '|' + srcD + '|' + srcP + '|' + srcWeekKey])
    || state.schedule.find(s => {
    if (String(s['班級代碼']) !== String(srcCls)) return false;
    if (parseInt(s['星期'], 10) !== srcD || parseInt(s['節次'], 10) !== srcP) return false;
    if (srcP === 8 && srcWeek) return (s['課堂屬性'] || '') === srcWeek;
    return true;
  });
  if (!srcCell) return;
  if (isFrozenScheduleEntry(srcCell)) { toast('凍結課程不可移動，請先解除固定設定', 'warning'); return; }
  const subjectCode = String(srcCell['科目代碼'] || '');
  const attr = srcCell['課堂屬性'] || '一般';
  const targetAttr = dstP === 8
    ? (dstWeek || attr)
    : (isVirtualClassCode(dstCls) || isManualOnlyPeriod(dstP) ? '抽離' : attr);
  const bindClasses = getBindGroupClasses(subjectCode, srcCls);

  if (bindClasses) {
    const bindPlan = buildBindMovePlan({
      subjectCode,
      srcCls,
      srcDay: srcD,
      srcPer: srcP,
      dstCls,
      dstDay: dstD,
      dstPer: dstP,
      srcWeek,
      dstWeek
    });
    if (!bindPlan || !bindPlan.ok) {
      toast(bindPlan?.error || '綁班課程無法整組移動', 'warning');
      return;
    }

    // 綁班課程保留每一班原本的教師與課表 ID，整組一起移動，絕不只改其中一班。
    bindPlan.sourceEntries.forEach(entry => {
      entry['星期'] = dstD;
      entry['節次'] = dstP;
      if (dstP === 8 || isManualOnlyPeriod(dstP) || isVirtualClassCode(entry['班級代碼'])) {
        entry['課堂屬性'] = isManualOnlyPeriod(dstP) || isVirtualClassCode(entry['班級代碼'])
          ? '抽離'
          : bindPlan.destinationAttr;
      }
    });

    buildIndex();
    renderClassSelect();
    if (ui.selectedClass) renderClassTT(ui.selectedClass);
    if (ui.selectedTeacher) renderTeacherTT(ui.selectedTeacher);
    toast('已整組移動綁班課程', 'success');

    const scheduleSnapshot = state.schedule.map(entry => ({ ...entry }));
    gasPost('batchUpdateSchedule', { schedule: scheduleSnapshot, baseRevision: state.scheduleRevision, manualSoftWarnings: true, allowSoftTeacherExclusives: force, allowManualConstraintWarnings: force }, { silent: true })
      .then(res => {
        if (!res || !res.ok) {
          toast('綁班整組移動雲端同步失敗', 'warning');
          loadAll({ background: true });
          return;
        }
        applyScheduleRevisionResponse(res);
      })
      .catch(err => toast('綁班整組移動背景同步異常', 'warning'));
    return;
  }

  const targetClasses = [dstCls];
  const hasFrozenDestination = targetClasses.some(c => state.schedule.some(s =>
    String(s['班級代碼']) === String(c) &&
    parseInt(s['星期'], 10) === dstD &&
    parseInt(s['節次'], 10) === dstP &&
    (dstP !== 8 || String(s['課堂屬性'] || '') === String(targetAttr || '一般')) &&
    isFrozenScheduleEntry(s)
  ));
  if (hasFrozenDestination) {
    toast('凍結課程不可移動或覆寫，請先解除固定設定', 'warning');
    return;
  }

  // 清除受影響的原格位與目標格位
  function keyMatches(s, cls, d, p, weekFilter) {
    if (String(s['班級代碼']) !== String(cls)) return false;
    if (parseInt(s['星期'], 10) !== d || parseInt(s['節次'], 10) !== p) return false;
    if (p === 8 && weekFilter) return (s['課堂屬性'] || '') === weekFilter;
    return true;
  }

  state.schedule = state.schedule.filter(s => {
    if (keyMatches(s, srcCls, srcD, srcP, srcWeek || '')) return false;
    if (keyMatches(s, dstCls, dstD, dstP, targetAttr)) return false;
    return true;
  });

  // 寫入目的（一般課程只移動來源這一班）
  const tListSrc = srcCell ? getCellTeacherList(srcCell) : [];
  const cellObj = {
      '課表ID': 'S_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      '班級代碼': String(dstCls),
      '星期': dstD,
      '節次': dstP,
      '科目代碼': subjectCode,
      '教師姓名': tListSrc.length > 1 ? JSON.stringify(tListSrc) : String(srcCell['教師姓名'] || ''),
      '課堂屬性': targetAttr,
      '是否鎖定': 'FALSE'
  };
  state.schedule.push(cellObj);

  buildIndex();
  renderClassSelect();
  if (ui.selectedClass) renderClassTT(ui.selectedClass);
  if (ui.selectedTeacher) renderTeacherTT(ui.selectedTeacher);
  toast('已移動課程', 'success');

  const tListForMove = srcCell ? getCellTeacherCodes(srcCell) : [];
  gasPost('clearCell', { classCode: srcCls, day: srcD, period: srcP, weekType: srcP === 8 ? srcWeek : '' })
    .then(clearRes => {
      if (!clearRes || !clearRes.ok) {
        toast('移動來源清除失敗，請重新載入', 'warning');
        return null;
      }
      applyScheduleRevisionResponse(clearRes);
      return gasPost('updateCell', {
         classCode: dstCls, day: dstD, period: dstP,
         subjectCode, teacherCode: tListForMove.length > 1 ? tListForMove : (tListForMove[0] || srcCell['教師姓名'] || ''),
         attr: targetAttr, weekType: dstP === 8 ? targetAttr : '',
         isLocked: false, force
      });
    })
    .then(updateRes => {
      if (updateRes) {
        if (!updateRes.ok) toast('移動目的地寫入失敗，請重新載入', 'warning');
        else applyScheduleRevisionResponse(updateRes);
      }
    })
    .catch(err => toast('移動背景同步異常', 'warning'));
}


// 4. 樂觀互調格位 (Swap) — 綁班群組只能整組移動，不可單格互調
function optimisticSwapCells(a, b, force = false) {
  const aD = parseInt(a.day, 10), aP = parseInt(a.per, 10);
  const bD = parseInt(b.day, 10), bP = parseInt(b.per, 10);
  const aWeek = a.week || '';
  const bWeek = b.week || '';

  // 檢查綁班群組
  function getCellState(cls, day, per, week) {
    if (per === 8 && week) {
      const p8 = idx.schedByClassSlotP8[cls + '|' + day + '|8'] || {};
      return p8[week];
    }
    return idx.schedByClassSlot[cls + '|' + day + '|' + per];
  }

  const cellAstate = getCellState(a.cls, aD, aP, aWeek);
  const cellBstate = getCellState(b.cls, bD, bP, bWeek);
  if (isFrozenScheduleEntry(cellAstate) || isFrozenScheduleEntry(cellBstate)) {
    toast('凍結課程不可互調，請先解除固定設定', 'warning');
    return;
  }
  const subA = cellAstate ? String(cellAstate['科目代碼'] || '') : '';
  const subB = cellBstate ? String(cellBstate['科目代碼'] || '') : '';
  if ((subA && getBindGroupClasses(subA, a.cls)) || (subB && getBindGroupClasses(subB, b.cls))) {
    toast('綁班課程須整組移動，不能單格互調；請拖曳到所有班級皆為空的時段', 'warning');
    return;
  }

  // 尋找資料庫記錄（第八節需比對週次屬性）
  function findCell(cls, day, per, week) {
    const d = parseInt(day, 10), p = parseInt(per, 10);
    const wk = p === 8 && week ? week : '一般';
    const viaSlot = (idx.scheduleSlot && idx.scheduleSlot[String(cls) + '|' + d + '|' + p + '|' + wk]);
    if (viaSlot) return viaSlot;
    return state.schedule.find(s =>
      String(s['班級代碼']) === String(cls) &&
      parseInt(s['星期'], 10) === d &&
      parseInt(s['節次'], 10) === p &&
      (p !== 8 || !week || (s['課堂屬性'] || '') === week)
    );
  }

  const cellA = findCell(a.cls, aD, aP, aWeek);
  const cellB = findCell(b.cls, bD, bP, bWeek);

  if (isFrozenScheduleEntry(cellA) || isFrozenScheduleEntry(cellB)) {
    toast('凍結課程不可互調，請先解除固定設定', 'warning');
    return;
  }

  if (cellA) {
    cellA['班級代碼'] = String(b.cls); cellA['星期'] = bD; cellA['節次'] = bP;
    if (bP === 8 && bWeek) cellA['課堂屬性'] = bWeek;
    if (isManualOnlyPeriod(bP) || isVirtualClassCode(b.cls)) cellA['課堂屬性'] = '抽離';
  }
  if (cellB) {
    cellB['班級代碼'] = String(a.cls); cellB['星期'] = aD; cellB['節次'] = aP;
    if (aP === 8 && aWeek) cellB['課堂屬性'] = aWeek;
    if (isManualOnlyPeriod(aP) || isVirtualClassCode(a.cls)) cellB['課堂屬性'] = '抽離';
  }

  buildIndex();
  renderClassSelect();
  if (ui.selectedClass) renderClassTT(ui.selectedClass);
  if (ui.selectedTeacher) renderTeacherTT(ui.selectedTeacher);
  toast('已互調課程', 'success');

  gasPost('swapCells', {
    a: { classCode: a.cls, day: aD, period: aP, weekType: aWeek },
    b: { classCode: b.cls, day: bD, period: bP, weekType: bWeek }, force
  }).then(res => {
    if (!res || !res.ok) toast('互調雲端同步失敗', 'warning');
    else applyScheduleRevisionResponse(res);
  }).catch(err => toast('互調背景同步異常', 'warning'));
}


function optimisticSetOvertime(classCode, day, period, teacherCode, overtime) {
  const dayNum = parseInt(day, 10);
  const perNum = parseInt(period, 10);
  if (perNum === 8 || isManualOnlyPeriod(perNum)) {
    toast(isManualOnlyPeriod(perNum) ? '早自習與午休不設定超鐘點' : '第八節不設定超鐘點', 'warning');
    return;
  }
  const key = String(classCode) + '|' + dayNum + '|' + perNum;
  const cell = (idx.schedByClassSlot && idx.schedByClassSlot[key]) || null;
  if (!cell) {
    toast('此格沒有課程', 'warning');
    return;
  }
  const targetCode = String(teacherCode || '').trim();
  const teacherItems = normalizeTeacherList(getCellTeacherList(cell));
  const targetTeacher = targetCode
    ? teacherItems.find(item => String(item['教師姓名'] || '').trim() === targetCode)
    : null;
  if (targetTeacher) {
    applyTeacherOvertimeToCell(cell, teacherItems, targetTeacher, overtime);
  } else {
    // 舊版單教師資料沒有個別標記時，仍保留原本的共用欄位相容行為。
    cell['課堂屬性'] = overtime ? '超鐘點' : '一般';
  }
  buildIndex();
  if (ui.selectedClass) renderClassTT(ui.selectedClass);
  if (ui.selectedTeacher) renderTeacherTT(ui.selectedTeacher);
  toast(overtime ? '已設為超鐘點（背景同步中）' : '已取消超鐘點（背景同步中）', 'info');
  gasPost('setOvertime', { classCode, day: dayNum, period: perNum, teacherCode: targetCode, isOvertime: overtime })
    .then(res => {
      if (!res || !res.ok) toast('雲端超鐘點同步失敗', 'warning');
      else applyScheduleRevisionResponse(res);
    })
    .catch(() => toast('網路異常，超鐘點背景同步失敗', 'warning'));
}

const AUTO_OVERTIME_FIXED_SUBJECTS = new Set([
  '國文', '英語', '英文', '本土語', '數學', '歷史', '地理', '公民', '公民與社會',
  '生物', '理化', '自然', '地球科學', '音樂', '視覺藝術', '表演藝術', '家政', '童軍',
  '輔導', '資訊科技', '生活科技', '健康教育', '體育'
]);
const AUTO_OVERTIME_SUBJECT_ALIASES = {
  '英文': '英語',
  '公民與社會': '公民',
  '理化': '生物',
  '週會': '班週會',
  '班會': '班週會'
};
let _automaticOvertimePlan = null;

function normalizeAutomaticOvertimeSubject(value) {
  const raw = String(value || '').trim().replace(/（/g, '(').replace(/）/g, ')').replace(/\s+/g, '');
  return AUTO_OVERTIME_SUBJECT_ALIASES[raw] || raw;
}

function automaticOvertimeSubjectBase(value) {
  return normalizeAutomaticOvertimeSubject(value).replace(/\([^)]*\)/g, '').replace(/輔$/i, '');
}

function automaticOvertimeSubjectLanguage(value) {
  const match = normalizeAutomaticOvertimeSubject(value).match(/\(([^)]*)\)$/);
  return match ? String(match[1] || '').trim() : '';
}

function automaticOvertimeLanguageTag(cell, teacherCode) {
  if (normalizeAutomaticOvertimeSubject(cell && cell['科目代碼']) !== '本土語') return '';
  const item = getCellTeacherList(cell).find(teacher => String(teacher['教師姓名'] || teacher['姓名'] || '').trim() === String(teacherCode || '').trim());
  const raw = String(item && (item['語種'] || item['標籤']) || '').trim();
  const aliases = { '台語': '台', '臺語': '台', '閩南語': '台', '客語': '客', '族語': '原', '原住民族語': '原' };
  return aliases[raw] || raw;
}

function automaticOvertimeTeacherInfo(teacherCode) {
  const code = String(teacherCode || '').trim();
  return idx.teacherByCode?.[code] || (state.teachers || []).find(teacher => String(teacher['教師姓名'] || teacher['姓名'] || '').trim() === code) || {};
}

function automaticOvertimeTeacherHasSubject(teacherCode, subjectCode) {
  const info = automaticOvertimeTeacherInfo(teacherCode);
  const raw = String(info['任教科目'] || '').trim();
  if (!raw) return false;
  const wanted = automaticOvertimeSubjectBase(subjectCode);
  return raw.split(/[,，、;；/|]+/).map(automaticOvertimeSubjectBase).some(value => value === wanted);
}

function isAutomaticOvertimeFlexCell(cell) {
  const attr = String(cell && cell['課堂屬性'] || '').trim();
  if (attr === '實支' || attr === '彈') return true;
  const subject = normalizeAutomaticOvertimeSubject(cell && cell['科目代碼']);
  return subject === '班週會' || !AUTO_OVERTIME_FIXED_SUBJECTS.has(automaticOvertimeSubjectBase(subject));
}

function automaticOvertimeClassRank(classCode) {
  const code = String(classCode || '').trim();
  const info = idx.classByCode?.[code] || {};
  const grade = parseInt(String(info['年級'] || '').replace(/[^0-9]/g, ''), 10) || parseInt(code.charAt(0), 10) || 0;
  const classMatch = code.match(/(\d{1,2})$/);
  const classNumber = classMatch ? parseInt(classMatch[1], 10) : 0;
  return grade * 100 + classNumber;
}

function automaticOvertimeClassCodesSort(left, right) {
  return automaticOvertimeClassRank(right) - automaticOvertimeClassRank(left) ||
    String(right).localeCompare(String(left), 'zh-Hant', { numeric: true });
}

function automaticOvertimeCandidateSort(left, right) {
  return right.classRank - left.classRank ||
    left.day - right.day ||
    left.period - right.period ||
    String(left.subjectCode).localeCompare(String(right.subjectCode), 'zh-Hant');
}

function automaticOvertimeDispersionCompare(left, right, dayCounts) {
  const counts = dayCounts || new Map();
  const leftSelected = counts.get(left.day) || 0;
  const rightSelected = counts.get(right.day) || 0;
  return right.classRank - left.classRank ||
    leftSelected - rightSelected ||
    (left.dayLoad || 0) - (right.dayLoad || 0) ||
    right.day - left.day ||
    left.period - right.period ||
    String(left.subjectCode).localeCompare(String(right.subjectCode), 'zh-Hant');
}

function buildAutomaticOvertimeCandidates(teacherCode) {
  const code = String(teacherCode || '').trim();
  const groups = new Map();
  const teacherSlots = new Set();
  (state.schedule || []).forEach(cell => {
    if (!cell || (typeof isPatrolScheduleEntry === 'function' && isPatrolScheduleEntry(cell))) return;
    if (typeof isPreplannedScheduleEntry === 'function' && isPreplannedScheduleEntry(cell)) return;
    const day = parseInt(cell['星期'], 10);
    const period = parseInt(cell['節次'], 10);
    if (!Number.isFinite(day) || !Number.isFinite(period) || day < 1 || day > 5 || period < 1 || period > 7) return;
    const teacher = getCellTeacherList(cell).find(item => String(item['教師姓名'] || item['姓名'] || '').trim() === code);
    if (!teacher) return;
    const subjectCode = String(cell['科目代碼'] || '').trim();
    const classCode = String(cell['班級代碼'] || '').trim();
    if (!subjectCode || !classCode) return;
    teacherSlots.add(day + '|' + period);
    const languageTag = automaticOvertimeLanguageTag(cell, code) || automaticOvertimeSubjectLanguage(subjectCode);
    const subjectKey = automaticOvertimeSubjectBase(subjectCode);
    const key = [day, period, subjectKey, languageTag].join('|');
    if (!groups.has(key)) {
      const flex = isAutomaticOvertimeFlexCell(cell);
      const nonMajor = !flex && !automaticOvertimeTeacherHasSubject(code, subjectCode);
      groups.set(key, {
        key,
        teacherCode: code,
        subjectCode,
        subjectKey,
        languageTag,
        day,
        period,
        cells: [],
        classCodes: new Set(),
        flex,
        nonMajor,
        tier: flex ? 0 : (nonMajor ? 1 : 2)
      });
    }
    const group = groups.get(key);
    if (!group.cells.includes(cell)) group.cells.push(cell);
    group.classCodes.add(classCode);
  });

  const dayLoads = new Map();
  teacherSlots.forEach(slot => {
    const day = parseInt(slot.split('|')[0], 10);
    dayLoads.set(day, (dayLoads.get(day) || 0) + 1);
  });

  return Array.from(groups.values()).map(group => {
    const classCodes = Array.from(group.classCodes).sort(automaticOvertimeClassCodesSort);
    const markedCount = group.cells.filter(cell => isOvertimeScheduleEntry(cell, code)).length;
    return {
      ...group,
      classCodes,
      existing: markedCount === group.cells.length,
      partialExisting: markedCount > 0 && markedCount < group.cells.length,
      classRank: classCodes.reduce((max, classCode) => Math.max(max, automaticOvertimeClassRank(classCode)), 0),
      dayLoad: dayLoads.get(group.day) || 0,
      subjectLabel: group.subjectCode + (group.languageTag && !automaticOvertimeSubjectLanguage(group.subjectCode) ? '(' + group.languageTag + ')' : ''),
      reason: group.flex ? '彈課' : (group.nonMajor ? '非專長' : '一般課程')
    };
  }).sort(automaticOvertimeCandidateSort);
}

function selectAutomaticOvertimeCandidates(candidates, needed) {
  // 每次自動分配都從乾淨狀態重新選擇，不能把上一次的標記當成已完成額度。
  const occupiedSlots = new Set();
  let remaining = candidates.slice();
  const selected = [];
  const selectedDayCounts = new Map();
  let slotsLeft = Math.max(0, Math.ceil(Number(needed) || 0));
  for (let tier = 0; tier <= 2 && slotsLeft > 0; tier++) {
    while (slotsLeft > 0) {
      const groups = new Map();
      remaining.filter(candidate => candidate.tier === tier).forEach(candidate => {
        const key = candidate.subjectKey + '|' + candidate.languageTag;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(candidate);
      });
      const groupList = Array.from(groups.values()).map(items => items.sort(automaticOvertimeCandidateSort));
      if (groupList.length === 0) break;
      const exact = groupList.filter(items => items.length === slotsLeft);
      const oversized = groupList.filter(items => items.length > slotsLeft);
      const fitting = groupList.filter(items => items.length < slotsLeft);
       const chosen = (exact.length ? exact : (oversized.length ? oversized : fitting)).sort((left, right) => {
         const base = right.length - left.length;
         if (base) return base;
         const leftDays = new Set(left.map(candidate => candidate.day)).size;
         const rightDays = new Set(right.map(candidate => candidate.day)).size;
         return rightDays - leftDays ||
           Math.max(...left.map(candidate => candidate.dayLoad || 0)) - Math.max(...right.map(candidate => candidate.dayLoad || 0)) ||
            automaticOvertimeDispersionCompare(left[0], right[0], new Map());
       })[0];
       if (!chosen) break;
       const take = [];
       const pool = chosen.slice();
       while (take.length < slotsLeft && pool.length > 0) {
         pool.sort((left, right) => automaticOvertimeDispersionCompare(left, right, selectedDayCounts));
         const candidate = pool.shift();
         if (occupiedSlots.has(candidate.day + '|' + candidate.period)) continue;
         take.push(candidate);
         selectedDayCounts.set(candidate.day, (selectedDayCounts.get(candidate.day) || 0) + 1);
       }
       if (take.length === 0) break;
       selected.push(...take);
      const selectedSet = new Set(take);
      take.forEach(candidate => occupiedSlots.add(candidate.day + '|' + candidate.period));
      remaining = remaining.filter(candidate => !selectedSet.has(candidate) && !occupiedSlots.has(candidate.day + '|' + candidate.period));
      slotsLeft -= take.length;
    }
  }
  return { selected, remaining: slotsLeft };
}

function getAutomaticOvertimeFormalHours(teacherCode) {
  const formalHoursFn = typeof countTeacherFormalScheduleHours === 'function'
    ? countTeacherFormalScheduleHours
    : (typeof window !== 'undefined' ? window.countTeacherFormalScheduleHours : null);
  if (formalHoursFn) return formalHoursFn(teacherCode);
  const slots = new Set();
  (state.schedule || []).forEach(cell => {
    const period = parseInt(cell['節次'], 10);
    const day = parseInt(cell['星期'], 10);
    if (period < 1 || period > 7 || !Number.isFinite(day)) return;
    if (typeof isPreplannedScheduleEntry === 'function' && isPreplannedScheduleEntry(cell)) return;
    if (getCellTeacherList(cell).some(item => String(item['教師姓名'] || item['姓名'] || '').trim() === String(teacherCode))) {
      slots.add(day + '|' + period);
    }
  });
  return slots.size;
}

function buildAutomaticOvertimeTeacherPlan(teacherCode) {
  const code = String(teacherCode || '').trim();
  const info = automaticOvertimeTeacherInfo(code);
  const basicRaw = String(info['基本鐘點'] == null ? '' : info['基本鐘點']).trim();
  const basicHours = Number.parseFloat(basicRaw.replace(/,/g, ''));
  const candidates = buildAutomaticOvertimeCandidates(code);
  if (!Number.isFinite(basicHours)) {
    return { teacherCode: code, teacherName: code, skipped: true, skipReason: '基本鐘點未設定', candidates, selected: [], existingSlots: new Set(candidates.filter(item => item.existing || item.partialExisting).map(item => item.day + '|' + item.period)).size, targetSlots: 0, remaining: 0 };
  }
  const formalHours = getAutomaticOvertimeFormalHours(code);
  const targetSlots = Math.max(0, Math.ceil(formalHours - basicHours));
  const existingSlots = new Set(candidates.filter(item => item.existing || item.partialExisting).map(item => item.day + '|' + item.period)).size;
   const selection = selectAutomaticOvertimeCandidates(candidates, targetSlots);
  return {
    teacherCode: code,
    teacherName: String(info['姓名'] || info['教師姓名'] || code),
    skipped: false,
    basicHours,
    formalHours,
    targetSlots,
    existingSlots,
    selected: selection.selected,
    remaining: selection.remaining,
    candidates
  };
}

function automaticOvertimePlansToChanges(plans) {
  const changes = [];
  const seen = new Set();
  (plans || []).forEach(plan => (plan.selected || []).forEach(candidate => {
    (candidate.cells || []).forEach(cell => {
      const change = {
        classCode: String(cell['班級代碼'] || '').trim(),
        subjectCode: String(cell['科目代碼'] || '').trim(),
        teacherCode: plan.teacherCode,
        day: parseInt(cell['星期'], 10),
        period: parseInt(cell['節次'], 10),
        isOvertime: true
      };
      const key = [change.classCode, change.subjectCode, change.teacherCode, change.day, change.period].join('|');
      if (!seen.has(key)) {
        seen.add(key);
        changes.push(change);
      }
    });
  }));
  return changes;
}

function automaticOvertimeResetChanges() {
  const changes = [];
  const seen = new Set();
  (state.schedule || []).forEach(cell => {
    const period = parseInt(cell && cell['節次'], 10);
    const day = parseInt(cell && cell['星期'], 10);
    if (!cell || !Number.isFinite(day) || day < 1 || day > 5 || !Number.isFinite(period) || period < 1 || period > 7) return;
    if (typeof isPatrolScheduleEntry === 'function' && isPatrolScheduleEntry(cell)) return;
    if (typeof isPreplannedScheduleEntry === 'function' && isPreplannedScheduleEntry(cell)) return;
    const teacherList = normalizeTeacherList(getCellTeacherList(cell));
    if (teacherList.length === 0) return;
    const attr = String(cell['課堂屬性'] || '').trim();
    let markedTeachers = teacherList.filter(isTeacherOvertimeItem);
    if (attr === '超鐘點' && (teacherList.length === 1 || markedTeachers.length === 0)) markedTeachers = teacherList;
    markedTeachers.forEach(teacher => {
      const change = {
        classCode: String(cell['班級代碼'] || '').trim(),
        subjectCode: String(cell['科目代碼'] || '').trim(),
        teacherCode: String(teacher['教師姓名'] || '').trim(),
        day,
        period,
        isOvertime: false
      };
      const key = [change.classCode, change.subjectCode, change.teacherCode, change.day, change.period, change.isOvertime].join('|');
      if (change.classCode && change.subjectCode && change.teacherCode && !seen.has(key)) {
        seen.add(key);
        changes.push(change);
      }
    });
  });
  return changes;
}

function automaticOvertimeChangesForPlans(plans) {
  return [...automaticOvertimeResetChanges(), ...automaticOvertimePlansToChanges(plans)];
}

// 單一教師的超鐘點寫在課堂屬性，多教師同格才保留個別教師 JSON 標記。
function applyTeacherOvertimeToCell(cell, teacherItems, targetTeacher, overtime) {
  if (teacherItems.length > 1) {
    if (overtime) targetTeacher['超鐘點'] = true;
    else delete targetTeacher['超鐘點'];
    if (String(cell['課堂屬性'] || '').trim() === '超鐘點') cell['課堂屬性'] = '一般';
  } else {
    delete targetTeacher['超鐘點'];
    cell['課堂屬性'] = overtime ? '超鐘點' : '一般';
  }
  cell['教師姓名'] = serializeTeacherList(teacherItems);
}

function applyAutomaticOvertimeChangesLocal(changes) {
  (changes || []).forEach(change => {
    const rows = (state.schedule || []).filter(cell =>
      String(cell['班級代碼'] || '').trim() === String(change.classCode || '').trim() &&
      String(cell['科目代碼'] || '').trim() === String(change.subjectCode || '').trim() &&
      parseInt(cell['星期'], 10) === parseInt(change.day, 10) &&
      parseInt(cell['節次'], 10) === parseInt(change.period, 10)
    );
    rows.forEach(cell => {
      const teachers = normalizeTeacherList(getCellTeacherList(cell));
      const target = teachers.find(item => String(item['教師姓名'] || '').trim() === String(change.teacherCode || '').trim());
      if (!target) return;
      applyTeacherOvertimeToCell(cell, teachers, target, !!change.isOvertime);
    });
  });
}

function automaticOvertimePlanReason(plan) {
  if (plan.skipped) return plan.skipReason;
  if (plan.remaining > 0) return '尚缺 ' + plan.remaining + ' 節可設定課堂';
  if (plan.targetSlots === 0) return '沒有超鐘點額度';
  return '已重新規劃 ' + plan.selected.length + ' 節';
}

function renderAutomaticOvertimePlan(plans) {
  const summary = document.getElementById('auto-overtime-summary');
  const body = document.getElementById('auto-overtime-body');
  const applyButton = document.getElementById('auto-overtime-apply-btn');
  const resetChanges = automaticOvertimeResetChanges();
  const changes = [...resetChanges, ...automaticOvertimePlansToChanges(plans)];
  const selected = plans.reduce((total, plan) => total + (plan.selected || []).length, 0);
  const unresolved = plans.filter(plan => plan.remaining > 0).length;
  if (summary) summary.innerHTML = '本次共 ' + plans.length + ' 位教師，會先清除既有 ' + resetChanges.length + ' 個標記，再重新設定 ' + selected + ' 個教師課堂標記。' + (unresolved ? '另有 ' + unresolved + ' 位教師額度不足，已保留未完成提示。' : '') + '請按「確認套用」才會寫回試算表。';
  if (applyButton) applyButton.disabled = changes.length === 0;
  const rows = [];
  (plans || []).forEach(plan => {
    if (plan.skipped || plan.selected.length === 0) {
      rows.push('<tr><td>' + esc(plan.teacherName) + '</td><td colspan="4" class="text-muted">' + esc(automaticOvertimePlanReason(plan)) + '</td></tr>');
      return;
    }
    (plan.selected || []).map(candidate => ({ candidate, reason: candidate.reason })).forEach(item => {
      const candidate = item.candidate;
      rows.push('<tr><td>' + esc(plan.teacherName) + '</td><td>' + esc(item.reason) + '</td><td>' + esc(candidate.subjectLabel) + '</td><td>' + esc(candidate.classCodes.join('、')) + '</td><td>' + esc('週' + (DAY_NAMES[candidate.day] || candidate.day) + '第' + candidate.period + '節') + '</td></tr>');
    });
  });
  if (body) body.innerHTML = '<table class="data-table compact-table"><thead><tr><th>教師</th><th>理由</th><th>科目</th><th>班級</th><th>時段</th></tr></thead><tbody>' + (rows.join('') || '<tr><td colspan="5" class="text-center text-muted">目前沒有可設定的超鐘點課堂</td></tr>') + '</tbody></table>';
}

function openAutomaticOvertimePreview() {
  const codes = (state.teachers || [])
    .map(teacher => String(teacher['教師姓名'] || teacher['姓名'] || '').trim())
    .filter(Boolean);
  _automaticOvertimePlan = {
    baseRevision: state.scheduleRevision || '',
    plans: codes.map(buildAutomaticOvertimeTeacherPlan)
  };
  const title = document.getElementById('auto-overtime-title');
  if (title) title.textContent = '⏱️ 全校自動設定超鐘點預覽';
  renderAutomaticOvertimePlan(_automaticOvertimePlan.plans);
  document.getElementById('autoOvertimeModal')?.classList.add('show');
}

function openAutomaticOvertimeForAll() {
  openAutomaticOvertimePreview();
}

function closeAutomaticOvertimeModal() {
  document.getElementById('autoOvertimeModal')?.classList.remove('show');
  _automaticOvertimePlan = null;
}

function applyAutomaticOvertimePlan() {
  if (!_automaticOvertimePlan) return;
  const changes = automaticOvertimeChangesForPlans(_automaticOvertimePlan.plans);
  if (changes.length === 0) {
    toast('目前沒有可設定的超鐘點課堂', 'warning');
    return;
  }
  const payload = { baseRevision: _automaticOvertimePlan.baseRevision, changes };
  closeAutomaticOvertimeModal();
  bgSync({
    actionName: '自動設定超鐘點',
    applyLocal: () => {
      applyAutomaticOvertimeChangesLocal(changes);
      buildIndex();
      if (ui.selectedTeacher) renderTeacherTT(ui.selectedTeacher);
      if (typeof renderTeacherAssignmentView === 'function') renderTeacherAssignmentView();
    },
    gasTask: () => gasPost('batchSetOvertime', payload).then(async response => {
      if (response && response.ok !== false) await loadAll({ background: true });
      return response;
    })
  });
}

// 5. 樂觀鎖定/解鎖格位
function optimisticLockCell(classCode, day, period, locked, weekType) {
  const dayNum = parseInt(day, 10);
  const perNum = parseInt(period, 10);
  const wk = perNum === 8 ? String(weekType || '').trim() : '一般';
  const slotKey = String(classCode) + '|' + dayNum + '|' + perNum + '|' + wk;
  const cell = (idx.scheduleSlot && idx.scheduleSlot[slotKey])
    || state.schedule.find(s =>
    String(s['班級代碼']) === String(classCode) &&
    parseInt(s['星期'], 10) === dayNum &&
    parseInt(s['節次'], 10) === perNum &&
    (perNum !== 8 || !weekType || (s['課堂屬性'] || '') === weekType)
  );
  if (!cell) return;
  const subjectCode = String(cell['科目代碼'] || '').trim();
  const targetWeek = perNum === 8 ? String(weekType || cell['課堂屬性'] || '').trim() : '';
  const bindMembers = subjectCode ? getBindGroupMembers(subjectCode, classCode) : null;
  const targetEntries = bindMembers
    ? bindMembers.map(member => state.schedule.find(entry =>
      String(entry['班級代碼'] || '') === String(member.classCode) &&
      String(entry['科目代碼'] || '') === String(member.subjectCode) &&
      parseInt(entry['星期'], 10) === dayNum &&
      parseInt(entry['節次'], 10) === perNum &&
      (perNum !== 8 || String(entry['課堂屬性'] || '') === targetWeek)
    ))
    : [cell];
  if (bindMembers && targetEntries.some(entry => !entry)) {
    toast('綁班課程資料不完整，請先補齊所有班級後再鎖定', 'warning');
    return;
  }
  targetEntries.forEach(entry => {
    entry['是否鎖定'] = locked ? 'TRUE' : 'FALSE';
  });
  buildIndex();
  if (ui.selectedClass) renderClassTT(ui.selectedClass);
  if (ui.selectedTeacher) renderTeacherTT(ui.selectedTeacher);
  toast(locked
    ? (bindMembers ? '⚡ 已整組鎖定綁班課程 (背景同步中)' : '⚡ 已鎖定此格位 (背景同步中)')
    : (bindMembers ? '⚡ 已整組解鎖綁班課程 (背景同步中)' : '⚡ 已解鎖此格位 (背景同步中)'), 'info');

  gasPost('lockCell', { classCode, day: dayNum, period: perNum, locked, subjectCode, weekType: targetWeek })
    .then(res => {
      if (!res || !res.ok) toast('⚠️ 雲端鎖定同步失敗' + (res?.error ? '：' + res.error : ''), 'warning');
      else applyScheduleRevisionResponse(res);
    })
    .catch(err => toast('⚠️ 雲端鎖定同步失敗：' + String(err?.message || err || '未知錯誤'), 'warning'));
}

function bindClassTTEvents(target = 'primary') {
  const pane = getTimetablePane(target);
  const cells = document.querySelectorAll('#' + pane.classTT + ' .tt-cell:not(.tt-cell-p8)');
  cells.forEach(td => { bindRegularTTEvent(td, target); });
  // 第八節子儲格事件
  document.querySelectorAll('#' + pane.classTT + ' .p8-subcell').forEach(el => { bindP8SubCellEvent(el, target); });
}

function bindRegularTTEvent(td, target = 'primary') {
  const day = parseInt(td.dataset.day,10);
  const per = parseInt(td.dataset.per,10);
  const cls = td.dataset.cls || ui.selectedClass;

  td.addEventListener('click', e => {
    if (td.classList.contains('blocked')) return;
    const ck = cls+'|'+day+'|'+per;
    const existing = idx.schedByClassSlot[ck];
    if (!existing) { openAssignModal(cls, day, per); return; }
    const codes = getCellTeacherCodes(existing);
    const tc = cycleNextTeacher(codes, ui.selectedTeacher);
    if (tc) {
      ui.selectedTeacher = tc;
      document.getElementById('sel-teacher').value = tc;
      renderTeacherTT(tc);
    }
  });

  td.addEventListener('contextmenu', e => {
    e.preventDefault();
    const ck = cls+'|'+day+'|'+per;
    const cell = idx.schedByClassSlot[ck];
    ui.ctxTarget = { cls, day, per, cell };
    showCtxMenu(e.pageX, e.pageY, !!cell, cell && String(cell['是否鎖定']).toUpperCase()==='TRUE');
  });

  if (td.draggable) {
    td.addEventListener('dragstart', e => {
      const ck = cls+'|'+day+'|'+per;
      const cell = idx.schedByClassSlot[ck];
      if (!cell || isFrozenScheduleEntry(cell)) { e.preventDefault(); return; }
      ui.drag = { cls, day, per, cell, isSwap: e.shiftKey };
      resetDragConflictCache();
      td.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    td.addEventListener('dragend', () => {
      ui.drag = null;
      td.classList.remove('dragging');
       clearTimetableDragHighlights();
    });
  }
  td.addEventListener('dragover', e => {
    if (!ui.drag) return;
    e.preventDefault();
    highlightDropZone(td, day, per, cls);
  });
  td.addEventListener('dragleave', () => {
    td.classList.remove('drag-ok','drag-err','drag-warn');
  });
  td.addEventListener('drop', async e => {
    e.preventDefault();
    if (!ui.drag) return;
    td.classList.remove('drag-ok','drag-err','drag-warn');
    await executeDrop(day, per, cls, '');
  });
}

function bindP8SubCellEvent(el, target = 'primary') {
  const day = parseInt(el.dataset.day, 10);
  const per = parseInt(el.dataset.per, 10);
  const cls = el.dataset.cls || ui.selectedClass;
  const weekType = el.dataset.week; // '單週' or '雙週'
  const ck8 = cls + '|' + day + '|8';
  const p8cells = idx.schedByClassSlotP8[ck8] || {};
  const cell = p8cells[weekType];

  // 左鍵：空格→指派（帶週次）／有課→同步教師視圖
  el.addEventListener('click', e => {
    if (el.classList.contains('p8-empty')) {
      openAssignModal(cls, day, per, weekType);
      return;
    }
    const tc = cycleNextTeacher(getCellTeacherCodes(cell), ui.selectedTeacher);
    if (tc) {
      ui.selectedTeacher = tc;
      document.getElementById('sel-teacher').value = tc;
      renderTeacherTT(tc);
    }
  });

  // 右鍵
  el.addEventListener('contextmenu', e => {
    e.preventDefault();
    ui.ctxTarget = { cls, day, per, cell, week: weekType };
    showCtxMenu(e.pageX, e.pageY, !!cell, cell && String(cell['是否鎖定']).toUpperCase()==='TRUE');
  });

  // 拖曳來源（有課才可拖）
  if (cell && el.draggable && !isDragProtectedScheduleEntry(cell)) {
    el.addEventListener('dragstart', e => {
      ui.drag = { cls, day, per, cell, isSwap: e.shiftKey, p8Week: weekType };
      resetDragConflictCache();
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => {
      ui.drag = null;
      el.classList.remove('dragging');
       clearTimetableDragHighlights();
    });
  }

  // 拖曳目標
  el.addEventListener('dragover', e => {
    if (!ui.drag) return;
    e.preventDefault();
    highlightDropZone(el, day, per, cls);
  });
  el.addEventListener('dragleave', () => {
    el.classList.remove('drag-ok','drag-err','drag-warn');
  });
  el.addEventListener('drop', async e => {
    e.preventDefault();
    if (!ui.drag) return;
    el.classList.remove('drag-ok','drag-err','drag-warn');
    await executeDrop(day, per, cls, weekType);
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
document.getElementById('ctx-assign').onclick = () => {
  if (!ui.ctxTarget) return;
  const { cls, day, per } = ui.ctxTarget;
  openAssignModal(cls, day, per);
};
document.getElementById('ctx-edit').onclick = () => {
  if (!ui.ctxTarget) return;
  const { cls, day, per } = ui.ctxTarget;
  openAssignModal(cls, day, per);
};
document.getElementById('ctx-lock').onclick = () => {
  const t = ui.ctxTarget;
  if (!t || !t.cell) return;
  optimisticLockCell(t.cls, t.day, t.per, true, t.week);
};
document.getElementById('ctx-unlock').onclick = () => {
  const t = ui.ctxTarget;
  if (!t || !t.cell) return;
  optimisticLockCell(t.cls, t.day, t.per, false, t.week);
};
document.getElementById('ctx-overtime').onclick = () => {
  const t = ui.ctxTarget;
  if (!t || !t.cell || !t.teacherView || t.per === 8 || isManualOnlyPeriod(t.per)) return;
   optimisticSetOvertime(t.cls, t.day, t.per, t.teacherCode, !isOvertimeScheduleEntry(t.cell, t.teacherCode));
};
document.getElementById('ctx-clear').onclick = async () => {
  const t = ui.ctxTarget;
  if (!t) return;
  const isLocked = t.cell && String(t.cell['是否鎖定']).toUpperCase()==='TRUE';
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
document.addEventListener('click', () => { document.getElementById('ctx-menu').style.display = 'none'; });

document.getElementById('ctx-assign').onclick = () => {
  if (!ui.ctxTarget) return;
  const { cls, day, per } = ui.ctxTarget;
  openAssignModal(cls, day, per);
};
document.getElementById('ctx-edit').onclick = () => {
  if (!ui.ctxTarget) return;
  const { cls, day, per } = ui.ctxTarget;
  openAssignModal(cls, day, per);
};
document.getElementById('ctx-lock').onclick = () => {
  const t = ui.ctxTarget;
  if (!t || !t.cell) return;
  optimisticLockCell(t.cls, t.day, t.per, true, t.week);
};
document.getElementById('ctx-unlock').onclick = () => {
  const t = ui.ctxTarget;
  if (!t || !t.cell) return;
  optimisticLockCell(t.cls, t.day, t.per, false, t.week);
};
document.getElementById('ctx-overtime').onclick = () => {
  const t = ui.ctxTarget;
  if (!t || !t.cell || !t.teacherView || t.per === 8 || isManualOnlyPeriod(t.per)) return;
   optimisticSetOvertime(t.cls, t.day, t.per, t.teacherCode, !isOvertimeScheduleEntry(t.cell, t.teacherCode));
};
document.getElementById('ctx-clear').onclick = async () => {
  const t = ui.ctxTarget;
  if (!t) return;
  const isLocked = t.cell && String(t.cell['是否鎖定']).toUpperCase()==='TRUE';
  if (isLocked) {
    const ok = await showModal('確認', '此格已鎖定，仍要清除嗎？', 'confirm');
    if (!ok) return;
  }
  optimisticClearCell(t.cls, t.day, t.per, t.week);
};

// ============================================================
// 設定頁：配課
// ============================================================
function updateAsgnSubjectOptions(classCode) {
  const sel = document.getElementById('asgn-subject');
  if (!sel) return;
  const curVal = sel.value;
  const assignedCounts = {};
  let totalPeriods = 0;
  state.assignments.forEach(a => {
    if (String(a['班級代碼']) === String(classCode)) {
      const subCode = String(a['科目代碼']);
       const sub = idx.subjectByCode[subCode];
       const weekly = getAssignmentWeeklyValue(a, sub, 3);
      assignedCounts[subCode] = (assignedCounts[subCode] || 0) + weekly;
      if (!isHelperSubjectCode(subCode)) totalPeriods += weekly;
    }
  });
  const summary = document.getElementById('asgn-class-summary');
  if (summary) {
    const clsName = classCode ? (idx.classByCode[classCode] ? idx.classByCode[classCode]['班級名稱'] : classCode) : '';
    summary.innerHTML = classCode
       ? `<span>🏫 ${esc(clsName)}<br>已配 <b>${formatWeeklyValue(totalPeriods)}</b> 節</span>`
      : '';
  }
  sel.innerHTML = '<option value="">— 選擇 —</option>';
  state.subjects.forEach(s => {
    const code = s['科目代碼'];
    const assigned = assignedCounts[code] || 0;
    const label = assigned > 0 ? `✅ ${code}（${assigned}節）` : `➕ ${code}`;
    const opt = new Option(label, code);
    sel.appendChild(opt);
  });
  if (curVal) sel.value = curVal;
}

function renderConfigTab() {
  // 班級表格
  const tbody = document.getElementById('class-tbody');
  tbody.innerHTML = '';
  state.classes.forEach(c => {
    const isVirtual = c['是否虛擬班'] === 'TRUE';
    const code = String(c['班級代碼'] || '');
    tbody.innerHTML += '<tr>'+
      '<td>'+esc(code)+'</td>'+
      '<td>'+esc(c['年級'] || '')+'</td>'+
      '<td>'+esc(c['班級名稱'] || '')+(isVirtual ? ' ⚡' : '')+'</td>'+
      '<td>'+(String(c['是否虛擬班']).toUpperCase()==='TRUE' ? '虛擬' : '一般')+'</td>'+
      '<td>'+esc(classTeacherLabel(c))+'</td>'+
      '<td><button class="btn btn-ghost btn-xs" onclick="startInlineClassEdit(\''+esc(code)+'\')">編輯</button> '+
      '<button class="btn btn-xs" style="background:var(--danger-light);color:var(--danger);" onclick="deleteClass(\''+esc(code)+'\')">刪</button></td>'+
      '</tr>';
  });
  // 教師表格
  const ttbody = document.getElementById('teacher-tbody');
  ttbody.innerHTML = '';
  state.teachers.forEach(t => {
    const code = String(t['教師姓名'] || '');
    ttbody.innerHTML += '<tr>'+
      '<td>'+esc(code)+'</td>'+
      '<td>'+esc((t['教師姓名'] || t['姓名']) || '')+'</td>'+
      '<td>'+esc(t['Email'] || '')+'</td>'+
      '<td>'+esc(teacherHomeroomLabel(t))+'</td>'+
      '<td>'+esc(String(t['基本鐘點'] || '—'))+'</td>'+
      '<td>'+esc(t['任教科目'] || '')+'</td>'+
      '<td><button class="btn btn-ghost btn-xs" onclick="startInlineTeacherEdit(\''+esc(code)+'\')">編輯</button> '+
      '<button class="btn btn-xs" style="background:var(--danger-light);color:var(--danger);" onclick="deleteTeacher(\''+esc(code)+'\')">刪</button></td>'+
      '</tr>';
  });
  // 科目表格
  const stbody = document.getElementById('subject-tbody');
  stbody.innerHTML = '';
  state.subjects.forEach(s => {
    const code = String(s['科目代碼'] || ''); const c = getSubjectColor(code);
    stbody.innerHTML += '<tr><td><span class="cell-chip" style="background:'+c.bg+';color:'+c.text+';">'+esc(code)+'</span></td><td>'+esc(String(s['每週節數'] || ''))+'</td><td>'+esc(String(s['同時最多班數'] || '0'))+'</td><td>'+esc(String(s['最多連日'] || ''))+'</td><td>'+esc(s['適用年級'] || '全校')+'</td><td>'+esc(s['適用班級'] || '—')+'</td><td><button class="btn btn-ghost btn-xs" onclick="startInlineSubjectEdit(\''+esc(code)+'\')">編輯</button> <button class="btn btn-xs" style="background:var(--danger-light);color:var(--danger);" onclick="deleteSubject(\''+esc(code)+'\')">刪</button></td></tr>';
  });
  // 配課設定下拉
  ['asgn-class','asgn-subject','asgn-teacher'].forEach(id => {
    const sel = document.getElementById(id);
    const cur = sel.value;
    sel.innerHTML = '<option value="">— 選擇 —</option>';
    if (id==='asgn-class') state.classes.forEach(c => sel.appendChild(new Option(c['班級代碼']+' '+c['班級名稱'], c['班級代碼'])));
    if (id==='asgn-subject') {
      // 先全填入，再依已選班級過濾（保留未選班級時可瀏覽全部）
      state.subjects.forEach(s => sel.appendChild(new Option(s['科目代碼'], s['科目代碼'])));
    }
    if (id==='asgn-teacher') state.teachers.forEach(t => sel.appendChild(new Option(formatTeacherCodeName(t['教師姓名'], t), t['教師姓名'])));
    if (cur) sel.value = cur;
  });

  // 班級切換時更新科目下拉（顯示已配課標記）
  document.getElementById('asgn-class').onchange = function() {
    updateAsgnSubjectOptions(this.value);
  };
  // 初始呼叫（若已有選值）
  const initCls = document.getElementById('asgn-class').value;
  if (initCls) updateAsgnSubjectOptions(initCls);

  // 配課表格
  const atbody = document.getElementById('asgn-tbody');
  atbody.innerHTML = '';
  state.assignments.forEach(a => {
    const sub = idx.subjectByCode[a['科目代碼']];
    const teacher = idx.teacherByCode[a['教師姓名']];
    const teacherName = teacher ? (teacher['教師姓名'] || teacher['姓名'] || '') : '';
     const weeklyVal = getAssignmentWeeklyValue(a, sub, 3);
     const weeklyDisp = formatWeeklyValue(weeklyVal) + ' 節' + (isAlternateWeeklyValue(weeklyVal) ? '（單雙週）' : (a['每週節數'] ? '（自訂）' : ''));

    atbody.innerHTML += '<tr>'+
      '<td>'+esc(a['班級代碼'])+'</td>'+
      '<td>'+esc(a['科目代碼'])+'</td>'+
      '<td>'+esc(a['教師姓名'])+(teacherName?' '+esc(teacherName):'')+'</td>'+
      '<td>'+esc(weeklyDisp)+'</td>'+
      '<td>'+esc(a['備註'] || '')+'</td>'+
      '<td>'+(isPreplannedCourse(a['課程屬性'])?'<span class="badge badge-gray">預排（下學期）</span>':'一般課程')+'</td>'+
      '<td><button class="btn btn-ghost btn-xs" onclick="editAssignment(\''+esc(a['配課ID'])+'\')">編輯</button> '+
      '<button class="btn btn-xs" style="background:var(--danger-light);color:var(--danger);" onclick="deleteAssignment(\''+esc(a['配課ID'])+'\')">刪</button></td>'+
      '</tr>';
  });
}

// 初始化資料庫預設科目
async function initDatabase() {
  const ok = await showModal('匯入預設科目', '將自動匯入建成國中全校核心、特色與音樂班科目（已存在的項目會自動保留不覆蓋），確定繼續？', 'confirm');
  if (!ok) return;
  showLoading(true);
  const res = await gasPost('initDatabase', {});
  showLoading(false);
  if (!res || !res.ok) {
    toast('匯入失敗：' + (res ? res.error : ''), 'error');
    return;
  }
  const d = res.data;
  toast('初始化成功！新增 ' + d.subAdded + ' 科目、' + d.clsAdded + ' 班級、' + d.teaAdded + ' 教師', 'success');
  await loadAll();
}

// CRUD 班級
async function saveClass() {
  const code  = document.getElementById('cls-code').value.trim();
  const grade = document.getElementById('cls-grade').value.trim();
  const name  = document.getElementById('cls-name').value.trim();
  const bilingualLessons = document.getElementById('cls-bilingual')?.value.trim() || '';
  // 導師由教師名單的職稱（例：701導師）同步，不從表單輸入
  const homeroomTeacher = code ? state.teachers.find(t => {
    const hrM = getTeacherHomeroom(t);
    return hrM && hrM !== 'TRUE' && String(hrM) === code;
  }) : null;
  const tc    = homeroomTeacher ? (homeroomTeacher['教師姓名'] || '') : '';
  if (!code) { toast('班級代碼不能空白', 'warning'); return; }
  const newObj = {
    '班級代碼': code, '年級': grade, '班級名稱': name, '導師代碼': tc,
    '雙語課堂數': bilingualLessons,
    '班級類型': document.getElementById('cls-virtual').checked ? '虛擬' : '一般',
    '是否虛擬班': document.getElementById('cls-virtual').checked ? 'TRUE' : 'FALSE'
  };

  bgSync({
    actionName: '儲存班級資料',
    applyLocal: () => {
      const idxObj = state.classes.findIndex(c => String(c['班級代碼']) === String(code));
      if (idxObj >= 0) state.classes[idxObj] = newObj;
      else state.classes.push(newObj);
      clearClassForm();
      if (typeof renderClassConfigList === 'function') renderClassConfigList();
      if (typeof renderClassAssignmentView === 'function') renderClassAssignmentView();
    },
    gasTask: () => gasPost('saveMeta', { type: '班級', data: newObj })
  });
}

function clearClassForm() {
  ['cls-code','cls-grade','cls-name','cls-bilingual','cls-teacher'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const virtualCb = document.getElementById('cls-virtual');
  if (virtualCb) virtualCb.checked = false;
}

async function deleteClass(code) {
  const classCode = String(code || '').trim();
  if (!classCode) return;
  const hasAssignments = (state.assignments || []).some(item => String(item['班級代碼'] || '').trim() === classCode);
  const hasSchedule = (state.schedule || []).some(item => String(item['班級代碼'] || '').trim() === classCode);
  if (hasAssignments || hasSchedule) {
    toast('班級「' + classCode + '」仍有配課或課表資料，請先清除相關資料後再刪除', 'warning');
    return;
  }
  const confirmed = await showModal('確認刪除', '確定刪除班級「' + classCode + '」？', 'confirm');
  if (!confirmed) return;
  bgSync({
    actionName: '刪除班級',
    applyLocal: () => {
      state.classes = (state.classes || []).filter(item => String(item['班級代碼'] || '') !== classCode);
      if (typeof buildIndex === 'function') buildIndex();
      if (typeof renderClassConfigList === 'function') renderClassConfigList();
      if (typeof renderClassAssignmentView === 'function') renderClassAssignmentView();
      if (typeof renderTeacherAssignmentView === 'function') renderTeacherAssignmentView();
    },
    gasTask: () => gasPost('deleteMeta', { type: '班級', key: classCode })
  });
}

// CRUD 教師

// CRUD 科目
async function saveSubject() {
  const code = document.getElementById('sub-code').value.trim();
  if (!code) { toast('科目代碼不能空白', 'warning'); return; }
  const newObj = {
    '科目代碼': code,
    '每週節數': document.getElementById('sub-weekly').value,
    '同時最多班數': document.getElementById('sub-max').value,
    '最多連日': document.getElementById('sub-maxdays').value,
    '適用年級': document.getElementById('sub-grade').value,
    '適用班級': document.getElementById('sub-classes').value.trim(),
    '所屬教室代碼': (document.getElementById('sub-room')?.value || '').trim()
  };

  bgSync({
    actionName: '儲存科目資料',
    applyLocal: () => {
      const idxObj = state.subjects.findIndex(s => String(s['科目代碼']) === String(code));
      if (idxObj >= 0) state.subjects[idxObj] = newObj;
      else state.subjects.push(newObj);
      clearSubjectForm();
      if (typeof renderSubjectConfigList === 'function') renderSubjectConfigList();
      if (typeof renderTeacherSubjectBoxes === 'function') renderTeacherSubjectBoxes();
    },
    gasTask: () => gasPost('saveMeta', { type: '科目', data: newObj })
  });
}


function clearSubjectForm() {
  ['sub-code','sub-weekly','sub-max','sub-maxdays','sub-grade','sub-classes','sub-room'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const weekly = document.getElementById('sub-weekly');
  if (weekly) weekly.value = '1';
  const max = document.getElementById('sub-max');
  if (max) max.value = '0';
}

async function deleteSubject(code) {
  const subjectCode = String(code || '').trim();
  if (!subjectCode) return;
  const hasAssignments = (state.assignments || []).some(item => String(item['科目代碼'] || '').trim() === subjectCode);
  const hasSchedule = (state.schedule || []).some(item => String(item['科目代碼'] || '').trim() === subjectCode);
  const hasRules = (state.subjectRules || []).some(rule => getRuleSubjectCodes(rule).includes(subjectCode));
  const hasRelations = (state.subjectRelations || []).some(rule => getSubjectRelationCodes(rule).includes(subjectCode));
  const hasBindGroups = (state.blockGroups || []).some(group => parseBindList(group['科目清單'] || group['科目代碼']).includes(subjectCode));
  if (hasAssignments || hasSchedule || hasRules || hasRelations || hasBindGroups) {
    toast('科目「' + subjectCode + '」仍被配課、課表或限制設定使用，請先清除相關資料後再刪除', 'warning');
    return;
  }
  const confirmed = await showModal('確認刪除', '確定刪除科目「' + subjectCode + '」？', 'confirm');
  if (!confirmed) return;
  bgSync({
    actionName: '刪除科目',
    applyLocal: () => {
      state.subjects = (state.subjects || []).filter(item => String(item['科目代碼'] || '') !== subjectCode);
      if (typeof buildIndex === 'function') buildIndex();
      if (typeof renderSubjectConfigList === 'function') renderSubjectConfigList();
      if (typeof renderClassAssignmentView === 'function') renderClassAssignmentView();
      if (typeof renderTeacherAssignmentView === 'function') renderTeacherAssignmentView();
    },
    gasTask: () => gasPost('deleteMeta', { type: '科目', key: subjectCode })
  });
}

function editAssignment(id) {
  const a = state.assignments.find(x => String(x['配課ID']) === String(id));
  if (!a) return;
  document.getElementById('asgn-class').value   = a['班級代碼'] || '';
  updateAsgnSubjectOptions(a['班級代碼'] || '');
  document.getElementById('asgn-subject').value = a['科目代碼'] || '';
  document.getElementById('asgn-teacher').value = a['教師姓名'] || '';
  document.getElementById('asgn-weekly').value  = a['每週節數'] || '';
  document.getElementById('asgn-note').value    = a['備註'] || '';
  ui.editingAsgnId = a['配課ID'];
  const btn = document.getElementById('asgn-save-btn');
  if (btn) btn.textContent = '💾 儲存修改';
  document.getElementById('subpanel-config-asgn')?.scrollIntoView({ behavior: 'smooth' });
  toast('已將配課資料帶入上方表單，修改後請點擊「💾 儲存修改」', 'info');
}
async function deleteAssignment(id) {
  const ok = await showModal('確認刪除', '確定刪除此筆配課設定？', 'confirm');
  if (!ok) return;
  await gasPost('deleteMeta', { type:'配課', key:id });
  toast('配課設定已刪除', 'success');
  await loadAll();
}
function renderBindGroupTable() {
  const tbody = document.getElementById('bind-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  state.blockGroups.forEach(g => {
    const clsList = typeof g['班級清單'] === 'string' ? g['班級清單'].split(',').map(c => c.trim()).filter(Boolean) : (Array.isArray(g['班級清單']) ? g['班級清單'] : (typeof g['班級清單'] === 'number' ? String(g['班級清單']).match(/.{3}/g)||[] : []));
    const clsNames = clsList.join('、');
    const subList = typeof g['科目清單'] === 'string' ? g['科目清單'].split(',').map(s => s.trim()).filter(Boolean) : (typeof g['科目代碼'] === 'string' ? g['科目代碼'].split(',').map(s => s.trim()).filter(Boolean) : []);
    const subDisp = subList.map(s => esc(s)).join('、');
    tbody.innerHTML += '<tr>' +
      '<td><strong>' + esc(g['群組名稱']||'') + '</strong></td>' +
      '<td style="font-size:12px;">' + subDisp + '</td>' +
      '<td style="font-size:12px;">' + esc(clsNames) + '</td>' +
      '<td><button class="btn btn-ghost btn-xs" onclick="editBindGroup(\'' + esc(g['群組ID']) + '\')">編輯</button> ' +
      '<button class="btn btn-xs" style="background:var(--danger-light);color:var(--danger);" onclick="deleteBindGroup(\'' + esc(g['群組ID']) + '\')">刪</button></td>' +
      '</tr>';
  });
}


function editBindGroup(id) {
  const g = state.blockGroups.find(x => String(x['群組ID']) === String(id));
  if (!g) return;
  document.getElementById('bind-name').value = g['群組名稱'] || '';
  const subList = typeof g['科目清單'] === 'string' ? g['科目清單'].split(',').map(s => s.trim()).filter(Boolean) : (typeof g['科目代碼'] === 'string' ? g['科目代碼'].split(',').map(s => s.trim()).filter(Boolean) : []);
  document.querySelectorAll('#bind-subjects input[type=checkbox]').forEach(cb => {
    cb.checked = subList.includes(cb.value);
  });
  const clsList = typeof g['班級清單'] === 'string' ? g['班級清單'].split(',').map(c => c.trim()).filter(Boolean) : (Array.isArray(g['班級清單']) ? g['班級清單'] : (typeof g['班級清單'] === 'number' ? String(g['班級清單']).match(/.{3}/g)||[] : []));
  document.querySelectorAll('#bind-classes input[type=checkbox]').forEach(cb => {
    cb.checked = clsList.includes(cb.value);
  });
  ui.editingBindId = g['群組ID'];
  const btn = document.getElementById('bind-save-btn');
  if (btn) btn.textContent = '💾 儲存群組';
  toast('已帶入群組資料，修改後點擊「儲存群組」', 'info');
}

async function deleteBindGroup(id) {
  const ok = await showModal('確認刪除', '確定刪除此綁班群組？', 'confirm');
  if (!ok) return;
  state.blockGroups = state.blockGroups.filter(g => String(g['群組ID']) !== String(id));
  buildIndex();
  renderBindGroupTable();
  gasPost('deleteMeta', { type: '綁班', key: id })
    .catch(err => console.error('Delete bind group error:', err));
  toast('群組已刪除', 'info');
}

function clearBindForm() {
  document.getElementById('bind-name').value = '';
  document.querySelectorAll('#bind-subjects input[type=checkbox]').forEach(cb => { cb.checked = false; });
  document.querySelectorAll('#bind-classes input[type=checkbox]').forEach(cb => { cb.checked = false; });
  ui.editingBindId = null;
  const btn = document.getElementById('bind-save-btn');
  if (btn) btn.textContent = '➕ 新增群組';
}

// ==================== 課表配色 ====================
function getRealSubjects() { return (state.subjects || []).filter(s => String(s['科目代碼'] || '').trim()); }
function getRealClasses() { return (state.classes || []).filter(c => String(c['班級代碼'] || '').trim()); }
function renderColorSubjectChecks() {
  const wrap = document.getElementById('color-subject-checks');
  if (!wrap) return;
  const current = new Set(Array.from(wrap.querySelectorAll('input:checked')).map(cb => cb.value));
  const subs = getRealSubjects();
  wrap.innerHTML = '<span class="color-class-list">' +
    subs.map(s =>
      '<label class="color-class-item"><input type="checkbox" value="' + esc(s['科目代碼']) + '"' + (current.has(String(s['科目代碼'])) ? ' checked' : '') + '>' +
      esc(String(s['科目代碼']) + (s['適用年級'] ? '（' + esc(s['適用年級']) + '年級）' : '')) + '</label>'
    ).join('') +
    '</span>' || '<span class="text-muted text-xs">（無科目）</span>';
}
function toggleColorSubjectChecks(checked) {
  document.querySelectorAll('#color-subject-checks input').forEach(cb => cb.checked = checked);
}
function getColorSubjectValue() {
  return Array.from(document.querySelectorAll('#color-subject-checks input:checked')).map(cb => cb.value).filter(v => v).join(',');
}
function setColorSubjectChecks(value) {
  const set = new Set(String(value || '').split(/[,，、;；]/).map(s => s.trim()).filter(Boolean));
  const wrap = document.getElementById('color-subject-checks');
  if (!wrap) return;
  wrap.querySelectorAll('input[value]').forEach(cb => cb.checked = set.has(cb.value));
}
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
function renderColorClassChecks() {
  const wrap = document.getElementById('color-class-checks');
  if (!wrap) return;
  const current = new Set(Array.from(wrap.querySelectorAll('input:not([data-grade]):checked')).map(cb => cb.value));
  const grades = Array.from(new Set(getRealClasses().map(getClassGrade))).filter(Boolean).sort();
  let html = '';
  grades.forEach(g => {
    const list = getRealClasses().filter(c => getClassGrade(c) === g);
    if (list.length === 0) return;
    const allChecked = list.every(c => current.has(String(c['班級代碼'])));
    html += '<div class="color-class-group">' +
      '<label class="color-class-grade"><input type="checkbox" data-grade="' + esc(g) + '" ' + (allChecked ? 'checked ' : '') + 'onchange="toggleColorGradeClasses(this)"> ' + esc(g) + ' 年級</label>' +
      '<span class="color-class-list">' +
      list.map(c =>
        '<label class="color-class-item"><input type="checkbox" value="' + esc(c['班級代碼']) + '"' + (current.has(String(c['班級代碼'])) ? ' checked' : '') + '>' +
        esc(c['班級代碼'] + ' ' + (c['班級名稱'] || '')) + '</label>'
      ).join('') +
      '</span></div>';
  });
  wrap.innerHTML = html || '<span class="text-muted text-xs">（無班級）</span>';
}
function toggleColorGradeClasses(gradeChk) {
  const g = gradeChk.getAttribute('data-grade');
  if (g === null) return;
  document.querySelectorAll('#color-class-checks input[value]').forEach(cb => {
    if (!cb.hasAttribute('data-grade') && String(cb.value).charAt(0) === g) cb.checked = gradeChk.checked;
  });
}
function toggleColorClassChecks(checked) {
  document.querySelectorAll('#color-class-checks input:not([data-grade])').forEach(cb => cb.checked = checked);
}
function getColorClassValue() {
  return Array.from(document.querySelectorAll('#color-class-checks input:not([data-grade]):checked')).map(cb => cb.value).filter(v => v).join(',');
}
function setColorClassChecks(value) {
  const set = new Set(parseClassCodeList(value));
  const wrap = document.getElementById('color-class-checks');
  if (!wrap) return;
  wrap.querySelectorAll('input[value]').forEach(cb => cb.checked = set.has(cb.value));
  wrap.querySelectorAll('input[data-grade]').forEach(g => {
    const gv = g.getAttribute('data-grade');
    const vals = Array.from(wrap.querySelectorAll('input[value]')).filter(cb => String(cb.value).charAt(0) === gv);
    g.checked = vals.length > 0 && vals.every(cb => cb.checked);
  });
}
function renderColorPresets(selectedHex) {
  const select = document.getElementById('color-preset-select');
  if (!select) return;
  const cur = String(selectedHex || '').trim().replace(/^#/, '').toUpperCase();
  let found = false;
  Array.from(select.options).forEach(o => {
    const isCustom = o.value === '__CUSTOM__';
    if (!isCustom && o.value.toUpperCase() === cur) { o.selected = true; found = true; }
  });
  if (!found) {
    select.value = '__CUSTOM__';
    setColorCustomVisible(true);
    pickScheduleColor(cur || 'DEEAF6', true);
  } else {
    setColorCustomVisible(false);
  }
  setColorPresetSelectStyle(select, cur || 'DEEAF6');
}
function setColorPresetSelectStyle(select, hex) {
  if (!select) return;
  const value = String(hex || '').trim().replace(/^#/, '').toUpperCase();
  if (/^[0-9A-F]{6}$/.test(value)) {
    select.style.backgroundColor = '#' + value;
    select.style.color = '#374151';
  } else {
    select.style.backgroundColor = '';
    select.style.color = '';
  }
}
function setColorCustomVisible(show) {
  const row = document.getElementById('color-custom-row');
  if (row) row.style.display = show ? 'inline-flex' : 'none';
}
function onColorPresetSelectChange(select) {
  const v = select.value;
  if (v === '__CUSTOM__') {
    setColorCustomVisible(true);
    setColorPresetSelectStyle(select, document.getElementById('color-hex-text')?.value || '');
  } else {
    setColorCustomVisible(false);
    pickColor(v);
    setColorPresetSelectStyle(select, v);
  }
}
function pickColor(hex) {
  const input = document.getElementById('color-hex');
  const text = document.getElementById('color-hex-text');
  if (input) input.value = '#' + hex;
  if (text) text.value = hex;
}
function pickScheduleColor(hex, suppressSelect) {
  pickColor(hex);
  if (!suppressSelect) renderColorPresets(hex);
}
function syncColorHexText() {
  const input = document.getElementById('color-hex');
  const text = document.getElementById('color-hex-text');
  if (input && text) text.value = (input.value || '').replace(/^#/, '').toUpperCase();
}
function syncColorHexManual() {
  const input = document.getElementById('color-hex');
  const text = document.getElementById('color-hex-text');
  if (!input || !text) return;
  let v = String(text.value || '').trim().replace(/^#/, '').toUpperCase();
  if (/^[0-9A-F]{6}$/.test(v)) input.value = '#' + v;
}
function getScheduleColorLabel(hex) {
  const value = String(hex || '').trim().replace(/^#/, '').toUpperCase();
  const preset = SCHEDULE_COLOR_PRESETS.find(item => item.value && item.value === value);
  return preset ? preset.name : '自訂（#' + value + '）';
}
function renderColorTable() {
  const tbody = document.getElementById('color-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  (state.scheduleColors || []).forEach(r => {
    const hex = String(r['底色'] || '').replace(/^#/, '');
    const colorLabel = getScheduleColorLabel(hex);
    tbody.innerHTML += '<tr>' +
      '<td><span class="color-dot" title="#' + esc(hex) + '" style="background:#' + hex + ';"></span> <span>' + esc(colorLabel) + '</span></td>' +
      '<td>' + esc(getRuleSubjectList(r).join('、') || '全部科目') + '</td>' +
      '<td>' + esc(r['班級'] ? compressClassCodeList(parseClassCodeList(r['班級'])) : '全部班級') + '</td>' +
      '<td style="font-size:12px;">' + esc(getScheduleColorTimeLabel(r)) + '</td>' +
      '<td style="font-size:12px;">' + esc(r['說明'] || '') + '</td>' +
      '<td><button class="btn btn-ghost btn-xs" onclick="editColorRule(\'' + esc(r['規則ID']) + '\')">編輯</button> ' +
      '<button class="btn btn-xs" style="background:var(--danger-light);color:var(--danger);" onclick="deleteColorRule(\'' + esc(r['規則ID']) + '\')">刪</button></td>' +
      '</tr>';
  });
}
function clearColorForm() {
  setColorSubjectChecks('');
  const note = document.getElementById('color-note'); if (note) note.value = '';
  setColorClassChecks('');
  const day = document.getElementById('color-day'); if (day) day.value = '';
  const start = document.getElementById('color-period-start'); if (start) start.value = '';
  const end = document.getElementById('color-period-end'); if (end) end.value = '';
  pickScheduleColor('DEEAF6');
  ui.editingColorId = null;
  const btn = document.getElementById('color-save-btn');
  if (btn) btn.textContent = '➕ 新增規則';
}
function saveColorRule() {
  const sub = getColorSubjectValue();
  const cls = getColorClassValue();
  const hex = String(document.getElementById('color-hex-text').value || '').trim().replace(/^#/, '').toUpperCase();
  const note = String(document.getElementById('color-note').value || '').trim();
  const day = String(document.getElementById('color-day')?.value || '').trim();
  const start = String(document.getElementById('color-period-start')?.value || '').trim();
  const end = String(document.getElementById('color-period-end')?.value || '').trim();
  if (!/^[0-9A-F]{6}$/.test(hex)) { toast('請選擇或填入正確的 6 碼底色（如 DEEAF6）', 'warning'); return; }
  if (!!start !== !!end) { toast('節次範圍請同時選擇起始與結束', 'warning'); return; }
  if (start && parseInt(start, 10) > parseInt(end, 10)) { toast('起始節次不可晚於結束節次', 'warning'); return; }
  const id = ui.editingColorId || ('C' + Date.now());
  const existing = (state.scheduleColors || []).find(r => String(r['規則ID']) === id);
  const payload = { '規則ID': id, '科目': sub, '班級': cls, '底色': hex, '說明': note, '星期': day, '起始節次': start, '結束節次': end };
  if (existing) Object.assign(existing, payload);
  else state.scheduleColors.push(payload);
  clearColorForm();
  renderColorTable();
  gasPost('saveMeta', { type: '配色', data: payload }).catch(() => toast('配色雲端儲存失敗', 'warning'));
  toast(existing ? '配色規則已更新' : '配色規則已新增', 'success');
}
function editColorRule(id) {
  const r = (state.scheduleColors || []).find(x => String(x['規則ID']) === String(id));
  if (!r) return;
  ui.editingColorId = id;
  setColorSubjectChecks(r['科目'] || '');
  renderColorClassChecks();
  setColorClassChecks(r['班級'] || '');
  document.getElementById('color-note').value = r['說明'] || '';
  const day = document.getElementById('color-day'); if (day) day.value = r['星期'] || '';
  const start = document.getElementById('color-period-start'); if (start) start.value = r['起始節次'] || '';
  const end = document.getElementById('color-period-end'); if (end) end.value = r['結束節次'] || '';
  pickScheduleColor(String(r['底色'] || 'DEEAF6').replace(/^#/, ''));
  const btn = document.getElementById('color-save-btn');
  if (btn) btn.textContent = '💾 更新規則';
  renderColorPresets(String(r['底色'] || '').replace(/^#/, ''));
  document.getElementById('color-subject-checks').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function deleteColorRule(id) {
  const r = (state.scheduleColors || []).find(x => String(x['規則ID']) === String(id));
  showModal('確認刪除', '確定刪除此配色規則：' + (r ? (r['科目'] || '全部科目') : id) + '？', 'confirm')
    .then(ok => { if (!ok) return; state.scheduleColors = state.scheduleColors.filter(x => String(x['規則ID']) !== String(id)); renderColorTable(); gasPost('deleteMeta', { type: '配色', key: id }).catch(() => toast('刪除同步失敗', 'warning')); toast('已刪除配色規則', 'success'); });
}

// ==================== 批次配課 ====================
function getBatchExistingAssignments(classCode, subjectCode) {
  return state.assignments.filter(a =>
    String(a['班級代碼']) === String(classCode) &&
    String(a['科目代碼']) === String(subjectCode)
  );
}

function isBatchTeacherMatch(assignment, teacherCode) {
  const wanted = String(teacherCode || '').trim();
  const codes = getCellTeacherCodes(assignment);
  if (!wanted) return codes.length === 0;
  if (codes.includes(wanted)) return true;
  if (typeof resolveTeacherCodes === 'function') {
    const wantedCodes = new Set(resolveTeacherCodes(wanted));
    return resolveTeacherCodes(assignment).some(code => wantedCodes.has(code));
  }
  return false;
}

function getBatchExistingForTeacher(classCode, subjectCode, teacherCode) {
  return getBatchExistingAssignments(classCode, subjectCode)
    .find(a => isBatchTeacherMatch(a, teacherCode)) || null;
}

function getBatchWeeklyHours(value, defaultWeekly) {
  const raw = String(value ?? '').trim();
  const explicit = parseWeeklyValue(value, 0);
  return raw && explicit > 0 && isValidWeeklyInput(value)
    ? explicit
    : getSubjectWeeklyValue({ '每週節數': defaultWeekly }, 1);
}

function getBatchWeeklyOverride(value) {
  const raw = String(value ?? '').trim();
  return raw && parseWeeklyValue(value, 0) > 0 && isValidWeeklyInput(value)
    ? formatWeeklyValue(value)
    : '';
}

function parseBatchTeacherCodes(value) {
  const raw = String(value || '').trim();
  if (!raw) return { codes: [], invalid: [] };
  const tokens = raw.startsWith('[')
    ? getCellTeacherCodes({ '教師姓名': raw })
    : raw.split(/[,，、;；]/).map(token => token.trim()).filter(Boolean);
  const codes = [];
  const invalid = [];
  tokens.forEach(token => {
    const code = parseTeacherCode(token);
    const teacher = state.teachers.find(item => {
      const itemCode = String(item['教師姓名'] || item['姓名'] || '').trim();
      const itemName = String(item['姓名'] || item['教師姓名'] || '').trim();
      return code === itemCode || code === itemName || token === itemCode || token === itemName || token === formatTeacherCodeName(itemCode, item);
    });
    const normalized = teacher ? String(teacher['教師姓名'] || teacher['姓名'] || '').trim() : '';
    if (!normalized) invalid.push(token);
    else if (!codes.includes(normalized)) codes.push(normalized);
  });
  return { codes, invalid };
}

function parseBatchTagList(value) {
  return String(value || '').split(/[,，、;；]/).map(tag => tag.trim()).filter(Boolean);
}

function getBatchTeacherItems(assignment) {
  const parsed = typeof getCellTeacherList === 'function' ? getCellTeacherList(assignment) : [];
  if (parsed.length > 0) return parsed.map(item => ({
    '教師姓名': String(item['教師姓名'] || item['姓名'] || '').trim(),
    '標籤': String(item['標籤'] || '').trim()
  })).filter(item => item['教師姓名']);
  return getCellTeacherCodes(assignment).map(code => ({ '教師姓名': String(code || '').trim(), '標籤': '' })).filter(item => item['教師姓名']);
}

function formatBatchTeacherValue(value) {
  const result = parseBatchTeacherCodes(value);
  return result.codes.map(code => {
    const teacher = idx.teacherByCode?.[code];
    return formatTeacherCodeName(code, teacher);
  }).join('、');
}

function buildBatchTeacherValue(primaryValue, coTeacherValue, primaryTag, coTeacherTags) {
  const primary = parseBatchTeacherCodes(primaryValue);
  const coTeachers = parseBatchTeacherCodes(coTeacherValue);
  const codes = [...new Set([...primary.codes, ...coTeachers.codes])];
  if (codes.length === 0) return '';
  const tags = [String(primaryTag || '').trim(), ...parseBatchTagList(coTeacherTags)];
  const items = codes.map((code, index) => ({
    '教師姓名': code,
    '標籤': tags[index] || ''
  }));
  if (codes.length === 1 && !items[0]['標籤']) return codes[0];
  return JSON.stringify(items);
}

function createBatchAssignmentId(row, rowIndex) {
  return 'BATCH-' + Date.now() + '-' + rowIndex + '-' +
    String(row.classCode || '') + '-' + String(row.subjectCode || '');
}

function getBatchExistingForRow(row) {
  const existingId = String(row?.existingAssignmentId || '').trim();
  if (existingId) {
    return (state.assignments || []).find(a => String(a['配課ID'] || '') === existingId) || null;
  }
  return getBatchExistingForTeacher(row.classCode, row.subjectCode, row.teacherCode);
}

function buildBatchAssignmentPayload(row, rowIndex) {
  const existing = getBatchExistingForRow(row);
  const weeklyHours = getBatchWeeklyOverride(row.weeklyHours);
  const teacherValue = buildBatchTeacherValue(row.teacherCode, row.coTeacherCode, row.teacherTag, row.coTeacherTags);

  if (existing) {
    return {
      updated: true,
      data: {
        '配課ID': existing['配課ID'],
        '班級代碼': row.classCode,
        '科目代碼': row.subjectCode,
        '教師姓名': teacherValue || existing['教師姓名'] || '',
        '課程屬性': existing['課程屬性'] || '',
        '每週節數': String(weeklyHours),
        '備註': String(row.note || '').trim()
      }
    };
  }

  return {
    updated: false,
    data: {
      '配課ID': createBatchAssignmentId(row, rowIndex),
      '班級代碼': row.classCode,
      '科目代碼': row.subjectCode,
      '教師姓名': teacherValue,
      '課程屬性': '',
      '每週節數': String(weeklyHours),
      '備註': String(row.note || '').trim()
    }
  };
}

function makeBatchPreviewRow({classCode, className, grade, subjectCode, teacherCode, defaultWeekly}) {
  const existingAssignments = getBatchExistingAssignments(classCode, subjectCode);
  const firstExisting = existingAssignments[0] || null;
  const existingTeacherItems = [];
  const existingTeacherCodes = new Set();
  existingAssignments.forEach(assignment => getBatchTeacherItems(assignment).forEach(item => {
    const code = String(item['教師姓名'] || '').trim();
    if (!code || existingTeacherCodes.has(code)) return;
    existingTeacherCodes.add(code);
    existingTeacherItems.push(item);
  }));
  const existingTeachers = existingTeacherItems.map(item => item['教師姓名']);
  const requestedTeachers = parseBatchTeacherCodes(teacherCode);
  const primaryTeacher = requestedTeachers.codes[0] || existingTeachers[0] || '';
  const coTeachers = requestedTeachers.codes.length > 1
    ? requestedTeachers.codes.slice(1)
    : existingTeachers.slice(1);
  const primaryItem = existingTeacherItems.find(item => item['教師姓名'] === primaryTeacher);
  const coTeacherTags = coTeachers.map(code => {
    const item = existingTeacherItems.find(candidate => candidate['教師姓名'] === code);
    return item ? item['標籤'] : '';
  }).join('、');
  const weeklyOverride = firstExisting ? getBatchWeeklyOverride(firstExisting['每週節數']) : '';
  const existingWeekly = firstExisting
    ? getBatchWeeklyHours(weeklyOverride, defaultWeekly)
    : 0;
  return {
    classCode,
    className,
    grade,
    subjectCode,
    teacherCode: primaryTeacher,
    coTeacherCode: coTeachers.join('、'),
    teacherTag: primaryItem ? primaryItem['標籤'] : '',
    coTeacherTags,
    existingAssignmentId: String(firstExisting?.['配課ID'] || '').trim(),
    weeklyHours: weeklyOverride,
    note: firstExisting ? String(firstExisting['備註'] || '').trim() : '',
    defaultWeekly,
    isExisting: existingAssignments.length > 0,
    existingWeekly,
    existingTeachers
  };
}

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

function renderRuleSlotGrid() {
  const wrap = document.getElementById('rule-slot-grid');
  let html = '<table><thead><tr><th>節次</th>';
  DAYS.forEach((d, i) => { const dayN = i+1; html += '<th class="th-day" data-day="'+dayN+'" onclick="toggleDaySlots('+dayN+')" style="cursor:pointer;">'+d+'</th>'; });
  html += '</tr></thead><tbody>';
  PERIODS.forEach(per => {
    html += '<tr><th class="th-per" data-per="'+per+'" onclick="togglePeriodSlots('+per+')" style="cursor:pointer;">第'+per+'</th>';
    for (let day=1; day<=5; day++) {
      const key = day+'|'+per;
      const isSel = ui.ruleSlots.has(key);
      html += '<td><button class="slot-btn '+(isSel?'sel':'')+'"'
            + ' onclick="toggleRuleSlot('+day+','+per+')"></button></td>';
    }
    html += '</tr>';
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
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

// ============================================================
function renderStatsTab() {
  const totalSlots  = state.classes.length * 5 * 8;
  const filledSlots = state.schedule.filter(entry => !isPatrolScheduleEntry(entry)).length;
  const totalTeachers = state.teachers.length;
  const totalClasses  = state.classes.length;

  document.getElementById('stats-summary').innerHTML = [
    { label:'總班級數', val:totalClasses },
    { label:'總教師數', val:totalTeachers },
    { label:'已排格數', val:filledSlots },
    { label:'待排格數', val:Math.max(0,totalSlots-filledSlots) },
    { label:'排課進度', val: totalSlots>0 ? Math.round(filledSlots/totalSlots*100)+'%' : '0%' },
  ].map(s => '<div class="stat-card"><div class="stat-label">'+s.label+'</div><div class="stat-val">'+s.val+'</div></div>').join('');

  // 教師統計
  const tbody = document.getElementById('stats-teacher-tbody');
  tbody.innerHTML = '';
  state.teachers.forEach(t => {
    const code    = t['教師姓名'];
    const cnt     = state.schedule.filter(s => String(s['教師姓名'])===String(code) && !isPatrolScheduleEntry(s)).length;
    const base    = parseInt(t['基本鐘點']||'0',10);
    const pct     = base > 0 ? Math.round(cnt/base*100) : 0;
    const barColor = pct < 80 ? 'var(--warning)' : pct > 110 ? 'var(--danger)' : 'var(--success)';
    tbody.innerHTML += '<tr>'+
      '<td>'+esc((t['教師姓名'] || t['姓名']))+'</td>'+
      '<td>'+cnt+'</td>'+
      '<td>'+base+'</td>'+
      '<td><div style="background:var(--border);border-radius:4px;height:8px;overflow:hidden;min-width:80px;">'+
        '<div style="height:100%;width:'+Math.min(pct,100)+'%;background:'+barColor+';transition:width .3s;"></div></div>'+
        '<span class="text-muted" style="font-size:11px;margin-left:6px;">'+pct+'%</span></td>'+
      '</tr>';
  });

  // 班級統計
  const ctbody = document.getElementById('stats-class-tbody');
  ctbody.innerHTML = '';
  state.classes.forEach(c => {
    const code = c['班級代碼'];
    const filled = state.schedule.filter(s => String(s['班級代碼'])===String(code) && !isPatrolScheduleEntry(s)).length;
    const empty  = Math.max(0, 5*8 - filled);
    ctbody.innerHTML += '<tr>'+
      '<td>'+esc(c['班級名稱']||code)+'</td>'+
      '<td>'+filled+'</td>'+
      '<td><span class="badge '+(empty===0?'badge-green':'badge-yellow')+'">'+empty+'</span></td>'+
      '</tr>';
  });
}

// ============================================================
// 全校日期節次對調
// ============================================================
function scheduleExceptionDateInfo(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(raw + 'T00:00:00Z');
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) return null;
  return { date: raw, weekday: date.getUTCDay() };
}

function scheduleExceptionDayLabel(day) {
  const value = parseInt(day, 10);
  return DAY_NAMES[value] || '星期' + value;
}

function scheduleExceptionPeriodLabel(period) {
  const value = parseInt(period, 10);
  if (value === 0) return '早自習';
  if (value === 45) return '午休';
  return '第' + value + '節';
}

function scheduleExceptionJsArg(value) {
  return "decodeURIComponent('" + encodeURIComponent(String(value || '')) + "')";
}

function scheduleExceptionFormRecord() {
  const dateA = String(document.getElementById('exception-date-a')?.value || '').trim();
  const dateB = String(document.getElementById('exception-date-b')?.value || '').trim();
  const semester = String(state.settings?.['學期代號'] || '未設定').trim() || '未設定';
  return {
    '例外ID': String(document.getElementById('exception-id')?.value || '').trim() || ('EXC' + Date.now()),
    '學期代號': semester,
    '事件名稱': String(document.getElementById('exception-name')?.value || '').trim(),
    '日期A': dateA,
    '星期A': String(scheduleExceptionDateInfo(dateA)?.weekday || ''),
    '節次A': String(document.getElementById('exception-period-a')?.value || '').trim(),
    '日期B': dateB,
    '星期B': String(scheduleExceptionDateInfo(dateB)?.weekday || ''),
    '節次B': String(document.getElementById('exception-period-b')?.value || '').trim(),
    '適用範圍': '全校',
    '是否啟用': document.getElementById('exception-enabled')?.checked !== false ? 'TRUE' : 'FALSE',
    '備註': String(document.getElementById('exception-remark')?.value || '').trim()
  };
}

function validateScheduleExceptionRecord(record) {
  if (!record['事件名稱']) return '請填寫事件名稱';
  const dateA = scheduleExceptionDateInfo(record['日期A']);
  const dateB = scheduleExceptionDateInfo(record['日期B']);
  if (!dateA || !dateB) return '請填寫有效日期';
  if (dateA.weekday < 1 || dateA.weekday > 5 || dateB.weekday < 1 || dateB.weekday > 5) return '日期例外目前只支援星期一至星期五';
  if (parseInt(record['星期A'], 10) !== dateA.weekday || parseInt(record['星期B'], 10) !== dateB.weekday) return '日期與星期不一致，請重新選擇日期';
  const periodA = parseInt(record['節次A'], 10);
  const periodB = parseInt(record['節次B'], 10);
  const validPeriod = period => period === 0 || period === 45 || (period >= 1 && period <= 8);
  if (!Number.isInteger(periodA) || !validPeriod(periodA) || !Number.isInteger(periodB) || !validPeriod(periodB)) return '請選擇早自習、午休或第 1 節至第 8 節';
  if (dateA.date === dateB.date && periodA === periodB) return '兩個對調端點不可相同';
  return '';
}

function scheduleExceptionMappings(record) {
  return [
    { actualDate: record['日期A'], actualDay: record['星期A'], actualPeriod: record['節次A'], sourceDay: record['星期B'], sourcePeriod: record['節次B'] },
    { actualDate: record['日期B'], actualDay: record['星期B'], actualPeriod: record['節次B'], sourceDay: record['星期A'], sourcePeriod: record['節次A'] }
  ];
}

function scheduleExceptionIsEnabled(record) {
  const value = String(record?.['是否啟用'] ?? '').trim().toUpperCase();
  return record?.['是否啟用'] === true || value === 'TRUE' || value === '1' || value === 'YES' || value === '是';
}

function scheduleExceptionSlotKey(record, dateKey, periodKey) {
  return String(record?.[dateKey] || '').trim() + '|' + String(record?.[periodKey] || '').trim();
}

function hasScheduleExceptionSlotConflict(record) {
  if (!scheduleExceptionIsEnabled(record)) return false;
  const id = String(record['例外ID'] || '').trim();
  const occupied = new Set([
    scheduleExceptionSlotKey(record, '日期A', '節次A'),
    scheduleExceptionSlotKey(record, '日期B', '節次B')
  ]);
  return (state.scheduleExceptions || []).some(existing => {
    if (!scheduleExceptionIsEnabled(existing) || String(existing['例外ID'] || '').trim() === id) return false;
    return occupied.has(scheduleExceptionSlotKey(existing, '日期A', '節次A')) ||
      occupied.has(scheduleExceptionSlotKey(existing, '日期B', '節次B'));
  });
}

function clearScheduleExceptionForm() {
  const values = {
    'exception-id': '',
    'exception-name': '全校時段對調',
    'exception-date-a': '',
    'exception-period-a': '1',
    'exception-date-b': '',
    'exception-period-b': '5',
    'exception-remark': ''
  };
  Object.entries(values).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.value = value;
  });
  const enabled = document.getElementById('exception-enabled');
  if (enabled) enabled.checked = true;
  const saveButton = document.getElementById('exception-save-btn');
  if (saveButton) saveButton.textContent = '➕ 建立對調事件';
  renderScheduleExceptionPreview();
}

function renderScheduleExceptionTable() {
  const tbody = document.getElementById('exception-tbody');
  if (!tbody) return;
  const records = [...(state.scheduleExceptions || [])].sort((left, right) =>
    String(left['日期A'] || '').localeCompare(String(right['日期A'] || '')) ||
    String(left['事件名稱'] || '').localeCompare(String(right['事件名稱'] || ''), 'zh-Hant')
  );
  tbody.innerHTML = records.length ? records.map(record => {
    const id = scheduleExceptionJsArg(record['例外ID']);
    const enabled = scheduleExceptionIsEnabled(record);
    const status = enabled ? '<span class="badge badge-green">啟用中</span>' : '<span class="badge badge-gray">已停用</span>';
    const mapping = esc(String(record['日期A'] || '') + '（' + scheduleExceptionDayLabel(record['星期A']) + '）' + scheduleExceptionPeriodLabel(record['節次A'])) +
      ' ↔ ' + esc(String(record['日期B'] || '') + '（' + scheduleExceptionDayLabel(record['星期B']) + '）' + scheduleExceptionPeriodLabel(record['節次B']));
    return '<tr>' +
      '<td><strong>' + esc(record['事件名稱'] || '未命名事件') + '</strong><div class="text-muted text-xs">' + esc(record['學期代號'] || '') + '</div></td>' +
      '<td>' + mapping + '</td>' +
      '<td>' + status + '</td>' +
      '<td>' + esc(record['備註'] || '') + '</td>' +
      '<td class="inline-actions"><button class="btn btn-ghost btn-xs" onclick="editScheduleException(' + id + ')">✏️ 編輯</button> ' +
      '<button class="btn ' + (enabled ? 'btn-danger' : 'btn-primary') + ' btn-xs" onclick="toggleScheduleException(' + id + ')">' + (enabled ? '停用' : '啟用') + '</button></td>' +
      '</tr>';
  }).join('') : '<tr><td colspan="5" class="text-center text-muted">目前尚未建立日期節次對調事件</td></tr>';
}

function scheduleExceptionImpact(day, period) {
  const entries = (state.schedule || []).filter(entry =>
    !isPatrolScheduleEntry(entry) && parseInt(entry['星期'], 10) === parseInt(day, 10) && parseInt(entry['節次'], 10) === parseInt(period, 10)
  );
  const classes = new Set();
  const teachers = new Set();
  const rooms = new Set();
  entries.forEach(entry => {
    String(entry['班級代碼'] || '').split(/[,，、;；]/).map(value => value.trim()).filter(Boolean).forEach(value => classes.add(value));
    if (typeof getCellTeacherList === 'function') {
      getCellTeacherList(entry).forEach(item => {
        const teacher = String(item['教師姓名'] || item['姓名'] || '').trim();
        if (teacher) teachers.add(teacher);
      });
    } else {
      String(entry['教師姓名'] || '').split(/[,，、;；]/).map(value => value.trim()).filter(Boolean).forEach(value => teachers.add(value));
    }
    const subject = idx.subjectByCode?.[String(entry['科目代碼'] || '').trim()];
    const room = String(subject?.['所屬教室代碼'] || '').trim();
    if (room) rooms.add(room);
  });
  return { lessons: entries.length, classes: classes.size, teachers: teachers.size, rooms: rooms.size };
}

function renderScheduleExceptionPreview() {
  const wrap = document.getElementById('exception-preview');
  if (!wrap) return;
  const record = scheduleExceptionFormRecord();
  const error = validateScheduleExceptionRecord(record);
  if (error) {
    wrap.innerHTML = '<div class="exception-preview-empty">填妥兩個日期與節次後，這裡會顯示兩筆反向映射及影響範圍。</div>';
    return;
  }
  const cards = scheduleExceptionMappings(record).map(mapping => {
    const impact = scheduleExceptionImpact(mapping.sourceDay, mapping.sourcePeriod);
    return '<div class="exception-preview-card">' +
      '<div class="exception-preview-kicker">實際日期</div>' +
      '<strong>' + esc(mapping.actualDate) + '（' + esc(scheduleExceptionDayLabel(mapping.actualDay)) + '）' + esc(scheduleExceptionPeriodLabel(mapping.actualPeriod)) + '</strong>' +
      '<div class="exception-preview-arrow">套用固定週課表：' + esc(scheduleExceptionDayLabel(mapping.sourceDay)) + esc(scheduleExceptionPeriodLabel(mapping.sourcePeriod)) + '</div>' +
      '<div class="exception-impact">' + impact.classes + ' 班／' + impact.teachers + ' 位教師／' + impact.rooms + ' 間專科教室，共 ' + impact.lessons + ' 筆課程</div>' +
      '</div>';
  }).join('');
  wrap.innerHTML = cards;
}

function renderScheduleExceptionTab() {
  const semester = document.getElementById('exception-semester');
  if (semester) semester.textContent = String(state.settings?.['學期代號'] || '未設定');
  renderScheduleExceptionTable();
  renderScheduleExceptionPreview();
}

function editScheduleException(id) {
  const record = (state.scheduleExceptions || []).find(item => String(item['例外ID']) === String(id));
  if (!record) return;
  const values = {
    'exception-id': record['例外ID'] || '',
    'exception-name': record['事件名稱'] || '',
    'exception-date-a': record['日期A'] || '',
    'exception-period-a': record['節次A'] || '1',
    'exception-date-b': record['日期B'] || '',
    'exception-period-b': record['節次B'] || '5',
    'exception-remark': record['備註'] || ''
  };
  Object.entries(values).forEach(([field, value]) => {
    const element = document.getElementById(field);
    if (element) element.value = value;
  });
  const enabled = document.getElementById('exception-enabled');
  if (enabled) enabled.checked = scheduleExceptionIsEnabled(record);
  const saveButton = document.getElementById('exception-save-btn');
  if (saveButton) saveButton.textContent = '💾 儲存對調事件';
  renderScheduleExceptionPreview();
  document.getElementById('exception-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function saveScheduleException() {
  const record = scheduleExceptionFormRecord();
  const error = validateScheduleExceptionRecord(record);
  if (error) { toast(error, 'warning'); return; }
  if (hasScheduleExceptionSlotConflict(record)) {
    toast('指定日期與節次已被其他啟用中的對調事件占用', 'warning');
    return;
  }
  const editingId = String(document.getElementById('exception-id')?.value || '').trim();
  const existed = (state.scheduleExceptions || []).some(item => String(item['例外ID']) === String(record['例外ID']));
  bgSync({
    actionName: editingId || existed ? '更新全校時段對調' : '新增全校時段對調',
    applyLocal: () => {
      state.scheduleExceptions = (state.scheduleExceptions || []).filter(item => String(item['例外ID']) !== String(record['例外ID']));
      state.scheduleExceptions.push(record);
      clearScheduleExceptionForm();
      renderScheduleExceptionTable();
    },
    gasTask: () => gasPost('saveScheduleException', record)
  });
}

function toggleScheduleException(id) {
  const current = (state.scheduleExceptions || []).find(item => String(item['例外ID']) === String(id));
  if (!current) return;
  const next = { ...current, '是否啟用': scheduleExceptionIsEnabled(current) ? 'FALSE' : 'TRUE' };
  if (next['是否啟用'] === 'TRUE' && hasScheduleExceptionSlotConflict(next)) {
    toast('指定日期與節次已被其他啟用中的對調事件占用', 'warning');
    return;
  }
  const action = next['是否啟用'] === 'TRUE' ? '啟用全校時段對調' : '停用全校時段對調';
  bgSync({
    actionName: action,
    applyLocal: () => {
      state.scheduleExceptions = (state.scheduleExceptions || []).map(item => String(item['例外ID']) === String(id) ? next : item);
      renderScheduleExceptionTable();
      renderScheduleExceptionPreview();
    },
    gasTask: () => gasPost('saveScheduleException', next)
  });
}

async function exportScheduleExceptions() {
  showLoading(true);
  const result = await gasPost('exportScheduleExceptions', {});
  showLoading(false);
  if (!result || !result.ok) {
    toast('課表例外匯出失敗：' + String(result?.error || '無回應'), 'error');
    return;
  }
  toast('已匯出「' + result.data.sheetName + '」（' + result.data.rowCount + ' 筆反向映射）', 'success');
}

async function doExport() {
  showLoading(true);
  const res = await gasPost('exportSchedule', {});
  showLoading(false);
  if (!res||!res.ok) { toast('匯出失敗', 'error'); return; }
  const missing = (res.data && res.data.emailMissing) || [];
  if (missing.length > 0) {
    toast('已匯出課表「'+res.data.sheetName+'」（'+res.data.rowCount+' 筆）。警告：教師名單尚有 '+missing.length+' 位未填 Email（'+missing.join('、')+'）。調代課教師匯入以 Email 為唯一鍵，請先在教師頁補齊後再匯出。', 'warning');
  } else {
    toast('已匯出課表「'+res.data.sheetName+'」（'+res.data.rowCount+' 筆）。請先在調代課系統匯入教師名單，再匯入本課表。', 'success');
  }
}

async function doExportTeachers() {
  showLoading(true);
  const res = await gasPost('exportTeachers', {});
  showLoading(false);
  if (!res||!res.ok) { toast('匯出失敗', 'error'); return; }
  const missing = (res.data && res.data.emailMissing) || [];
  if (missing.length > 0) {
    toast('已匯出教師名單「'+res.data.sheetName+'」（'+res.data.rowCount+' 人）。警告：以下教師未填 Email，匯入調代課時會被略過：'+missing.join('、')+'。請先補齊 Email。', 'warning');
  } else {
    toast('已匯出教師名單「'+res.data.sheetName+'」（'+res.data.rowCount+' 人）。請至調代課系統「批次匯入教師」，再匯入課表。', 'success');
  }
}

// ============================================================
// Tab 切換
// ============================================================
function activateMainTab(tab) {
  const target = document.querySelector('.tab-btn[data-tab="'+tab+'"]');
  const panel = document.getElementById('panel-'+tab);
  if (!target || !panel) return;
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn === target));
  document.querySelectorAll('.tab-panel').forEach(item => item.classList.toggle('active', item === panel));
  ui.activeTab = tab;
  if (typeof window.renderTabIfNeeded === 'function') {
    window.renderTabIfNeeded(tab);
  } else {
    if (tab === 'config') { renderConfigTab(); renderBindGroupTab(); }
    if (tab === 'constraints') renderConstraintsTab();
    if (tab === 'stats') renderStatsTab();
    if (tab === 'room') renderRoomSelect();
    if (tab === 'exceptions') renderScheduleExceptionTab();
  }
  saveUIState();
}

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => activateMainTab(btn.dataset.tab));
  });

  // 班級選擇
  document.getElementById('sel-class').addEventListener('change', function() {
    ui.selectedClass = this.value;
    if (this.value) renderClassTT(this.value);
    else document.getElementById('class-tt').innerHTML = '<p style="padding:20px;color:var(--muted);font-size:13px;">請先選擇班級</p>';
  });

  // 教師選擇
  document.getElementById('sel-teacher').addEventListener('change', function() {
    ui.selectedTeacher = this.value;
    if (this.value) renderTeacherTT(this.value);
    else document.getElementById('teacher-tt').innerHTML = '<p style="padding:20px;color:var(--muted);font-size:13px;">請先選擇教師</p>';
  });

  // 教室選擇
  const selRoom = document.getElementById('sel-room');
  if (selRoom) {
    selRoom.addEventListener('change', function() {
      ui.selectedRoom = this.value;
      renderRoomTT(this.value);
    });
  }

  initThirdTimetable();
}

// ============================================================
// 設定 Modal
// ============================================================
document.getElementById('__settingsBtn').onclick = () => {
  document.getElementById('__gasInput').value = localStorage.getItem('gas_url') || '';
  document.getElementById('__settingsModal').classList.add('show');
};
document.getElementById('__saveBtn').onclick = () => {
  const v = document.getElementById('__gasInput').value.trim();
  if (!v) { toast('請輸入有效的 GAS 網址', 'warning'); return; }
  localStorage.setItem('gas_url', v);
  GAS_URL = v;
  document.getElementById('__settingsModal').classList.remove('show');
  showModal('已儲存', '連線設定已更新，即將重新載入').then(() => location.reload());
};
document.getElementById('__clearBtn').onclick = () => {
  showModal('確認清除','將清除已儲存的 GAS 網址，確定嗎？','confirm').then(ok => {
    if (!ok) return;
    localStorage.removeItem('gas_url');
    document.getElementById('__gasInput').value = '';
    location.reload();
  });
};
document.getElementById('__settingsModal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('__settingsModal')) {
    document.getElementById('__settingsModal').classList.remove('show');
  }
});
function genShareLink() {
  const url = resolveGasUrl();
  if (!url) { toast('尚未設定 GAS 網址', 'warning'); return; }
  const b64 = btoa(url);
  const shareUrl = location.origin + location.pathname + '?config=' + b64;
  document.getElementById('__shareUrl').textContent = shareUrl;
  document.getElementById('__qrImg').src = 'https://quickchart.io/qr?text='+encodeURIComponent(shareUrl)+'&size=180';
  document.getElementById('__shareResult').style.display = 'block';
}

// ============================================================
// 通用 Modal（禁用 alert/confirm/prompt）
// ============================================================
function showModal(title, message, type='info', okText='確定', cancelText='取消') {
  const overlay = document.getElementById('__modal');
  document.getElementById('__modalTitle').textContent = title;
  document.getElementById('__modalMsg').innerHTML   = message;
  const actions = document.getElementById('__modalActions');
  actions.innerHTML = '';
  const ok = document.createElement('button');
  ok.className = 'btn btn-primary'; ok.textContent = okText;
  ok.onclick = () => { overlay.classList.remove('show'); resolvePending(true); };
  actions.appendChild(ok);
  if (type === 'confirm') {
    const cancel = document.createElement('button');
    cancel.className = 'btn btn-ghost'; cancel.textContent = cancelText;
    cancel.onclick = () => { overlay.classList.remove('show'); resolvePending(false); };
    actions.insertBefore(cancel, ok);
  }
  overlay.classList.add('show');
  overlay.onclick = e => {
    if (e.target === overlay && type !== 'confirm') { overlay.classList.remove('show'); resolvePending(true); }
  };
  return pendingPromise();
}
let __pending = null;
function pendingPromise() { return new Promise(r => __pending = r); }
function resolvePending(v) { if (__pending) { __pending(v); __pending = null; } }

// ============================================================
// Toast
// ============================================================
function toast(msg, type='info') {
  const wrap = document.getElementById('toast-wrap');
  const el   = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = String(msg || '').replace(/\n/g, '<br>');
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity='0'; el.style.transition='opacity .3s'; setTimeout(()=>el.remove(), 300); }, 3200);
}

// ============================================================
// Loading & Status
// ============================================================
let _progressTimer = null;
let _autoStartTime = 0;

let _isAppInitialized = false;

function showLoading(v, msg, forceShowMask = false) {
  const el = document.getElementById('loading');
  if (!el) return;

  const isAutoSchedule = forceShowMask || (msg && (msg.includes('排課') || msg.includes('計算') || msg.includes('自動')));

  // 一般單點設定與拖曳：系統初始化後不跳全頁大轉圈
  // 自動排課：保留中間轉圈與秒數計時器顯示進度
  if (_isAppInitialized && v && !isAutoSchedule) {
    if (msg) toast('⏳ ' + msg, 'info');
    return;
  }

  el.classList.toggle('hidden', !v);
  if (v) {
    document.getElementById('loading-timer').textContent = '';
    if (msg) document.getElementById('loading-msg').textContent = msg;
    _autoStartTime = Date.now();
    clearInterval(_progressTimer);
    _progressTimer = setInterval(() => {
      const sec = Math.floor((Date.now() - _autoStartTime) / 1000);
      document.getElementById('loading-timer').textContent = sec + 's';
    }, 200);
  } else {
    clearInterval(_progressTimer);
    _progressTimer = null;
  }
}

function updateProgress(msg) {
  document.getElementById('loading-msg').textContent = msg;
}

function yieldToUI() { return new Promise(r => setTimeout(r, 0)); }
function setStatus(st) {
  const dot = document.getElementById('status-dot');
  dot.className = '';
  dot.classList.add(st);
  dot.title = { connected:'已連線', loading:'連線中…', error:'連線失敗', '':'未連線' }[st] || st;
}

// ============================================================
// 工具
// ============================================================
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ============================================================
// 試算表連結（隱密）
// ============================================================
async function initSheetLink() {
  if (!GAS_URL) return;
  const res = await gasGet('sheetUrl');
  if (res && res.ok && res.url) {
    const link = document.getElementById('__sheetLink');
    link.style.display = 'flex';
    link.onclick = () => window.open(res.url, '_blank');
  }
}

// ============================================================
// Demo 資料（無 GAS 時顯示）
// ============================================================
function getDemoData() {
  return {
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
    ],
        teachers: [],
    subjects: [
      // 建成國中核心領域課程（114學年度實體課表精確節數）
      { '科目代碼':'國文', '每週節數':'5', '同時最多班數':'0', '最多連日':'3', '適用年級':'全校', '適用班級':'' },
      { '科目代碼':'英語', '每週節數':'3', '同時最多班數':'0', '最多連日':'2', '適用年級':'全校', '適用班級':'' },
      { '科目代碼':'數學', '每週節數':'4', '同時最多班數':'0', '最多連日':'3', '適用年級':'全校', '適用班級':'' },
      { '科目代碼':'生物', '每週節數':'3', '同時最多班數':'0', '最多連日':'3', '適用年級':'7', '適用班級':'' },
      { '科目代碼':'理化', '每週節數':'3', '同時最多班數':'0', '最多連日':'3', '適用年級':'8', '適用班級':'' },
      { '科目代碼':'自然', '每週節數':'3', '同時最多班數':'0', '最多連日':'3', '適用年級':'9', '適用班級':'' },
      { '科目代碼':'歷史', '每週節數':'1', '同時最多班數':'0', '最多連日':'3', '適用年級':'全校', '適用班級':'' },
      { '科目代碼':'地理', '每週節數':'1', '同時最多班數':'0', '最多連日':'3', '適用年級':'全校', '適用班級':'' },
      { '科目代碼':'公民', '每週節數':'1', '同時最多班數':'0', '最多連日':'3', '適用年級':'全校', '適用班級':'' },
      { '科目代碼':'體育', '每週節數':'2', '同時最多班數':'2', '最多連日':'1', '適用年級':'全校', '適用班級':'' },
      { '科目代碼':'健康教育', '每週節數':'1', '同時最多班數':'0', '最多連日':'3', '適用年級':'全校', '適用班級':'' },
      { '科目代碼':'音樂', '每週節數':'1', '同時最多班數':'0', '最多連日':'3', '適用年級':'全校', '適用班級':'' },
      { '科目代碼':'視覺藝術', '每週節數':'1', '同時最多班數':'0', '最多連日':'3', '適用年級':'全校', '適用班級':'' },
      { '科目代碼':'表演藝術', '每週節數':'1', '同時最多班數':'0', '最多連日':'3', '適用年級':'全校', '適用班級':'' },
      { '科目代碼':'家政', '每週節數':'1', '同時最多班數':'0', '最多連日':'3', '適用年級':'全校', '適用班級':'' },
      { '科目代碼':'童軍', '每週節數':'1', '同時最多班數':'0', '最多連日':'3', '適用年級':'全校', '適用班級':'' },
      { '科目代碼':'輔導', '每週節數':'1', '同時最多班數':'0', '最多連日':'3', '適用年級':'全校', '適用班級':'' },
      { '科目代碼':'生活科技', '每週節數':'1', '同時最多班數':'0', '最多連日':'3', '適用年級':'全校', '適用班級':'' },
      { '科目代碼':'資訊科技', '每週節數':'1', '同時最多班數':'0', '最多連日':'3', '適用年級':'全校', '適用班級':'' },
      { '科目代碼':'班週會', '每週節數':'1', '同時最多班數':'0', '最多連日':'3', '適用年級':'全校', '適用班級':'' },
      { '科目代碼':'本土語', '每週節數':'1', '同時最多班數':'0', '最多連日':'3', '適用年級':'7,8', '適用班級':'' },
      { '科目代碼':'全民國防', '每週節數':'1', '同時最多班數':'0', '最多連日':'3', '適用年級':'全校', '適用班級':'' },
      { '科目代碼':'走讀建成生活圈', '每週節數':'1', '同時最多班數':'0', '最多連日':'3', '適用年級':'7', '適用班級':'' },
      { '科目代碼':'文旅享繪', '每週節數':'1', '同時最多班數':'0', '最多連日':'3', '適用年級':'7', '適用班級':'' },
      { '科目代碼':'活力建成', '每週節數':'1', '同時最多班數':'0', '最多連日':'3', '適用年級':'全校', '適用班級':'' },
      { '科目代碼':'全球議題', '每週節數':'1', '同時最多班數':'0', '最多連日':'3', '適用年級':'7,8', '適用班級':'' },
      { '科目代碼':'建成公民行動家', '每週節數':'1', '同時最多班數':'0', '最多連日':'3', '適用年級':'8', '適用班級':'' },
      { '科目代碼':'文化種籽在建成', '每週節數':'1', '同時最多班數':'0', '最多連日':'3', '適用年級':'8', '適用班級':'' },
      { '科目代碼':'全球素養', '每週節數':'1', '同時最多班數':'0', '最多連日':'3', '適用年級':'9', '適用班級':'' },
      { '科目代碼':'英悅讀樂樂', '每週節數':'1', '同時最多班數':'0', '最多連日':'3', '適用年級':'9', '適用班級':'' },
      { '科目代碼':'閱思溝通建成人', '每週節數':'1', '同時最多班數':'0', '最多連日':'3', '適用年級':'9', '適用班級':'' },
      { '科目代碼':'藝統摺學', '每週節數':'1', '同時最多班數':'0', '最多連日':'3', '適用年級':'9', '適用班級':'' },
      { '科目代碼':'資優英語', '每週節數':'2', '同時最多班數':'0', '最多連日':'3', '適用年級':'全校', '適用班級':'' },
      { '科目代碼':'學習策略', '每週節數':'2', '同時最多班數':'0', '最多連日':'3', '適用年級':'全校', '適用班級':'' },
      { '科目代碼':'社會技巧', '每週節數':'1', '同時最多班數':'0', '最多連日':'3', '適用年級':'全校', '適用班級':'' },
      { '科目代碼':'視唱聽寫', '每週節數':'2', '同時最多班數':'0', '最多連日':'3', '適用年級':'全校', '適用班級':'707,807,808,907' },
      { '科目代碼':'音樂史與樂曲賞析', '每週節數':'2', '同時最多班數':'0', '最多連日':'3', '適用年級':'全校', '適用班級':'707,807,808,907' },
      { '科目代碼':'絲竹室內樂', '每週節數':'2', '同時最多班數':'0', '最多連日':'3', '適用年級':'全校', '適用班級':'707,807,808,907' },
      { '科目代碼':'術科', '每週節數':'2', '同時最多班數':'0', '最多連日':'3', '適用年級':'全校', '適用班級':'707,807,808,907' },
      { '科目代碼':'樂理', '每週節數':'2', '同時最多班數':'0', '最多連日':'3', '適用年級':'7', '適用班級':'707' },
      { '科目代碼':'基礎和聲', '每週節數':'2', '同時最多班數':'0', '最多連日':'3', '適用年級':'8', '適用班級':'807,808' },
      { '科目代碼':'音樂專題', '每週節數':'2', '同時最多班數':'0', '最多連日':'3', '適用年級':'9', '適用班級':'907' }
    ],
            assignments: [],
    schedule: [],
    teacherBlocks: [
      { '記錄ID':'B01','教師姓名':'T001','時段':'3-5','原因':'週三進修' },
      { '記錄ID':'B02','教師姓名':'T002','時段':'3-5','原因':'週三進修' },
    ],
    subjectRules: [
      { '規則ID':'R01','科目代碼':'週會','時段':'5-1','規則類型':'必排','備註':'固定' },
      { '規則ID':'R02','科目代碼':'體育','時段':'1-8','規則類型':'禁排','備註':'最後節不排體育' },
    ],
    subjectRelations: [],
    scheduleExceptions: [],
    blockGroups: [
      { '群組ID':'BG01', '群組名稱':'七年級聯課', '科目清單':'體育,班週會', '班級清單':'701,702,703' },
    ],
    settings: { '學校名稱':'建成國中', '學期代號':'114-1', '每日節數':'8' }
  };
}

// ============================================================
// 初始化入口
// ============================================================
window.addEventListener('DOMContentLoaded', async () => {
  restoreUIState();
  initTabs();
  activateMainTab(ui.activeTab);
  attachAllTeacherComboboxes();

  // 若無 GAS URL 則顯示設定彈窗
  if (!GAS_URL) {
    document.getElementById('__settingsModal').classList.add('show');
  }

  // 試算表連結與主要資料互不依賴，並行載入以縮短首屏等待。
  const sheetLinkPromise = initSheetLink();
  await loadAll();
  sheetLinkPromise.catch(error => console.warn('Sheet link load failed:', error));

  // 預設選第一個班級
  if (state.classes.length > 0 && !ui.selectedClass) {
    ui.selectedClass = state.classes[0]['班級代碼'];
    document.getElementById('sel-class').value = ui.selectedClass;
    renderClassTT(ui.selectedClass);
  }
  renderThirdClassSelect();
  renderThirdTeacherSelect();
  renderThirdRoomSelect();
  renderThirdTimetable();
});


// ============================================================
// 子頁籤切換（Sub-Tabs）
// ============================================================
function switchSubTab(group, key, btn) {
  const container = document.getElementById(`panel-${group}`);
  if (!container) return;
  container.querySelectorAll('.sub-panel').forEach(el => el.style.display = 'none');
  const target = document.getElementById(`subpanel-${group}-${key}`);
  if (target) target.style.display = 'block';

  // Config 子頁籤渲染
  if (group === 'config') {
    if (key === 'cls' && typeof renderClassConfigList === 'function') renderClassConfigList();
    if (key === 'tea' && typeof renderTeacherConfigList === 'function') renderTeacherConfigList();
    if (key === 'sub' && typeof renderSubjectConfigList === 'function') renderSubjectConfigList();
    if (key === 'asgn') {
      if (typeof renderAssignmentConfigList === 'function') renderAssignmentConfigList();
      if (typeof renderClassAssignmentView === 'function') renderClassAssignmentView();
      if (typeof renderTeacherAssignmentView === 'function') renderTeacherAssignmentView();
    }
    if (key === 'bind' && typeof renderBindGroupTab === 'function') renderBindGroupTab();
    if (key === 'color') {
      if (typeof renderColorSubjectChecks === 'function') renderColorSubjectChecks();
       if (typeof renderColorClassChecks === 'function') renderColorClassChecks();
       if (typeof renderColorPresets === 'function') renderColorPresets((document.getElementById('color-hex-text') || {}).value || 'DEEAF6');
      if (typeof renderColorTable === 'function') renderColorTable();
    }
  }

  // Constraints 子頁籤渲染
  if (group === 'constraints') {
    if (key === 'block') {
      if (typeof renderBlockTable === 'function') renderBlockTable();
      if (typeof renderBlockTeachers === 'function') renderBlockTeachers();
      if (typeof renderBlockSlotGrid === 'function') renderBlockSlotGrid();
    }
    if (key === 'rule') {
      if (typeof renderSubjectRuleTable === 'function') renderSubjectRuleTable();
    }
    if (key === 'exclusive') {
      if (typeof renderExclusiveTable === 'function') renderExclusiveTable();
      if (typeof renderExclusiveTeacherDropdowns === 'function') renderExclusiveTeacherDropdowns();
    }
    if (key === 'relation') {
      if (typeof renderSubjectRelationFormOptions === 'function') renderSubjectRelationFormOptions();
      if (typeof renderSubjectRelationTable === 'function') renderSubjectRelationTable();
    }
  }

  if (btn && btn.parentElement) {
    btn.parentElement.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
}


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


// ============================================================
// 🗑 清除排課
// ============================================================
function keepLockedScheduleEntries(schedule) {
  const source = Array.isArray(schedule) ? schedule : [];
  return source.filter(entry =>
    !isPatrolScheduleEntry(entry) &&
    ((isManualOnlyPeriod(entry['節次']) &&
      String(entry['課堂屬性'] || '').trim() !== '抽離') ||
      String(entry['是否鎖定'] || '').toUpperCase() === 'TRUE' ||
      isLockedConsecutiveScheduleEntry(entry, source))
  );
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
  return !!subjectCode && !!classCode && (state.subjectRules || []).some(rule =>
    String(rule['規則類型'] || '').trim() === '必排' &&
    getRuleSubjectCodes(rule).includes(subjectCode) &&
    ruleAppliesToClass(rule, classCode, grade)
  );
}

// 第二輪對應目前自動排課的第二階段：一般課程，不包含第一階段的必排與綁班。
function isSecondRoundScheduleEntry(entry) {
  return !isMandatoryScheduleEntryForClear(entry) && !isBindScheduleEntry(entry);
}

function isClearScopeTarget(entry, scope) {
  if (!entry || isClearFrozenScheduleEntry(entry) || isLockedConsecutiveScheduleEntry(entry)) return false;
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
  return (Array.isArray(state.schedule) ? state.schedule : []).filter(entry =>
    String(entry['是否鎖定'] || '').toUpperCase() === 'TRUE' ||
    isLockedConsecutiveScheduleEntry(entry, state.schedule) ||
    !isClearScopeTarget(entry, scope)
  );
}

function chooseClearScheduleScope() {
  const overlay = document.getElementById('__modal');
  document.getElementById('__modalTitle').textContent = '🗑 選擇清除範圍';
  document.getElementById('__modalMsg').innerHTML = '請選擇要清除的排課範圍。一般明確上鎖課程與其鎖定連排延伸格一律保留，全清沿用巡堂清除規則。';
  const actions = document.getElementById('__modalActions');
  actions.innerHTML = '';
  [
    { value: 'all', label: '全清', className: 'btn btn-danger', note: '保留一般明確上鎖課程及鎖定連排' },
    { value: 'second-round', label: '清除第二輪', className: 'btn btn-primary', note: '清除第1至7節一般課程，保留必排與綁班及第八節' },
    { value: 'period-8', label: '清除第八節', className: 'btn btn-primary', note: '清除第八節未鎖定課程' }
  ].forEach(option => {
    const button = document.createElement('button');
    button.className = option.className;
    button.textContent = option.label;
    button.title = option.note;
    button.onclick = () => {
      overlay.classList.remove('show');
      resolvePending(option.value);
    };
    actions.appendChild(button);
  });
  const cancel = document.createElement('button');
  cancel.className = 'btn btn-ghost';
  cancel.textContent = '取消';
  cancel.onclick = () => {
    overlay.classList.remove('show');
    resolvePending(null);
  };
  actions.appendChild(cancel);
  overlay.classList.add('show');
  overlay.onclick = event => {
    if (event.target === overlay) {
      overlay.classList.remove('show');
      resolvePending(null);
    }
  };
  return pendingPromise();
}

async function clearUnlockedSchedule() {
  const scope = await chooseClearScheduleScope();
  if (!scope) return;

  const nextSchedule = getClearedSchedule(scope);
  const totalCount = state.schedule.length;
  const clearCount = totalCount - nextSchedule.length;
  const lockedCount = nextSchedule.filter(entry =>
    String(entry['是否鎖定'] || '').toUpperCase() === 'TRUE' || isLockedConsecutiveScheduleEntry(entry, state.schedule)
  ).length;
  const scopeLabels = {
    all: '全清（保留一般明確上鎖課程及鎖定連排）',
    'second-round': '第二輪（第1至7節一般課程，保留必排與綁班及第八節）',
    'period-8': '第八節（只清除第八節未鎖定課程）'
  };

  if (clearCount === 0) {
    showModal('清除排課', `目前沒有符合「${scopeLabels[scope]}」的可清除課程。`, 'info');
    return;
  }

  const ok = await showModal('確認清除排課',
    `清除方式：${scopeLabels[scope]}<br><br>` +
    `📊 總課程數：${totalCount} 節<br>` +
     `🔒 保留鎖課／連排：${lockedCount} 節<br>` +
    `🗑 將清除：${clearCount} 節`,
    'confirm',
    '確認清除',
    '取消'
  );
  if (!ok) return;

  showLoading(true);
  state.schedule = nextSchedule;
  buildIndex();
  if (ui.selectedClass) renderClassTT(ui.selectedClass);
  if (ui.selectedTeacher) renderTeacherTT(ui.selectedTeacher);
  showLoading(false);
  toast(`🗑 ${scopeLabels[scope]}：已清除 ${clearCount} 節課程`, 'success');

  gasPost('batchUpdateSchedule', {
    schedule: state.schedule,
    baseRevision: state.scheduleRevision,
    clearScope: scope,
    clearKeepLockedOnly: scope === 'all',
    allowSoftTeacherExclusives: true,
    manualSoftWarnings: true
  })
    .then(res => {
      if (res && !res.ok) {
        toast(res.error || '雲端稽核拒絕寫入，已重新載入課表', 'warning');
        loadAll();
        return;
      }
      applyScheduleRevisionResponse(res);
      console.log('Clear schedule synced:', scope);
    })
    .catch(err => console.error('Clear sync error:', err));
}

// ============================================================
// 🤖 智慧自動排課引擎 (Automated Constraint-Satisfaction Solver)
// ============================================================

function openAutoScheduleModal() {
  try {
    const savedTeachers = localStorage.getItem('auto_priority_teachers') || '';
    const savedSubjects = localStorage.getItem('auto_priority_subjects') || '';
    const teacherInput = document.getElementById('auto-priority-teachers');
    const subjectInput = document.getElementById('auto-priority-subjects');
    if (teacherInput && !teacherInput.value) teacherInput.value = savedTeachers;
    if (subjectInput && !subjectInput.value) subjectInput.value = savedSubjects;
  } catch (error) {
    console.warn('[AutoSchedule] 優先排序設定讀取失敗：', error);
  }
  document.getElementById('__autoModal').classList.add('show');
}

function closeAutoScheduleModal() {
  document.getElementById('__autoModal').classList.remove('show');
}

async function executeAutoScheduleCore(runOptions = {}) {
  const previewOnly = runOptions.previewOnly === true;
  const getAutoScheduleIdentity = entry => {
    const id = String(entry?.['課表ID'] || '').trim();
    if (id) return 'id:' + id;
    return 'row:' + JSON.stringify([
      String(entry?.['班級代碼'] || ''), String(entry?.['星期'] || ''), String(entry?.['節次'] || ''),
      String(entry?.['科目代碼'] || ''), String(entry?.['教師姓名'] || ''), String(entry?.['課堂屬性'] || '')
    ]);
  };
  const originalSchedule = JSON.parse(JSON.stringify(state.schedule || []));
  const originalScheduleIds = [...new Set(originalSchedule
    .map(entry => String(entry?.['課表ID'] || '').trim())
    .filter(Boolean))];
  const originalScheduleKeys = new Set(originalSchedule.map(getAutoScheduleIdentity));
  const isOriginalAutoScheduleEntry = entry => originalScheduleKeys.has(getAutoScheduleIdentity(entry));
  const configuredBindMembersCache = new Map();
  const getConfiguredBindMembersForRun = group => {
    if (!configuredBindMembersCache.has(group)) configuredBindMembersCache.set(group, getConfiguredBindMembers(group));
    return configuredBindMembersCache.get(group);
  };
  const bindGroupClassesCache = new Map();
  const getBindGroupClasses = (subjectCode, classCode) => {
    const targetSubject = String(subjectCode || '').trim();
    const targetClass = String(classCode || '').trim();
    const cacheKey = targetSubject + '|' + targetClass;
    if (bindGroupClassesCache.has(cacheKey)) return bindGroupClassesCache.get(cacheKey);
    let result = null;
    for (const group of state.blockGroups || []) {
      const members = getConfiguredBindMembersForRun(group);
      const byClass = new Map();
      members.forEach(member => {
        if (!byClass.has(member.classCode)) byClass.set(member.classCode, []);
        byClass.get(member.classCode).push(member);
      });
      const targetMembers = byClass.get(targetClass) || [];
      const targetIndex = targetMembers.findIndex(member => member.subjectCode === targetSubject);
      if (targetIndex < 0) continue;
      const cohort = [...byClass.values()].map(items => items[targetIndex]).filter(Boolean);
      if (cohort.length >= 2) {
        result = [...new Set(cohort.map(member => member.classCode))];
        break;
      }
    }
    bindGroupClassesCache.set(cacheKey, result);
    return result;
  };
  const autoScheduleStartedAt = Date.now();
  const requestedTimeBudget = Number(runOptions.timeBudgetMs);
  const autoScheduleTimeBudgetMs = Number.isFinite(requestedTimeBudget) && requestedTimeBudget > 0
    ? Math.max(10000, Math.floor(requestedTimeBudget))
    : (previewOnly ? 120000 : 300000);
  const autoScheduleDeadline = autoScheduleStartedAt + autoScheduleTimeBudgetMs;
  let autoScheduleTimedOut = false;
  let autoScheduleQualityGraceActive = false;
  let autoScheduleQualityDeadline = autoScheduleDeadline;
  let repairBudgetExceeded = false;
  let repairOperationCount = 0;
  let repairOperationLimit = 0;
  let repairOperationReserve = 0;
  let repairGlobalReserveMs = 0;
  let neighborhoodRepairMoves = 0;
  let globalMatchingPasses = 0;
  let conflictGraphMoves = 0;
  const conflictGraphStats = { searches: 0, nodes: 0, candidates: 0 };
  const neighborhoodRepairStats = {
    attempts: 0,
    maxItems: 0,
    searchNodes: 0,
    candidateWipeouts: 0,
    searchFailures: 0,
    successes: 0
  };
  let localOptimizationCandidates = 0;
  let localOptimizationAttemptedMoves = 0;
  let localOptimizationRollbacks = 0;
  const autoTightClassCodes = new Set();
  const shouldStopAutoSchedule = phase => {
    const phaseName = String(phase || '排課');
    const isQualityPhase = autoScheduleQualityGraceActive &&
      (phaseName === 'local-optimization' || phaseName === 'subject-relation-optimization');
    if (autoScheduleTimedOut && !isQualityPhase) return true;
    const phaseDeadline = isQualityPhase ? autoScheduleQualityDeadline : autoScheduleDeadline;
    if (Date.now() < phaseDeadline) return false;
    autoScheduleTimedOut = true;
    console.warn('[AutoSchedule] 時間預算已用盡：' + phaseName + '，保留目前最佳合法課表。');
    if (typeof updateProgress === 'function') updateProgress('時間預算已用盡，正在保留目前最佳合法課表…');
    return true;
  };
  const autoScheduleProfile = runOptions.profile === true
    ? { startedAt: autoScheduleStartedAt, current: 'prepare', phaseStartedAt: autoScheduleStartedAt, phases: {} }
    : null;
  const markAutoScheduleProfile = phase => {
    if (!autoScheduleProfile) return;
    const now = Date.now();
    autoScheduleProfile.phases[autoScheduleProfile.current] =
      (autoScheduleProfile.phases[autoScheduleProfile.current] || 0) + now - autoScheduleProfile.phaseStartedAt;
    autoScheduleProfile.current = phase;
    autoScheduleProfile.phaseStartedAt = now;
  };
  const readAutoScheduleProfile = () => {
    if (!autoScheduleProfile) return null;
    const now = Date.now();
    const phases = { ...autoScheduleProfile.phases };
    phases[autoScheduleProfile.current] =
      (phases[autoScheduleProfile.current] || 0) + now - autoScheduleProfile.phaseStartedAt;
    return { phases, totalMs: now - autoScheduleProfile.startedAt };
  };
  const formatAutoScheduleElapsed = () => {
    const elapsedSeconds = Math.max(0, (Date.now() - autoScheduleStartedAt) / 1000);
    if (elapsedSeconds < 60) return elapsedSeconds.toFixed(2) + ' 秒';
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = (elapsedSeconds - minutes * 60).toFixed(2).padStart(5, '0');
    return minutes + ' 分 ' + seconds + ' 秒';
  };
  closeAutoScheduleModal();
  const preflightIssues = collectAutoSchedulePreflightIssues();
  const preflightTightClasses = typeof window !== 'undefined'
    ? (window.__lastAutoSchedulePreflight?.bottlenecks?.tightClasses || [])
    : [];
  preflightTightClasses.forEach(item => autoTightClassCodes.add(String(item.classCode || '')));
  if (preflightIssues.length > 0 && !runOptions.skipPreflight && !previewOnly) {
    const detail = preflightIssues.slice(0, 12).map(issue => '• ' + esc(issue)).join('<br>');
    const more = preflightIssues.length > 12 ? '<br>另有 ' + (preflightIssues.length - 12) + ' 項' : '';
    const confirmed = await showModal(
      '⚠️ 排課前設定健檢',
      '系統發現以下設定可能互相矛盾：<br><br>' + detail + more + '<br><br>仍要繼續自動排課嗎？',
      'confirm',
      '繼續排課',
      '取消'
    );
    if (!confirmed) return;
  }
  showLoading(true, '準備排課資料…');
  if (!previewOnly) toast('🤖 智慧大師級自動排課運算中...', 'info');

  let autoStartPeriod   = parseInt(document.getElementById('auto-period-start')?.value || '1', 10);
  let autoEndPeriod     = parseInt(document.getElementById('auto-period-end')?.value || '7', 10);
  if (isManualOnlyPeriod(autoStartPeriod)) autoStartPeriod = 1;
  if (isManualOnlyPeriod(autoEndPeriod)) autoEndPeriod = 7;
  if (!Number.isFinite(autoStartPeriod) || autoStartPeriod < 1 || autoStartPeriod > 8) autoStartPeriod = 1;
  if (!Number.isFinite(autoEndPeriod) || autoEndPeriod < 1 || autoEndPeriod > 8) autoEndPeriod = 7;

  const optOnePerDay      = true;
  const optMorningCore    = document.getElementById('auto-opt-morning-core')?.checked ?? true;
  const optTeacherConsec  = document.getElementById('auto-opt-teacher-consec')?.checked ?? true;

  const optSmartSwap      = document.getElementById('auto-opt-smart-swap')?.checked ?? true;
  const optRandomize      = runOptions.randomize !== undefined
    ? Boolean(runOptions.randomize)
    : (document.getElementById('auto-opt-randomize')?.checked ?? false);
  const optP8Only         = document.getElementById('auto-opt-p8-only')?.checked ?? false;
  const priorityTeacherInput = String(document.getElementById('auto-priority-teachers')?.value || '').trim();
  const prioritySubjectInput = String(document.getElementById('auto-priority-subjects')?.value || '').trim();
  const parsePriorityTokens = value => [...new Set(String(value || '').split(/[,，、;；\n]/).map(token => token.trim()).filter(Boolean))];
  const priorityTeacherTokens = new Set(parsePriorityTokens(priorityTeacherInput));
  const prioritySubjectTokens = new Set(parsePriorityTokens(prioritySubjectInput));
  try {
    if (priorityTeacherInput) localStorage.setItem('auto_priority_teachers', priorityTeacherInput);
    else localStorage.removeItem('auto_priority_teachers');
    if (prioritySubjectInput) localStorage.setItem('auto_priority_subjects', prioritySubjectInput);
    else localStorage.removeItem('auto_priority_subjects');
  } catch (error) {
    console.warn('[AutoSchedule] 優先排序設定儲存失敗：', error);
  }

  const randomSeedInput = runOptions.seed !== undefined
    ? String(runOptions.seed)
    : String(document.getElementById('auto-random-seed')?.value || '').trim();
  const parsedRandomSeed = Number.parseInt(randomSeedInput, 10);
  let randomState = Number.isFinite(parsedRandomSeed) ? (parsedRandomSeed >>> 0) : (Date.now() >>> 0);
  const nextAutoRandom = () => {
    randomState = (randomState * 1664525 + 1013904223) >>> 0;
    return randomState / 4294967296;
  };
  const AUTO_RANDOM_TOP_K = optRandomize ? 7 : 3;
  const AUTO_RANDOM_SCORE_TOLERANCE = optRandomize ? 8 : 3;
  const autoRandomTieBreak = () => optRandomize ? nextAutoRandom() : 0.5;
  const compareAutoCandidates = (left, right) => {
    const scoreDelta = (Number(right.score) || 0) - (Number(left.score) || 0);
    if (scoreDelta !== 0) return scoreDelta;
    return (Number(left.tieBreak) || 0.5) - (Number(right.tieBreak) || 0.5);
  };
  const getAutoCandidateSlot = candidate => ({
    day: candidate?.day ?? candidate?.dayR,
    period: candidate?.per ?? candidate?.perR ?? candidate?.period
  });
  const prioritizeAutoCandidates = (candidates, relationLessons = null, relationContextFactory = null, comparator = compareAutoCandidates) => {
    if (!Array.isArray(candidates) || candidates.length === 0) return [];
    const lessons = Array.isArray(relationLessons)
      ? relationLessons.filter(Boolean)
      : (relationLessons ? [relationLessons] : []);
    let prioritized = candidates.slice();
    if (lessons.length > 0 && typeof getSubjectRelationViolationCount === 'function') {
      const relationFree = prioritized.filter(candidate => {
        const context = typeof relationContextFactory === 'function'
          ? relationContextFactory(candidate)
          : null;
        const targetSchedule = context?.schedule || localSchedule;
        const targetLookup = context?.lookup || null;
        const { day, period } = getAutoCandidateSlot(candidate);
        return lessons.reduce((sum, lesson) => sum + getSubjectRelationViolationCount(
          lesson,
          day,
          period,
          targetSchedule,
          targetLookup
        ), 0) === 0;
      });
      // 科目關係仍是軟限制，但只要存在關係乾淨的合法候選，就優先選擇乾淨候選。
      if (relationFree.length > 0) prioritized = relationFree;
    }
    return prioritized.sort(comparator);
  };
  const selectAutoCandidate = (candidates, relationLessons = null) => {
    const prioritized = prioritizeAutoCandidates(candidates, relationLessons);
    if (prioritized.length === 0) return null;
    if (!optRandomize || prioritized.length === 1) return prioritized[0];
    const topScore = Number(prioritized[0].score) || 0;
    const frontier = prioritized
      .slice(0, AUTO_RANDOM_TOP_K)
      .filter(candidate => topScore - (Number(candidate.score) || 0) <= AUTO_RANDOM_SCORE_TOLERANCE);
    return frontier[Math.floor(nextAutoRandom() * frontier.length)] || prioritized[0];
  };

  // 分階段排課模式：all=全量，phase1=只排必排+綁班，phase2=只補排一般課
  const autoMode = document.querySelector('input[name="auto-mode"]:checked')?.value ?? 'all';

  if (optP8Only) {
    autoStartPeriod = 8;
    autoEndPeriod   = 8;
  }

  const coreSubjects = new Set(['國文', '數學', '英語', '理化', '生物', '自然', '歷史', '地理', '公民']);
  const activitySubjects = new Set(['體育', '音樂', '視覺藝術', '表演藝術', '家政', '童軍', '資訊科技', '生活科技', '走讀建成生活圈', '文旅享繪', '活力建成']);
  const autoTeacherCodesCache = new Map();
  const autoTeacherCodesObjectCache = new WeakMap();
  const getAutoTeacherCodes = value => {
    const isObject = value && typeof value === 'object';
    if (isObject && autoTeacherCodesObjectCache.has(value)) return autoTeacherCodesObjectCache.get(value);
    const stringKey = isObject ? '' : String(value ?? '');
    if (!isObject && autoTeacherCodesCache.has(stringKey)) return autoTeacherCodesCache.get(stringKey);
    const values = Array.isArray(value) ? value : [value];
    const codes = [];
    values.forEach(item => {
      const cell = item && typeof item === 'object' ? item : { '教師姓名': item };
      const parsed = getCellTeacherCodes(cell);
      if (parsed.length > 0) {
        codes.push(...parsed);
        return;
      }
      const fallback = item && typeof item === 'object' ? item['教師姓名'] : item;
      String(fallback || '').split(/[,，、;；]/).forEach(token => {
        const code = String(token || '').trim();
        if (code) codes.push(code);
      });
    });
    const result = [...new Set(codes)];
    if (isObject) autoTeacherCodesObjectCache.set(value, result);
    else autoTeacherCodesCache.set(stringKey, result);
    return result;
  };
  const autoTeacherIdentityCache = new Map();
  const resolveAutoTeacherCodes = value => {
    const codes = getAutoTeacherCodes(value);
    const key = codes.join('|');
    if (!autoTeacherIdentityCache.has(key)) {
      const resultSet = new Set(codes);
      codes.forEach(code => {
        const teacher = idx.teacherByCode[code];
        const name = teacher ? (teacher['教師姓名'] || teacher['姓名']) : '';
        if (name) resultSet.add(name);
        (state.teachers || []).forEach(t => {
          if ((t['教師姓名'] || t['姓名']) === code && t['教師姓名']) resultSet.add(t['教師姓名']);
        });
      });
      autoTeacherIdentityCache.set(key, [...resultSet]);
    }
    return autoTeacherIdentityCache.get(key);
  };
  const autoTeacherBlockCounts = new Map();
  idx.blockSet.forEach(slotKey => {
    const separator = String(slotKey).indexOf('|');
    if (separator <= 0) return;
    const teacherCode = String(slotKey).slice(0, separator);
    autoTeacherBlockCounts.set(teacherCode, (autoTeacherBlockCounts.get(teacherCode) || 0) + 1);
  });
  const getAutoTeacherConstraintScore = value => {
    const identities = new Set(resolveAutoTeacherCodes(value));
    return [...identities].reduce((total, identity) => total + (autoTeacherBlockCounts.get(identity) || 0), 0);
  };
  const autoTeacherMatches = (cell, teacherValue) => {
    const wanted = resolveAutoTeacherCodes(teacherValue);
    const actual = resolveAutoTeacherCodes(cell);
    // 協同配課必須主教師與每位協同教師都存在，不能只命中其中一位就算完成。
    return wanted.length > 0 && wanted.every(code => actual.includes(code));
  };
  const canonicalAutoTeacherCode = value => {
    const identities = resolveAutoTeacherCodes(value);
    const teacher = identities.map(code => idx.teacherByCode[code]).find(Boolean);
    return teacher ? String(teacher['教師姓名'] || teacher['姓名'] || identities[0] || '') : String(identities[0] || '');
  };
  const autoTeacherInput = lesson => lesson.teacherCodes?.length ? lesson.teacherCodes : lesson.teacherCode;
  const getAutoClassGrade = classCode => {
    const cls = idx.classByCode[String(classCode)] || null;
    return String(cls?.['年級'] || String(classCode || '').charAt(0)).trim();
  };
  const autoTeacherValue = lesson => {
    if (lesson.teacherValue !== undefined) return lesson.teacherValue;
    const codes = getAutoTeacherCodes(lesson.teacherCode);
    return codes.length > 1 ? codes : (codes[0] || '');
  };
  const getAutoManualPriorityScore = (subjectCode, teacherValue) => {
    const subjectPriority = prioritySubjectTokens.has(String(subjectCode || '').trim()) ? 2 : 0;
    const teacherPriority = resolveAutoTeacherCodes(teacherValue)
      .some(identity => priorityTeacherTokens.has(String(identity).trim())) ? 2 : 0;
    return subjectPriority + teacherPriority;
  };
  const autoTeacherExclusivePeers = new Map();
  const addAutoTeacherExclusivePeers = (sourceCodes, peerCodes) => {
    sourceCodes.forEach(source => {
      if (!autoTeacherExclusivePeers.has(source)) autoTeacherExclusivePeers.set(source, new Set());
      peerCodes.forEach(peer => autoTeacherExclusivePeers.get(source).add(peer));
    });
  };
  (state.teacherExclusives || []).forEach(rule => {
    const teacherA = resolveAutoTeacherCodes(rule['教師A']);
    const teacherB = resolveAutoTeacherCodes(rule['教師B']);
    addAutoTeacherExclusivePeers(teacherA, teacherB);
    addAutoTeacherExclusivePeers(teacherB, teacherA);
  });
  const getSubjectRoomCode = subjectCode => String(idx.subjectByCode[String(subjectCode)]?.['所屬教室代碼'] || '').trim();
  const getSubjectRoomCapacity = subjectCode => {
    const roomCode = getSubjectRoomCode(subjectCode);
    const room = roomCode ? idx.roomByCode[roomCode] : null;
    return Math.max(1, parseInt(room?.['容量'] || '1', 10) || 1);
  };
  const weeklyTargetByClassSubject = new Map();
  const parseAutoBindList = value => {
    if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
    if (typeof value === 'number') return String(value).match(/.{3}/g) || [];
    return String(value || '').split(/[,，、;；]/).map(item => item.trim()).filter(Boolean);
  };
  const getAutoBindSubjects = group => parseAutoBindList(group?.['科目清單'] || group?.['科目代碼']);
  const getAutoBindClasses = group => parseAutoBindList(group?.['班級清單']);
  const getAutoBindMembers = group => getConfiguredBindMembersForRun(group);
  const getAutoBindMemberKey = (classCode, subjectCode) => String(classCode || '').trim() + '|' + String(subjectCode || '').trim();
  const activeAssignments = (state.assignments || []).filter(assignment => !isPreplannedCourse(assignment['課程屬性']));
  const assignmentWeeklyByClassSubject = buildAutoAssignmentWeeklyIndex(activeAssignments, idx.subjectByCode);
  const expandAutoBindGroupCohorts = group => {
    const members = getAutoBindMembers(group);
    const byClass = new Map();
    members.forEach(member => {
      if (!byClass.has(member.classCode)) byClass.set(member.classCode, []);
      byClass.get(member.classCode).push(member);
    });
    const maxCohorts = Math.max(0, ...[...byClass.values()].map(items => items.length));
    const parentId = String(group['群組ID'] || group['群組名稱'] || '');
    const cohorts = [];
    for (let cohortIndex = 0; cohortIndex < maxCohorts; cohortIndex++) {
      const cohortMembers = [...byClass.values()].map(items => items[cohortIndex]).filter(Boolean);
      if (cohortMembers.length < 2) continue;
      cohorts.push({
        ...group,
        '群組ID': parentId + '|C' + cohortIndex,
        '群組名稱': String(group['群組名稱'] || parentId) + '／第' + (cohortIndex + 1) + '組',
        '科目清單': [...new Set(cohortMembers.map(member => member.subjectCode))].join(','),
        '班級清單': [...new Set(cohortMembers.map(member => member.classCode))].join(','),
        __bindParentGroup: group,
        __bindCohortIndex: cohortIndex
      });
    }
    return cohorts;
  };
  const getAssignmentWeeklyForBind = (classCode, subjectCode) => {
    return assignmentWeeklyByClassSubject.get(String(classCode || '').trim() + '|' + String(subjectCode || '').trim()) || 0;
  };
  const bindWeeklyMismatchByKey = new Map();
  const bindDefinitionErrors = [];
  const invalidBindGroups = new Set();
  (state.blockGroups || []).forEach(group => {
    const groupSubjects = [...new Set(getAutoBindSubjects(group))];
    const groupClasses = getAutoBindClasses(group);
    if (groupSubjects.length === 0 || groupClasses.length < 2) return;
    const weeklyByClass = groupClasses.map(classCode => ({
      classCode,
      weekly: groupSubjects.reduce((total, subjectCode) => total + getAssignmentWeeklyForBind(classCode, subjectCode), 0)
    }));
    if (!weeklyByClass.some(item => item.weekly > 0)) return;
    const weeklyValues = new Set(weeklyByClass.map(item => item.weekly));
    if (weeklyValues.size <= 1) return;
    const groupKey = String(group['群組ID'] || group['群組名稱'] || groupClasses.join(','));
    const detail = weeklyByClass.map(item => item.classCode + '：' + item.weekly + ' 節').join('、');
    bindDefinitionErrors.push('綁班「' + groupKey + '」各班合計每週節數不一致：' + detail);
    invalidBindGroups.add(group);
    groupClasses.forEach(classCode => groupSubjects.forEach(subjectCode => {
      bindWeeklyMismatchByKey.set(String(classCode) + '|' + subjectCode, true);
    }));
  });
  // 同一科目與年級會在候選時段評估中查詢數百次；一次展開後重用。
  const applicableRuleCache = new Map();
  const applicableSubjectRelationCache = new Map();
  const AUTO_SUBJECT_RELATION_PENALTY = 120;
  const normalizeAutoSubjectCode = value => String(value || '').trim();
  const normalizeAutoRuleType = value => String(value || '').trim();
  const isMandatoryAutoRule = rule => normalizeAutoRuleType(rule?.['規則類型']) === '必排';
  const isForbiddenAutoRule = rule => normalizeAutoRuleType(rule?.['規則類型']) === '禁排';
  function getApplicableRules(subjectCode, classCode) {
    const cls = idx.classByCode[String(classCode)] || null;
    const grade = cls ? String(cls['年級'] || String(classCode || '').charAt(0)).trim() : String(classCode || '').charAt(0);
    const normalizedSubjectCode = normalizeAutoSubjectCode(subjectCode);
    const normalizedClassCode = String(classCode || '').trim();
    const key = normalizedSubjectCode + '|' + normalizedClassCode + '|' + grade;
    if (!applicableRuleCache.has(key)) {
      const entries = state.subjectRules
        .filter(rule => {
          return getRuleSubjectCodes(rule).includes(normalizedSubjectCode) &&
            ruleAppliesToClass(rule, normalizedClassCode, grade);
        })
        .map(rule => ({ rule, slots: getRuleDaysPeriods(rule) }));
      applicableRuleCache.set(key, entries);
    }
    return applicableRuleCache.get(key);
  }
  const getApplicableSubjectRelations = (subjectCode, classCode) => {
    const normalizedSubjectCode = normalizeAutoSubjectCode(subjectCode);
    const normalizedClassCode = String(classCode || '').trim();
    const cls = idx.classByCode[normalizedClassCode] || null;
    const grade = cls ? String(cls['年級'] || normalizedClassCode.charAt(0)).trim() : normalizedClassCode.charAt(0);
    const key = normalizedSubjectCode + '|' + normalizedClassCode + '|' + grade;
    if (!applicableSubjectRelationCache.has(key)) {
      const entries = (idx.subjectRelationsBySubject?.[normalizedSubjectCode] || [])
        .filter(relation => subjectRelationAppliesToClass(relation, normalizedClassCode, grade))
        .map(relation => ({ relation, otherSubjectCode: getSubjectRelationOtherCode(relation, normalizedSubjectCode) }))
        .filter(entry => entry.otherSubjectCode);
      applicableSubjectRelationCache.set(key, entries);
    }
    return applicableSubjectRelationCache.get(key);
  };
  const getSubjectRelationViolationCount = (lesson, day, period, targetSchedule = localSchedule, targetLookup = null) => {
    if (!lesson || !Number.isFinite(Number(day))) return 0;
    const relationLookup = targetLookup || buildScheduleLookup(targetSchedule);
    return getApplicableSubjectRelations(lesson.subjectCode, lesson.classCode)
      .filter(entry => (relationLookup.classSubjectDays.get(
        String(lesson.classCode) + '|' + entry.otherSubjectCode + '|' + day
      ) || 0) > 0).length;
  };
  const getAutoSubjectConstraintScore = (subjectCode, subject, classCode, maxConsecDays) => {
    const maxConcurrent = parseInt(subject?.['同時最多班數'] || '0', 10) || 0;
     const weekly = getSubjectWeeklyValue(subject, 0);
    const roomCode = String(subject?.['所屬教室代碼'] || '').trim();
    const rules = getApplicableRules(subjectCode, classCode);
    const ruleScore = rules.reduce((sum, entry) => {
      if (isMandatoryAutoRule(entry.rule)) return sum + 4;
      if (isForbiddenAutoRule(entry.rule)) return sum + 3;
      return sum + 1;
    }, 0);
    let score = 0;
    if (maxConsecDays > 0 && maxConsecDays < 5) score += (5 - maxConsecDays) * 4;
    if (maxConcurrent > 0) score += Math.max(1, 6 - Math.min(maxConcurrent, 5)) * 3;
    if (roomCode) score += 2;
    if (weekly > 4) score += Math.min(6, weekly - 4);
    return score + Math.min(16, ruleScore);
  };

  // 「全量自動」會真正重建所選範圍內的未凍結課程，避免只補洞而被舊排法卡死。
  // 分階段模式則保留手動調整結果：第一階段只重建必排與綁班，第二階段只補一般課。
    const alternateClassSubjectKeys = new Set(activeAssignments
     .filter(assignment => isAlternateWeeklyValue(getAssignmentWeeklyValue(assignment, idx.subjectByCode?.[String(assignment['科目代碼'] || '').trim()], 3)))
     .map(assignment => String(assignment['班級代碼'] || '').trim() + '|' + String(assignment['科目代碼'] || '').trim()));
   const isAlternateWeekScheduleEntry = entry => {
     const attr = String(entry?.['課堂屬性'] || '').trim();
     return parseInt(entry?.['節次'], 10) === 8 && (attr === '單週' || attr === '雙週');
   };
   const isAlternateClassSubject = (classCode, subjectCode) => alternateClassSubjectKeys.has(
     String(classCode || '').trim() + '|' + String(subjectCode || '').trim()
   );
   const isEntryInsideAutoRange = entry => {
     const period = parseInt(entry?.['節次'], 10);
     if (!Number.isFinite(period) || isManualOnlyPeriod(period) || period < autoStartPeriod || period > autoEndPeriod) return false;
      const helper = String(entry?.['科目代碼'] || '').trim().endsWith('輔');
     const alternate = isAlternateWeekScheduleEntry(entry) || isAlternateClassSubject(entry?.['班級代碼'], entry?.['科目代碼']);
     if (optP8Only) return period === 8 && (helper || alternate);
     if (period === 8) return autoEndPeriod >= 8 && (helper || alternate);
     return !helper && !alternate && period <= 7;
  };
  const entryHasMandatoryRule = entry => getApplicableRules(
    String(entry?.['科目代碼'] || ''),
    String(entry?.['班級代碼'] || '')
  ).some(item => isMandatoryAutoRule(item.rule));
  const shouldRebuildExistingEntry = entry => {
     if (!isEntryInsideAutoRange(entry) || isPreplannedScheduleEntry(entry) || isFrozenScheduleEntry(entry) || isLockedConsecutiveScheduleEntry(entry, state.schedule)) return false;
    if (autoMode === 'all') return true;
    if (autoMode === 'phase1') {
      return !!getBindGroupClasses(entry['科目代碼'], entry['班級代碼']) || entryHasMandatoryRule(entry);
    }
    return false;
  };
  const scheduleSeed = state.schedule.filter(entry => !shouldRebuildExistingEntry(entry));
  const scheduleEntriesByClassSubject = buildAutoScheduleEntriesByClassSubject(scheduleSeed);
  const rebuiltExistingCount = state.schedule.length - scheduleSeed.length;
  if (rebuiltExistingCount > 0) {
    console.log('[AutoSchedule] 重新最佳化 ' + rebuiltExistingCount + ' 節未凍結課程。');
  }

  // 1. 統計所有配課中，剩餘未安排的課程 tokens
  let pendingLessons = [];

  activeAssignments.forEach(asgn => {
    const classCode   = String(asgn['班級代碼']);
    const subjectCode = normalizeAutoSubjectCode(asgn['科目代碼']);
    const teacherCode = String(asgn['教師姓名']);
    const sub         = idx.subjectByCode[subjectCode];
    const cls         = idx.classByCode[classCode];
    const isVirtual   = cls && cls['是否虛擬班'] === 'TRUE';

     const totalWeekly = getAssignmentWeeklyValue(asgn, sub, 3);
     const isAlternateWeek = isAlternateWeeklyValue(totalWeekly);
     const isP8Lesson = isAlternateWeek || isHelperSubjectCode(subjectCode);
    const classSubjectKey = classCode + '|' + subjectCode;
    weeklyTargetByClassSubject.set(classSubjectKey, (weeklyTargetByClassSubject.get(classSubjectKey) || 0) + totalWeekly);

      const existingCount = (scheduleEntriesByClassSubject.get(classSubjectKey) || [])
        .filter(entry => !isPreplannedScheduleEntry(entry) && (!teacherCode || autoTeacherMatches(entry, teacherCode)))
        .reduce((total, entry) => total + getScheduleWeeklyUnits(entry), 0);

    // 配課完成度必須以「班級＋科目＋教師」核對；否則同班同科目由不同教師授課時，會誤算成已排。
     const remainingNeeded = Math.max(0, totalWeekly - existingCount);
     const lessonCount = isAlternateWeek
       ? (remainingNeeded > 0.000001 ? 1 : 0)
       : Math.ceil(Math.max(0, remainingNeeded) - 0.000001);
    const maxConsecDays = parseSubjectMaxConsecutiveDays(sub);

    // 計算教師限制分數（解析代碼與姓名，限制越多越優先）
    const teacherConstraintScore = getAutoTeacherConstraintScore(teacherCode);

    // 計算教師可用時段數量（越少越難排，優先處理）
    let teacherAvailableSlots = 5 * (autoEndPeriod - autoStartPeriod + 1);
    if (teacherCode) {
      const teacherIdentities = new Set(resolveAutoTeacherCodes(teacherCode));
      teacherAvailableSlots = 0;
      for (let d = 1; d <= 5; d++) {
        for (let p = autoStartPeriod; p <= autoEndPeriod; p++) {
          const teacherSlotKeys = [...teacherIdentities].map(identity => identity + '|' + d + '|' + p);
          const blocked = teacherSlotKeys.some(slotKey => idx.blockSet.has(slotKey));
          const hasConflict = teacherSlotKeys.some(tk => (idx.schedByTeacherSlot[tk] || []).length > 0);
          if (!blocked && !hasConflict) teacherAvailableSlots++;
        }
      }
    }
    // 檢查此科目是否有必排規則（依班級年級過濾）
    const mustRulesForClass = getApplicableRules(subjectCode, classCode)
      .filter(entry => isMandatoryAutoRule(entry.rule));
    const hasMustRule = mustRulesForClass.length > 0;
    const mustRuleSlots = [];
    mustRulesForClass.forEach(entry => {
      entry.slots.forEach(({day, period}) => mustRuleSlots.push({day, per: period}));
    });
    const subjectConstraintScore = getAutoSubjectConstraintScore(subjectCode, sub, classCode, maxConsecDays);
    const priorityScore = getAutoManualPriorityScore(subjectCode, teacherCode);
     for (let i = 0; i < lessonCount; i++) {
       pendingLessons.push({
        id: `auto_${classCode}_${subjectCode}_${i}`,
        classCode,
        subjectCode,
        teacherCode,
        teacherCodes: getAutoTeacherCodes(teacherCode),
        teacherValue: getAutoTeacherCodes(teacherCode).length > 1 ? getAutoTeacherCodes(teacherCode) : teacherCode,
         totalWeekly,
         weeklyUnit: isAlternateWeek ? 0.5 : 1,
         isAlternateWeek,
         isP8Lesson,
        maxConsecDays,
        subjectConstraintScore,
        priorityScore,
        isVirtual,
        isCore: coreSubjects.has(subjectCode),
        isActivity: activitySubjects.has(subjectCode),
        teacherConstraintScore,
         teacherAvailableSlots,
         hasMustRule,
         mustRuleSlots,
         randomOrder: autoRandomTieBreak()
       });
    }
  });

  // 科目屬性判斷
  const isHelperSubject = (code) => String(code || '').trim().endsWith('輔');

  // 1-7 節模式：不把第八節課程放進排課；第八節專用模式同時處理課輔與 0.5 節單雙週課程。
  if (optP8Only) {
    pendingLessons = pendingLessons.filter(l => l.isP8Lesson);
  } else if (autoEndPeriod <= 7) {
    pendingLessons = pendingLessons.filter(l => !l.isP8Lesson);
  }

  // 分階段排課篩選
  if (autoMode === 'phase1') {
    // 第一階段：只排有「必排規則」或「綁班群組」的課程
    pendingLessons = pendingLessons.filter(l =>
      l.hasMustRule || !!getBindGroupClasses(l.subjectCode, l.classCode)
    );
    console.log(`[Phase 1] 篩選後待排: ${pendingLessons.length} 節（必排+綁班）`);
  } else if (autoMode === 'phase2') {
    // 第二階段：跳過必排與綁班（應已手動調整），只補排一般課
    pendingLessons = pendingLessons.filter(l =>
      !l.hasMustRule && !getBindGroupClasses(l.subjectCode, l.classCode)
    );
    console.log(`[Phase 2] 篩選後待排: ${pendingLessons.length} 節（一般課程）`);
  }

  if (pendingLessons.length === 0) {
    showLoading(false);
    const rangeLabel = optP8Only ? '第 8 節（課後輔導）' : `第 ${autoStartPeriod}~${autoEndPeriod} 節`;
    if (typeof window !== 'undefined') window.__lastAutoScheduleProfile = readAutoScheduleProfile();
    if (previewOnly) {
      return {
        schedule: scheduleSeed.map(entry => ({ ...entry })),
         quality: window.buildAutoScheduleQualityReport({ schedule: scheduleSeed, optP8Only, autoEndPeriod, onePerDay: optOnePerDay, ignoreTeacherConsecutiveIds: originalScheduleIds }),
        pendingCount: 0,
         localOptimizationMoves: 0,
         neighborhoodRepairMoves,
         conflictGraphMoves,
        timedOut: autoScheduleTimedOut,
        timeBudgetMs: autoScheduleTimeBudgetMs,
        repairBudgetExceeded,
        failureDetails: []
      };
    }
    showModal('自動排課完成', `🎉 在 <b>${rangeLabel}</b> 範圍內，所有配課項目（班級＋科目＋教師）皆已安排完畢，無需額外自動排課！`, 'info');
    return;
  }

  await yieldToUI();
  updateProgress(`準備排課 (${pendingLessons.length} 節待排)`);

  // 2. 多重優先級排序（先尊重手動優先，其次依實際限制緊迫度）
  pendingLessons.sort((a, b) => {
    // 必排規則優先處理
    if (a.hasMustRule && !b.hasMustRule) return -1;
    if (!a.hasMustRule && b.hasMustRule) return 1;
    // 使用者指定優先教師／科目，但不改變任何硬限制
    if ((a.priorityScore || 0) !== (b.priorityScore || 0)) {
      return (b.priorityScore || 0) - (a.priorityScore || 0);
    }
    // 科目限制越多越優先：最多連日、同時上限、專用教室與時段規則均納入
    if ((a.subjectConstraintScore || 0) !== (b.subjectConstraintScore || 0)) {
      return (b.subjectConstraintScore || 0) - (a.subjectConstraintScore || 0);
    }
    // 最多連日小的優先（更嚴格的先排）
    const aMaxConsecDays = a.maxConsecDays > 0 ? a.maxConsecDays : Number.MAX_SAFE_INTEGER;
    const bMaxConsecDays = b.maxConsecDays > 0 ? b.maxConsecDays : Number.MAX_SAFE_INTEGER;
    if (aMaxConsecDays !== bMaxConsecDays) return aMaxConsecDays - bMaxConsecDays;
    // 教師可用時段少的優先（更難排）
    if (a.teacherAvailableSlots !== b.teacherAvailableSlots) {
      return a.teacherAvailableSlots - b.teacherAvailableSlots;
    }
    // 虛擬班優先
    if (a.isVirtual && !b.isVirtual) return -1;
    if (!a.isVirtual && b.isVirtual) return 1;
    // 教師限制多的優先
    if (a.teacherConstraintScore !== b.teacherConstraintScore) {
      return b.teacherConstraintScore - a.teacherConstraintScore;
    }
    // 核心科目優先
     if (a.isCore && !b.isCore) return -1;
     if (!a.isCore && b.isCore) return 1;
     return (Number(a.randomOrder) || 0.5) - (Number(b.randomOrder) || 0.5);
  });

  // 3. 回溯與高階軟性啟發式評分求解器
  let localSchedule = JSON.parse(JSON.stringify(scheduleSeed));
  let successCount = 0;
  let failList = [];
  const bindFailureLessons = [];
  const bindFailureDiagnostics = new Map();
  const autoConflictWeights = {
    class: new Map(),
    teacher: new Map(),
    subject: new Map(),
    room: new Map(),
    reason: new Map()
  };
  const autoConflictStats = { failureEvents: 0 };
  const bumpAutoConflictWeight = (map, key, amount) => {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) return;
    map.set(normalizedKey, (map.get(normalizedKey) || 0) + amount);
  };
  const getAutoConflictPressure = lesson => {
    if (!lesson) return 0;
    let pressure = 0;
    pressure += (autoConflictWeights.class.get(String(lesson.classCode || '').trim()) || 0) * 2;
    pressure += (autoConflictWeights.subject.get(String(lesson.subjectCode || '').trim()) || 0) * 1.5;
    getAutoTeacherCodes(autoTeacherInput(lesson)).forEach(teacherCode => {
      pressure += (autoConflictWeights.teacher.get(canonicalAutoTeacherCode(teacherCode)) || 0);
    });
    const roomCode = getSubjectRoomCode(lesson.subjectCode);
    pressure += (autoConflictWeights.room.get(roomCode) || 0);
    pressure += (autoConflictWeights.reason.get(String(lesson.failureReason || '').trim()) || 0);
    return pressure;
  };
  const getAutoDynamicDifficulty = (lesson, availableSlots) => {
    const domainSize = Math.max(0, Number(availableSlots) || 0);
    const pressure = getAutoConflictPressure(lesson);
    return domainSize === 0 ? 100000 + pressure : (1 + pressure * 2) / domainSize;
  };
  const recordAutoFailurePressure = (lesson, reason) => {
    if (!lesson) return;
    autoConflictStats.failureEvents++;
    bumpAutoConflictWeight(autoConflictWeights.class, lesson.classCode, 1);
    bumpAutoConflictWeight(autoConflictWeights.subject, lesson.subjectCode, 1);
    getAutoTeacherCodes(autoTeacherInput(lesson)).forEach(teacherCode => {
      bumpAutoConflictWeight(autoConflictWeights.teacher, canonicalAutoTeacherCode(teacherCode), 1);
    });
    bumpAutoConflictWeight(autoConflictWeights.room, getSubjectRoomCode(lesson.subjectCode), 1);
    bumpAutoConflictWeight(autoConflictWeights.reason, reason, 1);
    lesson.dynamicPressure = getAutoConflictPressure(lesson);
  };
  const autoFailureLabels = {
    'bind-group-no-common-slot': '綁班沒有共同可用時段',
    'bind-group-weekly-mismatch': '綁班每週節數不一致，整組拒絕排課',
    'no-legal-slot': '沒有合法可用格位',
    'class-zero-slack-no-legal-slot': '班級零彈性，沒有可用格位',
    'cascade-no-legal-slot': '連鎖搬動後仍沒有合法格位',
    'mandatory-evicted': '必排挪出後待重排'
  };
  const markAutoFailure = (lesson, reason) => {
    if (lesson) {
      lesson.failureReason = reason;
      recordAutoFailurePressure(lesson, reason);
    }
    failList.push(lesson);
  };
  const requeuedLessons = [];

  // 凍結層：鎖課與正確落在必排時段的課程，任何自動流程都不可移動。
  // 綁班只在群組同步階段維持同時段，後續一般最佳化可以調整。
  function isFrozenAutoEntry(schedEntry) {
    if (!schedEntry) return false;
    if (String(schedEntry['是否鎖定'] || '').toUpperCase() === 'TRUE') return true;
    if (isLockedConsecutiveScheduleEntry(schedEntry, localSchedule)) return true;
    if (schedEntry.__isMustRule) return true;
    const subCode = String(schedEntry['科目代碼'] || '');
    const clsCode = String(schedEntry['班級代碼'] || '');
    const day = parseInt(schedEntry['星期'], 10);
    const per = parseInt(schedEntry['節次'], 10);
    return getApplicableRules(subCode, clsCode).some(entry =>
      isMandatoryAutoRule(entry.rule) &&
      entry.slots.some(slot => slot.day === day && slot.period === per)
    );
  }
  // 舊流程仍使用此名稱，保留別名但不再把綁班視為凍結課。
  function isMustPlacedCourse(schedEntry) {
    return isFrozenAutoEntry(schedEntry);
  }
  function isBindAutoEntry(schedEntry) {
    if (!schedEntry) return false;
    if (schedEntry.__isBindGroup) return true;
    return !!getBindGroupClasses(
      String(schedEntry['科目代碼'] || ''),
      String(schedEntry['班級代碼'] || '')
    );
  }
  const frozenEntrySnapshot = new Map();
  let frozenSnapshotSeed = 0;
  localSchedule.forEach((entry, index) => {
    if (!isFrozenAutoEntry(entry)) return;
    const rawId = String(entry['課表ID'] || '').trim();
    const keyBase = rawId || `auto-frozen-${++frozenSnapshotSeed}`;
    const key = frozenEntrySnapshot.has(keyBase) ? `${keyBase}-${index}` : keyBase;
    Object.defineProperty(entry, '__autoFrozenKey', { value: key, enumerable: false, configurable: true });
    frozenEntrySnapshot.set(key, {
      id: rawId,
      entry: { ...entry },
      classCode: String(entry['班級代碼'] || ''),
      subjectCode: String(entry['科目代碼'] || ''),
      teacher: getAutoTeacherCodes(entry).sort().join('|'),
      day: parseInt(entry['星期'], 10),
      period: parseInt(entry['節次'], 10)
    });
  });
  function restoreFrozenEntries() {
    let restoredAny = false;
    frozenEntrySnapshot.forEach((before, key) => {
      let index = localSchedule.findIndex(entry => entry.__autoFrozenKey === key);
      if (index < 0 && before.id) {
        index = localSchedule.findIndex(entry => String(entry['課表ID'] || '').trim() === before.id);
      }
      const restored = { ...before.entry };
      Object.defineProperty(restored, '__autoFrozenKey', { value: key, enumerable: false, configurable: true });
      if (index < 0) localSchedule.push(restored);
      else localSchedule[index] = restored;
      restoredAny = true;
    });
    if (restoredAny) markLocalScheduleChanged();
  }
  function verifyFrozenEntries() {
    restoreFrozenEntries();
    const violations = [];
    frozenEntrySnapshot.forEach((before, key) => {
      const current = localSchedule.find(entry => entry.__autoFrozenKey === key);
      if (!current) {
        violations.push(`凍結課程遺失：${before.classCode}／${before.subjectCode}`);
        return;
      }
      const after = {
        classCode: String(current['班級代碼'] || ''),
        subjectCode: String(current['科目代碼'] || ''),
        teacher: getAutoTeacherCodes(current).sort().join('|'),
        day: parseInt(current['星期'], 10),
        period: parseInt(current['節次'], 10)
      };
      if (before.classCode !== after.classCode || before.subjectCode !== after.subjectCode || before.teacher !== after.teacher || before.day !== after.day || before.period !== after.period) {
        violations.push(`凍結課程位置變更：${before.classCode}／${before.subjectCode}（原星期${before.day}第${before.period}節）`);
      }
    });
    return violations;
  }
  function makeAutoLessonFromScheduleEntry(entry, suffix = 'requeue') {
    const classCode = String(entry?.['班級代碼'] || '');
    const subjectCode = String(entry?.['科目代碼'] || '');
    const teacherCodes = getAutoTeacherCodes(entry);
    const teacherCode = teacherCodes[0] || String(entry?.['教師姓名'] || '');
    const subject = idx.subjectByCode[subjectCode];
    const applicableRules = getApplicableRules(subjectCode, classCode);
    const mustRuleSlots = [];
    applicableRules
      .filter(entryRule => isMandatoryAutoRule(entryRule.rule))
      .forEach(entryRule => entryRule.slots.forEach(({day, period}) => mustRuleSlots.push({day, per: period})));
    return {
      id: `auto_${suffix}_${classCode}_${subjectCode}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      classCode,
      subjectCode,
      teacherCode,
      teacherCodes,
      teacherValue: teacherCodes.length > 1 ? teacherCodes : teacherCode,
      totalWeekly: weeklyTargetByClassSubject.get(classCode + '|' + subjectCode) || 1,
      weeklyUnit: isAlternateWeekScheduleEntry(entry) ? 0.5 : 1,
      isAlternateWeek: isAlternateWeekScheduleEntry(entry) || isAlternateClassSubject(classCode, subjectCode),
      isP8Lesson: isAlternateWeekScheduleEntry(entry) || isAlternateClassSubject(classCode, subjectCode) || isHelperSubjectCode(subjectCode),
      weekType: isAlternateWeekScheduleEntry(entry) ? String(entry['課堂屬性'] || '').trim() : '',
      maxConsecDays: parseSubjectMaxConsecutiveDays(subject),
      subjectConstraintScore: getAutoSubjectConstraintScore(subjectCode, subject, classCode, parseSubjectMaxConsecutiveDays(subject)),
      priorityScore: getAutoManualPriorityScore(subjectCode, teacherCodes),
      isVirtual: String(entry?.['課堂屬性'] || '') === '抽離' || !!idx.classByCode[classCode]?.['是否虛擬班'],
      isCore: coreSubjects.has(subjectCode),
      isActivity: activitySubjects.has(subjectCode),
      teacherConstraintScore: getAutoTeacherConstraintScore(teacherCodes),
      teacherAvailableSlots: 0,
      hasMustRule: mustRuleSlots.length > 0,
      mustRuleSlots,
      randomOrder: autoRandomTieBreak()
    };
  }
  let localScheduleMutationVersion = 0;
  let localScheduleLookupCache = null;
  let localScheduleLookupCacheTarget = null;
  let localScheduleLookupCacheVersion = -1;
  const hasCurrentLocalScheduleLookup = () =>
    localScheduleLookupCache &&
    localScheduleLookupCacheTarget === localSchedule &&
    localScheduleLookupCacheVersion === localScheduleMutationVersion;
  const markLocalScheduleChanged = () => {
    localScheduleMutationVersion++;
    localScheduleLookupCache = null;
    localScheduleLookupCacheTarget = null;
  };
  const addScheduleLookupEntry = (scheduleLookup, item) => {
    const classCode = String(item['班級代碼'] || '');
    const subjectCode = String(item['科目代碼'] || '');
    const attr = String(item['課堂屬性'] || '');
    const isPatrol = isPatrolScheduleEntry(item);
    const day = parseInt(item['星期'], 10);
    const period = parseInt(item['節次'], 10);
    if (classCode) scheduleLookup.classSlots.add(classCode + '|' + day + '|' + period);
    const slotKey = day + '|' + period;
    if (!scheduleLookup.entriesBySlot.has(slotKey)) scheduleLookup.entriesBySlot.set(slotKey, []);
    scheduleLookup.entriesBySlot.get(slotKey).push(item);
    if (isManualOnlyPeriod(period)) return;
    if (classCode && Number.isFinite(day) && Number.isFinite(period) && day >= 1 && day <= 5 && period >= autoStartPeriod && period <= autoEndPeriod) {
      scheduleLookup.classActiveEntryCounts.set(classCode, (scheduleLookup.classActiveEntryCounts.get(classCode) || 0) + getScheduleWeeklyUnits(item));
    }
    const weekTypes = period === 8
      ? ((attr === '單週' || attr === '雙週') ? [attr] : ['單週', '雙週'])
      : ['全週'];
    if (classCode) weekTypes.forEach(weekType => scheduleLookup.classWeekSlots.add(classCode + '|' + day + '|' + period + '|' + weekType));
    const teacherTokens = getAutoTeacherCodes(item);
    const tCodes = resolveAutoTeacherCodes(item);
    const includeInAutoTeacherConsecutive = !isOriginalAutoScheduleEntry(item);
    tCodes.forEach(tc => {
      if (tc) scheduleLookup.teacherSlots.add(tc + '|' + day + '|' + period);
      if (tc) weekTypes.forEach(weekType => scheduleLookup.teacherWeekSlots.add(tc + '|' + day + '|' + period + '|' + weekType));
      if (tc && subjectCode !== '不排課' && attr !== '不排課') {
        const dayKey = tc + '|' + day;
        if (!scheduleLookup.teacherDayPeriods.has(dayKey)) scheduleLookup.teacherDayPeriods.set(dayKey, new Set());
        scheduleLookup.teacherDayPeriods.get(dayKey).add(period);
        if (includeInAutoTeacherConsecutive) {
          if (!scheduleLookup.teacherAutoDayPeriods.has(dayKey)) scheduleLookup.teacherAutoDayPeriods.set(dayKey, new Set());
          scheduleLookup.teacherAutoDayPeriods.get(dayKey).add(period);
        }
      }
    });
    teacherTokens.forEach(teacherToken => {
      const teacherKey = canonicalAutoTeacherCode(teacherToken);
      if (!teacherKey) return;
       if (classCode && Number.isFinite(day)) {
         const classTeacherKey = classCode + '|' + teacherKey;
         if (!scheduleLookup.classTeacherDays.has(classTeacherKey)) scheduleLookup.classTeacherDays.set(classTeacherKey, new Set());
         scheduleLookup.classTeacherDays.get(classTeacherKey).add(day);
       }
       const teacherDayKey = teacherKey + '|' + day;
       if (!scheduleLookup.teacherDayEntries.has(teacherDayKey)) scheduleLookup.teacherDayEntries.set(teacherDayKey, []);
       scheduleLookup.teacherDayEntries.get(teacherDayKey).push(item);

       let stats = scheduleLookup.teacherStats.get(teacherKey);
      if (!stats) {
        stats = {
          entryCount: 0,
          afternoonCount: 0,
          dailyCounts: [0, 0, 0, 0, 0],
          dayPeriods: new Map(),
          periodDays: new Map(),
          gradeDayCounts: new Map(),
          grades: new Set(),
          gradeSlots: new Map()
        };
        scheduleLookup.teacherStats.set(teacherKey, stats);
      }

      const grade = getAutoClassGrade(classCode);
      if (grade) stats.grades.add(grade);
      if (Number.isFinite(day) && Number.isFinite(period)) {
        const gradeSlotKey = day + '|' + period;
        if (!stats.gradeSlots.has(gradeSlotKey)) stats.gradeSlots.set(gradeSlotKey, new Set());
        if (grade) stats.gradeSlots.get(gradeSlotKey).add(grade);
      }

      const weeklyTarget = weeklyTargetByClassSubject.get(classCode + '|' + subjectCode);
      if (day >= 1 && day <= 5 && weeklyTarget === 1 && grade) {
        if (!stats.gradeDayCounts.has(grade)) stats.gradeDayCounts.set(grade, new Map());
        const gradeDays = stats.gradeDayCounts.get(grade);
        gradeDays.set(day, (gradeDays.get(day) || 0) + 1);
      }

      // 評分中的教師統計只看第 1～7 節，與原 teacherEntries 篩選一致。
      if (period > 7 || !Number.isFinite(period)) return;
      stats.entryCount++;
      if (period >= 5 && period <= 7) stats.afternoonCount++;
      if (day >= 1 && day <= 5) {
        stats.dailyCounts[day - 1]++;
        if (!stats.dayPeriods.has(day)) stats.dayPeriods.set(day, new Set());
        stats.dayPeriods.get(day).add(period);
        if (!stats.periodDays.has(period)) stats.periodDays.set(period, new Set());
        stats.periodDays.get(period).add(day);
      }
    });
    if (!isPatrol && subjectCode) {
      const key = subjectCode + '|' + day + '|' + period;
      scheduleLookup.subjectSlots.set(key, (scheduleLookup.subjectSlots.get(key) || 0) + 1);
      weekTypes.forEach(weekType => {
        const weekKey = subjectCode + '|' + day + '|' + period + '|' + weekType;
        scheduleLookup.subjectWeekSlots.set(weekKey, (scheduleLookup.subjectWeekSlots.get(weekKey) || 0) + 1);
      });
    }
    if (!isPatrol && classCode && subjectCode) {
      const key = classCode + '|' + subjectCode + '|' + day;
      scheduleLookup.classSubjectDays.set(key, (scheduleLookup.classSubjectDays.get(key) || 0) + 1);
      weekTypes.forEach(weekType => {
        const weekKey = classCode + '|' + subjectCode + '|' + day + '|' + weekType;
        scheduleLookup.classSubjectWeekDays.set(weekKey, (scheduleLookup.classSubjectWeekDays.get(weekKey) || 0) + 1);
      });
    }
    const roomCode = getSubjectRoomCode(subjectCode);
    if (!isPatrol && roomCode) {
      const roomKey = roomCode + '|' + day + '|' + period;
      scheduleLookup.roomSlots.set(roomKey, (scheduleLookup.roomSlots.get(roomKey) || 0) + 1);
      weekTypes.forEach(weekType => {
        const roomWeekKey = roomCode + '|' + day + '|' + period + '|' + weekType;
        scheduleLookup.roomWeekSlots.set(roomWeekKey, (scheduleLookup.roomWeekSlots.get(roomWeekKey) || 0) + 1);
      });
    }
  };
  const appendLocalSchedule = (...entries) => {
    const canUpdateLookup = hasCurrentLocalScheduleLookup();
    localSchedule.push(...entries);
    localScheduleMutationVersion++;
    if (canUpdateLookup) {
      entries.forEach(entry => addScheduleLookupEntry(localScheduleLookupCache, entry));
      localScheduleLookupCacheVersion = localScheduleMutationVersion;
    } else {
      localScheduleLookupCache = null;
      localScheduleLookupCacheTarget = null;
    }
  };
  const removeLocalScheduleAt = index => {
    localSchedule.splice(index, 1);
    markLocalScheduleChanged();
  };
  const insertLocalScheduleAt = (index, entry) => {
    localSchedule.splice(index, 0, entry);
    markLocalScheduleChanged();
  };
  const replaceLocalSchedule = entries => {
    localSchedule.length = 0;
    localSchedule.push(...entries);
    markLocalScheduleChanged();
  };
  const setLocalScheduleEntry = (index, entry) => {
    localSchedule[index] = entry;
    markLocalScheduleChanged();
  };
  function buildScheduleLookup(targetSched) {
    if (targetSched === localSchedule && targetSched === localScheduleLookupCacheTarget && localScheduleLookupCache && localScheduleLookupCacheVersion === localScheduleMutationVersion) {
      return localScheduleLookupCache;
    }
     const scheduleLookup = {
      classSlots: new Set(),
      classWeekSlots: new Set(),
      entriesBySlot: new Map(),
      teacherSlots: new Set(),
      teacherWeekSlots: new Set(),
      teacherDayEntries: new Map(),
      subjectSlots: new Map(),
      subjectWeekSlots: new Map(),
      classSubjectDays: new Map(),
      classSubjectWeekDays: new Map(),
      roomSlots: new Map(),
      roomWeekSlots: new Map(),
      teacherDayPeriods: new Map(),
      teacherAutoDayPeriods: new Map(),
      classActiveEntryCounts: new Map(),
      classTeacherDays: new Map(),
      teacherStats: new Map()
    };
     targetSched.forEach(item => addScheduleLookupEntry(scheduleLookup, item));
     if (targetSched === localSchedule) {
       localScheduleLookupCache = scheduleLookup;
       localScheduleLookupCacheTarget = targetSched;
       localScheduleLookupCacheVersion = localScheduleMutationVersion;
     }
     return scheduleLookup;
  }

  const autoAlternateWeekTypes = ['單週', '雙週'];
  const getAutoEntryWeekTypes = entry => {
    const period = parseInt(entry?.['節次'], 10);
    const attr = String(entry?.['課堂屬性'] || '').trim();
    if (period !== 8) return ['全週'];
    return autoAlternateWeekTypes.includes(attr) ? [attr] : autoAlternateWeekTypes;
  };
  const selectAutoPlacementWeekType = (classCode, subjectCode, teacherValue, day, period, targetSched = localSchedule, scheduleLookup = null) => {
    if (parseInt(period, 10) !== 8) return '全週';
    const lookup = scheduleLookup || buildScheduleLookup(targetSched);
    const teacherIdentities = resolveAutoTeacherCodes(teacherValue);
    const roomCode = getSubjectRoomCode(subjectCode);
    const available = autoAlternateWeekTypes.filter(weekType => {
      if (lookup.classWeekSlots.has(String(classCode) + '|' + day + '|' + period + '|' + weekType)) return false;
      if (teacherIdentities.some(identity => lookup.teacherWeekSlots.has(identity + '|' + day + '|' + period + '|' + weekType))) return false;
      if (roomCode && (lookup.roomWeekSlots.get(roomCode + '|' + day + '|' + period + '|' + weekType) || 0) >= getSubjectRoomCapacity(subjectCode)) return false;
      return true;
    });
    return available[0] || '單週';
  };
  const getAutoLessonWeekType = (lesson, day, period, targetSched = localSchedule, scheduleLookup = null) => {
    if (parseInt(period, 10) !== 8 || !lesson?.isAlternateWeek) return '';
    return String(lesson.weekType || '').trim() || selectAutoPlacementWeekType(
      lesson.classCode, lesson.subjectCode, autoTeacherInput(lesson), day, period, targetSched, scheduleLookup
    );
  };
  const getAutoScheduleAttribute = (lesson, day, period, targetSched = localSchedule, scheduleLookup = null) => {
    const weekType = getAutoLessonWeekType(lesson, day, period, targetSched, scheduleLookup);
    return weekType || (lesson?.isVirtual ? '抽離' : '一般');
  };

  function canPlaceClassSubjectOnDay(clsCode, subCode, day, targetSched, scheduleLookup, weekType = '') {
    // 一般課程同班同科同日第二節禁止；明確必排連堂只放行指定節次數量。
    const prefix = String(clsCode) + '|' + String(subCode) + '|';
    const countForDay = targetDay => {
      if (scheduleLookup) {
        if (autoAlternateWeekTypes.includes(String(weekType || '').trim())) {
          return scheduleLookup.classSubjectWeekDays.get(prefix + targetDay + '|' + weekType) || 0;
        }
        return scheduleLookup.classSubjectDays.get(prefix + targetDay) || 0;
      }
      return targetSched.filter(s =>
        String(s['班級代碼']) === String(clsCode) && String(s['科目代碼']) === String(subCode) &&
        parseInt(s['星期'], 10) === targetDay &&
        (!autoAlternateWeekTypes.includes(String(weekType || '').trim()) || getAutoEntryWeekTypes(s).includes(weekType))
      ).length;
    };
    const currentDayCount = countForDay(day);
    const mandatoryDaySlots = getMandatoryRuleDaySlots(subCode, clsCode, day);
    return currentDayCount < (mandatoryDaySlots.length > 1 ? mandatoryDaySlots.length : 1);
  }
  function isSubjectMaxConsecutiveDaysFeasible(clsCode, subCode, maxDays) {
    const weeklyTarget = weeklyTargetByClassSubject.get(String(clsCode) + '|' + String(subCode)) || 0;
    if (weeklyTarget <= 0 || maxDays >= 5) return true;
    const maxDistinctDays = 5 - Math.floor(5 / (maxDays + 1));
    return weeklyTarget <= maxDistinctDays;
  }
  function canPlaceSubjectWithinMaxConsecutiveDays(clsCode, subCode, day, targetSched, scheduleLookup) {
    const subject = idx.subjectByCode[subCode];
    const maxDays = parseSubjectMaxConsecutiveDays(subject);
    if (maxDays <= 0 || maxDays >= 5) return true;
    if (!isSubjectMaxConsecutiveDaysFeasible(clsCode, subCode, maxDays)) return true;

    const prefix = String(clsCode) + '|' + String(subCode) + '|';
    const hasSubjectOnDay = targetDay => {
      if (scheduleLookup?.classSubjectDays) {
        return (scheduleLookup.classSubjectDays.get(prefix + targetDay) || 0) > 0;
      }
      return targetSched.some(entry =>
        String(entry['班級代碼']) === String(clsCode) &&
        String(entry['科目代碼']) === String(subCode) &&
        parseInt(entry['星期'], 10) === targetDay
      );
    };

    const days = [];
    for (let targetDay = 1; targetDay <= 5; targetDay++) {
      if (targetDay === day || hasSubjectOnDay(targetDay)) days.push(targetDay);
    }
    let streak = 1;
    for (let i = 1; i < days.length; i++) {
      streak = days[i] === days[i - 1] + 1 ? streak + 1 : 1;
      if (streak > maxDays) return false;
    }
    return true;
  }
  function countConsecutiveInLocal(sched, teacherCode, day, period, scheduleLookup = null) {
    if (!teacherCode) return 1;
    const dayN = parseInt(day, 10);
    const targetP = parseInt(period, 10);
    if (isManualOnlyPeriod(targetP)) return 1;
    const activePeriods = new Set();
    if (scheduleLookup?.teacherAutoDayPeriods) {
      resolveAutoTeacherCodes(teacherCode).forEach(identity => {
        const periods = scheduleLookup.teacherAutoDayPeriods.get(identity + '|' + dayN);
        if (periods) periods.forEach(value => activePeriods.add(value));
      });
    } else {
      sched.forEach(s => {
        if (!isOriginalAutoScheduleEntry(s) && autoTeacherMatches(s, teacherCode) && parseInt(s['星期'], 10) === dayN) {
          const sub  = String(s['科目代碼'] || '').trim();
          const attr = String(s['課堂屬性'] || '').trim();
          if (sub !== '不排課' && attr !== '不排課') {
            activePeriods.add(parseInt(s['節次'], 10));
          }
        }
      });
    }
    activePeriods.add(targetP);
    let before = 0, p = targetP - 1;
    while (p >= 1 && activePeriods.has(p)) { before++; p--; }
    let after = 0; p = targetP + 1;
    while (p <= 8 && activePeriods.has(p)) { after++; p++; }
    const streakAtTarget = before + after + 1;

    let maxStreakOnDay = 0, curStreak = 0;
    for (let p = 1; p <= 8; p++) {
      if (activePeriods.has(p)) { curStreak++; maxStreakOnDay = Math.max(maxStreakOnDay, curStreak); }
      else { curStreak = 0; }
    }
    return Math.max(streakAtTarget, maxStreakOnDay);
  }

  function isSlotValid(clsCode, subCode, tcCode, day, period, targetSched = localSchedule, scheduleLookup = null, validationOptions = {}) {
    if (isManualOnlyPeriod(period)) return false;
    if (period < autoStartPeriod || period > autoEndPeriod) return false;
    const isHelper = String(subCode || '').trim().endsWith('輔');
    const explicitWeekType = autoAlternateWeekTypes.includes(String(validationOptions.weekType || '').trim())
      ? String(validationOptions.weekType).trim()
      : '';
    const isAlternate = Boolean(explicitWeekType) || isAlternateClassSubject(clsCode, subCode);
    if (isHelper && period !== 8) return false;
    if (!isHelper && !isAlternate && period === 8) return false;
    if (isAlternate && period !== 8) return false;

    const targetWeekType = period === 8 && isAlternate
      ? (explicitWeekType || selectAutoPlacementWeekType(clsCode, subCode, tcCode, day, period, targetSched, scheduleLookup))
      : '';
    const targetWeekTypes = period === 8 ? (targetWeekType ? [targetWeekType] : autoAlternateWeekTypes) : ['全週'];
    const hasWeekOverlap = (entry, weekType) => getAutoEntryWeekTypes(entry).includes(weekType);

    const occupied = targetWeekTypes.some(weekType => scheduleLookup
      ? scheduleLookup.classWeekSlots.has(String(clsCode) + '|' + day + '|' + period + '|' + weekType)
      : targetSched.some(s => String(s['班級代碼']) === String(clsCode) && parseInt(s['星期'], 10) === day && parseInt(s['節次'], 10) === period && hasWeekOverlap(s, weekType)));
    if (occupied) return false;
    const roomCode = getSubjectRoomCode(subCode);
    if (roomCode) {
      const capacity = getSubjectRoomCapacity(subCode);
      const roomBlocked = targetWeekTypes.some(weekType => {
        const roomKey = roomCode + '|' + day + '|' + period + '|' + weekType;
        const roomCount = scheduleLookup
          ? (scheduleLookup.roomWeekSlots.get(roomKey) || 0)
          : targetSched.filter(s => !isPatrolScheduleEntry(s) && getSubjectRoomCode(s['科目代碼']) === roomCode && parseInt(s['星期'], 10) === day && parseInt(s['節次'], 10) === period && hasWeekOverlap(s, weekType)).length;
        return roomCount >= capacity;
      });
      if (roomBlocked) return false;
    }
    // 教師衝堂與不排課時段都是硬限制
    if (tcCode) {
      const teacherTokens = getAutoTeacherCodes(tcCode);
      for (const teacherToken of teacherTokens) {
        const identities = resolveAutoTeacherCodes(teacherToken);
        const conflict = targetWeekTypes.some(weekType => identities.some(identity => scheduleLookup
          ? scheduleLookup.teacherWeekSlots.has(identity + '|' + day + '|' + period + '|' + weekType)
          : targetSched.some(s => autoTeacherMatches(s, identity) && parseInt(s['星期'], 10) === day && parseInt(s['節次'], 10) === period && hasWeekOverlap(s, weekType))));
        const blocked = identities.some(identity => idx.blockSet.has(identity + '|' + day + '|' + period));
        if (conflict || blocked) {
          return false;
        }
      }
      // 教師互斥規則（自動排課引擎 - 解析代碼與多師）
      if (state.teacherExclusives && state.teacherExclusives.length > 0) {
        const myCodes = resolveAutoTeacherCodes(tcCode);
        for (const myTC of myCodes) {
          const peerCodes = autoTeacherExclusivePeers.get(myTC) || [];
          for (const peer of peerCodes) {
            const hasPeerLesson = targetWeekTypes.some(weekType => scheduleLookup
              ? scheduleLookup.teacherWeekSlots.has(peer + '|' + day + '|' + period + '|' + weekType)
              : targetSched.some(s => resolveAutoTeacherCodes(s['教師姓名']).includes(peer) && parseInt(s['星期'], 10) === day && parseInt(s['節次'], 10) === period && hasWeekOverlap(s, weekType)));
             if (hasPeerLesson) return false;
          }
        }
      }
    }

    const subj=idx.subjectByCode[subCode];
    const maxC=subj?parseInt(subj['同時最多班數']||'0',10):0;
    if (maxC > 0) {
      const exceeds = targetWeekTypes.some(weekType => {
        const key = String(subCode) + '|' + day + '|' + period + '|' + weekType;
        const count = scheduleLookup
          ? (scheduleLookup.subjectWeekSlots.get(key) || 0)
          : targetSched.filter(s => !isPatrolScheduleEntry(s) && String(s['科目代碼']) === String(subCode) && parseInt(s['星期'], 10) === day && parseInt(s['節次'], 10) === period && hasWeekOverlap(s, weekType)).length;
        return count >= maxC;
      });
      if (exceeds) return false;
    }

    const applicableRules=getApplicableRules(subCode,clsCode);
    if(applicableRules.some(entry=>isForbiddenAutoRule(entry.rule)&&entry.slots.some(slot=>slot.day===day&&slot.period===period)))return false;
    const mustRules=applicableRules.filter(entry=>isMandatoryAutoRule(entry.rule));
    if(mustRules.length&&!mustRules.some(entry=>entry.slots.some(slot=>slot.day===day&&slot.period===period)))return false;

    if (!canPlaceClassSubjectOnDay(clsCode, subCode, day, targetSched, scheduleLookup, targetWeekType)) {
      return false;
    }
    if (!canPlaceSubjectWithinMaxConsecutiveDays(clsCode, subCode, day, targetSched, scheduleLookup)) return false;

    if (optTeacherConsec && tcCode) {
      for (const teacherToken of getAutoTeacherCodes(tcCode)) {
        const teacherKey = canonicalAutoTeacherCode(teacherToken);
        const teacher = idx.teacherByCode[teacherKey];
        const maxConsec = teacher ? parseInt(teacher['最大連堂節數'] || '2', 10) : 2;
        const consec = countConsecutiveInLocal(targetSched, teacherToken, day, period, scheduleLookup);
        if (consec > maxConsec) return false;
      }
    }
    return true;
  }
  function evaluateSlotScore(lesson, day, period, includeRandom = true, scheduleLookup = null) {
    const lookup = scheduleLookup || buildScheduleLookup(localSchedule);
    let score = 100;

    // 必排時段加分（確保必排科目優先排入指定時段）
    const isMustRuleSlot = getApplicableRules(lesson.subjectCode, lesson.classCode).some(entry =>
      isMandatoryAutoRule(entry.rule) &&
      entry.slots.some(slot => slot.day === day && slot.period === period)
    );
    if (isMustRuleSlot) score += 200;

    // 核心學科溫和偏好上午，保留下午排課空間
    if (optMorningCore && lesson.isCore) {
      if (period >= 1 && period <= 4) score += 8;
      else if (period === 6 || period === 7) score -= 2;
    }

    // 活動課程僅保留極輕微下午偏好，避免整週集中在第 5～7 節。
    if (lesson.isActivity) {
      if (period >= 5 && period <= 7) score += 3;
      else if (period >= 1 && period <= 4) score += 1;
    }

    // 同科目分散排課
    const subjectDayPrefix = String(lesson.classCode) + '|' + String(lesson.subjectCode) + '|';
    const existingDays = [];
    for (let targetDay = 1; targetDay <= 5; targetDay++) {
      if ((lookup.classSubjectDays.get(subjectDayPrefix + targetDay) || 0) > 0) existingDays.push(targetDay);
    }

    if (existingDays.length > 0) {
      const minDiff = Math.min(...existingDays.map(d => Math.abs(d - day)));
      if (minDiff === 0) score -= 18;
      else if (minDiff === 1) score -= 16;
      else if (minDiff === 2) score += 24;
      else if (minDiff >= 3) score += 14;
    }

    // 科目關係是軟限制：同班同日遇到關聯科目時扣分，但不淘汰候選格位。
    const relationViolations = getSubjectRelationViolationCount(lesson, day, period, localSchedule, lookup);
    score -= relationViolations * AUTO_SUBJECT_RELATION_PENALTY;

    // 同一教師同一班級分散：儘量一天一節（跨科目也適用）
    const teacherCodes = getAutoTeacherCodes(autoTeacherInput(lesson));
    if (teacherCodes.length > 0) {
      for (const tcCode of teacherCodes) {
      const teacherClassDays = lookup.classTeacherDays.get(
        String(lesson.classCode) + '|' + canonicalAutoTeacherCode(tcCode)
      ) || new Set();
      if (teacherClassDays.size > 0) {
        const minDiff = Math.min(...[...teacherClassDays].map(d => Math.abs(d - day)));
        if (minDiff === 0) score -= 60;
        else if (minDiff === 1) score -= 20;
        else if (minDiff >= 2) score += 16;
      }
    }
    }

    // 跨年級教師的低週節數課程（每班每週一節）儘量按年級集中在同一天。
    // 這是評分偏好，不改變任何合法性判斷；同年級尚未有已排課程時不強行猜測日期。
    if (lesson.totalWeekly === 1 && teacherCodes.length > 0) {
      const candidateGrade = getAutoClassGrade(lesson.classCode);
      if (candidateGrade) {
        for (const tcCode of teacherCodes) {
          const teacherStats = lookup.teacherStats.get(canonicalAutoTeacherCode(tcCode));
          const gradeDayCounts = teacherStats?.gradeDayCounts || new Map();
          const teacherGrades = new Set(teacherStats?.grades || []);
          teacherGrades.add(candidateGrade);
          const sameGradeDayCounts = gradeDayCounts.get(candidateGrade);
          if (teacherGrades.size >= 2) {
            if (sameGradeDayCounts && sameGradeDayCounts.size > 0) {
              const sameDayCount = sameGradeDayCounts.get(day) || 0;
              const peakDayCount = Math.max(...sameGradeDayCounts.values());
              if (sameDayCount > 0) {
                score += 18 + Math.min(10, (sameDayCount - 1) * 4);
              } else {
                score -= Math.min(24, 12 + peakDayCount * 4);
              }
            }

            // 同一天的相鄰節次也儘量接同年級，避免九、七、九、七交錯。
            if (period >= 1 && period <= 7) {
              [period - 1, period + 1].filter(adjacentPeriod => adjacentPeriod >= 1 && adjacentPeriod <= 7).forEach(adjacentPeriod => {
                const adjacentGrades = teacherStats?.gradeSlots.get(day + '|' + adjacentPeriod) || new Set();
                if (adjacentGrades.size === 0) return;
                if (adjacentGrades.has(candidateGrade)) score += 12;
                else score -= 10;
              });
            }
          }
        }
      }
    }

    // 最多連日限制（超過者重罰）
    const maxDays = lesson.maxConsecDays;
    if (maxDays > 0 && maxDays < 5) {
      const allDays = [...existingDays, day].sort((a, b) => a - b);
      let streak = 1;
      for (let i = 1; i < allDays.length; i++) {
        if (allDays[i] === allDays[i - 1] + 1) streak++;
        else streak = 1;
        if (streak > maxDays) { score -= 80; break; }
      }
    }

    // 教師品質採增量評分：降低每日負擔落差，並優先填補既有空堂。
    if (teacherCodes.length > 0) {
      for (const tcCode of teacherCodes) {
      const teacherStats = lookup.teacherStats.get(canonicalAutoTeacherCode(tcCode));
      const teacherEntriesCount = teacherStats?.entryCount || 0;
      const dailyCounts = teacherStats?.dailyCounts || [0, 0, 0, 0, 0];
      const assignedValue = resolveAutoTeacherCodes(tcCode).map(code => idx.assignedWeeklyByTeacher?.[code]).find(value => Number.isFinite(value));
      const assignedTotal = Number.isFinite(assignedValue) ? assignedValue : (teacherEntriesCount + 1);
      const targetDaily = assignedTotal / 5;
      const beforeBalanceCost = dailyCounts.reduce((sum, count) => sum + Math.abs(count - targetDaily), 0);
      const afterCounts = [...dailyCounts];
      afterCounts[day - 1]++;
      const afterBalanceCost = afterCounts.reduce((sum, count) => sum + Math.abs(count - targetDaily), 0);
      const balanceDelta = beforeBalanceCost - afterBalanceCost;
      score += Math.round(balanceDelta * 14);
      const beforePeak = Math.max(...dailyCounts, 0);
      const afterPeak = Math.max(...afterCounts, 0);
      score += (beforePeak - afterPeak) * 10;
      const projectedDailyExcess = Math.max(0, afterCounts[day - 1] - Math.ceil(targetDaily) - 1);
      if (projectedDailyExcess > 0) score -= projectedDailyExcess * 8;

      const dayPeriods = teacherStats?.dayPeriods.get(day) || new Set();
      // 教師每日課表軟規則：排一不排七、排四不排五，只扣分，不阻擋合法候選。
      if ((period === 7 && dayPeriods.has(1)) || (period === 1 && dayPeriods.has(7))) score -= 6;
      if ((period === 5 && dayPeriods.has(4)) || (period === 4 && dayPeriods.has(5))) score -= 6;
      const countTeacherGaps = periods => {
        if (periods.size < 2) return 0;
        const occupied = periods, sortedPeriods = [...periods], first = Math.min(...sortedPeriods), last = Math.max(...sortedPeriods);
        let gaps = 0;
        for (let p = first + 1; p < last; p++) if (!occupied.has(p) && !idx.blockSet.has(tcCode + '|' + day + '|' + p)) gaps++;
        return gaps;
      };
      const projectedDayPeriods = new Set(dayPeriods);
      projectedDayPeriods.add(period);
      const gapDelta = countTeacherGaps(dayPeriods) - countTeacherGaps(projectedDayPeriods);
      // 加強空堂獎懲：填補空堂獎勵更強，製造空堂懲罰更強
      score += gapDelta * 22;
      const adjacentLessons = Number(dayPeriods.has(period - 1)) + Number(dayPeriods.has(period + 1));
      // 加強「孤立課程」懲罰：該天已有課但新課與任何課都不相鄰
      if (dayPeriods.size > 0 && adjacentLessons === 0) score -= 16;

      const projectedPeriods = projectedDayPeriods;
      let projectedStreak = 1;
      for (let p = period - 1; projectedPeriods.has(p); p--) projectedStreak++;
      for (let p = period + 1; projectedPeriods.has(p); p++) projectedStreak++;
      if (projectedStreak === 2) score += 2;
      else if (projectedStreak === 3) score -= 28;
      else if (projectedStreak >= 4) score -= 60;

      if (period >= 1 && period <= 7) {
        const samePeriodDays = teacherStats?.periodDays.get(period)?.size || 0;
        // 加強固定節次集中懲罰
        const repeatedPeriodPenalty = [0, 2, 7, 28, 60];
        score -= repeatedPeriodPenalty[Math.min(samePeriodDays, repeatedPeriodPenalty.length - 1)];
      }

      const projectedDailyCount = afterCounts[day - 1];
      const comfortableDailyMax = Math.max(2, Math.ceil(targetDaily));
      if (projectedDailyCount > comfortableDailyMax) score -= Math.pow(projectedDailyCount - comfortableDailyMax, 2) * 12;

      if (period >= 5 && period <= 7 && teacherEntriesCount >= 4) {
        const afternoonCount = (teacherStats?.afternoonCount || 0) + 1;
        const projectedShare = afternoonCount / (teacherEntriesCount + 1);
        if (projectedShare > 0.65) score -= Math.round((projectedShare - 0.65) * 50);
      }
    }
    }
    // 班級空格數量（空格多的班級優先排入，避免集中）
    const classEmptyCount = 5 * (autoEndPeriod - autoStartPeriod + 1) - (lookup.classActiveEntryCounts.get(String(lesson.classCode)) || 0);
    if (classEmptyCount > 15) score += 10;
    else if (classEmptyCount < 5) score -= 10;

    return score;
  }

  function evaluateSlotScoreOnSchedule(lesson, day, period, baseSchedule, includeRandom = false, baseLookup = null) {
    const previousSchedule = localSchedule;
    localSchedule = baseSchedule;
    try {
      return evaluateSlotScore(lesson, day, period, includeRandom, baseLookup || buildScheduleLookup(baseSchedule));
    } finally {
      localSchedule = previousSchedule;
    }
  }
  // 2.5 綁班群組優先排課（同科目多班必須同時段）
  const scheduledFlag = new Array(pendingLessons.length).fill(false);
  const lessonGroupBySub = {};
  pendingLessons.forEach((l, i) => {
    const key = l.subjectCode;
    if (!lessonGroupBySub[key]) lessonGroupBySub[key] = [];
    lessonGroupBySub[key].push(i);
  });

  // 第一梯隊：先排非綁班必排；綁班必排保留給下一階段的群組同步。
  function scheduleMandatoryLessons() {
  state.subjectRules.filter(isMandatoryAutoRule).forEach(rule => {
    if (shouldStopAutoSchedule('mandatory')) return;
    const allowedSlots = getRuleDaysPeriods(rule); // 整條規則定義的「合法範圍」
    getRuleSubjectCodes(rule).forEach(sub => {
    if (shouldStopAutoSchedule('mandatory')) return;

    // 對所有尚未排入的同科目課程，各自在「合法範圍」內找最佳格位排一節
    const pool = (lessonGroupBySub[sub] || []).filter(i => !scheduledFlag[i]);
    pool.forEach(i => {
      if (shouldStopAutoSchedule('mandatory')) return;
      const l = pendingLessons[i];
      const cls = idx.classByCode[l.classCode];
      const g = cls ? String(cls['年級'] || '').trim() : '';
      if (!ruleAppliesToClass(rule, l.classCode, g)) return;

      // 🔑 綁班科目跳過：由綁班群組排課統一處理（該排程本身已尊重必排規則）
      if (getBindGroupClasses(l.subjectCode, l.classCode)) return;

      // 收集此課在合法範圍內所有可排的格位（不論哪天哪節，只要在 allowedSlots 內都算候選）
      const mandatoryLookup = buildScheduleLookup(localSchedule);
      const candidates = [];

      for (const { day: dayR, period: perR } of allowedSlots) {
        if (shouldStopAutoSchedule('mandatory')) break;
        const tcCode = l.teacherCode;

        // 硬限制：教師不排課
        if (tcCode && resolveAutoTeacherCodes(tcCode).some(identity => idx.blockSet.has(identity + '|' + dayR + '|' + perR))) continue;

        // 同班同科每日一節原則
        if (!canPlaceClassSubjectOnDay(l.classCode, l.subjectCode, dayR, localSchedule, mandatoryLookup)) continue;

        // 檢查目標格是否有不可移動的凍結課
        const existingSlotIdx = localSchedule.findIndex(s =>
          String(s['班級代碼']) === String(l.classCode) &&
          parseInt(s['星期'], 10) === dayR &&
          parseInt(s['節次'], 10) === perR
        );
        let displacedEntry = null;
        if (existingSlotIdx >= 0) {
          const existing = localSchedule[existingSlotIdx];
          if (isFrozenAutoEntry(existing) || isBindAutoEntry(existing)) continue; // 凍結課與綁班不可拆開
          displacedEntry = existing;
          removeLocalScheduleAt(existingSlotIdx); // 暫時移除，驗證後還原
        }

        // 完整硬限制驗證
        const postEvictionLookup = buildScheduleLookup(localSchedule);
        const valid = isSlotValid(l.classCode, l.subjectCode, autoTeacherInput(l), dayR, perR, localSchedule, postEvictionLookup);

        // 還原暫時移除的課
        if (displacedEntry) insertLocalScheduleAt(existingSlotIdx, displacedEntry);

        if (valid) {
           candidates.push({ dayR, perR, displacedEntry, existingSlotIdx, score: evaluateSlotScore(l, dayR, perR, true, buildScheduleLookup(localSchedule)), tieBreak: autoRandomTieBreak() });
        }
      }

      if (candidates.length === 0) {
        console.warn(`  ⚠️ 必排科目 ${sub} (${l.classCode}) 在合法範圍內找不到可排格位`);
        return;
      }

      // 選最高分格位排入
      const best = selectAutoCandidate(candidates, l);

      // 正式移除讓位課程（若有）
      if (best.displacedEntry) {
        const idx2 = localSchedule.indexOf(best.displacedEntry);
        if (idx2 >= 0) removeLocalScheduleAt(idx2);
        requeuedLessons.push(makeAutoLessonFromScheduleEntry(best.displacedEntry, 'mandatory_requeue'));
      }

      // 排入
      const id = 'AUTO_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
      appendLocalSchedule({
        '課表ID': id,
        '班級代碼': String(l.classCode),
        '星期': best.dayR,
        '節次': best.perR,
        '科目代碼': String(l.subjectCode),
        '教師姓名': autoTeacherValue(l),
        '課堂屬性': getAutoScheduleAttribute(l, best.dayR, best.perR, localSchedule, buildScheduleLookup(localSchedule)),
        '是否鎖定': 'FALSE',
        '__isMustRule': true
      });
      successCount++;
      scheduledFlag[i] = true;
      console.log(`  ✅ 必排 ${sub} (${l.classCode}) → 星期${best.dayR}第${best.perR}節（從 ${allowedSlots.length} 個合法格中選最佳）`);
    });
    });
  });
  }


  await yieldToUI();
  updateProgress('第一階段：必排科目配課中…');
  markAutoScheduleProfile('mandatory');
  scheduleMandatoryLessons();
  function getRepeatedTeacherCodes(lessons) {
    const seen = new Set();
    const repeated = new Set();
    lessons.forEach(lesson => {
      getAutoTeacherCodes(autoTeacherInput(lesson)).forEach(code => {
        const canonical = canonicalAutoTeacherCode(code);
        if (!canonical) return;
        if (seen.has(canonical)) repeated.add(canonical);
        else seen.add(canonical);
      });
    });
    return [...repeated];
  }

     // 綁課讓位只處理普通課，鎖課、必排與既有綁課均不可搬動。
  function collectBindEvictions(roundLsn, day, per) {
    if (shouldStopAutoSchedule('bind-eviction')) return null;
    const targetClasses = new Set(roundLsn.map(lesson => String(lesson.classCode)));
    const teacherIdentities = new Set();
    roundLsn.forEach(lesson => {
      getAutoTeacherCodes(autoTeacherInput(lesson)).forEach(token => {
        resolveAutoTeacherCodes(token).forEach(identity => teacherIdentities.add(identity));
      });
    });
    const exclusivePeers = new Set();
    teacherIdentities.forEach(identity => {
      (autoTeacherExclusivePeers.get(identity) || []).forEach(peer => exclusivePeers.add(peer));
    });
    if ([...teacherIdentities].some(identity => idx.blockSet.has(identity + '|' + day + '|' + per))) return null;

    const victims = new Set();
    let blocked = false;
    let changed = true;
    let guard = 0;
    const addVictim = entry => {
      if (!entry || victims.has(entry)) return;
      if (isFrozenAutoEntry(entry) || isBindAutoEntry(entry)) {
        blocked = true;
        return;
      }
      victims.add(entry);
      changed = true;
    };

    while (changed && !blocked && guard < 20) {
      if (shouldStopAutoSchedule('bind-eviction')) return null;
      changed = false;
      guard++;
      const current = localSchedule.filter(entry => !victims.has(entry));
      const currentLookup = buildScheduleLookup(current);
      const currentSlotEntries = currentLookup.entriesBySlot.get(day + '|' + per) || [];
      currentSlotEntries.forEach(entry => {
        if (targetClasses.has(String(entry['班級代碼']))) {
          addVictim(entry);
          return;
        }
        const entryTeachers = resolveAutoTeacherCodes(entry);
        if (entryTeachers.some(identity => teacherIdentities.has(identity) || exclusivePeers.has(identity))) addVictim(entry);
      });

      const requestedRooms = new Map();
      roundLsn.forEach(lesson => {
        const roomCode = getSubjectRoomCode(lesson.subjectCode);
        if (!roomCode) return;
        const request = requestedRooms.get(roomCode) || { count: 0, subjectCode: lesson.subjectCode };
        request.count++;
        requestedRooms.set(roomCode, request);
      });
      requestedRooms.forEach((request, roomCode) => {
        const capacity = getSubjectRoomCapacity(request.subjectCode);
        if (request.count > capacity) {
          blocked = true;
          return;
        }
         const roomEntries = currentSlotEntries.filter(entry =>
           !isPatrolScheduleEntry(entry) &&
           getSubjectRoomCode(entry['科目代碼']) === roomCode
         );
        const need = roomEntries.length + request.count - capacity;
        if (need > 0) roomEntries.slice(0, need).forEach(addVictim);
      });

      const requestedSubjects = new Map();
      roundLsn.forEach(lesson => {
        const subject = idx.subjectByCode[String(lesson.subjectCode)];
        const maxClasses = subject ? parseInt(subject['同時最多班數'] || '0', 10) : 0;
        if (maxClasses <= 0) return;
        const subjectCode = String(lesson.subjectCode);
        const request = requestedSubjects.get(subjectCode) || { count: 0, maxClasses };
        request.count++;
        requestedSubjects.set(subjectCode, request);
      });
      requestedSubjects.forEach((request, subjectCode) => {
        if (request.count > request.maxClasses) {
          blocked = true;
          return;
        }
         const subjectEntries = currentSlotEntries.filter(entry => String(entry['科目代碼']) === subjectCode);
        const need = subjectEntries.length + request.count - request.maxClasses;
        if (need > 0) subjectEntries.slice(0, need).forEach(addVictim);
      });

      // 綁班候選格除了看「目標格」本身，也要處理會讓整組無法落位的周邊軟硬條件：
      // 同班同科同日、科目最多連日，以及教師最大連堂。只讓普通課程讓位，
      // 鎖課、必排與既有綁班仍由 addVictim() 擋住。
       roundLsn.forEach(lesson => {
        if (!canPlaceClassSubjectOnDay(
          lesson.classCode,
          lesson.subjectCode,
          day,
          current,
          currentLookup
        )) {
          current
            .filter(entry =>
              String(entry['班級代碼']) === String(lesson.classCode) &&
              String(entry['科目代碼']) === String(lesson.subjectCode) &&
              parseInt(entry['星期'], 10) === day
            )
            .slice(0, 1)
            .forEach(addVictim);
        }

        if (!canPlaceSubjectWithinMaxConsecutiveDays(
          lesson.classCode,
          lesson.subjectCode,
          day,
          current,
          currentLookup
        )) {
          current
            .filter(entry =>
              String(entry['班級代碼']) === String(lesson.classCode) &&
              String(entry['科目代碼']) === String(lesson.subjectCode)
            )
            .sort((left, right) =>
              Math.abs(parseInt(right['星期'], 10) - day) - Math.abs(parseInt(left['星期'], 10) - day)
            )
            .slice(0, 1)
            .forEach(addVictim);
        }

        getAutoTeacherCodes(autoTeacherInput(lesson)).forEach(teacherToken => {
          const teacherKey = canonicalAutoTeacherCode(teacherToken);
          const teacher = idx.teacherByCode[teacherKey];
          const maxConsec = teacher ? parseInt(teacher['最大連堂節數'] || '2', 10) : 2;
          if (countConsecutiveInLocal(current, teacherToken, day, per, currentLookup) <= maxConsec) return;
          current
            .filter(entry =>
              parseInt(entry['星期'], 10) === day &&
              autoTeacherMatches(entry, teacherToken)
            )
            .sort((left, right) =>
              Math.abs(parseInt(right['節次'], 10) - per) - Math.abs(parseInt(left['節次'], 10) - per)
            )
            .slice(0, 1)
            .forEach(addVictim);
        });
      });
    }

    if (blocked || guard >= 20) return null;
    const remaining = localSchedule.filter(entry => !victims.has(entry));
    const lookup = buildScheduleLookup(remaining);
    return roundLsn.every(lesson =>
      isSlotValid(lesson.classCode, lesson.subjectCode, autoTeacherInput(lesson), day, per, remaining, lookup)
    ) ? [...victims] : null;
  }

  const BIND_GROUP_SLOT_YIELD_INTERVAL = 12;
  const BIND_GROUP_SEARCH_YIELD_INTERVAL = 24;
  const BIND_GROUP_SEARCH_TIME_BUDGET_MS = 60000;
  async function findAndScheduleBlockGroup(group, groupIndex, totalGroups, bindAttempt = 0) {
    if (shouldStopAutoSchedule('bind')) return false;
    const subList = typeof group['科目清單'] === 'string'
      ? group['科目清單'].split(',').map(value => value.trim()).filter(Boolean)
      : (typeof group['科目代碼'] === 'string' ? group['科目代碼'].split(',').map(value => value.trim()).filter(Boolean) : []);
    const clsList = typeof group['班級清單'] === 'string'
      ? group['班級清單'].split(',').map(value => value.trim()).filter(Boolean)
      : (Array.isArray(group['班級清單']) ? group['班級清單'] : (typeof group['班級清單'] === 'number' ? String(group['班級清單']).match(/.{3}/g) || [] : []));
    if (clsList.length < 2) return true;
    if (invalidBindGroups.has(group.__bindParentGroup || group)) {
      console.warn('綁班每週節數不一致，整組略過：' + clsList.join('、'));
      return false;
    }
    // 綁班群組必須原子完成：若其中一個科目／輪次失敗，回復整個群組，
    // 不讓半套綁班佔住時段，影響下一輪群組搜尋。
    const groupScheduleSnapshot = [...localSchedule];
    const groupRequeueSnapshot = [...requeuedLessons];
    const groupFlagSnapshot = [...scheduledFlag];
    const groupSuccessSnapshot = successCount;
    const restoreGroupSnapshot = () => {
      replaceLocalSchedule(groupScheduleSnapshot);
      requeuedLessons.length = 0;
      requeuedLessons.push(...groupRequeueSnapshot);
      for (let index = 0; index < scheduledFlag.length; index++) scheduledFlag[index] = groupFlagSnapshot[index];
      successCount = groupSuccessSnapshot;
    };
    let groupSolved = true;
    let bindRoundDiagnostics = [];
    updateProgress('綁班群組配課中（' + totalGroups + ' 群組，目前第 ' + (groupIndex + 1) + ' 組）…');
    await yieldToUI();

    const members = getAutoBindMembers(group);
    const memberKeys = new Set(members.map(member => getAutoBindMemberKey(member.classCode, member.subjectCode)));
    const subjectOrder = new Map(subList.map((subjectCode, index) => [subjectCode, index]));
    const byClass = {};
    pendingLessons.forEach((lesson, index) => {
      if (scheduledFlag[index] || !memberKeys.has(getAutoBindMemberKey(lesson.classCode, lesson.subjectCode))) return;
      if (!byClass[lesson.classCode]) byClass[lesson.classCode] = [];
      byClass[lesson.classCode].push({ index, lesson });
    });
    const classCodes = [...new Set(members.map(member => member.classCode))];
    classCodes.forEach(classCode => {
      (byClass[classCode] || []).sort((left, right) =>
        (subjectOrder.get(left.lesson.subjectCode) ?? Number.MAX_SAFE_INTEGER) -
        (subjectOrder.get(right.lesson.subjectCode) ?? Number.MAX_SAFE_INTEGER) ||
        left.index - right.index
      );
    });
    const rounds = Math.max(0, ...classCodes.map(classCode => byClass[classCode]?.length || 0));
    if (classCodes.length < 2 || rounds === 0) return true;
    console.log('  綁班「' + (group['群組名稱'] || group['群組ID']) + '」：' + classCodes.length + ' 班，最多 ' + rounds + ' 節');

    const bindRoundData = [];
    let bindDefinitionValid = true;
    for (let round = 0; round < rounds; round++) {
      const roundItems = classCodes.map(classCode => byClass[classCode]?.[round]).filter(Boolean);
      if (roundItems.length !== classCodes.length) {
        console.warn('綁班各班待排節數不一致，無法拆班個別排入：' + classCodes.join('、'));
        bindDefinitionValid = false;
        break;
      }
      const roundIndexes = roundItems.map(item => item.index);
      const roundLsn = roundItems.map(item => item.lesson);
      const repeatedTeachers = getRepeatedTeacherCodes(roundLsn);
      if (repeatedTeachers.length > 0) {
        console.warn('綁班組內教師衝堂，整組停止：' + repeatedTeachers.join('、'));
        bindDefinitionValid = false;
        break;
      }
      bindRoundData.push({ round, roundIndexes, roundLsn });
    }
    if (!bindDefinitionValid || bindRoundData.length !== rounds) {
      groupSolved = false;
    } else {
      const initialLookup = buildScheduleLookup(localSchedule);
      const directCandidateCounts = new Map();
      const countDirectCandidates = roundData => {
        let count = 0;
        for (let day = 1; day <= 5; day++) {
          for (let per = autoStartPeriod; per <= autoEndPeriod; per++) {
            if (roundData.roundLsn.every(lesson => isSlotValid(
              lesson.classCode,
              lesson.subjectCode,
              autoTeacherInput(lesson),
              day,
              per,
              localSchedule,
              initialLookup
            ))) count++;
          }
        }
        directCandidateCounts.set(roundData.round, count);
        return count;
      };
      bindRoundData.sort((left, right) => countDirectCandidates(left) - countDirectCandidates(right) || left.round - right.round);
      bindRoundDiagnostics = bindRoundData.map(roundData => ({
        round: roundData.round + 1,
        directCommonSlots: directCandidateCounts.get(roundData.round) || 0
      }));
      const BIND_GROUP_BACKTRACK_NODE_LIMIT = 20000;
      const BIND_GROUP_BRANCH_LIMIT = 35;
      let bindSearchNodes = 0;
      let bindSearchTimedOut = false;
      const bindSearchStartedAt = Date.now();
      const bindSearchTimeBudgetMs = Math.min(
        BIND_GROUP_SEARCH_TIME_BUDGET_MS,
        Math.max(
          5000,
          Math.floor((autoScheduleDeadline - bindSearchStartedAt) / Math.max(1, Math.min(6, totalGroups - groupIndex)))
        )
      );
      const shouldStopBindSearch = () => {
        if (shouldStopAutoSchedule('bind-search') || Date.now() - bindSearchStartedAt >= bindSearchTimeBudgetMs) {
          bindSearchTimedOut = true;
          return true;
        }
        return false;
      };

      async function searchBindRounds(roundPosition) {
        if (roundPosition >= bindRoundData.length) return true;
        if (bindSearchNodes >= BIND_GROUP_BACKTRACK_NODE_LIMIT || shouldStopBindSearch()) return false;

        const { round, roundIndexes, roundLsn } = bindRoundData[roundPosition];
        if (bindSearchNodes % BIND_GROUP_SEARCH_YIELD_INTERVAL === 0) {
          updateProgress(`第 ${round + 1} 輪綁班群組補配中（第 ${groupIndex + 1} 組，搜尋 ${bindSearchNodes + 1}）…`);
          await yieldToUI();
        }

        const candidatesBySlot = new Map();
        const lookup = buildScheduleLookup(localSchedule);
        let slotChecks = 0;
        for (let day = 1; day <= 5; day++) {
          for (let per = autoStartPeriod; per <= autoEndPeriod; per++) {
            if (shouldStopBindSearch()) return false;
            if (++slotChecks % BIND_GROUP_SLOT_YIELD_INTERVAL === 0) await yieldToUI();
            if (!roundLsn.every(lesson => isSlotValid(lesson.classCode, lesson.subjectCode, autoTeacherInput(lesson), day, per, localSchedule, lookup))) continue;
            const score = roundLsn.reduce((sum, lesson) => sum + evaluateSlotScore(lesson, day, per, true, lookup), 0);
            candidatesBySlot.set(day + '|' + per, { day, per, score, tieBreak: autoRandomTieBreak(), toEvict: [] });
          }
        }

        for (let day = 1; day <= 5; day++) {
          for (let per = autoStartPeriod; per <= autoEndPeriod; per++) {
            if (shouldStopBindSearch()) return false;
            const slotKey = day + '|' + per;
            if (candidatesBySlot.has(slotKey)) continue;
            const toEvict = collectBindEvictions(roundLsn, day, per);
            if (!toEvict || toEvict.length === 0) continue;
            const score = roundLsn.reduce((sum, lesson) => sum + evaluateSlotScore(lesson, day, per, true, buildScheduleLookup(localSchedule)), 0) - toEvict.length * 4;
            candidatesBySlot.set(slotKey, { day, per, score, tieBreak: autoRandomTieBreak(), toEvict });
          }
        }

        const candidateValues = [...candidatesBySlot.values()];
        const prioritizedCandidates = prioritizeAutoCandidates(
          candidateValues,
          roundLsn,
          candidate => {
            const candidateSchedule = candidate.toEvict?.length
              ? localSchedule.filter(entry => !candidate.toEvict.includes(entry))
              : localSchedule;
            return {
              schedule: candidateSchedule,
              lookup: buildScheduleLookup(candidateSchedule)
            };
          },
          (left, right) => (left.toEvict?.length || 0) - (right.toEvict?.length || 0) || compareAutoCandidates(left, right)
        );
        // 同一批群組重試時，不要每次都走同一條候選路徑；旋轉完整候選集合，
        // 讓共享教師的群組有機會取得不同的合法時段組合，仍不放寬任何硬限制。
        const rotation = prioritizedCandidates.length > 1 && bindAttempt > 0
          ? (bindAttempt * 11 + groupIndex * 3 + roundPosition * 7) % prioritizedCandidates.length
          : 0;
        const rotatedCandidates = rotation > 0
          ? prioritizedCandidates.slice(rotation).concat(prioritizedCandidates.slice(0, rotation))
          : prioritizedCandidates;
        const candidates = rotatedCandidates.slice(0, BIND_GROUP_BRANCH_LIMIT);
        for (const candidate of candidates) {
          if (++bindSearchNodes > BIND_GROUP_BACKTRACK_NODE_LIMIT || shouldStopBindSearch()) break;
          const scheduleSnapshot = [...localSchedule];
          const requeueSnapshot = [...requeuedLessons];
          const flagSnapshot = [...scheduledFlag];
          const successSnapshot = successCount;

          candidate.toEvict.forEach(entry => {
            const entryIndex = localSchedule.indexOf(entry);
            if (entryIndex >= 0) removeLocalScheduleAt(entryIndex);
            requeuedLessons.push(makeAutoLessonFromScheduleEntry(entry, 'bind_evict'));
          });
          roundLsn.forEach((lesson, lessonIndex) => {
            appendLocalSchedule({
              '課表ID': 'AUTO_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4) + '_B' + round + '_' + lessonIndex,
              '班級代碼': String(lesson.classCode),
              '星期': candidate.day,
              '節次': candidate.per,
              '科目代碼': String(lesson.subjectCode),
              '教師姓名': autoTeacherValue(lesson),
               '課堂屬性': getAutoScheduleAttribute(lesson, candidate.day, candidate.per, localSchedule, buildScheduleLookup(localSchedule)),
               '是否鎖定': 'FALSE',
               '__isBindGroup': true,
              '__bindGroupKey': String(group['群組ID'] || group['群組名稱'] || groupIndex) + '|' + round
            });
            successCount++;
            scheduledFlag[roundIndexes[lessonIndex]] = true;
          });

          if (await searchBindRounds(roundPosition + 1)) return true;

          replaceLocalSchedule(scheduleSnapshot);
          requeuedLessons.length = 0;
          requeuedLessons.push(...requeueSnapshot);
          for (let index = 0; index < scheduledFlag.length; index++) scheduledFlag[index] = flagSnapshot[index];
          successCount = successSnapshot;
        }
        return false;
      }

      const bindSolved = await searchBindRounds(0);
      if (!bindSolved) {
        groupSolved = false;
        console.warn((bindSearchTimedOut ? '綁班搜尋逾時，保留未排：' : '綁班整組回溯後仍無共同可用時段：') + classCodes.join('、') + '，搜尋 ' + bindSearchNodes + ' 個節點');
        bindFailureDiagnostics.set(
          String(group['群組ID'] || group['群組名稱'] || groupIndex) + '|' + classCodes.join(','),
          {
            groupId: String(group['群組ID'] || group['群組名稱'] || groupIndex),
            groupName: String(group['群組名稱'] || ''),
            classCodes,
            rounds,
            roundDiagnostics: bindRoundDiagnostics,
            searchNodes: bindSearchNodes,
            searchTimedOut: bindSearchTimedOut,
            searchBudgetMs: bindSearchTimeBudgetMs
          }
        );
      } else {
        const diagnosticKey = String(group['群組ID'] || group['群組名稱'] || groupIndex) + '|' + classCodes.join(',');
        bindFailureDiagnostics.delete(diagnosticKey);
        console.log('    綁班整組完成：' + classCodes.join('、') + '，共 ' + rounds + ' 輪，搜尋 ' + bindSearchNodes + ' 個節點');
      }
    }
    if (!groupSolved) restoreGroupSnapshot();
    return groupSolved;
  }

  await yieldToUI();
  const bindCandidateGroups = state.blockGroups.flatMap(expandAutoBindGroupCohorts);
  updateProgress('第二階段：綁班群組配對中（' + bindCandidateGroups.length + ' 組）…');
  markAutoScheduleProfile('bind');
  const bindPassScheduleSnapshot = [...localSchedule];
  const bindPassRequeueSnapshot = [...requeuedLessons];
  const bindPassFlagSnapshot = [...scheduledFlag];
  const bindPassSuccessSnapshot = successCount;
  const attemptedBindOrders = new Set();
  const maxBindOrderAttempts = Math.max(6, Math.min(10, bindCandidateGroups.length * 2 + 2));
  const isMandatoryBindGroup = group => {
    const groupSubjects = typeof group['科目清單'] === 'string'
      ? group['科目清單'].split(',').map(value => value.trim()).filter(Boolean)
      : (typeof group['科目代碼'] === 'string' ? group['科目代碼'].split(',').map(value => value.trim()).filter(Boolean) : []);
    const groupClasses = typeof group['班級清單'] === 'string'
      ? group['班級清單'].split(',').map(value => value.trim()).filter(Boolean)
      : (Array.isArray(group['班級清單']) ? group['班級清單'].map(value => String(value).trim()) : []);
    return pendingLessons.some((lesson, index) =>
      !scheduledFlag[index] &&
      lesson.hasMustRule &&
      groupClasses.includes(String(lesson.classCode)) &&
      groupSubjects.some(subjectCode => String(lesson.subjectCode) === String(subjectCode))
    );
  };
  const estimateBindGroupSlots = group => {
    const members = getAutoBindMembers(group);
    const classCodes = [...new Set(members.map(member => member.classCode))];
    if (members.length === 0 || classCodes.length < 2) return Number.MAX_SAFE_INTEGER;
    if (invalidBindGroups.has(group.__bindParentGroup || group)) return 0;
    const lookup = buildScheduleLookup(localSchedule);
    const memberKeys = new Set(members.map(member => getAutoBindMemberKey(member.classCode, member.subjectCode)));
    const subjectOrder = new Map(getAutoBindSubjects(group).map((subjectCode, index) => [subjectCode, index]));
    const byClass = {};
    pendingLessons.forEach((lesson, index) => {
      if (scheduledFlag[index] || !memberKeys.has(getAutoBindMemberKey(lesson.classCode, lesson.subjectCode))) return;
      if (!byClass[lesson.classCode]) byClass[lesson.classCode] = [];
      byClass[lesson.classCode].push({ index, lesson });
    });
    classCodes.forEach(classCode => {
      (byClass[classCode] || []).sort((left, right) =>
        (subjectOrder.get(left.lesson.subjectCode) ?? Number.MAX_SAFE_INTEGER) -
        (subjectOrder.get(right.lesson.subjectCode) ?? Number.MAX_SAFE_INTEGER) ||
        left.index - right.index
      );
    });
    const activeClassCodes = classCodes.filter(classCode => (byClass[classCode] || []).length > 0);
    if (activeClassCodes.length < 2) return Number.MAX_SAFE_INTEGER;
    const rounds = Math.max(...activeClassCodes.map(classCode => byClass[classCode].length));
    let minimumSharedSlots = Number.MAX_SAFE_INTEGER;
    for (let round = 0; round < rounds; round++) {
      const roundLessons = activeClassCodes.map(classCode => byClass[classCode][round]).filter(Boolean).map(item => item.lesson);
      if (roundLessons.length !== activeClassCodes.length) return 0;
      let sharedSlots = 0;
      for (let day = 1; day <= 5; day++) {
        for (let period = autoStartPeriod; period <= autoEndPeriod; period++) {
          if (roundLessons.every(lesson => isSlotValid(
            lesson.classCode,
            lesson.subjectCode,
            autoTeacherInput(lesson),
            day,
            period,
            localSchedule,
            lookup
          ))) sharedSlots++;
        }
      }
      minimumSharedSlots = Math.min(minimumSharedSlots, sharedSlots);
    }
    return minimumSharedSlots;
  };
  updateProgress('分析綁班群組可行格位中…');
  const getBindCohortComplexity = group => {
    const members = getAutoBindMembers(group);
    const memberKeys = new Set(members.map(member => getAutoBindMemberKey(member.classCode, member.subjectCode)));
    const counts = new Map();
    pendingLessons.forEach((lesson, index) => {
      if (scheduledFlag[index] || !memberKeys.has(getAutoBindMemberKey(lesson.classCode, lesson.subjectCode))) return;
      const classCode = String(lesson.classCode || '').trim();
      counts.set(classCode, (counts.get(classCode) || 0) + 1);
    });
    const classCount = new Set(members.map(member => member.classCode)).size;
    const rounds = Math.max(0, ...counts.values());
    return { rounds, classCount, work: rounds * classCount };
  };
  const bindComplexity = new Map(bindCandidateGroups.map(group => [group, getBindCohortComplexity(group)]));
  const bindDifficulty = new Map(bindCandidateGroups.map(group => [group, estimateBindGroupSlots(group)]));
  const bindTieBreak = new Map(bindCandidateGroups.map(group => [group, autoRandomTieBreak()]));
  let bindOrder = [...bindCandidateGroups].filter(group => !invalidBindGroups.has(group.__bindParentGroup || group)).sort((left, right) => {
    const mandatoryDelta = Number(isMandatoryBindGroup(right)) - Number(isMandatoryBindGroup(left));
    if (mandatoryDelta !== 0) return mandatoryDelta;
    const leftComplexity = bindComplexity.get(left) || { work: 0, rounds: 0, classCount: 0 };
    const rightComplexity = bindComplexity.get(right) || { work: 0, rounds: 0, classCount: 0 };
    if (leftComplexity.work !== rightComplexity.work) return rightComplexity.work - leftComplexity.work;
    if (leftComplexity.rounds !== rightComplexity.rounds) return rightComplexity.rounds - leftComplexity.rounds;
    const leftSlots = bindDifficulty.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightSlots = bindDifficulty.get(right) ?? Number.MAX_SAFE_INTEGER;
    if (leftSlots !== rightSlots) return leftSlots - rightSlots;
    const classDelta = getAutoBindClasses(right).length - getAutoBindClasses(left).length;
    if (classDelta !== 0) return classDelta;
    return (bindTieBreak.get(left) || 0.5) - (bindTieBreak.get(right) || 0.5);
  });
  let unresolvedBindGroups = [];
  for (let bindAttempt = 0; bindAttempt < maxBindOrderAttempts; bindAttempt++) {
    if (bindAttempt > 0) {
      replaceLocalSchedule(bindPassScheduleSnapshot);
      requeuedLessons.length = 0;
      requeuedLessons.push(...bindPassRequeueSnapshot);
      for (let index = 0; index < scheduledFlag.length; index++) scheduledFlag[index] = bindPassFlagSnapshot[index];
      successCount = bindPassSuccessSnapshot;
    }
    const orderSignature = bindOrder.map(group => String(group['群組ID'] || group['群組名稱'] || '')).join('|');
    attemptedBindOrders.add(orderSignature);
    unresolvedBindGroups = [];
    updateProgress('綁班群組第 ' + (bindAttempt + 1) + ' 輪整批搜尋中…');
    for (let groupIndex = 0; groupIndex < bindOrder.length; groupIndex++) {
      if (shouldStopAutoSchedule('bind-order')) {
        unresolvedBindGroups.push(...bindOrder.slice(groupIndex));
        break;
      }
      const solved = await findAndScheduleBlockGroup(bindOrder[groupIndex], groupIndex, bindOrder.length, bindAttempt);
      if (!solved) unresolvedBindGroups.push(bindOrder[groupIndex]);
    }
    if (autoScheduleTimedOut) break;
    if (unresolvedBindGroups.length === 0) break;
    const failedSet = new Set(unresolvedBindGroups);
    const remainingGroups = bindOrder.filter(group => !failedSet.has(group));
    let nextOrder = [...unresolvedBindGroups, ...remainingGroups];
    let nextSignature = nextOrder.map(group => String(group['群組ID'] || group['群組名稱'] || '')).join('|');
    if (attemptedBindOrders.has(nextSignature)) {
      nextOrder = [...unresolvedBindGroups, ...remainingGroups.reverse()];
      nextSignature = nextOrder.map(group => String(group['群組ID'] || group['群組名稱'] || '')).join('|');
    }
    if (attemptedBindOrders.has(nextSignature)) break;
    bindOrder = nextOrder;
  }
  if (unresolvedBindGroups.length > 0) {
    console.warn('綁班整批搜尋仍有 ' + unresolvedBindGroups.length + ' 組未完成。');
  }
  const unresolvedBindLessons = pendingLessons.filter((lesson, index) =>
    !scheduledFlag[index] && !!getBindGroupClasses(lesson.subjectCode, lesson.classCode)
  );
  if (unresolvedBindLessons.length > 0) {
    unresolvedBindLessons.forEach(lesson => {
      lesson.failureReason = bindWeeklyMismatchByKey.has(String(lesson.classCode) + '|' + String(lesson.subjectCode))
        ? 'bind-group-weekly-mismatch'
        : 'bind-group-no-common-slot';
      bindFailureLessons.push(lesson);
    });
    console.warn('綁班前置關卡未完成，一般課程不會代替綁班個別排入：' + unresolvedBindLessons.length + ' 節');
  }
  // 第一階段必排已完成，現在才進入綁班後的一般課程佇列。
  // 開始進行排課（已排入的綁班群組課程自動跳過）
  await yieldToUI();
  updateProgress(`排入一般課程 (${autoStartPeriod}~${autoEndPeriod} 節)…`);
  // 綁班課程已在前置階段整組處理；無論成功或失敗，都不進入一般課程佇列個別排入。
  const lessonQueue = pendingLessons.map((_, index) => index).filter(index =>
    !scheduledFlag[index] && !getBindGroupClasses(pendingLessons[index].subjectCode, pendingLessons[index].classCode)
  );
  markAutoScheduleProfile('general');
  const generalValidSlotCache = new WeakMap();
  function getGeneralValidSlots(lesson, scheduleLookup) {
    const cached = generalValidSlotCache.get(lesson);
    if (cached?.version === localScheduleMutationVersion) return cached.slots;
    const slots = [];
    let complete = true;
    slotSearch: for (let day = 1; day <= 5; day++) {
      for (let period = autoStartPeriod; period <= autoEndPeriod; period++) {
        if (shouldStopAutoSchedule('general-availability')) {
          complete = false;
          break slotSearch;
        }
        if (isSlotValid(lesson.classCode, lesson.subjectCode, autoTeacherInput(lesson), day, period, localSchedule, scheduleLookup)) {
          slots.push({ day, per: period });
        }
      }
    }
    if (complete) generalValidSlotCache.set(lesson, { version: localScheduleMutationVersion, slots });
    return slots;
  }
  function countAvailableSlots(lesson, scheduleLookup, validationOptions = {}) {
    if (getBindGroupClasses(lesson.subjectCode, lesson.classCode)) return 0;
    if (Object.keys(validationOptions).length === 0) return getGeneralValidSlots(lesson, scheduleLookup).length;
    let count = 0;
    for (let day = 1; day <= 5; day++) for (let period = autoStartPeriod; period <= autoEndPeriod; period++) {
      if (shouldStopAutoSchedule('availability-count')) return count;
      if (isSlotValid(lesson.classCode, lesson.subjectCode, autoTeacherInput(lesson), day, period, localSchedule, scheduleLookup, validationOptions)) count++;
    }
    return count;
  }
  function estimateAutoAvailableSlots(lesson, scheduleLookup) {
    if (getBindGroupClasses(lesson.subjectCode, lesson.classCode)) return 0;
    const domainSlots = Math.max(0, 5 * (autoEndPeriod - autoStartPeriod + 1));
    if (domainSlots === 0) return 0;
    let estimate = domainSlots;
    const classUsed = scheduleLookup?.classActiveEntryCounts?.get(String(lesson.classCode)) || 0;
    estimate = Math.min(estimate, Math.max(0, domainSlots - classUsed));
    if (lesson.teacherCode) estimate = Math.min(estimate, Math.max(0, Number(lesson.teacherAvailableSlots) || 0));
    const applicableRules = getApplicableRules(lesson.subjectCode, lesson.classCode);
    const mandatorySlots = applicableRules
      .filter(entry => isMandatoryAutoRule(entry.rule))
      .flatMap(entry => entry.slots)
      .filter(slot => slot.period >= autoStartPeriod && slot.period <= autoEndPeriod);
    if (mandatorySlots.length > 0) estimate = Math.min(estimate, mandatorySlots.length);
    const forbiddenSlots = applicableRules
      .filter(entry => isForbiddenAutoRule(entry.rule))
      .flatMap(entry => entry.slots)
      .filter(slot => slot.period >= autoStartPeriod && slot.period <= autoEndPeriod).length;
    estimate = Math.max(0, estimate - forbiddenSlots);
    return estimate;
  }
  function classifyNoLegalSlot(lesson, fallbackReason = 'no-legal-slot') {
    if (fallbackReason === 'no-legal-slot' && autoTightClassCodes.has(String(lesson?.classCode || ''))) {
      return 'class-zero-slack-no-legal-slot';
    }
    return fallbackReason;
  }
  function compareGeneralLessonPriority(left, right) {
    const manualPriorityDelta = (Number(right.priorityScore) || 0) - (Number(left.priorityScore) || 0);
    if (manualPriorityDelta !== 0) return manualPriorityDelta;
    // 先排真正最難安排的課，避免寬鬆課程先佔掉稀有格位。
    // dynamicDifficulty 近似 dom/wdeg：可用域越小、歷次失敗資源越集中者越優先。
    const dynamicDifficultyDelta = (Number(right.dynamicDifficulty) || 0) - (Number(left.dynamicDifficulty) || 0);
    if (dynamicDifficultyDelta !== 0) return dynamicDifficultyDelta;
    const availabilityDelta = (Number(left.availableSlots) || 0) - (Number(right.availableSlots) || 0);
    if (availabilityDelta !== 0) return availabilityDelta;
    const subjectConstraintDelta = (Number(right.subjectConstraintScore) || 0) - (Number(left.subjectConstraintScore) || 0);
    if (subjectConstraintDelta !== 0) return subjectConstraintDelta;
    const constraintDelta = (Number(right.teacherConstraintScore) || 0) - (Number(left.teacherConstraintScore) || 0);
    if (constraintDelta !== 0) return constraintDelta;
    return (Number(left.index) || 0) - (Number(right.index) || 0);
  }
  const AUTO_QUEUE_REPRIORITIZE_INTERVAL = lessonQueue.length > 256 ? 128 : 8;
  const AUTO_PRIORITY_YIELD_INTERVAL = 8;
  for (let queuePos = 0; queuePos < lessonQueue.length; queuePos++) {
    if (shouldStopAutoSchedule('general')) {
      lessonQueue.slice(queuePos).forEach(index => markAutoFailure(pendingLessons[index], 'time-budget'));
      break;
    }
    if (queuePos % AUTO_QUEUE_REPRIORITIZE_INTERVAL === 0) {
      const remainingQueue = lessonQueue.slice(queuePos);
      const priorityLookup = buildScheduleLookup(localSchedule);
      const prioritizedQueue = [];
      for (let priorityPos = 0; priorityPos < remainingQueue.length; priorityPos++) {
        if (shouldStopAutoSchedule('general-priority')) break;
        if (priorityPos % AUTO_PRIORITY_YIELD_INTERVAL === 0) {
          await yieldToUI();
          updateProgress('一般課程優先排序中（' + (queuePos + priorityPos) + '/' + lessonQueue.length + '）…');
        }
        const lessonIndex = remainingQueue[priorityPos];
        const availableSlots = estimateAutoAvailableSlots(pendingLessons[lessonIndex], priorityLookup);
        prioritizedQueue.push({
          index: lessonIndex,
          priorityScore: pendingLessons[lessonIndex].priorityScore,
          subjectConstraintScore: pendingLessons[lessonIndex].subjectConstraintScore,
          teacherConstraintScore: pendingLessons[lessonIndex].teacherConstraintScore,
          availableSlots,
          dynamicPressure: getAutoConflictPressure(pendingLessons[lessonIndex]),
          dynamicDifficulty: getAutoDynamicDifficulty(pendingLessons[lessonIndex], availableSlots)
        });
      }
      prioritizedQueue.sort(compareGeneralLessonPriority);
      const exactPriorityLimit = Math.min(64, prioritizedQueue.length);
      for (let exactIndex = 0; exactIndex < exactPriorityLimit; exactIndex++) {
        if (shouldStopAutoSchedule('general-exact-priority')) break;
        const priorityItem = prioritizedQueue[exactIndex];
        const lesson = pendingLessons[priorityItem.index];
        const availableSlots = countAvailableSlots(lesson, priorityLookup);
        priorityItem.availableSlots = availableSlots;
        priorityItem.dynamicPressure = getAutoConflictPressure(lesson);
        priorityItem.dynamicDifficulty = getAutoDynamicDifficulty(lesson, availableSlots);
      }
      prioritizedQueue.sort(compareGeneralLessonPriority);
      lessonQueue.splice(queuePos, remainingQueue.length, ...prioritizedQueue.map(item => item.index));
    }
    if (autoScheduleTimedOut) {
      lessonQueue.slice(queuePos).forEach(index => markAutoFailure(pendingLessons[index], 'time-budget'));
      break;
    }
    const li = lessonQueue[queuePos];
    if (queuePos > 0 && queuePos % 20 === 0) {
      await yieldToUI();
      updateProgress(`排入一般課程… (${successCount}/${pendingLessons.length})`);
    }
    const lesson = pendingLessons[li];

    // 綁班群組科目：若群組排課失敗，不允許個別排入
    if (getBindGroupClasses(lesson.subjectCode, lesson.classCode)) {
      console.log(`  ❌ 綁班課程被拒絕排入: ${lesson.subjectCode} (班級 ${lesson.classCode})`);
      markAutoFailure(lesson, 'bind-group-no-common-slot');
      continue;
    }

    const lessonLookup = buildScheduleLookup(localSchedule);
    const candidateSlots = getGeneralValidSlots(lesson, lessonLookup)
      .map(slot => ({ ...slot, score: evaluateSlotScore(lesson, slot.day, slot.per, true, lessonLookup), tieBreak: autoRandomTieBreak() }));

    if (candidateSlots.length > 0) {
      const best = selectAutoCandidate(candidateSlots, lesson);
      appendLocalSchedule({
        '課表ID': 'AUTO_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        '班級代碼': String(lesson.classCode),
        '星期': best.day, '節次': best.per,
        '科目代碼': String(lesson.subjectCode),
        '教師姓名': autoTeacherValue(lesson),
        '課堂屬性': getAutoScheduleAttribute(lesson, best.day, best.per, localSchedule, lessonLookup),
              '是否鎖定': 'FALSE'
      });
      successCount++;
    } else {
      // 4. 智慧交換機制：嘗試移動已排課程來騰出位置
      let swapped = false;
      if (!autoScheduleTimedOut && optSmartSwap) {
        // 必排科目：可移動任何班級的課程來騰出指定時段
        // 一般科目：只移動同班級的課程
        const trySwapAll = lesson.hasMustRule && lesson.mustRuleSlots && lesson.mustRuleSlots.length > 0;
        const movableClassSlots = new Map();
        localSchedule.forEach((entry, entryIndex) => {
          if (String(entry['班級代碼']) !== String(lesson.classCode)) return;
          const entryDay = parseInt(entry['星期'], 10);
          const entryPeriod = parseInt(entry['節次'], 10);
          if (entryDay < 1 || entryDay > 5 || entryPeriod < autoStartPeriod || entryPeriod > autoEndPeriod) return;
          if (String(entry['是否鎖定']).toUpperCase() === 'TRUE') return;
          if (isFrozenAutoEntry(entry) || isMustPlacedCourse(entry) || isBindAutoEntry(entry)) return;
          movableClassSlots.set(entryDay + '|' + entryPeriod, entryIndex);
        });

        for (let day = 1; day <= 5 && !swapped; day++) {
          for (let per = autoStartPeriod; per <= autoEndPeriod && !swapped; per++) {
            if (shouldStopAutoSchedule('general-swap')) break;
            // 必排：只在必排時段嘗試交換（精準命中）
            if (trySwapAll) {
              const isMustDayPer = lesson.mustRuleSlots.some(s => s.day === day && s.per === per);
              if (!isMustDayPer) continue;
            }

            // 必排：先找同班級是否佔用此格（清出目標班級的指定時段）
            const occupiedIdx = movableClassSlots.get(day + '|' + per);
            if (occupiedIdx >= 0) {
              const victim = localSchedule[occupiedIdx];
              const tempSched = localSchedule.filter((_, i) => i !== occupiedIdx);
              const tempLookup = buildScheduleLookup(tempSched);
              if (isSlotValid(lesson.classCode, lesson.subjectCode, autoTeacherInput(lesson), day, per, tempSched, tempLookup)) {
                // 建立「含新課（lesson 排在 day/per）」的 lookup，用於驗證 victim 的新位置
                // 避免：victim 與 lesson 同班同科時，victim 搬到 lesson 同一天卻查不到 lesson 的計數
                const tempSchedWithLesson = [...tempSched, {
                  '班級代碼': String(lesson.classCode),
                  '星期': day, '節次': per,
                  '科目代碼': String(lesson.subjectCode),
                  '教師姓名': autoTeacherValue(lesson)
                }];
                const tempLookupWithLesson = buildScheduleLookup(tempSchedWithLesson);
                // 對所有合法的 victim 新位置評分，選最佳（而非第一個合法）
                let victimCandidate = null;
                for (let newD = 1; newD <= 5; newD++) {
                  for (let newP = autoStartPeriod; newP <= autoEndPeriod; newP++) {
                    if (newD === day && newP === per) continue;
                    // 用含新課的 lookup 驗證 victim 新位置，防止同班同科同日重複
                    if (isSlotValid(victim['班級代碼'], victim['科目代碼'], victim['教師姓名'], newD, newP, tempSchedWithLesson, tempLookupWithLesson)) {
                      victimCandidate = { newD, newP };
                      break;
                    }
                  }
                  if (victimCandidate) break;
                }
                if (victimCandidate && !swapped) {
                  // 選第一個合法位置（swap 不做評分，效能優先）
                  const { newD, newP } = victimCandidate;
                  setLocalScheduleEntry(occupiedIdx, { ...victim, '星期': newD, '節次': newP });
                  appendLocalSchedule({
                    '課表ID': 'AUTO_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                    '班級代碼': String(lesson.classCode),
                    '星期': day, '節次': per,
                    '科目代碼': String(lesson.subjectCode),
                    '教師姓名': autoTeacherValue(lesson),
                    '課堂屬性': getAutoScheduleAttribute(lesson, day, per, localSchedule, buildScheduleLookup(localSchedule)),
                    '是否鎖定': 'FALSE'
                  });
                  successCount++;
                  swapped = true;
                }
              }
            }
          }
        }
      }

      if (!swapped) {
        markAutoFailure(lesson, classifyNoLegalSlot(lesson));
      }
    }
  }

  if (requeuedLessons.length > 0) failList = failList.concat(requeuedLessons);

  // 多輪重跑：失敗的課程在下一輪重新嘗試（最多3輪）
  markAutoScheduleProfile('retry');
  for (let round = 2; round <= 3 && failList.length > 0; round++) {
    if (shouldStopAutoSchedule('retry')) break;
    await yieldToUI();
    updateProgress(`第 ${round} 輪重跑 (${failList.length} 節待排)…`);
    let retryList = [...failList];
    failList = [];

    // 重新排序
    retryList.sort((a, b) => {
      if (a.hasMustRule && !b.hasMustRule) return -1;
      if (!a.hasMustRule && b.hasMustRule) return 1;
      if ((a.priorityScore || 0) !== (b.priorityScore || 0)) {
        return (b.priorityScore || 0) - (a.priorityScore || 0);
      }
      const dynamicPressureDelta = getAutoConflictPressure(b) - getAutoConflictPressure(a);
      if (dynamicPressureDelta !== 0) return dynamicPressureDelta;
      if ((a.subjectConstraintScore || 0) !== (b.subjectConstraintScore || 0)) {
        return (b.subjectConstraintScore || 0) - (a.subjectConstraintScore || 0);
      }
      if (a.maxConsecDays !== b.maxConsecDays) return a.maxConsecDays - b.maxConsecDays;
      if (a.teacherAvailableSlots !== b.teacherAvailableSlots) {
        return a.teacherAvailableSlots - b.teacherAvailableSlots;
      }
      return 0;
    });

    // 重跑時先對綁班群組再次嘗試群組配對
    if (round === 2) {
      const placedSet = new Set();
      state.blockGroups.forEach(g => {
        if (shouldStopAutoSchedule('retry-bind')) return;
    const subList = typeof g['科目清單'] === 'string' ? g['科目清單'].split(',').map(s => s.trim()).filter(Boolean) : (typeof g['科目代碼'] === 'string' ? g['科目代碼'].split(',').map(s => s.trim()).filter(Boolean) : []);
    const clsList = typeof g['班級清單'] === 'string' ? g['班級清單'].split(',').map(c => c.trim()).filter(Boolean) : (Array.isArray(g['班級清單']) ? g['班級清單'] : (typeof g['班級清單'] === 'number' ? String(g['班級清單']).match(/.{3}/g)||[] : []));
        subList.forEach(sub => {
          // 逐輪重建 byCls，排除已排入者，避免 splice 造成索引偏移
          for (let r = 0; r < retryList.length; r++) {
            if (shouldStopAutoSchedule('retry-bind')) break;
            updateProgress(`第 ${round} 輪綁班群組補配中（第 ${r + 1} 輪）…`);
            const byCls = {};
            retryList.forEach((l, i) => {
              if (placedSet.has(i)) return;
              if (String(l.subjectCode) === sub && clsList.includes(l.classCode)) {
                if (!byCls[l.classCode]) byCls[l.classCode] = [];
                byCls[l.classCode].push(i);
              }
            });
            const clsCodes = Object.keys(byCls).filter(c => byCls[c].length > 0);
            if (clsCodes.length < 2) break;
            if (r >= Math.max(...clsCodes.map(c => byCls[c].length))) break;
            const roundIdx = [];
            clsCodes.forEach(cc => { if (r < byCls[cc].length) roundIdx.push(byCls[cc][r]); });
            if (roundIdx.length < 2) continue;
            const roundLsn = roundIdx.map(i => retryList[i]);
            const repeatedTeachers = getRepeatedTeacherCodes(roundLsn);
            if (repeatedTeachers.length) { console.warn('綁班重跑仍有組內教師衝堂：'+repeatedTeachers.join('、')); continue; }
            const candidates = [];
            const roundLookup = buildScheduleLookup(localSchedule);
            for (let day = 1; day <= 5; day++) {
              for (let per = autoStartPeriod; per <= autoEndPeriod; per++) {
                if (shouldStopAutoSchedule('retry-bind-candidates')) break;
                if (roundLsn.every(l => isSlotValid(l.classCode, l.subjectCode, autoTeacherInput(l), day, per, localSchedule, roundLookup))) {
                  const allBoundTeachersValid = roundLsn.every(l => {
                    const teacherCodes = getAutoTeacherCodes(autoTeacherInput(l));
                    return teacherCodes.every(teacherCode => {
                      const teacherKey = canonicalAutoTeacherCode(teacherCode);
                      const tObj = idx.teacherByCode[teacherKey];
                      const maxC = tObj ? parseInt(tObj['最大連堂節數'] || '2', 10) : 2;
                      return countConsecutiveInLocal(localSchedule, teacherCode, day, per) <= maxC;
                    });
                  });
                  if (allBoundTeachersValid) {
                     const score = roundLsn.reduce((sum, lesson) => sum + evaluateSlotScore(lesson, day, per, true, roundLookup), 0);
                    candidates.push({ day, per, score, tieBreak: autoRandomTieBreak() });
                  }
                }
              }
            }
        if (candidates.length > 0) {
          const best = selectAutoCandidate(candidates, roundLsn);
          roundLsn.forEach((l, gi) => {
              appendLocalSchedule({ '課表ID': 'AUTO_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4) + '_R' + r + '_' + gi, '班級代碼': String(l.classCode), '星期': best.day, '節次': best.per, '科目代碼': String(l.subjectCode), '教師姓名': autoTeacherValue(l), '課堂屬性': getAutoScheduleAttribute(l, best.day, best.per, localSchedule, buildScheduleLookup(localSchedule)), '是否鎖定': 'FALSE', '__isBindGroup': true });
            successCount++;
          });
          roundIdx.forEach(i => placedSet.add(i));
            }
          }
        });
      });
      retryList = retryList.filter((_, i) => !placedSet.has(i));
    }
    if (autoScheduleTimedOut) {
      failList = failList.concat(retryList);
      break;
    }

    for (let ri = 0; ri < retryList.length; ri++) {
      if (shouldStopAutoSchedule('retry-candidates')) {
        failList.push(...retryList.slice(ri));
        break;
      }
      if (ri > 0 && ri % 20 === 0) {
        await yieldToUI();
        updateProgress(`第 ${round} 輪重跑… (${ri}/${retryList.length})`);
      }
      const lesson = retryList[ri];
      // 綁班群組科目在重跑中也禁止個別排入
      if (getBindGroupClasses(lesson.subjectCode, lesson.classCode)) {
        markAutoFailure(lesson, 'bind-group-no-common-slot');
        continue;
      }

      let placed = false;
      const retryLookup = buildScheduleLookup(localSchedule);

      // 補排也使用完整品質分，不再採用第一個合法格位。
      const retryCandidates = [];
      for (let day = 1; day <= 5; day++) {
        for (let per = autoStartPeriod; per <= autoEndPeriod; per++) {
          if (shouldStopAutoSchedule('retry-candidates')) break;
          if (isSlotValid(lesson.classCode, lesson.subjectCode, autoTeacherInput(lesson), day, per, localSchedule, retryLookup)) {
             retryCandidates.push({ day, per, score: evaluateSlotScore(lesson, day, per, true, retryLookup), tieBreak: autoRandomTieBreak() });
          }
        }
      }
      if (retryCandidates.length > 0) {
        const best = selectAutoCandidate(retryCandidates, lesson);
        appendLocalSchedule({
          '課表ID': 'AUTO_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
          '班級代碼': String(lesson.classCode),
          '星期': best.day, '節次': best.per,
          '科目代碼': String(lesson.subjectCode),
          '教師姓名': autoTeacherValue(lesson),
          '課堂屬性': getAutoScheduleAttribute(lesson, best.day, best.per, localSchedule, retryLookup),
          '是否鎖定': 'FALSE'
        });
        successCount++;
        placed = true;
      }
        // 嘗試交換排入（必排可跨班級移動）
      if (!placed && !autoScheduleTimedOut && optSmartSwap) {
        const trySwapAll = lesson.hasMustRule && lesson.mustRuleSlots && lesson.mustRuleSlots.length > 0;
        const movableClassSlots = new Map();
        localSchedule.forEach((entry, entryIndex) => {
          if (String(entry['班級代碼']) !== String(lesson.classCode)) return;
          const entryDay = parseInt(entry['星期'], 10);
          const entryPeriod = parseInt(entry['節次'], 10);
          if (entryDay < 1 || entryDay > 5 || entryPeriod < autoStartPeriod || entryPeriod > autoEndPeriod) return;
          if (String(entry['是否鎖定']).toUpperCase() === 'TRUE') return;
          if (isFrozenAutoEntry(entry) || isMustPlacedCourse(entry) || isBindAutoEntry(entry)) return;
          movableClassSlots.set(entryDay + '|' + entryPeriod, entryIndex);
        });

        for (let day = 1; day <= 5 && !placed; day++) {
          for (let per = autoStartPeriod; per <= autoEndPeriod && !placed; per++) {
            if (shouldStopAutoSchedule('retry-swap')) break;
            if (trySwapAll) {
              const isMustDayPer = lesson.mustRuleSlots.some(s => s.day === day && s.per === per);
              if (!isMustDayPer) continue;
            }

            const occupiedIdx = movableClassSlots.get(day + '|' + per);
            if (occupiedIdx >= 0) {
              const victim = localSchedule[occupiedIdx];
              const tempSched = localSchedule.filter((_, i) => i !== occupiedIdx);
              const tempLookup = buildScheduleLookup(tempSched);
              if (isSlotValid(lesson.classCode, lesson.subjectCode, autoTeacherInput(lesson), day, per, tempSched, tempLookup)) {
                // 同第一輪：用含新課的 lookup 驗證 victim 新位置，防止同班同科同日重複
                const tempSchedWithLesson = [...tempSched, {
                  '班級代碼': String(lesson.classCode),
                  '星期': day, '節次': per,
                  '科目代碼': String(lesson.subjectCode),
                  '教師姓名': autoTeacherValue(lesson)
                }];
                const tempLookupWithLesson = buildScheduleLookup(tempSchedWithLesson);
                let victimCandidate = null;
                for (let newD = 1; newD <= 5 && !placed; newD++) {
                  for (let newP = autoStartPeriod; newP <= autoEndPeriod && !placed; newP++) {
                    if (shouldStopAutoSchedule('retry-swap-candidates')) break;
                    if (newD === day && newP === per) continue;
                    if (isSlotValid(victim['班級代碼'], victim['科目代碼'], victim['教師姓名'], newD, newP, tempSchedWithLesson, tempLookupWithLesson)) {
                      victimCandidate = { newD, newP };
                      break;
                    }
                  }
                  if (victimCandidate) break;
                }
                if (victimCandidate && !placed) {
                  setLocalScheduleEntry(occupiedIdx, { ...victim, '星期': victimCandidate.newD, '節次': victimCandidate.newP });
                  appendLocalSchedule({
                    '課表ID': 'AUTO_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                    '班級代碼': String(lesson.classCode),
                    '星期': day, '節次': per,
                    '科目代碼': String(lesson.subjectCode),
                    '教師姓名': autoTeacherValue(lesson),
                    '課堂屬性': getAutoScheduleAttribute(lesson, day, per, localSchedule, buildScheduleLookup(localSchedule)),
                    '是否鎖定': 'FALSE'
                  });
                  successCount++;
                  placed = true;
                }
              }
            }
          }
        }
      }

      if (!placed) markAutoFailure(lesson, classifyNoLegalSlot(lesson));
    }

  // ── 第四梯隊：直接增廣路徑（只搜尋實際阻塞課，不展開整張課表樹）──────
  markAutoScheduleProfile('repair');
  if (failList.length > 0 && optSmartSwap && !autoScheduleTimedOut) {
    await yieldToUI();
    updateProgress('第四梯隊：直接增廣路徑修復（' + failList.length + ' 節頑固未排課）…');
    const repairStartedAt = Date.now();
    const repairTimeBudgetMs = Math.max(5000, autoScheduleDeadline - repairStartedAt);
    const enableGlobalNeighborhoodRepair = autoScheduleTimeBudgetMs >= 180000;
    repairGlobalReserveMs = enableGlobalNeighborhoodRepair
      ? Math.min(12000, Math.max(3000, Math.floor(repairTimeBudgetMs * 0.25)))
      : 0;
    const repairDirectDeadline = repairStartedAt + Math.max(2000, repairTimeBudgetMs - repairGlobalReserveMs);
    const repairGlobalDeadline = autoScheduleDeadline + repairGlobalReserveMs;
    let repairPhase = 'direct';
    const repairBudgetScale = autoScheduleTimeBudgetMs < 60000
      ? 1
      : Math.min(3, autoScheduleTimeBudgetMs / 60000);
    const repairOperationBase = Math.max(12000, failList.length * 600);
    repairOperationLimit = Math.min(36000, Math.round(repairOperationBase * repairBudgetScale));
    repairOperationReserve = Math.min(6000, Math.floor(repairOperationLimit * 0.25));
    const shouldStopRepair = () => {
      if (repairBudgetExceeded) return true;
      const phaseDeadline = repairPhase === 'global'
        ? repairGlobalDeadline
        : repairDirectDeadline;
      if (Date.now() >= phaseDeadline) {
        if (repairPhase === 'direct') return true;
        repairBudgetExceeded = true;
        console.warn('[AutoSchedule] 增廣路徑修復時間預算已用盡，保留剩餘未排課。');
        return true;
      }
      if (repairPhase !== 'global' && shouldStopAutoSchedule('repair')) return true;
      return false;
    };
    const consumeRepairOperation = (useReserve = false) => {
      if (repairBudgetExceeded) return true;
      if (shouldStopRepair()) return true;
      const operationLimit = useReserve
        ? repairOperationLimit
        : Math.max(0, repairOperationLimit - repairOperationReserve);
      if (repairOperationCount >= operationLimit) {
        if (repairOperationReserve === 0 || useReserve) {
          repairBudgetExceeded = true;
          console.warn('[AutoSchedule] 增廣路徑修復節點上限已用盡，保留剩餘未排課。');
        }
        return true;
      }
      repairOperationCount++;
      if (repairOperationCount >= operationLimit) {
        if (repairOperationReserve === 0 || useReserve) {
          repairBudgetExceeded = true;
          console.warn('[AutoSchedule] 增廣路徑修復節點上限已用盡，保留剩餘未排課。');
        }
        return true;
      }
      return false;
    };
     const repairSearchWide = autoScheduleTimeBudgetMs >= 180000;
     const AUTO_REPAIR_TARGET_LIMIT = repairSearchWide ? 35 : 18;
     const AUTO_REPAIR_RELOCATE_LIMIT = repairSearchWide ? 24 : 12;
     const AUTO_REPAIR_ONE_HOP_LIMIT = repairSearchWide ? 12 : 6;
     const AUTO_REPAIR_MAX_EVICTIONS = repairSearchWide ? 6 : 4;
    const repairPinnedEntries = new Set();

    const isRepairProtectedEntry = entry =>
      !entry || repairPinnedEntries.has(entry) || isFrozenAutoEntry(entry) || isBindAutoEntry(entry);

    function buildRepairEntry(item, day, period) {
      if (item.entryTemplate) return { ...item.entryTemplate, '星期': day, '節次': period };
      return {
        '課表ID': 'AUTO_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        '班級代碼': String(item.lesson.classCode),
        '星期': day,
        '節次': period,
        '科目代碼': String(item.lesson.subjectCode),
        '教師姓名': autoTeacherValue(item.lesson),
        '課堂屬性': getAutoScheduleAttribute(item.lesson, day, period, localSchedule, buildScheduleLookup(localSchedule)),
        '是否鎖定': 'FALSE'
      };
    }

    function collectDirectEvictionOptions(lesson, day, period, allowOptional, providedLookup = null, useReserve = false) {
      if (consumeRepairOperation(useReserve)) return [];
      if (period < autoStartPeriod || period > autoEndPeriod) return [];
      const isHelper = String(lesson.subjectCode || '').trim().endsWith('輔');
      if ((isHelper && period !== 8) || (!isHelper && period === 8)) return [];

      const applicableRules = getApplicableRules(lesson.subjectCode, lesson.classCode);
      if (applicableRules.some(entry => isForbiddenAutoRule(entry.rule) && entry.slots.some(slot => slot.day === day && slot.period === period))) return [];
      const mustRules = applicableRules.filter(entry => isMandatoryAutoRule(entry.rule));
      if (mustRules.length && !mustRules.some(entry => entry.slots.some(slot => slot.day === day && slot.period === period))) return [];

      const teacherIdentities = new Set(resolveAutoTeacherCodes(autoTeacherInput(lesson)));
      if ([...teacherIdentities].some(identity => idx.blockSet.has(identity + '|' + day + '|' + period))) return [];
      const exclusivePeers = new Set();
      teacherIdentities.forEach(identity => {
        (autoTeacherExclusivePeers.get(identity) || []).forEach(peer => exclusivePeers.add(peer));
      });

      const victims = new Set();
      let blocked = false;
      const addVictim = entry => {
        if (!entry || victims.has(entry)) return;
        if (isRepairProtectedEntry(entry)) {
          blocked = true;
          return;
        }
        victims.add(entry);
      };

      const repairLookup = providedLookup || buildScheduleLookup(localSchedule);
      const slotEntries = repairLookup.entriesBySlot.get(day + '|' + period) || [];
      slotEntries.forEach(entry => {
        if (shouldStopRepair()) return;
        if (String(entry['班級代碼']) === String(lesson.classCode)) {
          addVictim(entry);
          return;
        }
        const entryTeachers = resolveAutoTeacherCodes(entry);
        if (entryTeachers.some(identity => teacherIdentities.has(identity) || exclusivePeers.has(identity))) addVictim(entry);
      });
      if (blocked || victims.size > AUTO_REPAIR_MAX_EVICTIONS) return [];

      const addCapacityVictims = (entries, needed) => {
        if (needed <= 0) return true;
        const movable = entries.filter(entry => !victims.has(entry) && !isRepairProtectedEntry(entry));
        if (movable.length < needed) return false;
        movable.slice(0, needed).forEach(entry => victims.add(entry));
        return victims.size <= AUTO_REPAIR_MAX_EVICTIONS;
      };

      const roomCode = getSubjectRoomCode(lesson.subjectCode);
      if (roomCode) {
        const roomEntries = slotEntries.filter(entry =>
          !victims.has(entry) &&
          !isPatrolScheduleEntry(entry) &&
          getSubjectRoomCode(entry['科目代碼']) === roomCode
        );
        if (!addCapacityVictims(roomEntries, roomEntries.length + 1 - getSubjectRoomCapacity(lesson.subjectCode))) return [];
      }

      const subject = idx.subjectByCode[String(lesson.subjectCode)];
      const maxConcurrent = subject ? parseInt(subject['同時最多班數'] || '0', 10) : 0;
      if (maxConcurrent > 0) {
        const subjectEntries = slotEntries.filter(entry =>
          !victims.has(entry) &&
          String(entry['科目代碼']) === String(lesson.subjectCode)
        );
        if (!addCapacityVictims(subjectEntries, subjectEntries.length + 1 - maxConcurrent)) return [];
      }

      const validAfter = evictionList => {
        if (consumeRepairOperation(useReserve)) return false;
        const evictionSet = new Set(evictionList);
        const remaining = localSchedule.filter(entry => !evictionSet.has(entry));
        return isSlotValid(
          lesson.classCode,
          lesson.subjectCode,
          autoTeacherInput(lesson),
          day,
          period,
          remaining,
          buildScheduleLookup(remaining)
        );
      };
      const baseVictims = [...victims];
      if (validAfter(baseVictims)) return [baseVictims];
      if (!allowOptional || baseVictims.length >= AUTO_REPAIR_MAX_EVICTIONS) return [];

      const optionalEntries = localSchedule
        .filter(entry => !victims.has(entry) && !isRepairProtectedEntry(entry))
        .filter(entry => {
          if (shouldStopRepair()) return false;
          const sameClass =
            String(entry['班級代碼']) === String(lesson.classCode);
          const sameClassSubject =
            sameClass && String(entry['科目代碼']) === String(lesson.subjectCode);
          const sameSubject =
            String(entry['科目代碼']) === String(lesson.subjectCode);
          const sameTeacherDay =
            parseInt(entry['星期'], 10) === day &&
            resolveAutoTeacherCodes(entry).some(identity => teacherIdentities.has(identity));
          return sameClass || sameClassSubject || sameSubject || sameTeacherDay;
        })
        .sort((left, right) => {
          const leftDistance = Math.abs(parseInt(left['星期'], 10) - day) + Math.abs(parseInt(left['節次'], 10) - period) / 10;
          const rightDistance = Math.abs(parseInt(right['星期'], 10) - day) + Math.abs(parseInt(right['節次'], 10) - period) / 10;
          return leftDistance - rightDistance;
        })
        .slice(0, 6);

      const options = [];
      for (const optionalEntry of optionalEntries) {
        if (shouldStopRepair()) break;
        const combined = [...baseVictims, optionalEntry];
        if (validAfter(combined)) options.push(combined);
        if (options.length >= 3) break;
      }
      return options;
    }

    function findEmptyCandidates(lesson, limit) {
      const lookup = buildScheduleLookup(localSchedule);
      const candidates = [];
      for (let day = 1; day <= 5; day++) {
        for (let period = autoStartPeriod; period <= autoEndPeriod; period++) {
          if (consumeRepairOperation()) break;
          if (!isSlotValid(lesson.classCode, lesson.subjectCode, autoTeacherInput(lesson), day, period, localSchedule, lookup)) continue;
           candidates.push({ day, period, score: evaluateSlotScore(lesson, day, period, false, lookup), tieBreak: autoRandomTieBreak() });
        }
      }
      return candidates.sort(compareAutoCandidates).slice(0, limit);
    }

    function placeAtFirstEmpty(item, limit) {
      const candidates = findEmptyCandidates(item.lesson, limit);
      if (candidates.length === 0) return false;
       const best = selectAutoCandidate(candidates, item.lesson);
      const placedEntry = buildRepairEntry(item, best.day, best.period);
       appendLocalSchedule(placedEntry);
      repairPinnedEntries.add(placedEntry);
      return true;
    }

     const AUTO_REPAIR_MAX_DEPTH = 4;
     function tryRelocateVictim(victim, depth = 0, visited = new Set()) {
       if (!victim || visited.has(victim)) return false;
       const nextVisited = new Set(visited);
       nextVisited.add(victim);
       const victimLesson = makeAutoLessonFromScheduleEntry(victim, 'augment');
       if (placeAtFirstEmpty({ lesson: victimLesson, entryTemplate: victim }, AUTO_REPAIR_RELOCATE_LIMIT)) return true;
       if (depth >= AUTO_REPAIR_MAX_DEPTH) return false;

        const hopCandidates = [];
        for (let day = 1; day <= 5; day++) {
          for (let period = autoStartPeriod; period <= autoEndPeriod; period++) {
            if (shouldStopRepair()) break;
            const options = collectDirectEvictionOptions(victimLesson, day, period, false);
            options.filter(toEvict =>
              toEvict.length > 0 &&
              toEvict.length <= AUTO_REPAIR_MAX_EVICTIONS &&
              !toEvict.includes(victim)
            ).forEach(toEvict => {
              hopCandidates.push({
                day,
                period,
                blockers: toEvict,
                score: evaluateSlotScore(victimLesson, day, period, false, buildScheduleLookup(localSchedule)) - toEvict.length * 12
              });
            });
          }
        }
        hopCandidates.sort((left, right) => right.score - left.score);
        for (const candidate of hopCandidates.slice(0, AUTO_REPAIR_ONE_HOP_LIMIT)) {
          if (consumeRepairOperation()) break;
          if (candidate.blockers.some(blocker => nextVisited.has(blocker))) continue;
          const scheduleSnapshot = [...localSchedule];
          const pinnedSnapshot = new Set(repairPinnedEntries);
          const blockerIndexes = candidate.blockers
            .map(blocker => localSchedule.indexOf(blocker))
            .filter(index => index >= 0)
            .sort((left, right) => right - left);
          if (blockerIndexes.length !== candidate.blockers.length) continue;
          blockerIndexes.forEach(index => removeLocalScheduleAt(index));

         const lookup = buildScheduleLookup(localSchedule);
         if (!isSlotValid(
           victimLesson.classCode,
           victimLesson.subjectCode,
           autoTeacherInput(victimLesson),
           candidate.day,
           candidate.period,
           localSchedule,
           lookup
         )) {
           replaceLocalSchedule(scheduleSnapshot);
           continue;
         }

           const movedVictim = buildRepairEntry({ lesson: victimLesson, entryTemplate: victim }, candidate.day, candidate.period);
           appendLocalSchedule(movedVictim);
           repairPinnedEntries.add(movedVictim);
           let blockersSolved = true;
           const blockerVisited = new Set(nextVisited);
           for (const blocker of candidate.blockers) {
             if (blockerVisited.has(blocker) || !tryRelocateVictim(blocker, depth + 1, blockerVisited)) {
               blockersSolved = false;
               break;
             }
             blockerVisited.add(blocker);
           }
           if (blockersSolved) return true;

          replaceLocalSchedule(scheduleSnapshot);
         repairPinnedEntries.clear();
         pinnedSnapshot.forEach(entry => repairPinnedEntries.add(entry));
        }
       return false;
       }

      function tryConflictGraphLesson(lesson) {
        conflictGraphStats.searches++;
        if (!lesson || shouldStopRepair()) return false;
        const graphNodeLimit = repairSearchWide ? 6000 : 3000;
        const graphTargetLimit = repairSearchWide ? 50 : 24;
        const graphBranchLimit = repairSearchWide ? 24 : 12;
        let graphNodes = 0;
        const finish = result => {
          conflictGraphStats.nodes += graphNodes;
          return result;
        };

        const candidateKey = candidate => [
          candidate.day,
          candidate.period,
          candidate.blockers.map(entry => getAutoScheduleIdentity(entry)).sort().join('~')
        ].join('|');
        const compareGraphCandidates = (left, right) =>
          left.blockers.length - right.blockers.length || compareAutoCandidates(left, right);
        const collectGraphCandidates = (targetLesson, allowOptional, excludedEntry = null) => {
          const lookup = buildScheduleLookup(localSchedule);
          const candidates = [];
          const seen = new Set();
          for (let day = 1; day <= 5; day++) {
            for (let period = autoStartPeriod; period <= autoEndPeriod; period++) {
              if (shouldStopRepair()) return candidates.sort(compareGraphCandidates);
              const options = collectDirectEvictionOptions(targetLesson, day, period, allowOptional, lookup);
              options.forEach(blockers => {
                if (excludedEntry && blockers.includes(excludedEntry)) return;
                const uniqueBlockers = [...new Set(blockers)];
                if (uniqueBlockers.length > AUTO_REPAIR_MAX_EVICTIONS) return;
                const candidate = {
                  day,
                  period,
                  blockers: uniqueBlockers,
                  score: evaluateSlotScore(targetLesson, day, period, false, lookup) - uniqueBlockers.length * 20,
                  tieBreak: autoRandomTieBreak()
                };
                const key = candidateKey(candidate);
                if (seen.has(key)) return;
                seen.add(key);
                candidates.push(candidate);
                conflictGraphStats.candidates++;
              });
            }
          }
          return candidates.sort(compareGraphCandidates);
        };

        const relocate = (victim, visitedEntries) => {
          if (!victim || visitedEntries.has(victim) || shouldStopRepair()) return false;
          if (++graphNodes > graphNodeLimit) return false;
          const nextVisited = new Set(visitedEntries);
          nextVisited.add(victim);
          const victimLesson = makeAutoLessonFromScheduleEntry(victim, 'conflict_graph');
          const candidates = collectGraphCandidates(victimLesson, false, victim);

          for (const candidate of candidates.slice(0, graphBranchLimit)) {
            if (++graphNodes > graphNodeLimit || shouldStopRepair()) return false;
            if (candidate.blockers.some(blocker => nextVisited.has(blocker))) continue;
            const scheduleSnapshot = [...localSchedule];
            const pinnedSnapshot = new Set(repairPinnedEntries);
            const blockerIndexes = candidate.blockers
              .map(blocker => localSchedule.indexOf(blocker))
              .filter(index => index >= 0)
              .sort((left, right) => right - left);
            if (blockerIndexes.length !== candidate.blockers.length) continue;
            blockerIndexes.forEach(index => removeLocalScheduleAt(index));

            const lookup = buildScheduleLookup(localSchedule);
            if (!isSlotValid(
              victimLesson.classCode,
              victimLesson.subjectCode,
              autoTeacherInput(victimLesson),
              candidate.day,
              candidate.period,
              localSchedule,
              lookup
            )) {
              replaceLocalSchedule(scheduleSnapshot);
              continue;
            }

            const movedVictim = buildRepairEntry({ lesson: victimLesson, entryTemplate: victim }, candidate.day, candidate.period);
            appendLocalSchedule(movedVictim);
            repairPinnedEntries.add(movedVictim);
            let blockersSolved = true;
            const branchVisited = new Set(nextVisited);
            for (const blocker of candidate.blockers) {
              if (branchVisited.has(blocker) || !relocate(blocker, branchVisited)) {
                blockersSolved = false;
                break;
              }
              branchVisited.add(blocker);
            }
            if (blockersSolved) return true;

            replaceLocalSchedule(scheduleSnapshot);
            repairPinnedEntries.clear();
            pinnedSnapshot.forEach(entry => repairPinnedEntries.add(entry));
          }
          return false;
        };

        const rootCandidates = collectGraphCandidates(lesson, false);
        for (const candidate of rootCandidates.slice(0, graphTargetLimit)) {
          if (++graphNodes > graphNodeLimit || shouldStopRepair()) return finish(false);
          repairPinnedEntries.clear();
          const scheduleSnapshot = [...localSchedule];
          const pinnedSnapshot = new Set(repairPinnedEntries);
          const blockerIndexes = candidate.blockers
            .map(blocker => localSchedule.indexOf(blocker))
            .filter(index => index >= 0)
            .sort((left, right) => right - left);
          if (blockerIndexes.length !== candidate.blockers.length) continue;
          blockerIndexes.forEach(index => removeLocalScheduleAt(index));

          const lookup = buildScheduleLookup(localSchedule);
          if (!isSlotValid(
            lesson.classCode,
            lesson.subjectCode,
            autoTeacherInput(lesson),
            candidate.day,
            candidate.period,
            localSchedule,
            lookup
          )) {
            replaceLocalSchedule(scheduleSnapshot);
            pinnedSnapshot.forEach(entry => repairPinnedEntries.add(entry));
            continue;
          }

          const placedLesson = buildRepairEntry({ lesson, entryTemplate: null }, candidate.day, candidate.period);
          appendLocalSchedule(placedLesson);
          repairPinnedEntries.add(placedLesson);
          let solved = true;
          const visitedEntries = new Set();
          for (const blocker of candidate.blockers) {
            if (visitedEntries.has(blocker) || !relocate(blocker, visitedEntries)) {
              solved = false;
              break;
            }
            visitedEntries.add(blocker);
          }
          if (solved) {
            conflictGraphMoves++;
            return finish(true);
          }

          replaceLocalSchedule(scheduleSnapshot);
          repairPinnedEntries.clear();
          pinnedSnapshot.forEach(entry => repairPinnedEntries.add(entry));
        }
        return finish(false);
      }

      function tryRepackClassLesson(lesson) {
        const classCode = String(lesson?.classCode || '');
        if (!lesson || !autoTightClassCodes.has(classCode)) return false;
        const movableEntries = localSchedule.filter(entry => {
          if (String(entry['班級代碼'] || '') !== classCode) return false;
          const period = parseInt(entry['節次'], 10);
          if (period < autoStartPeriod || period > autoEndPeriod || isPatrolScheduleEntry(entry)) return false;
          return !isRepairProtectedEntry(entry) && !isMustPlacedCourse(entry);
        });
        const movableSet = new Set(movableEntries);
        const baseSchedule = localSchedule.filter(entry => !movableSet.has(entry));
        const baseLookup = buildScheduleLookup(baseSchedule);
        const classSlots = [];
        for (let day = 1; day <= 5; day++) {
          for (let period = autoStartPeriod; period <= autoEndPeriod; period++) {
            classSlots.push({ day, period });
          }
        }
        const items = [
          { lesson, entryTemplate: null, isTarget: true },
          ...movableEntries.map(entry => ({
            lesson: makeAutoLessonFromScheduleEntry(entry, 'class_repack'),
            entryTemplate: entry,
            isTarget: false
          }))
        ];
        if (items.length > classSlots.length) return false;

        const itemCandidates = [];
        for (const item of items) {
          if (shouldStopRepair()) return false;
          const candidates = [];
          for (const slot of classSlots) {
            if (consumeRepairOperation()) return false;
            if (!isSlotValid(
              item.lesson.classCode,
              item.lesson.subjectCode,
              autoTeacherInput(item.lesson),
              slot.day,
              slot.period,
              baseSchedule,
              baseLookup
            )) continue;
            candidates.push({
              ...slot,
              score: evaluateSlotScore(item.lesson, slot.day, slot.period, false, baseLookup),
              tieBreak: autoRandomTieBreak()
            });
          }
          if (candidates.length === 0) return false;
          candidates.sort(compareAutoCandidates);
          itemCandidates.push({ item, candidates });
        }
        itemCandidates.sort((left, right) =>
          left.candidates.length - right.candidates.length ||
          Number(right.item.isTarget) - Number(left.item.isTarget) ||
          getAutoConflictPressure(right.item.lesson) - getAutoConflictPressure(left.item.lesson)
        );

        const workingSchedule = [...baseSchedule];
        const assignedSlots = new Set();
        const assignedEntries = [];
        let searchNodes = 0;
        const CLASS_REPACK_NODE_LIMIT = 1500;
        const search = depth => {
          if (depth >= itemCandidates.length) return true;
          if (++searchNodes > CLASS_REPACK_NODE_LIMIT || shouldStopRepair()) return false;
          const { item, candidates } = itemCandidates[depth];
          const lookup = buildScheduleLookup(workingSchedule);
          for (const candidate of candidates) {
            const slotKey = candidate.day + '|' + candidate.period;
            if (assignedSlots.has(slotKey)) continue;
            if (consumeRepairOperation()) return false;
            if (!isSlotValid(
              item.lesson.classCode,
              item.lesson.subjectCode,
              autoTeacherInput(item.lesson),
              candidate.day,
              candidate.period,
              workingSchedule,
              lookup
            )) continue;
            const entry = item.entryTemplate
              ? { ...item.entryTemplate, '星期': candidate.day, '節次': candidate.period }
              : {
                '班級代碼': String(item.lesson.classCode),
                '星期': candidate.day,
                '節次': candidate.period,
                '科目代碼': String(item.lesson.subjectCode),
                 '教師姓名': autoTeacherValue(item.lesson),
                 '課堂屬性': getAutoScheduleAttribute(item.lesson, candidate.day, candidate.period, workingSchedule, lookup),
                 '是否鎖定': 'FALSE'
              };
            workingSchedule.push(entry);
            assignedSlots.add(slotKey);
            assignedEntries.push({ item, day: candidate.day, period: candidate.period });
            if (search(depth + 1)) return true;
            assignedEntries.pop();
            assignedSlots.delete(slotKey);
            workingSchedule.pop();
          }
          return false;
        };

        if (!search(0)) return false;
        const finalEntries = assignedEntries.map(assignment =>
          buildRepairEntry(assignment.item, assignment.day, assignment.period)
        );
        replaceLocalSchedule(baseSchedule);
        finalEntries.forEach(entry => {
          appendLocalSchedule(entry);
          repairPinnedEntries.add(entry);
        });
        console.log('  🧩 班級局部重排完成：' + classCode + '，重排 ' + movableEntries.length + ' 節並排入 ' + String(lesson.subjectCode));
        return true;
      }

    function tryAugmentLesson(lesson) {
      const targetCandidates = [];
      for (let day = 1; day <= 5; day++) {
        for (let period = autoStartPeriod; period <= autoEndPeriod; period++) {
          if (consumeRepairOperation()) break;
          const options = collectDirectEvictionOptions(lesson, day, period, true);
          options.forEach(toEvict => {
            targetCandidates.push({
              day,
              period,
              toEvict,
               score: evaluateSlotScore(lesson, day, period, false, buildScheduleLookup(localSchedule)) - toEvict.length * 25,
              tieBreak: autoRandomTieBreak()
            });
          });
        }
      }
      targetCandidates.sort((left, right) =>
        left.toEvict.length - right.toEvict.length ||
        compareAutoCandidates(left, right)
      );

      for (const candidate of targetCandidates.slice(0, AUTO_REPAIR_TARGET_LIMIT)) {
        const scheduleSnapshot = [...localSchedule];
        repairPinnedEntries.clear();
        const evictedSet = new Set(candidate.toEvict);
        replaceLocalSchedule(scheduleSnapshot.filter(entry => !evictedSet.has(entry)));

        const lookup = buildScheduleLookup(localSchedule);
        if (!isSlotValid(
          lesson.classCode,
          lesson.subjectCode,
          autoTeacherInput(lesson),
          candidate.day,
          candidate.period,
          localSchedule,
          lookup
        )) {
          replaceLocalSchedule(scheduleSnapshot);
          continue;
        }

        const placedLesson = buildRepairEntry({ lesson, entryTemplate: null }, candidate.day, candidate.period);
        appendLocalSchedule(placedLesson);
        repairPinnedEntries.add(placedLesson);
        let solved = true;
        for (const victim of candidate.toEvict) {
          if (shouldStopRepair()) {
            solved = false;
            break;
          }
          if (!tryRelocateVictim(victim)) {
            solved = false;
            break;
          }
        }
        if (solved) return true;

        replaceLocalSchedule(scheduleSnapshot);
        repairPinnedEntries.clear();
      }
      return false;
    }

    function runAutoNeighborhoodRepair(targetOverride = null) {
      if (failList.length === 0 || shouldStopRepair()) return 0;
      neighborhoodRepairStats.attempts++;
      repairPinnedEntries.clear();
      const targetPool = Array.isArray(targetOverride)
        ? targetOverride.filter(lesson => failList.includes(lesson))
        : failList;
      const targetLessons = [...targetPool]
        .sort((left, right) => getAutoConflictPressure(right) - getAutoConflictPressure(left) ||
          (Number(left.teacherAvailableSlots) || 0) - (Number(right.teacherAvailableSlots) || 0))
        .slice(0, 8);
      const targetClasses = new Set(targetLessons.map(lesson => String(lesson.classCode || '')));
      const targetSubjects = new Set(targetLessons.map(lesson => String(lesson.subjectCode || '')));
      const targetTeachers = new Set(targetLessons.flatMap(lesson =>
        getAutoTeacherCodes(autoTeacherInput(lesson)).map(teacherCode => canonicalAutoTeacherCode(teacherCode))
      ));
      const targetRooms = new Set(targetLessons.map(lesson => getSubjectRoomCode(lesson.subjectCode)).filter(Boolean));
       const sharesNeighborhood = entry => {
        if (isRepairProtectedEntry(entry)) return false;
        const entryTeachers = new Set(getAutoTeacherCodes(entry).map(teacherCode => canonicalAutoTeacherCode(teacherCode)));
        return targetClasses.has(String(entry['班級代碼'] || '')) ||
          targetSubjects.has(String(entry['科目代碼'] || '')) ||
          targetRooms.has(getSubjectRoomCode(entry['科目代碼'])) ||
           [...entryTeachers].some(teacherCode => targetTeachers.has(teacherCode));
       };
       const blockerEntries = new Set();
       const seedOptions = [];
       const blockerLookup = buildScheduleLookup(localSchedule);
       for (const lesson of targetLessons) {
         const lessonSeedOptions = [];
         for (let day = 1; day <= 5 && lessonSeedOptions.length < 3; day++) {
           for (let period = autoStartPeriod; period <= autoEndPeriod && lessonSeedOptions.length < 3; period++) {
             if (shouldStopRepair()) break;
               collectDirectEvictionOptions(lesson, day, period, true, blockerLookup, true)
                 .forEach(blockers => {
                   if (lessonSeedOptions.length >= 3) return;
                   const uniqueBlockers = [...new Set(blockers)].filter(entry =>
                     entry && !isRepairProtectedEntry(entry)
                   );
                   if (uniqueBlockers.length === blockers.length) {
                     lessonSeedOptions.push({ lesson, blockers: uniqueBlockers });
                   }
                 });
           }
         }
         seedOptions.push(...lessonSeedOptions);
       }
       targetLessons.forEach(lesson => {
         seedOptions
           .filter(option => option.lesson === lesson)
           .sort((left, right) => left.blockers.length - right.blockers.length)
            .slice(0, 1)
            .forEach(option => option.blockers.forEach(entry => blockerEntries.add(entry)));
       });
       const fallbackNeighborhood = seedOptions.length === 0
         ? localSchedule.filter(sharesNeighborhood)
         : [];
       const destroyedEntries = [...new Set([
          ...blockerEntries,
          ...fallbackNeighborhood
        ])].slice(0, 24);
       if (destroyedEntries.length === 0 && seedOptions.length === 0) return 0;

      const scheduleSnapshot = [...localSchedule];
      const failSnapshot = [...failList];
      const destroyedSet = new Set(destroyedEntries);
      const destroyedItems = destroyedEntries.map(entry => ({
        lesson: makeAutoLessonFromScheduleEntry(entry, 'neighborhood'),
        entryTemplate: entry,
        isTarget: false
      }));
      const repairItems = targetLessons.map(lesson => ({ lesson, entryTemplate: null, isTarget: true })).concat(destroyedItems);
      neighborhoodRepairStats.maxItems = Math.max(neighborhoodRepairStats.maxItems, repairItems.length);
      const baseSchedule = scheduleSnapshot.filter(entry => !destroyedSet.has(entry));
      const baseLookup = buildScheduleLookup(baseSchedule);
      const itemCandidates = [];
      for (const item of repairItems) {
        if (shouldStopRepair()) return 0;
        const candidates = [];
        for (let day = 1; day <= 5; day++) {
          for (let period = autoStartPeriod; period <= autoEndPeriod; period++) {
            if (consumeRepairOperation(true)) return 0;
            if (!isSlotValid(item.lesson.classCode, item.lesson.subjectCode, autoTeacherInput(item.lesson), day, period, baseSchedule, baseLookup)) continue;
            candidates.push({
              day,
              period,
              score: evaluateSlotScore(item.lesson, day, period, false, baseLookup),
              tieBreak: autoRandomTieBreak()
            });
          }
        }
        if (candidates.length === 0) {
          neighborhoodRepairStats.candidateWipeouts++;
          return 0;
        }
        candidates.sort(compareAutoCandidates);
        itemCandidates.push({ item, candidates });
      }
      itemCandidates.sort((left, right) =>
        left.candidates.length - right.candidates.length ||
        Number(right.item.isTarget) - Number(left.item.isTarget) ||
        getAutoConflictPressure(right.item.lesson) - getAutoConflictPressure(left.item.lesson)
      );

      const workingSchedule = [...baseSchedule];
      const assignedEntries = [];
      const NEIGHBORHOOD_NODE_LIMIT = 2500;
      let searchNodes = 0;
      const search = depth => {
        if (depth >= itemCandidates.length) return true;
        if (++searchNodes > NEIGHBORHOOD_NODE_LIMIT || shouldStopRepair()) return false;
        const { item, candidates } = itemCandidates[depth];
        const lookup = buildScheduleLookup(workingSchedule);
        for (const candidate of candidates) {
          if (consumeRepairOperation(true)) return false;
          if (!isSlotValid(item.lesson.classCode, item.lesson.subjectCode, autoTeacherInput(item.lesson), candidate.day, candidate.period, workingSchedule, lookup)) continue;
          const entry = item.entryTemplate
            ? { ...item.entryTemplate, '星期': candidate.day, '節次': candidate.period }
            : {
              '班級代碼': String(item.lesson.classCode),
              '星期': candidate.day,
              '節次': candidate.period,
              '科目代碼': String(item.lesson.subjectCode),
               '教師姓名': autoTeacherValue(item.lesson),
               '課堂屬性': getAutoScheduleAttribute(item.lesson, candidate.day, candidate.period, workingSchedule, lookup),
               '是否鎖定': 'FALSE'
            };
          workingSchedule.push(entry);
          assignedEntries.push({ item, day: candidate.day, period: candidate.period });
          if (search(depth + 1)) return true;
          assignedEntries.pop();
          workingSchedule.pop();
        }
        return false;
      };

      if (!search(0)) {
        neighborhoodRepairStats.searchNodes += searchNodes;
        neighborhoodRepairStats.searchFailures++;
        return 0;
      }
      neighborhoodRepairStats.searchNodes += searchNodes;
      const finalEntries = assignedEntries.map(assignment =>
        buildRepairEntry(assignment.item, assignment.day, assignment.period)
      );
      replaceLocalSchedule(baseSchedule);
      finalEntries.forEach(entry => {
        appendLocalSchedule(entry);
        repairPinnedEntries.add(entry);
      });
      const targetSet = new Set(targetLessons);
      const candidateFailList = failSnapshot.filter(lesson => !targetSet.has(lesson));
      if (candidateFailList.length < failSnapshot.length) {
        failList = candidateFailList;
        successCount += targetLessons.length;
        neighborhoodRepairMoves += destroyedEntries.length;
        neighborhoodRepairStats.successes++;
        console.log('  🧩 局部回溯重建完成：排入 ' + targetLessons.length + ' 節，移動 ' + destroyedEntries.length + ' 節，剩餘未排 ' + failList.length + ' 節');
        return targetLessons.length;
      }

      replaceLocalSchedule(scheduleSnapshot);
      failList = failSnapshot;
      return 0;
    }

    function runAutoGlobalNeighborhoodRepair() {
      if (failList.length === 0 || shouldStopRepair()) return 0;
      const failures = failList.filter(lesson => !getBindGroupClasses(lesson.subjectCode, lesson.classCode));
      if (failures.length === 0) return 0;

      const parent = new Map(failures.map(lesson => [lesson, lesson]));
      const findRoot = lesson => {
        let root = lesson;
        while (parent.get(root) !== root) {
          parent.set(root, parent.get(parent.get(root)));
          root = parent.get(root);
        }
        return root;
      };
      const union = (left, right) => {
        const leftRoot = findRoot(left);
        const rightRoot = findRoot(right);
        if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
      };
      const keyOwners = new Map();
      failures.forEach(lesson => {
        const keys = [
          'class|' + String(lesson.classCode || ''),
          ...getAutoTeacherCodes(autoTeacherInput(lesson)).map(code => 'teacher|' + canonicalAutoTeacherCode(code))
        ];
        const roomCode = getSubjectRoomCode(lesson.subjectCode);
        if (roomCode) keys.push('room|' + roomCode);
        const subject = idx.subjectByCode[String(lesson.subjectCode || '')];
        if (subject && parseInt(subject['同時最多班數'] || '0', 10) > 0) {
          keys.push('subject|' + String(lesson.subjectCode || ''));
        }
        keys.filter(key => !key.endsWith('|')).forEach(key => {
          const owner = keyOwners.get(key);
          if (owner) union(lesson, owner);
          else keyOwners.set(key, lesson);
        });
      });

      const components = new Map();
      failures.forEach(lesson => {
        const root = findRoot(lesson);
        if (!components.has(root)) components.set(root, []);
        components.get(root).push(lesson);
      });
      const orderedComponents = [...components.values()].sort((left, right) =>
        Math.max(...right.map(getAutoConflictPressure)) - Math.max(...left.map(getAutoConflictPressure)) ||
        right.length - left.length
      );
      let moved = 0;
      for (const component of orderedComponents) {
        for (let offset = 0; offset < component.length; offset += 6) {
          if (shouldStopRepair()) return moved;
          const before = failList.length;
          const chunk = component.slice(offset, offset + 8);
          globalMatchingPasses++;
          const result = runAutoNeighborhoodRepair(chunk);
          if (result > 0) moved += result;
          if (failList.length === before && result === 0 && offset + 8 >= component.length) break;
        }
      }
      return moved;
    }

    failList.sort((left, right) =>
      getAutoConflictPressure(right) - getAutoConflictPressure(left) ||
      (Number(right.priorityScore) || 0) - (Number(left.priorityScore) || 0) ||
      (Number(right.subjectConstraintScore) || 0) - (Number(left.subjectConstraintScore) || 0) ||
      (Number(left.teacherAvailableSlots) || 0) - (Number(right.teacherAvailableSlots) || 0)
    );
    const repairRemain = [];
    for (let repairIndex = 0; repairIndex < failList.length; repairIndex++) {
      if (shouldStopRepair()) {
        repairRemain.push(...failList.slice(repairIndex));
        break;
      }
      const lesson = failList[repairIndex];
      await yieldToUI();
      updateProgress('第四梯隊：直接增廣路徑修復（' + (repairIndex + 1) + '/' + failList.length + '）…');
      if (getBindGroupClasses(lesson.subjectCode, lesson.classCode)) {
        lesson.failureReason = 'bind-group-no-common-slot';
        repairRemain.push(lesson);
        continue;
      }
      const isTightClass = autoTightClassCodes.has(String(lesson.classCode || ''));
      const repaired = isTightClass
        ? (tryConflictGraphLesson(lesson) || tryRepackClassLesson(lesson) || tryAugmentLesson(lesson))
        : (tryConflictGraphLesson(lesson) || tryAugmentLesson(lesson) || tryRepackClassLesson(lesson));
      if (repaired) {
        successCount++;
        console.log('  ✅ 修復排入：' + lesson.subjectCode + '（' + lesson.classCode + '）');
      } else {
        lesson.failureReason = classifyNoLegalSlot(lesson, 'cascade-no-legal-slot');
        repairRemain.push(lesson);
      }
    }
    failList = repairRemain;
    if (enableGlobalNeighborhoodRepair && repairGlobalReserveMs > 0) {
      repairPhase = 'global';
      runAutoGlobalNeighborhoodRepair();
    }
    console.log('  🔗 直接增廣路徑完成，剩餘未排：' + failList.length + ' 節');
  }
  }

  // ── 空堂優化後處理：掃描教師空堂，嘗試平移相鄰課填補 ─────────────────
  markAutoScheduleProfile('gap');
  await yieldToUI();
  updateProgress('空堂優化後處理中…');
  {
    const GAP_OPT_PASSES = 3;
    for (let pass = 0; pass < GAP_OPT_PASSES; pass++) {
      if (shouldStopAutoSchedule('gap')) break;
      let improved = false;
      let gapLookup = buildScheduleLookup(localSchedule);
      // 收集全部教師
      const teacherHasBlock = (teacherValue, day, period) =>
        resolveAutoTeacherCodes(teacherValue).some(identity => idx.blockSet.has(identity + '|' + day + '|' + period));
      const teacherSet = new Set();
      localSchedule.forEach(entry => {
        resolveAutoTeacherCodes(entry).forEach(identity => {
          const canonical = canonicalAutoTeacherCode(identity);
          if (canonical) teacherSet.add(canonical);
        });
      });
      for (const tcCode of teacherSet) {
        if (shouldStopAutoSchedule('gap')) break;
        // 找這位教師今天有空堂的日子
        for (let day = 1; day <= 5; day++) {
          const dayItems = (gapLookup.teacherDayEntries.get(tcCode + '|' + day) || [])
            .map(s => ({ s, i: localSchedule.indexOf(s) }))
            .filter(({s, i}) => i >= 0 && autoTeacherMatches(s, tcCode) && parseInt(s['節次'],10)>=autoStartPeriod && parseInt(s['節次'],10)<=autoEndPeriod && parseInt(s['節次'],10)<=7);
          if (dayItems.length < 2) continue;
          const periods = dayItems.map(({s})=>parseInt(s['節次'],10)).sort((a,b)=>a-b);
          const periodSet = new Set(periods);
          const first = periods[0], last = periods[periods.length-1];
          // 找出真正的空堂（中間未被鎖定也不是不排課）
          const gaps = [];
          for (let p = first+1; p < last; p++) {
            if (!periodSet.has(p) && !teacherHasBlock(tcCode, day, p)) gaps.push(p);
          }
           if (gaps.length === 0) continue;
           // 嘗試把空堂旁邊的課挪到空堂格位（同班、同教師、無衝堂）
           for (const gapP of gaps) {
            if (shouldStopAutoSchedule('gap')) break;
             // 找能移入空堂的課：同天已排課中找一節「移到 gapP 後合法且不造成新空堂」的
             for (const {s: cand, i: candIdx} of dayItems) {
              if (shouldStopAutoSchedule('gap')) break;
              const candP = parseInt(cand['節次'],10);
              if (candP === gapP) continue;
              if (isFrozenAutoEntry(cand) || isBindAutoEntry(cand)) continue;
              // 要移到 gapP：先確認班級格位未被占
              const schedNoC = localSchedule.filter((_,i)=>i!==candIdx);
              const lkNoC = buildScheduleLookup(schedNoC);
              if (!isSlotValid(cand['班級代碼'],cand['科目代碼'],autoTeacherInput({ teacherCodes: getAutoTeacherCodes(cand), teacherCode: cand['教師姓名'] }),day,gapP,schedNoC,lkNoC)) continue;
              // 連堂保護：依教師「最大連堂節數」設定判斷，與排課邏輯一致
              const exceedsTeacherConsecutive = getAutoTeacherCodes(cand).some(teacherToken => {
                const teacherKey = canonicalAutoTeacherCode(teacherToken);
                const teacherGap = idx.teacherByCode[teacherKey];
                const maxConsecGap = teacherGap ? parseInt(teacherGap['最大連堂節數']||'2',10) : 2;
                 const dayPeriodsGap = (gapLookup.teacherDayEntries.get(teacherKey + '|' + day) || [])
                   .filter(s=>s!==cand&&parseInt(s['節次'],10)>=autoStartPeriod&&parseInt(s['節次'],10)<=autoEndPeriod&&parseInt(s['節次'],10)<=7)
                  .map(s=>parseInt(s['節次'],10))
                  .filter(p=>p!==candP); // 移除 cand 原位置
                dayPeriodsGap.push(gapP); // 加入新位置
                const projSet = new Set(dayPeriodsGap);
                let maxStreak = 1, curStreak = 1;
                const sorted = [...projSet].sort((a,b)=>a-b);
                for (let si=1;si<sorted.length;si++) { curStreak = sorted[si]===sorted[si-1]+1 ? curStreak+1 : 1; maxStreak = Math.max(maxStreak,curStreak); }
                return maxStreak > maxConsecGap;
              });
              if (exceedsTeacherConsecutive) continue; // 移動會超過任一教師的連堂上限，跳過
              // 計算移動前後的教師空堂數
              const periodsAfter = periods.filter(p=>p!==candP);
              periodsAfter.push(gapP);
              periodsAfter.sort((a,b)=>a-b);
              const gapsBefore = gaps.length;
              const periodsAfterSet = new Set(periodsAfter);
              const firstA=periodsAfter[0], lastA=periodsAfter[periodsAfter.length-1];
              let gapsAfter=0;
              for(let p=firstA+1;p<lastA;p++) if(!periodsAfterSet.has(p)&&!teacherHasBlock(tcCode, day, p)) gapsAfter++;
              // 只有確實減少空堂才執行
               if (gapsAfter < gapsBefore) {
                 setLocalScheduleEntry(candIdx, {...cand, '節次': gapP});
                 gapLookup = buildScheduleLookup(localSchedule);
                 improved = true;
                break; // 本空堂已填，跳到下一個空堂
              }
            }
          }
        }
      }
      if (!improved) break;
    }
    console.log('  ✨ 空堂優化後處理完成');
  }

  if (failList.length === 0 && Date.now() >= autoScheduleDeadline) {
    autoScheduleQualityGraceActive = true;
    autoScheduleQualityDeadline = Date.now() + 12000;
    autoScheduleTimedOut = false;
    console.log('  ✨ 已排入全部課程，啟用 12 秒品質收尾時間');
  }

  // 3.5 排課完成後的局部最佳化：只調整本次自動產生且未鎖定的課程。
  markAutoScheduleProfile('local-optimization');
  let localOptimizationMoves = 0;
  async function optimizeAutoScheduleLocally() {
    const originalScheduleIds = new Set(
      state.schedule.map(s => String(s['課表ID'] || '')).filter(Boolean)
    );
    const localOptPasses = autoScheduleTimeBudgetMs >= 180000 ? 2 : 1;
    const maxSwapPairsPerPass = autoScheduleTimeBudgetMs >= 180000 ? 5000 : 1800;

    const isAutoMovableEntry = (entry) => {
      const id = String(entry['課表ID'] || '');
      if (!id || originalScheduleIds.has(id)) return false;
      if (isFrozenAutoEntry(entry)) return false;
      if (isBindAutoEntry(entry)) return false;
      const period = parseInt(entry['節次'], 10);
      return Number.isFinite(period) && period >= autoStartPeriod && period <= autoEndPeriod;
    };

    const readLocalQuality = schedule => {
      if (typeof window === 'undefined' || typeof window.buildAutoScheduleQualityReport !== 'function') return null;
      return window.buildAutoScheduleQualityReport({
        schedule,
        optP8Only,
        autoEndPeriod,
        onePerDay: optOnePerDay,
          ignoreTeacherConsecutiveIds: [...originalScheduleIds]
      });
    };
    const compareLocalQuality = (left, right) => {
      if (!left || !right) return 0;
      const leftViolations = Array.isArray(left.violations) ? left.violations.length : 0;
      const rightViolations = Array.isArray(right.violations) ? right.violations.length : 0;
      if (leftViolations !== rightViolations) return leftViolations - rightViolations;
      const leftRemaining = Number(left.remainingLessons) || 0;
      const rightRemaining = Number(right.remainingLessons) || 0;
      if (leftRemaining !== rightRemaining) return leftRemaining - rightRemaining;
      for (const metric of [
        'teacherGaps',
        'teacherImbalance',
        'subjectRelationSoftViolations',
        'teacherLongStreaks',
        'teacherRepeatedPeriods',
        'teacherAfternoonOverload',
        'teacherCrossGradeSameDay',
        'teacherCrossGradeAdjacent'
      ]) {
        const leftValue = Number(left[metric]) || 0;
        const rightValue = Number(right[metric]) || 0;
        if (leftValue !== rightValue) return leftValue - rightValue;
      }
      return (Number(right.score) || 0) - (Number(left.score) || 0);
    };

    const entryToLesson = (entry) => {
      const classCode = String(entry['班級代碼'] || '');
      const subjectCode = String(entry['科目代碼'] || '').trim();
      const teacherCodes = getAutoTeacherCodes(entry);
      const teacherCode = teacherCodes[0] || String(entry['教師姓名'] || '');
      const subject = idx.subjectByCode[subjectCode];
      const totalWeekly = weeklyTargetByClassSubject.get(classCode + '|' + subjectCode) || 1;
      return {
        classCode,
        subjectCode,
        teacherCode,
        teacherCodes,
        teacherValue: teacherCodes.length > 1 ? teacherCodes : teacherCode,
         totalWeekly,
         weeklyUnit: isAlternateWeekScheduleEntry(entry) ? 0.5 : 1,
         isAlternateWeek: isAlternateWeekScheduleEntry(entry) || isAlternateClassSubject(classCode, subjectCode),
         isP8Lesson: isAlternateWeekScheduleEntry(entry) || isAlternateClassSubject(classCode, subjectCode) || isHelperSubjectCode(subjectCode),
         weekType: isAlternateWeekScheduleEntry(entry) ? String(entry['課堂屬性'] || '').trim() : '',
         maxConsecDays: parseSubjectMaxConsecutiveDays(subject),
        isVirtual: String(entry['課堂屬性'] || '') === '抽離',
        isCore: coreSubjects.has(subjectCode),
        isActivity: activitySubjects.has(subjectCode)
      };
    };

    const scorePlacement = (lesson, day, period, baseSchedule, baseLookup = null) => evaluateSlotScoreOnSchedule(lesson, day, period, baseSchedule, false, baseLookup);
    const getTeacherGapCostForEntries = (baseSchedule, entries) => {
      const teacherSet = new Set(entries.flatMap(entry =>
        getAutoTeacherCodes(entry).map(code => canonicalAutoTeacherCode(code)).filter(Boolean)
      ));
      if (teacherSet.size === 0) return 0;
      const periodsByTeacherDay = new Map();
      const addPeriod = (teacherCode, day, period) => {
        if (!teacherSet.has(teacherCode) || day < 1 || day > 5 || period < 1 || period > 7) return;
        const key = teacherCode + '|' + day;
        if (!periodsByTeacherDay.has(key)) periodsByTeacherDay.set(key, new Set());
        periodsByTeacherDay.get(key).add(period);
      };
      baseSchedule.forEach(entry => {
        const day = parseInt(entry['星期'], 10);
        const period = parseInt(entry['節次'], 10);
        getAutoTeacherCodes(entry).forEach(code => addPeriod(canonicalAutoTeacherCode(code), day, period));
      });
      entries.forEach(entry => {
        const day = parseInt(entry['星期'], 10);
        const period = parseInt(entry['節次'], 10);
        getAutoTeacherCodes(entry).forEach(code => addPeriod(canonicalAutoTeacherCode(code), day, period));
      });
      let gaps = 0;
      periodsByTeacherDay.forEach((periods, key) => {
        if (periods.size < 2) return;
        const day = Number(key.slice(key.lastIndexOf('|') + 1));
        const teacherCode = key.slice(0, key.lastIndexOf('|'));
        const sorted = [...periods].sort((left, right) => left - right);
        for (let period = sorted[0] + 1; period < sorted[sorted.length - 1]; period++) {
          if (!periods.has(period) && !idx.blockSet.has(teacherCode + '|' + day + '|' + period)) gaps++;
        }
      });
      return gaps;
    };

    const findBestMove = (index) => {
      if (shouldStopAutoSchedule('local-optimization')) return null;
      const current = localSchedule[index];
      if (!isAutoMovableEntry(current)) return null;
      const oldDay = parseInt(current['星期'], 10);
      const oldPeriod = parseInt(current['節次'], 10);
      const lesson = entryToLesson(current);
      const baseSchedule = localSchedule.filter((_, i) => i !== index);
      const baseLookup = buildScheduleLookup(baseSchedule);
       const oldScore = scorePlacement(lesson, oldDay, oldPeriod, baseSchedule, baseLookup);
       const oldGapCost = getTeacherGapCostForEntries(baseSchedule, [current]);
      const oldRelationViolations = getSubjectRelationViolationCount(lesson, oldDay, oldPeriod, baseSchedule, baseLookup);
      let best = null;

      for (let day = 1; day <= 5; day++) {
        for (let period = autoStartPeriod; period <= autoEndPeriod; period++) {
           if (shouldStopAutoSchedule('local-optimization')) break;
            if (day === oldDay && period === oldPeriod) continue;
           if (!isSlotValid(lesson.classCode, lesson.subjectCode, autoTeacherInput(lesson), day, period, baseSchedule, baseLookup)) continue;
            const relationViolations = getSubjectRelationViolationCount(lesson, day, period, baseSchedule, baseLookup);
            if (relationViolations > oldRelationViolations) continue;
            const score = scorePlacement(lesson, day, period, baseSchedule, baseLookup);
            const delta = score - oldScore;
            const projectedEntry = { ...current, '星期': day, '節次': period };
            const gapDelta = oldGapCost - getTeacherGapCostForEntries(baseSchedule, [projectedEntry]);
             const relationDelta = oldRelationViolations - relationViolations;
             if (gapDelta <= 0 && relationDelta <= 0 && delta <= 0) continue;
             const tieBreak = autoRandomTieBreak();
             const shouldChoose = !best ||
               gapDelta > best.gapDelta ||
               (gapDelta === best.gapDelta && relationDelta > best.relationDelta) ||
               (gapDelta === best.gapDelta && relationDelta === best.relationDelta && delta > best.delta) ||
               (optRandomize && gapDelta === best.gapDelta && relationDelta === best.relationDelta && delta === best.delta && tieBreak > best.tieBreak);
             if (shouldChoose) {
               best = {
                 delta,
                 score,
                 relationDelta,
                 gapDelta,
                 tieBreak,
                 entry: { ...current, '星期': day, '節次': period }
               };
          }
        }
      }
      return best;
    };

    const collectSubjectRelationConflicts = () => {
      const grouped = new Map();
      localSchedule.forEach(entry => {
        if (isPatrolScheduleEntry(entry)) return;
        const classCode = String(entry['班級代碼'] || '').trim();
        const subjectCode = String(entry['科目代碼'] || '').trim();
        const day = parseInt(entry['星期'], 10);
        if (!classCode || !subjectCode || !Number.isFinite(day)) return;
        const key = classCode + '|' + day;
        if (!grouped.has(key)) grouped.set(key, { classCode, day, subjects: new Set(), entries: [] });
        const group = grouped.get(key);
        group.subjects.add(subjectCode);
        group.entries.push(entry);
      });

      const conflicts = [];
      (state.subjectRelations || []).forEach(relation => {
        const pair = getSubjectRelationCodes(relation);
        if (pair.length !== 2) return;
        grouped.forEach(group => {
          const classInfo = idx.classByCode[group.classCode];
          const grade = String(classInfo?.['年級'] || group.classCode.charAt(0)).trim();
          if (!group.subjects.has(pair[0]) || !group.subjects.has(pair[1]) ||
              !subjectRelationAppliesToClass(relation, group.classCode, grade)) return;
          conflicts.push({
            relation,
            classCode: group.classCode,
            day: group.day,
            entries: group.entries.filter(entry => pair.includes(String(entry['科目代碼'] || '').trim()))
          });
        });
      });
      return conflicts;
    };

    const repairSubjectRelationConflicts = () => {
      let moved = 0;
      for (let pass = 0; pass < 2; pass++) {
        if (shouldStopAutoSchedule('subject-relation-optimization')) break;
        const conflicts = collectSubjectRelationConflicts();
        if (conflicts.length === 0) break;
        let passMoved = 0;
        conflicts.forEach(conflict => {
          if (!conflict.entries.every(entry =>
            localSchedule.includes(entry) && parseInt(entry['星期'], 10) === conflict.day
          )) return;
          const movableEntries = conflict.entries.filter(entry => isAutoMovableEntry(entry));
          let best = null;
          movableEntries.forEach(entry => {
            if (shouldStopAutoSchedule('subject-relation-optimization')) return;
            const index = localSchedule.indexOf(entry);
            if (index < 0) return;
            const lesson = entryToLesson(entry);
            const baseSchedule = localSchedule.filter((_, itemIndex) => itemIndex !== index);
            const baseLookup = buildScheduleLookup(baseSchedule);
            for (let day = 1; day <= 5; day++) {
              for (let period = autoStartPeriod; period <= autoEndPeriod; period++) {
                if (shouldStopAutoSchedule('subject-relation-optimization')) break;
                if (day === conflict.day) continue;
                if (!isSlotValid(lesson.classCode, lesson.subjectCode, autoTeacherInput(lesson), day, period, baseSchedule, baseLookup)) continue;
                if (getSubjectRelationViolationCount(lesson, day, period, baseSchedule, baseLookup) > 0) continue;
                const score = scorePlacement(lesson, day, period, baseSchedule, baseLookup);
                if (!best || score > best.score) best = { index, entry, day, period, score };
              }
            }
          });
          if (!best) return;
          setLocalScheduleEntry(best.index, { ...best.entry, '星期': best.day, '節次': best.period });
          passMoved++;
          moved++;
        });
        if (passMoved === 0) break;
      }
      return moved;
    };

    const getMovableIndexes = () => localSchedule
      .map((entry, index) => isAutoMovableEntry(entry) ? index : -1)
      .filter(index => index >= 0);

    localOptimizationCandidates = getMovableIndexes().length;
    if (localOptimizationCandidates === 0) return;
    updateProgress('正在改善合法但不理想的課表…');

    for (let pass = 0; pass < localOptPasses; pass++) {
      if (shouldStopAutoSchedule('local-optimization')) break;
      const passScheduleSnapshot = [...localSchedule];
      const passQualityBefore = readLocalQuality(passScheduleSnapshot);
      let passMoves = 0;
      let improved = false;
      for (const index of getMovableIndexes()) {
        if (shouldStopAutoSchedule('local-optimization')) break;
        const best = findBestMove(index);
        if (!best) continue;
        setLocalScheduleEntry(index, best.entry);
        localOptimizationAttemptedMoves++;
        localOptimizationMoves++;
        passMoves++;
        improved = true;
      }

      // 沒有空格可直接移動時，再嘗試交換兩個可移動課程的時段。
      if (optSmartSwap) {
        const trySwapPair = (indexA, indexB) => {
          const entryA = localSchedule[indexA];
          const entryB = localSchedule[indexB];
          if (!entryA || !entryB) return false;
          const dayA = parseInt(entryA['星期'], 10);
          const periodA = parseInt(entryA['節次'], 10);
          const dayB = parseInt(entryB['星期'], 10);
          const periodB = parseInt(entryB['節次'], 10);
          if (dayA === dayB && periodA === periodB) return false;

          const baseSchedule = localSchedule.filter((_, i) => i !== indexA && i !== indexB);
          const baseLookup = buildScheduleLookup(baseSchedule);
          const lessonA = entryToLesson(entryA);
          const lessonB = entryToLesson(entryB);
          if (!isSlotValid(lessonA.classCode, lessonA.subjectCode, autoTeacherInput(lessonA), dayB, periodB, baseSchedule, baseLookup)) return false;

          const movedA = { ...entryA, '星期': dayB, '節次': periodB };
          const scheduleWithA = [...baseSchedule, movedA];
          const lookupWithA = buildScheduleLookup(scheduleWithA);
          if (!isSlotValid(lessonB.classCode, lessonB.subjectCode, autoTeacherInput(lessonB), dayA, periodA, scheduleWithA, lookupWithA)) return false;

          const oldScheduleWithA = [...baseSchedule, entryA];
          const oldLookupWithA = buildScheduleLookup(oldScheduleWithA);
          const oldScore = scorePlacement(lessonA, dayA, periodA, baseSchedule, baseLookup) +
            scorePlacement(lessonB, dayB, periodB, oldScheduleWithA, oldLookupWithA);
           const newScore = scorePlacement(lessonA, dayB, periodB, baseSchedule, baseLookup) +
             scorePlacement(lessonB, dayA, periodA, scheduleWithA, lookupWithA);
           const oldGapCost = getTeacherGapCostForEntries(baseSchedule, [entryA, entryB]);
           const movedB = { ...entryB, '星期': dayA, '節次': periodA };
           const newGapCost = getTeacherGapCostForEntries(baseSchedule, [movedA, movedB]);
           const oldRelationCost = getSubjectRelationViolationCount(lessonA, dayA, periodA, baseSchedule, baseLookup) +
             getSubjectRelationViolationCount(lessonB, dayB, periodB, oldScheduleWithA, oldLookupWithA);
           const newRelationCost = getSubjectRelationViolationCount(lessonA, dayB, periodB, baseSchedule, baseLookup) +
             getSubjectRelationViolationCount(lessonB, dayA, periodA, scheduleWithA, lookupWithA);
           if (newRelationCost > oldRelationCost ||
               newGapCost > oldGapCost ||
               (newGapCost === oldGapCost && newRelationCost === oldRelationCost && newScore <= oldScore)) return false;

          setLocalScheduleEntry(indexA, movedA);
          setLocalScheduleEntry(indexB, movedB);
          return true;
        };

        const movableIndexes = getMovableIndexes();
        let checkedPairs = 0;
        const classGroups = new Map();
        movableIndexes.forEach(index => {
          const classCode = String(localSchedule[index]['班級代碼'] || '');
          if (!classGroups.has(classCode)) classGroups.set(classCode, []);
          classGroups.get(classCode).push(index);
        });
        const prioritizedGroups = [...classGroups.values()].sort((left, right) =>
          getTeacherGapCostForEntries(localSchedule, right.map(index => localSchedule[index])) -
          getTeacherGapCostForEntries(localSchedule, left.map(index => localSchedule[index]))
        );
        swapSearch: for (const group of prioritizedGroups) {
          if (shouldStopAutoSchedule('local-optimization')) break swapSearch;
          for (let a = 0; a < group.length; a++) {
            for (let b = a + 1; b < group.length; b++) {
              if (shouldStopAutoSchedule('local-optimization')) break swapSearch;
              if (++checkedPairs > maxSwapPairsPerPass) break swapSearch;
              if (!trySwapPair(group[a], group[b])) continue;
              localOptimizationAttemptedMoves++;
              localOptimizationMoves++;
              passMoves++;
              improved = true;
              break swapSearch;
            }
          }
        }
        if (!improved) {
          checkedPairs = 0;
          swapSearch: for (let a = 0; a < movableIndexes.length; a++) {
            if (shouldStopAutoSchedule('local-optimization')) break swapSearch;
            for (let b = a + 1; b < movableIndexes.length; b++) {
              if (shouldStopAutoSchedule('local-optimization')) break swapSearch;
              if (++checkedPairs > maxSwapPairsPerPass) break swapSearch;
              if (!trySwapPair(movableIndexes[a], movableIndexes[b])) continue;
              localOptimizationAttemptedMoves++;
              localOptimizationMoves++;
              passMoves++;
              improved = true;
              break swapSearch;
            }
          }
        }
      }

      const relationMoves = repairSubjectRelationConflicts();
      if (relationMoves > 0) {
        localOptimizationMoves += relationMoves;
        passMoves += relationMoves;
        improved = true;
      }

      const passQualityAfter = readLocalQuality(localSchedule);
      if (passQualityBefore && passQualityAfter && compareLocalQuality(passQualityAfter, passQualityBefore) > 0) {
        replaceLocalSchedule(passScheduleSnapshot);
        localOptimizationMoves -= passMoves;
        localOptimizationRollbacks++;
        improved = false;
        console.log('  ↩️ 局部最佳化品質未改善，回復本輪移動');
      }

      if (!improved) break;
      await yieldToUI();
    }
    console.log('[AutoSchedule] 局部最佳化完成：' + localOptimizationMoves + ' 次移動／交換');
  }

  await optimizeAutoScheduleLocally();

  markAutoScheduleProfile('diagnostics');
  function analyzeAutoFailureLesson(lesson) {
    const teacherIdentities = new Set(resolveAutoTeacherCodes(autoTeacherInput(lesson)));
    const exclusivePeers = new Set();
    teacherIdentities.forEach(identity => (autoTeacherExclusivePeers.get(identity) || []).forEach(peer => exclusivePeers.add(peer)));
    const subjectCode = String(lesson.subjectCode || '');
    const roomCode = getSubjectRoomCode(subjectCode);
    const subject = idx.subjectByCode[subjectCode] || {};
    const maxConcurrent = parseInt(subject['同時最多班數'] || '0', 10) || 0;
    const rules = getApplicableRules(subjectCode, lesson.classCode);
    const blockerCounts = new Map();
    const slots = [];
    const failureLookup = buildScheduleLookup(localSchedule);
    const movableEntries = new Set();
    let candidateSlots = 0;
    let legalSlots = 0;
    const addBlocker = (blockers, type, entry = null) => {
      blockers.push(type);
      blockerCounts.set(type, (blockerCounts.get(type) || 0) + 1);
      if (entry && !isFrozenAutoEntry(entry) && !isBindAutoEntry(entry)) {
        const key = String(entry['課表ID'] || [entry['班級代碼'], entry['科目代碼'], entry['星期'], entry['節次']].join('|'));
        movableEntries.add(key);
      }
    };

    for (let day = 1; day <= 5; day++) {
      for (let period = autoStartPeriod; period <= autoEndPeriod; period++) {
        candidateSlots++;
        const slotEntries = localSchedule.filter(entry =>
          parseInt(entry['星期'], 10) === day && parseInt(entry['節次'], 10) === period
        );
        const blockers = [];
        slotEntries
          .filter(entry => String(entry['班級代碼']) === String(lesson.classCode))
          .forEach(entry => addBlocker(blockers, '班級格已占用', entry));
        teacherIdentities.forEach(identity => {
          if (idx.blockSet.has(identity + '|' + day + '|' + period)) addBlocker(blockers, '教師不排課');
          slotEntries
            .filter(entry => resolveAutoTeacherCodes(entry).includes(identity))
            .forEach(entry => addBlocker(blockers, '教師衝堂', entry));
        });
        slotEntries
          .filter(entry => resolveAutoTeacherCodes(entry).some(identity => exclusivePeers.has(identity)))
          .forEach(entry => addBlocker(blockers, '教師互斥', entry));
        if (roomCode) {
          const roomEntries = slotEntries.filter(entry => !isPatrolScheduleEntry(entry) && getSubjectRoomCode(entry['科目代碼']) === roomCode);
          if (roomEntries.length >= getSubjectRoomCapacity(subjectCode)) roomEntries.forEach(entry => addBlocker(blockers, '教室容量', entry));
        }
        if (maxConcurrent > 0) {
          slotEntries
            .filter(entry => String(entry['科目代碼']) === subjectCode)
            .slice(0, Math.max(0, slotEntries.filter(entry => String(entry['科目代碼']) === subjectCode).length - maxConcurrent + 1))
            .forEach(entry => addBlocker(blockers, '科目同時上限', entry));
        }
        if (rules.some(item => isForbiddenAutoRule(item.rule) && item.slots.some(slot => slot.day === day && slot.period === period))) {
          addBlocker(blockers, '科目禁排');
        }
        const mandatoryRules = rules.filter(item => isMandatoryAutoRule(item.rule));
        if (mandatoryRules.length > 0 && !mandatoryRules.some(item => item.slots.some(slot => slot.day === day && slot.period === period))) {
          addBlocker(blockers, '不在必排時段');
        }
        if (!canPlaceClassSubjectOnDay(lesson.classCode, subjectCode, day, localSchedule, failureLookup)) {
          addBlocker(blockers, '同班同科同日限制');
        }
        if (!canPlaceSubjectWithinMaxConsecutiveDays(lesson.classCode, subjectCode, day, localSchedule, failureLookup)) {
          addBlocker(blockers, '科目連日限制');
        }
        if (optTeacherConsec) {
          teacherIdentities.forEach(identity => {
            const teacher = idx.teacherByCode[canonicalAutoTeacherCode(identity)];
            const maxConsecutive = teacher ? parseInt(teacher['最大連堂節數'] || '2', 10) : 2;
            if (countConsecutiveInLocal(localSchedule, identity, day, period) > maxConsecutive) addBlocker(blockers, '教師連堂限制');
          });
        }
        if (isSlotValid(lesson.classCode, subjectCode, autoTeacherInput(lesson), day, period, localSchedule, failureLookup)) {
          legalSlots++;
        } else if (blockers.length === 0) {
          addBlocker(blockers, '其他硬限制');
        }
        if (blockers.length > 0) slots.push({ day, period, blockers: [...new Set(blockers)] });
      }
    }
    slots.sort((left, right) => left.blockers.length - right.blockers.length || left.day - right.day || left.period - right.period);
    return {
      candidateSlots,
      legalSlots,
      minimumBlockerTypes: slots[0]?.blockers.length || 0,
      movableEntries: movableEntries.size,
      blockerCounts: Object.fromEntries([...blockerCounts.entries()].sort((left, right) => right[1] - left[1])),
      tightSlots: slots.slice(0, 5)
    };
  }

  const includeFailureGraph = runOptions.includeFailureGraph === true ||
    (previewOnly && typeof window !== 'undefined' && window.__enableAutoFailureGraph === true);
  const autoFailureDetails = [...failList, ...bindFailureLessons]
    .filter(Boolean)
    .map(lesson => ({
      classCode: String(lesson.classCode || ''),
      subjectCode: String(lesson.subjectCode || ''),
      teacherCode: String(lesson.teacherCode || ''),
      failureReason: String(lesson.failureReason || ''),
      dynamicPressure: Number(lesson.dynamicPressure || getAutoConflictPressure(lesson)),
      strictAvailableSlots: Number(lesson.strictAvailableSlots || 0),
      sameDayRelaxedAvailableSlots: Number(lesson.sameDayRelaxedAvailableSlots || 0),
      constraintGraph: includeFailureGraph ? analyzeAutoFailureLesson(lesson) : null
    }));
  if (typeof window !== 'undefined') window.__lastAutoScheduleFailureDetails = autoFailureDetails;
  if (typeof window !== 'undefined') window.__lastAutoScheduleConflictPressure = {
    failureEvents: autoConflictStats.failureEvents,
    classes: Object.fromEntries(autoConflictWeights.class),
    teachers: Object.fromEntries(autoConflictWeights.teacher),
    subjects: Object.fromEntries(autoConflictWeights.subject),
    rooms: Object.fromEntries(autoConflictWeights.room),
    reasons: Object.fromEntries(autoConflictWeights.reason)
  };
  if (typeof window !== 'undefined') window.__lastAutoScheduleRunSummary = {
    timedOut: autoScheduleTimedOut,
    timeBudgetMs: autoScheduleTimeBudgetMs,
    repairBudgetExceeded,
    repairOperationCount,
     repairOperationLimit,
     repairGlobalReserveMs,
     neighborhoodRepairMoves,
     globalMatchingPasses,
     neighborhoodRepairStats,
     conflictGraphMoves,
     conflictGraphSearches: conflictGraphStats.searches,
     conflictGraphNodes: conflictGraphStats.nodes,
     conflictGraphCandidates: conflictGraphStats.candidates,
     bindFailureDiagnostics: [...bindFailureDiagnostics.values()],
     localOptimizationMoves,
    localOptimizationCandidates,
    localOptimizationAttemptedMoves,
    localOptimizationRollbacks,
    qualityGraceActive: autoScheduleQualityGraceActive,
    failureCount: failList.length + bindFailureLessons.length
  };
  if (typeof window !== 'undefined') window.__lastAutoScheduleProfile = readAutoScheduleProfile();

  // 4. 完成
  await yieldToUI();
  updateProgress('套用結果中…');

  // 結果套用採樂觀更新：先讓瀏覽器關閉全螢幕遮罩並重繪，
  // 本地課表與雲端寫回都不要讓「套用結果中…」佔住整個畫面。
  showLoading(false);
  await yieldToUI();

  // 5. 套用結果並更新 UI
  const frozenViolations = verifyFrozenEntries();
  if (frozenViolations.length > 0) {
    showLoading(false);
    console.error('[AutoSchedule] 凍結課完整性檢查失敗：', frozenViolations);
    if (previewOnly) {
      return {
        schedule: localSchedule.map(entry => ({ ...entry })),
        quality: null,
        frozenViolations,
        pendingCount: pendingLessons.length,
        localOptimizationMoves,
        neighborhoodRepairMoves,
        conflictGraphMoves,
        timedOut: autoScheduleTimedOut,
        timeBudgetMs: autoScheduleTimeBudgetMs,
        repairBudgetExceeded,
        failureDetails: autoFailureDetails,
        elapsedMs: Date.now() - autoScheduleStartedAt
      };
    }
    showModal('自動排課未套用', `⛔ 凍結課程檢查失敗，為保護鎖課與必排課，本次結果未寫回。<br><br>${frozenViolations.map(esc).join('<br>')}<br><br>總用時：${formatAutoScheduleElapsed()}`, 'error');
    return;
  }
  const candidateQuality = typeof window !== 'undefined' && typeof window.buildAutoScheduleQualityReport === 'function'
       ? window.buildAutoScheduleQualityReport({ schedule: localSchedule, optP8Only, autoEndPeriod, onePerDay: optOnePerDay, ignoreTeacherConsecutiveIds: originalScheduleIds })
    : null;
  if (candidateQuality && candidateQuality.violations.length > 0) {
    console.error('[AutoSchedule] 候選課表硬限制稽核失敗：', candidateQuality.violations);
    if (previewOnly) {
      return {
        schedule: localSchedule.map(entry => ({ ...entry })),
        quality: candidateQuality,
        pendingCount: pendingLessons.length,
         localOptimizationMoves,
         neighborhoodRepairMoves,
         conflictGraphMoves,
        timedOut: autoScheduleTimedOut,
        timeBudgetMs: autoScheduleTimeBudgetMs,
        repairBudgetExceeded,
        failureDetails: autoFailureDetails,
        elapsedMs: Date.now() - autoScheduleStartedAt
      };
    }
    showModal('自動排課未套用', `⛔ 候選課表未通過硬限制稽核，本次結果未寫回。<br><br>${candidateQuality.violations.slice(0, 20).map(esc).join('<br>')}<br><br>總用時：${formatAutoScheduleElapsed()}`, 'error');
    return;
  }
  if (previewOnly) {
    return {
      schedule: localSchedule.map(entry => ({ ...entry })),
      quality: candidateQuality,
      pendingCount: pendingLessons.length,
       localOptimizationMoves,
       neighborhoodRepairMoves,
       conflictGraphMoves,
      timedOut: autoScheduleTimedOut,
      timeBudgetMs: autoScheduleTimeBudgetMs,
      repairBudgetExceeded,
      failureDetails: autoFailureDetails,
      elapsedMs: Date.now() - autoScheduleStartedAt
    };
  }
  state.schedule = localSchedule;
  buildIndex();
  if (ui.selectedClass) renderClassTT(ui.selectedClass);
  if (ui.selectedTeacher) renderTeacherTT(ui.selectedTeacher);

  // 保留這次結果的快照，雲端同步在背景進行，不等待、不重新開啟全螢幕遮罩。
  const scheduleSnapshot = state.schedule.map(entry => ({ ...entry }));
  if (!GAS_URL) {
    toast('課表已套用至目前畫面（尚未連線雲端）', 'info');
  } else {
     gasPost('batchUpdateSchedule', { schedule: scheduleSnapshot, baseRevision: state.scheduleRevision, ignoredTeacherConsecutiveIds: originalScheduleIds }, { silent: true })
      .then(res => {
        if (!res) {
          toast('雲端暫時無法連線，已保留目前課表', 'warning');
          return;
        }
        if (!res.ok) {
          const writeError = res.error || '雲端同步遭拒，正在背景重新載入課表';
          toast(writeError, 'warning');
          showModal('自動排課未寫入資料庫', `⛔ ${esc(writeError)}<br><br>本次結果未寫入雲端，系統將重新載入資料庫中的課表。`, 'error');
          loadAll({ background: true }).catch(err => {
            console.error('Background reload error:', err);
          });
          return;
        }
        applyScheduleRevisionResponse(res);
        toast('✅ 自動排課已寫入資料庫', 'success');
        console.log('Batch auto-schedule saved');
      })
      .catch(err => console.error('Batch save error:', err));
  }

  const rangeLabel = optP8Only ? '第 8 節（課後輔導）' : `第 ${autoStartPeriod}~${autoEndPeriod} 節`;
   const quality = window.buildAutoScheduleQualityReport({ schedule: state.schedule, optP8Only, autoEndPeriod, onePerDay: optOnePerDay, ignoreTeacherConsecutiveIds: originalScheduleIds });
  const netPlaced = Math.max(0, pendingLessons.length - quality.remainingLessons);
  const totalElapsed = formatAutoScheduleElapsed();
  const failureReasonCounts = new Map();
  const displayedFailureIds = new Set();
  const maxFailureDetails = Math.max(0, quality.remainingLessons);
  for (const lesson of [...failList, ...bindFailureLessons]) {
    if (!lesson || displayedFailureIds.size >= maxFailureDetails) break;
    const failureId = String(lesson.id || (lesson.classCode + '|' + lesson.subjectCode + '|' + lesson.teacherCode + '|' + displayedFailureIds.size));
    if (displayedFailureIds.has(failureId)) continue;
    displayedFailureIds.add(failureId);
    const reason = lesson.failureReason || 'no-legal-slot';
    failureReasonCounts.set(reason, (failureReasonCounts.get(reason) || 0) + 1);
  }
  const failureReasonSummary = [...failureReasonCounts.entries()]
    .map(([reason, count]) => `${autoFailureLabels[reason] || reason} ×${count}`)
    .join('、');
  let msg = `🎉 在 <b>${rangeLabel}</b> 範圍內實際完成 <b>${netPlaced}</b> 節課程。`;
  msg += `<br><br>局部最佳化：<b>${localOptimizationMoves}</b> 次合法移動／交換`;
   msg += `<br><br><b>品質分：${quality.score}/100</b>　教師空堂：${quality.teacherGaps}　每日負擔落差：${quality.teacherImbalance}　教師連堂超限：${quality.teacherLongStreaks}　固定節次集中：${quality.teacherRepeatedPeriods}　下午過量：${quality.teacherAfternoonOverload}　排一七／排四五軟規則：${quality.teacherPairSoftViolations || 0}　教師互斥軟衝突：${quality.teacherExclusiveSoftViolations || 0}　跨年級同日分散：${quality.teacherCrossGradeSameDay || 0}　跨年級相鄰交錯：${quality.teacherCrossGradeAdjacent || 0}　科目關係同日：${quality.subjectRelationSoftViolations || 0}`;
  msg += '<br><br><b>總用時：' + totalElapsed + '</b>';
  if (autoScheduleTimedOut) {
    msg += `<br><br><span style="color:var(--warning);">⏱️ 已達排課時間預算 ${Math.round(autoScheduleTimeBudgetMs / 1000)} 秒，系統保留目前最佳合法課表，未完成課程已列入診斷。</span>`;
  } else if (repairBudgetExceeded) {
    msg += '<br><br><span style="color:var(--warning);">⏱️ 增廣路徑修復已達局部時間預算，系統保留目前最佳合法課表，剩餘課程可再重跑。</span>';
  }
  msg += `<br><br>局部破壞重建：<b>${neighborhoodRepairMoves}</b> 節移動`;
  if (bindFailureLessons.length > 0) {
    msg += `<br><br><span style="color:var(--danger);">⛔ 綁班前置關卡仍有 <b>${bindFailureLessons.length}</b> 節未完成；一般課程未用綁班課程的名額，請先處理綁班共同時段或教師／班級限制。</span>`;
  }
  if (bindDefinitionErrors.length > 0) {
    msg += `<br><br><span style="color:var(--danger);">⛔ 綁班資料前置檢查：${bindDefinitionErrors.map(esc).join('<br>')}</span>`;
  }
  if (quality.deficits.length > 0) {
    const detail = quality.deficits.slice(0, 12).map(item => esc(item.subjectCode)+'（'+esc(item.classCode)+'／'+esc(item.teacherCode)+'）×'+item.remaining).join('、');
    const more = quality.deficits.length > 12 ? `，另有 ${quality.deficits.length - 12} 筆` : '';
    const reasonDetail = failureReasonSummary ? `<br>未排原因分類：${esc(failureReasonSummary)}` : "";
    msg += `<br><br><span style="color:var(--danger);">⚠️ 尚有 <b>${quality.remainingLessons}</b> 節未排：${detail}${more}。${reasonDetail}<br>可能原因：教師不排課、必排時段衝突、綁班共同時段不足或可用格位不足。</span>`;
  }
  if (quality.violations.length > 0) {
    const detail = quality.violations.slice(0, 8).map(esc).join('<br>');
    const more = quality.violations.length > 8 ? `<br>另有 ${quality.violations.length - 8} 項` : '';
    msg += `<br><br><span style="color:var(--danger);"><b>⛔ 硬限制稽核發現 ${quality.violations.length} 項問題：</b><br>${detail}${more}</span>`;
  } else {
    msg += '<br><br><span style="color:var(--success);">✅ 硬限制稽核通過</span>';
  }
  showModal(quality.violations.length ? '⚠️ 自動排課完成但需檢查' : '🤖 自動排課計算完成', msg, 'info');
}

function compareAutoScheduleResults(left, right) {
  const leftQuality = left?.quality || {};
  const rightQuality = right?.quality || {};
  const leftViolations = Array.isArray(leftQuality.violations) ? leftQuality.violations : [];
  const rightViolations = Array.isArray(rightQuality.violations) ? rightQuality.violations : [];
  if (leftViolations.length !== rightViolations.length) return leftViolations.length - rightViolations.length;
  const leftRemaining = Number(leftQuality.remainingLessons) || 0;
  const rightRemaining = Number(rightQuality.remainingLessons) || 0;
  if (leftRemaining !== rightRemaining) return leftRemaining - rightRemaining;
  const leftBindViolations = leftViolations.filter(item => String(item).includes('綁班')).length;
  const rightBindViolations = rightViolations.filter(item => String(item).includes('綁班')).length;
  if (leftBindViolations !== rightBindViolations) return leftBindViolations - rightBindViolations;
  for (const metric of [
    'teacherGaps',
    'teacherImbalance',
    'subjectRelationSoftViolations',
    'teacherLongStreaks',
    'teacherRepeatedPeriods',
    'teacherAfternoonOverload',
    'teacherCrossGradeSameDay',
    'teacherCrossGradeAdjacent'
  ]) {
    const leftValue = Number(leftQuality[metric]) || 0;
    const rightValue = Number(rightQuality[metric]) || 0;
    if (leftValue !== rightValue) return leftValue - rightValue;
  }
  return (Number(rightQuality.score) || 0) - (Number(leftQuality.score) || 0);
}

let _autoSchedulePromise = null;

async function executeAutoSchedule() {
  if (_autoSchedulePromise) {
    toast('自動排課正在執行中，請稍候。', 'info');
    return _autoSchedulePromise;
  }
  _autoSchedulePromise = executeAutoScheduleRun();
  try {
    return await _autoSchedulePromise;
  } finally {
    _autoSchedulePromise = null;
  }
}

async function executeAutoScheduleRun() {
  await waitForPendingScheduleWrites();
  const multiRestart = document.getElementById('auto-opt-multi-restart')?.checked ?? false;
  if (!multiRestart) return executeAutoScheduleCore();
  const originalScheduleIds = [...new Set((state.schedule || [])
    .map(entry => String(entry?.['課表ID'] || '').trim())
    .filter(Boolean))];

  const seedInput = String(document.getElementById('auto-random-seed')?.value || '').trim();
  const parsedSeed = Number.parseInt(seedInput, 10);
  const baseSeed = Number.isFinite(parsedSeed) ? (parsedSeed >>> 0) : (Date.now() >>> 0);
  const runSpecs = [
    { seed: baseSeed, randomize: false },
    { seed: (baseSeed + 1) >>> 0, randomize: true },
    { seed: (baseSeed + 2) >>> 0, randomize: true }
  ];
  const AUTO_MULTI_RESTART_TIME_BUDGET_MS = 240000;
  const explorationStartedAt = Date.now();
  const candidates = [];
  for (let index = 0; index < runSpecs.length; index++) {
    if (index > 0 && Date.now() - explorationStartedAt >= AUTO_MULTI_RESTART_TIME_BUDGET_MS) break;
    updateProgress('多方案探索：第 ' + (index + 1) + '/' + runSpecs.length + ' 個候選…');
    const result = await executeAutoScheduleCore({
      previewOnly: true,
      seed: runSpecs[index].seed,
      randomize: runSpecs[index].randomize
    });
    if (result) candidates.push({ ...result, seed: runSpecs[index].seed });
  }

  const validCandidates = candidates.filter(candidate =>
    !candidate.frozenViolations && candidate.quality && candidate.quality.violations.length === 0
  );
  if (validCandidates.length === 0) {
    const failureLabels = {
      'bind-group-no-common-slot': '綁班沒有共同可用時段',
      'bind-group-weekly-mismatch': '綁班每週節數不一致，整組拒絕排課',
      'no-legal-slot': '沒有合法可用格位',
      'class-zero-slack-no-legal-slot': '班級零彈性，沒有可用格位',
      'cascade-no-legal-slot': '連鎖搬動後仍沒有合法格位',
      'mandatory-evicted': '必排挪出後待重排'
    };
    const getCandidateFailureReasons = candidate => {
      const quality = candidate.quality || {};
      const reasons = [
        ...(Array.isArray(candidate.frozenViolations) ? candidate.frozenViolations : []),
        ...(Array.isArray(quality.violations) ? quality.violations : []),
        ...(Array.isArray(quality.deficits) ? quality.deficits.slice(0, 12).map(item =>
          '未排：' + String(item.subjectCode || '') + '（' + String(item.classCode || '') + '／' + String(item.teacherCode || '') + '）×' + String(item.remaining || 0)
        ) : [])
      ];
      const failureCounts = new Map();
      (Array.isArray(candidate.failureDetails) ? candidate.failureDetails : []).forEach(item => {
        const reason = failureLabels[item.failureReason] || item.failureReason;
        if (reason) failureCounts.set(reason, (failureCounts.get(reason) || 0) + 1);
      });
      failureCounts.forEach((count, reason) => reasons.push('排課失敗：' + reason + (count > 1 ? ' ×' + count : '')));
      if (reasons.length === 0 && Number(quality.remainingLessons) > 0) {
        reasons.push('尚有 ' + String(quality.remainingLessons) + ' 節未排');
      }
      return [...new Set(reasons)];
    };
    const candidateDetails = candidates.map((candidate, index) => {
      const reasons = getCandidateFailureReasons(candidate);
      const visibleReasons = reasons.slice(0, 8);
      const more = reasons.length > visibleReasons.length
        ? '<br><span style="color:var(--muted);">另有 ' + (reasons.length - visibleReasons.length) + ' 項</span>'
        : '';
      return '<br><br><b>候選 ' + (index + 1) + '（種子 ' + esc(String(candidate.seed ?? '未設定')) + '）</b><br>' +
        (visibleReasons.length ? visibleReasons.map(reason => '・' + esc(reason)).join('<br>') : '未取得具體原因') + more;
    }).join('');
    showModal(
      '多方案探索未產生合法課表',
      '⛔ ' + candidates.length + ' 個候選課表都未通過硬限制稽核，原課表未變更。' + candidateDetails,
      'error'
    );
    return;
  }
  validCandidates.sort(compareAutoScheduleResults);
  const best = validCandidates[0];
  state.schedule = best.schedule.map(entry => ({ ...entry }));
  buildIndex();
  if (ui.selectedClass) renderClassTT(ui.selectedClass);
  if (ui.selectedTeacher) renderTeacherTT(ui.selectedTeacher);

  const quality = best.quality;
  const pendingCount = Number(best.pendingCount) || 0;
  const netPlaced = Math.max(0, pendingCount - (Number(quality.remainingLessons) || 0));
  const detail = (quality.deficits || []).slice(0, 12)
    .map(item => esc(item.subjectCode) + '（' + esc(item.classCode) + '／' + esc(item.teacherCode) + '）×' + item.remaining)
    .join('、');
  let message = `🎲 已比較 ${validCandidates.length} 個合法候選，選用種子 <b>${best.seed}</b>。`;
  message += `<br><br>本次新增排入 <b>${netPlaced}</b> 節，品質分 <b>${quality.score}/100</b>。`;
  if (quality.remainingLessons > 0) {
    message += `<br><br><span style="color:var(--danger);">尚有 <b>${quality.remainingLessons}</b> 節未排：${detail || '請查看課表稽核結果'}。</span>`;
  } else {
    message += '<br><br><span style="color:var(--success);">✅ 所有配課項目均已排入，硬限制稽核通過。</span>';
  }
  showModal('多方案自動排課完成', message, 'info');

  const scheduleSnapshot = state.schedule.map(entry => ({ ...entry }));
  if (!GAS_URL) {
    toast('多方案課表已套用至目前畫面（尚未連線雲端）', 'info');
    return;
  }
    gasPost('batchUpdateSchedule', { schedule: scheduleSnapshot, baseRevision: state.scheduleRevision, ignoredTeacherConsecutiveIds: originalScheduleIds }, { silent: true })
    .then(res => {
      if (!res) {
        toast('雲端暫時無法連線，已保留目前課表', 'warning');
        return;
      }
      if (!res.ok) {
        const writeError = res.error || '雲端同步遭拒，正在背景重新載入課表';
        toast(writeError, 'warning');
        showModal('多方案自動排課未寫入資料庫', `⛔ ${esc(writeError)}<br><br>本次結果未寫入雲端，系統將重新載入資料庫中的課表。`, 'error');
        loadAll({ background: true }).catch(err => console.error('Background reload error:', err));
        return;
      }
      applyScheduleRevisionResponse(res);
      toast('✅ 多方案自動排課已寫入資料庫', 'success');
    })
    .catch(err => console.error('Multi-run batch save error:', err));
}

// ============================================================
// 全新強大批次配課控制台 (3大模式)
// ============================================================
function renderBatchPicker() {
  const safeClasses = state && state.classes ? state.classes : [];
  const safeSubjects = state && state.subjects ? state.subjects : [];
  const modeSelect = document.getElementById('batch-mode');
  const mode = modeSelect ? modeSelect.value : 'class-matrix';
  const wrap = document.getElementById('batch-picker');
  if (!wrap) return;

   if (mode === 'class-matrix') {
     // 🏫 1. 按 班級/年級 配課
     let html = '<div style="display:flex;flex-direction:column;gap:10px;">';
     html += '<div class="form-row" style="margin-bottom:0;">';
     html += '<div class="form-group" style="flex:2;"><label style="font-weight:bold;">選擇目標班級或年級：</label>';
     html += '<select id="batch-class-target" style="width:100%;font-weight:bold;" onchange="renderBatchPreview()">';
     html += '<option value="">— 請選擇班級 —</option>';
     html += '<optgroup label="全體年級">';
     html += '<option value="GRADE_7">7 年級全體班級</option>';
     html += '<option value="GRADE_8">8 年級全體班級</option>';
     html += '<option value="GRADE_9">9 年級全體班級</option>';
     html += '</optgroup>';
     html += '<optgroup label="個別班級">';
     safeClasses.forEach(c => {
      html += `<option value="${esc(c['班級代碼'])}">${esc(c['班級代碼'])} ${esc(c['班級名稱']||'')}</option>`;
    });
    html += '</optgroup></select></div>';
    
    html += '<div class="form-group" style="flex:1;"><label style="font-weight:bold;">科目過濾：</label>';
    html += '<select id="batch-class-sub-filter" style="width:100%;" onchange="renderBatchPreview()">';
    html += '<option value="ALL">全部正式與選修科目</option>';
    html += '<option value="CORE" selected>僅正式必修科目</option>';
    html += '</select></div>';
    html += '</div>';
    html += '</div>';
    wrap.innerHTML = html;

   } else if (mode === 'subject-matrix') {
     // 📚 2. 按 科目 配課 (可細部勾選/單獨挑選班級)
     let html = '<div style="display:flex;flex-direction:column;gap:8px;">';
     html += '<div class="form-row" style="margin-bottom:0;">';
     html += '<div class="form-group" style="flex:1;"><label style="font-weight:bold;">選擇配課科目：</label>';
     html += '<select id="batch-subject-select" style="width:100%;font-weight:bold;" onchange="updateBatchSubjectClasses()">';
     html += '<option value="">— 請選擇科目 —</option>';
     safeSubjects.forEach(s => {
      html += `<option value="${esc(s['科目代碼'])}">${esc(s['科目代碼'])} (每週預設 ${s['每週節數']||1} 節)</option>`;
    });
    html += '</select></div>';
    html += '</div>';

    // 細部班級選擇區
    html += '<div style="font-size:12px;">';
    html += '<div style="margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;">';
    html += '<span style="font-weight:bold;">開課班級（可細部單獨勾選/全選）：</span>';
    html += '<div>';
    html += '<button class="btn btn-ghost btn-xs" onclick="toggleBatchSubClasses(\'7\')">7年級</button> ';
    html += '<button class="btn btn-ghost btn-xs" onclick="toggleBatchSubClasses(\'8\')">8年級</button> ';
    html += '<button class="btn btn-ghost btn-xs" onclick="toggleBatchSubClasses(\'9\')">9年級</button> ';
    html += '<button class="btn btn-ghost btn-xs" onclick="toggleBatchSubClasses(\'ALL\')">全選</button> ';
    html += '<button class="btn btn-ghost btn-xs" onclick="toggleBatchSubClasses(\'NONE\')">清空</button>';
    html += '</div>';
    html += '</div>';

    html += '<div id="batch-sub-cls-boxes" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(85px,1fr));gap:6px;max-height:95px;overflow-y:auto;padding:6px;border:1px solid var(--border);border-radius:4px;background:var(--bg-card);">';
    state.classes.forEach(c => {
      html += `<label style="display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="checkbox" class="batch-sub-cls-cb" value="${esc(c['班級代碼'])}" data-grade="${esc(c['年級']||'')}" onchange="renderBatchPreview()">${esc(c['班級代碼'])}</label>`;
    });
    html += '</div>';
    html += '</div>';

    // 年級批次快速填寫列
    html += '<div style="background:var(--surface-2);padding:6px 10px;border-radius:6px;border:1px solid var(--border);display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;">';
    html += '<span style="font-weight:bold;">⚡ 全年級快速指定授課教師：</span>';
    html += '<div style="display:flex;gap:6px;align-items:center;">';
    html += '<input id="quick-tea-input" placeholder="— 選擇教師 —" style="width:140px;height:30px;">';
    html += '<button class="btn btn-ghost btn-xs" onclick="applyQuickTeacher(\'7\')">套用7年級</button>';
    html += '<button class="btn btn-ghost btn-xs" onclick="applyQuickTeacher(\'8\')">套用8年級</button>';
    html += '<button class="btn btn-ghost btn-xs" onclick="applyQuickTeacher(\'9\')">套用9年級</button>';
    html += '<button class="btn btn-ghost btn-xs" onclick="applyQuickTeacher(\'ALL\')">套用全部已選班級</button>';
    html += '</div>';
    html += '</div>';

    html += '</div>';
    wrap.innerHTML = html;

    initTeacherCombobox(document.getElementById('quick-tea-input'));
    updateBatchSubjectClasses();

   } else {
     // 👩‍🏫 3. 按 教師 配課
     let html = '<div style="display:flex;flex-direction:column;gap:10px;">';
     html += '<div class="form-row" style="margin-bottom:0;">';
     html += '<div class="form-group" style="flex:1.5;"><label style="font-weight:bold;">選擇教師：</label>';
     html += '<input id="batch-teacher-select" placeholder="— 選擇教師 —" style="width:100%;">';
     html += '</div>';
     
     html += '<div class="form-group" style="flex:1.5;"><label style="font-weight:bold;">選擇科目：</label>';
     html += '<select id="batch-teacher-subject-select" style="width:100%;" onchange="updateBatchTeacherClasses({ autoCheckMode: \'MINE\' })">';
     html += '<option value="">— 請選擇科目 —</option>';
     safeSubjects.forEach(s => {
      html += `<option value="${esc(s['科目代碼'])}">${esc(s['科目代碼'])}</option>`;
    });
    html += '</select></div>';
    html += '</div>';

    html += '<div style="font-size:12px;">';
    html += '<div style="margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;">';
    html += '<span style="font-weight:bold;">勾選授課班級：</span>';
    html += '<div>';
    html += '<button class="btn btn-ghost btn-xs" onclick="toggleBatchTeacherClasses(\'7\')">7年級</button> ';
    html += '<button class="btn btn-ghost btn-xs" onclick="toggleBatchTeacherClasses(\'8\')">8年級</button> ';
    html += '<button class="btn btn-ghost btn-xs" onclick="toggleBatchTeacherClasses(\'9\')">9年級</button> ';
    html += '<button class="btn btn-ghost btn-xs" style="color:var(--warning-dark);font-weight:bold;" onclick="toggleBatchTeacherClasses(\'UNASSIGNED\')">⚠️ 僅未配課</button> ';
    html += '<button class="btn btn-ghost btn-xs" style="color:var(--accent);font-weight:bold;" onclick="toggleBatchTeacherClasses(\'MINE\')">👤 僅本師</button> ';
    html += '<button class="btn btn-ghost btn-xs" style="color:var(--primary);font-weight:bold;" onclick="toggleBatchTeacherClasses(\'ADMIN\')">👔 僅行政</button> ';
    html += '<button class="btn btn-ghost btn-xs" onclick="toggleBatchTeacherClasses(\'ALL\')">全選</button> ';
    html += '<button class="btn btn-ghost btn-xs" onclick="toggleBatchTeacherClasses(\'NONE\')">清除</button>';
    html += '</div>';
    html += '</div>';
    html += '<div id="batch-teacher-cls-boxes" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:6px;max-height:120px;overflow-y:auto;padding:6px;border:1px solid var(--border);border-radius:4px;background:var(--bg-card);">';
    html += '</div>';
    html += '</div>';

    html += '</div>';
    wrap.innerHTML = html;

    initTeacherCombobox(document.getElementById('batch-teacher-select'), (tc) => {
      // 自動判定該教師的主要任教科目
      const teacher = idx.teacherByCode[tc];
      if (teacher && teacher['任教科目']) {
        const firstSub = teacher['任教科目'].split(',')[0].trim();
        const sel = document.getElementById('batch-teacher-subject-select');
        if (sel && firstSub) sel.value = firstSub;
      }
      updateBatchTeacherClasses({ autoCheckMode: 'MINE' });
    });

    updateBatchTeacherClasses();
  }
}

function applyQuickTeacher(targetGrade) {
  const quickInp = document.getElementById('quick-tea-input');
  if (!quickInp || !quickInp.value) { toast('請先在快速指定欄輸入或選擇教師', 'warning'); return; }
  const teaVal = quickInp.value;

  const rows = document.querySelectorAll('#batch-preview .batch-teacher-input');
  rows.forEach(inp => {
    const rowGrade = inp.dataset.grade;
    if (targetGrade === 'ALL' || String(rowGrade) === String(targetGrade)) {
      inp.value = teaVal;
      if (inp._updateControls) inp._updateControls();
    }
  });
  toast(`已快速將 ${teaVal} 套用至目標班級`, 'success');
}

function toggleBatchTeacherClasses(target) {
  if (target === 'UNASSIGNED') {
    updateBatchTeacherClasses({ autoCheckMode: 'UNASSIGNED' });
  } else if (target === 'MINE') {
    updateBatchTeacherClasses({ autoCheckMode: 'MINE' });
  } else if (target === 'ADMIN') {
    updateBatchTeacherClasses({ autoCheckMode: 'ADMIN' });
  } else if (target === 'MINE_AND_UNASSIGNED') {
    updateBatchTeacherClasses({ autoCheckMode: 'MINE_AND_UNASSIGNED' });
  } else {
    document.querySelectorAll('#batch-teacher-cls-boxes .batch-tea-cls-cb').forEach(cb => {
      const g = cb.dataset.grade;
      if (target === 'ALL') cb.checked = true;
      else if (target === 'NONE') cb.checked = false;
      else cb.checked = (g === target);
    });
    renderBatchPreview();
  }
}

function updateBatchTeacherClasses(options = {}) {
   const safeClasses = state && state.classes ? state.classes : [];
   const tc = parseTeacherCode(document.getElementById('batch-teacher-select')?.value);
   const subCode = document.getElementById('batch-teacher-subject-select')?.value;
   const boxesContainer = document.getElementById('batch-teacher-cls-boxes');
   if (!boxesContainer) return;

   const previousChecked = new Set(
     Array.from(boxesContainer.querySelectorAll('.batch-tea-cls-cb:checked')).map(cb => cb.value)
   );

   let html = '';
   safeClasses.forEach(c => {
    const clsCode = String(c['班級代碼'] || '');
    const clsGrade = String(c['年級'] || '');
    const clsName = c['班級名稱'] || clsCode;

    let badgeHtml = '';
    let isMine = false;
    let isUnassigned = false;

     if (subCode) {
       const asgn = idx.teacherByClassSubject?.[clsCode + '|' + subCode];
       if (asgn && asgn['教師姓名']) {
         const currentTeacherCodes = getCellTeacherCodes(asgn);
         const curTc = currentTeacherCodes[0] || '';
         const curTeaName = currentTeacherCodes.map(code => formatBatchTeacherValue(code)).filter(Boolean).join('、') || curTc;
         const isSameTea = tc && isBatchTeacherMatch(asgn, tc);
         if (isSameTea) {
          isMine = true;
          badgeHtml = `<span style="font-size:10px;color:var(--accent);font-weight:bold;">(本師)</span>`;
        } else {
          badgeHtml = `<span style="font-size:10px;color:var(--ink-3);">(原:${esc(curTeaName)})</span>`;
        }
      } else {
        isUnassigned = true;
        badgeHtml = `<span style="font-size:10px;color:var(--warning-dark);font-weight:bold;">(⚠️未配)</span>`;
      }
    }

    let isChecked = false;
    if (options.autoCheckMode === 'MINE') {
      isChecked = isMine;
    } else if (options.autoCheckMode === 'ADMIN') {
      const teacherObj = tc ? idx.teacherByCode[tc] : null;
      isChecked = isTeacherAdmin(teacherObj);
    } else if (options.autoCheckMode === 'MINE_AND_UNASSIGNED') {
      isChecked = isMine || isUnassigned;
    } else if (options.autoCheckMode === 'UNASSIGNED') {
      isChecked = isUnassigned;
    } else if (options.autoCheckMode === 'ALL') {
      isChecked = true;
    } else if (options.autoCheckMode === 'NONE') {
      isChecked = false;
    } else {
      isChecked = previousChecked.has(clsCode);
    }

    html += `<label style="display:flex;align-items:center;gap:3px;cursor:pointer;padding:2px 4px;border-radius:4px;background:var(--surface-1);border:1px solid var(--border);" title="${esc(clsName)}">
      <input type="checkbox" class="batch-tea-cls-cb" value="${esc(clsCode)}" data-grade="${esc(clsGrade)}" data-is-mine="${isMine}" data-is-unassigned="${isUnassigned}" ${isChecked ? 'checked' : ''} onchange="renderBatchPreview()">
      <span style="font-weight:600;">${esc(clsCode)}</span>
    </label>`;
  });

  boxesContainer.innerHTML = html;
  renderBatchPreview();
}

function updateBatchSubjectClasses() {
  const sc = document.getElementById('batch-subject-select')?.value;
  if (!sc) {
    document.querySelectorAll('#batch-sub-cls-boxes .batch-sub-cls-cb').forEach(cb => cb.checked = false);
    renderBatchPreview();
    return;
  }

  const subj = idx.subjectByCode[sc];
  const targetGrade = String(subj?.['適用年級'] || '').trim();

  document.querySelectorAll('#batch-sub-cls-boxes .batch-sub-cls-cb').forEach(cb => {
    const clsGrade = String(cb.dataset.grade || '');
    let isAutoCheck = false;
    if (targetGrade === '全校' || !targetGrade) {
      isAutoCheck = true;
    } else if (targetGrade) {
      const gList = targetGrade.split(',').map(g=>g.trim()).filter(Boolean);
      isAutoCheck = gList.includes(clsGrade);
    }
    cb.checked = isAutoCheck;
  });

  renderBatchPreview();
}

function toggleBatchSubClasses(target) {
  document.querySelectorAll('#batch-sub-cls-boxes .batch-sub-cls-cb').forEach(cb => {
    const g = cb.dataset.grade;
    if (target === 'ALL') cb.checked = true;
    else if (target === 'NONE') cb.checked = false;
    else cb.checked = (g === target);
  });
  renderBatchPreview();
}

function toggleBatchSelectAll(check) {
   document.querySelectorAll('#batch-preview .batch-row-cb').forEach(cb => {
     cb.checked = check;
   });
   updateBatchSubmitCount();
}

if (typeof window !== 'undefined') window.updateBatchSubmitCount = updateBatchSubmitCount;
function updateBatchSubmitCount() {
  const checkedCount = document.querySelectorAll('#batch-preview .batch-row-cb:checked').length;
  const countInfo = document.getElementById('batch-count-info');
  if (countInfo) countInfo.textContent = `已勾選 ${checkedCount} 筆`;
  const submitBtn = document.getElementById('batch-submit-btn');
  if (submitBtn) submitBtn.disabled = checkedCount === 0;
}

function renderBatchPreview() {
   if (typeof window !== 'undefined') window.renderBatchPreview = renderBatchPreview;
   const modeSelect = document.getElementById('batch-mode');
   const mode = modeSelect ? modeSelect.value : 'class-matrix';
   const preview = document.getElementById('batch-preview');
   if (!preview) return;

   // 防護版
   const safeClasses = state && state.classes ? state.classes : [];
   const safeSubjects = state && state.subjects ? state.subjects : [];
   const rows = [];

  if (mode === 'class-matrix') {
    // 🏫 1. 按 班級/年級 配課
    const targetVal = document.getElementById('batch-class-target')?.value;
    const filterVal = document.getElementById('batch-class-sub-filter')?.value || 'CORE';
    if (!targetVal) {
      preview.innerHTML = '<div style="padding:24px;text-align:center;color:var(--ink-3);">請先在上選單選擇欲配課的目標班級或年級…</div>';
      updateBatchSubmitCount();
      return;
    }

    let targetClasses = [];
    if (targetVal.startsWith('GRADE_')) {
      const g = targetVal.replace('GRADE_', '');
      targetClasses = state.classes.filter(c => String(c['年級']) === g);
    } else {
      const cls = idx.classByCode[targetVal];
      if (cls) targetClasses = [cls];
    }

       targetClasses.forEach(cls => {
       const clsCode = cls['班級代碼'];
       const clsGrade = String(cls['年級'] || '');
       const isVirtual = cls['是否虛擬班'] === 'TRUE';

       safeSubjects.forEach(subj => {
        const subCode = String(subj['科目代碼']);
        const targetGrade = String(subj['適用年級'] || '').trim();
        const appClasses = String(subj['適用班級'] || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);

        // 判斷是否適用於該班
        let isApplicable = false;
        if (appClasses.length > 0) {
          isApplicable = appClasses.includes(clsCode);
        } else if (isVirtual) {
          const isAssigned = getBatchExistingAssignments(clsCode, subCode).length > 0;
          isApplicable = isAssigned;
        } else if (!targetGrade || targetGrade === '全校') {
          isApplicable = true;
        } else {
          const gList = targetGrade.split(/[,，]/).map(g=>g.trim()).filter(Boolean);
          isApplicable = gList.includes(clsGrade);
        }

        if (isApplicable) {
           const defaultWeekly = getSubjectWeeklyValue(subj, 1);
          rows.push(makeBatchPreviewRow({
            classCode: clsCode,
            className: cls['班級名稱'] || clsCode,
            grade: clsGrade,
            subjectCode: subCode,
            defaultWeekly
          }));
        }
      });
    });

  } else if (mode === 'subject-matrix') {
    // 📚 2. 按 科目 配課 (讀取細部勾選的班級)
    const subCode = document.getElementById('batch-subject-select')?.value;
    const selectedClasses = Array.from(document.querySelectorAll('#batch-sub-cls-boxes .batch-sub-cls-cb:checked')).map(cb => cb.value);

    if (!subCode || selectedClasses.length === 0) {
      preview.innerHTML = '<div style="padding:24px;text-align:center;color:var(--ink-3);">請先選擇配課科目並勾選要開課的班級…</div>';
      updateBatchSubmitCount();
      return;
    }

    const subj = idx.subjectByCode[subCode];
     const defaultWeekly = getSubjectWeeklyValue(subj, 1);

    selectedClasses.forEach(clsCode => {
      const cls = idx.classByCode[clsCode];
      const clsGrade = String(cls?.['年級'] || '');
      rows.push(makeBatchPreviewRow({
        classCode: clsCode,
        className: cls?.['班級名稱'] || clsCode,
        grade: clsGrade,
        subjectCode: subCode,
        defaultWeekly
      }));
    });

  } else {
    // 👩‍🏫 3. 按 教師 配課
    const tc = parseTeacherCode(document.getElementById('batch-teacher-select')?.value);
    const subCode = document.getElementById('batch-teacher-subject-select')?.value;
    const checkedClasses = Array.from(document.querySelectorAll('#batch-teacher-cls-boxes .batch-tea-cls-cb:checked')).map(cb => cb.value);

    if (!tc || !subCode) {
      preview.innerHTML = '<div style="padding:24px;text-align:center;color:var(--ink-3);">請先選擇教師與科目…</div>';
      updateBatchSubmitCount();
      return;
    }

    const subj = idx.subjectByCode[subCode];
     const defaultWeekly = getSubjectWeeklyValue(subj, 1);

    // 預覽＝該科目前配課狀況：列出該科所有現有配課（各班現任教師），該師配的課打勾
    const byClass = {};
    (state.assignments || []).forEach(a => {
      if (String(a['科目代碼']) === String(subCode)) {
        const code = String(a['班級代碼'] || '');
        if (code) (byClass[code] = byClass[code] || []).push(a);
      }
    });
    const pushRow = (clsCode, teacherCode, preselect) => {
      const cls = idx.classByCode[clsCode];
      rows.push({ ...makeBatchPreviewRow({
        classCode: clsCode,
        className: cls?.['班級名稱'] || clsCode,
        grade: String(cls?.['年級'] || ''),
        subjectCode: subCode,
        teacherCode,
        defaultWeekly
      }), preselect });
    };
    Object.entries(byClass).forEach(([clsCode, list]) => {
      const currentAssignment = list[0];
      const curTc = getCellTeacherCodes(currentAssignment)[0] || '';
      pushRow(clsCode, curTc, isBatchTeacherMatch(currentAssignment, tc));
    });
    // 使用者另外勾選的班級 → 指定給該師（該科已有配課者改該列；無配課者新增）
    checkedClasses.forEach(clsCode => {
      const existingIdx = rows.findIndex(r => String(r.classCode) === String(clsCode));
      if (existingIdx >= 0) {
        rows[existingIdx].teacherCode = tc;
        rows[existingIdx].preselect = true;
      } else {
        pushRow(clsCode, tc, true);
      }
    });
  }

  if (rows.length === 0) {
    preview.innerHTML = '<div style="padding:24px;text-align:center;color:var(--ink-3);">無符合條件的配課項目…</div>';
    updateBatchSubmitCount();
    return;
  }

  let html = '<table style="width:100%;font-size:12px;border-collapse:collapse;" class="data-table"><thead><tr style="background:var(--surface-2);"><th style="width:36px;text-align:center;">選擇</th><th>班級</th><th>科目</th><th>教師與語言／標籤</th><th style="width:90px;">更新後每週節數</th><th>備註</th><th>狀態</th></tr></thead><tbody>';
  rows.forEach((r, rowIndex) => {
    const rowId = `batch-row-${rowIndex}`;
    const t = r.teacherCode ? idx.teacherByCode[r.teacherCode] : null;
    const teacherStr = r.teacherCode ? (t ? (t['教師姓名'] || t['姓名'] || r.teacherCode) : r.teacherCode) : '';
    const coTeacherStr = formatBatchTeacherValue(r.coTeacherCode);

    html += `<tr>
      <td style="text-align:center;"><input type="checkbox" class="batch-row-cb" id="${rowId}" data-index="${rowIndex}" ${r.preselect === false ? '' : 'checked'} onchange="updateBatchSubmitCount()"></td>
      <td><strong>${esc(r.className)}</strong></td>
      <td><span class="cell-chip" style="font-size:11px;">${esc(r.subjectCode)}</span></td>
      <td>
        <input class="batch-teacher-input" data-index="${rowIndex}" data-grade="${esc(r.grade)}" value="${esc(teacherStr)}" placeholder="主教師" style="width:100%;max-width:200px;">
        <input class="batch-teacher-tag-input" data-index="${rowIndex}" value="${esc(String(r.teacherTag || ''))}" placeholder="主教師語言／標籤（選填）" style="width:100%;max-width:200px;margin-top:4px;">
        <input class="batch-co-teacher-input" data-index="${rowIndex}" value="${esc(coTeacherStr)}" placeholder="協同教師，可多位用、分隔" title="第一位是主教師；協同教師可用、分隔多位" style="width:100%;max-width:240px;margin-top:4px;">
        <input class="batch-co-teacher-tag-input" data-index="${rowIndex}" value="${esc(String(r.coTeacherTags || ''))}" placeholder="協同語言／標籤，依序用、分隔" title="多位協同教師時，標籤依教師順序以、分隔；留白表示不顯示於班級 Word" style="width:100%;max-width:240px;margin-top:4px;">
      </td>
      <td><input type="number" class="batch-hours-input" data-index="${rowIndex}" value="${esc(String(r.weeklyHours||''))}" placeholder="預設 ${r.defaultWeekly}" min="0.5" max="20" step="0.5" style="width:72px;padding:2px 4px;font-size:12px;border:1px solid var(--border);border-radius:4px;"></td>
      <td><input class="batch-note-input" data-index="${rowIndex}" value="${esc(String(r.note||''))}" placeholder="備註（可清空）" style="width:100%;min-width:120px;padding:2px 4px;font-size:12px;border:1px solid var(--border);border-radius:4px;"></td>
      <td>${r.isExisting ? `<span class="badge badge-blue" title="既有 ${esc(String(r.existingTeachers.join('、') || '未指定教師'))}，儲存時會直接替換節數與備註">既有 ${r.existingWeekly} 節，直接替換</span>` : '<span class="badge badge-green">新增配課</span>'}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  preview.innerHTML = html;
  preview._batchRows = rows;

   preview.querySelectorAll('.batch-teacher-input, .batch-co-teacher-input').forEach(inp => {
     initTeacherCombobox(inp);
   });
   updateBatchSubmitCount();
}

if (typeof window !== 'undefined') window.makeBatchPreviewRow = makeBatchPreviewRow;
if (typeof window !== 'undefined') window.updateBatchSubmitCount = updateBatchSubmitCount;
async function executeBatchAssign() {
  const preview = document.getElementById('batch-preview');
  const rows = preview?._batchRows;
  if (!rows || rows.length === 0) { toast('無可建立的項目', 'warning'); return; }

  const checkedRows = [];
  const inputErrors = [];
  document.querySelectorAll('#batch-preview .batch-row-cb:checked').forEach(cb => {
    const rowIndex = parseInt(cb.dataset.index, 10);
    const row = rows[rowIndex];
    if (row) {
      const hoursInput = document.querySelector('#batch-preview .batch-hours-input[data-index="' + rowIndex + '"]') ||
        document.querySelector('#batch-preview .batch-hours-select[data-index="' + rowIndex + '"]');
      const teacherInput = document.querySelector('#batch-preview .batch-teacher-input[data-index="' + rowIndex + '"]') ||
        document.querySelector('#batch-preview .batch-teacher-select[data-index="' + rowIndex + '"]');
      const teacherTagInput = document.querySelector('#batch-preview .batch-teacher-tag-input[data-index="' + rowIndex + '"]');
      const coTeacherInput = document.querySelector('#batch-preview .batch-co-teacher-input[data-index="' + rowIndex + '"]');
      const coTeacherTagInput = document.querySelector('#batch-preview .batch-co-teacher-tag-input[data-index="' + rowIndex + '"]');
      const noteInput = document.querySelector('#batch-preview .batch-note-input[data-index="' + rowIndex + '"]');
      const primary = parseBatchTeacherCodes(teacherInput ? teacherInput.value : row.teacherCode);
      const coTeachers = parseBatchTeacherCodes(coTeacherInput ? coTeacherInput.value : row.coTeacherCode);
      const invalid = [...primary.invalid, ...coTeachers.invalid];
      if (invalid.length > 0) {
        inputErrors.push('第' + (rowIndex + 1) + '列教師無法辨識：' + invalid.join('、'));
        return;
      }
      const combinedCodes = [...new Set([...primary.codes, ...coTeachers.codes])];
      checkedRows.push({
        ...row,
        teacherCode: combinedCodes[0] || '',
        coTeacherCode: combinedCodes.slice(1).join('、'),
        teacherTag: teacherTagInput ? teacherTagInput.value.trim() : String(row.teacherTag || ''),
        coTeacherTags: coTeacherTagInput ? coTeacherTagInput.value.trim() : String(row.coTeacherTags || ''),
         weeklyHours: hoursInput ? hoursInput.value.trim() : String(row.weeklyHours || ''),
         note: noteInput ? noteInput.value.trim() : ''
       });
       if (!isValidWeeklyInput(checkedRows[checkedRows.length - 1].weeklyHours)) {
         inputErrors.push('第' + (rowIndex + 1) + '列每週節數請留白、填 0.5，或填 1 至 20 的整數');
         checkedRows.pop();
       }
    }
  });

  if (inputErrors.length > 0) { toast(inputErrors.join('；'), 'warning'); return; }
  if (checkedRows.length === 0) { toast('請至少勾選一筆配課項目', 'warning'); return; }

  let updated = 0, added = 0;
  const payloads = [];

  checkedRows.forEach((row, offsetIndex) => {
    const payload = buildBatchAssignmentPayload(row, offsetIndex);
    const data = payload.data;

    if (payload.updated) {
      updated++;
      const targetInState = state.assignments.find(a => String(a['配課ID']) === String(data['配課ID']));
      if (targetInState) {
        Object.assign(targetInState, data);
      } else {
        state.assignments.push(data);
      }
    } else {
      added++;
      state.assignments.push(data);
    }
    payloads.push(data);
  });
  // 1. 樂觀更新前端記憶體索引與介面 (0 毫秒極速感)
  if (typeof buildIndex === 'function') buildIndex();
  if (typeof renderConfigTab === 'function') renderConfigTab();
  if (typeof renderClassAssignmentView === 'function') renderClassAssignmentView();
  if (typeof renderTeacherAssignmentView === 'function') renderTeacherAssignmentView();
  if (typeof updateBatchTeacherClasses === 'function') updateBatchTeacherClasses();
  if (typeof updateBatchSubjectClasses === 'function') updateBatchSubjectClasses();
  if (typeof renderBatchPreview === 'function') renderBatchPreview();
  if (typeof renderAllViews === 'function') renderAllViews();

  // 2. 立即回應提示，完全不上鎖、不上遮罩
  toast(`⚡ 已於本地完成 ${payloads.length} 筆配課（更新 ${updated} 筆，新增 ${added} 筆），背景同步中…`, 'success');

  // 3. 背景非同步同步至 GAS 後端
  (async () => {
    let okCount = 0, failCount = 0;
    for (const data of payloads) {
      try {
        const result = await gasPost('saveMeta', { type: '配課', data });
        if (result && result.ok) {
          okCount++;
        } else {
          failCount++;
        }
      } catch (err) {
        failCount++;
      }
    }
    if (failCount > 0) {
      toast(`⚠️ 背景同步完成：${okCount} 筆成功，${failCount} 筆失敗，請檢查網路`, 'warning');
    }
  })();
}
if (typeof window !== 'undefined') window.submitBatchAssign = executeBatchAssign;
// ===== 教師不排課：集中時段陣列（僅限新版資料） =====
function getTeacherBlockSlots(block) {
  return String(block['時段'] || '').split(',').map(value => {
    const [day, period] = value.trim().split('-').map(Number);
    return {day, period};
  }).filter(slot => slot.day >= 1 && slot.day <= 5 && slot.period >= 1 && slot.period <= 8);
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
  gasPost('saveTeacherBlock', {teacherCodes:[teacherCode], pairs:day+'-'+period, reason:'課表點擊標記不排課', clear}, { silent: true })
    .then(res => {
      if (!res || !res.ok) {
        toast('不排課設定雲端同步失敗，請重新載入確認', 'warning');
        return;
      }
      return loadAll({ background: true });
    })
    .catch(err => {
      console.error('Background save block error:', err);
      toast('不排課設定背景同步異常', 'warning');
    });
}

function renderBlockSlotGrid() {
  const wrap = document.getElementById('block-slot-grid');
  let html = '<table><thead><tr><th>節次</th>';
  DAYS.forEach((name, index) => { const day=index+1; html += '<th class="th-day" data-day="'+day+'" onclick="toggleBlockDaySlots('+day+')" style="cursor:pointer;">'+name+'</th>'; });
  html += '</tr></thead><tbody>';
  DISPLAY_PERIODS.forEach(period => {
    html += '<tr><th class="th-per" data-per="'+period+'" onclick="toggleBlockPeriodSlots('+period+')" style="cursor:pointer;">'+periodLabel(period)+'</th>';
    for (let day=1; day<=5; day++) {
      const selected = ui.blockSlots.has(day+'|'+period);
      const hasBlock = state.teacherBlocks.some(block => getTeacherBlockSlots(block).some(slot => slot.day===day && slot.period===period));
      html += '<td><button class="slot-btn '+(selected?'sel':'')+(hasBlock&&!selected?' has-block':'')+'" data-day="'+day+'" data-per="'+period+'" onclick="toggleBlockSlot('+day+','+period+')"></button></td>';
    }
    html += '</tr>';
  });
  wrap.innerHTML = html+'</tbody></table>';
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
    gasTask: async () => {
      if (editingId) {
        await gasPost('deleteMeta', {type:'不排課', key:editingId});
      }
      return gasPost('saveTeacherBlock', {teacherCodes, pairs, reason, clear});
    }
  });
}

function renderBlockTable() {
  const tbody = document.getElementById('block-tbody'); tbody.innerHTML = '';
  const teacherOrder = new Map(state.teachers.map((teacher, index) => [String(teacher['教師姓名'] || ''), index]));
  const rows = state.teacherBlocks.map((block, index) => ({ block, index })).sort((a, b) => {
    const aCode = String(a.block['教師姓名'] || ''), bCode = String(b.block['教師姓名'] || '');
    const aOrder = teacherOrder.has(aCode) ? teacherOrder.get(aCode) : Number.MAX_SAFE_INTEGER;
    const bOrder = teacherOrder.has(bCode) ? teacherOrder.get(bCode) : Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder || a.index - b.index;
  });
  rows.forEach(({block}) => {
    const teacherCode = String(block['教師姓名'] || ''), teacher = idx.teacherByCode[teacherCode];
    const slotList = getTeacherBlockSlots(block);
    const slots = compressSlots(slotList).join('、') || '—';
    const teacherName = teacher ? (teacher['教師姓名'] || teacher['姓名']) : (block['教師姓名'] || '未指定');
    tbody.innerHTML += '<tr id="'+esc(teacherBlockRowId(teacherCode))+'" class="teacher-block-row"><td><button type="button" class="block-teacher-link" data-teacher-code="'+esc(teacherCode)+'">'+esc(teacherName)+'</button></td><td class="block-slot-summary" title="'+esc(slots)+'">'+esc(slots)+'</td><td>'+esc(block['原因'] || '')+'</td><td>'+actionButtons('editTeacherBlock','deleteTeacherBlock',block['記錄ID'])+'</td></tr>';
  });
  tbody.querySelectorAll('.block-teacher-link').forEach(link => {
    link.addEventListener('click', () => focusTeacherBlockPicker(link.dataset.teacherCode || ''));
  });
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
    gasTask: async () => {
      if (editingId) {
        await gasPost('deleteMeta', {type:'科目規則', key:editingId});
      }
      return gasPost('saveSubjectRule', {
        subjectCode,
        subjectCodes,
        classCode,
        classCodes,
        grade,
        type,
        pairs,
        clear
      });
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

const __renderBlockSlotGridSummary = renderBlockSlotGrid;
renderBlockSlotGrid = function() { __renderBlockSlotGridSummary(); renderBlockSelectionSummary(); };
const __renderRuleSlotGridSummary = renderRuleSlotGrid;
renderRuleSlotGrid = function() { __renderRuleSlotGridSummary(); renderRuleSelectionSummary(); };
const __blockSelectGroupSummary = blockSelectGroup;
blockSelectGroup = function(group) { __blockSelectGroupSummary(group); renderBlockSelectionSummary(); };
const __blockSelectSubjectSummary = blockSelectSubject;
blockSelectSubject = function(subject) { __blockSelectSubjectSummary(subject); renderBlockSelectionSummary(); };
document.addEventListener('change', event => {
  if (event.target.matches('#block-teachers input[type=checkbox]')) renderBlockSelectionSummary();
  if (event.target.matches('#rule-subject-checks input[type=checkbox], #rule-class-checks input[type=checkbox], #rule-grade, #rule-type')) renderRuleSelectionSummary();
});

// 教師設定：列內編輯，避免跳回頁首。
function teacherHomeroomLabel(teacher) {
  const homeroom = getTeacherHomeroom(teacher);
  if (!homeroom || homeroom === 'TRUE') return '—';
  const cls = idx.classByCode[String(homeroom)];
  return cls ? homeroom+' '+(cls['班級名稱'] || '') : String(homeroom);
}

function renderTeacherConfigList() {
  const tbody = document.getElementById('teacher-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  state.teachers.forEach(teacher => {
    const code = String(teacher['教師姓名']);
    const isEditing = ui.inlineTeacherCode === code;
    const row = document.createElement('tr');
    if (isEditing) {
      row.className = 'inline-edit-row';
      row.innerHTML = '<td><b>'+esc(code)+'</b></td>'+
        '<td><input data-inline-field="name" value="'+esc((teacher['教師姓名'] || teacher['姓名']) || '')+'" onkeydown="handleInlineTeacherKey(event, '+JSON.stringify(code)+')"></td>'+
        '<td><input data-inline-field="email" value="'+esc(teacher['Email'] || '')+'" onkeydown="handleInlineTeacherKey(event, '+JSON.stringify(code)+')"></td>'+
        '<td><select data-inline-field="homeroom" onkeydown="handleInlineTeacherKey(event, '+JSON.stringify(code)+')">'+teacherHomeroomOptions(getTeacherHomeroom(teacher))+'</select></td>'+
        '<td><input data-inline-field="hours" type="number" min="0" value="'+esc(String(teacher['基本鐘點'] || ''))+'" onkeydown="handleInlineTeacherKey(event, '+JSON.stringify(code)+')"></td>'+
        '<td><input data-inline-field="subject" value="'+esc(teacher['任教科目'] || '')+'" onkeydown="handleInlineTeacherKey(event, '+JSON.stringify(code)+')"></td>'+
        '<td class="inline-actions"><button class="btn btn-primary btn-xs" onclick="saveInlineTeacher('+JSON.stringify(code)+')">儲存</button> <button class="btn btn-ghost btn-xs" onclick="cancelInlineTeacherEdit()">取消</button></td>';
    } else {
    }
    tbody.appendChild(row);
  });
}

function teacherHomeroomOptions(selected) {
  const value = selected === 'TRUE' ? '' : String(selected || '');
  return '<option value="">— 非導師 —</option>'+state.classes.map(cls => {
    const code = String(cls['班級代碼']);
    return '<option value="'+esc(code)+'"'+(code === value ? ' selected' : '')+'>'+esc(code+' '+(cls['班級名稱'] || ''))+'</option>';
  }).join('');
}

async function saveTeacher() {
  const name = document.getElementById('tea-name').value.trim();
  if (!name) { toast('教師姓名不能空白', 'warning'); return; }
  const code = name;
  const title = document.getElementById('tea-title').value.trim();
  // 職稱欄出現「導師」即為導師；導師班級直接依職稱中的班級代碼判定。
  const newObj = {
    '教師姓名': name, 'Email': document.getElementById('tea-email').value.trim(),
    '任教科目':teacherFormSubjects(), '職稱': title,
    '最大連堂節數':document.getElementById('tea-max-consec').value, '基本鐘點':document.getElementById('tea-hours').value,
    '減授原因':document.getElementById('tea-release-reason').value.trim()
  };

  bgSync({
    actionName: '儲存教師資料',
    applyLocal: () => {
      const idxObj = state.teachers.findIndex(t => String(t['教師姓名']) === String(code));
      if (idxObj >= 0) state.teachers[idxObj] = newObj;
      else state.teachers.push(newObj);
      clearTeacherForm();
    },
    gasTask: () => gasPost('saveMeta', { type:'教師', data: newObj })
  });
}

async function deleteTeacher(code) {
  const confirmed = await showModal('確認刪除', '確定刪除教師 '+code+' ？', 'confirm');
  if (!confirmed) return;

  bgSync({
    actionName: '刪除教師',
    applyLocal: () => {
      state.teachers = state.teachers.filter(t => String(t['教師姓名']) !== String(code));
    },
    gasTask: () => gasPost('deleteMeta', { type:'教師', key:code })
  });
}
function clearTeacherForm() {
  ['tea-code','tea-name','tea-email'].forEach(id => { const input = document.getElementById(id); if (input) input.value = ''; });
  const teaTitle = document.getElementById('tea-title'); if (teaTitle) teaTitle.value = '';
  const releaseReason = document.getElementById('tea-release-reason'); if (releaseReason) releaseReason.value = '';
  document.getElementById('tea-hours').value = '16'; document.getElementById('tea-max-consec').value = '3';
  document.querySelectorAll('#tea-subject-boxes input').forEach(input => { input.checked = false; });
}
const __renderConfigTabTeacherForm = renderConfigTab;
renderConfigTab = function() { __renderConfigTabTeacherForm(); renderTeacherSubjectBoxes(); };
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
    if (hasBlock) name.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      focusTeacherBlockRow(code);
    });
    label.appendChild(checkbox); label.appendChild(name);
    if (tagText) { const tag = document.createElement('span'); tag.className = 'teacher-pick-tag'; tag.textContent = tagText; label.appendChild(tag); }
    wrap.appendChild(label);
  });
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
const __setTeacherBlockEditModeNotice = setTeacherBlockEditMode;
setTeacherBlockEditMode = function(editing) { __setTeacherBlockEditModeNotice(editing); renderTeacherBlockEditingNotice(); };
function renderSubjectConfigList() {
  const tbody = document.getElementById('subject-tbody'); if (!tbody) return; tbody.innerHTML = '';
  state.subjects.forEach(s => {
    const code = String(s['科目代碼'] || '');
    const arg = "decodeURIComponent('" + encodeURIComponent(code) + "')";
    const edit = ui.inlineSubjectCode === code;
    const row = document.createElement('tr');
    if (edit) {
      const currentRoom = String(s['所屬教室代碼'] || '');
      let roomOpts = '<option value="">— 無 —</option>';
      state.rooms.forEach(r => {
        const rc = String(r['教室代碼'] || '');
        const rn = r['教室名稱'] || '';
        const sel = currentRoom === rc ? ' selected' : '';
        roomOpts += '<option value="' + esc(rc) + '"' + sel + '>' + esc(rc) + (rn ? ' ' + esc(rn) : '') + '</option>';
      });
      row.className = 'inline-edit-row';
      row.innerHTML =
        '<td><b>' + esc(code) + '</b></td>' +
        '<td><input data-sub="weekly" type="number" value="' + esc(String(s['每週節數']||'')) + '" onkeydown="handleInlineSubjectKey(event,' + arg + ')"></td>' +
        '<td><input data-sub="max" type="number" value="' + esc(String(s['同時最多班數']||'0')) + '" onkeydown="handleInlineSubjectKey(event,' + arg + ')"></td>' +
        '<td><input data-sub="days" type="number" value="' + esc(String(s['最多連日']||'')) + '" onkeydown="handleInlineSubjectKey(event,' + arg + ')"></td>' +
        '<td><input data-sub="grade" value="' + esc(s['適用年級']||'') + '" onkeydown="handleInlineSubjectKey(event,' + arg + ')"></td>' +
        '<td><input data-sub="classes" value="' + esc(s['適用班級']||'') + '" onkeydown="handleInlineSubjectKey(event,' + arg + ')"></td>' +
        '<td><select data-sub="room" style="width:100%;font-size:12px;">' + roomOpts + '</select></td>' +
        '<td class="inline-actions"><button class="btn btn-primary btn-xs" onclick="saveInlineSubject(' + arg + ')">儲存</button> <button class="btn btn-ghost btn-xs" onclick="cancelInlineSubjectEdit()">取消</button></td>';
    } else {
      const c = getSubjectColor(code);
      const roomCode = String(s['所屬教室代碼'] || '');
      const roomObj = idx.roomByCode ? idx.roomByCode[roomCode] : null;
      const roomName = roomObj ? (roomObj['教室名稱'] || '') : '';
      const roomLabel = roomCode ? (roomCode + (roomName ? ' ' + roomName : '')) : '';
      row.innerHTML =
        '<td><span class="cell-chip" style="background:' + c.bg + ';color:' + c.text + ';">' + esc(code) + '</span></td>' +
        '<td>' + esc(String(s['每週節數']||'')) + '</td>' +
        '<td>' + esc(String(s['同時最多班數']||'0')) + '</td>' +
        '<td>' + esc(String(s['最多連日']||'')) + '</td>' +
        '<td>' + esc(s['適用年級']||'全校') + '</td>' +
        '<td>' + esc(s['適用班級']||'—') + '</td>' +
        '<td>' + (roomLabel ? '<span class="badge badge-blue" title="專科教室">🏫 ' + esc(roomLabel) + '</span>' : '<span style="color:var(--text-muted)">—</span>') + '</td>' +
        '<td class="inline-actions"><button class="btn btn-ghost btn-xs" onclick="startInlineSubjectEdit(' + arg + ')">✏️ 編輯</button> <button class="btn btn-danger btn-xs" onclick="deleteSubject(' + arg + ')">🗑 刪除</button></td>';
    }
    tbody.appendChild(row);
  });
}
// 綁班群組：緊湊選取卡與可靠儲存。
function renderBindGroupTab() {
  const render = (id, values, codeOf) => { const wrap=document.getElementById(id); if(!wrap)return; const kept=new Set(Array.from(wrap.querySelectorAll('input:checked')).map(x=>x.value)); wrap.innerHTML=''; values.forEach(item=>{const code=String(codeOf(item)); const label=document.createElement('label'); label.className='bind-choice'; const cb=document.createElement('input'); cb.type='checkbox'; cb.value=code; cb.checked=kept.has(code); const txt=document.createElement('span'); txt.textContent=code; label.append(cb,txt); wrap.appendChild(label);}); };
  render('bind-subjects',state.subjects,item=>item['科目代碼']); render('bind-classes',state.classes,item=>item['班級代碼']); renderBindGroupTable();
}
// ============================================================
// 教師互斥規則 UI
// ============================================================

async function addExclusiveRule() {
  const tA = document.getElementById('exclusive-val-a')?.value.trim() ||
    (document.getElementById('exclusive-teacher-a')?.value.trim() || '').split(' ')[0];
  const tB = document.getElementById('exclusive-val-b')?.value.trim() ||
    (document.getElementById('exclusive-teacher-b')?.value.trim() || '').split(' ')[0];
  const remark = document.getElementById('exclusive-remark')?.value.trim() || '';

  if (!tA || !tB) { toast('請選擇教師 A 與教師 B', 'warning'); return; }
  if (tA === tB) { toast('不能選擇同一位教師', 'warning'); return; }

  // 前端查重
  const existing = (state.teacherExclusives || []).find(r =>
    (String(r['教師A']) === tA && String(r['教師B']) === tB) ||
    (String(r['教師A']) === tB && String(r['教師B']) === tA)
  );
  if (existing) { toast('此組合的互斥規則已存在', 'warning'); return; }

  const newRule = { '規則ID': 'EX' + Date.now(), '教師A': tA, '教師B': tB, '備註': remark };

  bgSync({
    actionName: '新增教師互斥規則',
    applyLocal: () => {
      if (!state.teacherExclusives) state.teacherExclusives = [];
      state.teacherExclusives.push(newRule);
      // 清空輸入
      ['a', 'b'].forEach(s => {
        const inp = document.getElementById('exclusive-teacher-' + s);
        const hid = document.getElementById('exclusive-val-' + s);
        if (inp) inp.value = '';
        if (hid) hid.value = '';
      });
      const rem = document.getElementById('exclusive-remark');
      if (rem) rem.value = '';
      _exclusiveSelA = ''; _exclusiveSelB = '';
      renderExclusiveTable();
    },
    gasTask: () => gasPost('saveTeacherExclusive', { teacherA: tA, teacherB: tB, remark })
  });
}

async function deleteExclusiveRule(id) {
  const rule = (state.teacherExclusives || []).find(r => String(r['規則ID']) === String(id));
  if (!rule) return;
  const teacherLabel = code => {
    const key = String(code || '').trim();
    const teacher = idx.teacherByCode?.[key];
    return teacher ? formatTeacherCodeName(key, teacher) : key;
  };
  const tA = teacherLabel(rule['教師A']);
  const tB = teacherLabel(rule['教師B']);
  const confirmed = await showModal('確認刪除', '確定刪除【' + tA + '】與【' + tB + '】的互斥規則？', 'confirm');
  if (!confirmed) return;

  bgSync({
    actionName: '刪除教師互斥規則',
    applyLocal: () => {
      state.teacherExclusives = (state.teacherExclusives || []).filter(r => String(r['規則ID']) !== String(id));
      renderExclusiveTable();
    },
    gasTask: () => gasPost('saveTeacherExclusive', { delete: true, id })
  });
}

// 全域操作按鈕函數 100% 強固掛載 (Expose all event handlers to window scope)
if (typeof window !== 'undefined') {
  if (typeof editExclusiveRule === 'function') window.editExclusiveRule = editExclusiveRule;
  if (typeof deleteExclusiveRule === 'function') window.deleteExclusiveRule = deleteExclusiveRule;
  if (typeof cancelExclusiveRuleEdit === 'function') window.cancelExclusiveRuleEdit = cancelExclusiveRuleEdit;
  if (typeof addExclusiveRule === 'function') window.addExclusiveRule = addExclusiveRule;

   if (typeof startInlineTeacherEdit === 'function') window.startInlineTeacherEdit = startInlineTeacherEdit;
   if (typeof cancelInlineTeacherEdit === 'function') window.cancelInlineTeacherEdit = cancelInlineTeacherEdit;
   if (typeof saveInlineTeacher === 'function') window.saveInlineTeacher = saveInlineTeacher;
   if (typeof handleInlineTeacherKey === 'function') window.handleInlineTeacherKey = handleInlineTeacherKey;
   if (typeof deleteTeacher === 'function') window.deleteTeacher = deleteTeacher;
   if (typeof deleteClass === 'function') window.deleteClass = deleteClass;

  if (typeof startInlineSubjectEdit === 'function') window.startInlineSubjectEdit = startInlineSubjectEdit;
  if (typeof cancelInlineSubjectEdit === 'function') window.cancelInlineSubjectEdit = cancelInlineSubjectEdit;
   if (typeof saveInlineSubject === 'function') window.saveInlineSubject = saveInlineSubject;
   if (typeof handleInlineSubjectKey === 'function') window.handleInlineSubjectKey = handleInlineSubjectKey;
   if (typeof deleteSubject === 'function') window.deleteSubject = deleteSubject;

  if (typeof editSubjectRule === 'function') window.editSubjectRule = editSubjectRule;
  if (typeof deleteSubjectRule === 'function') window.deleteSubjectRule = deleteSubjectRule;
  if (typeof editSubjectRelation === 'function') window.editSubjectRelation = editSubjectRelation;
  if (typeof deleteSubjectRelation === 'function') window.deleteSubjectRelation = deleteSubjectRelation;
  if (typeof saveSubjectRelation === 'function') window.saveSubjectRelation = saveSubjectRelation;
  if (typeof cancelSubjectRelationEdit === 'function') window.cancelSubjectRelationEdit = cancelSubjectRelationEdit;

  if (typeof editTeacherBlock === 'function') window.editTeacherBlock = editTeacherBlock;
  if (typeof deleteTeacherBlock === 'function') window.deleteTeacherBlock = deleteTeacherBlock;

  if (typeof renderBatchPicker === 'function') window.renderBatchPicker = renderBatchPicker;
  if (typeof renderBatchPreview === 'function') window.renderBatchPreview = renderBatchPreview;
  if (typeof executeBatchAssign === 'function') window.executeBatchAssign = executeBatchAssign;
  if (typeof toggleBatchSelectAll === 'function') window.toggleBatchSelectAll = toggleBatchSelectAll;

  if (typeof saveBindGroup === 'function') window.saveBindGroup = saveBindGroup;
  if (typeof deleteBindGroup === 'function') window.deleteBindGroup = deleteBindGroup;
  if (typeof editBindGroup === 'function') window.editBindGroup = editBindGroup;
  if (typeof cancelBindGroupEdit === 'function') window.cancelBindGroupEdit = cancelBindGroupEdit;
  if (typeof renderBindGroupTab === 'function') window.renderBindGroupTab = renderBindGroupTab;
}
