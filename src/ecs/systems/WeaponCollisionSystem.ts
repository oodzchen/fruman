import {
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_WEAPON_ATTACK_RADIUS,
  DEFAULT_WEAPON_PLAYER_CLEARANCE,
  SOUND_RANGE_MULTIPLIER_WEAPON,
} from '../../constants'
import { SOUND_IDS } from '../../worker/effectsProtocol'
import type { AttackMoveData, ImpactLevel } from '../AttackMoveData'
import type { WeaponTransform } from '../Component'
import { WeaponComponent } from '../Component'
import type { Entity } from '../Entity'
import {
  checkOBBvsAABB,
  checkOBBvsCircle,
  checkOBBvsOBB,
  checkOBBvsPolygon,
} from '../OBBCollision'
import type { RopeCircleHitRequest, RopeHitRequest } from './GrappleSystem'
import {
  type BreakableObstacleCircleHitRequest,
  type BreakableObstacleOBBHitRequest,
} from './UltimateHandler'
import { WeaponInventorySystem } from './WeaponInventorySystem'
import {
  BIG_HAMMER_FINISHER_SHAKE_DURATION_MS,
  BIG_HAMMER_FINISHER_SHAKE_INTENSITY_PX,
  BIG_HAMMER_JUMP_SHAKE_DURATION_MS,
  BIG_HAMMER_JUMP_SHAKE_INTENSITY_PX,
  BIG_HAMMER_SIZE_LEVEL,
  BreakableObstacleHit,
  GIANT_SWORD_FINISHER_SHAKE_DURATION_MS,
  GIANT_SWORD_FINISHER_SHAKE_INTENSITY_PX,
  GIANT_SWORD_JUMP_SHAKE_DURATION_MS,
  GIANT_SWORD_JUMP_SHAKE_INTENSITY_PX,
  GIANT_SWORD_SIZE_LEVEL,
  GREAT_SWORD_SIZE_LEVEL,
  ObstacleCollider,
  PARRY_ACTIVE_START_FRAME,
} from './WeaponSystemShared'

export abstract class WeaponCollisionSystem extends WeaponInventorySystem {
  protected getAttackRadius(entity: Entity): number {
    const weapon = entity.weapon
    if (!weapon) {
      return DEFAULT_WEAPON_ATTACK_RADIUS
    }
    const entityRadius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    return entityRadius + weapon.width / 2 + DEFAULT_WEAPON_PLAYER_CLEARANCE
  }

  protected emitSoundAt(
    x: number,
    y: number,
    source: Entity,
    db: number,
    rangeMultiplier = SOUND_RANGE_MULTIPLIER_WEAPON
  ): void {
    if (!this.soundSystem) return
    const radius = source.render?.radius ?? DEFAULT_PLAYER_RADIUS
    this.soundSystem.emitSoundAt(x, y, radius, db, rangeMultiplier, source.id)
  }

  protected beginAttackImpactState(
    entity: Entity,
    weapon: WeaponComponent
  ): void {
    weapon.attackStartedAirborne = !(entity.movement?.isGrounded ?? true)
    weapon.landingShakeTriggered = false
    weapon.impactShakeTriggered = false
    weapon.attackCollisionSource = 'none'
    weapon.groundHitSoundTriggered = false
    weapon.groundHitSoundPending = 0
    weapon.hitBreakableObstacleIds.clear()
    weapon.hitRopeIds.clear()
  }

  protected clearAttackImpactState(weapon: Entity['weapon']): void {
    if (!weapon) return
    weapon.attackStartedAirborne = false
    weapon.landingShakeTriggered = false
    weapon.impactShakeTriggered = false
    weapon.attackCollisionSource = 'none'
    weapon.groundHitSoundTriggered = false
    weapon.groundHitSoundPending = 0
    weapon.hitBreakableObstacleIds.clear()
    weapon.hitRopeIds.clear()
  }

  protected isBigHammer(weapon: Entity['weapon']): boolean {
    return (
      !!weapon &&
      weapon.weaponType === 'hammer' &&
      weapon.sizeLevel >= BIG_HAMMER_SIZE_LEVEL
    )
  }

  protected isGreatSword(weapon: Entity['weapon']): boolean {
    return (
      !!weapon &&
      weapon.weaponType === 'sword' &&
      weapon.sizeLevel >= GREAT_SWORD_SIZE_LEVEL
    )
  }

  protected isGiantSword(weapon: Entity['weapon']): boolean {
    return (
      !!weapon &&
      weapon.weaponType === 'sword' &&
      weapon.sizeLevel >= GIANT_SWORD_SIZE_LEVEL
    )
  }

  protected shouldPlayHeavySwordGroundHitSound(
    weapon: Entity['weapon']
  ): boolean {
    return (
      !!weapon &&
      this.isGreatSword(weapon) &&
      weapon.swingDirection === 'toFront'
    )
  }

  protected getHeavyGroundHitSoundId(weapon: Entity['weapon']): number {
    if (!weapon) return 0
    if (this.isBigHammer(weapon)) {
      return SOUND_IDS.BIG_HAMMER_HIT_ROCK
    }
    if (this.shouldPlayHeavySwordGroundHitSound(weapon)) {
      return SOUND_IDS.HEAVY_SWORD_HIT_GROUND
    }
    return 0
  }

  protected shouldTriggerHeavyGroundHitSound(
    entity: Entity,
    weapon: WeaponComponent
  ): boolean {
    if (this.getHeavyGroundHitSoundId(weapon) === 0) return false
    if (!weapon.isEquipped) return false
    if (weapon.isDropping || weapon.isDropped || weapon.isRecovering)
      return false
    if (weapon.attackCollisionSource !== 'none') return false
    if (!this.isHeavyGroundHitEligiblePhase(weapon)) return false
    if (!this.checkGroundCollision(weapon)) return false
    if (!this.isGroundImpactShakeTimingValid(entity)) return false
    return !this.hasActiveParryWeaponCollision(entity, weapon)
  }

  protected tryQueueHeavyGroundHitSound(
    entity: Entity,
    weapon: WeaponComponent
  ): void {
    if (weapon.groundHitSoundTriggered) return
    if (!this.shouldTriggerHeavyGroundHitSound(entity, weapon)) return
    weapon.groundHitSoundTriggered = true
    weapon.groundHitSoundPending = this.getHeavyGroundHitSoundId(weapon)
  }

  protected isHeavyGroundHitEligiblePhase(weapon: WeaponComponent): boolean {
    return (
      weapon.attackPhase === 'swing' ||
      weapon.attackPhase === 'pause' ||
      weapon.attackPhase === 'recover'
    )
  }

  protected hasActiveParryWeaponCollision(
    attacker: Entity,
    attackerWeapon: WeaponComponent
  ): boolean {
    if (!attacker.faction) return false

    const weaponX = attackerWeapon.visual.x
    const weaponY = attackerWeapon.visual.y
    const weaponWidth = attackerWeapon.width
    const weaponHeight = attackerWeapon.height
    const weaponRotation = attackerWeapon.visual.rotation
    const attackRadius =
      attackerWeapon.attackRadius !== 0
        ? attackerWeapon.attackRadius
        : this.getAttackRadius(attacker)

    const nearbyEntities = this.spatialHash
      ? this.spatialHash.query(weaponX, weaponY, attackRadius + 2)
      : this.allEntities
    const nearbyCount = this.spatialHash
      ? this.spatialHash.getQueryResultLength()
      : nearbyEntities.length

    for (let i = 0; i < nearbyCount; i++) {
      const defender = nearbyEntities[i]
      if (!defender || defender.id === attacker.id) continue
      if (!defender.weapon || !defender.faction || !defender.stats) continue
      if (defender.stats.isDead) continue
      if (
        !attacker.faction.canAttackEntity(
          defender.faction,
          defender.id.toString()
        )
      ) {
        continue
      }
      if (!this.isWeaponInActiveParryWindow(defender.weapon)) continue

      if (
        checkOBBvsOBB(
          weaponX,
          weaponY,
          weaponWidth,
          weaponHeight,
          weaponRotation,
          defender.weapon.visual.x,
          defender.weapon.visual.y,
          defender.weapon.width,
          defender.weapon.height,
          defender.weapon.visual.rotation
        )
      ) {
        return true
      }
    }

    return false
  }

  protected isWeaponInActiveParryWindow(weapon: Entity['weapon']): boolean {
    return (
      !!weapon &&
      weapon.attackPhase === 'block' &&
      weapon.isParrying &&
      weapon.parryElapsedTime >= PARRY_ACTIVE_START_FRAME
    )
  }

  protected checkGroundCollision(
    weapon: Entity['weapon'],
    transform: WeaponTransform = weapon?.visual ?? this.tempTransform
  ): boolean {
    if (!weapon) return false
    if (this.checkGroundPlaneCollision(weapon, transform)) {
      return true
    }
    return this.checkStandableSurfaceCollision(weapon, transform)
  }

  protected checkGroundPlaneCollision(
    weapon: WeaponComponent,
    transform: WeaponTransform
  ): boolean {
    const wy = transform.y
    const wWidth = weapon.width
    const wHeight = weapon.height
    const wRotation = transform.rotation
    const cos = Math.cos(wRotation)
    const sin = Math.sin(wRotation)
    const maxY =
      wy + (wWidth / 2) * Math.abs(sin) + (wHeight / 2) * Math.abs(cos)
    return maxY >= this.groundTopY
  }

  protected checkStandableSurfaceCollision(
    weapon: WeaponComponent,
    transform: WeaponTransform
  ): boolean {
    if (this.standableSurfaces.length === 0) return false

    this.getWeaponBottomPoint(weapon, transform, this.tempWeaponBottomPoint)
    const pointX = this.tempWeaponBottomPoint.x
    const pointY = this.tempWeaponBottomPoint.y

    for (let i = 0; i < this.standableSurfaces.length; i++) {
      if (this.standableSurfaces[i].renderLayer !== weapon.renderLayer) {
        continue
      }
      if (
        this.isPointNearSurfaceTop(pointX, pointY, this.standableSurfaces[i])
      ) {
        return true
      }
    }

    return false
  }

  protected getWeaponBottomPoint(
    weapon: WeaponComponent,
    transform: WeaponTransform,
    out: { x: number; y: number }
  ): void {
    const halfWidth = weapon.width / 2
    const halfHeight = weapon.height / 2
    const cos = Math.cos(transform.rotation)
    const sin = Math.sin(transform.rotation)
    const centerX = transform.x
    const centerY = transform.y
    let bottomX = centerX
    let bottomY = centerY

    for (let i = 0; i < 4; i++) {
      const localX = i === 0 || i === 3 ? -halfWidth : halfWidth
      const localY = i < 2 ? -halfHeight : halfHeight
      const worldX = centerX + localX * cos - localY * sin
      const worldY = centerY + localX * sin + localY * cos
      if (i === 0 || worldY > bottomY) {
        bottomX = worldX
        bottomY = worldY
      }
    }

    out.x = bottomX
    out.y = bottomY
  }

  protected isPointNearSurfaceTop(
    x: number,
    y: number,
    surface: ObstacleCollider
  ): boolean {
    const SURFACE_HIT_TOLERANCE = 0.35
    const worldVertices = surface.worldVertices
    let topY: number | null = null

    if (worldVertices && worldVertices.length >= 2) {
      topY = this.findPolygonTopYAtX(worldVertices, x)
    } else if (surface.radius !== undefined && surface.radius > 0) {
      const dx = x - surface.centerX
      const radius = surface.radius
      if (dx < -radius || dx > radius) return false
      const remaining = radius * radius - dx * dx
      if (remaining < 0) return false
      topY = surface.centerY - Math.sqrt(remaining)
    } else {
      const left = surface.centerX - surface.width
      const right = surface.centerX + surface.width
      if (x < left || x > right) return false
      topY = surface.centerY - surface.height
    }

    return topY !== null && y >= topY && y <= topY + SURFACE_HIT_TOLERANCE
  }

  protected findPolygonTopYAtX(
    vertices: { x: number; y: number }[],
    x: number
  ): number | null {
    let topY = 0
    let found = false

    for (let i = 0; i < vertices.length; i++) {
      const start = vertices[i]
      const end = vertices[(i + 1) % vertices.length]
      const minX = start.x < end.x ? start.x : end.x
      const maxX = start.x > end.x ? start.x : end.x
      if (x < minX || x > maxX) continue

      let edgeY = 0
      if (start.x === end.x) {
        edgeY = start.y < end.y ? start.y : end.y
      } else {
        const t = (x - start.x) / (end.x - start.x)
        if (t < 0 || t > 1) continue
        edgeY = start.y + (end.y - start.y) * t
      }

      if (!found || edgeY < topY) {
        topY = edgeY
        found = true
      }
    }

    return found ? topY : null
  }

  protected tryEmitLandingCameraShake(
    entity: Entity,
    weapon: WeaponComponent
  ): void {
    if (!this.statsSystem || !entity.transform || !entity.render) return
    if (
      weapon.activeMoveId === 'hammer_strike_finisher' ||
      weapon.activeMoveId === 'sword_finisher'
    ) {
      return
    }
    weapon.attackStartedAirborne =
      weapon.attackStartedAirborne || !(entity.movement?.isGrounded ?? true)
    if (!weapon.attackStartedAirborne || weapon.landingShakeTriggered) return
    if (!this.checkGroundCollision(weapon)) return
    if (!this.isAttackShakeEligiblePhase(weapon.attackPhase)) return
    if (!this.isGroundImpactShakeTimingValid(entity)) return

    const impactX = entity.transform.x
    const impactY = entity.transform.y + (entity.render.radius || 0)

    if (this.isBigHammer(weapon)) {
      const isFinisher = weapon.activeMoveId === 'hammer_strike_finisher'
      this.statsSystem.emitCameraShake(
        impactX,
        impactY,
        isFinisher
          ? BIG_HAMMER_FINISHER_SHAKE_INTENSITY_PX
          : BIG_HAMMER_JUMP_SHAKE_INTENSITY_PX,
        isFinisher
          ? BIG_HAMMER_FINISHER_SHAKE_DURATION_MS
          : BIG_HAMMER_JUMP_SHAKE_DURATION_MS
      )
      weapon.landingShakeTriggered = true
      return
    }

    if (this.isGiantSword(weapon)) {
      const isFinisher = weapon.activeMoveId === 'sword_finisher'
      this.statsSystem.emitCameraShake(
        impactX,
        impactY,
        isFinisher
          ? GIANT_SWORD_FINISHER_SHAKE_INTENSITY_PX
          : GIANT_SWORD_JUMP_SHAKE_INTENSITY_PX,
        isFinisher
          ? GIANT_SWORD_FINISHER_SHAKE_DURATION_MS
          : GIANT_SWORD_JUMP_SHAKE_DURATION_MS
      )
      weapon.landingShakeTriggered = true
    }
  }

  protected tryEmitCompletedFinalSwingCameraShake(
    entity: Entity,
    weapon: WeaponComponent
  ): void {
    if (!this.statsSystem || weapon.impactShakeTriggered) return
    if (!(entity.movement?.isGrounded ?? true)) return

    if (
      weapon.activeMoveId === 'hammer_strike_finisher' &&
      this.isBigHammer(weapon)
    ) {
      this.statsSystem.emitCameraShake(
        weapon.visual.x,
        weapon.visual.y,
        BIG_HAMMER_FINISHER_SHAKE_INTENSITY_PX,
        BIG_HAMMER_FINISHER_SHAKE_DURATION_MS
      )
      weapon.impactShakeTriggered = true
      return
    }

    if (weapon.activeMoveId === 'sword_finisher' && this.isGiantSword(weapon)) {
      this.statsSystem.emitCameraShake(
        weapon.visual.x,
        weapon.visual.y,
        GIANT_SWORD_FINISHER_SHAKE_INTENSITY_PX,
        GIANT_SWORD_FINISHER_SHAKE_DURATION_MS
      )
      weapon.impactShakeTriggered = true
    }
  }

  protected isAttackShakeEligiblePhase(
    phase: WeaponComponent['attackPhase']
  ): boolean {
    return (
      phase === 'windup' ||
      phase === 'swing' ||
      phase === 'pause' ||
      phase === 'recover' ||
      phase === 'rebound'
    )
  }

  protected isGroundImpactShakeTimingValid(entity: Entity): boolean {
    if (entity.movement?.isGrounded) return true
    return (entity.physics?.velY ?? 0) > 0
  }

  protected getMoveKind(weapon: Entity['weapon']): AttackMoveData['kind'] {
    const move = this.getActiveMove(weapon)
    return move ? move.kind : 'slash'
  }

  setObstacles(obstacles: ObstacleCollider[]): void {
    this.obstacles = obstacles
  }

  setStandableSurfaces(surfaces: ObstacleCollider[]): void {
    this.standableSurfaces = surfaces
  }

  setBreakableObstacleHitHandler(
    handler: ((hit: BreakableObstacleHit) => void) | null
  ): void {
    this.onBreakableObstacleHit = handler
  }

  setRopeHitHandler(handler: ((hit: RopeHitRequest) => boolean) | null): void {
    this.onRopeHit = handler
  }

  setRopeCircleHitHandler(
    handler: ((hit: RopeCircleHitRequest) => boolean) | null
  ): void {
    this.onRopeCircleHit = handler
  }

  protected getRopeHitDamage(weapon: WeaponComponent): number {
    if (weapon.attackDamage > 0) {
      return weapon.attackDamage
    }
    return weapon.impactLevel === 'large' || weapon.impactLevel === 'extreme'
      ? 2
      : 1
  }

  protected hitRopesInWeaponOBB(
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    rotation: number,
    renderLayer: number,
    impactX: number,
    impactY: number,
    weapon: WeaponComponent,
    hitDirX?: number,
    hitDirY?: number
  ): boolean {
    if (!this.onRopeHit || width <= 0 || height <= 0) {
      return false
    }

    const request = this.tempRopeHitRequest
    request.centerX = centerX
    request.centerY = centerY
    request.width = width
    request.height = height
    request.rotation = rotation
    request.renderLayer = renderLayer
    request.impactX = impactX
    request.impactY = impactY
    request.damage = this.getRopeHitDamage(weapon)
    request.hitDirX = hitDirX ?? Math.cos(rotation)
    request.hitDirY = hitDirY ?? Math.sin(rotation)
    request.weapon = weapon
    return this.onRopeHit(request)
  }

  protected hitRopesInCircle(
    centerX: number,
    centerY: number,
    radius: number,
    renderLayer: number,
    impactX: number,
    impactY: number,
    weapon?: WeaponComponent,
    hitDirX?: number,
    hitDirY?: number
  ): boolean {
    if (!this.onRopeCircleHit || radius <= 0) {
      return false
    }

    const request = this.tempRopeCircleHitRequest
    request.centerX = centerX
    request.centerY = centerY
    request.radius = radius
    request.renderLayer = renderLayer
    request.impactX = impactX
    request.impactY = impactY
    request.damage = weapon ? this.getRopeHitDamage(weapon) : 1
    request.hitDirX = hitDirX
    request.hitDirY = hitDirY
    request.weapon = weapon
    return this.onRopeCircleHit(request)
  }

  protected hitRopesWithSweptWeaponOBB(
    weapon: WeaponComponent,
    previousWeaponX?: number,
    previousWeaponY?: number,
    previousWeaponRotation?: number
  ): boolean {
    const wx = weapon.visual.x
    const wy = weapon.visual.y
    const wWidth = weapon.width
    const wHeight = weapon.height
    const wRotation = weapon.visual.rotation
    let hit = this.hitRopesInWeaponOBB(
      wx,
      wy,
      wWidth,
      wHeight,
      wRotation,
      weapon.renderLayer,
      wx,
      wy,
      weapon
    )

    if (
      previousWeaponX === undefined ||
      previousWeaponY === undefined ||
      previousWeaponRotation === undefined ||
      (previousWeaponX === wx &&
        previousWeaponY === wy &&
        previousWeaponRotation === wRotation)
    ) {
      return hit
    }

    for (let sample = 1; sample <= 3; sample++) {
      const currentWeight = sample
      const previousWeight = 4 - sample
      this.tempSweptWeaponTransform.x =
        (previousWeaponX * previousWeight + wx * currentWeight) / 4
      this.tempSweptWeaponTransform.y =
        (previousWeaponY * previousWeight + wy * currentWeight) / 4
      this.tempSweptWeaponTransform.rotation =
        (previousWeaponRotation * previousWeight + wRotation * currentWeight) /
        4
      if (
        this.hitRopesInWeaponOBB(
          this.tempSweptWeaponTransform.x,
          this.tempSweptWeaponTransform.y,
          wWidth,
          wHeight,
          this.tempSweptWeaponTransform.rotation,
          weapon.renderLayer,
          wx,
          wy,
          weapon
        )
      ) {
        hit = true
      }
    }

    return hit
  }

  protected emitBreakableObstacleHit(
    obstacle: ObstacleCollider,
    impactLevel: ImpactLevel,
    impactX: number,
    impactY: number,
    attacker?: Entity,
    weapon?: WeaponComponent
  ): void {
    const breakableId = obstacle.breakableId
    if (breakableId === undefined) {
      return
    }
    if (weapon) {
      if (weapon.hitBreakableObstacleIds.has(breakableId)) {
        return
      }
      weapon.hitBreakableObstacleIds.add(breakableId)
      weapon.groundHitSoundTriggered = true
      weapon.groundHitSoundPending = 0
    }
    this.onBreakableObstacleHit?.({
      attacker,
      weapon,
      obstacle,
      impactLevel,
      impactX,
      impactY,
    })
  }

  protected handleBreakableObstacleOBBHit(
    request: BreakableObstacleOBBHitRequest
  ): void {
    if (request.weapon) {
      this.hitRopesInWeaponOBB(
        request.centerX,
        request.centerY,
        request.width,
        request.height,
        request.rotation,
        request.renderLayer,
        request.impactX,
        request.impactY,
        request.weapon,
        request.hitDirX,
        request.hitDirY
      )
    }
    if (this.obstacles.length > 0) {
      for (let i = 0; i < this.obstacles.length; i++) {
        const obstacle = this.obstacles[i]
        if (
          obstacle.breakableId === undefined ||
          obstacle.renderLayer !== request.renderLayer
        ) {
          continue
        }
        const centerX = obstacle.centerX
        const centerY = obstacle.centerY
        const worldVertices = obstacle.worldVertices
        let hit = false
        if (worldVertices) {
          hit = checkOBBvsPolygon(
            request.centerX,
            request.centerY,
            request.width,
            request.height,
            request.rotation,
            worldVertices
          )
        } else if (obstacle.radius !== undefined && obstacle.radius > 0) {
          hit = checkOBBvsCircle(
            request.centerX,
            request.centerY,
            request.width,
            request.height,
            request.rotation,
            centerX,
            centerY,
            obstacle.radius
          )
        } else {
          hit = checkOBBvsAABB(
            request.centerX,
            request.centerY,
            request.width,
            request.height,
            request.rotation,
            centerX,
            centerY,
            obstacle.width,
            obstacle.height
          )
        }
        if (!hit) {
          continue
        }
        this.emitBreakableObstacleHit(
          obstacle,
          request.impactLevel,
          request.impactX,
          request.impactY,
          request.attacker,
          request.weapon
        )
      }
    }
    this.hitTerrainDebrisInOBB(
      request.centerX,
      request.centerY,
      request.width,
      request.height,
      request.rotation,
      request.renderLayer,
      request.impactLevel,
      request.impactX,
      request.impactY,
      request.weapon
    )
  }

  protected handleBreakableObstacleCircleHit(
    request: BreakableObstacleCircleHitRequest
  ): void {
    this.hitBreakableObstaclesInCircle(
      request.centerX,
      request.centerY,
      request.radius,
      request.renderLayer,
      request.impactLevel,
      request.impactX,
      request.impactY,
      request.attacker,
      request.weapon,
      request.hitDirX,
      request.hitDirY
    )
    this.hitTerrainDebrisInCircle(
      request.centerX,
      request.centerY,
      request.radius,
      request.renderLayer,
      request.impactLevel,
      request.impactX,
      request.impactY,
      request.weapon
    )
  }

  protected hitBreakableObstaclesInCircle(
    centerX: number,
    centerY: number,
    radius: number,
    renderLayer: number,
    impactLevel: ImpactLevel,
    impactX: number,
    impactY: number,
    attacker?: Entity,
    weapon?: WeaponComponent,
    hitDirX?: number,
    hitDirY?: number
  ): void {
    if (radius <= 0) {
      return
    }
    this.hitRopesInCircle(
      centerX,
      centerY,
      radius,
      renderLayer,
      impactX,
      impactY,
      weapon,
      hitDirX,
      hitDirY
    )
    if (this.obstacles.length === 0) {
      return
    }
    for (let i = 0; i < this.obstacles.length; i++) {
      const obstacle = this.obstacles[i]
      if (
        obstacle.breakableId === undefined ||
        obstacle.renderLayer !== renderLayer
      ) {
        continue
      }
      let hit = false
      if (obstacle.radius !== undefined && obstacle.radius > 0) {
        const dx = obstacle.centerX - centerX
        const dy = obstacle.centerY - centerY
        const range = obstacle.radius + radius
        hit = dx * dx + dy * dy <= range * range
      } else {
        hit = checkOBBvsCircle(
          obstacle.centerX,
          obstacle.centerY,
          obstacle.width * 2,
          obstacle.height * 2,
          obstacle.rotationRad ?? 0,
          centerX,
          centerY,
          radius
        )
      }
      if (!hit) {
        continue
      }
      this.emitBreakableObstacleHit(
        obstacle,
        impactLevel,
        impactX,
        impactY,
        attacker,
        weapon
      )
    }
  }
}
