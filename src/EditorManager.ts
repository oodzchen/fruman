import { fabric } from 'fabric'

import { DialogManager } from './DialogManager'
import type { GameClient } from './GameClient'
import { localizer } from './Localizer'
import {
  CHARACTER_DEFAULT_DATA,
  DEFAULT_BOW_AMMO_ENEMY,
  DEFAULT_BOW_AMMO_PLAYER,
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
  EDITOR_PIXELS_PER_METER,
  ENEMY_EYE_COLOR,
  GROUND_CIRCLE_OPTIONS,
  GROUND_EDITABLE_POLYGON_OPTIONS,
  GROUND_FILL_COLOR,
  GROUND_RECT_OPTIONS,
  GROUND_TRIANGLE_OPTIONS,
  OBSTACLE_CIRCLE_OPTIONS,
  OBSTACLE_EDITABLE_POLYGON_OPTIONS,
  OBSTACLE_FILL_COLOR,
  OBSTACLE_RECT_OPTIONS,
  OBSTACLE_TRIANGLE_OPTIONS,
  PLAYER_BODY_COLOR,
  PLAYER_EYE_COLOR,
  POLYGON_POINT_DATA,
  TRIANGLE_POINT_DATA,
  acquirePoint,
  createEditablePolygonPoints,
  createTrianglePoints,
  releasePoint,
} from './editor/EditorConstants'
import type { ContextMenuAction } from './editor/EditorContextMenu'
import { EditorContextMenu } from './editor/EditorContextMenu'
import { EditorMapListManager } from './editor/EditorMapListManager'
import { EditorMapSerializer } from './editor/EditorMapSerializer'
import { EditorMenuSystem } from './editor/EditorMenuSystem'
import { EditorObjectFactory } from './editor/EditorObjectFactory'
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
  private thumbnailCapture: EditorThumbnailCapture
  private canvasEventHandler: EditorCanvasEventHandler

  private visible = false
  private currentView: EditorView = EditorView.MapList
  private maps: EditorMap[] = []
  private currentMapMeta: EditorMapMeta | null = null
  private gameClient: GameClient | null = null
  private onBackToMenuCallback?: () => void
  private onPreviewCallback?: (meta: EditorMapMeta, data: EditorMapData) => void
  private onDefaultMapChangedCallback?: (meta: EditorMapMeta) => void
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
  private playerMarker: PlayerMarker | null = null
  private enemyMarkers: EnemyMarkerData[] = []
  private weaponMarkers: WeaponMarkerData[] = []
  private enemyMarkerMap = new Map<fabric.Object, EnemyMarkerData>()
  private weaponMarkerMap = new Map<fabric.Object, WeaponMarkerData>()
  private editorObjects: EditorObjectData[] = []
  private editorObjectMap = new Map<fabric.Object, EditorObjectData>()
  private objectTypeCounts = new Map<ObjectType, number>()
  private nextEditorObjectId = 1
  private selectedEditorObjectId = -1
  private renamingEditorObjectId = -1
  private focusedEditorObject: fabric.Object | null = null
  private dragObjectId = -1
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

    this.dialogManager = new DialogManager(this.editorOverlay)
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
    this.mapSerializer = new EditorMapSerializer({
      getCanvas: () => this.editorCanvas,
      getInvPixelsPerMeter: () => this.invPixelsPerMeter,
      getPixelsPerMeter: () => EDITOR_PIXELS_PER_METER,
      getFabricCanvas: () => this.fabricCanvas,
      ensureFabricCanvas: () => this.ensureFabricCanvas(),
      resizeEditorCanvas: () => this.resizeEditorCanvas(),
      clearEditorScene: () => this.clearEditorScene(),
      spawnPlayerMarker: (spawn) => this.spawnPlayerMarker(spawn),
      spawnCameraViewFrame: (camera) =>
        this.cameraManager.spawnCameraViewFrame(camera, ObjectType.Camera),
      applyPlacedShapes: (shapes) => this.applyPlacedShapes(shapes),
      applyEnemies: (enemies) => this.applyEnemies(enemies),
      applyWeapons: (weapons) => this.applyWeapons(weapons),
      renderObjectTree: () => this.renderObjectTree(),
      requestRenderAll: () => {
        this.fabricCanvas?.requestRenderAll()
      },
      getPlayerMarker: () => this.playerMarker,
      getCameraViews: () => this.cameraManager.getCameraViews(),
      getEditorObjects: () => this.editorObjects,
      getEnemyMarkers: () => this.enemyMarkers,
      getWeaponMarkers: () => this.weaponMarkers,
      getWeaponMarkerMap: () => this.weaponMarkerMap,
      getPolygonScratchPoint: () => this.polygonEditor.getScratchPoint(),
      applyTransform: this.polygonEditor.applyTransform.bind(
        this.polygonEditor
      ),
    })

    this.propertiesPanel = new EditorPropertiesPanel({
      getFabricCanvas: () => this.fabricCanvas,
      weaponMarkerMap: this.weaponMarkerMap,
      enemyMarkerMap: this.enemyMarkerMap,
      editorObjectMap: this.editorObjectMap,
      objectFactory: this.objectFactory,
      requestRender: () => this.fabricCanvas?.requestRenderAll(),
      getOrCreateEnemyWeaponMarker: (d, w, s) =>
        this.getOrCreateEnemyWeaponMarker(d, w, s),
      updateEnemyMarkerVisual: (m, r, c, f) =>
        this.updateEnemyMarkerVisual(m, r, c, f),
      updateWeaponMarkerVisual: (m, s) => this.updateWeaponMarkerVisual(m, s),
    })

    this.mapListManager = new EditorMapListManager({
      dialogManager: this.dialogManager,
      mapSerializer: this.mapSerializer,
      getBackBtn: () => this.toolbarManager.getBackBtn(),
      onMapLoaded: (meta, data) => {
        this.currentMapMeta = meta
        // Data application is handled in EditorMapListManager.loadMap but we might need to sync something here if needed.
        // Actually, EditorMapListManager.loadMap calls serializer.applyMapData, so data is already applied.
        // We just update local meta state.
      },
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
      editorObjects: this.editorObjects,
      renamingEditorObjectId: this.renamingEditorObjectId,
      selectedEditorObjectId: this.selectedEditorObjectId,
      dragObjectId: this.dragObjectId,
      onRenameCommit: (id, value) => this.commitObjectRename(id, value),
      onRenameCancel: () => this.cancelObjectRename(),
      onDragStart: (id) => {
        this.dragObjectId = id
        this.updateObjectTreeContext()
      },
      onDrop: (dragId, targetId, insertAfter) => {
        this.reorderEditorObjects(dragId, targetId, insertAfter)
        this.resetDragState()
      },
      onDragEnd: () => {
        this.resetDragState()
      },
      onObjectSelected: (id) => this.focusEditorObjectById(id),
    })

    this.patternManager = new EditorPatternManager({
      fabricCanvas: () => this.fabricCanvas,
    })

    this.cameraManager = new EditorCameraManager({
      fabricCanvas: () => this.fabricCanvas,
      editorCanvas: this.editorCanvas,
      getViewportCenter: () => this.getViewportCenter(),
      mapSerializer: this.mapSerializer,
      registerEditorObject: (type, obj) => this.registerEditorObject(type, obj),
      handleCanvasSelection: (obj) => this.handleCanvasSelection(obj),
      ensureFabricCanvas: () => this.ensureFabricCanvas(),
    })

    this.snapManager = new EditorSnapManager({
      fabricCanvas: () => this.fabricCanvas,
      editorObjects: () => this.editorObjects,
      editorObjectMap: this.editorObjectMap,
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
      onGroundShapeSelected: (shape) => this.handleGroundShapeClick(shape),
      onObstacleShapeSelected: (shape) => this.handleObstacleShapeClick(shape),
      onWeaponSelected: (weaponType, category, size) =>
        this.handleWeaponTypeClick(weaponType, category, size),
      onEnemySelected: (enemyType) => this.handleEnemyTypeClick(enemyType),
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

    this.shapeManager = new EditorShapeManager({
      polygonEditor: this.polygonEditor,
      isEditablePolygon: (obj) => this.isEditablePolygon(obj),
    })

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
      editorObjectMap: this.editorObjectMap,
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
      handleCanvasSelection: (object) => this.handleCanvasSelection(object),
    })

    this.setupEventListeners()
    this.updateLocalization()

    this.handleResize = this.handleWindowResize.bind(this)
    window.addEventListener('resize', this.handleResize)
  }

  private setupEventListeners() {
    document.addEventListener(
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

    document.addEventListener(
      'contextmenu',
      (event) => {
        this.routeEditorContextMenu(event)
      },
      true
    )

    window.addEventListener('keydown', (event) => {
      this.handleKeyDown(event)
    })
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
    if (!this.visible) {
      return
    }
    if (this.currentView === EditorView.MapList) {
      this.mapListManager.handleMapListKeyDown(event)
      return
    }
    if (this.menuSystem.handleKeyDown(event)) {
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      this.handleBack()
    }
  }

  private handleBack() {
    if (this.currentView === EditorView.Editor) {
      this.showMapListView()
    } else {
      this.hide()
      if (this.onBackToMenuCallback) {
        this.onBackToMenuCallback()
      }
    }
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
      this.spawnPlayerMarker()
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
    await this.mapListManager.handlePreview()
  }

  private async handleSave() {
    const data = this.mapSerializer.serializeCurrentMapData()
    const meta = await this.mapListManager.ensureMapMeta(data)
    if (!meta) {
      return
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
        return
      }
      this.currentMapMeta = savedMeta
      this.mapListManager.refreshMapMetas()
      await this.dialogManager.alert(localizer.t('editor_save_success'))
    } catch (error) {
      this.dialogManager.hideLoading()
      await this.dialogManager.alert(localizer.t('editor_save_failed'))
      console.error('[editor] save error', error)
    }
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
    for (let i = 0; i < this.editorObjects.length; i++) {
      const object = this.editorObjects[i].object
      if (object.canvas === canvas) {
        canvas.remove(object)
      }
    }
    this.shapeManager.clearAllShapeResetData()
    this.cameraManager.getCameraViews().length = 0
    this.cameraManager.getCameraViewMap().clear()
    this.playerMarker = null
    this.enemyMarkers.length = 0
    this.enemyMarkerMap.clear()
    this.weaponMarkers.length = 0
    this.weaponMarkerMap.clear()
    this.editorObjects.length = 0
    this.editorObjectMap.clear()
    this.objectTypeCounts.clear()
    this.nextEditorObjectId = 1
    this.selectedEditorObjectId = -1
    this.renamingEditorObjectId = -1
    this.focusedEditorObject = null
    this.resetDragState()
    this.patternManager.clearAll()
    this.snapManager.ensureSnapGuides()
  }

  // ========================================
  // SERIALIZATION
  // ========================================

  private applyEnemies(enemies: EditorMapData['enemies']) {
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i]
      this.spawnEnemyMarker(enemy.enemyType, enemy)
    }
  }

  // ========================================
  // MARKER MANAGEMENT
  // ========================================

  private applyWeapons(weapons: EditorMapData['weapons']) {
    if (!weapons) {
      return
    }
    for (let i = 0; i < weapons.length; i++) {
      const weapon = weapons[i]
      this.spawnWeaponMarker(weapon.weaponType, weapon.category, weapon)
    }
  }

  // ========================================
  // SHAPE MANAGEMENT
  // ========================================

  private applyPlacedShapes(shapes: EditorMapData['shapes']) {
    for (let i = 0; i < shapes.length; i++) {
      const placed = shapes[i]
      if (placed.shape.kind === 'rect') {
        this.applyRectShape(placed)
        continue
      }
      if (placed.shape.kind === 'circle') {
        this.applyCircleShape(placed)
        continue
      }
      this.applyPolygonShape(placed)
    }
  }

  private applyRectShape(placed: MapPlacedShape) {
    const shape = placed.shape
    if (shape.kind !== 'rect') {
      return
    }
    const rectOptions =
      placed.objectKind === 'ground'
        ? GROUND_RECT_OPTIONS
        : OBSTACLE_RECT_OPTIONS
    const rect = new fabric.Rect(rectOptions)
    const width = shape.halfWidth * EDITOR_PIXELS_PER_METER * 2
    const height = shape.halfHeight * EDITOR_PIXELS_PER_METER * 2
    rect.width = width
    rect.height = height
    rect.scaleX = 1
    rect.scaleY = 1
    rect.angle = (shape.rotationRad * 180) / Math.PI
    rect.left = shape.center.x * EDITOR_PIXELS_PER_METER
    rect.top = shape.center.y * EDITOR_PIXELS_PER_METER
    rect.setCoords()
    this.shapeManager.registerShapeResetData(rect, {
      kind: 'rect',
      width,
      height,
    })
    if (placed.objectKind === 'ground') {
      this.patternManager.applyGroundPatternToObject(rect)
    } else {
      this.patternManager.applyObstaclePatternToObject(rect)
    }
    this.fabricCanvas?.add(rect)
    this.registerEditorObject(
      placed.objectKind === 'ground' ? ObjectType.Ground : ObjectType.Obstacle,
      rect
    )
  }

  private applyCircleShape(placed: MapPlacedShape) {
    const shape = placed.shape
    if (shape.kind !== 'circle') {
      return
    }
    const circleOptions =
      placed.objectKind === 'ground'
        ? GROUND_CIRCLE_OPTIONS
        : OBSTACLE_CIRCLE_OPTIONS
    const circle = new fabric.Circle(circleOptions)
    const radius = shape.radius * EDITOR_PIXELS_PER_METER
    circle.radius = radius
    circle.scaleX = 1
    circle.scaleY = 1
    circle.left = shape.center.x * EDITOR_PIXELS_PER_METER
    circle.top = shape.center.y * EDITOR_PIXELS_PER_METER
    circle.setCoords()
    this.shapeManager.registerShapeResetData(circle, {
      kind: 'circle',
      radius,
    })
    if (placed.objectKind === 'ground') {
      this.patternManager.applyGroundPatternToObject(circle)
    } else {
      this.patternManager.applyObstaclePatternToObject(circle)
    }
    this.fabricCanvas?.add(circle)
    this.registerEditorObject(
      placed.objectKind === 'ground' ? ObjectType.Ground : ObjectType.Obstacle,
      circle
    )
  }

  private applyPolygonShape(placed: MapPlacedShape) {
    const shape = placed.shape
    if (shape.kind !== 'polygon') {
      return
    }
    const centerXPx = shape.center.x * EDITOR_PIXELS_PER_METER
    const centerYPx = shape.center.y * EDITOR_PIXELS_PER_METER
    const localPoints: fabric.Point[] = []
    const resetPoints: Array<readonly [number, number]> = []
    for (let i = 0; i < shape.points.length; i += 2) {
      const absX = shape.points[i] * EDITOR_PIXELS_PER_METER
      const absY = shape.points[i + 1] * EDITOR_PIXELS_PER_METER
      const localX = absX - centerXPx
      const localY = absY - centerYPx
      localPoints.push(acquirePoint(localX, localY))
      resetPoints.push([localX, localY])
    }
    const options =
      placed.objectKind === 'ground'
        ? GROUND_EDITABLE_POLYGON_OPTIONS
        : OBSTACLE_EDITABLE_POLYGON_OPTIONS
    const polygon = new fabric.Polygon(localPoints, options)
    this.setupEditablePolygon(polygon)
    const offset = polygon.pathOffset
    if (polygon.points) {
      for (let i = 0; i < polygon.points.length; i++) {
        const point = polygon.points[i]
        point.x += offset.x
        point.y += offset.y
      }
    }
    polygon.left = centerXPx
    polygon.top = centerYPx
    polygon.scaleX = 1
    polygon.scaleY = 1
    polygon.angle = 0
    polygon.setCoords()
    this.shapeManager.registerShapeResetData(polygon, {
      kind: 'polygon',
      points: resetPoints,
    })
    if (placed.objectKind === 'ground') {
      this.patternManager.applyGroundPatternToObject(polygon)
    } else {
      this.patternManager.applyObstaclePatternToObject(polygon)
    }
    this.fabricCanvas?.add(polygon)
    this.registerEditorObject(
      placed.objectKind === 'ground' ? ObjectType.Ground : ObjectType.Obstacle,
      polygon
    )
  }

  // ========================================
  // OBJECT LIFECYCLE
  // ========================================

  private registerEditorObject(type: ObjectType, object: fabric.Object) {
    const existing = this.editorObjectMap.get(object)
    if (existing) {
      return existing
    }
    const id = this.nextEditorObjectId
    this.nextEditorObjectId += 1
    const nextCount = (this.objectTypeCounts.get(type) ?? 0) + 1
    this.objectTypeCounts.set(type, nextCount)
    const typeLabel = localizer.t(`editor_object_${type}`)
    const name = `${typeLabel}${nextCount}`
    const data: EditorObjectData = { id, name, type, object }
    this.editorObjects.push(data)
    this.editorObjectMap.set(object, data)
    this.applyEditorObjectStacking()
    this.renderObjectTree()
    return data
  }

  private unregisterEditorObject(object: fabric.Object) {
    const data = this.editorObjectMap.get(object)
    if (!data) {
      return
    }
    if (this.cameraManager.isCameraFrame(object)) {
      this.cameraManager.removeCameraView(object)
    }
    if (this.isPlayerMarker(object)) {
      this.removePlayerMarker(object)
    }
    if (this.isEnemyMarker(object)) {
      this.removeEnemyMarker(object)
    }
    if (this.isWeaponMarker(object)) {
      this.removeWeaponMarker(object)
    }
    this.editorObjectMap.delete(object)
    const index = this.editorObjects.indexOf(data)
    if (index !== -1) {
      this.editorObjects.splice(index, 1)
    }
    if (this.selectedEditorObjectId === data.id) {
      this.selectedEditorObjectId = -1
    }
    if (this.renamingEditorObjectId === data.id) {
      this.renamingEditorObjectId = -1
    }
    if (this.focusedEditorObject === object) {
      this.focusedEditorObject = null
    }
    this.patternManager.deletePattern(object)
    this.applyEditorObjectStacking()
    this.renderObjectTree()
  }

  // Apply stacking order based on the flat object-tree order: earlier = lower.
  private applyEditorObjectStacking() {
    const canvas = this.fabricCanvas
    if (!canvas) {
      return
    }
    for (let i = 0; i < this.editorObjects.length; i++) {
      const obj = this.editorObjects[i].object
      if (obj.canvas !== canvas) {
        continue
      }
      canvas.moveTo(obj, i)
    }
    if (
      this.focusedEditorObject &&
      this.focusedEditorObject.canvas === canvas
    ) {
      this.bringFocusedObjectToFront(this.focusedEditorObject)
    }
    canvas.requestRenderAll()
  }

  private bringFocusedObjectToFront(object: fabric.Object) {
    object.bringToFront()
    if (this.cameraManager.isCameraFrame(object)) {
      const data = this.cameraManager.getCameraViewMap().get(object)
      if (data) {
        this.cameraManager.syncCameraIcon(data)
        data.icon.bringToFront()
      }
    }
  }

  // Cache other objects' bounds at drag start to avoid O(n) setCoords every move.

  // Snap moving objects by edges/centers and show guide lines for center alignment.

  private getEditorObjectById(id: number) {
    for (let i = 0; i < this.editorObjects.length; i++) {
      const data = this.editorObjects[i]
      if (data.id === id) {
        return data
      }
    }
    return null
  }

  private focusEditorObjectById(id: number) {
    if (!this.fabricCanvas) {
      return
    }
    const data = this.getEditorObjectById(id)
    if (!data) {
      return
    }
    this.fabricCanvas.setActiveObject(data.object)
    this.handleCanvasSelection(data.object)
    this.fabricCanvas.requestRenderAll()
  }

  // ========================================
  // CANVAS MANAGEMENT
  // ========================================

  private handleCanvasSelection(target: fabric.Object | null) {
    const previousFocus = this.focusedEditorObject
    const data = target ? (this.editorObjectMap.get(target) ?? null) : null
    this.selectedEditorObjectId = data ? data.id : -1
    if (
      this.renamingEditorObjectId !== -1 &&
      this.renamingEditorObjectId !== this.selectedEditorObjectId
    ) {
      this.renamingEditorObjectId = -1
    }
    if (previousFocus && previousFocus !== target) {
      this.focusedEditorObject = null
      this.applyEditorObjectStacking()
    }
    this.focusedEditorObject = target
    this.applyEditorObjectStacking()
    this.cameraManager.refreshCameraFocus(target)
    this.renderObjectTree()
  }

  // ========================================
  // OBJECT LIFECYCLE
  // ========================================

  private updateObjectTreeContext() {
    this.objectTreeManager.updateContext({
      editorObjects: this.editorObjects,
      renamingEditorObjectId: this.renamingEditorObjectId,
      selectedEditorObjectId: this.selectedEditorObjectId,
      dragObjectId: this.dragObjectId,
    })
  }

  private renderObjectTree() {
    this.updateObjectTreeContext()
    this.objectTreeManager.renderObjectTree()
  }

  private reorderEditorObjects(
    dragId: number,
    targetId: number,
    insertAfter: boolean
  ) {
    if (dragId === targetId) {
      return
    }
    const dragIndex = this.findEditorObjectIndexById(dragId)
    const targetIndex = this.findEditorObjectIndexById(targetId)
    if (dragIndex === -1 || targetIndex === -1) {
      return
    }
    const dragData = this.editorObjects[dragIndex]
    this.editorObjects.splice(dragIndex, 1)
    let insertIndex = insertAfter ? targetIndex + 1 : targetIndex
    if (dragIndex < targetIndex) {
      insertIndex -= 1
    }
    if (insertIndex < 0) {
      insertIndex = 0
    }
    if (insertIndex > this.editorObjects.length) {
      insertIndex = this.editorObjects.length
    }
    this.editorObjects.splice(insertIndex, 0, dragData)
    this.applyEditorObjectStacking()
    this.renderObjectTree()
  }

  private findEditorObjectIndexById(id: number) {
    for (let i = 0; i < this.editorObjects.length; i++) {
      if (this.editorObjects[i].id === id) {
        return i
      }
    }
    return -1
  }

  private resetDragState() {
    this.objectTreeManager.resetDragState()
    this.dragObjectId = -1
    this.updateObjectTreeContext()
  }

  private beginObjectRename(object: fabric.Object) {
    const data = this.editorObjectMap.get(object)
    if (!data) {
      return
    }
    this.renamingEditorObjectId = data.id
    this.renderObjectTree()
  }

  private commitObjectRename(id: number, value: string) {
    const data = this.getEditorObjectById(id)
    if (!data) {
      this.renamingEditorObjectId = -1
      this.renderObjectTree()
      return
    }
    const trimmed = value.trim()
    if (trimmed.length > 0) {
      data.name = trimmed
    }
    this.renamingEditorObjectId = -1
    this.renderObjectTree()
  }

  private cancelObjectRename() {
    if (this.renamingEditorObjectId === -1) {
      return
    }
    this.renamingEditorObjectId = -1
    this.renderObjectTree()
  }

  // Centralized contextmenu routing avoids conflicts between local handlers.

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
  // MARKER MANAGEMENT
  // ========================================

  private handleEnemyTypeClick(enemyType: EnemyType) {
    this.spawnEnemyMarker(enemyType)
    this.menuSystem.hideEnemySubmenu()
    this.menuSystem.hideObjectTypeMenu()
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
      console.log('[editor] panel contextmenu', {
        targetClass: target?.className ?? '',
        hasNode: !!node,
        clientX: event.clientX,
        clientY: event.clientY,
      })
    }
    this.menuSystem.hideObjectTypeMenu()
    if (node?.dataset.objectId) {
      const objectId = Number.parseInt(node.dataset.objectId, 10)
      this.focusEditorObjectById(objectId)
      const data = this.getEditorObjectById(objectId)
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

  private hasObjectOfType(type: ObjectType): boolean {
    return this.editorObjects.some((obj) => obj.type === type)
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

  // ========================================
  // MARKER MANAGEMENT
  // ========================================

  private spawnPlayerMarker(spawn?: { x: number; y: number }) {
    this.ensureFabricCanvas()
    if (!this.fabricCanvas) {
      console.warn('[editor] Fabric canvas not ready')
      return
    }
    let spawnX: number
    let spawnY: number
    if (spawn && spawn.x !== undefined && spawn.y !== undefined) {
      spawnX = spawn.x * EDITOR_PIXELS_PER_METER
      spawnY = spawn.y * EDITOR_PIXELS_PER_METER
    } else {
      const center = this.getViewportCenter()
      spawnX = center.x
      spawnY = center.y
    }
    if (this.playerMarker && this.playerMarker.canvas) {
      this.playerMarker.left = spawnX
      this.playerMarker.top = spawnY
      this.playerMarker.setCoords()
      this.fabricCanvas.setActiveObject(this.playerMarker)
      this.handleCanvasSelection(this.playerMarker)
      this.fabricCanvas.requestRenderAll()
      return
    }
    const marker = this.objectFactory.createPlayerMarker() as PlayerMarker
    marker.left = spawnX
    marker.top = spawnY
    marker.setCoords()
    this.playerMarker = marker
    this.fabricCanvas.add(marker)
    this.registerEditorObject(ObjectType.Player, marker)
    this.fabricCanvas.setActiveObject(marker)
    this.handleCanvasSelection(marker)
    this.fabricCanvas.renderAll()
  }

  private spawnEnemyMarker(
    enemyType: EnemyType = DEFAULT_ENEMY_TYPE,
    spawn?: {
      x: number
      y: number
      radius?: number
      moveSpeed?: number
      attackDesire?: number
      parryProficiency?: number
      initialPatrolMode?: EnemyPatrolMode
      maxHealth?: number
      maxPosture?: number
      maxToughness?: number
      color?: string
      facing?: number
      equipWeapon?: boolean
      mainWeapon?: MapEnemyWeapon
      secondaryWeapon?: MapEnemyWeapon
    }
  ) {
    this.ensureFabricCanvas()
    if (!this.fabricCanvas) {
      console.warn('[editor] Fabric canvas not ready')
      return
    }
    const template =
      CHARACTER_DEFAULT_DATA[enemyType] ?? CHARACTER_DEFAULT_DATA.default
    const radius = spawn?.radius ?? template.radius
    const moveSpeed = spawn?.moveSpeed ?? template.moveSpeed
    const attackDesire = spawn?.attackDesire ?? template.attackDesire
    const parryProficiency =
      spawn?.parryProficiency ?? template.parryProficiency
    const initialPatrolMode =
      spawn?.initialPatrolMode ?? template.initialPatrolMode
    const maxHealth = spawn?.maxHealth ?? template.maxHealth
    const maxPosture = spawn?.maxPosture ?? template.maxPosture
    const maxToughness = spawn?.maxToughness ?? template.maxToughness
    const color = spawn?.color ?? template.color
    const facing = spawn?.facing ?? 1
    const equipWeapon = spawn?.equipWeapon ?? false
    let centerX: number
    let centerY: number
    if (spawn && spawn.x !== undefined && spawn.y !== undefined) {
      centerX = spawn.x * EDITOR_PIXELS_PER_METER
      centerY = spawn.y * EDITOR_PIXELS_PER_METER
    } else {
      const center = this.getViewportCenter()
      centerX = center.x
      centerY = center.y
    }
    const marker = this.objectFactory.createEnemyMarker(
      enemyType,
      radius,
      color,
      equipWeapon
    ) as EnemyMarker
    marker.radius = radius
    marker.moveSpeed = moveSpeed
    marker.attackDesire = attackDesire
    marker.parryProficiency = parryProficiency
    marker.initialPatrolMode = initialPatrolMode
    marker.maxHealth = maxHealth
    marker.maxPosture = maxPosture
    marker.maxToughness = maxToughness
    marker.color = color
    marker.facing = facing
    marker.equipWeapon = equipWeapon
    marker.left = centerX
    marker.top = centerY
    marker.setCoords()
    this.fabricCanvas.add(marker)
    this.registerEditorObject(ObjectType.Enemy, marker)
    this.updateEnemyMarkerVisual(marker, radius, color, facing)
    const enemyData: EnemyMarkerData = {
      marker,
      enemyType,
      radius,
      moveSpeed,
      attackDesire,
      parryProficiency,
      initialPatrolMode,
      maxHealth,
      maxPosture,
      maxToughness,
      color,
      facing,
      equipWeapon,
      mainWeapon: spawn?.mainWeapon?.weaponType,
      secondaryWeapon: spawn?.secondaryWeapon?.weaponType,
    }
    this.enemyMarkers.push(enemyData)
    this.enemyMarkerMap.set(marker, enemyData)

    if (spawn?.mainWeapon) {
      this.createEnemyWeaponFromConfig(
        enemyData,
        spawn.mainWeapon,
        'main',
        centerX,
        centerY
      )
    }

    if (spawn?.secondaryWeapon) {
      this.createEnemyWeaponFromConfig(
        enemyData,
        spawn.secondaryWeapon,
        'secondary',
        centerX,
        centerY
      )
    }

    this.fabricCanvas.setActiveObject(marker)
    this.handleCanvasSelection(marker)
    this.fabricCanvas.renderAll()
  }

  private spawnWeaponMarker(
    weaponType: WeaponType,
    category: WeaponCategory,
    spawn?: {
      x?: number
      y?: number
      sizeLevel?: number
      attackDamage?: number
      postureDamage?: number
      toughnessDamage?: number
      bowAmmo?: number
    }
  ) {
    this.ensureFabricCanvas()
    if (!this.fabricCanvas) {
      console.warn('[editor] Fabric canvas not ready')
      return
    }
    let centerX: number
    let centerY: number
    if (spawn && spawn.x !== undefined && spawn.y !== undefined) {
      centerX = spawn.x * EDITOR_PIXELS_PER_METER
      centerY = spawn.y * EDITOR_PIXELS_PER_METER
    } else {
      const center = this.getViewportCenter()
      centerX = center.x
      centerY = center.y
    }
    const template = WEAPON_DEFAULT_DATA[weaponType]
    const sizeLevel = spawn?.sizeLevel ?? template.sizeLevel
    const attackDamage = spawn?.attackDamage ?? template.attackDamage
    const postureDamage = spawn?.postureDamage ?? template.postureDamage
    const toughnessDamage = spawn?.toughnessDamage ?? template.toughnessDamage
    const bowAmmo =
      spawn?.bowAmmo ??
      (weaponType === 'bow' ? DEFAULT_BOW_AMMO_PLAYER : undefined)
    const marker = this.objectFactory.createWeaponMarker(
      weaponType,
      category,
      sizeLevel,
      attackDamage,
      postureDamage,
      toughnessDamage,
      bowAmmo,
      template
    ) as WeaponMarker
    marker.left = centerX
    marker.top = centerY
    marker.setCoords()
    this.fabricCanvas.add(marker)
    this.registerEditorObject(ObjectType.Weapon, marker)
    const weaponData: WeaponMarkerData = {
      marker,
      weaponType,
      category,
      sizeLevel,
      attackDamage,
      postureDamage,
      toughnessDamage,
      bowAmmo,
    }
    this.weaponMarkers.push(weaponData)
    this.weaponMarkerMap.set(marker, weaponData)
    this.fabricCanvas.setActiveObject(marker)
    this.handleCanvasSelection(marker)
    this.fabricCanvas.renderAll()
  }

  // ========================================
  // CAMERA MANAGEMENT
  // ========================================

  // ========================================
  // OBJECT LIFECYCLE
  // ========================================

  private setActiveObjectType(type: ObjectType | null) {
    this.activeObjectType = type
  }

  // ========================================
  // SHAPE MANAGEMENT
  // ========================================

  private handleGroundShapeClick(shape: GroundShapeType) {
    this.ensureFabricCanvas()
    if (!this.fabricCanvas) {
      console.warn('[editor] Fabric canvas not ready')
      return
    }

    const center = this.getViewportCenter()
    const centerX = center.x
    const centerY = center.y
    let shapeObject: fabric.Object | null = null

    switch (shape) {
      case 'rect':
        shapeObject = new fabric.Rect(GROUND_RECT_OPTIONS)
        this.shapeManager.registerShapeResetData(shapeObject, {
          kind: 'rect',
          width: GROUND_RECT_OPTIONS.width ?? 0,
          height: GROUND_RECT_OPTIONS.height ?? 0,
        })
        break
      case 'circle':
        shapeObject = new fabric.Circle(GROUND_CIRCLE_OPTIONS)
        this.shapeManager.registerShapeResetData(shapeObject, {
          kind: 'circle',
          radius: GROUND_CIRCLE_OPTIONS.radius ?? 0,
        })
        break
      case 'triangle':
        shapeObject = new fabric.Polygon(
          createTrianglePoints(),
          GROUND_TRIANGLE_OPTIONS
        )
        this.shapeManager.registerShapeResetData(shapeObject, {
          kind: 'triangle',
          points: TRIANGLE_POINT_DATA,
        })
        break
      case 'polygon': {
        const polygon = new fabric.Polygon(
          createEditablePolygonPoints(),
          GROUND_EDITABLE_POLYGON_OPTIONS
        )
        this.setupEditablePolygon(polygon)
        this.shapeManager.registerShapeResetData(polygon, {
          kind: 'polygon',
          points: POLYGON_POINT_DATA,
        })
        shapeObject = polygon
        break
      }
      default:
        break
    }

    if (!shapeObject) {
      console.warn('[editor] shape object not created', shape)
      return
    }

    this.patternManager.applyGroundPatternToObject(shapeObject)
    shapeObject.left = centerX
    shapeObject.top = centerY
    shapeObject.setCoords()
    this.fabricCanvas.add(shapeObject)
    this.registerEditorObject(ObjectType.Ground, shapeObject)
    this.fabricCanvas.setActiveObject(shapeObject)
    this.handleCanvasSelection(shapeObject)
    this.fabricCanvas.renderAll()
    this.menuSystem.hideAllSubmenus()
    this.menuSystem.hideObjectTypeMenu()
  }

  private handleObstacleShapeClick(shape: GroundShapeType) {
    this.ensureFabricCanvas()
    if (!this.fabricCanvas) {
      console.warn('[editor] Fabric canvas not ready')
      return
    }

    const center = this.getViewportCenter()
    const centerX = center.x
    const centerY = center.y
    let shapeObject: fabric.Object | null = null

    switch (shape) {
      case 'rect':
        shapeObject = new fabric.Rect(OBSTACLE_RECT_OPTIONS)
        this.shapeManager.registerShapeResetData(shapeObject, {
          kind: 'rect',
          width: OBSTACLE_RECT_OPTIONS.width ?? 0,
          height: OBSTACLE_RECT_OPTIONS.height ?? 0,
        })
        break
      case 'circle':
        shapeObject = new fabric.Circle(OBSTACLE_CIRCLE_OPTIONS)
        this.shapeManager.registerShapeResetData(shapeObject, {
          kind: 'circle',
          radius: OBSTACLE_CIRCLE_OPTIONS.radius ?? 0,
        })
        break
      case 'triangle':
        shapeObject = new fabric.Polygon(
          createTrianglePoints(),
          OBSTACLE_TRIANGLE_OPTIONS
        )
        this.shapeManager.registerShapeResetData(shapeObject, {
          kind: 'triangle',
          points: TRIANGLE_POINT_DATA,
        })
        break
      case 'polygon': {
        const polygon = new fabric.Polygon(
          createEditablePolygonPoints(),
          OBSTACLE_EDITABLE_POLYGON_OPTIONS
        )
        this.setupEditablePolygon(polygon)
        this.shapeManager.registerShapeResetData(polygon, {
          kind: 'polygon',
          points: POLYGON_POINT_DATA,
        })
        shapeObject = polygon
        break
      }
      default:
        break
    }

    if (!shapeObject) {
      console.warn('[editor] shape object not created', shape)
      return
    }

    this.patternManager.applyObstaclePatternToObject(shapeObject)
    shapeObject.left = centerX
    shapeObject.top = centerY
    shapeObject.setCoords()
    this.fabricCanvas.add(shapeObject)
    this.registerEditorObject(ObjectType.Obstacle, shapeObject)
    this.fabricCanvas.setActiveObject(shapeObject)
    this.handleCanvasSelection(shapeObject)
    this.fabricCanvas.renderAll()
    this.menuSystem.hideAllSubmenus()
    this.menuSystem.hideObjectTypeMenu()
  }

  // ========================================
  // MARKER MANAGEMENT
  // ========================================

  private handleWeaponTypeClick(
    weaponType: WeaponType,
    category: WeaponCategory,
    sizeLevel?: number
  ) {
    this.spawnWeaponMarker(weaponType, category, { sizeLevel })
    this.menuSystem.hideWeaponMenu()
    this.menuSystem.hideObjectTypeMenu()
  }

  // ========================================
  // SHAPE MANAGEMENT
  // ========================================

  // ========================================
  // POLYGON EDITING
  // ========================================

  private setupEditablePolygon(polygon: fabric.Polygon) {
    this.polygonEditor.setupEditablePolygon(polygon)
  }

  private handleEditablePolygonPointerDown(opt: fabric.IEvent<MouseEvent>) {
    this.polygonEditor.handleEditablePolygonPointerDown(opt)
  }

  // ========================================
  // CAMERA MANAGEMENT
  // ========================================

  // ========================================
  // MARKER MANAGEMENT
  // ========================================

  private isPlayerMarker(object: fabric.Object | null): object is PlayerMarker {
    return (
      object instanceof fabric.Group &&
      (object as PlayerMarker).editorShape === 'player-marker'
    )
  }

  private isEnemyMarker(object: fabric.Object | null): object is EnemyMarker {
    return (
      object instanceof fabric.Group &&
      (object as EnemyMarker).editorShape === 'enemy-marker'
    )
  }

  private isWeaponMarker(object: fabric.Object | null): object is WeaponMarker {
    return (
      object instanceof fabric.Group &&
      (object as WeaponMarker).editorShape === 'weapon-marker'
    )
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
    if (this.isPlayerMarker(object)) {
      return true
    }
    if (this.isEnemyMarker(object)) {
      return true
    }
    if (this.isWeaponMarker(object)) {
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
    if (this.isPlayerMarker(target)) {
      this.showPolygonMenuWithActions(
        ['rename', 'delete'],
        target,
        -1,
        clientX,
        clientY
      )
      return
    }
    if (this.isEnemyMarker(target)) {
      this.showPolygonMenuWithActions(
        ['properties', 'rename', 'delete'],
        target,
        -1,
        clientX,
        clientY
      )
      return
    }
    if (this.isWeaponMarker(target)) {
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
      if (this.isWeaponMarker(target)) {
        await this.propertiesPanel.showWeaponPropertiesDialog(target)
      } else if (this.isEnemyMarker(target)) {
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
      if (this.isPlayerMarker(target)) {
        this.removePlayerMarker(target)
      }
      if (this.isEnemyMarker(target)) {
        this.removeEnemyMarker(target)
      }
      this.unregisterEditorObject(target)
      canvas.remove(target)
      this.shapeManager.deleteShapeResetData(target)
      canvas.requestRenderAll()
      this.contextMenu.hide()
      return
    }
    if (action === 'rename') {
      this.beginObjectRename(target)
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
        return
      }
      this.shapeManager.resetShape(target)
      canvas.requestRenderAll()
      this.contextMenu.hide()
      return
    }
    if (action === 'square') {
      this.shapeManager.makeSquare(target)
      canvas.requestRenderAll()
      this.contextMenu.hide()
      return
    }
    if (action === 'equilateral') {
      this.shapeManager.makeEquilateralTriangle(target)
      canvas.requestRenderAll()
      this.contextMenu.hide()
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
  }

  // ========================================
  // MARKER MANAGEMENT
  // ========================================

  private removePlayerMarker(marker: PlayerMarker) {
    if (this.playerMarker === marker) {
      this.playerMarker = null
    }
  }

  private removeEnemyMarker(marker: EnemyMarker) {
    const data = this.enemyMarkerMap.get(marker)
    if (!data) {
      return
    }
    this.enemyMarkerMap.delete(marker)
    for (let i = 0; i < this.enemyMarkers.length; i++) {
      if (this.enemyMarkers[i].marker === marker) {
        this.enemyMarkers.splice(i, 1)
        break
      }
    }
  }

  private removeWeaponMarker(marker: WeaponMarker) {
    const data = this.weaponMarkerMap.get(marker)
    if (!data) {
      return
    }
    this.weaponMarkerMap.delete(marker)
    for (let i = 0; i < this.weaponMarkers.length; i++) {
      if (this.weaponMarkers[i].marker === marker) {
        this.weaponMarkers.splice(i, 1)
        break
      }
    }
  }

  private updateEnemyMarkerVisual(
    marker: EnemyMarker,
    nextRadius: number,
    nextColor: string,
    nextFacing: number
  ) {
    const body = marker.item(0)
    const eye = marker.item(1)
    const bodyRadiusPx = computeEnemyBodyRadiusPx(
      nextRadius,
      EDITOR_PIXELS_PER_METER
    )
    const eyeRadiusPx = 0.08 * EDITOR_PIXELS_PER_METER
    // Adjust eye offset based on facing
    const eyeOffsetX = bodyRadiusPx * 0.5 * nextFacing
    const eyeOffsetY = -bodyRadiusPx * 0.5

    marker.scaleX = 1
    marker.scaleY = 1
    marker.width = bodyRadiusPx * 2
    marker.height = bodyRadiusPx * 2

    if (body instanceof fabric.Circle) {
      body.set('radius', bodyRadiusPx)
      body.set('fill', nextColor)
      body.set('stroke', nextColor)
    }
    if (eye instanceof fabric.Circle) {
      eye.set('radius', eyeRadiusPx)
      eye.set('left', eyeOffsetX)
      eye.set('top', eyeOffsetY)
    }

    marker.radius = nextRadius
    marker.color = nextColor
    marker.facing = nextFacing
    marker.setCoords()
  }

  private updateWeaponMarkerVisual(
    marker: WeaponMarker,
    nextSizeLevel: number
  ) {
    const item = marker.item(0)
    if (!(item instanceof fabric.Object)) {
      return
    }
    const shape = item as unknown as WeaponShape
    const template = WEAPON_DEFAULT_DATA[marker.weaponType]
    const isBow = marker.weaponType === 'bow'
    const dims = computeWeaponRenderDimensions(
      template,
      nextSizeLevel,
      EDITOR_PIXELS_PER_METER,
      isBow
    )

    shape.weaponWidthPx = dims.widthPx
    shape.weaponHeightPx = dims.heightPx
    shape.weaponBoundingWidthPx = dims.boundingWidthPx
    shape.weaponBoundingHeightPx = dims.boundingHeightPx
    shape.width = dims.boundingWidthPx
    shape.height = dims.boundingHeightPx
    shape.setCoords()

    marker.sizeLevel = nextSizeLevel
    marker.width = dims.boundingWidthPx
    marker.height = dims.boundingHeightPx
    marker.setCoords()
  }

  private createEnemyWeaponFromConfig(
    enemyData: EnemyMarkerData,
    config: MapEnemyWeapon,
    slot: 'main' | 'secondary',
    centerX: number,
    centerY: number
  ) {
    const result = this.objectFactory.createEnemyWeaponMarkerFromConfig(
      config,
      slot,
      centerX,
      centerY,
      WEAPON_DEFAULT_DATA
    )
    const weaponMarker = result.weaponMarker as WeaponMarker
    const weaponData = result.weaponData as WeaponMarkerData
    this.weaponMarkerMap.set(weaponMarker, weaponData)
    const markerKey =
      slot === 'main' ? 'mainWeaponMarker' : 'secondaryWeaponMarker'
    const weaponKey = slot === 'main' ? 'mainWeapon' : 'secondaryWeapon'
    enemyData[markerKey] = weaponMarker
    enemyData[weaponKey] = config.weaponType
  }

  private getOrCreateEnemyWeaponMarker(
    enemyData: EnemyMarkerData,
    weaponType: WeaponType,
    slot: 'main' | 'secondary'
  ): WeaponMarker | null {
    const markerKey =
      slot === 'main' ? 'mainWeaponMarker' : 'secondaryWeaponMarker'
    const weaponKey = slot === 'main' ? 'mainWeapon' : 'secondaryWeapon'
    let weaponMarker = enemyData[markerKey]

    if (weaponMarker && weaponMarker.weaponType !== weaponType) {
      this.weaponMarkerMap.delete(weaponMarker)
      weaponMarker = undefined
      enemyData[markerKey] = undefined
      enemyData[weaponKey] = undefined
    }

    if (!weaponMarker) {
      const template = WEAPON_DEFAULT_DATA[weaponType]
      const result = this.objectFactory.createEnemyWeaponMarkerFromConfig(
        {
          weaponType,
          sizeLevel: template.sizeLevel,
          attackDamage: template.attackDamage,
          postureDamage: template.postureDamage,
          toughnessDamage: template.toughnessDamage,
          bowAmmo: weaponType === 'bow' ? DEFAULT_BOW_AMMO_ENEMY : undefined,
        },
        slot,
        enemyData.marker.left ?? 0,
        enemyData.marker.top ?? 0,
        WEAPON_DEFAULT_DATA
      )

      weaponMarker = result.weaponMarker as WeaponMarker
      const weaponData = result.weaponData as WeaponMarkerData
      this.weaponMarkerMap.set(weaponMarker, weaponData)
      enemyData[markerKey] = weaponMarker
      enemyData[weaponKey] = weaponType
    }

    return weaponMarker
  }

  // ========================================
  // CAMERA MANAGEMENT
  // ========================================

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
  // CAMERA MANAGEMENT
  // ========================================

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
    this.updateLocalization()
    this.gameCanvas.style.visibility = 'hidden'
  }

  showEditorForCurrentMap() {
    this.visible = true
    this.editorOverlay.classList.add('is-visible')
    this.updateLocalization()
    this.showEditorView()
    this.gameCanvas.style.visibility = 'hidden'
  }

  hide() {
    this.visible = false
    this.editorOverlay.classList.remove('is-visible')
    this.menuSystem.hideAll()
    this.contextMenu.hide()
    this.cancelObjectRename()
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
