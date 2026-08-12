import { currentUser, isAuthAvailable, onAuthChange } from "./engine/auth.ts";
import { renderAuthForm } from "./ui/authForm.ts";
import type { AuthMode } from "./ui/authForm.ts";

const root = document.getElementById("auth-root") as HTMLElement;
const params = new URLSearchParams(window.location.search);
const requested = params.get("mode");
const allowed = new Set<AuthMode>(["link", "password", "signup", "forgot", "reset"]);
const initialMode: AuthMode = allowed.has(requested as AuthMode) ? (requested as AuthMode) : "signup";

if (!isAuthAvailable()) {
  root.innerHTML = `<h2 id="auth-title">Accounts are unavailable</h2>
    <p class="acct-lede">The account service is not configured in this build. You can still return to the scan.</p>
    <a class="btn pri acct-home" href="/">Scan your face</a>`;
} else {
  let recoveryEvent = initialMode === "reset";
  renderAuthForm(root, {
    initialMode,
    context: "portal",
    onAuthenticated: () => window.location.replace("/"),
  });

  // Supabase emits PASSWORD_RECOVERY after it has accepted the emailed token.
  // Re-rendering here covers providers/templates that omit ?mode=reset while
  // still keeping the explicit query parameter as the fast path.
  onAuthChange((user, event) => {
    if (event === "PASSWORD_RECOVERY" && !recoveryEvent) {
      recoveryEvent = true;
      renderAuthForm(root, {
        initialMode: "reset",
        context: "portal",
        onAuthenticated: () => window.location.replace("/"),
      });
      return;
    }
    if (user && !recoveryEvent) window.location.replace("/");
  });

  // If an already-signed-in person opens /auth directly, the product's default
  // destination remains the scan screen rather than an unnecessary portal.
  void currentUser().then((user) => {
    if (user && !recoveryEvent) window.location.replace("/");
  });
}
