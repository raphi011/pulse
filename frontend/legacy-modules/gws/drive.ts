import { gwsJson } from "./gws";
import type { DriveCategory, DriveFileItem, DriveData, DriveConfig } from "./manifest";

type RawFile = {
  id: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  webViewLink?: string;
  iconLink?: string;
};

/** Map a Drive mimeType to one of the four config buckets; unknown types → "other". */
export function categorize(mimeType: string): DriveCategory {
  switch (mimeType) {
    case "application/vnd.google-apps.document":
      return "docs";
    case "application/vnd.google-apps.spreadsheet":
      return "sheets";
    case "application/vnd.google-apps.presentation":
      return "slides";
    default:
      return "other";
  }
}

export function normalizeFile(raw: RawFile): DriveFileItem {
  return {
    id: raw.id,
    name: raw.name || "(untitled)",
    category: categorize(raw.mimeType ?? ""),
    modifiedTime: raw.modifiedTime ?? "",
    url: raw.webViewLink ?? "",
    iconLink: raw.iconLink ?? "",
  };
}

export async function fetchDrive(config: DriveConfig): Promise<DriveData> {
  const resp = await gwsJson<{ files?: RawFile[] }>([
    "drive",
    "files",
    "list",
    "--params",
    JSON.stringify({
      q: "starred=true",
      orderBy: "modifiedTime desc",
      pageSize: config.limit,
      fields: "files(id,name,mimeType,modifiedTime,webViewLink,iconLink)",
    }),
  ]);
  return { files: (resp.files ?? []).map(normalizeFile) };
}
