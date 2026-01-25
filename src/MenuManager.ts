import { Language, localizer } from './Localizer'

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
}

export enum MenuMode {
  Start,
  Pause,
  Settings,
}

interface MenuItem {
  label: string
  action: MenuAction
  y: number
  value?: string // For dynamic values like "English"
}

export class MenuManager {
  private canvas: HTMLCanvasElement
  private menuOverlay: HTMLDivElement
  private uiLayer: HTMLDivElement
  private menuTitle: HTMLDivElement
  private menuItemsContainer: HTMLDivElement
  private menuItemElements: HTMLButtonElement[] = []
  private activeItemCount = 0
  private visible = false
  private mode: MenuMode = MenuMode.Start
  private previousMode: MenuMode = MenuMode.Start
  private menuItems: MenuItem[] = []
  private selectedIndex = 0
  private onActionCallback?: (action: MenuAction) => void
  private animTime = 0

  private boundHandleItemMouseEnter: (event: Event) => void
  private boundHandleItemClick: (event: Event) => void

  constructor(canvas: HTMLCanvasElement, menuOverlay: HTMLDivElement) {
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
    this.boundHandleItemMouseEnter = this.handleItemMouseEnter.bind(this)
    this.boundHandleItemClick = this.handleItemClick.bind(this)
    this.menuOverlay.classList.remove('is-visible')
    this.menuOverlay.setAttribute('aria-hidden', 'true')
    this.initMenuItems()
    this.setupInput()
  }

  private initMenuItems() {
    const startY = this.canvas.height / 2 + 40
    const spacing = 35
    this.menuItems = []

    if (this.mode === MenuMode.Start) {
      this.menuItems = [
        {
          label: localizer.t('menu_new_game'),
          action: MenuAction.NewGame,
          y: startY,
        },
        {
          label: localizer.t('menu_continue_game'),
          action: MenuAction.Continue,
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
    } else if (this.mode === MenuMode.Pause) {
      this.menuItems = [
        {
          label: localizer.t('menu_resume'),
          action: MenuAction.Resume,
          y: startY,
        },
        {
          label: localizer.t('menu_main_menu'),
          action: MenuAction.MainMenu,
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
          y: startY + spacing * 2, // Extra spacing
        },
      ]
    }

    if (this.selectedIndex >= this.menuItems.length) {
      this.selectedIndex = 0
    }
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
        // Reset animation time slightly for feedback? No, keep it smooth.
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
        // Handle Back if in settings
        if (this.mode === MenuMode.Settings) {
          e.preventDefault()
          this.show(this.previousMode, true)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
  }

  private async cycleLanguage(direction: number) {
    const languages = Object.values(Language)
    const currentLang = localizer.getCurrentLanguage()
    const currentIndex = languages.indexOf(currentLang)
    let newIndex = (currentIndex + direction) % languages.length
    if (newIndex < 0) newIndex += languages.length

    await localizer.setLanguage(languages[newIndex])
    this.initMenuItems() // Refresh text
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
    element.classList.toggle('is-selected', isSelected)
    element.textContent = this.buildMenuItemText(item, isSelected)
  }

  private updateMenuTitle() {
    this.menuTitle.textContent = localizer.t('title')
  }

  private syncMenuDom() {
    this.updateMenuTitle()
    this.ensureMenuItemElements(this.menuItems.length)
    this.activeItemCount = this.menuItems.length
    for (let i = 0; i < this.menuItemElements.length; i++) {
      const element = this.menuItemElements[i]
      if (i < this.activeItemCount) {
        element.style.display = ''
        element.dataset.index = String(i)
        this.updateMenuItemState(i)
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
  }

  private selectMenuItem(index: number) {
    const item = this.menuItems[index]

    if (item.action === MenuAction.Settings) {
      this.previousMode = this.mode
      this.show(MenuMode.Settings, true)
      return
    }

    if (item.action === MenuAction.Back) {
      this.show(this.previousMode, true)
      return
    }

    if (this.onActionCallback) {
      this.onActionCallback(item.action)
    }
  }
  show(mode: MenuMode = MenuMode.Start, skipAnimation = false) {
    this.mode = mode
    this.visible = true
    this.selectedIndex = 0
    // If skipping animation, fast forward to end state (300ms)
    this.animTime = skipAnimation ? 300 : 0
    this.initMenuItems()
    this.syncMenuDom()
    this.uiLayer.classList.add('is-interactive')
    this.menuOverlay.classList.add('is-visible')
    this.menuOverlay.setAttribute('aria-hidden', 'false')
    this.render(0)
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

  onAction(callback: (action: MenuAction) => void) {
    this.onActionCallback = callback
  }

  render(deltaTime: number) {
    if (!this.visible) return

    const height = this.canvas.height

    // Animation progress
    this.animTime += deltaTime * 1000 // convert to ms
    const duration = 300 // ms
    const t = Math.min(1, this.animTime / duration)
    const ease = t

    // Title Animation (From top)
    const titleTargetY = height / 2 - 150
    const titleStartY = -150
    const titleY = titleStartY + (titleTargetY - titleStartY) * ease

    // Menu Items Animation (From bottom)
    const groupStartY = height / 2
    const currentGroupOffset = groupStartY * (1 - ease)

    this.menuTitle.style.top = `${titleY}px`

    for (let i = 0; i < this.menuItems.length; i++) {
      const item = this.menuItems[i]
      const element = this.menuItemElements[i]
      if (!element) continue
      const currentY = item.y + currentGroupOffset
      element.style.top = `${currentY}px`
    }
  }
}
