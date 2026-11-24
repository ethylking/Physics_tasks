// lib.rs — Tauri application entry (used by both the desktop binary and
// mobile builds). Wire-up lives in `run()`.

mod commands;
mod fs;
mod project;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::list_projects,
            commands::load_project,
            commands::save_project,
            commands::duplicate_project,
            commands::delete_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
