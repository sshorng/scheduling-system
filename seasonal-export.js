/* 以 Open XML 建立獨立可編輯的寒暑輔班級版／教師版 Excel。 */
function seasonalExcelEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function seasonalExcelColumn(index) {
  let value = Number(index) + 1;
  let output = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    output = String.fromCharCode(65 + remainder) + output;
    value = Math.floor((value - 1) / 26);
  }
  return output;
}

function seasonalExcelCellXml(cell, rowIndex, columnIndex) {
  if (!cell) return '';
  const ref = seasonalExcelColumn(columnIndex) + rowIndex;
  const style = Number(cell.s) || 0;
  if (cell.v === '' || cell.v === null || cell.v === undefined) return style ? '<c r="' + ref + '" s="' + style + '"/>' : '';
  return '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' +
    seasonalExcelEscape(cell.v) + '</t></is></c>';
}

function seasonalExcelWorksheetXml(rows, options = {}) {
  const widths = options.widths || [];
  const lastColumn = Math.max(1, ...rows.map(row => row.length));
  const lastRow = Math.max(1, rows.length);
  const dimension = 'A1:' + seasonalExcelColumn(lastColumn - 1) + lastRow;
  const cols = widths.map((width, index) => '<col min="' + (index + 1) + '" max="' + (index + 1) + '" width="' + width + '" customWidth="1"/>').join('');
  const sheetRows = rows.map((row, rowIndex) => '<row r="' + (rowIndex + 1) + '" ht="' + (rowIndex === 0 ? '32' : (rowIndex === 1 ? '34' : '25')) + '" customHeight="1">' +
    row.map((cell, columnIndex) => seasonalExcelCellXml(cell, rowIndex + 1, columnIndex)).join('') + '</row>').join('');
  const merges = options.merges || [];
  const mergeXml = merges.length ? '<mergeCells count="' + merges.length + '">' + merges.map(ref => '<mergeCell ref="' + ref + '"/>').join('') + '</mergeCells>' : '';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="' + dimension + '"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="25"/><cols>' + cols + '</cols><sheetData>' + sheetRows + '</sheetData>' + mergeXml +
    '<printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.15" footer="0.15"/>' +
    '<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="1"/><headerFooter><oddFooter>&amp;C第 &amp;P 頁，共 &amp;N 頁</oddFooter></headerFooter>' +
    '</worksheet>';
}

function seasonalExcelStylesXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="3"><font><sz val="11"/><name val="Microsoft JhengHei"/><family val="2"/></font>' +
    '<font><b/><sz val="16"/><name val="Microsoft JhengHei"/><family val="2"/></font>' +
    '<font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Microsoft JhengHei"/><family val="2"/></font></fonts>' +
    '<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF1E3A5F"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFDBEAFE"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left style="thin"><color rgb="FF334155"/></left><right style="thin"><color rgb="FF334155"/></right><top style="thin"><color rgb="FF334155"/></top><bottom style="thin"><color rgb="FF334155"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="6">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
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

function seasonalCreateXlsx(sheets, fileName) {
  const Zip = (typeof PizZip !== 'undefined') ? PizZip : (typeof window !== 'undefined' ? window.PizZip : null);
  if (!Zip) throw new Error('找不到 Excel 打包套件，請重新整理頁面後再試。');
  if (!sheets.length) throw new Error('目前沒有可匯出的課表資料。');
  const zip = new Zip();
  const contentTypes = ['<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    ...sheets.map((_, index) => '<Override PartName="/xl/worksheets/sheet' + (index + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')].join('');
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' + contentTypes + '</Types>');
  zip.folder('_rels').file('.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  const used = new Set();
  const sheetEntries = sheets.map((sheet, index) => ({ ...sheet, name: seasonalSafeSheetName(sheet.name, used), id: index + 1 }));
  const workbookSheets = sheetEntries.map(sheet => '<sheet name="' + seasonalExcelEscape(sheet.name) + '" sheetId="' + sheet.id + '" r:id="rId' + sheet.id + '"/>').join('');
  zip.folder('xl').file('workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>' + workbookSheets + '</sheets><calcPr calcId="191029"/></workbook>');
  zip.folder('xl').folder('_rels').file('workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheetEntries.map(sheet => '<Relationship Id="rId' + sheet.id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + sheet.id + '.xml"/>').join('') +
    '<Relationship Id="rId' + (sheetEntries.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.folder('xl').file('styles.xml', seasonalExcelStylesXml());
  const worksheetFolder = zip.folder('xl').folder('worksheets');
  sheetEntries.forEach(sheet => worksheetFolder.file('sheet' + sheet.id + '.xml', seasonalExcelWorksheetXml(sheet.rows, sheet)));
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

function seasonalClassWorksheet(classCode, data) {
  const classInfo = (state.classes || []).find(row => String(row['班級代碼']) === String(classCode)) || {};
  const classTitle = data.title + '班級課表｜' + classCode + (classInfo['班級名稱'] ? ' ' + classInfo['班級名稱'] : '');
  const row1 = Array.from({ length: 11 }, () => null);
  row1[0] = { v: classTitle, s: 1 };
  const row2 = Array.from({ length: 11 }, () => null);
  row2[0] = { v: '日期', s: 2 };
  data.periodTimes.forEach((time, index) => { row2[index + 1] = { v: '第' + (index + 1) + '節\n' + time.start + '－' + time.end, s: 2 }; });
  row2[7] = { v: '科目', s: 2 }; row2[8] = { v: '教師', s: 2 };
  row2[9] = { v: '科目', s: 2 }; row2[10] = { v: '教師', s: 2 };
  const pairs = [];
  const pairSet = new Set();
  data.needs.filter(row => String(row['班級代碼']) === String(classCode)).forEach(row => {
    const key = String(row['科目代碼'] || '') + '|' + String(row['教師姓名'] || '');
    if (!pairSet.has(key)) {
      pairSet.add(key);
      pairs.push([String(row['科目代碼'] || ''), String(row['教師姓名'] || '')]);
    }
  });
  const rows = [row1, row2];
  const scheduleRows = data.days.map(date => {
    const row = Array.from({ length: 11 }, () => null);
    const dateCell = new Date(date + 'T00:00:00Z');
    const dayName = ['日', '一', '二', '三', '四', '五', '六'][dateCell.getUTCDay()];
    row[0] = { v: date.slice(5).replace('-', '/') + '(週' + dayName + ')', s: 3 };
    for (let period = 1; period <= 5; period++) {
      const cell = data.schedule.find(item => String(item['班級代碼']) === String(classCode) && seasonalIso(item['日期']) === date && Number(item['節次']) === period);
      if (cell) row[period] = { v: String(cell['科目代碼'] || ''), s: period === 1 ? 5 : 4 };
      else if (period === 1) row[period] = { v: '', s: 5 };
    }
    return row;
  });
  const neededRows = Math.max(scheduleRows.length, Math.ceil(pairs.length / 2));
  for (let index = 0; index < neededRows; index++) {
    const row = scheduleRows[index] || Array.from({ length: 11 }, () => null);
    if (!row[0]) row[0] = { v: '', s: 3 };
    for (let pair = 0; pair < 2; pair++) {
      const item = pairs[index * 2 + pair];
      const col = pair === 0 ? 7 : 9;
      row[col] = { v: item ? item[0] : '', s: item ? 4 : 0 };
      row[col + 1] = { v: item ? item[1] : '', s: item ? 4 : 0 };
    }
    rows.push(row);
  }
  return {
    name: String(classCode), rows, merges: ['A1:K1'],
    widths: [15, 12, 12, 12, 12, 12, 2.5, 13, 16, 13, 16]
  };
}

function seasonalTeacherWorksheet(teacherCode, data) {
  const teacherTitle = data.title + '教師課表｜' + teacherCode;
  const row1 = Array.from({ length: 6 }, () => null);
  row1[0] = { v: teacherTitle, s: 1 };
  const row2 = [{ v: '日期', s: 2 }, ...data.periodTimes.map((time, index) => ({ v: '第' + (index + 1) + '節\n' + time.start + '－' + time.end, s: 2 }))];
  const rows = [row1, row2];
  data.days.forEach(date => {
    const dateCell = new Date(date + 'T00:00:00Z');
    const dayName = ['日', '一', '二', '三', '四', '五', '六'][dateCell.getUTCDay()];
    const row = [{ v: date.slice(5).replace('-', '/') + '(週' + dayName + ')', s: 3 }];
    for (let period = 1; period <= 5; period++) {
      const classes = data.schedule.filter(item => String(item['教師姓名']) === String(teacherCode) && seasonalIso(item['日期']) === date && Number(item['節次']) === period)
        .map(item => String(item['班級代碼'] || ''));
      row.push({ v: classes.join('\n'), s: period === 1 ? 5 : (classes.length ? 4 : 0) });
    }
    rows.push(row);
  });
  return { name: String(teacherCode), rows, merges: ['A1:F1'], widths: [17, 18, 18, 18, 18, 18] };
}

function exportSeasonalWorkbook(mode) {
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
    const sheets = names.map(name => isClass ? seasonalClassWorksheet(name, data) : seasonalTeacherWorksheet(name, data));
    const fileType = data.session['活動類型'] === '寒輔' ? '寒假' : '暑假';
    const fileName = String(data.session['學年度'] || '') + fileType + '課表(' + (isClass ? '班級' : '教師') + ').xlsx';
    seasonalCreateXlsx(sheets, fileName);
    toast('已匯出 ' + fileName + '，共 ' + sheets.length + ' 個工作表。', 'success');
  } catch (error) {
    console.error('[SeasonalExport] Excel 匯出失敗', error);
    toast(error.message || 'Excel 匯出失敗。', 'error');
  }
}

if (typeof window !== 'undefined') {
  window.seasonalExcelWorksheetXml = seasonalExcelWorksheetXml;
  window.seasonalCreateXlsx = seasonalCreateXlsx;
}
