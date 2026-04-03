mod database;
mod native_mail;
mod secret_store;

use database::{AppDatabase, DatabaseInfo};
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopBootstrap {
    backend_provider: String,
    database: DatabaseInfo,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeInvokeRequest {
    function_name: String,
    payload: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheFoldersRequest {
    account_email: String,
    folders: Vec<database::CachedFolderRecord>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheEmailsRequest {
    account_email: String,
    folder_path: String,
    emails: Vec<database::CachedEmailRecord>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheDeleteEmailRequest {
    account_email: String,
    folder_path: String,
    email_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FolderSyncStateRequest {
    account_email: String,
    folder_path: String,
    last_uid: Option<i64>,
    last_error: Option<String>,
}

#[tauri::command]
fn secret_store_set(secret_key: String, secret_value: String) -> Result<(), String> {
    secret_store::set_secret(&secret_key, &secret_value)
}

#[tauri::command]
fn secret_store_get(secret_key: String) -> Result<Option<String>, String> {
    secret_store::get_secret(&secret_key)
}

#[tauri::command]
fn secret_store_delete(secret_key: String) -> Result<(), String> {
    secret_store::delete_secret(&secret_key)
}

#[tauri::command]
fn get_desktop_bootstrap(database: tauri::State<AppDatabase>) -> DesktopBootstrap {
    DesktopBootstrap {
        backend_provider: "supabase".to_string(),
        database: database.info(),
    }
}

#[tauri::command]
fn native_backend_invoke(request: NativeInvokeRequest) -> Result<serde_json::Value, String> {
    native_mail::invoke(&request.function_name, request.payload)
}

#[tauri::command]
fn cache_upsert_folders(
    request: CacheFoldersRequest,
    database: tauri::State<AppDatabase>,
) -> Result<(), String> {
    database.upsert_folders(&request.account_email, &request.folders)
}

#[tauri::command]
fn cache_get_folders(
    account_email: String,
    database: tauri::State<AppDatabase>,
) -> Result<Vec<database::CachedFolderRecord>, String> {
    database.get_folders(&account_email)
}

#[tauri::command]
fn cache_upsert_emails(
    request: CacheEmailsRequest,
    database: tauri::State<AppDatabase>,
) -> Result<(), String> {
    database.upsert_emails(
        &request.account_email,
        &request.folder_path,
        &request.emails,
    )
}

#[tauri::command]
fn cache_get_folder_emails(
    account_email: String,
    folder_path: String,
    limit: i64,
    offset: i64,
    database: tauri::State<AppDatabase>,
) -> Result<Vec<database::CachedEmailRecord>, String> {
    database.get_folder_emails(&account_email, &folder_path, limit, offset)
}

#[tauri::command]
fn cache_search_emails(
    request: database::CacheSearchRequest,
    database: tauri::State<AppDatabase>,
) -> Result<database::CachedSearchResponse, String> {
    database.search_emails(&request)
}

#[tauri::command]
fn cache_delete_email(
    request: CacheDeleteEmailRequest,
    database: tauri::State<AppDatabase>,
) -> Result<(), String> {
    database.delete_email(&database::CacheDeleteEmailRequest {
        account_email: request.account_email,
        folder_path: request.folder_path,
        email_id: request.email_id,
    })
}

#[tauri::command]
fn cache_mark_folder_sync_started(
    request: FolderSyncStateRequest,
    database: tauri::State<AppDatabase>,
) -> Result<(), String> {
    database.mark_folder_sync_started(&database::FolderSyncStateRequest {
        account_email: request.account_email,
        folder_path: request.folder_path,
        last_uid: request.last_uid,
        last_error: request.last_error,
    })
}

#[tauri::command]
fn cache_mark_folder_sync_finished(
    request: FolderSyncStateRequest,
    database: tauri::State<AppDatabase>,
) -> Result<(), String> {
    database.mark_folder_sync_finished(&database::FolderSyncStateRequest {
        account_email: request.account_email,
        folder_path: request.folder_path,
        last_uid: request.last_uid,
        last_error: request.last_error,
    })
}

#[tauri::command]
fn cache_get_folder_sync_states(
    account_email: String,
    database: tauri::State<AppDatabase>,
) -> Result<Vec<database::FolderSyncStateRecord>, String> {
    database.get_folder_sync_states(&account_email)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let database = AppDatabase::initialize(app.handle())?;
            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_desktop_bootstrap,
            cache_upsert_folders,
            cache_get_folders,
            cache_upsert_emails,
            cache_get_folder_emails,
            cache_search_emails,
            cache_delete_email,
            cache_mark_folder_sync_started,
            cache_mark_folder_sync_finished,
            cache_get_folder_sync_states,
            secret_store_set,
            secret_store_get,
            secret_store_delete,
            native_backend_invoke
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
