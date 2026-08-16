// Vite injects import.meta.env at build time. Only the two account keys are
// read anywhere in the app, and both are optional: with neither set the auth
// module stays inert (see src/engine/auth.ts). Declared here rather than via
// "vite/client" so the typecheck does not depend on that package resolving.
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// The short commit this bundle was built from, substituted by vite.config.ts
// at build time. "dev" when built outside Vercel.
declare const __BUILD__: string;
