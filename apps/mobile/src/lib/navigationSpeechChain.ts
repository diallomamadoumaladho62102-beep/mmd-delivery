/**
 * Serialize TTS start/stop so a Speech.stop() that began for an older
 * instruction cannot resolve after the next Speech.speak() and cancel it.
 */
export function createSpeechChain() {
  let chain: Promise<void> = Promise.resolve();

  return {
    enqueue(op: () => Promise<void>): Promise<void> {
      const run = chain.then(op, op);
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}
