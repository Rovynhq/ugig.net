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
    { path: "skills/my-skill", type: "tree" },
    { path: "skills/my-skill/SKILL.md", type: "blob", size: 200 },
    { path: "skills/other-skill", type: "tree" },
    { path: "skills/other-skill/README.md", type: "blob", size: 150 },
    { path: "skills/empty-skill", type: "tree" },
    // no files in empty-skill — should be skipped
    { path: "unrelated-file.md", type: "blob", size: 50 },
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

  function mockFetch(urlPatterns: Record<string, unknown>) {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      for (const [pattern, body] of Object.entries(urlPatterns)) {
        if (url.includes(pattern)) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(body),
            text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
          });
        }
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    });
  }

  it("discovers skills from a GitHub repo URL", async () => {
    mockFetch({
      "git/trees": TREE_RESPONSE,
      "my-skill/SKILL.md": SKILL_MD_CONTENT,
      "other-skill/README.md": README_CONTENT,
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
    mockFetch({
      "git/trees": TREE_RESPONSE,
      "my-skill/SKILL.md": SKILL_MD_CONTENT,
      "other-skill/README.md": README_CONTENT,
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
        { path: "skills/dual", type: "tree" },
        { path: "skills/dual/SKILL.md", type: "blob" },
        { path: "skills/dual/README.md", type: "blob" },
      ],
    };

    mockFetch({
      "git/trees": treeWithBoth,
      "dual/SKILL.md": "---\nname: From Skill MD\n---\n\nContent",
      "dual/README.md": "# From Readme\n\nShould not be used",
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
    mockFetch({
      "git/trees": { truncated: false, tree: [] },
    });

    await expect(
      discoverSkillsInRepo("https://github.com/owner/repo/tree/main/skills")
    ).rejects.toThrow("No skill directories found");
  });

  it("falls back to directory name as title when no heading or frontmatter", async () => {
    const treeNoMeta = {
      truncated: false,
      tree: [
        { path: "skills/my-cool-skill", type: "tree" },
        { path: "skills/my-cool-skill/SKILL.md", type: "blob" },
      ],
    };

    mockFetch({
      "git/trees": treeNoMeta,
      "my-cool-skill/SKILL.md": "Just some plain text with no heading or frontmatter.",
    });

    const { skills } = await discoverSkillsInRepo(
      "https://github.com/owner/repo/tree/main/skills"
    );

    expect(skills[0].title).toBe("My Cool Skill");
  });

  it("reports truncated flag from GitHub", async () => {
    mockFetch({
      "git/trees": { truncated: true, tree: [
        { path: "skills/a", type: "tree" },
        { path: "skills/a/SKILL.md", type: "blob" },
      ]},
      "a/SKILL.md": "# Skill A\n\nDescription.",
    });

    const { truncated } = await discoverSkillsInRepo(
      "https://github.com/owner/repo/tree/main/skills"
    );

    expect(truncated).toBe(true);
  });
});
