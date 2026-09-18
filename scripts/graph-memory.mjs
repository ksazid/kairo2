import path from 'node:path';
import { JsonGraphMemoryStore, explainArtifact, getObjectProvenance, reconstructLineage, resolveCurrentNode, validateGraphMemoryState } from '../src/graph-memory.mjs';
import { JsonRatchetRunStore } from '../src/run-store.mjs';
import { toGraphUpdate } from '../src/ratchet-engine.mjs';

const [command, ...args] = process.argv.slice(2);
const store = new JsonGraphMemoryStore(path.resolve('state/graph.json'));
const output = value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

switch (command) {
  case 'validate': {
    const state = store.load();
    validateGraphMemoryState(state, { requireObjectProvenance: true });
    output({ ok: true, revision: state.revision, nodes: state.nodes.length, edges: state.edges.length, events: state.events.length });
    break;
  }
  case 'current': {
    const [nodeId] = args;
    if (!nodeId) usage();
    output(resolveCurrentNode(store.load(), nodeId));
    break;
  }
  case 'lineage': {
    const [nodeId] = args;
    if (!nodeId) usage();
    output(reconstructLineage(store.load(), nodeId));
    break;
  }
  case 'provenance': {
    const [objectId] = args;
    if (!objectId) usage();
    output(getObjectProvenance(store.load(), objectId));
    break;
  }
  case 'explain': {
    const [artifactId] = args;
    if (!artifactId) usage();
    output(explainArtifact(store.load(), artifactId));
    break;
  }
  case 'publish-attempt': {
    const [runId, attemptId] = args;
    if (!runId || !attemptId) usage();
    const runStore = new JsonRatchetRunStore('state/ratchet-runs.json');
    const run = runStore.load(runId);
    if (!run) throw new Error(`Unknown ratchet run: ${runId}`);
    const result = store.append(toGraphUpdate(run, attemptId), {
      actorId: 'ratchet-engine',
      runId: attemptId,
      reason: `Publish finalized ratchet attempt ${attemptId}`
    });
    output({ changed: result.changed, revision: result.state.revision, event: result.event });
    break;
  }
  default:
    usage();
}

function usage() {
  console.error('Usage: npm run graph:memory -- <validate|current|lineage|provenance|explain|publish-attempt> <id...>');
  process.exit(2);
}
