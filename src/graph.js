// Facebook Graph API client — drafts + one gated publish.
//
// The ONLY write operations in this file are:
//   POST /{page-id}/feed   with published:false hard-coded (create a draft)
//   POST /{post-id}        with a new message, only after verifying the post is
//                          an unpublished draft on our Page (edit a draft)
//   DELETE /{post-id}      only after the same draft check (delete a draft)
//   POST /{post-id}        with is_published:true, only after the same draft
//                          check AND only with a draft id (publish a draft).
//                          The publish tool takes NO message/text parameter, so
//                          it cannot invent or post new content — it only flips
//                          one existing draft live, and only when the page owner has
//                          explicitly approved that specific draft.
//
// There is deliberately NO schedule, reply, comment, hide, or
// delete-live-post code anywhere in this file. The create_draft tool takes no
// "published"/"scheduled" parameter at all, so no caller can flip it except
// through publish_draft, which itself refuses anything already published or
// not on this Page.
//
// Draft listing: Facebook has no working "list drafts" edge and /feed only
// returns published posts, so read_page_drafts also consults the local record
// of drafts this wrapper created (drafts.json, via drafts-store.js). That
// file is runtime state, never committed; it holds post ids + message
// snippets only, no tokens or secrets.

import {
  recordDraft,
  updateDraftSnippet,
  forgetDraft,
  listDrafts,
  replaceDrafts,
} from "./drafts-store.js";

const API = "https://graph.facebook.com/v21.0";

function graphError(data) {
  const e = data && data.error;
  if (e) return `Facebook API error ${e.code || ""}: ${e.message || "unknown"}`.trim();
  return null;
}

async function call({ token, path, method = "GET", params = null, body = null }) {
  const url = new URL(API + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  const err = graphError(data);
  if (err) throw new Error(err);
  return data;
}

// --- reads ---------------------------------------------------------------

export async function readPagePosts({ pageToken, pageId, limit = 10 }) {
  const data = await call({
    token: pageToken,
    path: `/${pageId}/feed`,
    params: {
      fields: "id,message,created_time,is_published,permalink_url",
      limit,
    },
  });
  return (data.data || []).map((p) => ({
    id: p.id,
    message: p.message || "",
    created_time: p.created_time,
    is_published: p.is_published,
    url: p.permalink_url || "",
  }));
}

export async function readPageDrafts({ pageToken, pageId, limit = 10 }) {
  // There is no working "list drafts" edge: /{page-id}/promotable_posts no
  // longer exists (error 100 on v18 and v21), and /feed ignores an
  // is_published filter — worse, /feed only returns published posts, so an
  // unpublished draft never appears in it at all. So we list drafts two ways:
  //   (a) the /feed filter, kept as a bonus in case Facebook ever returns an
  //       unpublished post there, and
  //   (b) the local record of drafts this wrapper created (drafts.json):
  //       each recorded id is fetched directly and included while it is
  //       still an unpublished draft on our Page. Ids that come back
  //       published, not ours, or gone (404) are pruned from the record.
  const found = new Map();

  // (a) /feed, as before.
  let feedError = null;
  try {
    const data = await call({
      token: pageToken,
      path: `/${pageId}/feed`,
      params: {
        fields: "id,message,created_time,is_published,permalink_url",
        limit: Math.max(limit, 25),
      },
    });
    for (const p of data.data || []) {
      if (p.is_published === false) {
        found.set(p.id, {
          id: p.id,
          message: p.message || "",
          created_time: p.created_time,
          url: p.permalink_url || "",
        });
      }
    }
  } catch (e) {
    // If the feed read fails, the local record below still answers.
    feedError = e;
  }

  // (b) recorded drafts, fetched directly.
  const recorded = listDrafts();
  const kept = [];
  let lookupError = null;
  let lookupFailed = 0;
  for (const rec of recorded) {
    try {
      const p = await call({
        token: pageToken,
        path: `/${rec.id}`,
        params: { fields: "id,is_published,from,message,created_time,permalink_url" },
      });
      if (p.is_published !== false) continue; // published — prune.
      if (!p.from || String(p.from.id) !== String(pageId)) continue; // not ours — prune.
      kept.push(rec);
      if (!found.has(p.id)) {
        found.set(p.id, {
          id: p.id,
          message: p.message || rec.message || "",
          created_time: p.created_time || rec.created_time,
          url: p.permalink_url || "",
        });
      }
    } catch (e) {
      const msg = String(e && e.message ? e.message : "");
      if (/error 100\b/.test(msg) || /error 803\b/.test(msg) || /does not exist/.test(msg)) {
        continue; // gone (deleted / never existed) — prune.
      }
      // Any other error (network, rate limit, bad token) — keep the record
      // so a transient failure doesn't wipe the draft list.
      lookupFailed += 1;
      if (!lookupError) lookupError = e;
      kept.push(rec);
    }
  }
  if (kept.length !== recorded.length) replaceDrafts(kept);

  // If nothing worked at all, surface the failure instead of an empty list:
  // a dead token or outage should read as an error, not as "no drafts".
  if (found.size === 0) {
    if (feedError && (recorded.length === 0 || lookupFailed === recorded.length)) throw feedError;
    if (recorded.length > 0 && lookupFailed === recorded.length && lookupError) throw lookupError;
  }

  return [...found.values()]
    .sort((a, b) => String(b.created_time || "").localeCompare(String(a.created_time || "")))
    .slice(0, limit);
}

// --- draft guard: a post must be an unpublished draft on OUR page --------

async function assertDraft({ pageToken, pageId, postId }) {
  const post = await call({
    token: pageToken,
    path: `/${postId}`,
    params: { fields: "id,is_published,from,permalink_url" },
  });
  if (post.is_published !== false) {
    throw new Error(`refused: post ${postId} is published, not a draft`);
  }
  if (!post.from || String(post.from.id) !== String(pageId)) {
    throw new Error(`refused: post ${postId} does not belong to this Page`);
  }
  return post;
}

// --- draft writes (the only writes that exist) ---------------------------

export async function createDraft({ pageToken, pageId, message }) {
  // published:false is hard-coded. There is no parameter to change it.
  const data = await call({
    token: pageToken,
    path: `/${pageId}/feed`,
    method: "POST",
    body: { message, published: false },
  });
  // Record it locally: /feed never lists unpublished drafts, so this file is
  // how read_page_drafts finds drafts this wrapper created.
  recordDraft({ postId: data.id, message, createdTime: new Date().toISOString() });
  return { draft_post_id: data.id };
}

export async function editDraft({ pageToken, pageId, postId, message }) {
  await assertDraft({ pageToken, pageId, postId });
  const data = await call({
    token: pageToken,
    path: `/${postId}`,
    method: "POST",
    body: { message },
  });
  updateDraftSnippet({ postId, message });
  return { draft_post_id: postId, updated: Boolean(data.success) };
}

export async function deleteDraft({ pageToken, pageId, postId }) {
  await assertDraft({ pageToken, pageId, postId });
  const data = await call({
    token: pageToken,
    path: `/${postId}`,
    method: "DELETE",
  });
  if (data.success) forgetDraft(postId);
  return { draft_post_id: postId, deleted: Boolean(data.success) };
}

export async function publishDraft({ pageToken, pageId, postId }) {
  // Guard first: only an unpublished draft on our Page can be published.
  // This takes a draft id only — there is no message/text parameter, so it
  // cannot invent or post new content; it only flips that one existing
  // draft live. The page owner must explicitly approve that specific draft first.
  const post = await assertDraft({ pageToken, pageId, postId });
  const data = await call({
    token: pageToken,
    path: `/${postId}`,
    method: "POST",
    body: { is_published: true },
  });
  if (!data.success) {
    throw new Error(`refused: Facebook did not confirm publishing ${postId}`);
  }
  forgetDraft(postId);
  // Re-read for the live permalink (a draft's URL can differ once published).
  let url = post.permalink_url || "";
  try {
    const live = await call({
      token: pageToken,
      path: `/${postId}`,
      params: { fields: "id,is_published,permalink_url" },
    });
    if (live.permalink_url) url = live.permalink_url;
  } catch {
    // Keep the draft URL if the re-read fails; the publish already succeeded.
  }
  return { post_id: postId, published: true, url };
}

// --- Ad Library (read-only; interim lead route) --------------------------

export async function searchAds({ userToken, searchTerms, limit = 10 }) {
  const data = await call({
    token: userToken,
    path: "/ads_archive",
    params: {
      search_terms: searchTerms,
      ad_reached_countries: JSON.stringify(["US"]),
      ad_active_status: "ALL",
      ad_type: "ALL",
      fields: "page_id,page_name,ad_creative_body,ad_snapshot_url,ad_delivery_start_time,ad_delivery_stop_time",
      limit,
    },
  });
  return (data.data || []).map((a) => ({
    page_id: a.page_id,
    page_name: a.page_name,
    ad_text: a.ad_creative_body || "",
    ad_url: a.ad_snapshot_url || "",
    started: a.ad_delivery_start_time || "",
    stopped: a.ad_delivery_stop_time || "",
  }));
}
