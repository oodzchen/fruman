# sl2d 游戏架构文档

## 项目概述

基于 **ECS（Entity-Component-System）** 架构和 **Web Worker 多线程** 设计的高性能 2D 横版格斗游戏，目标帧率 60 FPS / 100+ 角色同屏。

**技术栈**

| 类别       | 技术                                       |
| ---------- | ------------------------------------------ |
| 渲染引擎   | Pixi.js v8 (WebGL)                         |
| 物理引擎   | Box2D3-WASM v5.1                           |
| 骨骼动画   | Spine Pixi v4.2                            |
| 粒子系统   | @pixi/particle-emitter                     |
| 几何算法   | d3-delaunay, clipper2-wasm, poly-decomp-es |
| 编辑器画布 | fabric.js v7                               |
| 构建工具   | Vite v8 + TypeScript 5 strict              |
| 代码质量   | ESLint v9 + Prettier                       |

---

## 整体架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                          浏览器主线程                                │
│                                                                     │
│  ┌──────────────┐  ┌──────────────────────────────────────────────┐ │
│  │  main.ts     │  │              GameClient                       │ │
│  │  (入口)      │  │  ┌─────────────┐  ┌──────────────────────┐  │ │
│  └──────┬───────┘  │  │ AudioManager│  │  InitializationMgr  │  │ │
│         │          │  └─────────────┘  └──────────────────────┘  │ │
│         │          │  ┌─────────────┐  ┌──────────────────────┐  │ │
│         │          │  │ MenuManager │  │  DisplayManager      │  │ │
│         │          │  └─────────────┘  └──────────────────────┘  │ │
│         │          │  ┌─────────────┐  ┌──────────────────────┐  │ │
│         ▼          │  │ SaveManager │  │  LevelUpManager      │  │ │
│  ┌──────────────┐  │  └─────────────┘  └──────────────────────┘  │ │
│  │ EditorManager│  └──────────────────────────┬───────────────────┘ │
│  │  (编辑器)    │                              │ postMessage / SAB   │
│  └──────────────┘  ┌──────────────────────────▼───────────────────┐ │
│                    │           ClientRenderer (Pixi.js)            │ │
│                    │  PixiWorldRenderer  WeaponRenderer            │ │
│                    │  BodyRenderer       ParticleSystem            │ │
│                    │  TerrainRenderer    DayNightCycle             │ │
│                    │  SpineBodyManager   HudWeaponSlotRenderer     │ │
│                    └──────────────────────────────────────────────┘ │
└────────────────────────────────────┬────────────────────────────────┘
                                     │ SharedArrayBuffer (zero-copy)
                                     │ postMessage (特效/音效/控制)
┌────────────────────────────────────▼────────────────────────────────┐
│                          Worker 线程                                 │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                        gameWorker.ts                           │ │
│  │                                                                │ │
│  │  ┌──────────────────────────────────────────────────────────┐ │ │
│  │  │                      ECS World                           │ │ │
│  │  │  ┌──────────────┐  ┌──────────┐  ┌──────────────────┐  │ │ │
│  │  │  │ EntityManager│  │ComponentR│  │ EntityComponentPool│  │ │ │
│  │  │  └──────────────┘  └──────────┘  └──────────────────┘  │ │ │
│  │  │                                                          │ │ │
│  │  │  系统执行顺序 (60Hz):                                    │ │ │
│  │  │  PhysicsSystem → MovementSystem → NpcAISystem            │ │ │
│  │  │  → TargetingSystem → WeaponSystem → ArrowSystem          │ │ │
│  │  │  → StatsSystem → SoundSystem → InteractionSystem         │ │ │
│  │  │  → GrappleSystem → CheckpointSystem → ExpOrbSystem       │ │ │
│  │  └──────────────────────────────────────────────────────────┘ │ │
│  │                                                                │ │
│  │  ┌──────────────┐  ┌──────────────────────────────────────┐  │ │
│  │  │  Box2D WASM  │  │  PlayerFactory / 地图加载            │  │ │
│  │  │  (物理世界)  │  │  SpatialHash / OBBCollision         │  │ │
│  │  └──────────────┘  └──────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 线程通信协议

```
主线程                                          Worker 线程
   │                                                 │
   │ ── postMessage(WorkerInputMessage) ──────────► │  键盘/鼠标输入 (每帧)
   │ ── postMessage(WorkerControlMessage) ────────► │  开始/暂停/重启
   │ ── postMessage(WorkerMapPreviewMessage) ─────► │  地图预览
   │ ── postMessage(WorkerLoadSaveMessage) ───────► │  读档
   │                                                 │
   │ ◄── SharedArrayBuffer (Float32Array) ─────────  │  实体状态同步 (60Hz, 零拷贝)
   │ ◄── postMessage(WorkerEffectsMessage) ─────────  │  粒子/音效/绳索点
   │ ◄── postMessage(WorkerStateUpdateMessage) ─────  │  游戏状态变更
   │ ◄── postMessage(WorkerPlayerLevelUpMessage) ───  │  玩家升级
   │ ◄── postMessage(WorkerSaveResponseMessage) ────  │  存档响应
```

**SharedArrayBuffer 布局**（每实体 32 个 float32）

```
[entityOffset + 0]  POS_X          [entityOffset + 16] FACING_DIR
[entityOffset + 1]  POS_Y          [entityOffset + 17] IS_DEAD
[entityOffset + 2]  ROTATION       [entityOffset + 18] DEATH_FLASH_ELAPSED
[entityOffset + 3]  VELOCITY_X     [entityOffset + 19] WEAPON_INDEX
[entityOffset + 4]  VELOCITY_Y     [entityOffset + 20] WEAPON_STATE
[entityOffset + 5]  HEALTH         [entityOffset + 21] COMBO_COUNT
[entityOffset + 6]  MAX_HEALTH     [entityOffset + 22] ...
[entityOffset + 7]  POSTURE        [entityOffset + 31] FLAGS (bitmask)
[entityOffset + 8]  MAX_POSTURE
```

---

## ECS 架构

### 核心类关系

```
ComponentRegistry
   │ 维护 Component名 ↔ 位掩码(2^n) 映射
   │
EntityManager ──── 管理 ──► Entity[]
   │                          │
   │               ┌──────────┼──────────────────────┐
   │               │          │                      │
   │          signature    components          缓存字段
   │          (bitmask)  Map<string,           .transform
   │                     Component>            .physics
   │                                           .stats
   │                                           .weapon ...
   │
World ──── 调度 ──► System[]
   │                   │
   │              requiredSignature (bitmask)
   │              matches(entity) → entity.signature & required
   │
EntityComponentPool ── 对象池 ── Component 复用 (避免GC)
```

### 组件清单

```
核心组件:
  TransformComponent      位置 (x, y)、旋转、缩放
  PhysicsComponent        Box2D 刚体、速度缓存
  MovementComponent       移动速度、跳跃参数、接地状态、蹬墙跳计数
  InputComponent          按键状态、鼠标方向、InputBuffer (连击检测)
  RenderComponent         渲染类型、颜色、可见性

角色属性:
  StatsComponent          血量、架势、韧性、死亡状态、等级
  FactionComponent        阵营枚举 (player/enemy/neutral)
  LevelComponent          经验、等级、升级阈值

武器系统:
  WeaponComponent         当前装备、攻击状态机、连击段数
  WeaponSlotsComponent    主/副武器槽、切换逻辑
  AttackSlotsComponent    攻击槽数据 (多段蓄力)
  ArrowComponent          箭矢属性、飞行速度、生命周期

AI 与感知:
  NpcAIComponent          状态机 (idle/alert/chase/attack)、巡逻点、目标
  SensorComponent         视觉范围、听觉范围、感知半径
  FollowComponent         跟随目标配置

特殊机制:
  GrappleComponent        抓钩状态、锚点、绳索张力
  GrappleAnchorComponent  抓钩锚点实体标记
  CheckpointComponent     检查点数据、激活状态
  SolarEnergyComponent    太阳能资源量
  SunPickupComponent      可拾取物品标记
  ExpOrbComponent         经验球价值、吸附半径
  NpcDropTableComponent   NPC 掉落配置表
```

### 系统执行顺序

```
Worker 60Hz 更新循环:

 1. PhysicsSystem      ── Box2D 世界步进 + 刚体位置同步          ~5ms
 2. MovementSystem     ── 移动/跳跃/蹬墙跳/摩擦力               ~2ms
 3. NpcAISystem        ── AI 状态机决策 (节流 200ms)            ~0.3ms
 4. TargetingSystem    ── 目标锁定和追踪                         ~1ms
 5. WeaponSystem       ── 武器状态机 + 连击窗口                  ~2ms
 6. ArrowSystem        ── 箭矢飞行 + 碰撞 + 对象池回收           ~1ms
 7. StatsSystem        ── 伤害计算 + 属性更新 + 死亡处理         ~2ms
 8. SoundSystem        ── 音效事件队列                           ~0.5ms
 9. InteractionSystem  ── 实体交互 (拾取/触发)                   ~0.2ms
10. GrappleSystem      ── 抓钩/绳索物理                          ~0.5ms
11. CheckpointSystem   ── 检查点激活检测                         ~0.1ms
12. ExpOrbSystem       ── 经验球收集 + 升级触发                  ~0.2ms
13. FollowSystem       ── NPC 跟随行为                           ~0.2ms
14. SkillHandler       ── 技能逻辑                               ~0.3ms
15. UltimateHandler    ── 终极技能逻辑                           ~0.3ms
```

---

## 渲染架构

```
主线程 requestAnimationFrame (≤16.67ms)
│
▼
ClientRenderer
│
├── 读取 SharedArrayBuffer → 实体位置/状态
│
├── PixiWorldRenderer (Pixi.js Application)
│   ├── 摄像机变换 (平移/缩放)
│   ├── 视锥剔除 (只渲染可见实体, MAX_ENTITY_VIEW_CACHE=512)
│   │
│   ├── TerrainRenderer
│   │   ├── 多层地形 (背景/前景)
│   │   └── 材质贴图 (TerrainMaterialRegistry)
│   │
│   ├── SpineBodyManager (骨骼动画)
│   │   ├── 角色 Spine 动画
│   │   ├── SpineSegmentManager (骨骼段管理)
│   │   └── 武器姿态 (WeaponPoseUtils)
│   │
│   ├── BodyRenderer (角色身体)
│   │   └── CharacterBodyPhysics 多边形
│   │
│   ├── WeaponRenderer (武器形状)
│   │   └── Canvas Pattern 纹理缓存 (MAX_WEAPON_TEXTURE_CACHE=192)
│   │
│   ├── ParticleSystem (粒子特效, 容量 600)
│   │   ├── 血液、火花、死亡爆发
│   │   └── ParrySparkEmitterPool (弹反火花对象池)
│   │
│   ├── DayNightCycle (日夜循环 overlay)
│   │
│   ├── HudWeaponSlotRenderer (武器 HUD)
│   │
│   └── ProceduralEnvironmentFactory (程序化背景)
│
└── AudioManager (Web Audio API)
    ├── 7 种 WAV 音效
    ├── 空间音效 (距离衰减)
    └── 多通道同时播放
```

---

## 地形系统

```
EditorManager (fabric.js 编辑器)
│
├── EditorTerrainLayerManager ── 图层管理
│   ├── EditorTerrainBrushController ── 笔刷绘制
│   └── TerrainBrushCursor ── 光标预览
│
├── 地形数据 (TerrainTypes.ts)
│   ├── 多边形顶点列表
│   ├── 材质 ID
│   └── 图层 (前景/背景)
│
├── 碰撞构建 (Worker 加载时)
│   ├── TerrainCollisionBuilder ── 基础多边形 → Box2D PolygonShape
│   ├── VoronoiBuilder ── d3-delaunay Voronoi 细胞分解
│   ├── VoronoiCollisionBuilder ── Voronoi → Box2D 碰撞体
│   └── TerrainPolygonUtils ── clipper2-wasm 多边形裁剪/合并
│
└── 渲染 (主线程)
    ├── TerrainRenderer (Pixi.js Graphics)
    ├── TerrainMaterialRegistry ── 材质贴图注册
    ├── TerrainChunkGrid ── 分块剔除优化
    └── TerrainGeometry ── 几何计算
```

---

## 编辑器架构

```
EditorManager (主控制器)
│
├── 对象管理
│   ├── EditorObjectManager ── 对象增删改查
│   ├── EditorObjectFactory ── 对象创建工厂
│   ├── EditorObjectTreeManager ── 层级树视图
│   ├── EditorMarkerManager ── NPC/Player 标记
│   └── EditorShapeManager ── 碰撞形状管理
│
├── 地形编辑
│   ├── EditorTerrainLayerManager ── 图层管理
│   ├── EditorTerrainBrushController ── 笔刷工具
│   └── EditorPolygonEditor ── 多边形顶点编辑
│
├── UI 系统
│   ├── EditorMenuSystem ── 菜单栏
│   ├── EditorMenuNavigator ── 菜单导航
│   ├── EditorPropertiesPanel ── 属性面板
│   ├── EditorToolbarManager ── 工具栏
│   └── EditorContextMenu ── 右键菜单
│
├── 画布交互
│   ├── EditorCanvasEventHandler ── 事件处理
│   ├── EditorCameraManager ── 摄像机控制
│   ├── EditorSnapManager ── 网格吸附
│   └── EditorCoordinateUtils ── 坐标变换
│
├── 数据管理
│   ├── EditorMapSerializer ── 地图序列化/反序列化 (JSON)
│   ├── EditorMapListManager ── 地图列表 (localStorage)
│   ├── EditorHistoryManager ── 撤销/重做
│   ├── EditorClipboardManager ── 剪贴板
│   └── EditorThumbnailCapture ── 缩略图截图
│
└── 工具
    ├── EditorCharacterBodyDrawer ── 角色预览绘制
    ├── EditorRenderUtils ── 渲染辅助
    ├── EditorUIHelper ── UI 辅助
    └── MapImportExportPanel ── 导入/导出
```

---

## 数据流

```
用户按键 (WASD / 攻击)
       │
       ▼
GameClient.onKeyDown
       │ inputState 更新
       ▼
worker.postMessage(WorkerInputMessage)
       │
       ▼
gameWorker 接收
       │ setInputOnEntity(player, input)
       │ InputComponent 更新
       ▼
ECS World.update(deltaTime)
       │
       ├─ MovementSystem: InputComponent → 线性速度 (Box2D)
       ├─ NpcAISystem: 感知玩家 → 生成敌人 InputComponent
       ├─ WeaponSystem: InputComponent.attack → 武器状态机转移
       └─ StatsSystem: WeaponSystem hit → SpatialHash 查询 → 伤害计算
              │
              ├─ 更新 StatsComponent (血量、架势)
              ├─ 写入 effectsBuffer (粒子特效、音效事件)
              └─ 更新 stateBuffer (SharedArrayBuffer)
                        │
                        ▼ (零拷贝)
               主线程 ClientRenderer
                        │
                        ├─ 读取实体位置/状态
                        ├─ Pixi.js 渲染 (Spine动画/武器/地形)
                        ├─ 粒子特效播放
                        └─ AudioManager 音效播放
```

---

## 性能优化

### 策略汇总

| 优化手段   | 实现                                            | 效果                  |
| ---------- | ----------------------------------------------- | --------------------- |
| 空间分区   | SpatialHash (网格)                              | 范围查询 O(n²) → O(1) |
| 对象池     | ArrowPools, EntityComponentPool, ParticleSystem | 避免 GC 暂停          |
| 视锥剔除   | ClientRenderer AABB 检测                        | 只渲染可见实体        |
| AI 节流    | NpcAISystem 200ms 间隔                          | 降低 AI 开销 ~10x     |
| 组件缓存   | Entity.transform / .physics / .stats            | 避免 Map 查询         |
| 零拷贝通信 | SharedArrayBuffer                               | 无序列化开销          |
| 位掩码过滤 | ComponentRegistry bitmask                       | System 快速匹配实体   |
| 贴图缓存   | 武器 Canvas Pattern 缓存 (x192)                 | 避免重复绘制          |
| Spine 缓存 | SpineBodyManager 按需加载                       | 减少资源重复加载      |
| 整数运算   | 所有游戏数值避免浮点                            | 精确、高效            |

### 帧时间预算

```
Worker 线程 (目标 ≤16ms):     主线程 (目标 ≤16ms):
  PhysicsSystem    ~5ms          ClientRenderer   ~3-5ms
  MovementSystem   ~2ms          AudioManager     ~0.5ms
  WeaponSystem     ~2ms          UI 更新          ~1ms
  StatsSystem      ~2ms
  其余系统         ~4ms
  总计             ~15ms
```

---

## 目录结构

```
src/
├── ecs/                        ECS 核心架构
│   ├── Entity.ts
│   ├── Component.ts            20+ 组件定义
│   ├── System.ts
│   ├── World.ts
│   ├── EntityManager.ts
│   ├── EntityComponentPool.ts
│   ├── ComponentRegistry.ts
│   ├── ObjectPool.ts
│   ├── ArrowPools.ts
│   ├── SpatialHash.ts
│   ├── OBBCollision.ts
│   ├── CharacterBodyPhysics.ts
│   ├── SpineSegmentManager.ts
│   ├── WeaponPoseUtils.ts
│   ├── AttackMoveRegistry.ts
│   ├── AttackMoveData.ts
│   ├── PhysicsShapeUtils.ts
│   ├── systems/
│   │   ├── PhysicsSystem.ts
│   │   ├── MovementSystem.ts
│   │   ├── NpcAISystem.ts
│   │   ├── TargetingSystem.ts
│   │   ├── WeaponSystem.ts
│   │   ├── ArrowSystem.ts
│   │   ├── StatsSystem.ts
│   │   ├── SoundSystem.ts
│   │   ├── InteractionSystem.ts
│   │   ├── GrappleSystem.ts
│   │   ├── CheckpointSystem.ts
│   │   ├── ExpOrbSystem.ts
│   │   ├── FollowSystem.ts
│   │   ├── SunPickupSystem.ts
│   │   ├── SkillHandler.ts
│   │   └── UltimateHandler.ts
│   └── factories/
│       └── PlayerFactory.ts
│
├── worker/                     多线程通信
│   ├── gameWorker.ts           Worker 入口 (ECS + Box2D)
│   ├── protocol.ts             消息类型定义
│   ├── binaryProtocol.ts       SharedArrayBuffer 状态同步
│   └── effectsProtocol.ts      特效/音效队列协议
│
├── renderer/                   Pixi.js 渲染系统
│   ├── PixiWorldRenderer.ts
│   ├── BodyRenderer.ts
│   ├── WeaponRenderer.ts
│   ├── SpineBodyManager.ts
│   ├── ParticleSystem.ts
│   ├── DayNightCycle.ts
│   ├── TerrainRenderer.ts
│   ├── HudWeaponSlotRenderer.ts
│   ├── ParrySparkEmitterPool.ts
│   ├── ProceduralEnvironmentFactory.ts
│   ├── CheckpointTreeTextureFactory.ts
│   ├── PixiParticleEmitterCompat.ts
│   ├── PatternCreator.ts
│   └── RenderContext2D.ts
│
├── terrain/                    地形系统
│   ├── TerrainTypes.ts
│   ├── TerrainDataUtils.ts
│   ├── TerrainCollisionBuilder.ts
│   ├── TerrainRenderer.ts
│   ├── TerrainMaterialRegistry.ts
│   ├── TerrainPolygonUtils.ts
│   ├── TerrainChunkGrid.ts
│   ├── TerrainGeometry.ts
│   ├── TerrainBrushCursor.ts
│   ├── TerrainContourUtils.ts
│   ├── VoronoiBuilder.ts
│   ├── VoronoiCollisionBuilder.ts
│   └── TerrainLegacyShapeMigration.ts
│
├── editor/                     关卡编辑器 (28 个文件)
│   ├── EditorManager.ts
│   ├── EditorObjectManager.ts
│   ├── EditorMapSerializer.ts
│   ├── EditorTerrainLayerManager.ts
│   ├── EditorPropertiesPanel.ts
│   ├── EditorMenuSystem.ts
│   ├── EditorObjectTreeManager.ts
│   ├── EditorMapListManager.ts
│   ├── EditorCharacterBodyDrawer.ts
│   ├── EditorMarkerManager.ts
│   ├── EditorClipboardManager.ts
│   ├── EditorHistoryManager.ts
│   ├── EditorToolbarManager.ts
│   ├── EditorCameraManager.ts
│   ├── EditorCanvasEventHandler.ts
│   ├── EditorPolygonEditor.ts
│   ├── EditorShapeManager.ts
│   ├── EditorSnapManager.ts
│   ├── EditorTerrainBrushController.ts
│   ├── EditorContextMenu.ts
│   ├── EditorThumbnailCapture.ts
│   ├── EditorRenderUtils.ts
│   ├── EditorCoordinateUtils.ts
│   ├── EditorUIHelper.ts
│   ├── EditorMenuNavigator.ts
│   ├── EditorObjectFactory.ts
│   ├── EditorConstants.ts
│   └── types.ts
│
├── 主线程管理                   游戏客户端
│   ├── GameClient.ts
│   ├── ClientRenderer.ts
│   ├── AudioManager.ts
│   ├── MenuManager.ts
│   ├── InitializationManager.ts
│   ├── DialogManager.ts
│   ├── DisplayManager.ts
│   ├── SaveManager.ts
│   ├── LevelUpManager.ts
│   ├── BowTrajectory.ts
│   ├── InputBuffer.ts
│   ├── Localizer.ts
│   ├── MapImportExportPanel.ts
│   ├── DirectionalNav.ts
│   └── storage.ts
│
└── 工具与配置
    ├── main.ts                 入口
    ├── constants.ts            226+ 个游戏常量
    ├── types.ts                核心类型
    ├── physicsLayers.ts        碰撞层掩码
    ├── renderLayers.ts         渲染层定义
    ├── characterBodyProfile.ts 角色身体配置
    ├── characterBodyCollision.ts 角色碰撞多边形
    ├── npcBodyProfileUtils.ts
    ├── npcDropUtils.ts
    ├── playerUpgrade.ts
    ├── weaponTypeUtils.ts
    ├── editorMapTypes.ts
    ├── mapObjectLayers.ts
    ├── saveTypes.ts
    ├── colorUtils.ts
    ├── effectAttenuation.ts
    ├── publicAssetUrl.ts
    └── spineCollisionKeyframes.ts

lang/
├── zh-Hans.json               简体中文
└── en.json                    英文

public/audios/                 7 个 WAV 音效文件
```

---

## 关键技术细节

### Box2D 内存管理

Box2D WASM 对象需要手动 `delete()`，必须在 System 中用完即销毁：

```typescript
const vel = b2Body_GetLinearVelocity(bodyId)
// ... 使用 vel
vel.delete()
```

### SharedArrayBuffer 跨源隔离

vite.config.ts 注入必需响应头：

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

不支持时自动降级为普通 ArrayBuffer + postMessage。

### 武器状态机

```
idle ──(攻击键)──► windup ──► swing ──► pause ──(攻击键, ≤5段)──► windup
                                            │
                                            └──(超时)──► recover ──► idle
```

### AI 状态机

```
patrol ──(感知)──► alert ──(3s后无目标)──► patrol
                      │
                   (发现)
                      ▼
                   chase ──(接近)──► attack
                      ▲                │
                      └──(脱离)────────┘
```
