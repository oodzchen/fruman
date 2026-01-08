import {
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_WEAPON_ATTACK_PAUSE_MS,
  DEFAULT_WEAPON_ATTACK_RADIUS,
  DEFAULT_WEAPON_ATTACK_RECOVER_MS,
  DEFAULT_WEAPON_ATTACK_SWING_MS,
  DEFAULT_WEAPON_ATTACK_WINDUP_MS,
  DEFAULT_WEAPON_CENTER_OFFSET_X,
  DEFAULT_WEAPON_COMBAT_TIMEOUT_MS,
  DEFAULT_WEAPON_FINAL_WINDUP_MS,
  DEFAULT_WEAPON_FOLLOW_OFFSET_X,
  DEFAULT_WEAPON_FOLLOW_OFFSET_Y,
  DEFAULT_WEAPON_FRONT_OFFSET_X,
  DEFAULT_WEAPON_FRONT_OFFSET_Y,
  DEFAULT_WEAPON_PICKUP_DISTANCE,
  DEFAULT_WEAPON_PLAYER_CLEARANCE,
  DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
} from '../../constants'
import type { MainModule, b2BodyId } from '../../types'
import type { WeaponRelativeTransform, WeaponTransform } from '../Component'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import { System } from '../System'
import type { StatsSystem } from './StatsSystem'

// 控制向前挥砍时的下压角度（0 为水平向前，正值顺时针向下）
const FRONT_SWING_TILT_RAD = Math.PI / 16
const REBOUND_PAUSE_MS = 150

type ObstacleCollider = {
  bodyId: b2BodyId
  width: number
  height: number
}

export class WeaponSystem extends System {
  private box2d?: MainModule
  private obstacles: ObstacleCollider[] = []
  private statsSystem?: StatsSystem
  private allEntities: Entity[] = []

  constructor(box2d?: MainModule, statsSystem?: StatsSystem) {
    super()
    this.box2d = box2d
    this.statsSystem = statsSystem

    const transformType = componentRegistry.getComponentType('Transform')
    const weaponType = componentRegistry.getComponentType('Weapon')
    this.setRequiredComponents([transformType, weaponType])
  }

  update(entities: Entity[], deltaTime: number): void {
    const deltaMs = Math.max(0, deltaTime * 1000)

    for (const entity of entities) {
      if (!entity.transform || !entity.weapon) continue
      entity.weapon.isColliding = false
      if (entity.stats?.isDead) {
        this.resetWeaponState(entity)
        continue
      }
      this.updateWeapon(entity, deltaMs)
    }
  }

  setEntities(entities: Entity[]): void {
    this.allEntities = entities
  }

  private updateWeapon(entity: Entity, deltaMs: number): void {
    if (!entity.transform || !entity.weapon) return

    const weapon = entity.weapon
    const playerPos = { x: entity.transform.x, y: entity.transform.y }
    const inputFacing =
      entity.input && entity.input.lastMoveDirection !== 0
        ? entity.input.lastMoveDirection
        : weapon.attackFacing

    if (weapon.attackPhase === 'idle') {
      weapon.attackFacing = inputFacing
    }

    if (!weapon.isEquipped) {
      weapon.visual = {
        x: weapon.position.x,
        y: weapon.position.y,
        rotation: weapon.rotation,
      }
      return
    }

    const now = Date.now()
    const attackRadius = weapon.attackRadius || this.getAttackRadius(weapon)
    const attackFacing = weapon.attackFacing

    const attackStartTransform = this.applyOffset(
      weapon.attackStartOffset,
      playerPos
    )
    const swingStartTransform = this.applyOffset(
      weapon.swingStartOffset,
      playerPos
    )
    const swingEndTransform = this.applyOffset(weapon.swingEndOffset, playerPos)
    weapon.attackStartTransform = attackStartTransform
    weapon.swingStartTransform = swingStartTransform
    weapon.swingEndTransform = swingEndTransform

    const hasTimedOut =
      weapon.isInCombat &&
      now - weapon.lastAttackTimestamp > DEFAULT_WEAPON_COMBAT_TIMEOUT_MS
    if (hasTimedOut) {
      weapon.isInCombat = false
      weapon.comboCount = 0
      weapon.attackQueued = false
      weapon.nextSwingDirection = 'toFront'
    }

    if (weapon.attackPhase === 'idle') {
      this.handleIdlePhase(entity, playerPos, attackRadius, attackFacing, now)
      return
    }

    weapon.attackElapsedMs += deltaMs

    if (weapon.attackPhase === 'windup') {
      this.handleWindupPhase(weapon, entity, playerPos)
      return
    }

    if (weapon.attackPhase === 'finalWindup') {
      this.handleFinalWindupPhase(weapon, entity, playerPos)
      return
    }

    if (weapon.attackPhase === 'swing') {
      this.handleSwingPhase(entity, playerPos, now)
      return
    }

    if (weapon.attackPhase === 'rebound') {
      this.handleReboundPhase(weapon, playerPos, now)
      return
    }

    if (weapon.attackPhase === 'pause') {
      this.handlePausePhase(entity, playerPos, attackRadius, attackFacing, now)
      return
    }

    if (weapon.attackPhase === 'recover') {
      this.handleRecoverPhase(entity, playerPos, now)
    }
  }

  private handleIdlePhase(
    entity: Entity,
    playerPos: { x: number; y: number },
    attackRadius: number,
    attackFacing: number,
    now: number
  ): void {
    if (!entity.input || !entity.weapon) return

    const weapon = entity.weapon
    const facing =
      entity.input.lastMoveDirection !== 0 ? entity.input.lastMoveDirection : 1

    weapon.visual = weapon.isInCombat
      ? this.getFrontTransform(playerPos, facing)
      : this.getBackTransform(playerPos, facing)

    if (weapon.attackQueued && weapon.comboCount < 5) {
      weapon.attackQueued = false
      weapon.comboCount += 1
      weapon.swingDirection = weapon.nextSwingDirection
      weapon.nextSwingDirection =
        weapon.swingDirection === 'toFront' ? 'toHead' : 'toFront'
      const { swingStartTransform, swingEndTransform } =
        this.getSwingTransforms(
          attackRadius,
          attackFacing,
          weapon.swingDirection,
          playerPos
        )
      const attackStartOffset = this.getOffsetFromTransform(
        weapon.visual,
        playerPos
      )
      const swingStartOffset = this.getOffsetFromTransform(
        swingStartTransform,
        playerPos
      )
      const swingEndOffset = this.getOffsetFromTransform(
        swingEndTransform,
        playerPos
      )
      weapon.isInCombat = true
      weapon.attackPhase = 'windup'
      weapon.attackElapsedMs = 0
      weapon.lastAttackTimestamp = now
      weapon.attackFacing = attackFacing
      weapon.attackStartOffset = attackStartOffset
      weapon.swingStartOffset = swingStartOffset
      weapon.swingEndOffset = swingEndOffset
      weapon.attackStartTransform = this.applyOffset(
        attackStartOffset,
        playerPos
      )
      weapon.swingStartTransform = swingStartTransform
      weapon.swingEndTransform = swingEndTransform
      weapon.attackRadius = attackRadius
      weapon.visual = this.applyOffset(attackStartOffset, playerPos)
      weapon.hitEntityIds.clear()
    }
  }

  private handleWindupPhase(
    weapon: Entity['weapon'],
    entity?: Entity,
    playerPos?: { x: number; y: number }
  ): void {
    if (!weapon) return

    if (entity && playerPos && entity.input) {
      const currentFacing =
        entity.input.lastMoveDirection !== 0
          ? entity.input.lastMoveDirection
          : weapon.attackFacing

      if (currentFacing !== weapon.attackFacing) {
        this.retractWeaponOnDirectionChange(entity, weapon, playerPos)
        return
      }
    }

    const t = this.clamp01(
      weapon.attackElapsedMs / DEFAULT_WEAPON_ATTACK_WINDUP_MS
    )
    const target = weapon.swingStartTransform
    weapon.visual = this.lerpTransform(weapon.attackStartTransform, target, t)
    if (t >= 1) {
      weapon.attackPhase = 'swing'
      weapon.attackElapsedMs = 0
      weapon.attackStartTransform = weapon.swingStartTransform
      weapon.hitEntityIds.clear()
    }
  }

  private handleFinalWindupPhase(
    weapon: Entity['weapon'],
    entity?: Entity,
    playerPos?: { x: number; y: number }
  ): void {
    if (!weapon) return

    if (entity && playerPos && entity.input) {
      const currentFacing =
        entity.input.lastMoveDirection !== 0
          ? entity.input.lastMoveDirection
          : weapon.attackFacing

      if (currentFacing !== weapon.attackFacing) {
        this.retractWeaponOnDirectionChange(entity, weapon, playerPos)
        return
      }
    }

    const t = this.clamp01(
      weapon.attackElapsedMs / DEFAULT_WEAPON_FINAL_WINDUP_MS
    )
    const target = weapon.swingStartTransform
    weapon.visual = this.lerpTransform(weapon.attackStartTransform, target, t)
    if (t >= 1) {
      weapon.attackPhase = 'swing'
      weapon.attackElapsedMs = 0
      weapon.attackStartTransform = weapon.swingStartTransform
      weapon.hitEntityIds.clear()
    }
  }

  private handleSwingPhase(
    entity: Entity,
    playerPos: { x: number; y: number },
    now: number
  ): void {
    if (!entity.weapon) return
    const weapon = entity.weapon

    const t = this.clamp01(
      weapon.attackElapsedMs / DEFAULT_WEAPON_ATTACK_SWING_MS
    )
    const from = weapon.swingStartTransform
    const to = weapon.swingEndTransform
    weapon.visual = this.lerpTransform(from, to, t)
    if (this.checkObstacleCollision(weapon)) {
      weapon.isColliding = true
      this.applyPushback(entity, weapon)
      this.startRebound(entity, playerPos, now)
      return
    }
    this.checkEntityHits(entity, weapon)
    if (t >= 1) {
      weapon.attackPhase = 'pause'
      weapon.attackElapsedMs = 0
      weapon.attackStartOffset = this.getOffsetFromTransform(
        weapon.visual,
        playerPos
      )
      weapon.attackStartTransform = weapon.visual
      weapon.lastAttackTimestamp = now
    }
  }

  private handlePausePhase(
    entity: Entity,
    playerPos: { x: number; y: number },
    attackRadius: number,
    attackFacing: number,
    now: number
  ): void {
    if (!entity.weapon) return

    const weapon = entity.weapon
    const currentFacing =
      entity.input && entity.input.lastMoveDirection !== 0
        ? entity.input.lastMoveDirection
        : attackFacing
    if (currentFacing !== weapon.attackFacing) {
      this.retractWeaponOnDirectionChange(entity, weapon, playerPos)
      return
    }

    weapon.visual = weapon.attackStartTransform

    if (entity.movement && !entity.movement.isGrounded) {
      this.checkEntityHits(entity, weapon)
    }

    const pauseThreshold = weapon.reboundLockedPause
      ? Math.max(REBOUND_PAUSE_MS, DEFAULT_WEAPON_ATTACK_PAUSE_MS)
      : DEFAULT_WEAPON_ATTACK_PAUSE_MS
    const reachedPause = weapon.attackElapsedMs >= pauseThreshold
    if (weapon.reboundLockedPause && !reachedPause) {
      return
    }
    if (weapon.reboundLockedPause && reachedPause) {
      weapon.reboundLockedPause = false
    }

    const canChain =
      weapon.attackQueued &&
      weapon.comboCount < 5 &&
      weapon.attackPhase !== 'rebound'

    if (canChain) {
      weapon.attackQueued = false
      weapon.comboCount += 1
      const isFinalAttack = weapon.comboCount === 5

      weapon.swingDirection = weapon.nextSwingDirection
      weapon.nextSwingDirection =
        weapon.swingDirection === 'toFront' ? 'toHead' : 'toFront'

      const frontAngle =
        weapon.attackFacing === 1
          ? FRONT_SWING_TILT_RAD
          : -Math.PI - FRONT_SWING_TILT_RAD
      const headAngle = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD

      if (isFinalAttack) {
        const finalWindupRadius = attackRadius * 1.5
        const windupAngle =
          weapon.swingDirection === 'toFront' ? headAngle : frontAngle
        const finalWindupTransform = this.getTransformAtAngle(
          playerPos,
          windupAngle,
          finalWindupRadius
        )
        const finalWindupOffset = this.getOffsetFromTransform(
          finalWindupTransform,
          playerPos
        )

        const swingEndAngle =
          weapon.swingDirection === 'toFront' ? frontAngle : headAngle
        const swingEndTransform = this.getTransformAtAngle(
          playerPos,
          swingEndAngle,
          attackRadius
        )
        const swingEndOffset = this.getOffsetFromTransform(
          swingEndTransform,
          playerPos
        )

        weapon.attackPhase = 'finalWindup'
        weapon.attackElapsedMs = 0
        weapon.attackStartOffset = this.getOffsetFromTransform(
          weapon.visual,
          playerPos
        )
        weapon.swingStartOffset = finalWindupOffset
        weapon.swingEndOffset = swingEndOffset
        weapon.attackStartTransform = weapon.visual
        weapon.swingStartTransform = finalWindupTransform
        weapon.swingEndTransform = swingEndTransform
        weapon.lastAttackTimestamp = now
        return
      }

      const swingEndAngle =
        weapon.swingDirection === 'toFront' ? frontAngle : headAngle
      const swingEndTransform = this.getTransformAtAngle(
        playerPos,
        swingEndAngle,
        attackRadius
      )

      const swingStartOffset = this.getOffsetFromTransform(
        weapon.visual,
        playerPos
      )
      const swingEndOffset = this.getOffsetFromTransform(
        swingEndTransform,
        playerPos
      )

      weapon.attackPhase = 'swing'
      weapon.attackElapsedMs = 0
      weapon.swingStartOffset = swingStartOffset
      weapon.swingEndOffset = swingEndOffset
      weapon.swingStartTransform = weapon.visual
      weapon.swingEndTransform = swingEndTransform
      weapon.attackStartTransform = weapon.visual
      weapon.lastAttackTimestamp = now
      weapon.hitEntityIds.clear()
      return
    }

    if (!reachedPause) return

    weapon.attackPhase = 'recover'
    weapon.reboundLockedPause = false
    weapon.attackElapsedMs = 0
    weapon.attackStartTransform = weapon.visual
  }

  private handleRecoverPhase(
    entity: Entity,
    playerPos: { x: number; y: number },
    now: number
  ): void {
    if (!entity.input || !entity.weapon) return

    const weapon = entity.weapon
    const facing =
      entity.input.lastMoveDirection !== 0 ? entity.input.lastMoveDirection : 1

    if (facing !== weapon.attackFacing) {
      this.retractWeaponOnDirectionChange(entity, weapon, playerPos)
      return
    }

    const t = this.clamp01(
      weapon.attackElapsedMs / DEFAULT_WEAPON_ATTACK_RECOVER_MS
    )
    const target = this.getFrontTransform(playerPos, facing)
    weapon.visual = this.lerpTransform(weapon.attackStartTransform, target, t)
    if (t >= 1) {
      weapon.attackPhase = 'idle'
      weapon.attackElapsedMs = 0
      weapon.lastAttackTimestamp = now
      weapon.attackQueued = false
      weapon.comboCount = 0
      weapon.swingDirection = 'toFront'
      weapon.nextSwingDirection = 'toFront'
      weapon.attackRadius = DEFAULT_WEAPON_ATTACK_RADIUS
    }
  }

  tryPickUpWeapon(entity: Entity): void {
    if (!entity.transform || !entity.weapon) return
    if (entity.weapon.isEquipped) return
    if (entity.stats?.isDead) return

    const playerPos = { x: entity.transform.x, y: entity.transform.y }
    const dx = playerPos.x - entity.weapon.position.x
    const dy = playerPos.y - entity.weapon.position.y
    const distance = Math.hypot(dx, dy)

    if (distance > DEFAULT_WEAPON_PICKUP_DISTANCE) return

    entity.weapon.isEquipped = true
    entity.weapon.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
    entity.weapon.visual.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
    if (entity.movement) {
      entity.movement.carryWeight = entity.weapon.weight
    }
  }

  startAttack(entity: Entity): void {
    if (!entity.transform || !entity.input || !entity.weapon) return
    if (!entity.weapon.isEquipped) return
    if (entity.stats?.isDead) return

    const weapon = entity.weapon
    const now = Date.now()
    const playerPos = { x: entity.transform.x, y: entity.transform.y }
    const facing =
      entity.input.lastMoveDirection !== 0 ? entity.input.lastMoveDirection : 1
    const attackRadius = this.getAttackRadius(weapon)
    weapon.attackRadius = attackRadius
    weapon.attackFacing = facing

    if (weapon.comboCount >= 5) return

    if (weapon.attackPhase === 'idle') {
      const { swingStartTransform, swingEndTransform } =
        this.getSwingTransforms(
          attackRadius,
          facing,
          weapon.swingDirection,
          playerPos
        )
      const attackStartOffset = this.getOffsetFromTransform(
        {
          x: weapon.visual.x,
          y: weapon.visual.y,
          rotation: weapon.visual.rotation,
        },
        playerPos
      )
      const swingStartOffset = this.getOffsetFromTransform(
        swingStartTransform,
        playerPos
      )
      const swingEndOffset = this.getOffsetFromTransform(
        swingEndTransform,
        playerPos
      )

      weapon.swingDirection = weapon.nextSwingDirection
      weapon.nextSwingDirection =
        weapon.swingDirection === 'toFront' ? 'toHead' : 'toFront'
      weapon.isInCombat = true
      weapon.attackPhase = 'windup'
      weapon.attackElapsedMs = 0
      weapon.lastAttackTimestamp = now
      weapon.attackStartOffset = attackStartOffset
      weapon.swingStartOffset = swingStartOffset
      weapon.swingEndOffset = swingEndOffset
      weapon.attackStartTransform = this.applyOffset(
        attackStartOffset,
        playerPos
      )
      weapon.swingStartTransform = swingStartTransform
      weapon.swingEndTransform = swingEndTransform
      weapon.attackRadius = attackRadius
      weapon.comboCount = 1
      weapon.attackQueued = false
      weapon.visual = this.applyOffset(attackStartOffset, playerPos)
      weapon.hitEntityIds.clear()
      return
    }

    if (!weapon.attackQueued) {
      weapon.attackQueued = true
      weapon.lastAttackTimestamp = now
    }
  }

  private getAttackRadius(weapon: Entity['weapon']): number {
    if (!weapon) {
      return DEFAULT_WEAPON_ATTACK_RADIUS
    }
    const minRadius =
      DEFAULT_PLAYER_RADIUS + weapon.width / 2 + DEFAULT_WEAPON_PLAYER_CLEARANCE
    return Math.max(DEFAULT_WEAPON_ATTACK_RADIUS, minRadius)
  }

  private clamp01(value: number): number {
    if (value < 0) return 0
    if (value > 1) return 1
    return value
  }

  private lerpTransform(
    from: WeaponTransform,
    to: WeaponTransform,
    t: number
  ): WeaponTransform {
    const clampedT = this.clamp01(t)
    return {
      x: from.x + (to.x - from.x) * clampedT,
      y: from.y + (to.y - from.y) * clampedT,
      rotation: from.rotation + (to.rotation - from.rotation) * clampedT,
    }
  }

  private getOffsetFromTransform(
    transform: WeaponTransform,
    playerPos: { x: number; y: number }
  ): WeaponRelativeTransform {
    return {
      dx: transform.x - playerPos.x,
      dy: transform.y - playerPos.y,
      rotation: transform.rotation,
    }
  }

  private applyOffset(
    offset: WeaponRelativeTransform,
    playerPos: { x: number; y: number }
  ): WeaponTransform {
    return {
      x: playerPos.x + offset.dx,
      y: playerPos.y + offset.dy,
      rotation: offset.rotation,
    }
  }

  private realignToFacing(
    weapon: Entity['weapon'],
    playerPos: { x: number; y: number },
    facing: number,
    minimumElapsedMs: number
  ): void {
    if (!weapon) return
    const frontTransform = this.getFrontTransform(playerPos, facing)
    const offset = this.getOffsetFromTransform(frontTransform, playerPos)
    weapon.attackFacing = facing
    weapon.attackStartTransform = frontTransform
    weapon.attackStartOffset = offset
    weapon.swingStartTransform = frontTransform
    weapon.swingEndTransform = frontTransform
    weapon.swingStartOffset = offset
    weapon.swingEndOffset = offset
    weapon.visual = frontTransform
    weapon.attackElapsedMs = Math.max(weapon.attackElapsedMs, minimumElapsedMs)
  }

  private getBackTransform(
    playerPos: { x: number; y: number },
    facing: number
  ): WeaponTransform {
    return {
      x: playerPos.x - facing * DEFAULT_WEAPON_FOLLOW_OFFSET_X,
      y: playerPos.y + DEFAULT_WEAPON_FOLLOW_OFFSET_Y,
      rotation: DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
    }
  }

  private getFrontTransform(
    playerPos: { x: number; y: number },
    facing: number
  ): WeaponTransform {
    return {
      x: playerPos.x + facing * DEFAULT_WEAPON_CENTER_OFFSET_X,
      y: playerPos.y + DEFAULT_WEAPON_FRONT_OFFSET_Y,
      rotation: DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
    }
  }

  private getSwingTransforms(
    radius: number,
    facing: number,
    direction: 'toFront' | 'toHead',
    playerPos: { x: number; y: number }
  ): {
    swingStartTransform: WeaponTransform
    swingEndTransform: WeaponTransform
  } {
    const frontAngle =
      facing === 1 ? FRONT_SWING_TILT_RAD : -Math.PI - FRONT_SWING_TILT_RAD
    const headAngle = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
    const swingStartAngle = direction === 'toFront' ? headAngle : frontAngle
    const swingEndAngle = direction === 'toFront' ? frontAngle : headAngle

    return {
      swingStartTransform: this.getTransformAtAngle(
        playerPos,
        swingStartAngle,
        radius
      ),
      swingEndTransform: this.getTransformAtAngle(
        playerPos,
        swingEndAngle,
        radius
      ),
    }
  }

  setObstacles(obstacles: ObstacleCollider[]): void {
    this.obstacles = obstacles
  }

  private retractWeaponOnDirectionChange(
    entity: Entity,
    weapon: Entity['weapon'],
    playerPos: { x: number; y: number }
  ): void {
    if (!weapon || !entity.input) return

    const newFacing =
      entity.input.lastMoveDirection !== 0
        ? entity.input.lastMoveDirection
        : weapon.attackFacing

    weapon.attackPhase = 'idle'
    weapon.attackElapsedMs = 0
    weapon.attackQueued = false
    weapon.attackFacing = newFacing
    weapon.comboCount = 0
    weapon.swingDirection = 'toFront'
    weapon.nextSwingDirection = 'toFront'
    weapon.hitEntityIds.clear()

    weapon.visual = this.getFrontTransform(playerPos, newFacing)
  }

  private resetWeaponState(entity: Entity): void {
    if (!entity.weapon) return

    const weapon = entity.weapon
    weapon.attackQueued = false
    weapon.isInCombat = false
    weapon.attackPhase = 'idle'
    weapon.attackElapsedMs = 0
    weapon.isColliding = false
    weapon.hitEntityIds.clear()

    if (!entity.transform) return

    if (!weapon.isEquipped) {
      weapon.visual = {
        x: weapon.position.x,
        y: weapon.position.y,
        rotation: weapon.rotation,
      }
      return
    }

    const facing =
      entity.input && entity.input.lastMoveDirection !== 0
        ? entity.input.lastMoveDirection
        : 1
    const playerPos = { x: entity.transform.x, y: entity.transform.y }
    weapon.visual = this.getBackTransform(playerPos, facing)
  }

  private checkObstacleCollision(weapon?: Entity['weapon']): boolean {
    if (!this.box2d || !weapon) return false
    if (this.obstacles.length === 0) return false

    const { b2Body_GetPosition } = this.box2d
    const wx = weapon.visual.x
    const wy = weapon.visual.y
    const weaponRadius = Math.hypot(weapon.width / 2, weapon.height / 2)

    for (const obstacle of this.obstacles) {
      const pos = b2Body_GetPosition(obstacle.bodyId)
      const halfW = obstacle.width
      const halfH = obstacle.height
      const closestX = Math.max(pos.x - halfW, Math.min(wx, pos.x + halfW))
      const closestY = Math.max(pos.y - halfH, Math.min(wy, pos.y + halfH))
      const dx = wx - closestX
      const dy = wy - closestY
      pos.delete()

      if (dx * dx + dy * dy <= weaponRadius * weaponRadius) {
        return true
      }
    }

    return false
  }

  private applyPushback(entity: Entity, weapon: Entity['weapon']): void {
    if (!entity.physics || !this.box2d || !weapon) return

    const { b2Body_ApplyLinearImpulseToCenter, b2Vec2 } = this.box2d
    const dirX = Math.cos(weapon.visual.rotation)
    const dirY = Math.sin(weapon.visual.rotation)
    const impulseStrength = 0.2
    const impulse = new b2Vec2(-dirX * impulseStrength, -dirY * impulseStrength)
    b2Body_ApplyLinearImpulseToCenter(entity.physics.bodyId, impulse, true)
    impulse.delete()
  }

  private checkEntityHits(attacker: Entity, weapon: Entity['weapon']): void {
    if (!this.statsSystem) return
    if (!attacker.transform || !attacker.faction) return
    if (!weapon || !weapon.hitEntityIds) return

    const attackRadius =
      weapon.attackRadius !== 0
        ? weapon.attackRadius
        : this.getAttackRadius(weapon)
    const weaponX = weapon.visual.x
    const weaponY = weapon.visual.y

    for (const target of this.allEntities) {
      if (!target || target.id === attacker.id) continue
      if (!target.transform || !target.stats || target.stats.isDead) continue
      if (!target.faction || !attacker.faction.canAttack(target.faction))
        continue

      const targetRadius = target.render?.radius ?? DEFAULT_PLAYER_RADIUS
      const hitRange = attackRadius + targetRadius
      const dx = weaponX - target.transform.x
      const dy = weaponY - target.transform.y
      if (dx * dx + dy * dy > hitRange * hitRange) continue

      if (weapon.hitEntityIds.has(target.id)) continue

      this.statsSystem.applyWeaponHit(target, weapon, {
        x: weaponX,
        y: weaponY,
      })
      weapon.isColliding = true
      weapon.hitEntityIds.add(target.id)
    }
  }

  private startRebound(
    entity: Entity,
    playerPos: { x: number; y: number },
    now: number
  ): void {
    if (!entity.weapon) return
    const weapon = entity.weapon
    const radius =
      weapon.attackRadius !== 0
        ? weapon.attackRadius
        : this.getAttackRadius(weapon)
    const reboundTargetOffset = this.getOffsetFromTransform(
      weapon.swingStartTransform,
      playerPos
    )
    const reboundTransform = this.applyOffset(reboundTargetOffset, playerPos)
    weapon.attackPhase = 'rebound'
    weapon.attackElapsedMs = 0
    weapon.attackQueued = false
    weapon.reboundLockedPause = true
    weapon.reboundTargetTransform = reboundTransform
    weapon.reboundTargetOffset = reboundTargetOffset
    const currentOffset = this.getOffsetFromTransform(weapon.visual, playerPos)
    weapon.attackStartOffset = currentOffset
    weapon.swingStartOffset = currentOffset
    weapon.swingEndOffset = reboundTargetOffset
    weapon.attackStartTransform = weapon.visual
    weapon.swingStartTransform = weapon.visual
    weapon.swingEndTransform = reboundTransform
    weapon.lastAttackTimestamp = now
    weapon.hitEntityIds.clear()
  }

  private handleReboundPhase(
    weapon: Entity['weapon'],
    playerPos: { x: number; y: number },
    now: number
  ): void {
    if (!weapon) return

    const reboundDurationMs = DEFAULT_WEAPON_ATTACK_SWING_MS * 0.8
    const target =
      weapon.reboundTargetOffset && playerPos
        ? this.applyOffset(weapon.reboundTargetOffset, playerPos)
        : weapon.reboundTargetTransform || weapon.swingEndTransform
    const t = this.clamp01(weapon.attackElapsedMs / reboundDurationMs)
    weapon.visual = this.lerpTransform(weapon.swingStartTransform, target, t)
    if (t >= 1) {
      weapon.attackPhase = 'pause'
      weapon.attackElapsedMs = 0
      weapon.attackStartOffset = this.getOffsetFromTransform(
        weapon.visual,
        playerPos
      )
      weapon.attackStartTransform = weapon.visual
      weapon.lastAttackTimestamp = now
    }
  }

  private getTransformAtAngle(
    playerPos: { x: number; y: number },
    angle: number,
    radius: number
  ): WeaponTransform {
    return {
      x: playerPos.x + Math.cos(angle) * radius,
      y: playerPos.y + Math.sin(angle) * radius,
      rotation: angle,
    }
  }
}
