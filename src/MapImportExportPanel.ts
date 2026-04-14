import type { EditorMapData, EditorMapMeta } from './editorMapTypes'
import { createEditorMap, listEditorMaps, loadEditorMapData } from './storage'

export class MapImportExportPanel {
  private listEl: HTMLElement
  private statusEl: HTMLElement
  private statusTimeout: ReturnType<typeof setTimeout> | null = null

  constructor(container: HTMLElement) {
    const header = document.createElement('div')
    header.className = 'map-panel-header'

    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.accept = '.json'
    fileInput.style.display = 'none'
    fileInput.id = 'mapImportInput'
    fileInput.addEventListener('change', () => this.handleImport(fileInput))

    const importLabel = document.createElement('label')
    importLabel.textContent = '导入'
    importLabel.className = 'map-panel-btn'
    importLabel.htmlFor = 'mapImportInput'

    this.statusEl = document.createElement('span')
    this.statusEl.className = 'map-panel-status'

    header.appendChild(fileInput)
    header.appendChild(importLabel)
    header.appendChild(this.statusEl)

    this.listEl = document.createElement('div')
    this.listEl.className = 'map-panel-list'

    container.appendChild(header)
    container.appendChild(this.listEl)

    void this.refresh()
  }

  async refresh(): Promise<void> {
    this.listEl.innerHTML = ''
    const maps = await listEditorMaps()
    for (const meta of maps) {
      this.listEl.appendChild(this.buildItem(meta))
    }
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

    row.appendChild(name)
    row.appendChild(btn)
    return row
  }

  private async handleExport(meta: EditorMapMeta): Promise<void> {
    const data = await loadEditorMapData(meta.id)
    if (!data) {
      this.showStatus('导出失败')
      return
    }
    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fruman-${meta.name}.json`
    a.click()
    URL.revokeObjectURL(url)
    this.showStatus('已导出')
  }

  private async handleImport(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0]
    input.value = ''
    if (!file) return

    let parsed: unknown
    try {
      parsed = JSON.parse(await file.text())
    } catch {
      this.showStatus('文件格式错误')
      return
    }

    const data = parsed as EditorMapData
    if (
      !data ||
      typeof data !== 'object' ||
      (data.version !== 1 && data.version !== 2 && data.version !== 3) ||
      (!Array.isArray(data.shapes) && data.shapes !== undefined)
    ) {
      this.showStatus('无效的地图文件')
      return
    }

    let name = file.name.replace(/\.json$/, '')
    if (name.startsWith('fruman-')) {
      name = name.slice('fruman-'.length)
    }

    const result = await createEditorMap(name, data)
    if (result) {
      this.showStatus('导入成功')
      await this.refresh()
    } else {
      this.showStatus('导入失败')
    }
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
