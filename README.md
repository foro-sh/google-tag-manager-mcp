# Google Tag Manager MCP

An [MCP](https://modelcontextprotocol.io) server for Google Tag Manager, built to deploy on
[foro.sh](https://foro.sh) as the Google Tag Manager blueprint. The tools are
[Stape's](https://github.com/stape-io/google-tag-manager-mcp-server) (`google-tag-manager-mcp-core`,
Apache-2.0), served unchanged behind foro's gate. Stape is not affiliated with foro; see `NOTICE`.

## Read-only by default

Stape registers one tool per resource, with an `action` that mixes reads and writes (`gtm_tag`
creates, lists and deletes tags). foro allows or blocks whole tools and asks Google only for the
scopes the allowed tools need, so this server splits each one:

- `gtm_tag` keeps the read actions (`get`, `list`) and needs only `tagmanager.readonly`.
- `gtm_tag_edit` takes `create`, `update`, `remove`, `revert` and needs `tagmanager.edit.containers`.
- Actions that need another scope get their own tool: `gtm_version_publish` (`tagmanager.publish`),
  `gtm_container_delete` (`tagmanager.delete.containers`), and so on.

[`tools.ts`](tools.ts) is the whole table. Each scope is the narrowest Google's
[discovery document](https://tagmanager.googleapis.com/$discovery/rest?version=v2) accepts for the
method behind the action. A Stape tool or action not in the table is not served, and the tests fail
until it is classified, so an upstream release can't slip a write in as a read.

[`foro-tools.json`](foro-tools.json) is what foro reads to tell reads from writes and to pick the
scopes. It is generated: run `npm run manifest` after changing `tools.ts`.

## Sign-in

The server holds no OAuth of its own. foro signs each member in to Google with foro's own Google
client and keeps the refresh token; per call, the server asks foro's upstream broker for the
caller's access token under the `google` grant ([`broker.ts`](broker.ts)). It only runs inside a
foro deploy, which sets `FORO_UPSTREAM_BROKER_URL` and `FORO_UPSTREAM_BROKER_TOKEN`.

## Development

```sh
npm install
npm test
```

Updating Stape: bump `google-tag-manager-mcp-core` in `package.json`, run `npm test`, classify any
new tool or action in `tools.ts`, then `npm run manifest`.
