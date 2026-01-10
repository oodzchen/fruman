import type { Entity } from './Entity'

type CellData = {
  entities: Set<Entity>
  frameNumber: number
}

export class SpatialHash {
  private cellSize: number
  private grid = new Map<string, CellData>()
  private queryResultCache: Entity[] = []
  private queryResultSet = new Set<Entity>()
  private keyCache = new Map<number, Map<number, string>>()
  private currentFrame = 0
  private entityCellCache = new Map<number, string>()

  constructor(cellSize = 5) {
    this.cellSize = cellSize
  }

  beginFrame(): void {
    this.currentFrame++
  }

  update(entities: Entity[]): void {
    this.beginFrame()

    for (const entity of entities) {
      if (!entity.transform) continue

      const x = entity.transform.x
      const y = entity.transform.y
      const key = this.getKey(x, y)

      const prevKey = this.entityCellCache.get(entity.id)

      if (prevKey === key) {
        const cellData = this.grid.get(key)
        if (cellData && cellData.frameNumber === this.currentFrame) {
          cellData.entities.add(entity)
          continue
        }
      }

      if (prevKey) {
        const cellData = this.grid.get(prevKey)
        if (cellData) {
          cellData.entities.delete(entity)
        }
      }

      let cellData = this.grid.get(key)
      if (!cellData) {
        cellData = { entities: new Set(), frameNumber: this.currentFrame }
        this.grid.set(key, cellData)
      } else {
        if (cellData.frameNumber !== this.currentFrame) {
          cellData.entities.clear()
          cellData.frameNumber = this.currentFrame
        }
      }

      cellData.entities.add(entity)
      this.entityCellCache.set(entity.id, key)
    }
  }

  removeEntity(entity: Entity): void {
    const key = this.entityCellCache.get(entity.id)
    if (!key) return
    const cellData = this.grid.get(key)
    if (cellData) {
      cellData.entities.delete(entity)
      if (cellData.entities.size === 0) {
        this.grid.delete(key)
      }
    }
    this.entityCellCache.delete(entity.id)
  }

  query(x: number, y: number, radius: number): Entity[] {
    const minX = x - radius
    const maxX = x + radius
    const minY = y - radius
    const maxY = y + radius

    const startCellX = Math.floor(minX / this.cellSize)
    const endCellX = Math.floor(maxX / this.cellSize)
    const startCellY = Math.floor(minY / this.cellSize)
    const endCellY = Math.floor(maxY / this.cellSize)

    this.queryResultSet.clear()

    for (let cellX = startCellX; cellX <= endCellX; cellX++) {
      for (let cellY = startCellY; cellY <= endCellY; cellY++) {
        const key = this.getKeyCached(cellX, cellY)
        const cellData = this.grid.get(key)
        if (cellData && cellData.frameNumber === this.currentFrame) {
          for (const entity of cellData.entities) {
            this.queryResultSet.add(entity)
          }
        }
      }
    }

    this.queryResultCache.length = 0
    for (const entity of this.queryResultSet) {
      this.queryResultCache.push(entity)
    }

    return this.queryResultCache
  }

  private getKey(x: number, y: number): string {
    const cellX = Math.floor(x / this.cellSize)
    const cellY = Math.floor(y / this.cellSize)
    return this.getKeyCached(cellX, cellY)
  }

  private getKeyCached(cellX: number, cellY: number): string {
    let xMap = this.keyCache.get(cellX)
    if (!xMap) {
      xMap = new Map()
      this.keyCache.set(cellX, xMap)
    }

    let key = xMap.get(cellY)
    if (key === undefined) {
      key = `${cellX},${cellY}`
      xMap.set(cellY, key)
    }

    return key
  }
}
