import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/modules/gws/gws", () => ({ gwsJson: vi.fn() }));
import { categorize, normalizeFile, fetchDrive } from "@/modules/gws/drive";
import { gwsJson } from "@/modules/gws/gws";
import { filterDriveFiles, type DriveFileItem, type DriveConfig } from "@/modules/gws/manifest";

const mockJson = gwsJson as unknown as ReturnType<typeof vi.fn>;

describe("categorize", () => {
  it("maps Google editor mime types to their buckets", () => {
    expect(categorize("application/vnd.google-apps.document")).toBe("docs");
    expect(categorize("application/vnd.google-apps.spreadsheet")).toBe("sheets");
    expect(categorize("application/vnd.google-apps.presentation")).toBe("slides");
  });
  it("buckets everything else as 'other'", () => {
    expect(categorize("application/pdf")).toBe("other");
    expect(categorize("application/vnd.google-apps.folder")).toBe("other");
    expect(categorize("")).toBe("other");
  });
});

describe("normalizeFile", () => {
  it("maps fields, categorizes, and copies webViewLink to url", () => {
    const item = normalizeFile({
      id: "1abc",
      name: "RFC: Overdraft",
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: "2026-07-10T08:10:57.082Z",
      webViewLink: "https://docs.google.com/document/d/1abc/edit",
      iconLink: "https://drive-thirdparty.googleusercontent.com/16/type/application/vnd.google-apps.document",
    });
    expect(item).toEqual({
      id: "1abc",
      name: "RFC: Overdraft",
      category: "docs",
      modifiedTime: "2026-07-10T08:10:57.082Z",
      url: "https://docs.google.com/document/d/1abc/edit",
      iconLink: "https://drive-thirdparty.googleusercontent.com/16/type/application/vnd.google-apps.document",
    });
  });
  it("falls back for missing name, modifiedTime, url, and iconLink", () => {
    const item = normalizeFile({ id: "x", mimeType: "application/pdf" });
    expect(item).toEqual({
      id: "x",
      name: "(untitled)",
      category: "other",
      modifiedTime: "",
      url: "",
      iconLink: "",
    });
  });
});

describe("filterDriveFiles", () => {
  const files: DriveFileItem[] = (["docs", "sheets", "slides", "other"] as const).map((c, i) => ({
    id: String(i),
    name: c,
    category: c,
    modifiedTime: "",
    url: "",
    iconLink: "",
  }));
  const cfg = (over: Partial<DriveConfig>): DriveConfig => ({
    showDocs: true, showSheets: true, showSlides: true, showOther: true, limit: 25, ...over,
  });

  it("keeps all categories when every toggle is on", () => {
    expect(filterDriveFiles(files, cfg({}))).toHaveLength(4);
  });
  it("drops a category whose toggle is off", () => {
    const kept = filterDriveFiles(files, cfg({ showOther: false, showSheets: false }));
    expect(kept.map((f) => f.category)).toEqual(["docs", "slides"]);
  });
  it("returns nothing when all toggles are off", () => {
    expect(filterDriveFiles(files, cfg({ showDocs: false, showSheets: false, showSlides: false, showOther: false }))).toHaveLength(0);
  });
});

describe("fetchDrive", () => {
  beforeEach(() => mockJson.mockReset());

  it("queries starred files, sorted+bounded, and maps results through normalizeFile", async () => {
    mockJson.mockResolvedValue({
      files: [
        {
          id: "1abc",
          name: "Doc",
          mimeType: "application/vnd.google-apps.document",
          modifiedTime: "2026-07-10T08:10:57.082Z",
          webViewLink: "https://docs.google.com/document/d/1abc/edit",
          iconLink: "https://drive-thirdparty.googleusercontent.com/16/type/application/vnd.google-apps.document",
        },
      ],
    });

    const result = await fetchDrive({
      showDocs: true, showSheets: true, showSlides: true, showOther: true, limit: 7,
    });

    // Assert the exact CLI query contract.
    const [args] = mockJson.mock.calls[0];
    expect(args.slice(0, 3)).toEqual(["drive", "files", "list"]);
    expect(args[3]).toBe("--params");
    expect(JSON.parse(args[4])).toEqual({
      q: "starred=true",
      orderBy: "modifiedTime desc",
      pageSize: 7,
      fields: "files(id,name,mimeType,modifiedTime,webViewLink,iconLink)",
    });

    // Results are normalized (category bucketed, webViewLink → url).
    expect(result).toEqual({
      files: [
        {
          id: "1abc",
          name: "Doc",
          category: "docs",
          modifiedTime: "2026-07-10T08:10:57.082Z",
          url: "https://docs.google.com/document/d/1abc/edit",
          iconLink: "https://drive-thirdparty.googleusercontent.com/16/type/application/vnd.google-apps.document",
        },
      ],
    });
  });

  it("returns no files when the response has none", async () => {
    mockJson.mockResolvedValue({});
    expect(await fetchDrive({ showDocs: true, showSheets: true, showSlides: true, showOther: true, limit: 25 })).toEqual({ files: [] });
  });
});
