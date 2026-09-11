/** Persistent team attribution in the sidebar foot. */

import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReactNode } from 'react'
import css from './DesktopCustomization.module.css'

/** Render the clickable team badge in the wide sidebar or compact rail. */
export function BrandBadge({ wide }: PropsRuntime<'sidebar.footer.action'>): ReactNode {
  return (
    <Tooltip label="天幕出品" delayMs={500} disabled={wide}>
      <a
        className={`${css.brandBadge}${wide ? '' : ` ${css.brandBadgeRail}`}`}
        href="https://deepseek.stream"
        target="_blank"
        rel="noreferrer"
        aria-label="访问天幕插件市场"
        title="天幕出品"
      >
        <img src="/dsh-desktop/tm-logo.png" alt="" />
        {wide ? <span>天幕出品</span> : null}
      </a>
    </Tooltip>
  )
}
