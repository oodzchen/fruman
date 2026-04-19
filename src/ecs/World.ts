import type { Entity } from './Entity'
import type { EntityComponentPool } from './EntityComponentPool'
import { EntityManager } from './EntityManager'
import type { System } from './System'

export class World {
  private entityManager = new EntityManager()
  private systems: System[] = []
  private systemEntityCache = new Map<System, Entity[]>()
  private systemPerfNames: string[] = []
  private systemPerfLastUs: number[] = []
  private cacheNeedsRebuild = true

  createEntity(): Entity {
    this.cacheNeedsRebuild = true
    return this.entityManager.createEntity()
  }

  setComponentPool(componentPool: EntityComponentPool): void {
    this.entityManager.setComponentPool(componentPool)
  }

  destroyEntity(entity: Entity): void {
    this.cacheNeedsRebuild = true
    this.entityManager.destroyEntity(entity)
  }

  addSystem(system: System): void {
    this.systems.push(system)
    this.systemPerfNames.push(system.constructor.name || 'System')
    this.systemPerfLastUs.push(0)
    this.cacheNeedsRebuild = true
  }

  markCacheDirty(): void {
    this.cacheNeedsRebuild = true
  }

  private rebuildCache(): void {
    const entities = this.entityManager.getEntities()

    for (const system of this.systems) {
      let matchingEntities = this.systemEntityCache.get(system)
      if (!matchingEntities) {
        matchingEntities = []
        this.systemEntityCache.set(system, matchingEntities)
      } else {
        matchingEntities.length = 0
      }

      for (const entity of entities) {
        if (system.matches(entity)) {
          matchingEntities.push(entity)
        }
      }
    }

    this.cacheNeedsRebuild = false
  }

  update(deltaTime: number): void {
    if (this.cacheNeedsRebuild) {
      this.rebuildCache()
    }

    for (let i = 0; i < this.systems.length; i++) {
      const system = this.systems[i]
      const matchingEntities = this.systemEntityCache.get(system) || []
      const startMs = performance.now()
      system.update(matchingEntities, deltaTime)
      this.systemPerfLastUs[i] = Math.round(
        (performance.now() - startMs) * 1000
      )
    }

    this.entityManager.update()
  }

  getSystemPerfNames(): readonly string[] {
    return this.systemPerfNames
  }

  getSystemPerfLastUs(): readonly number[] {
    return this.systemPerfLastUs
  }

  getEntities(): Entity[] {
    return this.entityManager.getEntities()
  }

  getEntityById(id: number): Entity | undefined {
    return this.entityManager.getEntityById(id)
  }

  clear(): void {
    this.entityManager.clear()
    this.systems = []
    this.systemEntityCache.clear()
    this.systemPerfNames = []
    this.systemPerfLastUs = []
    this.cacheNeedsRebuild = true
  }
}
