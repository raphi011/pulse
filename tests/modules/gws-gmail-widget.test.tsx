import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { GmailWidget } from "@/modules/gws/widgets/gmail-widget";
import { ToastProvider } from "@/components/toast-context";
import { gmailDefaultConfig, type EmailItem } from "@/modules/gws/manifest";
import { archiveEmail, markEmailRead, trashEmail } from "@/modules/gws/gmail";
import { CliError } from "@/server/cli";

vi.mock("@/modules/gws/gmail", () => ({
  archiveEmail: vi.fn().mockResolvedValue(undefined),
  markEmailRead: vi.fn().mockResolvedValue(undefined),
  trashEmail: vi.fn().mockResolvedValue(undefined),
}));
const mockArchive = archiveEmail as unknown as ReturnType<typeof vi.fn>;
const mockRead = markEmailRead as unknown as ReturnType<typeof vi.fn>;
const mockTrash = trashEmail as unknown as ReturnType<typeof vi.fn>;

const email = (id: string, unread: boolean): EmailItem => ({
  id,
  subject: `subject-${id}`,
  from: `from-${id}`,
  date: "2026-07-13T09:00:00.000Z",
  unread,
  url: `https://mail/${id}`,
});

function renderWidget(emails: EmailItem[]) {
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(
    <ToastProvider>
      <GmailWidget data={{ emails }} config={gmailDefaultConfig} refresh={refresh} />
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
    mockTrash.mockRejectedValueOnce(new CliError("failed", "failed"));
    const { refresh } = renderWidget([email("a", true)]);
    const btn = screen.getByRole("button", { name: /trash .*from-a/i });

    await act(async () => { btn.click(); });

    expect(screen.getByText(/couldn't trash email/i)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
