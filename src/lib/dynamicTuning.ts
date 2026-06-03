export type DynamicTuningEntry = {
  nodeName: string;
  key: string;
  value: string | number | boolean | null;
  parameterType?: string;
};

export type GeneratedEntryLaunchInput = {
  sourceLaunch: string;
  launchArgs: Record<string, string>;
  entries: DynamicTuningEntry[];
  applyDelaySec?: number;
};

export type DynamicTuningLaunchInput = GeneratedEntryLaunchInput;

export function upsertDynamicTuningEntry(
  entries: DynamicTuningEntry[],
  next: DynamicTuningEntry
): DynamicTuningEntry[] {
  const existing = entries.find((entry) => entry.nodeName === next.nodeName && entry.key === next.key);
  if (!existing) return [...entries, next];
  return entries.map((entry) => (entry.nodeName === next.nodeName && entry.key === next.key ? next : entry));
}

function py(value: unknown): string {
  return JSON.stringify(value);
}

export function buildGeneratedEntryLaunchPy(input: GeneratedEntryLaunchInput): string {
  const delay = input.applyDelaySec ?? 8;
  const includeArgs = Object.entries(input.launchArgs);
  const commands = input.entries.map((entry) => [
    "ros2",
    "param",
    "set",
    entry.nodeName,
    entry.key,
    String(entry.value ?? "")
  ]);

  return `from launch import LaunchDescription
from launch.actions import ExecuteProcess, IncludeLaunchDescription, TimerAction
from launch.launch_description_sources import AnyLaunchDescriptionSource


def generate_launch_description():
    source_launch = ${py(input.sourceLaunch)}
    launch_arguments = dict(${py(includeArgs)})
    tuning_commands = ${py(commands)}

    actions = [
        IncludeLaunchDescription(
            AnyLaunchDescriptionSource(source_launch),
            launch_arguments=launch_arguments.items(),
        )
    ]

    if tuning_commands:
        actions.append(
            TimerAction(
                period=${delay},
                actions=[ExecuteProcess(cmd=command, output="screen") for command in tuning_commands],
            )
        )

    return LaunchDescription(actions)
`;
}

export const buildDynamicTuningLaunchPy = buildGeneratedEntryLaunchPy;
