// project.rs — `.mech.json` project CRUD on top of `fs.rs`.
//
// All operations validate the filename (path-traversal safe) and return
// structured errors (`CommandError`) that the frontend surfaces verbatim.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::fs::{atomic_write, projects_dir, sanitize_filename};

/// Metadata shown in the Project Manager list. Mirrors the TS `ProjectMetadata`
/// (`#[serde(rename_all = "camelCase")]` maps snake_case fields to camelCase).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub filename: String,
    pub id: Option<String>,
    pub name: String,
    pub mode: String,
    pub created_at: String,
    pub modified_at: String,
    pub size_bytes: u64,
}

/// Structured error payload returned to the frontend on failure.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

impl CommandError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.to_string(), message: message.into() }
    }
}

pub type CmdResult<T> = Result<T, CommandError>;

fn io_err(op: &str, e: std::io::Error) -> CommandError {
    CommandError::new("IO_ERROR", format!("{op}: {e}"))
}

fn project_dir() -> CmdResult<PathBuf> {
    projects_dir().map_err(|m| CommandError::new("FS_ERROR", m))
}

fn meta_from_value(value: &Value, filename: &str, size_bytes: u64) -> ProjectMeta {
    let fallback_name = filename.trim_end_matches(".mech.json").to_string();
    let meta = value.get("meta").and_then(Value::as_object);
    let str_of = |key: &str| -> Option<String> {
        meta.and_then(|m| m.get(key)).and_then(Value::as_str).map(String::from)
    };
    let mode = str_of("mode")
        .map(|m| if m.eq_ignore_ascii_case("2d") { "2D".to_string() } else { "3D".to_string() })
        .unwrap_or_else(|| "3D".to_string());
    ProjectMeta {
        filename: filename.to_string(),
        id: str_of("id"),
        name: str_of("name").filter(|n| !n.is_empty()).unwrap_or(fallback_name),
        mode,
        created_at: str_of("createdAt").unwrap_or_default(),
        modified_at: str_of("modifiedAt").unwrap_or_default(),
        size_bytes,
    }
}

/// List metadata of every `*.mech.json` project, newest first.
pub fn list_projects() -> CmdResult<Vec<ProjectMeta>> {
    let dir = project_dir()?;
    let mut metas: Vec<ProjectMeta> = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| io_err("cannot read projects directory", e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(filename) = path.file_name().and_then(|n| n.to_str()).map(String::from) else {
            continue;
        };
        if !filename.ends_with(".mech.json") {
            continue;
        }
        let Ok(content) = fs::read_to_string(&path) else {
            continue; // skip unreadable files
        };
        let size = fs::metadata(&path).map(|m| m.len()).unwrap_or_else(|_| content.len() as u64);
        let meta = serde_json::from_str::<Value>(&content)
            .map(|value| meta_from_value(&value, &filename, size))
            .unwrap_or_else(|_| meta_from_value(&Value::Null, &filename, size));
        metas.push(meta);
    }
    metas.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(metas)
}

/// Read a project file back to the frontend as raw JSON text.
pub fn load_project(filename: String) -> CmdResult<String> {
    let name = sanitize_filename(&filename).map_err(|m| CommandError::new("INVALID_FILENAME", m))?;
    let path = project_dir()?.join(&name);
    let content = fs::read_to_string(&path)
        .map_err(|_| CommandError::new("NOT_FOUND", format!("project '{name}' not found")))?;
    // Structural check: the file must be valid JSON (semantic validation with
    // line-numbered diagnostics happens in the frontend validator).
    serde_json::from_str::<Value>(&content)
        .map_err(|e| CommandError::new("MALFORMED_JSON", format!("'{name}' is not valid JSON: {e}")))?;
    Ok(content)
}

/// Persist a project with an atomic tmp-write + rename.
pub fn save_project(filename: String, json_content: String) -> CmdResult<ProjectMeta> {
    let name = sanitize_filename(&filename).map_err(|m| CommandError::new("INVALID_FILENAME", m))?;
    let parsed: Value = serde_json::from_str(&json_content)
        .map_err(|e| CommandError::new("MALFORMED_JSON", format!("content is not valid JSON: {e}")))?;
    if !parsed.is_object() {
        return Err(CommandError::new("MALFORMED_JSON", "project root must be a JSON object"));
    }
    let dir = project_dir()?;
    let path = dir.join(&name);
    atomic_write(&path, &json_content).map_err(|m| CommandError::new("IO_ERROR", m))?;
    Ok(meta_from_value(&parsed, &name, json_content.len() as u64))
}

/// Duplicate a project under `name (copy).mech.json` with a fresh id/timestamps.
pub fn duplicate_project(filename: String) -> CmdResult<ProjectMeta> {
    let name = sanitize_filename(&filename).map_err(|m| CommandError::new("INVALID_FILENAME", m))?;
    let dir = project_dir()?;
    let path = dir.join(&name);
    let content = fs::read_to_string(&path)
        .map_err(|_| CommandError::new("NOT_FOUND", format!("project '{name}' not found")))?;
    let mut value: Value = serde_json::from_str(&content)
        .map_err(|e| CommandError::new("MALFORMED_JSON", format!("'{name}' is not valid JSON: {e}")))?;
    let Some(obj) = value.as_object_mut() else {
        return Err(CommandError::new("MALFORMED_JSON", "project root must be a JSON object"));
    };

    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let base_name = obj
        .get("meta")
        .and_then(Value::as_object)
        .and_then(|m| m.get("name"))
        .and_then(Value::as_str)
        .unwrap_or_else(|| name.trim_end_matches(".mech.json"))
        .to_string();
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("id".to_string(), Value::String(uuid::Uuid::new_v4().to_string()));
        meta.insert("name".to_string(), Value::String(format!("{base_name} (copy)")));
        meta.insert("createdAt".to_string(), Value::String(now.clone()));
        meta.insert("modifiedAt".to_string(), Value::String(now));
    } else {
        obj.insert(
            "meta".to_string(),
            serde_json::json!({
                "id": uuid::Uuid::new_v4().to_string(),
                "name": format!("{base_name} (copy)"),
                "createdAt": now,
                "modifiedAt": now,
            }),
        );
    }

    let stem = name
        .trim_end_matches(".mech.json")
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ' ' { c } else { '-' })
        .collect::<String>();
    let mut new_name = format!("{stem} (copy).mech.json");
    let mut counter = 2;
    while dir.join(&new_name).exists() {
        new_name = format!("{stem} (copy {counter}).mech.json");
        counter += 1;
    }

    let json = serde_json::to_string_pretty(&value)
        .map_err(|e| CommandError::new("SERIALIZE_ERROR", format!("cannot serialize project: {e}")))?;
    atomic_write(&dir.join(&new_name), &json).map_err(|m| CommandError::new("IO_ERROR", m))?;
    Ok(meta_from_value(&value, &new_name, json.len() as u64))
}

/// Delete a project file.
pub fn delete_project(filename: String) -> CmdResult<bool> {
    let name = sanitize_filename(&filename).map_err(|m| CommandError::new("INVALID_FILENAME", m))?;
    let path = project_dir()?.join(&name);
    match fs::remove_file(&path) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Err(CommandError::new("NOT_FOUND", format!("project '{name}' not found")))
        }
        Err(e) => Err(io_err("cannot delete project", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn unique_name(tag: &str) -> String {
        format!("__test_{}_{}.mech.json", tag, uuid::Uuid::new_v4())
    }

    fn sample_project(name: &str, mode: &str) -> Value {
        json!({
            "schemaVersion": 2,
            "meta": {
                "id": uuid::Uuid::new_v4().to_string(),
                "name": name,
                "mode": mode,
                "createdAt": "2026-01-01T00:00:00Z",
                "modifiedAt": "2026-01-01T00:00:00Z"
            },
            "world": {
                "gravity": [0, 0, -9.81], "timeScale": 1, "fixedDt": 1.0 / 120.0,
                "solverIterations": 4, "additionalFrictionIterations": 4,
                "internalPgsIterations": 1, "maxMassRatio": 10000, "contactTolerance": 0.005
            },
            "enabledPlugins": [],
            "bodies": [], "statics": [], "joints": [], "forces": [], "ropes": [], "meters": [],
            "cameras": { "mode": "perspective", "position": [0,0,0], "target": [0,0,0], "up": [0,0,1], "fov": 50, "zoom": 1 }
        })
    }

    #[test]
    fn save_load_list_duplicate_delete_roundtrip() {
        let filename = unique_name("roundtrip");
        let content = sample_project("Roundtrip", "3D");

        let meta = save_project(filename.clone(), content.to_string()).unwrap();
        assert_eq!(meta.filename, filename);
        assert_eq!(meta.name, "Roundtrip");
        assert_eq!(meta.mode, "3D");

        // load returns the exact saved bytes
        let loaded = load_project(filename.clone()).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&loaded).unwrap(), content);

        assert!(list_projects().unwrap().iter().any(|m| m.filename == filename));

        let dup = duplicate_project(filename.clone()).unwrap();
        assert!(dup.filename.contains("(copy)"), "copy filename: {}", dup.filename);
        assert_eq!(dup.name, "Roundtrip (copy)");
        assert_ne!(dup.id, meta.id, "duplicate must get a fresh project id");
        assert!(list_projects().unwrap().iter().any(|m| m.filename == dup.filename));

        assert!(delete_project(filename.clone()).unwrap());
        assert!(delete_project(dup.filename.clone()).unwrap());
        assert!(load_project(filename).is_err());
    }

    #[test]
    fn structured_errors_on_malformed_json_and_bad_filenames() {
        let err = save_project("x.mech.json".to_string(), "not json".to_string()).unwrap_err();
        assert_eq!(err.code, "MALFORMED_JSON");

        let err = save_project("../evil".to_string(), "{}".to_string()).unwrap_err();
        assert_eq!(err.code, "INVALID_FILENAME");

        let err = load_project("definitely-missing.mech.json".to_string()).unwrap_err();
        assert_eq!(err.code, "NOT_FOUND");
    }

    #[test]
    fn list_projects_tolerates_unparseable_files() {
        let filename = unique_name("broken");
        let dir = projects_dir().unwrap();
        std::fs::write(dir.join(&filename), "{not json").unwrap();
        let listed = list_projects().unwrap();
        assert!(
            listed.iter().any(|m| m.filename == filename),
            "unparseable files must still be listed with fallback metadata"
        );
        let _ = std::fs::remove_file(dir.join(&filename));
    }
}
