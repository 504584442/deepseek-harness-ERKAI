// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BrandBadge } from '../src/client/BrandBadge.tsx'

afterEach(cleanup)

const unusedHook = (() => { throw new Error('unused') }) as never

describe('Tianmu sidebar attribution', () => {
  it('shows the attribution text in the wide sidebar', () => {
    render(<BrandBadge wide useSessions={unusedHook} useWorkspaces={unusedHook} />)

    const link = screen.getByRole('link', { name: '访问天幕插件市场' })
    expect(link.getAttribute('href')).toBe('https://deepseek.stream')
    expect(screen.getByText('天幕出品')).not.toBeNull()
  })

  it('keeps only the tooltip-backed logo in the collapsed rail', () => {
    render(<BrandBadge wide={false} useSessions={unusedHook} useWorkspaces={unusedHook} />)

    expect(screen.getByRole('link', { name: '访问天幕插件市场' })).not.toBeNull()
    expect(screen.queryByText('天幕出品')).toBeNull()
  })
})
