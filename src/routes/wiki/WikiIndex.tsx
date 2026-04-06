import { WikiPageView } from './WikiPageView'

/** Renders `content/wiki/index.md` at `/wiki`. Edit via toolbar or `/wiki/edit`. */
export function WikiIndex() {
  return <WikiPageView pagePath="index" />
}