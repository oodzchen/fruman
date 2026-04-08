function mixHash(value: number): number {
  let v = value | 0
  v = Math.imul(v ^ (v >>> 16), 0x45d9f3b)
  v = Math.imul(v ^ (v >>> 16), 0x45d9f3b)
  return (v ^ (v >>> 16)) >>> 0
}

function hash3(seed: number, a: number, b: number, c: number): number {
  const mixed =
    mixHash(seed) ^
    Math.imul(mixHash(a), 0x9e3779b1) ^
    Math.imul(mixHash(b), 0x85ebca6b) ^
    Math.imul(mixHash(c), 0xc2b2ae35)
  return mixHash(mixed)
}

function hashOffset(
  seed: number,
  a: number,
  b: number,
  c: number,
  span: number
) {
  if (span <= 0) {
    return 0
  }
  const value = hash3(seed, a, b, c)
  const max = span * 2 + 1
  return (value % max) - span
}

export interface TerrainPathTarget {
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  closePath(): void
}

export function appendTerrainCellPath(
  ctx: TerrainPathTarget,
  cellX: number,
  cellY: number,
  cellSizeUnits: number,
  randomSeed: number
): void {
  const size = Math.max(1, cellSizeUnits)
  const half = size * 0.5
  const baseX = cellX * size
  const baseY = cellY * size
  const cornerJitter = Math.max(1, Math.floor(size / 8))
  const edgeJitter = Math.max(1, Math.floor(size / 10))

  const tlX = baseX + hashOffset(randomSeed, cellX, cellY, 0, cornerJitter)
  const tlY = baseY + hashOffset(randomSeed, cellX, cellY, 1, cornerJitter)
  const trX =
    baseX + size + hashOffset(randomSeed, cellX + 1, cellY, 0, cornerJitter)
  const trY = baseY + hashOffset(randomSeed, cellX + 1, cellY, 1, cornerJitter)
  const brX =
    baseX + size + hashOffset(randomSeed, cellX + 1, cellY + 1, 0, cornerJitter)
  const brY =
    baseY + size + hashOffset(randomSeed, cellX + 1, cellY + 1, 1, cornerJitter)
  const blX = baseX + hashOffset(randomSeed, cellX, cellY + 1, 0, cornerJitter)
  const blY =
    baseY + size + hashOffset(randomSeed, cellX, cellY + 1, 1, cornerJitter)

  const topMidX = baseX + half
  const topMidY = baseY + hashOffset(randomSeed, cellX, cellY, 2, edgeJitter)
  const rightMidX =
    baseX + size + hashOffset(randomSeed, cellX + 1, cellY, 3, edgeJitter)
  const rightMidY = baseY + half
  const bottomMidX = baseX + half
  const bottomMidY =
    baseY + size + hashOffset(randomSeed, cellX, cellY + 1, 2, edgeJitter)
  const leftMidX = baseX + hashOffset(randomSeed, cellX, cellY, 3, edgeJitter)
  const leftMidY = baseY + half

  ctx.moveTo(tlX, tlY)
  ctx.lineTo(topMidX, topMidY)
  ctx.lineTo(trX, trY)
  ctx.lineTo(rightMidX, rightMidY)
  ctx.lineTo(brX, brY)
  ctx.lineTo(bottomMidX, bottomMidY)
  ctx.lineTo(blX, blY)
  ctx.lineTo(leftMidX, leftMidY)
  ctx.closePath()
}

export function getTerrainPaletteIndex(
  randomSeed: number,
  cellX: number,
  cellY: number,
  materialCode: number,
  paletteLength: number
): number {
  if (paletteLength <= 1) {
    return 0
  }
  return hash3(randomSeed, cellX, cellY, materialCode) % paletteLength
}
