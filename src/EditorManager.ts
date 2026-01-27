import { fabric } from 'fabric'

import { localizer } from './Localizer'

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

type ShapeResetData =
  | { kind: 'rect'; width: number; height: number }
  | { kind: 'circle'; radius: number }
  | { kind: 'triangle'; points: ReadonlyArray<readonly [number, number]> }
  | { kind: 'polygon'; points: ReadonlyArray<readonly [number, number]> }

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
  Enemy = 'enemy',
  Weapon = 'weapon',
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

export class EditorManager {
  private editorOverlay: HTMLDivElement
  private editorBackBtn: HTMLButtonElement
  private editorSidebar: HTMLDivElement
  private editorPanelCollapseBtn: HTMLButtonElement
  private editorPanelCollapsedBtn: HTMLButtonElement
  private editorWorkspace: HTMLDivElement
  private editorCanvas: HTMLCanvasElement
  private gameCanvas: HTMLCanvasElement
  private editorMapListView: HTMLDivElement
  private editorMapList: HTMLDivElement
  private editorObjectItems: NodeListOf<HTMLButtonElement>
  private groundMenuItem: HTMLButtonElement
  private groundSubmenu: HTMLDivElement
  private groundSubmenuItems: NodeListOf<HTMLButtonElement>

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
  )[] = []
  private polygonMenuPolygon: EditablePolygon | null = null
  private polygonMenuTarget: fabric.Object | null = null
  private polygonMenuPointIndex = -1
  private polygonMenuInsertX = 0
  private polygonMenuInsertY = 0
  private shapeResetMap = new Map<fabric.Object, ShapeResetData>()

  constructor() {
    const overlay = document.getElementById('editorOverlay')
    const backBtn = document.getElementById('editorBackBtn')
    const sidebar = document.getElementById('editorSidebar')
    const panelCollapseBtn = document.getElementById('editorPanelCollapse')
    const panelCollapsedBtn = document.getElementById('editorPanelCollapsed')
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
    const groundSubmenu = document.getElementById('editorGroundSubmenu')
    const groundSubmenuItems = document.querySelectorAll<HTMLButtonElement>(
      '#editorGroundSubmenu .editor-submenu-item'
    )

    const modal = document.getElementById('editorPropertiesModal')
    const modalTitle = document.getElementById('editorPropertiesTitle')
    const modalForm = document.getElementById('editorPropertiesForm')
    const modalConfirm = document.getElementById('editorPropertiesConfirm')
    const modalCancel = document.getElementById('editorPropertiesCancel')
    const polygonMenu = document.getElementById('editorPolygonMenu')
    const polygonMenuPrimary = document.getElementById(
      'editorPolygonMenuPrimary'
    )
    const polygonMenuSecondary = document.getElementById(
      'editorPolygonMenuSecondary'
    )
    const polygonMenuTertiary = document.getElementById(
      'editorPolygonMenuTertiary'
    )

    if (
      !(overlay instanceof HTMLDivElement) ||
      !(backBtn instanceof HTMLButtonElement) ||
      !(sidebar instanceof HTMLDivElement) ||
      !(panelCollapseBtn instanceof HTMLButtonElement) ||
      !(panelCollapsedBtn instanceof HTMLButtonElement) ||
      !(workspace instanceof HTMLDivElement) ||
      !(editorCanvas instanceof HTMLCanvasElement) ||
      !(gameCanvas instanceof HTMLCanvasElement) ||
      !(mapListView instanceof HTMLDivElement) ||
      !(mapList instanceof HTMLDivElement) ||
      !(groundMenu instanceof HTMLButtonElement) ||
      !(groundSubmenu instanceof HTMLDivElement) ||
      !(modal instanceof HTMLDivElement) ||
      !(modalTitle instanceof HTMLHeadingElement) ||
      !(modalForm instanceof HTMLDivElement) ||
      !(modalConfirm instanceof HTMLButtonElement) ||
      !(modalCancel instanceof HTMLButtonElement) ||
      !(polygonMenu instanceof HTMLDivElement) ||
      !(polygonMenuPrimary instanceof HTMLButtonElement) ||
      !(polygonMenuSecondary instanceof HTMLButtonElement) ||
      !(polygonMenuTertiary instanceof HTMLButtonElement)
    ) {
      throw new Error('Editor elements are missing.')
    }

    this.editorOverlay = overlay
    this.editorBackBtn = backBtn
    this.editorSidebar = sidebar
    this.editorPanelCollapseBtn = panelCollapseBtn
    this.editorPanelCollapsedBtn = panelCollapsedBtn
    this.editorWorkspace = workspace
    this.editorCanvas = editorCanvas
    this.gameCanvas = gameCanvas
    this.editorMapListView = mapListView
    this.editorMapList = mapList
    this.editorObjectItems = objectItems
    this.groundMenuItem = groundMenu
    this.groundSubmenu = groundSubmenu
    this.groundSubmenuItems = groundSubmenuItems

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

    this.groundSubmenuItems.forEach((item) => {
      item.addEventListener('click', () => {
        const shape = item.dataset.shape as GroundShapeType
        this.handleGroundShapeClick(shape)
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
        if (this.polygonMenu.contains(event.target as Node)) {
          return
        }
        this.hidePolygonMenu()
      },
      true
    )

    this.polygonMenu.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })
    this.polygonMenu.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      event.stopPropagation()
    })

    document.addEventListener(
      'contextmenu',
      (event) => {
        if (!this.visible || this.currentView !== EditorView.Editor) {
          return
        }
        if (!this.editorOverlay.contains(event.target as Node)) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        this.handleEditablePolygonContextMenuEvent(event)
      },
      true
    )
  }

  private updateLocalization() {
    this.editorBackBtn.textContent = localizer.t('editor_back_to_menu')

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
    if (type === ObjectType.Ground) {
      if (this.activeObjectType === ObjectType.Ground) {
        this.hideGroundSubmenu()
        this.setActiveObjectType(null)
        return
      }
      this.setActiveObjectType(ObjectType.Ground)
      this.showGroundSubmenu()
      return
    }

    this.hideGroundSubmenu()
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
    this.hideGroundSubmenu()
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
    this.ensureFabricCanvas()
    this.resizeEditorCanvas()
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
    const sidebarRect = this.editorSidebar.getBoundingClientRect()
    const itemRect = this.groundMenuItem.getBoundingClientRect()
    const top = Math.max(0, itemRect.top - sidebarRect.top)
    this.groundSubmenu.style.top = `${top}px`
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

    shapeObject.left = centerX
    shapeObject.top = centerY
    shapeObject.setCoords()
    this.fabricCanvas.add(shapeObject)
    this.fabricCanvas.setActiveObject(shapeObject)
    this.fabricCanvas.renderAll()
    this.hideGroundSubmenu()
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
    const actions: ('delete' | 'reset' | 'square' | 'equilateral')[] = [
      'delete',
      'reset',
    ]
    if (target.type === 'rect') {
      actions.push('square')
    }
    if (this.isTriangleShape(target)) {
      actions.push('equilateral')
    }
    this.showPolygonMenuWithActions(actions, target, -1, clientX, clientY)
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
    action: 'add' | 'remove' | 'delete' | 'reset' | 'square' | 'equilateral'
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
    action: 'add' | 'remove' | 'delete' | 'reset' | 'square' | 'equilateral'
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
      canvas.remove(target)
      this.shapeResetMap.delete(target)
      canvas.requestRenderAll()
      this.hidePolygonMenu()
      return
    }
    if (action === 'reset') {
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
    })

    this.resizeEditorCanvas()
    this.applyBackgroundPattern()
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

  private setPanelCollapsed(collapsed: boolean) {
    this.panelCollapsed = collapsed
    if (collapsed) {
      this.editorSidebar.style.display = 'none'
      this.editorPanelCollapsedBtn.classList.add('is-visible')
      this.hideGroundSubmenu()
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
    this.fabricCanvas.requestRenderAll()
  }

  private handleWindowResize() {
    if (!this.visible || this.currentView !== EditorView.Editor) {
      return
    }

    this.resizeEditorCanvas()
    if (this.groundSubmenu.classList.contains('is-visible')) {
      this.positionGroundSubmenu()
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
    this.hideGroundSubmenu()
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
