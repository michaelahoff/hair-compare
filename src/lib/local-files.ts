import { Directory, File, Paths } from "expo-file-system";

const directory = () => new Directory(Paths.document, "scalp-photos");
export function keepPhoto(id: string, bytes: Uint8Array): string {
  const folder = directory();
  folder.create({ intermediates: true, idempotent: true });
  const file = new File(folder, `${id}.jpg`);
  file.create();
  file.write(bytes);
  return file.uri;
}
export function removePhotoFile(uri: string) {
  const folder = directory();
  if (
    !uri.startsWith(`${folder.uri}/`) &&
    !uri.startsWith(folder.uri.endsWith("/") ? folder.uri : `${folder.uri}/`)
  )
    return;
  const file = new File(uri);
  if (file.exists) file.delete();
}
