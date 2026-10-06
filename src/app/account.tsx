import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  Button,
  Card,
  Field,
  Icon,
  Notice,
  Screen,
  colors,
  s,
} from "@/components/ui";
import { useAccount } from "@/hooks/use-journal";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/model";

export default function AccountScreen() {
  const { session } = useAccount();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function authenticate(create: boolean) {
    if (!supabase) return;
    setError("");
    setMessage("");
    if (!email.trim() || password.length < 8) {
      setError("Email and an 8+ character password required.");
      return;
    }
    setBusy(true);
    try {
      const result = create
        ? await supabase.auth.signUp({ email: email.trim(), password })
        : await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          });
      if (result.error) throw result.error;
      if (create && !result.data.session)
        setMessage("Check your email to confirm, then sign in.");
      setPassword("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    if (!supabase) return;
    setBusy(true);
    setError("");
    try {
      const result = await supabase.auth.signOut();
      if (result.error) throw result.error;
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <Card style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={styles.avatar}>
          <Icon name="account" size={26} color={colors.accent} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[s.body, { fontWeight: "700" }]} numberOfLines={1}>
            {session ? session.user.email : "This device"}
          </Text>
          <Text style={s.muted}>
            {session ? "Cloud sync" : "Stored locally"}
          </Text>
        </View>
      </Card>
      {session ? (
        <Button
          label="Sign out"
          variant="secondary"
          busy={busy}
          onPress={() => void signOut()}
        />
      ) : (
        supabase && (
          <Card>
            <Text style={[s.body, { fontWeight: "600" }]}>
              Sign in to sync and analyze photos
            </Text>
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="password"
            />
            <View style={s.wrap}>
              <Button
                label="Create account"
                variant="secondary"
                style={{ flex: 1 }}
                disabled={busy}
                onPress={() => void authenticate(true)}
              />
              <Button
                label="Sign in"
                style={{ flex: 1 }}
                busy={busy}
                onPress={() => void authenticate(false)}
              />
            </View>
          </Card>
        )
      )}
      {Boolean(error) && <Notice error>{error}</Notice>}
      {Boolean(message) && <Notice>{message}</Notice>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
});
