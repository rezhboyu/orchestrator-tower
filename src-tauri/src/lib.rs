mod commands;
pub mod db;
pub mod git;
mod ipc;
pub mod lifecycle;
pub mod recovery;
mod state;

use db::DatabaseRegistry;
use ipc::IpcState;
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(AppState::new())
        .manage(IpcState::default())
        .manage(DatabaseRegistry::default())
        .invoke_handler(tauri::generate_handler![
            // 既有指令
            commands::start_agent,
            commands::stop_agent,
            commands::approve_hitl,
            commands::deny_hitl,
            commands::rollback_to_node,
            commands::get_app_state,
            // Task 16：專案與 Agent 生命週期
            commands::create_project,
            commands::delete_project,
            commands::list_projects,
            commands::create_agent,
            commands::remove_agent,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
