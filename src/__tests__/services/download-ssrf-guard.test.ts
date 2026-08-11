import { describe, it, expect } from "vitest";
import { downloadModel } from "../../services/model-resolver.js";

/**
 * Regression guard for the model-download SSRF fix. `downloadModel` is the choke
 * point every download path funnels through (local streaming, the MCP-side
 * auth-gate probe, and the remote ComfyUI-Manager dispatch). It must reject
 * non-http(s) schemes and internal/loopback/link-local/metadata/private/CGNAT
 * hosts via assertSafeUrl BEFORE any network dispatch or routing decision — so a
 * prompt-injected `download_model url:"http://169.254.169.254/..."` can never
 * make the server fetch cloud metadata or scan internal hosts.
 *
 * The guard runs before shouldDispatchDownloadToManager()/config lookups, so
 * these assertions need no ComfyUI/workspace mocks: the throw is upstream of them.
 */
describe("downloadModel SSRF guard", () => {
  const BLOCKED = [
    "http://169.254.169.254/latest/meta-data/iam/security-credentials/", // cloud metadata
    "http://127.0.0.1:8188/admin",
    "http://localhost/secret",
    "http://10.0.0.5/internal.safetensors",
    "http://192.168.1.10/model.safetensors",
    "http://172.16.0.9/model.safetensors",
    "http://100.64.0.1/model.safetensors", // CGNAT
    "http://[::1]/model.safetensors",
    "file:///etc/passwd",
    "ftp://example.com/model.safetensors",
  ];

  for (const url of BLOCKED) {
    it(`rejects ${url}`, async () => {
      await expect(
        downloadModel(url, "checkpoints", "model.safetensors"),
      ).rejects.toThrow();
    });
  }

  it("rejects the internal host before choosing a download route", async () => {
    // If routing/config ran first this would surface a config/route error; the
    // SSRF guard's message proves it short-circuited earlier.
    await expect(
      downloadModel("http://169.254.169.254/x", "checkpoints"),
    ).rejects.toThrow(/SSRF|internal|loopback/i);
  });
});
