import type { McpServer } from '@modelcontextprotocol/server'
import { tools as stapeTools, type GtmToolContext } from 'google-tag-manager-mcp-core'
import { z } from 'zod'

// Stape registers one tool per GTM resource with an `action` argument that mixes
// reads and writes. foro's gate allows or blocks whole tools, and Google is asked
// only for the scopes the allowed tools need, so each Stape tool is served here
// as a read tool plus one tool per Google scope its other actions need. Scopes
// are the narrowest each API method accepts, from Google's discovery document
// (https://tagmanager.googleapis.com/$discovery/rest?version=v2).

const SCOPE = 'https://www.googleapis.com/auth/tagmanager.'
const EDIT = `${SCOPE}edit.containers`
const VERSIONS = `${SCOPE}edit.containerversions`
const DELETE = `${SCOPE}delete.containers`
const PUBLISH = `${SCOPE}publish`
const ACCOUNTS = `${SCOPE}manage.accounts`
const USERS = `${SCOPE}manage.users`

export interface ServedTool {
  name: string
  label: string
  /** Stape's tool it is cut from. */
  source: string
  /** The `action` values it accepts; null for a Stape tool without one. */
  actions: string[] | null
  /** The Google scope it needs beyond `tagmanager.readonly`; absent on a read. */
  scope?: string
}

const crud = (source: string, noun: string, extraReads: string[] = [], extraEdits: string[] = []): ServedTool[] => [
  { name: source, label: `Read ${noun}`, source, actions: ['get', 'list', ...extraReads] },
  {
    name: `${source}_edit`,
    label: `Change ${noun}`,
    source,
    actions: ['create', 'update', 'remove', 'revert', ...extraEdits],
    scope: EDIT,
  },
]

export const SERVED: ServedTool[] = [
  { name: 'gtm_account', label: 'Read accounts', source: 'gtm_account', actions: ['get', 'list'] },
  { name: 'gtm_account_update', label: 'Rename accounts', source: 'gtm_account', actions: ['update'], scope: ACCOUNTS },
  { name: 'gtm_auth_status', label: 'Check the Google connection', source: 'gtm_auth_status', actions: null },
  { name: 'gtm_built_in_variable', label: 'Read built-in variables', source: 'gtm_built_in_variable', actions: ['list'] },
  {
    name: 'gtm_built_in_variable_edit',
    label: 'Change built-in variables',
    source: 'gtm_built_in_variable',
    actions: ['create', 'remove', 'revert'],
    scope: EDIT,
  },
  ...crud('gtm_client', 'server-side clients'),
  { name: 'gtm_container', label: 'Read containers', source: 'gtm_container', actions: ['get', 'list', 'lookup', 'snippet'] },
  {
    name: 'gtm_container_edit',
    label: 'Change containers',
    source: 'gtm_container',
    actions: ['create', 'update', 'combine', 'moveTagId'],
    scope: EDIT,
  },
  { name: 'gtm_container_delete', label: 'Delete containers', source: 'gtm_container', actions: ['remove'], scope: DELETE },
  { name: 'gtag_destination', label: 'Read Google tag destinations', source: 'gtag_destination', actions: null },
  { name: 'gtm_environment', label: 'Read environments', source: 'gtm_environment', actions: ['get', 'list'] },
  {
    name: 'gtm_environment_edit',
    label: 'Change environments',
    source: 'gtm_environment',
    actions: ['create', 'update', 'remove'],
    scope: EDIT,
  },
  {
    name: 'gtm_environment_reauthorize',
    label: 'Reauthorize environments',
    source: 'gtm_environment',
    actions: ['reauthorize'],
    scope: PUBLISH,
  },
  ...crud('gtm_folder', 'folders', ['entities'], ['moveEntitiesToFolder']),
  { name: 'gtm_gtag_config', label: 'Read Google tag configs', source: 'gtm_gtag_config', actions: ['get', 'list'] },
  {
    name: 'gtm_gtag_config_edit',
    label: 'Change Google tag configs',
    source: 'gtm_gtag_config',
    actions: ['create', 'update', 'remove'],
    scope: EDIT,
  },
  { name: 'gtm_guide', label: 'Read the GTM guides', source: 'gtm_guide', actions: null },
  ...crud('gtm_tag', 'tags'),
  ...crud('gtm_template', 'custom templates', [], ['importFromGallery']),
  ...crud('gtm_transformation', 'transformations'),
  ...crud('gtm_trigger', 'triggers'),
  // Google needs manage.users even to list permissions.
  {
    name: 'gtm_user_permission',
    label: 'Manage user permissions',
    source: 'gtm_user_permission',
    actions: ['create', 'get', 'list', 'update', 'remove'],
    scope: USERS,
  },
  ...crud('gtm_variable', 'variables'),
  { name: 'gtm_version', label: 'Read versions', source: 'gtm_version', actions: ['get', 'live'] },
  {
    name: 'gtm_version_edit',
    label: 'Change and delete versions',
    source: 'gtm_version',
    actions: ['update', 'remove', 'undelete'],
    scope: VERSIONS,
  },
  { name: 'gtm_version_set_latest', label: 'Set the latest version', source: 'gtm_version', actions: ['setLatest'], scope: EDIT },
  { name: 'gtm_version_publish', label: 'Publish a version', source: 'gtm_version', actions: ['publish'], scope: PUBLISH },
  { name: 'gtm_version_header', label: 'Read version history', source: 'gtm_version_header', actions: ['list', 'latest'] },
  { name: 'gtm_workspace', label: 'Read workspaces', source: 'gtm_workspace', actions: ['get', 'list', 'getStatus'] },
  {
    name: 'gtm_workspace_edit',
    label: 'Change workspaces',
    source: 'gtm_workspace',
    actions: ['create', 'update', 'sync', 'resolveConflict', 'bulkUpdate'],
    scope: EDIT,
  },
  { name: 'gtm_workspace_delete', label: 'Delete workspaces', source: 'gtm_workspace', actions: ['remove'], scope: DELETE },
  {
    name: 'gtm_workspace_version',
    label: 'Create versions and previews',
    source: 'gtm_workspace',
    actions: ['createVersion', 'quickPreview'],
    scope: VERSIONS,
  },
  ...crud('gtm_zone', 'zones'),
]

type ToolConfig = { description?: string; inputSchema?: z.ZodObject; annotations?: Record<string, unknown> }
type Handler = (...args: never[]) => unknown

/** Every tool Stape's release registers, as it registers it. */
export function stapeRegistrations(context: GtmToolContext): Map<string, { config: ToolConfig; handler: Handler }> {
  const found = new Map<string, { config: ToolConfig; handler: Handler }>()
  const recorder = {
    registerTool: (name: string, config: ToolConfig, handler: Handler) => void found.set(name, { config, handler }),
  } as unknown as McpServer
  for (const register of stapeTools) register(recorder, context)
  return found
}

export const actionsOf = (config: ToolConfig): string[] | null => {
  const action = config.inputSchema?.shape.action
  return action instanceof z.ZodEnum ? (action.options as string[]) : null
}

/** Registers SERVED on `server`. A Stape tool or action not in SERVED is not
 *  served at all: an upstream addition stays off until it is classified here. */
export function registerTools(server: McpServer, context: GtmToolContext): void {
  const stape = stapeRegistrations(context)
  for (const tool of SERVED) {
    const upstream = stape.get(tool.source)
    if (!upstream) continue
    const { config, handler } = upstream
    const writes = tool.scope !== undefined
    let { inputSchema, description = '' } = config
    if (tool.actions) {
      const offered = actionsOf(config) ?? []
      const actions = tool.actions.filter((action) => offered.includes(action))
      if (actions.length === 0) continue
      inputSchema = inputSchema!.extend({
        action: z.enum(actions as [string, ...string[]]).describe(`The operation to perform: ${actions.join(', ')}.`),
      })
      description = `${description} This tool accepts only these actions: ${actions.join(', ')}.`
    }
    server.registerTool(
      tool.name,
      {
        ...config,
        title: tool.label,
        description,
        inputSchema,
        annotations: { ...config.annotations, readOnlyHint: !writes, destructiveHint: writes },
      } as never,
      handler as never,
    )
  }
}

/** foro-tools.json: what the platform reads to tell reads from writes and to ask
 *  Google for the scopes of the tools a project allows. */
export function toolsManifest(context: GtmToolContext) {
  const stape = stapeRegistrations(context)
  return {
    tools: SERVED.map((tool) => ({
      name: tool.name,
      label: tool.label,
      description: tool.actions
        ? `Actions: ${tool.actions.join(', ')}.`
        : (stape.get(tool.source)?.config.description ?? '').split('. ')[0].replace(/\.?$/, '.'),
      writes: tool.scope !== undefined,
      ...(tool.scope ? { scope: tool.scope } : {}),
    })),
  }
}
