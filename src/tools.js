// Tool definitions shared by the stdio (MausBot) and HTTP (Rakazo) servers.
// Writes: create/edit/delete of unpublished drafts, plus publish_draft —
// which only flips ONE existing unpublished draft on our Page to published,
// takes a draft id only (no text), and is only used when the page owner has
// explicitly approved that specific draft. Nothing here can schedule, reply
// to, hide, or delete a live post.
import { z } from "zod";
import {
  readPagePosts,
  readPageDrafts,
  createDraft,
  editDraft,
  deleteDraft,
  publishDraft,
  searchAds,
} from "./graph.js";

const text = (s) => ({ content: [{ type: "text", text: s }] });
const json = (o) => text(JSON.stringify(o, null, 2));
const fail = (e) => text(`Error: ${e && e.message ? e.message : String(e)}`);

export const TOOL_NAMES = [
  "read_page_posts",
  "read_page_drafts",
  "create_draft",
  "edit_draft",
  "delete_draft",
  "publish_draft",
  "search_ads",
];

export function registerTools(server, cfg) {
  const { pageToken, pageId, userToken } = cfg;

  server.tool(
    "read_page_posts",
    "Read the latest posts on the configured Facebook Page (published posts and drafts). Read-only.",
    { limit: z.number().int().min(1).max(25).optional().describe("How many posts to return (default 10).") },
    async ({ limit = 10 }) => {
      try {
        return json(await readPagePosts({ pageToken, pageId, limit }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "read_page_drafts",
    "List the unpublished DRAFT posts on the configured Facebook Page. Read-only.",
    { limit: z.number().int().min(1).max(25).optional().describe("How many drafts to return (default 10).") },
    async ({ limit = 10 }) => {
      try {
        return json(await readPageDrafts({ pageToken, pageId, limit }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "create_draft",
    "Create a DRAFT post on the configured Facebook Page. The draft is NEVER published by this tool — it is created unpublished and stays a draft until the page owner explicitly approves that specific draft for publishing (via publish_draft) or publishes it in Facebook.",
    { message: z.string().min(1).max(5000).describe("The full text of the draft post.") },
    async ({ message }) => {
      try {
        const r = await createDraft({ pageToken, pageId, message });
        return json({ ...r, note: "Draft created, NOT published. Publish only via publish_draft with the page owner's approval for this draft, or in Facebook." });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "edit_draft",
    "Edit the text of an unpublished DRAFT post. Refuses to touch a published post.",
    {
      post_id: z.string().describe("The draft post id returned by create_draft or read_page_drafts."),
      message: z.string().min(1).max(5000).describe("The new full text of the draft post."),
    },
    async ({ post_id, message }) => {
      try {
        return json(await editDraft({ pageToken, pageId, postId: post_id, message }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "delete_draft",
    "Delete an unpublished DRAFT post. Refuses to touch a published post.",
    { post_id: z.string().describe("The draft post id returned by create_draft or read_page_drafts.") },
    async ({ post_id }) => {
      try {
        return json(await deleteDraft({ pageToken, pageId, postId: post_id }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "publish_draft",
    "Publish an existing unpublished DRAFT post on the configured Facebook Page — ONLY when the page owner has explicitly approved that specific draft. Takes ONLY the draft post id; it has no text or message parameter, so it cannot create or invent content — it only flips that one existing draft to published. Refuses anything already published or not on this Page.",
    { post_id: z.string().describe("The draft post id returned by create_draft or read_page_drafts. Must be an unpublished draft on this Page.") },
    async ({ post_id }) => {
      try {
        return json(await publishDraft({ pageToken, pageId, postId: post_id }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "search_ads",
    "Search the Meta Ad Library for businesses running Facebook ads (warm leads: a business paying for ads is spending on customers). Read-only. Returns the Page name/id and ad text for each match.",
    {
      search_terms: z.string().min(1).describe("What to search for, e.g. 'pharmacy Boca Raton' or 'auto repair'."),
      limit: z.number().int().min(1).max(25).optional().describe("How many ads to return (default 10)."),
    },
    async ({ search_terms, limit = 10 }) => {
      try {
        return json(await searchAds({ userToken, searchTerms: search_terms, limit }));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
