import {
  decomp,
  isSimple,
  makeCCW,
  quickDecomp,
  removeCollinearPoints,
  removeDuplicatePoints,
} from 'poly-decomp-es'

import { buildCharacterBodyLocalPoints } from '../characterBodyProfile'
import { DEFAULT_BODY_LINEAR_DAMPING } from '../constants'
import type { MapCharacterBodyProfile } from '../editorMapTypes'
import type { MainModule, b2ShapeId, b2WorldId } from '../types'

type DecompPoint = [number, number]
type DecompPolygon = DecompPoint[]
const DECOMP_POINT_EPSILON = 0.0001
const BOX2D_MAX_POLYGON_VERTICES = 8

export interface CharacterBodyPhysicsConfig {
  x: number
  y: number
  radius: number
  bodyHeight: number
  bodyProfile?: MapCharacterBodyProfile
  density: number
  friction: number
  categoryBits: number
  maskBits: number
}

export interface CharacterBodyPhysicsResult {
  bodyId: ReturnType<MainModule['b2CreateBody']>
  shapeId: b2ShapeId
  shapeIds: b2ShapeId[]
}

export function createCharacterPhysicsBody(
  box2d: MainModule,
  worldId: b2WorldId,
  config: CharacterBodyPhysicsConfig
): CharacterBodyPhysicsResult {
  const {
    b2DefaultBodyDef,
    b2CreateBody,
    b2BodyType,
    b2Capsule,
    b2DefaultShapeDef,
    b2CreateCapsuleShape,
  } = box2d

  const bodyDef = b2DefaultBodyDef()
  bodyDef.type = b2BodyType.b2_dynamicBody
  bodyDef.position.Set(config.x, config.y)
  bodyDef.motionLocks.angularZ = true
  bodyDef.linearDamping = DEFAULT_BODY_LINEAR_DAMPING
  const bodyId = b2CreateBody(worldId, bodyDef)

  const shapeDef = b2DefaultShapeDef()
  shapeDef.density = config.density
  shapeDef.material.friction = config.friction
  shapeDef.filter.categoryBits = config.categoryBits
  shapeDef.filter.maskBits = config.maskBits

  const shapeIds: b2ShapeId[] = []
  const localPoints = buildCharacterBodyLocalPoints(
    config.bodyProfile,
    config.radius,
    config.bodyHeight
  )

  if (
    localPoints &&
    localPoints.length >= 6 &&
    appendCharacterPolygonShapes(box2d, bodyId, shapeDef, localPoints, shapeIds)
  ) {
    bodyDef.delete()
    shapeDef.delete()
    return {
      bodyId,
      shapeId: shapeIds[0],
      shapeIds,
    }
  }

  const shape = new b2Capsule()
  const bodyHeightRadius =
    config.bodyHeight > 0 ? config.bodyHeight / 2 : config.radius
  const capsuleRadius = Math.min(config.radius, bodyHeightRadius)
  const centerHalfDist = Math.max(0, bodyHeightRadius - capsuleRadius)
  shape.center1.Set(0, -centerHalfDist)
  shape.center2.Set(0, centerHalfDist)
  shape.radius = capsuleRadius
  const shapeId = b2CreateCapsuleShape(bodyId, shapeDef, shape)
  shapeIds.push(shapeId)

  bodyDef.delete()
  shape.delete()
  shapeDef.delete()

  return {
    bodyId,
    shapeId,
    shapeIds,
  }
}

function appendCharacterPolygonShapes(
  box2d: MainModule,
  bodyId: ReturnType<MainModule['b2CreateBody']>,
  shapeDef: ReturnType<MainModule['b2DefaultShapeDef']>,
  localPoints: number[],
  outShapeIds: b2ShapeId[]
): boolean {
  const polygon = buildDecompPolygon(localPoints)
  if (!polygon) {
    return false
  }

  let convexPolygons: DecompPolygon[] | null = null
  if (isSimple(polygon)) {
    makeCCW(polygon)
    convexPolygons = quickDecomp(polygon)
    if (!convexPolygons || convexPolygons.length === 0) {
      const exactPolygons = decomp(polygon)
      convexPolygons = exactPolygons === false ? null : exactPolygons
    }
  }
  if (!convexPolygons || convexPolygons.length === 0) {
    return false
  }

  for (let i = 0; i < convexPolygons.length; i++) {
    appendConvexPolygonShape(
      box2d,
      bodyId,
      shapeDef,
      convexPolygons[i],
      outShapeIds
    )
  }

  return outShapeIds.length > 0
}

function buildDecompPolygon(localPoints: number[]): DecompPolygon | null {
  const polygon: DecompPolygon = []
  for (let i = 0; i < localPoints.length; i += 2) {
    polygon.push([localPoints[i], localPoints[i + 1]])
  }
  removeDuplicatePoints(polygon, DECOMP_POINT_EPSILON)
  removeCollinearPoints(polygon, DECOMP_POINT_EPSILON)
  return polygon.length >= 3 ? polygon : null
}

function appendConvexPolygonShape(
  box2d: MainModule,
  bodyId: ReturnType<MainModule['b2CreateBody']>,
  shapeDef: ReturnType<MainModule['b2DefaultShapeDef']>,
  convexPolygon: DecompPolygon,
  outShapeIds: b2ShapeId[]
): void {
  if (convexPolygon.length < 3) {
    return
  }
  if (convexPolygon.length <= BOX2D_MAX_POLYGON_VERTICES) {
    appendPolygonShape(box2d, bodyId, shapeDef, convexPolygon, outShapeIds)
    return
  }

  const pointCount = convexPolygon.length
  let startIndex = 1
  while (startIndex < pointCount - 1) {
    const endIndex = Math.min(
      pointCount - 1,
      startIndex + BOX2D_MAX_POLYGON_VERTICES - 2
    )
    const splitPolygon: DecompPolygon = [convexPolygon[0]]
    for (let i = startIndex; i <= endIndex; i++) {
      splitPolygon.push(convexPolygon[i])
    }
    appendPolygonShape(box2d, bodyId, shapeDef, splitPolygon, outShapeIds)
    startIndex = endIndex
  }
}

function appendPolygonShape(
  box2d: MainModule,
  bodyId: ReturnType<MainModule['b2CreateBody']>,
  shapeDef: ReturnType<MainModule['b2DefaultShapeDef']>,
  polygon: DecompPolygon,
  outShapeIds: b2ShapeId[]
): void {
  if (polygon.length < 3) {
    return
  }

  const { b2CreatePolygonShape, b2ComputeHull, b2MakePolygon, b2Vec2 } = box2d
  const points: InstanceType<MainModule['b2Vec2']>[] = []
  for (let i = 0; i < polygon.length; i++) {
    points.push(new b2Vec2(polygon[i][0], polygon[i][1]))
  }

  const hull = b2ComputeHull(points)
  const polygonShape = b2MakePolygon(hull, 0)
  outShapeIds.push(b2CreatePolygonShape(bodyId, shapeDef, polygonShape))

  hull.delete()
  polygonShape.delete()
  for (let i = 0; i < points.length; i++) {
    points[i].delete()
  }
}
