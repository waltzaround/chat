// The "choose your server" page bundled with the app. Checking the server happens in
// Rust (check_server), because a page can't read another origin's /api/instance.
const { invoke } = window.__TAURI__.core;
const form = document.getElementById("form");
const input = document.getElementById("server");
const error = document.getElementById("error");
const button = document.getElementById("connect");

invoke("current_server").then((current) => {
  if (current) input.value = current;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.hidden = true;
  button.disabled = true;
  button.textContent = "Checking…";
  try {
    const origin = await invoke("check_server", { input: input.value });
    await invoke("connect", { origin });
  } catch (err) {
    error.textContent = String(err);
    error.hidden = false;
    button.disabled = false;
    button.textContent = "Connect";
  }
});
