import {
  getCharacterBloodColor,
  getCharacterBodyColor,
} from '../../characterBodyProfile'
import {
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
  DEFAULT_WEAPON_POSTURE_DAMAGE,
  DEFAULT_WEAPON_TOUGHNESS_DAMAGE,
  DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
  ENEMY_ALERT_RANGE_MULTIPLIER,
  ENEMY_DETECTION_RANGE,
  ENEMY_DETECTION_RANGE_MULTIPLIERS,
  WEAPON_DEFAULT_DATA,
} from '../../constants'
import type {
  MapCharacterBodyProfile,
  MapNpcDropItem,
} from '../../editorMapTypes'
import { resolveNpcBodyProfile } from '../../npcBodyProfileUtils'
import {
  buildDefaultNpcDropList,
  normalizeNpcDropList,
} from '../../npcDropUtils'
import {
  getEnemyCollisionCategory,
  getEnemyCollisionMask,
  getEnvironmentCollisionMask,
  getPlayerCollisionCategory,
  getPlayerCollisionMask,
  getWeaponCollisionCategory,
  getWeaponCollisionMask,
} from '../../physicsLayers'
import type {
  MainModule,
  NormalAttackMovesetId,
  NpcAttackMove,
  NpcDetectionRangeLevel,
  NpcPatrolMode,
  NpcType,
  WeaponType,
  b2WorldId,
} from '../../types'
import {
  computeWeaponScaleFactor,
  getDefaultNpcAmmoForWeaponType,
  getDefaultPlayerAmmoForWeaponType,
  getWeaponGroundRotationRad,
  isRangedWeaponType,
  normalizeWeaponType,
  normalizeWeaponTypeAndSizeLevel,
  resolveWeaponStatsForSize,
} from '../../weaponTypeUtils'
import {
  buildDefaultNpcAttackMoves,
  getDefaultAttackMovesetIdForWeaponType,
  getUltimateMovesetIdForWeaponType,
} from '../AttackMoveRegistry'
import { createCharacterPhysicsBody } from '../CharacterBodyPhysics'
import {
  AttackSlotsComponent,
  DEFAULT_SKILL_MAX_CHARGES,
  Faction,
  FactionComponent,
  FollowComponent,
  GrappleComponent,
  InputComponent,
  LevelComponent,
  MovementComponent,
  NpcAIComponent,
  NpcDropTableComponent,
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

export { computeWeaponScaleFactor } from '../../weaponTypeUtils'

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
  bodyProfile?: MapCharacterBodyProfile,
  renderLayer = 0,
  segmentedCollision = false,
  segmentedProxyHalfWidth = 0,
  segmentedProxyHalfHeight = 0,
  segmentedProxyOffsetY = 0
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
    segmented: segmentedCollision,
    segmentedProxyHalfWidth,
    segmentedProxyHalfHeight,
    segmentedProxyOffsetY,
    density: 1.0,
    friction: DEFAULT_BODY_FRICTION,
    categoryBits: getPlayerCollisionCategory(renderLayer),
    maskBits: getPlayerCollisionMask(renderLayer),
  })
  physics.bodyId = bodyResult.bodyId
  physics.shapeId = bodyResult.shapeId
  physics.shapeIds = bodyResult.shapeIds

  entity.addComponent(physics)
  // ... (rest of function unchanged)

  const movement = new MovementComponent()
  movement.moveSpeed = DEFAULT_MOVE_SPEED
  movement.baseMoveSpeed = DEFAULT_MOVE_SPEED
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
  input.lastMoveDirection = 1
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
  render.segmentedCollision = segmentedCollision
  render.segmentedProxyHalfWidth = segmentedProxyHalfWidth
  render.segmentedProxyHalfHeight = segmentedProxyHalfHeight
  render.segmentedProxyOffsetY = segmentedProxyOffsetY
  render.renderLayer = renderLayer
  render.bloodColor = getCharacterBloodColor(bodyProfile, '')
  entity.addComponent(render)

  const faction = new FactionComponent()
  faction.factionId = Faction.Player
  faction.npcFactions = [Faction.Enemy]
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
  levelComp.baseMaxHealth = DEFAULT_PLAYER_MAX_HEALTH
  levelComp.baseMaxToughness = DEFAULT_PLAYER_MAX_TOUGHNESS
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
  weapon.renderLayer = renderLayer

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

export interface NpcWeaponConfig {
  weaponType: WeaponType
  sizeLevel: number
  attackDamage: number
  postureDamage: number
  toughnessDamage: number
  bowAmmo?: number
}

export interface NpcSpawnConfig {
  equipWeapon?: boolean
  radius?: number
  bodyHeight?: number
  bodyProfile?: MapCharacterBodyProfile
  moveSpeed?: number
  attackDesire?: number
  parryProficiency?: number
  initialPatrolMode?: NpcPatrolMode
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
  detectionRangeLevel?: NpcDetectionRangeLevel
  mainWeapon?: NpcWeaponConfig
  secondaryWeapon?: NpcWeaponConfig
  drops?: MapNpcDropItem[]
  initialNormalMovesetId?: NormalAttackMovesetId
  attackMoves?: NpcAttackMove[]
  factionId?: string
  npcFactions?: string[]
  enemyFactions?: string[]
  allyFactions?: string[]
  renderLayer?: number
  segmentedCollision?: boolean
  segmentedProxyHalfWidth?: number
  segmentedProxyHalfHeight?: number
  segmentedProxyOffsetY?: number
}

export function createNpc(
  world: World,
  box2d: MainModule,
  worldId: b2WorldId,
  x: number,
  y: number,
  groundTopY: number,
  npcType: NpcType = 'default',
  options?: NpcSpawnConfig
): Entity {
  // Use default template if the specific type exists, otherwise fallback to default
  const template =
    npcType in CHARACTER_DEFAULT_DATA
      ? CHARACTER_DEFAULT_DATA[npcType as keyof typeof CHARACTER_DEFAULT_DATA]
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
  const renderLayer = options?.renderLayer ?? 0
  const resolvedBodyProfile: MapCharacterBodyProfile | undefined =
    resolveNpcBodyProfile(npcType, options?.bodyProfile)
  const segmentedCollision =
    options?.segmentedCollision ??
    resolvedBodyProfile?.spineSegmentedCollision === true

  const npc = createPlayer(
    world,
    box2d,
    worldId,
    x,
    y,
    groundTopY,
    radius,
    bodyHeight,
    resolvedBodyProfile,
    renderLayer,
    segmentedCollision,
    options?.segmentedProxyHalfWidth ?? 0,
    options?.segmentedProxyHalfHeight ?? 0,
    options?.segmentedProxyOffsetY ?? 0
  )

  // 重置 NPC 的脱战超时为10秒
  if (npc.stats) {
    npc.stats.combatExitTimeout = 10000
    npc.stats.maxHealth = maxHealth
    npc.stats.health = maxHealth
    npc.stats.maxPosture = maxPosture
    npc.stats.posture = maxPosture
    npc.stats.maxToughness = maxToughness
    npc.stats.toughness = maxToughness
    npc.stats.debugNoDamage = debugNoDamage
    npc.stats.debugNoDeath = debugNoDeath
  }

  const ai = new NpcAIComponent()
  ai.attackDesire = attackDesire
  ai.parryProficiency = parryProficiency
  ai.redTapeEnabled = options?.redTapeEnabled === true
  ai.retreatEnabled = options?.retreatEnabled === true
  ai.retreatDelayMs = Math.round((options?.retreatDelaySec ?? 0) * 1000)
  ai.npcType = npcType
  ai.initialPatrolMode = initialPatrolMode
  ai.patrolCenter = { x, y }
  ai.lastPosition = { x, y }
  ai.lastFacing = facing as -1 | 1
  ai.attackMoves = options?.attackMoves ?? buildDefaultNpcAttackMoves()
  if (options?.detectionRangeLevel) {
    ai.detectionRange =
      ENEMY_DETECTION_RANGE *
      ENEMY_DETECTION_RANGE_MULTIPLIERS[options.detectionRangeLevel]
  } else if (npcType === 'archer') {
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
  npc.addComponent(ai)

  if (options?.canBeFollower === true) {
    const follow = new FollowComponent()
    npc.addComponent(follow)
  }

  if (npc.input) {
    npc.input.lastMoveDirection = facing
  }

  if (npc.sensor) {
    npc.sensor.radius = ai.detectionRange * ENEMY_ALERT_RANGE_MULTIPLIER
    npc.sensor.fov = (160 * Math.PI) / 180 // +/- 80 degrees
  }

  if (npc.physics) {
    const { b2Shape_GetFilter, b2Shape_SetFilter } = box2d
    forEachPhysicsShapeId(npc.physics, (shapeId) => {
      const filter = b2Shape_GetFilter(shapeId)
      filter.categoryBits = getEnemyCollisionCategory(renderLayer)
      filter.maskBits = segmentedCollision
        ? getEnemyCollisionMask(renderLayer)
        : getEnemyCollisionMask(renderLayer)
      b2Shape_SetFilter(shapeId, filter)
    })
  }

  if (npc.faction) {
    npc.faction.factionId = options?.factionId ?? Faction.Enemy
    npc.faction.npcFactions = options?.npcFactions ??
      options?.enemyFactions ?? [Faction.Player]
    npc.faction.allyFactions = options?.allyFactions ?? []
  }

  if (npc.render) {
    npc.render.color = getCharacterBodyColor(resolvedBodyProfile, color)
    npc.render.bloodColor = getCharacterBloodColor(resolvedBodyProfile, '')
    npc.render.bodyProfile = resolvedBodyProfile ?? null
    npc.render.renderLayer = renderLayer
  }

  if (npc.movement) {
    npc.movement.moveSpeed = moveSpeed
  }

  if (npc.attackSlots) {
    const defaultWeaponType =
      normalizeWeaponType(
        options?.mainWeapon?.weaponType ?? options?.secondaryWeapon?.weaponType
      ) ?? 'sword'
    npc.attackSlots.normal.hasMoveset = true
    npc.attackSlots.normal.movesetId =
      initialNormalMovesetId ||
      getDefaultAttackMovesetIdForWeaponType(defaultWeaponType) ||
      getDefaultAttackMovesetIdForWeaponType('sword')
    if (npc.npcAI) {
      npc.npcAI.movesetId = npc.attackSlots.normal.movesetId
    }
  }

  if (equipWeapon && npc.weapon && npc.transform) {
    const followX = npc.transform.x - facing * (radius + 0.2)
    const followY = npc.transform.y + radius * -0.2
    const equippedTransform = {
      x: followX,
      y: followY,
      rotation: DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
    }

    if (npc.weaponSlots) {
      // Main Weapon Setup

      if (options?.mainWeapon) {
        const config = options.mainWeapon
        const normalizedConfig = normalizeWeaponTypeAndSizeLevel(
          config.weaponType,
          config.sizeLevel
        )
        if (!normalizedConfig) {
          npc.weaponSlots.main.hasWeapon = false
        } else {
          const template = WEAPON_DEFAULT_DATA[normalizedConfig.weaponType]
          const scaleFactor = computeWeaponScaleFactor(
            template,
            normalizedConfig.sizeLevel
          )
          const resolvedStats = resolveWeaponStatsForSize(
            template,
            normalizedConfig.sizeLevel,
            {
              attackDamage: config.attackDamage,
              postureDamage: config.postureDamage,
              toughnessDamage: config.toughnessDamage,
            },
            true
          )

          npc.weaponSlots.main.hasWeapon = true

          npc.weaponSlots.main.weaponType = normalizedConfig.weaponType
          npc.weaponSlots.main.movesetId =
            getDefaultAttackMovesetIdForWeaponType(normalizedConfig.weaponType)

          npc.weaponSlots.main.width = template.width * scaleFactor

          npc.weaponSlots.main.height = template.height * scaleFactor

          npc.weaponSlots.main.baseWidth = template.width * scaleFactor

          npc.weaponSlots.main.sizeLevel = normalizedConfig.sizeLevel

          npc.weaponSlots.main.sizeMaxLevel = template.sizeMaxLevel

          npc.weaponSlots.main.cornerRadius = DEFAULT_WEAPON_CORNER_RADIUS

          npc.weaponSlots.main.weight = template.weight * scaleFactor

          npc.weaponSlots.main.attackDamage = resolvedStats.attackDamage

          npc.weaponSlots.main.postureDamage = resolvedStats.postureDamage

          npc.weaponSlots.main.toughnessDamage = resolvedStats.toughnessDamage

          if (isRangedWeaponType(normalizedConfig.weaponType)) {
            npc.weaponSlots.main.bowAmmoMax = config.bowAmmo ?? 0

            npc.weaponSlots.main.bowAmmo = config.bowAmmo ?? 0
          } else {
            npc.weaponSlots.main.bowAmmoMax = 0

            npc.weaponSlots.main.bowAmmo = 0
          }
        }
      } else if (!hasOptions || npcType !== 'archer') {
        // Default main weapon (Sword) if no options provided or if explicitly requested via lack of config

        // Note: If options IS provided but mainWeapon is undefined, we assume NO main weapon unless default fallback is desired.

        // However, existing logic seemed to force sword for non-archers.

        // Let's keep backward compatibility: if NO options provided, use default sword.

        // If options provided but mainWeapon is missing, we leave it empty?

        // The previous code forced sword if npcType != archer.

        // Let's default to sword ONLY if options is undefined (legacy behavior)

        if (!options?.mainWeapon) {
          const swordTemplate = WEAPON_DEFAULT_DATA.sword
          const swordStats = resolveWeaponStatsForSize(
            swordTemplate,
            swordTemplate.sizeLevel
          )

          npc.weaponSlots.main.hasWeapon = true

          npc.weaponSlots.main.weaponType = 'sword'
          npc.weaponSlots.main.movesetId =
            getDefaultAttackMovesetIdForWeaponType('sword')

          npc.weaponSlots.main.width = swordTemplate.width

          npc.weaponSlots.main.height = swordTemplate.height

          npc.weaponSlots.main.baseWidth = swordTemplate.width

          npc.weaponSlots.main.sizeLevel = swordTemplate.sizeLevel

          npc.weaponSlots.main.sizeMaxLevel = swordTemplate.sizeMaxLevel

          npc.weaponSlots.main.cornerRadius = DEFAULT_WEAPON_CORNER_RADIUS

          npc.weaponSlots.main.weight = swordTemplate.weight

          npc.weaponSlots.main.attackDamage = swordStats.attackDamage

          npc.weaponSlots.main.postureDamage = swordStats.postureDamage

          npc.weaponSlots.main.toughnessDamage = swordStats.toughnessDamage

          npc.weaponSlots.main.bowAmmoMax = 0

          npc.weaponSlots.main.bowAmmo = 0
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
          npc.weaponSlots.secondary.hasWeapon = false
        } else {
          const template = WEAPON_DEFAULT_DATA[normalizedConfig.weaponType]
          const scaleFactor = computeWeaponScaleFactor(
            template,
            normalizedConfig.sizeLevel
          )
          const resolvedStats = resolveWeaponStatsForSize(
            template,
            normalizedConfig.sizeLevel,
            {
              attackDamage: config.attackDamage,
              postureDamage: config.postureDamage,
              toughnessDamage: config.toughnessDamage,
            },
            true
          )

          npc.weaponSlots.secondary.hasWeapon = true

          npc.weaponSlots.secondary.weaponType = normalizedConfig.weaponType
          npc.weaponSlots.secondary.movesetId =
            getDefaultAttackMovesetIdForWeaponType(normalizedConfig.weaponType)

          npc.weaponSlots.secondary.width = template.width * scaleFactor

          npc.weaponSlots.secondary.height = template.height * scaleFactor

          npc.weaponSlots.secondary.baseWidth = template.width * scaleFactor

          npc.weaponSlots.secondary.sizeLevel = normalizedConfig.sizeLevel

          npc.weaponSlots.secondary.sizeMaxLevel = template.sizeMaxLevel

          npc.weaponSlots.secondary.cornerRadius = DEFAULT_WEAPON_CORNER_RADIUS

          npc.weaponSlots.secondary.weight = template.weight * scaleFactor

          npc.weaponSlots.secondary.attackDamage = resolvedStats.attackDamage

          npc.weaponSlots.secondary.postureDamage = resolvedStats.postureDamage

          npc.weaponSlots.secondary.toughnessDamage =
            resolvedStats.toughnessDamage

          if (isRangedWeaponType(normalizedConfig.weaponType)) {
            npc.weaponSlots.secondary.bowAmmoMax = config.bowAmmo ?? 0

            npc.weaponSlots.secondary.bowAmmo = config.bowAmmo ?? 0
          } else {
            npc.weaponSlots.secondary.bowAmmoMax = 0

            npc.weaponSlots.secondary.bowAmmo = 0
          }
        }
      } else if (npcType === 'archer' && !hasOptions) {
        // Default archer secondary (Bow)

        const bowTemplate = WEAPON_DEFAULT_DATA.bow
        const bowStats = resolveWeaponStatsForSize(
          bowTemplate,
          bowTemplate.sizeLevel
        )

        npc.weaponSlots.secondary.hasWeapon = true

        npc.weaponSlots.secondary.weaponType = 'bow'
        npc.weaponSlots.secondary.movesetId = ''

        npc.weaponSlots.secondary.width = bowTemplate.width

        npc.weaponSlots.secondary.height = bowTemplate.height

        npc.weaponSlots.secondary.baseWidth = bowTemplate.width

        npc.weaponSlots.secondary.sizeLevel = bowTemplate.sizeLevel

        npc.weaponSlots.secondary.sizeMaxLevel = bowTemplate.sizeMaxLevel

        npc.weaponSlots.secondary.cornerRadius = DEFAULT_WEAPON_CORNER_RADIUS

        npc.weaponSlots.secondary.weight = bowTemplate.weight

        npc.weaponSlots.secondary.attackDamage = bowStats.attackDamage

        npc.weaponSlots.secondary.postureDamage = bowStats.postureDamage

        npc.weaponSlots.secondary.toughnessDamage = bowStats.toughnessDamage

        npc.weaponSlots.secondary.bowAmmoMax =
          getDefaultNpcAmmoForWeaponType('bow')

        npc.weaponSlots.secondary.bowAmmo =
          getDefaultNpcAmmoForWeaponType('bow')
      }

      // Determine active slot

      // If we have secondary but no main, switch to secondary.

      // If we have main, stick to main.

      // If archer default, stick to secondary (as per previous logic?).

      // Previous logic:

      // Archer: secondary (bow) active.

      // Others: main (sword) active.

      if (options?.mainWeapon) {
        npc.weaponSlots.activeSlot = 'main'
      } else if (options?.secondaryWeapon) {
        npc.weaponSlots.activeSlot = 'secondary'
      } else {
        // Fallback defaults

        npc.weaponSlots.activeSlot = npcType === 'archer' ? 'secondary' : 'main'
      }

      // Apply active slot to WeaponComponent

      const activeSlot =
        npc.weaponSlots.activeSlot === 'main'
          ? npc.weaponSlots.main
          : npc.weaponSlots.secondary

      if (activeSlot.hasWeapon && activeSlot.weaponType) {
        const weaponType = activeSlot.weaponType as WeaponType

        const template = WEAPON_DEFAULT_DATA[weaponType]

        applyWeaponSizeLevel(npc.weapon, template, activeSlot.sizeLevel)

        npc.weapon.sizeMaxLevel = activeSlot.sizeMaxLevel

        npc.weapon.cornerRadius = activeSlot.cornerRadius

        npc.weapon.weaponType = activeSlot.weaponType
        npc.weapon.movesetId =
          activeSlot.movesetId ||
          getDefaultAttackMovesetIdForWeaponType(activeSlot.weaponType)
        if (npc.npcAI && npc.attackSlots?.normal.hasMoveset) {
          npc.attackSlots.normal.movesetId = npc.weapon.movesetId
          npc.npcAI.movesetId = npc.weapon.movesetId
        }

        npc.weapon.attackDamage = activeSlot.attackDamage

        npc.weapon.postureDamage = activeSlot.postureDamage

        npc.weapon.toughnessDamage = activeSlot.toughnessDamage

        npc.weapon.bowAmmoMax = activeSlot.bowAmmoMax

        npc.weapon.bowAmmo = activeSlot.bowAmmo
      }

      npc.weapon.isEquipped = activeSlot.hasWeapon
    } else {
      // No weapon slots component (shouldn't happen for npcs created here, but safe fallback)

      npc.weapon.isEquipped = false
    }
    npc.weapon.position = { x: followX, y: followY }
    npc.weapon.visual = { ...equippedTransform }
    npc.weapon.attackStartTransform = { ...equippedTransform }
    npc.weapon.swingStartTransform = { ...equippedTransform }
    npc.weapon.swingEndTransform = { ...equippedTransform }
    npc.weapon.attackStartOffset = {
      dx: followX - npc.transform.x,
      dy: followY - npc.transform.y,
      rotation: DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
    }
    npc.weapon.swingStartOffset = { ...npc.weapon.attackStartOffset }
    npc.weapon.swingEndOffset = { ...npc.weapon.attackStartOffset }
    npc.weapon.attackFacing = facing
    npc.weapon.attackPhase = 'idle'
    npc.weapon.attackQueued = false
    // 武器重量由MovementSystem自动读取
  }

  if (npcType === 'archer' && npc.input) {
    npc.input.lastMoveDirection = facing
    npc.input.facingOverride = facing
  }

  let dropItems: MapNpcDropItem[]
  if (options?.drops !== undefined) {
    dropItems = normalizeNpcDropList(options.drops)
  } else if (npc.weaponSlots) {
    dropItems = buildDefaultNpcDropList(
      npc.weaponSlots.main.hasWeapon
        ? (npc.weaponSlots.main.weaponType as WeaponType | undefined)
        : undefined,
      npc.weaponSlots.secondary.hasWeapon
        ? (npc.weaponSlots.secondary.weaponType as WeaponType | undefined)
        : undefined
    )
  } else {
    dropItems = npc.weapon?.isEquipped
      ? buildDefaultNpcDropList(
          normalizeWeaponType(npc.weapon.weaponType) ?? undefined
        )
      : []
  }
  if (dropItems.length > 0) {
    const npcDropTable = new NpcDropTableComponent()
    for (let i = 0; i < dropItems.length; i++) {
      npcDropTable.items.push(dropItems[i])
    }
    npc.addComponent(npcDropTable)
  }

  return npc
}

export function createWeapon(
  world: World,
  box2d: MainModule,
  worldId: b2WorldId,
  x: number,
  y: number,
  groundTopY: number,
  weaponType: WeaponType = 'sword',
  renderLayer = 0
): Entity {
  const entity = world.createEntity()

  // Use the passed y parameter for spawn height
  // Caller should ensure y is high enough to avoid obstacles

  const transform = new TransformComponent()
  transform.x = x
  transform.y = y
  entity.addComponent(transform)

  const template = WEAPON_DEFAULT_DATA[weaponType]
  const weaponStats = resolveWeaponStatsForSize(template, template.sizeLevel)
  const weapon = new WeaponComponent()
  weapon.renderLayer = renderLayer
  applyWeaponSizeLevel(weapon, template, template.sizeLevel)
  weapon.sizeMaxLevel = template.sizeMaxLevel
  weapon.cornerRadius = DEFAULT_WEAPON_CORNER_RADIUS
  weapon.weaponType = weaponType
  weapon.movesetId = getDefaultAttackMovesetIdForWeaponType(weaponType)
  weapon.attackDamage = weaponStats.attackDamage
  weapon.postureDamage = weaponStats.postureDamage
  weapon.toughnessDamage = weaponStats.toughnessDamage
  if (isRangedWeaponType(weaponType)) {
    weapon.bowAmmoMax = getDefaultPlayerAmmoForWeaponType(weaponType)
    weapon.bowAmmo = getDefaultPlayerAmmoForWeaponType(weaponType)
  }

  if (weaponType === 'hammer') {
    weapon.skillId = 'hammer_crit'
    weapon.skillCharges = DEFAULT_SKILL_MAX_CHARGES
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

  const render = new RenderComponent()
  render.radius = 0
  render.visible = true
  render.renderLayer = renderLayer
  entity.addComponent(render)

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
  shapeDef.filter.categoryBits = getWeaponCollisionCategory(renderLayer)
  shapeDef.filter.maskBits = getWeaponCollisionMask(renderLayer)
  physics.shapeId = b2CreateCircleShape(physics.bodyId, shapeDef, circle)

  entity.addComponent(physics)

  return entity
}
