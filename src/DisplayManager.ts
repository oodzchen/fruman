const STORAGE_KEY_RESOLUTION = 'sl2d_resolution'

export interface ResolutionPreset {
  label: string
  width: number
  height: number
}

export const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { label: '568×320', width: 568, height: 320 },
  { label: '667×375', width: 667, height: 375 },
  { label: '800×600', width: 800, height: 600 },
  { label: '812×375', width: 812, height: 375 },
  { label: '844×390', width: 844, height: 390 },
  { label: '926×428', width: 926, height: 428 },
  { label: '1024×768', width: 1024, height: 768 },
  { label: '1180×820', width: 1180, height: 820 },
  { label: '1194×834', width: 1194, height: 834 },
  { label: '1280×720', width: 1280, height: 720 },
  { label: '1366×768', width: 1366, height: 768 },
  { label: '1366×1024', width: 1366, height: 1024 },
  { label: '1600×900', width: 1600, height: 900 },
  { label: '1920×1080', width: 1920, height: 1080 },
  { label: '2560×1440', width: 2560, height: 1440 },
]

const DEFAULT_RESOLUTION_INDEX = 2 // 800×600

export class DisplayManager {
  private viewport: HTMLElement
  private canvasBottom: HTMLElement | null
  private resolutionIndex: number
  private fullscreenActive = false
  private onFullscreenChangeCallback?: (isFullscreen: boolean) => void
  private onResolutionChangeCallback?: (preset: ResolutionPreset) => void

  constructor(viewport: HTMLElement) {
    this.viewport = viewport
    this.canvasBottom = document.getElementById('canvasBottom')

    const saved = localStorage.getItem(STORAGE_KEY_RESOLUTION)
    const savedIndex =
      saved !== null ? parseInt(saved, 10) : DEFAULT_RESOLUTION_INDEX
    this.resolutionIndex =
      savedIndex >= 0 && savedIndex < RESOLUTION_PRESETS.length
        ? savedIndex
        : DEFAULT_RESOLUTION_INDEX

    this.applyResolution()

    document.addEventListener('fullscreenchange', () => {
      const isFs = !!document.fullscreenElement
      if (this.fullscreenActive !== isFs) {
        this.fullscreenActive = isFs
        this.onFullscreenChangeCallback?.(isFs)
      }
    })
  }

  isFullscreen(): boolean {
    return this.fullscreenActive
  }

  getResolutionIndex(): number {
    return this.resolutionIndex
  }

  getCurrentPreset(): ResolutionPreset {
    return RESOLUTION_PRESETS[this.resolutionIndex]
  }

  setOnFullscreenChange(cb: (isFullscreen: boolean) => void): void {
    this.onFullscreenChangeCallback = cb
  }

  setOnResolutionChange(cb: (preset: ResolutionPreset) => void): void {
    this.onResolutionChangeCallback = cb
  }

  cycleResolution(direction: number): void {
    if (this.fullscreenActive) return
    const len = RESOLUTION_PRESETS.length
    this.resolutionIndex = (this.resolutionIndex + direction + len) % len
    localStorage.setItem(STORAGE_KEY_RESOLUTION, String(this.resolutionIndex))
    this.applyResolution()
    this.onResolutionChangeCallback?.(RESOLUTION_PRESETS[this.resolutionIndex])
  }

  async toggleFullscreen(): Promise<void> {
    try {
      if (!document.fullscreenElement) {
        await this.viewport.requestFullscreen()
      } else {
        await document.exitFullscreen()
      }
    } catch {
      // 浏览器不支持或未在用户手势中触发
    }
  }

  private applyResolution(): void {
    const preset = RESOLUTION_PRESETS[this.resolutionIndex]
    this.viewport.style.width = `${preset.width}px`
    this.viewport.style.height = `${preset.height}px`
    if (this.canvasBottom) {
      this.canvasBottom.style.width = `${preset.width}px`
    }
  }
}
