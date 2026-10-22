import { describe, expect, it, vi } from "vitest";
import { createSingleFlight } from "./singleFlight";

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createSingleFlight", () => {
  it("drops a call made while the first task is still pending", async () => {
    const run = createSingleFlight();
    const first = deferred();
    const second = vi.fn(async () => undefined);

    const running = run(() => first.promise);
    await run(second);
    expect(second).not.toHaveBeenCalled();

    first.resolve();
    await running;
    expect(second).not.toHaveBeenCalled();
  });

  it("accepts the next call once the first task resolves", async () => {
    const run = createSingleFlight();
    const next = vi.fn(async () => undefined);

    await run(async () => undefined);
    await run(next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("accepts the next call after the first task rejects, and passes the rejection to its caller", async () => {
    const run = createSingleFlight();
    const first = deferred();
    const next = vi.fn(async () => undefined);

    const running = run(() => first.promise);
    first.reject(new Error("storage failed"));
    await expect(running).rejects.toThrow("storage failed");

    await run(next);
    expect(next).toHaveBeenCalledOnce();
  });
});
