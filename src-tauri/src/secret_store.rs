const SECRET_SERVICE_NAME: &str = "com.firstbeelancer.glowmail";

fn entry(secret_key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SECRET_SERVICE_NAME, secret_key).map_err(|err| err.to_string())
}

pub fn set_secret(secret_key: &str, secret_value: &str) -> Result<(), String> {
    entry(secret_key)?
        .set_password(secret_value)
        .map_err(|err| err.to_string())
}

pub fn get_secret(secret_key: &str) -> Result<Option<String>, String> {
    let credential = entry(secret_key)?;

    match credential.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

pub fn delete_secret(secret_key: &str) -> Result<(), String> {
    let credential = entry(secret_key)?;

    match credential.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}
