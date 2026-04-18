export function getPublicAssetUrl(path: string): string {
  const baseUrl = import.meta.env.BASE_URL
  if (path.length === 0) {
    return baseUrl
  }
  const normalizedPath = path.charCodeAt(0) === 47 ? path.slice(1) : path
  return `${baseUrl}${normalizedPath}`
}
