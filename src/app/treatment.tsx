import { useState } from "react";
import { View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import {
  Button,
  Card,
  Chips,
  Empty,
  Field,
  Notice,
  Screen,
  s,
} from "@/components/ui";
import { DateField } from "@/components/date-field";
import { JournalState } from "@/components/journal-state";
import { useJournal, useJournalMutation } from "@/hooks/use-journal";
import { deleteTreatment, saveTreatment } from "@/lib/repository";
import {
  KIND_LABELS,
  errorMessage,
  localDate,
  validDate,
  type Treatment,
} from "@/lib/model";

function TreatmentForm({ treatment }: { treatment?: Treatment }) {
  const [name, setName] = useState(treatment?.name ?? "");
  const [kind, setKind] = useState<Treatment["kind"]>(
    treatment?.kind ?? "other",
  );
  const [dosage, setDosage] = useState(treatment?.dosage ?? "");
  const [start, setStart] = useState(treatment?.started_on ?? localDate());
  const [end, setEnd] = useState(treatment?.ended_on ?? "");
  const [notes, setNotes] = useState(treatment?.notes ?? "");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const save = useJournalMutation(
    (owner: string, input: Parameters<typeof saveTreatment>[1]) =>
      saveTreatment(owner, input, treatment?.id),
  );
  const remove = useJournalMutation(deleteTreatment);
  const busy = save.isPending || remove.isPending;
  async function submit() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!validDate(start) || (end && !validDate(end))) {
      setError("Choose valid start and end dates.");
      return;
    }
    if (end && end < start) {
      setError("End date is before start date.");
      return;
    }
    setError("");
    try {
      await save.mutateAsync({
        name: name.trim(),
        kind,
        dosage: dosage.trim() || null,
        started_on: start,
        ended_on: end || null,
        notes: notes.trim() || null,
      });
      router.replace("/treatments");
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function destroy() {
    if (!treatment) return;
    setError("");
    try {
      await remove.mutateAsync(treatment.id);
      router.replace("/treatments");
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <>
      <Card>
        <Field
          label="Name"
          value={name}
          onChangeText={setName}
          maxLength={120}
        />
        <Chips
          selected={kind}
          onChange={setKind}
          values={Object.entries(KIND_LABELS).map(([value, label]) => ({
            value: value as Treatment["kind"],
            label,
          }))}
        />
        <Field
          label="Dose"
          value={dosage}
          onChangeText={setDosage}
          maxLength={250}
        />
        <DateField
          label="Start"
          value={start}
          onChange={(value) => value && setStart(value)}
        />
        <DateField
          label="End"
          value={end || null}
          onChange={(value) => setEnd(value ?? "")}
          placeholder="Ongoing"
          minimumDate={start}
        />
        <Field
          label="Notes"
          value={notes}
          onChangeText={setNotes}
          multiline
          maxLength={2000}
        />
      </Card>
      {Boolean(error) && <Notice error>{error}</Notice>}
      <Button
        label="Save treatment"
        disabled={busy}
        busy={save.isPending}
        onPress={() => void submit()}
      />
      {treatment &&
        (confirm ? (
          <View style={s.wrap}>
            <Button
              label="Delete treatment"
              variant="danger"
              busy={remove.isPending}
              disabled={busy}
              onPress={() => void destroy()}
            />
            <Button
              label="Cancel"
              variant="ghost"
              onPress={() => setConfirm(false)}
            />
          </View>
        ) : (
          <Button
            label="Delete"
            icon="trash"
            variant="danger"
            style={{ alignSelf: "flex-start" }}
            disabled={busy}
            onPress={() => setConfirm(true)}
          />
        ))}
    </>
  );
}
export default function TreatmentScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const journal = useJournal();
  const treatment = journal.data?.treatments.find((t) => t.id === id);
  return (
    <Screen>
      <Stack.Screen
        options={{ title: id ? "Edit treatment" : "New treatment" }}
      />
      {Boolean(id) && (
        <JournalState
          loading={journal.isPending}
          error={journal.error}
          retry={() => void journal.refetch()}
        />
      )}
      {!id || treatment ? (
        <TreatmentForm key={id ?? "new"} treatment={treatment} />
      ) : (
        !journal.isPending &&
        !journal.error && (
          <Empty icon="treatments" title="Treatment not found" />
        )
      )}
    </Screen>
  );
}
