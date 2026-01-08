import type { Entity } from './Entity'
import { EntityManager } from './EntityManager'
import type { System } from './System'

export class World {
  private entityManager = new EntityManager()
  private systems: System[] = []

  createEntity(): Entity {
    return this.entityManager.createEntity()
  }

  destroyEntity(entity: Entity): void {
    this.entityManager.destroyEntity(entity)
  }

  addSystem(system: System): void {
    this.systems.push(system)
  }

  update(deltaTime: number): void {
    const entities = this.entityManager.getEntities()

    for (const system of this.systems) {
      const matchingEntities = entities.filter((entity) =>
        system.matches(entity)
      )
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
