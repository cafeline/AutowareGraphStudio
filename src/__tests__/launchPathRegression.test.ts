import { describe, expect, it } from "vitest";
import { emptyComposition } from "../lib/composition";
import { buildForkSet } from "../lib/forkChain";
import { parseStaticGraph } from "../lib/parser";

const SOURCE_ROOT = "/ws/src";
const ENTRY = "/ws/src/demo_pkg/launch/entry.launch.xml";
const CHILD = "/ws/src/demo_pkg/launch/child.launch.xml";
const PARAM_FILE = "/ws/src/demo_pkg/config/talker.param.yaml";

const relativePathFiles: Record<string, string> = {
  "/ws/src/demo_pkg/package.xml": "<package><name>demo_pkg</name></package>",
  [ENTRY]: `<launch>
  <include file="child.launch.xml"/>
  <node pkg="demo_pkg" exec="talker" name="talker">
    <remap from="~/output/pose" to="/pose"/>
    <param from="../config/talker.param.yaml"/>
  </node>
</launch>
`,
  [CHILD]: `<launch>
  <node pkg="demo_pkg" exec="listener" name="listener">
    <remap from="~/input/pose" to="/pose"/>
  </node>
</launch>
`,
  [PARAM_FILE]: `/**:
  ros__parameters:
    gain: 1.0
`
};

describe("relative launch paths", () => {
  it("parses relative include files and relative param files from the launch directory", () => {
    const graph = parseStaticGraph(relativePathFiles, ENTRY, {});

    expect(graph.nodes.map((node) => node.name)).toEqual(["listener", "talker"]);
    expect(graph.includes).toEqual([{ fromLaunch: ENTRY, toLaunch: CHILD }]);
    expect(graph.launchGraph.edges).toEqual([{ id: `${ENTRY}->${CHILD}`, source: ENTRY, target: CHILD }]);
    expect(graph.nodes.find((node) => node.name === "talker")?.params).toEqual([
      expect.objectContaining({ key: "gain", value: 1.0, sourceFile: PARAM_FILE })
    ]);
    expect(graph.edges).toEqual([
      expect.objectContaining({ source: "talker", target: "listener", topicName: "/pose" })
    ]);
  });

  it("rewrites relative include and param references to forked files when saving edits", () => {
    const graph = parseStaticGraph(relativePathFiles, ENTRY, {});

    const output = buildForkSet({
      entryLaunch: ENTRY,
      forksDir: "/out/latest/forks",
      sourceRoot: SOURCE_ROOT,
      files: relativePathFiles,
      graph,
      composition: emptyComposition(),
      paramOverrides: [
        {
          nodeName: "talker",
          key: "gain",
          value: 2.0,
          sourceFile: PARAM_FILE
        }
      ],
      topicOverrides: [
        {
          nodeName: "listener",
          pinKind: "input",
          fromTopic: "/pose",
          toTopic: "/pose_new",
          fromRemap: "~/input/pose"
        }
      ],
      launchArgs: {}
    });

    const entryFork = output.forks.find((fork) => fork.path === "/out/latest/forks/demo_pkg/launch/entry.launch.xml");
    const childFork = output.forks.find((fork) => fork.path === "/out/latest/forks/demo_pkg/launch/child.launch.xml");
    const paramFork = output.forks.find((fork) => fork.path === "/out/latest/forks/demo_pkg/config/talker.param.yaml");

    expect(entryFork?.content).toContain('file="/out/latest/forks/demo_pkg/launch/child.launch.xml"');
    expect(entryFork?.content).toContain('from="/out/latest/forks/demo_pkg/config/talker.param.yaml"');
    expect(childFork?.content).toContain('to="/pose_new"');
    expect(paramFork?.content).toContain("gain: 2.0");
    expect(output.entryForkPath).toBe("/out/latest/forks/demo_pkg/launch/entry.launch.xml");
  });
});
