declare module 'pdf-parse' {
  import { Buffer } from 'node:buffer';

  type PdfParse = (buffer: Buffer) => Promise<{
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    version: string;
    text: string;
  }>;

  const parse: PdfParse;
  export default parse;
}
