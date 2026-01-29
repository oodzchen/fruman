import { fabric } from 'fabric'

import { DialogManager } from './DialogManager'
import type { GameClient } from './GameClient'
import { localizer } from './Localizer'
import {
  DEFAULT_BOW_AMMO_ENEMY,
  DEFAULT_BOW_AMMO_PLAYER,
  DEFAULT_PLAYER_RADIUS,
  ENEMY_TEMPLATES,
  WEAPON_TEMPLATES,
} from './constants'
import { computeWeaponScaleFactor } from './ecs/factories/PlayerFactory'
import { EditorMapListManager } from './editor/EditorMapListManager'
import { EditorMapSerializer } from './editor/EditorMapSerializer'
import { EditorObjectFactory } from './editor/EditorObjectFactory'
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
import { EditorUIHelper } from './editor/EditorUIHelper'
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

const POLYGON_POINT_POOL: fabric.Point[] = []

const acquirePoint = (x: number, y: number) => {
  const point = POLYGON_POINT_POOL.pop() ?? new fabric.Point(0, 0)
  point.x = x
  point.y = y
  return point
}

const releasePoint = (point: fabric.Point) => {
  POLYGON_POINT_POOL.push(point)
}

const GROUND_FILL_COLOR = 'rgba(107, 74, 43, 0.85)'
const CAMERA_FRAME_STROKE = 'rgba(220, 220, 220, 0.75)'
const CAMERA_FRAME_FILL = 'rgba(200, 200, 200, 0.06)'
const CAMERA_FRAME_FILL_UNFOCUSED = 'rgba(0, 0, 0, 0)'
const CAMERA_ICON_STROKE = 'rgba(230, 230, 230, 0.9)'
const CAMERA_ICON_FILL = 'rgba(230, 230, 230, 0.18)'
const EDITOR_PIXELS_PER_METER = 50
const PLAYER_BODY_COLOR = '#F58025'
const PLAYER_EYE_COLOR = '#000000'
const ENEMY_EYE_COLOR = '#000000'
const DEFAULT_ENEMY_TYPE: EnemyType = 'default'
const DEBUG_EDITOR_MENU = false
const OBSTACLE_FILL_COLOR = 'rgba(112, 64, 14, 0.85)'
const SNAP_THRESHOLD_PX = 10
const SNAP_GUIDE_COLOR = 'rgba(240, 220, 180, 0.75)'
const SNAP_EVERY_N_FRAMES = 2

type WeaponTemplate = (typeof WEAPON_TEMPLATES)[WeaponType]

const GROUND_RECT_OPTIONS: fabric.IRectOptions = {
  width: 160,
  height: 44,
  fill: GROUND_FILL_COLOR,
  originX: 'center',
  originY: 'center',
  selectable: true,
  hasControls: true,
  lockScalingFlip: true,
  objectCaching: false,
  strokeUniform: true,
}

const OBSTACLE_RECT_OPTIONS: fabric.IRectOptions = {
  width: 160,
  height: 44,
  fill: OBSTACLE_FILL_COLOR,
  originX: 'center',
  originY: 'center',
  selectable: true,
  hasControls: true,
  lockScalingFlip: true,
  objectCaching: false,
  strokeUniform: true,
}

const GROUND_CIRCLE_OPTIONS: fabric.ICircleOptions = {
  radius: 60,
  fill: GROUND_FILL_COLOR,
  originX: 'center',
  originY: 'center',
  selectable: true,
  hasControls: true,
  lockScalingFlip: true,
  objectCaching: false,
  strokeUniform: true,
}

const OBSTACLE_CIRCLE_OPTIONS: fabric.ICircleOptions = {
  radius: 60,
  fill: OBSTACLE_FILL_COLOR,
  originX: 'center',
  originY: 'center',
  selectable: true,
  hasControls: true,
  lockScalingFlip: true,
  objectCaching: false,
  strokeUniform: true,
}

const TRIANGLE_POINT_DATA: ReadonlyArray<readonly [number, number]> = [
  [-70, 50],
  [0, -60],
  [70, 50],
]

const POLYGON_POINT_DATA: ReadonlyArray<readonly [number, number]> = [
  [-90, -40],
  [60, -60],
  [110, 10],
  [60, 70],
  [-80, 60],
]

const GROUND_TRIANGLE_OPTIONS: fabric.IPolylineOptions = {
  fill: GROUND_FILL_COLOR,
  originX: 'center',
  originY: 'center',
  selectable: true,
  hasControls: true,
  lockScalingFlip: true,
  objectCaching: false,
  strokeUniform: true,
}

const OBSTACLE_TRIANGLE_OPTIONS: fabric.IPolylineOptions = {
  fill: OBSTACLE_FILL_COLOR,
  originX: 'center',
  originY: 'center',
  selectable: true,
  hasControls: true,
  lockScalingFlip: true,
  objectCaching: false,
  strokeUniform: true,
}

const GROUND_EDITABLE_POLYGON_OPTIONS: fabric.IPolylineOptions = {
  fill: GROUND_FILL_COLOR,
  originX: 'center',
  originY: 'center',
  selectable: true,
  hasControls: true,
  lockScalingFlip: true,
  objectCaching: false,
  strokeUniform: true,
  perPixelTargetFind: false,
}

const OBSTACLE_EDITABLE_POLYGON_OPTIONS: fabric.IPolylineOptions = {
  fill: OBSTACLE_FILL_COLOR,
  originX: 'center',
  originY: 'center',
  selectable: true,
  hasControls: true,
  lockScalingFlip: true,
  objectCaching: false,
  strokeUniform: true,
  perPixelTargetFind: false,
}

const CAMERA_FRAME_OPTIONS: fabric.IRectOptions = {
  fill: CAMERA_FRAME_FILL,
  stroke: CAMERA_FRAME_STROKE,
  strokeWidth: 2,
  strokeDashArray: [6, 6],
  originX: 'center',
  originY: 'center',
  selectable: true,
  hasControls: true,
  lockScalingFlip: true,
  lockRotation: true,
  lockUniScaling: true,
  centeredScaling: true,
  objectCaching: false,
  strokeUniform: true,
  cornerStyle: 'circle',
  cornerColor: 'rgba(230, 230, 230, 0.9)',
  cornerStrokeColor: 'rgba(20, 20, 20, 0.4)',
  cornerSize: 10,
  transparentCorners: false,
}

const createTrianglePoints = () => {
  const points: fabric.Point[] = new Array(TRIANGLE_POINT_DATA.length)
  for (let i = 0; i < TRIANGLE_POINT_DATA.length; i++) {
    const data = TRIANGLE_POINT_DATA[i]
    points[i] = acquirePoint(data[0], data[1])
  }
  return points
}

const createEditablePolygonPoints = () => {
  const points: fabric.Point[] = new Array(POLYGON_POINT_DATA.length)
  for (let i = 0; i < POLYGON_POINT_DATA.length; i++) {
    const data = POLYGON_POINT_DATA[i]
    points[i] = acquirePoint(data[0], data[1])
  }
  return points
}

export enum EditorView {
  MapList,
  Editor,
}

enum EditorSubmenuMode {
  None = 'none',
  Object = 'object',
  Ground = 'ground',
  Obstacle = 'obstacle',
  Weapon = 'weapon',
  Enemy = 'enemy',
}

interface SnapBounds {
  left: number
  right: number
  top: number
  bottom: number
  centerX: number
  centerY: number
}

export class EditorManager {
  private editorOverlay: HTMLDivElement
  private editorBackBtn: HTMLButtonElement
  private editorSidebar: HTMLDivElement
  private editorPanelCollapseBtn: HTMLButtonElement
  private editorPanelCollapsedBtn: HTMLButtonElement
  private editorObjectPanel: HTMLDivElement
  private editorObjectTree: HTMLDivElement
  private editorWorkspace: HTMLDivElement
  private editorCanvas: HTMLCanvasElement
  private gameCanvas: HTMLCanvasElement
  private editorMapListView: HTMLDivElement
  private editorMapList: HTMLDivElement
  private editorMapListMenu: HTMLDivElement
  private editorMapCreateBtn: HTMLButtonElement
  private editorMapRenameBtn: HTMLButtonElement
  private editorMapDefaultBtn: HTMLButtonElement
  private editorActions: HTMLDivElement
  private editorPreviewBtn: HTMLButtonElement
  private editorSaveBtn: HTMLButtonElement
  private editorObjectItems: NodeListOf<HTMLButtonElement>
  private objectTypeMenu: HTMLDivElement
  private panelMenu: HTMLDivElement
  private panelMenuAddBtn: HTMLButtonElement
  private groundMenuItem: HTMLButtonElement
  private groundSubmenu: HTMLDivElement
  private groundSubmenuItems: NodeListOf<HTMLButtonElement>
  private groundSubmenuBackBtn: HTMLButtonElement
  private obstacleMenuItem: HTMLButtonElement
  private obstacleSubmenu: HTMLDivElement
  private obstacleSubmenuItems: NodeListOf<HTMLButtonElement>
  private obstacleSubmenuBackBtn: HTMLButtonElement
  private weaponMenuItem: HTMLButtonElement
  private weaponMenu: HTMLDivElement
  private weaponGroupTitles: NodeListOf<HTMLDivElement>
  private weaponItems: NodeListOf<HTMLButtonElement>
  private weaponMenuBackBtn: HTMLButtonElement
  private enemyMenuItem: HTMLButtonElement
  private enemySubmenu: HTMLDivElement
  private enemySubmenuItems: NodeListOf<HTMLButtonElement>
  private enemySubmenuBackBtn: HTMLButtonElement
  private objectTypeMenuBackBtn: HTMLButtonElement
  private polygonMenu: HTMLDivElement
  private polygonMenuButtons: HTMLButtonElement[] = []
  private dialogManager: DialogManager
  private mapSerializer: EditorMapSerializer
  private propertiesPanel: EditorPropertiesPanel
  private mapListManager: EditorMapListManager

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
  private groundPatternImage: HTMLImageElement | null = null
  private groundPatternMap = new Map<fabric.Object, fabric.Pattern>()
  private obstaclePatternImage: HTMLImageElement | null = null
  private obstaclePatternMap = new Map<fabric.Object, fabric.Pattern>()
  private isPanning = false
  private lastClientX = 0
  private lastClientY = 0
  private polygonEditor: EditorPolygonEditor
  private objectFactory: EditorObjectFactory
  private polygonMenuActions: (
    | 'add'
    | 'remove'
    | 'delete'
    | 'reset'
    | 'square'
    | 'equilateral'
    | 'zoom'
    | 'rename'
    | 'properties'
  )[] = []
  private polygonMenuPolygon: EditablePolygon | null = null
  private polygonMenuTarget: fabric.Object | null = null
  private polygonMenuPointIndex = -1
  private polygonMenuInsertX = 0
  private polygonMenuInsertY = 0
  private shapeResetMap = new Map<fabric.Object, ShapeResetData>()
  private cameraViews: CameraViewData[] = []
  private cameraViewMap = new Map<fabric.Object, CameraViewData>()
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
  private panelMenuX = 0
  private panelMenuY = 0
  private objectTypeMenuX = 0
  private objectTypeMenuY = 0
  private editorMenuMode: EditorSubmenuMode = EditorSubmenuMode.None
  private editorMenuSelectedIndex = 0
  private boundHandleEditorMenuMouseEnter: (event: Event) => void
  private focusedEditorObject: fabric.Object | null = null
  private dragObjectId = -1
  private dragTargetId = -1
  private dragInsertAfter = false
  private dragPreviewId = -1
  private dragPreviewAfter = false
  private groundPatternTransformScratch: number[] = [1, 0, 0, 1, 0, 0]
  private obstaclePatternTransformScratch: number[] = [1, 0, 0, 1, 0, 0]
  private snapGuideVertical: fabric.Line | null = null
  private snapGuideHorizontal: fabric.Line | null = null
  private snapBoundsScratchA: SnapBounds = {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    centerX: 0,
    centerY: 0,
  }
  private snapBoundsScratchB: SnapBounds = {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    centerX: 0,
    centerY: 0,
  }
  private snapCandidateBounds: SnapBounds[] = []
  private snapBoundsPool: SnapBounds[] = []
  private snapActiveTarget: fabric.Object | null = null
  private snapFrameCounter = 0
  private readonly invPixelsPerMeter = 1 / EDITOR_PIXELS_PER_METER

  constructor() {
    const overlay = document.getElementById('editorOverlay')
    const backBtn = document.getElementById('editorBackBtn')
    const sidebar = document.getElementById('editorSidebar')
    const panelCollapseBtn = document.getElementById('editorPanelCollapse')
    const panelCollapsedBtn = document.getElementById('editorPanelCollapsed')
    const objectPanel = document.getElementById('editorObjectPanel')
    const objectTree = document.getElementById('editorObjectTree')
    const workspace = document.getElementById('editorWorkspace')
    const editorCanvas = document.getElementById('editorCanvas')
    const gameCanvas = document.getElementById('gameCanvas')
    const mapListView = document.getElementById('editorMapListView')
    const mapList = document.getElementById('editorMapList')
    const actions = document.getElementById('editorActions')
    const mapListMenu = document.getElementById('editorMapListMenu')
    const mapCreateBtn = document.getElementById('editorMapCreateBtn')
    const mapRenameBtn = document.getElementById('editorMapRenameBtn')
    const mapDefaultBtn = document.getElementById('editorMapDefaultBtn')
    const previewBtn = document.getElementById('editorPreviewBtn')
    const saveBtn = document.getElementById('editorSaveBtn')
    const objectItems = document.querySelectorAll<HTMLButtonElement>(
      '.editor-object-item'
    )
    const groundMenu = document.querySelector<HTMLButtonElement>(
      '.editor-object-item[data-type="ground"]'
    )
    const obstacleMenu = document.querySelector<HTMLButtonElement>(
      '.editor-object-item[data-type="obstacle"]'
    )
    const groundSubmenu = document.getElementById('editorGroundSubmenu')
    const groundSubmenuItems = document.querySelectorAll<HTMLButtonElement>(
      '#editorGroundSubmenu .editor-submenu-item'
    )
    const groundSubmenuBackBtn = document.querySelector<HTMLButtonElement>(
      '#editorGroundSubmenu .editor-submenu-item[data-action="back"]'
    )
    const obstacleSubmenu = document.getElementById('editorObstacleSubmenu')
    const obstacleSubmenuItems = document.querySelectorAll<HTMLButtonElement>(
      '#editorObstacleSubmenu .editor-submenu-item'
    )
    const obstacleSubmenuBackBtn = document.querySelector<HTMLButtonElement>(
      '#editorObstacleSubmenu .editor-submenu-item[data-action="back"]'
    )
    const weaponMenu = document.querySelector<HTMLButtonElement>(
      '.editor-object-item[data-type="weapon"]'
    )
    const weaponSubmenu = document.getElementById('editorWeaponMenu')
    const weaponGroupTitles = document.querySelectorAll<HTMLDivElement>(
      '#editorWeaponMenu .editor-submenu-group-title'
    )
    const weaponItems = document.querySelectorAll<HTMLButtonElement>(
      '#editorWeaponMenu .editor-submenu-item'
    )
    const weaponMenuBackBtn = document.querySelector<HTMLButtonElement>(
      '#editorWeaponMenu .editor-submenu-item[data-action="back"]'
    )
    const enemyMenu = document.querySelector<HTMLButtonElement>(
      '.editor-object-item[data-type="enemy"]'
    )
    const enemySubmenu = document.getElementById('editorEnemySubmenu')
    const enemySubmenuItems = document.querySelectorAll<HTMLButtonElement>(
      '#editorEnemySubmenu .editor-submenu-item'
    )
    const enemySubmenuBackBtn = document.querySelector<HTMLButtonElement>(
      '#editorEnemySubmenu .editor-submenu-item[data-action="back"]'
    )
    const objectTypeMenu = document.getElementById('editorObjectTypeMenu')
    const objectTypeMenuBackBtn = document.querySelector<HTMLButtonElement>(
      '#editorObjectTypeMenu .editor-object-item[data-action="back"]'
    )

    const polygonMenu = document.getElementById('editorPolygonMenu')
    const panelMenu = document.getElementById('editorPanelMenu')
    const panelMenuAdd = document.getElementById('editorPanelMenuAdd')
    const polygonMenuPrimary = document.getElementById(
      'editorPolygonMenuPrimary'
    )
    const polygonMenuSecondary = document.getElementById(
      'editorPolygonMenuSecondary'
    )
    const polygonMenuTertiary = document.getElementById(
      'editorPolygonMenuTertiary'
    )
    const polygonMenuQuaternary = document.getElementById(
      'editorPolygonMenuQuaternary'
    )

    if (
      !(overlay instanceof HTMLDivElement) ||
      !(backBtn instanceof HTMLButtonElement) ||
      !(sidebar instanceof HTMLDivElement) ||
      !(panelCollapseBtn instanceof HTMLButtonElement) ||
      !(panelCollapsedBtn instanceof HTMLButtonElement) ||
      !(objectPanel instanceof HTMLDivElement) ||
      !(objectTree instanceof HTMLDivElement) ||
      !(workspace instanceof HTMLDivElement) ||
      !(editorCanvas instanceof HTMLCanvasElement) ||
      !(gameCanvas instanceof HTMLCanvasElement) ||
      !(mapListView instanceof HTMLDivElement) ||
      !(mapList instanceof HTMLDivElement) ||
      !(actions instanceof HTMLDivElement) ||
      !(mapListMenu instanceof HTMLDivElement) ||
      !(mapCreateBtn instanceof HTMLButtonElement) ||
      !(mapRenameBtn instanceof HTMLButtonElement) ||
      !(mapDefaultBtn instanceof HTMLButtonElement) ||
      !(previewBtn instanceof HTMLButtonElement) ||
      !(saveBtn instanceof HTMLButtonElement) ||
      !(groundMenu instanceof HTMLButtonElement) ||
      !(groundSubmenu instanceof HTMLDivElement) ||
      !(groundSubmenuBackBtn instanceof HTMLButtonElement) ||
      !(obstacleMenu instanceof HTMLButtonElement) ||
      !(obstacleSubmenu instanceof HTMLDivElement) ||
      !(obstacleSubmenuBackBtn instanceof HTMLButtonElement) ||
      !(weaponMenu instanceof HTMLButtonElement) ||
      !(weaponSubmenu instanceof HTMLDivElement) ||
      !(weaponMenuBackBtn instanceof HTMLButtonElement) ||
      !(enemyMenu instanceof HTMLButtonElement) ||
      !(enemySubmenu instanceof HTMLDivElement) ||
      !(enemySubmenuBackBtn instanceof HTMLButtonElement) ||
      !(polygonMenu instanceof HTMLDivElement) ||
      !(panelMenu instanceof HTMLDivElement) ||
      !(panelMenuAdd instanceof HTMLButtonElement) ||
      !(objectTypeMenu instanceof HTMLDivElement) ||
      !(objectTypeMenuBackBtn instanceof HTMLButtonElement) ||
      !(polygonMenuPrimary instanceof HTMLButtonElement) ||
      !(polygonMenuSecondary instanceof HTMLButtonElement) ||
      !(polygonMenuTertiary instanceof HTMLButtonElement) ||
      !(polygonMenuQuaternary instanceof HTMLButtonElement)
    ) {
      throw new Error('Editor elements are missing.')
    }

    this.editorOverlay = overlay
    this.editorBackBtn = backBtn
    this.editorSidebar = sidebar
    this.editorPanelCollapseBtn = panelCollapseBtn
    this.editorPanelCollapsedBtn = panelCollapsedBtn
    this.editorObjectPanel = objectPanel
    this.editorObjectTree = objectTree
    this.editorWorkspace = workspace
    this.editorCanvas = editorCanvas
    this.gameCanvas = gameCanvas
    this.editorMapListView = mapListView
    this.editorMapList = mapList
    this.editorActions = actions
    this.editorMapListMenu = mapListMenu
    this.editorMapCreateBtn = mapCreateBtn
    this.editorMapRenameBtn = mapRenameBtn
    this.editorMapDefaultBtn = mapDefaultBtn
    this.editorPreviewBtn = previewBtn
    this.editorSaveBtn = saveBtn
    this.editorObjectItems = objectItems
    this.objectTypeMenu = objectTypeMenu
    this.panelMenu = panelMenu
    this.panelMenuAddBtn = panelMenuAdd
    this.groundMenuItem = groundMenu
    this.groundSubmenu = groundSubmenu
    this.groundSubmenuItems = groundSubmenuItems
    this.groundSubmenuBackBtn = groundSubmenuBackBtn
    this.obstacleMenuItem = obstacleMenu
    this.obstacleSubmenu = obstacleSubmenu
    this.obstacleSubmenuItems = obstacleSubmenuItems
    this.obstacleSubmenuBackBtn = obstacleSubmenuBackBtn
    this.weaponMenuItem = weaponMenu
    this.weaponMenu = weaponSubmenu
    this.weaponGroupTitles = weaponGroupTitles
    this.weaponItems = weaponItems
    this.weaponMenuBackBtn = weaponMenuBackBtn
    this.enemyMenuItem = enemyMenu
    this.enemySubmenu = enemySubmenu
    this.enemySubmenuItems = enemySubmenuItems
    this.enemySubmenuBackBtn = enemySubmenuBackBtn
    this.objectTypeMenuBackBtn = objectTypeMenuBackBtn

    this.polygonMenu = polygonMenu
    this.polygonMenuButtons = [
      polygonMenuPrimary,
      polygonMenuSecondary,
      polygonMenuTertiary,
      polygonMenuQuaternary,
    ]

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
      spawnCameraViewFrame: (camera) => this.spawnCameraViewFrame(camera),
      applyPlacedShapes: (shapes) => this.applyPlacedShapes(shapes),
      applyEnemies: (enemies) => this.applyEnemies(enemies),
      applyWeapons: (weapons) => this.applyWeapons(weapons),
      renderObjectTree: () => this.renderObjectTree(),
      requestRenderAll: () => {
        this.fabricCanvas?.requestRenderAll()
      },
      getPlayerMarker: () => this.playerMarker,
      getCameraViews: () => this.cameraViews,
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
      updateEnemyMarkerVisual: (m, r, c) =>
        this.updateEnemyMarkerVisual(m, r, c),
      updateWeaponMarkerVisual: (m, s) => this.updateWeaponMarkerVisual(m, s),
    })

    this.mapListManager = new EditorMapListManager({
      editorMapListView: this.editorMapListView,
      editorMapList: this.editorMapList,
      editorMapListMenu: this.editorMapListMenu,
      editorBackBtn: this.editorBackBtn,
      editorMapCreateBtn: this.editorMapCreateBtn,
      editorMapRenameBtn: this.editorMapRenameBtn,
      editorMapDefaultBtn: this.editorMapDefaultBtn,
      dialogManager: this.dialogManager,
      mapSerializer: this.mapSerializer,
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

    this.boundHandleEditorMenuMouseEnter =
      this.handleEditorMenuItemMouseEnter.bind(this)

    this.setupEventListeners()
    this.updateLocalization()

    this.handleResize = this.handleWindowResize.bind(this)
    window.addEventListener('resize', this.handleResize)
  }

  private setupEventListeners() {
    this.editorBackBtn.addEventListener('click', () => {
      this.handleBack()
    })

    this.editorPreviewBtn.addEventListener('click', () => {
      this.handlePreview()
    })

    this.editorSaveBtn.addEventListener('click', () => {
      void this.handleSave()
    })

    this.editorPanelCollapseBtn.addEventListener('click', () => {
      this.setPanelCollapsed(true)
    })

    this.editorPanelCollapsedBtn.addEventListener('click', () => {
      this.setPanelCollapsed(false)
    })

    this.editorObjectItems.forEach((item) => {
      item.addEventListener('click', () => {
        const action = item.dataset.action
        if (action === 'back') {
          this.handleEditorMenuBack()
          return
        }
        const type = item.dataset.type as ObjectType | undefined
        if (!type) {
          return
        }
        this.handleObjectClick(type)
      })
    })
    this.bindEditorMenuItems(this.editorObjectItems, EditorSubmenuMode.Object)

    this.editorObjectTree.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null
      const node = target?.closest<HTMLButtonElement>('.editor-object-node')
      if (!node?.dataset.objectId) {
        return
      }
      const objectId = Number.parseInt(node.dataset.objectId, 10)
      this.focusEditorObjectById(objectId)
    })

    this.groundSubmenuItems.forEach((item) => {
      item.addEventListener('click', () => {
        const action = item.dataset.action
        if (action === 'back') {
          this.handleEditorMenuBack()
          return
        }
        const shape = item.dataset.shape as GroundShapeType | undefined
        if (!shape) {
          return
        }
        this.handleGroundShapeClick(shape)
      })
    })
    this.obstacleSubmenuItems.forEach((item) => {
      item.addEventListener('click', () => {
        const action = item.dataset.action
        if (action === 'back') {
          this.handleEditorMenuBack()
          return
        }
        const shape = item.dataset.shape as GroundShapeType | undefined
        if (!shape) {
          return
        }
        this.handleObstacleShapeClick(shape)
      })
    })
    this.bindEditorMenuItems(this.groundSubmenuItems, EditorSubmenuMode.Ground)
    this.bindEditorMenuItems(
      this.obstacleSubmenuItems,
      EditorSubmenuMode.Obstacle
    )

    this.weaponItems.forEach((item) => {
      item.addEventListener('click', () => {
        const action = item.dataset.action
        if (action === 'back') {
          this.handleEditorMenuBack()
          return
        }
        const weaponType = item.dataset.weapon as WeaponType | undefined
        const category = item.dataset.category as WeaponCategory | undefined
        const sizeStr = item.dataset.size
        const size = sizeStr ? Number.parseInt(sizeStr, 10) : undefined
        if (!weaponType || !category) {
          return
        }
        this.handleWeaponTypeClick(weaponType, category, size)
      })
    })
    this.bindEditorMenuItems(this.weaponItems, EditorSubmenuMode.Weapon)

    this.enemySubmenuItems.forEach((item) => {
      item.addEventListener('click', () => {
        const action = item.dataset.action
        if (action === 'back') {
          this.handleEditorMenuBack()
          return
        }
        const enemyType = item.dataset.enemy as EnemyType | undefined
        if (!enemyType) {
          return
        }
        this.handleEnemyTypeClick(enemyType)
      })
    })
    this.bindEditorMenuItems(this.enemySubmenuItems, EditorSubmenuMode.Enemy)

    this.polygonMenuButtons.forEach((button) => {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault()
        event.stopPropagation()
        const action = button.dataset.action as
          | 'add'
          | 'remove'
          | 'delete'
          | 'reset'
          | 'square'
          | 'equilateral'
          | 'zoom'
          | 'rename'
          | undefined
        if (!action) {
          return
        }
        this.handlePolygonMenuAction(action)
      })
    })

    document.addEventListener(
      'pointerdown',
      (event) => {
        const target = event.target as Node
        if (
          this.polygonMenu.contains(target) ||
          this.panelMenu.contains(target) ||
          this.objectTypeMenu.contains(target) ||
          this.groundSubmenu.contains(target) ||
          this.obstacleSubmenu.contains(target) ||
          this.weaponMenu.contains(target) ||
          this.enemySubmenu.contains(target)
        ) {
          return
        }
        if (DEBUG_EDITOR_MENU) {
          console.log('[editor] global pointerdown hide menus', {
            targetType: (event.target as HTMLElement | null)?.tagName ?? '',
          })
        }
        this.hidePolygonMenu()
        this.hidePanelMenu()
        this.hideObjectTypeMenu()
        this.hideGroundSubmenu()
        this.hideObstacleSubmenu()
        this.hideWeaponMenu()
        this.hideEnemySubmenu()
      },
      true
    )

    this.polygonMenu.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })

    this.panelMenuAddBtn.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.hidePanelMenu()
      this.showObjectTypeMenu(this.panelMenuX, this.panelMenuY)
    })

    this.panelMenu.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })

    this.objectTypeMenu.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })

    this.groundSubmenu.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })
    this.obstacleSubmenu.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })

    this.weaponMenu.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })

    this.enemySubmenu.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })

    document.addEventListener(
      'contextmenu',
      (event) => {
        this.routeEditorContextMenu(event)
      },
      true
    )

    window.addEventListener('keydown', (event) => {
      this.handleEditorMenuKeyDown(event)
    })
  }

  private updateLocalization() {
    this.editorBackBtn.textContent = localizer.t('editor_back_to_menu')
    this.editorPreviewBtn.textContent = localizer.t('editor_preview')
    this.editorSaveBtn.textContent = localizer.t('editor_save')
    this.editorMapCreateBtn.textContent = localizer.t('editor_create_map')
    this.editorMapRenameBtn.textContent = localizer.t('editor_map_rename')
    this.editorMapDefaultBtn.textContent = localizer.t('editor_map_set_default')
    this.panelMenuAddBtn.textContent = localizer.t('editor_panel_add_object')

    this.editorObjectItems.forEach((item) => {
      const type = item.dataset.type
      if (type) {
        item.textContent = localizer.t(`editor_object_${type}`)
      }
    })

    this.editorPanelCollapseBtn.textContent = localizer.t(
      'editor_panel_collapse'
    )
    this.editorPanelCollapsedBtn.textContent = localizer.t(
      'editor_panel_expand'
    )
    this.groundSubmenuItems.forEach((item) => {
      const shape = item.dataset.shape
      if (shape) {
        item.textContent = localizer.t(`editor_ground_shape_${shape}`)
      }
    })
    this.obstacleSubmenuItems.forEach((item) => {
      const shape = item.dataset.shape
      if (shape) {
        item.textContent = localizer.t(`editor_ground_shape_${shape}`)
      }
    })
    this.weaponGroupTitles.forEach((title) => {
      const category = title.dataset.categoryTitle
      if (category) {
        title.textContent = localizer.t(`editor_weapon_category_${category}`)
      }
    })
    this.weaponItems.forEach((item) => {
      const weapon = item.dataset.weapon
      const sizeStr = item.dataset.size
      if (weapon && sizeStr) {
        item.textContent = localizer.t(
          `editor_weapon_size_${weapon}_${sizeStr}`
        )
      } else if (weapon) {
        item.textContent = localizer.t(`editor_weapon_${weapon}`)
      }
    })
    this.enemySubmenuItems.forEach((item) => {
      const enemy = item.dataset.enemy
      if (enemy) {
        item.textContent = localizer.t(`editor_enemy_${enemy}`)
      }
    })
    this.objectTypeMenuBackBtn.textContent = localizer.t('menu_back')
    this.groundSubmenuBackBtn.textContent = localizer.t('menu_back')
    this.obstacleSubmenuBackBtn.textContent = localizer.t('menu_back')
    this.weaponMenuBackBtn.textContent = localizer.t('menu_back')
    this.enemySubmenuBackBtn.textContent = localizer.t('menu_back')
    this.renderObjectTree()
  }

  private bindEditorMenuItems(
    items: NodeListOf<HTMLButtonElement>,
    mode: EditorSubmenuMode
  ) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      item.dataset.menuIndex = String(i)
      item.dataset.menuMode = mode
      item.addEventListener('mouseenter', this.boundHandleEditorMenuMouseEnter)
    }
  }

  private handleEditorMenuItemMouseEnter(event: Event) {
    if (!this.visible || this.currentView !== EditorView.Editor) {
      return
    }
    if (this.editorMenuMode === EditorSubmenuMode.None) {
      return
    }
    const target = event.currentTarget
    if (!(target instanceof HTMLButtonElement)) {
      return
    }
    const mode = target.dataset.menuMode as EditorSubmenuMode | undefined
    if (!mode || mode !== this.editorMenuMode) {
      return
    }
    const index = Number.parseInt(target.dataset.menuIndex ?? '', 10)
    if (!Number.isFinite(index)) {
      return
    }
    this.setEditorMenuSelectedIndex(index)
  }

  private getEditorMenuItems(
    mode: EditorSubmenuMode
  ): NodeListOf<HTMLButtonElement> {
    switch (mode) {
      case EditorSubmenuMode.Object:
        return this.editorObjectItems
      case EditorSubmenuMode.Ground:
        return this.groundSubmenuItems
      case EditorSubmenuMode.Obstacle:
        return this.obstacleSubmenuItems
      case EditorSubmenuMode.Weapon:
        return this.weaponItems
      case EditorSubmenuMode.Enemy:
        return this.enemySubmenuItems
      default:
        return this.editorObjectItems
    }
  }

  private clearEditorMenuSelection(mode: EditorSubmenuMode) {
    if (mode === EditorSubmenuMode.None) {
      return
    }
    const items = this.getEditorMenuItems(mode)
    for (let i = 0; i < items.length; i++) {
      items[i].classList.remove('is-selected')
    }
  }

  private findFirstSelectableIndex(
    items: NodeListOf<HTMLButtonElement>
  ): number {
    for (let i = 0; i < items.length; i++) {
      if (!items[i].disabled) {
        return i
      }
    }
    return 0
  }

  private findNextSelectableIndex(
    items: NodeListOf<HTMLButtonElement>,
    startIndex: number,
    delta: number
  ): number {
    if (items.length === 0) {
      return 0
    }
    let index = startIndex
    for (let i = 0; i < items.length; i++) {
      index = (index + delta + items.length) % items.length
      if (!items[index].disabled) {
        return index
      }
    }
    return startIndex
  }

  private setEditorMenuMode(mode: EditorSubmenuMode, resetIndex: boolean) {
    if (this.editorMenuMode !== mode) {
      this.clearEditorMenuSelection(this.editorMenuMode)
      this.editorMenuMode = mode
    }
    if (mode === EditorSubmenuMode.None) {
      return
    }
    const items = this.getEditorMenuItems(mode)
    if (items.length === 0) {
      return
    }
    if (resetIndex) {
      this.clearEditorMenuSelection(mode)
      this.editorMenuSelectedIndex = this.findFirstSelectableIndex(items)
    } else if (this.editorMenuSelectedIndex >= items.length) {
      this.editorMenuSelectedIndex = this.findFirstSelectableIndex(items)
    }
    this.applyEditorMenuSelection()
  }

  private applyEditorMenuSelection() {
    if (this.editorMenuMode === EditorSubmenuMode.None) {
      return
    }
    const items = this.getEditorMenuItems(this.editorMenuMode)
    if (items.length === 0) {
      return
    }
    this.clearEditorMenuSelection(this.editorMenuMode)
    if (
      this.editorMenuSelectedIndex >= items.length ||
      items[this.editorMenuSelectedIndex].disabled
    ) {
      this.editorMenuSelectedIndex = this.findFirstSelectableIndex(items)
    }
    items[this.editorMenuSelectedIndex].classList.add('is-selected')
  }

  private setEditorMenuSelectedIndex(index: number) {
    if (this.editorMenuMode === EditorSubmenuMode.None) {
      return
    }
    const items = this.getEditorMenuItems(this.editorMenuMode)
    if (index < 0 || index >= items.length) {
      return
    }
    if (items[index].disabled) {
      return
    }
    if (index === this.editorMenuSelectedIndex) {
      return
    }
    const previousIndex = this.editorMenuSelectedIndex
    this.editorMenuSelectedIndex = index
    if (previousIndex >= 0 && previousIndex < items.length) {
      items[previousIndex].classList.remove('is-selected')
    }
    items[index].classList.add('is-selected')
  }

  private handleEditorMenuKeyDown(event: KeyboardEvent) {
    if (event.defaultPrevented) {
      return
    }
    if (!this.visible || this.currentView !== EditorView.Editor) {
      if (this.visible && this.currentView === EditorView.MapList) {
        this.mapListManager.handleMapListKeyDown(event)
      }
      return
    }
    const items = this.getEditorMenuItems(this.editorMenuMode)
    if (this.editorMenuMode === EditorSubmenuMode.None) {
      if (event.key === 'Escape') {
        event.preventDefault()
        this.handleBack()
      }
      return
    }
    if (items.length === 0) {
      return
    }
    const key = event.key
    if (key === 'ArrowUp' || key === 'w') {
      event.preventDefault()
      const nextIndex = this.findNextSelectableIndex(
        items,
        this.editorMenuSelectedIndex,
        -1
      )
      this.setEditorMenuSelectedIndex(nextIndex)
      return
    }
    if (key === 'ArrowDown' || key === 's') {
      event.preventDefault()
      const nextIndex = this.findNextSelectableIndex(
        items,
        this.editorMenuSelectedIndex,
        1
      )
      this.setEditorMenuSelectedIndex(nextIndex)
      return
    }
    if (key === 'Enter' || key === ' ') {
      event.preventDefault()
      const item = items[this.editorMenuSelectedIndex]
      if (item) {
        this.handleEditorMenuConfirm(item)
      }
      return
    }
    if (key === 'Escape') {
      event.preventDefault()
      this.handleEditorMenuBack()
    }
  }

  private handleEditorMenuConfirm(item: HTMLButtonElement) {
    if (item.disabled) {
      return
    }
    const action = item.dataset.action
    if (action === 'back') {
      this.handleEditorMenuBack()
      return
    }
    if (this.editorMenuMode === EditorSubmenuMode.Object) {
      const type = item.dataset.type as ObjectType | undefined
      if (type) {
        this.handleObjectClick(type)
      }
      return
    }
    if (this.editorMenuMode === EditorSubmenuMode.Ground) {
      const shape = item.dataset.shape as GroundShapeType | undefined
      if (shape) {
        this.handleGroundShapeClick(shape)
      }
      return
    }
    if (this.editorMenuMode === EditorSubmenuMode.Obstacle) {
      const shape = item.dataset.shape as GroundShapeType | undefined
      if (shape) {
        this.handleObstacleShapeClick(shape)
      }
      return
    }
    if (this.editorMenuMode === EditorSubmenuMode.Weapon) {
      const weaponType = item.dataset.weapon as WeaponType | undefined
      const category = item.dataset.category as WeaponCategory | undefined
      const sizeStr = item.dataset.size
      const size = sizeStr ? Number.parseInt(sizeStr, 10) : undefined
      if (weaponType && category) {
        this.handleWeaponTypeClick(weaponType, category, size)
      }
      return
    }
    if (this.editorMenuMode === EditorSubmenuMode.Enemy) {
      const enemyType = item.dataset.enemy as EnemyType | undefined
      if (enemyType) {
        this.handleEnemyTypeClick(enemyType)
      }
    }
  }

  private handleEditorMenuBack() {
    if (this.editorMenuMode === EditorSubmenuMode.Ground) {
      this.hideGroundSubmenu()
      if (this.objectTypeMenu.classList.contains('is-visible')) {
        this.setEditorMenuMode(EditorSubmenuMode.Object, true)
      }
      return
    }
    if (this.editorMenuMode === EditorSubmenuMode.Obstacle) {
      this.hideObstacleSubmenu()
      if (this.objectTypeMenu.classList.contains('is-visible')) {
        this.setEditorMenuMode(EditorSubmenuMode.Object, true)
      }
      return
    }
    if (this.editorMenuMode === EditorSubmenuMode.Weapon) {
      this.hideWeaponMenu()
      if (this.objectTypeMenu.classList.contains('is-visible')) {
        this.setEditorMenuMode(EditorSubmenuMode.Object, true)
      }
      return
    }
    if (this.editorMenuMode === EditorSubmenuMode.Enemy) {
      this.hideEnemySubmenu()
      if (this.objectTypeMenu.classList.contains('is-visible')) {
        this.setEditorMenuMode(EditorSubmenuMode.Object, true)
      }
      return
    }
    if (this.editorMenuMode === EditorSubmenuMode.Object) {
      this.hideObjectTypeMenu()
      this.setEditorMenuMode(EditorSubmenuMode.None, false)
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

  private handleObjectClick(type: ObjectType) {
    this.hidePanelMenu()
    if (type === ObjectType.Ground) {
      this.setActiveObjectType(ObjectType.Ground)
      this.hideObstacleSubmenu()
      this.showGroundSubmenu()
      return
    }
    if (type === ObjectType.Obstacle) {
      this.setActiveObjectType(ObjectType.Obstacle)
      this.hideGroundSubmenu()
      this.showObstacleSubmenu()
      return
    }

    if (type === ObjectType.Weapon) {
      this.setActiveObjectType(ObjectType.Weapon)
      this.hideGroundSubmenu()
      this.hideObstacleSubmenu()
      this.showWeaponMenu()
      return
    }

    if (type === ObjectType.Player) {
      this.hideGroundSubmenu()
      this.hideObstacleSubmenu()
      this.hideObjectTypeMenu()
      this.setActiveObjectType(type)
      this.spawnPlayerMarker()
      return
    }

    if (type === ObjectType.Camera) {
      this.hideGroundSubmenu()
      this.hideObstacleSubmenu()
      this.hideObjectTypeMenu()
      this.setActiveObjectType(type)
      this.spawnCameraViewFrame()
      return
    }

    if (type === ObjectType.Enemy) {
      this.hideGroundSubmenu()
      this.hideObstacleSubmenu()
      this.setActiveObjectType(type)
      this.showEnemySubmenu()
      return
    }

    this.hideGroundSubmenu()
    this.hideObstacleSubmenu()
    this.hideObjectTypeMenu()
    this.setActiveObjectType(type)
  }

  private showMapListView() {
    this.currentView = EditorView.MapList
    this.editorSidebar.style.display = 'none'
    this.editorCanvas.style.display = 'none'
    this.editorActions.style.display = 'none'
    this.hidePanelMenu()
    this.hideObjectTypeMenu()
    this.hideGroundSubmenu()
    this.hideObstacleSubmenu()
    this.hideEnemySubmenu()
    this.hidePolygonMenu()
    this.setActiveObjectType(null)
    this.editorPanelCollapsedBtn.classList.remove('is-visible')
    this.mapListManager.show()
  }

  private showEditorView() {
    this.currentView = EditorView.Editor
    this.mapListManager.hide()
    this.editorSidebar.style.display = this.panelCollapsed ? 'none' : 'block'
    this.editorActions.style.display = 'flex'
    if (this.panelCollapsed) {
      this.editorPanelCollapsedBtn.classList.add('is-visible')
    } else {
      this.editorPanelCollapsedBtn.classList.remove('is-visible')
    }
    this.editorCanvas.style.display = 'block'
    this.hidePanelMenu()
    this.hideObjectTypeMenu()
    this.hideGroundSubmenu()
    this.hideObstacleSubmenu()
    this.hideEnemySubmenu()
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
      const thumbnail = await this.captureThumbnail()
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
    for (let i = 0; i < this.cameraViews.length; i++) {
      const icon = this.cameraViews[i].icon
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
    this.shapeResetMap.clear()
    this.cameraViews.length = 0
    this.cameraViewMap.clear()
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
    this.groundPatternMap.clear()
    this.obstaclePatternMap.clear()
    this.ensureSnapGuides()
  }

  private applyEnemies(enemies: EditorMapData['enemies']) {
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i]
      this.spawnEnemyMarker(enemy.enemyType, enemy)
    }
  }

  private applyWeapons(weapons: EditorMapData['weapons']) {
    if (!weapons) {
      return
    }
    for (let i = 0; i < weapons.length; i++) {
      const weapon = weapons[i]
      this.spawnWeaponMarker(weapon.weaponType, weapon.category, weapon)
    }
  }

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
    this.registerShapeResetData(rect, {
      kind: 'rect',
      width,
      height,
    })
    if (placed.objectKind === 'ground') {
      this.applyGroundPatternToObject(rect)
    } else {
      this.applyObstaclePatternToObject(rect)
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
    this.registerShapeResetData(circle, {
      kind: 'circle',
      radius,
    })
    if (placed.objectKind === 'ground') {
      this.applyGroundPatternToObject(circle)
    } else {
      this.applyObstaclePatternToObject(circle)
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
    this.registerShapeResetData(polygon, {
      kind: 'polygon',
      points: resetPoints,
    })
    if (placed.objectKind === 'ground') {
      this.applyGroundPatternToObject(polygon)
    } else {
      this.applyObstaclePatternToObject(polygon)
    }
    this.fabricCanvas?.add(polygon)
    this.registerEditorObject(
      placed.objectKind === 'ground' ? ObjectType.Ground : ObjectType.Obstacle,
      polygon
    )
  }

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
    if (this.isCameraFrame(object)) {
      this.removeCameraView(object)
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
    this.groundPatternMap.delete(object)
    this.obstaclePatternMap.delete(object)
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
    if (this.isCameraFrame(object)) {
      const data = this.cameraViewMap.get(object)
      if (data) {
        this.syncCameraIcon(data)
        data.icon.bringToFront()
      }
    }
  }

  private ensureSnapGuides() {
    if (
      !this.fabricCanvas ||
      (this.snapGuideVertical && this.snapGuideHorizontal)
    ) {
      return
    }
    const canvas = this.fabricCanvas
    const width = canvas.getWidth()
    const height = canvas.getHeight()
    const baseOptions: fabric.ILineOptions = {
      stroke: SNAP_GUIDE_COLOR,
      strokeWidth: 1,
      selectable: false,
      evented: false,
      excludeFromExport: true,
      objectCaching: false,
      visible: false,
    }
    if (!this.snapGuideVertical) {
      this.snapGuideVertical = new fabric.Line([0, 0, 0, height], baseOptions)
      canvas.add(this.snapGuideVertical)
    }
    if (!this.snapGuideHorizontal) {
      this.snapGuideHorizontal = new fabric.Line([0, 0, width, 0], baseOptions)
      canvas.add(this.snapGuideHorizontal)
    }
    this.snapGuideVertical.bringToFront()
    this.snapGuideHorizontal.bringToFront()
  }

  private hideSnapGuides() {
    if (this.snapGuideVertical && this.snapGuideVertical.visible) {
      this.snapGuideVertical.visible = false
    }
    if (this.snapGuideHorizontal && this.snapGuideHorizontal.visible) {
      this.snapGuideHorizontal.visible = false
    }
    this.fabricCanvas?.requestRenderAll()
  }

  private updateSnapGuideVertical(x: number) {
    if (!this.snapGuideVertical || !this.fabricCanvas) {
      return
    }
    const height = this.fabricCanvas.getHeight()
    this.snapGuideVertical.set({
      x1: x,
      y1: 0,
      x2: x,
      y2: height,
      visible: true,
    })
    this.snapGuideVertical.setCoords()
    this.snapGuideVertical.bringToFront()
  }

  private updateSnapGuideHorizontal(y: number) {
    if (!this.snapGuideHorizontal || !this.fabricCanvas) {
      return
    }
    const width = this.fabricCanvas.getWidth()
    this.snapGuideHorizontal.set({
      x1: 0,
      y1: y,
      x2: width,
      y2: y,
      visible: true,
    })
    this.snapGuideHorizontal.setCoords()
    this.snapGuideHorizontal.bringToFront()
  }

  private updateSnapBoundsFromObject(object: fabric.Object, out: SnapBounds) {
    const coords = object.aCoords
    if (!coords) {
      return
    }
    let minX = coords.tl.x
    let maxX = coords.tl.x
    let minY = coords.tl.y
    let maxY = coords.tl.y
    const tr = coords.tr
    const br = coords.br
    const bl = coords.bl
    if (tr.x < minX) minX = tr.x
    if (tr.x > maxX) maxX = tr.x
    if (br.x < minX) minX = br.x
    if (br.x > maxX) maxX = br.x
    if (bl.x < minX) minX = bl.x
    if (bl.x > maxX) maxX = bl.x
    if (tr.y < minY) minY = tr.y
    if (tr.y > maxY) maxY = tr.y
    if (br.y < minY) minY = br.y
    if (br.y > maxY) maxY = br.y
    if (bl.y < minY) minY = bl.y
    if (bl.y > maxY) maxY = bl.y
    out.left = minX
    out.right = maxX
    out.top = minY
    out.bottom = maxY
    out.centerX = (minX + maxX) * 0.5
    out.centerY = (minY + maxY) * 0.5
  }

  private acquireSnapBounds() {
    return (
      this.snapBoundsPool.pop() ?? {
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        centerX: 0,
        centerY: 0,
      }
    )
  }

  private releaseSnapBounds(bounds: SnapBounds) {
    this.snapBoundsPool.push(bounds)
  }

  private clearSnapCandidates() {
    for (let i = 0; i < this.snapCandidateBounds.length; i++) {
      this.releaseSnapBounds(this.snapCandidateBounds[i])
    }
    this.snapCandidateBounds.length = 0
    this.snapActiveTarget = null
    this.snapFrameCounter = 0
  }

  // Cache other objects' bounds at drag start to avoid O(n) setCoords every move.
  private prepareSnapCandidates(target: fabric.Object) {
    if (!this.fabricCanvas) {
      return
    }
    this.clearSnapCandidates()
    this.snapActiveTarget = target
    for (let i = 0; i < this.editorObjects.length; i++) {
      const other = this.editorObjects[i].object
      if (other === target || other.canvas !== this.fabricCanvas) {
        continue
      }
      other.setCoords()
      const bounds = this.acquireSnapBounds()
      this.updateSnapBoundsFromObject(other, bounds)
      this.snapCandidateBounds.push(bounds)
    }
  }

  // Snap moving objects by edges/centers and show guide lines for center alignment.
  private handleObjectMovingSnap(target: fabric.Object) {
    if (!this.fabricCanvas || !this.editorObjectMap.has(target)) {
      return
    }
    this.ensureSnapGuides()
    if (this.snapActiveTarget !== target) {
      this.prepareSnapCandidates(target)
    }
    this.snapFrameCounter += 1
    if (this.snapFrameCounter % SNAP_EVERY_N_FRAMES !== 0) {
      if (this.groundPatternMap.has(target)) {
        this.updateGroundPatternTransform(target)
      }
      if (this.obstaclePatternMap.has(target)) {
        this.updateObstaclePatternTransform(target)
      }
      if (this.isCameraFrame(target)) {
        const data = this.cameraViewMap.get(target)
        if (data) {
          this.syncCameraIcon(data)
        }
      }
      return
    }
    target.setCoords()
    const targetBounds = this.snapBoundsScratchA
    this.updateSnapBoundsFromObject(target, targetBounds)
    let bestDx = 0
    let bestDy = 0
    let bestAbsDx = SNAP_THRESHOLD_PX + 1
    let bestAbsDy = SNAP_THRESHOLD_PX + 1
    let guideX: number | null = null
    let guideY: number | null = null
    const candidates = this.snapCandidateBounds
    for (let i = 0; i < candidates.length; i++) {
      const otherBounds = candidates[i]

      const dxLL = otherBounds.left - targetBounds.left
      const dxLR = otherBounds.left - targetBounds.right
      const dxRL = otherBounds.right - targetBounds.left
      const dxRR = otherBounds.right - targetBounds.right
      const dxCC = otherBounds.centerX - targetBounds.centerX

      const dyTT = otherBounds.top - targetBounds.top
      const dyTB = otherBounds.top - targetBounds.bottom
      const dyBT = otherBounds.bottom - targetBounds.top
      const dyBB = otherBounds.bottom - targetBounds.bottom
      const dyCC = otherBounds.centerY - targetBounds.centerY

      const absDxLL = Math.abs(dxLL)
      if (absDxLL < bestAbsDx && absDxLL <= SNAP_THRESHOLD_PX) {
        bestAbsDx = absDxLL
        bestDx = dxLL
        guideX = null
      }
      const absDxLR = Math.abs(dxLR)
      if (absDxLR < bestAbsDx && absDxLR <= SNAP_THRESHOLD_PX) {
        bestAbsDx = absDxLR
        bestDx = dxLR
        guideX = null
      }
      const absDxRL = Math.abs(dxRL)
      if (absDxRL < bestAbsDx && absDxRL <= SNAP_THRESHOLD_PX) {
        bestAbsDx = absDxRL
        bestDx = dxRL
        guideX = null
      }
      const absDxRR = Math.abs(dxRR)
      if (absDxRR < bestAbsDx && absDxRR <= SNAP_THRESHOLD_PX) {
        bestAbsDx = absDxRR
        bestDx = dxRR
        guideX = null
      }
      const absDxCC = Math.abs(dxCC)
      if (absDxCC < bestAbsDx && absDxCC <= SNAP_THRESHOLD_PX) {
        bestAbsDx = absDxCC
        bestDx = dxCC
        guideX = otherBounds.centerX
      }

      const absDyTT = Math.abs(dyTT)
      if (absDyTT < bestAbsDy && absDyTT <= SNAP_THRESHOLD_PX) {
        bestAbsDy = absDyTT
        bestDy = dyTT
        guideY = null
      }
      const absDyTB = Math.abs(dyTB)
      if (absDyTB < bestAbsDy && absDyTB <= SNAP_THRESHOLD_PX) {
        bestAbsDy = absDyTB
        bestDy = dyTB
        guideY = null
      }
      const absDyBT = Math.abs(dyBT)
      if (absDyBT < bestAbsDy && absDyBT <= SNAP_THRESHOLD_PX) {
        bestAbsDy = absDyBT
        bestDy = dyBT
        guideY = null
      }
      const absDyBB = Math.abs(dyBB)
      if (absDyBB < bestAbsDy && absDyBB <= SNAP_THRESHOLD_PX) {
        bestAbsDy = absDyBB
        bestDy = dyBB
        guideY = null
      }
      const absDyCC = Math.abs(dyCC)
      if (absDyCC < bestAbsDy && absDyCC <= SNAP_THRESHOLD_PX) {
        bestAbsDy = absDyCC
        bestDy = dyCC
        guideY = otherBounds.centerY
      }
    }

    if (bestAbsDx <= SNAP_THRESHOLD_PX || bestAbsDy <= SNAP_THRESHOLD_PX) {
      target.set({
        left: (target.left ?? 0) + bestDx,
        top: (target.top ?? 0) + bestDy,
      })
      target.setCoords()
    }

    if (guideX !== null) {
      this.updateSnapGuideVertical(guideX)
    } else if (this.snapGuideVertical) {
      this.snapGuideVertical.visible = false
    }
    if (guideY !== null) {
      this.updateSnapGuideHorizontal(guideY)
    } else if (this.snapGuideHorizontal) {
      this.snapGuideHorizontal.visible = false
    }

    if (this.groundPatternMap.has(target)) {
      this.updateGroundPatternTransform(target)
    }
    if (this.obstaclePatternMap.has(target)) {
      this.updateObstaclePatternTransform(target)
    }
    if (this.isCameraFrame(target)) {
      const data = this.cameraViewMap.get(target)
      if (data) {
        this.syncCameraIcon(data)
      }
    }
    this.fabricCanvas.requestRenderAll()
  }

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
    this.refreshCameraFocus(target)
    this.renderObjectTree()
  }

  private renderObjectTree() {
    this.editorObjectTree.innerHTML = ''
    for (let i = 0; i < this.editorObjects.length; i++) {
      const data = this.editorObjects[i]
      if (data.id === this.renamingEditorObjectId) {
        const input = document.createElement('input')
        input.className = 'editor-object-rename-input'
        input.value = data.name
        input.dataset.objectId = String(data.id)
        const commit = () => {
          this.commitObjectRename(data.id, input.value)
        }
        input.addEventListener('blur', commit)
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
            return
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            this.cancelObjectRename()
          }
        })
        this.editorObjectTree.appendChild(input)
        input.focus()
        input.select()
        continue
      }
      const node = document.createElement('button')
      node.type = 'button'
      node.className = 'editor-object-node'
      node.draggable = true
      if (data.id === this.selectedEditorObjectId) {
        node.classList.add('is-selected')
      }
      node.dataset.objectId = String(data.id)
      node.textContent = data.name
      node.addEventListener('dragstart', (event) => {
        this.dragObjectId = data.id
        this.dragTargetId = data.id
        this.dragInsertAfter = false
        this.clearDragPreview()
        event.dataTransfer?.setData('text/plain', String(data.id))
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move'
        }
      })
      node.addEventListener('dragover', (event) => {
        if (this.dragObjectId === -1) {
          return
        }
        event.preventDefault()
        const rect = node.getBoundingClientRect()
        const midY = rect.top + rect.height * 0.5
        this.dragTargetId = data.id
        this.dragInsertAfter = event.clientY >= midY
        this.updateDragPreviewFromTarget(data.id, this.dragInsertAfter)
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'move'
        }
      })
      node.addEventListener('drop', (event) => {
        if (this.dragObjectId === -1) {
          return
        }
        event.preventDefault()
        this.reorderEditorObjects(
          this.dragObjectId,
          data.id,
          this.dragInsertAfter
        )
        this.resetDragState()
      })
      node.addEventListener('dragend', () => {
        this.resetDragState()
      })
      this.editorObjectTree.appendChild(node)
    }
  }

  private updateDragPreviewFromTarget(targetId: number, insertAfter: boolean) {
    if (targetId === this.dragObjectId) {
      this.clearDragPreview()
      return
    }
    const targetIndex = this.findEditorObjectIndexById(targetId)
    if (targetIndex === -1) {
      this.clearDragPreview()
      return
    }
    // A target "before" is the same drop line as the previous item's "after".
    let previewId = targetId
    let previewAfter = insertAfter
    if (!insertAfter && targetIndex > 0) {
      previewId = this.editorObjects[targetIndex - 1].id
      previewAfter = true
    }
    if (previewId === this.dragObjectId) {
      this.clearDragPreview()
      return
    }
    this.updateDragPreview(previewId, previewAfter)
  }

  private updateDragPreview(id: number, insertAfter: boolean) {
    if (this.dragPreviewId === id && this.dragPreviewAfter === insertAfter) {
      return
    }
    this.clearDragPreview()
    const selector = `.editor-object-node[data-object-id="${id}"]`
    const node =
      this.editorObjectTree.querySelector<HTMLButtonElement>(selector)
    if (!node) {
      return
    }
    this.dragPreviewId = id
    this.dragPreviewAfter = insertAfter
    if (insertAfter) {
      node.classList.add('is-drop-after')
    } else {
      node.classList.add('is-drop-before')
    }
  }

  private clearDragPreview() {
    if (this.dragPreviewId === -1) {
      return
    }
    const selector = `.editor-object-node[data-object-id="${this.dragPreviewId}"]`
    const node =
      this.editorObjectTree.querySelector<HTMLButtonElement>(selector)
    if (node) {
      node.classList.remove('is-drop-before')
      node.classList.remove('is-drop-after')
    }
    this.dragPreviewId = -1
    this.dragPreviewAfter = false
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
    this.clearDragPreview()
    this.dragObjectId = -1
    this.dragTargetId = -1
    this.dragInsertAfter = false
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
    if (this.editorObjectPanel.contains(targetNode)) {
      this.handleObjectPanelContextMenuCore(event)
      return
    }
    this.handleEditablePolygonContextMenuEvent(event)
  }

  private showEnemySubmenu() {
    this.positionEnemySubmenu()
    this.enemySubmenu.classList.add('is-visible')
    this.setEditorMenuMode(EditorSubmenuMode.Enemy, true)
  }

  private hideEnemySubmenu() {
    this.enemySubmenu.classList.remove('is-visible')
    if (this.editorMenuMode === EditorSubmenuMode.Enemy) {
      if (this.objectTypeMenu.classList.contains('is-visible')) {
        this.setEditorMenuMode(EditorSubmenuMode.Object, true)
      } else {
        this.setEditorMenuMode(EditorSubmenuMode.None, false)
      }
    }
  }

  private positionEnemySubmenu() {
    this.positionShapeSubmenu(this.enemyMenuItem, this.enemySubmenu)
  }

  private handleEnemyTypeClick(enemyType: EnemyType) {
    this.spawnEnemyMarker(enemyType)
    this.hideEnemySubmenu()
    this.hideObjectTypeMenu()
  }

  private isInsideAnyMenu(targetNode: Node) {
    return (
      this.panelMenu.contains(targetNode) ||
      this.objectTypeMenu.contains(targetNode) ||
      this.groundSubmenu.contains(targetNode) ||
      this.obstacleSubmenu.contains(targetNode) ||
      this.weaponMenu.contains(targetNode) ||
      this.enemySubmenu.contains(targetNode) ||
      this.polygonMenu.contains(targetNode)
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
    this.hideObjectTypeMenu()
    if (node?.dataset.objectId) {
      const objectId = Number.parseInt(node.dataset.objectId, 10)
      this.focusEditorObjectById(objectId)
      const data = this.getEditorObjectById(objectId)
      if (data) {
        this.showShapeContextMenu(data.object, event.clientX, event.clientY)
        return
      }
    }
    this.showPanelMenu(event.clientX, event.clientY)
  }

  private showPanelMenu(clientX: number, clientY: number) {
    this.hidePolygonMenu()
    this.hideGroundSubmenu()
    this.hideObstacleSubmenu()
    this.hideEnemySubmenu()
    this.hideObjectTypeMenu()
    this.panelMenuX = clientX
    this.panelMenuY = clientY
    this.panelMenu.style.left = `${clientX}px`
    this.panelMenu.style.top = `${clientY}px`
    this.panelMenu.classList.add('is-visible')
    if (DEBUG_EDITOR_MENU) {
      console.log('[editor] show panel menu', { clientX, clientY })
    }
  }

  private hidePanelMenu() {
    if (!this.panelMenu.classList.contains('is-visible')) {
      return
    }
    this.panelMenu.classList.remove('is-visible')
    if (DEBUG_EDITOR_MENU) {
      console.log('[editor] hide panel menu')
    }
  }

  private hasObjectOfType(type: ObjectType): boolean {
    return this.editorObjects.some((obj) => obj.type === type)
  }

  private showObjectTypeMenu(clientX: number, clientY: number) {
    this.hidePolygonMenu()
    this.hidePanelMenu()
    this.hideGroundSubmenu()
    this.hideObstacleSubmenu()
    this.hideEnemySubmenu()
    this.objectTypeMenuX = clientX
    this.objectTypeMenuY = clientY
    this.objectTypeMenu.style.left = `${clientX}px`
    this.objectTypeMenu.style.top = `${clientY}px`

    this.editorObjectItems.forEach((item) => {
      const type = item.dataset.type as ObjectType | undefined
      if (!type) {
        return
      }
      if (type === ObjectType.Player || type === ObjectType.Camera) {
        if (this.hasObjectOfType(type)) {
          item.disabled = true
          item.classList.add('disabled')
        } else {
          item.disabled = false
          item.classList.remove('disabled')
        }
      }
    })

    this.objectTypeMenu.classList.add('is-visible')
    this.setEditorMenuMode(EditorSubmenuMode.Object, true)
  }

  private hideObjectTypeMenu() {
    if (!this.objectTypeMenu.classList.contains('is-visible')) {
      return
    }
    this.objectTypeMenu.classList.remove('is-visible')
    this.hideGroundSubmenu()
    this.hideObstacleSubmenu()
    this.hideWeaponMenu()
    this.hideEnemySubmenu()
    this.setEditorMenuMode(EditorSubmenuMode.None, false)
  }

  private spawnPlayerMarker(spawn?: { x: number; y: number }) {
    this.ensureFabricCanvas()
    if (!this.fabricCanvas) {
      console.warn('[editor] Fabric canvas not ready')
      return
    }
    const spawnX =
      spawn?.x !== undefined
        ? spawn.x * EDITOR_PIXELS_PER_METER
        : this.editorCanvas.width * 0.5
    const spawnY =
      spawn?.y !== undefined
        ? spawn.y * EDITOR_PIXELS_PER_METER
        : this.editorCanvas.height * 0.5
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
    const template = ENEMY_TEMPLATES[enemyType]
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
    const equipWeapon = spawn?.equipWeapon ?? false
    const centerX =
      spawn?.x !== undefined
        ? spawn.x * EDITOR_PIXELS_PER_METER
        : this.editorCanvas.width * 0.5
    const centerY =
      spawn?.y !== undefined
        ? spawn.y * EDITOR_PIXELS_PER_METER
        : this.editorCanvas.height * 0.5
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
    marker.equipWeapon = equipWeapon
    marker.left = centerX
    marker.top = centerY
    marker.setCoords()
    this.fabricCanvas.add(marker)
    this.registerEditorObject(ObjectType.Enemy, marker)
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
      equipWeapon,
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
    const centerX =
      spawn?.x !== undefined
        ? spawn.x * EDITOR_PIXELS_PER_METER
        : this.editorCanvas.width * 0.5
    const centerY =
      spawn?.y !== undefined
        ? spawn.y * EDITOR_PIXELS_PER_METER
        : this.editorCanvas.height * 0.5
    const template = WEAPON_TEMPLATES[weaponType]
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

  private spawnCameraViewFrame(camera?: EditorMapData['camera']) {
    this.ensureFabricCanvas()
    if (!this.fabricCanvas) {
      console.warn('[editor] Fabric canvas not ready')
      return
    }

    const frame = new fabric.Rect(CAMERA_FRAME_OPTIONS) as CameraFrame
    frame.editorShape = 'camera-frame'
    frame.setControlsVisibility({
      mt: false,
      mb: false,
      ml: false,
      mr: false,
      mtr: false,
    })

    const icon = this.createCameraIcon()
    const baseWidth = Math.min(
      this.editorCanvas.width,
      this.editorCanvas.height * 2
    )
    const baseHeight = baseWidth * 0.5
    let zoom = 1
    let centerX = this.editorCanvas.width * 0.5
    let centerY = this.editorCanvas.height * 0.5
    if (camera) {
      const center = this.mapSerializer.computeCameraCenterFromOffset(camera)
      zoom = center.zoom
      centerX = center.centerX * EDITOR_PIXELS_PER_METER
      centerY = center.centerY * EDITOR_PIXELS_PER_METER
    }
    frame.width = baseWidth / zoom
    frame.height = baseHeight / zoom
    frame.scaleX = 1
    frame.scaleY = 1
    frame.fill = CAMERA_FRAME_FILL_UNFOCUSED
    frame.left = centerX
    frame.top = centerY
    frame.setCoords()
    icon.left = centerX
    icon.top = centerY
    icon.visible = false

    const data: CameraViewData = {
      frame,
      icon,
      zoom,
      baseWidth,
      baseHeight,
    }
    this.cameraViews.push(data)
    this.cameraViewMap.set(frame, data)
    this.attachCameraFrameHandlers(data)

    this.fabricCanvas.add(frame)
    this.fabricCanvas.add(icon)
    this.registerEditorObject(ObjectType.Camera, frame)
    this.fabricCanvas.setActiveObject(frame)
    this.handleCanvasSelection(frame)
    this.refreshCameraFocus(frame)
    this.fabricCanvas.renderAll()
  }

  private createCameraIcon(): fabric.Group {
    const body = new fabric.Rect({
      width: 18,
      height: 12,
      fill: CAMERA_ICON_FILL,
      stroke: CAMERA_ICON_STROKE,
      strokeWidth: 1,
      originX: 'center',
      originY: 'center',
      rx: 2,
      ry: 2,
      objectCaching: false,
    })
    const lens = new fabric.Circle({
      radius: 3,
      fill: 'transparent',
      stroke: CAMERA_ICON_STROKE,
      strokeWidth: 1,
      originX: 'center',
      originY: 'center',
      left: 2,
      top: 0,
      objectCaching: false,
    })
    const hood = new fabric.Triangle({
      width: 6,
      height: 6,
      fill: CAMERA_ICON_FILL,
      stroke: CAMERA_ICON_STROKE,
      strokeWidth: 1,
      originX: 'center',
      originY: 'center',
      left: 12,
      top: 0,
      angle: 90,
      objectCaching: false,
    })
    const group = new fabric.Group([body, lens, hood], {
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
      hoverCursor: 'default',
      objectCaching: false,
    })
    return group
  }

  private attachCameraFrameHandlers(data: CameraViewData) {
    const handler = () => {
      this.syncCameraIcon(data)
    }
    data.frame.on('moving', handler)
    data.frame.on('scaling', () => {
      this.applyCameraUniformScale(data)
      this.updateCameraZoomFromFrame(data)
      this.syncCameraIcon(data)
    })
    data.frame.on('modified', () => {
      this.normalizeCameraFrameScale(data)
      this.syncCameraIcon(data)
    })
  }

  private syncCameraIcon(data: CameraViewData) {
    const frame = data.frame
    const icon = data.icon
    icon.left = frame.left ?? 0
    icon.top = frame.top ?? 0
    icon.setCoords()
  }

  private updateCameraZoomFromFrame(data: CameraViewData) {
    const frame = data.frame
    const width = (frame.width ?? 0) * (frame.scaleX ?? 1)
    if (width <= 0) {
      return
    }
    const zoom = data.baseWidth / width
    if (Number.isFinite(zoom) && zoom > 0) {
      data.zoom = zoom
    }
  }

  private normalizeCameraFrameScale(data: CameraViewData) {
    const frame = data.frame
    const width = (frame.width ?? 0) * (frame.scaleX ?? 1)
    if (width <= 0) {
      return
    }
    const zoom = data.baseWidth / width
    if (!Number.isFinite(zoom) || zoom <= 0) {
      return
    }
    data.zoom = zoom
    frame.width = data.baseWidth / data.zoom
    frame.height = data.baseHeight / data.zoom
    frame.scaleX = 1
    frame.scaleY = 1
    frame.setCoords()
  }

  private applyCameraUniformScale(data: CameraViewData) {
    const frame = data.frame
    const scaleX = frame.scaleX ?? 1
    frame.scaleY = scaleX
  }

  private setActiveObjectType(type: ObjectType | null) {
    this.activeObjectType = type
  }

  private showGroundSubmenu() {
    this.positionGroundSubmenu()
    this.groundSubmenu.classList.add('is-visible')
    this.setEditorMenuMode(EditorSubmenuMode.Ground, true)
  }

  private hideGroundSubmenu() {
    this.groundSubmenu.classList.remove('is-visible')
    if (this.editorMenuMode === EditorSubmenuMode.Ground) {
      if (this.objectTypeMenu.classList.contains('is-visible')) {
        this.setEditorMenuMode(EditorSubmenuMode.Object, true)
      } else {
        this.setEditorMenuMode(EditorSubmenuMode.None, false)
      }
    }
  }

  private positionGroundSubmenu() {
    this.positionShapeSubmenu(this.groundMenuItem, this.groundSubmenu)
  }

  private showObstacleSubmenu() {
    this.positionObstacleSubmenu()
    this.obstacleSubmenu.classList.add('is-visible')
    this.setEditorMenuMode(EditorSubmenuMode.Obstacle, true)
  }

  private hideObstacleSubmenu() {
    this.obstacleSubmenu.classList.remove('is-visible')
    if (this.editorMenuMode === EditorSubmenuMode.Obstacle) {
      if (this.objectTypeMenu.classList.contains('is-visible')) {
        this.setEditorMenuMode(EditorSubmenuMode.Object, true)
      } else {
        this.setEditorMenuMode(EditorSubmenuMode.None, false)
      }
    }
  }

  private showWeaponMenu() {
    this.positionWeaponMenu()
    this.weaponMenu.classList.add('is-visible')
    this.setEditorMenuMode(EditorSubmenuMode.Weapon, true)
  }

  private hideWeaponMenu() {
    this.weaponMenu.classList.remove('is-visible')
    if (this.editorMenuMode === EditorSubmenuMode.Weapon) {
      if (this.objectTypeMenu.classList.contains('is-visible')) {
        this.setEditorMenuMode(EditorSubmenuMode.Object, true)
      } else {
        this.setEditorMenuMode(EditorSubmenuMode.None, false)
      }
    }
  }

  private positionWeaponMenu() {
    this.positionShapeSubmenu(this.weaponMenuItem, this.weaponMenu)
  }

  private positionObstacleSubmenu() {
    this.positionShapeSubmenu(this.obstacleMenuItem, this.obstacleSubmenu)
  }

  private positionShapeSubmenu(
    menuItem: HTMLButtonElement,
    submenu: HTMLDivElement
  ) {
    const menuRect = this.objectTypeMenu.getBoundingClientRect()
    const itemRect = menuItem.getBoundingClientRect()
    submenu.style.left = `${menuRect.right + 6}px`
    submenu.style.top = `${itemRect.top}px`
  }

  private handleGroundShapeClick(shape: GroundShapeType) {
    this.ensureFabricCanvas()
    if (!this.fabricCanvas) {
      console.warn('[editor] Fabric canvas not ready')
      return
    }

    const centerX = this.editorCanvas.width * 0.5
    const centerY = this.editorCanvas.height * 0.5
    let shapeObject: fabric.Object | null = null

    switch (shape) {
      case 'rect':
        shapeObject = new fabric.Rect(GROUND_RECT_OPTIONS)
        this.registerShapeResetData(shapeObject, {
          kind: 'rect',
          width: GROUND_RECT_OPTIONS.width ?? 0,
          height: GROUND_RECT_OPTIONS.height ?? 0,
        })
        break
      case 'circle':
        shapeObject = new fabric.Circle(GROUND_CIRCLE_OPTIONS)
        this.registerShapeResetData(shapeObject, {
          kind: 'circle',
          radius: GROUND_CIRCLE_OPTIONS.radius ?? 0,
        })
        break
      case 'triangle':
        shapeObject = new fabric.Polygon(
          createTrianglePoints(),
          GROUND_TRIANGLE_OPTIONS
        )
        this.registerShapeResetData(shapeObject, {
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
        this.registerShapeResetData(polygon, {
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

    this.applyGroundPatternToObject(shapeObject)
    shapeObject.left = centerX
    shapeObject.top = centerY
    shapeObject.setCoords()
    this.fabricCanvas.add(shapeObject)
    this.registerEditorObject(ObjectType.Ground, shapeObject)
    this.fabricCanvas.setActiveObject(shapeObject)
    this.handleCanvasSelection(shapeObject)
    this.fabricCanvas.renderAll()
    this.hideGroundSubmenu()
    this.hideObstacleSubmenu()
    this.hideObjectTypeMenu()
  }

  private handleObstacleShapeClick(shape: GroundShapeType) {
    this.ensureFabricCanvas()
    if (!this.fabricCanvas) {
      console.warn('[editor] Fabric canvas not ready')
      return
    }

    const centerX = this.editorCanvas.width * 0.5
    const centerY = this.editorCanvas.height * 0.5
    let shapeObject: fabric.Object | null = null

    switch (shape) {
      case 'rect':
        shapeObject = new fabric.Rect(OBSTACLE_RECT_OPTIONS)
        this.registerShapeResetData(shapeObject, {
          kind: 'rect',
          width: OBSTACLE_RECT_OPTIONS.width ?? 0,
          height: OBSTACLE_RECT_OPTIONS.height ?? 0,
        })
        break
      case 'circle':
        shapeObject = new fabric.Circle(OBSTACLE_CIRCLE_OPTIONS)
        this.registerShapeResetData(shapeObject, {
          kind: 'circle',
          radius: OBSTACLE_CIRCLE_OPTIONS.radius ?? 0,
        })
        break
      case 'triangle':
        shapeObject = new fabric.Polygon(
          createTrianglePoints(),
          OBSTACLE_TRIANGLE_OPTIONS
        )
        this.registerShapeResetData(shapeObject, {
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
        this.registerShapeResetData(polygon, {
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

    this.applyObstaclePatternToObject(shapeObject)
    shapeObject.left = centerX
    shapeObject.top = centerY
    shapeObject.setCoords()
    this.fabricCanvas.add(shapeObject)
    this.registerEditorObject(ObjectType.Obstacle, shapeObject)
    this.fabricCanvas.setActiveObject(shapeObject)
    this.handleCanvasSelection(shapeObject)
    this.fabricCanvas.renderAll()
    this.hideGroundSubmenu()
    this.hideObstacleSubmenu()
    this.hideObjectTypeMenu()
  }

  private handleWeaponTypeClick(
    weaponType: WeaponType,
    category: WeaponCategory,
    sizeLevel?: number
  ) {
    this.spawnWeaponMarker(weaponType, category, { sizeLevel })
    this.hideWeaponMenu()
    this.hideObjectTypeMenu()
  }

  private applyGroundPatternToObject(object: fabric.Object) {
    const image = this.getGroundPatternImage()
    if (!image) {
      return
    }
    const pattern = new fabric.Pattern({
      source: image,
      repeat: 'repeat',
      patternTransform: [1, 0, 0, 1, 0, 0],
    })
    this.groundPatternMap.set(object, pattern)
    object.set('fill', pattern)
    this.updateGroundPatternTransform(object)
    object.on('scaling', () => {
      this.updateGroundPatternTransform(object)
    })
    object.on('modified', () => {
      this.updateGroundPatternTransform(object)
    })
  }

  private updateGroundPatternTransform(object: fabric.Object) {
    const pattern = this.groundPatternMap.get(object)
    if (!pattern) {
      return
    }
    const scaleX = object.scaleX ?? 1
    const scaleY = object.scaleY ?? 1
    const invScaleX = scaleX !== 0 ? 1 / scaleX : 1
    const invScaleY = scaleY !== 0 ? 1 / scaleY : 1
    const transform =
      pattern.patternTransform ?? this.groundPatternTransformScratch
    transform[0] = invScaleX
    transform[1] = 0
    transform[2] = 0
    transform[3] = invScaleY
    transform[4] = 0
    transform[5] = 0
    pattern.patternTransform = transform
    if (object.canvas) {
      object.canvas.requestRenderAll()
    }
  }

  private applyObstaclePatternToObject(object: fabric.Object) {
    const image = this.getObstaclePatternImage()
    if (!image) {
      return
    }
    const pattern = new fabric.Pattern({
      source: image,
      repeat: 'repeat',
      patternTransform: [1, 0, 0, 1, 0, 0],
    })
    this.obstaclePatternMap.set(object, pattern)
    object.set('fill', pattern)
    this.updateObstaclePatternTransform(object)
    object.on('scaling', () => {
      this.updateObstaclePatternTransform(object)
    })
    object.on('modified', () => {
      this.updateObstaclePatternTransform(object)
    })
  }

  private updateObstaclePatternTransform(object: fabric.Object) {
    const pattern = this.obstaclePatternMap.get(object)
    if (!pattern) {
      return
    }
    const scaleX = object.scaleX ?? 1
    const scaleY = object.scaleY ?? 1
    const invScaleX = scaleX !== 0 ? 1 / scaleX : 1
    const invScaleY = scaleY !== 0 ? 1 / scaleY : 1
    const transform =
      pattern.patternTransform ?? this.obstaclePatternTransformScratch
    transform[0] = invScaleX
    transform[1] = 0
    transform[2] = 0
    transform[3] = invScaleY
    transform[4] = 0
    transform[5] = 0
    pattern.patternTransform = transform
    if (object.canvas) {
      object.canvas.requestRenderAll()
    }
  }

  private setupEditablePolygon(polygon: fabric.Polygon) {
    this.polygonEditor.setupEditablePolygon(polygon)
  }

  private handleEditablePolygonPointerDown(opt: fabric.IEvent<MouseEvent>) {
    this.polygonEditor.handleEditablePolygonPointerDown(opt)
  }

  private isCameraFrame(object: fabric.Object | null): object is CameraFrame {
    return (
      object instanceof fabric.Rect &&
      (object as CameraFrame).editorShape === 'camera-frame'
    )
  }

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

  private handleEditablePolygonContextMenu(opt: fabric.IEvent<MouseEvent>) {
    if (!this.fabricCanvas) {
      return
    }
    this.hidePolygonMenu()
    const evt = opt.e
    const target = opt.target ?? null
    this.handleEditablePolygonContextMenuCore(evt, target)
  }

  private handleEditablePolygonContextMenuEvent(event: MouseEvent) {
    if (!this.fabricCanvas) {
      return
    }
    this.hidePolygonMenu()
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

  private isEditablePolygon(
    object: fabric.Object | null
  ): object is EditablePolygon {
    return this.polygonEditor.isEditablePolygon(object)
  }

  private isDeletableShape(object: fabric.Object) {
    if (this.isCameraFrame(object)) {
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

  private showShapeContextMenu(
    target: fabric.Object,
    clientX: number,
    clientY: number
  ) {
    if (this.isCameraFrame(target)) {
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

  private isTriangleShape(object: fabric.Object) {
    const data = this.shapeResetMap.get(object)
    return data?.kind === 'triangle'
  }

  private registerShapeResetData(object: fabric.Object, data: ShapeResetData) {
    this.shapeResetMap.set(object, data)
  }

  private resetShape(target: fabric.Object) {
    const data = this.shapeResetMap.get(target)
    if (!data) {
      return
    }
    if (data.kind === 'rect' && target.type === 'rect') {
      const rect = target as fabric.Rect
      rect.width = data.width
      rect.height = data.height
      rect.scaleX = 1
      rect.scaleY = 1
      rect.setCoords()
      return
    }
    if (data.kind === 'circle' && target.type === 'circle') {
      const circle = target as fabric.Circle
      circle.radius = data.radius
      circle.scaleX = 1
      circle.scaleY = 1
      circle.setCoords()
      return
    }
    if (
      (data.kind === 'polygon' || data.kind === 'triangle') &&
      target.type === 'polygon'
    ) {
      const polygon = target as fabric.Polygon
      this.polygonEditor.assignPolygonPoints(polygon, data.points)
      polygon.scaleX = 1
      polygon.scaleY = 1
      this.polygonEditor.updateEditablePolygonBounds(polygon as EditablePolygon)
      if (this.isEditablePolygon(polygon)) {
        this.polygonEditor.refreshEditablePolygonControls(polygon)
      }
    }
  }

  private makeSquare(target: fabric.Object) {
    if (target.type !== 'rect') {
      return
    }
    const rect = target as fabric.Rect
    const width = (rect.width ?? 0) * (rect.scaleX ?? 1)
    const height = (rect.height ?? 0) * (rect.scaleY ?? 1)
    const size = Math.max(width, height)
    rect.width = size
    rect.height = size
    rect.scaleX = 1
    rect.scaleY = 1
    rect.setCoords()
  }

  private makeEquilateralTriangle(target: fabric.Object) {
    if (target.type !== 'polygon') {
      return
    }
    const polygon = target as fabric.Polygon
    const data = this.shapeResetMap.get(polygon)
    if (!data || data.kind !== 'triangle') {
      return
    }
    const width = (polygon.width ?? 0) * (polygon.scaleX ?? 1)
    const height = (polygon.height ?? 0) * (polygon.scaleY ?? 1)
    const size = Math.max(width, (2 / Math.sqrt(3)) * height)
    const halfSide = size * 0.5
    const triHeight = size * Math.sqrt(3) * 0.5
    const centerX = polygon.pathOffset.x
    const centerY = polygon.pathOffset.y
    this.polygonEditor.ensurePolygonPointsLength(polygon, 3)
    const p0 = polygon.points![0]
    const p1 = polygon.points![1]
    const p2 = polygon.points![2]
    p0.x = centerX - halfSide
    p0.y = centerY + triHeight / 3
    p1.x = centerX + halfSide
    p1.y = centerY + triHeight / 3
    p2.x = centerX
    p2.y = centerY - (2 * triHeight) / 3
    polygon.scaleX = 1
    polygon.scaleY = 1
    this.polygonEditor.updateEditablePolygonBounds(polygon as EditablePolygon)
  }

  private showPolygonMenu(
    action: 'add' | 'remove' | 'delete',
    polygon: EditablePolygon | fabric.Object,
    index: number,
    clientX: number,
    clientY: number,
    insertX?: number,
    insertY?: number
  ) {
    const actions = [action]
    this.showPolygonMenuWithActions(
      actions,
      polygon,
      index,
      clientX,
      clientY,
      insertX,
      insertY
    )
  }

  private showPolygonMenuWithActions(
    actions: (
      | 'add'
      | 'remove'
      | 'delete'
      | 'reset'
      | 'square'
      | 'equilateral'
      | 'zoom'
      | 'rename'
      | 'properties'
    )[],
    target: EditablePolygon | fabric.Object,
    index: number,
    clientX: number,
    clientY: number,
    insertX?: number,
    insertY?: number
  ) {
    this.polygonMenuActions = actions
    this.polygonMenuPolygon = this.isEditablePolygon(target) ? target : null
    this.polygonMenuTarget = target
    this.polygonMenuPointIndex = index
    this.polygonMenuInsertX = insertX ?? 0
    this.polygonMenuInsertY = insertY ?? 0
    for (let i = 0; i < this.polygonMenuButtons.length; i++) {
      const button = this.polygonMenuButtons[i]
      const action = this.polygonMenuActions[i]
      if (!action) {
        button.dataset.action = ''
        button.classList.add('is-hidden')
        continue
      }
      button.dataset.action = action
      button.textContent = localizer.t(this.getPolygonMenuLabel(action))
      button.classList.remove('is-hidden')
    }
    this.polygonMenu.style.left = `${clientX}px`
    this.polygonMenu.style.top = `${clientY}px`
    this.polygonMenu.classList.add('is-visible')
  }

  private getPolygonMenuLabel(
    action:
      | 'add'
      | 'remove'
      | 'delete'
      | 'reset'
      | 'square'
      | 'equilateral'
      | 'zoom'
      | 'rename'
      | 'properties'
  ) {
    switch (action) {
      case 'add':
        return 'editor_polygon_menu_add_point'
      case 'remove':
        return 'editor_polygon_menu_remove_point'
      case 'reset':
        return 'editor_polygon_menu_reset_shape'
      case 'square':
        return 'editor_polygon_menu_make_square'
      case 'equilateral':
        return 'editor_polygon_menu_make_equilateral'
      case 'zoom':
        return 'editor_camera_menu_zoom'
      case 'rename':
        return 'editor_object_menu_rename'
      case 'properties':
        return 'editor_weapon_menu_properties'
      default:
        return 'editor_polygon_menu_delete_shape'
    }
  }

  private hidePolygonMenu() {
    if (!this.polygonMenu.classList.contains('is-visible')) {
      return
    }
    this.polygonMenu.classList.remove('is-visible')
    this.polygonMenuActions.length = 0
    this.polygonMenuPolygon = null
    this.polygonMenuTarget = null
    this.polygonMenuPointIndex = -1
  }

  private async handlePolygonMenuAction(
    action:
      | 'add'
      | 'remove'
      | 'delete'
      | 'reset'
      | 'square'
      | 'equilateral'
      | 'zoom'
      | 'rename'
      | 'properties'
  ) {
    const polygon = this.polygonMenuPolygon
    const target = this.polygonMenuTarget
    if (!target || !target.canvas) {
      this.hidePolygonMenu()
      return
    }
    const canvas = target.canvas
    if (action === 'properties') {
      if (this.isWeaponMarker(target)) {
        await this.propertiesPanel.showWeaponPropertiesDialog(target)
      } else if (this.isEnemyMarker(target)) {
        await this.propertiesPanel.showEnemyPropertiesDialog(target)
      }
      this.hidePolygonMenu()
      return
    }
    if (action === 'delete') {
      const confirmed = await this.dialogManager.confirm(
        localizer.t('editor_confirm_delete_shape')
      )
      if (!confirmed) {
        this.hidePolygonMenu()
        return
      }
      if (canvas.getActiveObject() === target) {
        canvas.discardActiveObject()
      }
      if (this.isCameraFrame(target)) {
        this.removeCameraView(target)
      }
      if (this.isPlayerMarker(target)) {
        this.removePlayerMarker(target)
      }
      if (this.isEnemyMarker(target)) {
        this.removeEnemyMarker(target)
      }
      this.unregisterEditorObject(target)
      canvas.remove(target)
      this.shapeResetMap.delete(target)
      canvas.requestRenderAll()
      this.hidePolygonMenu()
      return
    }
    if (action === 'rename') {
      this.beginObjectRename(target)
      this.hidePolygonMenu()
      return
    }
    if (action === 'zoom') {
      if (!this.isCameraFrame(target)) {
        this.hidePolygonMenu()
        return
      }
      const data = this.cameraViewMap.get(target)
      if (!data) {
        this.hidePolygonMenu()
        return
      }
      const input = await this.dialogManager.prompt(
        localizer.t('editor_camera_menu_zoom'),
        data.zoom.toFixed(2)
      )
      if (input === null) {
        this.hidePolygonMenu()
        return
      }
      const value = Number.parseFloat(input)
      if (!Number.isFinite(value) || value <= 0) {
        this.hidePolygonMenu()
        return
      }
      data.zoom = value
      data.frame.width = data.baseWidth / data.zoom
      data.frame.height = data.baseHeight / data.zoom
      data.frame.scaleX = 1
      data.frame.scaleY = 1
      data.frame.setCoords()
      this.syncCameraIcon(data)
      canvas.requestRenderAll()
      this.hidePolygonMenu()
      return
    }
    if (action === 'reset') {
      if (this.isCameraFrame(target)) {
        const data = this.cameraViewMap.get(target)
        if (data) {
          data.zoom = 1
          data.frame.width = data.baseWidth
          data.frame.height = data.baseHeight
          data.frame.scaleX = 1
          data.frame.scaleY = 1
          data.frame.left = this.editorCanvas.width * 0.5
          data.frame.top = this.editorCanvas.height * 0.5
          data.frame.setCoords()
          this.syncCameraIcon(data)
        }
        canvas.requestRenderAll()
        this.hidePolygonMenu()
        return
      }
      this.resetShape(target)
      canvas.requestRenderAll()
      this.hidePolygonMenu()
      return
    }
    if (action === 'square') {
      this.makeSquare(target)
      canvas.requestRenderAll()
      this.hidePolygonMenu()
      return
    }
    if (action === 'equilateral') {
      this.makeEquilateralTriangle(target)
      canvas.requestRenderAll()
      this.hidePolygonMenu()
      return
    }
    if (!polygon || !polygon.points || !polygon.canvas) {
      this.hidePolygonMenu()
      return
    }
    if (action === 'add') {
      this.polygonEditor.insertPolygonPoint(
        polygon.points,
        this.polygonMenuPointIndex,
        this.polygonMenuInsertX,
        this.polygonMenuInsertY
      )
    } else if (action === 'remove') {
      if (polygon.points.length <= 3) {
        this.hidePolygonMenu()
        return
      }
      this.polygonEditor.removePolygonPoint(
        polygon.points,
        this.polygonMenuPointIndex
      )
    }
    polygon.dirty = true
    this.polygonEditor.updateEditablePolygonBounds(polygon)
    this.polygonEditor.refreshEditablePolygonControls(polygon)
    polygon.canvas.requestRenderAll()
    this.hidePolygonMenu()
  }

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
    nextColor: string
  ) {
    const body = marker.item(0)
    const eye = marker.item(1)
    const bodyRadiusPx = computeEnemyBodyRadiusPx(
      nextRadius,
      EDITOR_PIXELS_PER_METER
    )
    const eyeRadiusPx = 0.08 * EDITOR_PIXELS_PER_METER
    const eyeOffsetX = bodyRadiusPx * 0.5
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
    const template = WEAPON_TEMPLATES[marker.weaponType]
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
      WEAPON_TEMPLATES
    )
    const weaponMarker = result.weaponMarker as WeaponMarker
    const weaponData = result.weaponData as WeaponMarkerData
    this.weaponMarkerMap.set(weaponMarker, weaponData)
    const markerKey =
      slot === 'main' ? 'mainWeaponMarker' : 'secondaryWeaponMarker'
    enemyData[markerKey] = weaponMarker
  }

  private getOrCreateEnemyWeaponMarker(
    enemyData: EnemyMarkerData,
    weaponType: WeaponType,
    slot: 'main' | 'secondary'
  ): WeaponMarker | null {
    const markerKey =
      slot === 'main' ? 'mainWeaponMarker' : 'secondaryWeaponMarker'
    let weaponMarker = enemyData[markerKey]

    if (weaponMarker && weaponMarker.weaponType !== weaponType) {
      this.weaponMarkerMap.delete(weaponMarker)
      weaponMarker = undefined
      enemyData[markerKey] = undefined
    }

    if (!weaponMarker) {
      const template = WEAPON_TEMPLATES[weaponType]
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
        WEAPON_TEMPLATES
      )

      weaponMarker = result.weaponMarker as WeaponMarker
      const weaponData = result.weaponData as WeaponMarkerData
      this.weaponMarkerMap.set(weaponMarker, weaponData)
      enemyData[markerKey] = weaponMarker
    }

    return weaponMarker
  }

  private removeCameraView(frame: CameraFrame) {
    const data = this.cameraViewMap.get(frame)
    if (!data || !data.frame.canvas) {
      return
    }
    const canvas = data.frame.canvas
    canvas.remove(data.icon)
    this.cameraViewMap.delete(frame)
    const index = this.cameraViews.indexOf(data)
    if (index !== -1) {
      this.cameraViews.splice(index, 1)
    }
  }

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

    this.editorOverlay.addEventListener(
      'contextmenu',
      (event) => {
        if (!this.visible || this.currentView !== EditorView.Editor) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        if (this.editorCanvas.contains(event.target as Node)) {
          this.handleEditablePolygonContextMenuEvent(event)
        }
      },
      true
    )

    this.fabricCanvas.on('mouse:wheel', (opt) => {
      const delta = opt.e.deltaY

      let zoom = this.fabricCanvas!.getZoom()

      zoom *= 0.999 ** delta

      if (zoom > 20) zoom = 20

      if (zoom < 0.1) zoom = 0.1

      this.fabricCanvas!.zoomToPoint(
        { x: opt.e.offsetX, y: opt.e.offsetY },
        zoom
      )

      opt.e.preventDefault()

      opt.e.stopPropagation()
    })

    this.fabricCanvas.on('mouse:down', (opt) => {
      const evt = opt.e
      if (evt.button === 1) {
        // middle button
        this.isPanning = true
        this.fabricCanvas!.selection = false
        this.lastClientX = evt.clientX
        this.lastClientY = evt.clientY
        this.fabricCanvas!.defaultCursor = 'grabbing'
        evt.preventDefault()
        evt.stopPropagation()
        return
      }
      if (evt.button === 0) {
        this.hidePolygonMenu()
        if (opt.target && this.editorObjectMap.has(opt.target)) {
          this.prepareSnapCandidates(opt.target)
        } else {
          this.clearSnapCandidates()
        }
        this.handleEditablePolygonPointerDown(opt)
      }
    })

    this.fabricCanvas.on('mouse:move', (opt) => {
      if (this.isPanning && opt.e) {
        const e = opt.e
        const vpt = this.fabricCanvas!.viewportTransform
        if (vpt) {
          vpt[4] += e.clientX - this.lastClientX
          vpt[5] += e.clientY - this.lastClientY
          this.fabricCanvas!.requestRenderAll()
        }
        this.lastClientX = e.clientX
        this.lastClientY = e.clientY
      }
    })

    this.fabricCanvas.on('mouse:up', (opt) => {
      if (this.isPanning) {
        this.isPanning = false
        this.fabricCanvas!.selection = true
        this.fabricCanvas!.defaultCursor = 'default'
        const vpt = this.fabricCanvas!.viewportTransform
        if (vpt) {
          this.fabricCanvas!.setViewportTransform(vpt)
        }
      }
      if (!this.isPanning) {
        this.hideSnapGuides()
        this.clearSnapCandidates()
      }
    })

    this.fabricCanvas.on('object:moving', (opt) => {
      const target = opt.target
      if (!target || this.isPanning) {
        return
      }
      this.handleObjectMovingSnap(target)
    })
    this.fabricCanvas.on('object:modified', () => {
      this.hideSnapGuides()
      this.clearSnapCandidates()
    })

    this.fabricCanvas.on('selection:created', (opt) => {
      this.handleCanvasSelection(opt.selected?.[0] ?? null)
    })
    this.fabricCanvas.on('selection:updated', (opt) => {
      this.handleCanvasSelection(opt.selected?.[0] ?? null)
    })
    this.fabricCanvas.on('selection:cleared', () => {
      this.handleCanvasSelection(null)
      this.hideSnapGuides()
      this.clearSnapCandidates()
    })

    this.resizeEditorCanvas()
    this.applyBackgroundPattern()
  }

  private refreshCameraFocus(target: fabric.Object | null) {
    const focused = this.isCameraFrame(target) ? target : null
    for (let i = 0; i < this.cameraViews.length; i++) {
      const view = this.cameraViews[i]
      const shouldShow = focused === view.frame
      if (view.icon.visible !== shouldShow) {
        view.icon.visible = shouldShow
      }
      const fill = shouldShow ? CAMERA_FRAME_FILL : CAMERA_FRAME_FILL_UNFOCUSED
      if (view.frame.fill !== fill) {
        view.frame.set('fill', fill)
      }
      if (shouldShow) {
        this.syncCameraIcon(view)
        view.icon.bringToFront()
      }
    }
  }

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

  private getGroundPatternImage() {
    if (!this.groundPatternImage) {
      this.groundPatternImage = PatternCreator.createGroundImage(() => {
        if (this.fabricCanvas) {
          this.fabricCanvas.requestRenderAll()
        }
      })
    }
    return this.groundPatternImage
  }

  private getObstaclePatternImage() {
    if (!this.obstaclePatternImage) {
      this.obstaclePatternImage = PatternCreator.createObstacleImage(() => {
        if (this.fabricCanvas) {
          this.fabricCanvas.requestRenderAll()
        }
      })
    }
    return this.obstaclePatternImage
  }

  private setPanelCollapsed(collapsed: boolean) {
    this.panelCollapsed = collapsed
    if (collapsed) {
      this.editorSidebar.style.display = 'none'
      this.editorPanelCollapsedBtn.classList.add('is-visible')
      this.hidePanelMenu()
      this.hideObjectTypeMenu()
      this.hideGroundSubmenu()
      this.hideObstacleSubmenu()
    } else {
      if (this.currentView === EditorView.Editor) {
        this.editorSidebar.style.display = 'block'
      }
      this.editorPanelCollapsedBtn.classList.remove('is-visible')
    }
  }

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
    if (this.snapGuideVertical) {
      this.snapGuideVertical.set({
        x1: this.snapGuideVertical.x1,
        x2: this.snapGuideVertical.x2,
        y1: 0,
        y2: targetHeight,
      })
      this.snapGuideVertical.setCoords()
    }
    if (this.snapGuideHorizontal) {
      this.snapGuideHorizontal.set({
        x1: 0,
        x2: targetWidth,
        y1: this.snapGuideHorizontal.y1,
        y2: this.snapGuideHorizontal.y2,
      })
      this.snapGuideHorizontal.setCoords()
    }
    this.fabricCanvas.requestRenderAll()
  }

  private handleWindowResize() {
    if (!this.visible || this.currentView !== EditorView.Editor) {
      return
    }

    this.resizeEditorCanvas()
    if (
      this.objectTypeMenu.classList.contains('is-visible') &&
      this.groundSubmenu.classList.contains('is-visible')
    ) {
      this.positionGroundSubmenu()
    }
    if (
      this.objectTypeMenu.classList.contains('is-visible') &&
      this.obstacleSubmenu.classList.contains('is-visible')
    ) {
      this.positionObstacleSubmenu()
    }
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
    this.hidePanelMenu()
    this.hideObjectTypeMenu()
    this.hideGroundSubmenu()
    this.hideObstacleSubmenu()
    this.hideWeaponMenu()
    this.hidePolygonMenu()
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

  private async captureThumbnail(): Promise<string | null> {
    if (this.gameClient) {
      return this.captureThumbnailFromPreview()
    }
    return this.captureThumbnailFromEditor()
  }

  private async captureThumbnailFromPreview(): Promise<string | null> {
    if (!this.gameClient) {
      return null
    }

    const data = this.mapSerializer.serializeCurrentMapData()
    const meta = this.currentMapMeta ?? {
      id: 'preview',
      name: 'preview',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    this.gameCanvas.style.visibility = 'visible'

    this.gameClient.applyMapPreview(data)
    this.gameClient.start()

    await new Promise((resolve) => setTimeout(resolve, 1000))

    const snapshotDataUrl = this.gameCanvas.toDataURL('image/jpeg', 0.8)

    this.gameClient.clearMapPreview()
    this.gameCanvas.style.visibility = 'hidden'

    if (!snapshotDataUrl) return null
    return this.resizeThumbnail(snapshotDataUrl, 200, 160)
  }

  private async captureThumbnailFromEditor(): Promise<string | null> {
    if (!this.fabricCanvas) {
      return null
    }

    const originalTransform = this.fabricCanvas.viewportTransform?.slice()
    const originalWidth = this.fabricCanvas.width ?? 800
    const originalHeight = this.fabricCanvas.height ?? 600

    let cameraFrame: CameraFrame | null = null
    if (this.cameraViews.length > 0) {
      cameraFrame = this.cameraViews[0].frame
    }

    this.fabricCanvas.discardActiveObject()
    this.fabricCanvas.requestRenderAll()

    let snapshotDataUrl = ''

    if (cameraFrame && cameraFrame.width && cameraFrame.height) {
      const wasVisible = cameraFrame.visible
      const wasIconVisible = this.cameraViews[0].icon.visible
      cameraFrame.visible = false
      this.cameraViews[0].icon.visible = false

      const frameWidth = (cameraFrame.width ?? 0) * (cameraFrame.scaleX ?? 1)
      const frameHeight = (cameraFrame.height ?? 0) * (cameraFrame.scaleY ?? 1)

      const scaleX = originalWidth / frameWidth
      const scaleY = originalHeight / frameHeight
      const scale = Math.min(scaleX, scaleY)

      const centerX = cameraFrame.left ?? 0
      const centerY = cameraFrame.top ?? 0

      const tx = originalWidth / 2 - centerX * scale
      const ty = originalHeight / 2 - centerY * scale

      this.fabricCanvas.setViewportTransform([scale, 0, 0, scale, tx, ty])
      this.fabricCanvas.renderAll()

      snapshotDataUrl = this.fabricCanvas.toDataURL({
        format: 'jpeg',
        quality: 0.8,
        multiplier: 1,
      })

      cameraFrame.visible = wasVisible
      this.cameraViews[0].icon.visible = wasIconVisible
    } else {
      snapshotDataUrl = this.fabricCanvas.toDataURL({
        format: 'jpeg',
        quality: 0.8,
      })
    }

    if (originalTransform) {
      this.fabricCanvas.setViewportTransform(originalTransform)
    }
    this.fabricCanvas.renderAll()

    if (!snapshotDataUrl) return null
    return this.resizeThumbnail(snapshotDataUrl, 200, 160)
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
}
