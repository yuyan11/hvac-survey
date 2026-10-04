/* 极简 XLSX 生成器（零依赖）
 *
 * 为什么不用 SheetJS：Worker 里不想引第三方包，且体积大。
 * 这里直接手写 OOXML + ZIP（有 CompressionStream 就 deflate，没有就 STORE 不压缩）。
 * 生成的文件是 **真正的 .xlsx**，Excel / WPS / 腾讯文档 / Numbers 都能直接打开，
 * 不会出现「扩展名与格式不符」的弹窗（HTML 假 xls 的老套路会弹）。
 *
 * 用法：
 *   const bytes = await buildXlsx([
 *     { name: '入职考察', rows: [['编号','姓名'], [1,'张三']] },
 *   ]);
 *   // bytes 是 Uint8Array，可直接当附件发邮件或作为响应体返回
 */

const enc = new TextEncoder();

/* ---------- CRC32 ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ---------- 压缩（失败就退回不压缩） ---------- */
async function deflateRaw(bytes) {
  try {
    if (typeof CompressionStream === 'undefined') return null;
    const cs = new CompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (e) {
    return null;
  }
}

function dosDateTime(d) {
  const time = ((d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1)) & 0xffff;
  const date = (((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate()) & 0xffff;
  return { time, date };
}

function concat(parts) {
  let len = 0;
  parts.forEach(p => { len += p.length; });
  const out = new Uint8Array(len);
  let off = 0;
  parts.forEach(p => { out.set(p, off); off += p.length; });
  return out;
}

async function makeZip(entries) {
  const now = new Date();
  const { time, date } = dosDateTime(now);
  const locals = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const raw = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    const crc = crc32(raw);
    let comp = await deflateRaw(raw);
    let method = 8;
    if (!comp || comp.length >= raw.length) { comp = raw; method = 0; }

    const nameBytes = enc.encode(e.name);
    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);      // 文件名用 UTF-8
    lv.setUint16(8, method, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, comp.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    lh.set(nameBytes, 30);
    locals.push(lh, comp);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, comp.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += lh.length + comp.length;
  }

  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  return concat(locals.concat(central, [eocd]));
}

/* ---------- OOXML 片段 ---------- */
// XML 1.0 不接受大部分控制字符，Excel 遇到会直接报「文件损坏」，必须先剔掉
function xmlEsc(v) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

function colName(n) { // 1 -> A, 27 -> AA
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cellXml(ref, val, styleId) {
  const s = styleId ? ` s="${styleId}"` : '';
  if (val == null || val === '') return s ? `<c r="${ref}"${s}/>` : '';
  if (typeof val === 'number' && isFinite(val)) return `<c r="${ref}"${s}><v>${val}</v></c>`;
  const text = xmlEsc(val);
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
}

function displayLen(v) {
  if (v == null) return 0;
  const s = String(v);
  let len = 0;
  for (const ch of s) len += ch.charCodeAt(0) > 255 ? 2 : 1; // 中文按两个字符宽估
  return len;
}

function sheetXml(rows, maxCols) {
  const cols = [];
  for (let c = 0; c < maxCols; c += 1) {
    let w = 8;
    for (let r = 0; r < rows.length; r += 1) {
      const v = displayLen(rows[r] && rows[r][c]);
      if (v > w) w = v;
    }
    const width = Math.min(Math.max(w + 3, 9), 60);
    cols.push(`<col min="${c + 1}" max="${c + 1}" width="${width}" customWidth="1"/>`);
  }

  const body = rows.map((row, ri) => {
    const cells = [];
    for (let c = 0; c < maxCols; c += 1) {
      const ref = colName(c + 1) + (ri + 1);
      const xml = cellXml(ref, row ? row[c] : '', ri === 0 ? 1 : 0);
      if (xml) cells.push(xml);
    }
    return `<row r="${ri + 1}">${cells.join('')}</row>`;
  }).join('');

  const lastRef = colName(Math.max(maxCols, 1)) + Math.max(rows.length, 1);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${lastRef}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols.join('')}</cols>
<sheetData>${body}</sheetData>
<autoFilter ref="A1:${lastRef}"/>
</worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><color theme="1"/><name val="等线"/></font><font><b/><sz val="11"/><color theme="1"/><name val="等线"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/* 工作表名不能超过 31 字符、不能含 []:*?/\ */
function safeSheetName(name, idx) {
  const n = String(name || '').replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 31);
  return n || ('Sheet' + (idx + 1));
}

/**
 * @param {Array<{name:string, rows:Array<Array<any>>}>} sheets
 * @returns {Promise<Uint8Array>}
 */
export async function buildXlsx(sheets) {
  const clean = (sheets || []).filter(s => s && Array.isArray(s.rows) && s.rows.length);
  if (!clean.length) throw new Error('没有可导出的数据');
  if (clean.length > 20) clean.length = 20; // Excel 硬上限，正常用不到

  const types = [
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
  ];
  const rels = [];
  const sheetTags = [];
  const files = [];

  clean.forEach((s, i) => {
    const n = i + 1;
    const maxCols = s.rows.reduce((m, r) => Math.max(m, (r || []).length), 1);
    types.push(`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    rels.push(`<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`);
    sheetTags.push(`<sheet name="${xmlEsc(safeSheetName(s.name, i))}" sheetId="${n}" r:id="rId${n}"/>`);
    files.push({ name: `xl/worksheets/sheet${n}.xml`, data: sheetXml(s.rows, maxCols) });
  });

  const styleId = clean.length + 1;
  rels.push(`<Relationship Id="rId${styleId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`);

  files.unshift({ name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${types.join('')}</Types>` });
  files.push({ name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` });
  files.push({ name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetTags.join('')}</sheets></workbook>` });
  files.push({ name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>` });
  files.push({ name: 'xl/styles.xml', data: STYLES });

  return makeZip(files);
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
