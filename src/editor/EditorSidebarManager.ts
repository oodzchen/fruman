import { EditorView } from '../EditorManager'
import { localizer } from '../Localizer'

export interface EditorSidebarContext {
  onCollapseChange?: (collapsed: boolean) => void
  getCurrentView: () => EditorView
}

export class EditorSidebarManager {
  private editorSidebar: HTMLDivElement
  private editorPanelCollapseBtn: HTMLButtonElement
  private editorPanelCollapsedBtn: HTMLButtonElement
  private editorObjectPanel: HTMLDivElement
  private context: EditorSidebarContext
  private collapsed = false

  constructor(context: EditorSidebarContext) {
    this.context = context

    const sidebar = document.getElementById('editorSidebar')
    const panelCollapseBtn = document.getElementById('editorPanelCollapse')
    const panelCollapsedBtn = document.getElementById('editorPanelCollapsed')
    const objectPanel = document.getElementById('editorObjectPanel')

    if (
      !(sidebar instanceof HTMLDivElement) ||
      !(panelCollapseBtn instanceof HTMLButtonElement) ||
      !(panelCollapsedBtn instanceof HTMLButtonElement) ||
      !(objectPanel instanceof HTMLDivElement)
    ) {
      throw new Error('Editor sidebar elements are missing.')
    }

    this.editorSidebar = sidebar
    this.editorPanelCollapseBtn = panelCollapseBtn
    this.editorPanelCollapsedBtn = panelCollapsedBtn
    this.editorObjectPanel = objectPanel

    this.setupEventListeners()
  }

  private setupEventListeners() {
    this.editorPanelCollapseBtn.addEventListener('click', () => {
      this.setCollapsed(true)
    })

    this.editorPanelCollapsedBtn.addEventListener('click', () => {
      this.setCollapsed(false)
    })
  }

  public show() {
    if (!this.collapsed) {
      this.editorSidebar.style.display = 'block'
    }
    if (this.collapsed) {
      this.editorPanelCollapsedBtn.classList.add('is-visible')
    } else {
      this.editorPanelCollapsedBtn.classList.remove('is-visible')
    }
  }

  public hide() {
    this.editorSidebar.style.display = 'none'
    this.editorPanelCollapsedBtn.classList.remove('is-visible')
  }

  public setCollapsed(collapsed: boolean) {
    this.collapsed = collapsed
    if (collapsed) {
      this.editorSidebar.style.display = 'none'
      this.editorPanelCollapsedBtn.classList.add('is-visible')
    } else {
      if (this.context.getCurrentView() === EditorView.Editor) {
        this.editorSidebar.style.display = 'block'
      }
      this.editorPanelCollapsedBtn.classList.remove('is-visible')
    }
    if (this.context.onCollapseChange) {
      this.context.onCollapseChange(collapsed)
    }
  }

  public isCollapsed(): boolean {
    return this.collapsed
  }

  public updateLocalization() {
    this.editorPanelCollapseBtn.textContent = localizer.t(
      'editor_panel_collapse'
    )
    this.editorPanelCollapsedBtn.textContent = localizer.t(
      'editor_panel_expand'
    )
  }

  public containsTarget(node: Node): boolean {
    return this.editorSidebar.contains(node)
  }
}
