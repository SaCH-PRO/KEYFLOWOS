#!/usr/bin/env node
/**
 * Stage 0 architecture registries generator (convergence plan).
 *
 * Statically analyses the monorepo and emits machine-readable maps under
 * architecture/. These files are architecture INPUTS — CI (or a later gate)
 * can diff them against the codebase to detect drift, dead modules, and
 * contract violations.
 *
 * Sources of truth (regex-based extraction, documented approximation):
 *   - module-registry.yaml    apps/server/src/modules/* + app.module.ts imports
 *   - route-registry.yaml     apps/web/src/app/app/** /page.tsx + nav-config
 *   - event-registry.yaml     .emit('...') and @OnEvent('...') across server src
 *   - capability-registry.yaml compiled FLOW_TOOLS from dist
 *   - data-ownership.yaml     Prisma models -> modules referencing them most
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SERVER_SRC = path.join(ROOT, 'apps/server/src');
const OUT_DIR = path.join(ROOT, 'architecture');

function* walk(dir, filter) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
      yield* walk(full, filter);
    } else if (filter(entry.name)) {
      yield full;
    }
  }
}

function yamlEscape(s) {
  return String(s).replace(/'/g, "''");
}

function toYaml(value, indent = 0) {
  const pad = '  '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`;
    return value.map((item) => {
      if (typeof item === 'object' && item !== null) {
        const inner = toYaml(item, indent + 1).trimStart();
        return `${pad}- ${inner}`;
      }
      return `${pad}- ${yamlEscape(item)}`;
    }).join('\n');
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).map(([k, v]) => {
      if (typeof v === 'object' && v !== null) {
        return `${pad}${k}:\n${toYaml(v, indent + 1)}`;
      }
      return `${pad}${k}: ${yamlEscape(v)}`;
    }).join('\n');
  }
  return `${pad}${yamlEscape(value)}`;
}

function writeYaml(filename, header, data) {
  const content = `${header}\n${toYaml(data)}\n`;
  fs.writeFileSync(path.join(OUT_DIR, filename), content);
  console.log(`wrote architecture/${filename}`);
}

// ── 1. Module registry ──────────────────────────────────────────────────────

function buildModuleRegistry() {
  const appModulePath = path.join(SERVER_SRC, 'app.module.ts');
  const appModule = fs.readFileSync(appModulePath, 'utf8');
  const importedModules = new Set(
    [...appModule.matchAll(/import \{ (\w+Module) \} from '(\.\/modules\/[^']+|\.\/core\/[^']+)'/g)]
      .map((m) => m[1]),
  );

  // Every module file's import graph — a module registered via another module
  // (e.g. PayrollModule via AiModule) is still wired, just not at root level.
  const moduleImporters = new Map(); // className -> Set<importer module dir>
  for (const file of walk(SERVER_SRC, (f) => f.endsWith('.module.ts'))) {
    const rel = path.relative(SERVER_SRC, file).replace(/\\/g, '/');
    const importerDir = rel.startsWith('modules/') ? rel.split('/')[1] : 'app-root';
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/import \{ (\w+Module) \} from '/g)) {
      if (!moduleImporters.has(m[1])) moduleImporters.set(m[1], new Set());
      moduleImporters.get(m[1]).add(importerDir);
    }
  }

  const modules = [];
  const modulesDir = path.join(SERVER_SRC, 'modules');
  for (const entry of fs.readdirSync(modulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dirName = entry.name;
    const files = fs.readdirSync(path.join(modulesDir, dirName));
    const moduleFile = files.find((f) => f.endsWith('.module.ts'));
    const className = moduleFile
      ? moduleFile.replace('.module.ts', '').split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join('') + 'Module'
      : null;
    const services = files.filter((f) => f.endsWith('.service.ts') && !f.endsWith('.spec.ts')).length;
    const controllers = files.filter((f) => f.endsWith('.controller.ts')).length;
    modules.push({
      id: dirName,
      moduleClass: moduleFile ? moduleFile.replace('.module.ts', '') : null,
      registeredInAppModule: className ? importedModules.has(className) : false,
      registeredVia: className ? [...(moduleImporters.get(className) ?? [])].filter((m) => m !== 'app-root' && m !== dirName).sort() : [],
      services,
      controllers,
    });
  }
  modules.sort((a, b) => a.id.localeCompare(b.id));
  return {
    generated: new Date().toISOString().slice(0, 10),
    source: 'apps/server/src/modules/* + app.module.ts',
    totals: { modules: modules.length, registered: modules.filter((m) => m.registeredInAppModule).length },
    modules,
  };
}

// ── 2. Route registry ───────────────────────────────────────────────────────

function buildRouteRegistry() {
  const routes = [];
  const appDir = path.join(ROOT, 'apps/web/src/app/app');
  for (const pageFile of walk(appDir, (f) => f === 'page.tsx')) {
    const rel = path.relative(appDir, pageFile).replace(/\\/g, '/').replace(/\/page\.tsx$/, '');
    routes.push({ path: `/app/${rel}` });
  }
  routes.sort((a, b) => a.path.localeCompare(b.path));

  let navLinks = [];
  try {
    const navConfig = fs.readFileSync(path.join(ROOT, 'apps/web/src/lib/nav-config.ts'), 'utf8');
    navLinks = [...navConfig.matchAll(/href: "([^"]+)"/g)].map((m) => m[1]);
  } catch { /* nav config optional */ }
  const navSet = new Set(navLinks.map((h) => h.split('?')[0]));
  for (const r of routes) r.inNav = navSet.has(r.path);

  return {
    generated: new Date().toISOString().slice(0, 10),
    source: 'apps/web/src/app/app/**/page.tsx + lib/nav-config.ts',
    totals: { routes: routes.length, inNav: routes.filter((r) => r.inNav).length, orphaned: routes.filter((r) => !r.inNav).length },
    routes,
  };
}

// ── 3. Event registry ───────────────────────────────────────────────────────

function buildEventRegistry() {
  const publishers = new Map(); // event -> Set<file>
  const subscribers = new Map();

  for (const file of walk(SERVER_SRC, (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(SERVER_SRC, file).replace(/\\/g, '/');
    for (const m of text.matchAll(/\.emit(?:Async)?\(\s*['"]([a-zA-Z0-9._:-]+)['"]/g)) {
      if (!publishers.has(m[1])) publishers.set(m[1], new Set());
      publishers.get(m[1]).add(rel);
    }
    for (const m of text.matchAll(/@OnEvent\(\s*['"]([a-zA-Z0-9._:-]+)['"]/g)) {
      if (!subscribers.has(m[1])) subscribers.set(m[1], new Set());
      subscribers.get(m[1]).add(rel);
    }
  }

  const names = [...new Set([...publishers.keys(), ...subscribers.keys()])].sort();
  const events = names.map((name) => ({
    event: name,
    publishers: [...(publishers.get(name) ?? [])].sort(),
    subscribers: [...(subscribers.get(name) ?? [])].sort(),
    status: publishers.has(name) && subscribers.has(name) ? 'flowing' : publishers.has(name) ? 'published-only' : 'listened-only',
  }));

  return {
    generated: new Date().toISOString().slice(0, 10),
    source: ".emit() and @OnEvent() across apps/server/src",
    totals: {
      events: events.length,
      flowing: events.filter((e) => e.status === 'flowing').length,
      publishedOnly: events.filter((e) => e.status === 'published-only').length,
      listenedOnly: events.filter((e) => e.status === 'listened-only').length,
    },
    events,
  };
}

// ── 4. Capability registry ──────────────────────────────────────────────────

function buildCapabilityRegistry() {
  const registryPath = path.join(ROOT, 'apps/server/dist/modules/ai/flow-tool-registry.js');
  const { FLOW_TOOLS } = require(registryPath);
  const capabilities = FLOW_TOOLS.map((tool) => ({
    name: tool.name,
    family: tool.family ?? 'unknown',
    riskTier: tool.riskTier ?? (tool.riskLevel === 'high' ? 3 : tool.riskLevel === 'medium' ? 2 : 1),
    riskLevel: tool.riskLevel ?? 'low',
    manualRoute: tool.manualEquivalentRoute ?? null,
    changedEntities: tool.changedEntities ?? [],
  }));
  capabilities.sort((a, b) => a.name.localeCompare(b.name));
  const byFamily = {};
  for (const c of capabilities) byFamily[c.family] = (byFamily[c.family] ?? 0) + 1;
  return {
    generated: new Date().toISOString().slice(0, 10),
    source: 'apps/server FLOW_TOOLS (compiled flow-tool-registry)',
    totals: { capabilities: capabilities.length, byFamily },
    capabilities,
  };
}

// ── 5. Data ownership ───────────────────────────────────────────────────────

function buildDataOwnership() {
  const schema = fs.readFileSync(path.join(ROOT, 'packages/db/prisma/schema.prisma'), 'utf8');
  const models = [...schema.matchAll(/^model (\w+)/gm)].map((m) => m[1]);

  // Count which module directories reference each model via prisma client calls.
  const refs = new Map(); // model -> Map<moduleDir, count>
  for (const file of walk(SERVER_SRC, (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))) {
    const rel = path.relative(SERVER_SRC, file).replace(/\\/g, '/');
    const moduleDir = rel.startsWith('modules/') ? rel.split('/')[1] : `core/${rel.split('/')[1] ?? rel}`;
    const text = fs.readFileSync(file, 'utf8');
    for (const model of models) {
      const camel = model[0].toLowerCase() + model.slice(1);
      const hits = text.split(`client.${camel}.`).length - 1;
      if (hits > 0) {
        if (!refs.has(model)) refs.set(model, new Map());
        const bucket = refs.get(model);
        bucket.set(moduleDir, (bucket.get(moduleDir) ?? 0) + hits);
      }
    }
  }

  const entries = models.sort().map((model) => {
    const bucket = refs.get(model) ?? new Map();
    const ranked = [...bucket.entries()].sort((a, b) => b[1] - a[1]);
    return {
      model,
      owner: ranked[0]?.[0] ?? 'unassigned',
      referenceCount: ranked.reduce((sum, [, n]) => sum + n, 0),
      topConsumers: ranked.slice(0, 3).map(([mod, n]) => `${mod} (${n})`),
    };
  });

  return {
    generated: new Date().toISOString().slice(0, 10),
    source: 'packages/db/prisma/schema.prisma + prisma.client.<model> usage across server src',
    note: 'owner = module with the most direct client references (approximation of canonical ownership)',
    totals: { models: entries.length, unassigned: entries.filter((e) => e.owner === 'unassigned').length },
    models: entries,
  };
}

// ── main ────────────────────────────────────────────────────────────────────

fs.mkdirSync(OUT_DIR, { recursive: true });
writeYaml('module-registry.yaml', '# Auto-generated by scripts/architecture/generate-registries.js — do not edit by hand.', buildModuleRegistry());
writeYaml('route-registry.yaml', '# Auto-generated by scripts/architecture/generate-registries.js — do not edit by hand.', buildRouteRegistry());
writeYaml('event-registry.yaml', '# Auto-generated by scripts/architecture/generate-registries.js — do not edit by hand.', buildEventRegistry());
writeYaml('capability-registry.yaml', '# Auto-generated by scripts/architecture/generate-registries.js — do not edit by hand.', buildCapabilityRegistry());
writeYaml('data-ownership.yaml', '# Auto-generated by scripts/architecture/generate-registries.js — do not edit by hand.', buildDataOwnership());
console.log('Stage 0 registries generated.');
