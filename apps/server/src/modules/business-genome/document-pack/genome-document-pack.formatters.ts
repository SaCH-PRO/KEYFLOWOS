import PDFDocument from 'pdfkit';
import {
  Document as DocxDocument,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
} from 'docx';
import type { DocumentSection, ExportResult } from './genome-document-pack.types';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function sanitizeText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  if (Array.isArray(value)) return value.map((v) => sanitizeText(v)).join(', ');
  if (isObject(value)) return JSON.stringify(value);
  return String(value).replace(/\s+/g, ' ').trim();
}

function splitLines(value: string): string[] {
  const cleaned = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  return cleaned ? cleaned.split('\n').map((line) => line.trim()).filter(Boolean) : [];
}

export async function renderPdf(
  title: string,
  meta: string,
  sections: DocumentSection[],
  filename: string,
): Promise<ExportResult> {
  const doc = new PDFDocument({ size: 'LETTER', margin: 48, info: { Title: title } });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  doc.fontSize(18).fillColor('#111').text(title);
  doc.moveDown(0.25).fontSize(9).fillColor('#666').text(meta);
  doc.moveDown(0.75);

  for (const section of sections) {
    if (section.heading) {
      doc.moveDown(0.5).fontSize(12).fillColor('#111').text(section.heading);
      doc
        .moveTo(doc.x, doc.y + 2)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y + 2)
        .strokeColor('#ddd')
        .stroke();
      doc.moveDown(0.3);
    }

    for (const { label, value } of section.rows) {
      const y = doc.y;
      const labelWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right - 140;
      const labelText = sanitizeText(label);
      const valueText = sanitizeText(value);

      doc
        .fontSize(section.emphasis ? 10 : 9)
        .fillColor('#222')
        .font(section.emphasis ? 'Helvetica-Bold' : 'Helvetica');
      doc.text(labelText, doc.page.margins.left, y, { width: labelWidth });
      doc.text(valueText, doc.page.margins.left + labelWidth, y, { width: 140, align: 'right' });
      doc.moveDown(0.15);
    }
  }

  doc.end();
  const buffer = await done;
  return { buffer, filename, contentType: 'application/pdf' };
}

export async function renderDocx(
  title: string,
  meta: string,
  sections: DocumentSection[],
  filename: string,
): Promise<ExportResult> {
  const children: Paragraph[] = [
    new Paragraph({
      text: title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.LEFT,
      spacing: { after: 120 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: meta, color: '666666', size: 18 }),
      ],
      spacing: { after: 240 },
    }),
  ];

  for (const section of sections) {
    if (section.heading) {
      children.push(
        new Paragraph({
          text: section.heading,
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 240, after: 120 },
        }),
      );
    }

    for (const { label, value } of section.rows) {
      const labelText = sanitizeText(label);
      const valueText = sanitizeText(value);
      const valueLines = splitLines(valueText);
      const bold = !!section.emphasis || valueLines.length === 0;

      if (!labelText && valueLines.length === 0) continue;

      if (!labelText) {
        for (const line of valueLines.length ? valueLines : [valueText]) {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: line, bold, size: 22 })],
              spacing: { after: 80 },
            }),
          );
        }
        continue;
      }

      if (valueLines.length <= 1) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: `${labelText}: `, bold: true, size: 22 }),
              new TextRun({ text: valueLines[0] ?? valueText, bold, size: 22 }),
            ],
            spacing: { after: 80 },
          }),
        );
      } else {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: `${labelText}:`, bold: true, size: 22 })],
            spacing: { after: 40 },
          }),
        );
        for (const line of valueLines) {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: line, size: 22 })],
              spacing: { after: 40 },
              indent: { left: 360 },
            }),
          );
        }
      }
    }
  }

  const doc = new DocxDocument({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return { buffer, filename, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
}

export function buildFilename(slug: string, format: 'pdf' | 'docx', suffix?: string): string {
  const parts = [slug];
  if (suffix) parts.push(suffix);
  const timestamp = new Date().toISOString().slice(0, 10);
  parts.push(timestamp);
  return `${parts.join('-')}.${format}`;
}
