/**
 * 配課矩陣測試：寒暑輔「班級課程需求」以班級 × 科目矩陣呈現後的渲染與互動。
 *
 * 直接載入 js/seasonal-schedule.js 執行真正的函式，不做原始碼字串比對，
 * 改名或搬位不會讓測試靜默失效。
 */
const vm = require('vm');
const { createSandbox, readSource } = require('./helpers/loader.js');

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sandbox = createSandbox({
  globals: {
    esc: value => String(value == null ? '' : value),
    toast: () => {},
    showModal: async () => true,
    GAS_URL: ''
  }
});
vm.runInContext(readSource('js/seasonal-schedule.js'), sandbox, { filename: 'seasonal-schedule.js', timeout: 30000 });

function classRow(code, name) {
  return { '班級代碼': code, '班級名稱': name, '年級': '9', '是否虛擬班': 'FALSE' };
}
function needRow(id, code, subject, teacher, count) {
  return { '需求ID': id, '場次ID': 'S1', '班級代碼': code, '科目代碼': subject, '教師姓名': teacher, '本期節數': String(count) };
}

sandbox.state = {
  classes: ['901', '902', '903', '904', '905', '906', '907', '908'].map(code => classRow(code, '九年' + code.slice(2) + '班')),
  teachers: ['莊英勝', '呂哲瑜', '劉淑美'].map(name => ({ '教師姓名': name })),
  seasonalSessions: [{ '場次ID': 'S1', '開始日期': '2026-01-19', '結束日期': '2026-01-30', '版本號': '0' }],
  seasonalDays: [],
  seasonalNeeds: [
    needRow('N1', '901', '國文', '莊英勝', 5),
    needRow('N2', '902', '國文', '呂哲瑜', 5),
    needRow('N3', '901', '數學', '劉淑美', 2),
    needRow('N4', '901', '數學', '莊英勝', 3)
  ],
  seasonalSchedule: [],
  seasonalTeacherBlocks: []
};

vm.runInContext("seasonalActiveSessionId = 'S1'; renderSeasonalTimetable = function () {};", sandbox);

const doc = sandbox.$document;
const html = id => doc.getElementById(id).innerHTML;
const text = id => doc.getElementById(id).textContent;

sandbox.seasonalRenderNeeds();
const matrix = html('seasonal-needs-body');

check('輸出配課矩陣表格', () => assert(matrix.includes('class="needs-matrix"'), '缺少 needs-matrix 表格'));
check('表頭第一欄為班級', () => assert(matrix.includes('needs-matrix-corner">班級'), '缺少班級表頭'));
check('科目各自成欄並依名稱排序', () => {
  assert(matrix.includes('<th>數學</th>') && matrix.includes('<th>國文</th>'), '科目欄缺少');
  const expected = ['國文', '數學'].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  assert(matrix.indexOf('<th>' + expected[0] + '</th>') < matrix.indexOf('<th>' + expected[1] + '</th>'), '科目欄未依名稱排序：預期 ' + expected.join(' → '));
});
check('列為九年級班級且依代碼排序', () => {
  const rows = [...matrix.matchAll(/<th scope="row">(\d+)<\/th>/g)].map(match => match[1]);
  assert(rows.length === 8, '班級列數不符：' + rows.length);
  assert(rows[0] === '901' && rows[7] === '908', '班級排序不符：' + rows.join(','));
});
check('已配格顯示教師與節數', () => {
  assert(matrix.includes('needs-cell-teacher">莊英勝'), '格子未顯示教師');
  assert(matrix.includes('needs-cell-count">5 節'), '格子未顯示節數');
});
check('空白格提供新增入口並帶入班級與科目', () => {
  assert(matrix.includes('data-add-need-class="908"'), '缺少空白格新增按鈕');
  assert(matrix.includes('data-add-need-subject="國文"'), '空白格未帶入科目');
});
check('同班同科多筆以多列呈現', () => {
  const cell = /<td class="needs-matrix-cell has-need is-multi">([\s\S]*?)<\/td>/.exec(matrix);
  assert(cell, '缺少 is-multi 標記');
  assert((cell[1].match(/needs-cell-body/g) || []).length === 2, '多筆格未輸出兩筆');
});
check('統計列顯示班級、科目、筆數與未配格數', () => {
  assert(text('seasonal-needs-summary') === '8 班 · 2 科 · 4 筆需求，未配 13 格', '統計文字不符：' + text('seasonal-needs-summary'));
});
check('點空白格進入新增模式並帶入班級與科目', () => {
  vm.runInContext("seasonalOpenAddNeedModal('908', '國文')", sandbox);
  assert(doc.getElementById('seasonal-edit-need-mode').value === 'add', '模式應為 add');
  assert(doc.getElementById('seasonal-edit-need-class').value === '908', '班級未帶入');
  assert(doc.getElementById('seasonal-edit-need-subject').value === '國文', '科目未帶入');
  assert(doc.getElementById('seasonal-edit-need-title').textContent === '新增課程需求', '標題未切換');
  assert(doc.getElementById('seasonal-edit-need-save').textContent === '新增需求', '按鈕文字未切換');
  assert(doc.getElementById('seasonal-edit-need-delete').hidden === true, '新增模式不應顯示刪除');
});
check('點已配格進入編輯模式並帶入該筆資料', () => {
  vm.runInContext("openSeasonalEditNeedModal('N3')", sandbox);
  assert(doc.getElementById('seasonal-edit-need-mode').value === 'edit', '模式應為 edit');
  assert(doc.getElementById('seasonal-edit-need-class').value === '901', '班級未帶入');
  assert(doc.getElementById('seasonal-edit-need-subject').value === '數學', '科目未帶入');
  assert(doc.getElementById('seasonal-edit-need-teacher').value === '劉淑美', '教師未帶入');
  assert(doc.getElementById('seasonal-edit-need-count').value === '2', '節數未帶入');
  assert(doc.getElementById('seasonal-edit-need-delete').hidden === false, '編輯模式應顯示刪除');
});

(async () => {
  vm.runInContext([
    'seasonalPersistActive = async function () {};',
    'seasonalFillSubjectOptions = function () {};',
    'seasonalFillTeacherOptions = function () {};',
    'seasonalPopulateViewSelect = function () {};'
  ].join(' '), sandbox);

  const before = sandbox.state.seasonalNeeds.length;
  vm.runInContext("seasonalOpenAddNeedModal('908', '國文')", sandbox);
  doc.getElementById('seasonal-edit-need-teacher').value = '劉淑美';
  doc.getElementById('seasonal-edit-need-count').value = '4';
  await vm.runInContext('saveSeasonalEditNeed()', sandbox);
  check('新增模式寫入一筆並更新矩陣', () => {
    const rows = sandbox.state.seasonalNeeds;
    assert(rows.length === before + 1, '需求筆數未增加：' + rows.length);
    const added = rows[rows.length - 1];
    assert(added['班級代碼'] === '908' && added['科目代碼'] === '國文', '新增內容不符：' + JSON.stringify(added));
    assert(added['場次ID'] === 'S1', '新增未帶場次ID');
    assert(text('seasonal-needs-summary').includes('5 筆需求'), '統計未更新：' + text('seasonal-needs-summary'));
  });

  const target = sandbox.state.seasonalNeeds.find(row => row['班級代碼'] === '908' && row['科目代碼'] === '國文');
  await vm.runInContext("deleteSeasonalNeedById('" + target['需求ID'] + "')", sandbox);
  check('刪除後矩陣回復空白格', () => {
    assert(!sandbox.state.seasonalNeeds.some(row => row['需求ID'] === target['需求ID']), '需求未刪除');
    assert(html('seasonal-needs-body').includes('data-add-need-class="908"'), '未回復空白格');
  });

  for (const result of results) {
    console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.error ? `: ${result.error}` : ''}`);
  }
  if (results.some(result => !result.ok)) process.exitCode = 1;
})();
