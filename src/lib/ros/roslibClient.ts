import { Ros } from "roslib";
import { buildRuntimeGraph } from "../parser";
import type { GraphModel } from "../graphModel";
import type { ResolvedGraph } from "../graphModel";

type ResolvedNode = ResolvedGraph["nodes"][number];

function connect(url: string): Promise<Ros> {
  return new Promise((resolve, reject) => {
    const ros = new Ros({ url });
    ros.on("connection", () => resolve(ros));
    ros.on("error", () => reject(new Error(`Could not connect to rosbridge at ${url}. Is rosbridge_server running?`)));
  });
}

function getNodes(ros: Ros): Promise<string[]> {
  return new Promise((resolve, reject) => ros.getNodes((nodes) => resolve(nodes), (error) => reject(new Error(error))));
}

function getTopicTypes(ros: Ros): Promise<Map<string, string>> {
  return new Promise((resolve, reject) =>
    ros.getTopics(
      (result) => {
        const map = new Map<string, string>();
        result.topics.forEach((topic, index) => map.set(topic, result.types[index] ?? "unknown"));
        resolve(map);
      },
      (error) => reject(new Error(error))
    )
  );
}

function getNodeDetails(ros: Ros, name: string, topicTypes: Map<string, string>): Promise<ResolvedNode> {
  const typed = (topics: string[]) =>
    Object.fromEntries(topics.map((topic) => [topic, topicTypes.get(topic) ?? "unknown"]));
  return new Promise((resolve) => {
    ros.getNodeDetails(
      name,
      (result) => {
        resolve({
          name,
          publishers: typed(result.publishing ?? []),
          subscribers: typed(result.subscribing ?? [])
        });
      },
      () => resolve({ name, publishers: {}, subscribers: {} })
    );
  });
}

// Build the complete running-system graph from rosbridge (rosapi). This is the source of truth
// for "what is actually running" — it includes .launch.py and framework-generated nodes.
export async function fetchRuntimeGraph(url: string): Promise<GraphModel> {
  const ros = await connect(url);
  try {
    const [names, topicTypes] = await Promise.all([getNodes(ros), getTopicTypes(ros)]);
    const nodes = await Promise.all(names.map((name) => getNodeDetails(ros, name, topicTypes)));
    return buildRuntimeGraph({ nodes });
  } finally {
    ros.close();
  }
}
