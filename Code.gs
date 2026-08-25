/**
 * 排課系統 GAS 後端 (Code.gs)
 * 遵循 gas-standalone-builder 契約（frontend-db 分支）
 *
 * 工作表名稱與欄位全部繁體中文
 * 自動建表；系統設定工作表供管理員直接修改
 *
 * doPost payload: FormData { action, data(JSON) }
 * doGet  payload: ?action=sheetUrl | ping
 */

// ===================== 工作表定義 =====================

const GAS_VERSION = '20260824_v1208_schedule_exceptions';
const SCHEMA_VERSION = '20260824_bilingual_course_v4_schedule_exception';

// 所有會改動試算表的動作共用同一把 ScriptLock，避免多視窗或快速連點互相覆寫。
const LOCKED_WRITE_ACTIONS = new Set([
  'ensureSchema', 'updateCell', 'clearCell', 'swapCells', 'lockCell', 'setOvertime', 'batchSetOvertime',
  'saveMeta', 'renameTeacher', 'deleteMeta', 'saveTeacherBlock', 'saveSubjectRule',
  'saveSubjectRelation', 'saveTeacherExclusive', 'savePatrolSchedule',
  'saveScheduleException', 'initDatabase', 'batchUpdateSchedule'
]);

const SHEET_DEFS = {
  '班級': {
    headers: ['班級代碼', '年級', '班級名稱', '導師代碼', '班級類型', '是否虛擬班', '雙語課堂數'],
    key: '班級代碼'
  },
  '教師': {
    headers: ['教師姓名', 'Email', '任教科目', '職稱', '最大連堂節數', '基本鐘點', '減授原因'],
    key: '教師姓名'
  },
  '科目': {
    headers: ['科目代碼', '每週節數', '同時最多班數', '最多連日', '適用年級', '適用班級', '所屬教室代碼'],
    key: '科目代碼'
  },
  '配課': {
    headers: ['配課ID', '班級代碼', '科目代碼', '教師姓名', '課程屬性', '每週節數', '備註'],
    key: '配課ID'
  },
  '課表': {
    headers: ['課表ID', '班級代碼', '星期', '節次', '科目代碼', '教師姓名', '課堂屬性', '是否鎖定'],
    key: '課表ID'
  },
  '課表例外': {
    headers: ['例外ID', '學期代號', '事件名稱', '日期A', '星期A', '節次A', '日期B', '星期B', '節次B', '適用範圍', '是否啟用', '備註'],
    key: '例外ID'
  },
  '不排課': {
    headers: ['記錄ID', '教師姓名', '時段', '原因'],
    key: '記錄ID'
  },
  '科目規則': {
    headers: ['規則ID', '科目代碼', '適用年級', '適用班級', '時段', '規則類型', '備註'],
    key: '規則ID'
  },
  '科目關係': {
    headers: ['規則ID', '科目A', '科目B', '適用年級', '適用班級', '備註'],
    key: '規則ID'
  },
  '設定': {
    headers: ['設定項', '設定值'],
    key: '設定項'
  },
  '綁班': {
    headers: ['群組ID', '群組名稱', '科目清單', '班級清單'],
    key: '群組ID'
  },
  '教室': {
    headers: ['教室代碼', '教室名稱', '容量', '備註'],
    key: '教室代碼'
  },
  '配色': {
    headers: ['規則ID', '科目', '班級', '底色', '說明', '星期', '起始節次', '結束節次'],
    key: '規則ID'
  },
  '互斥': {
    headers: ['規則ID', '教師A', '教師B', '備註'],
    key: '規則ID'
  }
};

const SETTINGS_DEFAULTS = [
  ['學校名稱', '建成國中'],
  ['學期代號', '114-1'],
  ['每日節數', '8'],
  ['AdminPassword', ''],
];

// ===================== 路由 =====================

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'sheetUrl') {
    return jsonOut_({ ok: true, url: SpreadsheetApp.getActiveSpreadsheet().getUrl() });
  }
  return jsonOut_({ ok: true, action: action || 'ping', gasVersion: GAS_VERSION, schemaVersion: SCHEMA_VERSION });
}

function doPost(e) {
  let lock = null;
  let lockHeld = false;
  let requestId = '';
  try {
    const params = (e && e.parameter) || {};
    const action = params.action || '';
    const parsedPayload = params.data ? JSON.parse(params.data) : {};
    const payload = parsedPayload && typeof parsedPayload === 'object' ? parsedPayload : {};
    requestId = normalizeWriteRequestId_(payload && payload.__requestId);
    const requiresLock = LOCKED_WRITE_ACTIONS.has(action);

    // 重試請求先讀取結果快取，避免第一次已成功但回應逾時時重複寫入。
    if (requiresLock && requestId) {
      const cached = getCachedWriteResponse_(requestId);
      if (cached) return jsonOut_(cached);
    }

    if (requiresLock && typeof LockService !== 'undefined') {
      lock = LockService.getScriptLock();
      if (!lock.tryLock(45000)) {
        return jsonOut_({
          ok: false,
          blocked: true,
          retryable: true,
          error: '目前有另一個課表寫入作業進行中，系統將自動重試，請稍候'
        });
      }
      lockHeld = true;
      payload.__lockAlreadyHeld = true;
      // 等待鎖的期間可能已有相同請求完成，再檢查一次快取。
      if (requestId) {
        const cachedAfterLock = getCachedWriteResponse_(requestId);
        if (cachedAfterLock) return jsonOut_(cachedAfterLock);
      }
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (action !== 'getAll' && action !== 'ensureSchema') ensureAllSheetsCached_(ss);

    let result;
    switch (action) {
      case 'getAll':            result = getAll_(ss); break;
      case 'ensureSchema': {
        const schemaInfo = ensureAllSheetsCached_(ss) || {};
        result = Object.assign({ schemaVersion: SCHEMA_VERSION }, schemaInfo);
        break;
      }
      case 'updateCell':        result = updateCell_(ss, payload); break;
      case 'clearCell':         result = clearCell_(ss, payload); break;
      case 'swapCells':         result = swapCells_(ss, payload); break;
      case 'lockCell':          result = lockCell_(ss, payload); break;
      case 'setOvertime':       result = setOvertime_(ss, payload); break;
      case 'batchSetOvertime':  result = batchSetOvertime_(ss, payload); break;
      case 'saveMeta':          result = saveMeta_(ss, payload); break;
      case 'renameTeacher':      result = renameTeacher_(ss, payload); break;
      case 'deleteMeta':        result = deleteMeta_(ss, payload); break;
      case 'saveTeacherBlock':  result = saveTeacherBlock_(ss, payload); break;
      case 'saveSubjectRule':   result = saveSubjectRule_(ss, payload); break;
      case 'saveSubjectRelation': result = saveSubjectRelation_(ss, payload); break;
      case 'saveTeacherExclusive': result = saveTeacherExclusive_(ss, payload); break;
      case 'saveScheduleException': result = saveScheduleException_(ss, payload); break;
      case 'exportSchedule':    result = exportSchedule_(ss); break;
      case 'exportPatrolSchedule': result = exportPatrolSchedule_(ss); break;
      case 'exportScheduleExceptions': result = exportScheduleExceptions_(ss); break;
      case 'savePatrolSchedule': result = savePatrolSchedule_(ss, payload); break;
      case 'exportTeachers':    result = exportTeachers_(ss); break;
      case 'initDatabase':      result = initDefaultData_(ss, payload.overwrite); break;
      case 'validateScheduleSnapshot': result = validateScheduleSnapshotAction_(ss, payload); break;
      case 'batchUpdateSchedule': result = batchUpdateSchedule_(ss, payload); break;
      case 'verifyAdmin':       result = verifyAdmin_(payload.password || ''); break;
      default:
        return jsonOut_({ ok: false, error: '未知動作：' + action });
    }
    const response = result && result.blocked
      ? { ok: false, blocked: true, error: result.error || '凍結課程完整性檢查失敗', data: result }
      : result && result.ok === false
        ? { ok: false, error: result.error || '試算表寫入未完成', data: result }
        : { ok: true, data: result };
    if (requiresLock && requestId && !response.retryable) cacheWriteResponse_(requestId, response);
    return jsonOut_(response);
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err.message || err) });
  } finally {
    if (lockHeld && lock) lock.releaseLock();
  }
}

function normalizeWriteRequestId_(value) {
  const id = String(value == null ? '' : value).trim();
  return /^[A-Za-z0-9_.:-]{1,120}$/.test(id) ? id : '';
}

function writeResponseCacheKey_(requestId) {
  const id = normalizeWriteRequestId_(requestId);
  return id ? 'write-response-v1-' + id : '';
}

function getCachedWriteResponse_(requestId) {
  const key = writeResponseCacheKey_(requestId);
  if (!key || typeof CacheService === 'undefined') return null;
  try {
    const raw = CacheService.getScriptCache().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function cacheWriteResponse_(requestId, response) {
  const key = writeResponseCacheKey_(requestId);
  if (!key || typeof CacheService === 'undefined') return;
  try {
    const raw = JSON.stringify(response);
    // Apps Script CacheService 單筆上限約 100 KB，過大的批次結果不快取。
    if (raw.length <= 90000) CacheService.getScriptCache().put(key, raw, 21600);
  } catch (err) {
    // 快取失敗不應影響已完成的試算表寫入。
  }
}

// ===================== 初始化 =====================

function protectSubjectTextColumns_(sheet) {
  if (!sheet) return;
  sheet.getRange('A:A').setNumberFormat('@');
  sheet.getRange('E:G').setNumberFormat('@');
}
function protectScheduleColorTextColumns_(sheet) {
  if (!sheet) return;
  sheet.getRange('A:C').setNumberFormat('@');
  sheet.getRange('F:H').setNumberFormat('@');
}

function ensureSubjectRuleSchema_(sheet) {
  if (!sheet || sheet.getLastRow() < 1 || sheet.getLastColumn() < 1) return;
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  const desiredHeaders = SHEET_DEFS['科目規則'].headers;
  const values = sheet.getRange(1, 1, lastRow, lastColumn).getDisplayValues();
  const headers = values[0].map(value => String(value || '').trim());
  const isCanonical = lastColumn === desiredHeaders.length &&
    desiredHeaders.every((header, index) => headers[index] === header);
  if (isCanonical) return;

  // 兼容曾經出現過的中間版本：欄名重複、時段欄被推到右側，或年級欄仍叫「年級」。
  const text = value => String(value == null ? '' : value).trim();
  const splitTokens = value => text(value).split(/[,，、;；\s]+/).map(item => item.trim()).filter(Boolean);
  const isTimeToken = value => /(?:[1-5]\s*[-_/.:]\s*[1-8])|(?:週|星期)?[一二三四五][^\d]{0,4}[1-8]\s*節?/.test(text(value));
  const isTimeValue = value => splitTokens(value).some(isTimeToken);
  const firstHeader = names => {
    for (const name of names) {
      const index = headers.indexOf(name);
      if (index >= 0) return index;
    }
    return -1;
  };
  const classColumns = headers.reduce((list, header, index) => {
    if (header === '適用班級') list.push(index);
    return list;
  }, []);
  const classScore = index => {
    let score = index === 3 ? 1 : 0;
    for (let row = 1; row < values.length; row++) {
      const cell = text(values[row][index]);
      if (!cell) continue;
      score += isTimeValue(cell) ? -20 : 10;
    }
    return score;
  };
  const usableClassColumns = classColumns.filter(index => classScore(index) > 0);
  const selectedClassColumn = [...classColumns].sort((a, b) => classScore(b) - classScore(a) || a - b)[0];
  const classColumnsToMerge = usableClassColumns.length > 0
    ? usableClassColumns
    : (selectedClassColumn === undefined ? [] : [selectedClassColumn]);

  // 只排除實際採用的班級欄；重複的「適用班級」欄可能其實承載了錯位的時段資料。
  const timeCandidates = headers.map((_, index) => index).filter(index => !classColumnsToMerge.includes(index));
  const timeScore = index => {
    let score = headers[index] === '時段' ? 4 : 0;
    for (let row = 1; row < values.length; row++) {
      const cell = text(values[row][index]);
      if (!cell) continue;
      score += isTimeValue(cell) ? 20 : -2;
    }
    return score;
  };
  const timeColumn = [...timeCandidates].sort((a, b) => timeScore(b) - timeScore(a) || a - b)[0];
  const idColumn = firstHeader(['規則ID']) >= 0 ? firstHeader(['規則ID']) : 0;
  const subjectColumn = firstHeader(['科目代碼']) >= 0 ? firstHeader(['科目代碼']) : 1;
  const gradeColumn = firstHeader(['適用年級', '年級']) >= 0 ? firstHeader(['適用年級', '年級']) : 2;
  const typeColumn = firstHeader(['規則類型']) >= 0 ? firstHeader(['規則類型']) : 5;
  const noteColumn = firstHeader(['備註']) >= 0 ? firstHeader(['備註']) : 6;
  const getCell = (row, column) => column >= 0 && column < row.length ? text(row[column]) : '';
  const mergedClassValue = row => {
    const classValues = [];
    classColumnsToMerge.forEach(column => {
      splitTokens(getCell(row, column)).forEach(value => {
        if (!classValues.includes(value)) classValues.push(value);
      });
    });
    return classValues.join(',');
  };

  const normalizedValues = [desiredHeaders];
  for (let rowIndex = 1; rowIndex < values.length; rowIndex++) {
    const row = values[rowIndex];
    normalizedValues.push([
      getCell(row, idColumn),
      getCell(row, subjectColumn),
      getCell(row, gradeColumn),
      mergedClassValue(row),
      getCell(row, timeColumn === undefined ? 4 : timeColumn),
      getCell(row, typeColumn),
      getCell(row, noteColumn)
    ]);
  }

  // 先完成資料欄位對應，再移除多出的欄，避免重複「適用班級」欄造成錯位。
  if (lastColumn > desiredHeaders.length) {
    sheet.deleteColumns(desiredHeaders.length + 1, lastColumn - desiredHeaders.length);
  } else if (lastColumn < desiredHeaders.length) {
    sheet.insertColumnsAfter(lastColumn, desiredHeaders.length - lastColumn);
  }
  sheet.getRange(1, 1, normalizedValues.length, desiredHeaders.length).setValues(normalizedValues);
  sheet.getRange(1, 1, 1, desiredHeaders.length).setFontWeight('bold').setBackground('#EBF5FB');
  sheet.setFrozenRows(1);
}

function ensureTeacherSchema_(sheet) {
  if (!sheet || sheet.getLastRow() < 1 || sheet.getLastColumn() < 1) return;
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  const desiredHeaders = SHEET_DEFS['教師'].headers;
  const values = sheet.getRange(1, 1, lastRow, lastColumn).getDisplayValues();
  const headers = values[0].map(value => String(value || '').trim());
  const columnByHeader = Object.create(null);
  headers.forEach((header, index) => {
    if (header && columnByHeader[header] === undefined) columnByHeader[header] = index;
  });
  const getCell = (row, header) => {
    const column = columnByHeader[header];
    return column === undefined ? '' : String(row[column] == null ? '' : row[column]);
  };
  const normalizedValues = [desiredHeaders];
  for (let rowIndex = 1; rowIndex < values.length; rowIndex++) {
    normalizedValues.push(desiredHeaders.map(header => getCell(values[rowIndex], header)));
  }

  if (lastColumn > desiredHeaders.length) {
    sheet.deleteColumns(desiredHeaders.length + 1, lastColumn - desiredHeaders.length);
  } else if (lastColumn < desiredHeaders.length) {
    sheet.insertColumnsAfter(lastColumn, desiredHeaders.length - lastColumn);
  }
  sheet.getRange(1, 1, normalizedValues.length, desiredHeaders.length).setValues(normalizedValues);
  sheet.getRange(1, 1, 1, desiredHeaders.length).setFontWeight('bold').setBackground('#EBF5FB');
  sheet.setFrozenRows(1);
}

function ensureClassSchema_(sheet) {
  if (!sheet || sheet.getLastRow() < 1 || sheet.getLastColumn() < 1) return;
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  const desiredHeaders = SHEET_DEFS['班級'].headers;
  const values = sheet.getRange(1, 1, lastRow, lastColumn).getDisplayValues();
  const headers = values[0].map(value => String(value || '').trim());
  const findHeader = names => {
    for (const name of names) {
      const index = headers.indexOf(name);
      if (index >= 0) return index;
    }
    return -1;
  };
  const text = value => String(value == null ? '' : value).trim();
  const getCell = (row, column, fallback) => column >= 0 && column < row.length ? text(row[column]) : (fallback || '');
  const codeColumn = findHeader(['班級代碼']) >= 0 ? findHeader(['班級代碼']) : 0;
  const gradeColumn = findHeader(['年級']) >= 0 ? findHeader(['年級']) : 1;
  const nameColumn = findHeader(['班級名稱']) >= 0 ? findHeader(['班級名稱']) : 2;
  const homeroomColumn = findHeader(['導師代碼']);
  const typeColumn = findHeader(['班級類型']);
  const bilingualColumn = findHeader(['雙語課堂數', '雙語課程節數']);
  let virtualColumn = findHeader(['是否虛擬班']);

  // 舊版班級表可能把 TRUE／FALSE 放在最後一欄，但標題已經遺失。
  const booleanColumns = headers.map((header, index) => {
    let score = 0;
    for (let rowIndex = 1; rowIndex < values.length; rowIndex++) {
      if (/^(TRUE|FALSE|是|否)$/i.test(text(values[rowIndex][index]))) score++;
    }
    return { index, score };
  }).filter(item => item.score > 0);
  const virtualHasValue = virtualColumn >= 0 && values.slice(1).some(row => getCell(row, virtualColumn));
  if (virtualColumn < 0 || !virtualHasValue) {
    const inferred = booleanColumns.sort((a, b) => b.score - a.score || b.index - a.index)[0];
    if (inferred) virtualColumn = inferred.index;
  }

  const normalizedValues = [desiredHeaders];
  for (let rowIndex = 1; rowIndex < values.length; rowIndex++) {
    const row = values[rowIndex];
    normalizedValues.push([
      getCell(row, codeColumn),
      getCell(row, gradeColumn),
      getCell(row, nameColumn),
      getCell(row, homeroomColumn),
      getCell(row, typeColumn, getCell(row, virtualColumn).toUpperCase() === 'TRUE' ? '虛擬' : '一般'),
      getCell(row, virtualColumn),
      getCell(row, bilingualColumn)
    ]);
  }

  if (lastColumn > desiredHeaders.length) {
    sheet.deleteColumns(desiredHeaders.length + 1, lastColumn - desiredHeaders.length);
  } else if (lastColumn < desiredHeaders.length) {
    sheet.insertColumnsAfter(Math.max(1, lastColumn), desiredHeaders.length - lastColumn);
  }
  sheet.getRange(1, 1, normalizedValues.length, desiredHeaders.length).setValues(normalizedValues);
  sheet.getRange(1, 1, 1, desiredHeaders.length).setFontWeight('bold').setBackground('#EBF5FB');
  sheet.setFrozenRows(1);
}

function ensureNamedSchema_(sheet, sheetName) {
  if (!sheet || sheet.getLastRow() < 1 || sheet.getLastColumn() < 1) return;
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  const desiredHeaders = SHEET_DEFS[sheetName].headers;
  const values = sheet.getRange(1, 1, lastRow, lastColumn).getDisplayValues();
  const headers = values[0].map(value => String(value || '').trim());
  const columnByHeader = Object.create(null);
  headers.forEach((header, index) => {
    if (header && columnByHeader[header] === undefined) columnByHeader[header] = index;
  });
  const normalizedValues = [desiredHeaders];
  for (let rowIndex = 1; rowIndex < values.length; rowIndex++) {
    const row = values[rowIndex];
    normalizedValues.push(desiredHeaders.map(header => {
      const column = columnByHeader[header];
      return column === undefined ? '' : String(row[column] == null ? '' : row[column]);
    }));
  }

  if (lastColumn > desiredHeaders.length) {
    sheet.deleteColumns(desiredHeaders.length + 1, lastColumn - desiredHeaders.length);
  } else if (lastColumn < desiredHeaders.length) {
    sheet.insertColumnsAfter(Math.max(1, lastColumn), desiredHeaders.length - lastColumn);
  }
  sheet.getRange(1, 1, normalizedValues.length, desiredHeaders.length).setValues(normalizedValues);
  sheet.getRange(1, 1, 1, desiredHeaders.length).setFontWeight('bold').setBackground('#EBF5FB');
  sheet.setFrozenRows(1);
}

function ensureAssignmentSchema_(sheet) {
  ensureNamedSchema_(sheet, '配課');
}

function ensureScheduleSchema_(sheet) {
  ensureNamedSchema_(sheet, '課表');
}

function ensureScheduleExceptionSchema_(sheet) {
  ensureNamedSchema_(sheet, '課表例外');
  if (sheet) sheet.getRange('A:L').setNumberFormat('@');
}

function ensureAllSheets_(ss) {
  Object.entries(SHEET_DEFS).forEach(([name, def]) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    let lr = sh.getLastRow();
    let lc = sh.getLastColumn();
    const firstCell = lr > 0 && lc > 0 ? sh.getRange(1, 1).getValue() : '';
    if (!firstCell) {
      sh.getRange(1, 1, 1, def.headers.length)
        .setValues([def.headers])
        .setFontWeight('bold')
        .setBackground('#EBF5FB');
      sh.setFrozenRows(1);
    } else {
      if (name === '教師') {
        ensureTeacherSchema_(sh);
        return;
      }
      if (name === '班級') {
        ensureClassSchema_(sh);
        return;
      }
      if (name === '配課') {
        ensureAssignmentSchema_(sh);
        return;
      }
      if (name === '課表') {
        ensureScheduleSchema_(sh);
        return;
      }
      if (name === '課表例外') {
        ensureScheduleExceptionSchema_(sh);
        return;
      }
      if (name === '科目規則') ensureSubjectRuleSchema_(sh);
      lr = sh.getLastRow();
      lc = sh.getLastColumn();
      // 確保標題列涵蓋所有最新欄位
      const curHeaders = sh.getRange(1, 1, 1, lc).getValues()[0].map(String);
      if (curHeaders.length < def.headers.length) {
        sh.getRange(1, 1, 1, def.headers.length)
          .setValues([def.headers])
          .setFontWeight('bold')
          .setBackground('#EBF5FB');
      }
    }
  });

  // 確保「科目時段規則」與「教師不排課」的時段欄位為純文字格式
  // 科目代碼、適用年級、適用班級與教室代碼一律以文字保存，避免 Google Sheets 轉成數字或科學記號。
  protectSubjectTextColumns_(ss.getSheetByName('科目'));
  protectScheduleColorTextColumns_(ss.getSheetByName('配色'));
  const ruleSh = ss.getSheetByName('科目規則');
  if (ruleSh) {
    ruleSh.getRange('B:D').setNumberFormat('@');
    ruleSh.getRange('E:E').setNumberFormat('@');
  }
  const tBlockSh = ss.getSheetByName('不排課');
  if (tBlockSh) {
    tBlockSh.getRange('C:C').setNumberFormat('@');
    tBlockSh.getRange('D:D').setNumberFormat('@');
  }
  const relationSh = ss.getSheetByName('科目關係');
  if (relationSh) relationSh.getRange('A:F').setNumberFormat('@');
  const exceptionSh = ss.getSheetByName('課表例外');
  if (exceptionSh) exceptionSh.getRange('A:L').setNumberFormat('@');

  // 系統設定預設值
  const settingSh = ss.getSheetByName('設定');
  const existing = sheetToObjects_(settingSh);
  const existKeys = new Set(existing.map(r => r['設定項']));
  SETTINGS_DEFAULTS.forEach(([k, v]) => {
    if (!existKeys.has(k)) settingSh.appendRow([k, v]);
  });
}

// ===================== 資料讀取 =====================

function ensureAllSheetsCached_(ss) {
  const cache = CacheService.getScriptCache();
  const key = 'schema-' + SCHEMA_VERSION + '-' + ss.getId();
  if (cache.get(key)) return {};
  ensureAllSheets_(ss);
  // schema 版本已寫入 key，避免每 5 分鐘重跑整批工作表檢查拖慢載入。
  cache.put(key, '1', 21600);
  return {};
}

function sheetToObjects_(sheet) {
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const nc = Math.max(sheet.getLastColumn(), 1);
  const vals = sheet.getRange(1, 1, lastRow, nc).getDisplayValues();
  const headers = vals[0];
  const hLen = headers.length;
  const out = [];
  for (let r = 1; r < vals.length; r++) {
    const row = vals[r];
    const obj = {};
    let hasVal = false;
    for (let i = 0; i < hLen; i++) {
      const h = headers[i];
      if (h === '' || h == null) continue;
      const v = row[i];
      if (v !== '' && v !== null && v !== undefined) hasVal = true;
      obj[String(h)] = v;
    }
    if (hasVal) out.push(obj);
  }
  return out;
}

function scheduleRevision_(rows) {
  const normalized = (rows || []).map(row => JSON.stringify([
    String(row['課表ID'] || ''), String(row['班級代碼'] || ''), String(row['星期'] || ''),
    String(row['節次'] || ''), String(row['科目代碼'] || ''), String(row['教師姓名'] || ''),
    String(row['課堂屬性'] || ''), String(row['是否鎖定'] || '')
  ])).sort();
  const text = normalized.join('');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
  return String(hash >>> 0);
}

function getSettingsMap_(ss) {
  const settings = {};
  sheetToObjects_(ss.getSheetByName('設定')).forEach(r => {
    settings[r['設定項']] = r['設定值'];
  });
  return settings;
}

function getAll_(ss) {
  const schedule = sheetToObjects_(ss.getSheetByName('課表'));
  return {
    gasVersion:          GAS_VERSION,
    schemaVersion:       SCHEMA_VERSION,
    classes:            sheetToObjects_(ss.getSheetByName('班級')),
    teachers:           sheetToObjects_(ss.getSheetByName('教師')),
    subjects:           sheetToObjects_(ss.getSheetByName('科目')),
    assignments:        sheetToObjects_(ss.getSheetByName('配課')),
    schedule,
    scheduleRevision:   scheduleRevision_(schedule),
    teacherBlocks:      sheetToObjects_(ss.getSheetByName('不排課')),
    subjectRules:       sheetToObjects_(ss.getSheetByName('科目規則')),
    subjectRelations:   sheetToObjects_(ss.getSheetByName('科目關係')),
    blockGroups:        sheetToObjects_(ss.getSheetByName('綁班')),
    rooms:              sheetToObjects_(ss.getSheetByName('教室')),
    scheduleColors:     sheetToObjects_(ss.getSheetByName('配色')),
    teacherExclusives:  sheetToObjects_(ss.getSheetByName('互斥')),
    scheduleExceptions: sheetToObjects_(ss.getSheetByName('課表例外')),
    settings:           getSettingsMap_(ss)
  };
}

// ===================== 課表日期例外 =====================

function scheduleExceptionTruthy_(value) {
  const text = String(value == null ? '' : value).trim().toUpperCase();
  return value === true || text === 'TRUE' || text === '1' || text === 'YES' || text === 'Y' || text === '是';
}

function scheduleExceptionDateInfo_(value) {
  const raw = String(value == null ? '' : value).trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const weekday = date.getUTCDay();
  return { date: raw, weekday };
}

function scheduleExceptionPayloadValue_(payload, names, fallback) {
  const source = payload && typeof payload === 'object' ? payload : {};
  for (let i = 0; i < names.length; i++) {
    if (source[names[i]] !== undefined && source[names[i]] !== null) return source[names[i]];
  }
  return fallback;
}

function normalizeScheduleExceptionRecord_(payload) {
  const source = payload && payload.record && typeof payload.record === 'object' ? payload.record : payload;
  const id = String(scheduleExceptionPayloadValue_(source, ['例外ID', 'id'], '') || '').trim() || genId_();
  const semester = String(scheduleExceptionPayloadValue_(source, ['學期代號', 'semester'], '') || '').trim();
  const eventName = String(scheduleExceptionPayloadValue_(source, ['事件名稱', 'eventName'], '') || '').trim();
  const dateA = scheduleExceptionDateInfo_(scheduleExceptionPayloadValue_(source, ['日期A', 'dateA'], ''));
  const dateB = scheduleExceptionDateInfo_(scheduleExceptionPayloadValue_(source, ['日期B', 'dateB'], ''));
  const dayA = parseInt(scheduleExceptionPayloadValue_(source, ['星期A', 'dayA'], ''), 10);
  const dayB = parseInt(scheduleExceptionPayloadValue_(source, ['星期B', 'dayB'], ''), 10);
  const periodA = parseInt(scheduleExceptionPayloadValue_(source, ['節次A', 'periodA'], ''), 10);
  const periodB = parseInt(scheduleExceptionPayloadValue_(source, ['節次B', 'periodB'], ''), 10);
  const scope = String(scheduleExceptionPayloadValue_(source, ['適用範圍', 'scope'], '全校') || '全校').trim() || '全校';
  const enabled = scheduleExceptionTruthy_(scheduleExceptionPayloadValue_(source, ['是否啟用', 'enabled'], true));
  const remark = String(scheduleExceptionPayloadValue_(source, ['備註', 'remark'], '') || '').trim();

  if (!semester) return { ok: false, error: '學期代號不能空白' };
  if (!eventName) return { ok: false, error: '事件名稱不能空白' };
  if (!dateA || !dateB) return { ok: false, error: '日期格式必須是 YYYY-MM-DD' };
  if (dateA.weekday < 1 || dateA.weekday > 5 || dateB.weekday < 1 || dateB.weekday > 5) {
    return { ok: false, error: '日期例外目前只支援星期一至星期五' };
  }
  if (!Number.isInteger(dayA) || dayA < 1 || dayA > 5 || dayA !== dateA.weekday) {
    return { ok: false, error: '日期 A 的星期與實際日期不一致' };
  }
  if (!Number.isInteger(dayB) || dayB < 1 || dayB > 5 || dayB !== dateB.weekday) {
    return { ok: false, error: '日期 B 的星期與實際日期不一致' };
  }
  const validPeriod = period => period === 0 || period === 45 || (period >= 1 && period <= 8);
  if (!Number.isInteger(periodA) || !validPeriod(periodA) || !Number.isInteger(periodB) || !validPeriod(periodB)) {
    return { ok: false, error: '時段目前只支援早自習、午休或第 1 節至第 8 節' };
  }
  if (dateA.date === dateB.date && periodA === periodB) return { ok: false, error: '兩個對調端點不可相同' };
  if (scope !== '全校') return { ok: false, error: '目前只支援全校適用範圍' };

  return {
    ok: true,
    record: {
      '例外ID': id,
      '學期代號': semester,
      '事件名稱': eventName,
      '日期A': dateA.date,
      '星期A': String(dayA),
      '節次A': String(periodA),
      '日期B': dateB.date,
      '星期B': String(dayB),
      '節次B': String(periodB),
      '適用範圍': scope,
      '是否啟用': enabled ? 'TRUE' : 'FALSE',
      '備註': remark
    }
  };
}

function scheduleExceptionMappings_(record) {
  if (!record) return [];
  return [
    {
      '例外ID': String(record['例外ID'] || ''),
      '事件名稱': String(record['事件名稱'] || ''),
      '實際日期': String(record['日期A'] || ''),
      '實際星期': String(record['星期A'] || ''),
      '實際節次': String(record['節次A'] || ''),
      '來源星期': String(record['星期B'] || ''),
      '來源節次': String(record['節次B'] || ''),
      '是否啟用': String(record['是否啟用'] || 'FALSE')
    },
    {
      '例外ID': String(record['例外ID'] || ''),
      '事件名稱': String(record['事件名稱'] || ''),
      '實際日期': String(record['日期B'] || ''),
      '實際星期': String(record['星期B'] || ''),
      '實際節次': String(record['節次B'] || ''),
      '來源星期': String(record['星期A'] || ''),
      '來源節次': String(record['節次A'] || ''),
      '是否啟用': String(record['是否啟用'] || 'FALSE')
    }
  ];
}

function scheduleExceptionSlotKey_(date, period) {
  return String(date || '').trim() + '|' + String(period || '').trim();
}

function saveScheduleException_(ss, payload) {
  const sheet = ss.getSheetByName('課表例外');
  if (!sheet) return { ok: false, error: '找不到「課表例外」工作表' };
  const source = payload && payload.record && typeof payload.record === 'object' ? payload.record : payload;
  const settings = getSettingsMap_(ss);
  const withSemester = Object.assign({}, source || {});
  if (!String(withSemester['學期代號'] || withSemester.semester || '').trim()) {
    withSemester['學期代號'] = settings['學期代號'] || '未設定';
  }
  const normalized = normalizeScheduleExceptionRecord_(withSemester);
  if (!normalized.ok) return normalized;

  const record = normalized.record;
  const currentRows = sheetToObjects_(sheet);
  const rowNumber = findDataRowByKey_(sheet, SHEET_DEFS['課表例外'], record['例外ID']);
  const newSlots = new Set(scheduleExceptionMappings_(record).map(item =>
    scheduleExceptionSlotKey_(item['實際日期'], item['實際節次'])
  ));
  if (record['是否啟用'] === 'TRUE') {
    const duplicate = currentRows.find(row => {
      if (String(row['例外ID'] || '').trim() === record['例外ID']) return false;
      if (!scheduleExceptionTruthy_(row['是否啟用'])) return false;
      return scheduleExceptionMappings_(row).some(item => newSlots.has(
        scheduleExceptionSlotKey_(item['實際日期'], item['實際節次'])
      ));
    });
    if (duplicate) return { ok: false, error: '指定日期與節次已被其他啟用中的課表例外占用：' + String(duplicate['事件名稱'] || duplicate['例外ID']) };
  }

  const values = SHEET_DEFS['課表例外'].headers.map(header => numericStringToText_(record[header]));
  if (rowNumber) sheet.getRange(rowNumber, 1, 1, values.length).setValues([values]);
  else sheet.appendRow(values);
  return {
    ok: true,
    record,
    mappings: scheduleExceptionMappings_(record),
    updated: Boolean(rowNumber)
  };
}

// ===================== 互斥 CRUD =====================

function saveTeacherExclusive_(ss, payload) {
  const sheet = ss.getSheetByName('互斥');
  const headers = SHEET_DEFS['互斥'].headers;
  if (!sheet) return { ok: false, error: '找不到「互斥」工作表' };
  const rows = sheetToObjects_(sheet);

  if (payload.delete) {
    const id = String(payload.id || '');
    const allVals = sheet.getDataRange().getValues();
    for (let i = allVals.length - 1; i >= 1; i--) {
      if (String(allVals[i][0]) === id) sheet.deleteRow(i + 1);
    }
    return { ok: true };
  }

  const id = String(payload.id || ('EX' + Date.now()));
  const tA = String(payload.teacherA || '').trim();
  const tB = String(payload.teacherB || '').trim();
  const remark = String(payload.remark || '').trim();
  if (!tA || !tB) return { ok: false, error: '教師代碼不可為空' };

  const dup = rows.find(r =>
    (String(r['教師A']) === tA && String(r['教師B']) === tB) ||
    (String(r['教師A']) === tB && String(r['教師B']) === tA)
  );
  if (dup) return { ok: false, error: '此組合已存在' };

  const row = [id, tA, tB, remark];
  sheet.appendRow(row);
  const newObj = {};
  headers.forEach((h, i) => { newObj[h] = row[i]; });
  return { ok: true, record: newObj };
}

// ===================== 衝突檢查 =====================

function splitSubjectRuleList_(value) {
  if (Array.isArray(value)) {
    return value.map(item => String(item || '').trim()).filter(Boolean);
  }
  return String(value == null ? '' : value)
    .split(/[,，、;；]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeSubjectRuleList_(value) {
  return Array.from(new Set(splitSubjectRuleList_(value)));
}

function sameSubjectRuleList_(left, right) {
  const a = normalizeSubjectRuleList_(left).sort();
  const b = normalizeSubjectRuleList_(right).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function schedulePeriodValue_(entry) {
  if (!entry) return NaN;
  const raw = entry['節次'] !== undefined ? entry['節次'] : entry.period;
  return parseInt(raw, 10);
}

function scheduleAttributeValue_(entry) {
  if (!entry) return '';
  const raw = entry['課堂屬性'] !== undefined ? entry['課堂屬性'] : entry.attr;
  return String(raw == null ? '' : raw).trim();
}

function weeklyNumber_(value, fallback) {
  const raw = String(value == null ? '' : value).trim().replace(',', '.');
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isAlternateWeeklyValue_(value) {
  return Math.abs(weeklyNumber_(value, 0) - 0.5) < 0.000001;
}

function isValidWeeklyValue_(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return true;
  const parsed = weeklyNumber_(raw, NaN);
  return Number.isFinite(parsed) && (isAlternateWeeklyValue_(parsed) || (Number.isInteger(parsed) && parsed >= 1 && parsed <= 20));
}

function assignmentWeeklyValue_(assignment, subjectByCode) {
  const custom = weeklyNumber_(assignment && assignment['每週節數'], 0);
  if (custom > 0) return custom;
  const subjectCode = String(assignment && assignment['科目代碼'] || '').trim();
  return weeklyNumber_(subjectByCode && subjectByCode[subjectCode] && subjectByCode[subjectCode]['每週節數'], 3);
}

function assignmentIsAlternateWeek_(assignment, subjectByCode) {
  return isAlternateWeeklyValue_(assignmentWeeklyValue_(assignment, subjectByCode));
}

function scheduleMatchesAssignment_(row, assignment) {
  if (!row || !assignment ||
      String(row['班級代碼'] || '').trim() !== String(assignment['班級代碼'] || '').trim() ||
      String(row['科目代碼'] || '').trim() !== String(assignment['科目代碼'] || '').trim()) return false;
  const rowTeachers = teacherCodesFromValue_(row['教師姓名']);
  const assignmentTeachers = teacherCodesFromValue_(assignment['教師姓名']);
  return assignmentTeachers.length === 0 || assignmentTeachers.some(code => rowTeachers.indexOf(code) >= 0);
}

function isAlternateWeekPair_(left, right) {
  if (schedulePeriodValue_(left) !== 8 || schedulePeriodValue_(right) !== 8) return false;
  const leftAttr = scheduleAttributeValue_(left);
  const rightAttr = scheduleAttributeValue_(right);
  return (leftAttr === '單週' && rightAttr === '雙週') ||
    (leftAttr === '雙週' && rightAttr === '單週');
}

function hasOverlappingSchedulePair_(itemsA, itemsB) {
  const sameCollection = itemsA === itemsB;
  return (itemsA || []).some(left => (itemsB || []).some(right =>
    (!sameCollection || left !== right) &&
    !isAlternateWeekPair_(left && left.row ? left.row : left, right && right.row ? right.row : right)
  ));
}

function subjectRuleMatches_(rule, subjectCode, classCode, classes) {
  const wantedSubject = String(subjectCode || '').trim();
  const wantedClass = String(classCode || '').trim();
  if (!wantedSubject || !normalizeSubjectRuleList_(rule && rule['科目代碼']).includes(wantedSubject)) return false;

  const classRow = (classes || []).find(item => String(item['班級代碼'] || '').trim() === wantedClass);
  const grade = classRow
    ? String(classRow['年級'] || wantedClass.charAt(0)).trim()
    : wantedClass.charAt(0);
  const ruleGrade = String(rule && rule['適用年級'] || '全校').trim();
  if (ruleGrade !== '' && ruleGrade !== '全校' && ruleGrade !== grade) return false;

  const classCodes = normalizeSubjectRuleList_(rule && rule['適用班級']);
  return classCodes.length === 0 || classCodes.includes(wantedClass);
}

/**
 * 衝突檢查。可傳 preloaded 避免每次整表重讀。
 * preloaded: { schedule, subjects, teacherBlocks, subjectRules, teacherExclusives }
 */
function checkConflicts_(ss, p, excludeId, preloaded) {
  const dayN = parseInt(p.day, 10);
  const periodN = parseInt(p.period, 10);
  const data = preloaded || {};
  const schedule = data.schedule || sheetToObjects_(ss.getSheetByName('課表'));
  const subjects = data.subjects || sheetToObjects_(ss.getSheetByName('科目'));
  const classes = data.classes || sheetToObjects_(ss.getSheetByName('班級'));
  const teacherBlocks = data.teacherBlocks || sheetToObjects_(ss.getSheetByName('不排課'));
  const subjectRules = data.subjectRules || sheetToObjects_(ss.getSheetByName('科目規則'));
  const teacherExclusives = data.teacherExclusives || sheetToObjects_(ss.getSheetByName('互斥'));
  const rooms = data.rooms || (ss && ss.getSheetByName ? sheetToObjects_(ss.getSheetByName('教室')) : []);
  const assignments = data.assignments || (ss && ss.getSheetByName ? sheetToObjects_(ss.getSheetByName('配課')) : []);
  const subjectByCode = {};
  subjects.forEach(subject => { subjectByCode[String(subject['科目代碼'] || '').trim()] = subject; });
  const conflicts = [];
  const exclude = String(excludeId || '');
  const teacherCodes = teacherCodesFromValue_(p.teacherCode);
  const subjectCode = p.subjectCode ? String(p.subjectCode) : '';
  const classInfo = classes.find(row => String(row['班級代碼'] || '').trim() === String(p.classCode || '').trim()) || {};
  const isVirtualClass = p.isVirtual === true || String(p.isVirtual || '').toUpperCase() === 'TRUE' || exportTruthy_(classInfo['是否虛擬班']);
  const alternateAssignment = assignments.find(assignment =>
    scheduleMatchesAssignment_({
      '班級代碼': p.classCode,
      '科目代碼': subjectCode,
      '教師姓名': p.teacherCode
    }, assignment) && assignmentIsAlternateWeek_(assignment, subjectByCode)
  );
  const requestedWeekType = periodN === 8
    ? String(p.weekType || p.week || p.attr || '').trim()
    : '';
  if (alternateAssignment && (periodN !== 8 || !['單週', '雙週'].includes(requestedWeekType))) {
    conflicts.push({ hard: true, kind: 'alternateWeeklyPeriod', msg: '每週0.5節課程必須排在第8節單週或雙週：' + String(p.classCode || '') + '／' + subjectCode });
  }

  // 同一時段其他格（排除自己）
  const slotCells = [];
  for (let i = 0; i < schedule.length; i++) {
    const s = schedule[i];
    if (String(s['課表ID']) === exclude) continue;
    if (parseInt(s['星期'], 10) !== dayN || parseInt(s['節次'], 10) !== periodN) continue;
    slotCells.push(s);
  }

  if (isPatrolScheduleRow_({ '班級代碼': p.classCode, '科目代碼': p.subjectCode, '課堂屬性': p.attr }) &&
      slotCells.some(isPatrolScheduleRow_)) {
    conflicts.push({ hard: true, kind: 'patrolSlot', msg: '同一星期與節次只能安排一位巡堂教師' });
  }

  // 第八節一般課程會佔用單週與雙週，不能和任一週次課程重疊；單週與雙週可各排一門。
  if (periodN === 8 && p.classCode) {
    const sameClassSlot = slotCells.filter(row => String(row['班級代碼'] || '').trim() === String(p.classCode || '').trim());
    const overlap = sameClassSlot.find(row => !isAlternateWeekPair_(p, row));
    if (overlap) {
      conflicts.push({
        hard: true,
        kind: 'classPeriodEight',
        msg: '班級' + p.classCode + '星期' + dayN + '第8節已有' + String(overlap['課堂屬性'] || '一般') + '課程「' + String(overlap['科目代碼'] || '') + '」，不可再排入重疊課程'
      });
    }
  }

  // 1. 教師衝突（硬）
  if (teacherCodes.length > 0) {
    const allowCoTeacherOverlap = p.allowCoTeacherOverlap === true;
    teacherCodes.forEach((teacherCode, teacherIndex) => {
      const isCoTeacher = allowCoTeacherOverlap && teacherIndex > 0;
      for (let i = 0; i < slotCells.length; i++) {
        const s = slotCells[i];
        if (isAlternateWeekPair_(p, s)) continue;
        if (teacherCodesFromValue_(s['教師姓名']).indexOf(teacherCode) >= 0) {
          conflicts.push({
            hard: !isCoTeacher,
            kind: isCoTeacher ? 'coTeacher' : 'teacher',
            msg: '教師' + teacherCode + '於' + dayN + '/' + periodN + '已有課（' + s['班級代碼'] + '）' +
              (isCoTeacher ? '（協同教師跨班，可確認寫入）' : '')
          });
          break;
        }
      }

      for (let i = 0; i < teacherBlocks.length; i++) {
        const b = teacherBlocks[i];
        if (teacherBlockHasSlot_(b, teacherCode, dayN, periodN)) {
          conflicts.push({ hard: true, kind: 'block',
            msg: '教師' + teacherCode + '設定不排課（' + (b['原因'] || '已鎖定') + '）' });
          break;
        }
      }

      // 1b. 教師互斥規則（硬）
      for (let i = 0; i < teacherExclusives.length; i++) {
        const r = teacherExclusives[i];
        const a = String(r['教師A'] || '');
        const b = String(r['教師B'] || '');
        if (a !== teacherCode && b !== teacherCode) continue;
        const peerCode = a === teacherCode ? b : a;
        for (let j = 0; j < slotCells.length; j++) {
          if (isAlternateWeekPair_(p, slotCells[j])) continue;
          if (teacherCodesFromValue_(slotCells[j]['教師姓名']).indexOf(peerCode) >= 0) {
            conflicts.push({ hard: true, kind: 'exclusive',
              msg: '教師互斥規則：' + teacherCode + ' 與 ' + peerCode + ' 不得同節排課（' + (r['備註'] || '') + '）' });
            break;
          }
        }
      }
    });
  }

  // 2. 科目同時最多班數（硬）
  if (subjectCode) {
    let subj = null;
    for (let i = 0; i < subjects.length; i++) {
      if (String(subjects[i]['科目代碼']) === subjectCode) { subj = subjects[i]; break; }
    }
    const maxC = subj ? parseInt(subj['同時最多班數'] || '0', 10) : 0;
    if (maxC > 0 && !isVirtualClass) {
      let cnt = 0;
      for (let i = 0; i < slotCells.length; i++) {
        if (!isAlternateWeekPair_(p, slotCells[i]) && String(slotCells[i]['科目代碼']) === subjectCode) cnt++;
      }
      if (cnt >= maxC) conflicts.push({ hard: true, kind: 'maxConcurrent',
        msg: subjectCode + '已達同時' + maxC + '班上限' });
    }

    // 科目禁排（硬）
    for (let i = 0; i < subjectRules.length; i++) {
      const r = subjectRules[i];
      const slots = parseFrozenRuleSlots_(r);
      if (subjectRuleMatches_(r, subjectCode, p.classCode, classes) &&
          slots.some(slot => slot.day === dayN && slot.period === periodN) &&
          r['規則類型'] === '禁排') {
        conflicts.push({ hard: true, kind: 'banned', msg: subjectCode + '禁排此時段' });
        break;
      }
    }

    const sameClassSubjectDayPeriods = schedule
      .filter(row => String(row['課表ID']) !== exclude &&
        String(row['班級代碼']) === String(p.classCode) &&
        String(row['科目代碼']) === subjectCode &&
        parseInt(row['星期'], 10) === dayN &&
        !isAlternateWeekPair_(p, row))
      .map(row => parseInt(row['節次'], 10));
    if (sameClassSubjectDayPeriods.length > 0 && !isValidMandatorySameDayProgress_(
      subjectCode,
      p.classCode,
      dayN,
      sameClassSubjectDayPeriods.concat(periodN),
      subjectRules,
      classes
    )) {
      conflicts.push({ hard: false, kind: 'sameClassSubjectDay', msg: subjectCode + '同班同科同日已有其他節次，可能是連排課程，請確認是否仍要排入' });
    }

    const roomCode = String(subj && subj['所屬教室代碼'] || '').trim();
    const room = rooms.find(row => String(row['教室代碼'] || '').trim() === roomCode);
    if (roomCode && room) {
      const capacity = parseInt(room['容量'] || '1', 10) || 1;
      const roomCount = slotCells.filter(row => {
        if (isAlternateWeekPair_(p, row)) return false;
        const rowSubject = subjects.find(item => String(item['科目代碼'] || '').trim() === String(row['科目代碼'] || '').trim());
        return String(rowSubject && rowSubject['所屬教室代碼'] || '').trim() === roomCode;
      }).length;
      if (roomCount >= capacity) conflicts.push({
        hard: true,
        kind: 'roomCapacity',
        msg: '教室' + roomCode + '於' + dayN + '/' + periodN + '已有' + roomCount + '班，容量上限' + capacity + '班'
      });
    }
  }

  return conflicts;
}


// ===================== 課表操作 =====================

function isTeacherOvertimeValue_(value) {
  return value === true || String(value || '').toUpperCase() === 'TRUE';
}

function normalizeTeacherEntry_(value) {
  if (value == null) return null;
  const objectValue = typeof value === 'object' ? value : null;
  const code = String(objectValue
    ? (objectValue['教師姓名'] || objectValue['姓名'] || objectValue.code || '')
    : value).trim();
  if (!code) return null;
  const item = {
    '教師姓名': code,
    '標籤': String(objectValue ? (objectValue['標籤'] || objectValue.tag || '') : '').trim()
  };
  if (objectValue && isTeacherOvertimeValue_(objectValue['超鐘點'])) {
    item['超鐘點'] = true;
  }
  return item;
}

function teacherEntriesFromValue_(value) {
  if (Array.isArray(value)) return value.map(normalizeTeacherEntry_).filter(Boolean);
  if (value && typeof value === 'object') {
    const item = normalizeTeacherEntry_(value);
    return item ? [item] : [];
  }
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return [];
  if (raw.charAt(0) === '[') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(normalizeTeacherEntry_).filter(Boolean);
    } catch (err) {}
  }
  return raw.split(/[,，、;；]/).map(normalizeTeacherEntry_).filter(Boolean);
}

function serializeTeacherEntries_(teacherList, forceJson) {
  const list = (teacherList || []).map(normalizeTeacherEntry_).filter(Boolean);
  const needsJson = forceJson === true || list.length > 1 || list.some(item => item['標籤'] || item['超鐘點']);
  return needsJson ? JSON.stringify(list) : (list[0] ? list[0]['教師姓名'] : '');
}

// 單一教師的超鐘點使用課堂屬性；只有多位教師同格時才寫入個別教師 JSON。
function applyTeacherOvertimeRow_(row, teacherCode, isOvertime) {
  const teacherList = teacherEntriesFromValue_(row['教師姓名']);
  const target = teacherList.find(item => String(item['教師姓名'] || '').trim() === String(teacherCode || '').trim());
  if (!target) return false;

  if (teacherList.length > 1) {
    if (isOvertime) target['超鐘點'] = true;
    else delete target['超鐘點'];
    if (String(row['課堂屬性'] || '').trim() === '超鐘點') row['課堂屬性'] = '一般';
  } else {
    // 清掉舊版誤寫在單一教師 JSON 裡的標記，避免教師姓名被顯示成超鐘點。
    delete target['超鐘點'];
    row['課堂屬性'] = isOvertime ? '超鐘點' : '一般';
  }
  row['教師姓名'] = serializeTeacherEntries_(teacherList);
  return true;
}

function normalizeTeacherCode_(teacherCode) {
  const isStructured = Array.isArray(teacherCode) ||
    (teacherCode && typeof teacherCode === 'object') ||
    (typeof teacherCode === 'string' && teacherCode.trim().charAt(0) === '[');
  if (isStructured) {
    const tList = teacherEntriesFromValue_(teacherCode);
    if (tList.length > 0) return serializeTeacherEntries_(tList, true);
  }
  if (teacherCode && typeof teacherCode === 'object') return String(teacherCode['教師姓名'] || '');
  return String(teacherCode || '');
}

function teacherCodesFromValue_(value) {
  const result = [];
  const add = item => {
    if (item && typeof item === 'object') {
      add(item['教師姓名'] || item.code || '');
      return;
    }
    String(item == null ? '' : item).split(/[,，、;；]/).forEach(code => {
      const normalized = String(code || '').trim();
      if (normalized && result.indexOf(normalized) < 0) result.push(normalized);
    });
  };
  if (Array.isArray(value)) {
    value.forEach(add);
    return result;
  }
  if (value && typeof value === 'object') {
    add(value);
    return result;
  }
  const raw = String(value == null ? '' : value).trim();
  if (raw.charAt(0) === '[') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach(add);
        return result;
      }
    } catch (err) {}
  }
  add(raw);
  return result;
}

function findScheduleSlotIndices_(rows, classCode, dayN, periodN, weekType) {
  const targetCls = String(classCode || '').trim();
  const targetWeek = parseInt(periodN, 10) === 8 ? String(weekType || '').trim() : '';
  const matching = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (String(r['班級代碼'] || '').trim() === targetCls &&
        parseInt(r['星期'], 10) === dayN &&
        parseInt(r['節次'], 10) === periodN &&
        (!targetWeek || String(r['課堂屬性'] || '').trim() === targetWeek)) {
      matching.push(i);
    }
  }
  return matching;
}

function updateCell_(ss, p) {
  // 課表只讀一次：衝突檢查與寫入共用
  const sheet = ss.getSheetByName('課表');
  const rows = sheetToObjects_(sheet);
  const preloaded = {
    schedule: rows,
    subjects: sheetToObjects_(ss.getSheetByName('科目')),
    assignments: sheetToObjects_(ss.getSheetByName('配課')),
    teacherBlocks: sheetToObjects_(ss.getSheetByName('不排課')),
    subjectRules: sheetToObjects_(ss.getSheetByName('科目規則')),
    teacherExclusives: sheetToObjects_(ss.getSheetByName('互斥')),
    classes:          sheetToObjects_(ss.getSheetByName('班級')),
    blockGroups:      sheetToObjects_(ss.getSheetByName('綁班')),
  };
  const headers = SHEET_DEFS['課表'].headers;
  const dayN = parseInt(p.day, 10);
  const periodN = parseInt(p.period, 10);
  const targetCls = String(p.classCode || '').trim();
  const teacherTc = normalizeTeacherCode_(p.teacherCode);
  const targetWeek = periodN === 8
    ? String(p.weekType || p.week || p.attr || '').trim()
    : '';
  const matchingIndices = findScheduleSlotIndices_(rows, targetCls, dayN, periodN, targetWeek);
  const existingId = String(p.existingId || '').trim() ||
    (matchingIndices.length === 1 ? String(rows[matchingIndices[0]]['課表ID'] || '').trim() : '');
  const conflictPayload = {
    ...p,
    ...(existingId && !p.existingId ? { existingId } : {}),
    allowCoTeacherOverlap: true
  };
  const conflicts = checkConflicts_(ss, conflictPayload, existingId, preloaded);
  const blockingConflicts = conflicts.filter(c =>
    c.hard && !(p.force === true && c.kind !== 'teacher' && c.kind !== 'banned')
  );
  if (blockingConflicts.length > 0) return { blocked: true, conflicts };

  const classRows = preloaded.classes || [];
  const frozenRules = preloaded.subjectRules || [];
  const blockGroups = preloaded.blockGroups || [];
  const frozenExisting = matchingIndices.map(index => rows[index]).find(row => isFrozenScheduleEntry_(row, frozenRules, classRows));
  if (frozenExisting) return { ok: false, blocked: true, error: '凍結課程不可覆寫，請先解除固定設定' };
  const boundExisting = matchingIndices.map(index => rows[index]).find(row => getBindGroupForEntry_(row, blockGroups));
  if (boundExisting) return { ok: false, blocked: true, error: '綁班課程不可被單獨覆寫，請整組移動或編輯' };

  const forcePullOut = isManualOnlyPeriod_(periodN) || isVirtualClassRow_(classRows.reduce((map, row) => {
    map[String(row['班級代碼'] || '').trim()] = row;
    return map;
  }, {}), targetCls);
  const attr = forcePullOut
    ? '抽離'
    : ((p.isOvertime === true || String(p.isOvertime).toUpperCase() === 'TRUE')
    ? '超鐘點'
    : (p.attr || (p.isVirtual ? '抽離' : '一般')));
  const id = (matchingIndices.length > 0 ? rows[matchingIndices[0]]['課表ID'] : null) || genId_();

  const newRow = {
    '課表ID': id, '班級代碼': targetCls,
    '星期': dayN, '節次': periodN,
    '科目代碼': String(p.subjectCode || ''), '教師姓名': teacherTc,
    '課堂屬性': attr,
    '是否鎖定': p.isLocked ? 'TRUE' : 'FALSE'
  };

  const values = headers.map(h => newRow[h] !== undefined ? newRow[h] : '');

  if (matchingIndices.length > 0) {
    sheet.getRange(matchingIndices[0] + 2, 1, 1, values.length).setValues([values]);
    for (let i = matchingIndices.length - 1; i > 0; i--) {
      sheet.deleteRow(matchingIndices[i] + 2);
    }
  } else {
    sheet.appendRow(values);
  }
  return { ok: true, cell: newRow, conflicts, scheduleRevision: scheduleRevision_(sheetToObjects_(sheet)) };
}

function clearCell_(ss, p) {
  const sheet = ss.getSheetByName('課表');
  const rows = sheetToObjects_(sheet);
  const dayN = parseInt(p.day, 10);
  const periodN = parseInt(p.period, 10);
  const matchingIndices = findScheduleSlotIndices_(rows, p.classCode, dayN, periodN, p.weekType || p.week);
  const classRows = sheetToObjects_(ss.getSheetByName('班級'));
  const frozenRules = sheetToObjects_(ss.getSheetByName('科目規則'));
  const blockGroups = sheetToObjects_(ss.getSheetByName('綁班'));
  const assignments = sheetToObjects_(ss.getSheetByName('配課'));
  if (matchingIndices.some(index => isClearFrozenScheduleEntry_(rows[index], frozenRules, classRows))) {
    return { ok: false, blocked: true, error: '凍結課程不可清除，請先解除固定設定' };
  }
  if (matchingIndices.length === 0) return { ok: true, scheduleRevision: scheduleRevision_(rows) };

  const bindEntry = matchingIndices.map(index => rows[index]).find(row => getBindGroupForEntry_(row, blockGroups));
  const bindGroup = bindEntry ? getBindGroupForEntry_(bindEntry, blockGroups) : null;
  const bindGroupKey = bindGroup ? String(bindGroup['群組ID'] || bindGroup['群組名稱'] || '') : '';
  const bindCohortMembers = bindEntry && bindGroup
    ? getConfiguredBindCohortMembers_(bindGroup, p.subjectCode || bindEntry['科目代碼'], p.classCode, assignments)
    : [];
  const deleteIndices = bindEntry
    ? rows.map((row, index) => {
        const rowGroup = getBindGroupForEntry_(row, blockGroups);
        const sameSlot = parseInt(row['星期'], 10) === dayN && parseInt(row['節次'], 10) === periodN &&
          (!String(p.weekType || p.week || '').trim() || String(row['課堂屬性'] || '').trim() === String(p.weekType || p.week).trim()) &&
          rowGroup && String(rowGroup['群組ID'] || rowGroup['群組名稱'] || '') === bindGroupKey &&
          (bindCohortMembers.length === 0 || bindCohortMembers.some(member =>
            member.classCode === String(row['班級代碼'] || '').trim() &&
            member.subjectCode === String(row['科目代碼'] || '').trim()
          ));
        return sameSlot ? index : -1;
      }).filter(index => index >= 0)
    : matchingIndices;
  if (deleteIndices.some(index => isClearFrozenScheduleEntry_(rows[index], frozenRules, classRows))) {
    return { ok: false, blocked: true, error: '綁班群組中含有凍結課程，不可清除' };
  }
  for (let i = deleteIndices.length - 1; i >= 0; i--) {
    sheet.deleteRow(deleteIndices[i] + 2);
  }
  return { ok: true, scheduleRevision: scheduleRevision_(sheetToObjects_(sheet)) };
}

function swapCells_(ss, p) {
  const sheet   = ss.getSheetByName('課表');
  const rows    = sheetToObjects_(sheet);
  const headers = SHEET_DEFS['課表'].headers;
  const classRows = sheetToObjects_(ss.getSheetByName('班級'));
  const frozenRules = sheetToObjects_(ss.getSheetByName('科目規則'));
  const blockGroups = sheetToObjects_(ss.getSheetByName('綁班'));

  function weekOf(slot) {
    return parseInt(slot && slot.period, 10) === 8
      ? String(slot.weekType || slot.week || '').trim()
      : '';
  }
  function find(slot) {
    const weekType = weekOf(slot);
    return rows.findIndex(r =>
      String(r['班級代碼']) === String(slot.classCode) &&
      parseInt(r['星期'], 10) === parseInt(slot.day, 10) &&
      parseInt(r['節次'], 10) === parseInt(slot.period, 10) &&
      (!weekType || String(r['課堂屬性'] || '').trim() === weekType)
    );
  }
  const ia = find(p.a);
  const ib = find(p.b);
  const ra  = ia >= 0 ? Object.assign({}, rows[ia]) : null;
  const rb  = ib >= 0 ? Object.assign({}, rows[ib]) : null;
  const rowsAtA = rows.filter(r =>
    String(r['班級代碼']) === String(p.a.classCode) &&
    parseInt(r['星期'], 10) === parseInt(p.a.day, 10) &&
    parseInt(r['節次'], 10) === parseInt(p.a.period, 10) &&
    (!weekOf(p.a) || String(r['課堂屬性'] || '').trim() === weekOf(p.a))
  );
  const rowsAtB = rows.filter(r =>
    String(r['班級代碼']) === String(p.b.classCode) &&
    parseInt(r['星期'], 10) === parseInt(p.b.day, 10) &&
    parseInt(r['節次'], 10) === parseInt(p.b.period, 10) &&
    (!weekOf(p.b) || String(r['課堂屬性'] || '').trim() === weekOf(p.b))
  );

  if (rowsAtA.some(row => getBindGroupForEntry_(row, blockGroups)) ||
      rowsAtB.some(row => getBindGroupForEntry_(row, blockGroups))) {
    return { ok: false, blocked: true, error: '綁班課程不可單格互調，請整組移動到空時段' };
  }
  if (rowsAtA.some(row => isFrozenScheduleEntry_(row, frozenRules, classRows)) ||
      rowsAtB.some(row => isFrozenScheduleEntry_(row, frozenRules, classRows))) {
    return { ok: false, blocked: true, error: '凍結課程不可互調，請先解除固定設定' };
  }

  [ia, ib].filter(i => i >= 0).sort((a, b) => b - a).forEach(i => sheet.deleteRow(i + 2));

  function writeSwap(cell, cls, day, period, weekType) {
    if (!cell) return;
    const targetWeek = parseInt(period, 10) === 8
      ? String(weekType || '').trim()
      : '';
    const values = headers.map(h => {
      if (h === '班級代碼') return String(cls);
      if (h === '星期')    return parseInt(day, 10);
      if (h === '節次')    return parseInt(period, 10);
      if (h === '課堂屬性' && targetWeek) return targetWeek;
      return cell[h] !== undefined ? cell[h] : '';
    });
    sheet.appendRow(values);
  }
  writeSwap(ra, p.b.classCode, p.b.day, p.b.period, weekOf(p.b));
  writeSwap(rb, p.a.classCode, p.a.day, p.a.period, weekOf(p.a));
  return { ok: true, scheduleRevision: scheduleRevision_(sheetToObjects_(sheet)) };
}

function lockCell_(ss, p) {
  const sheet = ss.getSheetByName('課表');
  const rows  = sheetToObjects_(sheet);
  const dayN = parseInt(p.day, 10);
  const periodN = parseInt(p.period, 10);
  const subjectCode = String(p.subjectCode || '').trim();
  const weekType = periodN === 8 ? String(p.weekType || '').trim() : '';
  const idx   = rows.findIndex(r =>
    String(r['班級代碼']) === String(p.classCode) &&
    parseInt(r['星期'], 10) === dayN &&
    parseInt(r['節次'], 10) === periodN &&
    (!subjectCode || String(r['科目代碼'] || '').trim() === subjectCode) &&
    (periodN !== 8 || !weekType || String(r['課堂屬性'] || '').trim() === weekType)
  );
  if (idx < 0) return { ok: false, error: '此格沒有課程' };
  const targetRow = rows[idx];
  const blockGroups = sheetToObjects_(ss.getSheetByName('綁班'));
  const assignments = sheetToObjects_(ss.getSheetByName('配課'));
  const bindGroup = getBindGroupForEntry_(targetRow, blockGroups);
  let targetIndices = [idx];
  if (bindGroup) {
    const members = getConfiguredBindCohortMembers_(
      bindGroup,
      String(targetRow['科目代碼'] || '').trim(),
      String(targetRow['班級代碼'] || '').trim(),
      assignments
    );
    const expectedKeys = members.map(member => member.classCode + '|' + member.subjectCode);
    const expectedKeySet = new Set(expectedKeys);
    const indexByKey = new Map();
    let duplicate = false;
    rows.forEach((row, rowIndex) => {
      if (String(row['星期'] || '') !== String(targetRow['星期'] || '') ||
          parseInt(row['節次'], 10) !== periodN ||
          (periodN === 8 && String(row['課堂屬性'] || '').trim() !== String(targetRow['課堂屬性'] || '').trim())) return;
      const key = String(row['班級代碼'] || '').trim() + '|' + String(row['科目代碼'] || '').trim();
      if (!expectedKeySet.has(key)) return;
      if (indexByKey.has(key)) duplicate = true;
      indexByKey.set(key, rowIndex);
    });
    if (duplicate || expectedKeys.length < 2 || expectedKeys.some(key => !indexByKey.has(key))) {
      return { ok: false, blocked: true, error: '綁班課程資料不完整，請先補齊所有班級後再鎖定或解鎖' };
    }
    targetIndices = expectedKeys.map(key => indexByKey.get(key));
  }
  const col = SHEET_DEFS['課表'].headers.indexOf('是否鎖定') + 1;
  targetIndices.forEach(rowIndex => sheet.getRange(rowIndex + 2, col).setValue(p.locked ? 'TRUE' : 'FALSE'));
  return { ok: true, scheduleRevision: scheduleRevision_(sheetToObjects_(sheet)) };
}

function setOvertime_(ss, p) {
  const periodN = parseInt(p.period, 10);
  if (periodN === 8 || isManualOnlyPeriod_(periodN)) {
    return { ok: false, error: isManualOnlyPeriod_(periodN) ? '早自習與午休不支援超鐘點設定' : '第八節不支援超鐘點設定' };
  }
  const sheet = ss.getSheetByName('課表');
  const rows = sheetToObjects_(sheet);
  const idx = rows.findIndex(r =>
    String(r['班級代碼']) === String(p.classCode) &&
    parseInt(r['星期'], 10) === parseInt(p.day, 10) &&
    parseInt(r['節次'], 10) === periodN
  );
  if (idx < 0) return { ok: false, error: '此格沒有課程' };
  const isOvertime = p.isOvertime === true || String(p.isOvertime).toUpperCase() === 'TRUE';
  const targetTeacher = String(p.teacherCode || '').trim();
  const targetRow = rows[idx];
  if (targetTeacher) {
    if (!applyTeacherOvertimeRow_(targetRow, targetTeacher, isOvertime)) {
      return { ok: false, error: '找不到指定教師，請重新載入課表後再試' };
    }

    const teacherCol = SHEET_DEFS['課表'].headers.indexOf('教師姓名') + 1;
    sheet.getRange(idx + 2, teacherCol).setValue(targetRow['教師姓名']);

    const attrCol = SHEET_DEFS['課表'].headers.indexOf('課堂屬性') + 1;
    sheet.getRange(idx + 2, attrCol).setValue(targetRow['課堂屬性'] || '一般');
  } else {
    const col = SHEET_DEFS['課表'].headers.indexOf('課堂屬性') + 1;
    sheet.getRange(idx + 2, col).setValue(isOvertime ? '超鐘點' : '一般');
  }
  return { ok: true, isOvertime: isOvertime, teacherCode: targetTeacher, scheduleRevision: scheduleRevision_(sheetToObjects_(sheet)) };
}

function batchSetOvertime_(ss, p) {
  const changes = Array.isArray(p && p.changes) ? p.changes : [];
  if (changes.length === 0) return { ok: true, changed: 0, scheduleRevision: scheduleRevision_(sheetToObjects_(ss.getSheetByName('課表'))) };
  const sheet = ss.getSheetByName('課表');
  const rows = sheetToObjects_(sheet);
  const baseRevision = String(p && p.baseRevision || '').trim();
  const currentRevision = scheduleRevision_(rows);
  if (baseRevision && baseRevision !== currentRevision) {
    return { ok: false, blocked: true, conflict: true, error: '課表已被其他人更新，請重新預覽超鐘點後再套用', currentRevision };
  }

  const headers = SHEET_DEFS['課表'].headers;
  const changedRows = new Set();
  const seenChanges = new Set();
  const errors = [];

  changes.forEach(change => {
    const classCode = String(change && change.classCode || '').trim();
    const subjectCode = String(change && change.subjectCode || '').trim();
    const teacherCode = String(change && change.teacherCode || '').trim();
    const day = parseInt(change && change.day, 10);
    const period = parseInt(change && change.period, 10);
    const isOvertime = change && (change.isOvertime === true || String(change.isOvertime).toUpperCase() === 'TRUE');
    const changeKey = [classCode, subjectCode, day, period, teacherCode, isOvertime].join('|');
    if (seenChanges.has(changeKey)) return;
    seenChanges.add(changeKey);
    if (!classCode || !teacherCode || !Number.isFinite(day) || !Number.isFinite(period) || period < 1 || period > 7) {
      errors.push('超鐘點資料格式錯誤：' + changeKey);
      return;
    }

    const matchingIndices = rows.map((row, index) => {
      const sameClass = String(row['班級代碼'] || '').trim() === classCode;
      const sameSubject = !subjectCode || String(row['科目代碼'] || '').trim() === subjectCode;
      const sameSlot = parseInt(row['星期'], 10) === day && parseInt(row['節次'], 10) === period;
      return sameClass && sameSubject && sameSlot ? index : -1;
    }).filter(index => index >= 0);
    if (matchingIndices.length === 0) {
      errors.push('找不到課堂：' + classCode + '／' + subjectCode + '／' + day + '/' + period);
      return;
    }

    let matchedTeacher = false;
    matchingIndices.forEach(index => {
      const row = rows[index];
      if (applyTeacherOvertimeRow_(row, teacherCode, isOvertime)) {
        matchedTeacher = true;
        changedRows.add(index);
      }
    });
    if (!matchedTeacher) errors.push('課堂找不到指定教師：' + classCode + '／' + subjectCode + '／' + teacherCode);
  });

  if (errors.length > 0) {
    return { ok: false, blocked: true, error: '批次超鐘點未寫入：' + errors.slice(0, 10).join('；') };
  }
  changedRows.forEach(index => {
    const values = headers.map(header => rows[index][header] !== undefined ? rows[index][header] : '');
    sheet.getRange(index + 2, 1, 1, values.length).setValues([values]);
  });
  return { ok: true, changed: changedRows.size, scheduleRevision: scheduleRevision_(sheetToObjects_(sheet)) };
}

// ===================== 設定資料 =====================

function findDataRowByKey_(sheet, def, keyValue) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const keyColumn = def.headers.indexOf(def.key) + 1;
  if (keyColumn < 1) throw new Error('找不到主鍵欄位：' + def.key);
  const found = sheet.getRange(2, keyColumn, lastRow - 1, 1)
    .createTextFinder(String(keyValue)).matchEntireCell(true).findNext();
  return found ? found.getRow() : 0;
}

function saveClassMeta_(sheet, data) {
  ensureClassSchema_(sheet);
  const def = SHEET_DEFS['班級'];
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(value => String(value || '').trim());
  const keyValue = String(data['班級代碼'] || '').trim();
  if (!keyValue) throw new Error('主鍵不能空白');
  const row = findDataRowByKey_(sheet, def, keyValue);
  const values = row
    ? sheet.getRange(row, 1, 1, headers.length).getDisplayValues()[0]
    : Array(headers.length).fill('');
  const virtualValue = String(data['是否虛擬班'] || '').toUpperCase() === 'TRUE';
  const defaults = { '班級類型': virtualValue ? '虛擬' : '一般' };
  def.headers.forEach(header => {
    const column = headers.indexOf(header);
    if (column < 0) return;
    const value = data[header] !== undefined ? data[header] : (row ? values[column] : defaults[header]);
    values[column] = numericStringToText_(value == null ? '' : value);
  });
  if (row) sheet.getRange(row, 1, 1, headers.length).setValues([values]);
  else sheet.appendRow(values);
  return { ok: true };
}

function saveMeta_(ss, p) {
  if (p.type === '科目關係') return saveSubjectRelation_(ss, p);
  if (p.type === '課表例外') return saveScheduleException_(ss, p.data || {});
  const sheet = ss.getSheetByName(p.type);
  if (!sheet) throw new Error('找不到工作表：' + p.type);
  const def = SHEET_DEFS[p.type];
  if (p.type === '班級') return saveClassMeta_(sheet, p.data || {});
  if (p.type === '配課') {
    const data = p.data || {};
    if (!isValidWeeklyValue_(data['每週節數'])) throw new Error('每週節數請留白、填 0.5，或填 1 至 20 的整數');
    const courseAttr = String(data['課程屬性'] || '').trim();
    if (courseAttr !== '' && courseAttr !== '預排') throw new Error('課程屬性目前只能留白或設定為預排');
  }
  if (p.type === '配色') validateScheduleColorRule_(p.data || {});
  if (p.type === '科目') protectSubjectTextColumns_(sheet);
  if (p.type === '配色') protectScheduleColorTextColumns_(sheet);
  const keyVal = String((p.data && p.data[def.key]) || '').trim();
  if (!keyVal) throw new Error('主鍵不能空白');
  const row = findDataRowByKey_(sheet, def, keyVal);
  const noteColumn = def.headers.indexOf('備註') + 1;
  const preservedNote = p.type === '配課' && row && noteColumn > 0 &&
    (!p.data || p.data['備註'] === undefined)
    ? sheet.getRange(row, noteColumn).getDisplayValue()
    : '';
  const values = def.headers.map(h => {
    const v = (p.data && p.data[h] !== undefined)
      ? p.data[h]
      : (h === '備註' ? preservedNote : '');
    return numericStringToText_(v);
  });
  if (row) sheet.getRange(row, 1, 1, values.length).setValues([values]);
  else sheet.appendRow(values);
  return { ok: true };
}

// 以數字開頭的字串（如班級代碼 701、907、或 7.01E+56 科學記號）加上前置撇號，
// 避免 Google Sheets 自動解析為數字（尤其是長數字串會變科學記號）
function replaceTeacherReference_(value, oldKey, newKey) {
  if (Array.isArray(value)) {
    return value.map(item => {
      if (item && typeof item === 'object') {
        const copy = Object.assign({}, item);
        if (String(copy['教師姓名'] || '').trim() === oldKey) copy['教師姓名'] = newKey;
        return copy;
      }
      return String(item || '').trim() === oldKey ? newKey : item;
    });
  }
  const text = String(value == null ? '' : value);
  if (!text) return value;
  if (text.trim().indexOf('[') === 0) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return JSON.stringify(replaceTeacherReference_(parsed, oldKey, newKey));
    } catch (err) {}
  }
  return text === oldKey ? newKey : value;
}

function replaceTeacherReferenceColumn_(sheet, header, oldKey, newKey) {
  if (!sheet || sheet.getLastRow() < 2 || sheet.getLastColumn() < 1) return 0;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(String);
  const column = headers.indexOf(header) + 1;
  if (column < 1) return 0;
  const range = sheet.getRange(2, column, sheet.getLastRow() - 1, 1);
  const rows = range.getDisplayValues();
  let changed = 0;
  const nextRows = rows.map(row => {
    const current = row[0];
    const next = replaceTeacherReference_(current, oldKey, newKey);
    const nextText = typeof next === 'string' ? next : JSON.stringify(next);
    if (nextText !== current) changed++;
    return [nextText];
  });
  if (changed > 0) range.setValues(nextRows);
  return changed;
}

function renameTeacher_(ss, p) {
  const oldKey = String((p && (p.oldKey || p.key)) || '').trim();
  const data = (p && p.data) || {};
  const newKey = String(data['教師姓名'] || '').trim();
  if (!oldKey || !newKey) throw new Error('教師姓名不能空白');
  const sheet = ss.getSheetByName('教師');
  if (!sheet) throw new Error('找不到工作表：教師');
  const def = SHEET_DEFS['教師'];
  const row = findDataRowByKey_(sheet, def, oldKey);
  if (!row) throw new Error('找不到原教師：' + oldKey);
  const duplicatedRow = findDataRowByKey_(sheet, def, newKey);
  if (duplicatedRow && duplicatedRow !== row) throw new Error('教師姓名已存在：' + newKey);
  const current = sheet.getRange(row, 1, 1, def.headers.length).getDisplayValues()[0];
  const values = def.headers.map((header, index) =>
    numericStringToText_(data[header] !== undefined ? data[header] : current[index])
  );
  sheet.getRange(row, 1, 1, values.length).setValues([values]);

  const updatedRows = {};
  const update = (sheetName, headers) => {
    let count = 0;
    headers.forEach(header => {
      count += replaceTeacherReferenceColumn_(ss.getSheetByName(sheetName), header, oldKey, newKey);
    });
    if (count > 0) updatedRows[sheetName] = count;
  };
  update('配課', ['教師姓名']);
  update('課表', ['教師姓名']);
  update('不排課', ['教師姓名']);
  update('互斥', ['教師A', '教師B']);
  return { oldKey, newKey, updatedRows };
}
function numericStringToText_(v) {
  if (typeof v === 'string' && /^\d/.test(v.trim())) return "'" + v.trim();
  return v;
}

function deleteMeta_(ss, p) {
  const sheet = ss.getSheetByName(p.type);
  if (!sheet) return { ok: false, error: '找不到工作表：' + p.type };
  const def = SHEET_DEFS[p.type];
  const row = findDataRowByKey_(sheet, def, p.key);
  if (row) sheet.deleteRow(row);
  return { ok: true };
}
// 教師不排課的新版集中時段陣列處理器定義於檔案末段。

// ===================== 科目時段規則 =====================

function saveSubjectRule_(ss, p) {
  // p: { subjectCode(s), classCode(s), grade, type:'必排'|'禁排', clear, pairs? }
  // pairs 格式為 "day-period,day-period"（如 "1-2,3-4" 表示週一第2節、週三第4節）
  const sheet  = ss.getSheetByName('科目規則');
  const rows   = sheetToObjects_(sheet);
  const subjectCodes = normalizeSubjectRuleList_(p.subjectCodes || p.subjectCode);
  const classCodes = normalizeSubjectRuleList_(p.classCodes || p.classCode || p.classes);
  const subjectStr = subjectCodes.join(',');
  const classStr = classCodes.join(',');
  const gradeStr = String(p.grade || '全校').trim() || '全校';
  const type = String(p.type || '').trim();
  if (subjectCodes.length === 0) throw new Error('至少要選擇一個科目');
  if (type !== '必排' && type !== '禁排') throw new Error('規則類型不正確');

  if (p.clear) {
    let removed = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (sameSubjectRuleList_(r['科目代碼'], subjectCodes) &&
          sameSubjectRuleList_(r['適用班級'], classCodes) &&
          String(r['適用年級'] || '全校').trim() === gradeStr &&
          String(r['規則類型'] || '').trim() === type &&
          (!p.pairs || String(r['時段'] || '') === String(p.pairs))) {
        sheet.deleteRow(i + 2);
        removed++;
      }
    }
    return { ok: true, removed };
  }
  if (p.pairs) {
    sheet.appendRow([genId_(), subjectStr, gradeStr, classStr, p.pairs, type, '']);
  }
  return { ok: true };
}

function saveSubjectRelation_(ss, p) {
  const sheet = ss.getSheetByName('科目關係');
  if (!sheet) throw new Error('找不到「科目關係」工作表');
  const data = p && p.data ? p.data : p || {};
  const def = SHEET_DEFS['科目關係'];
  const id = String(data['規則ID'] || p.id || ('SREL' + Date.now())).trim();
  const subjectA = String(data['科目A'] || '').trim();
  const subjectB = String(data['科目B'] || '').trim();
  const grade = String(data['適用年級'] || '全校').trim() || '全校';
  const classCodes = [...new Set(String(data['適用班級'] || '')
    .split(/[,，、;；]/).map(value => value.trim()).filter(Boolean))];
  const remark = String(data['備註'] || '').trim();
  if (!subjectA || !subjectB) throw new Error('科目 A 與科目 B 不可為空白');
  if (subjectA === subjectB) throw new Error('科目 A 與科目 B 不可相同');
  if (!['全校', '7', '8', '9'].includes(grade)) throw new Error('適用年級格式不正確');

  const subjectCodes = new Set(sheetToObjects_(ss.getSheetByName('科目')).map(row => String(row['科目代碼'] || '').trim()).filter(Boolean));
  if (!subjectCodes.has(subjectA) || !subjectCodes.has(subjectB)) throw new Error('科目關係包含不存在的科目');
  const classCodesInSheet = new Set(sheetToObjects_(ss.getSheetByName('班級')).map(row => String(row['班級代碼'] || '').trim()).filter(Boolean));
  const unknownClass = classCodes.find(classCode => !classCodesInSheet.has(classCode));
  if (unknownClass) throw new Error('科目關係包含不存在的班級：' + unknownClass);

  const pairKey = [subjectA, subjectB].sort().join('|');
  const scopeKey = grade + '|' + classCodes.slice().sort().join(',');
  const rows = sheetToObjects_(sheet);
  const duplicate = rows.find(row => {
    if (String(row['規則ID'] || '').trim() === id) return false;
    const rowPair = [String(row['科目A'] || '').trim(), String(row['科目B'] || '').trim()].sort().join('|');
    const rowClasses = String(row['適用班級'] || '').split(/[,，、;；]/).map(value => value.trim()).filter(Boolean).sort().join(',');
    return rowPair === pairKey && (String(row['適用年級'] || '全校').trim() || '全校') + '|' + rowClasses === scopeKey;
  });
  if (duplicate) throw new Error('相同科目組合與適用範圍已存在');

  const values = def.headers.map(header => numericStringToText_({
    '規則ID': id,
    '科目A': subjectA,
    '科目B': subjectB,
    '適用年級': grade,
    '適用班級': classCodes.join(','),
    '備註': remark
  }[header]));
  const rowNumber = findDataRowByKey_(sheet, def, id);
  if (rowNumber) sheet.getRange(rowNumber, 1, 1, values.length).setValues([values]);
  else sheet.appendRow(values);
  return { ok: true, id, updated: Boolean(rowNumber) };
}

// ===================== 匯出（對齊調代課系統） =====================

function writeExportSheet_(ss, sheetName, headers, rows) {
  let sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName); else sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#EBF5FB');
  if (rows.length > 0) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  return { sheetName: sheetName, rowCount: rows.length };
}

function splitExportList_(value) {
  if (Array.isArray(value)) {
    const out = [];
    value.forEach(item => {
      const s = String(item || '').trim();
      if (s) out.push(s);
    });
    return out;
  }
  const text = String(value || '').trim();
  if (!text) return [];
  return text.split(/[,，、;；\/\n]+/).map(s => String(s).trim()).filter(Boolean);
}

function parseExportTeachers_(value) {
  if (Array.isArray(value)) {
    const result = [];
    value.forEach(item => {
      if (item && typeof item === 'object') {
        const code = String(item['教師姓名'] || item['姓名'] || item.code || '').trim();
        if (code) result.push({
          code: code,
          label: String(item['標籤'] || '').trim(),
          overtime: exportTruthy_(item['超鐘點'])
        });
      } else {
        const code = String(item || '').trim();
        if (code) result.push({ code: code, label: '', overtime: false });
      }
    });
    return result;
  }
  const raw = String(value || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parseExportTeachers_(parsed);
  } catch (err) {
    // 舊資料可能是一般教師代碼字串，改走分隔字串解析。
  }
  return splitExportList_(raw).map(code => ({ code: code, label: '', overtime: false }));
}

function exportTruthy_(value) {
  const text = String(value == null ? '' : value).trim().toUpperCase();
  return value === true || text === 'TRUE' || text === '1' || text === 'YES' || text === 'Y' || text === '是';
}

function exportFieldMatches_(ruleValue, actualValue, allLabels) {
  const rule = String(ruleValue || '').trim();
  if (!rule || rule === '*' || allLabels.indexOf(rule) >= 0) return true;
  return splitExportList_(rule).indexOf(String(actualValue || '').trim()) >= 0;
}

function colorRulePeriod_(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return null;
  const period = parseInt(raw, 10);
  return String(period) === raw && period >= 1 && period <= 8 ? period : NaN;
}

function validateScheduleColorRule_(data) {
  const day = String(data['星期'] == null ? '' : data['星期']).trim();
  const startRaw = String(data['起始節次'] == null ? '' : data['起始節次']).trim();
  const endRaw = String(data['結束節次'] == null ? '' : data['結束節次']).trim();
  if (day && !/^[1-5]$/.test(day)) throw new Error('配色星期請選擇星期一至星期五');
  if (!!startRaw !== !!endRaw) throw new Error('配色節次請同時填寫起始與結束');
  if (!startRaw) return true;
  const start = colorRulePeriod_(startRaw);
  const end = colorRulePeriod_(endRaw);
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('配色節次請填寫第 1 至第 8 節');
  if (start > end) throw new Error('配色起始節次不可晚於結束節次');
  return true;
}

function scheduleColorRuleMatches_(rule, scheduleRow) {
  const day = String(rule['星期'] == null ? '' : rule['星期']).trim();
  if (day && day !== String(parseInt(scheduleRow['星期'], 10))) return false;
  const startRaw = String(rule['起始節次'] == null ? '' : rule['起始節次']).trim();
  const endRaw = String(rule['結束節次'] == null ? '' : rule['結束節次']).trim();
  if (!startRaw && !endRaw) return true;
  const period = parseInt(scheduleRow['節次'], 10);
  const start = colorRulePeriod_(startRaw);
  const end = colorRulePeriod_(endRaw);
  return Number.isFinite(period) && Number.isFinite(start) && Number.isFinite(end) && period >= start && period <= end;
}

function hasExplicitScheduleColor_(rules, scheduleRow) {
  const subject = String(scheduleRow['科目代碼'] || '').trim();
  const classCode = String(scheduleRow['班級代碼'] || '').trim();
  return (rules || []).some(rule => {
    const color = String(rule['底色'] || '').trim().replace(/^#/, '');
    if (!/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(color)) return false;
    return exportFieldMatches_(rule['科目'], subject, ['全部科目', '所有科目', '全科目']) &&
      exportFieldMatches_(rule['班級'], classCode, ['全部班級', '所有班級', '全班']) &&
      scheduleColorRuleMatches_(rule, scheduleRow);
  });
}

function isPatrolScheduleRow_(row) {
  if (!row) return false;
  return [row['課堂屬性'], row['班級代碼'], row['科目代碼']]
    .some(value => String(value || '').trim().indexOf('巡堂') >= 0);
}

function normalizePatrolScheduleRow_(row) {
  if (!isPatrolScheduleRow_(row)) return row;
  return Object.assign({}, row, {
    '班級代碼': '',
    '科目代碼': '',
    '課堂屬性': '巡堂',
    '是否鎖定': 'TRUE'
  });
}

function isManualOnlyPeriod_(period) {
  const value = parseInt(period, 10);
  return value === 0 || value === 45;
}

function isPreservedManualScheduleEntry_(entry) {
  if (!entry) return false;
  const period = parseInt(entry['節次'], 10);
  const attr = String(entry['課堂屬性'] || '').trim();
  return isManualOnlyPeriod_(period) || (period === 8 && (attr === '單週' || attr === '雙週'));
}

function isVirtualClassRow_(classMap, classCode) {
  const row = (classMap || {})[String(classCode || '').trim()] || {};
  const value = String(row['是否虛擬班'] || '').trim().toUpperCase();
  return value === 'TRUE' || value === '1' || value === 'YES' || value === '是';
}

function exportScheduleAttr_(scheduleRow, classMap, teacherEntry) {
  if (isPatrolScheduleRow_(scheduleRow)) return '巡堂';
  const period = parseInt(scheduleRow['節次'], 10);
  const rawAttr = String(scheduleRow['課堂屬性'] || '').trim();
  const classInfo = (classMap || {})[String(scheduleRow['班級代碼'] || '').trim()] || {};
  const isVirtual = exportTruthy_(classInfo['是否虛擬班']);
  if (isManualOnlyPeriod_(period)) return '抽離';
  if (isVirtual || rawAttr === '抽離') return '抽離';
  if (period !== 8 && (rawAttr === '超鐘點' || (teacherEntry && exportTruthy_(teacherEntry.overtime)))) return '超鐘點';
  if (rawAttr === '單週' || rawAttr === '雙週') return rawAttr;
  if (rawAttr === '實支') return '實支';
  if (rawAttr === '課輔') return '課輔';
  if (rawAttr === '預排') return '預排';
  if (period === 8) return '課輔';
  if (rawAttr === '巡堂') return '巡堂';
  return '一般';
}

function isExportBoundCourse_(scheduleRow, blockGroups) {
  if (!scheduleRow) return false;
  const classCode = String(scheduleRow['班級代碼'] || '').trim();
  const subjectCode = String(scheduleRow['科目代碼'] || '').trim();
  if (!classCode || !subjectCode) return false;
  return (blockGroups || []).some(group => {
    const classes = typeof group['班級清單'] === 'number'
      ? String(group['班級清單']).match(/.{3}/g) || []
      : splitExportList_(group['班級清單']);
    const subjects = splitExportList_(group['科目清單'] || group['科目代碼']);
    return classes.length >= 2 && classes.includes(classCode) && subjects.includes(subjectCode);
  });
}

function isExportPreplannedCourse_(scheduleRow, assignments) {
  if (!scheduleRow) return false;
  const classCode = String(scheduleRow['班級代碼'] || '').trim();
  const subjectCode = String(scheduleRow['科目代碼'] || '').trim();
  if (!classCode || !subjectCode) return false;
  return (assignments || []).some(assignment =>
    String(assignment['班級代碼'] || '').trim() === classCode &&
    String(assignment['科目代碼'] || '').trim() === subjectCode &&
    String(assignment['課程屬性'] || '').trim() === '預排'
  );
}

function exportScheduleSpecialTags_(scheduleRow, blockGroups, assignments) {
  if (!scheduleRow || isPatrolScheduleRow_(scheduleRow)) return '';
  const tags = [];
  if (splitExportList_(scheduleRow['班級代碼']).length > 1) tags.push('併班');
  if (isExportBoundCourse_(scheduleRow, blockGroups)) {
    if (!tags.includes('併班')) tags.push('併班');
    tags.push('綁課');
  }
  if (isExportPreplannedCourse_(scheduleRow, assignments)) tags.push('預排');
  return [...new Set(tags)].join('、');
}

function exportScheduleRowId_(scheduleRow, semesterId, scheduleIndex, teacherCount, teacherIndex, usedIds) {
  const base = String(scheduleRow && scheduleRow['課表ID'] || '').trim() ||
    'schedule_' + semesterId + '_' + scheduleIndex;
  let id = teacherCount > 1 ? base + '__teacher' + (teacherIndex + 1) : base;
  let suffix = 2;
  while (usedIds.has(id)) id = base + '__export' + suffix++;
  usedIds.add(id);
  return id;
}

function exportScheduleExceptions_(ss) {
  const settings = getSettingsMap_(ss);
  const semId = settings['學期代號'] || '114-1';
  const exceptions = sheetToObjects_(ss.getSheetByName('課表例外'))
    .filter(row => scheduleExceptionTruthy_(row['是否啟用']))
    .filter(row => String(row['學期代號'] || semId).trim() === semId)
    .sort((left, right) => String(left['日期A'] || '').localeCompare(String(right['日期A'] || '')));
  const headers = ['學期代號', '例外ID', '事件名稱', '實際日期', '實際星期', '實際節次', '來源星期', '來源節次', '適用範圍', '備註'];
  const rows = [];
  exceptions.forEach(exception => {
    scheduleExceptionMappings_(exception).forEach(mapping => {
      rows.push([
        String(exception['學期代號'] || semId),
        String(exception['例外ID'] || ''),
        String(exception['事件名稱'] || ''),
        String(mapping['實際日期'] || ''),
        parseInt(mapping['實際星期'], 10),
        parseInt(mapping['實際節次'], 10),
        parseInt(mapping['來源星期'], 10),
        parseInt(mapping['來源節次'], 10),
        String(exception['適用範圍'] || '全校'),
        String(exception['備註'] || '')
      ]);
    });
  });
  return writeExportSheet_(ss, '課表例外匯出_' + semId, headers, rows);
}

function exportSchedule_(ss) {
  const schedule = sheetToObjects_(ss.getSheetByName('課表'));
  const teachers = sheetToObjects_(ss.getSheetByName('教師'));
  const classes = sheetToObjects_(ss.getSheetByName('班級'));
  const assignments = sheetToObjects_(ss.getSheetByName('配課'));
  const blockGroups = sheetToObjects_(ss.getSheetByName('綁班'));
  const colorRules = sheetToObjects_(ss.getSheetByName('配色'));
  const settings = getSettingsMap_(ss);
  const semId = settings['學期代號'] || '114-1';
  const teacherMap = {};
  teachers.forEach(row => {
    const code = String(row['教師姓名'] || '').trim();
    if (code) teacherMap[code] = row;
  });
  const classMap = {};
  classes.forEach(row => {
    const code = String(row['班級代碼'] || '').trim();
    if (code) classMap[code] = row;
  });
  const headers = ['學期代號', '課表ID', '教師Email', '教師姓名', '星期', '節次', '班級', '科目', '課堂屬性', '調課限制', '特殊標記'];
  const emailMissing = [];
  const emailMissingSeen = {};
  const usedIds = new Set();
  const rows = [];
  schedule.forEach((s, scheduleIndex) => {
    const patrol = isPatrolScheduleRow_(s);
    const parsedTeachers = parseExportTeachers_(s['教師姓名']);
    const teacherEntries = parsedTeachers.length ? parsedTeachers : [{ code: '', label: '' }];
    teacherEntries.forEach((entry, teacherIndex) => {
      const code = String(entry.code || '').trim();
      const teacher = teacherMap[code] || {};
      const name = String(teacher['教師姓名'] || code || '').trim();
      if (name && !String(teacher['Email'] || '').trim() && !emailMissingSeen[name]) {
        emailMissingSeen[name] = true;
        emailMissing.push(name);
      }
      const bound = !patrol && isExportBoundCourse_(s, blockGroups);
      const restriction = patrol ? '' : (bound || hasExplicitScheduleColor_(colorRules, s) ? 'restricted' : '');
      rows.push([
        semId,
        exportScheduleRowId_(s, semId, scheduleIndex, teacherEntries.length, teacherIndex, usedIds),
        teacher['Email'] || '',
        name,
        parseInt(s['星期'], 10),
        parseInt(s['節次'], 10),
        patrol ? '' : String(s['班級代碼'] || ''),
        patrol ? '' : String(s['科目代碼'] || ''),
        exportScheduleAttr_(s, classMap, entry),
        restriction,
        exportScheduleSpecialTags_(s, blockGroups, assignments)
      ]);
    });
  });
  const result = writeExportSheet_(ss, '課表匯出_' + semId, headers, rows);
  result.emailMissing = emailMissing;
  return result;
}

function exportPatrolSchedule_(ss) {
  const schedule = sheetToObjects_(ss.getSheetByName('課表'))
    .filter(isPatrolScheduleRow_)
    .sort((left, right) => parseInt(left['星期'], 10) - parseInt(right['星期'], 10) ||
      parseInt(left['節次'], 10) - parseInt(right['節次'], 10) ||
      String(left['教師姓名'] || '').localeCompare(String(right['教師姓名'] || ''), 'zh-Hant'));
  const teachers = sheetToObjects_(ss.getSheetByName('教師'));
  const settings = getSettingsMap_(ss);
  const semId = settings['學期代號'] || '114-1';
  const teacherMap = {};
  teachers.forEach(row => {
    const code = String(row['教師姓名'] || '').trim();
    if (code) teacherMap[code] = row;
  });
  const headers = ['學期代號', '教師Email', '教師姓名', '星期', '節次', '班級', '科目', '課堂屬性', '調課限制', '特殊標記'];
  const emailMissing = [];
  const emailMissingSeen = {};
  const rows = [];
  schedule.forEach(row => {
    const parsedTeachers = parseExportTeachers_(row['教師姓名']);
    const entries = parsedTeachers.length ? parsedTeachers : [{ code: '', label: '' }];
    entries.forEach(entry => {
      const code = String(entry.code || '').trim();
      const teacher = teacherMap[code] || {};
      const name = String(teacher['教師姓名'] || code || '').trim();
      if (name && !String(teacher['Email'] || '').trim() && !emailMissingSeen[name]) {
        emailMissingSeen[name] = true;
        emailMissing.push(name);
      }
      rows.push([semId, teacher['Email'] || '', name, parseInt(row['星期'], 10), parseInt(row['節次'], 10), '', '', '巡堂', '', '']);
    });
  });
  const result = writeExportSheet_(ss, '巡堂匯出_' + semId, headers, rows);
  result.emailMissing = emailMissing;
  return result;
}

function isPatrolEligibleTeacherRow_(teacher) {
  const title = String(teacher && (teacher['職務'] || teacher['職稱']) || '').trim();
  return /行政|組長|主任/.test(title);
}

function validatePatrolScheduleRows_(patrolRows, currentRows, teachers, teacherBlocks) {
  const errors = [];
  const teacherMap = {};
  (teachers || []).forEach(row => {
    const code = String(row['教師姓名'] || row['姓名'] || '').trim();
    if (code) teacherMap[code] = row;
  });
  const occupiedTeacherSlots = new Set();
  const existingIds = new Set();
  (currentRows || []).forEach(row => {
    if (isPatrolScheduleRow_(row)) return;
    const id = String(row['課表ID'] || '').trim();
    if (id) existingIds.add(id);
    const day = parseInt(row['星期'], 10);
    const period = parseInt(row['節次'], 10);
    if (!Number.isFinite(day) || !Number.isFinite(period)) return;
    teacherCodesFromValue_(row['教師姓名']).forEach(code => {
      occupiedTeacherSlots.add(String(code).trim() + '|' + day + '|' + period);
    });
  });

  const seenIds = new Set();
  const seenPatrolSlots = new Set();
  (patrolRows || []).forEach(row => {
    const id = String(row['課表ID'] || '').trim();
    const day = parseInt(row['星期'], 10);
    const period = parseInt(row['節次'], 10);
    const teacherCodes = teacherCodesFromValue_(row['教師姓名']);
    const teacherCode = teacherCodes.length === 1 ? String(teacherCodes[0]).trim() : '';
    if (!isPatrolScheduleRow_(row)) {
      errors.push('巡堂資料格式錯誤：' + (id || '未命名巡堂'));
      return;
    }
    if (id && (seenIds.has(id) || existingIds.has(id))) {
      errors.push('巡堂課表ID重複：' + id);
    }
    if (id) seenIds.add(id);
    if (teacherCodes.length !== 1) {
      errors.push('巡堂每列只能有一位教師：' + (id || '未命名巡堂'));
      return;
    }
    if (!Number.isFinite(day) || day < 1 || day > 5 || !Number.isFinite(period) || period < 1 || period > 8) {
      errors.push('巡堂時段無效：' + (id || '未命名巡堂'));
      return;
    }
    const teacher = teacherMap[teacherCode];
    if (!teacher) {
      errors.push('巡堂教師不存在：' + teacherCode);
    } else if (!isPatrolEligibleTeacherRow_(teacher)) {
      errors.push('巡堂教師資格不符：' + teacherCode);
    }
    const slotKey = day + '|' + period;
    if (seenPatrolSlots.has(slotKey)) {
      errors.push('同一星期與節次只能安排一位巡堂教師：' + slotKey);
    }
    seenPatrolSlots.add(slotKey);
    if (occupiedTeacherSlots.has(teacherCode + '|' + day + '|' + period)) {
      errors.push('巡堂教師已有課程：' + teacherCode + ' 星期' + day + '第' + period + '節');
    }
    if ((teacherBlocks || []).some(block => teacherBlockHasSlot_(block, teacherCode, day, period))) {
      errors.push('巡堂教師設定為不排課：' + teacherCode + ' 星期' + day + '第' + period + '節');
    }
  });
  return Array.from(new Set(errors));
}

function savePatrolSchedule_(ss, payload) {
  const ownsLock = !(payload && payload.__lockAlreadyHeld);
  const lock = ownsLock && typeof LockService !== 'undefined' ? LockService.getScriptLock() : null;
  if (lock && !lock.tryLock(30000)) return { blocked: true, error: '目前有另一個課表寫入作業進行中，請稍後再試' };
  try {
    const sheet = ss.getSheetByName('課表');
    const currentRows = sheetToObjects_(sheet);
    const currentPatrolRows = currentRows.filter(isPatrolScheduleRow_).map(normalizePatrolScheduleRow_);
    const baseRevision = String(payload && payload.baseRevision || '').trim();
    const currentRevision = scheduleRevision_(currentRows);
    if (Array.isArray(payload && payload.basePatrolSchedule)) {
      const basePatrolRows = payload.basePatrolSchedule.map(normalizePatrolScheduleRow_);
      if (scheduleRevision_(basePatrolRows) !== scheduleRevision_(currentPatrolRows)) {
        return { blocked: true, conflict: true, error: '巡堂資料已被其他視窗更新，為避免覆蓋新巡堂，本次寫入已取消', currentRevision };
      }
    } else if (baseRevision && baseRevision !== currentRevision) {
      return { blocked: true, conflict: true, error: '課表已被其他視窗更新，為避免覆蓋新資料，本次巡堂寫入已取消', currentRevision };
    }

    if (!payload || !Array.isArray(payload.patrolSchedule)) {
      return { blocked: true, error: '巡堂資料格式錯誤：缺少巡堂課表陣列' };
    }
    const patrolRows = payload.patrolSchedule.map(normalizePatrolScheduleRow_);
    const teachers = sheetToObjects_(ss.getSheetByName('教師'));
    const teacherBlocks = sheetToObjects_(ss.getSheetByName('不排課'));
    const errors = validatePatrolScheduleRows_(patrolRows, currentRows, teachers, teacherBlocks);
    if (errors.length) {
      return { blocked: true, error: '巡堂資料稽核失敗：' + errors.slice(0, 20).join('；') };
    }

    const schedule = currentRows.filter(row => !isPatrolScheduleRow_(row)).concat(patrolRows);
    const headers = SHEET_DEFS['課表'].headers;
    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).clearContent();
    }
    if (schedule.length) {
      const rows = schedule.map(row => [
        row['課表ID'] || genId_(),
        String(row['班級代碼'] || ''),
        parseInt(row['星期'], 10),
        parseInt(row['節次'], 10),
         String(row['科目代碼'] || ''),
         Array.isArray(row['教師姓名']) ? JSON.stringify(row['教師姓名']) : String(row['教師姓名'] || ''),
         String(row['課堂屬性'] || '一般'),
         row['是否鎖定'] === 'TRUE' || row['是否鎖定'] === true ? 'TRUE' : 'FALSE'
       ]);
      sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    }
    const savedRows = sheetToObjects_(sheet);
    return {
      count: savedRows.length,
      patrolCount: savedRows.filter(isPatrolScheduleRow_).length,
      scheduleRevision: scheduleRevision_(savedRows)
    };
  } finally {
    if (lock) lock.releaseLock();
  }
}

// 匯出教師名單（欄位對齊調代課系統教師名單匯入）
function exportTeachers_(ss) {
  const teachers = sheetToObjects_(ss.getSheetByName('教師'));
  const settings = getSettingsMap_(ss);
  const semId = settings['學期代號'] || '114-1';

  const headers = ['學期代號', '教師Email', '教師姓名', '授課科目', '職務', '基本鐘點', '系統角色'];
  // 職稱與調代課 normalizeRole 對齊：教學組／主任／管理／主管視為 admin、行政視為 staff，其餘留空（調代課預設 teacher）
  const roleOf = function (title) {
    const s = String(title || '');
    if (/教學|主任|管理|主管/.test(s)) return 'admin';
    if (/行政/.test(s)) return 'staff';
    return '';
  };
  const emailMissing = [];
  const rows = [];
  for (let i = 0; i < teachers.length; i++) {
    const t = teachers[i];
    const name = t['教師姓名'] || '';
    if (!name) continue;
    if (!t['Email']) emailMissing.push(name);
    rows.push([
      semId,
      t['Email'] || '',
      name,
      t['任教科目'] || '',
      t['職稱'] || '',
      (t['基本鐘點'] !== undefined && t['基本鐘點'] !== null && t['基本鐘點'] !== '') ? t['基本鐘點'] : '',
      roleOf(t['職稱'])
    ]);
  }

  const result = writeExportSheet_(ss, '教師匯出_' + semId, headers, rows);
  result.emailMissing = emailMissing;
  return result;
}

// ===================== 驗證管理員 =====================

function verifyAdmin_(password) {
  const settings = getSettingsMap_(SpreadsheetApp.getActiveSpreadsheet());
  const pwd = settings['AdminPassword'] || '';
  if (!pwd) return { ok: false, error: '未設定管理員密碼' };
  if (password !== pwd) return { ok: false, error: '密碼錯誤' };
  return { ok: true };
}

// ===================== 工具 =====================

function genId_() {
  return Utilities.getUuid().replace(/-/g, '').substring(0, 12);
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


// ===================== 初始化預設資料 =====================

/**
 * 手動初始化預設資料（包含建成國中科目、班級、教師範例）
 * 可在 Apps Script 編輯器中下拉點選此函數執行，或透過網頁按鈕觸發
 */
function initDefaultData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const res = initDefaultData_(ss, false);
  Logger.log('初始化結果：' + JSON.stringify(res));
}

function initDefaultData_(ss, overwrite) {
  ensureAllSheets_(ss);

  // 1. 建成國中預設科目清單（114學年度實體課表精確節數）
  const defaultSubjects = [
    ['國文', '5', '0', '1', '全校', ''],
    ['英語', '3', '0', '1', '全校', ''],
    ['數學', '4', '0', '1', '全校', ''],
    ['生物', '3', '0', '1', '7', ''],
    ['理化', '3', '0', '1', '8', ''],
    ['自然', '3', '0', '1', '9', ''],
    ['歷史', '1', '0', '1', '全校', ''],
    ['地理', '1', '0', '1', '全校', ''],
    ['公民', '1', '0', '1', '全校', ''],
    ['體育', '2', '2', '2', '全校', ''],
    ['健康教育', '1', '0', '1', '全校', ''],
    ['音樂', '1', '0', '1', '全校', ''],
    ['視覺藝術', '1', '0', '1', '全校', ''],
    ['表演藝術', '1', '0', '1', '全校', ''],
    ['家政', '1', '0', '1', '全校', ''],
    ['童軍', '1', '0', '1', '全校', ''],
    ['輔導', '1', '0', '1', '全校', ''],
    ['生活科技', '1', '0', '1', '全校', ''],
    ['資訊科技', '1', '0', '1', '全校', ''],
    ['班週會', '1', '0', '1', '全校', ''],
    ['本土語', '1', '0', '1', '7,8', ''],
    ['走讀建成生活圈', '1', '0', '1', '7', ''],
    ['文旅享繪', '1', '0', '1', '7', ''],
    ['活力建成', '1', '0', '1', '全校', ''],
    ['全球議題', '1', '0', '1', '7,8', ''],
    ['建成公民行動家', '1', '0', '1', '8', ''],
    ['文化種籽在建成', '1', '0', '1', '8', ''],
    ['全球素養', '1', '0', '1', '9', ''],
    ['英悅讀樂樂', '1', '0', '1', '9', ''],
    ['閱思溝通建成人', '1', '0', '1', '9', ''],
    ['藝統摺學', '1', '0', '1', '9', ''],
    ['資優英語', '2', '0', '1', '全校', ''],
    ['學習策略', '2', '0', '1', '全校', ''],
    ['社會技巧', '1', '0', '1', '全校', ''],
    ['視唱聽寫', '2', '0', '1', '全校', '707,807,808,907'],
    ['音樂史與樂曲賞析', '2', '0', '1', '全校', '707,807,808,907'],
    ['絲竹室內樂', '2', '0', '1', '全校', '707,807,808,907'],
    ['術科', '2', '0', '1', '全校', '707,807,808,907'],
    ['樂理', '2', '0', '1', '7', '707'],
    ['基礎和聲', '2', '0', '1', '8', '807,808'],
    ['音樂專題', '2', '0', '1', '9', '907']
  ];

  const subSheet = ss.getSheetByName('科目');
  const existingSub = sheetToObjects_(subSheet);
  const existSubCodes = new Set(existingSub.map(r => String(r['科目代碼'])));
  let subAdded = 0;
  defaultSubjects.forEach(row => {
    if (!existSubCodes.has(row[0])) {
      subSheet.appendRow(row);
      subAdded++;
    }
  });

    // 2. 預設班級（每年級 1~7 班，無虛擬班）
  const defaultClasses = [
    ['701', '7', '七年一班', '', '一般', 'FALSE', ''],
    ['702', '7', '七年二班', '', '一般', 'FALSE', ''],
    ['703', '7', '七年三班', '', '一般', 'FALSE', ''],
    ['704', '7', '七年四班', '', '一般', 'FALSE', ''],
    ['705', '7', '七年五班', '', '一般', 'FALSE', ''],
    ['706', '7', '七年六班', '', '一般', 'FALSE', ''],
    ['707', '7', '七年七班', '', '一般', 'FALSE', ''],
    ['801', '8', '八年一班', '', '一般', 'FALSE', ''],
    ['802', '8', '八年二班', '', '一般', 'FALSE', ''],
    ['803', '8', '八年三班', '', '一般', 'FALSE', ''],
    ['804', '8', '八年四班', '', '一般', 'FALSE', ''],
    ['805', '8', '八年五班', '', '一般', 'FALSE', ''],
    ['806', '8', '八年六班', '', '一般', 'FALSE', ''],
    ['807', '8', '八年七班', '', '一般', 'FALSE', ''],
    ['901', '9', '九年一班', '', '一般', 'FALSE', ''],
    ['902', '9', '九年二班', '', '一般', 'FALSE', ''],
    ['903', '9', '九年三班', '', '一般', 'FALSE', ''],
    ['904', '9', '九年四班', '', '一般', 'FALSE', ''],
    ['905', '9', '九年五班', '', '一般', 'FALSE', ''],
    ['906', '9', '九年六班', '', '一般', 'FALSE', ''],
    ['907', '9', '九年七班', '', '一般', 'FALSE', '']
  ];

  const clsSheet = ss.getSheetByName('班級');
  const existingCls = sheetToObjects_(clsSheet);
  const existClsCodes = new Set(existingCls.map(r => String(r['班級代碼'])));
  let clsAdded = 0;
  defaultClasses.forEach(row => {
    if (!existClsCodes.has(row[0])) {
      clsSheet.appendRow(row);
      clsAdded++;
    }
  });

  // 3. 預設教師（不使用預設教師）
  const defaultTeachers = [];

  const teaSheet = ss.getSheetByName('教師');
  const existingTea = sheetToObjects_(teaSheet);
  const existTeaCodes = new Set(existingTea.map(r => String(r['教師姓名'])));
  let teaAdded = 0;
  defaultTeachers.forEach(row => {
    if (!existTeaCodes.has(row[0])) {
      teaSheet.appendRow(row);
      teaAdded++;
    }
  });

  return { ok: true, subAdded, clsAdded, teaAdded };
}


function parseFrozenRuleDay_(value) {
  const raw = String(value || '').trim();
  if (/^[1-5]$/.test(raw)) return parseInt(raw, 10);
  if (raw.indexOf('一') >= 0 || raw.indexOf('Mon') >= 0) return 1;
  if (raw.indexOf('二') >= 0 || raw.indexOf('Tue') >= 0) return 2;
  if (raw.indexOf('三') >= 0 || raw.indexOf('Wed') >= 0) return 3;
  if (raw.indexOf('四') >= 0 || raw.indexOf('Thu') >= 0) return 4;
  if (raw.indexOf('五') >= 0 || raw.indexOf('Fri') >= 0) return 5;
  return 0;
}

function parseFrozenRuleSlots_(rule) {
  const slots = [];
  const add = (day, period) => {
    const d = parseInt(day, 10), p = parseInt(period, 10);
    if (d >= 1 && d <= 5 && p >= 1 && p <= 8) slots.push({ day: d, period: p });
  };
  const directDay = String(rule && rule['星期'] || '').trim();
  const directPeriod = String(rule && rule['節次'] || '').trim();
  if (directDay && directPeriod) add(parseFrozenRuleDay_(directDay), directPeriod);
  const raw = String(rule && rule['時段'] || '').trim();
  raw.split(/[,;\s]+/).forEach(token => {
    if (!token) return;
    const zh = token.match(/(?:週|星期)?([一二三四五1-5])[^\d]*(\d+)/);
    if (zh) { add(parseFrozenRuleDay_(zh[1]), zh[2]); return; }
    const pair = token.match(/^([1-5])\s*[-_/.:]\s*([1-8])$/);
    if (pair) add(pair[1], pair[2]);
  });
  return slots;
}

// 只有明確指定同日連續必排節次的課程，才允許指定長度的連堂區塊。
function getMandatoryRuleDaySlots_(subjectCode, classCode, day, subjectRules, classes) {
  const targetDay = parseInt(day, 10);
  const periods = new Set();
  (subjectRules || []).forEach(rule => {
    if (String(rule['規則類型'] || '').trim() !== '必排') return;
    if (!subjectRuleMatches_(rule, subjectCode, classCode, classes)) return;
    parseFrozenRuleSlots_(rule).forEach(slot => {
      if (slot.day === targetDay) periods.add(slot.period);
    });
  });
  const sorted = Array.from(periods).sort((left, right) => left - right);
  if (sorted.length < 2 || sorted.some((period, index) => index > 0 && period !== sorted[index - 1] + 1)) return [];
  return sorted.map(period => ({ day: targetDay, period }));
}

function isAllowedMandatorySameDayBlock_(subjectCode, classCode, day, periods, subjectRules, classes) {
  const mandatorySlots = getMandatoryRuleDaySlots_(subjectCode, classCode, day, subjectRules, classes);
  const actual = Array.from(new Set((periods || []).map(period => parseInt(period, 10))));
  const allowed = new Set(mandatorySlots.map(slot => slot.period));
  return mandatorySlots.length > 1 && actual.length === mandatorySlots.length && actual.every(period => allowed.has(period));
}

function isValidMandatorySameDayProgress_(subjectCode, classCode, day, periods, subjectRules, classes) {
  const mandatorySlots = getMandatoryRuleDaySlots_(subjectCode, classCode, day, subjectRules, classes);
  const actual = Array.from(new Set((periods || []).map(period => parseInt(period, 10))));
  const allowed = new Set(mandatorySlots.map(slot => slot.period));
  return mandatorySlots.length > 1 && actual.length <= mandatorySlots.length && actual.every(period => allowed.has(period));
}

// 前後端一致保護上鎖，以及正確落在必排時段的課程。
function isFrozenScheduleEntry_(entry, subjectRules, classes) {
  if (!entry) return false;
  if ([entry['課堂屬性'], entry['班級代碼'], entry['科目代碼']]
    .some(value => String(value || '').trim().indexOf('巡堂') >= 0)) return false;
  if (String(entry['是否鎖定'] || '').toUpperCase() === 'TRUE') return true;
  const subjectCode = String(entry['科目代碼'] || '').trim();
  const classCode = String(entry['班級代碼'] || '').trim();
  const day = parseInt(entry['星期'], 10);
  const period = parseInt(entry['節次'], 10);
  if (period === 0 || period === 45 || (period === 8 &&
      (String(entry['課堂屬性'] || '').trim() === '單週' || String(entry['課堂屬性'] || '').trim() === '雙週'))) return true;
  if (!subjectCode || !classCode || !Number.isFinite(day) || !Number.isFinite(period)) return false;
  return (subjectRules || []).some(rule =>
    String(rule['規則類型'] || '').trim() === '必排' &&
    subjectRuleMatches_(rule, subjectCode, classCode, classes) &&
    parseFrozenRuleSlots_(rule).some(slot => slot.day === day && slot.period === period)
  );
}

function isExplicitlyLockedScheduleEntry_(entry) {
  return Boolean(entry) && !isPatrolScheduleRow_(entry) && String(entry['是否鎖定'] || '').toUpperCase() === 'TRUE';
}

function isLockedConsecutiveScheduleEntry_(entry, rows) {
  if (!entry || isPatrolScheduleRow_(entry)) return false;
  const classCode = String(entry['班級代碼'] || '').trim();
  const subjectCode = String(entry['科目代碼'] || '').trim();
  const day = parseInt(entry['星期'], 10);
  const period = parseInt(entry['節次'], 10);
  if (!classCode || !subjectCode || !Number.isFinite(day) || !Number.isFinite(period)) return false;
  const peers = (Array.isArray(rows) ? rows : []).filter(candidate =>
    candidate && !isPatrolScheduleRow_(candidate) &&
    String(candidate['班級代碼'] || '').trim() === classCode &&
    String(candidate['科目代碼'] || '').trim() === subjectCode &&
    parseInt(candidate['星期'], 10) === day &&
    Number.isFinite(parseInt(candidate['節次'], 10))
  );
  if (peers.length < 2) return false;
  const periods = new Set(peers.map(candidate => parseInt(candidate['節次'], 10)));
  return peers.some(candidate => {
    if (!isExplicitlyLockedScheduleEntry_(candidate)) return false;
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

function isClearProtectedScheduleEntry_(entry, rows) {
  const isPullOut = String(entry && entry['課堂屬性'] || '').trim() === '抽離';
  return (isPreservedManualScheduleEntry_(entry) && !isPullOut && !isClearablePeriodEightScheduleEntry_(entry)) ||
    isExplicitlyLockedScheduleEntry_(entry) || isLockedConsecutiveScheduleEntry_(entry, rows);
}

function isClearablePeriodEightScheduleEntry_(entry) {
  const period = parseInt(entry && entry['節次'], 10);
  const attr = String(entry && entry['課堂屬性'] || '').trim();
  return period === 8 && (attr === '單週' || attr === '雙週');
}

function isClearFrozenScheduleEntry_(entry, subjectRules, classes) {
  if (isPatrolScheduleRow_(entry)) return false;
  const explicitlyLocked = String(entry && entry['是否鎖定'] || '').toUpperCase() === 'TRUE';
  if (explicitlyLocked) return true;
  if (String(entry && entry['課堂屬性'] || '').trim() === '抽離') return false;
  return isFrozenScheduleEntry_(entry, subjectRules, classes) &&
    (!isClearablePeriodEightScheduleEntry_(entry) || explicitlyLocked);
}

function isClearScopeTarget_(entry, scope, subjectRules, classes, blockGroups, currentRows) {
  if (!entry) return false;
  if (isLockedConsecutiveScheduleEntry_(entry, currentRows)) return false;
  if (scope === 'period-8') return parseInt(entry['節次'], 10) === 8;
  if (scope !== 'second-round') return scope === 'all';
  const period = parseInt(entry['節次'], 10);
  if (!Number.isFinite(period) || period < 1 || period > 7) return false;
  const subjectCode = String(entry['科目代碼'] || '').trim();
  const classCode = String(entry['班級代碼'] || '').trim();
  const hasMandatoryRule = (subjectRules || []).some(rule =>
    String(rule['規則類型'] || '').trim() === '必排' &&
    subjectRuleMatches_(rule, subjectCode, classCode, classes)
  );
  return !hasMandatoryRule && !getBindGroupForEntry_(entry, blockGroups);
}

function splitBindList_(value) {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'number') return String(value).match(/.{3}/g) || [];
  return String(value == null ? '' : value)
    .split(/[,，、;；]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function getConfiguredBindClasses_(group, subjectCode, assignments) {
  const subject = String(subjectCode || '').trim();
  return [...new Set(getConfiguredBindMembers_(group, assignments)
    .filter(member => member.subjectCode === subject)
    .map(member => member.classCode))];
}

function getConfiguredBindMembers_(group, assignments) {
  const groupClasses = splitBindList_(group['班級清單']);
  const groupSubjects = splitBindList_(group['科目清單'] || group['科目代碼']);
  const rows = Array.isArray(assignments) ? assignments : [];
  const members = [];
  groupClasses.forEach(classCode => {
    const assignedSubjects = groupSubjects.filter(subjectCode => rows.some(assignment =>
      String(assignment['班級代碼'] || '').trim() === classCode &&
      String(assignment['科目代碼'] || '').trim() === subjectCode
    ));
    const activeSubjects = assignedSubjects.length > 0 ? assignedSubjects : groupSubjects;
    activeSubjects.forEach(subjectCode => members.push({ classCode, subjectCode }));
  });
  return members;
}

function getConfiguredBindCohortMembers_(group, subjectCode, classCode, assignments) {
  const members = getConfiguredBindMembers_(group, assignments);
  const byClass = {};
  members.forEach(member => {
    if (!byClass[member.classCode]) byClass[member.classCode] = [];
    byClass[member.classCode].push(member);
  });
  const targetMembers = byClass[String(classCode || '').trim()] || [];
  const targetIndex = targetMembers.findIndex(member => member.subjectCode === String(subjectCode || '').trim());
  if (targetIndex < 0) return [];
  return Object.keys(byClass).map(key => byClass[key][targetIndex]).filter(Boolean);
}

function getBindGroupForEntry_(entry, blockGroups) {
  if (!entry) return null;
  const subjectCode = String(entry['科目代碼'] || '').trim();
  const classCode = String(entry['班級代碼'] || '').trim();
  if (!subjectCode || !classCode) return null;
  return (blockGroups || []).find(group => {
    const classes = splitBindList_(group['班級清單']);
    return classes.length >= 2 &&
      splitBindList_(group['科目清單'] || group['科目代碼']).includes(subjectCode) &&
      classes.includes(classCode);
  }) || null;
}

function bindScheduleSlotKey_(row) {
  const period = parseInt(row['節次'], 10);
  const attr = period === 8 ? String(row['課堂屬性'] || '一般') : '一般';
  return [row['星期'], period, attr].join('|');
}

function boundScheduleChangeCheck_(currentRows, incomingRows, blockGroups, assignments) {
  const incomingById = new Map();
  (incomingRows || []).forEach(row => {
    const id = String(row['課表ID'] || '').trim();
    if (id) incomingById.set(id, row);
  });
  const instances = new Map();
  (currentRows || []).forEach(row => {
    const group = getBindGroupForEntry_(row, blockGroups);
    const id = String(row['課表ID'] || '').trim();
    if (!group || !id) return;
    const key = String(group['群組ID'] || group['群組名稱'] || '');
    if (!instances.has(key)) instances.set(key, { group, rows: [] });
    instances.get(key).rows.push(row);
  });

  for (const instance of instances.values()) {
    const groupKey = String(instance.group['群組ID'] || instance.group['群組名稱'] || '');
    const incomingGroupRows = (incomingRows || []).filter(row => {
      const group = getBindGroupForEntry_(row, blockGroups);
      return group && String(group['群組ID'] || group['群組名稱'] || '') === groupKey;
    });
    // 整組刪除是允許的；只刪掉其中一班則拒絕。
    if (incomingGroupRows.length === 0) continue;
    for (const before of instance.rows) {
      const after = incomingById.get(String(before['課表ID'] || '').trim());
      const afterGroup = after ? getBindGroupForEntry_(after, blockGroups) : null;
      const afterGroupKey = afterGroup ? String(afterGroup['群組ID'] || afterGroup['群組名稱'] || '') : '';
      if (!after) {
        return { ok: false, blocked: true, error: '綁班課程不可只移動或刪除其中一班，請整組處理' };
      }
      if (String(before['班級代碼'] || '') !== String(after['班級代碼'] || '') ||
          !afterGroup || afterGroupKey !== groupKey) {
        return { ok: false, blocked: true, error: '綁班課程的班級或綁班群組不可被單獨改動' };
      }
    }

    const members = getConfiguredBindMembers_(instance.group, assignments);
    const expectedClasses = [...new Set(members.map(member => member.classCode))];
    const incomingByClass = new Map(expectedClasses.map(classCode => [classCode, []]));
    incomingGroupRows.forEach(row => {
      const classCode = String(row['班級代碼'] || '').trim();
      if (incomingByClass.has(classCode)) incomingByClass.get(classCode).push(row);
    });
    const signatures = expectedClasses.map(classCode => new Set((incomingByClass.get(classCode) || [])
      .map(bindScheduleSlotKey_)));
    if (signatures.some(signature => signature.size === 0)) {
      return { ok: false, blocked: true, error: '綁班課程不可只移動或刪除其中一班，請整組處理' };
    }
    const canonical = [...(signatures[0] || [])].sort().join('|');
    if (signatures.some(signature => [...signature].sort().join('|') !== canonical)) {
      return { ok: false, blocked: true, error: '綁班課程必須由所有班級一起移動到同一時段' };
    }
  }
  return { ok: true };
}


function frozenTeacherValue_(value) {
  if (Array.isArray(value)) return JSON.stringify(value);
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return JSON.stringify(parsed);
  } catch (err) {}
  return raw;
}

function frozenScheduleEntryMatches_(before, after) {
  if (!before || !after) return false;
  const beforeRow = normalizePatrolScheduleRow_(before);
  const afterRow = normalizePatrolScheduleRow_(after);
  return String(beforeRow['班級代碼'] || '') === String(afterRow['班級代碼'] || '') &&
    String(beforeRow['科目代碼'] || '') === String(afterRow['科目代碼'] || '') &&
    frozenTeacherValue_(beforeRow['教師姓名']) === frozenTeacherValue_(afterRow['教師姓名']) &&
    parseInt(beforeRow['星期'], 10) === parseInt(afterRow['星期'], 10) &&
     parseInt(beforeRow['節次'], 10) === parseInt(afterRow['節次'], 10) &&
     String(beforeRow['課堂屬性'] || '一般') === String(afterRow['課堂屬性'] || '一般') &&
     String(beforeRow['是否鎖定'] || '').toUpperCase() === String(afterRow['是否鎖定'] || '').toUpperCase();
}

function scheduleRowSlotKey_(row) {
  const period = parseInt(row['節次'], 10);
  const attr = period === 8 ? String(row['課堂屬性'] || '一般') : '一般';
  return [String(row['班級代碼'] || ''), parseInt(row['星期'], 10), period, attr].join('|');
}

function validateBindSnapshot_(schedule, blockGroups, assignments) {
  const errors = [];
  const groupRows = new Map();
  const groupKey = group => String(group['群組ID'] || group['群組名稱'] || '');
  (schedule || []).forEach(row => {
    const group = getBindGroupForEntry_(row, blockGroups);
    if (!group) return;
    const key = groupKey(group);
    if (!groupRows.has(key)) groupRows.set(key, { group, rows: [] });
    groupRows.get(key).rows.push(row);
  });

  groupRows.forEach(instance => {
    const members = getConfiguredBindMembers_(instance.group, assignments);
    const expectedClasses = [...new Set(members.map(member => member.classCode))];
    const byClass = new Map(expectedClasses.map(classCode => [classCode, new Set()]));
    const memberByClass = new Map();
    members.forEach(member => {
      if (!memberByClass.has(member.classCode)) memberByClass.set(member.classCode, new Set());
      memberByClass.get(member.classCode).add(member.subjectCode);
    });
    instance.rows.forEach(row => {
      const classCode = String(row['班級代碼'] || '').trim();
      const subjectCode = String(row['科目代碼'] || '').trim();
      if (!byClass.has(classCode) || !memberByClass.get(classCode)?.has(subjectCode)) return;
      byClass.get(classCode).add(bindScheduleSlotKey_(row));
    });
    const lockStates = new Map();
    instance.rows.forEach(row => {
      const classCode = String(row['班級代碼'] || '').trim();
      const subjectCode = String(row['科目代碼'] || '').trim();
      if (!byClass.has(classCode) || !memberByClass.get(classCode)?.has(subjectCode)) return;
      const slot = bindScheduleSlotKey_(row);
      if (!lockStates.has(slot)) lockStates.set(slot, new Set());
      lockStates.get(slot).add(String(row['是否鎖定'] || '').toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE');
    });
    lockStates.forEach((states, slot) => {
      if (states.size > 1) errors.push('綁班鎖定狀態不一致：' + (instance.group['群組名稱'] || instance.group['群組ID']) + '／' + slot);
    });
    const signatures = expectedClasses.map(classCode => ({
      classCode,
      slots: [...(byClass.get(classCode) || [])].sort()
    }));
    const canonical = signatures[0]?.slots.join('|') || '';
    if (signatures.some(item => item.slots.join('|') !== canonical)) {
      const details = signatures.map(item => item.classCode + '：' + (item.slots.length ? item.slots.join('、') : '未排')).join('；');
      errors.push('綁班未完整同步：' + (instance.group['群組名稱'] || instance.group['群組ID']) + '／' + details);
    }
  });
  return errors;
}

function isAllowedCombinedClassCohort_(items, blockGroups) {
  if (!Array.isArray(items) || items.length < 2) return false;
  const subjectCodes = Array.from(new Set(items.map(item => String(item.subjectCode || '').trim()).filter(Boolean)));
  const classCodes = items.map(item => String(item.classCode || '').trim()).filter(Boolean);
  if (classCodes.length !== items.length || new Set(classCodes).size !== items.length) return false;
  if (items.every(item => String(item.isLocked || '').toUpperCase() === 'TRUE')) return true;
  return (blockGroups || []).some(group => {
    const subjects = splitBindList_(group['科目清單'] || group['科目代碼']);
    const classes = splitBindList_(group['班級清單']);
    return classes.length >= 2 && items.every(item =>
      classes.includes(String(item.classCode || '').trim()) &&
      subjects.includes(String(item.subjectCode || '').trim())
    );
  });
}

function validateScheduleSnapshot_(schedule, data) {
  const rows = (Array.isArray(schedule) ? schedule : []).map(normalizePatrolScheduleRow_);
  const classes = data.classes || [];
  const teachers = data.teachers || [];
  const subjects = data.subjects || [];
  const teacherBlocks = data.teacherBlocks || [];
  const subjectRules = data.subjectRules || [];
  const teacherExclusives = data.teacherExclusives || [];
  const rooms = data.rooms || [];
  const assignments = data.assignments || [];
  const ignoredTeacherConsecutiveIds = new Set((data.ignoredTeacherConsecutiveIds || []).map(id => String(id || '').trim()).filter(Boolean));
  const allowManualConstraintWarnings = data.allowManualConstraintWarnings === true;
  const classByCode = {};
  const teacherByCode = {};
  const subjectByCode = {};
  const roomByCode = {};
  classes.forEach(row => { classByCode[String(row['班級代碼'] || '').trim()] = row; });
  teachers.forEach(row => {
    const code = String(row['教師姓名'] || row['姓名'] || '').trim();
    if (code) teacherByCode[code] = row;
  });
  subjects.forEach(row => { subjectByCode[String(row['科目代碼'] || '').trim()] = row; });
  rooms.forEach(row => { roomByCode[String(row['教室代碼'] || '').trim()] = row; });

  const errors = [];
  const addError = message => {
    if (errors.indexOf(message) < 0) errors.push(message);
  };
  const addManualConstraintError = message => {
    if (!allowManualConstraintWarnings) addError(message);
  };
  assignments.forEach(assignment => {
    const weeklyRaw = assignment['每週節數'];
    if (weeklyRaw !== undefined && !isValidWeeklyValue_(weeklyRaw)) {
      addError('配課每週節數格式錯誤：' + String(assignment['班級代碼'] || '') + '／' + String(assignment['科目代碼'] || ''));
    }
    const courseAttr = String(assignment['課程屬性'] || '').trim();
    if (courseAttr !== '' && courseAttr !== '預排') {
      addError('配課課程屬性無效：' + String(assignment['班級代碼'] || '') + '／' + String(assignment['科目代碼'] || ''));
    }
  });
  const classSlotRows = new Map();
  const classSubjectDaySlots = new Map();
  const classSubjectDayPeriods = new Map();
  const classSubjectDayRows = new Map();
  const teacherSlots = new Map();
  const teacherConsecutiveSlots = new Map();
  const patrolSlots = new Map();
  const subjectSlots = new Map();
  const roomSlots = new Map();
  const seenIds = new Set();

  rows.forEach(row => {
    const id = String(row['課表ID'] || '').trim();
    const isPatrol = isPatrolScheduleRow_(row);
    const classCode = String(row['班級代碼'] || '').trim();
    const subjectCode = String(row['科目代碼'] || '').trim();
    const day = parseInt(row['星期'], 10);
    const period = parseInt(row['節次'], 10);
    const teacherCodes = teacherCodesFromValue_(row['教師姓名']);
    const alternateAssignment = assignments.find(assignment =>
      scheduleMatchesAssignment_(row, assignment) && assignmentIsAlternateWeek_(assignment, subjectByCode)
    );
    if (id) {
      if (seenIds.has(id)) addError('課表ID 重複：' + id);
      seenIds.add(id);
    }
    if (isPatrol && teacherCodes.length !== 1) {
      addError('巡堂每列只能有一位教師：' + (id || '未命名巡堂'));
      return;
    }
    if (!isPatrol && (!classCode || !subjectCode)) {
      addError('課表資料缺少班級或科目：' + (id || '未命名課程'));
      return;
    }
    if (!isPatrol && !classByCode[classCode]) addError('課表使用不存在的班級：' + classCode);
    if (!isPatrol && !subjectByCode[subjectCode]) addError('課表使用不存在的科目：' + subjectCode);
    if (!Number.isFinite(day) || day < 1 || day > 5 || !Number.isFinite(period) ||
        !(period === 0 || period === 45 || (period >= 1 && period <= 8))) {
      addError('課表時段無效：' + classCode + '／' + subjectCode);
      return;
    }
    if (alternateAssignment && (period !== 8 || !['單週', '雙週'].includes(scheduleAttributeValue_(row)))) {
      addError('0.5 節單雙週課程必須排在第8節單週或雙週：' + subjectCode + '（' + classCode + '）');
    }

    if (isPatrol) {
      const patrolKey = day + '|' + period;
      patrolSlots.set(patrolKey, (patrolSlots.get(patrolKey) || 0) + 1);
    } else {
      const classSlot = classCode + '|' + day + '|' + period;
      const existingClassRows = classSlotRows.get(classSlot) || [];
      if (existingClassRows.some(existing => !isAlternateWeekPair_(existing, row))) {
        addManualConstraintError('班級衝堂：' + classCode + ' 星期' + day + '第' + period + '節');
      }
      existingClassRows.push(row);
      classSlotRows.set(classSlot, existingClassRows);
      const classSubjectDayKey = classCode + '|' + subjectCode + '|' + day;
      classSubjectDaySlots.set(classSubjectDayKey, (classSubjectDaySlots.get(classSubjectDayKey) || 0) + 1);
      if (!classSubjectDayPeriods.has(classSubjectDayKey)) classSubjectDayPeriods.set(classSubjectDayKey, new Set());
      classSubjectDayPeriods.get(classSubjectDayKey).add(period);
      if (!classSubjectDayRows.has(classSubjectDayKey)) classSubjectDayRows.set(classSubjectDayKey, []);
      classSubjectDayRows.get(classSubjectDayKey).push(row);
    }

      teacherCodes.forEach((teacherCode, teacherIndex) => {
        const teacherKey = teacherCode + '|' + day + '|' + period;
        if (!teacherSlots.has(teacherKey)) teacherSlots.set(teacherKey, []);
        teacherSlots.get(teacherKey).push({
          classCode,
          subjectCode,
          weekType: period === 8 ? String(row['課堂屬性'] || '一般').trim() : '一般',
          isLocked: String(row['是否鎖定'] || '').toUpperCase() === 'TRUE',
          isMainTeacher: teacherIndex === 0,
          row
      });
      if (!ignoredTeacherConsecutiveIds.has(id)) {
        if (!teacherConsecutiveSlots.has(teacherKey)) teacherConsecutiveSlots.set(teacherKey, []);
          teacherConsecutiveSlots.get(teacherKey).push({
            classCode,
            subjectCode,
            weekType: period === 8 ? String(row['課堂屬性'] || '一般').trim() : '一般',
            isLocked: String(row['是否鎖定'] || '').toUpperCase() === 'TRUE',
            row
        });
      }
      if (teacherBlocks.some(block => teacherBlockHasSlot_(block, teacherCode, day, period))) {
        addManualConstraintError('教師不排課違規：' + teacherCode + ' 星期' + day + '第' + period + '節');
      }
    });

    const classInfo = classByCode[classCode] || {};
    const isVirtual = String(classInfo['是否虛擬班'] || '').toUpperCase() === 'TRUE';
     const weekType = period === 8 ? String(row['課堂屬性'] || '一般').trim() : '一般';
     const subjectSlotKeys = period === 8 && weekType === '一般'
       ? ['單週', '雙週'].map(week => subjectCode + '|' + day + '|' + period + '|' + week)
       : [subjectCode + '|' + day + '|' + period + '|' + weekType];
     if (!isPatrol && !isVirtual) subjectSlotKeys.forEach(key => subjectSlots.set(key, (subjectSlots.get(key) || 0) + 1));

    const subject = subjectByCode[subjectCode] || {};
    const roomCode = String(subject['所屬教室代碼'] || '').trim();
    if (roomCode) {
       const roomWeeks = period === 8 && weekType === '一般' ? ['單週', '雙週'] : [weekType];
       roomWeeks.forEach(week => {
         const roomKey = roomCode + '|' + day + '|' + period + '|' + week;
         if (!roomSlots.has(roomKey)) roomSlots.set(roomKey, []);
         roomSlots.get(roomKey).push({ classCode, subjectCode, weekType: week });
       });
    }

    if (!isPatrol) {
      const matchingRules = subjectRules.filter(rule => subjectRuleMatches_(rule, subjectCode, classCode, classes));
      const banned = matchingRules.some(rule =>
        String(rule['規則類型'] || '').trim() === '禁排' &&
        parseFrozenRuleSlots_(rule).some(slot => slot.day === day && slot.period === period)
      );
      if (banned) addError('科目禁排違規：' + subjectCode + '（' + classCode + '）');
      const mandatoryRules = matchingRules.filter(rule => String(rule['規則類型'] || '').trim() === '必排');
      if (mandatoryRules.length > 0 && !mandatoryRules.some(rule =>
        parseFrozenRuleSlots_(rule).some(slot => slot.day === day && slot.period === period)
       )) addManualConstraintError('科目必排違規：' + subjectCode + '（' + classCode + '）');
    }
  });

  patrolSlots.forEach((count, key) => {
     if (count > 1) addManualConstraintError('同一星期與節次只能安排一位巡堂教師：' + key);
  });

  classSubjectDaySlots.forEach((count, key) => {
    if (count < 2) return;
    const parts = key.split('|');
    const rowsForDay = classSubjectDayRows.get(key) || [];
    const hasRealDuplicate = rowsForDay.some((row, index) =>
      rowsForDay.slice(index + 1).some(other => !isAlternateWeekPair_(row, other))
    );
    if (!hasRealDuplicate) return;
    const overlappingRows = rowsForDay.filter(row => rowsForDay.some(other =>
      other !== row && !isAlternateWeekPair_(row, other)
    ));
    const periods = new Set(overlappingRows.map(row => parseInt(row['節次'], 10)));
    const lockedBlockOnly = overlappingRows.length > 0 && overlappingRows.every(row => isLockedConsecutiveScheduleEntry_(row, rows));
    if (lockedBlockOnly || isAllowedMandatorySameDayBlock_(parts[1], parts[0], parts[2], Array.from(periods), subjectRules, classes)) return;
     addManualConstraintError('同班同科同日重複：' + parts[0] + ' ' + parts[1] + ' 星期' + parts[2] + '（' + overlappingRows.length + '節）');
  });

  teacherSlots.forEach((items, key) => {
    if (!hasOverlappingSchedulePair_(items, items)) return;
     const overlappingItems = items.filter(item => items.some(other =>
       other !== item && !isAlternateWeekPair_(item.row, other.row)
     ));
     if (isAllowedCombinedClassCohort_(overlappingItems, data.blockGroups || [])) return;
     const hasMainTeacher = overlappingItems.some(item => item.isMainTeacher !== false);
     if (!hasMainTeacher && allowManualConstraintWarnings) return;
     addError('教師衝堂：' + key + '（' + overlappingItems.map(item => item.subjectCode + '／' + item.classCode).join('、') + '）');
  });
  const teacherPeriods = new Map();
  teacherConsecutiveSlots.forEach((items, key) => {
    const parts = key.split('|');
    const teacherCode = parts[0];
    const day = parseInt(parts[1], 10);
    const period = parseInt(parts[2], 10);
    if (!teacherCode || !Number.isFinite(day) || !Number.isFinite(period)) return;
    if (!teacherPeriods.has(teacherCode)) teacherPeriods.set(teacherCode, new Map());
    const byDay = teacherPeriods.get(teacherCode);
    if (!byDay.has(day)) byDay.set(day, new Set());
    byDay.get(day).add(period);
  });
  if (data.allowManualTeacherConsecutive !== true) teacherPeriods.forEach((byDay, teacherCode) => {
    const teacher = teacherByCode[teacherCode] || {};
    const maximum = parseInt(teacher['最大連堂節數'] || '2', 10) || 2;
    if (maximum <= 0 || maximum >= 8) return;
    for (let day = 1; day <= 5; day++) {
      const periods = byDay.get(day) || new Set();
      for (let start = 1; start <= 8 - maximum; start++) {
        let exceeds = true;
        for (let period = start; period <= start + maximum; period++) {
          if (!periods.has(period)) {
            exceeds = false;
            break;
          }
        }
        if (exceeds) {
          addError('教師連堂超限：' + teacherCode + ' 星期' + day + '第' + start + '至第' + (start + maximum) + '節（上限' + maximum + '）');
          break;
        }
      }
    }
  });
  if (!data.allowSoftTeacherExclusives) teacherExclusives.forEach(rule => {
    const teacherA = String(rule['教師A'] || '').trim();
    const teacherB = String(rule['教師B'] || '').trim();
    if (!teacherA || !teacherB) return;
    for (let day = 1; day <= 5; day++) {
      for (let period = 1; period <= 8; period++) {
        const keyA = teacherA + '|' + day + '|' + period;
        const keyB = teacherB + '|' + day + '|' + period;
        if (teacherSlots.has(keyA) && teacherSlots.has(keyB) && hasOverlappingSchedulePair_(teacherSlots.get(keyA), teacherSlots.get(keyB))) {
           addError('教師互斥違規：' + teacherA + '／' + teacherB + ' 星期' + day + '第' + period + '節');
        }
      }
    }
  });
  subjectSlots.forEach((count, key) => {
    const subjectCode = key.split('|')[0];
    const maxConcurrent = parseInt(subjectByCode[subjectCode]?.['同時最多班數'] || '0', 10) || 0;
     if (maxConcurrent > 0 && count > maxConcurrent) addManualConstraintError('科目同時班數超限：' + key + '（' + count + '/' + maxConcurrent + '）');
  });
  roomSlots.forEach((items, key) => {
    const roomCode = key.split('|')[0];
    const capacity = parseInt(roomByCode[roomCode]?.['容量'] || '1', 10) || 1;
     if (items.length > capacity) addManualConstraintError('教室容量超限：' + key + '（' + items.length + '/' + capacity + '）');
  });

  if (!data.skipBindValidation) {
    const bindErrors = validateBindSnapshot_(rows, data.blockGroups || [], data.assignments || []);
    bindErrors.forEach(addError);
  }
  if (errors.length === 0) return { ok: true };
  const shown = errors.slice(0, 20);
  return {
    ok: false,
    blocked: true,
    error: '課表硬限制稽核失敗：' + shown.join('；') + (errors.length > shown.length ? '；另有 ' + (errors.length - shown.length) + ' 項' : ''),
    violations: errors
  };
}

function validateScheduleSnapshotAction_(ss, payload) {
  const schedule = Array.isArray(payload && payload.schedule) ? payload.schedule : [];
  return validateScheduleSnapshot_(schedule, {
    classes: sheetToObjects_(ss.getSheetByName('班級')),
    teachers: sheetToObjects_(ss.getSheetByName('教師')),
    assignments: sheetToObjects_(ss.getSheetByName('配課')),
    subjects: sheetToObjects_(ss.getSheetByName('科目')),
    teacherBlocks: sheetToObjects_(ss.getSheetByName('不排課')),
    subjectRules: sheetToObjects_(ss.getSheetByName('科目規則')),
    blockGroups: sheetToObjects_(ss.getSheetByName('綁班')),
    teacherExclusives: sheetToObjects_(ss.getSheetByName('互斥')),
    rooms: sheetToObjects_(ss.getSheetByName('教室')),
    skipBindValidation: false,
    ignoredTeacherConsecutiveIds: payload.ignoredTeacherConsecutiveIds || [],
    allowSoftTeacherExclusives: payload.allowSoftTeacherExclusives === true,
    allowManualConstraintWarnings: payload.allowManualConstraintWarnings === true
  });
}

function batchUpdateSchedule_(ss, payload) {
  const ownsLock = !(payload && payload.__lockAlreadyHeld);
  const lock = ownsLock && typeof LockService !== 'undefined' ? LockService.getScriptLock() : null;
  if (lock && !lock.tryLock(30000)) return { ok: false, blocked: true, error: '目前有另一個課表寫入作業進行中，請稍後再試' };
  try {
    return batchUpdateScheduleLocked_(ss, payload);
  } finally {
    if (lock) lock.releaseLock();
  }
}

// 整批寫入課表（自動排課整批 commit）
function batchUpdateScheduleLocked_(ss, payload) {
  const schedule = (Array.isArray(payload.schedule) ? payload.schedule : []).map(normalizePatrolScheduleRow_);
  const clearScope = String(payload.clearScope || '').trim();
  if (clearScope && !['all', 'second-round', 'period-8'].includes(clearScope)) {
    return { ok: false, blocked: true, error: '無效的清除範圍' };
  }
  const clearKeepLockedOnly = payload.clearKeepLockedOnly === true || clearScope === 'all';
  const sheet = ss.getSheetByName('課表');
  const headers = SHEET_DEFS['課表'].headers;
  const currentRows = sheetToObjects_(sheet);
  const baseRevision = String(payload.baseRevision || '').trim();
  const currentRevision = scheduleRevision_(currentRows);
  if (baseRevision && baseRevision !== currentRevision) {
    return { ok: false, blocked: true, conflict: true, error: '課表已被其他視窗更新，為避免覆蓋新資料，本次寫入已取消', currentRevision };
  }
  const isClearOperation = Boolean(clearScope || clearKeepLockedOnly);
  const currentById = new Map(currentRows.map(row => [String(row['課表ID'] || '').trim(), row]));
  const incomingIds = new Set();
  const isDeletionOnlyClear = isClearOperation && schedule.every(after => {
    const id = String(after['課表ID'] || '').trim();
    if (!id || incomingIds.has(id)) return false;
    incomingIds.add(id);
    const before = currentById.get(id);
    return !!before && frozenScheduleEntryMatches_(before, after);
  });
  if (isClearOperation && !isDeletionOnlyClear) {
    return { ok: false, blocked: true, error: '清除操作只能刪除既有課表列，不可修改或新增保留課程' };
  }
  const classRows = sheetToObjects_(ss.getSheetByName('班級'));
  const teacherRows = sheetToObjects_(ss.getSheetByName('教師'));
  const assignments = sheetToObjects_(ss.getSheetByName('配課'));
  const subjects = sheetToObjects_(ss.getSheetByName('科目'));
  const teacherBlocks = sheetToObjects_(ss.getSheetByName('不排課'));
  const frozenRules = sheetToObjects_(ss.getSheetByName('科目規則'));
  const blockGroups = sheetToObjects_(ss.getSheetByName('綁班'));
  const teacherExclusives = sheetToObjects_(ss.getSheetByName('互斥'));
  const rooms = sheetToObjects_(ss.getSheetByName('教室'));
  const snapshotValidationData = {
    classes: classRows,
    teachers: teacherRows,
    assignments,
    subjects,
    teacherBlocks,
    subjectRules: frozenRules,
    blockGroups,
    teacherExclusives,
    rooms,
    skipBindValidation: clearKeepLockedOnly,
    allowManualTeacherConsecutive: payload.manualSoftWarnings === true,
    ignoredTeacherConsecutiveIds: payload.ignoredTeacherConsecutiveIds || [],
    allowSoftTeacherExclusives: payload.allowSoftTeacherExclusives === true,
    allowManualConstraintWarnings: payload.allowManualConstraintWarnings === true
  };
  let snapshotCheck = isDeletionOnlyClear
    ? { ok: true }
    : validateScheduleSnapshot_(schedule, snapshotValidationData);
  if (!snapshotCheck.ok && payload.manualSoftWarnings === true && !isDeletionOnlyClear) {
    const currentCheck = validateScheduleSnapshot_(currentRows, snapshotValidationData);
    const existingViolations = new Set(currentCheck.violations || []);
    const newViolations = (snapshotCheck.violations || []).filter(violation => !existingViolations.has(violation));
    if (newViolations.length === 0) {
      snapshotCheck = { ok: true };
    } else {
      const shown = newViolations.slice(0, 20);
      snapshotCheck = {
        ok: false,
        blocked: true,
        error: '手動寫入新增硬限制違規：' + shown.join('；') + (newViolations.length > shown.length ? '；另有 ' + (newViolations.length - shown.length) + ' 項' : ''),
        violations: newViolations
      };
    }
  }
  if (!snapshotCheck.ok) return snapshotCheck;
  const incomingById = new Map(schedule.map(row => [String(row['課表ID'] || '').trim(), row]));
  if (clearScope && clearScope !== 'all') {
    for (const before of currentRows) {
       if (isClearProtectedScheduleEntry_(before, currentRows) || isClearFrozenScheduleEntry_(before, frozenRules, classRows)) {
        const protectedId = String(before['課表ID'] || '').trim();
        const protectedAfter = protectedId ? incomingById.get(protectedId) : null;
        if (!protectedAfter || !frozenScheduleEntryMatches_(before, protectedAfter)) {
           return { ok: false, blocked: true, error: '清除操作不可移除上鎖或必排課程' };
        }
        continue;
      }
       if (!isClearScopeTarget_(before, clearScope, frozenRules, classRows, blockGroups, currentRows)) {
        const retainedId = String(before['課表ID'] || '').trim();
        const retainedAfter = retainedId ? incomingById.get(retainedId) : null;
        if (!retainedAfter || !frozenScheduleEntryMatches_(before, retainedAfter)) {
          return { ok: false, blocked: true, error: '清除操作只能刪除指定範圍內的課程' };
        }
      }
    }
  }
  if (clearKeepLockedOnly) {
    const lockedRows = currentRows.filter(row => isClearProtectedScheduleEntry_(row, currentRows));
    const matchedLockedRows = new Set();
    for (const after of schedule) {
      const afterId = String(after['課表ID'] || '').trim();
      const before = lockedRows.find(candidate => {
        if (matchedLockedRows.has(candidate)) return false;
        const beforeId = String(candidate['課表ID'] || '').trim();
        return (afterId && beforeId && afterId === beforeId) || frozenScheduleEntryMatches_(candidate, after);
      });
      if (!before) {
        return { ok: false, blocked: true, error: '清除操作只能保留原有上鎖課程' };
      }
      matchedLockedRows.add(before);
    }
    if (matchedLockedRows.size !== lockedRows.length) {
      return { ok: false, blocked: true, error: '清除操作未完整保留上鎖課程' };
    }
  } else {
    const bindCheck = boundScheduleChangeCheck_(currentRows, schedule, blockGroups, assignments);
    if (!bindCheck.ok) return bindCheck;
  }
  for (let i = 0; i < currentRows.length; i++) {
    const before = currentRows[i];
    const protectedEntry = clearKeepLockedOnly
      ? isClearProtectedScheduleEntry_(before, currentRows)
       : (isClearFrozenScheduleEntry_(before, frozenRules, classRows) || isLockedConsecutiveScheduleEntry_(before, currentRows));
    if (!protectedEntry) continue;
    const id = String(before['課表ID'] || '').trim();
    const after = (id && incomingById.get(id)) || schedule.find(row => frozenScheduleEntryMatches_(before, row));
    if (!after || !frozenScheduleEntryMatches_(before, after)) {
      return { ok: false, blocked: true, error: '凍結課程完整性檢查失敗：' + String(before['班級代碼'] || '') + '／' + String(before['科目代碼'] || '') };
    }
  }

  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).clearContent();
  }

  if (schedule.length === 0) return { count: 0, scheduleRevision: scheduleRevision_([]) };

  const rows = schedule.map(r => {
    const period = parseInt(r['節次'], 10);
    const attr = isManualOnlyPeriod_(period) || isVirtualClassRow_(classRows.reduce((map, row) => {
      map[String(row['班級代碼'] || '').trim()] = row;
      return map;
    }, {}), r['班級代碼'])
      ? '抽離'
      : String(r['課堂屬性'] || '一般');
    return [
      r['課表ID'] || genId_(),
      String(r['班級代碼'] || ''),
      parseInt(r['星期'], 10),
      period,
      String(r['科目代碼'] || ''),
      (Array.isArray(r['教師姓名']) ? JSON.stringify(r['教師姓名']) : String(r['教師姓名'] || '')),
      attr,
      (r['是否鎖定'] === 'TRUE' || r['是否鎖定'] === true) ? 'TRUE' : 'FALSE'
    ];
  });

  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  return { count: rows.length, scheduleRevision: scheduleRevision_(sheetToObjects_(sheet)) };
}

// ===== 教師不排課：集中時段陣列（僅限新版資料） =====
const __ensureAllSheetsLegacy = ensureAllSheets_;
ensureAllSheets_ = function(ss) {
  __ensureAllSheetsLegacy(ss);
  const sheet = ss.getSheetByName('不排課');
  const headers = SHEET_DEFS['不排課'].headers;
  const actual = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0];
  if (actual.join('|') !== headers.join('|')) {
    throw new Error('教師不排課資料表為舊格式；測試階段請重新初始化資料庫後再使用新版時段陣列。');
  }
  sheet.getRange('C:C').setNumberFormat('@');
};

function parseTeacherBlockPairs_(pairs) {
  return Array.from(new Set(String(pairs || '').split(',').map(value => value.trim()).filter(value => /^\d+-\d+$/.test(value)))).sort();
}

function teacherBlockHasSlot_(block, teacherCode, day, period) {
  return String(block['教師姓名']) === String(teacherCode) && parseTeacherBlockPairs_(block['時段']).includes(day+'-'+period);
}

function saveTeacherBlock_(ss, payload) {
  const sheet = ss.getSheetByName('不排課');
  const pairs = parseTeacherBlockPairs_(payload.pairs);
  const lastRow = sheet.getLastRow();
  const codeRowNos = {}; // 教師代碼 -> 既有資料列號（以 1 為基準的資料列）
  const currentReason = {};
  /* 掃描整張資料表，記錄每位教師首個既有列號與原因 */
  if (lastRow >= 2) {
    const values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
    for (let i = 0; i < values.length; i++) {
      const code = String(values[i][1]);
      if (!code) continue;
      if (!(code in codeRowNos)) { codeRowNos[code] = i + 2; currentReason[code] = String(values[i][3] || ''); }
    }
  }
  (payload.teacherCodes || []).forEach(teacherCode => {
    const tc = String(teacherCode);
    const existingRow = codeRowNos[tc] || null;
    const allPairs = new Set();
    if (existingRow) {
      parseTeacherBlockPairs_(sheet.getRange(existingRow, 3).getValue()).forEach(p => allPairs.add(p));
    }
    pairs.forEach(pair => payload.clear ? allPairs.delete(pair) : allPairs.add(pair));
    const finalPairs = Array.from(allPairs).sort();
    const reason = payload.reason || currentReason[tc] || '';
    if (existingRow) {
      if (finalPairs.length) {
        sheet.getRange(existingRow, 3).setValue(finalPairs.join(','));
        sheet.getRange(existingRow, 4).setValue(reason);
      } else {
        sheet.deleteRow(existingRow);
      }
    } else if (finalPairs.length) {
      sheet.appendRow([genId_(), tc, finalPairs.join(','), reason]);
    }
  });
  return {ok:true};
}
