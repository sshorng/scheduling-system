const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const backend = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
const headers = ['課表ID', '班級代碼', '星期', '節次', '科目代碼', '教師姓名', '課堂屬性', '是否鎖定'];

function makeSheet(rows, sheetHeaders = headers) {
  const values = [sheetHeaders, ...rows.map(row => sheetHeaders.map(header => String(row[header] ?? '')))];
  return {
    getLastRow: () => values.length,
    getLastColumn: () => sheetHeaders.length,
    getRange(row, column, rowCount, columnCount) {
      return {
        getDisplayValues: () => values
          .slice(row - 1, row - 1 + rowCount)
          .map(item => item.slice(column - 1, column - 1 + columnCount)),
        setValue: value => { values[row - 1][column - 1] = String(value); }
      };
    },
    rows: () => values.slice(1).map(row => Object.fromEntries(sheetHeaders.map((header, index) => [header, row[index]])))
  };
}

function createContext() {
  const context = { console };
  vm.createContext(context);
  vm.runInContext(backend, context, { filename: 'Code.gs' });
  return context;
}

function createSpreadsheet(scheduleRows) {
  const sheets = {
    課表: makeSheet(scheduleRows),
    綁班: makeSheet([{ 群組ID: 'BG1', 群組名稱: '七年級英語', 科目清單: '英語', 班級清單: '701,702' }], ['群組ID', '群組名稱', '科目清單', '班級清單']),
    配課: makeSheet([], ['配課ID', '班級代碼', '科目代碼', '教師姓名', '課程屬性', '每週節數', '備註'])
  };
  return {
    getSheetByName: name => sheets[name],
    sheets
  };
}

const baseSchedule = [
  { 課表ID: 'A1', 班級代碼: '701', 星期: 1, 節次: 1, 科目代碼: '英語', 教師姓名: 'T01', 課堂屬性: '一般', 是否鎖定: 'FALSE' },
  { 課表ID: 'A2', 班級代碼: '702', 星期: 1, 節次: 1, 科目代碼: '英語', 教師姓名: 'T02', 課堂屬性: '一般', 是否鎖定: 'FALSE' }
];
const context = createContext();
const spreadsheet = createSpreadsheet(baseSchedule);

const locked = context.lockCell_(spreadsheet, {
  classCode: '701', day: 1, period: 1, subjectCode: '英語', locked: true
});
assert.strictEqual(locked.ok, true);
assert(spreadsheet.sheets['課表'].rows().every(row => row['是否鎖定'] === 'TRUE'));

const unlocked = context.lockCell_(spreadsheet, {
  classCode: '702', day: 1, period: 1, subjectCode: '英語', locked: false
});
assert.strictEqual(unlocked.ok, true);
assert(spreadsheet.sheets['課表'].rows().every(row => row['是否鎖定'] === 'FALSE'));

const incomplete = createSpreadsheet([baseSchedule[0]]);
const incompleteResult = context.lockCell_(incomplete, {
  classCode: '701', day: 1, period: 1, subjectCode: '英語', locked: true
});
assert.strictEqual(incompleteResult.ok, false);
assert(String(incompleteResult.error).includes('資料不完整'));

const mixed = baseSchedule.map((row, index) => ({ ...row, 是否鎖定: index === 0 ? 'TRUE' : 'FALSE' }));
const bindErrors = context.validateBindSnapshot_(mixed, [
  { 群組ID: 'BG1', 群組名稱: '七年級英語', 科目清單: '英語', 班級清單: '701,702' }
], []);
assert(bindErrors.some(error => error.includes('鎖定狀態不一致')));

console.log('PASS  綁班鎖定與解鎖會原子套用全部成員，資料不完整與混合鎖定會被拒絕');
