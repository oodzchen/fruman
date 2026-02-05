import { fabric } from 'fabric'

import { EditorView } from '../EditorManager'
import type { EditorSnapManager } from './EditorSnapManager'
import type { EditorObjectData } from './types'

interface EditorCanvasEventHandlerContext {
  fabricCanvas: () => fabric.Canvas | null
  editorCanvas: HTMLCanvasElement
  editorOverlay: HTMLDivElement
  snapManager: EditorSnapManager
  editorObjectMap: WeakMap<fabric.Object, EditorObjectData>
  getIsPanning: () => boolean
  setIsPanning: (value: boolean) => void
  getLastPanPosition: () => { x: number; y: number }
  setLastPanPosition: (x: number, y: number) => void
  isVisible: () => boolean
  getCurrentView: () => EditorView
  hidePolygonMenu: () => void
  handleEditablePolygonContextMenuEvent: (event: MouseEvent) => void
  handleEditablePolygonPointerDown: (opt: fabric.IEvent<Event>) => boolean
  handleCanvasSelection: (objects: fabric.Object[]) => void
  onObjectModified: () => void
  onPolygonEdited: () => void
}

export class EditorCanvasEventHandler {
  private ctx: EditorCanvasEventHandlerContext

  constructor(ctx: EditorCanvasEventHandlerContext) {
    this.ctx = ctx
  }

  attachEventListeners() {
    const canvas = this.ctx.fabricCanvas()
    if (!canvas) {
      return
    }

    this.ctx.editorOverlay.addEventListener(
      'contextmenu',
      this.handleContextMenu,
      true
    )

    canvas.on('mouse:wheel', this.handleMouseWheel)
    canvas.on('mouse:down', this.handleMouseDown)
    canvas.on('mouse:move', this.handleMouseMove)
    canvas.on('mouse:up', this.handleMouseUp)
    canvas.on('object:moving', this.handleObjectMoving)
    canvas.on('object:modified', this.handleObjectModified)
    canvas.on('selection:created', this.handleSelectionCreated)
    canvas.on('selection:updated', this.handleSelectionUpdated)
    canvas.on('selection:cleared', this.handleSelectionCleared)
  }

  private handleContextMenu = (event: Event) => {
    const mouseEvent = event as MouseEvent
    if (
      !this.ctx.isVisible() ||
      this.ctx.getCurrentView() !== EditorView.Editor
    ) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (this.ctx.editorCanvas.contains(event.target as Node)) {
      this.ctx.handleEditablePolygonContextMenuEvent(mouseEvent)
    }
  }

  private handleMouseWheel = (opt: fabric.IEvent<WheelEvent>) => {
    const canvas = this.ctx.fabricCanvas()
    if (!canvas) {
      return
    }

    const delta = opt.e.deltaY
    let zoom = canvas.getZoom()

    zoom *= 0.999 ** delta

    if (zoom > 20) zoom = 20
    if (zoom < 0.1) zoom = 0.1

    canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom)

    opt.e.preventDefault()
    opt.e.stopPropagation()
  }

  private handleMouseDown = (opt: fabric.IEvent<Event>) => {
    const canvas = this.ctx.fabricCanvas()
    if (!canvas) {
      return
    }

    const evt = opt.e as MouseEvent
    if (evt.button === 1) {
      this.ctx.setIsPanning(true)
      canvas.selection = false
      this.ctx.setLastPanPosition(evt.clientX, evt.clientY)
      canvas.defaultCursor = 'grabbing'
      evt.preventDefault()
      evt.stopPropagation()
      return
    }
    if (evt.button === 0) {
      this.ctx.hidePolygonMenu()
      if (opt.target && this.ctx.editorObjectMap.has(opt.target)) {
        this.ctx.snapManager.prepareSnapCandidates(opt.target)
      } else {
        this.ctx.snapManager.clearSnapCandidates()
      }
      const edited = this.ctx.handleEditablePolygonPointerDown(opt)
      if (edited) {
        this.ctx.onPolygonEdited()
      }
    }
  }

  private handleMouseMove = (opt: fabric.IEvent<Event>) => {
    const canvas = this.ctx.fabricCanvas()
    if (!canvas) {
      return
    }

    if (this.ctx.getIsPanning() && opt.e) {
      const e = opt.e as MouseEvent
      const vpt = canvas.viewportTransform
      if (vpt) {
        const lastPos = this.ctx.getLastPanPosition()
        vpt[4] += e.clientX - lastPos.x
        vpt[5] += e.clientY - lastPos.y
        canvas.requestRenderAll()
      }
      this.ctx.setLastPanPosition(e.clientX, e.clientY)
    }
  }

  private handleMouseUp = () => {
    const canvas = this.ctx.fabricCanvas()
    if (!canvas) {
      return
    }

    if (this.ctx.getIsPanning()) {
      this.ctx.setIsPanning(false)
      canvas.selection = true
      canvas.defaultCursor = 'default'
      const vpt = canvas.viewportTransform
      if (vpt) {
        canvas.setViewportTransform(vpt)
      }
    }
    if (!this.ctx.getIsPanning()) {
      this.ctx.snapManager.hideSnapGuides()
      this.ctx.snapManager.clearSnapCandidates()
    }
  }

  private handleObjectMoving = (opt: fabric.IEvent<Event>) => {
    const target = opt.target
    if (!target || this.ctx.getIsPanning()) {
      return
    }
    this.ctx.snapManager.handleObjectMoving(target)
  }

  private handleObjectModified = () => {
    this.ctx.snapManager.hideSnapGuides()
    this.ctx.snapManager.clearSnapCandidates()
    this.ctx.onObjectModified()
  }

  private handleSelectionCreated = (opt: fabric.IEvent<Event>) => {
    const selectedObjects = (
      opt as fabric.IEvent<Event> & { selected?: fabric.Object[] }
    ).selected
    this.ctx.handleCanvasSelection(selectedObjects ?? [])
  }

  private handleSelectionUpdated = (opt: fabric.IEvent<Event>) => {
    const selectedObjects = (
      opt as fabric.IEvent<Event> & { selected?: fabric.Object[] }
    ).selected
    this.ctx.handleCanvasSelection(selectedObjects ?? [])
  }

  private handleSelectionCleared = () => {
    this.ctx.handleCanvasSelection([])
    this.ctx.snapManager.hideSnapGuides()
    this.ctx.snapManager.clearSnapCandidates()
  }
}
