export type PresetId = "cold-calling" | "appointment-setting" | "aggressive" | "preservation";

export type ProcessingPreset = {
  id: PresetId;
  label: string;
  description: string;
  silenceThresholdDb: number;
  minimumSilenceDuration: number;
  padding: number;
  mergeNearbyGap: number;
};

export const processingPresets: ProcessingPreset[] = [
  {
    id: "cold-calling",
    label: "Cold Calling",
    description: "Balanced cleanup for cold call sessions with dialing, ringing, and natural talk gaps.",
    silenceThresholdDb: -40,
    minimumSilenceDuration: 5,
    padding: 2,
    mergeNearbyGap: 8
  },
  {
    id: "appointment-setting",
    label: "Appointment Setting",
    description: "Keeps slightly longer back-and-forth blocks for booking and qualification calls.",
    silenceThresholdDb: -42,
    minimumSilenceDuration: 6,
    padding: 2.5,
    mergeNearbyGap: 10
  },
  {
    id: "aggressive",
    label: "Aggressive Condensing",
    description: "Removes more dead air for quick review when you are comfortable with tighter cuts.",
    silenceThresholdDb: -35,
    minimumSilenceDuration: 3,
    padding: 1,
    mergeNearbyGap: 5
  },
  {
    id: "preservation",
    label: "Maximum Conversation Preservation",
    description: "Keeps larger blocks together when call context matters more than maximum time savings.",
    silenceThresholdDb: -45,
    minimumSilenceDuration: 8,
    padding: 3,
    mergeNearbyGap: 14
  }
];

export const defaultPresetId: PresetId = "cold-calling";

export function getProcessingPreset(id: PresetId) {
  return processingPresets.find((preset) => preset.id === id) ?? processingPresets[0];
}
