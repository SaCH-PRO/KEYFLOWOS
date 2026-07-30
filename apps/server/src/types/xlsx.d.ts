declare module 'xlsx' {
  // Minimal stub for the xlsx dynamic import used by KEY Cortex document parsing.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const xlsx: any;
  export = xlsx;
}
