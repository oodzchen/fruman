# ECS组件化角色系统架构实施计划

## 目标

将现有的单一Player类重构为组件化ECS架构，支持：

- 多角色实例（玩家、NPC、敌人）
- 动作模组可替换（配置时+运行时）
- 阵营系统（敌友判定）
- 高性能（100+角色同屏）

---

## 核心架构设计

### ECS三要素

**Entity（实体）**

- 轻量级ID容器，持有组件Map
- 使用位掩码signature加速组件匹配
- 缓存常用组件（Transform, Physics, Combat）

**Component（组件）**

```
TransformComponent      - 位置、旋转、缩放
PhysicsComponent        - Box2D物理体、速度缓存
MovementComponent       - 移动速度、跳跃参数、接地状态
InputComponent          - 输入状态、InputBuffer
AIComponent             - AI状态机、巡逻点、目标
CombatComponent         - 阵营、血量、伤害
WeaponComponent         - 武器类型、攻击状态、连击
ProjectileComponent     - 投射物属性、生命周期
RenderComponent         - 渲染类型、颜色、可见性
FactionComponent        - 阵营枚举、敌友判定逻辑
```

**System（系统）**

```
更新顺序：
1. AISystem           - AI决策生成输入（节流200ms）
2. MovementSystem     - 处理移动和跳跃
3. PhysicsSystem      - Box2D模拟+批量同步位置
4. CombatSystem       - 攻击判定和伤害计算
5. ProjectileSystem   - 投射物移动和碰撞
6. SpatialSystem      - 更新空间分区索引
7. RenderSystem       - 视锥剔除+渲染
```

---

## 性能优化策略

### 1. 空间分区（SpatialHash）

- 网格大小：5米
- 用途：AI目标查询、攻击范围检测
- 性能：O(n²) → O(1)

### 2. 对象池（ObjectPool）

- Entity池：预创建100个
- Projectile池：预创建50个
- 减少60% GC暂停

### 3. 视锥剔除

- RenderSystem中实现
- 只渲染屏幕内±2米范围的entity
- 减少70%渲染开销

### 4. AI节流

- 决策间隔：200ms（而非每帧16ms）
- 减少90% AI计算量

### 5. 组件缓存

- Entity内缓存Transform/Physics/Combat
- 避免频繁Map查询

### 6. 数据局部性（可选）

- 超大规模时使用SoA（Structure of Arrays）
- Float32Array连续存储相同属性
- 提升缓存命中率50%+

---

## 文件结构

```
src/
├── ecs/
│   ├── Entity.ts                    # Entity基类
│   ├── Component.ts                 # 所有组件定义
│   ├── System.ts                    # System基类
│   ├── World.ts                     # ECS世界管理器
│   ├── EntityManager.ts             # Entity创建/销毁
│   ├── ComponentRegistry.ts         # 组件类型注册（位掩码）
│   ├── ObjectPool.ts                # 对象池
│   ├── SpatialHash.ts               # 空间分区
│   │
│   ├── systems/
│   │   ├── PhysicsSystem.ts
│   │   ├── MovementSystem.ts
│   │   ├── AISystem.ts
│   │   ├── CombatSystem.ts
│   │   ├── ProjectileSystem.ts
│   │   ├── WeaponSystem.ts
│   │   ├── RenderSystem.ts
│   │   └── SpatialSystem.ts
│   │
│   └── factories/
│       ├── PlayerFactory.ts         # 创建玩家entity
│       ├── EnemyFactory.ts          # 创建敌人entity
│       └── ProjectileFactory.ts     # 创建投射物entity
│
├── legacy/
│   ├── player.ts                    # (迁移期保留)
│   └── game.ts                      # (迁移期保留)
│
├── utils/
│   ├── inputBuffer.ts               # (复用)
│   └── math.ts                      # 数学工具
│
├── constants.ts                     # (复用)
├── types.ts                         # (复用)
├── main.ts                          # 入口
└── GameECS.ts                       # 新Game类（基于ECS）
```

---

## 实施步骤

### 阶段1：ECS基础框架（第1周）

#### 步骤1.1：创建核心类

- [ ] `src/ecs/Entity.ts` - 实现Entity容器
- [ ] `src/ecs/Component.ts` - 定义所有组件
- [ ] `src/ecs/System.ts` - System基类
- [ ] `src/ecs/ComponentRegistry.ts` - 位掩码注册表
- [ ] `src/ecs/EntityManager.ts` - Entity生命周期管理
- [ ] `src/ecs/World.ts` - ECS世界管理器

#### 步骤1.2：性能工具

- [ ] `src/ecs/ObjectPool.ts` - 对象池实现
- [ ] `src/ecs/SpatialHash.ts` - 空间分区实现

### 阶段2：核心Systems实现（第2周）

#### 步骤2.1：物理和移动

- [ ] `src/ecs/systems/PhysicsSystem.ts`

  - Box2D世界步进
  - 批量位置同步
  - 速度缓存

- [ ] `src/ecs/systems/MovementSystem.ts`
  - 从`player.ts`迁移移动逻辑
  - 从`player.ts`迁移跳跃逻辑（普通跳+蹬墙跳）
  - 接触检测（节流16ms）
  - InputBuffer集成

#### 步骤2.2：空间索引

- [ ] `src/ecs/systems/SpatialSystem.ts`
  - 每帧重建SpatialHash
  - 为AI和战斗系统提供查询

### 阶段3：战斗和AI系统（第3周）

#### 步骤3.1：战斗系统

- [ ] `src/ecs/systems/CombatSystem.ts`

  - 从`game.ts`迁移武器系统
  - 近战攻击判定（空间分区查询）
  - 阵营判定（FactionComponent）
  - 伤害计算和无敌帧

- [ ] `src/ecs/systems/WeaponSystem.ts`

  - 武器状态机（idle/windup/swing/recover）
  - 连击系统（最多5段）
  - 视觉位置更新

- [ ] `src/ecs/systems/ProjectileSystem.ts`
  - 投射物移动
  - 碰撞检测
  - 生命周期管理
  - 对象池集成

#### 步骤3.2：AI系统

- [ ] `src/ecs/systems/AISystem.ts`
  - 简单状态机（idle/patrol/chase/attack）
  - 玩家检测（空间分区查询）
  - 巡逻路径
  - 决策节流（200ms）

### 阶段4：渲染和工厂（第4周）

#### 步骤4.1：渲染系统

- [ ] `src/ecs/systems/RenderSystem.ts`
  - 从`player.ts`迁移渲染逻辑
  - 视锥剔除
  - 批量绘制
  - 相机跟随

#### 步骤4.2：Entity工厂

- [ ] `src/ecs/factories/PlayerFactory.ts`

  - 创建玩家Entity
  - 组装：Transform + Physics + Movement + Input + Combat + Faction + Render + Weapon
  - 从`player.ts`的构造函数迁移Box2D物理体创建

- [ ] `src/ecs/factories/EnemyFactory.ts`

  - 创建敌人Entity
  - 添加AI组件
  - 支持不同类型（basic/advanced）
  - 不同类型有不同能力（基础敌人无蹬墙跳）

- [ ] `src/ecs/factories/ProjectileFactory.ts`
  - 创建投射物Entity
  - 配置：发射者ID、伤害、速度、生命周期

### 阶段5：新Game类和集成（第5周）

#### 步骤5.1：GameECS实现

- [ ] `src/GameECS.ts`
  - 初始化ECS World
  - 创建所有Systems
  - 创建对象池
  - 复用`game.ts`的地面/障碍物创建
  - update() 调用 world.update()
  - render() 由RenderSystem处理

#### 步骤5.2：main.ts集成

- [ ] 修改`src/main.ts`
  - 切换到GameECS
  - 保留控制面板（通过getter/setter访问player entity）
  - 键盘输入 → 更新player entity的InputComponent

### 阶段6：测试和优化（第6周）

#### 步骤6.1：功能测试

- [ ] 玩家移动、跳跃、蹬墙跳正常
- [ ] 创建10个敌人，AI巡逻/追击/攻击正常
- [ ] 阵营系统：敌人互相攻击，不攻击同伴
- [ ] 近战武器连击正常
- [ ] 投射物发射和碰撞正常

#### 步骤6.2：性能测试

- [ ] 压力测试：100个敌人同屏
- [ ] 监控帧率：应保持60 FPS
- [ ] 检查单帧时间：
  - PhysicsSystem < 5ms
  - AISystem < 3ms（节流后）
  - RenderSystem < 3ms（视锥剔除后）

#### 步骤6.3：性能优化

- [ ] 如帧率不达标，应用SoA优化
- [ ] 调整SpatialHash网格大小
- [ ] 调整AI决策间隔
- [ ] 调整对象池大小

### 阶段7：清理和文档（第7周）

#### 步骤7.1：代码清理

- [ ] 删除`legacy/player.ts`和`legacy/game.ts`
- [ ] 更新`constants.ts`（移除未使用的常量）
- [ ] 运行`npm run format`
- [ ] 运行`npm run lint`并修复所有问题

#### 步骤7.2：扩展功能测试

- [ ] 运行时添加组件：玩家拾取"二段跳道具"
- [ ] 运行时移除组件：玩家失去能力
- [ ] 创建3种不同类型的敌人

---

## 关键技术细节

### 从Player迁移的逻辑

#### 移动逻辑（player.ts:130-153）

```typescript
// MovementSystem.handleMove()
const velocity = new b2Vec2(direction * moveSpeed, velocityY)
b2Body_SetLinearVelocity(bodyId, velocity)
```

#### 跳跃逻辑（player.ts:172-211）

```typescript
// MovementSystem.doJump()
if (蹬墙跳) {
  const pushAwaySpeed = -wallDirection * moveSpeed * 0.5
  const upwardSpeed = -jumpForce * 0.8
  b2Body_SetLinearVelocity(bodyId, new b2Vec2(pushAwaySpeed, upwardSpeed))
} else if (接地) {
  const impulse = new b2Vec2(0, -jumpForce * mass * 0.6)
  b2Body_ApplyLinearImpulseToCenter(bodyId, impulse, true)
}
```

#### 接触检测（player.ts:80-128）

```typescript
// MovementSystem.updateContactState()
const contactData = b2Body_GetContactData(bodyId, capacity)
for (contact of contactData) {
  if (abs(normal.y) > 0.7) grounded = true
  if (abs(normal.x) > 0.7) touchingWall = true
}
```

### 从Game迁移的武器系统

#### 武器状态机（game.ts:608-879）

```typescript
// WeaponSystem.update()
攻击阶段：
  idle → windup(200ms) → swing(140ms) → pause(500ms) → recover(200ms) → idle
连击逻辑：
  在pause阶段按J → 跳过recover直接进入下一段
  最多5段连击
```

#### 攻击判定（CombatSystem）

```typescript
// 使用SpatialHash查询攻击范围内的敌人
const nearbyEntities = spatialHash.query(attackX - radius, attackY - radius, ...)
for (target of nearbyEntities) {
  if (距离 < attackRadius && 可以攻击该阵营) {
    造成伤害
  }
}
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

### 各System预算分配

```
PhysicsSystem:      5ms   (Box2D step + 100个body同步)
MovementSystem:     2ms   (100个entity移动+跳跃)
AISystem:           0.3ms (节流到200ms，实际每帧只有1-2个AI决策)
CombatSystem:       2ms   (空间分区查询 + 伤害计算)
ProjectileSystem:   1ms   (20-30个投射物更新)
RenderSystem:       3ms   (视锥剔除后只渲染30-40个entity)
SpatialSystem:      1ms   (重建SpatialHash)
其他开销:           2.37ms
```

### 优化效果预估

- 对象池：减少60% GC暂停
- 空间分区：AI/战斗查询从O(n²)到O(1)
- 视锥剔除：渲染开销-70%
- AI节流：AI开销-90%

---

## 风险和注意事项

### 1. Box2D内存管理

**风险**：Box2D WASM对象需要手动delete()，否则内存泄漏
**解决**：在System中统一管理，每个b2Vec2/contact用完立即delete

### 2. 组件间依赖

**风险**：MovementSystem需要Physics和Input组件，缺一不可
**解决**：使用requiredComponents和位掩码过滤

### 3. 性能调优

**风险**：首次实现可能达不到60 FPS
**解决**：

- 先实现功能，后优化性能
- 使用Chrome DevTools Profiler定位瓶颈
- 逐步应用：对象池 → 空间分区 → 视锥剔除 → SoA

### 4. 迁移兼容性

**风险**：迁移过程中可能破坏现有功能
**解决**：

- 保留legacy代码直到完全验证
- 逐个功能迁移并测试
- 使用Git分支管理

---

## 关键文件清单

### 新建文件（31个）

```
src/ecs/Entity.ts
src/ecs/Component.ts
src/ecs/System.ts
src/ecs/World.ts
src/ecs/EntityManager.ts
src/ecs/ComponentRegistry.ts
src/ecs/ObjectPool.ts
src/ecs/SpatialHash.ts

src/ecs/systems/PhysicsSystem.ts
src/ecs/systems/MovementSystem.ts
src/ecs/systems/AISystem.ts
src/ecs/systems/CombatSystem.ts
src/ecs/systems/ProjectileSystem.ts
src/ecs/systems/WeaponSystem.ts
src/ecs/systems/RenderSystem.ts
src/ecs/systems/SpatialSystem.ts

src/ecs/factories/PlayerFactory.ts
src/ecs/factories/EnemyFactory.ts
src/ecs/factories/ProjectileFactory.ts

src/GameECS.ts
src/utils/math.ts
```

### 修改文件（2个）

```
src/main.ts          - 切换到GameECS
src/constants.ts     - 可能添加新常量
```

### 保留文件（迁移期）

```
src/legacy/player.ts  - 从src/player.ts移动
src/legacy/game.ts    - 从src/game.ts移动
```

### 复用文件（4个）

```
src/inputBuffer.ts   - 不变
src/types.ts         - 不变
src/constants.ts     - 可能扩展
```

---

## 成功标准

### 功能完整性

- [ ] 玩家所有能力正常（移动、跳跃、蹬墙跳、攻击）
- [ ] 创建多个敌人，AI正常工作
- [ ] 阵营系统正确判定敌友
- [ ] 近战武器和投射物都能造成伤害
- [ ] 运行时可以添加/移除组件

### 性能达标

- [ ] 100个角色同屏保持60 FPS
- [ ] 无明显GC暂停（<5ms）
- [ ] 单帧时间 < 16.67ms

### 代码质量

- [ ] 通过`npm run lint`
- [ ] 通过`npm run format`检查
- [ ] 无TypeScript类型错误
- [ ] 代码注释清晰

---

## 预估工时

- 阶段1（ECS框架）：1周
- 阶段2（核心Systems）：1周
- 阶段3（战斗和AI）：1周
- 阶段4（渲染和工厂）：1周
- 阶段5（集成）：1周
- 阶段6（测试优化）：1周
- 阶段7（清理）：1周

**总计：7周**

---

## 后续扩展方向

完成基础架构后，可以轻松扩展：

1. 新动作模组（冲刺、滑铲、二段跳）
2. 新武器类型（弓箭、魔法）
3. 技能系统（CD、消耗）
4. 完整属性系统（攻击力、防御力、暴击）
5. Buff/Debuff系统
6. 粒子效果系统
7. 音效系统
