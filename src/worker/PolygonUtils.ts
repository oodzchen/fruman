export interface WorldPoint {
  x: number
  y: number
}

export function computeRectWorldVertices(
  centerX: number,
  centerY: number,
  halfWidth: number,
  halfHeight: number,
  rotationRad: number,
  target?: WorldPoint[]
): WorldPoint[] {
  const cos = Math.cos(rotationRad)
  const sin = Math.sin(rotationRad)
  const world =
    target && target.length >= 4
      ? target
      : [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ]
  world.length = 4

  writeRectWorldVertex(
    world[0],
    centerX,
    centerY,
    -halfWidth,
    -halfHeight,
    cos,
    sin
  )
  writeRectWorldVertex(
    world[1],
    centerX,
    centerY,
    halfWidth,
    -halfHeight,
    cos,
    sin
  )
  writeRectWorldVertex(
    world[2],
    centerX,
    centerY,
    halfWidth,
    halfHeight,
    cos,
    sin
  )
  writeRectWorldVertex(
    world[3],
    centerX,
    centerY,
    -halfWidth,
    halfHeight,
    cos,
    sin
  )
  return world
}

function writeRectWorldVertex(
  target: WorldPoint,
  centerX: number,
  centerY: number,
  localX: number,
  localY: number,
  cos: number,
  sin: number
): void {
  target.x = centerX + localX * cos - localY * sin
  target.y = centerY + localX * sin + localY * cos
}
