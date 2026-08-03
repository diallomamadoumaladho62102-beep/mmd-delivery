import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInput as TextInputType,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

type Props = {
  length?: number;
  value: string;
  onChange: (digits: string) => void;
  onComplete?: (digits: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  error?: string | null;
  success?: boolean;
  /** Prefer number-pad for numeric PIN; default characters for alphanumeric delivery codes. */
  mode?: "numeric" | "alphanumeric";
};

/**
 * Bank-style OTP / PIN boxes: auto-advance, auto-submit on last digit,
 * clear error, success check animation.
 */
export function OtpDigitInput({
  length = 4,
  value,
  onChange,
  onComplete,
  autoFocus = true,
  disabled = false,
  error = null,
  success = false,
  mode = "numeric",
}: Props) {
  const inputRef = useRef<TextInputType>(null);
  const shake = useRef(new Animated.Value(0)).current;
  const successScale = useRef(new Animated.Value(0)).current;
  const [focused, setFocused] = useState(false);
  const completedRef = useRef<string | null>(null);

  const normalized =
    mode === "numeric"
      ? value.replace(/\D/g, "").slice(0, length)
      : value
          .replace(/\s+/g, "")
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "")
          .slice(0, length);

  const digits = normalized.padEnd(length, " ").slice(0, length).split("");
  const activeIndex = Math.min(normalized.length, length - 1);
  const compact = length >= 6;
  const boxStyle = compact ? styles.boxCompact : styles.box;
  const digitStyle = compact ? styles.digitCompact : styles.digit;

  useEffect(() => {
    if (autoFocus && !disabled) {
      const t = setTimeout(() => inputRef.current?.focus(), 280);
      return () => clearTimeout(t);
    }
  }, [autoFocus, disabled]);

  useEffect(() => {
    if (error) {
      shake.setValue(0);
      Animated.sequence([
        Animated.timing(shake, { toValue: 10, duration: 45, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -10, duration: 45, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 8, duration: 45, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -8, duration: 45, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0, duration: 45, useNativeDriver: true }),
      ]).start();
    }
  }, [error, shake]);

  useEffect(() => {
    if (success) {
      successScale.setValue(0);
      Animated.spring(successScale, {
        toValue: 1,
        friction: 5,
        tension: 120,
        useNativeDriver: true,
      }).start();
    } else {
      successScale.setValue(0);
    }
  }, [success, successScale]);

  useEffect(() => {
    if (
      normalized.length === length &&
      onComplete &&
      !disabled &&
      !success &&
      completedRef.current !== normalized
    ) {
      completedRef.current = normalized;
      onComplete(normalized);
    }
    if (normalized.length < length) {
      completedRef.current = null;
    }
  }, [normalized, length, onComplete, disabled, success]);

  const handleChange = (text: string) => {
    if (disabled || success) return;
    const next =
      mode === "numeric"
        ? text.replace(/\D/g, "").slice(0, length)
        : text
            .replace(/\s+/g, "")
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "")
            .slice(0, length);
    onChange(next);
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => {
          if (!disabled && !success) inputRef.current?.focus();
        }}
        accessibilityRole="button"
        accessibilityLabel="Enter verification code"
      >
        <Animated.View
          style={[
            styles.row,
            compact ? styles.rowCompact : null,
            { transform: [{ translateX: shake }] },
          ]}
        >
          {digits.map((ch, i) => {
            const filled = ch !== " ";
            const isActive = focused && i === activeIndex && !success;
            const borderColor = success
              ? "#22C55E"
              : error
                ? "#F87171"
                : isActive
                  ? "#FBBF24"
                  : filled
                    ? "rgba(251,191,36,0.55)"
                    : "rgba(148,163,184,0.35)";
            return (
              <View
                key={i}
                style={[
                  boxStyle,
                  {
                    borderColor,
                    backgroundColor: success
                      ? "rgba(34,197,94,0.12)"
                      : error
                        ? "rgba(248,113,113,0.08)"
                        : "rgba(15,23,42,0.9)",
                  },
                ]}
              >
                <Text style={digitStyle}>{filled ? ch : ""}</Text>
              </View>
            );
          })}
        </Animated.View>
      </Pressable>

      <TextInput
        ref={inputRef}
        value={normalized}
        onChangeText={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType={mode === "numeric" ? "number-pad" : "default"}
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        autoCapitalize={mode === "numeric" ? "none" : "characters"}
        autoCorrect={false}
        caretHidden
        maxLength={length}
        editable={!disabled && !success}
        style={styles.hiddenInput}
        importantForAutofill="yes"
      />

      {success ? (
        <Animated.View
          style={[styles.successRow, { transform: [{ scale: successScale }] }]}
        >
          <Ionicons name="checkmark-circle" size={22} color="#22C55E" />
          <Text style={styles.successText}>Code verified</Text>
        </Animated.View>
      ) : null}

      {error && !success ? (
        <Text style={styles.errorText} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    marginBottom: 4,
  },
  row: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
  },
  rowCompact: {
    gap: 6,
  },
  box: {
    width: 52,
    height: 58,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  boxCompact: {
    width: 42,
    height: 50,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  digit: {
    color: "#F8FAFC",
    fontSize: 26,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  digitCompact: {
    color: "#F8FAFC",
    fontSize: 20,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  hiddenInput: {
    position: "absolute",
    opacity: 0.01,
    width: 1,
    height: 1,
  },
  successRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
  },
  successText: {
    color: "#4ADE80",
    fontSize: 14,
    fontWeight: "700",
  },
  errorText: {
    color: "#FCA5A5",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 12,
    paddingHorizontal: 8,
  },
});
