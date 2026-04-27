import {
  isEditorMapArchiveData,
  packEditorMapData,
  unpackEditorMapArchive,
} from './MapArchive'
import type { EditorMapData, EditorMapMeta } from './editorMapTypes'
import { createEditorMap, listEditorMaps, loadEditorMapData } from './storage'

export class MapImportExportPanel {
  private listEl: HTMLElement
  private statusEl: HTMLElement
  private importBtn: HTMLButtonElement
  private exportButtons = new Map<string, HTMLButtonElement>()
  private importing = false
  private exportingMapId: string | null = null
  private statusTimeout: ReturnType<typeof setTimeout> | null = null

  constructor(container: HTMLElement) {
    const header = document.createElement('div')
    header.className = 'map-panel-header'

    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.accept = '.zip,application/zip'
    fileInput.style.display = 'none'
    fileInput.id = 'mapImportInput'
    fileInput.addEventListener('change', () => this.handleImport(fileInput))

    this.importBtn = document.createElement('button')
    this.importBtn.textContent = '导入'
    this.importBtn.className = 'map-panel-btn'
    this.importBtn.addEventListener('click', () => {
      if (this.importing || this.exportingMapId !== null) {
        return
      }
      fileInput.click()
    })

    this.statusEl = document.createElement('span')
    this.statusEl.className = 'map-panel-status'

    header.appendChild(fileInput)
    header.appendChild(this.importBtn)
    header.appendChild(this.statusEl)

    this.listEl = document.createElement('div')
    this.listEl.className = 'map-panel-list'

    container.appendChild(header)
    container.appendChild(this.listEl)

    void this.refresh()
  }

  async refresh(): Promise<void> {
    this.listEl.innerHTML = ''
    this.exportButtons.clear()
    const maps = await listEditorMaps()
    for (const meta of maps) {
      this.listEl.appendChild(this.buildItem(meta))
    }
    this.updateButtonStates()
  }

  private buildItem(meta: EditorMapMeta): HTMLElement {
    const row = document.createElement('div')
    row.className = 'map-panel-row'

    const name = document.createElement('span')
    name.className = 'map-panel-name'
    name.textContent = meta.isDefault ? `${meta.name} ★` : meta.name

    const btn = document.createElement('button')
    btn.className = 'map-panel-btn'
    btn.textContent = '导出'
    btn.addEventListener('click', () => void this.handleExport(meta))
    this.exportButtons.set(meta.id, btn)

    row.appendChild(name)
    row.appendChild(btn)
    return row
  }

  private async handleExport(meta: EditorMapMeta): Promise<void> {
    if (this.importing || this.exportingMapId !== null) {
      return
    }
    this.exportingMapId = meta.id
    this.updateButtonStates()
    try {
      const data = await loadEditorMapData(meta.id)
      if (!data) {
        this.showStatus('导出失败')
        return
      }
      const blob = await packEditorMapData(data, meta.name)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `fruman-${meta.name}.zip`
      a.click()
      URL.revokeObjectURL(url)
      this.showStatus('已导出')
    } catch {
      this.showStatus('导出失败')
    } finally {
      this.exportingMapId = null
      this.updateButtonStates()
    }
  }

  private async handleImport(input: HTMLInputElement): Promise<void> {
    if (this.importing || this.exportingMapId !== null) {
      input.value = ''
      return
    }
    const file = input.files?.[0]
    input.value = ''
    if (!file) return

    this.importing = true
    this.updateButtonStates()
    let data: EditorMapData | null = null
    let archiveName: string | null = null
    try {
      const archiveBytes = new Uint8Array(await file.arrayBuffer())
      const archive = await unpackEditorMapArchive(archiveBytes)
      data = archive?.data ?? null
      archiveName = archive?.name ?? null
    } catch {
      this.showStatus('文件格式错误')
      this.importing = false
      this.updateButtonStates()
      return
    }

    if (!data || !isEditorMapArchiveData(data)) {
      this.showStatus('无效的地图文件')
      this.importing = false
      this.updateButtonStates()
      return
    }

    let name = archiveName ?? file.name.replace(/\.zip$/i, '')
    if (!archiveName && name.startsWith('fruman-')) {
      name = name.slice('fruman-'.length)
    }

    try {
      const result = await createEditorMap(name, data)
      if (result) {
        this.showStatus('导入成功')
        await this.refresh()
      } else {
        this.showStatus('导入失败')
      }
    } catch {
      this.showStatus('导入失败')
    } finally {
      this.importing = false
      this.updateButtonStates()
    }
  }

  private updateButtonStates(): void {
    const busy = this.importing || this.exportingMapId !== null
    this.importBtn.disabled = busy
    this.importBtn.textContent = this.importing ? '导入中...' : '导入'
    this.exportButtons.forEach((button, mapId) => {
      const exporting = this.exportingMapId === mapId
      button.disabled = busy
      button.textContent = exporting ? '导出中...' : '导出'
    })
  }

  private showStatus(msg: string): void {
    this.statusEl.textContent = msg
    if (this.statusTimeout !== null) {
      clearTimeout(this.statusTimeout)
    }
    this.statusTimeout = setTimeout(() => {
      this.statusEl.textContent = ''
      this.statusTimeout = null
    }, 2000)
  }
}
