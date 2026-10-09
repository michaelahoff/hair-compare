import { File } from "expo-file-system";
import { fromByteArray } from "base64-js";

/** Bare base64 of a stored JPEG: a local file, or a signed cloud URL. */
export async function readPhotoBase64(uri: string): Promise<string> {
  if (uri.startsWith("file://")) return new File(uri).base64();
  if (/^https?:\/\//.test(uri)) {
    const response = await fetch(uri);
    if (!response.ok)
      throw new Error("A photo could not be loaded. Refresh to try again.");
    return fromByteArray(new Uint8Array(await response.arrayBuffer()));
  }
  throw new Error("This photo cannot be read for analysis.");
}
