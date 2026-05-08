/** SHA-256 hex of a Blob, computed on the main thread via WebCrypto.
 *  Files up to a few hundred MB hash fast enough that a worker is unnecessary;
 *  add one if profiling shows it stalls the UI on huge inputs.
 */
export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
