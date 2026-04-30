import {
  Application,
  BlurFilter,
  Container,
  Graphics,
  Matrix,
  Sprite,
  Text,
  Texture,
  TilingSprite,
} from 'pixi.js'

import { AudioManager } from './AudioManager'
import { ClientRenderer } from './ClientRenderer'
import { DialogManager } from './DialogManager'
import type { DisplayManager } from './DisplayManager'
import { LevelUpManager } from './LevelUpManager'
import { localizer } from './Localizer'
import { MenuAction, MenuManager, MenuMode } from './MenuManager'
import { saveManager } from './SaveManager'
import {
  CATERPILLAR_ATLAS_KEY,
  CATERPILLAR_SPINE_KEY,
  CATERPILLAR_SPINE_SCALE,
  DEBUG_DRAW_TERRAIN_COLLISION_SHAPE,
  TERRAIN_COLLISION_DEBUG_ALPHA,
  TERRAIN_COLLISION_DEBUG_COLOR,
  TERRAIN_COLLISION_DEBUG_LINE_WIDTH,
} from './constants'
import type { EditorMapData, MapEnvironmentObject } from './editorMapTypes'
import {
  computeDistanceAttenuation,
  getSoundFalloffDistance,
} from './effectAttenuation'
import {
  ensureRuntimeEnvironmentAssetsForMap,
  getRuntimeEnvironmentAsset,
} from './environmentAssetRegistry'
import { buildEnvironmentFlowerOptionsCacheKey } from './environmentFlowerOptions'
import {
  type EnvironmentTransformOffset,
  getEnvironmentRotationDeg,
  getEnvironmentScaleXPermille,
  getEnvironmentScaleYPermille,
  writeEnvironmentTransformedOffset,
} from './environmentTransformUtils'
import {
  buildMapObjectLayerLookup,
  collectStaticRenderLayers,
} from './mapObjectLayers'
import { getDefaultNpcBodyProfile } from './npcBodyProfileUtils'
import type { PlayerUpgradeStat } from './playerUpgrade'
import { getDefaultTerrainRenderLayer } from './renderLayers'
import {
  DayNightCycle,
  getMapTimePhaseElapsedMs,
} from './renderer/DayNightCycle'
import { InteractiveGrassDecoration } from './renderer/EnvironmentGrassRuntime'
import { PixiWorldRenderer } from './renderer/PixiWorldRenderer'
import {
  buildCustomEnvironmentTextureCacheKey,
  buildEnvironmentTextureCacheKey,
  clearEnvironmentTextureSourceCache,
  createCustomEnvironmentTextureSource,
  createEnvironmentTextureSource,
  isEnvironmentCellStrokeSupported,
  pruneEnvironmentTextureSourceCache,
} from './renderer/ProceduralEnvironmentFactory'
import { PixiRenderContext2D } from './renderer/RenderContext2D'
import {
  acquireSpine,
  loadSpineAssets,
  releaseSpine,
  storeSpinePreview,
} from './renderer/SpineBodyManager'
import { WorldLightingController } from './renderer/WorldLightingController'
import type { SaveData } from './saveTypes'
import { normalizeCharacterBodyMapProfiles } from './skeletalBodyProfile'
import { buildSpineCollisionKeyframes } from './spineCollisionKeyframes'
import { getDefaultMap } from './storage'
import { TerrainCollisionBuilder } from './terrain/TerrainCollisionBuilder'
import {
  getTerrainLayerViews,
  hasTerrainContent,
} from './terrain/TerrainDataUtils'
import type { TerrainResolvedLayerView } from './terrain/TerrainDataUtils'
import { TerrainRenderer } from './terrain/TerrainRenderer'
import type {
  TerrainContourLike,
  TerrainDataLike,
  TerrainLayerLike,
} from './terrain/TerrainTypes'
import { getVoronoiBuildPerfSnapshot } from './terrain/VoronoiBuilder'
import { VoronoiCollisionBuilder } from './terrain/VoronoiCollisionBuilder'
import {
  ENTITY_STRIDE,
  FLAGS,
  MAX_ENTITIES,
  OFFSETS,
  WEAPON_TYPES,
} from './worker/binaryProtocol'
import { SOUND_IDS } from './worker/effectsProtocol'
import GameWorker from './worker/gameWorker?worker'
import type {
  CameraDebugData,
  MainToWorkerMessage,
  WorkerInputMessage,
  WorkerPerfSnapshotMessage,
  WorkerPlayerLevelUpMessage,
  WorkerSaveResponseMessage,
  WorkerSpineCollisionDataMessage,
  WorkerToMainMessage,
} from './worker/protocol'

interface PixiApplicationInitResult {
  app: Application
  rendererLabel: 'webgpu' | 'webgl' | 'canvas'
}

interface EnvironmentTextureEntry {
  key: string
  texture: Texture
  centerAnchorX: number
  centerAnchorY: number
  anchorOffsetX: number
  anchorOffsetY: number
}

type SleepTransitionPhase = 'idle' | 'closing' | 'closed' | 'opening'

const PASS_THROUGH_GRASS_VOLUME = 0.72
const GRASS_DYNAMIC_VIEW_PADDING_X_METERS = 4
const GRASS_DYNAMIC_VIEW_PADDING_Y_METERS = 3
const GRASS_INTERACTION_GRID_CELL_METERS = 3
const GRASS_INTERACTION_GRID_KEY_OFFSET = 32768
const GRASS_INTERACTION_GRID_KEY_MASK = 0xffff
const FOLIAGE_CUT_MAX_BURSTS_PER_FRAME = 8
const FOLIAGE_CUT_DEBRIS_CHANCE_DENOMINATOR = 2

export class GameClient {
  private static readonly START_MENU_CAMERA_STABLE_MS = 150
  private static readonly PREVIEW_CAPTURE_MIN_RENDER_FRAMES = 6
  private static readonly PREVIEW_CAPTURE_STABLE_FRAMES = 3
  private static readonly PREVIEW_CAPTURE_MAX_RENDER_FRAMES = 24
  private static readonly DEFAULT_PIXELS_PER_METER = 50
  private static readonly PERF_DEBUG_QUERY_PARAM = 'perf'
  private static readonly STATIC_SCENE_BUILD_BUDGET_MS = 2
  private static readonly PERF_LOG_HEARTBEAT_WINDOWS = 12
  private static readonly PERF_LOG_FRAME_WARN_US = 18000
  private static readonly PERF_LOG_FRAME_MAX_WARN_US = 30000
  private static readonly PERF_LOG_FRAME_SPIKE_GUARD_US = 6000
  private static readonly PERF_LOG_WORLD_WARN_US = 12000
  private static readonly PERF_LOG_WORKER_WARN_US = 12000
  private static readonly PERF_LOG_SYSTEM_WARN_US = 4000
  private static readonly PERF_LOG_STATIC_BUILD_WARN_US = 3000
  private static readonly PERF_LOG_GRASS_WARN_US = 3000
  private static readonly ENVIRONMENT_TEXTURE_CACHE_LIMIT = 96
  private static readonly SLEEP_CLOSE_DURATION_MS = 640
  private static readonly SLEEP_BLACKOUT_DURATION_MS = 1000
  private static readonly SLEEP_OPEN_DURATION_MS = 320
  private static readonly SLEEP_MAX_BLUR_STRENGTH = 12
  private static readonly SLEEP_OVERLAY_BLUR_STRENGTH = 24
  private static readonly SLEEP_OVERLAY_OVERSCAN_PX = 96
  private worker: Worker
  private app: Application
  private appCanvas: HTMLCanvasElement

  // PixiJS scene elements
  private backgroundSprite: TilingSprite | null = null
  private readonly dayNightCycle = new DayNightCycle()
  private fpsTextEl: Text | null = null
  private sceneContainer: Container
  private lightingContainer: Container
  private lightingFilterApplied = false
  private worldContainer: Container
  private glowContainer: Container
  private emissiveContainer: Container
  private hudContainer: Container
  private sleepOverlayContainer: Container
  private sleepOverlayGraphics: Graphics
  private sleepBlurFilter: BlurFilter
  private sleepSceneFilters: BlurFilter[]
  private sleepOverlayBlurFilter: BlurFilter
  private sleepOverlayFilters: BlurFilter[]
  private worldRenderContext: PixiRenderContext2D
  private hudRenderContext: PixiRenderContext2D
  private staticTerrainGraphics: Container[] = []
  private staticEnvironmentSprites: Sprite[] = []
  private interactiveGrassDecorations: InteractiveGrassDecoration[] = []
  private readonly interactiveGrassGrid = new Map<
    number,
    Map<number, InteractiveGrassDecoration[]>
  >()
  private grassDynamicInViewFlags = new Uint8Array(0)
  private grassInteractionGridCellSizePx = Math.max(
    1,
    Math.round(
      GameClient.DEFAULT_PIXELS_PER_METER * GRASS_INTERACTION_GRID_CELL_METERS
    )
  )
  private grassInteractionQueryId = 1
  private pendingStaticTerrainGraphics: Container[] = []
  private pendingStaticTerrainGraphicLayers: number[] = []
  private staticTerrainSignature = 0
  private staticEnvironmentSignature = 0
  private staticTerrainReady = false
  private staticEnvironmentReady = false
  private staticSceneTextureCacheDisabled = false
  private pendingStaticTerrainSignature = 0
  private pendingStaticTerrainLayers: TerrainResolvedLayerView[] | null = null
  private pendingStaticTerrainLayerIndex = 0
  private pendingStaticTerrainChunkIndex = 0
  private pendingStaticTerrainTaskIndex = 0
  private pendingStaticTerrainTaskTotal = 0
  private pendingStaticEnvironmentSignature = 0
  private pendingStaticEnvironmentObjects: MapEnvironmentObject[] | null = null
  private pendingStaticEnvironmentLayers: number[] | null = null
  private pendingStaticEnvironmentIndex = 0
  private environmentAssetPreloadRevision = 0
  private readonly environmentTextureCache = new Map<
    string,
    EnvironmentTextureEntry
  >()
  private readonly activeEnvironmentTextureKeys = new Set<string>()
  private readonly pendingEnvironmentTextureKeys = new Set<string>()
  private readonly reusableEnvironmentAnchorOffset: EnvironmentTransformOffset =
    {
      x: 0,
      y: 0,
    }
  private readonly reusableDOMMatrix = new DOMMatrix()
  private readonly reusablePixiMatrix = new Matrix()
  private worldRenderer: PixiWorldRenderer
  private lightingController: WorldLightingController

  private renderer: ClientRenderer
  private audioManager: AudioManager
  private menuManager: MenuManager
  private dialogManager: DialogManager
  private levelUpManager: LevelUpManager
  private pixelsPerMeter = GameClient.DEFAULT_PIXELS_PER_METER

  private camera = { x: 0, y: 0 }
  private rendererLabel: 'webgpu' | 'webgl' | 'canvas'
  private readonly perfDebugEnabled: boolean
  private renderFps = 0
  private fpsText = '0 FPS'
  private lastDeltaTime = 0
  private frameCount = 0
  private fpsUpdateTime = 0
  private perfSampleCount = 0
  private perfFrameTimeTotalUs = 0
  private perfFrameTimeMaxUs = 0
  private perfUpdateTimeTotalUs = 0
  private perfRenderTimeTotalUs = 0
  private perfWorldTimeTotalUs = 0
  private perfLightingTimeTotalUs = 0
  private perfSceneRenderTimeTotalUs = 0
  private perfHudTimeTotalUs = 0
  private perfMenuTimeTotalUs = 0
  private perfFrameAvgUs = 0
  private perfFrameMaxUs = 0
  private perfUpdateAvgUs = 0
  private perfRenderAvgUs = 0
  private perfWorldAvgUs = 0
  private perfLightingAvgUs = 0
  private perfSceneRenderAvgUs = 0
  private perfHudAvgUs = 0
  private perfMenuAvgUs = 0
  private perfStateSyncTotalUs = 0
  private perfStateSyncAvgUs = 0
  private perfEffectsApplyTotalUs = 0
  private perfEffectsApplyAvgUs = 0
  private perfStaticBuildTotalUs = 0
  private perfStaticBuildAvgUs = 0
  private perfStaticBuildMaxUs = 0
  private perfStaticBuildCount = 0
  private perfTerrainBuildTotalUs = 0
  private perfTerrainBuildAvgUs = 0
  private perfTerrainBuildMaxUs = 0
  private perfTerrainBuildCount = 0
  private perfEnvironmentBuildTotalUs = 0
  private perfEnvironmentBuildAvgUs = 0
  private perfEnvironmentBuildMaxUs = 0
  private perfEnvironmentBuildCount = 0
  private perfEnvironmentCacheHits = 0
  private perfEnvironmentCacheMisses = 0
  private perfGrassUpdateTotalUs = 0
  private perfGrassUpdateAvgUs = 0
  private perfGrassUpdateMaxUs = 0
  private perfGrassCountTotal = 0
  private perfGrassCountAvg = 0
  private perfGrassInViewTotal = 0
  private perfGrassInViewAvg = 0
  private perfGrassInteractorTotal = 0
  private perfGrassInteractorAvg = 0
  private perfGrassCandidateTotal = 0
  private perfGrassCandidateAvg = 0
  private perfGrassInteractionTestTotal = 0
  private perfGrassInteractionTestAvg = 0
  private perfGrassDynamicTotal = 0
  private perfGrassDynamicAvg = 0
  private lastRenderTimeUs = 0
  private lastWorldRenderTimeUs = 0
  private lastLightingTimeUs = 0
  private lastSceneRenderTimeUs = 0
  private lastHudRenderTimeUs = 0
  private lastMenuRenderTimeUs = 0
  private lastPlayerUITimeUs = 0
  private lastStateSyncTimeUs = 0
  private lastEffectsApplyTimeUs = 0
  private lastStaticBuildTimeUs = 0
  private lastTerrainBuildTimeUs = 0
  private lastEnvironmentBuildTimeUs = 0
  private renderFrameRevision = 0
  private workerStateRevision = 0
  private workerPerfSnapshot: WorkerPerfSnapshotMessage | null = null
  private perfLogWindowsSinceEmit = 0
  private perfLastStaticQueueActive = false
  private destroyed = false

  private hasReceivedFirstState = false
  private isFirstFrameRendered = false
  private onFirstFrameRendered?: () => void

  // Input State
  private keys = new Set<string>()
  private mouseButtons = new Set<number>()
  private keysArray: string[] = []
  private mouseButtonsArray: number[] = []
  private targetZoom = 1.0
  private renderZoom = 1.0
  private worldTimeScale1000 = 1000
  private mouseX = 0
  private mouseY = 0
  private mouseCaptured = false
  private mouseInside = false
  private inputEnabled = true
  private editorOverlay: HTMLDivElement | null = null
  private inputTarget: HTMLElement
  private previewActionsContainer: HTMLDivElement | null = null
  private previewExitBtn: HTMLButtonElement | null = null
  private previewPauseBtn: HTMLButtonElement | null = null
  private previewActive = false
  private previewAwaitStateRevision = 0
  private previewFirstRenderRevision = 0
  private previewCameraStableFrames = 0
  private previewTrackedCameraX = 0
  private previewTrackedCameraY = 0
  private previewTrackedZoom = 1000
  private onExitPreviewCallback?: () => void
  private cameraDebug: CameraDebugData & { enabled: boolean } = {
    topLimitRatio: 0.5,
    bottomLimitRatio: 0.95,
    playerScreenY: 0,
    playerFeetY: 0,
    cameraY: 0,
    zoom: 1,
    isOutsideVerticalZone: false,
    enabled: false,
  }

  // Reusable message object for input
  private inputMessage: WorkerInputMessage = {
    type: 'input',
    keys: [],
    mouseButtons: [],
    mouseZoom: 1.0,
    mouseX: 0,
    mouseY: 0,
    mouseDeltaX: 0,
    mouseDeltaY: 0,
    mouseCaptured: false,
  }

  // Cached bound functions
  private boundHandleWorkerMessage: (
    e: MessageEvent<WorkerToMainMessage>
  ) => void
  private boundHandleAutoFocusPointerDown: (event: PointerEvent) => void
  private boundHandleAutoFocusIn: (event: FocusEvent) => void
  private focusOptions: FocusOptions = { preventScroll: true }

  private editorPreview = false
  private currentMapData: EditorMapData | null = null
  private staticRenderLayers: number[] = []

  private currentSaveId: string | null = null
  private currentSaveData: SaveData | null = null
  private pendingSaveResolve: ((meta: SaveData | null) => void) | null = null
  private pendingSaveThumbnail: string | null = null
  private pendingCheckpointAutosave = false
  private pendingCheckpointCapture = false
  private pendingCheckpointCaptureAfterState = false
  private autoReloadPending = false
  private onEditorActionCallback?: () => void
  private onExitActionCallback?: () => Promise<boolean>
  private pendingStartMenuDelayMs = -1
  private pendingStartMenuSkipAnimation = false
  private startMenuPauseArmed = false
  private startMenuStableElapsedMs = 0
  private lastStartMenuCameraX = 0
  private lastStartMenuCameraY = 0
  private sleepTransitionPhase: SleepTransitionPhase = 'idle'
  private sleepTransitionElapsedMs = 0
  private sleepTransitionMidpointHandled = false
  private readonly grassInteractorX = new Int32Array(MAX_ENTITIES)
  private readonly grassInteractorY = new Int32Array(MAX_ENTITIES)
  private readonly grassInteractorLayer = new Int32Array(MAX_ENTITIES)
  private readonly grassInteractorDeltaX = new Int32Array(MAX_ENTITIES)
  private readonly grassInteractorDeltaY = new Int32Array(MAX_ENTITIES)
  private readonly grassInteractorWeaponX = new Int32Array(MAX_ENTITIES)
  private readonly grassInteractorWeaponY = new Int32Array(MAX_ENTITIES)
  private readonly grassInteractorWeaponCutting = new Uint8Array(MAX_ENTITIES)
  private readonly grassInteractorPrevX = new Map<number, number>()
  private readonly grassInteractorPrevY = new Map<number, number>()

  static async create(
    menuOverlay: HTMLDivElement,
    inputTarget: HTMLElement,
    onInitProgress?: (step: string) => void
  ): Promise<GameClient> {
    onInitProgress?.('init_renderer')
    const { app, rendererLabel } = await this.createPixiApplication(inputTarget)
    const appCanvas = app.canvas as HTMLCanvasElement
    appCanvas.id = 'gameCanvas'
    appCanvas.classList.add('game-canvas')
    inputTarget.prepend(appCanvas)
    await loadSpineAssets(
      CATERPILLAR_SPINE_KEY,
      '/animations/caterpillar_move/paxing_ske.json',
      CATERPILLAR_ATLAS_KEY,
      '/animations/caterpillar_move/paxing_tex.atlas'
    )
    const previewSpine = acquireSpine(CATERPILLAR_SPINE_KEY)
    if (previewSpine) {
      previewSpine.scale.set(CATERPILLAR_SPINE_SCALE)
      previewSpine.update(0)
      const extracted = app.renderer.extract.canvas(previewSpine)
      storeSpinePreview(CATERPILLAR_SPINE_KEY, extracted as HTMLCanvasElement)
      releaseSpine(CATERPILLAR_SPINE_KEY, previewSpine)
    }
    const spineCollisionMessages: WorkerSpineCollisionDataMessage[] = []
    const caterpillarBodyProfile = getDefaultNpcBodyProfile('caterpillar')
    if (caterpillarBodyProfile) {
      const collisionData = buildSpineCollisionKeyframes(
        'caterpillar',
        caterpillarBodyProfile,
        GameClient.DEFAULT_PIXELS_PER_METER
      )
      if (collisionData) {
        spineCollisionMessages.push({
          type: 'spine_collision_data',
          data: collisionData,
        })
      }
    }
    return new GameClient(
      app,
      rendererLabel,
      menuOverlay,
      inputTarget,
      spineCollisionMessages,
      onInitProgress
    )
  }

  private static async createPixiApplication(
    inputTarget: HTMLElement
  ): Promise<PixiApplicationInitResult> {
    const rendererParam = new URLSearchParams(window.location.search).get(
      'renderer'
    )
    const requestedPreference =
      rendererParam === 'webgpu' ||
      rendererParam === 'webgl' ||
      rendererParam === 'canvas'
        ? rendererParam
        : null
    const preferences: Array<'webgpu' | 'webgl' | 'canvas'> =
      requestedPreference === 'webgpu'
        ? ['webgpu', 'webgl', 'canvas']
        : requestedPreference === 'canvas'
          ? ['canvas', 'webgl', 'webgpu']
          : ['webgl', 'webgpu', 'canvas']
    let lastError: unknown = null

    for (let i = 0; i < preferences.length; i++) {
      const preference = preferences[i]
      const app = new Application()
      try {
        await app.init({
          resizeTo: inputTarget,
          antialias: false,
          autoDensity: true,
          resolution: 1,
          preserveDrawingBuffer: false,
          preference,
          powerPreference: 'high-performance',
          webgpu: {
            antialias: false,
          },
          webgl: {
            antialias: false,
          },
          canvasOptions: {},
        })
        console.info('[Renderer]', preference)
        return {
          app,
          rendererLabel: preference,
        }
      } catch (error) {
        lastError = error
        app.destroy(true)
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Failed to initialize Pixi renderer')
  }

  private static readPerfDebugFlag(): boolean {
    return (
      new URLSearchParams(window.location.search).get(
        GameClient.PERF_DEBUG_QUERY_PARAM
      ) === '1'
    )
  }

  private constructor(
    app: Application,
    rendererLabel: 'webgpu' | 'webgl' | 'canvas',
    menuOverlay: HTMLDivElement,
    inputTarget: HTMLElement,
    spineCollisionMessages: WorkerSpineCollisionDataMessage[],
    onInitProgress?: (step: string) => void
  ) {
    this.app = app
    this.appCanvas = app.canvas as HTMLCanvasElement
    this.rendererLabel = rendererLabel
    this.perfDebugEnabled = GameClient.readPerfDebugFlag()

    const width = app.renderer.width
    const height = app.renderer.height

    // PixiJS scene hierarchy
    onInitProgress?.('init_textures')
    this.sceneContainer = new Container()
    this.sceneContainer.sortableChildren = true
    this.sceneContainer.filterArea = app.screen
    app.stage.addChild(this.sceneContainer)

    // 天空背景：纯色矩形，通过 tint 实现昼夜颜色渐变
    this.backgroundSprite = new TilingSprite({
      texture: Texture.WHITE,
      width,
      height,
    })
    const initLightingState = this.dayNightCycle.getLightingState()
    this.backgroundSprite.tint = initLightingState.sky
    this.sceneContainer.addChild(this.backgroundSprite)

    this.lightingContainer = new Container()
    this.lightingContainer.sortableChildren = true
    this.lightingContainer.filterArea = app.screen
    this.sceneContainer.addChild(this.lightingContainer)
    this.worldContainer = new Container()
    this.worldContainer.sortableChildren = true
    this.lightingContainer.addChild(this.worldContainer)
    this.glowContainer = new Container()
    this.glowContainer.zIndex = -10000
    this.worldContainer.addChild(this.glowContainer)
    this.emissiveContainer = new Container()
    this.emissiveContainer.sortableChildren = true
    this.sceneContainer.addChild(this.emissiveContainer)
    this.lightingController = new WorldLightingController(
      this.glowContainer,
      this.pixelsPerMeter
    )
    this.lightingFilterApplied = this.lightingController.isFilterActive()
    this.lightingContainer.filters = null

    this.hudContainer = new Container()
    this.hudContainer.sortableChildren = true
    this.sceneContainer.addChild(this.hudContainer)

    this.sleepOverlayContainer = new Container()
    this.sleepOverlayContainer.sortableChildren = true
    this.sleepOverlayContainer.visible = false
    this.sleepOverlayContainer.filterArea = app.screen
    app.stage.addChild(this.sleepOverlayContainer)

    this.sleepOverlayGraphics = new Graphics()
    this.sleepOverlayGraphics.visible = false
    this.sleepOverlayContainer.addChild(this.sleepOverlayGraphics)

    this.sleepBlurFilter = new BlurFilter({
      strength: 0,
      quality: 2,
      kernelSize: 5,
    })
    this.sleepBlurFilter.repeatEdgePixels = true
    this.sleepSceneFilters = [this.sleepBlurFilter]
    this.sleepOverlayBlurFilter = new BlurFilter({
      strength: GameClient.SLEEP_OVERLAY_BLUR_STRENGTH,
      quality: 2,
      kernelSize: 5,
    })
    this.sleepOverlayBlurFilter.repeatEdgePixels = true
    this.sleepOverlayFilters = [this.sleepOverlayBlurFilter]
    this.sleepOverlayContainer.filters = this.sleepOverlayFilters

    this.worldRenderContext = new PixiRenderContext2D(
      this.worldContainer,
      width,
      height
    )
    this.hudRenderContext = new PixiRenderContext2D(
      this.hudContainer,
      width,
      height
    )

    // FPS text
    this.fpsTextEl = new Text({
      text: this.fpsText,
      style: {
        fontFamily: 'monospace',
        fontSize: 14,
        lineHeight: 17,
        fill: '#00ff00',
        stroke: { color: '#000000', width: 3 },
      },
    })
    this.fpsTextEl.anchor.set(1, 0)
    this.fpsTextEl.position.set(width - 10, 10)
    this.hudContainer.addChild(this.fpsTextEl)

    // Renderer + managers
    this.renderer = new ClientRenderer(
      this.worldRenderContext,
      this.hudRenderContext,
      this.pixelsPerMeter
    )
    this.renderer.setSpineCollisionProfiles(
      spineCollisionMessages.map((message) => message.data)
    )
    this.worldRenderer = new PixiWorldRenderer(
      this.worldContainer,
      this.emissiveContainer,
      this.pixelsPerMeter
    )
    this.audioManager = new AudioManager()
    this.menuManager = new MenuManager(this.appCanvas, menuOverlay, inputTarget)
    this.inputTarget = inputTarget
    if (this.inputTarget.tabIndex < 0) {
      this.inputTarget.tabIndex = 0
    }
    this.dialogManager = new DialogManager(this.inputTarget, this.inputTarget)
    this.levelUpManager = new LevelUpManager(this.inputTarget, this.inputTarget)
    this.levelUpManager.setSelectionHandler((stat) => {
      this.handleLevelUpSelection(stat)
    })
    this.menuManager.setDialogManager(this.dialogManager)
    this.renderer.setAudioManager(this.audioManager)
    const editorOverlay = document.getElementById('editorOverlay')
    this.editorOverlay =
      editorOverlay instanceof HTMLDivElement ? editorOverlay : null

    const previewActions = document.getElementById('previewActions')
    this.previewActionsContainer =
      previewActions instanceof HTMLDivElement ? previewActions : null

    const previewExitBtn = document.getElementById('previewExitBtn')
    this.previewExitBtn =
      previewExitBtn instanceof HTMLButtonElement ? previewExitBtn : null
    if (this.previewExitBtn) {
      this.previewExitBtn.textContent = localizer.t('editor_exit_preview')
      this.previewExitBtn.addEventListener('click', () => {
        this.exitPreview()
      })
    }

    const previewPauseBtn = document.getElementById('previewPauseBtn')
    this.previewPauseBtn =
      previewPauseBtn instanceof HTMLButtonElement ? previewPauseBtn : null
    if (this.previewPauseBtn) {
      this.previewPauseBtn.textContent = localizer.t('ui_pause')
      this.previewPauseBtn.addEventListener('click', () => {
        this.togglePreviewPause()
      })
    }

    // Bind handlers
    this.boundHandleWorkerMessage = this.handleWorkerMessage.bind(this)
    this.boundHandleAutoFocusPointerDown =
      this.handleAutoFocusPointerDown.bind(this)
    this.boundHandleAutoFocusIn = this.handleAutoFocusIn.bind(this)

    // Initialize Worker
    onInitProgress?.('init_game_logic')
    this.worker = new GameWorker()
    this.worker.onmessage = this.boundHandleWorkerMessage

    for (let i = 0; i < spineCollisionMessages.length; i++) {
      const message = spineCollisionMessages[i]
      this.worker.postMessage(message, [message.data.boneTransforms])
    }

    this.worker.postMessage({
      type: 'init',
      canvasWidth: width,
      canvasHeight: height,
      pixelsPerMeter: this.pixelsPerMeter,
    } as MainToWorkerMessage)

    onInitProgress?.('init_input')
    this.setupInput()
    this.setupAudioResume()

    onInitProgress?.('init_audio')
    this.audioManager.init().catch((error) => {
      console.error('Failed to initialize audio:', error)
    })

    this.setupMenuActions()

    // Resize: sync Pixi render surfaces and notify worker
    app.renderer.on('resize', (newWidth: number, newHeight: number) => {
      this.sceneContainer.filterArea = this.app.screen
      this.lightingContainer.filterArea = this.app.screen
      this.sleepOverlayContainer.filterArea = this.app.screen
      if (this.backgroundSprite) {
        this.backgroundSprite.width = newWidth
        this.backgroundSprite.height = newHeight
      }
      this.worldRenderContext.resize(newWidth, newHeight)
      this.hudRenderContext.resize(newWidth, newHeight)
      if (this.fpsTextEl) {
        this.fpsTextEl.position.set(newWidth - 10, 10)
      }
      this.worker.postMessage({
        type: 'resize',
        canvasWidth: newWidth,
        canvasHeight: newHeight,
      } as MainToWorkerMessage)
    })

    // Ticker-based render loop (replaces requestAnimationFrame)
    app.ticker.add(() => this.renderLoopTick())
  }

  setInputEnabled(enabled: boolean) {
    this.inputEnabled = enabled
  }

  setDisplayManager(displayManager: DisplayManager): void {
    this.menuManager.setDisplayManager(displayManager)
    displayManager.setOnResolutionChange((preset) => {
      // Force Pixi to resize immediately to match new container size
      // This prevents blank areas by ensuring all render targets sync synchronously
      this.app.renderer.resize(preset.width, preset.height)
      this.sceneContainer.filterArea = this.app.screen
      this.lightingContainer.filterArea = this.app.screen
      this.sleepOverlayContainer.filterArea = this.app.screen

      // Manually trigger background and context sync if resize event hasn't fired yet
      if (this.backgroundSprite) {
        this.backgroundSprite.width = preset.width
        this.backgroundSprite.height = preset.height
      }
      this.worldRenderContext.resize(preset.width, preset.height)
      this.hudRenderContext.resize(preset.width, preset.height)
      if (this.fpsTextEl) {
        this.fpsTextEl.position.set(preset.width - 10, 10)
      }
      this.worker.postMessage({
        type: 'resize',
        canvasWidth: preset.width,
        canvasHeight: preset.height,
      } as MainToWorkerMessage)

      // Re-render immediately to show the change
      this.renderLoopTick()
    })
  }

  setEditorPreview(enabled: boolean) {
    this.editorPreview = enabled
    if (enabled) {
      this.camera.x = 0
      this.camera.y = 0
      this.targetZoom = 1
      this.renderZoom = 1
      this.cameraDebug.enabled = false
      this.setPreviewExitVisible(false)
    }
  }

  applyMapPreview(
    map: EditorMapData,
    options?: { thumbnailCapture?: boolean }
  ) {
    const normalizedMap = normalizeCharacterBodyMapProfiles(map) ?? map
    this.setEditorPreview(false)
    this.previewActive = true
    this.previewAwaitStateRevision = this.workerStateRevision + 1
    this.previewFirstRenderRevision = 0
    this.previewCameraStableFrames = 0
    this.previewTrackedCameraX = 0
    this.previewTrackedCameraY = 0
    this.previewTrackedZoom = 1000
    this.setPreviewExitVisible(true)
    this.currentMapData = normalizedMap
    this.syncSkyReferenceCamera(normalizedMap)
    this.applyMapInitialTimeCycle(normalizedMap)
    this.sleepTransitionPhase = 'idle'
    this.sleepTransitionElapsedMs = 0
    this.sleepTransitionMidpointHandled = false
    this.updateSleepOverlay()
    this.staticRenderLayers = collectStaticRenderLayers(normalizedMap)
    this.renderer.setCharacterBodyMap(normalizedMap)
    this.lightingController.setMap(normalizedMap)
    this.worldRenderer.preloadCheckpointTextures()
    this.preloadRuntimeEnvironmentAssets(normalizedMap)
    this.syncStaticScene(normalizedMap)

    if (
      normalizedMap.camera &&
      normalizedMap.camera.zoom > 0 &&
      Number.isFinite(normalizedMap.camera.zoom)
    ) {
      this.targetZoom = normalizedMap.camera.zoom
      this.renderZoom = normalizedMap.camera.zoom
    }

    this.worker.postMessage({
      type: 'map_preview',
      map: normalizedMap,
      thumbnailCapture: options?.thumbnailCapture === true,
    } as MainToWorkerMessage)
  }

  private setupAudioResume() {
    const passiveListenerOptions: AddEventListenerOptions = { passive: true }
    const resumeAudio = () => {
      this.audioManager.resumeContext()
    }
    this.inputTarget.addEventListener('keydown', resumeAudio)
    this.inputTarget.addEventListener(
      'pointerdown',
      resumeAudio,
      passiveListenerOptions
    )
    this.inputTarget.addEventListener(
      'touchstart',
      resumeAudio,
      passiveListenerOptions
    )
  }

  private handleWorkerMessage(e: MessageEvent<WorkerToMainMessage>) {
    const msg = e.data
    if (msg.type === 'state') {
      const stateSyncStartMs = performance.now()
      this.workerStateRevision++
      this.renderer.updateState(
        msg.entitiesBuffer,
        msg.entityCount,
        msg.ropePointCount
      )
      this.lastStateSyncTimeUs = Math.round(
        (performance.now() - stateSyncStartMs) * 1000
      )
      this.camera.x = msg.camera.x
      this.camera.y = msg.camera.y
      this.renderZoom = msg.zoom
      this.worldTimeScale1000 =
        msg.timeScale1000 > 0 && Number.isFinite(msg.timeScale1000)
          ? Math.round(msg.timeScale1000)
          : 1000
      this.renderer.setTimeScale1000(this.worldTimeScale1000)
      this.renderer.setCamera(this.camera.x, this.camera.y, this.renderZoom)
      if (!this.editorPreview) {
        const effectsStartMs = performance.now()
        this.renderer.applyEffects(msg.entitiesBuffer, msg.effectsCount)
        this.lastEffectsApplyTimeUs = Math.round(
          (performance.now() - effectsStartMs) * 1000
        )
      } else {
        this.lastEffectsApplyTimeUs = 0
      }
      this.releaseStateBuffer(msg.entitiesBuffer)
      this.hasReceivedFirstState = true
      if (this.pendingCheckpointCaptureAfterState) {
        this.pendingCheckpointCaptureAfterState = false
        this.pendingCheckpointCapture = true
      }
    } else if (msg.type === 'debug') {
      this.renderer.setSensorDebugData(msg.sensors)
      this.renderer.setSoundDebugData(msg.soundWaves, msg.soundListeners)
      this.renderer.setSpineCollisionDebugData(msg.spineCollisions)
      if (msg.camera) {
        this.cameraDebug.topLimitRatio = msg.camera.topLimitRatio
        this.cameraDebug.bottomLimitRatio = msg.camera.bottomLimitRatio
        this.cameraDebug.playerScreenY = msg.camera.playerScreenY
        this.cameraDebug.playerFeetY = msg.camera.playerFeetY
        this.cameraDebug.cameraY = msg.camera.cameraY
        this.cameraDebug.zoom = msg.camera.zoom
        this.cameraDebug.isOutsideVerticalZone =
          msg.camera.isOutsideVerticalZone
        this.cameraDebug.enabled = true
      } else {
        this.cameraDebug.enabled = false
      }
    } else if (msg.type === 'perf_snapshot') {
      this.workerPerfSnapshot = msg
    } else if (msg.type === 'perf_log') {
      if (this.perfDebugEnabled) {
        console.info(
          msg.scope === 'worker' ? '[Perf][Worker]' : '[Perf][Main]',
          msg.message
        )
      }
    } else if (msg.type === 'map_data') {
      const isRuntimeTerrainUpdate = msg.runtimeTerrainUpdate === true
      const normalizedMap =
        normalizeCharacterBodyMapProfiles(msg.map) ?? msg.map
      this.currentMapData = normalizedMap
      this.syncSkyReferenceCamera(normalizedMap)
      if (isRuntimeTerrainUpdate) {
        this.staticSceneTextureCacheDisabled = true
        this.worldRenderer.invalidateStaticMeshCaches()
      } else {
        this.staticSceneTextureCacheDisabled = false
      }
      this.staticRenderLayers = collectStaticRenderLayers(normalizedMap)
      if (!isRuntimeTerrainUpdate) {
        if (!this.currentSaveData && !this.previewActive) {
          this.applyMapInitialTimeCycle(normalizedMap)
        }
        this.renderer.resetPlayerHudState()
        this.renderer.setCharacterBodyMap(normalizedMap)
        this.lightingController.setMap(normalizedMap)
        this.worldRenderer.preloadCheckpointTextures()
        this.preloadRuntimeEnvironmentAssets(normalizedMap)
      }
      this.syncStaticScene(normalizedMap)
      if (
        !isRuntimeTerrainUpdate &&
        normalizedMap.camera &&
        normalizedMap.camera.zoom > 0 &&
        Number.isFinite(normalizedMap.camera.zoom)
      ) {
        this.targetZoom = normalizedMap.camera.zoom
        this.renderZoom = normalizedMap.camera.zoom
      }
    } else if (msg.type === 'save_response') {
      this.handleSaveResponse(msg)
    } else if (msg.type === 'checkpoint_activated') {
      void this.handleCheckpointAutosave()
    } else if (msg.type === 'checkpoint_sleep') {
      this.handleCheckpointSleep()
    } else if (msg.type === 'player_dead') {
      void this.handlePlayerDead()
    } else if (msg.type === 'player_level_up') {
      this.handlePlayerLevelUp(msg)
    }
  }

  private handlePlayerLevelUp(msg: WorkerPlayerLevelUpMessage): void {
    if (msg.level > msg.previousLevel) {
      this.renderer.deferHealthBarGrowth(msg.previousLevel, msg.level)
    }
    if (msg.pendingPoints <= 0) {
      this.levelUpManager.hide()
      this.renderer.commitDeferredHealthBarGrowth()
      this.resumeGameInput()
      return
    }
    this.stop()
    this.resetInputState()
    this.setInputEnabled(false)
    this.levelUpManager.show({
      previousLevel: msg.previousLevel,
      level: msg.level,
      pendingPoints: msg.pendingPoints,
      attackLevel: msg.attackLevel,
      defenseLevel: msg.defenseLevel,
      agilityLevel: msg.agilityLevel,
      toughnessLevel: msg.toughnessLevel,
    })
  }

  private handleLevelUpSelection(stat: PlayerUpgradeStat): void {
    this.levelUpManager.hide()
    this.worker.postMessage({
      type: 'allocate_player_upgrade',
      stat,
    } as MainToWorkerMessage)
  }

  private handleSaveResponse(msg: WorkerSaveResponseMessage): void {
    if (!this.currentSaveData) return

    const nextThumbnail =
      this.pendingSaveThumbnail ?? this.currentSaveData.meta.thumbnail
    const updatedSaveData: SaveData = {
      ...this.currentSaveData,
      playTimeMs: msg.playTimeMs,
      timeCycleElapsedMs: this.dayNightCycle.getElapsed(),
      worldStateReady: true,
      activeCheckpoint: msg.activeCheckpoint,
      player: msg.player,
      npcs: msg.npcs,
      groundWeapons: msg.groundWeapons,
      groundSunPickups: msg.groundSunPickups,
      camera: msg.camera,
      meta: {
        ...this.currentSaveData.meta,
        thumbnail: nextThumbnail ?? undefined,
      },
    }

    this.currentSaveData = updatedSaveData
    this.pendingSaveThumbnail = null

    saveManager.save(msg.saveId, updatedSaveData).then((meta) => {
      if (this.pendingSaveResolve) {
        this.pendingSaveResolve(meta ? updatedSaveData : null)
        this.pendingSaveResolve = null
      }
    })
  }

  private handleCheckpointAutosave(): void {
    if (!this.currentSaveId || !this.currentSaveData) {
      return
    }
    if (this.pendingSaveResolve) {
      return
    }
    if (this.pendingCheckpointAutosave) {
      return
    }
    this.pendingCheckpointAutosave = true
    this.pendingCheckpointCaptureAfterState = true
  }

  private handleCheckpointSleep(): void {
    if (this.sleepTransitionPhase !== 'idle') {
      return
    }
    if (
      this.menuManager.isVisible() ||
      this.levelUpManager.isOpen() ||
      this.dialogManager.isDialogOpen()
    ) {
      return
    }
    this.resetInputState()
    this.setInputEnabled(false)
    this.stop()
    this.sleepTransitionPhase = 'closing'
    this.sleepTransitionElapsedMs = 0
    this.sleepTransitionMidpointHandled = false
    this.updateSleepOverlay()
  }

  private async handleAutoReload(): Promise<void> {
    if (this.autoReloadPending) {
      return
    }
    if (!this.currentSaveId) {
      return
    }
    this.autoReloadPending = true
    await this.loadSaveById(this.currentSaveId)
    this.autoReloadPending = false
  }

  private async handlePlayerDead(): Promise<void> {
    if (this.previewActive) {
      this.handlePreviewRespawn()
      return
    }
    await this.handleAutoReload()
  }

  private handlePreviewRespawn(): void {
    if (!this.previewActive || !this.currentMapData) {
      return
    }

    this.worker.postMessage({
      type: 'map_preview',
      map: this.currentMapData,
    } as MainToWorkerMessage)

    this.start()
    this.setInputEnabled(true)
  }

  private async captureCheckpointAutosave(): Promise<void> {
    if (!this.pendingCheckpointAutosave) {
      return
    }
    if (this.pendingSaveResolve) {
      this.pendingCheckpointAutosave = false
      return
    }
    this.pendingSaveThumbnail = await this.captureSaveThumbnail()
    await this.requestSave()
    this.pendingCheckpointAutosave = false
  }

  private releaseStateBuffer(buffer: ArrayBuffer | SharedArrayBuffer) {
    if (this.isSharedBuffer(buffer)) {
      return
    }
    this.worker.postMessage({ type: 'buffer_release', buffer }, [buffer])
  }

  private isSharedBuffer(
    buffer: ArrayBuffer | SharedArrayBuffer
  ): buffer is SharedArrayBuffer {
    return (
      typeof SharedArrayBuffer !== 'undefined' &&
      buffer instanceof SharedArrayBuffer
    )
  }

  private setupInput() {
    this.inputTarget.addEventListener(
      'pointerdown',
      this.boundHandleAutoFocusPointerDown,
      true
    )
    this.inputTarget.addEventListener(
      'focusin',
      this.boundHandleAutoFocusIn,
      true
    )

    this.inputTarget.addEventListener(
      'keydown',
      (e) => {
        if (this.shouldIgnoreKeyEvent(e)) {
          return
        }
        if (this.levelUpManager.isOpen()) {
          return
        }
        const key = e.key.toLowerCase()

        if (key === 'escape') {
          if (this.isEditorOverlayVisible()) {
            return
          }
          if (e.defaultPrevented) {
            return
          }
          e.preventDefault()
          if (this.previewActive) {
            this.togglePreviewPause()
            return
          }
          if (this.menuManager.isVisible()) {
            if (this.menuManager.getMode() !== MenuMode.Pause) {
              return
            }
            this.menuManager.hide()
            this.resumeGameInput()
          } else {
            this.stop()
            this.menuManager.show(MenuMode.Pause)
            this.inputEnabled = false
          }
          return
        }

        if (this.menuManager.isVisible() || !this.inputEnabled) {
          return
        }

        if (
          [
            'arrowup',
            'arrowdown',
            'arrowleft',
            'arrowright',
            ' ',
            'w',
            'a',
            's',
            'd',
          ].includes(key)
        ) {
          e.preventDefault()
        }

        this.keys.add(key)
        this.sendInput()

        if (e.key.toLowerCase() === 'i') {
          this.targetZoom = Math.max(0.1, this.targetZoom + 0.2)
          this.sendInput()
        } else if (e.key.toLowerCase() === 'o') {
          this.targetZoom = Math.max(0.1, this.targetZoom - 0.2)
          this.sendInput()
        } else if (e.key.toLowerCase() === 'u') {
          this.targetZoom = 1.0
          this.sendInput()
        }
      },
      true
    )

    this.inputTarget.addEventListener(
      'keyup',
      (e) => {
        if (this.shouldIgnoreKeyEvent(e)) {
          return
        }
        if (this.levelUpManager.isOpen()) {
          return
        }
        if (this.menuManager.isVisible() || !this.inputEnabled) {
          return
        }
        this.keys.delete(e.key.toLowerCase())
        this.sendInput()
      },
      true
    )

    this.inputTarget.addEventListener('mousedown', (e) => {
      if (
        e.button === 2 &&
        !this.isEditorOverlayVisible() &&
        (document.pointerLockElement === this.appCanvas ||
          this.isPointInCanvas(e.clientX, e.clientY))
      ) {
        e.preventDefault()
      }
      if (
        this.levelUpManager.isOpen() ||
        this.menuManager.isVisible() ||
        !this.inputEnabled ||
        this.isEditorOverlayVisible()
      ) {
        return
      }
      this.mouseButtons.add(e.button)
      this.sendInput()
    })

    this.inputTarget.addEventListener('mouseup', (e) => {
      if (
        this.levelUpManager.isOpen() ||
        this.menuManager.isVisible() ||
        !this.inputEnabled ||
        this.isEditorOverlayVisible()
      ) {
        return
      }
      this.mouseButtons.delete(e.button)
      this.sendInput()
    })

    this.inputTarget.addEventListener('mouseenter', () => {
      if (this.levelUpManager.isOpen()) return
      if (this.menuManager.isVisible() || !this.inputEnabled) return
      this.mouseInside = true
      this.mouseCaptured = true
      this.sendInput()
    })

    this.inputTarget.addEventListener('mouseleave', () => {
      if (this.levelUpManager.isOpen()) return
      if (this.menuManager.isVisible() || !this.inputEnabled) return
      this.mouseInside = false
      this.mouseCaptured = false
      this.sendInput()
    })

    this.inputTarget.addEventListener('mousemove', (e) => {
      if (this.levelUpManager.isOpen()) {
        return
      }
      if (this.menuManager.isVisible() || !this.inputEnabled) {
        return
      }
      const canvasWidth = this.app.renderer.width
      const canvasHeight = this.app.renderer.height
      let mouseDeltaX = 0
      let mouseDeltaY = 0
      if (document.pointerLockElement === this.appCanvas) {
        mouseDeltaX = e.movementX
        mouseDeltaY = e.movementY
        this.mouseX += e.movementX
        this.mouseY += e.movementY
        if (this.mouseX < 0) this.mouseX = 0
        if (this.mouseY < 0) this.mouseY = 0
        if (this.mouseX > canvasWidth) this.mouseX = canvasWidth
        if (this.mouseY > canvasHeight) this.mouseY = canvasHeight
      } else {
        const rect = this.appCanvas.getBoundingClientRect()
        const x = Math.floor(e.clientX - rect.left)
        const y = Math.floor(e.clientY - rect.top)
        const nextMouseX = x < 0 ? 0 : x > canvasWidth ? canvasWidth : x
        const nextMouseY = y < 0 ? 0 : y > canvasHeight ? canvasHeight : y
        mouseDeltaX = e.movementX
        mouseDeltaY = e.movementY
        this.mouseX = nextMouseX
        this.mouseY = nextMouseY
      }
      this.mouseCaptured = true
      this.sendInput(mouseDeltaX, mouseDeltaY)
    })

    this.inputTarget.addEventListener(
      'contextmenu',
      (e) => {
        if (this.levelUpManager.isOpen()) {
          e.preventDefault()
          return
        }
        if (this.isEditorOverlayVisible()) {
          return
        }
        if (document.pointerLockElement === this.appCanvas) {
          this.resetInputState()
          e.preventDefault()
          return
        }
        if (this.isPointInCanvas(e.clientX, e.clientY)) {
          this.resetInputState()
          e.preventDefault()
        }
      },
      true
    )

    this.inputTarget.addEventListener('wheel', (e) => {
      if (this.levelUpManager.isOpen()) {
        return
      }
      if (this.menuManager.isVisible() || !this.inputEnabled) {
        return
      }
      e.preventDefault()
      const zoomDelta = e.deltaY > 0 ? -0.1 : 0.1
      this.targetZoom = Math.max(
        0.1,
        Math.min(2.0, this.targetZoom + zoomDelta)
      )
      this.sendInput()
    })
  }

  private handleAutoFocusPointerDown(event: PointerEvent) {
    if (!this.shouldForceGameFocus()) {
      return
    }
    const target = event.target
    if (this.shouldAllowTargetFocus(target)) {
      return
    }
    if (document.activeElement !== this.inputTarget) {
      this.inputTarget.focus(this.focusOptions)
    }
  }

  private handleAutoFocusIn(event: FocusEvent) {
    if (!this.shouldForceGameFocus()) {
      return
    }
    const target = event.target
    if (this.shouldAllowTargetFocus(target)) {
      return
    }
    if (target !== this.inputTarget) {
      this.inputTarget.focus(this.focusOptions)
    }
  }

  requestGameFocus() {
    if (!this.shouldForceGameFocus()) {
      return
    }
    if (document.activeElement !== this.inputTarget) {
      this.inputTarget.focus(this.focusOptions)
    }
  }

  private shouldAllowTargetFocus(target: EventTarget | null): boolean {
    if (this.dialogManager.isDialogOpen()) {
      return true
    }
    if (target instanceof HTMLInputElement) return true
    if (target instanceof HTMLTextAreaElement) return true
    if (target instanceof HTMLSelectElement) return true
    if (target instanceof HTMLElement && target.isContentEditable) {
      return true
    }
    return false
  }

  private shouldForceGameFocus(): boolean {
    if (!this.inputEnabled) return false
    if (this.menuManager.isVisible()) return false
    if (this.isEditorOverlayVisible()) return false
    if (this.dialogManager.isDialogOpen()) return false
    if (this.levelUpManager.isOpen()) return false
    return true
  }

  private shouldIgnoreKeyEvent(e: KeyboardEvent): boolean {
    if (this.dialogManager.isDialogOpen()) {
      return true
    }
    const target = e.target
    if (target instanceof HTMLInputElement) return true
    if (target instanceof HTMLTextAreaElement) return true
    if (target instanceof HTMLSelectElement) return true
    if (target instanceof HTMLElement && target.isContentEditable) {
      return true
    }
    return false
  }

  private sendInput(mouseDeltaX = 0, mouseDeltaY = 0) {
    this.keysArray.length = 0
    for (const k of this.keys) {
      this.keysArray.push(k)
    }

    this.mouseButtonsArray.length = 0
    for (const b of this.mouseButtons) {
      this.mouseButtonsArray.push(b)
    }

    this.inputMessage.keys = this.keysArray
    this.inputMessage.mouseButtons = this.mouseButtonsArray
    this.inputMessage.mouseZoom = this.targetZoom
    this.inputMessage.mouseX = this.mouseX
    this.inputMessage.mouseY = this.mouseY
    this.inputMessage.mouseDeltaX = mouseDeltaX
    this.inputMessage.mouseDeltaY = mouseDeltaY
    this.inputMessage.mouseCaptured = this.mouseCaptured
    this.worker.postMessage(this.inputMessage)
  }

  private isEditorOverlayVisible() {
    return this.editorOverlay?.classList.contains('is-visible') ?? false
  }

  private resetInputState() {
    this.keys.clear()
    this.mouseButtons.clear()
    this.mouseCaptured = false
    this.sendInput()
  }

  private applyDayNightColors() {
    const colors = this.dayNightCycle.getColors()
    if (this.backgroundSprite) {
      this.backgroundSprite.tint = colors.sky
    }
  }

  private applySaveTimeCycle(saveData: SaveData | null) {
    const initialElapsedMs = saveData
      ? getMapTimePhaseElapsedMs(saveData.mapData.settings?.initialTimePhase)
      : undefined
    this.dayNightCycle.setElapsed(
      saveData?.timeCycleElapsedMs ?? initialElapsedMs
    )
    this.applyDayNightColors()
  }

  private applyMapInitialTimeCycle(map: EditorMapData) {
    this.dayNightCycle.setElapsed(
      getMapTimePhaseElapsedMs(map.settings?.initialTimePhase)
    )
    this.applyDayNightColors()
  }

  private syncCurrentSaveTimeCycle() {
    if (!this.currentSaveData || this.previewActive) {
      return
    }
    this.currentSaveData.timeCycleElapsedMs = this.dayNightCycle.getElapsed()
  }

  private updateSleepBlur(progress256: number) {
    if (progress256 <= 0) {
      this.sceneContainer.filters = null
      this.sleepBlurFilter.strength = 0
      return
    }

    this.sleepBlurFilter.strength =
      (GameClient.SLEEP_MAX_BLUR_STRENGTH * progress256) / 256
    this.sceneContainer.filters = this.sleepSceneFilters
  }

  private updateSleepTransition(deltaMs: number) {
    if (this.sleepTransitionPhase === 'idle') {
      this.sleepOverlayContainer.visible = false
      this.sleepOverlayGraphics.visible = false
      this.updateSleepBlur(0)
      return
    }

    this.sleepTransitionElapsedMs += deltaMs
    let blurProgress256 = 256

    if (this.sleepTransitionPhase === 'closing') {
      blurProgress256 = Math.min(
        256,
        Math.floor(
          (this.sleepTransitionElapsedMs << 8) /
            GameClient.SLEEP_CLOSE_DURATION_MS
        )
      )
      if (
        !this.sleepTransitionMidpointHandled &&
        this.sleepTransitionElapsedMs >= GameClient.SLEEP_CLOSE_DURATION_MS
      ) {
        this.sleepTransitionMidpointHandled = true
        this.dayNightCycle.advanceToNextPhase()
        this.syncCurrentSaveTimeCycle()
        this.applyDayNightColors()
        this.sleepTransitionPhase = 'closed'
        this.sleepTransitionElapsedMs = 0
      }
    } else if (this.sleepTransitionPhase === 'closed') {
      blurProgress256 = 256
      if (
        this.sleepTransitionElapsedMs >= GameClient.SLEEP_BLACKOUT_DURATION_MS
      ) {
        this.sleepTransitionPhase = 'opening'
        this.sleepTransitionElapsedMs = 0
      }
    } else if (this.sleepTransitionPhase === 'opening') {
      const remainingMs = Math.max(
        0,
        GameClient.SLEEP_OPEN_DURATION_MS - this.sleepTransitionElapsedMs
      )
      blurProgress256 = Math.min(
        256,
        Math.floor((remainingMs << 8) / GameClient.SLEEP_OPEN_DURATION_MS)
      )
      if (this.sleepTransitionElapsedMs >= GameClient.SLEEP_OPEN_DURATION_MS) {
        this.sleepTransitionPhase = 'idle'
        this.sleepTransitionElapsedMs = 0
        this.sleepTransitionMidpointHandled = false
        this.sleepOverlayContainer.visible = false
        this.sleepOverlayGraphics.visible = false
        this.updateSleepBlur(0)
        this.start()
        this.setInputEnabled(true)
        this.requestGameFocus()
        void this.handleCheckpointAutosave()
        return
      }
    }

    this.updateSleepBlur(blurProgress256)
    this.updateSleepOverlay()
  }

  private updateSleepOverlay() {
    const graphics = this.sleepOverlayGraphics
    if (this.sleepTransitionPhase === 'idle') {
      this.sleepOverlayContainer.visible = false
      graphics.visible = false
      graphics.clear()
      this.updateSleepBlur(0)
      return
    }

    const width = this.app.renderer.width | 0
    const height = this.app.renderer.height | 0
    const halfHeight = height >> 1
    const maxCurveDepth = Math.max(2, halfHeight >> 2)
    let coverHeight = 0

    if (this.sleepTransitionPhase === 'closing') {
      coverHeight = Math.min(
        halfHeight,
        Math.floor(
          (halfHeight * this.sleepTransitionElapsedMs) /
            GameClient.SLEEP_CLOSE_DURATION_MS
        )
      )
    } else if (this.sleepTransitionPhase === 'closed') {
      coverHeight = halfHeight
    } else {
      const remainingMs = Math.max(
        0,
        GameClient.SLEEP_OPEN_DURATION_MS - this.sleepTransitionElapsedMs
      )
      coverHeight = Math.min(
        halfHeight,
        Math.floor(
          (halfHeight * remainingMs) / GameClient.SLEEP_OPEN_DURATION_MS
        )
      )
    }

    if (coverHeight <= 0) {
      this.sleepOverlayContainer.visible = false
      graphics.visible = false
      graphics.clear()
      return
    }

    const closeProgress256 = Math.min(
      256,
      Math.floor((coverHeight << 8) / halfHeight)
    )
    const curveDepth = Math.max(
      0,
      Math.floor((maxCurveDepth * (256 - closeProgress256)) / 256)
    )
    const overlapPx =
      closeProgress256 >= 224 ? 2 : closeProgress256 >= 160 ? 1 : 0
    const topEdgeY = coverHeight
    const bottomEdgeY = height - coverHeight
    const centerX = width >> 1
    const centerTopY = Math.max(0, topEdgeY - curveDepth)
    const centerBottomY = Math.min(height, bottomEdgeY + curveDepth)
    const topCloseY = Math.min(height, topEdgeY + overlapPx)
    const bottomCloseY = Math.max(0, bottomEdgeY - overlapPx)

    this.sleepOverlayContainer.visible = true
    graphics.visible = true
    graphics.clear()

    const overscan = GameClient.SLEEP_OVERLAY_OVERSCAN_PX
    const leftX = -overscan
    const rightX = width + overscan
    const topFillY = -overscan
    const bottomFillY = height + overscan

    graphics
      .moveTo(leftX, topFillY)
      .lineTo(rightX, topFillY)
      .lineTo(rightX, topCloseY)
      .quadraticCurveTo(centerX, centerTopY, leftX, topCloseY)
      .lineTo(leftX, topFillY)
      .fill(0x000000)

    graphics
      .moveTo(leftX, bottomFillY)
      .lineTo(rightX, bottomFillY)
      .lineTo(rightX, bottomCloseY)
      .quadraticCurveTo(centerX, centerBottomY, leftX, bottomCloseY)
      .lineTo(leftX, bottomFillY)
      .fill(0x000000)
  }

  private isPointInCanvas(clientX: number, clientY: number) {
    const rect = this.appCanvas.getBoundingClientRect()
    const left = Math.floor(rect.left)
    const right = Math.floor(rect.right)
    const top = Math.floor(rect.top)
    const bottom = Math.floor(rect.bottom)
    return (
      clientX >= left && clientX <= right && clientY >= top && clientY <= bottom
    )
  }

  private renderLoopTick() {
    const frameStartMs = performance.now()
    const deltaMs = Math.min(this.app.ticker.deltaMS, 100)
    const deltaTime = deltaMs / 1000
    const scaledDeltaTime = (deltaTime * this.worldTimeScale1000) / 1000
    this.lastDeltaTime = deltaTime

    this.frameCount++
    this.fpsUpdateTime += deltaTime
    let shouldRefreshPerfText = false
    if (this.fpsUpdateTime >= 1.0) {
      this.renderFps = Math.round(this.frameCount / this.fpsUpdateTime)
      this.frameCount = 0
      this.fpsUpdateTime = 0
      shouldRefreshPerfText = true
    }

    if (this.sleepTransitionPhase === 'idle') {
      this.dayNightCycle.update(deltaMs)
      this.syncCurrentSaveTimeCycle()
      this.applyDayNightColors()
    }
    this.updateSleepTransition(deltaMs | 0)

    let updateTimeUs = 0
    if (!this.editorPreview) {
      const updateStartMs = performance.now()
      this.renderer.update(scaledDeltaTime)
      this.updateInteractiveGrass(Math.max(0, Math.round(deltaMs)))
      updateTimeUs = Math.round((performance.now() - updateStartMs) * 1000)
    }
    this.updateStartMenuFlow(deltaMs | 0)
    this.pumpStaticSceneBuild()
    this.render(deltaMs | 0)
    if (!this.editorPreview) {
      this.worldRenderer.commitPerfWindow(shouldRefreshPerfText)
    }
    this.renderFrameRevision++
    this.updatePreviewCaptureState()

    if (this.pendingCheckpointCapture) {
      this.pendingCheckpointCapture = false
      void this.captureCheckpointAutosave()
    }

    if (
      !this.isFirstFrameRendered &&
      this.hasReceivedFirstState &&
      this.onFirstFrameRendered
    ) {
      this.isFirstFrameRendered = true
      this.onFirstFrameRendered()
    }

    this.recordPerformanceSample(
      Math.round((performance.now() - frameStartMs) * 1000),
      updateTimeUs,
      shouldRefreshPerfText
    )
  }

  private render(deltaMs: number) {
    const renderStartMs = performance.now()
    const worldDeltaMs = (deltaMs * this.worldTimeScale1000) / 1000
    const width = this.app.renderer.width
    const height = this.app.renderer.height
    const hudDirty =
      this.editorPreview || this.renderer.isHudDirty(width, height)
    if (hudDirty) {
      this.hudRenderContext.beginFrame()
    }
    let worldTimeUs = 0
    this.lastLightingTimeUs = 0
    this.lastSceneRenderTimeUs = 0

    if (!this.editorPreview) {
      const worldStartMs = performance.now()
      const centerX = width / 2
      const bottomY = height
      const zoom = this.renderZoom
      const camX = this.camera.x * this.pixelsPerMeter
      const camY = this.camera.y * this.pixelsPerMeter
      const shakeOffsetX = this.renderer.getCameraShakeOffsetX()
      const shakeOffsetY = this.renderer.getCameraShakeOffsetY()

      // 标准相机变换（layer=0 的基准）
      const worldMatrix = this.reusableDOMMatrix
      worldMatrix.a = 1
      worldMatrix.b = 0
      worldMatrix.c = 0
      worldMatrix.d = 1
      worldMatrix.e = 0
      worldMatrix.f = 0
      worldMatrix.translateSelf(centerX, bottomY)
      worldMatrix.scaleSelf(zoom, zoom)
      worldMatrix.translateSelf(-centerX, -bottomY)
      if (shakeOffsetX !== 0 || shakeOffsetY !== 0) {
        worldMatrix.translateSelf(shakeOffsetX, shakeOffsetY)
      }
      worldMatrix.translateSelf(-camX, -camY)
      const pixiMatrix = this.reusablePixiMatrix
      pixiMatrix.a = worldMatrix.a
      pixiMatrix.b = worldMatrix.b
      pixiMatrix.c = worldMatrix.c
      pixiMatrix.d = worldMatrix.d
      pixiMatrix.tx = worldMatrix.e
      pixiMatrix.ty = worldMatrix.f
      this.worldContainer.setFromMatrix(pixiMatrix)
      this.emissiveContainer.setFromMatrix(pixiMatrix)

      // 传递视差相机参数，PixiWorldRenderer 在 render 时对各 bucket 独立计算偏移
      this.worldRenderer.setParallaxCamera(
        camX,
        camY,
        zoom,
        centerX,
        bottomY,
        shakeOffsetX,
        shakeOffsetY
      )
      const lightingStartMs = performance.now()
      this.lightingController.update(
        deltaMs,
        this.dayNightCycle.getLightingState(),
        this.renderer,
        this.worldRenderer,
        camX,
        camY,
        zoom,
        shakeOffsetX,
        shakeOffsetY,
        width,
        height
      )
      this.lastLightingTimeUs = Math.round(
        (performance.now() - lightingStartMs) * 1000
      )
      this.lightingFilterApplied = this.lightingController.isFilterActive()
      const sceneRenderStartMs = performance.now()
      this.worldRenderer.render(
        this.renderer,
        this.inputEnabled ? worldDeltaMs : 0
      )
      this.lastSceneRenderTimeUs = Math.round(
        (performance.now() - sceneRenderStartMs) * 1000
      )
      worldTimeUs = Math.round((performance.now() - worldStartMs) * 1000)
    }
    this.lastWorldRenderTimeUs = worldTimeUs

    const hudStartMs = performance.now()
    if (!this.editorPreview) {
      if (this.cameraDebug.enabled) {
        this.renderCameraDebug()
      }

      if (hudDirty) {
        const puiStart = performance.now()
        this.renderer.renderPlayerUI()
        this.lastPlayerUITimeUs = Math.round(
          (performance.now() - puiStart) * 1000
        )
      } else {
        this.lastPlayerUITimeUs = 0
      }
    }

    // Update FPS display
    if (this.fpsTextEl && this.fpsTextEl.text !== this.fpsText) {
      this.fpsTextEl.text = this.fpsText
    }
    this.lastHudRenderTimeUs = Math.round(
      (performance.now() - hudStartMs) * 1000
    )

    // Menu (DOM-based)
    const menuStartMs = performance.now()
    this.menuManager.render(deltaMs / 1000)
    this.lastMenuRenderTimeUs = Math.round(
      (performance.now() - menuStartMs) * 1000
    )
    this.lastRenderTimeUs = Math.round(
      (performance.now() - renderStartMs) * 1000
    )
  }

  private recordPerformanceSample(
    frameTimeUs: number,
    updateTimeUs: number,
    shouldRefreshPerfText: boolean
  ): void {
    this.perfSampleCount++
    this.perfFrameTimeTotalUs += frameTimeUs
    this.perfUpdateTimeTotalUs += updateTimeUs
    this.perfRenderTimeTotalUs += this.lastRenderTimeUs
    this.perfWorldTimeTotalUs += this.lastWorldRenderTimeUs
    this.perfLightingTimeTotalUs += this.lastLightingTimeUs
    this.perfSceneRenderTimeTotalUs += this.lastSceneRenderTimeUs
    this.perfHudTimeTotalUs += this.lastHudRenderTimeUs
    this.perfMenuTimeTotalUs += this.lastMenuRenderTimeUs
    this.perfStateSyncTotalUs += this.lastStateSyncTimeUs
    this.perfEffectsApplyTotalUs += this.lastEffectsApplyTimeUs
    this.lastStateSyncTimeUs = 0
    this.lastEffectsApplyTimeUs = 0
    if (frameTimeUs > this.perfFrameTimeMaxUs) {
      this.perfFrameTimeMaxUs = frameTimeUs
    }

    if (!shouldRefreshPerfText || this.perfSampleCount <= 0) {
      return
    }

    const sampleCount = this.perfSampleCount
    this.perfFrameAvgUs = Math.round(this.perfFrameTimeTotalUs / sampleCount)
    this.perfFrameMaxUs = this.perfFrameTimeMaxUs
    this.perfUpdateAvgUs = Math.round(this.perfUpdateTimeTotalUs / sampleCount)
    this.perfRenderAvgUs = Math.round(this.perfRenderTimeTotalUs / sampleCount)
    this.perfWorldAvgUs = Math.round(this.perfWorldTimeTotalUs / sampleCount)
    this.perfLightingAvgUs = Math.round(
      this.perfLightingTimeTotalUs / sampleCount
    )
    this.perfSceneRenderAvgUs = Math.round(
      this.perfSceneRenderTimeTotalUs / sampleCount
    )
    this.perfHudAvgUs = Math.round(this.perfHudTimeTotalUs / sampleCount)
    this.perfMenuAvgUs = Math.round(this.perfMenuTimeTotalUs / sampleCount)
    this.perfStateSyncAvgUs = Math.round(
      this.perfStateSyncTotalUs / sampleCount
    )
    this.perfEffectsApplyAvgUs = Math.round(
      this.perfEffectsApplyTotalUs / sampleCount
    )
    this.perfStaticBuildAvgUs =
      this.perfStaticBuildCount > 0
        ? Math.round(this.perfStaticBuildTotalUs / this.perfStaticBuildCount)
        : 0
    this.perfTerrainBuildAvgUs =
      this.perfTerrainBuildCount > 0
        ? Math.round(this.perfTerrainBuildTotalUs / this.perfTerrainBuildCount)
        : 0
    this.perfEnvironmentBuildAvgUs =
      this.perfEnvironmentBuildCount > 0
        ? Math.round(
            this.perfEnvironmentBuildTotalUs / this.perfEnvironmentBuildCount
          )
        : 0
    this.perfGrassUpdateAvgUs = Math.round(
      this.perfGrassUpdateTotalUs / sampleCount
    )
    this.perfGrassCountAvg = Math.round(this.perfGrassCountTotal / sampleCount)
    this.perfGrassInViewAvg = Math.round(
      this.perfGrassInViewTotal / sampleCount
    )
    this.perfGrassInteractorAvg = Math.round(
      this.perfGrassInteractorTotal / sampleCount
    )
    this.perfGrassCandidateAvg = Math.round(
      this.perfGrassCandidateTotal / sampleCount
    )
    this.perfGrassInteractionTestAvg = Math.round(
      this.perfGrassInteractionTestTotal / sampleCount
    )
    this.perfGrassDynamicAvg = Math.round(
      this.perfGrassDynamicTotal / sampleCount
    )
    if (this.perfDebugEnabled) {
      this.maybeEmitPerfLogs()
    }
    this.fpsText = this.buildDebugOverlayText()

    this.perfSampleCount = 0
    this.perfFrameTimeTotalUs = 0
    this.perfFrameTimeMaxUs = 0
    this.perfUpdateTimeTotalUs = 0
    this.perfRenderTimeTotalUs = 0
    this.perfWorldTimeTotalUs = 0
    this.perfLightingTimeTotalUs = 0
    this.perfSceneRenderTimeTotalUs = 0
    this.perfHudTimeTotalUs = 0
    this.perfMenuTimeTotalUs = 0
    this.perfStateSyncTotalUs = 0
    this.perfEffectsApplyTotalUs = 0
    this.perfStaticBuildTotalUs = 0
    this.perfStaticBuildMaxUs = 0
    this.perfStaticBuildCount = 0
    this.perfTerrainBuildTotalUs = 0
    this.perfTerrainBuildMaxUs = 0
    this.perfTerrainBuildCount = 0
    this.perfEnvironmentBuildTotalUs = 0
    this.perfEnvironmentBuildMaxUs = 0
    this.perfEnvironmentBuildCount = 0
    this.perfEnvironmentCacheHits = 0
    this.perfEnvironmentCacheMisses = 0
    this.perfGrassUpdateTotalUs = 0
    this.perfGrassUpdateMaxUs = 0
    this.perfGrassCountTotal = 0
    this.perfGrassInViewTotal = 0
    this.perfGrassInteractorTotal = 0
    this.perfGrassCandidateTotal = 0
    this.perfGrassInteractionTestTotal = 0
    this.perfGrassDynamicTotal = 0
  }

  private buildDebugOverlayText(): string {
    if (!this.perfDebugEnabled) {
      return `${this.renderFps} FPS`
    }
    const workerSummary = this.workerPerfSnapshot
      ? `worker ${this.formatUsAsMs(this.workerPerfSnapshot.updateAvgUs)}`
      : 'worker --.-ms'
    const lines = [
      `${this.renderFps} FPS  frame ${this.formatUsAsMs(this.perfFrameAvgUs)} max ${this.formatUsAsMs(this.perfFrameMaxUs)}`,
      `main upd ${this.formatUsAsMs(this.perfUpdateAvgUs)}  world ${this.formatUsAsMs(this.perfWorldAvgUs)}  light ${this.formatUsAsMs(this.perfLightingAvgUs)}  scene ${this.formatUsAsMs(this.perfSceneRenderAvgUs)}  render ${this.formatUsAsMs(this.perfRenderAvgUs)}  ${workerSummary}`,
      `ent ${this.renderer.getEntityCount()} vis ${this.worldRenderer.getVisibleEntityCount()} ptc ${this.renderer.getActiveParticleCount()} spine ${this.worldRenderer.getActiveSpineCount()} static t ${this.pendingStaticTerrainTaskIndex}/${this.pendingStaticTerrainTaskTotal} e ${this.pendingStaticEnvironmentIndex}/${this.pendingStaticEnvironmentObjects?.length ?? 0}`,
      `grass ${this.formatUsAsMs(this.perfGrassUpdateAvgUs)}/${this.formatUsAsMs(this.perfGrassUpdateMaxUs)} all ${this.perfGrassCountAvg} view ${this.perfGrassInViewAvg} actor ${this.perfGrassInteractorAvg} cand ${this.perfGrassCandidateAvg} test ${this.perfGrassInteractionTestAvg} dyn ${this.perfGrassDynamicAvg}`,
      `light fx ${this.lightingFilterApplied ? 'on' : 'off'} vis ${this.lightingController.getVisibleLightCount()} map ${this.lightingController.getMapLightCount()} renderer ${this.rendererLabel}`,
    ]
    if (this.workerPerfSnapshot) {
      lines.push(this.buildWorkerPerfOverlayLine(this.workerPerfSnapshot))
    }
    const voronoiPerf = getVoronoiBuildPerfSnapshot()
    if (voronoiPerf.buildTimeUs > 0) {
      lines.push(
        `vor ${this.formatUsAsMs(voronoiPerf.buildTimeUs)} sites ${voronoiPerf.siteCount} cells ${voronoiPerf.renderCellCount} clip ${voronoiPerf.clippedPolygonCount}`
      )
    }
    for (const line of this.worldRenderer.buildPerfDebugLines(
      this.formatUsAsMs.bind(this)
    )) {
      lines.push(line)
    }
    return lines.join('\n')
  }

  private buildWorkerPerfOverlayLine(
    snapshot: WorkerPerfSnapshotMessage
  ): string {
    let bestIndex = -1
    for (let i = 0; i < snapshot.systemAvgUs.length; i++) {
      if (
        bestIndex === -1 ||
        (snapshot.systemAvgUs[i] | 0) > (snapshot.systemAvgUs[bestIndex] | 0)
      ) {
        bestIndex = i
      }
    }
    if (bestIndex < 0) {
      return `worker fixed ${this.formatUsAsMs(snapshot.fixedAvgUs)}  crate ${snapshot.breakableCrateAwakeCount}/${snapshot.breakableCrateCount}/${snapshot.breakableCratePlankCount}  sys n/a`
    }
    return `worker fixed ${this.formatUsAsMs(snapshot.fixedAvgUs)}  crate ${snapshot.breakableCrateAwakeCount}/${snapshot.breakableCrateCount}/${snapshot.breakableCratePlankCount}  sys ${snapshot.systemNames[bestIndex]} ${this.formatUsAsMs(snapshot.systemAvgUs[bestIndex] | 0)}`
  }

  private buildWorkerPerfLine(snapshot: WorkerPerfSnapshotMessage): string {
    return `worker upd ${this.formatUsAsMs(snapshot.updateAvgUs)} max ${this.formatUsAsMs(snapshot.updateMaxUs)}  fixed ${this.formatUsAsMs(snapshot.fixedAvgUs)} x${(snapshot.fixedStepsAvg100 / 100).toFixed(2)}  world ${this.formatUsAsMs(snapshot.worldUpdateAvgUs)}  send ${this.formatUsAsMs(snapshot.sendStateAvgUs)}  crate ${snapshot.breakableCrateAwakeCount}/${snapshot.breakableCrateCount}/${snapshot.breakableCratePlankCount}`
  }

  private buildWorkerSystemPerfLine(
    snapshot: WorkerPerfSnapshotMessage
  ): string {
    let bestAIndex = -1
    let bestBIndex = -1
    let bestCIndex = -1
    for (let i = 0; i < snapshot.systemAvgUs.length; i++) {
      const value = snapshot.systemAvgUs[i] | 0
      if (bestAIndex === -1 || value > (snapshot.systemAvgUs[bestAIndex] | 0)) {
        bestCIndex = bestBIndex
        bestBIndex = bestAIndex
        bestAIndex = i
      } else if (
        bestBIndex === -1 ||
        value > (snapshot.systemAvgUs[bestBIndex] | 0)
      ) {
        bestCIndex = bestBIndex
        bestBIndex = i
      } else if (
        bestCIndex === -1 ||
        value > (snapshot.systemAvgUs[bestCIndex] | 0)
      ) {
        bestCIndex = i
      }
    }
    const topA =
      bestAIndex >= 0
        ? `${snapshot.systemNames[bestAIndex]} ${this.formatUsAsMs(snapshot.systemAvgUs[bestAIndex] | 0)}`
        : 'n/a'
    const topB =
      bestBIndex >= 0
        ? `${snapshot.systemNames[bestBIndex]} ${this.formatUsAsMs(snapshot.systemAvgUs[bestBIndex] | 0)}`
        : 'n/a'
    const topC =
      bestCIndex >= 0
        ? `${snapshot.systemNames[bestCIndex]} ${this.formatUsAsMs(snapshot.systemAvgUs[bestCIndex] | 0)}`
        : 'n/a'
    return `worker sys ${topA}  ${topB}  ${topC}  hash ${this.formatUsAsMs(snapshot.spatialHashAvgUs)}  clean ${this.formatUsAsMs(snapshot.cleanupAvgUs)}`
  }

  private maybeEmitPerfLogs(): void {
    this.perfLogWindowsSinceEmit++
    const terrainQueueTotal = this.pendingStaticTerrainTaskTotal
    const terrainQueueIndex = this.pendingStaticTerrainTaskIndex
    const terrainQueueActive =
      terrainQueueTotal > 0 && terrainQueueIndex < terrainQueueTotal
    const environmentQueueTotal =
      this.pendingStaticEnvironmentObjects?.length ?? 0
    const environmentQueueIndex = this.pendingStaticEnvironmentIndex
    const environmentQueueActive =
      environmentQueueTotal > 0 && environmentQueueIndex < environmentQueueTotal
    const queueActive = terrainQueueActive || environmentQueueActive
    const queueStarted = queueActive && !this.perfLastStaticQueueActive
    const queueFinished = !queueActive && this.perfLastStaticQueueActive
    this.perfLastStaticQueueActive = queueActive

    const workerSnapshot = this.workerPerfSnapshot
    const workerTopSystemUs = this.getWorkerTopSystemAvgUs(workerSnapshot)
    const lightingSlow =
      this.perfLightingAvgUs >= GameClient.PERF_LOG_SYSTEM_WARN_US
    const frameSpikeSlow =
      this.perfFrameMaxUs >= GameClient.PERF_LOG_FRAME_MAX_WARN_US &&
      (this.perfFrameAvgUs >= GameClient.PERF_LOG_FRAME_SPIKE_GUARD_US ||
        this.perfRenderAvgUs >= GameClient.PERF_LOG_FRAME_SPIKE_GUARD_US ||
        this.perfWorldAvgUs >= GameClient.PERF_LOG_FRAME_SPIKE_GUARD_US ||
        this.perfUpdateAvgUs >= GameClient.PERF_LOG_FRAME_SPIKE_GUARD_US)
    const mainSlow =
      this.perfFrameAvgUs >= GameClient.PERF_LOG_FRAME_WARN_US ||
      frameSpikeSlow ||
      this.perfWorldAvgUs >= GameClient.PERF_LOG_WORLD_WARN_US ||
      lightingSlow
    const workerSlow =
      !!workerSnapshot &&
      (workerSnapshot.updateAvgUs >= GameClient.PERF_LOG_WORKER_WARN_US ||
        workerSnapshot.worldUpdateAvgUs >= GameClient.PERF_LOG_WORLD_WARN_US ||
        workerTopSystemUs >= GameClient.PERF_LOG_SYSTEM_WARN_US)
    const grassSlow =
      this.perfGrassUpdateAvgUs >= GameClient.PERF_LOG_GRASS_WARN_US ||
      this.perfGrassUpdateMaxUs >= GameClient.PERF_LOG_GRASS_WARN_US * 2
    const staticHeavy =
      (this.perfStaticBuildCount > 0 &&
        this.perfStaticBuildMaxUs >=
          GameClient.PERF_LOG_STATIC_BUILD_WARN_US) ||
      (this.perfTerrainBuildCount > 0 &&
        this.perfTerrainBuildMaxUs >=
          GameClient.PERF_LOG_STATIC_BUILD_WARN_US) ||
      (this.perfEnvironmentBuildCount > 0 &&
        this.perfEnvironmentBuildMaxUs >=
          GameClient.PERF_LOG_STATIC_BUILD_WARN_US)
    const shouldEmit =
      queueStarted ||
      queueFinished ||
      staticHeavy ||
      grassSlow ||
      mainSlow ||
      workerSlow ||
      (this.perfLogWindowsSinceEmit >= GameClient.PERF_LOG_HEARTBEAT_WINDOWS &&
        (queueActive || mainSlow || workerSlow || grassSlow))

    if (!shouldEmit) {
      return
    }

    const reason = queueStarted
      ? 'queue-start'
      : queueFinished
        ? 'queue-finish'
        : staticHeavy
          ? 'static-heavy'
          : lightingSlow
            ? 'lighting-slow'
            : grassSlow
              ? 'grass-slow'
              : mainSlow
                ? 'main-slow'
                : workerSlow
                  ? 'worker-slow'
                  : 'heartbeat'
    const voronoiPerf = getVoronoiBuildPerfSnapshot()
    const mainSummary =
      `reason=${reason} ` +
      `frame=${this.formatUsAsMs(this.perfFrameAvgUs)}/${this.formatUsAsMs(this.perfFrameMaxUs)} ` +
      `main=${this.formatUsAsMs(this.perfUpdateAvgUs)} world=${this.formatUsAsMs(this.perfWorldAvgUs)} light=${this.formatUsAsMs(this.perfLightingAvgUs)} scene=${this.formatUsAsMs(this.perfSceneRenderAvgUs)} render=${this.formatUsAsMs(this.perfRenderAvgUs)} ` +
      `state=${this.formatUsAsMs(this.perfStateSyncAvgUs)} fx=${this.formatUsAsMs(this.perfEffectsApplyAvgUs)} ` +
      `static=${this.formatUsAsMs(this.perfStaticBuildAvgUs)}/${this.formatUsAsMs(this.perfStaticBuildMaxUs)} ` +
      `terrain=${this.formatUsAsMs(this.perfTerrainBuildAvgUs)} env=${this.formatUsAsMs(this.perfEnvironmentBuildAvgUs)} ` +
      `grass=${this.formatUsAsMs(this.perfGrassUpdateAvgUs)}/${this.formatUsAsMs(this.perfGrassUpdateMaxUs)} all=${this.perfGrassCountAvg} view=${this.perfGrassInViewAvg} actor=${this.perfGrassInteractorAvg} cand=${this.perfGrassCandidateAvg} test=${this.perfGrassInteractionTestAvg} dyn=${this.perfGrassDynamicAvg} ` +
      `lights=${this.lightingController.getVisibleLightCount()}/${this.lightingController.getMapLightCount()} filter=${this.lightingFilterApplied ? 'on' : 'off'} ` +
      `queue=t${terrainQueueIndex}/${terrainQueueTotal} e${environmentQueueIndex}/${environmentQueueTotal} envCache=${this.perfEnvironmentCacheHits}/${this.perfEnvironmentCacheMisses} ` +
      `ent=${this.renderer.getEntityCount()} vis=${this.worldRenderer.getVisibleEntityCount()} ptc=${this.renderer.getActiveParticleCount()} spine=${this.worldRenderer.getActiveSpineCount()}`
    console.info('[Perf]', mainSummary)

    if (
      voronoiPerf.buildTimeUs > 0 &&
      (staticHeavy || queueStarted || queueFinished)
    ) {
      console.info(
        '[Perf]',
        `voronoi build=${this.formatUsAsMs(voronoiPerf.buildTimeUs)} sites=${voronoiPerf.siteCount} cells=${voronoiPerf.renderCellCount} clip=${voronoiPerf.clippedPolygonCount} chunks=${voronoiPerf.sourceChunkCount}/${voronoiPerf.includedChunkCount}`
      )
    }

    if (
      workerSnapshot &&
      (workerSlow || queueStarted || queueFinished || staticHeavy)
    ) {
      console.info(
        '[Perf]',
        `${this.buildWorkerPerfLine(workerSnapshot)} | ${this.buildWorkerSystemPerfLine(workerSnapshot)}`
      )
    }

    this.perfLogWindowsSinceEmit = 0
  }

  private getWorkerTopSystemAvgUs(
    snapshot: WorkerPerfSnapshotMessage | null
  ): number {
    if (!snapshot || snapshot.systemAvgUs.length === 0) {
      return 0
    }
    let best = 0
    for (let i = 0; i < snapshot.systemAvgUs.length; i++) {
      const value = snapshot.systemAvgUs[i] | 0
      if (value > best) {
        best = value
      }
    }
    return best
  }

  private formatUsAsMs(timeUs: number): string {
    if (!Number.isFinite(timeUs) || timeUs < 0) {
      return '--.-ms'
    }
    const roundedTenthMs = Math.round(timeUs / 100)
    const integerPart = Math.floor(roundedTenthMs / 10)
    const decimalPart = Math.abs(roundedTenthMs % 10)
    return `${integerPart}.${decimalPart}ms`
  }

  private updatePreviewCaptureState(): void {
    if (!this.previewActive) {
      return
    }
    if (this.workerStateRevision < this.previewAwaitStateRevision) {
      return
    }

    const cameraX = Math.round(this.camera.x * this.pixelsPerMeter)
    const cameraY = Math.round(this.camera.y * this.pixelsPerMeter)
    const zoom = Math.round(this.renderZoom * 1000)

    if (this.previewFirstRenderRevision === 0) {
      this.previewFirstRenderRevision = this.renderFrameRevision
      this.previewCameraStableFrames = 1
      this.previewTrackedCameraX = cameraX
      this.previewTrackedCameraY = cameraY
      this.previewTrackedZoom = zoom
      return
    }

    if (
      this.previewTrackedCameraX === cameraX &&
      this.previewTrackedCameraY === cameraY &&
      this.previewTrackedZoom === zoom
    ) {
      this.previewCameraStableFrames++
      return
    }

    this.previewTrackedCameraX = cameraX
    this.previewTrackedCameraY = cameraY
    this.previewTrackedZoom = zoom
    this.previewCameraStableFrames = 1
  }

  private renderCameraDebug(): void {
    const ctx = this.hudRenderContext
    const canvasWidth = this.app.renderer.width
    const canvasHeight = this.app.renderer.height
    ctx.setRenderZIndex(100000)
    const topLimitY = this.cameraDebug.topLimitRatio * canvasHeight
    const bottomLimitY = this.cameraDebug.bottomLimitRatio * canvasHeight

    ctx.save()
    ctx.lineWidth = 1
    ctx.strokeStyle = this.cameraDebug.isOutsideVerticalZone
      ? '#ff3b30'
      : '#00d2ff'

    ctx.beginPath()
    ctx.moveTo(0, topLimitY)
    ctx.lineTo(canvasWidth, topLimitY)
    ctx.moveTo(0, bottomLimitY)
    ctx.lineTo(canvasWidth, bottomLimitY)
    ctx.stroke()

    ctx.strokeStyle = '#ffb020'
    ctx.strokeRect(1, 1, canvasWidth - 2, canvasHeight - 2)
    ctx.restore()
  }

  // Public Control API (Proxy to Worker)
  setOnFirstFrameRendered(callback: () => void) {
    this.onFirstFrameRendered = callback
  }

  stop() {
    this.worker.postMessage({ type: 'control', action: 'stop' })
  }
  start() {
    this.worker.postMessage({ type: 'control', action: 'start' })
  }
  restart() {
    this.worker.postMessage({ type: 'control', action: 'restart' })
  }
  clearMapPreview() {
    this.previewActive = false
    this.setPreviewExitVisible(false)
    this.applySaveTimeCycle(this.currentSaveData)
    this.worker.postMessage({ type: 'control', action: 'clear_map_preview' })
  }

  scheduleStartMenu(delayMs: number, skipAnimation = false) {
    this.pendingStartMenuDelayMs = Math.max(0, delayMs | 0)
    this.pendingStartMenuSkipAnimation = skipAnimation
    this.startMenuPauseArmed = false
    this.startMenuStableElapsedMs = 0
  }

  showStartMenu(skipAnimation = false) {
    this.pendingStartMenuDelayMs = -1
    this.pendingStartMenuSkipAnimation = false
    this.setInputEnabled(false)
    void this.menuManager
      .showWithSaveRefresh(MenuMode.Start, skipAnimation)
      .then(() => {
        if (
          this.menuManager.isVisible() &&
          this.menuManager.getMode() === MenuMode.Start
        ) {
          this.armStartMenuPause()
        }
      })
  }

  setAudioMuted(muted: boolean): void {
    this.audioManager.setMuted(muted)
  }

  isPreviewActive(): boolean {
    return this.previewActive
  }

  reloadDefaultMap() {
    this.worker.postMessage({ type: 'control', action: 'reload_default_map' })
  }

  setPreviewExitHandler(callback: () => void) {
    this.onExitPreviewCallback = callback
  }

  // Parameter Setters
  setGroundFriction(v: number) {
    this.updateParam('groundFriction', v)
  }
  setObstacleFriction(v: number) {
    this.updateParam('obstacleFriction', v)
  }
  setZoom(v: number) {
    this.targetZoom = v
    this.sendInput()
  }
  getZoom() {
    return this.targetZoom
  }

  setJumpBufferWindow(v: number) {
    this.updateParam('jumpBufferWindow', v)
  }

  getPlayer() {
    return {
      setJumpForce: (v: number) => this.updateParam('jumpForce', v),
      setMaxJumpDuration: (v: number) => this.updateParam('maxJumpDuration', v),
      setJumpForceMultiplier: (v: number) =>
        this.updateParam('jumpForceMultiplier', v),
      setWallJumpPushAwayMultiplier: (v: number) =>
        this.updateParam('wallJumpPushAway', v),
      setWallJumpUpwardMultiplier: (v: number) =>
        this.updateParam('wallJumpUpward', v),
      setMaxWallJumps: (v: number) => this.updateParam('maxWallJumps', v),
      setMoveSpeed: (v: number) => this.updateParam('moveSpeed', v),
      setBodyFriction: (v: number) => this.updateParam('bodyFriction', v),
      setBodyLinearDamping: (v: number) =>
        this.updateParam('bodyLinearDamping', v),
      setBaseWeight: (v: number) => this.updateParam('baseWeight', v),
      setWeaponWeight: (_v: number) => {},
      applyHit: () => {},
      revive: () => {},
      setAlive: (_alive: boolean) => {},
    }
  }

  setRopeDensity(value: number): void {
    this.updateParam('ropeDensity', value)
  }

  setBreakableCrateDensity(value: number): void {
    this.updateParam('breakableCrateDensity', value)
  }

  setBreakableCrateFriction(value: number): void {
    this.updateParam('breakableCrateFriction', value)
  }

  setBreakableCrateLinearDamping(value: number): void {
    this.updateParam('breakableCrateLinearDamping', value)
  }

  setBreakableCrateAngularDamping(value: number): void {
    this.updateParam('breakableCrateAngularDamping', value)
  }

  setBreakableCrateRestitution(value: number): void {
    this.updateParam('breakableCrateRestitution', value)
  }

  setRopeLinearDamping(value: number): void {
    this.updateParam('ropeLinearDamping', value)
  }

  setRopeHertz(value: number): void {
    this.updateParam('ropeHertz', value)
  }

  setRopeDampingRatio(value: number): void {
    this.updateParam('ropeDampingRatio', value)
  }

  setRopeClimbLinearDamping(value: number): void {
    this.updateParam('ropeClimbLinearDamping', value)
  }

  setRopeClimbHertz(value: number): void {
    this.updateParam('ropeClimbHertz', value)
  }

  setRopeClimbDampingRatio(value: number): void {
    this.updateParam('ropeClimbDampingRatio', value)
  }

  setRopeClimbWeightForceScale(value: number): void {
    this.updateParam('ropeClimbWeightForceScale', value)
  }

  setRopeClimbJumpRecoilScale(value: number): void {
    this.updateParam('ropeClimbJumpRecoilScale', value)
  }

  setSwingForce(value: number): void {
    this.updateParam('swingForce', value)
  }

  private updateParam(id: string, value: number) {
    this.worker.postMessage({
      type: 'control',
      action: 'update_param',
      paramId: id,
      value: value,
    })
  }

  getMenuManager(): MenuManager {
    return this.menuManager
  }

  private setPreviewExitVisible(visible: boolean) {
    if (this.previewActionsContainer) {
      this.previewActionsContainer.classList.toggle('is-visible', visible)
    }
    if (visible && this.previewPauseBtn) {
      this.previewPauseBtn.textContent = localizer.t('ui_pause')
    }
  }

  private togglePreviewPause() {
    if (!this.previewActive || !this.previewPauseBtn) {
      return
    }
    if (this.inputEnabled) {
      this.stop()
      this.setInputEnabled(false)
      this.previewPauseBtn.textContent = localizer.t('ui_resume')
    } else {
      this.start()
      this.setInputEnabled(true)
      this.previewPauseBtn.textContent = localizer.t('ui_pause')
    }
  }

  private exitPreview() {
    if (!this.previewActive) {
      return
    }
    this.previewActive = false
    this.setPreviewExitVisible(false)
    this.applySaveTimeCycle(this.currentSaveData)
    this.menuManager.hide()
    if (this.onExitPreviewCallback) {
      this.onExitPreviewCallback()
    }
  }

  async initSaveSystem(): Promise<void> {
    await this.menuManager.initSaveState()
    this.setupMenuActions()
  }

  private setupMenuActions(): void {
    this.menuManager.onAction(async (action, saveId) => {
      switch (action) {
        case MenuAction.NewGame:
          await this.startNewGame()
          break
        case MenuAction.Continue:
          await this.continueGame()
          break
        case MenuAction.SaveListSelect:
          if (saveId) {
            await this.loadSaveById(saveId)
          }
          break
        case MenuAction.SaveListNew:
          await this.startNewGame()
          break
        case MenuAction.Resume:
          this.menuManager.hide()
          this.resumeGameInput()
          break
        case MenuAction.SaveGame:
          this.dialogManager.showLoading(localizer.t('saving'))
          this.pendingSaveThumbnail = await this.captureSaveThumbnail()
          const saveResult = await this.requestSave()
          this.dialogManager.hideLoading()
          if (saveResult) {
            await this.dialogManager.alert(localizer.t('save_success'))
          } else {
            await this.dialogManager.alert(localizer.t('save_failed'))
          }
          this.menuManager.hide()
          this.resumeGameInput()
          break
        case MenuAction.MainMenu:
          if (this.currentSaveId) {
            await this.requestSave()
          }
          this.clearMapPreview()
          this.setEditorPreview(false)
          this.menuManager.hide()
          this.showStartMenu()
          break
        case MenuAction.Exit:
          if (this.onExitActionCallback) {
            const confirmed = await this.onExitActionCallback()
            if (confirmed) {
              window.close()
            }
          } else {
            const confirmed = await this.dialogManager.confirm(
              localizer.t('confirm_exit_game')
            )
            if (confirmed) {
              window.close()
            }
          }
          break
        case MenuAction.Editor:
          if (this.onEditorActionCallback) {
            this.onEditorActionCallback()
          }
          break
      }
    })
  }

  private async startNewGame(): Promise<void> {
    const defaultMap = await getDefaultMap()
    if (!defaultMap) {
      console.error('No default map found')
      return
    }

    const saveCount = (await saveManager.listSaves()).length
    const saveName = localizer
      .t('save_default_name')
      .replace('{0}', String(saveCount + 1))

    const playerMaxHealth = defaultMap.data.player?.maxHealth ?? 20
    const meta = await saveManager.createSave(
      saveName,
      defaultMap.meta.id,
      defaultMap.meta.name,
      defaultMap.data,
      playerMaxHealth
    )

    if (!meta) {
      console.error('Failed to create save')
      return
    }

    const saveData = await saveManager.loadSave(meta.id)
    if (!saveData) {
      console.error('Failed to load newly created save')
      return
    }

    this.currentSaveId = meta.id
    this.currentSaveData = saveData
    this.applySaveTimeCycle(saveData)
    this.sleepTransitionPhase = 'idle'
    this.sleepTransitionElapsedMs = 0
    this.sleepTransitionMidpointHandled = false
    this.updateSleepOverlay()

    this.setEditorPreview(false)
    if (this.previewActive) {
      this.clearMapPreview()
    }

    this.worker.postMessage({
      type: 'load_save',
      saveData,
    } as MainToWorkerMessage)

    this.clearStartMenuFlow()
    this.menuManager.hide()
    this.resumeGameInput()
  }

  private async continueGame(): Promise<void> {
    const lastSaveId = await saveManager.getLastSaveId()
    if (!lastSaveId) {
      await this.startNewGame()
      return
    }

    await this.loadSaveById(lastSaveId)
  }

  private async loadSaveById(saveId: string): Promise<void> {
    const saveData = await saveManager.loadSave(saveId)
    if (!saveData) {
      console.error('Failed to load save:', saveId)
      return
    }

    this.currentSaveId = saveId
    this.currentSaveData = saveData
    this.applySaveTimeCycle(saveData)
    this.sleepTransitionPhase = 'idle'
    this.sleepTransitionElapsedMs = 0
    this.sleepTransitionMidpointHandled = false
    this.updateSleepOverlay()

    this.setEditorPreview(false)
    if (this.previewActive) {
      this.clearMapPreview()
    }

    this.worker.postMessage({
      type: 'load_save',
      saveData,
    } as MainToWorkerMessage)

    this.clearStartMenuFlow()
    this.menuManager.hide()
    this.resumeGameInput()
  }

  private resumeGameInput() {
    this.clearStartMenuFlow()
    this.levelUpManager.hide()
    this.start()
    this.inputEnabled = true
    this.requestGameFocus()
  }

  private updateStartMenuFlow(deltaMs: number) {
    if (this.pendingStartMenuDelayMs >= 0) {
      this.pendingStartMenuDelayMs -= deltaMs
      if (this.pendingStartMenuDelayMs <= 0) {
        const skipAnimation = this.pendingStartMenuSkipAnimation
        this.pendingStartMenuDelayMs = -1
        this.pendingStartMenuSkipAnimation = false
        this.showStartMenu(skipAnimation)
      }
    }

    if (!this.startMenuPauseArmed) {
      return
    }

    if (
      !this.menuManager.isVisible() ||
      this.menuManager.getMode() !== MenuMode.Start
    ) {
      this.startMenuPauseArmed = false
      this.startMenuStableElapsedMs = 0
      return
    }

    const cameraX = Math.round(this.camera.x * this.pixelsPerMeter)
    const cameraY = Math.round(this.camera.y * this.pixelsPerMeter)
    if (
      cameraX === this.lastStartMenuCameraX &&
      cameraY === this.lastStartMenuCameraY
    ) {
      this.startMenuStableElapsedMs += deltaMs
    } else {
      this.startMenuStableElapsedMs = 0
      this.lastStartMenuCameraX = cameraX
      this.lastStartMenuCameraY = cameraY
    }

    if (
      this.startMenuStableElapsedMs >= GameClient.START_MENU_CAMERA_STABLE_MS
    ) {
      this.stop()
      this.startMenuPauseArmed = false
      this.startMenuStableElapsedMs = 0
    }
  }

  private armStartMenuPause() {
    this.startMenuPauseArmed = true
    this.startMenuStableElapsedMs = 0
    this.lastStartMenuCameraX = Math.round(this.camera.x * this.pixelsPerMeter)
    this.lastStartMenuCameraY = Math.round(this.camera.y * this.pixelsPerMeter)
  }

  private clearStartMenuFlow() {
    this.pendingStartMenuDelayMs = -1
    this.pendingStartMenuSkipAnimation = false
    this.startMenuPauseArmed = false
    this.startMenuStableElapsedMs = 0
  }

  requestSave(): Promise<SaveData | null> {
    if (!this.currentSaveId || !this.currentSaveData) {
      return Promise.resolve(null)
    }

    return new Promise((resolve) => {
      this.pendingSaveResolve = resolve
      this.worker.postMessage({
        type: 'save_request',
        saveId: this.currentSaveId,
      } as MainToWorkerMessage)

      setTimeout(() => {
        if (this.pendingSaveResolve === resolve) {
          this.pendingSaveResolve = null
          this.pendingSaveThumbnail = null
          resolve(null)
        }
      }, 5000)
    })
  }

  private rebuildStaticScene(): void {
    const staticBuildStartMs = performance.now()
    const mapData = this.currentMapData
    if (!mapData) {
      this.worldRenderer.invalidateStaticMeshCaches()
      this.destroyStaticGraphics(this.staticTerrainGraphics)
      this.staticTerrainGraphics.length = 0
      this.destroyStaticEnvironmentSprites()
      this.destroyInteractiveGrassDecorations()
      this.activeEnvironmentTextureKeys.clear()
      this.pruneEnvironmentTextureCaches(this.activeEnvironmentTextureKeys)
      this.clearPendingStaticTerrainBuild()
      this.clearPendingStaticEnvironmentBuild()
      this.staticTerrainSignature = 0
      this.staticEnvironmentSignature = 0
      this.staticTerrainReady = false
      this.staticEnvironmentReady = false
      this.recordStaticBuildTime(staticBuildStartMs)
      return
    }

    const terrain = mapData.terrain
    const nextTerrainSignature = this.computeTerrainRenderSignature(terrain)
    if (
      !this.staticTerrainReady ||
      this.staticTerrainSignature !== nextTerrainSignature
    ) {
      this.clearPendingStaticTerrainBuild()
      if (terrain && hasTerrainContent(terrain)) {
        this.preparePendingStaticTerrainBuild(terrain, nextTerrainSignature)
      } else {
        this.worldRenderer.invalidateStaticMeshCaches()
        this.destroyStaticGraphics(this.staticTerrainGraphics)
        this.staticTerrainGraphics.length = 0
        this.staticTerrainSignature = nextTerrainSignature
        this.staticTerrainReady = true
      }
    }

    const envObjects = mapData.environmentObjects
    const layerLookup =
      envObjects && envObjects.length > 0
        ? buildMapObjectLayerLookup(mapData)
        : null
    const envLayers = layerLookup?.environmentObjectLayers ?? null
    const nextEnvSignature = this.computeEnvironmentRenderSignature(
      envObjects,
      envLayers
    )
    if (
      !this.staticEnvironmentReady ||
      this.staticEnvironmentSignature !== nextEnvSignature
    ) {
      this.worldRenderer.invalidateStaticMeshCaches()
      this.destroyStaticEnvironmentSprites()
      this.destroyInteractiveGrassDecorations()
      this.clearPendingStaticEnvironmentBuild()

      if (envObjects && envObjects.length > 0) {
        this.grassInteractionGridCellSizePx = Math.max(
          1,
          Math.round(this.pixelsPerMeter * GRASS_INTERACTION_GRID_CELL_METERS)
        )
        this.pendingStaticEnvironmentObjects = envObjects
        this.pendingStaticEnvironmentLayers = envLayers
        this.pendingStaticEnvironmentIndex = 0
        this.pendingStaticEnvironmentSignature = nextEnvSignature
        this.pendingEnvironmentTextureKeys.clear()
        this.staticEnvironmentReady = false
      } else {
        this.staticEnvironmentSignature = nextEnvSignature
        this.staticEnvironmentReady = true
        this.activeEnvironmentTextureKeys.clear()
        this.pruneEnvironmentTextureCaches(this.activeEnvironmentTextureKeys)
      }
    }

    this.finalizeStaticSceneCaches()
    this.recordStaticBuildTime(staticBuildStartMs)
  }

  private syncStaticScene(map: EditorMapData | null): void {
    const nextTerrainSignature = this.computeTerrainRenderSignature(
      map?.terrain
    )
    const envLayerLookup =
      map?.environmentObjects && map.environmentObjects.length > 0
        ? buildMapObjectLayerLookup(map)
        : null
    const nextEnvSignature = this.computeEnvironmentRenderSignature(
      map?.environmentObjects,
      envLayerLookup?.environmentObjectLayers ?? null
    )
    if (
      ((this.staticTerrainReady &&
        this.staticTerrainSignature === nextTerrainSignature) ||
        (!this.staticTerrainReady &&
          this.pendingStaticTerrainSignature === nextTerrainSignature)) &&
      ((this.staticEnvironmentReady &&
        this.staticEnvironmentSignature === nextEnvSignature) ||
        (!this.staticEnvironmentReady &&
          this.pendingStaticEnvironmentSignature === nextEnvSignature))
    ) {
      return
    }
    this.rebuildStaticScene()
  }

  private preloadRuntimeEnvironmentAssets(map: EditorMapData): void {
    this.environmentAssetPreloadRevision += 1
    const revision = this.environmentAssetPreloadRevision
    void ensureRuntimeEnvironmentAssetsForMap(map)
      .then((result) => {
        if (
          revision !== this.environmentAssetPreloadRevision ||
          this.currentMapData !== map ||
          result.requested === 0 ||
          result.loaded === 0
        ) {
          return
        }
        this.forceRebuildStaticEnvironment(map)
      })
      .catch(() => {})
  }

  private forceRebuildStaticEnvironment(map: EditorMapData): void {
    this.worldRenderer.invalidateStaticMeshCaches()
    this.destroyStaticEnvironmentSprites()
    this.destroyInteractiveGrassDecorations()
    this.clearPendingStaticEnvironmentBuild()
    this.staticEnvironmentSignature = 0
    this.staticEnvironmentReady = false
    this.activeEnvironmentTextureKeys.clear()
    this.pendingEnvironmentTextureKeys.clear()
    this.clearEnvironmentTextureCaches()
    this.syncStaticScene(map)
  }

  private clearEnvironmentTextureCaches(): void {
    for (const [, entry] of this.environmentTextureCache) {
      entry.texture.destroy(true)
    }
    this.environmentTextureCache.clear()
    clearEnvironmentTextureSourceCache()
  }

  private finalizeStaticSceneCaches(): void {
    if (!this.staticTerrainReady || !this.staticEnvironmentReady) {
      return
    }
    if (this.staticSceneTextureCacheDisabled) {
      this.worldRenderer.invalidateStaticMeshCaches()
      return
    }
    this.worldRenderer.refreshStaticMeshCaches()
  }

  private recordStaticBuildTime(startMs: number): void {
    const elapsedUs = Math.round((performance.now() - startMs) * 1000)
    this.lastStaticBuildTimeUs = elapsedUs
    this.perfStaticBuildTotalUs += elapsedUs
    this.perfStaticBuildCount++
    if (elapsedUs > this.perfStaticBuildMaxUs) {
      this.perfStaticBuildMaxUs = elapsedUs
    }
  }

  private recordTerrainBuildTime(startMs: number): void {
    const elapsedUs = Math.round((performance.now() - startMs) * 1000)
    this.lastTerrainBuildTimeUs = elapsedUs
    this.perfTerrainBuildTotalUs += elapsedUs
    this.perfTerrainBuildCount++
    if (elapsedUs > this.perfTerrainBuildMaxUs) {
      this.perfTerrainBuildMaxUs = elapsedUs
    }
  }

  private recordEnvironmentBuildTime(startMs: number): void {
    const elapsedUs = Math.round((performance.now() - startMs) * 1000)
    this.lastEnvironmentBuildTimeUs = elapsedUs
    this.perfEnvironmentBuildTotalUs += elapsedUs
    this.perfEnvironmentBuildCount++
    if (elapsedUs > this.perfEnvironmentBuildMaxUs) {
      this.perfEnvironmentBuildMaxUs = elapsedUs
    }
  }

  private destroyStaticGraphics(list: Container[]): void {
    for (let i = 0; i < list.length; i++) {
      const graphics = list[i]
      if (graphics.parent) {
        graphics.parent.removeChild(graphics)
      }
      if (graphics instanceof Sprite) {
        const texture = graphics.texture
        graphics.destroy()
        if (texture !== Texture.EMPTY && texture !== Texture.WHITE) {
          texture.destroy(true)
        }
        continue
      }
      graphics.destroy()
    }
  }

  private destroyStaticEnvironmentSprites(): void {
    for (let i = 0; i < this.staticEnvironmentSprites.length; i++) {
      const sprite = this.staticEnvironmentSprites[i]
      if (sprite.parent) {
        sprite.parent.removeChild(sprite)
      }
      sprite.destroy()
    }
    this.staticEnvironmentSprites.length = 0
  }

  private destroyInteractiveGrassDecorations(): void {
    for (let i = 0; i < this.interactiveGrassDecorations.length; i++) {
      this.interactiveGrassDecorations[i].destroy()
    }
    this.interactiveGrassDecorations.length = 0
    this.interactiveGrassGrid.clear()
    this.grassDynamicInViewFlags = new Uint8Array(0)
    this.grassInteractorPrevX.clear()
    this.grassInteractorPrevY.clear()
  }

  private insertInteractiveGrassDecoration(
    decoration: InteractiveGrassDecoration
  ): void {
    const layerGrid = this.getInteractiveGrassLayerGrid(decoration.getLayer())
    const cellSize = this.grassInteractionGridCellSizePx
    const centerX = decoration.getRenderX()
    const centerY = decoration.getRenderY()
    const radius = decoration.getInteractionRadiusPx()
    const minCellX = this.getGrassGridCellCoord(centerX - radius, cellSize)
    const maxCellX = this.getGrassGridCellCoord(centerX + radius, cellSize)
    const minCellY = this.getGrassGridCellCoord(centerY - radius, cellSize)
    const maxCellY = this.getGrassGridCellCoord(centerY + radius, cellSize)

    for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        const key = this.getGrassGridCellKey(cellX, cellY)
        let bucket = layerGrid.get(key)
        if (!bucket) {
          bucket = []
          layerGrid.set(key, bucket)
        }
        bucket.push(decoration)
      }
    }
  }

  private getInteractiveGrassLayerGrid(
    layer: number
  ): Map<number, InteractiveGrassDecoration[]> {
    let layerGrid = this.interactiveGrassGrid.get(layer)
    if (!layerGrid) {
      layerGrid = new Map<number, InteractiveGrassDecoration[]>()
      this.interactiveGrassGrid.set(layer, layerGrid)
    }
    return layerGrid
  }

  private getGrassGridCellCoord(value: number, cellSize: number): number {
    return Math.floor(value / cellSize)
  }

  private getGrassGridCellKey(cellX: number, cellY: number): number {
    const keyX =
      (cellX + GRASS_INTERACTION_GRID_KEY_OFFSET) &
      GRASS_INTERACTION_GRID_KEY_MASK
    const keyY =
      (cellY + GRASS_INTERACTION_GRID_KEY_OFFSET) &
      GRASS_INTERACTION_GRID_KEY_MASK
    return keyX | (keyY << 16) | 0
  }

  private ensureGrassDynamicInViewCapacity(size: number): void {
    if (this.grassDynamicInViewFlags.length >= size) {
      return
    }
    let nextSize = Math.max(32, this.grassDynamicInViewFlags.length)
    while (nextSize < size) {
      nextSize <<= 1
    }
    this.grassDynamicInViewFlags = new Uint8Array(nextSize)
  }

  private nextGrassInteractionQueryId(): number {
    this.grassInteractionQueryId = (this.grassInteractionQueryId + 1) | 0
    if (this.grassInteractionQueryId <= 0) {
      this.grassInteractionQueryId = 1
    }
    return this.grassInteractionQueryId
  }

  private preparePendingStaticTerrainBuild(
    terrain: TerrainDataLike,
    nextTerrainSignature: number
  ): void {
    this.pendingStaticTerrainGraphics.length = 0
    this.pendingStaticTerrainGraphicLayers.length = 0
    const layers = getTerrainLayerViews(terrain)
    if (layers.length <= 0) {
      this.staticTerrainSignature = nextTerrainSignature
      this.staticTerrainReady = true
      return
    }

    let taskTotal = 0
    for (let i = 0; i < layers.length; i++) {
      taskTotal += layers[i].version >= 4 ? 1 : layers[i].chunks.length
    }
    if (taskTotal <= 0) {
      this.staticTerrainSignature = nextTerrainSignature
      this.staticTerrainReady = true
      return
    }

    this.pendingStaticTerrainSignature = nextTerrainSignature
    this.pendingStaticTerrainLayers = layers
    this.pendingStaticTerrainLayerIndex = 0
    this.pendingStaticTerrainChunkIndex = 0
    this.pendingStaticTerrainTaskIndex = 0
    this.pendingStaticTerrainTaskTotal = taskTotal
    this.staticTerrainReady = false
  }

  private clearPendingStaticTerrainBuild(): void {
    this.destroyStaticGraphics(this.pendingStaticTerrainGraphics)
    this.pendingStaticTerrainGraphics.length = 0
    this.pendingStaticTerrainGraphicLayers.length = 0
    this.pendingStaticTerrainSignature = 0
    this.pendingStaticTerrainLayers = null
    this.pendingStaticTerrainLayerIndex = 0
    this.pendingStaticTerrainChunkIndex = 0
    this.pendingStaticTerrainTaskIndex = 0
    this.pendingStaticTerrainTaskTotal = 0
  }

  private clearPendingStaticEnvironmentBuild(): void {
    this.pendingStaticEnvironmentSignature = 0
    this.pendingStaticEnvironmentObjects = null
    this.pendingStaticEnvironmentLayers = null
    this.pendingStaticEnvironmentIndex = 0
    this.pendingEnvironmentTextureKeys.clear()
  }

  private pumpStaticSceneBuild(): void {
    const deadline = performance.now() + GameClient.STATIC_SCENE_BUILD_BUDGET_MS
    this.pumpStaticTerrainBuild(deadline)
    if (performance.now() >= deadline) {
      return
    }
    this.pumpStaticEnvironmentBuild(deadline)
  }

  private pumpStaticTerrainBuild(deadlineMs: number): void {
    const layers = this.pendingStaticTerrainLayers
    if (!layers || layers.length === 0) {
      return
    }

    while (this.pendingStaticTerrainLayerIndex < layers.length) {
      const layer = layers[this.pendingStaticTerrainLayerIndex]
      const resolvedLayer = this.resolveStaticTerrainRenderLayer(layer)
      const terrainBuildStartMs = performance.now()
      let sprite: Sprite | null
      let appendCollisionDebug = false
      if (layer.version >= 4) {
        sprite = TerrainRenderer.createPixiTerrainLayerGraphic(
          layer,
          layer.cellSize * this.pixelsPerMeter,
          { drawStroke: true }
        )
        appendCollisionDebug = true
        this.pendingStaticTerrainLayerIndex++
      } else {
        sprite = TerrainRenderer.createPixiTerrainChunkGraphic(
          layer,
          this.pendingStaticTerrainChunkIndex,
          layer.cellSize * this.pixelsPerMeter,
          { drawStroke: true }
        )
        this.pendingStaticTerrainChunkIndex++
        if (this.pendingStaticTerrainChunkIndex >= layer.chunks.length) {
          this.pendingStaticTerrainChunkIndex = 0
          this.pendingStaticTerrainLayerIndex++
          appendCollisionDebug = true
        }
      }

      if (sprite) {
        sprite.zIndex = resolvedLayer * 10
        this.pendingStaticTerrainGraphics.push(sprite)
        this.pendingStaticTerrainGraphicLayers.push(resolvedLayer)
      }
      if (DEBUG_DRAW_TERRAIN_COLLISION_SHAPE && appendCollisionDebug) {
        this.appendPendingTerrainCollisionDebugGraphics(layer, resolvedLayer)
      }
      this.pendingStaticTerrainTaskIndex++
      this.recordTerrainBuildTime(terrainBuildStartMs)
      if (
        this.pendingStaticTerrainLayerIndex < layers.length &&
        performance.now() >= deadlineMs
      ) {
        return
      }
    }

    this.commitPendingStaticTerrainGraphics()
    this.clearPendingStaticTerrainBuild()
    this.finalizeStaticSceneCaches()
  }

  private commitPendingStaticTerrainGraphics(): void {
    this.worldRenderer.invalidateStaticMeshCaches()
    this.destroyStaticGraphics(this.staticTerrainGraphics)
    this.staticTerrainGraphics.length = 0

    for (let i = 0; i < this.pendingStaticTerrainGraphics.length; i++) {
      const graphics = this.pendingStaticTerrainGraphics[i]
      const layer = this.pendingStaticTerrainGraphicLayers[i] ?? 0
      this.worldRenderer.addStaticMesh(graphics, layer)
      this.staticTerrainGraphics.push(graphics)
    }

    this.pendingStaticTerrainGraphics.length = 0
    this.pendingStaticTerrainGraphicLayers.length = 0
    this.staticTerrainSignature = this.pendingStaticTerrainSignature
    this.staticTerrainReady = true
  }

  private appendPendingTerrainCollisionDebugGraphics(
    layer: TerrainResolvedLayerView,
    resolvedLayer: number
  ): void {
    const graphics = this.createTerrainCollisionDebugGraphics(layer)
    if (!graphics) {
      return
    }
    graphics.zIndex = resolvedLayer * 10 + 1
    this.pendingStaticTerrainGraphics.push(graphics)
    this.pendingStaticTerrainGraphicLayers.push(resolvedLayer)
  }

  private createTerrainCollisionDebugGraphics(
    layer: TerrainResolvedLayerView
  ): Graphics | null {
    const graphics = new Graphics()
    let hasPath = false
    const cellSizePx = layer.cellSize * this.pixelsPerMeter

    if (layer.version >= 4) {
      const polygons = VoronoiCollisionBuilder.buildLayerPolygons(
        layer,
        cellSizePx
      )
      for (let i = 0; i < polygons.length; i++) {
        hasPath =
          this.appendTerrainCollisionDebugPolygon(
            graphics,
            polygons[i].points
          ) || hasPath
      }
    } else {
      const rects = TerrainCollisionBuilder.buildLayerRectangles(layer)
      const offsetX = layer.offsetXUnits
      const offsetY = layer.offsetYUnits
      for (let i = 0; i < rects.length; i++) {
        const rect = rects[i]
        if (rect.materialTag === 'foliage') {
          continue
        }
        const x = rect.cellX * cellSizePx + offsetX
        const y = rect.cellY * cellSizePx + offsetY
        graphics.rect(
          x,
          y,
          rect.widthCells * cellSizePx,
          rect.heightCells * cellSizePx
        )
        hasPath = true
      }
    }

    if (!hasPath) {
      graphics.destroy()
      return null
    }

    graphics.stroke({
      color: TERRAIN_COLLISION_DEBUG_COLOR,
      width: TERRAIN_COLLISION_DEBUG_LINE_WIDTH,
      alpha: TERRAIN_COLLISION_DEBUG_ALPHA,
    })
    return graphics
  }

  private appendTerrainCollisionDebugPolygon(
    graphics: Graphics,
    points: readonly number[]
  ): boolean {
    if (points.length < 6) {
      return false
    }
    graphics.moveTo(points[0], points[1])
    for (let i = 2; i < points.length; i += 2) {
      graphics.lineTo(points[i], points[i + 1])
    }
    graphics.closePath()
    return true
  }

  private pumpStaticEnvironmentBuild(deadlineMs: number): void {
    const envObjects = this.pendingStaticEnvironmentObjects
    if (!envObjects || envObjects.length === 0) {
      return
    }

    const envLayers = this.pendingStaticEnvironmentLayers
    const ppm = this.pixelsPerMeter

    while (this.pendingStaticEnvironmentIndex < envObjects.length) {
      const index = this.pendingStaticEnvironmentIndex
      const obj = envObjects[index]
      this.pendingStaticEnvironmentIndex = index + 1
      if (obj.hidden === true) {
        if (
          this.pendingStaticEnvironmentIndex < envObjects.length &&
          performance.now() >= deadlineMs
        ) {
          return
        }
        continue
      }
      const envBuildStartMs = performance.now()
      const scaleXPermille = getEnvironmentScaleXPermille(obj)
      const scaleYPermille = getEnvironmentScaleYPermille(obj)
      const cellStroke =
        isEnvironmentCellStrokeSupported(obj.type) && obj.cellStroke === true
      const flowerOptions =
        obj.type === 'flower' ? obj.flowerOptions : undefined
      const textureEntry = this.getEnvironmentTextureEntry(
        obj.type,
        obj.assetId,
        obj.seed,
        ppm,
        scaleXPermille,
        scaleYPermille,
        cellStroke,
        flowerOptions
      )
      this.pendingEnvironmentTextureKeys.add(textureEntry.key)
      const rotationDeg = getEnvironmentRotationDeg(obj)
      writeEnvironmentTransformedOffset(
        textureEntry.anchorOffsetX,
        textureEntry.anchorOffsetY,
        rotationDeg,
        scaleXPermille,
        scaleYPermille,
        this.reusableEnvironmentAnchorOffset
      )
      const rawLayer = envLayers?.[index] ?? 0
      const resolvedLayer = this.resolveEnvironmentRenderLayer(rawLayer)
      const renderX = obj.x * ppm - this.reusableEnvironmentAnchorOffset.x
      const renderY = obj.y * ppm - this.reusableEnvironmentAnchorOffset.y
      if (obj.type === 'grass' || obj.type === 'flower') {
        const decoration = new InteractiveGrassDecoration({
          type: obj.type,
          texture: textureEntry.texture,
          worldX: Math.round(obj.x * ppm),
          worldY: Math.round(obj.y * ppm),
          renderX,
          renderY,
          layer: resolvedLayer,
          rotationDeg,
          seed: obj.seed,
          ppm,
          scaleXPermille,
          scaleYPermille,
          flowerOptions,
        })
        this.worldRenderer.addEnvironmentDecoration(
          decoration.root,
          resolvedLayer
        )
        decoration.setRuntimeIndex(this.interactiveGrassDecorations.length)
        this.interactiveGrassDecorations.push(decoration)
        this.insertInteractiveGrassDecoration(decoration)
        this.recordEnvironmentBuildTime(envBuildStartMs)
        if (
          this.pendingStaticEnvironmentIndex < envObjects.length &&
          performance.now() >= deadlineMs
        ) {
          return
        }
        continue
      }
      const sprite = new Sprite(textureEntry.texture)
      sprite.anchor.set(textureEntry.centerAnchorX, textureEntry.centerAnchorY)
      sprite.x = renderX
      sprite.y = renderY
      sprite.angle = rotationDeg
      sprite.scale.set(1, 1)
      this.worldRenderer.addStaticMesh(sprite, resolvedLayer)
      this.staticEnvironmentSprites.push(sprite)
      this.recordEnvironmentBuildTime(envBuildStartMs)
      if (
        this.pendingStaticEnvironmentIndex < envObjects.length &&
        performance.now() >= deadlineMs
      ) {
        return
      }
    }

    this.staticEnvironmentSignature = this.pendingStaticEnvironmentSignature
    this.staticEnvironmentReady = true
    this.commitActiveEnvironmentTextureKeys()
    this.clearPendingStaticEnvironmentBuild()
    this.finalizeStaticSceneCaches()
  }

  private resolveStaticTerrainRenderLayer(
    layer: TerrainResolvedLayerView
  ): number {
    return layer.renderLayer !== undefined
      ? layer.renderLayer
      : layer.materialId
        ? getDefaultTerrainRenderLayer(layer.materialId)
        : 0
  }

  private getEnvironmentTextureEntry(
    type: MapEnvironmentObject['type'],
    assetId: string | undefined,
    seed: number,
    ppm: number,
    scaleXPermille: number,
    scaleYPermille: number,
    cellStroke: boolean,
    flowerOptions: MapEnvironmentObject['flowerOptions']
  ): EnvironmentTextureEntry {
    const key =
      type === 'custom'
        ? buildCustomEnvironmentTextureCacheKey(
            assetId,
            ppm,
            scaleXPermille,
            scaleYPermille
          )
        : buildEnvironmentTextureCacheKey(
            type,
            seed,
            ppm,
            scaleXPermille,
            scaleYPermille,
            cellStroke,
            flowerOptions
          )
    const cached = this.environmentTextureCache.get(key)
    if (cached) {
      this.perfEnvironmentCacheHits++
      this.environmentTextureCache.delete(key)
      this.environmentTextureCache.set(key, cached)
      return cached
    }

    this.perfEnvironmentCacheMisses++
    const source =
      type === 'custom'
        ? createCustomEnvironmentTextureSource(
            assetId,
            ppm,
            scaleXPermille,
            scaleYPermille
          )
        : createEnvironmentTextureSource(
            type,
            seed,
            ppm,
            scaleXPermille,
            scaleYPermille,
            cellStroke,
            flowerOptions
          )
    const centerOriginX = source.canvas.width >> 1
    const centerOriginY = source.canvas.height >> 1
    const entry: EnvironmentTextureEntry = {
      key,
      texture: Texture.from(source.canvas),
      centerAnchorX: centerOriginX / source.canvas.width,
      centerAnchorY: centerOriginY / source.canvas.height,
      anchorOffsetX: source.originX - centerOriginX,
      anchorOffsetY: source.originY - centerOriginY,
    }
    this.environmentTextureCache.set(key, entry)
    return entry
  }

  private commitActiveEnvironmentTextureKeys(): void {
    this.activeEnvironmentTextureKeys.clear()
    for (const key of this.pendingEnvironmentTextureKeys) {
      this.activeEnvironmentTextureKeys.add(key)
    }
    this.pruneEnvironmentTextureCaches(this.activeEnvironmentTextureKeys)
  }

  private pruneEnvironmentTextureCaches(activeKeys: ReadonlySet<string>): void {
    const maxEntries = Math.max(
      GameClient.ENVIRONMENT_TEXTURE_CACHE_LIMIT,
      activeKeys.size
    )
    for (const [key, entry] of this.environmentTextureCache) {
      if (activeKeys.has(key)) {
        continue
      }
      if (this.environmentTextureCache.size <= maxEntries) {
        break
      }
      entry.texture.destroy(true)
      this.environmentTextureCache.delete(key)
    }
    pruneEnvironmentTextureSourceCache(activeKeys, maxEntries)
  }

  private resolveEnvironmentRenderLayer(layer: number): number {
    return layer
  }

  private syncSkyReferenceCamera(map: EditorMapData | null | undefined): void {
    const camera = map?.camera
    if (
      camera &&
      camera.zoom > 0 &&
      Number.isFinite(camera.zoom) &&
      Number.isFinite(camera.x) &&
      Number.isFinite(camera.y)
    ) {
      this.worldRenderer.setSkyReferenceCamera(
        camera.x * this.pixelsPerMeter,
        camera.y * this.pixelsPerMeter,
        camera.zoom
      )
      return
    }
    this.worldRenderer.setSkyReferenceCamera(0, 0, 1)
  }

  private computeEnvironmentRenderSignature(
    envObjects: MapEnvironmentObject[] | null | undefined,
    envLayers: number[] | null | undefined
  ): number {
    if (!envObjects || envObjects.length === 0) {
      return 0
    }
    let hash = this.mixTerrainSignatureValue(envObjects.length)
    for (let i = 0; i < envObjects.length; i++) {
      const obj = envObjects[i]
      const hiddenCode = obj.hidden === true ? 1 : 0
      hash = this.mixTerrainSignatureValue(
        hash ^ Math.imul(hiddenCode, 0x7f4a7c15)
      )
      hash = this.mixTerrainSignatureValue(
        hash ^ Math.imul(obj.x | 0, 0x9e3779b1)
      )
      hash = this.mixTerrainSignatureValue(
        hash ^ Math.imul(obj.y | 0, 0x85ebca6b)
      )
      hash = this.mixTerrainSignatureValue(
        hash ^ Math.imul(obj.seed | 0, 0xc2b2ae35)
      )
      const rotationCode = getEnvironmentRotationDeg(obj)
      const scaleXCode = getEnvironmentScaleXPermille(obj)
      const scaleYCode = getEnvironmentScaleYPermille(obj)
      hash = this.mixTerrainSignatureValue(
        hash ^ Math.imul(rotationCode, 0x27d4eb2d)
      )
      hash = this.mixTerrainSignatureValue(
        hash ^ Math.imul(scaleXCode, 0x165667b1)
      )
      hash = this.mixTerrainSignatureValue(
        hash ^ Math.imul(scaleYCode, 0x1b873593)
      )
      const cellStrokeCode =
        isEnvironmentCellStrokeSupported(obj.type) && obj.cellStroke === true
          ? 1
          : 0
      hash = this.mixTerrainSignatureValue(
        hash ^ Math.imul(cellStrokeCode, 0x1f123bb5)
      )
      if (obj.type === 'flower') {
        const flowerKey = buildEnvironmentFlowerOptionsCacheKey(
          obj.flowerOptions
        )
        for (let j = 0; j < flowerKey.length; j++) {
          hash = this.mixTerrainSignatureValue(
            hash ^ Math.imul(flowerKey.charCodeAt(j), 0x27d4eb2d)
          )
        }
      }
      const layerCode = this.resolveEnvironmentRenderLayer(envLayers?.[i] ?? 0)
      hash = this.mixTerrainSignatureValue(
        hash ^ Math.imul(layerCode, 0x5bd1e995)
      )
      const typeCode =
        obj.type === 'tree'
          ? 1
          : obj.type === 'hill'
            ? 2
            : obj.type === 'house'
              ? 3
              : obj.type === 'crate'
                ? 4
                : obj.type === 'grass'
                  ? 5
                  : obj.type === 'flower'
                    ? 6
                    : obj.type === 'cloud'
                      ? 7
                      : 8
      hash = this.mixTerrainSignatureValue(hash ^ Math.imul(typeCode, 0x19660d))
      if (obj.type === 'custom' && obj.assetId) {
        for (let j = 0; j < obj.assetId.length; j++) {
          hash = this.mixTerrainSignatureValue(
            hash ^ Math.imul(obj.assetId.charCodeAt(j), 0x45d9f3b)
          )
        }
        const assetVersion =
          getRuntimeEnvironmentAsset(obj.assetId)?.meta.updatedAt ?? 0
        hash = this.mixTerrainSignatureValue(
          hash ^ Math.imul(assetVersion | 0, 0x119de1f3)
        )
      }
    }
    return hash
  }

  private computeTerrainRenderSignature(
    terrain: TerrainDataLike | null | undefined
  ): number {
    if (!terrain || !hasTerrainContent(terrain)) {
      return 0
    }
    let hash = this.mixTerrainSignatureValue(terrain.version | 0)
    hash = this.mixTerrainSignatureValue(
      hash ^ Math.imul(terrain.chunkSize | 0, 0x9e3779b1)
    )
    hash = this.mixTerrainSignatureValue(
      hash ^
        Math.imul(
          (terrain.randomSeed | 0) ^ ((terrain.layers?.length ?? 0) | 0),
          0x85ebca6b
        )
    )
    if (terrain.layers && terrain.layers.length > 0) {
      for (let i = 0; i < terrain.layers.length; i++) {
        hash = this.mixTerrainLayerSignature(hash, terrain.layers[i])
      }
      if (terrain.contours && terrain.contours.length > 0) {
        for (let i = 0; i < terrain.contours.length; i++) {
          hash = this.mixTerrainContourSignature(hash, terrain.contours[i])
        }
      }
      return hash
    }
    hash = this.mixTerrainSignatureValue(
      hash ^ Math.imul(terrain.chunks.length | 0, 0xc2b2ae35)
    )
    return hash
  }

  private mixTerrainLayerSignature(
    hash: number,
    layer: TerrainLayerLike
  ): number {
    let nextHash = this.mixTerrainSignatureValue(
      hash ^ Math.imul(layer.offsetCellX | 0, 0x27d4eb2d)
    )
    nextHash = this.mixTerrainSignatureValue(
      nextHash ^ Math.imul(layer.offsetCellY | 0, 0x165667b1)
    )
    nextHash = this.mixTerrainSignatureValue(
      nextHash ^ Math.imul((layer.offsetXUnits ?? 0) | 0, 0xd3a2646c)
    )
    nextHash = this.mixTerrainSignatureValue(
      nextHash ^ Math.imul((layer.offsetYUnits ?? 0) | 0, 0x9e3779b1)
    )
    nextHash = this.mixTerrainSignatureValue(
      nextHash ^ Math.imul((layer.renderLayer ?? 0) | 0, 0xd3a2646c)
    )
    nextHash = this.mixTerrainSignatureValue(
      nextHash ^ Math.imul((layer.contourId ?? 0) | 0, 0x9e3779b1)
    )
    nextHash = this.mixTerrainSignatureValue(
      nextHash ^ (layer.cellStroke === true ? 0x1f123bb5 : 0)
    )
    nextHash = this.mixTerrainSignatureValue(
      nextHash ^
        Math.imul(this.hashTerrainMaterialId(layer.materialId), 0x85ebca6b)
    )
    if (typeof layer.buildRevision === 'number') {
      return this.mixTerrainSignatureValue(
        nextHash ^ Math.imul(layer.buildRevision | 0, 0xc2b2ae35)
      )
    }
    return this.mixTerrainSignatureValue(
      nextHash ^ Math.imul(layer.chunks.length | 0, 0x4b3cd7a1)
    )
  }

  private mixTerrainContourSignature(
    hash: number,
    contour: TerrainContourLike
  ): number {
    let nextHash = this.mixTerrainSignatureValue(
      hash ^ Math.imul(contour.id | 0, 0x27d4eb2d)
    )
    nextHash = this.mixTerrainSignatureValue(
      nextHash ^ (contour.cellStroke === true ? 0x1f123bb5 : 0)
    )
    nextHash = this.mixTerrainSignatureValue(
      nextHash ^ (contour.straightEdge === true ? 0x165667b1 : 0)
    )
    if (typeof contour.buildRevision === 'number') {
      nextHash = this.mixTerrainSignatureValue(
        nextHash ^ Math.imul(contour.buildRevision | 0, 0xc2b2ae35)
      )
    }
    return nextHash
  }

  private hashTerrainMaterialId(materialId: string | undefined): number {
    if (!materialId) {
      return 0
    }
    let hash = 0
    for (let i = 0; i < materialId.length; i++) {
      hash = this.mixTerrainSignatureValue(
        hash ^ Math.imul(materialId.charCodeAt(i), i + 1)
      )
    }
    return hash
  }

  private mixTerrainSignatureValue(value: number): number {
    let mixed = value | 0
    mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b)
    mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b)
    return (mixed ^ (mixed >>> 16)) >>> 0
  }

  private recordInteractiveGrassPerf(
    startMs: number,
    grassCount: number,
    inViewCount: number,
    interactorCount: number,
    candidateCount: number,
    interactionTestCount: number,
    dynamicCount: number
  ): void {
    const elapsedUs = Math.round((performance.now() - startMs) * 1000)
    this.perfGrassUpdateTotalUs += elapsedUs
    if (elapsedUs > this.perfGrassUpdateMaxUs) {
      this.perfGrassUpdateMaxUs = elapsedUs
    }
    this.perfGrassCountTotal += grassCount
    this.perfGrassInViewTotal += inViewCount
    this.perfGrassInteractorTotal += interactorCount
    this.perfGrassCandidateTotal += candidateCount
    this.perfGrassInteractionTestTotal += interactionTestCount
    this.perfGrassDynamicTotal += dynamicCount
  }

  private updateInteractiveGrass(deltaMs: number): void {
    const perfStartMs = performance.now()
    const grassCount = this.interactiveGrassDecorations.length
    if (grassCount <= 0) {
      this.recordInteractiveGrassPerf(perfStartMs, 0, 0, 0, 0, 0, 0)
      return
    }

    this.ensureGrassDynamicInViewCapacity(grassCount)
    const hasPlayer = this.renderer.hasPlayerPosition()
    const playerX = hasPlayer
      ? Math.round(this.renderer.getPlayerWorldX() * this.pixelsPerMeter)
      : 0
    const playerY = hasPlayer
      ? Math.round(this.renderer.getPlayerWorldY() * this.pixelsPerMeter)
      : 0
    const width = this.app.renderer.width
    const height = this.app.renderer.height
    const centerX = width * 0.5
    const bottomY = height
    const camX = this.camera.x * this.pixelsPerMeter
    const camY = this.camera.y * this.pixelsPerMeter
    const zoom = this.renderZoom > 0 ? this.renderZoom : 1
    const paddingX = Math.max(
      120,
      this.pixelsPerMeter * GRASS_DYNAMIC_VIEW_PADDING_X_METERS
    )
    const paddingY = Math.max(
      90,
      this.pixelsPerMeter * GRASS_DYNAMIC_VIEW_PADDING_Y_METERS
    )
    const interactorCount = this.collectGrassInteractors()
    let inViewCount = 0
    let candidateCount = 0
    let interactionTestCount = 0
    let dynamicCount = 0
    let foliageCutBurstCount = 0
    const particleSystem = this.renderer.getParticleSystem()

    for (let i = 0; i < grassCount; i++) {
      const decoration = this.interactiveGrassDecorations[i]
      const renderX = decoration.getRenderX()
      const renderY = decoration.getRenderY()
      const screenX = (renderX - camX - centerX) * zoom + centerX
      const screenY = (renderY - camY - bottomY) * zoom + bottomY
      const dynamicInView =
        screenX >= -paddingX &&
        screenX <= width + paddingX &&
        screenY >= -paddingY &&
        screenY <= height + paddingY
      this.grassDynamicInViewFlags[i] = dynamicInView ? 1 : 0
      if (dynamicInView) {
        inViewCount++
      }
      decoration.beginFrame()
    }

    if (interactorCount > 0 && inViewCount > 0) {
      const cellSize = this.grassInteractionGridCellSizePx
      for (let actorIndex = 0; actorIndex < interactorCount; actorIndex++) {
        const layerGrid = this.interactiveGrassGrid.get(
          this.grassInteractorLayer[actorIndex]
        )
        if (!layerGrid) {
          continue
        }
        const cellX = this.getGrassGridCellCoord(
          this.grassInteractorX[actorIndex],
          cellSize
        )
        const cellY = this.getGrassGridCellCoord(
          this.grassInteractorY[actorIndex],
          cellSize
        )
        const bucket = layerGrid.get(this.getGrassGridCellKey(cellX, cellY))
        if (!bucket || bucket.length === 0) {
          continue
        }
        const queryId = this.nextGrassInteractionQueryId()
        for (let i = 0; i < bucket.length; i++) {
          const decoration = bucket[i]
          if (!decoration.tryMarkInteractorQuery(queryId)) {
            continue
          }
          const decorationIndex = decoration.getRuntimeIndex()
          if (
            decorationIndex < 0 ||
            this.grassDynamicInViewFlags[decorationIndex] === 0
          ) {
            continue
          }
          candidateCount++
          interactionTestCount++
          const playSound = decoration.interact(
            this.grassInteractorX[actorIndex],
            this.grassInteractorY[actorIndex],
            this.grassInteractorLayer[actorIndex],
            this.grassInteractorDeltaX[actorIndex],
            this.grassInteractorDeltaY[actorIndex]
          )
          if (playSound && hasPlayer) {
            const attenuation = this.getGrassSoundAttenuation(
              playerX,
              playerY,
              decoration.getWorldX(),
              decoration.getWorldY()
            )
            if (attenuation > 0) {
              this.audioManager.playSpatial(
                SOUND_IDS.PASS_THROUGH_GRASS,
                PASS_THROUGH_GRASS_VOLUME * attenuation,
                1,
                decoration.getAudioPan(playerX)
              )
            }
          }
          if (
            foliageCutBurstCount < FOLIAGE_CUT_MAX_BURSTS_PER_FRAME &&
            this.grassInteractorWeaponCutting[actorIndex] === 1 &&
            decoration.tryCutFoliage(
              this.grassInteractorX[actorIndex],
              this.grassInteractorY[actorIndex],
              this.grassInteractorLayer[actorIndex],
              this.grassInteractorWeaponX[actorIndex],
              this.grassInteractorWeaponY[actorIndex]
            )
          ) {
            if (
              ((Math.random() * FOLIAGE_CUT_DEBRIS_CHANCE_DENOMINATOR) | 0) ===
              0
            ) {
              particleSystem.spawnFoliageDebris(
                decoration.getDebrisWorldX() / this.pixelsPerMeter,
                decoration.getDebrisWorldY() / this.pixelsPerMeter,
                decoration.getDebrisColor(),
                decoration.getDebrisVariant(),
                decoration.getDebrisSizePx() / this.pixelsPerMeter
              )
              foliageCutBurstCount++
            }
          }
        }
      }
    }

    for (let i = 0; i < grassCount; i++) {
      if (
        this.interactiveGrassDecorations[i].finishFrame(
          deltaMs,
          this.grassDynamicInViewFlags[i] === 1
        )
      ) {
        dynamicCount++
      }
    }

    this.recordInteractiveGrassPerf(
      perfStartMs,
      grassCount,
      inViewCount,
      interactorCount,
      candidateCount,
      interactionTestCount,
      dynamicCount
    )
  }

  private collectGrassInteractors(): number {
    const buf = this.renderer.getStateBuffer()
    const entityCount = this.renderer.getEntityCount()
    let interactorCount = 0

    for (let i = 0; i < entityCount && interactorCount < MAX_ENTITIES; i++) {
      const offset = i * ENTITY_STRIDE
      const flags = buf[offset + OFFSETS.FLAGS] | 0
      if (!this.isGrassInteractorEntity(buf, offset)) {
        continue
      }
      const entityId = buf[offset + OFFSETS.ID] | 0
      const x = Math.round(buf[offset + OFFSETS.X] * this.pixelsPerMeter)
      const y = Math.round(buf[offset + OFFSETS.Y] * this.pixelsPerMeter)
      const previousX = this.grassInteractorPrevX.get(entityId)
      const previousY = this.grassInteractorPrevY.get(entityId)
      this.grassInteractorX[interactorCount] = x
      this.grassInteractorY[interactorCount] = y
      this.grassInteractorLayer[interactorCount] =
        buf[offset + OFFSETS.RENDER_LAYER] | 0
      this.grassInteractorDeltaX[interactorCount] =
        previousX === undefined ? 0 : x - previousX
      this.grassInteractorDeltaY[interactorCount] =
        previousY === undefined ? 0 : y - previousY
      if (this.isFoliageCuttingWeapon(buf, offset, flags)) {
        const weaponX = Math.round(
          buf[offset + OFFSETS.WEAPON_X] * this.pixelsPerMeter
        )
        const weaponY = Math.round(
          buf[offset + OFFSETS.WEAPON_Y] * this.pixelsPerMeter
        )
        this.grassInteractorWeaponX[interactorCount] = weaponX
        this.grassInteractorWeaponY[interactorCount] = weaponY
        this.grassInteractorWeaponCutting[interactorCount] = 1
      } else {
        this.grassInteractorWeaponX[interactorCount] = x
        this.grassInteractorWeaponY[interactorCount] = y
        this.grassInteractorWeaponCutting[interactorCount] = 0
      }
      this.grassInteractorPrevX.set(entityId, x)
      this.grassInteractorPrevY.set(entityId, y)
      interactorCount++
    }

    return interactorCount
  }

  private isGrassInteractorEntity(buf: Float32Array, offset: number): boolean {
    const flags = buf[offset + OFFSETS.FLAGS] | 0
    if ((flags & FLAGS.VISIBLE) === 0 || (flags & FLAGS.VANISHED) !== 0) {
      return false
    }
    if (
      (flags & FLAGS.EXP_ORB) !== 0 ||
      (flags & FLAGS.SUN_PICKUP_SMALL) !== 0 ||
      (flags & FLAGS.SUN_PICKUP_LARGE) !== 0 ||
      (flags & FLAGS.GRAPPLE_ANCHOR) !== 0 ||
      (flags & FLAGS.CHECKPOINT) !== 0 ||
      (flags & FLAGS.TERRAIN_DEBRIS) !== 0
    ) {
      return false
    }
    if (
      buf[offset + OFFSETS.WEAPON_ACTIVE] === 1 &&
      buf[offset + OFFSETS.STATS_HEALTH_MAX] <= 0
    ) {
      return false
    }
    return buf[offset + OFFSETS.RADIUS] > 0
  }

  private isFoliageCuttingWeapon(
    buf: Float32Array,
    offset: number,
    flags: number
  ): boolean {
    if (
      (flags & FLAGS.WEAPON_ATTACKING) === 0 ||
      buf[offset + OFFSETS.WEAPON_ACTIVE] !== 1
    ) {
      return false
    }
    const weaponType = buf[offset + OFFSETS.WEAPON_TYPE] | 0
    return (
      weaponType === WEAPON_TYPES.SWORD ||
      weaponType === WEAPON_TYPES.SHORT_SWORD ||
      weaponType === WEAPON_TYPES.LONG_SWORD ||
      weaponType === WEAPON_TYPES.SPEAR ||
      weaponType === WEAPON_TYPES.HAMMER ||
      weaponType === WEAPON_TYPES.BIG_HAMMER ||
      weaponType === WEAPON_TYPES.HOOK
    )
  }

  private getGrassSoundAttenuation(
    listenerX: number,
    listenerY: number,
    sourceX: number,
    sourceY: number
  ): number {
    const maxDistance =
      getSoundFalloffDistance(SOUND_IDS.PASS_THROUGH_GRASS) *
      this.pixelsPerMeter
    return computeDistanceAttenuation(
      listenerX,
      listenerY,
      sourceX,
      sourceY,
      maxDistance
    )
  }

  destroy(): void {
    if (this.destroyed) {
      return
    }
    this.destroyed = true

    this.stop()
    this.worker.terminate()
    this.destroyInteractiveGrassDecorations()
    this.worldRenderer.destroy()
    this.lightingController.destroy()

    this.clearEnvironmentTextureCaches()

    this.app.destroy(
      { removeView: true },
      {
        children: true,
        texture: true,
        textureSource: true,
        context: true,
      }
    )
  }

  private captureSaveThumbnail(): Promise<string | null> {
    const w = this.app.renderer.width
    const h = this.app.renderer.height
    const thumbCanvas = document.createElement('canvas')
    thumbCanvas.width = w
    thumbCanvas.height = h
    const thumbCtx = thumbCanvas.getContext('2d')
    if (!thumbCtx) return Promise.resolve(null)
    thumbCtx.fillStyle = '#0d0b18'
    thumbCtx.fillRect(0, 0, w, h)
    thumbCtx.drawImage(this.appCanvas, 0, 0)
    const dataUrl = thumbCanvas.toDataURL('image/jpeg', 0.8)
    return this.resizeThumbnail(dataUrl, 200, 160)
  }

  captureCurrentThumbnail(): Promise<string | null> {
    return this.captureSaveThumbnail()
  }

  waitForPreviewThumbnailReady(): Promise<void> {
    if (!this.previewActive) {
      return Promise.resolve()
    }

    const targetStateRevision = this.previewAwaitStateRevision
    return new Promise((resolve) => {
      const poll = () => {
        if (!this.previewActive) {
          resolve()
          return
        }
        if (this.workerStateRevision < targetStateRevision) {
          requestAnimationFrame(poll)
          return
        }
        if (this.previewFirstRenderRevision === 0) {
          requestAnimationFrame(poll)
          return
        }

        const settledFrames =
          this.renderFrameRevision - this.previewFirstRenderRevision
        const terrainReady =
          this.staticTerrainReady || this.pendingStaticTerrainSignature === 0
        const environmentReady =
          this.staticEnvironmentReady ||
          this.pendingStaticEnvironmentSignature === 0
        if (
          settledFrames >= GameClient.PREVIEW_CAPTURE_MAX_RENDER_FRAMES ||
          (terrainReady &&
            environmentReady &&
            settledFrames >= GameClient.PREVIEW_CAPTURE_MIN_RENDER_FRAMES &&
            this.previewCameraStableFrames >=
              GameClient.PREVIEW_CAPTURE_STABLE_FRAMES)
        ) {
          resolve()
          return
        }

        requestAnimationFrame(poll)
      }

      requestAnimationFrame(poll)
    })
  }

  private resizeThumbnail(
    dataUrl: string,
    width: number,
    height: number
  ): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(dataUrl)
          return
        }

        const srcRatio = img.width / img.height
        const dstRatio = width / height

        let drawW = width
        let drawH = height
        let offsetX = 0
        let offsetY = 0

        if (srcRatio > dstRatio) {
          drawH = height
          drawW = height * srcRatio
          offsetX = (width - drawW) / 2
        } else {
          drawW = width
          drawH = width / srcRatio
          offsetY = (height - drawH) / 2
        }

        ctx.drawImage(img, offsetX, offsetY, drawW, drawH)
        resolve(canvas.toDataURL('image/jpeg', 0.8))
      }
      img.onerror = () => resolve(dataUrl)
      img.src = dataUrl
    })
  }

  getCurrentSaveId(): string | null {
    return this.currentSaveId
  }

  setOnEditorAction(callback: () => void): void {
    this.onEditorActionCallback = callback
  }

  setOnExitAction(callback: () => Promise<boolean>): void {
    this.onExitActionCallback = callback
  }
}
