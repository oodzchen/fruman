import {
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
  const polygon: DecompPolygon = []
  for (let i = 0; i < localPoints.length; i += 2) {
    polygon.push([localPoints[i], localPoints[i + 1]])
  }
  removeDuplicatePoints(polygon, 0.0001)
  removeCollinearPoints(polygon, 0.0001)
  if (polygon.length < 3) {
    return false
  }

  let convexPolygons: DecompPolygon[] | null = null
  if (isSimple(polygon)) {
    makeCCW(polygon)
    convexPolygons = quickDecomp(polygon)
  }
  if (!convexPolygons || convexPolygons.length === 0) {
    convexPolygons = [polygon]
  }

  const { b2CreatePolygonShape, b2ComputeHull, b2MakePolygon, b2Vec2 } = box2d
  for (let i = 0; i < convexPolygons.length; i++) {
    const convex = convexPolygons[i]
    if (convex.length < 3) {
      continue
    }
    const points: InstanceType<MainModule['b2Vec2']>[] = []
    for (let j = 0; j < convex.length; j++) {
      points.push(new b2Vec2(convex[j][0], convex[j][1]))
    }
    const hull = b2ComputeHull(points)
    const polygonShape = b2MakePolygon(hull, 0)
    outShapeIds.push(b2CreatePolygonShape(bodyId, shapeDef, polygonShape))
    hull.delete()
    polygonShape.delete()
    for (let j = 0; j < points.length; j++) {
      points[j].delete()
    }
  }

  return outShapeIds.length > 0
}
