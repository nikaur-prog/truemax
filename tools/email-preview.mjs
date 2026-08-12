const names = new Set([
  "confirm-signup",
  "magic-link",
  "reset-password",
  "invite-user",
  "change-email",
  "reauthentication",
]);

const requested = new URLSearchParams(location.search).get("template") || "confirm-signup";
const name = names.has(requested) ? requested : "confirm-signup";
const response = await fetch(`/supabase/email-templates/${name}.html`);
if (!response.ok) throw new Error(`Could not load ${name}`);

const preview = (await response.text())
  .replaceAll("{{ .ConfirmationURL }}", "#")
  .replaceAll("{{ .Email }}", "you@example.com")
  .replaceAll("{{ .NewEmail }}", "new@example.com")
  .replaceAll("{{ .Token }}", "482 915");

document.open();
document.write(preview);
document.close();
