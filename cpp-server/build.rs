use std::{env, fs, io, path::Path};

fn copy_dir_recursive(src: &Path, dst: &Path) -> io::Result<()> {
    if !src.exists() {
        return Ok(());
    }
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else if ty.is_file() {
            if let Some(parent) = dst_path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

fn main() {
    cxx_build::bridge("src/lib.rs")
        .std("c++17")
        .compile("rapier-cxx-bridge");

    // Mirror generated cxx headers into a stable include path used by CMake:
    //   <repo>/cpp-server/target/cxxbridge/...
    // cxx-build writes headers under:
    //   $OUT_DIR/cxxbridge/include/...
    let out_dir = env::var("OUT_DIR").expect("OUT_DIR not set");
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR not set");
    let generated_include = Path::new(&out_dir).join("cxxbridge").join("include");
    let stable_include = Path::new(&manifest_dir).join("target").join("cxxbridge");
    if let Err(e) = copy_dir_recursive(&generated_include, &stable_include) {
        panic!(
            "failed to copy cxx generated headers from {} to {}: {}",
            generated_include.display(),
            stable_include.display(),
            e
        );
    }

    println!("cargo:rerun-if-changed=src/lib.rs");
}
