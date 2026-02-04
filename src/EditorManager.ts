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

  private visible = false
  private currentView: EditorView = EditorView.MapList
  private maps: EditorMap[] = []
  private currentMapMeta: EditorMapMeta | null = null
  private gameClient: GameClient | null = null
  private onBackToMenuCallback?: () => void
  private onPreviewCallback?: (meta: EditorMapMeta, data: EditorMapData) => void
  private onDefaultMapChangedCallback?: (meta: EditorMapMeta) => void
  private lastSavedHistoryId = 0
  private fabricCanvas: fabric.Canvas | null = null
  private activeObjectType: ObjectType | null = null
  private handleResize: () => void
  private panelCollapsed = false
  private backgroundPattern: fabric.Pattern | null = null
  private backgroundImage: HTMLImageElement | null = null
  private isPanning = false
  private lastClientX = 0
  private lastClientY = 0
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
          this.objectManager.handleCanvasSelection(obj),

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
        this.objectManager.handleCanvasSelection(obj),
    })

    this.cameraManager = new EditorCameraManager({
      fabricCanvas: () => this.fabricCanvas,

      editorCanvas: this.editorCanvas,

      getViewportCenter: () => this.getViewportCenter(),

      registerEditorObject: (type, obj) =>
        this.objectManager.registerEditorObject(type, obj),

      handleCanvasSelection: (obj) =>
        this.objectManager.handleCanvasSelection(obj),

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
      },
      applyEditorViewportState: (state) => this.applyEditorViewportState(state),
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
      dragObjectId: this.objectManager.getDragId(),
      onRenameCommit: (id, value) => {
        const changed = this.objectManager.commitObjectRename(id, value)
        if (changed) {
          this.captureHistorySnapshot()
        }
      },
      onRenameCancel: () => this.objectManager.cancelObjectRename(),
      onDragStart: (id) => {
        this.objectManager.setDragId(id)
        this.updateObjectTreeContext()
      },
      onDrop: (dragId, targetId, insertAfter) => {
        this.objectManager.reorderEditorObjects(dragId, targetId, insertAfter)
        this.resetDragState()
        this.captureHistorySnapshot()
      },
      onDragEnd: () => {
        this.resetDragState()
      },
      onObjectSelected: (id) => this.objectManager.focusEditorObjectById(id),
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
      onObjectTypeSelected: (type) => this.handleObjectClick(type),
      onGroundShapeSelected: (shape) => {
        this.shapeManager.createGroundShape(shape)
        this.captureHistorySnapshot()
      },
      onObstacleShapeSelected: (shape) => {
        this.shapeManager.createObstacleShape(shape)
        this.captureHistorySnapshot()
      },
      onWeaponSelected: (weaponType, category, size) => {
        this.markerManager.spawnWeaponMarker(weaponType, category, {
          sizeLevel: size,
        })
        this.captureHistorySnapshot()
      },
      onEnemySelected: (enemyType) => {
        this.markerManager.spawnEnemyMarker(enemyType)
        this.captureHistorySnapshot()
      },
      onPanelMenuAdd: () => {
        const pos = this.menuSystem.getPanelMenuPosition()
        this.menuSystem.hidePanelMenu()
        this.menuSystem.showObjectTypeMenu(pos.x, pos.y)
      },
    })

    this.contextMenu = new EditorContextMenu({
      editorWorkspace: this.editorWorkspace,
      isEditablePolygon: (obj) => this.isEditablePolygon(obj),
      onAction: (action) => this.handlePolygonMenuAction(action),
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
      handleCanvasSelection: (object) =>
        this.objectManager.handleCanvasSelection(object),
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
    this.historyManager.undo()
  }

  private handleRedo() {
    if (this.currentView !== EditorView.Editor) {
      return
    }
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
      this.markerManager.spawnPlayerMarker()
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
      this.cameraManager.spawnCameraViewFrame(undefined, type)
      this.captureHistorySnapshot()
      return
    }

    if (type === ObjectType.Enemy) {
      this.setActiveObjectType(type)
      this.hideAllSubmenus()
      this.menuSystem.showEnemySubmenu()
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
      dragObjectId: this.objectManager.getDragId(),
    })
  }

  private renderObjectTree() {
    this.updateObjectTreeContext()
    this.objectTreeManager.renderObjectTree()
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
    this.historyManager.capture()
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
        ['zoom', 'reset', 'rename', 'delete'],
        target,
        -1,
        clientX,
        clientY
      )
      return
    }
    if (this.markerManager.isPlayerMarker(target)) {
      this.showPolygonMenuWithActions(
        ['properties', 'rename', 'delete'],
        target,
        -1,
        clientX,
        clientY
      )
      return
    }
    if (this.markerManager.isEnemyMarker(target)) {
      this.showPolygonMenuWithActions(
        ['properties', 'rename', 'delete'],
        target,
        -1,
        clientX,
        clientY
      )
      return
    }
    if (this.markerManager.isWeaponMarker(target)) {
      this.showPolygonMenuWithActions(
        ['properties', 'rename', 'delete'],
        target,
        -1,
        clientX,
        clientY
      )
      return
    }
    if (target.type === 'rect') {
      this.showPolygonMenuWithActions(
        ['rename', 'reset', 'square', 'delete'],
        target,
        -1,
        clientX,
        clientY
      )
      return
    }
    if (this.isTriangleShape(target)) {
      this.showPolygonMenuWithActions(
        ['rename', 'reset', 'equilateral', 'delete'],
        target,
        -1,
        clientX,
        clientY
      )
      return
    }
    this.showPolygonMenuWithActions(
      ['rename', 'reset', 'delete'],
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
