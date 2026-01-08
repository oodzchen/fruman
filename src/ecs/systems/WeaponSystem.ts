import {
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_WEAPON_ATTACK_PAUSE_MS,
  DEFAULT_WEAPON_ATTACK_RADIUS,
  DEFAULT_WEAPON_ATTACK_RECOVER_MS,
  DEFAULT_WEAPON_ATTACK_SWING_MS,
  DEFAULT_WEAPON_ATTACK_WINDUP_MS,
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
import type { WeaponRelativeTransform, WeaponTransform } from '../Component'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import { System } from '../System'

export class WeaponSystem extends System {
  constructor() {
    super()

    const transformType = componentRegistry.getComponentType('Transform')
    const weaponType = componentRegistry.getComponentType('Weapon')
    this.setRequiredComponents([transformType, weaponType])
  }

  update(entities: Entity[], deltaTime: number): void {
    const deltaMs = Math.max(0, deltaTime * 1000)

    for (const entity of entities) {
      if (!entity.transform || !entity.weapon) continue
      this.updateWeapon(entity, deltaMs)
    }
  }

  private updateWeapon(entity: Entity, deltaMs: number): void {
    if (!entity.transform || !entity.weapon) return

    const weapon = entity.weapon
    const playerPos = { x: entity.transform.x, y: entity.transform.y }

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
      this.handleWindupPhase(weapon)
      return
    }

    if (weapon.attackPhase === 'finalWindup') {
      this.handleFinalWindupPhase(weapon)
      return
    }

    if (weapon.attackPhase === 'swing') {
      this.handleSwingPhase(weapon, now)
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
    }
  }

  private handleWindupPhase(weapon: Entity['weapon']): void {
    if (!weapon) return

    const t = this.clamp01(
      weapon.attackElapsedMs / DEFAULT_WEAPON_ATTACK_WINDUP_MS
    )
    const target = weapon.swingStartTransform
    weapon.visual = this.lerpTransform(weapon.attackStartTransform, target, t)
    if (t >= 1) {
      weapon.attackPhase = 'swing'
      weapon.attackElapsedMs = 0
      weapon.attackStartTransform = weapon.swingStartTransform
    }
  }

  private handleFinalWindupPhase(weapon: Entity['weapon']): void {
    if (!weapon) return

    const t = this.clamp01(
      weapon.attackElapsedMs / DEFAULT_WEAPON_FINAL_WINDUP_MS
    )
    const target = weapon.swingStartTransform
    weapon.visual = this.lerpTransform(weapon.attackStartTransform, target, t)
    if (t >= 1) {
      weapon.attackPhase = 'swing'
      weapon.attackElapsedMs = 0
      weapon.attackStartTransform = weapon.swingStartTransform
    }
  }

  private handleSwingPhase(weapon: Entity['weapon'], now: number): void {
    if (!weapon) return

    const t = this.clamp01(
      weapon.attackElapsedMs / DEFAULT_WEAPON_ATTACK_SWING_MS
    )
    const from = weapon.swingStartTransform
    const to = weapon.swingEndTransform
    weapon.visual = this.lerpTransform(from, to, t)
    if (t >= 1) {
      weapon.attackPhase = 'pause'
      weapon.attackElapsedMs = 0
      const playerPos = { x: 0, y: 0 }
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
    weapon.visual = weapon.attackStartTransform

    const reachedPause =
      weapon.attackElapsedMs >= DEFAULT_WEAPON_ATTACK_PAUSE_MS
    const canChain = weapon.attackQueued && weapon.comboCount < 5

    if (canChain) {
      weapon.attackQueued = false
      weapon.comboCount += 1
      const isFinalAttack = weapon.comboCount === 5

      weapon.swingDirection = weapon.nextSwingDirection
      weapon.nextSwingDirection =
        weapon.swingDirection === 'toFront' ? 'toHead' : 'toFront'

      const frontAngle = attackFacing === 1 ? 0 : -Math.PI
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
      return
    }

    if (!reachedPause) return

    weapon.attackPhase = 'recover'
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

    const playerPos = { x: entity.transform.x, y: entity.transform.y }
    const dx = playerPos.x - entity.weapon.position.x
    const dy = playerPos.y - entity.weapon.position.y
    const distance = Math.hypot(dx, dy)

    if (distance > DEFAULT_WEAPON_PICKUP_DISTANCE) return

    entity.weapon.isEquipped = true
    entity.weapon.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
    entity.weapon.visual.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
  }

  startAttack(entity: Entity): void {
    if (!entity.transform || !entity.input || !entity.weapon) return
    if (!entity.weapon.isEquipped) return

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
      x: playerPos.x + facing * DEFAULT_WEAPON_FRONT_OFFSET_X,
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
    const frontAngle = facing === 1 ? 0 : -Math.PI
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
