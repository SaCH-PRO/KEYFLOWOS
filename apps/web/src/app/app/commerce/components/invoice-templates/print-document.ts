"use client";


export function buildPrintHtml(innerHTML: string, title: string): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <title>${title}</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      @media print {
        @page { margin: 0.5cm; size: A4; }
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
    </style>
    <script src="https://cdn.tailwindcss.com"><\/script>
  </head>
  <body>${innerHTML}</body>
</html>`;
}

export function printFromRef(ref: React.RefObject<HTMLElement | null>, docType: string, docNumber: string) {
  if (!ref.current) return;
  const title = `${docType} #${docNumber}`;
  const html = buildPrintHtml(ref.current.innerHTML, title);
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.close();
  setTimeout(() => {
    printWindow.print();
  }, 600);
}

export function printFromHtml(innerHTML: string, docType: string, docNumber: string) {
  const title = `${docType} #${docNumber}`;
  const html = buildPrintHtml(innerHTML, title);
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.close();
  setTimeout(() => {
    printWindow.print();
  }, 600);
}
