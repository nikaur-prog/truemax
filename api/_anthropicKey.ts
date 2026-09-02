// The API key, read from the environment and cleaned of what a copy and paste
// puts in it.
//
// Copying a key out of a console web page can bring an invisible character
// with it: U+2028 LINE SEPARATOR is the common one, and a stray newline or a
// non-breaking space are the others. None of them are visible in a terminal,
// in a dashboard field, or in an editor. All of them are illegal in an HTTP
// header, so the request dies inside the client with
//
//   Cannot convert argument to a ByteString because the character at index N
//   has a value of 8232 which is greater than 255
//
// which names the character code and nothing else. It cost an hour the first
// time, and the failure looks identical whether it happens on a laptop or in
// a deployed function, where nobody is reading the log.
//
// So every caller reads the key through here. An API key is ASCII by
// construction, so anything outside printable ASCII is not part of it and is
// dropped rather than sent.
export function anthropicKey(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.ANTHROPIC_API_KEY;
  if (!raw) throw new Error("Missing server environment variable: ANTHROPIC_API_KEY");
  // eslint-disable-next-line no-control-regex
  const clean = raw.replace(/[^\x20-\x7e]/g, "").trim();
  if (!clean) throw new Error("ANTHROPIC_API_KEY holds no usable characters");
  return clean;
}
