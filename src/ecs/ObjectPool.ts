export class ObjectPool<T> {
  private pool: T[] = []
  private factory: () => T
  private reset: (obj: T) => void

  constructor(factory: () => T, reset: (obj: T) => void, initialSize = 0) {
    this.factory = factory
    this.reset = reset

    for (let i = 0; i < initialSize; i++) {
      this.pool.push(factory())
    }
  }

  acquire(): T {
    if (this.pool.length > 0) {
      return this.pool.pop()!
    }
    return this.factory()
  }

  release(obj: T): void {
    this.reset(obj)
    this.pool.push(obj)
  }

  getPoolSize(): number {
    return this.pool.length
  }
}
