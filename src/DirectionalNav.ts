export function findDirectionalIndex(
  currentIndex: number,
  count: number,
  getElement: (index: number) => HTMLElement | null,
  dirX: number,
  dirY: number
): number {
  if (count <= 0 || currentIndex < 0 || currentIndex >= count) {
    return currentIndex
  }
  if ((dirX === 0 && dirY === 0) || (dirX !== 0 && dirY !== 0)) {
    return currentIndex
  }
  const currentElement = getElement(currentIndex)
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
    const element = getElement(i)
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
    const dist2 = dx * dx + dy * dy
    const offAxis = dirY !== 0 ? Math.abs(dx) : Math.abs(dy)
    const score = dist2 * 4 + offAxis * offAxis * 9
    if (score < bestScore) {
      bestScore = score
      bestIndex = i
    }
  }

  return bestIndex
}
