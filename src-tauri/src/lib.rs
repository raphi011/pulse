use tauri_plugin_sql::{Migration, MigrationKind};

fn migrations() -> Vec<Migration> {
    vec![
        Migration { version: 1, description: "0000", sql: include_str!("../../drizzle/0000_short_cannonball.sql"), kind: MigrationKind::Up },
        Migration { version: 2, description: "0001", sql: include_str!("../../drizzle/0001_bizarre_inertia.sql"), kind: MigrationKind::Up },
        Migration { version: 3, description: "0002", sql: include_str!("../../drizzle/0002_breezy_iceman.sql"), kind: MigrationKind::Up },
        Migration { version: 4, description: "0003", sql: include_str!("../../drizzle/0003_grid_layout.sql"), kind: MigrationKind::Up },
        Migration { version: 5, description: "0004", sql: include_str!("../../drizzle/0004_yummy_boom_boom.sql"), kind: MigrationKind::Up },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_sql::Builder::default()
        .add_migrations("sqlite:dashboard.db", migrations())
        .build())
    .plugin(tauri_plugin_shell::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
