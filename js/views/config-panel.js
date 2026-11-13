/* 基本設定頁籤（班級、教師、科目、配課行內編輯與矩陣視圖、綁班群組、配色、教師互斥） */

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
    snapshotKeys: ['subjects'],
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

function renderClassConfigList() {
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
}

function startInlineClassEdit (code) {
    ui.inlineClassCode = String(code);
    renderClassConfigList();
    document.querySelector('#class-tbody .inline-edit-row input')?.focus();
}
function cancelInlineClassEdit () {
    ui.inlineClassCode = null;
    renderClassConfigList();
}
function handleInlineClassKey (event, code) {
    if (event.key === 'Enter') { event.preventDefault(); saveInlineClass(code); }
    if (event.key === 'Escape') { event.preventDefault(); cancelInlineClassEdit(); }
}
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
}

function renderTeacherConfigList() {
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
}

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

function renderAssignmentConfigList () {
    const tbody = document.getElementById('asgn-tbody');
    if (!tbody) return;
    tbody.innerHTML = state.assignments.map(a => {
      const id = String(a['配課ID'] || '');
      const arg = "decodeURIComponent('" + encodeURIComponent(id) + "')";
      const teacher = idx.teacherByCode[a['教師姓名']];
      const sub = idx.subjectByCode[a['科目代碼']];
       const customWeekly = parseWeeklyValue(a['每週節數'], 0);
       const weekly = getAssignmentWeeklyValue(a, sub, 3);
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
}

function startInlineAssignmentEdit (id) {
    ui.inlineAssignmentId = String(id);
    renderAssignmentConfigList();
    document.querySelector('.assignment-inline-row [data-asgn-field="class"]')?.focus();
}
function editAssignment(id) { return startInlineAssignmentEdit(id); }
function cancelInlineAssignmentEdit () {
    ui.inlineAssignmentId = null;
    renderAssignmentConfigList();
}
function handleInlineAssignmentKey (event, id) {
    if (event.key === 'Enter') { event.preventDefault(); window.saveInlineAssignment(id); }
    if (event.key === 'Escape') { event.preventDefault(); cancelInlineAssignmentEdit(); }
}
window.saveInlineAssignment = function (id) {
    const row = Array.from(document.querySelectorAll('.assignment-inline-row')).find(el => el.dataset.assignmentId === String(id));
    if (!row) return;
     const get = name => String(row.querySelector('[data-asgn-field="'+name+'"]')?.value ?? '').trim();
     const cls = get('class'), sub = get('subject'), teacher = parseTeacherCode(get('teacher'));
     if (!cls || !sub) { toast('班級與科目必填', 'warning'); return; }
     const weekly = get('weekly');
      if (!isValidWeeklyInput(weekly)) { toast('每週節數請留白、填 0.5，或填 1 至 20 的整數', 'warning'); return; }
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
        if (typeof renderAssignmentConfigList === 'function') renderAssignmentConfigList();
      },
      gasTask: () => gasPost('saveMeta', { type: '配課', data }),
      rollbackLocal: () => {
        ui.inlineAssignmentId = String(id);
        if (typeof renderAssignmentConfigList === 'function') renderAssignmentConfigList();
      }
    });
};

function renderAssignmentFormOptions () {
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
function renderSubjectFormRoomOptions () {
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
function renderTeacherSubjectBoxes(selectedCodes = null) {
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
}

function updateTeaSubjectSummary () {
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
}

function toggleTeaSubjectDropdown (event) {
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
}

function hideTeaSubjectDropdown () {
    const dropdown = document.getElementById('tea-subject-dropdown');
    const trigger = document.getElementById('tea-subject-trigger');
    if (dropdown) dropdown.style.display = 'none';
    if (trigger) trigger.classList.remove('open');
}

function filterTeaSubjects (query) {
    const q = String(query || '').trim().toLowerCase();
    const options = document.querySelectorAll('#tea-subject-boxes .multiselect-option');
    options.forEach(opt => {
      const text = opt.textContent.toLowerCase();
      opt.style.display = text.includes(q) ? 'flex' : 'none';
    });
}

function selectAllTeaSubjects (selectAll) {
    const checkboxes = document.querySelectorAll('#tea-subject-boxes input[type="checkbox"]');
    checkboxes.forEach(cb => {
      if (cb.closest('.multiselect-option')?.style.display !== 'none') {
        cb.checked = selectAll;
      }
    });
    updateTeaSubjectSummary();
}

function removeTeaSubject (code, event) {
    if (event) event.stopPropagation();
    const cb = Array.from(document.querySelectorAll('#tea-subject-boxes input[type="checkbox"]')).find(input => input.value === String(code));
    if (cb) {
      cb.checked = false;
      updateTeaSubjectSummary();
    }
}

function teacherFormSubjects () {
    const wrap = document.getElementById('tea-subject-boxes');
    if (!wrap) return '';
    return Array.from(wrap.querySelectorAll('input:checked')).map(cb => cb.value).join(',');
}

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#tea-subject-multiselect')) {
        hideTeaSubjectDropdown();
      }
    });
  }

// clearTeacherForm 已整合進統一表單清理函式

function switchAsgnSubTab (tab) {
    ['cls', 'tea', 'batch'].forEach(t => {
      const btn = document.getElementById('asgn-tab-btn-' + t);
      const panel = document.getElementById('asgn-subpanel-' + t);
      if (btn) btn.classList.toggle('active', t === tab);
      if (panel) panel.style.display = t === tab ? 'block' : 'none';
    });
    if (tab === 'cls') renderClassAssignmentView();
    if (tab === 'tea') renderTeacherAssignmentView();
    if (tab === 'batch' && typeof renderBatchPicker === 'function') renderBatchPicker();
}

function quickAddAssignmentForClass (classCode) {
    switchSubTab('config', 'asgn');
    const modeSelect = document.getElementById('batch-mode');
    if (modeSelect) modeSelect.value = 'class-matrix';
    window.switchAsgnSubTab('batch');
    const classTargetSelect = document.getElementById('batch-class-target');
    if (classTargetSelect) classTargetSelect.value = classCode;
    const subFilterSelect = document.getElementById('batch-class-sub-filter');
    if (subFilterSelect) subFilterSelect.value = 'ALL';
    if (typeof renderBatchPreview === 'function') renderBatchPreview();
}

function quickAddAssignmentForTeacher (teacherCode) {
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
}

function renderConfigTab() {
    const isSubPanelVisible = id => {
      if (typeof document === 'undefined' || !document.getElementById) return true;
      const el = document.getElementById(id);
      if (!el) return true;
      return el.style.display !== 'none';
    };
    if (isSubPanelVisible('subpanel-config-cls') && typeof renderClassConfigList === 'function') {
      renderClassConfigList();
    }
    if (isSubPanelVisible('subpanel-config-tea')) {
      if (typeof renderTeacherConfigList === 'function') renderTeacherConfigList();
      if (typeof renderTeacherSubjectBoxes === 'function') renderTeacherSubjectBoxes();
    }
    if (isSubPanelVisible('subpanel-config-sub')) {
      if (typeof renderSubjectConfigList === 'function') renderSubjectConfigList();
      if (typeof renderSubjectFormRoomOptions === 'function') renderSubjectFormRoomOptions();
    }
    if (isSubPanelVisible('subpanel-config-asgn')) {
      if (typeof renderAssignmentFormOptions === 'function') renderAssignmentFormOptions();
      if (typeof renderAssignmentConfigList === 'function') renderAssignmentConfigList();
      if (typeof renderClassAssignmentView === 'function') renderClassAssignmentView();
      if (typeof renderTeacherAssignmentView === 'function') renderTeacherAssignmentView();
    }
    if (isSubPanelVisible('subpanel-config-bind') && typeof renderBindGroupTab === 'function') {
      renderBindGroupTab();
    }
}

const isHelperSubjectCodeForCount = value => typeof isHelperSubjectCode === 'function' ? isHelperSubjectCode(value) : /輔$/i.test(String(value || '').trim());
function renderClassAssignmentView () {
    const tbody = document.getElementById('asgn-class-tbody');
    const thead = document.getElementById('asgn-class-thead');
    const summary = document.getElementById('asgn-matrix-summary');
    if (!tbody || !thead) return;
    const filterText = String(document.getElementById('asgn-class-filter')?.value || '').trim().toLowerCase();
    const jsArg = value => "decodeURIComponent('" + encodeURIComponent(String(value || '')) + "')";

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
         assignmentTeacherItems(assignment).map(item => teacherLabel(item.code, item.tag))
       )].join(' ').toLowerCase();
      if (filterText && !searchableText.includes(filterText)) return '';
      visibleClassCount++;

      let totalAssignedWeekly = 0;
      const cellsHtml = subjectColumns.map(column => {
        const assignments = assignmentsBySubject.get(column.code) || [];
       const defaultWeekly = getSubjectWeeklyValue(column.subject, 3);
        const applicable = applicableSubjectCodes.has(column.code);
        const teacherItems = assignments.flatMap(assignmentTeacherItems);
        const teacherNames = [...new Map(teacherItems.map(item => [item.code + '|' + item.tag, teacherLabel(item.code, item.tag)])).values()].filter(Boolean);
        const firstAssignment = assignments[0];
        const preplanned = assignments.some(assignment => typeof isPreplannedCourse === 'function' && isPreplannedCourse(assignment['課程屬性']));
        const cellClick = (applicable || assignments.length > 0)
          ? ' onclick="openMatrixAssignmentEditor(' + jsArg(classCode) + ',' + jsArg(column.code) + ',' + jsArg(firstAssignment?.['配課ID'] || '') + ')" tabindex="0" role="button"'
          : '';
       const weekly = getAssignmentWeeklyValue(firstAssignment, column.subject, defaultWeekly);

        if (assignments.length > 0 && !isHelperSubjectCodeForCount(column.code)) {
          totalAssignedWeekly += assignments.reduce((total, assignment) => {
             return total + getAssignmentWeeklyValue(assignment, column.subject, defaultWeekly);
          }, 0);
        }
        if (teacherNames.length > 0) {
           const title = column.code + '：' + teacherNames.join('／') + '，每週' + formatWeeklyValue(weekly) + '節' + (isAlternateWeeklyValue(weekly) ? '（單雙週）' : '') + (preplanned ? '，預排下學期' : '');
          return '<td class="asgn-matrix-cell is-assigned' + (preplanned ? ' is-preplanned' : '') + '"' + cellClick + ' title="' + esc(title) + '">' +
            teacherNames.map(name => '<span class="asgn-matrix-teacher">' + esc(name) + '</span>').join('') +
            (preplanned ? '<span class="asgn-matrix-course-attr">預排</span>' : '') +
            '</td>';
        }
        if (assignments.length > 0) {
          return '<td class="asgn-matrix-cell is-unassigned' + (preplanned ? ' is-preplanned' : '') + '"' + cellClick + ' title="已建立配課紀錄，但尚未指定教師"></td>';
        }
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
      summary.textContent = '顯示 ' + visibleClassCount + '／' + state.classes.length + ' 班　' + subjectColumns.length + ' 科　已建立 ' + state.assignments.length + ' 筆配課';
    }
    tbody.innerHTML = html || '<tr><td colspan="' + (subjectColumns.length + 3) + '" class="text-center text-muted py-3">無符合條件的班級</td></tr>';
  };
  if (typeof window !== 'undefined') window.renderClassAssignmentView = renderClassAssignmentView;

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
      snapshotKeys: ['assignments'],
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
    const fastKeys = idx.teacherScheduleKeysByCode && idx.teacherScheduleKeysByCode[code];
    const keysToScan = fastKeys ? Array.from(fastKeys) : Object.keys(slotIndex);
    keysToScan.forEach(key => {
      if (!fastKeys && !key.startsWith(code + '|')) return;
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
    if (slots.size > 0 || idx.__built) return slots.size;

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

function renderTeacherAssignmentView () {
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
      const weekly = getAssignmentWeeklyValue(asgn, sub, 3);
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
}
if (typeof window !== 'undefined') window.renderTeacherAssignmentView = renderTeacherAssignmentView;

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
    snapshotKeys: ['classes'],
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
    snapshotKeys: ['classes'],
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
    snapshotKeys: ['subjects'],
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
    snapshotKeys: ['subjects'],
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
  tbody.innerHTML = state.blockGroups.map(g => {
    const clsList = typeof g['班級清單'] === 'string' ? g['班級清單'].split(',').map(c => c.trim()).filter(Boolean) : (Array.isArray(g['班級清單']) ? g['班級清單'] : (typeof g['班級清單'] === 'number' ? String(g['班級清單']).match(/.{3}/g) || [] : []));
    const clsNames = clsList.join('、');
    const subList = typeof g['科目清單'] === 'string' ? g['科目清單'].split(',').map(s => s.trim()).filter(Boolean) : (typeof g['科目代碼'] === 'string' ? g['科目代碼'].split(',').map(s => s.trim()).filter(Boolean) : []);
    const subDisp = subList.map(s => esc(s)).join('、');
    return '<tr>' +
      '<td><strong>' + esc(g['群組名稱'] || '') + '</strong></td>' +
      '<td style="font-size:12px;">' + subDisp + '</td>' +
      '<td style="font-size:12px;">' + esc(clsNames) + '</td>' +
      '<td><button class="btn btn-ghost btn-xs" onclick="editBindGroup(\'' + esc(g['群組ID']) + '\')">編輯</button> ' +
      '<button class="btn btn-xs" style="background:var(--danger-light);color:var(--danger);" onclick="deleteBindGroup(\'' + esc(g['群組ID']) + '\')">刪</button></td>' +
      '</tr>';
  }).join('');
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

function editBindGroup(id) {
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
}

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

// 教師設定：列內編輯，避免跳回頁首。
function teacherHomeroomLabel(teacher) {
  const homeroom = getTeacherHomeroom(teacher);
  if (!homeroom || homeroom === 'TRUE') return '—';
  const cls = idx.classByCode[String(homeroom)];
  return cls ? homeroom+' '+(cls['班級名稱'] || '') : String(homeroom);
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
    snapshotKeys: ['teachers'],
    applyLocal: () => {
      const idxObj = state.teachers.findIndex(t => String(t['教師姓名']) === String(code));
      if (idxObj >= 0) state.teachers[idxObj] = newObj;
      else state.teachers.push(newObj);
      clearTeacherForm();
      if (typeof renderTeacherConfigList === 'function') renderTeacherConfigList();
    },
    gasTask: () => gasPost('saveMeta', { type:'教師', data: newObj })
  });
}

async function deleteTeacher(code) {
  const confirmed = await showModal('確認刪除', '確定刪除教師 '+code+' ？', 'confirm');
  if (!confirmed) return;

  bgSync({
    actionName: '刪除教師',
    snapshotKeys: ['teachers'],
    applyLocal: () => {
      state.teachers = state.teachers.filter(t => String(t['教師姓名']) !== String(code));
      if (typeof renderTeacherConfigList === 'function') renderTeacherConfigList();
    },
    gasTask: () => gasPost('deleteMeta', { type:'教師', key:code })
  });
}
function clearTeacherForm() {
  ['tea-code','tea-name','tea-email'].forEach(id => { const input = document.getElementById(id); if (input) input.value = ''; });
  const teaTitle = document.getElementById('tea-title'); if (teaTitle) teaTitle.value = '';
  const releaseReason = document.getElementById('tea-release-reason'); if (releaseReason) releaseReason.value = '';
  const hours = document.getElementById('tea-hours'); if (hours) hours.value = '16';
  const consec = document.getElementById('tea-max-consec'); if (consec) consec.value = '3';
  document.querySelectorAll('#tea-subject-boxes input').forEach(input => { input.checked = false; });
  if (typeof updateTeaSubjectSummary === 'function') updateTeaSubjectSummary();
}

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
    snapshotKeys: ['teacherExclusives'],
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
    snapshotKeys: ['teacherExclusives'],
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

  if (typeof startInlineClassEdit === 'function') window.startInlineClassEdit = startInlineClassEdit;
  if (typeof cancelInlineClassEdit === 'function') window.cancelInlineClassEdit = cancelInlineClassEdit;
  if (typeof handleInlineClassKey === 'function') window.handleInlineClassKey = handleInlineClassKey;
  if (typeof startInlineAssignmentEdit === 'function') window.startInlineAssignmentEdit = startInlineAssignmentEdit;
  if (typeof cancelInlineAssignmentEdit === 'function') window.cancelInlineAssignmentEdit = cancelInlineAssignmentEdit;
  if (typeof handleInlineAssignmentKey === 'function') window.handleInlineAssignmentKey = handleInlineAssignmentKey;
  if (typeof editAssignment === 'function') window.editAssignment = editAssignment;
  if (typeof switchAsgnSubTab === 'function') window.switchAsgnSubTab = switchAsgnSubTab;
  if (typeof quickAddAssignmentForClass === 'function') window.quickAddAssignmentForClass = quickAddAssignmentForClass;
  if (typeof quickAddAssignmentForTeacher === 'function') window.quickAddAssignmentForTeacher = quickAddAssignmentForTeacher;
  if (typeof renderConfigTab === 'function') window.renderConfigTab = renderConfigTab;
  if (typeof renderClassConfigList === 'function') window.renderClassConfigList = renderClassConfigList;
  if (typeof renderTeacherConfigList === 'function') window.renderTeacherConfigList = renderTeacherConfigList;
  if (typeof renderSubjectConfigList === 'function') window.renderSubjectConfigList = renderSubjectConfigList;
  if (typeof renderAssignmentConfigList === 'function') window.renderAssignmentConfigList = renderAssignmentConfigList;
  if (typeof renderClassAssignmentView === 'function') window.renderClassAssignmentView = renderClassAssignmentView;
  if (typeof renderTeacherAssignmentView === 'function') window.renderTeacherAssignmentView = renderTeacherAssignmentView;
}
