import { DEFAULT_GRAPPLE_ROPE_SEGMENT_RADIUS } from '../../../constants'
import type { b2BodyId } from '../../../types'
import { SOUND_IDS } from '../../../worker/effectsProtocol'
import { checkOBBvsCircle } from '../../OBBCollision'
import type { GrappleSystemRuntime } from './GrappleRuntime'
import type {
  RopeBridgeRuntime,
  RopeCircleHitRequest,
  RopeHitRequest,
  RopeRuntime,
} from './GrappleTypes'

export class GrappleCombatSystem {
  constructor(private readonly runtime: GrappleSystemRuntime) {}

  hitRopesInOBB(request: RopeHitRequest): boolean {
    if (request.width <= 0 || request.height <= 0) {
      return false
    }

    let hit = false
    for (const runtime of this.runtime.ropeRuntimeByEntityId.values()) {
      if (this.runtime.tryHitPlayerRopeInOBB(runtime, request)) {
        hit = true
      }
    }

    for (let i = 0; i < this.runtime.detachedPlayerRopes.length; i++) {
      const runtime = this.runtime.detachedPlayerRopes[i]
      if (this.runtime.tryHitPlayerRopeInOBB(runtime, request)) {
        hit = true
      }
    }

    for (let i = 0; i < this.runtime.bridgeRopes.length; i++) {
      if (
        this.runtime.tryHitBridgeRopeInOBB(this.runtime.bridgeRopes[i], request)
      ) {
        hit = true
      }
    }

    return hit
  }

  hitRopesInCircle(request: RopeCircleHitRequest): boolean {
    if (request.radius <= 0) {
      return false
    }

    let hit = false
    for (const runtime of this.runtime.ropeRuntimeByEntityId.values()) {
      if (this.runtime.tryHitPlayerRopeInCircle(runtime, request)) {
        hit = true
      }
    }

    for (let i = 0; i < this.runtime.detachedPlayerRopes.length; i++) {
      const runtime = this.runtime.detachedPlayerRopes[i]
      if (this.runtime.tryHitPlayerRopeInCircle(runtime, request)) {
        hit = true
      }
    }

    for (let i = 0; i < this.runtime.bridgeRopes.length; i++) {
      if (
        this.runtime.tryHitBridgeRopeInCircle(
          this.runtime.bridgeRopes[i],
          request
        )
      ) {
        hit = true
      }
    }

    return hit
  }

  tryHitPlayerRopeInOBB(
    runtime: RopeRuntime,
    request: RopeHitRequest
  ): boolean {
    if (!this.runtime.canHitRopeRuntime(runtime, request)) {
      return false
    }

    const visibleSegmentCount =
      this.runtime.getVisiblePlayerRopeSegmentCount(runtime)
    if (
      !this.runtime.findHitRopeSegmentInOBB(
        runtime.segmentBodies,
        visibleSegmentCount,
        request
      )
    ) {
      return false
    }

    const damage = this.runtime.getRopeHitDamage(request)
    if (damage <= 0) {
      return false
    }
    this.runtime.markRopeHit(runtime.hitId, request)
    runtime.health -= damage
    if (runtime.health <= 0) {
      runtime.health = 0
      this.runtime.emitRopeHitSound(
        this.runtime.hitRopeSegmentX,
        this.runtime.hitRopeSegmentY
      )
      this.runtime.destroyPlayerRopeRuntime(runtime)
      return true
    }

    this.runtime.applyRopeHitFeedback(runtime, request)
    return true
  }

  tryHitBridgeRopeInOBB(
    runtime: RopeBridgeRuntime,
    request: RopeHitRequest
  ): boolean {
    if (!this.runtime.canHitBridgeRopeRuntime(runtime, request)) {
      return false
    }

    if (
      !this.runtime.findHitRopeSegmentInOBB(
        runtime.segmentBodies,
        runtime.segmentBodies.length,
        request
      )
    ) {
      return false
    }

    const damage = this.runtime.getRopeHitDamage(request)
    if (damage <= 0) {
      return false
    }
    this.runtime.markRopeHit(runtime.hitId, request)
    runtime.health -= damage
    if (runtime.health <= 0) {
      runtime.health = 0
      this.runtime.emitRopeHitSound(
        this.runtime.hitRopeSegmentX,
        this.runtime.hitRopeSegmentY
      )
      this.runtime.destroyBridgeRope(runtime)
      return true
    }

    this.runtime.applyRopeHitFeedback(runtime, request)
    return true
  }

  tryHitPlayerRopeInCircle(
    runtime: RopeRuntime,
    request: RopeCircleHitRequest
  ): boolean {
    if (!this.runtime.canHitRopeRuntime(runtime, request)) {
      return false
    }

    const visibleSegmentCount =
      this.runtime.getVisiblePlayerRopeSegmentCount(runtime)
    if (
      !this.runtime.findHitRopeSegmentInCircle(
        runtime.segmentBodies,
        visibleSegmentCount,
        request
      )
    ) {
      return false
    }

    const damage = this.runtime.getRopeHitDamage(request)
    if (damage <= 0) {
      return false
    }
    this.runtime.markRopeHit(runtime.hitId, request)
    runtime.health -= damage
    if (runtime.health <= 0) {
      runtime.health = 0
      this.runtime.emitRopeHitSound(
        this.runtime.hitRopeSegmentX,
        this.runtime.hitRopeSegmentY
      )
      this.runtime.destroyPlayerRopeRuntime(runtime)
      return true
    }

    this.runtime.applyRopeCircleHitFeedback(runtime, request)
    return true
  }

  tryHitBridgeRopeInCircle(
    runtime: RopeBridgeRuntime,
    request: RopeCircleHitRequest
  ): boolean {
    if (!this.runtime.canHitBridgeRopeRuntime(runtime, request)) {
      return false
    }

    if (
      !this.runtime.findHitRopeSegmentInCircle(
        runtime.segmentBodies,
        runtime.segmentBodies.length,
        request
      )
    ) {
      return false
    }

    const damage = this.runtime.getRopeHitDamage(request)
    if (damage <= 0) {
      return false
    }
    this.runtime.markRopeHit(runtime.hitId, request)
    runtime.health -= damage
    if (runtime.health <= 0) {
      runtime.health = 0
      this.runtime.emitRopeHitSound(
        this.runtime.hitRopeSegmentX,
        this.runtime.hitRopeSegmentY
      )
      this.runtime.destroyBridgeRope(runtime)
      return true
    }

    this.runtime.applyRopeCircleHitFeedback(runtime, request)
    return true
  }

  canHitRopeRuntime(
    runtime: RopeRuntime,
    request: RopeHitRequest | RopeCircleHitRequest
  ): boolean {
    return (
      runtime.active &&
      runtime.health > 0 &&
      runtime.hitId > 0 &&
      runtime.renderLayer === request.renderLayer &&
      !this.runtime.isRopeAlreadyHit(runtime.hitId, request)
    )
  }

  canHitBridgeRopeRuntime(
    runtime: RopeBridgeRuntime,
    request: RopeHitRequest | RopeCircleHitRequest
  ): boolean {
    return (
      runtime.active &&
      runtime.health > 0 &&
      runtime.hitId > 0 &&
      runtime.renderLayer === request.renderLayer &&
      !this.runtime.isRopeAlreadyHit(runtime.hitId, request)
    )
  }

  isRopeAlreadyHit(
    hitId: number,
    request: RopeHitRequest | RopeCircleHitRequest
  ): boolean {
    return request.weapon?.hitRopeIds.has(hitId) === true
  }

  markRopeHit(
    hitId: number,
    request: RopeHitRequest | RopeCircleHitRequest
  ): void {
    const weapon = request.weapon
    if (!weapon) {
      return
    }
    weapon.hitRopeIds.add(hitId)
    weapon.groundHitSoundTriggered = true
    weapon.groundHitSoundPending = 0
  }

  getRopeHitDamage(request: RopeHitRequest | RopeCircleHitRequest): number {
    if (!(request.damage > 0)) {
      return 0
    }
    return Math.max(1, Math.trunc(request.damage))
  }

  findHitRopeSegmentInOBB(
    segmentBodies: b2BodyId[],
    segmentCount: number,
    request: RopeHitRequest
  ): boolean {
    const count = Math.min(segmentCount, segmentBodies.length)
    if (count <= 0) {
      return false
    }

    this.runtime.hitRopeSegmentIndex = -1
    for (let i = 0; i < count; i++) {
      const bodyId = segmentBodies[i]
      if (
        !this.runtime.isBodyId(bodyId) ||
        !this.runtime.box2d.b2Body_IsValid(bodyId)
      ) {
        continue
      }
      const pos = this.runtime.box2d.b2Body_GetPosition(bodyId)
      const hit = checkOBBvsCircle(
        request.centerX,
        request.centerY,
        request.width,
        request.height,
        request.rotation,
        pos.x,
        pos.y,
        DEFAULT_GRAPPLE_ROPE_SEGMENT_RADIUS
      )
      if (hit) {
        this.runtime.hitRopeSegmentIndex = i
        this.runtime.hitRopeSegmentX = pos.x
        this.runtime.hitRopeSegmentY = pos.y
        pos.delete()
        return true
      }
      pos.delete()
    }

    return false
  }

  findHitRopeSegmentInCircle(
    segmentBodies: b2BodyId[],
    segmentCount: number,
    request: RopeCircleHitRequest
  ): boolean {
    const count = Math.min(segmentCount, segmentBodies.length)
    if (count <= 0) {
      return false
    }

    const radius = request.radius + DEFAULT_GRAPPLE_ROPE_SEGMENT_RADIUS
    const radiusSq = radius * radius
    this.runtime.hitRopeSegmentIndex = -1
    for (let i = 0; i < count; i++) {
      const bodyId = segmentBodies[i]
      if (
        !this.runtime.isBodyId(bodyId) ||
        !this.runtime.box2d.b2Body_IsValid(bodyId)
      ) {
        continue
      }
      const pos = this.runtime.box2d.b2Body_GetPosition(bodyId)
      const dx = pos.x - request.centerX
      const dy = pos.y - request.centerY
      if (dx * dx + dy * dy <= radiusSq) {
        this.runtime.hitRopeSegmentIndex = i
        this.runtime.hitRopeSegmentX = pos.x
        this.runtime.hitRopeSegmentY = pos.y
        pos.delete()
        return true
      }
      pos.delete()
    }

    return false
  }

  applyRopeHitFeedback(
    runtime: RopeRuntime | RopeBridgeRuntime,
    request: RopeHitRequest
  ): void {
    this.runtime.startRopeHitShake(runtime, request)
    this.runtime.emitRopeHitSound(
      this.runtime.hitRopeSegmentX,
      this.runtime.hitRopeSegmentY
    )
  }

  applyRopeCircleHitFeedback(
    runtime: RopeRuntime | RopeBridgeRuntime,
    request: RopeCircleHitRequest
  ): void {
    this.runtime.startRopeCircleHitShake(runtime, request)
    this.runtime.emitRopeHitSound(
      this.runtime.hitRopeSegmentX,
      this.runtime.hitRopeSegmentY
    )
  }

  startRopeHitShake(
    runtime: RopeRuntime | RopeBridgeRuntime,
    request: RopeHitRequest
  ): void {
    if (
      this.runtime.tryStartRopeHitShakeFromRequestDirection(runtime, request)
    ) {
      return
    }
    const dx = this.runtime.hitRopeSegmentX - request.centerX
    const dy = this.runtime.hitRopeSegmentY - request.centerY
    const distSq = dx * dx + dy * dy
    let dirX = 0
    let dirY = 0
    if (distSq > 0.0001) {
      const invDist = 1 / Math.sqrt(distSq)
      dirX = dx * invDist
      dirY = dy * invDist
    } else {
      dirX = Math.cos(request.rotation)
      dirY = Math.sin(request.rotation)
    }

    this.runtime.startRopeHitShakeWithDirection(runtime, dirX, dirY)
  }

  startRopeCircleHitShake(
    runtime: RopeRuntime | RopeBridgeRuntime,
    request: RopeCircleHitRequest
  ): void {
    if (
      this.runtime.tryStartRopeHitShakeFromRequestDirection(runtime, request)
    ) {
      return
    }
    const dx = this.runtime.hitRopeSegmentX - request.centerX
    const dy = this.runtime.hitRopeSegmentY - request.centerY
    const distSq = dx * dx + dy * dy
    let dirX = 0
    let dirY = -1
    if (distSq > 0.0001) {
      const invDist = 1 / Math.sqrt(distSq)
      dirX = dx * invDist
      dirY = dy * invDist
    }

    this.runtime.startRopeHitShakeWithDirection(runtime, dirX, dirY)
  }

  tryStartRopeHitShakeFromRequestDirection(
    runtime: RopeRuntime | RopeBridgeRuntime,
    request: RopeHitRequest | RopeCircleHitRequest
  ): boolean {
    const dirX = request.hitDirX ?? 0
    const dirY = request.hitDirY ?? 0
    const distSq = dirX * dirX + dirY * dirY
    if (distSq <= 0.0001) {
      return false
    }
    const invDist = 1 / Math.sqrt(distSq)
    this.runtime.startRopeHitShakeWithDirection(
      runtime,
      dirX * invDist,
      dirY * invDist
    )
    return true
  }

  startRopeHitShakeWithDirection(
    runtime: RopeRuntime | RopeBridgeRuntime,
    dirX: number,
    dirY: number
  ): void {
    runtime.hitShakeSegmentIndex = this.runtime.hitRopeSegmentIndex
    runtime.hitShakeStartTimeMs = this.runtime.currentTimeMs
    runtime.hitShakeEndTimeMs =
      this.runtime.currentTimeMs + this.runtime.ropeHitShakeDurationMs
    runtime.hitShakeDirX = dirX
    runtime.hitShakeDirY = dirY
  }

  emitRopeHitSound(x: number, y: number): void {
    this.runtime.statsSystem?.playSoundAt(SOUND_IDS.BODY_HIT, x, y)
  }
}
