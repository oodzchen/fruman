import {
  COMBO_FINISHER_KNOCKBACK,
  DEFAULT_ATTACK_KNOCKBACK,
  DEFAULT_PARRY_WINDOW_MS,
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
  DEFAULT_WEAPON_HEIGHT,
  DEFAULT_WEAPON_MIN_ATTACK_INTERVAL_MS,
  DEFAULT_WEAPON_PICKUP_DISTANCE,
  DEFAULT_WEAPON_PLAYER_CLEARANCE,
  DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
  PARRY_ENEMY_TOUGHNESS_DAMAGE,
  PARRY_SELF_TOUGHNESS_RECOVERY,
  WEAPON_DROP_DURATION_MS,
} from '../../constants'
import type { MainModule, b2BodyId } from '../../types'
import type { WeaponRelativeTransform, WeaponTransform } from '../Component'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import type { SpatialHash } from '../SpatialHash'
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
  private spatialHash: SpatialHash | null = null
  private tempVec?: InstanceType<MainModule['b2Vec2']>

  private tempTransform: WeaponTransform = { x: 0, y: 0, rotation: 0 }
  private tempRelativeTransform: WeaponRelativeTransform = {
    dx: 0,
    dy: 0,
    rotation: 0,
  }
  private tempPlayerPos = { x: 0, y: 0 }
  private currentDeltaTime = 0

  constructor(box2d?: MainModule, statsSystem?: StatsSystem) {
    super()
    this.box2d = box2d
    this.statsSystem = statsSystem
    if (box2d) {
      this.tempVec = new box2d.b2Vec2(0, 0)
    }

    const transformType = componentRegistry.getComponentType('Transform')
    const weaponType = componentRegistry.getComponentType('Weapon')
    this.setRequiredComponents([transformType, weaponType])
  }

  update(entities: Entity[], deltaTime: number): void {
    this.currentDeltaTime = deltaTime
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

  setSpatialHash(spatialHash: SpatialHash): void {
    this.spatialHash = spatialHash
  }

  private updateWeapon(entity: Entity, deltaMs: number): void {
    if (!entity.transform || !entity.weapon) return

    const weapon = entity.weapon
    this.tempPlayerPos.x = entity.transform.x
    this.tempPlayerPos.y = entity.transform.y
    const playerPos = this.tempPlayerPos
    const inputFacing =
      entity.input && entity.input.lastMoveDirection !== 0
        ? entity.input.lastMoveDirection
        : weapon.attackFacing

    if (weapon.attackPhase === 'idle') {
      weapon.attackFacing = inputFacing
    }

    if (!weapon.isEquipped) {
      weapon.visual.x = weapon.position.x
      weapon.visual.y = weapon.position.y
      weapon.visual.rotation = weapon.rotation
      return
    }

    // 处理武器掉落动画（使用相对偏移量，跟随玩家移动）
    if (weapon.isDropping) {
      weapon.dropElapsedTime += this.currentDeltaTime
      const elapsedMs = weapon.dropElapsedTime * 1000
      const progress = Math.min(1, elapsedMs / WEAPON_DROP_DURATION_MS)

      // 使用缓动函数使动画更自然
      const eased = 1 - Math.pow(1 - progress, 2)

      // 插值相对偏移量
      this.lerpRelativeTransform(
        weapon.dropStartOffset,
        weapon.dropEndOffset,
        eased,
        this.tempRelativeTransform
      )

      // 应用到当前玩家位置
      this.applyOffset(this.tempRelativeTransform, playerPos, weapon.visual)

      if (progress >= 1) {
        weapon.isDropping = false
        weapon.isDropped = true
      }
      return
    }

    // 崩塌期间保持武器在地上（跟随玩家位置）
    if (entity.stats?.isStaggered) {
      if (weapon.isDropped) {
        // 武器掉落完成，保持在玩家脚下
        this.applyOffset(weapon.dropEndOffset, playerPos, weapon.visual)
      }
      return
    }

    // 崩塌解除后启动武器回收动画
    if (weapon.isDropped && !weapon.isRecovering) {
      this.startWeaponRecover(entity)
    }

    // 处理武器回收动画（使用相对偏移量，跟随玩家移动）
    if (weapon.isRecovering) {
      weapon.dropElapsedTime += this.currentDeltaTime
      const elapsedMs = weapon.dropElapsedTime * 1000
      const progress = Math.min(1, elapsedMs / WEAPON_DROP_DURATION_MS)

      // 使用缓动函数
      const eased = 1 - Math.pow(1 - progress, 2)

      // 插值相对偏移量
      this.lerpRelativeTransform(
        weapon.dropStartOffset,
        weapon.dropEndOffset,
        eased,
        this.tempRelativeTransform
      )

      // 应用到当前玩家位置
      this.applyOffset(this.tempRelativeTransform, playerPos, weapon.visual)

      if (progress >= 1) {
        weapon.isRecovering = false
        weapon.isDropped = false
      }
      return
    }

    const now = Date.now()
    const attackRadius = weapon.attackRadius || this.getAttackRadius(weapon)
    const attackFacing = weapon.attackFacing

    this.applyOffset(
      weapon.attackStartOffset,
      playerPos,
      weapon.attackStartTransform
    )
    this.applyOffset(
      weapon.swingStartOffset,
      playerPos,
      weapon.swingStartTransform
    )
    this.applyOffset(weapon.swingEndOffset, playerPos, weapon.swingEndTransform)

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
      if (entity.input && entity.input.blockRequested && !entity.isStunned()) {
        weapon.attackPhase = 'block'
        weapon.parryElapsedTime = 0
        weapon.isParrying = true
        weapon.isBlocking = true
        weapon.isInCombat = true
        weapon.parryHitWeaponIds.clear()

        // 初始化弹反起始和目标位置
        const blockRotation = -Math.PI / 2
        this.getOffsetFromTransform(
          weapon.visual,
          playerPos,
          weapon.parryStartOffset
        )
        weapon.parryEndOffset.dx = inputFacing * DEFAULT_WEAPON_FRONT_OFFSET_X
        weapon.parryEndOffset.dy = 0
        weapon.parryEndOffset.rotation = blockRotation

        weapon.parryStartTransform.x = weapon.visual.x
        weapon.parryStartTransform.y = weapon.visual.y
        weapon.parryStartTransform.rotation = weapon.visual.rotation

        weapon.parryEndTransform.x =
          playerPos.x + inputFacing * DEFAULT_WEAPON_FRONT_OFFSET_X
        weapon.parryEndTransform.y = playerPos.y
        weapon.parryEndTransform.rotation = blockRotation
        return
      }
      this.handleIdlePhase(entity, playerPos, attackRadius, attackFacing, now)
      return
    }

    if (weapon.attackPhase === 'block') {
      this.handleBlockPhase(entity, playerPos, inputFacing)
      return
    }

    weapon.attackElapsedMs += deltaMs

    if (weapon.attackPhase === 'windup') {
      this.handleWindupPhase(entity, weapon)
      return
    }

    if (weapon.attackPhase === 'finalWindup') {
      this.handleFinalWindupPhase(entity, weapon)
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

  private handleBlockPhase(
    entity: Entity,
    playerPos: { x: number; y: number },
    facing: number
  ): void {
    if (!entity.weapon) return
    const weapon = entity.weapon

    // 硬直期间退出格挡
    if (entity.isStunned()) {
      weapon.attackPhase = 'idle'
      weapon.isBlocking = false
      weapon.isParrying = false
      weapon.parryElapsedTime = 0
      return
    }

    // 弹反窗口结束后，松开格挡键才能退出
    if (!weapon.isParrying && entity.input && !entity.input.blockRequested) {
      weapon.attackPhase = 'idle'
      weapon.isBlocking = false
      weapon.isParrying = false
      weapon.parryElapsedTime = 0
      return
    }

    weapon.isBlocking = true
    weapon.isInCombat = true
    weapon.lastAttackTimestamp = Date.now()

    // 弹反窗口期间（只在武器移动期间有效）
    if (weapon.isParrying) {
      weapon.parryElapsedTime += this.currentDeltaTime
      const elapsedMs = weapon.parryElapsedTime * 1000
      const progress = Math.min(1, elapsedMs / DEFAULT_PARRY_WINDOW_MS)

      // 插值相对位置并应用
      this.lerpRelativeTransform(
        weapon.parryStartOffset,
        weapon.parryEndOffset,
        progress,
        this.tempRelativeTransform
      )
      this.applyOffset(this.tempRelativeTransform, playerPos, weapon.visual)

      // 弹反窗口内检测敌人武器碰撞
      this.checkParryHits(entity)

      // 弹反窗口结束
      if (elapsedMs >= DEFAULT_PARRY_WINDOW_MS) {
        weapon.isParrying = false
        // 如果弹反窗口结束时格挡键已松开，自动退出
        if (entity.input && !entity.input.blockRequested) {
          weapon.attackPhase = 'idle'
          weapon.isBlocking = false
          weapon.parryElapsedTime = 0
          return
        }
      }
    } else {
      // 弹反窗口结束后，保持格挡姿态（相对于角色）
      this.applyOffset(weapon.parryEndOffset, playerPos, weapon.visual)
    }
  }

  private checkParryHits(defender: Entity): void {
    if (!defender.weapon || !defender.faction || !defender.stats) return

    const weapon = defender.weapon
    const weaponX = weapon.visual.x
    const weaponY = weapon.visual.y
    const weaponWidth = weapon.width
    const weaponHeight = weapon.height
    const weaponRotation = weapon.visual.rotation

    for (const attacker of this.allEntities) {
      if (attacker.id === defender.id) continue
      if (!attacker.weapon || !attacker.faction || !attacker.stats) continue
      if (attacker.stats.isDead) continue
      if (!defender.faction.canAttack(attacker.faction)) continue

      // 只检测正在攻击的敌人武器（swing 阶段）
      if (attacker.weapon.attackPhase !== 'swing') continue

      // 避免重复弹反同一个武器
      if (weapon.parryHitWeaponIds.has(attacker.id)) continue

      const attackerWeapon = attacker.weapon
      const attackerX = attackerWeapon.visual.x
      const attackerY = attackerWeapon.visual.y
      const attackerWidth = attackerWeapon.width
      const attackerHeight = attackerWeapon.height
      const attackerRotation = attackerWeapon.visual.rotation

      // 武器对武器 OBB 碰撞检测
      if (
        this.checkOBBvsOBB(
          weaponX,
          weaponY,
          weaponWidth,
          weaponHeight,
          weaponRotation,
          attackerX,
          attackerY,
          attackerWidth,
          attackerHeight,
          attackerRotation
        )
      ) {
        weapon.parryHitWeaponIds.add(attacker.id)
        this.applyParryEffect(defender, attacker)
      }
    }
  }

  private applyParryEffect(defender: Entity, attacker: Entity): void {
    if (!defender.stats || !attacker.stats) return

    // 敌人韧性减少
    const newToughness = attacker.stats.toughness - PARRY_ENEMY_TOUGHNESS_DAMAGE
    attacker.stats.toughness = Math.max(0, newToughness)

    // 我方韧性恢复
    defender.stats.toughness = Math.min(
      defender.stats.maxToughness,
      defender.stats.toughness + PARRY_SELF_TOUGHNESS_RECOVERY
    )

    // 韧性清空时触发崩塌
    if (newToughness <= 0) {
      // 触发攻击者武器回弹效果
      // 具体的崩塌状态和武器掉落由 StatsSystem 统一处理
      if (attacker.weapon && attacker.transform) {
        this.tempPlayerPos.x = attacker.transform.x
        this.tempPlayerPos.y = attacker.transform.y
        this.startRebound(attacker, this.tempPlayerPos, Date.now())
      }
    } else {
      // 普通弹反：仅免疫伤害，不打断攻击，不回弹
      if (attacker.weapon) {
        // 将防御者加入已击中列表，从而避免产生伤害
        attacker.weapon.hitEntityIds.add(defender.id)
      }
    }
  }

  private startWeaponRecover(entity: Entity): void {
    if (!entity.weapon || !entity.transform) return

    const weapon = entity.weapon
    weapon.isRecovering = true
    weapon.dropElapsedTime = 0

    // 计算起始相对偏移（当前武器位置相对于玩家）
    this.getOffsetFromTransform(
      weapon.visual,
      { x: entity.transform.x, y: entity.transform.y },
      weapon.dropStartOffset
    )

    // 计算目标相对偏移（回到角色身侧）
    const facing =
      entity.input && entity.input.lastMoveDirection !== 0
        ? entity.input.lastMoveDirection
        : 1
    weapon.dropEndOffset.dx = -facing * DEFAULT_WEAPON_FOLLOW_OFFSET_X
    weapon.dropEndOffset.dy = DEFAULT_WEAPON_FOLLOW_OFFSET_Y
    weapon.dropEndOffset.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
  }

  private checkOBBvsOBB(
    x1: number,
    y1: number,
    w1: number,
    h1: number,
    rot1: number,
    x2: number,
    y2: number,
    w2: number,
    h2: number,
    rot2: number
  ): boolean {
    // 分离轴定理（SAT）检测两个 OBB 是否相交
    const cos1 = Math.cos(rot1)
    const sin1 = Math.sin(rot1)
    const cos2 = Math.cos(rot2)
    const sin2 = Math.sin(rot2)

    // 两个OBB的轴
    const axes = [
      { x: cos1, y: sin1 },
      { x: -sin1, y: cos1 },
      { x: cos2, y: sin2 },
      { x: -sin2, y: cos2 },
    ]

    // 两个OBB的半尺寸
    const hw1 = w1 / 2
    const hh1 = h1 / 2
    const hw2 = w2 / 2
    const hh2 = h2 / 2

    // 中心点差值
    const dx = x2 - x1
    const dy = y2 - y1

    for (const axis of axes) {
      // 投影两个OBB到轴上
      const proj1 =
        Math.abs(hw1 * (cos1 * axis.x + sin1 * axis.y)) +
        Math.abs(hh1 * (-sin1 * axis.x + cos1 * axis.y))
      const proj2 =
        Math.abs(hw2 * (cos2 * axis.x + sin2 * axis.y)) +
        Math.abs(hh2 * (-sin2 * axis.x + cos2 * axis.y))
      const projDist = Math.abs(dx * axis.x + dy * axis.y)

      // 如果投影不重叠，则不相交
      if (projDist > proj1 + proj2) {
        return false
      }
    }

    return true
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
    weapon.isBlocking = false
    weapon.isParrying = false
    weapon.parryElapsedTime = 0
    const facing =
      entity.input.lastMoveDirection !== 0 ? entity.input.lastMoveDirection : 1

    if (weapon.isInCombat) {
      this.getFrontTransform(playerPos, facing, weapon.visual)
    } else {
      this.getBackTransform(playerPos, facing, weapon.visual)
    }

    if (weapon.attackQueued && weapon.comboCount < 5) {
      weapon.attackQueued = false
      weapon.comboCount += 1
      weapon.swingDirection = weapon.nextSwingDirection
      weapon.nextSwingDirection =
        weapon.swingDirection === 'toFront' ? 'toHead' : 'toFront'

      this.getSwingTransforms(
        attackRadius,
        attackFacing,
        weapon.swingDirection,
        playerPos,
        weapon.swingStartTransform,
        weapon.swingEndTransform
      )

      this.getOffsetFromTransform(
        weapon.visual,
        playerPos,
        weapon.attackStartOffset
      )
      this.getOffsetFromTransform(
        weapon.swingStartTransform,
        playerPos,
        weapon.swingStartOffset
      )
      this.getOffsetFromTransform(
        weapon.swingEndTransform,
        playerPos,
        weapon.swingEndOffset
      )

      weapon.isInCombat = true
      weapon.attackPhase = 'windup'
      weapon.attackElapsedMs = 0
      weapon.lastAttackTimestamp = now
      weapon.attackFacing = attackFacing

      // Update attackStartTransform based on current visual (which was just set)
      this.applyOffset(
        weapon.attackStartOffset,
        playerPos,
        weapon.attackStartTransform
      )

      // Visual starts at attackStartTransform
      this.copyTransform(weapon.visual, weapon.attackStartTransform)

      weapon.attackRadius = attackRadius
      weapon.knockback = DEFAULT_ATTACK_KNOCKBACK
      weapon.hitEntityIds.clear()
    }
  }

  private handleWindupPhase(entity: Entity, weapon: Entity['weapon']): void {
    if (!weapon || !entity.transform) return

    const isGrounded = entity.movement?.isGrounded ?? true
    const windupDuration = isGrounded ? DEFAULT_WEAPON_ATTACK_WINDUP_MS : 250

    const t = this.clamp01(weapon.attackElapsedMs / windupDuration)

    this.lerpRelativeTransform(
      weapon.attackStartOffset,
      weapon.swingStartOffset,
      t,
      this.tempRelativeTransform
    )

    this.tempPlayerPos.x = entity.transform.x
    this.tempPlayerPos.y = entity.transform.y
    this.applyOffset(
      this.tempRelativeTransform,
      this.tempPlayerPos,
      weapon.visual
    )

    if (t >= 1) {
      weapon.attackPhase = 'swing'
      weapon.attackElapsedMs = 0
      // We don't need to copyTransform(attackStartTransform, swingStartTransform) anymore for logic,
      // but keeping data consistent is fine. However, logic now relies on offsets.
      this.copyTransform(
        weapon.attackStartTransform,
        weapon.swingStartTransform
      )
      weapon.hitEntityIds.clear()
    }
  }

  private handleFinalWindupPhase(
    entity: Entity,
    weapon: Entity['weapon']
  ): void {
    if (!weapon || !entity.transform) return

    const t = this.clamp01(
      weapon.attackElapsedMs / DEFAULT_WEAPON_FINAL_WINDUP_MS
    )

    this.lerpRelativeTransform(
      weapon.attackStartOffset,
      weapon.swingStartOffset,
      t,
      this.tempRelativeTransform
    )

    this.tempPlayerPos.x = entity.transform.x
    this.tempPlayerPos.y = entity.transform.y
    this.applyOffset(
      this.tempRelativeTransform,
      this.tempPlayerPos,
      weapon.visual
    )

    if (t >= 1) {
      weapon.attackPhase = 'swing'
      weapon.attackElapsedMs = 0
      this.copyTransform(
        weapon.attackStartTransform,
        weapon.swingStartTransform
      )
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

    this.lerpRelativeTransform(
      weapon.swingStartOffset,
      weapon.swingEndOffset,
      t,
      this.tempRelativeTransform
    )
    this.applyOffset(this.tempRelativeTransform, playerPos, weapon.visual)

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
      this.getOffsetFromTransform(
        weapon.visual,
        playerPos,
        weapon.attackStartOffset
      )
      this.copyTransform(weapon.attackStartTransform, weapon.visual)
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

    this.copyTransform(weapon.visual, weapon.attackStartTransform)

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
      weapon.attackPhase !== 'rebound' &&
      weapon.attackElapsedMs >= DEFAULT_WEAPON_MIN_ATTACK_INTERVAL_MS

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

        // Use tempTransform for intermediate result
        this.getTransformAtAngle(
          playerPos,
          windupAngle,
          finalWindupRadius,
          this.tempTransform
        )
        // Copy to swingStartTransform (which is finalWindupTransform in this context)
        this.copyTransform(weapon.swingStartTransform, this.tempTransform)

        this.getOffsetFromTransform(
          weapon.swingStartTransform, // finalWindupTransform
          playerPos,
          weapon.swingStartOffset // finalWindupOffset
        )

        const swingEndAngle =
          weapon.swingDirection === 'toFront' ? frontAngle : headAngle

        this.getTransformAtAngle(
          playerPos,
          swingEndAngle,
          attackRadius,
          weapon.swingEndTransform
        )

        this.getOffsetFromTransform(
          weapon.swingEndTransform,
          playerPos,
          weapon.swingEndOffset
        )

        weapon.attackPhase = 'finalWindup'
        weapon.attackElapsedMs = 0
        this.getOffsetFromTransform(
          weapon.visual,
          playerPos,
          weapon.attackStartOffset
        )

        this.copyTransform(weapon.attackStartTransform, weapon.visual)
        // weapon.swingStartTransform is already set above
        // weapon.swingEndTransform is already set above

        weapon.lastAttackTimestamp = now
        weapon.knockback = COMBO_FINISHER_KNOCKBACK
        return
      }

      const swingEndAngle =
        weapon.swingDirection === 'toFront' ? frontAngle : headAngle

      this.getTransformAtAngle(
        playerPos,
        swingEndAngle,
        attackRadius,
        weapon.swingEndTransform
      )

      this.getOffsetFromTransform(
        weapon.visual,
        playerPos,
        weapon.swingStartOffset
      )
      this.getOffsetFromTransform(
        weapon.swingEndTransform,
        playerPos,
        weapon.swingEndOffset
      )

      weapon.attackPhase = 'swing'
      weapon.attackElapsedMs = 0

      this.copyTransform(weapon.swingStartTransform, weapon.visual)
      // weapon.swingEndTransform is set above

      this.copyTransform(weapon.attackStartTransform, weapon.visual)
      weapon.lastAttackTimestamp = now
      weapon.knockback = DEFAULT_ATTACK_KNOCKBACK
      weapon.hitEntityIds.clear()
      return
    }

    if (!reachedPause) return

    weapon.attackPhase = 'recover'
    weapon.reboundLockedPause = false
    weapon.attackElapsedMs = 0
    this.copyTransform(weapon.attackStartTransform, weapon.visual)
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

    // Calculate target offset (Idle Front)
    const targetOffset = this.tempRelativeTransform // Reuse temp as target container temporarily?
    // Actually, lerpRelativeTransform writes to 'out'. I need 'to' argument.
    // I can construct a literal object or use another component field.
    // Let's use weapon.swingEndOffset as a temporary holder since it's not used in recover.
    weapon.swingEndOffset.dx = facing * DEFAULT_WEAPON_CENTER_OFFSET_X
    weapon.swingEndOffset.dy = DEFAULT_WEAPON_FRONT_OFFSET_Y
    weapon.swingEndOffset.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD

    this.lerpRelativeTransform(
      weapon.attackStartOffset,
      weapon.swingEndOffset,
      t,
      this.tempRelativeTransform // Output
    )

    this.applyOffset(this.tempRelativeTransform, playerPos, weapon.visual)

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

    const dx = entity.transform.x - entity.weapon.position.x
    const dy = entity.transform.y - entity.weapon.position.y
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
    if (entity.isStunned()) return

    const weapon = entity.weapon
    const now = Date.now()
    this.tempPlayerPos.x = entity.transform.x
    this.tempPlayerPos.y = entity.transform.y
    const playerPos = this.tempPlayerPos
    const facing =
      entity.input.lastMoveDirection !== 0 ? entity.input.lastMoveDirection : 1
    const attackRadius = this.getAttackRadius(weapon)
    weapon.attackRadius = attackRadius
    weapon.attackFacing = facing

    if (weapon.comboCount >= 5) return

    if (weapon.attackPhase === 'idle') {
      this.getSwingTransforms(
        attackRadius,
        facing,
        weapon.swingDirection,
        playerPos,
        weapon.swingStartTransform,
        weapon.swingEndTransform
      )

      this.getOffsetFromTransform(
        weapon.visual,
        playerPos,
        weapon.attackStartOffset
      )
      this.getOffsetFromTransform(
        weapon.swingStartTransform,
        playerPos,
        weapon.swingStartOffset
      )
      this.getOffsetFromTransform(
        weapon.swingEndTransform,
        playerPos,
        weapon.swingEndOffset
      )

      weapon.swingDirection = weapon.nextSwingDirection
      weapon.nextSwingDirection =
        weapon.swingDirection === 'toFront' ? 'toHead' : 'toFront'
      weapon.isInCombat = true
      weapon.attackPhase = 'windup'
      weapon.attackElapsedMs = 0
      weapon.lastAttackTimestamp = now

      this.applyOffset(
        weapon.attackStartOffset,
        playerPos,
        weapon.attackStartTransform
      )

      weapon.attackRadius = attackRadius
      weapon.comboCount = 1
      weapon.attackQueued = false

      this.applyOffset(weapon.attackStartOffset, playerPos, weapon.visual)

      weapon.knockback = DEFAULT_ATTACK_KNOCKBACK
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
    t: number,
    out: WeaponTransform
  ): void {
    const clampedT = this.clamp01(t)
    out.x = from.x + (to.x - from.x) * clampedT
    out.y = from.y + (to.y - from.y) * clampedT
    out.rotation = from.rotation + (to.rotation - from.rotation) * clampedT
  }

  private lerpRelativeTransform(
    from: WeaponRelativeTransform,
    to: WeaponRelativeTransform,
    t: number,
    out: WeaponRelativeTransform
  ): void {
    const clampedT = this.clamp01(t)
    out.dx = from.dx + (to.dx - from.dx) * clampedT
    out.dy = from.dy + (to.dy - from.dy) * clampedT
    out.rotation = from.rotation + (to.rotation - from.rotation) * clampedT
  }

  private getOffsetFromTransform(
    transform: WeaponTransform,
    playerPos: { x: number; y: number },
    out: WeaponRelativeTransform
  ): void {
    out.dx = transform.x - playerPos.x
    out.dy = transform.y - playerPos.y
    out.rotation = transform.rotation
  }

  private applyOffset(
    offset: WeaponRelativeTransform,
    playerPos: { x: number; y: number },
    out: WeaponTransform
  ): void {
    out.x = playerPos.x + offset.dx
    out.y = playerPos.y + offset.dy
    out.rotation = offset.rotation
  }

  private realignToFacing(
    weapon: Entity['weapon'],
    playerPos: { x: number; y: number },
    facing: number,
    minimumElapsedMs: number
  ): void {
    if (!weapon) return
    this.getFrontTransform(playerPos, facing, weapon.visual)
    this.getOffsetFromTransform(
      weapon.visual,
      playerPos,
      weapon.attackStartOffset
    )
    weapon.attackFacing = facing
    this.copyTransform(weapon.attackStartTransform, weapon.visual)
    this.copyTransform(weapon.swingStartTransform, weapon.visual)
    this.copyTransform(weapon.swingEndTransform, weapon.visual)
    this.getOffsetFromTransform(
      weapon.visual,
      playerPos,
      weapon.swingStartOffset
    )
    this.getOffsetFromTransform(weapon.visual, playerPos, weapon.swingEndOffset)

    weapon.attackElapsedMs = Math.max(weapon.attackElapsedMs, minimumElapsedMs)
  }

  private getBackTransform(
    playerPos: { x: number; y: number },
    facing: number,
    out: WeaponTransform
  ): void {
    out.x = playerPos.x - facing * DEFAULT_WEAPON_FOLLOW_OFFSET_X
    out.y = playerPos.y + DEFAULT_WEAPON_FOLLOW_OFFSET_Y
    out.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
  }

  private getFrontTransform(
    playerPos: { x: number; y: number },
    facing: number,
    out: WeaponTransform
  ): void {
    out.x = playerPos.x + facing * DEFAULT_WEAPON_CENTER_OFFSET_X
    out.y = playerPos.y + DEFAULT_WEAPON_FRONT_OFFSET_Y
    out.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
  }

  private getSwingTransforms(
    radius: number,
    facing: number,
    direction: 'toFront' | 'toHead',
    playerPos: { x: number; y: number },
    outStart: WeaponTransform,
    outEnd: WeaponTransform
  ): void {
    const frontAngle =
      facing === 1 ? FRONT_SWING_TILT_RAD : -Math.PI - FRONT_SWING_TILT_RAD
    const headAngle = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
    const swingStartAngle = direction === 'toFront' ? headAngle : frontAngle
    const swingEndAngle = direction === 'toFront' ? frontAngle : headAngle

    this.getTransformAtAngle(playerPos, swingStartAngle, radius, outStart)
    this.getTransformAtAngle(playerPos, swingEndAngle, radius, outEnd)
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

    this.getFrontTransform(playerPos, newFacing, weapon.visual)
  }

  private resetWeaponState(entity: Entity): void {
    if (!entity.weapon) return

    const weapon = entity.weapon
    weapon.attackQueued = false
    weapon.isInCombat = false
    weapon.attackPhase = 'idle'
    weapon.attackElapsedMs = 0
    weapon.isColliding = false
    weapon.isBlocking = false
    weapon.isParrying = false
    weapon.parryElapsedTime = 0
    weapon.hitEntityIds.clear()

    if (!entity.transform) return

    if (!weapon.isEquipped) {
      weapon.visual.x = weapon.position.x
      weapon.visual.y = weapon.position.y
      weapon.visual.rotation = weapon.rotation
      return
    }

    const facing =
      entity.input && entity.input.lastMoveDirection !== 0
        ? entity.input.lastMoveDirection
        : 1
    this.tempPlayerPos.x = entity.transform.x
    this.tempPlayerPos.y = entity.transform.y
    this.getBackTransform(this.tempPlayerPos, facing, weapon.visual)
  }

  private checkOBBvsAABB(
    obbCenterX: number,
    obbCenterY: number,
    obbWidth: number,
    obbHeight: number,
    obbRotation: number,
    aabbCenterX: number,
    aabbCenterY: number,
    aabbHalfWidth: number,
    aabbHalfHeight: number
  ): boolean {
    const cos = Math.cos(obbRotation)
    const sin = Math.sin(obbRotation)

    const dx = obbCenterX - aabbCenterX
    const dy = obbCenterY - aabbCenterY

    const projD1 = Math.abs(dx * cos + dy * sin)
    const projAABB1 =
      aabbHalfWidth * Math.abs(cos) + aabbHalfHeight * Math.abs(sin)
    if (projD1 > obbWidth / 2 + projAABB1) return false

    const projD2 = Math.abs(-dx * sin + dy * cos)
    const projAABB2 =
      aabbHalfWidth * Math.abs(sin) + aabbHalfHeight * Math.abs(cos)
    if (projD2 > obbHeight / 2 + projAABB2) return false

    const projD3 = Math.abs(dx)
    const projOBB3 =
      (obbWidth / 2) * Math.abs(cos) + (obbHeight / 2) * Math.abs(sin)
    if (projD3 > projOBB3 + aabbHalfWidth) return false

    const projD4 = Math.abs(dy)
    const projOBB4 =
      (obbWidth / 2) * Math.abs(sin) + (obbHeight / 2) * Math.abs(cos)
    if (projD4 > projOBB4 + aabbHalfHeight) return false

    return true
  }

  private checkOBBvsCircle(
    obbCenterX: number,
    obbCenterY: number,
    obbWidth: number,
    obbHeight: number,
    obbRotation: number,
    circleX: number,
    circleY: number,
    circleRadius: number
  ): boolean {
    const cos = Math.cos(-obbRotation)
    const sin = Math.sin(-obbRotation)

    const dx = circleX - obbCenterX
    const dy = circleY - obbCenterY

    const localX = dx * cos - dy * sin
    const localY = dx * sin + dy * cos

    const halfWidth = obbWidth / 2
    const halfHeight = obbHeight / 2

    const clampedX = Math.max(-halfWidth, Math.min(halfWidth, localX))
    const clampedY = Math.max(-halfHeight, Math.min(halfHeight, localY))

    const closestX = clampedX
    const closestY = clampedY

    const distanceX = localX - closestX
    const distanceY = localY - closestY

    const distanceSquared = distanceX * distanceX + distanceY * distanceY

    return distanceSquared <= circleRadius * circleRadius
  }

  private checkObstacleCollision(weapon?: Entity['weapon']): boolean {
    if (!this.box2d || !weapon) return false
    if (this.obstacles.length === 0) return false

    const { b2Body_GetPosition } = this.box2d
    const wx = weapon.visual.x
    const wy = weapon.visual.y
    const wWidth = weapon.width
    const wHeight = weapon.height
    const wRotation = weapon.visual.rotation

    for (const obstacle of this.obstacles) {
      const pos = b2Body_GetPosition(obstacle.bodyId)
      const halfW = obstacle.width
      const halfH = obstacle.height

      if (
        this.checkOBBvsAABB(
          wx,
          wy,
          wWidth,
          wHeight,
          wRotation,
          pos.x,
          pos.y,
          halfW,
          halfH
        )
      ) {
        pos.delete()
        return true
      }
      pos.delete()
    }

    return false
  }

  private applyPushback(entity: Entity, weapon: Entity['weapon']): void {
    if (!entity.physics || !this.box2d || !weapon || !this.tempVec) return

    const { b2Body_ApplyLinearImpulseToCenter } = this.box2d
    const dirX = Math.cos(weapon.visual.rotation)
    const dirY = Math.sin(weapon.visual.rotation)
    const impulseStrength = 0.2
    this.tempVec.x = -dirX * impulseStrength
    this.tempVec.y = -dirY * impulseStrength
    b2Body_ApplyLinearImpulseToCenter(entity.physics.bodyId, this.tempVec, true)
  }

  private checkEntityHits(attacker: Entity, weapon: Entity['weapon']): void {
    if (!this.statsSystem) return
    if (!attacker.transform || !attacker.faction) return
    if (!weapon || !weapon.hitEntityIds) return

    const weaponX = weapon.visual.x
    const weaponY = weapon.visual.y
    const weaponWidth = weapon.width
    const weaponHeight = weapon.height
    const weaponRotation = weapon.visual.rotation

    // 使用攻击半径进行宽阶段检测优化
    const attackRadius =
      weapon.attackRadius !== 0
        ? weapon.attackRadius
        : this.getAttackRadius(weapon)

    const nearbyEntities = this.spatialHash
      ? this.spatialHash.query(weaponX, weaponY, attackRadius + 2)
      : this.allEntities
    const nearbyCount = this.spatialHash
      ? this.spatialHash.getQueryResultLength()
      : nearbyEntities.length

    for (let i = 0; i < nearbyCount; i++) {
      const target = nearbyEntities[i]
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

      if (
        this.checkOBBvsCircle(
          weaponX,
          weaponY,
          weaponWidth,
          weaponHeight,
          weaponRotation,
          target.transform.x,
          target.transform.y,
          targetRadius
        )
      ) {
        this.statsSystem.applyWeaponHit(target, weapon, {
          x: weaponX,
          y: weaponY,
        })
        weapon.isColliding = true
        weapon.hitEntityIds.add(target.id)
      }
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

    // reboundTargetOffset is WeaponRelativeTransform
    this.getOffsetFromTransform(
      weapon.swingStartTransform,
      playerPos,
      weapon.reboundTargetOffset
    )

    // reboundTargetTransform is WeaponTransform
    this.applyOffset(
      weapon.reboundTargetOffset,
      playerPos,
      weapon.reboundTargetTransform
    )

    weapon.attackPhase = 'rebound'
    weapon.attackElapsedMs = 0
    weapon.attackQueued = false
    weapon.reboundLockedPause = true

    // update attackStartOffset/swingStartOffset with current visual pos
    this.getOffsetFromTransform(
      weapon.visual,
      playerPos,
      weapon.attackStartOffset
    )
    this.getOffsetFromTransform(
      weapon.visual,
      playerPos,
      weapon.swingStartOffset
    )

    this.copyRelativeTransform(
      weapon.swingEndOffset,
      weapon.reboundTargetOffset
    )

    this.copyTransform(weapon.attackStartTransform, weapon.visual)
    this.copyTransform(weapon.swingStartTransform, weapon.visual)
    this.copyTransform(weapon.swingEndTransform, weapon.reboundTargetTransform)

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

    const t = this.clamp01(weapon.attackElapsedMs / reboundDurationMs)

    this.lerpRelativeTransform(
      weapon.swingStartOffset,
      weapon.reboundTargetOffset,
      t,
      this.tempRelativeTransform
    )
    this.applyOffset(this.tempRelativeTransform, playerPos, weapon.visual)

    if (t >= 1) {
      weapon.attackPhase = 'pause'
      weapon.attackElapsedMs = 0
      this.getOffsetFromTransform(
        weapon.visual,
        playerPos,
        weapon.attackStartOffset
      )
      this.copyTransform(weapon.attackStartTransform, weapon.visual)
      weapon.lastAttackTimestamp = now
    }
  }

  private getTransformAtAngle(
    playerPos: { x: number; y: number },
    angle: number,
    radius: number,
    out: WeaponTransform
  ): void {
    out.x = playerPos.x + Math.cos(angle) * radius
    out.y = playerPos.y + Math.sin(angle) * radius
    out.rotation = angle
  }

  private copyTransform(
    target: WeaponTransform,
    source: WeaponTransform
  ): void {
    target.x = source.x
    target.y = source.y
    target.rotation = source.rotation
  }

  private copyRelativeTransform(
    target: WeaponRelativeTransform,
    source: WeaponRelativeTransform
  ): void {
    target.dx = source.dx
    target.dy = source.dy
    target.rotation = source.rotation
  }
}
