/**
 * Adversarial file fixtures for M9F14.
 *
 * Generates the zip-based Office formats (.docx, .pptx) and a macro-laden
 * .docx entirely in memory using Node's zlib raw-deflate + a minimal
 * hand-built zip container. Keeps the repo free of committed binaries
 * while still producing bytes that the real mammoth / officeparser
 * parsers accept.
 *
 * We intentionally do NOT generate a true >100MB decompression-bomb
 * here — the VAL-FILE-016/017 assertions are proven by patching the
 * mammoth and pdf-parse boundaries to return >cap text, which exercises
 * the exact assertBelowCap defence in src/lib/files/parsers.ts without
 * committing 100MB+ of memory pressure to CI.
 */

import { crc32 as zlibCrc32, deflateRawSync } from 'node:zlib'

const enc = new TextEncoder()

function u16(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff])
}

function u32(n: number): Uint8Array {
  return new Uint8Array([
    n & 0xff,
    (n >>> 8) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 24) & 0xff,
  ])
}

function concat(parts: Uint8Array[]): Uint8Array {
  let len = 0
  for (const p of parts) len += p.length
  const out = new Uint8Array(len)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

function crc32(data: Uint8Array): number {
  // Node 22+ ships zlib.crc32. Buffer view keeps the call zero-copy.
  return zlibCrc32(Buffer.from(data.buffer, data.byteOffset, data.byteLength))
}

interface ZipEntry {
  name: string
  data: Uint8Array
}

export function writeZip(entries: ZipEntry[]): Uint8Array {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name)
    const compressed = deflateRawSync(Buffer.from(entry.data))
    const crc = crc32(entry.data)

    const local = concat([
      u32(0x04034b50), // local file header signature
      u16(20), // version needed
      u16(0), // flags
      u16(8), // compression method = deflate
      u16(0), // last mod time
      u16(0), // last mod date
      u32(crc),
      u32(compressed.length),
      u32(entry.data.length),
      u16(nameBytes.length),
      u16(0), // extra length
      nameBytes,
      compressed,
    ])
    locals.push(local)

    const central = concat([
      u32(0x02014b50), // central file header signature
      u16(20), // version made by
      u16(20), // version needed
      u16(0),
      u16(8),
      u16(0),
      u16(0),
      u32(crc),
      u32(compressed.length),
      u32(entry.data.length),
      u16(nameBytes.length),
      u16(0),
      u16(0), // file comment length
      u16(0), // disk number start
      u16(0), // internal attrs
      u32(0), // external attrs
      u32(offset),
      nameBytes,
    ])
    centrals.push(central)

    offset += local.length
  }

  const centralStart = offset
  const centralSize = centrals.reduce((a, b) => a + b.length, 0)
  const eocd = concat([
    u32(0x06054b50), // EOCD signature
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralSize),
    u32(centralStart),
    u16(0), // comment length
  ])

  return concat([...locals, ...centrals, eocd])
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Minimal valid .docx that mammoth.extractRawText accepts.
 * Contains a single paragraph with the supplied body text.
 */
export function makeMinimalDocx(body: string): Uint8Array {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t xml:space="preserve">${xmlEscape(body)}</w:t></w:r></w:p>
  </w:body>
</w:document>`

  return writeZip([
    { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
    { name: '_rels/.rels', data: enc.encode(rootRels) },
    { name: 'word/document.xml', data: enc.encode(document) },
  ])
}

/**
 * Minimal .docx with a vbaProject.bin macro part. Mammoth's
 * extractRawText ignores binary parts, so the returned text must
 * contain the body and none of the macro bytes.
 */
export function makeMacroDocx(body: string): Uint8Array {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/>
</Relationships>`

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t xml:space="preserve">${xmlEscape(body)}</w:t></w:r></w:p>
  </w:body>
</w:document>`

  // A non-empty byte sequence with NULLs + a fake VBA signature. Mammoth
  // never reads this, but the presence proves the macro part exists.
  const vba = new Uint8Array([
    0x4d, 0x5a, 0x00, 0x00, 0xde, 0xad, 0xbe, 0xef,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x56, 0x42, 0x41, 0x50, 0x72, 0x6f, 0x6a, 0x65, 0x63, 0x74, // "VBAProject"
    0x00, 0x00, 0x00, 0x00,
  ])

  return writeZip([
    { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
    { name: '_rels/.rels', data: enc.encode(rootRels) },
    { name: 'word/_rels/document.xml.rels', data: enc.encode(documentRels) },
    { name: 'word/document.xml', data: enc.encode(document) },
    { name: 'word/vbaProject.bin', data: vba },
  ])
}

/**
 * Minimal valid .pptx with a single slide containing supplied text.
 * officeparser v5 reads ppt/slides/slide{N}.xml and extracts <a:t> runs.
 */
export function makeMinimalPptx(slideText: string): Uint8Array {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`

  const presRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`

  const presentation = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
</p:presentation>`

  const slide = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody>
      <a:p><a:r><a:t>${xmlEscape(slideText)}</a:t></a:r></a:p>
    </p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`

  return writeZip([
    { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
    { name: '_rels/.rels', data: enc.encode(rootRels) },
    { name: 'ppt/_rels/presentation.xml.rels', data: enc.encode(presRels) },
    { name: 'ppt/presentation.xml', data: enc.encode(presentation) },
    { name: 'ppt/slides/slide1.xml', data: enc.encode(slide) },
  ])
}
