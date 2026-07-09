// @vitest-environment node
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
import { execFile } from "node:child_process";
import { runCli, CliError } from "@/server/cli";

const mockExec = execFile as unknown as Mock;

// execFile(bin, args, opts, cb) — drive the callback the way node does.
function whenExec(err: unknown, stdout = "", stderr = "") {
  mockExec.mockImplementation(
    (
      _bin: string,
      _args: string[],
      _opts: unknown,
      cb: (err: unknown, stdout: string, stderr: string) => void,
    ) => cb(err, stdout, stderr),
  );
}

beforeEach(() => {
  mockExec.mockReset();
});

describe("runCli", () => {
  it("resolves stdout/stderr on success", async () => {
    whenExec(null, "hello", "");
    await expect(runCli("gh", ["--version"])).resolves.toEqual({ stdout: "hello", stderr: "" });
  });

  it("throws not-found on ENOENT", async () => {
    whenExec(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));
    const err = await runCli("gh", ["x"]).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.kind).toBe("not-found");
    expect(err.message).toMatch(/gh not found/);
  });

  it("throws auth when stderr matches the auth pattern", async () => {
    whenExec(Object.assign(new Error("exit 1"), { code: 1 }), "", "gh auth login required");
    const err = await runCli("gh", ["x"], {
      notAuthenticatedPattern: /gh auth login/i,
      notAuthenticatedMessage: "Not authenticated — run `gh auth login`",
    }).catch((e) => e);
    expect(err.kind).toBe("auth");
    expect(err.message).toBe("Not authenticated — run `gh auth login`");
  });

  it("throws failed with stderr for other non-zero exits", async () => {
    whenExec(Object.assign(new Error("exit 1"), { code: 1 }), "", "some error text");
    const err = await runCli("gh", ["x"]).catch((e) => e);
    expect(err.kind).toBe("failed");
    expect(err.message).toBe("some error text");
  });
});
