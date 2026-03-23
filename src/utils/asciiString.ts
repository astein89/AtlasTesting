/** Uppercase ASCII a–z only; other characters unchanged. */
export function uppercaseAsciiLetters(s: string): string {
  return s.replace(/[a-z]/g, (c) => c.toUpperCase())
}
