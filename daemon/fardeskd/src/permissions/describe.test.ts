import { describe, expect, it } from "vitest";
import { FardeskError } from "../core/errors.js";
import { DESTRUCTIVE_PATTERNS, SUMMARY_MAX_LENGTH, describeRequest, parseAskUserQuestion } from "./describe.js";

type PatternCase = { positive: string[]; negative: string[] };

const CASES: Record<keyof typeof DESTRUCTIVE_PATTERNS, PatternCase> = {
  rm: {
    positive: ["rm -rf build", "rm -r dir", "rm -f file", "rm file -rf", "rm --recursive dir", "rm -Rf x"],
    negative: ["rm notes.txt", "rm -i notes.txt", "git rm notes.txt"],
  },
  sudo: {
    positive: ["sudo ls", "echo hi && sudo reboot", "sudo -n true"],
    negative: ["echo pseudo", "ls -la"],
  },
  gitForcePush: {
    positive: ["git push --force", "git push -f origin main", "git push origin main --force-with-lease"],
    negative: ["git push origin main", "git push -u origin feature", "git pull --force"],
  },
  gitResetHard: {
    positive: ["git reset --hard", "git reset --hard HEAD~3", "git reset HEAD~1 --hard"],
    negative: ["git reset HEAD file.ts", "git reset --soft HEAD~1"],
  },
  gitCleanForce: {
    positive: ["git clean -f", "git clean -fd", "git clean -d -f"],
    negative: ["git clean -n", "git clean --dry-run"],
  },
  mkfs: {
    positive: ["mkfs /dev/sda1", "mkfs.ext4 /dev/sda1", "echo x; mkfs.vfat /dev/sdb"],
    negative: ["echo mkfsfoo", "ls"],
  },
  dd: {
    positive: ["dd if=/dev/zero of=/dev/sda", "dd of=disk.img", "dd bs=1M of=/dev/disk2 if=x"],
    negative: ["dd if=disk.img", "git add of=x"],
  },
  recursiveOwnership: {
    positive: ["chmod -R 777 /", "chown -R user dir", "chmod --recursive 755 dir"],
    negative: ["chmod +x run.sh", "chown user file"],
  },
  kill9: {
    positive: ["kill -9 123", "kill -KILL 99", "kill 5 -SIGKILL"],
    negative: ["kill 1234", "kill -15 12"],
  },
  dropSql: {
    positive: ["psql -c 'DROP TABLE users'", "mysql -e 'drop database prod'", "echo 'Drop   Table x'"],
    negative: ["select * from tables", "echo drop shadows"],
  },
  truncate: {
    positive: ["truncate -s 0 log.txt", "echo x; truncate -s 1M f", "truncate"],
    negative: ["echo truncated", "ls"],
  },
  pipeToShell: {
    positive: ["curl https://x.sh | sh", "wget -qO- https://x.sh | bash", "curl -fsSL https://x | sudo bash"],
    negative: ["curl https://x.com | jq .", "curl -o f.sh https://x.sh"],
  },
};

describe("destructive patterns", () => {
  for (const [name, cases] of Object.entries(CASES)) {
    it(`${name} flags its positives and spares its negatives`, () => {
      const pattern = DESTRUCTIVE_PATTERNS[name as keyof typeof DESTRUCTIVE_PATTERNS];
      for (const command of cases.positive) expect(pattern.test(command), command).toBe(true);
      for (const command of cases.negative) expect(pattern.test(command), command).toBe(false);
    });
  }

  it("has a test table for every pattern", () => {
    expect(Object.keys(CASES).sort()).toEqual(Object.keys(DESTRUCTIVE_PATTERNS).sort());
  });
});

describe("describeRequest", () => {
  it("describes a safe bash command", () => {
    expect(describeRequest("Bash", { command: "git push origin main", description: "x" })).toEqual({
      kind: "permission",
      title: "Allow command?",
      summary: "git push origin main",
      destructive: false,
    });
  });

  it("flags a destructive bash command", () => {
    const result = describeRequest("Bash", { command: "rm -rf build" });
    expect(result).toMatchObject({ kind: "permission", destructive: true });
  });

  it("describes edits by file path and notebooks by notebook path", () => {
    for (const tool of ["Edit", "Write", "MultiEdit"]) {
      expect(describeRequest(tool, { file_path: "/a/b.ts" })).toEqual({
        kind: "permission",
        title: "Allow edit?",
        summary: "/a/b.ts",
        destructive: false,
      });
    }
    expect(describeRequest("NotebookEdit", { notebook_path: "/a/n.ipynb" })).toMatchObject({
      title: "Allow edit?",
      summary: "/a/n.ipynb",
    });
  });

  it("describes a fetch by url", () => {
    expect(describeRequest("WebFetch", { url: "https://example.com" })).toEqual({
      kind: "permission",
      title: "Allow fetch?",
      summary: "https://example.com",
      destructive: false,
    });
  });

  it("describes an MCP tool by its server", () => {
    expect(describeRequest("mcp__my_server__do__thing", {})).toEqual({
      kind: "permission",
      title: "Allow do__thing?",
      summary: "my_server",
      destructive: false,
    });
  });

  it("treats a malformed mcp name like any other tool", () => {
    expect(describeRequest("mcp__only", { a: 1 })).toMatchObject({ title: "Allow mcp__only?", summary: '{"a":1}' });
  });

  it("summarises unknown tools as compact JSON and truncates long input", () => {
    expect(describeRequest("Grep", { pattern: "x" })).toMatchObject({ title: "Allow Grep?", summary: '{"pattern":"x"}' });
    const long = describeRequest("Grep", { pattern: "y".repeat(500) });
    if (long.kind !== "permission") throw new Error("expected permission");
    expect(long.summary).toHaveLength(SUMMARY_MAX_LENGTH + 3);
    expect(long.summary.endsWith("...")).toBe(true);
  });

  it("falls back to the JSON summary when the expected field is missing", () => {
    expect(describeRequest("Bash", { cmd: "ls" })).toMatchObject({ title: "Allow command?", summary: '{"cmd":"ls"}' });
    expect(describeRequest("Bash", "oops")).toMatchObject({ summary: '"oops"' });
    expect(describeRequest("Bash", undefined)).toMatchObject({ summary: "" });
  });

  it("turns AskUserQuestion into a question", () => {
    const input = {
      questions: [
        {
          question: "Do you prefer tea or coffee?",
          header: "Drink",
          options: [
            { label: "Tea", description: "A proper cuppa." },
            { label: "Coffee", description: "Strong." },
          ],
          multiSelect: false,
        },
      ],
    };
    expect(describeRequest("AskUserQuestion", input)).toEqual({
      kind: "question",
      text: "Do you prefer tea or coffee?",
      options: ["Tea", "Coffee"],
    });
  });

  it("rejects malformed AskUserQuestion input", () => {
    for (const input of [{}, { questions: [] }, { questions: [{ question: "" }] }, null]) {
      expect(() => describeRequest("AskUserQuestion", input)).toThrow(FardeskError);
    }
    try {
      parseAskUserQuestion({});
    } catch (error) {
      expect((error as FardeskError).code).toBe("invalid_request");
    }
  });
});
