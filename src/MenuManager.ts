import { Language, localizer } from './Localizer'
import { saveManager } from './SaveManager'
import type { SaveMeta } from './saveTypes'

export enum MenuAction {
  NewGame,
  Continue,
  Editor,
  Settings,
  Exit,
  Resume,
  MainMenu,
  Language,
  Back,
  LoadGame,
  SaveListSelect,
  SaveListNew,
  SaveListDelete,
  SaveGame,
}

export enum MenuMode {
  Start,
  Pause,
  Settings,
  SaveList,
}

interface MenuItem {
  label: string
  action: MenuAction
  y: number
  value?: string
  saveId?: string
  saveMeta?: SaveMeta
}

export class MenuManager {
  private canvas: HTMLCanvasElement
  private menuOverlay: HTMLDivElement
  private uiLayer: HTMLDivElement
  private menuTitle: HTMLDivElement
  private menuItemsContainer: HTMLDivElement
  private saveListContainer: HTMLDivElement
  private saveListTitle: HTMLDivElement
  private saveListList: HTMLDivElement
  private inputTarget: HTMLElement
  private focusOptions: FocusOptions = { preventScroll: true }
  private menuItemElements: HTMLButtonElement[] = []
  private activeItemCount = 0
  private visible = false
  private mode: MenuMode = MenuMode.Start
  private previousMode: MenuMode = MenuMode.Start
  private menuItems: MenuItem[] = []
  private selectedIndex = 0
  private onActionCallback?: (action: MenuAction, saveId?: string) => void
  private animTime = 0

  private boundHandleItemMouseEnter: (event: Event) => void
  private boundHandleItemClick: (event: Event) => void

  private hasSavesCache = false
  private saveListCache: SaveMeta[] = []

  constructor(
    canvas: HTMLCanvasElement,
    menuOverlay: HTMLDivElement,
    inputTarget: HTMLElement
  ) {
    this.canvas = canvas
    this.menuOverlay = menuOverlay
    const uiLayer = menuOverlay.parentElement
    const title = menuOverlay.querySelector<HTMLDivElement>('#menuTitle')
    const items = menuOverlay.querySelector<HTMLDivElement>('#menuItems')
    if (!(uiLayer instanceof HTMLDivElement) || !title || !items) {
      throw new Error('Menu overlay elements are missing.')
    }
    this.uiLayer = uiLayer
    this.menuTitle = title
    this.menuItemsContainer = items
    this.saveListContainer = document.createElement('div')
    this.saveListContainer.className = 'menu-save-list-container'
    this.saveListTitle = document.createElement('div')
    this.saveListTitle.className = 'menu-save-list-title'
    this.saveListList = document.createElement('div')
    this.saveListList.className = 'menu-save-list'
    this.saveListContainer.appendChild(this.saveListTitle)
    this.saveListContainer.appendChild(this.saveListList)
    this.menuItemsContainer.appendChild(this.saveListContainer)
    this.boundHandleItemMouseEnter = this.handleItemMouseEnter.bind(this)
    this.boundHandleItemClick = this.handleItemClick.bind(this)
    this.inputTarget = inputTarget
    if (this.inputTarget.tabIndex < 0) {
      this.inputTarget.tabIndex = 0
    }
    this.menuOverlay.classList.remove('is-visible')
    this.menuOverlay.setAttribute('aria-hidden', 'true')
    this.initMenuItems()
    this.setupInput()
  }

  async initSaveState(): Promise<void> {
    this.hasSavesCache = await saveManager.hasSaves()
    if (this.hasSavesCache) {
      this.saveListCache = await saveManager.listSaves()
    }
  }

  async refreshSaveList(): Promise<void> {
    this.saveListCache = await saveManager.listSaves()
    this.hasSavesCache = this.saveListCache.length > 0
  }

  private initMenuItems() {
    const startY = this.canvas.height / 2 + 40
    const spacing = 35
    this.menuItems = []

    if (this.mode === MenuMode.Start) {
      if (this.hasSavesCache) {
        this.menuItems = [
          {
            label: localizer.t('menu_continue'),
            action: MenuAction.Continue,
            y: startY,
          },
          {
            label: localizer.t('menu_load_game'),
            action: MenuAction.LoadGame,
            y: startY + spacing,
          },
          {
            label: localizer.t('menu_editor'),
            action: MenuAction.Editor,
            y: startY + spacing * 2,
          },
          {
            label: localizer.t('menu_settings'),
            action: MenuAction.Settings,
            y: startY + spacing * 3,
          },
          {
            label: localizer.t('menu_exit'),
            action: MenuAction.Exit,
            y: startY + spacing * 4,
          },
        ]
      } else {
        this.menuItems = [
          {
            label: localizer.t('menu_new_game'),
            action: MenuAction.NewGame,
            y: startY,
          },
          {
            label: localizer.t('menu_editor'),
            action: MenuAction.Editor,
            y: startY + spacing,
          },
          {
            label: localizer.t('menu_settings'),
            action: MenuAction.Settings,
            y: startY + spacing * 2,
          },
          {
            label: localizer.t('menu_exit'),
            action: MenuAction.Exit,
            y: startY + spacing * 3,
          },
        ]
      }
    } else if (this.mode === MenuMode.Pause) {
      this.menuItems = [
        {
          label: localizer.t('menu_resume'),
          action: MenuAction.Resume,
          y: startY,
        },
        {
          label: localizer.t('menu_save_game'),
          action: MenuAction.SaveGame,
          y: startY + spacing,
        },
        {
          label: localizer.t('menu_main_menu'),
          action: MenuAction.MainMenu,
          y: startY + spacing * 2,
        },
        {
          label: localizer.t('menu_settings'),
          action: MenuAction.Settings,
          y: startY + spacing * 3,
        },
        {
          label: localizer.t('menu_exit'),
          action: MenuAction.Exit,
          y: startY + spacing * 4,
        },
      ]
    } else if (this.mode === MenuMode.Settings) {
      const currentLang = localizer.getCurrentLanguage()
      const langDisplay =
        currentLang === Language.ZhHans ? '简体中文' : 'English'

      this.menuItems = [
        {
          label: localizer.t('menu_settings_language'),
          action: MenuAction.Language,
          y: startY,
          value: langDisplay,
        },
        {
          label: localizer.t('menu_back'),
          action: MenuAction.Back,
          y: startY + spacing * 2,
        },
      ]
    } else if (this.mode === MenuMode.SaveList) {
      this.initSaveListItems(startY, spacing)
    }

    if (this.selectedIndex >= this.menuItems.length) {
      this.selectedIndex = 0
    }
  }

  private initSaveListItems(startY: number, spacing: number) {
    const saves = this.saveListCache
    const saveItemSpacing = 60

    if (saves.length === 0) {
      this.menuItems = [
        {
          label: localizer.t('save_list_empty'),
          action: MenuAction.SaveListSelect,
          y: startY,
        },
        {
          label: localizer.t('save_list_new'),
          action: MenuAction.SaveListNew,
          y: startY + spacing * 2,
        },
        {
          label: localizer.t('menu_back'),
          action: MenuAction.Back,
          y: startY + spacing * 3,
        },
      ]
      return
    }

    let y = startY
    for (let i = 0; i < saves.length; i++) {
      const save = saves[i]
      this.menuItems.push({
        label: save.name,
        action: MenuAction.SaveListSelect,
        y,
        saveId: save.id,
        saveMeta: save,
      })
      y += saveItemSpacing
    }

    y += spacing * 0.5
    this.menuItems.push({
      label: localizer.t('save_list_new'),
      action: MenuAction.SaveListNew,
      y,
    })
    y += spacing

    this.menuItems.push({
      label: localizer.t('menu_back'),
      action: MenuAction.Back,
      y,
    })
  }

  private setupInput() {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!this.visible) return

      if (e.key === 'ArrowUp' || e.key === 'w') {
        e.preventDefault()
        this.setSelectedIndex(
          (this.selectedIndex - 1 + this.menuItems.length) %
            this.menuItems.length
        )
      } else if (e.key === 'ArrowDown' || e.key === 's') {
        e.preventDefault()
        this.setSelectedIndex((this.selectedIndex + 1) % this.menuItems.length)
      } else if (e.key === 'ArrowLeft' || e.key === 'a') {
        const item = this.menuItems[this.selectedIndex]
        if (item.action === MenuAction.Language) {
          e.preventDefault()
          this.cycleLanguage(-1)
        }
      } else if (e.key === 'ArrowRight' || e.key === 'd') {
        const item = this.menuItems[this.selectedIndex]
        if (item.action === MenuAction.Language) {
          e.preventDefault()
          this.cycleLanguage(1)
        }
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        this.selectMenuItem(this.selectedIndex)
      } else if (e.key === 'Escape') {
        if (
          this.mode === MenuMode.Settings ||
          this.mode === MenuMode.SaveList
        ) {
          e.preventDefault()
          this.show(this.previousMode, true)
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.mode === MenuMode.SaveList) {
          const item = this.menuItems[this.selectedIndex]
          if (item.action === MenuAction.SaveListSelect && item.saveId) {
            e.preventDefault()
            this.deleteSave(item.saveId)
          }
        }
      }
    }

    this.inputTarget.addEventListener('keydown', handleKeyDown, true)
  }

  private async deleteSave(saveId: string) {
    const success = await saveManager.deleteSave(saveId)
    if (success) {
      await this.refreshSaveList()
      this.initMenuItems()
      this.syncMenuDom()
    }
  }

  private async cycleLanguage(direction: number) {
    const languages = Object.values(Language)
    const currentLang = localizer.getCurrentLanguage()
    const currentIndex = languages.indexOf(currentLang)
    let newIndex = (currentIndex + direction) % languages.length
    if (newIndex < 0) newIndex += languages.length

    await localizer.setLanguage(languages[newIndex])
    this.initMenuItems()
    this.syncMenuDom()
  }

  private handleItemMouseEnter(event: Event) {
    if (!this.visible) return
    const target = event.currentTarget
    if (!(target instanceof HTMLButtonElement)) return
    const index = Number.parseInt(target.dataset.index || '', 10)
    if (!Number.isFinite(index)) return
    if (index !== this.selectedIndex) {
      this.setSelectedIndex(index)
    }
  }

  private handleItemClick(event: Event) {
    if (!this.visible) return
    const target = event.currentTarget
    if (!(target instanceof HTMLButtonElement)) return
    const index = Number.parseInt(target.dataset.index || '', 10)
    if (!Number.isFinite(index)) return
    const item = this.menuItems[index]
    if (!item) return
    if (item.action === MenuAction.Language) {
      this.cycleLanguage(1)
      return
    }
    this.selectMenuItem(index)
  }

  private ensureMenuItemElements(count: number) {
    while (this.menuItemElements.length < count) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'menu-item'
      button.addEventListener('mouseenter', this.boundHandleItemMouseEnter)
      button.addEventListener('click', this.boundHandleItemClick)
      this.menuItemsContainer.appendChild(button)
      this.menuItemElements.push(button)
    }
  }

  private buildMenuItemText(item: MenuItem, isSelected: boolean): string {
    let text = item.label
    if (item.value) {
      if (isSelected && item.action === MenuAction.Language) {
        text += ` < ${item.value} >`
      } else {
        text += ` : ${item.value}`
      }
    }
    return text
  }

  private updateMenuItemState(index: number) {
    if (index < 0 || index >= this.activeItemCount) return
    const item = this.menuItems[index]
    const element = this.menuItemElements[index]
    if (!item || !element) return
    const isSelected = index === this.selectedIndex
    const isSaveItem = item.action === MenuAction.SaveListSelect
    element.classList.toggle('is-selected', isSelected)
    element.classList.toggle('menu-item-back', item.action === MenuAction.Back)
    element.classList.toggle('menu-item-save', isSaveItem)
    element.classList.toggle(
      'menu-item-save-new',
      item.action === MenuAction.SaveListNew && this.mode === MenuMode.SaveList
    )

    if (isSaveItem && item.saveMeta) {
      this.renderSaveItemContent(element, item.saveMeta)
    } else {
      element.textContent = this.buildMenuItemText(item, isSelected)
    }
  }

  private renderSaveItemContent(element: HTMLButtonElement, meta: SaveMeta) {
    element.innerHTML = ''

    const thumb =
      meta.thumbnail && meta.thumbnail.length > 0
        ? this.createSaveThumbnailImage(meta.thumbnail)
        : this.createSaveThumbnailPlaceholder()
    element.appendChild(thumb)

    const textContainer = document.createElement('div')
    textContainer.className = 'save-item-text'

    const nameEl = document.createElement('span')
    nameEl.className = 'save-item-name'
    nameEl.textContent = meta.name

    const infoEl = document.createElement('span')
    infoEl.className = 'save-item-info'
    const playTime = saveManager.formatPlayTime(meta.playTimeMs)
    const lastPlayed = saveManager.formatLastPlayed(meta.updatedAt)
    infoEl.textContent = `${meta.mapName} · ${playTime} · ${lastPlayed}`

    textContainer.appendChild(nameEl)
    textContainer.appendChild(infoEl)
    element.appendChild(textContainer)
  }

  private createSaveThumbnailImage(src: string): HTMLImageElement {
    const img = document.createElement('img')
    img.className = 'save-item-thumb'
    img.src = src
    return img
  }

  private createSaveThumbnailPlaceholder(): HTMLDivElement {
    const placeholder = document.createElement('div')
    placeholder.className = 'save-item-thumb save-item-thumb-placeholder'
    return placeholder
  }

  private updateMenuTitle() {
    if (this.mode === MenuMode.SaveList) {
      this.menuTitle.textContent = localizer.t('save_list_title')
    } else {
      this.menuTitle.textContent = localizer.t('title')
    }
    this.menuTitle.classList.toggle(
      'menu-title-compact',
      this.mode === MenuMode.SaveList
    )
    const isSaveList = this.mode === MenuMode.SaveList
    this.menuTitle.style.display = isSaveList ? 'none' : ''
    this.saveListContainer.style.display = isSaveList ? 'flex' : 'none'
    if (isSaveList) {
      this.saveListTitle.textContent = localizer.t('save_list_title')
    }
  }

  private syncMenuDom() {
    this.updateMenuTitle()
    this.ensureMenuItemElements(this.menuItems.length)
    this.activeItemCount = this.menuItems.length
    if (this.mode === MenuMode.SaveList) {
      this.saveListList.innerHTML = ''
    }
    for (let i = 0; i < this.menuItemElements.length; i++) {
      const element = this.menuItemElements[i]
      const item = this.menuItems[i]
      if (i < this.activeItemCount) {
        element.style.display = ''
        element.dataset.index = String(i)
        this.updateMenuItemState(i)
        if (this.mode === MenuMode.SaveList && item) {
          element.style.top = ''
          if (item.action === MenuAction.SaveListSelect) {
            this.saveListList.appendChild(element)
          } else {
            this.menuItemsContainer.appendChild(element)
          }
        } else if (item) {
          this.menuItemsContainer.appendChild(element)
        }
        if (item?.action === MenuAction.Back) {
          element.style.top = ''
        }
      } else {
        element.style.display = 'none'
        element.dataset.index = ''
      }
    }
  }

  private setSelectedIndex(index: number) {
    if (index === this.selectedIndex) return
    const previousIndex = this.selectedIndex
    this.selectedIndex = index
    this.updateMenuItemState(previousIndex)
    this.updateMenuItemState(index)
    if (this.mode === MenuMode.SaveList) {
      const item = this.menuItems[this.selectedIndex]
      const element = this.menuItemElements[this.selectedIndex]
      if (
        item &&
        element &&
        item.action === MenuAction.SaveListSelect &&
        element.scrollIntoView
      ) {
        element.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    }
  }

  private selectMenuItem(index: number) {
    const item = this.menuItems[index]

    if (item.action === MenuAction.Settings) {
      this.previousMode = this.mode
      this.show(MenuMode.Settings, true)
      return
    }

    if (item.action === MenuAction.LoadGame) {
      this.previousMode = this.mode
      this.refreshSaveList().then(() => {
        this.show(MenuMode.SaveList, true)
      })
      return
    }

    if (item.action === MenuAction.Back) {
      this.show(this.previousMode, true)
      return
    }

    if (this.onActionCallback) {
      this.onActionCallback(item.action, item.saveId)
    }
  }

  show(mode: MenuMode = MenuMode.Start, skipAnimation = false) {
    this.mode = mode
    this.visible = true
    this.selectedIndex = 0
    this.animTime = skipAnimation ? 300 : 0
    this.initMenuItems()
    this.syncMenuDom()
    this.uiLayer.classList.add('is-interactive')
    this.menuOverlay.classList.add('is-visible')
    this.menuOverlay.setAttribute('aria-hidden', 'false')
    this.inputTarget.focus(this.focusOptions)
    this.render(0)
  }

  async showWithSaveRefresh(
    mode: MenuMode = MenuMode.Start,
    skipAnimation = false
  ) {
    await this.initSaveState()
    this.show(mode, skipAnimation)
  }

  hide() {
    this.visible = false
    this.uiLayer.classList.remove('is-interactive')
    this.menuOverlay.classList.remove('is-visible')
    this.menuOverlay.setAttribute('aria-hidden', 'true')
  }

  isVisible(): boolean {
    return this.visible
  }

  getMode(): MenuMode {
    return this.mode
  }

  onAction(callback: (action: MenuAction, saveId?: string) => void) {
    this.onActionCallback = callback
  }

  render(deltaTime: number) {
    if (!this.visible) return

    const height = this.canvas.height

    this.animTime += deltaTime * 1000
    const duration = 300
    const t = Math.min(1, this.animTime / duration)
    const ease = t

    const titleTargetY = height / 2 - 150
    const titleStartY = -150
    const titleY = titleStartY + (titleTargetY - titleStartY) * ease

    const groupStartY = height / 2
    const currentGroupOffset = groupStartY * (1 - ease)

    this.menuTitle.style.top = `${titleY}px`

    if (this.mode === MenuMode.SaveList) {
      return
    }

    for (let i = 0; i < this.menuItems.length; i++) {
      const item = this.menuItems[i]
      const element = this.menuItemElements[i]
      if (!element) continue
      if (item.action === MenuAction.Back) {
        continue
      }
      const currentY = item.y + currentGroupOffset
      element.style.top = `${currentY}px`
    }
  }
}
