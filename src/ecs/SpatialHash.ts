import type { Entity } from './Entity'

export class SpatialHash {
  private cellSize: number
  private invCellSize: number
  private grid = new Map<number, Entity[]>()
  private cellPool: Entity[][] = []
  private queryResult: Entity[] = []
  private queryResultLength = 0

  constructor(cellSize = 5) {
    this.cellSize = cellSize
    this.invCellSize = 1 / cellSize
    for (let i = 0; i < 64; i++) {
      this.cellPool.push([])
    }
  }

  update(entities: Entity[]): void {
    for (const cell of this.grid.values()) {
      cell.length = 0
      this.cellPool.push(cell)
    }
    this.grid.clear()

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]
      if (!entity.transform) continue

      const key = this.getKey(entity.transform.x, entity.transform.y)
      let cell = this.grid.get(key)
      if (!cell) {
        cell = this.cellPool.length > 0 ? this.cellPool.pop()! : []
        this.grid.set(key, cell)
      }
      cell.push(entity)
    }
  }

  removeEntity(_entity: Entity): void {}

  query(x: number, y: number, radius: number): Entity[] {
    const startCellX = Math.floor((x - radius) * this.invCellSize)
    const endCellX = Math.floor((x + radius) * this.invCellSize)
    const startCellY = Math.floor((y - radius) * this.invCellSize)
    const endCellY = Math.floor((y + radius) * this.invCellSize)

    this.queryResultLength = 0

    for (let cellX = startCellX; cellX <= endCellX; cellX++) {
      for (let cellY = startCellY; cellY <= endCellY; cellY++) {
        const key = this.computeKey(cellX, cellY)
        const cell = this.grid.get(key)
        if (cell) {
          for (let i = 0; i < cell.length; i++) {
            this.queryResult[this.queryResultLength++] = cell[i]
          }
        }
      }
    }

    return this.queryResult
  }

  getQueryResultLength(): number {
    return this.queryResultLength
  }

  private getKey(x: number, y: number): number {
    const cellX = Math.floor(x * this.invCellSize)
    const cellY = Math.floor(y * this.invCellSize)
    return this.computeKey(cellX, cellY)
  }

  private computeKey(cellX: number, cellY: number): number {
    return ((cellX + 32768) << 16) | ((cellY + 32768) & 0xffff)
  }
}
