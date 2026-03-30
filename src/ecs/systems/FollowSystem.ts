import {
  FOLLOW_BLOCK_CHECK_DISTANCE,
  FOLLOW_POSITION_CHECK_INTERVAL_MS,
  FOLLOW_STUCK_THRESHOLD_MS,
} from '../../constants'
import type { FollowComponent } from '../Component'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import { System } from '../System'

export class FollowSystem extends System {
  private currentTimeMs = 0
  private entityLookup?: (id: number) => Entity | undefined

  constructor() {
    super()
    const transformType = componentRegistry.getComponentType('Transform')
    const inputType = componentRegistry.getComponentType('Input')
    const followType = componentRegistry.getComponentType('Follow')
    this.setRequiredComponents([transformType, inputType, followType])
  }

  setEntityLookup(lookup: (id: number) => Entity | undefined): void {
    this.entityLookup = lookup
  }

  update(entities: Entity[], deltaTime: number): void {
    const deltaMs = deltaTime > 0 ? deltaTime * 1000 : 0
    this.currentTimeMs += deltaMs
    const now = this.currentTimeMs

    for (const entity of entities) {
      if (!entity.transform || !entity.input || !entity.follow) continue
      const follow = entity.follow
      if (follow.bondFlashTimer > 0) {
        follow.bondFlashTimer = Math.max(0, follow.bondFlashTimer - deltaMs)
      }
      if (follow.unbondFlashTimer > 0) {
        follow.unbondFlashTimer = Math.max(0, follow.unbondFlashTimer - deltaMs)
      }
      if (entity.stats?.isDead) {
        entity.input.moveDirection = 0
        entity.input.sprintRequested = false
        continue
      }
      if (entity.movement && entity.movement.knockbackEndTime > now) continue
      // 战斗中由 EnemyAI 负责，不干预
      if (entity.stats?.isInCombat) continue

      if (follow.followTargetId === null) {
        follow.state = 'idle'
        entity.input.moveDirection = 0
        entity.input.sprintRequested = false
        continue
      }

      const target = this.entityLookup?.(follow.followTargetId)
      if (!target?.transform || target.stats?.isDead) {
        follow.state = 'idle'
        entity.input.moveDirection = 0
        entity.input.sprintRequested = false
        continue
      }

      const dx = target.transform.x - entity.transform.x
      const dy = target.transform.y - entity.transform.y
      const fullDist = Math.hypot(dx, dy)

      follow.lastKnownTargetX = target.transform.x
      follow.lastKnownTargetY = target.transform.y
      follow.hasKnownPosition = true

      // 超出感知范围则停止追随
      const detectionRange = entity.sensor?.radius ?? follow.maxDistance
      if (fullDist > detectionRange) {
        follow.state = 'idle'
        entity.input.moveDirection = 0
        entity.input.sprintRequested = false
        entity.input.facingOverride = null
        follow.stuckTimer = 0
        follow.lastPositionUpdateTime = 0
        continue
      }

      const facing = dx >= 0 ? 1 : -1

      // 优先处理障碍跳跃序列
      if (follow.obstacleJumpStage > 0) {
        this.handleObstacleJump(entity, follow, now)
        continue
      }

      // 太近，退步
      if (fullDist < follow.minDistance) {
        entity.input.moveDirection = -facing as -1 | 1
        entity.input.sprintRequested = false
        entity.input.facingOverride = facing
        follow.state = 'following'
        continue
      }

      // 在舒适范围内，停下等待并朝向目标
      if (fullDist <= follow.preferredDistance) {
        entity.input.moveDirection = 0
        entity.input.sprintRequested = false
        entity.input.facingOverride = facing
        follow.state = 'waiting'
        follow.stuckTimer = 0
        follow.lastPositionUpdateTime = 0
        continue
      }

      // 需要靠近目标，先检查是否挡路
      if (this.isBlockingPath(entity, target, fullDist)) {
        const targetMoveDir =
          target.input?.moveDirection || target.input?.lastMoveDirection || 0
        if (targetMoveDir !== 0) {
          entity.input.moveDirection = targetMoveDir as -1 | 1
          entity.input.sprintRequested = true
          entity.input.facingOverride = targetMoveDir as -1 | 1
          follow.state = 'following'
          this.checkStuck(entity, follow, now)
          continue
        }
      }

      // 正常追随
      follow.state = 'following'
      entity.input.moveDirection = facing
      entity.input.sprintRequested = fullDist > follow.maxDistance
      entity.input.facingOverride = facing
      this.checkStuck(entity, follow, now)
    }
  }

  // 判断追随者是否挡在目标移动路径上
  private isBlockingPath(
    follower: Entity,
    target: Entity,
    distance: number
  ): boolean {
    if (!follower.transform || !target.transform || !target.input) return false
    const targetMoveDir =
      target.input.moveDirection || target.input.lastMoveDirection
    if (targetMoveDir === 0) return false
    const dx = follower.transform.x - target.transform.x
    // 追随者在目标移动方向的前方
    return dx * targetMoveDir > 0 && distance < FOLLOW_BLOCK_CHECK_DISTANCE
  }

  private checkStuck(
    entity: Entity,
    follow: FollowComponent,
    now: number
  ): void {
    if (!entity.transform || !entity.movement) return

    if (follow.lastPositionUpdateTime === 0) {
      follow.lastPositionUpdateTime = now
      follow.lastPositionX = entity.transform.x
      follow.lastPositionY = entity.transform.y
      return
    }

    if (
      now - follow.lastPositionUpdateTime >
      FOLLOW_POSITION_CHECK_INTERVAL_MS
    ) {
      const moved = Math.hypot(
        entity.transform.x - follow.lastPositionX,
        entity.transform.y - follow.lastPositionY
      )
      if (moved < 0.2) {
        follow.stuckTimer += now - follow.lastPositionUpdateTime
      } else {
        follow.stuckTimer = 0
      }
      follow.lastPositionX = entity.transform.x
      follow.lastPositionY = entity.transform.y
      follow.lastPositionUpdateTime = now
    }

    if (follow.stuckTimer > FOLLOW_STUCK_THRESHOLD_MS) {
      this.tryTriggerObstacleJump(entity, follow, now)
      follow.stuckTimer = 0
    }
  }

  private tryTriggerObstacleJump(
    entity: Entity,
    follow: FollowComponent,
    now: number
  ): void {
    if (
      !entity.movement?.isTouchingWall ||
      follow.obstacleJumpStage !== 0 ||
      !entity.input ||
      !entity.transform
    )
      return

    const moveDir =
      entity.input.moveDirection !== 0
        ? entity.input.moveDirection
        : entity.input.lastMoveDirection !== 0
          ? entity.input.lastMoveDirection
          : 1
    follow.obstacleJumpDirection = (moveDir >= 0 ? 1 : -1) as -1 | 1
    entity.input.jumpRequested = true
    entity.input.inputBuffer.bufferAction('jump')
    follow.obstacleJumpStage = 1
    follow.jumpStartTimestamp = now
    follow.jumpStartX = entity.transform.x
    follow.jumpStartY = entity.transform.y
  }

  private handleObstacleJump(
    entity: Entity,
    follow: FollowComponent,
    now: number
  ): void {
    if (!entity.movement || !entity.input || !entity.transform) return
    entity.input.moveDirection = follow.obstacleJumpDirection

    if (follow.obstacleJumpStage === 1) {
      if (now - follow.jumpStartTimestamp >= 300) {
        entity.input.jumpRequested = true
        entity.input.inputBuffer.bufferAction('jump')
        follow.obstacleJumpStage = 2
        follow.jumpStartTimestamp = now
      }
      return
    }

    if (follow.obstacleJumpStage === 2) {
      if (now - follow.jumpStartTimestamp < 500) return
      if (entity.movement.isGrounded) {
        follow.obstacleJumpStage = 0
        follow.stuckTimer = 0
        follow.lastPositionUpdateTime = 0
      }
    }
  }
}
