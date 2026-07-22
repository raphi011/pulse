package gws

import "context"

type rawFile struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	MimeType     string `json:"mimeType"`
	ModifiedTime string `json:"modifiedTime"`
	WebViewLink  string `json:"webViewLink"`
	IconLink     string `json:"iconLink"`
}

// DriveFileItem mirrors the TS DriveFileItem payload shape.
type DriveFileItem struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Category     string `json:"category"` // docs | sheets | slides | other
	ModifiedTime string `json:"modifiedTime"`
	URL          string `json:"url"`
	IconLink     string `json:"iconLink"`
}

// DriveData carries ALL starred files (unfiltered); the widget filters by
// category toggles.
type DriveData struct {
	Files []DriveFileItem `json:"files"`
}

type driveConfig struct {
	ShowDocs   bool `json:"showDocs"`
	ShowSheets bool `json:"showSheets"`
	ShowSlides bool `json:"showSlides"`
	ShowOther  bool `json:"showOther"`
	Limit      int  `json:"limit"`
}

// categorize maps a Drive mimeType to one of the four config buckets;
// unknown types → "other".
func categorize(mimeType string) string {
	switch mimeType {
	case "application/vnd.google-apps.document":
		return "docs"
	case "application/vnd.google-apps.spreadsheet":
		return "sheets"
	case "application/vnd.google-apps.presentation":
		return "slides"
	default:
		return "other"
	}
}

func normalizeFile(raw rawFile) DriveFileItem {
	name := raw.Name
	if name == "" {
		name = "(untitled)"
	}
	return DriveFileItem{
		ID: raw.ID, Name: name, Category: categorize(raw.MimeType),
		ModifiedTime: raw.ModifiedTime, URL: raw.WebViewLink, IconLink: raw.IconLink,
	}
}

func fetchDrive(ctx context.Context, run jsonRunner, cfg driveConfig) (DriveData, error) {
	var resp struct {
		Files []rawFile `json:"files"`
	}
	if err := run(ctx, []string{
		"drive", "files", "list",
		"--params", jsonArg(map[string]any{
			"q":        "starred=true",
			"orderBy":  "modifiedTime desc",
			"pageSize": cfg.Limit,
			"fields":   "files(id,name,mimeType,modifiedTime,webViewLink,iconLink)",
		}),
	}, &resp); err != nil {
		return DriveData{}, err
	}
	files := make([]DriveFileItem, 0, len(resp.Files))
	for _, f := range resp.Files {
		files = append(files, normalizeFile(f))
	}
	return DriveData{Files: files}, nil
}
