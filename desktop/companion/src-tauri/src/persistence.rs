use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use serde::Deserialize;
use thiserror::Error;

use crate::model::{CompanionSettings, CompanionSnapshot, MAX_SNAPSHOT_BYTES, ValidationError};

const SNAPSHOT_FILE_NAME: &str = "companion-snapshot.json";

#[derive(Debug, Clone)]
pub struct SnapshotStore {
    path: PathBuf,
}

#[derive(Debug, Error)]
pub enum PersistenceError {
    #[error("snapshot storage failed: {0}")]
    Io(#[from] io::Error),
    #[error("snapshot JSON is invalid: {0}")]
    Json(#[from] serde_json::Error),
    #[error("snapshot validation failed: {0}")]
    Validation(#[from] ValidationError),
    #[error("snapshot JSON exceeds the {MAX_SNAPSHOT_BYTES}-byte limit")]
    TooLarge,
}

impl SnapshotStore {
    pub fn in_directory(directory: impl Into<PathBuf>) -> Self {
        Self {
            path: directory.into().join(SNAPSHOT_FILE_NAME),
        }
    }

    #[cfg(test)]
    fn at_path(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    pub fn load(&self) -> Result<Option<CompanionSnapshot>, PersistenceError> {
        let file = match File::open(&self.path) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };

        let metadata = file.metadata()?;
        if metadata.len() > MAX_SNAPSHOT_BYTES as u64 {
            return Err(PersistenceError::TooLarge);
        }

        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        file.take((MAX_SNAPSHOT_BYTES + 1) as u64)
            .read_to_end(&mut bytes)?;
        if bytes.len() > MAX_SNAPSHOT_BYTES {
            return Err(PersistenceError::TooLarge);
        }

        let value: serde_json::Value = serde_json::from_slice(&bytes)?;
        let legacy = value
            .get("schemaVersion")
            .and_then(serde_json::Value::as_u64)
            == Some(1);
        let mut snapshot = if legacy {
            let legacy: LegacySnapshot = serde_json::from_value(value)?;
            CompanionSnapshot {
                settings: CompanionSettings {
                    companion_name: legacy.settings.companion_name,
                    user_name: legacy.settings.user_name,
                    onboarding_complete: legacy.settings.onboarding_complete,
                },
                ..CompanionSnapshot::default()
            }
        } else {
            serde_json::from_value::<CompanionSnapshot>(value)?
        };
        let retired_name = snapshot.settings.companion_name == "饭点儿";
        if retired_name {
            snapshot.settings.companion_name = CompanionSettings::default().companion_name;
        }
        if legacy || retired_name {
            // Rewrite retired feature data and the old built-in name on disk.
            self.save(&snapshot)?;
        } else {
            snapshot.validate()?;
        }
        Ok(Some(snapshot))
    }

    pub fn save(&self, snapshot: &CompanionSnapshot) -> Result<(), PersistenceError> {
        snapshot.validate()?;
        let bytes = serde_json::to_vec_pretty(snapshot)?;
        if bytes.len() > MAX_SNAPSHOT_BYTES {
            return Err(PersistenceError::TooLarge);
        }

        let parent = self.path.parent().ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "snapshot path has no parent")
        })?;
        fs::create_dir_all(parent)?;

        let file_name = self
            .path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(SNAPSHOT_FILE_NAME);
        let mut temporary = tempfile::Builder::new()
            .prefix(&format!(".{file_name}."))
            .suffix(".tmp")
            .tempfile_in(parent)?;
        temporary.write_all(&bytes)?;
        temporary.as_file().sync_all()?;
        temporary.persist(&self.path).map_err(|error| error.error)?;

        sync_directory(parent)?;
        Ok(())
    }
}

// Read only settings that still belong to the companion. All other legacy data is discarded.
#[derive(Deserialize)]
struct LegacySnapshot {
    settings: LegacySettings,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct LegacySettings {
    companion_name: String,
    user_name: String,
    onboarding_complete: bool,
}

impl Default for LegacySettings {
    fn default() -> Self {
        let settings = CompanionSettings::default();
        Self {
            companion_name: settings.companion_name,
            user_name: settings.user_name,
            onboarding_complete: settings.onboarding_complete,
        }
    }
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> io::Result<()> {
    File::open(path)?.sync_all()
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::SCHEMA_VERSION;

    #[test]
    fn atomically_round_trips_a_valid_snapshot() {
        let directory = tempfile::tempdir().unwrap();
        let store = SnapshotStore::in_directory(directory.path());
        let mut snapshot = CompanionSnapshot::default();
        snapshot.settings.user_name = "Ari".to_owned();

        store.save(&snapshot).unwrap();
        snapshot.settings.user_name = "Mina".to_owned();
        store.save(&snapshot).unwrap();

        assert_eq!(store.load().unwrap(), Some(snapshot));
        assert!(directory.path().read_dir().unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".tmp")
        }));
    }

    #[test]
    fn rejects_invalid_persisted_snapshot() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("invalid.json");
        let store = SnapshotStore::at_path(&path);
        let invalid = format!(
            r#"{{"schemaVersion":{},"settings":{{"companionName":"","userName":"","onboardingComplete":false}}}}"#,
            SCHEMA_VERSION
        );
        fs::write(path, invalid).unwrap();

        assert!(matches!(store.load(), Err(PersistenceError::Validation(_))));
    }

    #[test]
    fn migrates_legacy_settings_and_erases_removed_data_from_disk() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(SNAPSHOT_FILE_NAME);
        let store = SnapshotStore::in_directory(directory.path());
        fs::write(
            &path,
            serde_json::to_vec(&serde_json::json!({
                "schemaVersion": 1,
                "settings": {
                    "companionName": "Nova",
                    "userName": "Ari",
                    "onboardingComplete": true,
                    "budget": "everyday",
                    "dietary": ["old preference"],
                    "meals": [{ "id": "breakfast" }]
                },
                "history": [{ "choiceId": "old choice" }],
                "runtime": { "activePrompt": { "mealId": "breakfast" } }
            }))
            .unwrap(),
        )
        .unwrap();

        let restored = store.load().unwrap().unwrap();
        assert_eq!(restored.schema_version, SCHEMA_VERSION);
        assert_eq!(restored.settings.companion_name, "Nova");
        assert_eq!(restored.settings.user_name, "Ari");
        assert!(restored.settings.onboarding_complete);
        let persisted: serde_json::Value =
            serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        assert_eq!(persisted, serde_json::to_value(restored).unwrap());
        assert_eq!(persisted.as_object().unwrap().len(), 2);
        assert_eq!(persisted["settings"].as_object().unwrap().len(), 3);
    }

    #[test]
    fn migrates_only_the_exact_retired_default_name_and_rewrites_current_snapshots() {
        for version in [1, SCHEMA_VERSION] {
            for name in ["饭点儿", "Nova", "饭点儿的小精灵", " 饭点儿 "] {
                let directory = tempfile::tempdir().unwrap();
                let path = directory.path().join(SNAPSHOT_FILE_NAME);
                let store = SnapshotStore::in_directory(directory.path());
                fs::write(
                    &path,
                    serde_json::to_vec(&serde_json::json!({
                        "schemaVersion": version,
                        "settings": {
                            "companionName": name,
                            "userName": "Ari",
                            "onboardingComplete": true,
                        },
                    }))
                    .unwrap(),
                )
                .unwrap();

                let restored = store.load().unwrap().unwrap();
                assert_eq!(restored.schema_version, SCHEMA_VERSION);
                assert_eq!(
                    restored.settings.companion_name,
                    if name == "饭点儿" { "Nyx" } else { name },
                );
                assert_eq!(restored.settings.user_name, "Ari");
                assert!(restored.settings.onboarding_complete);
                let persisted: serde_json::Value =
                    serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
                assert_eq!(persisted, serde_json::to_value(&restored).unwrap());
                assert_eq!(store.load().unwrap(), Some(restored));
            }
        }
    }

    #[test]
    fn rejects_unknown_json_fields() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("unknown.json");
        let store = SnapshotStore::at_path(&path);
        let mut value = serde_json::to_value(CompanionSnapshot::default()).unwrap();
        value["unexpected"] = serde_json::json!(true);
        fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();

        assert!(matches!(store.load(), Err(PersistenceError::Json(_))));
    }
}
