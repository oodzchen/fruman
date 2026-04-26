import { EditorUIHelper } from './EditorUIHelper'

export type EditorBodyDrawerSidebarTab = 'layers' | 'bones'

export interface EditorBodyDrawerSidebarTabElements {
  tabBtnLayers: HTMLButtonElement
  tabBtnBones: HTMLButtonElement
  layerHeader: HTMLDivElement
  layerList: HTMLDivElement
  bonesPanel: HTMLDivElement
}

export function createStyledElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  cssText: string,
  textContent?: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName)
  element.style.cssText = cssText
  if (textContent !== undefined) {
    element.textContent = textContent
  }
  return element
}

export function appendChildren(
  parent: HTMLElement,
  ...children: HTMLElement[]
) {
  for (let i = 0; i < children.length; i++) {
    parent.appendChild(children[i])
  }
}

export function clearElementChildren(element: HTMLElement) {
  while (element.firstChild) {
    element.removeChild(element.firstChild)
  }
}

export function createPopupMenu(
  minWidth: string,
  zIndex: number
): HTMLDivElement {
  return createStyledElement(
    'div',
    [
      'position:absolute',
      'display:none',
      'flex-direction:column',
      'gap:4px',
      'padding:0',
      'background:rgba(10,9,7,0.96)',
      `z-index:${zIndex}`,
      `min-width:${minWidth}`,
      'box-sizing:border-box',
    ].join(';')
  )
}

export function createPopupButton(
  label: string,
  fontSize: string
): HTMLButtonElement {
  const button = EditorUIHelper.createButton(label)
  button.style.padding = fontSize === '11px' ? '6px 10px' : '6px 8px'
  button.style.fontSize = fontSize
  button.style.border = 'none'
  button.style.background = 'rgba(255,255,255,0.08)'
  return button
}

export function hidePopupMenu(menu: HTMLElement) {
  menu.style.display = 'none'
}

export function placePopupMenuWithin(
  menu: HTMLElement,
  boundsElement: HTMLElement,
  clientX: number,
  clientY: number
) {
  menu.style.display = 'flex'
  menu.style.left = '0px'
  menu.style.top = '0px'
  const boundsRect = boundsElement.getBoundingClientRect()
  const menuRect = menu.getBoundingClientRect()
  let left = clientX - boundsRect.left
  let top = clientY - boundsRect.top
  if (left + menuRect.width > boundsRect.width - 4) {
    left = boundsRect.width - menuRect.width - 4
  }
  if (top + menuRect.height > boundsRect.height - 4) {
    top = boundsRect.height - menuRect.height - 4
  }
  if (left < 4) left = 4
  if (top < 4) top = 4
  menu.style.left = `${left}px`
  menu.style.top = `${top}px`
}

export function setPopupButtonEnabled(
  button: HTMLButtonElement,
  enabled: boolean
) {
  button.disabled = !enabled
  button.style.opacity = enabled ? '1' : '0.4'
  button.style.cursor = enabled ? 'pointer' : 'default'
}

export function styleCompactButton(button: HTMLButtonElement) {
  button.style.padding = '6px 8px'
  button.style.fontSize = '10px'
}

export function styleDrawerModeButton(button: HTMLButtonElement) {
  button.style.flex = '1 1 100%'
  button.style.minWidth = '0'
  button.style.padding = '6px 8px'
  button.style.fontSize = '10px'
  button.style.lineHeight = '1.2'
  button.style.whiteSpace = 'normal'
  button.style.writingMode = 'horizontal-tb'
  button.style.textOrientation = 'mixed'
  button.style.textAlign = 'center'
  button.style.boxSizing = 'border-box'
}

export function getSidebarTabButtonStyle(active: boolean): string {
  return [
    'flex:1',
    'padding:3px 0',
    'font-size:10px',
    'font-family:monospace',
    'cursor:pointer',
    'border:1px solid rgba(255,255,255,0.2)',
    'border-radius:2px',
    active
      ? 'color:#fff;background:rgba(255,255,255,0.18)'
      : 'color:rgba(255,255,255,0.45);background:transparent',
  ].join(';')
}

export function setSidebarTabState(
  elements: EditorBodyDrawerSidebarTabElements,
  tab: EditorBodyDrawerSidebarTab
) {
  const layersActive = tab === 'layers'
  elements.tabBtnLayers.style.cssText = getSidebarTabButtonStyle(layersActive)
  elements.tabBtnBones.style.cssText = getSidebarTabButtonStyle(!layersActive)
  elements.layerHeader.style.display = layersActive ? 'flex' : 'none'
  elements.layerList.style.display = layersActive ? 'flex' : 'none'
  elements.bonesPanel.style.display = layersActive ? 'none' : 'flex'
}
