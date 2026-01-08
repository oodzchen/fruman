// 初始跳跃力度（向上初速度）；可由控制面板调整
export const DEFAULT_JUMP_FORCE = 22

// 全局重力加速度（米/秒²）
export const DEFAULT_GRAVITY = 50

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

// 角色生命与韧性
export const DEFAULT_PLAYER_MAX_HEALTH = 100
export const DEFAULT_PLAYER_MAX_TOUGHNESS = 20
export const DEFAULT_PLAYER_TOUGHNESS_RECOVERY_PER_SEC = 1

// 武器默认伤害与削韧
export const DEFAULT_WEAPON_ATTACK_DAMAGE = 10
export const DEFAULT_WEAPON_TOUGHNESS_DAMAGE = 2

// 死亡动画（秒）
export const DEFAULT_DEATH_FLASH_DURATION = 0.3
export const DEFAULT_DEATH_FLATTEN_DURATION = 0.7

// 武器重量（可理解为 kg，角色装备后会叠加）
export const DEFAULT_WEAPON_WEIGHT = 2

// 计算跳跃衰减时的参考重量（不随配置变化，用于对比）
export const PLAYER_WEIGHT_REFERENCE = 100

// 每次离地后允许的最大蹬墙跳次数
export const DEFAULT_MAX_WALL_JUMPS = 1

// 角色左右移动速度
export const DEFAULT_MOVE_SPEED = 4

// 角色与其他物体接触时的摩擦力
export const DEFAULT_BODY_FRICTION = 0

// 角色线性阻尼系数
export const DEFAULT_BODY_LINEAR_DAMPING = 0

// 地面摩擦力
export const DEFAULT_GROUND_FRICTION = 1

// 障碍物摩擦力
export const DEFAULT_OBSTACLE_FRICTION = 0

// 镜头初始缩放倍数
export const DEFAULT_CAMERA_ZOOM = 1

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
export const DEFAULT_WEAPON_ATTACK_WINDUP_MS = 200
export const DEFAULT_WEAPON_ATTACK_SWING_MS = 140
export const DEFAULT_WEAPON_ATTACK_RECOVER_MS = 200
export const DEFAULT_WEAPON_ATTACK_PAUSE_MS = 500
export const DEFAULT_WEAPON_FINAL_WINDUP_MS = 100

// 攻击挥舞半径（米）
export const DEFAULT_WEAPON_ATTACK_RADIUS = 0.9

// 武器与玩家之间预留的安全距离（米），用于攻击时保持分离
export const DEFAULT_WEAPON_PLAYER_CLEARANCE = 0.1

// 角色半径（米），用于与武器距离计算
export const DEFAULT_PLAYER_RADIUS = 0.5

// 战斗状态超时时长（毫秒）
export const DEFAULT_WEAPON_COMBAT_TIMEOUT_MS = 30000

// 敌人AI参数
export const DEFAULT_ENEMY_ATTACK_DESIRE = 0
export const DEFAULT_ENEMY_MOVE_SPEED = 3
export const ENEMY_DETECTION_RANGE = 10
export const ENEMY_ATTACK_RANGE_BUFFER = 0.35
export const ENEMY_PACE_SWITCH_INTERVAL_MS = 1800
export const ENEMY_DECISION_COOLDOWN_MS = 90
export const ENEMY_PACE_PAUSE_MS = 700
export const ENEMY_RETREAT_EXTRA_DISTANCE = 1
