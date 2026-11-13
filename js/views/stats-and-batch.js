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

// 限制設定

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
// ===== 教師不排課：stats-and-batch 結尾 =====

function renderStatsTab() {
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
