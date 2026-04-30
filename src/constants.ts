// 初始跳跃力度（向上初速度）；可由控制面板调整
export const DEFAULT_JUMP_FORCE = 18

// 全局重力加速度（米/秒²）
export const DEFAULT_GRAVITY = 50

// 默认逻辑帧率（每秒帧数）
export const DEFAULT_FRAME_RATE = 60

// 初始跳跃预输入时间（毫秒）；运行时可被控制面板的设置覆盖
export const DEFAULT_JUMP_BUFFER_WINDOW = 500

// 按住跳跃键持续施力的最大时长（毫秒）
export const DEFAULT_MAX_JUMP_DURATION = 500

// 持续跳跃施加的力相对于初始跳跃力度的倍数
export const DEFAULT_JUMP_FORCE_MULTIPLIER = 0.8

// 蹬墙跳横向推离倍数（相对于移动速度）
export const DEFAULT_WALL_JUMP_PUSH_AWAY_MULTIPLIER = 0.5

// 蹬墙跳向上速度倍数（相对于初始跳跃力度）
export const DEFAULT_WALL_JUMP_UPWARD_MULTIPLIER = 0.8

// 角色基础重量（可理解为 kg，影响跳跃与下落）
export const DEFAULT_PLAYER_WEIGHT = 80

// 等级系统
export const PLAYER_MAX_LEVEL = 8
export const PLAYER_HEALTH_PER_LEVEL = 10
// 升到下一级所需经验（index 0 = level 1→2, index 6 = level 7→8）
// 增量规律：前3个固定10，之后每个增量 = 前所有增量之和
export const EXP_TABLE = [100, 110, 120, 130, 160, 220, 340]

// 角色生命与架势
export const DEFAULT_PLAYER_MAX_HEALTH = 20
export const DEFAULT_PLAYER_MAX_POSTURE = 10
export const DEFAULT_PLAYER_POSTURE_RECOVERY_PER_SEC = 3
export const DEFAULT_PLAYER_TOUGHNESS_RECOVERY_PER_SEC = 0.5
// 角色韧性
export const DEFAULT_PLAYER_MAX_TOUGHNESS = 6
export const DEFAULT_PLAYER_FOV_RAD = (160 * Math.PI) / 180
export const DEFAULT_SMALL_ENEMY_MAX_TOUGHNESS = 6
export const DEFAULT_LARGE_ENEMY_MAX_TOUGHNESS = 6
export const DEFAULT_CHECKPOINT_RENDER_RADIUS = 1
export const DEFAULT_CHECKPOINT_ACTIVATION_RADIUS = 1
export const CHECKPOINT_TREE_TOP_COLOR_INACTIVE = '#345A24'
export const CHECKPOINT_TREE_TRUNK_COLOR_INACTIVE = '#4A2F15'
export const CHECKPOINT_TREE_TOP_COLOR_ACTIVE = '#4FAE2F'
export const CHECKPOINT_TREE_TRUNK_COLOR_ACTIVE = '#7A4B1E'
export const GRAPPLE_ANCHOR_COLOR = '#c6b07a'
export const GRAPPLE_ANCHOR_BORDER_COLOR = '#6d5a3f'
export const FOLLOW_ICON_RENDER_MAX_SIZE = 30
export const FOLLOW_BOND_ICON_RENDER_WIDTH = FOLLOW_ICON_RENDER_MAX_SIZE
export const FOLLOW_BOND_ICON_RENDER_HEIGHT = 14
export const FOLLOW_UNBOND_ICON_RENDER_WIDTH = FOLLOW_ICON_RENDER_MAX_SIZE
export const FOLLOW_UNBOND_ICON_RENDER_HEIGHT = 28

// 调试开关
export const DEBUG_ANIMATION_SLOWDOWN = 1
export const DEBUG_DRAW_SENSORS = false
export const DEBUG_DRAW_SOUND = false
export const DEBUG_DRAW_CAMERA = false
export const DEBUG_DRAW_PLAYER_COLLISION_SHAPE = false
export const DEBUG_DRAW_TERRAIN_COLLISION_SHAPE = false
export const DEBUG_DRAW_BREAKABLE_CRATE_HEALTH = false
export const TERRAIN_COLLISION_DEBUG_COLOR = 0x4f7cff
export const TERRAIN_COLLISION_DEBUG_LINE_WIDTH = 2
export const TERRAIN_COLLISION_DEBUG_ALPHA = 0.92

// 武器默认伤害与削架势
export const DEFAULT_WEAPON_ATTACK_DAMAGE = 2
export const DEFAULT_WEAPON_POSTURE_DAMAGE = 6
export const DEFAULT_WEAPON_TOUGHNESS_DAMAGE = 3
export const JUMP_ATTACK_DAMAGE_SCALE_NUMERATOR = 6
export const JUMP_ATTACK_DAMAGE_SCALE_DENOMINATOR = 5

// 弹反机制
export const DEFAULT_PARRY_WINDOW_MS = 200
export const PARRY_ENEMY_POSTURE_DAMAGE = 10
export const PARRY_SELF_POSTURE_RECOVERY = 5
export const PARRY_COUNTER_WINDOW_MS = 500

// 崩塌机制
export const STAGGER_DURATION_MS = 3000
export const STAGGER_DAMAGE_MULTIPLIER = 4
export const STAGGER_KNOCKBACK_MULTIPLIER = 1
export const STAGGER_HIT_STUN_DURATION_MS = 500
export const WEAPON_DROP_DURATION_MS = 300

// 受击硬直
export const DEFAULT_HIT_STUN_DURATION_MS = 1000
export const HIT_STUN_LIGHT_MS = 500
export const HIT_STUN_MEDIUM_MS = DEFAULT_HIT_STUN_DURATION_MS
export const HIT_STUN_HEAVY_MS = 1500

// 冲击力等级对应的速度变化量（m/s），公式：velocity += finalKnockback * 2
// 地面摩擦减速约 40 m/s²，参考位移距离：medium≈0.45m, large≈1.8m, extreme≈5m
export const IMPACT_LEVEL_KNOCKBACK = {
  small: 0,
  medium: 3,
  large: 6,
  extreme: 10,
} as const

// 武器类型对应的默认冲击力等级
export const WEAPON_IMPACT_LEVEL = {
  bow: 'small',
  grape: 'small',
  hook: 'small',
  arrow: 'small',
  grapeShot: 'small',
  sword: 'medium',
  hammer: 'medium',
  spear: 'medium',
} as const

// 死亡动画（秒）
export const DEFAULT_DEATH_FLASH_DURATION = 0.3
export const DEFAULT_DEATH_FLATTEN_DURATION = 0.7
export const DEATH_PRE_SPLATTER_PAUSE_MS = 0
export const DEATH_CROSS_DURATION_MS = 500
// 与普通受击音效原始时长对齐
export const ASSASSINATION_SLOW_MOTION_DURATION_MS = 206
// 普通受击结束后追加一小段慢放停顿，给刺杀镜头回稳留缓冲
export const ASSASSINATION_SLOW_MOTION_POST_PAUSE_MS = 120

// 武器重量（可理解为 kg，角色装备后会叠加）
export const DEFAULT_WEAPON_WEIGHT = 2

// 计算跳跃衰减时的参考重量（不随配置变化，用于对比）
export const PLAYER_WEIGHT_REFERENCE = 100

// 每次离地后允许的最大蹬墙跳次数
export const DEFAULT_MAX_WALL_JUMPS = 1

// 角色左右移动速度
export const DEFAULT_MOVE_SPEED = 4
export const DEFAULT_SLOW_SPEED = DEFAULT_MOVE_SPEED / 2
export const SPRINT_SPEED_MULTIPLIER_NUMERATOR = 3
export const SPRINT_SPEED_MULTIPLIER_DENOMINATOR = 2
export const DEFAULT_SPRINT_SPEED =
  (DEFAULT_MOVE_SPEED * SPRINT_SPEED_MULTIPLIER_NUMERATOR) /
  SPRINT_SPEED_MULTIPLIER_DENOMINATOR
export const SPRINT_HOLD_THRESHOLD_MS = 200

export function getSlowSpeedFromMoveSpeed(moveSpeed: number): number {
  if (!(moveSpeed > 0) || !(DEFAULT_MOVE_SPEED > 0)) {
    return 0
  }
  return (moveSpeed * DEFAULT_SLOW_SPEED) / DEFAULT_MOVE_SPEED
}

export function getSprintSpeedFromMoveSpeed(moveSpeed: number): number {
  if (!(moveSpeed > 0) || !(SPRINT_SPEED_MULTIPLIER_DENOMINATOR > 0)) {
    return 0
  }
  return (
    (moveSpeed * SPRINT_SPEED_MULTIPLIER_NUMERATOR) /
    SPRINT_SPEED_MULTIPLIER_DENOMINATOR
  )
}

// 角色与其他物体接触时的摩擦力
export const DEFAULT_BODY_FRICTION = 0.8
// 贴墙滑落时的摩擦力（避免挂墙）
export const DEFAULT_WALL_SLIDE_FRICTION = 0

// 角色线性阻尼系数
export const DEFAULT_BODY_LINEAR_DAMPING = 0

// 地面摩擦力
export const DEFAULT_GROUND_FRICTION = 1

// 障碍物摩擦力
export const DEFAULT_OBSTACLE_FRICTION = 0

// 镜头初始缩放倍数
export const DEFAULT_CAMERA_ZOOM = 0.6

// 武器默认长度（米）
export const DEFAULT_WEAPON_WIDTH = 1.2

// 武器默认厚度（米）
export const DEFAULT_WEAPON_HEIGHT = 0.25

// 武器圆角半径（米）
export const DEFAULT_WEAPON_CORNER_RADIUS = 0.08

// 武器在地面上的初始旋转（弧度，负值代表向左倾斜）
export const DEFAULT_WEAPON_GROUND_ROTATION_RAD = (-25 * Math.PI) / 180

// 武器拾取判定距离（米）
export const DEFAULT_WEAPON_PICKUP_DISTANCE = 1.2
export const DEFAULT_GRAPPLE_ANCHOR_RENDER_RADIUS = 0.2
export const DEFAULT_GRAPPLE_RANGE = 8
export const DEFAULT_GRAPPLE_PULL_SPEED = 12
export const DEFAULT_GRAPPLE_PULL_DURATION_MS = 600
export const DEFAULT_GRAPPLE_PULL_STOP_DISTANCE = 0.4
export const DEFAULT_GRAPPLE_COOLDOWN_MS = 0
export const DEFAULT_GRAPPLE_MOVE_LOCK_MS = 450
export const DEFAULT_GRAPPLE_ENEMY_STUN_EXTRA_MS = 200
export const DEFAULT_GRAPPLE_ENEMY_COOLDOWN_MS = 800
export const GRAPPLE_LONG_PRESS_MS = 200
export const DEFAULT_GRAPPLE_TETHER_MIN_LENGTH = 1
export const DEFAULT_GRAPPLE_ROPE_SEGMENT_LENGTH = 0.1
export const DEFAULT_GRAPPLE_ROPE_SEGMENT_RADIUS = 0.04
export const DEFAULT_GRAPPLE_ROPE_MAX_SEGMENTS = 50
export const DEFAULT_GRAPPLE_ROPE_DENSITY = 30
export const DEFAULT_GRAPPLE_ROPE_LINEAR_DAMPING = 0.1
export const DEFAULT_GRAPPLE_ROPE_HERTZ = 110
export const DEFAULT_GRAPPLE_ROPE_DAMPING_RATIO = 0.5
export const GRAPPLE_ROPE_BREAK_STRETCH_NUMERATOR = 2
export const GRAPPLE_ROPE_BREAK_STRETCH_DENOMINATOR = 1
export const DEFAULT_GRAPPLE_SWING_FORCE = 2000
export const GRAPPLE_CLIMB_SPEED = 4
export const GRAPPLE_ANCHOR_HIGHLIGHT_SCALE = 1.25
export const GRAPPLE_ANCHOR_HIGHLIGHT_COLOR = '#ead9a6'
export const GRAPPLE_ANCHOR_HIGHLIGHT_BORDER_COLOR = '#a78953'

// 武器跟随玩家时的水平偏移量（米，乘以朝向后放在身后）
export const DEFAULT_WEAPON_FOLLOW_OFFSET_X = 0.7

// 武器跟随玩家时的垂直偏移量（米）
export const DEFAULT_WEAPON_FOLLOW_OFFSET_Y = -0.1

// 武器跟随时保持竖直的旋转角度（弧度）
export const DEFAULT_WEAPON_VERTICAL_ROTATION_RAD = -Math.PI / 2

// 武器在战斗状态下的默认前方偏移（米）
export const DEFAULT_WEAPON_FRONT_OFFSET_X = 0.7
export const DEFAULT_WEAPON_FRONT_OFFSET_Y = -0.1
export const DEFAULT_WEAPON_CENTER_OFFSET_X = 0

// 武器抬起到头顶时的垂直偏移量（米，负值向上）
export const DEFAULT_WEAPON_HEAD_OFFSET_Y = -1.0

// 攻击前摇/攻击/后摇时长（毫秒）
export const DEFAULT_WEAPON_ATTACK_WINDUP_MS = 300
export const DEFAULT_WEAPON_ATTACK_SWING_MS = 140
export const DEFAULT_WEAPON_ATTACK_RECOVER_MS = 200
export const DEFAULT_WEAPON_ATTACK_PAUSE_MS = 250
export const DEFAULT_WEAPON_FINAL_WINDUP_MS = 150
export const THRUST_WEAPON_ATTACK_WINDUP_MS = 400
export const THRUST_WEAPON_FINAL_WINDUP_MS = 250
export const DEFAULT_WEAPON_MIN_ATTACK_INTERVAL_MS = 250 // 最小攻击间隔，防止快速连点

// 弓箭参数
export const BOW_MAX_DRAW_MS = 900
export const BOW_MIN_WINDUP_MS = 400
export const BOW_MIN_FORCE_RATIO = 0.6
export const BOW_MIN_SPEED = 10
export const BOW_MAX_SPEED = 22
export const BOW_RECOVER_MS = 360
export const BOW_GRAVITY_SCALE = 0.5
export const BOW_FREE_AIM_TURN_SPEED = 1.0
export const BOW_FREE_AIM_MAX_OFFSET = Math.PI * 0.45

export const GRAPE_MIN_WINDUP_MS = 400
export const GRAPE_MIN_FORCE_RATIO = 0.35
export const GRAPE_MIN_SPEED = 9
export const GRAPE_MAX_SPEED = 21
export const GRAPE_RECOVER_MS = 220
export const GRAPE_GRAVITY_SCALE = 0.6
export const GRAPE_PROJECTILE_DENSITY = 0.22
export const GRAPE_PROJECTILE_RESTITUTION = 0.12
export const GRAPE_PROJECTILE_RADIUS = 0.16
export const GRAPE_PROJECTILE_LIFETIME_MS = 2200

// 攻击挥舞半径（米）
export const DEFAULT_WEAPON_ATTACK_RADIUS = 0.9

// 武器与玩家之间预留的安全距离（米），用于攻击时保持分离
export const DEFAULT_WEAPON_PLAYER_CLEARANCE = 0.1

// 角色半径（米），用于与武器距离计算
export const DEFAULT_PLAYER_RADIUS = 0.5

// 战斗状态超时时长（毫秒）
export const DEFAULT_WEAPON_COMBAT_TIMEOUT_MS = 30000

// 敌人AI参数
export const DEFAULT_ENEMY_ATTACK_DESIRE = 10
export const DEFAULT_ENEMY_MOVE_SPEED = 3
export const ENEMY_DETECTION_RANGE = 10
export const ENEMY_DETECTION_RANGE_MULTIPLIERS = {
  near: 1,
  medium: 2,
  far: 3,
} as const
export const ENEMY_ATTACK_RANGE_BUFFER = 0.35
export const ENEMY_PACE_SWITCH_INTERVAL_MS = 3000
export const ENEMY_DECISION_COOLDOWN_MS = 90
export const ENEMY_PACE_PAUSE_MS = 1200
export const ENEMY_PACE_MIN_SWITCH_INTERVAL_MS = 800
export const ENEMY_PACE_MIN_PAUSE_MS = 300
export const ENEMY_PACE_MIN_DISTANCE = 0.4
export const ENEMY_ALERT_DURATION_MS = 10000
export const ENEMY_ALERT_RANGE_MULTIPLIER = 1.5
export const ENEMY_ALERT_ACCEL_RANGE_MULTIPLIER = 1.25
export const ENEMY_ALERT_PACE_SPEED_MULTIPLIER = 0.35
export const ENEMY_RETREAT_EXTRA_DISTANCE = 1
export const ENEMY_PROBE_DISTANCE_MULTIPLIER = 3
export const ENEMY_PROBE_CHASE_DURATION_MS = 4000
export const ENEMY_PROBE_DURATION_MIN_MS = 5000
export const ENEMY_PROBE_DURATION_MAX_MS = 10000
export const ENEMY_PROBE_PACE_SWITCH_INTERVAL_MS = 700
export const ENEMY_PROBE_RANGE_BUFFER_RATIO = 0.2
export const ENEMY_PROBE_PACE_MIN_DISTANCE = 0.4
export const ENEMY_LEAP_ATTACK_CHANCE = 0.9
export const ENEMY_LEAP_ATTACK_MIN_DISTANCE_MULTIPLIER = 2.5
export const ENEMY_LEAP_ATTACK_MAX_DISTANCE_MULTIPLIER = 6
export const ENEMY_LEAP_ATTACK_COOLDOWN_MS = 5000
export const ENEMY_LEAP_ATTACK_MAX_DURATION_MS = 1500
export const ENEMY_HEARING_RANGE_MULTIPLIER = 0.5
export const NPC_INITIAL_SOUND_DEAF_MS = 3000

// 追随系统参数
export const FOLLOW_PREFERRED_DISTANCE = 2
export const FOLLOW_MIN_DISTANCE = 1
export const FOLLOW_MAX_DISTANCE = 6
export const FOLLOW_BLOCK_CHECK_DISTANCE = 2
export const FOLLOW_RETREAT_HYSTERESIS = 0.4
// waiting 状态需要距离超过此值才重新开始追随（避免在 preferredDistance 边界反复切换）
export const FOLLOW_APPROACH_HYSTERESIS = 0.8
export const FOLLOW_STUCK_THRESHOLD_MS = 500
export const FOLLOW_POSITION_CHECK_INTERVAL_MS = 300
export const FOLLOW_INTERACTION_RANGE = 3

// 脚步声参数
export const FOOTSTEP_INTERVAL_MS = 320
export const FOOTSTEP_WAVE_SPEED = 6
export const FOOTSTEP_WAVE_DISTANCE_MULTIPLIER = 4
export const FOOTSTEP_SOUND_DB = 1
export const FOOTSTEP_MIN_MOVE_SPEED = 0.1
export const LANDING_MIN_VELOCITY = 1.2
export const SOUND_RANGE_MULTIPLIER_WALK = 1
export const SOUND_RANGE_MULTIPLIER_SPRINT = 2
export const SOUND_RANGE_MULTIPLIER_WEAPON = SOUND_RANGE_MULTIPLIER_SPRINT * 3
export const SOUND_RANGE_MULTIPLIER_MASSIVE = SOUND_RANGE_MULTIPLIER_SPRINT * 5

// 跌落伤害参数
// 实际计算使用动能：E = 0.5 * m * v^2（m为有效重量，v为最大下落速度）
// 伤害：damage = (E - threshold) / divisor；E >= fatal 时直接致命
// 若按自由落体估算：v^2 = 2 * g * h，则 E = m * g * h（g=50）
export const FALL_DAMAGE_KINETIC_THRESHOLD = 42000 // 动能阈值，超过开始计伤
export const FALL_DAMAGE_KINETIC_FATAL = 100000 // 致命动能阈值
export const FALL_DAMAGE_KINETIC_TO_HEALTH_DIVISOR = 2000 // 动能转伤害除数（数值越大伤害越低）

// 碰撞/攻击声音分贝
export const SOUND_DB_LAND = 1
export const SOUND_DB_SWORD_SWING = 0.8
export const SOUND_DB_SWORD_HIT_OBSTACLE = 1.2
export const SOUND_DB_SWORD_BLOCK = 1
export const SOUND_DB_BODY_HIT = 1.1
export const SOUND_DB_PARRY = 1.6
export const SOUND_DB_BOW_SNAP = 0.9
export const SOUND_DB_HEAVY_SWORD_HIT_GROUND = 1.3
export const SOUND_DB_BIG_HAMMER_HIT_ROCK = 1.4

// 敌人模板配置
export const CHARACTER_DEFAULT_DATA = {
  default: {
    moveSpeed: 3.5,
    radius: 0.5,
    attackDesire: 80,
    color: '#b5835a',
    parryProficiency: 0,
    initialPatrolMode: 'patrol',
    maxHealth: 20,
    maxPosture: 10,
    maxToughness: 6,
  },
  archer: {
    moveSpeed: 3.5,
    radius: 0.5,
    attackDesire: 30,
    color: '#b5835a',
    parryProficiency: 0,
    initialPatrolMode: 'guard',
    maxHealth: 20,
    maxPosture: 10,
    maxToughness: 6,
  },
  caterpillar: {
    moveSpeed: 1.5,
    radius: 0.35,
    attackDesire: 0,
    color: '#4a7c2f',
    parryProficiency: 0,
    initialPatrolMode: 'patrol',
    maxHealth: 10,
    maxPosture: 5,
    maxToughness: 3,
  },
} as const

export const CATERPILLAR_SPINE_KEY = 'caterpillar_ske'
export const CATERPILLAR_ATLAS_KEY = 'caterpillar_atlas'
export const CATERPILLAR_ANIMATION_NAME = 'maomaochong'
export const CATERPILLAR_SPINE_SCALE = 0.3

export const ENEMY_SPAWNS = {
  left: {
    type: 'default',
    x: -40.5,
    yOffset: -0.6,
  },
  default: {
    type: 'default',
    x: 0,
    yOffset: -0.6,
  },
  large: {
    type: 'large',
    x: 14.5,
    yOffset: -0.6,
  },
  fast: {
    type: 'fast',
    x: 24,
    yOffset: -0.6,
  },
} as const

export const ARCHER_SPAWN_CONFIG = {
  type: 'archer',
  obstacleX: -9.5,
  obstacleHalfWidth: 1.2,
  obstacleHalfHeight: 2.8,
  edgeOffset: 0.8,
  yOffsetFromTop: -0.6,
} as const

// 受击振动效果
export const DEFAULT_HIT_SHAKE_DURATION_MS = 150
export const DEFAULT_HIT_SHAKE_INTENSITY = 0.3

// 翻滚参数
export const DEFAULT_ROLL_DURATION = 500
export const DEFAULT_ROLL_SPEED = 6
export const DEFAULT_ROLL_COOLDOWN = 200

// 后跳闪避参数
export const DEFAULT_BACKSTEP_HORIZONTAL_IMPULSE = 10
export const DEFAULT_BACKSTEP_VERTICAL_IMPULSE = 6
export const DEFAULT_BACKSTEP_DURATION = 350

// NPC后跳参数
export const NPC_BACKSTEP_BASE_CHANCE = 10
export const NPC_BACKSTEP_MAX_CHANCE = 60
export const NPC_BACKSTEP_MAX_COUNT = 2

// 碰撞分类
export const CATEGORY_GROUND = 0x0001
export const CATEGORY_PLAYER = 0x0002
export const CATEGORY_ENEMY = 0x0004
export const CATEGORY_OBSTACLE = 0x0008
export const CATEGORY_WEAPON = 0x0010
export const CATEGORY_ROPE = 0x0020

export const MASK_PLAYER = 0xffff
export const MASK_PLAYER_ROLLING = 0xffff & ~CATEGORY_ENEMY
export const MASK_ENEMY = 0xffff
export const MASK_WEAPON = CATEGORY_GROUND | CATEGORY_OBSTACLE
export const MASK_ROPE = CATEGORY_OBSTACLE | CATEGORY_ENEMY

export const DEFAULT_BOW_AMMO_PLAYER = 20
export const DEFAULT_BOW_AMMO_ENEMY = 50
export const DEFAULT_GRAPE_AMMO_PLAYER = 100
export const DEFAULT_GRAPE_AMMO_ENEMY = 100
export const DEFAULT_BOMB_AMMO_PLAYER = 3
export const DEFAULT_BOMB_AMMO_ENEMY = 3

// 武器模板配置
// 武器基础数值规则：
// - 攻击力：从最小尺寸开始，每大一个尺寸等级 ×1.8（约 +80%）
// - 削架势、削韧：仍按基准尺寸每级 ×1.2 / ×0.8
export const WEAPON_DEFAULT_DATA = {
  sword: {
    width: 1.2,
    height: 0.25,
    sizeLevel: 2,
    sizeMaxLevel: 4,
    weight: 2,
    attackDamage: 2.5,
    postureDamage: 6,
    toughnessDamage: 2.5,
  },
  spear: {
    width: 4.0,
    height: 0.08333333333333333,
    sizeLevel: 1,
    sizeMaxLevel: 1,
    weight: 3,
    attackDamage: 1.5,
    postureDamage: 7,
    toughnessDamage: 2.5,
  },
  hammer: {
    width: 1.1,
    height: 0.45,
    sizeLevel: 1,
    sizeMaxLevel: 2,
    weight: 3,
    attackDamage: 2,
    postureDamage: 8,
    toughnessDamage: 4,
  },
  bow: {
    width: 1.2,
    height: 0.2,
    sizeLevel: 1,
    sizeMaxLevel: 2,
    weight: 1.5,
    attackDamage: 1.5,
    postureDamage: 3,
    toughnessDamage: 1,
  },
  grape: {
    width: 0.95,
    height: 0.95,
    sizeLevel: 1,
    sizeMaxLevel: 1,
    weight: 2,
    attackDamage: 3,
    postureDamage: 3,
    toughnessDamage: 2,
  },
  hook: {
    width: 0.8,
    height: 0.8,
    sizeLevel: 1,
    sizeMaxLevel: 1,
    weight: 1,
    attackDamage: 0,
    postureDamage: 0,
    toughnessDamage: 0,
  },
  bomb: {
    width: 0.72,
    height: 0.72,
    sizeLevel: 1,
    sizeMaxLevel: 1,
    weight: 2,
    attackDamage: 0,
    postureDamage: 0,
    toughnessDamage: 0,
  },
} as const

// 出手韧性公式：floor(受击前韧性 × sizeLevel × N / (baseLevel × D))
// 以韧性=6、普通剑削韧=3为基准：
//   普通剑(level2/2) T=4 → floor(4×2×3/8)=3 被打断
//   大剑(level3/2) T=3.9 → floor(3.9×3×3/8)≈4 不被打断
export const ATTACK_TOUGHNESS_NUMERATOR = 3
export const ATTACK_TOUGHNESS_DENOMINATOR = 4
