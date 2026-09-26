// Apply the saved theme before first paint to avoid a flash. A separate file because
// the Content-Security-Policy doesn't allow inline scripts.
try {
  var t = localStorage.getItem("chat.theme");
  if (t === "light") document.documentElement.classList.remove("dark");
  else if (t === "system" && window.matchMedia("(prefers-color-scheme: light)").matches) document.documentElement.classList.remove("dark");
} catch (e) {}
