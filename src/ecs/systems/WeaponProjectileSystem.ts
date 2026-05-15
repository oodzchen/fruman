import {
  BOW_FREE_AIM_MAX_OFFSET,
  BOW_FREE_AIM_TURN_SPEED,
  BOW_MAX_DRAW_MS,
  DEFAULT_GRAVITY,
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_WEAPON_ATTACK_RADIUS,
  DEFAULT_WEAPON_HEIGHT,
  DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
  DEFAULT_WEAPON_WIDTH,
  GRAPE_PROJECTILE_RADIUS,
  SOUND_DB_BIG_HAMMER_HIT_ROCK,
  SOUND_RANGE_MULTIPLIER_MASSIVE,
  WEAPON_DEFAULT_DATA,
} from '../../constants'
import {
  getEnemyCollisionCategory,
  getPlayerCollisionCategory,
  getWeaponCollisionCategory,
  getWeaponCollisionMask,
} from '../../physicsLayers'
import type { WeaponVisualType } from '../../types'
import { getWeaponGroundRotationRad } from '../../weaponTypeUtils'
import { SOUND_IDS } from '../../worker/effectsProtocol'
import type { ImpactLevel } from '../AttackMoveData'
import {
  Faction,
  PhysicsComponent,
  RenderComponent,
  TransformComponent,
  WeaponComponent,
} from '../Component'
import type { Entity } from '../Entity'
import {
  getFrontTransform,
  getRangedAimRotation,
  setWeaponBackTransform,
} from '../WeaponPoseUtils'
import { HAMMER_AOE_RADIUS } from './UltimateHandler'
import { WeaponAttackPhaseSystem } from './WeaponAttackPhaseSystem'
import {
  BOMB_CAMERA_SHAKE_DURATION_MS,
  BOMB_CAMERA_SHAKE_INTENSITY_PX,
  BOMB_PROJECTILE_DENSITY,
  BOMB_PROJECTILE_FRICTION,
  BOMB_PROJECTILE_LINEAR_DAMPING,
  BOMB_PROJECTILE_RADIUS_SCALE_DENOMINATOR,
  BOMB_PROJECTILE_RADIUS_SCALE_NUMERATOR,
  BOMB_PROJECTILE_RESTITUTION,
  BOMB_TERRAIN_IMPACT_POWER,
  BOMB_THROW_FREE_SPEED,
  BOMB_THROW_GRAVITY_SCALE,
  BOMB_THROW_LOCKED_MAX_SPEED,
  BOMB_THROW_LOCKED_MIN_SPEED,
  BOMB_THROW_LOCKED_SPEED_PER_METER,
  BOMB_THROW_WINDUP_BACK_OFFSET,
  BOMB_THROW_WINDUP_DOWN_OFFSET,
  BOMB_THROW_WINDUP_MS,
  BOMB_THROW_WINDUP_ROTATION_RAD,
  BOMB_ULTIMATE_STATS,
  WeaponDropData,
  getBodyHalfHeight,
} from './WeaponSystemShared'

export abstract class WeaponProjectileSystem extends WeaponAttackPhaseSystem {
  protected dropWeapon(
    x: number,
    y: number,
    facing: number,
    weaponData: WeaponDropData,
    renderLayer: number
  ): void {
    if (
      !this.world ||
      !this.box2d ||
      !this.worldId ||
      !this.dropBodyDef ||
      !this.dropShapeDef ||
      !this.dropCircle
    ) {
      return
    }

    const entity = this.world.createEntity()

    const transform = new TransformComponent()
    transform.x = x
    transform.y = y
    entity.addComponent(transform)

    // 创建物理组件用于掉落动画
    const physics = new PhysicsComponent()
    const { b2CreateBody, b2BodyType, b2CreateCircleShape } = this.box2d

    const bodyDef = this.dropBodyDef
    bodyDef.type = b2BodyType.b2_dynamicBody
    bodyDef.position.Set(x, y)
    bodyDef.gravityScale = 1
    bodyDef.linearDamping = 2.0 // 较高的阻尼，快速减速
    bodyDef.motionLocks.angularZ = true // 锁定旋转
    physics.bodyId = b2CreateBody(this.worldId, bodyDef)

    // 使用固定小半径，避免大型武器（锤子/葡萄等）因中心过高而视觉悬浮
    const weaponRadius = DEFAULT_WEAPON_HEIGHT * 0.4
    const circle = this.dropCircle
    circle.center.Set(0, 0)
    circle.radius = weaponRadius
    const shapeDef = this.dropShapeDef
    shapeDef.density = 0.5
    shapeDef.material.friction = 0.3
    shapeDef.material.restitution = 0
    shapeDef.filter.categoryBits = getWeaponCollisionCategory(renderLayer)
    shapeDef.filter.maskBits = getWeaponCollisionMask(renderLayer)
    physics.shapeId = b2CreateCircleShape(physics.bodyId, shapeDef, circle)

    // 施加初始速度：向玩家面朝的前方抛出，同时向上
    const throwSpeedX = facing * 3 // 向前抛
    const throwSpeedY = -3.0 // 向上抛
    const throwVelocity = this.tempVec
    if (throwVelocity) {
      throwVelocity.x = throwSpeedX
      throwVelocity.y = throwSpeedY
      this.box2d.b2Body_SetLinearVelocity(physics.bodyId, throwVelocity)
      physics.velX = throwVelocity.x
      physics.velY = throwVelocity.y
    }

    entity.addComponent(physics)

    const render = new RenderComponent()
    render.radius = 0
    render.visible = true
    render.renderLayer = renderLayer
    entity.addComponent(render)

    const weapon = new WeaponComponent()
    weapon.renderLayer = renderLayer
    weapon.width = weaponData.width
    weapon.height = weaponData.height
    weapon.baseWidth = weaponData.baseWidth
    weapon.sizeLevel = weaponData.sizeLevel
    weapon.sizeMaxLevel = weaponData.sizeMaxLevel
    weapon.blockWidthStart = weaponData.width
    weapon.blockWidthTarget = weaponData.width
    weapon.cornerRadius = weaponData.cornerRadius
    weapon.weight = weaponData.weight
    weapon.weaponType = weaponData.weaponType
    weapon.movesetId =
      weaponData.movesetId ||
      this.getDefaultMovesetIdForWeaponType(weaponData.weaponType)
    weapon.attackDamage = weaponData.attackDamage
    weapon.postureDamage = weaponData.postureDamage
    weapon.toughnessDamage = weaponData.toughnessDamage
    weapon.bowAmmo = weaponData.bowAmmo
    weapon.bowAmmoMax = weaponData.bowAmmoMax
    weapon.skillId = weaponData.skillId

    const weaponY = y
    const groundRotation = getWeaponGroundRotationRad(weaponData.weaponType)
    weapon.position.x = x
    weapon.position.y = weaponY
    weapon.rotation = groundRotation
    weapon.isEquipped = false
    weapon.attackPhase = 'idle'
    weapon.visual.x = x
    weapon.visual.y = weaponY
    weapon.visual.rotation = groundRotation
    weapon.attackStartTransform.x = x
    weapon.attackStartTransform.y = weaponY
    weapon.attackStartTransform.rotation = groundRotation
    weapon.swingStartTransform.x = x
    weapon.swingStartTransform.y = weaponY
    weapon.swingStartTransform.rotation = groundRotation
    weapon.swingEndTransform.x = x
    weapon.swingEndTransform.y = weaponY
    weapon.swingEndTransform.rotation = groundRotation
    weapon.attackStartOffset.dx = 0
    weapon.attackStartOffset.dy = 0
    weapon.attackStartOffset.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
    weapon.swingStartOffset.dx = 0
    weapon.swingStartOffset.dy = 0
    weapon.swingStartOffset.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
    weapon.swingEndOffset.dx = 0
    weapon.swingEndOffset.dy = 0
    weapon.swingEndOffset.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
    weapon.attackRadius = DEFAULT_WEAPON_ATTACK_RADIUS
    weapon.pickupCooldownEndTime = this.currentTimeMs + 500 // 500ms 冷却时间

    entity.addComponent(weapon)
  }

  protected updateDroppingWeapon(entity: Entity): void {
    if (!entity.physics || !entity.transform || !entity.weapon || !this.box2d) {
      return
    }

    // 同步物理位置到 transform
    const bodyX = entity.physics.posX
    const bodyY = entity.physics.posY
    entity.transform.x = bodyX
    entity.transform.y = bodyY

    // 更新武器视觉位置
    entity.weapon.visual.x = bodyX
    entity.weapon.visual.y = bodyY

    // 增加掉落时间计时
    entity.weapon.dropElapsedTime += this.currentDeltaTime

    // 检查速度是否接近 0（已落地）
    // 增加最小掉落时间保护（0.1秒），防止生成第一帧因速度未更新而直接判定落地（悬空）
    const speed = Math.hypot(entity.physics.velX, entity.physics.velY)
    if (speed < 0.1 && entity.weapon.dropElapsedTime > 0.1) {
      // 落稳后保留物理体，确保地形被破坏时道具仍会受重力和碰撞影响。
      if (this.tempVec) {
        this.tempVec.x = 0
        this.tempVec.y = 0
        this.box2d.b2Body_SetLinearVelocity(entity.physics.bodyId, this.tempVec)
      }
    }
  }

  protected updateBombWeapon(
    entity: Entity,
    weapon: WeaponComponent,
    playerPos: { x: number; y: number },
    facing: number,
    deltaMs: number
  ): void {
    const lockedFacing =
      weapon.bombState === 'throw_windup'
        ? weapon.attackFacing !== 0
          ? weapon.attackFacing
          : facing
        : facing
    weapon.attackFacing = lockedFacing
    weapon.isBlocking = false
    weapon.isParrying = false
    weapon.parryElapsedTime = 0
    weapon.attackPhase = 'idle'
    weapon.attackElapsedMs = 0
    weapon.attackQueued = false
    weapon.comboCount = 0
    weapon.swingDirection = 'toFront'
    weapon.nextSwingDirection = 'toFront'

    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    const bodyHalfHeight = getBodyHalfHeight(entity.render, radius)
    if (entity.stats?.isInCombat || weapon.bombState !== 'idle') {
      getFrontTransform(
        playerPos,
        lockedFacing,
        weapon.visual,
        radius,
        weapon.weaponType,
        weapon.width
      )
      if (weapon.bombState === 'throw_windup') {
        const windupRatio = Math.min(
          1,
          weapon.bombThrowWindupElapsedMs / BOMB_THROW_WINDUP_MS
        )
        weapon.visual.x -=
          lockedFacing * BOMB_THROW_WINDUP_BACK_OFFSET * windupRatio
        weapon.visual.y += BOMB_THROW_WINDUP_DOWN_OFFSET * windupRatio
        weapon.visual.rotation +=
          lockedFacing * BOMB_THROW_WINDUP_ROTATION_RAD * windupRatio
      }
    } else {
      setWeaponBackTransform(
        playerPos,
        lockedFacing,
        weapon.visual,
        radius,
        weapon.weaponType,
        weapon.width,
        bodyHalfHeight
      )
    }

    if (weapon.bombState !== 'lit' && weapon.bombState !== 'throw_windup') {
      this.clearAttackImpactState(weapon)
      return
    }

    weapon.bombFuseRemainingMs = Math.max(
      0,
      weapon.bombFuseRemainingMs - deltaMs
    )
    if (weapon.bombFuseRemainingMs > 0) {
      if (weapon.bombState === 'throw_windup') {
        weapon.bombThrowWindupElapsedMs = Math.min(
          BOMB_THROW_WINDUP_MS,
          weapon.bombThrowWindupElapsedMs + deltaMs
        )
        if (weapon.bombThrowWindupElapsedMs >= BOMB_THROW_WINDUP_MS) {
          if (this.createThrownBombEntity(entity, weapon)) {
            this.resetBombState(weapon)
            weapon.attackFacing = lockedFacing
            this.removeDepletedConsumable(entity, weapon)
          } else {
            weapon.bombState = 'lit'
            weapon.bombThrowWindupElapsedMs = 0
          }
        }
      }
      this.clearAttackImpactState(weapon)
      return
    }

    this.explodeBombAt(
      weapon.visual.x,
      weapon.visual.y,
      weapon.renderLayer,
      entity,
      true,
      weapon
    )
    this.resetBombState(weapon)
    this.removeDepletedConsumable(entity, weapon)
    this.clearAttackImpactState(weapon)
  }

  protected updateBombProjectile(entity: Entity, deltaMs: number): void {
    if (!entity.transform || !entity.weapon) {
      return
    }

    if (entity.physics) {
      entity.transform.x = entity.physics.posX
      entity.transform.y = entity.physics.posY
    }

    const weapon = entity.weapon
    weapon.position.x = entity.transform.x
    weapon.position.y = entity.transform.y
    weapon.visual.x = entity.transform.x
    weapon.visual.y = entity.transform.y
    weapon.visual.rotation = weapon.bombThrownRotation

    weapon.bombFuseRemainingMs = Math.max(
      0,
      weapon.bombFuseRemainingMs - deltaMs
    )
    if (weapon.bombFuseRemainingMs > 0) {
      return
    }

    const owner =
      weapon.bombOwnerEntityId > 0 && this.entityLookup
        ? this.entityLookup(weapon.bombOwnerEntityId)
        : undefined
    this.explodeBombAt(
      entity.transform.x,
      entity.transform.y,
      weapon.renderLayer,
      owner,
      false,
      weapon
    )
    this.destroyBombProjectileEntity(entity)
  }

  protected createThrownBombEntity(
    owner: Entity,
    weapon: WeaponComponent
  ): boolean {
    if (
      !this.world ||
      !this.box2d ||
      !this.worldId ||
      !this.dropBodyDef ||
      !this.dropShapeDef ||
      !this.dropCircle
    ) {
      return false
    }

    const entity = this.world.createEntity()
    const startX = weapon.visual.x
    const startY = weapon.visual.y

    const transform = new TransformComponent()
    transform.x = startX
    transform.y = startY
    entity.addComponent(transform)

    const physics = new PhysicsComponent()
    const { b2CreateBody, b2BodyType, b2CreateCircleShape } = this.box2d
    const bodyDef = this.dropBodyDef
    bodyDef.type = b2BodyType.b2_dynamicBody
    bodyDef.position.Set(startX, startY)
    bodyDef.gravityScale = BOMB_THROW_GRAVITY_SCALE
    bodyDef.linearDamping = BOMB_PROJECTILE_LINEAR_DAMPING
    bodyDef.motionLocks.angularZ = true
    physics.bodyId = b2CreateBody(this.worldId, bodyDef)

    const circle = this.dropCircle
    circle.center.Set(0, 0)
    circle.radius =
      (Math.min(weapon.width, weapon.height) *
        BOMB_PROJECTILE_RADIUS_SCALE_NUMERATOR) /
      BOMB_PROJECTILE_RADIUS_SCALE_DENOMINATOR
    const shapeDef = this.dropShapeDef
    shapeDef.density = BOMB_PROJECTILE_DENSITY
    shapeDef.material.friction = BOMB_PROJECTILE_FRICTION
    shapeDef.material.restitution = BOMB_PROJECTILE_RESTITUTION
    shapeDef.filter.categoryBits = this.getBombProjectileCollisionCategory(
      owner,
      weapon.renderLayer
    )
    shapeDef.filter.maskBits = this.getBombProjectileCollisionMask(
      owner,
      weapon.renderLayer
    )
    physics.shapeId = b2CreateCircleShape(physics.bodyId, shapeDef, circle)
    entity.addComponent(physics)

    const render = new RenderComponent()
    render.radius = 0
    render.visible = true
    render.renderLayer = weapon.renderLayer
    entity.addComponent(render)

    const bombWeapon = new WeaponComponent()
    bombWeapon.renderLayer = weapon.renderLayer
    bombWeapon.width = weapon.width
    bombWeapon.height = weapon.height
    bombWeapon.baseWidth = weapon.baseWidth
    bombWeapon.blockWidthStart = weapon.width
    bombWeapon.blockWidthTarget = weapon.width
    bombWeapon.cornerRadius = weapon.cornerRadius
    bombWeapon.weight = weapon.weight
    bombWeapon.weaponType = 'bomb'
    bombWeapon.isEquipped = false
    bombWeapon.attackPhase = 'idle'
    bombWeapon.bombState = 'projectile'
    bombWeapon.bombFuseDurationMs = weapon.bombFuseDurationMs
    bombWeapon.bombFuseRemainingMs = weapon.bombFuseRemainingMs
    bombWeapon.bombOwnerEntityId = owner.id
    bombWeapon.bombThrownRotation = weapon.bombThrownRotation
    bombWeapon.visual.x = startX
    bombWeapon.visual.y = startY
    bombWeapon.visual.rotation = bombWeapon.bombThrownRotation
    bombWeapon.position.x = startX
    bombWeapon.position.y = startY
    bombWeapon.rotation = bombWeapon.bombThrownRotation
    bombWeapon.pickupCooldownEndTime =
      this.currentTimeMs + Math.max(0, weapon.bombFuseRemainingMs)
    entity.addComponent(bombWeapon)

    if (this.tempVec) {
      this.tempVec.x = weapon.bombThrowVelocityX
      this.tempVec.y = weapon.bombThrowVelocityY
      this.box2d.b2Body_SetLinearVelocity(physics.bodyId, this.tempVec)
      physics.velX = this.tempVec.x
      physics.velY = this.tempVec.y
    }

    return true
  }

  protected getBombProjectileCollisionCategory(
    owner: Entity,
    renderLayer: number
  ): number {
    return owner.faction?.factionId === Faction.Player
      ? getEnemyCollisionCategory(renderLayer)
      : getPlayerCollisionCategory(renderLayer)
  }

  protected getBombProjectileCollisionMask(
    owner: Entity,
    renderLayer: number
  ): number {
    const targetCategory =
      owner.faction?.factionId === Faction.Player
        ? getEnemyCollisionCategory(renderLayer)
        : getPlayerCollisionCategory(renderLayer)
    return getWeaponCollisionMask(renderLayer) | targetCategory
  }

  protected destroyBombProjectileEntity(entity: Entity): void {
    if (!this.world) {
      return
    }
    if (entity.render) {
      entity.render.visible = false
    }
    if (entity.physics && this.box2d) {
      this.box2d.b2DestroyBody(entity.physics.bodyId)
      entity.removeComponent('Physics')
    }
    this.world.destroyEntity(entity)
  }

  protected explodeBombAt(
    x: number,
    y: number,
    renderLayer: number,
    owner: Entity | undefined,
    includeOwner: boolean,
    sourceWeapon?: WeaponComponent
  ): void {
    const damage = BOMB_ULTIMATE_STATS.attackDamage * 5
    const posture = BOMB_ULTIMATE_STATS.postureDamage * 5
    const toughness = BOMB_ULTIMATE_STATS.toughnessDamage * 5

    this.statsSystem?.emitBombExplosion(x, y, HAMMER_AOE_RADIUS, renderLayer)
    this.statsSystem?.emitCameraShake(
      x,
      y,
      BOMB_CAMERA_SHAKE_INTENSITY_PX,
      BOMB_CAMERA_SHAKE_DURATION_MS
    )
    this.statsSystem?.playSoundAt(SOUND_IDS.BOMB_EXPLOSION, x, y)
    if (owner) {
      this.emitSoundAt(
        x,
        y,
        owner,
        SOUND_DB_BIG_HAMMER_HIT_ROCK,
        SOUND_RANGE_MULTIPLIER_MASSIVE
      )
    }

    if (!this.statsSystem) {
      return
    }

    const radiusSq = HAMMER_AOE_RADIUS * HAMMER_AOE_RADIUS
    for (let i = 0; i < this.allEntities.length; i++) {
      const target = this.allEntities[i]
      if (!target?.transform || !target.stats || target.stats.isDead) {
        continue
      }
      if (owner && target.id === owner.id) {
        if (!includeOwner) {
          continue
        }
      } else if (
        owner?.faction &&
        (!target.faction ||
          !owner.faction.canAttackEntity(target.faction, target.id.toString()))
      ) {
        continue
      }

      const dx = target.transform.x - x
      const dy = target.transform.y - y
      if (dx * dx + dy * dy > radiusSq) {
        continue
      }

      this.statsSystem.applyWeaponHit(
        target,
        {
          attackDamage: damage,
          postureDamage: posture,
          toughnessDamage: toughness,
          impactLevel: 'extreme',
          weaponType: 'hammer',
          sizeLevel: WEAPON_DEFAULT_DATA.hammer.sizeMaxLevel,
        },
        { x, y },
        includeOwner && owner && target.id === owner.id ? undefined : owner
      )
    }

    this.hitBreakableObstaclesInCircle(
      x,
      y,
      HAMMER_AOE_RADIUS,
      renderLayer,
      'extreme',
      x,
      y,
      owner,
      sourceWeapon
    )
    this.hitTerrainDebrisInCircle(
      x,
      y,
      HAMMER_AOE_RADIUS,
      renderLayer,
      'extreme',
      x,
      y,
      sourceWeapon
    )

    this.terrainImpactCallback?.({
      worldX: x,
      worldY: y,
      radius: HAMMER_AOE_RADIUS,
      impactPower: BOMB_TERRAIN_IMPACT_POWER,
      renderLayer,
    })
  }

  protected resetBombState(weapon: WeaponComponent): void {
    weapon.bombState = 'idle'
    weapon.bombFuseRemainingMs = 0
    weapon.bombFuseDurationMs = 0
    weapon.bombOwnerEntityId = 0
    weapon.bombThrownRotation = 0
    weapon.bombThrowWindupElapsedMs = 0
    weapon.bombThrowVelocityX = 0
    weapon.bombThrowVelocityY = 0
    weapon.bombThrowAimAngle = 0
  }

  protected startBombThrowWindup(
    entity: Entity,
    weapon: WeaponComponent,
    facing: number
  ): void {
    let throwAngle = Math.atan2(-1, facing >= 0 ? 1 : -1)
    let throwSpeed = BOMB_THROW_FREE_SPEED

    if (
      entity.input &&
      this.entityLookup &&
      entity.input.lockedTargetId !== null
    ) {
      const target = this.entityLookup(entity.input.lockedTargetId)
      if (target?.transform && target.stats && !target.stats.isDead) {
        const dx = target.transform.x - weapon.visual.x
        const dy = target.transform.y - weapon.visual.y
        const distance = Math.hypot(dx, dy)
        if (distance > 0.001) {
          let lockedSpeed = Math.max(
            BOMB_THROW_LOCKED_MIN_SPEED,
            Math.min(
              BOMB_THROW_LOCKED_MAX_SPEED,
              distance * BOMB_THROW_LOCKED_SPEED_PER_METER
            )
          )
          let lockedAngle = this.getBallisticAimAngle(
            weapon.visual.x,
            weapon.visual.y,
            target.transform.x,
            target.transform.y,
            lockedSpeed,
            DEFAULT_GRAVITY * BOMB_THROW_GRAVITY_SCALE
          )
          if (
            lockedAngle === null &&
            lockedSpeed < BOMB_THROW_LOCKED_MAX_SPEED
          ) {
            lockedSpeed = BOMB_THROW_LOCKED_MAX_SPEED
            lockedAngle = this.getBallisticAimAngle(
              weapon.visual.x,
              weapon.visual.y,
              target.transform.x,
              target.transform.y,
              lockedSpeed,
              DEFAULT_GRAVITY * BOMB_THROW_GRAVITY_SCALE
            )
          }
          throwAngle = lockedAngle ?? Math.atan2(dy, dx)
          throwSpeed = lockedSpeed
        }
      }
    }

    weapon.bombState = 'throw_windup'
    weapon.bombThrowWindupElapsedMs = 0
    weapon.bombThrowAimAngle = throwAngle
    weapon.bombThrowVelocityX = Math.cos(throwAngle) * throwSpeed
    weapon.bombThrowVelocityY = Math.sin(throwAngle) * throwSpeed
    weapon.bombThrownRotation = throwAngle + Math.PI / 2
    weapon.attackFacing = weapon.bombThrowVelocityX >= 0 ? 1 : -1
  }

  protected updateBowWeapon(
    entity: Entity,
    weapon: WeaponComponent,
    playerPos: { x: number; y: number },
    facing: number,
    deltaMs: number
  ): void {
    weapon.attackFacing = facing
    if (!entity.input) {
      weapon.bowIsDrawing = false
      weapon.bowDrawElapsedMs = 0
      weapon.bowDrawRatio = 0
      weapon.bowForceRatio = 0
      weapon.bowReleaseRatio = 0
      weapon.bowReleasePending = false
      weapon.bowReleaseDelayMs = 0
      weapon.bowReleaseDelayTotalMs = 0
      weapon.bowRecoverElapsedMs = 0
      weapon.bowAimAngle = 0
      weapon.bowHasAim = false
      weapon.bowFreeAim = false
      weapon.bowFreeAimAngle = 0
      weapon.bowFreeAimReticleX = 0
      weapon.bowFreeAimReticleY = 0
      weapon.bowFreeAimUseMouse = false
      weapon.bowFreeAimUseReticle = false
      weapon.bowFreeAimLastMouseX = 0
      weapon.bowFreeAimLastMouseY = 0
      weapon.bowFreeAimReticleOffsetX = 0
      weapon.bowFreeAimReticleOffsetY = 0
      return
    }

    const hasAmmo = weapon.bowAmmo > 0
    const holdingAttack =
      hasAmmo && entity.input.attackRequested && !entity.isStunned()
    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    const wantsLockToggle =
      entity.input.lockToggleRequested ||
      entity.input.lockSwitchIntentX !== 0 ||
      entity.input.lockSwitchIntentY !== 0
    if (weapon.bowFreeAim && wantsLockToggle) {
      weapon.bowFreeAim = false
      weapon.bowFreeAimAngle = 0
      weapon.bowFreeAimReticleX = 0
      weapon.bowFreeAimReticleY = 0
      weapon.bowFreeAimUseMouse = false
      weapon.bowFreeAimUseReticle = false
      weapon.bowFreeAimReticleOffsetX = 0
      weapon.bowFreeAimReticleOffsetY = 0
      entity.input.facingOverride = null
    }
    if (entity.input.freeAimToggleRequested) {
      entity.input.freeAimToggleRequested = false
      let lockedAimAngle: number | null = null
      let lockedTargetX = 0
      let lockedTargetY = 0
      let hasLockedTarget = false
      if (this.entityLookup && entity.input.lockedTargetId !== null) {
        const target = this.entityLookup(entity.input.lockedTargetId)
        if (target?.transform && target.stats && !target.stats.isDead) {
          lockedTargetX = target.transform.x
          lockedTargetY = target.transform.y
          hasLockedTarget = true
          const minForceRatio = this.getBowMinForceRatio(weapon)
          const drawRatio = weapon.bowIsDrawing
            ? weapon.bowDrawRatio
            : Math.max(weapon.bowDrawRatio, minForceRatio)
          lockedAimAngle = this.getBowAimAngleForPosition(
            weapon,
            playerPos,
            radius,
            lockedTargetX,
            lockedTargetY,
            drawRatio
          )
        }
      }
      weapon.bowFreeAim = !weapon.bowFreeAim
      if (weapon.bowFreeAim) {
        const defaultAngle =
          lockedAimAngle ??
          (weapon.bowHasAim
            ? weapon.bowAimAngle
            : weapon.attackFacing === 1
              ? 0
              : Math.PI)
        weapon.bowFreeAimAngle = defaultAngle
        weapon.bowFreeAimUseMouse = false
        weapon.bowFreeAimUseReticle = hasLockedTarget
        weapon.bowFreeAimLastMouseX = entity.input.mouseAimX
        weapon.bowFreeAimLastMouseY = entity.input.mouseAimY
        if (hasLockedTarget) {
          weapon.bowFreeAimReticleX = lockedTargetX
          weapon.bowFreeAimReticleY = lockedTargetY
          weapon.bowFreeAimReticleOffsetX = lockedTargetX - playerPos.x
          weapon.bowFreeAimReticleOffsetY = lockedTargetY - playerPos.y
        } else {
          const reticleRange =
            Math.max(this.viewportWidth, this.viewportHeight) * 0.5
          const reticleX = playerPos.x + Math.cos(defaultAngle) * reticleRange
          const reticleY = playerPos.y + Math.sin(defaultAngle) * reticleRange
          weapon.bowFreeAimReticleX = reticleX
          weapon.bowFreeAimReticleY = reticleY
          weapon.bowFreeAimReticleOffsetX = reticleX - playerPos.x
          weapon.bowFreeAimReticleOffsetY = reticleY - playerPos.y
        }
        entity.input.lockedTargetId = null
        entity.input.lockLostTimer = 0
        if (entity.stats && !entity.stats.isInCombat) {
          entity.stats.isInCombat = true
          entity.stats.combatExitTimer = 0
        }
      } else {
        entity.input.lockedTargetId = null
        entity.input.lockLostTimer = 0
        entity.input.facingOverride = null
        weapon.bowFreeAimReticleX = 0
        weapon.bowFreeAimReticleY = 0
        weapon.bowFreeAimUseMouse = false
        weapon.bowFreeAimUseReticle = false
        weapon.bowFreeAimReticleOffsetX = 0
        weapon.bowFreeAimReticleOffsetY = 0
      }
    }

    const freeAimActive = weapon.bowFreeAim
    const aimAngle = freeAimActive
      ? null
      : this.getBowAimAngleForTarget(entity, weapon, playerPos, radius)
    const hasAimLock = aimAngle !== null
    const inCombat =
      entity.stats?.isInCombat ||
      weapon.bowIsDrawing ||
      holdingAttack ||
      hasAimLock ||
      freeAimActive

    if (freeAimActive) {
      entity.input.lockedTargetId = null
      entity.input.lockLostTimer = 0
      const useMouseAim = entity.input.mouseAimActive
      const mouseAimMoved = entity.input.mouseAimMoved
      let reticleAngle = weapon.bowFreeAimAngle
      let reticleX = 0
      let reticleY = 0
      let useMouseAimNow = false
      if (useMouseAim) {
        const mouseX = entity.input.mouseAimX
        const mouseY = entity.input.mouseAimY
        if (weapon.bowFreeAimUseMouse || mouseAimMoved) {
          weapon.bowFreeAimUseMouse = true
          useMouseAimNow = true
        }
        weapon.bowFreeAimLastMouseX = mouseX
        weapon.bowFreeAimLastMouseY = mouseY
        if (useMouseAimNow) {
          reticleX = mouseX
          reticleY = mouseY
          reticleAngle = Math.atan2(
            reticleY - playerPos.y,
            reticleX - playerPos.x
          )
          weapon.bowFreeAimAngle = reticleAngle
          weapon.bowFreeAimReticleX = reticleX
          weapon.bowFreeAimReticleY = reticleY
          weapon.bowFreeAimReticleOffsetX = reticleX - playerPos.x
          weapon.bowFreeAimReticleOffsetY = reticleY - playerPos.y
          weapon.bowFreeAimUseReticle = false
        }
      }
      if (!useMouseAimNow) {
        const adjust =
          entity.input.freeAimAdjust * (weapon.attackFacing >= 0 ? 1 : -1)
        if (adjust !== 0) {
          weapon.bowFreeAimUseReticle = false
          weapon.bowFreeAimAngle +=
            adjust * BOW_FREE_AIM_TURN_SPEED * (deltaMs / 1000)
        }
        if (!weapon.bowFreeAimUseReticle) {
          const centerAngle = facing === 1 ? 0 : Math.PI
          const minAngle = centerAngle - BOW_FREE_AIM_MAX_OFFSET
          const maxAngle = centerAngle + BOW_FREE_AIM_MAX_OFFSET
          if (weapon.bowFreeAimAngle < minAngle) {
            weapon.bowFreeAimAngle = minAngle
          } else if (weapon.bowFreeAimAngle > maxAngle) {
            weapon.bowFreeAimAngle = maxAngle
          }
        }

        if (weapon.bowFreeAimUseReticle) {
          reticleX = playerPos.x + weapon.bowFreeAimReticleOffsetX
          reticleY = playerPos.y + weapon.bowFreeAimReticleOffsetY
          reticleAngle = Math.atan2(
            reticleY - playerPos.y,
            reticleX - playerPos.x
          )
          weapon.bowFreeAimAngle = reticleAngle
          weapon.bowFreeAimReticleX = reticleX
          weapon.bowFreeAimReticleY = reticleY
        } else {
          const reticleRange =
            Math.max(this.viewportWidth, this.viewportHeight) * 0.5
          reticleAngle = weapon.bowFreeAimAngle
          reticleX = playerPos.x + Math.cos(reticleAngle) * reticleRange
          reticleY = playerPos.y + Math.sin(reticleAngle) * reticleRange
          weapon.bowFreeAimReticleX = reticleX
          weapon.bowFreeAimReticleY = reticleY
          weapon.bowFreeAimReticleOffsetX = reticleX - playerPos.x
          weapon.bowFreeAimReticleOffsetY = reticleY - playerPos.y
        }
      }
      entity.input.facingOverride = Math.cos(reticleAngle) >= 0 ? 1 : -1

      const minForceRatio = this.getBowMinForceRatio(weapon)
      const drawRatio = weapon.bowIsDrawing
        ? weapon.bowDrawRatio
        : Math.max(weapon.bowDrawRatio, minForceRatio)
      const freeAimAngle = this.getBowAimAngleForPosition(
        weapon,
        playerPos,
        radius,
        reticleX,
        reticleY,
        drawRatio
      )
      weapon.bowAimAngle = freeAimAngle
      weapon.bowHasAim = true
      const offset = radius + 0.2
      weapon.visual.x = playerPos.x + Math.cos(freeAimAngle) * offset
      weapon.visual.y = playerPos.y + Math.sin(freeAimAngle) * offset
      weapon.visual.rotation = getRangedAimRotation(
        weapon.weaponType,
        freeAimAngle
      )
      weapon.attackFacing = Math.cos(freeAimAngle) >= 0 ? 1 : -1
    } else if (hasAimLock && aimAngle !== null) {
      weapon.bowAimAngle = aimAngle
      weapon.bowHasAim = true
      weapon.bowFreeAimReticleX = 0
      weapon.bowFreeAimReticleY = 0
      const offset = radius + 0.2
      weapon.visual.x = playerPos.x + Math.cos(aimAngle) * offset
      weapon.visual.y = playerPos.y + Math.sin(aimAngle) * offset
      weapon.visual.rotation = getRangedAimRotation(weapon.weaponType, aimAngle)
      weapon.attackFacing = Math.cos(aimAngle) >= 0 ? 1 : -1
    } else if (inCombat) {
      weapon.bowHasAim = false
      weapon.bowFreeAimReticleX = 0
      weapon.bowFreeAimReticleY = 0
      getFrontTransform(
        playerPos,
        facing,
        weapon.visual,
        radius,
        weapon.weaponType,
        weapon.width
      )
    } else {
      weapon.bowHasAim = false
      weapon.bowFreeAimReticleX = 0
      weapon.bowFreeAimReticleY = 0
      setWeaponBackTransform(
        playerPos,
        facing,
        weapon.visual,
        radius,
        weapon.weaponType,
        weapon.width,
        getBodyHalfHeight(entity.render, radius)
      )
    }

    if (weapon.bowRecoverElapsedMs > 0) {
      weapon.bowRecoverElapsedMs += deltaMs
      const recoverRatio = Math.min(
        1,
        weapon.bowRecoverElapsedMs / this.getRangedRecoverMs(weapon)
      )
      weapon.bowDrawRatio = Math.max(
        0,
        weapon.bowReleaseRatio * (1 - recoverRatio)
      )
      if (weapon.bowRecoverElapsedMs >= this.getRangedRecoverMs(weapon)) {
        weapon.bowRecoverElapsedMs = 0
        weapon.bowReleaseRatio = 0
        weapon.bowDrawRatio = 0
      }
      return
    }

    if (holdingAttack && !weapon.bowIsDrawing) {
      weapon.bowIsDrawing = true
      weapon.bowDrawElapsedMs = 0
      weapon.bowDrawRatio = 0
      weapon.bowForceRatio = 0
      weapon.bowReleaseRatio = 0
      weapon.bowReleasePending = false
      weapon.bowReleaseDelayMs = 0
      weapon.bowReleaseDelayTotalMs = 0
      if (this.statsSystem) {
        this.statsSystem.enterCombat(entity)
      }
    }

    if (holdingAttack) {
      weapon.bowDrawElapsedMs += deltaMs
      weapon.bowDrawRatio = Math.min(
        1,
        weapon.bowDrawElapsedMs / BOW_MAX_DRAW_MS
      )
      return
    }

    if (weapon.bowReleasePending) {
      weapon.bowReleaseDelayMs = Math.max(0, weapon.bowReleaseDelayMs - deltaMs)
      weapon.bowDrawElapsedMs += deltaMs
      const minForceRatio = this.getBowMinForceRatio(weapon)
      weapon.bowDrawRatio = Math.max(
        minForceRatio,
        Math.min(1, weapon.bowDrawElapsedMs / BOW_MAX_DRAW_MS)
      )
      weapon.bowForceRatio = weapon.bowDrawRatio

      if (weapon.bowReleaseDelayMs <= 0) {
        const drawRatio = weapon.bowForceRatio
        weapon.bowReleasePending = false
        weapon.bowReleaseDelayMs = 0
        weapon.bowReleaseDelayTotalMs = 0
        weapon.bowIsDrawing = false
        weapon.bowDrawElapsedMs = 0
        weapon.bowDrawRatio = 0
        weapon.bowForceRatio = 0

        if (drawRatio > 0) {
          weapon.bowReleaseRatio = drawRatio
          this.fireBowArrow(entity, weapon, facing, drawRatio)
          weapon.bowRecoverElapsedMs = 0.0001
        }
      }
      return
    }

    if (weapon.bowIsDrawing) {
      const drawRatio = weapon.bowDrawRatio
      const minForceRatio = this.getBowMinForceRatio(weapon)
      weapon.bowForceRatio = drawRatio

      const minWindupMs = this.getBowMinWindupMs(weapon)
      if (weapon.bowDrawElapsedMs < minWindupMs) {
        weapon.bowReleasePending = true
        weapon.bowReleaseDelayMs = minWindupMs - weapon.bowDrawElapsedMs
        weapon.bowReleaseDelayTotalMs = weapon.bowReleaseDelayMs
        return
      }

      weapon.bowIsDrawing = false
      weapon.bowDrawElapsedMs = 0
      weapon.bowDrawRatio = 0
      weapon.bowForceRatio = 0

      if (drawRatio > 0) {
        weapon.bowReleaseRatio = Math.max(drawRatio, minForceRatio)
        this.fireBowArrow(
          entity,
          weapon,
          facing,
          Math.max(drawRatio, minForceRatio)
        )
        weapon.bowRecoverElapsedMs = 0.0001
      }
    }
  }

  protected fireBowArrow(
    entity: Entity,
    weapon: WeaponComponent,
    facing: number,
    drawRatio: number
  ): void {
    if (
      !this.world ||
      !this.box2d ||
      !this.worldId ||
      !this.arrowPools ||
      !this.arrowBodyDef ||
      !this.arrowShapeDef ||
      !this.arrowCircle
    ) {
      return
    }

    if (weapon.bowAmmo <= 0) {
      return
    }

    const arrowFaction = entity.faction?.factionId ?? Faction.Player
    if (!this.arrowPools.canSpawn(arrowFaction)) {
      return
    }

    const arrowEntity = this.world.createEntity()
    const arrowTransform = this.arrowPools.acquireTransform()

    arrowTransform.x = weapon.visual.x
    arrowTransform.y = weapon.visual.y
    arrowTransform.rotation = 0
    arrowEntity.addComponent(arrowTransform)

    const physics = this.arrowPools.acquirePhysics()
    const { b2CreateBody, b2BodyType, b2CreateCircleShape } = this.box2d

    const bodyDef = this.arrowBodyDef
    bodyDef.type = b2BodyType.b2_dynamicBody
    bodyDef.position.Set(arrowTransform.x, arrowTransform.y)
    bodyDef.linearDamping = 0.05
    bodyDef.motionLocks.angularZ = true
    bodyDef.isBullet = true
    bodyDef.gravityScale = this.getRangedGravityScale(weapon)
    physics.bodyId = b2CreateBody(this.worldId, bodyDef)

    const arrowWeapon = this.arrowPools.acquireWeapon()
    const rangedTemplate = this.getRangedTemplate(weapon)
    const rangedBaseWidth = rangedTemplate.width > 0 ? rangedTemplate.width : 1
    const rangedScale = Math.max(0.5, weapon.width / rangedBaseWidth)
    const projectileVisualType = this.getRangedProjectileVisualType(weapon)
    const arrowLength =
      projectileVisualType === 'grapeShot'
        ? GRAPE_PROJECTILE_RADIUS * 2
        : DEFAULT_WEAPON_WIDTH * 0.9 * rangedScale
    const arrowThickness =
      projectileVisualType === 'grapeShot'
        ? GRAPE_PROJECTILE_RADIUS * 2
        : DEFAULT_WEAPON_HEIGHT * 0.15 * rangedScale
    const arrowSpeed = this.getRangedLaunchSpeed(weapon, drawRatio)
    const minForceRatio = this.getBowMinForceRatio(weapon)
    const forceDenom = 1 - minForceRatio
    const forceRatio =
      forceDenom > 0
        ? Math.min(1, Math.max(0, (drawRatio - minForceRatio) / forceDenom))
        : 1
    const forceMultiplier = 1 + forceRatio
    const aimAngle = weapon.bowHasAim
      ? weapon.bowAimAngle
      : facing === 1
        ? 0
        : Math.PI
    const arrowRotation = aimAngle + Math.PI / 2

    const circle = this.arrowCircle
    circle.center.Set(0, 0)
    circle.radius = this.getRangedProjectileRadius(weapon, arrowThickness)
    const shapeDef = this.arrowShapeDef
    shapeDef.density = this.getRangedProjectileDensity(weapon)
    shapeDef.material.friction = 0.2
    shapeDef.material.restitution = this.getRangedProjectileRestitution(weapon)
    shapeDef.filter.categoryBits = getWeaponCollisionCategory(
      weapon.renderLayer
    )
    shapeDef.filter.maskBits = getWeaponCollisionMask(weapon.renderLayer)
    physics.shapeId = b2CreateCircleShape(physics.bodyId, shapeDef, circle)

    const launchSpeed = arrowSpeed * 1.5
    if (this.tempVec) {
      this.tempVec.x = Math.cos(aimAngle) * launchSpeed
      this.tempVec.y = Math.sin(aimAngle) * launchSpeed
      this.box2d.b2Body_SetLinearVelocity(physics.bodyId, this.tempVec)
    }

    arrowEntity.addComponent(physics)

    arrowWeapon.width = arrowLength
    arrowWeapon.height = arrowThickness
    arrowWeapon.baseWidth = arrowLength
    arrowWeapon.blockWidthStart = arrowLength
    arrowWeapon.blockWidthTarget = arrowLength
    arrowWeapon.cornerRadius = circle.radius
    arrowWeapon.weight = 0
    arrowWeapon.weaponType = projectileVisualType
    arrowWeapon.attackDamage = weapon.attackDamage * forceMultiplier
    arrowWeapon.postureDamage = weapon.postureDamage * forceMultiplier
    arrowWeapon.toughnessDamage = weapon.toughnessDamage * forceMultiplier
    arrowWeapon.impactLevel = this.getRangedProjectileImpactLevel(
      weapon,
      projectileVisualType
    )
    arrowWeapon.isEquipped = false
    arrowWeapon.attackPhase = 'idle'
    arrowWeapon.renderLayer = weapon.renderLayer
    arrowWeapon.visual.x = arrowTransform.x
    arrowWeapon.visual.y = arrowTransform.y
    arrowWeapon.visual.rotation = arrowRotation
    arrowEntity.addComponent(arrowWeapon)

    const arrow = this.arrowPools.acquireArrow()
    arrow.ownerId = entity.id
    arrow.factionId = arrowFaction
    arrow.npcFactions = entity.faction?.npcFactions ?? []
    arrow.projectileType = projectileVisualType
    arrow.velocityX = Math.cos(aimAngle) * launchSpeed
    arrow.velocityY = Math.sin(aimAngle) * launchSpeed
    arrow.gravity = DEFAULT_GRAVITY * this.getRangedGravityScale(weapon)
    arrow.hitRadius = circle.radius
    arrow.elapsedMs = 0
    arrow.lifetimeMs = this.getRangedProjectileLifetimeMs(weapon)
    arrow.prevX = arrowTransform.x
    arrow.prevY = arrowTransform.y
    arrow.hasPrev = true
    arrowEntity.addComponent(arrow)

    this.arrowPools.registerSpawn(arrowFaction)
    weapon.bowAmmo = Math.max(0, weapon.bowAmmo - 1)
    this.playRangedFireSound(entity, weapon)
    this.removeDepletedConsumable(entity, weapon)
  }

  protected getBowAimAngleForTarget(
    entity: Entity,
    weapon: WeaponComponent,
    playerPos: { x: number; y: number },
    radius: number
  ): number | null {
    if (!this.entityLookup || !entity.input) return null
    const targetId = entity.input.lockedTargetId
    if (targetId === null) return null

    const target = this.entityLookup(targetId)
    if (!target?.transform || !target.stats || target.stats.isDead) return null

    const minForceRatio = this.getBowMinForceRatio(weapon)
    const drawRatio = weapon.bowIsDrawing
      ? weapon.bowDrawRatio
      : Math.max(weapon.bowDrawRatio, minForceRatio)
    return this.getBowAimAngleForPosition(
      weapon,
      playerPos,
      radius,
      target.transform.x,
      target.transform.y,
      drawRatio
    )
  }

  protected getBowAimAngleForPosition(
    weapon: Entity['weapon'],
    playerPos: { x: number; y: number },
    radius: number,
    targetX: number,
    targetY: number,
    drawRatio: number
  ): number {
    const speed = this.getRangedLaunchSpeed(weapon, drawRatio) * 1.5
    const offset = radius + 0.2
    let aimAngle = this.getBowAimAngle(
      weapon,
      playerPos.x,
      playerPos.y,
      targetX,
      targetY,
      speed
    )

    const originX = playerPos.x + Math.cos(aimAngle) * offset
    const originY = playerPos.y + Math.sin(aimAngle) * offset
    aimAngle = this.getBowAimAngle(
      weapon,
      originX,
      originY,
      targetX,
      targetY,
      speed
    )

    return aimAngle
  }

  protected getBowAimAngle(
    weapon: Entity['weapon'],
    originX: number,
    originY: number,
    targetX: number,
    targetY: number,
    speed: number
  ): number {
    const aimAngle = this.getBallisticAimAngle(
      originX,
      originY,
      targetX,
      targetY,
      speed,
      DEFAULT_GRAVITY * this.getRangedGravityScale(weapon)
    )
    return aimAngle ?? Math.atan2(targetY - originY, targetX - originX)
  }

  protected getRangedProjectileImpactLevel(
    weapon: WeaponComponent,
    projectileVisualType: Extract<WeaponVisualType, 'arrow' | 'grapeShot'>
  ): ImpactLevel {
    if (projectileVisualType !== 'arrow' || weapon.weaponType !== 'bow') {
      return 'small'
    }
    const bowTemplate = WEAPON_DEFAULT_DATA.bow
    const bowSizeLevel =
      Number.isFinite(weapon.sizeLevel) && weapon.sizeLevel > 0
        ? weapon.sizeLevel
        : bowTemplate.sizeLevel
    if (bowSizeLevel >= bowTemplate.sizeMaxLevel) {
      return 'extreme'
    }
    return 'small'
  }

  protected getBallisticAimAngle(
    originX: number,
    originY: number,
    targetX: number,
    targetY: number,
    speed: number,
    gravity: number
  ): number | null {
    const dx = targetX - originX
    const dyUp = originY - targetY
    const dxAbs = Math.abs(dx)
    if (dxAbs < 0.001) {
      return dyUp >= 0 ? -Math.PI / 2 : Math.PI / 2
    }

    const v2 = speed * speed
    const disc = v2 * v2 - gravity * (gravity * dxAbs * dxAbs + 2 * dyUp * v2)
    if (disc < 0) {
      return null
    }

    const sqrtDisc = Math.sqrt(disc)
    const tan = (v2 - sqrtDisc) / (gravity * dxAbs)
    let angle = Math.atan(tan)
    if (dx < 0) {
      angle = Math.PI - angle
    }
    return -angle
  }
}
