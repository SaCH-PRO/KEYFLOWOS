// Code-mode harness: runs INSIDE a spawned, env-less child process.
// Receives {code, inputs} over IPC, evaluates the snippet with only a
// narrow `api` object available, and streams tool calls back to the parent.
// Never trust this file's inputs.
'use strict';

const send = (msg) => {
  if (process.send) process.send(msg);
};
const logs = [];
const log = (...args) => {
  logs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
};

let toolSeq = 0;
const pending = new Map();
process.on('message', (msg) => {
  if (msg && msg.type === 'toolResult' && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error));
    else resolve(msg.result);
  }
});

const api = {
  log,
  callTool: (name, args) =>
    new Promise((resolve, reject) => {
      const id = ++toolSeq;
      pending.set(id, { resolve, reject });
      send({ type: 'tool', id, name, args: args ?? {} });
    }),
};

process.on('message', async (msg) => {
  if (!msg || msg.type !== 'run') return;
  try {
    // Shadow every escape hatch a snippet might reach for directly.
    const fn = new Function(
      'api',
      'inputs',
      'require',
      'process',
      'global',
      'globalThis',
      'module',
      'exports',
      'setTimeout',
      'setInterval',
      'setImmediate',
      `return (async () => { ${msg.code} })();`,
    );
    const value = await fn(api, msg.inputs ?? {});
    send({ type: 'done', value: value === undefined ? null : value, logs });
  } catch (err) {
    send({ type: 'error', message: err && err.message ? err.message : String(err), logs });
  }
});

send({ type: 'ready' });
