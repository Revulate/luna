import fs from 'fs';
import { execSync } from 'child_process';

const files = fs.readdirSync('.').filter(f => f.startsWith('isolate-') && f.endsWith('.log'));
if (files.length === 0) {
  console.error('No isolate files found');
  process.exit(1);
}

const mostRecent = files.reduce((a, b) => (fs.statSync(a).mtime > fs.statSync(b).mtime ? a : b));
execSync(`node --prof-process ${mostRecent} > processed.txt`, { stdio: 'inherit' });