// Fails the build if a framework-free package imports React (ADR-001, condition 1).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const FREE = ['contract', 'engine', 'state', 'mock', 'access', 'proposals'];
const bad = [];
const walk = (dir) => { for (const f of readdirSync(dir)) { const p = join(dir, f);
  if (statSync(p).isDirectory()) walk(p);
  else if (/\.(ts|tsx|js|mjs)$/.test(f) && /from\s+['"](react|react-dom)(\/[^'"]*)?['"]|require\(['"]react/.test(readFileSync(p, 'utf8'))) bad.push(p); } };
for (const pkg of FREE) { try { walk(join('packages', pkg, 'src')); } catch { /* package not created yet */ } }
if (bad.length) { console.error('React imported in framework-free packages:\n  ' + bad.join('\n  ')); process.exit(1); }
console.log('Boundaries OK: no React in ' + FREE.join(', '));
