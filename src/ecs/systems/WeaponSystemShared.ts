import {
  DEFAULT_FRAME_RATE,
  DEFAULT_PARRY_WINDOW_MS,
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_WEAPON_PLAYER_CLEARANCE,
  GRAPE_GRAVITY_SCALE,
  WEAPON_DEFAULT_DATA,
} from '../../constants'
import type {
  TerrainMaterialId,
  TerrainMaterialTag,
} from '../../terrain/TerrainTypes'
import type { WeaponVisualType, b2BodyId } from '../../types'
import { resolveWeaponStatsForSize } from '../../weaponTypeUtils'
import type { ImpactLevel } from '../AttackMoveData'
import { WeaponComponent } from '../Component'
import type { Entity } from '../Entity'

export function getBodyHalfHeight(
  render: { radius?: number; bodyHeight?: number } | undefined,
  radius: number
): number {
  const bh = render?.bodyHeight ?? 0
  return bh > 0 ? bh / 2 : radius
}

export const BLOCK_VERTICAL_SCALE = 0.5
export const REBOUND_PAUSE_MS = 150
export const PARRY_WINDOW_FRAMES =
  (DEFAULT_PARRY_WINDOW_MS * DEFAULT_FRAME_RATE) / 1000
export const PARRY_ACTIVE_START_FRAME = PARRY_WINDOW_FRAMES * 0.5
export const BIG_HAMMER_SIZE_LEVEL = 2
export const GREAT_SWORD_SIZE_LEVEL = 3
export const GIANT_SWORD_SIZE_LEVEL = 4
export const BIG_HAMMER_JUMP_SHAKE_INTENSITY_PX = 14
export const BIG_HAMMER_JUMP_SHAKE_DURATION_MS = 180
export const GIANT_SWORD_JUMP_SHAKE_INTENSITY_PX = 11
export const GIANT_SWORD_JUMP_SHAKE_DURATION_MS = 160
export const BIG_HAMMER_FINISHER_SHAKE_INTENSITY_PX = 16
export const BIG_HAMMER_FINISHER_SHAKE_DURATION_MS = 210
export const GIANT_SWORD_FINISHER_SHAKE_INTENSITY_PX = 13
export const GIANT_SWORD_FINISHER_SHAKE_DURATION_MS = 190
export const DEFAULT_PROJECTILE_DENSITY = 0.1
export const DEFAULT_PROJECTILE_RESTITUTION = 0.4
export const DEFAULT_PROJECTILE_LIFETIME_MS = 2500
export const BOMB_FUSE_MS = 3000
export const BOMB_THROW_WINDUP_MS = 200
export const BOMB_THROW_FREE_SPEED = 18
export const BOMB_THROW_LOCKED_MIN_SPEED = 14
export const BOMB_THROW_LOCKED_MAX_SPEED = 28
export const BOMB_THROW_LOCKED_SPEED_PER_METER = 4
export const BOMB_THROW_GRAVITY_SCALE = GRAPE_GRAVITY_SCALE
export const BOMB_THROW_WINDUP_BACK_OFFSET = 0.2
export const BOMB_THROW_WINDUP_DOWN_OFFSET = 0.12
export const BOMB_THROW_WINDUP_ROTATION_RAD = Math.PI / 18
export const BOMB_PROJECTILE_LINEAR_DAMPING = 0.08
export const BOMB_PROJECTILE_DENSITY = 2
export const BOMB_PROJECTILE_FRICTION = 0.85
export const BOMB_PROJECTILE_RESTITUTION = 0.08
export const BOMB_PROJECTILE_RADIUS_SCALE_NUMERATOR = 3
export const BOMB_PROJECTILE_RADIUS_SCALE_DENOMINATOR = 10
export const BOMB_CAMERA_SHAKE_INTENSITY_PX = 18
export const BOMB_CAMERA_SHAKE_DURATION_MS = 280
export const BOMB_TERRAIN_IMPACT_POWER = 22
export const DEATH_WEAPON_DROP_CHANCE_DENOMINATOR = 2
export const HAMMER_CRIT_WINDUP_MS = 600
export const HAMMER_CRIT_SWING_MS = 300
export const HAMMER_CRIT_RECOVER_MS = 350
export const STAGGER_DROP_SETTLE_MIN_TIME = 0.1
export const STAGGER_DROP_SETTLE_SPEED_SQ = 0.01
export const ASSASSINATION_FIXED_RANGE =
  DEFAULT_PLAYER_RADIUS +
  WEAPON_DEFAULT_DATA.sword.width / 2 +
  DEFAULT_WEAPON_PLAYER_CLEARANCE
export const ASSASSINATION_WINDUP_MS = 240
export const ASSASSINATION_STRIKE_MS = 260
export const ASSASSINATION_RECOVER_MS = 240
export const ASSASSINATION_TOTAL_DURATION_MS =
  ASSASSINATION_WINDUP_MS + ASSASSINATION_STRIKE_MS + ASSASSINATION_RECOVER_MS
export const ASSASSINATION_THRUST_ANGLE_RAD = Math.PI / 6
export const ASSASSINATION_SOUND_PLAYBACK_RATE = 250 / 1000
export const ASSASSINATION_DEATH_SOUND_PLAYBACK_RATE = 1
export const ASSASSINATION_CAMERA_SHAKE_INTENSITY_PX = 9
export const ASSASSINATION_CAMERA_SHAKE_DURATION_MS = 160
export const TERRAIN_DEBRIS_HIT_IMPULSE_SMALL1000 = 3500
export const TERRAIN_DEBRIS_HIT_IMPULSE_MEDIUM1000 = 6500
export const TERRAIN_DEBRIS_HIT_IMPULSE_LARGE1000 = 10000
export const TERRAIN_DEBRIS_HIT_IMPULSE_EXTREME1000 = 15000
export const TERRAIN_DEBRIS_HIT_LIFT_SMALL1000 = 1500
export const TERRAIN_DEBRIS_HIT_LIFT_MEDIUM1000 = 3500
export const TERRAIN_DEBRIS_HIT_LIFT_LARGE1000 = 5500
export const TERRAIN_DEBRIS_HIT_LIFT_EXTREME1000 = 8500
export const TERRAIN_DEBRIS_HIT_ANGULAR_SMALL1000 = 500
export const TERRAIN_DEBRIS_HIT_ANGULAR_MEDIUM1000 = 1200
export const TERRAIN_DEBRIS_HIT_ANGULAR_LARGE1000 = 2200
export const TERRAIN_DEBRIS_HIT_ANGULAR_EXTREME1000 = 3600

export const BOMB_ULTIMATE_STATS = resolveWeaponStatsForSize(
  WEAPON_DEFAULT_DATA.hammer,
  WEAPON_DEFAULT_DATA.hammer.sizeMaxLevel
)

export type ObstacleCollider = {
  bodyId: b2BodyId
  centerX: number
  centerY: number
  width: number
  height: number
  rotationRad?: number
  renderLayer: number
  materialId?: TerrainMaterialId
  materialTag: TerrainMaterialTag
  breakableId?: number
  breakableHitProxy?: boolean
  vertices?: { x: number; y: number }[]
  worldVertices?: { x: number; y: number }[]
  radius?: number
}

export interface BreakableObstacleHit {
  attacker?: Entity
  weapon?: WeaponComponent
  obstacle: ObstacleCollider
  impactLevel: ImpactLevel
  impactX: number
  impactY: number
}

export type WeaponDropData = {
  weaponType: WeaponVisualType
  movesetId: string
  width: number
  height: number
  baseWidth: number
  sizeLevel: number
  sizeMaxLevel: number
  cornerRadius: number
  weight: number
  attackDamage: number
  postureDamage: number
  toughnessDamage: number
  bowAmmo: number
  bowAmmoMax: number
  skillId: string
}
