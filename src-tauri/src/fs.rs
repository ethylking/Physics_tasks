// fs.rs — native file system helpers (Milestone 1: project CRUD only).
//
// The Rust side owns all disk access; the frontend talks to it exclusively
// through Tauri commands. `./projects/` lives next to the executable in
// release builds and in the workspace root during `tauri dev`.

use std::path::{Path, PathBuf};

/// Resolve the `projects/` data directory, creating it when missing.
///
/// - **Release builds**: `<directory-of-the-executable>/projects`.
/// - **Debug builds** (`tauri dev` / `cargo run`): `<workspace-root>/projects`.
///   The dev binary runs with its working directory set to `src-tauri/`, so the
///   workspace root is one level up; when the binary is launched from the
///   workspace root directly (e.g. `cargo run --manifest-path`), that directory
///   is used as-is.
pub fn projects_dir() -> Result<PathBuf, String> {
    #[cfg(not(debug_assertions))]
    {
        let exe = std::env::current_exe().map_err(|e| format!("cannot resolve executable path: {e}"))?;
        let parent = exe.parent().ok_or_else(|| "executable has no parent directory".to_string())?;
        let dir = parent.join("projects");
        std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
        Ok(dir)
    }

    #[cfg(debug_assertions)]
    {
        let cwd = std::env::current_dir().map_err(|e| format!("cannot resolve current directory: {e}"))?;
        let root = if cwd.join("src-tauri").is_dir() {
            cwd
        } else {
            cwd.parent().map(Path::to_path_buf).unwrap_or_else(|| cwd.clone())
        };
        let dir = root.join("projects");
        std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
        Ok(dir)
    }
}

const WINDOWS_RESERVED: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Validate and normalize a project filename.
///
/// - strips surrounding whitespace, rejects path traversal (`..`, `/`, `\`, NUL)
///   and characters that are invalid on Windows,
/// - rejects Windows reserved device names,
/// - appends the `.mech.json` extension when missing.
pub fn sanitize_filename(name: &str) -> Result<String, String> {
    let mut name = name.trim().to_string();
    if name.is_empty() {
        return Err("filename must not be empty".to_string());
    }
    if name.len() > 255 {
        return Err("filename too long (max 255 characters)".to_string());
    }
    if name.contains("..") || name.contains('/') || name.contains('\\') || name.contains('\0') {
        return Err(format!(
            "filename '{name}' is not allowed: '..', '/', '\\' and NUL characters are rejected"
        ));
    }
    const INVALID: [char; 7] = ['<', '>', ':', '"', '|', '?', '*'];
    if name.chars().any(|c| INVALID.contains(&c)) {
        return Err(format!(
            "filename '{name}' contains characters not allowed on Windows (< > : \" | ? *)"
        ));
    }
    if !name.ends_with(".mech.json") {
        name.push_str(".mech.json");
    }
    let stem = name.trim_end_matches(".mech.json");
    let base = stem.split('.').next().unwrap_or(stem);
    if WINDOWS_RESERVED.contains(&base.to_ascii_uppercase().as_str()) {
        return Err(format!("'{base}' is a reserved filename on Windows"));
    }
    Ok(name)
}

/// Write `content` to `path` atomically: write a sibling `.tmp` file, flush it,
/// then rename it over the destination. On Windows `rename` cannot replace an
/// existing file, so the destination is removed first (a tiny race window,
/// acceptable for a single-user desktop app; the tmp file is cleaned up on
/// failure).
pub fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    use std::io::Write;

    let dir = path.parent().ok_or_else(|| "path has no parent directory".to_string())?;
    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let tmp = dir.join(format!(".{file_name}.tmp"));

    let write_result = (|| -> std::io::Result<()> {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()
    })();
    if let Err(e) = write_result {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("cannot write {}: {e}", tmp.display()));
    }

    if let Err(first) = std::fs::rename(&tmp, path) {
        if path.exists() {
            if let Err(e) = std::fs::remove_file(path) {
                let _ = std::fs::remove_file(&tmp);
                return Err(format!("cannot replace {}: {e}", path.display()));
            }
        }
        if let Err(e) = std::fs::rename(&tmp, path) {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!(
                "cannot move {} into place (rename failed: {first}, retry failed: {e})",
                tmp.display()
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_rejects_path_traversal_and_reserved_names() {
        for bad in ["", "   ", "../evil", "a/b", "a\\b", "a..b", "CON", "nul.mech.json", "a<b", "a?b"] {
            assert!(sanitize_filename(bad).is_err(), "expected '{bad}' to be rejected");
        }
    }

    #[test]
    fn sanitize_normalizes_and_appends_extension() {
        assert_eq!(sanitize_filename("  atwood  ").unwrap(), "atwood.mech.json");
        assert_eq!(sanitize_filename("demo.mech.json").unwrap(), "demo.mech.json");
        assert_eq!(sanitize_filename("My Project").unwrap(), "My Project.mech.json");
    }

    #[test]
    fn projects_dir_is_created_next_to_workspace_root_in_debug() {
        let dir = projects_dir().unwrap();
        assert!(dir.is_dir(), "projects dir should exist: {}", dir.display());
        assert!(dir.ends_with("projects"), "unexpected location: {}", dir.display());
    }

    #[test]
    fn atomic_write_roundtrips_and_replaces_existing_files() {
        let dir = projects_dir().unwrap();
        let path = dir.join("__atomic_test__.mech.json");
        atomic_write(&path, "{\"v\":1}").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"v\":1}");
        atomic_write(&path, "{\"v\":2}").unwrap(); // replaces in place
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"v\":2}");
        assert!(!dir.join(".__atomic_test__.mech.json.tmp").exists(), "tmp file must be gone");
        let _ = std::fs::remove_file(&path);
    }
}
