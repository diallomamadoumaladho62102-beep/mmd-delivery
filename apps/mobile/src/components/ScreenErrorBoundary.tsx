import React from "react";
import { Pressable, Text, View } from "react-native";
import { formatBootError, reportBootError } from "../lib/startupProbe";

type Props = {
  children: React.ReactNode;
  fallbackTitle?: string;
};

type State = {
  error: Error | null;
};

/** Isolates a screen subtree so a map/native crash does not take over the whole app. */
export class ScreenErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    reportBootError(
      `screen-boundary:${info.componentStack?.slice(0, 80) ?? "unknown"}`,
      error,
    );
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;

    const title =
      this.props.fallbackTitle ?? "This screen could not be displayed.";
    const message = formatBootError(this.state.error);

    return (
      <View style={{ padding: 20, gap: 12 }}>
        <Text style={{ color: "#FEE2E2", fontSize: 18, fontWeight: "800" }}>
          {title}
        </Text>
        <Text style={{ color: "#FECACA", lineHeight: 20 }}>
          You can retry. If the problem persists, share this with support.
        </Text>
        <Pressable
          onPress={this.reset}
          style={{
            backgroundColor: "#F8FAFC",
            borderRadius: 10,
            paddingVertical: 12,
            paddingHorizontal: 20,
            alignSelf: "flex-start",
          }}
        >
          <Text style={{ color: "#111827", fontWeight: "700" }}>Retry</Text>
        </Pressable>
        {__DEV__ ? (
          <Text style={{ color: "#94A3B8", fontSize: 11 }}>{message}</Text>
        ) : null}
      </View>
    );
  }
}
