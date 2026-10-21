// Niente console aggiuntiva in release su Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    takeline_lib::run()
}
