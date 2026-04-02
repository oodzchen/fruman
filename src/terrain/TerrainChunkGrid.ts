import type {
  MapTerrainChunk,
  TerrainChunkLike,
  TerrainDataLike,
} from './TerrainTypes'

export interface TerrainGridChunk extends TerrainChunkLike {
  cells: Uint8Array
  filledCellCount: number
}

export class TerrainChunkGrid {
  private readonly chunks = new Map<string, TerrainGridChunk>()
  private readonly chunkList: TerrainGridChunk[] = []
  private chunkSize: number

  constructor(chunkSize: number) {
    this.chunkSize = Math.max(1, chunkSize | 0)
  }

  clear(): void {
    this.chunks.clear()
    this.chunkList.length = 0
  }

  getChunkSize(): number {
    return this.chunkSize
  }

  setChunkSize(chunkSize: number): void {
    this.chunkSize = Math.max(1, chunkSize | 0)
    this.clear()
  }

  hasCells(): boolean {
    return this.chunkList.length > 0
  }

  getChunks(): readonly TerrainGridChunk[] {
    return this.chunkList
  }

  getCellMaterialCode(cellX: number, cellY: number): number {
    const chunk = this.getChunkForCell(cellX, cellY)
    if (!chunk) {
      return 0
    }
    const localX = this.getPositiveModulo(cellX, this.chunkSize)
    const localY = this.getPositiveModulo(cellY, this.chunkSize)
    return chunk.cells[localY * this.chunkSize + localX] | 0
  }

  isCellSolid(cellX: number, cellY: number): boolean {
    return this.getCellMaterialCode(cellX, cellY) > 0
  }

  setCellMaterialCode(cellX: number, cellY: number, code: number): boolean {
    const chunkX = Math.floor(cellX / this.chunkSize)
    const chunkY = Math.floor(cellY / this.chunkSize)
    const localX = this.getPositiveModulo(cellX, this.chunkSize)
    const localY = this.getPositiveModulo(cellY, this.chunkSize)
    const cellIndex = localY * this.chunkSize + localX
    const existingChunk = this.getChunk(chunkX, chunkY)
    const existingCode = existingChunk ? existingChunk.cells[cellIndex] | 0 : 0
    if (existingCode === code) {
      return false
    }
    if (!existingChunk && code === 0) {
      return false
    }

    const chunk = existingChunk ?? this.createChunk(chunkX, chunkY)
    chunk.cells[cellIndex] = code
    if (existingCode === 0 && code > 0) {
      chunk.filledCellCount += 1
    } else if (existingCode > 0 && code === 0) {
      chunk.filledCellCount -= 1
      if (chunk.filledCellCount <= 0) {
        this.removeChunk(chunk)
      }
    }
    return true
  }

  loadSerializedChunks(chunks: ReadonlyArray<TerrainChunkLike>): void {
    this.clear()
    const cellCount = this.chunkSize * this.chunkSize
    for (let i = 0; i < chunks.length; i++) {
      const source = chunks[i]
      const chunk: TerrainGridChunk = {
        chunkX: source.chunkX | 0,
        chunkY: source.chunkY | 0,
        cells: new Uint8Array(cellCount),
        filledCellCount: 0,
      }
      const sourceLength = Math.min(source.cells.length, cellCount)
      for (let cellIndex = 0; cellIndex < sourceLength; cellIndex++) {
        const code = source.cells[cellIndex] | 0
        chunk.cells[cellIndex] = code
        if (code > 0) {
          chunk.filledCellCount += 1
        }
      }
      if (chunk.filledCellCount > 0) {
        this.chunks.set(this.getChunkKey(chunk.chunkX, chunk.chunkY), chunk)
        this.chunkList.push(chunk)
      }
    }
  }

  serializeChunks(): MapTerrainChunk[] {
    const chunks = new Array<MapTerrainChunk>(this.chunkList.length)
    for (let i = 0; i < this.chunkList.length; i++) {
      const chunk = this.chunkList[i]
      chunks[i] = {
        chunkX: chunk.chunkX,
        chunkY: chunk.chunkY,
        cells: Array.from(chunk.cells),
      }
    }
    return chunks
  }

  buildDataView(
    version: number,
    cellSize: number,
    randomSeed: number
  ): TerrainDataLike {
    return {
      version,
      cellSize,
      chunkSize: this.chunkSize,
      randomSeed,
      chunks: this.chunkList,
    }
  }

  private getChunkForCell(
    cellX: number,
    cellY: number
  ): TerrainGridChunk | null {
    const chunkX = Math.floor(cellX / this.chunkSize)
    const chunkY = Math.floor(cellY / this.chunkSize)
    return this.getChunk(chunkX, chunkY)
  }

  private getChunk(chunkX: number, chunkY: number): TerrainGridChunk | null {
    return this.chunks.get(this.getChunkKey(chunkX, chunkY)) ?? null
  }

  private createChunk(chunkX: number, chunkY: number): TerrainGridChunk {
    const chunk: TerrainGridChunk = {
      chunkX,
      chunkY,
      cells: new Uint8Array(this.chunkSize * this.chunkSize),
      filledCellCount: 0,
    }
    this.chunks.set(this.getChunkKey(chunkX, chunkY), chunk)
    this.chunkList.push(chunk)
    return chunk
  }

  private removeChunk(chunk: TerrainGridChunk): void {
    this.chunks.delete(this.getChunkKey(chunk.chunkX, chunk.chunkY))
    const chunkIndex = this.chunkList.indexOf(chunk)
    if (chunkIndex !== -1) {
      this.chunkList.splice(chunkIndex, 1)
    }
  }

  private getChunkKey(chunkX: number, chunkY: number): string {
    return `${chunkX}:${chunkY}`
  }

  private getPositiveModulo(value: number, divisor: number): number {
    const modulo = value % divisor
    return modulo < 0 ? modulo + divisor : modulo
  }
}
