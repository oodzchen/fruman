export enum EditorSubmenuMode {
  None = 'none',
  Object = 'object',
  Terrain = 'terrain',
  TerrainContour = 'terrainContour',
  TerrainFill = 'terrainFill',
  Weapon = 'weapon',
  Npc = 'npc',
  Prop = 'prop',
}

type EditorMenuItemList = ArrayLike<HTMLButtonElement>

interface EditorMenuNavigatorContext {
  getMenuItems: (mode: EditorSubmenuMode) => EditorMenuItemList
  getCurrentMode: () => EditorSubmenuMode
  setCurrentMode: (mode: EditorSubmenuMode) => void
  getCurrentSelectedIndex: () => number
  setCurrentSelectedIndex: (index: number) => void
}

export class EditorMenuNavigator {
  private ctx: EditorMenuNavigatorContext

  constructor(ctx: EditorMenuNavigatorContext) {
    this.ctx = ctx
  }

  findFirstSelectableIndex(items: EditorMenuItemList): number {
    for (let i = 0; i < items.length; i++) {
      if (!items[i].disabled) {
        return i
      }
    }
    return 0
  }

  findNextSelectableIndex(
    items: EditorMenuItemList,
    startIndex: number,
    delta: number
  ): number {
    if (items.length === 0) {
      return 0
    }
    let index = startIndex
    for (let i = 0; i < items.length; i++) {
      index = (index + delta + items.length) % items.length
      if (!items[index].disabled) {
        return index
      }
    }
    return startIndex
  }

  clearSelection(mode: EditorSubmenuMode) {
    if (mode === EditorSubmenuMode.None) {
      return
    }
    const items = this.ctx.getMenuItems(mode)
    for (let i = 0; i < items.length; i++) {
      items[i].classList.remove('is-selected')
    }
  }

  applySelection() {
    const mode = this.ctx.getCurrentMode()
    if (mode === EditorSubmenuMode.None) {
      return
    }
    const items = this.ctx.getMenuItems(mode)
    if (items.length === 0) {
      return
    }
    this.clearSelection(mode)

    let selectedIndex = this.ctx.getCurrentSelectedIndex()
    if (selectedIndex >= items.length || items[selectedIndex].disabled) {
      selectedIndex = this.findFirstSelectableIndex(items)
      this.ctx.setCurrentSelectedIndex(selectedIndex)
    }
    items[selectedIndex].classList.add('is-selected')
  }

  setMode(mode: EditorSubmenuMode, resetIndex: boolean) {
    const currentMode = this.ctx.getCurrentMode()
    if (currentMode !== mode) {
      this.clearSelection(currentMode)
      this.ctx.setCurrentMode(mode)
    }
    if (mode === EditorSubmenuMode.None) {
      return
    }
    const items = this.ctx.getMenuItems(mode)
    if (items.length === 0) {
      return
    }
    if (resetIndex) {
      this.clearSelection(mode)
      this.ctx.setCurrentSelectedIndex(this.findFirstSelectableIndex(items))
    } else {
      const currentIndex = this.ctx.getCurrentSelectedIndex()
      if (currentIndex >= items.length) {
        this.ctx.setCurrentSelectedIndex(this.findFirstSelectableIndex(items))
      }
    }
    this.applySelection()
  }

  setSelectedIndex(index: number) {
    const mode = this.ctx.getCurrentMode()
    if (mode === EditorSubmenuMode.None) {
      return
    }
    const items = this.ctx.getMenuItems(mode)
    if (index < 0 || index >= items.length) {
      return
    }
    if (items[index].disabled) {
      return
    }
    const currentIndex = this.ctx.getCurrentSelectedIndex()
    if (index === currentIndex) {
      return
    }
    this.ctx.setCurrentSelectedIndex(index)
    this.applySelection()
  }
}
