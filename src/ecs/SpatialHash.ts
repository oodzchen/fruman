import type { Entity } from './Entity'

export class SpatialHash {
  private cellSize: number
  private grid = new Map<string, Entity[]>()

  constructor(cellSize = 5) {
    this.cellSize = cellSize
  }

  clear(): void {
    this.grid.clear()
  }

  insert(entity: Entity, x: number, y: number): void {
    const key = this.getKey(x, y)
    if (!this.grid.has(key)) {
      this.grid.set(key, [])
    }
    this.grid.get(key)!.push(entity)
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

    const results = new Set<Entity>()

    for (let cellX = startCellX; cellX <= endCellX; cellX++) {
      for (let cellY = startCellY; cellY <= endCellY; cellY++) {
        const key = `${cellX},${cellY}`
        const entities = this.grid.get(key)
        if (entities) {
          for (const entity of entities) {
            results.add(entity)
          }
        }
      }
    }

    return Array.from(results)
  }

  private getKey(x: number, y: number): string {
    const cellX = Math.floor(x / this.cellSize)
    const cellY = Math.floor(y / this.cellSize)
    return `${cellX},${cellY}`
  }
}
