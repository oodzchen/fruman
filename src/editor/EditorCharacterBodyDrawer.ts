import type { MapCharacterBodyProfile } from '../editorMapTypes'
import { EditorBodyDrawerController } from './EditorBodyDrawerController'
import type { EditorCharacterBodyDrawerOptions } from './EditorBodyDrawerTypes'
import { DRAW_WORLD_SIZE } from './EditorBodyDrawerTypes'

export class EditorCharacterBodyDrawer {
  private maskCanvas = document.createElement('canvas')
  private shapeCanvas = document.createElement('canvas')
  private textureCanvas = document.createElement('canvas')
  private browCanvas = document.createElement('canvas')
  private workCanvas = document.createElement('canvas')

  constructor() {
    this.maskCanvas.width = DRAW_WORLD_SIZE
    this.maskCanvas.height = DRAW_WORLD_SIZE
    this.shapeCanvas.width = DRAW_WORLD_SIZE
    this.shapeCanvas.height = DRAW_WORLD_SIZE
    this.textureCanvas.width = DRAW_WORLD_SIZE
    this.textureCanvas.height = DRAW_WORLD_SIZE
    this.browCanvas.width = DRAW_WORLD_SIZE
    this.browCanvas.height = DRAW_WORLD_SIZE
    this.workCanvas.width = DRAW_WORLD_SIZE
    this.workCanvas.height = DRAW_WORLD_SIZE
  }

  async show(
    options: EditorCharacterBodyDrawerOptions
  ): Promise<MapCharacterBodyProfile | null | undefined> {
    const controller = new EditorBodyDrawerController(
      this.maskCanvas,
      this.shapeCanvas,
      this.textureCanvas,
      this.browCanvas,
      this.workCanvas
    )
    return controller.run(options)
  }
}
