import type { Entity } from '../../Entity'
import type { GrappleSystemRuntime } from './GrappleRuntime'
import type { RopeBridgeRuntime, RopeRuntime } from './GrappleTypes'

export class RopeRenderAdapterSystem {
  constructor(private readonly runtime: GrappleSystemRuntime) {}

  writeActiveRopePoints(
    entity: Entity,
    targetBuffer: Float32Array<ArrayBufferLike>,
    startOffset: number,
    maxPoints: number
  ): number {
    if (maxPoints < 2) {
      return 0
    }

    let pointCount = 0
    pointCount = this.runtime.writePlayerRopePoints(
      entity,
      this.runtime.ropeRuntimeByEntityId.get(entity.id) ?? null,
      targetBuffer,
      startOffset,
      maxPoints,
      pointCount
    )

    for (let i = 0; i < this.runtime.detachedPlayerRopes.length; i++) {
      if (pointCount >= maxPoints) break
      const runtime = this.runtime.detachedPlayerRopes[i]
      if (!runtime.active) continue
      pointCount = this.runtime.writePlayerRopePoints(
        entity,
        runtime,
        targetBuffer,
        startOffset,
        maxPoints,
        pointCount
      )
    }

    for (let i = 0; i < this.runtime.bridgeRopes.length; i++) {
      if (pointCount >= maxPoints) break
      const runtime = this.runtime.bridgeRopes[i]
      if (!runtime.active) continue
      pointCount = this.runtime.writeBridgeRopePoints(
        runtime,
        targetBuffer,
        startOffset,
        maxPoints,
        pointCount
      )
    }

    return pointCount
  }

  writePlayerRopePoints(
    entity: Entity,
    runtime: RopeRuntime | null,
    targetBuffer: Float32Array<ArrayBufferLike>,
    startOffset: number,
    maxPoints: number,
    pointCount: number
  ): number {
    const grapple = entity.grapple
    if (!runtime || !runtime.active) {
      return pointCount
    }
    const climbRuntime = this.runtime.findPlayerRopeClimbRuntime(runtime)
    const isPlayerRopeClimbing =
      climbRuntime?.active === true &&
      climbRuntime.sourceType === this.runtime.ropeClimbSourcePlayer

    if (pointCount > 0) {
      if (pointCount >= maxPoints) return pointCount
      this.runtime.writeRopeBreak(targetBuffer, startOffset, pointCount)
      pointCount += 1
    }

    let outOffset = startOffset + pointCount * 2

    if (
      !this.runtime.writePlayerRopeAnchorPoint(runtime, targetBuffer, outOffset)
    ) {
      return pointCount
    }
    pointCount += 1
    outOffset += 2

    const visibleCount = isPlayerRopeClimbing
      ? climbRuntime.maxNodeIndex
      : runtime.attachIndex + 1
    const reservedEndPointCount = isPlayerRopeClimbing
      ? maxPoints
      : maxPoints - 1
    for (
      let i = 0;
      i < visibleCount && pointCount < reservedEndPointCount;
      i++
    ) {
      const bodyId = runtime.segmentBodies[i]
      if (
        !this.runtime.isBodyId(bodyId) ||
        !this.runtime.box2d.b2Body_IsValid(bodyId)
      ) {
        continue
      }
      const pos = this.runtime.box2d.b2Body_GetPosition(bodyId)
      this.runtime.writeRopeSegmentPoint(
        runtime,
        i,
        pos.x,
        pos.y,
        targetBuffer,
        outOffset
      )
      pointCount += 1
      outOffset += 2
      pos.delete()
    }

    if (
      runtime.playerAttached &&
      !isPlayerRopeClimbing &&
      runtime.ownerEntityId === entity.id &&
      entity.transform &&
      pointCount < maxPoints
    ) {
      targetBuffer[outOffset] = entity.transform.x
      targetBuffer[outOffset + 1] = entity.transform.y
      pointCount += 1
    }

    return pointCount
  }

  writePlayerRopeAnchorPoint(
    runtime: RopeRuntime,
    targetBuffer: Float32Array<ArrayBufferLike>,
    outOffset: number
  ): boolean {
    if (
      !this.runtime.readBodyPosition(
        runtime.anchorBodyId,
        this.runtime.climbPointA
      )
    ) {
      return false
    }
    targetBuffer[outOffset] = this.runtime.climbPointA.x
    targetBuffer[outOffset + 1] = this.runtime.climbPointA.y
    return true
  }

  writeBridgeRopePoints(
    runtime: RopeBridgeRuntime,
    targetBuffer: Float32Array<ArrayBufferLike>,
    startOffset: number,
    maxPoints: number,
    pointCount: number
  ): number {
    const entityA = this.runtime.getEntityById(runtime.endpointAEntityId)
    const entityB = this.runtime.getEntityById(runtime.endpointBEntityId)
    if (!entityA?.transform || !entityB?.transform) {
      return pointCount
    }

    if (pointCount > 0) {
      if (pointCount >= maxPoints) return pointCount
      this.runtime.writeRopeBreak(targetBuffer, startOffset, pointCount)
      pointCount += 1
    }

    let outOffset = startOffset + pointCount * 2
    targetBuffer[outOffset] = entityA.transform.x
    targetBuffer[outOffset + 1] = entityA.transform.y
    pointCount += 1
    outOffset += 2

    for (let i = 0; i < runtime.segmentBodies.length; i++) {
      if (pointCount >= maxPoints - 1) break
      const bodyId = runtime.segmentBodies[i]
      if (
        !this.runtime.isBodyId(bodyId) ||
        !this.runtime.box2d.b2Body_IsValid(bodyId)
      ) {
        continue
      }
      const pos = this.runtime.box2d.b2Body_GetPosition(bodyId)
      this.runtime.writeRopeSegmentPoint(
        runtime,
        i,
        pos.x,
        pos.y,
        targetBuffer,
        outOffset
      )
      pointCount += 1
      outOffset += 2
      pos.delete()
    }

    if (pointCount < maxPoints) {
      targetBuffer[outOffset] = entityB.transform.x
      targetBuffer[outOffset + 1] = entityB.transform.y
      pointCount += 1
    }

    return pointCount
  }

  writeRopeBreak(
    targetBuffer: Float32Array<ArrayBufferLike>,
    startOffset: number,
    pointCount: number
  ): void {
    const outOffset = startOffset + pointCount * 2
    targetBuffer[outOffset] = Number.NaN
    targetBuffer[outOffset + 1] = Number.NaN
  }

  writeRopeSegmentPoint(
    runtime: RopeRuntime | RopeBridgeRuntime,
    segmentIndex: number,
    x: number,
    y: number,
    targetBuffer: Float32Array<ArrayBufferLike>,
    outOffset: number
  ): void {
    if (
      segmentIndex === runtime.hitShakeSegmentIndex &&
      this.runtime.currentTimeMs < runtime.hitShakeEndTimeMs
    ) {
      const elapsedMs = this.runtime.currentTimeMs - runtime.hitShakeStartTimeMs
      const progress = Math.min(
        1,
        Math.max(0, elapsedMs / this.runtime.ropeHitShakeDurationMs)
      )
      const amplitude =
        this.runtime.ropeHitShakeAmplitude * Math.sin(progress * Math.PI)
      targetBuffer[outOffset] = x + runtime.hitShakeDirX * amplitude
      targetBuffer[outOffset + 1] = y + runtime.hitShakeDirY * amplitude
      return
    }

    targetBuffer[outOffset] = x
    targetBuffer[outOffset + 1] = y
  }
}
