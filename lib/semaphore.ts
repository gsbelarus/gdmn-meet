export class Semaphore {
  private readonly capacity: number;
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(capacity = 1) {
    this.capacity = capacity;
  }

  async acquire(): Promise<void> {
    await new Promise<void>((resolve) => {
      const tryAcquire = () => {
        if (this.active < this.capacity) {
          this.active += 1;
          resolve();
          return;
        }

        this.queue.push(tryAcquire);
      };

      tryAcquire();
    });
  }

  release() {
    if (this.active === 0) {
      return;
    }

    this.active -= 1;
    const next = this.queue.shift();
    next?.();
  }
}
