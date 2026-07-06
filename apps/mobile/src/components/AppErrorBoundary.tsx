import React from "react";
import { ScrollView, Text, View } from "react-native";
import { formatBootError, reportBootError } from "../lib/startupProbe";

type Props = {
  children: React.ReactNode;
};

type State = {
  error: Error | null;
};

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    reportBootError(`react-boundary:${info.componentStack?.slice(0, 120) ?? "unknown"}`, error);
  }

  render(): React.ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    const message = formatBootError(this.state.error);

    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#450A0A",
          padding: 20,
          paddingTop: 56,
        }}
      >
        <Text
          style={{
            color: "#FEE2E2",
            fontSize: 20,
            fontWeight: "800",
            marginBottom: 12,
          }}
        >
          MMD Delivery — erreur au démarrage
        </Text>
        <Text style={{ color: "#FECACA", marginBottom: 16, lineHeight: 22 }}>
          Copiez ce message depuis Xcode Console (filtre MMD-BOOT) et partagez-le
          au support.
        </Text>
        <ScrollView
          style={{
            flex: 1,
            backgroundColor: "#111827",
            borderRadius: 12,
            padding: 12,
          }}
        >
          <Text
            style={{
              color: "#F8FAFC",
              fontFamily: "Menlo",
              fontSize: 12,
              lineHeight: 18,
            }}
          >
            {message}
          </Text>
        </ScrollView>
      </View>
    );
  }
}
