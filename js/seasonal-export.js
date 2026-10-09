/* 寒暑輔 Excel：套用 seasonal-class/teacher-template.xlsx 範本，一班／一師一表。 */
const SEASONAL_TPL_MAX_DATES = 40;
const SEASONAL_TPL_NUM_ZH = ['一', '二', '三', '四', '五'];
const SEASONAL_TPL_WEEK_ZH = ['日', '一', '二', '三', '四', '五', '六'];
let _seasonalTplCache = {};

async function seasonalLoadTemplate(kind) {
  if (_seasonalTplCache[kind]) return _seasonalTplCache[kind];
  const file = kind === 'teacher' ? 'seasonal-teacher-template.xlsx' : 'seasonal-class-template.xlsx';
  const resp = await fetch(file + '?t=' + Date.now());
  if (!resp.ok) throw new Error('無法載入寒暑輔 Excel 範本 HTTP ' + resp.status + '：' + file);
  const zip = parseDocxZip(await resp.arrayBuffer());
  const sheetFile = zip.file('xl/worksheets/sheet1.xml');
  const stylesFile = zip.file('xl/styles.xml');
  if (!sheetFile || !stylesFile) throw new Error('寒暑輔 Excel 範本缺少工作表或樣式：' + file);
  const themeFile = zip.file('xl/theme/theme1.xml');
  const tpl = { sheetXml: sheetFile.asText(), stylesXml: stylesFile.asText(), themeXml: themeFile ? themeFile.asText() : null };
  _seasonalTplCache[kind] = tpl;
  return tpl;
}

function seasonalTplTimeHeader(time, index) {
  const numeral = SEASONAL_TPL_NUM_ZH[index] || String(index + 1);
  return '第' + numeral + '節\n' + time.start + '-' + time.end;
}

function seasonalTplDateLabel(iso) {
  const date = new Date(String(iso) + 'T00:00:00Z');
  if (Number.isNaN(date.getTime())) return String(iso);
  return (date.getUTCMonth() + 1) + '/' + date.getUTCDate() + '(' + SEASONAL_TPL_WEEK_ZH[date.getUTCDay()] + ')';
}

function seasonalTplTrimRows(sheetXml, keepLastRow, lastCol) {
  const trimmed = String(sheetXml).replace(/<row r="(\d+)"[^>]*>[\s\S]*?<\/row>/g, (whole, r) => Number(r) <= keepLastRow ? whole : '');
  return trimmed.replace(/<dimension ref="[^"]*"/, '<dimension ref="A1:' + lastCol + keepLastRow + '"');
}

function seasonalSafeSheetName(value, used) {
  let name = String(value || '工作表').replace(/[\\/*?:\[\]]/g, '_').trim().slice(0, 31) || '工作表';
  const base = name;
  let number = 2;
  while (used.has(name)) {
    const suffix = '_' + number++;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(name);
  return name;
}

function seasonalCreateXlsx(sheets, fileName, tpl) {
  const Zip = (typeof PizZip !== 'undefined') ? PizZip : (typeof window !== 'undefined' ? window.PizZip : null);
  if (!Zip) throw new Error('找不到 Excel 打包套件，請重新整理頁面後再試。');
  if (!sheets.length) throw new Error('目前沒有可匯出的課表資料。');
  if (!tpl || !tpl.stylesXml) throw new Error('缺少 Excel 範本樣式，請重新整理頁面後再試。');
  const zip = new Zip();
  const contentTypes = ['<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    ...(tpl.themeXml ? ['<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'] : []),
    ...sheets.map((_, index) => '<Override PartName="/xl/worksheets/sheet' + (index + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')].join('');
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' + contentTypes + '</Types>');
  zip.folder('_rels').file('.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  const used = new Set();
  const sheetEntries = sheets.map((sheet, index) => ({ ...sheet, name: seasonalSafeSheetName(sheet.name, used), id: index + 1 }));
  const workbookSheets = sheetEntries.map(sheet => '<sheet name="' + seasonalTplEscape(sheet.name) + '" sheetId="' + sheet.id + '" r:id="rId' + sheet.id + '"/>').join('');
  zip.folder('xl').file('workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>' + workbookSheets + '</sheets><calcPr calcId="191029"/></workbook>');
  zip.folder('xl').folder('_rels').file('workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheetEntries.map(sheet => '<Relationship Id="rId' + sheet.id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + sheet.id + '.xml"/>').join('') +
    '<Relationship Id="rId' + (sheetEntries.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    (tpl.themeXml ? '<Relationship Id="rId' + (sheetEntries.length + 2) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>' : '') + '</Relationships>');
  zip.folder('xl').file('styles.xml', tpl.stylesXml);
  if (tpl.themeXml) zip.folder('xl').folder('theme').file('theme1.xml', tpl.themeXml);
  const worksheetFolder = zip.folder('xl').folder('worksheets');
  sheetEntries.forEach(sheet => worksheetFolder.file('sheet' + sheet.id + '.xml', sheet.xml));
  const blob = zip.generate({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
  if (typeof saveAs === 'function') saveAs(blob, fileName);
  else {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function seasonalTplEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function seasonalWorkbookCommonData() {
  const session = typeof seasonalActiveSession === 'function' ? seasonalActiveSession() : null;
  if (!session) return null;
  const days = seasonalActiveRows('seasonalDays').filter(row => seasonalIsTrue(row['是否上課']))
    .map(row => seasonalIso(row['日期'])).filter(Boolean).sort();
  const schedule = seasonalActiveRows('seasonalSchedule');
  const needs = seasonalActiveRows('seasonalNeeds');
  const times = (() => { try { return JSON.parse(session['節次時間'] || '[]'); } catch (error) { return []; } })();
  const periodTimes = times.length === 5 ? times : SEASONAL_PERIOD_TIMES;
  const school = String(state.settings?.['學校名稱'] || '學校').trim();
  const activityName = session['活動類型'] === '寒輔' ? '寒假' : '暑假';
  const title = school + (session['學年度'] || '') + '學年度' + activityName + '學藝活動';
  return { session, days, schedule, needs, periodTimes, title };
}

function seasonalFillClassSheet(templateXml, classCode, data) {
  const classInfo = (state.classes || []).find(row => String(row['班級代碼']) === String(classCode)) || {};
  let xml = templateXml;
  xml = xlsxSetInlineString(xml, 'A1', data.title + '班級課表');
  xml = xlsxSetInlineString(xml, 'A2', String(classCode));
  data.periodTimes.forEach((time, index) => {
    xml = xlsxSetInlineString(xml, String.fromCharCode(66 + index) + '2', seasonalTplTimeHeader(time, index));
  });
  xml = xlsxSetInlineString(xml, 'H2', classInfo['班級名稱'] ? String(classInfo['班級名稱']) : '');
  const pairs = [];
  const pairSet = new Set();
  data.needs.filter(row => String(row['班級代碼']) === String(classCode)).forEach(row => {
    const key = String(row['科目代碼'] || '') + '|' + String(row['教師姓名'] || '');
    if (!pairSet.has(key)) {
      pairSet.add(key);
      pairs.push([String(row['科目代碼'] || ''), String(row['教師姓名'] || '')]);
    }
  });
  const dates = data.days.slice(0, SEASONAL_TPL_MAX_DATES);
  dates.forEach((date, di) => {
    const r = String(3 + di);
    xml = xlsxSetInlineString(xml, 'A' + r, seasonalTplDateLabel(date));
    for (let period = 1; period <= 5; period++) {
      const cell = data.schedule.find(item => String(item['班級代碼']) === String(classCode) && seasonalIso(item['日期']) === date && Number(item['節次']) === period);
      xml = xlsxSetInlineString(xml, String.fromCharCode(65 + period) + r, cell ? String(cell['科目代碼'] || '') : '');
    }
    const first = di === 0;
    const left = first ? ['科目', '教師'] : (pairs[(di - 1) * 2] || ['', '']);
    const right = first ? ['科目', '教師'] : (pairs[(di - 1) * 2 + 1] || ['', '']);
    xml = xlsxSetInlineString(xml, 'H' + r, left[0]);
    xml = xlsxSetInlineString(xml, 'I' + r, left[1]);
    xml = xlsxSetInlineString(xml, 'J' + r, right[0]);
    xml = xlsxSetInlineString(xml, 'K' + r, right[1]);
  });
  xml = seasonalTplTrimRows(xml, 2 + dates.length, 'K');
  return { name: String(classCode), xml };
}

function seasonalFillTeacherSheet(templateXml, teacherCode, data) {
  let xml = templateXml;
  xml = xlsxSetInlineString(xml, 'A1', data.title + '教師課表');
  xml = xlsxSetInlineString(xml, 'A2', String(teacherCode));
  data.periodTimes.forEach((time, index) => {
    xml = xlsxSetInlineString(xml, String.fromCharCode(66 + index) + '2', seasonalTplTimeHeader(time, index));
  });
  const dates = data.days.slice(0, SEASONAL_TPL_MAX_DATES);
  dates.forEach((date, di) => {
    const r = String(3 + di);
    xml = xlsxSetInlineString(xml, 'A' + r, seasonalTplDateLabel(date));
    for (let period = 1; period <= 5; period++) {
      const rows = data.schedule.filter(item => String(item['教師姓名']) === String(teacherCode) && seasonalIso(item['日期']) === date && Number(item['節次']) === period);
      let value = '';
      if (rows.length) {
        const field = period === 1 ? '科目代碼' : '班級代碼';
        value = [...new Set(rows.map(item => String(item[field] || '')))].filter(Boolean).join('／');
      }
      xml = xlsxSetInlineString(xml, String.fromCharCode(65 + period) + r, value);
    }
  });
  xml = seasonalTplTrimRows(xml, 2 + dates.length, 'F');
  return { name: String(teacherCode), xml };
}

async function exportSeasonalWorkbook(mode) {
  const data = seasonalWorkbookCommonData();
  if (!data) {
    toast('請先建立或選擇寒暑輔場次。', 'warning');
    return;
  }
  try {
    const classes = new Set([
      ...data.needs.map(row => String(row['班級代碼'] || '').trim()),
      ...data.schedule.map(row => String(row['班級代碼'] || '').trim())
    ].filter(Boolean));
    const teachers = new Set([
      ...data.needs.map(row => String(row['教師姓名'] || '').trim()),
      ...data.schedule.map(row => String(row['教師姓名'] || '').trim()),
      ...seasonalActiveRows('seasonalTeacherBlocks').map(row => String(row['教師姓名'] || '').trim())
    ].filter(Boolean));
    const isClass = mode === 'class';
    let names = [...(isClass ? classes : teachers)].sort((a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true }));
    if (isClass) {
      const grade9Classes = typeof seasonalGetGrade9Classes === 'function' ? seasonalGetGrade9Classes() : [];
      if (grade9Classes.length > 0) {
        const grade9Set = new Set(grade9Classes.map(c => seasonalText(c['班級代碼'])));
        names = names.filter(code => grade9Set.has(code));
      } else {
        names = names.filter(code => /^9/.test(code));
      }
    }
    if (!names.length) {
      toast('目前沒有班級課程或教師資料可匯出。', 'warning');
      return;
    }
    if (data.days.length > SEASONAL_TPL_MAX_DATES) {
      toast('上課日超過範本上限，僅匯出前 ' + SEASONAL_TPL_MAX_DATES + ' 天。', 'warning');
    }
    const tpl = await seasonalLoadTemplate(isClass ? 'class' : 'teacher');
    const sheets = names.map(name => isClass ? seasonalFillClassSheet(tpl.sheetXml, name, data) : seasonalFillTeacherSheet(tpl.sheetXml, name, data));
    const fileType = data.session['活動類型'] === '寒輔' ? '寒假' : '暑假';
    const fileName = String(data.session['學年度'] || '') + fileType + '課表(' + (isClass ? '班級' : '教師') + ').xlsx';
    seasonalCreateXlsx(sheets, fileName, tpl);
    toast('已匯出 ' + fileName + '，共 ' + sheets.length + ' 個工作表。', 'success');
  } catch (error) {
    console.error('[SeasonalExport] Excel 匯出失敗', error);
    toast(error.message || 'Excel 匯出失敗。', 'error');
  }
}

if (typeof window !== 'undefined') {
  window.seasonalCreateXlsx = seasonalCreateXlsx;
  window.seasonalFillClassSheet = seasonalFillClassSheet;
  window.seasonalFillTeacherSheet = seasonalFillTeacherSheet;
}
