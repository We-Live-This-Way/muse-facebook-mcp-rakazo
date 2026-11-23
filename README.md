# Facebook Page MCP server (HTTP, for a Rakazo bot)

A small MCP server that lets a Rakazo bot work with a Facebook Page through
the Graph API — unpublished drafts, plus one gated publish. Same tools and
same rules as the stdio MausBot version in the companion
`muse-facebook-mcp-draft` repo; only the transport differs. Built by Muse-proto.

This tree is the HTTP server itself. Registering it with a specific bot is
left to the operator.

## Rules

- **Drafts by default.** The only writes are create / edit / delete of
  *unpublished drafts*. `create_draft` hard-codes `published: false` and takes
  no parameter that can change it. `edit_draft` / `delete_draft` first verify
  the post is an unpublished draft on the configured Page and refuse anything
  published.
- **`publish_draft` is gated, not open.** It takes ONLY a draft post id — no
  text or message parameter, so it cannot invent or post new content. It first
  verifies the post is an unpublished draft on the configured Page and refuses
  anything already published or not on that Page. Use it only after the page
  owner has explicitly approved that specific draft.
- There is **no** schedule, reply, comment, hide, or delete-live-post code
  anywhere in this repo. Nothing here can schedule a post, reply to one, or
  delete a live post.
- The page owner approves every post before it goes live — either by approving
  a specific draft for `publish_draft`, or by publishing it in Facebook.

## Tools

| Tool | What it does |
|---|---|
| `read_page_posts` | Latest posts on the Page (published + drafts). Read-only. |
| `read_page_drafts` | Unpublished draft posts. Read-only. |
| `create_draft` | Create a draft post (never published). |
| `edit_draft` | Edit a draft's text (refuses published posts). |
| `delete_draft` | Delete a draft (refuses published posts). |
| `publish_draft` | Publish ONE existing draft, id only, only after the page owner approves that draft (refuses published posts and posts not on this Page). |
| `search_ads` | Search the Meta Ad Library for businesses running ads (warm leads). Read-only. |

## How drafts are listed

Facebook has no working "list drafts" edge, and `/feed` only returns published
posts, so an unpublished draft is invisible to the API's feed. This wrapper
remembers every draft it creates in `drafts.json` (next to `.env`, mode 600,
never committed — it holds post ids and message snippets only, no tokens).
`read_page_drafts` re-checks each recorded id directly and prunes ids that come
back published or gone. `edit_draft` updates the stored snippet; `delete_draft`
and `publish_draft` remove the id from the record. Drafts created before this
record existed (or by anything else) will not appear in `read_page_drafts`
until they are re-created through this wrapper.

## Config

Copy `.env.example` to `.env` (mode 600, never committed) and fill in:

- `FB_MCP_BEARER` — HTTP bearer secret for `/mcp`. The endpoint requires
  `Authorization: Bearer <your-mcp-bearer-secret>`. `/health` is public
  liveness only.
- `FB_PAGE_ID`, `FB_PAGE_TOKEN` (never-expiring Page token),
  `FB_LONG_TOKEN` (long-lived user token, ~60 days)

Facebook credentials may instead live in a second `.env` file pointed at by
`FB_SHARED_ENV` (for example the `.env` next to `muse-facebook-mcp-draft`).
Values in this directory's `.env` win if both are set.

## Run

```
npm install
npm start          # http://127.0.0.1:8891/mcp (localhost only)
```

Endpoints: `GET /health` → `{ok, service, tools}`; `POST /mcp` → MCP
(Streamable HTTP, stateless, bearer required).

## Registering a Rakazo bot

The server listens on `http://127.0.0.1:8891/mcp`, speaks Streamable HTTP, and
needs the `Authorization: Bearer <FB_MCP_BEARER>` header (value in this
directory's `.env`). Register it in Rakazo as an HTTP MCP server with that URL
and header, then confirm the bot lists the seven tools above. Keep the server
running while any bot uses it (a user service is the durable way to do that).
