import { fabric } from 'fabric'

import { localizer } from './Localizer'
import { DEFAULT_PLAYER_RADIUS } from './constants'

const fabricControlsUtils = (
  fabric as unknown as {
    controlsUtils: {
      renderCircleControl: (
        ctx: CanvasRenderingContext2D,
        left: number,
        top: number,
        styleOverride: unknown,
        fabricObject: fabric.Object
      ) => void
    }
  }
).controlsUtils

const fabricTransformPoint = (
  fabric.util as {
    transformPoint: (
      point: fabric.Point,
      matrix: number[],
      ignoreOffset?: boolean
    ) => fabric.Point
  }
).transformPoint

type GroundShapeType = 'rect' | 'triangle' | 'circle' | 'polygon'

type EditablePolygon = fabric.Polygon & {
  editorShape: 'ground-polygon'
}

type CameraFrame = fabric.Rect & {
  editorShape: 'camera-frame'
}

type PlayerMarker = fabric.Group & {
  editorShape: 'player-marker'
}

type ShapeResetData =
  | { kind: 'rect'; width: number; height: number }
  | { kind: 'circle'; radius: number }
  | { kind: 'triangle'; points: ReadonlyArray<readonly [number, number]> }
  | { kind: 'polygon'; points: ReadonlyArray<readonly [number, number]> }

interface CameraViewData {
  frame: CameraFrame
  icon: fabric.Group
  zoom: number
  baseWidth: number
  baseHeight: number
}

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
const DEBUG_EDITOR_MENU = false
const OBSTACLE_FILL_COLOR = 'rgba(112, 64, 14, 0.85)'
const SNAP_THRESHOLD_PX = 10
const SNAP_GUIDE_COLOR = 'rgba(240, 220, 180, 0.75)'
const SNAP_EVERY_N_FRAMES = 2

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

export enum ObjectType {
  Player = 'player',
  Enemy = 'enemy',
  Weapon = 'weapon',
  Camera = 'camera',
  Ground = 'ground',
  Obstacle = 'obstacle',
}

interface EditorMap {
  id: string
  name: string
  createdAt: number
}

interface PropertyField {
  key: string
  label: string
  type: 'text' | 'number'
  defaultValue: string | number
}

interface EditorObjectData {
  id: number
  name: string
  type: ObjectType
  object: fabric.Object
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
  private editorObjectPanelTitle: HTMLDivElement
  private editorObjectTree: HTMLDivElement
  private editorWorkspace: HTMLDivElement
  private editorCanvas: HTMLCanvasElement
  private gameCanvas: HTMLCanvasElement
  private editorMapListView: HTMLDivElement
  private editorMapList: HTMLDivElement
  private editorObjectItems: NodeListOf<HTMLButtonElement>
  private objectTypeMenu: HTMLDivElement
  private panelMenu: HTMLDivElement
  private panelMenuAddBtn: HTMLButtonElement
  private groundMenuItem: HTMLButtonElement
  private groundSubmenu: HTMLDivElement
  private groundSubmenuItems: NodeListOf<HTMLButtonElement>
  private obstacleMenuItem: HTMLButtonElement
  private obstacleSubmenu: HTMLDivElement
  private obstacleSubmenuItems: NodeListOf<HTMLButtonElement>

  private propertiesModal: HTMLDivElement
  private propertiesTitle: HTMLHeadingElement
  private propertiesForm: HTMLDivElement
  private propertiesConfirmBtn: HTMLButtonElement
  private propertiesCancelBtn: HTMLButtonElement
  private polygonMenu: HTMLDivElement
  private polygonMenuButtons: HTMLButtonElement[] = []

  private visible = false
  private currentView: EditorView = EditorView.MapList
  private maps: EditorMap[] = []
  private onBackToMenuCallback?: () => void
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
  private polygonScratchPoint = new fabric.Point(0, 0)
  private polygonScratchPointB = new fabric.Point(0, 0)
  private polygonScratchPointC = new fabric.Point(0, 0)
  private polygonInverseMatrix: number[] = [1, 0, 0, 1, 0, 0]
  private polygonControlMatrix: number[] = [1, 0, 0, 1, 0, 0]
  private polygonMenuActions: (
    | 'add'
    | 'remove'
    | 'delete'
    | 'reset'
    | 'square'
    | 'equilateral'
    | 'zoom'
    | 'rename'
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

  constructor() {
    const overlay = document.getElementById('editorOverlay')
    const backBtn = document.getElementById('editorBackBtn')
    const sidebar = document.getElementById('editorSidebar')
    const panelCollapseBtn = document.getElementById('editorPanelCollapse')
    const panelCollapsedBtn = document.getElementById('editorPanelCollapsed')
    const objectPanel = document.getElementById('editorObjectPanel')
    const objectPanelTitle = document.getElementById('editorObjectPanelTitle')
    const objectTree = document.getElementById('editorObjectTree')
    const workspace = document.getElementById('editorWorkspace')
    const editorCanvas = document.getElementById('editorCanvas')
    const gameCanvas = document.getElementById('gameCanvas')
    const mapListView = document.getElementById('editorMapListView')
    const mapList = document.getElementById('editorMapList')
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
    const obstacleSubmenu = document.getElementById('editorObstacleSubmenu')
    const obstacleSubmenuItems = document.querySelectorAll<HTMLButtonElement>(
      '#editorObstacleSubmenu .editor-submenu-item'
    )
    const objectTypeMenu = document.getElementById('editorObjectTypeMenu')

    const modal = document.getElementById('editorPropertiesModal')
    const modalTitle = document.getElementById('editorPropertiesTitle')
    const modalForm = document.getElementById('editorPropertiesForm')
    const modalConfirm = document.getElementById('editorPropertiesConfirm')
    const modalCancel = document.getElementById('editorPropertiesCancel')
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
      !(objectPanelTitle instanceof HTMLDivElement) ||
      !(objectTree instanceof HTMLDivElement) ||
      !(workspace instanceof HTMLDivElement) ||
      !(editorCanvas instanceof HTMLCanvasElement) ||
      !(gameCanvas instanceof HTMLCanvasElement) ||
      !(mapListView instanceof HTMLDivElement) ||
      !(mapList instanceof HTMLDivElement) ||
      !(groundMenu instanceof HTMLButtonElement) ||
      !(groundSubmenu instanceof HTMLDivElement) ||
      !(obstacleMenu instanceof HTMLButtonElement) ||
      !(obstacleSubmenu instanceof HTMLDivElement) ||
      !(modal instanceof HTMLDivElement) ||
      !(modalTitle instanceof HTMLHeadingElement) ||
      !(modalForm instanceof HTMLDivElement) ||
      !(modalConfirm instanceof HTMLButtonElement) ||
      !(modalCancel instanceof HTMLButtonElement) ||
      !(polygonMenu instanceof HTMLDivElement) ||
      !(panelMenu instanceof HTMLDivElement) ||
      !(panelMenuAdd instanceof HTMLButtonElement) ||
      !(objectTypeMenu instanceof HTMLDivElement) ||
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
    this.editorObjectPanelTitle = objectPanelTitle
    this.editorObjectTree = objectTree
    this.editorWorkspace = workspace
    this.editorCanvas = editorCanvas
    this.gameCanvas = gameCanvas
    this.editorMapListView = mapListView
    this.editorMapList = mapList
    this.editorObjectItems = objectItems
    this.objectTypeMenu = objectTypeMenu
    this.panelMenu = panelMenu
    this.panelMenuAddBtn = panelMenuAdd
    this.groundMenuItem = groundMenu
    this.groundSubmenu = groundSubmenu
    this.groundSubmenuItems = groundSubmenuItems
    this.obstacleMenuItem = obstacleMenu
    this.obstacleSubmenu = obstacleSubmenu
    this.obstacleSubmenuItems = obstacleSubmenuItems

    this.propertiesModal = modal
    this.propertiesTitle = modalTitle
    this.propertiesForm = modalForm
    this.propertiesConfirmBtn = modalConfirm
    this.propertiesCancelBtn = modalCancel
    this.polygonMenu = polygonMenu
    this.polygonMenuButtons = [
      polygonMenuPrimary,
      polygonMenuSecondary,
      polygonMenuTertiary,
      polygonMenuQuaternary,
    ]

    this.setupEventListeners()
    this.updateLocalization()

    this.handleResize = this.handleWindowResize.bind(this)
    window.addEventListener('resize', this.handleResize)
  }

  private setupEventListeners() {
    this.editorBackBtn.addEventListener('click', () => {
      this.handleBack()
    })

    this.editorPanelCollapseBtn.addEventListener('click', () => {
      this.setPanelCollapsed(true)
    })

    this.editorPanelCollapsedBtn.addEventListener('click', () => {
      this.setPanelCollapsed(false)
    })

    this.editorObjectItems.forEach((item) => {
      item.addEventListener('click', () => {
        const type = item.dataset.type as ObjectType
        this.handleObjectClick(type)
      })
    })

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
        const shape = item.dataset.shape as GroundShapeType
        this.handleGroundShapeClick(shape)
      })
    })
    this.obstacleSubmenuItems.forEach((item) => {
      item.addEventListener('click', () => {
        const shape = item.dataset.shape as GroundShapeType
        this.handleObstacleShapeClick(shape)
      })
    })

    this.propertiesConfirmBtn.addEventListener('click', () => {
      this.handlePropertiesConfirm()
    })

    this.propertiesCancelBtn.addEventListener('click', () => {
      this.hidePropertiesModal()
    })

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
          this.obstacleSubmenu.contains(target)
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

    document.addEventListener(
      'contextmenu',
      (event) => {
        this.routeEditorContextMenu(event)
      },
      true
    )
  }

  private updateLocalization() {
    this.editorBackBtn.textContent = localizer.t('editor_back_to_menu')
    this.editorObjectPanelTitle.textContent = localizer.t(
      'editor_object_panel_title'
    )
    this.panelMenuAddBtn.textContent = localizer.t('editor_panel_add_object')

    this.editorObjectItems.forEach((item) => {
      const type = item.dataset.type
      if (type) {
        item.textContent = localizer.t(`editor_object_${type}`)
      }
    })

    this.propertiesTitle.textContent = localizer.t('editor_properties_title')
    this.propertiesConfirmBtn.textContent = localizer.t('editor_btn_confirm')
    this.propertiesCancelBtn.textContent = localizer.t('editor_btn_cancel')
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
    this.renderObjectTree()
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

  private handleCreateMap() {
    this.showEditorView()
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

    this.hideGroundSubmenu()
    this.hideObstacleSubmenu()
    this.hideObjectTypeMenu()
    this.setActiveObjectType(type)
    this.showPropertiesModal(type)
  }

  private handlePropertiesConfirm() {
    this.hidePropertiesModal()
  }

  private showMapListView() {
    this.currentView = EditorView.MapList
    this.editorSidebar.style.display = 'none'
    this.editorMapListView.style.display = 'flex'
    this.editorCanvas.style.display = 'none'
    this.hidePanelMenu()
    this.hideObjectTypeMenu()
    this.hideGroundSubmenu()
    this.hideObstacleSubmenu()
    this.hidePolygonMenu()
    this.setActiveObjectType(null)
    this.editorPanelCollapsedBtn.classList.remove('is-visible')
    this.renderMapList()
  }

  private showEditorView() {
    this.currentView = EditorView.Editor
    this.editorMapListView.style.display = 'none'
    this.editorSidebar.style.display = this.panelCollapsed ? 'none' : 'block'
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
    this.ensureFabricCanvas()
    this.resizeEditorCanvas()
    this.renderObjectTree()
  }

  private renderMapList() {
    this.editorMapList.innerHTML = ''

    if (this.maps.length === 0) {
      const createBtn = document.createElement('button')
      createBtn.className = 'editor-map-item'
      createBtn.textContent = `+ ${localizer.t('editor_create_map')}`
      createBtn.addEventListener('click', () => {
        this.handleCreateMap()
      })
      this.editorMapList.appendChild(createBtn)
      return
    }

    this.maps.forEach((map) => {
      const item = document.createElement('button')
      item.className = 'editor-map-item'
      item.textContent = map.name
      item.addEventListener('click', () => {
        this.loadMap(map.id)
      })
      this.editorMapList.appendChild(item)
    })

    const createBtn = document.createElement('button')
    createBtn.className = 'editor-map-item'
    createBtn.textContent = `+ ${localizer.t('editor_create_map')}`
    createBtn.addEventListener('click', () => {
      this.handleCreateMap()
    })
    this.editorMapList.appendChild(createBtn)
  }

  private loadMap(mapId: string) {
    this.showEditorView()
  }

  private showPropertiesModal(type: ObjectType) {
    const fields = this.getPropertyFields(type)
    this.renderPropertiesForm(fields)
    this.propertiesModal.classList.add('is-visible')
  }

  private hidePropertiesModal() {
    this.propertiesModal.classList.remove('is-visible')
    this.propertiesForm.innerHTML = ''
  }

  private getPropertyFields(type: ObjectType): PropertyField[] {
    const commonFields: PropertyField[] = [
      {
        key: 'name',
        label: localizer.t('editor_prop_name'),
        type: 'text',
        defaultValue: '',
      },
      {
        key: 'x',
        label: localizer.t('editor_prop_position_x'),
        type: 'number',
        defaultValue: 0,
      },
      {
        key: 'y',
        label: localizer.t('editor_prop_position_y'),
        type: 'number',
        defaultValue: 0,
      },
    ]

    switch (type) {
      case ObjectType.Enemy:
        return [
          ...commonFields,
          {
            key: 'health',
            label: localizer.t('editor_prop_health'),
            type: 'number',
            defaultValue: 100,
          },
          {
            key: 'speed',
            label: localizer.t('editor_prop_speed'),
            type: 'number',
            defaultValue: 1,
          },
        ]
      case ObjectType.Weapon:
        return [
          ...commonFields,
          {
            key: 'damage',
            label: localizer.t('editor_prop_damage'),
            type: 'number',
            defaultValue: 10,
          },
        ]
      case ObjectType.Ground:
      case ObjectType.Obstacle:
        return [
          ...commonFields,
          {
            key: 'width',
            label: localizer.t('editor_prop_width'),
            type: 'number',
            defaultValue: 5,
          },
          {
            key: 'height',
            label: localizer.t('editor_prop_height'),
            type: 'number',
            defaultValue: 0.5,
          },
        ]
      default:
        return commonFields
    }
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

  private isInsideAnyMenu(targetNode: Node) {
    return (
      this.panelMenu.contains(targetNode) ||
      this.objectTypeMenu.contains(targetNode) ||
      this.groundSubmenu.contains(targetNode) ||
      this.obstacleSubmenu.contains(targetNode) ||
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

  private showObjectTypeMenu(clientX: number, clientY: number) {
    this.hidePolygonMenu()
    this.hidePanelMenu()
    this.hideGroundSubmenu()
    this.hideObstacleSubmenu()
    this.objectTypeMenuX = clientX
    this.objectTypeMenuY = clientY
    this.objectTypeMenu.style.left = `${clientX}px`
    this.objectTypeMenu.style.top = `${clientY}px`
    this.objectTypeMenu.classList.add('is-visible')
  }

  private hideObjectTypeMenu() {
    if (!this.objectTypeMenu.classList.contains('is-visible')) {
      return
    }
    this.objectTypeMenu.classList.remove('is-visible')
    this.hideGroundSubmenu()
    this.hideObstacleSubmenu()
  }

  private spawnPlayerMarker() {
    this.ensureFabricCanvas()
    if (!this.fabricCanvas) {
      console.warn('[editor] Fabric canvas not ready')
      return
    }
    if (this.playerMarker && this.playerMarker.canvas) {
      this.fabricCanvas.setActiveObject(this.playerMarker)
      this.handleCanvasSelection(this.playerMarker)
      this.fabricCanvas.requestRenderAll()
      return
    }
    const marker = this.createPlayerMarker()
    const centerX = this.editorCanvas.width * 0.5
    const centerY = this.editorCanvas.height * 0.5
    marker.left = centerX
    marker.top = centerY
    marker.setCoords()
    this.playerMarker = marker
    this.fabricCanvas.add(marker)
    this.registerEditorObject(ObjectType.Player, marker)
    this.fabricCanvas.setActiveObject(marker)
    this.handleCanvasSelection(marker)
    this.fabricCanvas.renderAll()
  }

  private createPlayerMarker(): PlayerMarker {
    const radius = DEFAULT_PLAYER_RADIUS * EDITOR_PIXELS_PER_METER
    const eyeRadius = 0.08 * EDITOR_PIXELS_PER_METER
    const eyeOffsetX = radius * 0.5
    const eyeOffsetY = -radius * 0.5
    const body = new fabric.Circle({
      radius,
      fill: PLAYER_BODY_COLOR,
      stroke: PLAYER_BODY_COLOR,
      strokeWidth: 3,
      originX: 'center',
      originY: 'center',
      objectCaching: false,
    })
    const eye = new fabric.Circle({
      radius: eyeRadius,
      fill: PLAYER_EYE_COLOR,
      stroke: PLAYER_EYE_COLOR,
      strokeWidth: 1,
      originX: 'center',
      originY: 'center',
      left: eyeOffsetX,
      top: eyeOffsetY,
      objectCaching: false,
    })
    const group = new fabric.Group([body, eye], {
      originX: 'center',
      originY: 'center',
      selectable: true,
      hasControls: false,
      lockRotation: true,
      lockScalingX: true,
      lockScalingY: true,
      objectCaching: false,
    }) as PlayerMarker
    group.editorShape = 'player-marker'
    return group
  }

  private spawnCameraViewFrame() {
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
    frame.width = baseWidth
    frame.height = baseHeight
    frame.scaleX = 1
    frame.scaleY = 1
    frame.fill = CAMERA_FRAME_FILL_UNFOCUSED
    const centerX = this.editorCanvas.width * 0.5
    const centerY = this.editorCanvas.height * 0.5
    frame.left = centerX
    frame.top = centerY
    frame.setCoords()
    icon.left = centerX
    icon.top = centerY
    icon.visible = false

    const data: CameraViewData = {
      frame,
      icon,
      zoom: 1,
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

  private renderPropertiesForm(fields: PropertyField[]) {
    this.propertiesForm.innerHTML = ''

    fields.forEach((field) => {
      const group = document.createElement('div')
      group.className = 'editor-property-group'

      const label = document.createElement('label')
      label.textContent = field.label
      label.htmlFor = `prop-${field.key}`

      const input = document.createElement('input')
      input.type = field.type
      input.id = `prop-${field.key}`
      input.name = field.key
      input.value = String(field.defaultValue)

      group.appendChild(label)
      group.appendChild(input)
      this.propertiesForm.appendChild(group)
    })
  }

  private setActiveObjectType(type: ObjectType | null) {
    this.activeObjectType = type
  }

  private showGroundSubmenu() {
    this.positionGroundSubmenu()
    this.groundSubmenu.classList.add('is-visible')
  }

  private hideGroundSubmenu() {
    this.groundSubmenu.classList.remove('is-visible')
  }

  private positionGroundSubmenu() {
    this.positionShapeSubmenu(this.groundMenuItem, this.groundSubmenu)
  }

  private showObstacleSubmenu() {
    this.positionObstacleSubmenu()
    this.obstacleSubmenu.classList.add('is-visible')
  }

  private hideObstacleSubmenu() {
    this.obstacleSubmenu.classList.remove('is-visible')
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
    const editablePolygon = polygon as EditablePolygon
    editablePolygon.editorShape = 'ground-polygon'
    this.refreshEditablePolygonControls(editablePolygon)
  }

  private handleEditablePolygonPointerDown(opt: fabric.IEvent<MouseEvent>) {
    if (!this.fabricCanvas || this.isPanning) {
      return
    }
    const evt = opt.e
    if (!evt.shiftKey && !evt.altKey) {
      return
    }
    const activeObject = this.fabricCanvas.getActiveObject()
    if (!this.isEditablePolygon(activeObject)) {
      return
    }
    if (evt.shiftKey) {
      this.addEditablePolygonPoint(activeObject, evt)
      evt.preventDefault()
      evt.stopPropagation()
      return
    }
    if (evt.altKey) {
      this.removeEditablePolygonPoint(activeObject, evt)
      evt.preventDefault()
      evt.stopPropagation()
    }
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
    this.setLocalPointFromCanvas(
      polygon,
      pointer.x,
      pointer.y,
      this.polygonScratchPoint
    )
    const pointX = this.polygonScratchPoint.x + polygon.pathOffset.x
    const pointY = this.polygonScratchPoint.y + polygon.pathOffset.y
    const pointIndex = this.findNearestPointIndexWithin(
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
    const edgeIndex = this.findNearestEdgeProjection(
      polygon.points,
      pointX,
      pointY,
      this.polygonScratchPointB
    )
    const edgeDx = pointX - this.polygonScratchPointB.x
    const edgeDy = pointY - this.polygonScratchPointB.y
    if (edgeDx * edgeDx + edgeDy * edgeDy > 196) {
      return false
    }
    this.showPolygonMenuWithActions(
      ['add'],
      polygon,
      edgeIndex,
      event.clientX,
      event.clientY,
      this.polygonScratchPointB.x,
      this.polygonScratchPointB.y
    )
    return true
  }

  private isEditablePolygon(
    object: fabric.Object | null
  ): object is EditablePolygon {
    return (
      object instanceof fabric.Polygon &&
      (object as EditablePolygon).editorShape === 'ground-polygon'
    )
  }

  private isDeletableShape(object: fabric.Object) {
    if (this.isCameraFrame(object)) {
      return true
    }
    if (this.isPlayerMarker(object)) {
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

  private refreshEditablePolygonControls(polygon: EditablePolygon) {
    if (!polygon.points) {
      return
    }
    const controls: Record<string, fabric.Control> = Object.create(
      null
    ) as Record<string, fabric.Control>
    const defaultControls = fabric.Object.prototype.controls
    controls.tl = defaultControls.tl
    controls.tr = defaultControls.tr
    controls.bl = defaultControls.bl
    controls.br = defaultControls.br
    controls.mtr = defaultControls.mtr
    controls.ml = defaultControls.ml
    controls.mr = defaultControls.mr
    controls.mt = defaultControls.mt
    controls.mb = defaultControls.mb
    for (let i = 0; i < polygon.points.length; i++) {
      controls[`p${i}`] = this.createPolygonControl(polygon, i)
    }
    polygon.controls = controls
    polygon.setCoords()
  }

  private createPolygonControl(polygon: EditablePolygon, index: number) {
    const controlPoint = new fabric.Point(0, 0)
    return new fabric.Control({
      positionHandler: (_dim, _finalMatrix, fabricObject) => {
        const poly = fabricObject as EditablePolygon
        if (!poly.points || !poly.canvas) {
          return controlPoint
        }
        const point = poly.points[index]
        if (!point) {
          return controlPoint
        }
        const vpt = poly.canvas.viewportTransform
        if (!vpt) {
          controlPoint.x = point.x
          controlPoint.y = point.y
          return controlPoint
        }
        this.multiplyTransformMatrices(
          vpt,
          poly.calcTransformMatrix(),
          this.polygonControlMatrix
        )
        this.applyTransform(
          point.x - poly.pathOffset.x,
          point.y - poly.pathOffset.y,
          this.polygonControlMatrix,
          controlPoint
        )
        return controlPoint
      },
      actionHandler: (eventData, transform) => {
        const poly = transform.target as EditablePolygon
        if (!poly.canvas || !poly.points) {
          return false
        }
        const pointer = poly.canvas.getPointer(eventData)
        this.setEditablePolygonPointFromCanvas(
          poly,
          pointer.x,
          pointer.y,
          index
        )
        poly.dirty = true
        poly.canvas.requestRenderAll()
        return true
      },
      render: fabricControlsUtils.renderCircleControl,
      cursorStyle: 'pointer',
      sizeX: 10,
      sizeY: 10,
      withConnection: false,
    })
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
      this.assignPolygonPoints(polygon, data.points)
      polygon.scaleX = 1
      polygon.scaleY = 1
      this.updateEditablePolygonBounds(polygon as EditablePolygon)
      if (this.isEditablePolygon(polygon)) {
        this.refreshEditablePolygonControls(polygon)
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
    this.ensurePolygonPointsLength(polygon, 3)
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
    this.updateEditablePolygonBounds(polygon as EditablePolygon)
  }

  private ensurePolygonPointsLength(polygon: fabric.Polygon, length: number) {
    if (!polygon.points) {
      polygon.points = []
    }
    while (polygon.points.length < length) {
      polygon.points.push(
        acquirePoint(polygon.pathOffset.x, polygon.pathOffset.y)
      )
    }
    while (polygon.points.length > length) {
      const removed = polygon.points.pop()
      if (removed) {
        releasePoint(removed)
      }
    }
  }

  private assignPolygonPoints(
    polygon: fabric.Polygon,
    points: ReadonlyArray<readonly [number, number]>
  ) {
    if (!polygon.points) {
      polygon.points = []
    }
    this.ensurePolygonPointsLength(polygon, points.length)
    const centerX = polygon.pathOffset.x
    const centerY = polygon.pathOffset.y
    for (let i = 0; i < points.length; i++) {
      const point = polygon.points[i]
      point.x = centerX + points[i][0]
      point.y = centerY + points[i][1]
    }
  }

  private addEditablePolygonPoint(polygon: EditablePolygon, evt: MouseEvent) {
    if (!polygon.canvas || !polygon.points) {
      return
    }
    const pointer = polygon.canvas.getPointer(evt)
    this.setLocalPointFromCanvas(
      polygon,
      pointer.x,
      pointer.y,
      this.polygonScratchPoint
    )
    const pointX = this.polygonScratchPoint.x + polygon.pathOffset.x
    const pointY = this.polygonScratchPoint.y + polygon.pathOffset.y
    const insertIndex = this.findNearestEdgeProjection(
      polygon.points,
      pointX,
      pointY,
      this.polygonScratchPointB
    )
    this.insertPolygonPoint(
      polygon.points,
      insertIndex,
      this.polygonScratchPointB.x,
      this.polygonScratchPointB.y
    )
    polygon.dirty = true
    this.updateEditablePolygonBounds(polygon)
    this.refreshEditablePolygonControls(polygon)
    polygon.canvas.requestRenderAll()
  }

  private removeEditablePolygonPoint(
    polygon: EditablePolygon,
    evt: MouseEvent
  ) {
    if (!polygon.points || polygon.points.length <= 3 || !polygon.canvas) {
      return
    }
    const pointer = polygon.canvas.getPointer(evt)
    this.setLocalPointFromCanvas(
      polygon,
      pointer.x,
      pointer.y,
      this.polygonScratchPoint
    )
    const pointX = this.polygonScratchPoint.x + polygon.pathOffset.x
    const pointY = this.polygonScratchPoint.y + polygon.pathOffset.y
    const removeIndex = this.findNearestPointIndex(
      polygon.points,
      pointX,
      pointY
    )
    this.removePolygonPoint(polygon.points, removeIndex)
    polygon.dirty = true
    this.updateEditablePolygonBounds(polygon)
    this.refreshEditablePolygonControls(polygon)
    polygon.canvas.requestRenderAll()
  }

  private setEditablePolygonPointFromCanvas(
    polygon: EditablePolygon,
    canvasX: number,
    canvasY: number,
    pointIndex: number
  ) {
    if (!polygon.points) {
      return
    }
    this.setLocalPointFromCanvas(
      polygon,
      canvasX,
      canvasY,
      this.polygonScratchPointB
    )
    const point = polygon.points[pointIndex]
    point.x = this.polygonScratchPointB.x + polygon.pathOffset.x
    point.y = this.polygonScratchPointB.y + polygon.pathOffset.y
    polygon.dirty = true
    this.updateEditablePolygonBounds(polygon)
  }

  private updateEditablePolygonBounds(polygon: fabric.Polygon) {
    if (!polygon.points) {
      return
    }
    let minX = polygon.points[0].x
    let minY = polygon.points[0].y
    let maxX = polygon.points[0].x
    let maxY = polygon.points[0].y
    for (let i = 1; i < polygon.points.length; i++) {
      const point = polygon.points[i]
      if (point.x < minX) minX = point.x
      if (point.y < minY) minY = point.y
      if (point.x > maxX) maxX = point.x
      if (point.y > maxY) maxY = point.y
    }
    const width = maxX - minX
    const height = maxY - minY
    const oldOffsetX = polygon.pathOffset.x
    const oldOffsetY = polygon.pathOffset.y
    const newOffsetX = minX + width * 0.5
    const newOffsetY = minY + height * 0.5
    const deltaX = newOffsetX - oldOffsetX
    const deltaY = newOffsetY - oldOffsetY
    if (deltaX !== 0 || deltaY !== 0) {
      const deltaPoint = this.polygonScratchPointC
      deltaPoint.x = deltaX
      deltaPoint.y = deltaY
      const worldDelta = fabricTransformPoint(
        deltaPoint,
        polygon.calcTransformMatrix(),
        true
      )
      polygon.left = (polygon.left ?? 0) + worldDelta.x
      polygon.top = (polygon.top ?? 0) + worldDelta.y
    }
    polygon.width = width
    polygon.height = height
    polygon.pathOffset.x = newOffsetX
    polygon.pathOffset.y = newOffsetY
    polygon.setCoords()
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

  private handlePolygonMenuAction(
    action:
      | 'add'
      | 'remove'
      | 'delete'
      | 'reset'
      | 'square'
      | 'equilateral'
      | 'zoom'
      | 'rename'
  ) {
    const polygon = this.polygonMenuPolygon
    const target = this.polygonMenuTarget
    if (!target || !target.canvas) {
      this.hidePolygonMenu()
      return
    }
    const canvas = target.canvas
    if (action === 'delete') {
      const confirmed = window.confirm(
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
      const input = window.prompt(
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
      this.insertPolygonPoint(
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
      this.removePolygonPoint(polygon.points, this.polygonMenuPointIndex)
    }
    polygon.dirty = true
    this.updateEditablePolygonBounds(polygon)
    this.refreshEditablePolygonControls(polygon)
    polygon.canvas.requestRenderAll()
    this.hidePolygonMenu()
  }

  private removePlayerMarker(marker: PlayerMarker) {
    if (this.playerMarker === marker) {
      this.playerMarker = null
    }
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

  private setLocalPointFromCanvas(
    polygon: fabric.Polygon,
    canvasX: number,
    canvasY: number,
    out: fabric.Point
  ) {
    const transform = polygon.calcTransformMatrix()
    this.invertTransform(transform, this.polygonInverseMatrix)
    this.applyTransform(canvasX, canvasY, this.polygonInverseMatrix, out)
  }

  private invertTransform(source: number[], out: number[]) {
    const a = source[0]
    const b = source[1]
    const c = source[2]
    const d = source[3]
    const e = source[4]
    const f = source[5]
    const det = a * d - b * c
    if (!det) {
      out[0] = 1
      out[1] = 0
      out[2] = 0
      out[3] = 1
      out[4] = 0
      out[5] = 0
      return
    }
    const invDet = 1 / det
    out[0] = d * invDet
    out[1] = -b * invDet
    out[2] = -c * invDet
    out[3] = a * invDet
    out[4] = (c * f - d * e) * invDet
    out[5] = (b * e - a * f) * invDet
  }

  private applyTransform(
    x: number,
    y: number,
    matrix: number[],
    out: fabric.Point
  ) {
    out.x = matrix[0] * x + matrix[2] * y + matrix[4]
    out.y = matrix[1] * x + matrix[3] * y + matrix[5]
  }

  private multiplyTransformMatrices(a: number[], b: number[], out: number[]) {
    const a0 = a[0]
    const a1 = a[1]
    const a2 = a[2]
    const a3 = a[3]
    const a4 = a[4]
    const a5 = a[5]
    const b0 = b[0]
    const b1 = b[1]
    const b2 = b[2]
    const b3 = b[3]
    const b4 = b[4]
    const b5 = b[5]
    out[0] = a0 * b0 + a2 * b1
    out[1] = a1 * b0 + a3 * b1
    out[2] = a0 * b2 + a2 * b3
    out[3] = a1 * b2 + a3 * b3
    out[4] = a0 * b4 + a2 * b5 + a4
    out[5] = a1 * b4 + a3 * b5 + a5
  }

  private findNearestEdgeProjection(
    points: fabric.Point[],
    x: number,
    y: number,
    out: fabric.Point
  ) {
    let nearestIndex = 0
    let nearestDistance = Number.POSITIVE_INFINITY
    let nearestX = points[0].x
    let nearestY = points[0].y
    const count = points.length
    for (let i = 0; i < count; i++) {
      const nextIndex = (i + 1) % count
      const p1 = points[i]
      const p2 = points[nextIndex]
      const dist = this.projectPointToSegment(
        x,
        y,
        p1.x,
        p1.y,
        p2.x,
        p2.y,
        this.polygonScratchPointC
      )
      if (dist < nearestDistance) {
        nearestDistance = dist
        nearestIndex = i
        nearestX = this.polygonScratchPointC.x
        nearestY = this.polygonScratchPointC.y
      }
    }
    out.x = nearestX
    out.y = nearestY
    return nearestIndex
  }

  private findNearestPointIndex(points: fabric.Point[], x: number, y: number) {
    let nearestIndex = 0
    let nearestDistance = Number.POSITIVE_INFINITY
    for (let i = 0; i < points.length; i++) {
      const p = points[i]
      const dx = x - p.x
      const dy = y - p.y
      const dist = dx * dx + dy * dy
      if (dist < nearestDistance) {
        nearestDistance = dist
        nearestIndex = i
      }
    }
    return nearestIndex
  }

  private findNearestPointIndexWithin(
    points: fabric.Point[],
    x: number,
    y: number,
    maxDistanceSq: number
  ) {
    let nearestIndex = -1
    let nearestDistance = maxDistanceSq
    for (let i = 0; i < points.length; i++) {
      const p = points[i]
      const dx = x - p.x
      const dy = y - p.y
      const dist = dx * dx + dy * dy
      if (dist < nearestDistance) {
        nearestDistance = dist
        nearestIndex = i
      }
    }
    return nearestIndex
  }

  private projectPointToSegment(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    out: fabric.Point
  ) {
    const vx = x2 - x1
    const vy = y2 - y1
    const wx = px - x1
    const wy = py - y1
    const c1 = vx * wx + vy * wy
    if (c1 <= 0) {
      out.x = x1
      out.y = y1
      return wx * wx + wy * wy
    }
    const c2 = vx * vx + vy * vy
    if (c2 <= c1) {
      const dx = px - x2
      const dy = py - y2
      out.x = x2
      out.y = y2
      return dx * dx + dy * dy
    }
    const t = c1 / c2
    const projX = x1 + t * vx
    const projY = y1 + t * vy
    out.x = projX
    out.y = projY
    const dx = px - projX
    const dy = py - projY
    return dx * dx + dy * dy
  }

  private insertPolygonPoint(
    points: fabric.Point[],
    insertIndex: number,
    x: number,
    y: number
  ) {
    const newPoint = acquirePoint(x, y)
    points.length += 1
    for (let i = points.length - 1; i > insertIndex + 1; i--) {
      points[i] = points[i - 1]
    }
    points[insertIndex + 1] = newPoint
  }

  private removePolygonPoint(points: fabric.Point[], removeIndex: number) {
    const removed = points[removeIndex]
    for (let i = removeIndex; i < points.length - 1; i++) {
      points[i] = points[i + 1]
    }
    points.length -= 1
    releasePoint(removed)
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
      this.backgroundImage = this.createBackgroundImage()
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
      this.groundPatternImage = this.createGroundPatternImage()
    }
    return this.groundPatternImage
  }

  private getObstaclePatternImage() {
    if (!this.obstaclePatternImage) {
      this.obstaclePatternImage = this.createObstaclePatternImage()
    }
    return this.obstaclePatternImage
  }

  private createBackgroundImage(): HTMLImageElement | null {
    const patternSize = 80
    const patternCanvas = document.createElement('canvas')
    patternCanvas.width = patternSize
    patternCanvas.height = patternSize
    const patternCtx = patternCanvas.getContext('2d')
    if (!patternCtx) {
      return null
    }

    patternCtx.fillStyle = '#0b0c0e'
    patternCtx.fillRect(0, 0, patternSize, patternSize)

    patternCtx.strokeStyle = '#394155'
    patternCtx.lineWidth = 1

    const drawTriangle = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      x3: number,
      y3: number
    ) => {
      patternCtx.beginPath()
      patternCtx.moveTo(x1, y1)
      patternCtx.lineTo(x2, y2)
      patternCtx.lineTo(x3, y3)
      patternCtx.closePath()
      patternCtx.stroke()
    }

    const halfSize = patternSize / 2
    const height = (Math.sqrt(3) / 2) * halfSize

    drawTriangle(0, height, halfSize, 0, halfSize, height)
    drawTriangle(halfSize, 0, patternSize, height, halfSize, height)
    drawTriangle(0, height, halfSize, height * 2, halfSize, height)
    drawTriangle(halfSize, height * 2, patternSize, height, halfSize, height)

    patternCtx.beginPath()
    patternCtx.moveTo(0, height)
    patternCtx.lineTo(patternSize, height)
    patternCtx.stroke()

    const image = new Image()
    image.src = patternCanvas.toDataURL('image/png')
    return image
  }

  // Reuse the main-game ground texture pattern for editor ground shapes.
  private createGroundPatternImage(): HTMLImageElement | null {
    const size = 96
    const patternCanvas = document.createElement('canvas')
    patternCanvas.width = size
    patternCanvas.height = size
    const patternCtx = patternCanvas.getContext('2d')
    if (!patternCtx) {
      return null
    }

    patternCtx.fillStyle = '#826343'
    patternCtx.fillRect(0, 0, size, size)

    patternCtx.strokeStyle = '#a29f4f'
    patternCtx.lineWidth = 1

    const mid = size * 0.5
    patternCtx.beginPath()
    patternCtx.moveTo(0, mid)
    patternCtx.lineTo(mid, 0)
    patternCtx.lineTo(size, mid)
    patternCtx.lineTo(mid, size)
    patternCtx.closePath()
    patternCtx.stroke()

    patternCtx.beginPath()
    patternCtx.moveTo(mid * 0.5, mid)
    patternCtx.lineTo(mid, mid * 0.5)
    patternCtx.lineTo(mid * 1.5, mid)
    patternCtx.lineTo(mid, mid * 1.5)
    patternCtx.closePath()
    patternCtx.stroke()

    const image = new Image()
    image.src = patternCanvas.toDataURL('image/png')
    image.onload = () => {
      if (this.fabricCanvas) {
        this.fabricCanvas.requestRenderAll()
      }
    }
    return image
  }

  // Reuse the main-game obstacle texture pattern for editor obstacle shapes.
  private createObstaclePatternImage(): HTMLImageElement | null {
    const size = 88
    const patternCanvas = document.createElement('canvas')
    patternCanvas.width = size
    patternCanvas.height = size
    const patternCtx = patternCanvas.getContext('2d')
    if (!patternCtx) {
      return null
    }

    patternCtx.fillStyle = '#70400e'
    patternCtx.fillRect(0, 0, size, size)

    patternCtx.strokeStyle = '#d7a168'
    patternCtx.lineWidth = 1

    const radius = size * 0.25
    const rowHeight = Math.sqrt(3) * radius

    const drawHex = (cx: number, cy: number) => {
      patternCtx.beginPath()
      for (let i = 0; i < 6; i += 1) {
        const angle = (Math.PI / 3) * i + Math.PI / 6
        const x = cx + radius * Math.cos(angle)
        const y = cy + radius * Math.sin(angle)
        if (i === 0) {
          patternCtx.moveTo(x, y)
        } else {
          patternCtx.lineTo(x, y)
        }
      }
      patternCtx.closePath()
      patternCtx.stroke()
    }

    for (let row = -1; row <= 2; row += 1) {
      const y = row * rowHeight + rowHeight
      for (let col = -1; col <= 2; col += 1) {
        const xOffset = row % 2 === 0 ? 0 : radius
        const x = col * radius * 2 + radius + xOffset
        drawHex(x, y)
      }
    }

    const image = new Image()
    image.src = patternCanvas.toDataURL('image/png')
    image.onload = () => {
      if (this.fabricCanvas) {
        this.fabricCanvas.requestRenderAll()
      }
    }
    return image
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
    this.showMapListView()
    this.editorOverlay.classList.add('is-visible')
    this.updateLocalization()
    this.gameCanvas.style.visibility = 'hidden'
  }

  hide() {
    this.visible = false
    this.editorOverlay.classList.remove('is-visible')
    this.hidePropertiesModal()
    this.hidePanelMenu()
    this.hideObjectTypeMenu()
    this.hideGroundSubmenu()
    this.hideObstacleSubmenu()
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
}
