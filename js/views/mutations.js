/* 樂觀排課異動引擎：手動衝突確認、單格寫入、交換、原子搬移、自動超鐘點與清除視窗 */

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
  if (typeof bumpDataRevision === 'function') bumpDataRevision();
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
  if (typeof bumpDataRevision === 'function') bumpDataRevision();
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
    if (typeof bumpDataRevision === 'function') bumpDataRevision();
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

  // 寫入目的（一般課程只移動來源這一班，保留課表 ID 與原子更新後端）
  const tListSrc = srcCell ? getCellTeacherList(srcCell) : [];
  const keptCellId = String(srcCell['課表ID'] || '').trim() || ('S_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4));
  const cellObj = {
      '課表ID': keptCellId,
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
  if (typeof bumpDataRevision === 'function') bumpDataRevision();
  renderClassSelect();
  if (ui.selectedClass) renderClassTT(ui.selectedClass);
  if (ui.selectedTeacher) renderTeacherTT(ui.selectedTeacher);
  toast('已移動課程', 'success');

  const tListForMove = srcCell ? getCellTeacherCodes(srcCell) : [];
  const moveTeacherPayload = tListForMove.length > 1 ? tListForMove : (tListForMove[0] || srcCell['教師姓名'] || '');
  gasPost('moveCell', {
    srcClassCode: srcCls, srcDay: srcD, srcPeriod: srcP, srcWeekType: srcP === 8 ? srcWeek : '',
    dstClassCode: dstCls, dstDay: dstD, dstPeriod: dstP, dstWeekType: dstP === 8 ? targetAttr : '',
    attr: targetAttr,
    teacherCode: moveTeacherPayload,
    isLocked: false,
    force
  })
    .then(moveRes => {
      if (moveRes && moveRes.ok) {
        applyScheduleRevisionResponse(moveRes);
        return;
      }
      // 向下相容舊版 Code.gs 尚未部署 moveCell 的過渡期
      if (moveRes && String(moveRes.error || '').includes('未知動作：moveCell')) {
        return gasPost('clearCell', { classCode: srcCls, day: srcD, period: srcP, weekType: srcP === 8 ? srcWeek : '' })
          .then(clearRes => {
            if (!clearRes || !clearRes.ok) {
              toast('移動來源清除失敗，請重新載入', 'warning');
              return null;
            }
            applyScheduleRevisionResponse(clearRes);
            return gasPost('updateCell', {
              classCode: dstCls, day: dstD, period: dstP,
              subjectCode, teacherCode: moveTeacherPayload,
              attr: targetAttr, weekType: dstP === 8 ? targetAttr : '',
              isLocked: false, force
            });
          })
          .then(updateRes => {
            if (updateRes) {
              if (!updateRes.ok) toast('移動目的地寫入失敗，請重新載入', 'warning');
              else applyScheduleRevisionResponse(updateRes);
            }
          });
      }
      toast('移動雲端寫入失敗，請重新載入', 'warning');
      if (typeof requestBackgroundReconcile === 'function') requestBackgroundReconcile();
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
  if (typeof bumpDataRevision === 'function') bumpDataRevision();
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
  if (typeof bumpDataRevision === 'function') bumpDataRevision();
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
    snapshotKeys: ['schedule'],
    applyLocal: () => {
      applyAutomaticOvertimeChangesLocal(changes);
      buildIndex();
      if (ui.selectedTeacher) renderTeacherTT(ui.selectedTeacher);
      if (typeof renderTeacherAssignmentView === 'function') renderTeacherAssignmentView();
    },
    gasTask: () => gasPost('batchSetOvertime', payload).then(async response => {
      if (response && response.ok !== false && !(response.data && response.data.scheduleRevision)) {
        await loadAll({ background: true });
      }
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
  if (typeof bumpDataRevision === 'function') bumpDataRevision();
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
  if (typeof bumpDataRevision === 'function') bumpDataRevision();
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
