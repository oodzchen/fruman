import {
  isEditorMapArchiveData,
  packEditorMapData,
  unpackEditorMapArchive,
} from './MapArchive'
import type { PageTranslationKey } from './development/pageTranslations/zh-Hans'
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
  private translate: (key: PageTranslationKey) => string

  constructor(
    container: HTMLElement,
    translate: (key: PageTranslationKey) => string
  ) {
    this.translate = translate
    const header = document.createElement('div')
    header.className = 'map-panel-header'

    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.accept = '.zip,application/zip'
    fileInput.style.display = 'none'
    fileInput.id = 'mapImportInput'
    fileInput.addEventListener('change', () => this.handleImport(fileInput))

    this.importBtn = document.createElement('button')
    this.importBtn.className = 'map-panel-btn'
    this.setTranslatedText(this.importBtn, 'map_import')
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
    this.setTranslatedText(btn, 'map_export')
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
        this.showStatus('map_export_failed')
        return
      }
      const blob = await packEditorMapData(data, meta.name)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `fruman-${meta.name}.zip`
      a.click()
      URL.revokeObjectURL(url)
      this.showStatus('map_exported')
    } catch {
      this.showStatus('map_export_failed')
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
      this.showStatus('map_invalid_archive')
      this.importing = false
      this.updateButtonStates()
      return
    }

    if (!data || !isEditorMapArchiveData(data)) {
      this.showStatus('map_invalid_data')
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
        this.showStatus('map_import_succeeded')
        await this.refresh()
      } else {
        this.showStatus('map_import_failed')
      }
    } catch {
      this.showStatus('map_import_failed')
    } finally {
      this.importing = false
      this.updateButtonStates()
    }
  }

  private updateButtonStates(): void {
    const busy = this.importing || this.exportingMapId !== null
    this.importBtn.disabled = busy
    this.setTranslatedText(
      this.importBtn,
      this.importing ? 'map_importing' : 'map_import'
    )
    this.exportButtons.forEach((button, mapId) => {
      const exporting = this.exportingMapId === mapId
      button.disabled = busy
      this.setTranslatedText(button, exporting ? 'map_exporting' : 'map_export')
    })
  }

  private showStatus(key: PageTranslationKey): void {
    this.setTranslatedText(this.statusEl, key)
    if (this.statusTimeout !== null) {
      clearTimeout(this.statusTimeout)
    }
    this.statusTimeout = setTimeout(() => {
      this.statusEl.textContent = ''
      delete this.statusEl.dataset.pageI18n
      this.statusTimeout = null
    }, 2000)
  }

  private setTranslatedText(
    element: HTMLElement,
    key: PageTranslationKey
  ): void {
    element.dataset.pageI18n = key
    element.textContent = this.translate(key)
  }
}
