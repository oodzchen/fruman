import {
  CATEGORY_WEAPON,
  COMBO_FINISHER_KNOCKBACK,
  DEBUG_ANIMATION_SLOWDOWN,
  DEFAULT_ATTACK_KNOCKBACK,
  DEFAULT_FRAME_RATE,
  DEFAULT_GRAVITY,
  DEFAULT_PARRY_WINDOW_MS,
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_WEAPON_ATTACK_PAUSE_MS,
  DEFAULT_WEAPON_ATTACK_RADIUS,
  DEFAULT_WEAPON_ATTACK_RECOVER_MS,
  DEFAULT_WEAPON_ATTACK_SWING_MS,
  DEFAULT_WEAPON_ATTACK_WINDUP_MS,
  DEFAULT_WEAPON_CENTER_OFFSET_X,
  DEFAULT_WEAPON_FINAL_WINDUP_MS,
  DEFAULT_WEAPON_FOLLOW_OFFSET_X,
  DEFAULT_WEAPON_FOLLOW_OFFSET_Y,
  DEFAULT_WEAPON_FRONT_OFFSET_X,
  DEFAULT_WEAPON_FRONT_OFFSET_Y,
  DEFAULT_WEAPON_GROUND_ROTATION_RAD,
  DEFAULT_WEAPON_HEIGHT,
  DEFAULT_WEAPON_MIN_ATTACK_INTERVAL_MS,
  DEFAULT_WEAPON_PICKUP_DISTANCE,
  DEFAULT_WEAPON_PLAYER_CLEARANCE,
  DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
  DEFAULT_WEAPON_WIDTH,
  MASK_WEAPON,
  PARRY_COUNTER_WINDOW_MS,
  PARRY_ENEMY_POSTURE_DAMAGE,
  PARRY_SELF_POSTURE_RECOVERY,
  WEAPON_DROP_DURATION_MS,
} from '../../constants'
import type { MainModule, WeaponVisualType, b2BodyId } from '../../types'
import { SOUND_IDS } from '../../worker/effectsProtocol'
import type {
  WeaponRelativeTransform,
  WeaponSlotData,
  WeaponSlotId,
  WeaponTransform,
} from '../Component'
import {
  ArrowComponent,
  Faction,
  PhysicsComponent,
  TransformComponent,
  WeaponComponent,
  WeaponSlotsComponent,
} from '../Component'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import type { SpatialHash } from '../SpatialHash'
import { System } from '../System'
import type { World } from '../World'
import type { StatsSystem } from './StatsSystem'

// 控制向前挥砍时的下压角度（0 为水平向前，正值顺时针向下）
const FRONT_SWING_TILT_RAD = Math.PI / 16
const BLOCK_VERTICAL_SCALE = 0.5
const REBOUND_PAUSE_MS = 150
const PARRY_WINDOW_FRAMES =
  (DEFAULT_PARRY_WINDOW_MS * DEFAULT_FRAME_RATE) / 1000
const PARRY_ACTIVE_START_FRAME = PARRY_WINDOW_FRAMES * 0.5
const BOW_MAX_DRAW_MS = 900
const BOW_MIN_WINDUP_MS = 200
const BOW_MIN_FORCE_RATIO = 0.6
const BOW_MIN_SPEED = 10
const BOW_MAX_SPEED = 22
const BOW_RECOVER_MS = 360
const BOW_GRAVITY_SCALE = 0.5
const BOW_FREE_AIM_TURN_SPEED = 1.6
const BOW_FREE_AIM_MAX_OFFSET = Math.PI * 0.45

type ObstacleCollider = {
  bodyId: b2BodyId
  width: number
  height: number
  vertices?: { x: number; y: number }[]
  radius?: number
}

type WeaponDropData = {
  weaponType: WeaponVisualType
  width: number
  height: number
  baseWidth: number
  cornerRadius: number
  weight: number
  attackDamage: number
  postureDamage: number
  toughnessDamage: number
}

export class WeaponSystem extends System {
  private box2d?: MainModule
  private obstacles: ObstacleCollider[] = []
  private statsSystem?: StatsSystem
  private allEntities: Entity[] = []
  private spatialHash: SpatialHash | null = null
  private entityLookup?: (id: number) => Entity | undefined
  private tempVec?: InstanceType<MainModule['b2Vec2']>
  private world?: World
  private worldId?: ReturnType<MainModule['b2CreateWorld']>
  private groundTopY = 0
  private viewportWidth = 16
  private viewportHeight = 9

  private tempTransform: WeaponTransform = { x: 0, y: 0, rotation: 0 }
  private tempRelativeTransform: WeaponRelativeTransform = {
    dx: 0,
    dy: 0,
    rotation: 0,
  }
  private tempWeaponDropData: WeaponDropData = {
    weaponType: 'sword',
    width: 0,
    height: 0,
    baseWidth: 0,
    cornerRadius: 0,
    weight: 0,
    attackDamage: 0,
    postureDamage: 0,
    toughnessDamage: 0,
  }
  private tempPlayerPos = { x: 0, y: 0 }
  private tempHitSource = { x: 0, y: 0 }
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

  setWorld(
    world: World,
    worldId: ReturnType<MainModule['b2CreateWorld']>,
    groundTopY: number
  ): void {
    this.world = world
    this.worldId = worldId
    this.groundTopY = groundTopY
  }

  setViewportSize(viewportWidth: number, viewportHeight: number): void {
    this.viewportWidth = viewportWidth
    this.viewportHeight = viewportHeight
  }

  update(entities: Entity[], deltaTime: number): void {
    // Apply debug slowdown to weapon animations
    const scaledDeltaTime = deltaTime / DEBUG_ANIMATION_SLOWDOWN
    this.currentDeltaTime = scaledDeltaTime
    const deltaMs = Math.max(0, scaledDeltaTime * 1000)

    for (const entity of entities) {
      if (!entity.transform || !entity.weapon) continue
      if (entity.arrow) continue
      entity.weapon.isColliding = false

      // 更新掉落中的武器（独立武器实体且有物理组件）
      if (
        !entity.stats &&
        entity.physics &&
        entity.weapon &&
        entity.transform
      ) {
        this.updateDroppingWeapon(entity)
        continue
      }

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

  setEntityLookup(entityLookup: (id: number) => Entity | undefined): void {
    this.entityLookup = entityLookup
  }

  private updateWeapon(entity: Entity, deltaMs: number): void {
    if (!entity.transform || !entity.weapon) return

    const weapon = entity.weapon
    if (
      weapon.attackPhase !== 'block' &&
      weapon.attackPhase !== 'blockReturn' &&
      weapon.width !== weapon.baseWidth
    ) {
      weapon.width = weapon.baseWidth
    }
    if (weapon.parryCounterTimerMs > 0) {
      weapon.parryCounterTimerMs = Math.max(
        0,
        weapon.parryCounterTimerMs - deltaMs
      )
    }
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
      if (
        weapon.weaponType === 'bow' &&
        entity.stats &&
        !entity.stats.isInCombat
      ) {
        this.applyOffset(weapon.dropEndOffset, playerPos, weapon.visual)
        return
      }
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

    if (weapon.weaponType === 'bow' && entity.stats) {
      this.updateBowWeapon(entity, weapon, playerPos, inputFacing, deltaMs)
      return
    }

    const now = Date.now()
    const attackRadius = weapon.attackRadius || this.getAttackRadius(entity)
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

    if (weapon.attackPhase === 'idle') {
      if (entity.input && entity.input.blockRequested && !entity.isStunned()) {
        this.startBlock(entity, playerPos, inputFacing)
        return
      }

      // 检查是否有缓冲的攻击指令
      if (entity.input && !entity.isStunned()) {
        entity.input.inputBuffer.tryExecute(
          'attack',
          () => !entity.isStunned(),
          () => this.startAttack(entity)
        )
      }

      this.handleIdlePhase(entity, playerPos, attackRadius, attackFacing, now)
      return
    }

    if (weapon.attackPhase === 'block') {
      this.handleBlockPhase(entity, playerPos, inputFacing)
      return
    }

    if (weapon.attackPhase === 'blockReturn') {
      this.handleBlockReturnPhase(entity, playerPos, inputFacing)
      return
    }

    if (weapon.attackPhase === 'windup' && entity.movement?.isRolling) {
      this.resetWeaponToCombatIdle(entity, playerPos, inputFacing)
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
      this.handleReboundPhase(entity, weapon, playerPos, now)
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

  private startBlock(
    entity: Entity,
    playerPos: { x: number; y: number },
    facing: number
  ): void {
    if (!entity.weapon) return
    const weapon = entity.weapon

    weapon.attackPhase = 'block'
    weapon.parryElapsedTime = 0
    weapon.isParrying = true
    weapon.isBlocking = true
    if (this.statsSystem) {
      this.statsSystem.enterCombat(entity)
    }
    weapon.parryHitWeaponIds.clear()
    weapon.blockWidthStart = weapon.width
    weapon.blockWidthTarget = weapon.baseWidth * BLOCK_VERTICAL_SCALE

    // 初始化弹反起始和目标位置
    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    const blockRotation = -Math.PI / 2
    this.getOffsetFromTransform(
      weapon.visual,
      playerPos,
      weapon.parryStartOffset
    )
    weapon.parryEndOffset.dx = facing * (radius + 0.2)
    weapon.parryEndOffset.dy = 0
    weapon.parryEndOffset.rotation = blockRotation

    weapon.parryStartTransform.x = weapon.visual.x
    weapon.parryStartTransform.y = weapon.visual.y
    weapon.parryStartTransform.rotation = weapon.visual.rotation

    weapon.parryEndTransform.x = playerPos.x + facing * (radius + 0.2)
    weapon.parryEndTransform.y = playerPos.y
    weapon.parryEndTransform.rotation = blockRotation
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
      weapon.width = weapon.baseWidth
      return
    }

    // 弹反窗口结束后，松开格挡键才能退出
    if (!weapon.isParrying && entity.input && !entity.input.blockRequested) {
      this.startBlockReturn(entity, weapon, playerPos)
      return
    }

    weapon.isBlocking = true
    if (this.statsSystem) {
      this.statsSystem.enterCombat(entity)
    }
    weapon.lastAttackTimestamp = Date.now()

    // 每一帧都根据当前朝向更新目标位置，确保武器跟随转向
    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    const blockRotation = -Math.PI / 2
    weapon.parryEndOffset.dx = facing * (radius + 0.2)
    weapon.parryEndOffset.dy = 0
    weapon.parryEndOffset.rotation = blockRotation

    // 弹反窗口期间（只在武器移动期间有效）
    if (weapon.isParrying) {
      weapon.parryElapsedTime += this.currentDeltaTime * DEFAULT_FRAME_RATE
      const progress = Math.min(
        1,
        weapon.parryElapsedTime / PARRY_WINDOW_FRAMES
      )
      weapon.width =
        weapon.blockWidthStart +
        (weapon.blockWidthTarget - weapon.blockWidthStart) * progress

      // 插值相对位置并应用
      this.lerpRelativeTransform(
        weapon.parryStartOffset,
        weapon.parryEndOffset,
        progress,
        this.tempRelativeTransform
      )
      this.applyOffset(this.tempRelativeTransform, playerPos, weapon.visual)

      // 弹反窗口内检测敌人武器碰撞（仅后半段有效帧）
      if (weapon.parryElapsedTime >= PARRY_ACTIVE_START_FRAME) {
        this.checkParryHits(entity)
      }

      // 弹反窗口结束
      if (weapon.parryElapsedTime >= PARRY_WINDOW_FRAMES) {
        weapon.isParrying = false
        // 如果弹反窗口结束时格挡键已松开，自动退出
        if (entity.input && !entity.input.blockRequested) {
          this.startBlockReturn(entity, weapon, playerPos)
          return
        }
      }
    } else {
      // 弹反窗口结束后，保持格挡姿态（相对于角色）
      this.applyOffset(weapon.parryEndOffset, playerPos, weapon.visual)
      weapon.width = weapon.blockWidthTarget
    }
  }

  private startBlockReturn(
    entity: Entity,
    weapon: Entity['weapon'],
    playerPos: { x: number; y: number }
  ): void {
    if (!weapon) return
    weapon.attackPhase = 'blockReturn'
    weapon.isBlocking = false
    weapon.isParrying = false
    weapon.parryElapsedTime = 0 // 使用 parryElapsedTime 作为计时器（帧）
    weapon.blockWidthStart = weapon.width
    weapon.blockWidthTarget = weapon.baseWidth

    // 记录当前位置作为回归动画的起点 (存入 parryEndOffset)
    this.getOffsetFromTransform(weapon.visual, playerPos, weapon.parryEndOffset)

    // 计算 idle 状态的目标位置 (存入 parryStartOffset)
    // 注意：我们需要根据当前朝向计算 idle 位置
    const facing =
      entity.input && entity.input.lastMoveDirection !== 0
        ? entity.input.lastMoveDirection
        : weapon.attackFacing
    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS

    // 复用 getFrontTransform 计算目标 offset (战斗姿态)
    this.getFrontTransform(
      playerPos,
      facing,
      this.tempTransform,
      radius,
      weapon.weaponType,
      weapon.width
    )
    this.getOffsetFromTransform(
      this.tempTransform,
      playerPos,
      weapon.parryStartOffset
    )
  }

  private handleBlockReturnPhase(
    entity: Entity,
    playerPos: { x: number; y: number },
    facing: number
  ): void {
    if (!entity.weapon) return
    const weapon = entity.weapon

    // Remove interrupt check: allow full return animation

    weapon.parryElapsedTime += this.currentDeltaTime * DEFAULT_FRAME_RATE
    // 动画时间比发起格挡快一倍 (200ms -> 100ms)
    const durationFrames = PARRY_WINDOW_FRAMES / 2
    const progress = Math.min(1, weapon.parryElapsedTime / durationFrames)
    weapon.width =
      weapon.blockWidthStart +
      (weapon.blockWidthTarget - weapon.blockWidthStart) * progress

    // 插值相对位置并应用 (从 parryEndOffset 回到 parryStartOffset)
    this.lerpRelativeTransform(
      weapon.parryEndOffset, // Start (recorded current)
      weapon.parryStartOffset, // End (idle)
      progress,
      this.tempRelativeTransform
    )
    this.applyOffset(this.tempRelativeTransform, playerPos, weapon.visual)

    // 在撤回过程中不再检测弹反碰撞，确保无弹反/防御效果

    if (progress >= 1) {
      weapon.attackPhase = 'idle'
      weapon.parryElapsedTime = 0
      weapon.width = weapon.baseWidth
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
        const sparkX = (weaponX + attackerX) * 0.5
        const sparkY = (weaponY + attackerY) * 0.5
        this.statsSystem?.emitSpark(sparkX, sparkY)
        this.statsSystem?.playSound(SOUND_IDS.SWORD_PARRY)
        this.applyParryEffect(defender, attacker)
      }
    }
  }

  private applyParryEffect(defender: Entity, attacker: Entity): void {
    if (!this.statsSystem) return

    if (defender.weapon) {
      defender.weapon.parryCounterTimerMs = PARRY_COUNTER_WINDOW_MS
      defender.weapon.parryCounterActive = false
    }
    const result = this.statsSystem.applyParryDamage(defender, attacker)

    if (result.attackerStaggered) {
      // 触发攻击者武器回弹效果
      // 具体的崩塌状态和武器掉落由 StatsSystem 统一处理
      if (attacker.weapon && attacker.transform) {
        this.tempPlayerPos.x = attacker.transform.x
        this.tempPlayerPos.y = attacker.transform.y
        this.startRebound(attacker, this.tempPlayerPos, Date.now())
      }
    } else {
      // 普通弹反
      if (
        attacker.weapon &&
        !attacker.weapon.isUnstoppable &&
        attacker.transform
      ) {
        // 非霸体攻击：仅触发回弹，无硬直
        this.tempPlayerPos.x = attacker.transform.x
        this.tempPlayerPos.y = attacker.transform.y
        this.startRebound(attacker, this.tempPlayerPos, Date.now())
      }

      // 将防御者加入已击中列表，从而避免产生伤害（无论是霸体还是回弹，都要避免当次伤害）
      if (attacker.weapon) {
        attacker.weapon.hitEntityIds.add(defender.id)
      }
    }
  }

  private startWeaponRecover(entity: Entity): void {
    if (!entity.weapon || !entity.transform) return

    const weapon = entity.weapon
    weapon.isRecovering = true
    weapon.dropElapsedTime = 0

    this.tempPlayerPos.x = entity.transform.x
    this.tempPlayerPos.y = entity.transform.y
    const playerPos = this.tempPlayerPos

    // 计算起始相对偏移（当前武器位置相对于玩家）
    this.getOffsetFromTransform(
      weapon.visual,
      playerPos,
      weapon.dropStartOffset
    )

    // 计算目标相对偏移（回到角色身侧）
    const facing =
      entity.input && entity.input.lastMoveDirection !== 0
        ? entity.input.lastMoveDirection
        : weapon.attackFacing || 1
    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    if (weapon.weaponType === 'bow') {
      this.getFrontTransform(
        playerPos,
        facing,
        this.tempTransform,
        radius,
        weapon.weaponType,
        weapon.width
      )
      this.getOffsetFromTransform(
        this.tempTransform,
        playerPos,
        weapon.dropEndOffset
      )
    } else {
      weapon.dropEndOffset.dx = -facing * (radius + 0.2)
      weapon.dropEndOffset.dy = radius * -0.2
      weapon.dropEndOffset.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
    }
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
    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS

    if (entity.stats?.isInCombat) {
      this.getFrontTransform(
        playerPos,
        facing,
        weapon.visual,
        radius,
        weapon.weaponType,
        weapon.width
      )
    } else {
      this.getBackTransform(
        playerPos,
        facing,
        weapon.visual,
        radius,
        weapon.weaponType
      )
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

      if (this.statsSystem) {
        this.statsSystem.enterCombat(entity)
      }
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
    const baseWindupDuration = isGrounded
      ? DEFAULT_WEAPON_ATTACK_WINDUP_MS
      : 250
    const windupDuration = weapon.parryCounterActive
      ? baseWindupDuration / 2
      : baseWindupDuration

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

    if (entity.input && entity.input.blockRequested && !entity.isStunned()) {
      const facing =
        entity.input.lastMoveDirection !== 0
          ? entity.input.lastMoveDirection
          : weapon.attackFacing
      this.interruptWindupToBlock(entity, this.tempPlayerPos, facing)
      return
    }

    if (t >= 1) {
      weapon.parryCounterActive = false
      this.statsSystem?.playSound(SOUND_IDS.SWORD_SWING_NORMAL)
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

    const finalWindupDuration = weapon.parryCounterActive
      ? DEFAULT_WEAPON_FINAL_WINDUP_MS / 2
      : DEFAULT_WEAPON_FINAL_WINDUP_MS
    const t = this.clamp01(weapon.attackElapsedMs / finalWindupDuration)

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
      weapon.parryCounterActive = false
      this.statsSystem?.playSound(SOUND_IDS.SWORD_SWING_FINAL)
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
      this.statsSystem?.playSound(SOUND_IDS.SWORD_HIT_OBSTACLE)
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

    // Allow interrupting pause/recovery with block
    if (entity.input && entity.input.blockRequested && !entity.isStunned()) {
      this.interruptWindupToBlock(entity, playerPos, currentFacing)
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

      this.statsSystem?.playSound(SOUND_IDS.SWORD_SWING_NORMAL)
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
    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    const targetOffset = this.tempRelativeTransform // Reuse temp as target container temporarily?
    // Actually, lerpRelativeTransform writes to 'out'. I need 'to' argument.
    // I can construct a literal object or use another component field.
    // Let's use weapon.swingEndOffset as a temporary holder since it's not used in recover.
    weapon.swingEndOffset.dx = facing * 0
    weapon.swingEndOffset.dy = radius * -0.2
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

  private resetAttackStateForInterrupt(weapon: Entity['weapon']): void {
    if (!weapon) return
    weapon.attackElapsedMs = 0
    weapon.attackQueued = false
    weapon.comboCount = 0
    weapon.swingDirection = 'toFront'
    weapon.nextSwingDirection = 'toFront'
    weapon.reboundLockedPause = false
    weapon.parryCounterActive = false
    weapon.hitEntityIds.clear()
  }

  private resetWeaponToCombatIdle(
    entity: Entity,
    playerPos: { x: number; y: number },
    facing: number
  ): void {
    if (!entity.weapon) return
    const weapon = entity.weapon
    this.resetAttackStateForInterrupt(weapon)
    weapon.attackPhase = 'idle'
    weapon.attackFacing = facing
    weapon.isBlocking = false
    weapon.isParrying = false
    weapon.parryElapsedTime = 0
    weapon.parryHitWeaponIds.clear()
    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    this.getFrontTransform(
      playerPos,
      facing,
      weapon.visual,
      radius,
      weapon.weaponType,
      weapon.width
    )
  }

  private interruptWindupToBlock(
    entity: Entity,
    playerPos: { x: number; y: number },
    facing: number
  ): void {
    if (!entity.weapon) return
    const weapon = entity.weapon
    this.resetAttackStateForInterrupt(weapon)
    weapon.attackFacing = facing
    this.startBlock(entity, playerPos, facing)
  }

  private dropWeapon(
    x: number,
    y: number,
    facing: number,
    weaponData: WeaponDropData
  ): void {
    if (!this.world || !this.box2d || !this.worldId) return

    const entity = this.world.createEntity()

    const transform = new TransformComponent()
    transform.x = x
    transform.y = y
    entity.addComponent(transform)

    // 创建物理组件用于掉落动画
    const physics = new PhysicsComponent()
    const {
      b2DefaultBodyDef,
      b2CreateBody,
      b2BodyType,
      b2Circle,
      b2DefaultShapeDef,
      b2CreateCircleShape,
      b2Vec2,
    } = this.box2d

    const bodyDef = b2DefaultBodyDef()
    bodyDef.type = b2BodyType.b2_dynamicBody
    bodyDef.position.Set(x, y)
    bodyDef.linearDamping = 2.0 // 较高的阻尼，快速减速
    bodyDef.motionLocks.angularZ = true // 锁定旋转
    physics.bodyId = b2CreateBody(this.worldId, bodyDef)

    // 使用圆形碰撞体，半径基于武器高度
    const weaponRadius = weaponData.height * 0.5
    const circle = new b2Circle()
    circle.center.Set(0, 0)
    circle.radius = weaponRadius
    const shapeDef = b2DefaultShapeDef()
    shapeDef.density = 0.5
    shapeDef.material.friction = 0.3
    shapeDef.material.restitution = 0.2 // 轻微弹跳
    shapeDef.filter.categoryBits = CATEGORY_WEAPON
    shapeDef.filter.maskBits = MASK_WEAPON
    physics.shapeId = b2CreateCircleShape(physics.bodyId, shapeDef, circle)

    // 施加初始速度：向玩家面朝的前方抛出，同时向上
    const throwSpeedX = facing * 8.0 // 向前抛
    const throwSpeedY = -6.0 // 向上抛
    const throwVelocity = new b2Vec2(throwSpeedX, throwSpeedY)
    this.box2d.b2Body_SetLinearVelocity(physics.bodyId, throwVelocity)

    bodyDef.delete()
    circle.delete()
    shapeDef.delete()
    throwVelocity.delete()

    entity.addComponent(physics)

    const weapon = new WeaponComponent()
    weapon.width = weaponData.width
    weapon.height = weaponData.height
    weapon.baseWidth = weaponData.baseWidth
    weapon.blockWidthStart = weaponData.width
    weapon.blockWidthTarget = weaponData.width
    weapon.cornerRadius = weaponData.cornerRadius
    weapon.weight = weaponData.weight
    weapon.weaponType = weaponData.weaponType
    weapon.attackDamage = weaponData.attackDamage
    weapon.postureDamage = weaponData.postureDamage
    weapon.toughnessDamage = weaponData.toughnessDamage

    const weaponY = this.groundTopY - weapon.height / 2
    weapon.position = { x, y: weaponY }
    weapon.rotation = DEFAULT_WEAPON_GROUND_ROTATION_RAD
    weapon.isEquipped = false
    weapon.attackPhase = 'idle'
    weapon.visual = {
      x,
      y: weaponY,
      rotation: DEFAULT_WEAPON_GROUND_ROTATION_RAD,
    }
    weapon.attackStartTransform = {
      x,
      y: weaponY,
      rotation: DEFAULT_WEAPON_GROUND_ROTATION_RAD,
    }
    weapon.swingStartTransform = {
      x,
      y: weaponY,
      rotation: DEFAULT_WEAPON_GROUND_ROTATION_RAD,
    }
    weapon.swingEndTransform = {
      x,
      y: weaponY,
      rotation: DEFAULT_WEAPON_GROUND_ROTATION_RAD,
    }
    weapon.attackStartOffset = {
      dx: 0,
      dy: 0,
      rotation: DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
    }
    weapon.swingStartOffset = {
      dx: 0,
      dy: 0,
      rotation: DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
    }
    weapon.swingEndOffset = {
      dx: 0,
      dy: 0,
      rotation: DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
    }
    weapon.attackRadius = DEFAULT_WEAPON_ATTACK_RADIUS
    weapon.pickupCooldownEndTime = performance.now() + 500 // 500ms 冷却时间

    entity.addComponent(weapon)
  }

  private updateDroppingWeapon(entity: Entity): void {
    if (!entity.physics || !entity.transform || !entity.weapon || !this.box2d)
      return

    const { b2Body_GetPosition, b2Body_GetLinearVelocity, b2DestroyBody } =
      this.box2d

    // 同步物理位置到 transform
    const bodyPos = b2Body_GetPosition(entity.physics.bodyId)
    entity.transform.x = bodyPos.x
    entity.transform.y = bodyPos.y

    // 更新武器视觉位置
    entity.weapon.visual.x = bodyPos.x
    entity.weapon.visual.y = bodyPos.y

    // 检查速度是否接近 0（已落地）
    const velocity = b2Body_GetLinearVelocity(entity.physics.bodyId)
    const speed = Math.hypot(velocity.x, velocity.y)

    if (speed < 0.5) {
      // 速度很小，认为已经落地
      // 保留物理体最后的位置作为武器的最终位置
      const finalX = bodyPos.x
      const finalY = bodyPos.y

      // 销毁物理体
      b2DestroyBody(entity.physics.bodyId)
      entity.removeComponent('Physics')

      // 使用物理体最后的实际位置，而不是重新计算
      entity.weapon.position.x = finalX
      entity.weapon.position.y = finalY
      entity.weapon.visual.x = finalX
      entity.weapon.visual.y = finalY
    }
  }

  private updateBowWeapon(
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
      return
    }

    const holdingAttack = entity.input.attackRequested && !entity.isStunned()
    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    if (entity.input.freeAimToggleRequested) {
      entity.input.freeAimToggleRequested = false
      weapon.bowFreeAim = !weapon.bowFreeAim
      if (weapon.bowFreeAim) {
        const defaultAngle = weapon.bowHasAim
          ? weapon.bowAimAngle
          : facing === 1
            ? 0
            : Math.PI
        weapon.bowFreeAimAngle = defaultAngle
        weapon.bowFreeAimReticleX = 0
        weapon.bowFreeAimReticleY = 0
        entity.input.lockedTargetId = null
        entity.input.lockLostTimer = 0
      } else {
        entity.input.lockedTargetId = null
        entity.input.lockLostTimer = 0
        entity.input.facingOverride = null
        weapon.bowFreeAimReticleX = 0
        weapon.bowFreeAimReticleY = 0
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
      let reticleAngle = weapon.bowFreeAimAngle
      let reticleX = 0
      let reticleY = 0
      if (useMouseAim) {
        reticleX = entity.input.mouseAimX
        reticleY = entity.input.mouseAimY
        reticleAngle = Math.atan2(
          reticleY - playerPos.y,
          reticleX - playerPos.x
        )
        weapon.bowFreeAimAngle = reticleAngle
      } else {
        const adjust =
          entity.input.freeAimAdjust * (weapon.attackFacing >= 0 ? 1 : -1)
        if (adjust !== 0) {
          weapon.bowFreeAimAngle +=
            adjust * BOW_FREE_AIM_TURN_SPEED * (deltaMs / 1000)
        }
        const centerAngle = facing === 1 ? 0 : Math.PI
        const minAngle = centerAngle - BOW_FREE_AIM_MAX_OFFSET
        const maxAngle = centerAngle + BOW_FREE_AIM_MAX_OFFSET
        if (weapon.bowFreeAimAngle < minAngle) {
          weapon.bowFreeAimAngle = minAngle
        } else if (weapon.bowFreeAimAngle > maxAngle) {
          weapon.bowFreeAimAngle = maxAngle
        }

        const reticleRange =
          Math.max(this.viewportWidth, this.viewportHeight) * 0.5
        reticleAngle = weapon.bowFreeAimAngle
        reticleX = playerPos.x + Math.cos(reticleAngle) * reticleRange
        reticleY = playerPos.y + Math.sin(reticleAngle) * reticleRange
      }
      weapon.bowFreeAimReticleX = reticleX
      weapon.bowFreeAimReticleY = reticleY
      entity.input.facingOverride = Math.cos(reticleAngle) >= 0 ? 1 : -1

      const minForceRatio = Math.max(
        BOW_MIN_FORCE_RATIO,
        Math.min(1, BOW_MIN_WINDUP_MS / BOW_MAX_DRAW_MS)
      )
      const drawRatio = Math.max(weapon.bowDrawRatio, minForceRatio)
      const freeAimAngle = this.getBowAimAngleForPosition(
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
      weapon.visual.rotation = freeAimAngle + Math.PI / 2
      weapon.attackFacing = Math.cos(freeAimAngle) >= 0 ? 1 : -1
    } else if (hasAimLock && aimAngle !== null) {
      weapon.bowAimAngle = aimAngle
      weapon.bowHasAim = true
      weapon.bowFreeAimReticleX = 0
      weapon.bowFreeAimReticleY = 0
      const offset = radius + 0.2
      weapon.visual.x = playerPos.x + Math.cos(aimAngle) * offset
      weapon.visual.y = playerPos.y + Math.sin(aimAngle) * offset
      weapon.visual.rotation = aimAngle + Math.PI / 2
      weapon.attackFacing = Math.cos(aimAngle) >= 0 ? 1 : -1
    } else if (inCombat) {
      weapon.bowHasAim = false
      weapon.bowFreeAimReticleX = 0
      weapon.bowFreeAimReticleY = 0
      this.getFrontTransform(
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
      this.getBackTransform(
        playerPos,
        facing,
        weapon.visual,
        radius,
        weapon.weaponType
      )
    }

    if (weapon.bowRecoverElapsedMs > 0) {
      weapon.bowRecoverElapsedMs += deltaMs
      const recoverRatio = Math.min(
        1,
        weapon.bowRecoverElapsedMs / BOW_RECOVER_MS
      )
      weapon.bowDrawRatio = Math.max(
        0,
        weapon.bowReleaseRatio * (1 - recoverRatio)
      )
      if (weapon.bowRecoverElapsedMs >= BOW_RECOVER_MS) {
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
      const minForceRatio = Math.max(
        BOW_MIN_FORCE_RATIO,
        Math.min(1, BOW_MIN_WINDUP_MS / BOW_MAX_DRAW_MS)
      )
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
      const minForceRatio = Math.max(
        BOW_MIN_FORCE_RATIO,
        Math.min(1, BOW_MIN_WINDUP_MS / BOW_MAX_DRAW_MS)
      )
      weapon.bowForceRatio = drawRatio

      if (weapon.bowDrawElapsedMs < BOW_MIN_WINDUP_MS) {
        weapon.bowReleasePending = true
        weapon.bowReleaseDelayMs = BOW_MIN_WINDUP_MS - weapon.bowDrawElapsedMs
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

  private fireBowArrow(
    entity: Entity,
    weapon: WeaponComponent,
    facing: number,
    drawRatio: number
  ): void {
    if (!this.world || !this.box2d || !this.worldId) return

    const arrowEntity = this.world.createEntity()
    const arrowTransform = new TransformComponent()

    arrowTransform.x = weapon.visual.x
    arrowTransform.y = weapon.visual.y
    arrowEntity.addComponent(arrowTransform)

    const physics = new PhysicsComponent()
    const {
      b2DefaultBodyDef,
      b2CreateBody,
      b2BodyType,
      b2Circle,
      b2DefaultShapeDef,
      b2CreateCircleShape,
      b2Vec2,
    } = this.box2d

    const bodyDef = b2DefaultBodyDef()
    bodyDef.type = b2BodyType.b2_dynamicBody
    bodyDef.position.Set(arrowTransform.x, arrowTransform.y)
    bodyDef.linearDamping = 0.05
    bodyDef.motionLocks.angularZ = true
    bodyDef.isBullet = true
    bodyDef.gravityScale = BOW_GRAVITY_SCALE
    physics.bodyId = b2CreateBody(this.worldId, bodyDef)

    const arrowWeapon = new WeaponComponent()
    const arrowLength = DEFAULT_WEAPON_WIDTH * 0.9
    const arrowThickness = DEFAULT_WEAPON_HEIGHT * 0.15
    const arrowSpeed = this.getBowLaunchSpeed(drawRatio)
    const minForceRatio = Math.max(
      BOW_MIN_FORCE_RATIO,
      Math.min(1, BOW_MIN_WINDUP_MS / BOW_MAX_DRAW_MS)
    )
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

    const circle = new b2Circle()
    circle.center.Set(0, 0)
    circle.radius = Math.max(0.08, arrowThickness)
    const shapeDef = b2DefaultShapeDef()
    shapeDef.density = 0.1
    shapeDef.material.friction = 0.2
    shapeDef.material.restitution = 0.4
    shapeDef.filter.categoryBits = CATEGORY_WEAPON
    shapeDef.filter.maskBits = MASK_WEAPON
    physics.shapeId = b2CreateCircleShape(physics.bodyId, shapeDef, circle)

    const launchSpeed = arrowSpeed * 1.5
    const initialVelocity = new b2Vec2(
      Math.cos(aimAngle) * launchSpeed,
      Math.sin(aimAngle) * launchSpeed
    )
    this.box2d.b2Body_SetLinearVelocity(physics.bodyId, initialVelocity)

    bodyDef.delete()
    circle.delete()
    shapeDef.delete()
    initialVelocity.delete()

    arrowEntity.addComponent(physics)

    arrowWeapon.width = arrowLength
    arrowWeapon.height = arrowThickness
    arrowWeapon.baseWidth = arrowLength
    arrowWeapon.blockWidthStart = arrowLength
    arrowWeapon.blockWidthTarget = arrowLength
    arrowWeapon.cornerRadius = 0
    arrowWeapon.weight = 0
    arrowWeapon.weaponType = 'arrow'
    const baseAttackDamage = weapon.attackDamage * forceMultiplier
    const basePostureDamage = weapon.postureDamage * forceMultiplier
    const baseToughnessDamage = weapon.toughnessDamage * forceMultiplier
    const baseKnockback = weapon.knockback * forceMultiplier
    arrowWeapon.attackDamage = baseAttackDamage
    arrowWeapon.postureDamage = basePostureDamage
    arrowWeapon.toughnessDamage = baseToughnessDamage
    arrowWeapon.knockback = baseKnockback
    arrowWeapon.isEquipped = false
    arrowWeapon.attackPhase = 'idle'
    arrowWeapon.visual.x = arrowTransform.x
    arrowWeapon.visual.y = arrowTransform.y
    arrowWeapon.visual.rotation = arrowRotation
    arrowEntity.addComponent(arrowWeapon)

    const arrow = new ArrowComponent()
    arrow.ownerId = entity.id
    arrow.faction = entity.faction?.faction ?? Faction.Player
    arrow.velocityX = Math.cos(aimAngle) * launchSpeed
    arrow.velocityY = Math.sin(aimAngle) * launchSpeed
    arrow.hitRadius = 0.12
    arrow.elapsedMs = 0
    arrow.lifetimeMs = 2500
    arrowEntity.addComponent(arrow)

    this.statsSystem?.playSound(SOUND_IDS.BOW_SNAP)
  }

  private getBowLaunchSpeed(drawRatio: number): number {
    const clamped = Math.max(0, Math.min(1, drawRatio))
    return BOW_MIN_SPEED + (BOW_MAX_SPEED - BOW_MIN_SPEED) * clamped
  }

  private getBowAimAngleForTarget(
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

    const minForceRatio = Math.max(
      BOW_MIN_FORCE_RATIO,
      Math.min(1, BOW_MIN_WINDUP_MS / BOW_MAX_DRAW_MS)
    )
    const drawRatio = Math.max(weapon.bowDrawRatio, minForceRatio)
    return this.getBowAimAngleForPosition(
      playerPos,
      radius,
      target.transform.x,
      target.transform.y,
      drawRatio
    )
  }

  private getBowAimAngleForPosition(
    playerPos: { x: number; y: number },
    radius: number,
    targetX: number,
    targetY: number,
    drawRatio: number
  ): number {
    const speed = this.getBowLaunchSpeed(drawRatio) * 1.5
    const offset = radius + 0.2
    let aimAngle = this.getBowAimAngle(
      playerPos.x,
      playerPos.y,
      targetX,
      targetY,
      speed
    )

    const originX = playerPos.x + Math.cos(aimAngle) * offset
    const originY = playerPos.y + Math.sin(aimAngle) * offset
    aimAngle = this.getBowAimAngle(originX, originY, targetX, targetY, speed)

    return aimAngle
  }

  private getBowAimAngle(
    originX: number,
    originY: number,
    targetX: number,
    targetY: number,
    speed: number
  ): number {
    const dx = targetX - originX
    const dyUp = originY - targetY
    const dxAbs = Math.abs(dx)
    if (dxAbs < 0.001) {
      return dyUp >= 0 ? -Math.PI / 2 : Math.PI / 2
    }

    const g = DEFAULT_GRAVITY * BOW_GRAVITY_SCALE
    const v2 = speed * speed
    const disc = v2 * v2 - g * (g * dxAbs * dxAbs + 2 * dyUp * v2)
    if (disc < 0) {
      return -Math.atan2(dyUp, dx)
    }

    const sqrtDisc = Math.sqrt(disc)
    const tan = (v2 - sqrtDisc) / (g * dxAbs)
    let angle = Math.atan(tan)
    if (dx < 0) {
      angle = Math.PI - angle
    }
    return -angle
  }

  private getSlotForWeaponType(weaponType: WeaponVisualType): WeaponSlotId {
    return weaponType === 'bow' ? 'secondary' : 'main'
  }

  private getSlotData(
    weaponSlots: WeaponSlotsComponent,
    slotId: WeaponSlotId
  ): WeaponSlotData {
    return slotId === 'main' ? weaponSlots.main : weaponSlots.secondary
  }

  private copyWeaponToSlot(
    slot: WeaponSlotData,
    weapon: WeaponComponent
  ): void {
    slot.hasWeapon = true
    slot.weaponType = weapon.weaponType
    slot.width = weapon.baseWidth
    slot.height = weapon.height
    slot.baseWidth = weapon.baseWidth
    slot.cornerRadius = weapon.cornerRadius
    slot.weight = weapon.weight
    slot.attackDamage = weapon.attackDamage
    slot.postureDamage = weapon.postureDamage
    slot.toughnessDamage = weapon.toughnessDamage
  }

  private copySlotToWeapon(
    slot: WeaponSlotData,
    weapon: WeaponComponent
  ): void {
    weapon.width = slot.baseWidth
    weapon.height = slot.height
    weapon.baseWidth = slot.baseWidth
    weapon.blockWidthStart = weapon.baseWidth
    weapon.blockWidthTarget = weapon.baseWidth
    weapon.cornerRadius = slot.cornerRadius
    weapon.weight = slot.weight
    weapon.weaponType = slot.weaponType
    weapon.attackDamage = slot.attackDamage
    weapon.postureDamage = slot.postureDamage
    weapon.toughnessDamage = slot.toughnessDamage
  }

  private fillWeaponDropDataFromWeapon(
    weapon: WeaponComponent,
    out: WeaponDropData
  ): void {
    out.weaponType = weapon.weaponType
    out.width = weapon.baseWidth
    out.height = weapon.height
    out.baseWidth = weapon.baseWidth
    out.cornerRadius = weapon.cornerRadius
    out.weight = weapon.weight
    out.attackDamage = weapon.attackDamage
    out.postureDamage = weapon.postureDamage
    out.toughnessDamage = weapon.toughnessDamage
  }

  private fillWeaponDropDataFromSlot(
    slot: WeaponSlotData,
    out: WeaponDropData
  ): void {
    out.weaponType = slot.weaponType
    out.width = slot.baseWidth
    out.height = slot.height
    out.baseWidth = slot.baseWidth
    out.cornerRadius = slot.cornerRadius
    out.weight = slot.weight
    out.attackDamage = slot.attackDamage
    out.postureDamage = slot.postureDamage
    out.toughnessDamage = slot.toughnessDamage
  }

  private resetWeaponForSwap(weapon: WeaponComponent): void {
    weapon.attackPhase = 'idle'
    weapon.attackElapsedMs = 0
    weapon.lastAttackTimestamp = 0
    weapon.attackQueued = false
    weapon.comboCount = 0
    weapon.swingDirection = 'toFront'
    weapon.nextSwingDirection = 'toFront'
    weapon.attackRadius = DEFAULT_WEAPON_ATTACK_RADIUS
    weapon.isBlocking = false
    weapon.isParrying = false
    weapon.parryElapsedTime = 0
    weapon.parryCounterTimerMs = 0
    weapon.parryCounterActive = false
    weapon.reboundLockedPause = false
    weapon.isColliding = false
    weapon.hitEntityIds.clear()
    weapon.parryHitWeaponIds.clear()
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
  }

  tryPickUpWeapon(entity: Entity): void {
    if (!entity.transform || !entity.weapon) return
    if (entity.stats?.isDead) return
    const weaponSlots = entity.weaponSlots

    // 检查是否靠近独立的武器实体
    for (const weaponEntity of this.allEntities) {
      // 独立武器实体：有 weapon 组件但没有 stats 组件
      if (!weaponEntity.weapon || weaponEntity.stats) continue
      if (weaponEntity.arrow || weaponEntity.weapon.weaponType === 'arrow')
        continue
      if (weaponEntity.weapon.isEquipped) continue
      if (!weaponEntity.transform) continue

      const dx = entity.transform.x - weaponEntity.transform.x
      const dy = entity.transform.y - weaponEntity.transform.y
      const distance = Math.hypot(dx, dy)

      if (distance <= DEFAULT_WEAPON_PICKUP_DISTANCE) {
        // 检查拾取冷却时间
        if (weaponEntity.weapon.pickupCooldownEndTime > performance.now()) {
          continue // 还在冷却期内，跳过
        }

        if (weaponSlots) {
          const targetSlotId = this.getSlotForWeaponType(
            weaponEntity.weapon.weaponType
          )
          const targetSlot = this.getSlotData(weaponSlots, targetSlotId)

          if (!targetSlot.hasWeapon) {
            this.copyWeaponToSlot(targetSlot, weaponEntity.weapon)
            weaponEntity.weapon.isEquipped = true

            if (!entity.weapon.isEquipped) {
              weaponSlots.activeSlot = targetSlotId
            }

            if (weaponSlots.activeSlot === targetSlotId) {
              this.copySlotToWeapon(targetSlot, entity.weapon)
              entity.weapon.isEquipped = true
              entity.weapon.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
              entity.weapon.visual.rotation =
                DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
              this.resetWeaponForSwap(entity.weapon)
            }
            return
          }

          const interacted = entity.input?.inputBuffer.tryExecute(
            'interact',
            () => !entity.isStunned(),
            () => {}
          )

          if (!interacted) continue

          // 在玩家脚下掉落旧武器
          const facing = entity.weapon.attackFacing
          this.fillWeaponDropDataFromSlot(targetSlot, this.tempWeaponDropData)
          this.dropWeapon(
            entity.transform.x,
            entity.transform.y,
            facing,
            this.tempWeaponDropData
          )

          this.copyWeaponToSlot(targetSlot, weaponEntity.weapon)
          weaponEntity.weapon.isEquipped = true

          if (!entity.weapon.isEquipped) {
            weaponSlots.activeSlot = targetSlotId
          }

          if (weaponSlots.activeSlot === targetSlotId) {
            this.copySlotToWeapon(targetSlot, entity.weapon)
            entity.weapon.isEquipped = true
            entity.weapon.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
            entity.weapon.visual.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
            this.resetWeaponForSwap(entity.weapon)
          }
          return
        }

        // 如果玩家武器未装备，直接装备并应用属性
        if (!entity.weapon.isEquipped) {
          entity.weapon.width = weaponEntity.weapon.width
          entity.weapon.height = weaponEntity.weapon.height
          entity.weapon.baseWidth = weaponEntity.weapon.baseWidth
          entity.weapon.cornerRadius = weaponEntity.weapon.cornerRadius
          entity.weapon.weight = weaponEntity.weapon.weight
          entity.weapon.weaponType = weaponEntity.weapon.weaponType
          entity.weapon.attackDamage = weaponEntity.weapon.attackDamage
          entity.weapon.postureDamage = weaponEntity.weapon.postureDamage
          entity.weapon.toughnessDamage = weaponEntity.weapon.toughnessDamage
          entity.weapon.isEquipped = true
          entity.weapon.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
          entity.weapon.visual.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD

          // 标记武器实体为已拾取（会在后续清理）
          weaponEntity.weapon.isEquipped = true
          return
        }

        // 如果玩家已有武器，需要按 E 键（interact）才能替换
        if (entity.weapon.isEquipped) {
          const interacted = entity.input?.inputBuffer.tryExecute(
            'interact',
            () => !entity.isStunned(),
            () => {}
          )

          if (!interacted) continue

          // 在玩家脚下掉落旧武器
          const facing = entity.weapon.attackFacing
          this.fillWeaponDropDataFromWeapon(
            entity.weapon,
            this.tempWeaponDropData
          )
          this.dropWeapon(
            entity.transform.x,
            entity.transform.y,
            facing,
            this.tempWeaponDropData
          )

          // 替换为新武器属性
          entity.weapon.width = weaponEntity.weapon.width
          entity.weapon.height = weaponEntity.weapon.height
          entity.weapon.baseWidth = weaponEntity.weapon.baseWidth
          entity.weapon.cornerRadius = weaponEntity.weapon.cornerRadius
          entity.weapon.weight = weaponEntity.weapon.weight
          entity.weapon.weaponType = weaponEntity.weapon.weaponType
          entity.weapon.attackDamage = weaponEntity.weapon.attackDamage
          entity.weapon.postureDamage = weaponEntity.weapon.postureDamage
          entity.weapon.toughnessDamage = weaponEntity.weapon.toughnessDamage

          // 标记武器实体为已拾取（会在后续清理）
          weaponEntity.weapon.isEquipped = true
          return
        }
      }
    }

    // 检查玩家自己的默认武器是否未装备（用于初始拾取场景）
    if (!entity.weapon.isEquipped) {
      const dx = entity.transform.x - entity.weapon.position.x
      const dy = entity.transform.y - entity.weapon.position.y
      const distance = Math.hypot(dx, dy)

      if (distance <= DEFAULT_WEAPON_PICKUP_DISTANCE) {
        if (weaponSlots) {
          const targetSlotId = this.getSlotForWeaponType(
            entity.weapon.weaponType
          )
          const targetSlot = this.getSlotData(weaponSlots, targetSlotId)

          if (!targetSlot.hasWeapon) {
            this.copyWeaponToSlot(targetSlot, entity.weapon)
          }

          weaponSlots.activeSlot = targetSlotId
          this.copySlotToWeapon(targetSlot, entity.weapon)
        }

        entity.weapon.isEquipped = true
        entity.weapon.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
        entity.weapon.visual.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
        this.resetWeaponForSwap(entity.weapon)
      }
    }
  }

  dropWeaponsOnDeath(entity: Entity): void {
    if (!entity.transform) return

    const transform = entity.transform
    const weaponSlots = entity.weaponSlots
    const weapon = entity.weapon
    let facing =
      weapon?.attackFacing ??
      entity.input?.lastMoveDirection ??
      entity.enemyAI?.lastFacing ??
      1
    if (facing === 0) {
      facing = 1
    }

    const dropOffset = 0.35
    const dropFromSlot = (
      slot: WeaponSlotData,
      dropFacing: number,
      offsetX: number
    ) => {
      if (!slot.hasWeapon) return
      this.fillWeaponDropDataFromSlot(slot, this.tempWeaponDropData)
      this.dropWeapon(
        transform.x + offsetX,
        transform.y,
        dropFacing,
        this.tempWeaponDropData
      )
      slot.hasWeapon = false
    }

    if (
      weaponSlots &&
      (weaponSlots.main.hasWeapon || weaponSlots.secondary.hasWeapon)
    ) {
      const hasMain = weaponSlots.main.hasWeapon
      const hasSecondary = weaponSlots.secondary.hasWeapon
      if (hasMain && hasSecondary) {
        dropFromSlot(weaponSlots.main, facing, facing * dropOffset)
        dropFromSlot(weaponSlots.secondary, -facing, -facing * dropOffset)
      } else if (hasMain) {
        dropFromSlot(weaponSlots.main, facing, 0)
      } else {
        dropFromSlot(weaponSlots.secondary, facing, 0)
      }
      if (weapon) {
        weapon.isEquipped = false
      }
      return
    }

    if (weapon && weapon.isEquipped) {
      this.fillWeaponDropDataFromWeapon(weapon, this.tempWeaponDropData)
      this.dropWeapon(transform.x, transform.y, facing, this.tempWeaponDropData)
      weapon.isEquipped = false
    }
  }

  switchWeaponSlot(entity: Entity, slotId: WeaponSlotId): void {
    if (!entity.weapon || !entity.weaponSlots) return
    if (entity.stats?.isDead) return

    const weaponSlots = entity.weaponSlots
    if (weaponSlots.activeSlot === slotId) return

    const targetSlot = this.getSlotData(weaponSlots, slotId)
    if (!targetSlot.hasWeapon) return

    const currentSlot = this.getSlotData(weaponSlots, weaponSlots.activeSlot)
    this.copyWeaponToSlot(currentSlot, entity.weapon)

    weaponSlots.activeSlot = slotId
    this.copySlotToWeapon(targetSlot, entity.weapon)
    entity.weapon.isEquipped = true
    entity.weapon.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
    entity.weapon.visual.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
    this.resetWeaponForSwap(entity.weapon)
  }

  startAttack(entity: Entity): void {
    if (!entity.transform || !entity.input || !entity.weapon) return
    if (!entity.weapon.isEquipped) return
    if (entity.weapon.weaponType === 'bow') return
    if (entity.stats?.isDead) return
    if (entity.isStunned()) {
      entity.input.inputBuffer.clearAll()
      entity.input.inputBuffer.bufferAction('attack')
      return
    }

    const weapon = entity.weapon
    const now = Date.now()
    this.tempPlayerPos.x = entity.transform.x
    this.tempPlayerPos.y = entity.transform.y
    const playerPos = this.tempPlayerPos
    const facing =
      entity.input.lastMoveDirection !== 0 ? entity.input.lastMoveDirection : 1
    const attackRadius = this.getAttackRadius(entity)
    weapon.attackRadius = attackRadius
    weapon.attackFacing = facing

    if (weapon.comboCount >= 5) return

    if (weapon.parryCounterTimerMs > 0) {
      weapon.parryCounterActive = true
      weapon.parryCounterTimerMs = 0
    }

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
      if (this.statsSystem) {
        this.statsSystem.enterCombat(entity)
      }
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

  private getAttackRadius(entity: Entity): number {
    const weapon = entity.weapon
    if (!weapon) {
      return DEFAULT_WEAPON_ATTACK_RADIUS
    }
    const entityRadius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    return entityRadius + weapon.width / 2 + DEFAULT_WEAPON_PLAYER_CLEARANCE
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
    minimumElapsedMs: number,
    radius: number
  ): void {
    if (!weapon) return
    this.getFrontTransform(
      playerPos,
      facing,
      weapon.visual,
      radius,
      weapon.weaponType,
      weapon.width
    )
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
    out: WeaponTransform,
    radius: number,
    weaponType: WeaponVisualType
  ): void {
    out.x = playerPos.x - facing * (radius + 0.2)
    out.y = playerPos.y

    if (weaponType === 'bow') {
      out.rotation = facing === 1 ? -Math.PI / 2 : Math.PI / 2
      return
    }

    out.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
  }

  private getFrontTransform(
    playerPos: { x: number; y: number },
    facing: number,
    out: WeaponTransform,
    radius: number,
    weaponType: WeaponVisualType,
    weaponWidth: number
  ): void {
    if (weaponType === 'bow') {
      const offsetX = radius + 0.2
      out.x = playerPos.x + facing * offsetX
      out.y = playerPos.y
      out.rotation = facing === 1 ? Math.PI / 2 : -Math.PI / 2
      return
    }

    out.x = playerPos.x + facing * 0
    out.y = playerPos.y - DEFAULT_WEAPON_WIDTH / 2
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

    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    this.getFrontTransform(
      playerPos,
      newFacing,
      weapon.visual,
      radius,
      weapon.weaponType,
      weapon.width
    )
  }

  private resetWeaponState(entity: Entity): void {
    if (!entity.weapon) return

    const weapon = entity.weapon
    weapon.attackQueued = false
    if (this.statsSystem) {
      this.statsSystem.exitCombat(entity)
    }
    weapon.attackPhase = 'idle'
    weapon.attackElapsedMs = 0
    weapon.isColliding = false
    weapon.isBlocking = false
    weapon.isParrying = false
    weapon.parryElapsedTime = 0
    weapon.hitEntityIds.clear()
    weapon.width = weapon.baseWidth

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
    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    this.tempPlayerPos.x = entity.transform.x
    this.tempPlayerPos.y = entity.transform.y
    this.getBackTransform(
      this.tempPlayerPos,
      facing,
      weapon.visual,
      radius,
      weapon.weaponType
    )
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

      if (obstacle.vertices) {
        // Polygon (SAT)
        if (
          this.checkOBBvsPolygon(
            wx,
            wy,
            wWidth,
            wHeight,
            wRotation,
            pos.x,
            pos.y,
            obstacle.vertices
          )
        ) {
          pos.delete()
          return true
        }
      } else if (obstacle.radius !== undefined && obstacle.radius > 0) {
        // Circle
        if (
          this.checkOBBvsCircle(
            wx,
            wy,
            wWidth,
            wHeight,
            wRotation,
            pos.x,
            pos.y,
            obstacle.radius
          )
        ) {
          pos.delete()
          return true
        }
      } else {
        // AABB (Box optimization)
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
      }
      pos.delete()
    }

    return false
  }

  private checkOBBvsPolygon(
    wx: number,
    wy: number,
    ww: number,
    wh: number,
    wRot: number,
    polyX: number,
    polyY: number,
    vertices: { x: number; y: number }[]
  ): boolean {
    // 1. Construct OBB vertices in world space
    const cos = Math.cos(wRot)
    const sin = Math.sin(wRot)
    const hw = ww / 2
    const hh = wh / 2

    // Local OBB corners: (-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)
    // Rotated + Translated
    const obbVerts = [
      { x: wx + (cos * -hw - sin * -hh), y: wy + (sin * -hw + cos * -hh) },
      { x: wx + (cos * hw - sin * -hh), y: wy + (sin * hw + cos * -hh) },
      { x: wx + (cos * hw - sin * hh), y: wy + (sin * hw + cos * hh) },
      { x: wx + (cos * -hw - sin * hh), y: wy + (sin * -hw + cos * hh) },
    ]

    // 2. Construct Polygon vertices in world space
    const polyVerts = vertices.map((v) => ({
      x: polyX + v.x,
      y: polyY + v.y,
    }))

    // 3. Axes to test
    // a) OBB axes (2 normals)
    const axes = [
      { x: cos, y: sin },
      { x: -sin, y: cos },
    ]

    // b) Polygon axes (edge normals)
    for (let i = 0; i < polyVerts.length; i++) {
      const p1 = polyVerts[i]
      const p2 = polyVerts[(i + 1) % polyVerts.length]
      const edgeX = p2.x - p1.x
      const edgeY = p2.y - p1.y
      // Normal: (-y, x) normalized
      const len = Math.hypot(edgeX, edgeY)
      axes.push({ x: -edgeY / len, y: edgeX / len })
    }

    // 4. SAT Loop
    for (const axis of axes) {
      // Project OBB
      let minOBB = Infinity
      let maxOBB = -Infinity
      for (const v of obbVerts) {
        const proj = v.x * axis.x + v.y * axis.y
        if (proj < minOBB) minOBB = proj
        if (proj > maxOBB) maxOBB = proj
      }

      // Project Polygon
      let minPoly = Infinity
      let maxPoly = -Infinity
      for (const v of polyVerts) {
        const proj = v.x * axis.x + v.y * axis.y
        if (proj < minPoly) minPoly = proj
        if (proj > maxPoly) maxPoly = proj
      }

      // Check overlap
      if (maxOBB < minPoly || maxPoly < minOBB) {
        return false // Separating axis found
      }
    }

    return true
  }

  private applyPushback(entity: Entity, weapon: Entity['weapon']): void {
    if (!this.statsSystem || !weapon) return

    const dirX = Math.cos(weapon.visual.rotation)
    const dirY = Math.sin(weapon.visual.rotation)
    const impulseStrength = 0.2
    this.statsSystem.applyImpulse(
      entity,
      -dirX * impulseStrength,
      -dirY * impulseStrength
    )
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
        : this.getAttackRadius(attacker)

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
        this.tempHitSource.x = weaponX
        this.tempHitSource.y = weaponY
        this.statsSystem.applyWeaponHit(target, weapon, this.tempHitSource)
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
        : this.getAttackRadius(entity)

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
    entity: Entity,
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
