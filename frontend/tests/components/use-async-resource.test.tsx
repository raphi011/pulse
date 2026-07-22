import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useAsyncResource } from "@/components/use-async-resource";

describe("useAsyncResource", () => {
  it("exposes the resolved value", async () => {
    const { result } = renderHook(() => useAsyncResource(() => Promise.resolve(42)));
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data).toBe(42));
    expect(result.current.error).toBeNull();
  });

  it("captures a rejection instead of staying stuck in the loading state", async () => {
    const err = new Error("database is locked");
    const { result } = renderHook(() => useAsyncResource(() => Promise.reject(err)));
    await waitFor(() => expect(result.current.error).toBe(err));
    expect(result.current.data).toBeNull();
  });

  it("reload retries the loader and clears the prior error", async () => {
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("database is locked"))
      .mockResolvedValueOnce("ok");
    const { result } = renderHook(() => useAsyncResource(loader));

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    act(() => result.current.reload());

    await waitFor(() => expect(result.current.data).toBe("ok"));
    expect(result.current.error).toBeNull();
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
