import type { Entity } from './Entity'
import { EntityManager } from './EntityManager'
import type { System } from './System'

export class World {
  private entityManager = new EntityManager()
  private systems: System[] = []
  private systemEntityCache = new Map<System, Entity[]>()
  private cacheNeedsRebuild = true

  createEntity(): Entity {
    this.cacheNeedsRebuild = true
    return this.entityManager.createEntity()
  }

  destroyEntity(entity: Entity): void {
    this.cacheNeedsRebuild = true
    this.entityManager.destroyEntity(entity)
  }

  addSystem(system: System): void {
    this.systems.push(system)
    this.cacheNeedsRebuild = true
  }

  markCacheDirty(): void {
    this.cacheNeedsRebuild = true
  }

  private rebuildCache(): void {
    const entities = this.entityManager.getEntities()

    for (const system of this.systems) {
      const matchingEntities = entities.filter((entity) =>
        system.matches(entity)
      )
      this.systemEntityCache.set(system, matchingEntities)
    }

    this.cacheNeedsRebuild = false
  }

  update(deltaTime: number): void {
    if (this.cacheNeedsRebuild) {
      this.rebuildCache()
    }

    for (const system of this.systems) {
      const matchingEntities = this.systemEntityCache.get(system) || []
      system.update(matchingEntities, deltaTime)
    }

    this.entityManager.update()
  }

  getEntities(): Entity[] {
    return this.entityManager.getEntities()
  }

  clear(): void {
    this.entityManager.clear()
    this.systems = []
  }
}
