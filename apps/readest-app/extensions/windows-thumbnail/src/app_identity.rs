/// Match the current reader executable and the legacy executable kept for upgrades.
pub(crate) fn is_reader_executable(path: &str) -> bool {
    path.rsplit(['\\', '/']).next().is_some_and(|name| {
        name.eq_ignore_ascii_case("Glossa.exe") || name.eq_ignore_ascii_case("Readest.exe")
    })
}

#[cfg(test)]
mod tests {
    use super::is_reader_executable;

    #[test]
    fn recognizes_glossa_and_legacy_readest_executables() {
        for path in [
            r"C:\Program Files\Glossa\Glossa.exe",
            r"D:\Apps\GLOSSA.EXE",
            r"C:\Program Files\Readest\Readest.exe",
            "C:/Apps/glossa.exe",
            "Readest.exe",
        ] {
            assert!(is_reader_executable(path), "reader path rejected: {path}");
        }
    }

    #[test]
    fn does_not_mistake_folder_names_or_other_executables_for_the_reader() {
        for path in [
            r"C:\Readest\OtherReader.exe",
            r"C:\Glossa\OtherReader.exe",
            r"C:\Apps\ReadestHelper.exe",
            r"C:\Apps\GlossaHelper.exe",
            "",
        ] {
            assert!(
                !is_reader_executable(path),
                "unrelated path accepted: {path}"
            );
        }
    }
}
