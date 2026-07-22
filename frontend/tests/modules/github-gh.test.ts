import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/cli", () => ({
  runCli: vi.fn(),
  CliError: class CliError extends Error {},
}));
import { runCli } from "@/server/cli";
import { runGh, ghJson } from "@/modules/github/gh";

const mockRun = runCli as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => { mockRun.mockReset(); });

describe("gh helper", () => {
  it("runGh returns stdout and passes gh auth options", async () => {
    mockRun.mockResolvedValue({ stdout: "out", stderr: "" });
    await expect(runGh(["pr", "list"])).resolves.toBe("out");
    const [bin, args, opts] = mockRun.mock.calls[0];
    expect(bin).toBe("gh");
    expect(args).toEqual(["pr", "list"]);
    expect(opts.notAuthenticatedPattern).toBeInstanceOf(RegExp);
    expect(opts.notAuthenticatedMessage).toMatch(/gh auth login/);
  });

  it("ghJson parses JSON stdout", async () => {
    mockRun.mockResolvedValue({ stdout: '[{"n":1}]', stderr: "" });
    await expect(ghJson(["x"])).resolves.toEqual([{ n: 1 }]);
  });
});
