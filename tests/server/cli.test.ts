// @vitest-environment node
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
import { execFile } from "node:child_process";
import { runCli, runJsonCli, CliError } from "@/server/cli";

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
    expect(mockExec).toHaveBeenCalledWith("gh", ["--version"], expect.anything(), expect.any(Function));
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

  it("uses default auth message when none is provided", async () => {
    whenExec(Object.assign(new Error("exit 1"), { code: 1 }), "", "gh auth login required");
    const err = await runCli("gh", ["x"], { notAuthenticatedPattern: /gh auth login/i }).catch((e) => e);
    expect(err.kind).toBe("auth");
    expect(err.message).toBe("Not authenticated");
  });

  it("throws failed with stderr for other non-zero exits", async () => {
    whenExec(Object.assign(new Error("exit 1"), { code: 1 }), "", "some error text");
    const err = await runCli("gh", ["x"]).catch((e) => e);
    expect(err.kind).toBe("failed");
    expect(err.message).toBe("some error text");
  });

  it("falls back to the error message when stderr is empty on failure", async () => {
    whenExec(Object.assign(new Error("spawn EACCES"), { code: "EACCES" }), "", "");
    const err = await runCli("gh", ["x"]).catch((e) => e);
    expect(err.kind).toBe("failed");
    expect(err.message).toBe("spawn EACCES");
  });

  it("throws timeout when the process is killed", async () => {
    whenExec(Object.assign(new Error("killed"), { killed: true, signal: "SIGTERM" }));
    const err = await runCli("gh", ["x"]).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.kind).toBe("timeout");
    expect(err.message).toMatch(/timed out/);
  });

  it("classifies a maxBuffer overflow as failed, not timeout", async () => {
    whenExec(Object.assign(new Error("stdout maxBuffer length exceeded"), {
      code: "ERR_CHILD_PROCESS_STDOUT_MAXBUFFER",
      killed: true,
    }));
    const err = await runCli("gh", ["x"]).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.kind).toBe("failed");
    expect(err.message).toMatch(/too large|maxBuffer/i);
  });
});

// Extractor mirroring a Google-style `{ error: { code, message } }` body on stdout.
const extractApiError = (body: unknown) => (body as { error?: { code?: number; message?: string } }).error ?? null;

describe("runJsonCli", () => {
  it("parses and returns the JSON body on success", async () => {
    whenExec(null, '{"messages":[{"id":"1"}]}', "");
    await expect(runJsonCli("gws", ["x"], extractApiError)).resolves.toEqual({ messages: [{ id: "1" }] });
  });

  it("throws auth for an embedded 401 even when the process exits 0", async () => {
    whenExec(null, '{"error":{"code":401,"message":"bad token"}}', "");
    const err = await runJsonCli("gws", ["x"], extractApiError, {
      notAuthenticatedMessage: "Not authenticated — run `gws auth login`",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.kind).toBe("auth");
    expect(err.message).toBe("Not authenticated — run `gws auth login`");
  });

  it("reads the error body carried on a non-zero exit (e.g. 404)", async () => {
    whenExec(Object.assign(new Error("exit 1"), { code: 1 }), '{"error":{"code":404,"message":"not found"}}', "");
    const err = await runJsonCli("gws", ["x"], extractApiError).catch((e) => e);
    expect(err.kind).toBe("failed");
    expect(err.message).toBe("not found");
  });

  it("rethrows process failures with no JSON body (e.g. ENOENT)", async () => {
    whenExec(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));
    const err = await runJsonCli("gws", ["x"], extractApiError).catch((e) => e);
    expect(err.kind).toBe("not-found");
  });

  it("throws failed on non-JSON output", async () => {
    whenExec(null, "not json", "");
    const err = await runJsonCli("gws", ["x"], extractApiError).catch((e) => e);
    expect(err.kind).toBe("failed");
    expect(err.message).toMatch(/non-JSON/);
  });
});
