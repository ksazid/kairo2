import fs from 'node:fs';
import path from 'node:path';
import { invariant } from './core.mjs';

export class JsonRatchetRunStore {
  constructor(filePath) {
    invariant(typeof filePath === 'string' && filePath, 'filePath is required');
    this.filePath = path.resolve(filePath);
  }

  loadAll() {
    if (!fs.existsSync(this.filePath)) return { schemaVersion: 1, runs: [] };
    const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    invariant(parsed && parsed.schemaVersion === 1 && Array.isArray(parsed.runs), 'Invalid ratchet run store');
    return parsed;
  }

  load(runId) {
    const run = this.loadAll().runs.find(item => item.id === runId);
    return run ? structuredClone(run) : null;
  }

  save(run) {
    invariant(run && typeof run.id === 'string' && run.id, 'Run with id is required');
    const state = this.loadAll();
    const index = state.runs.findIndex(item => item.id === run.id);
    if (index >= 0) state.runs[index] = structuredClone(run);
    else state.runs.push(structuredClone(run));

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    fs.renameSync(temp, this.filePath);
    return structuredClone(run);
  }
}
