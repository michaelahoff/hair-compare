import { jpegDataUri } from "./photos";
export function keepPhoto(_id: string, bytes: Uint8Array): string {
  return jpegDataUri(bytes);
}
export function removePhotoFile(_uri: string) {}
