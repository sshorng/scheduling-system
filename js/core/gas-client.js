/* Google Apps Script 通訊層：序列化寫入佇列、SWR 本機快取與狀態同步 */

// ============================================================
// GAS API
// ============================================================
const SCHEDULE_WRITE_ACTIONS = new Set([
  'updateCell', 'clearCell', 'swapCells', 'moveCell', 'lockCell', 'setOvertime', 'batchSetOvertime',
  'savePatrolSchedule', 'batchUpdateSchedule'
]);
const MUTATING_GAS_ACTIONS = new Set([
  ...SCHEDULE_WRITE_ACTIONS,
  'saveMeta', 'renameTeacher', 'deleteMeta', 'saveTeacherBlock',
  'saveSubjectRule', 'saveSubjectRelation', 'saveTeacherExclusive', 'initDatabase', 'saveSeasonalBundle'
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
  const enqueueRequest = shouldQueue || action === 'bootstrap';
  if (MUTATING_GAS_ACTIONS.has(action)) _localMutationVersion++;
  const requestPayload = addGasRequestId(action, payload);
  const request = () => gasPostNow(action, queuedGasPayload(action, requestPayload), options);
  return enqueueRequest ? enqueueGasRequest(request) : request();
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
const BG_SYNC_SNAPSHOT_KEYS = [
  'classes', 'teachers', 'subjects', 'assignments', 'schedule',
  'teacherBlocks', 'subjectRules', 'subjectRelations',
  'teacherExclusives', 'blockGroups', 'rooms', 'scheduleColors'
];

function cloneSnapshotSlice(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function bgSync({ actionName, applyLocal, gasTask, rollbackLocal, snapshotKeys, onSuccess }) {
  // 只複製本次異動涉及的資料區段；未指定時保留完整備份以確保向下相容。
  const keysToClone = Array.isArray(snapshotKeys) && snapshotKeys.length > 0
    ? snapshotKeys
    : BG_SYNC_SNAPSHOT_KEYS;
  const snapshot = { scheduleRevision: state.scheduleRevision };
  keysToClone.forEach(key => {
    snapshot[key] = cloneSnapshotSlice(state[key] || []);
  });

  // 1. 立即樂觀更新本地 UI（不阻塞 UI、不彈全頁 Loading）
  try {
    if (applyLocal) applyLocal();
    bumpDataRevision();
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
      if (typeof onSuccess === 'function' && requestMutationVersion === _localMutationVersion) {
        onSuccess(res);
      }
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
    BG_SYNC_SNAPSHOT_KEYS.forEach(key => {
      if (Object.prototype.hasOwnProperty.call(snapshot, key)) state[key] = snapshot[key];
    });
    if (Object.prototype.hasOwnProperty.call(snapshot, 'scheduleRevision')) {
      state.scheduleRevision = snapshot.scheduleRevision;
    }
  }
  bumpDataRevision();
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
// 資料載入（SWR 快取 + 合併啟動） & 索引建立
// ============================================================
const SWR_CACHE_PREFIX = 'sch_swr_v1_';
const SWR_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
let _lastAppliedBootstrapDigest = '';

function hashFnv1a(text) {
  const str = String(text || '');
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash = Math.imul(hash ^ str.charCodeAt(i), 16777619) >>> 0;
  }
  return (hash >>> 0).toString(36);
}

function getSwrCacheKey(url = GAS_URL) {
  const normalized = String(url || '').trim();
  if (!normalized) return '';
  return SWR_CACHE_PREFIX + hashFnv1a(normalized);
}

function computeBootstrapDigest(d) {
  if (!d || typeof d !== 'object') return '';
  try {
    const metaPayload = JSON.stringify([
      d.gasVersion || '', d.schemaVersion || '', d.scheduleRevision || '',
      Array.isArray(d.schedule) ? d.schedule.length : 0,
      d.classes || [], d.teachers || [], d.subjects || [], d.assignments || [],
      d.teacherBlocks || [], d.subjectRules || [], d.subjectRelations || [],
      d.blockGroups || [], d.rooms || [], d.scheduleColors || [],
      d.teacherExclusives || [], d.seasonalSessions || [], d.seasonalNeeds || [],
      d.seasonalTeacherBlocks || [], d.seasonalSchedule || [], d.settings || {}
    ]);
    return hashFnv1a(metaPayload) + ':' + metaPayload.length;
  } catch (err) {
    return '';
  }
}

function readSwrCache(url = GAS_URL) {
  if (typeof localStorage === 'undefined') return null;
  const key = getSwrCacheKey(url);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    const cacheVersion = typeof ASSET_VERSION !== 'undefined' ? ASSET_VERSION : FRONTEND_VERSION;
    if (!entry || entry.version !== cacheVersion || !entry.data || typeof entry.data !== 'object') return null;
    if (entry.savedAt && Date.now() - Number(entry.savedAt) > SWR_CACHE_MAX_AGE_MS) return null;
    if (!Array.isArray(entry.data.classes)) return null;
    return entry;
  } catch (err) {
    return null;
  }
}

function writeSwrCache(data, url = GAS_URL) {
  if (typeof localStorage === 'undefined' || !data || typeof data !== 'object') return false;
  const key = getSwrCacheKey(url);
  if (!key) return false;
  try {
    const cacheVersion = typeof ASSET_VERSION !== 'undefined' ? ASSET_VERSION : FRONTEND_VERSION;
    const payload = JSON.stringify({
      version: cacheVersion,
      savedAt: Date.now(),
      data
    });
    if (payload.length > 2500000) return false;
    localStorage.setItem(key, payload);
    return true;
  } catch (err) {
    return false;
  }
}

function hydrateFromSwrCache() {
  if (!GAS_URL) return false;
  const cached = readSwrCache(GAS_URL);
  if (!cached || !cached.data) return false;
  const cachedDigest = computeBootstrapDigest(cached.data);
  applyData(cached.data);
  _lastAppliedBootstrapDigest = cachedDigest;
  _isAppInitialized = true;
  setStatus('loading');
  showLoading(false);
  renderAll();
  return true;
}

function applySheetLinkUrl(url) {
  const safeUrl = String(url || '').trim();
  if (!safeUrl || typeof document === 'undefined') return;
  const link = document.getElementById('__sheetLink');
  if (!link) return;
  link.style.display = 'flex';
  link.onclick = () => window.open(safeUrl, '_blank');
}

async function loadAll(options = {}) {
  const background = options && options.background === true;
  const prefetchedData = options && options.prefetchedData ? options.prefetchedData : null;
  const requestMutationVersion = _localMutationVersion;
  if (!background) showLoading(true);
  setStatus('loading');
  let res;

  if (prefetchedData) {
    res = { ok: true, data: prefetchedData };
  } else if (GAS_URL) {
    res = await gasPost('getAll', {}, { silent: background, retry: false, timeoutMs: 30000 });
  } else {
    res = { ok: true, data: getDemoData() };
  }

  if (!res || !res.ok) {
    setStatus('error');
    if (background && _isAppInitialized) {
      toast('背景重新整理失敗，目前顯示既有資料：' + (res ? res.error : '無回應'), 'warning');
    } else {
      toast('載入失敗：' + (res ? res.error : '無回應'), 'error');
    }
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
  const nextDigest = computeBootstrapDigest(res.data);
  if (GAS_URL) writeSwrCache(res.data, GAS_URL);
  if (background && _isAppInitialized && _lastAppliedBootstrapDigest && nextDigest && nextDigest === _lastAppliedBootstrapDigest) {
    setStatus('connected');
    return;
  }
  applyData(res.data);
  _lastAppliedBootstrapDigest = nextDigest;
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
  state.seasonalSessions = d.seasonalSessions || [];
  state.seasonalDays = d.seasonalDays || [];
  state.seasonalNeeds = d.seasonalNeeds || [];
  state.seasonalTeacherBlocks = d.seasonalTeacherBlocks || [];
  state.seasonalSchedule = d.seasonalSchedule || [];
  state.apiVersion = String(d.gasVersion || '');
  state.schemaVersion = String(d.schemaVersion || '');
  state.settings      = d.settings      || {};
  // 向下相容：舊資料使用連堂節數 -> 改為最多連日（複製物件避免改寫原始快取快照）
  state.subjects = state.subjects.map(orig => {
    const s = { ...orig };
    if (s['最多連日'] === undefined || s['最多連日'] === '' || s['最多連日'] === null) {
      const old = s['連堂節數'];
      if (old !== undefined && old !== '' && old !== null) {
        const parsedOld = parseInt(old, 10);
        s['最多連日'] = Number.isFinite(parsedOld) && parsedOld > 0 ? String(parsedOld) : '';
      } else {
        s['最多連日'] = '';
      }
    }
    return s;
  });
  buildIndex();
  bumpDataRevision();
  if (ui.activeTab === 'seasonal' && typeof renderSeasonalWorkspace === 'function' && typeof seasonalActiveSession === 'function') {
    try { renderSeasonalWorkspace(); } catch (err) { console.warn('renderSeasonalWorkspace on loadAll error:', err); }
  }
}
