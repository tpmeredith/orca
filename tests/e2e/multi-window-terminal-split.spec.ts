import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { openTerminalContextMenu } from './helpers/terminal-pane-title-actions'
import { worktreeRowSurface } from './worktree-row-locators'
import {
  waitForActivePanePtyId,
  waitForPaneIdentitySnapshot,
  countVisibleTerminalPanes,
  getTerminalContent
} from './helpers/terminal'

test.skip(process.env.ORCA_E2E_WEB_CLIENT !== '1', 'Requires the bundled connected-client UI')
test.use({ orcaAppExtraArgs: process.platform === 'linux' ? ['--ozone-platform=x11'] : [] })

async function splitFromMenu(page: Page, label: string, count: number): Promise<void> {
  await openTerminalContextMenu(page)
  await page.getByRole('menuitem', { name: new RegExp(`^${label}`) }).click()
  await expect.poll(() => countVisibleTerminalPanes(page), { timeout: 5_000 }).toBe(count)
}

test('secondary-window context-menu splits appear and accept input without switching tabs', async ({
  orcaPage,
  electronApp
}, testInfo) => {
  await waitForActivePanePtyId(orcaPage, 30_000)
  await splitFromMenu(orcaPage, 'Split Terminal Right', 2)
  const worktreeId = await orcaPage.evaluate(() => window.__store?.getState().activeWorktreeId)
  if (!worktreeId) {
    throw new Error('Host workspace is missing')
  }
  await orcaPage.evaluate(() => window.api.settings.set({ experimentalMultiWindow: true }))
  const opened = electronApp.waitForEvent('window')
  await electronApp.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('new-window')
    if (!item) {
      throw new Error('File > New Window is missing')
    }
    item.click()
  })
  const worker = await opened
  const errors: string[] = []
  worker.on('pageerror', (error) => errors.push(error.message))
  try {
    await expect(worker.locator('[data-worktree-sidebar]')).toBeVisible({ timeout: 30_000 })
    await worktreeRowSurface(worker, worktreeId).click({ force: true })
    await expect(worker.locator('[data-rendered-active-worktree-id]')).toHaveAttribute(
      'data-rendered-active-worktree-id',
      worktreeId,
      { timeout: 30_000 }
    )
    await waitForActivePanePtyId(worker, 30_000)
    await expect.poll(() => countVisibleTerminalPanes(worker)).toBe(2)
    const tabId = await worker.evaluate(
      (id) => window.__store?.getState().activeTabIdByWorktree[id],
      worktreeId
    )
    await splitFromMenu(worker, 'Split Terminal Right', 3)
    await splitFromMenu(worker, 'Split Terminal Down', 4)
    const splitPanes = await waitForPaneIdentitySnapshot(worker, 4)
    const primary = await waitForPaneIdentitySnapshot(orcaPage, 4)
    expect(primary.panes.map((pane) => pane.leafId).sort()).toEqual(
      splitPanes.panes.map((pane) => pane.leafId).sort()
    )
    expect(
      await worker.evaluate(
        (id) => window.__store?.getState().activeTabIdByWorktree[id],
        worktreeId
      )
    ).toBe(tabId)
    const cdp = await worker.context().newCDPSession(worker)
    try {
      await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
      await worker.keyboard.type('echo SECONDARY_SPLIT_INPUT_OK')
      await worker.keyboard.press('Enter')
      await expect
        .poll(async () =>
          (await getTerminalContent(worker))
            .split(/\r?\n/)
            .some((line) => line.trim() === 'SECONDARY_SPLIT_INPUT_OK')
        )
        .toBe(true)
    } finally {
      await cdp.detach()
    }
    expect(errors).toEqual([])
    await testInfo.attach('secondary-split-immediate', {
      body: await worker.screenshot(),
      contentType: 'image/png'
    })
  } finally {
    await testInfo.attach('primary-split-state', {
      body: JSON.stringify(
        await orcaPage.evaluate(() => ({
          layouts: window.__store?.getState().terminalLayoutsByTabId,
          panes: [...document.querySelectorAll('.pane[data-leaf-id]')].map((pane) => ({
            leafId: pane.getAttribute('data-leaf-id'),
            ptyId: pane.getAttribute('data-pty-id')
          }))
        }))
      ),
      contentType: 'application/json'
    })
    await testInfo.attach('secondary-split-state', {
      body: JSON.stringify(
        await worker.evaluate(() => {
          const state = window.__store?.getState()
          const worktree = state?.activeWorktreeId
          const tab = worktree && state?.activeTabIdByWorktree[worktree]
          return {
            worktree,
            tab,
            layout: tab && state?.terminalLayoutsByTabId[tab],
            panes: [...document.querySelectorAll('.pane[data-leaf-id]')].map((pane) => ({
              leafId: pane.getAttribute('data-leaf-id'),
              ptyId: pane.getAttribute('data-pty-id')
            }))
          }
        })
      ),
      contentType: 'application/json'
    })
    await worker.close()
  }
})
