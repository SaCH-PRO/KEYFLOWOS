#!/usr/bin/env node
import fs from 'node:fs';
import { parseYaml } from './lib/yaml.mjs';
import { validateUnlockContract } from './lib/unlock-contract.mjs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/agent-control/validate-unlock-contract.mjs <contract.yaml>');
  process.exit(2);
}

let contract;
try {
  contract = parseYaml(fs.readFileSync(file,'utf8'));
} catch (error) {
  console.error(JSON.stringify({ok:false, problems:[{code:'CONTRACT_UNREADABLE', detail:String(error?.message || error)}]}, null, 2));
  process.exit(1);
}

const verdict = validateUnlockContract(contract);
console.log(JSON.stringify(verdict,null,2));
if (!verdict.ok) process.exit(1);
