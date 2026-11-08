//! Where downloads go: the Downloads folder, never over an existing file.

use std::path::{Path, PathBuf};

/// `dir/name`, or `dir/name (1).ext`, `(2)`… when that's taken. Only the file name of `name` is used.
pub fn unique_path(dir: &Path, name: &str, exists: impl Fn(&Path) -> bool) -> PathBuf {
    let base = Path::new(name)
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty())
        .unwrap_or("download");
    let first = dir.join(base);
    if !exists(&first) {
        return first;
    }
    let stem = Path::new(base).file_stem().and_then(|s| s.to_str()).unwrap_or(base);
    let ext = Path::new(base).extension().and_then(|e| e.to_str());
    (1..)
        .map(|n| match ext {
            Some(ext) => dir.join(format!("{stem} ({n}).{ext}")),
            None => dir.join(format!("{stem} ({n})")),
        })
        .find(|p| !exists(p))
        .expect("some number is free")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn taken(names: &'static [&'static str]) -> impl Fn(&Path) -> bool {
        move |p| names.iter().any(|n| p == Path::new("/d").join(n))
    }

    #[test]
    fn keeps_a_free_name() {
        assert_eq!(unique_path(Path::new("/d"), "a.zip", taken(&[])), PathBuf::from("/d/a.zip"));
    }

    #[test]
    fn numbers_a_taken_name() {
        assert_eq!(unique_path(Path::new("/d"), "a.zip", taken(&["a.zip"])), PathBuf::from("/d/a (1).zip"));
        assert_eq!(unique_path(Path::new("/d"), "a.zip", taken(&["a.zip", "a (1).zip"])), PathBuf::from("/d/a (2).zip"));
        assert_eq!(unique_path(Path::new("/d"), "noext", taken(&["noext"])), PathBuf::from("/d/noext (1)"));
    }

    #[test]
    fn stays_inside_the_folder() {
        assert_eq!(unique_path(Path::new("/d"), "../x.csv", taken(&[])), PathBuf::from("/d/x.csv"));
        assert_eq!(unique_path(Path::new("/d"), "", taken(&[])), PathBuf::from("/d/download"));
        assert_eq!(unique_path(Path::new("/d"), "..", taken(&[])), PathBuf::from("/d/download"));
    }
}
