import * as fabric from 'fabric'

import { DialogManager } from './DialogManager'
import type { GameClient } from './GameClient'
import { localizer } from './Localizer'
import {
  CHARACTER_DEFAULT_DATA,
  DEFAULT_PLAYER_RADIUS,
  WEAPON_DEFAULT_DATA,
} from './constants'
import { Faction } from './ecs/Component'
import { computeWeaponScaleFactor } from './ecs/factories/PlayerFactory'
import { EditorCameraManager } from './editor/EditorCameraManager'
import { EditorCanvasEventHandler } from './editor/EditorCanvasEventHandler'
import { EditorClipboardManager } from './editor/EditorClipboardManager'
import {
  CAMERA_FRAME_FILL,
  CAMERA_FRAME_FILL_UNFOCUSED,
  CAMERA_FRAME_OPTIONS,
  CAMERA_FRAME_STROKE,
  CAMERA_ICON_FILL,
  CAMERA_ICON_STROKE,
  DEBUG_EDITOR_MENU,
  DEFAULT_NPC_TYPE,
  EDITOR_HISTORY_MAX_ENTRIES,
  EDITOR_NUDGE_STEP_PX,
  EDITOR_PIXELS_PER_METER,
  EDITOR_VIEW_MAX_ZOOM_SCALED,
  EDITOR_VIEW_MIN_ZOOM_SCALED,
  EDITOR_VIEW_ZOOM_SCALE,
  NPC_EYE_COLOR,
  PLAYER_BODY_COLOR,
  PLAYER_EYE_COLOR,
  acquirePoint,
  releasePoint,
} from './editor/EditorConstants'
import type { ContextMenuAction } from './editor/EditorContextMenu'
import { EditorContextMenu } from './editor/EditorContextMenu'
import { computeCameraOffsetFromCenter } from './editor/EditorCoordinateUtils'
import {
  EditorEnvironmentPalette,
  type EditorEnvironmentPaletteSelection,
} from './editor/EditorEnvironmentPalette'
import { EditorHistoryManager } from './editor/EditorHistoryManager'
import { EditorMapListManager } from './editor/EditorMapListManager'
import { EditorMapSerializer } from './editor/EditorMapSerializer'
import { EditorMarkerManager } from './editor/EditorMarkerManager'
import {
  EditorMenuSystem,
  type EditorObjectMenuType,
} from './editor/EditorMenuSystem'
import { EditorObjectFactory } from './editor/EditorObjectFactory'
import { EditorObjectManager } from './editor/EditorObjectManager'
import { EditorObjectTreeManager } from './editor/EditorObjectTreeManager'
import { EditorPatternManager } from './editor/EditorPatternManager'
import {
  type EditablePolygon,
  EditorPolygonEditor,
} from './editor/EditorPolygonEditor'
import { EditorPropertiesPanel } from './editor/EditorPropertiesPanel'
import {
  computeNpcBodyRadiusPx,
  computeWeaponRenderDimensions,
  renderNpcPreviewToContext,
} from './editor/EditorRenderUtils'
import { EditorShapeManager } from './editor/EditorShapeManager'
import { EditorSidebarManager } from './editor/EditorSidebarManager'
import { EditorSnapManager } from './editor/EditorSnapManager'
import { EditorThumbnailCapture } from './editor/EditorThumbnailCapture'
import { EditorToolbarManager } from './editor/EditorToolbarManager'
import { TooltipManager } from './editor/TooltipManager'
import { EditorTerrainBrushController } from './editor/terrain/EditorTerrainBrushController'
import { EditorTerrainLayerManager } from './editor/terrain/EditorTerrainLayerManager'
import {
  type CameraFrame,
  type CameraViewData,
  type EditorEmptyObject,
  type EditorLayeredObject,
  type EditorMap,
  type EditorObjectData,
  type GroundShapeType,
  type NpcMarker,
  type NpcMarkerData,
  ObjectType,
  type PlayerMarker,
  type ShapeResetData,
  type TerrainContourProxy,
  type TerrainRegionProxy,
  type WeaponMarker,
  type WeaponMarkerData,
  type WeaponShape,
} from './editor/types'
import type {
  EditorMapData,
  EditorMapMeta,
  EditorViewportState,
  MapEnvironmentAsset,
  MapEnvironmentFlowerOptions,
  MapEnvironmentObject,
  MapEnvironmentObjectType,
  MapNpcTemplate,
  MapNpcWeapon,
  MapSettings,
  MapWeapon,
  WeaponCategory,
} from './editorMapTypes'
import { DEFAULT_MAP_TIME_PHASE } from './editorMapTypes'
import {
  createEnvironmentAssetFromImageFile,
  deleteEnvironmentAsset,
  ensureRuntimeEnvironmentAsset,
  updateEnvironmentAsset,
} from './environmentAssetRegistry'
import {
  RENDER_LAYER_SKY,
  formatRenderLayerLabel,
  getDefaultShapeRenderLayer,
  normalizeRenderLayer,
} from './renderLayers'
import { renderBody } from './renderer/BodyRenderer'
import {
  DayNightCycle,
  getMapTimePhaseElapsedMs,
} from './renderer/DayNightCycle'
import { renderWeapon } from './renderer/WeaponRenderer'
import {
  createEditorMap,
  listEditorEnvironmentAssets,
  listEditorMaps,
  loadEditorMapData,
  loadEditorSetting,
  saveEditorMap,
  saveEditorMapMeta,
  saveEditorMapViewState,
  saveEditorSetting,
} from './storage'
import type { TerrainBrushId, TerrainMaterialId } from './terrain/TerrainTypes'
import type {
  AttackPickupKind,
  NpcPatrolMode,
  NpcType,
  WeaponType,
} from './types'

type WeaponTemplate = (typeof WEAPON_DEFAULT_DATA)[WeaponType]

interface EditorTreeHistoryEntry {
  order: number[]
  parentIds: number[]
  id: number
}

const EDITOR_TREE_COLLAPSED_PATHS_PREFIX = 'editor-tree-collapsed:'
const EDITOR_ENVIRONMENT_ASSET_MAX_FILE_BYTES = 1024 * 1024

export enum EditorView {
  MapList,
  Editor,
}

export class EditorManager {
  private editorOverlay: HTMLDivElement
  private editorWorkspace: HTMLDivElement
  private editorCanvas: HTMLCanvasElement
  private gameCanvas: HTMLCanvasElement
  private toolbarManager: EditorToolbarManager
  private sidebarManager: EditorSidebarManager
  private dialogManager: DialogManager
  private mapSerializer: EditorMapSerializer
  private propertiesPanel: EditorPropertiesPanel
  private mapListManager: EditorMapListManager
  private objectTreeManager: EditorObjectTreeManager
  private environmentPalette!: EditorEnvironmentPalette
  private tooltipManager!: TooltipManager
  private menuSystem!: EditorMenuSystem
  private contextMenu!: EditorContextMenu
  private shapeManager: EditorShapeManager
  private markerManager: EditorMarkerManager
  private thumbnailCapture: EditorThumbnailCapture
  private canvasEventHandler: EditorCanvasEventHandler
  private historyManager: EditorHistoryManager
  private clipboardManager: EditorClipboardManager

  private factions: string[] = [Faction.Player, Faction.Enemy]
  private visible = false
  private currentView: EditorView = EditorView.MapList
  private maps: EditorMap[] = []
  private currentMapMeta: EditorMapMeta | null = null
  private customEnvironmentAssets: MapEnvironmentAsset[] = []
  private customEnvironmentAssetsLoaded = false
  private mapSettings: MapSettings = {
    initialTimePhase: DEFAULT_MAP_TIME_PHASE,
  }
  private gameClient: GameClient | null = null
  private onBackToMenuCallback?: () => void
  private onPreviewCallback?: (meta: EditorMapMeta, data: EditorMapData) => void
  private onDefaultMapChangedCallback?: (meta: EditorMapMeta) => void
  private lastSavedHistoryId = 0
  private treeUndoStack: EditorTreeHistoryEntry[] = []
  private treeRedoStack: EditorTreeHistoryEntry[] = []
  private treeEntryPool: EditorTreeHistoryEntry[] = []
  private treeNextEntryId = 1
  private lastHistoryWasTree = false
  private fabricCanvas: fabric.Canvas | null = null
  private activeObjectType: ObjectType | null = null
  private environmentStampSelection: EditorEnvironmentPaletteSelection | null =
    null
  private readonly environmentStampSpawnScratch: MapEnvironmentObject = {
    type: 'tree',
    x: 0,
    y: 0,
    seed: 1,
    assetId: '',
  }
  private readonly environmentStampFlowerOptionsScratch: MapEnvironmentFlowerOptions =
    {}
  private environmentStampCanvasModeApplied = false
  private environmentStampPreviousSelection = true
  private environmentStampPreviousSkipTargetFind = false
  private temporarySelectActive = false
  private temporarySelectSavedObjectType: ObjectType | null = null
  private temporarySelectSavedTerrainBrushId: TerrainBrushId | null = null
  private temporarySelectSavedEnvironmentStamp: EditorEnvironmentPaletteSelection | null =
    null
  private temporarySelectSavedEnvironmentPaletteVisible = false
  private handleResize: () => void
  private panelCollapsed = false
  private readonly editorDayNightCycle = new DayNightCycle()
  private isPanning = false
  private lastClientX = 0
  private lastClientY = 0
  private objectTreeAnchorId = -1
  private suppressCanvasSelectionSync = false
  private dragSelectionIds: number[] = []
  private panelMenuSpawnX = 0
  private panelMenuSpawnY = 0
  private panelMenuSpawnValid = false
  private panelMenuSpawnScratch = { x: 0, y: 0 }
  private pendingTerrainContourFillTarget: TerrainContourProxy | null = null
  private polygonEditor: EditorPolygonEditor
  private objectFactory: EditorObjectFactory
  private objectManager: EditorObjectManager
  private focusOptions: FocusOptions = { preventScroll: true }
  // Markers are now managed by EditorMarkerManager
  // private playerMarker: PlayerMarker | null = null
  // private npcMarkers: NpcMarkerData[] = []
  // private weaponMarkers: WeaponMarkerData[] = []
  // private npcMarkerMap = new Map<fabric.Object, NpcMarkerData>()
  // private weaponMarkerMap = new Map<fabric.Object, WeaponMarkerData>()
  private readonly invPixelsPerMeter = 1 / EDITOR_PIXELS_PER_METER
  private snapManager!: EditorSnapManager
  private patternManager!: EditorPatternManager
  private cameraManager!: EditorCameraManager
  private terrainManager!: EditorTerrainLayerManager
  private terrainBrushController!: EditorTerrainBrushController
  private customNpcTemplates: MapNpcTemplate[] = []
  private objectTreeCollapsedPaths: string[] = []
  private sceneDepthFilter: number | 'all' = 'all'
  private editorDepthFilterEl: HTMLSelectElement | null = null

  constructor() {
    const overlay = document.getElementById('editorOverlay')
    const workspace = document.getElementById('editorWorkspace')
    const editorCanvas = document.getElementById('editorCanvas')
    const gameCanvas = document.getElementById('gameCanvas')
    const environmentPalette = document.getElementById(
      'editorEnvironmentPalette'
    )

    if (
      !(overlay instanceof HTMLDivElement) ||
      !(workspace instanceof HTMLDivElement) ||
      !(editorCanvas instanceof HTMLCanvasElement) ||
      !(gameCanvas instanceof HTMLCanvasElement) ||
      !(environmentPalette instanceof HTMLDivElement)
    ) {
      throw new Error('Editor elements are missing.')
    }

    this.editorOverlay = overlay
    this.editorWorkspace = workspace
    this.editorCanvas = editorCanvas
    this.gameCanvas = gameCanvas
    if (this.editorOverlay.tabIndex < 0) {
      this.editorOverlay.tabIndex = 0
    }

    this.toolbarManager = new EditorToolbarManager({
      onBack: () => this.handleBack(),
      onPreview: () => this.handlePreview(),
      onSave: () => this.handleSave(),
    })

    this.sidebarManager = new EditorSidebarManager({
      getCurrentView: () => this.currentView,
      onCollapseChange: (collapsed) => {
        this.panelCollapsed = collapsed
        if (collapsed) {
          this.menuSystem.hideAll()
        }
      },
      onSelectMode: () => this.enterSelectionMode(),
    })

    this.dialogManager = new DialogManager(
      this.editorOverlay,
      this.editorOverlay
    )
    this.polygonEditor = new EditorPolygonEditor({
      getCanvas: () => this.fabricCanvas,
      isPanning: () => this.isPanning,
      acquirePoint,
      releasePoint,
    })
    this.objectFactory = new EditorObjectFactory({
      pixelsPerMeter: EDITOR_PIXELS_PER_METER,
      defaultPlayerRadius: DEFAULT_PLAYER_RADIUS,
      playerBodyColor: PLAYER_BODY_COLOR,
      playerEyeColor: PLAYER_EYE_COLOR,
      npcEyeColor: NPC_EYE_COLOR,
      computeNpcBodyRadiusPx,
      computeWeaponRenderDimensions: (template, sizeLevel, ppm, isBow) =>
        computeWeaponRenderDimensions(
          template as WeaponTemplate,
          sizeLevel,
          ppm,
          isBow
        ),
      renderWeapon,
    })

    this.objectManager = new EditorObjectManager({
      fabricCanvas: () => this.fabricCanvas,
      onObjectRemoved: (obj) => {
        if (this.cameraManager.isCameraFrame(obj)) {
          this.cameraManager.removeCameraView(obj)
        }
        if (this.markerManager.isPlayerMarker(obj)) {
          this.markerManager.removePlayerMarker(obj)
        }
        if (this.markerManager.isNpcMarker(obj)) {
          this.markerManager.removeNpcMarker(obj)
        }
        if (this.markerManager.isWeaponMarker(obj)) {
          this.markerManager.removeWeaponMarker(obj)
        }
        if (this.markerManager.isSunPickupMarker(obj)) {
          this.markerManager.removeSunPickupMarker(obj)
        }
        if (this.markerManager.isExpOrbMarker(obj)) {
          this.markerManager.removeExpOrbMarker(obj)
        }
        if (this.markerManager.isAttackPickupMarker(obj)) {
          this.markerManager.removeAttackPickupMarker(obj)
        }
        if (this.markerManager.isHookAnchorMarker(obj)) {
          this.markerManager.removeHookAnchorMarker(obj)
        }
        if (this.markerManager.isEnvironmentMarker(obj)) {
          this.markerManager.removeEnvironmentMarker(obj)
        }
        this.patternManager.deletePattern(obj)
      },
      onSelectionChanged: (obj) => {
        this.cameraManager.refreshCameraFocus(obj)
        this.terrainManager.handleSelectionChanged(obj)
        this.updateActiveSelectionLockVisual()
      },
      onBringToFront: (obj) => {
        if (this.cameraManager.isCameraFrame(obj)) {
          const data = this.cameraManager.getCameraViewMap().get(obj)
          if (data) {
            this.cameraManager.syncCameraIcon(data)
            data.icon.canvas?.bringObjectToFront(data.icon)
          }
        }
      },
      isPriorityBringToFrontObject: (obj) =>
        this.terrainManager.isTerrainContourProxy(obj),
      renderObjectTree: () => this.renderObjectTree(),
      getObjectRenderLayer: (obj) => this.getEditorObjectRenderLayer(obj),
      getSupplementalStackingObjects: () =>
        this.terrainManager.getTerrainRenderObjects(),
    })

    this.markerManager = new EditorMarkerManager(
      {
        getCanvas: () => this.fabricCanvas,

        getViewportCenter: () => this.getViewportCenter(),

        registerEditorObject: (type, obj, preferredName) =>
          this.registerEditorObjectWithDepth(type, obj, preferredName),

        handleCanvasSelection: (obj) =>
          this.objectManager.handleCanvasSelection(obj ? [obj] : []),

        computeNpcBodyRadiusPx,

        computeWeaponRenderDimensions: (template, sizeLevel, ppm, isBow) =>
          computeWeaponRenderDimensions(
            template as WeaponTemplate,

            sizeLevel,

            ppm,

            isBow
          ),

        requestRender: () => this.fabricCanvas?.requestRenderAll(),
      },

      this.objectFactory
    )

    this.patternManager = new EditorPatternManager({
      fabricCanvas: () => this.fabricCanvas,
    })

    this.terrainManager = new EditorTerrainLayerManager({
      getFabricCanvas: () => this.fabricCanvas,
      requestRender: () => this.fabricCanvas?.requestRenderAll(),
      pixelsPerMeter: EDITOR_PIXELS_PER_METER,
      onTerrainRenderObjectsChanged: () => {
        this.applyAllEditorObjectCanvasVisibility()
        this.reorderCanvasObjects()
      },
      registerEditorObject: (type, obj, preferredName) =>
        this.registerEditorObjectWithDepth(type, obj, preferredName),
      unregisterEditorObject: (obj) =>
        this.objectManager.unregisterEditorObject(obj),
    })

    this.terrainBrushController = new EditorTerrainBrushController({
      getCanvas: () => this.fabricCanvas,
      terrainManager: this.terrainManager,
      isObjectLocked: (object) => this.objectManager.isObjectLocked(object),
      onCommit: () => this.captureHistorySnapshot(),
    })

    this.shapeManager = new EditorShapeManager({
      polygonEditor: this.polygonEditor,

      isEditablePolygon: (obj) => this.isEditablePolygon(obj),

      getCanvas: () => this.fabricCanvas,

      getViewportCenter: () => this.getViewportCenter(),

      applyGroundPatternToObject: (obj) =>
        this.patternManager.applyGroundPatternToObject(obj),

      applyObstaclePatternToObject: (obj) =>
        this.patternManager.applyObstaclePatternToObject(obj),

      registerEditorObject: (type, obj) =>
        this.registerEditorObjectWithDepth(type, obj),

      handleCanvasSelection: (obj) =>
        this.objectManager.handleCanvasSelection(obj ? [obj] : []),
    })

    this.cameraManager = new EditorCameraManager({
      fabricCanvas: () => this.fabricCanvas,

      editorCanvas: this.editorCanvas,

      getViewportCenter: () => this.getViewportCenter(),

      registerEditorObject: (type, obj) =>
        this.registerEditorObjectWithDepth(type, obj),

      handleCanvasSelection: (obj) =>
        this.objectManager.handleCanvasSelection(obj ? [obj] : []),

      ensureFabricCanvas: () => this.ensureFabricCanvas(),
    })

    this.mapSerializer = new EditorMapSerializer({
      getCanvas: () => this.editorCanvas,
      getInvPixelsPerMeter: () => this.invPixelsPerMeter,
      getPixelsPerMeter: () => EDITOR_PIXELS_PER_METER,
      getFabricCanvas: () => this.fabricCanvas,
      ensureFabricCanvas: () => this.ensureFabricCanvas(),
      resizeEditorCanvas: () => this.resizeEditorCanvas(),
      clearEditorScene: () => this.clearEditorScene(),

      markerManager: this.markerManager,
      terrainManager: this.terrainManager,

      spawnCameraViewFrame: (camera, options) =>
        this.cameraManager.spawnCameraViewFrame(
          camera,
          ObjectType.Camera,
          options
        ),
      beginObjectBatchMutation: () => this.objectManager.beginBatchMutation(),
      endObjectBatchMutation: () => this.objectManager.endBatchMutation(),
      renderObjectTree: () => this.renderObjectTree(),
      requestRenderAll: () => {
        this.fabricCanvas?.requestRenderAll()
      },
      setObjectRenderLayer: (object, renderLayer) => {
        this.setEditorObjectRenderLayer(object, renderLayer)
      },
      getCameraViews: () => this.cameraManager.getCameraViews(),
      getPlayerMarkerData: () => this.markerManager.getPlayerMarkerData(),
      getEditorObjects: () => this.objectManager.getEditorObjects(),
      getMapSettings: () => ({ ...this.mapSettings }),
      setMapSettings: (settings) => {
        this.setMapSettings(settings, false)
      },
      getFactions: () => this.factions,
      setFactions: (factions) => {
        this.factions = factions
      },
      getCustomNpcTemplates: () => this.customNpcTemplates,
      setCustomNpcTemplates: (templates) => {
        this.setCustomNpcTemplates(templates)
      },
    })

    this.historyManager = new EditorHistoryManager(
      {
        serializeCurrentMapData: () =>
          this.mapSerializer.serializeCurrentMapData(),
        applyMapData: (data) => this.applyMapSnapshot(data),
      },
      EDITOR_HISTORY_MAX_ENTRIES
    )

    this.clipboardManager = new EditorClipboardManager({
      getCanvas: () => this.fabricCanvas,
      getInvPixelsPerMeter: () => this.invPixelsPerMeter,
      editorCanvas: this.editorCanvas,
      markerManager: this.markerManager,
      shapeManager: this.shapeManager,
      terrainManager: this.terrainManager,
      cameraManager: this.cameraManager,
      patternManager: this.patternManager,
      objectManager: this.objectManager,
      polygonEditor: this.polygonEditor,
      handleCanvasSelection: (obj) =>
        this.objectManager.handleCanvasSelection(obj ? [obj] : []),
      isEditablePolygon: (obj) => this.isEditablePolygon(obj),
      hasObjectOfType: (type) => this.hasObjectOfType(type),
      createEmptyObject: (left, top, isGroupContainer) =>
        this.createEmptyNode(left, top, isGroupContainer),
    })

    this.propertiesPanel = new EditorPropertiesPanel({
      dialogManager: this.dialogManager,
      getFabricCanvas: () => this.fabricCanvas,
      weaponMarkerMap: this.markerManager.getWeaponMarkerMap(),
      npcMarkerMap: this.markerManager.getNpcMarkerMap(),
      playerMarkerData: () => this.markerManager.getPlayerMarkerData(),
      editorObjectMap: this.objectManager.getEditorObjectMap(),
      objectFactory: this.objectFactory,
      requestRender: () => this.fabricCanvas?.requestRenderAll(),
      refreshMapThumbnail: () => {
        void this.refreshCurrentMapThumbnail()
      },
      getMapSnapshot: () => this.getMapSnapshot(),
      applyMapSnapshot: (data) => this.applyMapSnapshot(data),
      onHistoryCapture: () => this.captureHistorySnapshot(),
      getOrCreateNpcWeaponMarker: (d, w, s) =>
        this.markerManager.getOrCreateNpcWeaponMarker(d, w, s),
      getOrCreatePlayerWeaponMarker: (d, w, s) =>
        this.markerManager.getOrCreatePlayerWeaponMarker(d, w, s),
      updateNpcMarkerVisual: (m, r, bh, c, f) =>
        this.markerManager.updateNpcMarkerVisual(m, r, bh, c, f),
      updatePlayerMarkerVisual: (m, r, bh, c, f) =>
        this.markerManager.updatePlayerMarkerVisual(m, r, bh, c, f),
      updateWeaponMarkerVisual: (m, s) =>
        this.markerManager.updateWeaponMarkerVisual(m, s),
      getAvailableRenderLayers: () => this.getAvailableRenderLayers(),
      getCommonRenderLayer: (target) => this.getEditorObjectRenderLayer(target),
      setCommonRenderLayer: (target, renderLayer) =>
        this.setEditorObjectRenderLayer(target, renderLayer),
      getTerrainStraightEdge: (target) =>
        this.terrainManager.getProxyStraightEdge(target),
      setTerrainStraightEdge: (target, straightEdge) =>
        this.terrainManager.setProxyStraightEdge(target, straightEdge),
      getTerrainCellStroke: (target) =>
        this.terrainManager.getProxyCellStroke(target),
      setTerrainCellStroke: (target, cellStroke) =>
        this.terrainManager.setProxyCellStroke(target, cellStroke),
      getTerrainEdgeProtection: (target) =>
        this.terrainManager.getProxyEdgeProtection(target),
      setTerrainEdgeProtection: (target, edgeProtection) =>
        this.terrainManager.setProxyEdgeProtection(target, edgeProtection),
      getProceduralCellStroke: (target) =>
        this.markerManager.getProceduralCellStroke(target),
      setProceduralCellStroke: (target, cellStroke) =>
        this.markerManager.setProceduralCellStroke(target, cellStroke),
      getEnvironmentKeyText: (target) =>
        this.markerManager.getEnvironmentKeyText(target),
      getEnvironmentKeyVariants: (target) =>
        this.markerManager.getEnvironmentKeyVariants(target),
      setEnvironmentKeyProperties: (target, keyText, keyVariants) =>
        this.markerManager.setEnvironmentKeyProperties(
          target,
          keyText,
          keyVariants
        ),
      getFactions: () => this.factions,
      addFaction: (id) => {
        if (!this.factions.includes(id)) {
          this.factions = [...this.factions, id]
        }
      },
    })

    this.mapListManager = new EditorMapListManager({
      dialogManager: this.dialogManager,
      mapSerializer: this.mapSerializer,
      getBackBtn: () => this.toolbarManager.getBackBtn(),
      onMapLoaded: (meta, data) => {
        this.currentMapMeta = meta
        this.historyManager.reset(data)
        this.lastSavedHistoryId = this.historyManager.getCurrentEntryId()
        this.resetTreeHistory()
        this.objectTreeCollapsedPaths.length = 0
        this.objectTreeManager.setCollapsedPaths(this.objectTreeCollapsedPaths)
        this.renderObjectTree()
        void this.restoreObjectTreeCollapsedPaths(meta.id)
      },
      applyEditorViewportState: (state) => this.applyEditorViewportState(state),
      applyEditorTreeData: (data) => this.applyEditorTreeData(data),
      onShowEditorView: () => this.showEditorView(),
      onBackToMenu: () => this.handleBack(),
      onDefaultMapChanged: (meta) => {
        if (this.onDefaultMapChangedCallback) {
          this.onDefaultMapChangedCallback(meta)
        }
      },
      onPreview: (meta, data) => {
        if (this.onPreviewCallback) {
          this.onPreviewCallback(meta, data)
        }
      },
    })

    this.objectTreeManager = new EditorObjectTreeManager({
      editorObjects: this.objectManager.getEditorObjects(),
      renamingEditorObjectId: this.objectManager.getRenamingEditorObjectId(),
      selectedEditorObjectId: this.objectManager.getSelectedEditorObjectId(),
      selectedEditorObjectIds: this.objectManager.getSelectedEditorObjectIds(),
      dragObjectId: this.objectManager.getDragId(),
      onRenameCommit: (id, value) => {
        const changed = this.objectManager.commitObjectRename(id, value)
        if (changed) {
          this.captureHistorySnapshot()
        }
      },
      onRenameCancel: () => this.objectManager.cancelObjectRename(),
      onDragStart: (id) => {
        this.dragSelectionIds = this.getDragSelectionIds(id)
        this.objectManager.setDragId(id)
        this.updateObjectTreeContext()
      },
      onDropReorder: (dragId, targetId, insertAfter) => {
        const dragIds = this.getDragSelectionIds(dragId)
        const changed = this.objectManager.moveObjects(
          dragIds,
          targetId,
          insertAfter ? 'after' : 'before'
        )
        this.resetDragState()
        if (changed) {
          this.captureTreeHistory()
        }
      },
      onDropToParent: (dragId, parentId) => {
        const dragIds = this.getDragSelectionIds(dragId)
        const changed = this.objectManager.moveObjects(
          dragIds,
          parentId,
          'inside'
        )
        this.resetDragState()
        if (changed) {
          this.captureTreeHistory()
        }
      },
      onDropToRoot: (dragId) => {
        const dragIds = this.getDragSelectionIds(dragId)
        const changed = this.objectManager.moveObjects(dragIds, null, 'after')
        this.resetDragState()
        if (changed) {
          this.captureTreeHistory()
        }
      },
      onDragEnd: () => {
        this.resetDragState()
      },
      onObjectSelected: (id, mode) => this.handleObjectTreeSelection(id, mode),
      onObjectVisibilityToggled: (id) =>
        this.handleObjectTreeVisibilityToggle(id),
      onBlankAreaSelected: () => this.clearEditorSelection(),
      onObjectContextMenu: (id, clientX, clientY) =>
        this.handleObjectTreeContextMenu(id, clientX, clientY),
      onCollapsedPathsChanged: (paths) =>
        this.handleObjectTreeCollapsedPathsChanged(paths),
    })

    // PatternManager initialized earlier

    // CameraManager initialized earlier

    this.snapManager = new EditorSnapManager({
      fabricCanvas: () => this.fabricCanvas,
      editorObjects: () => this.objectManager.getEditorObjects(),
      editorObjectMap: this.objectManager.getEditorObjectMap(),
      updateGroundPatternTransform: (obj) =>
        this.patternManager.updateGroundPatternTransform(obj),
      updateObstaclePatternTransform: (obj) =>
        this.patternManager.updateObstaclePatternTransform(obj),
      syncCameraIcon: (obj) => {
        const data = this.cameraManager.getCameraViewMap().get(obj)
        if (data) {
          this.cameraManager.syncCameraIcon(data)
        }
      },
      isCameraFrame: (obj) => this.cameraManager.isCameraFrame(obj),
      cameraViewMap: this.cameraManager.getCameraViewMap(),
    })

    this.menuSystem = new EditorMenuSystem({
      editorWorkspace: this.editorWorkspace,
      hasObjectOfType: (type) => this.hasObjectOfType(type),
      hasWeaponType: (weaponType) =>
        this.markerManager.hasWeaponType(weaponType),
      onObjectTypeSelected: (type) => this.handleObjectClick(type),
      onTerrainBrushSelected: (brushId) => {
        this.terrainBrushController.selectBrush(brushId)
        this.setActiveObjectType(ObjectType.Terrain)
      },
      onTerrainFillSelected: (materialId) => {
        this.handleTerrainContourFillSelected(materialId)
      },
      onTerrainContourDrawSelected: () => {
        this.terrainBrushController.selectBrush('contour')
        this.setActiveObjectType(ObjectType.Terrain)
      },
      onTerrainContourShapeSelected: (shape) => {
        const spawn = this.consumePanelMenuSpawn()
        const center = spawn ?? this.getViewportCenter()
        const contourProxy = this.terrainManager.createShapeContour(
          shape,
          center.x,
          center.y
        )
        if (!contourProxy) {
          return
        }
        this.fabricCanvas?.setActiveObject(contourProxy)
        this.objectManager.handleCanvasSelection([contourProxy])
        this.fabricCanvas?.requestRenderAll()
        this.captureHistorySnapshot()
      },
      onWeaponSelected: (weaponType, category, size) => {
        const spawn = this.consumePanelMenuSpawn()
        if (spawn) {
          this.markerManager.spawnWeaponMarker(weaponType, category, {
            x: spawn.x * this.invPixelsPerMeter,
            y: spawn.y * this.invPixelsPerMeter,
            sizeLevel: size,
          })
        } else {
          this.markerManager.spawnWeaponMarker(weaponType, category, {
            sizeLevel: size,
          })
        }
        this.captureHistorySnapshot()
      },
      onNpcSelected: (npcType) => {
        const spawn = this.consumePanelMenuSpawn()
        if (spawn) {
          this.markerManager.spawnNpcMarker(npcType, {
            x: spawn.x * this.invPixelsPerMeter,
            y: spawn.y * this.invPixelsPerMeter,
          })
        } else {
          this.markerManager.spawnNpcMarker(npcType)
        }
        this.captureHistorySnapshot()
      },
      getCustomNpcTemplates: () => this.customNpcTemplates,
      onCustomNpcTemplateSelected: (templateId) => {
        this.handleCustomNpcTemplateSelected(templateId)
      },
      onEditCustomNpcTemplate: async (templateId) => {
        await this.handleEditCustomNpcTemplate(templateId)
      },
      onCreateCustomNpcTemplate: async () => {
        await this.handleCreateCustomNpcTemplate()
      },
      getCustomEnvironmentAssets: () => this.customEnvironmentAssets,
      onCustomEnvironmentAssetSelected: async (assetId) => {
        await this.handleCustomEnvironmentAssetSelected(assetId)
      },
      onCreateCustomEnvironmentAsset: async () => {
        await this.handleCreateCustomEnvironmentAsset()
      },
      onSunPickupSelected: (isLarge) => {
        const spawn = this.consumePanelMenuSpawn()
        if (spawn) {
          this.markerManager.spawnSunPickupMarker(isLarge, {
            x: spawn.x * this.invPixelsPerMeter,
            y: spawn.y * this.invPixelsPerMeter,
          })
        } else {
          this.markerManager.spawnSunPickupMarker(isLarge)
        }
        this.captureHistorySnapshot()
      },
      onExpOrbSelected: () => {
        const spawn = this.consumePanelMenuSpawn()
        if (spawn) {
          this.markerManager.spawnExpOrbMarker({
            x: spawn.x * this.invPixelsPerMeter,
            y: spawn.y * this.invPixelsPerMeter,
          })
        } else {
          this.markerManager.spawnExpOrbMarker()
        }
        this.captureHistorySnapshot()
      },
      onAttackPickupSelected: (
        weaponType: WeaponType,
        kind: AttackPickupKind
      ) => {
        const spawn = this.consumePanelMenuSpawn()
        if (spawn) {
          this.markerManager.spawnAttackPickupMarker(weaponType, kind, {
            x: spawn.x * this.invPixelsPerMeter,
            y: spawn.y * this.invPixelsPerMeter,
          })
        } else {
          this.markerManager.spawnAttackPickupMarker(weaponType, kind)
        }
        this.captureHistorySnapshot()
      },
      onEnvironmentObjectSelected: (envType) => {
        this.hideAllSubmenus()
        this.menuSystem.hideObjectTypeMenu()
        const spawn = this.consumePanelMenuSpawn()
        if (spawn) {
          this.markerManager.spawnEnvironmentMarker(envType, {
            type: envType,
            x: spawn.x * this.invPixelsPerMeter,
            y: spawn.y * this.invPixelsPerMeter,
            seed: this.createEnvironmentSeed(),
          })
        } else {
          this.markerManager.spawnEnvironmentMarker(envType)
        }
        this.captureHistorySnapshot()
      },
      onPanelMenuAdd: () => {
        const pos = this.menuSystem.getPanelMenuPosition()
        this.menuSystem.hidePanelMenu()
        this.menuSystem.showObjectTypeMenu(pos.x, pos.y)
      },
      onPanelMenuPaste: () => {
        this.menuSystem.hidePanelMenu()
        if (this.clipboardManager.hasBatchData()) {
          const pasted = this.clipboardManager.pasteBatch()
          if (pasted.length > 0) {
            this.captureHistorySnapshot()
          }
          return
        }
        const spawn = this.consumePanelMenuSpawn()
        const pasted = spawn
          ? this.clipboardManager.pasteAt(spawn.x, spawn.y)
          : this.clipboardManager.paste()
        if (pasted) {
          this.captureHistorySnapshot()
        }
      },
      onPanelMenuMapSettings: () => {
        void this.showMapSettingsDialog()
      },
      onPanelMenuAssetManager: () => {
        this.menuSystem.hidePanelMenu()
        void this.showEnvironmentAssetManagerDialog()
      },
    })

    this.environmentPalette = new EditorEnvironmentPalette({
      container: environmentPalette,
      getCustomEnvironmentAssets: () => this.customEnvironmentAssets,
      getAvailableRenderLayers: () => this.getAvailableRenderLayers(),
      getDefaultRenderLayer: () => this.getEnvironmentStampDefaultRenderLayer(),
      onSelected: (selection) => this.selectEnvironmentStamp(selection),
      onCreateCustomEnvironmentAsset: () =>
        this.handleCreateCustomEnvironmentAsset(),
    })

    this.tooltipManager = new TooltipManager({
      root: this.editorOverlay,
    })

    this.contextMenu = new EditorContextMenu({
      editorWorkspace: this.editorWorkspace,
      isEditablePolygon: (obj) => this.isEditablePolygon(obj),
      onAction: (action) => this.handlePolygonMenuAction(action),
      canPaste: () => this.clipboardManager.hasData(),
      canCopy: (target) => this.clipboardManager.canCopy(target),
      isActionDisabled: (action) => this.isContextMenuActionDisabled(action),
    })

    // ShapeManager initialized earlier

    this.thumbnailCapture = new EditorThumbnailCapture({
      fabricCanvas: () => this.fabricCanvas,
      gameCanvas: this.gameCanvas,
      gameClient: () => this.gameClient,
      mapSerializer: this.mapSerializer,
      cameraManager: this.cameraManager,
      currentMapMeta: () => this.currentMapMeta,
    })

    this.canvasEventHandler = new EditorCanvasEventHandler({
      fabricCanvas: () => this.fabricCanvas,
      editorCanvas: this.editorCanvas,
      editorOverlay: this.editorOverlay,
      snapManager: this.snapManager,
      editorObjectMap: this.objectManager.getEditorObjectMap(),
      getIsPanning: () => this.isPanning,
      setIsPanning: (value) => {
        this.isPanning = value
      },
      getLastPanPosition: () => ({ x: this.lastClientX, y: this.lastClientY }),
      setLastPanPosition: (x, y) => {
        this.lastClientX = x
        this.lastClientY = y
      },
      isVisible: () => this.visible,
      getCurrentView: () => this.currentView,
      hidePolygonMenu: () => this.contextMenu.hide(),
      handleEditablePolygonContextMenuEvent: (event) =>
        this.handleEditablePolygonContextMenuEvent(event),
      handleEnvironmentStampPointerDown: (opt) =>
        this.handleEnvironmentStampPointerDown(opt),
      handleEditablePolygonPointerDown: (opt) =>
        this.handleEditablePolygonPointerDown(opt),
      handleTerrainPointerDown: (opt) =>
        this.terrainBrushController.handlePointerDown(opt),
      handleTerrainPointerMove: (opt) =>
        this.terrainBrushController.handlePointerMove(opt),
      handleTerrainPointerUp: () =>
        this.terrainBrushController.handlePointerUp(),
      clearSelection: () => this.clearEditorSelection(),
      restoreCanvasCursor: () => this.restoreEditorCanvasCursor(),
      handleCanvasSelection: (objects) => {
        if (this.suppressCanvasSelectionSync) {
          return
        }
        this.objectManager.handleCanvasSelection(objects)
      },
      onObjectMoving: (target) => this.handleObjectMoving(target),
      onObjectModified: (target) => this.handleObjectModified(target),
      onPolygonEdited: () => this.captureHistorySnapshot(),
    })

    this.setupEventListeners()
    this.updateLocalization()

    this.handleResize = this.handleWindowResize.bind(this)
    window.addEventListener('resize', this.handleResize)
  }

  private setupEventListeners() {
    const depthFilterEl = document.getElementById('editorDepthFilter')
    if (depthFilterEl instanceof HTMLSelectElement) {
      this.editorDepthFilterEl = depthFilterEl
      this.editorDepthFilterEl.value = 'all'
      this.editorDepthFilterEl.addEventListener('change', () => {
        const val = this.editorDepthFilterEl?.value
        if (val === 'all' || val === undefined) {
          this.sceneDepthFilter = 'all'
        } else {
          const n = parseInt(val, 10)
          this.sceneDepthFilter = isNaN(n) ? 'all' : n
        }
        this.applyDepthFilter()
      })
    }

    this.editorOverlay.addEventListener(
      'pointerdown',
      (event) => {
        const target = event.target as Node
        if (
          this.contextMenu.containsTarget(target) ||
          this.menuSystem.containsTarget(target) ||
          this.environmentPalette.containsTarget(target)
        ) {
          return
        }
        if (DEBUG_EDITOR_MENU) {
          console.log('[editor] global pointerdown hide menus', {
            targetType: (event.target as HTMLElement | null)?.tagName ?? '',
          })
        }
        this.clearPanelMenuSpawn()
        this.contextMenu.hide()
        this.menuSystem.hideAll()
      },
      true
    )

    this.editorOverlay.addEventListener(
      'contextmenu',
      (event) => {
        this.routeEditorContextMenu(event)
      },
      true
    )

    this.editorOverlay.addEventListener(
      'keydown',
      (event) => {
        this.handleKeyDown(event)
      },
      true
    )
    this.editorOverlay.addEventListener(
      'keyup',
      (event) => {
        this.handleKeyUp(event)
      },
      true
    )

    window.addEventListener(
      'keydown',
      (event) => {
        this.handleKeyDown(event)
      },
      true
    )
    window.addEventListener(
      'keyup',
      (event) => {
        this.handleKeyUp(event)
      },
      true
    )
  }

  private updateLocalization() {
    this.toolbarManager.updateLocalization()
    this.sidebarManager.updateLocalization()
    this.sidebarManager.setSelectModeActive(this.activeObjectType === null)
    this.mapListManager.updateLocalization()
    this.menuSystem.updateLocalization()
    this.environmentPalette.updateLocalization()
    this.renderObjectTree()
  }

  private handleKeyDown(event: KeyboardEvent) {
    if (this.dialogManager.consumeBlockedPostCloseKey(event)) {
      return
    }
    if (event.defaultPrevented) {
      return
    }
    if (this.dialogManager.isDialogOpen()) {
      return
    }
    const target = event.target
    if (target instanceof HTMLInputElement) {
      return
    }
    if (target instanceof HTMLTextAreaElement) {
      return
    }
    if (target instanceof HTMLSelectElement) {
      return
    }
    if (target instanceof HTMLElement && target.isContentEditable) {
      return
    }
    if (!this.visible) {
      return
    }
    const key = event.key
    const isModifier = event.ctrlKey || event.metaKey
    if (this.currentView === EditorView.Editor && key === 'Control') {
      this.beginTemporarySelectMode()
      return
    }
    if (isModifier && key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) {
        this.handleRedo()
      } else {
        this.handleUndo()
      }
      return
    }
    if (this.currentView === EditorView.MapList) {
      this.mapListManager.handleMapListKeyDown(event)
      return
    }
    if (this.currentView === EditorView.Editor && key === 'Escape') {
      if (
        this.environmentStampSelection ||
        this.environmentPalette.isVisible()
      ) {
        event.preventDefault()
        this.setActiveObjectType(null)
        return
      }
    }
    if (this.currentView === EditorView.Editor && isModifier) {
      const lowered = key.toLowerCase()
      if (lowered === 'c') {
        event.preventDefault()
        const selectedIds = this.objectManager.getSelectedEditorObjectIds()
        if (selectedIds.length > 1) {
          const targets = this.getObjectsByIds(selectedIds)
          this.clipboardManager.copyBatch(targets)
        } else {
          const active = this.fabricCanvas?.getActiveObject() ?? null
          if (active && this.clipboardManager.canCopy(active)) {
            this.clipboardManager.copy(active)
          }
        }
        return
      }
      if (lowered === 'v') {
        event.preventDefault()
        if (this.clipboardManager.hasBatchData()) {
          const pasted = this.clipboardManager.pasteBatch()
          if (pasted.length > 0) {
            this.captureHistorySnapshot()
          }
        } else {
          const pasted = this.clipboardManager.paste()
          if (pasted) {
            this.captureHistorySnapshot()
          }
        }
        return
      }
    }
    if (this.menuSystem.handleKeyDown(event)) {
      return
    }
    if (this.currentView === EditorView.Editor) {
      if (key === 'ArrowUp') {
        event.preventDefault()
        this.nudgeSelectedObject(0, -EDITOR_NUDGE_STEP_PX)
        return
      }
      if (key === 'ArrowDown') {
        event.preventDefault()
        this.nudgeSelectedObject(0, EDITOR_NUDGE_STEP_PX)
        return
      }
      if (key === 'ArrowLeft') {
        event.preventDefault()
        this.nudgeSelectedObject(-EDITOR_NUDGE_STEP_PX, 0)
        return
      }
      if (key === 'ArrowRight') {
        event.preventDefault()
        this.nudgeSelectedObject(EDITOR_NUDGE_STEP_PX, 0)
        return
      }
    }
    if (key === 'Escape') {
      event.preventDefault()
      this.handleBack()
    }
  }

  private handleKeyUp(event: KeyboardEvent) {
    if (this.dialogManager.consumeBlockedPostCloseKey(event)) {
      return
    }
    if (event.defaultPrevented) {
      return
    }
    if (
      event.key === 'Control' &&
      this.temporarySelectActive &&
      !event.ctrlKey
    ) {
      this.endTemporarySelectMode()
      return
    }
    if (this.dialogManager.isDialogOpen()) {
      return
    }
    const target = event.target
    if (target instanceof HTMLInputElement) {
      return
    }
    if (target instanceof HTMLTextAreaElement) {
      return
    }
    if (target instanceof HTMLSelectElement) {
      return
    }
    if (target instanceof HTMLElement && target.isContentEditable) {
      return
    }
    if (!this.visible) {
      return
    }
    if (this.currentView === EditorView.MapList) {
      this.mapListManager.handleMapListKeyUp(event)
    }
  }

  private handleBack() {
    if (this.hasUnsavedChanges()) {
      void this.confirmExitWithUnsavedChanges()
      return
    }
    if (this.currentView === EditorView.Editor) {
      this.showMapListView()
    } else {
      this.hide()
      if (this.onBackToMenuCallback) {
        this.onBackToMenuCallback()
      }
    }
  }

  private handleUndo() {
    if (this.currentView !== EditorView.Editor) {
      return
    }
    if (this.undoTreeHistory()) {
      return
    }
    this.lastHistoryWasTree = false
    this.historyManager.undo()
  }

  private handleRedo() {
    if (this.currentView !== EditorView.Editor) {
      return
    }
    if (this.redoTreeHistory()) {
      return
    }
    this.lastHistoryWasTree = false
    this.historyManager.redo()
  }

  private async handleCreateMap() {
    await this.mapListManager.handleCreateMap()
  }

  private hideAllSubmenus() {
    this.menuSystem.hideAllSubmenus()
  }

  // ========================================
  // OBJECT LIFECYCLE
  // ========================================

  private handleObjectClick(type: EditorObjectMenuType) {
    this.menuSystem.hidePanelMenu()

    if (type === ObjectType.Empty) {
      this.hideAllSubmenus()
      this.menuSystem.hideObjectTypeMenu()
      this.setActiveObjectType(type)
      const spawn = this.consumePanelMenuSpawn()
      const group = this.createEmptyNode(
        spawn?.x ?? this.getViewportCenter().x,
        spawn?.y ?? this.getViewportCenter().y
      )
      if (group) {
        this.fabricCanvas?.add(group)
        this.registerEditorObjectWithDepth(type, group)
        this.fabricCanvas?.setActiveObject(group)
        this.objectManager.handleCanvasSelection([group])
        this.fabricCanvas?.requestRenderAll()
        this.captureHistorySnapshot()
      }
      return
    }

    if (type === 'terrainMaterial') {
      this.setActiveObjectType(ObjectType.Terrain)
      this.hideAllSubmenus()
      this.menuSystem.showTerrainSubmenu()
      return
    }
    if (type === 'terrainContour') {
      this.setActiveObjectType(ObjectType.Terrain)
      this.hideAllSubmenus()
      this.menuSystem.showTerrainContourSubmenu()
      return
    }
    if (type === ObjectType.ReferenceLine) {
      this.hideAllSubmenus()
      this.menuSystem.hideObjectTypeMenu()
      this.terrainBrushController.selectReferenceLineTool()
      this.setActiveObjectType(ObjectType.ReferenceLine)
      return
    }

    if (type === ObjectType.Weapon) {
      this.setActiveObjectType(ObjectType.Weapon)
      this.hideAllSubmenus()
      this.menuSystem.showWeaponMenu()
      return
    }

    if (type === 'skill') {
      this.setActiveObjectType(ObjectType.AttackPickup)
      this.hideAllSubmenus()
      this.menuSystem.showSkillMenu()
      return
    }

    if (type === ObjectType.Player) {
      this.hideAllSubmenus()
      this.menuSystem.hideObjectTypeMenu()
      this.setActiveObjectType(type)
      const spawn = this.consumePanelMenuSpawn()
      if (spawn) {
        this.markerManager.spawnPlayerMarker({
          x: spawn.x * this.invPixelsPerMeter,
          y: spawn.y * this.invPixelsPerMeter,
        })
      } else {
        this.markerManager.spawnPlayerMarker()
      }
      this.captureHistorySnapshot()
      return
    }

    if (type === ObjectType.Camera) {
      this.hideAllSubmenus()
      this.menuSystem.hideObjectTypeMenu()
      if (this.hasObjectOfType(ObjectType.Camera)) {
        return
      }
      this.setActiveObjectType(type)
      const spawn = this.consumePanelMenuSpawn()
      if (spawn) {
        const invPixelsPerMeter = this.invPixelsPerMeter
        const centerX = spawn.x * invPixelsPerMeter
        const centerY = spawn.y * invPixelsPerMeter
        const camera = computeCameraOffsetFromCenter(
          centerX,
          centerY,
          1,
          this.editorCanvas.width,
          this.editorCanvas.height,
          invPixelsPerMeter
        )
        this.cameraManager.spawnCameraViewFrame(camera, type)
      } else {
        this.cameraManager.spawnCameraViewFrame(undefined, type)
      }
      this.captureHistorySnapshot()
      return
    }

    if (type === ObjectType.Npc) {
      this.setActiveObjectType(type)
      this.hideAllSubmenus()
      this.menuSystem.showNpcSubmenu()
      return
    }

    if (type === ObjectType.Checkpoint) {
      this.hideAllSubmenus()
      this.menuSystem.hideObjectTypeMenu()
      this.setActiveObjectType(type)
      const spawn = this.consumePanelMenuSpawn()
      if (spawn) {
        this.markerManager.spawnCheckpointMarker({
          x: spawn.x * this.invPixelsPerMeter,
          y: spawn.y * this.invPixelsPerMeter,
        })
      } else {
        this.markerManager.spawnCheckpointMarker()
      }
      this.captureHistorySnapshot()
      return
    }

    if (type === ObjectType.HookAnchor) {
      this.hideAllSubmenus()
      this.menuSystem.hideObjectTypeMenu()
      this.setActiveObjectType(type)
      const spawn = this.consumePanelMenuSpawn()
      if (spawn) {
        this.markerManager.spawnHookAnchorMarker({
          x: spawn.x * this.invPixelsPerMeter,
          y: spawn.y * this.invPixelsPerMeter,
        })
      } else {
        this.markerManager.spawnHookAnchorMarker()
      }
      this.captureHistorySnapshot()
      return
    }

    if (type === 'environment') {
      this.hideAllSubmenus()
      this.menuSystem.hideObjectTypeMenu()
      this.contextMenu.hide()
      this.environmentPalette.show()
      if (!this.customEnvironmentAssetsLoaded) {
        void this.refreshCustomEnvironmentAssets()
      }
      return
    }

    if (type === 'prop') {
      this.setActiveObjectType(null)
      return
    }

    this.hideAllSubmenus()
    this.menuSystem.hideObjectTypeMenu()
    this.setActiveObjectType(type)
  }

  private showMapListView() {
    if (this.currentView === EditorView.Editor) {
      this.persistEditorViewportState()
    }
    this.currentView = EditorView.MapList
    this.sidebarManager.hide()
    this.editorCanvas.style.display = 'none'
    this.toolbarManager.hide()
    this.menuSystem.hideAll()
    this.contextMenu.hide()
    this.clearTemporarySelectState()
    this.setActiveObjectType(null)
    this.mapListManager.show()
  }

  private showEditorView() {
    this.currentView = EditorView.Editor
    this.mapListManager.hide()
    this.sidebarManager.show()
    this.toolbarManager.show()
    this.editorCanvas.style.display = 'block'
    this.menuSystem.hideAll()
    this.ensureFabricCanvas()
    this.resizeEditorCanvas()
    this.renderObjectTree()
  }

  private async handlePreview() {
    this.persistEditorViewportState()
    await this.mapListManager.handlePreview()
  }

  private async handleSave() {
    void this.saveCurrentMap()
  }

  private clearEditorScene() {
    const canvas = this.fabricCanvas
    if (!canvas) {
      return
    }
    canvas.discardActiveObject()
    for (let i = 0; i < this.cameraManager.getCameraViews().length; i++) {
      const icon = this.cameraManager.getCameraViews()[i].icon
      if (icon.canvas === canvas) {
        canvas.remove(icon)
      }
    }
    // Objects removal is handled by objectManager.clear() which iterates its list.
    // However, objectManager.clear() implementation removes from canvas.
    // So we don't need to iterate editorObjects here if objectManager does it.

    this.shapeManager.clearAllShapeResetData()
    this.cameraManager.getCameraViews().length = 0
    this.cameraManager.getCameraViewMap().clear()
    this.terrainManager.clear()

    this.markerManager.clear()
    this.objectManager.clear()

    this.patternManager.clearAll()
    this.snapManager.ensureSnapGuides()
  }

  // ========================================
  // OBJECT LIFECYCLE
  // ========================================

  private updateObjectTreeContext() {
    this.objectTreeManager.updateContext({
      editorObjects: this.getDepthFilteredEditorObjects(),
      renamingEditorObjectId: this.objectManager.getRenamingEditorObjectId(),
      selectedEditorObjectId: this.objectManager.getSelectedEditorObjectId(),
      selectedEditorObjectIds: this.objectManager.getSelectedEditorObjectIds(),
      dragObjectId: this.objectManager.getDragId(),
    })
  }

  private renderObjectTree() {
    this.updateObjectTreeContext()
    this.objectTreeManager.renderObjectTree()
    this.refreshDepthFilterOptions()
  }

  private refreshDepthFilterOptions(): void {
    const el = this.editorDepthFilterEl
    if (!el) return
    const layers = this.getAvailableRenderLayers()
    const currentVal = el.value
    // 重建选项列表
    el.innerHTML = '<option value="all">全部</option>'
    for (let i = 0; i < layers.length; i++) {
      const opt = document.createElement('option')
      opt.value = String(layers[i])
      opt.textContent = formatRenderLayerLabel(layers[i])
      el.appendChild(opt)
    }
    // 恢复当前选中值（若仍有效）
    const stillValid =
      currentVal === 'all' || layers.some((l) => String(l) === currentVal)
    el.value = stillValid ? currentVal : 'all'
    if (el.value !== currentVal && currentVal !== 'all') {
      this.sceneDepthFilter = 'all'
      this.applyDepthFilter()
    }
  }

  private getAvailableRenderLayers(): number[] {
    const all = this.objectManager.getEditorObjects()
    const layerSet = new Set<number>([RENDER_LAYER_SKY])
    for (let i = 0; i < all.length; i++) {
      const data = all[i]
      layerSet.add(this.getEditorObjectRenderLayer(data.object))
    }
    return Array.from(layerSet).sort((a, b) => a - b)
  }

  private getEditorObjectDefaultRenderLayer(): number {
    return typeof this.sceneDepthFilter === 'number'
      ? this.sceneDepthFilter
      : getDefaultShapeRenderLayer()
  }

  private getCommonObjectRenderLayer(ids: readonly number[]): number | null {
    let commonLayer = 0
    let hasLayer = false
    for (let i = 0; i < ids.length; i++) {
      const data = this.objectManager.getEditorObjectById(ids[i])
      if (!data) {
        return null
      }
      const layer = this.getEditorObjectRenderLayer(data.object)
      if (!hasLayer) {
        commonLayer = layer
        hasLayer = true
        continue
      }
      if (commonLayer !== layer) {
        return null
      }
    }
    return hasLayer ? commonLayer : null
  }

  private getGroupedObjectRenderLayer(ids: readonly number[]): number {
    return (
      this.getCommonObjectRenderLayer(ids) ??
      this.getEditorObjectDefaultRenderLayer()
    )
  }

  private getEnvironmentStampDefaultRenderLayer(): number {
    return this.getEditorObjectDefaultRenderLayer()
  }

  private registerEditorObjectWithDepth(
    type: ObjectType,
    obj: fabric.Object,
    preferredName?: string
  ): EditorObjectData {
    const data = this.objectManager.registerEditorObject(
      type,
      obj,
      preferredName
    )
    // 按当前选中层级自动设置 renderLayer，并确保对象立即可见
    if (typeof this.sceneDepthFilter === 'number') {
      this.setEditorObjectRenderLayer(obj, this.sceneDepthFilter)
      this.applyEditorObjectCanvasVisibility(data)
    } else {
      // 默认层级也需要排序（新对象插入后可能破坏顺序）
      this.reorderCanvasObjects()
    }
    return data
  }

  private isObjectMatchingDepthFilter(data: EditorObjectData): boolean {
    if (this.sceneDepthFilter === 'all') return true
    const layer = this.getEditorObjectRenderLayer(data.object)
    return layer === this.sceneDepthFilter
  }

  private shouldShowEditorObjectOnCanvas(data: EditorObjectData): boolean {
    if (!data.isVisible || this.hasHiddenGroupAncestor(data)) {
      return false
    }
    if (this.isObjectMatchingDepthFilter(data)) {
      return true
    }
    return (
      this.isGroupContainer(data.object) &&
      this.hasVisibleDepthMatchedDescendant(data.id)
    )
  }

  private applyEditorObjectCanvasVisibility(data: EditorObjectData): void {
    const visible = this.shouldShowEditorObjectOnCanvas(data)
    if (data.object.visible !== visible) {
      data.object.visible = visible
      this.markObjectVisibilityDirty(data.object)
    }
    this.terrainManager.setProxyRenderObjectVisible(data.object, visible)
  }

  private hasVisibleDepthMatchedDescendant(parentId: number): boolean {
    const all = this.objectManager.getEditorObjects()
    for (let i = 0; i < all.length; i++) {
      const data = all[i]
      if (
        data.id === parentId ||
        !data.isVisible ||
        !this.isObjectMatchingDepthFilter(data)
      ) {
        continue
      }
      let current: EditorObjectData | null = data
      while (current && current.parentId !== null) {
        const parent = this.objectManager.getEditorObjectById(current.parentId)
        if (!parent) {
          break
        }
        if (parent.id === parentId) {
          return true
        }
        if (this.isGroupContainer(parent.object) && !parent.isVisible) {
          break
        }
        current = parent
      }
    }
    return false
  }

  private hasHiddenGroupAncestor(data: EditorObjectData): boolean {
    let current = data
    while (current.parentId !== null) {
      const parent = this.objectManager.getEditorObjectById(current.parentId)
      if (!parent) {
        return false
      }
      if (this.isGroupContainer(parent.object) && !parent.isVisible) {
        return true
      }
      current = parent
    }
    return false
  }

  private markObjectVisibilityDirty(object: fabric.Object): void {
    object.dirty = true
    let parent = object.group
    while (parent) {
      parent.dirty = true
      parent = parent.group
    }
  }

  private applyAllEditorObjectCanvasVisibility(): void {
    const all = this.objectManager.getEditorObjects()
    for (let i = 0; i < all.length; i++) {
      this.applyEditorObjectCanvasVisibility(all[i])
    }
  }

  private getDepthFilteredEditorObjects(): EditorObjectData[] {
    const all = this.objectManager.getEditorObjects()
    if (this.sceneDepthFilter === 'all') return all
    const idToData = new Map<number, EditorObjectData>()
    for (let i = 0; i < all.length; i++) {
      idToData.set(all[i].id, all[i])
    }
    const visibleIds = new Set<number>()
    for (let i = 0; i < all.length; i++) {
      const data = all[i]
      if (!this.isObjectMatchingDepthFilter(data)) continue
      // 把当前节点及所有祖先节点加入可见集合
      let cur: EditorObjectData | undefined = data
      while (cur) {
        visibleIds.add(cur.id)
        cur = cur.parentId !== null ? idToData.get(cur.parentId) : undefined
      }
    }
    return all.filter((d) => visibleIds.has(d.id))
  }

  private applyDepthFilter(): void {
    // 通知地形管理器更新渲染过滤。
    this.terrainManager.setSceneDepthFilter(this.sceneDepthFilter)
    const canvas = this.fabricCanvas
    if (!canvas) {
      this.renderObjectTree()
      return
    }
    this.applyAllEditorObjectCanvasVisibility()
    // 切回“全部”时也要重排，避免保留单层模式下的临时前置顺序。
    this.reorderCanvasObjects()
    this.renderObjectTree()
  }

  private handleObjectTreeVisibilityToggle(id: number): void {
    const data = this.objectManager.getEditorObjectById(id)
    if (!data) {
      return
    }
    const changed = this.objectManager.setObjectVisibleById(id, !data.isVisible)
    if (!changed) {
      return
    }
    this.applyDepthFilter()
    this.cameraManager.refreshCameraFocus(
      this.fabricCanvas?.getActiveObject() ?? null
    )
    this.fabricCanvas?.requestRenderAll()
    this.captureHistorySnapshot()
  }

  private handleObjectTreeContextMenu(
    id: number,
    clientX: number,
    clientY: number
  ) {
    const selectedIds = this.objectManager.getSelectedEditorObjectIds()
    if (selectedIds.length > 1 && selectedIds.includes(id)) {
      this.showMultiSelectContextMenu(clientX, clientY)
      return
    }
    this.objectManager.focusEditorObjectById(id)
    const data = this.objectManager.getEditorObjectById(id)
    if (!data) {
      return
    }
    this.showShapeContextMenu(data.object, clientX, clientY)
  }

  private handleObjectTreeCollapsedPathsChanged(paths: readonly string[]) {
    const nextPaths: string[] = []
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i]
      if (typeof path === 'string' && path.length > 0) {
        nextPaths.push(path)
      }
    }
    this.objectTreeCollapsedPaths = nextPaths
    const mapId = this.currentMapMeta?.id
    if (!mapId) {
      return
    }
    void saveEditorSetting(
      `${EDITOR_TREE_COLLAPSED_PATHS_PREFIX}${mapId}`,
      nextPaths
    )
  }

  private async restoreObjectTreeCollapsedPaths(mapId: string) {
    const savedPaths = await loadEditorSetting<readonly string[]>(
      `${EDITOR_TREE_COLLAPSED_PATHS_PREFIX}${mapId}`
    )
    if (this.currentMapMeta?.id !== mapId) {
      return
    }
    const nextPaths: string[] = []
    if (Array.isArray(savedPaths)) {
      for (let i = 0; i < savedPaths.length; i++) {
        const path = savedPaths[i]
        if (typeof path === 'string' && path.length > 0) {
          nextPaths.push(path)
        }
      }
    }
    this.objectTreeCollapsedPaths = nextPaths
    this.objectTreeManager.setCollapsedPaths(nextPaths)
    this.renderObjectTree()
  }

  private handleObjectTreeSelection(
    id: number,
    mode: 'replace' | 'toggle' | 'range'
  ) {
    const selected = this.objectManager.getSelectedEditorObjectIds()
    let nextSelection: number[] = []
    if (mode === 'replace') {
      nextSelection = [id]
      this.objectTreeAnchorId = id
    } else if (mode === 'toggle') {
      if (selected.includes(id)) {
        nextSelection = selected.filter((value) => value !== id)
      } else {
        nextSelection = [...selected, id]
      }
      this.objectTreeAnchorId = id
    } else {
      const anchorId =
        this.objectTreeAnchorId === -1 ? id : this.objectTreeAnchorId
      nextSelection = this.collectRangeSelection(anchorId, id)
    }

    if (nextSelection.length === 0) {
      this.clearEditorSelection()
      return
    }
    this.objectManager.setSelectedIds(nextSelection)
    this.applyCanvasSelectionFromIds(nextSelection)
  }

  private clearEditorSelection() {
    this.objectTreeAnchorId = -1
    const canvas = this.fabricCanvas
    if (canvas) {
      canvas.discardActiveObject()
      this.objectManager.handleCanvasSelection([])
      canvas.requestRenderAll()
      return
    }
    this.objectManager.handleCanvasSelection([])
  }

  private collectRangeSelection(anchorId: number, targetId: number) {
    const visibleIds = this.objectTreeManager.getVisibleObjectIdsInRenderOrder()
    let anchorIndex = -1
    let targetIndex = -1
    for (let i = 0; i < visibleIds.length; i++) {
      const id = visibleIds[i]
      if (id === anchorId) {
        anchorIndex = i
      }
      if (id === targetId) {
        targetIndex = i
      }
    }
    if (anchorIndex === -1 || targetIndex === -1) {
      return [targetId]
    }
    const start = Math.min(anchorIndex, targetIndex)
    const end = Math.max(anchorIndex, targetIndex)
    const result: number[] = []
    for (let i = start; i <= end; i++) {
      result.push(visibleIds[i])
    }
    return result
  }

  private isObjectOnCanvas(
    object: fabric.Object,
    canvas: fabric.Canvas
  ): boolean {
    let current: fabric.Object | null = object
    while (current) {
      if (current.canvas === canvas) {
        return true
      }
      current = current.group ?? null
    }
    return false
  }

  private applyCanvasSelectionFromIds(ids: number[]) {
    const canvas = this.fabricCanvas
    if (!canvas) {
      return
    }
    if (ids.length === 0) {
      this.suppressCanvasSelectionSync = true
      try {
        canvas.discardActiveObject()
      } finally {
        this.suppressCanvasSelectionSync = false
      }
      this.applyProgrammaticCanvasSelectionSideEffects(null)
      canvas.requestRenderAll()
      return
    }
    const objects: fabric.Object[] = []
    for (let i = 0; i < ids.length; i++) {
      const data = this.objectManager.getEditorObjectById(ids[i])
      if (!data?.object) {
        continue
      }
      const target = this.objectManager.getSelectionTarget(data.object)
      if (!this.isObjectOnCanvas(target, canvas)) {
        continue
      }
      if (!objects.includes(target)) {
        objects.push(target)
      }
    }
    if (objects.length === 0) {
      this.suppressCanvasSelectionSync = true
      try {
        canvas.discardActiveObject()
      } finally {
        this.suppressCanvasSelectionSync = false
      }
      this.applyProgrammaticCanvasSelectionSideEffects(null)
      canvas.requestRenderAll()
      return
    }
    if (objects.length === 1) {
      this.suppressCanvasSelectionSync = true
      try {
        canvas.setActiveObject(objects[0])
      } finally {
        this.suppressCanvasSelectionSync = false
      }
      this.applyProgrammaticCanvasSelectionSideEffects(objects[0])
      this.updateActiveSelectionLockVisual()
      canvas.requestRenderAll()
      return
    }
    const selection = new fabric.ActiveSelection(objects, { canvas })
    this.suppressCanvasSelectionSync = true
    try {
      canvas.setActiveObject(selection)
    } finally {
      this.suppressCanvasSelectionSync = false
    }
    this.applyProgrammaticCanvasSelectionSideEffects(objects[0])
    this.updateActiveSelectionLockVisual()
    canvas.requestRenderAll()
  }

  private applyProgrammaticCanvasSelectionSideEffects(
    focus: fabric.Object | null
  ): void {
    this.cameraManager.refreshCameraFocus(focus)
    this.terrainManager.handleSelectionChanged(focus)
    this.updateActiveSelectionLockVisual()
  }

  private selectionContainsLockedObject(
    objects: readonly fabric.Object[]
  ): boolean {
    for (let i = 0; i < objects.length; i++) {
      if (this.objectManager.isObjectLocked(objects[i])) {
        return true
      }
    }
    return false
  }

  private isSelectionLocked(): boolean {
    return this.objectManager.hasLockedObjects(
      this.objectManager.getSelectedEditorObjectIds()
    )
  }

  private updateActiveSelectionLockVisual() {
    const active = this.fabricCanvas?.getActiveObject() ?? null
    if (!(active instanceof fabric.ActiveSelection)) {
      return
    }
    const baseObject = fabric.Object.prototype
    const isLocked = this.selectionContainsLockedObject(active.getObjects())
    active.borderColor = isLocked
      ? 'rgba(190, 66, 66, 0.92)'
      : baseObject.borderColor
    active.cornerColor = isLocked
      ? 'rgba(220, 92, 92, 0.95)'
      : baseObject.cornerColor
    active.cornerStrokeColor = isLocked
      ? 'rgba(42, 8, 8, 0.85)'
      : baseObject.cornerStrokeColor
    active.hasControls = !isLocked
    active.lockMovementX = isLocked
    active.lockMovementY = isLocked
  }

  private getDragSelectionIds(primaryId: number) {
    if (
      this.dragSelectionIds.length > 0 &&
      this.dragSelectionIds.includes(primaryId)
    ) {
      return this.dragSelectionIds
    }
    const selected = this.objectManager.getSelectedEditorObjectIds()
    if (selected.includes(primaryId) && selected.length > 1) {
      return selected
    }
    return [primaryId]
  }

  private hasObjectOfType(type: ObjectType): boolean {
    return this.objectManager.hasObjectOfType(type)
  }

  private getViewportCenter(): { x: number; y: number } {
    if (!this.fabricCanvas) {
      return {
        x: this.editorCanvas.width * 0.5,
        y: this.editorCanvas.height * 0.5,
      }
    }
    const vpt = this.fabricCanvas.viewportTransform
    if (!vpt) {
      return {
        x: this.editorCanvas.width * 0.5,
        y: this.editorCanvas.height * 0.5,
      }
    }
    const inverted = fabric.util.invertTransform(vpt)
    const centerPoint = fabric.util.transformPoint(
      new fabric.Point(
        this.editorCanvas.width / 2,
        this.editorCanvas.height / 2
      ),
      inverted
    )
    return { x: centerPoint.x, y: centerPoint.y }
  }

  private getEditorViewportState(): EditorViewportState | null {
    const canvas = this.fabricCanvas
    if (!canvas) {
      return null
    }
    const vpt = canvas.viewportTransform
    if (!vpt) {
      return null
    }
    const zoomScaled = Math.round(vpt[0] * EDITOR_VIEW_ZOOM_SCALE)
    const offsetX = Math.round(vpt[4] ?? 0)
    const offsetY = Math.round(vpt[5] ?? 0)
    return {
      zoomScaled: Math.min(
        Math.max(zoomScaled, EDITOR_VIEW_MIN_ZOOM_SCALED),
        EDITOR_VIEW_MAX_ZOOM_SCALED
      ),
      offsetX,
      offsetY,
    }
  }

  private applyEditorViewportState(state: EditorViewportState | null) {
    const canvas = this.fabricCanvas
    if (!canvas) {
      return
    }
    const zoomScaled = state?.zoomScaled ?? EDITOR_VIEW_ZOOM_SCALE
    const safeZoomScaled = Math.min(
      Math.max(zoomScaled, EDITOR_VIEW_MIN_ZOOM_SCALED),
      EDITOR_VIEW_MAX_ZOOM_SCALED
    )
    const zoom = safeZoomScaled / EDITOR_VIEW_ZOOM_SCALE
    const offsetX = state?.offsetX ?? 0
    const offsetY = state?.offsetY ?? 0
    canvas.setViewportTransform([zoom, 0, 0, zoom, offsetX, offsetY])
    canvas.requestRenderAll()
  }

  private persistEditorViewportState() {
    if (this.currentView !== EditorView.Editor) {
      return
    }
    const meta = this.currentMapMeta
    if (!meta) {
      return
    }
    const viewState = this.getEditorViewportState()
    if (!viewState) {
      return
    }
    void saveEditorMapViewState(meta.id, viewState)
  }

  // ========================================
  // MENU SYSTEM
  // ========================================

  private routeEditorContextMenu(event: MouseEvent) {
    if (!this.visible || this.currentView !== EditorView.Editor) {
      return
    }
    const targetNode = event.target as Node
    if (!this.editorOverlay.contains(targetNode)) {
      return
    }
    if (this.isInsideAnyMenu(targetNode)) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (this.sidebarManager.containsTarget(targetNode)) {
      this.handleObjectPanelContextMenuCore(event)
      return
    }
    this.handleEditablePolygonContextMenuEvent(event)
  }

  // ========================================
  // MENU SYSTEM
  // ========================================

  private isInsideAnyMenu(targetNode: Node) {
    return (
      this.menuSystem.containsTarget(targetNode) ||
      this.contextMenu.containsTarget(targetNode) ||
      this.environmentPalette.containsTarget(targetNode)
    )
  }

  private setPanelMenuSpawnFromEvent(event: MouseEvent) {
    if (!this.fabricCanvas) {
      return
    }
    const pointer = this.fabricCanvas.getScenePoint(event)
    this.panelMenuSpawnX = Math.round(pointer.x)
    this.panelMenuSpawnY = Math.round(pointer.y)
    this.panelMenuSpawnValid = true
  }

  private clearPanelMenuSpawn() {
    this.panelMenuSpawnValid = false
  }

  private consumePanelMenuSpawn() {
    if (!this.panelMenuSpawnValid) {
      return null
    }
    this.panelMenuSpawnValid = false
    this.panelMenuSpawnScratch.x = this.panelMenuSpawnX
    this.panelMenuSpawnScratch.y = this.panelMenuSpawnY
    return this.panelMenuSpawnScratch
  }

  private handleObjectPanelContextMenuCore(event: MouseEvent) {
    const target = event.target as HTMLElement | null
    const node = target?.closest<HTMLButtonElement>('.editor-object-node')
    if (DEBUG_EDITOR_MENU) {
      // console.log('[editor] panel contextmenu', {
      //   targetClass: target?.className ?? '',
      //   hasNode: !!node,
      //   clientX: event.clientX,
      //   clientY: event.clientY,
      // })
    }
    this.menuSystem.hideObjectTypeMenu()
    if (node?.dataset.objectId) {
      const objectId = Number.parseInt(node.dataset.objectId, 10)
      if (Number.isFinite(objectId)) {
        this.handleObjectTreeContextMenu(objectId, event.clientX, event.clientY)
        return
      }
    }
    this.contextMenu.hide()
    this.clearPanelMenuSpawn()
    this.menuSystem.setPanelMenuPasteEnabled(this.clipboardManager.hasData())
    this.menuSystem.showPanelMenu(event.clientX, event.clientY)
  }

  // ========================================

  // OBJECT LIFECYCLE

  // ========================================

  private setActiveObjectType(type: ObjectType | null) {
    this.activeObjectType = type
    if (type !== ObjectType.Terrain && type !== ObjectType.ReferenceLine) {
      this.terrainBrushController.clearBrush()
    }
    if (!this.isEnvironmentStampObjectType(type)) {
      this.clearEnvironmentStampMode(true)
    }
    this.terrainManager.setInteractionEnabled(
      !this.terrainBrushController.isBrushSelected()
    )
    this.sidebarManager.setSelectModeActive(type === null)
  }

  private enterSelectionMode() {
    this.clearTemporarySelectState()
    this.hideAllSubmenus()
    this.menuSystem.hideObjectTypeMenu()
    this.contextMenu.hide()
    this.setActiveObjectType(null)
  }

  private beginTemporarySelectMode(): void {
    if (this.temporarySelectActive) {
      return
    }

    const savedObjectType = this.activeObjectType
    const savedTerrainBrushId = this.terrainBrushController.getSelectedBrushId()
    const savedEnvironmentStamp = this.environmentStampSelection
    const savedPaletteVisible = this.environmentPalette.isVisible()
    if (
      savedObjectType === null &&
      savedTerrainBrushId === null &&
      savedEnvironmentStamp === null &&
      !savedPaletteVisible
    ) {
      return
    }

    this.temporarySelectSavedObjectType = savedObjectType
    this.temporarySelectSavedTerrainBrushId = savedTerrainBrushId
    this.temporarySelectSavedEnvironmentStamp = savedEnvironmentStamp
    this.temporarySelectSavedEnvironmentPaletteVisible = savedPaletteVisible
    this.temporarySelectActive = true
    this.setActiveObjectType(null)
  }

  private endTemporarySelectMode(): void {
    if (!this.temporarySelectActive) {
      return
    }

    const savedObjectType = this.temporarySelectSavedObjectType
    const savedTerrainBrushId = this.temporarySelectSavedTerrainBrushId
    const savedEnvironmentStamp = this.temporarySelectSavedEnvironmentStamp
    const savedPaletteVisible =
      this.temporarySelectSavedEnvironmentPaletteVisible
    this.clearTemporarySelectState()

    if (savedEnvironmentStamp) {
      if (savedPaletteVisible) {
        this.environmentPalette.show()
      }
      this.environmentPalette.restoreSelection(savedEnvironmentStamp)
      this.selectEnvironmentStamp(savedEnvironmentStamp)
      return
    }

    if (savedTerrainBrushId) {
      this.terrainBrushController.selectBrush(savedTerrainBrushId)
      this.setActiveObjectType(ObjectType.Terrain)
      return
    }

    if (savedObjectType === ObjectType.ReferenceLine) {
      this.terrainBrushController.selectReferenceLineTool()
      this.setActiveObjectType(ObjectType.ReferenceLine)
      return
    }

    if (savedObjectType !== null) {
      this.setActiveObjectType(savedObjectType)
      return
    }

    if (savedPaletteVisible) {
      this.environmentPalette.show()
    }
  }

  private clearTemporarySelectState(): void {
    this.temporarySelectActive = false
    this.temporarySelectSavedObjectType = null
    this.temporarySelectSavedTerrainBrushId = null
    this.temporarySelectSavedEnvironmentStamp = null
    this.temporarySelectSavedEnvironmentPaletteVisible = false
  }

  private isEnvironmentStampObjectType(type: ObjectType | null): boolean {
    return (
      type === ObjectType.EnvTree ||
      type === ObjectType.EnvHill ||
      type === ObjectType.EnvHouse ||
      type === ObjectType.EnvCrate ||
      type === ObjectType.EnvGrass ||
      type === ObjectType.EnvFlower ||
      type === ObjectType.EnvCloud ||
      type === ObjectType.EnvKey ||
      type === ObjectType.EnvCustom
    )
  }

  private getEnvironmentStampObjectType(
    envType: MapEnvironmentObjectType
  ): ObjectType {
    if (envType === 'tree') {
      return ObjectType.EnvTree
    }
    if (envType === 'hill') {
      return ObjectType.EnvHill
    }
    if (envType === 'house') {
      return ObjectType.EnvHouse
    }
    if (envType === 'crate') {
      return ObjectType.EnvCrate
    }
    if (envType === 'grass') {
      return ObjectType.EnvGrass
    }
    if (envType === 'flower') {
      return ObjectType.EnvFlower
    }
    if (envType === 'cloud') {
      return ObjectType.EnvCloud
    }
    if (envType === 'key') {
      return ObjectType.EnvKey
    }
    return ObjectType.EnvCustom
  }

  private selectEnvironmentStamp(
    selection: EditorEnvironmentPaletteSelection
  ): void {
    this.environmentStampSelection = selection
    this.setActiveObjectType(
      this.getEnvironmentStampObjectType(selection.envType)
    )
    this.environmentStampSelection = selection
    this.applyEnvironmentStampCursor()
  }

  private clearEnvironmentStampMode(hidePalette: boolean): void {
    if (
      !this.environmentStampSelection &&
      !this.environmentPalette?.isVisible()
    ) {
      return
    }
    this.environmentStampSelection = null
    this.environmentPalette?.clearSelection()
    if (hidePalette) {
      this.environmentPalette?.hide()
    }
    this.restoreEnvironmentStampCanvasMode()
    this.restoreEditorCanvasCursor()
  }

  private restoreEditorCanvasCursor(): void {
    if (this.environmentStampSelection) {
      this.applyEnvironmentStampCursor()
      return
    }
    this.restoreEnvironmentStampCanvasMode()
    this.terrainBrushController.restoreCanvasCursor()
  }

  private applyEnvironmentStampCursor(): void {
    const canvas = this.fabricCanvas
    const selection = this.environmentStampSelection
    if (!canvas || !selection) {
      return
    }
    this.applyEnvironmentStampCanvasMode()
    canvas.defaultCursor = selection.cursor
    canvas.hoverCursor = selection.cursor
    canvas.moveCursor = selection.cursor
    canvas.upperCanvasEl.style.cursor = selection.cursor
    canvas.wrapperEl.style.cursor = selection.cursor
  }

  private applyEnvironmentStampCanvasMode(): void {
    const canvas = this.fabricCanvas
    if (!canvas) {
      return
    }
    if (!this.environmentStampCanvasModeApplied) {
      this.environmentStampPreviousSelection = canvas.selection
      this.environmentStampPreviousSkipTargetFind = canvas.skipTargetFind
      this.environmentStampCanvasModeApplied = true
    }
    canvas.selection = false
    canvas.skipTargetFind = true
  }

  private restoreEnvironmentStampCanvasMode(): void {
    const canvas = this.fabricCanvas
    if (!canvas || !this.environmentStampCanvasModeApplied) {
      return
    }
    canvas.selection = this.environmentStampPreviousSelection
    canvas.skipTargetFind = this.environmentStampPreviousSkipTargetFind
    this.environmentStampCanvasModeApplied = false
  }

  private handleEnvironmentStampPointerDown(
    opt: fabric.TPointerEventInfo
  ): boolean {
    const selection = this.environmentStampSelection
    const canvas = this.fabricCanvas
    if (!selection || !canvas) {
      return false
    }
    const event = opt.e as MouseEvent
    if (event.button !== 0) {
      return false
    }
    const pointer = canvas.getScenePoint(event)
    const envObject = this.environmentStampSpawnScratch
    envObject.type = selection.envType
    envObject.assetId = selection.assetId
    envObject.x = Math.round(pointer.x) * this.invPixelsPerMeter
    envObject.y = Math.round(pointer.y) * this.invPixelsPerMeter
    envObject.seed = this.createEnvironmentSeed()
    const stampOptions = this.environmentPalette.getStampOptions(selection)
    envObject.cellStroke = stampOptions.cellStroke
    envObject.flowerOptions =
      this.environmentPalette.writeFlowerOptionsForStamp(
        selection,
        this.environmentStampFlowerOptionsScratch
      )
        ? this.environmentStampFlowerOptionsScratch
        : undefined
    envObject.keyText = this.environmentPalette.getKeyTextForStamp(selection)
    envObject.keyVariants =
      this.environmentPalette.getKeyVariantsForStamp(selection)
    const marker = this.markerManager.spawnEnvironmentMarker(
      selection.envType,
      envObject,
      { select: false },
      selection.envType === 'custom' ? selection.label : ''
    )
    if (marker) {
      this.setEditorObjectRenderLayer(marker, stampOptions.renderLayer)
      this.applyDepthFilter()
    }
    this.captureHistorySnapshot()
    return true
  }

  private createEnvironmentSeed(): number {
    return (Math.floor(Math.random() * 0x7fffffff) | 1) >>> 0
  }

  private resetDragState() {
    this.objectTreeManager.resetDragState()

    this.objectManager.setDragId(-1)

    this.updateObjectTreeContext()
  }

  // ========================================
  // POLYGON EDITING
  // ========================================

  private setupEditablePolygon(polygon: fabric.Polygon) {
    this.polygonEditor.setupEditablePolygon(polygon)
  }

  private handleEditablePolygonPointerDown(
    opt: fabric.TPointerEventInfo
  ): boolean {
    if (this.objectManager.isObjectLocked(opt.target ?? null)) {
      return false
    }
    return this.polygonEditor.handleEditablePolygonPointerDown(opt)
  }

  private handleObjectModified(target: fabric.Object | null) {
    if (!this.visible || this.currentView !== EditorView.Editor) {
      return
    }
    this.objectManager.resetGroupContainerMoveState(target)
    this.markerManager.refreshEnvironmentMarkerTexture(target)
    this.syncManagedObjectTarget(target)
    if (this.terrainManager.handleModifiedTarget(target)) {
      this.captureHistorySnapshot()
      return
    }
    this.captureHistorySnapshot()
  }

  private handleObjectMoving(target: fabric.Object | null) {
    if (!this.visible || this.currentView !== EditorView.Editor || !target) {
      return
    }
    this.objectManager.handleGroupContainerMoving(target)
    this.terrainManager.handleMovingTarget(target)
    this.syncManagedObjectTarget(target)
  }

  private captureHistorySnapshot() {
    this.lastHistoryWasTree = false
    this.historyManager.capture()
  }

  private normalizeMapSettings(settings: MapSettings | undefined): MapSettings {
    return {
      initialTimePhase: settings?.initialTimePhase ?? DEFAULT_MAP_TIME_PHASE,
    }
  }

  private setMapSettings(
    settings: MapSettings | undefined,
    requestRender: boolean
  ): void {
    this.mapSettings = this.normalizeMapSettings(settings)
    this.applyEditorBackgroundColor(requestRender)
  }

  private isSameMapSettings(a: MapSettings, b: MapSettings): boolean {
    return a.initialTimePhase === b.initialTimePhase
  }

  private async showMapSettingsDialog(): Promise<void> {
    this.menuSystem.hidePanelMenu()
    const nextSettings = await this.propertiesPanel.showMapSettingsDialog(
      this.mapSettings
    )
    if (!nextSettings) {
      return
    }
    const normalized = this.normalizeMapSettings(nextSettings)
    if (this.isSameMapSettings(this.mapSettings, normalized)) {
      return
    }
    this.setMapSettings(normalized, true)
    this.captureHistorySnapshot()
  }

  private setCustomNpcTemplates(templates: MapNpcTemplate[]) {
    this.customNpcTemplates = templates
    this.menuSystem?.refreshCustomNpcTemplates()
  }

  private buildDefaultCustomNpcTemplateName(): string {
    let index = this.customNpcTemplates.length + 1
    while (true) {
      const candidate = localizer
        .t('editor_npc_template_default_name')
        .replace('{0}', String(index))
      if (
        !this.customNpcTemplates.some((template) => template.name === candidate)
      ) {
        return candidate
      }
      index += 1
    }
  }

  private createCustomNpcTemplateId(): string {
    const now = Date.now().toString(36)
    const random = Math.floor(Math.random() * 1e6).toString(36)
    return `npc-template-${now}-${random}`
  }

  private async handleCreateCustomNpcTemplate() {
    const defaultName = this.buildDefaultCustomNpcTemplateName()
    const input = await this.dialogManager.prompt(
      localizer.t('editor_npc_template_create_prompt'),
      defaultName
    )
    if (input === null) {
      return
    }

    const name = input.trim().length > 0 ? input.trim() : defaultName
    const template = await this.propertiesPanel.showNpcTemplateCreationDialog({
      id: this.createCustomNpcTemplateId(),
      name,
    })
    if (!template) {
      return
    }

    this.setCustomNpcTemplates([...this.customNpcTemplates, template])
    this.captureHistorySnapshot()
    await this.persistCurrentMapDataSilently()
  }

  private async handleEditCustomNpcTemplate(templateId: string) {
    const index = this.customNpcTemplates.findIndex(
      (item) => item.id === templateId
    )
    if (index < 0) {
      return
    }

    const currentTemplate = this.customNpcTemplates[index]
    const updatedTemplate =
      await this.propertiesPanel.showNpcTemplateEditDialog(currentTemplate)
    if (!updatedTemplate) {
      return
    }

    const nextTemplates = [...this.customNpcTemplates]
    nextTemplates[index] = updatedTemplate
    this.setCustomNpcTemplates(nextTemplates)
    this.captureHistorySnapshot()
    await this.persistCurrentMapDataSilently()
  }

  private handleCustomNpcTemplateSelected(templateId: string) {
    const template = this.customNpcTemplates.find(
      (item) => item.id === templateId
    )
    if (!template) {
      return
    }
    const spawn = this.consumePanelMenuSpawn()
    const spawnConfig = {
      radius: template.radius,
      bodyHeight: template.bodyHeight,
      bodyProfile: template.bodyProfile,
      moveSpeed: template.moveSpeed,
      attackDesire: template.attackDesire,
      parryProficiency: template.parryProficiency,
      initialPatrolMode: template.initialPatrolMode,
      detectionRangeLevel: template.detectionRangeLevel,
      maxHealth: template.maxHealth,
      maxPosture: template.maxPosture,
      maxToughness: template.maxToughness,
      color: template.color,
      facing: template.facing,
      initialNormalMovesetId: template.initialNormalMovesetId,
      attackMoves: template.attackMoves,
      attackSpeedLevel: template.attackSpeedLevel,
      maxComboCount: template.maxComboCount,
      debugNoDamage: template.debugNoDamage,
      debugNoDeath: template.debugNoDeath,
      redTapeEnabled: template.redTapeEnabled,
      retreatEnabled: template.retreatEnabled,
      retreatDelaySec: template.retreatDelaySec,
      canBeFollower: template.canBeFollower,
      equipWeapon: template.equipWeapon,
      mainWeapon: template.mainWeapon,
      secondaryWeapon: template.secondaryWeapon,
      factionId: template.factionId,
      npcFactions: template.npcFactions,
      allyFactions: template.allyFactions,
    }
    if (spawn) {
      this.markerManager.spawnNpcMarker(template.npcType, {
        ...spawnConfig,
        x: spawn.x * this.invPixelsPerMeter,
        y: spawn.y * this.invPixelsPerMeter,
      })
    } else {
      const viewportCenter = this.getViewportCenter()
      this.markerManager.spawnNpcMarker(template.npcType, {
        ...spawnConfig,
        x: viewportCenter.x * this.invPixelsPerMeter,
        y: viewportCenter.y * this.invPixelsPerMeter,
      })
    }
    this.captureHistorySnapshot()
  }

  private async refreshCustomEnvironmentAssets(): Promise<void> {
    const assets = await listEditorEnvironmentAssets()
    this.customEnvironmentAssets = assets
    this.customEnvironmentAssetsLoaded = true
    this.menuSystem?.refreshCustomEnvironmentAssets()
    this.environmentPalette?.refresh()
  }

  private findCustomEnvironmentAsset(
    assetId: string
  ): MapEnvironmentAsset | null {
    for (let i = 0; i < this.customEnvironmentAssets.length; i++) {
      const asset = this.customEnvironmentAssets[i]
      if (asset.id === assetId) {
        return asset
      }
    }
    return null
  }

  private async handleCustomEnvironmentAssetSelected(
    assetId: string
  ): Promise<void> {
    if (!this.customEnvironmentAssetsLoaded) {
      await this.refreshCustomEnvironmentAssets()
    }
    const asset = this.findCustomEnvironmentAsset(assetId)
    if (!asset) {
      await this.dialogManager.alert(
        localizer.t('editor_environment_asset_missing')
      )
      return
    }
    const runtimeAsset = await ensureRuntimeEnvironmentAsset(assetId)
    if (!runtimeAsset) {
      await this.dialogManager.alert(
        localizer.t('editor_environment_asset_load_failed')
      )
      return
    }

    this.hideAllSubmenus()
    this.menuSystem.hideObjectTypeMenu()
    const spawn = this.consumePanelMenuSpawn()
    if (spawn) {
      this.markerManager.spawnEnvironmentMarker(
        'custom',
        {
          type: 'custom',
          assetId,
          x: spawn.x * this.invPixelsPerMeter,
          y: spawn.y * this.invPixelsPerMeter,
          seed: this.createEnvironmentSeed(),
        },
        {},
        asset.name
      )
    } else {
      this.markerManager.spawnEnvironmentMarker(
        'custom',
        {
          type: 'custom',
          assetId,
          x: this.getViewportCenter().x * this.invPixelsPerMeter,
          y: this.getViewportCenter().y * this.invPixelsPerMeter,
          seed: this.createEnvironmentSeed(),
        },
        {},
        asset.name
      )
    }
    this.captureHistorySnapshot()
  }

  private async handleCreateCustomEnvironmentAsset(): Promise<MapEnvironmentAsset | null> {
    const input = await this.showEnvironmentAssetFormDialog({
      title: localizer.t('editor_environment_asset_create'),
      defaultName: '',
      requireImage: true,
    })
    if (!input) {
      return null
    }
    const runtimeAsset = await createEnvironmentAssetFromImageFile(
      input.name,
      input.file as File
    )
    if (!runtimeAsset) {
      await this.dialogManager.alert(
        localizer.t('editor_environment_asset_save_failed')
      )
      return null
    }
    this.customEnvironmentAssets = [
      ...this.customEnvironmentAssets,
      runtimeAsset.meta,
    ]
    this.customEnvironmentAssetsLoaded = true
    this.menuSystem.refreshCustomEnvironmentAssets()
    this.environmentPalette.refresh()
    return runtimeAsset.meta
  }

  private async showEnvironmentAssetManagerDialog(): Promise<void> {
    await this.refreshCustomEnvironmentAssets()
    let selectedAssetId = this.customEnvironmentAssets[0]?.id ?? ''
    let previewToken = 0

    const container = document.createElement('div')
    container.className = 'editor-custom-asset-dialog'
    container.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })

    const panel = document.createElement('div')
    panel.className = 'editor-asset-manager-panel'

    const title = document.createElement('div')
    title.className = 'editor-custom-asset-title'
    title.textContent = localizer.t('editor_asset_manager')

    const body = document.createElement('div')
    body.className = 'editor-asset-manager-body'

    const list = document.createElement('div')
    list.className = 'editor-asset-manager-list'

    const preview = document.createElement('div')
    preview.className = 'editor-asset-manager-preview'

    const actions = document.createElement('div')
    actions.className =
      'editor-custom-asset-actions editor-asset-manager-actions'

    const createButton = document.createElement('button')
    createButton.className = 'editor-action-btn'
    createButton.type = 'button'
    createButton.textContent = localizer.t('editor_asset_create')

    const confirmButton = document.createElement('button')
    confirmButton.className = 'editor-action-btn'
    confirmButton.type = 'button'
    confirmButton.textContent = localizer.t('editor_btn_confirm')

    actions.appendChild(createButton)
    actions.appendChild(confirmButton)
    body.appendChild(list)
    body.appendChild(preview)
    panel.appendChild(title)
    panel.appendChild(body)
    panel.appendChild(actions)
    container.appendChild(panel)
    this.editorOverlay.appendChild(container)

    const close = () => {
      container.remove()
    }
    confirmButton.addEventListener('click', close)
    createButton.addEventListener('click', async () => {
      const asset = await this.handleCreateCustomEnvironmentAsset()
      if (!asset) {
        return
      }
      selectedAssetId = asset.id
      renderList()
      void renderPreview()
    })

    const renderList = () => {
      list.innerHTML = ''
      if (this.customEnvironmentAssets.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'editor-asset-manager-empty'
        empty.textContent = localizer.t('editor_asset_manager_empty')
        list.appendChild(empty)
        return
      }

      for (let i = 0; i < this.customEnvironmentAssets.length; i++) {
        const asset = this.customEnvironmentAssets[i]
        const item = document.createElement('button')
        item.className = 'editor-asset-manager-item'
        item.type = 'button'
        item.textContent = asset.name
        item.classList.toggle('is-selected', asset.id === selectedAssetId)
        item.addEventListener('click', () => {
          selectedAssetId = asset.id
          renderList()
          void renderPreview()
        })
        list.appendChild(item)
      }
    }

    const renderPreview = async () => {
      const token = previewToken + 1
      previewToken = token
      preview.innerHTML = ''
      const asset = this.findCustomEnvironmentAsset(selectedAssetId)
      if (!asset) {
        const empty = document.createElement('div')
        empty.className = 'editor-asset-manager-empty'
        empty.textContent = localizer.t('editor_asset_manager_empty')
        preview.appendChild(empty)
        return
      }

      const actions = document.createElement('div')
      actions.className = 'editor-asset-manager-preview-actions'

      const editButton = document.createElement('button')
      editButton.className = 'editor-asset-manager-preview-btn'
      editButton.type = 'button'
      editButton.textContent = localizer.t('editor_asset_edit')

      const deleteButton = document.createElement('button')
      deleteButton.className = 'editor-asset-manager-preview-btn'
      deleteButton.type = 'button'
      deleteButton.textContent = localizer.t('editor_asset_delete')

      actions.appendChild(editButton)
      actions.appendChild(deleteButton)
      preview.appendChild(actions)

      const runtimeAsset = await ensureRuntimeEnvironmentAsset(asset.id)
      if (token !== previewToken) {
        return
      }
      if (runtimeAsset) {
        const canvas = document.createElement('canvas')
        canvas.className = 'editor-asset-manager-preview-canvas'
        canvas.width = runtimeAsset.canvas.width
        canvas.height = runtimeAsset.canvas.height
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(runtimeAsset.canvas, 0, 0)
        }
        preview.appendChild(canvas)
      }

      editButton.addEventListener('click', () => {
        void this.handleEditEnvironmentAsset(asset, () => {
          renderList()
          void renderPreview()
        })
      })

      deleteButton.addEventListener('click', () => {
        void this.handleDeleteEnvironmentAsset(asset, async () => {
          await this.refreshCustomEnvironmentAssets()
          selectedAssetId = this.customEnvironmentAssets[0]?.id ?? ''
          renderList()
          void renderPreview()
        })
      })
    }

    container.addEventListener('click', (event) => {
      if (event.target === container) {
        close()
      }
    })
    container.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    })

    renderList()
    void renderPreview()
    panel.tabIndex = 0
    panel.focus()
  }

  private async handleEditEnvironmentAsset(
    asset: MapEnvironmentAsset,
    onDone: () => void
  ): Promise<void> {
    const runtimeAsset = await ensureRuntimeEnvironmentAsset(asset.id)
    const input = await this.showEnvironmentAssetFormDialog({
      title: localizer.t('editor_asset_edit'),
      defaultName: asset.name,
      requireImage: false,
      existingCanvas: runtimeAsset?.canvas ?? null,
    })
    if (!input) {
      return
    }

    const updated = await updateEnvironmentAsset(asset, input.name, input.file)
    if (!updated) {
      await this.dialogManager.alert(
        localizer.t('editor_environment_asset_save_failed')
      )
      return
    }
    await this.refreshCustomEnvironmentAssets()
    this.refreshEnvironmentAssetMarkerTextures(asset.id)
    onDone()
  }

  private async handleDeleteEnvironmentAsset(
    asset: MapEnvironmentAsset,
    onDone: () => void | Promise<void>
  ): Promise<void> {
    const confirmed = await this.dialogManager.confirm(
      localizer.t('editor_asset_delete_confirm').replace('{0}', asset.name)
    )
    if (!confirmed) {
      return
    }
    const deleted = await deleteEnvironmentAsset(asset.id)
    if (!deleted) {
      await this.dialogManager.alert(localizer.t('editor_asset_delete_failed'))
      return
    }
    this.refreshEnvironmentAssetMarkerTextures(asset.id)
    await onDone()
  }

  private refreshEnvironmentAssetMarkerTextures(assetId: string): void {
    const markers = this.markerManager.getEnvironmentMarkers()
    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i].marker
      if (marker.envType === 'custom' && marker.envAssetId === assetId) {
        this.markerManager.refreshEnvironmentMarkerTexture(marker)
      }
    }
    this.fabricCanvas?.requestRenderAll()
  }

  private showEnvironmentAssetFormDialog(options: {
    title: string
    defaultName: string
    requireImage: boolean
    existingCanvas?: HTMLCanvasElement | null
  }): Promise<{
    name: string
    file: File | null
  } | null> {
    return new Promise((resolve) => {
      let selectedFile: File | null = null
      let hasExistingPreview =
        options.existingCanvas instanceof HTMLCanvasElement
      let previewUrl = ''

      const container = document.createElement('div')
      container.className = 'editor-custom-asset-dialog'
      container.addEventListener('pointerdown', (event) => {
        event.stopPropagation()
      })

      const panel = document.createElement('div')
      panel.className = 'editor-custom-asset-panel'

      const title = document.createElement('div')
      title.className = 'editor-custom-asset-title'
      title.textContent = options.title

      const nameLabel = document.createElement('label')
      nameLabel.className = 'editor-custom-asset-label'
      nameLabel.textContent = localizer.t('editor_environment_asset_name')

      const nameInput = document.createElement('input')
      nameInput.className = 'editor-custom-asset-input'
      nameInput.type = 'text'
      nameInput.maxLength = 32
      nameInput.value = options.defaultName

      const uploadLabel = document.createElement('div')
      uploadLabel.className = 'editor-custom-asset-label'
      uploadLabel.textContent = localizer.t('editor_environment_asset_image')

      const uploadArea = document.createElement('button')
      uploadArea.className = 'editor-custom-asset-upload'
      uploadArea.type = 'button'

      const uploadText = document.createElement('span')
      uploadText.textContent = localizer.t('editor_environment_asset_upload')
      uploadArea.appendChild(uploadText)

      const fileInput = document.createElement('input')
      fileInput.type = 'file'
      fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif'
      fileInput.style.display = 'none'

      const error = document.createElement('div')
      error.className = 'editor-custom-asset-error'

      const actions = document.createElement('div')
      actions.className = 'editor-custom-asset-actions'

      const saveButton = document.createElement('button')
      saveButton.className = 'editor-action-btn'
      saveButton.dataset.primary = '1'
      saveButton.textContent = localizer.t('editor_btn_save')

      const cancelButton = document.createElement('button')
      cancelButton.className = 'editor-action-btn'
      cancelButton.textContent = localizer.t('editor_btn_cancel')

      actions.appendChild(saveButton)
      actions.appendChild(cancelButton)
      panel.appendChild(title)
      panel.appendChild(nameLabel)
      panel.appendChild(nameInput)
      panel.appendChild(uploadLabel)
      panel.appendChild(uploadArea)
      panel.appendChild(fileInput)
      panel.appendChild(error)
      panel.appendChild(actions)
      container.appendChild(panel)
      this.editorOverlay.appendChild(container)

      const clearPreview = () => {
        selectedFile = null
        hasExistingPreview = false
        if (previewUrl.length > 0) {
          URL.revokeObjectURL(previewUrl)
          previewUrl = ''
        }
        uploadArea.innerHTML = ''
        uploadArea.classList.remove('has-preview')
        uploadArea.appendChild(uploadText)
        fileInput.value = ''
      }

      const appendRemoveButton = () => {
        const removeButton = document.createElement('button')
        removeButton.className = 'editor-custom-asset-remove'
        removeButton.type = 'button'
        removeButton.textContent = '×'
        removeButton.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          clearPreview()
        })
        uploadArea.appendChild(removeButton)
      }

      const setExistingPreview = (canvas: HTMLCanvasElement) => {
        uploadArea.innerHTML = ''
        uploadArea.classList.add('has-preview')
        const previewCanvas = document.createElement('canvas')
        previewCanvas.className = 'editor-custom-asset-preview'
        previewCanvas.width = canvas.width
        previewCanvas.height = canvas.height
        const ctx = previewCanvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(canvas, 0, 0)
        }
        uploadArea.appendChild(previewCanvas)
        appendRemoveButton()
      }

      const setFile = (file: File) => {
        if (!file.type.startsWith('image/')) {
          error.textContent = localizer.t(
            'editor_environment_asset_image_invalid'
          )
          return
        }
        if (file.size > EDITOR_ENVIRONMENT_ASSET_MAX_FILE_BYTES) {
          error.textContent = localizer.t(
            'editor_environment_asset_image_too_large'
          )
          return
        }
        error.textContent = ''
        clearPreview()
        selectedFile = file
        hasExistingPreview = false
        previewUrl = URL.createObjectURL(file)
        uploadArea.innerHTML = ''
        uploadArea.classList.add('has-preview')

        const preview = document.createElement('img')
        preview.className = 'editor-custom-asset-preview'
        preview.src = previewUrl
        preview.alt = ''

        uploadArea.appendChild(preview)
        appendRemoveButton()
      }

      const close = (result: { name: string; file: File | null } | null) => {
        if (previewUrl.length > 0) {
          URL.revokeObjectURL(previewUrl)
          previewUrl = ''
        }
        container.remove()
        resolve(result)
      }

      container.addEventListener('click', (event) => {
        if (event.target === container) {
          close(null)
        }
      })
      container.addEventListener('keydown', (event) => {
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          close(null)
        }
      })

      uploadArea.addEventListener('click', () => {
        fileInput.click()
      })

      fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0]
        if (file) {
          setFile(file)
        }
      })

      uploadArea.addEventListener('dragover', (event) => {
        event.preventDefault()
        uploadArea.classList.add('is-dragging')
      })

      uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('is-dragging')
      })

      uploadArea.addEventListener('drop', (event) => {
        event.preventDefault()
        uploadArea.classList.remove('is-dragging')
        const file = event.dataTransfer?.files?.[0]
        if (file) {
          setFile(file)
        }
      })

      saveButton.addEventListener('click', () => {
        const name = nameInput.value.trim()
        if (name.length === 0) {
          error.textContent = localizer.t(
            'editor_environment_asset_name_required'
          )
          nameInput.focus()
          return
        }
        if (options.requireImage && !selectedFile) {
          error.textContent = localizer.t(
            'editor_environment_asset_image_required'
          )
          return
        }
        if (!selectedFile && !hasExistingPreview) {
          error.textContent = localizer.t(
            'editor_environment_asset_image_required'
          )
          return
        }
        if (
          selectedFile &&
          selectedFile.size > EDITOR_ENVIRONMENT_ASSET_MAX_FILE_BYTES
        ) {
          error.textContent = localizer.t(
            'editor_environment_asset_image_too_large'
          )
          return
        }
        close({ name, file: selectedFile })
      })

      cancelButton.addEventListener('click', () => {
        close(null)
      })

      nameInput.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          close(null)
        }
      })

      if (options.existingCanvas) {
        setExistingPreview(options.existingCanvas)
      }
      nameInput.focus()
      nameInput.select()
    })
  }

  private acquireTreeEntry(): EditorTreeHistoryEntry {
    const entry = this.treeEntryPool.pop()
    if (entry) {
      entry.id = this.treeNextEntryId
      this.treeNextEntryId += 1
      return entry
    }
    const nextEntry: EditorTreeHistoryEntry = {
      order: [],
      parentIds: [],
      id: this.treeNextEntryId,
    }
    this.treeNextEntryId += 1
    return nextEntry
  }

  private releaseTreeEntry(entry: EditorTreeHistoryEntry) {
    entry.order.length = 0
    entry.parentIds.length = 0
    this.treeEntryPool.push(entry)
  }

  private pushTreeUndoSnapshot() {
    const entry = this.acquireTreeEntry()
    this.objectManager.fillTreeSnapshot(entry.order, entry.parentIds)
    this.treeUndoStack.push(entry)
    if (this.treeUndoStack.length > EDITOR_HISTORY_MAX_ENTRIES) {
      const removed = this.treeUndoStack.shift()
      if (removed) {
        this.releaseTreeEntry(removed)
      }
    }
  }

  private clearTreeRedoStack() {
    while (this.treeRedoStack.length > 0) {
      const entry = this.treeRedoStack.pop()
      if (entry) {
        this.releaseTreeEntry(entry)
      }
    }
  }

  private clearTreeStacks() {
    while (this.treeUndoStack.length > 0) {
      const entry = this.treeUndoStack.pop()
      if (entry) {
        this.releaseTreeEntry(entry)
      }
    }
    this.clearTreeRedoStack()
  }

  private captureTreeHistory() {
    this.pushTreeUndoSnapshot()
    this.clearTreeRedoStack()
    this.lastHistoryWasTree = true
  }

  private resetTreeHistory() {
    this.clearTreeStacks()
    this.pushTreeUndoSnapshot()
    this.lastHistoryWasTree = false
  }

  private undoTreeHistory(): boolean {
    if (!this.lastHistoryWasTree) {
      return false
    }
    if (this.treeUndoStack.length <= 1) {
      return false
    }
    const current = this.treeUndoStack.pop()
    if (!current) {
      return false
    }
    this.treeRedoStack.push(current)
    const previous = this.treeUndoStack[this.treeUndoStack.length - 1]
    if (!previous) {
      return false
    }
    const applied = this.objectManager.applyTreeSnapshot(
      previous.order,
      previous.parentIds
    )
    if (!applied) {
      return false
    }
    this.syncAllManagedGroupTargets()
    this.applyCanvasSelectionFromIds(
      this.objectManager.getSelectedEditorObjectIds()
    )
    return true
  }

  private redoTreeHistory(): boolean {
    if (!this.lastHistoryWasTree) {
      return false
    }
    if (this.treeRedoStack.length === 0) {
      return false
    }
    const entry = this.treeRedoStack.pop()
    if (!entry) {
      return false
    }
    this.treeUndoStack.push(entry)
    const applied = this.objectManager.applyTreeSnapshot(
      entry.order,
      entry.parentIds
    )
    if (!applied) {
      return false
    }
    this.syncAllManagedGroupTargets()
    this.applyCanvasSelectionFromIds(
      this.objectManager.getSelectedEditorObjectIds()
    )
    return true
  }

  private hasUnsavedChanges(): boolean {
    if (this.currentView !== EditorView.Editor) {
      return false
    }
    return this.historyManager.getCurrentEntryId() !== this.lastSavedHistoryId
  }

  private async confirmExitWithUnsavedChanges() {
    if (this.currentView !== EditorView.Editor) {
      return
    }
    const result = await this.dialogManager.confirmWithCancel(
      localizer.t('editor_confirm_exit_unsaved'),
      localizer.t('editor_btn_save'),
      localizer.t('editor_btn_discard'),
      localizer.t('editor_btn_cancel')
    )
    if (result === 'dismiss') {
      return
    }
    if (result === 'confirm') {
      const saved = await this.saveCurrentMap()
      if (!saved) {
        return
      }
    }
    this.showMapListView()
  }

  private async saveCurrentMap(): Promise<boolean> {
    const data = this.mapSerializer.serializeCurrentMapData({
      shareTerrainData: true,
    })
    const meta = await this.mapListManager.ensureMapMeta(data)
    if (!meta) {
      return false
    }

    this.dialogManager.showLoading(localizer.t('editor_saving'))

    try {
      const thumbnail = await this.thumbnailCapture.captureMap(data, {
        preferPreview: true,
      })
      if (thumbnail) {
        meta.thumbnail = thumbnail
      }

      const savedMeta = await saveEditorMap(meta, data)
      this.dialogManager.hideLoading()

      if (!savedMeta) {
        await this.dialogManager.alert(localizer.t('editor_save_failed'))
        return false
      }
      this.currentMapMeta = savedMeta
      this.lastSavedHistoryId = this.historyManager.getCurrentEntryId()
      this.mapListManager.refreshMapMetas()
      if (savedMeta.isDefault && this.onDefaultMapChangedCallback) {
        this.onDefaultMapChangedCallback(savedMeta)
      }
      await this.dialogManager.alert(localizer.t('editor_save_success'))
      return true
    } catch (error) {
      this.dialogManager.hideLoading()
      await this.dialogManager.alert(localizer.t('editor_save_failed'))
      console.error('[editor] save error', error)
      return false
    }
  }

  private async refreshCurrentMapThumbnail(): Promise<void> {
    const meta = this.currentMapMeta
    if (!meta) {
      return
    }
    const data = this.mapSerializer.serializeCurrentMapData({
      shareTerrainData: true,
    })
    const thumbnail = await this.thumbnailCapture.captureMap(data, {
      preferPreview: false,
    })
    if (!thumbnail || this.currentMapMeta?.id !== meta.id) {
      return
    }
    meta.thumbnail = thumbnail
    this.mapListManager.refreshMapMetas()
  }

  private async persistCurrentMapDataSilently(): Promise<boolean> {
    const data = this.mapSerializer.serializeCurrentMapData({
      shareTerrainData: true,
    })
    const meta = await this.mapListManager.ensureMapMeta(data)
    if (!meta) {
      return false
    }

    try {
      const savedMeta = await saveEditorMap(meta, data)
      if (!savedMeta) {
        await this.dialogManager.alert(localizer.t('editor_save_failed'))
        return false
      }
      this.currentMapMeta = savedMeta
      this.lastSavedHistoryId = this.historyManager.getCurrentEntryId()
      this.mapListManager.refreshMapMetas()
      if (savedMeta.isDefault && this.onDefaultMapChangedCallback) {
        this.onDefaultMapChangedCallback(savedMeta)
      }
      return true
    } catch (error) {
      await this.dialogManager.alert(localizer.t('editor_save_failed'))
      console.error('[editor] silent save error', error)
      return false
    }
  }

  private getMapSnapshot(): EditorMapData {
    return this.mapSerializer.serializeCurrentMapData()
  }

  private applyMapSnapshot(data: EditorMapData) {
    this.historyManager.setSuspended(true)
    this.mapSerializer.applyMapData(data)
    this.historyManager.setSuspended(false)
    this.applyEditorTreeData(data)
    this.resetTreeHistory()
  }

  private applyEditorTreeData(data: EditorMapData) {
    const tree = data.editorTree
    if (!tree || tree.nodes.length === 0) {
      this.renderObjectTree()
      return
    }
    if (tree.nodes.length !== tree.parents.length) {
      return
    }
    const editorObjects = this.objectManager.getEditorObjects()
    if (editorObjects.length === 0) {
      return
    }

    const terrainObjects: EditorObjectData[] = []
    const referenceLineObjects: EditorObjectData[] = []
    const npcObjects: EditorObjectData[] = []
    const weaponObjects: EditorObjectData[] = []
    const checkpointObjects: EditorObjectData[] = []
    const hookAnchorObjects: EditorObjectData[] = []
    const sunPickupObjects: EditorObjectData[] = []
    const expOrbObjects: EditorObjectData[] = []
    const attackPickupObjects: EditorObjectData[] = []
    const environmentObjects: EditorObjectData[] = []
    let playerObject: EditorObjectData | null = null
    let cameraObject: EditorObjectData | null = null

    for (let i = 0; i < editorObjects.length; i++) {
      const dataItem = editorObjects[i]
      if (dataItem.type === ObjectType.Terrain) {
        terrainObjects.push(dataItem)
      } else if (dataItem.type === ObjectType.ReferenceLine) {
        referenceLineObjects.push(dataItem)
      } else if (dataItem.type === ObjectType.Npc) {
        npcObjects.push(dataItem)
      } else if (dataItem.type === ObjectType.Weapon) {
        weaponObjects.push(dataItem)
      } else if (dataItem.type === ObjectType.Checkpoint) {
        checkpointObjects.push(dataItem)
      } else if (dataItem.type === ObjectType.HookAnchor) {
        hookAnchorObjects.push(dataItem)
      } else if (
        dataItem.type === ObjectType.SunPickupSmall ||
        dataItem.type === ObjectType.SunPickupLarge
      ) {
        sunPickupObjects.push(dataItem)
      } else if (dataItem.type === ObjectType.ExpOrb) {
        expOrbObjects.push(dataItem)
      } else if (dataItem.type === ObjectType.AttackPickup) {
        attackPickupObjects.push(dataItem)
      } else if (this.isEnvironmentStampObjectType(dataItem.type)) {
        environmentObjects.push(dataItem)
      } else if (dataItem.type === ObjectType.Player) {
        playerObject = dataItem
      } else if (dataItem.type === ObjectType.Camera) {
        cameraObject = dataItem
      }
    }

    const resolved: EditorObjectData[] = []
    const resolvedIdSet = new Set<number>()
    for (let i = 0; i < tree.nodes.length; i++) {
      const node = tree.nodes[i]
      let resolvedData: EditorObjectData | null = null
      if (node.type === 'empty') {
        const group = this.createEmptyNode(0, 0, node.isGroupContainer === true)
        if (group) {
          this.fabricCanvas?.add(group)
          resolvedData = this.objectManager.registerEditorObject(
            ObjectType.Empty,
            group
          )
        }
      } else if (node.type === 'terrain') {
        const index = node.index ?? -1
        resolvedData =
          index >= 0 && index < terrainObjects.length
            ? terrainObjects[index]
            : null
      } else if (node.type === 'referenceLine') {
        const index = node.index ?? -1
        resolvedData =
          index >= 0 && index < referenceLineObjects.length
            ? referenceLineObjects[index]
            : null
      } else if (node.type === 'npc' || node.type === 'enemy') {
        const index = node.index ?? -1
        resolvedData =
          index >= 0 && index < npcObjects.length ? npcObjects[index] : null
      } else if (node.type === 'weapon') {
        const index = node.index ?? -1
        resolvedData =
          index >= 0 && index < weaponObjects.length
            ? weaponObjects[index]
            : null
      } else if (node.type === 'checkpoint') {
        const index = node.index ?? -1
        resolvedData =
          index >= 0 && index < checkpointObjects.length
            ? checkpointObjects[index]
            : null
      } else if (node.type === 'hookAnchor') {
        const index = node.index ?? -1
        resolvedData =
          index >= 0 && index < hookAnchorObjects.length
            ? hookAnchorObjects[index]
            : null
      } else if (
        node.type === 'sunPickupSmall' ||
        node.type === 'sunPickupLarge'
      ) {
        const index = node.index ?? -1
        resolvedData =
          index >= 0 && index < sunPickupObjects.length
            ? sunPickupObjects[index]
            : null
      } else if (node.type === 'expOrb') {
        const index = node.index ?? -1
        resolvedData =
          index >= 0 && index < expOrbObjects.length
            ? expOrbObjects[index]
            : null
      } else if (node.type === 'attackPickup') {
        const index = node.index ?? -1
        resolvedData =
          index >= 0 && index < attackPickupObjects.length
            ? attackPickupObjects[index]
            : null
      } else if (
        node.type === 'envTree' ||
        node.type === 'envHill' ||
        node.type === 'envHouse' ||
        node.type === 'envCrate' ||
        node.type === 'envGrass' ||
        node.type === 'envFlower' ||
        node.type === 'envCloud' ||
        node.type === 'envKey' ||
        node.type === 'envCustom'
      ) {
        const index = node.index ?? -1
        resolvedData =
          index >= 0 && index < environmentObjects.length
            ? environmentObjects[index]
            : null
      } else if (node.type === 'player') {
        resolvedData = playerObject
      } else if (node.type === 'camera') {
        resolvedData = cameraObject
      }

      if (!resolvedData) {
        return
      }
      if (
        node.name &&
        node.name.length > 0 &&
        !(
          resolvedData.type === ObjectType.Weapon &&
          this.objectManager.isLegacyDefaultName(ObjectType.Weapon, node.name)
        )
      ) {
        resolvedData.name = node.name
      }
      this.setEditorObjectRenderLayer(
        resolvedData.object,
        typeof node.renderLayer === 'number' ? node.renderLayer : undefined
      )
      resolvedData.isLocked = node.isLocked === true
      resolvedData.isVisible = node.isVisible !== false
      resolved.push(resolvedData)
      resolvedIdSet.add(resolvedData.id)
    }

    for (let i = 0; i < editorObjects.length; i++) {
      const dataItem = editorObjects[i]
      if (resolvedIdSet.has(dataItem.id)) {
        continue
      }
      resolved.push(dataItem)
    }

    const order: number[] = new Array(resolved.length)
    const parentIds: number[] = new Array(resolved.length)
    for (let i = 0; i < resolved.length; i++) {
      order[i] = resolved[i].id
      parentIds[i] = -1
    }
    for (let i = 0; i < tree.parents.length; i++) {
      const parentIndex = tree.parents[i]
      if (parentIndex >= 0 && parentIndex < resolved.length) {
        parentIds[i] = resolved[parentIndex].id
      }
    }
    this.objectManager.applyTreeSnapshot(order, parentIds)
    this.objectManager.applyObjectLockStates()
    this.syncAllManagedGroupTargets()
    this.applyDepthFilter()
  }

  private nudgeSelectedObject(dx: number, dy: number) {
    const canvas = this.fabricCanvas
    if (!canvas) {
      return
    }
    const active = (canvas.getActiveObject() ?? null) as fabric.Object | null
    if (!active || !this.objectManager.getEditorObjectMap().has(active)) {
      return
    }
    if (
      this.objectManager.isObjectLocked(active) ||
      (active instanceof fabric.ActiveSelection &&
        this.selectionContainsLockedObject(active.getObjects()))
    ) {
      return
    }
    if (this.terrainManager.isTerrainProxy(active)) {
      if (this.terrainManager.moveProxyByUnitDelta(active, dx, dy)) {
        this.captureHistorySnapshot()
      }
      return
    }
    if (this.terrainManager.isTerrainContourProxy(active)) {
      if (this.terrainManager.moveContourByUnitDelta(active, dx, dy)) {
        this.captureHistorySnapshot()
      }
      return
    }
    if (active instanceof fabric.ActiveSelection) {
      if (this.terrainManager.moveSelectionByUnitDelta(active, dx, dy)) {
        this.captureHistorySnapshot()
        return
      }
    }
    const currentLeft = Math.round(active.left ?? 0)
    const currentTop = Math.round(active.top ?? 0)
    const nextLeft = currentLeft + dx
    const nextTop = currentTop + dy
    if (nextLeft === currentLeft && nextTop === currentTop) {
      return
    }
    active.left = nextLeft
    active.top = nextTop
    active.setCoords()
    if (this.cameraManager.isCameraFrame(active)) {
      const data = this.cameraManager.getCameraViewMap().get(active)
      if (data) {
        this.cameraManager.syncCameraIcon(data)
      }
    }
    canvas.requestRenderAll()
    this.captureHistorySnapshot()
  }

  // ========================================
  // MENU SYSTEM
  // ========================================

  private handleEditablePolygonContextMenu(
    opt: fabric.TPointerEventInfo<MouseEvent>
  ) {
    if (!this.fabricCanvas) {
      return
    }
    this.contextMenu.hide()
    const evt = opt.e
    const target = opt.target ?? null
    this.handleEditablePolygonContextMenuCore(evt, target)
  }

  private handleEditablePolygonContextMenuEvent(event: MouseEvent) {
    if (!this.fabricCanvas) {
      return
    }
    this.pendingTerrainContourFillTarget = null
    this.contextMenu.hide()
    const targetInfo = this.fabricCanvas.findTarget(event)
    const target =
      targetInfo.target ??
      targetInfo.currentContainer ??
      targetInfo.container ??
      null
    const selectedIds = this.objectManager.getSelectedEditorObjectIds()
    if (selectedIds.length > 1 && target) {
      const isActiveSelection = target instanceof fabric.ActiveSelection
      const targetData = isActiveSelection
        ? null
        : this.objectManager.getEditorObjectMap().get(target)
      const targetInSelection = targetData
        ? selectedIds.includes(targetData.id)
        : false
      if (isActiveSelection || targetInSelection) {
        this.showMultiSelectContextMenu(event.clientX, event.clientY)
        return
      }
    }
    const handled = this.handleEditablePolygonContextMenuCore(event, target)
    if (handled) {
      return
    }
    if (target && this.isDeletableShape(target)) {
      this.showShapeContextMenu(target, event.clientX, event.clientY)
      return
    }
    if (!target) {
      this.setPanelMenuSpawnFromEvent(event)
      this.menuSystem.setPanelMenuPasteEnabled(this.clipboardManager.hasData())
      this.menuSystem.showPanelMenu(event.clientX, event.clientY)
    }
  }

  private handleEditablePolygonContextMenuCore(
    event: MouseEvent,
    target: fabric.Object | null
  ) {
    if (
      this.isTerrainContourProxy(target) &&
      this.objectManager.isObjectLocked(target)
    ) {
      return false
    }
    const contourMenu = this.terrainManager.getContourContextMenuRequest(
      target,
      event
    )
    if (contourMenu) {
      this.showPolygonMenuWithActions(
        contourMenu.actions,
        contourMenu.target,
        contourMenu.pointIndex,
        event.clientX,
        event.clientY,
        contourMenu.insertX,
        contourMenu.insertY
      )
      return true
    }
    if (!this.fabricCanvas) {
      return false
    }
    const polygon = this.isEditablePolygon(target)
      ? target
      : (this.fabricCanvas.getActiveObject() as EditablePolygon | null)
    if (
      !this.isEditablePolygon(polygon) ||
      !polygon.canvas ||
      !polygon.points
    ) {
      return false
    }
    if (this.objectManager.isObjectLocked(polygon)) {
      return false
    }
    const pointer = polygon.canvas.getScenePoint(event)
    const scratchPoint = this.polygonEditor.getScratchPoint()
    this.polygonEditor.setLocalPointFromCanvas(
      polygon,
      pointer.x,
      pointer.y,
      scratchPoint
    )
    const pointX = scratchPoint.x + polygon.pathOffset.x
    const pointY = scratchPoint.y + polygon.pathOffset.y
    const pointIndex = this.polygonEditor.findNearestPointIndexWithin(
      polygon.points,
      pointX,
      pointY,
      144
    )
    if (pointIndex !== -1) {
      if (polygon.points.length <= 3) {
        return false
      }
      this.showPolygonMenuWithActions(
        ['remove'],
        polygon,
        pointIndex,
        event.clientX,
        event.clientY
      )
      return true
    }
    const scratchPointB = this.polygonEditor.getScratchPointB()
    const edgeIndex = this.polygonEditor.findNearestEdgeProjection(
      polygon.points,
      pointX,
      pointY,
      scratchPointB
    )
    const edgeDx = pointX - scratchPointB.x
    const edgeDy = pointY - scratchPointB.y
    if (edgeDx * edgeDx + edgeDy * edgeDy > 196) {
      return false
    }
    this.showPolygonMenuWithActions(
      ['add'],
      polygon,
      edgeIndex,
      event.clientX,
      event.clientY,
      scratchPointB.x,
      scratchPointB.y
    )
    return true
  }

  // ========================================
  // POLYGON EDITING
  // ========================================

  private isEditablePolygon(
    object: fabric.Object | null
  ): object is EditablePolygon {
    return this.polygonEditor.isEditablePolygon(object)
  }

  // ========================================
  // SHAPE MANAGEMENT
  // ========================================

  private isDeletableShape(object: fabric.Object) {
    if (this.terrainManager.isTerrainContourProxy(object)) {
      return true
    }
    if (this.terrainManager.isTerrainProxy(object)) {
      return true
    }
    if (this.cameraManager.isCameraFrame(object)) {
      return true
    }
    if (this.markerManager.isPlayerMarker(object)) {
      return true
    }
    if (this.markerManager.isNpcMarker(object)) {
      return true
    }
    if (this.markerManager.isWeaponMarker(object)) {
      return true
    }
    if (this.markerManager.isCheckpointMarker(object)) {
      return true
    }
    if (this.markerManager.isSunPickupMarker(object)) {
      return true
    }
    if (this.markerManager.isExpOrbMarker(object)) {
      return true
    }
    if (this.markerManager.isHookAnchorMarker(object)) {
      return true
    }
    if (this.markerManager.isEnvironmentMarker(object)) {
      return true
    }
    if (this.isEmptyObject(object)) {
      return true
    }
    return (
      object.type === 'rect' ||
      object.type === 'circle' ||
      object.type === 'polygon'
    )
  }

  // ========================================
  // MENU SYSTEM
  // ========================================

  private showShapeContextMenu(
    target: fabric.Object,
    clientX: number,
    clientY: number
  ) {
    if (this.objectManager.isObjectLocked(target)) {
      this.showPolygonMenuWithActions(['unlock'], target, -1, clientX, clientY)
      return
    }
    if (this.terrainManager.isTerrainContourProxy(target)) {
      const actions: ContextMenuAction[] = []
      if (!this.terrainManager.isReferenceLineProxy(target)) {
        actions.push('fill', 'terrainProperties')
      }
      actions.push('commonProperties', 'rename', 'lock', 'delete')
      this.showPolygonMenuWithActions(actions, target, -1, clientX, clientY)
      return
    }
    if (this.terrainManager.isTerrainProxy(target)) {
      this.showPolygonMenuWithActions(
        [
          'copy',
          'paste',
          'terrainProperties',
          'commonProperties',
          'rename',
          'lock',
          'delete',
        ],
        target,
        -1,
        clientX,
        clientY
      )
      return
    }
    if (this.cameraManager.isCameraFrame(target)) {
      this.showPolygonMenuWithActions(
        [
          'copy',
          'paste',
          'zoom',
          'reset',
          'commonProperties',
          'rename',
          'lock',
          'delete',
        ],
        target,
        -1,
        clientX,
        clientY
      )
      return
    }
    if (this.markerManager.isPlayerMarker(target)) {
      this.showPolygonMenuWithActions(
        [
          'copy',
          'paste',
          'properties',
          'commonProperties',
          'rename',
          'lock',
          'delete',
        ],
        target,
        -1,
        clientX,
        clientY
      )
      return
    }
    if (this.markerManager.isNpcMarker(target)) {
      this.showPolygonMenuWithActions(
        [
          'copy',
          'paste',
          'properties',
          'commonProperties',
          'rename',
          'lock',
          'delete',
        ],
        target,
        -1,
        clientX,
        clientY
      )
      return
    }
    if (this.markerManager.isWeaponMarker(target)) {
      this.showPolygonMenuWithActions(
        [
          'copy',
          'paste',
          'properties',
          'commonProperties',
          'rename',
          'lock',
          'delete',
        ],
        target,
        -1,
        clientX,
        clientY
      )
      return
    }
    if (this.isGroupContainer(target)) {
      this.showPolygonMenuWithActions(
        [
          'copy',
          'paste',
          'ungroup',
          'commonProperties',
          'rename',
          'lock',
          'delete',
        ],
        target,
        -1,
        clientX,
        clientY
      )
      return
    }
    if (this.isEmptyObject(target)) {
      const actions: ContextMenuAction[] = [
        'copy',
        'paste',
        'commonProperties',
        'rename',
      ]
      if (this.shouldShowConvertGroupAction(target)) {
        actions.push('convertGroup')
      }
      actions.push('lock')
      actions.push('delete')
      this.showPolygonMenuWithActions(actions, target, -1, clientX, clientY)
      return
    }
    if (this.markerManager.isCheckpointMarker(target)) {
      this.showPolygonMenuWithActions(
        [
          'copy',
          'paste',
          'terrainProperties',
          'commonProperties',
          'rename',
          'lock',
          'delete',
        ],
        target,
        -1,
        clientX,
        clientY
      )
      return
    }
    if (this.markerManager.isEnvironmentMarker(target)) {
      const actions: ContextMenuAction[] = ['copy', 'paste']
      if (target.envType === 'key') {
        actions.push('properties')
      }
      if (this.markerManager.isProceduralCellStrokeSupported(target)) {
        actions.push('terrainProperties')
      }
      actions.push('commonProperties', 'rename', 'lock', 'delete')
      this.showPolygonMenuWithActions(actions, target, -1, clientX, clientY)
      return
    }
    if (this.markerManager.isHookAnchorMarker(target)) {
      this.showPolygonMenuWithActions(
        ['copy', 'paste', 'commonProperties', 'rename', 'lock', 'delete'],
        target,
        -1,
        clientX,
        clientY
      )
      return
    }
    if (
      this.markerManager.isSunPickupMarker(target) ||
      this.markerManager.isExpOrbMarker(target)
    ) {
      this.showPolygonMenuWithActions(
        ['copy', 'paste', 'commonProperties', 'rename', 'lock', 'delete'],
        target,
        -1,
        clientX,
        clientY
      )
      return
    }
    if (target.type === 'rect') {
      this.showPolygonMenuWithActions(
        [
          'copy',
          'paste',
          'commonProperties',
          'rename',
          'reset',
          'square',
          'lock',
          'delete',
        ],
        target,
        -1,
        clientX,
        clientY
      )
      return
    }
    if (this.isTriangleShape(target)) {
      this.showPolygonMenuWithActions(
        [
          'copy',
          'paste',
          'commonProperties',
          'rename',
          'reset',
          'equilateral',
          'lock',
          'delete',
        ],
        target,
        -1,
        clientX,
        clientY
      )
      return
    }
    this.showPolygonMenuWithActions(
      [
        'copy',
        'paste',
        'commonProperties',
        'rename',
        'reset',
        'lock',
        'delete',
      ],
      target,
      -1,
      clientX,
      clientY
    )
  }

  // ========================================
  // SHAPE MANAGEMENT
  // ========================================

  private isTriangleShape(object: fabric.Object) {
    const data = this.shapeManager.getShapeResetData(object)
    return data?.kind === 'triangle'
  }

  private isEmptyObject(object: fabric.Object) {
    const data = this.objectManager.getEditorObjectMap().get(object)
    return data?.type === ObjectType.Empty
  }

  private isTerrainProxy(
    object: fabric.Object | null
  ): object is TerrainRegionProxy {
    return this.terrainManager.isTerrainProxy(object)
  }

  private isTerrainContourProxy(
    object: fabric.Object | null
  ): object is TerrainContourProxy {
    return this.terrainManager.isTerrainContourProxy(object)
  }

  private createEmptyNode(
    centerX: number,
    centerY: number,
    isGroupContainer = false
  ): EditorEmptyObject & EditorLayeredObject {
    const group = new fabric.Group([], {
      originX: 'center',
      originY: 'center',
      selectable: true,
      hasControls: false,
      lockRotation: true,
      lockScalingX: true,
      lockScalingY: true,
      objectCaching: false,
      subTargetCheck: true,
      interactive: true,
    }) as EditorEmptyObject & EditorLayeredObject
    group.left = centerX
    group.top = centerY
    group.setCoords()
    group.editorShape = 'editor-empty'
    group.isGroupContainer = isGroupContainer
    group.renderLayer = this.getEditorObjectDefaultRenderLayer()
    return group
  }

  private syncManagedObjectTarget(target: fabric.Object | null) {
    if (!target) {
      return
    }
    if (this.cameraManager.isCameraFrame(target)) {
      const data = this.cameraManager.getCameraViewMap().get(target)
      if (data) {
        this.cameraManager.syncCameraIcon(data)
      }
      return
    }
    if (!this.isGroupContainer(target)) {
      return
    }
    const children = target.getObjects()
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      if (!this.cameraManager.isCameraFrame(child)) {
        continue
      }
      const data = this.cameraManager.getCameraViewMap().get(child)
      if (data) {
        this.cameraManager.syncCameraIcon(data)
      }
    }
  }

  private syncAllManagedGroupTargets() {
    const editorObjects = this.objectManager.getEditorObjects()
    for (let i = 0; i < editorObjects.length; i++) {
      this.syncManagedObjectTarget(editorObjects[i].object)
    }
  }

  private isGroupContainer(
    object: fabric.Object | null
  ): object is EditorEmptyObject {
    if (!object) {
      return false
    }
    const emptyObject = object as fabric.Object & Partial<EditorEmptyObject>
    return (
      emptyObject.editorShape === 'editor-empty' &&
      emptyObject.isGroupContainer === true
    )
  }

  // ========================================
  // MENU SYSTEM
  // ========================================

  private showMultiSelectContextMenu(clientX: number, clientY: number) {
    const selectedIds = this.objectManager.getSelectedEditorObjectIds()
    let menuTarget: fabric.Object | null = null
    for (let i = 0; i < selectedIds.length; i++) {
      const d = this.objectManager.getEditorObjectById(selectedIds[i])
      if (!d) continue
      if (menuTarget === null) menuTarget = d.object
      if (this.clipboardManager.canCopy(d.object)) {
        menuTarget = d.object
        break
      }
    }
    if (!menuTarget) return
    const actions: ContextMenuAction[] = []
    if (this.shouldShowGroupAction()) {
      actions.push('group')
    }
    actions.push('copy')
    actions.push('commonProperties')
    actions.push('delete')
    this.contextMenu.show(actions, menuTarget, -1, clientX, clientY)
  }

  private canGroupCurrentSelection(): boolean {
    const selectedIds = this.objectManager.getSelectedEditorObjectIds()
    return (
      this.objectManager.canGroupObjects(selectedIds) &&
      this.getCommonObjectRenderLayer(selectedIds) !== null
    )
  }

  private shouldShowConvertGroupAction(target: fabric.Object): boolean {
    const data = this.objectManager.getEditorObjectMap().get(target)
    if (
      !data ||
      data.type !== ObjectType.Empty ||
      this.isGroupContainer(target)
    ) {
      return false
    }
    let childCount = 0
    for (let i = 0; i < this.objectManager.getEditorObjects().length; i++) {
      const childData = this.objectManager.getEditorObjects()[i]
      if (childData.parentId !== data.id) {
        continue
      }
      childCount += 1
      if (childCount >= 2) {
        return true
      }
    }
    return false
  }

  private shouldShowGroupAction(): boolean {
    const selectedIds = this.objectManager.getSelectedEditorObjectIds()
    if (selectedIds.length < 2) {
      return false
    }
    let sharedParentId: number | null | undefined
    for (let i = 0; i < selectedIds.length; i++) {
      const data = this.objectManager.getEditorObjectById(selectedIds[i])
      if (!data) {
        return false
      }
      if (sharedParentId === undefined) {
        sharedParentId = data.parentId
        continue
      }
      if (sharedParentId !== data.parentId) {
        return false
      }
    }
    return true
  }

  private isContextMenuActionDisabled(action: ContextMenuAction): boolean {
    const target = this.contextMenu.getTarget()
    const selectedIds = this.objectManager.getSelectedEditorObjectIds()
    const hasLockedSelection = this.isSelectionLocked()
    if (action === 'unlock') {
      return !target || !this.objectManager.isObjectLocked(target)
    }
    if (action === 'lock') {
      return !target || this.objectManager.isObjectLocked(target)
    }
    if (target && this.objectManager.isObjectLocked(target)) {
      return true
    }
    if (selectedIds.length > 1) {
      if (
        action === 'copy' ||
        action === 'delete' ||
        action === 'group' ||
        action === 'commonProperties'
      ) {
        return hasLockedSelection
      }
    }
    if (action === 'delete' && target) {
      const targetId = this.objectManager.getEditorObjectMap().get(target)?.id
      return (
        targetId === undefined ||
        this.objectManager.hasLockedObjects([targetId])
      )
    }
    if (action === 'group') {
      return !this.canGroupCurrentSelection()
    }
    if (action === 'convertGroup') {
      return !target || !this.objectManager.canConvertEmptyObjectToGroup(target)
    }
    return false
  }

  private getObjectsByIds(ids: number[]): fabric.Object[] {
    const result: fabric.Object[] = []
    for (let i = 0; i < ids.length; i++) {
      const d = this.objectManager.getEditorObjectById(ids[i])
      if (d) result.push(d.object)
    }
    return result
  }

  private getEditorObjectRenderLayer(target: fabric.Object): number {
    const terrainRenderLayer = this.terrainManager.getProxyRenderLayer(target)
    if (terrainRenderLayer !== null) {
      return normalizeRenderLayer(terrainRenderLayer, terrainRenderLayer)
    }
    return normalizeRenderLayer(
      (target as EditorLayeredObject).renderLayer,
      getDefaultShapeRenderLayer()
    )
  }

  private setEditorObjectRenderLayer(
    target: fabric.Object,
    renderLayer: number | undefined
  ): boolean {
    const terrainRenderLayer = this.terrainManager.getProxyRenderLayer(target)
    if (terrainRenderLayer !== null) {
      const nextRenderLayer = normalizeRenderLayer(
        renderLayer,
        terrainRenderLayer
      )
      const changed = this.terrainManager.setProxyRenderLayer(
        target,
        nextRenderLayer
      )
      if (changed) this.reorderCanvasObjects()
      return changed
    }
    const nextRenderLayer = normalizeRenderLayer(
      renderLayer,
      getDefaultShapeRenderLayer()
    )
    const layeredTarget = target as EditorLayeredObject
    const currentRenderLayer = normalizeRenderLayer(
      layeredTarget.renderLayer,
      getDefaultShapeRenderLayer()
    )
    if (currentRenderLayer === nextRenderLayer) {
      layeredTarget.renderLayer = nextRenderLayer
      return false
    }
    layeredTarget.renderLayer = nextRenderLayer
    this.reorderCanvasObjects()
    return true
  }

  private reorderCanvasObjects(): void {
    this.objectManager.applyEditorObjectStacking()
  }

  private buildDeleteConfirmMessage(ids: readonly number[]): string {
    const topLevelIds = this.objectManager.getTopLevelObjectIds(ids)
    const subtreeIds = this.objectManager.getSubtreeObjectIds(ids)
    const rootCount = topLevelIds.length
    const totalCount = subtreeIds.length
    if (totalCount > rootCount) {
      return localizer
        .t('editor_confirm_delete_with_children')
        .replace('{0}', String(rootCount))
        .replace('{1}', String(totalCount - rootCount))
    }
    return rootCount > 1
      ? localizer
          .t('editor_confirm_delete_multiple')
          .replace('{0}', String(rootCount))
      : localizer.t('editor_confirm_delete_shape')
  }

  private deleteObjectsWithChildren(ids: readonly number[]): boolean {
    const canvas = this.fabricCanvas
    if (!canvas || ids.length === 0) {
      return false
    }
    if (this.objectManager.hasLockedObjects(ids)) {
      return false
    }
    const subtreeIds = this.objectManager.getSubtreeObjectIds(ids)
    if (subtreeIds.length === 0) {
      return false
    }
    canvas.discardActiveObject()
    const terrainTargets: fabric.Object[] = []
    for (let i = subtreeIds.length - 1; i >= 0; i--) {
      const data = this.objectManager.getEditorObjectById(subtreeIds[i])
      if (!data) {
        continue
      }
      const target = data.object
      if (this.isTerrainContourProxy(target)) {
        terrainTargets.push(target)
        continue
      }
      if (this.isTerrainProxy(target)) {
        terrainTargets.push(target)
        continue
      }
      if (this.cameraManager.isCameraFrame(target)) {
        this.cameraManager.removeCameraView(target)
      }
      if (this.markerManager.isPlayerMarker(target)) {
        this.markerManager.removePlayerMarker(target)
      }
      if (this.markerManager.isNpcMarker(target)) {
        this.markerManager.removeNpcMarker(target)
      }
      if (this.markerManager.isCheckpointMarker(target)) {
        this.markerManager.removeCheckpointMarker(target)
      }
      if (this.markerManager.isSunPickupMarker(target)) {
        this.markerManager.removeSunPickupMarker(target)
      }
      if (this.markerManager.isExpOrbMarker(target)) {
        this.markerManager.removeExpOrbMarker(target)
      }
      if (this.markerManager.isAttackPickupMarker(target)) {
        this.markerManager.removeAttackPickupMarker(target)
      }
      if (this.markerManager.isHookAnchorMarker(target)) {
        this.markerManager.removeHookAnchorMarker(target)
      }
      if (this.markerManager.isEnvironmentMarker(target)) {
        this.markerManager.removeEnvironmentMarker(target)
      }
      this.objectManager.unregisterEditorObject(target)
      canvas.remove(target)
      this.shapeManager.deleteShapeResetData(target)
    }
    if (terrainTargets.length > 0) {
      this.terrainManager.deleteProxyObjects(terrainTargets)
    }
    canvas.requestRenderAll()
    return true
  }

  private async handleBatchDelete(ids: number[]) {
    const canvas = this.fabricCanvas
    if (!canvas) return
    const confirmed = await this.dialogManager.confirm(
      this.buildDeleteConfirmMessage(ids)
    )
    if (!confirmed) {
      this.contextMenu.hide()
      return
    }
    const changed = this.deleteObjectsWithChildren(ids)
    this.contextMenu.hide()
    if (changed) {
      this.captureHistorySnapshot()
    }
  }

  private showPolygonMenuWithActions(
    actions: ContextMenuAction[],
    target: EditablePolygon | fabric.Object,
    index: number,
    clientX: number,
    clientY: number,
    insertX?: number,
    insertY?: number
  ) {
    this.contextMenu.show(
      actions,
      target,
      index,
      clientX,
      clientY,
      insertX,
      insertY
    )
  }

  private async handlePolygonMenuAction(action: ContextMenuAction) {
    const selectedIds = this.objectManager.getSelectedEditorObjectIds()
    if (selectedIds.length > 1) {
      if (action === 'group') {
        if (!this.canGroupCurrentSelection()) {
          this.contextMenu.hide()
          return
        }
        this.fabricCanvas?.discardActiveObject()
        const group = this.createEmptyNode(0, 0, true)
        group.renderLayer = this.getGroupedObjectRenderLayer(selectedIds)
        const groupData = this.objectManager.createGroupObject(
          selectedIds,
          group
        )
        this.contextMenu.hide()
        if (!groupData || !this.fabricCanvas) {
          return
        }
        this.fabricCanvas.setActiveObject(group)
        this.objectManager.handleCanvasSelection([group])
        this.syncManagedObjectTarget(group)
        this.fabricCanvas.requestRenderAll()
        this.captureHistorySnapshot()
        return
      }
      if (action === 'copy') {
        const targets = this.getObjectsByIds(selectedIds)
        this.clipboardManager.copyBatch(targets)
        this.contextMenu.hide()
        return
      }
      if (action === 'commonProperties') {
        const targets = this.getObjectsByIds(selectedIds)
        const changed =
          await this.propertiesPanel.showCommonPropertiesDialog(targets)
        this.contextMenu.hide()
        if (changed) {
          this.captureHistorySnapshot()
        }
        return
      }
      if (action === 'delete') {
        await this.handleBatchDelete(selectedIds)
        return
      }
    }
    const polygon = this.contextMenu.getPolygon()
    const target = this.contextMenu.getTarget()
    if (!target || !target.canvas) {
      this.contextMenu.hide()
      return
    }
    const canvas = target.canvas
    if (action === 'lock') {
      const changed = this.objectManager.setObjectLocked(target, true)
      this.contextMenu.hide()
      if (changed) {
        this.updateActiveSelectionLockVisual()
        canvas.requestRenderAll()
        this.captureHistorySnapshot()
      }
      return
    }
    if (action === 'unlock') {
      const changed = this.objectManager.setObjectLocked(target, false)
      this.contextMenu.hide()
      if (changed) {
        this.updateActiveSelectionLockVisual()
        canvas.requestRenderAll()
        this.captureHistorySnapshot()
      }
      return
    }
    if (action === 'convertGroup') {
      if (!this.objectManager.canConvertEmptyObjectToGroup(target)) {
        this.contextMenu.hide()
        return
      }
      const changed = this.objectManager.convertEmptyObjectToGroup(target)
      this.contextMenu.hide()
      if (!changed) {
        return
      }
      canvas.setActiveObject(target)
      this.objectManager.handleCanvasSelection([target])
      this.syncManagedObjectTarget(target)
      canvas.requestRenderAll()
      this.captureHistorySnapshot()
      return
    }
    if (action === 'ungroup') {
      if (!this.isGroupContainer(target)) {
        this.contextMenu.hide()
        return
      }
      const changed = this.objectManager.ungroupObject(target)
      this.contextMenu.hide()
      if (!changed) {
        return
      }
      canvas.setActiveObject(target)
      this.objectManager.handleCanvasSelection([target])
      canvas.requestRenderAll()
      this.captureHistorySnapshot()
      return
    }
    if (action === 'copy') {
      if (!this.clipboardManager.canCopy(target)) {
        this.contextMenu.hide()
        return
      }
      this.clipboardManager.copy(target)
      this.contextMenu.hide()
      return
    }
    if (action === 'paste') {
      if (this.clipboardManager.hasBatchData()) {
        const pasted = this.clipboardManager.pasteBatch()
        this.contextMenu.hide()
        if (pasted.length > 0) {
          this.captureHistorySnapshot()
        }
        return
      }
      const pasted = this.clipboardManager.paste()
      this.contextMenu.hide()
      if (pasted) {
        this.captureHistorySnapshot()
      }
      return
    }
    if (action === 'commonProperties') {
      const changed =
        await this.propertiesPanel.showCommonPropertiesDialog(target)
      this.contextMenu.hide()
      if (changed) {
        this.captureHistorySnapshot()
      }
      return
    }
    if (action === 'terrainProperties') {
      const changed =
        this.terrainManager.isTerrainContourProxy(target) ||
        this.terrainManager.isTerrainProxy(target)
          ? await this.propertiesPanel.showTerrainPropertiesDialog(target)
          : await this.propertiesPanel.showProceduralTexturePropertiesDialog(
              target
            )
      this.contextMenu.hide()
      if (changed) {
        this.captureHistorySnapshot()
      }
      return
    }
    if (action === 'properties') {
      let changed = false
      if (this.markerManager.isWeaponMarker(target)) {
        await this.propertiesPanel.showWeaponPropertiesDialog(target)
      } else if (this.markerManager.isPlayerMarker(target)) {
        await this.propertiesPanel.showPlayerPropertiesDialog(target)
      } else if (this.markerManager.isNpcMarker(target)) {
        await this.propertiesPanel.showNpcPropertiesDialog(target)
      } else if (
        this.markerManager.isEnvironmentMarker(target) &&
        target.envType === 'key'
      ) {
        changed =
          await this.propertiesPanel.showEnvironmentKeyPropertiesDialog(target)
      }
      this.contextMenu.hide()
      if (changed) {
        this.captureHistorySnapshot()
      }
      return
    }
    if (action === 'fill') {
      if (!this.isTerrainContourProxy(target)) {
        this.contextMenu.hide()
        return
      }
      const clientX = this.contextMenu.getClientX()
      const clientY = this.contextMenu.getClientY()
      this.pendingTerrainContourFillTarget = target
      this.contextMenu.hide()
      this.menuSystem.showTerrainFillSubmenu(clientX, clientY)
      return
    }
    if (action === 'delete') {
      const confirmed = await this.dialogManager.confirm(
        this.buildDeleteConfirmMessage([
          this.objectManager.getEditorObjectMap().get(target)?.id ?? -1,
        ])
      )
      if (!confirmed) {
        this.contextMenu.hide()
        return
      }
      const targetId = this.objectManager.getEditorObjectMap().get(target)?.id
      if (targetId === undefined) {
        this.contextMenu.hide()
        return
      }
      const changed = this.deleteObjectsWithChildren([targetId])
      this.contextMenu.hide()
      if (changed) {
        this.captureHistorySnapshot()
      }
      return
    }
    if (action === 'rename') {
      this.objectManager.beginObjectRename(target)
      this.contextMenu.hide()
      return
    }
    if (action === 'zoom') {
      if (!this.cameraManager.isCameraFrame(target)) {
        this.contextMenu.hide()
        return
      }
      const data = this.cameraManager.getCameraViewMap().get(target)
      if (!data) {
        this.contextMenu.hide()
        return
      }
      const input = await this.dialogManager.prompt(
        localizer.t('editor_camera_menu_zoom'),
        data.zoom.toFixed(2)
      )
      if (input === null) {
        this.contextMenu.hide()
        return
      }
      const value = Number.parseFloat(input)
      if (!Number.isFinite(value) || value <= 0) {
        this.contextMenu.hide()
        return
      }
      data.zoom = value
      data.frame.width = data.baseWidth / data.zoom
      data.frame.height = data.baseHeight / data.zoom
      data.frame.scaleX = 1
      data.frame.scaleY = 1
      data.frame.setCoords()
      this.cameraManager.syncCameraIcon(data)
      canvas.requestRenderAll()
      this.contextMenu.hide()
      this.captureHistorySnapshot()
      return
    }
    if (action === 'reset') {
      if (this.cameraManager.isCameraFrame(target)) {
        const data = this.cameraManager.getCameraViewMap().get(target)
        if (data) {
          data.zoom = 1
          data.frame.width = data.baseWidth
          data.frame.height = data.baseHeight
          data.frame.scaleX = 1
          data.frame.scaleY = 1
          data.frame.left = this.editorCanvas.width * 0.5
          data.frame.top = this.editorCanvas.height * 0.5
          data.frame.setCoords()
          this.cameraManager.syncCameraIcon(data)
        }
        canvas.requestRenderAll()
        this.contextMenu.hide()
        this.captureHistorySnapshot()
        return
      }
      this.shapeManager.resetShape(target)
      canvas.requestRenderAll()
      this.contextMenu.hide()
      this.captureHistorySnapshot()
      return
    }
    if (action === 'square') {
      this.shapeManager.makeSquare(target)
      canvas.requestRenderAll()
      this.contextMenu.hide()
      this.captureHistorySnapshot()
      return
    }
    if (action === 'equilateral') {
      this.shapeManager.makeEquilateralTriangle(target)
      canvas.requestRenderAll()
      this.contextMenu.hide()
      this.captureHistorySnapshot()
      return
    }
    if (this.isTerrainContourProxy(target)) {
      const pointIndex = this.contextMenu.getPointIndex()
      const insertX = this.contextMenu.getInsertX()
      const insertY = this.contextMenu.getInsertY()
      let changed = false
      if (action === 'add') {
        changed = this.terrainManager.insertContourPoint(
          target,
          pointIndex,
          insertX,
          insertY
        )
      } else if (action === 'remove') {
        changed = this.terrainManager.removeContourPoint(target, pointIndex)
      }
      this.contextMenu.hide()
      if (changed) {
        this.captureHistorySnapshot()
      }
      return
    }
    if (!polygon || !polygon.points || !polygon.canvas) {
      this.contextMenu.hide()
      return
    }
    const pointIndex = this.contextMenu.getPointIndex()
    const insertX = this.contextMenu.getInsertX()
    const insertY = this.contextMenu.getInsertY()
    if (action === 'add') {
      this.polygonEditor.insertPolygonPoint(
        polygon.points,
        pointIndex,
        insertX,
        insertY
      )
    } else if (action === 'remove') {
      if (polygon.points.length <= 3) {
        this.contextMenu.hide()
        return
      }
      this.polygonEditor.removePolygonPoint(polygon.points, pointIndex)
    }
    polygon.dirty = true
    this.polygonEditor.updateEditablePolygonBounds(polygon)
    this.polygonEditor.refreshEditablePolygonControls(polygon)
    polygon.canvas.requestRenderAll()
    this.contextMenu.hide()
    this.captureHistorySnapshot()
  }

  private handleTerrainContourFillSelected(
    materialId: TerrainMaterialId
  ): void {
    const target = this.pendingTerrainContourFillTarget
    this.pendingTerrainContourFillTarget = null
    if (!this.isTerrainContourProxy(target)) {
      this.menuSystem.hideTerrainFillSubmenu()
      return
    }
    const changed = this.terrainManager.fillContour(target, materialId)
    this.menuSystem.hideTerrainFillSubmenu()
    if (changed) {
      this.captureHistorySnapshot()
    }
  }

  // ========================================
  // CANVAS MANAGEMENT
  // ========================================

  private ensureFabricCanvas() {
    if (this.fabricCanvas) {
      this.terrainManager.attachToCanvas()
      return
    }

    this.fabricCanvas = new fabric.Canvas(this.editorCanvas, {
      selection: true,
      preserveObjectStacking: true,
      enableRetinaScaling: false,
      backgroundVpt: true,
      fireMiddleClick: true,
    })
    this.fabricCanvas.uniformScaling = false
    this.fabricCanvas.selectionKey = ['ctrlKey', 'metaKey']
    this.fabricCanvas.uniScaleKey = 'shiftKey'
    this.terrainManager.attachToCanvas()
    this.restoreEditorCanvasCursor()

    this.canvasEventHandler.attachEventListeners()

    this.resizeEditorCanvas()
    this.applyEditorBackgroundColor(true)
  }

  // ========================================
  // CANVAS MANAGEMENT
  // ========================================

  private applyEditorBackgroundColor(requestRender: boolean): void {
    if (!this.fabricCanvas) {
      return
    }

    const skyColor = this.resolveEditorBackgroundSkyColor()
    this.fabricCanvas.backgroundColor = `#${skyColor
      .toString(16)
      .padStart(6, '0')}`
    if (requestRender) {
      this.fabricCanvas.requestRenderAll()
    }
  }

  private resolveEditorBackgroundSkyColor(): number {
    this.editorDayNightCycle.setElapsed(
      getMapTimePhaseElapsedMs(this.mapSettings.initialTimePhase)
    )
    return this.editorDayNightCycle.getLightingState().sky
  }

  // ========================================
  // SHAPE MANAGEMENT
  // ========================================

  private setPanelCollapsed(collapsed: boolean) {
    this.sidebarManager.setCollapsed(collapsed)
  }

  // ========================================
  // CANVAS MANAGEMENT
  // ========================================

  private resizeEditorCanvas() {
    if (!this.fabricCanvas) {
      return
    }

    const viewportRect = this.gameCanvas.getBoundingClientRect()
    const viewportWidth = Math.round(viewportRect.width)
    const viewportHeight = Math.round(viewportRect.height)
    if (viewportWidth <= 0 || viewportHeight <= 0) {
      return
    }

    const targetWidth = this.gameCanvas.width
    const targetHeight = this.gameCanvas.height

    this.editorCanvas.width = targetWidth
    this.editorCanvas.height = targetHeight
    this.fabricCanvas.setDimensions(
      { width: targetWidth, height: targetHeight },
      { backstoreOnly: true }
    )
    this.fabricCanvas.setDimensions(
      { width: `${viewportWidth}px`, height: `${viewportHeight}px` },
      { cssOnly: true }
    )
    this.terrainManager.resizeCanvas(
      targetWidth,
      targetHeight,
      viewportWidth,
      viewportHeight
    )

    this.fabricCanvas.calcOffset()
    this.snapManager.resizeSnapGuides()
    this.fabricCanvas.requestRenderAll()
  }

  private handleWindowResize() {
    if (!this.visible || this.currentView !== EditorView.Editor) {
      return
    }

    this.resizeEditorCanvas()
    this.menuSystem.handleWindowResize()
  }

  show() {
    this.visible = true
    void this.refreshCustomEnvironmentAssets()
    this.mapListManager.refreshMapMetas()
    this.showMapListView()
    this.editorOverlay.classList.add('is-visible')
    this.editorOverlay.focus(this.focusOptions)
    this.updateLocalization()
    this.gameCanvas.style.visibility = 'hidden'
  }

  showEditorForCurrentMap() {
    this.visible = true
    void this.refreshCustomEnvironmentAssets()
    this.editorOverlay.classList.add('is-visible')
    this.editorOverlay.focus(this.focusOptions)
    this.updateLocalization()
    this.showEditorView()
    this.gameCanvas.style.visibility = 'hidden'
  }

  hide() {
    this.visible = false
    this.editorOverlay.classList.remove('is-visible')
    this.menuSystem.hideAll()
    this.contextMenu.hide()
    this.tooltipManager.hide()
    this.objectManager.cancelObjectRename()
    this.clearTemporarySelectState()
    this.setActiveObjectType(null)
    this.gameCanvas.style.visibility = 'visible'
  }

  isVisible(): boolean {
    return this.visible
  }

  onBackToMenu(callback: () => void) {
    this.onBackToMenuCallback = callback
  }

  onPreview(callback: (meta: EditorMapMeta, data: EditorMapData) => void) {
    this.onPreviewCallback = callback
  }

  onDefaultMapChanged(callback: (meta: EditorMapMeta) => void) {
    this.onDefaultMapChangedCallback = callback
  }

  setGameClient(client: GameClient) {
    this.gameClient = client
  }
}
