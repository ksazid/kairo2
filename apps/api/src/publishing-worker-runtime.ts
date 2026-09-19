export interface PublishingRunOncePort {
  runOnce(): Promise<boolean>;
}

export async function runPublishingTick(runner: PublishingRunOncePort, maxJobsPerTick: number): Promise<number> {
  if (!Number.isInteger(maxJobsPerTick) || maxJobsPerTick < 1 || maxJobsPerTick > 20) throw new Error("maxJobsPerTick is invalid");
  let processed = 0;
  while (processed < maxJobsPerTick) {
    if (!(await runner.runOnce())) break;
    processed += 1;
  }
  return processed;
}
