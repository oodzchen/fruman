import { fabric } from 'fabric'

import { DialogManager } from './DialogManager'
import type { GameClient } from './GameClient'
import { localizer } from './Localizer'
import {
  CHARACTER_DEFAULT_DATA,
  DEFAULT_PLAYER_RADIUS,
  WEAPON_DEFAULT_DATA,
} from './constants'
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
  DEFAULT_ENEMY_TYPE,
  EDITOR_HISTORY_MAX_ENTRIES,
  EDITOR_NUDGE_STEP_PX,
  EDITOR_PIXELS_PER_METER,
  EDITOR_VIEW_MAX_ZOOM_SCALED,
  EDITOR_VIEW_MIN_ZOOM_SCALED,
  EDITOR_VIEW_ZOOM_SCALE,
  ENEMY_EYE_COLOR,
  PLAYER_BODY_COLOR,
  PLAYER_EYE_COLOR,
  acquirePoint,
  releasePoint,
} from './editor/EditorConstants'
import type { ContextMenuAction } from './editor/EditorContextMenu'
import { EditorContextMenu } from './editor/EditorContextMenu'
import { computeCameraOffsetFromCenter } from './editor/EditorCoordinateUtils'
import { EditorHistoryManager } from './editor/EditorHistoryManager'
import { EditorMapListManager } from './editor/EditorMapListManager'
import { EditorMapSerializer } from './editor/EditorMapSerializer'
import { EditorMarkerManager } from './editor/EditorMarkerManager'
import { EditorMenuSystem } from './editor/EditorMenuSystem'
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
  computeEnemyBodyRadiusPx,
  computeWeaponRenderDimensions,
  renderEnemyPreviewToContext,
} from './editor/EditorRenderUtils'
import { EditorShapeManager } from './editor/EditorShapeManager'
import { EditorSidebarManager } from './editor/EditorSidebarManager'
import { EditorSnapManager } from './editor/EditorSnapManager'
import { EditorThumbnailCapture } from './editor/EditorThumbnailCapture'
import { EditorToolbarManager } from './editor/EditorToolbarManager'
import {
  type CameraFrame,
  type CameraViewData,
  type EditorMap,
  type EditorObjectData,
  type EnemyMarker,
  type EnemyMarkerData,
  type GroundShapeType,
  ObjectType,
  type PlayerMarker,
  type ShapeResetData,
  type WeaponMarker,
  type WeaponMarkerData,
  type WeaponShape,
} from './editor/types'
import type {
  EditorMapData,
  EditorMapMeta,
  EditorViewportState,
  MapEnemyWeapon,
  MapPlacedShape,
  MapWeapon,
  WeaponCategory,
} from './editorMapTypes'
import { renderBody } from './renderer/BodyRenderer'
import { PatternCreator } from './renderer/PatternCreator'
import { renderWeapon } from './renderer/WeaponRenderer'
import {
  createEditorMap,
  listEditorMaps,
  loadEditorMapData,
  saveEditorMap,
  saveEditorMapMeta,
  saveEditorMapViewState,
} from './storage'
import type { EnemyPatrolMode, EnemyType, WeaponType } from './types'

type WeaponTemplate = (typeof WEAPON_DEFAULT_DATA)[WeaponType]

interface EditorTreeHistoryEntry {
  order: number[]
  parentIds: number[]
  id: number
}

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
  private menuSystem!: EditorMenuSystem
  private contextMenu!: EditorContextMenu
  private shapeManager: EditorShapeManager
  private markerManager: EditorMarkerManager
  private thumbnailCapture: EditorThumbnailCapture
  private canvasEventHandler: EditorCanvasEventHandler
  private historyManager: EditorHistoryManager
  private clipboardManager: EditorClipboardManager

  private visible = false
  private currentView: EditorView = EditorView.MapList
  private maps: EditorMap[] = []
  private currentMapMeta: EditorMapMeta | null = null
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
  private handleResize: () => void
  private panelCollapsed = false
  private backgroundPattern: fabric.Pattern | null = null
  private backgroundImage: HTMLImageElement | null = null
  private isPanning = false
  private lastClientX = 0
  private lastClientY = 0
  private objectTreeAnchorId = -1
  private dragSelectionIds: number[] = []
  private panelMenuSpawnX = 0
  private panelMenuSpawnY = 0
  private panelMenuSpawnValid = false
  private panelMenuSpawnScratch = { x: 0, y: 0 }
  private polygonEditor: EditorPolygonEditor
  private objectFactory: EditorObjectFactory
  private objectManager: EditorObjectManager
  private focusOptions: FocusOptions = { preventScroll: true }
  // Markers are now managed by EditorMarkerManager
  // private playerMarker: PlayerMarker | null = null
  // private enemyMarkers: EnemyMarkerData[] = []
  // private weaponMarkers: WeaponMarkerData[] = []
  // private enemyMarkerMap = new Map<fabric.Object, EnemyMarkerData>()
  // private weaponMarkerMap = new Map<fabric.Object, WeaponMarkerData>()
  private readonly invPixelsPerMeter = 1 / EDITOR_PIXELS_PER_METER
  private snapManager!: EditorSnapManager
  private patternManager!: EditorPatternManager
  private cameraManager!: EditorCameraManager

  constructor() {
    const overlay = document.getElementById('editorOverlay')
    const workspace = document.getElementById('editorWorkspace')
    const editorCanvas = document.getElementById('editorCanvas')
    const gameCanvas = document.getElementById('gameCanvas')

    if (
      !(overlay instanceof HTMLDivElement) ||
      !(workspace instanceof HTMLDivElement) ||
      !(editorCanvas instanceof HTMLCanvasElement) ||
      !(gameCanvas instanceof HTMLCanvasElement)
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
      enemyEyeColor: ENEMY_EYE_COLOR,
      computeEnemyBodyRadiusPx,
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
        if (this.markerManager.isEnemyMarker(obj)) {
          this.markerManager.removeEnemyMarker(obj)
        }
        if (this.markerManager.isWeaponMarker(obj)) {
          this.markerManager.removeWeaponMarker(obj)
        }
        if (this.markerManager.isHookAnchorMarker(obj)) {
          this.markerManager.removeHookAnchorMarker(obj)
        }
        this.patternManager.deletePattern(obj)
      },
      onSelectionChanged: (obj) => {
        this.cameraManager.refreshCameraFocus(obj)
      },
      onBringToFront: (obj) => {
        if (this.cameraManager.isCameraFrame(obj)) {
          const data = this.cameraManager.getCameraViewMap().get(obj)
          if (data) {
            this.cameraManager.syncCameraIcon(data)
            data.icon.bringToFront()
          }
        }
      },
      renderObjectTree: () => this.renderObjectTree(),
    })

    this.markerManager = new EditorMarkerManager(
      {
        getCanvas: () => this.fabricCanvas,

        getViewportCenter: () => this.getViewportCenter(),

        registerEditorObject: (type, obj) =>
          this.objectManager.registerEditorObject(type, obj),

        handleCanvasSelection: (obj) =>
          this.objectManager.handleCanvasSelection(obj ? [obj] : []),

        computeEnemyBodyRadiusPx,

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
        this.objectManager.registerEditorObject(type, obj),

      handleCanvasSelection: (obj) =>
        this.objectManager.handleCanvasSelection(obj ? [obj] : []),
    })

    this.cameraManager = new EditorCameraManager({
      fabricCanvas: () => this.fabricCanvas,

      editorCanvas: this.editorCanvas,

      getViewportCenter: () => this.getViewportCenter(),

      registerEditorObject: (type, obj) =>
        this.objectManager.registerEditorObject(type, obj),

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
      shapeManager: this.shapeManager,

      spawnCameraViewFrame: (camera) =>
        this.cameraManager.spawnCameraViewFrame(camera, ObjectType.Camera),
      renderObjectTree: () => this.renderObjectTree(),
      requestRenderAll: () => {
        this.fabricCanvas?.requestRenderAll()
      },
      getCameraViews: () => this.cameraManager.getCameraViews(),
      getPlayerMarkerData: () => this.markerManager.getPlayerMarkerData(),
      getEditorObjects: () => this.objectManager.getEditorObjects(),
      getPolygonScratchPoint: () => this.polygonEditor.getScratchPoint(),
      applyTransform: this.polygonEditor.applyTransform.bind(
        this.polygonEditor
      ),
      setupEditablePolygon: (polygon) => this.setupEditablePolygon(polygon),
      registerEditorObject: (type, obj) =>
        this.objectManager.registerEditorObject(type, obj),
      applyGroundPatternToObject: (obj) =>
        this.patternManager.applyGroundPatternToObject(obj),
      applyObstaclePatternToObject: (obj) =>
        this.patternManager.applyObstaclePatternToObject(obj),
    })

    this.historyManager = new EditorHistoryManager(
      {
        serializeCurrentMapData: () =>
          this.mapSerializer.serializeCurrentMapData(),
        applyMapData: (data) => this.mapSerializer.applyMapData(data),
      },
      EDITOR_HISTORY_MAX_ENTRIES
    )

    this.clipboardManager = new EditorClipboardManager({
      getCanvas: () => this.fabricCanvas,
      getInvPixelsPerMeter: () => this.invPixelsPerMeter,
      editorCanvas: this.editorCanvas,
      markerManager: this.markerManager,
      shapeManager: this.shapeManager,
      cameraManager: this.cameraManager,
      patternManager: this.patternManager,
      objectManager: this.objectManager,
      polygonEditor: this.polygonEditor,
      handleCanvasSelection: (obj) =>
        this.objectManager.handleCanvasSelection(obj ? [obj] : []),
      isEditablePolygon: (obj) => this.isEditablePolygon(obj),
      hasObjectOfType: (type) => this.hasObjectOfType(type),
    })

    this.propertiesPanel = new EditorPropertiesPanel({
      getFabricCanvas: () => this.fabricCanvas,
      weaponMarkerMap: this.markerManager.getWeaponMarkerMap(),
      enemyMarkerMap: this.markerManager.getEnemyMarkerMap(),
      playerMarkerData: () => this.markerManager.getPlayerMarkerData(),
      editorObjectMap: this.objectManager.getEditorObjectMap(),
      objectFactory: this.objectFactory,
      requestRender: () => this.fabricCanvas?.requestRenderAll(),
      getMapSnapshot: () => this.getMapSnapshot(),
      applyMapSnapshot: (data) => this.applyMapSnapshot(data),
      onHistoryCapture: () => this.captureHistorySnapshot(),
      getOrCreateEnemyWeaponMarker: (d, w, s) =>
        this.markerManager.getOrCreateEnemyWeaponMarker(d, w, s),
      getOrCreatePlayerWeaponMarker: (d, w, s) =>
        this.markerManager.getOrCreatePlayerWeaponMarker(d, w, s),
      updateEnemyMarkerVisual: (m, r, c, f) =>
        this.markerManager.updateEnemyMarkerVisual(m, r, c, f),
      updatePlayerMarkerVisual: (m, r, c, f) =>
        this.markerManager.updatePlayerMarkerVisual(m, r, c, f),
      updateWeaponMarkerVisual: (m, s) =>
        this.markerManager.updateWeaponMarkerVisual(m, s),
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
      onGroundShapeSelected: (shape) => {
        const spawn = this.consumePanelMenuSpawn()
        if (spawn) {
          this.shapeManager.createGroundShape(shape, spawn.x, spawn.y)
        } else {
          this.shapeManager.createGroundShape(shape)
        }
        this.captureHistorySnapshot()
      },
      onObstacleShapeSelected: (shape) => {
        const spawn = this.consumePanelMenuSpawn()
        if (spawn) {
          this.shapeManager.createObstacleShape(shape, spawn.x, spawn.y)
        } else {
          this.shapeManager.createObstacleShape(shape)
        }
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
      onEnemySelected: (enemyType) => {
        const spawn = this.consumePanelMenuSpawn()
        if (spawn) {
          this.markerManager.spawnEnemyMarker(enemyType, {
            x: spawn.x * this.invPixelsPerMeter,
            y: spawn.y * this.invPixelsPerMeter,
          })
        } else {
          this.markerManager.spawnEnemyMarker(enemyType)
        }
        this.captureHistorySnapshot()
      },
      onPanelMenuAdd: () => {
        const pos = this.menuSystem.getPanelMenuPosition()
        this.menuSystem.hidePanelMenu()
        this.menuSystem.showObjectTypeMenu(pos.x, pos.y)
      },
      onPanelMenuPaste: () => {
        const spawn = this.consumePanelMenuSpawn()
        const pasted = spawn
          ? this.clipboardManager.pasteAt(spawn.x, spawn.y)
          : this.clipboardManager.paste()
        this.menuSystem.hidePanelMenu()
        if (pasted) {
          this.captureHistorySnapshot()
        }
      },
    })

    this.contextMenu = new EditorContextMenu({
      editorWorkspace: this.editorWorkspace,
      isEditablePolygon: (obj) => this.isEditablePolygon(obj),
      onAction: (action) => this.handlePolygonMenuAction(action),
      canPaste: () => this.clipboardManager.hasData(),
      canCopy: (target) => this.clipboardManager.canCopy(target),
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
      handleEditablePolygonPointerDown: (opt) =>
        this.handleEditablePolygonPointerDown(opt as fabric.IEvent<MouseEvent>),
      handleCanvasSelection: (objects) =>
        this.objectManager.handleCanvasSelection(objects),
      onObjectModified: () => this.handleObjectModified(),
      onPolygonEdited: () => this.captureHistorySnapshot(),
    })

    this.setupEventListeners()
    this.updateLocalization()

    this.handleResize = this.handleWindowResize.bind(this)
    window.addEventListener('resize', this.handleResize)
  }

  private setupEventListeners() {
    this.editorOverlay.addEventListener(
      'pointerdown',
      (event) => {
        const target = event.target as Node
        if (
          this.contextMenu.containsTarget(target) ||
          this.menuSystem.containsTarget(target)
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

    window.addEventListener(
      'keydown',
      (event) => {
        this.handleKeyDown(event)
      },
      true
    )
  }

  private updateLocalization() {
    this.toolbarManager.updateLocalization()
    this.sidebarManager.updateLocalization()
    this.mapListManager.updateLocalization()
    this.menuSystem.updateLocalization()
    this.renderObjectTree()
  }

  private handleKeyDown(event: KeyboardEvent) {
    if (event.defaultPrevented) {
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
    if (this.currentView === EditorView.Editor && isModifier) {
      const lowered = key.toLowerCase()
      if (lowered === 'c') {
        event.preventDefault()
        const active = this.fabricCanvas?.getActiveObject() ?? null
        if (active && this.clipboardManager.canCopy(active)) {
          this.clipboardManager.copy(active)
        }
        return
      }
      if (lowered === 'v') {
        event.preventDefault()
        const pasted = this.clipboardManager.paste()
        if (pasted) {
          this.captureHistorySnapshot()
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

  private handleObjectClick(type: ObjectType) {
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
        this.objectManager.registerEditorObject(type, group)
        this.fabricCanvas?.setActiveObject(group)
        this.objectManager.handleCanvasSelection([group])
        this.fabricCanvas?.requestRenderAll()
        this.captureHistorySnapshot()
      }
      return
    }

    if (type === ObjectType.Ground) {
      this.setActiveObjectType(ObjectType.Ground)
      this.hideAllSubmenus()
      this.menuSystem.showGroundSubmenu()
      return
    }
    if (type === ObjectType.Obstacle) {
      this.setActiveObjectType(ObjectType.Obstacle)
      this.hideAllSubmenus()
      this.menuSystem.showObstacleSubmenu()
      return
    }

    if (type === ObjectType.Weapon) {
      this.setActiveObjectType(ObjectType.Weapon)
      this.hideAllSubmenus()
      this.menuSystem.showWeaponMenu()
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

    if (type === ObjectType.Enemy) {
      this.setActiveObjectType(type)
      this.hideAllSubmenus()
      this.menuSystem.showEnemySubmenu()
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
      editorObjects: this.objectManager.getEditorObjects(),
      renamingEditorObjectId: this.objectManager.getRenamingEditorObjectId(),
      selectedEditorObjectId: this.objectManager.getSelectedEditorObjectId(),
      selectedEditorObjectIds: this.objectManager.getSelectedEditorObjectIds(),
      dragObjectId: this.objectManager.getDragId(),
    })
  }

  private renderObjectTree() {
    this.updateObjectTreeContext()
    this.objectTreeManager.renderObjectTree()
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

    this.objectManager.setSelectedIds(nextSelection)
    this.applyCanvasSelectionFromIds(nextSelection)
  }

  private collectRangeSelection(anchorId: number, targetId: number) {
    const objects = this.objectManager.getEditorObjects()
    let anchorIndex = -1
    let targetIndex = -1
    for (let i = 0; i < objects.length; i++) {
      const id = objects[i].id
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
      result.push(objects[i].id)
    }
    return result
  }

  private applyCanvasSelectionFromIds(ids: number[]) {
    const canvas = this.fabricCanvas
    if (!canvas) {
      return
    }
    if (ids.length === 0) {
      canvas.discardActiveObject()
      canvas.requestRenderAll()
      return
    }
    const objects: fabric.Object[] = []
    for (let i = 0; i < ids.length; i++) {
      const data = this.objectManager.getEditorObjectById(ids[i])
      if (data?.object && data.object.canvas === canvas) {
        objects.push(data.object)
      }
    }
    if (objects.length === 0) {
      canvas.discardActiveObject()
      canvas.requestRenderAll()
      return
    }
    if (objects.length === 1) {
      canvas.setActiveObject(objects[0])
      this.objectManager.handleCanvasSelection(objects)
      canvas.requestRenderAll()
      return
    }
    const selection = new fabric.ActiveSelection(objects, { canvas })
    canvas.setActiveObject(selection)
    this.objectManager.handleCanvasSelection(objects)
    canvas.requestRenderAll()
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
      this.contextMenu.containsTarget(targetNode)
    )
  }

  private setPanelMenuSpawnFromEvent(event: MouseEvent) {
    if (!this.fabricCanvas) {
      return
    }
    const pointer = this.fabricCanvas.getPointer(event)
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
      this.objectManager.focusEditorObjectById(objectId)
      const data = this.objectManager.getEditorObjectById(objectId)
      if (data) {
        this.showShapeContextMenu(data.object, event.clientX, event.clientY)
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
    opt: fabric.IEvent<MouseEvent>
  ): boolean {
    return this.polygonEditor.handleEditablePolygonPointerDown(opt)
  }

  private handleObjectModified() {
    if (!this.visible || this.currentView !== EditorView.Editor) {
      return
    }
    this.captureHistorySnapshot()
  }

  private captureHistorySnapshot() {
    this.lastHistoryWasTree = false
    this.historyManager.capture()
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
    const data = this.mapSerializer.serializeCurrentMapData()
    const meta = await this.mapListManager.ensureMapMeta(data)
    if (!meta) {
      return false
    }

    this.dialogManager.showLoading(localizer.t('editor_saving'))

    try {
      const thumbnail = await this.thumbnailCapture.capture()
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
      return
    }
    if (tree.nodes.length !== tree.parents.length) {
      return
    }
    const editorObjects = this.objectManager.getEditorObjects()
    if (editorObjects.length === 0) {
      return
    }

    const shapeObjects: EditorObjectData[] = []
    const enemyObjects: EditorObjectData[] = []
    const weaponObjects: EditorObjectData[] = []
    const checkpointObjects: EditorObjectData[] = []
    const hookAnchorObjects: EditorObjectData[] = []
    let playerObject: EditorObjectData | null = null
    let cameraObject: EditorObjectData | null = null

    for (let i = 0; i < editorObjects.length; i++) {
      const dataItem = editorObjects[i]
      if (
        dataItem.type === ObjectType.Ground ||
        dataItem.type === ObjectType.Obstacle
      ) {
        shapeObjects.push(dataItem)
      } else if (dataItem.type === ObjectType.Enemy) {
        enemyObjects.push(dataItem)
      } else if (dataItem.type === ObjectType.Weapon) {
        weaponObjects.push(dataItem)
      } else if (dataItem.type === ObjectType.Checkpoint) {
        checkpointObjects.push(dataItem)
      } else if (dataItem.type === ObjectType.HookAnchor) {
        hookAnchorObjects.push(dataItem)
      } else if (dataItem.type === ObjectType.Player) {
        playerObject = dataItem
      } else if (dataItem.type === ObjectType.Camera) {
        cameraObject = dataItem
      }
    }

    const resolved: EditorObjectData[] = []
    for (let i = 0; i < tree.nodes.length; i++) {
      const node = tree.nodes[i]
      let resolvedData: EditorObjectData | null = null
      if (node.type === 'empty') {
        const group = this.createEmptyNode(0, 0)
        if (group) {
          this.fabricCanvas?.add(group)
          resolvedData = this.objectManager.registerEditorObject(
            ObjectType.Empty,
            group
          )
        }
      } else if (node.type === 'ground' || node.type === 'obstacle') {
        const index = node.index ?? -1
        resolvedData =
          index >= 0 && index < shapeObjects.length ? shapeObjects[index] : null
      } else if (node.type === 'enemy') {
        const index = node.index ?? -1
        resolvedData =
          index >= 0 && index < enemyObjects.length ? enemyObjects[index] : null
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
      } else if (node.type === 'player') {
        resolvedData = playerObject
      } else if (node.type === 'camera') {
        resolvedData = cameraObject
      }

      if (!resolvedData) {
        return
      }
      if (node.name && node.name.length > 0) {
        resolvedData.name = node.name
      }
      resolved.push(resolvedData)
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
  }

  private nudgeSelectedObject(dx: number, dy: number) {
    const canvas = this.fabricCanvas
    if (!canvas) {
      return
    }
    const active = canvas.getActiveObject()
    if (!active || !this.objectManager.getEditorObjectMap().has(active)) {
      return
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

  private handleEditablePolygonContextMenu(opt: fabric.IEvent<MouseEvent>) {
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
    this.contextMenu.hide()
    const target = this.fabricCanvas.findTarget(event, false) ?? null
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
    const pointer = polygon.canvas.getPointer(event)
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
    if (this.cameraManager.isCameraFrame(object)) {
      return true
    }
    if (this.markerManager.isPlayerMarker(object)) {
      return true
    }
    if (this.markerManager.isEnemyMarker(object)) {
      return true
    }
    if (this.markerManager.isWeaponMarker(object)) {
      return true
    }
    if (this.markerManager.isCheckpointMarker(object)) {
      return true
    }
    if (this.markerManager.isHookAnchorMarker(object)) {
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
    if (this.cameraManager.isCameraFrame(target)) {
      this.showPolygonMenuWithActions(
        ['copy', 'paste', 'zoom', 'reset', 'rename', 'delete'],
        target,
        -1,
        clientX,
        clientY
      )
      return
    }
    if (this.markerManager.isPlayerMarker(target)) {
      this.showPolygonMenuWithActions(
        ['copy', 'paste', 'properties', 'rename', 'delete'],
        target,
        -1,
        clientX,
        clientY
      )
      return
    }
    if (this.markerManager.isEnemyMarker(target)) {
      this.showPolygonMenuWithActions(
        ['copy', 'paste', 'properties', 'rename', 'delete'],
        target,
        -1,
        clientX,
        clientY
      )
      return
    }
    if (this.markerManager.isWeaponMarker(target)) {
      this.showPolygonMenuWithActions(
        ['copy', 'paste', 'properties', 'rename', 'delete'],
        target,
        -1,
        clientX,
        clientY
      )
      return
    }
    if (this.isEmptyObject(target)) {
      this.showPolygonMenuWithActions(
        ['copy', 'paste', 'rename', 'delete'],
        target,
        -1,
        clientX,
        clientY
      )
      return
    }
    if (this.markerManager.isCheckpointMarker(target)) {
      this.showPolygonMenuWithActions(
        ['copy', 'paste', 'rename', 'delete'],
        target,
        -1,
        clientX,
        clientY
      )
      return
    }
    if (this.markerManager.isHookAnchorMarker(target)) {
      this.showPolygonMenuWithActions(
        ['copy', 'paste', 'rename', 'delete'],
        target,
        -1,
        clientX,
        clientY
      )
      return
    }
    if (target.type === 'rect') {
      this.showPolygonMenuWithActions(
        ['copy', 'paste', 'rename', 'reset', 'square', 'delete'],
        target,
        -1,
        clientX,
        clientY
      )
      return
    }
    if (this.isTriangleShape(target)) {
      this.showPolygonMenuWithActions(
        ['copy', 'paste', 'rename', 'reset', 'equilateral', 'delete'],
        target,
        -1,
        clientX,
        clientY
      )
      return
    }
    this.showPolygonMenuWithActions(
      ['copy', 'paste', 'rename', 'reset', 'delete'],
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

  private createEmptyNode(centerX: number, centerY: number) {
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
    })
    group.left = centerX
    group.top = centerY
    group.setCoords()
    ;(group as unknown as { editorShape: string }).editorShape = 'editor-empty'
    return group
  }

  // ========================================
  // MENU SYSTEM
  // ========================================

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
    const polygon = this.contextMenu.getPolygon()
    const target = this.contextMenu.getTarget()
    if (!target || !target.canvas) {
      this.contextMenu.hide()
      return
    }
    const canvas = target.canvas
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
      const pasted = this.clipboardManager.paste()
      this.contextMenu.hide()
      if (pasted) {
        this.captureHistorySnapshot()
      }
      return
    }
    if (action === 'properties') {
      if (this.markerManager.isWeaponMarker(target)) {
        await this.propertiesPanel.showWeaponPropertiesDialog(target)
      } else if (this.markerManager.isPlayerMarker(target)) {
        await this.propertiesPanel.showPlayerPropertiesDialog(target)
      } else if (this.markerManager.isEnemyMarker(target)) {
        await this.propertiesPanel.showEnemyPropertiesDialog(target)
      }
      this.contextMenu.hide()
      return
    }
    if (action === 'delete') {
      const confirmed = await this.dialogManager.confirm(
        localizer.t('editor_confirm_delete_shape')
      )
      if (!confirmed) {
        this.contextMenu.hide()
        return
      }
      if (canvas.getActiveObject() === target) {
        canvas.discardActiveObject()
      }
      if (this.cameraManager.isCameraFrame(target)) {
        this.cameraManager.removeCameraView(target)
      }
      if (this.markerManager.isPlayerMarker(target)) {
        this.markerManager.removePlayerMarker(target)
      }
      if (this.markerManager.isEnemyMarker(target)) {
        this.markerManager.removeEnemyMarker(target)
      }
      if (this.markerManager.isCheckpointMarker(target)) {
        this.markerManager.removeCheckpointMarker(target)
      }
      if (this.markerManager.isHookAnchorMarker(target)) {
        this.markerManager.removeHookAnchorMarker(target)
      }
      this.objectManager.unregisterEditorObject(target)
      canvas.remove(target)
      this.shapeManager.deleteShapeResetData(target)
      canvas.requestRenderAll()
      this.contextMenu.hide()
      this.captureHistorySnapshot()
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

  // ========================================
  // CANVAS MANAGEMENT
  // ========================================

  private ensureFabricCanvas() {
    if (this.fabricCanvas) {
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
    this.fabricCanvas.uniScaleKey = 'shiftKey'

    this.canvasEventHandler.attachEventListeners()

    this.resizeEditorCanvas()
    this.applyBackgroundPattern()
  }

  // ========================================
  // CANVAS MANAGEMENT
  // ========================================

  private applyBackgroundPattern() {
    if (!this.fabricCanvas) {
      return
    }

    if (!this.backgroundPattern && !this.backgroundImage) {
      this.backgroundImage = PatternCreator.createBackgroundImage()
    }

    if (this.backgroundPattern) {
      this.fabricCanvas.setBackgroundColor(
        this.backgroundPattern,
        this.fabricCanvas.renderAll.bind(this.fabricCanvas)
      )
      return
    }

    if (this.backgroundImage) {
      const applyPattern = () => {
        if (!this.fabricCanvas || !this.backgroundImage) {
          return
        }
        this.backgroundPattern = new fabric.Pattern({
          source: this.backgroundImage,
          repeat: 'repeat',
        })
        this.fabricCanvas.setBackgroundColor(
          this.backgroundPattern,
          this.fabricCanvas.renderAll.bind(this.fabricCanvas)
        )
      }

      if (this.backgroundImage.complete) {
        applyPattern()
      } else {
        this.backgroundImage.onload = applyPattern
      }
    }
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
    this.mapListManager.refreshMapMetas()
    this.showMapListView()
    this.editorOverlay.classList.add('is-visible')
    this.editorOverlay.focus(this.focusOptions)
    this.updateLocalization()
    this.gameCanvas.style.visibility = 'hidden'
  }

  showEditorForCurrentMap() {
    this.visible = true
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
    this.objectManager.cancelObjectRename()
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
