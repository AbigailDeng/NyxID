use std::sync::{Mutex, MutexGuard};

use crate::model::{CompanionSettings, CompanionSnapshot};
use crate::persistence::SnapshotStore;

pub struct CompanionState {
    snapshot: Mutex<CompanionSnapshot>,
    transaction: Mutex<()>,
    store: SnapshotStore,
}

pub struct StateUpdate {
    pub snapshot: CompanionSnapshot,
    pub changed: bool,
}

impl CompanionState {
    pub fn new(snapshot: CompanionSnapshot, store: SnapshotStore) -> Self {
        Self {
            snapshot: Mutex::new(snapshot),
            transaction: Mutex::new(()),
            store,
        }
    }

    pub fn snapshot(&self) -> Result<CompanionSnapshot, String> {
        Ok(self.lock()?.clone())
    }

    pub fn replace_settings(
        &self,
        settings: CompanionSettings,
        effect: impl FnOnce(&StateUpdate) -> Result<(), String>,
    ) -> Result<StateUpdate, String> {
        let _transaction = self
            .transaction
            .lock()
            .map_err(|_| "companion transaction lock is poisoned".to_owned())?;
        let mut guard = self.lock()?;
        let candidate = CompanionSnapshot {
            settings,
            ..guard.clone()
        };
        candidate.validate().map_err(|error| error.to_string())?;
        let changed = candidate != *guard;
        if changed {
            self.store
                .save(&candidate)
                .map_err(|error| error.to_string())?;
            *guard = candidate.clone();
        }
        let update = StateUpdate {
            snapshot: candidate,
            changed,
        };
        drop(guard);
        effect(&update)?;
        Ok(update)
    }

    fn lock(&self) -> Result<MutexGuard<'_, CompanionSnapshot>, String> {
        self.snapshot
            .lock()
            .map_err(|_| "companion state lock is poisoned".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex, mpsc};
    use std::thread;

    use super::*;

    #[test]
    fn invalid_updates_do_not_change_or_persist_state() {
        let directory = tempfile::tempdir().unwrap();
        let store = SnapshotStore::in_directory(directory.path());
        let snapshot = CompanionSnapshot::default();
        store.save(&snapshot).unwrap();
        let state = CompanionState::new(snapshot.clone(), store.clone());
        let mut invalid = snapshot.settings.clone();
        invalid.companion_name.clear();

        assert!(state.replace_settings(invalid, |_| Ok(())).is_err());
        assert_eq!(state.snapshot().unwrap(), snapshot);
        assert_eq!(store.load().unwrap(), Some(snapshot));
    }

    #[test]
    fn serializes_effects_with_the_mutation_that_produced_them() {
        let directory = tempfile::tempdir().unwrap();
        let store = SnapshotStore::in_directory(directory.path());
        let snapshot = CompanionSnapshot::default();
        store.save(&snapshot).unwrap();
        let state = Arc::new(CompanionState::new(snapshot, store));
        let effects = Arc::new(Mutex::new(Vec::new()));
        let (first_effect_started_tx, first_effect_started_rx) = mpsc::channel();
        let (release_first_effect_tx, release_first_effect_rx) = mpsc::channel();
        let (second_mutation_started_tx, second_mutation_started_rx) = mpsc::channel();

        let first_state = Arc::clone(&state);
        let first_effects = Arc::clone(&effects);
        let first = thread::spawn(move || {
            first_state
                .replace_settings(
                    CompanionSettings {
                        user_name: "First".into(),
                        ..CompanionSettings::default()
                    },
                    |_| {
                        first_effects.lock().unwrap().push("first-started");
                        first_effect_started_tx.send(()).unwrap();
                        release_first_effect_rx.recv().unwrap();
                        first_effects.lock().unwrap().push("first-finished");
                        Ok(())
                    },
                )
                .unwrap();
        });
        first_effect_started_rx.recv().unwrap();

        let second_state = Arc::clone(&state);
        let second_effects = Arc::clone(&effects);
        let second = thread::spawn(move || {
            second_mutation_started_tx.send(()).unwrap();
            second_state
                .replace_settings(
                    CompanionSettings {
                        user_name: "Second".into(),
                        ..CompanionSettings::default()
                    },
                    |_| {
                        second_effects.lock().unwrap().push("second");
                        Ok(())
                    },
                )
                .unwrap();
        });
        second_mutation_started_rx.recv().unwrap();
        assert_eq!(*effects.lock().unwrap(), ["first-started"]);
        release_first_effect_tx.send(()).unwrap();
        first.join().unwrap();
        second.join().unwrap();
        assert_eq!(
            *effects.lock().unwrap(),
            ["first-started", "first-finished", "second"]
        );
        assert_eq!(state.snapshot().unwrap().settings.user_name, "Second");
    }
}
