// main.rs — desktop binary. Prevents the console window from appearing on
// Windows in release builds (and only in release builds).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    physics_tasks_lib::run()
}
