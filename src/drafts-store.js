// Local record of drafts this wrapper created.
//
// Facebook has no working "list drafts" edge (/promotable_posts is gone and
// /feed only returns published posts), so an unpublished draft is invisible
// to read_page_drafts unless this wrapper remembers the id it got back from
// create_draft. This file is that memory: post id + created time + the first
// 80 characters of the message (for display only).
//
// Runtime state, not code: never commit drafts.json to git (see .gitignore).
// It holds post ids and message snippets only — no tokens, no secrets.
import { readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const STORE_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "drafts.json");
const SNIPPET_LEN = 80;

function load() {
  try {
    if (!existsSync(STORE_PATH)) return [];
    const parsed = JSON.parse(readFileSync(STORE_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed.filter((d) => d && typeof d.id === "string") : [];
  } catch {
    return [];
  }
}

function save(list) {
  writeFileSync(STORE_PATH, JSON.stringify(list, null, 2) + "\n", "utf8");
  try {
    chmodSync(STORE_PATH, 0o600);
  } catch {
    // Best effort; the file keeps whatever permissions it already had.
  }
}

export function recordDraft({ postId, message, createdTime }) {
  const list = load().filter((d) => d.id !== postId);
  list.unshift({
    id: postId,
    message: (message || "").slice(0, SNIPPET_LEN),
    created_time: createdTime || new Date().toISOString(),
  });
  save(list);
}

export function updateDraftSnippet({ postId, message }) {
  const list = load();
  const entry = list.find((d) => d.id === postId);
  if (entry) {
    entry.message = (message || "").slice(0, SNIPPET_LEN);
    save(list);
  }
}

export function forgetDraft(postId) {
  save(load().filter((d) => d.id !== postId));
}

export function listDrafts() {
  return load();
}

export function replaceDrafts(list) {
  save(list);
}
