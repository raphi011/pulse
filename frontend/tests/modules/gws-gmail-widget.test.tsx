import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

vi.mock("@/lib/backend", () => ({
  Gws: {
    ArchiveEmail: vi.fn().mockResolvedValue(undefined),
    MarkEmailRead: vi.fn().mockResolvedValue(undefined),
    TrashEmail: vi.fn().mockResolvedValue(undefined),
  },
}));
import { Gws } from "@/lib/backend";
import { GmailWidget } from "@/modules/gws/widgets/gmail-widget";
import { ToastProvider } from "@/components/toast-context";
import type { EmailItem, GmailConfig } from "@/modules/gws/manifest";

const gmailDefaultConfig: GmailConfig = { query: "is:unread in:inbox", limit: 15 };

const mockArchive = Gws.ArchiveEmail as unknown as ReturnType<typeof vi.fn>;
const mockRead = Gws.MarkEmailRead as unknown as ReturnType<typeof vi.fn>;
const mockTrash = Gws.TrashEmail as unknown as ReturnType<typeof vi.fn>;

const email = (id: string, unread: boolean): EmailItem => ({
  id,
  subject: `subject-${id}`,
  from: `from-${id}`,
  date: "2026-07-13T09:00:00.000Z",
  unread,
  url: `https://mail/${id}`,
});

function renderWidget(emails: EmailItem[], errors?: string[]) {
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(
    <ToastProvider>
      <GmailWidget data={{ emails, errors }} config={gmailDefaultConfig} refresh={refresh} />
    </ToastProvider>,
  );
  return { refresh };
}

beforeEach(() => {
  mockArchive.mockReset().mockResolvedValue(undefined);
  mockRead.mockReset().mockResolvedValue(undefined);
  mockTrash.mockReset().mockResolvedValue(undefined);
});

describe("GmailWidget actions", () => {
  it("shows an empty message when there are no emails", () => {
    renderWidget([]);
    expect(screen.getByText("No emails.")).toBeInTheDocument();
  });

  it("surfaces a partial-failure note when some messages failed to load", () => {
    renderWidget([email("a", true)], ["m1", "m2"]);
    expect(screen.getByText(/2 emails failed to load/i)).toBeInTheDocument();
  });

  it("shows the partial-failure note even when every message failed (no 'No emails')", () => {
    renderWidget([], ["m1"]);
    expect(screen.getByText(/1 email failed to load/i)).toBeInTheDocument();
    expect(screen.queryByText("No emails.")).toBeNull();
  });

  it("shows Mark as read only on unread rows", () => {
    renderWidget([email("a", true), email("b", false)]);
    expect(screen.getByRole("button", { name: /mark .*from-a.* read/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark .*from-b.* read/i })).toBeNull();
    // archive + trash present on both rows
    expect(screen.getAllByRole("button", { name: /archive/i })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /trash/i })).toHaveLength(2);
  });

  it("archives non-optimistically: calls the CLI, then refresh, and disables while in flight", async () => {
    let resolveArchive: () => void = () => {};
    mockArchive.mockImplementationOnce(() => new Promise<void>((r) => { resolveArchive = () => r(); }));
    const { refresh } = renderWidget([email("a", true)]);
    const btn = screen.getByRole("button", { name: /archive .*from-a/i });

    await act(async () => { btn.click(); });
    // In flight: button disabled, refresh not yet called.
    expect(btn).toBeDisabled();
    expect(refresh).not.toHaveBeenCalled();

    await act(async () => { resolveArchive(); });
    expect(mockArchive).toHaveBeenCalledWith("a");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shows an error toast and does not refresh when a mutation fails", async () => {
    mockTrash.mockRejectedValueOnce(new Error("failed"));
    const { refresh } = renderWidget([email("a", true)]);
    const btn = screen.getByRole("button", { name: /trash .*from-a/i });

    await act(async () => { btn.click(); });

    expect(screen.getByText(/couldn't trash email/i)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
