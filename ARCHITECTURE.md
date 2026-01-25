# ECS + Worker 多线程游戏架构文档

## 项目概述

基于 ECS（Entity-Component-System） 和 Web Worker 多线程 架构的 2D 物理游戏引擎，已实现：

- 多角色实例（玩家、NPC、敌人）
- 动作模组可替换（配置时+运行时）
- 阵营系统（敌友判定）
- 高性能优化（目标：100+角色@60 FPS）
- Worker 多线程架构（逻辑与渲染分离）
- Binary Protocol 零拷贝通信

---

## 核心架构设计

### ECS三要素

**Entity（实体）**

- 轻量级ID容器，持有组件Map
- 使用位掩码signature加速组件匹配
- 缓存常用组件（Transform, Physics, Combat）

**Component（组件）** - 12个已实现

```
TransformComponent      - 位置、旋转、缩放
PhysicsComponent        - Box2D物理体、速度缓存
MovementComponent       - 移动速度、跳跃参数、接地状态
InputComponent          - 输入状态、InputBuffer
EnemyAIComponent        - AI状态机、巡逻点、目标、感知系统
StatsComponent          - 血量、韧性、姿态、跌落伤害
WeaponComponent         - 武器类型、攻击状态、连击
WeaponSlotsComponent    - 多武器槽、切换系统
ArrowComponent          - 箭矢属性、生命周期
RenderComponent         - 渲染类型、颜色、可见性
FactionComponent        - 阵营枚举、敌友判定逻辑
SensorComponent         - 感知传感器（听觉、视觉）
```

**System（系统）** - 9个已实现

Worker线程中的更新顺序：

```
1. PhysicsSystem      - Box2D世界步进（60Hz固定时间步）
2. MovementSystem     - 处理移动、跳跃、蹬墙跳
3. EnemyAISystem      - AI决策生成输入（节流200ms）
4. TargetingSystem    - 目标锁定和追踪
5. WeaponSystem       - 武器状态机、连击系统
6. ArrowSystem        - 箭矢飞行和碰撞检测
7. StatsSystem        - 属性系统、伤害计算
8. SoundSystem        - 音效事件队列
9. InteractionSystem  - 实体交互系统
```

主线程渲染：

```
ClientRenderer        - Canvas 2D渲染、相机跟随、视锥剔除
```

---

## 多线程架构

### 线程分工

**主线程（Main Thread）**

- 职责：用户输入、Canvas渲染、音频播放、UI管理
- 核心类：
  - GameClient.ts - 游戏客户端总控
  - ClientRenderer.ts - Canvas 2D渲染器
  - AudioManager.ts - Web Audio API音效管理
  - MenuManager.ts - 菜单系统

**工作线程（Worker Thread）**

- 职责：游戏逻辑、物理模拟、ECS系统更新
- 核心文件：worker/gameWorker.ts
- 包含：ECS World、Box2D物理引擎、所有游戏系统

### 通信协议

**Binary Protocol**（binaryProtocol.ts）

- 高性能二进制状态同步
- 使用 SharedArrayBuffer（支持时）或 Float32Array
- 每帧同步实体状态（位置、旋转、血量、武器状态等）
- 支持最多 MAX_ENTITIES 个实体

**Effects Protocol**（effectsProtocol.ts）

- 视觉特效队列（粒子、火花等）
- 独立的效果缓冲区

**消息协议**（protocol.ts）

- 输入消息（键盘、鼠标）
- 调试消息（摄像机、传感器等）
- 控制消息（启动、停止、重启）

---

## 性能优化策略

### 1. 空间分区（SpatialHash）

- 网格大小：可配置
- 用途：AI目标查询、攻击范围检测
- 性能：O(n²) → O(1)

### 2. 对象池（ArrowPools）

- 箭矢对象池
- 避免频繁GC

### 3. 视锥剔除

- ClientRenderer中实现
- 只渲染屏幕内可见entity

### 4. AI节流

- 决策间隔：200ms（而非每帧16ms）
- 降低AI计算开销

### 5. 组件缓存

- Entity内缓存常用组件
- 避免频繁Map查询

### 6. 零拷贝通信

- SharedArrayBuffer主线程和Worker共享内存
- 避免数据序列化开销

---

## 文件结构（实际实现）

```
src/
├── ecs/                             # ECS核心模块
│   ├── Entity.ts                    # Entity基类（ID容器+组件管理）
│   ├── Component.ts                 # 12个组件定义
│   ├── System.ts                    # System基类
│   ├── World.ts                     # ECS世界管理器
│   ├── EntityManager.ts             # Entity生命周期管理
│   ├── EntityComponentPool.ts       # 组件对象池
│   ├── ComponentRegistry.ts         # 组件类型注册（位掩码）
│   ├── ObjectPool.ts                # 通用对象池
│   ├── ArrowPools.ts                # 箭矢专用对象池
│   ├── SpatialHash.ts               # 空间分区索引
│   │
│   ├── systems/                     # 9个游戏系统
│   │   ├── PhysicsSystem.ts
│   │   ├── MovementSystem.ts
│   │   ├── EnemyAISystem.ts
│   │   ├── TargetingSystem.ts
│   │   ├── WeaponSystem.ts
│   │   ├── ArrowSystem.ts
│   │   ├── StatsSystem.ts
│   │   ├── SoundSystem.ts
│   │   └── InteractionSystem.ts
│   │
│   └── factories/
│       └── PlayerFactory.ts         # 玩家entity工厂
│
├── worker/                          # Worker线程模块
│   ├── gameWorker.ts                # Worker入口（ECS World + Box2D）
│   ├── protocol.ts                  # 消息协议定义
│   ├── binaryProtocol.ts            # 二进制状态同步协议
│   └── effectsProtocol.ts           # 特效队列协议
│
├── GameClient.ts                    # 主线程游戏客户端
├── ClientRenderer.ts                # Canvas 2D渲染器
├── AudioManager.ts                  # 音频管理器
├── MenuManager.ts                   # 菜单系统
├── InitializationManager.ts         # 初始化管理
├── BowTrajectory.ts                 # 弓箭轨迹预测
├── ParticleSystem.ts                # 粒子系统
├── InputBuffer.ts                   # 输入缓冲
├── Localizer.ts                     # 国际化
├── storage.ts                       # 本地存储
├── constants.ts                     # 游戏常量
├── types.ts                         # 类型定义
├── main.ts                          # 入口文件
└── vite-env.d.ts                    # Vite类型声明

lang/
├── zh-Hans.json                     # 简体中文
└── en.json                          # 英文

public/audios/                       # 音效资源（7个WAV文件）
```

---

## 实施状态

### 阶段1：ECS基础框架 - 已完成

- [x] `src/ecs/Entity.ts` - Entity容器
- [x] `src/ecs/Component.ts` - 12个组件定义
- [x] `src/ecs/System.ts` - System基类
- [x] `src/ecs/ComponentRegistry.ts` - 位掩码注册表
- [x] `src/ecs/EntityManager.ts` - Entity生命周期管理
- [x] `src/ecs/World.ts` - ECS世界管理器
- [x] `src/ecs/ObjectPool.ts` - 通用对象池
- [x] `src/ecs/ArrowPools.ts` - 箭矢对象池
- [x] `src/ecs/EntityComponentPool.ts` - 组件对象池
- [x] `src/ecs/SpatialHash.ts` - 空间分区

### 阶段2：核心Systems - 已完成

- [x] `src/ecs/systems/PhysicsSystem.ts` - Box2D物理模拟
- [x] `src/ecs/systems/MovementSystem.ts` - 移动、跳跃、蹬墙跳

### 阶段3：战斗和AI - 已完成

- [x] `src/ecs/systems/WeaponSystem.ts` - 武器状态机、连击系统
- [x] `src/ecs/systems/ArrowSystem.ts` - 箭矢系统（替代ProjectileSystem）
- [x] `src/ecs/systems/StatsSystem.ts` - 属性系统、伤害计算（替代CombatSystem）
- [x] `src/ecs/systems/EnemyAISystem.ts` - 敌人AI状态机
- [x] `src/ecs/systems/TargetingSystem.ts` - 目标锁定系统

### 阶段4：附加系统 - 已完成

- [x] `src/ecs/systems/SoundSystem.ts` - 音效事件系统
- [x] `src/ecs/systems/InteractionSystem.ts` - 交互系统
- [x] `src/ecs/factories/PlayerFactory.ts` - 玩家工厂

### 阶段5：多线程架构集成 - 已完成

- [x] `src/worker/gameWorker.ts` - Worker线程游戏逻辑
- [x] `src/worker/protocol.ts` - 消息协议
- [x] `src/worker/binaryProtocol.ts` - 二进制状态同步
- [x] `src/worker/effectsProtocol.ts` - 特效协议
- [x] `src/GameClient.ts` - 主线程客户端
- [x] `src/ClientRenderer.ts` - Canvas渲染器
- [x] `src/main.ts` - 入口集成

### 待完成功能

#### 性能测试

- [ ] 压力测试：100个敌人同屏
- [ ] 监控帧率和性能基准
- [ ] 性能优化迭代

#### 工厂标准化

- [ ] `src/ecs/factories/EnemyFactory.ts` - 标准化敌人创建
- [ ] `src/ecs/factories/ArrowFactory.ts` - 标准化箭矢创建

#### 功能扩展

- [ ] 运行时组件添加/移除测试
- [ ] 更多敌人类型
- [ ] 更多武器类型

---

## 关键技术细节

### 移动系统（MovementSystem）

#### 移动逻辑

```typescript
// 水平移动
const velocity = new b2Vec2(direction * moveSpeed, velocityY)
b2Body_SetLinearVelocity(bodyId, velocity)
```

#### 跳跃逻辑

```typescript
// 支持普通跳跃和蹬墙跳
if (蹬墙跳) {
  const pushAwaySpeed = -wallDirection * moveSpeed * wallJumpPushAwayMultiplier
  const upwardSpeed = -jumpForce * wallJumpUpwardMultiplier
  b2Body_SetLinearVelocity(bodyId, new b2Vec2(pushAwaySpeed, upwardSpeed))
} else if (接地) {
  const impulse = new b2Vec2(0, -jumpForce * mass * impulseMultiplier)
  b2Body_ApplyLinearImpulseToCenter(bodyId, impulse, true)
}
```

#### 接触检测

```typescript
// 使用Box2D接触数据判断接地和墙壁接触
const contactData = b2Body_GetContactData(bodyId, capacity)
for (contact of contactData) {
  if (abs(normal.y) > 0.7) grounded = true
  if (abs(normal.x) > 0.7) touchingWall = true
}
```

### 武器系统（WeaponSystem）

#### 武器状态机

```typescript
攻击阶段：
  idle → windup → swing → pause → recover → idle
连击逻辑：
  在pause阶段按攻击键 → 跳过recover进入下一段
  最多5段连击
```

#### 攻击判定

```typescript
// StatsSystem中使用SpatialHash查询范围内的敌人
const nearbyEntities = spatialHash.query(attackX - radius, attackY - radius, ...)
for (target of nearbyEntities) {
  if (距离 < attackRadius && canAttackFaction(attacker, target)) {
    applyDamage(target, damage)
  }
}
```

### Binary Protocol通信

#### 状态同步

```typescript
// Worker写入状态到SharedArrayBuffer
stateBuffer[entityOffset + OFFSETS.POS_X] = transform.x
stateBuffer[entityOffset + OFFSETS.POS_Y] = transform.y
stateBuffer[entityOffset + OFFSETS.ROTATION] = transform.rotation
stateBuffer[entityOffset + OFFSETS.HEALTH] = stats.health

// 主线程读取状态进行渲染
const x = stateBuffer[entityOffset + OFFSETS.POS_X]
const y = stateBuffer[entityOffset + OFFSETS.POS_Y]
```

#### 输入发送

```typescript
// 主线程发送输入到Worker
worker.postMessage({
  type: 'input',
  keys: ['w', 'a', 'd'],
  mouseButtons: [0],
  mouseX: 100,
  mouseY: 200,
})
```

### 阵营系统实现

```typescript
// FactionComponent.canAttack()
阵营类型：player, enemy, neutral
规则：
  - neutral 不攻击任何人，也不被攻击
  - enemy 互相可以攻击
  - player vs enemy 互相攻击
  - player vs player 不攻击
```

### 动作模组替换

**配置时替换**：

```typescript
// 创建时决定能力
const basicEnemy = createEnemy(world, box2d, worldId, x, y, 'basic')
// basicEnemy.Movement.maxWallJumps = 0（无蹬墙跳）

const advancedEnemy = createEnemy(world, box2d, worldId, x, y, 'advanced')
// advancedEnemy.Movement.maxWallJumps = 1（有蹬墙跳）
```

**运行时替换**：

```typescript
// 玩家拾取道具
function onPickupDoubleJump(player: Entity) {
  const doubleJump = new DoubleJumpComponent()
  player.addComponent(doubleJump)
  // 新增的DoubleJumpSystem会检测此组件
}

function onPickupDash(player: Entity) {
  const dash = new DashComponent()
  dash.dashSpeed = 10
  dash.cooldown = 1000
  player.addComponent(dash)
}
```

---

## 性能基准

### 目标

- 100+角色同屏：60 FPS
- 单帧预算：16.67ms
- Worker线程：固定60Hz更新
- 主线程：requestAnimationFrame渲染

### 各System预算分配（预估）

```
Worker线程：
  PhysicsSystem:      5ms   (Box2D step + 批量同步)
  MovementSystem:     2ms   (移动+跳跃逻辑)
  EnemyAISystem:      0.3ms (节流200ms，每帧少量决策)
  TargetingSystem:    1ms   (目标查询)
  WeaponSystem:       2ms   (武器状态更新)
  ArrowSystem:        1ms   (箭矢更新)
  StatsSystem:        2ms   (伤害计算+空间查询)
  SoundSystem:        0.5ms (音效队列)
  InteractionSystem:  0.2ms (交互检测)
  其他开销:           2ms

主线程：
  ClientRenderer:     3-5ms (Canvas绘制+视锥剔除)
  AudioManager:       0.5ms (音效播放)
  UI更新:             1ms
```

### 优化措施

- 对象池：ArrowPools避免箭矢频繁创建销毁
- 空间分区：SpatialHash加速范围查询
- 视锥剔除：ClientRenderer只渲染可见实体
- AI节流：EnemyAISystem降低决策频率
- 零拷贝：SharedArrayBuffer避免序列化

---

## 技术要点和注意事项

### 1. Box2D内存管理

Box2D WASM对象需要手动delete()，在System中统一管理：

```typescript
// 使用完立即删除
const velocity = b2Body_GetLinearVelocity(bodyId)
// ... 使用velocity
velocity.delete()
```

### 2. 组件依赖

System通过位掩码过滤需要的组件：

```typescript
// MovementSystem需要Transform、Physics、Movement组件
matches(entity: Entity): boolean {
  return entity.hasComponent('Transform') &&
         entity.hasComponent('Physics') &&
         entity.hasComponent('Movement')
}
```

### 3. SharedArrayBuffer支持

需要服务器响应头：

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

如果不支持，自动降级到普通ArrayBuffer + postMessage。

### 4. Worker通信模式

- 输入：主线程 → Worker（每帧）
- 状态：Worker → SharedArrayBuffer（每帧写入）
- 特效：Worker → 主线程（事件触发）
- 调试：Worker → 主线程（可选）

### 5. 性能调优

使用Chrome DevTools：

- Performance面板分析帧时间
- Memory面板检测内存泄漏
- 避免在update中创建临时对象
- 使用delta time而非Date接口

---

## 核心文件说明

### ECS核心（10个文件）

```
src/ecs/Entity.ts                - Entity基类（组件容器）
src/ecs/Component.ts             - 12个组件定义
src/ecs/System.ts                - System基类
src/ecs/World.ts                 - ECS世界管理器
src/ecs/EntityManager.ts         - Entity生命周期
src/ecs/EntityComponentPool.ts   - 组件对象池
src/ecs/ComponentRegistry.ts     - 组件注册（位掩码）
src/ecs/ObjectPool.ts            - 通用对象池
src/ecs/ArrowPools.ts            - 箭矢对象池
src/ecs/SpatialHash.ts           - 空间分区索引
```

### 游戏系统（9个文件）

```
src/ecs/systems/PhysicsSystem.ts      - Box2D物理模拟
src/ecs/systems/MovementSystem.ts     - 移动和跳跃
src/ecs/systems/EnemyAISystem.ts      - 敌人AI
src/ecs/systems/TargetingSystem.ts    - 目标锁定
src/ecs/systems/WeaponSystem.ts       - 武器状态机
src/ecs/systems/ArrowSystem.ts        - 箭矢系统
src/ecs/systems/StatsSystem.ts        - 属性和伤害
src/ecs/systems/SoundSystem.ts        - 音效事件
src/ecs/systems/InteractionSystem.ts  - 实体交互
```

### Worker线程（4个文件）

```
src/worker/gameWorker.ts        - Worker入口
src/worker/protocol.ts          - 消息协议
src/worker/binaryProtocol.ts    - 二进制同步
src/worker/effectsProtocol.ts   - 特效协议
```

### 主线程（14个文件）

```
src/GameClient.ts               - 游戏客户端
src/ClientRenderer.ts           - Canvas渲染
src/AudioManager.ts             - 音频管理
src/MenuManager.ts              - 菜单系统
src/InitializationManager.ts    - 初始化
src/BowTrajectory.ts            - 弓箭轨迹
src/ParticleSystem.ts           - 粒子系统
src/InputBuffer.ts              - 输入缓冲
src/Localizer.ts                - 国际化
src/storage.ts                  - 本地存储
src/constants.ts                - 游戏常量
src/types.ts                    - 类型定义
src/main.ts                     - 入口
src/vite-env.d.ts               - 类型声明
```

### 工厂（1个文件）

```
src/ecs/factories/PlayerFactory.ts - 玩家创建
```

---

## 当前功能

### 已实现功能

- [x] 玩家移动、跳跃、蹬墙跳
- [x] 多种武器系统（剑、锤、弓等）
- [x] 连击系统（最多5段）
- [x] 箭矢射击和碰撞
- [x] 敌人AI（巡逻、追击、攻击）
- [x] 阵营系统（玩家vs敌人）
- [x] 属性系统（血量、韧性、姿态）
- [x] 跌落伤害
- [x] 音效系统（7种音效）
- [x] 粒子特效
- [x] 摄像机跟随和缩放
- [x] 国际化（中/英）
- [x] 可配置参数（13个物理参数）

### 待实现功能

- [ ] 100敌人压力测试
- [ ] 性能基准测试
- [ ] 运行时组件添加/移除
- [ ] 更多敌人类型
- [ ] 更多武器类型
- [ ] 技能系统
- [ ] Buff/Debuff系统

---

## 技术栈

### 核心依赖

```json
{
  "dependencies": {
    "box2d3-wasm": "^5.1.3"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "typescript": "^5.0.0",
    "eslint": "^9.39.2",
    "prettier": "^3.3.3"
  }
}
```

### 构建工具

- Vite 5.0 - 开发服务器和构建工具
- TypeScript 5.0 - 严格模式
- ESLint + Prettier - 代码质量

### 运行时

- Box2D WASM 5.1.3 - 物理引擎
- Web Worker - 多线程
- SharedArrayBuffer - 零拷贝通信（可选）
- Canvas 2D - 渲染
- Web Audio API - 音频

---

## 后续扩展方向

基于当前架构可以轻松扩展：

1. 新动作模组（冲刺、滑铲、二段跳）
2. 更多武器类型（魔法、盾牌）
3. 技能系统（CD、消耗、技能树）
4. 更丰富的属性系统（攻击力、防御力、暴击）
5. Buff/Debuff系统
6. 关卡编辑器
7. 多人联机（WebSocket + 服务端权威）
