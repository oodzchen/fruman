import { buildCharacterBodyCollisionPolygons } from '../characterBodyCollision'
import { DEFAULT_BODY_LINEAR_DAMPING } from '../constants'
import type { MapCharacterBodyProfile } from '../editorMapTypes'
import { normalizeSkeletalBodyProfile } from '../skeletalBodyProfile'
import type { MainModule, b2ShapeId, b2WorldId } from '../types'

export interface CharacterBodyPhysicsConfig {
  x: number
  y: number
  radius: number
  bodyHeight: number
  bodyProfile?: MapCharacterBodyProfile
  segmented?: boolean
  // 兼容旧数据结构保留这组字段，但 Spine 分段角色的真实碰撞
  // 已完全交给运行时 bounding box，不再消费这套代理框参数。
  segmentedProxyHalfWidth?: number
  segmentedProxyHalfHeight?: number
  segmentedProxyOffsetY?: number
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
  const normalizedBodyProfile = normalizeSkeletalBodyProfile(config.bodyProfile)
  const collisionPolygons = config.segmented
    ? // Spine 分段角色先用轻量代理框完成刚体创建，
      // 随后会由 SpineSegmentManager 立刻替换为动画驱动的 runtime 多边形。
      typeof config.segmentedProxyHalfWidth === 'number' &&
      config.segmentedProxyHalfWidth > 0 &&
      typeof config.segmentedProxyHalfHeight === 'number' &&
      config.segmentedProxyHalfHeight > 0
      ? [
          buildProxyBoxPolygon(
            config.segmentedProxyHalfWidth,
            config.segmentedProxyHalfHeight,
            config.segmentedProxyOffsetY ?? 0
          ),
        ]
      : null
    : buildCharacterBodyCollisionPolygons(
        normalizedBodyProfile,
        config.radius,
        config.bodyHeight
      )

  if (
    collisionPolygons &&
    collisionPolygons.length > 0 &&
    appendCharacterPolygonShapes(
      box2d,
      bodyId,
      shapeDef,
      collisionPolygons,
      shapeIds
    )
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

function buildProxyBoxPolygon(
  halfWidth: number,
  halfHeight: number,
  offsetY: number
): number[] {
  const top = offsetY - halfHeight
  const bottom = offsetY + halfHeight
  return [
    -halfWidth,
    top,
    halfWidth,
    top,
    halfWidth,
    bottom,
    -halfWidth,
    bottom,
  ]
}
function appendCharacterPolygonShapes(
  box2d: MainModule,
  bodyId: ReturnType<MainModule['b2CreateBody']>,
  shapeDef: ReturnType<MainModule['b2DefaultShapeDef']>,
  polygons: readonly number[][],
  outShapeIds: b2ShapeId[]
): boolean {
  return appendConvexPolygonShapes(
    box2d,
    bodyId,
    shapeDef,
    polygons,
    outShapeIds
  )
}

export function appendConvexPolygonShapes(
  box2d: MainModule,
  bodyId: ReturnType<MainModule['b2CreateBody']>,
  shapeDef: ReturnType<MainModule['b2DefaultShapeDef']>,
  polygons: readonly number[][],
  outShapeIds: b2ShapeId[]
): boolean {
  for (let i = 0; i < polygons.length; i++) {
    appendPolygonShape(box2d, bodyId, shapeDef, polygons[i], outShapeIds)
  }

  return outShapeIds.length > 0
}

function appendPolygonShape(
  box2d: MainModule,
  bodyId: ReturnType<MainModule['b2CreateBody']>,
  shapeDef: ReturnType<MainModule['b2DefaultShapeDef']>,
  polygon: readonly number[],
  outShapeIds: b2ShapeId[]
): void {
  if (polygon.length < 6) {
    return
  }

  const { b2CreatePolygonShape, b2ComputeHull, b2MakePolygon, b2Vec2 } = box2d
  const points: InstanceType<MainModule['b2Vec2']>[] = []
  for (let i = 0; i < polygon.length; i += 2) {
    points.push(new b2Vec2(polygon[i], polygon[i + 1]))
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
