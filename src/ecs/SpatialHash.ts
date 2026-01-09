import type { Entity } from './Entity'

type CellData = {
  entities: Entity[]
  frameNumber: number
}

export class SpatialHash {
  private cellSize: number
  private grid = new Map<string, CellData>()
  private queryResultCache: Entity[] = []
  private queryResultSet = new Set<Entity>()
  private keyCache = new Map<number, Map<number, string>>()
  private currentFrame = 0
  private entityCellCache = new Map<number, string[]>()

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

      const prevKeys = this.entityCellCache.get(entity.id)
      const currentKey = key

      if (prevKeys && prevKeys.length === 1 && prevKeys[0] === currentKey) {
        const cellData = this.grid.get(currentKey)
        if (cellData && cellData.frameNumber === this.currentFrame) {
          continue
        }
      }

      if (prevKeys) {
        for (const oldKey of prevKeys) {
          const cellData = this.grid.get(oldKey)
          if (cellData) {
            const idx = cellData.entities.indexOf(entity)
            if (idx !== -1) {
              cellData.entities.splice(idx, 1)
            }
          }
        }
      }

      let cellData = this.grid.get(key)
      if (!cellData) {
        cellData = { entities: [], frameNumber: this.currentFrame }
        this.grid.set(key, cellData)
      } else {
        if (cellData.frameNumber !== this.currentFrame) {
          cellData.entities.length = 0
          cellData.frameNumber = this.currentFrame
        }
      }

      cellData.entities.push(entity)
      this.entityCellCache.set(entity.id, [key])
    }
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
