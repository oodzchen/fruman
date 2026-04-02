import { getCharacterBodyColor } from '../../characterBodyProfile'
import {
  CATEGORY_ENEMY,
  CATEGORY_PLAYER,
  CATEGORY_WEAPON,
  CHARACTER_DEFAULT_DATA,
  DEFAULT_BODY_FRICTION,
  DEFAULT_JUMP_BUFFER_WINDOW,
  DEFAULT_JUMP_FORCE,
  DEFAULT_JUMP_FORCE_MULTIPLIER,
  DEFAULT_MAX_JUMP_DURATION,
  DEFAULT_MAX_WALL_JUMPS,
  DEFAULT_MOVE_SPEED,
  DEFAULT_PLAYER_FOV_RAD,
  DEFAULT_PLAYER_MAX_HEALTH,
  DEFAULT_PLAYER_MAX_POSTURE,
  DEFAULT_PLAYER_MAX_TOUGHNESS,
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_PLAYER_WEIGHT,
  DEFAULT_WALL_JUMP_PUSH_AWAY_MULTIPLIER,
  DEFAULT_WALL_JUMP_UPWARD_MULTIPLIER,
  DEFAULT_WEAPON_ATTACK_DAMAGE,
  DEFAULT_WEAPON_ATTACK_RADIUS,
  DEFAULT_WEAPON_CORNER_RADIUS,
  DEFAULT_WEAPON_HEIGHT,
  DEFAULT_WEAPON_POSTURE_DAMAGE,
  DEFAULT_WEAPON_TOUGHNESS_DAMAGE,
  DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
  DEFAULT_WEAPON_WEIGHT,
  DEFAULT_WEAPON_WIDTH,
  ENEMY_ALERT_RANGE_MULTIPLIER,
  ENEMY_DETECTION_RANGE,
  ENEMY_DETECTION_RANGE_MULTIPLIERS,
  MASK_ENEMY,
  MASK_PLAYER,
  MASK_WEAPON,
  WEAPON_DEFAULT_DATA,
} from '../../constants'
import type { MapCharacterBodyProfile } from '../../editorMapTypes'
import type {
  EnemyDetectionRangeLevel,
  EnemyPatrolMode,
  EnemyType,
  MainModule,
  NormalAttackMovesetId,
  WeaponType,
  b2WorldId,
} from '../../types'
import {
  getDefaultEnemyAmmoForWeaponType,
  getDefaultPlayerAmmoForWeaponType,
  getWeaponGroundRotationRad,
  isRangedWeaponType,
  normalizeWeaponType,
  normalizeWeaponTypeAndSizeLevel,
} from '../../weaponTypeUtils'
import {
  getDefaultAttackMovesetIdForWeaponType,
  getUltimateMovesetIdForWeaponType,
} from '../AttackMoveRegistry'
import { createCharacterPhysicsBody } from '../CharacterBodyPhysics'
import {
  AttackSlotsComponent,
  EnemyAIComponent,
  Faction,
  FactionComponent,
  FollowComponent,
  GrappleComponent,
  InputComponent,
  LevelComponent,
  MovementComponent,
  PhysicsComponent,
  RenderComponent,
  SensorComponent,
  SolarEnergyComponent,
  StatsComponent,
  TransformComponent,
  WeaponComponent,
  WeaponSlotsComponent,
} from '../Component'
import type { Entity } from '../Entity'
import { forEachPhysicsShapeId } from '../PhysicsShapeUtils'
import type { World } from '../World'

type WeaponTemplate = (typeof WEAPON_DEFAULT_DATA)[WeaponType]

export function computeWeaponScaleFactor(
  template: WeaponTemplate,
  sizeLevel: number
): number {
  const baseLevel = template.sizeLevel > 0 ? template.sizeLevel : 1
  if (!Number.isFinite(sizeLevel) || sizeLevel <= 0) {
    return 1
  }
  return Math.max(0.5, sizeLevel / baseLevel)
}

export function applyWeaponSizeLevel(
  weapon: WeaponComponent,
  template: WeaponTemplate,
  sizeLevel: number
): void {
  const scaleFactor = computeWeaponScaleFactor(template, sizeLevel)
  weapon.sizeLevel = sizeLevel
  weapon.width = template.width * scaleFactor
  weapon.height = template.height * scaleFactor
  weapon.baseWidth = weapon.width
  weapon.blockWidthStart = weapon.width
  weapon.blockWidthTarget = weapon.width
  weapon.weight = template.weight * scaleFactor
}

export function createPlayer(
  world: World,
  box2d: MainModule,
  worldId: b2WorldId,
  x: number,
  y: number,
  groundTopY: number,
  radius: number = DEFAULT_PLAYER_RADIUS,
  bodyHeight = 0,
  bodyProfile?: MapCharacterBodyProfile
): Entity {
  const entity = world.createEntity()

  const transform = new TransformComponent()
  transform.x = x
  transform.y = y
  entity.addComponent(transform)

  const physics = new PhysicsComponent()
  const bodyResult = createCharacterPhysicsBody(box2d, worldId, {
    x,
    y,
    radius,
    bodyHeight,
    bodyProfile,
    density: 1.0,
    friction: DEFAULT_BODY_FRICTION,
    categoryBits: CATEGORY_PLAYER,
    maskBits: MASK_PLAYER,
  })
  physics.bodyId = bodyResult.bodyId
  physics.shapeId = bodyResult.shapeId
  physics.shapeIds = bodyResult.shapeIds

  entity.addComponent(physics)
  // ... (rest of function unchanged)

  const movement = new MovementComponent()
  movement.moveSpeed = DEFAULT_MOVE_SPEED
  movement.jumpForce = DEFAULT_JUMP_FORCE
  movement.maxJumpDuration = DEFAULT_MAX_JUMP_DURATION
  movement.jumpForceMultiplier = DEFAULT_JUMP_FORCE_MULTIPLIER
  movement.wallJumpPushAwayMultiplier = DEFAULT_WALL_JUMP_PUSH_AWAY_MULTIPLIER
  movement.wallJumpUpwardMultiplier = DEFAULT_WALL_JUMP_UPWARD_MULTIPLIER
  movement.maxWallJumps = DEFAULT_MAX_WALL_JUMPS
  movement.baseWeight = DEFAULT_PLAYER_WEIGHT
  movement.carryWeight = 0
  movement.bodyFriction = DEFAULT_BODY_FRICTION
  movement.currentFriction = DEFAULT_BODY_FRICTION
  entity.addComponent(movement)

  const input = new InputComponent()
  input.inputBuffer.setDefaultBufferWindow(DEFAULT_JUMP_BUFFER_WINDOW)
  entity.addComponent(input)

  const grapple = new GrappleComponent()
  entity.addComponent(grapple)

  const stats = new StatsComponent()
  stats.maxHealth = DEFAULT_PLAYER_MAX_HEALTH
  stats.health = DEFAULT_PLAYER_MAX_HEALTH
  stats.maxPosture = DEFAULT_PLAYER_MAX_POSTURE
  stats.posture = DEFAULT_PLAYER_MAX_POSTURE
  stats.maxToughness = DEFAULT_PLAYER_MAX_TOUGHNESS
  stats.toughness = DEFAULT_PLAYER_MAX_TOUGHNESS
  stats.combatExitTimeout = 30000 // 玩家30秒无攻击后脱战
  entity.addComponent(stats)

  const render = new RenderComponent()
  render.radius = radius
  render.bodyHeight = bodyHeight
  render.bodyProfile = bodyProfile ?? null
  entity.addComponent(render)

  const faction = new FactionComponent()
  faction.factionId = Faction.Player
  faction.enemyFactions = [Faction.Enemy]
  entity.addComponent(faction)

  const sensor = new SensorComponent()
  sensor.radius = ENEMY_DETECTION_RANGE
  sensor.fov = DEFAULT_PLAYER_FOV_RAD // +/- 80 degrees
  entity.addComponent(sensor)

  const solarEnergy = new SolarEnergyComponent()
  solarEnergy.smallCount = 4
  solarEnergy.largeCount = 0
  entity.addComponent(solarEnergy)

  const levelComp = new LevelComponent()
  entity.addComponent(levelComp)

  // 玩家初始武器组件（默认为空，需要在地上拾取）
  const weapon = new WeaponComponent()
  weapon.width = 0
  weapon.height = 0
  weapon.baseWidth = 0
  weapon.blockWidthStart = 0
  weapon.blockWidthTarget = 0
  weapon.cornerRadius = 0
  weapon.weight = 0
  weapon.weaponType = 'sword' // 默认类型，但尺寸为0不会渲染
  weapon.movesetId = getDefaultAttackMovesetIdForWeaponType('sword')
  weapon.attackDamage = DEFAULT_WEAPON_ATTACK_DAMAGE
  weapon.postureDamage = DEFAULT_WEAPON_POSTURE_DAMAGE
  weapon.toughnessDamage = DEFAULT_WEAPON_TOUGHNESS_DAMAGE
  weapon.isEquipped = false

  // 初始化位置和变换为0，因为没有实际武器
  const zeroTransform = { x: 0, y: 0, rotation: 0 }
  const zeroOffset = { dx: 0, dy: 0, rotation: 0 }

  weapon.position = { x: 0, y: 0 }
  weapon.rotation = 0
  weapon.visual = { ...zeroTransform }
  weapon.attackStartTransform = { ...zeroTransform }
  weapon.swingStartTransform = { ...zeroTransform }
  weapon.swingEndTransform = { ...zeroTransform }
  weapon.attackStartOffset = { ...zeroOffset }
  weapon.swingStartOffset = { ...zeroOffset }
  weapon.swingEndOffset = { ...zeroOffset }
  weapon.attackRadius = 0
  entity.addComponent(weapon)

  const weaponSlots = new WeaponSlotsComponent()
  weaponSlots.activeSlot = 'main'
  entity.addComponent(weaponSlots)

  const attackSlots = new AttackSlotsComponent()
  attackSlots.normal.hasMoveset = true
  attackSlots.normal.movesetId = getDefaultAttackMovesetIdForWeaponType('sword')
  const defaultUltimateMovesetId = getUltimateMovesetIdForWeaponType('sword')
  attackSlots.ultimate.hasMoveset = defaultUltimateMovesetId.length > 0
  attackSlots.ultimate.movesetId = defaultUltimateMovesetId
  entity.addComponent(attackSlots)

  return entity
}

export interface EnemyWeaponConfig {
  weaponType: WeaponType
  sizeLevel: number
  attackDamage: number
  postureDamage: number
  toughnessDamage: number
  bowAmmo?: number
}

export interface EnemySpawnConfig {
  equipWeapon?: boolean
  radius?: number
  bodyHeight?: number
  bodyProfile?: MapCharacterBodyProfile
  moveSpeed?: number
  attackDesire?: number
  parryProficiency?: number
  initialPatrolMode?: EnemyPatrolMode
  maxHealth?: number
  maxPosture?: number
  maxToughness?: number
  color?: string
  facing?: number
  debugNoDamage?: boolean
  debugNoDeath?: boolean
  redTapeEnabled?: boolean
  retreatEnabled?: boolean
  retreatDelaySec?: number
  canBeFollower?: boolean
  detectionRangeLevel?: EnemyDetectionRangeLevel
  mainWeapon?: EnemyWeaponConfig
  secondaryWeapon?: EnemyWeaponConfig
  initialNormalMovesetId?: NormalAttackMovesetId
  factionId?: string
  enemyFactions?: string[]
  allyFactions?: string[]
}

export function createEnemy(
  world: World,
  box2d: MainModule,
  worldId: b2WorldId,
  x: number,
  y: number,
  groundTopY: number,
  enemyType: EnemyType = 'default',
  options?: EnemySpawnConfig
): Entity {
  // Use default template if the specific type exists, otherwise fallback to default
  const template =
    enemyType in CHARACTER_DEFAULT_DATA
      ? CHARACTER_DEFAULT_DATA[enemyType as keyof typeof CHARACTER_DEFAULT_DATA]
      : CHARACTER_DEFAULT_DATA.default

  const hasOptions = options !== undefined
  const equipWeapon = options?.equipWeapon ?? (hasOptions ? false : true)
  const radius = options?.radius ?? template.radius
  const bodyHeight = options?.bodyHeight ?? 0
  const moveSpeed = options?.moveSpeed ?? template.moveSpeed
  const attackDesire = options?.attackDesire ?? template.attackDesire
  const parryProficiency =
    options?.parryProficiency ?? template.parryProficiency
  const initialPatrolMode =
    options?.initialPatrolMode ?? template.initialPatrolMode
  const maxHealth = options?.maxHealth ?? template.maxHealth
  const maxPosture = options?.maxPosture ?? template.maxPosture
  const maxToughness = options?.maxToughness ?? template.maxToughness
  const color = options?.color ?? template.color
  const facing = options?.facing ?? 1
  const debugNoDamage = options?.debugNoDamage === true
  const debugNoDeath = options?.debugNoDeath === true
  const initialNormalMovesetId = options?.initialNormalMovesetId ?? ''
  const enemy = createPlayer(
    world,
    box2d,
    worldId,
    x,
    y,
    groundTopY,
    radius,
    bodyHeight,
    options?.bodyProfile
  )

  // 重置敌人的脱战超时为10秒
  if (enemy.stats) {
    enemy.stats.combatExitTimeout = 10000
    enemy.stats.maxHealth = maxHealth
    enemy.stats.health = maxHealth
    enemy.stats.maxPosture = maxPosture
    enemy.stats.posture = maxPosture
    enemy.stats.maxToughness = maxToughness
    enemy.stats.toughness = maxToughness
    enemy.stats.debugNoDamage = debugNoDamage
    enemy.stats.debugNoDeath = debugNoDeath
  }

  const ai = new EnemyAIComponent()
  ai.attackDesire = attackDesire
  ai.parryProficiency = parryProficiency
  ai.redTapeEnabled = options?.redTapeEnabled === true
  ai.retreatEnabled = options?.retreatEnabled === true
  ai.retreatDelayMs = Math.round((options?.retreatDelaySec ?? 0) * 1000)
  ai.enemyType = enemyType
  ai.initialPatrolMode = initialPatrolMode
  ai.patrolCenter = { x, y }
  ai.lastPosition = { x, y }
  ai.lastFacing = facing as -1 | 1
  if (options?.detectionRangeLevel) {
    ai.detectionRange =
      ENEMY_DETECTION_RANGE *
      ENEMY_DETECTION_RANGE_MULTIPLIERS[options.detectionRangeLevel]
  } else if (enemyType === 'archer') {
    // 旧地图兼容：弓箭手默认中等视野
    ai.detectionRange = ENEMY_DETECTION_RANGE * 2
  }

  // 站岗模式复用空巡逻点逻辑
  if (ai.initialPatrolMode === 'guard') {
    ai.patrolWaypoints = []
  } else {
    // 默认巡逻路线：以出生点为中心，左右各5米的范围
    ai.patrolWaypoints = [
      { x: x - 5, y: y },
      { x: x + 5, y: y },
    ]
  }
  enemy.addComponent(ai)

  if (options?.canBeFollower === true) {
    const follow = new FollowComponent()
    enemy.addComponent(follow)
  }

  if (enemy.input) {
    enemy.input.lastMoveDirection = facing
  }

  if (enemy.sensor) {
    enemy.sensor.radius = ai.detectionRange * ENEMY_ALERT_RANGE_MULTIPLIER
    enemy.sensor.fov = (160 * Math.PI) / 180 // +/- 80 degrees
  }

  if (enemy.physics) {
    const { b2Shape_GetFilter, b2Shape_SetFilter } = box2d
    forEachPhysicsShapeId(enemy.physics, (shapeId) => {
      const filter = b2Shape_GetFilter(shapeId)
      filter.categoryBits = CATEGORY_ENEMY
      filter.maskBits = MASK_ENEMY
      b2Shape_SetFilter(shapeId, filter)
    })
  }

  if (enemy.faction) {
    enemy.faction.factionId = options?.factionId ?? Faction.Enemy
    enemy.faction.enemyFactions = options?.enemyFactions ?? [Faction.Player]
    enemy.faction.allyFactions = options?.allyFactions ?? []
  }

  if (enemy.render) {
    enemy.render.color = getCharacterBodyColor(options?.bodyProfile, color)
    enemy.render.bodyProfile = options?.bodyProfile ?? null
  }

  if (enemy.movement) {
    enemy.movement.moveSpeed = moveSpeed
  }

  if (enemy.attackSlots) {
    const defaultWeaponType =
      normalizeWeaponType(
        options?.mainWeapon?.weaponType ?? options?.secondaryWeapon?.weaponType
      ) ?? 'sword'
    enemy.attackSlots.normal.hasMoveset = true
    enemy.attackSlots.normal.movesetId =
      initialNormalMovesetId ||
      getDefaultAttackMovesetIdForWeaponType(defaultWeaponType) ||
      getDefaultAttackMovesetIdForWeaponType('sword')
    if (enemy.enemyAI) {
      enemy.enemyAI.movesetId = enemy.attackSlots.normal.movesetId
    }
  }

  if (equipWeapon && enemy.weapon && enemy.transform) {
    const followX = enemy.transform.x - facing * (radius + 0.2)
    const followY = enemy.transform.y + radius * -0.2
    const equippedTransform = {
      x: followX,
      y: followY,
      rotation: DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
    }

    if (enemy.weaponSlots) {
      // Main Weapon Setup

      if (options?.mainWeapon) {
        const config = options.mainWeapon
        const normalizedConfig = normalizeWeaponTypeAndSizeLevel(
          config.weaponType,
          config.sizeLevel
        )
        if (!normalizedConfig) {
          enemy.weaponSlots.main.hasWeapon = false
        } else {
          const template = WEAPON_DEFAULT_DATA[normalizedConfig.weaponType]
          const scaleFactor = computeWeaponScaleFactor(
            template,
            normalizedConfig.sizeLevel
          )

          enemy.weaponSlots.main.hasWeapon = true

          enemy.weaponSlots.main.weaponType = normalizedConfig.weaponType
          enemy.weaponSlots.main.movesetId =
            getDefaultAttackMovesetIdForWeaponType(normalizedConfig.weaponType)

          enemy.weaponSlots.main.width = template.width * scaleFactor

          enemy.weaponSlots.main.height = template.height * scaleFactor

          enemy.weaponSlots.main.baseWidth = template.width * scaleFactor

          enemy.weaponSlots.main.sizeLevel = normalizedConfig.sizeLevel

          enemy.weaponSlots.main.sizeMaxLevel = template.sizeMaxLevel

          enemy.weaponSlots.main.cornerRadius = DEFAULT_WEAPON_CORNER_RADIUS

          enemy.weaponSlots.main.weight = template.weight * scaleFactor

          enemy.weaponSlots.main.attackDamage = config.attackDamage

          enemy.weaponSlots.main.postureDamage = config.postureDamage

          enemy.weaponSlots.main.toughnessDamage = config.toughnessDamage

          if (isRangedWeaponType(normalizedConfig.weaponType)) {
            enemy.weaponSlots.main.bowAmmoMax = config.bowAmmo ?? 0

            enemy.weaponSlots.main.bowAmmo = config.bowAmmo ?? 0
          } else {
            enemy.weaponSlots.main.bowAmmoMax = 0

            enemy.weaponSlots.main.bowAmmo = 0
          }
        }
      } else if (!hasOptions || enemyType !== 'archer') {
        // Default main weapon (Sword) if no options provided or if explicitly requested via lack of config

        // Note: If options IS provided but mainWeapon is undefined, we assume NO main weapon unless default fallback is desired.

        // However, existing logic seemed to force sword for non-archers.

        // Let's keep backward compatibility: if NO options provided, use default sword.

        // If options provided but mainWeapon is missing, we leave it empty?

        // The previous code forced sword if enemyType != archer.

        // Let's default to sword ONLY if options is undefined (legacy behavior)

        if (!options?.mainWeapon) {
          const swordTemplate = WEAPON_DEFAULT_DATA.sword

          enemy.weaponSlots.main.hasWeapon = true

          enemy.weaponSlots.main.weaponType = 'sword'
          enemy.weaponSlots.main.movesetId =
            getDefaultAttackMovesetIdForWeaponType('sword')

          enemy.weaponSlots.main.width = swordTemplate.width

          enemy.weaponSlots.main.height = swordTemplate.height

          enemy.weaponSlots.main.baseWidth = swordTemplate.width

          enemy.weaponSlots.main.sizeLevel = swordTemplate.sizeLevel

          enemy.weaponSlots.main.sizeMaxLevel = swordTemplate.sizeMaxLevel

          enemy.weaponSlots.main.cornerRadius = DEFAULT_WEAPON_CORNER_RADIUS

          enemy.weaponSlots.main.weight = swordTemplate.weight

          enemy.weaponSlots.main.attackDamage = swordTemplate.attackDamage

          enemy.weaponSlots.main.postureDamage = swordTemplate.postureDamage

          enemy.weaponSlots.main.toughnessDamage = swordTemplate.toughnessDamage

          enemy.weaponSlots.main.bowAmmoMax = 0

          enemy.weaponSlots.main.bowAmmo = 0
        }
      }

      // Secondary Weapon Setup

      if (options?.secondaryWeapon) {
        const config = options.secondaryWeapon
        const normalizedConfig = normalizeWeaponTypeAndSizeLevel(
          config.weaponType,
          config.sizeLevel
        )
        if (!normalizedConfig) {
          enemy.weaponSlots.secondary.hasWeapon = false
        } else {
          const template = WEAPON_DEFAULT_DATA[normalizedConfig.weaponType]
          const scaleFactor = computeWeaponScaleFactor(
            template,
            normalizedConfig.sizeLevel
          )

          enemy.weaponSlots.secondary.hasWeapon = true

          enemy.weaponSlots.secondary.weaponType = normalizedConfig.weaponType
          enemy.weaponSlots.secondary.movesetId =
            getDefaultAttackMovesetIdForWeaponType(normalizedConfig.weaponType)

          enemy.weaponSlots.secondary.width = template.width * scaleFactor

          enemy.weaponSlots.secondary.height = template.height * scaleFactor

          enemy.weaponSlots.secondary.baseWidth = template.width * scaleFactor

          enemy.weaponSlots.secondary.sizeLevel = normalizedConfig.sizeLevel

          enemy.weaponSlots.secondary.sizeMaxLevel = template.sizeMaxLevel

          enemy.weaponSlots.secondary.cornerRadius =
            DEFAULT_WEAPON_CORNER_RADIUS

          enemy.weaponSlots.secondary.weight = template.weight * scaleFactor

          enemy.weaponSlots.secondary.attackDamage = config.attackDamage

          enemy.weaponSlots.secondary.postureDamage = config.postureDamage

          enemy.weaponSlots.secondary.toughnessDamage = config.toughnessDamage

          if (isRangedWeaponType(normalizedConfig.weaponType)) {
            enemy.weaponSlots.secondary.bowAmmoMax = config.bowAmmo ?? 0

            enemy.weaponSlots.secondary.bowAmmo = config.bowAmmo ?? 0
          } else {
            enemy.weaponSlots.secondary.bowAmmoMax = 0

            enemy.weaponSlots.secondary.bowAmmo = 0
          }
        }
      } else if (enemyType === 'archer' && !hasOptions) {
        // Default archer secondary (Bow)

        const bowTemplate = WEAPON_DEFAULT_DATA.bow

        enemy.weaponSlots.secondary.hasWeapon = true

        enemy.weaponSlots.secondary.weaponType = 'bow'
        enemy.weaponSlots.secondary.movesetId = ''

        enemy.weaponSlots.secondary.width = bowTemplate.width

        enemy.weaponSlots.secondary.height = bowTemplate.height

        enemy.weaponSlots.secondary.baseWidth = bowTemplate.width

        enemy.weaponSlots.secondary.sizeLevel = bowTemplate.sizeLevel

        enemy.weaponSlots.secondary.sizeMaxLevel = bowTemplate.sizeMaxLevel

        enemy.weaponSlots.secondary.cornerRadius = DEFAULT_WEAPON_CORNER_RADIUS

        enemy.weaponSlots.secondary.weight = bowTemplate.weight

        enemy.weaponSlots.secondary.attackDamage = bowTemplate.attackDamage

        enemy.weaponSlots.secondary.postureDamage = bowTemplate.postureDamage

        enemy.weaponSlots.secondary.toughnessDamage =
          bowTemplate.toughnessDamage

        enemy.weaponSlots.secondary.bowAmmoMax =
          getDefaultEnemyAmmoForWeaponType('bow')

        enemy.weaponSlots.secondary.bowAmmo =
          getDefaultEnemyAmmoForWeaponType('bow')
      }

      // Determine active slot

      // If we have secondary but no main, switch to secondary.

      // If we have main, stick to main.

      // If archer default, stick to secondary (as per previous logic?).

      // Previous logic:

      // Archer: secondary (bow) active.

      // Others: main (sword) active.

      if (options?.mainWeapon) {
        enemy.weaponSlots.activeSlot = 'main'
      } else if (options?.secondaryWeapon) {
        enemy.weaponSlots.activeSlot = 'secondary'
      } else {
        // Fallback defaults

        enemy.weaponSlots.activeSlot =
          enemyType === 'archer' ? 'secondary' : 'main'
      }

      // Apply active slot to WeaponComponent

      const activeSlot =
        enemy.weaponSlots.activeSlot === 'main'
          ? enemy.weaponSlots.main
          : enemy.weaponSlots.secondary

      if (activeSlot.hasWeapon && activeSlot.weaponType) {
        const weaponType = activeSlot.weaponType as WeaponType

        const template = WEAPON_DEFAULT_DATA[weaponType]

        applyWeaponSizeLevel(enemy.weapon, template, activeSlot.sizeLevel)

        enemy.weapon.sizeMaxLevel = activeSlot.sizeMaxLevel

        enemy.weapon.cornerRadius = activeSlot.cornerRadius

        enemy.weapon.weaponType = activeSlot.weaponType
        enemy.weapon.movesetId =
          activeSlot.movesetId ||
          getDefaultAttackMovesetIdForWeaponType(activeSlot.weaponType)
        if (enemy.enemyAI && enemy.attackSlots?.normal.hasMoveset) {
          enemy.attackSlots.normal.movesetId = enemy.weapon.movesetId
          enemy.enemyAI.movesetId = enemy.weapon.movesetId
        }

        enemy.weapon.attackDamage = activeSlot.attackDamage

        enemy.weapon.postureDamage = activeSlot.postureDamage

        enemy.weapon.toughnessDamage = activeSlot.toughnessDamage

        enemy.weapon.bowAmmoMax = activeSlot.bowAmmoMax

        enemy.weapon.bowAmmo = activeSlot.bowAmmo
      }

      enemy.weapon.isEquipped = activeSlot.hasWeapon
    } else {
      // No weapon slots component (shouldn't happen for enemies created here, but safe fallback)

      enemy.weapon.isEquipped = false
    }
    enemy.weapon.position = { x: followX, y: followY }
    enemy.weapon.visual = { ...equippedTransform }
    enemy.weapon.attackStartTransform = { ...equippedTransform }
    enemy.weapon.swingStartTransform = { ...equippedTransform }
    enemy.weapon.swingEndTransform = { ...equippedTransform }
    enemy.weapon.attackStartOffset = {
      dx: followX - enemy.transform.x,
      dy: followY - enemy.transform.y,
      rotation: DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
    }
    enemy.weapon.swingStartOffset = { ...enemy.weapon.attackStartOffset }
    enemy.weapon.swingEndOffset = { ...enemy.weapon.attackStartOffset }
    enemy.weapon.attackFacing = facing
    enemy.weapon.attackPhase = 'idle'
    enemy.weapon.attackQueued = false
    // 武器重量由MovementSystem自动读取
  }

  if (enemyType === 'archer' && enemy.input) {
    enemy.input.lastMoveDirection = facing
    enemy.input.facingOverride = facing
  }

  return enemy
}

export function createWeapon(
  world: World,
  box2d: MainModule,
  worldId: b2WorldId,
  x: number,
  y: number,
  groundTopY: number,
  weaponType: WeaponType = 'sword'
): Entity {
  const entity = world.createEntity()

  // Use the passed y parameter for spawn height
  // Caller should ensure y is high enough to avoid obstacles

  const transform = new TransformComponent()
  transform.x = x
  transform.y = y
  entity.addComponent(transform)

  const template = WEAPON_DEFAULT_DATA[weaponType]
  const weapon = new WeaponComponent()
  applyWeaponSizeLevel(weapon, template, template.sizeLevel)
  weapon.sizeMaxLevel = template.sizeMaxLevel
  weapon.cornerRadius = DEFAULT_WEAPON_CORNER_RADIUS
  weapon.weaponType = weaponType
  weapon.movesetId = getDefaultAttackMovesetIdForWeaponType(weaponType)
  weapon.attackDamage = template.attackDamage
  weapon.postureDamage = template.postureDamage
  weapon.toughnessDamage = template.toughnessDamage
  if (isRangedWeaponType(weaponType)) {
    weapon.bowAmmoMax = getDefaultPlayerAmmoForWeaponType(weaponType)
    weapon.bowAmmo = getDefaultPlayerAmmoForWeaponType(weaponType)
  }

  // Set initial position to spawn point
  weapon.position = {
    x: x,
    y: y,
  }
  const groundRotation = getWeaponGroundRotationRad(weaponType)
  weapon.rotation = groundRotation
  weapon.isEquipped = false
  weapon.attackPhase = 'idle'
  weapon.attackElapsedMs = 0
  weapon.lastAttackTimestamp = 0
  weapon.attackStartTransform = {
    x: x,
    y: y,
    rotation: groundRotation,
  }
  weapon.visual = {
    x: x,
    y: y,
    rotation: groundRotation,
  }
  weapon.attackQueued = false
  weapon.comboCount = 0
  weapon.swingDirection = 'toFront'
  weapon.nextSwingDirection = 'toFront'
  weapon.attackFacing = 1
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
  weapon.swingStartTransform = {
    x: x,
    y: y,
    rotation: groundRotation,
  }
  weapon.swingEndTransform = {
    x: x,
    y: y,
    rotation: groundRotation,
  }
  weapon.attackRadius = DEFAULT_WEAPON_ATTACK_RADIUS
  weapon.pickupCooldownEndTime = 0 // 初始生成的武器没有拾取冷却

  entity.addComponent(weapon)

  // 创建物理组件，让武器自然掉落
  const physics = new PhysicsComponent()
  const {
    b2DefaultBodyDef,
    b2CreateBody,
    b2BodyType,
    b2DefaultShapeDef,
    b2CreateCircleShape,
    b2Circle,
  } = box2d

  const bodyDef = b2DefaultBodyDef()
  bodyDef.type = b2BodyType.b2_dynamicBody
  bodyDef.position.Set(x, y)
  bodyDef.linearDamping = 2.0 // 较高的阻尼，快速减速
  bodyDef.motionLocks.angularZ = true // 锁定旋转，保持水平
  physics.bodyId = b2CreateBody(worldId, bodyDef)

  // 使用圆形碰撞体，半径基于武器高度
  const weaponRadius = weapon.height * 0.5
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

  entity.addComponent(physics)

  return entity
}
