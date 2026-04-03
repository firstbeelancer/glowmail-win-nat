use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager};

pub struct AppDatabase {
    path: PathBuf,
    connection: Mutex<Connection>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInfo {
    pub path: String,
    pub provider: String,
    pub fts_enabled: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedFolderRecord {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub children: Option<Vec<CachedFolderRecord>>,
    pub parent: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedContact {
    pub id: String,
    pub name: String,
    pub email: String,
    pub avatar: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedAttachment {
    pub id: String,
    pub name: String,
    pub size: i64,
    pub r#type: String,
    pub url: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedCryptoInfo {
    pub r#type: Option<String>,
    pub signed: bool,
    pub encrypted: bool,
    pub verified: Option<bool>,
    pub verification_error: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedEmailRecord {
    pub id: String,
    pub folder_id: String,
    pub from: CachedContact,
    pub to: Vec<CachedContact>,
    pub cc: Option<Vec<CachedContact>>,
    pub bcc: Option<Vec<CachedContact>>,
    pub subject: String,
    pub body: String,
    pub snippet: String,
    pub date: String,
    pub read: bool,
    pub starred: bool,
    pub tags: Vec<String>,
    pub importance: Option<String>,
    pub attachments: Vec<CachedAttachment>,
    pub crypto_info: Option<CachedCryptoInfo>,
    pub headers: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheSearchRequest {
    pub account_email: String,
    pub folder_path: String,
    pub query: String,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedSearchResponse {
    pub emails: Vec<CachedEmailRecord>,
    pub total: i64,
    pub has_more: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheDeleteEmailRequest {
    pub account_email: String,
    pub folder_path: String,
    pub email_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheEmailDetailRequest {
    pub account_email: String,
    pub folder_path: String,
    pub email_id: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSyncStateRecord {
    pub account_email: String,
    pub folder_path: String,
    pub last_uid: Option<i64>,
    pub last_sync_started_at: Option<String>,
    pub last_sync_finished_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSyncStateRequest {
    pub account_email: String,
    pub folder_path: String,
    pub last_uid: Option<i64>,
    pub last_error: Option<String>,
}

impl AppDatabase {
    pub fn initialize(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let app_data_dir = app.path().app_data_dir()?;
        fs::create_dir_all(&app_data_dir)?;

        let db_path = app_data_dir.join("glowmail.db");
        let connection = Connection::open(&db_path)?;

        connection.execute_batch(
      r#"
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA synchronous = NORMAL;
      PRAGMA temp_store = MEMORY;

      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT,
        imap_host TEXT,
        imap_port INTEGER,
        smtp_host TEXT,
        smtp_port INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_email TEXT NOT NULL,
        folder_path TEXT NOT NULL,
        display_name TEXT NOT NULL,
        delimiter TEXT,
        flags_json TEXT,
        unread_count INTEGER NOT NULL DEFAULT 0,
        total_count INTEGER NOT NULL DEFAULT 0,
        last_synced_at TEXT,
        UNIQUE(account_email, folder_path)
      );

      CREATE TABLE IF NOT EXISTS emails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_email TEXT NOT NULL,
        folder_path TEXT NOT NULL,
        uid INTEGER NOT NULL,
        message_id TEXT,
        thread_id TEXT,
        subject TEXT NOT NULL DEFAULT '',
        sender_name TEXT NOT NULL DEFAULT '',
        sender_email TEXT NOT NULL DEFAULT '',
        recipients_to TEXT NOT NULL DEFAULT '',
        recipients_cc TEXT NOT NULL DEFAULT '',
        sent_at TEXT,
        snippet TEXT NOT NULL DEFAULT '',
        body_plain TEXT NOT NULL DEFAULT '',
        body_html TEXT NOT NULL DEFAULT '',
        flags_json TEXT NOT NULL DEFAULT '[]',
        labels_json TEXT NOT NULL DEFAULT '[]',
        attachments_json TEXT NOT NULL DEFAULT '[]',
        headers_json TEXT NOT NULL DEFAULT '{}',
        has_attachments INTEGER NOT NULL DEFAULT 0,
        is_read INTEGER NOT NULL DEFAULT 0,
        is_starred INTEGER NOT NULL DEFAULT 0,
        cached_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(account_email, folder_path, uid)
      );

      CREATE TABLE IF NOT EXISTS sync_state (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_email TEXT NOT NULL,
        folder_path TEXT NOT NULL,
        last_uid INTEGER,
        last_sync_started_at TEXT,
        last_sync_finished_at TEXT,
        last_error TEXT,
        UNIQUE(account_email, folder_path)
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS emails_fts USING fts5(
        subject,
        participants,
        body_plain,
        content='emails',
        content_rowid='id'
      );

      CREATE TRIGGER IF NOT EXISTS emails_ai AFTER INSERT ON emails BEGIN
        INSERT INTO emails_fts(rowid, subject, participants, body_plain)
        VALUES (
          new.id,
          new.subject,
          trim(new.sender_name || ' ' || new.sender_email || ' ' || new.recipients_to || ' ' || new.recipients_cc),
          new.body_plain
        );
      END;

      CREATE TRIGGER IF NOT EXISTS emails_ad AFTER DELETE ON emails BEGIN
        INSERT INTO emails_fts(emails_fts, rowid, subject, participants, body_plain)
        VALUES ('delete', old.id, old.subject, trim(old.sender_name || ' ' || old.sender_email || ' ' || old.recipients_to || ' ' || old.recipients_cc), old.body_plain);
      END;

      CREATE TRIGGER IF NOT EXISTS emails_au AFTER UPDATE ON emails BEGIN
        INSERT INTO emails_fts(emails_fts, rowid, subject, participants, body_plain)
        VALUES ('delete', old.id, old.subject, trim(old.sender_name || ' ' || old.sender_email || ' ' || old.recipients_to || ' ' || old.recipients_cc), old.body_plain);
        INSERT INTO emails_fts(rowid, subject, participants, body_plain)
        VALUES (
          new.id,
          new.subject,
          trim(new.sender_name || ' ' || new.sender_email || ' ' || new.recipients_to || ' ' || new.recipients_cc),
          new.body_plain
        );
      END;
      "#,
    )?;

        Ok(Self {
            path: db_path,
            connection: Mutex::new(connection),
        })
    }

    pub fn info(&self) -> DatabaseInfo {
        DatabaseInfo {
            path: self.path.display().to_string(),
            provider: "sqlite".to_string(),
            fts_enabled: self.connection.lock().is_ok(),
        }
    }

    pub fn upsert_folders(
        &self,
        account_email: &str,
        folders: &[CachedFolderRecord],
    ) -> Result<(), String> {
        let mut connection = self.connection.lock().map_err(|err| err.to_string())?;
        let transaction = connection.transaction().map_err(|err| err.to_string())?;

        for folder in folders {
            let flags_json = serde_json::json!({
                "icon": folder.icon,
                "children": folder.children,
            })
            .to_string();

            transaction
                .execute(
                    r#"
                    INSERT INTO folders (
                      account_email, folder_path, display_name, delimiter, flags_json, unread_count, total_count, last_synced_at
                    ) VALUES (?1, ?2, ?3, '/', ?4, 0, 0, CURRENT_TIMESTAMP)
                    ON CONFLICT(account_email, folder_path) DO UPDATE SET
                      display_name=excluded.display_name,
                      flags_json=excluded.flags_json,
                      last_synced_at=CURRENT_TIMESTAMP
                    "#,
                    params![account_email, folder.id, folder.name, flags_json],
                )
                .map_err(|err| err.to_string())?;
        }

        transaction.commit().map_err(|err| err.to_string())
    }

    pub fn get_folders(&self, account_email: &str) -> Result<Vec<CachedFolderRecord>, String> {
        let connection = self.connection.lock().map_err(|err| err.to_string())?;
        let mut statement = connection
            .prepare(
                r#"
                SELECT folder_path, display_name, flags_json
                FROM folders
                WHERE account_email = ?1
                ORDER BY CASE WHEN folder_path = 'INBOX' THEN 0 ELSE 1 END, display_name
                "#,
            )
            .map_err(|err| err.to_string())?;

        let rows = statement
            .query_map([account_email], |row| {
                let flags_json: String = row.get(2)?;
                let parsed_flags: serde_json::Value =
                    serde_json::from_str(&flags_json).unwrap_or_default();

                Ok(CachedFolderRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    icon: parsed_flags
                        .get("icon")
                        .and_then(|value| value.as_str())
                        .unwrap_or("folder")
                        .to_string(),
                    children: None,
                    parent: None,
                })
            })
            .map_err(|err| err.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())
    }

    pub fn upsert_emails(
        &self,
        account_email: &str,
        folder_path: &str,
        emails: &[CachedEmailRecord],
    ) -> Result<(), String> {
        let mut connection = self.connection.lock().map_err(|err| err.to_string())?;
        let transaction = connection.transaction().map_err(|err| err.to_string())?;

        for email in emails {
            let uid = email.id.parse::<i64>().unwrap_or_default();
            let recipients_to = serde_json::to_string(&email.to).map_err(|err| err.to_string())?;
            let recipients_cc = serde_json::to_string(&email.cc.clone().unwrap_or_default())
                .map_err(|err| err.to_string())?;
            let flags_json = serde_json::json!({
                "read": email.read,
                "starred": email.starred,
                "importance": email.importance,
            })
            .to_string();
            let labels_json = serde_json::to_string(&email.tags).map_err(|err| err.to_string())?;
            let attachments_json =
                serde_json::to_string(&email.attachments).map_err(|err| err.to_string())?;
            let headers_json =
                serde_json::to_string(&email.headers).map_err(|err| err.to_string())?;
            let body_plain = if email.body.trim().is_empty() {
                String::new()
            } else {
                strip_html(&email.body)
            };

            transaction
                .execute(
                    r#"
                    INSERT INTO emails (
                      account_email, folder_path, uid, message_id, thread_id, subject, sender_name, sender_email,
                      recipients_to, recipients_cc, sent_at, snippet, body_plain, body_html, flags_json, labels_json,
                      attachments_json, headers_json, has_attachments, is_read, is_starred, cached_at, updated_at
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    ON CONFLICT(account_email, folder_path, uid) DO UPDATE SET
                      message_id=excluded.message_id,
                      thread_id=excluded.thread_id,
                      subject=excluded.subject,
                      sender_name=excluded.sender_name,
                      sender_email=excluded.sender_email,
                      recipients_to=excluded.recipients_to,
                      recipients_cc=excluded.recipients_cc,
                      sent_at=excluded.sent_at,
                      snippet=CASE
                        WHEN excluded.snippet <> '' THEN excluded.snippet
                        ELSE emails.snippet
                      END,
                      body_plain=CASE
                        WHEN excluded.body_plain <> '' THEN excluded.body_plain
                        ELSE emails.body_plain
                      END,
                      body_html=CASE
                        WHEN excluded.body_html <> '' THEN excluded.body_html
                        ELSE emails.body_html
                      END,
                      flags_json=excluded.flags_json,
                      labels_json=excluded.labels_json,
                      attachments_json=CASE
                        WHEN excluded.attachments_json <> '[]' THEN excluded.attachments_json
                        ELSE emails.attachments_json
                      END,
                      headers_json=CASE
                        WHEN excluded.headers_json <> '{}' THEN excluded.headers_json
                        ELSE emails.headers_json
                      END,
                      has_attachments=CASE
                        WHEN excluded.has_attachments <> 0 THEN excluded.has_attachments
                        ELSE emails.has_attachments
                      END,
                      is_read=CASE
                        WHEN excluded.is_read <> 0 THEN excluded.is_read
                        ELSE emails.is_read
                      END,
                      is_starred=CASE
                        WHEN excluded.is_starred <> 0 THEN excluded.is_starred
                        ELSE emails.is_starred
                      END,
                      updated_at=CURRENT_TIMESTAMP
                    "#,
                    params![
                        account_email,
                        folder_path,
                        uid,
                        email.headers.get("messageId").and_then(|value| value.as_str()).unwrap_or(""),
                        "",
                        email.subject,
                        email.from.name,
                        email.from.email,
                        recipients_to,
                        recipients_cc,
                        email.date,
                        email.snippet,
                        body_plain,
                        email.body,
                        flags_json,
                        labels_json,
                        attachments_json,
                        headers_json,
                        if email.attachments.is_empty() { 0 } else { 1 },
                        if email.read { 1 } else { 0 },
                        if email.starred { 1 } else { 0 },
                    ],
                )
                .map_err(|err| err.to_string())?;
        }

        transaction.commit().map_err(|err| err.to_string())
    }

    pub fn get_folder_emails(
        &self,
        account_email: &str,
        folder_path: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<CachedEmailRecord>, String> {
        let connection = self.connection.lock().map_err(|err| err.to_string())?;
        let mut statement = connection
            .prepare(
                r#"
                SELECT uid, folder_path, subject, sender_name, sender_email, recipients_to, recipients_cc,
                       sent_at, snippet, '' as body_html, labels_json, attachments_json, headers_json, is_read, is_starred
                FROM emails
                WHERE account_email = ?1 AND folder_path = ?2
                ORDER BY datetime(sent_at) DESC
                LIMIT ?3 OFFSET ?4
                "#,
            )
            .map_err(|err| err.to_string())?;

        let rows = statement
            .query_map(params![account_email, folder_path, limit, offset], |row| {
                map_cached_email_row(row)
            })
            .map_err(|err| err.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())
    }

    pub fn get_email_detail(
        &self,
        request: &CacheEmailDetailRequest,
    ) -> Result<Option<CachedEmailRecord>, String> {
        let connection = self.connection.lock().map_err(|err| err.to_string())?;
        let uid = request.email_id.parse::<i64>().unwrap_or_default();
        let mut statement = connection
            .prepare(
                r#"
                SELECT uid, folder_path, subject, sender_name, sender_email, recipients_to, recipients_cc,
                       sent_at, snippet, body_html, labels_json, attachments_json, headers_json, is_read, is_starred
                FROM emails
                WHERE account_email = ?1 AND folder_path = ?2 AND uid = ?3
                LIMIT 1
                "#,
            )
            .map_err(|err| err.to_string())?;

        let mut rows = statement
            .query(params![request.account_email, request.folder_path, uid])
            .map_err(|err| err.to_string())?;

        rows.next()
            .map_err(|err| err.to_string())?
            .map(map_cached_email_row)
            .transpose()
            .map_err(|err| err.to_string())
    }

    pub fn search_emails(
        &self,
        request: &CacheSearchRequest,
    ) -> Result<CachedSearchResponse, String> {
        let connection = self.connection.lock().map_err(|err| err.to_string())?;
        let search_term = normalize_search_query(&request.query);

        let total: i64 = connection
            .query_row(
                r#"
                SELECT COUNT(*)
                FROM emails_fts
                JOIN emails ON emails.id = emails_fts.rowid
                WHERE emails.account_email = ?1
                  AND emails.folder_path = ?2
                  AND emails_fts MATCH ?3
                "#,
                params![request.account_email, request.folder_path, search_term],
                |row| row.get(0),
            )
            .map_err(|err| err.to_string())?;

        let mut statement = connection
            .prepare(
                r#"
                SELECT emails.uid, emails.folder_path, emails.subject, emails.sender_name, emails.sender_email,
                       emails.recipients_to, emails.recipients_cc, emails.sent_at, emails.snippet, '' as body_html,
                       emails.labels_json, emails.attachments_json, emails.headers_json, emails.is_read, emails.is_starred
                FROM emails_fts
                JOIN emails ON emails.id = emails_fts.rowid
                WHERE emails.account_email = ?1
                  AND emails.folder_path = ?2
                  AND emails_fts MATCH ?3
                ORDER BY bm25(emails_fts), datetime(emails.sent_at) DESC
                LIMIT ?4 OFFSET ?5
                "#,
            )
            .map_err(|err| err.to_string())?;

        let rows = statement
            .query_map(
                params![
                    request.account_email,
                    request.folder_path,
                    search_term,
                    request.limit,
                    request.offset
                ],
                |row| map_cached_email_row(row),
            )
            .map_err(|err| err.to_string())?;

        let emails = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())?;

        Ok(CachedSearchResponse {
            has_more: request.offset + request.limit < total,
            emails,
            total,
        })
    }

    pub fn delete_email(&self, request: &CacheDeleteEmailRequest) -> Result<(), String> {
        let connection = self.connection.lock().map_err(|err| err.to_string())?;
        let uid = request.email_id.parse::<i64>().unwrap_or_default();

        connection
            .execute(
                r#"
                DELETE FROM emails
                WHERE account_email = ?1 AND folder_path = ?2 AND uid = ?3
                "#,
                params![request.account_email, request.folder_path, uid],
            )
            .map_err(|err| err.to_string())?;

        Ok(())
    }

    pub fn mark_folder_sync_started(
        &self,
        request: &FolderSyncStateRequest,
    ) -> Result<(), String> {
        let connection = self.connection.lock().map_err(|err| err.to_string())?;

        connection
            .execute(
                r#"
                INSERT INTO sync_state (
                  account_email, folder_path, last_uid, last_sync_started_at, last_sync_finished_at, last_error
                ) VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP, NULL, NULL)
                ON CONFLICT(account_email, folder_path) DO UPDATE SET
                  last_uid = COALESCE(excluded.last_uid, sync_state.last_uid),
                  last_sync_started_at = CURRENT_TIMESTAMP,
                  last_sync_finished_at = NULL,
                  last_error = NULL
                "#,
                params![request.account_email, request.folder_path, request.last_uid],
            )
            .map_err(|err| err.to_string())?;

        Ok(())
    }

    pub fn mark_folder_sync_finished(
        &self,
        request: &FolderSyncStateRequest,
    ) -> Result<(), String> {
        let connection = self.connection.lock().map_err(|err| err.to_string())?;

        connection
            .execute(
                r#"
                INSERT INTO sync_state (
                  account_email, folder_path, last_uid, last_sync_started_at, last_sync_finished_at, last_error
                ) VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?4)
                ON CONFLICT(account_email, folder_path) DO UPDATE SET
                  last_uid = COALESCE(excluded.last_uid, sync_state.last_uid),
                  last_sync_finished_at = CURRENT_TIMESTAMP,
                  last_error = excluded.last_error
                "#,
                params![
                    request.account_email,
                    request.folder_path,
                    request.last_uid,
                    request.last_error
                ],
            )
            .map_err(|err| err.to_string())?;

        Ok(())
    }

    pub fn get_folder_sync_states(
        &self,
        account_email: &str,
    ) -> Result<Vec<FolderSyncStateRecord>, String> {
        let connection = self.connection.lock().map_err(|err| err.to_string())?;
        let mut statement = connection
            .prepare(
                r#"
                SELECT account_email, folder_path, last_uid, last_sync_started_at, last_sync_finished_at, last_error
                FROM sync_state
                WHERE account_email = ?1
                ORDER BY folder_path
                "#,
            )
            .map_err(|err| err.to_string())?;

        let rows = statement
            .query_map([account_email], |row| {
                Ok(FolderSyncStateRecord {
                    account_email: row.get(0)?,
                    folder_path: row.get(1)?,
                    last_uid: row.get(2)?,
                    last_sync_started_at: row.get(3)?,
                    last_sync_finished_at: row.get(4)?,
                    last_error: row.get(5)?,
                })
            })
            .map_err(|err| err.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())
    }
}

fn strip_html(html: &str) -> String {
    let mut plain = String::with_capacity(html.len());
    let mut inside_tag = false;

    for ch in html.chars() {
        match ch {
            '<' => inside_tag = true,
            '>' => {
                inside_tag = false;
                plain.push(' ');
            }
            _ if !inside_tag => plain.push(ch),
            _ => {}
        }
    }

    plain.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn normalize_search_query(query: &str) -> String {
    query
        .split_whitespace()
        .map(|token| format!("\"{}\"*", token.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" ")
}

fn map_cached_email_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CachedEmailRecord> {
    let recipients_to: String = row.get(5)?;
    let recipients_cc: String = row.get(6)?;
    let labels_json: String = row.get(10)?;
    let attachments_json: String = row.get(11)?;
    let headers_json: String = row.get(12)?;
    let subject: String = row.get(2)?;
    let body_html: String = row.get(9)?;

    Ok(CachedEmailRecord {
        id: row.get::<_, i64>(0)?.to_string(),
        folder_id: row.get(1)?,
        from: CachedContact {
            id: row.get::<_, String>(4)?,
            name: row.get(3)?,
            email: row.get(4)?,
            avatar: None,
        },
        to: serde_json::from_str(&recipients_to).unwrap_or_default(),
        cc: Some(serde_json::from_str(&recipients_cc).unwrap_or_default()),
        bcc: Some(Vec::new()),
        subject: subject.clone(),
        body: body_html,
        snippet: row.get(8)?,
        date: row.get(7)?,
        read: row.get::<_, i64>(13)? != 0,
        starred: row.get::<_, i64>(14)? != 0,
        tags: serde_json::from_str(&labels_json).unwrap_or_default(),
        importance: None,
        attachments: serde_json::from_str(&attachments_json).unwrap_or_default(),
        crypto_info: None,
        headers: serde_json::from_str(&headers_json).unwrap_or_else(|_| {
            serde_json::json!({
                "messageId": format!("<cached-{}>", subject)
            })
        }),
    })
}
