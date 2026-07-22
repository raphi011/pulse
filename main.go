package main

import (
	"context"
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"

	"pulse/internal/apppath"
	"pulse/internal/dashboard"
	"pulse/internal/db"
	"pulse/internal/module"
	"pulse/internal/modules/bookmarks"
	"pulse/internal/modules/ccusage"
	"pulse/internal/modules/system"
	"pulse/internal/scheduler"
)

// Wails uses Go's `embed` package to embed the frontend files into the binary.
// Any files in the frontend/dist folder will be embedded into the binary and
// made available to the frontend.
// See https://pkg.go.dev/embed for more information.

//go:embed all:frontend/dist
var assets embed.FS

func init() {
	// Register the cache-updated event so the binding generator emits a
	// strongly typed JS/TS subscription API for it.
	application.RegisterEvent[string](dashboard.EventCacheUpdated)
}

// wailsEmitter is the only place backend code touches the Wails event API —
// it satisfies dashboard.Emitter by forwarding to the real app's event
// manager once main has constructed it.
type wailsEmitter struct{ app *application.App }

func (w *wailsEmitter) Emit(name string, data any) { w.app.Event.Emit(name, data) }

// main function serves as the application's entry point: opens/migrates the
// sqlite DB, wires the module registry and the dashboard/bookmarks/system
// services, starts the scheduler, then creates the window and runs the app.
func main() {
	dbPath, err := apppath.DBPath()
	if err != nil {
		log.Fatal(err)
	}
	d, err := db.Open(dbPath)
	if err != nil {
		log.Fatal(err)
	}
	if err := db.Migrate(d); err != nil {
		log.Fatal(err)
	}
	store := db.NewStore(d)

	monitor := system.NewMonitor()
	bmRepo := &bookmarks.Repo{DB: d}
	registry, err := module.NewRegistry(system.New(), bookmarks.New(bmRepo), ccusage.New())
	if err != nil {
		log.Fatal(err)
	}

	// The emitter needs the app and the app needs the dashboard service:
	// construct the emitter first and fill in its app pointer once
	// application.New returns.
	emitter := &wailsEmitter{}
	dash := dashboard.NewService(store, registry, emitter)
	if err := dash.EnsureCacheVersion(); err != nil {
		log.Fatal(err)
	}

	sched := scheduler.New(scheduler.Config{
		ListWidgets: dash.RefreshableWidgetIDs,
		Refresh:     func(ctx context.Context, id string) { _, _ = dash.GetWidgetData(id, true) },
		Enabled:     func(ctx context.Context) bool { on, _ := dash.AutoRefresh(); return on },
	})
	dash.AttachScheduler(sched)

	// Create a new Wails application by providing the necessary options.
	// Variables 'Name' and 'Description' are for application metadata.
	// 'Assets' configures the asset server with the 'FS' variable pointing to the frontend files.
	// 'Services' binds the Go service instances the frontend has access to.
	// 'Mac' options tailor the application when running on macOS.
	app := application.New(application.Options{
		Name:        "Pulse",
		Description: "A local, single-user, pluggable desktop dashboard for organizing daily work.",
		Services: []application.Service{
			application.NewService(dash),
			application.NewService(bookmarks.NewService(bmRepo)),
			application.NewService(system.NewService(monitor)),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})
	emitter.app = app

	schedCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go sched.Run(schedCtx)

	// Create a new window with the necessary options.
	// 'Title' is the title of the window.
	// 'Mac' options tailor the window when running on macOS.
	// 'BackgroundColour' is the background colour of the window.
	// 'URL' is the URL that will be loaded into the webview.
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: "Pulse",
		// Window sized to the golden ratio (1000 / 618 ≈ 1.618).
		Width:  1000,
		Height: 618,
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 50,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		BackgroundColour: application.NewRGB(6, 7, 15),
		URL:              "/",
	})

	// Run the application. This blocks until the application has been exited.
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
