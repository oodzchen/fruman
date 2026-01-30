import { localizer } from '../Localizer'

export interface EditorToolbarContext {
  onBack: () => void
  onPreview: () => void
  onSave: () => Promise<void>
}

export class EditorToolbarManager {
  private editorActions: HTMLDivElement
  private editorBackBtn: HTMLButtonElement
  private editorPreviewBtn: HTMLButtonElement
  private editorSaveBtn: HTMLButtonElement
  private context: EditorToolbarContext

  constructor(context: EditorToolbarContext) {
    this.context = context

    const actions = document.getElementById('editorActions')
    const backBtn = document.getElementById('editorBackBtn')
    const previewBtn = document.getElementById('editorPreviewBtn')
    const saveBtn = document.getElementById('editorSaveBtn')

    if (
      !(actions instanceof HTMLDivElement) ||
      !(backBtn instanceof HTMLButtonElement) ||
      !(previewBtn instanceof HTMLButtonElement) ||
      !(saveBtn instanceof HTMLButtonElement)
    ) {
      throw new Error('Editor toolbar elements are missing.')
    }

    this.editorActions = actions
    this.editorBackBtn = backBtn
    this.editorPreviewBtn = previewBtn
    this.editorSaveBtn = saveBtn

    this.setupEventListeners()
  }

  private setupEventListeners() {
    this.editorBackBtn.addEventListener('click', () => {
      this.context.onBack()
    })

    this.editorPreviewBtn.addEventListener('click', () => {
      this.context.onPreview()
    })

    this.editorSaveBtn.addEventListener('click', () => {
      void this.context.onSave()
    })
  }

  public show() {
    this.editorActions.style.display = 'flex'
  }

  public hide() {
    this.editorActions.style.display = 'none'
  }

  public updateLocalization() {
    this.editorBackBtn.textContent = localizer.t('editor_back_to_menu')
    this.editorPreviewBtn.textContent = localizer.t('editor_preview')
    this.editorSaveBtn.textContent = localizer.t('editor_save')
  }

  public getBackBtn(): HTMLButtonElement {
    return this.editorBackBtn
  }
}
