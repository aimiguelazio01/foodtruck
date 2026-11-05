#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::process::{Command, Stdio};
use tauri::Manager;

#[tauri::command]
async fn engine(
    app: tauri::AppHandle,
    mut request: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let action = request.get("action").and_then(|value| value.as_str());
    if !matches!(
        action,
        Some("accounts" | "verify-package" | "verify-license" | "install")
    ) {
        return Err("Operação indisponível.".into());
    }
    if action == Some("install") {
        let account = request
            .get("account")
            .and_then(|value| value.as_str())
            .ok_or("Conta inválida.")?;
        if account.len() != 32
            || !account
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err("Conta inválida.".into());
        }
        let directory = app
            .path()
            .app_local_data_dir()
            .map_err(|_| "Pasta da aplicação indisponível.")?
            .join("deployments")
            .join(account);
        request["journalDirectory"] = serde_json::Value::String(
            directory
                .to_str()
                .ok_or("Pasta da aplicação inválida.")?
                .to_owned(),
        );
    }
    let mut input = serde_json::to_vec(&request).map_err(|_| "Pedido inválido.")?;
    if input.len() > 65_535 {
        return Err("Pedido demasiado grande.".into());
    }
    input.push(b'\n');
    tauri::async_runtime::spawn_blocking(move || {
        let executable =
            std::env::current_exe().map_err(|_| "Não foi possível localizar o motor.")?;
        let parent = executable.parent().ok_or("Pasta da aplicação inválida.")?;
        let filename = if cfg!(windows) {
            "foodtruck-cloud-engine.exe"
        } else {
            "foodtruck-cloud-engine"
        };
        let mut command = Command::new(parent.join(filename));
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command
            .spawn()
            .map_err(|_| "Não foi possível iniciar o motor.")?;
        let communication = (|| {
            let mut stdin = child
                .stdin
                .take()
                .ok_or("Canal de comunicação indisponível.")?;
            stdin
                .write_all(&input)
                .map_err(|_| "Falha ao comunicar com o motor.")?;
            drop(stdin);
            let mut output = Vec::new();
            child
                .stdout
                .take()
                .ok_or("Resposta indisponível.")?
                .take(4_194_305)
                .read_to_end(&mut output)
                .map_err(|_| "Falha ao ler a resposta.")?;
            if output.len() > 4_194_304 {
                return Err("Resposta demasiado grande.");
            }
            let status = child
                .wait()
                .map_err(|_| "O motor terminou inesperadamente.")?;
            if !status.success() {
                return Err("O motor terminou com erro.");
            }
            serde_json::from_slice(&output).map_err(|_| "Resposta inválida do motor.")
        })();
        if communication.is_err() {
            let _ = child.kill();
            let _ = child.wait();
        }
        communication.map_err(String::from)
    })
    .await
    .map_err(|_| "Falha interna do assistente.".to_owned())?
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![engine])
        .run(tauri::generate_context!())
        .expect("Não foi possível abrir o assistente");
}
