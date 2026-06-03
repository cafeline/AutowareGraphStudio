import { clusterColors as designClusterColors } from "./designTokens";
import type { GraphEdge, GraphNode } from "./graphModel";

export type ClusterId =
  | "sensing"
  | "perception"
  | "localization"
  | "planning"
  | "control"
  | "vehicle"
  | "system"
  | "other";

export type ClusterNode = GraphNode & {
  isCluster: true;
  clusterId: ClusterId;
  memberIds: string[];
  swappableCount: number;
  staticParamCount: number;
  dynamicParamCount: number;
};

export type ClusteredGraph = {
  nodes: Array<GraphNode | ClusterNode>;
  edges: GraphEdge[];
};

const clusterLabels: Record<ClusterId, string> = {
  sensing: "Sensing",
  perception: "Perception",
  localization: "Localization",
  planning: "Planning",
  control: "Control",
  vehicle: "Vehicle",
  system: "System",
  other: "Other"
};

const clusterOrder: ClusterId[] = ["sensing", "perception", "localization", "planning", "control", "vehicle", "system", "other"];

export const clusterColors: Record<ClusterId, string> = designClusterColors;

const clusterKeywords: Array<[ClusterId, string[]]> = [
  // Planning wins first so names like "diffusion_planner" do not match
  // perception's generic "fusion" keyword before "planner".
  ["planning", ["planning", "planner", "behavior", "route", "mission", "scenario", "path", "trajectory", "velocity_smoother"]],
  ["sensing", ["sensing", "sensor", "lidar", "camera", "imu", "gnss", "velodyne", "hesai", "nebula", "robosense", "pointcloud_preprocessor"]],
  ["perception", ["perception", "detected_object", "object", "traffic_light", "detection", "tracking", "fusion", "occupancy_grid", "cluster"]],
  ["localization", ["localization", "localizer", "ndt", "pose", "ekf", "map_tf", "gnss_poser", "gyro"]],
  ["control", ["control", "controller", "mpc", "pure_pursuit", "pid", "command_mode", "operation_mode", "vehicle_cmd"]],
  ["vehicle", ["vehicle", "can", "serial", "roboteq", "lsdb", "dio"]],
  ["system", ["system", "diagnostic", "monitor", "evaluator", "checker", "aggregator", "duplicated_node"]]
];

export function classifyNode(node: GraphNode): ClusterId {
  const text = [node.packageName, node.executable, node.name, node.launchFile].filter(Boolean).join(" ").toLowerCase();
  return clusterKeywords.find(([, keywords]) => keywords.some((keyword) => text.includes(keyword)))?.[0] ?? "other";
}

export function clusterLabel(clusterId: ClusterId): string {
  return clusterLabels[clusterId];
}

export function clusterColor(clusterId: ClusterId): string {
  return clusterColors[clusterId];
}

function makeClusterNode(clusterId: ClusterId, members: GraphNode[]): ClusterNode {
  const inputs = members.flatMap((node) => node.inputs);
  const outputs = members.flatMap((node) => node.outputs);
  const dynamicParamCount = members.reduce((total, node) => total + node.params.filter((param) => param.dynamic).length, 0);
  const staticParamCount = members.reduce((total, node) => total + node.params.filter((param) => !param.dynamic).length, 0);
  return {
    id: `cluster:${clusterId}`,
    name: clusterLabel(clusterId),
    launchFile: "cluster",
    inputs,
    outputs,
    params: [],
    isCluster: true,
    clusterId,
    memberIds: members.map((node) => node.id),
    swappableCount: members.filter((node) => node.swappable).length,
    staticParamCount,
    dynamicParamCount
  };
}

export function buildClusteredGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  expandedClusters: Set<ClusterId>
): ClusteredGraph {
  const groups = new Map<ClusterId, GraphNode[]>();
  for (const clusterId of clusterOrder) groups.set(clusterId, []);
  for (const node of nodes) groups.get(classifyNode(node))?.push(node);

  const visibleNodes: Array<GraphNode | ClusterNode> = [];
  const representativeByNodeId = new Map<string, string>();

  for (const clusterId of clusterOrder) {
    const members = groups.get(clusterId) ?? [];
    if (members.length === 0) continue;

    if (expandedClusters.has(clusterId)) {
      const sortedMembers = [...members].sort((a, b) => a.name.localeCompare(b.name));
      visibleNodes.push(...sortedMembers);
      for (const member of sortedMembers) {
        representativeByNodeId.set(member.id, member.id);
      }
    } else {
      const clusterNode = makeClusterNode(clusterId, members);
      visibleNodes.push(clusterNode);
      for (const member of members) representativeByNodeId.set(member.id, clusterNode.id);
    }
  }

  const edgeById = new Map<string, GraphEdge>();
  for (const edge of edges) {
    const source = representativeByNodeId.get(edge.source);
    const target = representativeByNodeId.get(edge.target);
    if (!source || !target || source === target) continue;

    const id = `${source}->${target}:${edge.topicName}`;
    if (!edgeById.has(id)) {
      edgeById.set(id, {
        ...edge,
        id,
        source,
        target
      });
    }
  }

  return { nodes: visibleNodes, edges: [...edgeById.values()] };
}

export function isClusterNode(node: GraphNode | ClusterNode): node is ClusterNode {
  return "isCluster" in node && node.isCluster;
}
