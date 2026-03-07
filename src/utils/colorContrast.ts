/**
 * Returns a contrasting text color (black or white) for a given hex background
 * so that text remains readable. Uses relative luminance (WCAG-style).
 */
export function getContrastTextColor(hexBackground: string): '#fff' | '#111' {
  const hex = hexBackground.replace(/^#/, '')
  let r: number, g: number, b: number
  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16)
    g = parseInt(hex[1] + hex[1], 16)
    b = parseInt(hex[2] + hex[2], 16)
  } else if (hex.length === 6) {
    r = parseInt(hex.slice(0, 2), 16)
    g = parseInt(hex.slice(2, 4), 16)
    b = parseInt(hex.slice(4, 6), 16)
  } else {
    return '#111'
  }
  const linear = (v: number) => {
    const n = v / 255
    return n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4)
  }
  const L = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
  return L > 0.5 ? '#111' : '#fff'
}
