const STORAGE_KEY_RESOLUTION = 'fruman_resolution'
const STORAGE_KEY_ORIENTATION = 'fruman_orientation'
const DEFAULT_RESOLUTION_VALUE = '800x600'
const DEFAULT_RESOLUTION_INDEX_FALLBACK = 5 // 800×600
let displayStorageWarningLogged = false
const LEGACY_RESOLUTION_VALUES: string[] = [
  '568x320',
  '667x375',
  '800x600',
  '812x375',
  '844x390',
  '926x428',
  '1024x768',
  '1180x820',
  '1194x834',
  '1280x720',
  '1366x768',
  '1366x1024',
  '1600x900',
  '1920x1080',
  '2560x1440',
]

export interface ResolutionPreset {
  label: string
  width: number
  height: number
}

export enum DisplayOrientation {
  Portrait = 'portrait',
  Landscape = 'landscape',
}

interface LockableScreenOrientation extends ScreenOrientation {
  lock(orientation: DisplayOrientation): Promise<void>
}

export const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { label: '568×320', width: 568, height: 320 },
  { label: '667×375', width: 667, height: 375 },
  // 按总像素数递增排列，保证左右切换的方向稳定。
  { label: '812×375', width: 812, height: 375 },
  { label: '844×390', width: 844, height: 390 },
  { label: '926×428', width: 926, height: 428 },
  { label: '800×600', width: 800, height: 600 },
  { label: '1024×768', width: 1024, height: 768 },
  { label: '1280×720', width: 1280, height: 720 },
  { label: '1180×820', width: 1180, height: 820 },
  { label: '1194×834', width: 1194, height: 834 },
  { label: '1366×768', width: 1366, height: 768 },
  { label: '1366×1024', width: 1366, height: 1024 },
  { label: '1600×900', width: 1600, height: 900 },
  { label: '1920×1080', width: 1920, height: 1080 },
  { label: '2560×1440', width: 2560, height: 1440 },
]

const DEFAULT_RESOLUTION_INDEX = findResolutionIndex(DEFAULT_RESOLUTION_VALUE)

function getResolutionStorageValue(preset: ResolutionPreset): string {
  return `${preset.width}x${preset.height}`
}

function findResolutionIndex(value: string): number {
  const normalized = value.replace('×', 'x')
  const index = RESOLUTION_PRESETS.findIndex(
    (preset) => getResolutionStorageValue(preset) === normalized
  )
  return index >= 0 ? index : DEFAULT_RESOLUTION_INDEX_FALLBACK
}

function resolveStoredResolutionIndex(savedValue: string | null): number {
  if (savedValue === null) {
    return DEFAULT_RESOLUTION_INDEX
  }
  if (/^\d+$/.test(savedValue)) {
    const legacyIndex = Number.parseInt(savedValue, 10)
    if (legacyIndex >= 0 && legacyIndex < LEGACY_RESOLUTION_VALUES.length) {
      return findResolutionIndex(LEGACY_RESOLUTION_VALUES[legacyIndex])
    }
    return DEFAULT_RESOLUTION_INDEX
  }
  return findResolutionIndex(savedValue)
}

function readStoredDisplayValue(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch (error) {
    logDisplayStorageWarning(error instanceof Error ? error.message : '')
    return null
  }
}

function writeStoredDisplayValue(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch (error) {
    logDisplayStorageWarning(error instanceof Error ? error.message : '')
  }
}

function logDisplayStorageWarning(message: string): void {
  if (displayStorageWarningLogged) {
    return
  }
  displayStorageWarningLogged = true
  console.warn('[Display] storage unavailable:', message)
}

function resolveStoredOrientation(value: string | null): DisplayOrientation {
  return value === DisplayOrientation.Landscape
    ? DisplayOrientation.Landscape
    : DisplayOrientation.Portrait
}

export class DisplayManager {
  private viewport: HTMLElement
  private canvasBottom: HTMLElement | null
  private resolutionIndex: number
  private orientation: DisplayOrientation
  private fullscreenActive = false
  private onFullscreenChangeCallback?: (isFullscreen: boolean) => void
  private onResolutionChangeCallback?: (preset: ResolutionPreset) => void

  constructor(viewport: HTMLElement) {
    this.viewport = viewport
    this.canvasBottom = document.getElementById('canvasBottom')

    this.resolutionIndex = resolveStoredResolutionIndex(
      readStoredDisplayValue(STORAGE_KEY_RESOLUTION)
    )
    this.orientation = resolveStoredOrientation(
      readStoredDisplayValue(STORAGE_KEY_ORIENTATION)
    )
    this.persistResolution()
    this.persistOrientation()

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

  getOrientation(): DisplayOrientation {
    return this.orientation
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
    this.persistResolution()
    this.applyResolution()
    this.onResolutionChangeCallback?.(RESOLUTION_PRESETS[this.resolutionIndex])
  }

  async toggleFullscreen(): Promise<void> {
    try {
      if (!document.fullscreenElement) {
        await this.viewport.requestFullscreen()
        await this.lockOrientation(this.orientation)
      } else {
        await document.exitFullscreen()
      }
    } catch {
      // 浏览器不支持或未在用户手势中触发
    }
  }

  async toggleOrientation(): Promise<boolean> {
    if (!this.getLockableScreenOrientation()) {
      return false
    }
    const next =
      this.orientation === DisplayOrientation.Portrait
        ? DisplayOrientation.Landscape
        : DisplayOrientation.Portrait
    const enteredFullscreen = !document.fullscreenElement
    if (enteredFullscreen) {
      try {
        await this.viewport.requestFullscreen()
      } catch {
        return false
      }
    }
    if (await this.lockOrientation(next)) {
      this.orientation = next
      this.persistOrientation()
      return true
    }
    if (enteredFullscreen && document.fullscreenElement === this.viewport) {
      try {
        await document.exitFullscreen()
      } catch {
        // 浏览器拒绝退出时保留当前全屏状态
      }
    }
    return false
  }

  private applyResolution(): void {
    const preset = RESOLUTION_PRESETS[this.resolutionIndex]
    this.viewport.style.width = `${preset.width}px`
    this.viewport.style.height = `${preset.height}px`
    if (this.canvasBottom) {
      this.canvasBottom.style.width = `${preset.width}px`
    }
  }

  private persistResolution(): void {
    writeStoredDisplayValue(
      STORAGE_KEY_RESOLUTION,
      getResolutionStorageValue(RESOLUTION_PRESETS[this.resolutionIndex])
    )
  }

  private persistOrientation(): void {
    writeStoredDisplayValue(STORAGE_KEY_ORIENTATION, this.orientation)
  }

  private getLockableScreenOrientation(): LockableScreenOrientation | null {
    const orientation = screen.orientation as ScreenOrientation | undefined
    if (!orientation) {
      return null
    }
    const lockableOrientation = orientation as LockableScreenOrientation
    return typeof lockableOrientation.lock === 'function'
      ? lockableOrientation
      : null
  }

  private async lockOrientation(
    orientation: DisplayOrientation
  ): Promise<boolean> {
    const screenOrientation = this.getLockableScreenOrientation()
    if (!screenOrientation) {
      return false
    }
    try {
      await screenOrientation.lock(orientation)
      return true
    } catch {
      return false
    }
  }
}
