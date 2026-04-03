use base64::{engine::general_purpose::STANDARD, Engine as _};
use imap::types::Flag;
use lettre::message::{
    header::{InReplyTo, References},
    Mailbox, Message, MultiPart, SinglePart,
};
use lettre::transport::smtp::authentication::Credentials;
use lettre::transport::smtp::client::{Tls, TlsParameters};
use lettre::{SmtpTransport, Transport};
use mailparse::{addrparse, parse_mail, DispositionType, MailAddr, MailHeaderMap, ParsedMail};
use native_tls::TlsConnector;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::cmp::Ordering;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImapRequest {
    action: String,
    host: String,
    port: u16,
    username: String,
    password: String,
    folder: Option<String>,
    page: Option<u32>,
    page_size: Option<u32>,
    uid: Option<u32>,
    target_folder: Option<String>,
    add_flags: Option<Vec<String>>,
    remove_flags: Option<Vec<String>>,
    raw_message: Option<String>,
    flags: Option<Vec<String>>,
    attachment_index: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SmtpRequest {
    host: String,
    port: Option<u16>,
    username: String,
    password: String,
    from: Option<String>,
    to: Vec<String>,
    cc: Option<Vec<String>>,
    bcc: Option<Vec<String>>,
    subject: Option<String>,
    html: Option<String>,
    text: Option<String>,
    reply_to: Option<String>,
    in_reply_to: Option<String>,
    references: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Address {
    name: String,
    email: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentMeta {
    name: String,
    size: usize,
    r#type: String,
}

struct AttachmentPart {
    name: String,
    mime_type: String,
    content: Vec<u8>,
}

type ImapSession = imap::Session<imap::Connection>;

fn err_to_string<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

pub fn invoke(function_name: &str, payload: Value) -> Result<Value, String> {
    match function_name {
        "imap-proxy" => handle_imap(payload),
        "smtp-proxy" => handle_smtp(payload),
        _ => Err(format!(
            "Native backend function '{}' is not implemented yet.",
            function_name
        )),
    }
}

fn handle_imap(payload: Value) -> Result<Value, String> {
    let request: ImapRequest = serde_json::from_value(payload).map_err(|err| err.to_string())?;

    if matches!(
        request.action.as_str(),
        "list" | "fetch" | "fetch-attachment"
    ) {
        return handle_imap_raw(&request);
    }

    let mut session = connect_session(
        &request.host,
        request.port,
        &request.username,
        &request.password,
    )?;

    let result = match request.action.as_str() {
        "folders" => list_folders(&mut session),
        "list" => list_emails(&mut session, &request),
        "fetch" => fetch_email(&mut session, &request),
        "fetch-attachment" => fetch_attachment(&mut session, &request),
        "flags" => update_flags(&mut session, &request),
        "move" => move_email(&mut session, &request),
        "copy" => copy_email(&mut session, &request),
        "delete" => delete_email(&mut session, &request),
        "append" => append_message(&mut session, &request),
        other => Err(format!("Unsupported native IMAP action '{}'.", other)),
    };

    let _ = session.logout();
    result
}

fn handle_imap_raw(request: &ImapRequest) -> Result<Value, String> {
    let mut client = RawImapClient::connect(
        &request.host,
        request.port,
        &request.username,
        &request.password,
    )?;

    let result = match request.action.as_str() {
        "list" => raw_list_emails(&mut client, request),
        "fetch" => raw_fetch_email(&mut client, request),
        "fetch-attachment" => raw_fetch_attachment(&mut client, request),
        other => Err(format!("Unsupported raw IMAP action '{}'.", other)),
    };

    let _ = client.command("LOGOUT");
    result
}

fn handle_smtp(payload: Value) -> Result<Value, String> {
    let request: SmtpRequest = serde_json::from_value(payload).map_err(|err| err.to_string())?;

    if request.host.trim().is_empty()
        || request.username.trim().is_empty()
        || request.password.trim().is_empty()
    {
        return Err("Missing server credentials".to_string());
    }

    if request.to.is_empty() {
        return Err("Missing recipients".to_string());
    }

    let email = build_smtp_message(&request)?;
    let mailer = build_smtp_transport(&request)?;

    mailer.send(&email).map_err(|err| err.to_string())?;

    Ok(json!({ "success": true }))
}

fn connect_session(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
) -> Result<ImapSession, String> {
    let client = imap::ClientBuilder::new(host, port)
        .connect()
        .map_err(err_to_string)?;

    client
        .login(username, password)
        .map_err(|err| err.0.to_string())
}

fn build_smtp_message(request: &SmtpRequest) -> Result<Message, String> {
    let from_value = request
        .from
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&request.username);

    let mut builder = Message::builder()
        .from(parse_mailbox(from_value)?)
        .subject(
            request
                .subject
                .clone()
                .unwrap_or_else(|| "(No Subject)".to_string()),
        );

    if let Some(reply_to) = request
        .reply_to
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        builder = builder.reply_to(parse_mailbox(reply_to)?);
    }

    if let Some(in_reply_to) = request
        .in_reply_to
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        builder = builder.header(InReplyTo::from(in_reply_to.to_string()));
    }

    if let Some(references) = request
        .references
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        builder = builder.header(References::from(references.to_string()));
    }

    for recipient in &request.to {
        builder = builder.to(parse_mailbox(recipient)?);
    }

    for recipient in request.cc.clone().unwrap_or_default() {
        builder = builder.cc(parse_mailbox(&recipient)?);
    }

    for recipient in request.bcc.clone().unwrap_or_default() {
        builder = builder.bcc(parse_mailbox(&recipient)?);
    }

    let html = request.html.clone().unwrap_or_default();
    let text = request
        .text
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| strip_html_simple(&html));

    match (
        !text.trim().is_empty(),
        request
            .html
            .as_ref()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false),
    ) {
        (true, true) => builder
            .multipart(
                MultiPart::alternative()
                    .singlepart(SinglePart::plain(text))
                    .singlepart(SinglePart::html(html)),
            )
            .map_err(err_to_string),
        (true, false) => builder.body(text).map_err(err_to_string),
        (false, true) => builder.body(html).map_err(err_to_string),
        (false, false) => builder
            .body(String::new())
            .map_err(err_to_string),
    }
}

fn build_smtp_transport(request: &SmtpRequest) -> Result<SmtpTransport, String> {
    let host = request.host.trim();
    let port = request.port.unwrap_or(465);
    let tls_parameters = TlsParameters::new(host.to_string()).map_err(err_to_string)?;

    let mut builder = SmtpTransport::builder_dangerous(host).port(port).credentials(
        Credentials::new(request.username.clone(), request.password.clone()),
    );

    builder = match port {
        465 => builder.tls(Tls::Wrapper(tls_parameters)),
        587 => builder.tls(Tls::Required(tls_parameters)),
        25 => builder.tls(Tls::Opportunistic(tls_parameters)),
        _ => builder.tls(Tls::Required(tls_parameters)),
    };

    Ok(builder.build())
}

fn parse_mailbox(value: &str) -> Result<Mailbox, String> {
    value.trim().parse::<Mailbox>().map_err(err_to_string)
}

fn strip_html_simple(input: &str) -> String {
    let mut plain = String::with_capacity(input.len());
    let mut in_tag = false;

    for ch in input.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => plain.push(ch),
            _ => {}
        }
    }

    plain
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
}

fn list_folders(session: &mut ImapSession) -> Result<Value, String> {
    let names = session.list(None, Some("*")).map_err(err_to_string)?;

    let folders = names
        .iter()
        .map(|name: &imap::types::Name<'_>| {
            json!({
                "name": name.name(),
                "path": name.name(),
                "delimiter": name.delimiter(),
                "flags": name.attributes().iter().map(|attr| format!("{attr:?}")).collect::<Vec<_>>(),
            })
        })
        .collect::<Vec<_>>();

    Ok(json!({ "folders": folders }))
}

fn list_emails(session: &mut ImapSession, request: &ImapRequest) -> Result<Value, String> {
    let folder = request
        .folder
        .clone()
        .unwrap_or_else(|| "INBOX".to_string());
    let page = request.page.unwrap_or(1).max(1);
    let page_size = request.page_size.unwrap_or(50).max(1);

    let mailbox = session.select(&folder).map_err(err_to_string)?;
    let total = mailbox.exists;

    if total == 0 {
        return Ok(json!({
            "emails": [],
            "total": 0,
            "page": page,
            "pageSize": page_size,
            "hasMore": false,
        }));
    }

    let end = total.saturating_sub((page - 1) * page_size);
    if end == 0 {
        return Ok(json!({
            "emails": [],
            "total": total,
            "page": page,
            "pageSize": page_size,
            "hasMore": false,
        }));
    }
    let start = end.saturating_sub(page_size).saturating_add(1).max(1);
    let sequence = format!("{}:{}", start, end);

    let messages = session
        .fetch(
            sequence,
            "UID FLAGS ENVELOPE INTERNALDATE RFC822.HEADER",
        )
        .map_err(err_to_string)?;

    let mut emails: Vec<Value> = messages
        .iter()
        .filter_map(|message| map_list_message(message).ok())
        .collect();

    emails.sort_by(|a: &Value, b: &Value| {
        b.get("date")
            .and_then(Value::as_str)
            .cmp(&a.get("date").and_then(|value| value.as_str()))
            .then(Ordering::Equal)
    });

    Ok(json!({
        "emails": emails,
        "total": total,
        "page": page,
        "pageSize": page_size,
        "hasMore": start > 1,
    }))
}

fn raw_list_emails(client: &mut RawImapClient, request: &ImapRequest) -> Result<Value, String> {
    let folder = request
        .folder
        .clone()
        .unwrap_or_else(|| "INBOX".to_string());
    let page = request.page.unwrap_or(1).max(1) as usize;
    let page_size = request.page_size.unwrap_or(50).max(1) as usize;

    client.select(&folder)?;
    let all_uids = client.uid_search_all()?;
    let total = all_uids.len();

    if total == 0 {
        return Ok(json!({
            "emails": [],
            "total": 0,
            "page": page,
            "pageSize": page_size,
            "hasMore": false,
        }));
    }

    let mut newest_first = all_uids;
    newest_first.sort_unstable_by(|a, b| b.cmp(a));

    let offset = (page - 1) * page_size;
    let selected_uids: Vec<u32> = newest_first
        .into_iter()
        .skip(offset)
        .take(page_size)
        .collect();

    let mut emails = Vec::new();
    for uid in &selected_uids {
        if let Ok(email) = client.fetch_header_summary(*uid) {
            emails.push(email);
        }
    }

    Ok(json!({
        "emails": emails,
        "total": total,
        "page": page,
        "pageSize": page_size,
        "hasMore": offset + selected_uids.len() < total,
    }))
}

fn raw_fetch_email(client: &mut RawImapClient, request: &ImapRequest) -> Result<Value, String> {
    let folder = request
        .folder
        .clone()
        .unwrap_or_else(|| "INBOX".to_string());
    let uid = request.uid.ok_or_else(|| "Missing uid".to_string())?;

    client.select(&folder)?;
    let raw_message = client.fetch_full_message(uid)?;
    let parsed = parse_mail(&raw_message).map_err(err_to_string)?;

    let html = extract_best_body(&parsed, "text/html").unwrap_or_default();
    let text = extract_best_body(&parsed, "text/plain").unwrap_or_default();
    let attachments = collect_attachments(&parsed);

    Ok(json!({
        "html": html,
        "text": text,
        "bodyHtml": html,
        "bodyText": text,
        "attachments": attachments,
        "cryptoInfo": Value::Null,
    }))
}

fn raw_fetch_attachment(client: &mut RawImapClient, request: &ImapRequest) -> Result<Value, String> {
    let folder = request
        .folder
        .clone()
        .unwrap_or_else(|| "INBOX".to_string());
    let uid = request.uid.ok_or_else(|| "Missing uid".to_string())?;
    let attachment_index = request
        .attachment_index
        .ok_or_else(|| "Missing attachment index".to_string())?;

    client.select(&folder)?;
    let raw_message = client.fetch_full_message(uid)?;
    let parsed = parse_mail(&raw_message).map_err(err_to_string)?;
    let attachments = collect_attachment_parts(&parsed);
    let attachment = attachments
        .get(attachment_index)
        .ok_or_else(|| "Attachment not found".to_string())?;

    Ok(json!({
        "name": attachment.name,
        "type": attachment.mime_type,
        "size": attachment.content.len(),
        "contentBase64": STANDARD.encode(&attachment.content),
    }))
}

fn fetch_email(session: &mut ImapSession, request: &ImapRequest) -> Result<Value, String> {
    let folder = request
        .folder
        .clone()
        .unwrap_or_else(|| "INBOX".to_string());
    let uid = request.uid.ok_or_else(|| "Missing uid".to_string())?;

    session.select(&folder).map_err(err_to_string)?;
    let messages = session
        .uid_fetch(uid.to_string(), "UID FLAGS RFC822")
        .map_err(err_to_string)?;
    let message = messages
        .iter()
        .next()
        .ok_or_else(|| "Message not found".to_string())?;
    let body = message
        .body()
        .ok_or_else(|| "Message body missing".to_string())?;
    let parsed = parse_mail(body).map_err(err_to_string)?;

    let html = extract_best_body(&parsed, "text/html").unwrap_or_default();
    let text = extract_best_body(&parsed, "text/plain").unwrap_or_default();
    let attachments = collect_attachments(&parsed);

    Ok(json!({
        "html": html,
        "text": text,
        "bodyHtml": html,
        "bodyText": text,
        "attachments": attachments,
        "cryptoInfo": Value::Null,
    }))
}

fn fetch_attachment(session: &mut ImapSession, request: &ImapRequest) -> Result<Value, String> {
    let folder = request
        .folder
        .clone()
        .unwrap_or_else(|| "INBOX".to_string());
    let uid = request.uid.ok_or_else(|| "Missing uid".to_string())?;
    let attachment_index = request
        .attachment_index
        .ok_or_else(|| "Missing attachment index".to_string())?;

    session.select(&folder).map_err(err_to_string)?;
    let messages = session
        .uid_fetch(uid.to_string(), "UID RFC822")
        .map_err(err_to_string)?;
    let message = messages
        .iter()
        .next()
        .ok_or_else(|| "Message not found".to_string())?;
    let body = message
        .body()
        .ok_or_else(|| "Message body missing".to_string())?;
    let parsed = parse_mail(body).map_err(err_to_string)?;
    let attachments = collect_attachment_parts(&parsed);
    let attachment = attachments
        .get(attachment_index)
        .ok_or_else(|| "Attachment not found".to_string())?;

    Ok(json!({
        "name": attachment.name,
        "type": attachment.mime_type,
        "size": attachment.content.len(),
        "contentBase64": STANDARD.encode(&attachment.content),
    }))
}

fn update_flags(session: &mut ImapSession, request: &ImapRequest) -> Result<Value, String> {
    let folder = request
        .folder
        .clone()
        .unwrap_or_else(|| "INBOX".to_string());
    let uid = request.uid.ok_or_else(|| "Missing uid".to_string())?;

    session.select(&folder).map_err(err_to_string)?;

    if let Some(add_flags) = &request.add_flags {
        if !add_flags.is_empty() {
            let query = format!("+FLAGS.SILENT ({})", add_flags.join(" "));
            session
                .uid_store(uid.to_string(), query)
                .map_err(err_to_string)?;
        }
    }

    if let Some(remove_flags) = &request.remove_flags {
        if !remove_flags.is_empty() {
            let query = format!("-FLAGS.SILENT ({})", remove_flags.join(" "));
            session
                .uid_store(uid.to_string(), query)
                .map_err(err_to_string)?;
        }
    }

    Ok(json!({ "success": true }))
}

fn move_email(session: &mut ImapSession, request: &ImapRequest) -> Result<Value, String> {
    let folder = request
        .folder
        .clone()
        .unwrap_or_else(|| "INBOX".to_string());
    let uid = request.uid.ok_or_else(|| "Missing uid".to_string())?;
    let target_folder = request
        .target_folder
        .clone()
        .ok_or_else(|| "Missing targetFolder".to_string())?;

    session.select(&folder).map_err(err_to_string)?;
    session
        .uid_copy(uid.to_string(), target_folder)
        .map_err(err_to_string)?;
    session
        .uid_store(uid.to_string(), "+FLAGS.SILENT (\\Deleted)")
        .map_err(err_to_string)?;
    session
        .uid_expunge(uid.to_string())
        .map_err(err_to_string)?;

    Ok(json!({ "success": true }))
}

fn copy_email(session: &mut ImapSession, request: &ImapRequest) -> Result<Value, String> {
    let folder = request
        .folder
        .clone()
        .unwrap_or_else(|| "INBOX".to_string());
    let uid = request.uid.ok_or_else(|| "Missing uid".to_string())?;
    let target_folder = request
        .target_folder
        .clone()
        .ok_or_else(|| "Missing targetFolder".to_string())?;

    session.select(&folder).map_err(err_to_string)?;
    session
        .uid_copy(uid.to_string(), target_folder)
        .map_err(err_to_string)?;

    Ok(json!({ "success": true }))
}

fn delete_email(session: &mut ImapSession, request: &ImapRequest) -> Result<Value, String> {
    let folder = request
        .folder
        .clone()
        .unwrap_or_else(|| "INBOX".to_string());
    let uid = request.uid.ok_or_else(|| "Missing uid".to_string())?;

    session.select(&folder).map_err(err_to_string)?;
    session
        .uid_store(uid.to_string(), "+FLAGS.SILENT (\\Deleted)")
        .map_err(err_to_string)?;
    session
        .uid_expunge(uid.to_string())
        .map_err(err_to_string)?;

    Ok(json!({ "success": true }))
}

fn append_message(session: &mut ImapSession, request: &ImapRequest) -> Result<Value, String> {
    let folder = request
        .folder
        .clone()
        .ok_or_else(|| "Missing folder".to_string())?;
    let raw_message = request
        .raw_message
        .clone()
        .ok_or_else(|| "Missing rawMessage".to_string())?;

    let mut command = session.append(&folder, raw_message.as_bytes());
    for flag in request.flags.clone().unwrap_or_default() {
        if let Some(mapped) = map_flag(&flag) {
            command.flag(mapped);
        }
    }
    command.finish().map_err(err_to_string)?;

    Ok(json!({ "success": true }))
}

fn map_list_message(fetch: &imap::types::Fetch<'_>) -> Result<Value, String> {
    let headers = parse_header_map(fetch.header().unwrap_or(&[]));
    let envelope = fetch.envelope();

    let from = envelope
        .and_then(|env| env.from.as_ref().or(env.sender.as_ref()))
        .and_then(|addresses| addresses.first().map(map_imap_address))
        .or_else(|| {
            let parsed = parse_single_address(headers.get("from").map(String::as_str).unwrap_or(""));
            if parsed.email.is_empty() && parsed.name.is_empty() {
                None
            } else {
                Some(parsed)
            }
        })
        .unwrap_or(Address {
            name: headers
                .get("from")
                .cloned()
                .unwrap_or_else(|| "(Unknown Sender)".to_string()),
            email: String::new(),
        });

    let to: Vec<Address> = envelope
        .and_then(|env| env.to.as_ref())
        .map(|addresses| map_imap_addresses(addresses))
        .unwrap_or_default();
    let to = if to.is_empty() {
        parse_address_list(headers.get("to").map(String::as_str).unwrap_or(""))
    } else {
        to
    };

    let cc: Vec<Address> = envelope
        .and_then(|env| env.cc.as_ref())
        .map(|addresses| map_imap_addresses(addresses))
        .unwrap_or_default();
    let cc = if cc.is_empty() {
        parse_address_list(headers.get("cc").map(String::as_str).unwrap_or(""))
    } else {
        cc
    };

    let subject = envelope
        .and_then(|env| env.subject.as_ref().map(decode_imap_bytes))
        .filter(|value| !value.trim().is_empty())
        .or_else(|| headers.get("subject").cloned())
        .unwrap_or_else(|| "(No Subject)".to_string());

    let date = envelope
        .and_then(|env| env.date.as_ref().map(decode_imap_bytes))
        .filter(|value| !value.trim().is_empty())
        .or_else(|| fetch.internal_date().map(|value| value.to_rfc3339()))
        .or_else(|| headers.get("date").cloned())
        .unwrap_or_default();

    let message_id = envelope
        .and_then(|env| env.message_id.as_ref().map(decode_imap_bytes))
        .or_else(|| headers.get("message-id").cloned())
        .unwrap_or_default();

    let in_reply_to = envelope
        .and_then(|env| env.in_reply_to.as_ref().map(decode_imap_bytes))
        .or_else(|| headers.get("in-reply-to").cloned())
        .unwrap_or_default();

    let references = headers.get("references").cloned().unwrap_or_default();

    Ok(json!({
        "uid": fetch.uid.unwrap_or_default(),
        "from": from,
        "to": to,
        "cc": cc,
        "subject": subject,
        "snippet": subject,
        "date": date,
        "flags": fetch.flags().iter().map(flag_to_string).collect::<Vec<_>>(),
        "hasAttachments": false,
        "attachments": [],
        "messageId": message_id,
        "inReplyTo": in_reply_to,
        "references": references,
    }))
}

struct RawImapClient {
    stream: native_tls::TlsStream<TcpStream>,
    next_tag: usize,
}

impl RawImapClient {
    fn connect(host: &str, port: u16, username: &str, password: &str) -> Result<Self, String> {
        let tcp = TcpStream::connect((host, port)).map_err(err_to_string)?;
        tcp.set_read_timeout(Some(Duration::from_millis(2000)))
            .map_err(err_to_string)?;
        tcp.set_write_timeout(Some(Duration::from_secs(10)))
            .map_err(err_to_string)?;

        let connector = TlsConnector::new().map_err(err_to_string)?;
        let mut stream = connector.connect(host, tcp).map_err(err_to_string)?;
        let greeting = read_until_timeout(&mut stream).map_err(err_to_string)?;
        if !String::from_utf8_lossy(&greeting).contains("* OK") {
            return Err("IMAP greeting failed".to_string());
        }

        let mut client = Self { stream, next_tag: 1 };
        client.command(&format!(
            "LOGIN {} {}",
            quote_imap_string(username),
            quote_imap_string(password)
        ))?;
        Ok(client)
    }

    fn select(&mut self, folder: &str) -> Result<Vec<u8>, String> {
        self.command(&format!("SELECT {}", quote_imap_string(folder)))
    }

    fn uid_search_all(&mut self) -> Result<Vec<u32>, String> {
        let response = self.command("UID SEARCH ALL")?;
        let text = String::from_utf8_lossy(&response);
        let line = text
            .lines()
            .find(|line| line.starts_with("* SEARCH "))
            .unwrap_or("");

        Ok(line
            .trim_start_matches("* SEARCH ")
            .split_whitespace()
            .filter_map(|value| value.parse::<u32>().ok())
            .collect())
    }

    fn fetch_header_summary(&mut self, uid: u32) -> Result<Value, String> {
        let response = self.command(&format!(
            "UID FETCH {} (UID FLAGS INTERNALDATE RFC822.HEADER)",
            uid
        ))?;
        let prefix = String::from_utf8_lossy(&response);
        let header = extract_literal(&response, b"RFC822.HEADER").unwrap_or_default();
        let parsed = mailparse::parse_headers(&header).map_err(err_to_string)?.0;

        let from = parse_single_address(parsed.get_first_value("From").as_deref().unwrap_or(""));
        let to = parse_address_list(parsed.get_first_value("To").as_deref().unwrap_or(""));
        let cc = parse_address_list(parsed.get_first_value("Cc").as_deref().unwrap_or(""));
        let subject = parsed
            .get_first_value("Subject")
            .unwrap_or_else(|| "(No Subject)".to_string());
        let date = parsed
            .get_first_value("Date")
            .or_else(|| extract_quoted_attr(&prefix, "INTERNALDATE"))
            .unwrap_or_default();
        let message_id = parsed.get_first_value("Message-ID").unwrap_or_default();
        let in_reply_to = parsed.get_first_value("In-Reply-To").unwrap_or_default();
        let references = parsed.get_first_value("References").unwrap_or_default();
        let flags = extract_flags(&prefix);

        Ok(json!({
            "uid": uid,
            "from": from,
            "to": to,
            "cc": cc,
            "subject": subject.clone(),
            "snippet": subject,
            "date": date,
            "flags": flags,
            "hasAttachments": false,
            "attachments": [],
            "messageId": message_id,
            "inReplyTo": in_reply_to,
            "references": references,
        }))
    }

    fn fetch_full_message(&mut self, uid: u32) -> Result<Vec<u8>, String> {
        let response = self.command(&format!("UID FETCH {} (UID FLAGS RFC822)", uid))?;
        extract_literal(&response, b"RFC822").ok_or_else(|| "Message body missing".to_string())
    }

    fn command(&mut self, command: &str) -> Result<Vec<u8>, String> {
        let tag = format!("A{}", self.next_tag);
        self.next_tag += 1;
        let line = format!("{tag} {command}\r\n");
        self.stream
            .write_all(line.as_bytes())
            .map_err(err_to_string)?;
        self.stream.flush().map_err(err_to_string)?;
        read_until_tag(&mut self.stream, &tag).map_err(err_to_string)
    }
}

fn quote_imap_string(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn read_until_tag(
    stream: &mut native_tls::TlsStream<TcpStream>,
    tag: &str,
) -> std::io::Result<Vec<u8>> {
    let mut buffer = Vec::new();
    let tag_ok = format!("\r\n{tag} OK").into_bytes();
    let tag_no = format!("\r\n{tag} NO").into_bytes();
    let tag_bad = format!("\r\n{tag} BAD").into_bytes();

    loop {
        let mut chunk = [0u8; 8192];
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => {
                buffer.extend_from_slice(&chunk[..read]);
                if contains_bytes(&buffer, &tag_ok)
                    || contains_bytes(&buffer, &tag_no)
                    || contains_bytes(&buffer, &tag_bad)
                {
                    break;
                }
            }
            Err(err)
                if err.kind() == std::io::ErrorKind::WouldBlock
                    || err.kind() == std::io::ErrorKind::TimedOut =>
            {
                break;
            }
            Err(err) => return Err(err),
        }
    }

    Ok(buffer)
}

fn read_until_timeout(stream: &mut native_tls::TlsStream<TcpStream>) -> std::io::Result<Vec<u8>> {
    let mut buffer = Vec::new();
    loop {
        let mut chunk = [0u8; 4096];
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => buffer.extend_from_slice(&chunk[..read]),
            Err(err)
                if err.kind() == std::io::ErrorKind::WouldBlock
                    || err.kind() == std::io::ErrorKind::TimedOut =>
            {
                break;
            }
            Err(err) => return Err(err),
        }
    }
    Ok(buffer)
}

fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|window| window == needle)
}

fn extract_literal(response: &[u8], marker: &[u8]) -> Option<Vec<u8>> {
    let marker_pos = response.windows(marker.len()).position(|window| window == marker)?;
    let brace_start = response[marker_pos..]
        .iter()
        .position(|byte| *byte == b'{')?
        + marker_pos;
    let brace_end = response[brace_start..]
        .iter()
        .position(|byte| *byte == b'}')?
        + brace_start;
    let literal_len = std::str::from_utf8(&response[brace_start + 1..brace_end])
        .ok()?
        .parse::<usize>()
        .ok()?;
    let data_start = brace_end + 3;
    let data_end = data_start + literal_len;
    response.get(data_start..data_end).map(|slice| slice.to_vec())
}

fn extract_flags(response: &str) -> Vec<String> {
    if let Some(start) = response.find("FLAGS (") {
        let flags_start = start + "FLAGS (".len();
        if let Some(end) = response[flags_start..].find(')') {
            return response[flags_start..flags_start + end]
                .split_whitespace()
                .map(|flag| flag.to_string())
                .collect();
        }
    }
    Vec::new()
}

fn extract_quoted_attr(response: &str, attribute: &str) -> Option<String> {
    let marker = format!("{attribute} \"");
    let start = response.find(&marker)? + marker.len();
    let tail = &response[start..];
    let end = tail.find('"')?;
    Some(tail[..end].to_string())
}

fn parse_header_map(header_bytes: &[u8]) -> std::collections::HashMap<String, String> {
    let raw = String::from_utf8_lossy(header_bytes);
    let mut unfolded: Vec<String> = Vec::new();

    for line in raw.lines() {
        if line.starts_with(' ') || line.starts_with('\t') {
            if let Some(previous) = unfolded.last_mut() {
                previous.push(' ');
                previous.push_str(line.trim());
            }
        } else {
            unfolded.push(line.trim_end_matches('\r').to_string());
        }
    }

    let mut map = std::collections::HashMap::new();
    for line in unfolded {
        if let Some((name, value)) = line.split_once(':') {
            map.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    map
}

fn decode_imap_bytes(bytes: &std::borrow::Cow<'_, [u8]>) -> String {
    String::from_utf8_lossy(bytes.as_ref()).trim().to_string()
}

fn map_imap_address(address: &imap_proto::types::Address<'_>) -> Address {
    let mailbox = address
        .mailbox
        .as_ref()
        .map(decode_imap_bytes)
        .unwrap_or_default();
    let host = address
        .host
        .as_ref()
        .map(decode_imap_bytes)
        .unwrap_or_default();
    let email = if mailbox.is_empty() || host.is_empty() {
        String::new()
    } else {
        format!("{mailbox}@{host}")
    };
    let name = address
        .name
        .as_ref()
        .map(decode_imap_bytes)
        .filter(|value: &String| !value.trim().is_empty())
        .unwrap_or_else(|| email.clone());

    Address { name, email }
}

fn map_imap_addresses(addresses: &[imap_proto::types::Address<'_>]) -> Vec<Address> {
    addresses
        .iter()
        .map(map_imap_address)
        .filter(|address| !address.email.is_empty() || !address.name.is_empty())
        .collect()
}

fn parse_single_address(raw: &str) -> Address {
    parse_address_list(raw)
        .into_iter()
        .next()
        .unwrap_or(Address {
            name: String::new(),
            email: String::new(),
        })
}

fn parse_address_list(raw: &str) -> Vec<Address> {
    if raw.trim().is_empty() {
        return Vec::new();
    }

    addrparse(raw)
        .map(|list| {
            list.iter()
                .flat_map(|addr| match addr {
                    MailAddr::Single(single) => vec![Address {
                        name: single
                            .display_name
                            .clone()
                            .unwrap_or_else(|| single.addr.clone()),
                        email: single.addr.clone(),
                    }],
                    MailAddr::Group(group) => group
                        .addrs
                        .iter()
                        .map(|single| Address {
                            name: single
                                .display_name
                                .clone()
                                .unwrap_or_else(|| single.addr.clone()),
                            email: single.addr.clone(),
                        })
                        .collect(),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn extract_best_body(parsed: &ParsedMail<'_>, target_mime: &str) -> Option<String> {
    if parsed.ctype.mimetype.eq_ignore_ascii_case(target_mime) && !is_attachment(parsed) {
        return parsed.get_body().ok().filter(|body| !body.trim().is_empty());
    }

    for part in &parsed.subparts {
        if let Some(body) = extract_best_body(part, target_mime) {
            if !body.trim().is_empty() {
                return Some(body);
            }
        }
    }

    None
}

fn collect_attachments(parsed: &ParsedMail<'_>) -> Vec<AttachmentMeta> {
    collect_attachment_parts(parsed)
        .into_iter()
        .map(|attachment| AttachmentMeta {
            name: attachment.name,
            size: attachment.content.len(),
            r#type: attachment.mime_type,
        })
        .collect()
}

fn collect_attachment_parts(parsed: &ParsedMail<'_>) -> Vec<AttachmentPart> {
    let mut attachments = Vec::new();
    collect_attachment_parts_recursive(parsed, &mut attachments);
    attachments
}

fn collect_attachment_parts_recursive(parsed: &ParsedMail<'_>, attachments: &mut Vec<AttachmentPart>) {
    if is_attachment(parsed) {
        if let Ok(content) = parsed.get_body_raw() {
            attachments.push(AttachmentPart {
                name: attachment_name(parsed),
                mime_type: parsed.ctype.mimetype.clone(),
                content,
            });
        }
        return;
    }

    for part in &parsed.subparts {
        collect_attachment_parts_recursive(part, attachments);
    }
}

fn is_attachment(part: &ParsedMail<'_>) -> bool {
    let disposition = part.get_content_disposition();
    matches!(disposition.disposition, DispositionType::Attachment)
        || disposition.params.get("filename").is_some()
        || part.ctype.params.get("name").is_some()
}

fn attachment_name(part: &ParsedMail<'_>) -> String {
    let disposition = part.get_content_disposition();
    disposition
        .params
        .get("filename")
        .cloned()
        .or_else(|| part.ctype.params.get("name").cloned())
        .unwrap_or_else(|| "attachment".to_string())
}

fn flag_to_string(flag: &Flag<'_>) -> String {
    match flag {
        Flag::Seen => "\\Seen".to_string(),
        Flag::Answered => "\\Answered".to_string(),
        Flag::Flagged => "\\Flagged".to_string(),
        Flag::Deleted => "\\Deleted".to_string(),
        Flag::Draft => "\\Draft".to_string(),
        Flag::Recent => "\\Recent".to_string(),
        Flag::MayCreate => "\\*".to_string(),
        Flag::Custom(value) => value.to_string(),
        _ => String::new(),
    }
}

fn map_flag(flag: &str) -> Option<Flag<'static>> {
    match flag.trim() {
        "\\Seen" | "Seen" => Some(Flag::Seen),
        "\\Answered" | "Answered" => Some(Flag::Answered),
        "\\Flagged" | "Flagged" => Some(Flag::Flagged),
        "\\Deleted" | "Deleted" => Some(Flag::Deleted),
        "\\Draft" | "Draft" => Some(Flag::Draft),
        "\\Recent" | "Recent" => Some(Flag::Recent),
        "\\*" => Some(Flag::MayCreate),
        value if !value.is_empty() => Some(Flag::Custom(value.to_string().into())),
        _ => None,
    }
}
