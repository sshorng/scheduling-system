// ============================================================
// Word 課表匯出 (班級課表 + 教師課表)
// 模板：class-official-template.docx / class-teacher-official-template.docx
// 依賴：PizZip、FileSaver.js
// 原則：只處理佔位符與空白配課的局部合併，欄寬依範本 grid 固定
// ============================================================

function parseDocxZip(buf) {
  const ZipConstructor = (typeof PizZip !== 'undefined') ? PizZip : ((typeof window !== 'undefined' && window.PizZip) ? window.PizZip : (typeof JSZip !== 'undefined' ? JSZip : null));
  if (!ZipConstructor) throw new Error('找不到 Word 解壓套件 (PizZip)，請確認網路連線正常後重新整理頁面');
  return new ZipConstructor(buf);
}

let _tplCache = null;
let _teacherTplCache = null;
let _roomTplCache = null;
let _patrolExcelTplCache = null;
let _wordCurrentTab = 'class'; // 'class' | 'teacher' | 'room' | 'patrol'

const BUDING_SUBJECTS = new Set([
  '國文', '英語', '英文', '本土語',
  '數學',
  '歷史', '地理', '公民', '公民與社會',
  '生物', '理化', '自然', '地球科學',
  '音樂', '視覺藝術', '表演藝術',
  '家政', '童軍', '輔導',
  '資訊科技', '生活科技',
  '健康教育', '體育'
]);

const FLEX_SUBJECT_ORDER = [
  '走讀建成生活圈', '全球議題', '文旅享繪', '活力建成',
  '建成公民行動家', '文化種籽在建成', '全球素養',
  '英悅讀樂樂', '閱思溝通建成人', '藝統摺學', '全民國防'
];

const SUBJECT_ALIASES = {
  '公民與社會': '公民', '公民': '公民',
  '英文': '英語', '週會': '班週會',
  '理化': '生物', '自然': '生物'
};

const FIXED_SLOT_NAMES = [
  '國文', '生物', '班週會', '英語', '家政', '本土語', '童軍',
  '數學', '輔導', '資訊科技', '音樂', '生活科技', '視覺藝術',
  '歷史', '表演藝術', '地理', '健康教育', '公民', '體育'
];

const WORD_EARLY_PERIOD = 0;
const WORD_LUNCH_PERIOD = 45;
const WORD_P8_SPLIT_FONT_SIZE = 24;
const WORD_MIN_COURSE_ROW_HEIGHT = 20;

function wordRowText(xml) {
  return String(xml || '')
    .replace(/<w:tab\s*\/?\s*>/g, '\t')
    .replace(/<w:br\s*\/?\s*>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function wordRows(xml) {
  return [...String(xml || '').matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)].map(match => match[0]);
}

function wordCells(rowXml) {
  return [...String(rowXml || '').matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)].map(match => match[0]);
}

function wordReplacePlaceholders(cellXml, replacements) {
  let out = String(cellXml || '');
  Object.entries(replacements || {}).forEach(([from, to]) => {
    out = out.split('{' + from + '}').join('{' + to + '}');
  });
  return out;
}

function wordBlankCell(cellXml) {
  return String(cellXml || '').replace(/<w:t(\s[^>]*)?>[\s\S]*?<\/w:t>/g, '<w:t$1></w:t>');
}

function wordRemoveBold(cellXml) {
  return String(cellXml || '')
    .replace(/<w:b(?:\s[^>]*)?\s*\/?>(?:<\/w:b>)?/g, '')
    .replace(/<w:bCs(?:\s[^>]*)?\s*\/?>(?:<\/w:bCs>)?/g, '');
}

function wordSetVerticalMerge(cellXml, mode) {
  let out = String(cellXml || '');
  const merge = mode === 'restart' ? '<w:vMerge w:val="restart"/>' : (mode === 'continue' ? '<w:vMerge/>' : '');
  out = out.replace(/<w:vMerge(?:\s[^>]*)?\s*\/?>(?:<\/w:vMerge>)?/g, '');
  if (!merge) return out;
  const tcPr = out.match(/<w:tcPr[\s\S]*?<\/w:tcPr>/);
  if (tcPr) return out.replace(tcPr[0], tcPr[0].replace('</w:tcPr>', merge + '</w:tcPr>'));
  return out.replace(/(<w:tc(?:\s[^>]*)?>)/, '$1<w:tcPr>' + merge + '</w:tcPr>');
}

function wordRebuildRow(rowXml, cells) {
  const open = String(rowXml || '').match(/^<w:tr[^>]*>/)?.[0] || '<w:tr>';
  const trPr = String(rowXml || '').match(/<w:trPr[\s\S]*?<\/w:trPr>/)?.[0] || '';
  return open + trPr + cells.join('') + '</w:tr>';
}

function wordSpecialValue(dict, day, period, mode, suffix) {
  const key = mode === 'class'
    ? 'd' + day + 'p' + period
    : 'd' + day + 'p' + period + '_' + suffix;
  return String(dict[key] || '').trim();
}

function expandWordSpecialRows(pageXml, dict, mode) {
  const rowList = wordRows(pageXml);
  const sourceRow = rowList.find(row => mode === 'class' ? /\{d1p1\}/.test(row) : /\{d1p1_s\}/.test(row));
  if (!sourceRow) return pageXml;
  const sourceCells = wordCells(sourceRow);
  const dayStart = mode === 'class' ? 2 : 3;
  if (sourceCells.length < dayStart + 5) return pageXml;

  let output = pageXml;
  const buildRow = (rowXml, period, topRow, mergeDays) => {
    const targetCells = wordCells(rowXml);
    if (targetCells.length < 2) return rowXml;
    const cells = [targetCells[0]];
    // 班級午休列原本把「午休」合併到節次欄與五個星期欄，
    // 有課時需拆回正常列的節次欄，否則整列會少兩個 grid 欄位。
    if (mode === 'class' && period === WORD_LUNCH_PERIOD && targetCells[1] && sourceCells[1]) {
      let periodCell = wordSetCellGridSpan(targetCells[1], wordCellGridSpan(sourceCells[1]));
      periodCell = wordSetCellWidth(periodCell, wordCellWidth(sourceCells[1]));
      cells.push(periodCell);
    }
    for (let day = 1; day <= 5; day++) {
      const sourceCell = sourceCells[dayStart + day - 1];
      const replacements = mode === 'class'
        ? { ['d' + day + 'p1']: 'd' + day + 'p' + period }
        : {
            ['d' + day + 'p1_s']: 'd' + day + 'p' + period + '_s',
            ['d' + day + 'p1_c']: 'd' + day + 'p' + period + '_c'
          };
      let cell = wordReplacePlaceholders(sourceCell, replacements);
      cell = wordRemoveBold(cell);
      const hasValue = wordSpecialValue(dict, day, period, mode, 's') || wordSpecialValue(dict, day, period, mode, '');
      if (!topRow) cell = wordBlankCell(cell);
      if (mergeDays && hasValue) cell = wordSetVerticalMerge(cell, topRow ? 'restart' : 'continue');
      cells.push(cell);
    }
    return wordRebuildRow(rowXml, cells);
  };

  const earlyTop = rowList.find(row => wordRowText(row).includes('07:40'));
  const earlyBottom = rowList.find(row => wordRowText(row).includes('08:15') && !wordRowText(row).includes('07:40'));
  const earlyValues = Array.from({ length: 5 }, (_, index) => wordSpecialValue(dict, index + 1, WORD_EARLY_PERIOD, mode, 's') || wordSpecialValue(dict, index + 1, WORD_EARLY_PERIOD, mode, ''));
  if (earlyTop && earlyBottom && earlyValues.some(Boolean)) {
    output = output.replace(earlyTop, buildRow(earlyTop, WORD_EARLY_PERIOD, true, true));
    output = output.replace(earlyBottom, buildRow(earlyBottom, WORD_EARLY_PERIOD, false, true));
  }

  const lunchRow = wordRows(output).find(row => wordRowText(row).includes('12:35') && wordRowText(row).includes('午休'));
  const lunchValues = Array.from({ length: 5 }, (_, index) => wordSpecialValue(dict, index + 1, WORD_LUNCH_PERIOD, mode, 's') || wordSpecialValue(dict, index + 1, WORD_LUNCH_PERIOD, mode, ''));
  if (lunchRow && lunchValues.some(Boolean)) {
    output = output.replace(lunchRow, buildRow(lunchRow, WORD_LUNCH_PERIOD, true, false));
  }
  return output;
}

function wordReplacePlaceholderValue(cellXml, key, value) {
  const rawValue = String(value == null ? '' : value);
  if (/\r?\n/.test(rawValue)) {
    const replaced = wordReplaceRunTextPlaceholder(cellXml, key, rawValue);
    if (replaced !== null) return replaced;
  }
  const replacement = escXml(rawValue);
  return String(cellXml || '').split('{' + key + '}').join(replacement);
}

function wordReplaceRunTextPlaceholder(xml, key, value) {
  const token = '{' + String(key || '') + '}';
  const lines = String(value == null ? '' : value).split(/\r?\n/);
  let replaced = false;
  const output = String(xml || '').replace(/<w:r(\s[^>]*)?>([\s\S]*?)<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>([\s\S]*?)<\/w:r>/g, (whole, runAttrs, beforeText, textAttrs, text, afterText) => {
    const tokenIndex = text.indexOf(token);
    if (tokenIndex < 0) return whole;
    replaced = true;
    const before = text.slice(0, tokenIndex);
    const after = text.slice(tokenIndex + token.length);
    return lines.map((line, index) => {
      const lineText = (index === 0 ? before : '') + escXml(line) + (index === lines.length - 1 ? after : '');
      const breakTag = index < lines.length - 1 ? '<w:br/>' : '';
      return '<w:r' + (runAttrs || '') + '>' + beforeText + '<w:t' + (textAttrs || '') + '>' + lineText + '</w:t>' + afterText + breakTag + '</w:r>';
    }).join('');
  });
  return replaced ? output : null;
}

function wordSetSplitCellFontSize(xml, halfPoints) {
  const size = String(Math.max(1, parseInt(halfPoints, 10) || WORD_P8_SPLIT_FONT_SIZE));
  const sizeTag = '<w:sz w:val="' + size + '"/>';
  const sizeCsTag = '<w:szCs w:val="' + size + '"/>';
  let out = String(xml || '')
    .replace(/<w:sz(?:\s[^>]*)?\s*\/?>(?:<\/w:sz>)?/g, sizeTag)
    .replace(/<w:szCs(?:\s[^>]*)?\s*\/?>(?:<\/w:szCs>)?/g, sizeCsTag);
  if (!/<w:sz\b/.test(out)) {
    out = out.replace(/<w:rPr(?:\s[^>]*)?>/g, '$&' + sizeTag + sizeCsTag);
  }
  return out;
}

function wordSetPlaceholderFontSize(xml, key, halfPoints) {
  const token = '{' + String(key || '') + '}';
  return String(xml || '').replace(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g, cell => {
    return cell.includes(token) ? wordSetSplitCellFontSize(cell, halfPoints) : cell;
  });
}

function wordSetCellFontColor(cellXml, color) {
  const value = String(color || '7F7F7F').replace(/^#/, '').toUpperCase();
  const colorTag = '<w:color w:val="' + value + '"/>';
  let output = String(cellXml || '').replace(/<w:color\b[^>]*\/?>(?:<\/w:color>)?/g, colorTag);
  if (output.includes('<w:color ')) return output;
  if (/<w:rPr(?:\s[^>]*)?>/.test(output)) {
    return output.replace(/<w:rPr(?:\s[^>]*)?>/g, '$&' + colorTag);
  }
  return output.replace(/<w:r(\s[^>]*)?>/g, '$&<w:rPr>' + colorTag + '</w:rPr>');
}

function wordSetPlaceholderFontColor(xml, key, color) {
  const token = '{' + String(key || '') + '}';
  return String(xml || '').replace(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g, cell => {
    return cell.includes(token) ? wordSetCellFontColor(cell, color) : cell;
  });
}

function isWordP8PlaceholderKey(key) {
  return /^d[1-5]p8(?:s|d|_[sc](?:_(?:single|double))?)?$/.test(String(key || ''));
}

function applyWordPlaceholderFontColors(pageXml, keys, color) {
  let output = String(pageXml || '');
  // 第八節字體顏色由 Word 範本決定，不在套版階段覆寫。
  [...new Set(keys || [])].filter(key => !isWordP8PlaceholderKey(key)).forEach(key => {
    output = wordSetPlaceholderFontColor(output, key, color);
  });
  return output;
}

function applyTeacherClassFontSizes(pageXml, sizes) {
  let output = String(pageXml || '');
  Object.entries(sizes || {}).forEach(([key, halfPoints]) => {
    if (isWordP8PlaceholderKey(key)) return;
    const keys = [key];
    if (/_c$/.test(key)) keys.push(key + '_single', key + '_double');
    keys.forEach(item => {
      output = wordSetPlaceholderFontSize(output, item, halfPoints);
    });
  });
  return output;
}

function wordCellGridSpan(cellXml) {
  const match = String(cellXml || '').match(/<w:gridSpan[^>]*w:val="(\d+)"/);
  return Math.max(1, parseInt(match?.[1] || '1', 10));
}

function wordCellWidth(cellXml) {
  const match = String(cellXml || '').match(/<w:tcW[^>]*w:w="(\d+)"/);
  return Math.max(2, parseInt(match?.[1] || '1000', 10));
}

function wordSetCellWidth(cellXml, width) {
  const value = Math.max(1, parseInt(width, 10) || 1);
  const source = String(cellXml || '');
  const widthTag = '<w:tcW w:w="' + value + '" w:type="dxa"/>';
  const tcPr = source.match(/<w:tcPr[\s\S]*?<\/w:tcPr>/);
  if (!tcPr) return source.replace(/(<w:tc(?:\s[^>]*)?>)/, '$1<w:tcPr>' + widthTag + '</w:tcPr>');
  let nextTcPr = tcPr[0]
    .replace(/<w:tcW\b[^>]*\/>/, widthTag)
    .replace(/<w:tcW\b[^>]*>[\s\S]*?<\/w:tcW>/, widthTag);
  if (!/<w:tcW\b/.test(nextTcPr)) nextTcPr = nextTcPr.replace('</w:tcPr>', widthTag + '</w:tcPr>');
  return source.replace(tcPr[0], nextTcPr);
}

function wordLockTableColumns(pageXml) {
  return String(pageXml || '').replace(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g, tableXml => {
    const gridMatch = tableXml.match(/<w:tblGrid[\s\S]*?<\/w:tblGrid>/);
    if (!gridMatch) return tableXml;
    const gridColumns = (gridMatch[0].match(/<w:gridCol\b[^>]*>/g) || []).map(column => {
      const width = parseInt(column.match(/w:w="(\d+)"/)?.[1] || '0', 10);
      return Math.max(1, width || 1);
    });
    if (gridColumns.length === 0) return tableXml;

    const tableWidth = gridColumns.reduce((sum, width) => sum + width, 0);
    const tablePrMatch = tableXml.match(/<w:tblPr[\s\S]*?<\/w:tblPr>/);
    if (!tablePrMatch) return tableXml;
    let tablePr = tablePrMatch[0];
    const tableWidthTag = '<w:tblW w:w="' + tableWidth + '" w:type="dxa"/>';
    tablePr = tablePr
      .replace(/<w:tblW\b[^>]*\/>/, tableWidthTag)
      .replace(/<w:tblW\b[^>]*>[\s\S]*?<\/w:tblW>/, tableWidthTag);
    if (!/<w:tblW\b/.test(tablePr)) tablePr = tablePr.replace('</w:tblPr>', tableWidthTag + '</w:tblPr>');
    tablePr = tablePr
      .replace(/<w:tblLayout\b[^>]*\/>/, '<w:tblLayout w:type="fixed"/>')
      .replace(/<w:tblLayout\b[^>]*>[\s\S]*?<\/w:tblLayout>/, '<w:tblLayout w:type="fixed"/>');
    if (!/<w:tblLayout\b/.test(tablePr)) tablePr = tablePr.replace('</w:tblPr>', '<w:tblLayout w:type="fixed"/></w:tblPr>');

    let output = tableXml.replace(tablePrMatch[0], tablePr);
    output = output.replace(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g, rowXml => {
      const cells = wordCells(rowXml);
      let cursor = 0;
      let valid = true;
      const nextCells = cells.map(cell => {
        const span = wordCellGridSpan(cell);
        if (cursor + span > gridColumns.length) {
          valid = false;
          return cell;
        }
        const width = gridColumns.slice(cursor, cursor + span).reduce((sum, value) => sum + value, 0);
        cursor += span;
        return wordSetCellWidth(cell, width);
      });
      if (!valid || cursor !== gridColumns.length) return rowXml;
      return wordRebuildRow(rowXml, nextCells);
    });
    return output;
  });
}

function wordSetCellGridSpan(cellXml, span) {
  const value = Math.max(1, parseInt(span, 10) || 1);
  const source = String(cellXml || '');
  const tcPr = source.match(/<w:tcPr[\s\S]*?<\/w:tcPr>/);
  if (!tcPr) return source;
  let nextTcPr = tcPr[0]
    .replace(/<w:gridSpan\b[^>]*\/>/g, '')
    .replace(/<w:gridSpan\b[^>]*>[\s\S]*?<\/w:gridSpan>/g, '');
  if (value > 1) nextTcPr = nextTcPr.replace('</w:tcPr>', '<w:gridSpan w:val="' + value + '"/></w:tcPr>');
  return source.replace(tcPr[0], nextTcPr);
}

function wordSplitDirectCells(cellXml, key, values, span, totalWidth, valueKeys) {
  const sourceWidth = Number.isFinite(Number(totalWidth)) ? Number(totalWidth) : wordCellWidth(cellXml);
  const firstWidth = Math.floor(sourceWidth / 2);
  const secondWidth = sourceWidth - firstWidth;
  return values.map((value, index) => {
    const width = index === 0 ? firstWidth : secondWidth;
    let cell = valueKeys && valueKeys[index]
      ? wordReplacePlaceholders(cellXml, { [key]: valueKeys[index] })
      : wordReplacePlaceholderValue(cellXml, key, value);
    // 拆欄統一為 12pt，其他字體、字色與範本排版維持不變。
    cell = wordSetSplitCellFontSize(cell, WORD_P8_SPLIT_FONT_SIZE);
    cell = wordSetCellWidth(cell, width);
    return wordSetCellGridSpan(cell, span);
  }).join('');
}

function wordExpandedGrid(tableXml, dayRegions) {
  const grid = tableXml.match(/<w:tblGrid[\s\S]*?<\/w:tblGrid>/)?.[0];
  if (!grid) return null;
  const tags = grid.match(/<w:gridCol[^>]*>/g) || [];
  const output = [];
  const splitByIndex = new Map();
  dayRegions.forEach(region => {
    const regionTags = tags.slice(region.start, region.end);
    const widths = regionTags.map(tag => Math.max(2, parseInt(tag.match(/w:w="(\d+)"/)?.[1] || '2', 10)));
    const targetFirst = Math.floor(widths.reduce((sum, width) => sum + width, 0) / 2);
    const baseFirst = widths.map(width => Math.floor(width / 2));
    let extra = targetFirst - baseFirst.reduce((sum, width) => sum + width, 0);
    widths.forEach((width, offset) => {
      const first = baseFirst[offset] + (extra > 0 && width % 2 === 1 ? (extra--, 1) : 0);
      splitByIndex.set(region.start + offset, { first, second: width - first });
    });
  });
  let index = 0;
  while (index < tags.length) {
    const region = dayRegions.find(item => item.start === index);
    if (!region) {
      output.push(tags[index]);
      index++;
      continue;
    }
    // 兩個子儲存格必須各自取得連續的一半 grid，不能逐欄交錯，否則固定表格重算欄寬會失真。
    for (let column = region.start; column < region.end; column++) {
      const widths = splitByIndex.get(column);
      output.push(tags[column].replace(/w:w="\d+"/, 'w:w="' + widths.first + '"'));
    }
    for (let column = region.start; column < region.end; column++) {
      const widths = splitByIndex.get(column);
      output.push(tags[column].replace(/w:w="\d+"/, 'w:w="' + widths.second + '"'));
    }
    index = region.end;
  }
  const open = grid.match(/^<w:tblGrid[^>]*>/)?.[0] || '<w:tblGrid>';
  return open + output.join('') + '</w:tblGrid>';
}

function wordP8TableLayout(tableXml, mode) {
  const rows = wordRows(tableXml);
  const p8Row = rows.find(row => mode === 'class' ? /\{d1p8\}/.test(row) : /\{d1p8_s\}/.test(row));
  const grid = tableXml.match(/<w:tblGrid[\s\S]*?<\/w:tblGrid>/)?.[0];
  const gridCols = grid ? (grid.match(/<w:gridCol[^>]*>/g) || []) : [];
  if (!p8Row || gridCols.length === 0) return null;
  const cells = wordCells(p8Row);
  const fixedCount = mode === 'class' ? 2 : 3;
  if (cells.length < fixedCount + 5) return null;

  const dayRegions = [];
  let cursor = 0;
  cells.forEach((cell, index) => {
    const span = wordCellGridSpan(cell);
    if (index >= fixedCount && index < fixedCount + 5) {
      dayRegions.push({ start: cursor, end: cursor + span });
    }
    cursor += span;
  });
  if (dayRegions.length !== 5 || cursor > gridCols.length) return null;
  const splitColumns = new Set();
  dayRegions.forEach(region => {
    region.width = gridCols.slice(region.start, region.end).reduce((sum, tag) => {
      return sum + Math.max(2, parseInt(tag.match(/w:w="(\d+)"/)?.[1] || '2', 10));
    }, 0);
    for (let index = region.start; index < region.end; index++) splitColumns.add(index);
  });
  const expandedFactors = gridCols.map((_, index) => splitColumns.has(index) ? 2 : 1);
  return { rows, grid, dayRegions, expandedFactors };
}

function wordExpandedSpan(factors, start, span) {
  return factors.slice(start, start + span).reduce((total, factor) => total + factor, 0);
}

function teacherP8WeekValues(teacherCode, day, suffix) {
  const cellsForWeek = weekType => teacherP8WeekCells(teacherCode, day, weekType);
  return ['單週', '雙週'].map(weekType => {
    const weekCells = cellsForWeek(weekType);
    if (suffix === 's') return [...new Set(weekCells.map(cell => teacherWordSubject(cell, teacherCode)).filter(Boolean))].join(' / ');
    const classInfo = teacherWordClassInfoForCells(weekCells);
    return teacherWordClassLabel(classInfo.codes).text;
  });
}

function teacherP8WeekCells(teacherCode, day, weekType) {
  const key = String(teacherCode || '') + '|' + day + '|8';
  const cells = (typeof idx !== 'undefined' && idx.schedByTeacherSlot && idx.schedByTeacherSlot[key]) || [];
  return cells.filter(cell => String(cell && cell['課堂屬性'] || '').trim() === weekType);
}

function classWordScheduleCell(classCode, day, period, weekType) {
  if (period === 8 && weekType) {
    const key = String(classCode || '') + '|' + day + '|8';
    const p8 = (typeof idx !== 'undefined' && idx.schedByClassSlotP8 && idx.schedByClassSlotP8[key]) || {};
    return p8[weekType] || null;
  }
  const key = String(classCode || '') + '|' + day + '|' + period;
  return typeof idx !== 'undefined' && idx.schedByClassSlot ? idx.schedByClassSlot[key] : null;
}

function classWordScheduleSubject(classCode, day, period, weekType) {
  const cell = classWordScheduleCell(classCode, day, period, weekType);
  return String(cell && cell['科目代碼'] || '').trim();
}

function splitTeacherP8Rows(pageXml, teacherCode) {
  const table = (pageXml.match(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g) || [])
    .find(item => item.includes('{d1p8_s}'));
  if (!table) return pageXml;
  const layout = wordP8TableLayout(table, 'teacher');
  if (!layout) return pageXml;
  const fixedCount = 3;
  const transformRow = rowXml => {
    const cells = wordCells(rowXml);
    let cursor = 0;
    const outputCells = [];
    const isSubjectRow = /\{d1p8_s\}/.test(rowXml);
    const isClassRow = /\{d1p8_c\}/.test(rowXml);
    cells.forEach((cell, index) => {
      const originalSpan = wordCellGridSpan(cell);
      const expandedSpan = wordExpandedSpan(layout.expandedFactors, cursor, originalSpan);
      const day = index - fixedCount + 1;
      if ((isSubjectRow || isClassRow) && day >= 1 && day <= 5) {
        const suffix = isSubjectRow ? 's' : 'c';
        const values = teacherP8WeekValues(teacherCode, day, suffix);
        if (values[0] && values[1]) {
          const region = layout.dayRegions[day - 1];
          outputCells.push(wordSplitDirectCells(
            cell,
            'd' + day + 'p8_' + suffix,
            values,
            expandedSpan / 2,
            region && region.width,
            ['d' + day + 'p8_' + suffix + '_single', 'd' + day + 'p8_' + suffix + '_double']
          ));
          cursor += originalSpan;
          return;
        }
      }
      // 非第八節儲存格沿用官方範本的 tcW，只調整 gridSpan 以配合第八節拆欄。
      outputCells.push(wordSetCellGridSpan(cell, expandedSpan));
      cursor += originalSpan;
    });
    return wordRebuildRow(rowXml, outputCells);
  };

  const expandedGrid = wordExpandedGrid(table, layout.dayRegions);
  if (!expandedGrid) return pageXml;
  let outputTable = table.replace(layout.grid, expandedGrid);
  layout.rows.forEach(row => { outputTable = outputTable.replace(row, transformRow(row)); });
  return pageXml.replace(table, outputTable);
}

function classP8WeekValues(classCode, day) {
  const key = String(classCode || '') + '|' + day + '|8';
  const p8 = (typeof idx !== 'undefined' && idx.schedByClassSlotP8 && idx.schedByClassSlotP8[key]) || {};
  return ['單週', '雙週'].map(weekType => {
    const cell = p8[weekType];
    const subject = String(cell && cell['科目代碼'] || '').trim();
    return subject
      ? classWordSubjectLabel(subject + '(' + (weekType === '單週' ? '單' : '雙') + ')')
      : '';
  });
}

function splitClassP8Row(pageXml, classCode) {
  const table = (pageXml.match(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g) || [])
    .find(item => item.includes('{d1p8}'));
  if (!table) return pageXml;
  const layout = wordP8TableLayout(table, 'class');
  if (!layout) return pageXml;
  const fixedCount = 2;
  const transformRow = rowXml => {
    const cells = wordCells(rowXml);
    let cursor = 0;
    const outputCells = [];
    const isP8Row = /\{d1p8\}/.test(rowXml);
    cells.forEach((cell, index) => {
      const originalSpan = wordCellGridSpan(cell);
      const expandedSpan = wordExpandedSpan(layout.expandedFactors, cursor, originalSpan);
      const day = index - fixedCount + 1;
      if (isP8Row && day >= 1 && day <= 5) {
        const values = classP8WeekValues(classCode, day);
        if (values[0] && values[1]) {
          const region = layout.dayRegions[day - 1];
          outputCells.push(wordSplitDirectCells(
            cell,
            'd' + day + 'p8',
            values,
            expandedSpan / 2,
            region && region.width,
            ['d' + day + 'p8s', 'd' + day + 'p8d']
          ));
          cursor += originalSpan;
          return;
        }
      }
      // 非第八節儲存格沿用官方範本的 tcW，只調整 gridSpan 以配合第八節拆欄。
      outputCells.push(wordSetCellGridSpan(cell, expandedSpan));
      cursor += originalSpan;
    });
    return wordRebuildRow(rowXml, outputCells);
  };

  const expandedGrid = wordExpandedGrid(table, layout.dayRegions);
  if (!expandedGrid) return pageXml;
  let outputTable = table.replace(layout.grid, expandedGrid);
  layout.rows.forEach(row => { outputTable = outputTable.replace(row, transformRow(row)); });
  return pageXml.replace(table, outputTable);
}

function switchWordTab(tab) {
  _wordCurrentTab = tab;
  const classTabBtn = document.getElementById('word-tab-class');
  const teacherTabBtn = document.getElementById('word-tab-teacher');
  const roomTabBtn = document.getElementById('word-tab-room');
  const patrolTabBtn = document.getElementById('word-tab-patrol');
  const classPanel = document.getElementById('word-class-panel');
  const teacherPanel = document.getElementById('word-teacher-panel');
  const roomPanel = document.getElementById('word-room-panel');
  const patrolPanel = document.getElementById('word-patrol-panel');
  const selectControls = document.getElementById('word-select-controls');
  const desc = document.getElementById('word-desc');

  if (tab === 'class') {
    if (classTabBtn) classTabBtn.className = 'btn btn-sm btn-primary';
    if (teacherTabBtn) teacherTabBtn.className = 'btn btn-sm btn-ghost';
    if (roomTabBtn) roomTabBtn.className = 'btn btn-sm btn-ghost';
    if (patrolTabBtn) patrolTabBtn.className = 'btn btn-sm btn-ghost';
    if (classPanel) classPanel.style.display = 'block';
    if (teacherPanel) teacherPanel.style.display = 'none';
    if (roomPanel) roomPanel.style.display = 'none';
    if (patrolPanel) patrolPanel.style.display = 'none';
    if (selectControls) selectControls.style.display = 'flex';
    if (desc) desc.textContent = '勾選要匯出的班級，套用官方 Word 範本產出一份 .docx（每班一頁）。';
  } else if (tab === 'teacher') {
    if (classTabBtn) classTabBtn.className = 'btn btn-sm btn-ghost';
    if (teacherTabBtn) teacherTabBtn.className = 'btn btn-sm btn-primary';
    if (roomTabBtn) roomTabBtn.className = 'btn btn-sm btn-ghost';
    if (patrolTabBtn) patrolTabBtn.className = 'btn btn-sm btn-ghost';
    if (classPanel) classPanel.style.display = 'none';
    if (teacherPanel) teacherPanel.style.display = 'block';
    if (roomPanel) roomPanel.style.display = 'none';
    if (patrolPanel) patrolPanel.style.display = 'none';
    if (selectControls) selectControls.style.display = 'flex';
    if (desc) desc.textContent = '勾選要匯出的教師，套用官方 Word 範本產出一份 .docx（每人一頁，含配課總表）。第八節支援單雙週拆欄。';
  } else if (tab === 'room') {
    if (classTabBtn) classTabBtn.className = 'btn btn-sm btn-ghost';
    if (teacherTabBtn) teacherTabBtn.className = 'btn btn-sm btn-ghost';
    if (roomTabBtn) roomTabBtn.className = 'btn btn-sm btn-primary';
    if (patrolTabBtn) patrolTabBtn.className = 'btn btn-sm btn-ghost';
    if (classPanel) classPanel.style.display = 'none';
    if (teacherPanel) teacherPanel.style.display = 'none';
    if (roomPanel) roomPanel.style.display = 'block';
    if (patrolPanel) patrolPanel.style.display = 'none';
    if (selectControls) selectControls.style.display = 'flex';
    if (desc) desc.textContent = '勾選要匯出的專科教室，套用官方 Word 範本 room-official-template.docx 產出一份 .docx（每間教室一頁，含使用總表）。';
  } else {
    if (classTabBtn) classTabBtn.className = 'btn btn-sm btn-ghost';
    if (teacherTabBtn) teacherTabBtn.className = 'btn btn-sm btn-ghost';
    if (roomTabBtn) roomTabBtn.className = 'btn btn-sm btn-ghost';
    if (patrolTabBtn) patrolTabBtn.className = 'btn btn-sm btn-primary';
    if (classPanel) classPanel.style.display = 'none';
    if (teacherPanel) teacherPanel.style.display = 'none';
    if (roomPanel) roomPanel.style.display = 'none';
    if (patrolPanel) patrolPanel.style.display = 'block';
    if (selectControls) selectControls.style.display = 'none';
    if (desc) desc.textContent = '匯出全部巡堂時段，套用 walkthrough-template.xlsx 產出原格式的 Excel 巡堂表。';
  }
  updateWordCount();
}

function openWordExportModal() {
  const classList = document.getElementById('word-class-list');
  const teacherList = document.getElementById('word-teacher-list');
  const roomList = document.getElementById('word-room-list');
  const progress = document.getElementById('word-export-progress');
  const btn = document.getElementById('word-export-btn');

  if (progress) progress.style.display = 'none';
  if (btn) {
    btn.disabled = false;
    btn.textContent = '📥 開始匯出';
  }

  // 1. 渲染班級清單
  const realClasses = state.classes || [];

  if (classList) {
    classList.innerHTML = '';
    realClasses.forEach(cls => {
      const code = cls['班級代碼'];
      const name = cls['班級名稱'];
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;padding:5px 8px;border:1px solid var(--border);border-radius:6px;';
      const virtualMark = String(cls['是否虛擬班']).toUpperCase() === 'TRUE' ? '（抽離／虛擬）' : '';
      label.innerHTML = `<input type="checkbox" class="word-cls-chk" value="${code}" checked onchange="updateWordCount()"> ${name}${virtualMark}`;
      classList.appendChild(label);
    });
  }

  // 2. 渲染教師清單
  if (teacherList) {
    teacherList.innerHTML = '';
    (state.teachers || []).forEach(t => {
      const code = t['姓名'] || t['教師姓名'];
      const name = code;
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;padding:5px 8px;border:1px solid var(--border);border-radius:6px;';
      label.innerHTML = `<input type="checkbox" class="word-t-chk" value="${code}" checked onchange="updateWordCount()"> ${name}`;
      teacherList.appendChild(label);
    });
  }

  // 3. 渲染教室清單
  if (roomList) {
    roomList.innerHTML = '';
    (state.rooms || []).forEach(r => {
      const code = String(r['教室代碼'] || '');
      const name = r['教室名稱'] || code;
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;padding:5px 8px;border:1px solid var(--border);border-radius:6px;';
      label.innerHTML = `<input type="checkbox" class="word-r-chk" value="${code}" checked onchange="updateWordCount()"> ${name}`;
      roomList.appendChild(label);
    });
  }

  const patrolList = document.getElementById('word-patrol-list');
  const patrolSummary = document.getElementById('word-patrol-summary');
  const patrolRows = (state.schedule || [])
    .filter(isPatrolScheduleEntry)
    .sort((a, b) => parseInt(a['星期'], 10) - parseInt(b['星期'], 10) ||
      parseInt(a['節次'], 10) - parseInt(b['節次'], 10) ||
      String(a['教師姓名'] || '').localeCompare(String(b['教師姓名'] || ''), 'zh-Hant'));
  if (patrolSummary) patrolSummary.textContent = patrolRows.length ? '共 ' + patrolRows.length + ' 節，匯出時會全部列入巡堂表。' : '目前尚未建立巡堂時段。';
  if (patrolList) {
    const dayNames = ['', '週一', '週二', '週三', '週四', '週五'];
    patrolList.innerHTML = patrolRows.length
      ? '<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr><th style="text-align:left;padding:6px;border-bottom:1px solid var(--border);">星期</th><th style="text-align:left;padding:6px;border-bottom:1px solid var(--border);">節次</th><th style="text-align:left;padding:6px;border-bottom:1px solid var(--border);">巡堂教師</th><th style="text-align:left;padding:6px;border-bottom:1px solid var(--border);">職務</th></tr></thead><tbody>' +
        patrolRows.map(row => {
          const code = String(row['教師姓名'] || '').trim();
          const teacher = idx.teacherByCode[code] || {};
          const title = teacher['職務'] || teacher['職稱'] || '';
          return '<tr><td style="padding:6px;border-bottom:1px solid var(--border);">' + esc(dayNames[parseInt(row['星期'], 10)] || row['星期']) + '</td>' +
            '<td style="padding:6px;border-bottom:1px solid var(--border);">第' + esc(row['節次']) + '節</td>' +
            '<td style="padding:6px;border-bottom:1px solid var(--border);font-weight:bold;">' + esc(teacherName(code)) + '</td>' +
            '<td style="padding:6px;border-bottom:1px solid var(--border);">' + esc(title) + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<div class="text-muted" style="padding:18px 6px;text-align:center;">目前沒有巡堂時段</div>';
  }

  switchWordTab(_wordCurrentTab || 'class');
  document.getElementById('wordExportModal').classList.add('show');
}

function closeWordExportModal() {
  document.getElementById('wordExportModal').classList.remove('show');
}

function toggleWordSelectAll(checked) {
  if (_wordCurrentTab === 'class') {
    document.querySelectorAll('.word-cls-chk').forEach(chk => { chk.checked = checked; });
  } else if (_wordCurrentTab === 'teacher') {
    document.querySelectorAll('.word-t-chk').forEach(chk => { chk.checked = checked; });
  } else if (_wordCurrentTab === 'room') {
    document.querySelectorAll('.word-r-chk').forEach(chk => { chk.checked = checked; });
  }
  updateWordCount();
}

function updateWordCount() {
  const tab = _wordCurrentTab || 'class';
  if (tab === 'patrol') {
    const patrolCount = (state.schedule || []).filter(isPatrolScheduleEntry).length;
    const cntEl = document.getElementById('word-selected-count');
    if (cntEl) cntEl.textContent = '全部 ' + patrolCount + ' 節巡堂';
    return;
  }
  const selector = tab === 'class' ? '.word-cls-chk' : (tab === 'teacher' ? '.word-t-chk' : '.word-r-chk');
  const selected = document.querySelectorAll(selector + ':checked').length;
  const total = document.querySelectorAll(selector).length;
  const unit = tab === 'class' ? '班' : (tab === 'teacher' ? '位教師' : '間教室');
  
  const cntEl = document.getElementById('word-selected-count');
  if (cntEl) cntEl.textContent = `已選 ${selected} / ${total} ${unit}`;

  const allChk = document.getElementById('word-select-all');
  if (allChk) {
    allChk.checked = selected === total && total > 0;
    allChk.indeterminate = selected > 0 && selected < total;
  }
}

function escXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function teacherName(code) {
  if (!code) return '';
  const t = idx.teacherByCode[code];
  return t ? (t['教師姓名'] || t['姓名'] || code) : String(code);
}

function teacherTitle(code) {
  if (!code) return '';
  const t = idx.teacherByCode[code];
  return t ? (t['職稱'] || t['職務'] || t['教師職稱'] || teacherName(code)) : String(code);
}

function resolveHomeTeacher(classCode, classInfo) {
  let code = String((classInfo && classInfo['導師代碼']) || '').trim();
  if (!code) {
    const ht = (state.teachers || []).find(t => {
      const hr = (typeof getTeacherHomeroom === 'function')
        ? getTeacherHomeroom(t)
        : '';
      return hr && hr !== 'TRUE' && String(hr) === String(classCode);
    });
    if (ht) code = String(ht['教師姓名'] || '');
  }
  return teacherName(code) || code;
}

function normalizeSubjectKey(subj) {
  let s = String(subj || '').trim();
  s = s.replace(/（/g, '(').replace(/）/g, ')').replace(/\s+/g, '');
  if (SUBJECT_ALIASES[s]) return SUBJECT_ALIASES[s];
  return s;
}

function stripSubjectNoise(subj) {
  return String(subj || '')
    .trim()
    .replace(/（/g, '(').replace(/）/g, ')')
    .replace(/\s+/g, '')
    .replace(/\(.*?\)/g, '');
}

function isBudingSubject(subj) {
  const raw = String(subj || '').trim();
  const key = normalizeSubjectKey(raw);
  const bare = stripSubjectNoise(raw);
  if (BUDING_SUBJECTS.has(raw) || BUDING_SUBJECTS.has(key) || BUDING_SUBJECTS.has(bare)) return true;
  if (/輔$|^\S+輔$|單$|雙$/.test(bare)) return true;
  return false;
}

function isBanZhouHui(subj) {
  const bare = stripSubjectNoise(subj);
  return bare === '班週會' || bare === '週會' || normalizeSubjectKey(subj) === '班週會';
}

function isFlexSubject(subj) {
  if (isBanZhouHui(subj)) return false;
  if (isBudingSubject(subj)) return false;
  return true;
}

function findCourseFuzzy(courses, want) {
  const w = stripSubjectNoise(want);
  if (courses[want]) return courses[want];
  const nk = normalizeSubjectKey(want);
  if (courses[nk]) return courses[nk];
  for (const k of Object.keys(courses)) {
    const bare = stripSubjectNoise(courses[k].subject || k);
    if (bare === w || bare.startsWith(w) || w.startsWith(bare)) return courses[k];
    if (stripSubjectNoise(k) === w) return courses[k];
  }
  return null;
}

function collectClassCourses(classCode) {
  const map = {};
  const rawMap = {};
  const rawSubjectKey = value => String(value || '').trim()
    .replace(/[（(][^）)]*[）)]/g, '')
    .trim();

  function nameOf(code) {
    const t = idx.teacherByCode[String(code || '')];
    return t ? (t['姓名'] || String(code || '')) : String(code || '');
  }
  // 每個 key 維護 teacherByCode → 顯示字（含標籤）；以代碼為準，最後寫入覆蓋
  function ensureKey(target, key, sub) {
    if (!target[key]) {
      target[key] = { subject: sub, teachers: [], periods: 0, _byCode: {} };
    }
    if (sub.length > target[key].subject.length) target[key].subject = sub;
    return key;
  }
  function upsertInto(target, key, sub, teacherCode, tag, periods) {
    ensureKey(target, key, sub);
    const c = String(teacherCode || '').trim();
    if (c) {
      const name = nameOf(c);
      const label = String(tag || '').trim();
      const existing = String(target[key]._byCode[c] || '');
      const hasExistingTag = /[（(][^）)]*[）)]/.test(existing);
      if (name && (!existing || label || !hasExistingTag)) {
        target[key]._byCode[c] = label ? name + '(' + label + ')' : name;
      }
    }
    if (periods != null && periods !== '') {
      const n = parseInt(periods, 10);
      if (!isNaN(n) && n > 0) target[key].periods = Math.max(target[key].periods, n);
    }
  }
  function upsert(subj, teacherCode, tag, periods) {
    const raw = String(subj || '').trim();
    if (!raw) return;
    upsertInto(map, normalizeSubjectKey(raw), raw, teacherCode, tag, periods);
    upsertInto(rawMap, rawSubjectKey(raw) || raw, raw, teacherCode, tag, periods);
  }
  function materialize(target) {
    Object.keys(target).forEach(k => {
      target[k].teachers = Object.keys(target[k]._byCode).map(c => target[k]._byCode[c]);
      delete target[k]._byCode;
    });
  }

  function upsertTeacherList(subj, teacherList, periods) {
    const list = Array.isArray(teacherList) ? teacherList.filter(item => String(item?.['教師姓名'] || item?.['姓名'] || '').trim()) : [];
    if (list.length === 0) return;
    const hiddenRoleTags = new Set(['主', '協同', '主教師', '協同教師']);
    const primaryTag = String(list[0]['標籤'] || '').trim();
    upsert(subj, String(list[0]['教師姓名'] || list[0]['姓名'] || '').trim(), hiddenRoleTags.has(primaryTag) ? '' : primaryTag, periods);
    list.slice(1).forEach(item => {
      const tag = String(item['標籤'] || '').trim();
      if (!tag || hiddenRoleTags.has(tag)) return;
      upsert(subj, String(item['教師姓名'] || item['姓名'] || '').trim(), tag, 0);
    });
  }

  (state.assignments || []).forEach(a => {
    if (String(a['班級代碼']) !== String(classCode)) return;
    const sub = a['科目代碼'] || '';
    const teacherList = getCellTeacherList(a);
    const info = idx.subjectByCode[sub];
    const weekly = a['每週節數'] || (info ? info['每週節數'] : '') || '';
    if (teacherList.length > 0) upsertTeacherList(sub, teacherList, weekly);
    else upsert(sub, a['教師姓名'] || '', '', weekly);
  });

  const bySub = {};
  (state.schedule || []).forEach(s => {
    if (String(s['班級代碼']) !== String(classCode)) return;
    const sub = String(s['科目代碼'] || '').trim();
    if (!sub) return;
    // Word 班級課表只顯示主要教師；有語言標籤的協同教師才一併顯示。
    const tList = getCellTeacherList(s);
    if (tList.length > 0) {
      upsertTeacherList(sub, tList, 0);
    } else {
      upsert(sub, s['教師姓名'] || '', '', 0);
    }
    const k = normalizeSubjectKey(sub);
    bySub[k] = (bySub[k] || 0) + 1;
  });
  // 依代碼去重：物化 teachers（保留科目出現在順序）
  materialize(map);
  materialize(rawMap);
  Object.keys(bySub).forEach(k => {
    if (map[k] && (!map[k].periods || map[k].periods < bySub[k])) map[k].periods = bySub[k];
  });

  Object.defineProperty(map, '__rawCourses', { value: rawMap, enumerable: false });
  return map;
}

function isWordGradeNineClass(classCode) {
  const info = (typeof idx !== 'undefined' && idx.classByCode && idx.classByCode[classCode]) || {};
  const grade = String(info['年級'] || '').trim();
  const className = String(info['班級名稱'] || '').trim();
  const code = String(classCode || '').trim();
  return grade === '9' || grade === '９' || grade.includes('九') || grade.includes('9') ||
    code.charAt(0) === '9' || className.includes('九年');
}

function isWordMusicClass(classCode) {
  const info = (typeof idx !== 'undefined' && idx.classByCode && idx.classByCode[classCode]) || {};
  if (String(info['班級名稱'] || '').trim().includes('音樂班')) return true;

  const gradeKey = value => {
    const raw = String(value || '').trim();
    if (raw.includes('七') || raw.includes('7')) return '7';
    if (raw.includes('八') || raw.includes('8')) return '8';
    if (raw.includes('九') || raw.includes('9')) return '9';
    return '';
  };
  const ownGrade = gradeKey(info['年級']) || gradeKey(classCode);
  if (!ownGrade || typeof idx === 'undefined' || !idx.classByCode) return false;
  const gradeClasses = Object.keys(idx.classByCode)
    .filter(code => {
      const classInfo = idx.classByCode[code] || {};
      const type = String(classInfo['班級類型'] || '').trim();
      const virtual = String(classInfo['是否虛擬班'] || '').toUpperCase() === 'TRUE' || type.includes('虛擬');
      return !virtual && (gradeKey(classInfo['年級']) || gradeKey(code)) === ownGrade;
    })
    .sort((left, right) => String(left).localeCompare(String(right), 'zh-Hant', { numeric: true }));
  return gradeClasses.length > 0 && gradeClasses[gradeClasses.length - 1] === String(classCode || '').trim();
}

function hasWordCourseData(courses, subject, classCode) {
  const data = findCourseFuzzy(courses, subject);
  if (!data) return false;

  // 班級 Word 是否保留本土語列，以實際課表為準；只有配課資料的空課程不算已開課。
  if (classCode && typeof state !== 'undefined' && Array.isArray(state.schedule)) {
    const wanted = stripSubjectNoise(normalizeSubjectKey(subject));
    return state.schedule.some(cell => {
      if (String(cell['班級代碼'] || '').trim() !== String(classCode).trim()) return false;
      const actual = String(cell['科目代碼'] || '').trim();
      return actual && stripSubjectNoise(normalizeSubjectKey(actual)) === wanted;
    });
  }

  const teachers = Array.isArray(data.teachers) ? data.teachers.filter(Boolean) : [];
  const periods = Number.parseInt(data.periods, 10) || 0;
  return periods > 0 || teachers.length > 0;
}

function wordMusicCourseSubject(courses, classCode) {
  if (!isWordMusicClass(classCode)) return '';
  return ['音樂', '視覺藝術', '表演藝術'].find(subject => hasWordCourseData(courses, subject, classCode)) || '';
}

function wordClassBilingualLessonCount(classCode, classInfo) {
  const candidates = [classInfo];
  if (typeof state !== 'undefined' && Array.isArray(state.classes)) {
    const fallback = state.classes.find(item => String(item && item['班級代碼'] || '').trim() === String(classCode || '').trim());
    if (fallback && fallback !== classInfo) candidates.push(fallback);
  }
  const keys = ['雙語課堂數', '雙語課程節數'];
  for (const candidate of candidates) {
    if (!candidate) continue;
    for (const key of keys) {
      const value = candidate[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
    }
  }
  return '';
}

function wordGradeNineNaturalScienceValues(courses) {
  const rawCourses = courses && courses.__rawCourses ? courses.__rawCourses : {};
  const findRaw = names => names
    .map(name => rawCourses[stripSubjectNoise(name)])
    .find(Boolean) || null;
  const fallback = findRaw(['自然', '生物', '理化', '地球科學']) || findCourseFuzzy(courses, '生物') || {};
  const teacherText = data => Array.isArray(data && data.teachers) ? data.teachers.join('\n') : '';
  const natural = findRaw(['自然', '生物']);
  const physics = findRaw(['理化', '物理與化學', '物理', '化學']) || fallback;
  const earth = findRaw(['地球科學', '地科']) || fallback;
  const scienceTeachers = teacherText(natural) || teacherText(physics) || teacherText(earth) || teacherText(fallback);
  return {
    physicsSubject: '理化',
    physicsPeriods: '2',
    earthSubject: '地球科學',
    earthPeriods: '1',
    scienceTeachers
  };
}

function hideWordRow(rowXml) {
  const row = String(rowXml || '');
  // 保留儲存格與邊框，只清除列內文字，避免 Word 忽略列隱藏屬性時仍顯示標籤。
  const blankRow = row.replace(/<w:t(\s[^>]*)?>[\s\S]*?<\/w:t>/g, '<w:t$1></w:t>');
  const trPr = row.match(/<w:trPr[\s\S]*?<\/w:trPr>/);
  if (trPr) {
    if (/<w:hidden\b/.test(trPr[0])) return blankRow;
    return blankRow.replace(trPr[0], trPr[0].replace('</w:trPr>', '<w:hidden/></w:trPr>'));
  }
  return blankRow.replace(/^(<w:tr[^>]*>)/, '$1<w:trPr><w:hidden/></w:trPr>');
}

function wordClearCourseCell(cellXml) {
  return wordBlankCell(cellXml)
    .replace(/<w:br(?:\s[^>]*)?\s*\/>/g, '')
    .replace(/<w:lastRenderedPageBreak\s*\/>/g, '');
}

function wordRowHeightValue(rowXml) {
  const match = String(rowXml || '').match(/<w:trHeight[^>]*w:val="(\d+)"/);
  return Math.max(1, parseInt(match?.[1] || '323', 10));
}

function wordSetRowHeight(rowXml, height) {
  const value = Math.max(1, Math.round(Number(height) || 1));
  const heightTag = '<w:trHeight w:val="' + value + '" w:hRule="atLeast"/>';
  let output = String(rowXml || '');
  if (/<w:trHeight\b[^>]*\/>/.test(output)) return output.replace(/<w:trHeight\b[^>]*\/>/, heightTag);
  if (/<w:trHeight\b[^>]*>[\s\S]*?<\/w:trHeight>/.test(output)) {
    return output.replace(/<w:trHeight\b[^>]*>[\s\S]*?<\/w:trHeight>/, heightTag);
  }
  if (/<w:trPr[\s\S]*?<\/w:trPr>/.test(output)) {
    return output.replace(/<\/w:trPr>/, heightTag + '</w:trPr>');
  }
  return output.replace(/(<w:tr(?:\s[^>]*)?>)/, '$1<w:trPr>' + heightTag + '</w:trPr>');
}

function wordRemoveRowHeight(rowXml) {
  return String(rowXml || '')
    .replace(/<w:trHeight\b[^>]*\/>/g, '')
    .replace(/<w:trHeight\b[^>]*>[\s\S]*?<\/w:trHeight>/g, '');
}

function splitGradeNineNaturalScienceRow(pageXml, classCode, values) {
  if (!isWordGradeNineClass(classCode) || !values) return pageXml;
  return String(pageXml || '').replace(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g, tableXml => {
    if (!tableXml.includes('{國文節}') || !tableXml.includes('{生物名}')) return tableXml;
    const sourceRow = wordRows(tableXml).find(row => row.includes('{生物名}') && row.includes('{生物節}') && row.includes('{生物師}'));
    if (!sourceRow) return tableXml;
    const sourceCells = wordCells(sourceRow);
    const naturalIndex = sourceCells.findIndex(cell => wordRowText(cell).includes('自然科學'));
    if (naturalIndex < 0 || naturalIndex + 3 >= sourceCells.length) return tableXml;

    const topCells = sourceCells.map((cell, index) => {
      let next = wordSetVerticalMerge(cell, 'restart');
      if (index === naturalIndex + 1) next = wordReplacePlaceholderValue(next, '生物名', values.physicsSubject);
      if (index === naturalIndex + 2) next = wordReplacePlaceholderValue(next, '生物節', values.physicsPeriods);
      if (index === naturalIndex + 3) next = wordReplacePlaceholderValue(next, '生物師', values.scienceTeachers);
      return next;
    });

    const bottomCells = sourceCells.map((cell, index) => {
      if (index === naturalIndex + 1) {
        return wordSetVerticalMerge(
          wordReplacePlaceholderValue(cell, '生物名', values.earthSubject),
          'restart'
        );
      }
      if (index === naturalIndex + 2) {
        return wordSetVerticalMerge(
          wordReplacePlaceholderValue(cell, '生物節', values.earthPeriods),
          'restart'
        );
      }
      return wordSetVerticalMerge(wordClearCourseCell(cell), 'continue');
    });

    // 自然科學拆列不設定列高，讓 Word 依理化與地球科學內容自動撐高。
    const topRow = wordRemoveRowHeight(wordRebuildRow(sourceRow, topCells));
    const bottomRow = wordRemoveRowHeight(wordRebuildRow(sourceRow, bottomCells));
    return tableXml.replace(sourceRow, topRow + bottomRow);
  });
}

function wordSetCellContent(cellXml, content) {
  const source = String(cellXml || '');
  const open = source.match(/^<w:tc(?:\s[^>]*)?>/)?.[0] || '<w:tc>';
  const tcPr = source.match(/<w:tcPr[\s\S]*?<\/w:tcPr>/)?.[0] || '<w:tcPr></w:tcPr>';
  return open + tcPr + String(content || '') + '</w:tc>';
}

function wordCellBody(cellXml) {
  const source = String(cellXml || '');
  const open = source.match(/^<w:tc(?:\s[^>]*)?>/)?.[0] || '';
  const closeIndex = source.lastIndexOf('</w:tc>');
  if (closeIndex < 0) return '<w:p/>';
  const body = source.slice(open.length, closeIndex);
  const properties = body.match(/^<w:tcPr[\s\S]*?<\/w:tcPr>/)?.[0] || '';
  const content = body.slice(properties.length).trim();
  return content || '<w:p/>';
}

function wordCourseCellsForToken(rowXml, tokenName) {
  const cells = wordCells(rowXml);
  const periodIndex = cells.findIndex(cell => cell.includes('{' + tokenName + '節}'));
  if (periodIndex <= 0 || periodIndex + 1 >= cells.length) return null;
  return {
    cells,
    indexes: [periodIndex - 1, periodIndex, periodIndex + 1]
  };
}

function wordMergeCourseRows(rows, tokenNames, combineContent, preferredToken) {
  const names = (tokenNames || []).filter(Boolean);
  if (names.length < 2) return;
  const rowIndexes = names.map(name => rows.findIndex(row => row.includes('{' + name + '節}')));
  const infos = names.map((name, index) => rowIndexes[index] >= 0 ? wordCourseCellsForToken(rows[rowIndexes[index]], name) : null);
  if (infos.some(info => !info)) return;
  const topRowIndex = rowIndexes[0];
  if (topRowIndex < 0) return;
  const topInfo = infos[0];
  const topCells = topInfo.cells;
  const preferredIndex = names.indexOf(String(preferredToken || '').trim());
  const contentInfo = preferredIndex >= 0 ? infos[preferredIndex] : topInfo;
  [0, 1, 2].forEach(offset => {
    const topIndex = topInfo.indexes[offset];
    if (combineContent) {
      topCells[topIndex] = wordSetCellContent(
        topCells[topIndex],
        wordCellBody(contentInfo.cells[contentInfo.indexes[offset]])
      );
    }
    topCells[topIndex] = wordSetVerticalMerge(topCells[topIndex], 'restart');
  });
  rows[topRowIndex] = wordRebuildRow(rows[topRowIndex], topCells);

  names.slice(1).forEach((name, offset) => {
    const rowIndex = rowIndexes[offset + 1];
    if (rowIndex < 0) return;
    const info = wordCourseCellsForToken(rows[rowIndex], name);
    if (!info) return;
    [0, 1, 2].forEach(offset => {
      const index = info.indexes[offset];
      info.cells[index] = wordSetVerticalMerge(wordClearCourseCell(info.cells[index]), 'continue');
    });
    rows[rowIndex] = wordRebuildRow(rows[rowIndex], info.cells);
  });
}

function wordSetCourseSummaryMinimumRows(rows, options = {}) {
  const preserveGradeNineScienceRows = options.preserveGradeNineScienceRows === true;
  (rows || []).forEach((row, index) => {
    const text = wordRowText(row);
    if (preserveGradeNineScienceRows && (text.includes('自然科學') || text.includes('{生物名}') || text.includes('理化') || text.includes('地球科學'))) return;
    if (/\{[^{}]*節\}/.test(row)) rows[index] = wordSetRowHeight(row, WORD_MIN_COURSE_ROW_HEIGHT);
  });
}

function wordEnsureCourseSummaryMinimumRows(pageXml, options = {}) {
  const preserveGradeNineScienceRows = options.preserveGradeNineScienceRows === true;
  return String(pageXml || '').replace(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g, tableXml => {
    const tableText = wordRowText(tableXml);
    if (!tableText.includes('領域') || !tableText.includes('科目') || !tableText.includes('授課老師')) return tableXml;
    const rows = wordRows(tableXml).map(row => {
      const text = wordRowText(row);
      if (preserveGradeNineScienceRows && (text.includes('自然科學') || text.includes('{生物名}') || text.includes('理化') || text.includes('地球科學'))) {
        return wordRemoveRowHeight(row);
      }
      return wordSetRowHeight(row, WORD_MIN_COURSE_ROW_HEIGHT);
    });
    let rowIndex = 0;
    return tableXml.replace(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g, () => rows[rowIndex++] || '');
  });
}

function applyClassCourseTemplateRules(pageXml, classCode, hasNativeLanguage, musicSubject) {
  const shouldMergeNative = isWordGradeNineClass(classCode) || !hasNativeLanguage;
  const musicClass = isWordMusicClass(classCode);
  if (!shouldMergeNative && !musicClass) return pageXml;
  return String(pageXml || '').replace(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g, tableXml => {
    if (!tableXml.includes('{國文節}') && !tableXml.includes('{音樂節}')) return tableXml;
    const rows = wordRows(tableXml);
    if (shouldMergeNative) {
      wordMergeCourseRows(rows, ['英語', '本土語'], false);
    }
    if (musicClass) wordMergeCourseRows(rows, ['音樂', '視覺藝術', '表演藝術'], true, musicSubject);
    wordSetCourseSummaryMinimumRows(rows, { preserveGradeNineScienceRows: isWordGradeNineClass(classCode) });
    let rowIndex = 0;
    return tableXml.replace(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g, () => rows[rowIndex++] || '');
  });
}

function renameWordMusicClassFlexLabel(pageXml) {
  return String(pageXml || '').replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, cell => {
    if (!cell.includes('彈性') || !cell.includes('課程')) return cell;
    return cell.replace('彈性', '專業');
  });
}

function isWordTeacherOvertimeItem(item) {
  return !!item && (
    item['超鐘點'] === true ||
    String(item['超鐘點'] || '').toUpperCase() === 'TRUE'
  );
}

function isWordOvertimeCell(cell, teacherCode) {
  if (!cell) return false;
  const code = String(teacherCode || '').trim();
  if (code && typeof getCellTeacherList === 'function') {
    const teacherList = getCellTeacherList(cell);
    const teacher = teacherList.find(item => String(item['教師姓名'] || item['姓名'] || '').trim() === code);
    if (teacher) {
      return isWordTeacherOvertimeItem(teacher) ||
        (teacherList.length === 1 && String(cell['課堂屬性'] || '').trim() === '超鐘點');
    }
  }
  return String(cell['課堂屬性'] || '').trim() === '超鐘點';
}

function teacherWordSubject(cell, teacherCode) {
  if (typeof isPatrolScheduleEntry === 'function' && isPatrolScheduleEntry(cell)) return '巡堂';
  const subject = String(cell && cell['科目代碼'] || '').trim();
  const classCode = String(cell && cell['班級代碼'] || '').trim();
  const period = parseInt(cell && cell['節次'], 10);
  const attr = String(cell && cell['課堂屬性'] || '').trim();
  const weekLabel = period === 8 && (attr === '單週' || attr === '雙週')
    ? '(' + (attr === '單週' ? '單' : '雙') + ')'
    : '';
  const virtualLabel = wordTeacherIsVirtualClass(classCode) ? classCode : '';
  return subject + weekLabel + (isWordOvertimeCell(cell, teacherCode) ? '(超)' : '') +
    (virtualLabel ? '\n' + virtualLabel : '');
}

function teacherWordSpecialSubject(cells, teacherCode) {
  const grouped = {};
  (cells || []).forEach(cell => {
    const subject = teacherWordSubject(cell, teacherCode);
    if (!subject) return;
    if (!grouped[subject]) grouped[subject] = new Set();
    const classCode = String(cell && cell['班級代碼'] || '').trim();
    if (classCode) grouped[subject].add(classCode);
  });
  return Object.keys(grouped).map(subject => {
    const classes = [...grouped[subject]];
    return classes.length ? subject + '（' + formatClassRanges(classes) + '）' : subject;
  }).join('／');
}

function formatClassRanges(classList, separator = '') {
  if (!classList || classList.length === 0) return '';
  const sorted = [...new Set(classList.map(value => String(value || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true }));
  if (sorted.length <= 1) return sorted.join('');

  const groups = [];
  let currentGroup = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = currentGroup[currentGroup.length - 1];
    const curr = sorted[i];
    const prevNum = parseInt(prev.replace(/\D/g, ''), 10);
    const currNum = parseInt(curr.replace(/\D/g, ''), 10);
    const prevPrefix = prev.replace(/\d/g, '');
    const currPrefix = curr.replace(/\d/g, '');
    if (!isNaN(prevNum) && !isNaN(currNum) && currNum === prevNum + 1 && prevPrefix === currPrefix) {
      currentGroup.push(curr);
    } else {
      groups.push(currentGroup);
      currentGroup = [curr];
    }
  }
  groups.push(currentGroup);
  return groups.map(group => group.length >= 3
    ? group[0] + '-' + group[group.length - 1]
    : group.join(separator)
  ).join(separator);
}

function formatTeacherCourseClassRanges(classList) {
  return formatClassRanges(classList, '、');
}

function formatTeacherCourseClassList(classList) {
  return [...new Set((classList || []).map(value => String(value || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true }))
    .join('、');
}

function wordTeacherIsVirtualClass(classCode) {
  const info = (typeof idx !== 'undefined' && idx.classByCode && idx.classByCode[String(classCode || '').trim()]) || {};
  return String(info['是否虛擬班'] || '').toUpperCase() === 'TRUE' || String(info['班級類型'] || '').includes('虛擬');
}

function wordClassList(value) {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'number') return String(value).match(/.{3}/g) || [];
  return String(value || '').split(/[,，、;；]/).map(item => item.trim()).filter(Boolean);
}

function wordVirtualLinkedClassCodes(cell, subjectCode) {
  const virtualCode = String(cell && cell['班級代碼'] || '').trim();
  if (!wordTeacherIsVirtualClass(virtualCode)) return [];
  const day = parseInt(cell && cell['星期'], 10);
  const period = parseInt(cell && cell['節次'], 10);
  const attr = String(cell && cell['課堂屬性'] || '').trim();
  const linked = new Set();
  const groups = (typeof state !== 'undefined' && Array.isArray(state.blockGroups) ? state.blockGroups : [])
    .filter(group => {
      const classes = wordClassList(group['班級清單']);
      const subjects = wordClassList(group['科目清單'] || group['科目代碼']);
      return classes.includes(virtualCode) && subjects.includes(String(subjectCode || '').trim());
    });
  groups.forEach(group => {
    const classes = new Set(wordClassList(group['班級清單']).filter(classCode => !wordTeacherIsVirtualClass(classCode)));
    const subjects = new Set(wordClassList(group['科目清單'] || group['科目代碼']));
    (state.schedule || []).forEach(row => {
      const classCode = String(row['班級代碼'] || '').trim();
      if (!classes.has(classCode) || wordTeacherIsVirtualClass(classCode)) return;
      if (parseInt(row['星期'], 10) !== day || parseInt(row['節次'], 10) !== period) return;
      if (period === 8 && String(row['課堂屬性'] || '').trim() !== attr) return;
      if (!subjects.has(String(row['科目代碼'] || '').trim())) return;
      linked.add(classCode);
    });
  });
  return [...linked];
}

function wordVirtualBoundClassCodes(cell, subjectCode) {
  const actual = wordVirtualLinkedClassCodes(cell, subjectCode);
  if (actual.length > 0) return actual;
  const virtualCode = String(cell && cell['班級代碼'] || '').trim();
  const wantedSubject = String(subjectCode || '').trim();
  const fallback = new Set();
  (typeof state !== 'undefined' && Array.isArray(state.blockGroups) ? state.blockGroups : [])
    .filter(group => wordClassList(group['班級清單']).includes(virtualCode) &&
      wordClassList(group['科目清單'] || group['科目代碼']).includes(wantedSubject))
    .forEach(group => wordClassList(group['班級清單']).forEach(classCode => {
      if (!wordTeacherIsVirtualClass(classCode)) fallback.add(classCode);
    }));
  return [...fallback];
}

function teacherWordClassInfoForCells(cells) {
  const codes = new Set();
  let hasVirtual = false;
  (cells || []).forEach(cell => {
    const classCode = String(cell && cell['班級代碼'] || '').trim();
    if (!classCode) return;
    if (wordTeacherIsVirtualClass(classCode)) {
      hasVirtual = true;
      wordVirtualBoundClassCodes(cell, String(cell && cell['科目代碼'] || '').trim()).forEach(code => codes.add(code));
      return;
    }
    codes.add(classCode);
  });
  return { codes: [...codes], hasVirtual };
}

function wordTeacherSummaryClassRange(classCodes, virtualLinks) {
  const virtualCodes = classCodes.filter(wordTeacherIsVirtualClass);
  if (virtualCodes.length === 0) return formatTeacherCourseClassRanges(classCodes);
  const linked = virtualCodes.flatMap(virtualCode => virtualLinks && virtualLinks.get(virtualCode)
    ? [...virtualLinks.get(virtualCode)]
    : []);
  return linked.length ? formatTeacherCourseClassRanges(linked) : '';
}

function teacherWordClassDisplayLabel(classCode) {
  const code = String(classCode || '').trim();
  const info = (typeof idx !== 'undefined' && idx.classByCode && idx.classByCode[code]) || {};
  const type = String(info['班級類型'] || '').trim();
  const isVirtual = String(info['是否虛擬班'] || '').toUpperCase() === 'TRUE' || type.includes('虛擬');
  if (!isVirtual) return code;
  const name = String(info['班級名稱'] || '').trim();
  if (!name) return code;
  const grade = String(info['年級'] || '').trim();
  return grade && !name.startsWith(grade) ? grade + '・' + name : name;
}

function teacherWordClassLabel(classList) {
  const sortedCodes = [...new Set((classList || []).map(value => String(value || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true }));
  const sorted = sortedCodes;
  return {
    text: sorted.join('、'),
    fontSize: sorted.length >= 4 ? 18 : sorted.length === 3 ? 20 : 0
  };
}

function teacherWordCellIsPatrol(cell) {
  return typeof isPatrolScheduleEntry === 'function'
    ? isPatrolScheduleEntry(cell)
    : [cell && cell['課堂屬性'], cell && cell['班級代碼'], cell && cell['科目代碼']]
      .some(value => String(value || '').trim().includes('巡堂'));
}

function isWordHelperCourseCell(cell) {
  return parseInt(cell && cell['節次'], 10) === 8 && /輔$/i.test(String(cell && cell['科目代碼'] || '').trim());
}

function isWordPreplannedCell(cell) {
  if (!cell) return false;
  if (typeof isPreplannedScheduleEntry === 'function') return isPreplannedScheduleEntry(cell);
  const classCode = String(cell['班級代碼'] || '').trim();
  const subjectCode = String(cell['科目代碼'] || '').trim();
  return !!(typeof state !== 'undefined' && Array.isArray(state.assignments) && state.assignments.some(assignment =>
    String(assignment['班級代碼'] || '').trim() === classCode &&
    String(assignment['科目代碼'] || '').trim() === subjectCode &&
    String(assignment['課程屬性'] || '').trim() === '預排'
  ));
}

function teacherWordScheduleCells(teacherCode) {
  const code = String(teacherCode || '').trim();
  if (!code) return [];

  const cells = [];
  const seenSlots = new Set();
  const slotIndex = (typeof idx !== 'undefined' && idx && idx.schedByTeacherSlot) || {};
  Object.keys(slotIndex).forEach(key => {
    if (!key.startsWith(code + '|')) return;
    (slotIndex[key] || []).forEach(cell => {
       if (!cell || teacherWordCellIsPatrol(cell) || isWordHelperCourseCell(cell)) return;
       if (isWordPreplannedCell(cell)) return;
      if (parseInt(cell['節次'], 10) === 8 || parseInt(key.split('|')[2], 10) === 8) return;
      const slotKey = key.slice(code.length + 1);
      if (seenSlots.has(slotKey)) return;
      seenSlots.add(slotKey);
      cells.push(cell);
    });
  });
  if (cells.length > 0) return cells;

  const rows = (typeof state !== 'undefined' && state && Array.isArray(state.schedule)) ? state.schedule : [];
  return rows.filter(cell => {
     if (!cell || teacherWordCellIsPatrol(cell) || isWordHelperCourseCell(cell) || isWordPreplannedCell(cell)) return false;
    if (parseInt(cell['節次'], 10) === 8) return false;
    const teacherList = typeof getCellTeacherList === 'function' ? getCellTeacherList(cell) : [];
    if (teacherList.length > 0) {
      return teacherList.some(teacher => String(teacher['教師姓名'] || teacher['姓名'] || '').trim() === code);
    }
    return String(cell['教師姓名'] || '').trim() === code;
  }).filter((cell, index, rows) => {
    const slotKey = String(cell['星期'] || '').trim() + '|' + String(cell['節次'] || '').trim();
    return !rows.slice(0, index).some(previous =>
      String(previous['星期'] || '').trim() + '|' + String(previous['節次'] || '').trim() === slotKey
    );
  });
}

function calculateTeacherOvertime(teacherCode, teacherInfo) {
  const basicHours = Number.parseFloat(String(teacherInfo && teacherInfo['基本鐘點'] || '').replace(/,/g, ''));
  if (!Number.isFinite(basicHours)) return '';
  const overtime = teacherWordScheduleCells(teacherCode).length - basicHours;
  if (overtime <= 0) return '';
  const value = Number.isInteger(overtime) ? String(overtime) : String(Number(overtime.toFixed(2)));
  return '超鐘點' + value;
}

function classWordSubjectLabel(value) {
  let subject = String(value == null ? '' : value).trim();
  if (!subject) return '';

  // 班級課表依詞組斷行，不拆開中文字，讓長科目名稱維持可讀性。
  [
    ['絃竹室內樂', '絃竹\n室內樂'],
    ['絲竹室內樂', '絲竹\n室內樂'],
    ['英悅讀樂樂', '英悅\n讀樂樂'],
    ['術科（主修）', '術科\n（主修）'],
    ['術科（副修）', '術科\n（副修）'],
    ['術科(主修)', '術科\n（主修）'],
    ['術科(副修)', '術科\n（副修）']
  ].forEach(([source, replacement]) => {
    subject = subject.split(source).join(replacement);
  });
  const lines = subject.split(/\r?\n/);
  return lines.length <= 2 ? subject : lines[0] + '\n' + lines.slice(1).join('');
}

function slotSubject(classCode, day, period) {
  if (period === 8) {
    const regular = idx.schedByClassSlot[`${classCode}|${day}|8`];
    const p8 = idx.schedByClassSlotP8[`${classCode}|${day}|8`] || {};
    const regularSubject = regular && regular['科目代碼'] ? classWordSubjectLabel(regular['科目代碼']) : '';
    const s = p8['單週'] ? classWordSubjectLabel(String(p8['單週']['科目代碼'] || '') + '(單)') : '';
    const d = p8['雙週'] ? classWordSubjectLabel(String(p8['雙週']['科目代碼'] || '') + '(雙)') : '';
    const parts = [regularSubject, s, d].filter(Boolean);
    return parts.join(' / ');
  }
  const cell = idx.schedByClassSlot[`${classCode}|${day}|${period}`];
  return cell && cell['科目代碼'] ? classWordSubjectLabel(cell['科目代碼']) : '';
}

function slotSubjectP8(classCode, day, weekType) {
  const p8 = idx.schedByClassSlotP8[`${classCode}|${day}|8`] || {};
  const cell = p8[weekType];
  return cell && cell['科目代碼'] ? classWordSubjectLabel(cell['科目代碼']) : '';
}

function joinSplitPlaceholders(xml) {
  const pairs = [
    ['{生活科', '技節}'],
    ['{生活科技', '節}'],
    ['{視覺藝', '術節}'],
    ['{雙語課堂', '數}'],
    ['{', '姓名}'],
    ['{', '減授原因}'],
    ['{', '超鐘點}']
  ];
  let out = String(xml || '');
  const tokenChar = 'A-Za-z0-9一-鿿_';
  const splitBoundary = '(</w:t></w:r>(?:(?!</w:p>|</w:tc>|</w:tr>)[^])*?<w:r[^>]*>(?:(?!</w:p>|</w:tc>|</w:tr>)[^])*?<w:t[^>]*>)';
  const splitToken = new RegExp(
    // 先逐段合併，讓「{」與內容、右大括號分在三個 Word run 時也能保留完整文字。
    '([{][' + tokenChar + ']*)(?:' + splitBoundary + ')([' + tokenChar + ']+|[}])',
    'g'
  );
  let previous;
  do {
    previous = out;
    out = out.replace(splitToken, '$1$3');
  } while (out !== previous);
  pairs.forEach(([pre, suf]) => {
    const re = new RegExp(escRegex(pre) + '(</w:t></w:r>\\s*<w:r[ >][\\s\\S]*?<w:t[^>]*>)' + escRegex(suf), 'g');
    out = out.replace(re, pre + suf);
  });
  ['減授原因', '超鐘點'].forEach(name => {
    const re = new RegExp(
      escRegex('{') +
      '(</w:t></w:r>\\s*<w:r[ >][\\s\\S]*?<w:t[^>]*>)' +
      escRegex(name) +
      '(</w:t></w:r>\\s*<w:r[ >][\\s\\S]*?<w:t[^>]*>)' +
      escRegex('}'),
      'g'
    );
    out = out.replace(re, '{' + name + '}');
  });
  return out;
}

function escRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fillPlaceholders(xml, dict) {
  let out = xml;
  Object.keys(dict)
    .sort((a, b) => b.length - a.length)
    .forEach(k => {
      const raw = String(dict[k] == null ? '' : dict[k]);
      const replaced = /\r?\n/.test(raw) ? wordReplaceRunTextPlaceholder(out, k, raw) : null;
      if (replaced !== null) {
        out = replaced;
      } else {
        out = out.split('{' + k + '}').join(escXml(raw));
      }
    });
  out = out.replace(/\{[a-zA-Z0-9\u4e00-\u9fff_]+\}/g, '');
  return out;
}

// 為課表格子注入底色：findMap 為 { 佔位符鍵: 底色HEX }；只處理有底色的格子
function injectCellFills(xml, fillMap) {
  if (!fillMap || !Object.keys(fillMap).length) return xml;
  // 找出 XML 中所有 w:tc 區段，只針對含「填色鍵」佔位符者加 w:shd
  return xml.replace(/(<w:tc\b[^>]*>)([\s\S]*?)(<\/w:tc>)/g, (whole, open, inner, close) => {
    const keys = inner.match(/\{([a-zA-Z0-9_\u4e00-\u9fff]+)\}/g);
    if (!keys) return whole;
    let fill = '';
    keys.forEach(k => {
      const key = k.slice(1, -1);
      const f = (fillMap[key] || '').trim();
      if (f) fill = f; // 終以 find 順序，取最後一個有值者
    });
    if (!fill) return whole;
    const shd = '<w:shd w:val="clear" w:color="auto" w:fill="' + fill + '"/>';
    const tcPrMatch = inner.match(/(<w:tcPr[\s\S]*?)<\/w:tcPr>/);
    if (tcPrMatch) {
      // 已有 tcPr：在其尾端後插入 shading
      const injected = inner.replace(/(<w:tcPr[\s\S]*?)(<\/w:tcPr>)/, '$1' + shd + '$2');
      return open + injected + close;
    }
    // 沒有 tcPr：在 tc 開標籤後直接插入 tcPr
    return open + '<w:tcPr>' + shd + '</w:tcPr>' + inner + close;
  });
}

function buildClassDict(classCode, yearNum, semNum) {
  const info = idx.classByCode[classCode] || {};
  const className = info['班級名稱'] || classCode;
  const homeTeacher = resolveHomeTeacher(classCode, info);
  const courses = collectClassCourses(classCode);
  const dict = {
    '年': yearNum,
    '期': semNum,
    '班級名稱': className,
    '導師': homeTeacher,
    '日期': '(日期)',
    '雙語課堂數': wordClassBilingualLessonCount(classCode, info),
    '__hasNativeLanguage': hasWordCourseData(courses, '本土語', classCode),
    '__musicSubject': wordMusicCourseSubject(courses, classCode),
    '__gradeNineNaturalScience': isWordGradeNineClass(classCode)
      ? wordGradeNineNaturalScienceValues(courses)
      : null
  };
  for (let d = 1; d <= 5; d++) {
    const earlyKey = 'd' + d + 'p0';
    const earlyCell = classWordScheduleCell(classCode, d, WORD_EARLY_PERIOD);
    dict[earlyKey] = slotSubject(classCode, d, WORD_EARLY_PERIOD);
    for (let p = 1; p <= 7; p++) {
      const key = 'd' + d + 'p' + p;
      dict[key] = slotSubject(classCode, d, p);
    }
    const lunchKey = 'd' + d + 'p45';
    dict[lunchKey] = slotSubject(classCode, d, WORD_LUNCH_PERIOD);
    // 第八節：單／雙雙欄 + 合併向後相容
    dict['d' + d + 'p8']    = slotSubject(classCode, d, 8);
    dict['d' + d + 'p8s']   = slotSubjectP8(classCode, d, '單週');
    dict['d' + d + 'p8d']   = slotSubjectP8(classCode, d, '雙週');
  }

  // 課表配色：依每格科目＋班級解析底色（班級課表）
  const fills = {};
  for (let d = 1; d <= 5; d++) {
    const earlyFill = resolveScheduleColor(classWordScheduleSubject(classCode, d, WORD_EARLY_PERIOD), classCode, d, WORD_EARLY_PERIOD) || '';
    if (earlyFill) fills['d' + d + 'p0'] = earlyFill;
    for (let p = 1; p <= 8; p++) {
      const fill = resolveScheduleColor(classWordScheduleSubject(classCode, d, p), classCode, d, p) || '';
      if (fill) fills['d' + d + 'p' + p] = fill;
    }
    const lunchFill = resolveScheduleColor(classWordScheduleSubject(classCode, d, WORD_LUNCH_PERIOD), classCode, d, WORD_LUNCH_PERIOD) || '';
    if (lunchFill) fills['d' + d + 'p45'] = lunchFill;
    const fs = resolveScheduleColor(classWordScheduleSubject(classCode, d, 8, '單週'), classCode, d, 8) || '';
    const fd = resolveScheduleColor(classWordScheduleSubject(classCode, d, 8, '雙週'), classCode, d, 8) || '';
    const p8Fill = resolveScheduleColor(classWordScheduleSubject(classCode, d, 8), classCode, d, 8) || fs || fd;
    if (p8Fill) fills['d' + d + 'p8'] = p8Fill;
    if (fs) fills['d' + d + 'p8s'] = fs;
    if (fd) fills['d' + d + 'p8d'] = fd;
  }
  dict.__fills = fills;

  FIXED_SLOT_NAMES.forEach(name => {
    let data = findCourseFuzzy(courses, name);
    if (!data && name === '生物') {
      data = findCourseFuzzy(courses, '理化') || findCourseFuzzy(courses, '自然') || findCourseFuzzy(courses, '地球科學');
    }
    dict[name + '節'] = data ? String(data.periods || '') : '';
    dict[name + '師'] = data ? (data.teachers || []).join('\n') : '';
  });
  const bio = findCourseFuzzy(courses, '生物') || findCourseFuzzy(courses, '理化') || findCourseFuzzy(courses, '自然') || findCourseFuzzy(courses, '地球科學');
  dict['生物名'] = bio ? bio.subject : '生物';

  const flexItems = collectFlexItems(courses);
  for (let i = 1; i <= 6; i++) {
    const data = flexItems[i - 1];
    dict['f' + i + '科'] = data ? data.subject : '';
    dict['f' + i + '節'] = data ? String(data.periods || '') : '';
    dict['f' + i + '師'] = data ? (data.teachers || []).join('\n') : '';
  }
  if (flexItems.length > 6) {
    console.warn('彈性超過 6 格未寫入：', flexItems.slice(6).map(x => x.subject).join('、'));
  }
  dict.__flexCount = Math.min(flexItems.length, 6);
  return dict;
}

function collectFlexItems(courses) {
  const flexItems = [];
  const seen = new Set();
  function addFlex(data) {
    if (!data || !data.subject) return;
    if (!isFlexSubject(data.subject)) return;
    const id = normalizeSubjectKey(data.subject) + '|' + (data.teachers || []).join(',');
    if (seen.has(id)) return;
    seen.add(id);
    flexItems.push(data);
  }
  FLEX_SUBJECT_ORDER.forEach(n => addFlex(findCourseFuzzy(courses, n)));
  Object.keys(courses).forEach(k => addFlex(courses[k]));
  flexItems.sort((a, b) => {
    const rank = (d) => {
      const bare = stripSubjectNoise(d.subject);
      const i = FLEX_SUBJECT_ORDER.findIndex(o => bare === o || bare.startsWith(o) || o.startsWith(bare));
      return i < 0 ? 1000 : i;
    };
    return rank(a) - rank(b) || String(a.subject).localeCompare(String(b.subject), 'zh-Hant');
  });
  return flexItems;
}

function mergeEmptyFlexRows(pageXml, flexCount) {
  const n = Math.max(0, Math.min(6, flexCount | 0));
  if (n >= 6) return pageXml;

  const tblRe = /<w:tbl[ >][\s\S]*?<\/w:tbl>/;
  const m = pageXml.match(tblRe);
  if (!m) return pageXml;
  const tbl = m[0];
  const rows = tbl.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g);
  if (!rows || rows.length < 21) return pageXml;

  const FLEX_START = 15;
  const lastFilled = n === 0 ? 14 : (FLEX_START + n - 1);
  const emptyFrom = n === 0 ? FLEX_START : (FLEX_START + n);
  const emptyTo = 20;

  function splitCells(rowXml) {
    return rowXml.match(/<w:tc[ >][\s\S]*?<\/w:tc>/g) || [];
  }
  function rebuildRow(rowXml, cells) {
    const open = rowXml.match(/^<w:tr[^>]*>/)[0];
    const trPr = (rowXml.match(/<w:trPr[\s\S]*?<\/w:trPr>/) || [''])[0];
    return open + trPr + cells.join('') + '</w:tr>';
  }
  function setVMerge(tcXml, mode) {
    let tcPr = (tcXml.match(/<w:tcPr[\s\S]*?<\/w:tcPr>/) || [null])[0];
    if (!tcPr) {
      tcPr = '<w:tcPr></w:tcPr>';
      tcXml = tcXml.replace(/^<w:tc([^>]*)>/, '<w:tc$1>' + tcPr);
    }
    tcPr = tcPr.replace(/<w:vMerge[^/]*\/>/g, '').replace(/<w:vMerge[\s\S]*?<\/w:vMerge>/g, '');
    if (mode === 'restart') {
      tcPr = tcPr.replace(/<\/w:tcPr>/, '<w:vMerge w:val="restart"/></w:tcPr>');
    } else if (mode === 'continue') {
      tcPr = tcPr.replace(/<\/w:tcPr>/, '<w:vMerge/></w:tcPr>');
    }
    if (/<w:tcPr[\s\S]*?<\/w:tcPr>/.test(tcXml)) {
      return tcXml.replace(/<w:tcPr[\s\S]*?<\/w:tcPr>/, tcPr);
    }
    return tcXml.replace(/^<w:tc([^>]*)>/, '<w:tc$1>' + tcPr);
  }
  function flexCellIdxs(cells) {
    if (cells.length >= 12) return [9, 10, 11];
    if (cells.length >= 11) return [9, 10];
    if (cells.length >= 10) return [9];
    return [];
  }

  const newRows = rows.slice();
  {
    const cells = splitCells(newRows[lastFilled]);
    const idxs = flexCellIdxs(cells);
    idxs.forEach(i => {
      if (cells[i]) cells[i] = setVMerge(cells[i], 'restart');
    });
    newRows[lastFilled] = rebuildRow(newRows[lastFilled], cells);
  }
  for (let ri = emptyFrom; ri <= emptyTo; ri++) {
    const cells = splitCells(newRows[ri]);
    const idxs = flexCellIdxs(cells);
    idxs.forEach(i => {
      if (!cells[i]) return;
      let c = setVMerge(cells[i], 'continue');
      c = c.replace(/<w:t(\s[^>]*)?>[^<]*<\/w:t>/g, '<w:t$1></w:t>');
      cells[i] = c;
    });
    newRows[ri] = rebuildRow(newRows[ri], cells);
  }

  const open = tbl.match(/^<w:tbl[^>]*>/)[0];
  const tblPr = (tbl.match(/<w:tblPr[\s\S]*?<\/w:tblPr>/) || [''])[0];
  const tblGrid = (tbl.match(/<w:tblGrid[\s\S]*?<\/w:tblGrid>/) || [''])[0];
  const newTbl = open + tblPr + tblGrid + newRows.join('') + '</w:tbl>';
  return pageXml.replace(tblRe, newTbl);
}

async function loadTemplate() {
  if (_tplCache) return _tplCache;
  const resp = await fetch('class-official-template.docx?t=' + Date.now());
  if (!resp.ok) throw new Error('無法載入模板 HTTP ' + resp.status);
  const buf = await resp.arrayBuffer();
  const zip = parseDocxZip(buf);
  const docXml = zip.file('word/document.xml').asText();
  const bodyMatch = docXml.match(/<w:body[^>]*>([\s\S]*)<\/w:body>/);
  if (!bodyMatch) throw new Error('模板缺少 w:body');
  let bodyInner = bodyMatch[1];
  const sectPr = (bodyInner.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/) || [''])[0];
  bodyInner = bodyInner.replace(/<w:sectPr[\s\S]*?<\/w:sectPr>\s*$/, '');
  bodyInner = bodyInner.replace(/(<w:p[ >][\s\S]*?<\/w:p>)\s*$/, (m) => {
    const txt = m.replace(/<[^>]+>/g, '').trim();
    return (txt || /w:br/.test(m)) ? m : '';
  });
  bodyInner = bodyInner.replace(/<w:lastRenderedPageBreak\s*\/>/g, '');
  bodyInner = joinSplitPlaceholders(bodyInner);
  const nextPageSectPr = sectPr
    ? sectPr.replace('</w:sectPr>', '<w:type w:val="nextPage"/></w:sectPr>')
    : '';

  _tplCache = { buf, docXml, bodyInner, sectPr, nextPageSectPr };
  return _tplCache;
}

async function loadTeacherTemplate() {
  if (_teacherTplCache) return _teacherTplCache;
  const resp = await fetch('teacher-official-template.docx?t=' + Date.now());
  if (!resp.ok) throw new Error('無法載入教師模板 HTTP ' + resp.status);
  const buf = await resp.arrayBuffer();
  const zip = parseDocxZip(buf);
  const docXml = zip.file('word/document.xml').asText();
  const bodyMatch = docXml.match(/<w:body[^>]*>([\s\S]*)<\/w:body>/);
  if (!bodyMatch) throw new Error('教師模板缺少 w:body');
  let bodyInner = bodyMatch[1];
  const sectPr = (bodyInner.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/) || [''])[0];
  bodyInner = bodyInner.replace(/<w:sectPr[\s\S]*?<\/w:sectPr>\s*$/, '');
  bodyInner = bodyInner.replace(/(<w:p[ >][\s\S]*?<\/w:p>)\s*$/, (m) => {
    const txt = m.replace(/<[^>]+>/g, '').trim();
    return (txt || /w:br/.test(m)) ? m : '';
  });
  bodyInner = bodyInner.replace(/<w:lastRenderedPageBreak\s*\/>/g, '');
  bodyInner = joinSplitPlaceholders(bodyInner);
  const nextPageSectPr = sectPr
    ? sectPr.replace('</w:sectPr>', '<w:type w:val="nextPage"/></w:sectPr>')
    : '';

  _teacherTplCache = { buf, docXml, bodyInner, sectPr, nextPageSectPr };
  return _teacherTplCache;
}

function injectPageBreakAtStart(pageXml) {
  let out = pageXml;
  out = out.replace(/(<w:spacing[^>]*?)\s+w:before="\d+"/, '$1 w:before="0"');
  out = out.replace('</w:pPr>', '</w:pPr><w:r><w:br w:type="page"/></w:r>');
  return out;
}

function buildClassPageXml(tpl, classCode, yearNum, semNum, leadPageBreak) {
  const dict = buildClassDict(classCode, yearNum, semNum);
  const flexCount = dict.__flexCount || 0;
  delete dict.__flexCount;
  const fills = dict.__fills || null;
  const hasNativeLanguage = dict.__hasNativeLanguage === true;
  const musicSubject = String(dict.__musicSubject || '').trim();
  const gradeNineNaturalScience = dict.__gradeNineNaturalScience || null;
  delete dict.__fills;
  delete dict.__hasNativeLanguage;
  delete dict.__musicSubject;
  delete dict.__gradeNineNaturalScience;
  let page = expandWordSpecialRows(tpl.bodyInner, dict, 'class');
  page = splitClassP8Row(page, classCode);
  page = applyClassCourseTemplateRules(page, classCode, hasNativeLanguage, musicSubject);
  page = splitGradeNineNaturalScienceRow(page, classCode, gradeNineNaturalScience);
  page = fills ? injectCellFills(page, fills) : page;
  page = fillPlaceholders(page, dict);
  if (isWordMusicClass(classCode)) page = renameWordMusicClassFlexLabel(page);
  page = wordLockTableColumns(page);
  page = wordEnsureCourseSummaryMinimumRows(page, {
    preserveGradeNineScienceRows: Boolean(gradeNineNaturalScience)
  });
  if (leadPageBreak) page = injectPageBreakAtStart(page);
  return page;
}

function normalizeWordNativeLanguageTag(value) {
  const raw = String(value || '').trim();
  const aliases = {
    '台語': '台',
    '臺語': '台',
    '閩南語': '台',
    '客語': '客',
    '族語': '原',
    '原住民族語': '原'
  };
  return aliases[raw] || raw;
}

function wordNativeLanguageTag(cell, teacherCode) {
  const subject = String(cell && cell['科目代碼'] || '').trim();
  const subjectKey = normalizeSubjectKey(subject);
  if (subjectKey !== '本土語' && subject !== '本土語文') return '';

  const code = String(teacherCode || '').trim();
  const lists = [];
  if (typeof getCellTeacherList === 'function') lists.push(getCellTeacherList(cell));

  const classCode = String(cell && cell['班級代碼'] || '').trim();
  const assignments = typeof state !== 'undefined' && state && Array.isArray(state.assignments)
    ? state.assignments
    : [];
  const assignment = assignments.find(item =>
    String(item && item['班級代碼'] || '').trim() === classCode &&
    String(item && item['科目代碼'] || '').trim() === subject
  );
  if (assignment && typeof getCellTeacherList === 'function') lists.push(getCellTeacherList(assignment));

  for (const list of lists) {
    const teacher = (Array.isArray(list) ? list : []).find(item =>
      String(item && (item['教師姓名'] || item['姓名']) || '').trim() === code
    );
    const tag = normalizeWordNativeLanguageTag(teacher && (teacher['語種'] || teacher['標籤']));
    if (tag && !['主', '協同', '主教師', '協同教師'].includes(tag)) return tag;
  }
  return '';
}

function wordTeacherCourseSubject(subjectCode, languageTag, hasOvertime) {
  const subject = String(subjectCode || '').trim();
  const native = normalizeSubjectKey(subject) === '本土語' || subject === '本土語文';
  const label = native && languageTag ? subject + '(' + languageTag + ')' : subject;
  return label + (hasOvertime ? '(超)' : '');
}

function wordTeacherSubjectBase(value) {
  return String(value || '').trim()
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\([^)]*\)/g, '')
    .replace(/輔$/i, '')
    .trim();
}

function collectTeacherCourseSummary(teacherCode) {
  const groups = new Map();
  const targetCode = String(teacherCode || '').trim();
  const combinedSlotClasses = new Map();

  (state.schedule || []).forEach(s => {
    const tList = getCellTeacherList(s);
    const teacherIndex = tList.findIndex(t => String(t['教師姓名'] || t['姓名'] || '').trim() === targetCode);
    if (teacherIndex < 0 || isWordHelperCourseCell(s)) return;
    const sub = String(s['科目代碼'] || '').trim();
    const clsCode = String(s['班級代碼'] || '').trim();
    if (!sub || !clsCode) return;
    const teacherItem = tList[teacherIndex] || {};
    const teacherTag = String(teacherItem['標籤'] || '').trim();
    const role = teacherIndex > 0 || ['協同', '協同教師'].includes(teacherTag) ? 'co' : 'main';
    const languageTag = wordNativeLanguageTag(s, targetCode);
    const slotKey = [String(s['星期'] || '').trim(), String(s['節次'] || '').trim(), String(s['課堂屬性'] || '').trim()].join('\u0001');
    const key = [role, sub, languageTag, slotKey].join('\u0001');
    if (!combinedSlotClasses.has(key)) combinedSlotClasses.set(key, new Set());
    if (!wordTeacherIsVirtualClass(clsCode)) combinedSlotClasses.get(key).add(clsCode);
  });

  (state.schedule || []).forEach(s => {
    // 多師格「教師代碼」為 JSON 字串，需以 getCellTeacherList 解析後比對教師
    const tList = getCellTeacherList(s);
    const teacherIndex = tList.findIndex(t => String(t['教師姓名'] || t['姓名'] || '').trim() === targetCode);
    if (teacherIndex < 0) return;
    if (isWordHelperCourseCell(s)) return;
    const sub = String(s['科目代碼'] || '').trim();
    const clsCode = String(s['班級代碼'] || '').trim();
    if (!sub || !clsCode) return;

    const teacherItem = tList[teacherIndex] || {};
    const teacherTag = String(teacherItem['標籤'] || '').trim();
    const isCoTeacher = teacherIndex > 0 || ['協同', '協同教師'].includes(teacherTag);
    const role = isCoTeacher ? 'co' : 'main';
    const languageTag = wordNativeLanguageTag(s, targetCode);
    const period = parseInt(s['節次'], 10);
    const attr = String(s['課堂屬性'] || '').trim();
    const weeklyUnits = period === 8 && (attr === '單週' || attr === '雙週') ? 0.5 : 1;
    const slotKey = [String(s['星期'] || '').trim(), String(s['節次'] || '').trim(), attr].join('\u0001');
    const combinedKey = [role, sub, languageTag, slotKey].join('\u0001');
    const isCombined = (combinedSlotClasses.get(combinedKey)?.size || 0) > 1;
    const groupKey = role === 'co' || isCombined
      ? [role, sub, languageTag, slotKey].join('\u0001')
      : [role, sub, languageTag].join('\u0001');
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        role,
        subjectCode: sub,
        languageTag,
        isCombined,
        classes: new Set(),
        slots: new Map(),
        classSlots: new Map(),
        virtualLinks: new Map(),
        hasOvertime: false,
        hasPreplanned: false,
        classOvertime: new Map(),
        classPreplanned: new Map()
      });
    }
    const group = groups.get(groupKey);
    group.classes.add(clsCode);
    if (!group.slots.has(slotKey)) group.slots.set(slotKey, weeklyUnits);
    if (!group.classSlots.has(clsCode)) group.classSlots.set(clsCode, new Map());
    group.classSlots.get(clsCode).set(slotKey, weeklyUnits);
    if (wordTeacherIsVirtualClass(clsCode)) {
      const links = wordVirtualLinkedClassCodes(s, sub);
      if (!group.virtualLinks.has(clsCode)) group.virtualLinks.set(clsCode, new Set());
      links.forEach(linkedCode => group.virtualLinks.get(clsCode).add(linkedCode));
    }
    if (isWordOvertimeCell(s, targetCode)) {
      group.hasOvertime = true;
      group.classOvertime.set(clsCode, true);
    }
    if (isWordPreplannedCell(s)) {
      group.hasPreplanned = true;
      group.classPreplanned.set(clsCode, true);
    }
  });

  const gradeOf = classCode => {
    const info = (typeof idx !== 'undefined' && idx.classByCode && idx.classByCode[classCode]) || {};
    const raw = String(info['年級'] || '').trim();
    const parsed = parseInt(raw.replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(parsed) ? parsed : (parseInt(String(classCode || '').charAt(0), 10) || 0);
  };
  const formatSummaryHours = (periodCount, classCount) => {
    const value = String(Number(periodCount.toFixed(2)));
    return classCount > 1 ? '各' + value : value;
  };
  const combinedSummaryList = [];
  const classRecords = new Map();
  groups.forEach(group => {
    if (group.isCombined) {
      const classes = [...group.classes];
      const displayClasses = new Set(classes.filter(classCode => !wordTeacherIsVirtualClass(classCode)));
      classes.filter(wordTeacherIsVirtualClass).forEach(virtualCode => {
        (group.virtualLinks.get(virtualCode) || []).forEach(linkedCode => displayClasses.add(linkedCode));
      });
      const visibleClasses = displayClasses.size > 0 ? [...displayClasses] : classes;
      const periodCount = [...group.slots.values()].reduce((total, units) => total + units, 0);
      const virtualLabels = classes.filter(wordTeacherIsVirtualClass).map(teacherWordClassDisplayLabel);
      combinedSummaryList.push({
        subject: wordTeacherCourseSubject(group.subjectCode, group.languageTag, false) +
          (virtualLabels.length ? '\n' + [...new Set(virtualLabels)].join('、') : ''),
        subjectCode: group.subjectCode,
        languageTag: group.languageTag,
        classRange: formatTeacherCourseClassList(visibleClasses),
        hours: formatSummaryHours(periodCount, 1),
        periodCount,
        classCount: visibleClasses.length,
        grade: visibleClasses.length ? Math.min(...visibleClasses.map(gradeOf)) : 0,
        preplanned: group.hasPreplanned,
        hasOvertime: group.hasOvertime,
        role: group.role,
        combined: true
      });
      return;
    }
    group.classSlots.forEach((slots, classCode) => {
      const recordKey = [group.role, group.subjectCode, group.languageTag, classCode].join('\u0001');
      if (!classRecords.has(recordKey)) {
        classRecords.set(recordKey, {
          role: group.role,
          subjectCode: group.subjectCode,
          languageTag: group.languageTag,
          classCode,
          slots: new Map(),
          virtualLinks: new Set(),
          hasOvertime: false,
          preplanned: false
        });
      }
      const record = classRecords.get(recordKey);
      slots.forEach((units, slotKey) => {
        record.slots.set(slotKey, Math.max(record.slots.get(slotKey) || 0, units));
      });
      (group.virtualLinks.get(classCode) || []).forEach(linkedCode => record.virtualLinks.add(linkedCode));
      record.hasOvertime = record.hasOvertime || group.classOvertime.has(classCode);
      record.preplanned = record.preplanned || group.classPreplanned.has(classCode);
    });
  });

  const summaryGroups = new Map();
  classRecords.forEach(record => {
    const periodCount = [...record.slots.values()].reduce((total, units) => total + units, 0);
    const bucket = wordTeacherIsVirtualClass(record.classCode)
      ? 'virtual|' + record.classCode
      : 'grade|' + gradeOf(record.classCode) + '|hours|' + periodCount.toFixed(2) + '|preplanned|' + record.preplanned;
    const key = [record.role, record.subjectCode, record.languageTag, bucket].join('\u0001');
    if (!summaryGroups.has(key)) {
      summaryGroups.set(key, {
        role: record.role,
        subjectCode: record.subjectCode,
        languageTag: record.languageTag,
        classes: new Set(),
        periodCount,
        virtualLinks: new Map(),
        hasOvertime: record.hasOvertime,
        preplanned: record.preplanned,
        grade: gradeOf(record.classCode)
      });
    }
    const summary = summaryGroups.get(key);
    summary.classes.add(record.classCode);
    record.virtualLinks.forEach(linkedCode => {
      if (!summary.virtualLinks.has(record.classCode)) summary.virtualLinks.set(record.classCode, new Set());
      summary.virtualLinks.get(record.classCode).add(linkedCode);
    });
  });

  const summaryList = [...combinedSummaryList, ...[...summaryGroups.values()].map(group => {
    const classes = [...group.classes].sort((a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true }));
    const virtualLabels = classes.filter(wordTeacherIsVirtualClass).map(teacherWordClassDisplayLabel);
    return {
      subject: wordTeacherCourseSubject(group.subjectCode, group.languageTag, false) +
        (virtualLabels.length ? '\n' + [...new Set(virtualLabels)].join('、') : ''),
      subjectCode: group.subjectCode,
      languageTag: group.languageTag,
      classRange: wordTeacherSummaryClassRange(classes, group.virtualLinks),
      hours: formatSummaryHours(group.periodCount, classes.length),
      periodCount: group.periodCount,
      classCount: classes.length,
      grade: group.grade,
      preplanned: group.preplanned,
      hasOvertime: group.hasOvertime,
      role: group.role,
      combined: false
    };
  })];

  const teacherInfo = (typeof idx !== 'undefined' && idx.teacherByCode && idx.teacherByCode[targetCode]) ||
    (state.teachers || []).find(teacher => String(teacher['教師姓名'] || teacher['姓名'] || '').trim() === targetCode) || {};
  const professionalSubjects = new Set(String(teacherInfo['任教科目'] || '')
    .split(/[,，、;；/|]+/)
    .map(wordTeacherSubjectBase)
    .filter(Boolean));
  const courseClassCounts = new Map();
  const courseKey = item => [wordTeacherSubjectBase(item.subjectCode), item.languageTag || ''].join('\u0001');
  summaryList.forEach(item => {
    const key = courseKey(item);
    courseClassCounts.set(key, (courseClassCounts.get(key) || 0) + item.classCount);
  });

  // 先排教師專業科目，再排實際授課班級較多的科目；同科目再維持年級與節數分列。
  summaryList.sort((a, b) => {
    const aProfessional = professionalSubjects.has(wordTeacherSubjectBase(a.subjectCode || a.subject));
    const bProfessional = professionalSubjects.has(wordTeacherSubjectBase(b.subjectCode || b.subject));
    if (aProfessional !== bProfessional) return aProfessional ? -1 : 1;
    const classCountOrder = (courseClassCounts.get(courseKey(b)) || 0) - (courseClassCounts.get(courseKey(a)) || 0);
    if (classCountOrder) return classCountOrder;
    const aIsBuding = isBudingSubject(a.subjectCode || a.subject);
    const bIsBuding = isBudingSubject(b.subjectCode || b.subject);
    if (aIsBuding !== bIsBuding) {
      return aIsBuding ? -1 : 1;
    }
    return String(a.subjectCode || a.subject).localeCompare(String(b.subjectCode || b.subject), 'zh-Hant') ||
      String(a.languageTag || '').localeCompare(String(b.languageTag || ''), 'zh-Hant') ||
      a.grade - b.grade ||
      b.periodCount - a.periodCount ||
      String(a.classRange).localeCompare(String(b.classRange), 'zh-Hant', { numeric: true });
  });

  return summaryList;
}

function buildTeacherDict(teacherCode, yearNum, semNum) {
  const tInfo = idx.teacherByCode[teacherCode] || {};
  const name = tInfo['姓名'] || teacherCode;
  const dict = {
    '年': yearNum,
    '期': semNum === '1' ? '一' : (semNum === '2' ? '二' : semNum),
    '姓名': name,
    '日期': '(日期)',
    '減授原因': String(tInfo['減授原因'] || '').trim(),
    '超鐘點': calculateTeacherOvertime(teacherCode, tInfo)
  };
  const classFontSizes = {};
  const preplannedKeys = [];
  const markPreplanned = (key, cells) => {
    if ((cells || []).some(isWordPreplannedCell)) preplannedKeys.push(key);
  };
  const setClassCell = (key, classCodes) => {
    const label = teacherWordClassLabel(classCodes);
    dict[key] = label.text;
    if (label.fontSize) classFontSizes[key] = label.fontSize;
  };
  const setClassCellForCells = (key, cells) => {
    const classInfo = teacherWordClassInfoForCells(cells);
    setClassCell(key, classInfo.codes);
  };

  // 課表 grid (Table 0)；同節跨班（協同/合班上課）時合併顯示所有班級
  for (let d = 1; d <= 5; d++) {
    const earlyCells = idx.schedByTeacherSlot[teacherCode + '|' + d + '|' + WORD_EARLY_PERIOD] || [];
    dict[`d${d}p0_s`] = teacherWordSpecialSubject(earlyCells, teacherCode);
    setClassCellForCells(`d${d}p0_c`, earlyCells);
    markPreplanned(`d${d}p0_s`, earlyCells);
    markPreplanned(`d${d}p0_c`, earlyCells);
    for (let p = 1; p <= 8; p++) {
      const tk = teacherCode + '|' + d + '|' + p;
      const cells = idx.schedByTeacherSlot[tk] || [];
      if (cells.length > 0) {
        const subLabels = [...new Set(cells.map(c => teacherWordSubject(c, teacherCode)).filter(Boolean))];
        dict[`d${d}p${p}_s`] = subLabels.join(' / ');
        setClassCellForCells(`d${d}p${p}_c`, cells);
        markPreplanned(`d${d}p${p}_s`, cells);
        markPreplanned(`d${d}p${p}_c`, cells);
      } else {
        dict[`d${d}p${p}_s`] = '';
        dict[`d${d}p${p}_c`] = '';
      }
      if (p === 8) {
        const subjectWeeks = teacherP8WeekValues(teacherCode, d, 's');
        const singleWeekCells = teacherP8WeekCells(teacherCode, d, '單週');
        const doubleWeekCells = teacherP8WeekCells(teacherCode, d, '雙週');
        dict[`d${d}p8_s_single`] = subjectWeeks[0];
        dict[`d${d}p8_s_double`] = subjectWeeks[1];
        setClassCellForCells(`d${d}p8_c_single`, singleWeekCells);
        setClassCellForCells(`d${d}p8_c_double`, doubleWeekCells);
        markPreplanned(`d${d}p8_s_single`, singleWeekCells);
        markPreplanned(`d${d}p8_s_double`, doubleWeekCells);
        markPreplanned(`d${d}p8_c_single`, singleWeekCells);
        markPreplanned(`d${d}p8_c_double`, doubleWeekCells);
        if (singleWeekCells.length > 0 && doubleWeekCells.length > 0) delete classFontSizes[`d${d}p8_c`];
      }
    }
    const lunchCells = idx.schedByTeacherSlot[teacherCode + '|' + d + '|' + WORD_LUNCH_PERIOD] || [];
    dict[`d${d}p45_s`] = teacherWordSpecialSubject(lunchCells, teacherCode);
    setClassCellForCells(`d${d}p45_c`, lunchCells);
    markPreplanned(`d${d}p45_s`, lunchCells);
    markPreplanned(`d${d}p45_c`, lunchCells);
  }

  // 配課總表 (Table 1)
  const summaries = collectTeacherCourseSummary(teacherCode);
  for (let i = 1; i <= 6; i++) {
    const rowIdx = Math.ceil(i / 2);
    const colSide = (i % 2 === 1) ? 1 : 2;
    const item = summaries[i - 1];

    dict[`t${rowIdx}_s${colSide}`] = item ? item.subject : '';
    dict[`t${rowIdx}_c${colSide}`] = item ? item.classRange : '';
    dict[`t${rowIdx}_h${colSide}`] = item ? item.hours : '';
    if (item && item.preplanned) {
      preplannedKeys.push(`t${rowIdx}_s${colSide}`, `t${rowIdx}_c${colSide}`, `t${rowIdx}_h${colSide}`);
    }
  }
  dict.__classFontSizes = classFontSizes;
  dict.__preplannedKeys = preplannedKeys;

  // 課表配色：教師課表格以該格科目為主（多班取首班判斷班級規則）；同格班列一起上色
  const fills = {};
  for (let d = 1; d <= 5; d++) {
    const earlyCells = idx.schedByTeacherSlot[teacherCode + '|' + d + '|' + WORD_EARLY_PERIOD] || [];
    if (earlyCells.length > 0) {
      const fill = resolveScheduleColor(String(earlyCells[0]['科目代碼'] || '').trim(), String(earlyCells[0]['班級代碼'] || '').trim(), d, WORD_EARLY_PERIOD) || '';
      if (fill) {
        fills[`d${d}p0_s`] = fill;
        fills[`d${d}p0_c`] = fill;
      }
    }
    for (let p = 1; p <= 8; p++) {
      const tk = teacherCode + '|' + d + '|' + p;
      const cells = idx.schedByTeacherSlot[tk] || [];
      if (cells.length === 0) continue;
      const sub = String(cells[0]['科目代碼'] || '').trim();
      const cls = String(cells[0]['班級代碼'] || '').trim();
      const fill = resolveScheduleColor(sub, cls, d, p) || '';
      if (fill) {
        fills[`d${d}p${p}_s`] = fill;
        fills[`d${d}p${p}_c`] = fill;
      }
    }
    const p8Cells = idx.schedByTeacherSlot[teacherCode + '|' + d + '|8'] || [];
    ['單週', '雙週'].forEach((weekType, index) => {
      const weekCell = p8Cells.find(cell => String(cell && cell['課堂屬性'] || '').trim() === weekType);
      if (!weekCell) return;
      const fill = resolveScheduleColor(String(weekCell['科目代碼'] || '').trim(), String(weekCell['班級代碼'] || '').trim(), d, 8) || '';
      if (!fill) return;
      const weekKey = index === 0 ? 'single' : 'double';
      fills[`d${d}p8_s_${weekKey}`] = fill;
      fills[`d${d}p8_c_${weekKey}`] = fill;
    });
    const lunchCells = idx.schedByTeacherSlot[teacherCode + '|' + d + '|' + WORD_LUNCH_PERIOD] || [];
    if (lunchCells.length > 0) {
      const fill = resolveScheduleColor(String(lunchCells[0]['科目代碼'] || '').trim(), String(lunchCells[0]['班級代碼'] || '').trim(), d, WORD_LUNCH_PERIOD) || '';
      if (fill) {
        fills[`d${d}p45_s`] = fill;
        fills[`d${d}p45_c`] = fill;
      }
    }
  }
  dict.__fills = fills;

  return dict;
}

function buildTeacherPageXml(tpl, teacherCode, yearNum, semNum, leadPageBreak) {
  const dict = buildTeacherDict(teacherCode, yearNum, semNum);
  let page = expandWordSpecialRows(tpl.bodyInner, dict, 'teacher');
  page = splitTeacherP8Rows(page, teacherCode);
  // 除了第八節必要的單／雙週拆欄，其餘內容只直接替換範本文字。
  page = fillPlaceholders(page, dict);
  if (leadPageBreak) page = injectPageBreakAtStart(page);
  return page;
}

function buildPatrolRoomDict(yearNum, semNum) {
  const dayNames = ['', '週一', '週二', '週三', '週四', '週五'];
  const patrolRows = (state.schedule || [])
    .filter(isPatrolScheduleEntry)
    .sort((a, b) => parseInt(a['星期'], 10) - parseInt(b['星期'], 10) ||
      parseInt(a['節次'], 10) - parseInt(b['節次'], 10) ||
      String(a['教師姓名'] || '').localeCompare(String(b['教師姓名'] || ''), 'zh-Hant'));
  const dict = {
    '年': yearNum,
    '期': semNum === '1' ? '一' : (semNum === '2' ? '二' : semNum),
    '教室': '全校巡堂'
  };
  for (let day = 1; day <= 5; day++) {
    for (let period = 1; period <= 8; period++) {
      const rows = patrolRows.filter(row => parseInt(row['星期'], 10) === day && parseInt(row['節次'], 10) === period);
      const teachers = rows.map(row => teacherName(String(row['教師姓名'] || '').trim())).filter(Boolean);
      dict[`d${day}p${period}_s`] = teachers.length ? '巡堂' : '';
      dict[`d${day}p${period}_c`] = teachers.join('／');
    }
  }
  patrolRows.slice(0, 12).forEach((row, index) => {
    const rowIndex = Math.ceil((index + 1) / 2);
    const side = ((index + 1) % 2 === 1) ? 1 : 2;
    const code = String(row['教師姓名'] || '').trim();
    dict[`t${rowIndex}_s${side}`] = '巡堂';
    dict[`t${rowIndex}_c${side}`] = (dayNames[parseInt(row['星期'], 10)] || '星期' + row['星期']) + '第' + row['節次'] + '節';
    dict[`t${rowIndex}_h${side}`] = teacherName(code);
  });
  return dict;
}

function buildPatrolRoomPageXml(tpl, yearNum, semNum) {
  const filled = fillPlaceholders(tpl.bodyInner, buildPatrolRoomDict(yearNum, semNum));
  const tableStarts = [...filled.matchAll(/<w:tbl(?:\s[^>]*)?>/g)].map(match => match.index);
  let output = filled;
  if (tableStarts.length) {
    const start = tableStarts[tableStarts.length - 1];
    const end = output.indexOf('</w:tbl>', start);
    if (end >= 0) output = output.slice(0, start) + output.slice(end + '</w:tbl>'.length);
  }
  const heading = '任課班級、科目與教師';
  const headingIndex = output.indexOf(heading);
  if (headingIndex >= 0) {
    const paragraphStarts = [...output.matchAll(/<w:p(?:\s[^>]*)?>/g)]
      .map(match => match.index)
      .filter(index => index < headingIndex);
    const paragraphStart = paragraphStarts[paragraphStarts.length - 1];
    const paragraphEnd = output.indexOf('</w:p>', headingIndex);
    if (paragraphStart !== undefined && paragraphEnd >= 0) {
      output = output.slice(0, paragraphStart) + output.slice(paragraphEnd + '</w:p>'.length);
    }
  }
  return output;
}

function xlsxXmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function xlsxReplaceSharedStringPlaceholders(sharedStringsXml, yearNum, semNum) {
  const semester = semNum === '1' ? '一' : (semNum === '2' ? '二' : String(semNum || ''));
  return String(sharedStringsXml || '').replace(/<t(\s[^>]*)?>([\s\S]*?)<\/t>/g, (whole, attrs, text) => {
    if (!text.includes('{學年}') && !text.includes('{學期}')) return whole;
    const next = text
      .replace(/\{學年\}/g, xlsxXmlEscape(yearNum))
      .replace(/\{學期\}/g, xlsxXmlEscape(semester));
    return '<t' + (attrs || '') + '>' + next + '</t>';
  });
}

function xlsxSetInlineString(sheetXml, cellRef, value) {
  const escapedRef = String(cellRef || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(<c\\b[^>]*\\br="' + escapedRef + '"[^>]*)(?:/>|>[\\s\\S]*?<\\/c>)');
  return String(sheetXml || '').replace(re, (whole, open) => {
    const attrs = open.replace(/\s+t="[^"]*"/g, '');
    return attrs + ' t="inlineStr"><is><t>' + xlsxXmlEscape(value) + '</t></is></c>';
  });
}

function buildPatrolExcelSheetXml(sheetXml, sharedStringsXml, yearNum, semNum) {
  let outputSheet = String(sheetXml || '');
  const patrolRows = (state.schedule || [])
    .filter(isPatrolScheduleEntry)
    .filter(row => {
      const day = parseInt(row['星期'], 10);
      const period = parseInt(row['節次'], 10);
      return day >= 1 && day <= 5 && period >= 1 && period <= 7;
    });

  for (let period = 1; period <= 7; period++) {
    const rowNumber = 5 + (period - 1) * 3;
    for (let day = 1; day <= 5; day++) {
      const names = patrolRows
        .filter(row => parseInt(row['星期'], 10) === day && parseInt(row['節次'], 10) === period)
        .map(row => teacherTitle(String(row['教師姓名'] || '').trim()))
        .filter(Boolean);
      const column = String.fromCharCode('D'.charCodeAt(0) + day - 1);
      outputSheet = xlsxSetInlineString(outputSheet, column + rowNumber, [...new Set(names)].join('／'));
    }
  }

  return {
    sheetXml: outputSheet,
    sharedStringsXml: xlsxReplaceSharedStringPlaceholders(sharedStringsXml, yearNum, semNum)
  };
}

async function loadPatrolExcelTemplate() {
  if (_patrolExcelTplCache) return _patrolExcelTplCache;
  const resp = await fetch('walkthrough-template.xlsx?t=' + Date.now());
  if (!resp.ok) throw new Error('無法載入巡堂 Excel 範本 HTTP ' + resp.status);
  const buf = await resp.arrayBuffer();
  const zip = parseDocxZip(buf);
  if (!zip.file('xl/worksheets/sheet1.xml')) throw new Error('巡堂 Excel 範本缺少第一工作表');
  if (!zip.file('xl/sharedStrings.xml')) throw new Error('巡堂 Excel 範本缺少文字資源');
  _patrolExcelTplCache = { buf };
  return _patrolExcelTplCache;
}

async function startPatrolWordExport() {
  const patrolRows = (state.schedule || []).filter(isPatrolScheduleEntry);
  const unsupportedRows = patrolRows.filter(row => {
    const period = parseInt(row['節次'], 10);
    return period < 1 || period > 7;
  });
  if (unsupportedRows.length > 0) {
    toast('walkthrough-template.xlsx 目前只有第 1 至第 7 節，尚有 ' + unsupportedRows.length + ' 筆巡堂資料無法放入，請先處理第 8 節巡堂。', 'warning');
    return;
  }
  const patrolCount = patrolRows.length;
  if (patrolCount === 0) {
    toast('目前沒有巡堂時段可匯出', 'warning');
    return;
  }
  const btn = document.getElementById('word-export-btn');
  const progress = document.getElementById('word-export-progress');
  const msg = document.getElementById('word-export-msg');
  const bar = document.getElementById('word-export-bar');
  if (btn) btn.disabled = true;
  if (progress) progress.style.display = 'block';
  if (msg) msg.textContent = '載入巡堂 Excel 範本…';
  if (bar) bar.style.width = '20%';
  try {
    _patrolExcelTplCache = null;
    const tpl = await loadPatrolExcelTemplate();
    const settingsMap = state.settings || {};
    const termCode = settingsMap['學期代號'] || '114-1';
    const yearNum = termCode.split('-')[0] || '114';
    const semNum = termCode.split('-')[1] || '1';
    if (msg) msg.textContent = '整理巡堂資料…';
    if (bar) bar.style.width = '65%';
    const zip = parseDocxZip(tpl.buf);
    const sheetFile = zip.file('xl/worksheets/sheet1.xml');
    const sharedStringsFile = zip.file('xl/sharedStrings.xml');
    const generated = buildPatrolExcelSheetXml(
      sheetFile.asText(),
      sharedStringsFile.asText(),
      yearNum,
      semNum
    );
    zip.file('xl/worksheets/sheet1.xml', generated.sheetXml);
    zip.file('xl/sharedStrings.xml', generated.sharedStringsXml);
    if (msg) msg.textContent = '寫入 Excel…';
    if (bar) bar.style.width = '90%';
    const blob = zip.generate({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, `${yearNum}學年度第${semNum}學期巡堂表.xlsx`);
    if (bar) bar.style.width = '100%';
    if (msg) msg.textContent = '✅ 完成！共 ' + patrolCount + ' 節';
    if (btn) {
      btn.disabled = false;
      btn.textContent = '✅ 完成';
    }
    toast('已匯出 Excel 巡堂表，共 ' + patrolCount + ' 節', 'success');
  } catch (e) {
    console.error(e);
    toast('❌ 巡堂表匯出失敗：' + (e.message || e), 'error');
    if (btn) btn.disabled = false;
    if (progress) progress.style.display = 'none';
  }
}

async function startClassWordExport() {
  const selected = [...document.querySelectorAll('.word-cls-chk:checked')].map(c => c.value);
  if (selected.length === 0) {
    toast('請至少勾選一個班級', 'warning');
    return;
  }

  const btn = document.getElementById('word-export-btn');
  const progress = document.getElementById('word-export-progress');
  const msg = document.getElementById('word-export-msg');
  const bar = document.getElementById('word-export-bar');

  if (btn) btn.disabled = true;
  if (progress) progress.style.display = 'block';
  if (msg) msg.textContent = '載入模板…';
  if (bar) bar.style.width = '5%';

  try {
    _tplCache = null;
    const tpl = await loadTemplate();
    if (bar) bar.style.width = '12%';

    const settingsMap = state.settings || {};
    const termCode = settingsMap['學期代號'] || '114-1';
    const yearNum = termCode.split('-')[0] || '114';
    const semNum = termCode.split('-')[1] || '1';

    const pages = [];
    for (let i = 0; i < selected.length; i++) {
      const classCode = selected[i];
      if (!idx.classByCode[classCode]) continue;
      const name = idx.classByCode[classCode]['班級名稱'] || classCode;
      if (msg) msg.textContent = `正在填入 ${name}（${i + 1}/${selected.length}）…`;
      if (bar) bar.style.width = `${12 + ((i + 1) / selected.length) * 78}%`;
      pages.push(buildClassPageXml(tpl, classCode, yearNum, semNum, i > 0));
      await new Promise(r => setTimeout(r, 0));
    }

    if (pages.length === 0) {
      toast('❌ 沒有可匯出的班級', 'error');
      if (btn) btn.disabled = false;
      if (progress) progress.style.display = 'none';
      return;
    }

    if (msg) msg.textContent = '寫入 Word…';
    if (bar) bar.style.width = '95%';

    const bodyInner = pages.join('') + (tpl.sectPr || '');
    const zip = parseDocxZip(tpl.buf);
    let docXml = zip.file('word/document.xml').asText();
    docXml = docXml.replace(/<w:body[^>]*>[\s\S]*<\/w:body>/, '<w:body>' + bodyInner + '</w:body>');
    zip.file('word/document.xml', docXml);

    const blob = zip.generate({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
    saveAs(blob, `${yearNum}學年度第${semNum}學期班級課表.docx`);

    if (bar) bar.style.width = '100%';
    if (msg) msg.textContent = `✅ 完成！共 ${pages.length} 班`;
    if (btn) {
      btn.disabled = false;
      btn.textContent = '✅ 完成';
    }
    toast(`已匯出 ${pages.length} 班（佔位符替換，樣式全用模板）`, 'success');
  } catch (e) {
    console.error(e);
    toast('❌ 匯出失敗：' + (e.message || e), 'error');
    if (btn) btn.disabled = false;
    if (progress) progress.style.display = 'none';
  }
}

async function startTeacherWordExport() {
  const selected = [...document.querySelectorAll('.word-t-chk:checked')].map(c => c.value);
  if (selected.length === 0) {
    toast('請至少勾選一位教師', 'warning');
    return;
  }

  const btn = document.getElementById('word-export-btn');
  const progress = document.getElementById('word-export-progress');
  const msg = document.getElementById('word-export-msg');
  const bar = document.getElementById('word-export-bar');

  if (btn) btn.disabled = true;
  if (progress) progress.style.display = 'block';
  if (msg) msg.textContent = '載入教師模板…';
  if (bar) bar.style.width = '5%';

  try {
    _teacherTplCache = null;
    const tpl = await loadTeacherTemplate();
    if (bar) bar.style.width = '12%';

    const settingsMap = state.settings || {};
    const termCode = settingsMap['學期代號'] || '114-1';
    const yearNum = termCode.split('-')[0] || '114';
    const semNum = termCode.split('-')[1] || '1';

    const pages = [];
    for (let i = 0; i < selected.length; i++) {
      const tcCode = selected[i];
      const tInfo = idx.teacherByCode[tcCode] || {};
      const name = tInfo['姓名'] || tcCode;

      if (msg) msg.textContent = `正在填入 ${name} 教師（${i + 1}/${selected.length}）…`;
      if (bar) bar.style.width = `${12 + ((i + 1) / selected.length) * 78}%`;
      pages.push(buildTeacherPageXml(tpl, tcCode, yearNum, semNum, i > 0));
      await new Promise(r => setTimeout(r, 0));
    }

    if (pages.length === 0) {
      toast('❌ 沒有可匯出的教師', 'error');
      if (btn) btn.disabled = false;
      if (progress) progress.style.display = 'none';
      return;
    }

    if (msg) msg.textContent = '寫入 Word…';
    if (bar) bar.style.width = '95%';

    const bodyInner = pages.join('') + (tpl.sectPr || '');
    const zip = parseDocxZip(tpl.buf);
    let docXml = zip.file('word/document.xml').asText();
    docXml = docXml.replace(/<w:body[^>]*>[\s\S]*<\/w:body>/, '<w:body>' + bodyInner + '</w:body>');
    zip.file('word/document.xml', docXml);

    const blob = zip.generate({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
    saveAs(blob, `${yearNum}學年度第${semNum}學期教師課表.docx`);

    if (bar) bar.style.width = '100%';
    if (msg) msg.textContent = `✅ 完成！共 ${pages.length} 位教師`;
    if (btn) {
      btn.disabled = false;
      btn.textContent = '✅ 完成';
    }
    toast(`已匯出 ${pages.length} 位教師課表（含配課總表）`, 'success');
  } catch (e) {
    console.error(e);
    toast('❌ 匯出失敗：' + (e.message || e), 'error');
    if (btn) btn.disabled = false;
    if (progress) progress.style.display = 'none';
  }
}

async function loadRoomTemplate() {
  if (_roomTplCache) return _roomTplCache;
  const resp = await fetch('room-official-template.docx?t=' + Date.now());
  if (!resp.ok) throw new Error('無法載入教室模板 HTTP ' + resp.status);
  const buf = await resp.arrayBuffer();
  const zip = parseDocxZip(buf);
  const docXml = zip.file('word/document.xml').asText();
  const bodyMatch = docXml.match(/<w:body[^>]*>([\s\S]*)<\/w:body>/);
  if (!bodyMatch) throw new Error('教室模板缺少 w:body');
  let bodyInner = bodyMatch[1];
  const sectPr = (bodyInner.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/) || [''])[0];
  bodyInner = bodyInner.replace(/<w:sectPr[\s\S]*?<\/w:sectPr>\s*$/, '');
  bodyInner = bodyInner.replace(/(<w:p[ >][\s\S]*?<\/w:p>)\s*$/, (m) => {
    const txt = m.replace(/<[^>]+>/g, '').trim();
    return (txt || /w:br/.test(m)) ? m : '';
  });
  bodyInner = bodyInner.replace(/<w:lastRenderedPageBreak\s*\/>/g, '');
  bodyInner = joinSplitPlaceholders(bodyInner);
  const nextPageSectPr = sectPr
    ? sectPr.replace('</w:sectPr>', '<w:type w:val="nextPage"/></w:sectPr>')
    : '';

  _roomTplCache = { buf, docXml, bodyInner, sectPr, nextPageSectPr };
  return _roomTplCache;
}

function collectRoomTeacherSummary(roomCode) {
  const teacherMap = {};

  (state.schedule || []).forEach(s => {
    const subCode = String(s['科目代碼'] || '').trim();
    if (!subCode) return;
    const subInfo = idx.subjectByCode[subCode];
    const room = subInfo ? String(subInfo['所屬教室代碼'] || '').trim() : '';
    if (room !== String(roomCode)) return;

    const clsCode = String(s['班級代碼'] || '').trim();
    const teacherList = getCellTeacherList(s);
    const tcCode  = teacherList.length > 0
      ? String(teacherList[0]['教師姓名'] || '').trim()
      : String(s['教師姓名'] || '').trim();
    if (!tcCode) return;

    if (!teacherMap[tcCode]) {
      teacherMap[tcCode] = {
        teacherCode: tcCode,
        teacherName: teacherName(tcCode),
        subjects: new Set(),
        classes: new Set(),
        periodCount: 0
      };
    }
    if (subCode) teacherMap[tcCode].subjects.add(subCode);
    if (clsCode) teacherMap[tcCode].classes.add(clsCode);
    teacherMap[tcCode].periodCount++;
  });

  const summaryList = [];
  Object.keys(teacherMap).forEach(tcCode => {
    const item = teacherMap[tcCode];
    const classArr = Array.from(item.classes).sort();
    const classRange = formatClassRanges(classArr);
    const subStr = Array.from(item.subjects).join('、');

    summaryList.push({
      teacher: item.teacherName || tcCode,
      subject: subStr,
      classRange: classRange,
      periodCount: item.periodCount
    });
  });

  summaryList.sort((a, b) => {
    if (b.periodCount !== a.periodCount) return b.periodCount - a.periodCount;
    return String(a.teacher).localeCompare(String(b.teacher), 'zh-Hant');
  });

  return summaryList;
}

function buildRoomDict(roomCode, yearNum, semNum) {
  const roomObj = idx.roomByCode[roomCode] || {};
  const roomName = roomObj['教室名稱'] || roomCode;

  const dict = {
    '年': yearNum,
    '期': semNum === '1' ? '一' : (semNum === '2' ? '二' : semNum),
    '教室': roomName
  };

  // 課表 grid (只寫班級代碼，同科目去重不重複顯示)
  for (let d = 1; d <= 5; d++) {
    const earlyCells = idx.schedByRoomSlot[roomCode + '|' + d + '|' + WORD_EARLY_PERIOD] || [];
    const earlySubjects = [...new Set(earlyCells.map(c => String(c['科目代碼'] || '').trim()).filter(Boolean))];
    dict[`d${d}p0_s`] = earlySubjects.join(' / ');
     dict[`d${d}p0_c`] = formatClassRanges(earlyCells.map(c => String(c['班級代碼'] || '').trim()));
    for (let p = 1; p <= 8; p++) {
      const rk = roomCode + '|' + d + '|' + p;
      const cells = idx.schedByRoomSlot[rk] || [];
      if (cells.length > 0) {
        const subCodes = [...new Set(cells.map(c => String(c['科目代碼'] || '').trim()).filter(Boolean))];
        dict[`d${d}p${p}_s`] = subCodes.join(' / ');
         dict[`d${d}p${p}_c`] = formatClassRanges(cells.map(c => String(c['班級代碼'] || '').trim()));
      } else {
        dict[`d${d}p${p}_s`] = '';
        dict[`d${d}p${p}_c`] = '';
      }
    }
    const lunchCells = idx.schedByRoomSlot[roomCode + '|' + d + '|' + WORD_LUNCH_PERIOD] || [];
    const lunchSubjects = [...new Set(lunchCells.map(c => String(c['科目代碼'] || '').trim()).filter(Boolean))];
    dict[`d${d}p45_s`] = lunchSubjects.join(' / ');
     dict[`d${d}p45_c`] = formatClassRanges(lunchCells.map(c => String(c['班級代碼'] || '').trim()));
  }

  // 配課總表（按教師歸類，同一老師一列/一個位子）
  const summaries = collectRoomTeacherSummary(roomCode);
  for (let i = 1; i <= 6; i++) {
    const rowIdx = Math.ceil(i / 2);
    const colSide = (i % 2 === 1) ? 1 : 2;
    const item = summaries[i - 1];

    dict[`t${rowIdx}_s${colSide}`] = item ? item.subject : '';
    dict[`t${rowIdx}_c${colSide}`] = item ? item.classRange : '';
    dict[`t${rowIdx}_h${colSide}`] = item ? item.teacher : '';
  }

  return dict;
}

function buildRoomPageXml(tpl, roomCode, yearNum, semNum, leadPageBreak) {
  const dict = buildRoomDict(roomCode, yearNum, semNum);
  let page = expandWordSpecialRows(tpl.bodyInner, dict, 'room');
  page = fillPlaceholders(page, dict);
  page = wordLockTableColumns(page);
  if (leadPageBreak) page = injectPageBreakAtStart(page);
  return page;
}

async function startRoomWordExport() {
  const selected = [...document.querySelectorAll('.word-r-chk:checked')].map(c => c.value);
  if (selected.length === 0) {
    toast('請至少勾選一間教室', 'warning');
    return;
  }

  const btn = document.getElementById('word-export-btn');
  const progress = document.getElementById('word-export-progress');
  const msg = document.getElementById('word-export-msg');
  const bar = document.getElementById('word-export-bar');

  if (btn) btn.disabled = true;
  if (progress) progress.style.display = 'block';
  if (msg) msg.textContent = '載入教室模板…';
  if (bar) bar.style.width = '5%';

  try {
    _roomTplCache = null;
    const tpl = await loadRoomTemplate();
    if (bar) bar.style.width = '12%';

    const settingsMap = state.settings || {};
    const termCode = settingsMap['學期代號'] || '114-1';
    const yearNum = termCode.split('-')[0] || '114';
    const semNum = termCode.split('-')[1] || '1';

    const pages = [];
    for (let i = 0; i < selected.length; i++) {
      const roomCode = selected[i];
      const roomObj = idx.roomByCode[roomCode] || {};
      const name = roomObj['教室名稱'] || roomCode;

      if (msg) msg.textContent = `正在填入 ${name} 教室（${i + 1}/${selected.length}）…`;
      if (bar) bar.style.width = `${12 + ((i + 1) / selected.length) * 78}%`;
      pages.push(buildRoomPageXml(tpl, roomCode, yearNum, semNum, i > 0));
      await new Promise(r => setTimeout(r, 0));
    }

    if (pages.length === 0) {
      toast('❌ 沒有可匯出的教室', 'error');
      if (btn) btn.disabled = false;
      if (progress) progress.style.display = 'none';
      return;
    }

    if (msg) msg.textContent = '寫入 Word…';
    if (bar) bar.style.width = '95%';

    const bodyInner = pages.join('') + (tpl.sectPr || '');
    const zip = parseDocxZip(tpl.buf);
    let docXml = zip.file('word/document.xml').asText();
    docXml = docXml.replace(/<w:body[^>]*>[\s\S]*<\/w:body>/, '<w:body>' + bodyInner + '</w:body>');
    zip.file('word/document.xml', docXml);

    const blob = zip.generate({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
    saveAs(blob, `${yearNum}學年度第${semNum}學期教室課表.docx`);

    if (bar) bar.style.width = '100%';
    if (msg) msg.textContent = `✅ 完成！共 ${pages.length} 間教室`;
    if (btn) {
      btn.disabled = false;
      btn.textContent = '✅ 完成';
    }
    toast(`已匯出 ${pages.length} 間教室課表（含使用總表）`, 'success');
  } catch (e) {
    console.error(e);
    toast('❌ 匯出失敗：' + (e.message || e), 'error');
    if (btn) btn.disabled = false;
    if (progress) progress.style.display = 'none';
  }
}

async function startWordExport() {
  if (_wordCurrentTab === 'class') {
    await startClassWordExport();
  } else if (_wordCurrentTab === 'teacher') {
    await startTeacherWordExport();
  } else if (_wordCurrentTab === 'room') {
    await startRoomWordExport();
  } else {
    await startPatrolWordExport();
  }
}
