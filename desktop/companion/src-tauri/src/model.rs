use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const SCHEMA_VERSION: u32 = 2;
pub const MAX_SNAPSHOT_BYTES: usize = 128 * 1024;
const MAX_NAME_CHARS: usize = 80;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompanionSettings {
    pub companion_name: String,
    pub user_name: String,
    pub onboarding_complete: bool,
}

impl Default for CompanionSettings {
    fn default() -> Self {
        Self {
            companion_name: "Nyx".to_owned(),
            user_name: String::new(),
            onboarding_complete: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompanionSnapshot {
    pub schema_version: u32,
    pub settings: CompanionSettings,
}

impl Default for CompanionSnapshot {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            settings: CompanionSettings::default(),
        }
    }
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
#[error("{message}")]
pub struct ValidationError {
    message: String,
}

impl ValidationError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl CompanionSnapshot {
    pub fn validate(&self) -> Result<(), ValidationError> {
        if self.schema_version != SCHEMA_VERSION {
            return Err(ValidationError::new(format!(
                "unsupported schema version {}",
                self.schema_version
            )));
        }
        self.settings.validate()?;
        let encoded = serde_json::to_vec(self).map_err(|error| {
            ValidationError::new(format!("snapshot cannot be encoded: {error}"))
        })?;
        if encoded.len() > MAX_SNAPSHOT_BYTES {
            return Err(ValidationError::new("snapshot JSON is too large"));
        }
        Ok(())
    }
}

impl CompanionSettings {
    pub fn validate(&self) -> Result<(), ValidationError> {
        validate_name(&self.companion_name, "companionName", 1)?;
        validate_name(&self.user_name, "userName", 0)
    }
}

fn validate_name(value: &str, field: &str, minimum: usize) -> Result<(), ValidationError> {
    let trimmed = value.trim();
    if !(minimum..=MAX_NAME_CHARS).contains(&trimmed.chars().count()) {
        return Err(ValidationError::new(format!(
            "{field} must contain between {minimum} and {MAX_NAME_CHARS} characters"
        )));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(ValidationError::new(format!(
            "{field} may not contain control characters"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_snapshot_is_valid() {
        CompanionSnapshot::default().validate().unwrap();
    }

    #[test]
    fn rejects_blank_and_control_character_names() {
        let mut settings = CompanionSettings {
            companion_name: " ".into(),
            ..CompanionSettings::default()
        };
        assert!(settings.validate().is_err());
        settings.companion_name = "Nyx".into();
        settings.user_name = "A\nB".into();
        assert!(settings.validate().is_err());
    }
}
