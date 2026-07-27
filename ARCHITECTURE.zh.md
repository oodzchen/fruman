# sl2d 游戏架构文档

## 项目概述

基于 **ECS（Entity-Component-System）** 架构和 **Web Worker 多线程** 设计的高性能 2D 横版格斗游戏，目标帧率 60 FPS / 100+ 角色同屏。

**技术栈**

| 类别       | 技术                                            |
| ---------- | ----------------------------------------------- |
| 渲染引擎   | Pixi.js v8 (默认 WebGL，Canvas 回退，可选 WebGPU) |
| 物理引擎   | Box2D3-WASM v5.1                                |
| 骨骼动画   | Spine Pixi v4.2                                 |
| 粒子系统   | @pixi/particle-emitter                          |
| 几何算法   | d3-delaunay, clipper2-wasm, poly-decomp-es      |
| 编辑器画布 | fabric.js v7                                    |
| 构建工具   | Vite v8 + TypeScript 5 strict                   |
| 代码质量   | ESLint v10 + Prettier                           |

---

## 整体架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                         浏览器主线程                              │
│                                                                  │
│ main.ts                                                          │
│ ├── GameClient                                                   │
│ │   ├── Pixi Application / Ticker                                │
│ │   ├── ClientRenderer（状态解码、HUD 与特效数据）               │
│ │   ├── PixiWorldRenderer（世界场景）                            │
│ │   ├── WorldLightingController / DayNightCycle                  │
│ │   └── AudioManager / MenuManager / LevelUpManager              │
│ ├── EditorManager                                                │
│ └── DisplayManager / InitializationManager                       │
└───────────────────────────────┬──────────────────────────────────┘
                                │ postMessage
                                │ SharedArrayBuffer / ArrayBuffer
┌───────────────────────────────▼──────────────────────────────────┐
│                         Worker 线程                              │
│                                                                  │
│ gameWorker.ts                                                    │
│ ├── 固定步长循环（60 Hz）                                       │
│ ├── ECS World / EntityManager / ComponentRegistry               │
│ ├── Box2D WASM / SpatialHash / 碰撞与地图运行时                  │
│ └── 输入、相机、状态导出、掉落物和可破坏物运行时                │
└──────────────────────────────────────────────────────────────────┘
```

---

## 线程通信协议

```
主线程                                          Worker 线程
   │                                                 │
   │ ── MainToWorkerMessage ──────────────────────► │  初始化、输入、控制、地图、存档
   │                                                 │
   │ ◄── WorkerStateMessage ────────────────────────  │  实体、特效、绳索点与相机
   │ ◄── 事件消息 ──────────────────────────────────  │  地图、调试、性能、存档、关卡状态
```

`WorkerStateMessage` 使用一个 `Float32Array` 分区承载状态：

```
实体区: 每实体 96 个 float32（标识/位置/状态、武器、抓钩、技能、骨骼运动）
特效区: 每事件 6 个 float32，最多 256 个
绳索区: 每点 2 个 float32，最多 384 个
```

具体偏移以 `src/worker/binaryProtocol.ts` 和 `src/worker/effectsProtocol.ts` 为准。跨源隔离可用时复用 `SharedArrayBuffer`；否则使用双缓冲 `ArrayBuffer` 并转移所有权。

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
  TransformComponent      位置 (x, y)、旋转
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
  NpcAIComponent          战斗决策状态、巡逻配置、目标与感知缓存
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

 1. StatsSystem
 2. CheckpointSystem
 3. SoundSystem
 4. NpcAISystem
 5. FollowSystem
 6. MovementSystem
 7. GrappleSystem
 8. SpineSegmentManager
 9. SkeletalSegmentManager
10. PhysicsSystem
11. WeaponSystem
12. ArrowSystem
13. TargetingSystem
14. InteractionSystem

World 更新后:
  SunPickupSystem → ExpOrbSystem → AttackPickupSystem → 清理 → CameraDirector
```

`MovementSystem` 位于 `PhysicsSystem` 之前，以便当前固定步内施加的力参与 Box2D 步进。`SkillHandler` 和 `UltimateHandler` 是 `WeaponSystem` 的内部协作对象，不是独立 ECS 系统。

---

## 渲染架构

```
主线程 Pixi Ticker
│
▼
GameClient
│
├── ClientRenderer
│   ├── 读取状态缓冲区 → 实体/特效/绳索状态
│   ├── ParticleSystem (粒子数据池, 容量 600)
│   └── HudWeaponSlotRenderer / 输入反馈
│
├── PixiWorldRenderer (Pixi.js Application)
│   ├── 摄像机变换 (平移/缩放)
│   ├── 视锥剔除 (只渲染可见实体, MAX_ENTITY_VIEW_CACHE=512)
│   ├── BodyRenderer / SpineBodyManager / SkeletalPoseDriver
│   ├── WeaponRenderer (纹理缓存上限 192)
│   └── 粒子显示与发射器池
│
├── TerrainRenderer / ProceduralEnvironmentFactory
│   └── 分块静态场景构建与缓存
│
├── WorldLightingController / DayNightCycle
│
└── AudioManager (Web Audio API)
    ├── 预加载并缓存音频资源
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
GameClient 的 viewport 键盘事件
       │ inputState 更新
       ▼
worker.postMessage(WorkerInputMessage)
       │
       ▼
gameWorker 接收
       │ WorkerInputController.handleInput(...)
       │ InputComponent 更新
       ▼
ECS World.update(deltaTime)
       │
       ├─ MovementSystem: InputComponent → 线性速度 (Box2D)
       ├─ NpcAISystem: 感知玩家 → 生成敌人 InputComponent
       ├─ WeaponSystem: InputComponent.attack → 武器状态机转移
       └─ WeaponSystem / ArrowSystem: SpatialHash 查询 → StatsSystem 结算
              │
              ├─ 更新 StatsComponent (血量、架势)
              └─ WorkerFrameStateExporter 写入状态、特效和绳索分区
                        │
                        ▼ SharedArrayBuffer / ArrayBuffer
               主线程 ClientRenderer
                        │
                        ├─ 解码实体、特效与绳索状态
                        ├─ PixiWorldRenderer 渲染世界
                        ├─ 粒子特效播放
                        └─ AudioManager 音效播放
```

---

## 性能优化

### 策略汇总

| 优化手段   | 实现                                              |
| ---------- | ------------------------------------------------- |
| 空间分区   | SpatialHash 网格限制范围查询候选集                |
| 对象复用   | ArrowPools、EntityComponentPool、粒子和渲染缓存池 |
| 可见性裁剪 | PixiWorldRenderer 只更新可见实体                  |
| 固定步长   | Worker 累加 delta time，以 60 Hz 推进游戏状态     |
| 组件缓存   | Entity 常用组件字段避免重复 Map 查询              |
| 状态传输   | SharedArrayBuffer；不可用时复用 ArrayBuffer       |
| 位掩码过滤 | ComponentRegistry + World 系统实体缓存            |
| 资源缓存   | 武器、身体、Spine 和程序化环境纹理缓存            |

主线程和 Worker 均内置性能采样；使用 `?perf=1` 显示并按阈值输出数据。性能结论应以这些采样为准，不在文档中固化估算耗时。

---

## 目录结构

```
src/
├── ecs/          ECS 核心、组件、系统、对象池与碰撞算法
├── worker/       Worker 入口、运行时控制器和通信协议
├── renderer/     Pixi 世界渲染、光照、粒子、身体与武器绘制
├── terrain/      地形数据、几何、碰撞、分块与渲染
├── editor/       编辑器控制器，以及 bodyDrawer/、terrain/ 子模块
├── main.ts       页面入口与游戏/编辑器编排
├── GameClient.ts 主线程游戏生命周期、输入和渲染循环
└── ClientRenderer.ts 状态解码、HUD、特效与共享绘制逻辑

public/
├── animations/   Spine 资源
├── audios/       音频资源
├── images/       图像与预设资源
├── lang/         中英文文本
└── map_data/     默认地图
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

`vite.config.ts` 为开发和预览服务注入必需响应头：

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

生产部署也必须提供相同响应头。不支持跨源隔离时，状态同步自动降级为复用的 `ArrayBuffer` + `postMessage`。

### 武器状态机

```
idle ──(攻击键)──► windup ──► swing ──► pause ──(攻击键, ≤5段)──► windup
                                            │
                                            └──(超时)──► recover ──► idle
```

### AI 状态机

```
idle / alert ──► approach ──► pacing / probe ──► combo
                    ▲                                │
                    └──────── retreat ◄──────────────┘
                    │
                    └──────── leapAttack ────────────┘
```
