import { fromByteArray } from "base64-js";

/** Bare base64 of a stored JPEG: a data URI (local), or a signed cloud URL. */
export async function readPhotoBase64(uri: string): Promise<string> {
  const data = /^data:[^,]*;base64,/.exec(uri);
  if (data) return uri.slice(data[0].length);
  if (/^https?:\/\//.test(uri)) {
    const response = await fetch(uri);
    if (!response.ok)
      throw new Error("A photo could not be loaded. Refresh to try again.");
    return fromByteArray(new Uint8Array(await response.arrayBuffer()));
  }
  throw new Error("This photo cannot be read for analysis.");
}
