import { readFileSync } from 'node:fs'
import type { McpServer } from '@modelcontextprotocol/server'
import { describe, expect, it } from 'vitest'
import { actionsOf, registerTools, SERVED, stapeRegistrations, toolsManifest } from '../tools.ts'

const context = { auth: { getAccessToken: () => Promise.resolve('token') } }

function served() {
  const tools = new Map<string, { inputSchema?: { safeParse: (v: unknown) => { success: boolean } }; annotations: Record<string, unknown> }>()
  const server = { registerTool: (name: string, config: never) => void tools.set(name, config) } as unknown as McpServer
  registerTools(server, context)
  return tools
}

describe('the split of Stape’s tools', () => {
  it('classifies every tool and action Stape registers, exactly once', () => {
    const upstream = stapeRegistrations(context)
    const expected = [...upstream].flatMap(([name, { config }]) => (actionsOf(config) ?? [null]).map((a) => `${name}:${a}`))
    const classified = SERVED.flatMap((tool) => (tool.actions ?? [null]).map((a) => `${tool.source}:${a}`))
    expect(classified.sort()).toEqual(expected.sort())
  })

  it('serves every classified tool under a unique name', () => {
    const names = SERVED.map((tool) => tool.name)
    expect(new Set(names).size).toBe(names.length)
    expect([...served().keys()].sort()).toEqual([...names].sort())
  })

  it('refuses an action the tool was not cut for', () => {
    const tools = served()
    const tag = { accountId: '1', containerId: '2', workspaceId: '3' }
    expect(tools.get('gtm_tag')!.inputSchema!.safeParse({ ...tag, action: 'list' }).success).toBe(true)
    expect(tools.get('gtm_tag')!.inputSchema!.safeParse({ ...tag, action: 'create' }).success).toBe(false)
    expect(tools.get('gtm_tag_edit')!.inputSchema!.safeParse({ ...tag, action: 'create' }).success).toBe(true)
  })

  it('marks reads read-only and writes destructive', () => {
    const tools = served()
    expect(tools.get('gtm_tag')!.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false })
    expect(tools.get('gtm_version_publish')!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true })
  })
})

describe('foro-tools.json', () => {
  it('is what `npm run manifest` writes', () => {
    const committed = JSON.parse(readFileSync(new URL('../foro-tools.json', import.meta.url), 'utf8'))
    expect(committed).toEqual(toolsManifest(context))
  })

  it('gives every write a scope and no read one', () => {
    for (const tool of toolsManifest(context).tools) expect(tool.writes).toBe('scope' in tool)
  })
})
