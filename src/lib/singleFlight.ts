/** Runs one task at a time; a call made while a task is pending is dropped, not queued. */
export function createSingleFlight() {
  let pending = false;

  return async function run(task: () => Promise<void>): Promise<void> {
    if (pending) return;
    pending = true;
    try {
      await task();
    } finally {
      pending = false;
    }
  };
}
