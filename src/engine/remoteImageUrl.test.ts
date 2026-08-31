import assert from "node:assert/strict";
import test from "node:test";
import { safeRemoteAddress, safeRemoteImageUrl } from "./remoteImageUrl.js";

test("safeRemoteImageUrl accepts public HTTPS image URLs", () => {
  assert.equal(safeRemoteImageUrl("https://cdn.example.com/image.jpg")?.href, "https://cdn.example.com/image.jpg");
  assert.equal(
    safeRemoteImageUrl("../next.jpg", new URL("https://cdn.example.com/jobs/output/image.jpg"))?.href,
    "https://cdn.example.com/jobs/next.jpg",
  );
});

test("safeRemoteImageUrl rejects credentials and non-HTTPS URLs", () => {
  assert.equal(safeRemoteImageUrl("http://cdn.example.com/image.jpg"), null);
  assert.equal(safeRemoteImageUrl("https://user:pass@cdn.example.com/image.jpg"), null);
  assert.equal(safeRemoteImageUrl("not a URL"), null);
});

test("safeRemoteImageUrl rejects local and private IPv4 destinations", () => {
  for (const hostname of [
    "localhost",
    "images.localhost",
    "metadata.internal",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.0.1",
    "198.18.0.1",
  ]) {
    assert.equal(safeRemoteImageUrl(`https://${hostname}/image.jpg`), null, hostname);
  }
});

test("safeRemoteImageUrl rejects local and private IPv6 destinations", () => {
  for (const hostname of ["[::]", "[::1]", "[::ffff:127.0.0.1]", "[fd00::1]", "[fe80::1]"]) {
    assert.equal(safeRemoteImageUrl(`https://${hostname}/image.jpg`), null, hostname);
  }
});

test("safeRemoteAddress accepts public DNS results and rejects internal ones", () => {
  for (const address of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"]) {
    assert.equal(safeRemoteAddress(address), true, address);
  }
  for (const address of ["", "cdn.example.com", "10.0.0.1", "127.0.0.1", "169.254.169.254", "::1", "fd00::1"]) {
    assert.equal(safeRemoteAddress(address), false, address);
  }
});
