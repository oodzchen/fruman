import type { Entity } from './Entity'

export interface EntityComponentPool {
  releaseEntityComponents(entity: Entity): void
  reset(): void
}
