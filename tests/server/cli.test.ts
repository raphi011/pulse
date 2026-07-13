// @vitest-environment node
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@tauri-apps/plugin-shell", () => ({ Command: { create: vi.fn() } }));
vi.mock("@tauri-apps/api/path", () => ({
  homeDir: vi.fn().mockResolvedValue("/Users/tester"),
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join("/"))),
}));
import { Command } from "@tauri-apps/plugin-shell";
import { runCli, runJsonCli, warmToolPath, classifyExit, classifySpawnError, CliError } from "@/server/cli";

const mockCreate = Command.create as unknown as Mock;

/**
 * Minimal stand-in for the shell plugin's `Command` — enough of its EventEmitter shape
 * (`stdout.on("data", ...)`, `stderr.on("data", ...)`, `.on("close"/"error", ...)`, `.spawn()`)
 * for `runCli` to drive, plus `emit*` helpers the tests use to script process behavior.
 */
class FakeCommand {
  private stdoutCb?: (line: string) => void;
  private stderrCb?: (line: string) => void;
  private closeCbs: ((p: { code: number | null; signal: number | null }) => void)[] = [];
  private errorCbs: ((msg: string) => void)[] = [];
  /** Overridable per test; defaults to a child that never rejects and can be killed. */
  spawnImpl: () => Promise<{ kill: Mock }> = () => Promise.resolve({ kill: vi.fn().mockResolvedValue(undefined) });

  stdout = { on: (_event: string, cb: (line: string) => void) => { this.stdoutCb = cb; } };
  stderr = { on: (_event: string, cb: (line: string) => void) => { this.stderrCb = cb; } };

  on(event: "close" | "error", cb: (arg: never) => void) {
    if (event === "close") this.closeCbs.push(cb as never);
    else this.errorCbs.push(cb as never);
    return this;
  }

  spawn() {
    return this.spawnImpl();
  }

  emitStdout(line: string) {
    this.stdoutCb?.(line);
  }
  emitStderr(line: string) {
    this.stderrCb?.(line);
  }
  emitClose(payload: { code: number | null; signal: number | null }) {
    this.closeCbs.forEach((cb) => cb(payload as never));
  }
  emitError(msg: string) {
    this.errorCbs.forEach((cb) => cb(msg as never));
  }
}

function nextCommand(): FakeCommand {
  const cmd = new FakeCommand();
  mockCreate.mockReturnValue(cmd);
  return cmd;
}

beforeEach(() => {
  mockCreate.mockReset();
});

describe("classifyExit (pure)", () => {
  it("returns stdout/stderr on a zero exit", () => {
    expect(classifyExit("gh", 0, "hello", "", {})).toEqual({ stdout: "hello", stderr: "" });
  });

  it("throws auth when stderr matches the auth pattern", () => {
    const err = (() => {
      try {
        classifyExit("gh", 1, "", "gh auth login required", {
          notAuthenticatedPattern: /gh auth login/i,
          notAuthenticatedMessage: "Not authenticated — run `gh auth login`",
        });
      } catch (e) {
        return e as CliError;
      }
    })();
    expect(err).toBeInstanceOf(CliError);
    expect(err!.kind).toBe("auth");
    expect(err!.message).toBe("Not authenticated — run `gh auth login`");
  });

  it("uses a default auth message when none is provided", () => {
    let err: CliError | undefined;
    try {
      classifyExit("gh", 1, "", "gh auth login required", { notAuthenticatedPattern: /gh auth login/i });
    } catch (e) {
      err = e as CliError;
    }
    expect(err!.kind).toBe("auth");
    expect(err!.message).toBe("Not authenticated");
  });

  it("throws failed with the trimmed stderr for other non-zero exits, preserving stdout", () => {
    let err: CliError | undefined;
    try {
      classifyExit("gh", 1, "partial output", "some error text\n", {});
    } catch (e) {
      err = e as CliError;
    }
    expect(err!.kind).toBe("failed");
    expect(err!.message).toBe("some error text");
    expect(err!.stdout).toBe("partial output");
  });

  it("falls back to an exit-code message when stderr is empty", () => {
    let err: CliError | undefined;
    try {
      classifyExit("gh", 7, "", "", {});
    } catch (e) {
      err = e as CliError;
    }
    expect(err!.kind).toBe("failed");
    expect(err!.message).toBe("gh exited with code 7");
  });
});

describe("classifySpawnError (pure)", () => {
  it.each([
    "No such file or directory (os error 2)",
    "gh: command not found",
    "failed to spawn `gh`",
    "cannot find the file specified",
  ])("classifies %j as not-found", (message) => {
    const err = classifySpawnError("gh", message);
    expect(err.kind).toBe("not-found");
    expect(err.message).toMatch(/gh not found/);
  });

  it("classifies an unrecognized message as failed, keeping the message", () => {
    const err = classifySpawnError("gh", "permission denied");
    expect(err.kind).toBe("failed");
    expect(err.message).toBe("permission denied");
  });

  it("falls back to a generic message when the spawn error message is empty", () => {
    const err = classifySpawnError("gh", "");
    expect(err.kind).toBe("failed");
    expect(err.message).toBe("gh failed to start");
  });
});

describe("runCli (mocked @tauri-apps/plugin-shell)", () => {
  it("aggregates stdout/stderr lines and resolves on a zero exit", async () => {
    const cmd = nextCommand();
    const promise = runCli("gh", ["--version"]);
    cmd.emitStdout("line1");
    cmd.emitStdout("line2");
    cmd.emitStderr("warn");
    cmd.emitClose({ code: 0, signal: null });
    await expect(promise).resolves.toEqual({ stdout: "line1\nline2\n", stderr: "warn\n" });
    expect(mockCreate).toHaveBeenCalledWith(
      "gh",
      ["--version"],
      { env: { PATH: expect.stringContaining("/opt/homebrew/bin") } },
    );
  });

  it("rejects with a failed CliError (stdout preserved) on a non-zero exit", async () => {
    const cmd = nextCommand();
    const promise = runCli("gh", ["x"]);
    cmd.emitStdout('{"error":"body"}');
    cmd.emitStderr("boom");
    cmd.emitClose({ code: 1, signal: null });
    const err = (await promise.catch((e) => e)) as CliError;
    expect(err).toBeInstanceOf(CliError);
    expect(err.kind).toBe("failed");
    expect(err.stdout).toBe('{"error":"body"}\n');
  });

  it("rejects with not-found when the shell plugin emits an error event for a missing binary", async () => {
    const cmd = nextCommand();
    const promise = runCli("gh", ["x"]);
    cmd.emitError("No such file or directory (os error 2)");
    const err = (await promise.catch((e) => e)) as CliError;
    expect(err).toBeInstanceOf(CliError);
    expect(err.kind).toBe("not-found");
  });

  it("rejects via classifySpawnError when spawn() itself rejects", async () => {
    const cmd = nextCommand();
    cmd.spawnImpl = () => Promise.reject(new Error("No such file or directory (os error 2)"));
    const err = (await runCli("gh", ["x"]).catch((e) => e)) as CliError;
    expect(err).toBeInstanceOf(CliError);
    expect(err.kind).toBe("not-found");
  });

  it("throws timeout and kills the child when no close/error event fires in time", async () => {
    vi.useFakeTimers();
    try {
      const cmd = nextCommand();
      const kill = vi.fn().mockResolvedValue(undefined);
      cmd.spawnImpl = () => Promise.resolve({ kill });

      const promise = runCli("gh", ["x"], { timeoutMs: 50 });
      const assertion = expect(promise).rejects.toMatchObject({ kind: "timeout" });
      await vi.advanceTimersByTimeAsync(50);
      await assertion;
      expect(kill).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// Extractor mirroring a Google-style `{ error: { code, message } }` body on stdout.
const extractApiError = (body: unknown) => (body as { error?: { code?: number; message?: string } }).error ?? null;

describe("runJsonCli (driven through the mocked runCli/Command)", () => {
  it("parses and returns the JSON body on success", async () => {
    const cmd = nextCommand();
    const promise = runJsonCli("gws", ["x"], extractApiError);
    cmd.emitStdout('{"messages":[{"id":"1"}]}');
    cmd.emitClose({ code: 0, signal: null });
    await expect(promise).resolves.toEqual({ messages: [{ id: "1" }] });
  });

  it("throws auth for an embedded 401 even when the process exits 0", async () => {
    const cmd = nextCommand();
    const promise = runJsonCli("gws", ["x"], extractApiError, {
      notAuthenticatedMessage: "Not authenticated — run `gws auth login`",
    });
    cmd.emitStdout('{"error":{"code":401,"message":"bad token"}}');
    cmd.emitClose({ code: 0, signal: null });
    const err = (await promise.catch((e) => e)) as CliError;
    expect(err).toBeInstanceOf(CliError);
    expect(err.kind).toBe("auth");
    expect(err.message).toBe("Not authenticated — run `gws auth login`");
  });

  it("reads the error body carried on a non-zero exit (e.g. 404)", async () => {
    const cmd = nextCommand();
    const promise = runJsonCli("gws", ["x"], extractApiError);
    cmd.emitStdout('{"error":{"code":404,"message":"not found"}}');
    cmd.emitClose({ code: 1, signal: null });
    const err = (await promise.catch((e) => e)) as CliError;
    expect(err.kind).toBe("failed");
    expect(err.message).toBe("not found");
  });

  it("rethrows process failures with no JSON body (e.g. missing binary)", async () => {
    const cmd = nextCommand();
    const promise = runJsonCli("gws", ["x"], extractApiError);
    cmd.emitError("No such file or directory (os error 2)");
    const err = (await promise.catch((e) => e)) as CliError;
    expect(err.kind).toBe("not-found");
  });

  it("throws failed on non-JSON output", async () => {
    const cmd = nextCommand();
    const promise = runJsonCli("gws", ["x"], extractApiError);
    cmd.emitStdout("not json");
    cmd.emitClose({ code: 0, signal: null });
    const err = (await promise.catch((e) => e)) as CliError;
    expect(err.kind).toBe("failed");
    expect(err.message).toMatch(/non-JSON/);
  });

  it("preserves the original auth classification when a failed process emits non-JSON output", async () => {
    const cmd = nextCommand();
    const promise = runJsonCli("gws", ["x"], extractApiError, {
      notAuthenticatedPattern: /reauth/i,
      notAuthenticatedMessage: "Not authenticated — run `gws auth login`",
    });
    cmd.emitStdout("<html>login</html>"); // non-JSON body carried on a failed exit
    cmd.emitStderr("please reauth");
    cmd.emitClose({ code: 1, signal: null });
    const err = (await promise.catch((e) => e)) as CliError;
    expect(err.kind).toBe("auth");
    expect(err.message).toBe("Not authenticated — run `gws auth login`");
  });

  it("throws failed (not a TypeError) when the body is literal null", async () => {
    const cmd = nextCommand();
    const promise = runJsonCli("gws", ["x"], extractApiError);
    cmd.emitStdout("null"); // parses to null; a naive `body.error` would throw a TypeError
    cmd.emitClose({ code: 0, signal: null });
    const err = (await promise.catch((e) => e)) as CliError;
    expect(err).toBeInstanceOf(CliError);
    expect(err.kind).toBe("failed");
    expect(err.message).toMatch(/unexpected output/);
  });

  it("surfaces a non-zero exit as failure even when its JSON body carries no embedded error", async () => {
    const cmd = nextCommand();
    const promise = runJsonCli("gws", ["x"], extractApiError);
    cmd.emitStdout("{}"); // parses fine, but the extractor finds no error
    cmd.emitClose({ code: 1, signal: null });
    const err = (await promise.catch((e) => e)) as CliError;
    expect(err).toBeInstanceOf(CliError);
    expect(err.kind).toBe("failed");
  });
});

describe("warmToolPath (mocked @tauri-apps/api/path)", () => {
  it("folds the bun global bin dir into the PATH that runCli spawns with", async () => {
    const path = await warmToolPath();
    expect(path).toContain("/opt/homebrew/bin"); // base dirs preserved
    expect(path).toContain("/Users/tester/.bun/bin"); // home-relative dir appended

    const cmd = nextCommand();
    const promise = runCli("gws", ["--version"]);
    cmd.emitClose({ code: 0, signal: null });
    await promise;
    expect(mockCreate).toHaveBeenCalledWith("gws", ["--version"], {
      env: { PATH: expect.stringContaining("/Users/tester/.bun/bin") },
    });
  });
});
