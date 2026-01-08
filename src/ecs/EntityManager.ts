import { Entity } from './Entity'

export class EntityManager {
  private entities: Entity[] = []
  private entitiesToRemove: Entity[] = []

  createEntity(): Entity {
    const entity = new Entity()
    this.entities.push(entity)
    return entity
  }

  destroyEntity(entity: Entity): void {
    this.entitiesToRemove.push(entity)
  }

  getEntities(): Entity[] {
    return this.entities
  }

  update(): void {
    if (this.entitiesToRemove.length > 0) {
      for (const entity of this.entitiesToRemove) {
        const index = this.entities.indexOf(entity)
        if (index !== -1) {
          this.entities.splice(index, 1)
        }
      }
      this.entitiesToRemove = []
    }
  }

  clear(): void {
    this.entities = []
    this.entitiesToRemove = []
  }
}
