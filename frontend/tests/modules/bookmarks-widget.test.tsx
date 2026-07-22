import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/backend", () => ({
  Bookmarks: {
    Add: vi.fn(async () => {}),
    Remove: vi.fn(async () => {}),
  },
}));
import { Bookmarks } from "@/lib/backend";
import { BookmarksHeaderControls } from "@/modules/bookmarks/widgets/bookmarks-widget";
import type { WidgetBodyProps } from "@/modules/contracts";
import type { BookmarksData, BookmarksConfig } from "@/modules/bookmarks/manifest";

const props = {
  data: { bookmarks: [] },
  config: {},
  refresh: vi.fn(async () => {}),
} as unknown as WidgetBodyProps<BookmarksData, BookmarksConfig>;

beforeEach(() => vi.clearAllMocks());

describe("BookmarksHeaderControls add guard (F8)", () => {
  it("adds only once when Enter is pressed twice before the save resolves", async () => {
    render(<BookmarksHeaderControls {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Add bookmark" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Example" } });
    const urlInput = screen.getByLabelText("URL");
    fireEvent.change(urlInput, { target: { value: "example.com" } });

    fireEvent.keyDown(urlInput, { key: "Enter" });
    fireEvent.keyDown(urlInput, { key: "Enter" });

    await waitFor(() => expect(Bookmarks.Add).toHaveBeenCalled());
    expect(Bookmarks.Add).toHaveBeenCalledTimes(1);
    // URL normalization now happens server-side (Go); the widget passes the raw input through.
    expect(Bookmarks.Add).toHaveBeenCalledWith("Example", "example.com");
  });
});
