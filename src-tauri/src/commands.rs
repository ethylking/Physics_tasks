// commands.rs — Tauri command surface for the project file system.
//
// All commands operate on `./projects/` next to the executable (release) or in
// the workspace root (`tauri dev`) — see `fs::projects_dir`. Errors are
// structured (`CommandError { code, message }`) so the frontend can present
// them verbatim.

use crate::project::{self, CommandError, ProjectMeta};

#[tauri::command]
pub fn list_projects() -> Result<Vec<ProjectMeta>, CommandError> {
    project::list_projects()
}

#[tauri::command]
pub fn load_project(filename: String) -> Result<String, CommandError> {
    project::load_project(filename)
}

#[tauri::command]
pub fn save_project(filename: String, json_content: String) -> Result<ProjectMeta, CommandError> {
    project::save_project(filename, json_content)
}

#[tauri::command]
pub fn duplicate_project(filename: String) -> Result<ProjectMeta, CommandError> {
    project::duplicate_project(filename)
}

#[tauri::command]
pub fn delete_project(filename: String) -> Result<bool, CommandError> {
    project::delete_project(filename)
}
