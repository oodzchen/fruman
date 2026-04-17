import { DEFAULT_BODY_FRICTION } from '../constants'
import { getEnemyCollisionCategory } from '../physicsLayers'
import type { MainModule, NpcType, b2ShapeId, b2WorldId } from '../types'
import type { WorkerSpineCollisionData } from '../worker/protocol'
import type { SpineCollisionDebugData } from '../worker/protocol'
import { appendConvexPolygonShapes } from './CharacterBodyPhysics'
import type { Entity } from './Entity'
import { checkOBBvsFlatPolygon } from './OBBCollision'
import { System } from './System'

const TAU = Math.PI * 2

interface SpineCollisionSharedData {
  animationDuration: number
  sampleCount: number
  segmentCount: number
  coverageRadius: number
  segmentOffsetY: number
  segmentShapes: number[][][]
  mirroredSegmentShapes: number[][][]
  boneTransforms: Float32Array
  spineScale: number
}

interface SpineSegmentRuntime {
  entityId: number
  npcType: NpcType
  facing: -1 | 1
  animationTime: number
  shapeScale: number
  segmentShapeIds: b2ShapeId[][]
  localShapes: number[][][]
  mirroredLocalShapes: number[][][]
  localPolygons: number[][][]
  worldPolygons: number[][][]
  pointBuffers: InstanceType<MainModule['b2Vec2']>[][][]
}

function isPositiveNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function getFacing(entity: Entity, fallback: -1 | 1): -1 | 1 {
  const direction = entity.input?.lastMoveDirection ?? 0
  if (direction < 0) {
    return -1
  }
  if (direction > 0) {
    return 1
  }
  return fallback
}

function mirrorPolygonX(polygon: readonly number[]): number[] {
  const mirrored = new Array<number>(polygon.length)
  for (let i = 0; i < polygon.length; i += 2) {
    mirrored[i] = -polygon[i]
    mirrored[i + 1] = polygon[i + 1]
  }
  return mirrored
}

function buildMirroredShapes(
  segmentShapes: readonly number[][][]
): number[][][] {
  const mirrored = new Array<number[][]>(segmentShapes.length)
  for (let i = 0; i < segmentShapes.length; i++) {
    const sourcePolygons = segmentShapes[i]
    const targetPolygons = new Array<number[]>(sourcePolygons.length)
    for (let j = 0; j < sourcePolygons.length; j++) {
      targetPolygons[j] = mirrorPolygonX(sourcePolygons[j])
    }
    mirrored[i] = targetPolygons
  }
  return mirrored
}

function scaleShapes(
  segmentShapes: readonly number[][][],
  scale: number
): number[][][] {
  const scaled = new Array<number[][]>(segmentShapes.length)
  for (let i = 0; i < segmentShapes.length; i++) {
    const sourcePolygons = segmentShapes[i]
    const targetPolygons = new Array<number[]>(sourcePolygons.length)
    for (let j = 0; j < sourcePolygons.length; j++) {
      const sourcePolygon = sourcePolygons[j]
      const targetPolygon = new Array<number>(sourcePolygon.length)
      for (let k = 0; k < sourcePolygon.length; k++) {
        targetPolygon[k] = sourcePolygon[k] * scale
      }
      targetPolygons[j] = targetPolygon
    }
    scaled[i] = targetPolygons
  }
  return scaled
}

function createWorldPolygonCache(
  segmentShapes: readonly number[][][]
): number[][][] {
  const cache = new Array<number[][]>(segmentShapes.length)
  for (let i = 0; i < segmentShapes.length; i++) {
    const sourcePolygons = segmentShapes[i]
    const targetPolygons = new Array<number[]>(sourcePolygons.length)
    for (let j = 0; j < sourcePolygons.length; j++) {
      targetPolygons[j] = new Array<number>(sourcePolygons[j].length)
    }
    cache[i] = targetPolygons
  }
  return cache
}

function createShapeIdCache(
  segmentShapes: readonly number[][][]
): b2ShapeId[][] {
  const cache = new Array<b2ShapeId[]>(segmentShapes.length)
  for (let i = 0; i < segmentShapes.length; i++) {
    cache[i] = new Array<b2ShapeId>(segmentShapes[i].length)
  }
  return cache
}

function lerpAngle(start: number, end: number, t: number): number {
  let delta = end - start
  while (delta > Math.PI) {
    delta -= TAU
  }
  while (delta < -Math.PI) {
    delta += TAU
  }
  return start + delta * t
}

export class SpineSegmentManager extends System {
  private readonly box2d: MainModule
  private readonly dataByNpcType = new Map<NpcType, SpineCollisionSharedData>()
  private readonly runtimes = new Map<number, SpineSegmentRuntime>()
  private readonly scratchShapeIds: b2ShapeId[] = []
  private entityLookup?: (id: number) => Entity | undefined
  private maxActiveCoverageRadius = 0

  constructor(box2d: MainModule, _worldId: b2WorldId) {
    super()
    this.box2d = box2d
    this.setRequiredComponents([])
  }

  setEntityLookup(entityLookup: (id: number) => Entity | undefined): void {
    this.entityLookup = entityLookup
  }

  setCollisionData(collisionData: WorkerSpineCollisionData): void {
    const boneTransforms = new Float32Array(collisionData.boneTransforms)
    if (
      collisionData.sampleCount <= 1 ||
      collisionData.segmentCount <= 0 ||
      boneTransforms.length !==
        collisionData.sampleCount * collisionData.segmentCount * 3
    ) {
      return
    }

    this.dataByNpcType.set(collisionData.npcType, {
      animationDuration: collisionData.animationDuration,
      sampleCount: collisionData.sampleCount,
      segmentCount: collisionData.segmentCount,
      coverageRadius: collisionData.coverageRadius,
      segmentOffsetY: collisionData.segmentOffsetY,
      segmentShapes: collisionData.segmentShapes,
      mirroredSegmentShapes: buildMirroredShapes(collisionData.segmentShapes),
      boneTransforms,
      spineScale: collisionData.spineScale,
    })
  }

  hasDataForNpcType(npcType: NpcType): boolean {
    return this.dataByNpcType.has(npcType)
  }

  createSegments(entity: Entity, npcType: NpcType): void {
    const shared = this.dataByNpcType.get(npcType)
    if (!shared || !entity.transform || !entity.render || !entity.physics) {
      return
    }

    this.destroySegments(entity.id)

    const shapeScale = this.getShapeScale(entity, shared)
    const localShapes =
      shapeScale === 1
        ? shared.segmentShapes
        : scaleShapes(shared.segmentShapes, shapeScale)
    const mirroredLocalShapes =
      shapeScale === 1
        ? shared.mirroredSegmentShapes
        : scaleShapes(shared.mirroredSegmentShapes, shapeScale)

    const runtime: SpineSegmentRuntime = {
      entityId: entity.id,
      npcType,
      facing: getFacing(entity, 1),
      animationTime: 0,
      shapeScale,
      segmentShapeIds: createShapeIdCache(localShapes),
      localShapes,
      mirroredLocalShapes,
      localPolygons: createWorldPolygonCache(localShapes),
      worldPolygons: createWorldPolygonCache(localShapes),
      pointBuffers: this.createPointBufferCache(localShapes),
    }

    this.syncRuntime(runtime, entity, 0, false)
    this.replaceRuntimeShapes(runtime, entity)
    this.runtimes.set(entity.id, runtime)
    const coverageRadius = this.getEntityCoverageRadius(entity)
    if (coverageRadius > this.maxActiveCoverageRadius) {
      this.maxActiveCoverageRadius = coverageRadius
    }
  }

  destroySegments(entityId: number): void {
    const runtime = this.runtimes.get(entityId)
    if (!runtime) {
      return
    }
    this.destroyRuntime(runtime)
    this.runtimes.delete(entityId)
  }

  clear(): void {
    for (const runtime of this.runtimes.values()) {
      this.destroyRuntime(runtime)
    }
    this.runtimes.clear()
    this.maxActiveCoverageRadius = 0
  }

  getEntityCoverageRadius(entity: Entity): number {
    const runtime = this.runtimes.get(entity.id)
    if (!runtime) {
      return 0
    }
    const shared = this.dataByNpcType.get(runtime.npcType)
    if (!shared) {
      return 0
    }
    return (
      shared.coverageRadius * runtime.shapeScale + (entity.render?.radius ?? 0)
    )
  }

  getMaxActiveCoverageRadius(): number {
    return this.maxActiveCoverageRadius
  }

  collectDebugCollisionData(): SpineCollisionDebugData[] {
    if (!this.entityLookup || this.runtimes.size === 0) {
      return []
    }

    const result: SpineCollisionDebugData[] = []
    for (const runtime of this.runtimes.values()) {
      const entity = this.entityLookup(runtime.entityId)
      if (
        !entity ||
        !entity.transform ||
        !entity.render ||
        !entity.render.segmentedCollision ||
        entity.stats?.isDead ||
        entity.stats?.isVanished
      ) {
        continue
      }

      const localPolygons: number[][] = []
      for (
        let segmentIndex = 0;
        segmentIndex < runtime.worldPolygons.length;
        segmentIndex++
      ) {
        const segmentPolygons = runtime.worldPolygons[segmentIndex]
        for (
          let polygonIndex = 0;
          polygonIndex < segmentPolygons.length;
          polygonIndex++
        ) {
          const worldPolygon = segmentPolygons[polygonIndex]
          const localPolygon = new Array<number>(worldPolygon.length)
          for (
            let vertexIndex = 0;
            vertexIndex < worldPolygon.length;
            vertexIndex += 2
          ) {
            localPolygon[vertexIndex] =
              worldPolygon[vertexIndex] - entity.transform.x
            localPolygon[vertexIndex + 1] =
              worldPolygon[vertexIndex + 1] - entity.transform.y
          }
          localPolygons.push(localPolygon)
        }
      }

      if (localPolygons.length > 0) {
        result.push({
          entityId: runtime.entityId,
          polygons: localPolygons,
        })
      }
    }

    return result
  }

  testWeaponHit(
    entityId: number,
    weaponX: number,
    weaponY: number,
    weaponWidth: number,
    weaponHeight: number,
    weaponRotation: number
  ): boolean {
    const runtime = this.runtimes.get(entityId)
    if (!runtime) {
      return false
    }

    for (
      let segmentIndex = 0;
      segmentIndex < runtime.worldPolygons.length;
      segmentIndex++
    ) {
      const polygons = runtime.worldPolygons[segmentIndex]
      for (
        let polygonIndex = 0;
        polygonIndex < polygons.length;
        polygonIndex++
      ) {
        if (
          checkOBBvsFlatPolygon(
            weaponX,
            weaponY,
            weaponWidth,
            weaponHeight,
            weaponRotation,
            polygons[polygonIndex]
          )
        ) {
          return true
        }
      }
    }

    return false
  }

  update(_entities: Entity[], deltaTime: number): void {
    if (!this.entityLookup) {
      return
    }

    let maxCoverageRadius = 0
    for (const runtime of this.runtimes.values()) {
      const entity = this.entityLookup(runtime.entityId)
      if (
        !entity ||
        !entity.transform ||
        !entity.render ||
        !entity.render.segmentedCollision ||
        entity.stats?.isDead ||
        entity.stats?.isVanished
      ) {
        this.destroySegments(runtime.entityId)
        continue
      }

      const nextFacing = getFacing(entity, runtime.facing)
      runtime.facing = nextFacing
      this.syncRuntime(runtime, entity, deltaTime, true)
      const coverageRadius = this.getEntityCoverageRadius(entity)
      if (coverageRadius > maxCoverageRadius) {
        maxCoverageRadius = coverageRadius
      }
    }
    this.maxActiveCoverageRadius = maxCoverageRadius
  }

  syncAfterPhysics(): void {
    if (!this.entityLookup) {
      return
    }

    for (const runtime of this.runtimes.values()) {
      const entity = this.entityLookup(runtime.entityId)
      if (
        !entity ||
        !entity.transform ||
        !entity.render ||
        !entity.render.segmentedCollision ||
        entity.stats?.isDead ||
        entity.stats?.isVanished
      ) {
        continue
      }
      this.syncRuntime(runtime, entity, 0, false)
    }
  }

  private getShapeScale(
    entity: Entity,
    shared: SpineCollisionSharedData
  ): number {
    const bodyProfileScale = entity.render?.bodyProfile?.spineScale
    if (
      !isPositiveNumber(bodyProfileScale) ||
      !isPositiveNumber(shared.spineScale)
    ) {
      return 1
    }
    return bodyProfileScale / shared.spineScale
  }

  private replaceRuntimeShapes(
    runtime: SpineSegmentRuntime,
    entity: Entity
  ): void {
    if (!entity.physics) {
      return
    }

    const {
      b2DefaultShapeDef,
      b2Shape_GetDensity,
      b2Shape_GetFilter,
      b2Shape_GetFriction,
    } = this.box2d
    const templateShapeId = entity.physics.shapeIds[0] ?? entity.physics.shapeId
    const shapeDef = b2DefaultShapeDef()
    shapeDef.density =
      templateShapeId !== undefined ? b2Shape_GetDensity(templateShapeId) : 1
    shapeDef.material.friction =
      templateShapeId !== undefined
        ? b2Shape_GetFriction(templateShapeId)
        : DEFAULT_BODY_FRICTION
    if (templateShapeId !== undefined) {
      const filter = b2Shape_GetFilter(templateShapeId)
      shapeDef.filter.categoryBits = filter.categoryBits
      shapeDef.filter.maskBits = filter.maskBits
    } else {
      shapeDef.filter.categoryBits = getEnemyCollisionCategory(
        entity.render?.renderLayer ?? 0
      )
      shapeDef.filter.maskBits = 0
    }

    // 这里直接替换主动态刚体上的 shape。
    // 对于 Spine 分段角色，主刚体必须与 runtime bounding box 共用同一套多边形，
    // 否则环境碰撞、武器命中、调试线框会分别落在三套轮廓上。
    this.destroyBodyShapes(entity)

    const bodyId = entity.physics.bodyId
    for (
      let segmentIndex = 0;
      segmentIndex < runtime.localPolygons.length;
      segmentIndex++
    ) {
      this.scratchShapeIds.length = 0
      appendConvexPolygonShapes(
        this.box2d,
        bodyId,
        shapeDef,
        runtime.localPolygons[segmentIndex],
        this.scratchShapeIds
      )
      const segmentShapeIds = runtime.segmentShapeIds[segmentIndex]
      for (
        let polygonIndex = 0;
        polygonIndex < segmentShapeIds.length;
        polygonIndex++
      ) {
        segmentShapeIds[polygonIndex] = this.scratchShapeIds[polygonIndex]
      }
    }

    entity.physics.shapeIds.length = 0
    for (let i = 0; i < runtime.segmentShapeIds.length; i++) {
      const segmentShapeIds = runtime.segmentShapeIds[i]
      for (let j = 0; j < segmentShapeIds.length; j++) {
        entity.physics.shapeIds.push(segmentShapeIds[j])
      }
    }
    entity.physics.shapeId = entity.physics.shapeIds[0]

    shapeDef.delete()
  }

  private destroyRuntime(runtime: SpineSegmentRuntime): void {
    for (let i = 0; i < runtime.pointBuffers.length; i++) {
      const segmentPointBuffers = runtime.pointBuffers[i]
      for (let j = 0; j < segmentPointBuffers.length; j++) {
        const polygonPoints = segmentPointBuffers[j]
        for (let k = 0; k < polygonPoints.length; k++) {
          polygonPoints[k].delete()
        }
      }
    }
  }

  private destroyBodyShapes(entity: Entity): void {
    if (!entity.physics) {
      return
    }
    const { b2DestroyShape } = this.box2d
    const shapeIds =
      entity.physics.shapeIds.length > 0
        ? entity.physics.shapeIds
        : [entity.physics.shapeId]
    for (let i = 0; i < shapeIds.length; i++) {
      b2DestroyShape(shapeIds[i], true)
    }
    entity.physics.shapeIds.length = 0
  }

  private createPointBufferCache(
    segmentShapes: readonly number[][][]
  ): InstanceType<MainModule['b2Vec2']>[][][] {
    const cache = new Array<InstanceType<MainModule['b2Vec2']>[][]>(
      segmentShapes.length
    )
    for (let i = 0; i < segmentShapes.length; i++) {
      const segmentPolygons = segmentShapes[i]
      const polygonBuffers = new Array<InstanceType<MainModule['b2Vec2']>[]>(
        segmentPolygons.length
      )
      for (let j = 0; j < segmentPolygons.length; j++) {
        const polygon = segmentPolygons[j]
        const pointCount = polygon.length / 2
        const pointBuffer = new Array<InstanceType<MainModule['b2Vec2']>>(
          pointCount
        )
        for (let k = 0; k < pointCount; k++) {
          pointBuffer[k] = new this.box2d.b2Vec2(0, 0)
        }
        polygonBuffers[j] = pointBuffer
      }
      cache[i] = polygonBuffers
    }
    return cache
  }

  private updateRuntimeShape(
    shapeId: b2ShapeId,
    polygon: readonly number[],
    pointBuffer: InstanceType<MainModule['b2Vec2']>[]
  ): void {
    if (polygon.length < 6 || pointBuffer.length * 2 !== polygon.length) {
      return
    }

    const { b2ComputeHull, b2MakePolygon, b2Shape_SetPolygon } = this.box2d
    for (let i = 0; i < pointBuffer.length; i++) {
      const vertexOffset = i * 2
      pointBuffer[i].x = polygon[vertexOffset]
      pointBuffer[i].y = polygon[vertexOffset + 1]
    }
    const hull = b2ComputeHull(pointBuffer)
    const polygonShape = b2MakePolygon(hull, 0)
    b2Shape_SetPolygon(shapeId, polygonShape)
    hull.delete()
    polygonShape.delete()
  }

  private syncRuntime(
    runtime: SpineSegmentRuntime,
    entity: Entity,
    deltaTime: number,
    updatePhysicsShapes: boolean
  ): void {
    const shared = this.dataByNpcType.get(runtime.npcType)
    if (!shared || !entity.transform || !entity.render || !entity.physics) {
      return
    }

    runtime.animationTime += deltaTime
    if (runtime.animationTime >= shared.animationDuration) {
      runtime.animationTime %= shared.animationDuration
    }

    const samplePosition =
      (runtime.animationTime * shared.sampleCount) / shared.animationDuration
    const sampleIndex = Math.floor(samplePosition)
    const nextIndex = sampleIndex + 1 < shared.sampleCount ? sampleIndex + 1 : 0
    const t = samplePosition - sampleIndex
    const sampleStride = shared.segmentCount * 3
    const radius = entity.render.radius
    const baseOffsetY = radius + shared.segmentOffsetY * runtime.shapeScale
    const currentShapes =
      runtime.facing === 1 ? runtime.mirroredLocalShapes : runtime.localShapes

    for (
      let segmentIndex = 0;
      segmentIndex < shared.segmentCount;
      segmentIndex++
    ) {
      const currentOffset = sampleIndex * sampleStride + segmentIndex * 3
      const nextOffset = nextIndex * sampleStride + segmentIndex * 3
      const baseX = shared.boneTransforms[currentOffset] * runtime.shapeScale
      const baseY =
        shared.boneTransforms[currentOffset + 1] * runtime.shapeScale
      const baseRot = shared.boneTransforms[currentOffset + 2]
      const nextX = shared.boneTransforms[nextOffset] * runtime.shapeScale
      const nextY = shared.boneTransforms[nextOffset + 1] * runtime.shapeScale
      const nextRot = shared.boneTransforms[nextOffset + 2]

      const localX = baseX + (nextX - baseX) * t
      const localY = baseY + (nextY - baseY) * t
      const rotation = lerpAngle(baseRot, nextRot, t)
      const bodyLocalX = localX * runtime.facing
      const bodyLocalY = baseOffsetY + localY
      const worldX = entity.transform.x + bodyLocalX
      const worldY = entity.transform.y + bodyLocalY
      const worldRot = -runtime.facing * rotation

      this.updatePolygonCaches(
        currentShapes[segmentIndex],
        runtime.localPolygons[segmentIndex],
        runtime.worldPolygons[segmentIndex],
        bodyLocalX,
        bodyLocalY,
        worldX,
        worldY,
        worldRot
      )

      if (updatePhysicsShapes) {
        const segmentShapeIds = runtime.segmentShapeIds[segmentIndex]
        const segmentLocalPolygons = runtime.localPolygons[segmentIndex]
        const segmentPointBuffers = runtime.pointBuffers[segmentIndex]
        for (
          let polygonIndex = 0;
          polygonIndex < segmentShapeIds.length;
          polygonIndex++
        ) {
          this.updateRuntimeShape(
            segmentShapeIds[polygonIndex],
            segmentLocalPolygons[polygonIndex],
            segmentPointBuffers[polygonIndex]
          )
        }
      }
    }
  }

  private updatePolygonCaches(
    localShapes: readonly number[][],
    localPolygons: number[][],
    worldPolygons: number[][],
    localX: number,
    localY: number,
    worldX: number,
    worldY: number,
    rotation: number
  ): void {
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    for (
      let polygonIndex = 0;
      polygonIndex < localShapes.length;
      polygonIndex++
    ) {
      const source = localShapes[polygonIndex]
      const localTarget = localPolygons[polygonIndex]
      const target = worldPolygons[polygonIndex]
      for (let vertexIndex = 0; vertexIndex < source.length; vertexIndex += 2) {
        const x = source[vertexIndex]
        const y = source[vertexIndex + 1]
        const rotatedX = x * cos - y * sin
        const rotatedY = x * sin + y * cos
        localTarget[vertexIndex] = localX + rotatedX
        localTarget[vertexIndex + 1] = localY + rotatedY
        target[vertexIndex] = worldX + rotatedX
        target[vertexIndex + 1] = worldY + rotatedY
      }
    }
  }
}
