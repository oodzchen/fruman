// 初始跳跃力度（向上初速度）；可由控制面板调整
export const DEFAULT_JUMP_FORCE = 22

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
