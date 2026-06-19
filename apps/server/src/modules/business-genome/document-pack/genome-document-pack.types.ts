export type ExportFormat = 'pdf' | 'docx';

export type DocumentPackArtifact = 'executive-brief' | 'constitution' | 'dna-report';

export interface DocumentSectionRow {
  label: string;
  value: string;
}

export interface DocumentSection {
  heading?: string;
  rows: DocumentSectionRow[];
  emphasis?: boolean;
}

export interface ExportResult {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

export interface ExportQuery {
  format: ExportFormat;
}
