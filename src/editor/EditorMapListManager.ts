import type { DialogManager } from '../DialogManager'
import { localizer } from '../Localizer'
import type { EditorMapData, EditorMapMeta } from '../editorMapTypes'
import {
  createEditorMap,
  listEditorMaps,
  loadEditorMapData,
  saveEditorMapMeta,
} from '../storage'
import type { EditorMapSerializer } from './EditorMapSerializer'
import { EditorUIHelper } from './EditorUIHelper'
import type { EditorMap } from './types'

export interface EditorMapListManagerContext {
  editorMapListView: HTMLDivElement
  editorMapList: HTMLDivElement
  editorMapListMenu: HTMLDivElement
  editorBackBtn: HTMLButtonElement
  editorMapCreateBtn: HTMLButtonElement
  editorMapRenameBtn: HTMLButtonElement
  editorMapDefaultBtn: HTMLButtonElement
  dialogManager: DialogManager
  mapSerializer: EditorMapSerializer
  onMapLoaded: (meta: EditorMapMeta, data: EditorMapData) => void
  onShowEditorView: () => void
  onBackToMenu: () => void
  onDefaultMapChanged: (meta: EditorMapMeta) => void
  onPreview: (meta: EditorMapMeta, data: EditorMapData) => void
}

export class EditorMapListManager {
  private context: EditorMapListManagerContext
  private editorMapListItems: HTMLButtonElement[] = []
  private editorMapListSelectedIndex = 0
  private lastSelectedMapIndex = -1
  private mapListBackIndex = 0
  private mapListCreateMapIndex = -1
  private mapListRenameMapIndex = -1
  private mapListDefaultMapIndex = -1
  private mapListFocusId: string | null = null
  private maps: EditorMap[] = []
  private currentMapMeta: EditorMapMeta | null = null
  private boundHandleMapListMouseEnter: (event: Event) => void

  constructor(context: EditorMapListManagerContext) {
    this.context = context
    this.boundHandleMapListMouseEnter =
      this.handleMapListItemMouseEnter.bind(this)
    this.setupEventListeners()
  }

  private setupEventListeners() {
    this.context.editorBackBtn.addEventListener('mouseenter', () => {
      if (this.isVisible()) {
        this.setMapListSelectedIndex(this.mapListBackIndex, false)
      }
    })

    this.context.editorMapCreateBtn.addEventListener('click', () => {
      void this.handleCreateMap()
    })

    this.context.editorMapRenameBtn.addEventListener('click', () => {
      void this.handleRenameSelectedMap()
    })

    this.context.editorMapDefaultBtn.addEventListener('click', () => {
      void this.handleSetDefaultSelectedMap()
    })
  }

  public isVisible(): boolean {
    return this.context.editorMapListView.style.display !== 'none'
  }

  public show() {
    this.context.editorMapListView.style.display = 'flex'
    this.context.editorMapListMenu.style.display = 'flex'
    this.renderMapList()
    this.setMapListSelectedIndex(0, true)
  }

  public hide() {
    this.context.editorMapListView.style.display = 'none'
    this.context.editorMapListMenu.style.display = 'none'
    this.clearMapListSelection()
  }

  public refreshMapMetas() {
    listEditorMaps()
      .then((maps) => {
        this.maps = maps
        if (this.isVisible()) {
          this.renderMapList()
          if (this.mapListFocusId) {
            const focusIndex = this.findMapListIndexById(this.mapListFocusId)
            this.mapListFocusId = null
            if (focusIndex >= 0) {
              this.setMapListSelectedIndex(focusIndex, false)
              return
            }
          }
          this.setMapListSelectedIndex(0, true)
        }
      })
      .catch(() => {})
  }

  public getCurrentMapMeta(): EditorMapMeta | null {
    return this.currentMapMeta
  }

  public setCurrentMapMeta(meta: EditorMapMeta | null) {
    this.currentMapMeta = meta
  }

  public async handleCreateMap() {
    const nameInput = await this.context.dialogManager.prompt(
      localizer.t('editor_create_map_prompt')
    )
    if (nameInput === null) {
      return
    }
    const name = nameInput.trim()
    if (name.length === 0) {
      return
    }

    const initialData = this.context.mapSerializer.buildDefaultMapData()
    const meta = await createEditorMap(name, initialData)
    if (!meta) {
      await this.context.dialogManager.alert(localizer.t('editor_save_failed'))
      return
    }

    this.currentMapMeta = meta
    this.refreshMapMetas()
    this.context.onMapLoaded(meta, initialData)
    this.context.onShowEditorView()
  }

  public async handleRenameSelectedMap() {
    const mapId = this.getSelectedMapId()
    if (!mapId) {
      return
    }
    const meta = this.findMapMeta(mapId)
    if (!meta) {
      return
    }
    const nextName = await this.context.dialogManager.prompt(
      localizer.t('editor_map_rename_prompt'),
      meta.name
    )
    if (nextName === null) {
      return
    }
    const trimmed = nextName.trim()
    if (trimmed.length === 0 || trimmed === meta.name) {
      return
    }
    meta.name = trimmed
    const saved = await saveEditorMapMeta(meta)
    if (!saved) {
      await this.context.dialogManager.alert(localizer.t('editor_save_failed'))
      return
    }
    this.mapListFocusId = meta.id
    this.refreshMapMetas()
  }

  public async handleSetDefaultSelectedMap() {
    const mapId = this.getSelectedMapId()
    if (!mapId) {
      return
    }
    let changed = false
    for (let i = 0; i < this.maps.length; i++) {
      const meta = this.maps[i]
      const shouldDefault = meta.id === mapId
      if (meta.isDefault !== shouldDefault) {
        meta.isDefault = shouldDefault
        const saved = await saveEditorMapMeta(meta)
        if (!saved) {
          await this.context.dialogManager.alert(
            localizer.t('editor_save_failed')
          )
          return
        }
        changed = true
      }
    }
    if (!changed) {
      return
    }
    this.mapListFocusId = mapId
    this.refreshMapMetas()
    const nextDefault = this.findMapMeta(mapId)
    if (nextDefault) {
      this.context.onDefaultMapChanged(nextDefault)
    }
  }

  public async handlePreview() {
    const data = this.context.mapSerializer.serializeCurrentMapData()
    const meta = this.currentMapMeta ?? {
      id: 'preview',
      name: 'preview',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.context.onPreview(meta, data)
  }

  public async ensureMapMeta(
    data: EditorMapData
  ): Promise<EditorMapMeta | null> {
    if (this.currentMapMeta) {
      return this.currentMapMeta
    }
    const nameInput = await this.context.dialogManager.prompt(
      localizer.t('editor_create_map_prompt')
    )
    if (nameInput === null) {
      return null
    }
    const name = nameInput.trim()
    if (name.length === 0) {
      return null
    }
    const created = await createEditorMap(name, data)
    if (!created) {
      await this.context.dialogManager.alert(localizer.t('editor_save_failed'))
      return null
    }
    this.currentMapMeta = created
    this.refreshMapMetas()
    return created
  }

  public handleMapListKeyDown(event: KeyboardEvent) {
    if (this.editorMapListItems.length === 0) {
      return
    }
    const key = event.key
    if (key === 'ArrowUp' || key === 'w') {
      event.preventDefault()
      const nextIndex = this.findMapListDirectionalIndex(0, -1)
      this.setMapListSelectedIndex(nextIndex, false)
      return
    }
    if (key === 'ArrowDown' || key === 's') {
      event.preventDefault()
      const nextIndex = this.findMapListDirectionalIndex(0, 1)
      this.setMapListSelectedIndex(nextIndex, false)
      return
    }
    if (key === 'ArrowLeft' || key === 'a') {
      event.preventDefault()
      const nextIndex = this.findMapListDirectionalIndex(-1, 0)
      this.setMapListSelectedIndex(nextIndex, false)
      return
    }
    if (key === 'ArrowRight' || key === 'd') {
      event.preventDefault()
      const nextIndex = this.findMapListDirectionalIndex(1, 0)
      this.setMapListSelectedIndex(nextIndex, false)
      return
    }
    if (key === 'Enter' || key === ' ') {
      event.preventDefault()
      const element = this.getMapListNavElement(this.editorMapListSelectedIndex)
      if (element) {
        element.click()
      }
      return
    }
    if (key === 'Escape') {
      event.preventDefault()
      this.context.onBackToMenu()
    }
  }

  public setMapListSelectedIndex(index: number, forceFirst: boolean) {
    if (this.editorMapListItems.length === 0) {
      return
    }
    const maxIndex = this.mapListDefaultMapIndex
    const nextIndex = forceFirst ? 0 : Math.max(0, Math.min(index, maxIndex))

    if (nextIndex < this.editorMapListItems.length) {
      this.lastSelectedMapIndex = nextIndex
    }

    if (nextIndex === this.editorMapListSelectedIndex) {
      this.applyMapListSelection()
      return
    }
    this.editorMapListSelectedIndex = nextIndex
    this.applyMapListSelection()
  }

  private renderMapList() {
    this.context.editorMapList.innerHTML = ''
    this.editorMapListItems.length = 0

    let index = 0
    for (let i = 0; i < this.maps.length; i++) {
      const map = this.maps[i]
      const item = EditorUIHelper.createMapListItem()

      if (map.thumbnail) {
        item.appendChild(EditorUIHelper.createMapThumbnailImage(map.thumbnail))
      } else {
        item.appendChild(EditorUIHelper.createMapThumbnailPlaceholder())
      }

      const textContainer = EditorUIHelper.createMapListTextContainer()
      textContainer.appendChild(EditorUIHelper.createMapListTitle(map.name))

      if (map.isDefault) {
        textContainer.appendChild(
          EditorUIHelper.createMapListDefaultTag(
            localizer.t('editor_map_default_tag')
          )
        )
      }

      item.appendChild(textContainer)

      item.dataset.mapId = map.id
      item.addEventListener('click', () => {
        this.loadMap(map.id)
      })
      item.dataset.index = String(index)
      item.addEventListener('mouseenter', this.boundHandleMapListMouseEnter)
      this.context.editorMapList.appendChild(item)
      this.editorMapListItems.push(item)
      index += 1
    }

    this.mapListBackIndex = this.editorMapListItems.length
    this.mapListCreateMapIndex = this.editorMapListItems.length + 1
    this.mapListRenameMapIndex = this.editorMapListItems.length + 2
    this.mapListDefaultMapIndex = this.editorMapListItems.length + 3
  }

  private handleMapListItemMouseEnter(event: Event) {
    if (!this.isVisible()) {
      return
    }
    const target = event.currentTarget
    if (!(target instanceof HTMLButtonElement)) {
      return
    }
    const index = Number.parseInt(target.dataset.index ?? '', 10)
    if (!Number.isFinite(index)) {
      return
    }
    this.setMapListSelectedIndex(index, false)
  }

  private applyMapListSelection() {
    for (let i = 0; i < this.editorMapListItems.length; i++) {
      this.editorMapListItems[i].classList.toggle(
        'is-selected',
        i === this.lastSelectedMapIndex
      )
    }
    this.context.editorBackBtn.classList.toggle(
      'is-selected',
      this.editorMapListSelectedIndex === this.mapListBackIndex
    )
    this.context.editorMapCreateBtn.classList.toggle(
      'is-selected',
      this.editorMapListSelectedIndex === this.mapListCreateMapIndex
    )
    this.context.editorMapRenameBtn.classList.toggle(
      'is-selected',
      this.editorMapListSelectedIndex === this.mapListRenameMapIndex
    )
    this.context.editorMapDefaultBtn.classList.toggle(
      'is-selected',
      this.editorMapListSelectedIndex === this.mapListDefaultMapIndex
    )
    this.updateMapListMenuVisibility()

    if (
      this.editorMapListSelectedIndex >= 0 &&
      this.editorMapListSelectedIndex < this.editorMapListItems.length
    ) {
      const selectedItem =
        this.editorMapListItems[this.editorMapListSelectedIndex]
      selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }

  private clearMapListSelection() {
    for (let i = 0; i < this.editorMapListItems.length; i++) {
      this.editorMapListItems[i].classList.remove('is-selected')
    }
    this.context.editorBackBtn.classList.remove('is-selected')
    this.context.editorMapCreateBtn.classList.remove('is-selected')
    this.context.editorMapRenameBtn.classList.remove('is-selected')
    this.context.editorMapDefaultBtn.classList.remove('is-selected')
    this.context.editorMapListMenu.classList.remove('is-visible')
  }

  private getSelectedMapId(): string | null {
    if (
      this.lastSelectedMapIndex < 0 ||
      this.lastSelectedMapIndex >= this.editorMapListItems.length
    ) {
      return null
    }
    const button = this.editorMapListItems[this.lastSelectedMapIndex]
    return button?.dataset.mapId ?? null
  }

  private updateMapListMenuVisibility() {
    if (!this.isVisible()) {
      this.context.editorMapListMenu.classList.remove('is-visible')
      return
    }
    const mapId = this.getSelectedMapId()
    if (!mapId) {
      this.context.editorMapListMenu.classList.remove('is-visible')
      return
    }
    this.context.editorMapListMenu.classList.add('is-visible')
  }

  private getMapListNavCount(): number {
    return this.editorMapListItems.length + 4
  }

  private getMapListNavElement(index: number): HTMLButtonElement | null {
    if (index === this.mapListBackIndex) {
      return this.context.editorBackBtn
    }
    if (index === this.mapListCreateMapIndex) {
      return this.context.editorMapCreateBtn
    }
    if (index === this.mapListRenameMapIndex) {
      return this.context.editorMapRenameBtn
    }
    if (index === this.mapListDefaultMapIndex) {
      return this.context.editorMapDefaultBtn
    }
    if (index < 0 || index >= this.editorMapListItems.length) {
      return null
    }
    return this.editorMapListItems[index]
  }

  private findMapListDirectionalIndex(dirX: number, dirY: number): number {
    const count = this.getMapListNavCount()
    const currentIndex = this.editorMapListSelectedIndex
    const currentElement = this.getMapListNavElement(currentIndex)
    if (!currentElement) {
      return currentIndex
    }
    const currentRect = currentElement.getBoundingClientRect()
    const currentLeft = Math.round(currentRect.left)
    const currentTop = Math.round(currentRect.top)
    const currentWidth = Math.round(currentRect.width)
    const currentHeight = Math.round(currentRect.height)
    const currentX = currentLeft + (currentWidth >> 1)
    const currentY = currentTop + (currentHeight >> 1)

    let bestIndex = currentIndex
    let bestScore = Number.MAX_SAFE_INTEGER

    for (let i = 0; i < count; i++) {
      if (i === currentIndex) {
        continue
      }
      const element = this.getMapListNavElement(i)
      if (!element) {
        continue
      }
      const rect = element.getBoundingClientRect()
      const left = Math.round(rect.left)
      const top = Math.round(rect.top)
      const width = Math.round(rect.width)
      const height = Math.round(rect.height)
      const centerX = left + (width >> 1)
      const centerY = top + (height >> 1)
      const dx = centerX - currentX
      const dy = centerY - currentY
      const dot = dx * dirX + dy * dirY
      if (dot <= 0) {
        continue
      }
      const absDx = Math.abs(dx)
      const absDy = Math.abs(dy)
      const dist2 = dx * dx + dy * dy
      const offAxis = dirY !== 0 ? absDx : absDy
      const score = dist2 * 4 + offAxis * offAxis * 9
      if (score < bestScore) {
        bestScore = score
        bestIndex = i
      }
    }
    return bestIndex
  }

  private findMapListIndexById(mapId: string): number {
    for (let i = 0; i < this.editorMapListItems.length; i++) {
      const button = this.editorMapListItems[i]
      if (button.dataset.mapId === mapId) {
        return i
      }
    }
    return -1
  }

  private findMapMeta(mapId: string): EditorMapMeta | null {
    for (let i = 0; i < this.maps.length; i++) {
      const meta = this.maps[i]
      if (meta.id === mapId) {
        return meta
      }
    }
    return null
  }

  private async loadMap(mapId: string) {
    this.context.onShowEditorView()
    const stored = await loadEditorMapData(mapId)
    const meta = this.findMapMeta(mapId)
    if (meta) {
      this.currentMapMeta = meta
    } else if (this.currentMapMeta?.id !== mapId) {
      const now = Date.now()
      this.currentMapMeta = {
        id: mapId,
        name: mapId,
        createdAt: now,
        updatedAt: now,
      }
    }
    const data = stored ?? this.context.mapSerializer.buildDefaultMapData()
    this.context.mapSerializer.applyMapData(data)
    this.context.onMapLoaded(this.currentMapMeta, data)
  }
}
