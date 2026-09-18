import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { invariant } from './core.mjs';

const SAFE_ID = /^[A-Za-z0-9._-]+$/;

export class FileSnapshotWorkspaceAdapter {
  constructor({ root, checkpointDir = '.engineering/checkpoints' }) {
    invariant(typeof root === 'string' && root, 'root is required');
    this.root = path.resolve(root);
    this.checkpointDir = path.resolve(this.root, checkpointDir);
    invariant(this.checkpointDir.startsWith(`${this.root}${path.sep}`), 'checkpointDir must stay inside root');
  }

  checkpoint(id, relativePaths) {
    invariant(SAFE_ID.test(id), 'Unsafe checkpoint id');
    invariant(Array.isArray(relativePaths) && relativePaths.length > 0, 'relativePaths are required');
    const entries = relativePaths.map(relativePath => {
      const absolute = this.#resolve(relativePath);
      const exists = fs.existsSync(absolute);
      if (!exists) return { path: relativePath, exists: false, contentBase64: null };
      invariant(fs.statSync(absolute).isFile(), `Snapshot path must be a file: ${relativePath}`);
      return { path: relativePath, exists: true, contentBase64: fs.readFileSync(absolute).toString('base64') };
    });

    fs.mkdirSync(this.checkpointDir, { recursive: true });
    const checkpointPath = path.join(this.checkpointDir, `${id}.json`);
    fs.writeFileSync(checkpointPath, `${JSON.stringify({ id, entries }, null, 2)}\n`, 'utf8');
    return checkpointPath;
  }

  restore(checkpointPath) {
    const absoluteCheckpoint = path.resolve(checkpointPath);
    invariant(absoluteCheckpoint.startsWith(`${this.checkpointDir}${path.sep}`), 'Checkpoint is outside configured checkpointDir');
    const snapshot = JSON.parse(fs.readFileSync(absoluteCheckpoint, 'utf8'));
    for (const entry of snapshot.entries) {
      const absolute = this.#resolve(entry.path);
      if (!entry.exists) {
        fs.rmSync(absolute, { force: true });
        continue;
      }
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, Buffer.from(entry.contentBase64, 'base64'));
    }
    return snapshot.id;
  }

  #resolve(relativePath) {
    invariant(typeof relativePath === 'string' && relativePath && !path.isAbsolute(relativePath), 'Snapshot path must be relative');
    const absolute = path.resolve(this.root, relativePath);
    invariant(absolute === this.root || absolute.startsWith(`${this.root}${path.sep}`), `Path escapes workspace: ${relativePath}`);
    return absolute;
  }
}

export class GitWorktreeAdapter {
  constructor({ repoRoot, worktreeRoot, runner = defaultRunner }) {
    invariant(typeof repoRoot === 'string' && repoRoot, 'repoRoot is required');
    invariant(typeof worktreeRoot === 'string' && worktreeRoot, 'worktreeRoot is required');
    invariant(typeof runner === 'function', 'runner must be a function');
    this.repoRoot = path.resolve(repoRoot);
    this.worktreeRoot = path.resolve(worktreeRoot);
    this.runner = runner;
  }

  prepare(attemptId, baseRef = 'HEAD') {
    invariant(SAFE_ID.test(attemptId), 'Unsafe attempt id');
    const worktreePath = path.join(this.worktreeRoot, attemptId);
    fs.mkdirSync(this.worktreeRoot, { recursive: true });
    this.runner('git', ['worktree', 'add', '--detach', worktreePath, baseRef], this.repoRoot);
    return worktreePath;
  }

  checkpoint(worktreePath) {
    return this.runner('git', ['rev-parse', 'HEAD'], path.resolve(worktreePath)).trim();
  }

  restore(checkpointSha, worktreePath) {
    invariant(typeof checkpointSha === 'string' && checkpointSha, 'checkpointSha is required');
    invariant(typeof worktreePath === 'string' && worktreePath, 'worktreePath is required');
    const cwd = path.resolve(worktreePath);
    this.runner('git', ['reset', '--hard', checkpointSha], cwd);
    this.runner('git', ['clean', '-fd'], cwd);
    return checkpointSha;
  }

  keep(worktreePath) {
    return this.checkpoint(worktreePath);
  }

  dispose(worktreePath) {
    this.runner('git', ['worktree', 'remove', '--force', path.resolve(worktreePath)], this.repoRoot);
  }
}

function defaultRunner(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`.trim());
  }
  return result.stdout;
}
