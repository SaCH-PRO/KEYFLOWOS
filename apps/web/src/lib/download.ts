export function saveAs(content: string | Blob, filename: string, mime?: string) {
  const blob = typeof content === "string" ? new Blob([content], { type: mime ?? "text/plain" }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
