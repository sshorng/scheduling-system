/* 應用程式啟動、主／次頁籤切換、系統設定與登入流程 */

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
  const regularActions = [
    document.getElementById('__autoScheduleBtn'),
    document.getElementById('__wordExportBtn'),
    document.getElementById('__clearScheduleBtn')
  ];
  regularActions.forEach(button => { if (button) button.style.display = tab === 'seasonal' ? 'none' : ''; });
  if (typeof window.renderTabIfNeeded === 'function') {
    window.renderTabIfNeeded(tab);
  } else {
    if (tab === 'config') { renderConfigTab(); renderBindGroupTab(); }
    if (tab === 'constraints') renderConstraintsTab();
    if (tab === 'stats') renderStatsTab();
    if (tab === 'room') renderRoomSelect();
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
function initSettingsModalHandlers() {
  if (typeof document === 'undefined') return;
  const sBtn = document.getElementById('__settingsBtn');
  if (sBtn) {
    // 硬編碼 GAS 網址，不顯示設定按鈕
    sBtn.style.display = 'none';
    sBtn.onclick = () => {
      document.getElementById('__gasInput').value = (typeof localStorage !== 'undefined' ? localStorage.getItem('gas_url') : '') || '';
      document.getElementById('__settingsModal').classList.add('show');
    };
  }
  const saveBtn = document.getElementById('__saveBtn');
  if (saveBtn) saveBtn.onclick = () => {
    const v = document.getElementById('__gasInput').value.trim();
    if (!v) { toast('請輸入有效的 GAS 網址', 'warning'); return; }
    if (typeof localStorage !== 'undefined') localStorage.setItem('gas_url', v);
    GAS_URL = v;
    document.getElementById('__settingsModal').classList.remove('show');
    showModal('已儲存', '連線設定已更新，即將重新載入').then(() => location.reload());
  };
  const clearBtn = document.getElementById('__clearBtn');
  if (clearBtn) clearBtn.onclick = () => {
    showModal('確認清除', '將清除已儲存的 GAS 網址，確定嗎？', 'confirm').then(ok => {
      if (!ok) return;
      if (typeof localStorage !== 'undefined') localStorage.removeItem('gas_url');
      document.getElementById('__gasInput').value = '';
      location.reload();
    });
  };
  document.getElementById('__settingsModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('__settingsModal')) {
      document.getElementById('__settingsModal').classList.remove('show');
    }
  });
}
if (typeof document !== 'undefined') initSettingsModalHandlers();

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
// 試算表連結（隱密）
// ============================================================
async function initSheetLink() {
  if (!GAS_URL) return;
  const res = await gasGet('sheetUrl');
  if (res && res.ok && res.url) {
    applySheetLinkUrl(res.url);
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
    blockGroups: [
      { '群組ID':'BG01', '群組名稱':'七年級聯課', '科目清單':'體育,班週會', '班級清單':'701,702,703' },
    ],
    seasonalSessions: [], seasonalDays: [], seasonalNeeds: [], seasonalTeacherBlocks: [], seasonalSchedule: [],
    settings: { '學校名稱':'建成國中', '學期代號':'114-1', '每日節數':'8' }
  };
}

// ============================================================
// 初始化入口
// ============================================================

// ============================================================
// 登入驗證
// ============================================================
let _pendingLoginBootstrap = null;

async function submitLogin() {
  const pwd = document.getElementById('login-password').value.trim();
  const errEl = document.getElementById('login-error');
  const btn   = document.getElementById('login-btn');
  if (!pwd) { errEl.textContent = '請輸入密碼'; return; }
  btn.disabled = true;
  btn.textContent = '驗證中\u2026';
  errEl.textContent = '';
  try {
    const fd = new FormData();
    fd.append('action', 'bootstrap');
    fd.append('data', JSON.stringify({ password: pwd }));
    const res  = await fetch(GAS_URL, { method: 'POST', body: fd });
    let json = await res.json();
    if (json && json.ok === false && String(json.error || '').includes('未知動作：bootstrap')) {
      const legacyFd = new FormData();
      legacyFd.append('action', 'verifyAdmin');
      legacyFd.append('data', JSON.stringify({ password: pwd }));
      const legacyRes = await fetch(GAS_URL, { method: 'POST', body: legacyFd });
      json = await legacyRes.json();
      if (json && json.ok) {
        sessionStorage.setItem('sch_auth', '1');
        _pendingLoginBootstrap = null;
        document.getElementById('login-overlay').classList.add('hidden');
      } else {
        errEl.textContent = (json && json.error) || '密碼錯誤，請重試';
      }
      return;
    }
    const boot = json && json.ok ? (json.data || {}) : null;
    if (boot && boot.authenticated) {
      sessionStorage.setItem('sch_auth', '1');
      _pendingLoginBootstrap = boot;
      document.getElementById('login-overlay').classList.add('hidden');
    } else {
      errEl.textContent = (boot && boot.error) || (json && json.error) || '密碼錯誤，請重試';
    }
  } catch (e) {
    errEl.textContent = '無法連線，請確認 GAS 網址';
  } finally {
    btn.disabled = false;
    btn.textContent = '進入系統';
  }
}

function finalizeInitialTimetableView() {
  if (state.classes.length > 0 && !ui.selectedClass) {
    ui.selectedClass = state.classes[0]['班級代碼'];
    const selClass = document.getElementById('sel-class');
    if (selClass) selClass.value = ui.selectedClass;
    renderClassTT(ui.selectedClass, 'primary', { skipThird: true });
  }
  renderThirdClassSelect();
  renderThirdTeacherSelect();
  renderThirdRoomSelect();
  renderThirdTimetable();
}

function waitForLoginOverlayHidden() {
  return new Promise(function(resolve) {
    const overlay = document.getElementById('login-overlay');
    if (!overlay || overlay.classList.contains('hidden')) { resolve(); return; }
    const obs = new MutationObserver(function() {
      if (overlay.classList.contains('hidden')) { obs.disconnect(); resolve(); }
    });
    obs.observe(overlay, { attributes: true, attributeFilter: ['class'] });
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  restoreUIState();
  initTabs();
  if (typeof initSeasonalModule === 'function') initSeasonalModule();
  activateMainTab(ui.activeTab);
  attachAllTeacherComboboxes();

  if (!GAS_URL) {
    document.getElementById('login-overlay').classList.add('hidden');
    document.getElementById('__settingsModal').classList.add('show');
    await loadAll();
    finalizeInitialTimetableView();
    return;
  }

  const _authed = sessionStorage.getItem('sch_auth') === '1';
  if (_authed) {
    document.getElementById('login-overlay').classList.add('hidden');
    const swrHydrated = hydrateFromSwrCache();
    if (swrHydrated) {
      finalizeInitialTimetableView();
    }
    const runSessionRevalidate = async () => {
      const bootRes = await gasPost('bootstrap', { authSessionOk: true }, { silent: true, retry: false, timeoutMs: 30000 });
      if (bootRes && bootRes.ok && bootRes.data) {
        if (bootRes.data.sheetUrl) applySheetLinkUrl(bootRes.data.sheetUrl);
        if (bootRes.data.authenticated && bootRes.data.data) {
          await loadAll({ background: swrHydrated, prefetchedData: bootRes.data.data });
          if (!swrHydrated) finalizeInitialTimetableView();
          return;
        }
        if (bootRes.data.authRequired && !bootRes.data.authenticated) {
          sessionStorage.removeItem('sch_auth');
          document.getElementById('login-overlay').classList.remove('hidden');
          await waitForLoginOverlayHidden();
          if (_pendingLoginBootstrap && _pendingLoginBootstrap.data) {
            if (_pendingLoginBootstrap.sheetUrl) applySheetLinkUrl(_pendingLoginBootstrap.sheetUrl);
            const bootData = _pendingLoginBootstrap.data;
            _pendingLoginBootstrap = null;
            await loadAll({ prefetchedData: bootData });
          } else {
            await loadAll();
          }
          finalizeInitialTimetableView();
          return;
        }
      }
      // 向下相容舊版 Code.gs
      initSheetLink().catch(error => console.warn('Sheet link load failed:', error));
      await loadAll({ background: swrHydrated });
      if (!swrHydrated) finalizeInitialTimetableView();
    };
    if (swrHydrated) {
      runSessionRevalidate().catch(error => console.warn('Background bootstrap revalidate failed:', error));
    } else {
      await runSessionRevalidate();
    }
    return;
  }

  // 尚未在本分頁驗證：優先以單次 bootstrap 合併驗證、試算表連結與初始資料
  const bootRes = await gasPost('bootstrap', { password: '' }, { silent: true, retry: false, timeoutMs: 30000 });
  if (bootRes && bootRes.ok && bootRes.data) {
    if (bootRes.data.sheetUrl) applySheetLinkUrl(bootRes.data.sheetUrl);
    if (!bootRes.data.authRequired || bootRes.data.authenticated) {
      document.getElementById('login-overlay').classList.add('hidden');
      await loadAll({ prefetchedData: bootRes.data.data || null });
      finalizeInitialTimetableView();
      return;
    }
    await waitForLoginOverlayHidden();
    if (_pendingLoginBootstrap && _pendingLoginBootstrap.data) {
      if (_pendingLoginBootstrap.sheetUrl) applySheetLinkUrl(_pendingLoginBootstrap.sheetUrl);
      const bootData = _pendingLoginBootstrap.data;
      _pendingLoginBootstrap = null;
      await loadAll({ prefetchedData: bootData });
      finalizeInitialTimetableView();
      return;
    }
    const sheetLinkPromise = initSheetLink();
    await loadAll();
    sheetLinkPromise.catch(error => console.warn('Sheet link load failed:', error));
    finalizeInitialTimetableView();
    return;
  }

  if (bootRes && String(bootRes.error || '').includes('未知動作：bootstrap')) {
    try {
      const _fd = new FormData();
      _fd.append('action', 'verifyAdmin');
      _fd.append('data', JSON.stringify({ password: '' }));
      const _r = await fetch(GAS_URL, { method: 'POST', body: _fd });
      const _j = await _r.json();
      if (_j && _j.error === '\u672a\u8a2d\u5b9a\u7ba1\u7406\u54e1\u5bc6\u78bc') {
        document.getElementById('login-overlay').classList.add('hidden');
      } else {
        await waitForLoginOverlayHidden();
      }
    } catch (e) {
      document.getElementById('login-overlay').classList.add('hidden');
    }
  } else {
    // 連線失敗暫不阻擋，放行後由 loadAll 顯示錯誤
    document.getElementById('login-overlay').classList.add('hidden');
  }

  const sheetLinkPromise = initSheetLink();
  await loadAll();
  sheetLinkPromise.catch(error => console.warn('Sheet link load failed:', error));
  finalizeInitialTimetableView();
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
    if (key === 'tea') {
      if (typeof renderTeacherConfigList === 'function') renderTeacherConfigList();
      if (typeof renderTeacherSubjectBoxes === 'function') renderTeacherSubjectBoxes();
    }
    if (key === 'sub') {
      if (typeof renderSubjectConfigList === 'function') renderSubjectConfigList();
      if (typeof renderSubjectFormRoomOptions === 'function') renderSubjectFormRoomOptions();
    }
    if (key === 'asgn') {
      if (typeof renderAssignmentFormOptions === 'function') renderAssignmentFormOptions();
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

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('change', event => {
    if (event.target?.matches?.('#block-teachers input[type=checkbox]') && typeof renderBlockSelectionSummary === 'function') {
      renderBlockSelectionSummary();
    }
    if (event.target?.matches?.('#rule-subject-checks input[type=checkbox], #rule-class-checks input[type=checkbox], #rule-grade, #rule-type') && typeof renderRuleSelectionSummary === 'function') {
      renderRuleSelectionSummary();
    }
  });
}
