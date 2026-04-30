import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseGitHubUrl, discoverSkillsInRepo } from "./repo-import";

// ── parseGitHubUrl ────────────────────────────────────────────────

describe("parseGitHubUrl", () => {
  it("parses full tree URL with path", () => {
    const result = parseGitHubUrl("https://github.com/cloudflare/skills/tree/main/skills");
    expect(result).toEqual({ owner: "cloudflare", repo: "skills", branch: "main", path: "skills" });
  });

  it("parses tree URL without sub-path", () => {
    const result = parseGitHubUrl("https://github.com/owner/repo/tree/main");
    expect(result).toEqual({ owner: "owner", repo: "repo", branch: "main", path: "" });
  });

  it("parses bare owner/repo URL and defaults to main", () => {
    const result = parseGitHubUrl("https://github.com/owner/repo");
    expect(result).toEqual({ owner: "owner", repo: "repo", branch: "main", path: "" });
  });

  it("parses URL with non-main branch", () => {
    const result = parseGitHubUrl("https://github.com/acme/project/tree/develop/packages/skills");
    expect(result).toEqual({ owner: "acme", repo: "project", branch: "develop", path: "packages/skills" });
  });

  it("parses URL with trailing slash", () => {
    const result = parseGitHubUrl("https://github.com/owner/repo/tree/main/dir/");
    expect(result).toEqual({ owner: "owner", repo: "repo", branch: "main", path: "dir" });
  });

  it("returns null for non-github host", () => {
    expect(parseGitHubUrl("https://gitlab.com/owner/repo")).toBeNull();
  });

  it("returns null for invalid URL", () => {
    expect(parseGitHubUrl("not-a-url")).toBeNull();
  });

  it("returns null when missing repo segment", () => {
    expect(parseGitHubUrl("https://github.com/onlyone")).toBeNull();
  });
});

// ── discoverSkillsInRepo (mocked fetch) ───────────────────────────

const TREE_RESPONSE = {
  truncated: false,
  tree: [
    { path: "skills/my-skill", type: "tree", sha: "dir-sha-1" },
    { path: "skills/my-skill/SKILL.md", type: "blob", sha: "blob-sha-1", size: 200 },
    { path: "skills/other-skill", type: "tree", sha: "dir-sha-2" },
    { path: "skills/other-skill/README.md", type: "blob", sha: "blob-sha-2", size: 150 },
    { path: "skills/empty-skill", type: "tree", sha: "dir-sha-3" },
    // no files in empty-skill — should be skipped
    { path: "unrelated-file.md", type: "blob", sha: "blob-sha-x", size: 50 },
  ],
};

const SKILL_MD_CONTENT = `---
name: My Skill
description: Does something great
tags: [ai, automation]
---

# My Skill

A detailed description of this skill.`;

const README_CONTENT = `# Other Skill

A different skill without frontmatter.

More details here.`;

describe("discoverSkillsInRepo", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The implementation now uses the GitHub Blobs API (json with base64 content)
  // for fetching file content, with raw.githubusercontent.com as fallback.
  // mockFetch matches by URL substring: "git/trees" for the tree, "git/blobs" for content.
  function mockFetch(treeResponse: unknown, blobContents: Record<string, string>) {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes("git/trees")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(treeResponse),
        });
      }
      if (url.includes("git/blobs/")) {
        // Extract sha from URL: .../git/blobs/{sha}
        const sha = url.split("git/blobs/")[1];
        const content = blobContents[sha];
        if (content !== undefined) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              content: Buffer.from(content).toString("base64"),
              encoding: "base64",
            }),
          });
        }
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    });
  }

  it("discovers skills from a GitHub repo URL", async () => {
    mockFetch(TREE_RESPONSE, {
      "blob-sha-1": SKILL_MD_CONTENT,
      "blob-sha-2": README_CONTENT,
    });

    const { skills, repoInfo } = await discoverSkillsInRepo(
      "https://github.com/cloudflare/skills/tree/main/skills"
    );

    expect(repoInfo).toEqual({ owner: "cloudflare", repo: "skills", branch: "main", path: "skills" });
    expect(skills).toHaveLength(2);

    const first = skills.find((s) => s.dirName === "my-skill")!;
    expect(first.title).toBe("My Skill");
    expect(first.tagline).toBe("Does something great");
    expect(first.tags).toEqual(["ai", "automation"]);
    expect(first.skillFileUrl).toContain("SKILL.md");
    expect(first.sourceUrl).toContain("github.com");

    const second = skills.find((s) => s.dirName === "other-skill")!;
    expect(second.title).toBe("Other Skill");
    expect(second.tagline).toBe("A different skill without frontmatter.");
  });

  it("skips directories with no markdown files", async () => {
    mockFetch(TREE_RESPONSE, {
      "blob-sha-1": SKILL_MD_CONTENT,
      "blob-sha-2": README_CONTENT,
    });

    const { skills } = await discoverSkillsInRepo(
      "https://github.com/cloudflare/skills/tree/main/skills"
    );

    expect(skills.find((s) => s.dirName === "empty-skill")).toBeUndefined();
  });

  it("prefers SKILL.md over README.md", async () => {
    const treeWithBoth = {
      truncated: false,
      tree: [
        { path: "skills/dual", type: "tree", sha: "dir-dual" },
        { path: "skills/dual/SKILL.md", type: "blob", sha: "sha-skill" },
        { path: "skills/dual/README.md", type: "blob", sha: "sha-readme" },
      ],
    };

    mockFetch(treeWithBoth, {
      "sha-skill": "---\nname: From Skill MD\n---\n\nContent",
      "sha-readme": "# From Readme\n\nShould not be used",
    });

    const { skills } = await discoverSkillsInRepo(
      "https://github.com/owner/repo/tree/main/skills"
    );

    expect(skills[0].title).toBe("From Skill MD");
  });

  it("throws on invalid GitHub URL", async () => {
    await expect(discoverSkillsInRepo("https://gitlab.com/foo/bar")).rejects.toThrow(
      "Invalid GitHub URL"
    );
  });

  it("throws when GitHub API returns 404", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({}),
    });

    await expect(
      discoverSkillsInRepo("https://github.com/owner/repo/tree/main/skills")
    ).rejects.toThrow("not found");
  });

  it("throws when no skill directories are found", async () => {
    mockFetch({ truncated: false, tree: [] }, {});

    await expect(
      discoverSkillsInRepo("https://github.com/owner/repo/tree/main/skills")
    ).rejects.toThrow("No skill directories found");
  });

  it("falls back to directory name as title when no heading or frontmatter", async () => {
    const treeNoMeta = {
      truncated: false,
      tree: [
        { path: "skills/my-cool-skill", type: "tree", sha: "dir-sha" },
        { path: "skills/my-cool-skill/SKILL.md", type: "blob", sha: "blob-sha-plain" },
      ],
    };

    mockFetch(treeNoMeta, {
      "blob-sha-plain": "Just some plain text with no heading or frontmatter.",
    });

    const { skills } = await discoverSkillsInRepo(
      "https://github.com/owner/repo/tree/main/skills"
    );

    expect(skills[0].title).toBe("My Cool Skill");
  });

  it("reports truncated flag from GitHub", async () => {
    mockFetch(
      { truncated: true, tree: [
        { path: "skills/a", type: "tree", sha: "dir-a" },
        { path: "skills/a/SKILL.md", type: "blob", sha: "blob-a" },
      ]},
      { "blob-a": "# Skill A\n\nDescription." }
    );

    const { truncated } = await discoverSkillsInRepo(
      "https://github.com/owner/repo/tree/main/skills"
    );

    expect(truncated).toBe(true);
  });
});
