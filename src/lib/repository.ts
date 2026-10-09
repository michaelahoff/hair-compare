import AsyncStorage from "@react-native-async-storage/async-storage";
import { randomUUID } from "expo-crypto";
import { supabase } from "./supabase";
import { DEV_ANALYSIS_URL, requestDevAnalysis } from "./dev-analysis";
import { keepPhoto, removePhotoFile } from "./local-files";
import { preparePhoto } from "./photos";
import {
  ScalpAnalysisSchema,
  type Analysis,
  type Journal,
  type Photo,
  type PhotoInput,
  type TreatmentInput,
} from "./model";

const LOCAL_KEY = "hair-compare:journal:v1";
const BUCKET = "scalp-photos";
const empty = (): Journal => ({ photos: [], treatments: [], analyses: [] });
let writes: Promise<unknown> = Promise.resolve();
async function readLocal(): Promise<Journal> {
  const value = await AsyncStorage.getItem(LOCAL_KEY);
  if (!value) return empty();
  return JSON.parse(value) as Journal;
}
function updateLocal(change: (journal: Journal) => void): Promise<void> {
  const write = writes
    .catch(() => {})
    .then(async () => {
      const journal = await readLocal();
      change(journal);
      await AsyncStorage.setItem(LOCAL_KEY, JSON.stringify(journal));
    });
  writes = write;
  return write;
}
function client() {
  if (!supabase) throw new Error("Cloud storage has not been configured.");
  return supabase;
}
export async function readJournal(owner: string): Promise<Journal> {
  if (owner === "local") {
    await writes.catch(() => {});
    return readLocal();
  }
  const db = client();
  const [photos, treatments, analyses] = await Promise.all([
    db.from("photos").select("*").eq("user_id", owner).order("taken_at"),
    db.from("treatments").select("*").eq("user_id", owner).order("started_on"),
    db.from("analyses").select("*").eq("user_id", owner).order("created_at"),
  ]);
  for (const response of [photos, treatments, analyses])
    if (response.error) throw response.error;
  const rows = photos.data as Omit<Photo, "uri">[];
  const signed = rows.length
    ? await db.storage.from(BUCKET).createSignedUrls(
        rows.map((p) => p.storage_path),
        3600,
      )
    : null;
  if (signed?.error) throw signed.error;
  return {
    photos: rows.map((p, i) => {
      const uri = signed?.data?.[i]?.signedUrl;
      if (!uri)
        throw new Error("A photo could not be loaded. Refresh to try again.");
      return { ...p, uri };
    }),
    treatments: treatments.data ?? [],
    analyses: (analyses.data ?? []).map((a) => ({
      ...a,
      result: ScalpAnalysisSchema.parse(a.result),
    })),
  };
}
export async function addPhoto(owner: string, input: PhotoInput) {
  const prepared = await preparePhoto(input.uri, input.width, input.height);
  const id = randomUUID();
  const { uri: _uri, ...metadata } = input;
  const photo: Photo = {
    ...metadata,
    width: prepared.width,
    height: prepared.height,
    id,
    user_id: owner,
    alignment: null,
    storage_path: `${owner}/${id}.jpg`,
    created_at: new Date().toISOString(),
    uri: "",
  };
  if (owner === "local") {
    photo.uri = keepPhoto(id, prepared.bytes);
    try {
      await updateLocal((j) => {
        j.photos.push(photo);
      });
    } catch (error) {
      removePhotoFile(photo.uri);
      throw error;
    }
  } else {
    const db = client();
    const uploaded = await db.storage
      .from(BUCKET)
      .upload(photo.storage_path, prepared.bytes.buffer as ArrayBuffer, {
        contentType: "image/jpeg",
        upsert: false,
      });
    if (uploaded.error) throw uploaded.error;
    const { uri: _displayUri, ...row } = photo;
    const inserted = await db.from("photos").insert(row);
    if (inserted.error) {
      await db.storage.from(BUCKET).remove([photo.storage_path]);
      throw inserted.error;
    }
  }
  return id;
}
export async function deletePhoto(owner: string, photo: Photo) {
  if (owner === "local") {
    await updateLocal((j) => {
      j.photos = j.photos.filter((p) => p.id !== photo.id);
      j.analyses = j.analyses.filter((a) => a.photo_id !== photo.id);
      j.analyses = j.analyses.map((a) =>
        a.previous_photo_id === photo.id
          ? { ...a, previous_photo_id: null }
          : a,
      );
    });
    removePhotoFile(photo.uri);
  } else {
    const db = client();
    // Remove the private object first: never leave an inaccessible orphan behind.
    const removed = await db.storage.from(BUCKET).remove([photo.storage_path]);
    if (removed.error) throw removed.error;
    const result = await db
      .from("photos")
      .delete()
      .eq("id", photo.id)
      .eq("user_id", owner);
    if (result.error) throw result.error;
  }
}
export async function saveAlignment(
  owner: string,
  id: string,
  alignment: Photo["alignment"],
) {
  if (owner === "local")
    await updateLocal((j) => {
      const photo = j.photos.find((p) => p.id === id);
      if (photo) photo.alignment = alignment;
    });
  else {
    const result = await client()
      .from("photos")
      .update({ alignment })
      .eq("id", id)
      .eq("user_id", owner);
    if (result.error) throw result.error;
  }
}
export async function saveTreatment(
  owner: string,
  input: TreatmentInput,
  id?: string,
) {
  const row = {
    ...input,
    id: id ?? randomUUID(),
    user_id: owner,
    created_at: new Date().toISOString(),
  };
  if (owner === "local")
    await updateLocal((j) => {
      j.treatments = [...j.treatments.filter((t) => t.id !== row.id), row];
    });
  else {
    const result = await client().from("treatments").upsert(row);
    if (result.error) throw result.error;
  }
}
export async function deleteTreatment(owner: string, id: string) {
  if (owner === "local")
    await updateLocal((j) => {
      j.treatments = j.treatments.filter((t) => t.id !== id);
    });
  else {
    const result = await client()
      .from("treatments")
      .delete()
      .eq("id", id)
      .eq("user_id", owner);
    if (result.error) throw result.error;
  }
}
/**
 * Assess a photo against an earlier one of its view: `previousId` when given,
 * else the latest before it.
 */
export async function analyzePhoto(
  owner: string,
  { photoId, previousId }: { photoId: string; previousId?: string },
) {
  if (DEV_ANALYSIS_URL) {
    // The dev server takes its inputs inline; resolve them from the journal.
    const journal = await readJournal(owner);
    const { result, model, previousId: comparedId } = await requestDevAnalysis(
      journal,
      photoId,
      previousId,
    );
    const row: Analysis = {
      id: randomUUID(),
      user_id: owner,
      photo_id: photoId,
      previous_photo_id: comparedId,
      model,
      result,
      created_at: new Date().toISOString(),
    };
    if (owner === "local")
      await updateLocal((j) => {
        j.analyses.push(row);
      });
    else {
      const inserted = await client().from("analyses").insert(row);
      if (inserted.error) throw inserted.error;
    }
    return;
  }
  if (owner === "local")
    throw new Error("Sign in to a cloud account to request an AI assessment.");
  const { data, error } = await client().functions.invoke("analyze-photo", {
    body: { photoId, previousId },
  });
  if (error) {
    const response = "context" in error ? (error.context as Response) : null;
    const body = await response?.json().catch(() => null);
    throw new Error(
      body?.error ??
        "The assessment service is unavailable. Please try again later.",
    );
  }
  ScalpAnalysisSchema.parse(data.result);
}
