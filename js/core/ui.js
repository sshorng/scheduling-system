/* 瀏覽器互動介面元件：全域對話框、提示、載入遮罩與教師搜尋下拉選單 */

let _globalTeacherDropdown = null;
let _activeComboboxInput = null;

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

function onTeacherSelectChange(val) {
  const code = parseTeacherCode(val);
  if (code) {
    ui.selectedTeacher = code;
    renderTeacherTT(code);
  }
}

function getGlobalTeacherDropdown() {
  if (typeof document === 'undefined') return null;
  if (!_globalTeacherDropdown) {
    _globalTeacherDropdown = document.createElement('div');
    _globalTeacherDropdown.id = '__globalTeacherDropdown';
    _globalTeacherDropdown.className = 'combobox-dropdown global-dropdown';
    document.body.appendChild(_globalTeacherDropdown);

    if (typeof document.addEventListener === 'function') {
      document.addEventListener('click', (e) => {
        if (_activeComboboxInput && !_globalTeacherDropdown.contains(e.target) && !_activeComboboxInput.parentNode.contains(e.target)) {
          closeGlobalTeacherDropdown();
        }
      });
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('resize', () => closeGlobalTeacherDropdown());
    }
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
