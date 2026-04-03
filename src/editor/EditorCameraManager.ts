import * as fabric from 'fabric'

import type { EditorMapData } from '../editorMapTypes'
import {
  CAMERA_FRAME_FILL,
  CAMERA_FRAME_FILL_UNFOCUSED,
  CAMERA_FRAME_OPTIONS,
  CAMERA_ICON_FILL,
  CAMERA_ICON_STROKE,
  EDITOR_PIXELS_PER_METER,
} from './EditorConstants'
import { computeCameraCenterFromOffset } from './EditorCoordinateUtils'
import type { CameraFrame, CameraViewData } from './types'
import type { ObjectType } from './types'

interface EditorCameraManagerContext {
  fabricCanvas: () => fabric.Canvas | null
  editorCanvas: HTMLCanvasElement
  getViewportCenter: () => { x: number; y: number }
  registerEditorObject: (type: ObjectType, object: fabric.Object) => void
  handleCanvasSelection: (object: fabric.Object | null) => void
  ensureFabricCanvas: () => void
}

export class EditorCameraManager {
  private readonly context: EditorCameraManagerContext

  private cameraViews: CameraViewData[] = []
  private cameraViewMap = new Map<fabric.Object, CameraViewData>()

  constructor(context: EditorCameraManagerContext) {
    this.context = context
  }

  getCameraViews(): CameraViewData[] {
    return this.cameraViews
  }

  getCameraViewMap(): Map<fabric.Object, CameraViewData> {
    return this.cameraViewMap
  }

  isCameraFrame(object: fabric.Object | null): object is CameraFrame {
    if (!object) return false
    return (object as CameraFrame).editorShape === 'camera-frame'
  }

  spawnCameraViewFrame(
    camera?: EditorMapData['camera'],
    objectType?: ObjectType
  ): void {
    this.context.ensureFabricCanvas()
    const canvas = this.context.fabricCanvas()
    if (!canvas) {
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
      this.context.editorCanvas.width,
      this.context.editorCanvas.height * 2
    )
    const baseHeight = baseWidth * 0.5
    let zoom = 1
    let centerX = 0
    let centerY = 0

    if (camera) {
      const invPixelsPerMeter = 1 / EDITOR_PIXELS_PER_METER
      const center = computeCameraCenterFromOffset(
        camera,
        this.context.editorCanvas.width,
        this.context.editorCanvas.height,
        invPixelsPerMeter
      )
      zoom = center.zoom
      centerX = center.centerX * EDITOR_PIXELS_PER_METER
      centerY = center.centerY * EDITOR_PIXELS_PER_METER
    } else {
      const center = this.context.getViewportCenter()
      centerX = center.x
      centerY = center.y
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

    canvas.add(frame)
    canvas.add(icon)

    if (objectType) {
      this.context.registerEditorObject(objectType, frame)
    }

    canvas.setActiveObject(frame)
    this.context.handleCanvasSelection(frame)
    this.refreshCameraFocus(frame)
    canvas.renderAll()
  }

  removeCameraView(frame: CameraFrame): void {
    const data = this.cameraViewMap.get(frame)
    if (!data) {
      return
    }

    this.cameraViewMap.delete(frame)
    const index = this.cameraViews.indexOf(data)
    if (index !== -1) {
      this.cameraViews.splice(index, 1)
    }

    const canvas = this.context.fabricCanvas()
    if (canvas && data.icon.canvas) {
      canvas.remove(data.icon)
    }
  }

  refreshCameraFocus(target: fabric.Object | null): void {
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
        view.icon.canvas?.bringObjectToFront(view.icon)
      }
    }
  }

  syncCameraIcon(data: CameraViewData): void {
    data.icon.left = data.frame.left ?? 0
    data.icon.top = data.frame.top ?? 0
    data.icon.setCoords()
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

  private attachCameraFrameHandlers(data: CameraViewData): void {
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
    })
  }

  private updateCameraZoomFromFrame(data: CameraViewData): void {
    const scaleX = data.frame.scaleX ?? 1
    const scaleY = data.frame.scaleY ?? 1
    const avgScale = (scaleX + scaleY) * 0.5
    const currentVisualWidth = (data.frame.width ?? 0) * avgScale
    if (currentVisualWidth > 0) {
      data.zoom = data.baseWidth / currentVisualWidth
    }
  }

  private normalizeCameraFrameScale(data: CameraViewData): void {
    this.updateCameraZoomFromFrame(data)
    const newWidth = data.baseWidth / data.zoom
    const newHeight = data.baseHeight / data.zoom
    data.frame.set({
      width: newWidth,
      height: newHeight,
      scaleX: 1,
      scaleY: 1,
    })
    data.frame.setCoords()
  }

  private applyCameraUniformScale(data: CameraViewData): void {
    const scaleX = data.frame.scaleX ?? 1
    const scaleY = data.frame.scaleY ?? 1
    const avgScale = (scaleX + scaleY) * 0.5
    data.frame.set({
      scaleX: avgScale,
      scaleY: avgScale,
    })
    data.frame.setCoords()
  }
}
