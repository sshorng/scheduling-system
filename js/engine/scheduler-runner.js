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

let _autoSchedulePromise = null;
let _schedulerWorkerJobSeq = 0;

function readAutoScheduleUiConfig(runOptions = {}) {
  const getEl = id => (typeof document !== 'undefined' && document.getElementById) ? document.getElementById(id) : null;
  let autoStartPeriod = parseInt(getEl('auto-period-start')?.value || '1', 10);
  let autoEndPeriod = parseInt(getEl('auto-period-end')?.value || '7', 10);
  if (isManualOnlyPeriod(autoStartPeriod)) autoStartPeriod = 1;
  if (isManualOnlyPeriod(autoEndPeriod)) autoEndPeriod = 7;
  if (!Number.isFinite(autoStartPeriod) || autoStartPeriod < 1 || autoStartPeriod > 8) autoStartPeriod = 1;
  if (!Number.isFinite(autoEndPeriod) || autoEndPeriod < 1 || autoEndPeriod > 8) autoEndPeriod = 7;
  const optP8Only = getEl('auto-opt-p8-only')?.checked ?? false;
  if (optP8Only) { autoStartPeriod = 8; autoEndPeriod = 8; }
  const priorityTeacherInput = String(getEl('auto-priority-teachers')?.value || '').trim();
  const prioritySubjectInput = String(getEl('auto-priority-subjects')?.value || '').trim();
  try {
    if (typeof localStorage !== 'undefined') {
      if (priorityTeacherInput) localStorage.setItem('auto_priority_teachers', priorityTeacherInput);
      else localStorage.removeItem('auto_priority_teachers');
      if (prioritySubjectInput) localStorage.setItem('auto_priority_subjects', prioritySubjectInput);
      else localStorage.removeItem('auto_priority_subjects');
    }
  } catch (error) {
    console.warn('[AutoSchedule] 優先排序設定儲存失敗：', error);
  }
  const tightClassCodes = typeof window !== 'undefined'
    ? (window.__lastAutoSchedulePreflight?.bottlenecks?.tightClasses || []).map(item => String(item.classCode || '')).filter(Boolean)
    : [];
  const seed = runOptions.seed !== undefined
    ? String(runOptions.seed)
    : String(getEl('auto-random-seed')?.value || '').trim();
  const autoMode = (typeof document !== 'undefined' && document.querySelector)
    ? (document.querySelector('input[name="auto-mode"]:checked')?.value ?? 'all')
    : 'all';
  return {
    autoStartPeriod,
    autoEndPeriod,
    optOnePerDay: true,
    optMorningCore: getEl('auto-opt-morning-core')?.checked ?? true,
    optTeacherConsec: getEl('auto-opt-teacher-consec')?.checked ?? true,
    optSmartSwap: getEl('auto-opt-smart-swap')?.checked ?? true,
    optRandomize: runOptions.randomize !== undefined
      ? Boolean(runOptions.randomize)
      : (getEl('auto-opt-randomize')?.checked ?? false),
    optP8Only,
    priorityTeacherInput,
    prioritySubjectInput,
    seed,
    autoMode,
    tightClassCodes
  };
}

function createAutoScheduleStateSnapshot() {
  return {
    classes: state.classes || [],
    teachers: state.teachers || [],
    subjects: state.subjects || [],
    assignments: state.assignments || [],
    schedule: (state.schedule || []).map(entry => ({ ...entry })),
    scheduleRevision: String(state.scheduleRevision || ''),
    teacherBlocks: state.teacherBlocks || [],
    subjectRules: state.subjectRules || [],
    subjectRelations: state.subjectRelations || [],
    blockGroups: state.blockGroups || [],
    rooms: state.rooms || [],
    scheduleColors: state.scheduleColors || [],
    teacherExclusives: state.teacherExclusives || [],
    settings: state.settings || {}
  };
}

function canUseSchedulerWorker() {
  if (typeof Worker !== 'function') return false;
  if (typeof window === 'undefined' || !window.location) return false;
  // file:// 下多數瀏覽器禁止載入外部 Worker 腳本，自動降級回主執行緒非阻塞排程。
  if (window.location.protocol === 'file:') return false;
  return true;
}

function runSchedulerWorkerJob(payload) {
  return new Promise((resolve, reject) => {
    let worker = null;
    const jobId = ++_schedulerWorkerJobSeq;
    try {
      const assetVer = typeof ASSET_VERSION !== 'undefined' ? ASSET_VERSION : FRONTEND_VERSION;
      worker = new Worker('js/engine/scheduler-worker.js?v=' + encodeURIComponent(assetVer));
    } catch (error) {
      reject(error);
      return;
    }
    const cleanup = () => {
      if (worker) {
        try { worker.terminate(); } catch (e) {}
        worker = null;
      }
    };
    worker.onmessage = event => {
      const msg = event && event.data ? event.data : {};
      if (msg.id !== jobId) return;
      if (msg.type === 'progress') {
        if (typeof updateProgress === 'function') updateProgress(msg.message);
        return;
      }
      cleanup();
      if (msg.type === 'error') reject(new Error(msg.error || 'Worker 排程失敗'));
      else resolve(msg);
    };
    worker.onerror = event => {
      cleanup();
      reject(new Error(event?.message || 'Worker 執行失敗'));
    };
    worker.postMessage({ ...payload, id: jobId, stateSnapshot: createAutoScheduleStateSnapshot() });
  });
}

async function prepareAutoScheduleUiRun(runOptions = {}) {
  if (typeof closeAutoScheduleModal === 'function') closeAutoScheduleModal();
  const preflightIssues = typeof collectAutoSchedulePreflightIssues === 'function' ? collectAutoSchedulePreflightIssues() : [];
  if (preflightIssues.length > 0 && !runOptions.skipPreflight && typeof showModal === 'function') {
    const detail = preflightIssues.slice(0, 12).map(issue => '• ' + esc(issue)).join('<br>');
    const more = preflightIssues.length > 12 ? '<br>另有 ' + (preflightIssues.length - 12) + ' 項' : '';
    const confirmed = await showModal(
      '⚠️ 排課前設定健檢',
      '系統發現以下設定可能互相矛盾：<br><br>' + detail + more + '<br><br>仍要繼續自動排課嗎？',
      'confirm',
      '繼續排課',
      '取消'
    );
    if (!confirmed) return null;
  }
  const config = readAutoScheduleUiConfig(runOptions);
  if (typeof showLoading === 'function') showLoading(true, '準備排課資料…');
  if (typeof toast === 'function') toast('🤖 智慧大師級自動排課運算中...', 'info');
  return { config };
}

function formatAutoElapsedMs(elapsedMs) {
  const elapsedSeconds = Math.max(0, (Number(elapsedMs) || 0) / 1000);
  if (elapsedSeconds < 60) return elapsedSeconds.toFixed(2) + ' 秒';
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = (elapsedSeconds - minutes * 60).toFixed(2).padStart(5, '0');
  return minutes + ' 分 ' + seconds + ' 秒';
}

async function applySingleAutoScheduleResultUi(result) {
  if (!result) return result;
  if (typeof window !== 'undefined') {
    if (result.failureDetails) window.__lastAutoScheduleFailureDetails = result.failureDetails;
    if (result.conflictPressure) window.__lastAutoScheduleConflictPressure = result.conflictPressure;
    if (result.runSummary) window.__lastAutoScheduleRunSummary = result.runSummary;
    if (result.profile) window.__lastAutoScheduleProfile = result.profile;
  }
  if (typeof updateProgress === 'function') updateProgress('套用結果中…');
  if (typeof showLoading === 'function') showLoading(false);
  if (typeof yieldToUI === 'function') await yieldToUI();
  const rangeLabel = result.rangeLabel || (result.optP8Only ? '第 8 節（課後輔導）' : `第 ${result.autoStartPeriod}~${result.autoEndPeriod} 節`);
  if (result.nothingPending) {
    showModal('自動排課完成', `🎉 在 <b>${rangeLabel}</b> 範圍內，所有配課項目（班級＋科目＋教師）皆已安排完畢，無需額外自動排課！`, 'info');
    return result;
  }
  const elapsedText = formatAutoElapsedMs(result.elapsedMs);
  if (result.frozenViolations && result.frozenViolations.length > 0) {
    showModal('自動排課未套用', `⛔ 凍結課程檢查失敗，為保護鎖課與必排課，本次結果未寫回。<br><br>${result.frozenViolations.map(esc).join('<br>')}<br><br>總用時：${elapsedText}`, 'error');
    return result;
  }
  const quality = result.quality;
  if (quality && quality.violations.length > 0) {
    showModal('自動排課未套用', `⛔ 候選課表未通過硬限制稽核，本次結果未寫回。<br><br>${quality.violations.slice(0, 20).map(esc).join('<br>')}<br><br>總用時：${elapsedText}`, 'error');
    return result;
  }
  state.schedule = (result.schedule || []).map(entry => ({ ...entry }));
  buildIndex();
  bumpDataRevision();
  if (typeof perfRecord === 'function') {
    perfRecord('executeAutoScheduleCore', Number(result.elapsedMs) || 0, { scheduled: state.schedule.length, pending: result.pendingCount || 0 });
  }
  if (ui.selectedClass) renderClassTT(ui.selectedClass);
  if (ui.selectedTeacher) renderTeacherTT(ui.selectedTeacher);

  const scheduleSnapshot = state.schedule.map(entry => ({ ...entry }));
  const originalScheduleIds = result.originalScheduleIds || [];
  if (!GAS_URL) {
    toast('課表已套用至目前畫面（尚未連線雲端）', 'info');
  } else {
    gasPost('batchUpdateSchedule', { schedule: scheduleSnapshot, baseRevision: state.scheduleRevision, ignoredTeacherConsecutiveIds: originalScheduleIds }, { silent: true })
      .then(res => {
        if (!res) { toast('雲端暫時無法連線，已保留目前課表', 'warning'); return; }
        if (!res.ok) {
          const writeError = res.error || '雲端同步遭拒，正在背景重新載入課表';
          toast(writeError, 'warning');
          showModal('自動排課未寫入資料庫', `⛔ ${esc(writeError)}<br><br>本次結果未寫入雲端，系統將重新載入資料庫中的課表。`, 'error');
          loadAll({ background: true }).catch(err => console.error('Background reload error:', err));
          return;
        }
        applyScheduleRevisionResponse(res);
        toast('✅ 自動排課已寫入資料庫', 'success');
      })
      .catch(err => console.error('Batch save error:', err));
  }

  const autoFailureLabels = {
    'bind-group-no-common-slot': '綁班沒有共同可用時段',
    'bind-group-weekly-mismatch': '綁班每週節數不一致，整組拒絕排課',
    'no-legal-slot': '沒有合法可用格位',
    'class-zero-slack-no-legal-slot': '班級零彈性，沒有可用格位',
    'cascade-no-legal-slot': '連鎖搬動後仍沒有合法格位',
    'mandatory-evicted': '必排挪出後待重排'
  };
  const failList = result.failList || [];
  const bindFailureLessons = result.bindFailureLessons || [];
  const bindDefinitionErrors = result.bindDefinitionErrors || [];
  const netPlaced = Math.max(0, (Number(result.pendingCount) || 0) - (quality ? quality.remainingLessons : 0));
  const failureReasonCounts = new Map();
  const displayedFailureIds = new Set();
  const maxFailureDetails = Math.max(0, quality ? quality.remainingLessons : 0);
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
  msg += `<br><br>局部最佳化：<b>${result.localOptimizationMoves || 0}</b> 次合法移動／交換`;
  msg += `<br><br><b>品質分：${quality.score}/100</b>　教師空堂：${quality.teacherGaps}　每日負擔落差：${quality.teacherImbalance}　教師連堂超限：${quality.teacherLongStreaks}　固定節次集中：${quality.teacherRepeatedPeriods}　下午過量：${quality.teacherAfternoonOverload}　排一七／排四五軟規則：${quality.teacherPairSoftViolations || 0}　教師互斥軟衝突：${quality.teacherExclusiveSoftViolations || 0}　跨年級同日分散：${quality.teacherCrossGradeSameDay || 0}　跨年級相鄰交錯：${quality.teacherCrossGradeAdjacent || 0}　科目關係同日：${quality.subjectRelationSoftViolations || 0}`;
  msg += '<br><br><b>總用時：' + elapsedText + '</b>';
  if (result.timedOut) {
    msg += `<br><br><span style="color:var(--warning);">⏱️ 已達排課時間預算 ${Math.round((result.timeBudgetMs || 0) / 1000)} 秒，系統保留目前最佳合法課表，未完成課程已列入診斷。</span>`;
  } else if (result.repairBudgetExceeded) {
    msg += '<br><br><span style="color:var(--warning);">⏱️ 增廣路徑修復已達局部時間預算，系統保留目前最佳合法課表，剩餘課程可再重跑。</span>';
  }
  msg += `<br><br>局部破壞重建：<b>${result.neighborhoodRepairMoves || 0}</b> 節移動`;
  if (bindFailureLessons.length > 0) {
    msg += `<br><br><span style="color:var(--danger);">⛔ 綁班前置關卡仍有 <b>${bindFailureLessons.length}</b> 節未完成；一般課程未用綁班課程的名額，請先處理綁班共同時段或教師／班級限制。</span>`;
  }
  if (bindDefinitionErrors.length > 0) {
    msg += `<br><br><span style="color:var(--danger);">⛔ 綁班資料前置檢查：${bindDefinitionErrors.map(esc).join('<br>')}</span>`;
  }
  if (quality.deficits.length > 0) {
    const detail = quality.deficits.slice(0, 12).map(item => esc(item.subjectCode) + '（' + esc(item.classCode) + '／' + esc(item.teacherCode) + '）×' + item.remaining).join('、');
    const more = quality.deficits.length > 12 ? `，另有 ${quality.deficits.length - 12} 筆` : '';
    const reasonDetail = failureReasonSummary ? `<br>未排原因分類：${esc(failureReasonSummary)}` : '';
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
  return result;
}

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
  if (!multiRestart) {
    if (!canUseSchedulerWorker()) return executeAutoScheduleCore();
    const uiPrep = await prepareAutoScheduleUiRun();
    if (!uiPrep) return;
    showLoading(true, '背景 Worker 智慧排課運算中…');
    try {
      const workerRes = await runSchedulerWorkerJob({ type: 'runSingle', config: uiPrep.config });
      return await applySingleAutoScheduleResultUi(workerRes.result);
    } catch (workerErr) {
      console.warn('[AutoSchedule] Worker 執行失敗，自動降級至主執行緒：', workerErr);
      return executeAutoScheduleCore({ skipPreflight: true, config: uiPrep.config });
    }
  }

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
  let candidates = [];
  const config = readAutoScheduleUiConfig();
  let usedWorker = false;
  if (canUseSchedulerWorker()) {
    closeAutoScheduleModal();
    showLoading(true, '多方案背景 Worker 探索中…');
    try {
      const workerRes = await runSchedulerWorkerJob({
        type: 'runMulti',
        config,
        runSpecs,
        timeBudgetMs: AUTO_MULTI_RESTART_TIME_BUDGET_MS
      });
      candidates = workerRes.candidates || [];
      usedWorker = true;
    } catch (workerErr) {
      console.warn('[AutoSchedule] 多方案 Worker 失敗，自動切換主執行緒：', workerErr);
    } finally {
      showLoading(false);
    }
  }
  if (!usedWorker) {
    const explorationStartedAt = Date.now();
    for (let index = 0; index < runSpecs.length; index++) {
      if (index > 0 && Date.now() - explorationStartedAt >= AUTO_MULTI_RESTART_TIME_BUDGET_MS) break;
      updateProgress('多方案探索：第 ' + (index + 1) + '/' + runSpecs.length + ' 個候選…');
      const result = await executeAutoScheduleCore({
        previewOnly: true,
        skipUiCommit: true,
        config,
        seed: runSpecs[index].seed,
        randomize: runSpecs[index].randomize
      });
      if (result) candidates.push({ ...result, seed: runSpecs[index].seed });
    }
  }

  const validCandidates = candidates.filter(candidate =>
    (!candidate.frozenViolations || candidate.frozenViolations.length === 0) && candidate.quality && candidate.quality.violations.length === 0
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
  bumpDataRevision();
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
      if (!res) { toast('雲端暫時無法連線，已保留目前課表', 'warning'); return; }
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
