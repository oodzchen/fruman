import { Entity } from './Entity'
import { ObjectPool } from './ObjectPool'

export class EntityManager {
  private entities: Entity[] = []
  private entitiesToRemove: Entity[] = []
  private entityIndexMap = new Map<number, number>()
  private entityPool: ObjectPool<Entity>

  constructor() {
    this.entityPool = new ObjectPool<Entity>(
      () => new Entity(),
      (entity) => entity.reset(),
      10
    )
  }

  createEntity(): Entity {
    let entity = this.entityPool.acquire()
    if (typeof entity.renewId === 'function') {
      entity.renewId()
    } else {
      entity = new Entity()
    }
    const index = this.entities.length
    this.entities.push(entity)
    this.entityIndexMap.set(entity.id, index)
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
        const index = this.entityIndexMap.get(entity.id)
        if (index !== undefined) {
          const lastIndex = this.entities.length - 1

          if (index !== lastIndex) {
            const lastEntity = this.entities[lastIndex]
            this.entities[index] = lastEntity
            this.entityIndexMap.set(lastEntity.id, index)
          }

          this.entities.pop()
          this.entityIndexMap.delete(entity.id)
          this.entityPool.release(entity)
        }
      }

      this.entitiesToRemove.length = 0
    }
  }

  clear(): void {
    this.entities.length = 0
    this.entitiesToRemove.length = 0
    this.entityIndexMap.clear()
  }
}
