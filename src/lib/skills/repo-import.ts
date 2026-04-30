/**
 * GitHub repository skill discovery.
 *
 * Uses the GitHub Trees API (one request) to find all skill directories,
 * then fetches raw file content for metadata extraction.
 */

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_RAW_BASE = "https://raw.githubusercontent.com";
const FETCH_TIMEOUT_MS = 15_000;
const GITHUB_HEADERS = {
  Accept: "application/vnd.github.v3+json",
  "User-Agent": "ugig.net/SkillImporter",
};

export interface RepoSkillPreview {
  dirName: string;
  title: string;
  tagline: string;
  description: string;
  tags: string[];
  skillFileUrl: string;
  sourceUrl: string;
}

export interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  branch: string;
  path: string;
}

/**
 * Parse a GitHub tree URL into owner/repo/branch/path components.
 * Supports https://github.com/owner/repo/tree/branch/path and
 * https://github.com/owner/repo (defaults to main, empty path).
 */
export function parseGitHubUrl(url: string): ParsedGitHubUrl | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") return null;

    const parts = parsed.pathname.replace(/^\/|\/$/g, "").split("/");
    if (parts.length < 2) return null;

    const [owner, repo, maybeTree, branch, ...pathParts] = parts;

    if (maybeTree === "tree") {
      return { owner, repo, branch: branch || "main", path: pathParts.join("/") };
    }

    return { owner, repo, branch: "main", path: "" };
  } catch {
    return null;
  }
}

interface GitHubTreeNode {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
}

interface GitHubTreeResponse {
  tree: GitHubTreeNode[];
  truncated: boolean;
}

async function githubGet<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: GITHUB_HEADERS,
  });

  if (!res.ok) {
    if (res.status === 403) throw new Error("GitHub API rate limit exceeded — try again later.");
    if (res.status === 404) throw new Error("Repository or branch not found. Check the URL.");
    throw new Error(`GitHub API error: ${res.status}`);
  }

  return res.json();
}

async function fetchGitHubTree(
  owner: string,
  repo: string,
  branch: string
): Promise<GitHubTreeResponse> {
  return githubGet(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`
  );
}

/**
 * Fetch blob content via the GitHub Blobs API (base64-decoded).
 * Falls back to raw.githubusercontent.com if the blob API fails.
 */
async function fetchBlobContent(
  owner: string,
  repo: string,
  branch: string,
  sha: string,
  filePath: string
): Promise<string | null> {
  // Primary: GitHub Blobs API (same host as tree call, consistent auth)
  try {
    const blob = await githubGet<{ content: string; encoding: string }>(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/blobs/${sha}`
    );
    if (blob.encoding === "base64") {
      const text = Buffer.from(blob.content.replace(/\n/g, ""), "base64").toString("utf8");
      return text.length > 100_000 ? text.slice(0, 100_000) : text;
    }
    if (blob.encoding === "utf-8") {
      return blob.content.length > 100_000 ? blob.content.slice(0, 100_000) : blob.content;
    }
  } catch {
    // fall through to raw fallback
  }

  // Fallback: raw.githubusercontent.com
  try {
    const rawUrl = `${GITHUB_RAW_BASE}/${owner}/${repo}/${branch}/${filePath}`;
    const res = await fetch(rawUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "ugig.net/SkillImporter" },
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > 100_000 ? text.slice(0, 100_000) : text;
  } catch {
    return null;
  }
}

/**
 * Parse YAML frontmatter from markdown content.
 * Handles simple scalar values and inline arrays ([a, b, c]).
 */
function parseFrontmatter(content: string): {
  data: Record<string, unknown>;
  body: string;
} {
  const fm: Record<string, unknown> = {};

  if (!content.startsWith("---")) {
    return { data: fm, body: content };
  }

  const end = content.indexOf("\n---", 3);
  if (end === -1) return { data: fm, body: content };

  const yaml = content.slice(3, end).trim();
  const body = content.slice(end + 4).trim();

  for (const line of yaml.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();

    if (val.startsWith("[") && val.endsWith("]")) {
      fm[key] = val
        .slice(1, -1)
        .split(",")
        .map((t) => t.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    } else {
      fm[key] = val.replace(/^['"]|['"]$/g, "");
    }
  }

  return { data: fm, body };
}

function extractTitle(content: string, dirName: string): string {
  const h1 = content.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  return dirName.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractTagline(content: string): string {
  let afterHeading = false;
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("#")) {
      afterHeading = true;
      continue;
    }
    if (t.startsWith("---") || t.startsWith("```")) continue;
    if (afterHeading) return t.slice(0, 200);
  }
  return "";
}

function parseSkillContent(
  content: string,
  dirName: string
): Omit<RepoSkillPreview, "skillFileUrl" | "sourceUrl" | "dirName"> {
  const { data: fm, body } = parseFrontmatter(content);

  const title = String(
    fm.name || fm.title || extractTitle(body || content, dirName)
  ).slice(0, 120);

  const tagline = String(
    fm.description || fm.tagline || extractTagline(body || content)
  ).slice(0, 200);

  const fullDescription = (body || content).trim();
  const description = fullDescription.length >= 10
    ? fullDescription.slice(0, 10000)
    : `Skill: ${title}`;

  let tags: string[] = [];
  if (Array.isArray(fm.tags)) {
    tags = (fm.tags as unknown[]).map(String).slice(0, 10);
  } else if (typeof fm.tags === "string" && fm.tags) {
    tags = (fm.tags as string)
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 10);
  }

  return { title, tagline, description, tags };
}

const SKILL_FILE_PRIORITY = ["skill.md", "skills.md", "readme.md"];

/**
 * Discover all skills in a GitHub repo directory.
 * Uses the Trees API (1 API call) + raw content fetches (1 per skill).
 */
export async function discoverSkillsInRepo(repoUrl: string): Promise<{
  skills: RepoSkillPreview[];
  repoInfo: ParsedGitHubUrl;
  truncated: boolean;
}> {
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) {
    throw new Error(
      "Invalid GitHub URL. Expected: https://github.com/owner/repo/tree/branch/path"
    );
  }

  const { owner, repo, branch, path } = parsed;
  const basePath = path ? path.replace(/\/$/, "") : "";

  const treeData = await fetchGitHubTree(owner, repo, branch);

  // Find direct subdirectory children of basePath
  const directChildDirs = new Set<string>();
  // Store { path, sha } for blobs, keyed by parent dir path
  const filesByDir = new Map<string, Array<{ path: string; sha: string }>>();

  for (const node of treeData.tree) {
    const nodePath = node.path;

    if (node.type === "tree") {
      const relative = basePath ? nodePath.slice(basePath.length + 1) : nodePath;
      if (!relative.includes("/") && (!basePath || nodePath.startsWith(basePath + "/"))) {
        if (basePath ? nodePath !== basePath : true) {
          directChildDirs.add(nodePath);
        }
      }
    } else if (node.type === "blob") {
      const parentDir = nodePath.substring(0, nodePath.lastIndexOf("/"));
      if (!filesByDir.has(parentDir)) filesByDir.set(parentDir, []);
      filesByDir.get(parentDir)!.push({ path: nodePath, sha: node.sha });
    }
  }

  if (directChildDirs.size === 0) {
    throw new Error(
      "No skill directories found at this path. Make sure the URL points to a folder containing skill subdirectories."
    );
  }

  const dirs = Array.from(directChildDirs).slice(0, 50);

  const skillPromises = dirs.map(async (dirPath): Promise<RepoSkillPreview | null> => {
    const dirName = dirPath.split("/").pop() || dirPath;
    const blobs = filesByDir.get(dirPath) || [];

    if (blobs.length === 0) return null;

    // Case-insensitive priority match, preserving original path + sha
    const skillBlob =
      blobs.find((b) => b.path.split("/").pop()!.toUpperCase() === "SKILL.MD") ||
      blobs.find((b) => b.path.split("/").pop()!.toLowerCase() === "readme.md") ||
      blobs.find((b) => b.path.split("/").pop()!.toLowerCase().endsWith(".md"));

    if (!skillBlob) return null;

    const content = await fetchBlobContent(owner, repo, branch, skillBlob.sha, skillBlob.path);
    if (!content) return null;

    const meta = parseSkillContent(content, dirName);
    const rawUrl = `${GITHUB_RAW_BASE}/${owner}/${repo}/${branch}/${skillBlob.path}`;

    return {
      dirName,
      ...meta,
      skillFileUrl: rawUrl,
      sourceUrl: `https://github.com/${owner}/${repo}/tree/${branch}/${dirPath}`,
    };
  });

  const results = await Promise.allSettled(skillPromises);
  const skills = results
    .filter((r): r is PromiseFulfilledResult<RepoSkillPreview> => r.status === "fulfilled" && r.value !== null)
    .map((r) => r.value);

  return { skills, repoInfo: parsed, truncated: treeData.truncated };
}
