import React from "react";
import { Text, View } from "react-native";
import type { ManeuverKind } from "../../lib/navigationManeuvers";

function arrowColor(compact: boolean) {
  return compact ? "#0F172A" : "#FFFFFF";
}

const SIZE = 58;
const STEM = 10;

function Canvas({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        width: SIZE,
        height: SIZE,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </View>
  );
}

/** Thick upward chevron tip with soft silhouette. */
function TipUp({ color, w = 22, h = 16 }: { color: string; w?: number; h?: number }) {
  return (
    <View style={{ alignItems: "center" }}>
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: w / 2,
          borderRightWidth: w / 2,
          borderBottomWidth: h,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderBottomColor: color,
        }}
      />
    </View>
  );
}

function TipLeft({ color, w = 16, h = 22 }: { color: string; w?: number; h?: number }) {
  return (
    <View
      style={{
        width: 0,
        height: 0,
        borderTopWidth: h / 2,
        borderBottomWidth: h / 2,
        borderRightWidth: w,
        borderTopColor: "transparent",
        borderBottomColor: "transparent",
        borderRightColor: color,
      }}
    />
  );
}

function StraightArrow({ color }: { color: string }) {
  return (
    <Canvas>
      <View style={{ alignItems: "center" }}>
        <TipUp color={color} />
        <View
          style={{
            width: STEM,
            height: 28,
            marginTop: -3,
            borderRadius: STEM / 2,
            backgroundColor: color,
          }}
        />
      </View>
    </Canvas>
  );
}

/**
 * Premium 90° left turn — continuous thick L with rounded elbow + tip.
 */
function TurnLeftArrow({ color }: { color: string }) {
  return (
    <Canvas>
      <View style={{ width: 46, height: 46 }}>
        {/* Vertical stem */}
        <View
          style={{
            position: "absolute",
            left: 20,
            top: 16,
            width: STEM,
            height: 30,
            borderRadius: STEM / 2,
            backgroundColor: color,
          }}
        />
        {/* Horizontal arm */}
        <View
          style={{
            position: "absolute",
            left: 2,
            top: 16,
            width: 28,
            height: STEM,
            borderRadius: STEM / 2,
            backgroundColor: color,
          }}
        />
        {/* Rounded elbow fill */}
        <View
          style={{
            position: "absolute",
            left: 20,
            top: 16,
            width: STEM,
            height: STEM,
            borderRadius: 3,
            backgroundColor: color,
          }}
        />
        <View style={{ position: "absolute", left: -4, top: 10 }}>
          <TipLeft color={color} />
        </View>
      </View>
    </Canvas>
  );
}

function SlightLeftArrow({ color }: { color: string }) {
  return (
    <Canvas>
      <View style={{ transform: [{ rotate: "-36deg" }], alignItems: "center" }}>
        <TipUp color={color} w={20} h={15} />
        <View
          style={{
            width: STEM,
            height: 26,
            marginTop: -3,
            borderRadius: STEM / 2,
            backgroundColor: color,
          }}
        />
      </View>
    </Canvas>
  );
}

function SharpLeftArrow({ color }: { color: string }) {
  return (
    <Canvas>
      <View style={{ width: 46, height: 46 }}>
        <View
          style={{
            position: "absolute",
            left: 28,
            top: 18,
            width: STEM,
            height: 26,
            borderRadius: STEM / 2,
            backgroundColor: color,
          }}
        />
        <View
          style={{
            position: "absolute",
            left: 4,
            top: 8,
            width: 32,
            height: STEM,
            borderRadius: STEM / 2,
            backgroundColor: color,
            transform: [{ rotate: "-32deg" }],
          }}
        />
        <View
          style={{
            position: "absolute",
            left: -2,
            top: 0,
            transform: [{ rotate: "-32deg" }],
          }}
        >
          <TipLeft color={color} w={15} h={20} />
        </View>
      </View>
    </Canvas>
  );
}

function UTurnArrow({ color }: { color: string }) {
  return (
    <Canvas>
      <View style={{ width: 42, height: 46 }}>
        <View
          style={{
            position: "absolute",
            top: 2,
            left: 4,
            width: 34,
            height: 24,
            borderTopLeftRadius: 17,
            borderTopRightRadius: 17,
            borderWidth: STEM,
            borderBottomWidth: 0,
            borderColor: color,
          }}
        />
        <View
          style={{
            position: "absolute",
            left: 4,
            top: 22,
            width: STEM,
            height: 20,
            borderRadius: STEM / 2,
            backgroundColor: color,
          }}
        />
        <View
          style={{
            position: "absolute",
            right: 4,
            top: 20,
            width: STEM,
            height: 12,
            borderRadius: STEM / 2,
            backgroundColor: color,
          }}
        />
        <View style={{ position: "absolute", right: 1, bottom: 0 }}>
          <TipUp color={color} w={18} h={13} />
        </View>
      </View>
    </Canvas>
  );
}

function ExitRightArrow({ color }: { color: string }) {
  return (
    <Canvas>
      <View style={{ transform: [{ rotate: "40deg" }], alignItems: "center" }}>
        <TipUp color={color} w={20} h={15} />
        <View
          style={{
            width: STEM,
            height: 26,
            marginTop: -3,
            borderRadius: STEM / 2,
            backgroundColor: color,
          }}
        />
      </View>
    </Canvas>
  );
}

function ForkLeftArrow({ color }: { color: string }) {
  return (
    <Canvas>
      <View style={{ width: 48, height: 48, alignItems: "center" }}>
        <View
          style={{
            position: "absolute",
            bottom: 2,
            width: STEM,
            height: 18,
            borderRadius: STEM / 2,
            backgroundColor: color,
          }}
        />
        <View
          style={{
            position: "absolute",
            top: 2,
            left: 2,
            transform: [{ rotate: "-34deg" }],
            alignItems: "center",
          }}
        >
          <TipUp color={color} w={18} h={13} />
          <View
            style={{
              width: 9,
              height: 22,
              marginTop: -2,
              borderRadius: 4.5,
              backgroundColor: color,
            }}
          />
        </View>
        <View
          style={{
            position: "absolute",
            top: 10,
            right: 6,
            opacity: 0.32,
            transform: [{ rotate: "30deg" }],
          }}
        >
          <View
            style={{
              width: 7,
              height: 18,
              borderRadius: 3.5,
              backgroundColor: color,
            }}
          />
        </View>
      </View>
    </Canvas>
  );
}

function RoundaboutArrow({
  color,
  exitIndex,
}: {
  color: string;
  exitIndex?: number | null;
}) {
  const label =
    exitIndex != null && Number.isFinite(exitIndex) && exitIndex > 0
      ? String(Math.round(exitIndex))
      : null;
  return (
    <Canvas>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          borderWidth: 8,
          borderColor: color,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {label ? (
          <Text
            style={{
              color,
              fontSize: 14,
              fontWeight: "900",
              marginTop: 1,
            }}
          >
            {label}
          </Text>
        ) : (
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: color,
            }}
          />
        )}
        <View style={{ position: "absolute", top: -11, alignItems: "center" }}>
          <TipUp color={color} w={16} h={12} />
        </View>
      </View>
    </Canvas>
  );
}

function ArriveArrow({ color }: { color: string }) {
  return (
    <Canvas>
      <View style={{ alignItems: "center" }}>
        <View
          style={{
            width: 20,
            height: 20,
            borderRadius: 10,
            borderWidth: 5,
            borderColor: color,
          }}
        />
        <View
          style={{
            width: STEM,
            height: 16,
            marginTop: 2,
            borderRadius: STEM / 2,
            backgroundColor: color,
          }}
        />
      </View>
    </Canvas>
  );
}

function mirror(node: React.ReactNode) {
  return <View style={{ transform: [{ scaleX: -1 }] }}>{node}</View>;
}

function resolveKind(maneuverType?: string): ManeuverKind {
  const raw = (maneuverType ?? "").toLowerCase().trim();
  const known: ManeuverKind[] = [
    "turn-left",
    "turn-right",
    "slight-left",
    "slight-right",
    "sharp-left",
    "sharp-right",
    "straight",
    "uturn",
    "roundabout",
    "fork-left",
    "fork-right",
    "merge",
    "exit",
    "depart",
    "arrive",
    "continue",
  ];
  if ((known as string[]).includes(raw)) return raw as ManeuverKind;

  if (raw.includes("uturn") || raw.includes("u-turn")) return "uturn";
  if (raw.includes("roundabout") || raw.includes("rotary")) return "roundabout";
  if (raw.includes("arrive")) return "arrive";
  if (raw.includes("slight") && raw.includes("left")) return "slight-left";
  if (raw.includes("slight") && raw.includes("right")) return "slight-right";
  if (raw.includes("sharp") && raw.includes("left")) return "sharp-left";
  if (raw.includes("sharp") && raw.includes("right")) return "sharp-right";
  if (raw.includes("fork") && raw.includes("left")) return "fork-left";
  if (raw.includes("fork") && raw.includes("right")) return "fork-right";
  if (raw.includes("exit") || raw.includes("ramp")) return "exit";
  if (raw.includes("left")) return "turn-left";
  if (raw.includes("right")) return "turn-right";
  return "straight";
}

/**
 * Premium navigation maneuver glyph — thick rounded strokes, real Mapbox kinds.
 */
export function DriverNavigationTurnArrow({
  maneuverType,
  compact = false,
  roundaboutExit = null,
}: {
  maneuverType?: string;
  compact?: boolean;
  /** Mapbox `maneuver.exit` when this is a roundabout. */
  roundaboutExit?: number | null;
}) {
  const color = arrowColor(compact);
  const kind = resolveKind(maneuverType);
  const scale = compact ? 0.5 : 1;

  let inner: React.ReactNode;
  switch (kind) {
    case "turn-left":
      inner = <TurnLeftArrow color={color} />;
      break;
    case "turn-right":
      inner = mirror(<TurnLeftArrow color={color} />);
      break;
    case "slight-left":
      inner = <SlightLeftArrow color={color} />;
      break;
    case "slight-right":
      inner = mirror(<SlightLeftArrow color={color} />);
      break;
    case "sharp-left":
      inner = <SharpLeftArrow color={color} />;
      break;
    case "sharp-right":
      inner = mirror(<SharpLeftArrow color={color} />);
      break;
    case "uturn":
      inner = <UTurnArrow color={color} />;
      break;
    case "fork-left":
      inner = <ForkLeftArrow color={color} />;
      break;
    case "fork-right":
      inner = mirror(<ForkLeftArrow color={color} />);
      break;
    case "exit":
    case "merge": {
      const leftish = (maneuverType ?? "").toLowerCase().includes("left");
      inner = leftish ? (
        mirror(<ExitRightArrow color={color} />)
      ) : (
        <ExitRightArrow color={color} />
      );
      break;
    }
    case "roundabout":
      inner = (
        <RoundaboutArrow color={color} exitIndex={roundaboutExit} />
      );
      break;
    case "arrive":
      inner = <ArriveArrow color={color} />;
      break;
    case "straight":
    case "continue":
    case "depart":
    default:
      inner = <StraightArrow color={color} />;
      break;
  }

  return (
    <View
      style={{
        transform: [{ scale }],
        alignItems: "center",
        justifyContent: "center",
        width: compact ? 30 : SIZE,
        height: compact ? 30 : SIZE,
      }}
    >
      {inner}
    </View>
  );
}
