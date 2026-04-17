// 预分配数组，避免 GC
const _tempObbVerts = [
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
]
const _tempAxes = [
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
]

export function checkOBBvsOBB(
  x1: number,
  y1: number,
  w1: number,
  h1: number,
  rot1: number,
  x2: number,
  y2: number,
  w2: number,
  h2: number,
  rot2: number
): boolean {
  // 分离轴定理（SAT）检测两个 OBB 是否相交
  const cos1 = Math.cos(rot1)
  const sin1 = Math.sin(rot1)
  const cos2 = Math.cos(rot2)
  const sin2 = Math.sin(rot2)

  _tempAxes[0].x = cos1
  _tempAxes[0].y = sin1
  _tempAxes[1].x = -sin1
  _tempAxes[1].y = cos1
  _tempAxes[2].x = cos2
  _tempAxes[2].y = sin2
  _tempAxes[3].x = -sin2
  _tempAxes[3].y = cos2

  const hw1 = w1 / 2
  const hh1 = h1 / 2
  const hw2 = w2 / 2
  const hh2 = h2 / 2

  const dx = x2 - x1
  const dy = y2 - y1

  for (const axis of _tempAxes) {
    const proj1 =
      Math.abs(hw1 * (cos1 * axis.x + sin1 * axis.y)) +
      Math.abs(hh1 * (-sin1 * axis.x + cos1 * axis.y))
    const proj2 =
      Math.abs(hw2 * (cos2 * axis.x + sin2 * axis.y)) +
      Math.abs(hh2 * (-sin2 * axis.x + cos2 * axis.y))
    const projDist = Math.abs(dx * axis.x + dy * axis.y)

    if (projDist > proj1 + proj2) {
      return false
    }
  }

  return true
}

export function checkOBBvsAABB(
  obbCenterX: number,
  obbCenterY: number,
  obbWidth: number,
  obbHeight: number,
  obbRotation: number,
  aabbCenterX: number,
  aabbCenterY: number,
  aabbHalfWidth: number,
  aabbHalfHeight: number
): boolean {
  const cos = Math.cos(obbRotation)
  const sin = Math.sin(obbRotation)

  const dx = obbCenterX - aabbCenterX
  const dy = obbCenterY - aabbCenterY

  const projD1 = Math.abs(dx * cos + dy * sin)
  const projAABB1 =
    aabbHalfWidth * Math.abs(cos) + aabbHalfHeight * Math.abs(sin)
  if (projD1 > obbWidth / 2 + projAABB1) return false

  const projD2 = Math.abs(-dx * sin + dy * cos)
  const projAABB2 =
    aabbHalfWidth * Math.abs(sin) + aabbHalfHeight * Math.abs(cos)
  if (projD2 > obbHeight / 2 + projAABB2) return false

  const projD3 = Math.abs(dx)
  const projOBB3 =
    (obbWidth / 2) * Math.abs(cos) + (obbHeight / 2) * Math.abs(sin)
  if (projD3 > projOBB3 + aabbHalfWidth) return false

  const projD4 = Math.abs(dy)
  const projOBB4 =
    (obbWidth / 2) * Math.abs(sin) + (obbHeight / 2) * Math.abs(cos)
  if (projD4 > projOBB4 + aabbHalfHeight) return false

  return true
}

export function checkOBBvsCircle(
  obbCenterX: number,
  obbCenterY: number,
  obbWidth: number,
  obbHeight: number,
  obbRotation: number,
  circleX: number,
  circleY: number,
  circleRadius: number
): boolean {
  const cos = Math.cos(-obbRotation)
  const sin = Math.sin(-obbRotation)

  const dx = circleX - obbCenterX
  const dy = circleY - obbCenterY

  const localX = dx * cos - dy * sin
  const localY = dx * sin + dy * cos

  const halfWidth = obbWidth / 2
  const halfHeight = obbHeight / 2

  const clampedX = Math.max(-halfWidth, Math.min(halfWidth, localX))
  const clampedY = Math.max(-halfHeight, Math.min(halfHeight, localY))

  const distanceX = localX - clampedX
  const distanceY = localY - clampedY

  return (
    distanceX * distanceX + distanceY * distanceY <= circleRadius * circleRadius
  )
}

export function checkOBBvsPolygon(
  wx: number,
  wy: number,
  ww: number,
  wh: number,
  wRot: number,
  vertices: { x: number; y: number }[]
): boolean {
  const cos = Math.cos(wRot)
  const sin = Math.sin(wRot)
  const hw = ww / 2
  const hh = wh / 2

  _tempObbVerts[0].x = wx + (cos * -hw - sin * -hh)
  _tempObbVerts[0].y = wy + (sin * -hw + cos * -hh)
  _tempObbVerts[1].x = wx + (cos * hw - sin * -hh)
  _tempObbVerts[1].y = wy + (sin * hw + cos * -hh)
  _tempObbVerts[2].x = wx + (cos * hw - sin * hh)
  _tempObbVerts[2].y = wy + (sin * hw + cos * hh)
  _tempObbVerts[3].x = wx + (cos * -hw - sin * hh)
  _tempObbVerts[3].y = wy + (sin * -hw + cos * hh)

  if (!_checkOBBvsPolyAxis(cos, sin, _tempObbVerts, vertices)) return false
  if (!_checkOBBvsPolyAxis(-sin, cos, _tempObbVerts, vertices)) return false

  const polyCount = vertices.length
  for (let i = 0; i < polyCount; i++) {
    const curr = vertices[i]
    const next = vertices[(i + 1) % polyCount]
    const edgeX = next.x - curr.x
    const edgeY = next.y - curr.y
    if (!_checkOBBvsPolyAxis(-edgeY, edgeX, _tempObbVerts, vertices)) {
      return false
    }
  }

  return true
}

export function checkOBBvsFlatPolygon(
  wx: number,
  wy: number,
  ww: number,
  wh: number,
  wRot: number,
  vertices: readonly number[]
): boolean {
  if (vertices.length < 6 || vertices.length % 2 !== 0) {
    return false
  }

  const cos = Math.cos(wRot)
  const sin = Math.sin(wRot)
  const hw = ww / 2
  const hh = wh / 2

  _tempObbVerts[0].x = wx + (cos * -hw - sin * -hh)
  _tempObbVerts[0].y = wy + (sin * -hw + cos * -hh)
  _tempObbVerts[1].x = wx + (cos * hw - sin * -hh)
  _tempObbVerts[1].y = wy + (sin * hw + cos * -hh)
  _tempObbVerts[2].x = wx + (cos * hw - sin * hh)
  _tempObbVerts[2].y = wy + (sin * hw + cos * hh)
  _tempObbVerts[3].x = wx + (cos * -hw - sin * hh)
  _tempObbVerts[3].y = wy + (sin * -hw + cos * hh)

  if (!_checkFlatAxis(cos, sin, _tempObbVerts, vertices)) return false
  if (!_checkFlatAxis(-sin, cos, _tempObbVerts, vertices)) return false

  for (let i = 0; i < vertices.length; i += 2) {
    const nextIndex = i + 2 < vertices.length ? i + 2 : 0
    const edgeX = vertices[nextIndex] - vertices[i]
    const edgeY = vertices[nextIndex + 1] - vertices[i + 1]
    if (!_checkFlatAxis(-edgeY, edgeX, _tempObbVerts, vertices)) {
      return false
    }
  }

  return true
}

function _checkOBBvsPolyAxis(
  axisX: number,
  axisY: number,
  obbVerts: { x: number; y: number }[],
  polyVerts: { x: number; y: number }[]
): boolean {
  let minOBB = Infinity
  let maxOBB = -Infinity
  for (let i = 0; i < obbVerts.length; i++) {
    const v = obbVerts[i]
    const proj = v.x * axisX + v.y * axisY
    if (proj < minOBB) minOBB = proj
    if (proj > maxOBB) maxOBB = proj
  }

  let minPoly = Infinity
  let maxPoly = -Infinity
  for (let i = 0; i < polyVerts.length; i++) {
    const v = polyVerts[i]
    const proj = v.x * axisX + v.y * axisY
    if (proj < minPoly) minPoly = proj
    if (proj > maxPoly) maxPoly = proj
  }

  return !(maxOBB < minPoly || maxPoly < minOBB)
}

function _checkFlatAxis(
  axisX: number,
  axisY: number,
  obbVerts: { x: number; y: number }[],
  polyVerts: readonly number[]
): boolean {
  let minOBB = Infinity
  let maxOBB = -Infinity
  for (let i = 0; i < obbVerts.length; i++) {
    const v = obbVerts[i]
    const proj = v.x * axisX + v.y * axisY
    if (proj < minOBB) minOBB = proj
    if (proj > maxOBB) maxOBB = proj
  }

  let minPoly = Infinity
  let maxPoly = -Infinity
  for (let i = 0; i < polyVerts.length; i += 2) {
    const proj = polyVerts[i] * axisX + polyVerts[i + 1] * axisY
    if (proj < minPoly) minPoly = proj
    if (proj > maxPoly) maxPoly = proj
  }

  return !(maxOBB < minPoly || maxPoly < minOBB)
}
