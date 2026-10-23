// El cliente es el mismo que en la web (carpeta `web/`); Rust solo suma lo que el navegador no puede hacer.
// Los comandos del desktop (keyring de la sesión, M8) viven acá.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("no pude arrancar la app");
}
