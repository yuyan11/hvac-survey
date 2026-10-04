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
    // 大块（照片等已是压缩格式的二进制）压缩基本没收益，却要白烧一遍 CPU、多占一倍内存 → 直接 STORE
    let comp = raw.length > 4 * 1024 * 1024 ? null : await deflateRaw(raw);
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

/* ---------- 图片：取尺寸（按比例缩放，别把证件照拉变形） ---------- */
export function imageSize(bytes, ext) {
  const b = bytes;
  if (ext === 'png') {
    if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) {
      const w = ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0;
      const h = ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0;
      if (w && h) return { w, h };
    }
    return null;
  }
  // JPEG：扫 SOF 段（FFC0-FFCF，跳过 C4/C8/CC）
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i += 1; continue; }
    const m = b[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    if (m === 0xda || m === 0xd9) break;
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) break;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      const h = (b[i + 5] << 8) | b[i + 6];
      const w = (b[i + 7] << 8) | b[i + 8];
      return (w && h) ? { w, h } : null;
    }
    i += 2 + len;
  }
  return null;
}

const IMG_BOX_W = 150;   // 表格里图片最大显示宽度（像素）
const IMG_BOX_H = 100;   // 最大高度
const EMU_PER_PX = 9525;

function fitBox(bytes, ext) {
  const size = imageSize(bytes, ext) || { w: 4, h: 3 };
  const ratio = (size.w && size.h) ? size.w / size.h : 4 / 3;
  let w = IMG_BOX_W;
  let h = Math.round(w / ratio);
  if (h > IMG_BOX_H) { h = IMG_BOX_H; w = Math.round(h * ratio); }
  return { w: Math.max(w, 20), h: Math.max(h, 15) };
}

/* 单元格值写成 { img: { data: Uint8Array, ext: 'jpeg' } } → 该格留空，图片用 drawing 锚在这一格 */
function isImg(v) { return !!(v && typeof v === 'object' && v.img && v.img.data); }

function cellXml(ref, val, styleId) {
  const s = styleId ? ` s="${styleId}"` : '';
  if (val == null || val === '' || isImg(val)) return s ? `<c r="${ref}"${s}/>` : '';
  if (typeof val === 'number' && isFinite(val)) return `<c r="${ref}"${s}><v>${val}</v></c>`;
  const text = xmlEsc(val);
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
}

function displayLen(v) {
  if (v == null) return 0;
  if (isImg(v)) return Math.ceil(fitBox(v.img.data, v.img.ext || 'jpeg').w / 7); // 换算成字符宽
  const s = String(v);
  let len = 0;
  for (const ch of s) len += ch.charCodeAt(0) > 255 ? 2 : 1; // 中文按两个字符宽估
  return len;
}

function sheetXml(rows, maxCols, images, hasDrawing) {
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

  // 有图的行必须给够行高，否则图片会被下面的行盖住
  const rowHeight = new Map();
  (images || []).forEach(im => {
    const box = fitBox(im.data, im.ext || 'jpeg');
    rowHeight.set(im.row, Math.max(rowHeight.get(im.row) || 0, box.h + 6));
  });

  const body = rows.map((row, ri) => {
    const cells = [];
    for (let c = 0; c < maxCols; c += 1) {
      const ref = colName(c + 1) + (ri + 1);
      const xml = cellXml(ref, row ? row[c] : '', ri === 0 ? 1 : 0);
      if (xml) cells.push(xml);
    }
    const ht = rowHeight.get(ri);
    const attrs = ht ? ` ht="${ht}" customHeight="1"` : '';
    return `<row r="${ri + 1}"${attrs}>${cells.join('')}</row>`;
  }).join('');

  const lastRef = colName(Math.max(maxCols, 1)) + Math.max(rows.length, 1);
  const drawing = hasDrawing ? '<drawing r:id="rId1"/>' : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:${lastRef}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols.join('')}</cols>
<sheetData>${body}</sheetData>
<autoFilter ref="A1:${lastRef}"/>${drawing}
</worksheet>`;
}

/* 一张表里的所有图片 → drawing{n}.xml（oneCellAnchor，锚在目标单元格左上角） */
function drawingXml(images) {
  const pics = images.map((im, i) => {
    const box = fitBox(im.data, im.ext || 'jpeg');
    const cx = box.w * EMU_PER_PX;
    const cy = box.h * EMU_PER_PX;
    return '<xdr:oneCellAnchor>'
      + `<xdr:from><xdr:col>${im.col}</xdr:col><xdr:colOff>19050</xdr:colOff><xdr:row>${im.row}</xdr:row><xdr:rowOff>9525</xdr:rowOff></xdr:from>`
      + `<xdr:ext cx="${cx}" cy="${cy}"/>`
      + '<xdr:pic><xdr:nvPicPr>'
      + `<xdr:cNvPr id="${i + 1}" name="Picture ${i + 1}"/>`
      + '<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>'
      + `<xdr:blipFill><a:blip r:embed="rId${i + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>`
      + `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>`
      + '</xdr:pic><xdr:clientData/></xdr:oneCellAnchor>';
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + pics + '</xdr:wsDr>';
}

function drawingRelsXml(mediaNames) {
  const rels = mediaNames.map((name, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${name}"/>`);
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels.join('') + '</Relationships>';
}

function sheetRelsXml(drawingIndex) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingIndex}.xml"/>`
    + '</Relationships>';
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
 *   单元格值可以是字符串 / 数字 / 布尔，也可以是 { img: { data: Uint8Array, ext?: 'jpeg'|'png' } }
 *   —— 图片会「原图」写进 xl/media/，并按等比缩放锚在该单元格位置。
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
  const media = [];        // { name, data }
  const mediaTypes = new Set();

  clean.forEach((s, i) => {
    const n = i + 1;

    // 先扫出这张表里所有图片，记下它们在哪个格
    const images = [];
    s.rows.forEach((row, ri) => {
      (row || []).forEach((v, ci) => {
        if (isImg(v)) images.push({ row: ri, col: ci, data: v.img.data, ext: v.img.ext || 'jpeg' });
      });
    });

    const maxCols = s.rows.reduce((m, r) => Math.max(m, (r || []).length), 1);
    types.push(`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    rels.push(`<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`);
    sheetTags.push(`<sheet name="${xmlEsc(safeSheetName(s.name, i))}" sheetId="${n}" r:id="rId${n}"/>`);

    let drawingIndex = null;
    if (images.length) {
      drawingIndex = n;
      const names = [];
      images.forEach(im => {
        const ext = im.ext === 'png' ? 'png' : 'jpeg';
        const name = `image${media.length + 1}.${ext}`;
        media.push({ name, data: im.data });
        mediaTypes.add(ext);
        names.push(name);
      });
      types.push(`<Override PartName="/xl/drawings/drawing${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
      files.push({ name: `xl/drawings/drawing${n}.xml`, data: drawingXml(images) });
      files.push({ name: `xl/drawings/_rels/drawing${n}.xml.rels`, data: drawingRelsXml(names) });
      files.push({ name: `xl/worksheets/_rels/sheet${n}.xml.rels`, data: sheetRelsXml(n) });
    }

    files.push({ name: `xl/worksheets/sheet${n}.xml`, data: sheetXml(s.rows, maxCols, images, !!drawingIndex) });
  });

  mediaTypes.forEach(ext => {
    types.push(`<Default Extension="${ext}" ContentType="image/${ext}"/>`);
  });
  media.forEach(m => files.push({ name: `xl/media/${m.name}`, data: m.data }));

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
