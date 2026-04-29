import { localizer } from '../Localizer'
import type {
  MapEnvironmentAsset,
  MapEnvironmentObjectType,
} from '../editorMapTypes'
import {
  ensureRuntimeEnvironmentAsset,
  getRuntimeEnvironmentAsset,
} from '../environmentAssetRegistry'

const BUILTIN_ENVIRONMENT_TYPES: readonly MapEnvironmentObjectType[] = [
  'tree',
  'hill',
  'house',
  'crate',
  'grass',
  'flower',
  'cloud',
]

const ICON_SIZE = 32
const ICON_PAD = 4
const CURSOR_HOTSPOT_X = 16
const CURSOR_HOTSPOT_Y = 28

export interface EditorEnvironmentPaletteSelection {
  envType: MapEnvironmentObjectType
  assetId: string
  label: string
  cursor: string
}

interface EditorEnvironmentPaletteContext {
  container: HTMLDivElement
  getCustomEnvironmentAssets: () => MapEnvironmentAsset[]
  onSelected: (selection: EditorEnvironmentPaletteSelection) => void
  onCreateCustomEnvironmentAsset: () => Promise<MapEnvironmentAsset | null>
}

export class EditorEnvironmentPalette {
  private readonly ctx: EditorEnvironmentPaletteContext
  private selectedKey = ''
  private selection: EditorEnvironmentPaletteSelection | null = null
  private loadingAssetIds = new Set<string>()

  constructor(ctx: EditorEnvironmentPaletteContext) {
    this.ctx = ctx
    this.ctx.container.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })
    this.render()
  }

  show(): void {
    this.render()
    this.ctx.container.classList.add('is-visible')
  }

  hide(): void {
    this.ctx.container.classList.remove('is-visible')
  }

  refresh(): void {
    if (this.isVisible() || this.ctx.container.childElementCount === 0) {
      this.render()
    }
  }

  updateLocalization(): void {
    this.render()
  }

  clearSelection(): void {
    this.selectedKey = ''
    this.selection = null
    this.updateSelectedState()
  }

  getSelection(): EditorEnvironmentPaletteSelection | null {
    return this.selection
  }

  restoreSelection(selection: EditorEnvironmentPaletteSelection): void {
    this.selectedKey = this.buildKey(selection.envType, selection.assetId)
    this.selection = selection
    this.updateSelectedState()
  }

  isVisible(): boolean {
    return this.ctx.container.classList.contains('is-visible')
  }

  containsTarget(target: Node): boolean {
    return this.ctx.container.contains(target)
  }

  private render(): void {
    const container = this.ctx.container
    container.textContent = ''

    for (let i = 0; i < BUILTIN_ENVIRONMENT_TYPES.length; i++) {
      const envType = BUILTIN_ENVIRONMENT_TYPES[i]
      container.appendChild(this.createBuiltinButton(envType))
    }

    const assets = this.ctx.getCustomEnvironmentAssets()
    for (let i = 0; i < assets.length; i++) {
      container.appendChild(this.createCustomAssetButton(assets[i]))
    }

    container.appendChild(this.createCreateButton())
    this.updateSelectedState()
  }

  private createBuiltinButton(
    envType: MapEnvironmentObjectType
  ): HTMLButtonElement {
    const label = localizer.t(`editor_env_${envType}`)
    const button = this.createIconButton(label, this.buildKey(envType, ''))
    const icon = this.createIconCanvas()
    this.drawBuiltinIcon(icon, envType)
    button.appendChild(icon)
    button.addEventListener('click', () => {
      this.select({
        envType,
        assetId: '',
        label,
        cursor: this.createCursor(envType, ''),
      })
    })
    return button
  }

  private createCustomAssetButton(
    asset: MapEnvironmentAsset
  ): HTMLButtonElement {
    const button = this.createIconButton(
      asset.name,
      this.buildKey('custom', asset.id)
    )
    const icon = this.createIconCanvas()
    this.drawCustomIcon(icon, asset.id)
    button.appendChild(icon)
    button.addEventListener('click', () => {
      this.select({
        envType: 'custom',
        assetId: asset.id,
        label: asset.name,
        cursor: this.createCursor('custom', asset.id),
      })
    })
    return button
  }

  private createCreateButton(): HTMLButtonElement {
    const label = localizer.t('editor_environment_asset_create')
    const button = this.createIconButton(label, 'create')
    button.classList.add('editor-environment-palette-create')
    const icon = this.createIconCanvas()
    this.drawCreateIcon(icon)
    button.appendChild(icon)
    button.addEventListener('click', () => {
      void this.handleCreateAsset()
    })
    return button
  }

  private createIconButton(label: string, key: string): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'editor-environment-palette-item'
    button.dataset.environmentPaletteKey = key
    button.dataset.tooltip = label
    button.setAttribute('aria-label', label)
    return button
  }

  private createIconCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = ICON_SIZE
    canvas.height = ICON_SIZE
    canvas.className = 'editor-environment-palette-icon'
    return canvas
  }

  private select(selection: EditorEnvironmentPaletteSelection): void {
    this.selectedKey = this.buildKey(selection.envType, selection.assetId)
    this.selection = selection
    this.updateSelectedState()
    this.ctx.onSelected(selection)
  }

  private updateSelectedState(): void {
    const items = this.ctx.container.querySelectorAll<HTMLButtonElement>(
      '.editor-environment-palette-item'
    )
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (
        this.selectedKey.length > 0 &&
        item.dataset.environmentPaletteKey === this.selectedKey
      ) {
        item.classList.add('is-selected')
      } else {
        item.classList.remove('is-selected')
      }
    }
  }

  private async handleCreateAsset(): Promise<void> {
    const asset = await this.ctx.onCreateCustomEnvironmentAsset()
    if (!asset) {
      return
    }
    this.render()
    this.select({
      envType: 'custom',
      assetId: asset.id,
      label: asset.name,
      cursor: this.createCursor('custom', asset.id),
    })
  }

  private createCursor(
    envType: MapEnvironmentObjectType,
    assetId: string
  ): string {
    const canvas = document.createElement('canvas')
    canvas.width = ICON_SIZE
    canvas.height = ICON_SIZE
    if (envType === 'custom') {
      this.drawCustomIcon(canvas, assetId)
    } else {
      this.drawBuiltinIcon(canvas, envType)
    }
    const url = canvas.toDataURL('image/png')
    return `url("${url}") ${CURSOR_HOTSPOT_X} ${CURSOR_HOTSPOT_Y}, crosshair`
  }

  private drawBuiltinIcon(
    canvas: HTMLCanvasElement,
    envType: MapEnvironmentObjectType
  ): void {
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }
    ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 2

    if (envType === 'tree') {
      ctx.fillStyle = '#8f6d43'
      ctx.fillRect(14, 18, 4, 8)
      ctx.fillStyle = '#6f8d58'
      ctx.beginPath()
      ctx.arc(16, 12, 8, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#5d7849'
      ctx.beginPath()
      ctx.arc(11, 15, 6, 0, Math.PI * 2)
      ctx.arc(21, 15, 6, 0, Math.PI * 2)
      ctx.fill()
      return
    }

    if (envType === 'hill') {
      ctx.fillStyle = '#6f7f57'
      ctx.beginPath()
      ctx.moveTo(4, 24)
      ctx.quadraticCurveTo(14, 8, 28, 24)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = '#b7aa7d'
      ctx.stroke()
      return
    }

    if (envType === 'house') {
      ctx.fillStyle = '#9b7b54'
      ctx.fillRect(9, 15, 14, 10)
      ctx.fillStyle = '#8f5f49'
      ctx.beginPath()
      ctx.moveTo(7, 16)
      ctx.lineTo(16, 7)
      ctx.lineTo(25, 16)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = '#c4b088'
      ctx.strokeRect(9, 15, 14, 10)
      return
    }

    if (envType === 'crate') {
      ctx.fillStyle = '#8d6a42'
      ctx.fillRect(8, 8, 16, 16)
      ctx.strokeStyle = '#d0b17a'
      ctx.strokeRect(8, 8, 16, 16)
      ctx.beginPath()
      ctx.moveTo(8, 8)
      ctx.lineTo(24, 24)
      ctx.moveTo(24, 8)
      ctx.lineTo(8, 24)
      ctx.stroke()
      return
    }

    if (envType === 'grass') {
      ctx.strokeStyle = '#7f9a61'
      ctx.beginPath()
      ctx.moveTo(9, 25)
      ctx.lineTo(13, 12)
      ctx.moveTo(16, 25)
      ctx.lineTo(16, 9)
      ctx.moveTo(23, 25)
      ctx.lineTo(19, 13)
      ctx.stroke()
      return
    }

    if (envType === 'flower') {
      ctx.strokeStyle = '#7f9a61'
      ctx.beginPath()
      ctx.moveTo(16, 25)
      ctx.lineTo(16, 15)
      ctx.stroke()
      ctx.fillStyle = '#c88473'
      ctx.beginPath()
      ctx.arc(16, 12, 3, 0, Math.PI * 2)
      ctx.arc(12, 15, 3, 0, Math.PI * 2)
      ctx.arc(20, 15, 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#d8c06f'
      ctx.beginPath()
      ctx.arc(16, 15, 2, 0, Math.PI * 2)
      ctx.fill()
      return
    }

    ctx.fillStyle = '#d8d3bf'
    ctx.beginPath()
    ctx.arc(12, 17, 5, 0, Math.PI * 2)
    ctx.arc(17, 14, 7, 0, Math.PI * 2)
    ctx.arc(23, 18, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillRect(10, 17, 15, 5)
  }

  private drawCustomIcon(canvas: HTMLCanvasElement, assetId: string): void {
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }
    ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE)
    const runtimeAsset = getRuntimeEnvironmentAsset(assetId)
    if (!runtimeAsset) {
      this.drawMissingCustomIcon(ctx)
      this.queueAssetLoad(assetId)
      return
    }

    const source = runtimeAsset.canvas
    const maxSize = ICON_SIZE - ICON_PAD * 2
    let drawWidth = maxSize
    let drawHeight = Math.max(
      1,
      Math.floor((source.height * maxSize) / source.width)
    )
    if (drawHeight > maxSize) {
      drawHeight = maxSize
      drawWidth = Math.max(
        1,
        Math.floor((source.width * maxSize) / source.height)
      )
    }
    const x = (ICON_SIZE - drawWidth) >> 1
    const y = (ICON_SIZE - drawHeight) >> 1
    ctx.drawImage(source, x, y, drawWidth, drawHeight)
    ctx.strokeStyle = 'rgba(255,255,255,0.42)'
    ctx.strokeRect(x, y, drawWidth, drawHeight)
  }

  private drawMissingCustomIcon(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.lineWidth = 2
    ctx.strokeRect(8, 8, 16, 16)
    ctx.beginPath()
    ctx.moveTo(11, 21)
    ctx.lineTo(15, 16)
    ctx.lineTo(18, 19)
    ctx.lineTo(21, 13)
    ctx.stroke()
  }

  private drawCreateIcon(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }
    ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE)
    ctx.strokeStyle = '#d6c9a3'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(16, 9)
    ctx.lineTo(16, 23)
    ctx.moveTo(9, 16)
    ctx.lineTo(23, 16)
    ctx.stroke()
  }

  private queueAssetLoad(assetId: string): void {
    if (!assetId || this.loadingAssetIds.has(assetId)) {
      return
    }
    this.loadingAssetIds.add(assetId)
    void ensureRuntimeEnvironmentAsset(assetId).then(() => {
      this.loadingAssetIds.delete(assetId)
      if (!this.isVisible()) {
        return
      }
      const selectedKey = this.selectedKey
      this.render()
      if (selectedKey === this.selectedKey && this.selection) {
        this.select({
          ...this.selection,
          cursor: this.createCursor(
            this.selection.envType,
            this.selection.assetId
          ),
        })
      }
    })
  }

  private buildKey(envType: MapEnvironmentObjectType, assetId: string): string {
    return envType === 'custom' ? `custom:${assetId}` : envType
  }
}
